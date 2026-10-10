import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import {
	createOpenFabRailAreaBlueprint,
	railAreaStampTemplateFromOpenFabBlueprint,
} from "../project/OpenFabBlueprintLibrary";
import { parseOpenFabProjectBlueprintValue } from "../project/OpenFabProjectCodec";
import {
	createOpenFabUserBlueprintRecord,
	parseOpenFabUserBlueprintJson,
	serializeOpenFabUserBlueprintRecord,
} from "../project/OpenFabUserBlueprintLibrary";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { planRailConstruction, planRailPath } from "./paint";
import {
	initialRailAreaStampPose,
	planRailAreaStamp,
	rotateRailAreaStampPose,
} from "./RailAreaStamp";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { buildRailModuleOwnershipIndex, type RailModuleOwnership } from "./RailModuleOwnership";
import { planRailModule } from "./RailModulePlanner";
import {
	continueRailModuleStampPose,
	createRailModuleStampTemplate,
	initialRailModuleStampPose,
	planRailModuleStamp,
	prepareRailModuleBlueprint,
	rotateRailModuleStampPose,
	setRailModuleStampSide,
} from "./RailModuleStamp";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

describe("RailModuleStamp", () => {
	it("captures renderer-independent straight geometry and rotates it through every quarter-turn", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 3, y: 0 }))).toBe(
			true,
		);
		const template = createRailModuleStampTemplate(moduleOfKind(source, "straight"));

		expect(Object.isFrozen(template)).toBe(true);
		expect(Object.isFrozen(template.path)).toBe(true);
		expect(template).toMatchObject({
			sourceKind: "straight",
			grammar: "straight-1-5m",
			sourceForward: DIR_E,
			sourceSide: null,
			anchorRole: "entry",
			repeatPolicy: "from-output",
		});
		expect(template.path).toEqual([
			{ longitudinal: 0, lateral: 0 },
			{ longitudinal: 1, lateral: 0 },
			{ longitudinal: 2, lateral: 0 },
			{ longitudinal: 3, lateral: 0 },
		]);

		const initialPose = initialRailModuleStampPose(template);
		let pose = initialPose;
		for (const expectedForward of [DIR_E, DIR_S, DIR_W, DIR_N] as const) {
			const target = new RailDocument();
			const plan = planRailModuleStamp(target.map, template, { x: 10, y: -4 }, pose);
			expect(plan.valid, plan.reason).toBe(true);
			expect(plan.stamp.forward).toBe(expectedForward);
			expect(plan.stamp.outputForward).toBe(expectedForward);
			expect(plan.cells.at(-1)).toEqual(moveRepeated({ x: 10, y: -4 }, expectedForward, 3));
			pose = rotateRailModuleStampPose(pose, 1);
		}
		expect(pose).toEqual(initialPose);
	});

	it("mirrors a compound side explicitly without changing its span or metric grammar", () => {
		const source = documentEndingAt(DIR_E);
		const built = planRailModule(source.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "u-turn", "wide");
		expect(source.commit(built)).toBe(true);
		const template = createRailModuleStampTemplate(moduleOfKind(source, "u-turn"));
		const initial = initialRailModuleStampPose(template);
		const mirrored = setRailModuleStampSide(initial, initial.side === "left" ? "right" : "left");
		const leftPlan = planRailModuleStamp(new RailDocument().map, template, { x: 0, y: 0 }, initial);
		const rightPlan = planRailModuleStamp(
			new RailDocument().map,
			template,
			{ x: 0, y: 0 },
			mirrored,
		);

		expect(leftPlan.valid, leftPlan.reason).toBe(true);
		expect(rightPlan.valid, rightPlan.reason).toBe(true);
		expect(leftPlan.stamp.side).not.toBe(rightPlan.stamp.side);
		expect(leftPlan.lengthMeters).toBe(rightPlan.lengthMeters);
		expect(leftPlan.cells.map(({ x, y }) => ({ x, y: y === 0 ? 0 : -y }))).toEqual(rightPlan.cells);
		expect(template.span).toBe("wide");
		expect(template.grammar).toBe("u-turn");
	});

	it("commits one evaluated stamp as one undoable worker patch", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 3, y: 0 }))).toBe(
			true,
		);
		const template = createRailModuleStampTemplate(moduleOfKind(source, "straight"));
		const target = documentEndingAt(DIR_E);
		const baseRevision = target.map.getRevision();
		const events: RailPatchEvent[] = [];
		target.subscribe((event) => events.push(event));
		const plan = planRailModuleStamp(
			target.map,
			template,
			{ x: 0, y: 0 },
			initialRailModuleStampPose(template),
		);
		const evaluation = new RailDraftEvaluator().evaluate(
			target.map,
			compilePhysicalRail(target.map),
			plan,
		);

		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(target.commit(evaluation.plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "build", baseRevision });
		expect(events[0]?.revision).toBeGreaterThan(baseRevision);
		expect(target.map.edgeCount).toBe(6);
		expect(target.undo()).toBe(true);
		expect(target.map.edgeCount).toBe(3);
	});

	it("keeps disconnected and crossing stamps invalid with a visible full-path preview", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 3, y: 0 }))).toBe(
			true,
		);
		const template = createRailModuleStampTemplate(moduleOfKind(source, "straight"));
		const target = documentEndingAt(DIR_E);
		const disconnected = planRailModuleStamp(
			target.map,
			template,
			{ x: 20, y: 20 },
			initialRailModuleStampPose(template),
		);

		expect(disconnected.valid).toBe(false);
		expect(disconnected.reason).toMatch(/열린 끝점/);
		expect(disconnected.cells).toHaveLength(4);
		expect(disconnected.conflicts).toEqual([{ x: 20, y: 20 }]);
	});

	it("rejects interior straight anchors, reversed terminals, and non-trunk turnout anchors", () => {
		const straightSource = new RailDocument();
		expect(
			straightSource.commit(
				planRailConstruction(straightSource.map, { x: 0, y: 0 }, { x: 3, y: 0 }),
			),
		).toBe(true);
		const straight = createRailModuleStampTemplate(moduleOfKind(straightSource, "straight"));
		const trunk = trunkThroughOrigin(DIR_E);
		const interior = planRailModuleStamp(
			trunk.map,
			straight,
			{ x: 0, y: 0 },
			initialRailModuleStampPose(straight),
		);
		expect(interior.valid).toBe(false);
		expect(interior.reason).toMatch(/열린 끝점/);

		const terminal = documentEndingAt(DIR_E);
		const reversed = planRailModuleStamp(
			terminal.map,
			straight,
			{ x: 0, y: 0 },
			{
				forward: DIR_W,
				side: null,
			},
		);
		expect(reversed.valid).toBe(false);
		expect(reversed.reason).toMatch(/열린 끝점/);

		const branch = turnoutTemplate("directed-branch");
		const nonTrunk = planRailModuleStamp(
			terminal.map,
			branch,
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right" },
		);
		expect(nonTrunk.valid).toBe(false);
		expect(nonTrunk.reason).toMatch(/직선 본선/);
	});

	it("rejects branch and merge stamps on an empty map instead of degrading them to a straight", () => {
		for (const grammar of ["directed-branch", "directed-merge"] as const) {
			const template = turnoutTemplate(grammar);
			const plan = planRailModuleStamp(
				new RailDocument().map,
				template,
				{ x: 0, y: 0 },
				initialRailModuleStampPose(template),
			);

			expect(plan.valid).toBe(false);
			expect(plan.reason).toMatch(/단방향 직선 본선/);
			expect(plan.cells).toHaveLength(4);
		}
	});

	it("advances output-repeat poses while keeping branch repetition on compatible trunk anchors", () => {
		const turn = ordinaryStampSources().find((module) => module.kind === "turn");
		if (!turn) throw new Error("Expected a turn source module.");
		const template = createRailModuleStampTemplate(turn);
		const target = documentEndingAt(template.sourceForward);
		const initial = initialRailModuleStampPose(template);
		const first = planRailModuleStamp(target.map, template, { x: 0, y: 0 }, initial);
		expect(first.valid, first.reason).toBe(true);
		expect(target.commit(first)).toBe(true);

		const continued = continueRailModuleStampPose(initial, first.stamp);
		expect(continued.forward).toBe(first.stamp.outputForward);
		expect(continued.forward).not.toBe(initial.forward);
		const second = planRailModuleStamp(target.map, template, first.stamp.exit, continued);
		expect(second.valid, second.reason).toBe(true);

		const branch = turnoutTemplate("directed-branch");
		expect(branch.repeatPolicy).toBe("compatible-anchor");
		const branchPose = initialRailModuleStampPose(branch);
		const branchPlan = planRailModuleStamp(
			trunkThroughOrigin(branchPose.forward).map,
			branch,
			{ x: 0, y: 0 },
			branchPose,
		);
		expect(branchPlan.valid, branchPlan.reason).toBe(true);
		expect(continueRailModuleStampPose(branchPose, branchPlan.stamp)).toBe(branchPose);
	});

	it("round-trips straight, turn, U-turn, and shift semantic ownership after transform", () => {
		for (const sourceModule of ordinaryStampSources()) {
			const template = createRailModuleStampTemplate(sourceModule);
			const side =
				template.sourceSide === null ? null : template.sourceSide === "left" ? "right" : "left";
			const pose = { forward: DIR_S, side } as const;
			const target = new RailDocument();
			const plan = planRailModuleStamp(target.map, template, { x: -7, y: 11 }, pose);

			expect(plan.valid, `${template.grammar}: ${plan.reason}`).toBe(true);
			expect(target.commit(plan)).toBe(true);
			const reconstructed = buildRailModuleOwnershipIndex(target.map).modules.find(
				(candidate) => candidate.kind === template.sourceKind,
			);
			expect(reconstructed?.construction).toMatchObject({
				grammar: template.grammar,
				forward: DIR_S,
				span: template.span,
				side,
			});
		}
	});

	it("stamps branch and merge chirality in all four rotations and both sides", () => {
		for (const grammar of ["directed-branch", "directed-merge"] as const) {
			const template = turnoutTemplate(grammar);
			expect(template.repeatPolicy).toBe(
				grammar === "directed-branch" ? "compatible-anchor" : "single",
			);
			for (const forward of ALL_DIRECTIONS) {
				for (const side of ["left", "right"] as const) {
					const target = trunkThroughOrigin(forward);
					const anchor = { x: 0, y: 0 };
					const plan = planRailModuleStamp(target.map, template, anchor, { forward, side });
					const evaluation = new RailDraftEvaluator().evaluate(
						target.map,
						compilePhysicalRail(target.map),
						plan,
					);

					expect(plan.valid, `${grammar}/${forward}/${side}: ${plan.reason}`).toBe(true);
					expect(evaluation.valid, `${grammar}/${forward}/${side}: ${evaluation.reason}`).toBe(
						true,
					);
					expect(plan.stamp.forward).toBe(forward);
					expect(plan.stamp.side).toBe(side);
					expect(target.commit(evaluation.plan)).toBe(true);
					const turnout = buildRailModuleOwnershipIndex(target.map).modules.find(
						(candidate) => candidate.kind === "turnout",
					);
					expect(turnout?.construction).toMatchObject({ grammar, forward, side });
				}
			}
		}
	});

	it("preserves an advanced switch profile across rotation and reports orientation mismatch", () => {
		const source = documentEndingAt(DIR_E);
		const built = planAdvancedSwitch(source.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(source.commit(built)).toBe(true);
		const template = createRailModuleStampTemplate(moduleOfKind(source, "advanced-switch"));
		expect(template.repeatPolicy).toBe("choose-output");

		for (const forward of ALL_DIRECTIONS) {
			for (const side of ["left", "right"] as const) {
				const target = documentEndingAt(forward);
				const plan = planRailModuleStamp(target.map, template, { x: 0, y: 0 }, { forward, side });
				expect(plan.valid, `${forward}/${side}: ${plan.reason}`).toBe(true);
				expect("profileClass" in plan && plan.profileClass).toBe("C");
				expect(plan.stamp).toMatchObject({ forward, side, sourceKind: "advanced-switch" });
				expect(target.commit(plan)).toBe(true);
				const reconstructed = moduleOfKind(target, "advanced-switch");
				expect(reconstructed.construction).toMatchObject({
					grammar: "advanced-switch",
					forward,
					side,
					advancedSwitchProfile: "C",
				});
			}
		}

		const eastTarget = documentEndingAt(DIR_E);
		const mismatch = planRailModuleStamp(
			eastTarget.map,
			template,
			{ x: 0, y: 0 },
			{ forward: DIR_S, side: "right" },
		);
		expect(mismatch.valid).toBe(false);
		expect(mismatch.reason).toMatch(/회전 방향/);
		expect(mismatch.cells.length).toBeGreaterThan(1);
	});
});

