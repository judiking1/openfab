import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { analyzeRailNetwork } from "./network";
import { planRailConstruction } from "./paint";
import { proposeOpenRailClosure, resolveRailClosureSnap } from "./RailClosureSnap";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { DIR_N, DIR_S } from "./railShape";
import { type Cell, encodeRailCell } from "./TileMap";

describe("RailClosureSnap", () => {
	it("snaps a chained route to a nearby compatible source terminal", () => {
		const events: RailPatchEvent[] = [];
		const document = openHairpin(events);
		const mirror = new RailPatchMirror();
		for (const event of events) mirror.applyPatch(event);
		const before = document.map.edgeCount;
		const snap = resolveRailClosureSnap(document.map, { x: 0, y: 4 }, { x: 1.12, y: 0.52 }, "auto");

		expect(snap?.cell).toEqual({ x: 0, y: 0 });
		expect(snap?.distanceMeters).toBeLessThan(0.82);
		expect(snap?.plan.valid, snap?.plan.reason).toBe(true);
		expect(snap?.plan.cells.at(-1)).toEqual({ x: 0, y: 0 });
		if (!snap) throw new Error("Expected a compatible closure snap.");
		expect(document.commit(snap.plan)).toBe(true);
		const closureEvent = events[3];
		if (!closureEvent) throw new Error("Expected one closure patch event.");
		expect(mirror.applyPatch(closureEvent)).toMatchObject({
			sequence: 4,
			checksum: checksumRailMap(document.map),
		});
		expect(document.map.edgeCount).toBeGreaterThan(before);
		expect(readinessFor(document)).toMatchObject({
			ready: true,
			summary: { strongComponents: 1, physicalStrongComponents: 1, openTerminals: 0 },
		});
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
		const closedChecksum = checksumRailMap(document.map);
		expect(document.undo()).toBe(true);
		const undoEvent = events[4];
		if (!undoEvent) throw new Error("Expected one closure undo event.");
		expect(mirror.applyPatch(undoEvent)).toMatchObject({
			sequence: 5,
			checksum: checksumRailMap(document.map),
		});
		expect(document.map.edgeCount).toBe(before);
		expect(readinessFor(document).ready).toBe(false);
		expect(document.redo()).toBe(true);
		const redoEvent = events[5];
		if (!redoEvent) throw new Error("Expected one closure redo event.");
		expect(mirror.applyPatch(redoEvent)).toMatchObject({ sequence: 6, checksum: closedChecksum });
		expect(document.map.getRail(0, 0).incoming).not.toBe(0);
		expect(readinessFor(document).ready).toBe(true);
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
	});

	it("does not snap beyond the bounded magnet radius", () => {
		const document = openHairpin();
		expect(
			resolveRailClosureSnap(document.map, { x: 0, y: 4 }, { x: 1.4, y: 0.5 }, "auto"),
		).toBeNull();
	});

	it("rejects a reverse overlap even when the source terminal is nearby", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);

		expect(
			resolveRailClosureSnap(document.map, { x: 5, y: 0 }, { x: 0.52, y: 0.51 }, "auto"),
		).toBeNull();
	});

	it("only activates from the current directed sink terminal", () => {
		const document = openHairpin();
		expect(
			resolveRailClosureSnap(document.map, { x: 3, y: 0 }, { x: 0.52, y: 0.51 }, "auto"),
		).toBeNull();
	});
});

