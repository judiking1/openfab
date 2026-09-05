import type { PortEquipmentState } from "./EquipmentGroup";
import { portEquipmentLayoutError } from "./PortEquipmentLayoutValidator";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
} from "./RailModuleOwnership";
import { type Direction, moveCell } from "./railShape";
import {
	resolveStaticFabOrganizationCoverage,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationStateError,
	staticFabOrganizationStateShapeError,
} from "./StaticFabOrganization";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS,
	type StaticFabSemanticHierarchyRecoveryAction,
	type StaticFabSemanticHierarchyRecoveryIntent,
	type StaticFabSemanticHierarchyRecoveryReview,
	type StaticFabSemanticHierarchyRecoveryTargetRole,
	staticFabSemanticHierarchyRecoveryIntentError,
} from "./StaticFabSemanticHierarchyRecovery";
import { type Cell, cellKey, type TileMap } from "./TileMap";

export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_VERSION = 1 as const;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RAIL_CELLS = 100_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_DIRECTED_EDGES = 200_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_ADVANCED_SWITCHES = 16_384;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_PORTS = 100_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_EQUIPMENT_GROUPS = 100_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MEMBERSHIP_ITEMS = 500_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MODULES = 100_000;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RAW_PARENT_COMPONENT_CANDIDATES = 64;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_MODULES = 4_096;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_EDGES = 8_192;
export const STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_CONTACTS = 4_096;

export type StaticFabSemanticHierarchyBoundaryIssueCode =
	| "INVALID_INTENT"
	| "NON_ACCEPTED_REVIEW"
	| "REVIEW_INTENT_MISMATCH"
	| "STALE_REVIEW"
	| "INVALID_SOURCE"
	| "STALE_SOURCE"
	| "SOURCE_BUDGET_EXCEEDED"
	| "RESPONSE_BUDGET_EXCEEDED"
	| "UNSUPPORTED_TARGET"
	| "PARTIAL_MODULE_MEMBERSHIP"
	| "SHARED_TARGET_MODULE_OWNERSHIP"
	| "SHARED_TARGET_PARENT_MODULE"
	| "CROSS_OWNER_MODULE"
	| "CANDIDATE_COMPONENT_ADVANCED_SWITCH"
	| "CANDIDATE_COMPONENT_PORT_DEPENDENCY"
	| "NO_RAW_SHARED_VERTEX_CONTACT";

export interface StaticFabSemanticHierarchyRawSharedVertexContact {
	readonly targetModuleIndex: number;
	readonly targetModuleKey: string;
	readonly parentModuleIndex: number;
	readonly parentModuleKey: string;
	readonly cell: Readonly<Cell>;
}

export interface StaticFabSemanticHierarchyRawParentComponentCandidate {
	readonly ordinal: number;
	readonly parentModuleIndices: readonly number[];
	readonly parentModuleKeys: readonly string[];
	readonly directedEdgeCount: number;
	readonly rawSharedVertexContacts: readonly StaticFabSemanticHierarchyRawSharedVertexContact[];
}

export interface StaticFabSemanticHierarchyBoundaryInventory {
	readonly version: typeof STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_VERSION;
	readonly action: StaticFabSemanticHierarchyRecoveryAction | null;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	readonly targetOrganizationId: number | null;
	readonly parentFabOrganizationId: number | null;
	readonly targetEffectiveModuleIndices: readonly number[];
	readonly targetEffectiveModuleKeys: readonly string[];
	readonly parentDirectModuleIndices: readonly number[];
	readonly parentDirectModuleKeys: readonly string[];
	readonly incidentParentModuleIndices: readonly number[];
	readonly incidentParentModuleKeys: readonly string[];
	readonly rawParentComponentCandidates: readonly StaticFabSemanticHierarchyRawParentComponentCandidate[];
	readonly rawSharedVertexContactCount: number;
	readonly candidateComponentDirectedEdgeCount: number;
	readonly sourceModuleCount: number;
	readonly sourceOrganizationCount: number;
	readonly authority: "NO_MUTATION_AUTHORITY";
	readonly evidenceStatus: "RAW_SHARED_VERTEX_COMPONENTS_ONLY" | "NOT_EVALUATED";
	readonly cutSetStatus: "CUT_SET_UNRESOLVED" | "NOT_EVALUATED";
	readonly unreviewedConditions: readonly StaticFabSemanticHierarchyBoundaryUnreviewedCondition[];
	readonly candidateInventoryBuilt: boolean;
	readonly issueCode: StaticFabSemanticHierarchyBoundaryIssueCode | null;
	readonly reason: string;
}

export type StaticFabSemanticHierarchyBoundaryUnreviewedCondition =
	| "RELATIONSHIP_PURPOSE_UNRESOLVED"
	| "CONNECTOR_PROVENANCE_UNRESOLVED"
	| "OPPOSITE_ENDPOINT_UNRESOLVED"
	| "ADJACENT_FOREIGN_OR_UNOWNED_INCIDENTS_UNREVIEWED"
	| "BRANCH_DEGREE_UNREVIEWED"
	| "DIRECTED_SEAM_UNREVIEWED"
	| "COMPLETE_CUT_SET_UNRESOLVED";

