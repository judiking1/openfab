import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { analyzeRailNetwork } from "./network";
import { planRailConstruction } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { buildRailModuleOwnershipIndex, planRailModuleBulldoze } from "./RailModuleOwnership";
import {
	type BranchBypassTemplateParameters,
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	instantiateRailTemplate,
	type LongBayTemplateParameters,
	planRailTemplate,
	RAIL_TEMPLATE_CATALOG,
	type RailTemplateId,
	type RailTemplateParameters,
	type RailTemplatePose,
	type ReturnLoopTemplateParameters,
	railTemplateCatalogItem,
	reverseRailTemplateFlow,
	rotateRailTemplatePose,
	setRailTemplateParameter,
	setRailTemplateSide,
	transformRailTemplateBlueprint,
} from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

describe("RailTemplateCatalog", () => {
	it("owns immutable, versioned product templates and bounded metric parameters", () => {
		expect(Object.isFrozen(RAIL_TEMPLATE_CATALOG)).toBe(true);
		expect(RAIL_TEMPLATE_CATALOG.map((item) => item.id)).toEqual([
			"return-loop",
			"attached-return",
			"branch-bypass",
			"long-bay",
			"paired-bay",
			"nested-bay",
			"shift-bay",
			"interbay-spine",
			"outer-loop",
			"outerbay-link",
		]);
		expect(new Set(RAIL_TEMPLATE_CATALOG.map((item) => item.id)).size).toBe(10);
		expect(
			Object.fromEntries(RAIL_TEMPLATE_CATALOG.map((item) => [item.id, item.category])),
		).toEqual({
			"return-loop": "connector",
			"attached-return": "bay",
			"branch-bypass": "bay",
			"long-bay": "bay",
			"paired-bay": "bay",
			"nested-bay": "bay",
			"shift-bay": "bay",
			"interbay-spine": "interbay",
			"outer-loop": "outerbay",
			"outerbay-link": "outerbay",
		});
		for (const item of RAIL_TEMPLATE_CATALOG) {
			expect(item.version).toBe(item.id === "interbay-spine" ? 2 : 1);
			expect(Object.isFrozen(item)).toBe(true);
			expect(Object.isFrozen(item.controls)).toBe(true);
			expect(Object.isFrozen(item.parameters)).toBe(true);
			expect(Object.isFrozen(item.constituentGrammar)).toBe(true);
			for (const parameter of item.parameters) {
				expect(parameter.defaultValue).toBeGreaterThanOrEqual(parameter.minimum);
				expect(parameter.defaultValue).toBeLessThanOrEqual(parameter.maximum);
			}
		}

		const defaults = defaultRailTemplateParameters("return-loop");
		expect(
			(
				setRailTemplateParameter(
					"return-loop",
					defaults,
					"runLengthMeters",
					10_000,
				) as ReturnLoopTemplateParameters
			).runLengthMeters,
		).toBe(60);
		expect(
			(
				setRailTemplateParameter(
					"return-loop",
					defaults,
					"laneSpacingMeters",
					-10,
				) as ReturnLoopTemplateParameters
			).laneSpacingMeters,
		).toBe(2);
		expect(railTemplateCatalogItem("branch-bypass").anchorRequirement).toBe(
			"directed-straight-trunk",
		);
		expect(railTemplateCatalogItem("long-bay").anchorRequirement).toBe("free-closed");
	});

	it("builds a return loop from every cardinal direction and chirality", () => {
		const parameters = returnLoopParameters(8, 4);
		for (const forward of ALL_DIRECTIONS) {
			for (const side of ["left", "right"] as const) {
				const document = documentEndingAt(forward);
				const pose = { forward, side } satisfies RailTemplatePose;
				const plan = planRailTemplate(
					document.map,
					"return-loop",
					{ x: 0, y: 0 },
					pose,
					parameters,
				);
				const evaluation = new RailDraftEvaluator().evaluate(
					document.map,
					compilePhysicalRail(document.map),
					plan,
				);

				expect(plan.valid, `${forward}/${side}: ${plan.reason}`).toBe(true);
				expect(evaluation.valid, `${forward}/${side}: ${evaluation.reason}`).toBe(true);
				expect(plan.newEdges).toBe(20);
				expect(plan.turns).toBe(2);
				expect(plan.template.pose).toEqual(pose);
				expect(plan.template.hardReservedCells).toHaveLength(21);
				expect(plan.template.topologyFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
				expect(plan.template.geometryFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
				expect(document.commit(evaluation.plan)).toBe(true);
				expect(analyzeRailNetwork(document.map)).toMatchObject({
					status: "open",
					components: 1,
					openEnds: 2,
					curves: 2,
				});
			}
		}
	});

	it("keeps an interbay corridor wall-aligned while centering a smaller Bay run", () => {
		let parameters = defaultRailTemplateParameters("interbay-spine");
		parameters = setRailTemplateParameter("interbay-spine", parameters, "bayCount", 2);
		parameters = setRailTemplateParameter(
			"interbay-spine",
			parameters,
			"aisleLengthMeters",
			60,
		);
		const blueprint = instantiateRailTemplate("interbay-spine", parameters);

		expect(parameters).toMatchObject({
			templateId: "interbay-spine",
			bayCount: 2,
			bayPitchMeters: 16,
			aisleLengthMeters: 60,
		});
		expect(blueprint.buildRoutes).toHaveLength(3);
		expect(blueprint.buildRoutes[1]?.[0]).toEqual({ x: 14, y: 0 });
		expect(blueprint.buildRoutes[2]?.[0]).toEqual({ x: 30, y: 0 });

		parameters = setRailTemplateParameter("interbay-spine", parameters, "bayCount", 10);
		parameters = setRailTemplateParameter("interbay-spine", parameters, "bayPitchMeters", 30);
		parameters = setRailTemplateParameter(
			"interbay-spine",
			parameters,
			"aisleLengthMeters",
			28,
		);
		expect(parameters).toMatchObject({ bayCount: 10, bayPitchMeters: 30, aisleLengthMeters: 304 });
		expect(() => instantiateRailTemplate("interbay-spine", parameters)).not.toThrow();
	});

	it("keeps project-owned canonical topology separate from transformed instance identity", () => {
		const parameters = returnLoopParameters(8, 4);
		const blueprint = instantiateRailTemplate("return-loop", parameters);
		expect(blueprint.buildRoutes).toHaveLength(1);
		expect(blueprint.buildRoutes[0]).toHaveLength(21);
		expect(blueprint.buildRoutes[0]?.[0]).toEqual({ x: 0, y: 0 });
		expect(blueprint.buildRoutes[0]?.at(-1)).toEqual({ x: 0, y: 4 });
		expect(blueprint.terminals).toEqual([
			{
				role: "entry",
				cell: { x: 0, y: 0 },
				travelDirection: DIR_E,
				attachment: "open-terminal",
			},
			{
				role: "exit",
				cell: { x: 0, y: 4 },
				travelDirection: DIR_W,
				attachment: "open-terminal",
			},
		]);

		const first = planRailTemplate(
			new RailDocument().map,
			"return-loop",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right" },
			parameters,
		);
		const second = planRailTemplate(
			new RailDocument().map,
			"return-loop",
			{ x: 40, y: -20 },
			{ forward: DIR_N, side: "left" },
			parameters,
		);
		expect(first.valid, first.reason).toBe(true);
		expect(second.valid, second.reason).toBe(true);
		expect(first.template.topologyFingerprint).toBe(second.template.topologyFingerprint);
		expect(first.template.geometryFingerprint).not.toBe(second.template.geometryFingerprint);
		expect(first.template.mutationFingerprint).not.toBe(second.template.mutationFingerprint);
	});

	it("reverses every directed route and terminal without moving the template footprint", () => {
		const blueprint = instantiateRailTemplate("return-loop", returnLoopParameters(8, 4));
		const forwardPose = initialRailTemplatePose();
		const reversePose = reverseRailTemplateFlow(forwardPose);
		const forward = transformRailTemplateBlueprint(blueprint, { x: 7, y: -3 }, forwardPose);
		const reverse = transformRailTemplateBlueprint(blueprint, { x: 7, y: -3 }, reversePose);

		expect(reverse.occupiedCells).toEqual(forward.occupiedCells);
		expect(reverse.hardReservedCells).toEqual(forward.hardReservedCells);
		expect(reverse.buildRoutes[0]).toEqual([...(forward.buildRoutes[0] ?? [])].reverse());
		expect(reverse.terminals).toEqual([
			{
				...forward.terminals[1],
				role: "entry",
				travelDirection: oppositeDirection(forward.terminals[1]?.travelDirection ?? DIR_W),
			},
			{
				...forward.terminals[0],
				role: "exit",
				travelDirection: oppositeDirection(forward.terminals[0]?.travelDirection ?? DIR_E),
			},
		]);
		expect(reverse.geometryFingerprint).not.toBe(forward.geometryFingerprint);
	});

	it("reuses immutable canonical blueprints for identical template parameters", () => {
		const parameters = defaultRailTemplateParameters("long-bay");
		const first = instantiateRailTemplate("long-bay", parameters);
		const second = instantiateRailTemplate("long-bay", parameters);
		const resizedParameters = setRailTemplateParameter(
			"long-bay",
			parameters,
			"aisleLengthMeters",
			(parameters as LongBayTemplateParameters).aisleLengthMeters + 1,
		);
		const resized = instantiateRailTemplate("long-bay", resizedParameters);

		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(resized).not.toBe(first);
		expect(resized.definitionFingerprint).not.toBe(first.definitionFingerprint);
	});

	it("accepts min, default, and max dimensions through all rotations and chiralities", () => {
		for (const item of RAIL_TEMPLATE_CATALOG) {
			for (const variant of ["minimum", "default", "maximum"] as const) {
				const parameters = templateParametersAt(item.id, variant);
				for (const forward of ALL_DIRECTIONS) {
					for (const side of ["left", "right"] as const) {
						const document =
							item.anchorRequirement === "directed-straight-trunk"
								? directedTrunk(forward, 220)
								: new RailDocument();
						const plan = planRailTemplate(
							document.map,
							item.id,
							{ x: 0, y: 0 },
							{ forward, side },
							parameters,
						);
						const evaluation = new RailDraftEvaluator().evaluate(
							document.map,
							compilePhysicalRail(document.map),
							plan,
						);
						expect(plan.valid, `${item.id}/${variant}/${forward}/${side}: ${plan.reason}`).toBe(
							true,
						);
						expect(
							evaluation.valid,
							`${item.id}/${variant}/${forward}/${side}: ${evaluation.reason}`,
						).toBe(true);
					}
				}
			}
		}
	});

	it("creates one tangent branch-bypass-merge plan on a directed straight trunk", () => {
		const parameters = bypassParameters(12, 4);
		for (const forward of ALL_DIRECTIONS) {
			for (const side of ["left", "right"] as const) {
				const document = directedTrunk(forward, 20);
				const plan = planRailTemplate(
					document.map,
					"branch-bypass",
					{ x: 0, y: 0 },
					{ forward, side },
					parameters,
				);
				const evaluation = new RailDraftEvaluator().evaluate(
					document.map,
					compilePhysicalRail(document.map),
					plan,
				);

				expect(plan.valid, `${forward}/${side}: ${plan.reason}`).toBe(true);
				expect(evaluation.valid, `${forward}/${side}: ${evaluation.reason}`).toBe(true);
				expect(plan.template.terminals.map((terminal) => terminal.role)).toEqual([
					"branch",
					"merge",
				]);
				expect(document.commit(evaluation.plan)).toBe(true);
				const branch = document.map.getRail(0, 0);
				const mergeCell = moveRepeated({ x: 0, y: 0 }, forward, parameters.trunkSpanMeters);
				const merge = document.map.getRail(mergeCell.x, mergeCell.y);
				expect(bitCount(branch.incoming)).toBe(1);
				expect(bitCount(branch.outgoing)).toBe(2);
				expect(bitCount(merge.incoming)).toBe(2);
				expect(bitCount(merge.outgoing)).toBe(1);
				const turnouts = buildRailModuleOwnershipIndex(document.map).modules.filter(
					(module) => module.kind === "turnout",
				);
				expect(turnouts.map((module) => module.construction.grammar).sort()).toEqual([
					"directed-branch",
					"directed-merge",
				]);
			}
		}
	});

	it("builds a deterministic closed long-Bay loop and commits it as one undo entry", () => {
		const parameters = longBayParameters(24, 6);
		const events: RailPatchEvent[] = [];
		const document = new RailDocument();
		document.subscribe((event) => events.push(event));
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			{ x: -4, y: 7 },
			setRailTemplateSide(initialRailTemplatePose(), "left"),
			parameters,
		);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(plan.newEdges).toBe(60);
		expect(plan.turns).toBe(4);
		expect(plan.cells[0]).toEqual(plan.cells.at(-1));
		expect(plan.template.hardReservedCells).toHaveLength(60);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "build", baseRevision: 0 });
		const firstEvent = events[0];
		if (!firstEvent) throw new Error("Expected one atomic template patch event.");
		const mirror = new RailPatchMirror();
		expect(mirror.applyPatch(firstEvent)).toMatchObject({
			sequence: 1,
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
		});
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			openEnds: 0,
			stronglyConnected: true,
		});
		const committedChecksum = checksumRailMap(document.map);
		const committedFingerprint = checksumRailPhysicalLayout(compilePhysicalRail(document.map));
		const twin = new RailDocument();
		const twinPlan = planRailTemplate(
			twin.map,
			"long-bay",
			{ x: -4, y: 7 },
			setRailTemplateSide(initialRailTemplatePose(), "left"),
			parameters,
		);
		expect(twin.commit(twinPlan)).toBe(true);
		expect(checksumRailMap(twin.map)).toBe(committedChecksum);
		expect(checksumRailPhysicalLayout(compilePhysicalRail(twin.map))).toBe(committedFingerprint);

		expect(document.undo()).toBe(true);
		expect(document.map.edgeCount).toBe(0);
		expect(document.redo()).toBe(true);
		expect(checksumRailMap(document.map)).toBe(committedChecksum);
		expect(compilePhysicalRail(document.map).paths.pathCount).toBeGreaterThan(0);
	});

	it("commits every game-facing FAB pattern as one closed strongly connected worker patch", () => {
		for (const [id, routeCount, junctions, turns] of [
			["paired-bay", 2, 2, 6],
			["nested-bay", 2, 2, 6],
			["shift-bay", 1, 0, 8],
			["interbay-spine", 4, 6, 10],
			["outer-loop", 1, 0, 4],
		] as const) {
			const document = new RailDocument();
			const events: RailPatchEvent[] = [];
			document.subscribe((event) => events.push(event));
			const plan = planRailTemplate(
				document.map,
				id,
				{ x: -12, y: 9 },
				{ forward: DIR_S, side: "left" },
				defaultRailTemplateParameters(id),
			);
			const evaluation = new RailDraftEvaluator().evaluate(
				document.map,
				compilePhysicalRail(document.map),
				plan,
			);

			expect(plan.template.buildRoutes, `${id}: ${plan.reason}`).toHaveLength(routeCount);
			expect(plan.turns, id).toBe(turns);
			expect(evaluation.valid, `${id}: ${evaluation.reason}`).toBe(true);
			expect(document.commit(evaluation.plan), id).toBe(true);
			expect(events, id).toHaveLength(1);
			expect(analyzeRailNetwork(document.map), id).toMatchObject({
				status: "closed",
				openEnds: 0,
				junctions,
				stronglyConnected: true,
			});

			const event = events[0];
			if (!event) throw new Error(`Expected one ${id} patch event.`);
			const mirror = new RailPatchMirror();
			expect(mirror.applyPatch(event), id).toMatchObject({ sequence: 1 });
			expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers), id).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
			const committedChecksum = checksumRailMap(document.map);
			const readiness = createRailProjectReadiness(
				analyzeRailNetwork(document.map),
				compilePhysicalRail(document.map),
				committedChecksum,
			);
			expect(readiness, id).toMatchObject({
				ready: true,
				summary: { strongComponents: 1, physicalStrongComponents: 1, openTerminals: 0 },
			});

			expect(document.undo(), `${id} undo`).toBe(true);
			const undoEvent = events[1];
			if (!undoEvent) throw new Error(`Expected one ${id} undo patch event.`);
			expect(mirror.applyPatch(undoEvent), `${id} mirror undo`).toMatchObject({ sequence: 2 });
			expect(document.map.edgeCount, `${id} undo edges`).toBe(0);
			expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers), id).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);

			expect(document.redo(), `${id} redo`).toBe(true);
			const redoEvent = events[2];
			if (!redoEvent) throw new Error(`Expected one ${id} redo patch event.`);
			expect(mirror.applyPatch(redoEvent), `${id} mirror redo`).toMatchObject({ sequence: 3 });
			expect(checksumRailMap(document.map), `${id} checksum restore`).toBe(committedChecksum);
			expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers), id).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
		}
	});

	it("keeps relational Bay dimensions invalid as a full explanatory ghost", () => {
		for (const id of ["nested-bay", "shift-bay"] as const) {
			let parameters = defaultRailTemplateParameters(id);
			parameters = setRailTemplateParameter(id, parameters, "laneSpacingMeters", 5);
			parameters = setRailTemplateParameter(id, parameters, "offsetMeters", 10);
			const plan = planRailTemplate(
				new RailDocument().map,
				id,
				{ x: 0, y: 0 },
				initialRailTemplatePose(),
				parameters,
			);

			expect(plan.valid).toBe(false);
			expect(plan.reason).toMatch(/최소|작아야/);
			expect(plan.cells.length).toBeGreaterThan(10);
			expect(plan.template.hardReservedCells.length).toBeGreaterThan(10);
			expect(plan.conflicts.length).toBe(plan.template.hardReservedCells.length);
		}
	});

	it("attaches Return, Bay, and Outerbay loops to a closed parent without breaking its SCC", () => {
		for (const id of ["attached-return", "branch-bypass", "outerbay-link"] as const) {
			const document = new RailDocument();
			const events: RailPatchEvent[] = [];
			document.subscribe((event) => events.push(event));
			const mirror = new RailPatchMirror();
			const parent = planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y: 0 },
				initialRailTemplatePose(),
				longBayParameters(120, 24),
			);
			expect(document.commit(parent)).toBe(true);
			const parentEvent = events[0];
			if (!parentEvent) throw new Error(`Expected one ${id} parent patch event.`);
			expect(mirror.applyPatch(parentEvent), `${id} parent mirror`).toMatchObject({ sequence: 1 });

			const parameters = defaultRailTemplateParameters(id);
			const attached = planRailTemplate(
				document.map,
				id,
				{ x: 20, y: 0 },
				{ forward: DIR_E, side: "left" },
				parameters,
			);
			const evaluation = new RailDraftEvaluator().evaluate(
				document.map,
				compilePhysicalRail(document.map),
				attached,
			);
			expect(attached.valid, `${id}: ${attached.reason}`).toBe(true);
			expect(evaluation.valid, `${id}: ${evaluation.reason}`).toBe(true);
			expect(document.commit(evaluation.plan), id).toBe(true);
			expect(events, id).toHaveLength(2);
			expect(events[1], id).toMatchObject({ kind: "build" });
			const attachEvent = events[1];
			if (!attachEvent) throw new Error(`Expected one ${id} attachment patch event.`);
			expect(mirror.applyPatch(attachEvent), `${id} attachment mirror`).toMatchObject({
				sequence: 2,
				checksum: checksumRailMap(document.map),
			});
			expect(analyzeRailNetwork(document.map), id).toMatchObject({
				status: "closed",
				stronglyConnected: true,
				openEnds: 0,
				junctions: 2,
			});
			expect(
				createRailProjectReadiness(
					analyzeRailNetwork(document.map),
					compilePhysicalRail(document.map),
					checksumRailMap(document.map),
				),
				id,
			).toMatchObject({ ready: true, summary: { physicalStrongComponents: 1 } });
			expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers), id).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
			const attachedChecksum = checksumRailMap(document.map);

			expect(document.undo(), `${id} undo`).toBe(true);
			const undoEvent = events[2];
			if (!undoEvent) throw new Error(`Expected one ${id} attachment undo event.`);
			expect(mirror.applyPatch(undoEvent), `${id} mirror undo`).toMatchObject({
				sequence: 3,
				checksum: checksumRailMap(document.map),
			});
			expect(analyzeRailNetwork(document.map), `${id} parent after undo`).toMatchObject({
				status: "closed",
				stronglyConnected: true,
				junctions: 0,
			});

			expect(document.redo(), `${id} redo`).toBe(true);
			const redoEvent = events[3];
			if (!redoEvent) throw new Error(`Expected one ${id} attachment redo event.`);
			expect(mirror.applyPatch(redoEvent), `${id} mirror redo`).toMatchObject({
				sequence: 4,
				checksum: attachedChecksum,
			});
			expect(checksumRailMap(document.map), `${id} redo checksum`).toBe(attachedChecksum);
			expect(
				createRailProjectReadiness(
					analyzeRailNetwork(document.map),
					compilePhysicalRail(document.map),
					checksumRailMap(document.map),
				),
				`${id} redo readiness`,
			).toMatchObject({ ready: true, summary: { physicalStrongComponents: 1 } });
			expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers), id).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
		}
	});

	it("keeps the shipped attachment defaults compatible with a default Long Bay", () => {
		for (const id of ["attached-return", "branch-bypass", "outerbay-link"] as const) {
			const document = new RailDocument();
			const parent = planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y: 0 },
				initialRailTemplatePose(),
				defaultRailTemplateParameters("long-bay"),
			);
			expect(document.commit(parent), `${id} parent`).toBe(true);
			const anchor = id === "outerbay-link" ? { x: 3, y: 0 } : { x: 5, y: 0 };
			const attached = planRailTemplate(
				document.map,
				id,
				anchor,
				{ forward: DIR_E, side: "left" },
				defaultRailTemplateParameters(id),
			);
			const evaluation = new RailDraftEvaluator().evaluate(
				document.map,
				compilePhysicalRail(document.map),
				attached,
			);

			expect(attached.valid, `${id}: ${attached.reason}`).toBe(true);
			expect(evaluation.valid, `${id}: ${evaluation.reason}`).toBe(true);
		}
	});

	it("places several closed patterns as work-in-progress components and mirrors each atomically", () => {
		const document = new RailDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const mirror = new RailPatchMirror();
		for (const anchor of [
			{ x: 0, y: 0 },
			{ x: 60, y: 30 },
		] as const) {
			const plan = planRailTemplate(
				document.map,
				"long-bay",
				anchor,
				initialRailTemplatePose(),
				longBayParameters(24, 6),
			);
			const evaluation = new RailDraftEvaluator().evaluate(
				document.map,
				compilePhysicalRail(document.map),
				plan,
			);
			expect(evaluation.valid, evaluation.reason).toBe(true);
			expect(document.commit(evaluation.plan)).toBe(true);
			const event = events.at(-1);
			if (!event) throw new Error("Expected an atomic closed-pattern patch.");
			expect(mirror.applyPatch(event)).toMatchObject({
				sequence: events.length,
				checksum: checksumRailMap(document.map),
			});
		}

		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "disconnected",
			components: 2,
			strongComponents: 2,
			openEnds: 0,
		});
		expect(
			createRailProjectReadiness(
				analyzeRailNetwork(document.map),
				compilePhysicalRail(document.map),
				checksumRailMap(document.map),
			),
		).toMatchObject({
			ready: false,
			summary: { closure: "closed", strongComponents: 2 },
		});
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
		const composedChecksum = checksumRailMap(document.map);
		expect(document.undo()).toBe(true);
		const undoEvent = events.at(-1);
		if (!undoEvent) throw new Error("Expected a multi-pattern undo patch.");
		expect(mirror.applyPatch(undoEvent)).toMatchObject({ sequence: 3 });
		expect(analyzeRailNetwork(document.map)).toMatchObject({ status: "closed", components: 1 });
		expect(document.redo()).toBe(true);
		const redoEvent = events.at(-1);
		if (!redoEvent) throw new Error("Expected a multi-pattern redo patch.");
		expect(mirror.applyPatch(redoEvent)).toMatchObject({
			sequence: 4,
			checksum: composedChecksum,
		});
	});

	it("merges compatible same-direction overlap and rejects an exact duplicate", () => {
		const document = new RailDocument();
		const parameters = longBayParameters(24, 6);
		const first = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			parameters,
		);
		expect(document.commit(first)).toBe(true);
		const overlapped = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 12, y: 0 },
			initialRailTemplatePose(),
			parameters,
		);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			overlapped,
		);
		expect(overlapped.newEdges).toBeGreaterThan(0);
		expect(overlapped.newEdges).toBeLessThan(first.newEdges);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			components: 1,
			stronglyConnected: true,
			junctions: 4,
		});

		const duplicate = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 12, y: 0 },
			initialRailTemplatePose(),
			parameters,
		);
		expect(duplicate.valid).toBe(false);
		expect(duplicate.reason).toMatch(/이미 같은 방향/);
		expect(duplicate.mutations).toHaveLength(0);
	});

	it("reuses an existing parent loop while adding a nested or paired child route", () => {
		for (const id of ["nested-bay", "paired-bay"] as const) {
			const document = new RailDocument();
			const parent = planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y: 0 },
				initialRailTemplatePose(),
				longBayParameters(24, 8),
			);
			expect(document.commit(parent), `${id} parent`).toBe(true);

			let childParameters = defaultRailTemplateParameters(id);
			childParameters = setRailTemplateParameter(id, childParameters, "aisleLengthMeters", 24);
			childParameters = setRailTemplateParameter(id, childParameters, "laneSpacingMeters", 8);
			if (id === "nested-bay") {
				childParameters = setRailTemplateParameter(id, childParameters, "offsetMeters", 4);
			}
			const child = planRailTemplate(
				document.map,
				id,
				{ x: 0, y: 0 },
				initialRailTemplatePose(),
				childParameters,
			);
			const evaluation = new RailDraftEvaluator().evaluate(
				document.map,
				compilePhysicalRail(document.map),
				child,
			);
			expect(child.newEdges, `${id}: ${child.reason}`).toBeGreaterThan(0);
			expect(child.newEdges, id).toBeLessThan(parent.newEdges);
			expect(evaluation.valid, `${id}: ${evaluation.reason}`).toBe(true);
			expect(document.commit(evaluation.plan), id).toBe(true);
			expect(analyzeRailNetwork(document.map), id).toMatchObject({
				status: "closed",
				components: 1,
				strongComponents: 1,
				openEnds: 0,
			});
		}
	});

	it("keeps every long-Bay constituent editable with ordinary semantic tools", () => {
		const document = new RailDocument();
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			longBayParameters(16, 6),
		);
		expect(document.commit(plan)).toBe(true);
		const before = checksumRailMap(document.map);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		expect(ownership.modules.length).toBeGreaterThan(4);
		const straight = ownership.modules.find((module) => module.kind === "straight");
		if (!straight) throw new Error("Expected a selectable straight module in the Bay template.");

		const bulldoze = planRailModuleBulldoze(document.map, straight);
		expect(bulldoze.valid, bulldoze.reason).toBe(true);
		expect(document.commit(bulldoze)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("open");
		expect(document.undo()).toBe(true);
		expect(checksumRailMap(document.map)).toBe(before);
	});

	it("preserves a full invalid ghost and explains incompatible anchors", () => {
		const wrongDirection = documentEndingAt(DIR_E);
		const returnLoop = planRailTemplate(
			wrongDirection.map,
			"return-loop",
			{ x: 0, y: 0 },
			{ forward: oppositeDirection(DIR_E), side: "right" },
			returnLoopParameters(8, 4),
		);
		expect(returnLoop.valid).toBe(false);
		expect(returnLoop.reason).toMatch(/진행 방향/);
		expect(returnLoop.cells.length).toBeGreaterThan(10);
		expect(returnLoop.template.hardReservedCells.length).toBeGreaterThan(10);

		const nonEmpty = directedTrunk(DIR_E, 20);
		const bay = planRailTemplate(
			nonEmpty.map,
			"long-bay",
			{ x: 40, y: 40 },
			initialRailTemplatePose(),
			longBayParameters(16, 6),
		);
		expect(bay.valid, bay.reason).toBe(true);
		expect(bay.template.hardReservedCells).toHaveLength(44);

		const brokenTrunk = directedTrunk(DIR_E, 8);
		const bypass = planRailTemplate(
			brokenTrunk.map,
			"branch-bypass",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			bypassParameters(12, 4),
		);
		expect(bypass.valid).toBe(false);
		expect(bypass.reason).toMatch(/직선 본선/);
		expect(bypass.conflicts.length).toBeGreaterThan(0);
	});

	it("rejects unsafe numeric coordinates and non-finite parameters before worker encoding", () => {
		const document = new RailDocument();
		const fractional = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0.5, y: 0 },
			initialRailTemplatePose(),
			longBayParameters(16, 6),
		);
		expect(fractional.valid).toBe(false);
		expect(fractional.reason).toMatch(/32-bit integer/);
		expect(fractional.cells).toEqual([{ x: 0, y: 0 }]);

		const overflow = planRailTemplate(
			document.map,
			"return-loop",
			{ x: 2_147_483_647, y: 0 },
			initialRailTemplatePose(),
			returnLoopParameters(8, 4),
		);
		expect(overflow.valid).toBe(false);
		expect(overflow.reason).toMatch(/32-bit integer/);
		expect(
			overflow.cells.every(
				(cell) => Number.isInteger(cell.x) && cell.x >= -2_147_483_648 && cell.x <= 2_147_483_647,
			),
		).toBe(true);

		const invalidParameters = {
			...longBayParameters(16, 6),
			aisleLengthMeters: Number.NaN,
		} as LongBayTemplateParameters;
		const invalidDimension = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			invalidParameters,
		);
		expect(invalidDimension.valid).toBe(false);
		expect(invalidDimension.reason).toMatch(/정수/);
		expect(() =>
			setRailTemplateParameter(
				"long-bay",
				longBayParameters(16, 6),
				"aisleLengthMeters",
				Number.NaN,
			),
		).toThrow(/finite/);
	});

	it("rotates a template pose by exact quarter turns without changing parameters", () => {
		const initial = initialRailTemplatePose();
		let pose = initial;
		for (const forward of [DIR_E, DIR_S, DIR_W, DIR_N] as const) {
			expect(pose.forward).toBe(forward);
			pose = rotateRailTemplatePose(pose, 1);
		}
		expect(pose).toEqual(initial);
	});
});

