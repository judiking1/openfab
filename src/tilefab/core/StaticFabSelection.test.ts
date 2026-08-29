import { describe, expect, it } from "vitest";
import type { EquipmentGroupRecord, PortEquipmentState } from "./EquipmentGroup";
import type { PortRecord } from "./PortRecord";
import { createRailAreaSelection } from "./RailAreaSelection";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_W, type Direction, oppositeDirection } from "./railShape";
import {
	createStaticFabSelection,
	planStaticFabSelectionErase,
	staticFabSelectionPortCount,
	staticFabSelectionStaleReason,
	subtractStaticFabSelections,
	unionStaticFabSelections,
} from "./StaticFabSelection";

describe("StaticFabSelection", () => {
	it("snapshots complete EQ and STK groups, then unions an additive OHB selection", () => {
		const document = longBayDocument();
		const state = mixedEquipmentState(document);
		const rail = selectWholeMap(document);

		const equipmentOnly = createStaticFabSelection(rail, state, 7, [2, 3]);
		expect(equipmentOnly.equipmentGroups.map((selected) => selected.group.id)).toEqual([2, 3]);
		expect(equipmentOnly.equipmentGroups[0]?.ports.map((port) => port.id)).toEqual([2, 3]);
		expect(equipmentOnly.equipmentGroups[1]?.ports.map((port) => port.id)).toEqual([4, 5, 6, 7]);
		expect(staticFabSelectionPortCount(equipmentOnly)).toBe(6);

		const additive = createStaticFabSelection(rail, state, 7, [1]);
		const union = unionStaticFabSelections(equipmentOnly, additive);
		expect(union.equipmentGroups.map((selected) => selected.group.id)).toEqual([1, 2, 3]);
		expect(staticFabSelectionPortCount(union)).toBe(7);

		const sourceEqPort = state.ports.find((port) => port.id === 2);
		if (!sourceEqPort) throw new Error("Expected EQ fixture port.");
		expect(union.equipmentGroups[1]?.ports[0]).not.toBe(sourceEqPort);
		expect(Object.isFrozen(union.equipmentGroups[1]?.ports[0])).toBe(true);
	});

	it("treats a port-only patch-sequence change as stale even when the rail revision is unchanged", () => {
		const document = longBayDocument();
		const state = mixedEquipmentState(document);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(index, { x: -20, y: -20 }, { x: 80, y: 80 }),
			state,
			11,
			[2, 3],
		);

		expect(staticFabSelectionStaleReason(document.map, index, state, 11, selection)).toBeNull();
		expect(staticFabSelectionStaleReason(document.map, index, state, 12, selection)).toContain(
			"다시 선택",
		);
	});

	it("subtracts complete rail modules and equipment groups without partial records", () => {
		const document = longBayDocument();
		const state = mixedEquipmentState(document);
		const index = buildRailModuleOwnershipIndex(document.map);
		const current = createStaticFabSelection(selectWholeMap(document), state, 7, [1, 2, 3]);
		const removedRail = createRailAreaSelection(
			index,
			{ x: current.rail.bounds.minX, y: current.rail.bounds.minY },
			{
				x: Math.floor((current.rail.bounds.minX + current.rail.bounds.maxX) / 2),
				y: current.rail.bounds.maxY,
			},
			"fully-contained",
		);
		const removed = createStaticFabSelection(removedRail, state, 7, [2]);

		const remaining = subtractStaticFabSelections(current, removed);

		expect(remaining).not.toBeNull();
		expect(remaining?.rail.ownerships.length).toBeLessThan(current.rail.ownerships.length);
		expect(remaining?.equipmentGroups.map((selected) => selected.group.id)).toEqual([1, 3]);
		expect(remaining?.equipmentGroups[1]?.ports).toHaveLength(4);
		expect(Object.isFrozen(remaining)).toBe(true);
		const equipmentOnly = subtractStaticFabSelections(
			current,
			createStaticFabSelection(current.rail, state, 7, []),
		);
		if (!equipmentOnly) throw new Error("Expected an equipment-only static FAB selection.");
		expect(equipmentOnly.rail.ownerships).toEqual([]);
		expect(equipmentOnly.equipmentGroups.map((selected) => selected.group.id)).toEqual([1, 2, 3]);
		expect(staticFabSelectionPortCount(equipmentOnly)).toBe(7);
		expect(subtractStaticFabSelections(current, current)).toBeNull();
		expect(() =>
			subtractStaticFabSelections(
				Object.freeze({ ...current, baseRevision: current.baseRevision + 1 }),
				removed,
			),
		).toThrow(/revision/);
	});

	it("erases selected rail and complete equipment groups as one undoable command", () => {
		const source = longBayDocument();
		const document = RailDocument.fromLoadedMap(source.map.clone(), 7, mixedEquipmentState(source));
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(index, { x: -20, y: -20 }, { x: 80, y: 80 }),
			document.portEquipment,
			document.getPatchSequence(),
			[1, 2, 3],
		);
		const events: Array<{ kind: string; ports: number; groups: number }> = [];
		document.subscribe((event) =>
			events.push({
				kind: event.kind,
				ports: event.portChanges.length,
				groups: event.equipmentGroupChanges.length,
			}),
		);

		const plan = planStaticFabSelectionErase(
			document.map,
			index,
			document.portEquipment,
			document.getPatchSequence(),
			selection,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitStaticFab(plan)).toBe(true);
		expect(document.map.edgeCount).toBe(0);
		expect(document.portEquipment.ports).toEqual([]);
		expect(document.portEquipment.equipmentGroups).toEqual([]);
		expect(events).toEqual([{ kind: "erase-static-fab-selection", ports: 7, groups: 3 }]);

		expect(document.undo()).toBe(true);
		expect(document.map.edgeCount).toBeGreaterThan(0);
		expect(document.portEquipment.ports).toHaveLength(7);
		expect(document.portEquipment.equipmentGroups).toHaveLength(3);
		expect(document.redo()).toBe(true);
		expect(document.map.edgeCount).toBe(0);
		expect(document.portEquipment.ports).toEqual([]);
	});

	it("erases an equipment-only marquee without requiring a rail module", () => {
		const source = longBayDocument();
		const document = RailDocument.fromLoadedMap(source.map.clone(), 7, mixedEquipmentState(source));
		const index = buildRailModuleOwnershipIndex(document.map);
		const railSelection = createRailAreaSelection(index, { x: 500, y: 500 }, { x: 501, y: 501 });
		expect(railSelection.ownerships).toEqual([]);
		const selection = createStaticFabSelection(
			railSelection,
			document.portEquipment,
			document.getPatchSequence(),
			[1],
		);
		const beforeEdges = document.map.edgeCount;

		const plan = planStaticFabSelectionErase(
			document.map,
			index,
			document.portEquipment,
			document.getPatchSequence(),
			selection,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.mutations).toEqual([]);
		expect(document.commitStaticFab(plan)).toBe(true);
		expect(document.map.edgeCount).toBe(beforeEdges);
		expect(document.portEquipment.equipmentGroups.map((group) => group.id)).toEqual([2, 3]);
		expect(document.portEquipment.ports.map((port) => port.id)).toEqual([2, 3, 4, 5, 6, 7]);

		expect(document.undo()).toBe(true);
		expect(document.map.edgeCount).toBe(beforeEdges);
		expect(document.portEquipment.equipmentGroups.map((group) => group.id)).toEqual([1, 2, 3]);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.equipmentGroups.map((group) => group.id)).toEqual([2, 3]);
	});

	it("blocks rail erasure when an unselected equipment group would lose its support route", () => {
		const source = longBayDocument();
		const state = mixedEquipmentState(source);
		const document = RailDocument.fromLoadedMap(source.map.clone(), 7, state);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(index, { x: -20, y: -20 }, { x: 80, y: 80 }),
			document.portEquipment,
			document.getPatchSequence(),
			[1],
		);

		const plan = planStaticFabSelectionErase(
			document.map,
			index,
			document.portEquipment,
			document.getPatchSequence(),
			selection,
		);
		expect(plan.valid).toBe(false);
		expect(plan.reason).toMatch(/PORT|port|route|레일/);
		expect(document.commitStaticFab(plan)).toBe(false);
		expect(document.map.edgeCount).toBeGreaterThan(0);
		expect(document.portEquipment.ports).toHaveLength(7);
	});
});