interface ExactMembershipIndex {
	readonly ownerIdsByModuleIndex: ReadonlyMap<number, readonly number[]>;
}

interface WholeModuleLookup {
	readonly moduleIndicesByEdgeKey: ReadonlyMap<string, readonly number[]>;
	readonly moduleIndicesBySwitchId: ReadonlyMap<number, readonly number[]>;
}

interface DiagnosticIntent {
	readonly action: StaticFabSemanticHierarchyRecoveryAction | null;
	readonly targetRole: StaticFabSemanticHierarchyRecoveryTargetRole | null;
	readonly targetOrganizationId: number | null;
	readonly expectedParentOrganizationId: number | null;
}

interface InventoryScope {
	readonly intent: StaticFabSemanticHierarchyRecoveryIntent;
	readonly parentFabOrganizationId: number;
	readonly targetEffectiveModuleIndices: readonly number[];
	readonly targetEffectiveModuleKeys: readonly string[];
	readonly parentDirectModuleIndices: readonly number[];
	readonly parentDirectModuleKeys: readonly string[];
	readonly incidentParentModuleIndices: readonly number[];
	readonly incidentParentModuleKeys: readonly string[];
	readonly rawSharedVertexContacts: readonly StaticFabSemanticHierarchyRawSharedVertexContact[];
	readonly rawParentComponentCandidates: readonly StaticFabSemanticHierarchyRawParentComponentCandidate[];
	readonly candidateComponentDirectedEdgeCount: number;
	readonly sourceModuleCount: number;
	readonly sourceOrganizationCount: number;
}

const EMPTY_NUMBERS = Object.freeze([]) as readonly number[];
const EMPTY_STRINGS = Object.freeze([]) as readonly string[];
const EMPTY_RAW_PARENT_COMPONENTS = Object.freeze(
	[],
) as readonly StaticFabSemanticHierarchyRawParentComponentCandidate[];
const EMPTY_UNREVIEWED = Object.freeze(
	[],
) as readonly StaticFabSemanticHierarchyBoundaryUnreviewedCondition[];
const RAW_COMPONENT_UNREVIEWED = Object.freeze([
	"RELATIONSHIP_PURPOSE_UNRESOLVED",
	"CONNECTOR_PROVENANCE_UNRESOLVED",
	"OPPOSITE_ENDPOINT_UNRESOLVED",
	"ADJACENT_FOREIGN_OR_UNOWNED_INCIDENTS_UNREVIEWED",
	"BRANCH_DEGREE_UNREVIEWED",
	"DIRECTED_SEAM_UNREVIEWED",
	"COMPLETE_CUT_SET_UNRESOLVED",
] as const) satisfies readonly StaticFabSemanticHierarchyBoundaryUnreviewedCondition[];

/**
 * Reconstruct a current-source Bank/Fab contact inventory from persisted DAG and whole-module
 * ownership only. Even a successful inventory deliberately leaves complete-cut uniqueness
 * unresolved and grants no mutation, Worker, history, or UI Apply authority.
 */
