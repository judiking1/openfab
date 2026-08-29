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
import { SIMULATION_STATION_TYPE_CODE } from "./SimulationStaticWorldFoundation";

export const SIMULATION_SCENARIO_SERVICE_TIMING_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_SERVICE_TIMING_POLICY =
	"EXPLICIT_EQ_STEP_AND_CERTIFIED_STORAGE_MINIMUM_DWELL_V1" as const;
export const SIMULATION_SCENARIO_SERVICE_TIMING_MISSING_RUNTIME_LAYERS = Object.freeze([
	"SERVICE_EVENT_EXECUTION",
	"BOUNDED_RUNTIME_PUBLICATION",
] as const);
export const SIMULATION_SCENARIO_SERVICE_KIND_CODE = Object.freeze({
	EQ_PROCESS: 1,
	OHB_STORAGE: 2,
	STK_STORAGE: 3,
} as const);

const EQ_TIMING_RECORD_KEYS = Object.freeze([
	"sourceOrdinal",
	"capabilityId",
	"processingDurationMicroseconds",
] as const);
const SERVICE_TIMING_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingRuntimeLayers",
	"timingPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceRouteRequestsFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceAdmissionProgramFingerprint",
	"sourceCertificateFingerprint",
	"sourceEquipmentResourcesFingerprint",
	"sourceTimingInputFingerprint",
	"runIdentityFingerprint",
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

export interface SimulationScenarioEqProcessTimingRecord {
	readonly sourceOrdinal: number;
	readonly capabilityId: number;
	readonly processingDurationMicroseconds: number;
}

export interface SimulationScenarioServiceTimingInput {
	readonly eqProcessTimings: readonly SimulationScenarioEqProcessTimingRecord[];
}

export interface SimulationScenarioServiceTiming {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_SERVICE_TIMING_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingRuntimeLayers: typeof SIMULATION_SCENARIO_SERVICE_TIMING_MISSING_RUNTIME_LAYERS;
	readonly timingPolicy: typeof SIMULATION_SCENARIO_SERVICE_TIMING_POLICY;
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceRouteRequestsFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceAdmissionProgramFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly sourceEquipmentResourcesFingerprint: string;
	readonly sourceTimingInputFingerprint: string;
	readonly runIdentityFingerprint: string;
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

/**
 * Compiles post-arrival service time without deriving policy from names, geometry, or row order.
 * EQ duration is an explicit scenario input; OHB/STK duration is the certified policy minimum.
 */
export function compileSimulationScenarioServiceTiming(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	input: SimulationScenarioServiceTimingInput,
): SimulationScenarioServiceTiming {
	assertCompatibleSources(snapshot, manifest, routes, leaseClaims, admissionProgram);
	const normalizedTimings = normalizeEqProcessTimings(input, routes);
	const timingBySourceOrdinal = new Map(
		normalizedTimings.map((timing) => [timing.sourceOrdinal, timing]),
	);
	const groupRowById = rowsById(snapshot.equipmentResources.groupIds);
	const policyRowById = rowsById(snapshot.equipmentResources.storagePolicyIds);
	const requestCount = routes.requestCount;
	const destinationEquipmentGroupIds = new Uint32Array(requestCount);
	const serviceKindCodes = new Uint8Array(requestCount);
	const eqCapabilityIds = new Uint32Array(requestCount);
	const storagePolicyIds = new Uint32Array(requestCount);
	const serviceDurationMicroseconds = new Float64Array(requestCount);

	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		const sourceOrdinal = routes.sourceOrdinals[requestRow] as number;
		const destinationStationRow = routes.destinationStationRows[requestRow] as number;
		const destinationGroupId = snapshot.foundation.stations.equipmentGroupIds[
			destinationStationRow
		] as number;
		const destinationTypeCode = snapshot.foundation.stations.typeCodes[
			destinationStationRow
		] as number;
		destinationEquipmentGroupIds[requestRow] = destinationGroupId;
		const timing = timingBySourceOrdinal.get(sourceOrdinal);
		if (destinationTypeCode === SIMULATION_STATION_TYPE_CODE.EQ) {
			if (!timing) {
				throw new Error(
					`Scenario EQ destination at source ordinal ${sourceOrdinal} has no explicit process timing.`,
				);
			}
			if (!stationSupportsCapability(snapshot, destinationStationRow, timing.capabilityId)) {
				throw new Error(
					`Scenario EQ timing at source ordinal ${sourceOrdinal} is not qualified at its destination port.`,
				);
			}
			serviceKindCodes[requestRow] = SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS;
			eqCapabilityIds[requestRow] = timing.capabilityId;
			serviceDurationMicroseconds[requestRow] = timing.processingDurationMicroseconds;
			continue;
		}
		if (timing) {
			throw new Error(
				`Scenario EQ timing at source ordinal ${sourceOrdinal} targets a storage destination.`,
			);
		}
		const groupRow = groupRowById.get(destinationGroupId);
		if (groupRow === undefined) {
			throw new Error(
				`Scenario destination group ${destinationGroupId} is outside the certificate.`,
			);
		}
		const policyId = snapshot.equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		if (policyId === 0 || policyRow === undefined) {
			throw new Error(`Scenario storage group ${destinationGroupId} has no certified policy.`);
		}
		const durationMicroseconds =
			(snapshot.equipmentResources.storagePolicyMinimumDwellMilliseconds[policyRow] as number) *
			1_000;
		if (!Number.isSafeInteger(durationMicroseconds)) {
			throw new RangeError(`Scenario storage group ${destinationGroupId} dwell time is unsafe.`);
		}
		serviceKindCodes[requestRow] =
			destinationTypeCode === SIMULATION_STATION_TYPE_CODE.OHB
				? SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE
				: SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE;
		storagePolicyIds[requestRow] = policyId;
		serviceDurationMicroseconds[requestRow] = durationMicroseconds;
	}

