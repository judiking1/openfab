import { describe, expect, it } from "vitest";
import {
	copyPortEquipmentState,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	legacyCustomEquipmentBaselineForPortEquipmentActivation,
	portEquipmentActivationMatches,
	validatePortEquipmentActivation,
} from "./PortEquipmentActivation";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { DIR_E, DIR_W } from "./railShape";
import { emptyStaticFabOrganizationState } from "./StaticFabOrganization";
import {
	staticFabOrganizationActivationMatches,
	validateStaticFabOrganizationActivation,
} from "./StaticFabOrganizationActivation";
import { encodeRailCell, TileMap } from "./TileMap";

describe("PortEquipmentActivation", () => {
	it("binds one immutable generation to the exact map revision and runtime state", async () => {
		const map = eastboundLineMap(4);
		const state = emptyPortEquipmentState();
		const activation = await validatePortEquipmentActivation(map, state, async () => {});

		expect(portEquipmentActivationMatches(activation, map, state)).toBe(true);
		expect(portEquipmentActivationMatches({}, map, state)).toBe(false);
		expect(portEquipmentActivationMatches(activation, map.clone(), state)).toBe(false);
		expect(portEquipmentActivationMatches(activation, map, emptyPortEquipmentState())).toBe(false);

		map.setEncoded(0, 0, 0);
		expect(portEquipmentActivationMatches(activation, map, state)).toBe(false);
	});

	it("rejects mutable, spacing-invalid, and body-overlapping authored generations", async () => {
		const map = eastboundLineMap(6);
		await expect(
			validatePortEquipmentActivation(
				map,
				{ nextPortId: 1, nextEquipmentGroupId: 1, ports: [], equipmentGroups: [] },
				async () => {},
			),
		).rejects.toThrow(/immutable/);

		await expect(
			validatePortEquipmentActivation(map, twoOhbState(500, 900), async () => {}),
		).rejects.toThrow(/closer than 600 mm/);

		await expect(
			validatePortEquipmentActivation(map, overlappingCustomStkState(), async () => {}, 2),
		).rejects.toThrow(/reservation overlaps/);
	});

	it("detects map mutation at a cooperative checkpoint before issuing authority", async () => {
		const map = eastboundLineMap(4);
		let changed = false;
		await expect(
			validatePortEquipmentActivation(
				map,
				emptyPortEquipmentState(),
				async () => {
					if (changed) return;
					changed = true;
					map.setEncoded(0, 0, 0);
				},
				1,
			),
		).rejects.toThrow(/map changed/);
	});

	it("captures CUSTOM baseline cooperatively and does not recopy it at adoption", async () => {
		const map = eastboundLineMap(6);
		const state = oneCustomStkState();
		let checkpoints = 0;
		const activation = await validatePortEquipmentActivation(
			map,
			state,
			async () => {
				checkpoints++;
			},
			1,
		);
		const baseline = legacyCustomEquipmentBaselineForPortEquipmentActivation(
			activation,
			map,
			state,
		);

		expect(checkpoints).toBeGreaterThan(5);
		expect(baseline.groups.get(1)).toEqual(state.equipmentGroups[0]);
		expect(baseline.groups.get(1)).not.toBe(state.equipmentGroups[0]);
		expect(baseline.ports.get(1)).toEqual(state.ports[0]);
		expect(baseline.ports.get(1)).not.toBe(state.ports[0]);
		expect("clear" in baseline.groups).toBe(false);
		expect(Object.isFrozen(baseline.groups)).toBe(true);
	});

	it("adopts a large exact state by identity without revisiting its records", async () => {
		const rowCount = 10_000;
		const map = eastboundLineMap(rowCount);
		const state = ohbRowState(rowCount);
		let checkpoints = 0;
		const portActivation = await validatePortEquipmentActivation(
			map,
			state,
			async () => {
				checkpoints++;
			},
			64,
		);
		const organizations = emptyStaticFabOrganizationState();
		const ownership = buildRailModuleOwnershipIndex(map);
		const organizationActivation = await validateStaticFabOrganizationActivation(
			map,
			state,
			organizations,
			ownership,
			async () => {},
		);
		const document = RailDocument.fromCooperativelyValidatedMap(
			map,
			0,
			state,
			organizations,
			portActivation,
			organizationActivation,
		);

		expect(checkpoints).toBeGreaterThan(500);
		expect(document.portEquipment).toBe(state);
	});

	it("invalidates both startup proofs across a rollback ABA cycle", async () => {
		const map = eastboundLineMap(4);
		const state = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const ownership = buildRailModuleOwnershipIndex(map);
		const portActivation = await validatePortEquipmentActivation(map, state, async () => {});
		const organizationActivation = await validateStaticFabOrganizationActivation(
			map,
			state,
			organizations,
			ownership,
			async () => {},
		);
		const checkpoint = map.createMutationCheckpoint();
		const before = map.getEncoded(0, 0);
		const after = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		const generation = map.getMutationGeneration();
		const mutation = Object.freeze({ x: 0, y: 0, before, after });

		map.applyAtomicMutations([mutation], []);
		map.rollbackAtomicMutations([mutation], [], checkpoint);

		expect(map.getEncoded(0, 0)).toBe(before);
		expect(map.getRevision()).toBe(checkpoint.revision);
		expect(map.getMutationGeneration()).toBeGreaterThan(generation);
		expect(portEquipmentActivationMatches(portActivation, map, state)).toBe(false);
		expect(
			staticFabOrganizationActivationMatches(organizationActivation, map, state, organizations),
		).toBe(false);
		expect(() =>
			RailDocument.fromCooperativelyValidatedMap(
				map,
				0,
				state,
				organizations,
				portActivation,
				organizationActivation,
			),
		).toThrow(/generation/);
	});

	it("fails closed for an unbranded frozen accessor generation", async () => {
		const map = eastboundLineMap(4);
		let portsReads = 0;
		const hostile = Object.freeze({
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			get ports(): readonly PortEquipmentState["ports"][number][] {
				portsReads++;
				return Object.freeze([]);
			},
			equipmentGroups: Object.freeze([]),
		}) satisfies PortEquipmentState;

		await expect(validatePortEquipmentActivation(map, hostile, async () => {})).rejects.toThrow(
			/canonical/,
		);
		expect(portsReads).toBe(0);
	});

	it("canonical copying captures alternating port, route, and group getters once", async () => {
		const map = eastboundLineMap(4);
		let portIdReads = 0;
		let routeReads = 0;
		let routeXReads = 0;
		let groupIdReads = 0;
		let groupPortIdsReads = 0;
		const route = Object.freeze({
			kind: "CARDINAL_CELL" as const,
			get x(): number {
				routeXReads++;
				return routeXReads === 1 ? 2 : Number.NaN;
			},
			z: 0,
			from: DIR_W,
			to: DIR_E,
		});
		const port = Object.freeze({
			get id(): number {
				portIdReads++;
				return portIdReads === 1 ? 1 : Number.NaN;
			},
			equipmentGroupId: 1,
			get route() {
				routeReads++;
				return routeReads === 1
					? route
					: Object.freeze({
							kind: "CARDINAL_CELL" as const,
							x: Number.NaN,
							z: 0,
							from: DIR_W,
							to: DIR_E,
						});
			},
			stationMillimeters: 500,
			side: "CENTER" as const,
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL" as const,
			portType: "OHB" as const,
			barcode: null,
		});
		const group = Object.freeze({
			get id(): number {
				groupIdReads++;
				return groupIdReads === 1 ? 1 : Number.NaN;
			},
			kind: "OHB" as const,
			template: "SINGLE" as const,
			get portIds(): readonly number[] {
				groupPortIdsReads++;
				return groupPortIdsReads === 1 ? Object.freeze([1]) : Object.freeze([Number.NaN]);
			},
		});

		const state = copyPortEquipmentState({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port],
			equipmentGroups: [group],
		});
		expect({ portIdReads, routeReads, routeXReads, groupIdReads, groupPortIdsReads }).toEqual({
			portIdReads: 1,
			routeReads: 1,
			routeXReads: 1,
			groupIdReads: 1,
			groupPortIdsReads: 1,
		});
		await expect(
			validatePortEquipmentActivation(map, state, async () => {}),
		).resolves.toBeDefined();
	});
});

