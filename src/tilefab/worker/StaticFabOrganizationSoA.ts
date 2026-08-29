import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationMembership,
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	createCanonicalStaticFabOrganizationStateBuilder,
	renameStaticFabOrganizationRecord,
	replaceStaticFabOrganizationRecordMembership,
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationProperties,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	updateStaticFabOrganizationRecordMetadata,
} from "../core/StaticFabOrganization";
import type {
	StaticFabOrganizationDiagnosticRecord,
	StaticFabOrganizationDiagnosticState,
} from "../core/StaticFabOrganizationIssues";
import { staticFabOrganizationFingerprint } from "./StaticFabOrganizationFingerprint";
import { assertTransferableTypedArray as assertTypedArray } from "./TransferableTypedArray";

export const STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const STATIC_FAB_ORGANIZATION_PATCH_SCHEMA_VERSION = 3 as const;

export interface StaticFabOrganizationMembershipFieldsSoA {
	readonly railEdgeOffsets: Uint32Array;
	readonly railEdgeCoordinates: Int32Array;
	readonly advancedSwitchOffsets: Uint32Array;
	readonly advancedSwitchIds: Int32Array;
	readonly equipmentGroupOffsets: Uint32Array;
	readonly equipmentGroupIds: Int32Array;
}

export interface StaticFabOrganizationRecordFieldsSoA {
	readonly kinds: Uint8Array;
	readonly names: readonly string[];
	readonly parentOrganizationOffsets: Uint32Array;
	readonly parentOrganizationIds: Int32Array;
	readonly descriptions: readonly string[];
	readonly colors: Uint8Array;
	readonly railEdgeOffsets: Uint32Array;
	readonly railEdgeCoordinates: Int32Array;
	readonly advancedSwitchOffsets: Uint32Array;
	readonly advancedSwitchIds: Int32Array;
	readonly equipmentGroupOffsets: Uint32Array;
	readonly equipmentGroupIds: Int32Array;
}

export interface StaticFabOrganizationSnapshot {
	readonly schemaVersion: typeof STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION;
	readonly nextOrganizationId: number;
	readonly organizationIds: Int32Array;
	readonly records: StaticFabOrganizationRecordFieldsSoA;
}

export interface StaticFabOrganizationPatchSoA {
	readonly schemaVersion: typeof STATIC_FAB_ORGANIZATION_PATCH_SCHEMA_VERSION;
	readonly organizationIds: Int32Array;
	readonly operationCodes: Uint8Array;
	readonly beforeNames: readonly string[];
	readonly afterNames: readonly string[];
	readonly beforeMetadata: StaticFabOrganizationMetadataFieldsSoA;
	readonly afterMetadata: StaticFabOrganizationMetadataFieldsSoA;
	readonly removedMembership: StaticFabOrganizationMembershipFieldsSoA;
	readonly addedMembership: StaticFabOrganizationMembershipFieldsSoA;
	readonly beforeRecordHashes: Uint32Array;
	readonly afterRecordHashes: Uint32Array;
	readonly nextOrganizationIdBefore: number;
	readonly nextOrganizationIdAfter: number;
	readonly beforePresent: Uint8Array;
	readonly before: StaticFabOrganizationRecordFieldsSoA;
	readonly afterPresent: Uint8Array;
	readonly after: StaticFabOrganizationRecordFieldsSoA;
}

export interface StaticFabOrganizationMetadataFieldsSoA {
	readonly parentOrganizationOffsets: Uint32Array;
	readonly parentOrganizationIds: Int32Array;
	readonly descriptions: readonly string[];
	readonly colors: Uint8Array;
}

export interface EncodedStaticFabOrganizationPatch {
	readonly fields: StaticFabOrganizationPatchSoA;
	readonly transfer: ArrayBuffer[];
}

export const STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS = {
	FULL: 0,
	RENAME: 1,
	REMOVE: 2,
	METADATA: 3,
	MEMBERSHIP_DELTA: 4,
} as const;

export interface StaticFabOrganizationPatchEncodingOptions {
	readonly compactExisting?: boolean;
}

export interface StaticFabOrganizationSnapshotHydrator {
	readonly done: boolean;
	step(operationBudget?: number): number;
	finish(): StaticFabOrganizationState;
}

export function createStaticFabOrganizationSnapshot(
	state: StaticFabOrganizationState,
): StaticFabOrganizationSnapshot {
	const canonical = copyStaticFabOrganizationState(state);
	const organizationIds = new Int32Array(canonical.records.length);
	for (let index = 0; index < canonical.records.length; index++) {
		organizationIds[index] = (canonical.records[index] as StaticFabOrganizationRecord).id;
	}
	return Object.freeze({
		schemaVersion: STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION,
		nextOrganizationId: canonical.nextOrganizationId,
		organizationIds,
		records: createRecordFields(canonical.records),
	});
}

export function hydrateStaticFabOrganizationSnapshot(
	snapshot: StaticFabOrganizationSnapshot,
): StaticFabOrganizationState {
	const hydrator = createStaticFabOrganizationSnapshotHydrator(snapshot);
	while (!hydrator.done) hydrator.step();
	return hydrator.finish();
}

/**
 * Decode raw organization rows for read-only CHECKS collection.
 *
 * Transfer structure stays strict, but authored semantics remain untouched so the collector can
 * report duplicate IDs/names, malformed metadata, noncanonical membership, and relationship faults.
 */
export function hydrateStaticFabOrganizationDiagnosticSnapshot(
	snapshot: StaticFabOrganizationSnapshot,
): StaticFabOrganizationDiagnosticState {
	validateStaticFabOrganizationDiagnosticSnapshotStructure(snapshot);
	const fields = snapshot.records;
	const records = new Array<StaticFabOrganizationDiagnosticRecord>(snapshot.organizationIds.length);
	for (let index = 0; index < records.length; index += 1) {
		const railStart = fields.railEdgeOffsets[index] as number;
		const railEnd = fields.railEdgeOffsets[index + 1] as number;
		const railEdges = new Array<DirectedRailEdge>(railEnd - railStart);
		for (let edgeIndex = railStart; edgeIndex < railEnd; edgeIndex += 1) {
			const coordinateOffset = edgeIndex * 4;
			railEdges[edgeIndex - railStart] = Object.freeze({
				from: Object.freeze({
					x: fields.railEdgeCoordinates[coordinateOffset] as number,
					y: fields.railEdgeCoordinates[coordinateOffset + 1] as number,
				}),
				to: Object.freeze({
					x: fields.railEdgeCoordinates[coordinateOffset + 2] as number,
					y: fields.railEdgeCoordinates[coordinateOffset + 3] as number,
				}),
			});
		}
		const kindCode = fields.kinds[index] as number;
		const colorCode = fields.colors[index] as number;
		const kind = STATIC_FAB_ORGANIZATION_KINDS[kindCode] ?? `INVALID_KIND_${kindCode}`;
		const color = STATIC_FAB_ORGANIZATION_COLORS[colorCode] ?? `INVALID_COLOR_${colorCode}`;
		records[index] = Object.freeze({
			id: snapshot.organizationIds[index] as number,
			kind,
			name: fields.names[index] as string,
			parentOrganizationIds: Object.freeze(
				Array.from(
					fields.parentOrganizationIds.slice(
						fields.parentOrganizationOffsets[index] as number,
						fields.parentOrganizationOffsets[index + 1] as number,
					),
				),
			),
			properties: Object.freeze({
				description: fields.descriptions[index] as string,
				color,
			}),
			membership: Object.freeze({
				railEdges: Object.freeze(railEdges),
				advancedSwitchIds: Object.freeze(
					Array.from(
						fields.advancedSwitchIds.slice(
							fields.advancedSwitchOffsets[index] as number,
							fields.advancedSwitchOffsets[index + 1] as number,
						),
					),
				),
				equipmentGroupIds: Object.freeze(
					Array.from(
						fields.equipmentGroupIds.slice(
							fields.equipmentGroupOffsets[index] as number,
							fields.equipmentGroupOffsets[index + 1] as number,
						),
					),
				),
			}),
		});
	}
	return Object.freeze({
		nextOrganizationId: snapshot.nextOrganizationId,
		records: Object.freeze(records),
	});
}