	const timingWithoutIdentity = {
		schemaVersion: SIMULATION_SCENARIO_SERVICE_TIMING_SCHEMA_VERSION,
		simulationRunnable: false,
		missingRuntimeLayers: SIMULATION_SCENARIO_SERVICE_TIMING_MISSING_RUNTIME_LAYERS,
		timingPolicy: SIMULATION_SCENARIO_SERVICE_TIMING_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceRouteRequestsFingerprint: routes.fingerprint,
		sourceLeaseClaimsFingerprint: leaseClaims.fingerprint,
		sourceAdmissionProgramFingerprint: admissionProgram.fingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		sourceEquipmentResourcesFingerprint: snapshot.equipmentResources.fingerprint,
		sourceTimingInputFingerprint: checksumSimulationScenarioServiceTimingInput(
			manifest,
			normalizedTimings,
		),
		runIdentityFingerprint: routes.runIdentityFingerprint,
		requestCount,
		eqProcessTimingCount: normalizedTimings.length,
		destinationEquipmentGroupIds,
		serviceKindCodes,
		eqCapabilityIds,
		storagePolicyIds,
		serviceDurationMicroseconds,
	} as const;
	const views = simulationScenarioServiceTimingViews(timingWithoutIdentity);
	const timing = Object.freeze({
		...timingWithoutIdentity,
		fingerprint: checksumSimulationScenarioServiceTiming(timingWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationScenarioServiceTiming;
	const error = simulationScenarioServiceTimingError(timing);
	if (error) throw new Error(`Compiled scenario service timing is invalid: ${error}`);
	return timing;
}

export function checksumSimulationScenarioServiceTimingInput(
	manifest: SimulationScenarioManifest,
	input: SimulationScenarioServiceTimingInput | readonly SimulationScenarioEqProcessTimingRecord[],
): string {
	const records = Array.isArray(input)
		? (input as readonly SimulationScenarioEqProcessTimingRecord[])
		: normalizeEqProcessTimingsForChecksum(input as SimulationScenarioServiceTimingInput);
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

export function checksumSimulationScenarioServiceTiming(
	timing: Omit<SimulationScenarioServiceTiming, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		timing.schemaVersion,
		timing.simulationRunnable ? 1 : 0,
		timing.requestCount,
		timing.eqProcessTimingCount,
	]);
	checksum.addStrings([
		...timing.missingRuntimeLayers,
		timing.timingPolicy,
		timing.sourceKind,
		timing.sourceManifestFingerprint,
		timing.sourceRouteRequestsFingerprint,
		timing.sourceLeaseClaimsFingerprint,
		timing.sourceAdmissionProgramFingerprint,
		timing.sourceCertificateFingerprint,
		timing.sourceEquipmentResourcesFingerprint,
		timing.sourceTimingInputFingerprint,
		timing.runIdentityFingerprint,
	]);
	checksum.addViews(simulationScenarioServiceTimingViews(timing));
	return checksum.digest();
}

export function simulationScenarioServiceTimingError(value: unknown): string | null {
	if (!isRecord(value)) return "scenario service timing must be an object";
	if (!hasExactKeys(value, SERVICE_TIMING_KEYS)) {
		return "scenario service timing contains missing or unexpected fields";
	}
	if (value.schemaVersion !== SIMULATION_SCENARIO_SERVICE_TIMING_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingRuntimeLayers,
			SIMULATION_SCENARIO_SERVICE_TIMING_MISSING_RUNTIME_LAYERS,
		) ||
		value.timingPolicy !== SIMULATION_SCENARIO_SERVICE_TIMING_POLICY ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY")
	) {
		return "runtime gate, timing policy, or source kind is invalid";
	}
	for (const key of [
		"sourceManifestFingerprint",
		"sourceRouteRequestsFingerprint",
		"sourceLeaseClaimsFingerprint",
		"sourceAdmissionProgramFingerprint",
		"sourceCertificateFingerprint",
		"sourceEquipmentResourcesFingerprint",
		"sourceTimingInputFingerprint",
		"runIdentityFingerprint",
	] as const) {
		if (!isNonEmptyString(value[key])) return `${key} is invalid`;
	}
	if (
		!isNonNegativeSafeInteger(value.requestCount) ||
		!isNonNegativeSafeInteger(value.eqProcessTimingCount) ||
		(value.eqProcessTimingCount as number) > (value.requestCount as number)
	) {
		return "service timing counts are invalid";
	}
	const requestCount = value.requestCount as number;
	if (
		!isUint32Array(value.destinationEquipmentGroupIds, requestCount) ||
		!isUint8Array(value.serviceKindCodes, requestCount) ||
		!isUint32Array(value.eqCapabilityIds, requestCount) ||
		!isUint32Array(value.storagePolicyIds, requestCount) ||
		!isFloat64Array(value.serviceDurationMicroseconds, requestCount)
	) {
		return "service timing columns are malformed";
	}
	const timing = value as unknown as SimulationScenarioServiceTiming;
	let eqCount = 0;
	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		const kindCode = timing.serviceKindCodes[requestRow] as number;
		const duration = timing.serviceDurationMicroseconds[requestRow] as number;
		if (!isPositiveRecordId(timing.destinationEquipmentGroupIds[requestRow] as number)) {
			return "destination equipment-group IDs are invalid";
		}
		if (!Number.isSafeInteger(duration) || duration < 0) {
			return "service durations are invalid";
		}
		if (kindCode === SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS) {
			eqCount++;
			if (
				!isPositiveRecordId(timing.eqCapabilityIds[requestRow] as number) ||
				timing.storagePolicyIds[requestRow] !== 0 ||
				duration <= 0
			) {
				return "EQ service rows are inconsistent";
			}
		} else if (
			kindCode === SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE ||
			kindCode === SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE
		) {
			if (
				timing.eqCapabilityIds[requestRow] !== 0 ||
				!isPositiveRecordId(timing.storagePolicyIds[requestRow] as number)
			) {
				return "storage service rows are inconsistent";
			}
		} else {
			return "service kind code is invalid";
		}
	}
	if (eqCount !== timing.eqProcessTimingCount) return "EQ timing count is inconsistent";
	const views = simulationScenarioServiceTimingViews(timing);
	if (!hasDistinctOwnedBuffers(views)) return "typed arrays must own distinct buffers";
	if (!isNonNegativeSafeInteger(value.byteLength) || value.byteLength !== sumByteLengths(views)) {
		return "byte length is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "fingerprint is invalid";
	try {
		if (checksumSimulationScenarioServiceTiming(timing) !== timing.fingerprint) {
			return "fingerprint does not match scenario service timing";
		}
	} catch {
		return "scenario service timing fingerprint cannot be recomputed";
	}
	return null;
}

export function simulationScenarioServiceTimingMatchesSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	input: SimulationScenarioServiceTimingInput,
	timing: SimulationScenarioServiceTiming,
): boolean {
	if (
		!simulationScenarioServiceTimingMatchesPreparedSources(
			snapshot,
			manifest,
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
		inputFingerprint = checksumSimulationScenarioServiceTimingInput(manifest, input);
	} catch {
		return false;
	}
	return timing.sourceTimingInputFingerprint === inputFingerprint;
}

/** Verifies the Worker-owned artifact against retained prepared sources after input adoption. */
export function simulationScenarioServiceTimingMatchesPreparedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	timing: SimulationScenarioServiceTiming,
): boolean {
	if (
		publishedSimulationReadinessSnapshotError(snapshot) !== null ||
		simulationScenarioManifestError(manifest) !== null ||
		simulationScenarioRouteRequestsError(routes) !== null ||
		simulationScenarioLeaseClaimsError(leaseClaims) !== null ||
		simulationScenarioAdmissionProgramError(admissionProgram) !== null ||
		simulationScenarioServiceTimingError(timing) !== null ||
		!simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, routes) ||
		!simulationScenarioLeaseClaimsMatchValidatedSources(snapshot, routes, leaseClaims) ||
		!simulationScenarioAdmissionProgramMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
		) ||
		!simulationScenarioServiceTimingMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			timing,
		)
	) {
		return false;
	}
	return true;
}

