import {
	type CooperativeTask,
	completeCooperativeSteps,
	createCooperativeTask,
} from "../core/CooperativeTask";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	adoptStaticFabAssemblyRelationshipStateSteps,
	copyStaticFabAssemblyRelationshipRecord,
	copyStaticFabAssemblyRelationshipState,
	createStaticFabAssemblyRelationshipState,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_DIRECT_OWNER_IDS_PER_SCOPE,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_DOCUMENT,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_RECORD,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_DOCUMENT,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_GROUP,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_DOCUMENT,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_RECORD,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS,
	type StaticFabAssemblyEndpointSupportV1,
	type StaticFabAssemblyRelationshipLegV1,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
	type StaticFabAssemblySeamContactV1,
	type StaticFabAssemblySeamIncidenceV1,
	staticFabAssemblyRelationshipTransitionFootprint,
} from "../core/StaticFabAssemblyRelationship";
import { assertTransferableTypedArray as assertTypedArray } from "./TransferableTypedArray";

export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_SCHEMA_VERSION = 1 as const;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_EDGE_REFERENCES = 2_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_OWNER_IDS = 2_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_CANONICAL_BYTES = 64 * 1024 * 1024;

const UINT32_ABSENT = 0xffff_ffff;

const HIERARCHY_ROLES = ["BAY_TO_BANK", "BANK_TO_FAB"] as const;
const PURPOSES = ["HIERARCHY_LINK", "FAB_LOOP"] as const;
const REVIEW_POLICIES = ["REVIEW_REQUIRED", "AUTHORING_NON_DETACHABLE"] as const;
const DIRECTION_ROLES = ["OUTBOUND", "RETURN", "ATTACHMENT", "CONTACT"] as const;
const SCOPE_KINDS = [
	"PARENT_DIRECT",
	"PARTICIPANT_EFFECTIVE",
	"PARENT_AND_PARTICIPANT_EFFECTIVE",
] as const;
const ENDPOINT_POSITIONS = ["PREDECESSOR", "SUCCESSOR"] as const;
const SEAM_ROLES = ["BRANCH", "MERGE", "CONTACT"] as const;
const INCIDENCE_DIRECTIONS = ["INCOMING", "OUTGOING"] as const;
const INCIDENCE_BINDING_KINDS = ["EXCLUSIVE_CUT_EDGE", "WITNESS"] as const;

export interface StaticFabAssemblyRelationshipScopedEdgeFieldsSoA {
	readonly edgeIndexes: Uint32Array;
	readonly scopeKinds: Uint8Array;
	readonly participantIndexes: Int8Array;
	readonly directOwnerOffsets: Uint32Array;
	readonly directOwnerOrganizationIds: Int32Array;
}

/**
 * Canonical flattened relationship records. Every scoped-edge occurrence references one sorted,
 * unique directed-edge table; list order remains in the CSR index columns.
 */
export interface StaticFabAssemblyRelationshipRecordFieldsSoA {
	readonly hierarchyRoles: Uint8Array;
	readonly purposes: Uint8Array;
	readonly parentOrganizationIds: Int32Array;
	readonly reviewPolicies: Uint8Array;
	readonly participantOffsets: Uint32Array;
	readonly participantOrganizationIds: Int32Array;
	readonly managedChildOffsets: Uint32Array;
	readonly managedChildOrganizationIds: Int32Array;
	readonly connectionGroupOffsets: Uint32Array;
	readonly groupLegOffsets: Uint32Array;
	readonly legDirectionRoles: Uint8Array;
	readonly legExclusiveCutEdgeOffsets: Uint32Array;
	readonly exclusiveCutEdgeScopedIndexes: Uint32Array;
	readonly legEndpointSupportOffsets: Uint32Array;
	readonly endpointSupportScopedIndexes: Uint32Array;
	readonly endpointAdjacentExclusiveCutEdgeIndexes: Uint32Array;
	readonly endpointPositions: Uint8Array;
	readonly legSeamContactOffsets: Uint32Array;
	readonly seamRoles: Uint8Array;
	readonly seamIncidenceOffsets: Uint32Array;
	readonly incidenceDirections: Uint8Array;
	readonly incidenceBindingKinds: Uint8Array;
	readonly incidenceExclusiveCutEdgeIndexes: Uint32Array;
	readonly incidenceWitnessScopedEdgeIndexes: Uint32Array;
	readonly edgeCoordinates: Int32Array;
	readonly scopedEdges: StaticFabAssemblyRelationshipScopedEdgeFieldsSoA;
}

export interface StaticFabAssemblyRelationshipSnapshot {
	readonly schemaVersion: typeof STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION;
	readonly nextRelationshipId: number;
	readonly relationshipIds: Int32Array;
	readonly records: StaticFabAssemblyRelationshipRecordFieldsSoA;
}

export interface StaticFabAssemblyRelationshipPatchSoA {
	readonly schemaVersion: typeof STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_SCHEMA_VERSION;
	readonly relationshipIds: Int32Array;
	readonly nextRelationshipIdBefore: number;
	readonly nextRelationshipIdAfter: number;
	readonly beforePresent: Uint8Array;
	readonly before: StaticFabAssemblyRelationshipRecordFieldsSoA;
	readonly afterPresent: Uint8Array;
	readonly after: StaticFabAssemblyRelationshipRecordFieldsSoA;
}

export interface EncodedStaticFabAssemblyRelationshipPatch {
	readonly fields: StaticFabAssemblyRelationshipPatchSoA;
	readonly transfer: ArrayBuffer[];
}

export type StaticFabAssemblyRelationshipSnapshotHydrator =
	CooperativeTask<StaticFabAssemblyRelationshipStateV1>;

interface RecordCollectionCounts {
	readonly groups: number;
	readonly legs: number;
	readonly exclusiveCutEdges: number;
	readonly endpointSupports: number;
	readonly seamContacts: number;
	readonly incidences: number;
	readonly witnesses: number;
	readonly scopedEdges: number;
	readonly ownerIds: number;
	readonly edgeReferences: number;
	readonly canonicalBytes: number;
}

interface MutableRecordCollectionCounts {
	groups: number;
	legs: number;
	exclusiveCutEdges: number;
	endpointSupports: number;
	seamContacts: number;
	incidences: number;
	witnesses: number;
	scopedEdges: number;
	ownerIds: number;
	edgeReferences: number;
	canonicalBytes: number;
}

export function createStaticFabAssemblyRelationshipSnapshot(
	state: StaticFabAssemblyRelationshipStateV1,
): StaticFabAssemblyRelationshipSnapshot {
	const canonical = copyStaticFabAssemblyRelationshipState(state);
	return Object.freeze({
		schemaVersion: STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION,
		nextRelationshipId: canonical.nextRelationshipId,
		relationshipIds: Int32Array.from(canonical.records, (record) => record.id),
		records: createRecordFields(canonical.records),
	});
}

export function hydrateStaticFabAssemblyRelationshipSnapshot(
	snapshot: StaticFabAssemblyRelationshipSnapshot,
): StaticFabAssemblyRelationshipStateV1 {
	return completeCooperativeSteps(hydrateCapturedRelationshipSnapshotSteps(snapshot));
}

/** Every validation and construction phase advances behind caller-owned checkpoints. */
export function createStaticFabAssemblyRelationshipSnapshotHydrator(
	snapshot: StaticFabAssemblyRelationshipSnapshot,
): StaticFabAssemblyRelationshipSnapshotHydrator {
	return createCooperativeTask(hydrateRelationshipSnapshotSteps(snapshot));
}

type RelationshipColumn = Int8Array | Uint8Array | Int32Array | Uint32Array;

