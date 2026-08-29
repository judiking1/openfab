import { describe, expect, it } from "vitest";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { createConnectedStaticFabSelection } from "./ConnectedStaticFabSelection";
import type { PortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { DIR_E, DIR_W, type Direction, moveCell } from "./railShape";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";

describe("ConnectedStaticFabSelection", () => {
	it("selects one exact weakly connected rail component", () => {
		const map = disconnectedLines(0, 10);
		const ownership = buildRailModuleOwnershipIndex(map);
		const first = ownership.resolve({ x: 1, y: 0 });
		if (first.status !== "resolved") throw new Error(first.reason);

		const result = createConnectedStaticFabSelection(map, ownership, emptyPortEquipment(), 4, {
			railModuleKeys: [first.module.key],
		});

		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.railCellCount).toBe(3);
		expect(result.selection.rail.ownerships).toHaveLength(1);
		expect(result.selection.rail.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 0 });
		expect(result.selection.equipmentGroups).toEqual([]);
		expect(result.selection.basePatchSequence).toBe(4);
	});

	it("expands through one complete equipment group without admitting unrelated equipment", () => {
		const map = disconnectedLines(0, 10, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		const first = ownership.resolve({ x: 1, y: 0 });
		if (first.status !== "resolved") throw new Error(first.reason);
		const state = bridgedPortEquipment();

		const result = createConnectedStaticFabSelection(map, ownership, state, 9, {
			railModuleKeys: [first.module.key],
		});

		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.railCellCount).toBe(6);
		expect(result.selection.rail.ownerships).toHaveLength(2);
		expect(result.selection.equipmentGroups.map((selected) => selected.group.id)).toEqual([1]);
		expect(result.selection.equipmentGroups[0]?.ports.map((port) => port.id)).toEqual([1, 2]);
	});

	it("can start from an equipment group and rejects stale or incomplete seeds", () => {
		const map = disconnectedLines(0, 10, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		const state = bridgedPortEquipment();

		const selected = createConnectedStaticFabSelection(map, ownership, state, 2, {
			equipmentGroupIds: [1],
		});
		expect(selected.valid).toBe(true);
		if (selected.valid) {
			expect(selected.selection.rail.ownerships).toHaveLength(2);
			expect(selected.selection.equipmentGroups).toHaveLength(1);
		}

		const missing = createConnectedStaticFabSelection(map, ownership, state, 2, {
			equipmentGroupIds: [999],
		});
		expect(missing).toMatchObject({ valid: false, selection: null });

		map.setEncoded(30, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		const stale = createConnectedStaticFabSelection(map, ownership, state, 2, {
			equipmentGroupIds: [1],
		});
		expect(stale).toMatchObject({ valid: false, selection: null });
	});

	it("traverses every physical leg owned by one advanced switch module", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);
		if (!switchPlan.switchRecord) throw new Error("expected advanced switch record");
		for (const output of deriveAdvancedSwitchGeometry(switchPlan.switchRecord).outputs) {
			const extension = planRailConstruction(
				document.map,
				output.cell,
				moveRepeated(output.cell, output.direction, 3),
			);
			expect(extension.valid, extension.reason).toBe(true);
			expect(document.commit(extension)).toBe(true);
		}
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const input = ownership.resolve({ x: -2, y: 0 });
		if (input.status !== "resolved") throw new Error(input.reason);

		const result = createConnectedStaticFabSelection(
			document.map,
			ownership,
			emptyPortEquipment(),
			document.getPatchSequence(),
			{ railModuleKeys: [input.module.key] },
		);

		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.selection.rail.ownerships).toHaveLength(ownership.modules.length);
		expect(
			result.selection.rail.ownerships.some((module) => module.kind === "advanced-switch"),
		).toBe(true);
		let railCellCount = 0;
		document.map.forEachRail(() => railCellCount++);
		expect(result.railCellCount).toBe(railCellCount);
	});
});

function moveRepeated(cell: Cell, direction: Direction, steps: number): Cell {
	let current = cell;
	for (let index = 0; index < steps; index++) current = moveCell(current, direction);
	return current;
}

function disconnectedLines(...starts: number[]): TileMap {
	const map = new TileMap();
	for (const start of starts) {
		map.setEncoded(start, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		map.setEncoded(start + 1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(start + 2, 0, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
	}
	return map;
}

function emptyPortEquipment(): PortEquipmentState {
	return Object.freeze({ nextPortId: 1, nextEquipmentGroupId: 1, ports: [], equipmentGroups: [] });
}

function bridgedPortEquipment(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 4,
		nextEquipmentGroupId: 3,
		ports: Object.freeze([port(1, 1, 1, "STK"), port(2, 1, 11, "STK"), port(3, 2, 21, "OHB")]),
		equipmentGroups: Object.freeze([
			Object.freeze({ id: 1, kind: "STK", template: "FLEX", portIds: Object.freeze([1, 2]) }),
			Object.freeze({ id: 2, kind: "OHB", template: "SINGLE", portIds: Object.freeze([3]) }),
		]),
	});
}

function port(id: number, equipmentGroupId: number, x: number, portType: "STK" | "OHB") {
	return Object.freeze({
		id,
		equipmentGroupId,
		route: Object.freeze({
			kind: "CARDINAL_CELL" as const,
			x,
			z: 0,
			from: DIR_W,
			to: DIR_E,
		}),
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL" as const,
		portType,
		barcode: null,
	});
}
