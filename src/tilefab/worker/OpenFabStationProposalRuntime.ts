import {
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	validateOpenFabStationProposalArtifact,
	validateOpenFabStationProposalReadFailure,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import { OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES } from "../project/OpenFabStationProposalPorts";
import {
	OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalWorkerErrorCode,
	type OpenFabStationProposalWorkerRequest,
	type OpenFabStationProposalWorkerResponse,
	openFabStationProposalWorkerErrorMessage,
} from "./OpenFabStationProposalProtocol";
import { collectTransferableBuffers } from "./TransferableBuffers";

const REQUEST_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"schemaId",
	"schemaVersion",
	"requestId",
	"generation",
	"byteLength",
	"source",
] as const);

interface RequestCorrelation {
	readonly requestId: number;
	readonly generation: number;
	readonly byteLength: number;
}

/** Parse an untrusted source exactly once inside a disposable Worker boundary. */
export function runOpenFabStationProposalWorkerRequest(
	value: unknown,
): OpenFabStationProposalWorkerResponse {
	let correlation: RequestCorrelation = { requestId: 0, generation: 0, byteLength: 0 };
	try {
		correlation = requestCorrelation(value);
	} catch {
		return errorResponse(correlation, "MALFORMED_REQUEST");
	}
	let request: OpenFabStationProposalWorkerRequest;
	try {
		request = parseRequest(value);
	} catch {
		return errorResponse(correlation, "MALFORMED_REQUEST");
	}

	let result: ReturnType<typeof parseOpenFabStationProposalCsv>;
	try {
		result = parseOpenFabStationProposalCsv(new Uint8Array(request.source));
	} catch {
		return errorResponse(correlation, "READ_FAILED");
	}

	try {
		if (result.ok) {
			const artifact = result.artifact;
			validateOpenFabStationProposalArtifact(artifact);
			if (artifact.sourceByteLength !== request.byteLength) {
				throw new Error("SOURCE_LENGTH_MISMATCH");
			}
			assertIndependentTransferBuffers(collectTransferableBuffers(artifact), request.source);
			return Object.freeze({
				type: "OPENFAB_STATION_PROPOSAL_READ",
				...responseCorrelation(request),
				artifact,
			});
		}
		const failure = result.failure;
		validateOpenFabStationProposalReadFailure(failure);
		if (failure.sourceByteLength !== request.byteLength) {
			throw new Error("SOURCE_LENGTH_MISMATCH");
		}
		assertIndependentTransferBuffers(collectTransferableBuffers(failure), request.source);
		return Object.freeze({
			type: "OPENFAB_STATION_PROPOSAL_REJECTED",
			...responseCorrelation(request),
			failure,
		});
	} catch {
		return errorResponse(correlation, "TRANSFER_INVALID");
	}
}

export function collectOpenFabStationProposalResponseTransfers(
	response: OpenFabStationProposalWorkerResponse,
): ArrayBuffer[] {
	if (response.type === "OPENFAB_STATION_PROPOSAL_READ") {
		return collectTransferableBuffers(response.artifact);
	}
	if (response.type === "OPENFAB_STATION_PROPOSAL_REJECTED") {
		return collectTransferableBuffers(response.failure);
	}
	return [];
}

function parseRequest(value: unknown): OpenFabStationProposalWorkerRequest {
	if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
		throw new Error("MALFORMED_REQUEST");
	}
	if (
		value.type !== "READ_OPENFAB_STATION_PROPOSAL" ||
		value.protocolVersion !== OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION ||
		value.schemaId !== OPENFAB_STATION_PROPOSAL_SCHEMA_ID ||
		value.schemaVersion !== OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION ||
		!isPositiveSafeInteger(value.requestId) ||
		!isPositiveSafeInteger(value.generation) ||
		!isBoundedByteLength(value.byteLength) ||
		!(value.source instanceof ArrayBuffer) ||
		value.source.byteLength !== value.byteLength
	) {
		throw new Error("MALFORMED_REQUEST");
	}
	return value as unknown as OpenFabStationProposalWorkerRequest;
}

function requestCorrelation(value: unknown): RequestCorrelation {
	if (!isRecord(value)) return { requestId: 0, generation: 0, byteLength: 0 };
	return {
		requestId: isPositiveSafeInteger(value.requestId) ? value.requestId : 0,
		generation: isPositiveSafeInteger(value.generation) ? value.generation : 0,
		byteLength: isBoundedByteLength(value.byteLength) ? value.byteLength : 0,
	};
}

function responseCorrelation(correlation: RequestCorrelation): {
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION;
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly byteLength: number;
} {
	return {
		protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
		schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
		schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
		requestId: correlation.requestId,
		generation: correlation.generation,
		byteLength: correlation.byteLength,
	};
}

function errorResponse(
	correlation: RequestCorrelation,
	code: OpenFabStationProposalWorkerErrorCode,
): OpenFabStationProposalWorkerResponse {
	return Object.freeze({
		type: "OPENFAB_STATION_PROPOSAL_ERROR",
		...responseCorrelation(correlation),
		code,
		message: openFabStationProposalWorkerErrorMessage(code),
	});
}

function assertIndependentTransferBuffers(
	buffers: readonly ArrayBuffer[],
	source: ArrayBuffer,
): void {
	const seen = new Set<ArrayBuffer>();
	for (const buffer of buffers) {
		if (!(buffer instanceof ArrayBuffer) || buffer === source || seen.has(buffer)) {
			throw new Error("TRANSFER_INVALID");
		}
		seen.add(buffer);
	}
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isBoundedByteLength(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		(value as number) <= OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES
	);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
