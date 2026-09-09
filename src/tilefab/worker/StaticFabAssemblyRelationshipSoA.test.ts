import { describe, expect, it } from "vitest";
import { createCooperativeTask } from "../core/CooperativeTask";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	adoptStaticFabAssemblyRelationshipStateSteps,
	applyStaticFabAssemblyRelationshipMutations,
	checksumStaticFabAssemblyRelationshipState,
	createStaticFabAssemblyRelationshipState,
	isCanonicalStaticFabAssemblyRelationshipState,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
	type StaticFabAssemblyRelationshipLegV1,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
	staticFabAssemblyRelationshipStateEquals,
} from "../core/StaticFabAssemblyRelationship";
import {
	checksumRailPatchResult,
	checksumRailPatchResultCooperatively,
	RailChecksumAccumulator,
} from "./RailMirrorChecksum";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	createStaticFabAssemblyRelationshipSnapshotHydrator,
	decodeStaticFabAssemblyRelationshipPatch,
	encodeStaticFabAssemblyRelationshipAdditionsCooperatively,
	encodeStaticFabAssemblyRelationshipPatch,
	hydrateStaticFabAssemblyRelationshipSnapshot,
	type StaticFabAssemblyRelationshipPatchSoA,
	type StaticFabAssemblyRelationshipSnapshot,
	staticFabAssemblyRelationshipPatchTransfers,
	staticFabAssemblyRelationshipSnapshotTransfers,
	validateStaticFabAssemblyRelationshipPatchStructure,
	validateStaticFabAssemblyRelationshipSnapshotStructure,
} from "./StaticFabAssemblyRelationshipSoA";

