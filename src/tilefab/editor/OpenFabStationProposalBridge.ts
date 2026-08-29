import {
	type HydratedOpenFabStationProposalReadResult,
	hydrateOpenFabStationProposalArtifactCooperatively,
	hydrateOpenFabStationProposalReadFailure,
	OPENFAB_STATION_PROPOSAL_ARTIFACT_ERROR_CODES,
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
} from "../compile/OpenFabStationProposalArtifact";
import { OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES } from "../project/OpenFabStationProposalPorts";
import {
	OPENFAB_STATION_PROPOSAL_WORKER_ERROR_CODES,
	OPENFAB_STATION_PROPOSAL_WORKER_MAX_ERROR_MESSAGE_LENGTH,
	OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalWorkerErrorCode,
	type OpenFabStationProposalWorkerRequest,
	openFabStationProposalWorkerErrorMessage,
} from "../worker/OpenFabStationProposalProtocol";

export interface OpenFabStationProposalWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: OpenFabStationProposalWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export class OpenFabStationProposalCancelledError extends DOMException {
	constructor() {
		super("Station proposal reading was cancelled.", "AbortError");
	}
}

interface ActiveRead {
	readonly worker: OpenFabStationProposalWorkerPort;
	readonly requestId: number;
	readonly generation: number;
	readonly byteLength: number;
	readonly resolve: (result: HydratedOpenFabStationProposalReadResult) => void;
	readonly reject: (error: Error) => void;
	readonly hydrationController: AbortController;
	settled: boolean;
	adopting: boolean;
	timeout: ReturnType<typeof globalThis.setTimeout> | null;
	abortSignal: AbortSignal | null;
	abortListener: (() => void) | null;
}

const READ_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"schemaId",
	"schemaVersion",
	"requestId",
	"generation",
	"byteLength",
	"artifact",
] as const);
const REJECTED_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"schemaId",
	"schemaVersion",
	"requestId",
	"generation",
	"byteLength",
	"failure",
] as const);
const ERROR_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"schemaId",
	"schemaVersion",
	"requestId",
	"generation",
	"byteLength",
	"code",
	"message",
] as const);
/** Latest-wins adapter that transfers one owned source into one disposable Worker. */
export class OpenFabStationProposalBridge {
	private readonly createWorker: () => OpenFabStationProposalWorkerPort;
	private readonly timeoutMilliseconds: number;
	private readonly hydrationCheckpoint: (signal: AbortSignal) => Promise<void>;
	private readonly hydrationNow: () => number;
	private readonly hydrationSliceMilliseconds: number;
	private active: ActiveRead | null = null;
	private nextRequestId = 1;
	private disposed = false;

