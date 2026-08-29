import type { PortEquipmentState } from "./EquipmentGroup";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import { isPositiveRecordId } from "./PortRecord";

export const OPERATIONAL_CONFIGURATION_SCHEMA_VERSION = 2 as const;
export const OPERATIONAL_CONFIGURATION_LEGACY_SCHEMA_VERSION = 1 as const;
export const OPERATIONAL_RESIDENT_HOME_SLOT_POLICY = "DEDICATED_HOME_RETURN" as const;
export const OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT = 8_192;

export const OPERATIONAL_STATION_TRANSFER_CAPABILITIES = [
	"PICKUP_ONLY",
	"DROPOFF_ONLY",
	"BIDIRECTIONAL",
] as const;

export type OperationalStationTransferCapability =
	(typeof OPERATIONAL_STATION_TRANSFER_CAPABILITIES)[number];

export interface OperationalStationCapabilityRecord {
	readonly portId: number;
	readonly transferCapability: OperationalStationTransferCapability;
}

export interface OperationalLogicalDefinition {
	readonly id: number;
	readonly key: string;
}

export interface OperationalEqGroupQualificationRecord {
	readonly equipmentGroupId: number;
	readonly capabilityIds: readonly number[];
}

export interface OperationalEqPortQualificationOverrideRecord {
	readonly portId: number;
	readonly capabilityIds: readonly number[];
}

export interface OperationalStoragePolicyDefinition extends OperationalLogicalDefinition {
	readonly storageClassId: number;
	/** Zero is the highest dispatch priority; larger ranks are served later. */
	readonly priorityRank: number;
	readonly minimumDwellMilliseconds: number;
}

export interface OperationalStorageGroupConfigurationRecord {
	readonly equipmentGroupId: number;
	readonly policyId: number;
	readonly capacityUnits: number;
	readonly initialOccupiedUnits: number;
	readonly highWaterMarkUnits: number;
}

export interface OperationalResidentHomeSlotRecord {
	readonly id: number;
	readonly vehicleId: string;
	readonly anchorPortId: number;
	readonly policy: typeof OPERATIONAL_RESIDENT_HOME_SLOT_POLICY;
}

export interface OperationalVehicleReservationProfile {
	readonly id: string;
	readonly version: number;
	readonly bodyLengthMillimeters: number;
	readonly referenceToFrontMillimeters: number;
	readonly referenceToRearMillimeters: number;
	readonly bodyWidthMillimeters: number;
	readonly lateralSafetyMarginMillimeters: number;
	readonly frontSafetyMarginMillimeters: number;
	readonly rearSafetyMarginMillimeters: number;
	readonly maximumSpeedMillimetersPerSecond: number;
	readonly controlReactionMilliseconds: number;
	readonly minimumServiceDecelerationMillimetersPerSecondSquared: number;
}

/**
 * A user review binds explicit configuration content to one authored static source.
 * Runtime request/generation isolation remains the responsibility of the readiness Worker bridge.
 */
export interface OperationalConfigurationReview {
	readonly sourceRevision: number;
	readonly sourceAuthoredChecksum: string;
	readonly configurationFingerprint: string;
}

export interface OperationalConfigurationState {
	readonly schemaVersion: typeof OPERATIONAL_CONFIGURATION_SCHEMA_VERSION;
	/** Increments only when configuration content changes; attaching a review does not change it. */
	readonly revision: number;
	readonly nextEqCapabilityId: number;
	readonly nextStorageClassId: number;
	readonly nextStoragePolicyId: number;
	readonly nextResidentHomeSlotId: number;
	readonly stationCapabilities: readonly OperationalStationCapabilityRecord[];
	readonly eqCapabilities: readonly OperationalLogicalDefinition[];
	readonly eqGroupQualifications: readonly OperationalEqGroupQualificationRecord[];
	readonly eqPortQualificationOverrides: readonly OperationalEqPortQualificationOverrideRecord[];
	readonly storageClasses: readonly OperationalLogicalDefinition[];
	readonly storagePolicies: readonly OperationalStoragePolicyDefinition[];
	readonly storageGroups: readonly OperationalStorageGroupConfigurationRecord[];
	readonly residentHomeSlots: readonly OperationalResidentHomeSlotRecord[];
	/** Null is an explicit unresolved draft, never a product default. */
	readonly vehicleProfile: OperationalVehicleReservationProfile | null;
	/** Null means the current content/source has not been reviewed. */
	readonly review: OperationalConfigurationReview | null;
}

export interface OperationalConfigurationSourceIdentity {
	readonly revision: number;
	readonly authoredChecksum: string;
}

