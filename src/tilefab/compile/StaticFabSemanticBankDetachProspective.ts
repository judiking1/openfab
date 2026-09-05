import type { PortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork, type RailNetworkAnalysis } from "../core/network";
import { portEquipmentLayoutError } from "../core/PortEquipmentLayoutValidator";
import { type RailMutation, railMutationTopologyError } from "../core/paint";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
} from "../core/RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell, oppositeDirection } from "../core/railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import { STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MODULES } from "../core/StaticFabSemanticHierarchyBoundary";
import {
	reviewStaticFabSemanticHierarchyCut,
	type StaticFabSemanticHierarchyCutIssueCode,
} from "../core/StaticFabSemanticHierarchyCut";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	type StaticFabSemanticHierarchyRecoveryAction,
	type StaticFabSemanticHierarchyRecoveryTargetRole,
} from "../core/StaticFabSemanticHierarchyRecovery";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "../core/TileMap";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import { buildPhysicalPathAdjacency } from "./PhysicalPathFlow";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";

export const STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_VERSION = 1 as const;
export const STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_MAX_POST_CUT_MODULES =
	STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MODULES;

export type StaticFabSemanticBankDetachProspectiveIssueCode =
	| "STRUCTURAL_CUT_REJECTED"
	| "UNSUPPORTED_OPERATION"
	| "STALE_SOURCE"
	| "CUT_EDGE_RESOLUTION_FAILED"
	| "SOURCE_TOPOLOGY_INVALID"
	| "EDGE_REMOVAL_INVALID"
	| "POST_CUT_BUDGET_EXCEEDED"
	| "AMBIGUOUS_POST_CUT_OWNERSHIP"
	| "MEMBERSHIP_REMATERIALIZATION_FAILED"
	| "SELECTED_BANK_TOPOLOGY_INVALID"
	| "RETAINED_FAB_TOPOLOGY_INVALID"
	| "RETAINED_FAB_DIRECT_MEMBERSHIP_EMPTY"
	| "ORGANIZATION_INVALID"
	| "PORT_ATTACHMENT_INVALID"
	| "CURSOR_MISMATCH"
	| "COMPONENT_DELTA_INVALID";

export interface StaticFabSemanticBankDetachTopologyEvidence {
	readonly authoredCellCount: number;
	readonly authoredDirectedEdgeCount: number;
	readonly authoredComponentCount: number;
	readonly authoredStrongComponentCount: number;
	readonly authoredOpenTerminalCount: number;
	readonly authoredUnsafeJunctionCount: number;
	readonly authoredComponentsClosed: boolean;
	readonly physicalPathCount: number;
	readonly physicalComponentCount: number;
	readonly physicalStrongComponentCount: number;
	readonly physicalOpenPathCount: number;
	readonly physicalInvalidPathCount: number;
	readonly physicalDiagnosticCount: number;
	readonly physicalTerminalCount: number;
	readonly physicalClearanceIssueCount: number;
	readonly physicalComponentsClosed: boolean;
	readonly authoredPhysicalComponentMappingExact: boolean;
}

export interface StaticFabSemanticBankDetachRegionEvidence {
	readonly authoredComponentCount: number;
	readonly authoredStrongComponentCount: number;
	readonly physicalComponentCount: number;
	readonly physicalStrongComponentCount: number;
	readonly completeModuleCoverage: boolean;
	readonly closed: boolean;
}

export interface StaticFabSemanticBankDetachProspectiveReview {
	readonly version: typeof STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_VERSION;
	readonly action: StaticFabSemanticHierarchyRecoveryAction | null;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	readonly targetOrganizationId: number | null;
	readonly parentFabOrganizationId: number | null;
	readonly structuralCutFingerprint: string | null;
	readonly structuralCorridorCount: number;
	readonly removedDirectedEdgeCount: number;
	readonly sourceTopology: StaticFabSemanticBankDetachTopologyEvidence | null;
	readonly evaluatedTopology: StaticFabSemanticBankDetachTopologyEvidence | null;
	readonly selectedBankTopology: StaticFabSemanticBankDetachRegionEvidence | null;
	readonly retainedFabTopology: StaticFabSemanticBankDetachRegionEvidence | null;
	readonly authoredComponentDelta: number | null;
	readonly physicalComponentDelta: number | null;
	readonly sourcePortCount: number;
	readonly sourceEquipmentGroupCount: number;
	readonly portAttachmentStatus: "VALID" | "NOT_EVALUATED";
	readonly cursorStatus: "PRESERVED" | "NOT_EVALUATED";
	readonly relationshipPurposeStatus: "UNRESOLVED";
	readonly connectorProvenanceStatus: "UNRESOLVED";
	readonly mutationPlanStatus: "UNREVIEWED";
	readonly authority: "NO_MUTATION_AUTHORITY";
	readonly evidenceStatus: "PROSPECTIVE_BANK_DETACH_ONLY" | "NOT_EVALUATED";
	readonly prospectiveDetachProved: boolean;
	readonly structuralCutIssueCode: StaticFabSemanticHierarchyCutIssueCode | null;
	readonly issueCode: StaticFabSemanticBankDetachProspectiveIssueCode | null;
	readonly reason: string;
}

export interface StaticFabSemanticBankDetachPostCutOwnerReview {
	readonly status: "EXACT_DIRECT_OWNER" | "WHOLLY_UNOWNED" | "AMBIGUOUS";
	readonly ownerId: number | null;
	readonly issueCode: "AMBIGUOUS_POST_CUT_OWNERSHIP" | null;
	readonly authority: "NO_MUTATION_AUTHORITY";
	readonly reason: string;
}

interface ModuleLookup {
	readonly moduleIndicesByEdgeKey: ReadonlyMap<string, readonly number[]>;
	readonly moduleIndicesBySwitchId: ReadonlyMap<number, readonly number[]>;
}

interface DirectOwnerClaims {
	readonly ownerIdsByEdgeKey: ReadonlyMap<string, ReadonlySet<number>>;
	readonly ownerIdsBySwitchId: ReadonlyMap<number, ReadonlySet<number>>;
}

interface AuthoredComponents {
	readonly componentByCellKey: ReadonlyMap<string, number>;
	readonly componentCount: number;
}