	constructor(
		createWorker: () => OpenFabStationProposalWorkerPort = () =>
			new Worker(new URL("../worker/openFabStationProposalWorker.ts", import.meta.url), {
				type: "module",
			}) as OpenFabStationProposalWorkerPort,
		timeoutMilliseconds = 30_000,
		hydrationCheckpoint: (signal: AbortSignal) => Promise<void> = nextMainTask,
		hydrationNow: () => number = () => performance.now(),
		hydrationSliceMilliseconds = 4,
	) {
		if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
			throw new RangeError("Station proposal timeout must be a positive safe integer.");
		}
		if (!Number.isFinite(hydrationSliceMilliseconds) || hydrationSliceMilliseconds <= 0) {
			throw new RangeError("Station proposal hydration slice must be positive.");
		}
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
		this.hydrationCheckpoint = hydrationCheckpoint;
		this.hydrationNow = hydrationNow;
		this.hydrationSliceMilliseconds = hydrationSliceMilliseconds;
	}

	read(
		source: ArrayBuffer,
		generation: number,
		signal?: AbortSignal,
	): Promise<HydratedOpenFabStationProposalReadResult> {
		if (this.disposed) return Promise.reject(new OpenFabStationProposalCancelledError());
		this.cancel();
		if (signal?.aborted) return Promise.reject(new OpenFabStationProposalCancelledError());
		if (!(source instanceof ArrayBuffer)) {
			return Promise.reject(new TypeError("Station proposal source must be an owned ArrayBuffer."));
		}
		if (isDetachedArrayBuffer(source)) {
			return Promise.reject(new TypeError("Station proposal source buffer is detached."));
		}
		if (source.byteLength > OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES) {
			return Promise.reject(new RangeError("Station proposal source exceeds the file byte limit."));
		}
		if (!isPositiveSafeInteger(generation)) {
			return Promise.reject(new RangeError("Station proposal generation must be positive."));
		}

		const requestId = this.issueRequestId();
		const byteLength = source.byteLength;
		let worker: OpenFabStationProposalWorkerPort;
		try {
			worker = this.createWorker();
		} catch {
			return Promise.reject(new Error("Station proposal Worker could not be created."));
		}

		return new Promise((resolve, reject) => {
			const active: ActiveRead = {
				worker,
				requestId,
				generation,
				byteLength,
				resolve,
				reject,
				hydrationController: new AbortController(),
				settled: false,
				adopting: false,
				timeout: null,
				abortSignal: signal ?? null,
				abortListener: null,
			};
			this.active = active;
			worker.onmessage = (event) => this.receive(active, event.data);
			worker.onerror = () => this.fail(active, new Error("Station proposal Worker failed."));
			worker.onmessageerror = () =>
				this.fail(active, new Error("Station proposal Worker response could not be decoded."));
			active.timeout = globalThis.setTimeout(
				() =>
					this.fail(
						active,
						new Error(`Station proposal Worker timed out after ${this.timeoutMilliseconds} ms.`),
					),
				this.timeoutMilliseconds,
			);
			if (signal) {
				active.abortListener = () => this.fail(active, new OpenFabStationProposalCancelledError());
				signal.addEventListener("abort", active.abortListener, { once: true });
				if (signal.aborted) {
					this.fail(active, new OpenFabStationProposalCancelledError());
					return;
				}
			}

			const request: OpenFabStationProposalWorkerRequest = Object.freeze({
				type: "READ_OPENFAB_STATION_PROPOSAL",
				protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
				schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
				schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
				requestId,
				generation,
				byteLength,
				source,
			});
			try {
				worker.postMessage(request, [source]);
				if (byteLength > 0 && source.byteLength !== 0) {
					this.fail(active, new Error("Station proposal Worker did not consume the source."));
				}
			} catch {
				this.fail(active, new Error("Station proposal Worker request could not be posted."));
			}
		});
	}

	cancel(): void {
		if (this.active) this.fail(this.active, new OpenFabStationProposalCancelledError());
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel();
	}

	private receive(active: ActiveRead, value: unknown): void {
		if (this.active !== active || active.settled) return;
		try {
			const response = parseResponse(value);
			if (
				response.requestId !== active.requestId ||
				response.generation !== active.generation ||
				response.byteLength !== active.byteLength
			) {
				throw new Error("Station proposal Worker returned a stale or foreign response.");
			}
			if (active.adopting) {
				throw new Error("Station proposal Worker returned more than one response.");
			}
			if (response.type === "OPENFAB_STATION_PROPOSAL_ERROR") {
				throw new Error(response.message);
			}
			if (response.type === "OPENFAB_STATION_PROPOSAL_REJECTED") {
				let failure: ReturnType<typeof hydrateOpenFabStationProposalReadFailure>;
				try {
					failure = hydrateOpenFabStationProposalReadFailure(response.failure);
				} catch (error) {
					throw normalizeAdoptionError(error);
				}
				if (failure.sourceByteLength !== active.byteLength) {
					throw new Error("Station proposal Worker returned mismatched rejection evidence.");
				}
				this.succeed(active, Object.freeze({ ok: false, failure }));
				return;
			}
			active.adopting = true;
			void this.adoptArtifact(active, response.artifact);
		} catch (error) {
			this.fail(
				active,
				error instanceof Error ? error : new Error("Station proposal Worker response is invalid."),
			);
		}
	}

	private async adoptArtifact(active: ActiveRead, value: unknown): Promise<void> {
		let sliceStartedAt = this.hydrationNow();
		try {
			const artifact = await hydrateOpenFabStationProposalArtifactCooperatively(value, {
				checkpoint: async () => {
					const now = this.hydrationNow();
					if (now - sliceStartedAt < this.hydrationSliceMilliseconds) return;
					await this.hydrationCheckpoint(active.hydrationController.signal);
					sliceStartedAt = this.hydrationNow();
				},
				signal: active.hydrationController.signal,
			});
			if (this.active !== active || active.settled) return;
			if (artifact.sourceByteLength !== active.byteLength) {
				throw new Error("Station proposal Worker returned mismatched proposal evidence.");
			}
			this.succeed(active, Object.freeze({ ok: true, artifact }));
		} catch (error) {
			if (this.active !== active || active.settled) return;
			this.fail(active, normalizeAdoptionError(error));
		}
	}

	private succeed(active: ActiveRead, result: HydratedOpenFabStationProposalReadResult): void {
		if (this.active !== active || active.settled) return;
		active.settled = true;
		this.release(active);
		active.resolve(result);
	}

	private fail(active: ActiveRead, error: Error): void {
		if (this.active !== active || active.settled) return;
		active.settled = true;
		this.release(active);
		active.reject(error);
	}

	private release(active: ActiveRead): void {
		active.hydrationController.abort();
		if (active.timeout !== null) globalThis.clearTimeout(active.timeout);
		active.timeout = null;
		if (active.abortSignal && active.abortListener) {
			active.abortSignal.removeEventListener("abort", active.abortListener);
		}
		active.abortSignal = null;
		active.abortListener = null;
		terminateWorker(active.worker);
		if (this.active === active) this.active = null;
	}

	private issueRequestId(): number {
		const requestId = this.nextRequestId;
		this.nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
		return requestId;
	}
}

