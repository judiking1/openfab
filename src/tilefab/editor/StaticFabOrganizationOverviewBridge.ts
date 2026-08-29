import {
	hydrateStaticFabOrganizationOverviewSnapshot,
	type StaticFabOrganizationOverview,
	type StaticFabOrganizationOverviewSourceIdentity,
} from "../compile/StaticFabOrganizationOverview";
import {
	hydrateStaticFabProjectChecksSnapshot,
	type StaticFabProjectChecks,
	type StaticFabProjectChecksSourceIdentity,
} from "../compile/StaticFabProjectChecks";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	PreparedStaticFabOrganizationOverview,
	StaticFabOrganizationOverviewWorkerRequest,
	StaticFabOrganizationOverviewWorkerResponse,
} from "../worker/StaticFabOrganizationOverviewRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabOrganizationOverviewWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabOrganizationOverviewWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabOrganizationOverviewWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabOrganizationOverviewInput {
	/** Fresh canonical capture. Its transferable buffers are consumed by prepare(). */
	readonly snapshot: RailMirrorSnapshot;
	/** Immutable identity captured from the same document generation as snapshot. */
	readonly source: StaticFabOrganizationOverviewSourceIdentity;
	readonly expectedRailReadinessFingerprint: string;
	readonly signal?: AbortSignal;
}

export interface StaticFabOrganizationInspection {
	readonly overview: StaticFabOrganizationOverview | null;
	readonly overviewError: string | null;
	readonly checks: StaticFabProjectChecks;
}

