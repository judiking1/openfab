import {
	copyOperationalConfigurationState,
	type OperationalConfigurationReview,
	type OperationalConfigurationState,
	type OperationalEqGroupQualificationRecord,
	type OperationalEqPortQualificationOverrideRecord,
	type OperationalLogicalDefinition,
	type OperationalResidentHomeSlotRecord,
	type OperationalStationCapabilityRecord,
	type OperationalStorageGroupConfigurationRecord,
	type OperationalStoragePolicyDefinition,
	type OperationalVehicleReservationProfile,
} from "./OperationalConfiguration";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";

export const OPERATIONAL_CONFIGURATION_PATCH_KIND = "edit-operational-configuration" as const;

export interface OperationalRecordMutation<T> {
	readonly id: number;
	readonly before: T | null;
	readonly after: T | null;
}

export type OperationalStationCapabilityMutation =
	OperationalRecordMutation<OperationalStationCapabilityRecord>;
export type OperationalLogicalDefinitionMutation =
	OperationalRecordMutation<OperationalLogicalDefinition>;
export type OperationalEqGroupQualificationMutation =
	OperationalRecordMutation<OperationalEqGroupQualificationRecord>;
export type OperationalEqPortQualificationOverrideMutation =
	OperationalRecordMutation<OperationalEqPortQualificationOverrideRecord>;
export type OperationalStoragePolicyMutation =
	OperationalRecordMutation<OperationalStoragePolicyDefinition>;
export type OperationalStorageGroupConfigurationMutation =
	OperationalRecordMutation<OperationalStorageGroupConfigurationRecord>;
export type OperationalResidentHomeSlotMutation =
	OperationalRecordMutation<OperationalResidentHomeSlotRecord>;

/**
 * Compact before/after delta for one atomic operational-configuration edit.
 *
 * Configuration revisions advance for semantic edits and stay fixed for review-only edits. Logical
 * definition cursors never move backwards, including through undo/redo. A semantic edit always
 * clears review because its previous attestation cannot certify the new revision/fingerprint.
 */
export interface OperationalConfigurationPatch {
	readonly baseConfigurationRevision: number;
	readonly configurationRevision: number;
	readonly nextEqCapabilityIdBefore: number;
	readonly nextEqCapabilityIdAfter: number;
	readonly nextStorageClassIdBefore: number;
	readonly nextStorageClassIdAfter: number;
	readonly nextStoragePolicyIdBefore: number;
	readonly nextStoragePolicyIdAfter: number;
	readonly nextResidentHomeSlotIdBefore: number;
	readonly nextResidentHomeSlotIdAfter: number;
	readonly stationCapabilityChanges: readonly OperationalStationCapabilityMutation[];
	readonly eqCapabilityChanges: readonly OperationalLogicalDefinitionMutation[];
	readonly eqGroupQualificationChanges: readonly OperationalEqGroupQualificationMutation[];
	readonly eqPortQualificationOverrideChanges: readonly OperationalEqPortQualificationOverrideMutation[];
	readonly storageClassChanges: readonly OperationalLogicalDefinitionMutation[];
	readonly storagePolicyChanges: readonly OperationalStoragePolicyMutation[];
	readonly storageGroupChanges: readonly OperationalStorageGroupConfigurationMutation[];
	readonly residentHomeSlotChanges: readonly OperationalResidentHomeSlotMutation[];
	readonly vehicleProfileBefore: OperationalVehicleReservationProfile | null;
	readonly vehicleProfileAfter: OperationalVehicleReservationProfile | null;
	readonly reviewBefore: OperationalConfigurationReview | null;
	readonly reviewAfter: OperationalConfigurationReview | null;
}

export interface OperationalConfigurationMutationPlan {
	readonly kind: typeof OPERATIONAL_CONFIGURATION_PATCH_KIND;
	readonly baseRailRevision: number;
	readonly basePatchSequence: number;
	readonly patch: OperationalConfigurationPatch;
}

type KeyedOperationalRecord =
	| OperationalStationCapabilityRecord
	| OperationalLogicalDefinition
	| OperationalEqGroupQualificationRecord
	| OperationalEqPortQualificationOverrideRecord
	| OperationalStoragePolicyDefinition
	| OperationalStorageGroupConfigurationRecord
	| OperationalResidentHomeSlotRecord;

