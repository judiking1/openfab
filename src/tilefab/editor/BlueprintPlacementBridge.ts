import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import type { RailAreaStampPose, RailAreaStampTemplate } from "../core/RailAreaStamp";
import type { Cell } from "../core/TileMap";
import type {
	BlueprintPlacementWorkerRequest,
	BlueprintPlacementWorkerResponse,
	PreparedBlueprintPlacement,
} from "../worker/BlueprintPlacementProtocol";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface BlueprintPlacementWorkerPort {
	onmessage: ((event: MessageEvent<BlueprintPlacementWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: BlueprintPlacementWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface BlueprintPlacementInput {
	readonly snapshot: RailMirrorSnapshot;
	readonly railTemplate: RailAreaStampTemplate;
	readonly staticFabTemplate: StaticFabBlueprintTemplate | null;
	readonly anchor: Cell;
	readonly pose: RailAreaStampPose;
}

/** Latest-request-wins browser adapter for exact factory-blueprint validation. */
export class BlueprintPlacementBridge {
	private readonly createWorker: () => BlueprintPlacementWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: BlueprintPlacementWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => BlueprintPlacementWorkerPort = () =>
			new Worker(new URL("../worker/blueprintPlacementWorker.ts", import.meta.url), {
				type: "module",
			}) as BlueprintPlacementWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(input: BlueprintPlacementInput): Promise<PreparedBlueprintPlacement> {
		this.cancel();
		const worker = this.createWorker();
		this.worker = worker;
		const requestId = this.nextRequestId++;
		const request: BlueprintPlacementWorkerRequest = {
			type: "PREPARE_BLUEPRINT_PLACEMENT",
			requestId,
			...input,
		};
		return new Promise((resolve, reject) => {
			this.reject = reject;
			worker.onmessage = (event) => {
				if (event.data.requestId !== requestId) return;
				const response = event.data;
				this.releaseWorker();
				this.reject = null;
				if (response.type === "BLUEPRINT_PLACEMENT_ERROR") {
					reject(new Error(response.message));
					return;
				}
				resolve(response.prepared);
			};
			worker.onerror = (event) => {
				this.releaseWorker();
				this.reject = null;
				reject(new Error(event.message));
			};
			worker.onmessageerror = () => {
				this.releaseWorker();
				this.reject = null;
				reject(new Error("Blueprint placement Worker returned an unreadable response."));
			};
			this.timeout = setTimeout(() => {
				const rejectTimeout = this.reject;
				this.reject = null;
				this.releaseWorker();
				rejectTimeout?.(
					new Error(
						`Blueprint placement Worker timed out after ${this.timeoutMilliseconds} ms.`,
					),
				);
			}, this.timeoutMilliseconds);
			try {
				worker.postMessage(request, collectTransferableBuffers(input.snapshot));
			} catch (error) {
				this.releaseWorker();
				this.reject = null;
				reject(error instanceof Error ? error : new Error("Blueprint placement post failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(new DOMException("Blueprint placement cancelled.", "AbortError"));
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
