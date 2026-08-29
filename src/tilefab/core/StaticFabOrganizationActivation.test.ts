import { describe, expect, it } from "vitest";
import {
	copyPortEquipmentState,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { validatePortEquipmentActivation } from "./PortEquipmentActivation";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnershipIndex,
} from "./RailModuleOwnership";
import { DIR_E, DIR_W } from "./railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationActivation,
	staticFabOrganizationActivationMatches,
	validateStaticFabOrganizationActivation,
} from "./StaticFabOrganizationActivation";
import {
	cachedStaticFabOrganizationMembershipFingerprint,
	staticFabOrganizationFingerprint,
	staticFabOrganizationMembershipFingerprint,
} from "./StaticFabOrganizationFingerprint";
import {
	planRemoveStaticFabOrganization,
	planRenameStaticFabOrganization,
} from "./StaticFabOrganizationPlan";
import { encodeRailCell, TileMap } from "./TileMap";

describe("StaticFabOrganizationActivation", () => {
	it("validates one exact AREA and binds its proof to exact runtime generations", async () => {
		const map = eastboundLineMap(12);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const state = exactAreaState(ownership, "Photo Area");

		const activation = await validateStaticFabOrganizationActivation(
			map,
			portEquipment,
			state,
			ownership,
			async () => {},
		);

		expect(staticFabOrganizationActivationMatches(activation, map, portEquipment, state)).toBe(
			true,
		);
		expect(() =>
			assertStaticFabOrganizationActivation(activation, map, portEquipment, state),
		).not.toThrow();
		expect(
			staticFabOrganizationActivationMatches(activation, map.clone(), portEquipment, state),
		).toBe(false);
		expect(
			staticFabOrganizationActivationMatches(activation, map, emptyPortEquipmentState(), state),
		).toBe(false);
		expect(
			staticFabOrganizationActivationMatches(activation, map, portEquipment, {
				...state,
			}),
		).toBe(false);
		expect(() => assertStaticFabOrganizationActivation({}, map, portEquipment, state)).toThrow(
			/generation/,
		);
		map.setEncoded(0, 0, 0);
		expect(staticFabOrganizationActivationMatches(activation, map, portEquipment, state)).toBe(
			false,
		);
	});

	it("rejects a genuine same-revision ownership index compiled from another map", async () => {
		const target = eastboundLineMap(12);
		const foreign = eastboundLineMap(1);
		const foreignOwnership = buildRailModuleOwnershipIndex(foreign);
		const state = exactAreaState(foreignOwnership, "Foreign partial module");

		await expect(
			validateStaticFabOrganizationActivation(
				target,
				emptyPortEquipmentState(),
				state,
				foreignOwnership,
				async () => {},
			),
		).rejects.toThrow(/generation/);
	});

	it("rejects a frozen pre-hash object and recomputes after canonical copying", async () => {
		const map = eastboundLineMap(12);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const exact = exactAreaState(ownership, "Mutable Prehash Area");
		const exactRecord = exact.records[0];
		if (!exactRecord || exactRecord.membership.railEdges.length < 2) {
			throw new Error("Expected a multi-edge AREA fixture.");
		}
		const railEdges = [...exactRecord.membership.railEdges.slice(1)];
		const membership = {
			railEdges,
			advancedSwitchIds: [...exactRecord.membership.advancedSwitchIds],
			equipmentGroupIds: [...exactRecord.membership.equipmentGroupIds],
		};
		const record = { ...exactRecord, membership };
		staticFabOrganizationFingerprint(record);
		expect(cachedStaticFabOrganizationMembershipFingerprint(membership)).toBeUndefined();

		railEdges.splice(0, railEdges.length, ...exactRecord.membership.railEdges);
		Object.freeze(railEdges);
		Object.freeze(membership.advancedSwitchIds);
		Object.freeze(membership.equipmentGroupIds);
		Object.freeze(membership);
		Object.freeze(record);
		const unbranded = Object.freeze({
			nextOrganizationId: exact.nextOrganizationId,
			records: Object.freeze([record]),
		});
		await expect(
			validateStaticFabOrganizationActivation(
				map,
				portEquipment,
				unbranded,
				ownership,
				async () => {},
			),
		).rejects.toThrow(/canonical/);
		const state = copyStaticFabOrganizationState(unbranded);

		await validateStaticFabOrganizationActivation(
			map,
			portEquipment,
			state,
			ownership,
			async () => {},
		);

		expect(cachedStaticFabOrganizationMembershipFingerprint(state.records[0]?.membership)).toEqual(
			staticFabOrganizationMembershipFingerprint(exactRecord.membership),
		);
		expect(cachedStaticFabOrganizationMembershipFingerprint(membership)).toBeUndefined();
	});

	it("rejects nonexistent and partial semantic-module membership", async () => {
		const map = eastboundLineMap(12);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const exact = exactAreaState(ownership, "Exact");
		const tamperedEdge = Object.freeze({
			from: Object.freeze({ x: 100, y: 100 }),
			to: Object.freeze({ x: 101, y: 100 }),
		});
		const tampered = areaState(
			"Tampered",
			canonicalEdges([...(exact.records[0]?.membership.railEdges ?? []), tamperedEdge]),
		);

		await expect(
			validateStaticFabOrganizationActivation(
				map,
				portEquipment,
				tampered,
				ownership,
				async () => {},
			),
		).rejects.toThrow(/현재 맵에서 찾을 수 없습니다/);

		const multiEdgeModule = ownership.modules.find((module) => module.eraseEdges.length > 1);
		if (!multiEdgeModule) throw new Error("Expected a multi-edge semantic module.");
		const partial = areaState("Partial", [multiEdgeModule.eraseEdges[0] as DirectedRailEdge]);
		await expect(
			validateStaticFabOrganizationActivation(
				map,
				portEquipment,
				partial,
				ownership,
				async () => {},
			),
		).rejects.toThrow(/전체를 포함/);
	});

	it("rejects same-kind overlap, normalized duplicate names, and a stale ID cursor", async () => {
		const map = eastboundLineMap(8);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const first = exactAreaState(ownership, "Bay A").records[0] as StaticFabOrganizationRecord;
		const second = Object.freeze({ ...first, id: 2, name: "Bay B" });

		await expect(
			validateStaticFabOrganizationActivation(
				map,
				portEquipment,
				frozenState(3, [first, second]),
				ownership,
				async () => {},
			),
		).rejects.toThrow(/함께 소유/);

		expect(() => frozenState(3, [first, Object.freeze({ ...second, name: "ＢＡＹ Ａ" })])).toThrow(
			/중복/,
		);

		expect(() => frozenState(1, [first])).toThrow(/모든 저장된 조직 ID보다 커야/);
	});

	it("rejects mutable generations before issuing an identity-bound activation", async () => {
		const map = eastboundLineMap(8);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const frozen = exactAreaState(ownership, "Immutable Area");
		const mutable = { ...frozen };

		await expect(
			validateStaticFabOrganizationActivation(
				map,
				portEquipment,
				mutable,
				ownership,
				async () => {},
			),
		).rejects.toThrow(/canonical/);
	});

	it("keeps a cooperatively prepared impact index private when activation is cancelled", async () => {
		const map = eastboundLineMap(64);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const state = exactAreaState(ownership, "Cancelled Area");
		const membership = (state.records[0] as StaticFabOrganizationRecord).membership;
		let checkpoints = 0;

		await expect(
			validateStaticFabOrganizationActivation(
				map,
				portEquipment,
				state,
				ownership,
				async () => {
					checkpoints++;
					if (cachedStaticFabOrganizationMembershipFingerprint(membership) !== undefined) {
						throw new Error("activation cancelled");
					}
				},
				1,
			),
		).rejects.toThrow("activation cancelled");
		expect(checkpoints).toBeGreaterThan(64);
	});

	it("always checkpoints before activating an empty organization generation", async () => {
		const map = eastboundLineMap(4);
		const ownership = buildRailModuleOwnershipIndex(map);
		await expect(
			validateStaticFabOrganizationActivation(
				map,
				emptyPortEquipmentState(),
				copyStaticFabOrganizationState({ nextOrganizationId: 1, records: [] }),
				ownership,
				async () => {
					throw new Error("empty activation cancelled");
				},
			),
		).rejects.toThrow("empty activation cancelled");
	});

	it("captures frozen root, record, and membership accessors into one plain canonical generation", async () => {
		const map = eastboundLineMap(1);
		const ownership = buildRailModuleOwnershipIndex(map);
		const exactRecord = exactAreaState(ownership, "Accessor Area").records[0];
		if (!exactRecord) throw new Error("Expected an AREA fixture.");
		let recordsReads = 0;
		let idReads = 0;
		let membershipReads = 0;
		let railEdgeReads = 0;
		const membership = Object.freeze({
			get railEdges(): readonly DirectedRailEdge[] {
				railEdgeReads++;
				return railEdgeReads === 1 ? exactRecord.membership.railEdges : Object.freeze([]);
			},
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		});
		const record = Object.freeze({
			get id(): number {
				idReads++;
				return idReads === 1 ? 1 : Number.NaN;
			},
			kind: "AREA" as const,
			name: "Accessor Area",
			get membership() {
				membershipReads++;
				return membershipReads === 1
					? membership
					: Object.freeze({
							railEdges: Object.freeze([]),
							advancedSwitchIds: Object.freeze([]),
							equipmentGroupIds: Object.freeze([]),
						});
			},
		}) satisfies StaticFabOrganizationRecord;
		const records = Object.freeze([record]);
		const source = Object.freeze({
			nextOrganizationId: 2,
			get records(): readonly StaticFabOrganizationRecord[] {
				recordsReads++;
				return recordsReads === 1 ? records : Object.freeze([]);
			},
		}) satisfies StaticFabOrganizationState;

		const state = copyStaticFabOrganizationState(source);
		expect({ recordsReads, idReads, membershipReads, railEdgeReads }).toEqual({
			recordsReads: 1,
			idReads: 1,
			membershipReads: 1,
			railEdgeReads: 1,
		});
		await expect(
			validateStaticFabOrganizationActivation(
				map,
				emptyPortEquipmentState(),
				state,
				ownership,
				async () => {},
			),
		).resolves.toBeDefined();
	});

	it("checkpoints every phase of a 10k-record relationship traversal", async () => {
		const recordCount = 10_000;
		const map = eastboundLineMap(1);
		const ownership = buildRailModuleOwnershipIndex(map);
		const edge = ownership.modules[0]?.eraseEdges[0];
		if (!edge) throw new Error("Expected one semantic rail edge.");
		const kinds = ["AREA", "BAY", "AISLE", "PROCESS_FAMILY"] as const;
		const state = copyStaticFabOrganizationState({
			nextOrganizationId: recordCount + 1,
			records: Array.from({ length: recordCount }, (_, index) => ({
				id: index + 1,
				kind: kinds[index % kinds.length] as (typeof kinds)[number],
				name: `Organization ${index + 1}`,
				membership: {
					railEdges: [edge],
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			})),
		});
		let checkpoints = 0;

		await expect(
			validateStaticFabOrganizationActivation(
				map,
				emptyPortEquipmentState(),
				state,
				ownership,
				async () => {
					checkpoints++;
				},
				1,
			),
		).rejects.toThrow(/함께 소유/);
		expect(checkpoints).toBeGreaterThan(recordCount * 4);
	});

	it("transfers a prepared mutable impact index to only one document", async () => {
		const map = eastboundLineMap(12);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const state = exactAreaState(ownership, "Single Owner Area");
		const organizationActivation = await validateStaticFabOrganizationActivation(
			map,
			portEquipment,
			state,
			ownership,
			async () => {},
		);
		const portEquipmentActivation = await validatePortEquipmentActivation(
			map,
			portEquipment,
			async () => {},
		);

		const document = RailDocument.fromCooperativelyValidatedMap(
			map,
			0,
			portEquipment,
			state,
			portEquipmentActivation,
			organizationActivation,
		);
		expect(document.organizations).toBe(state);
		expect(() =>
			RailDocument.fromCooperativelyValidatedMap(
				map,
				0,
				portEquipment,
				state,
				portEquipmentActivation,
				organizationActivation,
			),
		).toThrow(/이미 다른 문서에서 소비/);
	});

	it("requires every selected equipment port route to be completely supported", async () => {
		const map = eastboundLineMap(4);
		const ownership = buildRailModuleOwnershipIndex(map);
		const equipment: PortEquipmentState = copyPortEquipmentState({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: Object.freeze([
				Object.freeze({
					id: 1,
					equipmentGroupId: 1,
					route: Object.freeze({
						kind: "CARDINAL_CELL" as const,
						x: 2,
						z: 0,
						from: DIR_W,
						to: DIR_E,
					}),
					stationMillimeters: 500,
					side: "LEFT" as const,
					lateralOffsetMillimeters: 700,
					direction: "WITH_TRAVEL" as const,
					portType: "OHB" as const,
					barcode: null,
				}),
			]),
			equipmentGroups: Object.freeze([
				Object.freeze({
					id: 1,
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIds: Object.freeze([1]),
				}),
			]),
		});
		const exact = exactAreaState(ownership, "Ports", [1]);

		await expect(
			validateStaticFabOrganizationActivation(map, equipment, exact, ownership, async () => {}),
		).resolves.toBeDefined();

		const unsupported = areaState(
			"Unsupported port",
			exact.records[0]?.membership.railEdges.filter(
				(edge) => staticFabOrganizationEdgeKey(edge) !== "1:0>2:0",
			) ?? [],
			[1],
		);
		await expect(
			validateStaticFabOrganizationActivation(
				map,
				equipment,
				unsupported,
				ownership,
				async () => {},
			),
		).rejects.toThrow(/완전히 포함되지 않습니다/);
	});

	it("checkpoints a valid 50k-edge AREA more than one hundred times", async () => {
		const map = eastboundLineMap(50_000);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const state = exactAreaState(ownership, "Factory Envelope");
		let checkpoints = 0;

		const activation = await validateStaticFabOrganizationActivation(
			map,
			portEquipment,
			state,
			ownership,
			async () => {
				checkpoints++;
			},
			256,
		);

		expect(state.records[0]?.membership.railEdges).toHaveLength(50_000);
		expect(checkpoints).toBeGreaterThan(100);
		expect(staticFabOrganizationActivationMatches(activation, map, portEquipment, state)).toBe(
			true,
		);
	});

	it("retains the adopted 50k canonical generation through metadata history", async () => {
		const map = eastboundLineMap(50_000);
		const ownership = buildRailModuleOwnershipIndex(map);
		const portEquipment = emptyPortEquipmentState();
		const state = exactAreaState(ownership, "Factory Envelope");
		const activation = await validateStaticFabOrganizationActivation(
			map,
			portEquipment,
			state,
			ownership,
			async () => {},
		);
		const portEquipmentActivation = await validatePortEquipmentActivation(
			map,
			portEquipment,
			async () => {},
		);
		const document = RailDocument.fromCooperativelyValidatedMap(
			map,
			0,
			portEquipment,
			state,
			portEquipmentActivation,
			activation,
		);
		expect(document.organizations).toBe(state);

		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
			"North Production Hall",
		);
		expect(rename.valid, rename.reason).toBe(true);
		expect(document.commitOrganization(rename)).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.redo()).toBe(true);

		const protectedExtension = planRailConstruction(document.map, { x: -1, y: 0 }, { x: 0, y: 0 });
		expect(protectedExtension.valid, protectedExtension.reason).toBe(true);
		expect(document.commit(protectedExtension)).toBe(false);
		expect(document.getLastCommandError()).toContain("조직 메타데이터를 제거하거나 재할당");

		const remove = planRemoveStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
		);
		expect(remove.valid, remove.reason).toBe(true);
		expect(document.commitOrganization(remove)).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.redo()).toBe(true);
	});
});