type KeySelector<T> = (record: T) => number;
type Equality<T> = (left: T | null, right: T | null) => boolean;

export function planOperationalConfigurationReplacement(
	current: OperationalConfigurationState,
	replacement: OperationalConfigurationState,
	baseRailRevision: number,
	basePatchSequence: number,
): OperationalConfigurationMutationPlan | null {
	assertNonNegativeSafeInteger(baseRailRevision, "operational plan rail revision");
	assertNonNegativeSafeInteger(basePatchSequence, "operational plan patch sequence");
	const source = copyOperationalConfigurationState(current);
	const requestedWithoutReview = copyOperationalConfigurationState({
		...replacement,
		revision: source.revision,
		review: null,
	});
	assertNonDecreasingCursor(
		source.nextEqCapabilityId,
		requestedWithoutReview.nextEqCapabilityId,
		"EQ capability",
	);
	assertNonDecreasingCursor(
		source.nextStorageClassId,
		requestedWithoutReview.nextStorageClassId,
		"storage class",
	);
	assertNonDecreasingCursor(
		source.nextStoragePolicyId,
		requestedWithoutReview.nextStoragePolicyId,
		"storage policy",
	);
	assertNonDecreasingCursor(
		source.nextResidentHomeSlotId,
		requestedWithoutReview.nextResidentHomeSlotId,
		"resident home slot",
	);

	const stationCapabilityChanges = diffRecords(
		source.stationCapabilities,
		requestedWithoutReview.stationCapabilities,
		(record) => record.portId,
		stationCapabilityEquals,
	);
	const eqCapabilityChanges = diffRecords(
		source.eqCapabilities,
		requestedWithoutReview.eqCapabilities,
		(record) => record.id,
		logicalDefinitionEquals,
	);
	const eqGroupQualificationChanges = diffRecords(
		source.eqGroupQualifications,
		requestedWithoutReview.eqGroupQualifications,
		(record) => record.equipmentGroupId,
		eqGroupQualificationEquals,
	);
	const eqPortQualificationOverrideChanges = diffRecords(
		source.eqPortQualificationOverrides,
		requestedWithoutReview.eqPortQualificationOverrides,
		(record) => record.portId,
		eqPortQualificationOverrideEquals,
	);
	const storageClassChanges = diffRecords(
		source.storageClasses,
		requestedWithoutReview.storageClasses,
		(record) => record.id,
		logicalDefinitionEquals,
	);
	const storagePolicyChanges = diffRecords(
		source.storagePolicies,
		requestedWithoutReview.storagePolicies,
		(record) => record.id,
		storagePolicyEquals,
	);
	const storageGroupChanges = diffRecords(
		source.storageGroups,
		requestedWithoutReview.storageGroups,
		(record) => record.equipmentGroupId,
		storageGroupEquals,
	);
	const residentHomeSlotChanges = diffRecords(
		source.residentHomeSlots,
		requestedWithoutReview.residentHomeSlots,
		(record) => record.id,
		residentHomeSlotEquals,
	);
	const vehicleChanged = !vehicleProfileEquals(
		source.vehicleProfile,
		requestedWithoutReview.vehicleProfile,
	);
	const semanticChanged =
		stationCapabilityChanges.length > 0 ||
		eqCapabilityChanges.length > 0 ||
		eqGroupQualificationChanges.length > 0 ||
		eqPortQualificationOverrideChanges.length > 0 ||
		storageClassChanges.length > 0 ||
		storagePolicyChanges.length > 0 ||
		storageGroupChanges.length > 0 ||
		residentHomeSlotChanges.length > 0 ||
		vehicleChanged;
	if (
		!semanticChanged &&
		(source.nextEqCapabilityId !== requestedWithoutReview.nextEqCapabilityId ||
			source.nextStorageClassId !== requestedWithoutReview.nextStorageClassId ||
			source.nextStoragePolicyId !== requestedWithoutReview.nextStoragePolicyId ||
			source.nextResidentHomeSlotId !== requestedWithoutReview.nextResidentHomeSlotId)
	) {
		throw new Error("Operational definition cursors cannot advance without a semantic edit.");
	}
	const requested = semanticChanged
		? requestedWithoutReview
		: copyOperationalConfigurationState({ ...replacement, revision: source.revision });
	const reviewAfter = requested.review;
	if (!semanticChanged && operationalReviewEquals(source.review, reviewAfter)) return null;
	if (semanticChanged && source.revision === Number.MAX_SAFE_INTEGER) {
		throw new Error("Operational configuration revision is exhausted.");
	}
	const patch = Object.freeze({
		baseConfigurationRevision: source.revision,
		configurationRevision: semanticChanged ? source.revision + 1 : source.revision,
		nextEqCapabilityIdBefore: source.nextEqCapabilityId,
		nextEqCapabilityIdAfter: requested.nextEqCapabilityId,
		nextStorageClassIdBefore: source.nextStorageClassId,
		nextStorageClassIdAfter: requested.nextStorageClassId,
		nextStoragePolicyIdBefore: source.nextStoragePolicyId,
		nextStoragePolicyIdAfter: requested.nextStoragePolicyId,
		nextResidentHomeSlotIdBefore: source.nextResidentHomeSlotId,
		nextResidentHomeSlotIdAfter: requested.nextResidentHomeSlotId,
		stationCapabilityChanges,
		eqCapabilityChanges,
		eqGroupQualificationChanges,
		eqPortQualificationOverrideChanges,
		storageClassChanges,
		storagePolicyChanges,
		storageGroupChanges,
		residentHomeSlotChanges,
		vehicleProfileBefore: source.vehicleProfile,
		vehicleProfileAfter: requested.vehicleProfile,
		reviewBefore: source.review,
		reviewAfter,
	}) satisfies OperationalConfigurationPatch;
	// Re-apply now so no invalid or stale plan can cross the command boundary.
	applyOperationalConfigurationPatch(source, patch);
	return Object.freeze({
		kind: OPERATIONAL_CONFIGURATION_PATCH_KIND,
		baseRailRevision,
		basePatchSequence,
		patch,
	});
}

