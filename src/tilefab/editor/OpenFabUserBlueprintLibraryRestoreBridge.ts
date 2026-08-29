import type { OpenFabUserBlueprintRecord } from "../project/OpenFabUserBlueprintLibrary";
import type {
	OpenFabUserBlueprintLibraryBundle,
	OpenFabUserBlueprintLibraryConflictDecision,
	OpenFabUserBlueprintLibraryReplaceImpact,
	OpenFabUserBlueprintLibraryRestoreMode,
	OpenFabUserBlueprintLibraryRestorePlan,
	OpenFabUserBlueprintLibraryRestorePlanPreview,
	OpenFabUserBlueprintLibraryRestorePreflight,
} from "../project/OpenFabUserBlueprintLibraryBundle";
import type {
	OpenFabUserBlueprintLibraryRestoreWorkerRequest,
	OpenFabUserBlueprintLibraryRestoreWorkerResponse,
} from "../worker/OpenFabUserBlueprintLibraryRestoreProtocol";

export interface OpenFabUserBlueprintLibraryRestoreWorkerPort {
	onmessage:
		| ((event: MessageEvent<OpenFabUserBlueprintLibraryRestoreWorkerResponse>) => void)
		| null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: OpenFabUserBlueprintLibraryRestoreWorkerRequest): void;
	terminate(): void;
}

export interface OpenFabUserBlueprintLibraryRestoreInspection {
	readonly bundle: OpenFabUserBlueprintLibraryBundle;
	readonly preflight: OpenFabUserBlueprintLibraryRestorePreflight;
	readonly replaceImpact: OpenFabUserBlueprintLibraryReplaceImpact;
	readonly elapsedMilliseconds: number;
}

interface PreparedRestorePermit {
	readonly expectedRecords: readonly OpenFabUserBlueprintRecord[];
	readonly replacementRecords: readonly OpenFabUserBlueprintRecord[];
}

const preparedRestorePermits = new WeakMap<
	OpenFabUserBlueprintLibraryRestorePlan,
	PreparedRestorePermit
>();

export function consumePreparedUserBlueprintLibraryRestore(
	plan: OpenFabUserBlueprintLibraryRestorePlan,
): PreparedRestorePermit | null {
	const permit = preparedRestorePermits.get(plan);
	if (!permit || plan.records !== permit.replacementRecords) return null;
	preparedRestorePermits.delete(plan);
	return permit;
}

interface PendingRestoreWorkerRequest {
	readonly expectedType: OpenFabUserBlueprintLibraryRestoreWorkerResponse["type"];
	readonly resolve: (response: OpenFabUserBlueprintLibraryRestoreWorkerResponse) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof globalThis.setTimeout>;
	readonly signal: AbortSignal | null;
	readonly abortHandler: (() => void) | null;
}

export class OpenFabUserBlueprintLibraryRestoreCancelledError extends Error {
	constructor() {
		super("Blueprint library restore operation was cancelled.");
		this.name = "OpenFabUserBlueprintLibraryRestoreCancelledError";
	}
}

export class OpenFabUserBlueprintLibraryRestoreBridge {
	private readonly createWorker: () => OpenFabUserBlueprintLibraryRestoreWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: OpenFabUserBlueprintLibraryRestoreWorkerPort | null = null;
	private readonly pending = new Map<number, PendingRestoreWorkerRequest>();
	private nextRequestId = 1;
	private previewQueue: Promise<void> = Promise.resolve();
	private expectedRecords: readonly OpenFabUserBlueprintRecord[] | null = null;
	private sessionEpoch = 0;

