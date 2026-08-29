import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	checksumOperationalConfigurationState,
	collectOperationalConfigurationReadinessIssues,
	copyOperationalConfigurationState,
	OPERATIONAL_RESIDENT_HOME_SLOT_POLICY,
	type OperationalConfigurationReadinessIssue,
	type OperationalConfigurationSourceIdentity,
	type OperationalConfigurationState,
	type OperationalLogicalDefinition,
	type OperationalResidentHomeSlotRecord,
	type OperationalStationTransferCapability,
	type OperationalStorageGroupConfigurationRecord,
	type OperationalStoragePolicyDefinition,
	type OperationalVehicleReservationProfile,
} from "../core/OperationalConfiguration";

export const OPERATIONAL_CONFIGURATION_EDITOR_TABS = [
	"stations",
	"eq",
	"storage",
	"vehicle",
	"resident",
	"review",
] as const;

export type OperationalConfigurationEditorTab =
	(typeof OPERATIONAL_CONFIGURATION_EDITOR_TABS)[number];

export interface OperationalConfigurationEditorSummary {
	readonly issues: readonly OperationalConfigurationReadinessIssue[];
	readonly nonReviewIssues: readonly OperationalConfigurationReadinessIssue[];
	readonly draftDirty: boolean;
	readonly ready: boolean;
	readonly canAttachReview: boolean;
	readonly reviewCurrent: boolean;
}

export function summarizeOperationalConfigurationEditor(
	persisted: OperationalConfigurationState,
	draft: OperationalConfigurationState,
	portEquipment: PortEquipmentState,
	source: OperationalConfigurationSourceIdentity,
): OperationalConfigurationEditorSummary {
	const issues = collectOperationalConfigurationReadinessIssues(draft, portEquipment, source);
	const nonReviewIssues = issues.filter(
		(issue) => issue.code !== "REVIEW_REQUIRED" && issue.code !== "REVIEW_SOURCE_MISMATCH",
	);
	const draftDirty =
		checksumOperationalConfigurationState(persisted) !==
		checksumOperationalConfigurationState(draft);
	return Object.freeze({
		issues,
		nonReviewIssues: Object.freeze(nonReviewIssues),
		draftDirty,
		ready: issues.length === 0,
		canAttachReview: !draftDirty && nonReviewIssues.length === 0 && issues.length > 0,
		reviewCurrent: !draftDirty && issues.length === 0,
	});
}

export function replaceOperationalStationCapability(
	state: OperationalConfigurationState,
	portId: number,
	transferCapability: OperationalStationTransferCapability | null,
): OperationalConfigurationState {
	const records = state.stationCapabilities.filter((record) => record.portId !== portId);
	if (transferCapability) records.push({ portId, transferCapability });
	return semanticDraft({ ...state, stationCapabilities: records });
}

export function addOperationalEqCapability(
	state: OperationalConfigurationState,
	key: string,
): OperationalConfigurationState {
	const id = state.nextEqCapabilityId;
	return semanticDraft({
		...state,
		nextEqCapabilityId: incrementDefinitionCursor(id, "EQ capability"),
		eqCapabilities: [...state.eqCapabilities, { id, key }],
	});
}

export function renameOperationalEqCapability(
	state: OperationalConfigurationState,
	id: number,
	key: string,
): OperationalConfigurationState {
	return semanticDraft({
		...state,
		eqCapabilities: replaceLogicalDefinition(state.eqCapabilities, id, key, "EQ capability"),
	});
}

export function removeOperationalEqCapability(
	state: OperationalConfigurationState,
	id: number,
): OperationalConfigurationState {
	if (!state.eqCapabilities.some((definition) => definition.id === id)) {
		throw new Error(`EQ capability ${id} does not exist.`);
	}
	return semanticDraft({
		...state,
		eqCapabilities: state.eqCapabilities.filter((definition) => definition.id !== id),
		eqGroupQualifications: state.eqGroupQualifications.map((record) => ({
			...record,
			capabilityIds: record.capabilityIds.filter((capabilityId) => capabilityId !== id),
		})),
		eqPortQualificationOverrides: state.eqPortQualificationOverrides.map((record) => ({
			...record,
			capabilityIds: record.capabilityIds.filter((capabilityId) => capabilityId !== id),
		})),
	});
}

export function replaceOperationalEqGroupQualification(
	state: OperationalConfigurationState,
	equipmentGroupId: number,
	capabilityIds: readonly number[] | null,
): OperationalConfigurationState {
	const records = state.eqGroupQualifications.filter(
		(record) => record.equipmentGroupId !== equipmentGroupId,
	);
	if (capabilityIds) records.push({ equipmentGroupId, capabilityIds });
	return semanticDraft({ ...state, eqGroupQualifications: records });
}

export function replaceOperationalEqPortOverride(
	state: OperationalConfigurationState,
	portId: number,
	capabilityIds: readonly number[] | null,
): OperationalConfigurationState {
	const records = state.eqPortQualificationOverrides.filter((record) => record.portId !== portId);
	if (capabilityIds) records.push({ portId, capabilityIds });
	return semanticDraft({ ...state, eqPortQualificationOverrides: records });
}

export function addOperationalStorageClass(
	state: OperationalConfigurationState,
	key: string,
): OperationalConfigurationState {
	const id = state.nextStorageClassId;
	return semanticDraft({
		...state,
		nextStorageClassId: incrementDefinitionCursor(id, "storage class"),
		storageClasses: [...state.storageClasses, { id, key }],
	});
}

