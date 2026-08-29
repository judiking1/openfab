import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";

export interface GuidedBuildInterbayEvidence {
	readonly semanticBayBankCount: number;
	readonly detachedBayBankCount: number;
	readonly semanticFabCount: number;
	readonly interbayFabCount: number;
	readonly fabBankCount: number;
}

export const EMPTY_GUIDED_BUILD_INTERBAY_EVIDENCE: GuidedBuildInterbayEvidence = Object.freeze({
	semanticBayBankCount: 0,
	detachedBayBankCount: 0,
	semanticFabCount: 0,
	interbayFabCount: 0,
	fabBankCount: 0,
});

/**
 * Summarize Interbay completion only from the persisted organization DAG and direct rail
 * ownership. A Fab name, two nearby Banks, or one transient Connector session is insufficient:
 * one explicit Fab must own authored Interbay rail and directly parent at least two semantic
 * Bay Banks.
 */
export function summarizeGuidedBuildInterbayEvidence(
	organizations: StaticFabOrganizationState,
): GuidedBuildInterbayEvidence {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const banks = organizations.records.filter((record) => roles.get(record.id) === "BAY_BANK");
	const fabs = organizations.records.filter((record) => roles.get(record.id) === "FAB");
	const detachedBanks = banks.filter((bank) =>
		staticFabOrganizationParentIds(bank).every((parentId) => roles.get(parentId) !== "FAB"),
	);
	let interbayFabCount = 0;
	let fabBankCount = 0;
	for (const fab of fabs) {
		const directBankCount = banks.filter((bank) =>
			staticFabOrganizationParentIds(bank).includes(fab.id),
		).length;
		fabBankCount += directBankCount;
		if (directBankCount >= 2 && fab.membership.railEdges.length > 0) interbayFabCount++;
	}
	return Object.freeze({
		semanticBayBankCount: banks.length,
		detachedBayBankCount: detachedBanks.length,
		semanticFabCount: fabs.length,
		interbayFabCount,
		fabBankCount,
	});
}

/** Effective authored bounds are coaching evidence only; they never infer Bank or Fab meaning. */
export function guidedBuildBayBankPairCenterAligned(
	organizations: StaticFabOrganizationState,
	organizationIds: readonly number[],
): boolean {
	if (organizationIds.length !== 2 || organizationIds[0] === organizationIds[1]) return false;
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	if (organizationIds.some((id) => roles.get(id) !== "BAY_BANK")) return false;
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const childrenByParentId = new Map<number, StaticFabOrganizationRecord[]>();
	for (const record of organizations.records) {
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record);
			else childrenByParentId.set(parentId, [record]);
		}
	}
	const left = effectiveRailBounds(organizationIds[0] as number, recordsById, childrenByParentId);
	const right = effectiveRailBounds(organizationIds[1] as number, recordsById, childrenByParentId);
	if (!left || !right) return false;
	return (
		left.minX + left.maxX === right.minX + right.maxX ||
		left.minY + left.maxY === right.minY + right.maxY
	);
}

interface Bounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

function effectiveRailBounds(
	rootId: number,
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
	childrenByParentId: ReadonlyMap<number, readonly StaticFabOrganizationRecord[]>,
): Bounds | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const visited = new Set<number>();
	const pending = [rootId];
	while (pending.length > 0) {
		const id = pending.pop();
		if (id === undefined || visited.has(id)) continue;
		visited.add(id);
		const record = recordsById.get(id);
		if (!record) continue;
		for (const edge of record.membership.railEdges) {
			minX = Math.min(minX, edge.from.x, edge.to.x);
			minY = Math.min(minY, edge.from.y, edge.to.y);
			maxX = Math.max(maxX, edge.from.x, edge.to.x);
			maxY = Math.max(maxY, edge.from.y, edge.to.y);
		}
		for (const child of childrenByParentId.get(id) ?? []) pending.push(child.id);
	}
	return Number.isFinite(minX) ? Object.freeze({ minX, minY, maxX, maxY }) : null;
}
