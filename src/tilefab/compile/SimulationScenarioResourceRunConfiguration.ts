import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";
import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "./SimulationReadinessCertificate";
import {
	type SimulationScenarioAdmissionProgram,
	simulationScenarioAdmissionProgramError,
	simulationScenarioAdmissionProgramMatchesValidatedSources,
} from "./SimulationScenarioAdmissionProgram";
import {
	type SimulationScenarioLeaseClaims,
	simulationScenarioLeaseClaimsError,
	simulationScenarioLeaseClaimsMatchValidatedSources,
} from "./SimulationScenarioLeaseClaims";
import {
	type SimulationScenarioManifest,
	simulationScenarioManifestError,
} from "./SimulationScenarioManifest";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestsError,
	simulationScenarioRouteRequestsMatchValidatedSources,
} from "./SimulationScenarioRouteRequests";
import {
	SIMULATION_SCENARIO_SERVICE_KIND_CODE,
	type SimulationScenarioServiceTiming,
	simulationScenarioServiceTimingError,
	simulationScenarioServiceTimingMatchesValidatedSources,
} from "./SimulationScenarioServiceTiming";
import { SIMULATION_STATION_TYPE_CODE } from "./SimulationStaticWorldFoundation";

export const SIMULATION_SCENARIO_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE = Object.freeze({
	ALWAYS: 1,
	WINDOWS: 2,
} as const);
export const SIMULATION_SCENARIO_EQ_CAPACITY_POLICY =
	"GROUP_CONCURRENT_ACTIVE_SERVICE_LIMIT_V1" as const;
export const SIMULATION_SCENARIO_EQ_QUEUE_POLICY =
	"READY_TIME_THEN_REQUEST_ROW_WITHOUT_PREEMPTION_V1" as const;
export const SIMULATION_SCENARIO_STORAGE_RESERVATION_POLICY =
	"ATOMIC_WITH_ROUTE_LEASE_UNTIL_DESTINATION_ARRIVAL_V1" as const;
export const SIMULATION_SCENARIO_STORAGE_HIGH_WATER_POLICY =
	"PROJECTED_OCCUPANCY_NOT_ABOVE_HIGH_WATER_MARK_V1" as const;
export const SIMULATION_SCENARIO_STORAGE_DESTINATION_POLICY =
	"EXACT_REQUEST_DESTINATION_NO_DYNAMIC_SUBSTITUTION_V1" as const;