function longBayDocument(): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function selectWholeMap(document: RailDocument) {
	return createRailAreaSelection(
		buildRailModuleOwnershipIndex(document.map),
		{ x: -20, y: -20 },
		{ x: 80, y: 80 },
	);
}

function mixedEquipmentState(document: RailDocument): PortEquipmentState {
	const runs = straightRuns(document).filter((run) => run.length >= 4);
	if (runs.length < 3) throw new Error("Long Bay fixture needs three straight rail runs.");
	const [ohbRun, eqRun, stkRun] = runs;
	if (!ohbRun || !eqRun || !stkRun) throw new Error("Expected fixture rail runs.");
	const ports: PortRecord[] = [
		port(1, 1, ohbRun[0] as RouteCell, "OHB", "LEFT", 700),
		port(2, 2, eqRun[0] as RouteCell, "EQ", "CENTER", 0),
		port(3, 2, eqRun[1] as RouteCell, "EQ", "CENTER", 0),
		...stkRun.slice(0, 4).map((route, index) => port(index + 4, 3, route, "STK", "CENTER", 0)),
	];
	const equipmentGroups: EquipmentGroupRecord[] = [
		{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
		{ id: 2, kind: "EQ", pitchMillimeters: 1_000, recipe: "PHOTO", portIds: [2, 3] },
		{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
	];
	return { nextPortId: 40, nextEquipmentGroupId: 20, ports, equipmentGroups };
}

interface RouteCell {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
}

function straightRuns(document: RailDocument): RouteCell[][] {
	const routes = new Map<string, RouteCell>();
	document.map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const from = rail.incoming as Direction;
		const to = rail.outgoing as Direction;
		routes.set(`${x}:${z}:${from}:${to}`, { x, z, from, to });
	});
	const visited = new Set<string>();
	const runs: RouteCell[][] = [];
	for (const route of routes.values()) {
		const key = `${route.x}:${route.z}:${route.from}:${route.to}`;
		if (visited.has(key)) continue;
		const backward = move(route, oppositeDirection(route.to));
		if (routes.has(`${backward.x}:${backward.z}:${route.from}:${route.to}`)) continue;
		const run: RouteCell[] = [];
		let current: RouteCell | undefined = route;
		while (current) {
			const currentKey = `${current.x}:${current.z}:${current.from}:${current.to}`;
			if (visited.has(currentKey)) break;
			visited.add(currentKey);
			run.push(current);
			const next = move(current, current.to);
			current = routes.get(`${next.x}:${next.z}:${current.from}:${current.to}`);
		}
		runs.push(run);
	}
	return runs.sort((left, right) => right.length - left.length);
}

function move(cell: Pick<RouteCell, "x" | "z">, direction: Direction): { x: number; z: number } {
	if (direction === DIR_E) return { x: cell.x + 1, z: cell.z };
	if (direction === DIR_W) return { x: cell.x - 1, z: cell.z };
	return direction === 1 ? { x: cell.x, z: cell.z - 1 } : { x: cell.x, z: cell.z + 1 };
}

function port(
	id: number,
	equipmentGroupId: number,
	route: RouteCell,
	portType: "OHB" | "EQ" | "STK",
	side: "LEFT" | "CENTER",
	lateralOffsetMillimeters: number,
): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", ...route },
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction: "WITH_TRAVEL",
		portType,
		barcode: `${portType}-${id}`,
	};
}