function eastboundLineMap(cellCount: number): TileMap {
	const hydrator = TileMap.createHydrator();
	const encoded = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
	for (let x = 0; x < cellCount; x++) hydrator.addEncodedCell(x, 0, encoded);
	return hydrator.finish(cellCount);
}

function twoOhbState(firstStation: number, secondStation: number): PortEquipmentState {
	return copyPortEquipmentState({
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: [firstStation, secondStation].map((stationMillimeters, index) => ({
			id: index + 1,
			equipmentGroupId: index + 1,
			route: { kind: "CARDINAL_CELL" as const, x: 2, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters,
			side: "LEFT" as const,
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL" as const,
			portType: "OHB" as const,
			barcode: null,
		})),
		equipmentGroups: [1, 2].map((id) => ({
			id,
			kind: "OHB" as const,
			template: "SINGLE" as const,
			portIds: [id],
		})),
	});
}

function oneCustomStkState(): PortEquipmentState {
	return customStkState([{ id: 1, groupId: 1, x: 2 }]);
}

function overlappingCustomStkState(): PortEquipmentState {
	return customStkState([
		{ id: 1, groupId: 1, x: 1 },
		{ id: 2, groupId: 1, x: 3 },
		{ id: 3, groupId: 2, x: 2 },
	]);
}

function customStkState(
	placements: readonly { readonly id: number; readonly groupId: number; readonly x: number }[],
): PortEquipmentState {
	const groupIds = [...new Set(placements.map((placement) => placement.groupId))];
	return copyPortEquipmentState({
		nextPortId: placements.length + 1,
		nextEquipmentGroupId: Math.max(...groupIds) + 1,
		ports: placements.map((placement) => ({
			id: placement.id,
			equipmentGroupId: placement.groupId,
			route: {
				kind: "CARDINAL_CELL" as const,
				x: placement.x,
				z: 0,
				from: DIR_W,
				to: DIR_E,
			},
			stationMillimeters: 500,
			side: "CENTER" as const,
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL" as const,
			portType: "STK" as const,
			barcode: null,
		})),
		equipmentGroups: groupIds.map((id) => ({
			id,
			kind: "STK" as const,
			template: "CUSTOM" as const,
			portIds: placements
				.filter((placement) => placement.groupId === id)
				.map((placement) => placement.id),
		})),
	});
}

function ohbRowState(rowCount: number): PortEquipmentState {
	const ports = new Array<PortEquipmentState["ports"][number]>(rowCount);
	const groups = new Array<PortEquipmentState["equipmentGroups"][number]>(rowCount);
	for (let index = 0; index < rowCount; index++) {
		const id = index + 1;
		ports[index] = {
			id,
			equipmentGroupId: id,
			route: { kind: "CARDINAL_CELL", x: index, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: null,
		};
		groups[index] = { id, kind: "OHB", template: "SINGLE", portIds: [id] };
	}
	return copyPortEquipmentState({
		nextPortId: rowCount + 1,
		nextEquipmentGroupId: rowCount + 1,
		ports,
		equipmentGroups: groups,
	});
}
