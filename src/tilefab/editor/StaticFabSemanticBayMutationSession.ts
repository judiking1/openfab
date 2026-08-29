import type {
	StaticFabSemanticBayMutationAction,
	StaticFabSemanticBayMutationReview,
} from "../core/StaticFabSemanticBayMutation";
import type { StaticFabSemanticBayMutationTopologyEvidence } from "../worker/StaticFabSemanticBayMutationProtocol";

export type StaticFabSemanticBayMutationSessionPhase =
	| "analyzing"
	| "ready"
	| "rejected"
	| "applying";

export interface StaticFabSemanticBayMutationSessionTimings {
	readonly planningMilliseconds: number;
	readonly validationMilliseconds: number;
}

export interface StaticFabSemanticBayMutationSession {
	readonly action: StaticFabSemanticBayMutationAction;
	readonly bayOrganizationId: number;
	readonly bayName: string;
	readonly phase: StaticFabSemanticBayMutationSessionPhase;
	readonly requestSequence: number;
	readonly reason: string;
	readonly review: StaticFabSemanticBayMutationReview | null;
	readonly sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
	readonly prospectiveEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
	readonly timings: StaticFabSemanticBayMutationSessionTimings | null;
}

export type StaticFabSemanticBayMutationSessionAction =
	| Readonly<{
			type: "ANALYSIS_READY";
			requestSequence: number;
			reason: string;
			review: StaticFabSemanticBayMutationReview;
			sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence;
			prospectiveEvidence: StaticFabSemanticBayMutationTopologyEvidence;
			timings: StaticFabSemanticBayMutationSessionTimings;
	  }>
	| Readonly<{
			type: "ANALYSIS_REJECTED";
			requestSequence: number;
			reason: string;
			review: StaticFabSemanticBayMutationReview | null;
			sourceEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
			prospectiveEvidence: StaticFabSemanticBayMutationTopologyEvidence | null;
			timings: StaticFabSemanticBayMutationSessionTimings | null;
	  }>
	| Readonly<{ type: "APPLY" }>
	| Readonly<{ type: "APPLICATION_REJECTED"; reason: string }>
	| Readonly<{ type: "RETRY"; requestSequence: number }>;

export function createStaticFabSemanticBayMutationSession(input: {
	readonly action: StaticFabSemanticBayMutationAction;
	readonly bayOrganizationId: number;
	readonly bayName: string;
	readonly requestSequence?: number;
}): StaticFabSemanticBayMutationSession {
	if (!positiveSafeInteger(input.bayOrganizationId)) {
		throw new RangeError("Semantic Bay organization id must be a positive safe integer.");
	}
	const bayName = input.bayName.trim();
	if (bayName.length === 0) throw new TypeError("Semantic Bay name is required.");
	const requestSequence = input.requestSequence ?? 1;
	if (!positiveSafeInteger(requestSequence)) {
		throw new RangeError("Semantic Bay request sequence must be a positive safe integer.");
	}
	return freezeSession({
		action: input.action,
		bayOrganizationId: input.bayOrganizationId,
		bayName,
		phase: "analyzing",
		requestSequence,
		reason: analysisReason(input.action),
		review: null,
		sourceEvidence: null,
		prospectiveEvidence: null,
		timings: null,
	});
}

export function reduceStaticFabSemanticBayMutationSession(
	state: StaticFabSemanticBayMutationSession,
	action: StaticFabSemanticBayMutationSessionAction,
): StaticFabSemanticBayMutationSession {
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
				(action.review !== null && !reviewMatchesSession(state, action.review))
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
			if (state.phase !== "rejected" || action.requestSequence <= state.requestSequence) {
				return state;
			}
			if (!positiveSafeInteger(action.requestSequence)) return state;
			return freezeSession({
				...state,
				phase: "analyzing",
				requestSequence: action.requestSequence,
				reason: analysisReason(state.action),
				review: null,
				sourceEvidence: null,
				prospectiveEvidence: null,
				timings: null,
			});
	}
}

export function staticFabSemanticBayMutationSessionCanApply(
	state: StaticFabSemanticBayMutationSession,
): boolean {
	return (
		state.phase === "ready" &&
		state.review !== null &&
		state.sourceEvidence !== null &&
		state.prospectiveEvidence !== null
	);
}

function reviewMatchesSession(
	state: StaticFabSemanticBayMutationSession,
	review: StaticFabSemanticBayMutationReview,
): boolean {
	return review.action === state.action && review.bayOrganizationId === state.bayOrganizationId;
}

function analysisReason(action: StaticFabSemanticBayMutationAction): string {
	return action === "DISCONNECT"
		? "Checking the incident connector, retained Bay content, and both closed flow regions."
		: "Checking the incident connector, complete Bay dependencies, and retained Bank circulation.";
}

function freezeTimings(
	timings: StaticFabSemanticBayMutationSessionTimings,
): StaticFabSemanticBayMutationSessionTimings {
	return Object.freeze({
		planningMilliseconds: finiteNonNegative(timings.planningMilliseconds),
		validationMilliseconds: finiteNonNegative(timings.validationMilliseconds),
	});
}

function finiteNonNegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function freezeSession(
	state: StaticFabSemanticBayMutationSession,
): StaticFabSemanticBayMutationSession {
	return Object.freeze(state);
}

function positiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