interface PhysicalComponents {
	readonly componentCount: number;
	readonly countsByAuthoredComponent: ReadonlyMap<number, number>;
	readonly mappingExact: boolean;
}

interface EvaluatedTopology {
	readonly evidence: StaticFabSemanticBankDetachTopologyEvidence;
	readonly authoredComponents: AuthoredComponents;
	readonly physicalComponents: PhysicalComponents;
}

interface EvaluationSnapshot {
	action: StaticFabSemanticHierarchyRecoveryAction | null;
	targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	targetOrganizationId: number | null;
	parentFabOrganizationId: number | null;
	structuralCutFingerprint: string | null;
	structuralCorridorCount: number;
	removedDirectedEdgeCount: number;
	sourceTopology: StaticFabSemanticBankDetachTopologyEvidence | null;
	evaluatedTopology: StaticFabSemanticBankDetachTopologyEvidence | null;
	selectedBankTopology: StaticFabSemanticBankDetachRegionEvidence | null;
	retainedFabTopology: StaticFabSemanticBankDetachRegionEvidence | null;
	authoredComponentDelta: number | null;
	physicalComponentDelta: number | null;
	portAttachmentStatus: "VALID" | "NOT_EVALUATED";
	cursorStatus: "PRESERVED" | "NOT_EVALUATED";
}

const EMPTY_NUMBERS = Object.freeze([]) as readonly number[];
const EMPTY_OWNER_IDS: ReadonlySet<number> = new Set<number>();

/**
 * Evaluate one current-source semantic Bank detach without returning executable state or granting
 * any history, Worker, document, or UI authority.
 */