export function applyOperationalConfigurationPatch(
	current: OperationalConfigurationState,
	patch: OperationalConfigurationPatch,
): OperationalConfigurationState {
	const source = copyOperationalConfigurationState(current);
	assertNonNegativeSafeInteger(patch?.baseConfigurationRevision, "operational patch base revision");
	assertNonNegativeSafeInteger(patch?.configurationRevision, "operational patch revision");
	if (patch.baseConfigurationRevision !== source.revision) {
		throw new Error(
			`Operational configuration base revision mismatch: expected ${source.revision}, received ${patch.baseConfigurationRevision}.`,
		);
	}
	assertCursorTransition(
		source.nextEqCapabilityId,
		patch.nextEqCapabilityIdBefore,
		patch.nextEqCapabilityIdAfter,
		"EQ capability",
	);
	assertCursorTransition(
		source.nextStorageClassId,
		patch.nextStorageClassIdBefore,
		patch.nextStorageClassIdAfter,
		"storage class",
	);
	assertCursorTransition(
		source.nextStoragePolicyId,
		patch.nextStoragePolicyIdBefore,
		patch.nextStoragePolicyIdAfter,
		"storage policy",
	);
	assertCursorTransition(
		source.nextResidentHomeSlotId,
		patch.nextResidentHomeSlotIdBefore,
		patch.nextResidentHomeSlotIdAfter,
		"resident home slot",
	);

	const stationCapabilities = applyRecordMutations(
		source.stationCapabilities,
		patch.stationCapabilityChanges,
		(record) => record.portId,
		stationCapabilityEquals,
		"station capability",
	);
	const eqCapabilities = applyRecordMutations(
		source.eqCapabilities,
		patch.eqCapabilityChanges,
		(record) => record.id,
		logicalDefinitionEquals,
		"EQ capability",
	);
	const eqGroupQualifications = applyRecordMutations(
		source.eqGroupQualifications,
		patch.eqGroupQualificationChanges,
		(record) => record.equipmentGroupId,
		eqGroupQualificationEquals,
		"EQ group qualification",
	);
	const eqPortQualificationOverrides = applyRecordMutations(
		source.eqPortQualificationOverrides,
		patch.eqPortQualificationOverrideChanges,
		(record) => record.portId,
		eqPortQualificationOverrideEquals,
		"EQ port qualification override",
	);
	const storageClasses = applyRecordMutations(
		source.storageClasses,
		patch.storageClassChanges,
		(record) => record.id,
		logicalDefinitionEquals,
		"storage class",
	);
	const storagePolicies = applyRecordMutations(
		source.storagePolicies,
		patch.storagePolicyChanges,
		(record) => record.id,
		storagePolicyEquals,
		"storage policy",
	);
	const storageGroups = applyRecordMutations(
		source.storageGroups,
		patch.storageGroupChanges,
		(record) => record.equipmentGroupId,
		storageGroupEquals,
		"storage group configuration",
	);
	const residentHomeSlots = applyRecordMutations(
		source.residentHomeSlots,
		patch.residentHomeSlotChanges,
		(record) => record.id,
		residentHomeSlotEquals,
		"resident home slot",
	);
	if (!vehicleProfileEquals(source.vehicleProfile, patch.vehicleProfileBefore)) {
		throw new Error("Operational vehicle profile before-value mismatch.");
	}
	if (!operationalReviewEquals(source.review, patch.reviewBefore)) {
		throw new Error("Operational configuration review before-value mismatch.");
	}
	const semanticChanged = operationalConfigurationPatchChangesContent(patch);
	if (!semanticChanged && !operationalReviewEquals(patch.reviewBefore, patch.reviewAfter)) {
		if (patch.configurationRevision !== patch.baseConfigurationRevision) {
			throw new Error("Review-only operational patch cannot change the configuration revision.");
		}
		if (
			patch.nextEqCapabilityIdAfter !== patch.nextEqCapabilityIdBefore ||
			patch.nextStorageClassIdAfter !== patch.nextStorageClassIdBefore ||
			patch.nextStoragePolicyIdAfter !== patch.nextStoragePolicyIdBefore ||
			patch.nextResidentHomeSlotIdAfter !== patch.nextResidentHomeSlotIdBefore
		) {
			throw new Error("Review-only operational patch cannot change definition cursors.");
		}
	} else if (semanticChanged) {
		if (patch.configurationRevision !== patch.baseConfigurationRevision + 1) {
			throw new Error("Semantic operational patch must advance the configuration revision once.");
		}
		if (patch.reviewAfter !== null) {
			throw new Error("Semantic operational patch must clear its previous review.");
		}
	} else {
		throw new Error("Operational configuration patch contains no change.");
	}

	return copyOperationalConfigurationState({
		schemaVersion: source.schemaVersion,
		revision: patch.configurationRevision,
		nextEqCapabilityId: patch.nextEqCapabilityIdAfter,
		nextStorageClassId: patch.nextStorageClassIdAfter,
		nextStoragePolicyId: patch.nextStoragePolicyIdAfter,
		nextResidentHomeSlotId: patch.nextResidentHomeSlotIdAfter,
		stationCapabilities,
		eqCapabilities,
		eqGroupQualifications,
		eqPortQualificationOverrides,
		storageClasses,
		storagePolicies,
		storageGroups,
		residentHomeSlots,
		vehicleProfile: patch.vehicleProfileAfter,
		review: patch.reviewAfter,
	});
}