function* captureRelationshipSnapshotSteps(
	input: StaticFabAssemblyRelationshipSnapshot,
): Generator<void, StaticFabAssemblyRelationshipSnapshot> {
	assertExactKeys(
		input,
		["schemaVersion", "nextRelationshipId", "relationshipIds", "records"],
		"relationship snapshot",
	);
	validateRecordFieldTypes(input.records, "relationship snapshot");
	assertTypedArray(input.relationshipIds, Int32Array, "relationship snapshot ids");
	const records = { ...input.records, scopedEdges: { ...input.records.scopedEdges } };
	const captured = {
		schemaVersion: input.schemaVersion,
		nextRelationshipId: input.nextRelationshipId,
		relationshipIds: input.relationshipIds,
		records,
	};
	for (const column of [
		...Object.values(records).filter((value): value is Uint8Array | Int32Array | Uint32Array =>
			ArrayBuffer.isView(value),
		),
		...Object.values(records.scopedEdges),
	]) {
		const limit =
			column === records.edgeCoordinates
				? 4 * STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT
				: STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT + 1;
		if (column.length > limit)
			throw new Error("Relationship snapshot exceeds its capture column budget.");
	}
	const transfers = staticFabAssemblyRelationshipSnapshotTransfers(captured);
	assertUniqueTransferBuffers(transfers, "relationship snapshot");
	// All V1 row/reference budgets fit in this bound; reject allocation attacks before copying.
	if (
		input.relationshipIds.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS ||
		transfers.reduce((bytes, buffer) => bytes + buffer.byteLength, 0) >
			STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES
	) {
		throw new Error("Relationship snapshot exceeds its capture byte or record budget.");
	}
	const copy = function* <T extends RelationshipColumn>(source: T): Generator<void, T> {
		const length = source.length;
		const byteLength = source.buffer.byteLength;
		yield;
		const target = (
			source instanceof Int32Array
				? new Int32Array(length)
				: source instanceof Uint32Array
					? new Uint32Array(length)
					: source instanceof Int8Array
						? new Int8Array(length)
						: new Uint8Array(length)
		) as T;
		for (let offset = 0; offset < length; offset += 1024) {
			yield;
			if (source.length !== length || source.buffer.byteLength !== byteLength)
				throw new Error("Relationship snapshot buffer changed during capture.");
			target.set(source.subarray(offset, Math.min(offset + 1024, length)), offset);
		}
		return target;
	};
	captured.relationshipIds = yield* copy(captured.relationshipIds);
	for (const key of Object.keys(records) as (keyof typeof records)[]) {
		if (key === "scopedEdges") continue;
		// The strict field check above fixes the finite typed-column set.
		(records as unknown as Record<string, RelationshipColumn>)[key] = yield* copy(records[key]);
	}
	for (const key of Object.keys(records.scopedEdges) as (keyof typeof records.scopedEdges)[]) {
		(records.scopedEdges as unknown as Record<string, RelationshipColumn>)[key] = yield* copy(
			records.scopedEdges[key],
		);
	}
	Object.freeze(records.scopedEdges);
	Object.freeze(records);
	return Object.freeze(captured);
}

function* hydrateRelationshipSnapshotSteps(
	input: StaticFabAssemblyRelationshipSnapshot,
): Generator<void, StaticFabAssemblyRelationshipStateV1> {
	const snapshot = yield* captureRelationshipSnapshotSteps(input);
	return yield* hydrateCapturedRelationshipSnapshotSteps(snapshot);
}

function* hydrateCapturedRelationshipSnapshotSteps(
	snapshot: StaticFabAssemblyRelationshipSnapshot,
): Generator<void, StaticFabAssemblyRelationshipStateV1> {
	yield* validateRelationshipSnapshotSteps(snapshot);
	const records: StaticFabAssemblyRelationshipRecordV1[] = [];
	for (let index = 0; index < snapshot.relationshipIds.length; index++) {
		yield;
		records.push(
			yield* readRecordSteps(snapshot.relationshipIds[index] as number, index, snapshot.records),
		);
	}
	return yield* adoptStaticFabAssemblyRelationshipStateSteps(
		Object.freeze({
			nextRelationshipId: snapshot.nextRelationshipId,
			records: Object.freeze(records),
		}),
	);
}

export function staticFabAssemblyRelationshipSnapshotTransfers(
	snapshot: StaticFabAssemblyRelationshipSnapshot,
): ArrayBuffer[] {
	return [
		snapshot.relationshipIds.buffer,
		...recordFieldTransfers(snapshot.records),
	] as ArrayBuffer[];
}

export function validateStaticFabAssemblyRelationshipSnapshotStructure(
	snapshot: StaticFabAssemblyRelationshipSnapshot,
): void {
	completeCooperativeSteps(validateRelationshipSnapshotSteps(snapshot));
}

function* validateRelationshipSnapshotSteps(
	snapshot: StaticFabAssemblyRelationshipSnapshot,
): Generator<void> {
	assertExactKeys(
		snapshot,
		["schemaVersion", "nextRelationshipId", "relationshipIds", "records"],
		"Static FAB assembly relationship snapshot",
	);
	if (snapshot.schemaVersion !== STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported static FAB assembly relationship snapshot schema ${snapshot.schemaVersion}.`,
		);
	}
	assertTypedArray(snapshot.relationshipIds, Int32Array, "relationship snapshot ids");
	validatePositiveInt32(snapshot.nextRelationshipId, "relationship snapshot cursor");
	if (snapshot.relationshipIds.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS) {
		throw new Error("Static FAB assembly relationship snapshot exceeds its record budget.");
	}
	yield* validateCanonicalPositiveInt32IdsSteps(
		snapshot.relationshipIds,
		"relationship snapshot ids",
	);
	const maximumId = snapshot.relationshipIds.at(-1) ?? 0;
	if (snapshot.nextRelationshipId <= maximumId) {
		throw new Error(
			"Static FAB assembly relationship snapshot cursor must exceed every record id.",
		);
	}
	yield* validateRecordFieldsSteps(
		snapshot.records,
		snapshot.relationshipIds.length,
		undefined,
		"relationship snapshot",
		{
			maximumEdgeReferences: STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT,
			maximumOwnerIds: STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_DOCUMENT,
			maximumCanonicalBytes: STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES,
		},
	);
	assertUniqueTransferBuffers(
		staticFabAssemblyRelationshipSnapshotTransfers(snapshot),
		"relationship snapshot",
	);
}

export function encodeStaticFabAssemblyRelationshipPatch(
	mutations: readonly StaticFabAssemblyRelationshipMutationV1[],
	nextRelationshipIdBefore: number,
	nextRelationshipIdAfter: number,
): EncodedStaticFabAssemblyRelationshipPatch {
	staticFabAssemblyRelationshipTransitionFootprint(mutations, {
		maximumEdgeReferences: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_EDGE_REFERENCES,
		maximumOwnerIds: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_OWNER_IDS,
		maximumCanonicalBytes: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_CANONICAL_BYTES,
	});
	validatePositiveInt32(nextRelationshipIdBefore, "relationship patch before cursor");
	validatePositiveInt32(nextRelationshipIdAfter, "relationship patch after cursor");
	if (nextRelationshipIdAfter < nextRelationshipIdBefore) {
		throw new Error("Relationship patch cursor must not move backward.");
	}
	const relationshipIds = new Int32Array(mutations.length);
	const beforePresent = new Uint8Array(mutations.length);
	const afterPresent = new Uint8Array(mutations.length);
	const beforeRecords = new Array<StaticFabAssemblyRelationshipRecordV1 | null>(mutations.length);
	const afterRecords = new Array<StaticFabAssemblyRelationshipRecordV1 | null>(mutations.length);
	let previousId = 0;
	for (let index = 0; index < mutations.length; index++) {
		const mutation = mutations[index] as StaticFabAssemblyRelationshipMutationV1;
		if (mutation.id <= previousId) {
			throw new Error("Static FAB assembly relationship patch ids must be in canonical order.");
		}
		previousId = mutation.id;
		relationshipIds[index] = mutation.id;
		if (mutation.before) {
			beforePresent[index] = 1;
			beforeRecords[index] = copyStaticFabAssemblyRelationshipRecord(mutation.before);
		} else beforeRecords[index] = null;
		if (mutation.after) {
			afterPresent[index] = 1;
			afterRecords[index] = copyStaticFabAssemblyRelationshipRecord(mutation.after);
		} else afterRecords[index] = null;
	}
	const fields = Object.freeze({
		schemaVersion: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_SCHEMA_VERSION,
		relationshipIds,
		nextRelationshipIdBefore,
		nextRelationshipIdAfter,
		beforePresent,
		before: createRecordFields(beforeRecords),
		afterPresent,
		after: createRecordFields(afterRecords),
	}) satisfies StaticFabAssemblyRelationshipPatchSoA;
	validateStaticFabAssemblyRelationshipPatchStructure(fields);
	return Object.freeze({
		fields,
		transfer: staticFabAssemblyRelationshipPatchTransfers(fields),
	});
}

export function decodeStaticFabAssemblyRelationshipPatch(
	fields: StaticFabAssemblyRelationshipPatchSoA,
): readonly StaticFabAssemblyRelationshipMutationV1[] {
	validateStaticFabAssemblyRelationshipPatchStructure(fields);
	const beforeState = createStaticFabAssemblyRelationshipState({
		nextRelationshipId: fields.nextRelationshipIdBefore,
		records: readPresentRecords(fields.relationshipIds, fields.beforePresent, fields.before),
	});
	const afterState = createStaticFabAssemblyRelationshipState({
		nextRelationshipId: fields.nextRelationshipIdAfter,
		records: readPresentRecords(fields.relationshipIds, fields.afterPresent, fields.after),
	});
	const beforeById = new Map(beforeState.records.map((record) => [record.id, record]));
	const afterById = new Map(afterState.records.map((record) => [record.id, record]));
	const mutations = Array.from(fields.relationshipIds, (id) =>
		Object.freeze({
			id,
			before: beforeById.get(id) ?? null,
			after: afterById.get(id) ?? null,
		}),
	);
	staticFabAssemblyRelationshipTransitionFootprint(mutations, {
		maximumEdgeReferences: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_EDGE_REFERENCES,
		maximumOwnerIds: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_OWNER_IDS,
		maximumCanonicalBytes: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_CANONICAL_BYTES,
	});
	return Object.freeze(mutations);
}

export function staticFabAssemblyRelationshipPatchTransfers(
	fields: StaticFabAssemblyRelationshipPatchSoA,
): ArrayBuffer[] {
	return [
		fields.relationshipIds.buffer,
		fields.beforePresent.buffer,
		...recordFieldTransfers(fields.before),
		fields.afterPresent.buffer,
		...recordFieldTransfers(fields.after),
	] as ArrayBuffer[];
}

export function validateStaticFabAssemblyRelationshipPatchStructure(
	fields: StaticFabAssemblyRelationshipPatchSoA,
): void {
	assertExactKeys(
		fields,
		[
			"schemaVersion",
			"relationshipIds",
			"nextRelationshipIdBefore",
			"nextRelationshipIdAfter",
			"beforePresent",
			"before",
			"afterPresent",
			"after",
		],
		"Static FAB assembly relationship patch",
	);
	if (fields.schemaVersion !== STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported static FAB assembly relationship patch schema ${fields.schemaVersion}.`,
		);
	}
	assertTypedArray(fields.relationshipIds, Int32Array, "relationship patch ids");
	assertTypedArray(fields.beforePresent, Uint8Array, "relationship patch before presence");
	assertTypedArray(fields.afterPresent, Uint8Array, "relationship patch after presence");
	validateCanonicalPositiveInt32Ids(fields.relationshipIds, "relationship patch ids");
	validatePositiveInt32(fields.nextRelationshipIdBefore, "relationship patch before cursor");
	validatePositiveInt32(fields.nextRelationshipIdAfter, "relationship patch after cursor");
	if (fields.nextRelationshipIdAfter < fields.nextRelationshipIdBefore) {
		throw new Error("Relationship patch cursor must not move backward.");
	}
	if (fields.relationshipIds.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS * 2) {
		throw new Error("Static FAB assembly relationship patch exceeds its mutation-row budget.");
	}
	validatePresence(
		fields.beforePresent,
		fields.relationshipIds.length,
		"relationship patch before",
	);
	validatePresence(fields.afterPresent, fields.relationshipIds.length, "relationship patch after");
	for (let index = 0; index < fields.relationshipIds.length; index++) {
		const id = fields.relationshipIds[index] as number;
		const beforePresent = (fields.beforePresent[index] as number) === 1;
		const afterPresent = (fields.afterPresent[index] as number) === 1;
		if (!beforePresent && !afterPresent) {
			throw new Error(`Static FAB assembly relationship patch row ${index} is empty.`);
		}
		if (beforePresent && id >= fields.nextRelationshipIdBefore) {
			throw new Error(`Relationship patch before cursor does not cover record ${id}.`);
		}
		if (afterPresent && id >= fields.nextRelationshipIdAfter) {
			throw new Error(`Relationship patch after cursor does not cover record ${id}.`);
		}
	}
	const beforeCounts = validateRecordFields(
		fields.before,
		fields.relationshipIds.length,
		fields.beforePresent,
		"relationship patch before",
		{
			maximumEdgeReferences: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_EDGE_REFERENCES,
			maximumOwnerIds: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_OWNER_IDS,
			maximumCanonicalBytes: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_CANONICAL_BYTES,
		},
	);
	const afterCounts = validateRecordFields(
		fields.after,
		fields.relationshipIds.length,
		fields.afterPresent,
		"relationship patch after",
		{
			maximumEdgeReferences: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_EDGE_REFERENCES,
			maximumOwnerIds: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_OWNER_IDS,
			maximumCanonicalBytes: STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_CANONICAL_BYTES,
		},
	);
	if (
		beforeCounts.edgeReferences + afterCounts.edgeReferences >
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_EDGE_REFERENCES
	) {
		throw new Error("Static FAB assembly relationship patch exceeds its transition edge budget.");
	}
	if (
		beforeCounts.ownerIds + afterCounts.ownerIds >
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_OWNER_IDS
	) {
		throw new Error("Static FAB assembly relationship patch exceeds its transition owner budget.");
	}
	if (
		beforeCounts.canonicalBytes + afterCounts.canonicalBytes - 16 >
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_PATCH_MAX_CANONICAL_BYTES
	) {
		throw new Error("Static FAB assembly relationship patch exceeds its transition byte budget.");
	}
	assertUniqueTransferBuffers(
		staticFabAssemblyRelationshipPatchTransfers(fields),
		"relationship patch",
	);
}

