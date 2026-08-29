import type {
	StaticFabBayFlowEditIntent,
	StaticFabBayFlowEditPlan,
	StaticFabBayFlowEditReview,
} from "../core/StaticFabBayFlowEdit";
import type { StaticFabBayFlowEditWorkerTicket } from "../core/StaticFabBayFlowEditCertification";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION = 1 as const;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT = 4_096;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS = 65_536;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_SWITCH_MUTATIONS = 0;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_PORT_MUTATIONS = 0;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_EQUIPMENT_GROUP_MUTATIONS = 0;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_ORGANIZATION_MUTATIONS = 1_024;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_REVIEW_IDS = 4_096;
export const STATIC_FAB_BAY_FLOW_EDIT_MAX_REVIEW_KEYS = 8_192;
export const STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT = 256;

export type StaticFabBayFlowEditFailureCode =
	| "snapshot"
	| "intent"
	| "fingerprint"
	| "stale"
	| "source-topology"
	| "plan"
	| "prospective"
	| "topology"
	| "compile";

export interface StaticFabBayFlowEditSourceIdentity {
	readonly revision: number;
	readonly patchSequence: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

/** Exact authored and compiled facts for one immutable source or prospective generation. */
export interface StaticFabBayFlowEditTopologyEvidence {
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

export interface HydrateStaticFabBayFlowEditRequest {
	readonly type: "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT";
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
}

export interface PrepareBoundStaticFabBayFlowEditRequest {
	readonly type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT";
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly ticketId: number;
	readonly intent: StaticFabBayFlowEditIntent;
	readonly expectedIntentFingerprint: string;
	readonly expectedSource: StaticFabBayFlowEditSourceIdentity;
}

/** Pure-runtime compatibility input. Browser Workers use hydrate + bound prepare messages. */
export interface PrepareStaticFabBayFlowEditRequest
	extends Omit<PrepareBoundStaticFabBayFlowEditRequest, "expectedSource"> {
	readonly snapshot: RailMirrorSnapshot;
}

export interface PreparedStaticFabBayFlowEdit {
	readonly plan: StaticFabBayFlowEditPlan | null;
	readonly review: StaticFabBayFlowEditReview | null;
	readonly ticket: StaticFabBayFlowEditWorkerTicket | null;
	readonly sourceEvidence: StaticFabBayFlowEditTopologyEvidence | null;
	readonly prospectiveEvidence: StaticFabBayFlowEditTopologyEvidence | null;
	readonly valid: boolean;
	readonly failureCode: StaticFabBayFlowEditFailureCode | null;
	readonly reason: string;
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabBayFlowEditHydratedResponse {
	readonly type: "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED";
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly source: StaticFabBayFlowEditSourceIdentity;
	readonly sourceEvidence: StaticFabBayFlowEditTopologyEvidence;
	readonly hydrationMilliseconds: number;
}

export interface StaticFabBayFlowEditPreparedResponse {
	readonly type: "STATIC_FAB_BAY_FLOW_EDIT_PREPARED";
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabBayFlowEdit;
}

export interface StaticFabBayFlowEditErrorResponse {
	readonly type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR";
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly message: string;
}

export type StaticFabBayFlowEditWorkerRequest =
	| HydrateStaticFabBayFlowEditRequest
	| PrepareBoundStaticFabBayFlowEditRequest;

export type StaticFabBayFlowEditWorkerResponse =
	| StaticFabBayFlowEditHydratedResponse
	| StaticFabBayFlowEditPreparedResponse
	| StaticFabBayFlowEditErrorResponse;
