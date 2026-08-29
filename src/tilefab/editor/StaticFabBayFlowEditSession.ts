import type { ProductionBayInternalFlowPattern } from "../core/ProductionBayModulePlanner";
import type { StaticFabBayFlowEditReview } from "../core/StaticFabBayFlowEdit";
import type { StaticFabBayFlowEditTopologyEvidence } from "../worker/StaticFabBayFlowEditProtocol";

export type StaticFabBayFlowEditSessionPhase = "analyzing" | "ready" | "rejected" | "applying";

export interface StaticFabBayFlowEditSessionTimings {
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabBayFlowEditSession {
	readonly bayOrganizationId: number;
	readonly bayName: string;
	readonly targetInternalFlowPattern: ProductionBayInternalFlowPattern;
	readonly phase: StaticFabBayFlowEditSessionPhase;
	readonly requestSequence: number;
	readonly reason: string;
	readonly review: StaticFabBayFlowEditReview | null;
	readonly sourceEvidence: StaticFabBayFlowEditTopologyEvidence | null;
	readonly prospectiveEvidence: StaticFabBayFlowEditTopologyEvidence | null;
	readonly timings: StaticFabBayFlowEditSessionTimings | null;
}

export type StaticFabBayFlowEditSessionAction =
	| Readonly<{
			type: "ANALYSIS_READY";
			requestSequence: number;
			reason: string;
			review: StaticFabBayFlowEditReview;
			sourceEvidence: StaticFabBayFlowEditTopologyEvidence;
			prospectiveEvidence: StaticFabBayFlowEditTopologyEvidence;
			timings: StaticFabBayFlowEditSessionTimings;
	  }>
	| Readonly<{
			type: "ANALYSIS_REJECTED";
			requestSequence: number;
			reason: string;
			review: StaticFabBayFlowEditReview | null;
			sourceEvidence: StaticFabBayFlowEditTopologyEvidence | null;
			prospectiveEvidence: StaticFabBayFlowEditTopologyEvidence | null;
			timings: StaticFabBayFlowEditSessionTimings | null;
	  }>
	| Readonly<{ type: "APPLY" }>
	| Readonly<{ type: "APPLICATION_REJECTED"; reason: string }>
	| Readonly<{ type: "RETRY"; requestSequence: number }>;

export function createStaticFabBayFlowEditSession(input: {
	readonly bayOrganizationId: number;
	readonly bayName: string;
	readonly targetInternalFlowPattern: ProductionBayInternalFlowPattern;
	readonly requestSequence?: number;
}): StaticFabBayFlowEditSession {
	if (!positiveSafeInteger(input.bayOrganizationId)) {
		throw new RangeError("Bay flow edit organization id must be a positive safe integer.");
	}
	const bayName = input.bayName.trim();
	if (bayName.length === 0) throw new TypeError("Bay flow edit name is required.");
	if (!isFlowPattern(input.targetInternalFlowPattern)) {
		throw new TypeError("Bay flow edit target pattern is invalid.");
	}
	const requestSequence = input.requestSequence ?? 1;
	if (!positiveSafeInteger(requestSequence)) {
		throw new RangeError("Bay flow edit request sequence must be a positive safe integer.");
	}
	return freezeSession({
		bayOrganizationId: input.bayOrganizationId,
		bayName,
		targetInternalFlowPattern: input.targetInternalFlowPattern,
		phase: "analyzing",
		requestSequence,
		reason: analysisReason(input.targetInternalFlowPattern),
		review: null,
		sourceEvidence: null,
		prospectiveEvidence: null,
		timings: null,
	});
}

export function reduceStaticFabBayFlowEditSession(
	state: StaticFabBayFlowEditSession,
	action: StaticFabBayFlowEditSessionAction,
): StaticFabBayFlowEditSession {
	switch (action.type) {
		case "ANALYSIS_READY":
			if (
				state.phase !== "analyzing" ||
				action.requestSequence !== state.requestSequence ||
				!reviewMatchesSession(state, action.review)
			) {
				return state;
			}
			return freezeSession({
				...state,
				phase: "ready",
				reason: action.reason,
				review: action.review,
				sourceEvidence: action.sourceEvidence,
				prospectiveEvidence: action.prospectiveEvidence,
				timings: freezeTimings(action.timings),
			});
		case "ANALYSIS_REJECTED":
			if (
				(state.phase !== "analyzing" && state.phase !== "ready") ||
				action.requestSequence !== state.requestSequence ||
				(action.review !== null && !rejectedReviewMatchesSession(state, action.review))
			) {
				return state;
			}
			return freezeSession({
				...state,
				phase: "rejected",
				reason: action.reason,
				review: action.review,
				sourceEvidence: action.sourceEvidence,
				prospectiveEvidence: action.prospectiveEvidence,
				timings: action.timings ? freezeTimings(action.timings) : null,
			});
		case "APPLY":
			return state.phase === "ready" ? freezeSession({ ...state, phase: "applying" }) : state;
		case "APPLICATION_REJECTED":
			return state.phase === "applying"
				? freezeSession({ ...state, phase: "rejected", reason: action.reason })
				: state;
		case "RETRY":
			if (
				state.phase !== "rejected" ||
				!positiveSafeInteger(action.requestSequence) ||
				action.requestSequence <= state.requestSequence
			) {
				return state;
			}
			return freezeSession({
				...state,
				phase: "analyzing",
				requestSequence: action.requestSequence,
				reason: analysisReason(state.targetInternalFlowPattern),
				review: null,
				sourceEvidence: null,
				prospectiveEvidence: null,
				timings: null,
			});
	}
}

export function staticFabBayFlowEditSessionCanApply(state: StaticFabBayFlowEditSession): boolean {
	return (
		state.phase === "ready" &&
		state.review !== null &&
		state.sourceEvidence !== null &&
		state.prospectiveEvidence !== null
	);
}

function reviewMatchesSession(
	state: StaticFabBayFlowEditSession,
	review: StaticFabBayFlowEditReview,
): boolean {
	return (
		review.bayOrganizationId === state.bayOrganizationId &&
		review.targetInternalFlowPattern === state.targetInternalFlowPattern &&
		review.sourceInternalFlowPattern !== null &&
		review.sourceInternalFlowPattern !== state.targetInternalFlowPattern
	);
}

function rejectedReviewMatchesSession(
	state: StaticFabBayFlowEditSession,
	review: StaticFabBayFlowEditReview,
): boolean {
	return (
		review.bayOrganizationId === state.bayOrganizationId &&
		review.targetInternalFlowPattern === state.targetInternalFlowPattern &&
		(review.sourceInternalFlowPattern === null ||
			review.sourceInternalFlowPattern !== state.targetInternalFlowPattern)
	);
}

function analysisReason(target: ProductionBayInternalFlowPattern): string {
	return `Checking the recognized Twin Bay, fixed Bank gateway, and closed ${target} target flow.`;
}

function freezeTimings(
	timings: StaticFabBayFlowEditSessionTimings,
): StaticFabBayFlowEditSessionTimings {
	return Object.freeze({
		planningMilliseconds: finiteNonNegative(timings.planningMilliseconds),
		validationMilliseconds: finiteNonNegative(timings.validationMilliseconds),
	});
}

function finiteNonNegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function freezeSession(state: StaticFabBayFlowEditSession): StaticFabBayFlowEditSession {
	return Object.freeze(state);
}

function isFlowPattern(value: unknown): value is ProductionBayInternalFlowPattern {
	return value === "alternating" || value === "co-rotating";
}

function positiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
