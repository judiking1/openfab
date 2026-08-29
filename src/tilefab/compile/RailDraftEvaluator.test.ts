import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { planOffsetStraight } from "../core/edit";
import { analyzeRailNetwork } from "../core/network";
import { createPortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction, planRailPath, type RailConstructionPlan } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { planRailModule } from "../core/RailModulePlanner";
import {
	deriveRailTemplateAttachmentGuide,
	type RailTemplateAttachmentGuideInterval,
	type RailTemplateAttachmentParameters,
} from "../core/RailTemplateAttachmentGuide";
import { defaultRailTemplateParameters, planRailTemplate } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_W } from "../core/railShape";
import { type Cell, TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { RAIL_CLEARANCE_PATH_IDENTITY_WIDTH } from "./RailClearanceValidator";
import { createTopologyOnlyRailDraftPreview, RailDraftEvaluator } from "./RailDraftEvaluator";
import { compileRailDraftPreparedArtifacts } from "./RailDraftPreparedArtifacts";
import { createRailProjectReadiness } from "./RailProjectReadiness";

describe("RailDraftEvaluator", () => {
	it("keeps factory-scale pointer previews explicitly provisional until exact commit evaluation", () => {
		const map = new TileMap();
		const plan = planRailConstruction(map, { x: 0, y: 0 }, { x: 8, y: 0 });

		const preview = createTopologyOnlyRailDraftPreview(map, plan);
		const exact = new RailDraftEvaluator().evaluate(map, compilePhysicalRail(map), plan);

		expect(preview).toMatchObject({
			validationLevel: "topology-only",
			topologyValid: true,
			valid: true,
			paths: null,
			envelopes: null,
		});
		expect(preview.reason).toContain("클릭 시 물리 간섭 최종 검사");
		expect(exact.validationLevel).toBe("exact");
		expect(exact.paths).not.toBeNull();
	});

	it("keeps default closed-Bay attachment snaps valid through physical clearance evaluation", () => {
		const attachmentPose = { forward: DIR_E, side: "left", flow: "forward" } as const;
		const expectedAnchors = {
			"attached-return": Array.from({ length: 17 }, (_, index) => ({ x: index + 2, y: 0 })),
			"branch-bypass": Array.from({ length: 9 }, (_, index) => ({ x: index + 2, y: 0 })),
			"outerbay-link": Array.from({ length: 3 }, (_, index) => ({ x: index + 2, y: 0 })),
		} as const;

		for (const templateId of ["attached-return", "branch-bypass", "outerbay-link"] as const) {
			const guideDocument = defaultLongBayDocument();
			const parameters = defaultRailTemplateParameters(
				templateId,
			) as RailTemplateAttachmentParameters;
			const guide = deriveRailTemplateAttachmentGuide(
				guideDocument.map,
				templateId,
				attachmentPose,
				parameters,
			);
			const anchors = guide.intervals
				.filter((interval) => interval.status === "compatible")
				.flatMap(intervalCells);
			expect(anchors, `${templateId} coarse anchors`).toEqual(expectedAnchors[templateId]);

			for (const anchor of anchors) {
				const document = defaultLongBayDocument();
				const committedLayout = compilePhysicalRail(document.map);
				const plan = planRailTemplate(document.map, templateId, anchor, attachmentPose, parameters);
				expect(plan.valid, `${templateId} planner ${anchor.x},${anchor.y}: ${plan.reason}`).toBe(
					true,
				);

				const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);
				expect(
					evaluation.valid,
					`${templateId} evaluator ${anchor.x},${anchor.y}: ${evaluation.reason}`,
				).toBe(true);
				expect(evaluation.issues).toEqual([]);
				expect(document.commit(plan), `${templateId} commit ${anchor.x},${anchor.y}`).toBe(true);

				const network = analyzeRailNetwork(document.map);
				const futureLayout = compilePhysicalRail(document.map);
				expect(network, `${templateId} topology ${anchor.x},${anchor.y}`).toMatchObject({
					status: "closed",
					stronglyConnected: true,
					components: 1,
					strongComponents: 1,
					openEnds: 0,
					junctions: 2,
				});
				expect(
					futureLayout.clearance.issues.count,
					`${templateId} full clearance ${anchor.x},${anchor.y}`,
				).toBe(0);
				expect(
					createRailProjectReadiness(network, futureLayout, checksumRailMap(document.map)),
					`${templateId} readiness ${anchor.x},${anchor.y}`,
				).toMatchObject({
					ready: true,
					summary: {
						closure: "closed",
						strongComponents: 1,
						physicalStrongComponents: 1,
						clearanceIssues: 0,
					},
				});
			}
		}
	});

	it("accepts an exact directed continuation at the committed path endpoint", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 });

		expect(plan.valid, plan.reason).toBe(true);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);

		expect(
			evaluation.valid,
			`${evaluation.reason}: ${JSON.stringify(
				evaluation.issues.map((issue) => ({
					source: issue.source,
					draftPathIndex: issue.draftPathIndex,
					otherPathIndex: issue.otherPathIndex,
					draftCell: issue.draftCell,
					otherCell: issue.otherCell,
				})),
			)}`,
		).toBe(true);
		expect(evaluation.topologyValid).toBe(true);
		expect(evaluation.issues).toEqual([]);
		expect(evaluation.paths?.pathCount).toBeGreaterThan(0);
		expect(evaluation.envelopes?.count).toBeGreaterThan(0);
	});

	it("accepts a tangent branch through interval-exact turnout clearance ownership", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const committedLayout = compilePhysicalRail(document.map);
		const plan = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 });

		expect(plan.valid, plan.reason).toBe(true);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);

		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(evaluation.issues).toEqual([]);
		const committed = new RailDocument();
		expect(
			committed.commit(planRailConstruction(committed.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(committed.commit(plan)).toBe(true);
		expect(compilePhysicalRail(committed.map).clearance.issues.count).toBe(0);
	});

	it("accepts branch and merge turnouts in every orthogonal orientation", () => {
		const forwardDirections = [
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: -1, y: 0 },
			{ x: 0, y: -1 },
		] as const;
		for (const forward of forwardDirections) {
			for (const sideSign of [-1, 1] as const) {
				const side = { x: -forward.y * sideSign, y: forward.x * sideSign };
				for (const kind of ["branch", "merge"] as const) {
					const document = new RailDocument();
					const main = planRailConstruction(
						document.map,
						{ x: -forward.x * 3, y: -forward.y * 3 },
						{ x: forward.x * 3, y: forward.y * 3 },
					);
					expect(document.commit(main), `${kind} main fixture`).toBe(true);
					const origin = { x: 0, y: 0 };
					const sideEnd = { x: side.x * 3, y: side.y * 3 };
					const plan =
						kind === "branch"
							? planRailConstruction(document.map, origin, sideEnd)
							: planRailConstruction(document.map, sideEnd, origin);
					const evaluation = new RailDraftEvaluator().evaluate(
						document.map,
						compilePhysicalRail(document.map),
						plan,
					);

					expect(plan.valid, `${kind} plan: ${plan.reason}`).toBe(true);
					expect(evaluation.valid, `${kind}: ${evaluation.reason}`).toBe(true);
					expect(document.commit(plan), `${kind} commit`).toBe(true);
					expect(compilePhysicalRail(document.map).clearance.issues.count).toBe(0);
				}
			}
		}
	});

	it("includes a connected committed compound's full coverage in a legal turnout draft", () => {
		const document = new RailDocument();
		const main = planRailPath(document.map, [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
			{ x: 4, y: 0 },
			{ x: 5, y: 0 },
			{ x: 5, y: 1 },
			{ x: 6, y: 1 },
			{ x: 7, y: 1 },
		]);
		expect(document.commit(main)).toBe(true);
		const committedLayout = compilePhysicalRail(document.map);
		expect(committedLayout.clearance.issues.count).toBe(0);
		const plan = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: -3 });

		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(evaluation.issues).toEqual([]);
		expect(document.commit(plan)).toBe(true);
		expect(compilePhysicalRail(document.map).clearance.issues.count).toBe(0);
	});

	it("rejects a turnout that directly consumes an abutting compound support", () => {
		const document = new RailDocument();
		const main = planRailPath(document.map, [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 1 },
			{ x: 5, y: 1 },
			{ x: 6, y: 1 },
		]);
		expect(document.commit(main)).toBe(true);
		const committedLayout = compilePhysicalRail(document.map);
		expect(committedLayout.clearance.issues.count).toBe(0);
		const plan = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: -3 });

		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid).toBe(false);
		expect(evaluation.issues.some((issue) => issue.source === "draft")).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(compilePhysicalRail(document.map).clearance.issues.count).toBeGreaterThan(0);
	});

	it("prepares one committed spatial index before multiple pointer drafts", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const evaluator = new RailDraftEvaluator();
		const shortDraft = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 });
		const longDraft = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });

		evaluator.prepare(committedLayout);
		expect(evaluator.getStats().committedIndexBuilds).toBe(1);
		expect(evaluator.getStats().committedAdjacencyBuilds).toBe(1);
		const shortEvaluation = evaluator.evaluate(document.map, committedLayout, shortDraft);
		expect(shortEvaluation.valid).toBe(true);
		expect(evaluator.evaluate(document.map, committedLayout, shortDraft)).toBe(shortEvaluation);
		expect(evaluator.evaluate(document.map, committedLayout, longDraft).valid).toBe(true);
		expect(evaluator.getStats()).toMatchObject({
			evaluations: 3,
			draftCompiles: 2,
			draftCacheHits: 1,
			committedBindings: 1,
			committedIndexBuilds: 1,
			committedAdjacencyBuilds: 1,
			committedRevision: document.map.getRevision(),
		});
	});

	it("binds Worker-prepared committed indexes without rebuilding their typed resources", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const artifacts = compileRailDraftPreparedArtifacts(committedLayout);
		const evaluator = new RailDraftEvaluator();
		const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 });

		evaluator.prepare(committedLayout, artifacts);
		expect(evaluator.evaluate(document.map, committedLayout, plan).valid).toBe(true);
		expect(evaluator.getStats()).toMatchObject({
			committedBindings: 1,
			committedIndexBuilds: 1,
			committedPreparedBindings: 1,
			committedAdjacencyBuilds: 0,
		});
	});

	it("adopts a validated empty CSR without rebuilding committed adjacency", () => {
		const document = new RailDocument();
		const committedLayout = compilePhysicalRail(document.map);
		const artifacts = compileRailDraftPreparedArtifacts(committedLayout);
		const evaluator = new RailDraftEvaluator();

		evaluator.prepare(committedLayout, artifacts);

		expect(artifacts.forwardAdjacency.offsets).toEqual(new Uint32Array([0]));
		expect(artifacts.forwardAdjacency.targets).toHaveLength(0);
		expect(artifacts.reverseAdjacency.offsets).toEqual(new Uint32Array([0]));
		expect(evaluator.getStats()).toMatchObject({
			committedPreparedBindings: 1,
			committedAdjacencyBuilds: 0,
		});
	});

	it("rebuilds adjacency when a prepared artifact has a malformed CSR boundary", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const prepared = compileRailDraftPreparedArtifacts(committedLayout);
		const evaluator = new RailDraftEvaluator();

		evaluator.prepare(committedLayout, {
			...prepared,
			reverseAdjacency: {
				offsets: new Uint32Array(0),
				targets: prepared.reverseAdjacency.targets,
			},
		});

		expect(evaluator.getStats()).toMatchObject({
			committedBindings: 1,
			committedPreparedBindings: 0,
			committedAdjacencyBuilds: 1,
		});
	});

	it("rejects a draft whose base revision is stale", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const stalePlan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 });
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 })),
		).toBe(true);
		const currentLayout = compilePhysicalRail(document.map);

		const evaluator = new RailDraftEvaluator();
		const evaluation = evaluator.evaluate(document.map, currentLayout, stalePlan);

		expect(evaluation.valid).toBe(false);
		expect(evaluation.stale).toBe(true);
		expect(evaluation.reason).toContain("만료");
		expect(evaluation.baseRevision).toBe(stalePlan.baseRevision);
		expect(evaluation.committedRevision).toBe(document.map.getRevision());
		expect(evaluation.paths).toBeNull();
		expect(evaluation.envelopes).toBeNull();
		expect(evaluation.issues).toEqual([]);
		expect(evaluator.getStats()).toMatchObject({
			evaluations: 1,
			draftCompiles: 0,
			staleRejects: 1,
			committedBindings: 0,
			committedIndexBuilds: 0,
		});
	});

	it("rejects a same-revision physical layout compiled from another map", () => {
		const horizontal = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const vertical = documentEndingAt({ x: 0, y: -3 }, { x: 0, y: 0 });
		expect(vertical.map.getRevision()).toBe(horizontal.map.getRevision());
		const plan = planRailConstruction(vertical.map, { x: 0, y: 0 }, { x: 0, y: 3 });
		const foreignLayout = compilePhysicalRail(horizontal.map);

		const evaluation = new RailDraftEvaluator().evaluate(vertical.map, foreignLayout, plan);

		expect(evaluation.valid).toBe(false);
		expect(evaluation.stale).toBe(true);
		expect(evaluation.failureCode).toBe("stale");
		expect(evaluation.reason).toContain("현재 레일 맵");
		expect(evaluation.paths).toBeNull();
	});

	it("retains topology conflict cells when a local physical draft can still compile", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const disconnected = planRailConstruction(document.map, { x: 20, y: 20 }, { x: 24, y: 20 });

		expect(disconnected.valid).toBe(false);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			committedLayout,
			disconnected,
		);

		expect(evaluation.valid).toBe(false);
		expect(evaluation.topologyValid).toBe(false);
		expect(evaluation.reason).toBe(disconnected.reason);
		for (const conflict of disconnected.conflicts) {
			expect(evaluation.conflictCells).toContainEqual(conflict);
		}
	});

	it("reports identities and exact conflict cells for a local proximity intrusion", () => {
		const document = new RailDocument();
		const committedPlan = planRailConstruction(
			document.map,
			{ x: -3, y: 0 },
			{ x: 0, y: 3 },
			"horizontal-first",
		);
		expect(document.commit(committedPlan)).toBe(true);
		const committedLayout = compilePhysicalRail(document.map);
		const isolatedMap = new TileMap();
		const isolatedPlan = planRailPath(isolatedMap, [
			{ x: -1, y: 1 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
		]);
		const localDraft: RailConstructionPlan = {
			...isolatedPlan,
			baseRevision: document.map.getRevision(),
		};

		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, localDraft);

		expect(localDraft.valid, localDraft.reason).toBe(true);
		expect(evaluation.valid).toBe(false);
		expect(evaluation.issues.length).toBeGreaterThan(0);
		expect(evaluation.issues.some((issue) => issue.source === "committed")).toBe(true);
		for (const issue of evaluation.issues) {
			expect(issue.draftIdentity).toHaveLength(RAIL_CLEARANCE_PATH_IDENTITY_WIDTH);
			expect(issue.otherIdentity).toHaveLength(RAIL_CLEARANCE_PATH_IDENTITY_WIDTH);
			expect(issue.penetrationDepth).toBeGreaterThan(0);
			expect(evaluation.conflictCells).toContainEqual(issue.draftCell);
			expect(evaluation.conflictCells).toContainEqual(issue.otherCell);
		}
	});

	it("compiles a valid fixed rail module through the shared clearance gate", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "u-turn", "compact");

		expect(plan.valid, plan.reason).toBe(true);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);

		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(evaluation.issues).toEqual([]);
		expect(evaluation.paths?.pathCount).toBeGreaterThan(0);
	});

	it("compiles a valid advanced switch through the shared clearance gate", () => {
		const document = documentEndingAt({ x: -3, y: 0 }, { x: 0, y: 0 });
		const committedLayout = compilePhysicalRail(document.map);
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "A");

		expect(plan.valid, plan.reason).toBe(true);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedLayout, plan);

		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(evaluation.issues).toEqual([]);
		expect(evaluation.paths?.pathCount).toBeGreaterThan(0);
	});

	it("keeps exact draft geometry but rejects an edit that would orphan a committed port", () => {
		const document = closedLoopDocument();
		const port: PortRecord = {
			id: 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x: 5, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: "OHB-001",
		};
		expect(
			document.commitPortEquipment(
				createPortEquipmentMutationPlan(
					"place-ohb",
					document.map.getRevision(),
					document.getPatchSequence(),
					[{ id: 1, before: null, after: port }],
					[
						{
							id: 1,
							before: null,
							after: { id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
						},
					],
				),
			),
		).toBe(true);
		const committedLayout = compilePhysicalRail(document.map);
		const plan = planOffsetStraight(document.map, { x: 5, y: 0 }, { x: 5, y: -2 });
		expect(plan.valid, plan.reason).toBe(true);

		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			committedLayout,
			plan,
			document.portEquipment,
		);

		expect(evaluation.valid).toBe(false);
		expect(evaluation.topologyValid).toBe(false);
		expect(evaluation.reason).toContain("PORT-1");
		expect(evaluation.invalidatedPortIds).toEqual([1]);
		expect(evaluation.conflictCells).toContainEqual({ x: 5, y: 0 });
		expect(evaluation.paths?.pathCount).toBeGreaterThan(0);
		expect(document.commit(plan)).toBe(false);
	});
});

