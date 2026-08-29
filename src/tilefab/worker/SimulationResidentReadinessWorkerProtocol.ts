import type { SimulationResidentReadinessSources } from "../compile/SimulationResidentReadinessCertificate";
import {
	type SimulationResidentReadinessCertificate,
	simulationResidentReadinessCertificateError,
} from "../compile/SimulationResidentReadinessCertificate";

export const SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION = 1 as const;
export const SIMULATION_RESIDENT_READINESS_WORKER_ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"INVALID_SOURCE",
	"SOURCE_IDENTITY_MISMATCH",
	"CERTIFICATE_INVALID",
	"INTERNAL_FAILURE",
] as const);
export type SimulationResidentReadinessWorkerErrorCode =
	(typeof SIMULATION_RESIDENT_READINESS_WORKER_ERROR_CODES)[number];

interface SimulationResidentReadinessWorkerCorrelation {
	readonly protocolVersion: typeof SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
}

export interface CertifySimulationResidentReadinessWorkerRequest
	extends SimulationResidentReadinessWorkerCorrelation {
	readonly type: "CERTIFY_SIMULATION_RESIDENT_READINESS";
	readonly sources: SimulationResidentReadinessSources;
}

export interface SimulationResidentReadinessCertifiedWorkerResponse
	extends SimulationResidentReadinessWorkerCorrelation {
	readonly type: "SIMULATION_RESIDENT_READINESS_CERTIFIED";
	/** Sources stay in the caller realm; the disposable Worker returns metadata authority only. */
	readonly certificate: SimulationResidentReadinessCertificate;
}

export interface SimulationResidentReadinessRejectedWorkerResponse
	extends SimulationResidentReadinessWorkerCorrelation {
	readonly type: "SIMULATION_RESIDENT_READINESS_REJECTED";
	readonly code: SimulationResidentReadinessWorkerErrorCode;
	readonly message: string;
}

export type SimulationResidentReadinessWorkerRequest =
	CertifySimulationResidentReadinessWorkerRequest;
export type SimulationResidentReadinessWorkerResponse =
	| SimulationResidentReadinessCertifiedWorkerResponse
	| SimulationResidentReadinessRejectedWorkerResponse;

const CERTIFIED_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"certificate",
] as const);
const REJECTED_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"code",
	"message",
] as const);

export function simulationResidentReadinessWorkerResponseError(value: unknown): string | null {
	if (!isRecord(value)) return "resident readiness Worker response must be an object";
	if (
		value.protocolVersion !== SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION ||
		!isNonNegativeSafeInteger(value.requestId) ||
		!isNonNegativeSafeInteger(value.generation)
	) {
		return "resident readiness Worker response correlation is invalid";
	}
	if (value.type === "SIMULATION_RESIDENT_READINESS_CERTIFIED") {
		if (!hasExactKeys(value, CERTIFIED_RESPONSE_KEYS)) {
			return "certified resident readiness response contains missing or unexpected fields";
		}
		const certificateError = simulationResidentReadinessCertificateError(value.certificate);
		return certificateError
			? `resident readiness response certificate is invalid: ${certificateError}`
			: null;
	}
	if (value.type === "SIMULATION_RESIDENT_READINESS_REJECTED") {
		if (!hasExactKeys(value, REJECTED_RESPONSE_KEYS)) {
			return "rejected resident readiness response contains missing or unexpected fields";
		}
		if (
			typeof value.code !== "string" ||
			!SIMULATION_RESIDENT_READINESS_WORKER_ERROR_CODES.includes(
				value.code as SimulationResidentReadinessWorkerErrorCode,
			) ||
			typeof value.message !== "string" ||
			value.message.length === 0 ||
			value.message.length > 240
		) {
			return "resident readiness rejection details are invalid";
		}
		return null;
	}
	return "resident readiness Worker response type is invalid";
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
