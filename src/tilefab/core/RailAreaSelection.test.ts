import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { planRailConstruction } from "./paint";
import {
	createEmptyRailAreaSelection,
	createRailAreaSelection,
	createRailAreaSelectionFromOwnerships,
	normalizeRailAreaSelectionBounds,
	planRailAreaBulldoze,
	type RailAreaSelection,
	subtractRailAreaSelections,
	unionRailAreaSelections,
} from "./RailAreaSelection";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import { ALL_DIRECTIONS, moveCell } from "./railShape";
import type { Cell } from "./TileMap";

describe("RailAreaSelection", () => {
	it("creates a frozen revision-bound empty envelope for equipment-only selection", () => {
		const document = linearDocument(0, 5);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createEmptyRailAreaSelection(index, { x: 2, y: -3 });

		expect(selection).toEqual({
			revision: document.map.getRevision(),
			bounds: { minX: 2, minY: -3, maxX: 2, maxY: -3 },
			mode: "intersect",
			ownerships: [],
		});
		expect(Object.isFrozen(selection)).toBe(true);
		expect(Object.isFrozen(selection.bounds)).toBe(true);
		expect(Object.isFrozen(selection.ownerships)).toBe(true);
	});

	it("normalizes integer drag bounds and distinguishes intersect from fully-contained ownership", () => {
		const document = linearDocument(0, 13);
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = straightModules(index.modules);
		expect(straight).toHaveLength(3);

		const intersect = createRailAreaSelection(index, { x: 10, y: 0 }, { x: 5, y: 0 }, "intersect");
		expect(intersect.bounds).toEqual({ minX: 5, minY: 0, maxX: 10, maxY: 0 });
		expect(intersect.ownerships.map((ownership) => ownership.key)).toEqual(
			straight.map((ownership) => ownership.key),
		);

		const contained = createRailAreaSelection(
			index,
			{ x: 10, y: 0 },
			{ x: 5, y: 0 },
			"fully-contained",
		);
		expect(contained.ownerships.map((ownership) => ownership.key)).toEqual([
			(straight[1] as RailModuleOwnership).key,
		]);
		expect(Object.isFrozen(contained)).toBe(true);
		expect(Object.isFrozen(contained.bounds)).toBe(true);
		expect(Object.isFrozen(contained.ownerships)).toBe(true);

		const huge = createRailAreaSelection(
			index,
			{ x: 1_000_000_000, y: 1_000_000_000 },
			{ x: -1_000_000_000, y: -1_000_000_000 },
			"fully-contained",
		);
		expect(huge.ownerships).toHaveLength(3);
		expect(() => normalizeRailAreaSelectionBounds({ x: 0.5, y: 0 }, { x: 1, y: 1 })).toThrow(
			/safe integer/,
		);
	});

	it("removes one contained module while preserving every unselected boundary edge", () => {
		const document = linearDocument(0, 13);
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = straightModules(index.modules);
		const selected = straight[1] as RailModuleOwnership;
		const preservedEdges = [straight[0], straight[2]].flatMap(
			(ownership) => ownership?.eraseEdges ?? [],
		);
		const selection = createRailAreaSelection(
			index,
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
			"fully-contained",
		);

		const plan = planRailAreaBulldoze(document.map, index, selection);

		expect(plan.valid, plan.reason).toBe(true);
		expect(selection.ownerships).toEqual([selected]);
		expect(document.commit(plan)).toBe(true);
		for (const edge of preservedEdges) expect(hasDirectedEdge(document, edge)).toBe(true);
		for (const edge of selected.eraseEdges) expect(hasDirectedEdge(document, edge)).toBe(false);
	});

	it("adds repeated semantic drags without duplicating modules", () => {
		const document = linearDocument(0, 18);
		const index = buildRailModuleOwnershipIndex(document.map);
		const first = createRailAreaSelection(index, { x: 0, y: 0 }, { x: 7, y: 0 });
		const overlapping = createRailAreaSelection(index, { x: 5, y: 0 }, { x: 13, y: 0 });
		const disjoint = createRailAreaSelection(index, { x: 15, y: 0 }, { x: 18, y: 0 });

		const combined = unionRailAreaSelections(unionRailAreaSelections(first, overlapping), disjoint);

		expect(combined.bounds).toEqual({ minX: 0, minY: 0, maxX: 18, maxY: 0 });
		expect(combined.ownerships.map((ownership) => ownership.key)).toEqual(
			[
				...new Set(
					[...first.ownerships, ...overlapping.ownerships, ...disjoint.ownerships].map(
						(ownership) => ownership.key,
					),
				),
			].sort(),
		);
		expect(Object.isFrozen(combined)).toBe(true);
		expect(Object.isFrozen(combined.bounds)).toBe(true);
		expect(Object.isFrozen(combined.ownerships)).toBe(true);
	});

	it("creates an exact nonrectangular selection from validated ownership membership", () => {
		const document = linearDocument(0, 18);
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = straightModules(index.modules);
		const exact = createRailAreaSelectionFromOwnerships(index, [
			straight[0] as RailModuleOwnership,
			straight[2] as RailModuleOwnership,
		]);

		expect(exact.ownerships.map((ownership) => ownership.key)).toEqual(
			[(straight[0] as RailModuleOwnership).key, (straight[2] as RailModuleOwnership).key].sort(),
		);
		expect(exact.bounds.minX).toBe(0);
		expect(exact.bounds.maxX).toBeGreaterThanOrEqual(13);
		expect(() =>
			createRailAreaSelectionFromOwnerships(index, [
				straight[0] as RailModuleOwnership,
				straight[0] as RailModuleOwnership,
			]),
		).toThrow(/중복/);
	});

	it("rejects additive selections from different revisions", () => {
		const document = linearDocument(0, 8);
		const firstIndex = buildRailModuleOwnershipIndex(document.map);
		const first = createRailAreaSelection(firstIndex, { x: 0, y: 0 }, { x: 8, y: 0 });
		const extension = planRailConstruction(document.map, { x: 8, y: 0 }, { x: 9, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		expect(document.commit(extension)).toBe(true);
		const secondIndex = buildRailModuleOwnershipIndex(document.map);
		const second = createRailAreaSelection(secondIndex, { x: 0, y: 0 }, { x: 9, y: 0 });

		expect(() => unionRailAreaSelections(first, second)).toThrow(/revision/);
	});

	it("keeps the existing semantic selection when an additive drag hits empty space", () => {
		const document = linearDocument(0, 8);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selected = createRailAreaSelection(index, { x: 0, y: 0 }, { x: 8, y: 0 });
		const empty = createRailAreaSelection(index, { x: 20, y: 20 }, { x: 24, y: 24 });

		expect(unionRailAreaSelections(selected, empty)).toBe(selected);
	});

	it("subtracts complete modules and recomputes the surviving semantic bounds", () => {
		const document = linearDocument(0, 18);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selected = createRailAreaSelection(index, { x: 0, y: 0 }, { x: 18, y: 0 });
		const removed = createRailAreaSelection(
			index,
			{ x: 13, y: 0 },
			{ x: 18, y: 0 },
			"fully-contained",
		);

		const remaining = subtractRailAreaSelections(selected, removed);

		expect(remaining.ownerships.map((ownership) => ownership.key)).toEqual(
			selected.ownerships
				.filter((ownership) => !removed.ownerships.some((entry) => entry.key === ownership.key))
				.map((ownership) => ownership.key),
		);
		expect(remaining.bounds.minX).toBe(selected.bounds.minX);
		expect(remaining.bounds.maxX).toBeLessThan(selected.bounds.maxX);
		expect(Object.isFrozen(remaining)).toBe(true);
		expect(Object.isFrozen(remaining.bounds)).toBe(true);
		expect(Object.isFrozen(remaining.ownerships)).toBe(true);

		const empty = subtractRailAreaSelections(selected, selected);
		expect(empty.ownerships).toEqual([]);
		expect(empty.bounds).toEqual(selected.bounds);
	});

	it("rejects subtractive selections from another rail revision", () => {
		const document = linearDocument(0, 8);
		const firstIndex = buildRailModuleOwnershipIndex(document.map);
		const selected = createRailAreaSelection(firstIndex, { x: 0, y: 0 }, { x: 8, y: 0 });
		const extension = planRailConstruction(document.map, { x: 8, y: 0 }, { x: 9, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		expect(document.commit(extension)).toBe(true);
		const nextIndex = buildRailModuleOwnershipIndex(document.map);
		const incoming = createRailAreaSelection(nextIndex, { x: 0, y: 0 }, { x: 9, y: 0 });

		expect(() => subtractRailAreaSelections(selected, incoming)).toThrow(/revision/);
		const firstOwnership = selected.ownerships[0];
		if (!firstOwnership) throw new Error("Expected a selected rail module.");
		const malformed = Object.freeze({
			...selected,
			ownerships: Object.freeze([
				Object.freeze({ ...firstOwnership, revision: selected.revision + 1 }),
				...selected.ownerships.slice(1),
			]),
		}) satisfies RailAreaSelection;
		expect(() => subtractRailAreaSelections(malformed, selected)).toThrow(/revision/);
	});

	it("bulldozes multiple ordinary modules as one event with exact undo, redo, and mirror parity", () => {
		const document = linearDocument(0, 13);
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = straightModules(index.modules);
		const preserved = straight[2] as RailModuleOwnership;
		const selection = createRailAreaSelection(
			index,
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			"fully-contained",
		);
		expect(selection.ownerships).toHaveLength(2);

		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			mirror.applyPatch(event);
		});
		const originalChecksum = checksumRailMap(document.map);
		const plan = planRailAreaBulldoze(document.map, index, selection);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.switchMutations).toEqual([]);
		expect(document.commit(plan)).toBe(true);
		expect(events.map((event) => event.kind)).toEqual(["erase"]);
		expect(events[0]?.changes).toEqual(plan.mutations);
		for (const edge of preserved.eraseEdges) expect(hasDirectedEdge(document, edge)).toBe(true);
		expectMirrorParity(document, mirror);

		expect(document.undo()).toBe(true);
		expect(checksumRailMap(document.map)).toBe(originalChecksum);
		expect(events.map((event) => event.kind)).toEqual(["erase", "undo"]);
		expectMirrorParity(document, mirror);

		expect(document.redo()).toBe(true);
		expect(events.map((event) => event.kind)).toEqual(["erase", "undo", "redo"]);
		for (const edge of preserved.eraseEdges) expect(hasDirectedEdge(document, edge)).toBe(true);
		expectMirrorParity(document, mirror);
	});

	it("combines an advanced switch and an ordinary module in one sidecar-aware erase plan", () => {
		const document = linearDocument(-3, 0);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "D");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);
		const record = document.map.getAdvancedSwitch(switchPlan.switchRecord?.id ?? -1);
		if (!record) throw new Error("expected advanced switch");
		const geometry = deriveAdvancedSwitchGeometry(record);
		const geometryBounds = boundsOf(geometry.claimedCells);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createRailAreaSelection(
			index,
			{ x: -3, y: geometryBounds.minY },
			{ x: geometryBounds.maxX, y: geometryBounds.maxY },
			"fully-contained",
		);
		const selectedSwitch = selection.ownerships.find(
			(ownership) => ownership.kind === "advanced-switch",
		);
		const selectedOrdinary = selection.ownerships.filter(
			(ownership) => ownership.kind !== "advanced-switch",
		);
		expect(selectedSwitch?.advancedSwitchId).toBe(record.id);
		expect(selectedOrdinary.length).toBeGreaterThan(0);
		const preservedBoundary = { from: { x: -1, y: 0 }, to: { x: 0, y: 0 } };
		expect(hasDirectedEdge(document, preservedBoundary)).toBe(true);
		expect(
			selection.ownerships.some((ownership) =>
				ownership.eraseEdges.some((edge) => edgeKey(edge) === edgeKey(preservedBoundary)),
			),
		).toBe(false);

		const plan = planRailAreaBulldoze(document.map, index, selection);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.switchMutations).toEqual([{ id: record.id, before: record, after: null }]);
		expect(document.commit(plan)).toBe(true);
		expect(document.map.advancedSwitchCount).toBe(0);
		expect(hasDirectedEdge(document, preservedBoundary)).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitch(record.id)).toEqual(record);
		expect(document.redo()).toBe(true);
		expect(document.map.advancedSwitchCount).toBe(0);
		expect(hasDirectedEdge(document, preservedBoundary)).toBe(true);
	});

	it("rejects empty, duplicate, stale selection, and stale ownership indexes", () => {
		const document = linearDocument(0, 13);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createRailAreaSelection(
			index,
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
			"fully-contained",
		);
		const ownership = selection.ownerships[0] as RailModuleOwnership;
		const duplicate = {
			...selection,
			ownerships: [ownership, ownership],
		} satisfies RailAreaSelection;
		const empty = createRailAreaSelection(
			index,
			{ x: 100, y: 100 },
			{ x: 200, y: 200 },
			"intersect",
		);

		expect(planRailAreaBulldoze(document.map, index, duplicate)).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/중복/),
		});
		expect(planRailAreaBulldoze(document.map, index, empty)).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/선택되지/),
		});

		const extension = planRailConstruction(document.map, { x: 13, y: 0 }, { x: 14, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		expect(document.commit(extension)).toBe(true);
		const currentIndex = buildRailModuleOwnershipIndex(document.map);
		expect(planRailAreaBulldoze(document.map, currentIndex, selection)).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/오래되어/),
		});
		expect(planRailAreaBulldoze(document.map, index, selection)).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/인덱스.*오래되어/),
		});
	});
});

