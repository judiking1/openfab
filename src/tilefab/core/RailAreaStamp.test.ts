import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { analyzeRailNetwork } from "./network";
import { planRailConstruction, type RailMapReader } from "./paint";
import { createRailAreaSelection, type RailAreaSelection } from "./RailAreaSelection";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	isRailAreaStampPreviewPlan,
	planRailAreaStamp,
	planRailAreaStampPreview,
	prepareRailAreaStampPointerPlanning,
	RAIL_AREA_STAMP_MAX_EDGES,
	RAIL_AREA_STAMP_PREVIEW_MAX_CELLS,
	RailAreaStampAttachmentIndex,
	type RailAreaStampTemplate,
	railAreaStampPoseBounds,
	resolveRailAreaStampAttachmentIntent,
	reverseRailAreaStampFlow,
	rotateRailAreaStampPose,
	transformRailAreaStampTemplate,
} from "./RailAreaStamp";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
	type RailTemplateId,
} from "./RailTemplateCatalog";
import { DIR_N, DIR_S } from "./railShape";
import { TileMap } from "./TileMap";

describe("RailAreaStamp", () => {
	it("captures a complete closed Bay and duplicates it through one atomic document command", () => {
		const document = longBayDocument();
		const selection = selectWholeMap(document);
		const template = createRailAreaStampTemplate(selection);
		const events: Array<{ kind: string; changes: number }> = [];
		document.subscribe((event) => events.push({ kind: event.kind, changes: event.changes.length }));

		const plan = planRailAreaStamp(
			document.map,
			template,
			{ x: 100, y: 40 },
			initialRailAreaStampPose(),
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.areaStamp).toMatchObject({
			sourceModuleCount: selection.ownerships.length,
			sourceEdgeCount: template.sourceEdgeCount,
			quarterTurns: 0,
		});
		expect(document.commit(plan)).toBe(true);
		expect(events).toEqual([{ kind: "build", changes: plan.mutations.length }]);

		const duplicated = analyzeRailNetwork(document.map);
		expect(duplicated.components).toBe(2);
		expect(duplicated.strongComponents).toBe(2);
		expect(duplicated.openEnds).toBe(0);
		expect(document.undo()).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});
		expect(document.redo()).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 2,
			strongComponents: 2,
			openEnds: 0,
		});
	});

	it("rotates the exact selected graph in 90 degree steps and swaps its footprint dimensions", () => {
		const document = longBayDocument();
		const template = createRailAreaStampTemplate(selectWholeMap(document));
		const originalBounds = railAreaStampPoseBounds(template, initialRailAreaStampPose());
		const pose = rotateRailAreaStampPose(initialRailAreaStampPose(), 1);
		const rotatedBounds = railAreaStampPoseBounds(template, pose);
		const plan = planRailAreaStamp(document.map, template, { x: 100, y: 40 }, pose);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.areaStamp.quarterTurns).toBe(1);
		expect(rotatedBounds.maxX - rotatedBounds.minX).toBe(originalBounds.maxY - originalBounds.minY);
		expect(rotatedBounds.maxY - rotatedBounds.minY).toBe(originalBounds.maxX - originalBounds.minX);
		expect(plan.areaStamp.widthMeters).toBe(template.sourceHeightMeters);
		expect(plan.areaStamp.heightMeters).toBe(template.sourceWidthMeters);
		expect(plan.newEdges).toBe(template.sourceEdgeCount);
	});

	it("keeps cached pose coordinates isolated across all rotations, flow directions, and anchors", () => {
		const template = createRailAreaStampTemplate(selectWholeMap(longBayDocument()));
		const sourceBytes = JSON.stringify(template);
		let pose = initialRailAreaStampPose();
		for (let rotation = 0; rotation < 4; rotation++) {
			for (const oriented of [pose, reverseRailAreaStampFlow(pose)]) {
				const target = new RailDocument();
				const first = planRailAreaStamp(target.map, template, { x: -100, y: 40 }, oriented);
				const shifted = planRailAreaStamp(target.map, template, { x: 200, y: -60 }, oriented);
				expect(shifted.valid, shifted.reason).toBe(true);
				expect(shifted.mutations).toEqual(
					first.mutations.map((cell) => ({ ...cell, x: cell.x + 300, y: cell.y - 100 })),
				);
				expect(target.commit(first)).toBe(true);
				expect(analyzeRailNetwork(target.map)).toMatchObject({
					components: 1,
					strongComponents: 1,
					openEnds: 0,
				});
				expect(target.undo()).toBe(true);
				expect(
					planRailAreaStamp(target.map, template, { x: -100, y: 40 }, oriented).mutations,
				).toEqual(first.mutations);
			}
			pose = rotateRailAreaStampPose(pose, 1);
		}
		expect(JSON.stringify(template)).toBe(sourceBytes);
	});

	it("bounds factory-scale pointer previews and requires an exact plan before commit", () => {
		const edgeCount = RAIL_AREA_STAMP_PREVIEW_MAX_CELLS * 4;
		const template = Object.freeze({
			sourceRevision: 0,
			sourceModuleKeys: Object.freeze(["FACTORY"]),
			sourceModuleCount: 1,
			sourceEdgeCount: edgeCount,
			sourceWidthMeters: edgeCount,
			sourceHeightMeters: 0,
			edges: Object.freeze(
				Array.from({ length: edgeCount }, (_, x) =>
					Object.freeze({
						from: Object.freeze({ x, y: 0 }),
						to: Object.freeze({ x: x + 1, y: 0 }),
					}),
				),
			),
		}) satisfies RailAreaStampTemplate;
		const map = new TileMap();
		const anchor = { x: 100, y: -50 };
		const pose = initialRailAreaStampPose();

		const preview = planRailAreaStampPreview(map, template, anchor, pose);
		expect(isRailAreaStampPreviewPlan(preview)).toBe(true);
		expect(preview.areaStamp).toMatchObject({
			planningLevel: "coarse-preview",
			sourceEdgeCount: edgeCount,
			bounds: { minX: 100, minY: -50, maxX: 100 + edgeCount, maxY: -50 },
		});
		expect(preview.cells.length).toBeLessThanOrEqual(RAIL_AREA_STAMP_PREVIEW_MAX_CELLS);
		expect(preview.mutations.length).toBeLessThanOrEqual(RAIL_AREA_STAMP_PREVIEW_MAX_CELLS);

		const exact = planRailAreaStamp(map, template, anchor, pose);
		expect(isRailAreaStampPreviewPlan(exact)).toBe(false);
		expect(exact.areaStamp.planningLevel).toBe("exact");
		expect(exact.mutations.length).toBe(edgeCount + 1);
	});

	it("reverses every directed edge without changing the selected footprint", () => {
		const document = longBayDocument();
		const template = createRailAreaStampTemplate(selectWholeMap(document));
		const anchor = { x: 100, y: 40 };
		const forward = planRailAreaStamp(document.map, template, anchor, initialRailAreaStampPose());
		const reversed = planRailAreaStamp(
			document.map,
			template,
			anchor,
			reverseRailAreaStampFlow(initialRailAreaStampPose()),
		);

		expect(reversed.valid, reversed.reason).toBe(true);
		expect(reversed.areaStamp.reverseFlow).toBe(true);
		expect(reversed.cells).toEqual(forward.cells);
		expect(reversed.mutations).not.toEqual(forward.mutations);
		expect(document.commit(reversed)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 2,
			strongComponents: 2,
			openEnds: 0,
		});
	});

	it("bakes a rotated reverse-flow ghost into an origin-normalized portable template", () => {
		const template = createRailAreaStampTemplate(selectWholeMap(longBayDocument()));
		const pose = reverseRailAreaStampFlow(rotateRailAreaStampPose(initialRailAreaStampPose(), 1));
		const bounds = railAreaStampPoseBounds(template, pose);
		const posed = planRailAreaStamp(
			new TileMap(),
			template,
			{ x: -bounds.minX, y: -bounds.minY },
			pose,
		);
		const baked = transformRailAreaStampTemplate(template, pose);
		const restored = planRailAreaStamp(
			new TileMap(),
			baked,
			{ x: 0, y: 0 },
			initialRailAreaStampPose(),
		);

		expect(posed.valid, posed.reason).toBe(true);
		expect(restored.valid, restored.reason).toBe(true);
		expect(restored.mutations).toEqual(posed.mutations);
		expect(baked.sourceWidthMeters).toBe(template.sourceHeightMeters);
		expect(baked.sourceHeightMeters).toBe(template.sourceWidthMeters);
		expect(
			baked.edges.every(
				(edge) => edge.from.x >= 0 && edge.from.y >= 0 && edge.to.x >= 0 && edge.to.y >= 0,
			),
		).toBe(true);
	});

	it.each([
		"long-bay",
		"paired-bay",
		"nested-bay",
		"shift-bay",
		"interbay-spine",
		"outer-loop",
	] satisfies readonly RailTemplateId[])("captures and duplicates the complete %s catalog motif without provenance", (templateId) => {
		const document = templateDocument(templateId);
		const template = createRailAreaStampTemplate(selectWholeMap(document));
		const plan = planRailAreaStamp(
			document.map,
			template,
			{ x: 500, y: 500 },
			initialRailAreaStampPose(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const analysis = analyzeRailNetwork(document.map);
		expect(analysis.openEnds).toBe(0);
		expect(analysis.unsafeJunctions).toBe(0);
		expect(analysis.strongComponents).toBe(analysis.components);
	});

	it("rejects an exact duplicate without changing the source map", () => {
		const document = longBayDocument();
		const template = createRailAreaStampTemplate(selectWholeMap(document));
		const revision = document.map.getRevision();
		const plan = planRailAreaStamp(
			document.map,
			template,
			{ x: 0, y: 0 },
			initialRailAreaStampPose(),
		);

		expect(plan).toMatchObject({ valid: false, issueCode: "duplicate" });
		expect(plan.conflicts.length).toBeGreaterThan(0);
		expect(plan.mutations).toHaveLength(0);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);
		expect(evaluation.valid).toBe(false);
		expect(document.commit(plan)).toBe(false);
		expect(document.map.getRevision()).toBe(revision);
	});

	it("rejects transformed coordinates outside the exact integer grid", () => {
		const document = longBayDocument();
		const template = createRailAreaStampTemplate(selectWholeMap(document));

		expect(() =>
			planRailAreaStamp(
				document.map,
				template,
				{ x: Number.MAX_SAFE_INTEGER, y: 0 },
				initialRailAreaStampPose(),
			),
		).toThrow(/정수 그리드 셀/);
	});

	it("captures and places an open module subset without requiring a closed loop", () => {
		const document = longBayDocument();
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = index.modules.find((module) => module.kind === "straight");
		if (!straight) throw new Error("Expected a straight module.");
		const selection = Object.freeze({
			revision: index.revision,
			bounds: Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
			mode: "intersect",
			ownerships: Object.freeze([straight]),
		}) satisfies RailAreaSelection;

		const template = createRailAreaStampTemplate(selection);
		const plan = planRailAreaStamp(
			document.map,
			template,
			{ x: 100, y: 100 },
			initialRailAreaStampPose(),
		);

		expect(template.sourceModuleCount).toBe(1);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.newEdges).toBe(template.sourceEdgeCount);
	});

	it("joins an open blueprint to a compatible terminal and preserves one atomic command", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(
			true,
		);
		const template = createRailAreaStampTemplate(selectWholeMap(source));
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: -5, y: 0 }, { x: 0, y: 0 }))).toBe(
			true,
		);
		const beforeRevision = target.map.getRevision();
		const beforeSequence = target.getPatchSequence();
		const events: string[] = [];
		target.subscribe((event) => events.push(event.kind));

		const plan = planRailAreaStamp(
			target.map,
			template,
			{ x: 0, y: 0 },
			initialRailAreaStampPose(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.reason).toContain("연결");
		expect(target.commit(plan)).toBe(true);
		expect(target.map.getRevision()).toBeGreaterThan(beforeRevision);
		expect(target.getPatchSequence()).toBe(beforeSequence + 1);
		expect(events).toEqual(["build"]);
		expect(analyzeRailNetwork(target.map)).toMatchObject({
			components: 1,
			openEnds: 2,
			unsafeJunctions: 0,
		});
	});

	it("snaps an open blueprint boundary to the nearest compatible terminal and auto-rotates", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 4, y: 0 }))).toBe(
			true,
		);
		const template = createRailAreaStampTemplate(selectWholeMap(source));
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: 0, y: -4 }, { x: 0, y: 0 }))).toBe(
			true,
		);

		const intent = resolveRailAreaStampAttachmentIntent(
			target.map,
			[
				{ x: 0, y: -4 },
				{ x: 0, y: 0 },
			],
			template,
			initialRailAreaStampPose(),
			{ x: 0.5, y: 0.5 },
			1,
		);

		expect(intent).not.toBeNull();
		expect(intent?.connectionCell).toEqual({ x: 0, y: 0 });
		expect(intent?.pose.quarterTurns).toBe(1);
		const lockedIntent = resolveRailAreaStampAttachmentIntent(
			target.map,
			[
				{ x: 0, y: -4 },
				{ x: 0, y: 0 },
			],
			template,
			initialRailAreaStampPose(),
			{ x: 0.5, y: 0.5 },
			1,
			false,
		);
		expect(lockedIntent?.pose).toEqual({ quarterTurns: 0, reverseFlow: false });
		if (!intent) throw new Error("Expected an area stamp attachment intent.");
		const plan = planRailAreaStamp(target.map, template, intent.anchor, intent.pose);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.reason).toContain("연결");
	});

	it("extends a same-direction terminal from the packed readiness cell buffer", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 4, y: 0 }))).toBe(
			true,
		);
		const template = createRailAreaStampTemplate(selectWholeMap(source));
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: -4, y: 0 }, { x: 0, y: 0 }))).toBe(
			true,
		);

		const intent = resolveRailAreaStampAttachmentIntent(
			target.map,
			new Int32Array([-4, 0, 0, 0]),
			template,
			initialRailAreaStampPose(),
			{ x: 0.5, y: 0.5 },
			1,
		);

		expect(intent).toMatchObject({
			anchor: { x: 0, y: 0 },
			connectionCell: { x: 0, y: 0 },
			pose: { quarterTurns: 0, reverseFlow: false },
		});
		if (!intent) throw new Error("Expected a packed-terminal attachment intent.");
		const plan = planRailAreaStamp(target.map, template, intent.anchor, intent.pose);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.reason).toContain("연결");
	});

	it("indexes a large packed terminal buffer once and queries only nearby buckets", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 4, y: 0 }))).toBe(
			true,
		);
		const template = createRailAreaStampTemplate(selectWholeMap(source));
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: -4, y: 0 }, { x: 0, y: 0 }))).toBe(
			true,
		);
		const terminalCount = 4_097;
		const packed = new Int32Array(terminalCount * 2);
		for (let index = 0; index < terminalCount - 1; index++) {
			packed[index * 2] = 1_000 + index * 8;
			packed[index * 2 + 1] = 1_000;
		}
		packed[packed.length - 2] = 0;
		packed[packed.length - 1] = 0;
		const attachmentIndex = new RailAreaStampAttachmentIndex(target.map, packed);

		expect(attachmentIndex).toMatchObject({
			baseRevision: target.map.getRevision(),
			terminalCount,
		});
		expect(attachmentIndex.bucketCount).toBeGreaterThan(4_000);
		expect(attachmentIndex.matches(target.map, packed)).toBe(true);
		expect(attachmentIndex.nearby({ x: 0.5, y: 0.5 }, 1)).toEqual([
			{ cell: { x: 0, y: 0 }, distanceMeters: 0 },
		]);

		const intent = resolveRailAreaStampAttachmentIntent(
			target.map,
			attachmentIndex,
			template,
			initialRailAreaStampPose(),
			{ x: 0.5, y: 0.5 },
			1,
		);
		expect(intent).toMatchObject({
			anchor: { x: 0, y: 0 },
			connectionCell: { x: 0, y: 0 },
		});
	});

	it("keeps factory-scale attachment previews local until the exact commit check", () => {
		const edgeCount = RAIL_AREA_STAMP_PREVIEW_MAX_CELLS * 8;
		let templateEdgeReads = 0;
		const sourceEdges = Object.freeze(
			Array.from({ length: edgeCount }, (_, x) =>
				Object.freeze({
					from: Object.freeze({ x, y: 0 }),
					to: Object.freeze({ x: x + 1, y: 0 }),
				}),
			),
		);
		const edges = new Proxy(sourceEdges, {
			get(target, property, receiver) {
				if (typeof property === "string" && /^\d+$/.test(property)) templateEdgeReads++;
				return Reflect.get(target, property, receiver);
			},
		});
		const template = Object.freeze({
			sourceRevision: 0,
			sourceModuleKeys: Object.freeze(["FACTORY-LINE"]),
			sourceModuleCount: 1,
			sourceEdgeCount: edgeCount,
			sourceWidthMeters: edgeCount,
			sourceHeightMeters: 0,
			edges,
		}) satisfies RailAreaStampTemplate;
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: -4, y: 0 }, { x: 0, y: 0 }))).toBe(
			true,
		);
		let encodedReads = 0;
		const countedMap = Object.freeze({
			edgeCount: target.map.edgeCount,
			getRevision: () => target.map.getRevision(),
			getEncoded: (x: number, y: number) => {
				encodedReads++;
				return target.map.getEncoded(x, y);
			},
			getRail: (x: number, y: number) => target.map.getRail(x, y),
			hasRail: (x: number, y: number) => target.map.hasRail(x, y),
			getAdvancedSwitch: (id: number) => target.map.getAdvancedSwitch(id),
			getAdvancedSwitchOwningCell: (x: number, y: number) =>
				target.map.getAdvancedSwitchOwningCell(x, y),
		}) satisfies RailMapReader;
		const pose = initialRailAreaStampPose();
		prepareRailAreaStampPointerPlanning(template, pose);
		const preparedEdgeReads = templateEdgeReads;

		const intent = resolveRailAreaStampAttachmentIntent(
			countedMap,
			[{ x: 0, y: 0 }],
			template,
			pose,
			{ x: 0.5, y: 0.5 },
			1,
			true,
			"coarse-preview",
		);

		expect(intent).toMatchObject({
			anchor: { x: 0, y: 0 },
			connectionCell: { x: 0, y: 0 },
		});
		expect(encodedReads).toBeLessThan(32);
		planRailAreaStampPreview(countedMap, template, { x: 100, y: 100 }, pose);
		expect(templateEdgeReads).toBe(preparedEdgeReads);
		if (!intent) throw new Error("Expected a coarse factory attachment intent.");
		const exact = planRailAreaStamp(target.map, template, intent.anchor, intent.pose);
		expect(exact.valid, exact.reason).toBe(true);
		expect(exact.areaStamp.planningLevel).toBe("exact");
	});

	it("snaps a closed blueprint by overlapping a compatible same-direction linear seam", () => {
		const source = longBayDocument();
		const template = createRailAreaStampTemplate(selectWholeMap(source));
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: -40, y: 0 }, { x: 40, y: 0 }))).toBe(
			true,
		);

		const intent = resolveRailAreaStampAttachmentIntent(
			target.map,
			[],
			template,
			initialRailAreaStampPose(),
			{ x: 0, y: 0.5 },
			1,
		);

		expect(intent).not.toBeNull();
		if (!intent) throw new Error("Expected a closed area stamp seam attachment intent.");
		const plan = planRailAreaStamp(target.map, template, intent.anchor, intent.pose);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.reason).toContain("기존 레일");
		expect(plan.newEdges).toBeGreaterThan(0);
		expect(plan.newEdges).toBeLessThan(template.sourceEdgeCount);
		expect(target.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(target.map)).toMatchObject({
			components: 1,
			openEnds: 2,
			unsafeJunctions: 0,
		});
	});

	it("does not offer a closed seam candidate when the locked pose has no matching direction", () => {
		const template = rectangularLoopTemplate(8, 1);
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: 0, y: -10 }, { x: 0, y: 10 }))).toBe(
			true,
		);

		const intent = resolveRailAreaStampAttachmentIntent(
			target.map,
			[],
			template,
			initialRailAreaStampPose(),
			{ x: 0.5, y: 0 },
			1,
			false,
		);

		expect(intent).toBeNull();
	});

	it("samples a 20k-edge closed stamp once instead of crossing every target seam", () => {
		const source = rectangularLoopTemplate(9_999, 1);
		let edgeReads = 0;
		const edges = new Proxy(source.edges, {
			get(target, property, receiver) {
				if (typeof property === "string" && /^\d+$/.test(property)) edgeReads++;
				return Reflect.get(target, property, receiver);
			},
		});
		const template = Object.freeze({ ...source, edges }) satisfies RailAreaStampTemplate;
		const verticalTarget = Object.freeze({
			edgeCount: 1_000,
			getRevision: () => 1,
			getEncoded: () => 0,
			getRail: () => Object.freeze({ incoming: DIR_N, outgoing: DIR_S }),
			hasRail: () => true,
			getAdvancedSwitch: () => undefined,
			getAdvancedSwitchOwningCell: () => undefined,
		}) satisfies RailMapReader;

		const intent = resolveRailAreaStampAttachmentIntent(
			verticalTarget,
			[],
			template,
			initialRailAreaStampPose(),
			{ x: 0.5, y: 0.5 },
			4,
			false,
		);

		expect(intent).toBeNull();
		expect(edgeReads).toBeGreaterThanOrEqual(template.sourceEdgeCount);
		expect(edgeReads).toBeLessThanOrEqual(template.sourceEdgeCount * 3);
	});

	it("rejects selections containing advanced-switch sidecar ownership", () => {
		const document = longBayDocument();
		const selection = selectWholeMap(document);
		const first = selection.ownerships[0];
		if (!first) throw new Error("Expected selected ownership.");
		const corrupted = Object.freeze({
			...selection,
			ownerships: Object.freeze([
				Object.freeze({ ...first, kind: "advanced-switch", advancedSwitchId: 7 }),
			]),
		}) satisfies RailAreaSelection;

		expect(() => createRailAreaStampTemplate(corrupted)).toThrow(/고급 스위치/);
	});

	it("bounds synchronous capture before a whole-project selection can enter pointer planning", () => {
		const document = longBayDocument();
		const selection = selectWholeMap(document);
		const first = selection.ownerships[0];
		if (!first) throw new Error("Expected selected ownership.");
		const oversized = Object.freeze({
			...selection,
			ownerships: Object.freeze([
				Object.freeze({
					...first,
					key: "OVERSIZED",
					eraseEdges: Object.freeze(
						Array.from({ length: RAIL_AREA_STAMP_MAX_EDGES + 1 }, (_, x) =>
							Object.freeze({
								from: Object.freeze({ x, y: 0 }),
								to: Object.freeze({ x: x + 1, y: 0 }),
							}),
						),
					),
				}),
			]),
		}) satisfies RailAreaSelection;

		expect(() => createRailAreaStampTemplate(oversized)).toThrow(
			new RegExp(RAIL_AREA_STAMP_MAX_EDGES.toLocaleString()),
		);
	});
});