function intervalCells(interval: RailTemplateAttachmentGuideInterval): Cell[] {
	const cells: Cell[] = [];
	const dx = Math.sign(interval.endAnchor.x - interval.startAnchor.x);
	const dy = Math.sign(interval.endAnchor.y - interval.startAnchor.y);
	for (let offset = 0; offset < interval.anchorCount; offset++) {
		cells.push({
			x: interval.startAnchor.x + dx * offset,
			y: interval.startAnchor.y + dy * offset,
		});
	}
	return cells;
}

function defaultLongBayDocument(): RailDocument {
	const document = new RailDocument();
	const parent = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		{ forward: DIR_E, side: "right", flow: "forward" },
		defaultRailTemplateParameters("long-bay"),
	);
	if (!parent.valid || !document.commit(parent)) {
		throw new Error(`default Long Bay fixture failed: ${parent.reason}`);
	}
	return document;
}

function documentEndingAt(start: Cell, end: Cell): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, start, end);
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`terminal fixture failed: ${plan.reason}`);
	}
	return document;
}

function closedLoopDocument(): RailDocument {
	const document = new RailDocument();
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		],
		[
			{ x: 10, y: 0 },
			{ x: 10, y: 8 },
		],
		[
			{ x: 10, y: 8 },
			{ x: 0, y: 8 },
		],
		[
			{ x: 0, y: 8 },
			{ x: 0, y: 0 },
		],
	] as const) {
		const plan = planRailConstruction(document.map, start, end);
		if (!plan.valid || !document.commit(plan))
			throw new Error(`loop fixture failed: ${plan.reason}`);
	}
	return document;
}