export function reviewStaticFabSemanticBankDetachProspective(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	intentValue: unknown,
): StaticFabSemanticBankDetachProspectiveReview {
	const sourceRevision = map.getRevision();
	const sourceMutationGeneration = map.getMutationGeneration();
	const sourceEdgeCount = map.edgeCount;
	const sourceSwitchCount = map.advancedSwitchCount;
	const sourceSwitchCursor = map.getAdvancedSwitchIdCursor();
	const sourceNextPortId = portEquipment.nextPortId;
	const sourceNextEquipmentGroupId = portEquipment.nextEquipmentGroupId;
	const sourceNextOrganizationId = organizations.nextOrganizationId;
	const snapshot: EvaluationSnapshot = {
		action: null,
		targetRole: null,
		targetOrganizationId: null,
		parentFabOrganizationId: null,
		structuralCutFingerprint: null,
		structuralCorridorCount: 0,
		removedDirectedEdgeCount: 0,
		sourceTopology: null,
		evaluatedTopology: null,
		selectedBankTopology: null,
		retainedFabTopology: null,
		authoredComponentDelta: null,
		physicalComponentDelta: null,
		portAttachmentStatus: "NOT_EVALUATED",
		cursorStatus: "NOT_EVALUATED",
	};

	const hierarchy = reviewStaticFabSemanticHierarchyRecovery(organizations, intentValue);
	const cut = reviewStaticFabSemanticHierarchyCut(
		map,
		portEquipment,
		organizations,
		intentValue,
		hierarchy,
	);
	snapshot.action = cut.action;
	snapshot.targetRole = cut.targetRole;
	snapshot.targetOrganizationId = cut.targetOrganizationId;
	snapshot.parentFabOrganizationId = cut.parentFabOrganizationId;
	snapshot.structuralCutFingerprint = cut.completeCutFingerprint;
	snapshot.structuralCorridorCount = cut.corridorCount;

	if (!cut.structuralCutProved) {
		return rejected(snapshot, portEquipment, "STRUCTURAL_CUT_REJECTED", cut.reason, cut.issueCode);
	}
	if (cut.action !== "DETACH" || cut.targetRole !== "BAY_BANK") {
		return rejected(
			snapshot,
			portEquipment,
			"UNSUPPORTED_OPERATION",
			"Prospective review는 attached semantic Bay Bank DETACH만 지원합니다",
			null,
		);
	}

	try {
		const targetOrganizationId = requireNumber(cut.targetOrganizationId, "target organization");
		const parentFabOrganizationId = requireNumber(
			cut.parentFabOrganizationId,
			"parent Fab organization",
		);
		const sourceLayout = compilePhysicalRail(map);
		const sourceEvaluation = evaluateTopology(map, sourceLayout);
		snapshot.sourceTopology = sourceEvaluation.evidence;
		assertClosedTopology(sourceEvaluation.evidence, "SOURCE_TOPOLOGY_INVALID", "source");
		assertPortAttachments(map, sourceLayout, portEquipment);

		const sourceOwnership = buildRailModuleOwnershipIndex(map);
		const sourceOwnerClaims = buildDirectOwnerClaims(organizations);
		const sourceEdges = collectDirectedEdges(map);
		const cutEdgeKeys = new Set(cut.corridors.flatMap((corridor) => corridor.directedEdgeKeys));
		if (cutEdgeKeys.size !== cut.directedEdgeCount) {
			throw new ProspectiveFailure(
				"CUT_EDGE_RESOLUTION_FAILED",
				"Structural cut edge inventory contains duplicate directed edges",
			);
		}
		const cutEdges = resolveExactCutEdges(sourceOwnership, cutEdgeKeys);
		snapshot.removedDirectedEdgeCount = cutEdges.length;
		const privateMap = map.clone();
		removeDirectedEdges(privateMap, cutEdges);
		if (privateMap.edgeCount !== sourceEdgeCount - cut.directedEdgeCount) {
			throw new ProspectiveFailure(
				"EDGE_REMOVAL_INVALID",
				`Evaluated directed-edge count does not equal source minus fresh structural cut · expected ${sourceEdgeCount - cut.directedEdgeCount} / actual ${privateMap.edgeCount}`,
			);
		}
		if (
			privateMap.advancedSwitchCount !== sourceSwitchCount ||
			privateMap.getAdvancedSwitchIdCursor() !== sourceSwitchCursor ||
			portEquipment.nextPortId !== sourceNextPortId ||
			portEquipment.nextEquipmentGroupId !== sourceNextEquipmentGroupId ||
			organizations.nextOrganizationId !== sourceNextOrganizationId
		) {
			throw new ProspectiveFailure(
				"CURSOR_MISMATCH",
				"Prospective Bank detach changed a persisted allocation cursor",
			);
		}
		snapshot.cursorStatus = "PRESERVED";
		for (const [key, edge] of sourceEdges) {
			const survives = directedEdgeExists(privateMap, edge);
			if (cutEdgeKeys.has(key) ? survives : !survives) {
				throw new ProspectiveFailure(
					"EDGE_REMOVAL_INVALID",
					cutEdgeKeys.has(key)
						? `Evaluated source still contains structural cut edge ${key}`
						: `Evaluated source lost non-cut edge ${key}`,
				);
			}
		}
		for (const key of cutEdgeKeys) {
			if (!sourceEdges.has(key)) {
				throw new ProspectiveFailure(
					"CUT_EDGE_RESOLUTION_FAILED",
					`Structural cut edge ${key} is absent from the current authored edge inventory`,
				);
			}
		}

		const evaluatedOwnership = buildRailModuleOwnershipIndex(privateMap);
		const postCutBudgetError = staticFabSemanticBankDetachPostCutModuleBudgetError(
			evaluatedOwnership.modules.length,
		);
		if (postCutBudgetError) {
			throw new ProspectiveFailure("POST_CUT_BUDGET_EXCEEDED", postCutBudgetError);
		}
		const evaluatedLookup = buildModuleLookup(evaluatedOwnership);
		const memberships = rematerializeMemberships(
			organizations,
			evaluatedOwnership,
			sourceOwnerClaims,
		);
		assertOrganizationPortMemberships(organizations, memberships, portEquipment);
		const selectedIds = organizationSubtreeIds(organizations, targetOrganizationId);
		const retainedIds = [...organizationSubtreeIds(organizations, parentFabOrganizationId)].filter(
			(id) => !selectedIds.has(id),
		);
		const selectedMembership = mergeMemberships(selectedIds, memberships);
		const retainedMembership = mergeMemberships(new Set(retainedIds), memberships);

		const evaluatedLayout = compilePhysicalRail(privateMap);
		const evaluated = evaluateTopology(privateMap, evaluatedLayout);
		snapshot.evaluatedTopology = evaluated.evidence;
		snapshot.authoredComponentDelta =
			evaluated.evidence.authoredComponentCount - sourceEvaluation.evidence.authoredComponentCount;
		snapshot.physicalComponentDelta =
			evaluated.evidence.physicalComponentCount - sourceEvaluation.evidence.physicalComponentCount;
		assertClosedTopology(evaluated.evidence, "EDGE_REMOVAL_INVALID", "evaluated source");
		assertPortAttachments(privateMap, evaluatedLayout, portEquipment);
		snapshot.portAttachmentStatus = "VALID";

		const modulesByComponent = moduleIndicesByAuthoredComponent(
			evaluatedOwnership,
			evaluated.authoredComponents,
		);
		snapshot.selectedBankTopology = regionEvidence(
			selectedMembership,
			evaluatedOwnership,
			evaluatedLookup,
			evaluated.authoredComponents,
			evaluated.physicalComponents,
			modulesByComponent,
		);
		snapshot.retainedFabTopology = regionEvidence(
			retainedMembership,
			evaluatedOwnership,
			evaluatedLookup,
			evaluated.authoredComponents,
			evaluated.physicalComponents,
			modulesByComponent,
		);
		if (!snapshot.selectedBankTopology.closed) {
			throw new ProspectiveFailure(
				"SELECTED_BANK_TOPOLOGY_INVALID",
				"Structural cut 이후 selected Bank가 exact authored/physical closed component 하나가 아닙니다",
			);
		}
		if (!snapshot.retainedFabTopology.closed) {
			throw new ProspectiveFailure(
				"RETAINED_FAB_TOPOLOGY_INVALID",
				"Structural cut 이후 retained Fab content가 exact authored/physical closed component 하나가 아닙니다",
			);
		}

		const parentMembership = memberships.get(parentFabOrganizationId);
		if (!parentMembership || membershipItemCount(parentMembership) === 0) {
			throw new ProspectiveFailure(
				"RETAINED_FAB_DIRECT_MEMBERSHIP_EMPTY",
				"Structural cut 이후 retained Fab direct membership이 비어 organization record를 유지할 수 없습니다",
			);
		}
		const evaluatedOrganizations = buildEvaluatedOrganizations(
			organizations,
			memberships,
			targetOrganizationId,
			parentFabOrganizationId,
		);
		const organizationError = staticFabOrganizationStateError(
			privateMap,
			portEquipment,
			evaluatedOrganizations,
		);
		if (organizationError) {
			throw new ProspectiveFailure(
				"ORGANIZATION_INVALID",
				`Evaluated organization state is invalid · ${organizationError}`,
			);
		}
		if (snapshot.authoredComponentDelta !== 1 || snapshot.physicalComponentDelta !== 1) {
			throw new ProspectiveFailure(
				"COMPONENT_DELTA_INVALID",
				`Bank detach must add exactly one authored and physical component · authored ${snapshot.authoredComponentDelta} / physical ${snapshot.physicalComponentDelta}`,
			);
		}
		if (
			privateMap.getAdvancedSwitchIdCursor() !== sourceSwitchCursor ||
			portEquipment.nextPortId !== sourceNextPortId ||
			portEquipment.nextEquipmentGroupId !== sourceNextEquipmentGroupId ||
			evaluatedOrganizations.nextOrganizationId !== sourceNextOrganizationId
		) {
			throw new ProspectiveFailure(
				"CURSOR_MISMATCH",
				"Prospective Bank detach changed a persisted allocation cursor",
			);
		}
		if (
			map.getRevision() !== sourceRevision ||
			map.getMutationGeneration() !== sourceMutationGeneration ||
			map.getAdvancedSwitchIdCursor() !== sourceSwitchCursor
		) {
			throw new ProspectiveFailure(
				"STALE_SOURCE",
				"Prospective Bank detach review 중 authored source가 변경되었습니다",
			);
		}

		return Object.freeze({
			version: STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_VERSION,
			action: snapshot.action,
			targetRole: snapshot.targetRole,
			targetOrganizationId: snapshot.targetOrganizationId,
			parentFabOrganizationId: snapshot.parentFabOrganizationId,
			structuralCutFingerprint: snapshot.structuralCutFingerprint,
			structuralCorridorCount: snapshot.structuralCorridorCount,
			removedDirectedEdgeCount: snapshot.removedDirectedEdgeCount,
			sourceTopology: snapshot.sourceTopology,
			evaluatedTopology: snapshot.evaluatedTopology,
			selectedBankTopology: snapshot.selectedBankTopology,
			retainedFabTopology: snapshot.retainedFabTopology,
			authoredComponentDelta: snapshot.authoredComponentDelta,
			physicalComponentDelta: snapshot.physicalComponentDelta,
			sourcePortCount: portEquipment.ports.length,
			sourceEquipmentGroupCount: portEquipment.equipmentGroups.length,
			portAttachmentStatus: snapshot.portAttachmentStatus,
			cursorStatus: snapshot.cursorStatus,
			relationshipPurposeStatus: "UNRESOLVED",
			connectorProvenanceStatus: "UNRESOLVED",
			mutationPlanStatus: "UNREVIEWED",
			authority: "NO_MUTATION_AUTHORITY",
			evidenceStatus: "PROSPECTIVE_BANK_DETACH_ONLY",
			prospectiveDetachProved: true,
			structuralCutIssueCode: null,
			issueCode: null,
			reason:
				"Structural cut 이후 selected Bank와 retained Fab가 각각 exact closed authored/physical component로 유지됩니다 · relationship purpose와 connector provenance는 unresolved입니다",
		}) satisfies StaticFabSemanticBankDetachProspectiveReview;
	} catch (error) {
		const failure =
			error instanceof ProspectiveFailure
				? error
				: new ProspectiveFailure(
						"MEMBERSHIP_REMATERIALIZATION_FAILED",
						`Prospective Bank detach evidence를 계산할 수 없습니다 · ${errorMessage(error)}`,
					);
		return rejected(snapshot, portEquipment, failure.code, failure.message, null);
	}
}

