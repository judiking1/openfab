import { describe, expect, it } from "vitest";
import {
	copyStaticFabOrganizationState,
	isCanonicalStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { staticFabOrganizationFingerprint } from "./StaticFabOrganizationFingerprint";
import {
	createStaticFabOrganizationSnapshot,
	createStaticFabOrganizationSnapshotHydrator,
	decodeStaticFabOrganizationPatch,
	encodeStaticFabOrganizationPatch,
	hydrateStaticFabOrganizationDiagnosticSnapshot,
	hydrateStaticFabOrganizationSnapshot,
	STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS,
	type StaticFabOrganizationPatchSoA,
	type StaticFabOrganizationRecordFieldsSoA,
	type StaticFabOrganizationSnapshot,
	staticFabOrganizationSnapshotTransfers,
} from "./StaticFabOrganizationSoA";

describe("StaticFabOrganizationSoA", () => {
	it("round-trips canonical organization membership through CSR typed buffers", () => {
		const canonical = copyStaticFabOrganizationState(fixture());
		const snapshot = createStaticFabOrganizationSnapshot(fixture());

		const hydrated = hydrateStaticFabOrganizationSnapshot(snapshot);
		expect(hydrated).toEqual(canonical);
		expect(isCanonicalStaticFabOrganizationState(hydrated)).toBe(true);
		expect([...snapshot.organizationIds]).toEqual([1, 2]);
		expect([...snapshot.records.kinds]).toEqual([0, 1]);
		expect([...snapshot.records.railEdgeOffsets]).toEqual([0, 2, 3]);
		expect([...snapshot.records.advancedSwitchOffsets]).toEqual([0, 1, 1]);
		expect([...snapshot.records.equipmentGroupOffsets]).toEqual([0, 1, 2]);
	});

	it("bounds incremental hydration by membership operations and preserves the exact state", () => {
		const canonical = copyStaticFabOrganizationState(largeAreaFixture(2_049));
		const hydrator = createStaticFabOrganizationSnapshotHydrator(
			createStaticFabOrganizationSnapshot(canonical),
		);
		let operations = 0;
		let steps = 0;
		while (!hydrator.done) {
			const consumed = hydrator.step(37);
			expect(consumed).toBeGreaterThan(0);
			expect(consumed).toBeLessThanOrEqual(37);
			operations += consumed;
			steps++;
		}

		expect(steps).toBeGreaterThan(1);
		expect(operations).toBe(2_050);
		expect(hydrator.step(37)).toBe(0);
		expect(hydrator.finish()).toEqual(canonical);
	});

	it("rejects a noncanonical edge encountered after an incremental step boundary", () => {
		const snapshot = createStaticFabOrganizationSnapshot(largeAreaFixture(100));
		const coordinates = snapshot.records.railEdgeCoordinates;
		coordinates.copyWithin(50 * 4, 49 * 4, 50 * 4);
		const hydrator = createStaticFabOrganizationSnapshotHydrator(snapshot);

		expect(hydrator.step(50)).toBe(50);
		expect(() => hydrator.step(50)).toThrow("strictly canonical without duplicates");
	});

	it("exposes every numeric snapshot buffer exactly once", () => {
		const transfers = staticFabOrganizationSnapshotTransfers(
			createStaticFabOrganizationSnapshot(fixture()),
		);

		expect(new Set(transfers).size).toBe(transfers.length);
		expect(transfers.every((buffer) => buffer.byteLength > 0)).toBe(true);
	});

	it("round-trips create and delete mutations through transferable patch buffers", () => {
		const [area, bay] = copyStaticFabOrganizationState(fixture()).records;
		if (!area || !bay) throw new Error("expected organization fixtures");
		const created = Object.freeze({ ...area, id: 3, name: "Photo Area 02" });
		const encoded = encodeStaticFabOrganizationPatch(
			[
				{ id: bay.id, before: bay, after: null },
				{ id: created.id, before: null, after: created },
			],
			3,
			4,
		);
		const delivered = structuredClone(encoded.fields, { transfer: encoded.transfer });

		expect(decodeStaticFabOrganizationPatch(delivered)).toEqual([
			{ id: bay.id, before: bay, after: null },
			{ id: created.id, before: null, after: created },
		]);
		expect(new Set(encoded.transfer).size).toBe(encoded.transfer.length);
	});

	it("encodes rename and removal without serializing immutable membership", () => {
		const state = copyStaticFabOrganizationState(fixture());
		const area = state.records[0];
		if (!area) throw new Error("expected AREA fixture");
		const renamed = Object.freeze({ ...area, name: "Photo Area Renamed" });
		const encoded = encodeStaticFabOrganizationPatch(
			[
				{ id: area.id, before: area, after: renamed },
				{ id: state.records[1]?.id ?? 2, before: state.records[1] ?? null, after: null },
			],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		);

		expect([...encoded.fields.operationCodes]).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME,
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE,
		]);
		expect(encoded.fields.before.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.after.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.beforeNames).toEqual(["Photo Area", "Photo Bay 01"]);
		expect(encoded.fields.afterNames).toEqual(["Photo Area Renamed", ""]);

		const decoded = decodeStaticFabOrganizationPatch(encoded.fields, state);
		expect(decoded[0]?.before).toBe(area);
		expect(decoded[0]?.after?.membership).toBe(area.membership);
		expect(decoded[0]?.after?.name).toBe("Photo Area Renamed");
		expect(decoded[1]).toEqual({ id: 2, before: state.records[1], after: null });
	});

	it("encodes relationship and property edits as metadata-only transferable patches", () => {
		const state = copyStaticFabOrganizationState(fixture());
		const bay = state.records[1];
		if (!bay) throw new Error("expected BAY fixture");
		const updated = Object.freeze({
			...bay,
			parentOrganizationIds: Object.freeze([1]),
			properties: Object.freeze({
				description: "Photo process production bay",
				color: "AMBER" as const,
			}),
		});
		const encoded = encodeStaticFabOrganizationPatch(
			[{ id: bay.id, before: bay, after: updated }],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		);

		expect([...encoded.fields.operationCodes]).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA,
		]);
		expect(encoded.fields.before.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.after.railEdgeCoordinates).toHaveLength(0);
		expect([...encoded.fields.beforeMetadata.parentOrganizationOffsets]).toEqual([0, 0]);
		expect([...encoded.fields.afterMetadata.parentOrganizationOffsets]).toEqual([0, 1]);
		expect([...encoded.fields.afterMetadata.parentOrganizationIds]).toEqual([1]);
		expect(encoded.fields.afterMetadata.descriptions).toEqual(["Photo process production bay"]);

		const delivered = structuredClone(encoded.fields, { transfer: encoded.transfer });
		const decoded = decodeStaticFabOrganizationPatch(delivered, state);
		expect(decoded[0]?.before).toBe(bay);
		expect(decoded[0]?.after?.membership).toBe(bay.membership);
		expect(decoded[0]?.after?.parentOrganizationIds).toEqual([1]);
		expect(decoded[0]?.after?.properties).toEqual({
			description: "Photo process production bay",
			color: "AMBER",
		});
	});

	it("encodes small membership edits as canonical add/remove deltas", () => {
		const state = copyStaticFabOrganizationState(fixture());
		const area = state.records[0];
		if (!area) throw new Error("expected AREA fixture");
		const updated = copyStaticFabOrganizationState({
			nextOrganizationId: state.nextOrganizationId,
			records: [
				{
					...area,
					membership: {
						railEdges: [
							{ from: { x: 2, y: 0 }, to: { x: 3, y: 0 } },
							{ from: { x: 3, y: 0 }, to: { x: 4, y: 0 } },
						],
						advancedSwitchIds: [5],
						equipmentGroupIds: [7, 8],
					},
				},
				state.records[1] as StaticFabOrganizationState["records"][number],
			],
		}).records[0];
		if (!updated) throw new Error("expected updated AREA fixture");
		const encoded = encodeStaticFabOrganizationPatch(
			[{ id: area.id, before: area, after: updated }],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		);

		expect([...encoded.fields.operationCodes]).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA,
		]);
		expect(encoded.fields.before.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.after.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.removedMembership.railEdgeCoordinates).toEqual(
			new Int32Array([1, 0, 2, 0]),
		);
		expect(encoded.fields.addedMembership.railEdgeCoordinates).toEqual(
			new Int32Array([3, 0, 4, 0]),
		);
		expect([...encoded.fields.removedMembership.advancedSwitchIds]).toEqual([4]);
		expect([...encoded.fields.addedMembership.advancedSwitchIds]).toEqual([5]);
		expect([...encoded.fields.addedMembership.equipmentGroupIds]).toEqual([8]);

		const delivered = structuredClone(encoded.fields, { transfer: encoded.transfer });
		const decoded = decodeStaticFabOrganizationPatch(delivered, state);
		expect(decoded[0]?.before).toBe(area);
		expect(decoded[0]?.after).toEqual(updated);

		const nextState = copyStaticFabOrganizationState({
			nextOrganizationId: state.nextOrganizationId,
			records: [updated, state.records[1] as StaticFabOrganizationState["records"][number]],
		});
		const reverse = encodeStaticFabOrganizationPatch(
			[{ id: area.id, before: updated, after: area }],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		);
		expect([...reverse.fields.operationCodes]).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA,
		]);
		expect(decodeStaticFabOrganizationPatch(reverse.fields, nextState)[0]?.after).toEqual(area);
	});

	it("keeps a one-edge edit in a 50k-edge organization bounded to delta-sized transfer data", () => {
		const state = copyStaticFabOrganizationState(largeAreaFixture(50_000));
		const before = state.records[0];
		if (!before) throw new Error("expected large AREA fixture");
		const after = copyStaticFabOrganizationState({
			nextOrganizationId: state.nextOrganizationId,
			records: [
				{
					...before,
					membership: {
						railEdges: [
							...before.membership.railEdges.slice(1),
							{ from: { x: 50_000, y: 0 }, to: { x: 50_001, y: 0 } },
						],
						advancedSwitchIds: before.membership.advancedSwitchIds,
						equipmentGroupIds: before.membership.equipmentGroupIds,
					},
				},
			],
		}).records[0];
		if (!after) throw new Error("expected updated large AREA fixture");

		const encoded = encodeStaticFabOrganizationPatch(
			[{ id: before.id, before, after }],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		);
		const transferredBytes = encoded.transfer.reduce(
			(total, buffer) => total + buffer.byteLength,
			0,
		);

		expect([...encoded.fields.operationCodes]).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA,
		]);
		expect(encoded.fields.before.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.after.railEdgeCoordinates).toHaveLength(0);
		expect(encoded.fields.removedMembership.railEdgeCoordinates).toHaveLength(4);
		expect(encoded.fields.addedMembership.railEdgeCoordinates).toHaveLength(4);
		expect(transferredBytes).toBeLessThan(2_048);
		expect(decodeStaticFabOrganizationPatch(encoded.fields, state)[0]?.after).toEqual(after);
	});

	it("rejects stale, conflicting, and empty membership delta payloads", () => {
		const state = copyStaticFabOrganizationState(fixture());
		const area = state.records[0];
		if (!area) throw new Error("expected AREA fixture");
		const updated = copyStaticFabOrganizationState({
			nextOrganizationId: state.nextOrganizationId,
			records: [
				{
					...area,
					membership: {
						railEdges: [
							{ from: { x: 2, y: 0 }, to: { x: 3, y: 0 } },
							{ from: { x: 3, y: 0 }, to: { x: 4, y: 0 } },
						],
						advancedSwitchIds: area.membership.advancedSwitchIds,
						equipmentGroupIds: area.membership.equipmentGroupIds,
					},
				},
				state.records[1] as StaticFabOrganizationState["records"][number],
			],
		}).records[0];
		if (!updated) throw new Error("expected updated AREA fixture");
		const valid = () =>
			encodeStaticFabOrganizationPatch(
				[{ id: area.id, before: area, after: updated }],
				state.nextOrganizationId,
				state.nextOrganizationId,
				{ compactExisting: true },
			).fields;

		const missing = valid();
		missing.removedMembership.railEdgeCoordinates.set([8, 0, 9, 0]);
		expect(() => decodeStaticFabOrganizationPatch(missing, state)).toThrow("removes missing rail");

		const existing = valid();
		existing.addedMembership.railEdgeCoordinates.set([2, 0, 3, 0]);
		expect(() => decodeStaticFabOrganizationPatch(existing, state)).toThrow("adds existing rail");

		const staleBefore = valid();
		staleBefore.beforeRecordHashes[0] = (staleBefore.beforeRecordHashes[0] as number) ^ 1;
		expect(() => decodeStaticFabOrganizationPatch(staleBefore, state)).toThrow(
			"before membership delta fingerprint does not match",
		);

		const corruptAfter = valid();
		corruptAfter.afterRecordHashes[1] = (corruptAfter.afterRecordHashes[1] as number) ^ 1;
		expect(() => decodeStaticFabOrganizationPatch(corruptAfter, state)).toThrow(
			"after membership delta fingerprint does not match",
		);

		const remove = encodeStaticFabOrganizationPatch(
			[{ id: area.id, before: area, after: null }],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		).fields;
		const changedState = copyStaticFabOrganizationState({
			nextOrganizationId: state.nextOrganizationId,
			records: [updated, state.records[1] as StaticFabOrganizationState["records"][number]],
		});
		expect(() => decodeStaticFabOrganizationPatch(remove, changedState)).toThrow(
			"before removal fingerprint does not match",
		);

		const empty = encodeStaticFabOrganizationPatch(
			[{ id: area.id, before: area, after: { ...area, name: "Renamed Area" } }],
			state.nextOrganizationId,
			state.nextOrganizationId,
			{ compactExisting: true },
		).fields;
		const emptyDelta = {
			...empty,
			operationCodes: new Uint8Array([STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA]),
			afterNames: [empty.beforeNames[0] as string],
		};
		expect(() => decodeStaticFabOrganizationPatch(emptyDelta, state)).toThrow(
			"membership delta 1 is empty",
		);
	});

	it("does not read compact rename membership while encoding", () => {
		const area = copyStaticFabOrganizationState(fixture()).records[0];
		if (!area) throw new Error("expected AREA fixture");
		let rejectMembershipRead = false;
		const unreadableRailEdges = new Proxy(area.membership.railEdges, {
			get(target, property, receiver) {
				if (rejectMembershipRead) throw new Error("compact encoding traversed membership");
				return Reflect.get(target, property, receiver);
			},
		});
		const membership = Object.freeze({
			railEdges: unreadableRailEdges,
			advancedSwitchIds: area.membership.advancedSwitchIds,
			equipmentGroupIds: area.membership.equipmentGroupIds,
		});
		const before = Object.freeze({ ...area, membership });
		const after = Object.freeze({ ...before, name: "Renamed Without Traversal" });
		staticFabOrganizationFingerprint(before);
		rejectMembershipRead = true;

		expect(() =>
			encodeStaticFabOrganizationPatch([{ id: before.id, before, after }], 3, 3, {
				compactExisting: true,
			}),
		).not.toThrow();
	});

	it("rejects malformed offsets and absent rows carrying hidden payload", () => {
		const malformed = createStaticFabOrganizationSnapshot(fixture());
		malformed.records.railEdgeOffsets[1] = 99;
		expect(() => hydrateStaticFabOrganizationSnapshot(malformed)).toThrow("offsets");

		const area = copyStaticFabOrganizationState(fixture()).records[0];
		if (!area) throw new Error("expected AREA fixture");
		const patch = encodeStaticFabOrganizationPatch(
			[{ id: area.id, before: null, after: area }],
			1,
			2,
		).fields;
		(patch.before.names as string[])[0] = "hidden";
		expect(() => decodeStaticFabOrganizationPatch(patch)).toThrow("presence flag is zero");
	});

	it("rejects every snapshot field encoded with the wrong runtime container class", () => {
		const cases: readonly [
			label: string,
			mutate: (snapshot: StaticFabOrganizationSnapshot) => StaticFabOrganizationSnapshot,
			expected: string,
		][] = [
			[
				"organization ids",
				(snapshot) => ({
					...snapshot,
					organizationIds: new Uint32Array(snapshot.organizationIds) as unknown as Int32Array,
				}),
				"organization snapshot ids must be a Int32Array",
			],
			[
				"kinds",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						kinds: new Int32Array(snapshot.records.kinds) as unknown as Uint8Array,
					}),
				"organization snapshot kinds must be a Uint8Array",
			],
			[
				"rail offsets",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						railEdgeOffsets: new Int32Array(
							snapshot.records.railEdgeOffsets,
						) as unknown as Uint32Array,
					}),
				"organization snapshot rail edge offsets must be a Uint32Array",
			],
			[
				"rail coordinates",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						railEdgeCoordinates: new Uint32Array(
							snapshot.records.railEdgeCoordinates,
						) as unknown as Int32Array,
					}),
				"organization snapshot rail edge coordinates must be a Int32Array",
			],
			[
				"advanced switch offsets",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						advancedSwitchOffsets: new Int32Array(
							snapshot.records.advancedSwitchOffsets,
						) as unknown as Uint32Array,
					}),
				"organization snapshot advanced switch offsets must be a Uint32Array",
			],
			[
				"advanced switch ids",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						advancedSwitchIds: new Uint32Array(
							snapshot.records.advancedSwitchIds,
						) as unknown as Int32Array,
					}),
				"organization snapshot advanced switch ids must be a Int32Array",
			],
			[
				"equipment group offsets",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						equipmentGroupOffsets: new Int32Array(
							snapshot.records.equipmentGroupOffsets,
						) as unknown as Uint32Array,
					}),
				"organization snapshot equipment group offsets must be a Uint32Array",
			],
			[
				"equipment group ids",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						equipmentGroupIds: new Uint32Array(
							snapshot.records.equipmentGroupIds,
						) as unknown as Int32Array,
					}),
				"organization snapshot equipment group ids must be a Int32Array",
			],
			[
				"names",
				(snapshot) =>
					replaceRecordFields(snapshot, {
						names: new Set(snapshot.records.names) as unknown as readonly string[],
					}),
				"organization snapshot names must be an Array",
			],
		];

		for (const [, mutate, expected] of cases) {
			const malformed = mutate(createStaticFabOrganizationSnapshot(fixture()));
			expect(() => hydrateStaticFabOrganizationSnapshot(malformed)).toThrow(expected);
		}
	});

	it("rejects organization columns backed by shared memory", () => {
		const snapshot = createStaticFabOrganizationSnapshot(fixture());
		const sharedIds = new Int32Array(new SharedArrayBuffer(snapshot.organizationIds.byteLength));
		sharedIds.set(snapshot.organizationIds);

		expect(() =>
			hydrateStaticFabOrganizationSnapshot({ ...snapshot, organizationIds: sharedIds }),
		).toThrow(/transferable ArrayBuffer/i);
	});

	it("rejects noncanonical and duplicate organization ids without normalizing them", () => {
		for (const ids of [new Int32Array([2, 1]), new Int32Array([1, 1])]) {
			const snapshot = createStaticFabOrganizationSnapshot(fixture());
			const malformed = { ...snapshot, organizationIds: ids };
			expect(() => hydrateStaticFabOrganizationSnapshot(malformed)).toThrow(
				"strictly increasing without duplicates",
			);
		}

		const snapshot = createStaticFabOrganizationSnapshot(fixture());
		expect(() =>
			hydrateStaticFabOrganizationSnapshot({
				...snapshot,
				organizationIds: new Int32Array([0, 2]),
			}),
		).toThrow("non-positive id 0");
	});

	it("preserves semantic organization faults in the diagnostic-only hydrator", () => {
		const snapshot = createStaticFabOrganizationSnapshot(fixture());
		const kinds = snapshot.records.kinds.slice();
		const colors = snapshot.records.colors.slice();
		kinds[1] = 255;
		colors[1] = 255;
		const malformed = replaceRecordFields(
			{
				...snapshot,
				nextOrganizationId: 0,
				organizationIds: new Int32Array([2, 2]),
			},
			{ kinds, colors },
		);

		expect(() => hydrateStaticFabOrganizationSnapshot(malformed)).toThrow();
		expect(hydrateStaticFabOrganizationDiagnosticSnapshot(malformed)).toMatchObject({
			nextOrganizationId: 0,
			records: [
				{ id: 2, kind: "AREA" },
				{ id: 2, kind: "INVALID_KIND_255", properties: { color: "INVALID_COLOR_255" } },
			],
		});
	});

	it("keeps malformed diagnostic transport structure fatal", () => {
		const snapshot = createStaticFabOrganizationSnapshot(fixture());
		const brokenOffsets = replaceRecordFields(snapshot, {
			railEdgeOffsets: new Uint32Array([0, 99, 3]),
		});
		expect(() => hydrateStaticFabOrganizationDiagnosticSnapshot(brokenOffsets)).toThrow(/offsets/i);

		const sharedIds = new Int32Array(new SharedArrayBuffer(snapshot.organizationIds.byteLength));
		sharedIds.set(snapshot.organizationIds);
		expect(() =>
			hydrateStaticFabOrganizationDiagnosticSnapshot({
				...snapshot,
				organizationIds: sharedIds,
			}),
		).toThrow(/transferable ArrayBuffer/i);
	});

	it("rejects noncanonical rail-edge, switch, and equipment CSR rows", () => {
		const base = createStaticFabOrganizationSnapshot(fixture());
		const malformedRailRows = [
			new Int32Array([2, 0, 3, 0, 1, 0, 2, 0, 8, 2, 9, 2]),
			new Int32Array([1, 0, 2, 0, 1, 0, 2, 0, 8, 2, 9, 2]),
		];
		for (const railEdgeCoordinates of malformedRailRows) {
			expect(() =>
				hydrateStaticFabOrganizationSnapshot(replaceRecordFields(base, { railEdgeCoordinates })),
			).toThrow("strictly canonical without duplicates");
		}

		expect(() =>
			hydrateStaticFabOrganizationSnapshot(
				replaceRecordFields(base, {
					advancedSwitchOffsets: new Uint32Array([0, 2, 2]),
					advancedSwitchIds: new Int32Array([4, 4]),
				}),
			),
		).toThrow("strictly increasing without duplicates");

		expect(() =>
			hydrateStaticFabOrganizationSnapshot(
				replaceRecordFields(base, {
					equipmentGroupOffsets: new Uint32Array([0, 2, 3]),
					equipmentGroupIds: new Int32Array([8, 7, 9]),
				}),
			),
		).toThrow("strictly increasing without duplicates");

		expect(() =>
			hydrateStaticFabOrganizationSnapshot(
				replaceRecordFields(base, {
					advancedSwitchIds: new Int32Array([0]),
				}),
			),
		).toThrow("non-positive id 0");
	});

	it("rejects snapshot cursors that are invalid or do not exceed the maximum id", () => {
		const snapshot = createStaticFabOrganizationSnapshot(fixture());
		for (const nextOrganizationId of [0, 0x8000_0000]) {
			expect(() =>
				hydrateStaticFabOrganizationSnapshot({ ...snapshot, nextOrganizationId }),
			).toThrow("positive signed 32-bit integer");
		}
		expect(() =>
			hydrateStaticFabOrganizationSnapshot({ ...snapshot, nextOrganizationId: 2 }),
		).toThrow("must be greater than maximum organization id 2");
	});

	it("rejects malformed patch typed arrays, ids, and per-state cursors", () => {
		const valid = canonicalCreateDeletePatch();
		const wrongIds = {
			...valid,
			organizationIds: new Uint32Array(valid.organizationIds) as unknown as Int32Array,
		};
		expect(() => decodeStaticFabOrganizationPatch(wrongIds)).toThrow(
			"organization patch ids must be a Int32Array",
		);
		const wrongPresence = {
			...valid,
			beforePresent: new Int32Array(valid.beforePresent) as unknown as Uint8Array,
		};
		expect(() => decodeStaticFabOrganizationPatch(wrongPresence)).toThrow(
			"organization patch before presence must be a Uint8Array",
		);
		const wrongNestedIds = {
			...valid,
			before: {
				...valid.before,
				equipmentGroupIds: new Uint32Array(valid.before.equipmentGroupIds) as unknown as Int32Array,
			},
		};
		expect(() => decodeStaticFabOrganizationPatch(wrongNestedIds)).toThrow(
			"organization patch before equipment group ids must be a Int32Array",
		);
		const duplicateAfterEdges = {
			...valid,
			after: {
				...valid.after,
				railEdgeCoordinates: new Int32Array([1, 0, 2, 0, 1, 0, 2, 0]),
			},
		};
		expect(() => decodeStaticFabOrganizationPatch(duplicateAfterEdges)).toThrow(
			"strictly canonical without duplicates",
		);

		for (const organizationIds of [new Int32Array([3, 2]), new Int32Array([2, 2])]) {
			expect(() => decodeStaticFabOrganizationPatch({ ...valid, organizationIds })).toThrow(
				"strictly increasing without duplicates",
			);
		}
		expect(() =>
			decodeStaticFabOrganizationPatch({
				...valid,
				organizationIds: new Int32Array([0, 3]),
			}),
		).toThrow("non-positive id 0");
		expect(() =>
			decodeStaticFabOrganizationPatch({ ...valid, nextOrganizationIdBefore: 2 }),
		).toThrow("must be greater than present organization id 2");
		expect(() =>
			decodeStaticFabOrganizationPatch({ ...valid, nextOrganizationIdAfter: 3 }),
		).toThrow("must be greater than present organization id 3");
	});
});

