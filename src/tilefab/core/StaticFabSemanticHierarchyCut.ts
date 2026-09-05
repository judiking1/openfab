import type { PortEquipmentState } from "./EquipmentGroup";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
} from "./RailModuleOwnership";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import {
	inventoryStaticFabSemanticHierarchyBoundary,
	type StaticFabSemanticHierarchyBoundaryIssueCode,
	type StaticFabSemanticHierarchyRawParentComponentCandidate,
} from "./StaticFabSemanticHierarchyBoundary";
import type {
	StaticFabSemanticHierarchyRecoveryAction,
	StaticFabSemanticHierarchyRecoveryReview,
	StaticFabSemanticHierarchyRecoveryTargetRole,
} from "./StaticFabSemanticHierarchyRecovery";
import { type Cell, cellKey, type TileMap } from "./TileMap";

export const STATIC_FAB_SEMANTIC_HIERARCHY_CUT_VERSION = 1 as const;
export const STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT = 64;

export type StaticFabSemanticHierarchyCutIssueCode =
	| "BOUNDARY_INVENTORY_REJECTED"
	| "STALE_SOURCE"
	| "MISSING_RETAINED_SIBLING"
	| "NON_CANONICAL_RETAINED_SUBTREE"
	| "INVALID_WHOLE_MODULE_OWNERSHIP"
	| "OVERLAPPING_REGION_OWNERSHIP"
	| "AMBIGUOUS_EDGE_MODULE"
	| "CANDIDATE_NOT_SIMPLE_DIRECTED_PATH"
	| "CANDIDATE_TURNOUT_SHAPE_MISMATCH"
	| "INVALID_DIRECTED_SEAM"
	| "INVALID_OPPOSITE_ENDPOINT"
	| "SELECTED_INCIDENCE_UNCOVERED"
	| "DUPLICATE_STRUCTURAL_CORRIDOR";

export type StaticFabSemanticHierarchyCorridorOrientation =
	| "SELECTED_TO_SIBLING"
	| "SIBLING_TO_SELECTED";

export interface StaticFabSemanticHierarchyCorridorEndpoint {
	readonly cell: Readonly<Cell>;
	readonly seam: "DIRECTED_BRANCH" | "DIRECTED_MERGE";
	readonly organizationId: number;
}

export interface StaticFabSemanticHierarchyStructuralCorridor {
	readonly ordinal: number;
	readonly orientation: StaticFabSemanticHierarchyCorridorOrientation;
	readonly selectedEndpoint: StaticFabSemanticHierarchyCorridorEndpoint;
	readonly oppositeEndpoint: StaticFabSemanticHierarchyCorridorEndpoint;
	readonly oppositeBankOrganizationId: number;
	readonly moduleKeys: readonly string[];
	readonly directedEdgeKeys: readonly string[];
	readonly directedEdgeCount: number;
	readonly fingerprint: string;
}

export type StaticFabSemanticHierarchyCutUnreviewedCondition =
	| "RELATIONSHIP_PURPOSE_UNRESOLVED"
	| "CONNECTOR_PROVENANCE_UNRESOLVED"
	| "PROSPECTIVE_SELECTED_TOPOLOGY_UNREVIEWED"
	| "PROSPECTIVE_RETAINED_FAB_TOPOLOGY_UNREVIEWED"
	| "PROSPECTIVE_PORT_ATTACHMENT_UNREVIEWED"
	| "MUTATION_PLAN_UNREVIEWED";

/**
 * Native-reopen structural evidence only. A successful result is not a Detach/Delete plan and
 * grants no Worker, history, document, or UI authority.
 */
export interface StaticFabSemanticHierarchyCutReview {
	readonly version: typeof STATIC_FAB_SEMANTIC_HIERARCHY_CUT_VERSION;
	readonly action: StaticFabSemanticHierarchyRecoveryAction | null;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	readonly targetOrganizationId: number | null;
	readonly parentFabOrganizationId: number | null;
	readonly retainedSiblingBankOrganizationIdSample: readonly number[];
	readonly retainedSiblingBankOrganizationCount: number;
	readonly retainedSiblingBankOrganizationOmittedCount: number;
	readonly retainedSiblingBankOrganizationFingerprint: string | null;
	readonly corridors: readonly StaticFabSemanticHierarchyStructuralCorridor[];
	readonly corridorCount: number;
	readonly directedEdgeCount: number;
	readonly completeCutFingerprint: string | null;
	readonly authority: "NO_MUTATION_AUTHORITY";
	readonly evidenceStatus: "STRUCTURAL_RELATIONSHIP_CORRIDORS_ONLY" | "NOT_EVALUATED";
	readonly cutSetStatus: "STRUCTURAL_COMPLETE_CUT" | "NOT_EVALUATED";
	readonly prospectiveStatus: "NOT_EVALUATED";
	readonly unreviewedConditions: readonly StaticFabSemanticHierarchyCutUnreviewedCondition[];
	readonly structuralCutProved: boolean;
	readonly boundaryIssueCode: StaticFabSemanticHierarchyBoundaryIssueCode | null;
	readonly issueCode: StaticFabSemanticHierarchyCutIssueCode | null;
	readonly reason: string;
}

type ModuleRegion =
	| Readonly<{ kind: "SELECTED"; organizationId: number }>
	| Readonly<{ kind: "PARENT"; organizationId: number }>
	| Readonly<{ kind: "RETAINED"; organizationId: number }>
	| Readonly<{ kind: "FOREIGN"; organizationId: null }>
	| Readonly<{ kind: "UNOWNED"; organizationId: null }>;

