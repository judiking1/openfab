import { staticFabBayFlowEditHierarchyEligibility } from "../core/StaticFabBayFlowEdit";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";

export interface GuidedBuildBayEvidence {
	readonly semanticBayCount: number;
	readonly twinProductionBayCount: number;
	readonly directProcessLoopCount: number;
}

export const EMPTY_GUIDED_BUILD_BAY_EVIDENCE: GuidedBuildBayEvidence = Object.freeze({
	semanticBayCount: 0,
	twinProductionBayCount: 0,
	directProcessLoopCount: 0,
});

/**
 * Summarize only persisted organization truth. A plain BAY record is insufficient: public Bay
 * meaning requires direct Process Loop children, and the guided Twin path uses the same hierarchy
 * gate as the reviewed Production Bay flow command.
 */
export function summarizeGuidedBuildBayEvidence(
	organizations: StaticFabOrganizationState,
): GuidedBuildBayEvidence {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const semanticBayIds = organizations.records
		.filter((record) => roles.get(record.id) === "BAY")
		.map((record) => record.id);
	let twinProductionBayCount = 0;
	let directProcessLoopCount = 0;
	for (const bayId of semanticBayIds) {
		directProcessLoopCount += organizations.records.filter(
			(record) =>
				roles.get(record.id) === "PROCESS_LOOP" &&
				staticFabOrganizationParentIds(record).includes(bayId),
		).length;
		if (staticFabBayFlowEditHierarchyEligibility(organizations, bayId).valid) {
			twinProductionBayCount++;
		}
	}
	return Object.freeze({
		semanticBayCount: semanticBayIds.length,
		twinProductionBayCount,
		directProcessLoopCount,
	});
}