export function inventoryStaticFabSemanticHierarchyBoundary(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	intentValue: unknown,
	reviewValue: unknown,
): StaticFabSemanticHierarchyBoundaryInventory {
	const diagnosticIntent = readDiagnosticIntent(intentValue);
	const intentError = staticFabSemanticHierarchyRecoveryIntentError(intentValue);
	if (intentError) {
		return rejectedInventory(diagnosticIntent, "INVALID_INTENT", intentError);
	}
	const intent = intentValue as StaticFabSemanticHierarchyRecoveryIntent;
	if (!isAcceptedReview(reviewValue)) {
		return rejectedInventory(
			intent,
			"NON_ACCEPTED_REVIEW",
			"Bank/Fab boundary inventory에는 accepted current-source hierarchy review가 필요합니다",
		);
	}
	if (!reviewIntentMatches(reviewValue, intent)) {
		return rejectedInventory(
			intent,
			"REVIEW_INTENT_MISMATCH",
			"Hierarchy review와 boundary intent의 action, role, target 또는 expected parent가 다릅니다",
		);
	}

	const sourceBudgetError = staticFabSemanticHierarchyBoundarySourceBudgetError(
		map,
		portEquipment,
		organizations,
	);
	if (sourceBudgetError) {
		return rejectedInventory(intent, "SOURCE_BUDGET_EXCEEDED", sourceBudgetError);
	}
	const sourceRevision = map.getRevision();
	const sourceMutationGeneration = map.getMutationGeneration();

	try {
		const shapeError = staticFabOrganizationStateShapeError(organizations);
		if (shapeError) {
			return rejectedInventory(
				intent,
				"INVALID_SOURCE",
				`정적 FAB 조직 source가 유효하지 않습니다 · ${shapeError}`,
			);
		}
		const portError = portEquipmentLayoutError(map, portEquipment);
		if (portError) {
			return rejectedInventory(
				intent,
				"INVALID_SOURCE",
				`포트·장비 source가 유효하지 않습니다 · ${portError}`,
			);
		}
		const organizationError = staticFabOrganizationStateError(map, portEquipment, organizations);
		if (organizationError) {
			return rejectedInventory(
				intent,
				"INVALID_SOURCE",
				`정적 FAB 조직 source가 현재 Rail/Port source와 일치하지 않습니다 · ${organizationError}`,
			);
		}
	} catch (error) {
		return rejectedInventory(
			intent,
			"INVALID_SOURCE",
			`Bank/Fab boundary source를 읽을 수 없습니다 · ${errorMessage(error)}`,
		);
	}

	const currentReview = reviewStaticFabSemanticHierarchyRecovery(organizations, intent);
	if (!currentReview.accepted || !reviewSourceBindingMatches(reviewValue, currentReview)) {
		return rejectedInventory(
			intent,
			"STALE_REVIEW",
			"Hierarchy review가 현재 organization source와 더 이상 일치하지 않습니다",
		);
	}
	if (
		intent.targetRole !== "BAY_BANK" ||
		currentReview.attachmentState !== "ATTACHED_TO_ROOT_FAB" ||
		currentReview.parentFabOrganizationId === null
	) {
		return rejectedInventory(
			intent,
			"UNSUPPORTED_TARGET",
			"현재 boundary inventory는 root Fab에 attached된 semantic Bay Bank만 처리합니다",
		);
	}

	try {
		const ownership = buildRailModuleOwnershipIndex(map);
		if (ownership.modules.length > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MODULES) {
			return rejectedInventory(
				intent,
				"SOURCE_BUDGET_EXCEEDED",
				`Rail module source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MODULES.toLocaleString()}개 한도를 초과합니다`,
			);
		}
		const wholeModuleLookup = buildWholeModuleLookup(ownership);
		const exactMembership = buildExactMembershipIndex(ownership, wholeModuleLookup, organizations);

		const targetCoverage = resolveStaticFabOrganizationCoverage(
			organizations,
			intent.targetOrganizationId,
		);
		const parent = organizations.records.find(
			(record) => record.id === currentReview.parentFabOrganizationId,
		);
		const descendantIds = resolveStaticFabOrganizationDescendantIds(
			organizations,
			intent.targetOrganizationId,
		);
		if (!targetCoverage || !parent || !descendantIds) {
			return rejectedInventory(
				intent,
				"STALE_REVIEW",
				"검토한 Bank subtree 또는 parent Fab을 현재 source에서 다시 찾을 수 없습니다",
			);
		}

		const targetEffectiveModuleIndices = exactModuleIndicesForMembership(
			ownership,
			wholeModuleLookup,
			targetCoverage.effective,
			"선택 Bank effective membership",
		);
		const parentDirectModuleIndices = exactModuleIndicesForMembership(
			ownership,
			wholeModuleLookup,
			parent.membership,
			"parent Fab direct membership",
		);
		if (targetEffectiveModuleIndices.length === 0 || parentDirectModuleIndices.length === 0) {
			return rejectedInventory(
				intent,
				"NO_RAW_SHARED_VERTEX_CONTACT",
				"선택 Bank effective module 또는 parent Fab direct module이 비어 있습니다",
			);
		}
		if (
			targetEffectiveModuleIndices.length + parentDirectModuleIndices.length >
			STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_MODULES
		) {
			return rejectedInventory(
				intent,
				"RESPONSE_BUDGET_EXCEEDED",
				`Boundary module inventory가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_MODULES.toLocaleString()}개 응답 한도를 초과합니다`,
			);
		}

		const subtreeIds = new Set([intent.targetOrganizationId, ...descendantIds]);
		const targetModuleSet = new Set(targetEffectiveModuleIndices);
		for (const moduleIndex of parentDirectModuleIndices) {
			if (targetModuleSet.has(moduleIndex)) {
				return rejectedInventory(
					intent,
					"SHARED_TARGET_PARENT_MODULE",
					`선택 Bank와 parent Fab이 module ${ownership.modules[moduleIndex]?.key ?? moduleIndex}을 함께 소유합니다`,
				);
			}
		}
		const targetOwnershipIssue = targetModuleOwnershipIssue(
			targetEffectiveModuleIndices,
			subtreeIds,
			exactMembership.ownerIdsByModuleIndex,
			ownership,
		);
		if (targetOwnershipIssue) {
			return rejectedInventory(intent, targetOwnershipIssue.code, targetOwnershipIssue.reason);
		}
		const parentOwnershipIssue = parentModuleOwnershipIssue(
			parentDirectModuleIndices,
			parent.id,
			exactMembership.ownerIdsByModuleIndex,
			ownership,
		);
		if (parentOwnershipIssue) {
			return rejectedInventory(intent, parentOwnershipIssue.code, parentOwnershipIssue.reason);
		}
		const rawSharedVertexContacts = collectRawSharedVertexContacts(
			ownership,
			targetEffectiveModuleIndices,
			parentDirectModuleIndices,
		);
		if (rawSharedVertexContacts.length === 0) {
			return rejectedInventory(
				intent,
				"NO_RAW_SHARED_VERTEX_CONTACT",
				"선택 Bank module과 parent Fab direct module 사이에 raw shared-vertex contact가 없습니다",
			);
		}
		if (rawSharedVertexContacts.length > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_CONTACTS) {
			return rejectedInventory(
				intent,
				"RESPONSE_BUDGET_EXCEEDED",
				`Raw shared-vertex contact가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_CONTACTS.toLocaleString()}개 응답 한도를 초과합니다`,
			);
		}

		const rawParentComponents = collectRawParentComponentCandidates(
			ownership,
			parentDirectModuleIndices,
			rawSharedVertexContacts,
		);
		const responseBudgetError = rawComponentResponseBudgetError(
			targetEffectiveModuleIndices,
			parentDirectModuleIndices,
			rawParentComponents,
		);
		if (responseBudgetError) {
			return rejectedInventory(intent, "RESPONSE_BUDGET_EXCEEDED", responseBudgetError);
		}
		const dependency = rawComponentPortEquipmentDependency(
			rawParentComponents,
			ownership,
			portEquipment,
		);
		if (dependency) {
			return rejectedInventory(intent, dependency.code, dependency.reason);
		}
		if (
			map.getRevision() !== sourceRevision ||
			map.getMutationGeneration() !== sourceMutationGeneration
		) {
			return rejectedInventory(
				intent,
				"STALE_SOURCE",
				"Boundary inventory 중 authored Rail source가 변경되었습니다",
			);
		}

		const incidentParentModuleIndices = Object.freeze(
			[...new Set(rawSharedVertexContacts.map((contact) => contact.parentModuleIndex))].sort(
				(left, right) => left - right,
			),
		);
		const candidateComponentDirectedEdgeCount = uniqueModuleDirectedEdgeCount(
			ownership,
			rawParentComponents.flatMap((candidate) => candidate.parentModuleIndices),
		);
		return acceptedInventory({
			intent,
			parentFabOrganizationId: parent.id,
			targetEffectiveModuleIndices,
			targetEffectiveModuleKeys: moduleKeys(ownership, targetEffectiveModuleIndices),
			parentDirectModuleIndices,
			parentDirectModuleKeys: moduleKeys(ownership, parentDirectModuleIndices),
			incidentParentModuleIndices,
			incidentParentModuleKeys: moduleKeys(ownership, incidentParentModuleIndices),
			rawSharedVertexContacts,
			rawParentComponentCandidates: rawParentComponents,
			candidateComponentDirectedEdgeCount,
			sourceModuleCount: ownership.modules.length,
			sourceOrganizationCount: organizations.records.length,
		});
	} catch (error) {
		if (error instanceof BoundaryFailure) {
			return rejectedInventory(intent, error.code, error.message);
		}
		return rejectedInventory(
			intent,
			"INVALID_SOURCE",
			`Bank/Fab raw shared-vertex component 후보를 복원할 수 없습니다 · ${errorMessage(error)}`,
		);
	}
}

