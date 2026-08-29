import { describe, expect, it, vi } from "vitest";
import { deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { encodeRailCell, type TileMap, TileMap as TileMapClass } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import * as physicalCompiler from "./PhysicalRailCompiler";
import * as presentationCompiler from "./PortEquipmentPresentation";
import {
	collectStaticFabOrganizationOutlineIndexSnapshotTransferables,
	deriveStaticFabOrganizationOutlineIndexSnapshotFromValidatedSource,
	hydrateStaticFabOrganizationOutlineIndexSnapshot,
	isStaticFabOrganizationOutlineIndex,
	STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES,
	type StaticFabOrganizationOutlineBounds,
	type StaticFabOrganizationOutlineIndexSnapshot,
	type StaticFabOrganizationOutlineIndexSourceIdentity,
} from "./StaticFabOrganizationOutlineIndex";

describe("StaticFabOrganizationOutlineIndex", () => {
	it("captures only semantic rail/switch envelopes and supports deterministic effective queries", () => {
		const fixture = overlappingHierarchyFixture();
		const physicalCompile = vi.spyOn(physicalCompiler, "compilePhysicalRail");
		const presentationCompile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");

		const snapshot = deriveSnapshot(fixture);

		expect(physicalCompile).not.toHaveBeenCalled();
		expect(presentationCompile).not.toHaveBeenCalled();
		expect([...snapshot.organizationIds]).toEqual([1, 2, 3, 5, 6, 7]);
		expect(snapshot.directBounds).toHaveLength(6 * 4);
		expect(snapshot.effectiveBounds).toHaveLength(6 * 4);
		expect(snapshot.bvh.leafOrganizationRows).toHaveLength(6);
		const transferables = collectStaticFabOrganizationOutlineIndexSnapshotTransferables(snapshot);
		expect(transferables).toHaveLength(8);
		expect(transferables).toEqual(collectTransferableBuffers(snapshot));
		const physicalBuffers = new Set(collectTransferableBuffers(fixture.physical));
		expect(transferables.every((buffer) => !physicalBuffers.has(buffer))).toBe(true);

		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(snapshot, fixture.source);
		expect(isStaticFabOrganizationOutlineIndex(index)).toBe(true);
		expect(index).toMatchObject({
			sourceRevision: fixture.source.revision,
			sourceChecksum: fixture.source.checksum,
			sourceSequence: fixture.source.sequence,
			sourceNextAdvancedSwitchId: fixture.source.nextAdvancedSwitchId,
			sourceNextPortId: fixture.source.nextPortId,
			sourceNextEquipmentGroupId: fixture.source.nextEquipmentGroupId,
			sourceNextOrganizationId: fixture.source.nextOrganizationId,
			sourcePhysicalSequence: fixture.source.physicalSequence,
			sourcePhysicalRevision: fixture.source.physicalRevision,
			sourcePhysicalFingerprint: fixture.source.physicalFingerprint,
			organizationCount: 6,
			indexedOrganizationCount: 6,
		});
		expect(index.byteLength).toBe(
			transferables.reduce((total, buffer) => total + buffer.byteLength, 0),
		);
		expect(Array.from({ length: 6 }, (_, row) => index.readOrganizationRole(row))).toEqual([
			"FAB",
			"BAY_BANK",
			"BAY",
			"FAB",
			"BAY_BANK",
			"BAY",
		]);

		const bounds = scratchBounds();
		expect(index.readOrganizationBounds(0, "DIRECT", bounds)).toBe(true);
		expect(bounds).toEqual({ minX: 0, minZ: 0, maxX: 2, maxZ: 1 });
		expect(index.readOrganizationBounds(0, "EFFECTIVE", bounds)).toBe(true);
		expect(bounds).toEqual({ minX: 0, minZ: 0, maxX: 11, maxZ: 1 });

		const rows = new Int32Array(index.organizationCount);
		expect(index.queryBounds({ minX: 0, minZ: 0, maxX: 2, maxZ: 1 }, rows)).toBe(1);
		expect([...rows.slice(0, 1)]).toEqual([0]);
		expect(index.queryPoint(9.5, 0.5, rows)).toBe(2);
		// Only the highest-priority role enters the chooser; size, then ID order is stable.
		expect([...rows.slice(0, 2)]).toEqual([2, 5]);
		expect(index.hitTest(9.5, 0.5)).toBe(2);
		expect(index.queryBounds({ minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, rows)).toBe(6);
		expect([...rows].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(() => index.queryPoint(0, 0, new Int32Array(5))).toThrow(/needs 6 rows/i);
		physicalCompile.mockRestore();
		presentationCompile.mockRestore();
	});

	it("includes pure authored cardinal equipment-body bounds without compiling presentation", () => {
		const segments = [
			{ x: 0, z: 0 },
			{ x: 3, z: 0 },
			{ x: 6, z: 0 },
			{ x: 9, z: 0 },
		] as const;
		const map = segmentMap(segments, 29);
		const equipment = outsideRailOhb(segments[2]);
		const organizations = organizationState([
			organization(1, "AREA", "Equipment Fab", [segments[0]]),
			organization(2, "AREA", "Equipment Bank", [segments[1]], [1]),
			organization(3, "BAY", "Equipment Bay", [segments[2]], [2], [1]),
			organization(4, "AISLE", "Equipment Loop", [segments[3]], [3]),
		]);
		const fixture = fixtureFrom(map, organizations, equipment, 5);
		const presentationCompile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");

		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(
			deriveSnapshot(fixture),
			fixture.source,
		);

		expect(presentationCompile).not.toHaveBeenCalled();
		const bounds = scratchBounds();
		expect(index.readOrganizationBounds(2, "DIRECT", bounds)).toBe(true);
		expect(bounds).toEqual({ minX: 6, minZ: 0, maxX: 8, maxZ: 4.95 });
		expect(index.readOrganizationBounds(0, "EFFECTIVE", bounds)).toBe(true);
		expect(bounds.maxZ).toBe(4.95);

		const terminalFixture = fixtureFrom(map, organizations, outsideRailOhb(segments[2], true), 6);
		const terminalIndex = hydrateStaticFabOrganizationOutlineIndexSnapshot(
			deriveSnapshot(terminalFixture),
			terminalFixture.source,
		);
		expect(terminalIndex.readOrganizationBounds(2, "DIRECT", bounds)).toBe(true);
		expect(bounds).toEqual({ minX: 2.5, minZ: -4.5, maxX: 12.5, maxZ: 5.5 });
		presentationCompile.mockRestore();
	});

	it("pads only the referenced advanced-switch envelope for an offset OHB body", () => {
		const document = advancedSwitchDocument();
		const map = document.map;
		const equipment = advancedSwitchOhb();
		const bay = organization(3, "BAY", "Switch Bay", [], [2], [1]);
		const organizations = organizationState([
			organization(1, "AREA", "Switch Fab", [{ x: -3, z: 0 }]),
			organization(2, "AREA", "Switch Bank", [{ x: -2, z: 0 }], [1]),
			{
				...bay,
				membership: { ...bay.membership, advancedSwitchIds: [1] },
			},
			organization(4, "AISLE", "Switch Loop", [{ x: -1, z: 0 }], [3]),
		]);
		const fixture = fixtureFrom(map, organizations, equipment, 13);
		const switchIteration = vi.spyOn(map, "forEachAdvancedSwitch");
		const presentationCompile = vi.spyOn(presentationCompiler, "compilePortEquipmentPresentation");

		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(
			deriveSnapshot(fixture),
			fixture.source,
		);

		expect(switchIteration).not.toHaveBeenCalled();
		expect(presentationCompile).not.toHaveBeenCalled();
		const advancedSwitch = map.getAdvancedSwitch(1);
		if (!advancedSwitch) throw new Error("Missing advanced-switch fixture.");
		const cells = deriveAdvancedSwitchGeometry(advancedSwitch).claimedCells;
		const padding = 4.5;
		const expected = {
			minX: Math.min(...cells.map((cell) => cell.x)) - padding,
			minZ: Math.min(...cells.map((cell) => cell.y)) - padding,
			maxX: Math.max(...cells.map((cell) => cell.x + 1)) + padding,
			maxZ: Math.max(...cells.map((cell) => cell.y + 1)) + padding,
		};
		const bounds = scratchBounds();
		expect(index.readOrganizationBounds(2, "DIRECT", bounds)).toBe(true);
		expect(bounds).toEqual(expected);
		switchIteration.mockRestore();
		presentationCompile.mockRestore();
	});

	it("keeps authored organization selection available for an identity-bound invalid physical publication", () => {
		const segments = [
			{ x: 0, z: 0 },
			{ x: 3, z: 0 },
			{ x: 6, z: 0 },
			{ x: 9, z: 0 },
		] as const;
		const map = segmentMap(segments, 37, { x: 100, z: 100 });
		const organizations = organizationState([
			organization(1, "AREA", "Invalid Rail Fab", [segments[0]]),
			organization(2, "AREA", "Invalid Rail Bank", [segments[1]], [1]),
			organization(3, "BAY", "Invalid Rail Bay", [segments[2]], [2]),
			organization(4, "AISLE", "Invalid Rail Loop", [segments[3]], [3]),
		]);
		const fixture = fixtureFrom(map, organizations, emptyPortEquipmentState(), 6, true);
		expect(fixture.physical.valid).toBe(false);

		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(
			deriveSnapshot(fixture),
			fixture.source,
		);
		expect(index.organizationCount).toBe(3);
		expect(index.hitTest(9.5, 0.5)).toBe(2);
	});

	it("retains semantic rows with null direct/effective bounds outside the effective BVH", () => {
		const map = segmentMap([{ x: 100, z: 100 }], 31);
		const records = [
			organization(1, "AREA", "Empty Fab", []),
			organization(2, "AREA", "Empty Bank", [], [1]),
			organization(3, "BAY", "Empty Bay", [], [2]),
			organization(4, "AISLE", "Empty Loop", [], [3]),
		];
		// The fast entry point accepts already-validated state. This deliberately forged source only
		// exercises the snapshot's defensive finite-or-null transport contract.
		const organizations: StaticFabOrganizationState = { nextOrganizationId: 5, records };
		const fixture = fixtureFrom(map, organizations, emptyPortEquipmentState(), 4);
		const snapshot = deriveSnapshot(fixture);
		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(snapshot, fixture.source);

		expect(index.organizationCount).toBe(3);
		expect(index.indexedOrganizationCount).toBe(0);
		expect(index.bvhNodeCount).toBe(0);
		expect(snapshot.bvh.rootNode).toBe(-1);
		const untouched = { minX: 1, minZ: 2, maxX: 3, maxZ: 4 };
		expect(index.readOrganizationBounds(0, "DIRECT", untouched)).toBe(false);
		expect(index.readOrganizationBounds(0, "EFFECTIVE", untouched)).toBe(false);
		expect(untouched).toEqual({ minX: 1, minZ: 2, maxX: 3, maxZ: 4 });
		const rows = new Int32Array(index.organizationCount);
		expect(index.queryBounds({ minX: -1, minZ: -1, maxX: 1, maxZ: 1 }, rows)).toBe(0);
		expect(index.queryPoint(0, 0, rows)).toBe(0);
		expect(index.hitTest(0, 0)).toBe(-1);
	});

	it("adopts transferred columns by value and never retains caller-owned buffers", () => {
		const fixture = overlappingHierarchyFixture();
		const snapshot = deriveSnapshot(fixture);
		const transferred = structuredClone(snapshot, {
			transfer: collectStaticFabOrganizationOutlineIndexSnapshotTransferables(snapshot),
		});
		expect(snapshot.organizationIds.byteLength).toBe(0);
		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(transferred, fixture.source);
		const beforeFingerprint = index.fingerprint;
		const bounds = scratchBounds();
		expect(index.readOrganizationBounds(0, "EFFECTIVE", bounds)).toBe(true);
		const beforeBounds = { ...bounds };

		transferred.organizationIds[0] = 99;
		transferred.organizationRoles[0] = 2;
		transferred.effectiveBounds.fill(123);
		transferred.bvh.bounds.fill(456);

		expect(index.fingerprint).toBe(beforeFingerprint);
		expect(index.readOrganizationId(0)).toBe(1);
		expect(index.readOrganizationRole(0)).toBe("FAB");
		expect(index.readOrganizationBounds(0, "EFFECTIVE", bounds)).toBe(true);
		expect(bounds).toEqual(beforeBounds);
	});

	it("exact-matches the authored cursors and physical publication identity on hydration", () => {
		const fixture = overlappingHierarchyFixture();
		const snapshot = deriveSnapshot(fixture);
		const cases: Array<{
			label: string;
			expected: StaticFabOrganizationOutlineIndexSourceIdentity;
		}> = [
			{
				label: "revision",
				expected: {
					...fixture.source,
					revision: fixture.source.revision + 1,
					physicalRevision: fixture.source.physicalRevision + 1,
				},
			},
			{
				label: "checksum",
				expected: { ...fixture.source, checksum: `${fixture.source.checksum}-stale` },
			},
			{
				label: "sequence",
				expected: {
					...fixture.source,
					sequence: fixture.source.sequence + 1,
					physicalSequence: fixture.source.physicalSequence + 1,
				},
			},
			{
				label: "nextAdvancedSwitchId",
				expected: {
					...fixture.source,
					nextAdvancedSwitchId: fixture.source.nextAdvancedSwitchId + 1,
				},
			},
			{
				label: "nextPortId",
				expected: { ...fixture.source, nextPortId: fixture.source.nextPortId + 1 },
			},
			{
				label: "nextEquipmentGroupId",
				expected: {
					...fixture.source,
					nextEquipmentGroupId: fixture.source.nextEquipmentGroupId + 1,
				},
			},
			{
				label: "nextOrganizationId",
				expected: {
					...fixture.source,
					nextOrganizationId: fixture.source.nextOrganizationId + 1,
				},
			},
			{
				label: "physicalFingerprint",
				expected: { ...fixture.source, physicalFingerprint: "00000000:00000000" },
			},
		];
		for (const testCase of cases) {
			expect(
				() => hydrateStaticFabOrganizationOutlineIndexSnapshot(snapshot, testCase.expected),
				testCase.label,
			).toThrow(new RegExp(`source ${testCase.label} does not match`, "i"));
		}
	});

	it("rejects partial views, shared buffers, invalid optional bounds, and forged fingerprints", () => {
		const fixture = overlappingHierarchyFixture();
		const snapshot = deriveSnapshot(fixture);

		const partialIdsStorage = new Int32Array(snapshot.organizationIds.length + 1);
		partialIdsStorage.set(snapshot.organizationIds);
		const partialIds = partialIdsStorage.subarray(0, snapshot.organizationIds.length);
		expect(() =>
			hydrateStaticFabOrganizationOutlineIndexSnapshot({
				...snapshot,
				organizationIds: partialIds,
			}),
		).toThrow(/organization IDs are malformed/i);

		const sharedRoles = new Uint8Array(
			new SharedArrayBuffer(snapshot.organizationRoles.byteLength),
		);
		sharedRoles.set(snapshot.organizationRoles);
		expect(() =>
			hydrateStaticFabOrganizationOutlineIndexSnapshot({
				...snapshot,
				organizationRoles: sharedRoles,
			}),
		).toThrow(/organization roles are malformed/i);

		const partialNull = cloneSnapshot(snapshot);
		partialNull.directBounds[0] = Number.NaN;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(partialNull)).toThrow(
			/direct bounds row 0 is invalid/i,
		);

		const escapedDirect = cloneSnapshot(snapshot);
		escapedDirect.directBounds[2] = 1_000;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(escapedDirect)).toThrow(
			/effective bounds row 0 do not contain direct bounds/i,
		);

		const forgedRole = cloneSnapshot(snapshot);
		forgedRole.organizationRoles[0] = 1;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(forgedRole)).toThrow(
			/fingerprint is invalid/i,
		);
	});

	it("rejects malformed packed-BVH CSR, topology, coverage, and node bounds", () => {
		const fixture = overlappingHierarchyFixture();
		const snapshot = deriveSnapshot(fixture);
		expect(snapshot.bvh.childNodes.length / 2).toBeGreaterThan(1);

		const brokenCsr = cloneSnapshot(snapshot);
		brokenCsr.bvh.leafOrganizationOffsets[2] = 99;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(brokenCsr)).toThrow(
			/leaf CSR row/i,
		);

		const repeatedChild = cloneSnapshot(snapshot);
		repeatedChild.bvh.childNodes[1] = repeatedChild.bvh.childNodes[0] as number;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(repeatedChild)).toThrow(
			/BVH branch 0 is malformed/i,
		);

		const duplicateOrganization = cloneSnapshot(snapshot);
		duplicateOrganization.bvh.leafOrganizationRows[1] = duplicateOrganization.bvh
			.leafOrganizationRows[0] as number;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(duplicateOrganization)).toThrow(
			/BVH organization row .* is invalid/i,
		);

		const wrongRootBounds = cloneSnapshot(snapshot);
		wrongRootBounds.bvh.bounds[2] = (wrongRootBounds.bvh.bounds[2] as number) + 1;
		expect(() => hydrateStaticFabOrganizationOutlineIndexSnapshot(wrongRootBounds)).toThrow(
			/BVH branch 0 bounds are invalid/i,
		);
	});

	it("bounds dense same-role point overlaps to a deterministic chooser capacity", () => {
		const segment = { x: 0, z: 0 } as const;
		const bayCount = STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES + 6;
		const bayRecords = Array.from({ length: bayCount }, (_, index) =>
			organization(index + 3, "BAY", `Bay ${index + 1}`, [segment], [2]),
		);
		const loopRecords = Array.from({ length: bayCount }, (_, index) =>
			organization(index + 3 + bayCount, "AISLE", `Loop ${index + 1}`, [segment], [index + 3]),
		);
		const fixture = fixtureFrom(
			segmentMap([segment], 72),
			organizationState([
				organization(1, "AREA", "Dense Fab", [segment]),
				organization(2, "AREA", "Dense Bank", [segment], [1]),
				...bayRecords,
				...loopRecords,
			]),
			emptyPortEquipmentState(),
			12,
		);
		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(
			deriveSnapshot(fixture),
			fixture.source,
		);
		const rows = new Int32Array(STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES);
		expect(index.queryPoint(0.5, 0.5, rows)).toBe(
			STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES,
		);
		expect([...rows]).toEqual(
			Array.from(
				{ length: STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES },
				(_, index) => index + 2,
			),
		);
		expect(index.hitTest(0.5, 0.5)).toBe(2);
		expect(() => index.queryPoint(0.5, 0.5, new Int32Array(rows.length - 1))).toThrow(
			/needs 64 rows/i,
		);
	});

	it("preserves negative and huge finite direct/effective extents", () => {
		const huge = 8_000_000;
		const segments = [
			{ x: -huge, z: -huge },
			{ x: -huge / 2, z: -huge / 2 },
			{ x: huge / 2, z: huge / 2 },
			{ x: huge, z: huge },
		];
		const map = segmentMap(segments, 73);
		const organizations = organizationState([
			organization(1, "AREA", "Huge Fab", [segments[0] as Segment]),
			organization(2, "AREA", "Huge Bank", [segments[1] as Segment], [1]),
			organization(3, "BAY", "Huge Bay", [segments[2] as Segment], [2]),
			organization(4, "AISLE", "Huge Loop", [segments[3] as Segment], [3]),
		]);
		const fixture = fixtureFrom(map, organizations, emptyPortEquipmentState(), 11);
		const index = hydrateStaticFabOrganizationOutlineIndexSnapshot(
			deriveSnapshot(fixture),
			fixture.source,
		);
		const bounds = scratchBounds();
		expect(index.readOrganizationBounds(0, "DIRECT", bounds)).toBe(true);
		expect(bounds).toEqual({ minX: -huge, minZ: -huge, maxX: -huge + 2, maxZ: -huge + 1 });
		expect(index.readOrganizationBounds(0, "EFFECTIVE", bounds)).toBe(true);
		expect(bounds).toEqual({ minX: -huge, minZ: -huge, maxX: huge + 2, maxZ: huge + 1 });
		const rows = new Int32Array(index.organizationCount);
		expect(index.queryPoint(huge + 1, huge + 0.5, rows)).toBe(1);
		expect(rows[0]).toBe(2);
		expect(
			index.queryBounds({ minX: -huge, minZ: -huge, maxX: -huge + 2, maxZ: -huge + 1 }, rows),
		).toBe(1);
		expect(rows[0]).toBe(0);
	});
});