interface WholeModuleLookup {
	readonly moduleIndicesByEdgeKey: ReadonlyMap<string, readonly number[]>;
	readonly moduleIndicesBySwitchId: ReadonlyMap<number, readonly number[]>;
}

interface IndexedEdge {
	readonly key: string;
	readonly edge: DirectedRailEdge;
	readonly moduleIndex: number;
	readonly region: ModuleRegion;
}

interface DirectedEdgeIndex {
	readonly byKey: ReadonlyMap<string, IndexedEdge>;
	readonly incomingByCell: ReadonlyMap<string, readonly IndexedEdge[]>;
	readonly outgoingByCell: ReadonlyMap<string, readonly IndexedEdge[]>;
}

interface RegionIndex {
	readonly regionByModuleIndex: readonly ModuleRegion[];
	readonly retainedSiblingBankOrganizationIds: readonly number[];
}

interface DirectModuleOwnershipIndex {
	readonly ownerIdsByModuleIndex: ReadonlyMap<number, readonly number[]>;
	readonly moduleIndicesByOrganizationId: ReadonlyMap<number, readonly number[]>;
}

interface SeamResolution {
	readonly cell: Readonly<Cell>;
	readonly seam: "DIRECTED_BRANCH" | "DIRECTED_MERGE";
	readonly region: ModuleRegion;
}

const EMPTY_NUMBERS = Object.freeze([]) as readonly number[];
const EMPTY_CORRIDORS = Object.freeze(
	[],
) as readonly StaticFabSemanticHierarchyStructuralCorridor[];
const EMPTY_UNREVIEWED = Object.freeze(
	[],
) as readonly StaticFabSemanticHierarchyCutUnreviewedCondition[];
const STRUCTURAL_UNREVIEWED = Object.freeze([
	"RELATIONSHIP_PURPOSE_UNRESOLVED",
	"CONNECTOR_PROVENANCE_UNRESOLVED",
	"PROSPECTIVE_SELECTED_TOPOLOGY_UNREVIEWED",
	"PROSPECTIVE_RETAINED_FAB_TOPOLOGY_UNREVIEWED",
	"PROSPECTIVE_PORT_ATTACHMENT_UNREVIEWED",
	"MUTATION_PLAN_UNREVIEWED",
] as const) satisfies readonly StaticFabSemanticHierarchyCutUnreviewedCondition[];

/**
 * Prove that every parent-Fab module component touching one selected Bank is a complete ordinary
 * directed corridor to one retained sibling Bank. This deliberately does not infer the runtime
 * Connector purpose and does not evaluate the prospective removal.
 */
export function reviewStaticFabSemanticHierarchyCut(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	intentValue: unknown,
	hierarchyReviewValue: unknown,
): StaticFabSemanticHierarchyCutReview {
	const sourceRevision = map.getRevision();
	const sourceMutationGeneration = map.getMutationGeneration();
	const boundary = inventoryStaticFabSemanticHierarchyBoundary(
		map,
		portEquipment,
		organizations,
		intentValue,
		hierarchyReviewValue,
	);
	if (!boundary.candidateInventoryBuilt) {
		return rejectedCut(
			boundary.action,
			boundary.targetRole,
			boundary.targetOrganizationId,
			boundary.parentFabOrganizationId,
			"BOUNDARY_INVENTORY_REJECTED",
			boundary.reason,
			boundary.issueCode,
		);
	}
	const hierarchyReview = hierarchyReviewValue as StaticFabSemanticHierarchyRecoveryReview;
	const targetOrganizationId = boundary.targetOrganizationId as number;
	const parentFabOrganizationId = boundary.parentFabOrganizationId as number;

	try {
		const ownership = buildRailModuleOwnershipIndex(map);
		if (ownership.modules.length !== boundary.sourceModuleCount) {
			throw new CutFailure(
				"STALE_SOURCE",
				"Boundary inventory 이후 Rail module source가 변경되었습니다",
			);
		}
		const lookup = buildWholeModuleLookup(ownership);
		const directModuleOwnership = buildDirectModuleOwnershipIndex(ownership, lookup, organizations);
		const regions = buildRegionIndex(
			ownership,
			directModuleOwnership,
			organizations,
			targetOrganizationId,
			parentFabOrganizationId,
			boundary.targetEffectiveModuleIndices,
			boundary.parentDirectModuleIndices,
		);
		const directedEdges = buildDirectedEdgeIndex(ownership, regions.regionByModuleIndex);
		const corridors = boundary.rawParentComponentCandidates.map((candidate) =>
			analyzeStructuralCorridor(
				candidate,
				ownership,
				directedEdges,
				targetOrganizationId,
				parentFabOrganizationId,
			),
		);
		assertCompleteSelectedIncidence(boundary.rawParentComponentCandidates, corridors);
		const canonicalCorridors = canonicalizeCorridors(corridors);
		assertUniqueCorridors(canonicalCorridors);

		if (
			map.getRevision() !== sourceRevision ||
			map.getMutationGeneration() !== sourceMutationGeneration ||
			hierarchyReview.parentFabOrganizationId !== parentFabOrganizationId
		) {
			throw new CutFailure(
				"STALE_SOURCE",
				"Structural cut review 중 authored source가 변경되었습니다",
			);
		}

		const directedEdgeCount = canonicalCorridors.reduce(
			(sum, corridor) => sum + corridor.directedEdgeCount,
			0,
		);
		return Object.freeze({
			version: STATIC_FAB_SEMANTIC_HIERARCHY_CUT_VERSION,
			action: boundary.action,
			targetRole: boundary.targetRole,
			targetOrganizationId,
			parentFabOrganizationId,
			retainedSiblingBankOrganizationIdSample: Object.freeze(
				regions.retainedSiblingBankOrganizationIds.slice(
					0,
					STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT,
				),
			),
			retainedSiblingBankOrganizationCount: regions.retainedSiblingBankOrganizationIds.length,
			retainedSiblingBankOrganizationOmittedCount: Math.max(
				0,
				regions.retainedSiblingBankOrganizationIds.length -
					STATIC_FAB_SEMANTIC_HIERARCHY_CUT_SIBLING_ID_SAMPLE_LIMIT,
			),
			retainedSiblingBankOrganizationFingerprint: siblingIdsFingerprint(
				parentFabOrganizationId,
				regions.retainedSiblingBankOrganizationIds,
			),
			corridors: canonicalCorridors,
			corridorCount: canonicalCorridors.length,
			directedEdgeCount,
			completeCutFingerprint: completeCutFingerprint(
				targetOrganizationId,
				parentFabOrganizationId,
				canonicalCorridors,
			),
			authority: "NO_MUTATION_AUTHORITY",
			evidenceStatus: "STRUCTURAL_RELATIONSHIP_CORRIDORS_ONLY",
			cutSetStatus: "STRUCTURAL_COMPLETE_CUT",
			prospectiveStatus: "NOT_EVALUATED",
			unreviewedConditions: STRUCTURAL_UNREVIEWED,
			structuralCutProved: true,
			boundaryIssueCode: null,
			issueCode: null,
			reason:
				"모든 selected-Bank incidence를 retained sibling Bank까지 잇는 구조적 directed corridor로 복원했습니다 · runtime purpose, provenance, prospective removal과 mutation 권한은 검토되지 않았습니다",
		}) satisfies StaticFabSemanticHierarchyCutReview;
	} catch (error) {
		const failure =
			error instanceof CutFailure
				? error
				: new CutFailure(
						"INVALID_WHOLE_MODULE_OWNERSHIP",
						`Structural cut source를 해석할 수 없습니다 · ${errorMessage(error)}`,
					);
		return rejectedCut(
			boundary.action,
			boundary.targetRole,
			targetOrganizationId,
			parentFabOrganizationId,
			failure.code,
			failure.message,
			null,
		);
	}
}

