import {
	type HydratedOpenFabStationProposalArtifact,
	hydrateOpenFabStationProposalArtifact,
} from "../compile/OpenFabStationProposalArtifact";
import {
	evaluateOpenFabStationProposalReview,
	finalizeOpenFabStationProposalReview,
	type OpenFabStationProposalReviewEvaluation,
	type OpenFabStationProposalReviewSource,
	planReviewedOpenFabStationProposalBatch,
} from "../compile/OpenFabStationProposalReview";
import {
	captureOpenFabStationProposalReviewEvaluationArtifact,
	openFabStationProposalReviewEvaluationArtifactTransfers,
} from "../compile/OpenFabStationProposalReviewEvaluationArtifact";
import type { PortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import {
	adoptOpenFabStationProposalReviewDraftSnapshot,
	decodeAdoptedOpenFabStationProposalReviewDraftSnapshot,
} from "./OpenFabStationProposalReviewDraftSoA";
import {
	encodeOpenFabStationProposalReviewedPlanArtifactCooperatively,
	openFabStationProposalReviewedPlanFingerprint,
	releaseEncodedOpenFabStationProposalReviewedPlanArtifactTransfer,
} from "./OpenFabStationProposalReviewedPlanArtifact";
import {
	type ApplyOpenFabStationProposalReviewWorkerRequest,
	type EvaluateOpenFabStationProposalReviewWorkerRequest,
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalReviewWorkerErrorCode,
	type OpenFabStationProposalReviewWorkerResponse,
	openFabStationProposalReviewWorkerErrorMessage,
} from "./OpenFabStationProposalReviewWorkerProtocol";
import { checksumRailPatchResult } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";

const EVALUATE_REQUEST_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"ticketId",
	"proposalSemanticFingerprint",
	"proposalSnapshotFingerprint",
	"draftFingerprint",
	"sourceChecksum",
	"proposal",
	"draft",
	"snapshot",
] as const);
const APPLY_REQUEST_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"ticketId",
	"evaluationRequestId",
	"evaluationSnapshotFingerprint",
	"reviewFingerprint",
] as const);

const PROPOSAL_SEMANTIC_FINGERPRINT =
	/^openfab-station-proposal-semantic:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const PROPOSAL_SNAPSHOT_FINGERPRINT =
	/^openfab-station-proposal-snapshot:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const DRAFT_FINGERPRINT = /^openfab-station-proposal-review-draft:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const EVALUATION_FINGERPRINT =
	/^openfab-station-proposal-review-evaluation-snapshot:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const REVIEW_FINGERPRINT = /^openfab-station-proposal-review:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const RAIL_CHECKSUM = /^(?:[0-9a-f]{8}:){8}[0-9a-f]{8}$/;
const preparedResponseTransfers = new WeakMap<object, readonly ArrayBuffer[]>();

interface RequestCorrelation {
	readonly requestId: number;
	readonly generation: number;
	readonly ticketId: number;
}

interface ReadySession {
	readonly identity: Readonly<{
		readonly requestId: number;
		readonly generation: number;
		readonly ticketId: number;
		readonly proposalSemanticFingerprint: string;
		readonly proposalSnapshotFingerprint: string;
		readonly draftFingerprint: string;
		readonly sourceChecksum: string;
	}>;
	readonly source: OpenFabStationProposalReviewSource;
	readonly evaluation: OpenFabStationProposalReviewEvaluation;
	readonly evaluationSnapshotFingerprint: string;
	readonly sourceNextAdvancedSwitchId: number;
}

class ReviewWorkerFailure extends Error {
	readonly code: OpenFabStationProposalReviewWorkerErrorCode;

	constructor(code: OpenFabStationProposalReviewWorkerErrorCode) {
		super(openFabStationProposalReviewWorkerErrorMessage(code));
		this.name = "OpenFabStationProposalReviewWorkerError";
		this.code = code;
	}
}

/** Stateful EVALUATE -> explicit APPLY runtime for one disposable Worker. */
export class OpenFabStationProposalReviewWorkerSession {
	private status: "new" | "ready" | "terminal" = "new";
	private ready: ReadySession | null = null;

