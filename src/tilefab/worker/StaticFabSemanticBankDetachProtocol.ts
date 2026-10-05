import type { StaticFabSemanticBankDetachProspectiveReview } from "../compile/StaticFabSemanticBankDetachProspective";
import type {
	StaticFabSemanticBankDetachIntent,
	StaticFabSemanticBankDetachPlan,
	StaticFabSemanticBankDetachReview,
} from "../core/StaticFabSemanticBankDetach";
import type {
	StaticFabSemanticBankDetachSourceIdentity,
	StaticFabSemanticBankDetachWorkerTicket,
} from "../core/StaticFabSemanticBankDetachCertification";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION = 1 as const;

export interface PrepareStaticFabSemanticBankDetachRequest {
	readonly type: "PREPARE_STATIC_FAB_SEMANTIC_BANK_DETACH";
	readonly version: typeof STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly ticketId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly expectedSource: StaticFabSemanticBankDetachSourceIdentity;
	readonly intent: StaticFabSemanticBankDetachIntent;
	readonly expectedIntentFingerprint: string;
}

export interface PreparedStaticFabSemanticBankDetach {
	readonly valid: boolean;
	readonly failureCode: string | null;
	readonly reason: string;
	readonly plan: StaticFabSemanticBankDetachPlan | null;
	readonly review: StaticFabSemanticBankDetachReview | null;
	readonly ticket: StaticFabSemanticBankDetachWorkerTicket | null;
	readonly evidence: StaticFabSemanticBankDetachProspectiveReview | null;
}

export type StaticFabSemanticBankDetachWorkerRequest = PrepareStaticFabSemanticBankDetachRequest;
export interface StaticFabSemanticBankDetachWorkerResponse {
	readonly type: "STATIC_FAB_SEMANTIC_BANK_DETACH_PREPARED";
	readonly version: typeof STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabSemanticBankDetach;
}