function createRecordFields(
	records: readonly (StaticFabAssemblyRelationshipRecordV1 | null)[],
): StaticFabAssemblyRelationshipRecordFieldsSoA {
	const counts = countRecordCollection(records);
	const edgeTable = collectCanonicalEdgeTable(records);
	const edgeIndexesByKey = new Map<string, number>();
	for (let index = 0; index < edgeTable.length; index++) {
		edgeIndexesByKey.set(edgeKey(edgeTable[index] as DirectedRailEdge), index);
	}

	const hierarchyRoles = new Uint8Array(records.length);
	const purposes = new Uint8Array(records.length);
	const parentOrganizationIds = new Int32Array(records.length);
	const reviewPolicies = new Uint8Array(records.length);
	const participantOffsets = new Uint32Array(records.length + 1);
	const participantOrganizationIds = new Int32Array(
		records.reduce((total, record) => total + (record?.participantOrganizationIds.length ?? 0), 0),
	);
	const managedChildOffsets = new Uint32Array(records.length + 1);
	const managedChildOrganizationIds = new Int32Array(
		records.reduce((total, record) => total + (record?.managedChildOrganizationIds.length ?? 0), 0),
	);
	const connectionGroupOffsets = new Uint32Array(records.length + 1);
	const groupLegOffsets = new Uint32Array(counts.groups + 1);
	const legDirectionRoles = new Uint8Array(counts.legs);
	const legExclusiveCutEdgeOffsets = new Uint32Array(counts.legs + 1);
	const exclusiveCutEdgeScopedIndexes = new Uint32Array(counts.exclusiveCutEdges);
	const legEndpointSupportOffsets = new Uint32Array(counts.legs + 1);
	const endpointSupportScopedIndexes = new Uint32Array(counts.endpointSupports);
	const endpointAdjacentExclusiveCutEdgeIndexes = new Uint32Array(counts.endpointSupports);
	const endpointPositions = new Uint8Array(counts.endpointSupports);
	const legSeamContactOffsets = new Uint32Array(counts.legs + 1);
	const seamRoles = new Uint8Array(counts.seamContacts);
	const seamIncidenceOffsets = new Uint32Array(counts.seamContacts + 1);
	const incidenceDirections = new Uint8Array(counts.incidences);
	const incidenceBindingKinds = new Uint8Array(counts.incidences);
	const incidenceExclusiveCutEdgeIndexes = new Uint32Array(counts.incidences);
	incidenceExclusiveCutEdgeIndexes.fill(UINT32_ABSENT);
	const incidenceWitnessScopedEdgeIndexes = new Uint32Array(counts.incidences);
	incidenceWitnessScopedEdgeIndexes.fill(UINT32_ABSENT);
	const edgeCoordinates = new Int32Array(edgeTable.length * 4);
	for (let index = 0; index < edgeTable.length; index++) {
		writeEdge(edgeCoordinates, index, edgeTable[index] as DirectedRailEdge);
	}
	const scopedEdges: StaticFabAssemblyRelationshipScopedEdgeFieldsSoA = {
		edgeIndexes: new Uint32Array(counts.scopedEdges),
		scopeKinds: new Uint8Array(counts.scopedEdges),
		participantIndexes: new Int8Array(counts.scopedEdges),
		directOwnerOffsets: new Uint32Array(counts.scopedEdges + 1),
		directOwnerOrganizationIds: new Int32Array(counts.ownerIds),
	};
	scopedEdges.participantIndexes.fill(-1);

	let participantIndex = 0;
	let managedIndex = 0;
	let groupIndex = 0;
	let legIndex = 0;
	let exclusiveIndex = 0;
	let endpointIndex = 0;
	let seamIndex = 0;
	let incidenceIndex = 0;
	let scopedIndex = 0;
	let ownerIndex = 0;
	const writeScoped = (scoped: StaticFabAssemblyScopedEdgeV1): number => {
		const result = scopedIndex++;
		const edgeIndex = edgeIndexesByKey.get(edgeKey(scoped.edge));
		if (edgeIndex === undefined)
			throw new Error("Relationship scoped edge is absent from its table.");
		scopedEdges.edgeIndexes[result] = edgeIndex;
		scopedEdges.scopeKinds[result] = tagIndex(SCOPE_KINDS, scoped.scope.kind);
		scopedEdges.directOwnerOffsets[result] = ownerIndex;
		if (scoped.scope.kind !== "PARENT_DIRECT") {
			scopedEdges.participantIndexes[result] = scoped.scope.participantIndex;
			for (const ownerId of scoped.scope.directOwnerOrganizationIds) {
				scopedEdges.directOwnerOrganizationIds[ownerIndex++] = ownerId;
			}
		}
		scopedEdges.directOwnerOffsets[result + 1] = ownerIndex;
		return result;
	};

	for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
		const record = records[recordIndex];
		participantOffsets[recordIndex] = participantIndex;
		managedChildOffsets[recordIndex] = managedIndex;
		connectionGroupOffsets[recordIndex] = groupIndex;
		if (!record) continue;
		hierarchyRoles[recordIndex] = tagIndex(HIERARCHY_ROLES, record.hierarchyRole);
		purposes[recordIndex] = tagIndex(PURPOSES, record.purpose);
		parentOrganizationIds[recordIndex] = record.parentOrganizationId;
		reviewPolicies[recordIndex] = tagIndex(REVIEW_POLICIES, record.reviewPolicy);
		for (const id of record.participantOrganizationIds) {
			participantOrganizationIds[participantIndex++] = id;
		}
		for (const id of record.managedChildOrganizationIds) {
			managedChildOrganizationIds[managedIndex++] = id;
		}
		for (const group of record.connectionGroups) {
			groupLegOffsets[groupIndex] = legIndex;
			groupIndex++;
			for (const leg of group.legs) {
				legDirectionRoles[legIndex] = tagIndex(DIRECTION_ROLES, leg.directionRole);
				legExclusiveCutEdgeOffsets[legIndex] = exclusiveIndex;
				for (const scoped of leg.exclusiveCutEdges) {
					exclusiveCutEdgeScopedIndexes[exclusiveIndex++] = writeScoped(scoped);
				}
				legEndpointSupportOffsets[legIndex] = endpointIndex;
				for (const endpoint of leg.endpointSupports) {
					endpointSupportScopedIndexes[endpointIndex] = writeScoped(endpoint.support);
					endpointAdjacentExclusiveCutEdgeIndexes[endpointIndex] =
						endpoint.adjacentExclusiveCutEdgeIndex;
					endpointPositions[endpointIndex] = tagIndex(ENDPOINT_POSITIONS, endpoint.position);
					endpointIndex++;
				}
				legSeamContactOffsets[legIndex] = seamIndex;
				for (const seam of leg.seamContacts) {
					seamRoles[seamIndex] = tagIndex(SEAM_ROLES, seam.role);
					seamIncidenceOffsets[seamIndex] = incidenceIndex;
					seamIndex++;
					for (const incidence of seam.incidences) {
						incidenceDirections[incidenceIndex] = tagIndex(
							INCIDENCE_DIRECTIONS,
							incidence.incidence,
						);
						incidenceBindingKinds[incidenceIndex] = tagIndex(
							INCIDENCE_BINDING_KINDS,
							incidence.binding.kind,
						);
						if (incidence.binding.kind === "EXCLUSIVE_CUT_EDGE") {
							incidenceExclusiveCutEdgeIndexes[incidenceIndex] =
								incidence.binding.exclusiveCutEdgeIndex;
						} else {
							incidenceWitnessScopedEdgeIndexes[incidenceIndex] = writeScoped(
								incidence.binding.scopedEdge,
							);
						}
						incidenceIndex++;
					}
				}
				legIndex++;
			}
		}
	}
	participantOffsets[records.length] = participantIndex;
	managedChildOffsets[records.length] = managedIndex;
	connectionGroupOffsets[records.length] = groupIndex;
	groupLegOffsets[counts.groups] = legIndex;
	legExclusiveCutEdgeOffsets[counts.legs] = exclusiveIndex;
	legEndpointSupportOffsets[counts.legs] = endpointIndex;
	legSeamContactOffsets[counts.legs] = seamIndex;
	seamIncidenceOffsets[counts.seamContacts] = incidenceIndex;
	scopedEdges.directOwnerOffsets[counts.scopedEdges] = ownerIndex;

	return Object.freeze({
		hierarchyRoles,
		purposes,
		parentOrganizationIds,
		reviewPolicies,
		participantOffsets,
		participantOrganizationIds,
		managedChildOffsets,
		managedChildOrganizationIds,
		connectionGroupOffsets,
		groupLegOffsets,
		legDirectionRoles,
		legExclusiveCutEdgeOffsets,
		exclusiveCutEdgeScopedIndexes,
		legEndpointSupportOffsets,
		endpointSupportScopedIndexes,
		endpointAdjacentExclusiveCutEdgeIndexes,
		endpointPositions,
		legSeamContactOffsets,
		seamRoles,
		seamIncidenceOffsets,
		incidenceDirections,
		incidenceBindingKinds,
		incidenceExclusiveCutEdgeIndexes,
		incidenceWitnessScopedEdgeIndexes,
		edgeCoordinates,
		scopedEdges: Object.freeze(scopedEdges),
	});
}