function resolveExactCutEdges(
	ownership: RailModuleOwnershipIndex,
	cutEdgeKeys: ReadonlySet<string>,
): readonly DirectedRailEdge[] {
	const byKey = new Map<string, DirectedRailEdge[]>();
	for (const module of ownership.modules) {
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (!cutEdgeKeys.has(key)) continue;
			const rows = byKey.get(key);
			if (rows) rows.push(edge);
			else byKey.set(key, [edge]);
		}
	}
	const resolved: DirectedRailEdge[] = [];
	for (const key of [...cutEdgeKeys].sort()) {
		const candidates = byKey.get(key) ?? [];
		if (candidates.length !== 1) {
			throw new ProspectiveFailure(
				"CUT_EDGE_RESOLUTION_FAILED",
				`Structural cut edge ${key} resolves to ${candidates.length} current modules`,
			);
		}
		resolved.push(candidates[0] as DirectedRailEdge);
	}
	return Object.freeze(resolved);
}

function removeDirectedEdges(map: TileMap, edges: readonly DirectedRailEdge[]): void {
	const overlay = new Map<string, RailMutation>();
	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, after: number): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = overlay.get(key);
		overlay.set(key, {
			x: cell.x,
			y: cell.y,
			before: existing?.before ?? map.getEncoded(cell.x, cell.y),
			after,
		});
	};
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) {
			throw new ProspectiveFailure("EDGE_REMOVAL_INVALID", "Structural cut edge is not cardinal");
		}
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		if ((from.outgoing & direction) === 0 || (to.incoming & opposite) === 0) {
			throw new ProspectiveFailure(
				"EDGE_REMOVAL_INVALID",
				`Structural cut edge ${staticFabOrganizationEdgeKey(edge)} is absent from current source`,
			);
		}
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
	}
	const changes = Object.freeze(
		[...overlay.values()]
			.filter((entry) => entry.before !== entry.after)
			.sort((left, right) => left.y - right.y || left.x - right.x),
	);
	const topologyError = railMutationTopologyError(map, changes);
	if (topologyError) {
		throw new ProspectiveFailure(
			"EDGE_REMOVAL_INVALID",
			`Structural cut removal violates authored topology · ${topologyError}`,
		);
	}
	if (!map.applyAtomicMutations(changes, [])) {
		throw new ProspectiveFailure("EDGE_REMOVAL_INVALID", "Structural cut removal was empty");
	}
}

