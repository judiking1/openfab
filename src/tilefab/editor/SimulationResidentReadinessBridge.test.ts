import { describe, expect, it } from "vitest";
import {
	isPublishedSimulationResidentReadinessSnapshot,
	type SimulationResidentReadinessSources,
} from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import type {
	SimulationResidentReadinessWorkerRequest,
	SimulationResidentReadinessWorkerResponse,
} from "../worker/SimulationResidentReadinessWorkerProtocol";
import { certifySimulationResidentReadinessWorkerRequest } from "../worker/SimulationResidentReadinessWorkerRuntime";
import {
	SimulationResidentReadinessBridge,
	type SimulationResidentReadinessWorkerPort,
} from "./SimulationResidentReadinessBridge";

class RuntimeResidentReadinessWorker implements SimulationResidentReadinessWorkerPort {
	onmessage: ((event: MessageEvent<SimulationResidentReadinessWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestTransferBytes = 0;

	postMessage(
		message: SimulationResidentReadinessWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.requestTransferCount = transfer.length;
		this.requestTransferBytes = transferByteLength(transfer);
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			void certifySimulationResidentReadinessWorkerRequest(delivered)
				.then((response) => {
					if (this.terminated) return;
					this.onmessage?.({
						data: structuredClone(response),
					} as MessageEvent<SimulationResidentReadinessWorkerResponse>);
				})
				.catch((error) => {
					this.onerror?.({
						message: error instanceof Error ? error.message : "resident readiness runtime failed",
					} as ErrorEvent);
				});
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class ControlledResidentReadinessWorker implements SimulationResidentReadinessWorkerPort {
	onmessage: ((event: MessageEvent<SimulationResidentReadinessWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	request: SimulationResidentReadinessWorkerRequest | null = null;

	postMessage(
		message: SimulationResidentReadinessWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.request = structuredClone(message, { transfer });
	}

	async certifiedResponse(): Promise<SimulationResidentReadinessWorkerResponse> {
		if (!this.request) throw new Error("Expected a resident readiness request.");
		return certifySimulationResidentReadinessWorkerRequest(this.request);
	}

	emit(response: SimulationResidentReadinessWorkerResponse): void {
		this.onmessage?.({ data: response } as MessageEvent<SimulationResidentReadinessWorkerResponse>);
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("SimulationResidentReadinessBridge", () => {
	it("keeps canonical sources local while a disposable Worker returns certificate metadata only", async () => {
		const canonical = await buildSimulationResidentReadinessTestSources();
		const canonicalByteLength = canonical.foundation.paths.positions.byteLength;
		const worker = new RuntimeResidentReadinessWorker();
		const bridge = new SimulationResidentReadinessBridge(() => worker);

		const published = await bridge.certify(canonical, 9);

		expect(await isPublishedSimulationResidentReadinessSnapshot(published)).toBe(true);
		expect(published.foundation).toBe(canonical.foundation);
		expect(published.resourceRunConfiguration).toBe(canonical.resourceRunConfiguration);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalByteLength);
		expect(worker.requestTransferCount).toBeGreaterThan(0);
		expect(worker.requestTransferBytes).toBe(published.certificate.snapshotByteLength);
		expect(worker.terminated).toBe(true);
	});

	it("rejects stale correlation and an exact but detached certificate", async () => {
		const canonical = await buildSimulationResidentReadinessTestSources();
		const staleWorker = new ControlledResidentReadinessWorker();
		const stalePending = new SimulationResidentReadinessBridge(() => staleWorker).certify(
			canonical,
			4,
		);
		const staleResponse = await staleWorker.certifiedResponse();
		staleWorker.emit({ ...staleResponse, requestId: staleResponse.requestId + 1 });
		await expect(stalePending).rejects.toThrow(/stale or mismatched response/i);
		expect(staleWorker.terminated).toBe(true);

		const detachedSources = await buildSimulationResidentReadinessTestSources({ homePortId: 5 });
		const detachedWorker = new ControlledResidentReadinessWorker();
		const detachedPending = new SimulationResidentReadinessBridge(() => detachedWorker).certify(
			canonical,
			5,
		);
		const detachedResponse = await certifyForSources(detachedWorker, detachedSources);
		detachedWorker.emit(detachedResponse);
		await expect(detachedPending).rejects.toThrow(/invalid or detached certificate/i);
		expect(detachedWorker.terminated).toBe(true);
	});

	it("honors cancellation and rejects invalid generations without detaching canonical sources", async () => {
		const canonical = await buildSimulationResidentReadinessTestSources();
		const canonicalByteLength = canonical.foundation.paths.positions.byteLength;
		const preAborted = new AbortController();
		preAborted.abort();
		let workerCreations = 0;
		const bridge = new SimulationResidentReadinessBridge(() => {
			workerCreations++;
			return new ControlledResidentReadinessWorker();
		});

		await expect(bridge.certify(canonical, 1, preAborted.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		await expect(bridge.certify(canonical, -1)).rejects.toThrow(/generation must be non-negative/i);
		expect(workerCreations).toBe(0);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalByteLength);
	});
});

async function certifyForSources(
	worker: ControlledResidentReadinessWorker,
	sources: SimulationResidentReadinessSources,
): Promise<SimulationResidentReadinessWorkerResponse> {
	if (!worker.request) throw new Error("Expected a resident readiness request.");
	return certifySimulationResidentReadinessWorkerRequest({
		...worker.request,
		sources,
	});
}

function transferByteLength(values: readonly Transferable[]): number {
	let total = 0;
	for (const value of values) {
		if (value instanceof ArrayBuffer) total += value.byteLength;
	}
	return total;
}