function linearDocument(fromX: number, toX: number): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: fromX, y: 0 }, { x: toX, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function straightModules(modules: readonly RailModuleOwnership[]): readonly RailModuleOwnership[] {
	return modules.filter((ownership) => ownership.kind === "straight");
}

function hasDirectedEdge(document: RailDocument, edge: DirectedRailEdge): boolean {
	const direction = ALL_DIRECTIONS.find((candidate) => {
		const moved = moveCell(edge.from, candidate);
		return moved.x === edge.to.x && moved.y === edge.to.y;
	});
	return direction
		? (document.map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0
		: false;
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function boundsOf(cells: readonly Cell[]): {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
} {
	return cells.reduce(
		(bounds, cell) => ({
			minX: Math.min(bounds.minX, cell.x),
			minY: Math.min(bounds.minY, cell.y),
			maxX: Math.max(bounds.maxX, cell.x),
			maxY: Math.max(bounds.maxY, cell.y),
		}),
		{
			minX: Number.POSITIVE_INFINITY,
			minY: Number.POSITIVE_INFINITY,
			maxX: Number.NEGATIVE_INFINITY,
			maxY: Number.NEGATIVE_INFINITY,
		},
	);
}

function expectMirrorParity(document: RailDocument, mirror: RailPatchMirror): void {
	expect(mirror.state).toMatchObject({
		sequence: document.getPatchSequence(),
		revision: document.map.getRevision(),
		checksum: checksumRailMap(document.map),
		cells: document.map.size,
		edges: document.map.edgeCount,
		switches: document.map.advancedSwitchCount,
	});
	expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
		checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
	);
}