export function reverseOperationalConfigurationPatch(
	patch: OperationalConfigurationPatch,
	current: OperationalConfigurationState,
): OperationalConfigurationPatch {
	const source = copyOperationalConfigurationState(current);
	const semanticChanged = operationalConfigurationPatchChangesContent(patch);
	const reversed = Object.freeze({
		baseConfigurationRevision: source.revision,
		configurationRevision: semanticChanged ? incrementRevision(source.revision) : source.revision,
		nextEqCapabilityIdBefore: source.nextEqCapabilityId,
		nextEqCapabilityIdAfter: source.nextEqCapabilityId,
		nextStorageClassIdBefore: source.nextStorageClassId,
		nextStorageClassIdAfter: source.nextStorageClassId,
		nextStoragePolicyIdBefore: source.nextStoragePolicyId,
		nextStoragePolicyIdAfter: source.nextStoragePolicyId,
		nextResidentHomeSlotIdBefore: source.nextResidentHomeSlotId,
		nextResidentHomeSlotIdAfter: source.nextResidentHomeSlotId,
		stationCapabilityChanges: reverseMutations(patch.stationCapabilityChanges),
		eqCapabilityChanges: reverseMutations(patch.eqCapabilityChanges),
		eqGroupQualificationChanges: reverseMutations(patch.eqGroupQualificationChanges),
		eqPortQualificationOverrideChanges: reverseMutations(patch.eqPortQualificationOverrideChanges),
		storageClassChanges: reverseMutations(patch.storageClassChanges),
		storagePolicyChanges: reverseMutations(patch.storagePolicyChanges),
		storageGroupChanges: reverseMutations(patch.storageGroupChanges),
		residentHomeSlotChanges: reverseMutations(patch.residentHomeSlotChanges),
		vehicleProfileBefore: source.vehicleProfile,
		vehicleProfileAfter: semanticChanged ? patch.vehicleProfileBefore : source.vehicleProfile,
		reviewBefore: source.review,
		reviewAfter: semanticChanged ? null : patch.reviewBefore,
	}) satisfies OperationalConfigurationPatch;
	applyOperationalConfigurationPatch(source, reversed);
	return reversed;
}

