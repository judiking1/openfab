import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "../core/RailModuleOwnership";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	compileStaticFabOrganizationOverview,
	deriveStaticFabOrganizationOverviewSnapshot,
	hydrateStaticFabOrganizationOverviewSnapshot,
	isStaticFabOrganizationOverview,
	STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS,
} from "./StaticFabOrganizationOverview";

describe("StaticFabOrganizationOverview", () => {
	it("derives canonical rail, port, and equipment extents without clipping equipment to rail", () => {
		const document = straightDocument(0, 4);
		const equipment = outsideRailOhb();
		const membership = wholeMembership(document.map, [1]);
		const organizations = organizationState([organization(1, "AREA", "North Area", membership)]);
		const source = sourceIdentity(document.map, equipment, organizations, 12);

		const overview = compileStaticFabOrganizationOverview(
			document.map,
			equipment,
			organizations,
			source,
		);

		expect(isStaticFabOrganizationOverview(overview)).toBe(true);
		expect(overview).toMatchObject({
			sourceRevision: document.map.getRevision(),
			sourceChecksum: source.checksum,
			sourceSequence: 12,
			counts: {
				organizationCount: 1,
				railEdgeCount: 4,
				advancedSwitchCount: 0,
				equipmentGroupCount: 1,
				portCount: 1,
			},
			railBounds: { minX: 0, minZ: 0, maxX: 5, maxZ: 1 },
		});
		expect(overview.readRailEdge(0)).toMatchObject({
			fromX: 0,
			fromZ: 0,
			toX: 1,
			toZ: 0,
		});
		const port = overview.readPort(0);
		expect(port.worldX).toBeCloseTo(2.5, 5);
		expect(port.worldZ).toBeCloseTo(4.5, 5);
		expect(overview.portBounds).toEqual(port.bounds);
		expect(overview.equipmentBounds?.maxZ).toBeGreaterThan(port.worldZ);
		expect(overview.bounds?.maxZ).toBe(overview.equipmentBounds?.maxZ);
		expect(overview.readEquipmentGroup(0)).toMatchObject({
			id: 1,
			kind: "OHB",
			portCount: 1,
			bodySectionCount: 1,
		});
		expect(overview.readEquipmentBodySection(0).equipmentGroupIndex).toBe(0);
		expect(overview.organizations[0]).toMatchObject({
			id: 1,
			parentOrganizationIds: [],
			direct: {
				counts: {
					organizationCount: 1,
					railEdgeCount: 4,
					advancedSwitchCount: 0,
					equipmentGroupCount: 1,
					portCount: 1,
				},
			},
		});
		expect(overview.organizations[0]?.direct.bounds?.maxZ).toBeGreaterThan(4.5);
		expect(overview.railSilhouette).toMatchObject({
			sourceCellCount: 5,
			sampleCount: 5,
			sampleStride: 1,
		});
	});

	it("deduplicates one shared descendant and its content in a multi-parent DAG", () => {
		const document = straightDocument(0, 4);
		const membership = wholeMembership(document.map);
		const organizations = organizationState([
			organization(1, "AREA", "North Area", membership),
			organization(2, "PROCESS_FAMILY", "Photo", membership),
			organization(3, "BAY", "Photo Bay", membership, [1, 2]),
		]);

		const overview = compileStaticFabOrganizationOverview(
			document.map,
			emptyPortEquipmentState(),
			organizations,
			sourceIdentity(document.map, emptyPortEquipmentState(), organizations, 7),
		);

		const [area, process, bay] = overview.organizations;
		expect(area?.effective.counts).toEqual({
			organizationCount: 2,
			railEdgeCount: 4,
			advancedSwitchCount: 0,
			equipmentGroupCount: 0,
			portCount: 0,
		});
		expect(process?.effective.counts).toEqual(area?.effective.counts);
		expect(bay?.parentOrganizationIds).toEqual([1, 2]);
		expect(bay?.effective.counts.organizationCount).toBe(1);
		expect(area?.effective.bounds).toEqual(area?.direct.bounds);
	});

	it("includes advanced-switch identity and claimed-cell world extents", () => {
		const document = straightDocument(-3, 0);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "D");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);
		const membership = wholeMembership(document.map);
		const organizations = organizationState([organization(1, "AREA", "Switch Area", membership)]);

		const overview = compileStaticFabOrganizationOverview(
			document.map,
			emptyPortEquipmentState(),
			organizations,
			sourceIdentity(document.map, emptyPortEquipmentState(), organizations, 3),
		);

		expect(overview.counts.advancedSwitchCount).toBe(1);
		const advancedSwitch = overview.readAdvancedSwitch(0);
		expect(advancedSwitch).toMatchObject({ id: 1, profileClass: "D", originX: 0, originZ: 0 });
		expect(advancedSwitch.bounds.maxX).toBeGreaterThan(advancedSwitch.bounds.minX);
		expect(advancedSwitch.bounds.maxZ).toBeGreaterThan(advancedSwitch.bounds.minZ);
		expect(overview.advancedSwitchBounds).toEqual(advancedSwitch.bounds);
		expect(overview.organizations[0]?.direct.counts.advancedSwitchCount).toBe(1);
		expect(overview.organizations[0]?.direct.bounds).toEqual(overview.bounds);
	});

	it("keeps organization ID stable while metadata-only source identity and metadata change", () => {
		const document = straightDocument(0, 4);
		const membership = wholeMembership(document.map);
		const beforeState = organizationState([organization(1, "AREA", "Area A", membership)]);
		const afterState = organizationState([
			{
				...organization(1, "AREA", "Area B", membership),
				properties: { description: "Renamed only", color: "VIOLET" },
			},
		]);
		const equipment = emptyPortEquipmentState();
		const beforeSource = sourceIdentity(document.map, equipment, beforeState, 20);
		const afterSource = sourceIdentity(document.map, equipment, afterState, 21);

		const before = compileStaticFabOrganizationOverview(
			document.map,
			equipment,
			beforeState,
			beforeSource,
		);
		const after = compileStaticFabOrganizationOverview(
			document.map,
			equipment,
			afterState,
			afterSource,
		);

		expect(before.sourceRevision).toBe(after.sourceRevision);
		expect(before.sourceChecksum).not.toBe(after.sourceChecksum);
		expect(before.sourceSequence).toBe(20);
		expect(after.sourceSequence).toBe(21);
		expect(after.organizations[0]).toMatchObject({
			id: 1,
			name: "Area B",
			description: "Renamed only",
			color: "VIOLET",
		});
		expect(after.organizations[0]?.direct).toEqual(before.organizations[0]?.direct);
		expect(after.organizations[0]?.effective).toEqual(before.organizations[0]?.effective);
	});

	it("supports an empty organization state without inventing overview records", () => {
		const document = straightDocument(0, 2);
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();

		const overview = compileStaticFabOrganizationOverview(
			document.map,
			equipment,
			organizations,
			sourceIdentity(document.map, equipment, organizations, 0),
		);

		expect(overview.organizations).toEqual([]);
		expect(overview.counts.organizationCount).toBe(0);
		expect(overview.bounds).toEqual({ minX: 0, minZ: 0, maxX: 3, maxZ: 1 });
		expect(overview.portBounds).toBeNull();
		expect(overview.equipmentBounds).toBeNull();
	});

	it("round-trips a closure-free transferable snapshot into the private read-only facade", () => {
		const document = straightDocument(0, 8);
		const equipment = outsideRailOhb();
		const organizations = organizationState([
			organization(1, "AREA", "Transfer Area", wholeMembership(document.map, [1])),
		]);
		const source = sourceIdentity(document.map, equipment, organizations, 33);
		const snapshot = deriveStaticFabOrganizationOverviewSnapshot(
			document.map,
			equipment,
			organizations,
			source,
		);
		const transfers = collectTransferableBuffers(snapshot);
		expect(transfers.length).toBeGreaterThan(20);
		const delivered = structuredClone(snapshot, { transfer: transfers });
		expect(snapshot.railEdges.fromXs.byteLength).toBe(0);

		const overview = hydrateStaticFabOrganizationOverviewSnapshot(delivered, source);
		expect(isStaticFabOrganizationOverview(overview)).toBe(true);
		expect(overview.fingerprint).toBe(delivered.fingerprint);
		expect(overview.counts).toEqual({
			organizationCount: 1,
			railEdgeCount: 8,
			advancedSwitchCount: 0,
			equipmentGroupCount: 1,
			portCount: 1,
		});
		expect(overview.organizations[0]?.name).toBe("Transfer Area");
		expect(overview.readRailEdge(7).toX).toBe(8);
	});

	it("owns hydrated snapshot columns instead of retaining caller-mutable buffers", () => {
		const document = straightDocument(0, 8);
		const equipment = outsideRailOhb();
		const organizations = organizationState([
			organization(1, "AREA", "Owned Area", wholeMembership(document.map, [1])),
		]);
		const source = sourceIdentity(document.map, equipment, organizations, 34);
		const derived = deriveStaticFabOrganizationOverviewSnapshot(
			document.map,
			equipment,
			organizations,
			source,
		);
		const delivered = {
			...derived,
			organizations: {
				...derived.organizations,
				names: [...derived.organizations.names],
				descriptions: [...derived.organizations.descriptions],
			},
		};
		const overview = hydrateStaticFabOrganizationOverviewSnapshot(delivered, source);

		const expectedBounds = overview.bounds;
		const expectedEdge = overview.readRailEdge(7);
		const expectedPort = overview.readPort(0);
		const expectedEquipment = overview.readEquipmentGroup(0);
		const expectedSilhouette = overview.railSilhouette.readCell(0);
		delivered.bounds[0] = 999;
		delivered.railEdges.toXs[7] = 999;
		delivered.railSilhouette.xs[0] = 999;
		delivered.ports.worldPositions[0] = 999;
		delivered.equipment.ids[0] = 999;
		delivered.organizations.names[0] = "Mutated Area";

		expect(overview.bounds).toEqual(expectedBounds);
		expect(overview.readRailEdge(7)).toEqual(expectedEdge);
		expect(overview.readPort(0)).toEqual(expectedPort);
		expect(overview.readEquipmentGroup(0)).toEqual(expectedEquipment);
		expect(overview.railSilhouette.readCell(0)).toEqual(expectedSilhouette);
		expect(overview.organizations[0]?.name).toBe("Owned Area");
	});

	it("rejects stale identity and malformed typed columns during main-thread hydration", () => {
		const document = straightDocument(0, 3);
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const source = sourceIdentity(document.map, equipment, organizations, 5);
		const snapshot = deriveStaticFabOrganizationOverviewSnapshot(
			document.map,
			equipment,
			organizations,
			source,
		);

		expect(() =>
			hydrateStaticFabOrganizationOverviewSnapshot(snapshot, { ...source, sequence: 6 }),
		).toThrow(/source sequence/i);
		expect(() =>
			hydrateStaticFabOrganizationOverviewSnapshot({
				...snapshot,
				railEdges: { ...snapshot.railEdges, toZs: new Int32Array(0) },
			}),
		).toThrow(/rail-edge to z columns.*malformed/i);
		const sharedBounds = new Float64Array(new SharedArrayBuffer(snapshot.bounds.byteLength));
		sharedBounds.set(snapshot.bounds);
		expect(() =>
			hydrateStaticFabOrganizationOverviewSnapshot({ ...snapshot, bounds: sharedBounds }),
		).toThrow(/overview bounds.*malformed/i);
		const forgedFromXs = snapshot.railEdges.fromXs.slice();
		forgedFromXs[0] = (forgedFromXs[0] as number) + 10;
		expect(() =>
			hydrateStaticFabOrganizationOverviewSnapshot({
				...snapshot,
				railEdges: { ...snapshot.railEdges, fromXs: forgedFromXs },
			}),
		).toThrow(/fingerprint is invalid/i);
	});

	it("rejects malformed rail and invalid empty organization records", () => {
		const brokenHydrator = TileMap.createHydrator();
		brokenHydrator.addEncodedCell(0, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		const brokenMap = brokenHydrator.finish(1);
		const equipment = emptyPortEquipmentState();
		const emptyOrganizations = emptyStaticFabOrganizationState();
		expect(() =>
			compileStaticFabOrganizationOverview(brokenMap, equipment, emptyOrganizations, {
				revision: brokenMap.getRevision(),
				checksum: checksumRailMap(brokenMap, equipment, emptyOrganizations),
				sequence: 0,
			}),
		).toThrow(/rail source is invalid/i);

		const document = straightDocument(0, 2);
		const invalidEmptyOrganization: StaticFabOrganizationState = {
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA",
					name: "Invented Empty Area",
					membership: { railEdges: [], advancedSwitchIds: [], equipmentGroupIds: [] },
				},
			],
		};
		expect(() =>
			compileStaticFabOrganizationOverview(document.map, equipment, invalidEmptyOrganization, {
				revision: document.map.getRevision(),
				checksum: "invalid-source-state",
				sequence: 0,
			}),
		).toThrow(/organization overview source is invalid/i);
	});

	it("caps a 50k-cell silhouette, preserves its whole extent, and ignores insertion order", () => {
		const forwardMap = snakeMap(250, 200, false);
		const reverseMap = snakeMap(250, 200, true);
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const checksum = checksumRailMap(forwardMap, equipment, organizations);
		expect(checksumRailMap(reverseMap, equipment, organizations)).toBe(checksum);

		const forward = compileStaticFabOrganizationOverview(forwardMap, equipment, organizations, {
			revision: 41,
			checksum,
			sequence: 9,
		});
		const reverse = compileStaticFabOrganizationOverview(reverseMap, equipment, organizations, {
			revision: 41,
			checksum,
			sequence: 9,
		});

		const silhouette = forward.railSilhouette;
		expect(silhouette.sourceCellCount).toBe(50_000);
		expect(silhouette.sampleCap).toBe(STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS);
		expect(silhouette.sampleStride).toBe(Math.ceil(50_000 / 8_192));
		expect(silhouette.sampleCount).toBeLessThanOrEqual(8_192);
		expect(silhouette.readCell(0)).toMatchObject({ x: 0, z: 0 });
		expect(silhouette.readCell(silhouette.sampleCount - 1)).toMatchObject({
			x: 249,
			z: 199,
		});
		expect(forward.bounds).toEqual({ minX: 0, minZ: 0, maxX: 250, maxZ: 200 });
		expect(reverse.bounds).toEqual(forward.bounds);
		expect(reverse.railSilhouette.copyXs()).toEqual(silhouette.copyXs());
		expect(reverse.railSilhouette.copyZs()).toEqual(silhouette.copyZs());

		const sampledXs = new Set<number>();
		const sampledZs = new Set<number>();
		silhouette.forEachCell((x, z) => {
			sampledXs.add(x);
			sampledZs.add(z);
		});
		expect(sampledXs.size).toBe(250);
		expect(sampledZs.size).toBe(200);

		const detached = silhouette.copyXs();
		detached[0] = 999;
		expect(silhouette.readX(0)).toBe(0);
	}, 30_000);
});