interface ParsedResponseBase {
	readonly type:
		| "OPENFAB_STATION_PROPOSAL_READ"
		| "OPENFAB_STATION_PROPOSAL_REJECTED"
		| "OPENFAB_STATION_PROPOSAL_ERROR";
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION;
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly byteLength: number;
}

type ParsedResponse =
	| (ParsedResponseBase & {
			readonly type: "OPENFAB_STATION_PROPOSAL_READ";
			readonly artifact: unknown;
	  })
	| (ParsedResponseBase & {
			readonly type: "OPENFAB_STATION_PROPOSAL_REJECTED";
			readonly failure: unknown;
	  })
	| (ParsedResponseBase & {
			readonly type: "OPENFAB_STATION_PROPOSAL_ERROR";
			readonly code: OpenFabStationProposalWorkerErrorCode;
			readonly message: string;
	  });

function parseResponse(value: unknown): ParsedResponse {
	if (!isRecord(value)) throw new Error("Station proposal Worker response is not an object.");
	const keys =
		value.type === "OPENFAB_STATION_PROPOSAL_READ"
			? READ_RESPONSE_KEYS
			: value.type === "OPENFAB_STATION_PROPOSAL_REJECTED"
				? REJECTED_RESPONSE_KEYS
				: value.type === "OPENFAB_STATION_PROPOSAL_ERROR"
					? ERROR_RESPONSE_KEYS
					: null;
	if (!keys || !hasExactKeys(value, keys)) {
		throw new Error("Station proposal Worker response fields are malformed.");
	}
	if (
		value.protocolVersion !== OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION ||
		value.schemaId !== OPENFAB_STATION_PROPOSAL_SCHEMA_ID ||
		value.schemaVersion !== OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION ||
		!isPositiveSafeInteger(value.requestId) ||
		!isPositiveSafeInteger(value.generation) ||
		!isBoundedByteLength(value.byteLength)
	) {
		throw new Error("Station proposal Worker response correlation is malformed.");
	}
	if (value.type === "OPENFAB_STATION_PROPOSAL_ERROR") {
		if (
			!OPENFAB_STATION_PROPOSAL_WORKER_ERROR_CODES.includes(
				value.code as OpenFabStationProposalWorkerErrorCode,
			) ||
			typeof value.message !== "string" ||
			value.message.length === 0 ||
			value.message.length > OPENFAB_STATION_PROPOSAL_WORKER_MAX_ERROR_MESSAGE_LENGTH ||
			value.message !==
				openFabStationProposalWorkerErrorMessage(
					value.code as OpenFabStationProposalWorkerErrorCode,
				)
		) {
			throw new Error("Station proposal Worker error response is malformed.");
		}
	}
	return value as unknown as ParsedResponse;
}

function terminateWorker(worker: OpenFabStationProposalWorkerPort): void {
	worker.onmessage = null;
	worker.onerror = null;
	worker.onmessageerror = null;
	try {
		worker.terminate();
	} catch {
		// Cleanup failure must never keep the active promise pending.
	}
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isBoundedByteLength(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		(value as number) <= OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES
	);
}

function isDetachedArrayBuffer(value: ArrayBuffer): boolean {
	try {
		value.slice(0, 0);
		return false;
	} catch {
		return true;
	}
}

function nextMainTask(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(new OpenFabStationProposalCancelledError());
	return new Promise((resolve, reject) => {
		const abort = (): void => {
			globalThis.clearTimeout(timeout);
			reject(new OpenFabStationProposalCancelledError());
		};
		const timeout = globalThis.setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, 0);
		signal.addEventListener("abort", abort, { once: true });
	});
}

function normalizeAdoptionError(error: unknown): Error {
	if ((error instanceof DOMException || error instanceof Error) && error.name === "AbortError") {
		return new OpenFabStationProposalCancelledError();
	}
	if (
		error instanceof Error &&
		OPENFAB_STATION_PROPOSAL_ARTIFACT_ERROR_CODES.includes(
			error.message as (typeof OPENFAB_STATION_PROPOSAL_ARTIFACT_ERROR_CODES)[number],
		)
	) {
		return new Error(error.message);
	}
	return new Error("Station proposal Worker returned invalid proposal evidence.");
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
