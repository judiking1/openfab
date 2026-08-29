import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	adoptStaticFabArrangementWorkerPlan,
	issueStaticFabArrangementPermit,
	revokeStaticFabArrangementPermit,
	type StaticFabArrangementPermit,
} from "../core/StaticFabArrangementCertification";
import {
	prepareStaticFabArrangementCommand,
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "../core/StaticFabArrangementCommand";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabArrangement,
	STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
	type StaticFabArrangementSessionSourceIdentity,
	type StaticFabArrangementWorkerRequest,
	type StaticFabArrangementWorkerResponse,
} from "../worker/StaticFabArrangementProtocol";
import { staticFabArrangementPreparedShapeError } from "../worker/StaticFabArrangementResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabArrangementWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabArrangementWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabArrangementWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabArrangementLiveState {
	readonly map: TileMap;
	readonly patchSequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface StaticFabArrangementSessionInput {
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentState: () => StaticFabArrangementLiveState;
}

export interface StaticFabArrangementInput {
	readonly intent: StaticFabArrangementCommandIntent;
}

export interface ValidatedStaticFabArrangement {
	readonly plan: StaticFabArrangementPlan | null;
	readonly validation: PreparedStaticFabArrangement;
	readonly certified: boolean;
	readonly workerRoundTripMilliseconds: number;
	readonly responseValidationMilliseconds: number;
	readonly adoptionMilliseconds: number;
	readonly sessionHydrationMilliseconds: number;
	readonly sessionCompilationMilliseconds: number;
	readonly sourcePlanIndex: number;
}

type SessionPhase = "idle" | "initializing" | "ready";

interface SessionSourceBinding {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly getCurrentState: () => StaticFabArrangementLiveState;
	readonly identity: StaticFabArrangementSessionSourceIdentity;
}

interface PendingArrangementRequest {
	readonly requestId: number;
	readonly permit: StaticFabArrangementPermit;
	readonly intent: StaticFabArrangementCommandIntent;
	readonly expectedIntentFingerprint: string;
	readonly resolve: (result: ValidatedStaticFabArrangement) => void;
	readonly reject: (error: Error) => void;
	posted: boolean;
	sourcePlanIndex: number;
	requestStartedAt: number;
}

/** Reusable source-bound adapter with fresh one-shot certification for every option intent. */
export class StaticFabArrangementBridge {
	private readonly createWorker: () => StaticFabArrangementWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabArrangementWorkerPort | null = null;
	private phase: SessionPhase = "idle";
	private source: SessionSourceBinding | null = null;
	private pending: PendingArrangementRequest | null = null;
	private readonly ignoredRequests = new Map<number, number>();
	private inFlightRequestId: number | null = null;
	private initializationTimeout: ReturnType<typeof setTimeout> | null = null;
	private requestTimeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;
	private nextSessionId = 1;
	private sessionId = 0;
	private initializationRequestId = 0;
	private postedPlanCount = 0;
	private sessionHydrationMilliseconds = 0;
	private sessionCompilationMilliseconds = 0;