describe("single-module RECENT Blueprint conversion", () => {
	it.each([
		"straight",
		"turn",
		"u-turn",
		"shift",
	] as const)("preserves %s geometry in both codecs and all rotated placements", (kind) => {
		const seed = ordinaryStampSources().find((module) => module.kind === kind);
		if (!seed) throw new Error("missing module seed");
		for (const forward of ALL_DIRECTIONS) {
			const source = new RailDocument();
			const seedTemplate = createRailModuleStampTemplate(seed);
			expect(
				source.commit(
					planRailModuleStamp(
						source.map,
						seedTemplate,
						{ x: 9, y: -4 },
						{ forward, side: seedTemplate.sourceSide },
					),
				),
			).toBe(true);
			const module = moduleOfKind(source, kind),
				captured = createRailModuleStampTemplate(module);
			const fixed = JSON.stringify(captured);
			const prepared = prepareRailModuleBlueprint(captured);
			expect(prepared.valid).toBe(true);
			if (!prepared.valid) continue;
			const blueprint = parseOpenFabProjectBlueprintValue(
				JSON.parse(
					JSON.stringify(
						createOpenFabRailAreaBlueprint(prepared.template, {
							id: "single-module",
							name: "Single module",
							createdAt: "2026-10-10T00:00:00.000Z",
						}),
					),
				),
			);
			expect(blueprint.kind).toBe("RAIL_AREA");
			if (blueprint.kind !== "RAIL_AREA") continue;
			expect(blueprint.sourceModuleCount).toBe(1);
			expect(blueprint.edges).toEqual(normalizedEdges(module.eraseEdges));
			const local = createOpenFabUserBlueprintRecord(blueprint, {
				id: "local-module",
				createdAt: "2026-10-10T00:00:00.000Z",
			});
			expect(
				parseOpenFabUserBlueprintJson(serializeOpenFabUserBlueprintRecord(local)).blueprint,
			).toEqual(blueprint);
			// Source deletion after copy cannot change the captured RECENT payload.
			expect(source.undo()).toBe(true);
			expect(prepareRailModuleBlueprint(captured)).toEqual(prepared);
			expect(JSON.stringify(captured)).toBe(fixed);
			const restored = railAreaStampTemplateFromOpenFabBlueprint(blueprint);
			let pose = initialRailAreaStampPose();
			for (let rotation = 0; rotation < 4; rotation++) {
				const target = new RailDocument(),
					mirror = new RailPatchMirror(),
					events: RailPatchEvent[] = [];
				mirror.sync(
					captureRailMirrorSnapshot(
						target.map,
						target.getPatchSequence(),
						target.portEquipment,
						target.organizations,
					).snapshot,
				);
				target.subscribe((event) => {
					events.push(event);
					mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(event).patch));
				});
				const plan = planRailAreaStamp(target.map, restored, { x: 20, y: 20 }, pose);
				const evaluation = new RailDraftEvaluator().evaluate(
					target.map,
					compilePhysicalRail(target.map),
					plan,
				);
				expect(evaluation.valid, evaluation.reason).toBe(true);
				expect(target.commit(evaluation.plan)).toBe(true);
				expect(events).toHaveLength(1);
				expect(target.map.edgeCount).toBe(blueprint.edges.length);
				const placed = moduleOfKind(target, kind);
				expect(placed.construction.span).toBe(module.construction.span);
				expect(placed.construction.side).toBe(module.construction.side);
				const rotated = (x: number, y: number): Cell =>
					rotation === 0
						? { x, y }
						: rotation === 1
							? { x: -y, y: x }
							: rotation === 2
								? { x: -x, y: -y }
								: { x: y, y: -x };
				expect(normalizedEdges(placed.eraseEdges)).toEqual(
					normalizedEdges(
						blueprint.edges.map(([x, y, tx, ty]) => ({ from: rotated(x, y), to: rotated(tx, ty) })),
					),
				);
				expect(mirror.state.checksum).toBe(
					checksumRailMap(target.map, target.portEquipment, target.organizations),
				);
				expect(target.undo()).toBe(true);
				expect(target.map.edgeCount).toBe(0);
				expect(target.redo()).toBe(true);
				expect(target.map.edgeCount).toBe(blueprint.edges.length);
				expect(mirror.state.checksum).toBe(
					checksumRailMap(target.map, target.portEquipment, target.organizations),
				);
				pose = rotateRailAreaStampPose(pose, 1);
			}
		}
	});

	it.each([
		"u-turn",
		"shift",
	] as const)("preserves both sides and compact/wide %s spans", (kind) => {
		for (const span of ["compact", "wide"] as const)
			for (const side of [-1, 1]) {
				const source = documentEndingAt(DIR_E);
				expect(
					source.commit(
						planRailModule(source.map, { x: 0, y: 0 }, { x: 0, y: side * 3 }, kind, span),
					),
				).toBe(true);
				const module = moduleOfKind(source, kind),
					prepared = prepareRailModuleBlueprint(createRailModuleStampTemplate(module));
				expect(prepared.valid).toBe(true);
				if (prepared.valid)
					expect(normalizedEdges(prepared.template.edges)).toEqual(
						normalizedEdges(module.eraseEdges),
					);
			}
	});

	it("rejects branch, merge and advanced switches rather than inventing host rails or degrading their kind", () => {
		for (const grammar of ["directed-branch", "directed-merge"] as const) {
			const result = prepareRailModuleBlueprint(turnoutTemplate(grammar));
			expect(result.valid).toBe(false);
			expect(!result.valid && result.reason).toMatch(/부착 본선/);
		}
		const source = documentEndingAt(DIR_E);
		expect(source.commit(planAdvancedSwitch(source.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C"))).toBe(
			true,
		);
		const result = prepareRailModuleBlueprint(
			createRailModuleStampTemplate(moduleOfKind(source, "advanced-switch")),
		);
		expect(result.valid).toBe(false);
		expect(!result.valid && result.reason).toMatch(/별도 스위치 데이터/);
	});

	it("fails closed on attachment mismatches and malformed paths without repairing the payload", () => {
		const source = createRailModuleStampTemplate(ordinaryStampSources()[0] as RailModuleOwnership);
		for (const template of [
			{ ...source, grammar: "network-link" as const },
			{ ...source, anchorRole: "switch-input-0" as const },
			{ ...source, path: [] },
			{
				...source,
				path: [
					{ longitudinal: 0, lateral: 0 },
					{ longitudinal: 3, lateral: 0 },
				],
			},
			{
				...source,
				path: [
					{ longitudinal: 0, lateral: 0 },
					{ longitudinal: Number.NaN, lateral: 0 },
				],
			},
		])
			expect(prepareRailModuleBlueprint(template).valid).toBe(false);
	});
});

