import {
	composeOpenFabFab,
	validateOpenFabFabCompositionCertificate,
} from "../compile/OpenFabFabComposer";
import {
	createOpenFabFabPreparedProjectAttestation,
	createOpenFabFabPreparedProjectIdentity,
	OPENFAB_FAB_PREPARED_PROJECT_KIND,
	OPENFAB_FAB_PREPARED_PROJECT_VERSION,
	openFabFabPreparedProjectRequestFingerprint,
} from "../compile/OpenFabFabPreparedProject";
import { normalizeOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import {
	OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
	type OpenFabFabPreparedProjectErrorCode,
	type OpenFabFabPreparedProjectOperation,
	type OpenFabFabPreparedProjectWorkerRequest,
	type OpenFabFabPreparedProjectWorkerResponse,
} from "./OpenFabFabPreparedProjectProtocol";
import { railMirrorSnapshotTransfers } from "./railMirrorProtocol";

const REQUEST_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"requestFingerprint",
	"profile",
] as const);

export function runOpenFabFabPreparedProjectRequest(
	value: unknown,
): OpenFabFabPreparedProjectWorkerResponse {
	let { operation, requestId, requestFingerprint } = requestCorrelation(value);
	try {
		const request = parseRequest(value);
		operation = request.type === "PREPARE_OPENFAB_FAB_PROJECT_SOURCE" ? "SOURCE" : "VERIFY";
		requestId = request.requestId;
		requestFingerprint = request.requestFingerprint;
		const certificate = composeOpenFabFab(request.profile);
		const certificateError = validateOpenFabFabCompositionCertificate(certificate);
		if (certificateError) {
			return errorResponse(
				requestId,
				requestFingerprint,
				operation,
				"CERTIFICATE_INVALID",
				certificateError,
			);
		}
		const identity = createOpenFabFabPreparedProjectIdentity(certificate);
		if (request.type === "VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION") {
			return Object.freeze({
				type: "OPENFAB_FAB_PROJECT_MATERIALIZATION_VERIFIED",
				protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
				requestId,
				requestFingerprint,
				identity,
			});
		}
		const snapshot = certificate.roundTrippedSnapshot;
		const transfers = railMirrorSnapshotTransfers(snapshot);
		const transferableByteLength = assertUniqueOwnedTransferBuffers(transfers);
		const prepared = Object.freeze({
			kind: OPENFAB_FAB_PREPARED_PROJECT_KIND,
			version: OPENFAB_FAB_PREPARED_PROJECT_VERSION,
			requestFingerprint,
			profile: certificate.profile,
			identity,
			snapshot,
		});
		return Object.freeze({
			type: "OPENFAB_FAB_PROJECT_SOURCE_PREPARED",
			protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
			requestId,
			requestFingerprint,
			prepared,
			attestation: createOpenFabFabPreparedProjectAttestation({
				requestFingerprint,
				materializationFingerprint: identity.fingerprint,
				snapshotChecksum: snapshot.checksum,
				transferableBufferCount: transfers.length,
				transferableByteLength,
			}),
		});
	} catch (error) {
		return errorResponse(
			requestId,
			requestFingerprint,
			operation,
			classifyError(error),
			errorMessage(error),
		);
	}
}

function requestCorrelation(value: unknown): {
	readonly operation: OpenFabFabPreparedProjectOperation;
	readonly requestId: number;
	readonly requestFingerprint: string;
} {
	if (!isRecord(value)) {
		return { operation: "VERIFY", requestId: 0, requestFingerprint: "invalid" };
	}
	const operation: OpenFabFabPreparedProjectOperation =
		value.type === "PREPARE_OPENFAB_FAB_PROJECT_SOURCE" ? "SOURCE" : "VERIFY";
	const requestId =
		Number.isSafeInteger(value.requestId) && (value.requestId as number) > 0
			? (value.requestId as number)
			: 0;
	const requestFingerprint =
		typeof value.requestFingerprint === "string" &&
		value.requestFingerprint.length > 0 &&
		value.requestFingerprint.length <= 512
			? value.requestFingerprint
			: "invalid";
	return { operation, requestId, requestFingerprint };
}

export function collectOpenFabFabPreparedProjectResponseTransfers(
	response: OpenFabFabPreparedProjectWorkerResponse,
): Transferable[] {
	return response.type === "OPENFAB_FAB_PROJECT_SOURCE_PREPARED"
		? railMirrorSnapshotTransfers(response.prepared.snapshot)
		: [];
}

function parseRequest(value: unknown): OpenFabFabPreparedProjectWorkerRequest {
	if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
		throw new PreparedProjectRequestError("MALFORMED_REQUEST", "Request fields are malformed.");
	}
	if (
		value.type !== "VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION" &&
		value.type !== "PREPARE_OPENFAB_FAB_PROJECT_SOURCE"
	) {
		throw new PreparedProjectRequestError("MALFORMED_REQUEST", "Request type is invalid.");
	}
	if (
		value.protocolVersion !== OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION ||
		!Number.isSafeInteger(value.requestId) ||
		(value.requestId as number) < 1 ||
		typeof value.requestFingerprint !== "string" ||
		value.requestFingerprint.length === 0 ||
		value.requestFingerprint.length > 512
	) {
		throw new PreparedProjectRequestError(
			"MALFORMED_REQUEST",
			"Request scalar fields are invalid.",
		);
	}
	let profile: ReturnType<typeof normalizeOpenFabFabProfile>;
	try {
		profile = normalizeOpenFabFabProfile(value.profile);
	} catch {
		throw new PreparedProjectRequestError("MALFORMED_REQUEST", "Request profile is invalid.");
	}
	const expected = openFabFabPreparedProjectRequestFingerprint(profile);
	if (value.requestFingerprint !== expected) {
		throw new PreparedProjectRequestError(
			"REQUEST_MISMATCH",
			"Request fingerprint does not match the normalized profile.",
		);
	}
	return Object.freeze({
		type: value.type,
		protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
		requestId: value.requestId as number,
		requestFingerprint: expected,
		profile,
	}) as OpenFabFabPreparedProjectWorkerRequest;
}

function assertUniqueOwnedTransferBuffers(transfers: readonly Transferable[]): number {
	const seen = new Set<ArrayBuffer>();
	let byteLength = 0;
	for (const transfer of transfers) {
		if (!(transfer instanceof ArrayBuffer) || seen.has(transfer)) {
			throw new PreparedProjectRequestError(
				"TRANSFER_INVALID",
				"Prepared source does not uniquely own full transferable buffers.",
			);
		}
		seen.add(transfer);
		byteLength += transfer.byteLength;
	}
	return byteLength;
}

class PreparedProjectRequestError extends Error {
	readonly code: OpenFabFabPreparedProjectErrorCode;

	constructor(code: OpenFabFabPreparedProjectErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

function classifyError(error: unknown): OpenFabFabPreparedProjectErrorCode {
	return error instanceof PreparedProjectRequestError ? error.code : "COMPOSITION_FAILED";
}

function errorResponse(
	requestId: number,
	requestFingerprint: string,
	operation: OpenFabFabPreparedProjectOperation,
	code: OpenFabFabPreparedProjectErrorCode,
	message: string,
): OpenFabFabPreparedProjectWorkerResponse {
	return Object.freeze({
		type: "OPENFAB_FAB_PREPARED_PROJECT_ERROR",
		protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
		requestId,
		requestFingerprint,
		operation,
		code,
		message: message.slice(0, 512),
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message
		? error.message
		: "OpenFab Fab project materialization failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