function buildRegionIndex(
	ownership: RailModuleOwnershipIndex,
	directModuleOwnership: DirectModuleOwnershipIndex,
	organizations: StaticFabOrganizationState,
	targetOrganizationId: number,
	parentFabOrganizationId: number,
	targetModuleIndices: readonly number[],
	parentModuleIndices: readonly number[],
): RegionIndex {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const retainedSiblingIds = organizations.records
		.filter(
			(record) =>
				record.id !== targetOrganizationId &&
				roles.get(record.id) === "BAY_BANK" &&
				staticFabOrganizationParentIds(record).includes(parentFabOrganizationId),
		)
		.map((record) => record.id)
		.sort((left, right) => left - right);
	if (retainedSiblingIds.length === 0) {
		throw new CutFailure(
			"MISSING_RETAINED_SIBLING",
			"선택 Bank와 같은 root Fab에 남길 semantic sibling Bank가 없습니다",
		);
	}

	const selectedSet = new Set(targetModuleIndices);
	const parentSet = new Set(parentModuleIndices);
	const retainedOwnerByModule = new Map<number, number>();
	const childrenByParentId = new Map<number, number[]>();
	for (const record of organizations.records) {
		for (const parentId of staticFabOrganizationParentIds(record)) {
			appendNumber(childrenByParentId, parentId, record.id);
		}
	}
	const siblingOwnerByOrganizationId = new Map<number, number>();
	for (const siblingId of retainedSiblingIds) {
		const pending = [siblingId];
		for (let offset = 0; offset < pending.length; offset += 1) {
			const organizationId = pending[offset] as number;
			const previous = siblingOwnerByOrganizationId.get(organizationId);
			if (previous !== undefined) {
				if (previous !== siblingId) {
					throw new CutFailure(
						"OVERLAPPING_REGION_OWNERSHIP",
						`Organization ${organizationId}이 retained sibling ${previous}, ${siblingId} subtree에 공유됩니다`,
					);
				}
				continue;
			}
			siblingOwnerByOrganizationId.set(organizationId, siblingId);
			pending.push(...(childrenByParentId.get(organizationId) ?? []));
		}
	}
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	for (const [organizationId, siblingId] of siblingOwnerByOrganizationId) {
		const record = recordsById.get(organizationId);
		const parentIds = record ? staticFabOrganizationParentIds(record) : EMPTY_NUMBERS;
		const role = roles.get(organizationId);
		const parentRole = roles.get(parentIds[0] as number);
		const canonicalRole =
			organizationId === siblingId
				? role === "BAY_BANK"
				: (role === "BAY" && parentRole === "BAY_BANK") ||
					(role === "PROCESS_LOOP" && parentRole === "BAY");
		if (!canonicalRole) {
			throw new CutFailure(
				"NON_CANONICAL_RETAINED_SUBTREE",
				`Retained sibling ${siblingId} subtree organization ${organizationId}의 semantic role lineage가 Bank > Bay > Process Loop가 아닙니다`,
			);
		}
		const canonicalParent =
			organizationId === siblingId
				? parentIds.length === 1 && parentIds[0] === parentFabOrganizationId
				: parentIds.length === 1 &&
					siblingOwnerByOrganizationId.get(parentIds[0] as number) === siblingId;
		if (!canonicalParent) {
			throw new CutFailure(
				"OVERLAPPING_REGION_OWNERSHIP",
				`Retained sibling ${siblingId} subtree organization ${organizationId}의 parent lineage가 canonical single-owner 구조가 아닙니다`,
			);
		}
	}
	for (const [organizationId, siblingId] of siblingOwnerByOrganizationId) {
		for (const moduleIndex of directModuleOwnership.moduleIndicesByOrganizationId.get(
			organizationId,
		) ?? []) {
			if (selectedSet.has(moduleIndex) || parentSet.has(moduleIndex)) {
				throw new CutFailure(
					"OVERLAPPING_REGION_OWNERSHIP",
					`Module ${moduleKey(ownership, moduleIndex)}이 selected/parent와 retained sibling ${siblingId}에 겹칩니다`,
				);
			}
			const previous = retainedOwnerByModule.get(moduleIndex);
			if (previous !== undefined && previous !== siblingId) {
				throw new CutFailure(
					"OVERLAPPING_REGION_OWNERSHIP",
					`Module ${moduleKey(ownership, moduleIndex)}이 retained sibling ${previous}, ${siblingId}에 겹칩니다`,
				);
			}
			const owners = directModuleOwnership.ownerIdsByModuleIndex.get(moduleIndex) ?? EMPTY_NUMBERS;
			if (owners.length !== 1 || owners[0] !== organizationId) {
				throw new CutFailure(
					"INVALID_WHOLE_MODULE_OWNERSHIP",
					`Retained sibling Bank ${siblingId} module ${moduleKey(ownership, moduleIndex)}의 exact direct owner가 하나가 아닙니다`,
				);
			}
			retainedOwnerByModule.set(moduleIndex, siblingId);
		}
	}

	const regionByModuleIndex = ownership.modules.map((_module, moduleIndex): ModuleRegion => {
		if (selectedSet.has(moduleIndex)) {
			return Object.freeze({ kind: "SELECTED", organizationId: targetOrganizationId });
		}
		if (parentSet.has(moduleIndex)) {
			return Object.freeze({ kind: "PARENT", organizationId: parentFabOrganizationId });
		}
		const retainedId = retainedOwnerByModule.get(moduleIndex);
		if (retainedId !== undefined) {
			return Object.freeze({ kind: "RETAINED", organizationId: retainedId });
		}
		return (directModuleOwnership.ownerIdsByModuleIndex.get(moduleIndex)?.length ?? 0) > 0
			? Object.freeze({ kind: "FOREIGN", organizationId: null })
			: Object.freeze({ kind: "UNOWNED", organizationId: null });
	});
	return Object.freeze({
		regionByModuleIndex: Object.freeze(regionByModuleIndex),
		retainedSiblingBankOrganizationIds: Object.freeze(retainedSiblingIds),
	});
}