export function replayOperationalConfigurationPatch(
	patch: OperationalConfigurationPatch,
	current: OperationalConfigurationState,
): OperationalConfigurationPatch {
	const source = copyOperationalConfigurationState(current);
	const semanticChanged = operationalConfigurationPatchChangesContent(patch);
	const replayed = Object.freeze({
		baseConfigurationRevision: source.revision,
		configurationRevision: semanticChanged ? incrementRevision(source.revision) : source.revision,
		nextEqCapabilityIdBefore: source.nextEqCapabilityId,
		nextEqCapabilityIdAfter: Math.max(source.nextEqCapabilityId, patch.nextEqCapabilityIdAfter),
		nextStorageClassIdBefore: source.nextStorageClassId,
		nextStorageClassIdAfter: Math.max(source.nextStorageClassId, patch.nextStorageClassIdAfter),
		nextStoragePolicyIdBefore: source.nextStoragePolicyId,
		nextStoragePolicyIdAfter: Math.max(source.nextStoragePolicyId, patch.nextStoragePolicyIdAfter),
		nextResidentHomeSlotIdBefore: source.nextResidentHomeSlotId,
		nextResidentHomeSlotIdAfter: Math.max(
			source.nextResidentHomeSlotId,
			patch.nextResidentHomeSlotIdAfter,
		),
		stationCapabilityChanges: patch.stationCapabilityChanges,
		eqCapabilityChanges: patch.eqCapabilityChanges,
		eqGroupQualificationChanges: patch.eqGroupQualificationChanges,
		eqPortQualificationOverrideChanges: patch.eqPortQualificationOverrideChanges,
		storageClassChanges: patch.storageClassChanges,
		storagePolicyChanges: patch.storagePolicyChanges,
		storageGroupChanges: patch.storageGroupChanges,
		residentHomeSlotChanges: patch.residentHomeSlotChanges,
		vehicleProfileBefore: source.vehicleProfile,
		vehicleProfileAfter: semanticChanged ? patch.vehicleProfileAfter : source.vehicleProfile,
		reviewBefore: source.review,
		reviewAfter: semanticChanged ? null : patch.reviewAfter,
	}) satisfies OperationalConfigurationPatch;
	applyOperationalConfigurationPatch(source, replayed);
	return replayed;
}

export function operationalConfigurationPatchChangesContent(
	patch: OperationalConfigurationPatch,
): boolean {
	return (
		patch.stationCapabilityChanges.length > 0 ||
		patch.eqCapabilityChanges.length > 0 ||
		patch.eqGroupQualificationChanges.length > 0 ||
		patch.eqPortQualificationOverrideChanges.length > 0 ||
		patch.storageClassChanges.length > 0 ||
		patch.storagePolicyChanges.length > 0 ||
		patch.storageGroupChanges.length > 0 ||
		patch.residentHomeSlotChanges.length > 0 ||
		!vehicleProfileEquals(patch.vehicleProfileBefore, patch.vehicleProfileAfter)
	);
}

