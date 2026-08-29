import { staticFabBayFlowEditHierarchyEligibility } from "../core/StaticFabBayFlowEdit";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";

export interface GuidedBuildBayBankEvidence {
	readonly twinProductionBayCount: number;
	readonly detachedTwinBayCount: number;
	readonly alignedDetachedTwinBayPairCount: number;
	readonly semanticBayBankCount: number;
	readonly railBearingTwinBayBankCount: number;
	readonly bankedTwinBayCount: number;
}

export const EMPTY_GUIDED_BUILD_BAY_BANK_EVIDENCE: GuidedBuildBayBankEvidence = Object.freeze({
	twinProductionBayCount: 0,
	detachedTwinBayCount: 0,
	alignedDetachedTwinBayPairCount: 0,
	semanticBayBankCount: 0,
	railBearingTwinBayBankCount: 0,
	bankedTwinBayCount: 0,
});

/**
 * Derive the tutorial's Bank outcome only from persisted organization truth. Bounds are calculated
 * from authored Bay shell membership solely to skip a redundant alignment command; they never
 * create or infer a Bay Bank. A completed Bank needs an explicit semantic parent, at least two
 * certified Twin Bay children, and authored connector rail owned directly by that parent.
 */
export function summarizeGuidedBuildBayBankEvidence(
	organizations: StaticFabOrganizationState,
): GuidedBuildBayBankEvidence {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const twinBays = organizations.records.filter(
		(record) =>
			roles.get(record.id) === "BAY" &&
			staticFabBayFlowEditHierarchyEligibility(organizations, record.id).valid,
	);
	const detachedTwinBays = twinBays.filter((bay) =>
		staticFabOrganizationParentIds(bay).every((parentId) => roles.get(parentId) !== "BAY_BANK"),
	);
	let alignedDetachedTwinBayPairCount = 0;
	for (let leftIndex = 0; leftIndex < detachedTwinBays.length; leftIndex++) {
		for (let rightIndex = leftIndex + 1; rightIndex < detachedTwinBays.length; rightIndex++) {
			if (
				bayShellsShareCenterAxis(
					detachedTwinBays[leftIndex] as StaticFabOrganizationRecord,
					detachedTwinBays[rightIndex] as StaticFabOrganizationRecord,
				)
			) {
				alignedDetachedTwinBayPairCount++;
			}
		}
	}

	const semanticBanks = organizations.records.filter(
		(record) => roles.get(record.id) === "BAY_BANK",
	);
	let railBearingTwinBayBankCount = 0;
	let bankedTwinBayCount = 0;
	for (const bank of semanticBanks) {
		const directTwinBayCount = twinBays.filter((bay) =>
			staticFabOrganizationParentIds(bay).includes(bank.id),
		).length;
		bankedTwinBayCount += directTwinBayCount;
		if (directTwinBayCount >= 2 && bank.membership.railEdges.length > 0) {
			railBearingTwinBayBankCount++;
		}
	}

	return Object.freeze({
		twinProductionBayCount: twinBays.length,
		detachedTwinBayCount: detachedTwinBays.length,
		alignedDetachedTwinBayPairCount,
		semanticBayBankCount: semanticBanks.length,
		railBearingTwinBayBankCount,
		bankedTwinBayCount,
	});
}

/** Canonical authored geometry check for the exact pair currently selected by ordinary UI state. */
export function guidedBuildTwinBayPairCenterAligned(
	organizations: StaticFabOrganizationState,
	organizationIds: readonly number[],
): boolean {
	if (organizationIds.length !== 2 || organizationIds[0] === organizationIds[1]) return false;
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bays = organizationIds.map(
		(id) => organizations.records.find((record) => record.id === id) ?? null,
	);
	if (
		bays.some(
			(bay) =>
				bay === null ||
				roles.get(bay.id) !== "BAY" ||
				!staticFabBayFlowEditHierarchyEligibility(organizations, bay.id).valid,
		)
	) {
		return false;
	}
	return bayShellsShareCenterAxis(
		bays[0] as StaticFabOrganizationRecord,
		bays[1] as StaticFabOrganizationRecord,
	);
}

interface BayShellBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

function bayShellsShareCenterAxis(
	left: StaticFabOrganizationRecord,
	right: StaticFabOrganizationRecord,
): boolean {
	const leftBounds = directRailBounds(left);
	const rightBounds = directRailBounds(right);
	if (!leftBounds || !rightBounds) return false;
	return (
		leftBounds.minX + leftBounds.maxX === rightBounds.minX + rightBounds.maxX ||
		leftBounds.minY + leftBounds.maxY === rightBounds.minY + rightBounds.maxY
	);
}

function directRailBounds(record: StaticFabOrganizationRecord): BayShellBounds | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const edge of record.membership.railEdges) {
		minX = Math.min(minX, edge.from.x, edge.to.x);
		minY = Math.min(minY, edge.from.y, edge.to.y);
		maxX = Math.max(maxX, edge.from.x, edge.to.x);
		maxY = Math.max(maxY, edge.from.y, edge.to.y);
	}
	return Number.isFinite(minX) ? Object.freeze({ minX, minY, maxX, maxY }) : null;
}
