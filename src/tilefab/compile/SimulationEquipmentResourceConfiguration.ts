import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";
import {
	SIMULATION_EQUIPMENT_GROUP_KIND_CODE,
	SIMULATION_STATION_TYPE_CODE,
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import {
	type SimulationStationOperationalCapabilities,
	simulationStationOperationalCapabilitiesError,
} from "./SimulationStationOperationalCapabilities";

export const SIMULATION_EQUIPMENT_RESOURCE_CONFIGURATION_SCHEMA_VERSION = 1;

export const SIMULATION_EQ_QUALIFICATION_SOURCE_CODE = Object.freeze({
	NOT_EQ: 0,
	GROUP_DEFAULT: 1,
	PORT_OVERRIDE: 2,
} as const);

export interface SimulationLogicalDefinition {
	readonly id: number;
	readonly key: string;
}

export interface SimulationEqGroupQualificationRecord {
	readonly equipmentGroupId: number;
	readonly capabilityIds: readonly number[];
}

export interface SimulationEqPortQualificationOverrideRecord {
	readonly portId: number;
	readonly capabilityIds: readonly number[];
}

export interface SimulationStoragePolicyDefinition extends SimulationLogicalDefinition {
	readonly storageClassId: number;
	/** Zero is the highest dispatch priority; larger ranks are served later. */
	readonly priorityRank: number;
	readonly minimumDwellMilliseconds: number;
}

export interface SimulationStorageGroupConfigurationRecord {
	readonly equipmentGroupId: number;
	readonly policyId: number;
	readonly capacityUnits: number;
	readonly initialOccupiedUnits: number;
	readonly highWaterMarkUnits: number;
}

export interface CompileSimulationEquipmentResourceConfigurationInput {
	readonly eqCapabilities: readonly SimulationLogicalDefinition[];
	readonly eqGroupQualifications: readonly SimulationEqGroupQualificationRecord[];
	readonly eqPortQualificationOverrides: readonly SimulationEqPortQualificationOverrideRecord[];
	readonly storageClasses: readonly SimulationLogicalDefinition[];
	readonly storagePolicies: readonly SimulationStoragePolicyDefinition[];
	readonly storageGroups: readonly SimulationStorageGroupConfigurationRecord[];
}

export interface SimulationEquipmentResourceConfiguration {
	readonly schemaVersion: typeof SIMULATION_EQUIPMENT_RESOURCE_CONFIGURATION_SCHEMA_VERSION;
	/** Resource configuration is one readiness layer, never complete simulation authorization. */
	readonly simulationReady: false;
	readonly sourceFoundationFingerprint: string;
	readonly sourceStationCapabilitiesFingerprint: string;
	readonly stationCount: number;
	readonly portIds: Uint32Array;
	readonly stationEquipmentGroupIds: Uint32Array;
	readonly stationTypeCodes: Uint8Array;
	readonly equipmentGroupCount: number;
	readonly groupIds: Uint32Array;
	readonly groupKindCodes: Uint8Array;
	readonly eqCapabilityCount: number;
	readonly eqCapabilityIds: Uint32Array;
	readonly eqCapabilityKeys: readonly string[];
	/** Physical-group defaults. Non-EQ groups own empty rows. */
	readonly eqGroupCapabilityOffsets: Uint32Array;
	readonly eqGroupCapabilityIds: Uint32Array;
	/** Effective port qualifications after an explicit port override replaces its group default. */
	readonly eqStationCapabilityOffsets: Uint32Array;
	readonly eqStationCapabilityIds: Uint32Array;
	readonly eqQualificationSourceCodes: Uint8Array;
	readonly storageClassCount: number;
	readonly storageClassIds: Uint32Array;
	readonly storageClassKeys: readonly string[];
	readonly storagePolicyCount: number;
	readonly storagePolicyIds: Uint32Array;
	readonly storagePolicyKeys: readonly string[];
	readonly storagePolicyClassIds: Uint32Array;
	readonly storagePolicyPriorityRanks: Uint16Array;
	readonly storagePolicyMinimumDwellMilliseconds: Uint32Array;
	/** Group-aligned storage fields. EQ groups contain zero sentinels. */
	readonly storageGroupPolicyIds: Uint32Array;
	readonly storageGroupCapacityUnits: Uint32Array;
	readonly storageGroupInitialOccupiedUnits: Uint32Array;
	readonly storageGroupHighWaterMarkUnits: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

interface NormalizedEqGroupQualification {
	readonly equipmentGroupId: number;
	readonly capabilityIds: readonly number[];
}

interface NormalizedEqPortOverride {
	readonly portId: number;
	readonly capabilityIds: readonly number[];
}

/**
 * Compiles logical EQ qualifications and storage resource settings without changing physical
 * station/equipment membership. Mutable UI config and run-specific inventory identities stay out.
 */
export function compileSimulationEquipmentResourceConfiguration(
	foundation: SimulationStaticWorldFoundation,
	stationCapabilities: SimulationStationOperationalCapabilities,
	input: CompileSimulationEquipmentResourceConfigurationInput,
): SimulationEquipmentResourceConfiguration {
	assertCompatibleSources(foundation, stationCapabilities);
	if (!isRecord(input))
		throw new Error("Equipment resource configuration input must be an object.");

	const eqCapabilities = normalizeLogicalDefinitions(input.eqCapabilities, "EQ capability");
	const eqCapabilityIds = new Set(eqCapabilities.map((definition) => definition.id));
	const storageClasses = normalizeLogicalDefinitions(input.storageClasses, "storage class");
	const storageClassIds = new Set(storageClasses.map((definition) => definition.id));
	const storagePolicies = normalizeStoragePolicies(input.storagePolicies, storageClassIds);
	const storagePolicyIds = new Set(storagePolicies.map((definition) => definition.id));

	const groupRowById = rowByPositiveUniqueId(foundation.equipmentGroups.ids, "equipment group");
	const stationRowByPortId = rowByPositiveUniqueId(foundation.stations.ids, "station port");
	const eqGroupQualifications = normalizeEqGroupQualifications(
		input.eqGroupQualifications,
		eqCapabilityIds,
		groupRowById,
		foundation,
	);
	const eqPortOverrides = normalizeEqPortOverrides(
		input.eqPortQualificationOverrides,
		eqCapabilityIds,
		stationRowByPortId,
		foundation,
	);
	const storageGroups = normalizeStorageGroups(
		input.storageGroups,
		storagePolicyIds,
		groupRowById,
		foundation,
	);
	assertCompleteGroupConfiguration(foundation, eqGroupQualifications, storageGroups);

	const groupCount = foundation.equipmentGroups.count;
	const eqGroupCapabilityOffsets = new Uint32Array(groupCount + 1);
	const eqGroupCapabilityValues: number[] = [];
	const storageGroupPolicyIds = new Uint32Array(groupCount);
	const storageGroupCapacityUnits = new Uint32Array(groupCount);
	const storageGroupInitialOccupiedUnits = new Uint32Array(groupCount);
	const storageGroupHighWaterMarkUnits = new Uint32Array(groupCount);
	for (let groupRow = 0; groupRow < groupCount; groupRow++) {
		eqGroupCapabilityOffsets[groupRow] = eqGroupCapabilityValues.length;
		const groupId = foundation.equipmentGroups.ids[groupRow] as number;
		const kindCode = foundation.equipmentGroups.kindCodes[groupRow] as number;
		if (kindCode === SIMULATION_EQUIPMENT_GROUP_KIND_CODE.EQ) {
			const record = eqGroupQualifications.get(groupId);
			if (!record) throw new Error(`EQ group ${groupId} has no qualification configuration.`);
			eqGroupCapabilityValues.push(...record.capabilityIds);
		} else {
			const record = storageGroups.get(groupId);
			if (!record) throw new Error(`Storage group ${groupId} has no resource configuration.`);
			storageGroupPolicyIds[groupRow] = record.policyId;
			storageGroupCapacityUnits[groupRow] = record.capacityUnits;
			storageGroupInitialOccupiedUnits[groupRow] = record.initialOccupiedUnits;
			storageGroupHighWaterMarkUnits[groupRow] = record.highWaterMarkUnits;
		}
	}
	eqGroupCapabilityOffsets[groupCount] = eqGroupCapabilityValues.length;

	const stationCount = foundation.stations.count;
	const eqStationCapabilityOffsets = new Uint32Array(stationCount + 1);
	const eqStationCapabilityValues: number[] = [];
	const eqQualificationSourceCodes = new Uint8Array(stationCount);
	for (let stationRow = 0; stationRow < stationCount; stationRow++) {
		eqStationCapabilityOffsets[stationRow] = eqStationCapabilityValues.length;
		const portId = foundation.stations.ids[stationRow] as number;
		const typeCode = foundation.stations.typeCodes[stationRow] as number;
		if (typeCode !== SIMULATION_STATION_TYPE_CODE.EQ) {
			eqQualificationSourceCodes[stationRow] = SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.NOT_EQ;
			continue;
		}
		const override = eqPortOverrides.get(portId);
		if (override) {
			eqStationCapabilityValues.push(...override.capabilityIds);
			eqQualificationSourceCodes[stationRow] =
				SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.PORT_OVERRIDE;
			continue;
		}
		const groupId = foundation.stations.equipmentGroupIds[stationRow] as number;
		const groupDefault = eqGroupQualifications.get(groupId);
		if (!groupDefault) {
			throw new Error(`EQ station port ${portId} references unconfigured group ${groupId}.`);
		}
		eqStationCapabilityValues.push(...groupDefault.capabilityIds);
		eqQualificationSourceCodes[stationRow] = SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.GROUP_DEFAULT;
	}
	eqStationCapabilityOffsets[stationCount] = eqStationCapabilityValues.length;

	const configurationWithoutIdentity = {
		schemaVersion: SIMULATION_EQUIPMENT_RESOURCE_CONFIGURATION_SCHEMA_VERSION,
		simulationReady: false,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceStationCapabilitiesFingerprint: stationCapabilities.fingerprint,
		stationCount,
		portIds: stationCapabilities.portIds.slice(),
		stationEquipmentGroupIds: stationCapabilities.equipmentGroupIds.slice(),
		stationTypeCodes: foundation.stations.typeCodes.slice(),
		equipmentGroupCount: groupCount,
		groupIds: stationCapabilities.groupIds.slice(),
		groupKindCodes: stationCapabilities.groupKindCodes.slice(),
		eqCapabilityCount: eqCapabilities.length,
		eqCapabilityIds: Uint32Array.from(eqCapabilities.map((definition) => definition.id)),
		eqCapabilityKeys: Object.freeze(eqCapabilities.map((definition) => definition.key)),
		eqGroupCapabilityOffsets,
		eqGroupCapabilityIds: Uint32Array.from(eqGroupCapabilityValues),
		eqStationCapabilityOffsets,
		eqStationCapabilityIds: Uint32Array.from(eqStationCapabilityValues),
		eqQualificationSourceCodes,
		storageClassCount: storageClasses.length,
		storageClassIds: Uint32Array.from(storageClasses.map((definition) => definition.id)),
		storageClassKeys: Object.freeze(storageClasses.map((definition) => definition.key)),
		storagePolicyCount: storagePolicies.length,
		storagePolicyIds: Uint32Array.from(storagePolicies.map((definition) => definition.id)),
		storagePolicyKeys: Object.freeze(storagePolicies.map((definition) => definition.key)),
		storagePolicyClassIds: Uint32Array.from(
			storagePolicies.map((definition) => definition.storageClassId),
		),
		storagePolicyPriorityRanks: Uint16Array.from(
			storagePolicies.map((definition) => definition.priorityRank),
		),
		storagePolicyMinimumDwellMilliseconds: Uint32Array.from(
			storagePolicies.map((definition) => definition.minimumDwellMilliseconds),
		),
		storageGroupPolicyIds,
		storageGroupCapacityUnits,
		storageGroupInitialOccupiedUnits,
		storageGroupHighWaterMarkUnits,
	} as const;
	const views = simulationEquipmentResourceConfigurationViews(configurationWithoutIdentity);
	const configuration = Object.freeze({
		...configurationWithoutIdentity,
		fingerprint: checksumSimulationEquipmentResourceConfiguration(configurationWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationEquipmentResourceConfiguration;
	const error = simulationEquipmentResourceConfigurationError(configuration);
	if (error) throw new Error(`Compiled equipment resource configuration is invalid: ${error}`);
	return configuration;
}

export function checksumSimulationEquipmentResourceConfiguration(
	configuration: Omit<SimulationEquipmentResourceConfiguration, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		configuration.schemaVersion,
		configuration.simulationReady ? 1 : 0,
		configuration.stationCount,
		configuration.equipmentGroupCount,
		configuration.eqCapabilityCount,
		configuration.storageClassCount,
		configuration.storagePolicyCount,
	]);
	checksum.addStrings([
		configuration.sourceFoundationFingerprint,
		configuration.sourceStationCapabilitiesFingerprint,
		...configuration.eqCapabilityKeys,
		...configuration.storageClassKeys,
		...configuration.storagePolicyKeys,
	]);
	checksum.addViews(simulationEquipmentResourceConfigurationViews(configuration));
	return checksum.digest();
}

export function simulationEquipmentResourceConfigurationError(value: unknown): string | null {
	if (!isRecord(value)) return "equipment resource configuration must be an object";
	if (value.schemaVersion !== SIMULATION_EQUIPMENT_RESOURCE_CONFIGURATION_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationReady !== false) return "resource configuration cannot authorize simulation";
	if (
		!isNonEmptyString(value.sourceFoundationFingerprint) ||
		!isNonEmptyString(value.sourceStationCapabilitiesFingerprint)
	) {
		return "source fingerprints are invalid";
	}
	if (
		!isNonNegativeSafeInteger(value.stationCount) ||
		!isNonNegativeSafeInteger(value.equipmentGroupCount) ||
		!isNonNegativeSafeInteger(value.eqCapabilityCount) ||
		!isNonNegativeSafeInteger(value.storageClassCount) ||
		!isNonNegativeSafeInteger(value.storagePolicyCount)
	) {
		return "configuration counts are invalid";
	}
	const groupCapabilityCount =
		value.eqGroupCapabilityIds instanceof Uint32Array ? value.eqGroupCapabilityIds.length : -1;
	const stationCapabilityCount =
		value.eqStationCapabilityIds instanceof Uint32Array ? value.eqStationCapabilityIds.length : -1;
	if (
		!isUint32Array(value.portIds, value.stationCount) ||
		!isUint32Array(value.stationEquipmentGroupIds, value.stationCount) ||
		!isUint8Array(value.stationTypeCodes, value.stationCount) ||
		!isUint32Array(value.groupIds, value.equipmentGroupCount) ||
		!isUint8Array(value.groupKindCodes, value.equipmentGroupCount) ||
		!isUint32Array(value.eqCapabilityIds, value.eqCapabilityCount) ||
		!validLogicalKeys(value.eqCapabilityKeys, value.eqCapabilityCount) ||
		!isCsr(value.eqGroupCapabilityOffsets, value.equipmentGroupCount, groupCapabilityCount) ||
		!isUint32Array(value.eqGroupCapabilityIds, groupCapabilityCount) ||
		!isCsr(value.eqStationCapabilityOffsets, value.stationCount, stationCapabilityCount) ||
		!isUint32Array(value.eqStationCapabilityIds, stationCapabilityCount) ||
		!isUint8Array(value.eqQualificationSourceCodes, value.stationCount) ||
		!isUint32Array(value.storageClassIds, value.storageClassCount) ||
		!validLogicalKeys(value.storageClassKeys, value.storageClassCount) ||
		!isUint32Array(value.storagePolicyIds, value.storagePolicyCount) ||
		!validLogicalKeys(value.storagePolicyKeys, value.storagePolicyCount) ||
		!isUint32Array(value.storagePolicyClassIds, value.storagePolicyCount) ||
		!isUint16Array(value.storagePolicyPriorityRanks, value.storagePolicyCount) ||
		!isUint32Array(value.storagePolicyMinimumDwellMilliseconds, value.storagePolicyCount) ||
		!isUint32Array(value.storageGroupPolicyIds, value.equipmentGroupCount) ||
		!isUint32Array(value.storageGroupCapacityUnits, value.equipmentGroupCount) ||
		!isUint32Array(value.storageGroupInitialOccupiedUnits, value.equipmentGroupCount) ||
		!isUint32Array(value.storageGroupHighWaterMarkUnits, value.equipmentGroupCount)
	) {
		return "resource configuration columns are malformed";
	}
	const configuration = value as unknown as SimulationEquipmentResourceConfiguration;
	if (
		!validUniquePositiveIds(configuration.portIds) ||
		!validUniquePositiveIds(configuration.groupIds) ||
		!strictlyIncreasingPositiveIds(configuration.eqCapabilityIds) ||
		!strictlyIncreasingPositiveIds(configuration.storageClassIds) ||
		!strictlyIncreasingPositiveIds(configuration.storagePolicyIds) ||
		!uniqueStrings(configuration.eqCapabilityKeys) ||
		!uniqueStrings(configuration.storageClassKeys) ||
		!uniqueStrings(configuration.storagePolicyKeys)
	) {
		return "configuration IDs and keys must be positive and unique";
	}
	if (!validStoragePolicies(configuration)) return "storage policy definitions are invalid";
	if (!validGroupResources(configuration)) return "physical-group resource rows are inconsistent";
	if (!validStationQualifications(configuration)) {
		return "effective EQ station qualifications are inconsistent";
	}
	const views = simulationEquipmentResourceConfigurationViews(configuration);
	if (!hasDistinctOwnedBuffers(views)) return "typed arrays must own distinct buffers";
	if (!isNonNegativeSafeInteger(value.byteLength) || value.byteLength !== sumByteLengths(views)) {
		return "transfer byte length is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "fingerprint is invalid";
	try {
		if (checksumSimulationEquipmentResourceConfiguration(configuration) !== value.fingerprint) {
			return "fingerprint does not match equipment resource configuration";
		}
	} catch {
		return "equipment resource configuration fingerprint cannot be recomputed";
	}
	return null;
}

export function isSimulationEquipmentResourceConfiguration(
	value: unknown,
): value is SimulationEquipmentResourceConfiguration {
	return simulationEquipmentResourceConfigurationError(value) === null;
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	stationCapabilities: SimulationStationOperationalCapabilities,
): void {
	const foundationError = simulationStaticWorldFoundationError(foundation);
	if (foundationError)
		throw new Error(`Simulation static-world foundation is invalid: ${foundationError}`);
	const capabilitiesError = simulationStationOperationalCapabilitiesError(stationCapabilities);
	if (capabilitiesError) {
		throw new Error(`Simulation station capabilities are invalid: ${capabilitiesError}`);
	}
	if (stationCapabilities.sourceFoundationFingerprint !== foundation.fingerprint) {
		throw new Error("Station capabilities do not belong to the supplied static-world foundation.");
	}
	if (
		!sameNumbers(foundation.stations.ids, stationCapabilities.portIds) ||
		!sameNumbers(foundation.stations.equipmentGroupIds, stationCapabilities.equipmentGroupIds) ||
		!sameNumbers(foundation.equipmentGroups.ids, stationCapabilities.groupIds) ||
		!sameNumbers(foundation.equipmentGroups.kindCodes, stationCapabilities.groupKindCodes)
	) {
		throw new Error(
			"Station capabilities do not preserve the supplied physical equipment identity.",
		);
	}
}

function normalizeLogicalDefinitions(
	definitions: readonly SimulationLogicalDefinition[],
	label: string,
): readonly SimulationLogicalDefinition[] {
	if (!Array.isArray(definitions)) throw new Error(`${label} definitions must be an array.`);
	const ids = new Set<number>();
	const keys = new Set<string>();
	const normalized = definitions.map((definition) => {
		if (!isRecord(definition) || !isPositiveRecordId(definition.id as number)) {
			throw new Error(`${label} ID must be a positive signed int32.`);
		}
		if (!isPortableKey(definition.key)) throw new Error(`${label} key is invalid.`);
		if (ids.has(definition.id as number)) throw new Error(`${label} ID is duplicated.`);
		if (keys.has(definition.key as string)) throw new Error(`${label} key is duplicated.`);
		ids.add(definition.id as number);
		keys.add(definition.key as string);
		return Object.freeze({ id: definition.id as number, key: definition.key as string });
	});
	return Object.freeze(normalized.sort((left, right) => left.id - right.id));
}

function normalizeStoragePolicies(
	definitions: readonly SimulationStoragePolicyDefinition[],
	storageClassIds: ReadonlySet<number>,
): readonly SimulationStoragePolicyDefinition[] {
	const logical = normalizeLogicalDefinitions(definitions, "storage policy");
	const sourceById = new Map<number, SimulationStoragePolicyDefinition>();
	for (const definition of definitions) sourceById.set(definition.id, definition);
	return Object.freeze(
		logical.map((definition) => {
			const source = sourceById.get(definition.id);
			if (!source || !storageClassIds.has(source.storageClassId)) {
				throw new Error(`Storage policy ${definition.id} references an unknown storage class.`);
			}
			if (!isUint16(source.priorityRank)) {
				throw new Error(`Storage policy ${definition.id} priority rank is invalid.`);
			}
			if (!isUint32(source.minimumDwellMilliseconds)) {
				throw new Error(`Storage policy ${definition.id} minimum dwell is invalid.`);
			}
			return Object.freeze({
				...definition,
				storageClassId: source.storageClassId,
				priorityRank: source.priorityRank,
				minimumDwellMilliseconds: source.minimumDwellMilliseconds,
			});
		}),
	);
}

function normalizeEqGroupQualifications(
	records: readonly SimulationEqGroupQualificationRecord[],
	capabilityIds: ReadonlySet<number>,
	groupRowById: ReadonlyMap<number, number>,
	foundation: SimulationStaticWorldFoundation,
): ReadonlyMap<number, NormalizedEqGroupQualification> {
	if (!Array.isArray(records)) throw new Error("EQ group qualifications must be an array.");
	const result = new Map<number, NormalizedEqGroupQualification>();
	for (const record of records) {
		if (!isRecord(record) || !isPositiveRecordId(record.equipmentGroupId as number)) {
			throw new Error("EQ qualification equipment-group ID is invalid.");
		}
		const groupId = record.equipmentGroupId as number;
		const groupRow = groupRowById.get(groupId);
		if (
			groupRow === undefined ||
			foundation.equipmentGroups.kindCodes[groupRow] !== SIMULATION_EQUIPMENT_GROUP_KIND_CODE.EQ
		) {
			throw new Error(`EQ qualification references non-EQ or foreign group ${groupId}.`);
		}
		if (result.has(groupId)) throw new Error(`EQ group ${groupId} is configured more than once.`);
		result.set(
			groupId,
			Object.freeze({
				equipmentGroupId: groupId,
				capabilityIds: normalizeReferenceIds(record.capabilityIds, capabilityIds, "EQ capability"),
			}),
		);
	}
	return result;
}

function normalizeEqPortOverrides(
	records: readonly SimulationEqPortQualificationOverrideRecord[],
	capabilityIds: ReadonlySet<number>,
	stationRowByPortId: ReadonlyMap<number, number>,
	foundation: SimulationStaticWorldFoundation,
): ReadonlyMap<number, NormalizedEqPortOverride> {
	if (!Array.isArray(records)) throw new Error("EQ port qualification overrides must be an array.");
	const result = new Map<number, NormalizedEqPortOverride>();
	for (const record of records) {
		if (!isRecord(record) || !isPositiveRecordId(record.portId as number)) {
			throw new Error("EQ qualification override port ID is invalid.");
		}
		const portId = record.portId as number;
		const stationRow = stationRowByPortId.get(portId);
		if (
			stationRow === undefined ||
			foundation.stations.typeCodes[stationRow] !== SIMULATION_STATION_TYPE_CODE.EQ
		) {
			throw new Error(`EQ qualification override references non-EQ or foreign port ${portId}.`);
		}
		if (result.has(portId)) throw new Error(`EQ port ${portId} is overridden more than once.`);
		result.set(
			portId,
			Object.freeze({
				portId,
				capabilityIds: normalizeReferenceIds(record.capabilityIds, capabilityIds, "EQ capability"),
			}),
		);
	}
	return result;
}

function normalizeStorageGroups(
	records: readonly SimulationStorageGroupConfigurationRecord[],
	storagePolicyIds: ReadonlySet<number>,
	groupRowById: ReadonlyMap<number, number>,
	foundation: SimulationStaticWorldFoundation,
): ReadonlyMap<number, SimulationStorageGroupConfigurationRecord> {
	if (!Array.isArray(records)) throw new Error("Storage group configurations must be an array.");
	const result = new Map<number, SimulationStorageGroupConfigurationRecord>();
	for (const record of records) {
		if (!isRecord(record) || !isPositiveRecordId(record.equipmentGroupId as number)) {
			throw new Error("Storage configuration equipment-group ID is invalid.");
		}
		const groupId = record.equipmentGroupId as number;
		const groupRow = groupRowById.get(groupId);
		if (
			groupRow === undefined ||
			foundation.equipmentGroups.kindCodes[groupRow] === SIMULATION_EQUIPMENT_GROUP_KIND_CODE.EQ
		) {
			throw new Error(`Storage configuration references EQ or foreign group ${groupId}.`);
		}
		if (result.has(groupId))
			throw new Error(`Storage group ${groupId} is configured more than once.`);
		if (!storagePolicyIds.has(record.policyId as number)) {
			throw new Error(`Storage group ${groupId} references an unknown policy.`);
		}
		if (!isPositiveUint32(record.capacityUnits)) {
			throw new Error(`Storage group ${groupId} capacity is invalid.`);
		}
		if (
			!isUint32(record.initialOccupiedUnits) ||
			record.initialOccupiedUnits > record.capacityUnits
		) {
			throw new Error(`Storage group ${groupId} initial occupancy exceeds capacity.`);
		}
		if (!isUint32(record.highWaterMarkUnits) || record.highWaterMarkUnits > record.capacityUnits) {
			throw new Error(`Storage group ${groupId} high-water mark exceeds capacity.`);
		}
		result.set(
			groupId,
			Object.freeze({
				equipmentGroupId: groupId,
				policyId: record.policyId as number,
				capacityUnits: record.capacityUnits as number,
				initialOccupiedUnits: record.initialOccupiedUnits as number,
				highWaterMarkUnits: record.highWaterMarkUnits as number,
			}),
		);
	}
	return result;
}

function assertCompleteGroupConfiguration(
	foundation: SimulationStaticWorldFoundation,
	eqGroups: ReadonlyMap<number, NormalizedEqGroupQualification>,
	storageGroups: ReadonlyMap<number, SimulationStorageGroupConfigurationRecord>,
): void {
	let expectedEq = 0;
	let expectedStorage = 0;
	for (const kindCode of foundation.equipmentGroups.kindCodes) {
		if (kindCode === SIMULATION_EQUIPMENT_GROUP_KIND_CODE.EQ) expectedEq++;
		else expectedStorage++;
	}
	if (eqGroups.size !== expectedEq) {
		throw new Error("Every physical EQ group must have exactly one qualification configuration.");
	}
	if (storageGroups.size !== expectedStorage) {
		throw new Error("Every physical OHB/STK group must have exactly one storage configuration.");
	}
}

function normalizeReferenceIds(
	values: unknown,
	knownIds: ReadonlySet<number>,
	label: string,
): readonly number[] {
	if (!Array.isArray(values)) throw new Error(`${label} references must be an array.`);
	const seen = new Set<number>();
	const normalized: number[] = [];
	for (const value of values) {
		if (!isPositiveRecordId(value) || !knownIds.has(value)) {
			throw new Error(`${label} reference ${String(value)} is unknown.`);
		}
		if (seen.has(value)) throw new Error(`${label} references cannot contain duplicates.`);
		seen.add(value);
		normalized.push(value);
	}
	normalized.sort((left, right) => left - right);
	return Object.freeze(normalized);
}

function validStoragePolicies(configuration: SimulationEquipmentResourceConfiguration): boolean {
	const classIds = new Set(configuration.storageClassIds);
	for (const classId of configuration.storagePolicyClassIds) {
		if (!classIds.has(classId)) return false;
	}
	return true;
}

function validGroupResources(configuration: SimulationEquipmentResourceConfiguration): boolean {
	const capabilityIds = new Set(configuration.eqCapabilityIds);
	const policyIds = new Set(configuration.storagePolicyIds);
	for (let groupRow = 0; groupRow < configuration.equipmentGroupCount; groupRow++) {
		const kindCode = configuration.groupKindCodes[groupRow] as number;
		if (kindCode > SIMULATION_EQUIPMENT_GROUP_KIND_CODE.STK) return false;
		const start = configuration.eqGroupCapabilityOffsets[groupRow] as number;
		const end = configuration.eqGroupCapabilityOffsets[groupRow + 1] as number;
		const groupCapabilities = configuration.eqGroupCapabilityIds.subarray(start, end);
		if (kindCode === SIMULATION_EQUIPMENT_GROUP_KIND_CODE.EQ) {
			if (
				!validSortedReferences(groupCapabilities, capabilityIds) ||
				configuration.storageGroupPolicyIds[groupRow] !== 0 ||
				configuration.storageGroupCapacityUnits[groupRow] !== 0 ||
				configuration.storageGroupInitialOccupiedUnits[groupRow] !== 0 ||
				configuration.storageGroupHighWaterMarkUnits[groupRow] !== 0
			) {
				return false;
			}
			continue;
		}
		const capacity = configuration.storageGroupCapacityUnits[groupRow] as number;
		if (
			groupCapabilities.length !== 0 ||
			!policyIds.has(configuration.storageGroupPolicyIds[groupRow] as number) ||
			capacity === 0 ||
			(configuration.storageGroupInitialOccupiedUnits[groupRow] as number) > capacity ||
			(configuration.storageGroupHighWaterMarkUnits[groupRow] as number) > capacity
		) {
			return false;
		}
	}
	return true;
}

function validStationQualifications(
	configuration: SimulationEquipmentResourceConfiguration,
): boolean {
	const groupRowById = new Map<number, number>();
	for (let row = 0; row < configuration.equipmentGroupCount; row++) {
		groupRowById.set(configuration.groupIds[row] as number, row);
	}
	const capabilityIds = new Set(configuration.eqCapabilityIds);
	const seenGroupRows = new Set<number>();
	for (let stationRow = 0; stationRow < configuration.stationCount; stationRow++) {
		const groupRow = groupRowById.get(configuration.stationEquipmentGroupIds[stationRow] as number);
		if (groupRow === undefined) return false;
		seenGroupRows.add(groupRow);
		const typeCode = configuration.stationTypeCodes[stationRow] as number;
		if (typeCode !== configuration.groupKindCodes[groupRow]) return false;
		const start = configuration.eqStationCapabilityOffsets[stationRow] as number;
		const end = configuration.eqStationCapabilityOffsets[stationRow + 1] as number;
		const effective = configuration.eqStationCapabilityIds.subarray(start, end);
		const source = configuration.eqQualificationSourceCodes[stationRow] as number;
		if (typeCode !== SIMULATION_STATION_TYPE_CODE.EQ) {
			if (effective.length !== 0 || source !== SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.NOT_EQ) {
				return false;
			}
			continue;
		}
		if (
			!validSortedReferences(effective, capabilityIds) ||
			(source !== SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.GROUP_DEFAULT &&
				source !== SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.PORT_OVERRIDE)
		) {
			return false;
		}
		if (source === SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.GROUP_DEFAULT) {
			const groupStart = configuration.eqGroupCapabilityOffsets[groupRow] as number;
			const groupEnd = configuration.eqGroupCapabilityOffsets[groupRow + 1] as number;
			if (
				!sameNumbers(effective, configuration.eqGroupCapabilityIds.subarray(groupStart, groupEnd))
			) {
				return false;
			}
		}
	}
	return seenGroupRows.size === configuration.equipmentGroupCount;
}

function simulationEquipmentResourceConfigurationViews(
	configuration: Omit<SimulationEquipmentResourceConfiguration, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		configuration.portIds,
		configuration.stationEquipmentGroupIds,
		configuration.stationTypeCodes,
		configuration.groupIds,
		configuration.groupKindCodes,
		configuration.eqCapabilityIds,
		configuration.eqGroupCapabilityOffsets,
		configuration.eqGroupCapabilityIds,
		configuration.eqStationCapabilityOffsets,
		configuration.eqStationCapabilityIds,
		configuration.eqQualificationSourceCodes,
		configuration.storageClassIds,
		configuration.storagePolicyIds,
		configuration.storagePolicyClassIds,
		configuration.storagePolicyPriorityRanks,
		configuration.storagePolicyMinimumDwellMilliseconds,
		configuration.storageGroupPolicyIds,
		configuration.storageGroupCapacityUnits,
		configuration.storageGroupInitialOccupiedUnits,
		configuration.storageGroupHighWaterMarkUnits,
	];
}

function rowByPositiveUniqueId(values: Uint32Array, label: string): ReadonlyMap<number, number> {
	const rows = new Map<number, number>();
	for (let row = 0; row < values.length; row++) {
		const value = values[row] as number;
		if (!isPositiveRecordId(value) || rows.has(value)) {
			throw new Error(`${label} IDs must be positive and unique.`);
		}
		rows.set(value, row);
	}
	return rows;
}

function validSortedReferences(values: Uint32Array, knownIds: ReadonlySet<number>): boolean {
	let previous = 0;
	for (const value of values) {
		if (!knownIds.has(value) || value <= previous) return false;
		previous = value;
	}
	return true;
}

function validUniquePositiveIds(values: Uint32Array): boolean {
	const seen = new Set<number>();
	for (const value of values) {
		if (!isPositiveRecordId(value) || seen.has(value)) return false;
		seen.add(value);
	}
	return true;
}

function strictlyIncreasingPositiveIds(values: Uint32Array): boolean {
	let previous = 0;
	for (const value of values) {
		if (!isPositiveRecordId(value) || value <= previous) return false;
		previous = value;
	}
	return true;
}

function validLogicalKeys(value: unknown, count: number): value is readonly string[] {
	return Array.isArray(value) && value.length === count && value.every(isPortableKey);
}

function uniqueStrings(values: readonly string[]): boolean {
	return new Set(values).size === values.length;
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

function containsControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function sameNumbers(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}

function hasDistinctOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBufferLike>();
	for (const view of views) {
		if (
			view.byteOffset !== 0 ||
			view.byteLength !== view.buffer.byteLength ||
			buffers.has(view.buffer)
		) {
			return false;
		}
		buffers.add(view.buffer);
	}
	return true;
}

function isCsr(offsets: unknown, rowCount: number, itemCount: number): offsets is Uint32Array {
	return (
		Number.isInteger(itemCount) &&
		itemCount >= 0 &&
		isUint32Array(offsets, rowCount + 1) &&
		offsets[0] === 0 &&
		offsets[rowCount] === itemCount &&
		isNonDecreasing(offsets)
	);
}

function isNonDecreasing(values: Uint32Array): boolean {
	for (let index = 1; index < values.length; index++) {
		if ((values[index] as number) < (values[index - 1] as number)) return false;
	}
	return true;
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

function isUint16(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff;
}

function isUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isPositiveUint32(value: unknown): value is number {
	return isUint32(value) && value > 0;
}

function isUint32Array(value: unknown, length?: number): value is Uint32Array {
	return value instanceof Uint32Array && (length === undefined || value.length === length);
}

function isUint16Array(value: unknown, length?: number): value is Uint16Array {
	return value instanceof Uint16Array && (length === undefined || value.length === length);
}

function isUint8Array(value: unknown, length?: number): value is Uint8Array {
	return value instanceof Uint8Array && (length === undefined || value.length === length);
}
