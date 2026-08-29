import {
	normalizeOpenFabFabPreparedProjectIdentity,
	type OpenFabFabPreparedProjectIdentity,
	openFabFabPreparedProjectRequestFingerprint,
} from "../compile/OpenFabFabPreparedProject";
import { normalizeOpenFabFabProfile, type OpenFabFabProfile } from "../compile/OpenFabFabProfile";
import type {
	OpenFabFabPreparedProjectOperation,
	OpenFabFabPreparedProjectWorkerRequest,
	OpenFabFabPreparedProjectWorkerResponse,
} from "../worker/OpenFabFabPreparedProjectProtocol";
import { OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION } from "../worker/OpenFabFabPreparedProjectProtocol";
import {
	bindOpenFabFabPreparedProjectVerification,
	discardOpenFabFabPreparedProject,
	type OpenFabFabPreparedProject,
	type OpenFabFabPreparedProjectVerificationEvidence,
	rebindTransferableOpenFabFabPreparedProject,
	validateOpenFabFabPreparedProjectIdentityForProfile,
} from "./OpenFabFabPreparedProjectArtifact";

export interface OpenFabFabPreparedProjectWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: OpenFabFabPreparedProjectWorkerRequest): void;
	terminate(): void;
}

export interface VerifiedOpenFabFabPreparedProject {
	readonly prepared: OpenFabFabPreparedProject;
	readonly evidence: OpenFabFabPreparedProjectVerificationEvidence;
}

export class OpenFabFabPreparedProjectCancelledError extends DOMException {
	constructor() {
		super("OpenFab Fab project preparation was cancelled.", "AbortError");
	}
}

interface ActivePreparation {
	readonly generation: number;
	readonly requestId: number;
	readonly requestFingerprint: string;
	readonly profile: OpenFabFabProfile;
	readonly verifier: OpenFabFabPreparedProjectWorkerPort;
	readonly source: OpenFabFabPreparedProjectWorkerPort;
	readonly resolve: (value: VerifiedOpenFabFabPreparedProject) => void;
	readonly reject: (error: Error) => void;
	verifierIdentity: OpenFabFabPreparedProjectIdentity | null;
	prepared: OpenFabFabPreparedProject | null;
	settled: boolean;
	timeout: ReturnType<typeof setTimeout> | null;
	abortSignal: AbortSignal | null;
	abortListener: (() => void) | null;
}

const VERIFIED_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"requestFingerprint",
	"identity",
] as const);
const SOURCE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"requestFingerprint",
	"prepared",
	"attestation",
] as const);
const ERROR_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"requestFingerprint",
	"operation",
	"code",
	"message",
] as const);
const ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"REQUEST_MISMATCH",
	"COMPOSITION_FAILED",
	"CERTIFICATE_INVALID",
	"TRANSFER_INVALID",
] as const);

/** Latest-wins dual materialization; only the source Worker transfers a snapshot. */
export class OpenFabFabPreparedProjectBridge {
	private readonly createWorker: (
		operation: OpenFabFabPreparedProjectOperation,
	) => OpenFabFabPreparedProjectWorkerPort;
	private readonly timeoutMilliseconds: number;
	private active: ActivePreparation | null = null;
	private nextRequestId = 1;
	private nextGeneration = 1;
	private disposed = false;