	constructor(
		createWorker: () => OpenFabUserBlueprintLibraryRestoreWorkerPort = () =>
			new Worker(
				new URL("../worker/openFabUserBlueprintLibraryRestoreWorker.ts", import.meta.url),
				{ type: "module" },
			) as OpenFabUserBlueprintLibraryRestoreWorkerPort,
		timeoutMilliseconds = 120_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	async inspect(
		json: string,
		currentRecords: readonly OpenFabUserBlueprintRecord[],
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintLibraryRestoreInspection> {
		this.cancel();
		this.previewQueue = Promise.resolve();
		this.startWorker();
		try {
			const response = await this.request(
				{
					type: "INSPECT_OPENFAB_USER_BLUEPRINT_LIBRARY",
					requestId: this.nextRequestId++,
					json,
					currentRecords,
				},
				"OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED",
				signal,
				true,
			);
			if (response.type !== "OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED") {
				throw new Error("Blueprint library inspection Worker returned an unexpected response.");
			}
			const inspection = inspectionFromResponse(response);
			this.expectedRecords = inspection.preflight.currentRecords;
			return inspection;
		} catch (error) {
			this.releaseWorker();
			throw error;
		}
	}

	async preview(
		mode: OpenFabUserBlueprintLibraryRestoreMode,
		decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintLibraryRestorePlanPreview> {
		const entries = decisionEntries(decisions);
		const sessionEpoch = this.sessionEpoch;
		const operation = this.previewQueue.then(async () => {
			if (signal?.aborted) throw new OpenFabUserBlueprintLibraryRestoreCancelledError();
			if (sessionEpoch !== this.sessionEpoch) {
				throw new OpenFabUserBlueprintLibraryRestoreCancelledError();
			}
			const response = await this.request(
				{
					type: "PREVIEW_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE",
					requestId: this.nextRequestId++,
					mode,
					decisions: entries,
				},
				"OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PREVIEWED",
				undefined,
				false,
			);
			if (response.type !== "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PREVIEWED") {
				throw new Error("Blueprint library restore Worker returned an unexpected preview.");
			}
			return response.preview;
		});
		this.previewQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return raceRestoreCancellation(operation, signal);
	}

	async plan(
		mode: OpenFabUserBlueprintLibraryRestoreMode,
		decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
		restoredAt: string,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintLibraryRestorePlan> {
		const response = await this.request(
			{
				type: "PLAN_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE",
				requestId: this.nextRequestId++,
				mode,
				decisions: decisionEntries(decisions),
				restoredAt,
			},
			"OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PLANNED",
			signal,
			false,
		);
		if (response.type !== "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PLANNED") {
			throw new Error("Blueprint library restore Worker returned an unexpected plan.");
		}
		if (!this.expectedRecords) {
			throw new Error("Blueprint library restore Worker session has no expected snapshot.");
		}
		preparedRestorePermits.set(response.plan, {
			expectedRecords: this.expectedRecords,
			replacementRecords: response.plan.records,
		});
		return response.plan;
	}

	async rebase(
		currentRecords: readonly OpenFabUserBlueprintRecord[],
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintLibraryRestoreInspection> {
		const response = await this.request(
			{
				type: "REBASE_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE",
				requestId: this.nextRequestId++,
				currentRecords,
			},
			"OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED",
			signal,
			false,
		);
		if (response.type !== "OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED") {
			throw new Error("Blueprint library restore Worker returned an unexpected rebase.");
		}
		const inspection = inspectionFromResponse(response);
		this.expectedRecords = inspection.preflight.currentRecords;
		return inspection;
	}

	cancel(): void {
		this.sessionEpoch += 1;
		this.failAll(new OpenFabUserBlueprintLibraryRestoreCancelledError());
		this.releaseWorker();
		this.expectedRecords = null;
	}

	dispose(): void {
		this.cancel();
	}

	private startWorker(): void {
		let worker: OpenFabUserBlueprintLibraryRestoreWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			throw normalizeRestoreWorkerError(error);
		}
		this.worker = worker;
		worker.onmessage = (event) => this.receive(event.data);
		worker.onmessageerror = () => {
			this.failSession(
				new Error("Blueprint library restore Worker response could not be decoded."),
			);
		};
		worker.onerror = (event) => {
			this.failSession(new Error(event.message || "Blueprint library restore Worker failed."));
		};
	}

	private request(
		message: OpenFabUserBlueprintLibraryRestoreWorkerRequest,
		expectedType: OpenFabUserBlueprintLibraryRestoreWorkerResponse["type"],
		signal: AbortSignal | undefined,
		terminateOnAbort: boolean,
	): Promise<OpenFabUserBlueprintLibraryRestoreWorkerResponse> {
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(new Error("Blueprint library restore Worker session is not active."));
		}
		if (signal?.aborted) {
			if (terminateOnAbort) this.releaseWorker();
			return Promise.reject(new OpenFabUserBlueprintLibraryRestoreCancelledError());
		}
		return new Promise((resolve, reject) => {
			const requestId = message.requestId;
			const abortHandler = signal
				? () => {
						this.rejectPending(requestId, new OpenFabUserBlueprintLibraryRestoreCancelledError());
						if (terminateOnAbort) this.releaseWorker();
					}
				: null;
			const timeout = globalThis.setTimeout(() => {
				this.failSession(new Error("Blueprint library restore Worker timed out."));
			}, this.timeoutMilliseconds);
			this.pending.set(requestId, {
				expectedType,
				resolve,
				reject,
				timeout,
				signal: signal ?? null,
				abortHandler,
			});
			if (signal && abortHandler) signal.addEventListener("abort", abortHandler, { once: true });
			try {
				worker.postMessage(message);
			} catch (error) {
				this.rejectPending(requestId, normalizeRestoreWorkerError(error));
			}
		});
	}

	private receive(response: OpenFabUserBlueprintLibraryRestoreWorkerResponse): void {
		if (!isRestoreWorkerResponse(response)) {
			this.failSession(
				new Error("Blueprint library restore Worker returned a malformed response."),
			);
			return;
		}
		const pending = this.pending.get(response.requestId);
		if (!pending) return;
		this.cleanupPending(response.requestId, pending);
		if (response.type === "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_ERROR") {
			pending.reject(new Error(response.message));
			return;
		}
		if (response.type !== pending.expectedType) {
			pending.reject(new Error("Blueprint library restore Worker returned a mismatched response."));
			return;
		}
		deepFreezeRestoreWorkerValue(response);
		pending.resolve(response);
	}

	private rejectPending(requestId: number, error: Error): void {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		this.cleanupPending(requestId, pending);
		pending.reject(error);
	}

	private cleanupPending(requestId: number, pending: PendingRestoreWorkerRequest): void {
		this.pending.delete(requestId);
		globalThis.clearTimeout(pending.timeout);
		if (pending.signal && pending.abortHandler) {
			pending.signal.removeEventListener("abort", pending.abortHandler);
		}
	}

	private failSession(error: Error): void {
		this.failAll(error);
		this.releaseWorker();
	}

	private failAll(error: Error): void {
		for (const [requestId, pending] of this.pending) {
			this.cleanupPending(requestId, pending);
			pending.reject(error);
		}
	}

	private releaseWorker(): void {
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onmessageerror = null;
		worker.onerror = null;
		worker.terminate();
	}
}

function inspectionFromResponse(
	response: Extract<
		OpenFabUserBlueprintLibraryRestoreWorkerResponse,
		{ readonly type: "OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED" }
	>,
): OpenFabUserBlueprintLibraryRestoreInspection {
	return Object.freeze({
		bundle: response.bundle,
		preflight: response.preflight,
		replaceImpact: response.replaceImpact,
		elapsedMilliseconds: response.elapsedMilliseconds,
	});
}

function decisionEntries(
	decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
): readonly (readonly [string, OpenFabUserBlueprintLibraryConflictDecision])[] {
	return Object.freeze(
		[...decisions.entries()].map(([id, decision]) => Object.freeze([id, decision] as const)),
	);
}

function isRestoreWorkerResponse(
	value: unknown,
): value is OpenFabUserBlueprintLibraryRestoreWorkerResponse {
	if (!value || typeof value !== "object") return false;
	const response = value as Partial<OpenFabUserBlueprintLibraryRestoreWorkerResponse>;
	if (!Number.isSafeInteger(response.requestId)) return false;
	if (response.type === "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_ERROR") {
		return typeof response.message === "string";
	}
	const timedResponse = response as Readonly<{ elapsedMilliseconds?: unknown }>;
	if (
		typeof timedResponse.elapsedMilliseconds !== "number" ||
		!Number.isFinite(timedResponse.elapsedMilliseconds)
	) {
		return false;
	}
	if (response.type === "OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED") {
		return Boolean(response.bundle && response.preflight && response.replaceImpact);
	}
	if (response.type === "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PREVIEWED") {
		return Boolean(response.preview);
	}
	if (response.type === "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PLANNED") {
		return Boolean(response.plan);
	}
	return false;
}

function normalizeRestoreWorkerError(error: unknown): Error {
	return error instanceof Error ? error : new Error("Blueprint library restore Worker failed.");
}

function deepFreezeRestoreWorkerValue(value: unknown): void {
	if (!value || typeof value !== "object") return;
	const pending: object[] = [value];
	const visited = new WeakSet<object>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		for (const key of Reflect.ownKeys(current)) {
			const nested = Reflect.get(current, key) as unknown;
			if (nested && typeof nested === "object") pending.push(nested);
		}
		Object.freeze(current);
	}
}

function raceRestoreCancellation<Value>(
	operation: Promise<Value>,
	signal?: AbortSignal,
): Promise<Value> {
	if (!signal) return operation;
	if (signal.aborted) {
		return Promise.reject(new OpenFabUserBlueprintLibraryRestoreCancelledError());
	}
	return new Promise<Value>((resolve, reject) => {
		const abort = (): void => reject(new OpenFabUserBlueprintLibraryRestoreCancelledError());
		signal.addEventListener("abort", abort, { once: true });
		void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