export const OPERATIONAL_CONFIGURATION_READINESS_ISSUE_CODES = [
	"CONFIGURATION_INVALID",
	"STATION_CAPABILITY_MISSING",
	"STATION_CAPABILITY_FOREIGN",
	"EQ_GROUP_QUALIFICATION_MISSING",
	"EQ_GROUP_QUALIFICATION_FOREIGN_OR_WRONG_KIND",
	"EQ_PORT_OVERRIDE_FOREIGN_OR_WRONG_KIND",
	"STORAGE_GROUP_CONFIGURATION_MISSING",
	"STORAGE_GROUP_CONFIGURATION_FOREIGN_OR_WRONG_KIND",
	"RESIDENT_HOME_SLOT_FOREIGN",
	"VEHICLE_PROFILE_MISSING",
	"REVIEW_REQUIRED",
	"REVIEW_SOURCE_MISMATCH",
] as const;

export type OperationalConfigurationReadinessIssueCode =
	(typeof OPERATIONAL_CONFIGURATION_READINESS_ISSUE_CODES)[number];

export interface OperationalConfigurationReadinessIssue {
	readonly code: OperationalConfigurationReadinessIssueCode;
	readonly message: string;
	readonly portIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
}

export function emptyOperationalConfigurationState(): OperationalConfigurationState {
	return Object.freeze({
		schemaVersion: OPERATIONAL_CONFIGURATION_SCHEMA_VERSION,
		revision: 0,
		nextEqCapabilityId: 1,
		nextStorageClassId: 1,
		nextStoragePolicyId: 1,
		nextResidentHomeSlotId: 1,
		stationCapabilities: Object.freeze([]),
		eqCapabilities: Object.freeze([]),
		eqGroupQualifications: Object.freeze([]),
		eqPortQualificationOverrides: Object.freeze([]),
		storageClasses: Object.freeze([]),
		storagePolicies: Object.freeze([]),
		storageGroups: Object.freeze([]),
		residentHomeSlots: Object.freeze([]),
		vehicleProfile: null,
		review: null,
	});
}

/** Canonical immutable copy used at every document, persistence, and Worker boundary. */
export function copyOperationalConfigurationState(
	state: OperationalConfigurationState,
): OperationalConfigurationState {
	if (!isRecord(state)) throw new TypeError("operational configuration must be an object");
	const copyWithoutReview = Object.freeze({
		schemaVersion: state.schemaVersion,
		revision: state.revision,
		nextEqCapabilityId: state.nextEqCapabilityId,
		nextStorageClassId: state.nextStorageClassId,
		nextStoragePolicyId: state.nextStoragePolicyId,
		nextResidentHomeSlotId: state.nextResidentHomeSlotId,
		stationCapabilities: copyAndSortRecords(
			state.stationCapabilities,
			copyStationCapability,
			(left, right) => left.portId - right.portId,
			"station capabilities",
		),
		eqCapabilities: copyAndSortRecords(
			state.eqCapabilities,
			copyLogicalDefinition,
			compareLogicalDefinitions,
			"EQ capabilities",
		),
		eqGroupQualifications: copyAndSortRecords(
			state.eqGroupQualifications,
			copyEqGroupQualification,
			(left, right) => left.equipmentGroupId - right.equipmentGroupId,
			"EQ group qualifications",
		),
		eqPortQualificationOverrides: copyAndSortRecords(
			state.eqPortQualificationOverrides,
			copyEqPortQualificationOverride,
			(left, right) => left.portId - right.portId,
			"EQ port qualification overrides",
		),
		storageClasses: copyAndSortRecords(
			state.storageClasses,
			copyLogicalDefinition,
			compareLogicalDefinitions,
			"storage classes",
		),
		storagePolicies: copyAndSortRecords(
			state.storagePolicies,
			copyStoragePolicy,
			(left, right) => left.id - right.id,
			"storage policies",
		),
		storageGroups: copyAndSortRecords(
			state.storageGroups,
			copyStorageGroup,
			(left, right) => left.equipmentGroupId - right.equipmentGroupId,
			"storage groups",
		),
		residentHomeSlots: copyAndSortRecords(
			state.residentHomeSlots,
			copyResidentHomeSlot,
			(left, right) => left.id - right.id,
			"resident home slots",
		),
		vehicleProfile: state.vehicleProfile ? copyVehicleProfile(state.vehicleProfile) : null,
	});
	const copy = Object.freeze({
		...copyWithoutReview,
		review: state.review
			? Object.freeze({
					sourceRevision: state.review.sourceRevision,
					sourceAuthoredChecksum: state.review.sourceAuthoredChecksum,
					configurationFingerprint: state.review.configurationFingerprint,
				})
			: null,
	}) satisfies OperationalConfigurationState;
	const error = operationalConfigurationStateError(copy);
	if (error) throw new TypeError(error);
	return copy;
}

