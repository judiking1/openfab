import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";

export interface StaticFabOuterCirculationAnalysis {
	readonly semanticFabCount: number;
	readonly eligibleFabCount: number;
	readonly resilientFabLoopCount: number;
	readonly resilientBankPairCount: number;
}

export const EMPTY_STATIC_FAB_OUTER_CIRCULATION_ANALYSIS: StaticFabOuterCirculationAnalysis =
	Object.freeze({
		semanticFabCount: 0,
		eligibleFabCount: 0,
		resilientFabLoopCount: 0,
		resilientBankPairCount: 0,
	});

/**
 * Analyze canonical circulation redundancy from persisted hierarchy and directed rail ownership.
 * A renderer outline or a second command record is not evidence: every direct Bank pair below one
 * Fab must have at least two edge-disjoint directed routes in both directions.
 */
export function analyzeStaticFabOuterCirculation(
	organizations: StaticFabOrganizationState,
): StaticFabOuterCirculationAnalysis {
	const hierarchy = circulationHierarchy(organizations);
	let eligibleFabCount = 0;
	let resilientFabLoopCount = 0;
	let resilientBankPairCount = 0;
	for (const fab of hierarchy.fabs) {
		const banks = directSemanticBanks(fab.id, hierarchy);
		if (banks.length < 2 || fab.membership.railEdges.length === 0) continue;
		eligibleFabCount++;
		const fabEdges = effectiveRailEdges(fab.id, hierarchy);
		let resilient = true;
		let pairCount = 0;
		for (let leftIndex = 0; leftIndex < banks.length; leftIndex++) {
			for (let rightIndex = leftIndex + 1; rightIndex < banks.length; rightIndex++) {
				const leftId = (banks[leftIndex] as StaticFabOrganizationRecord).id;
				const rightId = (banks[rightIndex] as StaticFabOrganizationRecord).id;
				if (bankPairHasResilientCirculation(fabEdges, leftId, rightId, hierarchy)) {
					pairCount++;
					resilientBankPairCount++;
				} else {
					resilient = false;
				}
			}
		}
		if (resilient && pairCount > 0) resilientFabLoopCount++;
	}
	return Object.freeze({
		semanticFabCount: hierarchy.fabs.length,
		eligibleFabCount,
		resilientFabLoopCount,
		resilientBankPairCount,
	});
}

/** Exact pair-level invariant used by the Worker planner before a FAB_LOOP patch is committable. */
export function staticFabBankPairHasResilientCirculation(
	organizations: StaticFabOrganizationState,
	fabOrganizationId: number,
	sourceBankOrganizationId: number,
	targetBankOrganizationId: number,
): boolean {
	if (sourceBankOrganizationId === targetBankOrganizationId) return false;
	const hierarchy = circulationHierarchy(organizations);
	if (!hierarchy.fabs.some((fab) => fab.id === fabOrganizationId)) return false;
	const directBankIds = new Set(
		directSemanticBanks(fabOrganizationId, hierarchy).map((bank) => bank.id),
	);
	if (
		!directBankIds.has(sourceBankOrganizationId) ||
		!directBankIds.has(targetBankOrganizationId)
	) {
		return false;
	}
	return bankPairHasResilientCirculation(
		effectiveRailEdges(fabOrganizationId, hierarchy),
		sourceBankOrganizationId,
		targetBankOrganizationId,
		hierarchy,
	);
}

interface CirculationHierarchy {
	readonly roles: ReadonlyMap<number, "FAB" | "BAY_BANK" | "BAY" | "PROCESS_LOOP">;
	readonly fabs: readonly StaticFabOrganizationRecord[];
	readonly recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>;
	readonly childrenByParentId: ReadonlyMap<number, readonly StaticFabOrganizationRecord[]>;
}

function circulationHierarchy(organizations: StaticFabOrganizationState): CirculationHierarchy {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const childrenByParentId = new Map<number, StaticFabOrganizationRecord[]>();
	for (const record of organizations.records) {
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record);
			else childrenByParentId.set(parentId, [record]);
		}
	}
	return Object.freeze({
		roles,
		fabs: Object.freeze(organizations.records.filter((record) => roles.get(record.id) === "FAB")),
		recordsById,
		childrenByParentId,
	});
}

function directSemanticBanks(
	fabOrganizationId: number,
	hierarchy: CirculationHierarchy,
): readonly StaticFabOrganizationRecord[] {
	return Object.freeze(
		(hierarchy.childrenByParentId.get(fabOrganizationId) ?? []).filter(
			(record) => hierarchy.roles.get(record.id) === "BAY_BANK",
		),
	);
}

interface DirectedVertexEdge {
	readonly from: string;
	readonly to: string;
}