function countRecordCollection(
	records: readonly (StaticFabAssemblyRelationshipRecordV1 | null)[],
): RecordCollectionCounts {
	const counts: MutableRecordCollectionCounts = {
		groups: 0,
		legs: 0,
		exclusiveCutEdges: 0,
		endpointSupports: 0,
		seamContacts: 0,
		incidences: 0,
		witnesses: 0,
		scopedEdges: 0,
		ownerIds: 0,
		edgeReferences: 0,
		canonicalBytes: 8,
	};
	for (const record of records) {
		if (!record) continue;
		counts.canonicalBytes +=
			32 +
			record.participantOrganizationIds.length * 4 +
			record.managedChildOrganizationIds.length * 4;
		for (const group of record.connectionGroups) {
			counts.groups++;
			counts.canonicalBytes += 8;
			for (const leg of group.legs) {
				counts.legs++;
				counts.canonicalBytes += 20;
				for (const scoped of leg.exclusiveCutEdges) {
					counts.exclusiveCutEdges++;
					counts.scopedEdges++;
					counts.edgeReferences++;
					addScopedCounts(counts, scoped);
				}
				for (const endpoint of leg.endpointSupports) {
					counts.endpointSupports++;
					counts.scopedEdges++;
					counts.edgeReferences += 2;
					counts.canonicalBytes += 8;
					addScopedCounts(counts, endpoint.support);
				}
				for (const seam of leg.seamContacts) {
					counts.seamContacts++;
					counts.canonicalBytes += 8;
					for (const incidence of seam.incidences) {
						counts.incidences++;
						counts.edgeReferences++;
						if (incidence.binding.kind === "EXCLUSIVE_CUT_EDGE") {
							counts.canonicalBytes += 12;
						} else {
							counts.witnesses++;
							counts.scopedEdges++;
							counts.canonicalBytes += 8;
							addScopedCounts(counts, incidence.binding.scopedEdge);
						}
					}
				}
			}
		}
	}
	return counts;
}

function addScopedCounts(
	counts: MutableRecordCollectionCounts,
	scoped: StaticFabAssemblyScopedEdgeV1,
): void {
	if (scoped.scope.kind === "PARENT_DIRECT") {
		counts.canonicalBytes += 20;
		return;
	}
	counts.ownerIds += scoped.scope.directOwnerOrganizationIds.length;
	counts.canonicalBytes += 28 + scoped.scope.directOwnerOrganizationIds.length * 4;
}

function collectCanonicalEdgeTable(
	records: readonly (StaticFabAssemblyRelationshipRecordV1 | null)[],
): readonly DirectedRailEdge[] {
	const byKey = new Map<string, DirectedRailEdge>();
	const collect = (scoped: StaticFabAssemblyScopedEdgeV1): void => {
		byKey.set(edgeKey(scoped.edge), scoped.edge);
	};
	for (const record of records) {
		if (!record) continue;
		for (const group of record.connectionGroups) {
			for (const leg of group.legs) {
				for (const scoped of leg.exclusiveCutEdges) collect(scoped);
				for (const endpoint of leg.endpointSupports) collect(endpoint.support);
				for (const seam of leg.seamContacts) {
					for (const incidence of seam.incidences) {
						if (incidence.binding.kind === "WITNESS") collect(incidence.binding.scopedEdge);
					}
				}
			}
		}
	}
	return [...byKey.values()].sort(compareEdges);
}

function readPresentRecords(
	relationshipIds: Int32Array,
	presence: Uint8Array | undefined,
	fields: StaticFabAssemblyRelationshipRecordFieldsSoA,
): readonly StaticFabAssemblyRelationshipRecordV1[] {
	const records: StaticFabAssemblyRelationshipRecordV1[] = [];
	for (let recordIndex = 0; recordIndex < relationshipIds.length; recordIndex++) {
		if (!presence || (presence[recordIndex] as number) === 1) {
			records.push(readRecordAt(relationshipIds[recordIndex] as number, recordIndex, fields));
		}
	}
	return records;
}

function readRecordAt(
	id: number,
	recordIndex: number,
	fields: StaticFabAssemblyRelationshipRecordFieldsSoA,
): StaticFabAssemblyRelationshipRecordV1 {
	return completeCooperativeSteps(readRecordSteps(id, recordIndex, fields));
}