/** Decode and validate transferable organization CSR without one unbounded membership pass. */
export function createStaticFabOrganizationSnapshotHydrator(
	snapshot: StaticFabOrganizationSnapshot,
): StaticFabOrganizationSnapshotHydrator {
	validateStaticFabOrganizationSnapshotStructure(snapshot);
	const fields = snapshot.records;
	const nextOrganizationId = snapshot.nextOrganizationId;
	const organizationIds = snapshot.organizationIds.slice();
	const kinds = fields.kinds.slice();
	const names = [...fields.names];
	const parentOrganizationOffsets = fields.parentOrganizationOffsets.slice();
	const railEdgeOffsets = fields.railEdgeOffsets.slice();
	const advancedSwitchOffsets = fields.advancedSwitchOffsets.slice();
	const equipmentGroupOffsets = fields.equipmentGroupOffsets.slice();
	const recordCount = organizationIds.length;
	const builder = createCanonicalStaticFabOrganizationStateBuilder(nextOrganizationId);
	let recordIndex = 0;
	let phase: "parent" | "rail" | "switch" | "equipment" | "record" = "parent";
	let parentOffset = parentOrganizationOffsets[0] as number;
	let railOffset = railEdgeOffsets[0] as number;
	let switchOffset = advancedSwitchOffsets[0] as number;
	let equipmentOffset = equipmentGroupOffsets[0] as number;
	let previousParentId = 0;
	let previousRailCoordinateOffset = -1;
	let previousSwitchId = 0;
	let previousEquipmentId = 0;
	let done = recordCount === 0;
	let result: StaticFabOrganizationState | null = null;

	const finishRecord = (): void => {
		const id = organizationIds[recordIndex] as number;
		const kindCode = kinds[recordIndex] as number;
		const kind = STATIC_FAB_ORGANIZATION_KINDS[kindCode];
		if (!kind) throw new Error(`Unknown static FAB organization kind code ${kindCode}.`);
		const name = names[recordIndex] as string;
		validateHydratedOrganizationName(name, recordIndex);
		const description = fields.descriptions[recordIndex] as string;
		validateHydratedOrganizationDescription(description, recordIndex);
		const color = staticFabOrganizationColorFromCode(fields.colors[recordIndex] as number);
		builder.finishRecord({
			id,
			kind,
			name,
			description,
			color,
		});
		recordIndex++;
		if (recordIndex === recordCount) {
			done = true;
			return;
		}
		phase = "parent";
		parentOffset = parentOrganizationOffsets[recordIndex] as number;
		railOffset = railEdgeOffsets[recordIndex] as number;
		switchOffset = advancedSwitchOffsets[recordIndex] as number;
		equipmentOffset = equipmentGroupOffsets[recordIndex] as number;
		previousParentId = 0;
		previousRailCoordinateOffset = -1;
		previousSwitchId = 0;
		previousEquipmentId = 0;
	};

	return {
		get done(): boolean {
			return done;
		},
		step(operationBudget = 1_024): number {
			if (done) return 0;
			if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
				throw new Error("Organization hydration operation budget must be a positive safe integer.");
			}
			let operations = 0;
			while (!done && operations < operationBudget) {
				if (phase === "parent") {
					const end = parentOrganizationOffsets[recordIndex + 1] as number;
					if (parentOffset < end) {
						const id = fields.parentOrganizationIds[parentOffset] as number;
						validateCanonicalPositiveInt32Id(
							id,
							previousParentId,
							`organization snapshot parent row ${recordIndex}`,
						);
						builder.addParentOrganizationId(id);
						previousParentId = id;
						parentOffset++;
						operations++;
						continue;
					}
					phase = "rail";
					continue;
				}
				if (phase === "rail") {
					const end = railEdgeOffsets[recordIndex + 1] as number;
					if (railOffset < end) {
						const coordinateOffset = railOffset * 4;
						builder.addRailEdge(
							readCanonicalRailEdge(
								fields.railEdgeCoordinates,
								coordinateOffset,
								previousRailCoordinateOffset,
								recordIndex,
								"organization snapshot",
							),
						);
						previousRailCoordinateOffset = coordinateOffset;
						railOffset++;
						operations++;
						continue;
					}
					phase = "switch";
					continue;
				}
				if (phase === "switch") {
					const end = advancedSwitchOffsets[recordIndex + 1] as number;
					if (switchOffset < end) {
						const id = fields.advancedSwitchIds[switchOffset] as number;
						validateCanonicalPositiveInt32Id(
							id,
							previousSwitchId,
							`organization snapshot advanced switch row ${recordIndex}`,
						);
						builder.addAdvancedSwitchId(id);
						previousSwitchId = id;
						switchOffset++;
						operations++;
						continue;
					}
					phase = "equipment";
					continue;
				}
				if (phase === "equipment") {
					const end = equipmentGroupOffsets[recordIndex + 1] as number;
					if (equipmentOffset < end) {
						const id = fields.equipmentGroupIds[equipmentOffset] as number;
						validateCanonicalPositiveInt32Id(
							id,
							previousEquipmentId,
							`organization snapshot equipment group row ${recordIndex}`,
						);
						builder.addEquipmentGroupId(id);
						previousEquipmentId = id;
						equipmentOffset++;
						operations++;
						continue;
					}
					phase = "record";
					continue;
				}
				finishRecord();
				operations++;
			}
			return operations;
		},
		finish(): StaticFabOrganizationState {
			if (!done) throw new Error("Organization snapshot hydration is not complete.");
			if (!result) result = builder.finish();
			return result;
		},
	};
}

export function staticFabOrganizationSnapshotTransfers(
	snapshot: StaticFabOrganizationSnapshot,
): ArrayBuffer[] {
	return [
		snapshot.organizationIds.buffer,
		...recordFieldTransfers(snapshot.records),
	] as ArrayBuffer[];
}

export function encodeStaticFabOrganizationPatch(
	mutations: readonly StaticFabOrganizationMutation[],
	nextOrganizationIdBefore: number,
	nextOrganizationIdAfter: number,
	options: StaticFabOrganizationPatchEncodingOptions = {},
): EncodedStaticFabOrganizationPatch {
	const organizationIds = new Int32Array(mutations.length);
	const operationCodes = new Uint8Array(mutations.length);
	const beforeNames = new Array<string>(mutations.length).fill("");
	const afterNames = new Array<string>(mutations.length).fill("");
	const beforeMetadataRecords = new Array<StaticFabOrganizationRecord | null>(
		mutations.length,
	).fill(null);
	const afterMetadataRecords = new Array<StaticFabOrganizationRecord | null>(mutations.length).fill(
		null,
	);
	const removedMemberships = new Array<StaticFabOrganizationRecord["membership"] | null>(
		mutations.length,
	).fill(null);
	const addedMemberships = new Array<StaticFabOrganizationRecord["membership"] | null>(
		mutations.length,
	).fill(null);
	const beforeRecordHashes = new Uint32Array(mutations.length * 2);
	const afterRecordHashes = new Uint32Array(mutations.length * 2);
	const beforePresent = new Uint8Array(mutations.length);
	const afterPresent = new Uint8Array(mutations.length);
	const beforeRecords = mutations.map((mutation, index) => {
		organizationIds[index] = mutation.id;
		if (
			options.compactExisting &&
			mutation.before &&
			mutation.after &&
			staticFabOrganizationIdentityAndMetadataEquals(mutation.before, mutation.after)
		) {
			const delta = staticFabOrganizationMembershipDelta(
				mutation.before.membership,
				mutation.after.membership,
			);
			if (
				delta !== null &&
				staticFabOrganizationMembershipSize(delta.removed) +
					staticFabOrganizationMembershipSize(delta.added) <
					staticFabOrganizationMembershipSize(mutation.before.membership) +
						staticFabOrganizationMembershipSize(mutation.after.membership)
			) {
				operationCodes[index] = STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA;
				beforeNames[index] = mutation.before.name;
				afterNames[index] = mutation.after.name;
				removedMemberships[index] = delta.removed;
				addedMemberships[index] = delta.added;
				writeOrganizationFingerprint(beforeRecordHashes, index, mutation.before);
				writeOrganizationFingerprint(afterRecordHashes, index, mutation.after);
				return null;
			}
		}
		if (
			options.compactExisting &&
			mutation.before &&
			mutation.after &&
			mutation.before.kind === mutation.after.kind &&
			mutation.before.membership === mutation.after.membership
		) {
			const metadataOnly = staticFabOrganizationCompactMetadataEquals(
				mutation.before,
				mutation.after,
			);
			operationCodes[index] = metadataOnly
				? STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME
				: STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA;
			beforeNames[index] = mutation.before.name;
			afterNames[index] = mutation.after.name;
			if (!metadataOnly) {
				beforeMetadataRecords[index] = mutation.before;
				afterMetadataRecords[index] = mutation.after;
			}
			writeOrganizationFingerprint(beforeRecordHashes, index, mutation.before);
			writeOrganizationFingerprint(afterRecordHashes, index, mutation.after);
			return null;
		}
		if (options.compactExisting && mutation.before && !mutation.after) {
			operationCodes[index] = STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE;
			beforeNames[index] = mutation.before.name;
			writeOrganizationFingerprint(beforeRecordHashes, index, mutation.before);
			return null;
		}
		if (mutation.before) beforePresent[index] = 1;
		return mutation.before;
	});
	const afterRecords = mutations.map((mutation, index) => {
		if ((operationCodes[index] as number) !== STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.FULL) {
			return null;
		}
		if (mutation.after) afterPresent[index] = 1;
		return mutation.after;
	});
	const fields = Object.freeze({
		schemaVersion: STATIC_FAB_ORGANIZATION_PATCH_SCHEMA_VERSION,
		organizationIds,
		operationCodes,
		beforeNames: Object.freeze(beforeNames),
		afterNames: Object.freeze(afterNames),
		beforeMetadata: createMetadataFields(beforeMetadataRecords),
		afterMetadata: createMetadataFields(afterMetadataRecords),
		removedMembership: createMembershipFields(removedMemberships),
		addedMembership: createMembershipFields(addedMemberships),
		beforeRecordHashes,
		afterRecordHashes,
		nextOrganizationIdBefore,
		nextOrganizationIdAfter,
		beforePresent,
		before: createRecordFields(beforeRecords),
		afterPresent,
		after: createRecordFields(afterRecords),
	}) satisfies StaticFabOrganizationPatchSoA;
	return Object.freeze({ fields, transfer: staticFabOrganizationPatchTransfers(fields) });
}

