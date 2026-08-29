import {
	captureOpenFabStationProposalArtifactCooperatively,
	type HydratedOpenFabStationProposalArtifact,
	type OpenFabStationProposalArtifactCapture,
	revokeOpenFabStationProposalArtifactCaptureAuthority,
} from "../compile/OpenFabStationProposalArtifact";
import type { OpenFabStationProposalReviewDraft } from "../compile/OpenFabStationProposalReview";
import {
	type HydratedOpenFabStationProposalReviewEvaluationPreview,
	hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively,
} from "../compile/OpenFabStationProposalReviewEvaluationArtifact";
import type { RailDocument } from "../core/RailDocument";
import {
	type ReviewedPortEquipmentApply,
	revokeReviewedPortEquipmentApply,
} from "../core/ReviewedPortEquipmentApplyCertification";
import {
	encodeOpenFabStationProposalReviewDraftCooperatively,
	type OpenFabStationProposalReviewDraftSnapshot,
	revokeEncodedOpenFabStationProposalReviewDraftSnapshot,
} from "../worker/OpenFabStationProposalReviewDraftSoA";
import {
	type AdoptedOpenFabStationProposalReviewedPlanArtifact,
	adoptOpenFabStationProposalReviewedPlanArtifactCooperatively,
	armOpenFabStationProposalReviewPermit,
	authorizeOpenFabStationProposalReviewApply,
	materializeOpenFabStationProposalReviewedApplyCooperatively,
	type OpenFabStationProposalReviewedApplyMaterializationTimings,
	type OpenFabStationProposalReviewPermit,
	prepareOpenFabStationProposalReviewEvaluationTransfer,
	revokeAdoptedOpenFabStationProposalReviewedPlanArtifact,
	revokeOpenFabStationProposalReviewPermit,
} from "../worker/OpenFabStationProposalReviewedPlanArtifact";
import {
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_ERROR_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_MAX_ERROR_MESSAGE_LENGTH,
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalReviewWorkerErrorCode,
	type OpenFabStationProposalReviewWorkerRequest,
	type OpenFabStationProposalReviewWorkerTicket,
	openFabStationProposalReviewWorkerErrorMessage,
} from "../worker/OpenFabStationProposalReviewWorkerProtocol";
import {
	type RailMirrorSnapshot,
	revokeRailMirrorSnapshotCaptureAuthority,
} from "../worker/RailMirrorChecksum";
import {
	isOpenFabStationProposalReviewSession,
	type OpenFabStationProposalReviewSession,
	openFabStationProposalReviewSessionMatchesProposal,
} from "./OpenFabStationProposalReviewSession";

export interface OpenFabStationProposalReviewWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: OpenFabStationProposalReviewWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

interface OpenFabStationProposalReviewBridgeInputBase {
	readonly document: RailDocument;
	readonly proposal: HydratedOpenFabStationProposalArtifact;
	/** Must come from RailWorkerBridge.captureCurrentSnapshot(). */
	readonly snapshot: RailMirrorSnapshot;
	readonly generation: number;
	readonly getGeneration: () => number;
}

/**
 * Compatibility callers may provide an object Draft or an already fresh compact snapshot. The
 * editor path provides the genuine typed review session itself, so proposal identity and the exact
 * session revision stay bound through capture, Worker evaluation, and explicit Apply.
 */
export type OpenFabStationProposalReviewBridgeInput = OpenFabStationProposalReviewBridgeInputBase &
	(
		| Readonly<{
				draft: OpenFabStationProposalReviewDraft;
				draftSnapshot?: never;
				draftSession?: never;
		  }>
		| Readonly<{
				draft?: never;
				draftSnapshot: OpenFabStationProposalReviewDraftSnapshot;
				draftSession?: never;
		  }>
		| Readonly<{
				draft?: never;
				draftSnapshot?: never;
				draftSession: OpenFabStationProposalReviewSession;
		  }>
	);

export interface OpenFabStationProposalReviewBridgeEvaluation {
	readonly kind: "openfab-station-proposal-review-bridge-evaluation";
	readonly generation: number;
	readonly evaluationRequestId: number;
	readonly preview: HydratedOpenFabStationProposalReviewEvaluationPreview;
	readonly canApply: boolean;
}

export interface PreparedOpenFabStationProposalReviewApply {
	readonly kind: "prepared-openfab-station-proposal-review-apply";
	readonly apply: ReviewedPortEquipmentApply;
	readonly generation: number;
	readonly evaluationRequestId: number;
	readonly applyRequestId: number;
	readonly workerRoundTripMilliseconds: number;
	readonly adoptionMilliseconds: number;
	readonly materialization: OpenFabStationProposalReviewedApplyMaterializationTimings;
	/** Compatibility aggregate; exactly adoption plus measured materialization total. */
	readonly adoptionAndMaterializationMilliseconds: number;
}

export class OpenFabStationProposalReviewCancelledError extends DOMException {
	constructor() {
		super("Station proposal review was cancelled.", "AbortError");
	}
}

interface PreparationState {
	readonly epoch: number;
	readonly controller: AbortController;
	readonly snapshot: RailMirrorSnapshot;
	readonly draftSession: OpenFabStationProposalReviewSession | null;
	readonly draftSessionRevision: number | null;
	proposalCapture: OpenFabStationProposalArtifactCapture | null;
	draftSnapshot: OpenFabStationProposalReviewDraftSnapshot | null;
	externalSignal: AbortSignal | null;
	externalAbortListener: (() => void) | null;
}