/** Fingerprint used by the mirrored undo ledger; monotonic revisions/cursors are intentionally out. */
export function operationalConfigurationPatchTransitionFingerprint(
	patch: OperationalConfigurationPatch | null | undefined,
	reverse = false,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["OPENFAB_OPERATIONAL_CONFIGURATION_PATCH_V2"]);
	if (!patch) {
		checksum.addNumber(0);
		return checksum.digest();
	}
	checksum.addNumber(1);
	addMutations(checksum, patch.stationCapabilityChanges, reverse, addStationCapability);
	addMutations(checksum, patch.eqCapabilityChanges, reverse, addLogicalDefinition);
	addMutations(checksum, patch.eqGroupQualificationChanges, reverse, addEqGroupQualification);
	addMutations(
		checksum,
		patch.eqPortQualificationOverrideChanges,
		reverse,
		addEqPortQualificationOverride,
	);
	addMutations(checksum, patch.storageClassChanges, reverse, addLogicalDefinition);
	addMutations(checksum, patch.storagePolicyChanges, reverse, addStoragePolicy);
	addMutations(checksum, patch.storageGroupChanges, reverse, addStorageGroup);
	addMutations(checksum, patch.residentHomeSlotChanges, reverse, addResidentHomeSlot);
	addVehicleProfile(checksum, reverse ? patch.vehicleProfileAfter : patch.vehicleProfileBefore);
	addVehicleProfile(checksum, reverse ? patch.vehicleProfileBefore : patch.vehicleProfileAfter);
	const semanticChanged = operationalConfigurationPatchChangesContent(patch);
	checksum.addNumber(semanticChanged ? 1 : 0);
	if (!semanticChanged) {
		addReview(checksum, reverse ? patch.reviewAfter : patch.reviewBefore);
		addReview(checksum, reverse ? patch.reviewBefore : patch.reviewAfter);
	}
	return checksum.digest();
}

function applyRecordMutations<T extends KeyedOperationalRecord>(
	current: readonly T[],
	changes: readonly OperationalRecordMutation<T>[],
	keyOf: KeySelector<T>,
	equals: Equality<T>,
	label: string,
): readonly T[] {
	if (!Array.isArray(changes)) throw new Error(`Operational ${label} changes must be an array.`);
	const records = new Map(current.map((record) => [keyOf(record), record]));
	let previousId = 0;
	for (const change of changes) {
		if (!change || !Number.isInteger(change.id) || change.id <= 0 || change.id > 0x7fffffff) {
			throw new Error(`Operational ${label} mutation ID is invalid.`);
		}
		if (change.id <= previousId) {
			throw new Error(`Operational ${label} mutations must be unique and ascending.`);
		}
		previousId = change.id;
		if (change.before === null && change.after === null) {
			throw new Error(`Operational ${label} mutation ${change.id} has no record.`);
		}
		if (
			(change.before !== null && keyOf(change.before) !== change.id) ||
			(change.after !== null && keyOf(change.after) !== change.id)
		) {
			throw new Error(`Operational ${label} mutation ${change.id} record identity is invalid.`);
		}
		const existing = records.get(change.id) ?? null;
		if (!equals(existing, change.before)) {
			throw new Error(`Operational ${label} mutation ${change.id} before-value mismatch.`);
		}
		if (equals(change.before, change.after)) {
			throw new Error(`Operational ${label} mutation ${change.id} is a no-op.`);
		}
		if (change.after === null) records.delete(change.id);
		else records.set(change.id, change.after);
	}
	return Object.freeze([...records.values()].sort((left, right) => keyOf(left) - keyOf(right)));
}

function diffRecords<T extends KeyedOperationalRecord>(
	before: readonly T[],
	after: readonly T[],
	keyOf: KeySelector<T>,
	equals: Equality<T>,
): readonly OperationalRecordMutation<T>[] {
	const beforeById = new Map(before.map((record) => [keyOf(record), record]));
	const afterById = new Map(after.map((record) => [keyOf(record), record]));
	const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort(
		(left, right) => left - right,
	);
	return Object.freeze(
		ids.flatMap((id) => {
			const oldRecord = beforeById.get(id) ?? null;
			const newRecord = afterById.get(id) ?? null;
			return equals(oldRecord, newRecord)
				? []
				: [Object.freeze({ id, before: oldRecord, after: newRecord })];
		}),
	);
}