export function operationalConfigurationStateError(value: unknown): string | null {
	if (!isRecord(value)) return "operational configuration must be an object";
	if (value.schemaVersion !== OPERATIONAL_CONFIGURATION_SCHEMA_VERSION) {
		return "operational configuration schema version is invalid";
	}
	if (!isNonNegativeSafeInteger(value.revision)) {
		return "operational configuration revision must be a non-negative safe integer";
	}
	for (const [label, cursor] of [
		["next EQ capability", value.nextEqCapabilityId],
		["next storage class", value.nextStorageClassId],
		["next storage policy", value.nextStoragePolicyId],
		["next resident home slot", value.nextResidentHomeSlotId],
	] as const) {
		if (!isPositiveRecordId(cursor as number)) return `${label} ID cursor is invalid`;
	}
	if (!Array.isArray(value.stationCapabilities)) return "station capabilities must be an array";
	if (!Array.isArray(value.eqCapabilities)) return "EQ capabilities must be an array";
	if (!Array.isArray(value.eqGroupQualifications)) {
		return "EQ group qualifications must be an array";
	}
	if (!Array.isArray(value.eqPortQualificationOverrides)) {
		return "EQ port qualification overrides must be an array";
	}
	if (!Array.isArray(value.storageClasses)) return "storage classes must be an array";
	if (!Array.isArray(value.storagePolicies)) return "storage policies must be an array";
	if (!Array.isArray(value.storageGroups)) return "storage groups must be an array";
	if (!Array.isArray(value.residentHomeSlots)) return "resident home slots must be an array";

	const stationPortIds = new Set<number>();
	for (const record of value.stationCapabilities) {
		if (!isRecord(record) || !isPositiveRecordId(record.portId as number)) {
			return "station capability port ID is invalid";
		}
		if (
			typeof record.transferCapability !== "string" ||
			!OPERATIONAL_STATION_TRANSFER_CAPABILITIES.includes(
				record.transferCapability as OperationalStationTransferCapability,
			)
		) {
			return `station capability for port ${record.portId as number} is invalid`;
		}
		if (stationPortIds.has(record.portId as number)) {
			return `station capability repeats port ${record.portId as number}`;
		}
		stationPortIds.add(record.portId as number);
	}

	const eqCapabilityError = logicalDefinitionsError(value.eqCapabilities, "EQ capability");
	if (eqCapabilityError) return eqCapabilityError;
	const eqCapabilityIds = new Set(
		(value.eqCapabilities as unknown as OperationalLogicalDefinition[]).map((record) => record.id),
	);
	const eqGroupIds = new Set<number>();
	for (const record of value.eqGroupQualifications) {
		if (!isRecord(record) || !isPositiveRecordId(record.equipmentGroupId as number)) {
			return "EQ group qualification equipment-group ID is invalid";
		}
		if (eqGroupIds.has(record.equipmentGroupId as number)) {
			return `EQ group qualification repeats group ${record.equipmentGroupId as number}`;
		}
		const referenceError = referenceIdsError(
			record.capabilityIds,
			eqCapabilityIds,
			"EQ capability",
		);
		if (referenceError) return referenceError;
		eqGroupIds.add(record.equipmentGroupId as number);
	}
	const overridePortIds = new Set<number>();
	for (const record of value.eqPortQualificationOverrides) {
		if (!isRecord(record) || !isPositiveRecordId(record.portId as number)) {
			return "EQ port qualification override port ID is invalid";
		}
		if (overridePortIds.has(record.portId as number)) {
			return `EQ port qualification override repeats port ${record.portId as number}`;
		}
		const referenceError = referenceIdsError(
			record.capabilityIds,
			eqCapabilityIds,
			"EQ capability",
		);
		if (referenceError) return referenceError;
		overridePortIds.add(record.portId as number);
	}

	const storageClassError = logicalDefinitionsError(value.storageClasses, "storage class");
	if (storageClassError) return storageClassError;
	const storageClassIds = new Set(
		(value.storageClasses as unknown as OperationalLogicalDefinition[]).map((record) => record.id),
	);
	const storagePolicyError = storagePoliciesError(value.storagePolicies, storageClassIds);
	if (storagePolicyError) return storagePolicyError;
	const storagePolicyIds = new Set(
		(value.storagePolicies as unknown as OperationalStoragePolicyDefinition[]).map(
			(record) => record.id,
		),
	);
	const storageGroupIds = new Set<number>();
	for (const record of value.storageGroups) {
		if (!isRecord(record) || !isPositiveRecordId(record.equipmentGroupId as number)) {
			return "storage configuration equipment-group ID is invalid";
		}
		const groupId = record.equipmentGroupId as number;
		if (storageGroupIds.has(groupId)) return `storage configuration repeats group ${groupId}`;
		if (eqGroupIds.has(groupId)) {
			return `equipment group ${groupId} cannot have both EQ and storage configuration`;
		}
		if (!storagePolicyIds.has(record.policyId as number)) {
			return `storage group ${groupId} references an unknown policy`;
		}
		if (!isPositiveUint32(record.capacityUnits)) {
			return `storage group ${groupId} capacity is invalid`;
		}
		if (
			!isUint32(record.initialOccupiedUnits) ||
			(record.initialOccupiedUnits as number) > (record.capacityUnits as number)
		) {
			return `storage group ${groupId} initial occupancy exceeds capacity`;
		}
		if (
			!isUint32(record.highWaterMarkUnits) ||
			(record.highWaterMarkUnits as number) > (record.capacityUnits as number)
		) {
			return `storage group ${groupId} high-water mark exceeds capacity`;
		}
		storageGroupIds.add(groupId);
	}
	if (value.vehicleProfile !== null) {
		const profileError = operationalVehicleReservationProfileError(value.vehicleProfile);
		if (profileError) return profileError;
	}
	if (
		(value.residentHomeSlots as readonly unknown[]).length > OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT
	) {
		return "resident home slot count exceeds the operational limit";
	}
	const residentSlotIds = new Set<number>();
	const residentVehicleIds = new Set<string>();
	const residentAnchorPortIds = new Set<number>();
	for (const record of value.residentHomeSlots) {
		if (!isRecord(record) || !isPositiveRecordId(record.id as number)) {
			return "resident home slot ID is invalid";
		}
		if (!isPortableVehicleId(record.vehicleId)) {
			return `resident home slot ${record.id as number} vehicle ID is invalid`;
		}
		if (!isPositiveRecordId(record.anchorPortId as number)) {
			return `resident home slot ${record.id as number} anchor port ID is invalid`;
		}
		if (record.policy !== OPERATIONAL_RESIDENT_HOME_SLOT_POLICY) {
			return `resident home slot ${record.id as number} policy is invalid`;
		}
		if (residentSlotIds.has(record.id as number)) return "resident home slot ID is duplicated";
		if (residentVehicleIds.has(record.vehicleId as string)) {
			return "resident home slot vehicle ID is duplicated";
		}
		if (residentAnchorPortIds.has(record.anchorPortId as number)) {
			return "resident home slot anchor port ID is duplicated";
		}
		residentSlotIds.add(record.id as number);
		residentVehicleIds.add(record.vehicleId as string);
		residentAnchorPortIds.add(record.anchorPortId as number);
	}

	const maximumEqCapabilityId = maximumId(value.eqCapabilities as OperationalLogicalDefinition[]);
	const maximumStorageClassId = maximumId(value.storageClasses as OperationalLogicalDefinition[]);
	const maximumStoragePolicyId = maximumId(
		value.storagePolicies as OperationalStoragePolicyDefinition[],
	);
	const maximumResidentHomeSlotId = maximumId(
		value.residentHomeSlots as OperationalResidentHomeSlotRecord[],
	);
	if ((value.nextEqCapabilityId as number) <= maximumEqCapabilityId) {
		return "next EQ capability ID cursor must exceed every definition ID";
	}
	if ((value.nextStorageClassId as number) <= maximumStorageClassId) {
		return "next storage class ID cursor must exceed every definition ID";
	}
	if ((value.nextStoragePolicyId as number) <= maximumStoragePolicyId) {
		return "next storage policy ID cursor must exceed every definition ID";
	}
	if ((value.nextResidentHomeSlotId as number) <= maximumResidentHomeSlotId) {
		return "next resident home slot ID cursor must exceed every slot ID";
	}

	if (value.review !== null) {
		if (!isRecord(value.review))
			return "operational configuration review must be an object or null";
		if (!isNonNegativeSafeInteger(value.review.sourceRevision)) {
			return "operational configuration review source revision is invalid";
		}
		if (!isNonEmptyString(value.review.sourceAuthoredChecksum)) {
			return "operational configuration review source checksum is invalid";
		}
		if (!isNonEmptyString(value.review.configurationFingerprint)) {
			return "operational configuration review fingerprint is invalid";
		}
		try {
			if (
				checksumOperationalConfiguration(value as unknown as OperationalConfigurationState) !==
				value.review.configurationFingerprint
			) {
				return "operational configuration review does not match current configuration content";
			}
		} catch {
			return "operational configuration fingerprint cannot be recomputed";
		}
	}
	return null;
}