function effectiveRailEdges(
	rootId: number,
	hierarchy: CirculationHierarchy,
): readonly DirectedVertexEdge[] {
	const edges = new Map<string, DirectedVertexEdge>();
	forEachHierarchyRecord(rootId, hierarchy, (record) => {
		for (const edge of record.membership.railEdges) {
			const from = vertexKey(edge.from.x, edge.from.y);
			const to = vertexKey(edge.to.x, edge.to.y);
			edges.set(`${from}>${to}`, Object.freeze({ from, to }));
		}
	});
	return Object.freeze([...edges.values()]);
}

function effectiveRailVertices(
	rootId: number,
	hierarchy: CirculationHierarchy,
): ReadonlySet<string> {
	const vertices = new Set<string>();
	forEachHierarchyRecord(rootId, hierarchy, (record) => {
		for (const edge of record.membership.railEdges) {
			vertices.add(vertexKey(edge.from.x, edge.from.y));
			vertices.add(vertexKey(edge.to.x, edge.to.y));
		}
	});
	return vertices;
}

function forEachHierarchyRecord(
	rootId: number,
	hierarchy: CirculationHierarchy,
	visit: (record: StaticFabOrganizationRecord) => void,
): void {
	const visited = new Set<number>();
	const pending = [rootId];
	while (pending.length > 0) {
		const recordId = pending.pop();
		if (recordId === undefined || visited.has(recordId)) continue;
		visited.add(recordId);
		const record = hierarchy.recordsById.get(recordId);
		if (!record) continue;
		visit(record);
		pending.push(...(hierarchy.childrenByParentId.get(record.id) ?? []).map((child) => child.id));
	}
}

function bankPairHasResilientCirculation(
	fabEdges: readonly DirectedVertexEdge[],
	leftBankId: number,
	rightBankId: number,
	hierarchy: CirculationHierarchy,
): boolean {
	const leftVertices = effectiveRailVertices(leftBankId, hierarchy);
	const rightVertices = effectiveRailVertices(rightBankId, hierarchy);
	return (
		hasTwoEdgeDisjointRoutes(fabEdges, leftVertices, rightVertices) &&
		hasTwoEdgeDisjointRoutes(fabEdges, rightVertices, leftVertices)
	);
}

interface ResidualArc {
	readonly to: string;
	readonly reverseIndex: number;
	capacity: number;
}

function hasTwoEdgeDisjointRoutes(
	edges: readonly DirectedVertexEdge[],
	sourceVertices: ReadonlySet<string>,
	targetVertices: ReadonlySet<string>,
): boolean {
	if (sourceVertices.size === 0 || targetVertices.size === 0) return false;
	const residual = new Map<string, ResidualArc[]>();
	for (const edge of edges) addResidualEdge(residual, edge.from, edge.to);
	for (let flow = 0; flow < 2; flow++) {
		const previous = new Map<string, Readonly<{ from: string; arcIndex: number }> | null>();
		const queue: string[] = [];
		for (const source of sourceVertices) {
			previous.set(source, null);
			queue.push(source);
		}
		let target: string | null = null;
		for (let index = 0; index < queue.length && target === null; index++) {
			const from = queue[index] as string;
			if (targetVertices.has(from) && !sourceVertices.has(from)) {
				target = from;
				break;
			}
			const arcs = residual.get(from) ?? [];
			for (let arcIndex = 0; arcIndex < arcs.length; arcIndex++) {
				const arc = arcs[arcIndex] as ResidualArc;
				if (arc.capacity <= 0 || previous.has(arc.to)) continue;
				previous.set(arc.to, Object.freeze({ from, arcIndex }));
				queue.push(arc.to);
			}
		}
		if (target === null) return false;
		let cursor = target;
		while (true) {
			const step = previous.get(cursor);
			if (!step) break;
			const forward = (residual.get(step.from) as ResidualArc[])[step.arcIndex] as ResidualArc;
			const reverse = (residual.get(cursor) as ResidualArc[])[forward.reverseIndex] as ResidualArc;
			forward.capacity--;
			reverse.capacity++;
			cursor = step.from;
		}
	}
	return true;
}

function addResidualEdge(residual: Map<string, ResidualArc[]>, from: string, to: string): void {
	const forwardArcs = residual.get(from) ?? [];
	const reverseArcs = residual.get(to) ?? [];
	const forward: ResidualArc = { to, reverseIndex: reverseArcs.length, capacity: 1 };
	const reverse: ResidualArc = { to: from, reverseIndex: forwardArcs.length, capacity: 0 };
	forwardArcs.push(forward);
	reverseArcs.push(reverse);
	residual.set(from, forwardArcs);
	residual.set(to, reverseArcs);
}

function vertexKey(x: number, y: number): string {
	return `${x},${y}`;
}