/** Checks exact source binding after each supplied artifact has passed its own error validator. */
export function simulationScenarioServiceTimingMatchesValidatedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	timing: SimulationScenarioServiceTiming,
): boolean {
	return (
		timing.sourceKind === manifest.sourceKind &&
		timing.sourceManifestFingerprint === manifest.fingerprint &&
		timing.sourceRouteRequestsFingerprint === routes.fingerprint &&
		timing.sourceLeaseClaimsFingerprint === leaseClaims.fingerprint &&
		timing.sourceAdmissionProgramFingerprint === admissionProgram.fingerprint &&
		timing.sourceCertificateFingerprint === snapshot.certificate.fingerprint &&
		timing.sourceEquipmentResourcesFingerprint === snapshot.equipmentResources.fingerprint &&
		timing.runIdentityFingerprint === routes.runIdentityFingerprint &&
		timing.requestCount === routes.requestCount &&
		serviceRowsMatchSources(snapshot, routes, timing)
	);
}

export function simulationScenarioServiceTimingTransfers(
	timing: SimulationScenarioServiceTiming,
): readonly ArrayBuffer[] {
	const error = simulationScenarioServiceTimingError(timing);
	if (error) throw new Error(`Simulation scenario service timing is invalid: ${error}`);
	return Object.freeze(
		simulationScenarioServiceTimingViews(timing).map((view) => {
			if (!(view.buffer instanceof ArrayBuffer)) {
				throw new Error("Simulation scenario service timing contains a shared buffer.");
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
): void {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	const manifestError = simulationScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation scenario manifest is invalid: ${manifestError}`);
	if (
		simulationScenarioRouteRequestsError(routes) !== null ||
		!simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, routes)
	) {
		throw new Error("Scenario routes do not match the timing sources.");
	}
	if (
		simulationScenarioLeaseClaimsError(leaseClaims) !== null ||
		!simulationScenarioLeaseClaimsMatchValidatedSources(snapshot, routes, leaseClaims)
	) {
		throw new Error("Scenario lease claims do not match the timing sources.");
	}
	if (
		simulationScenarioAdmissionProgramError(admissionProgram) !== null ||
		!simulationScenarioAdmissionProgramMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
		)
	) {
		throw new Error("Scenario admission program does not match the timing sources.");
	}
}

function normalizeEqProcessTimings(
	input: SimulationScenarioServiceTimingInput,
	routes: SimulationScenarioRouteRequests,
): readonly NormalizedEqProcessTiming[] {
	const normalized = normalizeEqProcessTimingsForChecksum(input);
	const requestRowsByOrdinal = new Map<number, number>();
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		requestRowsByOrdinal.set(routes.sourceOrdinals[requestRow] as number, requestRow);
	}
	for (const timing of normalized) {
		if (!requestRowsByOrdinal.has(timing.sourceOrdinal)) {
			throw new Error(
				`Scenario EQ timing source ordinal ${timing.sourceOrdinal} is outside the manifest.`,
			);
		}
	}
	return normalized;
}

function normalizeEqProcessTimingsForChecksum(
	input: SimulationScenarioServiceTimingInput,
): readonly NormalizedEqProcessTiming[] {
	if (!isRecord(input) || !hasExactKeys(input, ["eqProcessTimings"])) {
		throw new Error("Scenario service timing input is malformed.");
	}
	if (!Array.isArray(input.eqProcessTimings)) {
		throw new Error("Scenario EQ process timings must be an array.");
	}
	const ordinals = new Set<number>();
	const normalized = input.eqProcessTimings.map((record) => {
		if (!isRecord(record) || !hasExactKeys(record, EQ_TIMING_RECORD_KEYS)) {
			throw new Error("Scenario EQ process timing record is malformed.");
		}
		if (!isNonNegativeSafeInteger(record.sourceOrdinal)) {
			throw new Error("Scenario EQ process timing source ordinal is invalid.");
		}
		if (!isPositiveRecordId(record.capabilityId as number)) {
			throw new Error("Scenario EQ process timing capability ID is invalid.");
		}
		if (
			!Number.isSafeInteger(record.processingDurationMicroseconds) ||
			(record.processingDurationMicroseconds as number) <= 0
		) {
			throw new Error("Scenario EQ process duration must be a positive safe integer.");
		}
		const sourceOrdinal = record.sourceOrdinal as number;
		if (ordinals.has(sourceOrdinal)) {
			throw new Error(`Scenario EQ process timing repeats source ordinal ${sourceOrdinal}.`);
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

function serviceRowsMatchSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	timing: SimulationScenarioServiceTiming,
): boolean {
	const groupRowById = rowsById(snapshot.equipmentResources.groupIds);
	const policyRowById = rowsById(snapshot.equipmentResources.storagePolicyIds);
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const stationRow = routes.destinationStationRows[requestRow] as number;
		const groupId = snapshot.foundation.stations.equipmentGroupIds[stationRow] as number;
		const typeCode = snapshot.foundation.stations.typeCodes[stationRow] as number;
		if (timing.destinationEquipmentGroupIds[requestRow] !== groupId) return false;
		if (typeCode === SIMULATION_STATION_TYPE_CODE.EQ) {
			if (
				timing.serviceKindCodes[requestRow] !== SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS ||
				!stationSupportsCapability(
					snapshot,
					stationRow,
					timing.eqCapabilityIds[requestRow] as number,
				)
			) {
				return false;
			}
			continue;
		}
		const expectedKind =
			typeCode === SIMULATION_STATION_TYPE_CODE.OHB
				? SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE
				: SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE;
		const groupRow = groupRowById.get(groupId);
		if (groupRow === undefined) return false;
		const policyId = snapshot.equipmentResources.storageGroupPolicyIds[groupRow] as number;
		const policyRow = policyRowById.get(policyId);
		if (
			policyRow === undefined ||
			timing.serviceKindCodes[requestRow] !== expectedKind ||
			timing.storagePolicyIds[requestRow] !== policyId ||
			timing.serviceDurationMicroseconds[requestRow] !==
				(snapshot.equipmentResources.storagePolicyMinimumDwellMilliseconds[policyRow] as number) *
					1_000
		) {
			return false;
		}
	}
	return true;
}

function stationSupportsCapability(
	snapshot: PublishedSimulationReadinessSnapshot,
	stationRow: number,
	capabilityId: number,
): boolean {
	const start = snapshot.equipmentResources.eqStationCapabilityOffsets[stationRow] as number;
	const end = snapshot.equipmentResources.eqStationCapabilityOffsets[stationRow + 1] as number;
	for (let index = start; index < end; index++) {
		if (snapshot.equipmentResources.eqStationCapabilityIds[index] === capabilityId) return true;
	}
	return false;
}

function rowsById(ids: Uint32Array): Map<number, number> {
	return new Map([...ids].map((id, row) => [id, row]));
}

function compareEqProcessTimings(
	left: SimulationScenarioEqProcessTimingRecord,
	right: SimulationScenarioEqProcessTimingRecord,
): number {
	return left.sourceOrdinal - right.sourceOrdinal;
}

function simulationScenarioServiceTimingViews(
	timing: Pick<
		SimulationScenarioServiceTiming,
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

function hasDistinctOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	return (
		views.every(
			(view) =>
				view.buffer instanceof ArrayBuffer &&
				view.byteOffset === 0 &&
				view.byteLength === view.buffer.byteLength,
		) && new Set(views.map((view) => view.buffer)).size === views.length
	);
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((total, view) => total + view.byteLength, 0);
}

function isUint32Array(value: unknown, length: number): value is Uint32Array<ArrayBuffer> {
	return value instanceof Uint32Array && value.length === length;
}

function isUint8Array(value: unknown, length: number): value is Uint8Array<ArrayBuffer> {
	return value instanceof Uint8Array && value.length === length;
}

function isFloat64Array(value: unknown, length: number): value is Float64Array<ArrayBuffer> {
	return value instanceof Float64Array && value.length === length;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((item, index) => item === expected[index])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
