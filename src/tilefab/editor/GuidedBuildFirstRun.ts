import type { GuidedBuildPreferences } from "./GuidedBuildPreferences";

export type GuidedBuildPreferenceLoadStatus = "loading" | "ready" | "unavailable";

export interface GuidedBuildFirstRunEvidence {
	readonly preferenceLoadStatus: GuidedBuildPreferenceLoadStatus;
	readonly preferences: GuidedBuildPreferences | null;
	readonly alreadyConsideredThisSession: boolean;
	readonly startupReady: boolean;
	readonly recentLookupComplete: boolean;
	readonly recoveryLookupComplete: boolean;
	readonly recentProjectCount: number;
	readonly hasRecoveryProject: boolean;
	readonly authoredRecordCount: number;
	readonly projectOperationIdle: boolean;
	readonly modelSyncPending: boolean;
	readonly blockingSurfaceOpen: boolean;
	readonly scaleAcceptanceActive: boolean;
}

export type GuidedBuildFirstRunDecision =
	| { readonly action: "open"; readonly reason: "FIRST_SAFE_EMPTY_SESSION" }
	| { readonly action: "wait"; readonly reason: GuidedBuildFirstRunWaitReason }
	| { readonly action: "suppress"; readonly reason: GuidedBuildFirstRunSuppressReason };

export type GuidedBuildFirstRunWaitReason =
	| "PREFERENCES_LOADING"
	| "STARTUP_PENDING"
	| "PROJECT_METADATA_PENDING"
	| "PROJECT_OPERATION_ACTIVE"
	| "MODEL_SYNC_PENDING";

export type GuidedBuildFirstRunSuppressReason =
	| "ALREADY_CONSIDERED"
	| "PREFERENCES_UNAVAILABLE"
	| "ENTRY_ALREADY_CHOSEN"
	| "RECOVERY_AVAILABLE"
	| "RETURNING_PROJECTS_AVAILABLE"
	| "AUTHORED_PROJECT_ACTIVE"
	| "BLOCKING_SURFACE_ACTIVE"
	| "SCALE_ACCEPTANCE_ACTIVE";

export function evaluateGuidedBuildFirstRun(
	evidence: GuidedBuildFirstRunEvidence,
): GuidedBuildFirstRunDecision {
	if (evidence.alreadyConsideredThisSession) {
		return decision("suppress", "ALREADY_CONSIDERED");
	}
	if (evidence.preferenceLoadStatus === "loading") {
		return decision("wait", "PREFERENCES_LOADING");
	}
	if (evidence.preferenceLoadStatus === "unavailable") {
		return decision("suppress", "PREFERENCES_UNAVAILABLE");
	}
	if (evidence.preferences?.lastEntryChoice) {
		return decision("suppress", "ENTRY_ALREADY_CHOSEN");
	}
	if (!evidence.startupReady) return decision("wait", "STARTUP_PENDING");
	if (!evidence.recentLookupComplete || !evidence.recoveryLookupComplete) {
		return decision("wait", "PROJECT_METADATA_PENDING");
	}
	if (evidence.hasRecoveryProject) return decision("suppress", "RECOVERY_AVAILABLE");
	if (evidence.recentProjectCount > 0) {
		return decision("suppress", "RETURNING_PROJECTS_AVAILABLE");
	}
	if (evidence.authoredRecordCount > 0) {
		return decision("suppress", "AUTHORED_PROJECT_ACTIVE");
	}
	if (!evidence.projectOperationIdle) return decision("wait", "PROJECT_OPERATION_ACTIVE");
	if (evidence.modelSyncPending) return decision("wait", "MODEL_SYNC_PENDING");
	if (evidence.blockingSurfaceOpen) {
		return decision("suppress", "BLOCKING_SURFACE_ACTIVE");
	}
	if (evidence.scaleAcceptanceActive) {
		return decision("suppress", "SCALE_ACCEPTANCE_ACTIVE");
	}
	return decision("open", "FIRST_SAFE_EMPTY_SESSION");
}

function decision<
	Action extends GuidedBuildFirstRunDecision["action"],
	Reason extends Extract<GuidedBuildFirstRunDecision, { readonly action: Action }>["reason"],
>(action: Action, reason: Reason): Readonly<{ readonly action: Action; readonly reason: Reason }> {
	return Object.freeze({ action, reason });
}
