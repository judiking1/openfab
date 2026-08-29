import {
	publishedSimulationReadinessSnapshotError,
	publishSimulationReadinessSnapshot,
	simulationReadinessComponentsError,
} from "../compile/SimulationReadinessCertificate";
import {
	SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationReadinessWorkerErrorCode,
	type SimulationReadinessWorkerResponse,
} from "./SimulationReadinessWorkerProtocol";
import { collectTransferableBuffers } from "./TransferableBuffers";

const MAX_ERROR_MESSAGE_LENGTH = 240;

export function certifySimulationReadinessWorkerRequest(
	value: unknown,
): SimulationReadinessWorkerResponse {
	const correlation = requestCorrelation(value);
	if (!isRecord(value) || !validRequestEnvelope(value)) {
		return rejected(correlation, "MALFORMED_REQUEST", "Readiness Worker request is malformed.");
	}
	const componentError = simulationReadinessComponentsError(value.components);
	if (componentError) {
		return rejected(
			correlation,
			isSourceMismatch(componentError) ? "SOURCE_IDENTITY_MISMATCH" : "INVALID_COMPONENT",
			componentError,
		);
	}
	let published: ReturnType<typeof publishSimulationReadinessSnapshot>;
	try {
		published = publishSimulationReadinessSnapshot(value.components);
	} catch (error) {
		return rejected(
			correlation,
			"CERTIFICATE_INVALID",
			error instanceof Error ? error.message : "Readiness certificate compilation failed.",
		);
	}
	const publishedError = publishedSimulationReadinessSnapshotError(published);
	if (publishedError) return rejected(correlation, "CERTIFICATE_INVALID", publishedError);
	return Object.freeze({
		type: "SIMULATION_READINESS_CERTIFIED" as const,
		protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
		requestId: correlation.requestId,
		generation: correlation.generation,
		published,
	});
}

export function collectSimulationReadinessWorkerResponseTransferBuffers(
	response: SimulationReadinessWorkerResponse,
): ArrayBuffer[] {
	return response.type === "SIMULATION_READINESS_CERTIFIED"
		? collectTransferableBuffers(response.published)
		: [];
}

function validRequestEnvelope(value: Record<string, unknown>): value is {
	readonly type: "CERTIFY_SIMULATION_READINESS";
	readonly protocolVersion: typeof SIMULATION_READINESS_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly components: Parameters<typeof publishSimulationReadinessSnapshot>[0];
} {
	return (
		value.type === "CERTIFY_SIMULATION_READINESS" &&
		value.protocolVersion === SIMULATION_READINESS_WORKER_PROTOCOL_VERSION &&
		isPositiveSafeInteger(value.requestId) &&
		isNonNegativeSafeInteger(value.generation) &&
		isRecord(value.components)
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
	code: SimulationReadinessWorkerErrorCode,
	message: string,
): SimulationReadinessWorkerResponse {
	return Object.freeze({
		type: "SIMULATION_READINESS_REJECTED" as const,
		protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
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
		message.includes("fingerprints")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