interface ActiveSession {
	readonly epoch: number;
	readonly worker: OpenFabStationProposalReviewWorkerPort;
	readonly controller: AbortController;
	readonly document: RailDocument;
	readonly generation: number;
	readonly getGeneration: () => number;
	readonly draftSession: OpenFabStationProposalReviewSession | null;
	readonly draftSessionRevision: number | null;
	readonly evaluationRequestId: number;
	startedAt: number;
	permit: OpenFabStationProposalReviewPermit | null;
	phase: "evaluating" | "ready" | "applying" | "adopting";
	evaluation: OpenFabStationProposalReviewBridgeEvaluation | null;
	applyRequestId: number | null;
	applyStartedAt: number | null;
	pendingResolve: ((value: unknown) => void) | null;
	pendingReject: ((error: Error) => void) | null;
	timeout: ReturnType<typeof globalThis.setTimeout> | null;
	externalSignal: AbortSignal | null;
	externalAbortListener: (() => void) | null;
	applySignal: AbortSignal | null;
	applyAbortListener: (() => void) | null;
	workerTerminated: boolean;
}

interface ParsedEvaluationResponse {
	readonly type: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED";
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly ticketId: number;
	readonly proposalSemanticFingerprint: string;
	readonly proposalSnapshotFingerprint: string;
	readonly draftFingerprint: string;
	readonly sourceChecksum: string;
	readonly evaluation: unknown;
}

interface ParsedPlanResponse {
	readonly type: "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED";
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly ticketId: number;
	readonly ticket: unknown;
	readonly planArtifact: unknown;
}

interface ParsedErrorResponse {
	readonly type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR";
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly ticketId: number;
	readonly code: OpenFabStationProposalReviewWorkerErrorCode;
	readonly message: string;
}

type ParsedResponse = ParsedEvaluationResponse | ParsedPlanResponse | ParsedErrorResponse;

const EVALUATED_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"ticketId",
	"proposalSemanticFingerprint",
	"proposalSnapshotFingerprint",
	"draftFingerprint",
	"sourceChecksum",
	"evaluation",
] as const);
const PLAN_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"ticketId",
	"ticket",
	"planArtifact",
] as const);
const ERROR_RESPONSE_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"ticketId",
	"code",
	"message",
] as const);
const BRIDGE_INPUT_BASE_KEYS = Object.freeze([
	"document",
	"proposal",
	"snapshot",
	"generation",
	"getGeneration",
] as const);
const BRIDGE_OBJECT_DRAFT_INPUT_KEYS = Object.freeze([...BRIDGE_INPUT_BASE_KEYS, "draft"] as const);
const BRIDGE_SNAPSHOT_DRAFT_INPUT_KEYS = Object.freeze([
	...BRIDGE_INPUT_BASE_KEYS,
	"draftSnapshot",
] as const);
const BRIDGE_SESSION_DRAFT_INPUT_KEYS = Object.freeze([
	...BRIDGE_INPUT_BASE_KEYS,
	"draftSession",
] as const);
const trustedBridgeErrors = new WeakSet<object>();

interface CapturedBridgeInputEnvelope {
	readonly input: OpenFabStationProposalReviewBridgeInput | null;
	readonly railSnapshotAuthorities: readonly unknown[];
	readonly draftSnapshotAuthorities: readonly unknown[];
}

/** Latest-wins bridge. It prepares authority but never commits the returned Apply handle. */
export class OpenFabStationProposalReviewBridge {
	private readonly createWorker: () => OpenFabStationProposalReviewWorkerPort;
	private readonly timeoutMilliseconds: number;
	private readonly checkpoint: (signal: AbortSignal) => Promise<void>;
	private readonly now: () => number;
	private readonly sliceMilliseconds: number;
	private preparation: PreparationState | null = null;
	private active: ActiveSession | null = null;
	private nextRequestId = 1;
	private epoch = 0;
	private disposed = false;