function replaceRecordFields(
	snapshot: StaticFabOrganizationSnapshot,
	replacements: Partial<StaticFabOrganizationRecordFieldsSoA>,
): StaticFabOrganizationSnapshot {
	return { ...snapshot, records: { ...snapshot.records, ...replacements } };
}

function canonicalCreateDeletePatch(): StaticFabOrganizationPatchSoA {
	const [area, bay] = copyStaticFabOrganizationState(fixture()).records;
	if (!area || !bay) throw new Error("expected organization fixtures");
	const created = Object.freeze({ ...area, id: 3, name: "Photo Area 02" });
	return encodeStaticFabOrganizationPatch(
		[
			{ id: bay.id, before: bay, after: null },
			{ id: created.id, before: null, after: created },
		],
		3,
		4,
	).fields;
}

function fixture(): StaticFabOrganizationState {
	return {
		nextOrganizationId: 3,
		records: [
			{
				id: 1,
				kind: "AREA",
				name: "Photo Area",
				membership: {
					railEdges: [
						{ from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
						{ from: { x: 2, y: 0 }, to: { x: 3, y: 0 } },
					],
					advancedSwitchIds: [4],
					equipmentGroupIds: [7],
				},
			},
			{
				id: 2,
				kind: "BAY",
				name: "Photo Bay 01",
				membership: {
					railEdges: [{ from: { x: 8, y: 2 }, to: { x: 9, y: 2 } }],
					advancedSwitchIds: [],
					equipmentGroupIds: [9],
				},
			},
		],
	};
}

function largeAreaFixture(edgeCount: number): StaticFabOrganizationState {
	return {
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AREA",
				name: "Large Production Area",
				membership: {
					railEdges: Array.from({ length: edgeCount }, (_, x) => ({
						from: { x, y: 0 },
						to: { x: x + 1, y: 0 },
					})),
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			},
		],
	};
}