function analyzeStructuralCorridor(
	candidate: StaticFabSemanticHierarchyRawParentComponentCandidate,
	ownership: RailModuleOwnershipIndex,
	directedEdges: DirectedEdgeIndex,
	targetOrganizationId: number,
	parentFabOrganizationId: number,
): StaticFabSemanticHierarchyStructuralCorridor {
	const componentEdgeKeys = new Set<string>();
	for (const moduleIndex of candidate.parentModuleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module) {
			throw new CutFailure(
				"INVALID_WHOLE_MODULE_OWNERSHIP",
				`Raw parent component ${candidate.ordinal} module ${moduleIndex}을 찾을 수 없습니다`,
			);
		}
		for (const edge of module.eraseEdges) componentEdgeKeys.add(staticFabOrganizationEdgeKey(edge));
	}
	const componentEdges = [...componentEdgeKeys].map((key) => {
		const edge = directedEdges.byKey.get(key);
		if (
			!edge ||
			edge.region.kind !== "PARENT" ||
			edge.region.organizationId !== parentFabOrganizationId
		) {
			throw new CutFailure(
				"INVALID_WHOLE_MODULE_OWNERSHIP",
				`Raw parent component ${candidate.ordinal} edge ${key}가 exact parent-Fab ownership이 아닙니다`,
			);
		}
		return edge;
	});
	if (componentEdges.length !== candidate.directedEdgeCount || componentEdges.length === 0) {
		throw new CutFailure(
			"CANDIDATE_NOT_SIMPLE_DIRECTED_PATH",
			`Raw parent component ${candidate.ordinal} edge inventory가 canonical count와 다릅니다`,
		);
	}

	const localIncoming = groupEdgesByCell(componentEdges, "to");
	const localOutgoing = groupEdgesByCell(componentEdges, "from");
	const vertexKeys = new Set([...localIncoming.keys(), ...localOutgoing.keys()]);
	const starts: string[] = [];
	const ends: string[] = [];
	for (const key of vertexKeys) {
		const incomingCount = localIncoming.get(key)?.length ?? 0;
		const outgoingCount = localOutgoing.get(key)?.length ?? 0;
		if (incomingCount === 0 && outgoingCount === 1) starts.push(key);
		else if (incomingCount === 1 && outgoingCount === 0) ends.push(key);
		else if (incomingCount !== 1 || outgoingCount !== 1) {
			throw new CutFailure(
				"CANDIDATE_NOT_SIMPLE_DIRECTED_PATH",
				`Raw parent component ${candidate.ordinal} 내부 ${key}의 directed degree가 ${incomingCount}/${outgoingCount}입니다`,
			);
		}
	}
	if (starts.length !== 1 || ends.length !== 1) {
		throw new CutFailure(
			"CANDIDATE_NOT_SIMPLE_DIRECTED_PATH",
			`Raw parent component ${candidate.ordinal}은 directed start/end 한 쌍이 아닙니다`,
		);
	}
	const startKey = starts[0] as string;
	const endKey = ends[0] as string;
	const orderedEdges = orderPathEdges(startKey, endKey, localOutgoing, componentEdges.length);
	const firstModule = ownership.modules[orderedEdges[0]?.moduleIndex ?? -1];
	const lastModule = ownership.modules[orderedEdges.at(-1)?.moduleIndex ?? -1];
	if (
		firstModule?.construction.grammar !== "directed-branch" ||
		lastModule?.construction.grammar !== "directed-merge"
	) {
		throw new CutFailure(
			"CANDIDATE_TURNOUT_SHAPE_MISMATCH",
			`Raw parent component ${candidate.ordinal}은 directed-branch에서 시작해 directed-merge로 끝나지 않습니다`,
		);
	}

	for (const key of vertexKeys) {
		if (key === startKey || key === endKey) continue;
		const globalIncoming = directedEdges.incomingByCell.get(key)?.length ?? 0;
		const globalOutgoing = directedEdges.outgoingByCell.get(key)?.length ?? 0;
		if (
			globalIncoming !== (localIncoming.get(key)?.length ?? 0) ||
			globalOutgoing !== (localOutgoing.get(key)?.length ?? 0)
		) {
			throw new CutFailure(
				"INVALID_DIRECTED_SEAM",
				`Raw parent component ${candidate.ordinal} 내부 ${key}에 foreign, unowned, 또는 다른 corridor incidence가 있습니다`,
			);
		}
	}

	const start = resolveSeam(
		parseCellKey(startKey),
		"DIRECTED_BRANCH",
		componentEdgeKeys,
		directedEdges,
		candidate.ordinal,
	);
	const end = resolveSeam(
		parseCellKey(endKey),
		"DIRECTED_MERGE",
		componentEdgeKeys,
		directedEdges,
		candidate.ordinal,
	);
	const selectedSeams = [start, end].filter((seam) => seam.region.kind === "SELECTED");
	const retainedSeams = [start, end].filter((seam) => seam.region.kind === "RETAINED");
	if (selectedSeams.length !== 1 || retainedSeams.length !== 1) {
		throw new CutFailure(
			"INVALID_OPPOSITE_ENDPOINT",
			`Raw parent component ${candidate.ordinal}은 selected Bank 한쪽과 retained sibling Bank 한쪽을 정확히 잇지 않습니다`,
		);
	}
	const selectedSeam = selectedSeams[0] as SeamResolution;
	const retainedSeam = retainedSeams[0] as SeamResolution;
	if (selectedSeam.region.organizationId !== targetOrganizationId) {
		throw new CutFailure(
			"INVALID_OPPOSITE_ENDPOINT",
			`Raw parent component ${candidate.ordinal} selected endpoint identity가 현재 target과 다릅니다`,
		);
	}
	for (const contact of candidate.rawSharedVertexContacts) {
		if (!cellEquals(contact.cell, selectedSeam.cell)) {
			throw new CutFailure(
				"SELECTED_INCIDENCE_UNCOVERED",
				`Raw parent component ${candidate.ordinal}의 selected contact ${cellKey(contact.cell.x, contact.cell.y)}가 certified seam과 다릅니다`,
			);
		}
	}

	const orientation: StaticFabSemanticHierarchyCorridorOrientation =
		selectedSeam.seam === "DIRECTED_BRANCH" ? "SELECTED_TO_SIBLING" : "SIBLING_TO_SELECTED";
	const moduleKeys = Object.freeze(
		candidate.parentModuleIndices.map((index) => moduleKey(ownership, index)).sort(compareStrings),
	);
	const directedEdgeKeys = Object.freeze(orderedEdges.map((edge) => edge.key));
	const selectedEndpoint = freezeEndpoint(selectedSeam);
	const oppositeEndpoint = freezeEndpoint(retainedSeam);
	const oppositeBankOrganizationId = retainedSeam.region.organizationId as number;
	return Object.freeze({
		ordinal: candidate.ordinal,
		orientation,
		selectedEndpoint,
		oppositeEndpoint,
		oppositeBankOrganizationId,
		moduleKeys,
		directedEdgeKeys,
		directedEdgeCount: directedEdgeKeys.length,
		fingerprint: corridorFingerprint(
			targetOrganizationId,
			parentFabOrganizationId,
			orientation,
			selectedEndpoint,
			oppositeEndpoint,
			moduleKeys,
			directedEdgeKeys,
		),
	});
}