	async receive(value: unknown): Promise<OpenFabStationProposalReviewWorkerResponse> {
		const correlation = requestCorrelation(value);
		if (this.status === "terminal") return errorResponse(correlation, "SESSION_NOT_READY");
		if (this.status === "new") {
			const requestType = ownDataPropertyValue(value, "type");
			if (requestType === "APPLY_OPENFAB_STATION_PROPOSAL_REVIEW") {
				this.status = "terminal";
				try {
					parseApplyRequest(value);
					return errorResponse(correlation, "SESSION_NOT_READY");
				} catch {
					return errorResponse(correlation, "MALFORMED_REQUEST");
				}
			}
			let request: EvaluateOpenFabStationProposalReviewWorkerRequest;
			try {
				request = parseEvaluateRequest(value);
			} catch (error) {
				this.status = "terminal";
				return errorResponse(
					correlation,
					error instanceof ReviewWorkerFailure ? error.code : "MALFORMED_REQUEST",
				);
			}
			return this.evaluate(request);
		}

		const ready = this.ready;
		this.ready = null;
		this.status = "terminal";
		const requestType = ownDataPropertyValue(value, "type");
		if (requestType === "EVALUATE_OPENFAB_STATION_PROPOSAL_REVIEW") {
			try {
				parseEvaluateRequest(value);
				return errorResponse(correlation, "SESSION_NOT_READY");
			} catch {
				return errorResponse(correlation, "MALFORMED_REQUEST");
			}
		}
		let request: ApplyOpenFabStationProposalReviewWorkerRequest;
		try {
			request = parseApplyRequest(value);
		} catch (error) {
			return errorResponse(
				correlation,
				error instanceof ReviewWorkerFailure ? error.code : "MALFORMED_REQUEST",
			);
		}
		if (!ready) return errorResponse(correlation, "SESSION_NOT_READY");
		return this.apply(ready, request);
	}

	isReady(): boolean {
		return this.status === "ready" && this.ready !== null;
	}

	isTerminal(): boolean {
		return this.status === "terminal";
	}

	terminate(): void {
		this.ready = null;
		this.status = "terminal";
	}

