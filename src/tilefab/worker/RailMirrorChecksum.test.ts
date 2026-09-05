import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import type { StaticFabOrganizationRecord } from "../core/StaticFabOrganization";
import {
	adoptRailMirrorSnapshotCaptureHandoff,
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailMapCooperatively,
	checksumRailMirrorSnapshot,
	checksumRailMirrorSnapshotDiagnostic,
	checksumRailPatchResult,
	checksumRailPatchResultCooperatively,
	consumeRailMirrorSnapshotCaptureAuthority,
	issueRailMirrorSnapshotCaptureHandoff,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
	revokeRailMirrorSnapshotCaptureHandoff,
} from "./RailMirrorChecksum";

describe("RailMirrorSnapshot capture authority", () => {
	it("keeps the canonical map checksum identical across cooperative rail slices", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 })),
		).toBe(true);
		let checkpoints = 0;
		const cooperative = await checksumRailMapCooperatively(
			document.map,
			document.portEquipment,
			document.organizations,
			async () => {
				checkpoints++;
			},
			1,
		);

		expect(cooperative).toBe(
			checksumRailMap(document.map, document.portEquipment, document.organizations),
		);
		expect(checkpoints).toBeGreaterThan(0);
		const emptyPatch = {
			changes: [],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: [],
			organizationNextIdBefore: document.organizations.nextOrganizationId,
			organizationNextIdAfter: document.organizations.nextOrganizationId,
		};
		expect(
			await checksumRailPatchResultCooperatively(cooperative, emptyPatch, async () => undefined, 1),
		).toBe(checksumRailPatchResult(cooperative, emptyPatch));
	});

	it("keeps valid diagnostic checksums compatible and fingerprints invalid organization cursors", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;

		expect(checksumRailMirrorSnapshotDiagnostic(snapshot)).toBe(
			checksumRailMirrorSnapshot(snapshot),
		);
		const invalidCursor = {
			...structuredClone(snapshot),
			organizations: { ...structuredClone(snapshot.organizations), nextOrganizationId: 0 },
		};
		expect(() => checksumRailMirrorSnapshot(invalidCursor)).toThrow(
			/organization snapshot cursor/i,
		);
		expect(checksumRailMirrorSnapshotDiagnostic(invalidCursor)).not.toBe(snapshot.checksum);
	});

	it("rejects plain, wrong-width, and shared rail or switch columns before checksumming", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;

		expect(() =>
			checksumRailMirrorSnapshot({
				...snapshot,
				xs: [...snapshot.xs] as unknown as Int32Array,
			}),
		).toThrow(/identity columns/i);
		expect(() =>
			checksumRailMirrorSnapshot({
				...snapshot,
				encoded: new Int8Array(snapshot.encoded) as unknown as Uint8Array,
			}),
		).toThrow(/identity columns/i);
		const sharedXs = new Int32Array(new SharedArrayBuffer(snapshot.xs.byteLength));
		sharedXs.set(snapshot.xs);
		expect(() => checksumRailMirrorSnapshot({ ...snapshot, xs: sharedXs })).toThrow(
			/identity columns/i,
		);
		expect(() =>
			checksumRailMirrorSnapshot({
				...snapshot,
				switchRecords: {
					...snapshot.switchRecords,
					profileClasses: [] as unknown as Uint8Array,
				},
			}),
		).toThrow(/advanced switch profile classes/i);
	});

	it("binds one snapshot object to one exact authored generation and consumes it once", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;

		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(false);
	});

	it("rejects and consumes a checksum-equivalent capture presented for another document", () => {
		const source = new RailDocument();
		const foreign = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			source.map,
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
			source.relationships,
		).snapshot;

		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				foreign.map,
				foreign.getPatchSequence(),
				foreign.portEquipment,
				foreign.organizations,
				foreign.relationships,
			),
		).toBe(false);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				source.map,
				source.getPatchSequence(),
				source.portEquipment,
				source.organizations,
				source.relationships,
			),
		).toBe(false);
	});

	it("adopts one transferred authoritative-mirror handoff for the exact live generation", () => {
		const document = new RailDocument();
		const captured = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;
		const transferred = structuredClone(captured);
		const handoff = issueRailMirrorSnapshotCaptureHandoff(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
			captured.checksum,
		);

		expect(adoptRailMirrorSnapshotCaptureHandoff(handoff, transferred)).toBe(true);
		expect(adoptRailMirrorSnapshotCaptureHandoff(handoff, structuredClone(captured))).toBe(false);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				transferred,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
	});

	it("consumes a handoff token once even when a Proxy alternates token reads", () => {
		const document = new RailDocument();
		const captured = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;
		const handoff = issueRailMirrorSnapshotCaptureHandoff(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
			captured.checksum,
		);
		let tokenReads = 0;
		const alternating = new Proxy(handoff, {
			get(target, key, receiver) {
				if (key !== "token") return Reflect.get(target, key, receiver);
				tokenReads++;
				return tokenReads === 1 ? target.token : Object.freeze({});
			},
		});

		expect(adoptRailMirrorSnapshotCaptureHandoff(alternating, structuredClone(captured))).toBe(
			true,
		);
		expect(tokenReads).toBe(1);
		expect(adoptRailMirrorSnapshotCaptureHandoff(handoff, structuredClone(captured))).toBe(false);
	});

	it("rejects malformed nested SoA columns before granting capture authority", () => {
		const document = new RailDocument();
		const captured = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const corruptions: readonly Readonly<{
			name: string;
			corrupt: (snapshot: RailMirrorSnapshot) => RailMirrorSnapshot;
		}>[] = [
			{
				name: "switch origins width",
				corrupt: (snapshot) => ({
					...snapshot,
					switchRecords: {
						...snapshot.switchRecords,
						origins: new Uint8Array(0) as unknown as Int32Array,
					},
				}),
			},
			{
				name: "port route kind width",
				corrupt: (snapshot) => ({
					...snapshot,
					portEquipment: {
						...snapshot.portEquipment,
						ports: {
							...snapshot.portEquipment.ports,
							routeKinds: new Int8Array(0) as unknown as Uint8Array,
						},
					},
				}),
			},
			{
				name: "equipment group port offsets",
				corrupt: (snapshot) => ({
					...snapshot,
					portEquipment: {
						...snapshot.portEquipment,
						equipmentGroups: {
							...snapshot.portEquipment.equipmentGroups,
							portOffsets: new Uint32Array(0),
						},
					},
				}),
			},
			{
				name: "organization rail edge coordinate width",
				corrupt: (snapshot) => ({
					...snapshot,
					organizations: {
						...snapshot.organizations,
						records: {
							...snapshot.organizations.records,
							railEdgeCoordinates: new Uint8Array(0) as unknown as Int32Array,
						},
					},
				}),
			},
		];

		for (const { name, corrupt } of corruptions) {
			const snapshot = corrupt(structuredClone(captured));
			const handoff = issueRailMirrorSnapshotCaptureHandoff(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
				captured.checksum,
			);
			expect(adoptRailMirrorSnapshotCaptureHandoff(handoff, snapshot), name).toBe(false);
			expect(
				consumeRailMirrorSnapshotCaptureAuthority(
					snapshot,
					document.map,
					document.getPatchSequence(),
					document.portEquipment,
					document.organizations,
					document.relationships,
				),
				name,
			).toBe(false);
		}
	});

	it("revokes or rejects a transferred handoff after the bound source changes", () => {
		const document = new RailDocument();
		const captured = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot;
		const revoked = issueRailMirrorSnapshotCaptureHandoff(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
			captured.checksum,
		);
		revokeRailMirrorSnapshotCaptureHandoff(revoked);
		expect(adoptRailMirrorSnapshotCaptureHandoff(revoked, structuredClone(captured))).toBe(false);

		const stale = issueRailMirrorSnapshotCaptureHandoff(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
			captured.checksum,
		);
		document.map.setEncoded(0, 0, 0x12);
		expect(adoptRailMirrorSnapshotCaptureHandoff(stale, structuredClone(captured))).toBe(false);
	});
});