function* readRecordSteps(
	id: number,
	recordIndex: number,
	fields: StaticFabAssemblyRelationshipRecordFieldsSoA,
): Generator<void, StaticFabAssemblyRelationshipRecordV1> {
	const readScoped = (index: number): StaticFabAssemblyScopedEdgeV1 => {
		const edge = readEdge(fields.edgeCoordinates, fields.scopedEdges.edgeIndexes[index] as number);
		const scopeKind = readTag(SCOPE_KINDS, fields.scopedEdges.scopeKinds[index] as number, "scope");
		if (scopeKind === "PARENT_DIRECT")
			return freezeScopedEdge({ edge, scope: { kind: scopeKind } });
		const ownerStart = fields.scopedEdges.directOwnerOffsets[index] as number;
		const ownerEnd = fields.scopedEdges.directOwnerOffsets[index + 1] as number;
		return freezeScopedEdge({
			edge,
			scope: {
				kind: scopeKind,
				participantIndex: fields.scopedEdges.participantIndexes[index] as 0 | 1,
				directOwnerOrganizationIds: Array.from(
					fields.scopedEdges.directOwnerOrganizationIds.subarray(ownerStart, ownerEnd),
				),
			},
		});
	};
	const groups: Array<{ ordinal: number; legs: readonly StaticFabAssemblyRelationshipLegV1[] }> =
		[];
	const groupStart = fields.connectionGroupOffsets[recordIndex] as number;
	const groupEnd = fields.connectionGroupOffsets[recordIndex + 1] as number;
	for (let groupIndex = groupStart; groupIndex < groupEnd; groupIndex++) {
		yield;
		const legs: StaticFabAssemblyRelationshipLegV1[] = [];
		const legStart = fields.groupLegOffsets[groupIndex] as number;
		const legEnd = fields.groupLegOffsets[groupIndex + 1] as number;
		for (let legIndex = legStart; legIndex < legEnd; legIndex++) {
			yield;
			const exclusiveCutEdges: StaticFabAssemblyScopedEdgeV1[] = [];
			const exclusiveStart = fields.legExclusiveCutEdgeOffsets[legIndex] as number;
			const exclusiveEnd = fields.legExclusiveCutEdgeOffsets[legIndex + 1] as number;
			for (let index = exclusiveStart; index < exclusiveEnd; index++) {
				yield;
				exclusiveCutEdges.push(readScoped(fields.exclusiveCutEdgeScopedIndexes[index] as number));
			}

			const endpointSupports: StaticFabAssemblyEndpointSupportV1[] = [];
			const endpointStart = fields.legEndpointSupportOffsets[legIndex] as number;
			const endpointEnd = fields.legEndpointSupportOffsets[legIndex + 1] as number;
			for (let index = endpointStart; index < endpointEnd; index++) {
				yield;
				endpointSupports.push(
					Object.freeze({
						support: readScoped(fields.endpointSupportScopedIndexes[index] as number),
						adjacentExclusiveCutEdgeIndex: fields.endpointAdjacentExclusiveCutEdgeIndexes[
							index
						] as number,
						position: readTag(
							ENDPOINT_POSITIONS,
							fields.endpointPositions[index] as number,
							"endpoint position",
						),
					}),
				);
			}

			const seamContacts: StaticFabAssemblySeamContactV1[] = [];
			const seamStart = fields.legSeamContactOffsets[legIndex] as number;
			const seamEnd = fields.legSeamContactOffsets[legIndex + 1] as number;
			for (let seamIndex = seamStart; seamIndex < seamEnd; seamIndex++) {
				yield;
				const incidences: StaticFabAssemblySeamIncidenceV1[] = [];
				const incidenceStart = fields.seamIncidenceOffsets[seamIndex] as number;
				const incidenceEnd = fields.seamIncidenceOffsets[seamIndex + 1] as number;
				for (let incidenceIndex = incidenceStart; incidenceIndex < incidenceEnd; incidenceIndex++) {
					yield;
					const incidence = readTag(
						INCIDENCE_DIRECTIONS,
						fields.incidenceDirections[incidenceIndex] as number,
						"seam incidence",
					);
					const bindingKind = readTag(
						INCIDENCE_BINDING_KINDS,
						fields.incidenceBindingKinds[incidenceIndex] as number,
						"seam binding",
					);
					incidences.push(
						bindingKind === "EXCLUSIVE_CUT_EDGE"
							? {
									incidence,
									binding: {
										kind: bindingKind,
										exclusiveCutEdgeIndex: fields.incidenceExclusiveCutEdgeIndexes[
											incidenceIndex
										] as number,
									},
								}
							: {
									incidence,
									binding: {
										kind: bindingKind,
										scopedEdge: readScoped(
											fields.incidenceWitnessScopedEdgeIndexes[incidenceIndex] as number,
										),
									},
								},
					);
				}
				for (const incidence of incidences) {
					Object.freeze(incidence.binding);
					Object.freeze(incidence);
				}
				seamContacts.push(
					Object.freeze({
						role: readTag(SEAM_ROLES, fields.seamRoles[seamIndex] as number, "seam role"),
						incidences: Object.freeze(incidences),
					}),
				);
			}

			legs.push(
				Object.freeze({
					ordinal: legIndex - legStart,
					directionRole: readTag(
						DIRECTION_ROLES,
						fields.legDirectionRoles[legIndex] as number,
						"leg direction",
					),
					exclusiveCutEdges: Object.freeze(exclusiveCutEdges),
					endpointSupports: Object.freeze(endpointSupports),
					seamContacts: Object.freeze(seamContacts),
				}),
			);
		}
		groups.push(Object.freeze({ ordinal: groupIndex - groupStart, legs: Object.freeze(legs) }));
	}
	const participantStart = fields.participantOffsets[recordIndex] as number;
	const participantEnd = fields.participantOffsets[recordIndex + 1] as number;
	const participants = Array.from(
		fields.participantOrganizationIds.subarray(participantStart, participantEnd),
	);
	const managedStart = fields.managedChildOffsets[recordIndex] as number;
	const managedEnd = fields.managedChildOffsets[recordIndex + 1] as number;
	return Object.freeze({
		id,
		hierarchyRole: readTag(
			HIERARCHY_ROLES,
			fields.hierarchyRoles[recordIndex] as number,
			"hierarchy role",
		),
		purpose: readTag(PURPOSES, fields.purposes[recordIndex] as number, "purpose"),
		parentOrganizationId: fields.parentOrganizationIds[recordIndex] as number,
		participantOrganizationIds: Object.freeze(participants) as
			| readonly [number]
			| readonly [number, number],
		managedChildOrganizationIds: Object.freeze(
			Array.from(fields.managedChildOrganizationIds.subarray(managedStart, managedEnd)),
		),
		reviewPolicy: readTag(
			REVIEW_POLICIES,
			fields.reviewPolicies[recordIndex] as number,
			"review policy",
		),
		connectionGroups: Object.freeze(groups),
	});
}

function freezeScopedEdge(scoped: StaticFabAssemblyScopedEdgeV1): StaticFabAssemblyScopedEdgeV1 {
	Object.freeze(scoped.edge.from);
	Object.freeze(scoped.edge.to);
	Object.freeze(scoped.edge);
	if (scoped.scope.kind !== "PARENT_DIRECT") Object.freeze(scoped.scope.directOwnerOrganizationIds);
	Object.freeze(scoped.scope);
	return Object.freeze(scoped);
}

function validateRecordFields(
	fields: StaticFabAssemblyRelationshipRecordFieldsSoA,
	recordCount: number,
	presence: Uint8Array | undefined,
	label: string,
	limits: {
		readonly maximumEdgeReferences: number;
		readonly maximumOwnerIds: number;
		readonly maximumCanonicalBytes: number;
	},
): RecordCollectionCounts {
	return completeCooperativeSteps(
		validateRecordFieldsSteps(fields, recordCount, presence, label, limits),
	);
}