export function operationalVehicleReservationProfileError(value: unknown): string | null {
	if (!isRecord(value) || !isPortableKey(value.id)) {
		return "vehicle reservation profile identity is invalid";
	}
	if (!isPositiveUint32(value.version)) return "vehicle reservation profile version is invalid";
	for (const [label, field, positive] of [
		["body length", value.bodyLengthMillimeters, true],
		["reference-to-front", value.referenceToFrontMillimeters, false],
		["reference-to-rear", value.referenceToRearMillimeters, false],
		["body width", value.bodyWidthMillimeters, true],
		["lateral safety margin", value.lateralSafetyMarginMillimeters, false],
		["front safety margin", value.frontSafetyMarginMillimeters, false],
		["rear safety margin", value.rearSafetyMarginMillimeters, false],
		["maximum speed", value.maximumSpeedMillimetersPerSecond, true],
		["control reaction", value.controlReactionMilliseconds, false],
		[
			"minimum service deceleration",
			value.minimumServiceDecelerationMillimetersPerSecondSquared,
			true,
		],
	] as const) {
		if (positive ? !isPositiveUint32(field) : !isUint32(field)) {
			return `vehicle reservation profile ${label} is invalid`;
		}
	}
	if (
		(value.referenceToFrontMillimeters as number) + (value.referenceToRearMillimeters as number) !==
		(value.bodyLengthMillimeters as number)
	) {
		return "vehicle front and rear reference offsets must sum to body length";
	}
	const speed = value.maximumSpeedMillimetersPerSecond as number;
	const reaction = Math.ceil((speed * (value.controlReactionMilliseconds as number)) / 1_000);
	const braking = Math.ceil(
		(speed * speed) / (2 * (value.minimumServiceDecelerationMillimetersPerSecondSquared as number)),
	);
	for (const derived of [
		reaction,
		braking,
		(value.referenceToFrontMillimeters as number) +
			(value.frontSafetyMarginMillimeters as number) +
			reaction +
			braking,
		(value.referenceToRearMillimeters as number) + (value.rearSafetyMarginMillimeters as number),
		Math.ceil((value.bodyWidthMillimeters as number) / 2) +
			(value.lateralSafetyMarginMillimeters as number),
	]) {
		if (!isUint32(derived)) return "vehicle reservation profile derived distance exceeds uint32";
	}
	return null;
}