export function decodeStaticFabOrganizationPatch(
	fields: StaticFabOrganizationPatchSoA,
	currentState?: StaticFabOrganizationState,
): readonly StaticFabOrganizationMutation[] {
	validateStaticFabOrganizationPatchShape(fields);
	const mutations = new Array<StaticFabOrganizationMutation>(fields.organizationIds.length);
	const currentById = currentState
		? new Map(currentState.records.map((record) => [record.id, record]))
		: null;
	for (let index = 0; index < mutations.length; index++) {
		const id = fields.organizationIds[index] as number;
		const operation = fields.operationCodes[index] as number;
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME) {
			const current = currentById?.get(id);
			if (!current) throw new Error(`Compact organization rename ${id} has no active record.`);
			assertOrganizationFingerprint(fields.beforeRecordHashes, index, current, "before rename");
			if (current.name !== fields.beforeNames[index]) {
				throw new Error(
					`Compact organization rename ${id} before name does not match the active record.`,
				);
			}
			const after = renameStaticFabOrganizationRecord(current, fields.afterNames[index] as string);
			assertOrganizationFingerprint(fields.afterRecordHashes, index, after, "after rename");
			mutations[index] = Object.freeze({ id, before: current, after });
			continue;
		}
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE) {
			const current = currentById?.get(id);
			if (!current) throw new Error(`Compact organization removal ${id} has no active record.`);
			assertOrganizationFingerprint(fields.beforeRecordHashes, index, current, "before removal");
			if (current.name !== fields.beforeNames[index]) {
				throw new Error(
					`Compact organization removal ${id} before name does not match the active record.`,
				);
			}
			mutations[index] = Object.freeze({ id, before: current, after: null });
			continue;
		}
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA) {
			const current = currentById?.get(id);
			if (!current) throw new Error(`Compact organization metadata ${id} has no active record.`);
			assertOrganizationFingerprint(fields.beforeRecordHashes, index, current, "before metadata");
			const beforeMetadata = readMetadata(fields.beforeMetadata, index);
			if (
				current.name !== fields.beforeNames[index] ||
				!staticFabOrganizationMetadataMatches(current, beforeMetadata)
			) {
				throw new Error(
					`Compact organization metadata ${id} before value does not match the active record.`,
				);
			}
			const afterMetadata = readMetadata(fields.afterMetadata, index);
			const after = updateStaticFabOrganizationRecordMetadata(current, {
				name: fields.afterNames[index] as string,
				parentOrganizationIds: afterMetadata.parentOrganizationIds,
				properties: afterMetadata.properties,
			});
			assertOrganizationFingerprint(fields.afterRecordHashes, index, after, "after metadata");
			mutations[index] = Object.freeze({ id, before: current, after });
			continue;
		}
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA) {
			const current = currentById?.get(id);
			if (!current) {
				throw new Error(`Compact organization membership delta ${id} has no active record.`);
			}
			assertOrganizationFingerprint(
				fields.beforeRecordHashes,
				index,
				current,
				"before membership delta",
			);
			if (
				current.name !== fields.beforeNames[index] ||
				fields.afterNames[index] !== fields.beforeNames[index]
			) {
				throw new Error(
					`Compact organization membership delta ${id} identity does not match the active record.`,
				);
			}
			const removed = readMembership(fields.removedMembership, index);
			const added = readMembership(fields.addedMembership, index);
			const membership = applyStaticFabOrganizationMembershipDelta(
				current.membership,
				removed,
				added,
				id,
			);
			const after = replaceStaticFabOrganizationRecordMembership(current, membership);
			assertOrganizationFingerprint(
				fields.afterRecordHashes,
				index,
				after,
				"after membership delta",
			);
			mutations[index] = Object.freeze({ id, before: current, after });
			continue;
		}
		const beforePresent = readPresence(
			fields.beforePresent[index] as number,
			`organization ${id} before`,
		);
		const afterPresent = readPresence(
			fields.afterPresent[index] as number,
			`organization ${id} after`,
		);
		if (!beforePresent && !afterPresent)
			throw new Error(`Organization patch row ${index} is empty.`);
		if (!beforePresent) assertEmptyRecordRow(fields.before, index, `organization ${id} before`);
		if (!afterPresent) assertEmptyRecordRow(fields.after, index, `organization ${id} after`);
		mutations[index] = Object.freeze({
			id,
			before: beforePresent ? readRecord(id, fields.before, index) : null,
			after: afterPresent ? readRecord(id, fields.after, index) : null,
		});
	}
	return Object.freeze(mutations);
}

export function staticFabOrganizationPatchTransfers(
	fields: StaticFabOrganizationPatchSoA,
): ArrayBuffer[] {
	return [
		fields.organizationIds.buffer,
		fields.operationCodes.buffer,
		...metadataFieldTransfers(fields.beforeMetadata),
		...metadataFieldTransfers(fields.afterMetadata),
		...membershipFieldTransfers(fields.removedMembership),
		...membershipFieldTransfers(fields.addedMembership),
		fields.beforeRecordHashes.buffer,
		fields.afterRecordHashes.buffer,
		fields.beforePresent.buffer,
		...recordFieldTransfers(fields.before),
		fields.afterPresent.buffer,
		...recordFieldTransfers(fields.after),
	] as ArrayBuffer[];
}

export function validateStaticFabOrganizationSnapshotShape(
	snapshot: StaticFabOrganizationSnapshot,
): void {
	const hydrator = createStaticFabOrganizationSnapshotHydrator(snapshot);
	while (!hydrator.done) hydrator.step();
	hydrator.finish();
}

export function validateStaticFabOrganizationSnapshotStructure(
	snapshot: StaticFabOrganizationSnapshot,
): void {
	if (snapshot === null || typeof snapshot !== "object") {
		throw new Error("Static FAB organization snapshot must be an object.");
	}
	if (snapshot.schemaVersion !== STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported static FAB organization snapshot schema ${snapshot.schemaVersion}.`,
		);
	}
	assertTypedArray(snapshot.organizationIds, Int32Array, "organization snapshot ids");
	validateCanonicalPositiveInt32Ids(snapshot.organizationIds, "organization snapshot ids");
	validatePositiveInt32(snapshot.nextOrganizationId, "organization snapshot cursor");
	const maximumOrganizationId = snapshot.organizationIds.at(-1) ?? 0;
	if (snapshot.nextOrganizationId <= maximumOrganizationId) {
		throw new Error(
			`Organization snapshot cursor ${snapshot.nextOrganizationId} must be greater than maximum organization id ${maximumOrganizationId}.`,
		);
	}
	validateRecordFieldStructure(
		snapshot.records,
		snapshot.organizationIds.length,
		"organization snapshot",
	);
}

function validateStaticFabOrganizationDiagnosticSnapshotStructure(
	snapshot: StaticFabOrganizationSnapshot,
): void {
	if (snapshot === null || typeof snapshot !== "object") {
		throw new Error("Static FAB organization diagnostic snapshot must be an object.");
	}
	if (snapshot.schemaVersion !== STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported static FAB organization diagnostic snapshot schema ${snapshot.schemaVersion}.`,
		);
	}
	assertTypedArray(snapshot.organizationIds, Int32Array, "organization diagnostic snapshot ids");
	if (
		!Number.isSafeInteger(snapshot.nextOrganizationId) ||
		snapshot.nextOrganizationId < -0x8000_0000 ||
		snapshot.nextOrganizationId > 0x7fff_ffff
	) {
		throw new Error("Organization diagnostic snapshot cursor must fit signed int32.");
	}
	validateRecordFieldStructure(
		snapshot.records,
		snapshot.organizationIds.length,
		"organization diagnostic snapshot",
		false,
	);
	for (let index = 0; index < snapshot.records.names.length; index += 1) {
		if (
			(snapshot.records.names[index] as string).length > 4_096 ||
			(snapshot.records.descriptions[index] as string).length > 4_096
		) {
			throw new Error(
				`Organization diagnostic snapshot text row ${index} exceeds protocol limits.`,
			);
		}
	}
}