function* validateRecordFieldsSteps(
	fields: StaticFabAssemblyRelationshipRecordFieldsSoA,
	recordCount: number,
	presence: Uint8Array | undefined,
	label: string,
	limits: {
		readonly maximumEdgeReferences: number;
		readonly maximumOwnerIds: number;
		readonly maximumCanonicalBytes: number;
	},
): Generator<void, RecordCollectionCounts> {
	validateRecordFieldTypes(fields, label);

	const presentRecordCount = presence
		? yield* countPresentRowsSteps(presence, recordCount, label)
		: recordCount;
	if (presentRecordCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS) {
		throw new Error(`${label} exceeds its relationship record budget.`);
	}
	if (
		fields.hierarchyRoles.length !== recordCount ||
		fields.purposes.length !== recordCount ||
		fields.parentOrganizationIds.length !== recordCount ||
		fields.reviewPolicies.length !== recordCount
	) {
		throw new Error(`${label} scalar column lengths do not match its record count.`);
	}
	yield* validateOffsetsSteps(
		fields.participantOffsets,
		recordCount,
		fields.participantOrganizationIds.length,
		`${label} participant offsets`,
	);
	yield* validateOffsetsSteps(
		fields.managedChildOffsets,
		recordCount,
		fields.managedChildOrganizationIds.length,
		`${label} managed-child offsets`,
	);
	yield* validateOffsetsSteps(
		fields.connectionGroupOffsets,
		recordCount,
		fields.groupLegOffsets.length - 1,
		`${label} connection-group offsets`,
	);
	const groupCount = fields.groupLegOffsets.length - 1;
	if (groupCount < 0 || groupCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_DOCUMENT) {
		throw new Error(`${label} exceeds its connection-group budget.`);
	}
	yield* validateOffsetsSteps(
		fields.groupLegOffsets,
		groupCount,
		fields.legDirectionRoles.length,
		`${label} group-leg offsets`,
	);
	const legCount = fields.legDirectionRoles.length;
	if (legCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_DOCUMENT) {
		throw new Error(`${label} exceeds its leg budget.`);
	}
	yield* validateOffsetsSteps(
		fields.legExclusiveCutEdgeOffsets,
		legCount,
		fields.exclusiveCutEdgeScopedIndexes.length,
		`${label} exclusive-cut offsets`,
	);
	yield* validateOffsetsSteps(
		fields.legEndpointSupportOffsets,
		legCount,
		fields.endpointSupportScopedIndexes.length,
		`${label} endpoint-support offsets`,
	);
	if (
		fields.endpointAdjacentExclusiveCutEdgeIndexes.length !==
			fields.endpointSupportScopedIndexes.length ||
		fields.endpointPositions.length !== fields.endpointSupportScopedIndexes.length
	) {
		throw new Error(`${label} endpoint-support column lengths do not match.`);
	}
	yield* validateOffsetsSteps(
		fields.legSeamContactOffsets,
		legCount,
		fields.seamRoles.length,
		`${label} seam-contact offsets`,
	);
	yield* validateOffsetsSteps(
		fields.seamIncidenceOffsets,
		fields.seamRoles.length,
		fields.incidenceDirections.length,
		`${label} seam-incidence offsets`,
	);
	if (
		fields.incidenceBindingKinds.length !== fields.incidenceDirections.length ||
		fields.incidenceExclusiveCutEdgeIndexes.length !== fields.incidenceDirections.length ||
		fields.incidenceWitnessScopedEdgeIndexes.length !== fields.incidenceDirections.length
	) {
		throw new Error(`${label} seam-incidence column lengths do not match.`);
	}
	if (fields.edgeCoordinates.length % 4 !== 0) {
		throw new Error(`${label} edge table coordinates must contain four values per edge.`);
	}
	const edgeCount = fields.edgeCoordinates.length / 4;
	if (edgeCount > limits.maximumEdgeReferences) {
		throw new Error(`${label} edge table exceeds its edge-reference budget.`);
	}
	const scopedCount = fields.scopedEdges.edgeIndexes.length;
	yield* validateOffsetsSteps(
		fields.scopedEdges.directOwnerOffsets,
		scopedCount,
		fields.scopedEdges.directOwnerOrganizationIds.length,
		`${label} scoped-edge owner offsets`,
	);
	if (
		fields.scopedEdges.scopeKinds.length !== scopedCount ||
		fields.scopedEdges.participantIndexes.length !== scopedCount
	) {
		throw new Error(`${label} scoped-edge column lengths do not match.`);
	}
	const minimumEdgeReferences =
		fields.exclusiveCutEdgeScopedIndexes.length +
		fields.endpointSupportScopedIndexes.length * 2 +
		fields.incidenceDirections.length;
	if (minimumEdgeReferences > limits.maximumEdgeReferences) {
		throw new Error(`${label} exceeds its edge-reference budget.`);
	}
	if (fields.scopedEdges.directOwnerOrganizationIds.length > limits.maximumOwnerIds) {
		throw new Error(`${label} exceeds its direct-owner budget.`);
	}
	yield* validatePositiveInt32ValuesSteps(
		fields.participantOrganizationIds,
		`${label} participant organization ids`,
	);
	yield* validatePositiveInt32ValuesSteps(
		fields.managedChildOrganizationIds,
		`${label} managed-child organization ids`,
	);
	yield* validatePositiveInt32ValuesSteps(
		fields.scopedEdges.directOwnerOrganizationIds,
		`${label} scoped-edge direct-owner ids`,
	);
	yield* validateCanonicalEdgeTableSteps(fields.edgeCoordinates, label);

	if (presence) yield* validatePresenceSteps(presence, recordCount, label);
	const usedEdges = new Uint8Array(edgeCount);
	const counts: MutableRecordCollectionCounts = {
		groups: groupCount,
		legs: legCount,
		exclusiveCutEdges: fields.exclusiveCutEdgeScopedIndexes.length,
		endpointSupports: fields.endpointSupportScopedIndexes.length,
		seamContacts: fields.seamRoles.length,
		incidences: fields.incidenceDirections.length,
		witnesses: 0,
		scopedEdges: scopedCount,
		ownerIds: fields.scopedEdges.directOwnerOrganizationIds.length,
		edgeReferences: minimumEdgeReferences,
		canonicalBytes: 8,
	};
	let expectedScopedIndex = 0;
	const validateScoped = (scopedIndex: number, participantCount: number): number => {
		if (scopedIndex !== expectedScopedIndex || scopedIndex >= scopedCount) {
			throw new Error(`${label} scoped-edge occurrences are not in canonical traversal order.`);
		}
		expectedScopedIndex++;
		const edgeIndex = fields.scopedEdges.edgeIndexes[scopedIndex] as number;
		if (edgeIndex >= edgeCount) throw new Error(`${label} scoped edge references an absent edge.`);
		usedEdges[edgeIndex] = 1;
		const scopeKind = readTag(
			SCOPE_KINDS,
			fields.scopedEdges.scopeKinds[scopedIndex] as number,
			`${label} scope`,
		);
		const participantIndex = fields.scopedEdges.participantIndexes[scopedIndex] as number;
		const ownerStart = fields.scopedEdges.directOwnerOffsets[scopedIndex] as number;
		const ownerEnd = fields.scopedEdges.directOwnerOffsets[scopedIndex + 1] as number;
		const ownerCount = ownerEnd - ownerStart;
		if (scopeKind === "PARENT_DIRECT") {
			if (participantIndex !== -1 || ownerCount !== 0) {
				throw new Error(`${label} parent-direct scope carries participant or owner data.`);
			}
			return 20;
		}
		if (
			participantIndex < 0 ||
			participantIndex >= participantCount ||
			ownerCount < 1 ||
			ownerCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_DIRECT_OWNER_IDS_PER_SCOPE
		) {
			throw new Error(`${label} participant scope is outside its participant/owner bounds.`);
		}
		validateSortedUniquePositiveInt32Range(
			fields.scopedEdges.directOwnerOrganizationIds,
			ownerStart,
			ownerEnd,
			`${label} scoped-edge owners`,
		);
		return 28 + ownerCount * 4;
	};

	for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
		yield;
		const isPresent = !presence || (presence[recordIndex] as number) === 1;
		const participantStart = fields.participantOffsets[recordIndex] as number;
		const participantEnd = fields.participantOffsets[recordIndex + 1] as number;
		const managedStart = fields.managedChildOffsets[recordIndex] as number;
		const managedEnd = fields.managedChildOffsets[recordIndex + 1] as number;
		const groupStart = fields.connectionGroupOffsets[recordIndex] as number;
		const groupEnd = fields.connectionGroupOffsets[recordIndex + 1] as number;
		if (!isPresent) {
			if (
				(fields.hierarchyRoles[recordIndex] as number) !== 0 ||
				(fields.purposes[recordIndex] as number) !== 0 ||
				(fields.parentOrganizationIds[recordIndex] as number) !== 0 ||
				(fields.reviewPolicies[recordIndex] as number) !== 0 ||
				participantStart !== participantEnd ||
				managedStart !== managedEnd ||
				groupStart !== groupEnd
			) {
				throw new Error(`${label} absent record ${recordIndex} carries record data.`);
			}
			continue;
		}
		readTag(
			HIERARCHY_ROLES,
			fields.hierarchyRoles[recordIndex] as number,
			`${label} hierarchy role`,
		);
		readTag(PURPOSES, fields.purposes[recordIndex] as number, `${label} purpose`);
		readTag(
			REVIEW_POLICIES,
			fields.reviewPolicies[recordIndex] as number,
			`${label} review policy`,
		);
		validatePositiveInt32(
			fields.parentOrganizationIds[recordIndex] as number,
			`${label} parent organization id`,
		);
		const participantCount = participantEnd - participantStart;
		if (participantCount !== 1 && participantCount !== 2) {
			throw new Error(`${label} record ${recordIndex} must contain one or two participants.`);
		}
		const managedCount = managedEnd - managedStart;
		if (managedCount > participantCount) {
			throw new Error(`${label} record ${recordIndex} has too many managed children.`);
		}
		const recordGroupCount = groupEnd - groupStart;
		if (
			recordGroupCount < 1 ||
			recordGroupCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_RECORD
		) {
			throw new Error(`${label} record ${recordIndex} exceeds its group bounds.`);
		}
		let recordEdgeReferences = 0;
		let recordOwnerIds = 0;
		let recordBytes = 32 + participantCount * 4 + managedCount * 4;
		for (let groupIndex = groupStart; groupIndex < groupEnd; groupIndex++) {
			yield;
			const legStart = fields.groupLegOffsets[groupIndex] as number;
			const legEnd = fields.groupLegOffsets[groupIndex + 1] as number;
			const groupLegCount = legEnd - legStart;
			if (
				groupLegCount < 1 ||
				groupLegCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_GROUP
			) {
				throw new Error(`${label} group ${groupIndex} exceeds its leg bounds.`);
			}
			recordBytes += 8;
			for (let legIndex = legStart; legIndex < legEnd; legIndex++) {
				yield;
				readTag(
					DIRECTION_ROLES,
					fields.legDirectionRoles[legIndex] as number,
					`${label} leg direction`,
				);
				const exclusiveStart = fields.legExclusiveCutEdgeOffsets[legIndex] as number;
				const exclusiveEnd = fields.legExclusiveCutEdgeOffsets[legIndex + 1] as number;
				const endpointStart = fields.legEndpointSupportOffsets[legIndex] as number;
				const endpointEnd = fields.legEndpointSupportOffsets[legIndex + 1] as number;
				const seamStart = fields.legSeamContactOffsets[legIndex] as number;
				const seamEnd = fields.legSeamContactOffsets[legIndex + 1] as number;
				const exclusiveCount = exclusiveEnd - exclusiveStart;
				if (
					exclusiveCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD ||
					endpointEnd - endpointStart >
						STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD ||
					seamEnd - seamStart > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD
				) {
					throw new Error(`${label} leg ${legIndex} exceeds its binding bounds.`);
				}
				recordBytes += 20;
				for (let index = exclusiveStart; index < exclusiveEnd; index++) {
					yield;
					const scopedIndex = fields.exclusiveCutEdgeScopedIndexes[index] as number;
					const ownerBefore = ownerCountForScoped(fields.scopedEdges, scopedIndex);
					recordBytes += validateScoped(scopedIndex, participantCount);
					recordOwnerIds += ownerBefore;
					recordEdgeReferences++;
				}
				for (let index = endpointStart; index < endpointEnd; index++) {
					yield;
					const scopedIndex = fields.endpointSupportScopedIndexes[index] as number;
					const ownerBefore = ownerCountForScoped(fields.scopedEdges, scopedIndex);
					recordBytes += 8 + validateScoped(scopedIndex, participantCount);
					recordOwnerIds += ownerBefore;
					recordEdgeReferences += 2;
					const adjacent = fields.endpointAdjacentExclusiveCutEdgeIndexes[index] as number;
					if (adjacent >= exclusiveCount) {
						throw new Error(`${label} endpoint support references an absent leg cut edge.`);
					}
					readTag(
						ENDPOINT_POSITIONS,
						fields.endpointPositions[index] as number,
						`${label} endpoint position`,
					);
				}
				for (let seamIndex = seamStart; seamIndex < seamEnd; seamIndex++) {
					yield;
					const seamRole = readTag(
						SEAM_ROLES,
						fields.seamRoles[seamIndex] as number,
						`${label} seam role`,
					);
					const incidenceStart = fields.seamIncidenceOffsets[seamIndex] as number;
					const incidenceEnd = fields.seamIncidenceOffsets[seamIndex + 1] as number;
					const expectedIncidences = seamRole === "CONTACT" ? 2 : 3;
					if (incidenceEnd - incidenceStart !== expectedIncidences) {
						throw new Error(`${label} seam ${seamIndex} has an incomplete incidence set.`);
					}
					recordBytes += 8;
					for (let index = incidenceStart; index < incidenceEnd; index++) {
						yield;
						readTag(
							INCIDENCE_DIRECTIONS,
							fields.incidenceDirections[index] as number,
							`${label} incidence direction`,
						);
						const bindingKind = readTag(
							INCIDENCE_BINDING_KINDS,
							fields.incidenceBindingKinds[index] as number,
							`${label} incidence binding`,
						);
						recordEdgeReferences++;
						if (bindingKind === "EXCLUSIVE_CUT_EDGE") {
							if (
								(fields.incidenceExclusiveCutEdgeIndexes[index] as number) >= exclusiveCount ||
								(fields.incidenceWitnessScopedEdgeIndexes[index] as number) !== UINT32_ABSENT
							) {
								throw new Error(`${label} exclusive incidence binding is malformed.`);
							}
							recordBytes += 12;
						} else {
							if ((fields.incidenceExclusiveCutEdgeIndexes[index] as number) !== UINT32_ABSENT) {
								throw new Error(`${label} witness incidence carries an exclusive index.`);
							}
							const scopedIndex = fields.incidenceWitnessScopedEdgeIndexes[index] as number;
							const ownerBefore = ownerCountForScoped(fields.scopedEdges, scopedIndex);
							recordBytes += 8 + validateScoped(scopedIndex, participantCount);
							recordOwnerIds += ownerBefore;
							counts.witnesses++;
						}
					}
				}
			}
		}
		if (recordEdgeReferences > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD) {
			throw new Error(`${label} record ${recordIndex} exceeds its edge-reference budget.`);
		}
		if (recordOwnerIds > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_RECORD) {
			throw new Error(`${label} record ${recordIndex} exceeds its owner-id budget.`);
		}
		counts.canonicalBytes += recordBytes;
	}
	if (expectedScopedIndex !== scopedCount) {
		throw new Error(`${label} contains unused scoped-edge rows.`);
	}
	for (let index = 0; index < usedEdges.length; index++) {
		yield;
		if ((usedEdges[index] as number) !== 1)
			throw new Error(`${label} contains an unused edge row.`);
	}
	if (counts.canonicalBytes > limits.maximumCanonicalBytes) {
		throw new Error(`${label} exceeds its canonical byte budget.`);
	}
	return counts;
}