/** Fingerprints configuration content only; review metadata cannot attest to itself. */
export function checksumOperationalConfiguration(state: OperationalConfigurationState): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		state.schemaVersion,
		state.revision,
		state.nextEqCapabilityId,
		state.nextStorageClassId,
		state.nextStoragePolicyId,
		state.nextResidentHomeSlotId,
		state.stationCapabilities.length,
		state.eqCapabilities.length,
		state.eqGroupQualifications.length,
		state.eqPortQualificationOverrides.length,
		state.storageClasses.length,
		state.storagePolicies.length,
		state.storageGroups.length,
		state.residentHomeSlots.length,
		state.vehicleProfile ? 1 : 0,
	]);
	for (const record of state.stationCapabilities) {
		checksum.addNumber(record.portId);
		checksum.addCachedString(record.transferCapability);
	}
	for (const definition of state.eqCapabilities) addLogicalDefinition(checksum, definition);
	for (const record of state.eqGroupQualifications) {
		checksum.addNumber(record.equipmentGroupId);
		checksum.addNumbers(record.capabilityIds);
	}
	for (const record of state.eqPortQualificationOverrides) {
		checksum.addNumber(record.portId);
		checksum.addNumbers(record.capabilityIds);
	}
	for (const definition of state.storageClasses) addLogicalDefinition(checksum, definition);
	for (const definition of state.storagePolicies) {
		addLogicalDefinition(checksum, definition);
		checksum.addNumbers([
			definition.storageClassId,
			definition.priorityRank,
			definition.minimumDwellMilliseconds,
		]);
	}
	for (const record of state.storageGroups) {
		checksum.addNumbers([
			record.equipmentGroupId,
			record.policyId,
			record.capacityUnits,
			record.initialOccupiedUnits,
			record.highWaterMarkUnits,
		]);
	}
	for (const record of state.residentHomeSlots) {
		checksum.addNumbers([record.id, record.anchorPortId]);
		checksum.addStrings([record.vehicleId, record.policy]);
	}
	if (state.vehicleProfile) {
		checksum.addString(state.vehicleProfile.id);
		checksum.addNumbers([
			state.vehicleProfile.version,
			state.vehicleProfile.bodyLengthMillimeters,
			state.vehicleProfile.referenceToFrontMillimeters,
			state.vehicleProfile.referenceToRearMillimeters,
			state.vehicleProfile.bodyWidthMillimeters,
			state.vehicleProfile.lateralSafetyMarginMillimeters,
			state.vehicleProfile.frontSafetyMarginMillimeters,
			state.vehicleProfile.rearSafetyMarginMillimeters,
			state.vehicleProfile.maximumSpeedMillimetersPerSecond,
			state.vehicleProfile.controlReactionMilliseconds,
			state.vehicleProfile.minimumServiceDecelerationMillimetersPerSecondSquared,
		]);
	}
	return checksum.digest();
}