	private evaluate(
		request: EvaluateOpenFabStationProposalReviewWorkerRequest,
	): OpenFabStationProposalReviewWorkerResponse {
		let proposal: HydratedOpenFabStationProposalArtifact;
		try {
			proposal = hydrateOpenFabStationProposalArtifact(request.proposal);
		} catch {
			this.status = "terminal";
			return errorResponse(request, "INVALID_PROPOSAL");
		}
		let draft: ReturnType<typeof decodeAdoptedOpenFabStationProposalReviewDraftSnapshot>;
		try {
			const adoptedDraft = adoptOpenFabStationProposalReviewDraftSnapshot(request.draft);
			draft = decodeAdoptedOpenFabStationProposalReviewDraftSnapshot(adoptedDraft);
		} catch {
			this.status = "terminal";
			return errorResponse(request, "INVALID_DRAFT");
		}
		let document: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
		try {
			document = hydrateRailMirrorSnapshotDocument(request.snapshot);
		} catch {
			this.status = "terminal";
			return errorResponse(request, "INVALID_SOURCE_SNAPSHOT");
		}

		if (
			proposal.semanticFingerprint !== request.proposalSemanticFingerprint ||
			proposal.snapshotFingerprint !== request.proposalSnapshotFingerprint ||
			request.draft.fingerprint !== request.draftFingerprint ||
			request.draft.proposalRowCount !== proposal.rowCount ||
			request.snapshot.checksum !== request.sourceChecksum ||
			document.map.getRevision() !== request.snapshot.revision ||
			document.getPatchSequence() !== request.snapshot.sequence ||
			document.map.getAdvancedSwitchIdCursor() !== request.snapshot.nextAdvancedSwitchId ||
			document.portEquipment.nextPortId !== request.snapshot.portEquipment.nextPortId ||
			document.portEquipment.nextEquipmentGroupId !==
				request.snapshot.portEquipment.nextEquipmentGroupId ||
			document.organizations.nextOrganizationId !==
				request.snapshot.organizations.nextOrganizationId
		) {
			this.status = "terminal";
			return errorResponse(request, "SOURCE_IDENTITY_MISMATCH");
		}

		const source = Object.freeze({
			map: document.map,
			portEquipment: document.portEquipment,
			organizations: document.organizations,
			patchSequence: document.getPatchSequence(),
		});
		let evaluation: OpenFabStationProposalReviewEvaluation;
		let evaluationArtifact: ReturnType<
			typeof captureOpenFabStationProposalReviewEvaluationArtifact
		>;
		try {
			evaluation = evaluateOpenFabStationProposalReview(proposal, draft, source);
			evaluationArtifact = captureOpenFabStationProposalReviewEvaluationArtifact(evaluation);
		} catch {
			this.status = "terminal";
			return errorResponse(request, "TRANSFER_INVALID");
		}

		if (evaluation.state === "READY") {
			this.ready = Object.freeze({
				identity: Object.freeze({
					requestId: request.requestId,
					generation: request.generation,
					ticketId: request.ticketId,
					proposalSemanticFingerprint: request.proposalSemanticFingerprint,
					proposalSnapshotFingerprint: request.proposalSnapshotFingerprint,
					draftFingerprint: request.draftFingerprint,
					sourceChecksum: request.sourceChecksum,
				}),
				source,
				evaluation,
				evaluationSnapshotFingerprint: evaluationArtifact.snapshotFingerprint,
				sourceNextAdvancedSwitchId: request.snapshot.nextAdvancedSwitchId,
			});
			this.status = "ready";
		} else {
			this.status = "terminal";
		}

		return Object.freeze({
			type: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED" as const,
			...responseCorrelation(request),
			proposalSemanticFingerprint: request.proposalSemanticFingerprint,
			proposalSnapshotFingerprint: request.proposalSnapshotFingerprint,
			draftFingerprint: request.draftFingerprint,
			sourceChecksum: request.sourceChecksum,
			evaluation: evaluationArtifact,
		});
	}

	private async apply(
		ready: ReadySession,
		request: ApplyOpenFabStationProposalReviewWorkerRequest,
	): Promise<OpenFabStationProposalReviewWorkerResponse> {
		const initial = ready.identity;
		if (
			request.evaluationRequestId !== initial.requestId ||
			request.requestId === initial.requestId ||
			request.generation !== initial.generation ||
			request.ticketId !== initial.ticketId ||
			request.evaluationSnapshotFingerprint !== ready.evaluationSnapshotFingerprint ||
			request.reviewFingerprint !== ready.evaluation.reviewFingerprint
		) {
			return errorResponse(request, "APPLY_IDENTITY_MISMATCH");
		}

		let plan: PortEquipmentMutationPlan;
		try {
			const reviewed = finalizeOpenFabStationProposalReview(ready.evaluation);
			plan = planReviewedOpenFabStationProposalBatch(reviewed, ready.source);
			if (
				!plan.valid ||
				plan.portMutations.length === 0 ||
				plan.equipmentGroupMutations.length === 0
			) {
				throw new Error("INVALID_REVIEWED_PLAN");
			}
		} catch {
			return errorResponse(request, "SESSION_NOT_READY");
		}

		let planArtifact: Awaited<
			ReturnType<typeof encodeOpenFabStationProposalReviewedPlanArtifactCooperatively>
		>;
		try {
			planArtifact = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
				{
					plan,
					sourceRevision: ready.source.map.getRevision(),
					sourcePatchSequence: ready.source.patchSequence,
					sourceNextPortId: ready.source.portEquipment.nextPortId,
					sourceNextEquipmentGroupId: ready.source.portEquipment.nextEquipmentGroupId,
					reviewFingerprint: request.reviewFingerprint,
				},
				{
					checkpoint: nextWorkerTask,
					revision: () => request.generation,
				},
			);
		} catch {
			return errorResponse(request, "PLAN_ENCODING_FAILED");
		}

