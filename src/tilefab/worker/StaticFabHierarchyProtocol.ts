import type { StaticFabHierarchyIndexSnapshot } from "../compile/StaticFabHierarchySnapshot";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export interface PrepareStaticFabHierarchyRequest {
	readonly type: "PREPARE_STATIC_FAB_HIERARCHY";
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
}

export interface PreparedStaticFabHierarchy {
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly hierarchySnapshot: StaticFabHierarchyIndexSnapshot;
	readonly preparationMilliseconds: number;
}

export interface StaticFabHierarchyPreparedResponse {
	readonly type: "STATIC_FAB_HIERARCHY_PREPARED";
	readonly requestId: number;
	readonly prepared: PreparedStaticFabHierarchy;
}

export interface StaticFabHierarchyErrorResponse {
	readonly type: "STATIC_FAB_HIERARCHY_ERROR";
	readonly requestId: number;
	readonly message: string;
}

export type StaticFabHierarchyWorkerRequest = PrepareStaticFabHierarchyRequest;
export type StaticFabHierarchyWorkerResponse =
	| StaticFabHierarchyPreparedResponse
	| StaticFabHierarchyErrorResponse;