describe("explicit open rail closure", () => {
	it("previews without editing, then closes in one mirrored Undo/Redo command", () => {
		const events: RailPatchEvent[] = [];
		const document = openHairpin(events);
		const before = checksumRailMap(document.map);
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(proposal.target).toEqual({ x: 0, y: 0 });
		expect(events).toHaveLength(3);
		expect(checksumRailMap(document.map)).toBe(before);
		const plan = proposal.candidates[0];
		if (!plan) throw new Error("Missing closure");
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
			document.portEquipment,
		);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		const mirror = new RailPatchMirror();
		for (const event of events) mirror.applyPatch(event);
		expect(document.commit(plan)).toBe(true);
		expect(events).toHaveLength(4);
		mirror.applyPatch(events[3] as RailPatchEvent);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			openEnds: 0,
			components: 1,
			strongComponents: 1,
			junctions: 0,
		});
		const closed = checksumRailMap(document.map);
		expect(document.organizations.records).toHaveLength(0);
		expect(document.undo()).toBe(true);
		mirror.applyPatch(events[4] as RailPatchEvent);
		expect(checksumRailMap(document.map)).toBe(before);
		expect(document.redo()).toBe(true);
		expect(mirror.applyPatch(events[5] as RailPatchEvent).checksum).toBe(closed);
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
	});

	it("leaves authored data and history unchanged when a preview is discarded", () => {
		const document = openHairpin();
		const before = checksumRailMap(document.map);
		const history = document.captureRailMirrorHistoryLedger();
		proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(checksumRailMap(document.map)).toBe(before);
		expect(document.captureRailMirrorHistoryLedger()).toEqual(history);
		expect(document.getPatchSequence()).toBe(3);
	});

	it("uses this path's source even when another disconnected source is closer", () => {
		const document = openHairpin();
		appendSyntheticRail(document, { x: -2, y: 4 }, { x: -6, y: 4 });
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(proposal.target).toEqual({ x: 0, y: 0 });
		expect(proposal.candidates[0]?.valid).toBe(true);
	});

	it.each([
		{ x: 0, y: 0 },
		{ x: 3, y: 0 },
		{ x: 99, y: 99 },
	])("rejects a non-sink selection %j", (cell) => {
		const proposal = proposeOpenRailClosure(openHairpin(), cell);
		expect(proposal.target).toBeNull();
		expect(proposal.candidates[0]).toMatchObject({ valid: false, conflicts: [cell] });
	});

	it.each(["branch", "merge", "broken"])("rejects a %s anywhere upstream", (kind) => {
		const document = openHairpin();
		const rail = document.map.getRail(3, 0);
		document.map.setEncoded(
			3,
			0,
			encodeRailCell({
				incoming: kind === "merge" ? rail.incoming | DIR_N : rail.incoming,
				outgoing: kind === "branch" ? rail.outgoing | DIR_S : kind === "broken" ? 0 : rail.outgoing,
			}),
		);
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(proposal.target).toBeNull();
		expect(proposal.candidates[0]).toMatchObject({ valid: false, conflicts: [{ x: 3, y: 0 }] });
	});

	it("rejects upstream organization ownership even when the selected sink is unowned", () => {
		const source = openHairpin();
		const module = buildRailModuleOwnershipIndex(source.map).modules.find(
			(item) =>
				item.kind === "straight" && item.primaryCells.some((cell) => cell.x === 3 && cell.y === 0),
		);
		if (!module) throw new Error("Missing synthetic straight module");
		const document = RailDocument.fromLoadedMap(source.map, 0, undefined, {
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA",
					name: "Synthetic ownership",
					membership: {
						railEdges: module.eraseEdges,
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		});
		expect(document.staticFabOrganizationOwnersForCell(0, 4)).toHaveLength(0);
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(proposal.candidates[0]?.valid).toBe(false);
		expect(proposal.candidates[0]?.reason).toContain("조직");
	});

	it("rejects a switch path without treating a switch output as an ordinary source", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "A");
		expect(document.commit(switchPlan), switchPlan.reason).toBe(true);
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 0 });
		expect(proposal.candidates[0]?.valid).toBe(false);
		expect(proposal.candidates[0]?.reason).toContain("스위치");
	});

	it("rejects an ordinary route that would share a third rail instead of making one cycle", () => {
		const document = openHairpin();
		appendSyntheticRail(document, { x: 0, y: 3 }, { x: 0, y: 1 });
		const ordinary = planRailConstruction(document.map, { x: 0, y: 4 }, { x: 0, y: 0 });
		expect(ordinary.valid, ordinary.reason).toBe(true);
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(proposal.candidates[0]?.valid).toBe(false);
		expect(proposal.candidates[0]?.reason).toContain("기존 레일");
		expect(proposal.candidates[0]?.conflicts).toContainEqual({ x: 0, y: 2 });
	});

	it("retains both bends for final physical evaluation", () => {
		const document = new RailDocument();
		const points = [
			{ x: -4, y: 0 },
			{ x: -4, y: -4 },
			{ x: 8, y: -4 },
			{ x: 8, y: 4 },
			{ x: 0, y: 4 },
		];
		for (let i = 1; i < points.length; i++)
			expect(
				document.commit(
					planRailConstruction(document.map, points[i - 1] as Cell, points[i] as Cell),
				),
			).toBe(true);
		const proposal = proposeOpenRailClosure(document, { x: 0, y: 4 });
		expect(proposal.candidates.map((plan) => plan.bend)).toEqual([
			"horizontal-first",
			"vertical-first",
		]);
		const physical = compilePhysicalRail(document.map);
		const evaluator = new RailDraftEvaluator();
		const evaluated = proposal.candidates.map((plan) =>
			evaluator.evaluate(document.map, physical, plan),
		);
		expect(evaluated.map((result) => result.valid)).toEqual([true, true]);
	});

	it("preserves reverse-direction rejection and rejects a stale proposed commit", () => {
		const line = new RailDocument();
		expect(line.commit(planRailConstruction(line.map, { x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(true);
		expect(proposeOpenRailClosure(line, { x: 5, y: 0 }).candidates[0]?.valid).toBe(false);
		const document = openHairpin();
		const plan = proposeOpenRailClosure(document, { x: 0, y: 4 }).candidates[0];
		if (!plan) throw new Error("Missing closure");
		expect(document.undo()).toBe(true);
		expect(document.commit(plan)).toBe(false);
	});
});

function appendSyntheticRail(document: RailDocument, start: Cell, end: Cell): void {
	// Independently authored disconnected fixtures bypass only the editor's placement admission.
	const plan = planRailConstruction(document.map, start, end);
	document.map.applyAtomicMutations(plan.mutations, []);
}

function openHairpin(events?: RailPatchEvent[]): RailDocument {
	const document = new RailDocument();
	if (events) document.subscribe((event) => events.push(event));
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
		],
		[
			{ x: 6, y: 0 },
			{ x: 6, y: 4 },
		],
		[
			{ x: 6, y: 4 },
			{ x: 0, y: 4 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	}
	return document;
}

function readinessFor(document: RailDocument) {
	return createRailProjectReadiness(
		analyzeRailNetwork(document.map),
		compilePhysicalRail(document.map),
		checksumRailMap(document.map),
	);
}