	constructor(
		createWorker: () => StaticFabArrangementWorkerPort = () =>
			new Worker(new URL("../worker/staticFabArrangementWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabArrangementWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	startSession(input: StaticFabArrangementSessionInput): void {
		this.dispose();
		const live = input.getCurrentState();
		if (!snapshotMatchesLiveState(input.snapshot, live)) {
			throw new Error("Static FAB arrangement snapshot is stale before session initialization.");
		}
		if (
			!consumeRailMirrorSnapshotCaptureAuthority(
				input.snapshot,
				live.map,
				live.patchSequence,
				live.portEquipment,
				live.organizations,
			)
		) {
			throw new Error("Static FAB arrangement snapshot lacks current authored capture authority.");
		}

		const source: SessionSourceBinding = Object.freeze({
			map: live.map,
			portEquipment: live.portEquipment,
			organizations: live.organizations,
			getCurrentState: input.getCurrentState,
			identity: sourceIdentityFromSnapshot(input.snapshot),
		});
		let worker: StaticFabArrangementWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			throw workerError(error, "Static FAB arrangement Worker creation failed.");
		}

		this.worker = worker;
		this.source = source;
		this.phase = "initializing";
		this.sessionId = this.issueSessionId();
		this.initializationRequestId = this.issueRequestId();
		this.postedPlanCount = 0;
		this.sessionHydrationMilliseconds = 0;
		this.sessionCompilationMilliseconds = 0;
		worker.onmessage = (event) => this.handleMessage(event);
		worker.onerror = (event) => {
			this.failSession(new Error(event.message || "Static FAB arrangement Worker failed."));
		};
		worker.onmessageerror = () => {
			this.failSession(new Error("Static FAB arrangement Worker returned an unreadable response."));
		};

		const request: StaticFabArrangementWorkerRequest = {
			type: "INITIALIZE_STATIC_FAB_ARRANGEMENT_SESSION",
			version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
			sessionId: this.sessionId,
			requestId: this.initializationRequestId,
			snapshot: input.snapshot,
		};
		this.initializationTimeout = setTimeout(() => {
			this.failSession(
				new Error(
					`Static FAB arrangement Worker initialization timed out after ${this.timeoutMilliseconds} ms.`,
				),
			);
		}, this.timeoutMilliseconds);
		try {
			worker.postMessage(request, collectTransferableBuffers(input.snapshot));
		} catch (error) {
			const failure = workerError(
				error,
				"Static FAB arrangement Worker initialization post failed.",
			);
			this.failSession(failure);
			throw failure;
		}
	}

	prepare(input: StaticFabArrangementInput): Promise<ValidatedStaticFabArrangement> {
		const preparedIntent = prepareStaticFabArrangementCommand(input.intent);
		if (!preparedIntent.valid) return Promise.reject(new Error(preparedIntent.reason));
		const source = this.source;
		if (!source || !this.worker || this.phase === "idle") {
			return Promise.reject(new Error("Static FAB arrangement Worker session is not initialized."));
		}
		if (!sessionSourceMatchesLiveState(source)) {
			const failure = new Error("Static FAB arrangement source changed during the Worker session.");
			this.failSession(failure);
			return Promise.reject(failure);
		}
		this.cancelPending();

		const intent = preparedIntent.intent;
		const live = source.getCurrentState();
		const expectedIntentFingerprint = staticFabArrangementCommandFingerprint(intent);
		const permit = issueStaticFabArrangementPermit(
			live.map,
			live.portEquipment,
			live.patchSequence,
			live.organizations,
			intent,
			source.identity.checksum,
		);
		const requestId = this.issueRequestId();
		return new Promise((resolve, reject) => {
			this.pending = {
				requestId,
				permit,
				intent,
				expectedIntentFingerprint,
				resolve,
				reject,
				posted: false,
				sourcePlanIndex: 0,
				requestStartedAt: 0,
			};
			if (this.phase === "ready") this.postPending();
		});
	}

	cancelPending(): void {
		const pending = this.pending;
		if (!pending) return;
		this.pending = null;
		if (pending.posted) this.ignoredRequests.set(pending.requestId, pending.sourcePlanIndex);
		revokeStaticFabArrangementPermit(pending.permit);
		pending.reject(cancelledError());
	}

	cancel(): void {
		this.dispose();
	}

	dispose(): void {
		this.closeSession(cancelledError());
	}

	private handleMessage(event: MessageEvent<StaticFabArrangementWorkerResponse>): void {
		const response = event.data as unknown;
		if (
			!isRecord(response) ||
			response.version !== STATIC_FAB_ARRANGEMENT_SESSION_VERSION ||
			response.sessionId !== this.sessionId ||
			!positiveSafeInteger(response.requestId)
		) {
			this.failSession(new Error("Static FAB arrangement Worker returned a malformed envelope."));
			return;
		}
		if (response.type === "STATIC_FAB_ARRANGEMENT_ERROR") {
			this.handleError(response);
			return;
		}
		if (response.type === "STATIC_FAB_ARRANGEMENT_SESSION_READY") {
			this.handleSessionReady(response);
			return;
		}
		if (response.type !== "STATIC_FAB_ARRANGEMENT_PREPARED") {
			this.failSession(new Error("Static FAB arrangement Worker returned an unknown response."));
			return;
		}
		this.handlePrepared(response);
	}

	private handleSessionReady(response: Record<string, unknown>): void {
		const source = this.source;
		if (
			this.phase !== "initializing" ||
			response.requestId !== this.initializationRequestId ||
			!source ||
			!sameSourceIdentity(response.source, source.identity) ||
			!nonNegativeFinite(response.hydrationMilliseconds) ||
			!nonNegativeFinite(response.compilationMilliseconds)
		) {
			this.failSession(new Error("Static FAB arrangement Worker returned malformed session data."));
			return;
		}
		if (!sessionSourceMatchesLiveState(source)) {
			this.failSession(new Error("Static FAB arrangement source changed during initialization."));
			return;
		}
		this.clearInitializationTimeout();
		this.sessionHydrationMilliseconds = response.hydrationMilliseconds as number;
		this.sessionCompilationMilliseconds = response.compilationMilliseconds as number;
		this.phase = "ready";
		this.postPending();
	}

	private handleError(response: Record<string, unknown>): void {
		const requestId = response.requestId as number;
		const message =
			typeof response.message === "string" && response.message.length > 0 ? response.message : null;
		const ignoredPlanIndex = this.ignoredRequests.get(requestId);
		if (ignoredPlanIndex !== undefined) {
			if (
				this.inFlightRequestId !== requestId ||
				response.sourcePlanIndex !== ignoredPlanIndex ||
				!message
			) {
				this.failSession(
					new Error("Static FAB arrangement Worker returned a malformed stale error."),
				);
				return;
			}
			this.ignoredRequests.delete(requestId);
			this.inFlightRequestId = null;
			this.clearRequestTimeout();
			this.postPending();
			return;
		}
		this.failSession(
			new Error(message ?? "Static FAB arrangement Worker returned a malformed error."),
		);
	}

	private handlePrepared(response: Record<string, unknown>): void {
		if (!positiveSafeInteger(response.sourcePlanIndex)) {
			this.failSession(new Error("Static FAB arrangement Worker returned an invalid plan index."));
			return;
		}
		const ignoredPlanIndex = this.ignoredRequests.get(response.requestId as number);
		if (ignoredPlanIndex !== undefined) {
			if (this.inFlightRequestId !== response.requestId) {
				this.failSession(
					new Error("Static FAB arrangement Worker returned a foreign stale result."),
				);
				return;
			}
			this.ignoredRequests.delete(response.requestId as number);
			const ignoredShapeError = staticFabArrangementPreparedShapeError(response.prepared);
			if (ignoredPlanIndex !== response.sourcePlanIndex || ignoredShapeError) {
				this.failSession(
					new Error(
						ignoredShapeError
							? `Static FAB arrangement Worker returned malformed stale data: ${ignoredShapeError}.`
							: "Static FAB arrangement Worker returned a mismatched stale plan index.",
					),
				);
				return;
			}
			this.inFlightRequestId = null;
			this.clearRequestTimeout();
			this.postPending();
			return;
		}

		const pending = this.pending;
		const source = this.source;
		if (
			!pending?.posted ||
			this.inFlightRequestId !== pending.requestId ||
			response.requestId !== pending.requestId ||
			response.sourcePlanIndex !== pending.sourcePlanIndex ||
			!source
		) {
			this.failSession(
				new Error("Static FAB arrangement Worker returned a stale or foreign result."),
			);
			return;
		}
		const workerRoundTripMilliseconds = performance.now() - pending.requestStartedAt;
		const responseValidationStartedAt = performance.now();
		const preparedValidation = validateWorkerPrepared(
			response.prepared,
			pending.permit.ticketId,
			source.identity,
			pending.expectedIntentFingerprint,
		);
		if (preparedValidation instanceof Error) {
			this.failSession(preparedValidation);
			return;
		}
		const responseValidationMilliseconds = performance.now() - responseValidationStartedAt;
		const accepted = response.prepared as PreparedStaticFabArrangement;
		if (!sessionSourceMatchesLiveState(source)) {
			this.failSession(new Error("Static FAB arrangement source changed before plan adoption."));
			return;
		}

		this.pending = null;
		this.inFlightRequestId = null;
		this.clearRequestTimeout();
		let adoptedPlan: StaticFabArrangementPlan | null = null;
		const adoptionStartedAt = performance.now();
		if (
			accepted.valid &&
			accepted.plan &&
			accepted.ticket &&
			preparedValidation.prospectiveChecksum !== null
		) {
			const live = source.getCurrentState();
			try {
				adoptedPlan = adoptStaticFabArrangementWorkerPlan(
					pending.permit,
					accepted.ticket,
					accepted.plan,
					preparedValidation.prospectiveChecksum,
					live.map,
					live.portEquipment,
					live.patchSequence,
					live.organizations,
					pending.intent,
				);
			} catch (error) {
				const failure = workerError(error, "Static FAB arrangement adoption failed.");
				this.closeSession(failure);
				pending.reject(failure);
				return;
			}
		} else {
			revokeStaticFabArrangementPermit(pending.permit);
		}
		pending.resolve(
			Object.freeze({
				plan: adoptedPlan ?? accepted.plan,
				validation: accepted,
				certified: adoptedPlan !== null,
				workerRoundTripMilliseconds,
				responseValidationMilliseconds,
				adoptionMilliseconds: performance.now() - adoptionStartedAt,
				sessionHydrationMilliseconds: this.sessionHydrationMilliseconds,
				sessionCompilationMilliseconds: this.sessionCompilationMilliseconds,
				sourcePlanIndex: pending.sourcePlanIndex,
			}),
		);
	}

	private postPending(): void {
		const pending = this.pending;
		const worker = this.worker;
		const source = this.source;
		if (!pending || pending.posted || this.phase !== "ready" || this.inFlightRequestId !== null) {
			return;
		}
		if (!worker || !source || !sessionSourceMatchesLiveState(source)) {
			this.failSession(new Error("Static FAB arrangement source changed before option planning."));
			return;
		}
		pending.posted = true;
		pending.sourcePlanIndex = this.postedPlanCount + 1;
		this.postedPlanCount = pending.sourcePlanIndex;
		pending.requestStartedAt = performance.now();
		this.inFlightRequestId = pending.requestId;
		const request: StaticFabArrangementWorkerRequest = {
			type: "PREPARE_STATIC_FAB_ARRANGEMENT",
			version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
			sessionId: this.sessionId,
			requestId: pending.requestId,
			ticketId: pending.permit.ticketId,
			intent: pending.intent,
			expectedIntentFingerprint: pending.expectedIntentFingerprint,
		};
		this.requestTimeout = setTimeout(() => {
			this.failSession(
				new Error(
					`Static FAB arrangement Worker option timed out after ${this.timeoutMilliseconds} ms.`,
				),
			);
		}, this.timeoutMilliseconds);
		try {
			worker.postMessage(request);
		} catch (error) {
			this.failSession(workerError(error, "Static FAB arrangement Worker option post failed."));
		}
	}

	private failSession(error: Error): void {
		this.closeSession(error);
	}

	private closeSession(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		this.clearInitializationTimeout();
		this.clearRequestTimeout();
		if (pending) {
			revokeStaticFabArrangementPermit(pending.permit);
			pending.reject(error);
		}
		const worker = this.worker;
		this.worker = null;
		if (worker) {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
			worker.terminate();
		}
		this.phase = "idle";
		this.source = null;
		this.ignoredRequests.clear();
		this.inFlightRequestId = null;
		this.sessionId = 0;
		this.initializationRequestId = 0;
		this.postedPlanCount = 0;
		this.sessionHydrationMilliseconds = 0;
		this.sessionCompilationMilliseconds = 0;
	}

	private clearInitializationTimeout(): void {
		if (this.initializationTimeout === null) return;
		clearTimeout(this.initializationTimeout);
		this.initializationTimeout = null;
	}

	private clearRequestTimeout(): void {
		if (this.requestTimeout === null) return;
		clearTimeout(this.requestTimeout);
		this.requestTimeout = null;
	}

	private issueRequestId(): number {
		if (!Number.isSafeInteger(this.nextRequestId)) {
			throw new RangeError("Static FAB arrangement request sequence is exhausted.");
		}
		return this.nextRequestId++;
	}

	private issueSessionId(): number {
		if (!Number.isSafeInteger(this.nextSessionId)) {
			throw new RangeError("Static FAB arrangement session sequence is exhausted.");
		}
		return this.nextSessionId++;
	}
}

function validateWorkerPrepared(
	value: unknown,
	expectedTicketId: number,
	source: StaticFabArrangementSessionSourceIdentity,
	expectedIntentFingerprint: string,
): Error | { readonly prospectiveChecksum: string | null } {
	const shapeError = staticFabArrangementPreparedShapeError(value);
	if (shapeError) {
		return new Error(`Static FAB arrangement Worker returned malformed data: ${shapeError}.`);
	}
	const prepared = value as PreparedStaticFabArrangement;
	if (!prepared.valid) return Object.freeze({ prospectiveChecksum: null });
	if (!prepared.plan || !prepared.ticket) {
		return new Error("Static FAB arrangement Worker omitted its exact plan or ticket.");
	}
	const { plan, ticket } = prepared;
	if (
		ticket.ticketId !== expectedTicketId ||
		ticket.sourceRevision !== source.revision ||
		ticket.sourcePatchSequence !== source.sequence ||
		ticket.sourceChecksum !== source.checksum ||
		ticket.sourceNextAdvancedSwitchId !== source.nextAdvancedSwitchId ||
		ticket.sourceNextPortId !== source.nextPortId ||
		ticket.sourceNextEquipmentGroupId !== source.nextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== source.nextOrganizationId ||
		ticket.intentFingerprint !== expectedIntentFingerprint ||
		ticket.prospectiveNextAdvancedSwitchId !== source.nextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== source.nextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== source.nextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== source.nextOrganizationId ||
		plan.baseRevision !== source.revision ||
		plan.basePatchSequence !== source.sequence ||
		plan.nextOrganizationIdBefore !== source.nextOrganizationId ||
		plan.nextOrganizationIdAfter !== source.nextOrganizationId
	) {
		return new Error("Static FAB arrangement Worker returned a corrupted one-shot ticket.");
	}
	let prospectiveChecksum: string;
	try {
		prospectiveChecksum = checksumRailPatchResult(source.checksum, {
			changes: plan.mutations,
			switchChanges: plan.switchMutations,
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: plan.organizationMutations,
			organizationNextIdBefore: plan.nextOrganizationIdBefore,
			organizationNextIdAfter: plan.nextOrganizationIdAfter,
		});
	} catch {
		return new Error("Static FAB arrangement Worker returned a malformed exact plan.");
	}
	return ticket.prospectiveChecksum === prospectiveChecksum
		? Object.freeze({ prospectiveChecksum })
		: new Error("Static FAB arrangement Worker returned a divergent prospective checksum.");
}

function sourceIdentityFromSnapshot(
	snapshot: RailMirrorSnapshot,
): StaticFabArrangementSessionSourceIdentity {
	return Object.freeze({
		revision: snapshot.revision,
		sequence: snapshot.sequence,
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
}

function snapshotMatchesLiveState(
	snapshot: RailMirrorSnapshot,
	state: StaticFabArrangementLiveState,
): boolean {
	return sourceIdentityMatchesLiveState(sourceIdentityFromSnapshot(snapshot), state);
}

function sessionSourceMatchesLiveState(source: SessionSourceBinding): boolean {
	const live = source.getCurrentState();
	return (
		live.map === source.map &&
		live.portEquipment === source.portEquipment &&
		live.organizations === source.organizations &&
		sourceIdentityMatchesLiveState(source.identity, live)
	);
}

function sourceIdentityMatchesLiveState(
	source: StaticFabArrangementSessionSourceIdentity,
	state: StaticFabArrangementLiveState,
): boolean {
	return (
		state.map.getRevision() === source.revision &&
		state.patchSequence === source.sequence &&
		state.map.getAdvancedSwitchIdCursor() === source.nextAdvancedSwitchId &&
		state.portEquipment.nextPortId === source.nextPortId &&
		state.portEquipment.nextEquipmentGroupId === source.nextEquipmentGroupId &&
		state.organizations.nextOrganizationId === source.nextOrganizationId
	);
}

function sameSourceIdentity(
	value: unknown,
	expected: StaticFabArrangementSessionSourceIdentity,
): boolean {
	return (
		isRecord(value) &&
		value.revision === expected.revision &&
		value.sequence === expected.sequence &&
		value.checksum === expected.checksum &&
		value.nextAdvancedSwitchId === expected.nextAdvancedSwitchId &&
		value.nextPortId === expected.nextPortId &&
		value.nextEquipmentGroupId === expected.nextEquipmentGroupId &&
		value.nextOrganizationId === expected.nextOrganizationId
	);
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function workerError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function cancelledError(): DOMException {
	return new DOMException("Static FAB arrangement planning cancelled.", "AbortError");
}