function rematerializeMemberships(
	organizations: StaticFabOrganizationState,
	ownership: RailModuleOwnershipIndex,
	sourceClaims: DirectOwnerClaims,
): ReadonlyMap<number, StaticFabOrganizationMembership> {
	const edgesByOwnerId = new Map<number, Map<string, DirectedRailEdge>>();
	const switchIdsByOwnerId = new Map<number, Set<number>>();
	for (const module of ownership.modules) {
		const ownerId = exactPriorDirectOwner(module, sourceClaims);
		if (ownerId === null) continue;
		const edges = edgesByOwnerId.get(ownerId) ?? new Map<string, DirectedRailEdge>();
		for (const edge of module.eraseEdges) {
			edges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		edgesByOwnerId.set(ownerId, edges);
		if (module.advancedSwitchId !== null) {
			const switchIds = switchIdsByOwnerId.get(ownerId) ?? new Set<number>();
			switchIds.add(module.advancedSwitchId);
			switchIdsByOwnerId.set(ownerId, switchIds);
		}
	}

	const memberships = new Map<number, StaticFabOrganizationMembership>();
	for (const record of organizations.records) {
		memberships.set(
			record.id,
			Object.freeze({
				railEdges: Object.freeze(
					[...(edgesByOwnerId.get(record.id)?.values() ?? [])].sort(compareDirectedRailEdges),
				),
				advancedSwitchIds: Object.freeze(
					[...(switchIdsByOwnerId.get(record.id) ?? [])].sort((left, right) => left - right),
				),
				equipmentGroupIds: record.membership.equipmentGroupIds,
			}),
		);
	}
	return memberships;
}

function buildDirectOwnerClaims(organizations: StaticFabOrganizationState): DirectOwnerClaims {
	const ownerIdsByEdgeKey = new Map<string, Set<number>>();
	const ownerIdsBySwitchId = new Map<number, Set<number>>();
	for (const record of organizations.records) {
		for (const edge of record.membership.railEdges) {
			appendOwner(ownerIdsByEdgeKey, staticFabOrganizationEdgeKey(edge), record.id);
		}
		for (const switchId of record.membership.advancedSwitchIds) {
			appendOwner(ownerIdsBySwitchId, switchId, record.id);
		}
	}
	return Object.freeze({ ownerIdsByEdgeKey, ownerIdsBySwitchId });
}

function exactPriorDirectOwner(
	module: RailModuleOwnership,
	claims: DirectOwnerClaims,
): number | null {
	const observations: ReadonlySet<number>[] = [];
	for (const edge of module.eraseEdges) {
		const key = staticFabOrganizationEdgeKey(edge);
		observations.push(claims.ownerIdsByEdgeKey.get(key) ?? EMPTY_OWNER_IDS);
	}
	if (module.advancedSwitchId !== null) {
		observations.push(claims.ownerIdsBySwitchId.get(module.advancedSwitchId) ?? EMPTY_OWNER_IDS);
	}
	const review = reviewStaticFabSemanticBankDetachPostCutOwner(observations);
	if (review.issueCode) {
		throw new ProspectiveFailure(
			review.issueCode,
			`Evaluated module ${module.key} ${review.reason}`,
		);
	}
	return review.ownerId;
}

export function reviewStaticFabSemanticBankDetachPostCutOwner(
	ownerIdsBySource: readonly ReadonlySet<number>[],
): StaticFabSemanticBankDetachPostCutOwnerReview {
	let resolved: number | null | undefined;
	for (const ownerIds of ownerIdsBySource) {
		if (ownerIds.size > 1) {
			return postCutOwnerReview(
				"AMBIGUOUS",
				null,
				"AMBIGUOUS_POST_CUT_OWNERSHIP",
				"contains source content with multiple prior direct owners",
			);
		}
		const ownerId = ownerIds.size === 1 ? ([...ownerIds][0] as number) : null;
		if (resolved === undefined) {
			resolved = ownerId;
			continue;
		}
		if (resolved !== ownerId) {
			return postCutOwnerReview(
				"AMBIGUOUS",
				null,
				"AMBIGUOUS_POST_CUT_OWNERSHIP",
				"merges different prior direct owners or owned and unowned content",
			);
		}
	}
	if (resolved === undefined) {
		return postCutOwnerReview(
			"AMBIGUOUS",
			null,
			"AMBIGUOUS_POST_CUT_OWNERSHIP",
			"has no ownership-bearing source content",
		);
	}
	return resolved === null
		? postCutOwnerReview("WHOLLY_UNOWNED", null, null, "is wholly unowned")
		: postCutOwnerReview("EXACT_DIRECT_OWNER", resolved, null, "has one exact prior direct owner");
}

function postCutOwnerReview(
	status: StaticFabSemanticBankDetachPostCutOwnerReview["status"],
	ownerId: number | null,
	issueCode: StaticFabSemanticBankDetachPostCutOwnerReview["issueCode"],
	reason: string,
): StaticFabSemanticBankDetachPostCutOwnerReview {
	return Object.freeze({
		status,
		ownerId,
		issueCode,
		authority: "NO_MUTATION_AUTHORITY",
		reason,
	});
}

function buildEvaluatedOrganizations(
	organizations: StaticFabOrganizationState,
	memberships: ReadonlyMap<number, StaticFabOrganizationMembership>,
	targetOrganizationId: number,
	parentFabOrganizationId: number,
): StaticFabOrganizationState {
	return copyStaticFabOrganizationState({
		nextOrganizationId: organizations.nextOrganizationId,
		records: organizations.records.map((record) =>
			copyStaticFabOrganizationRecord({
				...record,
				parentOrganizationIds:
					record.id === targetOrganizationId
						? staticFabOrganizationParentIds(record).filter((id) => id !== parentFabOrganizationId)
						: staticFabOrganizationParentIds(record),
				membership: requireMembership(memberships, record.id),
			}),
		),
	});
}

function evaluateTopology(map: TileMap, layout: CompiledPhysicalLayout): EvaluatedTopology {
	const authored = analyzeRailNetwork(map);
	const authoredComponents = buildAuthoredComponents(map);
	const physical = analyzePhysicalPathTopology(layout.paths);
	const physicalComponents = buildPhysicalComponents(layout.paths, authoredComponents);
	const authoredClosed = authoredComponentsClosed(authored);
	const physicalClosed =
		physical.paths === 0
			? physicalComponents.componentCount === 0 && physical.strongComponents === 0
			: layout.valid &&
				physical.invalidPaths === 0 &&
				physical.openPaths === 0 &&
				layout.diagnostics.length === 0 &&
				layout.terminals.length === 0 &&
				layout.clearance.issues.count === 0 &&
				physicalComponents.componentCount === physical.strongComponents;
	const evidence = Object.freeze({
		authoredCellCount: authored.cells,
		authoredDirectedEdgeCount: authored.edges,
		authoredComponentCount: authored.components,
		authoredStrongComponentCount: authored.strongComponents,
		authoredOpenTerminalCount: authored.openEnds,
		authoredUnsafeJunctionCount: authored.unsafeJunctions,
		authoredComponentsClosed: authoredClosed,
		physicalPathCount: physical.paths,
		physicalComponentCount: physicalComponents.componentCount,
		physicalStrongComponentCount: physical.strongComponents,
		physicalOpenPathCount: physical.openPaths,
		physicalInvalidPathCount: physical.invalidPaths,
		physicalDiagnosticCount: layout.diagnostics.length,
		physicalTerminalCount: layout.terminals.length,
		physicalClearanceIssueCount: layout.clearance.issues.count,
		physicalComponentsClosed: physicalClosed,
		authoredPhysicalComponentMappingExact:
			physicalComponents.mappingExact &&
			authored.components === physicalComponents.componentCount &&
			[...physicalComponents.countsByAuthoredComponent.values()].every((count) => count === 1),
	}) satisfies StaticFabSemanticBankDetachTopologyEvidence;
	return Object.freeze({ evidence, authoredComponents, physicalComponents });
}

function regionEvidence(
	membership: StaticFabOrganizationMembership,
	ownership: RailModuleOwnershipIndex,
	lookup: ModuleLookup,
	authored: AuthoredComponents,
	physical: PhysicalComponents,
	modulesByComponent: ReadonlyMap<number, ReadonlySet<number>>,
): StaticFabSemanticBankDetachRegionEvidence {
	const moduleIndices = exactModuleIndicesForMembership(ownership, lookup, membership);
	const componentIds = new Set<number>();
	for (const moduleIndex of moduleIndices) {
		const module = ownership.modules[moduleIndex] as RailModuleOwnership;
		const componentId = moduleAuthoredComponent(module, authored);
		componentIds.add(componentId);
	}
	const componentModuleIndices = new Set<number>();
	for (const componentId of componentIds) {
		for (const moduleIndex of modulesByComponent.get(componentId) ?? EMPTY_NUMBERS) {
			componentModuleIndices.add(moduleIndex);
		}
	}
	const completeModuleCoverage = setEquals(moduleIndices, componentModuleIndices);
	let physicalComponentCount = 0;
	for (const componentId of componentIds) {
		physicalComponentCount += physical.countsByAuthoredComponent.get(componentId) ?? 0;
	}
	const authoredComponentCount = componentIds.size;
	const closed =
		authoredComponentCount === 1 &&
		physicalComponentCount === 1 &&
		completeModuleCoverage &&
		physical.mappingExact;
	return Object.freeze({
		authoredComponentCount,
		authoredStrongComponentCount: authoredComponentCount,
		physicalComponentCount,
		physicalStrongComponentCount: physicalComponentCount,
		completeModuleCoverage,
		closed,
	});
}

function exactModuleIndicesForMembership(
	ownership: RailModuleOwnershipIndex,
	lookup: ModuleLookup,
	membership: StaticFabOrganizationMembership,
): ReadonlySet<number> {
	const edgeKeys = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const switchIds = new Set(membership.advancedSwitchIds);
	const indices = new Set<number>();
	for (const edgeKey of edgeKeys) {
		for (const moduleIndex of lookup.moduleIndicesByEdgeKey.get(edgeKey) ?? []) {
			indices.add(moduleIndex);
		}
	}
	for (const switchId of switchIds) {
		for (const moduleIndex of lookup.moduleIndicesBySwitchId.get(switchId) ?? []) {
			indices.add(moduleIndex);
		}
	}
	const resolvedEdges = new Set<string>();
	const resolvedSwitches = new Set<number>();
	for (const moduleIndex of indices) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		if (
			module.eraseEdges.some((edge) => !edgeKeys.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && !switchIds.has(module.advancedSwitchId))
		) {
			throw new ProspectiveFailure(
				"MEMBERSHIP_REMATERIALIZATION_FAILED",
				`Evaluated membership only partially owns module ${module.key}`,
			);
		}
		for (const edge of module.eraseEdges) {
			resolvedEdges.add(staticFabOrganizationEdgeKey(edge));
		}
		if (module.advancedSwitchId !== null) resolvedSwitches.add(module.advancedSwitchId);
	}
	if (!setEquals(edgeKeys, resolvedEdges) || !setEquals(switchIds, resolvedSwitches)) {
		throw new ProspectiveFailure(
			"MEMBERSHIP_REMATERIALIZATION_FAILED",
			"Evaluated membership is not an exact whole-module union",
		);
	}
	return indices;
}