	constructor(
		createWorker: () => OpenFabStationProposalReviewWorkerPort = () =>
			new Worker(new URL("../worker/openFabStationProposalReviewWorker.ts", import.meta.url), {
				type: "module",
			}) as OpenFabStationProposalReviewWorkerPort,
		timeoutMilliseconds = 30_000,
		checkpoint: (signal: AbortSignal) => Promise<void> = nextMainTask,
		now: () => number = () => performance.now(),
		sliceMilliseconds = 4,
	) {
		if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
			throw new RangeError("Station proposal review timeout must be a positive safe integer.");
		}
		if (!Number.isFinite(sliceMilliseconds) || sliceMilliseconds <= 0 || sliceMilliseconds > 4) {
			throw new RangeError("Station proposal review main-thread slice must be from 0 to 4 ms.");
		}
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
		this.checkpoint = checkpoint;
		this.now = now;
		this.sliceMilliseconds = sliceMilliseconds;
	}

	async evaluate(
		input: OpenFabStationProposalReviewBridgeInput,
		signal?: AbortSignal,
	): Promise<OpenFabStationProposalReviewBridgeEvaluation> {
		if (this.disposed) {
			const capturedEnvelope = captureBridgeInputEnvelope(input);
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw new OpenFabStationProposalReviewCancelledError();
		}
		this.cancel();
		const epoch = ++this.epoch;
		const capturedEnvelope = captureBridgeInputEnvelope(input);
		if (!this.isUnownedEntryCurrent(epoch)) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw new OpenFabStationProposalReviewCancelledError();
		}
		const capturedInput = capturedEnvelope.input;
		if (capturedInput === null) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw fixedBridgeError("Station proposal review input is invalid.");
		}
		const suppliedDraftSnapshot = capturedInput.draftSnapshot ?? null;
		const suppliedObjectDraft = capturedInput.draft ?? null;
		const suppliedDraftSession = capturedInput.draftSession ?? null;
		const suppliedDraftInputCount =
			Number(suppliedDraftSnapshot !== null) +
			Number(suppliedObjectDraft !== null) +
			Number(suppliedDraftSession !== null);
		if (suppliedDraftInputCount !== 1) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw fixedBridgeError("Station proposal review Draft input is invalid.");
		}
		let draftSessionRevision: number | null = null;
		if (suppliedDraftSession !== null) {
			if (
				!isOpenFabStationProposalReviewSession(suppliedDraftSession) ||
				!openFabStationProposalReviewSessionMatchesProposal(
					suppliedDraftSession,
					capturedInput.proposal,
				)
			) {
				revokeCapturedInputAuthorities(capturedEnvelope);
				throw fixedBridgeError("Station proposal review session source is invalid.");
			}
			draftSessionRevision = suppliedDraftSession.getSummary().revision;
		}
		let initiallyAborted: boolean;
		try {
			initiallyAborted = readSignalAborted(signal);
		} catch {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw fixedBridgeError("Station proposal review cancellation state could not be read.");
		}
		if (!this.isUnownedEntryCurrent(epoch)) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw new OpenFabStationProposalReviewCancelledError();
		}
		if (initiallyAborted) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw new OpenFabStationProposalReviewCancelledError();
		}
		let currentGeneration: number;
		try {
			currentGeneration = capturedInput.getGeneration();
		} catch {
			revokeCapturedInputAuthorities(capturedEnvelope);
			if (!this.isUnownedEntryCurrent(epoch)) {
				throw new OpenFabStationProposalReviewCancelledError();
			}
			throw fixedBridgeError("Station proposal review generation could not be read.");
		}
		if (!this.isUnownedEntryCurrent(epoch)) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw new OpenFabStationProposalReviewCancelledError();
		}
		if (
			!isPositiveSafeInteger(capturedInput.generation) ||
			currentGeneration !== capturedInput.generation
		) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw fixedBridgeError("Station proposal review generation is stale before preparation.");
		}
		if (!draftSessionRevisionIsCurrent(suppliedDraftSession, draftSessionRevision)) {
			revokeCapturedInputAuthorities(capturedEnvelope);
			throw fixedBridgeError("Station proposal review session changed before preparation.");
		}
		const controller = new AbortController();
		const preparation: PreparationState = {
			epoch,
			controller,
			snapshot: capturedInput.snapshot,
			draftSession: suppliedDraftSession,
			draftSessionRevision,
			proposalCapture: null,
			draftSnapshot: suppliedDraftSnapshot,
			externalSignal: signal ?? null,
			externalAbortListener: null,
		};
		this.preparation = preparation;
		try {
			try {
				this.attachPreparationAbort(preparation);
			} catch {
				throw fixedBridgeError("Station proposal review cancellation could not be observed.");
			}
			const cooperativeCheckpoint = async (): Promise<void> => {
				this.assertPreparationCurrent(preparation, capturedInput);
				await this.checkpoint(controller.signal);
				this.assertPreparationCurrent(preparation, capturedInput);
			};
			preparation.proposalCapture = await captureOpenFabStationProposalArtifactCooperatively(
				capturedInput.proposal,
				{
					checkpoint: cooperativeCheckpoint,
					signal: controller.signal,
					now: this.now,
					sliceMilliseconds: this.sliceMilliseconds,
				},
			);
			if (preparation.draftSnapshot === null) {
				if (suppliedDraftSession !== null) {
					preparation.draftSnapshot = await suppliedDraftSession.captureDraftSnapshotCooperatively({
						checkpoint: cooperativeCheckpoint,
						revision: () => this.readPreparationGeneration(capturedInput),
						signal: controller.signal,
						now: this.now,
						sliceMilliseconds: this.sliceMilliseconds,
					});
				} else {
					if (suppliedObjectDraft === null) {
						throw fixedBridgeError("Station proposal review Draft input is unavailable.");
					}
					preparation.draftSnapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
						suppliedObjectDraft,
						capturedInput.proposal.rowCount,
						{
							checkpoint: cooperativeCheckpoint,
							revision: () => this.readPreparationGeneration(capturedInput),
							signal: controller.signal,
							now: this.now,
							sliceMilliseconds: this.sliceMilliseconds,
						},
					);
				}
			}
			this.assertPreparationCurrent(preparation, capturedInput);

			let worker: OpenFabStationProposalReviewWorkerPort;
			try {
				worker = this.createWorker();
			} catch {
				throw fixedBridgeError("Station proposal review Worker could not be created.");
			}
			try {
				this.assertPreparationCurrent(preparation, capturedInput);
			} catch (error) {
				terminateWorker(worker);
				throw error;
			}
			const evaluationRequestId = this.issueRequestId();
			let prepared: ReturnType<typeof prepareOpenFabStationProposalReviewEvaluationTransfer>;
			try {
				prepared = prepareOpenFabStationProposalReviewEvaluationTransfer({
					document: capturedInput.document,
					proposalFacade: capturedInput.proposal,
					proposalCapture: preparation.proposalCapture,
					draftSnapshot: preparation.draftSnapshot,
					sourceSnapshot: capturedInput.snapshot,
					generation: capturedInput.generation,
					evaluationRequestId,
				});
			} catch (error) {
				terminateWorker(worker);
				throw normalizeBridgeError(error, "Station proposal review permit could not be issued.");
			}
			try {
				// Permit preparation consumes authorities and can call into the genuine live map. A
				// reentrant newer evaluation must win before this older preparation publishes active state.
				this.assertPreparationCurrent(preparation, capturedInput);
			} catch (error) {
				revokeOpenFabStationProposalReviewPermit(prepared.permit);
				terminateWorker(worker);
				throw error;
			}
			preparation.proposalCapture = null;
			preparation.draftSnapshot = null;
			const active: ActiveSession = {
				epoch,
				worker,
				controller,
				document: capturedInput.document,
				generation: capturedInput.generation,
				getGeneration: capturedInput.getGeneration,
				draftSession: preparation.draftSession,
				draftSessionRevision: preparation.draftSessionRevision,
				evaluationRequestId,
				startedAt: 0,
				permit: prepared.permit,
				phase: "evaluating",
				evaluation: null,
				applyRequestId: null,
				applyStartedAt: null,
				pendingResolve: null,
				pendingReject: null,
				timeout: null,
				externalSignal: signal ?? null,
				externalAbortListener: preparation.externalAbortListener,
				applySignal: null,
				applyAbortListener: null,
				workerTerminated: false,
			};
			this.active = active;
			this.preparation = null;
			try {
				active.startedAt = this.now();
			} catch {
				const error = fixedBridgeError("Station proposal review session could not be started.");
				this.failActive(active, error);
				throw error;
			}
			if (
				this.active !== active ||
				controller.signal.aborted ||
				active.permit === null ||
				this.epoch !== epoch
			) {
				if (active.permit) {
					revokeOpenFabStationProposalReviewPermit(active.permit);
					active.permit = null;
				}
				this.finishActive(active);
				throw new OpenFabStationProposalReviewCancelledError();
			}
			try {
				this.installWorkerHandlers(active);
			} catch {
				this.failActive(active, new Error("Station proposal review session could not be started."));
				throw fixedBridgeError("Station proposal review session could not be started.");
			}
			let externallyAborted: boolean;
			try {
				externallyAborted = readSignalAborted(signal);
			} catch {
				const error = fixedBridgeError(
					"Station proposal review cancellation state could not be read.",
				);
				this.failActive(active, error);
				throw error;
			}
			if (
				this.active !== active ||
				controller.signal.aborted ||
				active.permit === null ||
				externallyAborted
			) {
				if (active.permit) {
					revokeOpenFabStationProposalReviewPermit(active.permit);
					active.permit = null;
				}
				this.finishActive(active);
				if (externallyAborted) throw new OpenFabStationProposalReviewCancelledError();
				throw fixedBridgeError("Station proposal review session could not be started.");
			}

			const request: OpenFabStationProposalReviewWorkerRequest = Object.freeze({
				type: "EVALUATE_OPENFAB_STATION_PROPOSAL_REVIEW",
				protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
				requestId: evaluationRequestId,
				generation: capturedInput.generation,
				ticketId: prepared.permit.ticketId,
				proposalSemanticFingerprint: prepared.proposal.semanticFingerprint,
				proposalSnapshotFingerprint: prepared.proposal.snapshotFingerprint,
				draftFingerprint: prepared.draft.fingerprint,
				sourceChecksum: prepared.snapshot.checksum,
				proposal: prepared.proposal,
				draft: prepared.draft,
				snapshot: prepared.snapshot,
			});
			return await new Promise<OpenFabStationProposalReviewBridgeEvaluation>((resolve, reject) => {
				active.pendingResolve = resolve as (value: unknown) => void;
				active.pendingReject = reject;
				try {
					this.startTimeout(active);
					worker.postMessage(request, [...prepared.transfers]);
					if (prepared.transfers.some((buffer) => buffer.byteLength !== 0)) {
						throw new Error("Station proposal review Worker did not consume all input buffers.");
					}
				} catch {
					this.failActive(
						active,
						new Error("Station proposal review request could not be posted."),
					);
				}
			});
		} catch (error) {
			this.cleanupPreparation(preparation);
			throw normalizeCancellation(error);
		}
	}

	apply(
		evaluation: OpenFabStationProposalReviewBridgeEvaluation,
		signal?: AbortSignal,
	): Promise<PreparedOpenFabStationProposalReviewApply> {
		const active = this.active;
		if (
			!active ||
			active.phase !== "ready" ||
			active.evaluation !== evaluation ||
			!evaluation.canApply ||
			active.permit === null
		) {
			return Promise.reject(new Error("Station proposal review is not ready for Apply."));
		}
		let initiallyAborted: boolean;
		try {
			initiallyAborted = readSignalAborted(signal);
		} catch {
			const error = fixedBridgeError(
				"Station proposal review Apply cancellation state could not be read.",
			);
			this.failActive(active, error);
			return Promise.reject(error);
		}
		if (initiallyAborted) {
			return Promise.reject(new OpenFabStationProposalReviewCancelledError());
		}
		const applyRequestId = this.issueRequestId();
		let applyAuthorized = false;
		try {
			const currentGeneration = active.getGeneration();
			if (
				this.active !== active ||
				active.controller.signal.aborted ||
				active.permit === null ||
				active.phase !== "ready"
			) {
				const error = new OpenFabStationProposalReviewCancelledError();
				this.failActive(active, error);
				return Promise.reject(error);
			}
			applyAuthorized =
				currentGeneration === active.generation &&
				draftSessionRevisionIsCurrent(active.draftSession, active.draftSessionRevision) &&
				authorizeOpenFabStationProposalReviewApply(
					active.permit,
					applyRequestId,
					active.generation,
				);
		} catch {
			const error = new Error("Station proposal review generation could not be read before Apply.");
			this.failActive(active, error);
			return Promise.reject(error);
		}
		if (!applyAuthorized) {
			const error = new Error("Station proposal review became stale before Apply.");
			this.failActive(active, error);
			return Promise.reject(error);
		}
		active.phase = "applying";
		active.applyRequestId = applyRequestId;
		try {
			active.applyStartedAt = this.now();
		} catch {
			const error = new Error("Station proposal review Apply session could not be started.");
			this.failActive(active, error);
			return Promise.reject(error);
		}
		if (
			this.active !== active ||
			active.controller.signal.aborted ||
			active.permit === null ||
			active.phase !== "applying"
		) {
			const error = new OpenFabStationProposalReviewCancelledError();
			this.failActive(active, error);
			return Promise.reject(error);
		}
		active.applySignal = signal ?? null;
		if (signal) {
			active.applyAbortListener = () =>
				this.failActive(active, new OpenFabStationProposalReviewCancelledError());
			try {
				signal.addEventListener("abort", active.applyAbortListener, { once: true });
				if (readSignalAborted(signal)) {
					active.applyAbortListener();
					return Promise.reject(new OpenFabStationProposalReviewCancelledError());
				}
			} catch {
				const error = new Error(
					"Station proposal review Apply cancellation could not be observed.",
				);
				this.failActive(active, error);
				return Promise.reject(error);
			}
			if (
				this.active !== active ||
				active.controller.signal.aborted ||
				active.permit === null ||
				active.phase !== "applying"
			) {
				return Promise.reject(new OpenFabStationProposalReviewCancelledError());
			}
		}
		const preview = evaluation.preview;
		if (preview.reviewFingerprint === null) {
			this.failActive(active, new Error("Station proposal review READY evidence is incomplete."));
			return Promise.reject(new Error("Station proposal review READY evidence is incomplete."));
		}
		const request: OpenFabStationProposalReviewWorkerRequest = Object.freeze({
			type: "APPLY_OPENFAB_STATION_PROPOSAL_REVIEW",
			protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
			requestId: applyRequestId,
			generation: active.generation,
			ticketId: active.permit.ticketId,
			evaluationRequestId: active.evaluationRequestId,
			evaluationSnapshotFingerprint: preview.snapshotFingerprint,
			reviewFingerprint: preview.reviewFingerprint,
		});
		return new Promise((resolve, reject) => {
			active.pendingResolve = resolve as (value: unknown) => void;
			active.pendingReject = reject;
			try {
				this.startTimeout(active);
				active.worker.postMessage(request);
			} catch {
				this.failActive(active, new Error("Station proposal review Apply could not be posted."));
			}
		});
	}

	cancel(): void {
		this.epoch++;
		if (this.preparation) {
			const preparation = this.preparation;
			this.preparation = null;
			preparation.controller.abort();
			this.cleanupPreparation(preparation);
		}
		if (this.active) this.failActive(this.active, new OpenFabStationProposalReviewCancelledError());
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel();
	}

	private async receive(active: ActiveSession, value: unknown): Promise<void> {
		if (this.active !== active) return;
		active.worker.onmessage = null;
		let response: ParsedResponse;
		try {
			response = parseResponse(value);
		} catch (error) {
			this.failActive(
				active,
				normalizeBridgeError(error, "Station proposal review response is invalid."),
			);
			return;
		}
		if (response.type === "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR") {
			if (!errorResponseMatchesActiveRequest(active, response)) {
				this.failActive(active, new Error("Station proposal review error correlation changed."));
			} else {
				this.failActive(active, new Error(response.message));
			}
			return;
		}
		if (active.phase === "evaluating") {
			await this.receiveEvaluation(active, response);
			return;
		}
		if (active.phase === "applying") {
			await this.receivePlan(active, response);
			return;
		}
		this.failActive(
			active,
			new Error("Station proposal review Worker sent an unexpected response."),
		);
	}

	private async receiveEvaluation(active: ActiveSession, response: ParsedResponse): Promise<void> {
		if (
			response.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED" ||
			active.permit === null ||
			response.requestId !== active.evaluationRequestId ||
			response.generation !== active.generation ||
			response.ticketId !== active.permit.ticketId
		) {
			this.failActive(active, new Error("Station proposal review evaluation correlation changed."));
			return;
		}
		this.clearTimeout(active);
		let preview: HydratedOpenFabStationProposalReviewEvaluationPreview;
		try {
			preview = await hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
				response.evaluation,
				{
					checkpoint: () => this.mainCheckpoint(active),
					revision: () => {
						this.assertActiveCurrent(active);
						return active.generation;
					},
					signal: active.controller.signal,
					now: this.now,
					sliceMilliseconds: this.sliceMilliseconds,
				},
			);
		} catch (error) {
			this.failActive(
				active,
				normalizeCancellationOrFixed(
					error,
					"Station proposal review evaluation could not be adopted.",
				),
			);
			return;
		}
		try {
			this.assertActiveCurrent(active);
		} catch (error) {
			this.failActive(
				active,
				normalizeCancellationOrFixed(
					error,
					"Station proposal review became stale during adoption.",
				),
			);
			return;
		}
		const receipt = {
			evaluationRequestId: response.requestId,
			generation: response.generation,
			ticketId: response.ticketId,
			proposalSemanticFingerprint: response.proposalSemanticFingerprint,
			proposalSnapshotFingerprint: response.proposalSnapshotFingerprint,
			draftFingerprint: response.draftFingerprint,
			sourceChecksum: response.sourceChecksum,
		};
		const canApply =
			preview.state === "READY" &&
			armOpenFabStationProposalReviewPermit(active.permit, preview, receipt);
		const evaluation = Object.freeze({
			kind: "openfab-station-proposal-review-bridge-evaluation" as const,
			generation: active.generation,
			evaluationRequestId: active.evaluationRequestId,
			preview,
			canApply,
		});
		active.evaluation = evaluation;
		if (canApply) {
			active.phase = "ready";
			this.installWorkerHandlers(active);
			const resolve = active.pendingResolve;
			active.pendingResolve = null;
			active.pendingReject = null;
			resolve?.(evaluation);
			return;
		}
		revokeOpenFabStationProposalReviewPermit(active.permit);
		active.permit = null;
		const resolve = active.pendingResolve;
		active.pendingResolve = null;
		active.pendingReject = null;
		this.finishActive(active);
		resolve?.(evaluation);
	}

	private async receivePlan(active: ActiveSession, response: ParsedResponse): Promise<void> {
		if (
			response.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED" ||
			active.permit === null ||
			active.applyRequestId === null ||
			response.requestId !== active.applyRequestId ||
			response.generation !== active.generation ||
			response.ticketId !== active.permit.ticketId
		) {
			this.failActive(active, new Error("Station proposal review plan correlation changed."));
			return;
		}
		this.clearTimeout(active);
		this.terminateWorkerOnly(active);
		active.phase = "adopting";
		const adoptionStartedAt = this.now();
		let adopted: AdoptedOpenFabStationProposalReviewedPlanArtifact | null = null;
		let issuedApply: ReviewedPortEquipmentApply | null = null;
		try {
			adopted = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
				response.planArtifact,
				{
					checkpoint: () => this.mainCheckpoint(active),
					revision: () => {
						this.assertActiveCurrent(active);
						return active.generation;
					},
					signal: active.controller.signal,
					now: this.now,
					sliceMilliseconds: this.sliceMilliseconds,
				},
			);
			const adoptionFinishedAt = this.now();
			const workerRoundTripMilliseconds =
				adoptionStartedAt - (active.applyStartedAt ?? active.startedAt);
			const adoptionMilliseconds = adoptionFinishedAt - adoptionStartedAt;
			this.assertActiveCurrent(active);
			const materialized = await materializeOpenFabStationProposalReviewedApplyCooperatively(
				active.permit,
				adopted,
				response.ticket as OpenFabStationProposalReviewWorkerTicket,
				active.document,
				active.generation,
				{
					checkpoint: () => this.mainCheckpoint(active),
					revision: () => {
						this.assertActiveCurrent(active);
						return active.generation;
					},
					signal: active.controller.signal,
					now: this.now,
					sliceMilliseconds: this.sliceMilliseconds,
				},
			);
			issuedApply = materialized.apply;
			adopted = null;
			this.assertActiveCurrent(active);
			active.permit = null;
			const adoptionAndMaterializationMilliseconds =
				adoptionMilliseconds + materialized.timings.totalMilliseconds;
			const result = Object.freeze({
				kind: "prepared-openfab-station-proposal-review-apply" as const,
				apply: issuedApply,
				generation: active.generation,
				evaluationRequestId: active.evaluationRequestId,
				applyRequestId: active.applyRequestId,
				workerRoundTripMilliseconds,
				adoptionMilliseconds,
				materialization: materialized.timings,
				adoptionAndMaterializationMilliseconds,
			});
			const resolve = active.pendingResolve;
			active.pendingResolve = null;
			active.pendingReject = null;
			this.finishActive(active);
			issuedApply = null;
			resolve?.(result);
		} catch (error) {
			if (adopted) revokeAdoptedOpenFabStationProposalReviewedPlanArtifact(adopted);
			if (issuedApply) revokeReviewedPortEquipmentApply(issuedApply);
			let normalized = normalizeCancellationOrFixed(
				error,
				"Station proposal review plan could not be materialized.",
			);
			try {
				this.assertActiveCurrent(active);
			} catch {
				normalized = new OpenFabStationProposalReviewCancelledError();
			}
			this.failActive(active, normalized);
		}
	}

	private installWorkerHandlers(active: ActiveSession): void {
		active.worker.onmessage = (event) => {
			void this.receive(active, event.data).catch(() => {
				this.failActive(active, new Error("Station proposal review response handling failed."));
			});
		};
		active.worker.onerror = () =>
			this.failActive(active, new Error("Station proposal review Worker failed."));
		active.worker.onmessageerror = () =>
			this.failActive(active, new Error("Station proposal review Worker response was unreadable."));
	}

	private attachPreparationAbort(preparation: PreparationState): void {
		const signal = preparation.externalSignal;
		if (!signal) return;
		preparation.externalAbortListener = () => {
			if (this.preparation === preparation) preparation.controller.abort();
			if (this.active?.epoch === preparation.epoch) {
				this.failActive(this.active, new OpenFabStationProposalReviewCancelledError());
			}
		};
		signal.addEventListener("abort", preparation.externalAbortListener, { once: true });
		if (signal.aborted) preparation.externalAbortListener();
	}

	private detachPreparationAbort(preparation: PreparationState): void {
		if (preparation.externalSignal && preparation.externalAbortListener) {
			try {
				preparation.externalSignal.removeEventListener("abort", preparation.externalAbortListener);
			} catch {
				// Cleanup must still revoke every prepared authority for a hostile signal adapter.
			}
		}
	}

	private assertPreparationCurrent(
		preparation: PreparationState,
		input: OpenFabStationProposalReviewBridgeInput,
	): void {
		if (this.preparation !== preparation || preparation.controller.signal.aborted) {
			throw new OpenFabStationProposalReviewCancelledError();
		}
		const generation = this.readPreparationGeneration(input);
		if (
			this.preparation !== preparation ||
			preparation.controller.signal.aborted ||
			generation !== input.generation ||
			!draftSessionRevisionIsCurrent(preparation.draftSession, preparation.draftSessionRevision)
		) {
			throw new OpenFabStationProposalReviewCancelledError();
		}
	}

	private readPreparationGeneration(input: OpenFabStationProposalReviewBridgeInput): number {
		try {
			return input.getGeneration();
		} catch {
			throw fixedBridgeError(
				"Station proposal review generation could not be read during preparation.",
			);
		}
	}

	private cleanupPreparation(preparation: PreparationState): void {
		this.detachPreparationAbort(preparation);
		if (preparation.proposalCapture) {
			revokeOpenFabStationProposalArtifactCaptureAuthority(preparation.proposalCapture);
			preparation.proposalCapture = null;
		}
		if (preparation.draftSnapshot) {
			revokeEncodedOpenFabStationProposalReviewDraftSnapshot(preparation.draftSnapshot);
			preparation.draftSnapshot = null;
		}
		revokeRailMirrorSnapshotCaptureAuthority(preparation.snapshot);
		if (this.preparation === preparation) this.preparation = null;
	}

	private async mainCheckpoint(active: ActiveSession): Promise<void> {
		this.assertActiveCurrent(active);
		await this.checkpoint(active.controller.signal);
		this.assertActiveCurrent(active);
	}

	private assertActiveCurrent(active: ActiveSession): void {
		if (this.active !== active || active.controller.signal.aborted) {
			throw new OpenFabStationProposalReviewCancelledError();
		}
		const generation = active.getGeneration();
		if (
			this.active !== active ||
			active.controller.signal.aborted ||
			generation !== active.generation ||
			!draftSessionRevisionIsCurrent(active.draftSession, active.draftSessionRevision)
		) {
			throw new OpenFabStationProposalReviewCancelledError();
		}
	}

	private startTimeout(active: ActiveSession): void {
		this.clearTimeout(active);
		active.timeout = globalThis.setTimeout(() => {
			this.failActive(
				active,
				new Error(`Station proposal review Worker timed out after ${this.timeoutMilliseconds} ms.`),
			);
		}, this.timeoutMilliseconds);
	}

	private clearTimeout(active: ActiveSession): void {
		if (active.timeout !== null) globalThis.clearTimeout(active.timeout);
		active.timeout = null;
	}

	private failActive(active: ActiveSession, error: Error): void {
		if (this.active !== active) return;
		trustBridgeError(error);
		const reject = active.pendingReject;
		active.pendingResolve = null;
		active.pendingReject = null;
		if (active.permit) {
			revokeOpenFabStationProposalReviewPermit(active.permit);
			active.permit = null;
		}
		this.finishActive(active);
		reject?.(error);
	}

	private finishActive(active: ActiveSession): void {
		if (this.active === active) this.active = null;
		this.clearTimeout(active);
		active.controller.abort();
		if (active.externalSignal && active.externalAbortListener) {
			try {
				active.externalSignal.removeEventListener("abort", active.externalAbortListener);
			} catch {
				// Cleanup continues even if a non-native signal adapter rejects listener removal.
			}
		}
		if (active.applySignal && active.applyAbortListener) {
			try {
				active.applySignal.removeEventListener("abort", active.applyAbortListener);
			} catch {
				// Cleanup continues even if a non-native signal adapter rejects listener removal.
			}
		}
		this.terminateWorkerOnly(active);
	}

	private terminateWorkerOnly(active: ActiveSession): void {
		if (active.workerTerminated) {
			detachWorkerHandlers(active.worker);
			return;
		}
		active.workerTerminated = true;
		terminateWorker(active.worker);
	}

	private issueRequestId(): number {
		const requestId = this.nextRequestId;
		this.nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
		return requestId;
	}

	private isUnownedEntryCurrent(epoch: number): boolean {
		return (
			!this.disposed && this.epoch === epoch && this.preparation === null && this.active === null
		);
	}
}

