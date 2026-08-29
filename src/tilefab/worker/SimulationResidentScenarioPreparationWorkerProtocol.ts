import {
	type SimulationReadinessComponents,
	simulationReadinessComponentsError,
} from "../compile/SimulationReadinessCertificate";
import {
	type SimulationResidentCycleAdmissionProgram,
	simulationResidentCycleAdmissionProgramError,
} from "../compile/SimulationResidentCycleAdmissionProgram";
import {
	type SimulationResidentCycleLeaseClaims,
	simulationResidentCycleLeaseClaimsError,
} from "../compile/SimulationResidentCycleLeaseClaims";
import {
	type SimulationResidentCycleResourceRunConfiguration,
	type SimulationResidentCycleResourceRunConfigurationInput,
	simulationResidentCycleResourceRunConfigurationError,
} from "../compile/SimulationResidentCycleResourceRunConfiguration";
import {
	type SimulationResidentCycleRoutes,
	simulationResidentCycleRoutesError,
} from "../compile/SimulationResidentCycleRoutes";
import {
	type SimulationResidentCycleServiceTiming,
	type SimulationResidentCycleServiceTimingInput,
	simulationResidentCycleServiceTimingError,
} from "../compile/SimulationResidentCycleServiceTiming";
import {
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
} from "../compile/SimulationResidentFleetParkingConfiguration";
import {
	type SimulationResidentReadinessCertificate,
	simulationResidentReadinessCertificateError,
} from "../compile/SimulationResidentReadinessCertificate";
import {
	type SimulationResidentScenarioManifest,
	simulationResidentScenarioManifestError,
} from "../compile/SimulationResidentScenarioManifest";

export const SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION = 1 as const;
export const SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"INVALID_SOURCE",
	"PREPARATION_FAILED",
	"INTERNAL_FAILURE",
] as const);
export type SimulationResidentScenarioPreparationWorkerErrorCode =
	(typeof SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_ERROR_CODES)[number];

interface WorkerCorrelation {
	readonly protocolVersion: typeof SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
}

export interface PrepareSimulationResidentScenarioWorkerRequest extends WorkerCorrelation {
	readonly type: "PREPARE_SIMULATION_RESIDENT_SCENARIO";
	readonly runAssetFingerprint: string;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
	readonly components: SimulationReadinessComponents;
	readonly parking: SimulationResidentFleetParkingConfiguration;
	readonly manifest: SimulationResidentScenarioManifest;
	readonly serviceTimingInput: SimulationResidentCycleServiceTimingInput;
	readonly resourceRunInput: SimulationResidentCycleResourceRunConfigurationInput;
}

export interface SimulationResidentScenarioPreparedWorkerResponse extends WorkerCorrelation {
	readonly type: "SIMULATION_RESIDENT_SCENARIO_PREPARED";
	readonly runAssetFingerprint: string;
	readonly routes: SimulationResidentCycleRoutes;
	readonly leaseClaims: SimulationResidentCycleLeaseClaims;
	readonly admissionProgram: SimulationResidentCycleAdmissionProgram;
	readonly serviceTiming: SimulationResidentCycleServiceTiming;
	readonly resourceRunConfiguration: SimulationResidentCycleResourceRunConfiguration;
	readonly certificate: SimulationResidentReadinessCertificate;
}

export interface SimulationResidentScenarioPreparationRejectedWorkerResponse
	extends WorkerCorrelation {
	readonly type: "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED";
	readonly code: SimulationResidentScenarioPreparationWorkerErrorCode;
	readonly message: string;
}

export type SimulationResidentScenarioPreparationWorkerRequest =
	PrepareSimulationResidentScenarioWorkerRequest;
export type SimulationResidentScenarioPreparationWorkerResponse =
	| SimulationResidentScenarioPreparedWorkerResponse
	| SimulationResidentScenarioPreparationRejectedWorkerResponse;