function longBayDocument(): RailDocument {
	return templateDocument("long-bay");
}

function templateDocument(templateId: RailTemplateId): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		templateId,
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters(templateId),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function selectWholeMap(document: RailDocument): RailAreaSelection {
	const index = buildRailModuleOwnershipIndex(document.map);
	const selection = createRailAreaSelection(index, { x: -10, y: -10 }, { x: 100, y: 100 });
	expect(selection.ownerships.length).toBeGreaterThan(0);
	return selection;
}

function rectangularLoopTemplate(width: number, height: number): RailAreaStampTemplate {
	const cells: Array<Readonly<{ x: number; y: number }>> = [];
	for (let x = 0; x <= width; x++) cells.push(Object.freeze({ x, y: 0 }));
	for (let y = 1; y <= height; y++) cells.push(Object.freeze({ x: width, y }));
	for (let x = width - 1; x >= 0; x--) cells.push(Object.freeze({ x, y: height }));
	for (let y = height - 1; y > 0; y--) cells.push(Object.freeze({ x: 0, y }));
	const edges = cells.map((from, index) =>
		Object.freeze({
			from,
			to: cells[(index + 1) % cells.length] as Readonly<{ x: number; y: number }>,
		}),
	);
	return Object.freeze({
		sourceRevision: 0,
		sourceModuleKeys: Object.freeze(["RECTANGULAR-LOOP"]),
		sourceModuleCount: 1,
		sourceEdgeCount: edges.length,
		sourceWidthMeters: width,
		sourceHeightMeters: height,
		edges: Object.freeze(edges),
	});
}
