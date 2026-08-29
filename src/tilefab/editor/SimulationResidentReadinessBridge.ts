import {
	type PublishedSimulationResidentReadinessSnapshot,
	type SimulationResidentReadinessSources,
	simulationResidentReadinessCertificateError,
	simulationResidentReadinessCertificateMatchesSources,
	simulationResidentReadinessSourcesError,
} from "../compile/SimulationResidentReadinessCertificate";
import {
	SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationResidentReadinessWorkerRequest,
	type SimulationResidentReadinessWorkerResponse,
	simulationResidentReadinessWorkerResponseError,
} from "../worker/SimulationResidentReadinessWorkerProtocol";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface SimulationResidentReadinessWorkerPort {
	onmessage: ((event: MessageEvent<SimulationResidentReadinessWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: SimulationResidentReadinessWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

/** One-shot adapter that keeps canonical sources local and transfers only an owned certification copy. */
export class SimulationResidentReadinessBridge {
	private readonly createWorker: () => SimulationResidentReadinessWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: SimulationResidentReadinessWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private abortSignal: AbortSignal | null = null;
	private abortListener: (() => void) | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => SimulationResidentReadinessWorkerPort = () =>
			new Worker(new URL("../worker/simulationResidentReadinessWorker.ts", import.meta.url), {
				type: "module",
			}) as SimulationResidentReadinessWorkerPort,
		timeoutMilliseconds = 60_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	certify(
		sources: SimulationResidentReadinessSources,
		generation: number,
		signal?: AbortSignal,
	): Promise<PublishedSimulationResidentReadinessSnapshot> {
		this.cancel();
		if (signal?.aborted) return Promise.reject(cancelledError());
		if (!Number.isSafeInteger(generation) || generation < 0) {
			return Promise.reject(
				new RangeError("Simulation resident readiness generation must be non-negative."),
			);
		}
		const sourceError = simulationResidentReadinessSourcesError(sources);
		if (sourceError) {
			return Promise.reject(
				new Error(`Simulation resident readiness sources are invalid: ${sourceError}`),
			);
		}
		let ownedSources: SimulationResidentReadinessSources;
		try {
			ownedSources = structuredClone(sources);
		} catch (error) {
			return Promise.reject(
				normalizeError(error, "Simulation resident readiness source capture failed."),
			);
		}
		const requestId = this.issueRequestId();
		const request: SimulationResidentReadinessWorkerRequest = {
			type: "CERTIFY_SIMULATION_RESIDENT_READINESS",
			protocolVersion: SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
			requestId,
			generation,
			sources: ownedSources,
		};
		return new Promise((resolve, reject) => {
			let worker: SimulationResidentReadinessWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(normalizeError(error, "Simulation resident readiness Worker creation failed."));
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
				const responseError = simulationResidentReadinessWorkerResponseError(response);
				if (responseError) {
					fail(
						new Error(`Resident readiness Worker returned an invalid response: ${responseError}`),
					);
					return;
				}
				if (
					response.protocolVersion !== SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION ||
					response.requestId !== requestId ||
					response.generation !== generation
				) {
					fail(new Error("Resident readiness Worker returned a stale or mismatched response."));
					return;
				}
				if (response.type === "SIMULATION_RESIDENT_READINESS_REJECTED") {
					fail(new Error(response.message || `Resident readiness rejected: ${response.code}.`));
					return;
				}
				if (
					simulationResidentReadinessCertificateError(response.certificate) ||
					!simulationResidentReadinessCertificateMatchesSources(response.certificate, sources)
				) {
					fail(new Error("Resident readiness Worker returned an invalid or detached certificate."));
					return;
				}
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				resolve(Object.freeze({ ...sources, certificate: response.certificate }));
			};
			worker.onerror = (event) =>
				fail(new Error(event.message || "Simulation resident readiness Worker failed."));
			worker.onmessageerror = () =>
				fail(new Error("Simulation resident readiness Worker returned an unreadable response."));
			this.timeout = setTimeout(
				() =>
					fail(
						new Error(
							`Simulation resident readiness Worker timed out after ${this.timeoutMilliseconds} ms.`,
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
				worker.postMessage(request, collectTransferableBuffers(ownedSources));
			} catch (error) {
				fail(normalizeError(error, "Simulation resident readiness Worker post failed."));
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
	return new DOMException(
		"Simulation resident readiness certification was cancelled.",
		"AbortError",
	);
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