describe("StaticFabAssemblyRelationshipSoA", () => {
	it.each([
		"reciprocal",
		"maximum",
	])("encodes %s immutable additions with exact transferable bytes and bounded checkpoints", async (kind) => {
		const state = createStaticFabAssemblyRelationshipState(
			kind === "maximum" ? maximumRecordState() : reciprocalState(),
		);
		const mutations = Object.freeze(
			state.records.map((after) => Object.freeze({ id: after.id, before: null, after })),
		);
		const expected = encodeStaticFabAssemblyRelationshipPatch(
			mutations,
			1,
			state.nextRelationshipId,
		);
		let checkpoints = 0;
		const encoded = await encodeStaticFabAssemblyRelationshipAdditionsCooperatively(
			mutations,
			1,
			state.nextRelationshipId,
			async () => {
				checkpoints++;
			},
			37,
		);
		expect(encoded.fields).toEqual(expected.fields);
		expect(encoded.transfer.map((buffer) => new Uint8Array(buffer))).toEqual(
			expected.transfer.map((buffer) => new Uint8Array(buffer)),
		);
		expect(new Set(encoded.transfer).size).toBe(encoded.transfer.length);
		expect(checkpoints).toBeGreaterThan(kind === "maximum" ? 1000 : 1);
		const delivered = structuredClone(encoded.fields, { transfer: encoded.transfer });
		expect(decodeStaticFabAssemblyRelationshipPatch(delivered)).toEqual(mutations);
		const cancelled = new Error("cancel relationship encoding");
		await expect(
			encodeStaticFabAssemblyRelationshipAdditionsCooperatively(
				mutations,
				1,
				state.nextRelationshipId,
				async () => {
					throw cancelled;
				},
				1,
			),
		).rejects.toBe(cancelled);
		await expect(
			encodeStaticFabAssemblyRelationshipAdditionsCooperatively(mutations, 1, 1, async () => {}),
		).rejects.toThrow("cursor");
	});
	it("round-trips canonical records through a unique transferable edge-index snapshot", () => {
		const source = createStaticFabAssemblyRelationshipState(reciprocalState());
		const snapshot = createStaticFabAssemblyRelationshipSnapshot(source);

		expect(snapshot.schemaVersion).toBe(1);
		expect(snapshot.records.edgeCoordinates.length / 4).toBeLessThan(
			snapshot.records.scopedEdges.edgeIndexes.length,
		);
		const transfers = staticFabAssemblyRelationshipSnapshotTransfers(snapshot);
		expect(new Set(transfers).size).toBe(transfers.length);
		for (const buffer of transfers) expect(buffer).toBeInstanceOf(ArrayBuffer);
		expect(
			staticFabAssemblyRelationshipStateEquals(
				hydrateStaticFabAssemblyRelationshipSnapshot(snapshot),
				source,
			),
		).toBe(true);
		expect(
			hydrateStaticFabAssemblyRelationshipSnapshot(snapshot).records[0]?.participantOrganizationIds,
		).toEqual([2, 3]);

		const hydrator = createStaticFabAssemblyRelationshipSnapshotHydrator(snapshot);
		expect(() => hydrator.finish()).toThrow(/not complete/);
		expect(hydrator.step(1)).toBe(1);
		expect(hydrator.done).toBe(false);
		while (!hydrator.done) expect(hydrator.step(7)).toBeGreaterThan(0);
		expect(staticFabAssemblyRelationshipStateEquals(hydrator.finish(), source)).toBe(true);
	});

	it("schedules one maximum-reference and maximum-owner record through final validation and hashing", async () => {
		const source = createStaticFabAssemblyRelationshipState(maximumRecordState());
		const snapshot = createStaticFabAssemblyRelationshipSnapshot(source);
		const hydrator = createStaticFabAssemblyRelationshipSnapshotHydrator(snapshot);
		let operations = 0;
		let maximumStepMs = 0;
		while (!hydrator.done) {
			const started = performance.now();
			const completed = hydrator.step(128);
			maximumStepMs = Math.max(maximumStepMs, performance.now() - started);
			expect(completed).toBeGreaterThan(0);
			expect(completed).toBeLessThanOrEqual(128);
			operations += completed;
		}
		const result = hydrator.finish();
		expect(operations).toBeGreaterThan(
			3 * STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
		);
		expect(maximumStepMs).toBeLessThan(50);
		expect(isCanonicalStaticFabAssemblyRelationshipState(result)).toBe(true);
		expect(checksumStaticFabAssemblyRelationshipState(result)).toBe(
			checksumStaticFabAssemblyRelationshipState(source),
		);
		expect(hydrator.finish()).toBe(result);
		expect(hydrator.step()).toBe(0);
		const record = result.records[0];
		if (!record) throw new Error("Missing maximum relationship record");
		const sync = new RailChecksumAccumulator();
		sync.addAssemblyRelationship(record);
		const cooperative = new RailChecksumAccumulator();
		const emptyDigest = cooperative.digest();
		let checkpoints = 0;
		await cooperative.addAssemblyRelationshipCooperatively(
			record,
			async () => {
				checkpoints++;
				expect(cooperative.digest()).toBe(emptyDigest);
			},
			128,
		);
		expect(checkpoints).toBeGreaterThan(1000);
		expect(cooperative.digest()).toBe(sync.digest());
		snapshot.records.edgeCoordinates.fill(0);
		expect(hydrator.finish()).toBe(result);
	});

	it("keeps failed and unfinished tasks unpublished and preserves checksum state on cancellation", async () => {
		const malformed = createStaticFabAssemblyRelationshipSnapshot(reciprocalState());
		malformed.records.incidenceExclusiveCutEdgeIndexes[0] = 99;
		const task = createStaticFabAssemblyRelationshipSnapshotHydrator(malformed);
		expect(() => task.step(0)).toThrow(/positive/);
		expect(() => {
			while (!task.done) task.step(1);
		}).toThrow();
		expect(task.done).toBe(false);
		expect(() => task.finish()).toThrow();
		expect(() => task.step()).toThrow();
		const checksum = new RailChecksumAccumulator();
		const before = checksum.digest();
		const record = createStaticFabAssemblyRelationshipState(reciprocalState()).records[0];
		if (!record) throw new Error("Missing relationship record");
		await expect(
			checksum.addAssemblyRelationshipCooperatively(
				record,
				async () => {
					throw new Error("cancelled");
				},
				1,
			),
		).rejects.toThrow("cancelled");
		expect(checksum.digest()).toBe(before);
	});

	it("replaces a maximum relationship without publishing the removal before an awaited addition", async () => {
		const before = createStaticFabAssemblyRelationshipState(reciprocalState()).records[0];
		const after = createStaticFabAssemblyRelationshipState(maximumRecordState()).records[0];
		if (!before || !after) throw new Error("Missing relationship records");
		let beforeSlices = 0;
		const checksum = new RailChecksumAccumulator();
		await checksum.addAssemblyRelationshipCooperatively(
			before,
			async () => {
				beforeSlices++;
			},
			128,
		);
		checksum.setAssemblyRelationshipNextId(99);
		const source = checksum.digest();
		const mutation = { id: before.id, before, after };
		let cancelledSlices = 0;
		await expect(
			checksum.applyAssemblyRelationshipMutationCooperatively(
				mutation,
				async () => {
					expect(checksum.digest()).toBe(source);
					if (++cancelledSlices > beforeSlices) throw new Error("cancel during after hash");
				},
				128,
			),
		).rejects.toThrow("cancel during after hash");
		expect(checksum.digest()).toBe(source);
		expect(checksum.assemblyRelationshipCount).toBe(1);
		expect(checksum.assemblyRelationshipNextId).toBe(99);

		const expected = checksum.clone();
		expected.applyAssemblyRelationshipMutation(mutation);
		let slices = 0;
		await checksum.applyAssemblyRelationshipMutationCooperatively(
			mutation,
			async () => {
				slices++;
				expect(checksum.digest()).toBe(source);
			},
			128,
		);
		expect(slices).toBeGreaterThan(1_000);
		expect(checksum.digest()).toBe(expected.digest());
	});

	it("preserves addition, removal, allocation cursors and the final cancellation boundary", async () => {
		const record = createStaticFabAssemblyRelationshipState(reciprocalState()).records[0];
		if (!record) throw new Error("Missing relationship record");
		const checksum = new RailChecksumAccumulator();
		const synchronous = checksum.clone();
		const add = { id: record.id, before: null, after: record };
		let hashSlices = 0;
		await synchronous.addAssemblyRelationshipCooperatively(
			record,
			async () => {
				hashSlices++;
			},
			128,
		);
		const empty = checksum.digest();
		let callbacks = 0;
		await expect(
			checksum.applyAssemblyRelationshipMutationCooperatively(
				add,
				async () => {
					if (++callbacks > hashSlices) throw new Error("cancel before publication");
				},
				128,
			),
		).rejects.toThrow("cancel before publication");
		expect(callbacks).toBe(hashSlices + 1);
		expect(checksum.digest()).toBe(empty);
		await checksum.applyAssemblyRelationshipMutationCooperatively(add, async () => undefined);
		expect(checksum.digest()).toBe(synchronous.digest());
		expect(checksum.assemblyRelationshipNextId).toBe(record.id + 1);
		const remove = { id: record.id, before: record, after: null };
		synchronous.applyAssemblyRelationshipMutation(remove);
		await checksum.applyAssemblyRelationshipMutationCooperatively(remove, async () => undefined);
		expect(checksum.digest()).toBe(synchronous.digest());
		expect(checksum.assemblyRelationshipCount).toBe(0);
		expect(checksum.assemblyRelationshipNextId).toBe(record.id + 1);
		const noOp = { id: record.id, before: null, after: null };
		await expect(
			checksum.applyAssemblyRelationshipMutationCooperatively(noOp, async () => undefined, 0),
		).rejects.toThrow(/operation budget/);
		await expect(
			checksum.applyAssemblyRelationshipMutationCooperatively(noOp, async () => {
				throw new Error("cancel empty");
			}),
		).rejects.toThrow("cancel empty");
		expect(checksum.digest()).toBe(synchronous.digest());
	});

	it("uses bounded relationship hashing in the cooperative patch checksum with unchanged identity", async () => {
		const record = createStaticFabAssemblyRelationshipState(maximumRecordState()).records[0];
		if (!record) throw new Error("Missing relationship record");
		const source = new RailChecksumAccumulator().digest();
		const patch = {
			changes: [],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: [],
			organizationNextIdBefore: 1,
			organizationNextIdAfter: 1,
			relationshipNextIdBefore: 1,
			relationshipNextIdAfter: 99,
			relationshipChanges: [{ id: record.id, before: null, after: record }],
		};
		let callbacks = 0;
		expect(
			await checksumRailPatchResultCooperatively(
				source,
				patch,
				async () => {
					callbacks++;
				},
				128,
			),
		).toBe(checksumRailPatchResult(source, patch));
		expect(callbacks).toBeGreaterThan(1_000);
	});

	it("rejects mutable descendants and frozen accessors at the immutable adoption boundary", () => {
		const source = reciprocalState();
		const shallow = Object.freeze({
			nextRelationshipId: 2,
			records: Object.freeze(source.records),
		});
		const task = createCooperativeTask(adoptStaticFabAssemblyRelationshipStateSteps(shallow));
		expect(() => {
			while (!task.done) task.step(1);
		}).toThrow(/불변/);
		const canonical = createStaticFabAssemblyRelationshipState(reciprocalState());
		const accessor = Object.freeze({
			nextRelationshipId: 2,
			get records() {
				return canonical.records;
			},
		});
		const accessorTask = createCooperativeTask(
			adoptStaticFabAssemblyRelationshipStateSteps(accessor),
		);
		expect(() => {
			while (!accessorTask.done) accessorTask.step(1);
		}).toThrow(/필드/);
		const inheritedSerializer = Object.freeze(
			Object.assign(Object.create({ toJSON: () => ({ records: [] }) }), canonical),
		);
		const prototypeTask = createCooperativeTask(
			adoptStaticFabAssemblyRelationshipStateSteps(inheritedSerializer),
		);
		expect(() => {
			while (!prototypeTask.done) prototypeTask.step(1);
		}).toThrow(/필드/);
	});

	it("rejects late core-only violations and nonstandard immutable array behavior", () => {
		const snapshot = createStaticFabAssemblyRelationshipSnapshot(reciprocalState());
		snapshot.records.managedChildOrganizationIds[0] = 99;
		validateStaticFabAssemblyRelationshipSnapshotStructure(snapshot);
		const task = createStaticFabAssemblyRelationshipSnapshotHydrator(snapshot);
		expect(() => {
			while (!task.done) task.step(1);
		}).toThrow(/관리 자식/);
		expect(() => task.finish()).toThrow(/관리 자식/);
		const canonical = createStaticFabAssemblyRelationshipState(reciprocalState());
		const records = [...canonical.records];
		Object.defineProperty(records, Symbol.iterator, {
			value: function* () {
				/* fabricated empty iteration */
			},
		});
		Object.freeze(records);
		const iteratorTask = createCooperativeTask(
			adoptStaticFabAssemblyRelationshipStateSteps(
				Object.freeze({ nextRelationshipId: 2, records }),
			),
		);
		expect(() => {
			while (!iteratorTask.done) iteratorTask.step(1);
		}).toThrow(/불변/);
	});

	it("owns captured bytes and rejects detached source buffers while capture is pending", () => {
		const snapshot = createStaticFabAssemblyRelationshipSnapshot(reciprocalState());
		const task = createStaticFabAssemblyRelationshipSnapshotHydrator(snapshot);
		task.step(1);
		structuredClone(snapshot.relationshipIds, { transfer: [snapshot.relationshipIds.buffer] });
		expect(() => {
			while (!task.done) task.step(1);
		}).toThrow(/changed/);
		expect(() => task.finish()).toThrow(/changed/);
	});

	it("round-trips full before/after mutations and applies the decoded transition", () => {
		const source = createStaticFabAssemblyRelationshipState(reciprocalState());
		const before = source.records[0];
		if (!before) throw new Error("expected source relationship");
		const after = createStaticFabAssemblyRelationshipState({
			nextRelationshipId: 2,
			records: [{ ...structuredClone(before), parentOrganizationId: 4 }],
		}).records[0];
		if (!after) throw new Error("expected replacement relationship");
		const mutations: readonly StaticFabAssemblyRelationshipMutationV1[] = [
			{ id: 1, before, after },
		];

		const encoded = encodeStaticFabAssemblyRelationshipPatch(mutations, 2, 2);
		const transfers = staticFabAssemblyRelationshipPatchTransfers(encoded.fields);
		expect(encoded.transfer).toEqual(transfers);
		expect(new Set(transfers).size).toBe(transfers.length);
		const decoded = decodeStaticFabAssemblyRelationshipPatch(encoded.fields);
		expect(decoded).toEqual(mutations);
		expect(
			staticFabAssemblyRelationshipStateEquals(
				applyStaticFabAssemblyRelationshipMutations(source, decoded, 2),
				{ nextRelationshipId: 2, records: [after] },
			),
		).toBe(true);
	});

	it("rejects wrong typed columns, aliases, unknown tags, and corrupt CSR offsets", () => {
		const snapshot = createStaticFabAssemblyRelationshipSnapshot(reciprocalState());
		const wrongType = structuredClone(snapshot) as unknown as {
			relationshipIds: Uint32Array;
		};
		wrongType.relationshipIds = new Uint32Array([1]);
		expect(() =>
			validateStaticFabAssemblyRelationshipSnapshotStructure(
				wrongType as unknown as StaticFabAssemblyRelationshipSnapshot,
			),
		).toThrow(/Int32Array/);

		const badTag = structuredClone(snapshot);
		badTag.records.purposes[0] = 255;
		expect(() => validateStaticFabAssemblyRelationshipSnapshotStructure(badTag)).toThrow(/code/);

		const badOffset = structuredClone(snapshot);
		badOffset.records.participantOffsets[1] = 99;
		expect(() => validateStaticFabAssemblyRelationshipSnapshotStructure(badOffset)).toThrow(
			/offsets|payload/,
		);

		const mutation = encodeStaticFabAssemblyRelationshipPatch(
			[{ id: 1, before: reciprocalState().records[0] ?? null, after: null }],
			2,
			2,
		).fields;
		const aliased = structuredClone(mutation) as StaticFabAssemblyRelationshipPatchSoA & {
			before: { purposes: Uint8Array; hierarchyRoles: Uint8Array };
		};
		aliased.before.purposes = aliased.before.hierarchyRoles;
		expect(() => validateStaticFabAssemblyRelationshipPatchStructure(aliased)).toThrow(/aliases/);

		const regressedCursor = structuredClone(mutation);
		(regressedCursor as { nextRelationshipIdBefore: number }).nextRelationshipIdBefore = 3;
		expect(() => validateStaticFabAssemblyRelationshipPatchStructure(regressedCursor)).toThrow(
			/move backward/,
		);
		expect(() =>
			encodeStaticFabAssemblyRelationshipPatch(
				[{ id: 1, before: reciprocalState().records[0] ?? null, after: null }],
				3,
				2,
			),
		).toThrow(/move backward/);
	});

	it("rejects an oversized encoded edge-reference count during structural preflight", () => {
		const snapshot = structuredClone(
			createStaticFabAssemblyRelationshipSnapshot(reciprocalState()),
		);
		const oversized = new Uint32Array(1_000_001);
		(
			snapshot.records as { exclusiveCutEdgeScopedIndexes: Uint32Array }
		).exclusiveCutEdgeScopedIndexes = oversized;
		snapshot.records.legExclusiveCutEdgeOffsets[
			snapshot.records.legExclusiveCutEdgeOffsets.length - 1
		] = oversized.length;

		expect(() => validateStaticFabAssemblyRelationshipSnapshotStructure(snapshot)).toThrow(
			/edge-reference budget/,
		);
	});
});