function validateRecordFieldTypes(
	fields: StaticFabAssemblyRelationshipRecordFieldsSoA,
	label: string,
): void {
	assertExactKeys(
		fields,
		[
			"hierarchyRoles",
			"purposes",
			"parentOrganizationIds",
			"reviewPolicies",
			"participantOffsets",
			"participantOrganizationIds",
			"managedChildOffsets",
			"managedChildOrganizationIds",
			"connectionGroupOffsets",
			"groupLegOffsets",
			"legDirectionRoles",
			"legExclusiveCutEdgeOffsets",
			"exclusiveCutEdgeScopedIndexes",
			"legEndpointSupportOffsets",
			"endpointSupportScopedIndexes",
			"endpointAdjacentExclusiveCutEdgeIndexes",
			"endpointPositions",
			"legSeamContactOffsets",
			"seamRoles",
			"seamIncidenceOffsets",
			"incidenceDirections",
			"incidenceBindingKinds",
			"incidenceExclusiveCutEdgeIndexes",
			"incidenceWitnessScopedEdgeIndexes",
			"edgeCoordinates",
			"scopedEdges",
		],
		`${label} record fields`,
	);
	assertTypedArray(fields.hierarchyRoles, Uint8Array, `${label} hierarchy roles`);
	assertTypedArray(fields.purposes, Uint8Array, `${label} purposes`);
	assertTypedArray(fields.parentOrganizationIds, Int32Array, `${label} parent organization ids`);
	assertTypedArray(fields.reviewPolicies, Uint8Array, `${label} review policies`);
	assertTypedArray(fields.participantOffsets, Uint32Array, `${label} participant offsets`);
	assertTypedArray(
		fields.participantOrganizationIds,
		Int32Array,
		`${label} participant organization ids`,
	);
	assertTypedArray(fields.managedChildOffsets, Uint32Array, `${label} managed-child offsets`);
	assertTypedArray(
		fields.managedChildOrganizationIds,
		Int32Array,
		`${label} managed-child organization ids`,
	);
	assertTypedArray(fields.connectionGroupOffsets, Uint32Array, `${label} group offsets`);
	assertTypedArray(fields.groupLegOffsets, Uint32Array, `${label} group-leg offsets`);
	assertTypedArray(fields.legDirectionRoles, Uint8Array, `${label} leg direction roles`);
	assertTypedArray(
		fields.legExclusiveCutEdgeOffsets,
		Uint32Array,
		`${label} exclusive-cut offsets`,
	);
	assertTypedArray(
		fields.exclusiveCutEdgeScopedIndexes,
		Uint32Array,
		`${label} exclusive-cut scoped indexes`,
	);
	assertTypedArray(
		fields.legEndpointSupportOffsets,
		Uint32Array,
		`${label} endpoint-support offsets`,
	);
	assertTypedArray(
		fields.endpointSupportScopedIndexes,
		Uint32Array,
		`${label} endpoint-support scoped indexes`,
	);
	assertTypedArray(
		fields.endpointAdjacentExclusiveCutEdgeIndexes,
		Uint32Array,
		`${label} endpoint adjacent indexes`,
	);
	assertTypedArray(fields.endpointPositions, Uint8Array, `${label} endpoint positions`);
	assertTypedArray(fields.legSeamContactOffsets, Uint32Array, `${label} seam offsets`);
	assertTypedArray(fields.seamRoles, Uint8Array, `${label} seam roles`);
	assertTypedArray(fields.seamIncidenceOffsets, Uint32Array, `${label} incidence offsets`);
	assertTypedArray(fields.incidenceDirections, Uint8Array, `${label} incidence directions`);
	assertTypedArray(fields.incidenceBindingKinds, Uint8Array, `${label} incidence binding kinds`);
	assertTypedArray(
		fields.incidenceExclusiveCutEdgeIndexes,
		Uint32Array,
		`${label} incidence exclusive indexes`,
	);
	assertTypedArray(
		fields.incidenceWitnessScopedEdgeIndexes,
		Uint32Array,
		`${label} incidence witness indexes`,
	);
	assertTypedArray(fields.edgeCoordinates, Int32Array, `${label} edge coordinates`);
	validateScopedFieldTypes(fields.scopedEdges, label);
}

