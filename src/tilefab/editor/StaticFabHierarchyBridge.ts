import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	PreparedStaticFabHierarchy,
	StaticFabHierarchyWorkerRequest,
	StaticFabHierarchyWorkerResponse,
} from "../worker/StaticFabHierarchyProtocol";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabHierarchyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabHierarchyWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabHierarchyWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabHierarchyInput {
	readonly snapshot: RailMirrorSnapshot;
}

/**
 * Injection-only compatibility adapter for factory-wide hierarchy inference.
 *
 * Production authoring no longer exposes this legacy workflow, so callers must explicitly provide
 * a Worker factory. Keeping construction explicit prevents an unused compatibility surface from
 * pulling its Worker asset back into the application bundle.
 */
export class StaticFabHierarchyBridge {
	private readonly createWorker: () => StaticFabHierarchyWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabHierarchyWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(createWorker: () => StaticFabHierarchyWorkerPort, timeoutMilliseconds = 30_000) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(input: StaticFabHierarchyInput): Promise<PreparedStaticFabHierarchy> {
		this.cancel();
		const requestId = this.nextRequestId++;
		const expectedSourceRevision = input.snapshot.revision;
		const expectedSourceChecksum = input.snapshot.checksum;
		const request: StaticFabHierarchyWorkerRequest = {
			type: "PREPARE_STATIC_FAB_HIERARCHY",
			requestId,
			...input,
		};
		return new Promise((resolve, reject) => {
			let worker: StaticFabHierarchyWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(error instanceof Error ? error : new Error("FAB hierarchy Worker creation failed."));
				return;
			}
			this.worker = worker;
			this.reject = reject;
			worker.onmessage = (event) => {
				const response = event.data as unknown;
				if (!isRecord(response) || response.requestId !== requestId) return;
				this.releaseWorker();
				this.reject = null;
				if (response.type === "STATIC_FAB_HIERARCHY_ERROR") {
					reject(
						new Error(
							typeof response.message === "string"
								? response.message
								: "FAB hierarchy Worker returned a malformed error response.",
						),
					);
					return;
				}
				if (response.type !== "STATIC_FAB_HIERARCHY_PREPARED") {
					reject(new Error("FAB hierarchy Worker returned a malformed response."));
					return;
				}
				const mismatch = validatePreparedResponse(
					response.prepared,
					expectedSourceRevision,
					expectedSourceChecksum,
				);
				if (mismatch) {
					reject(mismatch);
					return;
				}
				resolve(response.prepared as PreparedStaticFabHierarchy);
			};
			worker.onerror = (event) => {
				this.releaseWorker();
				this.reject = null;
				reject(new Error(event.message));
			};
			worker.onmessageerror = () => {
				this.releaseWorker();
				this.reject = null;
				reject(new Error("FAB hierarchy Worker returned an unreadable response."));
			};
			this.timeout = setTimeout(() => {
				const rejectTimeout = this.reject;
				this.reject = null;
				this.releaseWorker();
				rejectTimeout?.(
					new Error(`FAB hierarchy Worker timed out after ${this.timeoutMilliseconds} ms.`),
				);
			}, this.timeoutMilliseconds);
			try {
				worker.postMessage(request, collectTransferableBuffers(input.snapshot));
			} catch (error) {
				this.releaseWorker();
				this.reject = null;
				reject(error instanceof Error ? error : new Error("FAB hierarchy post failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(new DOMException("FAB hierarchy preparation cancelled.", "AbortError"));
	}

	dispose(): void {
		this.cancel();
	}

	private releaseWorker(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}
}

function validatePreparedResponse(
	prepared: unknown,
	expectedSourceRevision: number,
	expectedSourceChecksum: string,
): Error | null {
	if (
		!isRecord(prepared) ||
		typeof prepared.sourceRevision !== "number" ||
		typeof prepared.sourceChecksum !== "string" ||
		typeof prepared.preparationMilliseconds !== "number" ||
		!Number.isFinite(prepared.preparationMilliseconds) ||
		!isRecord(prepared.hierarchySnapshot) ||
		typeof prepared.hierarchySnapshot.revision !== "number"
	) {
		return new Error("FAB hierarchy Worker returned malformed prepared data.");
	}
	if (prepared.sourceRevision !== expectedSourceRevision) {
		return new Error(
			`FAB hierarchy Worker returned source revision ${prepared.sourceRevision}; expected ${expectedSourceRevision}.`,
		);
	}
	if (prepared.sourceChecksum !== expectedSourceChecksum) {
		return new Error(
			`FAB hierarchy Worker returned source checksum ${prepared.sourceChecksum}; expected ${expectedSourceChecksum}.`,
		);
	}
	if (prepared.hierarchySnapshot.revision !== expectedSourceRevision) {
		return new Error(
			`FAB hierarchy Worker returned hierarchy revision ${prepared.hierarchySnapshot.revision}; expected ${expectedSourceRevision}.`,
		);
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