function reciprocalState(): StaticFabAssemblyRelationshipStateV1 {
	return {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2, 3],
				managedChildOrganizationIds: [2, 3],
				reviewPolicy: "REVIEW_REQUIRED",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [reciprocalLeg(0, "OUTBOUND"), reciprocalLeg(1, "RETURN")],
					},
				],
			},
		],
	};
}

function reciprocalLeg(y: number, role: "OUTBOUND" | "RETURN"): StaticFabAssemblyRelationshipLegV1 {
	const outbound = role === "OUTBOUND";
	const cut = outbound
		? [participantScoped(edge(0, y, 1, y), 0, [2]), participantScoped(edge(1, y, 2, y), 1, [3])]
		: [participantScoped(edge(2, y, 1, y), 1, [3]), participantScoped(edge(1, y, 0, y), 0, [2])];
	const predecessor = parentScoped(outbound ? edge(-1, y, 0, y) : edge(3, y, 2, y));
	const successor = parentScoped(outbound ? edge(2, y, 3, y) : edge(0, y, -1, y));
	const start = contactSeam(witness("INCOMING", predecessor), alias("OUTGOING", 0));
	const end = contactSeam(alias("INCOMING", 1), witness("OUTGOING", successor));
	return {
		ordinal: outbound ? 0 : 1,
		directionRole: role,
		exclusiveCutEdges: cut,
		endpointSupports: [
			{ support: predecessor, adjacentExclusiveCutEdgeIndex: 0, position: "PREDECESSOR" },
			{ support: successor, adjacentExclusiveCutEdgeIndex: 1, position: "SUCCESSOR" },
		],
		seamContacts: outbound ? [start, end] : [end, start],
	};
}

