import type { StaticFabReviewOrganizationLabels } from "./StaticFabSemanticImpactReviewLabels";

export const STATIC_FAB_SEMANTIC_BANK_DELETE_SAMPLE_LIMIT = 4;

/** Presentation only. Delete authority remains in its separate certified plan and bridge. */
export interface StaticFabSemanticBankDeleteImpactRow {
	readonly label: string;
	readonly count: number;
	readonly samples: readonly (number | string)[];
}

export interface StaticFabSemanticBankDeleteReviewView {
	readonly action: "DELETE";
	readonly bankOrganizationId: number;
	readonly parentFabOrganizationId: number | null;
	readonly planFingerprint: string;
	readonly organizationLabels?: StaticFabReviewOrganizationLabels | null;
	readonly preserved: readonly StaticFabSemanticBankDeleteImpactRow[];
	readonly removed: readonly StaticFabSemanticBankDeleteImpactRow[];
}

export interface StaticFabSemanticBankDeleteEvidenceMetric {
	readonly label: string;
	readonly value: number | string;
}

export interface StaticFabSemanticBankDeleteEvidenceView {
	readonly checks: readonly StaticFabSemanticBankDeleteEvidenceMetric[];
	readonly source: readonly StaticFabSemanticBankDeleteEvidenceMetric[];
	readonly prospective: readonly StaticFabSemanticBankDeleteEvidenceMetric[];
}

export interface StaticFabSemanticBankDeleteSession {
	readonly action: "DELETE";
	readonly bankOrganizationId: number;
	readonly bankName: string;
	readonly requestSequence: number;
	readonly phase: "analyzing" | "ready" | "rejected" | "applying";
	readonly reason: string;
	readonly review: StaticFabSemanticBankDeleteReviewView | null;
	readonly evidence: StaticFabSemanticBankDeleteEvidenceView | null;
}

export type StaticFabSemanticBankDeleteSessionAction =
	| Readonly<{
			type: "ANALYSIS_READY";
			requestSequence: number;
			reason: string;
			review: StaticFabSemanticBankDeleteReviewView;
			evidence: StaticFabSemanticBankDeleteEvidenceView;
	  }>
	| Readonly<{
			type: "ANALYSIS_REJECTED";
			requestSequence: number;
			reason: string;
			review?: StaticFabSemanticBankDeleteReviewView | null;
			evidence?: StaticFabSemanticBankDeleteEvidenceView | null;
	  }>
	| Readonly<{ type: "RETRY"; requestSequence: number }>
	| Readonly<{ type: "APPLY" }>
	| Readonly<{ type: "APPLICATION_REJECTED"; reason: string }>;

export function createStaticFabSemanticBankDeleteSession(input: {
	readonly bankOrganizationId: number;
	readonly bankName: string;
	readonly requestSequence: number;
}): StaticFabSemanticBankDeleteSession {
	if (
		!positiveSafeInteger(input.bankOrganizationId) ||
		!positiveSafeInteger(input.requestSequence) ||
		!input.bankName.trim()
	) {
		throw new TypeError("Bank delete requires an exact Bank identity and request sequence.");
	}
	return Object.freeze({
		...input,
		action: "DELETE",
		bankName: input.bankName.trim(),
		phase: "analyzing",
		reason: "Bank의 삭제 범위와 다른 조직·장비·Port의 보존을 검토하고 있습니다.",
		review: null,
		evidence: null,
	});
}

export function reduceStaticFabSemanticBankDeleteSession(
	state: StaticFabSemanticBankDeleteSession,
	action: StaticFabSemanticBankDeleteSessionAction,
): StaticFabSemanticBankDeleteSession {
	switch (action.type) {
		case "ANALYSIS_READY":
		case "ANALYSIS_REJECTED": {
			if (
				action.requestSequence !== state.requestSequence ||
				(state.phase !== "analyzing" &&
					!(state.phase === "ready" && action.type === "ANALYSIS_REJECTED")) ||
				(action.review &&
					(action.review.action !== "DELETE" ||
						action.review.bankOrganizationId !== state.bankOrganizationId ||
						(action.review.parentFabOrganizationId !== null &&
							!positiveSafeInteger(action.review.parentFabOrganizationId)) ||
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
				? createStaticFabSemanticBankDeleteSession({
						...state,
						requestSequence: action.requestSequence,
					})
				: state;
		case "APPLY":
			return staticFabSemanticBankDeleteSessionCanApply(state)
				? Object.freeze({ ...state, phase: "applying" })
				: state;
		case "APPLICATION_REJECTED":
			return state.phase === "applying"
				? Object.freeze({ ...state, phase: "rejected", reason: action.reason })
				: state;
	}
}

export function staticFabSemanticBankDeleteSessionCanApply(
	state: StaticFabSemanticBankDeleteSession,
): boolean {
	return (
		state.action === "DELETE" &&
		state.phase === "ready" &&
		state.review?.action === "DELETE" &&
		state.evidence !== null
	);
}

function positiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
