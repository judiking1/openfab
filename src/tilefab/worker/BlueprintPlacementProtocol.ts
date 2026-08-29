import type {
	RailAreaStampPlan,
	RailAreaStampPose,
	RailAreaStampTemplate,
} from "../core/RailAreaStamp";
import type { StaticFabBlueprintTemplate, StaticFabMutationPlan } from "../core/StaticFabBlueprint";
import type { Cell } from "../core/TileMap";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const BLUEPRINT_PLACEMENT_CONFLICT_LIMIT = 512;
/** Maximum detail retained in each display-only plan array when placement is rejected. */
export const BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT = 512;

export interface PrepareBlueprintPlacementRequest {
	readonly type: "PREPARE_BLUEPRINT_PLACEMENT";
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly railTemplate: RailAreaStampTemplate;
	readonly staticFabTemplate: StaticFabBlueprintTemplate | null;
	readonly anchor: Cell;
	readonly pose: RailAreaStampPose;
}

export interface PreparedBlueprintPlacement {
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly plan: RailAreaStampPlan | StaticFabMutationPlan;
	/** Commit gate. A false result carries a sampled display plan and must never be committed. */
	readonly valid: boolean;
	readonly reason: string;
	readonly conflictCells: readonly Cell[];
	readonly conflictCount: number;
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface BlueprintPlacementPreparedResponse {
	readonly type: "BLUEPRINT_PLACEMENT_PREPARED";
	readonly requestId: number;
	readonly prepared: PreparedBlueprintPlacement;
}

export interface BlueprintPlacementErrorResponse {
	readonly type: "BLUEPRINT_PLACEMENT_ERROR";
	readonly requestId: number;
	readonly message: string;
}

export type BlueprintPlacementWorkerRequest = PrepareBlueprintPlacementRequest;
export type BlueprintPlacementWorkerResponse =
	| BlueprintPlacementPreparedResponse
	| BlueprintPlacementErrorResponse;
