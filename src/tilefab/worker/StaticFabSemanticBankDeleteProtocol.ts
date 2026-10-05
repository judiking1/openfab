import type { StaticFabSemanticBankDeleteProspectiveReview } from "../compile/StaticFabSemanticBankDeleteProspective";
import type { OperationalConfigurationState } from "../core/OperationalConfiguration";
import type {
	StaticFabSemanticBankDeleteIntent,
	StaticFabSemanticBankDeletePlan,
	StaticFabSemanticBankDeleteReview,
} from "../core/StaticFabSemanticBankDelete";
import type {
	StaticFabSemanticBankDeleteSourceIdentity,
	StaticFabSemanticBankDeleteWorkerTicket,
} from "../core/StaticFabSemanticBankDeleteCertification";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_SEMANTIC_BANK_DELETE_PROTOCOL_VERSION = 1 as const;

export interface PrepareStaticFabSemanticBankDeleteRequest {
	readonly type: "PREPARE_STATIC_FAB_SEMANTIC_BANK_DELETE";
	readonly version: typeof STATIC_FAB_SEMANTIC_BANK_DELETE_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly ticketId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly operationalConfiguration: OperationalConfigurationState;
	readonly expectedSource: StaticFabSemanticBankDeleteSourceIdentity;
	readonly intent: StaticFabSemanticBankDeleteIntent;
	readonly expectedIntentFingerprint: string;
}

export interface PreparedStaticFabSemanticBankDelete {
	readonly valid: boolean;
	readonly failureCode: string | null;
	readonly reason: string;
	readonly plan: StaticFabSemanticBankDeletePlan | null;
	readonly review: StaticFabSemanticBankDeleteReview | null;
	readonly ticket: StaticFabSemanticBankDeleteWorkerTicket | null;
	readonly evidence: StaticFabSemanticBankDeleteProspectiveReview | null;
}

export type StaticFabSemanticBankDeleteWorkerRequest = PrepareStaticFabSemanticBankDeleteRequest;
export interface StaticFabSemanticBankDeleteWorkerResponse {
	readonly type: "STATIC_FAB_SEMANTIC_BANK_DELETE_PREPARED";
	readonly version: typeof STATIC_FAB_SEMANTIC_BANK_DELETE_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabSemanticBankDelete;
}
