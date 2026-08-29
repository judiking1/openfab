import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import { emptyStaticFabOrganizationState } from "../core/StaticFabOrganization";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	captureRailMirrorSnapshot,
	checksumRailMirrorSnapshot,
	checksumRailMirrorSnapshotDiagnostic,
} from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import { prepareStaticFabOrganizationOverview } from "./StaticFabOrganizationOverviewRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

describe("StaticFabOrganizationOverviewRuntime", () => {
	it("hydrates and derives a transferable 50k-cell exact overview inside the runtime", () => {
		const map = snakeMap(250, 200);
		const capture = captureRailMirrorSnapshot(
			map,
			9,
			emptyPortEquipmentState(),
			emptyStaticFabOrganizationState(),
		);
		let clock = 40;
		const prepared = prepareStaticFabOrganizationOverview(
			{
				type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
				requestId: 17,
				snapshot: capture.snapshot,
				source: sourceOf(capture.snapshot),
				expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
			},
			() => {
				clock += 5;
				return clock;
			},
		);

		expect(prepared).toMatchObject({
			sourceRevision: 41,
			sourceSequence: 9,
			sourceChecksum: capture.snapshot.checksum,
			preparationMilliseconds: 5,
		});
		expect(prepared.overviewSnapshot).not.toBeNull();
		const overview = prepared.overviewSnapshot;
		if (!overview) throw new Error("Expected overview snapshot.");
		expect(overview.railSilhouette).toMatchObject({
			sourceCellCount: 50_000,
			sampleStride: Math.ceil(50_000 / 8_192),
		});
		expect(overview.railSilhouette.xs.length).toBeLessThanOrEqual(8_192);
		expect(overview.counts[1]).toBe(49_999);
		expect(prepared.checksSnapshot.sourceNextAdvancedSwitchId).toBe(1);
		const transfers = collectTransferableBuffers(prepared);
		expect(transfers.length).toBeGreaterThan(20);
		const delivered = structuredClone(prepared, { transfer: transfers });
		expect(delivered.overviewSnapshot).not.toBeNull();
		expect(delivered.overviewSnapshot?.railSilhouette.xs).toBeInstanceOf(Int32Array);
		expect(delivered.overviewSnapshot?.railSilhouette.sourceCellCount).toBe(50_000);
		expect(delivered.checksSnapshot.locationBounds).toBeInstanceOf(Float64Array);
		expect(delivered.checksSnapshot.issueOccurrenceOffsets).toBeInstanceOf(Uint32Array);
		expect(delivered.checksSnapshot.occurrenceDetails).toBeInstanceOf(Array);
		expect(delivered.checksSnapshot.locationRecordIndexes).toBeInstanceOf(Int32Array);
		expect(delivered.checksSnapshot.locationOccurrenceIndexes).toBeInstanceOf(Uint32Array);
		expect(delivered.checksSnapshot.locationDetailIndexes).toBeInstanceOf(Uint32Array);
		expect(delivered.checksSnapshot.locationDetails).toBeInstanceOf(Array);
		expect(delivered.checksSnapshot.locationRelatedKinds).toBeInstanceOf(Uint8Array);
		expect(delivered.checksSnapshot.locationRelatedEntityIds).toBeInstanceOf(Int32Array);
		expect(delivered.checksSnapshot.locationRelatedRecordIndexes).toBeInstanceOf(Int32Array);
		expect(delivered.checksSnapshot.locationTokenIndexes).toBeInstanceOf(Uint32Array);
		expect(delivered.checksSnapshot.locationTokens).toBeInstanceOf(Array);
		expect(delivered.checksSnapshot.locationMeasuredValues).toBeInstanceOf(Float64Array);
		expect(delivered.checksSnapshot.locationRequiredValues).toBeInstanceOf(Float64Array);
		expect(delivered.checksSnapshot.locationMeasurementUnits).toBeInstanceOf(Uint8Array);
		expect(delivered.checksSnapshot.locationMeasurementRelations).toBeInstanceOf(Uint8Array);
	}, 30_000);

	it("keeps 10,000 distinct rail routes and OHB ports within a bounded linear Worker budget", () => {
		const portCount = 10_000;
		const map = snakeMap(portCount * 2 + 1, 1);
		const equipment = manyOhbState(portCount);
		const capture = captureRailMirrorSnapshot(
			map,
			10,
			equipment,
			emptyStaticFabOrganizationState(),
		);
		const startedAt = performance.now();
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 18,
			snapshot: capture.snapshot,
			source: sourceOf(capture.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
		});
		const elapsedMilliseconds = performance.now() - startedAt;

		expect(prepared.overviewError).toBeNull();
		expect(prepared.overviewSnapshot?.counts[4]).toBe(portCount);
		expect(prepared.checksSnapshot.summary[4]).toBe(portCount);
		expect(prepared.checksSnapshot.summary[5]).toBe(0);
		expect(elapsedMilliseconds).toBeLessThan(8_000);
	}, 15_000);

	it("groups 10,000 unreachable stations into compact issue rows with every exact occurrence", () => {
		const portCount = 10_000;
		const map = snakeMap(portCount * 2 + 1, 1);
		const equipment = manyOhbState(portCount, 100_000);
		const capture = captureRailMirrorSnapshot(
			map,
			11,
			equipment,
			emptyStaticFabOrganizationState(),
		);
		const startedAt = performance.now();
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 19,
			snapshot: capture.snapshot,
			source: sourceOf(capture.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
		});
		const elapsedMilliseconds = performance.now() - startedAt;
		const attachmentIssues = prepared.checksSnapshot.issues.filter(
			(issue) => issue.code === "PORT_ATTACHMENT",
		);
		const equipmentIssues = prepared.checksSnapshot.issues.filter(
			(issue) => issue.code === "EQUIPMENT_PARTIAL_ATTACHMENT",
		);

		expect(prepared.checksSnapshot.summary[4]).toBe(portCount);
		expect(prepared.checksSnapshot.summary[5]).toBe(portCount);
		expect(prepared.checksSnapshot.summary[7]).toBe(portCount);
		expect(attachmentIssues).toEqual([
			expect.objectContaining({
				sourceCode: "STATION_OUT_OF_RANGE",
				affectedCount: portCount,
			}),
		]);
		expect(equipmentIssues).toEqual([
			expect.objectContaining({
				sourceCode: "UNREACHABLE_MEMBER_PORT",
				affectedCount: portCount,
			}),
		]);
		expect(prepared.checksSnapshot.locationKinds.length).toBe(portCount * 2);
		expect(prepared.checksSnapshot.locationOccurrenceIndexes[portCount - 1]).toBe(portCount - 1);
		expect(prepared.checksSnapshot.occurrenceDetails).toHaveLength(portCount * 2);
		expect(elapsedMilliseconds).toBeLessThan(8_000);
	}, 15_000);

	it("rejects revision, checksum, and sequence identities not captured with the snapshot", () => {
		for (const sourcePatch of [
			{ revision: 42 },
			{ checksum: "stale-checksum" },
			{ sequence: 10 },
		]) {
			const map = snakeMap(8, 4);
			const capture = captureRailMirrorSnapshot(map, 9);
			expect(() =>
				prepareStaticFabOrganizationOverview({
					type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
					requestId: 1,
					snapshot: capture.snapshot,
					source: { ...sourceOf(capture.snapshot), ...sourcePatch },
					expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
				}),
			).toThrow(/does not match snapshot/i);
		}
	});

	it("rejects a forged snapshot whose typed content no longer matches its checksum", () => {
		const map = snakeMap(8, 4);
		const capture = captureRailMirrorSnapshot(map, 2);
		const fingerprint = readinessFingerprint(map, capture.snapshot.checksum);
		capture.snapshot.encoded[0] = (capture.snapshot.encoded[0] as number) ^ 0x10;
		expect(() =>
			prepareStaticFabOrganizationOverview({
				type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
				requestId: 1,
				snapshot: capture.snapshot,
				source: sourceOf(capture.snapshot),
				expectedRailReadinessFingerprint: fingerprint,
			}),
		).toThrow(/checksum/i);
	});

	it("rejects a stale main-thread rail readiness generation", () => {
		const map = snakeMap(8, 4);
		const capture = captureRailMirrorSnapshot(map, 3);
		expect(() =>
			prepareStaticFabOrganizationOverview({
				type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
				requestId: 1,
				snapshot: capture.snapshot,
				source: sourceOf(capture.snapshot),
				expectedRailReadinessFingerprint: "rail-readiness-stale",
			}),
		).toThrow(/readiness fingerprint does not match source/i);
	});

	it("returns navigable project checks even when the optional organization overview fails", () => {
		const map = closedLoopDocument().map;
		const equipment = unreachableOhbState();
		const capture = captureRailMirrorSnapshot(map, 6, equipment, emptyStaticFabOrganizationState());
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 2,
			snapshot: capture.snapshot,
			source: sourceOf(capture.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
		});

		expect(prepared.overviewSnapshot).toBeNull();
		expect(prepared.overviewError).toMatch(/port|station|attachment/i);
		expect(prepared.checksSnapshot.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "PORT_ATTACHMENT",
					sourceCode: "STATION_OUT_OF_RANGE",
				}),
			]),
		);
		expect(prepared.checksSnapshot.locationKinds.length).toBeGreaterThan(0);
	});

	it("diagnoses cross-record ownership faults without activating the invalid document", () => {
		const map = closedLoopDocument().map;
		const capture = captureRailMirrorSnapshot(
			map,
			7,
			unreachableOhbState(),
			emptyStaticFabOrganizationState(),
		);
		capture.snapshot.portEquipment.ports.equipmentGroupIds[0] = 2;
		capture.snapshot.checksum = checksumRailMirrorSnapshot(capture.snapshot);

		expect(() => hydrateRailMirrorSnapshotDocument(capture.snapshot)).toThrow(/port|equipment/i);
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 20,
			snapshot: capture.snapshot,
			source: sourceOf(capture.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
		});

		expect(prepared.overviewSnapshot).toBeNull();
		expect(prepared.overviewError).toMatch(/port|equipment/i);
		expect(prepared.checksSnapshot.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "PORT_EQUIPMENT_INTEGRITY",
					sourceCode: "PORT_EQUIPMENT_GROUP_MISSING",
				}),
			]),
		);
		expect(prepared.checksSnapshot.summary[13]).toBe(0);
		expect(prepared.checksSnapshot.summary[14]).toBe(0);
		expect(prepared.checksSnapshot.summary[15]).toBe(0);
	});

	it("diagnoses an invalid port ID cursor without activating the invalid document", () => {
		const map = closedLoopDocument().map;
		const capture = captureRailMirrorSnapshot(
			map,
			8,
			unreachableOhbState(),
			emptyStaticFabOrganizationState(),
		);
		const checksum = capture.snapshot.checksum;
		const snapshot = {
			...capture.snapshot,
			portEquipment: { ...capture.snapshot.portEquipment, nextPortId: 0 },
		};

		expect(checksumRailMirrorSnapshot(snapshot)).toBe(checksum);
		expect(() => hydrateRailMirrorSnapshotDocument(snapshot)).toThrow(/next port id/i);
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 22,
			snapshot,
			source: sourceOf(snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, checksum),
		});

		expect(prepared.overviewSnapshot).toBeNull();
		expect(prepared.checksSnapshot.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "PORT_EQUIPMENT_INTEGRITY",
					sourceCode: "NEXT_PORT_ID_CURSOR_INVALID",
				}),
			]),
		);
	});

	it("diagnoses an invalid organization cursor without activating the invalid document", () => {
		const map = closedLoopDocument().map;
		const capture = captureRailMirrorSnapshot(
			map,
			9,
			emptyPortEquipmentState(),
			emptyStaticFabOrganizationState(),
		);
		const snapshot = {
			...capture.snapshot,
			organizations: { ...capture.snapshot.organizations, nextOrganizationId: 0 },
		};
		snapshot.checksum = checksumRailMirrorSnapshotDiagnostic(snapshot);

		expect(() => hydrateRailMirrorSnapshotDocument(snapshot)).toThrow(
			/organization snapshot cursor/i,
		);
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 23,
			snapshot,
			source: sourceOf(snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, snapshot.checksum),
		});

		expect(prepared.overviewSnapshot).toBeNull();
		expect(prepared.overviewError).toMatch(/organization snapshot cursor/i);
		expect(prepared.checksSnapshot.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "ORGANIZATION_INTEGRITY",
					sourceCode: "NEXT_ORGANIZATION_ID_CURSOR_INVALID",
				}),
			]),
		);
		expect(prepared.checksSnapshot.locationTokens).toContain("cursor:0");
	});

	it("diagnoses a validly encoded port route that no longer exists on authored rail", () => {
		const map = snakeMap(3, 1);
		const capture = captureRailMirrorSnapshot(
			map,
			8,
			manyOhbState(1),
			emptyStaticFabOrganizationState(),
		);
		capture.snapshot.portEquipment.ports.routeXs[0] = 10_000;
		capture.snapshot.checksum = checksumRailMirrorSnapshot(capture.snapshot);

		expect(() => hydrateRailMirrorSnapshotDocument(capture.snapshot)).toThrow(/route|rail|port/i);
		const prepared = prepareStaticFabOrganizationOverview({
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId: 21,
			snapshot: capture.snapshot,
			source: sourceOf(capture.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprint(map, capture.snapshot.checksum),
		});

		expect(prepared.checksSnapshot.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "PORT_EQUIPMENT_LAYOUT",
					sourceCode: "PORT_ROUTE_MISSING",
				}),
			]),
		);
		expect(prepared.checksSnapshot.summary[13]).toBe(1);
		expect(prepared.checksSnapshot.summary[14]).toBe(1);
		expect(prepared.checksSnapshot.summary[15]).toBe(1);
	});
});