export function validateStaticFabOrganizationPatchShape(
	fields: StaticFabOrganizationPatchSoA,
): void {
	if (fields === null || typeof fields !== "object") {
		throw new Error("Static FAB organization patch must be an object.");
	}
	if (fields.schemaVersion !== STATIC_FAB_ORGANIZATION_PATCH_SCHEMA_VERSION) {
		throw new Error(`Unsupported static FAB organization patch schema ${fields.schemaVersion}.`);
	}
	assertTypedArray(fields.organizationIds, Int32Array, "organization patch ids");
	assertTypedArray(fields.operationCodes, Uint8Array, "organization patch operation codes");
	assertTypedArray(fields.beforeRecordHashes, Uint32Array, "organization patch before hashes");
	assertTypedArray(fields.afterRecordHashes, Uint32Array, "organization patch after hashes");
	assertTypedArray(fields.beforePresent, Uint8Array, "organization patch before presence");
	assertTypedArray(fields.afterPresent, Uint8Array, "organization patch after presence");
	if (!Array.isArray(fields.beforeNames) || !Array.isArray(fields.afterNames)) {
		throw new Error("Organization patch compact names must be Arrays.");
	}
	validateCanonicalPositiveInt32Ids(fields.organizationIds, "organization patch ids");
	validatePositiveInt32(fields.nextOrganizationIdBefore, "organization patch before cursor");
	validatePositiveInt32(fields.nextOrganizationIdAfter, "organization patch after cursor");
	const count = fields.organizationIds.length;
	if (
		fields.operationCodes.length !== count ||
		fields.beforeNames.length !== count ||
		fields.afterNames.length !== count ||
		fields.beforeRecordHashes.length !== count * 2 ||
		fields.afterRecordHashes.length !== count * 2 ||
		fields.beforePresent.length !== count ||
		fields.afterPresent.length !== count
	) {
		throw new Error("Static FAB organization patch presence lengths do not match.");
	}
	for (let index = 0; index < count; index++) {
		if (
			typeof fields.beforeNames[index] !== "string" ||
			typeof fields.afterNames[index] !== "string"
		) {
			throw new Error(`Organization patch compact name ${index} must be a string.`);
		}
	}
	validatePresenceValues(fields.beforePresent, "organization patch before presence");
	validatePresenceValues(fields.afterPresent, "organization patch after presence");
	validateCursorAgainstPresentRows(
		fields.nextOrganizationIdBefore,
		fields.organizationIds,
		fields.beforePresent,
		"organization patch before cursor",
	);
	validateCursorAgainstPresentRows(
		fields.nextOrganizationIdAfter,
		fields.organizationIds,
		fields.afterPresent,
		"organization patch after cursor",
	);
	validateRecordFields(fields.before, count, "organization patch before");
	validateRecordFields(fields.after, count, "organization patch after");
	validateMetadataFields(fields.beforeMetadata, count, "organization patch metadata before");
	validateMetadataFields(fields.afterMetadata, count, "organization patch metadata after");
	validateMembershipFields(
		fields.removedMembership,
		count,
		"organization patch removed membership",
	);
	validateMembershipFields(fields.addedMembership, count, "organization patch added membership");
	for (let index = 0; index < count; index++) {
		const id = fields.organizationIds[index] as number;
		const operation = fields.operationCodes[index] as number;
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.FULL) {
			if ((fields.beforeNames[index] ?? "") !== "" || (fields.afterNames[index] ?? "") !== "") {
				throw new Error(`Full organization patch row ${index} carries compact names.`);
			}
			assertEmptyMetadataRow(fields.beforeMetadata, index, `full organization ${id} before`);
			assertEmptyMetadataRow(fields.afterMetadata, index, `full organization ${id} after`);
			assertEmptyMembershipRow(
				fields.removedMembership,
				index,
				`full organization ${id} removed membership`,
			);
			assertEmptyMembershipRow(
				fields.addedMembership,
				index,
				`full organization ${id} added membership`,
			);
			assertEmptyFingerprintRow(fields.beforeRecordHashes, index, `full organization ${id} before`);
			assertEmptyFingerprintRow(fields.afterRecordHashes, index, `full organization ${id} after`);
			continue;
		}
		if (
			operation !== STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME &&
			operation !== STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE &&
			operation !== STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA &&
			operation !== STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA
		) {
			throw new Error(`Organization patch row ${index} has unknown operation ${operation}.`);
		}
		if (
			(fields.beforePresent[index] as number) !== 0 ||
			(fields.afterPresent[index] as number) !== 0
		) {
			throw new Error(`Compact organization patch row ${index} cannot carry full records.`);
		}
		assertEmptyRecordRow(fields.before, index, `compact organization ${id} before`);
		assertEmptyRecordRow(fields.after, index, `compact organization ${id} after`);
		validateHydratedOrganizationName(fields.beforeNames[index] as string, index);
		if (
			operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME ||
			operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA ||
			operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA
		) {
			validateHydratedOrganizationName(fields.afterNames[index] as string, index);
		} else if ((fields.afterNames[index] ?? "") !== "") {
			throw new Error(`Compact organization removal ${id} carries an after name.`);
		}
		if (operation !== STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA) {
			assertEmptyMetadataRow(
				fields.beforeMetadata,
				index,
				`compact organization ${id} metadata before`,
			);
			assertEmptyMetadataRow(
				fields.afterMetadata,
				index,
				`compact organization ${id} metadata after`,
			);
		}
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA) {
			if (fields.beforeNames[index] !== fields.afterNames[index]) {
				throw new Error(`Compact organization membership delta ${id} cannot rename its record.`);
			}
			const removedSize = membershipRowSize(fields.removedMembership, index);
			const addedSize = membershipRowSize(fields.addedMembership, index);
			if (removedSize + addedSize === 0) {
				throw new Error(`Compact organization membership delta ${id} is empty.`);
			}
		} else {
			assertEmptyMembershipRow(
				fields.removedMembership,
				index,
				`compact organization ${id} removed membership`,
			);
			assertEmptyMembershipRow(
				fields.addedMembership,
				index,
				`compact organization ${id} added membership`,
			);
		}
		if (operation === STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE) {
			assertEmptyFingerprintRow(
				fields.afterRecordHashes,
				index,
				`removed organization ${id} after`,
			);
		}
		if (fields.nextOrganizationIdBefore <= id || fields.nextOrganizationIdAfter <= id) {
			throw new Error(`Compact organization patch ${id} is outside its ID cursor.`);
		}
	}
}

function createRecordFields(
	records: readonly (StaticFabOrganizationRecord | null)[],
): StaticFabOrganizationRecordFieldsSoA {
	const parentCount = records.reduce(
		(count, record) => count + (record ? staticFabOrganizationParentIds(record).length : 0),
		0,
	);
	const edgeCount = records.reduce(
		(count, record) => count + (record?.membership.railEdges.length ?? 0),
		0,
	);
	const switchCount = records.reduce(
		(count, record) => count + (record?.membership.advancedSwitchIds.length ?? 0),
		0,
	);
	const groupCount = records.reduce(
		(count, record) => count + (record?.membership.equipmentGroupIds.length ?? 0),
		0,
	);
	const fields: StaticFabOrganizationRecordFieldsSoA = {
		kinds: new Uint8Array(records.length),
		names: new Array<string>(records.length).fill(""),
		parentOrganizationOffsets: new Uint32Array(records.length + 1),
		parentOrganizationIds: new Int32Array(parentCount),
		descriptions: new Array<string>(records.length).fill(""),
		colors: new Uint8Array(records.length),
		railEdgeOffsets: new Uint32Array(records.length + 1),
		railEdgeCoordinates: new Int32Array(edgeCount * 4),
		advancedSwitchOffsets: new Uint32Array(records.length + 1),
		advancedSwitchIds: new Int32Array(switchCount),
		equipmentGroupOffsets: new Uint32Array(records.length + 1),
		equipmentGroupIds: new Int32Array(groupCount),
	};
	let parentOffset = 0;
	let edgeOffset = 0;
	let switchOffset = 0;
	let groupOffset = 0;
	for (let index = 0; index < records.length; index++) {
		fields.parentOrganizationOffsets[index] = parentOffset;
		fields.railEdgeOffsets[index] = edgeOffset;
		fields.advancedSwitchOffsets[index] = switchOffset;
		fields.equipmentGroupOffsets[index] = groupOffset;
		const source = records[index];
		if (!source) continue;
		const record = copyStaticFabOrganizationRecord(source);
		fields.kinds[index] = STATIC_FAB_ORGANIZATION_KINDS.indexOf(record.kind);
		(fields.names as string[])[index] = record.name;
		const properties = staticFabOrganizationProperties(record);
		(fields.descriptions as string[])[index] = properties.description;
		fields.colors[index] = staticFabOrganizationColorCode(properties.color);
		for (const parentId of staticFabOrganizationParentIds(record)) {
			fields.parentOrganizationIds[parentOffset++] = parentId;
		}
		for (const edge of record.membership.railEdges) {
			const coordinateOffset = edgeOffset * 4;
			fields.railEdgeCoordinates[coordinateOffset] = edge.from.x;
			fields.railEdgeCoordinates[coordinateOffset + 1] = edge.from.y;
			fields.railEdgeCoordinates[coordinateOffset + 2] = edge.to.x;
			fields.railEdgeCoordinates[coordinateOffset + 3] = edge.to.y;
			edgeOffset++;
		}
		for (const switchId of record.membership.advancedSwitchIds) {
			fields.advancedSwitchIds[switchOffset++] = switchId;
		}
		for (const groupId of record.membership.equipmentGroupIds) {
			fields.equipmentGroupIds[groupOffset++] = groupId;
		}
	}
	fields.parentOrganizationOffsets[records.length] = parentOffset;
	fields.railEdgeOffsets[records.length] = edgeOffset;
	fields.advancedSwitchOffsets[records.length] = switchOffset;
	fields.equipmentGroupOffsets[records.length] = groupOffset;
	return Object.freeze(fields);
}

