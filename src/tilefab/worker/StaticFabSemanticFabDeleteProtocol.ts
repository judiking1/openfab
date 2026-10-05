import type { StaticFabSemanticFabDeleteProspectiveReview } from "../compile/StaticFabSemanticFabDeleteProspective";
import type { OperationalConfigurationState } from "../core/OperationalConfiguration";
import type {
	StaticFabSemanticFabDeleteIntent,
	StaticFabSemanticFabDeletePlan,
	StaticFabSemanticFabDeleteReview,
} from "../core/StaticFabSemanticFabDelete";
import type {
	StaticFabSemanticFabDeleteSourceIdentity,
	StaticFabSemanticFabDeleteWorkerTicket,
} from "../core/StaticFabSemanticFabDeleteCertification";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION = 1 as const;

export interface PrepareStaticFabSemanticFabDeleteRequest {
	readonly type: "PREPARE_STATIC_FAB_SEMANTIC_FAB_DELETE";
	readonly version: typeof STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly ticketId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly operationalConfiguration: OperationalConfigurationState;
	readonly expectedSource: StaticFabSemanticFabDeleteSourceIdentity;
	readonly intent: StaticFabSemanticFabDeleteIntent;
	readonly expectedIntentFingerprint: string;
}

export interface PreparedStaticFabSemanticFabDelete {
	readonly valid: boolean;
	readonly failureCode: string | null;
	readonly reason: string;
	readonly plan: StaticFabSemanticFabDeletePlan | null;
	readonly review: StaticFabSemanticFabDeleteReview | null;
	readonly ticket: StaticFabSemanticFabDeleteWorkerTicket | null;
	readonly evidence: StaticFabSemanticFabDeleteProspectiveReview | null;
}

export type StaticFabSemanticFabDeleteWorkerRequest = PrepareStaticFabSemanticFabDeleteRequest;
export interface StaticFabSemanticFabDeleteWorkerResponse {
	readonly type: "STATIC_FAB_SEMANTIC_FAB_DELETE_PREPARED";
	readonly version: typeof STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabSemanticFabDelete;
}
