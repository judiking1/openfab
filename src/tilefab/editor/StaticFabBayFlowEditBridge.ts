import type { PortEquipmentState } from "../core/EquipmentGroup";
import type {
	StaticFabBayFlowEditIntent,
	StaticFabBayFlowEditPlan,
} from "../core/StaticFabBayFlowEdit";
import {
	adoptStaticFabBayFlowEditWorkerPlan,
	issueStaticFabBayFlowEditPermit,
	revokeStaticFabBayFlowEditPermit,
	type StaticFabBayFlowEditPermit,
	staticFabBayFlowEditIntentFingerprint,
	staticFabBayFlowEditPlanFingerprint,
} from "../core/StaticFabBayFlowEditCertification";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabBayFlowEdit,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT,
	STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
	type StaticFabBayFlowEditSourceIdentity,
	type StaticFabBayFlowEditTopologyEvidence,
	type StaticFabBayFlowEditWorkerRequest,
	type StaticFabBayFlowEditWorkerResponse,
} from "../worker/StaticFabBayFlowEditProtocol";
import { staticFabBayFlowEditPreparedShapeError } from "../worker/StaticFabBayFlowEditResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabBayFlowEditWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabBayFlowEditWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabBayFlowEditWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabBayFlowEditLiveState {
	readonly map: TileMap;
	readonly patchSequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface StaticFabBayFlowEditInput {
	readonly intent: StaticFabBayFlowEditIntent;
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentState: () => StaticFabBayFlowEditLiveState;
}

export interface ValidatedStaticFabBayFlowEdit {
	readonly plan: StaticFabBayFlowEditPlan | null;
	readonly validation: PreparedStaticFabBayFlowEdit;
	readonly certified: boolean;
	readonly hydrationMilliseconds: number;
	readonly workerRoundTripMilliseconds: number;
	readonly responseValidationMilliseconds: number;
	readonly adoptionMilliseconds: number;
}

interface PendingBayFlowEdit {
	readonly source: StaticFabBayFlowEditLiveState;
	readonly sourceIdentity: StaticFabBayFlowEditSourceIdentity;
	readonly intent: StaticFabBayFlowEditIntent;
	readonly intentFingerprint: string;
	readonly permit: StaticFabBayFlowEditPermit;
	readonly hydrateRequestId: number;
	readonly prepareRequestId: number;
	readonly startedAt: number;
	readonly getCurrentState: () => StaticFabBayFlowEditLiveState;
	readonly resolve: (value: ValidatedStaticFabBayFlowEdit) => void;
	readonly reject: (error: Error) => void;
	hydrationMilliseconds: number;
	sourceEvidence: StaticFabBayFlowEditTopologyEvidence | null;
	phase: "hydrating" | "preparing";
}