interface Segment {
	readonly x: number;
	readonly z: number;
}

interface OutlineFixture {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly physical: physicalCompiler.CompiledPhysicalLayout;
	readonly source: StaticFabOrganizationOutlineIndexSourceIdentity;
}

function overlappingHierarchyFixture(): OutlineFixture {
	const segments = [
		{ x: 0, z: 0 },
		{ x: 3, z: 0 },
		{ x: 6, z: 0 },
		{ x: 9, z: 0 },
		{ x: 15, z: 5 },
		{ x: 18, z: 5 },
		{ x: 8, z: -2 },
		{ x: 8, z: 2 },
		{ x: 24, z: 5 },
		{ x: 30, z: 0 },
	] as const;
	const map = segmentMap(segments, 51);
	const organizations = organizationState([
		organization(1, "AREA", "Fab One", [segments[0]]),
		organization(2, "AREA", "Bank One", [segments[1]], [1]),
		organization(3, "BAY", "Bay One", [segments[2]], [2]),
		organization(4, "AISLE", "Loop One", [segments[3]], [3]),
		organization(5, "AREA", "Fab Two", [segments[4]]),
		organization(6, "AREA", "Bank Two", [segments[5]], [5]),
		organization(7, "BAY", "Bay Two", [segments[6], segments[7]], [6]),
		organization(8, "AISLE", "Loop Two", [segments[8]], [7]),
		organization(9, "PROCESS_FAMILY", "Unlisted Family", [segments[9]]),
	]);
	return fixtureFrom(map, organizations, emptyPortEquipmentState(), 9);
}