/** Fingerprints the complete persisted/mirrored state, including its source-bound review. */
export function checksumOperationalConfigurationState(
	state: OperationalConfigurationState,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"OPENFAB_OPERATIONAL_CONFIGURATION_STATE_V2",
		checksumOperationalConfiguration(state),
	]);
	if (!state.review) {
		checksum.addNumber(0);
		return checksum.digest();
	}
	checksum.addNumbers([1, state.review.sourceRevision]);
	checksum.addStrings([state.review.sourceAuthoredChecksum, state.review.configurationFingerprint]);
	return checksum.digest();
}

export function reviewOperationalConfiguration(
	state: OperationalConfigurationState,
	source: OperationalConfigurationSourceIdentity,
): OperationalConfigurationState {
	const canonical = copyOperationalConfigurationState(state);
	if (!isNonNegativeSafeInteger(source.revision) || !isNonEmptyString(source.authoredChecksum)) {
		throw new TypeError("operational configuration review source identity is invalid");
	}
	return Object.freeze({
		...canonical,
		review: Object.freeze({
			sourceRevision: source.revision,
			sourceAuthoredChecksum: source.authoredChecksum,
			configurationFingerprint: checksumOperationalConfiguration(canonical),
		}),
	});
}

export function invalidateOperationalConfigurationReview(
	state: OperationalConfigurationState,
): OperationalConfigurationState {
	const canonical = copyOperationalConfigurationState(state);
	return canonical.review === null ? canonical : Object.freeze({ ...canonical, review: null });
}

/**
 * Reports unresolved or foreign references without manufacturing physical policy defaults.
 * Intrinsically valid drafts are intentionally persistable while every issue keeps readiness closed.
 */