function returnLoopParameters(
	runLengthMeters: number,
	laneSpacingMeters: number,
): ReturnLoopTemplateParameters {
	return Object.freeze({
		templateId: "return-loop",
		runLengthMeters,
		laneSpacingMeters,
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
	});
}

function bypassParameters(
	trunkSpanMeters: number,
	offsetMeters: number,
): BranchBypassTemplateParameters {
	return Object.freeze({
		templateId: "branch-bypass",
		trunkSpanMeters,
		offsetMeters,
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
	});
}

function longBayParameters(
	aisleLengthMeters: number,
	laneSpacingMeters: number,
): LongBayTemplateParameters {
	return Object.freeze({
		templateId: "long-bay",
		aisleLengthMeters,
		laneSpacingMeters,
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
	});
}

function templateParametersAt(
	id: RailTemplateId,
	variant: "minimum" | "default" | "maximum",
): RailTemplateParameters {
	let parameters = defaultRailTemplateParameters(id);
	for (const descriptor of railTemplateCatalogItem(id).parameters) {
		const value =
			variant === "minimum"
				? descriptor.minimum
				: variant === "maximum"
					? descriptor.maximum
					: descriptor.defaultValue;
		parameters = setRailTemplateParameter(id, parameters, descriptor.key, value);
	}
	return parameters;
}

function documentEndingAt(forward: Direction): RailDocument {
	const document = new RailDocument();
	const start = moveRepeated({ x: 0, y: 0 }, oppositeDirection(forward), 3);
	expect(document.commit(planRailConstruction(document.map, start, { x: 0, y: 0 }))).toBe(true);
	return document;
}

function directedTrunk(forward: Direction, forwardLength: number): RailDocument {
	const document = new RailDocument();
	const anchor = { x: 0, y: 0 };
	const start = moveRepeated(anchor, oppositeDirection(forward), 3);
	const end = moveRepeated(anchor, forward, forwardLength);
	expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	return document;
}

function moveRepeated(cell: Cell, direction: Direction, distance: number): Cell {
	let result = cell;
	for (let index = 0; index < distance; index++) result = moveCell(result, direction);
	return result;
}