function reverseMutations<T>(
	changes: readonly OperationalRecordMutation<T>[],
): readonly OperationalRecordMutation<T>[] {
	return Object.freeze(
		changes.map((change) =>
			Object.freeze({ id: change.id, before: change.after, after: change.before }),
		),
	);
}

function stationCapabilityEquals(
	left: OperationalStationCapabilityRecord | null,
	right: OperationalStationCapabilityRecord | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.portId === right.portId &&
			left.transferCapability === right.transferCapability)
	);
}

function logicalDefinitionEquals(
	left: OperationalLogicalDefinition | null,
	right: OperationalLogicalDefinition | null,
): boolean {
	return (
		left === right ||
		(left !== null && right !== null && left.id === right.id && left.key === right.key)
	);
}

function eqGroupQualificationEquals(
	left: OperationalEqGroupQualificationRecord | null,
	right: OperationalEqGroupQualificationRecord | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.equipmentGroupId === right.equipmentGroupId &&
			sameNumbers(left.capabilityIds, right.capabilityIds))
	);
}

function eqPortQualificationOverrideEquals(
	left: OperationalEqPortQualificationOverrideRecord | null,
	right: OperationalEqPortQualificationOverrideRecord | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.portId === right.portId &&
			sameNumbers(left.capabilityIds, right.capabilityIds))
	);
}

function storagePolicyEquals(
	left: OperationalStoragePolicyDefinition | null,
	right: OperationalStoragePolicyDefinition | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.id === right.id &&
			left.key === right.key &&
			left.storageClassId === right.storageClassId &&
			left.priorityRank === right.priorityRank &&
			left.minimumDwellMilliseconds === right.minimumDwellMilliseconds)
	);
}

function storageGroupEquals(
	left: OperationalStorageGroupConfigurationRecord | null,
	right: OperationalStorageGroupConfigurationRecord | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.equipmentGroupId === right.equipmentGroupId &&
			left.policyId === right.policyId &&
			left.capacityUnits === right.capacityUnits &&
			left.initialOccupiedUnits === right.initialOccupiedUnits &&
			left.highWaterMarkUnits === right.highWaterMarkUnits)
	);
}

function residentHomeSlotEquals(
	left: OperationalResidentHomeSlotRecord | null,
	right: OperationalResidentHomeSlotRecord | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.id === right.id &&
			left.vehicleId === right.vehicleId &&
			left.anchorPortId === right.anchorPortId &&
			left.policy === right.policy)
	);
}

function vehicleProfileEquals(
	left: OperationalVehicleReservationProfile | null,
	right: OperationalVehicleReservationProfile | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.id === right.id &&
			left.version === right.version &&
			left.bodyLengthMillimeters === right.bodyLengthMillimeters &&
			left.referenceToFrontMillimeters === right.referenceToFrontMillimeters &&
			left.referenceToRearMillimeters === right.referenceToRearMillimeters &&
			left.bodyWidthMillimeters === right.bodyWidthMillimeters &&
			left.lateralSafetyMarginMillimeters === right.lateralSafetyMarginMillimeters &&
			left.frontSafetyMarginMillimeters === right.frontSafetyMarginMillimeters &&
			left.rearSafetyMarginMillimeters === right.rearSafetyMarginMillimeters &&
			left.maximumSpeedMillimetersPerSecond === right.maximumSpeedMillimetersPerSecond &&
			left.controlReactionMilliseconds === right.controlReactionMilliseconds &&
			left.minimumServiceDecelerationMillimetersPerSecondSquared ===
				right.minimumServiceDecelerationMillimetersPerSecondSquared)
	);
}

function operationalReviewEquals(
	left: OperationalConfigurationReview | null,
	right: OperationalConfigurationReview | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.sourceRevision === right.sourceRevision &&
			left.sourceAuthoredChecksum === right.sourceAuthoredChecksum &&
			left.configurationFingerprint === right.configurationFingerprint)
	);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertCursorTransition(
	current: number,
	before: number,
	after: number,
	label: string,
): void {
	if (before !== current) {
		throw new Error(
			`Operational ${label} cursor mismatch: expected ${current}, received ${before}.`,
		);
	}
	assertNonDecreasingCursor(before, after, label);
}

