import type {
	MainToRailStartupMessage,
	RailStartupPayload,
	RailStartupSource,
	RailStartupToMainMessage,
} from "../worker/RailStartupProtocol";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface RailStartupWorkerPort {
	onmessage: ((event: MessageEvent<RailStartupToMainMessage>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: MainToRailStartupMessage, transfer?: Transferable[]): void;
	terminate(): void;
}

export class RailStartupCancelledError extends Error {
	constructor() {
		super("Rail startup was cancelled.");
		this.name = "RailStartupCancelledError";
	}
}

/** One-shot browser adapter. Termination is the cancellation boundary for synchronous Worker work. */
export class RailStartupBridge {
	private readonly createWorker: () => RailStartupWorkerPort;
	private worker: RailStartupWorkerPort | null = null;
	private nextRequestId = 1;
	private activeRequestId = 0;
	private resolve: ((payload: RailStartupPayload) => void) | null = null;
	private reject: ((error: Error) => void) | null = null;
	private disposed = false;
	private responseTimeout: ReturnType<typeof setTimeout> | null = null;
	private readonly timeoutMilliseconds: number;

	constructor(
		createWorker: () => RailStartupWorkerPort = () =>
			new Worker(new URL("../worker/railStartupWorker.ts", import.meta.url), {
				type: "module",
			}) as RailStartupWorkerPort,
		timeoutMilliseconds = 40_000,
	) {
		if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
			throw new RangeError("Rail startup response timeout must be a positive safe integer.");
		}
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	load(source: RailStartupSource): Promise<RailStartupPayload> {
		if (this.disposed) return Promise.reject(new RailStartupCancelledError());
		if (this.resolve) this.cancelActiveRequest();
		this.releaseWorker();
		let worker: RailStartupWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			return Promise.reject(
				error instanceof Error ? error : new Error("Rail startup Worker creation failed."),
			);
		}
		this.worker = worker;
		const requestId = this.nextRequestId++;
		this.activeRequestId = requestId;
		return new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
			const isCurrent = (): boolean =>
				!this.disposed &&
				this.worker === worker &&
				this.activeRequestId === requestId &&
				this.resolve !== null;
			this.responseTimeout = setTimeout(() => {
				if (isCurrent())
					this.fail(
						new Error(
							`Rail startup Worker response timed out after ${this.timeoutMilliseconds} ms.`,
						),
					);
			}, this.timeoutMilliseconds);
			worker.onmessage = (event) => {
				if (isCurrent()) this.handleMessage(event.data);
			};
			worker.onerror = (event) => {
				if (isCurrent()) this.fail(new Error(event.message));
			};
			worker.onmessageerror = () => {
				if (isCurrent())
					this.fail(new Error("Rail startup Worker returned an unreadable response."));
			};
			try {
				const message: MainToRailStartupMessage = {
					type: "LOAD_RAIL_STARTUP",
					requestId,
					source,
				};
				worker.postMessage(
					message,
					source.kind === "snapshot" || source.kind === "project-snapshot"
						? collectTransferableBuffers(source.snapshot)
						: [],
				);
			} catch (error) {
				if (isCurrent())
					this.fail(error instanceof Error ? error : new Error("Rail startup post failed."));
			}
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.fail(new RailStartupCancelledError());
		this.releaseWorker();
	}

	private handleMessage(message: RailStartupToMainMessage): void {
		if (this.disposed || message.requestId !== this.activeRequestId || !this.resolve) return;
		if (message.type === "RAIL_STARTUP_ERROR") {
			this.fail(new Error(message.message));
			return;
		}
		const resolve = this.resolve;
		this.clearRequest();
		this.releaseWorker();
		resolve(message.payload);
	}

	private fail(error: Error): void {
		const reject = this.reject;
		this.clearRequest();
		this.releaseWorker();
		reject?.(error);
	}

	private cancelActiveRequest(): void {
		const reject = this.reject;
		this.clearRequest();
		reject?.(new RailStartupCancelledError());
	}

	private releaseWorker(): void {
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}

	private clearRequest(): void {
		if (this.responseTimeout !== null) clearTimeout(this.responseTimeout);
		this.responseTimeout = null;
		this.activeRequestId = 0;
		this.resolve = null;
		this.reject = null;
	}
}