	constructor(
		createWorker: (
			operation: OpenFabFabPreparedProjectOperation,
		) => OpenFabFabPreparedProjectWorkerPort = () =>
			new Worker(new URL("../worker/openFabFabPreparedProjectWorker.ts", import.meta.url), {
				type: "module",
			}) as OpenFabFabPreparedProjectWorkerPort,
		timeoutMilliseconds = 120_000,
	) {
		if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
			throw new RangeError("Prepared-project timeout must be a positive safe integer.");
		}
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(profileValue: unknown, signal?: AbortSignal): Promise<VerifiedOpenFabFabPreparedProject> {
		if (this.disposed) return Promise.reject(new OpenFabFabPreparedProjectCancelledError());
		this.cancel();
		if (signal?.aborted) return Promise.reject(new OpenFabFabPreparedProjectCancelledError());
		let profile: OpenFabFabProfile;
		try {
			profile = normalizeOpenFabFabProfile(profileValue);
		} catch (error) {
			return Promise.reject(normalizeError(error, "OpenFab Fab profile is invalid."));
		}
		const requestId = this.issueRequestId();
		const requestFingerprint = openFabFabPreparedProjectRequestFingerprint(profile);
		let verifier: OpenFabFabPreparedProjectWorkerPort;
		let source: OpenFabFabPreparedProjectWorkerPort;
		try {
			verifier = this.createWorker("VERIFY");
			try {
				source = this.createWorker("SOURCE");
			} catch (error) {
				terminateWorker(verifier);
				throw error;
			}
		} catch (error) {
			return Promise.reject(normalizeError(error, "OpenFab Fab project Worker creation failed."));
		}

		return new Promise((resolve, reject) => {
			const active: ActivePreparation = {
				generation: this.issueGeneration(),
				requestId,
				requestFingerprint,
				profile,
				verifier,
				source,
				resolve,
				reject,
				verifierIdentity: null,
				prepared: null,
				settled: false,
				timeout: null,
				abortSignal: signal ?? null,
				abortListener: null,
			};
			this.active = active;
			this.installWorker(active, "VERIFY", verifier);
			this.installWorker(active, "SOURCE", source);
			active.timeout = setTimeout(
				() =>
					this.fail(
						active,
						new Error(
							`OpenFab Fab project preparation timed out after ${this.timeoutMilliseconds} ms.`,
						),
					),
				this.timeoutMilliseconds,
			);
			if (signal) {
				active.abortListener = () =>
					this.fail(active, new OpenFabFabPreparedProjectCancelledError());
				signal.addEventListener("abort", active.abortListener, { once: true });
			}
			try {
				verifier.postMessage(this.request("VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION", active));
				source.postMessage(this.request("PREPARE_OPENFAB_FAB_PROJECT_SOURCE", active));
			} catch (error) {
				this.fail(
					active,
					normalizeError(error, "OpenFab Fab project Worker request could not be posted."),
				);
			}
		});
	}

	cancel(): void {
		if (this.active) this.fail(this.active, new OpenFabFabPreparedProjectCancelledError());
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel();
	}

	private installWorker(
		active: ActivePreparation,
		operation: OpenFabFabPreparedProjectOperation,
		worker: OpenFabFabPreparedProjectWorkerPort,
	): void {
		worker.onmessage = (event) => this.receive(active, operation, worker, event.data);
		worker.onerror = (event) =>
			this.fail(active, new Error(event.message || "OpenFab Fab project Worker failed."));
		worker.onmessageerror = () =>
			this.fail(active, new Error("OpenFab Fab project Worker returned an unreadable response."));
	}

	private receive(
		active: ActivePreparation,
		operation: OpenFabFabPreparedProjectOperation,
		worker: OpenFabFabPreparedProjectWorkerPort,
		value: unknown,
	): void {
		if (
			this.active !== active ||
			this.active.generation !== active.generation ||
			active.settled ||
			(operation === "VERIFY" ? active.verifier !== worker : active.source !== worker)
		) {
			return;
		}
		try {
			const response = parseResponse(value);
			if (
				response.requestId !== active.requestId ||
				response.requestFingerprint !== active.requestFingerprint
			) {
				throw new Error("OpenFab Fab project Worker returned a stale or foreign response.");
			}
			if (response.type === "OPENFAB_FAB_PREPARED_PROJECT_ERROR") {
				if (response.operation !== operation) {
					throw new Error("OpenFab Fab project Worker error operation is mismatched.");
				}
				throw new Error(response.message);
			}
			if (operation === "VERIFY") {
				if (response.type !== "OPENFAB_FAB_PROJECT_MATERIALIZATION_VERIFIED") {
					throw new Error("Verifier Worker returned a source response.");
				}
				if (active.verifierIdentity) {
					throw new Error("Verifier Worker returned more than one response.");
				}
				active.verifierIdentity = validateOpenFabFabPreparedProjectIdentityForProfile(
					normalizeOpenFabFabPreparedProjectIdentity(response.identity),
					active.profile,
					active.requestFingerprint,
				);
			} else {
				if (response.type !== "OPENFAB_FAB_PROJECT_SOURCE_PREPARED") {
					throw new Error("Source Worker returned a verifier response.");
				}
				if (active.prepared) {
					throw new Error("Source Worker returned more than one response.");
				}
				active.prepared = rebindTransferableOpenFabFabPreparedProject(
					response.prepared,
					response.attestation,
					active.profile,
				);
			}
		} catch (error) {
			this.fail(active, normalizeError(error, "OpenFab Fab project Worker response is invalid."));
			return;
		}
		this.completeIfReady(active);
	}

