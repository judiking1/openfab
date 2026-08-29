import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	resolveEditablePortEquipmentSelection,
	resolveExactPortEquipmentSelection,
} from "./PortEquipmentInspectorSelection";

describe("PortEquipmentInspectorSelection", () => {
	it("keeps a valid reciprocal equipment group editable", () => {
		const state = eqState();

		expect(resolveEditablePortEquipmentSelection(state, selection())).toMatchObject({
			port: { id: 1 },
			equipmentGroup: { id: 1, kind: "EQ" },
		});
	});

	it("makes the whole group read-only when a different member has a duplicate barcode", () => {
		const state = eqState(
			[
				port(1, 1, "EQ-1", 0),
				port(2, 1, "DUPLICATE", 1_000),
				{ ...port(3, 2, "DUPLICATE", 4_000), portType: "OHB" },
			],
			[
				{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
				{ id: 2, kind: "OHB", template: "SINGLE", portIds: [3] },
			],
		);

		expect(resolveExactPortEquipmentSelection(state, selection())).not.toBeNull();
		expect(resolveEditablePortEquipmentSelection(state, selection())).toBeNull();
	});

	it("fails closed when an unrelated group would make every atomic commit invalid", () => {
		const state = eqState(undefined, [
			{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
			{ id: 2, kind: "OHB", template: "SINGLE", portIds: [99] },
		]);

		expect(resolveEditablePortEquipmentSelection(state, selection())).toBeNull();
	});
});

function selection(): { readonly portId: number; readonly equipmentGroupId: number } {
	return { portId: 1, equipmentGroupId: 1 };
}

function eqState(
	ports: readonly PortRecord[] = [port(1, 1, "EQ-1", 0), port(2, 1, "EQ-2", 1_000)],
	equipmentGroups: PortEquipmentState["equipmentGroups"] = [
		{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
	],
): PortEquipmentState {
	return {
		nextPortId: 4,
		nextEquipmentGroupId: 3,
		ports,
		equipmentGroups,
	};
}

function port(
	id: number,
	equipmentGroupId: number,
	barcode: string,
	stationMillimeters: number,
): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", x: 0, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "EQ",
		barcode,
	};
}
