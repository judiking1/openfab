import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import type { SimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import type { SimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import type {
	SimulationScenarioManifest,
	SimulationScenarioSourceKind,
} from "../compile/SimulationScenarioManifest";
import type {
	SimulationScenarioResourceRunConfiguration,
	SimulationScenarioResourceRunConfigurationInput,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import type { SimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import type {
	SimulationScenarioServiceTiming,
	SimulationScenarioServiceTimingInput,
} from "../compile/SimulationScenarioServiceTiming";

export const SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION = 5 as const;

export const SIMULATION_SCENARIO_PREPARATION_WORKER_ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"INVALID_SNAPSHOT",
	"INVALID_MANIFEST",
	"SOURCE_KIND_MISMATCH",
	"SOURCE_BINDING_MISMATCH",
	"ROUTE_REJECTED",
	"ROUTE_LIMIT_EXCEEDED",
	"LEASE_REJECTED",
	"LEASE_LIMIT_EXCEEDED",
	"CUSTODY_CHAIN_REJECTED",
	"SERVICE_TIMING_REJECTED",
	"RESOURCE_RUN_CONFIGURATION_REJECTED",
	"PREPARATION_CANCELLED",
	"INTERNAL_FAILURE",
] as const);
export type SimulationScenarioPreparationWorkerErrorCode =
	(typeof SIMULATION_SCENARIO_PREPARATION_WORKER_ERROR_CODES)[number];

interface SimulationScenarioPreparationWorkerCorrelation {
	readonly protocolVersion: typeof SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly sourceKind: SimulationScenarioSourceKind;
}

export interface PrepareSimulationScenarioWorkerRequest
	extends SimulationScenarioPreparationWorkerCorrelation {
	readonly type: "PREPARE_SIMULATION_SCENARIO";
	readonly snapshot: PublishedSimulationReadinessSnapshot;
	readonly manifest: SimulationScenarioManifest;
	readonly serviceTimingInput: SimulationScenarioServiceTimingInput;
	readonly resourceRunInput: SimulationScenarioResourceRunConfigurationInput;
}

export interface SimulationScenarioPreparedWorkerResponse
	extends SimulationScenarioPreparationWorkerCorrelation {
	readonly type: "SIMULATION_SCENARIO_PREPARED";
	readonly routes: SimulationScenarioRouteRequests;
	readonly leaseClaims: SimulationScenarioLeaseClaims;
	readonly admissionProgram: SimulationScenarioAdmissionProgram;
	readonly serviceTiming: SimulationScenarioServiceTiming;
	readonly resourceRunConfiguration: SimulationScenarioResourceRunConfiguration;
}

export interface PreparedSimulationScenarioArtifacts {
	readonly routes: SimulationScenarioRouteRequests;
	readonly leaseClaims: SimulationScenarioLeaseClaims;
	readonly admissionProgram: SimulationScenarioAdmissionProgram;
	readonly serviceTiming: SimulationScenarioServiceTiming;
	readonly resourceRunConfiguration: SimulationScenarioResourceRunConfiguration;
}

export interface SimulationScenarioPreparationRejectedWorkerResponse {
	readonly type: "SIMULATION_SCENARIO_PREPARATION_REJECTED";
	readonly protocolVersion: typeof SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly sourceKind: SimulationScenarioSourceKind | "UNKNOWN";
	readonly code: SimulationScenarioPreparationWorkerErrorCode;
	readonly message: string;
}

export type SimulationScenarioPreparationWorkerRequest = PrepareSimulationScenarioWorkerRequest;
export type SimulationScenarioPreparationWorkerResponse =
	| SimulationScenarioPreparedWorkerResponse
	| SimulationScenarioPreparationRejectedWorkerResponse;