function sourceOf(snapshot: { revision: number; checksum: string; sequence: number }) {
	return {
		revision: snapshot.revision,
		checksum: snapshot.checksum,
		sequence: snapshot.sequence,
	};
}

function readinessFingerprint(map: TileMap, checksum: string): string {
	return createRailProjectReadiness(analyzeRailNetwork(map), compilePhysicalRail(map), checksum)
		.fingerprint;
}

function closedLoopDocument(): RailDocument {
	const document = new RailDocument();
	for (const [from, to] of [
		[
			{ x: 0, y: 0 },
			{ x: 24, y: 0 },
		],
		[
			{ x: 24, y: 0 },
			{ x: 24, y: 8 },
		],
		[
			{ x: 24, y: 8 },
			{ x: 0, y: 8 },
		],
		[
			{ x: 0, y: 8 },
			{ x: 0, y: 0 },
		],
	] as const) {
		const plan = planRailConstruction(document.map, from, to);
		if (!plan.valid || !document.commit(plan)) throw new Error(plan.reason);
	}
	return document;
}

function unreachableOhbState(): PortEquipmentState {
	return Object.freeze({
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
				stationMillimeters: 100_000,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 1_000,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-UNREACHABLE-1",
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
}

function manyOhbState(portCount: number, stationMillimeters = 500): PortEquipmentState {
	return Object.freeze({
		nextPortId: portCount + 1,
		nextEquipmentGroupId: portCount + 1,
		ports: Object.freeze(
			Array.from({ length: portCount }, (_, index) => {
				const id = index + 1;
				return Object.freeze({
					id,
					equipmentGroupId: id,
					route: Object.freeze({
						kind: "CARDINAL_CELL" as const,
						x: id * 2 - 1,
						z: 0,
						from: DIR_W,
						to: DIR_E,
					}),
					stationMillimeters,
					side: "LEFT" as const,
					lateralOffsetMillimeters: 1_000,
					direction: "WITH_TRAVEL" as const,
					portType: "OHB" as const,
					barcode: null,
				});
			}),
		),
		equipmentGroups: Object.freeze(
			Array.from({ length: portCount }, (_, index) => {
				const id = index + 1;
				return Object.freeze({
					id,
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIds: Object.freeze([id]),
				});
			}),
		),
	});
}

function snakeMap(width: number, height: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let rowMajor = 0; rowMajor < width * height; rowMajor++) {
		const x = rowMajor % width;
		const z = Math.floor(rowMajor / width);
		hydrator.addEncodedCell(
			x,
			z,
			encodeRailCell({
				incoming: snakeIncoming(x, z, width),
				outgoing: snakeOutgoing(x, z, width, height),
			}),
		);
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
