import { describe, expect, it } from "vitest";
import {
	isPublishedSimulationReadinessSnapshot,
	type PublishedSimulationReadinessSnapshot,
} from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponents } from "../compile/SimulationReadinessTestFixture";
import type {
	SimulationReadinessWorkerRequest,
	SimulationReadinessWorkerResponse,
} from "../worker/SimulationReadinessWorkerProtocol";
import {
	certifySimulationReadinessWorkerRequest,
	collectSimulationReadinessWorkerResponseTransferBuffers,
} from "../worker/SimulationReadinessWorkerRuntime";
import {
	SimulationReadinessBridge,
	type SimulationReadinessWorkerPort,
} from "./SimulationReadinessBridge";

class RuntimeReadinessWorker implements SimulationReadinessWorkerPort {
	onmessage: ((event: MessageEvent<SimulationReadinessWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestTransferBytes = 0;
	responseTransferCount = 0;
	responseTransferBytes = 0;

	postMessage(message: SimulationReadinessWorkerRequest, transfer: Transferable[] = []): void {
		this.requestTransferCount = transfer.length;
		this.requestTransferBytes = transferByteLength(transfer);
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated) return;
			try {
				const response = certifySimulationReadinessWorkerRequest(delivered);
				const responseTransfers = collectSimulationReadinessWorkerResponseTransferBuffers(response);
				this.responseTransferCount = responseTransfers.length;
				this.responseTransferBytes = transferByteLength(responseTransfers);
				const deliveredResponse = structuredClone(response, { transfer: responseTransfers });
				this.onmessage?.({
					data: deliveredResponse,
				} as MessageEvent<SimulationReadinessWorkerResponse>);
			} catch (error) {
				this.onerror?.({
					message: error instanceof Error ? error.message : "readiness runtime failed",
				} as ErrorEvent);
			}
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class ControlledReadinessWorker implements SimulationReadinessWorkerPort {
	onmessage: ((event: MessageEvent<SimulationReadinessWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	request: SimulationReadinessWorkerRequest | null = null;

	postMessage(message: SimulationReadinessWorkerRequest, transfer: Transferable[] = []): void {
		this.request = structuredClone(message, { transfer });
	}

	certifiedResponse(): SimulationReadinessWorkerResponse {
		if (!this.request) throw new Error("Expected a readiness request.");
		return certifySimulationReadinessWorkerRequest(this.request);
	}

	emit(response: SimulationReadinessWorkerResponse): void {
		this.onmessage?.({ data: response } as MessageEvent<SimulationReadinessWorkerResponse>);
	}

	emitError(message: string): void {
		this.onerror?.({ message } as ErrorEvent);
	}

	emitMessageError(): void {
		this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("SimulationReadinessBridge", () => {
	it("preserves canonical components and round-trips one independently certified owned copy", async () => {
		const canonical = buildSimulationReadinessTestComponents();
		const canonicalByteLength = canonical.foundation.paths.positions.byteLength;
		const worker = new RuntimeReadinessWorker();
		const bridge = new SimulationReadinessBridge(() => worker);

		const published = await bridge.certify(canonical, 12);

		expect(published.certificate).toMatchObject({
			simulationReady: true,
			foundationFingerprint: canonical.foundation.fingerprint,
		});
		expect(isPublishedSimulationReadinessSnapshot(published)).toBe(true);
		expect(published.foundation.paths.positions.byteLength).toBeGreaterThan(0);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalByteLength);
		expect(worker.requestTransferCount).toBeGreaterThan(0);
		expect(worker.requestTransferBytes).toBe(published.certificate.snapshotByteLength);
		expect(worker.responseTransferCount).toBe(worker.requestTransferCount);
		expect(worker.responseTransferBytes).toBe(published.certificate.snapshotByteLength);
		expect(worker.terminated).toBe(true);
	});

	it("rejects stale correlation and a certificate that does not match returned components", async () => {
		const staleWorker = new ControlledReadinessWorker();
		const stalePending = new SimulationReadinessBridge(() => staleWorker).certify(
			buildSimulationReadinessTestComponents(),
			4,
		);
		const staleResponse = staleWorker.certifiedResponse();
		staleWorker.emit({ ...staleResponse, requestId: staleResponse.requestId + 1 });
		await expect(stalePending).rejects.toThrow(/stale or mismatched response/i);
		expect(staleWorker.terminated).toBe(true);

		const invalidWorker = new ControlledReadinessWorker();
		const invalidPending = new SimulationReadinessBridge(() => invalidWorker).certify(
			buildSimulationReadinessTestComponents(),
			5,
		);
		const valid = invalidWorker.certifiedResponse();
		if (valid.type !== "SIMULATION_READINESS_CERTIFIED") {
			throw new Error("Expected valid readiness fixture response.");
		}
		const invalidPublished: PublishedSimulationReadinessSnapshot = {
			...valid.published,
			certificate: {
				...valid.published.certificate,
				sourceRevision: valid.published.certificate.sourceRevision + 1,
			},
		};
		invalidWorker.emit({ ...valid, published: invalidPublished });
		await expect(invalidPending).rejects.toThrow(/invalid published snapshot/i);
		expect(invalidWorker.terminated).toBe(true);
	});

	it("surfaces typed, native, and unreadable failures and releases each Worker", async () => {
		const rejectedWorker = new ControlledReadinessWorker();
		const rejectedPending = new SimulationReadinessBridge(() => rejectedWorker).certify(
			buildSimulationReadinessTestComponents(),
			1,
		);
		if (!rejectedWorker.request) throw new Error("Expected readiness request.");
		rejectedWorker.emit({
			type: "SIMULATION_READINESS_REJECTED",
			protocolVersion: rejectedWorker.request.protocolVersion,
			requestId: rejectedWorker.request.requestId,
			generation: rejectedWorker.request.generation,
			code: "INVALID_COMPONENT",
			message: "component validation failed",
		});
		await expect(rejectedPending).rejects.toThrow("component validation failed");
		expect(rejectedWorker.terminated).toBe(true);

		const nativeWorker = new ControlledReadinessWorker();
		const nativePending = new SimulationReadinessBridge(() => nativeWorker).certify(
			buildSimulationReadinessTestComponents(),
			2,
		);
		nativeWorker.emitError("worker crashed");
		await expect(nativePending).rejects.toThrow("worker crashed");
		expect(nativeWorker.terminated).toBe(true);

		const unreadableWorker = new ControlledReadinessWorker();
		const unreadablePending = new SimulationReadinessBridge(() => unreadableWorker).certify(
			buildSimulationReadinessTestComponents(),
			3,
		);
		unreadableWorker.emitMessageError();
		await expect(unreadablePending).rejects.toThrow(/unreadable response/i);
		expect(unreadableWorker.terminated).toBe(true);
	});

	it("honors pre-aborted and in-flight cancellation without detaching canonical data", async () => {
		const canonical = buildSimulationReadinessTestComponents();
		const canonicalByteLength = canonical.foundation.paths.positions.byteLength;
		const preAborted = new AbortController();
		preAborted.abort();
		let workerCreations = 0;
		const bridge = new SimulationReadinessBridge(() => {
			workerCreations++;
			return new ControlledReadinessWorker();
		});

		await expect(bridge.certify(canonical, 1, preAborted.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(workerCreations).toBe(0);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalByteLength);

		const worker = new ControlledReadinessWorker();
		const controller = new AbortController();
		const pending = new SimulationReadinessBridge(() => worker).certify(
			canonical,
			2,
			controller.signal,
		);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalByteLength);
	});

	it("times out and terminates a silent one-shot Worker", async () => {
		const worker = new ControlledReadinessWorker();
		const bridge = new SimulationReadinessBridge(() => worker, 1);

		await expect(bridge.certify(buildSimulationReadinessTestComponents(), 6)).rejects.toThrow(
			/timed out after 1 ms/i,
		);
		expect(worker.terminated).toBe(true);
	});
});

function transferByteLength(values: readonly Transferable[]): number {
	let total = 0;
	for (const value of values) {
		if (value instanceof ArrayBuffer) total += value.byteLength;
	}
	return total;
}