function createMetadataFields(
	records: readonly (StaticFabOrganizationRecord | null)[],
): StaticFabOrganizationMetadataFieldsSoA {
	const parentCount = records.reduce(
		(count, record) => count + (record ? staticFabOrganizationParentIds(record).length : 0),
		0,
	);
	const fields: StaticFabOrganizationMetadataFieldsSoA = {
		parentOrganizationOffsets: new Uint32Array(records.length + 1),
		parentOrganizationIds: new Int32Array(parentCount),
		descriptions: new Array<string>(records.length).fill(""),
		colors: new Uint8Array(records.length),
	};
	let parentOffset = 0;
	for (let index = 0; index < records.length; index++) {
		fields.parentOrganizationOffsets[index] = parentOffset;
		const record = records[index];
		if (!record) continue;
		for (const parentId of staticFabOrganizationParentIds(record)) {
			fields.parentOrganizationIds[parentOffset++] = parentId;
		}
		const properties = staticFabOrganizationProperties(record);
		(fields.descriptions as string[])[index] = properties.description;
		fields.colors[index] = staticFabOrganizationColorCode(properties.color);
	}
	fields.parentOrganizationOffsets[records.length] = parentOffset;
	return Object.freeze(fields);
}

function createMembershipFields(
	memberships: readonly (StaticFabOrganizationRecord["membership"] | null)[],
): StaticFabOrganizationMembershipFieldsSoA {
	const edgeCount = memberships.reduce(
		(count, membership) => count + (membership?.railEdges.length ?? 0),
		0,
	);
	const switchCount = memberships.reduce(
		(count, membership) => count + (membership?.advancedSwitchIds.length ?? 0),
		0,
	);
	const groupCount = memberships.reduce(
		(count, membership) => count + (membership?.equipmentGroupIds.length ?? 0),
		0,
	);
	const fields: StaticFabOrganizationMembershipFieldsSoA = {
		railEdgeOffsets: new Uint32Array(memberships.length + 1),
		railEdgeCoordinates: new Int32Array(edgeCount * 4),
		advancedSwitchOffsets: new Uint32Array(memberships.length + 1),
		advancedSwitchIds: new Int32Array(switchCount),
		equipmentGroupOffsets: new Uint32Array(memberships.length + 1),
		equipmentGroupIds: new Int32Array(groupCount),
	};
	let edgeOffset = 0;
	let switchOffset = 0;
	let groupOffset = 0;
	for (let index = 0; index < memberships.length; index++) {
		fields.railEdgeOffsets[index] = edgeOffset;
		fields.advancedSwitchOffsets[index] = switchOffset;
		fields.equipmentGroupOffsets[index] = groupOffset;
		const membership = memberships[index];
		if (!membership) continue;
		for (const edge of membership.railEdges) {
			const coordinateOffset = edgeOffset * 4;
			fields.railEdgeCoordinates[coordinateOffset] = edge.from.x;
			fields.railEdgeCoordinates[coordinateOffset + 1] = edge.from.y;
			fields.railEdgeCoordinates[coordinateOffset + 2] = edge.to.x;
			fields.railEdgeCoordinates[coordinateOffset + 3] = edge.to.y;
			edgeOffset++;
		}
		for (const switchId of membership.advancedSwitchIds) {
			fields.advancedSwitchIds[switchOffset++] = switchId;
		}
		for (const groupId of membership.equipmentGroupIds) {
			fields.equipmentGroupIds[groupOffset++] = groupId;
		}
	}
	fields.railEdgeOffsets[memberships.length] = edgeOffset;
	fields.advancedSwitchOffsets[memberships.length] = switchOffset;
	fields.equipmentGroupOffsets[memberships.length] = groupOffset;
	return Object.freeze(fields);
}

interface DecodedStaticFabOrganizationMetadata {
	readonly parentOrganizationIds: readonly number[];
	readonly properties: StaticFabOrganizationProperties;
}

function readMetadata(
	fields: StaticFabOrganizationMetadataFieldsSoA,
	index: number,
): DecodedStaticFabOrganizationMetadata {
	return Object.freeze({
		parentOrganizationIds: Object.freeze(
			Array.from(
				fields.parentOrganizationIds.slice(
					fields.parentOrganizationOffsets[index] as number,
					fields.parentOrganizationOffsets[index + 1] as number,
				),
			),
		),
		properties: Object.freeze({
			description: fields.descriptions[index] as string,
			color: staticFabOrganizationColorFromCode(fields.colors[index] as number),
		}),
	});
}

function staticFabOrganizationCompactMetadataEquals(
	left: StaticFabOrganizationRecord,
	right: StaticFabOrganizationRecord,
): boolean {
	return staticFabOrganizationMetadataMatches(left, {
		parentOrganizationIds: staticFabOrganizationParentIds(right),
		properties: staticFabOrganizationProperties(right),
	});
}

function staticFabOrganizationMetadataMatches(
	record: StaticFabOrganizationRecord,
	metadata: DecodedStaticFabOrganizationMetadata,
): boolean {
	const parentIds = staticFabOrganizationParentIds(record);
	const properties = staticFabOrganizationProperties(record);
	return (
		parentIds.length === metadata.parentOrganizationIds.length &&
		parentIds.every((id, index) => id === metadata.parentOrganizationIds[index]) &&
		properties.description === metadata.properties.description &&
		properties.color === metadata.properties.color
	);
}

function staticFabOrganizationIdentityAndMetadataEquals(
	left: StaticFabOrganizationRecord,
	right: StaticFabOrganizationRecord,
): boolean {
	return (
		left.id === right.id &&
		left.kind === right.kind &&
		left.name === right.name &&
		staticFabOrganizationCompactMetadataEquals(left, right)
	);
}

function writeOrganizationFingerprint(
	fields: Uint32Array,
	index: number,
	record: StaticFabOrganizationRecord,
): void {
	const fingerprint = staticFabOrganizationFingerprint(record);
	fields[index * 2] = fingerprint.xor;
	fields[index * 2 + 1] = fingerprint.sum;
}

function assertOrganizationFingerprint(
	fields: Uint32Array,
	index: number,
	record: StaticFabOrganizationRecord,
	label: string,
): void {
	const fingerprint = staticFabOrganizationFingerprint(record);
	if (
		(fields[index * 2] as number) !== fingerprint.xor ||
		(fields[index * 2 + 1] as number) !== fingerprint.sum
	) {
		throw new Error(`Compact organization ${record.id} ${label} fingerprint does not match.`);
	}
}

function assertEmptyFingerprintRow(fields: Uint32Array, index: number, label: string): void {
	if ((fields[index * 2] as number) !== 0 || (fields[index * 2 + 1] as number) !== 0) {
		throw new Error(`${label} carries a compact fingerprint.`);
	}
}

interface StaticFabOrganizationMembershipDelta {
	readonly removed: StaticFabOrganizationRecord["membership"];
	readonly added: StaticFabOrganizationRecord["membership"];
}

function staticFabOrganizationMembershipDelta(
	before: StaticFabOrganizationRecord["membership"],
	after: StaticFabOrganizationRecord["membership"],
): StaticFabOrganizationMembershipDelta | null {
	const removed = Object.freeze({
		railEdges: Object.freeze(canonicalEdgeDifference(before.railEdges, after.railEdges)),
		advancedSwitchIds: Object.freeze(
			canonicalNumberDifference(before.advancedSwitchIds, after.advancedSwitchIds),
		),
		equipmentGroupIds: Object.freeze(
			canonicalNumberDifference(before.equipmentGroupIds, after.equipmentGroupIds),
		),
	});
	const added = Object.freeze({
		railEdges: Object.freeze(canonicalEdgeDifference(after.railEdges, before.railEdges)),
		advancedSwitchIds: Object.freeze(
			canonicalNumberDifference(after.advancedSwitchIds, before.advancedSwitchIds),
		),
		equipmentGroupIds: Object.freeze(
			canonicalNumberDifference(after.equipmentGroupIds, before.equipmentGroupIds),
		),
	});
	return staticFabOrganizationMembershipSize(removed) + staticFabOrganizationMembershipSize(added) >
		0
		? Object.freeze({ removed, added })
		: null;
}

function canonicalEdgeDifference(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): DirectedRailEdge[] {
	const difference: DirectedRailEdge[] = [];
	let rightIndex = 0;
	for (const edge of left) {
		while (
			rightIndex < right.length &&
			compareDirectedRailEdges(right[rightIndex] as DirectedRailEdge, edge) < 0
		) {
			rightIndex++;
		}
		if (
			rightIndex >= right.length ||
			compareDirectedRailEdges(edge, right[rightIndex] as DirectedRailEdge) !== 0
		) {
			difference.push(edge);
		}
	}
	return difference;
}

function canonicalNumberDifference(left: readonly number[], right: readonly number[]): number[] {
	const difference: number[] = [];
	let rightIndex = 0;
	for (const value of left) {
		while (rightIndex < right.length && (right[rightIndex] as number) < value) rightIndex++;
		if (rightIndex >= right.length || right[rightIndex] !== value) difference.push(value);
	}
	return difference;
}

function staticFabOrganizationMembershipSize(
	membership: StaticFabOrganizationRecord["membership"],
): number {
	return (
		membership.railEdges.length +
		membership.advancedSwitchIds.length +
		membership.equipmentGroupIds.length
	);
}