function straightDocument(fromX: number, toX: number): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: fromX, y: 0 }, { x: toX, y: 0 });
	if (!plan.valid || !document.commit(plan))
		throw new Error(`Straight fixture failed: ${plan.reason}`);
	return document;
}

function outsideRailOhb(): PortEquipmentState {
	return {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 4_000,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-OUTSIDE-RAIL",
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	};
}

function organization(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	membership: StaticFabOrganizationMembership,
	parentOrganizationIds: readonly number[] = [],
): StaticFabOrganizationRecord {
	return {
		id,
		kind,
		name,
		parentOrganizationIds,
		membership,
	};
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return copyStaticFabOrganizationState({
		nextOrganizationId: Math.max(0, ...records.map((record) => record.id)) + 1,
		records,
	});
}

function wholeMembership(
	map: TileMap,
	equipmentGroupIds: readonly number[] = [],
): StaticFabOrganizationMembership {
	const edgesByKey = new Map<string, DirectedRailEdge>();
	const advancedSwitchIds = new Set<number>();
	for (const module of buildRailModuleOwnershipIndex(map).modules) {
		for (const edge of module.eraseEdges) edgesByKey.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) advancedSwitchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edgesByKey.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...advancedSwitchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function sourceIdentity(
	map: TileMap,
	equipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	sequence: number,
) {
	return {
		revision: map.getRevision(),
		checksum: checksumRailMap(map, equipment, organizations),
		sequence,
	};
}

function snakeMap(width: number, height: number, reverseInsertion: boolean): TileMap {
	const hydrator = TileMap.createHydrator();
	const cellCount = width * height;
	for (let step = 0; step < cellCount; step++) {
		const rowMajor = reverseInsertion ? cellCount - 1 - step : step;
		const x = rowMajor % width;
		const z = Math.floor(rowMajor / width);
		const incoming = snakeIncoming(x, z, width);
		const outgoing = snakeOutgoing(x, z, width, height);
		hydrator.addEncodedCell(x, z, encodeRailCell({ incoming, outgoing }));
	}
	return hydrator.finish(41);
}

function snakeIncoming(x: number, z: number, width: number): 0 | Direction {
	if ((z & 1) === 0) {
		if (x > 0) return DIR_W;
		return z === 0 ? 0 : DIR_N;
	}
	if (x < width - 1) return DIR_E;
	return DIR_N;
}

function snakeOutgoing(x: number, z: number, width: number, height: number): 0 | Direction {
	if ((z & 1) === 0) {
		if (x < width - 1) return DIR_E;
		return z < height - 1 ? DIR_S : 0;
	}
	if (x > 0) return DIR_W;
	return z < height - 1 ? DIR_S : 0;
}