describe("RailChecksumAccumulator organization hashing", () => {
	it("preserves the fixed organization checksum contract across hash refactors", () => {
		const checksum = new RailChecksumAccumulator();
		checksum.addOrganization(
			Object.freeze({
				id: 7,
				kind: "BAY",
				name: "Legacy Digest Bay",
				parentOrganizationIds: Object.freeze([2, 5]),
				properties: Object.freeze({ description: "Checksum contract", color: "AMBER" }),
				membership: Object.freeze({
					railEdges: Object.freeze([
						Object.freeze({
							from: Object.freeze({ x: 0, y: 0 }),
							to: Object.freeze({ x: 1, y: 0 }),
						}),
						Object.freeze({
							from: Object.freeze({ x: 1, y: 0 }),
							to: Object.freeze({ x: 1, y: 1 }),
						}),
					]),
					advancedSwitchIds: Object.freeze([11, 19]),
					equipmentGroupIds: Object.freeze([23, 29]),
				}),
			}),
		);
		checksum.setOrganizationNextId(31);

		expect(checksum.digest()).toBe(
			"00000002:00000000:00000000:00000000:00000000:00000000:00000001:0000001f:00000000:00000001:55bf56a6:f5ae92b4",
		);
	});

	it("matches synchronous identity while checkpointing large membership", async () => {
		const record = largeAreaRecord(1_025);
		const cooperativeRecord = largeAreaRecord(1_025);
		const synchronous = new RailChecksumAccumulator();
		synchronous.addOrganization(record);
		synchronous.setOrganizationNextId(7);

		let checkpoints = 0;
		const cooperative = new RailChecksumAccumulator();
		await cooperative.addOrganizationCooperatively(
			cooperativeRecord,
			async () => {
				checkpoints++;
			},
			128,
		);
		cooperative.setOrganizationNextId(7);

		expect(checkpoints).toBe(Math.floor(record.membership.railEdges.length / 128));
		expect(cooperative.digest()).toBe(synchronous.digest());
		expect(cooperative.organizationCount).toBe(1);
		expect(cooperative.organizationNextId).toBe(7);
	});

	it("rejects a non-positive cooperative operation budget", async () => {
		await expect(
			new RailChecksumAccumulator().addOrganizationCooperatively(
				largeAreaRecord(1),
				async () => undefined,
				0,
			),
		).rejects.toThrow("operation budget");
	});

	it("reuses one 50k immutable membership hash across rename, remove, re-add, and clones", async () => {
		const fixture = countedLargeAreaRecord(50_000);
		const original = fixture.record;
		const renamed = Object.freeze({
			...original,
			name: "Renamed Checksum Area",
			membership: original.membership,
		});
		const checksum = new RailChecksumAccumulator();
		checksum.addOrganization(original);
		checksum.setOrganizationNextId(2);
		expect(fixture.readCount()).toBeGreaterThan(50_000);

		fixture.resetReadCount();
		checksum.applyOrganizationMutation({ id: original.id, before: original, after: renamed });
		const renamedDigest = checksum.digest();
		expect(fixture.readCount()).toBe(0);

		checksum.removeOrganization(renamed);
		checksum.addOrganization(renamed);
		expect(checksum.digest()).toBe(renamedDigest);
		expect(fixture.readCount()).toBe(0);

		const synchronousClone = checksum.clone();
		synchronousClone.removeOrganization(renamed);
		synchronousClone.addOrganization(renamed);
		expect(synchronousClone.digest()).toBe(renamedDigest);
		expect(fixture.readCount()).toBe(0);

		let checkpoints = 0;
		const cooperativeClone = checksum.clone();
		cooperativeClone.removeOrganization(renamed);
		await cooperativeClone.addOrganizationCooperatively(
			renamed,
			async () => {
				checkpoints++;
			},
			128,
		);
		expect(cooperativeClone.digest()).toBe(renamedDigest);
		expect(checkpoints).toBe(0);
		expect(fixture.readCount()).toBe(0);

		const resumedFromStartupDigest = RailChecksumAccumulator.fromDigest(renamedDigest);
		resumedFromStartupDigest.removeOrganization(renamed);
		resumedFromStartupDigest.addOrganization(renamed);
		expect(resumedFromStartupDigest.digest()).toBe(renamedDigest);
		expect(fixture.readCount()).toBe(0);
	});
});