function resolveSeam(
	cell: Cell,
	seam: "DIRECTED_BRANCH" | "DIRECTED_MERGE",
	componentEdgeKeys: ReadonlySet<string>,
	directedEdges: DirectedEdgeIndex,
	candidateOrdinal: number,
): SeamResolution {
	const key = cellKey(cell.x, cell.y);
	const incoming = directedEdges.incomingByCell.get(key) ?? [];
	const outgoing = directedEdges.outgoingByCell.get(key) ?? [];
	const componentIncoming = incoming.filter((edge) => componentEdgeKeys.has(edge.key));
	const componentOutgoing = outgoing.filter((edge) => componentEdgeKeys.has(edge.key));
	const outsideIncoming = incoming.filter((edge) => !componentEdgeKeys.has(edge.key));
	const outsideOutgoing = outgoing.filter((edge) => !componentEdgeKeys.has(edge.key));
	const expected =
		seam === "DIRECTED_BRANCH"
			? componentIncoming.length === 0 &&
				componentOutgoing.length === 1 &&
				outsideIncoming.length === 1 &&
				outsideOutgoing.length === 1 &&
				incoming.length === 1 &&
				outgoing.length === 2
			: componentIncoming.length === 1 &&
				componentOutgoing.length === 0 &&
				outsideIncoming.length === 1 &&
				outsideOutgoing.length === 1 &&
				incoming.length === 2 &&
				outgoing.length === 1;
	if (!expected) {
		throw new CutFailure(
			"INVALID_DIRECTED_SEAM",
			`Raw parent component ${candidateOrdinal} ${seam} ${key}의 global directed degree가 ${incoming.length}/${outgoing.length}입니다`,
		);
	}
	const incomingRegion = outsideIncoming[0]?.region;
	const outgoingRegion = outsideOutgoing[0]?.region;
	if (
		!incomingRegion ||
		!outgoingRegion ||
		!sameRegion(incomingRegion, outgoingRegion) ||
		(incomingRegion.kind !== "SELECTED" && incomingRegion.kind !== "RETAINED")
	) {
		throw new CutFailure(
			"INVALID_DIRECTED_SEAM",
			`Raw parent component ${candidateOrdinal} ${seam} ${key}의 through incidence가 하나의 selected/retained Bank 소유가 아닙니다`,
		);
	}
	return Object.freeze({ cell: Object.freeze({ ...cell }), seam, region: incomingRegion });
}