/** Latest-request-wins disposable-Worker adapter for exact organization overview derivation. */
export class StaticFabOrganizationOverviewBridge {
	private readonly createWorker: () => StaticFabOrganizationOverviewWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabOrganizationOverviewWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private abortSignal: AbortSignal | null = null;
	private abortListener: (() => void) | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => StaticFabOrganizationOverviewWorkerPort = () =>
			new Worker(new URL("../worker/staticFabOrganizationOverviewWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabOrganizationOverviewWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(input: StaticFabOrganizationOverviewInput): Promise<StaticFabOrganizationOverview> {
		return this.prepareInspection(input).then((inspection) => {
			if (inspection.overview) return inspection.overview;
			throw new Error(
				inspection.overviewError ?? "Static FAB organization overview is unavailable.",
			);
		});
	}

	prepareInspection(
		input: StaticFabOrganizationOverviewInput,
	): Promise<StaticFabOrganizationInspection> {
		this.cancel();
		const inputError = validateInputIdentity(
			input.snapshot,
			input.source,
			input.expectedRailReadinessFingerprint,
		);
		if (inputError) return Promise.reject(inputError);
		if (input.signal?.aborted) return Promise.reject(cancelledError());

		const requestId = this.issueRequestId();
		const expectedSource = Object.freeze({ ...input.source });
		const expectedChecksSource = staticFabProjectChecksSource(input.snapshot, expectedSource);
		const request: StaticFabOrganizationOverviewWorkerRequest = {
			type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW",
			requestId,
			snapshot: input.snapshot,
			source: expectedSource,
			expectedRailReadinessFingerprint: input.expectedRailReadinessFingerprint,
		};

		return new Promise((resolve, reject) => {
			let worker: StaticFabOrganizationOverviewWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(normalizeError(error, "Static FAB organization overview Worker creation failed."));
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
				const response = event.data as unknown;
				if (!isRecord(response) || !Number.isSafeInteger(response.requestId)) {
					fail(new Error("Static FAB organization overview Worker returned a malformed response."));
					return;
				}
				if (response.requestId !== requestId) {
					fail(
						new Error(
							`Static FAB organization overview Worker returned stale request ${response.requestId}; expected ${requestId}.`,
						),
					);
					return;
				}
				if (response.type === "STATIC_FAB_ORGANIZATION_OVERVIEW_ERROR") {
					fail(
						new Error(
							typeof response.message === "string" && response.message.length > 0
								? response.message
								: "Static FAB organization overview Worker returned a malformed error.",
						),
					);
					return;
				}
				if (response.type !== "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED") {
					fail(new Error("Static FAB organization overview Worker returned an unknown response."));
					return;
				}
				const preparedError = validatePreparedEnvelope(response.prepared, expectedSource);
				if (preparedError) {
					fail(preparedError);
					return;
				}
				let overview: StaticFabOrganizationOverview | null = null;
				let checks: StaticFabProjectChecks;
				try {
					const prepared = response.prepared as PreparedStaticFabOrganizationOverview;
					if (prepared.overviewSnapshot) {
						overview = hydrateStaticFabOrganizationOverviewSnapshot(
							prepared.overviewSnapshot,
							expectedSource,
						);
					}
					checks = hydrateStaticFabProjectChecksSnapshot(
						prepared.checksSnapshot,
						expectedChecksSource,
						input.expectedRailReadinessFingerprint,
					);
				} catch (error) {
					fail(
						normalizeError(error, "Static FAB organization inspection Worker data is malformed."),
					);
					return;
				}
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				const prepared = response.prepared as PreparedStaticFabOrganizationOverview;
				resolve(
					Object.freeze({
						overview,
						overviewError: prepared.overviewError,
						checks,
					}),
				);
			};
			worker.onerror = (event) => {
				fail(new Error(event.message || "Static FAB organization overview Worker failed."));
			};
			worker.onmessageerror = () => {
				fail(new Error("Static FAB organization overview Worker returned an unreadable response."));
			};
			this.timeout = setTimeout(() => {
				fail(
					new Error(
						`Static FAB organization overview Worker timed out after ${this.timeoutMilliseconds} ms.`,
					),
				);
			}, this.timeoutMilliseconds);

			if (input.signal) {
				this.abortSignal = input.signal;
				this.abortListener = () => this.cancel();
				input.signal.addEventListener("abort", this.abortListener, { once: true });
				if (input.signal.aborted) {
					this.abortListener();
					return;
				}
			}

			try {
				worker.postMessage(request, collectTransferableBuffers(input.snapshot));
			} catch (error) {
				fail(normalizeError(error, "Static FAB organization overview Worker post failed."));
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
		this.nextRequestId = requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
		return requestId;
	}

	private releaseWorker(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		if (this.abortSignal && this.abortListener) {
			this.abortSignal.removeEventListener("abort", this.abortListener);
		}
		this.abortSignal = null;
		this.abortListener = null;
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}
}

function validateInputIdentity(
	snapshot: RailMirrorSnapshot,
	source: StaticFabOrganizationOverviewSourceIdentity,
	expectedRailReadinessFingerprint: string,
): Error | null {
	if (
		!Number.isSafeInteger(source.revision) ||
		source.revision < 0 ||
		!Number.isSafeInteger(source.sequence) ||
		source.sequence < 0 ||
		typeof source.checksum !== "string" ||
		source.checksum.length === 0 ||
		source.checksum !== source.checksum.trim()
	) {
		return new Error("Static FAB organization overview source identity is invalid.");
	}
	if (
		typeof expectedRailReadinessFingerprint !== "string" ||
		expectedRailReadinessFingerprint.length === 0 ||
		expectedRailReadinessFingerprint !== expectedRailReadinessFingerprint.trim()
	) {
		return new Error("Static FAB project checks rail readiness fingerprint is invalid.");
	}
	if (snapshot.revision !== source.revision) {
		return new Error("Static FAB organization overview source revision does not match snapshot.");
	}
	if (snapshot.checksum !== source.checksum) {
		return new Error("Static FAB organization overview source checksum does not match snapshot.");
	}
	if (snapshot.sequence !== source.sequence) {
		return new Error("Static FAB organization overview source sequence does not match snapshot.");
	}
	return null;
}

function validatePreparedEnvelope(
	value: unknown,
	expected: StaticFabOrganizationOverviewSourceIdentity,
): Error | null {
	if (
		!isRecord(value) ||
		!Number.isFinite(value.preparationMilliseconds) ||
		(value.preparationMilliseconds as number) < 0 ||
		(value.overviewSnapshot !== null && !isRecord(value.overviewSnapshot)) ||
		(value.overviewError !== null && typeof value.overviewError !== "string") ||
		(value.overviewSnapshot !== null && value.overviewError !== null) ||
		(value.overviewSnapshot === null &&
			(typeof value.overviewError !== "string" || value.overviewError.length === 0)) ||
		!isRecord(value.checksSnapshot)
	) {
		return new Error("Static FAB organization overview Worker returned malformed prepared data.");
	}
	if (value.sourceRevision !== expected.revision) {
		return new Error("Static FAB organization overview Worker returned a stale source revision.");
	}
	if (value.sourceChecksum !== expected.checksum) {
		return new Error("Static FAB organization overview Worker returned a stale source checksum.");
	}
	if (value.sourceSequence !== expected.sequence) {
		return new Error("Static FAB organization overview Worker returned a stale source sequence.");
	}
	return null;
}

function staticFabProjectChecksSource(
	snapshot: RailMirrorSnapshot,
	source: StaticFabOrganizationOverviewSourceIdentity,
): StaticFabProjectChecksSourceIdentity {
	return Object.freeze({
		...source,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function cancelledError(): DOMException {
	return new DOMException("Static FAB organization overview preparation cancelled.", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
