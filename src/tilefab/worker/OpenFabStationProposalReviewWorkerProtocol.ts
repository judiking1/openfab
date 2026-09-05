import type { OpenFabStationProposalArtifact } from "../compile/OpenFabStationProposalArtifact";
import type { OpenFabStationProposalReviewEvaluationArtifact } from "../compile/OpenFabStationProposalReviewEvaluationArtifact";
import type { OpenFabStationProposalReviewDraftSnapshot } from "./OpenFabStationProposalReviewDraftSoA";
import type { OpenFabStationProposalReviewedPlanArtifact } from "./OpenFabStationProposalReviewedPlanArtifact";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION = 2 as const;
export const OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_MAX_ERROR_MESSAGE_LENGTH = 112;

export const OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"INVALID_PROPOSAL",
	"INVALID_DRAFT",
	"INVALID_SOURCE_SNAPSHOT",
	"SOURCE_IDENTITY_MISMATCH",
	"SESSION_NOT_READY",
	"APPLY_IDENTITY_MISMATCH",
	"PLAN_ENCODING_FAILED",
	"TRANSFER_INVALID",
	"INTERNAL_FAILURE",
] as const);
export type OpenFabStationProposalReviewWorkerErrorCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_ERROR_CODES)[number];

const ERROR_MESSAGES = Object.freeze({
	MALFORMED_REQUEST: "Station proposal review Worker request is malformed.",
	INVALID_PROPOSAL: "Station proposal review source is invalid.",
	INVALID_DRAFT: "Station proposal review draft is invalid.",
	INVALID_SOURCE_SNAPSHOT: "Station proposal review map snapshot is invalid.",
	SOURCE_IDENTITY_MISMATCH: "Station proposal review source identity changed in transfer.",
	SESSION_NOT_READY: "Station proposal review Worker session is not ready to apply.",
	APPLY_IDENTITY_MISMATCH: "Station proposal review Apply identity does not match its preview.",
	PLAN_ENCODING_FAILED: "Station proposal reviewed plan could not be encoded.",
	TRANSFER_INVALID: "Station proposal review result is not transferable.",
	INTERNAL_FAILURE: "Station proposal review Worker failed internally.",
}) satisfies Readonly<Record<OpenFabStationProposalReviewWorkerErrorCode, string>>;

export function openFabStationProposalReviewWorkerErrorMessage(
	code: OpenFabStationProposalReviewWorkerErrorCode,
): string {
	return ERROR_MESSAGES[code];
}

interface OpenFabStationProposalReviewWorkerCorrelation {
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly ticketId: number;
}

/** First and only evaluation request accepted by one disposable Worker session. */
export interface EvaluateOpenFabStationProposalReviewWorkerRequest
	extends OpenFabStationProposalReviewWorkerCorrelation {
	readonly type: "EVALUATE_OPENFAB_STATION_PROPOSAL_REVIEW";
	readonly proposalSemanticFingerprint: string;
	readonly proposalSnapshotFingerprint: string;
	readonly draftFingerprint: string;
	readonly sourceChecksum: string;
	readonly proposal: OpenFabStationProposalArtifact;
	readonly draft: OpenFabStationProposalReviewDraftSnapshot;
	readonly snapshot: RailMirrorSnapshot;
}

/** Explicit user intent. Only the Worker session that retained READY may accept this request. */
export interface ApplyOpenFabStationProposalReviewWorkerRequest
	extends OpenFabStationProposalReviewWorkerCorrelation {
	readonly type: "APPLY_OPENFAB_STATION_PROPOSAL_REVIEW";
	readonly evaluationRequestId: number;
	readonly evaluationSnapshotFingerprint: string;
	readonly reviewFingerprint: string;
}

export interface OpenFabStationProposalReviewWorkerTicket {
	readonly ticketId: number;
	readonly evaluationRequestId: number;
	readonly applyRequestId: number;
	readonly validationLevel: "exact";
	readonly requestGeneration: number;
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly proposalSemanticFingerprint: string;
	readonly proposalSnapshotFingerprint: string;
	readonly draftFingerprint: string;
	readonly evaluationSnapshotFingerprint: string;
	readonly reviewFingerprint: string;
	readonly planArtifactFingerprint: string;
	readonly planFingerprint: string;
	readonly planKindCode: number;
	readonly portCount: number;
	readonly groupCount: number;
	readonly prospectiveChecksum: string;
	readonly prospectiveNextAdvancedSwitchId: number;
	readonly prospectiveNextPortId: number;
	readonly prospectiveNextEquipmentGroupId: number;
	readonly prospectiveNextOrganizationId: number;
}

export interface OpenFabStationProposalReviewEvaluatedResponse
	extends OpenFabStationProposalReviewWorkerCorrelation {
	readonly type: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED";
	readonly proposalSemanticFingerprint: string;
	readonly proposalSnapshotFingerprint: string;
	readonly draftFingerprint: string;
	readonly sourceChecksum: string;
	readonly evaluation: OpenFabStationProposalReviewEvaluationArtifact;
}

export interface OpenFabStationProposalReviewPlanPreparedResponse
	extends OpenFabStationProposalReviewWorkerCorrelation {
	readonly type: "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED";
	readonly ticket: OpenFabStationProposalReviewWorkerTicket;
	readonly planArtifact: OpenFabStationProposalReviewedPlanArtifact;
}

export interface OpenFabStationProposalReviewErrorResponse
	extends OpenFabStationProposalReviewWorkerCorrelation {
	readonly type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR";
	readonly code: OpenFabStationProposalReviewWorkerErrorCode;
	readonly message: string;
}

export type OpenFabStationProposalReviewWorkerRequest =
	| EvaluateOpenFabStationProposalReviewWorkerRequest
	| ApplyOpenFabStationProposalReviewWorkerRequest;

export type OpenFabStationProposalReviewWorkerResponse =
	| OpenFabStationProposalReviewEvaluatedResponse
	| OpenFabStationProposalReviewPlanPreparedResponse
	| OpenFabStationProposalReviewErrorResponse;