export const SIMULATION_SCENARIO_RESOURCE_RUN_MISSING_RUNTIME_LAYERS = Object.freeze([
	"EXACT_SOURCE_RUN_AUTHORIZATION",
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
const RESOURCE_CONFIGURATION_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingRuntimeLayers",
	"eqCapacityPolicy",
	"eqQueuePolicy",
	"storageReservationPolicy",
	"storageHighWaterPolicy",
	"storageDestinationPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceRouteRequestsFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceAdmissionProgramFingerprint",
	"sourceServiceTimingFingerprint",
	"sourceCertificateFingerprint",
	"sourceEquipmentResourcesFingerprint",
	"sourceResourceInputFingerprint",
	"runIdentityFingerprint",
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

export interface SimulationScenarioAvailabilityWindow {
	readonly startMicroseconds: number;
	readonly endMicroseconds: number;
}

export interface SimulationScenarioEqRunResourceRecord {
	readonly equipmentGroupId: number;
	readonly concurrentCapacity: number;
	readonly availabilityMode: "ALWAYS" | "WINDOWS";
	readonly availabilityWindows: readonly SimulationScenarioAvailabilityWindow[];
}

export interface SimulationScenarioInitialStorageLoadRecord {
	readonly loadId: string;
	readonly equipmentGroupId: number;
}

export interface SimulationScenarioResourceRunConfigurationInput {
	readonly eqResources: readonly SimulationScenarioEqRunResourceRecord[];
	readonly initialStorageLoads: readonly SimulationScenarioInitialStorageLoadRecord[];
}

export interface SimulationScenarioResourceRunConfiguration {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingRuntimeLayers: typeof SIMULATION_SCENARIO_RESOURCE_RUN_MISSING_RUNTIME_LAYERS;
	readonly eqCapacityPolicy: typeof SIMULATION_SCENARIO_EQ_CAPACITY_POLICY;
	readonly eqQueuePolicy: typeof SIMULATION_SCENARIO_EQ_QUEUE_POLICY;
	readonly storageReservationPolicy: typeof SIMULATION_SCENARIO_STORAGE_RESERVATION_POLICY;
	readonly storageHighWaterPolicy: typeof SIMULATION_SCENARIO_STORAGE_HIGH_WATER_POLICY;
	readonly storageDestinationPolicy: typeof SIMULATION_SCENARIO_STORAGE_DESTINATION_POLICY;
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceRouteRequestsFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceAdmissionProgramFingerprint: string;
	readonly sourceServiceTimingFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly sourceEquipmentResourcesFingerprint: string;
	readonly sourceResourceInputFingerprint: string;
	readonly runIdentityFingerprint: string;
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
	/** Minus one means that the named load starts at a non-storage station. */
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

/** Compiles explicit run-only resource inputs without persisting raw scenario identities. */
export function compileSimulationScenarioResourceRunConfiguration(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
	input: SimulationScenarioResourceRunConfigurationInput,
): SimulationScenarioResourceRunConfiguration {
	assertCompatibleSources(snapshot, manifest, routes, leaseClaims, admissionProgram, serviceTiming);
	return compileSimulationScenarioResourceRunConfigurationFromValidatedSources(
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		input,
		true,
	);
}

function compileSimulationScenarioResourceRunConfigurationFromValidatedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
	input: SimulationScenarioResourceRunConfigurationInput,
	validateOutput: boolean,
): SimulationScenarioResourceRunConfiguration {
	const normalized = normalizeResourceInput(input);
	const requiredEqGroupIds = requiredEqDestinationGroupIds(serviceTiming);
	assertExactEqResources(normalized.eqResources, requiredEqGroupIds);

	const loadIds = [...new Set(manifest.records.map((record) => record.loadId))].sort(
		compareStrings,
	);
	if (loadIds.length !== admissionProgram.loadCount) {
		throw new Error("Scenario load identities do not match the admission program.");
	}
	const loadRowById = new Map(loadIds.map((loadId, loadRow) => [loadId, loadRow]));
	const groupRowById = rowsById(snapshot.equipmentResources.groupIds);
	const policyRowById = rowsById(snapshot.equipmentResources.storagePolicyIds);
	const requiredInitialStorageLoads = requiredInitialStorageLoadGroups(
		snapshot,
		admissionProgram,
		loadIds,
	);
	const initialStorageGroupByLoadRow = validateInitialStorageLoads(
		normalized.initialStorageLoads,
		requiredInitialStorageLoads,
		loadRowById,
	);
	const storageGroupIds = requiredStorageGroupIds(serviceTiming, initialStorageGroupByLoadRow);

	const eqEquipmentGroupIds = new Uint32Array(normalized.eqResources.length);
	const eqConcurrentCapacities = new Uint32Array(normalized.eqResources.length);
	const eqAvailabilityModeCodes = new Uint8Array(normalized.eqResources.length);
	const eqAvailabilityWindowOffsets = new Uint32Array(normalized.eqResources.length + 1);
	const availabilityStarts: number[] = [];
	const availabilityEnds: number[] = [];
	for (let row = 0; row < normalized.eqResources.length; row++) {
		const resource = normalized.eqResources[row] as NormalizedEqResource;
		eqEquipmentGroupIds[row] = resource.equipmentGroupId;
		eqConcurrentCapacities[row] = resource.concurrentCapacity;
		eqAvailabilityModeCodes[row] =
			SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE[resource.availabilityMode];
		eqAvailabilityWindowOffsets[row] = availabilityStarts.length;
		for (const window of resource.availabilityWindows) {
			availabilityStarts.push(window.startMicroseconds);
			availabilityEnds.push(window.endMicroseconds);
		}
	}
	eqAvailabilityWindowOffsets[normalized.eqResources.length] = availabilityStarts.length;

	const storageEquipmentGroupIds = Uint32Array.from(storageGroupIds);
	const storagePolicyIds = new Uint32Array(storageGroupIds.length);
	const storagePolicyPriorityRanks = new Uint16Array(storageGroupIds.length);
	const storageCapacityUnits = new Uint32Array(storageGroupIds.length);
	const storageInitialOccupiedUnits = new Uint32Array(storageGroupIds.length);
	const storageInitialNamedLoadOffsets = new Uint32Array(storageGroupIds.length + 1);
	const storageInitialNamedLoadRows: number[] = [];
	const storageInitialAnonymousOccupiedUnits = new Uint32Array(storageGroupIds.length);
	const storageHighWaterMarkUnits = new Uint32Array(storageGroupIds.length);
	const storageResourceRowByGroupId = new Map(
		storageGroupIds.map((groupId, row) => [groupId, row]),
	);
	const initialLoadStorageResourceRows = new Int32Array(loadIds.length).fill(-1);

	for (let storageRow = 0; storageRow < storageGroupIds.length; storageRow++) {
		const groupId = storageGroupIds[storageRow] as number;
		const groupRow = groupRowById.get(groupId);
		if (groupRow === undefined) throw new Error(`Scenario storage group ${groupId} is unknown.`);
		const policyId = snapshot.equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		if (policyRow === undefined) {
			throw new Error(`Scenario storage group ${groupId} has no certified policy.`);
		}
		const initialOccupied = snapshot.equipmentResources.storageGroupInitialOccupiedUnits[
			groupRow
		] as number;
		storagePolicyIds[storageRow] = policyId;
		storagePolicyPriorityRanks[storageRow] = snapshot.equipmentResources.storagePolicyPriorityRanks[
			policyRow
		] as number;
		storageCapacityUnits[storageRow] = snapshot.equipmentResources.storageGroupCapacityUnits[
			groupRow
		] as number;
		storageInitialOccupiedUnits[storageRow] = initialOccupied;
		storageHighWaterMarkUnits[storageRow] = snapshot.equipmentResources
			.storageGroupHighWaterMarkUnits[groupRow] as number;
		storageInitialNamedLoadOffsets[storageRow] = storageInitialNamedLoadRows.length;
		for (let loadRow = 0; loadRow < loadIds.length; loadRow++) {
			if (initialStorageGroupByLoadRow.get(loadRow) !== groupId) continue;
			storageInitialNamedLoadRows.push(loadRow);
			initialLoadStorageResourceRows[loadRow] = storageRow;
		}
		const namedCount =
			storageInitialNamedLoadRows.length - (storageInitialNamedLoadOffsets[storageRow] as number);
		if (namedCount > initialOccupied) {
			throw new Error(
				`Scenario storage group ${groupId} has more named loads than certified initial occupancy.`,
			);
		}
		storageInitialAnonymousOccupiedUnits[storageRow] = initialOccupied - namedCount;
	}
	storageInitialNamedLoadOffsets[storageGroupIds.length] = storageInitialNamedLoadRows.length;
	for (const groupId of initialStorageGroupByLoadRow.values()) {
		if (!storageResourceRowByGroupId.has(groupId)) {
			throw new Error(`Scenario initial storage group ${groupId} has no runtime resource row.`);
		}
	}

	const configurationWithoutIdentity = {
		schemaVersion: SIMULATION_SCENARIO_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION,
		simulationRunnable: false,
		missingRuntimeLayers: SIMULATION_SCENARIO_RESOURCE_RUN_MISSING_RUNTIME_LAYERS,
		eqCapacityPolicy: SIMULATION_SCENARIO_EQ_CAPACITY_POLICY,
		eqQueuePolicy: SIMULATION_SCENARIO_EQ_QUEUE_POLICY,
		storageReservationPolicy: SIMULATION_SCENARIO_STORAGE_RESERVATION_POLICY,
		storageHighWaterPolicy: SIMULATION_SCENARIO_STORAGE_HIGH_WATER_POLICY,
		storageDestinationPolicy: SIMULATION_SCENARIO_STORAGE_DESTINATION_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceRouteRequestsFingerprint: routes.fingerprint,
		sourceLeaseClaimsFingerprint: leaseClaims.fingerprint,
		sourceAdmissionProgramFingerprint: admissionProgram.fingerprint,
		sourceServiceTimingFingerprint: serviceTiming.fingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		sourceEquipmentResourcesFingerprint: snapshot.equipmentResources.fingerprint,
		sourceResourceInputFingerprint: checksumSimulationScenarioResourceRunConfigurationInput(
			manifest,
			normalized,
		),
		runIdentityFingerprint: routes.runIdentityFingerprint,
		requestCount: routes.requestCount,
		loadCount: admissionProgram.loadCount,
		eqResourceCount: normalized.eqResources.length,
		storageResourceCount: storageGroupIds.length,
		eqEquipmentGroupIds,
		eqConcurrentCapacities,
		eqAvailabilityModeCodes,
		eqAvailabilityWindowOffsets,
		eqAvailabilityWindowStartsMicroseconds: Float64Array.from(availabilityStarts),
		eqAvailabilityWindowEndsMicroseconds: Float64Array.from(availabilityEnds),
		storageEquipmentGroupIds,
		storagePolicyIds,
		storagePolicyPriorityRanks,
		storageCapacityUnits,
		storageInitialOccupiedUnits,
		storageInitialNamedLoadOffsets,
		storageInitialNamedLoadRows: Uint32Array.from(storageInitialNamedLoadRows),
		storageInitialAnonymousOccupiedUnits,
		storageHighWaterMarkUnits,
		initialLoadStorageResourceRows,
	} as const;
	const views = simulationScenarioResourceRunConfigurationViews(configurationWithoutIdentity);
	const configuration = Object.freeze({
		...configurationWithoutIdentity,
		fingerprint: checksumSimulationScenarioResourceRunConfiguration(configurationWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationScenarioResourceRunConfiguration;
	if (validateOutput) {
		const error = simulationScenarioResourceRunConfigurationError(configuration);
		if (error) throw new Error(`Scenario resource run configuration is invalid: ${error}`);
	}
	return configuration;
}

export function checksumSimulationScenarioResourceRunConfigurationInput(
	manifest: SimulationScenarioManifest,
	input: SimulationScenarioResourceRunConfigurationInput | NormalizedResourceInput,
): string {
	const manifestError = simulationScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation scenario manifest is invalid: ${manifestError}`);
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
		checksum.addNumbers([load.equipmentGroupId]);
		checksum.addStrings([load.loadId]);
	}
	return checksum.digest();
}

export function checksumSimulationScenarioResourceRunConfiguration(
	configuration: Omit<SimulationScenarioResourceRunConfiguration, "fingerprint" | "byteLength">,
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
		...configuration.missingRuntimeLayers,
		configuration.eqCapacityPolicy,
		configuration.eqQueuePolicy,
		configuration.storageReservationPolicy,
		configuration.storageHighWaterPolicy,
		configuration.storageDestinationPolicy,
		configuration.sourceKind,
		configuration.sourceManifestFingerprint,
		configuration.sourceRouteRequestsFingerprint,
		configuration.sourceLeaseClaimsFingerprint,
		configuration.sourceAdmissionProgramFingerprint,
		configuration.sourceServiceTimingFingerprint,
		configuration.sourceCertificateFingerprint,
		configuration.sourceEquipmentResourcesFingerprint,
		configuration.sourceResourceInputFingerprint,
		configuration.runIdentityFingerprint,
	]);
	checksum.addViews(simulationScenarioResourceRunConfigurationViews(configuration));
	return checksum.digest();
}

export function simulationScenarioResourceRunConfigurationError(value: unknown): string | null {
	if (!isRecord(value)) return "scenario resource run configuration must be an object";
	if (!hasExactKeys(value, RESOURCE_CONFIGURATION_KEYS)) {
		return "scenario resource run configuration contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_SCENARIO_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingRuntimeLayers,
			SIMULATION_SCENARIO_RESOURCE_RUN_MISSING_RUNTIME_LAYERS,
		) ||
		value.eqCapacityPolicy !== SIMULATION_SCENARIO_EQ_CAPACITY_POLICY ||
		value.eqQueuePolicy !== SIMULATION_SCENARIO_EQ_QUEUE_POLICY ||
		value.storageReservationPolicy !== SIMULATION_SCENARIO_STORAGE_RESERVATION_POLICY ||
		value.storageHighWaterPolicy !== SIMULATION_SCENARIO_STORAGE_HIGH_WATER_POLICY ||
		value.storageDestinationPolicy !== SIMULATION_SCENARIO_STORAGE_DESTINATION_POLICY ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY")
	) {
		return "resource run policy or source kind is invalid";
	}
	for (const key of [
		"sourceManifestFingerprint",
		"sourceRouteRequestsFingerprint",
		"sourceLeaseClaimsFingerprint",
		"sourceAdmissionProgramFingerprint",
		"sourceServiceTimingFingerprint",
		"sourceCertificateFingerprint",
		"sourceEquipmentResourcesFingerprint",
		"sourceResourceInputFingerprint",
		"runIdentityFingerprint",
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
		return "resource run counts are invalid";
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
		return "resource run columns are malformed";
	}
	const configuration = value as unknown as SimulationScenarioResourceRunConfiguration;
	if (
		!strictlyIncreasingPositiveIds(configuration.eqEquipmentGroupIds) ||
		!strictlyIncreasingPositiveIds(configuration.storageEquipmentGroupIds) ||
		!validEqResources(configuration) ||
		!validStorageResources(configuration)
	) {
		return "resource run rows are inconsistent";
	}
	const views = simulationScenarioResourceRunConfigurationViews(configuration);
	if (!hasIndependentOwnedBuffers(views)) return "resource run buffers are not independent";
	if (value.byteLength !== sumByteLengths(views)) return "resource run byte length is invalid";
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationScenarioResourceRunConfiguration(configuration) !== value.fingerprint
	) {
		return "resource run fingerprint is invalid";
	}
	return null;
}

export function simulationScenarioResourceRunConfigurationMatchesSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
	input: SimulationScenarioResourceRunConfigurationInput,
	configuration: SimulationScenarioResourceRunConfiguration,
): boolean {
	if (
		!simulationScenarioResourceRunConfigurationMatchesPreparedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			configuration,
		)
	) {
		return false;
	}
	let inputFingerprint: string;
	let expectedFingerprint: string;
	try {
		inputFingerprint = checksumSimulationScenarioResourceRunConfigurationInput(manifest, input);
		expectedFingerprint = compileSimulationScenarioResourceRunConfigurationFromValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			input,
			false,
		).fingerprint;
	} catch {
		return false;
	}
	return (
		configuration.sourceResourceInputFingerprint === inputFingerprint &&
		configuration.fingerprint === expectedFingerprint
	);
}

/** Validates an owned configuration against prepared runtime artifacts without retaining raw input. */
export function simulationScenarioResourceRunConfigurationMatchesPreparedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
	configuration: SimulationScenarioResourceRunConfiguration,
): boolean {
	return (
		sourcesMatch(snapshot, manifest, routes, leaseClaims, admissionProgram, serviceTiming) &&
		simulationScenarioResourceRunConfigurationError(configuration) === null &&
		simulationScenarioResourceRunConfigurationMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			configuration,
		)
	);
}

/** Checks exact source binding after each supplied artifact has passed its own error validator. */
export function simulationScenarioResourceRunConfigurationMatchesValidatedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
	configuration: SimulationScenarioResourceRunConfiguration,
): boolean {
	return (
		configuration.sourceKind === manifest.sourceKind &&
		configuration.sourceManifestFingerprint === manifest.fingerprint &&
		configuration.sourceRouteRequestsFingerprint === routes.fingerprint &&
		configuration.sourceLeaseClaimsFingerprint === leaseClaims.fingerprint &&
		configuration.sourceAdmissionProgramFingerprint === admissionProgram.fingerprint &&
		configuration.sourceServiceTimingFingerprint === serviceTiming.fingerprint &&
		configuration.sourceCertificateFingerprint === snapshot.certificate.fingerprint &&
		configuration.sourceEquipmentResourcesFingerprint === snapshot.equipmentResources.fingerprint &&
		configuration.runIdentityFingerprint === routes.runIdentityFingerprint &&
		configuration.requestCount === routes.requestCount &&
		configuration.loadCount === admissionProgram.loadCount
	);
}

export function simulationScenarioResourceRunConfigurationTransfers(
	configuration: SimulationScenarioResourceRunConfiguration,
): readonly ArrayBuffer[] {
	const error = simulationScenarioResourceRunConfigurationError(configuration);
	if (error) throw new Error(`Scenario resource run configuration is invalid: ${error}`);
	return Object.freeze(
		simulationScenarioResourceRunConfigurationViews(configuration).map((view) => {
			if (!(view.buffer instanceof ArrayBuffer)) {
				throw new Error("Scenario resource run configuration contains a shared buffer.");
			}
			return view.buffer;
		}),
	);
}

function assertCompatibleSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
): void {
	if (!sourcesMatch(snapshot, manifest, routes, leaseClaims, admissionProgram, serviceTiming)) {
		throw new Error("Scenario resource run sources are invalid or inconsistent.");
	}
}

function sourcesMatch(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
): boolean {
	return (
		publishedSimulationReadinessSnapshotError(snapshot) === null &&
		simulationScenarioManifestError(manifest) === null &&
		simulationScenarioRouteRequestsError(routes) === null &&
		simulationScenarioLeaseClaimsError(leaseClaims) === null &&
		simulationScenarioAdmissionProgramError(admissionProgram) === null &&
		simulationScenarioServiceTimingError(serviceTiming) === null &&
		simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, routes) &&
		simulationScenarioLeaseClaimsMatchValidatedSources(snapshot, routes, leaseClaims) &&
		simulationScenarioAdmissionProgramMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
		) &&
		simulationScenarioServiceTimingMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
		)
	);
}

function normalizeResourceInput(
	input: SimulationScenarioResourceRunConfigurationInput | NormalizedResourceInput,
): NormalizedResourceInput {
	if (!isRecord(input)) throw new Error("Scenario resource run input must be an object.");
	if (!hasExactKeys(input, RESOURCE_INPUT_KEYS)) {
		throw new Error("Scenario resource run input contains missing or unexpected fields.");
	}
	if (!Array.isArray(input.eqResources) || !Array.isArray(input.initialStorageLoads)) {
		throw new Error("Scenario resource run input arrays are invalid.");
	}
	const eqGroupIds = new Set<number>();
	const eqResources = input.eqResources.map((value) => {
		if (!isRecord(value) || !hasExactKeys(value, EQ_RESOURCE_RECORD_KEYS)) {
			throw new Error("Scenario EQ resource record is malformed.");
		}
		if (!isPositiveRecordId(value.equipmentGroupId as number)) {
			throw new Error("Scenario EQ resource group ID is invalid.");
		}
		if (
			!Number.isSafeInteger(value.concurrentCapacity) ||
			(value.concurrentCapacity as number) <= 0 ||
			(value.concurrentCapacity as number) > 0xffff_ffff
		) {
			throw new Error("Scenario EQ concurrent capacity is invalid.");
		}
		if (value.availabilityMode !== "ALWAYS" && value.availabilityMode !== "WINDOWS") {
			throw new Error("Scenario EQ availability mode is invalid.");
		}
		if (!Array.isArray(value.availabilityWindows)) {
			throw new Error("Scenario EQ availability windows must be an array.");
		}
		const windows = value.availabilityWindows.map(normalizeAvailabilityWindow).sort(compareWindows);
		if (
			(value.availabilityMode === "ALWAYS" && windows.length !== 0) ||
			(value.availabilityMode === "WINDOWS" && windows.length === 0)
		) {
			throw new Error("Scenario EQ availability mode and windows are inconsistent.");
		}
		for (let index = 1; index < windows.length; index++) {
			if (
				(windows[index] as SimulationScenarioAvailabilityWindow).startMicroseconds <
				(windows[index - 1] as SimulationScenarioAvailabilityWindow).endMicroseconds
			) {
				throw new Error("Scenario EQ availability windows overlap.");
			}
		}
		const groupId = value.equipmentGroupId as number;
		if (eqGroupIds.has(groupId)) throw new Error(`Scenario EQ group ${groupId} is duplicated.`);
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
			throw new Error("Scenario initial storage load record is malformed.");
		}
		if (
			!isPortableIdentity(value.loadId) ||
			!isPositiveRecordId(value.equipmentGroupId as number)
		) {
			throw new Error("Scenario initial storage load identity is invalid.");
		}
		if (loadIds.has(value.loadId)) {
			throw new Error(`Scenario initial storage load ${value.loadId} is duplicated.`);
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
		throw new Error("Scenario EQ availability window is malformed.");
	}
	if (
		!Number.isSafeInteger(value.startMicroseconds) ||
		(value.startMicroseconds as number) < 0 ||
		!Number.isSafeInteger(value.endMicroseconds) ||
		(value.endMicroseconds as number) <= (value.startMicroseconds as number)
	) {
		throw new Error("Scenario EQ availability window bounds are invalid.");
	}
	return Object.freeze({
		startMicroseconds: value.startMicroseconds as number,
		endMicroseconds: value.endMicroseconds as number,
	});
}

function requiredEqDestinationGroupIds(
	serviceTiming: SimulationScenarioServiceTiming,
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
		throw new Error("Scenario EQ resources must cover every and only used destination group.");
	}
	for (const resource of resources) {
		if (!requiredGroupIds.has(resource.equipmentGroupId)) {
			throw new Error(`Scenario EQ group ${resource.equipmentGroupId} is not used by this run.`);
		}
	}
}

function requiredInitialStorageLoadGroups(
	snapshot: PublishedSimulationReadinessSnapshot,
	admissionProgram: SimulationScenarioAdmissionProgram,
	loadIds: readonly string[],
): ReadonlyMap<string, number> {
	const required = new Map<string, number>();
	for (let loadRow = 0; loadRow < admissionProgram.loadCount; loadRow++) {
		const stationRow = admissionProgram.initialCustodyStationRows[loadRow] as number;
		if (snapshot.foundation.stations.typeCodes[stationRow] === SIMULATION_STATION_TYPE_CODE.EQ) {
			continue;
		}
		const loadId = loadIds[loadRow];
		if (!loadId) throw new Error(`Scenario load row ${loadRow} has no manifest identity.`);
		required.set(loadId, snapshot.foundation.stations.equipmentGroupIds[stationRow] as number);
	}
	return required;
}

function validateInitialStorageLoads(
	records: readonly SimulationScenarioInitialStorageLoadRecord[],
	required: ReadonlyMap<string, number>,
	loadRowById: ReadonlyMap<string, number>,
): ReadonlyMap<number, number> {
	if (records.length !== required.size) {
		throw new Error("Scenario initial storage inventory must name every storage-resident load.");
	}
	const groupByLoadRow = new Map<number, number>();
	for (const record of records) {
		const expectedGroupId = required.get(record.loadId);
		const loadRow = loadRowById.get(record.loadId);
		if (expectedGroupId === undefined || loadRow === undefined) {
			throw new Error(`Scenario load ${record.loadId} does not start in certified storage.`);
		}
		if (record.equipmentGroupId !== expectedGroupId) {
			throw new Error(`Scenario load ${record.loadId} initial storage group is inconsistent.`);
		}
		groupByLoadRow.set(loadRow, record.equipmentGroupId);
	}
	return groupByLoadRow;
}

function requiredStorageGroupIds(
	serviceTiming: SimulationScenarioServiceTiming,
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

function validEqResources(configuration: SimulationScenarioResourceRunConfiguration): boolean {
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

function validStorageResources(configuration: SimulationScenarioResourceRunConfiguration): boolean {
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

function simulationScenarioResourceRunConfigurationViews(
	configuration: Omit<SimulationScenarioResourceRunConfiguration, "fingerprint" | "byteLength">,
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

function rowsById(ids: Uint32Array): Map<number, number> {
	return new Map([...ids].map((id, row) => [id, row]));
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
		value.every((entry, index) => entry === expected[index])
	);
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

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((total, view) => total + view.byteLength, 0);
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