export function staticFabSemanticHierarchyBoundarySourceBudgetError(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): string | null {
	try {
		if (!Array.isArray(organizations.records))
			return "Organization records source가 배열이 아닙니다";
		if (!Array.isArray(portEquipment.ports)) return "Port source가 배열이 아닙니다";
		if (!Array.isArray(portEquipment.equipmentGroups)) {
			return "Equipment group source가 배열이 아닙니다";
		}
		if (organizations.records.length > STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS) {
			return `Organization source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS.toLocaleString()}개 한도를 초과합니다`;
		}
		if (map.size > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RAIL_CELLS) {
			return `Rail cell source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RAIL_CELLS.toLocaleString()}개 한도를 초과합니다`;
		}
		if (map.edgeCount > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_DIRECTED_EDGES) {
			return `Directed edge source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_DIRECTED_EDGES.toLocaleString()}개 한도를 초과합니다`;
		}
		if (map.advancedSwitchCount > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_ADVANCED_SWITCHES) {
			return `Advanced switch source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_ADVANCED_SWITCHES.toLocaleString()}개 한도를 초과합니다`;
		}
		if (portEquipment.ports.length > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_PORTS) {
			return `Port source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_PORTS.toLocaleString()}개 한도를 초과합니다`;
		}
		if (
			portEquipment.equipmentGroups.length >
			STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_EQUIPMENT_GROUPS
		) {
			return `Equipment group source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_EQUIPMENT_GROUPS.toLocaleString()}개 한도를 초과합니다`;
		}
		let membershipItems = 0;
		for (const record of organizations.records) {
			const membership = record?.membership;
			if (!membership) return `조직 ${record?.id ?? "unknown"} membership을 읽을 수 없습니다`;
			for (const values of [
				membership.railEdges,
				membership.advancedSwitchIds,
				membership.equipmentGroupIds,
			]) {
				if (!Array.isArray(values)) return "Organization membership source가 배열이 아닙니다";
				membershipItems += values.length;
				if (membershipItems > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MEMBERSHIP_ITEMS) {
					return `Organization membership source가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_MEMBERSHIP_ITEMS.toLocaleString()}개 item 한도를 초과합니다`;
				}
			}
		}
		return null;
	} catch (error) {
		return `Boundary source budget을 계산할 수 없습니다 · ${errorMessage(error)}`;
	}
}