function applyStaticFabOrganizationMembershipDelta(
	current: StaticFabOrganizationRecord["membership"],
	removed: StaticFabOrganizationRecord["membership"],
	added: StaticFabOrganizationRecord["membership"],
	organizationId: number,
): StaticFabOrganizationRecord["membership"] {
	const missingEdge = firstMissingCanonicalEdge(current.railEdges, removed.railEdges);
	if (missingEdge) {
		throw new Error(
			`Organization membership delta ${organizationId} removes missing rail ${staticFabOrganizationEdgeKey(missingEdge)}.`,
		);
	}
	const overlappingEdge = firstCanonicalEdgeIntersection(removed.railEdges, added.railEdges);
	if (overlappingEdge) {
		throw new Error(
			`Organization membership delta ${organizationId} removes and adds rail ${staticFabOrganizationEdgeKey(overlappingEdge)}.`,
		);
	}
	const existingEdge = firstCanonicalEdgeIntersection(current.railEdges, added.railEdges);
	if (existingEdge) {
		throw new Error(
			`Organization membership delta ${organizationId} adds existing rail ${staticFabOrganizationEdgeKey(existingEdge)}.`,
		);
	}
	const railEdges = mergeCanonicalEdges(
		canonicalEdgeDifference(current.railEdges, removed.railEdges),
		added.railEdges,
	);

	const advancedSwitchIds = applyCanonicalIdDelta(
		current.advancedSwitchIds,
		removed.advancedSwitchIds,
		added.advancedSwitchIds,
		organizationId,
		"advanced switch",
	);
	const equipmentGroupIds = applyCanonicalIdDelta(
		current.equipmentGroupIds,
		removed.equipmentGroupIds,
		added.equipmentGroupIds,
		organizationId,
		"equipment group",
	);
	const membership = copyStaticFabOrganizationMembership({
		railEdges,
		advancedSwitchIds,
		equipmentGroupIds,
	});
	if (staticFabOrganizationMembershipSize(membership) === 0) {
		throw new Error(`Organization membership delta ${organizationId} leaves an empty record.`);
	}
	return membership;
}

function applyCanonicalIdDelta(
	current: readonly number[],
	removed: readonly number[],
	added: readonly number[],
	organizationId: number,
	label: string,
): number[] {
	const missing = firstMissingCanonicalNumber(current, removed);
	if (missing !== null) {
		throw new Error(
			`Organization membership delta ${organizationId} removes missing ${label} ${missing}.`,
		);
	}
	const overlapping = firstCanonicalNumberIntersection(removed, added);
	if (overlapping !== null) {
		throw new Error(
			`Organization membership delta ${organizationId} removes and adds ${label} ${overlapping}.`,
		);
	}
	const existing = firstCanonicalNumberIntersection(current, added);
	if (existing !== null) {
		throw new Error(
			`Organization membership delta ${organizationId} adds existing ${label} ${existing}.`,
		);
	}
	return mergeCanonicalNumbers(canonicalNumberDifference(current, removed), added);
}

function firstMissingCanonicalEdge(
	current: readonly DirectedRailEdge[],
	removed: readonly DirectedRailEdge[],
): DirectedRailEdge | null {
	let currentIndex = 0;
	for (const edge of removed) {
		while (
			currentIndex < current.length &&
			compareDirectedRailEdges(current[currentIndex] as DirectedRailEdge, edge) < 0
		) {
			currentIndex++;
		}
		if (
			currentIndex >= current.length ||
			compareDirectedRailEdges(current[currentIndex] as DirectedRailEdge, edge) !== 0
		) {
			return edge;
		}
	}
	return null;
}

function firstCanonicalEdgeIntersection(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): DirectedRailEdge | null {
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length && rightIndex < right.length) {
		const leftEdge = left[leftIndex] as DirectedRailEdge;
		const rightEdge = right[rightIndex] as DirectedRailEdge;
		const compared = compareDirectedRailEdges(leftEdge, rightEdge);
		if (compared === 0) return leftEdge;
		if (compared < 0) leftIndex++;
		else rightIndex++;
	}
	return null;
}

function mergeCanonicalEdges(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): DirectedRailEdge[] {
	const merged = new Array<DirectedRailEdge>(left.length + right.length);
	let leftIndex = 0;
	let rightIndex = 0;
	let targetIndex = 0;
	while (leftIndex < left.length || rightIndex < right.length) {
		if (
			rightIndex >= right.length ||
			(leftIndex < left.length &&
				compareDirectedRailEdges(
					left[leftIndex] as DirectedRailEdge,
					right[rightIndex] as DirectedRailEdge,
				) < 0)
		) {
			merged[targetIndex++] = left[leftIndex++] as DirectedRailEdge;
		} else {
			merged[targetIndex++] = right[rightIndex++] as DirectedRailEdge;
		}
	}
	return merged;
}

function firstMissingCanonicalNumber(
	current: readonly number[],
	removed: readonly number[],
): number | null {
	let currentIndex = 0;
	for (const value of removed) {
		while (currentIndex < current.length && (current[currentIndex] as number) < value) {
			currentIndex++;
		}
		if (currentIndex >= current.length || current[currentIndex] !== value) return value;
	}
	return null;
}

function firstCanonicalNumberIntersection(
	left: readonly number[],
	right: readonly number[],
): number | null {
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length && rightIndex < right.length) {
		const leftValue = left[leftIndex] as number;
		const rightValue = right[rightIndex] as number;
		if (leftValue === rightValue) return leftValue;
		if (leftValue < rightValue) leftIndex++;
		else rightIndex++;
	}
	return null;
}

function mergeCanonicalNumbers(left: readonly number[], right: readonly number[]): number[] {
	const merged = new Array<number>(left.length + right.length);
	let leftIndex = 0;
	let rightIndex = 0;
	let targetIndex = 0;
	while (leftIndex < left.length || rightIndex < right.length) {
		if (
			rightIndex >= right.length ||
			(leftIndex < left.length && (left[leftIndex] as number) < (right[rightIndex] as number))
		) {
			merged[targetIndex++] = left[leftIndex++] as number;
		} else {
			merged[targetIndex++] = right[rightIndex++] as number;
		}
	}
	return merged;
}

function validateMetadataFields(
	fields: StaticFabOrganizationMetadataFieldsSoA,
	count: number,
	label: string,
): void {
	if (fields === null || typeof fields !== "object") {
		throw new Error(`${label} fields must be an object.`);
	}
	assertTypedArray(
		fields.parentOrganizationOffsets,
		Uint32Array,
		`${label} parent organization offsets`,
	);
	assertTypedArray(fields.parentOrganizationIds, Int32Array, `${label} parent organization ids`);
	if (!Array.isArray(fields.descriptions)) {
		throw new Error(`${label} descriptions must be an Array.`);
	}
	assertTypedArray(fields.colors, Uint8Array, `${label} colors`);
	if (fields.descriptions.length !== count || fields.colors.length !== count) {
		throw new Error(`${label} row lengths do not match.`);
	}
	validateOffsets(
		fields.parentOrganizationOffsets,
		count,
		fields.parentOrganizationIds.length,
		`${label} parent organization`,
	);
	for (let index = 0; index < count; index++) {
		if (typeof fields.descriptions[index] !== "string") {
			throw new Error(`${label} description ${index} must be a string.`);
		}
		validateCanonicalPositiveInt32IdRange(
			fields.parentOrganizationIds,
			fields.parentOrganizationOffsets[index] as number,
			fields.parentOrganizationOffsets[index + 1] as number,
			`${label} parent organization row ${index}`,
		);
		validateHydratedOrganizationDescription(fields.descriptions[index] as string, index);
		staticFabOrganizationColorFromCode(fields.colors[index] as number);
	}
}

function assertEmptyMetadataRow(
	fields: StaticFabOrganizationMetadataFieldsSoA,
	index: number,
	label: string,
): void {
	if (
		(fields.parentOrganizationOffsets[index] as number) !==
			(fields.parentOrganizationOffsets[index + 1] as number) ||
		(fields.descriptions[index] ?? "") !== "" ||
		(fields.colors[index] as number) !== 0
	) {
		throw new Error(`${label} has data while its operation does not use metadata.`);
	}
}

function metadataFieldTransfers(fields: StaticFabOrganizationMetadataFieldsSoA): ArrayBuffer[] {
	return [
		fields.parentOrganizationOffsets.buffer,
		...(fields.parentOrganizationIds.byteLength > 0 ? [fields.parentOrganizationIds.buffer] : []),
		fields.colors.buffer,
	] as ArrayBuffer[];
}

function assertEmptyMembershipRow(
	fields: StaticFabOrganizationMembershipFieldsSoA,
	index: number,
	label: string,
): void {
	if (membershipRowSize(fields, index) !== 0) {
		throw new Error(`${label} has data while its operation does not use a membership delta.`);
	}
}

function membershipRowSize(
	fields: StaticFabOrganizationMembershipFieldsSoA,
	index: number,
): number {
	return (
		(fields.railEdgeOffsets[index + 1] as number) -
		(fields.railEdgeOffsets[index] as number) +
		(fields.advancedSwitchOffsets[index + 1] as number) -
		(fields.advancedSwitchOffsets[index] as number) +
		(fields.equipmentGroupOffsets[index + 1] as number) -
		(fields.equipmentGroupOffsets[index] as number)
	);
}