function parseResponse(value: unknown): ParsedResponse {
	const record = captureOwnDataRecord(value);
	if (!record) throw new Error("Station proposal review response is not an own-data object.");
	const expectedKeys =
		record.type === "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED"
			? EVALUATED_RESPONSE_KEYS
			: record.type === "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED"
				? PLAN_RESPONSE_KEYS
				: record.type === "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR"
					? ERROR_RESPONSE_KEYS
					: null;
	if (!expectedKeys || !hasExactKeys(record, expectedKeys)) {
		throw new Error("Station proposal review response fields are malformed.");
	}
	if (
		record.protocolVersion !== OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION ||
		!isPositiveSafeInteger(record.requestId) ||
		!isPositiveSafeInteger(record.generation) ||
		!isPositiveSafeInteger(record.ticketId)
	) {
		throw new Error("Station proposal review response correlation is malformed.");
	}
	if (record.type === "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR") {
		if (
			!OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_ERROR_CODES.includes(
				record.code as OpenFabStationProposalReviewWorkerErrorCode,
			) ||
			typeof record.message !== "string" ||
			record.message.length === 0 ||
			record.message.length > OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_MAX_ERROR_MESSAGE_LENGTH ||
			record.message !==
				openFabStationProposalReviewWorkerErrorMessage(
					record.code as OpenFabStationProposalReviewWorkerErrorCode,
				)
		) {
			throw new Error("Station proposal review Worker error is malformed.");
		}
	}
	return record as unknown as ParsedResponse;
}

function captureOwnDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	try {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => typeof key !== "string")) return null;
		const captured = Object.create(null) as Record<string, unknown>;
		for (const key of keys as string[]) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			Object.defineProperty(captured, key, {
				value: descriptor.value,
				enumerable: true,
				configurable: false,
				writable: false,
			});
		}
		return Object.freeze(captured);
	} catch {
		return null;
	}
}

function hasExactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value);
	return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function errorResponseMatchesActiveRequest(
	active: ActiveSession,
	response: ParsedErrorResponse,
): boolean {
	const requestId =
		active.phase === "evaluating"
			? active.evaluationRequestId
			: active.phase === "applying"
				? active.applyRequestId
				: null;
	return (
		requestId !== null &&
		active.permit !== null &&
		response.requestId === requestId &&
		response.generation === active.generation &&
		response.ticketId === active.permit.ticketId
	);
}

function terminateWorker(worker: OpenFabStationProposalReviewWorkerPort): void {
	detachWorkerHandlers(worker);
	try {
		worker.terminate();
	} catch {
		// Cleanup failure cannot preserve a permit or pending bridge promise.
	}
}

function captureBridgeInputEnvelope(value: unknown): CapturedBridgeInputEnvelope {
	const railSnapshotAuthorities: unknown[] = [];
	const draftSnapshotAuthorities: unknown[] = [];
	const envelope = (
		input: OpenFabStationProposalReviewBridgeInput | null,
	): CapturedBridgeInputEnvelope =>
		Object.freeze({
			input,
			railSnapshotAuthorities: Object.freeze([...railSnapshotAuthorities]),
			draftSnapshotAuthorities: Object.freeze([...draftSnapshotAuthorities]),
		});
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return envelope(null);
		}
		const snapshotCapture = captureStableAuthorityDescriptor(
			value,
			"snapshot",
			railSnapshotAuthorities,
		);
		const draftSnapshotCapture = captureStableAuthorityDescriptor(
			value,
			"draftSnapshot",
			draftSnapshotAuthorities,
		);
		const prototype = Object.getPrototypeOf(value);
		const actualKeys = Reflect.ownKeys(value);
		const hasNonStringKey = actualKeys.some((key) => typeof key !== "string");
		const actualStringKeys = actualKeys.filter((key): key is string => typeof key === "string");
		const descriptors = new Map<string, PropertyDescriptor>();
		let descriptorsAreExactData = true;
		for (const key of actualStringKeys) {
			let descriptor: PropertyDescriptor | undefined;
			if (key === "snapshot") {
				descriptor = snapshotCapture.descriptor;
				if (!snapshotCapture.succeeded) descriptorsAreExactData = false;
			} else if (key === "draftSnapshot") {
				descriptor = draftSnapshotCapture.descriptor;
				if (!draftSnapshotCapture.succeeded) descriptorsAreExactData = false;
			} else {
				const captured = captureOwnDescriptorBestEffort(value, key);
				descriptor = captured.descriptor;
				if (!captured.succeeded) descriptorsAreExactData = false;
			}
			if (!descriptor) {
				descriptorsAreExactData = false;
				continue;
			}
			descriptors.set(key, descriptor);
			if (!descriptor.enumerable || !("value" in descriptor)) descriptorsAreExactData = false;
		}
		const actualKeySet = new Set(actualStringKeys);
		const matches = (expected: readonly string[]): boolean =>
			actualStringKeys.length === expected.length && expected.every((key) => actualKeySet.has(key));
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			hasNonStringKey ||
			!descriptorsAreExactData ||
			(!matches(BRIDGE_OBJECT_DRAFT_INPUT_KEYS) &&
				!matches(BRIDGE_SNAPSHOT_DRAFT_INPUT_KEYS) &&
				!matches(BRIDGE_SESSION_DRAFT_INPUT_KEYS))
		) {
			return envelope(null);
		}
		const captured = Object.create(null) as Record<string, unknown>;
		for (const key of actualStringKeys) {
			Object.defineProperty(captured, key, {
				value: descriptors.get(key)?.value,
				enumerable: true,
				configurable: false,
				writable: false,
			});
		}
		return envelope(Object.freeze(captured) as unknown as OpenFabStationProposalReviewBridgeInput);
	} catch {
		return envelope(null);
	}
}

