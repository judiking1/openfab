import type {
	StaticFabAssemblyConnectorIntent,
	StaticFabAssemblyConnectorPlan,
} from "../core/StaticFabAssemblyConnector";
import type { StaticFabAssemblyConnectorWorkerTicket } from "../core/StaticFabAssemblyConnectorCertification";
import type { Cell } from "../core/TileMap";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION = 5 as const;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT = 512;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_PLAN_CELLS = 4_096;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_ORGANIZATION_MUTATIONS = 256;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT = 4_096;

export type StaticFabAssemblyConnectorFailureCode =
	| "snapshot"
	| "intent"
	| "fingerprint"
	| "stale"
	| "plan"
	| "clearance"
	| "compile";

export interface HydrateStaticFabAssemblyConnectorRequest {
	readonly type: "HYDRATE_STATIC_FAB_ASSEMBLY_CONNECTOR";
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
}

export interface PrepareBoundStaticFabAssemblyConnectorRequest {
	readonly type: "PREPARE_STATIC_FAB_ASSEMBLY_CONNECTOR";
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly ticketId: number;
	readonly intent: StaticFabAssemblyConnectorIntent;
	readonly expectedIntentFingerprint: string;
	readonly expectedSourceRevision: number;
	readonly expectedSourcePatchSequence: number;
	readonly expectedSourceChecksum: string;
	readonly expectedSourceNextAdvancedSwitchId: number;
	readonly expectedSourceNextPortId: number;
	readonly expectedSourceNextEquipmentGroupId: number;
	readonly expectedSourceNextOrganizationId: number;
}

/** Pure-runtime compatibility input. Browser Workers use hydrate + bound prepare messages. */
export interface PrepareStaticFabAssemblyConnectorRequest
	extends Omit<
		PrepareBoundStaticFabAssemblyConnectorRequest,
		| "expectedSourceRevision"
		| "expectedSourcePatchSequence"
		| "expectedSourceChecksum"
		| "expectedSourceNextAdvancedSwitchId"
		| "expectedSourceNextPortId"
		| "expectedSourceNextEquipmentGroupId"
		| "expectedSourceNextOrganizationId"
	> {
	readonly snapshot: RailMirrorSnapshot;
}

export interface PreparedStaticFabAssemblyConnector {
	readonly plan: StaticFabAssemblyConnectorPlan | null;
	readonly ticket: StaticFabAssemblyConnectorWorkerTicket | null;
	readonly valid: boolean;
	readonly failureCode: StaticFabAssemblyConnectorFailureCode | null;
	readonly reason: string;
	readonly conflictCells: readonly Cell[];
	readonly conflictCount: number;
	readonly candidateCommittedEnvelopePairs: number;
	readonly testedCommittedEnvelopePairs: number;
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabAssemblyConnectorPreparedResponse {
	readonly type: "STATIC_FAB_ASSEMBLY_CONNECTOR_PREPARED";
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedStaticFabAssemblyConnector;
}

export interface StaticFabAssemblyConnectorHydratedResponse {
	readonly type: "STATIC_FAB_ASSEMBLY_CONNECTOR_HYDRATED";
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly hydrationMilliseconds: number;
}

export interface StaticFabAssemblyConnectorErrorResponse {
	readonly type: "STATIC_FAB_ASSEMBLY_CONNECTOR_ERROR";
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly message: string;
}

export type StaticFabAssemblyConnectorWorkerRequest =
	| HydrateStaticFabAssemblyConnectorRequest
	| PrepareBoundStaticFabAssemblyConnectorRequest;

export type StaticFabAssemblyConnectorWorkerResponse =
	| StaticFabAssemblyConnectorHydratedResponse
	| StaticFabAssemblyConnectorPreparedResponse
	| StaticFabAssemblyConnectorErrorResponse;
