import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type {
	StaticFabSemanticBayMutationIntent,
	StaticFabSemanticBayMutationPlan,
} from "../core/StaticFabSemanticBayMutation";
import {
	adoptStaticFabSemanticBayMutationWorkerPlan,
	issueStaticFabSemanticBayMutationPermit,
	revokeStaticFabSemanticBayMutationPermit,
	type StaticFabSemanticBayMutationPermit,
	staticFabSemanticBayMutationIntentFingerprint,
} from "../core/StaticFabSemanticBayMutationCertification";
import type { TileMap } from "../core/TileMap";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabSemanticBayMutation,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
	type StaticFabSemanticBayMutationSourceIdentity,
	type StaticFabSemanticBayMutationTopologyEvidence,
	type StaticFabSemanticBayMutationWorkerRequest,
	type StaticFabSemanticBayMutationWorkerResponse,
} from "../worker/StaticFabSemanticBayMutationProtocol";
import { staticFabSemanticBayMutationPreparedShapeError } from "../worker/StaticFabSemanticBayMutationResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabSemanticBayMutationWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabSemanticBayMutationWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabSemanticBayMutationWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabSemanticBayMutationLiveState {
	readonly map: TileMap;
	readonly patchSequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface StaticFabSemanticBayMutationInput {
	readonly intent: StaticFabSemanticBayMutationIntent;
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentState: () => StaticFabSemanticBayMutationLiveState;
}

export interface ValidatedStaticFabSemanticBayMutation {
	readonly plan: StaticFabSemanticBayMutationPlan | null;
	readonly validation: PreparedStaticFabSemanticBayMutation;
	readonly certified: boolean;
	readonly hydrationMilliseconds: number;
	readonly workerRoundTripMilliseconds: number;
	readonly responseValidationMilliseconds: number;
	readonly adoptionMilliseconds: number;
}

interface PendingSemanticBayMutation {
	readonly source: StaticFabSemanticBayMutationLiveState;
	readonly sourceIdentity: StaticFabSemanticBayMutationSourceIdentity;
	readonly intent: StaticFabSemanticBayMutationIntent;
	readonly intentFingerprint: string;
	readonly permit: StaticFabSemanticBayMutationPermit;
	readonly hydrateRequestId: number;
	readonly prepareRequestId: number;
	readonly startedAt: number;
	readonly getCurrentState: () => StaticFabSemanticBayMutationLiveState;
	readonly resolve: (value: ValidatedStaticFabSemanticBayMutation) => void;
	readonly reject: (error: Error) => void;
	hydrationMilliseconds: number;
	sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
	phase: "hydrating" | "preparing";
}

