import { describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import generatedParallelHallArtifactSource from "../generated/synthetic-fab-presets/parallel-hall-fab-12.default.v1.json?raw";
import {
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
	type SyntheticFabStarterCertifiedArtifactWorkerRequest,
	type SyntheticFabStarterCertifiedArtifactWorkerResponse,
} from "../worker/SyntheticFabStarterCertifiedArtifactProtocol";
import { hydrateSyntheticFabStarterCertifiedArtifactRequest } from "../worker/SyntheticFabStarterCertifiedArtifactRuntime";
import {
	certificationEvidenceMatchesPrepared,
	isSyntheticFabStarterCertificationEvidence,
} from "./SyntheticFabStarterCertifiedArtifact";
import {
	SyntheticFabStarterCertifiedArtifactBridge,
	type SyntheticFabStarterCertifiedArtifactWorkerPort,
} from "./SyntheticFabStarterCertifiedArtifactBridge";

describe("SyntheticFabStarterCertifiedArtifactBridge", () => {
	const starter = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");

	it("posts raw source and rebinds transferred Worker evidence in the main realm", async () => {
		const worker = new FakeCertifiedArtifactWorker();
		const bridge = new SyntheticFabStarterCertifiedArtifactBridge(() => worker);
		const pending = bridge.hydrate(generatedParallelHallArtifactSource, starter);
		const request = worker.request;
		if (!request) throw new Error("Expected a Worker hydration request.");
		expect(request.source).toBe(generatedParallelHallArtifactSource);
		expect(request.artifactId).toBe("parallel-hall-fab-12.default.v1");

		worker.emit(hydrateSyntheticFabStarterCertifiedArtifactRequest(request));
		const hydrated = await pending;
		if (!hydrated) throw new Error("Expected a certified Worker result.");
		expect(isSyntheticFabStarterCertificationEvidence(hydrated.evidence)).toBe(true);
		expect(
			certificationEvidenceMatchesPrepared(hydrated.evidence, hydrated.prepared, starter),
		).toBe(true);
		expect(worker.terminated).toBe(true);
	});

	it("resolves a fail-closed artifact rejection without binding evidence", async () => {
		const worker = new FakeCertifiedArtifactWorker();
		const bridge = new SyntheticFabStarterCertifiedArtifactBridge(() => worker);
		const pending = bridge.hydrate(generatedParallelHallArtifactSource, starter);
		const request = worker.request;
		if (!request) throw new Error("Expected a Worker hydration request.");
		worker.emit({
			type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED",
			protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
			requestId: request.requestId,
		});

		await expect(pending).resolves.toBeNull();
		expect(worker.terminated).toBe(true);
	});

	it("rejects malformed, stale, and forged-success responses", async () => {
		for (const createResponse of [
			(request: SyntheticFabStarterCertifiedArtifactWorkerRequest) => ({
				type: "UNKNOWN",
				protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
				requestId: request.requestId,
			}),
			(request: SyntheticFabStarterCertifiedArtifactWorkerRequest) => ({
				...hydrateSyntheticFabStarterCertifiedArtifactRequest(request),
				requestId: request.requestId + 1,
			}),
			(request: SyntheticFabStarterCertifiedArtifactWorkerRequest) => {
				const response = hydrateSyntheticFabStarterCertifiedArtifactRequest(request);
				if (response.type !== "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED") {
					throw new Error("Expected a hydrated runtime response.");
				}
				return {
					...response,
					attestation: { ...response.attestation, requestFingerprint: "forged" },
				};
			},
			(request: SyntheticFabStarterCertifiedArtifactWorkerRequest) => {
				const response = hydrateSyntheticFabStarterCertifiedArtifactRequest(request);
				if (response.type !== "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED") {
					throw new Error("Expected a hydrated runtime response.");
				}
				return {
					...response,
					attestation: {
						...response.attestation,
						transferredTypedArrayFingerprint: "00000000:00000000",
					},
				};
			},
		]) {
			const worker = new FakeCertifiedArtifactWorker();
			const bridge = new SyntheticFabStarterCertifiedArtifactBridge(() => worker);
			const pending = bridge.hydrate(generatedParallelHallArtifactSource, starter);
			const request = worker.request;
			if (!request) throw new Error("Expected a Worker hydration request.");
			worker.emit(createResponse(request));

			await expect(pending).rejects.toThrow();
			expect(worker.terminated).toBe(true);
		}
	});

	it("terminates on timeout, decode failure, cancellation, and post failure", async () => {
		const timeoutWorker = new FakeCertifiedArtifactWorker();
		const timeoutBridge = new SyntheticFabStarterCertifiedArtifactBridge(() => timeoutWorker, 5);
		await expect(
			timeoutBridge.hydrate(generatedParallelHallArtifactSource, starter),
		).rejects.toThrow(/timed out/);
		expect(timeoutWorker.terminated).toBe(true);

		const decodeWorker = new FakeCertifiedArtifactWorker();
		const decodeBridge = new SyntheticFabStarterCertifiedArtifactBridge(() => decodeWorker);
		const decodePending = decodeBridge.hydrate(generatedParallelHallArtifactSource, starter);
		decodeWorker.onmessageerror?.({ data: null } as MessageEvent<unknown>);
		await expect(decodePending).rejects.toThrow(/decoded/);
		expect(decodeWorker.terminated).toBe(true);

		const cancelWorker = new FakeCertifiedArtifactWorker();
		const cancelBridge = new SyntheticFabStarterCertifiedArtifactBridge(() => cancelWorker);
		const cancelPending = cancelBridge.hydrate(generatedParallelHallArtifactSource, starter);
		cancelBridge.cancel();
		await expect(cancelPending).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelWorker.terminated).toBe(true);

		const postWorker = new FakeCertifiedArtifactWorker();
		postWorker.postError = new Error("post failed");
		const postBridge = new SyntheticFabStarterCertifiedArtifactBridge(() => postWorker);
		await expect(postBridge.hydrate(generatedParallelHallArtifactSource, starter)).rejects.toThrow(
			/post failed/,
		);
		expect(postWorker.terminated).toBe(true);
	});
});

class FakeCertifiedArtifactWorker implements SyntheticFabStarterCertifiedArtifactWorkerPort {
	onmessage:
		| ((event: MessageEvent<SyntheticFabStarterCertifiedArtifactWorkerResponse>) => void)
		| null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	request: SyntheticFabStarterCertifiedArtifactWorkerRequest | null = null;
	terminated = false;
	postError: Error | null = null;

	postMessage(request: SyntheticFabStarterCertifiedArtifactWorkerRequest): void {
		if (this.postError) throw this.postError;
		this.request = request;
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(response: unknown): void {
		this.onmessage?.({
			data: response,
		} as MessageEvent<SyntheticFabStarterCertifiedArtifactWorkerResponse>);
	}
}