function fixtureFrom(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	portEquipment: PortEquipmentState,
	sequence: number,
	allowInvalidPhysical = false,
): OutlineFixture {
	const physical = physicalCompiler.compilePhysicalRail(map, map.getRevision());
	if (!physical.valid && !allowInvalidPhysical) {
		throw new Error(
			`Outline physical fixture is invalid: ${physical.diagnostics[0]?.message ?? "?"}`,
		);
	}
	const source = {
		revision: map.getRevision(),
		checksum: checksumRailMap(map, portEquipment, organizations),
		sequence,
		nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
		nextPortId: portEquipment.nextPortId,
		nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
		nextOrganizationId: organizations.nextOrganizationId,
		physicalSequence: sequence,
		physicalRevision: physical.revision,
		physicalFingerprint: checksumRailPhysicalLayout(physical),
	} satisfies StaticFabOrganizationOutlineIndexSourceIdentity;
	return { map, portEquipment, organizations, physical, source };
}

function deriveSnapshot(fixture: OutlineFixture): StaticFabOrganizationOutlineIndexSnapshot {
	return deriveStaticFabOrganizationOutlineIndexSnapshotFromValidatedSource(
		fixture.map,
		fixture.portEquipment,
		fixture.organizations,
		fixture.source,
		fixture.physical,
	);
}