function captureStableAuthorityDescriptor(
	value: object,
	key: string,
	authorities: unknown[],
): { readonly succeeded: boolean; readonly descriptor: PropertyDescriptor | undefined } {
	const first = captureOwnDescriptorBestEffort(value, key);
	collectDataDescriptorAuthority(first.descriptor, authorities);
	const second = captureOwnDescriptorBestEffort(value, key);
	collectDataDescriptorAuthority(second.descriptor, authorities);
	return Object.freeze({
		succeeded:
			first.succeeded &&
			second.succeeded &&
			propertyDescriptorsAreEquivalent(first.descriptor, second.descriptor),
		descriptor: second.descriptor,
	});
}

function collectDataDescriptorAuthority(
	descriptor: PropertyDescriptor | undefined,
	authorities: unknown[],
): void {
	if (!descriptor || !("value" in descriptor)) return;
	if (!authorities.some((authority) => Object.is(authority, descriptor.value))) {
		authorities.push(descriptor.value);
	}
}

function propertyDescriptorsAreEquivalent(
	left: PropertyDescriptor | undefined,
	right: PropertyDescriptor | undefined,
): boolean {
	if (left === undefined || right === undefined) return left === right;
	if (left.enumerable !== right.enumerable || left.configurable !== right.configurable)
		return false;
	const leftIsData = "value" in left;
	const rightIsData = "value" in right;
	if (leftIsData !== rightIsData) return false;
	return leftIsData && rightIsData
		? Object.is(left.value, right.value) && left.writable === right.writable
		: left.get === right.get && left.set === right.set;
}

