import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";
import {
	type SimulationEquipmentResourceConfiguration,
	simulationEquipmentResourceConfigurationError,
} from "./SimulationEquipmentResourceConfiguration";
import {
	type SimulationResidentCycleAdmissionProgram,
	simulationResidentCycleAdmissionProgramError,
	simulationResidentCycleAdmissionProgramMatchesSources,
} from "./SimulationResidentCycleAdmissionProgram";
import {
	type SimulationResidentCycleLeaseClaims,
	simulationResidentCycleLeaseClaimsError,
} from "./SimulationResidentCycleLeaseClaims";
import {
	type SimulationResidentCycleRoutes,
	simulationResidentCycleRoutesError,
} from "./SimulationResidentCycleRoutes";
import {
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
} from "./SimulationResidentFleetParkingConfiguration";
import {
	type SimulationResidentScenarioManifest,
	simulationResidentScenarioManifestError,
} from "./SimulationResidentScenarioManifest";
import {
	SIMULATION_SCENARIO_SERVICE_KIND_CODE,
	type SimulationScenarioEqProcessTimingRecord,
	type SimulationScenarioServiceTimingInput,
} from "./SimulationScenarioServiceTiming";
import {
	SIMULATION_STATION_TYPE_CODE,
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import type { SimulationTrackOccupancyPolicy } from "./SimulationTrackOccupancyPolicy";
import type { SimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

export const SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_POLICY =
	"EXPLICIT_EQ_STEP_AND_REVIEWED_STORAGE_MINIMUM_DWELL_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MAX_TYPED_BYTES = 16 * 1024 * 1024;
export const SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MISSING_SAFETY_LAYERS = Object.freeze([
	"EXACT_EQ_STORAGE_RUN_CONFIGURATION",
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const EQ_TIMING_RECORD_KEYS = Object.freeze([
	"sourceOrdinal",
	"capabilityId",
	"processingDurationMicroseconds",
] as const);
const TIMING_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingSafetyLayers",
	"timingPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceRoutesFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceAdmissionProgramFingerprint",
	"sourceFoundationFingerprint",
	"sourceEquipmentResourcesFingerprint",
	"sourceTimingInputFingerprint",
	"requestCount",
	"eqProcessTimingCount",
	"destinationEquipmentGroupIds",
	"serviceKindCodes",
	"eqCapabilityIds",
	"storagePolicyIds",
	"serviceDurationMicroseconds",
	"fingerprint",
	"byteLength",
] as const);

export type SimulationResidentCycleServiceTimingInput = SimulationScenarioServiceTimingInput;

export interface SimulationResidentCycleServiceTiming {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MISSING_SAFETY_LAYERS;
	readonly timingPolicy: typeof SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_POLICY;
	readonly sourceKind: SimulationResidentScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceRoutesFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceAdmissionProgramFingerprint: string;
	readonly sourceFoundationFingerprint: string;
	readonly sourceEquipmentResourcesFingerprint: string;
	readonly sourceTimingInputFingerprint: string;
	readonly requestCount: number;
	readonly eqProcessTimingCount: number;
	readonly destinationEquipmentGroupIds: Uint32Array;
	readonly serviceKindCodes: Uint8Array;
	/** Zero is the non-EQ sentinel. */
	readonly eqCapabilityIds: Uint32Array;
	/** Zero is the EQ sentinel. */
	readonly storagePolicyIds: Uint32Array;
	readonly serviceDurationMicroseconds: Float64Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

interface NormalizedEqProcessTiming {
	readonly sourceOrdinal: number;
	readonly capabilityId: number;
	readonly processingDurationMicroseconds: number;
}

export function compileSimulationResidentCycleServiceTiming(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
	input: SimulationResidentCycleServiceTimingInput,
): SimulationResidentCycleServiceTiming {
	assertCompatibleSources(
		foundation,
		trackResources,
		occupancyPolicy,
		equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
	);
	const normalizedTimings = normalizeEqProcessTimings(input, routes.sourceOrdinals);
	const timingBySourceOrdinal = new Map(
		normalizedTimings.map((timing) => [timing.sourceOrdinal, timing]),
	);
	const stationRowByPortId = rowsById(foundation.stations.ids);
	const groupRowById = rowsById(equipmentResources.groupIds);
	const policyRowById = rowsById(equipmentResources.storagePolicyIds);
	const requestCount = routes.requestCount;
	assertTypedMemoryLimit(requestCount);
	const destinationEquipmentGroupIds = new Uint32Array(requestCount);
	const serviceKindCodes = new Uint8Array(requestCount);
	const eqCapabilityIds = new Uint32Array(requestCount);
	const storagePolicyIds = new Uint32Array(requestCount);
	const serviceDurationMicroseconds = new Float64Array(requestCount);

	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		const sourceOrdinal = routes.sourceOrdinals[requestRow] as number;
		const destinationPortId = routes.dropoffPortIds[requestRow] as number;
		const destinationStationRow = stationRowByPortId.get(destinationPortId);
		if (destinationStationRow === undefined) {
			throw new Error(`Resident destination port ${destinationPortId} is outside the foundation.`);
		}
		const destinationGroupId = foundation.stations.equipmentGroupIds[
			destinationStationRow
		] as number;
		const destinationTypeCode = foundation.stations.typeCodes[destinationStationRow] as number;
		destinationEquipmentGroupIds[requestRow] = destinationGroupId;
		const timing = timingBySourceOrdinal.get(sourceOrdinal);
		if (destinationTypeCode === SIMULATION_STATION_TYPE_CODE.EQ) {
			if (!timing) {
				throw new Error(
					`Resident EQ destination at source ordinal ${sourceOrdinal} has no explicit process timing.`,
				);
			}
			if (
				!stationSupportsCapability(equipmentResources, destinationStationRow, timing.capabilityId)
			) {
				throw new Error(
					`Resident EQ timing at source ordinal ${sourceOrdinal} is not qualified at its destination port.`,
				);
			}
			serviceKindCodes[requestRow] = SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS;
			eqCapabilityIds[requestRow] = timing.capabilityId;
			serviceDurationMicroseconds[requestRow] = timing.processingDurationMicroseconds;
			continue;
		}
		if (timing) {
			throw new Error(
				`Resident EQ timing at source ordinal ${sourceOrdinal} targets a storage destination.`,
			);
		}
		const groupRow = groupRowById.get(destinationGroupId);
		if (groupRow === undefined) {
			throw new Error(`Resident destination group ${destinationGroupId} is not configured.`);
		}
		const policyId = equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		if (policyId === 0 || policyRow === undefined) {
			throw new Error(`Resident storage group ${destinationGroupId} has no reviewed policy.`);
		}
		const durationMicroseconds =
			(equipmentResources.storagePolicyMinimumDwellMilliseconds[policyRow] as number) * 1_000;
		if (!Number.isSafeInteger(durationMicroseconds)) {
			throw new RangeError(`Resident storage group ${destinationGroupId} dwell time is unsafe.`);
		}
		serviceKindCodes[requestRow] =
			destinationTypeCode === SIMULATION_STATION_TYPE_CODE.OHB
				? SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE
				: SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE;
		storagePolicyIds[requestRow] = policyId;
		serviceDurationMicroseconds[requestRow] = durationMicroseconds;
	}

	const timingWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_SCHEMA_VERSION,
		simulationRunnable: false,
		missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MISSING_SAFETY_LAYERS,
		timingPolicy: SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceRoutesFingerprint: routes.fingerprint,
		sourceLeaseClaimsFingerprint: leaseClaims.fingerprint,
		sourceAdmissionProgramFingerprint: admissionProgram.fingerprint,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceEquipmentResourcesFingerprint: equipmentResources.fingerprint,
		sourceTimingInputFingerprint: checksumSimulationResidentCycleServiceTimingInput(
			manifest,
			normalizedTimings,
		),
		requestCount,
		eqProcessTimingCount: normalizedTimings.length,
		destinationEquipmentGroupIds,
		serviceKindCodes,
		eqCapabilityIds,
		storagePolicyIds,
		serviceDurationMicroseconds,
	} as const;
	const views = simulationResidentCycleServiceTimingViews(timingWithoutIdentity);
	const compiled = Object.freeze({
		...timingWithoutIdentity,
		fingerprint: checksumSimulationResidentCycleServiceTiming(timingWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationResidentCycleServiceTiming;
	const error = simulationResidentCycleServiceTimingError(compiled);
	if (error) throw new Error(`Compiled resident cycle service timing is invalid: ${error}`);
	return compiled;
}

export function checksumSimulationResidentCycleServiceTimingInput(
	manifest: SimulationResidentScenarioManifest,
	input:
		| SimulationResidentCycleServiceTimingInput
		| readonly SimulationScenarioEqProcessTimingRecord[],
): string {
	const manifestError = simulationResidentScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation resident manifest is invalid: ${manifestError}`);
	const records = Array.isArray(input)
		? (input as readonly SimulationScenarioEqProcessTimingRecord[])
		: normalizeEqProcessTimingsForChecksum(input as SimulationResidentCycleServiceTimingInput);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([manifest.sourceKind, manifest.fingerprint]);
	for (const record of [...records].sort(compareEqProcessTimings)) {
		checksum.addNumbers([
			record.sourceOrdinal,
			record.capabilityId,
			record.processingDurationMicroseconds,
		]);
	}
	return checksum.digest();
}

export function checksumSimulationResidentCycleServiceTiming(
	timing: Omit<SimulationResidentCycleServiceTiming, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		timing.schemaVersion,
		timing.simulationRunnable ? 1 : 0,
		timing.requestCount,
		timing.eqProcessTimingCount,
	]);
	checksum.addStrings([
		...timing.missingSafetyLayers,
		timing.timingPolicy,
		timing.sourceKind,
		timing.sourceManifestFingerprint,
		timing.sourceRoutesFingerprint,
		timing.sourceLeaseClaimsFingerprint,
		timing.sourceAdmissionProgramFingerprint,
		timing.sourceFoundationFingerprint,
		timing.sourceEquipmentResourcesFingerprint,
		timing.sourceTimingInputFingerprint,
	]);
	checksum.addViews(simulationResidentCycleServiceTimingViews(timing));
	return checksum.digest();
}

export function simulationResidentCycleServiceTimingError(value: unknown): string | null {
	if (!isRecord(value)) return "resident cycle service timing must be an object";
	if (!hasExactKeys(value, TIMING_KEYS)) {
		return "resident cycle service timing contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingSafetyLayers,
			SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MISSING_SAFETY_LAYERS,
		) ||
		value.timingPolicy !== SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_POLICY ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY")
	) {
		return "resident service timing policy or source kind is invalid";
	}
	for (const key of [
		"sourceManifestFingerprint",
		"sourceRoutesFingerprint",
		"sourceLeaseClaimsFingerprint",
		"sourceAdmissionProgramFingerprint",
		"sourceFoundationFingerprint",
		"sourceEquipmentResourcesFingerprint",
		"sourceTimingInputFingerprint",
	] as const) {
		if (!isNonEmptyString(value[key])) return `${key} is invalid`;
	}
	if (
		!isNonNegativeSafeInteger(value.requestCount) ||
		!isNonNegativeSafeInteger(value.eqProcessTimingCount) ||
		(value.eqProcessTimingCount as number) > (value.requestCount as number)
	) {
		return "resident service timing counts are invalid";
	}
	const requestCount = value.requestCount as number;
	if (
		!isUint32Array(value.destinationEquipmentGroupIds, requestCount) ||
		!isUint8Array(value.serviceKindCodes, requestCount) ||
		!isUint32Array(value.eqCapabilityIds, requestCount) ||
		!isUint32Array(value.storagePolicyIds, requestCount) ||
		!isFloat64Array(value.serviceDurationMicroseconds, requestCount)
	) {
		return "resident service timing columns are malformed";
	}
	const timing = value as unknown as SimulationResidentCycleServiceTiming;
	let eqCount = 0;
	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		const kindCode = timing.serviceKindCodes[requestRow] as number;
		const duration = timing.serviceDurationMicroseconds[requestRow] as number;
		if (!isPositiveRecordId(timing.destinationEquipmentGroupIds[requestRow] as number)) {
			return "resident destination equipment-group IDs are invalid";
		}
		if (!Number.isSafeInteger(duration) || duration < 0) {
			return "resident service durations are invalid";
		}
		if (kindCode === SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS) {
			eqCount++;
			if (
				!isPositiveRecordId(timing.eqCapabilityIds[requestRow] as number) ||
				timing.storagePolicyIds[requestRow] !== 0 ||
				duration <= 0
			) {
				return "resident EQ service rows are inconsistent";
			}
		} else if (
			kindCode === SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE ||
			kindCode === SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE
		) {
			if (
				timing.eqCapabilityIds[requestRow] !== 0 ||
				!isPositiveRecordId(timing.storagePolicyIds[requestRow] as number)
			) {
				return "resident storage service rows are inconsistent";
			}
		} else {
			return "resident service kind code is invalid";
		}
	}
	if (eqCount !== timing.eqProcessTimingCount) return "resident EQ timing count is inconsistent";
	const views = simulationResidentCycleServiceTimingViews(timing);
	if (!hasIndependentOwnedBuffers(views)) {
		return "resident service timing columns must own independent buffers";
	}
	const byteLength = sumByteLengths(views);
	if (
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== byteLength ||
		byteLength > SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MAX_TYPED_BYTES
	) {
		return "resident service timing typed-memory accounting is invalid";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationResidentCycleServiceTiming(timing) !== value.fingerprint
	) {
		return "resident service timing fingerprint is invalid";
	}
	return null;
}

export function simulationResidentCycleServiceTimingMatchesSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
	input: SimulationResidentCycleServiceTimingInput,
	timing: SimulationResidentCycleServiceTiming,
): boolean {
	if (
		!simulationResidentCycleServiceTimingMatchesPreparedSources(
			foundation,
			trackResources,
			occupancyPolicy,
			equipmentResources,
			manifest,
			parking,
			routes,
			leaseClaims,
			admissionProgram,
			timing,
		)
	) {
		return false;
	}
	let inputFingerprint: string;
	try {
		inputFingerprint = checksumSimulationResidentCycleServiceTimingInput(manifest, input);
	} catch {
		return false;
	}
	return timing.sourceTimingInputFingerprint === inputFingerprint;
}

/** Validates retained prepared sources without requiring the already-adopted raw timing input. */
export function simulationResidentCycleServiceTimingMatchesPreparedSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
	timing: SimulationResidentCycleServiceTiming,
): boolean {
	if (simulationResidentCycleServiceTimingError(timing)) return false;
	try {
		assertCompatibleSources(
			foundation,
			trackResources,
			occupancyPolicy,
			equipmentResources,
			manifest,
			parking,
			routes,
			leaseClaims,
			admissionProgram,
		);
		return simulationResidentCycleServiceTimingMatchesValidatedSources(
			foundation,
			equipmentResources,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			timing,
		);
	} catch {
		return false;
	}
}

/** Checks exact semantic row binding after every supplied artifact passed its own validator. */
export function simulationResidentCycleServiceTimingMatchesValidatedSources(
	foundation: SimulationStaticWorldFoundation,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	manifest: SimulationResidentScenarioManifest,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
	timing: SimulationResidentCycleServiceTiming,
): boolean {
	return (
		timing.sourceKind === manifest.sourceKind &&
		timing.sourceManifestFingerprint === manifest.fingerprint &&
		timing.sourceRoutesFingerprint === routes.fingerprint &&
		timing.sourceLeaseClaimsFingerprint === leaseClaims.fingerprint &&
		timing.sourceAdmissionProgramFingerprint === admissionProgram.fingerprint &&
		timing.sourceFoundationFingerprint === foundation.fingerprint &&
		timing.sourceEquipmentResourcesFingerprint === equipmentResources.fingerprint &&
		timing.requestCount === routes.requestCount &&
		serviceRowsMatchSources(foundation, equipmentResources, routes, timing)
	);
}

export function simulationResidentCycleServiceTimingTransfers(
	timing: SimulationResidentCycleServiceTiming,
): readonly ArrayBuffer[] {
	const error = simulationResidentCycleServiceTimingError(timing);
	if (error) throw new Error(`Simulation resident cycle service timing is invalid: ${error}`);
	return Object.freeze(
		simulationResidentCycleServiceTimingViews(timing).map((view) => view.buffer as ArrayBuffer),
	);
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	admissionProgram: SimulationResidentCycleAdmissionProgram,
): void {
	for (const [label, error] of [
		["foundation", simulationStaticWorldFoundationError(foundation)],
		["equipment resources", simulationEquipmentResourceConfigurationError(equipmentResources)],
		["resident manifest", simulationResidentScenarioManifestError(manifest)],
		["resident parking", simulationResidentFleetParkingConfigurationError(parking)],
		["resident routes", simulationResidentCycleRoutesError(routes)],
		["resident lease claims", simulationResidentCycleLeaseClaimsError(leaseClaims)],
		["resident admission", simulationResidentCycleAdmissionProgramError(admissionProgram)],
	] as const) {
		if (error) throw new Error(`Simulation resident service ${label} is invalid: ${error}`);
	}
	if (!equipmentResourcesMatchFoundationAndRoutes(foundation, equipmentResources, routes)) {
		throw new Error("Resident service equipment resources do not match the exact static source.");
	}
	if (
		!simulationResidentCycleAdmissionProgramMatchesSources(
			foundation,
			trackResources,
			occupancyPolicy,
			manifest,
			parking,
			routes,
			leaseClaims,
			admissionProgram,
		)
	) {
		throw new Error("Resident service inputs do not share one exact admission source chain.");
	}
}

function equipmentResourcesMatchFoundationAndRoutes(
	foundation: SimulationStaticWorldFoundation,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	routes: SimulationResidentCycleRoutes,
): boolean {
	return (
		equipmentResources.sourceFoundationFingerprint === foundation.fingerprint &&
		equipmentResources.sourceStationCapabilitiesFingerprint ===
			routes.sourceStationCapabilitiesFingerprint &&
		equipmentResources.stationCount === foundation.stations.count &&
		equipmentResources.equipmentGroupCount === foundation.equipmentGroups.count &&
		sameNumbers(equipmentResources.portIds, foundation.stations.ids) &&
		sameNumbers(
			equipmentResources.stationEquipmentGroupIds,
			foundation.stations.equipmentGroupIds,
		) &&
		sameNumbers(equipmentResources.stationTypeCodes, foundation.stations.typeCodes) &&
		sameNumbers(equipmentResources.groupIds, foundation.equipmentGroups.ids) &&
		sameNumbers(equipmentResources.groupKindCodes, foundation.equipmentGroups.kindCodes)
	);
}

function serviceRowsMatchSources(
	foundation: SimulationStaticWorldFoundation,
	equipmentResources: SimulationEquipmentResourceConfiguration,
	routes: SimulationResidentCycleRoutes,
	timing: SimulationResidentCycleServiceTiming,
): boolean {
	const stationRowByPortId = rowsById(foundation.stations.ids);
	const groupRowById = rowsById(equipmentResources.groupIds);
	const policyRowById = rowsById(equipmentResources.storagePolicyIds);
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const stationRow = stationRowByPortId.get(routes.dropoffPortIds[requestRow] as number);
		if (stationRow === undefined) return false;
		const groupId = foundation.stations.equipmentGroupIds[stationRow] as number;
		const typeCode = foundation.stations.typeCodes[stationRow] as number;
		if (timing.destinationEquipmentGroupIds[requestRow] !== groupId) return false;
		if (typeCode === SIMULATION_STATION_TYPE_CODE.EQ) {
			if (
				timing.serviceKindCodes[requestRow] !== SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS ||
				!stationSupportsCapability(
					equipmentResources,
					stationRow,
					timing.eqCapabilityIds[requestRow] as number,
				)
			) {
				return false;
			}
			continue;
		}
		const groupRow = groupRowById.get(groupId);
		if (groupRow === undefined) return false;
		const policyId = equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		const expectedKind =
			typeCode === SIMULATION_STATION_TYPE_CODE.OHB
				? SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE
				: SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE;
		if (
			policyRow === undefined ||
			timing.serviceKindCodes[requestRow] !== expectedKind ||
			timing.storagePolicyIds[requestRow] !== policyId ||
			timing.serviceDurationMicroseconds[requestRow] !==
				(equipmentResources.storagePolicyMinimumDwellMilliseconds[policyRow] as number) * 1_000
		) {
			return false;
		}
	}
	return true;
}

function normalizeEqProcessTimings(
	input: SimulationResidentCycleServiceTimingInput,
	sourceOrdinals: Float64Array,
): readonly NormalizedEqProcessTiming[] {
	const normalized = normalizeEqProcessTimingsForChecksum(input);
	const acceptedOrdinals = new Set(sourceOrdinals);
	for (const timing of normalized) {
		if (!acceptedOrdinals.has(timing.sourceOrdinal)) {
			throw new Error(
				`Resident EQ timing source ordinal ${timing.sourceOrdinal} is outside the manifest.`,
			);
		}
	}
	return normalized;
}

function normalizeEqProcessTimingsForChecksum(
	input: SimulationResidentCycleServiceTimingInput,
): readonly NormalizedEqProcessTiming[] {
	if (!isRecord(input) || !hasExactKeys(input, ["eqProcessTimings"])) {
		throw new Error("Resident service timing input is malformed.");
	}
	if (!Array.isArray(input.eqProcessTimings)) {
		throw new Error("Resident EQ process timings must be an array.");
	}
	const ordinals = new Set<number>();
	const normalized = input.eqProcessTimings.map((record) => {
		if (!isRecord(record) || !hasExactKeys(record, EQ_TIMING_RECORD_KEYS)) {
			throw new Error("Resident EQ process timing record is malformed.");
		}
		if (!isNonNegativeSafeInteger(record.sourceOrdinal)) {
			throw new Error("Resident EQ process timing source ordinal is invalid.");
		}
		if (!isPositiveRecordId(record.capabilityId as number)) {
			throw new Error("Resident EQ process timing capability ID is invalid.");
		}
		if (
			!Number.isSafeInteger(record.processingDurationMicroseconds) ||
			(record.processingDurationMicroseconds as number) <= 0
		) {
			throw new Error("Resident EQ process duration must be a positive safe integer.");
		}
		const sourceOrdinal = record.sourceOrdinal as number;
		if (ordinals.has(sourceOrdinal)) {
			throw new Error(`Resident EQ process timing repeats source ordinal ${sourceOrdinal}.`);
		}
		ordinals.add(sourceOrdinal);
		return Object.freeze({
			sourceOrdinal,
			capabilityId: record.capabilityId as number,
			processingDurationMicroseconds: record.processingDurationMicroseconds as number,
		});
	});
	return Object.freeze(normalized.sort(compareEqProcessTimings));
}

function stationSupportsCapability(
	equipmentResources: SimulationEquipmentResourceConfiguration,
	stationRow: number,
	capabilityId: number,
): boolean {
	const start = equipmentResources.eqStationCapabilityOffsets[stationRow] as number;
	const end = equipmentResources.eqStationCapabilityOffsets[stationRow + 1] as number;
	for (let row = start; row < end; row++) {
		if (equipmentResources.eqStationCapabilityIds[row] === capabilityId) return true;
	}
	return false;
}

function compareEqProcessTimings(
	left: SimulationScenarioEqProcessTimingRecord,
	right: SimulationScenarioEqProcessTimingRecord,
): number {
	return left.sourceOrdinal - right.sourceOrdinal;
}

function simulationResidentCycleServiceTimingViews(
	timing: Pick<
		SimulationResidentCycleServiceTiming,
		| "destinationEquipmentGroupIds"
		| "serviceKindCodes"
		| "eqCapabilityIds"
		| "storagePolicyIds"
		| "serviceDurationMicroseconds"
	>,
): readonly ArrayBufferView[] {
	return [
		timing.destinationEquipmentGroupIds,
		timing.serviceKindCodes,
		timing.eqCapabilityIds,
		timing.storagePolicyIds,
		timing.serviceDurationMicroseconds,
	];
}

function assertTypedMemoryLimit(requestCount: number): void {
	const bytes =
		requestCount * (Uint32Array.BYTES_PER_ELEMENT * 3 + Uint8Array.BYTES_PER_ELEMENT + 8);
	if (
		!Number.isSafeInteger(bytes) ||
		bytes > SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MAX_TYPED_BYTES
	) {
		throw new Error("Resident cycle service timing exceeds its typed-memory limit.");
	}
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

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((candidate, row) => candidate === expected[row])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isUint8Array(value: unknown, length: number): value is Uint8Array {
	return value instanceof Uint8Array && value.length === length;
}

function isFloat64Array(value: unknown, length: number): value is Float64Array {
	return value instanceof Float64Array && value.length === length;
}
