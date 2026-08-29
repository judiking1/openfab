import type {
	StaticFabOrganizationBundle,
	StaticFabOrganizationBundleQuarterTurns,
} from "../core/StaticFabOrganizationBundle";
import type {
	StaticFabOrganizationBundlePlacementWorkerTicket as CoreStaticFabOrganizationBundlePlacementWorkerTicket,
	StaticFabOrganizationBundlePlacementPlan,
} from "../core/StaticFabOrganizationBundlePlacement";
import type { Cell } from "../core/TileMap";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export const STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT = 512;

export type StaticFabOrganizationBundlePlacementFailureCode =
	| "snapshot"
	| "stale"
	| "fingerprint"
	| "bundle"
	| "plan"
	| "clearance"
	| "compile";

/** Immutable intent from which the disposable Worker must both plan and validate placement. */
export interface PrepareStaticFabOrganizationBundlePlacementRequest {
	readonly type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT";
	readonly requestId: number;
	readonly ticketId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly bundle: StaticFabOrganizationBundle;
	readonly expectedBundleFingerprint: string;
	readonly anchor: Cell;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
}

export type StaticFabOrganizationBundlePlacementWorkerTicket =
	CoreStaticFabOrganizationBundlePlacementWorkerTicket;

/**
 * Exact Worker output. Only a valid result carries a full plan and ticket; the main core must still
 * adopt both through its opaque one-shot permit before RailDocument can commit anything.
 */
export interface PreparedStaticFabOrganizationBundlePlacement {
	readonly plan: StaticFabOrganizationBundlePlacementPlan | null;
	readonly ticket: StaticFabOrganizationBundlePlacementWorkerTicket | null;
	readonly valid: boolean;
	readonly failureCode: StaticFabOrganizationBundlePlacementFailureCode | null;
	readonly reason: string;
	readonly conflictCells: readonly Cell[];
	readonly conflictCount: number;
	readonly candidateCommittedEnvelopePairs: number;
	readonly testedCommittedEnvelopePairs: number;
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabOrganizationBundlePlacementPreparedResponse {
	readonly type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED";
	readonly requestId: number;
	readonly prepared: PreparedStaticFabOrganizationBundlePlacement;
}

export interface StaticFabOrganizationBundlePlacementErrorResponse {
	readonly type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_ERROR";
	readonly requestId: number;
	readonly message: string;
}

export type StaticFabOrganizationBundlePlacementWorkerRequest =
	PrepareStaticFabOrganizationBundlePlacementRequest;

export type StaticFabOrganizationBundlePlacementWorkerResponse =
	| StaticFabOrganizationBundlePlacementPreparedResponse
	| StaticFabOrganizationBundlePlacementErrorResponse;