function validateScopedFieldTypes(
	fields: StaticFabAssemblyRelationshipScopedEdgeFieldsSoA,
	label: string,
): void {
	assertExactKeys(
		fields,
		[
			"edgeIndexes",
			"scopeKinds",
			"participantIndexes",
			"directOwnerOffsets",
			"directOwnerOrganizationIds",
		],
		`${label} scoped-edge fields`,
	);
	assertTypedArray(fields.edgeIndexes, Uint32Array, `${label} scoped-edge indexes`);
	assertTypedArray(fields.scopeKinds, Uint8Array, `${label} scope kinds`);
	assertTypedArray(fields.participantIndexes, Int8Array, `${label} scope participant indexes`);
	assertTypedArray(fields.directOwnerOffsets, Uint32Array, `${label} scope owner offsets`);
	assertTypedArray(
		fields.directOwnerOrganizationIds,
		Int32Array,
		`${label} scope direct-owner organization ids`,
	);
}

function ownerCountForScoped(
	fields: StaticFabAssemblyRelationshipScopedEdgeFieldsSoA,
	index: number,
): number {
	if (index >= fields.edgeIndexes.length) return 0;
	return (
		(fields.directOwnerOffsets[index + 1] as number) - (fields.directOwnerOffsets[index] as number)
	);
}

function recordFieldTransfers(fields: StaticFabAssemblyRelationshipRecordFieldsSoA): ArrayBuffer[] {
	return [
		fields.hierarchyRoles.buffer,
		fields.purposes.buffer,
		fields.parentOrganizationIds.buffer,
		fields.reviewPolicies.buffer,
		fields.participantOffsets.buffer,
		fields.participantOrganizationIds.buffer,
		fields.managedChildOffsets.buffer,
		fields.managedChildOrganizationIds.buffer,
		fields.connectionGroupOffsets.buffer,
		fields.groupLegOffsets.buffer,
		fields.legDirectionRoles.buffer,
		fields.legExclusiveCutEdgeOffsets.buffer,
		fields.exclusiveCutEdgeScopedIndexes.buffer,
		fields.legEndpointSupportOffsets.buffer,
		fields.endpointSupportScopedIndexes.buffer,
		fields.endpointAdjacentExclusiveCutEdgeIndexes.buffer,
		fields.endpointPositions.buffer,
		fields.legSeamContactOffsets.buffer,
		fields.seamRoles.buffer,
		fields.seamIncidenceOffsets.buffer,
		fields.incidenceDirections.buffer,
		fields.incidenceBindingKinds.buffer,
		fields.incidenceExclusiveCutEdgeIndexes.buffer,
		fields.incidenceWitnessScopedEdgeIndexes.buffer,
		fields.edgeCoordinates.buffer,
		fields.scopedEdges.edgeIndexes.buffer,
		fields.scopedEdges.scopeKinds.buffer,
		fields.scopedEdges.participantIndexes.buffer,
		fields.scopedEdges.directOwnerOffsets.buffer,
		fields.scopedEdges.directOwnerOrganizationIds.buffer,
	] as ArrayBuffer[];
}

function assertUniqueTransferBuffers(buffers: readonly ArrayBuffer[], label: string): void {
	const unique = new Set<ArrayBuffer>();
	for (const buffer of buffers) {
		if (!(buffer instanceof ArrayBuffer)) {
			throw new Error(`${label} contains a non-transferable buffer.`);
		}
		if (unique.has(buffer)) throw new Error(`${label} aliases a transferable buffer.`);
		unique.add(buffer);
	}
}

function assertExactKeys(value: unknown, keys: readonly string[], label: string): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	const actual = Reflect.ownKeys(value);
	const prototype = Object.getPrototypeOf(value);
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		actual.length !== keys.length ||
		keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"))
	) {
		throw new Error(`${label} fields do not exactly match schema v1.`);
	}
}

function* validateOffsetsSteps(
	offsets: Uint32Array,
	rowCount: number,
	payloadLength: number,
	label: string,
): Generator<void, void> {
	if (payloadLength < 0 || offsets.length !== rowCount + 1 || (offsets[0] as number) !== 0) {
		throw new Error(`${label} shape is invalid.`);
	}
	let previous = 0;
	for (let index = 1; index < offsets.length; index++) {
		yield;
		const value = offsets[index] as number;
		if (value < previous || value > payloadLength) {
			throw new Error(`${label} are not canonical CSR offsets.`);
		}
		previous = value;
	}
	if (previous !== payloadLength) throw new Error(`${label} do not cover their payload.`);
}

function validatePresence(values: Uint8Array, count: number, label: string): void {
	completeCooperativeSteps(validatePresenceSteps(values, count, label));
}

function* validatePresenceSteps(
	values: Uint8Array,
	count: number,
	label: string,
): Generator<void, void> {
	if (values.length !== count) throw new Error(`${label} presence length does not match.`);
	for (let index = 0; index < values.length; index++) {
		yield;
		const value = values[index] as number;
		if (value !== 0 && value !== 1) throw new Error(`${label} presence ${index} is invalid.`);
	}
}

function* countPresentRowsSteps(
	values: Uint8Array,
	count: number,
	label: string,
): Generator<void, number> {
	yield* validatePresenceSteps(values, count, label);
	let present = 0;
	for (const value of values) {
		yield;
		present += value;
	}
	return present;
}

function validatePositiveInt32(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fff_ffff) {
		throw new Error(`${label} must be a positive signed int32.`);
	}
}

function validateCanonicalPositiveInt32Ids(values: Int32Array, label: string): void {
	completeCooperativeSteps(validateCanonicalPositiveInt32IdsSteps(values, label));
}

function* validateCanonicalPositiveInt32IdsSteps(
	values: Int32Array,
	label: string,
): Generator<void, void> {
	let previous = 0;
	for (let index = 0; index < values.length; index++) {
		yield;
		const value = values[index] as number;
		if (value <= previous)
			throw new Error(`${label} must be unique positive ids in ascending order.`);
		previous = value;
	}
}

function* validatePositiveInt32ValuesSteps(
	values: Int32Array,
	label: string,
): Generator<void, void> {
	for (let index = 0; index < values.length; index++) {
		yield;
		if ((values[index] as number) < 1) throw new Error(`${label} contains an invalid id.`);
	}
}

function validateSortedUniquePositiveInt32Range(
	values: Int32Array,
	start: number,
	end: number,
	label: string,
): void {
	let previous = 0;
	for (let index = start; index < end; index++) {
		const value = values[index] as number;
		if (value <= previous)
			throw new Error(`${label} are not unique positive ids in ascending order.`);
		previous = value;
	}
}

function* validateCanonicalEdgeTableSteps(
	coordinates: Int32Array,
	label: string,
): Generator<void, void> {
	let previous: DirectedRailEdge | null = null;
	for (let index = 0; index < coordinates.length / 4; index++) {
		yield;
		const edge = readEdge(coordinates, index);
		const distance = Math.abs(edge.to.x - edge.from.x) + Math.abs(edge.to.y - edge.from.y);
		if (distance !== 1)
			throw new Error(`${label} edge table row ${index} is not cardinal-adjacent.`);
		if (previous && compareEdges(previous, edge) >= 0) {
			throw new Error(`${label} edge table is not unique canonical order.`);
		}
		previous = edge;
	}
}

function writeEdge(target: Int32Array, index: number, edge: DirectedRailEdge): void {
	const offset = index * 4;
	target[offset] = edge.from.x;
	target[offset + 1] = edge.from.y;
	target[offset + 2] = edge.to.x;
	target[offset + 3] = edge.to.y;
}

function readEdge(source: Int32Array, index: number): DirectedRailEdge {
	const offset = index * 4;
	return {
		from: { x: source[offset] as number, y: source[offset + 1] as number },
		to: { x: source[offset + 2] as number, y: source[offset + 3] as number },
	};
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.x - right.from.x ||
		left.from.y - right.from.y ||
		left.to.x - right.to.x ||
		left.to.y - right.to.y
	);
}

function tagIndex<const Values extends readonly string[]>(
	values: Values,
	value: Values[number],
): number {
	const index = values.indexOf(value);
	if (index < 0) throw new Error(`Unknown relationship protocol tag ${value}.`);
	return index;
}

function readTag<const Values extends readonly string[]>(
	values: Values,
	code: number,
	label: string,
): Values[number] {
	const value = values[code];
	if (value === undefined) throw new Error(`${label} code ${code} is invalid.`);
	return value;
}
