import {
	isPublishedSimulationReadinessSnapshot,
	type PublishedSimulationReadinessSnapshot,
	type SimulationReadinessComponents,
	simulationReadinessComponentsError,
} from "../compile/SimulationReadinessCertificate";
import {
	SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationReadinessWorkerRequest,
	type SimulationReadinessWorkerResponse,
} from "../worker/SimulationReadinessWorkerProtocol";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface SimulationReadinessWorkerPort {
	onmessage: ((event: MessageEvent<SimulationReadinessWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: SimulationReadinessWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

/** One-shot adapter that preserves canonical inputs and publishes only an independently certified copy. */
export class SimulationReadinessBridge {
	private readonly createWorker: () => SimulationReadinessWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: SimulationReadinessWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private abortSignal: AbortSignal | null = null;
	private abortListener: (() => void) | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => SimulationReadinessWorkerPort = () =>
			new Worker(new URL("../worker/simulationReadinessWorker.ts", import.meta.url), {
				type: "module",
			}) as SimulationReadinessWorkerPort,
		timeoutMilliseconds = 60_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	certify(
		components: SimulationReadinessComponents,
		generation: number,
		signal?: AbortSignal,
	): Promise<PublishedSimulationReadinessSnapshot> {
		this.cancel();
		if (signal?.aborted) return Promise.reject(cancelledError());
		if (!Number.isSafeInteger(generation) || generation < 0) {
			return Promise.reject(
				new RangeError("Simulation readiness generation must be non-negative."),
			);
		}
		const componentError = simulationReadinessComponentsError(components);
		if (componentError) {
			return Promise.reject(
				new Error(`Simulation readiness components are invalid: ${componentError}`),
			);
		}
		let ownedComponents: SimulationReadinessComponents;
		try {
			ownedComponents = structuredClone(components);
		} catch (error) {
			return Promise.reject(normalizeError(error, "Simulation readiness snapshot capture failed."));
		}
		const requestId = this.issueRequestId();
		const request: SimulationReadinessWorkerRequest = {
			type: "CERTIFY_SIMULATION_READINESS",
			protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
			requestId,
			generation,
			components: ownedComponents,
		};
		return new Promise((resolve, reject) => {
			let worker: SimulationReadinessWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(normalizeError(error, "Simulation readiness Worker creation failed."));
				return;
			}
			this.worker = worker;
			this.reject = reject;
			const fail = (error: Error): void => {
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				reject(error);
			};
			worker.onmessage = (event) => {
				const response = event.data;
				if (
					response.protocolVersion !== SIMULATION_READINESS_WORKER_PROTOCOL_VERSION ||
					response.requestId !== requestId ||
					response.generation !== generation
				) {
					fail(new Error("Simulation readiness Worker returned a stale or mismatched response."));
					return;
				}
				if (response.type === "SIMULATION_READINESS_REJECTED") {
					fail(new Error(response.message || `Simulation readiness rejected: ${response.code}.`));
					return;
				}
				if (!isPublishedSimulationReadinessSnapshot(response.published)) {
					fail(new Error("Simulation readiness Worker returned an invalid published snapshot."));
					return;
				}
				if (this.worker !== worker) return;
				const published = response.published;
				this.reject = null;
				this.releaseWorker();
				resolve(published);
			};
			worker.onerror = (event) =>
				fail(new Error(event.message || "Simulation readiness Worker failed."));
			worker.onmessageerror = () =>
				fail(new Error("Simulation readiness Worker returned an unreadable response."));
			this.timeout = setTimeout(
				() =>
					fail(
						new Error(
							`Simulation readiness Worker timed out after ${this.timeoutMilliseconds} ms.`,
						),
					),
				this.timeoutMilliseconds,
			);
			if (signal) {
				this.abortSignal = signal;
				this.abortListener = () => this.cancel();
				signal.addEventListener("abort", this.abortListener, { once: true });
			}
			try {
				worker.postMessage(request, collectTransferableBuffers(ownedComponents));
			} catch (error) {
				fail(normalizeError(error, "Simulation readiness Worker post failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(cancelledError());
	}

	dispose(): void {
		this.cancel();
	}

	private issueRequestId(): number {
		const requestId = this.nextRequestId;
		this.nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
		return requestId;
	}

	private releaseWorker(): void {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = null;
		if (this.abortSignal && this.abortListener) {
			this.abortSignal.removeEventListener("abort", this.abortListener);
		}
		this.abortSignal = null;
		this.abortListener = null;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
		}
		this.worker = null;
	}
}

function cancelledError(): Error {
	return new DOMException("Simulation readiness certification was cancelled.", "AbortError");
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
