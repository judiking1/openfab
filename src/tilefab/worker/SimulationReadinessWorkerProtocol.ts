import type {
	PublishedSimulationReadinessSnapshot,
	SimulationReadinessComponents,
} from "../compile/SimulationReadinessCertificate";

export const SIMULATION_READINESS_WORKER_PROTOCOL_VERSION = 1 as const;

export const SIMULATION_READINESS_WORKER_ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"INVALID_COMPONENT",
	"SOURCE_IDENTITY_MISMATCH",
	"CERTIFICATE_INVALID",
	"TRANSFER_INVALID",
	"INTERNAL_FAILURE",
] as const);
export type SimulationReadinessWorkerErrorCode =
	(typeof SIMULATION_READINESS_WORKER_ERROR_CODES)[number];

interface SimulationReadinessWorkerCorrelation {
	readonly protocolVersion: typeof SIMULATION_READINESS_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
}

export interface CertifySimulationReadinessWorkerRequest
	extends SimulationReadinessWorkerCorrelation {
	readonly type: "CERTIFY_SIMULATION_READINESS";
	readonly components: SimulationReadinessComponents;
}

export interface SimulationReadinessCertifiedWorkerResponse
	extends SimulationReadinessWorkerCorrelation {
	readonly type: "SIMULATION_READINESS_CERTIFIED";
	readonly published: PublishedSimulationReadinessSnapshot;
}

export interface SimulationReadinessRejectedWorkerResponse
	extends SimulationReadinessWorkerCorrelation {
	readonly type: "SIMULATION_READINESS_REJECTED";
	readonly code: SimulationReadinessWorkerErrorCode;
	readonly message: string;
}

export type SimulationReadinessWorkerRequest = CertifySimulationReadinessWorkerRequest;
export type SimulationReadinessWorkerResponse =
	| SimulationReadinessCertifiedWorkerResponse
	| SimulationReadinessRejectedWorkerResponse;
