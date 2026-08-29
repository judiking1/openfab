import type { StaticFabArrangementWorkerTicket } from "../core/StaticFabArrangementCertification";
import type { StaticFabArrangementCommandIntent } from "../core/StaticFabArrangementCommand";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import type { Cell } from "../core/TileMap";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT = 512;
export const STATIC_FAB_ARRANGEMENT_SESSION_VERSION = 2;

export type StaticFabArrangementFailureCode =
	| "snapshot"
	| "fingerprint"
	| "selection"
	| "plan"
	| "clearance"
	| "compile";

export interface StaticFabArrangementSessionSourceIdentity {
	readonly revision: number;
	readonly sequence: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

export interface InitializeStaticFabArrangementSessionRequest {
	readonly type: "INITIALIZE_STATIC_FAB_ARRANGEMENT_SESSION";
	readonly version: typeof STATIC_FAB_ARRANGEMENT_SESSION_VERSION;
	readonly sessionId: number;
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
}

export interface PrepareStaticFabArrangementRequest {
	readonly type: "PREPARE_STATIC_FAB_ARRANGEMENT";
	readonly version: typeof STATIC_FAB_ARRANGEMENT_SESSION_VERSION;
	readonly sessionId: number;
	readonly requestId: number;
	readonly ticketId: number;
	readonly intent: StaticFabArrangementCommandIntent;
	readonly expectedIntentFingerprint: string;
}

export interface PreparedStaticFabArrangement {
	readonly plan: StaticFabArrangementPlan | null;
	readonly ticket: StaticFabArrangementWorkerTicket | null;
	readonly valid: boolean;
	readonly failureCode: StaticFabArrangementFailureCode | null;
	readonly reason: string;
	readonly conflictCells: readonly Cell[];
	readonly conflictCount: number;
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabArrangementPreparedResponse {
	readonly type: "STATIC_FAB_ARRANGEMENT_PREPARED";
	readonly version: typeof STATIC_FAB_ARRANGEMENT_SESSION_VERSION;
	readonly sessionId: number;
	readonly requestId: number;
	readonly sourcePlanIndex: number;
	readonly prepared: PreparedStaticFabArrangement;
}

export interface StaticFabArrangementSessionReadyResponse {
	readonly type: "STATIC_FAB_ARRANGEMENT_SESSION_READY";
	readonly version: typeof STATIC_FAB_ARRANGEMENT_SESSION_VERSION;
	readonly sessionId: number;
	readonly requestId: number;
	readonly source: StaticFabArrangementSessionSourceIdentity;
	readonly hydrationMilliseconds: number;
	readonly compilationMilliseconds: number;
}

export interface StaticFabArrangementErrorResponse {
	readonly type: "STATIC_FAB_ARRANGEMENT_ERROR";
	readonly version: typeof STATIC_FAB_ARRANGEMENT_SESSION_VERSION;
	readonly sessionId: number;
	readonly requestId: number;
	readonly sourcePlanIndex: number | null;
	readonly message: string;
}

export type StaticFabArrangementWorkerRequest =
	| InitializeStaticFabArrangementSessionRequest
	| PrepareStaticFabArrangementRequest;
export type StaticFabArrangementWorkerResponse =
	| StaticFabArrangementSessionReadyResponse
	| StaticFabArrangementPreparedResponse
	| StaticFabArrangementErrorResponse;
