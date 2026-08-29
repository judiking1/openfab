import {
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import type { OpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import type { OpenFabProjectManifest, OpenFabProjectView } from "../project/OpenFabProject";
import type {
	OpenFabProjectSerializationRequest,
	OpenFabProjectSerializationResponse,
} from "../worker/OpenFabProjectSerializationProtocol";
import type { SerializedOpenFabProject } from "../worker/OpenFabProjectSerializationRuntime";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { RailStartupCancelledError } from "./RailStartupBridge";

export interface OpenFabProjectSerializationWorkerPort {
	onmessage: ((event: MessageEvent<OpenFabProjectSerializationResponse>) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: OpenFabProjectSerializationRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export class OpenFabProjectSerializationBridge {
	private readonly createWorker: () => OpenFabProjectSerializationWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: OpenFabProjectSerializationWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => OpenFabProjectSerializationWorkerPort = () =>
			new Worker(new URL("../worker/openFabProjectSerializationWorker.ts", import.meta.url), {
				type: "module",
			}) as OpenFabProjectSerializationWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	serialize(
		snapshot: RailMirrorSnapshot,
		manifest: OpenFabProjectManifest,
		view: OpenFabProjectView | null,
		blueprints: OpenFabProjectBlueprintSection,
		operations: OperationalConfigurationState = emptyOperationalConfigurationState(),
	): Promise<SerializedOpenFabProject> {
		this.cancel();
		const expectedChecksum = snapshot.checksum;
		let worker: OpenFabProjectSerializationWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			return Promise.reject(normalizeSerializationError(error, "Project serialization failed."));
		}
		this.worker = worker;
		const requestId = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			this.reject = reject;
			const fail = (error: Error): void => {
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				reject(error);
			};
			worker.onmessage = (event) => {
				const response = event.data;
				if (!isOpenFabProjectSerializationResponse(response)) {
					fail(new Error("Project serialization Worker returned a malformed response."));
					return;
				}
				if (response.requestId !== requestId) {
					fail(new Error("Project serialization Worker returned a stale response."));
					return;
				}
				if (response.type === "OPENFAB_PROJECT_SERIALIZATION_ERROR") {
					fail(new Error(response.message));
					return;
				}
				if (
					response.authoredChecksum !== expectedChecksum ||
					response.characterCount !== response.json.length
				) {
					fail(new Error("Project serialization Worker returned mismatched project metadata."));
					return;
				}
				this.releaseWorker();
				this.reject = null;
				resolve(
					Object.freeze({
						json: response.json,
						authoredChecksum: response.authoredChecksum,
						characterCount: response.characterCount,
						elapsedMilliseconds: response.elapsedMilliseconds,
					}),
				);
			};
			worker.onmessageerror = () => {
				fail(new Error("Project serialization Worker response could not be decoded."));
			};
			worker.onerror = (event) => {
				fail(new Error(event.message || "Project serialization Worker failed."));
			};
			this.timeout = globalThis.setTimeout(() => {
				fail(new Error("Project serialization Worker timed out."));
			}, this.timeoutMilliseconds);
			const request: OpenFabProjectSerializationRequest = {
				type: "SERIALIZE_OPENFAB_PROJECT",
				requestId,
				manifest,
				view,
				blueprints,
				operations,
				snapshot,
			};
			try {
				worker.postMessage(request, collectTransferableBuffers(snapshot));
			} catch (error) {
				fail(normalizeSerializationError(error, "Project serialization post failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(new RailStartupCancelledError());
	}

	dispose(): void {
		this.cancel();
	}

	private releaseWorker(): void {
		if (this.timeout !== null) {
			globalThis.clearTimeout(this.timeout);
			this.timeout = null;
		}
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onmessageerror = null;
		worker.onerror = null;
		worker.terminate();
	}
}

function isOpenFabProjectSerializationResponse(
	value: unknown,
): value is OpenFabProjectSerializationResponse {
	if (!value || typeof value !== "object") return false;
	const response = value as Partial<OpenFabProjectSerializationResponse>;
	if (!Number.isSafeInteger(response.requestId)) return false;
	if (response.type === "OPENFAB_PROJECT_SERIALIZATION_ERROR") {
		return typeof response.message === "string";
	}
	return (
		response.type === "OPENFAB_PROJECT_SERIALIZED" &&
		typeof response.json === "string" &&
		typeof response.authoredChecksum === "string" &&
		Number.isSafeInteger(response.characterCount) &&
		(response.characterCount ?? -1) >= 0 &&
		typeof response.elapsedMilliseconds === "number" &&
		Number.isFinite(response.elapsedMilliseconds) &&
		response.elapsedMilliseconds >= 0
	);
}

function normalizeSerializationError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