function buildExactMembershipIndex(
	ownership: RailModuleOwnershipIndex,
	lookup: WholeModuleLookup,
	organizations: StaticFabOrganizationState,
): ExactMembershipIndex {
	const ownerIdsByModuleIndex = new Map<number, number[]>();
	for (const record of organizations.records) {
		const indices = exactModuleIndicesForMembership(
			ownership,
			lookup,
			record.membership,
			`조직 '${record.name}' direct membership`,
		);
		for (const moduleIndex of indices) {
			const owners = ownerIdsByModuleIndex.get(moduleIndex);
			if (owners) owners.push(record.id);
			else ownerIdsByModuleIndex.set(moduleIndex, [record.id]);
		}
	}
	return Object.freeze({
		ownerIdsByModuleIndex: new Map(
			[...ownerIdsByModuleIndex].map(([index, ids]) => [
				index,
				Object.freeze(ids.sort((left, right) => left - right)),
			]),
		),
	});
}

function buildWholeModuleLookup(ownership: RailModuleOwnershipIndex): WholeModuleLookup {
	const moduleIndicesByEdgeKey = new Map<string, number[]>();
	const moduleIndicesBySwitchId = new Map<number, number[]>();
	for (let moduleIndex = 0; moduleIndex < ownership.modules.length; moduleIndex += 1) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) {
			appendIndex(moduleIndicesByEdgeKey, staticFabOrganizationEdgeKey(edge), moduleIndex);
		}
		if (module.advancedSwitchId !== null) {
			appendIndex(moduleIndicesBySwitchId, module.advancedSwitchId, moduleIndex);
		}
	}
	return Object.freeze({
		moduleIndicesByEdgeKey: freezeIndex(moduleIndicesByEdgeKey),
		moduleIndicesBySwitchId: freezeIndex(moduleIndicesBySwitchId),
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
	const touchedModuleIndices = new Set<number>();
	for (const edgeKey of edgeKeys) {
		for (const moduleIndex of lookup.moduleIndicesByEdgeKey.get(edgeKey) ?? []) {
			touchedModuleIndices.add(moduleIndex);
		}
	}
	for (const switchId of switchIds) {
		for (const moduleIndex of lookup.moduleIndicesBySwitchId.get(switchId) ?? []) {
			touchedModuleIndices.add(moduleIndex);
		}
	}
	const indices = [...touchedModuleIndices].sort((left, right) => left - right);
	for (const moduleIndex of indices) {
		const module = ownership.modules[moduleIndex] as RailModuleOwnership;
		if (
			module.eraseEdges.some((edge) => !edgeKeys.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && !switchIds.has(module.advancedSwitchId))
		) {
			throw new BoundaryFailure(
				"PARTIAL_MODULE_MEMBERSHIP",
				`${label}이 module ${module.key} 전체를 포함하지 않습니다`,
			);
		}
		for (const edge of module.eraseEdges) {
			resolvedEdgeKeys.add(staticFabOrganizationEdgeKey(edge));
		}
		if (module.advancedSwitchId !== null) resolvedSwitchIds.add(module.advancedSwitchId);
	}
	if (!setEquals(edgeKeys, resolvedEdgeKeys) || !setEquals(switchIds, resolvedSwitchIds)) {
		throw new BoundaryFailure(
			"PARTIAL_MODULE_MEMBERSHIP",
			`${label}을 exact whole-module union으로 복원할 수 없습니다`,
		);
	}
	return Object.freeze(indices);
}

function targetModuleOwnershipIssue(
	targetModuleIndices: readonly number[],
	subtreeIds: ReadonlySet<number>,
	ownerIdsByModuleIndex: ReadonlyMap<number, readonly number[]>,
	ownership: RailModuleOwnershipIndex,
): Readonly<{
	code: "SHARED_TARGET_MODULE_OWNERSHIP" | "CROSS_OWNER_MODULE";
	reason: string;
}> | null {
	for (const moduleIndex of targetModuleIndices) {
		const owners = ownerIdsByModuleIndex.get(moduleIndex) ?? EMPTY_NUMBERS;
		const inside = owners.filter((id) => subtreeIds.has(id));
		const outside = owners.filter((id) => !subtreeIds.has(id));
		const moduleKey = ownership.modules[moduleIndex]?.key ?? String(moduleIndex);
		if (outside.length > 0) {
			return Object.freeze({
				code: "CROSS_OWNER_MODULE",
				reason: `선택 Bank module ${moduleKey}을 subtree 밖 조직 ${outside.join(", ")}이 소유합니다`,
			});
		}
		if (inside.length !== 1) {
			return Object.freeze({
				code: "SHARED_TARGET_MODULE_OWNERSHIP",
				reason: `선택 Bank module ${moduleKey}의 direct semantic owner가 ${inside.length}개입니다`,
			});
		}
	}
	return null;
}

function parentModuleOwnershipIssue(
	parentModuleIndices: readonly number[],
	parentId: number,
	ownerIdsByModuleIndex: ReadonlyMap<number, readonly number[]>,
	ownership: RailModuleOwnershipIndex,
): Readonly<{ code: "CROSS_OWNER_MODULE"; reason: string }> | null {
	for (const moduleIndex of parentModuleIndices) {
		const owners = ownerIdsByModuleIndex.get(moduleIndex) ?? EMPTY_NUMBERS;
		if (owners.length !== 1 || owners[0] !== parentId) {
			return Object.freeze({
				code: "CROSS_OWNER_MODULE",
				reason: `parent Fab module ${ownership.modules[moduleIndex]?.key ?? moduleIndex}의 direct owner가 parent ${parentId} 하나가 아닙니다 · owners ${owners.join(", ") || "none"}`,
			});
		}
	}
	return null;
}

function collectRawSharedVertexContacts(
	ownership: RailModuleOwnershipIndex,
	targetModuleIndices: readonly number[],
	parentModuleIndices: readonly number[],
): readonly StaticFabSemanticHierarchyRawSharedVertexContact[] {
	const targetModulesByCell = moduleIndicesByCell(ownership, targetModuleIndices);
	const parentModulesByCell = moduleIndicesByCell(ownership, parentModuleIndices);
	const contacts: StaticFabSemanticHierarchyRawSharedVertexContact[] = [];
	for (const [key, targetIndices] of targetModulesByCell) {
		const parentIndices = parentModulesByCell.get(key);
		if (!parentIndices) continue;
		const cell = parseCellKey(key);
		for (const targetModuleIndex of targetIndices) {
			for (const parentModuleIndex of parentIndices) {
				contacts.push(
					Object.freeze({
						targetModuleIndex,
						targetModuleKey: ownership.modules[targetModuleIndex]?.key ?? String(targetModuleIndex),
						parentModuleIndex,
						parentModuleKey: ownership.modules[parentModuleIndex]?.key ?? String(parentModuleIndex),
						cell: Object.freeze(cell),
					}),
				);
				if (contacts.length > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_CONTACTS) {
					throw new BoundaryFailure(
						"RESPONSE_BUDGET_EXCEEDED",
						`Raw shared-vertex contact가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_CONTACTS.toLocaleString()}개 응답 한도를 초과합니다`,
					);
				}
			}
		}
	}
	contacts.sort(compareRawSharedVertexContacts);
	return Object.freeze(contacts);
}

function collectRawParentComponentCandidates(
	ownership: RailModuleOwnershipIndex,
	parentModuleIndices: readonly number[],
	contacts: readonly StaticFabSemanticHierarchyRawSharedVertexContact[],
): readonly StaticFabSemanticHierarchyRawParentComponentCandidate[] {
	const parentByCell = moduleIndicesByCell(ownership, parentModuleIndices);
	const neighbors = new Map<number, Set<number>>();
	for (const indices of parentByCell.values()) {
		for (const left of indices) {
			const targets = neighbors.get(left) ?? new Set<number>();
			for (const right of indices) if (right !== left) targets.add(right);
			neighbors.set(left, targets);
		}
	}
	const incident = [...new Set(contacts.map((contact) => contact.parentModuleIndex))].sort(
		(left, right) => left - right,
	);
	const visited = new Set<number>();
	const components: number[][] = [];
	for (const seed of incident) {
		if (visited.has(seed)) continue;
		const pending = [seed];
		const component: number[] = [];
		for (let offset = 0; offset < pending.length; offset += 1) {
			const moduleIndex = pending[offset] as number;
			if (visited.has(moduleIndex)) continue;
			visited.add(moduleIndex);
			component.push(moduleIndex);
			for (const neighbor of [...(neighbors.get(moduleIndex) ?? [])].sort(
				(left, right) => left - right,
			)) {
				if (!visited.has(neighbor)) pending.push(neighbor);
			}
		}
		component.sort((left, right) => left - right);
		components.push(component);
	}
	components.sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
	return Object.freeze(
		components.map((component, index) => {
			const componentSet = new Set(component);
			return Object.freeze({
				ordinal: index + 1,
				parentModuleIndices: Object.freeze(component),
				parentModuleKeys: Object.freeze(
					component.map(
						(moduleIndex) => ownership.modules[moduleIndex]?.key ?? String(moduleIndex),
					),
				),
				directedEdgeCount: uniqueModuleDirectedEdgeCount(ownership, component),
				rawSharedVertexContacts: Object.freeze(
					contacts.filter((contact) => componentSet.has(contact.parentModuleIndex)),
				),
			});
		}),
	);
}

function rawComponentResponseBudgetError(
	targetModuleIndices: readonly number[],
	parentModuleIndices: readonly number[],
	components: readonly StaticFabSemanticHierarchyRawParentComponentCandidate[],
): string | null {
	if (components.length === 0) return "Raw parent shared-vertex component 후보가 없습니다";
	if (
		components.length > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RAW_PARENT_COMPONENT_CANDIDATES
	) {
		return `Raw parent component 후보가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RAW_PARENT_COMPONENT_CANDIDATES}개 응답 한도를 초과합니다`;
	}
	if (
		targetModuleIndices.length + parentModuleIndices.length >
		STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_MODULES
	) {
		return `Boundary module inventory가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_MODULES.toLocaleString()}개 응답 한도를 초과합니다`;
	}
	const edgeCount = components.reduce((sum, component) => sum + component.directedEdgeCount, 0);
	if (edgeCount > STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_EDGES) {
		return `Boundary directed-edge inventory가 ${STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_MAX_RESPONSE_EDGES.toLocaleString()}개 응답 한도를 초과합니다`;
	}
	return null;
}

function rawComponentPortEquipmentDependency(
	components: readonly StaticFabSemanticHierarchyRawParentComponentCandidate[],
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
): Readonly<{
	code: "CANDIDATE_COMPONENT_ADVANCED_SWITCH" | "CANDIDATE_COMPONENT_PORT_DEPENDENCY";
	reason: string;
}> | null {
	const moduleIndices = new Set(components.flatMap((component) => component.parentModuleIndices));
	const edgeKeys = new Set<string>();
	const switchIds = new Set<number>();
	for (const moduleIndex of moduleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) edgeKeys.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	if (switchIds.size > 0) {
		return Object.freeze({
			code: "CANDIDATE_COMPONENT_ADVANCED_SWITCH",
			reason: `Raw parent component 후보가 advanced switch ${[...switchIds].sort((a, b) => a - b).join(", ")}을 포함합니다`,
		});
	}
	const dependentPortIds = portEquipment.ports
		.filter((port) => {
			if (port.route.kind === "ADVANCED_SWITCH_SEGMENT") {
				return switchIds.has(port.route.switchId);
			}
			const cell = { x: port.route.x, y: port.route.z };
			if (port.route.from !== 0) {
				const source = moveCell(cell, port.route.from as Direction);
				if (edgeKeys.has(staticFabOrganizationEdgeKey({ from: source, to: cell }))) return true;
			}
			if (port.route.to !== 0) {
				const target = moveCell(cell, port.route.to as Direction);
				if (edgeKeys.has(staticFabOrganizationEdgeKey({ from: cell, to: target }))) return true;
			}
			return false;
		})
		.map((port) => port.id)
		.sort((left, right) => left - right);
	return dependentPortIds.length === 0
		? null
		: Object.freeze({
				code: "CANDIDATE_COMPONENT_PORT_DEPENDENCY",
				reason: `Raw parent component 후보를 사용하는 Port가 있습니다 · ${dependentPortIds.slice(0, 8).join(", ")}${dependentPortIds.length > 8 ? ` · 나머지 ${dependentPortIds.length - 8}개` : ""}`,
			});
}

function moduleIndicesByCell(
	ownership: RailModuleOwnershipIndex,
	moduleIndices: readonly number[],
): ReadonlyMap<string, readonly number[]> {
	const result = new Map<string, number[]>();
	for (const moduleIndex of moduleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		const keys = new Set<string>();
		for (const edge of module.eraseEdges) {
			keys.add(cellKey(edge.from.x, edge.from.y));
			keys.add(cellKey(edge.to.x, edge.to.y));
		}
		for (const key of keys) {
			const indices = result.get(key);
			if (indices) indices.push(moduleIndex);
			else result.set(key, [moduleIndex]);
		}
	}
	return new Map(
		[...result]
			.sort(([left], [right]) => compareCellKeys(left, right))
			.map(([key, indices]) => [key, Object.freeze(indices.sort((a, b) => a - b))]),
	);
}

function uniqueModuleDirectedEdgeCount(
	ownership: RailModuleOwnershipIndex,
	moduleIndices: readonly number[],
): number {
	const keys = new Set<string>();
	for (const moduleIndex of moduleIndices) {
		for (const edge of ownership.modules[moduleIndex]?.eraseEdges ?? []) {
			keys.add(staticFabOrganizationEdgeKey(edge));
		}
	}
	return keys.size;
}

function acceptedInventory(scope: InventoryScope): StaticFabSemanticHierarchyBoundaryInventory {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_VERSION,
		action: scope.intent.action,
		targetRole: scope.intent.targetRole,
		targetOrganizationId: scope.intent.targetOrganizationId,
		parentFabOrganizationId: scope.parentFabOrganizationId,
		targetEffectiveModuleIndices: scope.targetEffectiveModuleIndices,
		targetEffectiveModuleKeys: scope.targetEffectiveModuleKeys,
		parentDirectModuleIndices: scope.parentDirectModuleIndices,
		parentDirectModuleKeys: scope.parentDirectModuleKeys,
		incidentParentModuleIndices: scope.incidentParentModuleIndices,
		incidentParentModuleKeys: scope.incidentParentModuleKeys,
		rawParentComponentCandidates: scope.rawParentComponentCandidates,
		rawSharedVertexContactCount: scope.rawSharedVertexContacts.length,
		candidateComponentDirectedEdgeCount: scope.candidateComponentDirectedEdgeCount,
		sourceModuleCount: scope.sourceModuleCount,
		sourceOrganizationCount: scope.sourceOrganizationCount,
		authority: "NO_MUTATION_AUTHORITY",
		evidenceStatus: "RAW_SHARED_VERTEX_COMPONENTS_ONLY",
		cutSetStatus: "CUT_SET_UNRESOLVED",
		unreviewedConditions: RAW_COMPONENT_UNREVIEWED,
		candidateInventoryBuilt: true,
		issueCode: null,
		reason:
			"Current-source target/parent shared-vertex module component 후보만 복원했습니다 · relationship purpose, opposite endpoint, directed seam, complete cut-set uniqueness와 mutation 권한은 검토되지 않았습니다",
	});
}