/** Disposable source-bound Worker adapter with one exact, one-shot main-realm adoption. */
export class StaticFabSemanticBayMutationBridge {
	private readonly createWorker: () => StaticFabSemanticBayMutationWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabSemanticBayMutationWorkerPort | null = null;
	private pending: PendingSemanticBayMutation | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => StaticFabSemanticBayMutationWorkerPort = () =>
			new Worker(new URL("../worker/staticFabSemanticBayMutationWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabSemanticBayMutationWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(
		input: StaticFabSemanticBayMutationInput,
	): Promise<ValidatedStaticFabSemanticBayMutation> {
		this.cancel();
		const source = input.getCurrentState();
		const sourceIdentity = sourceIdentityFromSnapshot(input.snapshot);
		if (!sourceIdentityMatchesLiveState(sourceIdentity, source)) {
			return Promise.reject(
				new Error("Semantic Bay mutation snapshot is stale before Worker planning."),
			);
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
				new Error("Semantic Bay mutation snapshot lacks current authored capture authority."),
			);
		}

		let intentFingerprint: string;
		let permit: StaticFabSemanticBayMutationPermit;
		try {
			intentFingerprint = staticFabSemanticBayMutationIntentFingerprint(input.intent);
			permit = issueStaticFabSemanticBayMutationPermit(
				source.map,
				source.portEquipment,
				source.patchSequence,
				source.organizations,
				input.intent,
				sourceIdentity.checksum,
			);
		} catch (error) {
			return Promise.reject(
				workerError(error, "Semantic Bay mutation permit could not be issued."),
			);
		}

		let worker: StaticFabSemanticBayMutationWorkerPort;
		let hydrateRequestId: number;
		let prepareRequestId: number;
		try {
			hydrateRequestId = this.issueRequestId();
			prepareRequestId = this.issueRequestId();
			worker = this.createWorker();
		} catch (error) {
			revokeStaticFabSemanticBayMutationPermit(permit);
			return Promise.reject(workerError(error, "Semantic Bay mutation Worker creation failed."));
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
				this.fail(new Error(event.message || "Semantic Bay mutation Worker failed."));
			};
			worker.onmessageerror = () => {
				this.fail(new Error("Semantic Bay mutation Worker returned an unreadable response."));
			};
			this.timeout = setTimeout(() => {
				this.fail(
					new Error(`Semantic Bay mutation Worker timed out after ${this.timeoutMilliseconds} ms.`),
				);
			}, this.timeoutMilliseconds);

			const request: StaticFabSemanticBayMutationWorkerRequest = {
				type: "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
				version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
				requestId: hydrateRequestId,
				snapshot: input.snapshot,
			};
			try {
				worker.postMessage(request, collectTransferableBuffers(input.snapshot));
			} catch (error) {
				this.fail(workerError(error, "Semantic Bay mutation snapshot post failed."));
			}
		});
	}

	cancel(): void {
		const pending = this.pending;
		if (!pending && !this.worker) return;
		this.pending = null;
		this.releaseWorker();
		if (pending) {
			revokeStaticFabSemanticBayMutationPermit(pending.permit);
			pending.reject(cancelledError());
		}
	}

	dispose(): void {
		this.cancel();
	}

	private handleMessage(event: MessageEvent<StaticFabSemanticBayMutationWorkerResponse>): void {
		const response = event.data as unknown;
		const pending = this.pending;
		if (!pending) return;
		if (
			!isRecord(response) ||
			response.version !== STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION
		) {
			this.fail(new Error("Semantic Bay mutation Worker returned a malformed envelope."));
			return;
		}
		if (response.type === "STATIC_FAB_SEMANTIC_BAY_MUTATION_ERROR") {
			const expectedRequestId =
				pending.phase === "hydrating" ? pending.hydrateRequestId : pending.prepareRequestId;
			if (
				!hasExactKeys(response, ["type", "version", "requestId", "message"]) ||
				response.requestId !== expectedRequestId ||
				!boundedNonEmptyText(response.message, STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT)
			) {
				this.fail(new Error("Semantic Bay mutation Worker returned a malformed error."));
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

	private handleHydrated(
		response: Record<string, unknown>,
		pending: PendingSemanticBayMutation,
	): void {
		if (
			response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_HYDRATED" ||
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
			this.fail(new Error("Semantic Bay mutation Worker returned malformed hydration data."));
			return;
		}
		if (!sourceBindingMatchesLiveState(pending)) {
			this.fail(new Error("Semantic Bay mutation source changed during Worker hydration."));
			return;
		}
		const worker = this.worker;
		if (!worker) {
			this.fail(new Error("Semantic Bay mutation Worker ended before planning."));
			return;
		}
		pending.phase = "preparing";
		pending.hydrationMilliseconds = response.hydrationMilliseconds as number;
		pending.sourceEvidence = copyTopologyEvidence(
			response.sourceEvidence as StaticFabSemanticBayMutationTopologyEvidence,
		);
		const request: StaticFabSemanticBayMutationWorkerRequest = {
			type: "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
			version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
			requestId: pending.prepareRequestId,
			ticketId: pending.permit.ticketId,
			intent: pending.intent,
			expectedIntentFingerprint: pending.intentFingerprint,
			expectedSource: pending.sourceIdentity,
		};
		try {
			worker.postMessage(request);
		} catch (error) {
			this.fail(workerError(error, "Semantic Bay mutation intent post failed."));
		}
	}

	private handlePrepared(
		response: Record<string, unknown>,
		pending: PendingSemanticBayMutation,
	): void {
		if (
			response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED" ||
			!hasExactKeys(response, ["type", "version", "requestId", "prepared"]) ||
			response.requestId !== pending.prepareRequestId
		) {
			this.fail(new Error("Semantic Bay mutation Worker returned a stale or malformed result."));
			return;
		}
		const workerRoundTripMilliseconds = performance.now() - pending.startedAt;
		const responseValidationStartedAt = performance.now();
		const shapeError = staticFabSemanticBayMutationPreparedShapeError(response.prepared);
		if (shapeError) {
			this.fail(new Error(`Semantic Bay mutation Worker returned malformed data: ${shapeError}.`));
			return;
		}
		const prepared = response.prepared as PreparedStaticFabSemanticBayMutation;
		if (
			!pending.sourceEvidence ||
			!sameTopologyEvidence(prepared.sourceEvidence, pending.sourceEvidence)
		) {
			this.fail(new Error("Semantic Bay mutation Worker changed its hydrated source evidence."));
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
				const plan = prepared.plan as StaticFabSemanticBayMutationPlan;
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
				this.fail(new Error("Semantic Bay mutation Worker returned a malformed exact plan."));
				return;
			}
			if (prepared.ticket?.prospectiveChecksum !== prospectiveChecksum) {
				this.fail(
					new Error("Semantic Bay mutation Worker returned a divergent prospective checksum."),
				);
				return;
			}
		}
		const responseValidationMilliseconds = performance.now() - responseValidationStartedAt;
		if (!sourceBindingMatchesLiveState(pending)) {
			this.fail(new Error("Semantic Bay mutation source changed before plan adoption."));
			return;
		}

		let adoptedPlan: StaticFabSemanticBayMutationPlan | null = null;
		const adoptionStartedAt = performance.now();
		try {
			if (prepared.valid && prepared.plan && prepared.ticket && prospectiveChecksum) {
				const live = pending.getCurrentState();
				adoptedPlan = adoptStaticFabSemanticBayMutationWorkerPlan(
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
				revokeStaticFabSemanticBayMutationPermit(pending.permit);
			}
		} catch (error) {
			this.fail(workerError(error, "Semantic Bay mutation plan adoption failed."));
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
		revokeStaticFabSemanticBayMutationPermit(pending.permit);
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
			throw new RangeError("Semantic Bay mutation request sequence is exhausted.");
		}
		return this.nextRequestId++;
	}
}

function exactTicketError(
	prepared: PreparedStaticFabSemanticBayMutation,
	pending: PendingSemanticBayMutation,
): string | null {
	const plan = prepared.plan;
	const ticket = prepared.ticket;
	if (!plan || !ticket) return "Semantic Bay mutation Worker omitted its exact plan or ticket.";
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
		ticket.prospectiveNextAdvancedSwitchId === pending.sourceIdentity.nextAdvancedSwitchId &&
		ticket.prospectiveNextPortId === pending.sourceIdentity.nextPortId &&
		ticket.prospectiveNextEquipmentGroupId === pending.sourceIdentity.nextEquipmentGroupId &&
		ticket.prospectiveNextOrganizationId === pending.sourceIdentity.nextOrganizationId &&
		plan.baseRevision === pending.sourceIdentity.revision &&
		plan.basePatchSequence === pending.sourceIdentity.patchSequence &&
		plan.nextOrganizationIdBefore === pending.sourceIdentity.nextOrganizationId &&
		plan.nextOrganizationIdAfter === pending.sourceIdentity.nextOrganizationId
		? null
		: "Semantic Bay mutation Worker returned a corrupted one-shot ticket.";
}

function sourceIdentityFromSnapshot(
	snapshot: RailMirrorSnapshot,
): StaticFabSemanticBayMutationSourceIdentity {
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

function sourceBindingMatchesLiveState(binding: PendingSemanticBayMutation): boolean {
	const live = binding.getCurrentState();
	return (
		live.map === binding.source.map &&
		live.portEquipment === binding.source.portEquipment &&
		live.organizations === binding.source.organizations &&
		sourceIdentityMatchesLiveState(binding.sourceIdentity, live)
	);
}

function sourceIdentityMatchesLiveState(
	identity: StaticFabSemanticBayMutationSourceIdentity,
	live: StaticFabSemanticBayMutationLiveState,
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

function sameSourceIdentity(
	value: unknown,
	expected: StaticFabSemanticBayMutationSourceIdentity,
): boolean {
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
): value is StaticFabSemanticBayMutationTopologyEvidence {
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
	evidence: StaticFabSemanticBayMutationTopologyEvidence,
): StaticFabSemanticBayMutationTopologyEvidence {
	return Object.freeze({ ...evidence });
}

function sameTopologyEvidence(
	value: StaticFabSemanticBayMutationTopologyEvidence | null,
	expected: StaticFabSemanticBayMutationTopologyEvidence,
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
	return typeof value === "object" && value !== null;
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
	return new DOMException("Semantic Bay mutation planning cancelled.", "AbortError");
}