function membershipFieldTransfers(fields: StaticFabOrganizationMembershipFieldsSoA): ArrayBuffer[] {
	return [
		fields.railEdgeOffsets.buffer,
		...(fields.railEdgeCoordinates.byteLength > 0 ? [fields.railEdgeCoordinates.buffer] : []),
		fields.advancedSwitchOffsets.buffer,
		...(fields.advancedSwitchIds.byteLength > 0 ? [fields.advancedSwitchIds.buffer] : []),
		fields.equipmentGroupOffsets.buffer,
		...(fields.equipmentGroupIds.byteLength > 0 ? [fields.equipmentGroupIds.buffer] : []),
	] as ArrayBuffer[];
}

function staticFabOrganizationColorCode(
	color: ReturnType<typeof staticFabOrganizationProperties>["color"],
): number {
	const code = STATIC_FAB_ORGANIZATION_COLORS.indexOf(color);
	if (code < 0) throw new Error(`Unknown static FAB organization color '${color}'.`);
	return code;
}

function staticFabOrganizationColorFromCode(
	code: number,
): ReturnType<typeof staticFabOrganizationProperties>["color"] {
	const color = STATIC_FAB_ORGANIZATION_COLORS[code];
	if (!color) throw new Error(`Unknown static FAB organization color code ${code}.`);
	return color;
}

function readMembership(
	fields: StaticFabOrganizationMembershipFieldsSoA,
	index: number,
): StaticFabOrganizationRecord["membership"] {
	const edges: DirectedRailEdge[] = [];
	for (
		let offset = fields.railEdgeOffsets[index] as number;
		offset < (fields.railEdgeOffsets[index + 1] as number);
		offset++
	) {
		const coordinateOffset = offset * 4;
		edges.push(
			Object.freeze({
				from: Object.freeze({
					x: fields.railEdgeCoordinates[coordinateOffset] as number,
					y: fields.railEdgeCoordinates[coordinateOffset + 1] as number,
				}),
				to: Object.freeze({
					x: fields.railEdgeCoordinates[coordinateOffset + 2] as number,
					y: fields.railEdgeCoordinates[coordinateOffset + 3] as number,
				}),
			}),
		);
	}
	return Object.freeze({
		railEdges: Object.freeze(edges),
		advancedSwitchIds: Object.freeze(
			Array.from(
				fields.advancedSwitchIds.slice(
					fields.advancedSwitchOffsets[index] as number,
					fields.advancedSwitchOffsets[index + 1] as number,
				),
			),
		),
		equipmentGroupIds: Object.freeze(
			Array.from(
				fields.equipmentGroupIds.slice(
					fields.equipmentGroupOffsets[index] as number,
					fields.equipmentGroupOffsets[index + 1] as number,
				),
			),
		),
	});
}

function readRecord(
	id: number,
	fields: StaticFabOrganizationRecordFieldsSoA,
	index: number,
): StaticFabOrganizationRecord {
	const edges: DirectedRailEdge[] = [];
	for (
		let offset = fields.railEdgeOffsets[index] as number;
		offset < (fields.railEdgeOffsets[index + 1] as number);
		offset++
	) {
		const coordinateOffset = offset * 4;
		edges.push({
			from: {
				x: fields.railEdgeCoordinates[coordinateOffset] as number,
				y: fields.railEdgeCoordinates[coordinateOffset + 1] as number,
			},
			to: {
				x: fields.railEdgeCoordinates[coordinateOffset + 2] as number,
				y: fields.railEdgeCoordinates[coordinateOffset + 3] as number,
			},
		});
	}
	const switchStart = fields.advancedSwitchOffsets[index] as number;
	const switchEnd = fields.advancedSwitchOffsets[index + 1] as number;
	const groupStart = fields.equipmentGroupOffsets[index] as number;
	const groupEnd = fields.equipmentGroupOffsets[index + 1] as number;
	const kindCode = fields.kinds[index] as number;
	const kind = STATIC_FAB_ORGANIZATION_KINDS[kindCode];
	if (!kind) throw new Error(`Unknown static FAB organization kind code ${kindCode}.`);
	return copyStaticFabOrganizationRecord({
		id,
		kind,
		name: fields.names[index] ?? "",
		parentOrganizationIds: Array.from(
			fields.parentOrganizationIds.slice(
				fields.parentOrganizationOffsets[index] as number,
				fields.parentOrganizationOffsets[index + 1] as number,
			),
		),
		properties: {
			description: fields.descriptions[index] ?? "",
			color: staticFabOrganizationColorFromCode(fields.colors[index] as number),
		},
		membership: {
			railEdges: edges,
			advancedSwitchIds: Array.from(fields.advancedSwitchIds.slice(switchStart, switchEnd)),
			equipmentGroupIds: Array.from(fields.equipmentGroupIds.slice(groupStart, groupEnd)),
		},
	});
}

function validateRecordFields(
	fields: StaticFabOrganizationRecordFieldsSoA,
	count: number,
	label: string,
): void {
	validateRecordFieldStructure(fields, count, label);
	for (let index = 0; index < count; index++) {
		validateCanonicalPositiveInt32IdRange(
			fields.parentOrganizationIds,
			fields.parentOrganizationOffsets[index] as number,
			fields.parentOrganizationOffsets[index + 1] as number,
			`${label} parent organization row ${index}`,
		);
		validateHydratedOrganizationDescription(fields.descriptions[index] as string, index);
		staticFabOrganizationColorFromCode(fields.colors[index] as number);
		validateCanonicalRailEdgeRow(fields, index, label);
		validateCanonicalPositiveInt32IdRange(
			fields.advancedSwitchIds,
			fields.advancedSwitchOffsets[index] as number,
			fields.advancedSwitchOffsets[index + 1] as number,
			`${label} advanced switch row ${index}`,
		);
		validateCanonicalPositiveInt32IdRange(
			fields.equipmentGroupIds,
			fields.equipmentGroupOffsets[index] as number,
			fields.equipmentGroupOffsets[index + 1] as number,
			`${label} equipment group row ${index}`,
		);
	}
}

function validateMembershipFields(
	fields: StaticFabOrganizationMembershipFieldsSoA,
	count: number,
	label: string,
): void {
	if (fields === null || typeof fields !== "object") {
		throw new Error(`${label} fields must be an object.`);
	}
	assertTypedArray(fields.railEdgeOffsets, Uint32Array, `${label} rail edge offsets`);
	assertTypedArray(fields.railEdgeCoordinates, Int32Array, `${label} rail edge coordinates`);
	assertTypedArray(fields.advancedSwitchOffsets, Uint32Array, `${label} advanced switch offsets`);
	assertTypedArray(fields.advancedSwitchIds, Int32Array, `${label} advanced switch ids`);
	assertTypedArray(fields.equipmentGroupOffsets, Uint32Array, `${label} equipment group offsets`);
	assertTypedArray(fields.equipmentGroupIds, Int32Array, `${label} equipment group ids`);
	if (fields.railEdgeCoordinates.length % 4 !== 0) {
		throw new Error(`${label} rail edge coordinates are not grouped in fours.`);
	}
	validateOffsets(
		fields.railEdgeOffsets,
		count,
		fields.railEdgeCoordinates.length / 4,
		`${label} rail edge`,
	);
	validateOffsets(
		fields.advancedSwitchOffsets,
		count,
		fields.advancedSwitchIds.length,
		`${label} advanced switch`,
	);
	validateOffsets(
		fields.equipmentGroupOffsets,
		count,
		fields.equipmentGroupIds.length,
		`${label} equipment group`,
	);
	for (let index = 0; index < count; index++) {
		validateCanonicalRailEdgeRow(fields, index, label);
		validateCanonicalPositiveInt32IdRange(
			fields.advancedSwitchIds,
			fields.advancedSwitchOffsets[index] as number,
			fields.advancedSwitchOffsets[index + 1] as number,
			`${label} advanced switch row ${index}`,
		);
		validateCanonicalPositiveInt32IdRange(
			fields.equipmentGroupIds,
			fields.equipmentGroupOffsets[index] as number,
			fields.equipmentGroupOffsets[index + 1] as number,
			`${label} equipment group row ${index}`,
		);
	}
}