function rejectedInventory(
	intent: DiagnosticIntent,
	issueCode: StaticFabSemanticHierarchyBoundaryIssueCode,
	reason: string,
): StaticFabSemanticHierarchyBoundaryInventory {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_HIERARCHY_BOUNDARY_VERSION,
		action: intent.action,
		targetRole: intent.targetRole,
		targetOrganizationId: intent.targetOrganizationId,
		parentFabOrganizationId: null,
		targetEffectiveModuleIndices: EMPTY_NUMBERS,
		targetEffectiveModuleKeys: EMPTY_STRINGS,
		parentDirectModuleIndices: EMPTY_NUMBERS,
		parentDirectModuleKeys: EMPTY_STRINGS,
		incidentParentModuleIndices: EMPTY_NUMBERS,
		incidentParentModuleKeys: EMPTY_STRINGS,
		rawParentComponentCandidates: EMPTY_RAW_PARENT_COMPONENTS,
		rawSharedVertexContactCount: 0,
		candidateComponentDirectedEdgeCount: 0,
		sourceModuleCount: 0,
		sourceOrganizationCount: 0,
		authority: "NO_MUTATION_AUTHORITY",
		evidenceStatus: "NOT_EVALUATED",
		cutSetStatus: "NOT_EVALUATED",
		unreviewedConditions: EMPTY_UNREVIEWED,
		candidateInventoryBuilt: false,
		issueCode,
		reason,
	});
}