export function renameOperationalStorageClass(
	state: OperationalConfigurationState,
	id: number,
	key: string,
): OperationalConfigurationState {
	return semanticDraft({
		...state,
		storageClasses: replaceLogicalDefinition(state.storageClasses, id, key, "storage class"),
	});
}

export function operationalStorageClassRemovalReason(
	state: OperationalConfigurationState,
	id: number,
): string | null {
	return state.storagePolicies.some((policy) => policy.storageClassId === id)
		? "이 클래스를 사용하는 저장 정책을 먼저 변경하거나 삭제하세요."
		: null;
}

export function removeOperationalStorageClass(
	state: OperationalConfigurationState,
	id: number,
): OperationalConfigurationState {
	const reason = operationalStorageClassRemovalReason(state, id);
	if (reason) throw new Error(reason);
	if (!state.storageClasses.some((definition) => definition.id === id)) {
		throw new Error(`Storage class ${id} does not exist.`);
	}
	return semanticDraft({
		...state,
		storageClasses: state.storageClasses.filter((definition) => definition.id !== id),
	});
}

export interface OperationalStoragePolicyInput {
	readonly key: string;
	readonly storageClassId: number;
	readonly priorityRank: number;
	readonly minimumDwellMilliseconds: number;
}

export function addOperationalStoragePolicy(
	state: OperationalConfigurationState,
	input: OperationalStoragePolicyInput,
): OperationalConfigurationState {
	const id = state.nextStoragePolicyId;
	return semanticDraft({
		...state,
		nextStoragePolicyId: incrementDefinitionCursor(id, "storage policy"),
		storagePolicies: [...state.storagePolicies, { id, ...input }],
	});
}

export function replaceOperationalStoragePolicy(
	state: OperationalConfigurationState,
	policy: OperationalStoragePolicyDefinition,
): OperationalConfigurationState {
	if (!state.storagePolicies.some((candidate) => candidate.id === policy.id)) {
		throw new Error(`Storage policy ${policy.id} does not exist.`);
	}
	return semanticDraft({
		...state,
		storagePolicies: state.storagePolicies.map((candidate) =>
			candidate.id === policy.id ? policy : candidate,
		),
	});
}

export function removeOperationalStoragePolicy(
	state: OperationalConfigurationState,
	id: number,
): OperationalConfigurationState {
	if (!state.storagePolicies.some((policy) => policy.id === id)) {
		throw new Error(`Storage policy ${id} does not exist.`);
	}
	return semanticDraft({
		...state,
		storagePolicies: state.storagePolicies.filter((policy) => policy.id !== id),
		storageGroups: state.storageGroups.filter((record) => record.policyId !== id),
	});
}

export function replaceOperationalStorageGroup(
	state: OperationalConfigurationState,
	record: OperationalStorageGroupConfigurationRecord | null,
	equipmentGroupId: number,
): OperationalConfigurationState {
	if (record && record.equipmentGroupId !== equipmentGroupId) {
		throw new Error("Storage group record identity does not match its physical group.");
	}
	const records = state.storageGroups.filter(
		(candidate) => candidate.equipmentGroupId !== equipmentGroupId,
	);
	if (record) records.push(record);
	return semanticDraft({ ...state, storageGroups: records });
}

export function replaceOperationalVehicleProfile(
	state: OperationalConfigurationState,
	profile: OperationalVehicleReservationProfile | null,
): OperationalConfigurationState {
	return semanticDraft({ ...state, vehicleProfile: profile });
}

export function addOperationalResidentHomeSlot(
	state: OperationalConfigurationState,
	vehicleId: string,
	anchorPortId: number,
): OperationalConfigurationState {
	const id = state.nextResidentHomeSlotId;
	return semanticDraft({
		...state,
		nextResidentHomeSlotId: incrementDefinitionCursor(id, "resident home slot"),
		residentHomeSlots: [
			...state.residentHomeSlots,
			{ id, vehicleId, anchorPortId, policy: OPERATIONAL_RESIDENT_HOME_SLOT_POLICY },
		],
	});
}

export function replaceOperationalResidentHomeSlot(
	state: OperationalConfigurationState,
	record: OperationalResidentHomeSlotRecord,
): OperationalConfigurationState {
	if (!state.residentHomeSlots.some((candidate) => candidate.id === record.id)) {
		throw new Error(`Resident home slot ${record.id} does not exist.`);
	}
	return semanticDraft({
		...state,
		residentHomeSlots: state.residentHomeSlots.map((candidate) =>
			candidate.id === record.id ? record : candidate,
		),
	});
}

export function removeOperationalResidentHomeSlot(
	state: OperationalConfigurationState,
	id: number,
): OperationalConfigurationState {
	if (!state.residentHomeSlots.some((record) => record.id === id)) {
		throw new Error(`Resident home slot ${id} does not exist.`);
	}
	return semanticDraft({
		...state,
		residentHomeSlots: state.residentHomeSlots.filter((record) => record.id !== id),
	});
}

function semanticDraft(state: OperationalConfigurationState): OperationalConfigurationState {
	return copyOperationalConfigurationState({ ...state, review: null });
}

function replaceLogicalDefinition(
	definitions: readonly OperationalLogicalDefinition[],
	id: number,
	key: string,
	label: string,
): readonly OperationalLogicalDefinition[] {
	if (!definitions.some((definition) => definition.id === id)) {
		throw new Error(`${label} ${id} does not exist.`);
	}
	return definitions.map((definition) => (definition.id === id ? { id, key } : definition));
}

function incrementDefinitionCursor(cursor: number, label: string): number {
	if (cursor >= 0x7fffffff) throw new Error(`${label} ID cursor is exhausted.`);
	return cursor + 1;
}