const PREPARED_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"runAssetFingerprint",
	"routes",
	"leaseClaims",
	"admissionProgram",
	"serviceTiming",
	"resourceRunConfiguration",
	"certificate",
]);
const REJECTED_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"code",
	"message",
]);

export function simulationResidentScenarioPreparationWorkerRequestError(
	value: unknown,
): string | null {
	if (!isRecord(value)) return "resident preparation Worker request must be an object";
	if (
		!hasExactKeys(value, [
			"type",
			"protocolVersion",
			"requestId",
			"generation",
			"runAssetFingerprint",
			"serviceTimingInputFingerprint",
			"resourceRunInputFingerprint",
			"components",
			"parking",
			"manifest",
			"serviceTimingInput",
			"resourceRunInput",
		]) ||
		value.type !== "PREPARE_SIMULATION_RESIDENT_SCENARIO" ||
		value.protocolVersion !== SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION ||
		!isPositiveSafeInteger(value.requestId) ||
		!isNonNegativeSafeInteger(value.generation) ||
		!isNonEmptyString(value.runAssetFingerprint) ||
		!isNonEmptyString(value.serviceTimingInputFingerprint) ||
		!isNonEmptyString(value.resourceRunInputFingerprint)
	) {
		return "resident preparation Worker request envelope is invalid";
	}
	const componentsError = simulationReadinessComponentsError(value.components);
	const parkingError = simulationResidentFleetParkingConfigurationError(value.parking);
	const manifestError = simulationResidentScenarioManifestError(value.manifest);
	if (componentsError || parkingError || manifestError) {
		return componentsError
			? `resident preparation components are invalid: ${componentsError}`
			: parkingError
				? `resident preparation parking is invalid: ${parkingError}`
				: `resident preparation manifest is invalid: ${manifestError}`;
	}
	if (!isRecord(value.serviceTimingInput) || !isRecord(value.resourceRunInput)) {
		return "resident preparation explicit inputs are invalid";
	}
	return null;
}

export function simulationResidentScenarioPreparationWorkerResponseError(
	value: unknown,
): string | null {
	if (!isRecord(value)) return "resident preparation Worker response must be an object";
	if (
		value.protocolVersion !== SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION ||
		!isPositiveSafeInteger(value.requestId) ||
		!isNonNegativeSafeInteger(value.generation)
	) {
		return "resident preparation Worker response correlation is invalid";
	}
	if (value.type === "SIMULATION_RESIDENT_SCENARIO_PREPARED") {
		if (!hasExactKeys(value, PREPARED_KEYS) || !isNonEmptyString(value.runAssetFingerprint)) {
			return "prepared resident response contains missing or unexpected fields";
		}
		const errors = [
			simulationResidentCycleRoutesError(value.routes),
			simulationResidentCycleLeaseClaimsError(value.leaseClaims),
			simulationResidentCycleAdmissionProgramError(value.admissionProgram),
			simulationResidentCycleServiceTimingError(value.serviceTiming),
			simulationResidentCycleResourceRunConfigurationError(value.resourceRunConfiguration),
			simulationResidentReadinessCertificateError(value.certificate),
		];
		const error = errors.find((candidate) => candidate !== null);
		return error ? `prepared resident response artifact is invalid: ${error}` : null;
	}
	if (value.type === "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED") {
		if (!hasExactKeys(value, REJECTED_KEYS)) {
			return "rejected resident preparation response contains unexpected fields";
		}
		if (
			typeof value.code !== "string" ||
			!SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_ERROR_CODES.includes(
				value.code as SimulationResidentScenarioPreparationWorkerErrorCode,
			) ||
			typeof value.message !== "string" ||
			value.message.length === 0 ||
			value.message.length > 240
		) {
			return "resident preparation rejection details are invalid";
		}
		return null;
	}
	return "resident preparation Worker response type is invalid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isPositiveSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): boolean {
	return typeof value === "string" && value.length > 0;
}