export function collectOperationalConfigurationReadinessIssues(
	state: OperationalConfigurationState,
	portEquipment: PortEquipmentState,
	source: OperationalConfigurationSourceIdentity,
): readonly OperationalConfigurationReadinessIssue[] {
	const stateError = operationalConfigurationStateError(state);
	if (stateError) {
		return Object.freeze([issue("CONFIGURATION_INVALID", stateError)]);
	}
	const issues: OperationalConfigurationReadinessIssue[] = [];
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	const groupsById = new Map(portEquipment.equipmentGroups.map((group) => [group.id, group]));
	const stationCapabilityPortIds = new Set(
		state.stationCapabilities.map((record) => record.portId),
	);
	const eqGroupIds = new Set(state.eqGroupQualifications.map((record) => record.equipmentGroupId));
	const storageGroupIds = new Set(state.storageGroups.map((record) => record.equipmentGroupId));

	const missingStationPortIds = portEquipment.ports
		.filter((port) => !stationCapabilityPortIds.has(port.id))
		.map((port) => port.id);
	if (missingStationPortIds.length > 0) {
		issues.push(
			issue(
				"STATION_CAPABILITY_MISSING",
				"Every persistent port requires an explicit transfer capability.",
				missingStationPortIds,
			),
		);
	}
	const foreignStationPortIds = state.stationCapabilities
		.filter((record) => !portsById.has(record.portId))
		.map((record) => record.portId);
	if (foreignStationPortIds.length > 0) {
		issues.push(
			issue(
				"STATION_CAPABILITY_FOREIGN",
				"Station capability records reference ports outside the current project.",
				foreignStationPortIds,
			),
		);
	}

	const missingEqGroupIds = portEquipment.equipmentGroups
		.filter((group) => group.kind === "EQ" && !eqGroupIds.has(group.id))
		.map((group) => group.id);
	if (missingEqGroupIds.length > 0) {
		issues.push(
			issue(
				"EQ_GROUP_QUALIFICATION_MISSING",
				"Every physical EQ group requires an explicit qualification set.",
				[],
				missingEqGroupIds,
			),
		);
	}
	const invalidEqGroupIds = state.eqGroupQualifications
		.filter((record) => groupsById.get(record.equipmentGroupId)?.kind !== "EQ")
		.map((record) => record.equipmentGroupId);
	if (invalidEqGroupIds.length > 0) {
		issues.push(
			issue(
				"EQ_GROUP_QUALIFICATION_FOREIGN_OR_WRONG_KIND",
				"EQ qualification records must reference current EQ groups.",
				[],
				invalidEqGroupIds,
			),
		);
	}
	const invalidOverridePortIds = state.eqPortQualificationOverrides
		.filter((record) => portsById.get(record.portId)?.portType !== "EQ")
		.map((record) => record.portId);
	if (invalidOverridePortIds.length > 0) {
		issues.push(
			issue(
				"EQ_PORT_OVERRIDE_FOREIGN_OR_WRONG_KIND",
				"EQ port overrides must reference current EQ ports.",
				invalidOverridePortIds,
			),
		);
	}

	const missingStorageGroupIds = portEquipment.equipmentGroups
		.filter((group) => group.kind !== "EQ" && !storageGroupIds.has(group.id))
		.map((group) => group.id);
	if (missingStorageGroupIds.length > 0) {
		issues.push(
			issue(
				"STORAGE_GROUP_CONFIGURATION_MISSING",
				"Every physical OHB/STK group requires explicit storage resource settings.",
				[],
				missingStorageGroupIds,
			),
		);
	}
	const invalidStorageGroupIds = state.storageGroups
		.filter((record) => {
			const kind = groupsById.get(record.equipmentGroupId)?.kind;
			return kind === undefined || kind === "EQ";
		})
		.map((record) => record.equipmentGroupId);
	if (invalidStorageGroupIds.length > 0) {
		issues.push(
			issue(
				"STORAGE_GROUP_CONFIGURATION_FOREIGN_OR_WRONG_KIND",
				"Storage resource settings must reference current OHB/STK groups.",
				[],
				invalidStorageGroupIds,
			),
		);
	}
	if (state.vehicleProfile === null) {
		issues.push(
			issue("VEHICLE_PROFILE_MISSING", "An explicit vehicle reservation profile is required."),
		);
	}
	const foreignResidentAnchorPortIds = state.residentHomeSlots
		.filter((record) => !portsById.has(record.anchorPortId))
		.map((record) => record.anchorPortId);
	if (foreignResidentAnchorPortIds.length > 0) {
		issues.push(
			issue(
				"RESIDENT_HOME_SLOT_FOREIGN",
				"Resident home slots must reference current stable OpenFab ports.",
				foreignResidentAnchorPortIds,
			),
		);
	}
	if (state.review === null) {
		issues.push(issue("REVIEW_REQUIRED", "Operational configuration requires explicit review."));
	} else if (
		state.review.sourceRevision !== source.revision ||
		state.review.sourceAuthoredChecksum !== source.authoredChecksum
	) {
		issues.push(
			issue(
				"REVIEW_SOURCE_MISMATCH",
				"Operational configuration review does not match the current authored source.",
			),
		);
	}
	return Object.freeze(issues);
}

export function operationalConfigurationIsReady(
	state: OperationalConfigurationState,
	portEquipment: PortEquipmentState,
	source: OperationalConfigurationSourceIdentity,
): boolean {
	return collectOperationalConfigurationReadinessIssues(state, portEquipment, source).length === 0;
}

function copyStationCapability(
	record: OperationalStationCapabilityRecord,
): OperationalStationCapabilityRecord {
	return Object.freeze({ portId: record.portId, transferCapability: record.transferCapability });
}

function copyLogicalDefinition(
	definition: OperationalLogicalDefinition,
): OperationalLogicalDefinition {
	return Object.freeze({ id: definition.id, key: definition.key });
}

function copyEqGroupQualification(
	record: OperationalEqGroupQualificationRecord,
): OperationalEqGroupQualificationRecord {
	return Object.freeze({
		equipmentGroupId: record.equipmentGroupId,
		capabilityIds: copySortedReferenceIds(record.capabilityIds, "EQ group capability IDs"),
	});
}

function copyEqPortQualificationOverride(
	record: OperationalEqPortQualificationOverrideRecord,
): OperationalEqPortQualificationOverrideRecord {
	return Object.freeze({
		portId: record.portId,
		capabilityIds: copySortedReferenceIds(record.capabilityIds, "EQ port capability IDs"),
	});
}

