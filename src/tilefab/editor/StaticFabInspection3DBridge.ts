import type { CompiledRailPresentation } from "../render/PhysicalRailPresentation";
import {
	captureStaticFabInspection3DSource,
	collectStaticFabInspection3DSourceTransferBuffers,
	isStaticFabInspection3DChunkedArtifactTransferEnvelope,
	type StaticFabInspection3DChunkedArtifact,
} from "../render/StaticFabInspection3DArtifact";
import type {
	StaticFabInspection3DWorkerRequest,
	StaticFabInspection3DWorkerResponse,
} from "../worker/StaticFabInspection3DRuntime";

export interface StaticFabInspection3DWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabInspection3DWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabInspection3DWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

/** Latest-request-wins bridge that transfers only owned presentation snapshots. */
export class StaticFabInspection3DBridge {
	private readonly createWorker: () => StaticFabInspection3DWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabInspection3DWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private abortSignal: AbortSignal | null = null;
	private abortListener: (() => void) | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => StaticFabInspection3DWorkerPort = () =>
			new Worker(new URL("../worker/staticFabInspection3DWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabInspection3DWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	compile(
		presentation: CompiledRailPresentation,
		sourceGeneration: number,
		signal?: AbortSignal,
	): Promise<StaticFabInspection3DChunkedArtifact> {
		this.cancel();
		if (signal?.aborted) return Promise.reject(cancelledError());
		let snapshot: ReturnType<typeof captureStaticFabInspection3DSource>;
		try {
			snapshot = captureStaticFabInspection3DSource(presentation, sourceGeneration);
		} catch (error) {
			return Promise.reject(normalizeError(error, "3D inspection snapshot capture failed."));
		}
		const requestId = this.issueRequestId();
		const request: StaticFabInspection3DWorkerRequest = {
			type: "COMPILE_STATIC_FAB_INSPECTION_3D",
			requestId,
			snapshot,
		};
		return new Promise((resolve, reject) => {
			let worker: StaticFabInspection3DWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(normalizeError(error, "3D inspection Worker creation failed."));
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
				if (response.requestId !== requestId) {
					fail(new Error(`3D inspection Worker returned stale request ${response.requestId}.`));
					return;
				}
				if (response.type === "STATIC_FAB_INSPECTION_3D_ERROR") {
					fail(new Error(response.message || "3D inspection Worker failed."));
					return;
				}
				const artifact = response.artifact;
				if (
					!isStaticFabInspection3DChunkedArtifactTransferEnvelope(artifact) ||
					artifact.sourceGeneration !== sourceGeneration ||
					artifact.sourceRevision !== presentation.source.revision
				) {
					fail(new Error("3D inspection Worker returned mismatched derived geometry."));
					return;
				}
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				resolve(artifact);
			};
			worker.onerror = (event) => fail(new Error(event.message || "3D inspection Worker failed."));
			worker.onmessageerror = () =>
				fail(new Error("3D inspection Worker returned an unreadable response."));
			this.timeout = setTimeout(
				() =>
					fail(new Error(`3D inspection Worker timed out after ${this.timeoutMilliseconds} ms.`)),
				this.timeoutMilliseconds,
			);
			if (signal) {
				this.abortSignal = signal;
				this.abortListener = () => this.cancel();
				signal.addEventListener("abort", this.abortListener, { once: true });
			}
			try {
				worker.postMessage(request, collectStaticFabInspection3DSourceTransferBuffers(snapshot));
			} catch (error) {
				fail(normalizeError(error, "3D inspection Worker post failed."));
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
	return new DOMException("3D inspection compilation was cancelled.", "AbortError");
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
