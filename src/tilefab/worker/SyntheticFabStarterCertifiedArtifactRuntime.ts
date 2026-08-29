import {
	type SyntheticFabStarterRequest,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import {
	hydrateSyntheticFabStarterCertifiedArtifactForTransfer,
	syntheticFabStarterCertifiedArtifactIdForRequest,
} from "../editor/SyntheticFabStarterCertifiedArtifact";
import {
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
	type SyntheticFabStarterCertifiedArtifactWorkerRequest,
	type SyntheticFabStarterCertifiedArtifactWorkerResponse,
} from "./SyntheticFabStarterCertifiedArtifactProtocol";

export function hydrateSyntheticFabStarterCertifiedArtifactRequest(
	request: SyntheticFabStarterCertifiedArtifactWorkerRequest,
): SyntheticFabStarterCertifiedArtifactWorkerResponse {
	assertWorkerRequest(request);
	let expectedArtifactId: ReturnType<typeof syntheticFabStarterCertifiedArtifactIdForRequest>;
	let expectedRequestFingerprint: string;
	try {
		expectedArtifactId = syntheticFabStarterCertifiedArtifactIdForRequest(request.starter);
		expectedRequestFingerprint = syntheticFabStarterRequestFingerprint(request.starter);
	} catch {
		return rejectedResponse(request.requestId);
	}
	if (
		expectedArtifactId === null ||
		request.artifactId !== expectedArtifactId ||
		request.requestFingerprint !== expectedRequestFingerprint
	) {
		return rejectedResponse(request.requestId);
	}
	const hydrated = hydrateSyntheticFabStarterCertifiedArtifactForTransfer(
		request.source,
		request.starter,
	);
	if (
		!hydrated ||
		hydrated.attestation.artifactId !== request.artifactId ||
		hydrated.attestation.requestFingerprint !== request.requestFingerprint
	) {
		return rejectedResponse(request.requestId);
	}
	return Object.freeze({
		type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED",
		protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
		requestId: request.requestId,
		prepared: hydrated.prepared,
		attestation: hydrated.attestation,
	});
}

function assertWorkerRequest(
	request: SyntheticFabStarterCertifiedArtifactWorkerRequest,
): asserts request is SyntheticFabStarterCertifiedArtifactWorkerRequest {
	if (
		request.type !== "HYDRATE_SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT" ||
		request.protocolVersion !== SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION ||
		!Number.isSafeInteger(request.requestId) ||
		request.requestId <= 0 ||
		typeof request.artifactId !== "string" ||
		typeof request.requestFingerprint !== "string" ||
		typeof request.source !== "string" ||
		!isRecord(request.starter)
	) {
		throw new Error("Certified FAB artifact Worker request is malformed.");
	}
}

function rejectedResponse(requestId: number): SyntheticFabStarterCertifiedArtifactWorkerResponse {
	return Object.freeze({
		type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED",
		protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
		requestId,
	});
}

function isRecord(value: unknown): value is SyntheticFabStarterRequest & Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