function reviewIntentMatches(
	review: StaticFabSemanticHierarchyRecoveryReview,
	intent: StaticFabSemanticHierarchyRecoveryIntent,
): boolean {
	return (
		review.version === intent.version &&
		review.action === intent.action &&
		review.targetRole === intent.targetRole &&
		review.targetOrganizationId === intent.targetOrganizationId &&
		review.expectedParentOrganizationId === intent.expectedParentOrganizationId
	);
}

function reviewSourceBindingMatches(
	review: StaticFabSemanticHierarchyRecoveryReview,
	current: StaticFabSemanticHierarchyRecoveryReview,
): boolean {
	return (
		review.accepted === true &&
		current.accepted === true &&
		review.targetName === current.targetName &&
		review.resolvedSemanticRole === current.resolvedSemanticRole &&
		review.attachmentState === current.attachmentState &&
		review.parentFabOrganizationId === current.parentFabOrganizationId &&
		review.subtreeOrganizationCount === current.subtreeOrganizationCount &&
		review.subtreeOrganizationFingerprint !== null &&
		review.subtreeOrganizationFingerprint === current.subtreeOrganizationFingerprint
	);
}

function isAcceptedReview(value: unknown): value is StaticFabSemanticHierarchyRecoveryReview {
	return isRecord(value) && value.accepted === true;
}