function buildModuleLookup(ownership: RailModuleOwnershipIndex): ModuleLookup {
	const moduleIndicesByEdgeKey = new Map<string, number[]>();
	const moduleIndicesBySwitchId = new Map<number, number[]>();
	for (let index = 0; index < ownership.modules.length; index++) {
		const module = ownership.modules[index] as RailModuleOwnership;
		for (const edge of module.eraseEdges) {
			appendNumber(moduleIndicesByEdgeKey, staticFabOrganizationEdgeKey(edge), index);
		}
		if (module.advancedSwitchId !== null) {
			appendNumber(moduleIndicesBySwitchId, module.advancedSwitchId, index);
		}
	}
	return Object.freeze({ moduleIndicesByEdgeKey, moduleIndicesBySwitchId });
}

function buildAuthoredComponents(map: TileMap): AuthoredComponents {
	const rails = new Map<string, Readonly<{ cell: Cell; mask: number }>>();
	map.forEachRail((x, y, rail) => {
		rails.set(
			cellKey(x, y),
			Object.freeze({ cell: Object.freeze({ x, y }), mask: rail.incoming | rail.outgoing }),
		);
	});
	const ordered = [...rails.values()].sort(
		(left, right) => left.cell.y - right.cell.y || left.cell.x - right.cell.x,
	);
	const componentByCellKey = new Map<string, number>();
	let componentCount = 0;
	for (const row of ordered) {
		const startKey = cellKey(row.cell.x, row.cell.y);
		if (componentByCellKey.has(startKey)) continue;
		const componentId = componentCount++;
		const pending = [row.cell];
		for (let offset = 0; offset < pending.length; offset++) {
			const current = pending[offset] as Cell;
			const key = cellKey(current.x, current.y);
			if (componentByCellKey.has(key)) continue;
			componentByCellKey.set(key, componentId);
			const currentRow = rails.get(key);
			if (!currentRow) continue;
			for (const direction of ALL_DIRECTIONS) {
				const next = moveCell(current, direction);
				const nextKey = cellKey(next.x, next.y);
				const nextRow = rails.get(nextKey);
				if (!nextRow) continue;
				if (
					(currentRow.mask & direction) !== 0 ||
					(nextRow.mask & oppositeDirection(direction)) !== 0
				) {
					pending.push(next);
				}
			}
		}
	}
	return Object.freeze({ componentByCellKey, componentCount });
}