		let prospectiveChecksum: string;
		let planArtifactTransfers: readonly ArrayBuffer[];
		try {
			prospectiveChecksum = checksumRailPatchResult(initial.sourceChecksum, {
				changes: [],
				switchChanges: [],
				portChanges: plan.portMutations,
				equipmentGroupChanges: plan.equipmentGroupMutations,
				organizationChanges: [],
				organizationNextIdBefore: ready.source.organizations.nextOrganizationId,
				organizationNextIdAfter: ready.source.organizations.nextOrganizationId,
			});
			planArtifactTransfers =
				releaseEncodedOpenFabStationProposalReviewedPlanArtifactTransfer(planArtifact).transfers;
			assertIndependentBuffers(planArtifactTransfers, []);
		} catch {
			return errorResponse(request, "TRANSFER_INVALID");
		}

		const response = Object.freeze({
			type: "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED" as const,
			...responseCorrelation(request),
			ticket: Object.freeze({
				ticketId: request.ticketId,
				evaluationRequestId: initial.requestId,
				applyRequestId: request.requestId,
				validationLevel: "exact" as const,
				requestGeneration: request.generation,
				sourceRevision: ready.source.map.getRevision(),
				sourcePatchSequence: ready.source.patchSequence,
				sourceChecksum: initial.sourceChecksum,
				sourceNextAdvancedSwitchId: ready.sourceNextAdvancedSwitchId,
				sourceNextPortId: ready.source.portEquipment.nextPortId,
				sourceNextEquipmentGroupId: ready.source.portEquipment.nextEquipmentGroupId,
				sourceNextOrganizationId: ready.source.organizations.nextOrganizationId,
				proposalSemanticFingerprint: initial.proposalSemanticFingerprint,
				proposalSnapshotFingerprint: initial.proposalSnapshotFingerprint,
				draftFingerprint: initial.draftFingerprint,
				evaluationSnapshotFingerprint: request.evaluationSnapshotFingerprint,
				reviewFingerprint: request.reviewFingerprint,
				planArtifactFingerprint: planArtifact.fingerprint,
				planFingerprint: openFabStationProposalReviewedPlanFingerprint(plan),
				planKindCode: planArtifact.planKindCode,
				portCount: planArtifact.portCount,
				groupCount: planArtifact.groupCount,
				prospectiveChecksum,
				prospectiveNextAdvancedSwitchId: ready.sourceNextAdvancedSwitchId,
				prospectiveNextPortId: ready.source.portEquipment.nextPortId + planArtifact.portCount,
				prospectiveNextEquipmentGroupId:
					ready.source.portEquipment.nextEquipmentGroupId + planArtifact.groupCount,
				prospectiveNextOrganizationId: ready.source.organizations.nextOrganizationId,
			}),
			planArtifact,
		});
		preparedResponseTransfers.set(response, planArtifactTransfers);
		return response;
	}
}

export function collectOpenFabStationProposalReviewWorkerResponseTransfers(
	response: OpenFabStationProposalReviewWorkerResponse,
): ArrayBuffer[] {
	try {
		const buffers =
			response.type === "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED"
				? openFabStationProposalReviewEvaluationArtifactTransfers(response.evaluation)
				: response.type === "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED"
					? consumePreparedResponseTransfers(response)
					: [];
		assertIndependentBuffers(buffers, []);
		return [...buffers];
	} catch {
		throw new ReviewWorkerFailure("TRANSFER_INVALID");
	}
}

function consumePreparedResponseTransfers(response: object): readonly ArrayBuffer[] {
	const transfers = preparedResponseTransfers.get(response);
	preparedResponseTransfers.delete(response);
	if (!transfers) throw new ReviewWorkerFailure("TRANSFER_INVALID");
	return transfers;
}