/** Disposable two-phase adapter with one exact source-bound adoption capability. */
export class StaticFabBayFlowEditBridge {
	private readonly createWorker: () => StaticFabBayFlowEditWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabBayFlowEditWorkerPort | null = null;
	private pending: PendingBayFlowEdit | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => StaticFabBayFlowEditWorkerPort = () =>
			new Worker(new URL("../worker/staticFabBayFlowEditWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabBayFlowEditWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(input: StaticFabBayFlowEditInput): Promise<ValidatedStaticFabBayFlowEdit> {
		this.cancel();
		let source: StaticFabBayFlowEditLiveState;
		try {
			source = input.getCurrentState();
		} catch (error) {
			return Promise.reject(workerError(error, "Bay flow edit live source could not be read."));
		}
		const sourceIdentity = sourceIdentityFromSnapshot(input.snapshot);
		if (!sourceIdentityMatchesLiveState(sourceIdentity, source)) {
			return Promise.reject(new Error("Bay flow edit snapshot is stale before Worker planning."));
		}
		if (
			!consumeRailMirrorSnapshotCaptureAuthority(
				input.snapshot,
				source.map,
				source.patchSequence,
				source.portEquipment,
				source.organizations,
			)
		) {
			return Promise.reject(
				new Error("Bay flow edit snapshot lacks current authored capture authority."),
			);
		}

		let intentFingerprint: string;
		let permit: StaticFabBayFlowEditPermit;
		try {
			intentFingerprint = staticFabBayFlowEditIntentFingerprint(input.intent);
			permit = issueStaticFabBayFlowEditPermit(
				source.map,
				source.portEquipment,
				source.patchSequence,
				source.organizations,
				input.intent,
				sourceIdentity.checksum,
			);
		} catch (error) {
			return Promise.reject(workerError(error, "Bay flow edit permit could not be issued."));
		}

		let worker: StaticFabBayFlowEditWorkerPort;
		let hydrateRequestId: number;
		let prepareRequestId: number;
		try {
			hydrateRequestId = this.issueRequestId();
			prepareRequestId = this.issueRequestId();
			worker = this.createWorker();
		} catch (error) {
			revokeStaticFabBayFlowEditPermit(permit);
			return Promise.reject(workerError(error, "Bay flow edit Worker creation failed."));
		}
		this.worker = worker;
		const startedAt = performance.now();

		return new Promise((resolve, reject) => {
			this.pending = {
				source,
				sourceIdentity,
				intent: input.intent,
				intentFingerprint,
				permit,
				hydrateRequestId,
				prepareRequestId,
				startedAt,
				getCurrentState: input.getCurrentState,
				resolve,
				reject,
				hydrationMilliseconds: 0,
				sourceEvidence: null,
				phase: "hydrating",
			};
			worker.onmessage = (event) => this.handleMessage(event);
			worker.onerror = (event) => {
				this.fail(new Error(event.message || "Bay flow edit Worker failed."));
			};
			worker.onmessageerror = () => {
				this.fail(new Error("Bay flow edit Worker returned an unreadable response."));
			};
			this.timeout = setTimeout(() => {
				this.fail(
					new Error(`Bay flow edit Worker timed out after ${this.timeoutMilliseconds} ms.`),
				);
			}, this.timeoutMilliseconds);

			const request: StaticFabBayFlowEditWorkerRequest = {
				type: "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
				version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
				requestId: hydrateRequestId,
				snapshot: input.snapshot,
			};
			try {
				worker.postMessage(request, collectTransferableBuffers(input.snapshot));
			} catch (error) {
				this.fail(workerError(error, "Bay flow edit snapshot post failed."));
			}
		});
	}

	cancel(): void {
		const pending = this.pending;
		if (!pending && !this.worker) return;
		this.pending = null;
		this.releaseWorker();
		if (pending) {
			revokeStaticFabBayFlowEditPermit(pending.permit);
			pending.reject(cancelledError());
		}
	}

	dispose(): void {
		this.cancel();
	}

	private handleMessage(event: MessageEvent<StaticFabBayFlowEditWorkerResponse>): void {
		const response = event.data as unknown;
		const pending = this.pending;
		if (!pending) return;
		if (!isRecord(response) || response.version !== STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION) {
			this.fail(new Error("Bay flow edit Worker returned a malformed envelope."));
			return;
		}
		if (response.type === "STATIC_FAB_BAY_FLOW_EDIT_ERROR") {
			const expectedRequestId =
				pending.phase === "hydrating" ? pending.hydrateRequestId : pending.prepareRequestId;
			if (
				!hasExactKeys(response, ["type", "version", "requestId", "message"]) ||
				response.requestId !== expectedRequestId ||
				!boundedNonEmptyText(response.message, STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT)
			) {
				this.fail(new Error("Bay flow edit Worker returned a malformed error."));
				return;
			}
			this.fail(new Error(response.message));
			return;
		}
		if (pending.phase === "hydrating") {
			this.handleHydrated(response, pending);
			return;
		}
		this.handlePrepared(response, pending);
	}

	private handleHydrated(response: Record<string, unknown>, pending: PendingBayFlowEdit): void {
		if (
			response.type !== "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED" ||
			!hasExactKeys(response, [
				"type",
				"version",
				"requestId",
				"source",
				"sourceEvidence",
				"hydrationMilliseconds",
			]) ||
			response.requestId !== pending.hydrateRequestId ||
			!sameSourceIdentity(response.source, pending.sourceIdentity) ||
			!topologyEvidenceShapeIsValid(response.sourceEvidence) ||
			!nonNegativeFinite(response.hydrationMilliseconds)
		) {
			this.fail(new Error("Bay flow edit Worker returned malformed hydration data."));
			return;
		}
		let live: StaticFabBayFlowEditLiveState | null;
		try {
			live = readSourceBindingLiveState(pending);
		} catch (error) {
			this.fail(
				workerError(error, "Bay flow edit live source could not be read during Worker hydration."),
			);
			return;
		}
		if (!live) {
			this.fail(new Error("Bay flow edit source changed during Worker hydration."));
			return;
		}
		const worker = this.worker;
		if (!worker) {
			this.fail(new Error("Bay flow edit Worker ended before planning."));
			return;
		}
		pending.phase = "preparing";
		pending.hydrationMilliseconds = response.hydrationMilliseconds as number;
		pending.sourceEvidence = copyTopologyEvidence(
			response.sourceEvidence as StaticFabBayFlowEditTopologyEvidence,
		);
		const request: StaticFabBayFlowEditWorkerRequest = {
			type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: pending.prepareRequestId,
			ticketId: pending.permit.ticketId,
			intent: pending.intent,
			expectedIntentFingerprint: pending.intentFingerprint,
			expectedSource: pending.sourceIdentity,
		};
		try {
			worker.postMessage(request);
		} catch (error) {
			this.fail(workerError(error, "Bay flow edit intent post failed."));
		}
	}

	private handlePrepared(response: Record<string, unknown>, pending: PendingBayFlowEdit): void {
		if (
			response.type !== "STATIC_FAB_BAY_FLOW_EDIT_PREPARED" ||
			!hasExactKeys(response, ["type", "version", "requestId", "prepared"]) ||
			response.requestId !== pending.prepareRequestId
		) {
			this.fail(new Error("Bay flow edit Worker returned a stale or malformed result."));
			return;
		}
		const workerRoundTripMilliseconds = performance.now() - pending.startedAt;
		const responseValidationStartedAt = performance.now();
		const shapeError = staticFabBayFlowEditPreparedShapeError(response.prepared);
		if (shapeError) {
			this.fail(new Error(`Bay flow edit Worker returned malformed data: ${shapeError}.`));
			return;
		}
		const prepared = response.prepared as PreparedStaticFabBayFlowEdit;
		if (
			!pending.sourceEvidence ||
			!sameTopologyEvidence(prepared.sourceEvidence, pending.sourceEvidence)
		) {
			this.fail(new Error("Bay flow edit Worker changed its hydrated source evidence."));
			return;
		}

		let prospectiveChecksum: string | null = null;
		if (prepared.valid) {
			const ticketError = exactTicketError(prepared, pending);
			if (ticketError) {
				this.fail(new Error(ticketError));
				return;
			}
			try {
				const plan = prepared.plan as StaticFabBayFlowEditPlan;
				prospectiveChecksum = checksumRailPatchResult(pending.sourceIdentity.checksum, {
					changes: plan.mutations,
					switchChanges: plan.switchMutations,
					portChanges: plan.portMutations,
					equipmentGroupChanges: plan.equipmentGroupMutations,
					organizationChanges: plan.organizationMutations,
					organizationNextIdBefore: plan.nextOrganizationIdBefore,
					organizationNextIdAfter: plan.nextOrganizationIdAfter,
				});
			} catch {
				this.fail(new Error("Bay flow edit Worker returned a malformed exact plan."));
				return;
			}
			if (prepared.ticket?.prospectiveChecksum !== prospectiveChecksum) {
				this.fail(new Error("Bay flow edit Worker returned a divergent prospective checksum."));
				return;
			}
		}
		const responseValidationMilliseconds = performance.now() - responseValidationStartedAt;
		let live: StaticFabBayFlowEditLiveState | null;
		try {
			live = readSourceBindingLiveState(pending);
		} catch (error) {
			this.fail(
				workerError(error, "Bay flow edit live source could not be read before plan adoption."),
			);
			return;
		}
		if (!live) {
			this.fail(new Error("Bay flow edit source changed before plan adoption."));
			return;
		}

		let adoptedPlan: StaticFabBayFlowEditPlan | null = null;
		const adoptionStartedAt = performance.now();
		try {
			if (prepared.valid && prepared.plan && prepared.ticket && prospectiveChecksum) {
				adoptedPlan = adoptStaticFabBayFlowEditWorkerPlan(
					pending.permit,
					prepared.ticket,
					prepared.plan,
					prospectiveChecksum,
					live.map,
					live.portEquipment,
					live.patchSequence,
					live.organizations,
					pending.intent,
				);
			} else {
				revokeStaticFabBayFlowEditPermit(pending.permit);
			}
		} catch (error) {
			this.fail(workerError(error, "Bay flow edit plan adoption failed."));
			return;
		}
		const adoptionMilliseconds = performance.now() - adoptionStartedAt;
		this.pending = null;
		this.releaseWorker();
		pending.resolve(
			Object.freeze({
				plan: adoptedPlan ?? prepared.plan,
				validation: prepared,
				certified: adoptedPlan !== null,
				hydrationMilliseconds: pending.hydrationMilliseconds,
				workerRoundTripMilliseconds,
				responseValidationMilliseconds,
				adoptionMilliseconds,
			}),
		);
	}

	private fail(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		this.releaseWorker();
		if (!pending) return;
		revokeStaticFabBayFlowEditPermit(pending.permit);
		pending.reject(error);
	}

	private releaseWorker(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		const worker = this.worker;
		this.worker = null;
		if (!worker) return;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}

	private issueRequestId(): number {
		if (!Number.isSafeInteger(this.nextRequestId)) {
			throw new RangeError("Bay flow edit request sequence is exhausted.");
		}
		return this.nextRequestId++;
	}
}

function exactTicketError(
	prepared: PreparedStaticFabBayFlowEdit,
	pending: PendingBayFlowEdit,
): string | null {
	const plan = prepared.plan;
	const ticket = prepared.ticket;
	if (!plan || !ticket) return "Bay flow edit Worker omitted its exact plan or ticket.";
	let planFingerprint: string;
	try {
		planFingerprint = staticFabBayFlowEditPlanFingerprint(plan);
	} catch {
		return "Bay flow edit Worker returned an unreadable plan fingerprint.";
	}
	return ticket.ticketId === pending.permit.ticketId &&
		ticket.validationLevel === "exact" &&
		ticket.sourceRevision === pending.sourceIdentity.revision &&
		ticket.sourcePatchSequence === pending.sourceIdentity.patchSequence &&
		ticket.sourceChecksum === pending.sourceIdentity.checksum &&
		ticket.sourceNextAdvancedSwitchId === pending.sourceIdentity.nextAdvancedSwitchId &&
		ticket.sourceNextPortId === pending.sourceIdentity.nextPortId &&
		ticket.sourceNextEquipmentGroupId === pending.sourceIdentity.nextEquipmentGroupId &&
		ticket.sourceNextOrganizationId === pending.sourceIdentity.nextOrganizationId &&
		ticket.intentFingerprint === pending.intentFingerprint &&
		ticket.planFingerprint === planFingerprint &&
		ticket.sourceAuthoredProjectionFingerprint ===
			plan.review.sourceAuthoredProjectionFingerprint &&
		ticket.targetAuthoredProjectionFingerprint ===
			plan.review.targetAuthoredProjectionFingerprint &&
		ticket.prospectiveNextAdvancedSwitchId === pending.sourceIdentity.nextAdvancedSwitchId &&
		ticket.prospectiveNextPortId === pending.sourceIdentity.nextPortId &&
		ticket.prospectiveNextEquipmentGroupId === pending.sourceIdentity.nextEquipmentGroupId &&
		ticket.prospectiveNextOrganizationId === pending.sourceIdentity.nextOrganizationId &&
		plan.baseRevision === pending.sourceIdentity.revision &&
		plan.basePatchSequence === pending.sourceIdentity.patchSequence &&
		plan.nextOrganizationIdBefore === pending.sourceIdentity.nextOrganizationId &&
		plan.nextOrganizationIdAfter === pending.sourceIdentity.nextOrganizationId &&
		plan.review.bayOrganizationId === pending.intent.bayOrganizationId &&
		plan.review.targetInternalFlowPattern === pending.intent.targetInternalFlowPattern &&
		plan.review.sourceInternalFlowPattern !== pending.intent.targetInternalFlowPattern
		? null
		: "Bay flow edit Worker returned a corrupted one-shot ticket.";
}

function sourceIdentityFromSnapshot(
	snapshot: RailMirrorSnapshot,
): StaticFabBayFlowEditSourceIdentity {
	return Object.freeze({
		revision: snapshot.revision,
		patchSequence: snapshot.sequence,
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
}

function readSourceBindingLiveState(
	binding: PendingBayFlowEdit,
): StaticFabBayFlowEditLiveState | null {
	const live = binding.getCurrentState();
	return live.map === binding.source.map &&
		live.portEquipment === binding.source.portEquipment &&
		live.organizations === binding.source.organizations &&
		sourceIdentityMatchesLiveState(binding.sourceIdentity, live)
		? live
		: null;
}

function sourceIdentityMatchesLiveState(
	identity: StaticFabBayFlowEditSourceIdentity,
	live: StaticFabBayFlowEditLiveState,
): boolean {
	return (
		live.map.getRevision() === identity.revision &&
		live.patchSequence === identity.patchSequence &&
		live.map.getAdvancedSwitchIdCursor() === identity.nextAdvancedSwitchId &&
		live.portEquipment.nextPortId === identity.nextPortId &&
		live.portEquipment.nextEquipmentGroupId === identity.nextEquipmentGroupId &&
		live.organizations.nextOrganizationId === identity.nextOrganizationId
	);
}

function sameSourceIdentity(value: unknown, expected: StaticFabBayFlowEditSourceIdentity): boolean {
	return (
		isRecord(value) &&
		hasExactKeys(value, [
			"revision",
			"patchSequence",
			"checksum",
			"nextAdvancedSwitchId",
			"nextPortId",
			"nextEquipmentGroupId",
			"nextOrganizationId",
		]) &&
		value.revision === expected.revision &&
		value.patchSequence === expected.patchSequence &&
		value.checksum === expected.checksum &&
		value.nextAdvancedSwitchId === expected.nextAdvancedSwitchId &&
		value.nextPortId === expected.nextPortId &&
		value.nextEquipmentGroupId === expected.nextEquipmentGroupId &&
		value.nextOrganizationId === expected.nextOrganizationId
	);
}

const TOPOLOGY_EVIDENCE_KEYS = Object.freeze([
	"authoredCellCount",
	"authoredDirectedEdgeCount",
	"authoredStatus",
	"authoredComponentCount",
	"authoredStrongComponentCount",
	"authoredOpenTerminalCount",
	"authoredUnsafeJunctionCount",
	"authoredComponentsClosed",
	"physicalValid",
	"physicalPathCount",
	"physicalComponentCount",
	"physicalStrongComponentCount",
	"physicalOpenPathCount",
	"physicalInvalidPathCount",
	"physicalDiagnosticCount",
	"physicalTerminalCount",
	"physicalClearanceIssueCount",
	"physicalComponentsClosed",
] as const);

function topologyEvidenceShapeIsValid(
	value: unknown,
): value is StaticFabBayFlowEditTopologyEvidence {
	if (!isRecord(value) || !hasExactKeys(value, TOPOLOGY_EVIDENCE_KEYS)) return false;
	return (
		nonNegativeSafeInteger(value.authoredCellCount) &&
		nonNegativeSafeInteger(value.authoredDirectedEdgeCount) &&
		(value.authoredStatus === "empty" ||
			value.authoredStatus === "open" ||
			value.authoredStatus === "disconnected" ||
			value.authoredStatus === "unsafe" ||
			value.authoredStatus === "closed") &&
		nonNegativeSafeInteger(value.authoredComponentCount) &&
		nonNegativeSafeInteger(value.authoredStrongComponentCount) &&
		nonNegativeSafeInteger(value.authoredOpenTerminalCount) &&
		nonNegativeSafeInteger(value.authoredUnsafeJunctionCount) &&
		typeof value.authoredComponentsClosed === "boolean" &&
		typeof value.physicalValid === "boolean" &&
		nonNegativeSafeInteger(value.physicalPathCount) &&
		nonNegativeSafeInteger(value.physicalComponentCount) &&
		nonNegativeSafeInteger(value.physicalStrongComponentCount) &&
		nonNegativeSafeInteger(value.physicalOpenPathCount) &&
		nonNegativeSafeInteger(value.physicalInvalidPathCount) &&
		nonNegativeSafeInteger(value.physicalDiagnosticCount) &&
		nonNegativeSafeInteger(value.physicalTerminalCount) &&
		nonNegativeSafeInteger(value.physicalClearanceIssueCount) &&
		typeof value.physicalComponentsClosed === "boolean"
	);
}

function copyTopologyEvidence(
	evidence: StaticFabBayFlowEditTopologyEvidence,
): StaticFabBayFlowEditTopologyEvidence {
	return Object.freeze({ ...evidence });
}

function sameTopologyEvidence(
	value: StaticFabBayFlowEditTopologyEvidence | null,
	expected: StaticFabBayFlowEditTopologyEvidence,
): boolean {
	if (!value) return false;
	return TOPOLOGY_EVIDENCE_KEYS.every((key) => value[key] === expected[key]);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNonEmptyText(value: unknown, maximum: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function nonNegativeFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function workerError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function cancelledError(): DOMException {
	return new DOMException("Bay flow edit planning cancelled.", "AbortError");
}
