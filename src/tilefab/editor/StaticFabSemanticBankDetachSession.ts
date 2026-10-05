import type {
	StaticFabSemanticBankDetachRegionEvidence,
	StaticFabSemanticBankDetachTopologyEvidence,
} from "../compile/StaticFabSemanticBankDetachProspective";

export const STATIC_FAB_SEMANTIC_BANK_DETACH_SAMPLE_LIMIT = 4;

/** Presentation only. This state never carries a plan, permit, or mutation authority. */
export interface StaticFabSemanticBankDetachImpactRow {
	readonly label: string;
	readonly count: number;
	readonly samples: readonly (number | string)[];
}

export interface StaticFabSemanticBankDetachReviewView {
	readonly bankOrganizationId: number;
	readonly parentFabOrganizationId: number;
	readonly planFingerprint: string;
	readonly preserved: readonly StaticFabSemanticBankDetachImpactRow[];
	readonly removed: readonly StaticFabSemanticBankDetachImpactRow[];
}

export interface StaticFabSemanticBankDetachEvidenceView {
	readonly source: StaticFabSemanticBankDetachTopologyEvidence;
	readonly prospective: StaticFabSemanticBankDetachTopologyEvidence;
	readonly selectedBank: StaticFabSemanticBankDetachRegionEvidence;
	readonly retainedFab: StaticFabSemanticBankDetachRegionEvidence;
}

export interface StaticFabSemanticBankDetachSession {
	readonly bankOrganizationId: number;
	readonly bankName: string;
	readonly requestSequence: number;
	readonly phase: "analyzing" | "ready" | "rejected" | "applying";
	readonly reason: string;
	readonly review: StaticFabSemanticBankDetachReviewView | null;
	readonly evidence: StaticFabSemanticBankDetachEvidenceView | null;
}

export type StaticFabSemanticBankDetachSessionAction =
	| Readonly<{
			type: "ANALYSIS_READY";
			requestSequence: number;
			reason: string;
			review: StaticFabSemanticBankDetachReviewView;
			evidence: StaticFabSemanticBankDetachEvidenceView;
	  }>
	| Readonly<{
			type: "ANALYSIS_REJECTED";
			requestSequence: number;
			reason: string;
			review?: StaticFabSemanticBankDetachReviewView | null;
			evidence?: StaticFabSemanticBankDetachEvidenceView | null;
	  }>
	| Readonly<{ type: "RETRY"; requestSequence: number }>
	| Readonly<{ type: "APPLY" }>
	| Readonly<{ type: "APPLICATION_REJECTED"; reason: string }>;

export function createStaticFabSemanticBankDetachSession(input: {
	readonly bankOrganizationId: number;
	readonly bankName: string;
	readonly requestSequence: number;
}): StaticFabSemanticBankDetachSession {
	if (
		!positiveSafeInteger(input.bankOrganizationId) ||
		!positiveSafeInteger(input.requestSequence) ||
		!input.bankName.trim()
	) {
		throw new TypeError("Bank detach requires an exact Bank identity and request sequence.");
	}
	return Object.freeze({
		...input,
		bankName: input.bankName.trim(),
		phase: "analyzing",
		reason: "Bank 내부 구성 보존과 FAB 연결 제거 영향을 검토하고 있습니다.",
		review: null,
		evidence: null,
	});
}

export function reduceStaticFabSemanticBankDetachSession(
	state: StaticFabSemanticBankDetachSession,
	action: StaticFabSemanticBankDetachSessionAction,
): StaticFabSemanticBankDetachSession {
	switch (action.type) {
		case "ANALYSIS_READY":
		case "ANALYSIS_REJECTED": {
			if (
				action.requestSequence !== state.requestSequence ||
				(state.phase !== "analyzing" &&
					!(state.phase === "ready" && action.type === "ANALYSIS_REJECTED")) ||
				(action.review &&
					(action.review.bankOrganizationId !== state.bankOrganizationId ||
						!positiveSafeInteger(action.review.parentFabOrganizationId) ||
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
				? createStaticFabSemanticBankDetachSession({
						...state,
						requestSequence: action.requestSequence,
					})
				: state;
		case "APPLY":
			return staticFabSemanticBankDetachSessionCanApply(state)
				? Object.freeze({ ...state, phase: "applying" })
				: state;
		case "APPLICATION_REJECTED":
			return state.phase === "applying"
				? Object.freeze({ ...state, phase: "rejected", reason: action.reason })
				: state;
	}
}

export function staticFabSemanticBankDetachSessionCanApply(
	state: StaticFabSemanticBankDetachSession,
): boolean {
	return state.phase === "ready" && state.review !== null && state.evidence !== null;
}

function positiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
