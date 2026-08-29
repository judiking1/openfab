import type { OpenFabUserBlueprintRecord } from "../project/OpenFabUserBlueprintLibrary";
import type {
	OpenFabUserBlueprintLibraryBundle,
	OpenFabUserBlueprintLibraryConflictDecision,
	OpenFabUserBlueprintLibraryReplaceImpact,
	OpenFabUserBlueprintLibraryRestoreMode,
	OpenFabUserBlueprintLibraryRestorePlan,
	OpenFabUserBlueprintLibraryRestorePlanPreview,
	OpenFabUserBlueprintLibraryRestorePreflight,
} from "../project/OpenFabUserBlueprintLibraryBundle";

export type OpenFabUserBlueprintLibraryRestoreDecisionEntries = readonly (readonly [
	recordId: string,
	decision: OpenFabUserBlueprintLibraryConflictDecision,
])[];

export interface OpenFabUserBlueprintLibraryRestoreInspectRequest {
	readonly type: "INSPECT_OPENFAB_USER_BLUEPRINT_LIBRARY";
	readonly requestId: number;
	readonly json: string;
	readonly currentRecords: readonly OpenFabUserBlueprintRecord[];
}

export interface OpenFabUserBlueprintLibraryRestorePreviewRequest {
	readonly type: "PREVIEW_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE";
	readonly requestId: number;
	readonly mode: OpenFabUserBlueprintLibraryRestoreMode;
	readonly decisions: OpenFabUserBlueprintLibraryRestoreDecisionEntries;
}

export interface OpenFabUserBlueprintLibraryRestorePlanRequest {
	readonly type: "PLAN_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE";
	readonly requestId: number;
	readonly mode: OpenFabUserBlueprintLibraryRestoreMode;
	readonly decisions: OpenFabUserBlueprintLibraryRestoreDecisionEntries;
	readonly restoredAt: string;
}

export interface OpenFabUserBlueprintLibraryRestoreRebaseRequest {
	readonly type: "REBASE_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE";
	readonly requestId: number;
	readonly currentRecords: readonly OpenFabUserBlueprintRecord[];
}

export interface OpenFabUserBlueprintLibraryRestoreInspectedResponse {
	readonly type: "OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED";
	readonly requestId: number;
	readonly bundle: OpenFabUserBlueprintLibraryBundle;
	readonly preflight: OpenFabUserBlueprintLibraryRestorePreflight;
	readonly replaceImpact: OpenFabUserBlueprintLibraryReplaceImpact;
	readonly elapsedMilliseconds: number;
}

export interface OpenFabUserBlueprintLibraryRestorePreviewedResponse {
	readonly type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PREVIEWED";
	readonly requestId: number;
	readonly preview: OpenFabUserBlueprintLibraryRestorePlanPreview;
	readonly elapsedMilliseconds: number;
}

export interface OpenFabUserBlueprintLibraryRestorePlannedResponse {
	readonly type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PLANNED";
	readonly requestId: number;
	readonly plan: OpenFabUserBlueprintLibraryRestorePlan;
	readonly elapsedMilliseconds: number;
}

export interface OpenFabUserBlueprintLibraryRestoreErrorResponse {
	readonly type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_ERROR";
	readonly requestId: number;
	readonly message: string;
}

export type OpenFabUserBlueprintLibraryRestoreWorkerRequest =
	| OpenFabUserBlueprintLibraryRestoreInspectRequest
	| OpenFabUserBlueprintLibraryRestorePreviewRequest
	| OpenFabUserBlueprintLibraryRestorePlanRequest
	| OpenFabUserBlueprintLibraryRestoreRebaseRequest;

export type OpenFabUserBlueprintLibraryRestoreWorkerResponse =
	| OpenFabUserBlueprintLibraryRestoreInspectedResponse
	| OpenFabUserBlueprintLibraryRestorePreviewedResponse
	| OpenFabUserBlueprintLibraryRestorePlannedResponse
	| OpenFabUserBlueprintLibraryRestoreErrorResponse;