function orderPathEdges(
	startKey: string,
	endKey: string,
	outgoingByCell: ReadonlyMap<string, readonly IndexedEdge[]>,
	expectedCount: number,
): readonly IndexedEdge[] {
	const ordered: IndexedEdge[] = [];
	const visited = new Set<string>();
	let currentKey = startKey;
	while (currentKey !== endKey) {
		const candidates = outgoingByCell.get(currentKey) ?? [];
		if (candidates.length !== 1) {
			throw new CutFailure(
				"CANDIDATE_NOT_SIMPLE_DIRECTED_PATH",
				`Directed corridor ${currentKey}에서 다음 edge가 하나가 아닙니다`,
			);
		}
		const edge = candidates[0] as IndexedEdge;
		if (visited.has(edge.key)) {
			throw new CutFailure("CANDIDATE_NOT_SIMPLE_DIRECTED_PATH", "Directed corridor가 순환합니다");
		}
		visited.add(edge.key);
		ordered.push(edge);
		currentKey = cellKey(edge.edge.to.x, edge.edge.to.y);
		if (ordered.length > expectedCount) {
			throw new CutFailure(
				"CANDIDATE_NOT_SIMPLE_DIRECTED_PATH",
				"Directed corridor 길이가 bounded inventory를 초과합니다",
			);
		}
	}
	if (ordered.length !== expectedCount) {
		throw new CutFailure(
			"CANDIDATE_NOT_SIMPLE_DIRECTED_PATH",
			"Directed corridor가 component의 모든 edge를 정확히 소비하지 않습니다",
		);
	}
	return Object.freeze(ordered);
}

function buildDirectedEdgeIndex(
	ownership: RailModuleOwnershipIndex,
	regions: readonly ModuleRegion[],
): DirectedEdgeIndex {
	const byKey = new Map<string, IndexedEdge>();
	const incomingByCell = new Map<string, IndexedEdge[]>();
	const outgoingByCell = new Map<string, IndexedEdge[]>();
	for (let moduleIndex = 0; moduleIndex < ownership.modules.length; moduleIndex += 1) {
		const module = ownership.modules[moduleIndex];
		const region = regions[moduleIndex];
		if (!module || !region) continue;
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (byKey.has(key)) {
				throw new CutFailure(
					"AMBIGUOUS_EDGE_MODULE",
					`Directed edge ${key}가 둘 이상의 whole module에 포함됩니다`,
				);
			}
			const indexed = Object.freeze({ key, edge, moduleIndex, region });
			byKey.set(key, indexed);
			appendEdge(incomingByCell, cellKey(edge.to.x, edge.to.y), indexed);
			appendEdge(outgoingByCell, cellKey(edge.from.x, edge.from.y), indexed);
		}
	}
	return Object.freeze({
		byKey,
		incomingByCell: freezeEdgeGroups(incomingByCell),
		outgoingByCell: freezeEdgeGroups(outgoingByCell),
	});
}

function buildDirectModuleOwnershipIndex(
	ownership: RailModuleOwnershipIndex,
	lookup: WholeModuleLookup,
	organizations: StaticFabOrganizationState,
): DirectModuleOwnershipIndex {
	const ownersByModule = new Map<number, number[]>();
	const moduleIndicesByOrganizationId = new Map<number, readonly number[]>();
	for (const record of organizations.records) {
		const moduleIndices = exactModuleIndicesForMembership(
			ownership,
			lookup,
			record.membership,
			`organization ${record.id} direct membership`,
		);
		moduleIndicesByOrganizationId.set(record.id, moduleIndices);
		for (const moduleIndex of moduleIndices) {
			const owners = ownersByModule.get(moduleIndex);
			if (owners) owners.push(record.id);
			else ownersByModule.set(moduleIndex, [record.id]);
		}
	}
	return Object.freeze({
		ownerIdsByModuleIndex: new Map(
			[...ownersByModule].map(([moduleIndex, owners]) => [
				moduleIndex,
				Object.freeze(owners.sort((left, right) => left - right)),
			]),
		),
		moduleIndicesByOrganizationId,
	});
}