function buildPhysicalComponents(
	paths: CompiledPhysicalPaths,
	authored: AuthoredComponents,
): PhysicalComponents {
	const adjacency = buildPhysicalPathAdjacency(paths);
	const parents = new Int32Array(paths.pathCount);
	parents.fill(-1);
	for (let index = 0; index < paths.pathCount; index++) {
		if ((paths.kinds[index] as number) !== PATH_KIND.INVALID) parents[index] = index;
	}
	for (let index = 0; index < paths.pathCount; index++) {
		if (parents[index] < 0) continue;
		for (
			let edgeIndex = adjacency.offsets[index] as number;
			edgeIndex < (adjacency.offsets[index + 1] as number);
			edgeIndex++
		) {
			const target = adjacency.targets[edgeIndex] as number;
			if (parents[target] >= 0) union(parents, index, target);
		}
	}
	const authoredIdsByRoot = new Map<number, Set<number>>();
	let mappingExact = true;
	for (let index = 0; index < paths.pathCount; index++) {
		if (parents[index] < 0) continue;
		const root = findRoot(parents, index);
		const cellOffset = index * 2;
		const authoredId = authored.componentByCellKey.get(
			cellKey(paths.cells[cellOffset] as number, paths.cells[cellOffset + 1] as number),
		);
		const ids = authoredIdsByRoot.get(root) ?? new Set<number>();
		if (authoredId !== undefined) ids.add(authoredId);
		else mappingExact = false;
		authoredIdsByRoot.set(root, ids);
	}
	const countsByAuthoredComponent = new Map<number, number>();
	for (const ids of authoredIdsByRoot.values()) {
		if (ids.size !== 1) {
			mappingExact = false;
			continue;
		}
		const authoredId = [...ids][0] as number;
		countsByAuthoredComponent.set(authoredId, (countsByAuthoredComponent.get(authoredId) ?? 0) + 1);
	}
	if (countsByAuthoredComponent.size !== authored.componentCount) mappingExact = false;
	return Object.freeze({
		componentCount: authoredIdsByRoot.size,
		countsByAuthoredComponent,
		mappingExact,
	});
}

function moduleIndicesByAuthoredComponent(
	ownership: RailModuleOwnershipIndex,
	authored: AuthoredComponents,
): ReadonlyMap<number, ReadonlySet<number>> {
	const mutable = new Map<number, Set<number>>();
	for (let index = 0; index < ownership.modules.length; index++) {
		const componentId = moduleAuthoredComponent(
			ownership.modules[index] as RailModuleOwnership,
			authored,
		);
		const rows = mutable.get(componentId) ?? new Set<number>();
		rows.add(index);
		mutable.set(componentId, rows);
	}
	return mutable;
}

function moduleAuthoredComponent(
	module: RailModuleOwnership,
	authored: AuthoredComponents,
): number {
	const ids = new Set<number>();
	for (const edge of module.eraseEdges) {
		for (const cell of [edge.from, edge.to]) {
			const id = authored.componentByCellKey.get(cellKey(cell.x, cell.y));
			if (id === undefined) {
				throw new ProspectiveFailure(
					"MEMBERSHIP_REMATERIALIZATION_FAILED",
					`Module ${module.key} references a missing authored cell`,
				);
			}
			ids.add(id);
		}
	}
	if (ids.size !== 1) {
		throw new ProspectiveFailure(
			"MEMBERSHIP_REMATERIALIZATION_FAILED",
			`Module ${module.key} crosses authored components`,
		);
	}
	return [...ids][0] as number;
}

function organizationSubtreeIds(
	organizations: StaticFabOrganizationState,
	organizationId: number,
): Set<number> {
	const descendants = resolveStaticFabOrganizationDescendantIds(organizations, organizationId);
	if (!descendants) {
		throw new ProspectiveFailure(
			"MEMBERSHIP_REMATERIALIZATION_FAILED",
			`Organization ${organizationId} descendants are unresolved`,
		);
	}
	return new Set([organizationId, ...descendants]);
}