function validateRecordFieldStructure(
	fields: StaticFabOrganizationRecordFieldsSoA,
	count: number,
	label: string,
	validateEnumCodes = true,
): void {
	if (fields === null || typeof fields !== "object") {
		throw new Error(`${label} record fields must be an object.`);
	}
	assertTypedArray(fields.kinds, Uint8Array, `${label} kinds`);
	if (!Array.isArray(fields.names)) throw new Error(`${label} names must be an Array.`);
	assertTypedArray(
		fields.parentOrganizationOffsets,
		Uint32Array,
		`${label} parent organization offsets`,
	);
	assertTypedArray(fields.parentOrganizationIds, Int32Array, `${label} parent organization ids`);
	if (!Array.isArray(fields.descriptions)) {
		throw new Error(`${label} descriptions must be an Array.`);
	}
	assertTypedArray(fields.colors, Uint8Array, `${label} colors`);
	assertTypedArray(fields.railEdgeOffsets, Uint32Array, `${label} rail edge offsets`);
	assertTypedArray(fields.railEdgeCoordinates, Int32Array, `${label} rail edge coordinates`);
	assertTypedArray(fields.advancedSwitchOffsets, Uint32Array, `${label} advanced switch offsets`);
	assertTypedArray(fields.advancedSwitchIds, Int32Array, `${label} advanced switch ids`);
	assertTypedArray(fields.equipmentGroupOffsets, Uint32Array, `${label} equipment group offsets`);
	assertTypedArray(fields.equipmentGroupIds, Int32Array, `${label} equipment group ids`);
	if (
		fields.kinds.length !== count ||
		fields.names.length !== count ||
		fields.descriptions.length !== count ||
		fields.colors.length !== count
	) {
		throw new Error(`${label} record lengths do not match.`);
	}
	for (let index = 0; index < count; index++) {
		if (typeof fields.names[index] !== "string") {
			throw new Error(`${label} name ${index} must be a string.`);
		}
		if (typeof fields.descriptions[index] !== "string") {
			throw new Error(`${label} description ${index} must be a string.`);
		}
		const kindCode = fields.kinds[index] as number;
		if (validateEnumCodes && kindCode >= STATIC_FAB_ORGANIZATION_KINDS.length) {
			throw new Error(`${label} kind ${index} has unknown code ${kindCode}.`);
		}
	}
	validateOffsets(
		fields.parentOrganizationOffsets,
		count,
		fields.parentOrganizationIds.length,
		`${label} parent organization`,
	);
	if (fields.railEdgeCoordinates.length % 4 !== 0) {
		throw new Error(`${label} rail edge coordinates are not grouped in fours.`);
	}
	validateOffsets(
		fields.railEdgeOffsets,
		count,
		fields.railEdgeCoordinates.length / 4,
		`${label} rail edge`,
	);
	validateOffsets(
		fields.advancedSwitchOffsets,
		count,
		fields.advancedSwitchIds.length,
		`${label} advanced switch`,
	);
	validateOffsets(
		fields.equipmentGroupOffsets,
		count,
		fields.equipmentGroupIds.length,
		`${label} equipment group`,
	);
}

function validatePositiveInt32(value: number, label: string): void {
	if (!Number.isInteger(value) || value <= 0 || value > 0x7fff_ffff) {
		throw new Error(`${label} must be a positive signed 32-bit integer.`);
	}
}

function validateCanonicalPositiveInt32Ids(values: Int32Array, label: string): void {
	validateCanonicalPositiveInt32IdRange(values, 0, values.length, label);
}

function validateCanonicalPositiveInt32IdRange(
	values: Int32Array,
	start: number,
	end: number,
	label: string,
): void {
	let previous = 0;
	for (let index = start; index < end; index++) {
		const value = values[index] as number;
		validateCanonicalPositiveInt32Id(value, previous, label);
		previous = value;
	}
}

function validateCanonicalPositiveInt32Id(value: number, previous: number, label: string): void {
	if (value <= 0) throw new Error(`${label} contains non-positive id ${value}.`);
	if (value <= previous) {
		throw new Error(`${label} must be strictly increasing without duplicates.`);
	}
}

function validateCanonicalRailEdgeRow(
	fields: Pick<StaticFabOrganizationMembershipFieldsSoA, "railEdgeOffsets" | "railEdgeCoordinates">,
	row: number,
	label: string,
): void {
	const start = fields.railEdgeOffsets[row] as number;
	const end = fields.railEdgeOffsets[row + 1] as number;
	let previousOffset = -1;
	for (let offset = start; offset < end; offset++) {
		const coordinateOffset = offset * 4;
		readCanonicalRailEdge(fields.railEdgeCoordinates, coordinateOffset, previousOffset, row, label);
		previousOffset = coordinateOffset;
	}
}

function readCanonicalRailEdge(
	coordinates: Int32Array,
	coordinateOffset: number,
	previousCoordinateOffset: number,
	row: number,
	label: string,
): DirectedRailEdge {
	const fromX = coordinates[coordinateOffset] as number;
	const fromY = coordinates[coordinateOffset + 1] as number;
	const toX = coordinates[coordinateOffset + 2] as number;
	const toY = coordinates[coordinateOffset + 3] as number;
	if (Math.abs(toX - fromX) + Math.abs(toY - fromY) !== 1) {
		throw new Error(`${label} rail edge row ${row} contains a non-adjacent edge.`);
	}
	if (
		previousCoordinateOffset >= 0 &&
		compareRailEdgeCoordinates(coordinates, previousCoordinateOffset, coordinateOffset) >= 0
	) {
		throw new Error(`${label} rail edge row ${row} must be strictly canonical without duplicates.`);
	}
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}

function validateHydratedOrganizationName(name: string, row: number): void {
	if (
		name.length === 0 ||
		name.length > 120 ||
		name !== name.trim() ||
		hasAsciiControlCharacter(name)
	) {
		throw new Error(
			`Organization snapshot name ${row} must be a trimmed 1-120 character string without control characters.`,
		);
	}
}

function validateHydratedOrganizationDescription(description: string, row: number): void {
	if (
		description.length > 500 ||
		description !== description.trim() ||
		hasDisallowedDescriptionControlCharacter(description)
	) {
		throw new Error(
			`Organization snapshot description ${row} must be a trimmed string of at most 500 characters without unsupported control characters.`,
		);
	}
}

function hasAsciiControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function hasDisallowedDescriptionControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if ((code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f) return true;
	}
	return false;
}

function compareRailEdgeCoordinates(
	coordinates: Int32Array,
	leftOffset: number,
	rightOffset: number,
): number {
	return (
		(coordinates[leftOffset] as number) - (coordinates[rightOffset] as number) ||
		(coordinates[leftOffset + 1] as number) - (coordinates[rightOffset + 1] as number) ||
		(coordinates[leftOffset + 2] as number) - (coordinates[rightOffset + 2] as number) ||
		(coordinates[leftOffset + 3] as number) - (coordinates[rightOffset + 3] as number)
	);
}

function validatePresenceValues(values: Uint8Array, label: string): void {
	for (let index = 0; index < values.length; index++) {
		const value = values[index] as number;
		if (value !== 0 && value !== 1) {
			throw new Error(`${label} ${index} is ${value}; expected 0 or 1.`);
		}
	}
}

function validateCursorAgainstPresentRows(
	cursor: number,
	organizationIds: Int32Array,
	presence: Uint8Array,
	label: string,
): void {
	for (let index = 0; index < organizationIds.length; index++) {
		if ((presence[index] as number) === 1 && cursor <= (organizationIds[index] as number)) {
			throw new Error(
				`${label} ${cursor} must be greater than present organization id ${organizationIds[index]}.`,
			);
		}
	}
}

function validateOffsets(
	offsets: Uint32Array,
	count: number,
	itemCount: number,
	label: string,
): void {
	if (offsets.length !== count + 1) throw new Error(`${label} offset length does not match.`);
	if ((offsets[0] as number) !== 0 || (offsets[count] as number) !== itemCount) {
		throw new Error(`${label} offsets do not span their item buffer.`);
	}
	for (let index = 0; index < count; index++) {
		if ((offsets[index] as number) > (offsets[index + 1] as number)) {
			throw new Error(`${label} offsets are not monotonic.`);
		}
	}
}

function assertEmptyRecordRow(
	fields: StaticFabOrganizationRecordFieldsSoA,
	index: number,
	label: string,
): void {
	if (
		(fields.kinds[index] as number) !== 0 ||
		(fields.names[index] ?? "") !== "" ||
		(fields.parentOrganizationOffsets[index] as number) !==
			(fields.parentOrganizationOffsets[index + 1] as number) ||
		(fields.descriptions[index] ?? "") !== "" ||
		(fields.colors[index] as number) !== 0 ||
		(fields.railEdgeOffsets[index] as number) !== (fields.railEdgeOffsets[index + 1] as number) ||
		(fields.advancedSwitchOffsets[index] as number) !==
			(fields.advancedSwitchOffsets[index + 1] as number) ||
		(fields.equipmentGroupOffsets[index] as number) !==
			(fields.equipmentGroupOffsets[index + 1] as number)
	) {
		throw new Error(`${label} has data while its presence flag is zero.`);
	}
}

function readPresence(value: number, label: string): boolean {
	if (value !== 0 && value !== 1) throw new Error(`${label} presence ${value} is not 0 or 1.`);
	return value === 1;
}

function recordFieldTransfers(fields: StaticFabOrganizationRecordFieldsSoA): ArrayBuffer[] {
	return [
		fields.kinds.buffer,
		fields.parentOrganizationOffsets.buffer,
		...(fields.parentOrganizationIds.byteLength > 0 ? [fields.parentOrganizationIds.buffer] : []),
		fields.colors.buffer,
		fields.railEdgeOffsets.buffer,
		fields.railEdgeCoordinates.buffer,
		fields.advancedSwitchOffsets.buffer,
		fields.advancedSwitchIds.buffer,
		fields.equipmentGroupOffsets.buffer,
		fields.equipmentGroupIds.buffer,
	] as ArrayBuffer[];
}