function edge(fromX: number, fromY: number, toX: number, toY: number): DirectedRailEdge {
	return { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
}

function parentScoped(edgeValue: DirectedRailEdge): StaticFabAssemblyScopedEdgeV1 {
	return { edge: edgeValue, scope: { kind: "PARENT_DIRECT" } };
}

function participantScoped(
	edgeValue: DirectedRailEdge,
	participantIndex: 0 | 1,
	directOwnerOrganizationIds: readonly number[],
): StaticFabAssemblyScopedEdgeV1 {
	return {
		edge: edgeValue,
		scope: { kind: "PARTICIPANT_EFFECTIVE", participantIndex, directOwnerOrganizationIds },
	};
}

function witness(incidence: "INCOMING" | "OUTGOING", scopedEdge: StaticFabAssemblyScopedEdgeV1) {
	return { incidence, binding: { kind: "WITNESS" as const, scopedEdge } };
}

function alias(incidence: "INCOMING" | "OUTGOING", exclusiveCutEdgeIndex: number) {
	return {
		incidence,
		binding: { kind: "EXCLUSIVE_CUT_EDGE" as const, exclusiveCutEdgeIndex },
	};
}

function contactSeam(
	incoming: ReturnType<typeof witness> | ReturnType<typeof alias>,
	outgoing: ReturnType<typeof witness> | ReturnType<typeof alias>,
) {
	return { role: "CONTACT" as const, incidences: [incoming, outgoing] };
}

function maximumRecordState(): StaticFabAssemblyRelationshipStateV1 {
	const cutCount = STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD - 8;
	const owners = Array.from({ length: 64 }, (_, index) => index + 2);
	const exclusiveCutEdges = Array.from({ length: cutCount }, (_, index) =>
		index < 1023 || index === cutCount - 1
			? participantScoped(edge(index, 0, index + 1, 0), 0, owners)
			: parentScoped(edge(index, 0, index + 1, 0)),
	);
	const predecessor = parentScoped(edge(-1, 0, 0, 0));
	const successor = parentScoped(edge(cutCount, 0, cutCount + 1, 0));
	return {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
				reviewPolicy: "REVIEW_REQUIRED",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "ATTACHMENT",
								exclusiveCutEdges,
								endpointSupports: [
									{
										support: predecessor,
										adjacentExclusiveCutEdgeIndex: 0,
										position: "PREDECESSOR",
									},
									{
										support: successor,
										adjacentExclusiveCutEdgeIndex: cutCount - 1,
										position: "SUCCESSOR",
									},
								],
								seamContacts: [
									contactSeam(witness("INCOMING", predecessor), alias("OUTGOING", 0)),
									contactSeam(alias("INCOMING", cutCount - 1), witness("OUTGOING", successor)),
								],
							},
						],
					},
				],
			},
		],
	};
}
