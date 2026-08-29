import { describe, expect, it } from "vitest";
import { ADVANCED_SWITCH_ALL_MOVEMENTS } from "./AdvancedSwitch";
import { emptyPortEquipmentState } from "./EquipmentGroup";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import { DIR_E, DIR_N, DIR_S } from "./railShape";
import type {
	StaticFabOrganizationKind,
	StaticFabOrganizationMembership,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactForPatch,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "./StaticFabOrganizationImpactIndex";
import { cellKey, encodeRailCell } from "./TileMap";

describe("StaticFabOrganizationImpactIndex", () => {
	it("prepares large switch and equipment memberships through cooperative operations", async () => {
		const membershipValue = membership(
			[directedEdge(0, 0, 1, 0)],
			Array.from({ length: 4_096 }, (_, index) => index + 1),
			Array.from({ length: 4_096 }, (_, index) => index + 10_001),
		);
		let operations = 0;
		const index = await StaticFabOrganizationImpactIndex.prepareCooperatively(
			organizationState([organizationRecord(7, "AREA", "Prepared Area", membershipValue)]),
			async () => {
				operations++;
			},
		);

		expect(operations).toBeGreaterThan(16_000);
		expect(index.organizationOwnersForCell(1, 0)).toEqual([{ organizationId: 7, kind: "AREA" }]);
		expect(index.organizationOwnersForSwitch(4_096)).toEqual([{ organizationId: 7, kind: "AREA" }]);
		expect(index.organizationOwnersForEquipmentGroup(14_096)).toEqual([
			{ organizationId: 7, kind: "AREA" },
		]);
	});

	it("prunes superseded reverse tokens while reusing cached membership footprints through history", () => {
		const index = new StaticFabOrganizationImpactIndex();
		const observed = Array.from({ length: 32 }, (_, membershipIndex) =>
			observedMembership(membershipIndex * 10),
		);

		for (const entry of observed) {
			index.synchronize(
				organizationState([organizationRecord(7, "AREA", `Area ${entry.x}`, entry.membership)]),
			);
			expect(entry.iterations()).toBeGreaterThan(0);
			const internals = impactIndexInternals(index);
			expect(internals.registeredTokens.size).toBe(1);
			expect(internals.tokensByCell.size).toBe(2);
			expect([...internals.tokensByCell.keys()].sort()).toEqual(
				[cellKey(entry.x, 0), cellKey(entry.x + 1, 0)].sort(),
			);
		}

		const iterationsAfterFirstRegistration = observed.map((entry) => entry.iterations());
		for (const entry of observed.toReversed()) {
			index.synchronize(
				organizationState([organizationRecord(7, "AREA", `Area ${entry.x}`, entry.membership)]),
			);
		}
		for (const entry of observed) {
			index.synchronize(
				organizationState([organizationRecord(7, "AREA", `Renamed ${entry.x}`, entry.membership)]),
			);
		}
		expect(observed.map((entry) => entry.iterations())).toEqual(iterationsAfterFirstRegistration);

		const current = observed.at(-1) as ObservedMembership;
		index.synchronize(organizationState([]));
		expect(index.organizationOwnersForCell(current.x, 0)).toEqual([]);
		expect(impactIndexInternals(index).residentTokensByOrganizationId.size).toBe(0);
		expect(impactIndexInternals(index).registeredTokens.size).toBe(0);
		expect(impactIndexInternals(index).tokensByCell.size).toBe(0);
		index.synchronize(
			organizationState([organizationRecord(7, "AREA", "Restored", current.membership)]),
		);
		expect(current.iterations()).toBe(iterationsAfterFirstRegistration.at(-1));
		expect(index.organizationOwnersForCell(current.x, 0)).toEqual([
			{ organizationId: 7, kind: "AREA" },
		]);
		expect(impactIndexInternals(index).residentTokensByOrganizationId.size).toBe(1);
	});

	it("reports every overlapping cross-kind owner once in deterministic ID order", () => {
		const index = new StaticFabOrganizationImpactIndex();
		const sharedMembership = membership([directedEdge(0, 0, 1, 0)], [44], [88]);
		const records = [
			organizationRecord(1, "AREA", "Area", sharedMembership),
			organizationRecord(2, "BAY", "Bay", sharedMembership),
			organizationRecord(3, "AISLE", "Aisle", sharedMembership),
			organizationRecord(4, "PROCESS_FAMILY", "Process", sharedMembership),
		] as const;

		// Register the highest ID first so result order cannot depend on Set insertion history.
		index.synchronize(organizationState([records[3]]));
		index.synchronize(organizationState(records));
		const expected = [
			{ organizationId: 1, kind: "AREA" },
			{ organizationId: 2, kind: "BAY" },
			{ organizationId: 3, kind: "AISLE" },
			{ organizationId: 4, kind: "PROCESS_FAMILY" },
		];

		expect(index.organizationOwnersForCell(0, 0)).toEqual(expected);
		expect(index.organizationOwnersForSwitch(44)).toEqual(expected);
		expect(index.organizationOwnersForEquipmentGroup(88)).toEqual(expected);
		expect(index.organizationOwnersForMembership(sharedMembership)).toEqual(expected);
		expect(index.organizationOwnersForMembership(sharedMembership, "BAY")).toEqual([
			{ organizationId: 2, kind: "BAY" },
		]);
		expect(
			index.organizationOwnersForMembership(membership([directedEdge(1, 0, 2, 0)]), "AREA"),
		).toEqual([{ organizationId: 1, kind: "AREA" }]);

		const emptyPortEquipment = emptyPortEquipmentState();
		const impacts = staticFabOrganizationImpactsForPatch(
			index,
			[
				{ x: 1, y: 0, before: 1, after: 0 },
				{ x: 0, y: 0, before: 1, after: 0 },
			],
			[
				{
					id: 44,
					before: null,
					after: {
						id: 44,
						profileClass: "A",
						origin: { x: 0, y: 0 },
						forward: DIR_E,
						lateral: DIR_S,
						movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
					},
				},
			],
			[],
			[
				{
					id: 88,
					before: null,
					after: { id: 88, kind: "OHB", template: "SINGLE", portIds: [1] },
				},
			],
			emptyPortEquipment,
			emptyPortEquipment,
		);

		expect(impacts).toEqual(expected);
		expect(Object.isFrozen(impacts)).toBe(true);
		expect(new Set(impacts.map((owner) => owner.organizationId)).size).toBe(4);
		expect(
			staticFabOrganizationImpactForPatch(
				index,
				[{ x: 0, y: 0, before: 1, after: 0 }],
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toBe(1);
	});

	it("requires every protected owner to participate instead of accepting an unrelated organization edit", () => {
		const impacts = [
			{ organizationId: 1, kind: "AREA" as const },
			{ organizationId: 2, kind: "BAY" as const },
		];
		const area = organizationRecord(1, "AREA", "Area", membership([directedEdge(0, 0, 1, 0)]));
		const bay = organizationRecord(2, "BAY", "Bay", area.membership);
		const index = new StaticFabOrganizationImpactIndex();
		index.synchronize(organizationState([area, bay]));
		const unrelated = organizationRecord(
			3,
			"AISLE",
			"Unrelated aisle",
			membership([directedEdge(4, 0, 5, 0)]),
		);
		const emptyPortEquipment = emptyPortEquipmentState();
		const railChanges = [
			{
				x: 0,
				y: 0,
				before: encodeRailCell({ incoming: 0, outgoing: DIR_E }),
				after: encodeRailCell({ incoming: 0, outgoing: DIR_E | DIR_N }),
			},
		];

		expect(
			unhandledStaticFabOrganizationImpacts(
				index,
				impacts,
				[{ id: unrelated.id, before: null, after: unrelated }],
				railChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual(impacts);
		expect(
			unhandledStaticFabOrganizationImpacts(
				index,
				impacts,
				[
					{ id: area.id, before: area, after: null },
					{ id: unrelated.id, before: null, after: unrelated },
				],
				railChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual([{ organizationId: 2, kind: "BAY" }]);

		const renamed = Object.freeze({ ...area, name: "Renamed area" });
		expect(
			unhandledStaticFabOrganizationImpacts(
				index,
				impacts,
				[{ id: area.id, before: area, after: renamed }],
				railChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual(impacts);

		const unrelatedMembership = organizationRecord(
			area.id,
			area.kind,
			area.name,
			membership([directedEdge(0, 0, 1, 0), directedEdge(4, 0, 5, 0)]),
		);
		expect(
			unhandledStaticFabOrganizationImpacts(
				index,
				impacts,
				[{ id: area.id, before: area, after: unrelatedMembership }],
				railChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual(impacts);

		const sameCellWrongEdge = organizationRecord(
			area.id,
			area.kind,
			area.name,
			membership([directedEdge(0, 0, 0, 1), directedEdge(0, 0, 1, 0)]),
		);
		expect(
			unhandledStaticFabOrganizationImpacts(
				index,
				impacts,
				[{ id: area.id, before: area, after: sameCellWrongEdge }],
				railChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual(impacts);

		const matchingMembership = organizationRecord(
			area.id,
			area.kind,
			area.name,
			membership([directedEdge(0, 0, 0, -1), directedEdge(0, 0, 1, 0)]),
		);
		expect(
			unhandledStaticFabOrganizationImpacts(
				index,
				impacts,
				[{ id: area.id, before: area, after: matchingMembership }],
				railChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual([{ organizationId: 2, kind: "BAY" }]);

		const multiArea = organizationRecord(
			1,
			"AREA",
			"Multi area",
			membership([directedEdge(0, 0, 1, 0), directedEdge(4, 0, 5, 0)]),
		);
		const multiIndex = new StaticFabOrganizationImpactIndex();
		multiIndex.synchronize(organizationState([multiArea]));
		const partiallyUpdated = organizationRecord(
			1,
			"AREA",
			"Multi area",
			membership([directedEdge(0, 0, 0, -1), directedEdge(0, 0, 1, 0), directedEdge(4, 0, 5, 0)]),
		);
		const multiRailChanges = [
			...railChanges,
			{
				x: 4,
				y: 0,
				before: encodeRailCell({ incoming: 0, outgoing: DIR_E }),
				after: encodeRailCell({ incoming: 0, outgoing: DIR_E | DIR_N }),
			},
		];
		expect(
			unhandledStaticFabOrganizationImpacts(
				multiIndex,
				[{ organizationId: 1, kind: "AREA" }],
				[{ id: 1, before: multiArea, after: partiallyUpdated }],
				multiRailChanges,
				[],
				[],
				[],
				emptyPortEquipment,
				emptyPortEquipment,
			),
		).toEqual([{ organizationId: 1, kind: "AREA" }]);
	});
});

interface ObservedMembership {
	readonly x: number;
	readonly membership: StaticFabOrganizationMembership;
	iterations(): number;
}

function observedMembership(x: number): ObservedMembership {
	let iterations = 0;
	const edges = Object.freeze([directedEdge(x, 0, x + 1, 0)]);
	const observedEdges = new Proxy(edges, {
		get(target, property, receiver) {
			if (
				property === Symbol.iterator ||
				(typeof property === "string" && /^\d+$/.test(property))
			) {
				iterations++;
			}
			return Reflect.get(target, property, receiver);
		},
	});
	return Object.freeze({
		x,
		membership: Object.freeze({
			railEdges: observedEdges,
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
		iterations: () => iterations,
	});
}

function membership(
	railEdges: readonly DirectedRailEdge[],
	advancedSwitchIds: readonly number[] = [],
	equipmentGroupIds: readonly number[] = [],
): StaticFabOrganizationMembership {
	return Object.freeze({
		railEdges: Object.freeze([...railEdges]),
		advancedSwitchIds: Object.freeze([...advancedSwitchIds]),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds]),
	});
}

function directedEdge(fromX: number, fromY: number, toX: number, toY: number): DirectedRailEdge {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationKind,
	name: string,
	membershipValue: StaticFabOrganizationMembership,
): StaticFabOrganizationRecord {
	return Object.freeze({ id, kind, name, membership: membershipValue });
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	const sorted = [...records].sort((left, right) => left.id - right.id);
	return Object.freeze({
		nextOrganizationId: Math.max(1, ...sorted.map((record) => record.id + 1)),
		records: Object.freeze(sorted),
	});
}

function impactIndexInternals(index: StaticFabOrganizationImpactIndex): {
	readonly residentTokensByOrganizationId: ReadonlyMap<number, unknown>;
	readonly registeredTokens: ReadonlySet<unknown>;
	readonly tokensByCell: ReadonlyMap<string, ReadonlySet<unknown>>;
} {
	return index as unknown as {
		readonly residentTokensByOrganizationId: ReadonlyMap<number, unknown>;
		readonly registeredTokens: ReadonlySet<unknown>;
		readonly tokensByCell: ReadonlyMap<string, ReadonlySet<unknown>>;
	};
}