function segmentMap(segments: readonly Segment[], revision: number, dangling?: Segment): TileMap {
	const hydrator = TileMapClass.createHydrator();
	for (const segment of segments) {
		hydrator.addEncodedCell(segment.x, segment.z, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		hydrator.addEncodedCell(
			segment.x + 1,
			segment.z,
			encodeRailCell({ incoming: DIR_W, outgoing: 0 }),
		);
	}
	if (dangling) {
		hydrator.addEncodedCell(
			dangling.x,
			dangling.z,
			encodeRailCell({ incoming: 0, outgoing: DIR_E }),
		);
	}
	return hydrator.finish(revision);
}

function organization(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	segments: readonly Segment[],
	parentOrganizationIds: readonly number[] = [],
	equipmentGroupIds: readonly number[] = [],
): StaticFabOrganizationRecord {
	return {
		id,
		kind,
		name,
		parentOrganizationIds,
		membership: membership(segments, equipmentGroupIds),
	};
}

function membership(
	segments: readonly Segment[],
	equipmentGroupIds: readonly number[] = [],
): StaticFabOrganizationMembership {
	const railEdges: DirectedRailEdge[] = segments.map((segment) => ({
		from: { x: segment.x, y: segment.z },
		to: { x: segment.x + 1, y: segment.z },
	}));
	railEdges.sort(compareDirectedRailEdges);
	return {
		railEdges,
		advancedSwitchIds: [],
		equipmentGroupIds,
	};
}

function outsideRailOhb(route: Segment, terminal = false): PortEquipmentState {
	return {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: {
					kind: "CARDINAL_CELL",
					x: terminal ? route.x + 1 : route.x,
					z: route.z,
					from: terminal ? DIR_W : 0,
					to: terminal ? 0 : DIR_E,
				},
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

function advancedSwitchOhb(): PortEquipmentState {
	return {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: {
					kind: "ADVANCED_SWITCH_SEGMENT",
					switchId: 1,
					profileClass: "D",
					role: "THROAT",
					portIndex: null,
					segmentOrdinal: 0,
				},
				stationMillimeters: 0,
				side: "LEFT",
				lateralOffsetMillimeters: 4_000,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-SWITCH-OFFSET",
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	};
}

function advancedSwitchDocument(): RailDocument {
	const document = new RailDocument();
	commitRail(document, { x: -3, y: 0 }, { x: 0, y: 0 });
	const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "D");
	if (!switchPlan.valid || !document.commit(switchPlan)) {
		throw new Error(`Advanced-switch fixture failed: ${switchPlan.reason}`);
	}
	return document;
}

function commitRail(
	document: RailDocument,
	from: { readonly x: number; readonly y: number },
	to: { readonly x: number; readonly y: number },
): void {
	const plan = planRailConstruction(document.map, from, to);
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Rail fixture failed: ${plan.reason}`);
	}
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return copyStaticFabOrganizationState({
		nextOrganizationId: Math.max(0, ...records.map((record) => record.id)) + 1,
		records,
	});
}

function scratchBounds(): StaticFabOrganizationOutlineBounds {
	return { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
}

function cloneSnapshot(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
): StaticFabOrganizationOutlineIndexSnapshot {
	return structuredClone(snapshot);
}
