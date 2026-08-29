import type {
	StaticFabSemanticBayMutationIntent,
	StaticFabSemanticBayMutationPlan,
	StaticFabSemanticBayMutationReview,
} from "../core/StaticFabSemanticBayMutation";
import type { StaticFabSemanticBayMutationWorkerTicket } from "../core/StaticFabSemanticBayMutationCertification";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION = 1 as const;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT = 4_096;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RAIL_MUTATIONS = 65_536;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_SWITCH_MUTATIONS = 4_096;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_PORT_MUTATIONS = 4_096;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_EQUIPMENT_GROUP_MUTATIONS = 1_024;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_ORGANIZATION_MUTATIONS = 1_024;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_REVIEW_IDS = 4_096;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_REVIEW_KEYS = 8_192;
export const STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT = 256;

export type StaticFabSemanticBayMutationFailureCode =
	| "snapshot"
	| "intent"
	| "fingerprint"
	| "stale"
	| "source-topology"
	| "plan"
	| "prospective"
	| "topology"
	| "compile";

export interface StaticFabSemanticBayMutationSourceIdentity {
	readonly revision: number;
	readonly patchSequence: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

/** Exact authored and compiled facts for one immutable source or prospective generation. */
export interface StaticFabSemanticBayMutationTopologyEvidence {
	readonly authoredCellCount: number;
	readonly authoredDirectedEdgeCount: number;
	readonly authoredStatus: "empty" | "open" | "disconnected" | "unsafe" | "closed";
	readonly authoredComponentCount: number;
	readonly authoredStrongComponentCount: number;
	readonly authoredOpenTerminalCount: number;
	readonly authoredUnsafeJunctionCount: number;
	readonly authoredComponentsClosed: boolean;
	readonly physicalValid: boolean;
	readonly physicalPathCount: number;
	readonly physicalComponentCount: number;
	readonly physicalStrongComponentCount: number;
	readonly physicalOpenPathCount: number;
	readonly physicalInvalidPathCount: number;
	readonly physicalDiagnosticCount: number;
	readonly physicalTerminalCount: number;
	readonly physicalClearanceIssueCount: number;
	readonly physicalComponentsClosed: boolean;
}

export interface HydrateStaticFabSemanticBayMutationRequest {
	readonly type: "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION";
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
}

export interface PrepareBoundStaticFabSemanticBayMutationRequest {
	readonly type: "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION";
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly ticketId: number;
	readonly intent: StaticFabSemanticBayMutationIntent;
	readonly expectedIntentFingerprint: string;
	readonly expectedSource: StaticFabSemanticBayMutationSourceIdentity;
}

/** Pure-runtime compatibility input. Browser Workers use hydrate + bound prepare messages. */
export interface PrepareStaticFabSemanticBayMutationRequest
	extends Omit<PrepareBoundStaticFabSemanticBayMutationRequest, "expectedSource"> {
	readonly snapshot: RailMirrorSnapshot;
}

export interface PreparedStaticFabSemanticBayMutation {
	readonly plan: StaticFabSemanticBayMutationPlan | null;
	readonly review: StaticFabSemanticBayMutationReview | null;
	readonly ticket: StaticFabSemanticBayMutationWorkerTicket | null;
	readonly sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
	readonly prospectiveEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
	readonly valid: boolean;
	readonly failureCode: StaticFabSemanticBayMutationFailureCode | null;
	readonly reason: string;
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabSemanticBayMutationHydratedResponse {
	readonly type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_HYDRATED";
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly source: StaticFabSemanticBayMutationSourceIdentity;
	readonly sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence;
	readonly hydrationMilliseconds: number;
}

export interface StaticFabSemanticBayMutationPreparedResponse {
	readonly type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED";
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabSemanticBayMutation;
}

export interface StaticFabSemanticBayMutationErrorResponse {
	readonly type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_ERROR";
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly message: string;
}

export type StaticFabSemanticBayMutationWorkerRequest =
	| HydrateStaticFabSemanticBayMutationRequest
	| PrepareBoundStaticFabSemanticBayMutationRequest;

export type StaticFabSemanticBayMutationWorkerResponse =
	| StaticFabSemanticBayMutationHydratedResponse
	| StaticFabSemanticBayMutationPreparedResponse
	| StaticFabSemanticBayMutationErrorResponse;
