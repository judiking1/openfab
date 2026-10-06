import type { StaticFabReviewOrganizationLabels } from "./StaticFabSemanticImpactReviewLabels";

export const STATIC_FAB_SEMANTIC_FAB_DELETE_SAMPLE_LIMIT = 4;

/** Presentation only. Delete authority remains in its separate certified plan and bridge. */
export interface StaticFabSemanticFabDeleteImpactRow {
	readonly label: string;
	readonly count: number;
	readonly samples: readonly (number | string)[];
}

export interface StaticFabSemanticFabDeleteReviewView {
	readonly action: "DELETE";
	readonly targetRole: "FAB";
	readonly fabOrganizationId: number;
	readonly planFingerprint: string;
	readonly organizationLabels?: StaticFabReviewOrganizationLabels | null;
	readonly preserved: readonly StaticFabSemanticFabDeleteImpactRow[];
	readonly removed: readonly StaticFabSemanticFabDeleteImpactRow[];
}

export interface StaticFabSemanticFabDeleteEvidenceMetric {
	readonly label: string;
	readonly value: number | string;
}

export interface StaticFabSemanticFabDeleteEvidenceView {
	readonly checks: readonly StaticFabSemanticFabDeleteEvidenceMetric[];
	readonly source: readonly StaticFabSemanticFabDeleteEvidenceMetric[];
	readonly prospective: readonly StaticFabSemanticFabDeleteEvidenceMetric[];
}

export interface StaticFabSemanticFabDeleteSession {
	readonly action: "DELETE";
	readonly targetRole: "FAB";
	readonly fabOrganizationId: number;
	readonly fabName: string;
	readonly requestSequence: number;
	readonly phase: "analyzing" | "ready" | "rejected" | "applying";
	readonly reason: string;
	readonly review: StaticFabSemanticFabDeleteReviewView | null;
	readonly evidence: StaticFabSemanticFabDeleteEvidenceView | null;
}

export type StaticFabSemanticFabDeleteSessionAction =
	| Readonly<{
			type: "ANALYSIS_READY";
			requestSequence: number;
			reason: string;
			review: StaticFabSemanticFabDeleteReviewView;
			evidence: StaticFabSemanticFabDeleteEvidenceView;
	  }>
	| Readonly<{
			type: "ANALYSIS_REJECTED";
			requestSequence: number;
			reason: string;
			review?: StaticFabSemanticFabDeleteReviewView | null;
			evidence?: StaticFabSemanticFabDeleteEvidenceView | null;
	  }>
	| Readonly<{ type: "RETRY"; requestSequence: number }>
	| Readonly<{ type: "APPLY" }>
	| Readonly<{ type: "APPLICATION_REJECTED"; reason: string }>;

export function createStaticFabSemanticFabDeleteSession(input: {
	readonly fabOrganizationId: number;
	readonly fabName: string;
	readonly requestSequence: number;
}): StaticFabSemanticFabDeleteSession {
	if (
		!positiveSafeInteger(input.fabOrganizationId) ||
		!positiveSafeInteger(input.requestSequence) ||
		!input.fabName.trim()
	) {
		throw new TypeError("Fab delete requires an exact root Fab identity and request sequence.");
	}
	return Object.freeze({
		...input,
		action: "DELETE",
		targetRole: "FAB",
		fabName: input.fabName.trim(),
		phase: "analyzing",
		reason: "최상위 FAB의 삭제 범위와 다른 FAB·무소속 항목의 보존을 검토하고 있습니다.",
		review: null,
		evidence: null,
	});
}

export function reduceStaticFabSemanticFabDeleteSession(
	state: StaticFabSemanticFabDeleteSession,
	action: StaticFabSemanticFabDeleteSessionAction,
): StaticFabSemanticFabDeleteSession {
	switch (action.type) {
		case "ANALYSIS_READY":
		case "ANALYSIS_REJECTED": {
			if (
				action.requestSequence !== state.requestSequence ||
				(state.phase !== "analyzing" &&
					!(state.phase === "ready" && action.type === "ANALYSIS_REJECTED")) ||
				(action.review &&
					(action.review.action !== "DELETE" ||
						action.review.targetRole !== "FAB" ||
						action.review.fabOrganizationId !== state.fabOrganizationId ||
						!action.review.planFingerprint))
			) {
				return state;
			}
			return Object.freeze({
				...state,
				phase: action.type === "ANALYSIS_READY" ? "ready" : "rejected",
				reason: action.reason,
				review: action.review ?? null,
				evidence: action.evidence ?? null,
			});
		}
		case "RETRY":
			return state.phase === "rejected" &&
				positiveSafeInteger(action.requestSequence) &&
				action.requestSequence > state.requestSequence
				? createStaticFabSemanticFabDeleteSession({
						...state,
						requestSequence: action.requestSequence,
					})
				: state;
		case "APPLY":
			return staticFabSemanticFabDeleteSessionCanApply(state)
				? Object.freeze({ ...state, phase: "applying" })
				: state;
		case "APPLICATION_REJECTED":
			return state.phase === "applying"
				? Object.freeze({ ...state, phase: "rejected", reason: action.reason })
				: state;
	}
}

export function staticFabSemanticFabDeleteSessionCanApply(
	state: StaticFabSemanticFabDeleteSession,
): boolean {
	return (
		state.action === "DELETE" &&
		state.targetRole === "FAB" &&
		state.phase === "ready" &&
		state.review?.action === "DELETE" &&
		state.review.targetRole === "FAB" &&
		state.evidence !== null
	);
}

function positiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