function assertNonDecreasingCursor(before: number, after: number, label: string): void {
	if (!Number.isInteger(after) || after <= 0 || after > 0x7fffffff || after < before) {
		throw new Error(`Operational ${label} cursor cannot move backwards or leave int32 range.`);
	}
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`${label} must be a non-negative safe integer.`);
	}
}

function incrementRevision(revision: number): number {
	if (revision === Number.MAX_SAFE_INTEGER) {
		throw new Error("Operational configuration revision is exhausted.");
	}
	return revision + 1;
}

function addMutations<T>(
	checksum: OrderedTypedChecksum,
	changes: readonly OperationalRecordMutation<T>[],
	reverse: boolean,
	addRecord: (checksum: OrderedTypedChecksum, record: T | null) => void,
): void {
	checksum.addNumber(changes.length);
	for (const change of changes) {
		checksum.addNumber(change.id);
		addRecord(checksum, reverse ? change.after : change.before);
		addRecord(checksum, reverse ? change.before : change.after);
	}
}

function addStationCapability(
	checksum: OrderedTypedChecksum,
	record: OperationalStationCapabilityRecord | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([1, record.portId]);
	checksum.addString(record.transferCapability);
}

function addLogicalDefinition(
	checksum: OrderedTypedChecksum,
	record: OperationalLogicalDefinition | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([1, record.id]);
	checksum.addString(record.key);
}

function addEqGroupQualification(
	checksum: OrderedTypedChecksum,
	record: OperationalEqGroupQualificationRecord | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([1, record.equipmentGroupId, record.capabilityIds.length]);
	checksum.addNumbers(record.capabilityIds);
}

function addEqPortQualificationOverride(
	checksum: OrderedTypedChecksum,
	record: OperationalEqPortQualificationOverrideRecord | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([1, record.portId, record.capabilityIds.length]);
	checksum.addNumbers(record.capabilityIds);
}

function addStoragePolicy(
	checksum: OrderedTypedChecksum,
	record: OperationalStoragePolicyDefinition | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.storageClassId,
		record.priorityRank,
		record.minimumDwellMilliseconds,
	]);
	checksum.addString(record.key);
}

function addStorageGroup(
	checksum: OrderedTypedChecksum,
	record: OperationalStorageGroupConfigurationRecord | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([
		1,
		record.equipmentGroupId,
		record.policyId,
		record.capacityUnits,
		record.initialOccupiedUnits,
		record.highWaterMarkUnits,
	]);
}

function addResidentHomeSlot(
	checksum: OrderedTypedChecksum,
	record: OperationalResidentHomeSlotRecord | null,
): void {
	if (!record) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([1, record.id, record.anchorPortId]);
	checksum.addStrings([record.vehicleId, record.policy]);
}

function addVehicleProfile(
	checksum: OrderedTypedChecksum,
	profile: OperationalVehicleReservationProfile | null,
): void {
	if (!profile) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumber(1);
	checksum.addString(profile.id);
	checksum.addNumbers([
		profile.version,
		profile.bodyLengthMillimeters,
		profile.referenceToFrontMillimeters,
		profile.referenceToRearMillimeters,
		profile.bodyWidthMillimeters,
		profile.lateralSafetyMarginMillimeters,
		profile.frontSafetyMarginMillimeters,
		profile.rearSafetyMarginMillimeters,
		profile.maximumSpeedMillimetersPerSecond,
		profile.controlReactionMilliseconds,
		profile.minimumServiceDecelerationMillimetersPerSecondSquared,
	]);
}

function addReview(
	checksum: OrderedTypedChecksum,
	review: OperationalConfigurationReview | null,
): void {
	if (!review) {
		addAbsent(checksum);
		return;
	}
	checksum.addNumbers([1, review.sourceRevision]);
	checksum.addStrings([review.sourceAuthoredChecksum, review.configurationFingerprint]);
}

function addAbsent(checksum: OrderedTypedChecksum): void {
	checksum.addNumber(0);
}