function buildWholeModuleLookup(ownership: RailModuleOwnershipIndex): WholeModuleLookup {
	const moduleIndicesByEdgeKey = new Map<string, number[]>();
	const moduleIndicesBySwitchId = new Map<number, number[]>();
	for (let moduleIndex = 0; moduleIndex < ownership.modules.length; moduleIndex += 1) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) {
			appendNumber(moduleIndicesByEdgeKey, staticFabOrganizationEdgeKey(edge), moduleIndex);
		}
		if (module.advancedSwitchId !== null) {
			appendNumber(moduleIndicesBySwitchId, module.advancedSwitchId, moduleIndex);
		}
	}
	return Object.freeze({
		moduleIndicesByEdgeKey: freezeNumberGroups(moduleIndicesByEdgeKey),
		moduleIndicesBySwitchId: freezeNumberGroups(moduleIndicesBySwitchId),
	});
}

function exactModuleIndicesForMembership(
	ownership: RailModuleOwnershipIndex,
	lookup: WholeModuleLookup,
	membership: StaticFabOrganizationMembership,
	label: string,
): readonly number[] {
	const edgeKeys = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const switchIds = new Set(membership.advancedSwitchIds);
	const resolvedEdgeKeys = new Set<string>();
	const resolvedSwitchIds = new Set<number>();
	const touched = new Set<number>();
	for (const key of edgeKeys) {
		for (const moduleIndex of lookup.moduleIndicesByEdgeKey.get(key) ?? [])
			touched.add(moduleIndex);
	}
	for (const switchId of switchIds) {
		for (const moduleIndex of lookup.moduleIndicesBySwitchId.get(switchId) ?? []) {
			touched.add(moduleIndex);
		}
	}
	const result = [...touched].sort((left, right) => left - right);
	for (const moduleIndex of result) {
		const module = ownership.modules[moduleIndex] as RailModuleOwnership;
		if (
			module.eraseEdges.some((edge) => !edgeKeys.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && !switchIds.has(module.advancedSwitchId))
		) {
			throw new CutFailure(
				"INVALID_WHOLE_MODULE_OWNERSHIP",
				`${label}이 module ${module.key} 전체를 포함하지 않습니다`,
			);
		}
		for (const edge of module.eraseEdges) resolvedEdgeKeys.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) resolvedSwitchIds.add(module.advancedSwitchId);
	}
	if (!setEquals(edgeKeys, resolvedEdgeKeys) || !setEquals(switchIds, resolvedSwitchIds)) {
		throw new CutFailure(
			"INVALID_WHOLE_MODULE_OWNERSHIP",
			`${label}을 exact whole-module union으로 복원할 수 없습니다`,
		);
	}
	return Object.freeze(result);
}

function assertCompleteSelectedIncidence(
	candidates: readonly StaticFabSemanticHierarchyRawParentComponentCandidate[],
	corridors: readonly StaticFabSemanticHierarchyStructuralCorridor[],
): void {
	if (candidates.length === 0 || corridors.length !== candidates.length) {
		throw new CutFailure(
			"SELECTED_INCIDENCE_UNCOVERED",
			"Selected Bank의 모든 raw parent component가 structural corridor로 소비되지 않았습니다",
		);
	}
	for (let index = 0; index < candidates.length; index += 1) {
		if ((candidates[index]?.rawSharedVertexContacts.length ?? 0) === 0) {
			throw new CutFailure(
				"SELECTED_INCIDENCE_UNCOVERED",
				`Raw parent component ${candidates[index]?.ordinal ?? index + 1}에 selected incidence가 없습니다`,
			);
		}
	}
}

function canonicalizeCorridors(
	corridors: readonly StaticFabSemanticHierarchyStructuralCorridor[],
): readonly StaticFabSemanticHierarchyStructuralCorridor[] {
	return Object.freeze(
		[...corridors]
			.sort((left, right) => compareStrings(left.fingerprint, right.fingerprint))
			.map((corridor, index) => Object.freeze({ ...corridor, ordinal: index + 1 })),
	);
}

function assertUniqueCorridors(
	corridors: readonly StaticFabSemanticHierarchyStructuralCorridor[],
): void {
	const fingerprints = new Set<string>();
	const edgeKeys = new Set<string>();
	const moduleKeys = new Set<string>();
	for (const corridor of corridors) {
		if (fingerprints.has(corridor.fingerprint)) {
			throw new CutFailure(
				"DUPLICATE_STRUCTURAL_CORRIDOR",
				`Structural corridor fingerprint ${corridor.fingerprint}가 중복되었습니다`,
			);
		}
		fingerprints.add(corridor.fingerprint);
		for (const key of corridor.directedEdgeKeys) {
			if (edgeKeys.has(key)) {
				throw new CutFailure(
					"DUPLICATE_STRUCTURAL_CORRIDOR",
					`Structural corridor directed edge ${key}가 둘 이상의 corridor에 포함됩니다`,
				);
			}
			edgeKeys.add(key);
		}
		for (const key of corridor.moduleKeys) {
			if (moduleKeys.has(key)) {
				throw new CutFailure(
					"DUPLICATE_STRUCTURAL_CORRIDOR",
					`Structural corridor module ${key}가 둘 이상의 corridor에 포함됩니다`,
				);
			}
			moduleKeys.add(key);
		}
	}
}

