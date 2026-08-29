import {
	type SyntheticFabStarterRequest,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import {
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
	type SyntheticFabStarterCertifiedArtifactWorkerRequest,
	type SyntheticFabStarterCertifiedArtifactWorkerResponse,
} from "../worker/SyntheticFabStarterCertifiedArtifactProtocol";
import {
	type HydratedCertifiedSyntheticFabStarter,
	rebindSyntheticFabStarterCertificationEvidenceCooperatively,
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES,
	syntheticFabStarterCertifiedArtifactIdForRequest,
} from "./SyntheticFabStarterCertifiedArtifact";

export interface SyntheticFabStarterCertifiedArtifactWorkerPort {
	onmessage:
		| ((event: MessageEvent<SyntheticFabStarterCertifiedArtifactWorkerResponse>) => void)
		| null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: SyntheticFabStarterCertifiedArtifactWorkerRequest): void;
	terminate(): void;
}

export interface SyntheticFabStarterCertifiedArtifactHydrationBridge {
	hydrate(
		source: string,
		request: SyntheticFabStarterRequest,
	): Promise<HydratedCertifiedSyntheticFabStarter | null>;
	cancel(): void;
	dispose(): void;
}

export class SyntheticFabStarterCertifiedArtifactBridge
	implements SyntheticFabStarterCertifiedArtifactHydrationBridge
{
	private readonly createWorker: () => SyntheticFabStarterCertifiedArtifactWorkerPort;
	private readonly timeoutMilliseconds: number;
	private readonly checkpoint: () => Promise<void>;
	private worker: SyntheticFabStarterCertifiedArtifactWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => SyntheticFabStarterCertifiedArtifactWorkerPort = () =>
			new Worker(
				new URL("../worker/syntheticFabStarterCertifiedArtifactWorker.ts", import.meta.url),
				{ type: "module" },
			) as SyntheticFabStarterCertifiedArtifactWorkerPort,
		timeoutMilliseconds = 30_000,
		checkpoint: () => Promise<void> = yieldCertifiedArtifactRebind,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
		this.checkpoint = checkpoint;
	}

	hydrate(
		source: string,
		request: SyntheticFabStarterRequest,
	): Promise<HydratedCertifiedSyntheticFabStarter | null> {
		this.cancel();
		if (
			typeof source !== "string" ||
			source.length > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES
		) {
			return Promise.reject(new Error("Certified FAB artifact source exceeds its byte budget."));
		}
		const artifactId = syntheticFabStarterCertifiedArtifactIdForRequest(request);
		if (!artifactId) return Promise.resolve(null);
		let requestFingerprint: string;
		try {
			requestFingerprint = syntheticFabStarterRequestFingerprint(request);
		} catch (error) {
			return Promise.reject(normalizeHydrationError(error, "Certified FAB request is invalid."));
		}
		let worker: SyntheticFabStarterCertifiedArtifactWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			return Promise.reject(
				normalizeHydrationError(error, "Certified FAB hydration Worker creation failed."),
			);
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
			const succeed = (value: HydratedCertifiedSyntheticFabStarter | null): void => {
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				resolve(value);
			};
			worker.onmessage = (event) => {
				const response = event.data;
				if (!isCertifiedArtifactWorkerResponse(response)) {
					fail(new Error("Certified FAB hydration Worker returned a malformed response."));
					return;
				}
				if (response.requestId !== requestId) {
					fail(new Error("Certified FAB hydration Worker returned a stale response."));
					return;
				}
				if (response.type === "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED") {
					succeed(null);
					return;
				}
				if (response.type === "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATION_ERROR") {
					fail(new Error(response.message));
					return;
				}
				void rebindSyntheticFabStarterCertificationEvidenceCooperatively(
					response.prepared as PreparedSyntheticFabStarter,
					response.attestation,
					request,
					this.checkpoint,
				).then((hydrated) => {
					if (!hydrated) {
						fail(new Error("Certified FAB hydration Worker returned mismatched evidence."));
						return;
					}
					succeed(hydrated);
				});
			};
			worker.onmessageerror = () => {
				fail(new Error("Certified FAB hydration Worker response could not be decoded."));
			};
			worker.onerror = (event) => {
				fail(new Error(event.message || "Certified FAB hydration Worker failed."));
			};
			this.timeout = globalThis.setTimeout(() => {
				fail(new Error("Certified FAB hydration Worker timed out."));
			}, this.timeoutMilliseconds);
			try {
				worker.postMessage({
					type: "HYDRATE_SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT",
					protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
					requestId,
					artifactId,
					requestFingerprint,
					source,
					starter: request,
				});
			} catch (error) {
				fail(normalizeHydrationError(error, "Certified FAB hydration Worker request failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(new DOMException("Certified FAB artifact hydration cancelled.", "AbortError"));
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

function isCertifiedArtifactWorkerResponse(
	value: unknown,
): value is SyntheticFabStarterCertifiedArtifactWorkerResponse {
	if (!isRecord(value)) return false;
	if (
		value.protocolVersion !== SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION ||
		!Number.isSafeInteger(value.requestId) ||
		(value.requestId as number) <= 0
	) {
		return false;
	}
	if (value.type === "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED") {
		return hasExactKeys(value, ["type", "protocolVersion", "requestId"]);
	}
	if (value.type === "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATION_ERROR") {
		return (
			hasExactKeys(value, ["type", "protocolVersion", "requestId", "message"]) &&
			typeof value.message === "string" &&
			value.message.length > 0 &&
			value.message.length <= 512
		);
	}
	return (
		value.type === "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED" &&
		hasExactKeys(value, ["type", "protocolVersion", "requestId", "prepared", "attestation"]) &&
		isRecord(value.prepared) &&
		isRecord(value.attestation)
	);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHydrationError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

async function yieldCertifiedArtifactRebind(): Promise<void> {
	const browserScheduler = Reflect.get(globalThis, "scheduler") as
		| { yield?: () => Promise<void> }
		| undefined;
	if (browserScheduler?.yield) {
		await browserScheduler.yield();
		return;
	}
	await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}