function readDiagnosticIntent(value: unknown): DiagnosticIntent {
	const record = isRecord(value) ? value : {};
	return Object.freeze({
		action: record.action === "DETACH" || record.action === "DELETE" ? record.action : null,
		targetRole:
			record.targetRole === "BAY_BANK" || record.targetRole === "FAB" ? record.targetRole : null,
		targetOrganizationId: positiveInt32(record.targetOrganizationId)
			? record.targetOrganizationId
			: null,
		expectedParentOrganizationId:
			record.expectedParentOrganizationId === null ||
			positiveInt32(record.expectedParentOrganizationId)
				? (record.expectedParentOrganizationId as number | null)
				: null,
	});
}

function moduleKeys(
	ownership: RailModuleOwnershipIndex,
	indices: readonly number[],
): readonly string[] {
	return Object.freeze(indices.map((index) => ownership.modules[index]?.key ?? String(index)));
}

function compareRawSharedVertexContacts(
	left: StaticFabSemanticHierarchyRawSharedVertexContact,
	right: StaticFabSemanticHierarchyRawSharedVertexContact,
): number {
	return (
		left.parentModuleIndex - right.parentModuleIndex ||
		left.targetModuleIndex - right.targetModuleIndex ||
		left.cell.x - right.cell.x ||
		left.cell.y - right.cell.y
	);
}

function compareCellKeys(left: string, right: string): number {
	const leftCell = parseCellKey(left);
	const rightCell = parseCellKey(right);
	return leftCell.x - rightCell.x || leftCell.y - rightCell.y;
}

function parseCellKey(key: string): Cell {
	const separator = key.indexOf(",");
	return {
		x: Number(key.slice(0, separator)),
		y: Number(key.slice(separator + 1)),
	};
}

function setEquals<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function appendIndex<Key>(target: Map<Key, number[]>, key: Key, moduleIndex: number): void {
	const indices = target.get(key);
	if (indices) indices.push(moduleIndex);
	else target.set(key, [moduleIndex]);
}

function freezeIndex<Key>(source: Map<Key, number[]>): ReadonlyMap<Key, readonly number[]> {
	return new Map(
		[...source].map(([key, indices]) => [
			key,
			Object.freeze(indices.sort((left, right) => left - right)),
		]),
	);
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "unknown source error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

class BoundaryFailure extends Error {
	readonly code: StaticFabSemanticHierarchyBoundaryIssueCode;

	constructor(code: StaticFabSemanticHierarchyBoundaryIssueCode, message: string) {
		super(message);
		this.code = code;
	}
}
