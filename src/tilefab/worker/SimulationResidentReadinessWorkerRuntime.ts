import {
	publishSimulationResidentReadinessSnapshot,
	simulationResidentReadinessSourcesError,
} from "../compile/SimulationResidentReadinessCertificate";
import {
	SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationResidentReadinessWorkerErrorCode,
	type SimulationResidentReadinessWorkerResponse,
} from "./SimulationResidentReadinessWorkerProtocol";

const MAX_ERROR_MESSAGE_LENGTH = 240;
const REQUEST_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"sources",
] as const);

export async function certifySimulationResidentReadinessWorkerRequest(
	value: unknown,
): Promise<SimulationResidentReadinessWorkerResponse> {
	const correlation = requestCorrelation(value);
	if (!isRecord(value) || !validRequestEnvelope(value)) {
		return rejected(
			correlation,
			"MALFORMED_REQUEST",
			"Resident readiness Worker request is malformed.",
		);
	}
	const sourceError = simulationResidentReadinessSourcesError(value.sources);
	if (sourceError) {
		return rejected(
			correlation,
			isSourceMismatch(sourceError) ? "SOURCE_IDENTITY_MISMATCH" : "INVALID_SOURCE",
			sourceError,
		);
	}
	try {
		const published = await publishSimulationResidentReadinessSnapshot(value.sources);
		return Object.freeze({
			type: "SIMULATION_RESIDENT_READINESS_CERTIFIED" as const,
			protocolVersion: SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
			requestId: correlation.requestId,
			generation: correlation.generation,
			certificate: published.certificate,
		});
	} catch (error) {
		return rejected(
			correlation,
			"CERTIFICATE_INVALID",
			error instanceof Error ? error.message : "Resident readiness certification failed.",
		);
	}
}

function validRequestEnvelope(value: Record<string, unknown>): value is {
	readonly type: "CERTIFY_SIMULATION_RESIDENT_READINESS";
	readonly protocolVersion: typeof SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly sources: Parameters<typeof publishSimulationResidentReadinessSnapshot>[0];
} {
	return (
		hasExactKeys(value, REQUEST_KEYS) &&
		value.type === "CERTIFY_SIMULATION_RESIDENT_READINESS" &&
		value.protocolVersion === SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION &&
		isPositiveSafeInteger(value.requestId) &&
		isNonNegativeSafeInteger(value.generation) &&
		isRecord(value.sources)
	);
}

function requestCorrelation(value: unknown): {
	readonly requestId: number;
	readonly generation: number;
} {
	if (!isRecord(value)) return { requestId: 0, generation: 0 };
	return {
		requestId: isPositiveSafeInteger(value.requestId) ? value.requestId : 0,
		generation: isNonNegativeSafeInteger(value.generation) ? value.generation : 0,
	};
}

function rejected(
	correlation: { readonly requestId: number; readonly generation: number },
	code: SimulationResidentReadinessWorkerErrorCode,
	message: string,
): SimulationResidentReadinessWorkerResponse {
	return Object.freeze({
		type: "SIMULATION_RESIDENT_READINESS_REJECTED" as const,
		protocolVersion: SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
		requestId: correlation.requestId,
		generation: correlation.generation,
		code,
		message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
	});
}

function isSourceMismatch(message: string): boolean {
	return (
		message.includes("do not match") ||
		message.includes("does not match") ||
		message.includes("exact sources") ||
		message.includes("fingerprint")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