	private completeIfReady(active: ActivePreparation): void {
		if (!active.prepared || !active.verifierIdentity || this.active !== active || active.settled) {
			return;
		}
		try {
			const result = Object.freeze({
				prepared: active.prepared,
				evidence: bindOpenFabFabPreparedProjectVerification(
					active.prepared,
					active.verifierIdentity,
				),
			});
			active.settled = true;
			this.release(active);
			active.resolve(result);
		} catch (error) {
			this.fail(active, normalizeError(error, "OpenFab Fab project verification failed."));
		}
	}

	private fail(active: ActivePreparation, error: Error): void {
		if (this.active !== active || active.settled) return;
		active.settled = true;
		if (active.prepared) {
			discardOpenFabFabPreparedProject(active.prepared);
			active.prepared = null;
		}
		this.release(active);
		active.reject(error);
	}

	private release(active: ActivePreparation): void {
		if (active.timeout) clearTimeout(active.timeout);
		active.timeout = null;
		if (active.abortSignal && active.abortListener) {
			active.abortSignal.removeEventListener("abort", active.abortListener);
		}
		active.abortSignal = null;
		active.abortListener = null;
		terminateWorker(active.verifier);
		terminateWorker(active.source);
		if (this.active === active) this.active = null;
	}

	private request(
		type: "VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION" | "PREPARE_OPENFAB_FAB_PROJECT_SOURCE",
		active: ActivePreparation,
	): OpenFabFabPreparedProjectWorkerRequest {
		return Object.freeze({
			type,
			protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
			requestId: active.requestId,
			requestFingerprint: active.requestFingerprint,
			profile: active.profile,
		});
	}

	private issueRequestId(): number {
		const id = this.nextRequestId;
		this.nextRequestId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
		return id;
	}

	private issueGeneration(): number {
		const generation = this.nextGeneration;
		this.nextGeneration = generation === Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
		return generation;
	}
}

function parseResponse(value: unknown): OpenFabFabPreparedProjectWorkerResponse {
	if (!isRecord(value)) throw new Error("OpenFab Fab project Worker response is not an object.");
	const keys =
		value.type === "OPENFAB_FAB_PROJECT_MATERIALIZATION_VERIFIED"
			? VERIFIED_KEYS
			: value.type === "OPENFAB_FAB_PROJECT_SOURCE_PREPARED"
				? SOURCE_KEYS
				: value.type === "OPENFAB_FAB_PREPARED_PROJECT_ERROR"
					? ERROR_KEYS
					: null;
	if (!keys || !hasExactKeys(value, keys)) {
		throw new Error("OpenFab Fab project Worker response fields are malformed.");
	}
	if (
		value.protocolVersion !== OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION ||
		!Number.isSafeInteger(value.requestId) ||
		(value.requestId as number) < 1 ||
		typeof value.requestFingerprint !== "string" ||
		value.requestFingerprint.length === 0 ||
		value.requestFingerprint.length > 512
	) {
		throw new Error("OpenFab Fab project Worker response scalars are malformed.");
	}
	if (value.type === "OPENFAB_FAB_PREPARED_PROJECT_ERROR") {
		if (
			(value.operation !== "VERIFY" && value.operation !== "SOURCE") ||
			!ERROR_CODES.includes(value.code as (typeof ERROR_CODES)[number]) ||
			typeof value.message !== "string" ||
			value.message.length === 0 ||
			value.message.length > 512
		) {
			throw new Error("OpenFab Fab project Worker error response is malformed.");
		}
	}
	return value as unknown as OpenFabFabPreparedProjectWorkerResponse;
}

function terminateWorker(worker: OpenFabFabPreparedProjectWorkerPort): void {
	worker.onmessage = null;
	worker.onerror = null;
	worker.onmessageerror = null;
	try {
		worker.terminate();
	} catch {
		// Cleanup must never prevent the active promise from settling or the peer Worker terminating.
	}
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
