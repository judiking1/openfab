import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { CardinalPortRoute, PortRecord } from "../core/PortRecord";
import { DIR_E as EAST, DIR_W as WEST } from "../core/railShape";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { createStaticFabOuterCirculationIndex } from "../core/StaticFabOuterCirculation";
import {
	createGuidedBuildFabEquipmentScope,
	summarizeGuidedBuildEquipment,
	summarizeGuidedBuildFabEquipment,
} from "./GuidedBuildEquipmentEvidence";

const emptyEquipment = {
	OHB: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
	EQ: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
	STK: { groupCount: 0, portCount: 0, largestGroupPortCount: 0 },
};

describe("Guided final FAB equipment", () => {
	it("requires a semantic FAB with two-way redundant Bank circulation", () => {
		expect(scope({ nextOrganizationId: 1, records: [] })).toBeNull();
		const incomplete = hierarchy(0, false);
		expect(scope(incomplete)).toBeNull();
		expect(summarizeGuidedBuildFabEquipment(null, equipment()).equipment).toEqual(emptyEquipment);
	});
	it("summarizes only complete groups attached to the same target FAB", () => {
		const target = scope(hierarchy());
		const state = equipment();
		const result = summarizeGuidedBuildFabEquipment(target, state);
		expect(result).toEqual({
			organizationId: 7,
			name: "FAB 7",
			equipment: {
				OHB: { groupCount: 1, portCount: 1, largestGroupPortCount: 1 },
				EQ: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
				STK: { groupCount: 1, portCount: 2, largestGroupPortCount: 2 },
			},
		});
		expect(result.equipment).toEqual(summarizeGuidedBuildEquipment(state));
		expect(Object.isFrozen(result.equipment.STK)).toBe(true);
		expect(
			hierarchy().records.every((record) => record.membership.equipmentGroupIds.length === 0),
		).toBe(true);
	});
	it("rejects an unrelated route, a reverse route and a partially attached group", () => {
		const target = scope(hierarchy());
		for (const route of [cardinal(102), { ...cardinal(2), from: EAST, to: WEST } as const]) {
			const state = equipment();
			const changed = {
				...state,
				ports: state.ports.map((port) => (port.id === 3 ? { ...port, route } : port)),
			};
			expect(summarizeGuidedBuildFabEquipment(target, changed).equipment.EQ).toEqual(
				emptyEquipment.EQ,
			);
			expect(summarizeGuidedBuildFabEquipment(target, changed).equipment.OHB.groupCount).toBe(1);
		}
	});
	it("does not combine groups from different FABs and keeps the lowest eligible ID", () => {
		const first = hierarchy();
		const second = hierarchy(100);
		const target = scope({
			nextOrganizationId: 108,
			records: [...second.records, ...first.records],
		});
		expect(target?.organizationId).toBe(7);
		const state = equipment();
		const split = {
			...state,
			ports: state.ports.map((port) =>
				port.portType === "STK" ? { ...port, route: cardinal(102) } : port,
			),
		};
		expect(summarizeGuidedBuildFabEquipment(target, split).equipment.STK).toEqual(
			emptyEquipment.STK,
		);
		expect(summarizeGuidedBuildEquipment(split).STK.groupCount).toBe(1);
	});
	it("recomputes from replacement snapshots after Undo, Redo and hierarchy edits", () => {
		const target = scope(hierarchy());
		const state = equipment();
		const before = summarizeGuidedBuildFabEquipment(target, state);
		const undone = {
			...state,
			equipmentGroups: state.equipmentGroups.filter((group) => group.kind !== "STK"),
			ports: state.ports.filter((port) => port.portType !== "STK"),
		};
		expect(summarizeGuidedBuildFabEquipment(target, undone).equipment.STK.groupCount).toBe(0);
		expect(summarizeGuidedBuildFabEquipment(target, state)).toEqual(before);
		expect(
			summarizeGuidedBuildFabEquipment(scope(hierarchy(0, false)), state).organizationId,
		).toBeNull();
	});
	it("rejects incomplete, mismatched and dangling group membership", () => {
		const target = scope(hierarchy());
		const state = equipment();
		for (const ports of [
			state.ports.filter((port) => port.id !== 3),
			state.ports.map((port) => (port.id === 3 ? { ...port, equipmentGroupId: 99 } : port)),
			state.ports.map((port) => (port.id === 3 ? { ...port, portType: "STK" as const } : port)),
		]) {
			expect(summarizeGuidedBuildFabEquipment(target, { ...state, ports }).equipment.EQ).toEqual(
				emptyEquipment.EQ,
			);
		}
	});
});

function scope(state: StaticFabOrganizationState) {
	return createGuidedBuildFabEquipmentScope(createStaticFabOuterCirculationIndex(state));
}
function cardinal(x: number): CardinalPortRoute {
	return { kind: "CARDINAL_CELL", x, z: 0, from: WEST, to: EAST };
}
function equipment(): PortEquipmentState {
	const ports: PortRecord[] = ["OHB", "EQ", "EQ", "STK", "STK"].map((kind, index) => ({
		id: index + 1,
		equipmentGroupId: index === 0 ? 1 : index < 3 ? 2 : 3,
		route: cardinal(index < 3 ? 2 : 11),
		stationMillimeters: index % 2 ? 100 : 700,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: kind as PortRecord["portType"],
		barcode: null,
	}));
	return {
		nextPortId: 6,
		nextEquipmentGroupId: 4,
		ports,
		equipmentGroups: [
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "EQ", pitchMillimeters: 1000, recipe: null, portIds: [2, 3] },
			{ id: 3, kind: "STK", template: "FLEX", portIds: [4, 5] },
		],
	};
}
// Synthetic graph-level hierarchy fixture; physical placement is covered by browser authoring.
function hierarchy(offset = 0, resilient = true): StaticFabOrganizationState {
	const edge = (from: number, to: number) => ({
		from: { x: from + offset, y: 0 },
		to: { x: to + offset, y: 0 },
	});
	const record = (
		id: number,
		kind: StaticFabOrganizationRecord["kind"],
		parents: number[],
		pairs: number[][],
	): StaticFabOrganizationRecord => ({
		id: id + offset,
		kind,
		name: `FAB ${id + offset}`,
		parentOrganizationIds: parents.map((parent) => parent + offset),
		properties: { description: "Synthetic guided equipment evidence", color: "TEAL" },
		membership: {
			railEdges: pairs.map(([a, b]) => edge(a as number, b as number)),
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	});
	return {
		nextOrganizationId: 8 + offset,
		records: [
			record(1, "AISLE", [2], [[1, 2]]),
			record(2, "BAY", [3], [[2, 3]]),
			record(3, "AREA", [7], [[3, 1]]),
			record(4, "AISLE", [5], [[10, 11]]),
			record(5, "BAY", [6], [[11, 12]]),
			record(6, "AREA", [7], [[12, 10]]),
			record(
				7,
				"AREA",
				[],
				resilient
					? [
							[1, 10],
							[10, 1],
							[2, 11],
							[11, 2],
						]
					: [
							[1, 10],
							[10, 1],
						],
			),
		],
	};
}