function corridorFingerprint(
	targetOrganizationId: number,
	parentFabOrganizationId: number,
	orientation: StaticFabSemanticHierarchyCorridorOrientation,
	selectedEndpoint: StaticFabSemanticHierarchyCorridorEndpoint,
	oppositeEndpoint: StaticFabSemanticHierarchyCorridorEndpoint,
	moduleKeys: readonly string[],
	directedEdgeKeys: readonly string[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addCachedString("STATIC_FAB_SEMANTIC_STRUCTURAL_CORRIDOR_V1");
	checksum.addNumbers([
		targetOrganizationId,
		parentFabOrganizationId,
		oppositeEndpoint.organizationId,
		orientation === "SELECTED_TO_SIBLING" ? 1 : 2,
		selectedEndpoint.cell.x,
		selectedEndpoint.cell.y,
		oppositeEndpoint.cell.x,
		oppositeEndpoint.cell.y,
	]);
	checksum.addStrings(moduleKeys);
	checksum.addStrings(directedEdgeKeys);
	return checksum.digest();
}

function completeCutFingerprint(
	targetOrganizationId: number,
	parentFabOrganizationId: number,
	corridors: readonly StaticFabSemanticHierarchyStructuralCorridor[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addCachedString("STATIC_FAB_SEMANTIC_STRUCTURAL_COMPLETE_CUT_V1");
	checksum.addNumbers([targetOrganizationId, parentFabOrganizationId, corridors.length]);
	checksum.addStrings(corridors.map((corridor) => corridor.fingerprint));
	return checksum.digest();
}

function siblingIdsFingerprint(
	parentFabOrganizationId: number,
	siblingIds: readonly number[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addCachedString("STATIC_FAB_SEMANTIC_RETAINED_SIBLINGS_V1");
	checksum.addNumbers([parentFabOrganizationId, siblingIds.length, ...siblingIds]);
	return checksum.digest();
}

function rejectedCut(
	action: StaticFabSemanticHierarchyRecoveryAction | null,
	targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null,
	targetOrganizationId: number | null,
	parentFabOrganizationId: number | null,
	issueCode: StaticFabSemanticHierarchyCutIssueCode,
	reason: string,
	boundaryIssueCode: StaticFabSemanticHierarchyBoundaryIssueCode | null,
): StaticFabSemanticHierarchyCutReview {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_HIERARCHY_CUT_VERSION,
		action,
		targetRole,
		targetOrganizationId,
		parentFabOrganizationId,
		retainedSiblingBankOrganizationIdSample: EMPTY_NUMBERS,
		retainedSiblingBankOrganizationCount: 0,
		retainedSiblingBankOrganizationOmittedCount: 0,
		retainedSiblingBankOrganizationFingerprint: null,
		corridors: EMPTY_CORRIDORS,
		corridorCount: 0,
		directedEdgeCount: 0,
		completeCutFingerprint: null,
		authority: "NO_MUTATION_AUTHORITY",
		evidenceStatus: "NOT_EVALUATED",
		cutSetStatus: "NOT_EVALUATED",
		prospectiveStatus: "NOT_EVALUATED",
		unreviewedConditions: EMPTY_UNREVIEWED,
		structuralCutProved: false,
		boundaryIssueCode,
		issueCode,
		reason,
	});
}

function freezeEndpoint(seam: SeamResolution): StaticFabSemanticHierarchyCorridorEndpoint {
	return Object.freeze({
		cell: seam.cell,
		seam: seam.seam,
		organizationId: seam.region.organizationId as number,
	});
}

function groupEdgesByCell(
	edges: readonly IndexedEdge[],
	endpoint: "from" | "to",
): ReadonlyMap<string, readonly IndexedEdge[]> {
	const groups = new Map<string, IndexedEdge[]>();
	for (const edge of edges) {
		const cell = edge.edge[endpoint];
		appendEdge(groups, cellKey(cell.x, cell.y), edge);
	}
	return freezeEdgeGroups(groups);
}

function freezeEdgeGroups(
	groups: Map<string, IndexedEdge[]>,
): ReadonlyMap<string, readonly IndexedEdge[]> {
	return new Map(
		[...groups].map(([key, edges]) => [
			key,
			Object.freeze([...edges].sort((left, right) => compareStrings(left.key, right.key))),
		]),
	);
}

function appendEdge(groups: Map<string, IndexedEdge[]>, key: string, edge: IndexedEdge): void {
	const edges = groups.get(key);
	if (edges) edges.push(edge);
	else groups.set(key, [edge]);
}

function appendNumber<Key>(groups: Map<Key, number[]>, key: Key, value: number): void {
	const values = groups.get(key);
	if (values) values.push(value);
	else groups.set(key, [value]);
}

function freezeNumberGroups<Key>(groups: Map<Key, number[]>): ReadonlyMap<Key, readonly number[]> {
	return new Map(
		[...groups].map(([key, values]) => [
			key,
			Object.freeze(values.sort((left, right) => left - right)),
		]),
	);
}

function sameRegion(left: ModuleRegion, right: ModuleRegion): boolean {
	return left.kind === right.kind && left.organizationId === right.organizationId;
}

function moduleKey(ownership: RailModuleOwnershipIndex, moduleIndex: number): string {
	return ownership.modules[moduleIndex]?.key ?? String(moduleIndex);
}

function parseCellKey(key: string): Cell {
	const separator = key.indexOf(",");
	return { x: Number(key.slice(0, separator)), y: Number(key.slice(separator + 1)) };
}

function cellEquals(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function setEquals<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "unknown source error";
}

class CutFailure extends Error {
	readonly code: StaticFabSemanticHierarchyCutIssueCode;

	constructor(code: StaticFabSemanticHierarchyCutIssueCode, message: string) {
		super(message);
		this.code = code;
	}
}
