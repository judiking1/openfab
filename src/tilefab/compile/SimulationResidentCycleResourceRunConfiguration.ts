import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";
import type { SimulationEquipmentResourceConfiguration } from "./SimulationEquipmentResourceConfiguration";
import type { SimulationResidentCycleAdmissionProgram } from "./SimulationResidentCycleAdmissionProgram";
import type { SimulationResidentCycleLeaseClaims } from "./SimulationResidentCycleLeaseClaims";
import type { SimulationResidentCycleRoutes } from "./SimulationResidentCycleRoutes";
import {
	type SimulationResidentCycleServiceTiming,
	simulationResidentCycleServiceTimingMatchesPreparedSources,
} from "./SimulationResidentCycleServiceTiming";
import type { SimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import {
	type SimulationResidentScenarioManifest,
	simulationResidentScenarioManifestError,
} from "./SimulationResidentScenarioManifest";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";
import {
	SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE,
	type SimulationScenarioAvailabilityWindow,
	type SimulationScenarioInitialStorageLoadRecord,
	type SimulationScenarioResourceRunConfigurationInput,
} from "./SimulationScenarioResourceRunConfiguration";
import { SIMULATION_SCENARIO_SERVICE_KIND_CODE } from "./SimulationScenarioServiceTiming";
import {
	SIMULATION_STATION_TYPE_CODE,
	type SimulationStaticWorldFoundation,
} from "./SimulationStaticWorldFoundation";
import type { SimulationTrackOccupancyPolicy } from "./SimulationTrackOccupancyPolicy";
import type { SimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

export const SIMULATION_RESIDENT_CYCLE_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_CYCLE_EQ_CAPACITY_POLICY =
	"GROUP_CONCURRENT_ACTIVE_SERVICE_LIMIT_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_EQ_QUEUE_POLICY =
	"READY_TIME_THEN_REQUEST_ROW_WITHOUT_PREEMPTION_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_STORAGE_RESERVATION_POLICY =
	"ATOMIC_WITH_COMPLETE_CYCLE_LEASE_BEFORE_HOME_DEPARTURE_UNTIL_DESTINATION_ARRIVAL_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_STORAGE_HIGH_WATER_POLICY =
	"PROJECTED_OCCUPANCY_NOT_ABOVE_HIGH_WATER_MARK_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_STORAGE_DESTINATION_POLICY =
	"EXACT_REQUEST_DESTINATION_NO_DYNAMIC_SUBSTITUTION_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_AVAILABILITY_WINDOWS = 100_000;
export const SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_TYPED_BYTES = 32 * 1024 * 1024;
export const SIMULATION_RESIDENT_CYCLE_RESOURCE_MISSING_SAFETY_LAYERS = Object.freeze([
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const EQ_RESOURCE_RECORD_KEYS = Object.freeze([
	"equipmentGroupId",
	"concurrentCapacity",
	"availabilityMode",
	"availabilityWindows",
] as const);
const AVAILABILITY_WINDOW_KEYS = Object.freeze(["startMicroseconds", "endMicroseconds"] as const);
const INITIAL_STORAGE_LOAD_KEYS = Object.freeze(["loadId", "equipmentGroupId"] as const);
const RESOURCE_INPUT_KEYS = Object.freeze(["eqResources", "initialStorageLoads"] as const);
const CONFIGURATION_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingSafetyLayers",
	"eqCapacityPolicy",
	"eqQueuePolicy",
	"storageReservationPolicy",
	"storageHighWaterPolicy",
	"storageDestinationPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceRoutesFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceAdmissionProgramFingerprint",
	"sourceServiceTimingFingerprint",
	"sourceFoundationFingerprint",
	"sourceEquipmentResourcesFingerprint",
	"sourceResourceInputFingerprint",
	"requestCount",
	"loadCount",
	"eqResourceCount",
	"storageResourceCount",
	"eqEquipmentGroupIds",
	"eqConcurrentCapacities",
	"eqAvailabilityModeCodes",
	"eqAvailabilityWindowOffsets",
	"eqAvailabilityWindowStartsMicroseconds",
	"eqAvailabilityWindowEndsMicroseconds",
	"storageEquipmentGroupIds",
	"storagePolicyIds",
	"storagePolicyPriorityRanks",
	"storageCapacityUnits",
	"storageInitialOccupiedUnits",
	"storageInitialNamedLoadOffsets",
	"storageInitialNamedLoadRows",
	"storageInitialAnonymousOccupiedUnits",
	"storageHighWaterMarkUnits",
	"initialLoadStorageResourceRows",
	"fingerprint",
	"byteLength",
] as const);

export type SimulationResidentCycleResourceRunConfigurationInput =
	SimulationScenarioResourceRunConfigurationInput;

export interface SimulationResidentCycleResourceRunConfiguration {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_CYCLE_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_CYCLE_RESOURCE_MISSING_SAFETY_LAYERS;
	readonly eqCapacityPolicy: typeof SIMULATION_RESIDENT_CYCLE_EQ_CAPACITY_POLICY;
	readonly eqQueuePolicy: typeof SIMULATION_RESIDENT_CYCLE_EQ_QUEUE_POLICY;
	readonly storageReservationPolicy: typeof SIMULATION_RESIDENT_CYCLE_STORAGE_RESERVATION_POLICY;
	readonly storageHighWaterPolicy: typeof SIMULATION_RESIDENT_CYCLE_STORAGE_HIGH_WATER_POLICY;
	readonly storageDestinationPolicy: typeof SIMULATION_RESIDENT_CYCLE_STORAGE_DESTINATION_POLICY;
	readonly sourceKind: SimulationResidentScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceRoutesFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceAdmissionProgramFingerprint: string;
	readonly sourceServiceTimingFingerprint: string;
	readonly sourceFoundationFingerprint: string;
	readonly sourceEquipmentResourcesFingerprint: string;
	readonly sourceResourceInputFingerprint: string;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly eqResourceCount: number;
	readonly storageResourceCount: number;
	readonly eqEquipmentGroupIds: Uint32Array;
	readonly eqConcurrentCapacities: Uint32Array;
	readonly eqAvailabilityModeCodes: Uint8Array;
	readonly eqAvailabilityWindowOffsets: Uint32Array;
	readonly eqAvailabilityWindowStartsMicroseconds: Float64Array;
	readonly eqAvailabilityWindowEndsMicroseconds: Float64Array;
	readonly storageEquipmentGroupIds: Uint32Array;
	readonly storagePolicyIds: Uint32Array;
	readonly storagePolicyPriorityRanks: Uint16Array;
	readonly storageCapacityUnits: Uint32Array;
	readonly storageInitialOccupiedUnits: Uint32Array;
	readonly storageInitialNamedLoadOffsets: Uint32Array;
	readonly storageInitialNamedLoadRows: Uint32Array;
	readonly storageInitialAnonymousOccupiedUnits: Uint32Array;
	readonly storageHighWaterMarkUnits: Uint32Array;
	/** Minus one means the named load starts at a non-storage station. */
	readonly initialLoadStorageResourceRows: Int32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

interface NormalizedResourceInput {
	readonly eqResources: readonly NormalizedEqResource[];
	readonly initialStorageLoads: readonly SimulationScenarioInitialStorageLoadRecord[];
}

interface NormalizedEqResource {
	readonly equipmentGroupId: number;
	readonly concurrentCapacity: number;
	readonly availabilityMode: "ALWAYS" | "WINDOWS";
	readonly availabilityWindows: readonly SimulationScenarioAvailabilityWindow[];
}

export interface SimulationResidentCycleResourceSources {
	readonly foundation: SimulationStaticWorldFoundation;
	readonly trackResources: SimulationTrackResourceTopology;
	readonly occupancyPolicy: SimulationTrackOccupancyPolicy;
	readonly equipmentResources: SimulationEquipmentResourceConfiguration;
	readonly manifest: SimulationResidentScenarioManifest;
	readonly parking: SimulationResidentFleetParkingConfiguration;
	readonly routes: SimulationResidentCycleRoutes;
	readonly leaseClaims: SimulationResidentCycleLeaseClaims;
	readonly admissionProgram: SimulationResidentCycleAdmissionProgram;
	readonly serviceTiming: SimulationResidentCycleServiceTiming;
}

export function compileSimulationResidentCycleResourceRunConfiguration(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
	serviceTiming: SimulationResidentCycleServiceTiming,
	input: SimulationResidentCycleResourceRunConfigurationInput,
): SimulationResidentCycleResourceRunConfiguration {
	const sources: SimulationResidentCycleResourceSources = {
		foundation,
		trackResources,
		occupancyPolicy,
		equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
	};
	assertCompatibleSources(sources);
	const normalized = normalizeResourceInput(input);
	const requiredEqGroupIds = requiredEqDestinationGroupIds(serviceTiming);
	assertExactEqResources(normalized.eqResources, requiredEqGroupIds);

	const loadIds = [...new Set(manifest.records.map((record) => record.loadId))].sort(
		compareStrings,
	);
	if (loadIds.length !== admissionProgram.loadCount) {
		throw new Error("Resident load identities do not match the admission program.");
	}
	const loadRowById = new Map(loadIds.map((loadId, loadRow) => [loadId, loadRow]));
	const groupRowById = rowsById(equipmentResources.groupIds);
	const policyRowById = rowsById(equipmentResources.storagePolicyIds);
	const requiredInitialStorageLoads = requiredInitialStorageLoadGroups(
		foundation,
		admissionProgram,
		loadIds,
	);
	const initialStorageGroupByLoadRow = validateInitialStorageLoads(
		normalized.initialStorageLoads,
		requiredInitialStorageLoads,
		loadRowById,
	);
	const storageGroupIds = requiredStorageGroupIds(serviceTiming, initialStorageGroupByLoadRow);
	const availabilityWindowCount = normalized.eqResources.reduce(
		(total, resource) => total + resource.availabilityWindows.length,
		0,
	);
	assertTypedMemoryLimit(
		normalized.eqResources.length,
		availabilityWindowCount,
		storageGroupIds.length,
		normalized.initialStorageLoads.length,
		loadIds.length,
	);

	const eqEquipmentGroupIds = new Uint32Array(normalized.eqResources.length);
	const eqConcurrentCapacities = new Uint32Array(normalized.eqResources.length);
	const eqAvailabilityModeCodes = new Uint8Array(normalized.eqResources.length);
	const eqAvailabilityWindowOffsets = new Uint32Array(normalized.eqResources.length + 1);
	const eqAvailabilityWindowStartsMicroseconds = new Float64Array(availabilityWindowCount);
	const eqAvailabilityWindowEndsMicroseconds = new Float64Array(availabilityWindowCount);
	let windowCursor = 0;
	for (let row = 0; row < normalized.eqResources.length; row++) {
		const resource = normalized.eqResources[row] as NormalizedEqResource;
		eqEquipmentGroupIds[row] = resource.equipmentGroupId;
		eqConcurrentCapacities[row] = resource.concurrentCapacity;
		eqAvailabilityModeCodes[row] =
			SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE[resource.availabilityMode];
		eqAvailabilityWindowOffsets[row] = windowCursor;
		for (const window of resource.availabilityWindows) {
			eqAvailabilityWindowStartsMicroseconds[windowCursor] = window.startMicroseconds;
			eqAvailabilityWindowEndsMicroseconds[windowCursor] = window.endMicroseconds;
			windowCursor++;
		}
	}
	eqAvailabilityWindowOffsets[normalized.eqResources.length] = windowCursor;

	const storageEquipmentGroupIds = Uint32Array.from(storageGroupIds);
	const storagePolicyIds = new Uint32Array(storageGroupIds.length);
	const storagePolicyPriorityRanks = new Uint16Array(storageGroupIds.length);
	const storageCapacityUnits = new Uint32Array(storageGroupIds.length);
	const storageInitialOccupiedUnits = new Uint32Array(storageGroupIds.length);
	const storageInitialNamedLoadOffsets = new Uint32Array(storageGroupIds.length + 1);
	const storageInitialNamedLoadRows = new Uint32Array(normalized.initialStorageLoads.length);
	const storageInitialAnonymousOccupiedUnits = new Uint32Array(storageGroupIds.length);
	const storageHighWaterMarkUnits = new Uint32Array(storageGroupIds.length);
	const initialLoadStorageResourceRows = new Int32Array(loadIds.length).fill(-1);
	let namedLoadCursor = 0;
	for (let storageRow = 0; storageRow < storageGroupIds.length; storageRow++) {
		const groupId = storageGroupIds[storageRow] as number;
		const groupRow = groupRowById.get(groupId);
		if (groupRow === undefined) throw new Error(`Resident storage group ${groupId} is unknown.`);
		const policyId = equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		if (policyRow === undefined) {
			throw new Error(`Resident storage group ${groupId} has no reviewed policy.`);
		}
		const initialOccupied = equipmentResources.storageGroupInitialOccupiedUnits[groupRow] as number;
		storagePolicyIds[storageRow] = policyId;
		storagePolicyPriorityRanks[storageRow] = equipmentResources.storagePolicyPriorityRanks[
			policyRow
		] as number;
		storageCapacityUnits[storageRow] = equipmentResources.storageGroupCapacityUnits[
			groupRow
		] as number;
		storageInitialOccupiedUnits[storageRow] = initialOccupied;
		storageHighWaterMarkUnits[storageRow] = equipmentResources.storageGroupHighWaterMarkUnits[
			groupRow
		] as number;
		storageInitialNamedLoadOffsets[storageRow] = namedLoadCursor;
		for (let loadRow = 0; loadRow < loadIds.length; loadRow++) {
			if (initialStorageGroupByLoadRow.get(loadRow) !== groupId) continue;
			storageInitialNamedLoadRows[namedLoadCursor++] = loadRow;
			initialLoadStorageResourceRows[loadRow] = storageRow;
		}
		const namedCount = namedLoadCursor - (storageInitialNamedLoadOffsets[storageRow] as number);
		if (namedCount > initialOccupied) {
			throw new Error(
				`Resident storage group ${groupId} has more named loads than reviewed initial occupancy.`,
			);
		}
		storageInitialAnonymousOccupiedUnits[storageRow] = initialOccupied - namedCount;
	}
	storageInitialNamedLoadOffsets[storageGroupIds.length] = namedLoadCursor;
	if (namedLoadCursor !== storageInitialNamedLoadRows.length) {
		throw new Error("Resident initial named-load inventory is incomplete.");
	}

	const configurationWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_CYCLE_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION,
		simulationRunnable: false,
		missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_RESOURCE_MISSING_SAFETY_LAYERS,
		eqCapacityPolicy: SIMULATION_RESIDENT_CYCLE_EQ_CAPACITY_POLICY,
		eqQueuePolicy: SIMULATION_RESIDENT_CYCLE_EQ_QUEUE_POLICY,
		storageReservationPolicy: SIMULATION_RESIDENT_CYCLE_STORAGE_RESERVATION_POLICY,
		storageHighWaterPolicy: SIMULATION_RESIDENT_CYCLE_STORAGE_HIGH_WATER_POLICY,
		storageDestinationPolicy: SIMULATION_RESIDENT_CYCLE_STORAGE_DESTINATION_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceRoutesFingerprint: routes.fingerprint,
		sourceLeaseClaimsFingerprint: leaseClaims.fingerprint,
		sourceAdmissionProgramFingerprint: admissionProgram.fingerprint,
		sourceServiceTimingFingerprint: serviceTiming.fingerprint,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceEquipmentResourcesFingerprint: equipmentResources.fingerprint,
		sourceResourceInputFingerprint: checksumSimulationResidentCycleResourceRunConfigurationInput(
			manifest,
			normalized,
		),
		requestCount: routes.requestCount,
		loadCount: admissionProgram.loadCount,
		eqResourceCount: normalized.eqResources.length,
		storageResourceCount: storageGroupIds.length,
		eqEquipmentGroupIds,
		eqConcurrentCapacities,
		eqAvailabilityModeCodes,
		eqAvailabilityWindowOffsets,
		eqAvailabilityWindowStartsMicroseconds,
		eqAvailabilityWindowEndsMicroseconds,
		storageEquipmentGroupIds,
		storagePolicyIds,
		storagePolicyPriorityRanks,
		storageCapacityUnits,
		storageInitialOccupiedUnits,
		storageInitialNamedLoadOffsets,
		storageInitialNamedLoadRows,
		storageInitialAnonymousOccupiedUnits,
		storageHighWaterMarkUnits,
		initialLoadStorageResourceRows,
	} as const;
	const views = simulationResidentCycleResourceRunConfigurationViews(configurationWithoutIdentity);
	const configuration = Object.freeze({
		...configurationWithoutIdentity,
		fingerprint: checksumSimulationResidentCycleResourceRunConfiguration(
			configurationWithoutIdentity,
		),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationResidentCycleResourceRunConfiguration;
	const error = simulationResidentCycleResourceRunConfigurationError(configuration);
	if (error) throw new Error(`Compiled resident resource run configuration is invalid: ${error}`);
	return configuration;
}

export function checksumSimulationResidentCycleResourceRunConfigurationInput(
	manifest: SimulationResidentScenarioManifest,
	input: SimulationResidentCycleResourceRunConfigurationInput | NormalizedResourceInput,
): string {
	const manifestError = simulationResidentScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation resident manifest is invalid: ${manifestError}`);
	const normalized = normalizeResourceInput(input);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([manifest.sourceKind, manifest.fingerprint]);
	for (const resource of normalized.eqResources) {
		checksum.addNumbers([resource.equipmentGroupId, resource.concurrentCapacity]);
		checksum.addStrings([resource.availabilityMode]);
		for (const window of resource.availabilityWindows) {
			checksum.addNumbers([window.startMicroseconds, window.endMicroseconds]);
		}
	}
	for (const load of normalized.initialStorageLoads) {
		checksum.addNumber(load.equipmentGroupId);
		checksum.addString(load.loadId);
	}
	return checksum.digest();
}

export function checksumSimulationResidentCycleResourceRunConfiguration(
	configuration: Omit<
		SimulationResidentCycleResourceRunConfiguration,
		"fingerprint" | "byteLength"
	>,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		configuration.schemaVersion,
		configuration.simulationRunnable ? 1 : 0,
		configuration.requestCount,
		configuration.loadCount,
		configuration.eqResourceCount,
		configuration.storageResourceCount,
	]);
	checksum.addStrings([
		...configuration.missingSafetyLayers,
		configuration.eqCapacityPolicy,
		configuration.eqQueuePolicy,
		configuration.storageReservationPolicy,
		configuration.storageHighWaterPolicy,
		configuration.storageDestinationPolicy,
		configuration.sourceKind,
		configuration.sourceManifestFingerprint,
		configuration.sourceRoutesFingerprint,
		configuration.sourceLeaseClaimsFingerprint,
		configuration.sourceAdmissionProgramFingerprint,
		configuration.sourceServiceTimingFingerprint,
		configuration.sourceFoundationFingerprint,
		configuration.sourceEquipmentResourcesFingerprint,
		configuration.sourceResourceInputFingerprint,
	]);
	checksum.addViews(simulationResidentCycleResourceRunConfigurationViews(configuration));
	return checksum.digest();
}

export function simulationResidentCycleResourceRunConfigurationError(
	value: unknown,
): string | null {
	if (!isRecord(value)) return "resident resource run configuration must be an object";
	if (!hasExactKeys(value, CONFIGURATION_KEYS)) {
		return "resident resource run configuration contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_CYCLE_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingSafetyLayers,
			SIMULATION_RESIDENT_CYCLE_RESOURCE_MISSING_SAFETY_LAYERS,
		) ||
		value.eqCapacityPolicy !== SIMULATION_RESIDENT_CYCLE_EQ_CAPACITY_POLICY ||
		value.eqQueuePolicy !== SIMULATION_RESIDENT_CYCLE_EQ_QUEUE_POLICY ||
		value.storageReservationPolicy !== SIMULATION_RESIDENT_CYCLE_STORAGE_RESERVATION_POLICY ||
		value.storageHighWaterPolicy !== SIMULATION_RESIDENT_CYCLE_STORAGE_HIGH_WATER_POLICY ||
		value.storageDestinationPolicy !== SIMULATION_RESIDENT_CYCLE_STORAGE_DESTINATION_POLICY ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY")
	) {
		return "resident resource run policy or source kind is invalid";
	}
	for (const key of [
		"sourceManifestFingerprint",
		"sourceRoutesFingerprint",
		"sourceLeaseClaimsFingerprint",
		"sourceAdmissionProgramFingerprint",
		"sourceServiceTimingFingerprint",
		"sourceFoundationFingerprint",
		"sourceEquipmentResourcesFingerprint",
		"sourceResourceInputFingerprint",
	] as const) {
		if (!isNonEmptyString(value[key])) return `${key} is invalid`;
	}
	if (
		!isNonNegativeSafeInteger(value.requestCount) ||
		!isNonNegativeSafeInteger(value.loadCount) ||
		!isNonNegativeSafeInteger(value.eqResourceCount) ||
		!isNonNegativeSafeInteger(value.storageResourceCount) ||
		(value.loadCount as number) > (value.requestCount as number)
	) {
		return "resident resource run counts are invalid";
	}
	const eqCount = value.eqResourceCount as number;
	const storageCount = value.storageResourceCount as number;
	const loadCount = value.loadCount as number;
	const windowCount =
		value.eqAvailabilityWindowStartsMicroseconds instanceof Float64Array
			? value.eqAvailabilityWindowStartsMicroseconds.length
			: -1;
	const namedLoadCount =
		value.storageInitialNamedLoadRows instanceof Uint32Array
			? value.storageInitialNamedLoadRows.length
			: -1;
	if (
		windowCount > SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_AVAILABILITY_WINDOWS ||
		!isUint32Array(value.eqEquipmentGroupIds, eqCount) ||
		!isUint32Array(value.eqConcurrentCapacities, eqCount) ||
		!isUint8Array(value.eqAvailabilityModeCodes, eqCount) ||
		!isCsr(value.eqAvailabilityWindowOffsets, eqCount, windowCount) ||
		!isFloat64Array(value.eqAvailabilityWindowStartsMicroseconds, windowCount) ||
		!isFloat64Array(value.eqAvailabilityWindowEndsMicroseconds, windowCount) ||
		!isUint32Array(value.storageEquipmentGroupIds, storageCount) ||
		!isUint32Array(value.storagePolicyIds, storageCount) ||
		!isUint16Array(value.storagePolicyPriorityRanks, storageCount) ||
		!isUint32Array(value.storageCapacityUnits, storageCount) ||
		!isUint32Array(value.storageInitialOccupiedUnits, storageCount) ||
		!isCsr(value.storageInitialNamedLoadOffsets, storageCount, namedLoadCount) ||
		!isUint32Array(value.storageInitialNamedLoadRows, namedLoadCount) ||
		!isUint32Array(value.storageInitialAnonymousOccupiedUnits, storageCount) ||
		!isUint32Array(value.storageHighWaterMarkUnits, storageCount) ||
		!isInt32Array(value.initialLoadStorageResourceRows, loadCount)
	) {
		return "resident resource run columns are malformed";
	}
	const configuration = value as unknown as SimulationResidentCycleResourceRunConfiguration;
	if (
		!strictlyIncreasingPositiveIds(configuration.eqEquipmentGroupIds) ||
		!strictlyIncreasingPositiveIds(configuration.storageEquipmentGroupIds) ||
		!validEqResources(configuration) ||
		!validStorageResources(configuration)
	) {
		return "resident resource run rows are inconsistent";
	}
	const views = simulationResidentCycleResourceRunConfigurationViews(configuration);
	if (!hasIndependentOwnedBuffers(views)) {
		return "resident resource run buffers must be independent";
	}
	const byteLength = sumByteLengths(views);
	if (
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== byteLength ||
		byteLength > SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_TYPED_BYTES
	) {
		return "resident resource run typed-memory accounting is invalid";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationResidentCycleResourceRunConfiguration(configuration) !== value.fingerprint
	) {
		return "resident resource run fingerprint is invalid";
	}
	return null;
}

export function simulationResidentCycleResourceRunConfigurationMatchesSources(
	sources: SimulationResidentCycleResourceSources,
	input: SimulationResidentCycleResourceRunConfigurationInput,
	configuration: SimulationResidentCycleResourceRunConfiguration,
): boolean {
	if (
		!simulationResidentCycleResourceRunConfigurationMatchesPreparedSources(sources, configuration)
	) {
		return false;
	}
	try {
		return (
			compileSimulationResidentCycleResourceRunConfiguration(
				sources.foundation,
				sources.trackResources,
				sources.occupancyPolicy,
				sources.equipmentResources,
				sources.manifest,
				sources.parking,
				sources.routes,
				sources.leaseClaims,
				sources.admissionProgram,
				sources.serviceTiming,
				input,
			).fingerprint === configuration.fingerprint
		);
	} catch {
		return false;
	}
}

export function simulationResidentCycleResourceRunConfigurationMatchesPreparedSources(
	sources: SimulationResidentCycleResourceSources,
	configuration: SimulationResidentCycleResourceRunConfiguration,
): boolean {
	return (
		simulationResidentCycleServiceTimingMatchesPreparedSources(
			sources.foundation,
			sources.trackResources,
			sources.occupancyPolicy,
			sources.equipmentResources,
			sources.manifest,
			sources.parking,
			sources.routes,
			sources.leaseClaims,
			sources.admissionProgram,
			sources.serviceTiming,
		) &&
		simulationResidentCycleResourceRunConfigurationError(configuration) === null &&
		simulationResidentCycleResourceRunConfigurationMatchesValidatedSources(sources, configuration)
	);
}

/** Checks exact semantic row binding after every supplied artifact passed its own validator. */
export function simulationResidentCycleResourceRunConfigurationMatchesValidatedSources(
	sources: SimulationResidentCycleResourceSources,
	configuration: SimulationResidentCycleResourceRunConfiguration,
): boolean {
	return (
		configuration.sourceKind === sources.manifest.sourceKind &&
		configuration.sourceManifestFingerprint === sources.manifest.fingerprint &&
		configuration.sourceRoutesFingerprint === sources.routes.fingerprint &&
		configuration.sourceLeaseClaimsFingerprint === sources.leaseClaims.fingerprint &&
		configuration.sourceAdmissionProgramFingerprint === sources.admissionProgram.fingerprint &&
		configuration.sourceServiceTimingFingerprint === sources.serviceTiming.fingerprint &&
		configuration.sourceFoundationFingerprint === sources.foundation.fingerprint &&
		configuration.sourceEquipmentResourcesFingerprint === sources.equipmentResources.fingerprint &&
		configuration.requestCount === sources.routes.requestCount &&
		configuration.loadCount === sources.admissionProgram.loadCount &&
		resourceRowsMatchPreparedSources(sources, configuration)
	);
}

export function simulationResidentCycleResourceRunConfigurationTransfers(
	configuration: SimulationResidentCycleResourceRunConfiguration,
): readonly ArrayBuffer[] {
	const error = simulationResidentCycleResourceRunConfigurationError(configuration);
	if (error) throw new Error(`Simulation resident resource run configuration is invalid: ${error}`);
	return Object.freeze(
		simulationResidentCycleResourceRunConfigurationViews(configuration).map(
			(view) => view.buffer as ArrayBuffer,
		),
	);
}

function assertCompatibleSources(sources: SimulationResidentCycleResourceSources): void {
	if (
		!simulationResidentCycleServiceTimingMatchesPreparedSources(
			sources.foundation,
			sources.trackResources,
			sources.occupancyPolicy,
			sources.equipmentResources,
			sources.manifest,
			sources.parking,
			sources.routes,
			sources.leaseClaims,
			sources.admissionProgram,
			sources.serviceTiming,
		)
	) {
		throw new Error("Resident resource run sources are invalid or inconsistent.");
	}
}

function normalizeResourceInput(
	input: SimulationResidentCycleResourceRunConfigurationInput | NormalizedResourceInput,
): NormalizedResourceInput {
	if (!isRecord(input) || !hasExactKeys(input, RESOURCE_INPUT_KEYS)) {
		throw new Error("Resident resource run input contains missing or unexpected fields.");
	}
	if (!Array.isArray(input.eqResources) || !Array.isArray(input.initialStorageLoads)) {
		throw new Error("Resident resource run input arrays are invalid.");
	}
	if (
		input.eqResources.length > SIMULATION_SCENARIO_MAX_INPUT_RECORDS ||
		input.initialStorageLoads.length > SIMULATION_SCENARIO_MAX_INPUT_RECORDS
	) {
		throw new Error("Resident resource run input exceeds the bounded record limit.");
	}
	const eqGroupIds = new Set<number>();
	let availabilityWindowCount = 0;
	const eqResources = input.eqResources.map((value) => {
		if (!isRecord(value) || !hasExactKeys(value, EQ_RESOURCE_RECORD_KEYS)) {
			throw new Error("Resident EQ resource record is malformed.");
		}
		if (!isPositiveRecordId(value.equipmentGroupId as number)) {
			throw new Error("Resident EQ resource group ID is invalid.");
		}
		if (
			!Number.isSafeInteger(value.concurrentCapacity) ||
			(value.concurrentCapacity as number) <= 0 ||
			(value.concurrentCapacity as number) > 0xffff_ffff
		) {
			throw new Error("Resident EQ concurrent capacity is invalid.");
		}
		if (value.availabilityMode !== "ALWAYS" && value.availabilityMode !== "WINDOWS") {
			throw new Error("Resident EQ availability mode is invalid.");
		}
		if (!Array.isArray(value.availabilityWindows)) {
			throw new Error("Resident EQ availability windows must be an array.");
		}
		availabilityWindowCount += value.availabilityWindows.length;
		if (availabilityWindowCount > SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_AVAILABILITY_WINDOWS) {
			throw new Error("Resident EQ availability windows exceed the bounded input limit.");
		}
		const windows = value.availabilityWindows.map(normalizeAvailabilityWindow).sort(compareWindows);
		if (
			(value.availabilityMode === "ALWAYS" && windows.length !== 0) ||
			(value.availabilityMode === "WINDOWS" && windows.length === 0)
		) {
			throw new Error("Resident EQ availability mode and windows are inconsistent.");
		}
		for (let row = 1; row < windows.length; row++) {
			if (
				(windows[row] as SimulationScenarioAvailabilityWindow).startMicroseconds <
				(windows[row - 1] as SimulationScenarioAvailabilityWindow).endMicroseconds
			) {
				throw new Error("Resident EQ availability windows overlap.");
			}
		}
		const groupId = value.equipmentGroupId as number;
		if (eqGroupIds.has(groupId)) throw new Error(`Resident EQ group ${groupId} is duplicated.`);
		eqGroupIds.add(groupId);
		return Object.freeze({
			equipmentGroupId: groupId,
			concurrentCapacity: value.concurrentCapacity as number,
			availabilityMode: value.availabilityMode,
			availabilityWindows: Object.freeze(windows),
		}) satisfies NormalizedEqResource;
	});
	eqResources.sort((left, right) => left.equipmentGroupId - right.equipmentGroupId);

	const loadIds = new Set<string>();
	const initialStorageLoads = input.initialStorageLoads.map((value) => {
		if (!isRecord(value) || !hasExactKeys(value, INITIAL_STORAGE_LOAD_KEYS)) {
			throw new Error("Resident initial storage load record is malformed.");
		}
		if (
			!isPortableIdentity(value.loadId) ||
			!isPositiveRecordId(value.equipmentGroupId as number)
		) {
			throw new Error("Resident initial storage load identity is invalid.");
		}
		if (loadIds.has(value.loadId)) {
			throw new Error(`Resident initial storage load ${value.loadId} is duplicated.`);
		}
		loadIds.add(value.loadId);
		return Object.freeze({
			loadId: value.loadId,
			equipmentGroupId: value.equipmentGroupId as number,
		});
	});
	initialStorageLoads.sort((left, right) => compareStrings(left.loadId, right.loadId));
	return Object.freeze({
		eqResources: Object.freeze(eqResources),
		initialStorageLoads: Object.freeze(initialStorageLoads),
	});
}

function normalizeAvailabilityWindow(value: unknown): SimulationScenarioAvailabilityWindow {
	if (!isRecord(value) || !hasExactKeys(value, AVAILABILITY_WINDOW_KEYS)) {
		throw new Error("Resident EQ availability window is malformed.");
	}
	if (
		!Number.isSafeInteger(value.startMicroseconds) ||
		(value.startMicroseconds as number) < 0 ||
		!Number.isSafeInteger(value.endMicroseconds) ||
		(value.endMicroseconds as number) <= (value.startMicroseconds as number)
	) {
		throw new Error("Resident EQ availability window bounds are invalid.");
	}
	return Object.freeze({
		startMicroseconds: value.startMicroseconds as number,
		endMicroseconds: value.endMicroseconds as number,
	});
}

function requiredEqDestinationGroupIds(
	serviceTiming: SimulationResidentCycleServiceTiming,
): ReadonlySet<number> {
	const ids = new Set<number>();
	for (let requestRow = 0; requestRow < serviceTiming.requestCount; requestRow++) {
		if (
			serviceTiming.serviceKindCodes[requestRow] ===
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS
		) {
			ids.add(serviceTiming.destinationEquipmentGroupIds[requestRow] as number);
		}
	}
	return ids;
}

function assertExactEqResources(
	resources: readonly NormalizedEqResource[],
	requiredGroupIds: ReadonlySet<number>,
): void {
	if (resources.length !== requiredGroupIds.size) {
		throw new Error("Resident EQ resources must cover every and only used destination group.");
	}
	for (const resource of resources) {
		if (!requiredGroupIds.has(resource.equipmentGroupId)) {
			throw new Error(`Resident EQ group ${resource.equipmentGroupId} is not used by this run.`);
		}
	}
}

function requiredInitialStorageLoadGroups(
	foundation: SimulationStaticWorldFoundation,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
	loadIds: readonly string[],
): ReadonlyMap<string, number> {
	const required = new Map<string, number>();
	for (let loadRow = 0; loadRow < admissionProgram.loadCount; loadRow++) {
		const stationRow = admissionProgram.initialCustodyStationRows[loadRow] as number;
		if (foundation.stations.typeCodes[stationRow] === SIMULATION_STATION_TYPE_CODE.EQ) continue;
		const loadId = loadIds[loadRow];
		if (!loadId) throw new Error(`Resident load row ${loadRow} has no manifest identity.`);
		required.set(loadId, foundation.stations.equipmentGroupIds[stationRow] as number);
	}
	return required;
}

function validateInitialStorageLoads(
	records: readonly SimulationScenarioInitialStorageLoadRecord[],
	required: ReadonlyMap<string, number>,
	loadRowById: ReadonlyMap<string, number>,
): ReadonlyMap<number, number> {
	if (records.length !== required.size) {
		throw new Error("Resident initial storage inventory must name every storage-resident load.");
	}
	const groupByLoadRow = new Map<number, number>();
	for (const record of records) {
		const expectedGroupId = required.get(record.loadId);
		const loadRow = loadRowById.get(record.loadId);
		if (expectedGroupId === undefined || loadRow === undefined) {
			throw new Error(`Resident load ${record.loadId} does not start in reviewed storage.`);
		}
		if (record.equipmentGroupId !== expectedGroupId) {
			throw new Error(`Resident load ${record.loadId} initial storage group is inconsistent.`);
		}
		groupByLoadRow.set(loadRow, record.equipmentGroupId);
	}
	return groupByLoadRow;
}

function requiredStorageGroupIds(
	serviceTiming: SimulationResidentCycleServiceTiming,
	initialStorageGroupByLoadRow: ReadonlyMap<number, number>,
): readonly number[] {
	const ids = new Set(initialStorageGroupByLoadRow.values());
	for (let requestRow = 0; requestRow < serviceTiming.requestCount; requestRow++) {
		if (
			serviceTiming.serviceKindCodes[requestRow] !==
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS
		) {
			ids.add(serviceTiming.destinationEquipmentGroupIds[requestRow] as number);
		}
	}
	return Object.freeze([...ids].sort((left, right) => left - right));
}

function resourceRowsMatchPreparedSources(
	sources: SimulationResidentCycleResourceSources,
	configuration: SimulationResidentCycleResourceRunConfiguration,
): boolean {
	const expectedEqGroupIds = [...requiredEqDestinationGroupIds(sources.serviceTiming)].sort(
		(left, right) => left - right,
	);
	if (!sameNumbers(configuration.eqEquipmentGroupIds, expectedEqGroupIds)) return false;
	const storageGroupIds = new Set<number>();
	for (let requestRow = 0; requestRow < sources.serviceTiming.requestCount; requestRow++) {
		if (
			sources.serviceTiming.serviceKindCodes[requestRow] !==
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS
		) {
			storageGroupIds.add(sources.serviceTiming.destinationEquipmentGroupIds[requestRow] as number);
		}
	}
	const expectedInitialStorageGroupByLoadRow = new Map<number, number>();
	for (let loadRow = 0; loadRow < sources.admissionProgram.loadCount; loadRow++) {
		const stationRow = sources.admissionProgram.initialCustodyStationRows[loadRow] as number;
		if (sources.foundation.stations.typeCodes[stationRow] === SIMULATION_STATION_TYPE_CODE.EQ) {
			if (configuration.initialLoadStorageResourceRows[loadRow] !== -1) return false;
			continue;
		}
		const groupId = sources.foundation.stations.equipmentGroupIds[stationRow] as number;
		storageGroupIds.add(groupId);
		expectedInitialStorageGroupByLoadRow.set(loadRow, groupId);
	}
	const expectedStorageGroupIds = [...storageGroupIds].sort((left, right) => left - right);
	if (!sameNumbers(configuration.storageEquipmentGroupIds, expectedStorageGroupIds)) return false;
	const equipmentGroupRowById = rowsById(sources.equipmentResources.groupIds);
	const policyRowById = rowsById(sources.equipmentResources.storagePolicyIds);
	const storageRowByGroupId = rowsById(configuration.storageEquipmentGroupIds);
	for (let storageRow = 0; storageRow < configuration.storageResourceCount; storageRow++) {
		const groupId = configuration.storageEquipmentGroupIds[storageRow] as number;
		const groupRow = equipmentGroupRowById.get(groupId);
		if (groupRow === undefined) return false;
		const policyId = sources.equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		if (
			policyRow === undefined ||
			configuration.storagePolicyIds[storageRow] !== policyId ||
			configuration.storagePolicyPriorityRanks[storageRow] !==
				sources.equipmentResources.storagePolicyPriorityRanks[policyRow] ||
			configuration.storageCapacityUnits[storageRow] !==
				sources.equipmentResources.storageGroupCapacityUnits[groupRow] ||
			configuration.storageInitialOccupiedUnits[storageRow] !==
				sources.equipmentResources.storageGroupInitialOccupiedUnits[groupRow] ||
			configuration.storageHighWaterMarkUnits[storageRow] !==
				sources.equipmentResources.storageGroupHighWaterMarkUnits[groupRow]
		) {
			return false;
		}
	}
	for (let loadRow = 0; loadRow < configuration.loadCount; loadRow++) {
		const expectedGroupId = expectedInitialStorageGroupByLoadRow.get(loadRow);
		if (expectedGroupId === undefined) continue;
		if (
			configuration.initialLoadStorageResourceRows[loadRow] !==
			storageRowByGroupId.get(expectedGroupId)
		) {
			return false;
		}
	}
	return true;
}

function validEqResources(configuration: SimulationResidentCycleResourceRunConfiguration): boolean {
	for (let row = 0; row < configuration.eqResourceCount; row++) {
		const mode = configuration.eqAvailabilityModeCodes[row] as number;
		const start = configuration.eqAvailabilityWindowOffsets[row] as number;
		const end = configuration.eqAvailabilityWindowOffsets[row + 1] as number;
		if (
			configuration.eqConcurrentCapacities[row] === 0 ||
			(mode !== SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.ALWAYS &&
				mode !== SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.WINDOWS) ||
			(mode === SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.ALWAYS && start !== end) ||
			(mode === SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.WINDOWS && start === end)
		) {
			return false;
		}
		let previousEnd = -1;
		for (let windowRow = start; windowRow < end; windowRow++) {
			const windowStart = configuration.eqAvailabilityWindowStartsMicroseconds[windowRow] as number;
			const windowEnd = configuration.eqAvailabilityWindowEndsMicroseconds[windowRow] as number;
			if (
				!Number.isSafeInteger(windowStart) ||
				!Number.isSafeInteger(windowEnd) ||
				windowStart < 0 ||
				windowEnd <= windowStart ||
				windowStart < previousEnd
			) {
				return false;
			}
			previousEnd = windowEnd;
		}
	}
	return true;
}

function validStorageResources(
	configuration: SimulationResidentCycleResourceRunConfiguration,
): boolean {
	const seenLoadRows = new Uint8Array(configuration.loadCount);
	for (let storageRow = 0; storageRow < configuration.storageResourceCount; storageRow++) {
		const capacity = configuration.storageCapacityUnits[storageRow] as number;
		const initial = configuration.storageInitialOccupiedUnits[storageRow] as number;
		const anonymous = configuration.storageInitialAnonymousOccupiedUnits[storageRow] as number;
		const highWater = configuration.storageHighWaterMarkUnits[storageRow] as number;
		const start = configuration.storageInitialNamedLoadOffsets[storageRow] as number;
		const end = configuration.storageInitialNamedLoadOffsets[storageRow + 1] as number;
		if (
			configuration.storagePolicyIds[storageRow] === 0 ||
			capacity === 0 ||
			initial > capacity ||
			highWater > capacity ||
			anonymous + (end - start) !== initial
		) {
			return false;
		}
		for (let namedRow = start; namedRow < end; namedRow++) {
			const loadRow = configuration.storageInitialNamedLoadRows[namedRow] as number;
			if (
				loadRow >= configuration.loadCount ||
				seenLoadRows[loadRow] !== 0 ||
				configuration.initialLoadStorageResourceRows[loadRow] !== storageRow
			) {
				return false;
			}
			seenLoadRows[loadRow] = 1;
		}
	}
	for (let loadRow = 0; loadRow < configuration.loadCount; loadRow++) {
		const resourceRow = configuration.initialLoadStorageResourceRows[loadRow] as number;
		if (resourceRow < -1 || resourceRow >= configuration.storageResourceCount) return false;
		if (resourceRow >= 0 !== (seenLoadRows[loadRow] === 1)) return false;
	}
	return true;
}

function simulationResidentCycleResourceRunConfigurationViews(
	configuration: Omit<
		SimulationResidentCycleResourceRunConfiguration,
		"fingerprint" | "byteLength"
	>,
): readonly ArrayBufferView[] {
	return [
		configuration.eqEquipmentGroupIds,
		configuration.eqConcurrentCapacities,
		configuration.eqAvailabilityModeCodes,
		configuration.eqAvailabilityWindowOffsets,
		configuration.eqAvailabilityWindowStartsMicroseconds,
		configuration.eqAvailabilityWindowEndsMicroseconds,
		configuration.storageEquipmentGroupIds,
		configuration.storagePolicyIds,
		configuration.storagePolicyPriorityRanks,
		configuration.storageCapacityUnits,
		configuration.storageInitialOccupiedUnits,
		configuration.storageInitialNamedLoadOffsets,
		configuration.storageInitialNamedLoadRows,
		configuration.storageInitialAnonymousOccupiedUnits,
		configuration.storageHighWaterMarkUnits,
		configuration.initialLoadStorageResourceRows,
	];
}

function assertTypedMemoryLimit(
	eqCount: number,
	windowCount: number,
	storageCount: number,
	namedLoadCount: number,
	loadCount: number,
): void {
	const bytes =
		eqCount * 13 +
		4 +
		windowCount * 16 +
		storageCount * 30 +
		4 +
		namedLoadCount * 4 +
		loadCount * 4;
	if (!Number.isSafeInteger(bytes) || bytes > SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_TYPED_BYTES) {
		throw new Error("Resident resource run configuration exceeds its typed-memory limit.");
	}
}

function compareWindows(
	left: SimulationScenarioAvailabilityWindow,
	right: SimulationScenarioAvailabilityWindow,
): number {
	return (
		left.startMicroseconds - right.startMicroseconds || left.endMicroseconds - right.endMicroseconds
	);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function rowsById(ids: Uint32Array): Map<number, number> {
	return new Map([...ids].map((id, row) => [id, row]));
}

function sameNumbers(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let row = 0; row < left.length; row++) {
		if (left[row] !== right[row]) return false;
	}
	return true;
}

function strictlyIncreasingPositiveIds(ids: Uint32Array): boolean {
	let previous = 0;
	for (const id of ids) {
		if (id <= previous) return false;
		previous = id;
	}
	return true;
}

function isCsr(value: unknown, rowCount: number, valueCount: number): value is Uint32Array {
	if (!(value instanceof Uint32Array) || value.length !== rowCount + 1 || value[0] !== 0) {
		return false;
	}
	let previous = 0;
	for (const offset of value) {
		if (offset < previous || offset > valueCount) return false;
		previous = offset;
	}
	return value[rowCount] === valueCount;
}

function hasIndependentOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		if (
			!(view.buffer instanceof ArrayBuffer) ||
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

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((total, view) => total + view.byteLength, 0);
}

function isPortableIdentity(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n\0]/u.test(value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, row) => entry === expected[row])
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isUint16Array(value: unknown, length: number): value is Uint16Array {
	return value instanceof Uint16Array && value.length === length;
}

function isUint8Array(value: unknown, length: number): value is Uint8Array {
	return value instanceof Uint8Array && value.length === length;
}

function isInt32Array(value: unknown, length: number): value is Int32Array {
	return value instanceof Int32Array && value.length === length;
}

function isFloat64Array(value: unknown, length: number): value is Float64Array {
	return value instanceof Float64Array && value.length === length;
}
