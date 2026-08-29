import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import {
	analyzeStaticFabOuterCirculation,
	EMPTY_STATIC_FAB_OUTER_CIRCULATION_ANALYSIS,
} from "../core/StaticFabOuterCirculation";

export interface GuidedBuildFabLoopEvidence {
	readonly semanticFabCount: number;
	readonly eligibleFabCount: number;
	readonly resilientFabLoopCount: number;
	readonly resilientBankPairCount: number;
}

export const EMPTY_GUIDED_BUILD_FAB_LOOP_EVIDENCE: GuidedBuildFabLoopEvidence =
	EMPTY_STATIC_FAB_OUTER_CIRCULATION_ANALYSIS;

/**
 * A Guided Fab Loop is canonical redundancy, not a renderer shape. Every pair of direct Banks below
 * one explicit Fab must have at least two edge-disjoint directed routes in both directions through
 * that Fab's effective authored rail. The capped two-unit flow test stops as soon as redundancy is
 * proven and does not retain a second editable graph.
 */
export function summarizeGuidedBuildFabLoopEvidence(
	organizations: StaticFabOrganizationState,
): GuidedBuildFabLoopEvidence {
	return analyzeStaticFabOuterCirculation(organizations);
}