function largeAreaRecord(edgeCount: number): StaticFabOrganizationRecord {
	return Object.freeze({
		id: 1,
		kind: "AREA",
		name: "Checksum Area",
		membership: Object.freeze({
			railEdges: Object.freeze(
				Array.from({ length: edgeCount }, (_, x) =>
					Object.freeze({
						from: Object.freeze({ x, y: 0 }),
						to: Object.freeze({ x: x + 1, y: 0 }),
					}),
				),
			),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function countedLargeAreaRecord(edgeCount: number): Readonly<{
	record: StaticFabOrganizationRecord;
	readCount: () => number;
	resetReadCount: () => void;
}> {
	let reads = 0;
	const countRead = (): void => {
		reads++;
	};
	const railEdges = countedReadonlyArray(
		Array.from({ length: edgeCount }, (_, x) =>
			Object.freeze({
				from: Object.freeze({ x, y: 0 }),
				to: Object.freeze({ x: x + 1, y: 0 }),
			}),
		),
		countRead,
	);
	const advancedSwitchIds = countedReadonlyArray<number>([], countRead);
	const equipmentGroupIds = countedReadonlyArray<number>([], countRead);
	return Object.freeze({
		record: Object.freeze({
			id: 1,
			kind: "AREA",
			name: "Counted Checksum Area",
			membership: Object.freeze({ railEdges, advancedSwitchIds, equipmentGroupIds }),
		}),
		readCount: () => reads,
		resetReadCount: () => {
			reads = 0;
		},
	});
}

function countedReadonlyArray<T>(values: readonly T[], onRead: () => void): readonly T[] {
	const target = Object.freeze([...values]);
	return new Proxy(target, {
		get(array, property, receiver) {
			onRead();
			return Reflect.get(array, property, receiver);
		},
	});
}