function eastboundLineMap(edgeCount: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let x = 0; x <= edgeCount; x++) {
		hydrator.addEncodedCell(
			x,
			0,
			encodeRailCell({
				incoming: x === 0 ? 0 : DIR_W,
				outgoing: x === edgeCount ? 0 : DIR_E,
			}),
		);
	}
	return hydrator.finish(1);
}

function exactAreaState(
	ownership: RailModuleOwnershipIndex,
	name: string,
	equipmentGroupIds: readonly number[] = [],
): StaticFabOrganizationState {
	const edges = canonicalEdges(ownership.modules.flatMap((module) => module.eraseEdges));
	const switchIds = [
		...new Set(
			ownership.modules.flatMap((module) =>
				module.advancedSwitchId === null ? [] : [module.advancedSwitchId],
			),
		),
	].sort((left, right) => left - right);
	return copyStaticFabOrganizationState({
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AREA" as const,
				name,
				membership: {
					railEdges: edges,
					advancedSwitchIds: switchIds,
					equipmentGroupIds,
				},
			},
		],
	});
}

function areaState(
	name: string,
	railEdges: readonly DirectedRailEdge[],
	equipmentGroupIds: readonly number[] = [],
): StaticFabOrganizationState {
	return copyStaticFabOrganizationState({
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AREA" as const,
				name,
				membership: {
					railEdges,
					advancedSwitchIds: [],
					equipmentGroupIds,
				},
			},
		],
	});
}

function frozenState(
	nextOrganizationId: number,
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return copyStaticFabOrganizationState({ nextOrganizationId, records });
}

function canonicalEdges(edges: readonly DirectedRailEdge[]): readonly DirectedRailEdge[] {
	const unique = new Map<string, DirectedRailEdge>();
	for (const edge of edges) unique.set(staticFabOrganizationEdgeKey(edge), edge);
	return Object.freeze([...unique.values()].sort(compareDirectedRailEdges));
}