function mergeMemberships(
	organizationIds: ReadonlySet<number>,
	memberships: ReadonlyMap<number, StaticFabOrganizationMembership>,
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	const equipmentGroupIds = new Set<number>();
	for (const organizationId of organizationIds) {
		const membership = requireMembership(memberships, organizationId);
		for (const edge of membership.railEdges) {
			edges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		for (const id of membership.advancedSwitchIds) switchIds.add(id);
		for (const id of membership.equipmentGroupIds) equipmentGroupIds.add(id);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function assertPortAttachments(
	map: TileMap,
	layout: CompiledPhysicalLayout,
	portEquipment: PortEquipmentState,
): void {
	const authoredError = portEquipmentLayoutError(map, portEquipment);
	if (authoredError) {
		throw new ProspectiveFailure(
			"PORT_ATTACHMENT_INVALID",
			`Port/equipment authored layout is invalid · ${authoredError}`,
		);
	}
	const sourceIndex = createPortAttachmentSourceIndex(layout);
	for (const port of portEquipment.ports) {
		const resolution = resolvePortAttachmentWithSourceIndex(layout, port, sourceIndex);
		if (!resolution.ok) {
			throw new ProspectiveFailure(
				"PORT_ATTACHMENT_INVALID",
				`PORT-${port.id} physical attachment is invalid · ${resolution.code}`,
			);
		}
	}
}

function assertOrganizationPortMemberships(
	organizations: StaticFabOrganizationState,
	memberships: ReadonlyMap<number, StaticFabOrganizationMembership>,
	portEquipment: PortEquipmentState,
): void {
	const groupsById = new Map(portEquipment.equipmentGroups.map((group) => [group.id, group]));
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	for (const record of organizations.records) {
		const membership = requireMembership(memberships, record.id);
		const selectedEdges = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
		const selectedSwitches = new Set(membership.advancedSwitchIds);
		for (const groupId of membership.equipmentGroupIds) {
			const group = groupsById.get(groupId);
			if (!group) {
				throw new ProspectiveFailure(
					"PORT_ATTACHMENT_INVALID",
					`Organization ${record.id} references missing equipment group ${groupId}`,
				);
			}
			for (const portId of group.portIds) {
				const port = portsById.get(portId);
				if (
					!port ||
					!staticFabOrganizationMembershipSupportsPortRoute(
						port.route,
						selectedEdges,
						selectedSwitches,
					)
				) {
					throw new ProspectiveFailure(
						"PORT_ATTACHMENT_INVALID",
						`Organization ${record.id} no longer fully supports PORT-${portId}`,
					);
				}
			}
		}
	}
}

function assertClosedTopology(
	evidence: StaticFabSemanticBankDetachTopologyEvidence,
	code: "SOURCE_TOPOLOGY_INVALID" | "EDGE_REMOVAL_INVALID",
	label: string,
): void {
	if (
		!evidence.authoredComponentsClosed ||
		!evidence.physicalComponentsClosed ||
		!evidence.authoredPhysicalComponentMappingExact
	) {
		throw new ProspectiveFailure(
			code,
			`${label} does not consist of matching closed authored and physical components`,
		);
	}
}

function authoredComponentsClosed(analysis: RailNetworkAnalysis): boolean {
	return analysis.cells === 0
		? analysis.components === 0 && analysis.strongComponents === 0
		: analysis.openEnds === 0 &&
				analysis.unsafeJunctions === 0 &&
				analysis.components === analysis.strongComponents;
}

function directedEdgeExists(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) return false;
	return (
		(map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0 &&
		(map.getRail(edge.to.x, edge.to.y).incoming & oppositeDirection(direction)) !== 0
	);
}

function collectDirectedEdges(map: TileMap): ReadonlyMap<string, DirectedRailEdge> {
	const edges = new Map<string, DirectedRailEdge>();
	map.forEachRail((x, y, rail) => {
		const from = Object.freeze({ x, y });
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) === 0) continue;
			const edge = Object.freeze({
				from,
				to: Object.freeze(moveCell(from, direction)),
			});
			edges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
	});
	if (edges.size !== map.edgeCount) {
		throw new ProspectiveFailure(
			"CUT_EDGE_RESOLUTION_FAILED",
			"Current authored directed-edge inventory does not match the TileMap count",
		);
	}
	return edges;
}

export function staticFabSemanticBankDetachPostCutModuleBudgetError(
	moduleCount: number,
): string | null {
	if (!Number.isSafeInteger(moduleCount) || moduleCount < 0) {
		return "Post-cut Rail module count must be a nonnegative safe integer";
	}
	if (moduleCount > STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_MAX_POST_CUT_MODULES) {
		return `Post-cut Rail module source가 ${STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_MAX_POST_CUT_MODULES.toLocaleString()}개 한도를 초과합니다`;
	}
	return null;
}

function rejected(
	snapshot: EvaluationSnapshot,
	portEquipment: PortEquipmentState,
	issueCode: StaticFabSemanticBankDetachProspectiveIssueCode,
	reason: string,
	structuralCutIssueCode: StaticFabSemanticHierarchyCutIssueCode | null,
): StaticFabSemanticBankDetachProspectiveReview {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_BANK_DETACH_PROSPECTIVE_VERSION,
		action: snapshot.action,
		targetRole: snapshot.targetRole,
		targetOrganizationId: snapshot.targetOrganizationId,
		parentFabOrganizationId: snapshot.parentFabOrganizationId,
		structuralCutFingerprint: snapshot.structuralCutFingerprint,
		structuralCorridorCount: snapshot.structuralCorridorCount,
		removedDirectedEdgeCount: snapshot.removedDirectedEdgeCount,
		sourceTopology: snapshot.sourceTopology,
		evaluatedTopology: snapshot.evaluatedTopology,
		selectedBankTopology: snapshot.selectedBankTopology,
		retainedFabTopology: snapshot.retainedFabTopology,
		authoredComponentDelta: snapshot.authoredComponentDelta,
		physicalComponentDelta: snapshot.physicalComponentDelta,
		sourcePortCount: portEquipment.ports.length,
		sourceEquipmentGroupCount: portEquipment.equipmentGroups.length,
		portAttachmentStatus: snapshot.portAttachmentStatus,
		cursorStatus: snapshot.cursorStatus,
		relationshipPurposeStatus: "UNRESOLVED",
		connectorProvenanceStatus: "UNRESOLVED",
		mutationPlanStatus: "UNREVIEWED",
		authority: "NO_MUTATION_AUTHORITY",
		evidenceStatus:
			snapshot.evaluatedTopology === null ? "NOT_EVALUATED" : "PROSPECTIVE_BANK_DETACH_ONLY",
		prospectiveDetachProved: false,
		structuralCutIssueCode,
		issueCode,
		reason,
	}) satisfies StaticFabSemanticBankDetachProspectiveReview;
}

function membershipItemCount(membership: StaticFabOrganizationMembership): number {
	return (
		membership.railEdges.length +
		membership.advancedSwitchIds.length +
		membership.equipmentGroupIds.length
	);
}

function requireMembership(
	memberships: ReadonlyMap<number, StaticFabOrganizationMembership>,
	organizationId: number,
): StaticFabOrganizationMembership {
	const membership = memberships.get(organizationId);
	if (!membership) {
		throw new ProspectiveFailure(
			"MEMBERSHIP_REMATERIALIZATION_FAILED",
			`Organization ${organizationId} has no evaluated membership`,
		);
	}
	return membership;
}

function requireNumber(value: number | null, label: string): number {
	if (value === null) {
		throw new ProspectiveFailure("STRUCTURAL_CUT_REJECTED", `Structural cut has no ${label}`);
	}
	return value;
}

function appendNumber<Key>(index: Map<Key, number[]>, key: Key, value: number): void {
	const rows = index.get(key);
	if (rows) rows.push(value);
	else index.set(key, [value]);
}

function appendOwner<Key>(index: Map<Key, Set<number>>, key: Key, ownerId: number): void {
	const owners = index.get(key) ?? new Set<number>();
	owners.add(ownerId);
	index.set(key, owners);
}

function setEquals<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function union(parents: Int32Array, left: number, right: number): void {
	const leftRoot = findRoot(parents, left);
	const rightRoot = findRoot(parents, right);
	if (leftRoot === rightRoot) return;
	if (leftRoot < rightRoot) parents[rightRoot] = leftRoot;
	else parents[leftRoot] = rightRoot;
}

function findRoot(parents: Int32Array, index: number): number {
	let root = index;
	while ((parents[root] as number) !== root) root = parents[root] as number;
	let cursor = index;
	while ((parents[cursor] as number) !== cursor) {
		const next = parents[cursor] as number;
		parents[cursor] = root;
		cursor = next;
	}
	return root;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

class ProspectiveFailure extends Error {
	readonly code: StaticFabSemanticBankDetachProspectiveIssueCode;

	constructor(code: StaticFabSemanticBankDetachProspectiveIssueCode, message: string) {
		super(message);
		this.code = code;
	}
}