function normalizedEdges(edges: readonly { readonly from: Cell; readonly to: Cell }[]): number[][] {
	const cells = edges.flatMap((edge) => [edge.from, edge.to]);
	const minX = Math.min(...cells.map((cell) => cell.x)),
		minY = Math.min(...cells.map((cell) => cell.y));
	return edges
		.map(({ from, to }) => [from.x - minX, from.y - minY, to.x - minX, to.y - minY])
		.sort(
			(a, b) =>
				(a[0] as number) - (b[0] as number) ||
				(a[1] as number) - (b[1] as number) ||
				(a[2] as number) - (b[2] as number) ||
				(a[3] as number) - (b[3] as number),
		);
}

function ordinaryStampSources(): RailModuleOwnership[] {
	const straight = new RailDocument();
	expect(straight.commit(planRailConstruction(straight.map, { x: 0, y: 0 }, { x: 3, y: 0 }))).toBe(
		true,
	);
	const turn = new RailDocument();
	expect(
		turn.commit(
			planRailPath(turn.map, [
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 1, y: 1 },
			]),
		),
	).toBe(true);
	const uTurn = documentEndingAt(DIR_E);
	expect(
		uTurn.commit(planRailModule(uTurn.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "u-turn", "wide")),
	).toBe(true);
	const shift = documentEndingAt(DIR_E);
	expect(
		shift.commit(planRailModule(shift.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact")),
	).toBe(true);
	return [
		moduleOfKind(straight, "straight"),
		moduleOfKind(turn, "turn"),
		moduleOfKind(uTurn, "u-turn"),
		moduleOfKind(shift, "shift"),
	];
}

function moduleOfKind(
	document: RailDocument,
	kind: RailModuleOwnership["kind"],
): RailModuleOwnership {
	const module = buildRailModuleOwnershipIndex(document.map).modules.find(
		(candidate) => candidate.kind === kind,
	);
	if (!module) throw new Error(`Expected ${kind} module.`);
	return module;
}

function documentEndingAt(forward: Direction): RailDocument {
	const document = new RailDocument();
	const start = moveRepeated({ x: 0, y: 0 }, oppositeDirection(forward), 3);
	expect(document.commit(planRailConstruction(document.map, start, { x: 0, y: 0 }))).toBe(true);
	return document;
}

function trunkThroughOrigin(forward: Direction): RailDocument {
	const document = new RailDocument();
	const start = moveRepeated({ x: 0, y: 0 }, oppositeDirection(forward), 3);
	const end = moveRepeated({ x: 0, y: 0 }, forward, 3);
	expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	return document;
}

function turnoutTemplate(grammar: "directed-branch" | "directed-merge") {
	const source = trunkThroughOrigin(DIR_E);
	const side = { x: 0, y: 3 };
	const plan =
		grammar === "directed-branch"
			? planRailConstruction(source.map, { x: 0, y: 0 }, side)
			: planRailConstruction(source.map, side, { x: 0, y: 0 });
	expect(source.commit(plan)).toBe(true);
	const module = buildRailModuleOwnershipIndex(source.map).modules.find(
		(candidate) => candidate.kind === "turnout" && candidate.construction.grammar === grammar,
	);
	if (!module) throw new Error(`Expected ${grammar} turnout.`);
	return createRailModuleStampTemplate(module);
}

function moveRepeated(cell: Cell, direction: Direction, distance: number): Cell {
	let result = cell;
	for (let index = 0; index < distance; index++) result = moveCell(result, direction);
	return result;
}