function parseEvaluateRequest(value: unknown): EvaluateOpenFabStationProposalReviewWorkerRequest {
	const record = captureExactOwnDataRecord(value, EVALUATE_REQUEST_KEYS);
	if (!record) throw new ReviewWorkerFailure("MALFORMED_REQUEST");
	assertCorrelation(record);
	if (
		record.type !== "EVALUATE_OPENFAB_STATION_PROPOSAL_REVIEW" ||
		!matches(record.proposalSemanticFingerprint, PROPOSAL_SEMANTIC_FINGERPRINT) ||
		!matches(record.proposalSnapshotFingerprint, PROPOSAL_SNAPSHOT_FINGERPRINT) ||
		!matches(record.draftFingerprint, DRAFT_FINGERPRINT) ||
		!matches(record.sourceChecksum, RAIL_CHECKSUM) ||
		!isObject(record.proposal) ||
		!isObject(record.draft) ||
		!isObject(record.snapshot)
	) {
		throw new ReviewWorkerFailure("MALFORMED_REQUEST");
	}
	return Object.freeze(record) as unknown as EvaluateOpenFabStationProposalReviewWorkerRequest;
}

function parseApplyRequest(value: unknown): ApplyOpenFabStationProposalReviewWorkerRequest {
	const record = captureExactOwnDataRecord(value, APPLY_REQUEST_KEYS);
	if (!record) throw new ReviewWorkerFailure("MALFORMED_REQUEST");
	assertCorrelation(record);
	if (
		record.type !== "APPLY_OPENFAB_STATION_PROPOSAL_REVIEW" ||
		!isPositiveSafeInteger(record.evaluationRequestId) ||
		!matches(record.evaluationSnapshotFingerprint, EVALUATION_FINGERPRINT) ||
		!matches(record.reviewFingerprint, REVIEW_FINGERPRINT)
	) {
		throw new ReviewWorkerFailure("MALFORMED_REQUEST");
	}
	return Object.freeze(record) as unknown as ApplyOpenFabStationProposalReviewWorkerRequest;
}

function assertCorrelation(record: Readonly<Record<string, unknown>>): void {
	if (
		record.protocolVersion !== OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION ||
		!isPositiveSafeInteger(record.requestId) ||
		!isPositiveSafeInteger(record.generation) ||
		!isPositiveSafeInteger(record.ticketId)
	) {
		throw new ReviewWorkerFailure("MALFORMED_REQUEST");
	}
}

function requestCorrelation(value: unknown): RequestCorrelation {
	const record = captureLooseOwnDataRecord(value);
	return Object.freeze({
		requestId: isPositiveSafeInteger(record?.requestId) ? record.requestId : 0,
		generation: isPositiveSafeInteger(record?.generation) ? record.generation : 0,
		ticketId: isPositiveSafeInteger(record?.ticketId) ? record.ticketId : 0,
	});
}

function responseCorrelation(correlation: RequestCorrelation): {
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly ticketId: number;
} {
	return {
		protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
		requestId: correlation.requestId,
		generation: correlation.generation,
		ticketId: correlation.ticketId,
	};
}

function errorResponse(
	correlation: RequestCorrelation,
	code: OpenFabStationProposalReviewWorkerErrorCode,
): OpenFabStationProposalReviewWorkerResponse {
	return Object.freeze({
		type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR" as const,
		...responseCorrelation(correlation),
		code,
		message: openFabStationProposalReviewWorkerErrorMessage(code),
	});
}

function assertIndependentBuffers(
	buffers: readonly ArrayBuffer[],
	excluded: readonly ArrayBuffer[],
) {
	const seen = new Set<ArrayBuffer>(excluded);
	for (const buffer of buffers) {
		if (!(buffer instanceof ArrayBuffer) || seen.has(buffer)) {
			throw new ReviewWorkerFailure("TRANSFER_INVALID");
		}
		seen.add(buffer);
	}
}

function captureExactOwnDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
	const captured = captureLooseOwnDataRecord(value);
	if (!captured) return null;
	const actual = Object.keys(captured);
	return actual.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(captured, key))
		? captured
		: null;
}

function captureLooseOwnDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	if (!isObject(value) || Array.isArray(value)) return null;
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

function ownDataPropertyValue(value: unknown, key: string): unknown {
	if (!isObject(value)) return undefined;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor && "value" in descriptor ? descriptor.value : undefined;
	} catch {
		return undefined;
	}
}

function matches(value: unknown, pattern: RegExp): value is string {
	return typeof value === "string" && pattern.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function nextWorkerTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