function captureOwnDescriptorBestEffort(
	value: object,
	key: string,
): { readonly succeeded: boolean; readonly descriptor: PropertyDescriptor | undefined } {
	try {
		return Object.freeze({
			succeeded: true,
			descriptor: Object.getOwnPropertyDescriptor(value, key),
		});
	} catch {
		return Object.freeze({ succeeded: false, descriptor: undefined });
	}
}

function revokeCapturedInputAuthorities(envelope: CapturedBridgeInputEnvelope): void {
	for (const authority of envelope.draftSnapshotAuthorities) {
		revokeEncodedOpenFabStationProposalReviewDraftSnapshot(
			authority as OpenFabStationProposalReviewDraftSnapshot,
		);
	}
	for (const authority of envelope.railSnapshotAuthorities) {
		revokeRailMirrorSnapshotCaptureAuthority(authority as RailMirrorSnapshot);
	}
}

function draftSessionRevisionIsCurrent(
	session: OpenFabStationProposalReviewSession | null,
	revision: number | null,
): boolean {
	return session === null
		? revision === null
		: revision !== null && session.getSummary().revision === revision;
}

function detachWorkerHandlers(worker: OpenFabStationProposalReviewWorkerPort): void {
	try {
		worker.onmessage = null;
	} catch {
		// Continue best-effort cleanup for a hostile Worker adapter.
	}
	try {
		worker.onerror = null;
	} catch {
		// Continue best-effort cleanup for a hostile Worker adapter.
	}
	try {
		worker.onmessageerror = null;
	} catch {
		// Continue best-effort cleanup for a hostile Worker adapter.
	}
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalizeBridgeError(error: unknown, fallback: string): Error {
	return isTrustedBridgeError(error) ? error : fixedBridgeError(fallback);
}

function normalizeCancellation(error: unknown): Error {
	if (isAbortErrorSafely(error)) {
		return new OpenFabStationProposalReviewCancelledError();
	}
	return isTrustedBridgeError(error) ? error : fixedBridgeError("Station proposal review failed.");
}

function normalizeCancellationOrFixed(error: unknown, fallback: string): Error {
	if (isAbortErrorSafely(error)) {
		return new OpenFabStationProposalReviewCancelledError();
	}
	return fixedBridgeError(fallback);
}

function fixedBridgeError(message: string): Error {
	const error = new Error(message);
	trustedBridgeErrors.add(error);
	return error;
}

function trustBridgeError(error: Error): void {
	trustedBridgeErrors.add(error);
}

function isTrustedBridgeError(error: unknown): error is Error {
	return typeof error === "object" && error !== null && trustedBridgeErrors.has(error);
}

function isAbortErrorSafely(error: unknown): boolean {
	try {
		return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
	} catch {
		return false;
	}
}

function readSignalAborted(signal: AbortSignal | undefined): boolean {
	if (!signal) return false;
	return signal.aborted;
}

function nextMainTask(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(new OpenFabStationProposalReviewCancelledError());
	return new Promise((resolve, reject) => {
		const abort = (): void => {
			globalThis.clearTimeout(timeout);
			reject(new OpenFabStationProposalReviewCancelledError());
		};
		const timeout = globalThis.setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, 0);
		signal.addEventListener("abort", abort, { once: true });
	});
}