function copyStoragePolicy(
	definition: OperationalStoragePolicyDefinition,
): OperationalStoragePolicyDefinition {
	return Object.freeze({
		id: definition.id,
		key: definition.key,
		storageClassId: definition.storageClassId,
		priorityRank: definition.priorityRank,
		minimumDwellMilliseconds: definition.minimumDwellMilliseconds,
	});
}

function copyStorageGroup(
	record: OperationalStorageGroupConfigurationRecord,
): OperationalStorageGroupConfigurationRecord {
	return Object.freeze({
		equipmentGroupId: record.equipmentGroupId,
		policyId: record.policyId,
		capacityUnits: record.capacityUnits,
		initialOccupiedUnits: record.initialOccupiedUnits,
		highWaterMarkUnits: record.highWaterMarkUnits,
	});
}

function copyResidentHomeSlot(
	record: OperationalResidentHomeSlotRecord,
): OperationalResidentHomeSlotRecord {
	return Object.freeze({
		id: record.id,
		vehicleId: record.vehicleId,
		anchorPortId: record.anchorPortId,
		policy: record.policy,
	});
}

function copyVehicleProfile(
	profile: OperationalVehicleReservationProfile,
): OperationalVehicleReservationProfile {
	return Object.freeze({ ...profile });
}

function copySortedReferenceIds(values: readonly number[], label: string): readonly number[] {
	if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
	return Object.freeze([...values].sort((left, right) => left - right));
}

function copyAndSortRecords<T>(
	values: readonly T[],
	copy: (value: T) => T,
	compare: (left: T, right: T) => number,
	label: string,
): readonly T[] {
	if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
	return Object.freeze(values.map(copy).sort(compare));
}

function compareLogicalDefinitions(
	left: OperationalLogicalDefinition,
	right: OperationalLogicalDefinition,
): number {
	return left.id - right.id;
}

function logicalDefinitionsError(value: unknown, label: string): string | null {
	if (!Array.isArray(value)) return `${label} definitions must be an array`;
	const ids = new Set<number>();
	const keys = new Set<string>();
	for (const definition of value) {
		if (!isRecord(definition) || !isPositiveRecordId(definition.id as number)) {
			return `${label} ID is invalid`;
		}
		if (!isPortableKey(definition.key)) return `${label} key is invalid`;
		if (ids.has(definition.id as number)) return `${label} ID is duplicated`;
		if (keys.has(definition.key)) return `${label} key is duplicated`;
		ids.add(definition.id as number);
		keys.add(definition.key);
	}
	return null;
}

function storagePoliciesError(value: unknown, storageClassIds: ReadonlySet<number>): string | null {
	const logicalError = logicalDefinitionsError(value, "storage policy");
	if (logicalError) return logicalError;
	for (const definition of value as OperationalStoragePolicyDefinition[]) {
		if (!storageClassIds.has(definition.storageClassId)) {
			return `storage policy ${definition.id} references an unknown storage class`;
		}
		if (!isUint16(definition.priorityRank)) {
			return `storage policy ${definition.id} priority rank is invalid`;
		}
		if (!isUint32(definition.minimumDwellMilliseconds)) {
			return `storage policy ${definition.id} minimum dwell is invalid`;
		}
	}
	return null;
}

function referenceIdsError(
	value: unknown,
	knownIds: ReadonlySet<number>,
	label: string,
): string | null {
	if (!Array.isArray(value)) return `${label} references must be an array`;
	const ids = new Set<number>();
	for (const id of value) {
		if (!isPositiveRecordId(id) || !knownIds.has(id)) {
			return `${label} reference ${String(id)} is unknown`;
		}
		if (ids.has(id)) return `${label} references cannot contain duplicates`;
		ids.add(id);
	}
	return null;
}

function maximumId(records: readonly { readonly id: number }[]): number {
	let maximum = 0;
	for (const record of records) maximum = Math.max(maximum, record.id);
	return maximum;
}

function addLogicalDefinition(
	checksum: OrderedTypedChecksum,
	definition: OperationalLogicalDefinition,
): void {
	checksum.addNumber(definition.id);
	checksum.addString(definition.key);
}

function issue(
	code: OperationalConfigurationReadinessIssueCode,
	message: string,
	portIds: readonly number[] = [],
	equipmentGroupIds: readonly number[] = [],
): OperationalConfigurationReadinessIssue {
	return Object.freeze({
		code,
		message,
		portIds: Object.freeze([...portIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function isPortableKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 120 &&
		value === value.trim() &&
		!containsControlCharacter(value)
	);
}

function isPortableVehicleId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	);
}

function containsControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isPositiveUint32(value: unknown): value is number {
	return isUint32(value) && value > 0;
}

function isUint16(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff;
}
