import {
	type AdvancedSwitchMutation,
	copyAdvancedSwitch,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import {
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { assertPortEquipmentLayout } from "./PortEquipmentLayoutValidator";
import { copyPortRecord, type PortMutation, type PortRecord } from "./PortRecord";
import { type RailMutation, railMutationTopologyError } from "./paint";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnershipIndex,
} from "./RailModuleOwnership";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	resolveStaticFabOrganizationCoverage,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationRecordEquals,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "./StaticFabOrganizationImpactIndex";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION = 1 as const;
export const STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND = "disconnect-static-fab-bay" as const;
export const STATIC_FAB_SEMANTIC_BAY_DELETE_KIND = "delete-static-fab-bay" as const;
export const STATIC_FAB_SEMANTIC_BAY_CONNECTOR_EDGE_LIMIT = 4_096;
export const STATIC_FAB_SEMANTIC_BAY_SUPPORT_SEAM_EDGE_LIMIT = 32;
const STATIC_FAB_SEMANTIC_BAY_DIAGNOSTIC_PORT_PREVIEW_LIMIT = 8;
const STATIC_FAB_SEMANTIC_BAY_DIAGNOSTIC_ORGANIZATION_PREVIEW_LIMIT = 8;

export type StaticFabSemanticBayMutationAction = "DISCONNECT" | "DELETE";

export type StaticFabSemanticBayMutationIssueCode =
	| "INVALID_SOURCE"
	| "STALE_SOURCE"
	| "MISSING_BAY"
	| "UNSUPPORTED_ORGANIZATION"
	| "ALREADY_DISCONNECTED"
	| "AMBIGUOUS_HIERARCHY"
	| "SHARED_ORGANIZATION_DEPENDENCY"
	| "ANCESTOR_COLLAPSE_UNRESOLVED"
	| "CONNECTOR_NOT_RECOGNIZED"
	| "AMBIGUOUS_CONNECTOR"
	| "SHARED_CONNECTOR_OWNERSHIP"
	| "CONNECTOR_EQUIPMENT_DEPENDENCY"
	| "PARTIAL_EQUIPMENT_GROUP"
	| "LEGACY_CUSTOM_EQUIPMENT"
	| "MUTATION_INVALID"
	| "ORGANIZATION_INVALID";

export interface StaticFabSemanticBayMutationIntent {
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION;
	readonly action: StaticFabSemanticBayMutationAction;
	readonly bayOrganizationId: number;
}

export interface StaticFabSemanticBayMutationReview {
	readonly version: typeof STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION;
	readonly action: StaticFabSemanticBayMutationAction;
	readonly bayOrganizationId: number;
	readonly bayName: string;
	readonly bankOrganizationId: number | null;
	readonly removedOrganizationIds: readonly number[];
	readonly processLoopOrganizationIds: readonly number[];
	readonly processLoopCount: number;
	readonly railModuleCount: number;
	readonly railModuleKeys: readonly string[];
	readonly bayDirectedEdgeCount: number;
	readonly incidentConnectorCount: 0 | 1;
	readonly connectorDirectedEdgeCount: number;
	readonly connectorOutboundDirectedEdgeKeys: readonly string[];
	readonly connectorReturnDirectedEdgeKeys: readonly string[];
	readonly advancedSwitchCount: number;
	readonly equipmentGroupCount: number;
	readonly equipmentGroupIds: readonly number[];
	readonly portCount: number;
	readonly portIds: readonly number[];
	readonly remainingBankDirectedEdgeCount: number;
	/** Presence is only a core candidate; topology/reachability is certified in the Worker. */
	readonly retainedCirculationCandidatePresent: boolean;
	readonly circulationCertification: "PENDING_WORKER_CERTIFICATION";
	readonly issueCode: StaticFabSemanticBayMutationIssueCode | null;
}

export interface StaticFabSemanticBayMutationPlan {
	readonly kind:
		| typeof STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND
		| typeof STATIC_FAB_SEMANTIC_BAY_DELETE_KIND;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly mutations: readonly RailMutation[];
	readonly switchMutations: readonly AdvancedSwitchMutation[];
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly organizationImpactAuthorizations: readonly number[];
	readonly nextOrganizationIdBefore: number;
	readonly nextOrganizationIdAfter: number;
	readonly valid: boolean;
	readonly reason: string;
	readonly issueCode: StaticFabSemanticBayMutationIssueCode | null;
	readonly review: StaticFabSemanticBayMutationReview;
}

export interface StaticFabSemanticBayMutationProspectiveState {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface StaticFabSemanticBayMutationPlanningResult {
	readonly plan: StaticFabSemanticBayMutationPlan;
	readonly prospectiveState: StaticFabSemanticBayMutationProspectiveState | null;
}

interface SemanticBaySource {
	readonly bay: StaticFabOrganizationRecord;
	readonly bank: StaticFabOrganizationRecord | null;
	readonly subtreeIds: ReadonlySet<number>;
	readonly descendantIds: readonly number[];
	readonly processLoopOrganizationIds: readonly number[];
	readonly processLoopCount: number;
}

interface IncidentConnector {
	readonly branchJunction: Cell;
	readonly mergeJunction: Cell;
	readonly outboundEdges: readonly DirectedRailEdge[];
	readonly inboundEdges: readonly DirectedRailEdge[];
	readonly edges: readonly DirectedRailEdge[];
}

interface ModuleReconciliationIndex {
	readonly ownership: RailModuleOwnershipIndex;
	readonly moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>;
	readonly moduleIndicesBySwitch: ReadonlyMap<number, readonly number[]>;
}

interface EquipmentRemoval {
	readonly groupIds: readonly number[];
	readonly ports: readonly PortRecord[];
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
}

const INTENT_KEYS = Object.freeze(["version", "action", "bayOrganizationId"] as const);

export function staticFabSemanticBayMutationIntentError(value: unknown): string | null {
	if (!isRecord(value)) return "Semantic Bay mutation intent must be an object.";
	if (!hasExactKeys(value, INTENT_KEYS)) {
		return "Semantic Bay mutation intent fields do not match version 1.";
	}
	if (value.version !== STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION) {
		return "Semantic Bay mutation intent version is invalid.";
	}
	if (value.action !== "DISCONNECT" && value.action !== "DELETE") {
		return "Semantic Bay mutation action is invalid.";
	}
	if (!positiveInt32(value.bayOrganizationId)) {
		return "Semantic Bay organization id is invalid.";
	}
	return null;
}

export function planStaticFabSemanticBayMutation(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabSemanticBayMutationIntent,
): StaticFabSemanticBayMutationPlan {
	return planStaticFabSemanticBayMutationWithProspectiveState(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		intent,
	).plan;
}

/**
 * Recognize one authored Bay and its unique Bank connector from current truth only. Delete is
 * deliberately planned through the exact disconnected intermediate so changed module boundaries
 * are re-owned before Bay content is erased.
 */
export function planStaticFabSemanticBayMutationWithProspectiveState(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabSemanticBayMutationIntent,
): StaticFabSemanticBayMutationPlanningResult {
	const intentError = staticFabSemanticBayMutationIntentError(intent);
	if (intentError) {
		return rejected(
			map,
			basePatchSequence,
			organizations,
			safeDiagnosticIntent(intent),
			"INVALID_SOURCE",
			intentError,
		);
	}
	if (!Number.isSafeInteger(basePatchSequence) || basePatchSequence < 0) {
		return rejected(
			map,
			basePatchSequence,
			organizations,
			intent,
			"STALE_SOURCE",
			"Semantic Bay 편집 순서가 유효하지 않습니다",
		);
	}
	const sourceError = staticFabOrganizationStateError(map, portEquipment, organizations);
	if (sourceError) {
		return rejected(
			map,
			basePatchSequence,
			organizations,
			intent,
			"INVALID_SOURCE",
			`정적 FAB 조직 상태가 유효하지 않습니다 · ${sourceError}`,
		);
	}
	try {
		assertPortEquipmentLayout(map, portEquipment);
	} catch (error) {
		return rejected(
			map,
			basePatchSequence,
			organizations,
			intent,
			"INVALID_SOURCE",
			`포트·장비 source 상태가 유효하지 않습니다 · ${error instanceof Error ? error.message : "unknown layout error"}`,
		);
	}

	const source = resolveSemanticBaySource(organizations, intent.bayOrganizationId);
	if (source instanceof PlanningFailure) {
		return rejected(map, basePatchSequence, organizations, intent, source.code, source.message);
	}
	if (intent.action === "DISCONNECT" && source.bank === null) {
		return rejected(
			map,
			basePatchSequence,
			organizations,
			intent,
			"ALREADY_DISCONNECTED",
			`'${source.bay.name}'은 현재 Bank에 연결되어 있지 않습니다`,
			source,
		);
	}

	try {
		const sourceCoverage = resolveStaticFabOrganizationCoverage(organizations, source.bay.id);
		if (!sourceCoverage) throw new Error("선택한 Bay의 effective membership을 찾을 수 없습니다");
		assertNoSharedSourceBankBayContentOwnership(source, sourceCoverage.effective);
		const connector = source.bank
			? recognizeIncidentConnector(map, source, sourceCoverage.effective)
			: null;
		assertNoSharedConnectorOwnership(organizations, source, connector);

		const disconnectEdges = connector?.edges ?? Object.freeze([]);
		const disconnectMutations = planDirectedEdgeRemoval(map, disconnectEdges, []);
		const disconnectedMap = map.clone();
		if (
			disconnectMutations.mutations.length > 0 &&
			!disconnectedMap.applyAtomicMutations(disconnectMutations.mutations, [])
		) {
			throw new PlanningFailure(
				"MUTATION_INVALID",
				"Bay connector 제거 계획이 현재 레일과 일치하지 않습니다",
			);
		}
		const disconnectInvalidatedPorts = portsInvalidatedInMap(disconnectedMap, portEquipment);
		if (disconnectInvalidatedPorts.length > 0) {
			throw new PlanningFailure(
				"CONNECTOR_EQUIPMENT_DEPENDENCY",
				`Bay connector를 사용하는 포트가 있습니다 · ${summarizeDependentPortIds(
					disconnectInvalidatedPorts,
				)}`,
			);
		}
		const disconnectedOrganizations = reconcileDisconnectedOrganizations(
			organizations,
			disconnectedMap,
			source,
			disconnectEdges,
		);
		if (source.bank) {
			const disconnectedBank = disconnectedOrganizations.records.find(
				(record) => record.id === source.bank?.id,
			);
			const sourceRoles = deriveStaticFabOrganizationSemanticRoles(organizations);
			const disconnectedRoles = deriveStaticFabOrganizationSemanticRoles(disconnectedOrganizations);
			const remainingBayChildren = disconnectedOrganizations.records.filter(
				(record) =>
					disconnectedRoles.get(record.id) === "BAY" &&
					staticFabOrganizationParentIds(record).includes(source.bank?.id ?? -1),
			);
			const sourceFabParentIds = staticFabOrganizationParentIds(source.bank).filter(
				(id) => sourceRoles.get(id) === "FAB",
			);
			if (
				!disconnectedBank ||
				disconnectedRoles.get(disconnectedBank.id) !== "BAY_BANK" ||
				sourceFabParentIds.some((id) => disconnectedRoles.get(id) !== "FAB") ||
				(disconnectedBank.membership.railEdges.length === 0 &&
					disconnectedBank.membership.advancedSwitchIds.length === 0 &&
					disconnectedBank.membership.equipmentGroupIds.length === 0) ||
				remainingBayChildren.length === 0
			) {
				throw new PlanningFailure(
					"ANCESTOR_COLLAPSE_UNRESOLVED",
					"이 Bay를 분리하면 Bank가 비거나 semantic Bay 자식이 없어집니다 · Bank cascade 정책이 필요합니다",
				);
			}
		}
		const disconnectedOrganizationError = staticFabOrganizationStateError(
			disconnectedMap,
			portEquipment,
			disconnectedOrganizations,
		);
		if (disconnectedOrganizationError) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`Disconnect 후 조직 멤버십을 복원할 수 없습니다 · ${disconnectedOrganizationError}`,
			);
		}

		if (intent.action === "DISCONNECT") {
			const disconnectedCoverage = resolveStaticFabOrganizationCoverage(
				disconnectedOrganizations,
				source.bay.id,
			);
			if (!disconnectedCoverage) {
				throw new PlanningFailure(
					"ORGANIZATION_INVALID",
					"Disconnect 후 Bay effective membership을 찾을 수 없습니다",
				);
			}
			const disconnectedOwnership = buildRailModuleOwnershipIndex(disconnectedMap);
			const preservedGroupIds = disconnectedCoverage.effective.equipmentGroupIds;
			const preservedPorts = portsForGroupIds(portEquipment, preservedGroupIds);
			const organizationMutations = diffStaticFabOrganizations(
				organizations,
				disconnectedOrganizations,
			);
			const impacts = exactStaticFabOrganizationImpactAuthorizations(
				organizations,
				organizationMutations,
				disconnectMutations.mutations,
				[],
				[],
				[],
				portEquipment,
				portEquipment,
			);
			const review = createReview(
				intent,
				source,
				disconnectedOwnership,
				disconnectedOrganizations,
				connector,
				disconnectedCoverage.effective,
				[],
				preservedGroupIds,
				preservedPorts,
			);
			const plan = validPlan(
				intent,
				map,
				basePatchSequence,
				organizations,
				disconnectMutations.mutations,
				[],
				[],
				[],
				organizationMutations,
				impacts,
				review,
				`Production Bay '${source.bay.name}'을 Bank에서 분리합니다`,
			);
			return Object.freeze({
				plan,
				prospectiveState: Object.freeze({
					map: disconnectedMap,
					portEquipment,
					organizations: disconnectedOrganizations,
				}),
			});
		}

		const disconnectedCoverage = resolveStaticFabOrganizationCoverage(
			disconnectedOrganizations,
			source.bay.id,
		);
		if (!disconnectedCoverage) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				"Disconnect 후 Bay effective membership을 찾을 수 없습니다",
			);
		}
		const disconnectedOwnership = buildRailModuleOwnershipIndex(disconnectedMap);
		const deleteModuleIndices = exactModuleIndicesForMembership(
			disconnectedOwnership,
			disconnectedCoverage.effective,
		);
		const deleteEdges = moduleEdges(disconnectedOwnership, deleteModuleIndices);
		const deleteSwitchIds = moduleSwitchIds(disconnectedOwnership, deleteModuleIndices);
		const deleteSwitchBoundaryEdges = exactDeletedAdvancedSwitchBoundaryEdges(
			disconnectedMap,
			disconnectedOwnership,
			deleteModuleIndices,
			deleteSwitchIds,
			disconnectEdges,
		);
		const exactDeleteEdges = uniqueEdges([...deleteEdges, ...deleteSwitchBoundaryEdges]);
		assertNoSharedBayContentOwnership(
			disconnectedOrganizations,
			source.subtreeIds,
			exactDeleteEdges,
			deleteSwitchIds,
		);
		const allRemovedEdges = uniqueEdges([...disconnectEdges, ...exactDeleteEdges]);
		const finalRemoval = planDirectedEdgeRemoval(map, allRemovedEdges, deleteSwitchIds);
		const finalMap = map.clone();
		if (!finalMap.applyAtomicMutations(finalRemoval.mutations, finalRemoval.switchMutations)) {
			throw new PlanningFailure(
				"MUTATION_INVALID",
				"Bay 내용 제거 계획이 현재 레일과 일치하지 않습니다",
			);
		}
		const equipment = resolveEquipmentRemoval(
			finalMap,
			portEquipment,
			disconnectedCoverage.effective.equipmentGroupIds,
			disconnectedOrganizations,
			source.subtreeIds,
		);
		const finalEquipment = applyPortEquipmentMutations(
			portEquipment,
			equipment.portMutations,
			equipment.equipmentGroupMutations,
		);
		try {
			assertPortEquipmentLayout(finalMap, finalEquipment);
		} catch (error) {
			throw new PlanningFailure(
				"MUTATION_INVALID",
				`Delete 후 포트·장비 layout이 유효하지 않습니다 · ${error instanceof Error ? error.message : "unknown layout error"}`,
			);
		}
		const finalOrganizations = reconcileDeletedOrganizations(
			disconnectedOrganizations,
			finalMap,
			source,
			allRemovedEdges,
			deleteSwitchIds,
			equipment.groupIds,
		);
		const finalOrganizationError = staticFabOrganizationStateError(
			finalMap,
			finalEquipment,
			finalOrganizations,
		);
		if (finalOrganizationError) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`Delete 후 조직 멤버십을 복원할 수 없습니다 · ${finalOrganizationError}`,
			);
		}
		const organizationMutations = diffStaticFabOrganizations(organizations, finalOrganizations);
		const impacts = exactStaticFabOrganizationImpactAuthorizations(
			organizations,
			organizationMutations,
			finalRemoval.mutations,
			finalRemoval.switchMutations,
			equipment.portMutations,
			equipment.equipmentGroupMutations,
			portEquipment,
			finalEquipment,
		);
		const review = createReview(
			intent,
			source,
			disconnectedOwnership,
			finalOrganizations,
			connector,
			disconnectedCoverage.effective,
			deleteModuleIndices,
			equipment.groupIds,
			equipment.ports,
		);
		const plan = validPlan(
			intent,
			map,
			basePatchSequence,
			organizations,
			finalRemoval.mutations,
			finalRemoval.switchMutations,
			equipment.portMutations,
			equipment.equipmentGroupMutations,
			organizationMutations,
			impacts,
			review,
			`Production Bay '${source.bay.name}'과 하위 Process Loop를 원자적으로 삭제합니다`,
		);
		return Object.freeze({
			plan,
			prospectiveState: Object.freeze({
				map: finalMap,
				portEquipment: finalEquipment,
				organizations: finalOrganizations,
			}),
		});
	} catch (error) {
		const failure = planningFailure(error);
		return rejected(
			map,
			basePatchSequence,
			organizations,
			intent,
			failure.code,
			failure.message,
			source,
		);
	}
}

function resolveSemanticBaySource(
	organizations: StaticFabOrganizationState,
	bayOrganizationId: number,
): SemanticBaySource | PlanningFailure {
	const bay = organizations.records.find((record) => record.id === bayOrganizationId);
	if (!bay)
		return new PlanningFailure("MISSING_BAY", `조직 ${bayOrganizationId}을 찾을 수 없습니다`);
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	if (roles.get(bay.id) !== "BAY") {
		return new PlanningFailure(
			"UNSUPPORTED_ORGANIZATION",
			`'${bay.name}'은 Process Loop 자식을 가진 semantic Bay가 아닙니다`,
		);
	}
	const descendantIds = resolveStaticFabOrganizationDescendantIds(organizations, bay.id);
	if (!descendantIds) {
		return new PlanningFailure("AMBIGUOUS_HIERARCHY", "Bay 하위 조직을 해석할 수 없습니다");
	}
	const subtreeIds = new Set<number>([bay.id, ...descendantIds]);
	for (const descendantId of descendantIds) {
		const descendant = organizations.records.find((record) => record.id === descendantId);
		if (!descendant) {
			return new PlanningFailure(
				"AMBIGUOUS_HIERARCHY",
				`Bay 하위 조직 ${descendantId}을 찾을 수 없습니다`,
			);
		}
		const descendantParents = staticFabOrganizationParentIds(descendant);
		if (descendantParents.some((id) => !subtreeIds.has(id))) {
			return new PlanningFailure(
				"SHARED_ORGANIZATION_DEPENDENCY",
				`하위 조직 '${descendant.name}'이 선택 Bay 밖의 부모와 공유됩니다`,
			);
		}
		if (
			roles.get(descendant.id) !== "PROCESS_LOOP" ||
			descendantParents.length !== 1 ||
			descendantParents[0] !== bay.id
		) {
			return new PlanningFailure(
				"AMBIGUOUS_HIERARCHY",
				`현재 v1은 Bay의 direct Process Loop 자식만 처리합니다 · '${descendant.name}'`,
			);
		}
	}
	const parents = staticFabOrganizationParentIds(bay);
	const bankParents = parents
		.map((id) => organizations.records.find((record) => record.id === id))
		.filter(
			(record): record is StaticFabOrganizationRecord =>
				record !== undefined && roles.get(record.id) === "BAY_BANK",
		);
	if (
		bankParents.length > 1 ||
		(bankParents.length === 1 && parents.length !== 1) ||
		(bankParents.length === 0 && parents.length !== 0)
	) {
		return new PlanningFailure(
			"AMBIGUOUS_HIERARCHY",
			"현재 v1은 정확히 하나의 Bank 부모를 가진 Bay 또는 완전히 detached Bay만 처리합니다",
		);
	}
	const bank = bankParents[0] ?? null;
	if (bank) {
		const bankParentIds = staticFabOrganizationParentIds(bank);
		const fabParents = bankParentIds
			.map((id) => organizations.records.find((record) => record.id === id))
			.filter(
				(record): record is StaticFabOrganizationRecord =>
					record !== undefined && roles.get(record.id) === "FAB",
			);
		if (
			bankParentIds.length !== 1 ||
			fabParents.length !== 1 ||
			staticFabOrganizationParentIds(fabParents[0] as StaticFabOrganizationRecord).length !== 0
		) {
			return new PlanningFailure(
				"AMBIGUOUS_HIERARCHY",
				"현재 v1은 root Fab → Bank → Bay의 exact 단일-parent 계층만 처리합니다",
			);
		}
	}
	const processLoopOrganizationIds = descendantIds
		.filter((id) => roles.get(id) === "PROCESS_LOOP")
		.sort((left, right) => left - right);
	return Object.freeze({
		bay,
		bank,
		subtreeIds,
		descendantIds,
		processLoopOrganizationIds: Object.freeze(processLoopOrganizationIds),
		processLoopCount: processLoopOrganizationIds.length,
	});
}

function recognizeIncidentConnector(
	map: TileMap,
	source: SemanticBaySource,
	effectiveMembership: StaticFabOrganizationMembership,
): IncidentConnector {
	const bank = source.bank;
	if (!bank) throw new PlanningFailure("ALREADY_DISCONNECTED", "Bay가 이미 detached 상태입니다");
	const bankEdgeKeys = new Set(bank.membership.railEdges.map(staticFabOrganizationEdgeKey));
	const bayEdgeKeys = new Set(effectiveMembership.railEdges.map(staticFabOrganizationEdgeKey));
	const bayCells = membershipCells(effectiveMembership);
	const branchSeeds: DirectedRailEdge[] = [];
	const mergeSeeds: DirectedRailEdge[] = [];
	for (const cell of bayCells.values()) {
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.outgoing) > 1) {
			const outgoing = outgoingEdges(map, cell);
			const bankOnly = outgoing.filter(
				(edge) =>
					bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)) &&
					!bayEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
			);
			const bayOwned = outgoing.some((edge) => bayEdgeKeys.has(staticFabOrganizationEdgeKey(edge)));
			if (bayOwned) branchSeeds.push(...bankOnly);
		}
		if (bitCount(rail.incoming) > 1) {
			const incoming = incomingEdges(map, cell);
			const bankOnly = incoming.filter(
				(edge) =>
					bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)) &&
					!bayEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
			);
			const bayOwned = incoming.some((edge) => bayEdgeKeys.has(staticFabOrganizationEdgeKey(edge)));
			if (bayOwned) mergeSeeds.push(...bankOnly);
		}
	}
	const uniqueBranchSeeds = uniqueEdges(branchSeeds);
	const uniqueMergeSeeds = uniqueEdges(mergeSeeds);
	if (uniqueBranchSeeds.length === 0 || uniqueMergeSeeds.length === 0) {
		throw new PlanningFailure(
			"CONNECTOR_NOT_RECOGNIZED",
			"Bay와 Bank 사이의 branch/merge connector 왕복 경로를 찾을 수 없습니다",
		);
	}
	if (uniqueBranchSeeds.length !== 1 || uniqueMergeSeeds.length !== 1) {
		throw new PlanningFailure(
			"AMBIGUOUS_CONNECTOR",
			`Bay 경계에서 branch ${uniqueBranchSeeds.length}개 · merge ${uniqueMergeSeeds.length}개 connector 후보가 발견되었습니다`,
		);
	}
	const branchSeed = uniqueBranchSeeds[0] as DirectedRailEdge;
	const mergeSeed = uniqueMergeSeeds[0] as DirectedRailEdge;
	const outboundEdges = traceConnectorForward(map, bankEdgeKeys, bayCells, branchSeed);
	const inboundEdges = traceConnectorBackward(map, bankEdgeKeys, bayCells, mergeSeed);
	const edges = uniqueEdges([...outboundEdges, ...inboundEdges]);
	if (edges.length !== outboundEdges.length + inboundEdges.length) {
		throw new PlanningFailure(
			"AMBIGUOUS_CONNECTOR",
			"Bay connector의 outbound와 return 경로가 겹칩니다",
		);
	}
	if (edges.length > STATIC_FAB_SEMANTIC_BAY_CONNECTOR_EDGE_LIMIT) {
		throw new PlanningFailure(
			"AMBIGUOUS_CONNECTOR",
			`Bay connector가 ${STATIC_FAB_SEMANTIC_BAY_CONNECTOR_EDGE_LIMIT.toLocaleString()} edge 한도를 넘습니다`,
		);
	}
	return Object.freeze({
		branchJunction: Object.freeze({ ...branchSeed.from }),
		mergeJunction: Object.freeze({ ...mergeSeed.to }),
		outboundEdges,
		inboundEdges,
		edges,
	});
}

function traceConnectorForward(
	map: TileMap,
	bankEdgeKeys: ReadonlySet<string>,
	bayCells: ReadonlyMap<string, Cell>,
	seed: DirectedRailEdge,
): readonly DirectedRailEdge[] {
	const edges: DirectedRailEdge[] = [seed];
	let cursor = seed.to;
	for (let step = 0; step < STATIC_FAB_SEMANTIC_BAY_CONNECTOR_EDGE_LIMIT; step += 1) {
		if (bayCells.has(cellKey(cursor.x, cursor.y))) {
			throw new PlanningFailure(
				"AMBIGUOUS_CONNECTOR",
				"Bay outbound connector가 Bay content 안으로 다시 진입합니다",
			);
		}
		const rail = map.getRail(cursor.x, cursor.y);
		if (bitCount(rail.incoming) > 1) {
			if (
				!outgoingEdges(map, cursor).some((edge) =>
					bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
				)
			) {
				throw new PlanningFailure(
					"CONNECTOR_NOT_RECOGNIZED",
					"Bay outbound connector가 Bank merge support에 도달하지 못했습니다",
				);
			}
			return Object.freeze(edges);
		}
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) {
			throw new PlanningFailure(
				"AMBIGUOUS_CONNECTOR",
				"Bay outbound connector 중간 경로가 단일 directed chain이 아닙니다",
			);
		}
		const next = outgoingEdges(map, cursor).filter((edge) =>
			bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
		);
		if (next.length !== 1) {
			throw new PlanningFailure(
				"CONNECTOR_NOT_RECOGNIZED",
				"Bay outbound connector의 Bank-owned 다음 edge가 유일하지 않습니다",
			);
		}
		edges.push(next[0] as DirectedRailEdge);
		cursor = (next[0] as DirectedRailEdge).to;
	}
	throw new PlanningFailure("AMBIGUOUS_CONNECTOR", "Bay outbound connector 추적 한도를 넘었습니다");
}

function traceConnectorBackward(
	map: TileMap,
	bankEdgeKeys: ReadonlySet<string>,
	bayCells: ReadonlyMap<string, Cell>,
	seed: DirectedRailEdge,
): readonly DirectedRailEdge[] {
	const reverseEdges: DirectedRailEdge[] = [seed];
	let cursor = seed.from;
	for (let step = 0; step < STATIC_FAB_SEMANTIC_BAY_CONNECTOR_EDGE_LIMIT; step += 1) {
		if (bayCells.has(cellKey(cursor.x, cursor.y))) {
			throw new PlanningFailure(
				"AMBIGUOUS_CONNECTOR",
				"Bay return connector가 Bay content 안으로 다시 진입합니다",
			);
		}
		const rail = map.getRail(cursor.x, cursor.y);
		if (bitCount(rail.outgoing) > 1) {
			if (
				!incomingEdges(map, cursor).some((edge) =>
					bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
				)
			) {
				throw new PlanningFailure(
					"CONNECTOR_NOT_RECOGNIZED",
					"Bay return connector가 Bank branch support에 도달하지 못했습니다",
				);
			}
			return Object.freeze([...reverseEdges].reverse());
		}
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) {
			throw new PlanningFailure(
				"AMBIGUOUS_CONNECTOR",
				"Bay return connector 중간 경로가 단일 directed chain이 아닙니다",
			);
		}
		const previous = incomingEdges(map, cursor).filter((edge) =>
			bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
		);
		if (previous.length !== 1) {
			throw new PlanningFailure(
				"CONNECTOR_NOT_RECOGNIZED",
				"Bay return connector의 Bank-owned 이전 edge가 유일하지 않습니다",
			);
		}
		reverseEdges.push(previous[0] as DirectedRailEdge);
		cursor = (previous[0] as DirectedRailEdge).from;
	}
	throw new PlanningFailure("AMBIGUOUS_CONNECTOR", "Bay return connector 추적 한도를 넘었습니다");
}

function reconcileDisconnectedOrganizations(
	organizations: StaticFabOrganizationState,
	disconnectedMap: TileMap,
	source: SemanticBaySource,
	removedEdges: readonly DirectedRailEdge[],
): StaticFabOrganizationState {
	const removedEdgeKeys = new Set(removedEdges.map(staticFabOrganizationEdgeKey));
	const index = createModuleReconciliationIndex(disconnectedMap);
	const subtreeRecords = organizations.records.filter((record) => source.subtreeIds.has(record.id));
	const subtreeModuleIndices = new Set<number>();
	const subtreeOwnersByModuleIndex = new Map<number, number[]>();
	const subtreeMemberships = new Map<number, StaticFabOrganizationMembership>();
	for (const record of subtreeRecords) {
		const resolved = rematerializeMembership(
			record.membership,
			index,
			removedEdgeKeys,
			new Set(),
			new Set(),
		);
		for (const moduleIndex of resolved.moduleIndices) {
			subtreeModuleIndices.add(moduleIndex);
			appendIndex(subtreeOwnersByModuleIndex, moduleIndex, record.id);
		}
		subtreeMemberships.set(record.id, resolved.membership);
	}
	for (const [moduleIndex, ownerIds] of subtreeOwnersByModuleIndex) {
		if (ownerIds.length > 1) {
			const module = index.ownership.modules[moduleIndex];
			throw new PlanningFailure(
				"SHARED_ORGANIZATION_DEPENDENCY",
				`Bay subtree 조직 ${summarizeStaticFabSemanticBayOrganizationOwnerIds(ownerIds)}이 prospective module ${module?.key ?? moduleIndex}을 공유합니다`,
			);
		}
	}
	const detachedComponentModuleIndices = detachedComponentModules(
		disconnectedMap,
		index,
		subtreeModuleIndices,
	);
	const seamModuleIndices = new Set(
		[...detachedComponentModuleIndices].filter(
			(moduleIndex) => !subtreeModuleIndices.has(moduleIndex),
		),
	);
	if (seamModuleIndices.size > 0) {
		assertDetachedSupportSeams(
			organizations,
			disconnectedMap,
			source,
			removedEdges,
			index.ownership,
			subtreeModuleIndices,
			seamModuleIndices,
		);
		const bayMembership = subtreeMemberships.get(source.bay.id);
		if (!bayMembership) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				"Detached Bay root membership을 찾을 수 없습니다",
			);
		}
		subtreeMemberships.set(
			source.bay.id,
			membershipFromModuleIndices(bayMembership, index.ownership, seamModuleIndices),
		);
		for (const moduleIndex of seamModuleIndices) subtreeModuleIndices.add(moduleIndex);
	}
	const mutations: StaticFabOrganizationMutation[] = [];
	for (const record of organizations.records) {
		let membership: StaticFabOrganizationMembership;
		if (source.subtreeIds.has(record.id)) {
			membership = subtreeMemberships.get(record.id) as StaticFabOrganizationMembership;
		} else if (record.id === source.bank?.id) {
			membership = rematerializeMembership(
				record.membership,
				index,
				removedEdgeKeys,
				new Set(),
				new Set(),
				subtreeModuleIndices,
			).membership;
		} else {
			const resolved = rematerializeMembership(
				record.membership,
				index,
				removedEdgeKeys,
				new Set(),
				new Set(),
			);
			if (
				[...resolved.moduleIndices].some((moduleIndex) => subtreeModuleIndices.has(moduleIndex))
			) {
				throw new PlanningFailure(
					"SHARED_ORGANIZATION_DEPENDENCY",
					`조직 '${record.name}'이 detached Bay support module을 공유합니다`,
				);
			}
			membership = resolved.membership;
		}
		const parents =
			record.id === source.bay.id && source.bank
				? Object.freeze(
						staticFabOrganizationParentIds(record).filter((id) => id !== source.bank?.id),
					)
				: staticFabOrganizationParentIds(record);
		const after = copyStaticFabOrganizationRecord({
			...record,
			parentOrganizationIds: parents,
			properties: staticFabOrganizationProperties(record),
			membership,
		});
		if (!staticFabOrganizationRecordEquals(record, after)) {
			mutations.push(Object.freeze({ id: record.id, before: record, after }));
		}
	}
	return applyStaticFabOrganizationMutations(
		organizations,
		Object.freeze(mutations.sort((left, right) => left.id - right.id)),
		organizations.nextOrganizationId,
		true,
	);
}

/**
 * A parent gateway may reuse a short Bay-shell support seam whose source module was assigned to
 * the Bank because the pre-disconnect junction crossed the semantic boundary. Once the gateway
 * edges are removed, that seam is safe to return to the Bay only when it is a bounded, straight,
 * Bank-only path joining two already-owned pieces of the detached Bay component. This deliberately
 * rejects a spur, switch, shared circulation, or an arbitrary Bank trunk stranded by a bad cut.
 */
function assertDetachedSupportSeams(
	organizations: StaticFabOrganizationState,
	disconnectedMap: TileMap,
	source: SemanticBaySource,
	removedEdges: readonly DirectedRailEdge[],
	ownership: RailModuleOwnershipIndex,
	subtreeModuleIndices: ReadonlySet<number>,
	seamModuleIndices: ReadonlySet<number>,
): void {
	if (!source.bank) {
		throw new PlanningFailure(
			"SHARED_CONNECTOR_OWNERSHIP",
			"Detached Bay에 출처가 없는 support seam이 남아 있습니다",
		);
	}
	const seamEdges = uniqueEdges(
		[...seamModuleIndices].flatMap(
			(moduleIndex) => ownership.modules[moduleIndex]?.eraseEdges ?? [],
		),
	);
	if (
		seamEdges.length === 0 ||
		seamEdges.length > STATIC_FAB_SEMANTIC_BAY_SUPPORT_SEAM_EDGE_LIMIT
	) {
		throw new PlanningFailure(
			"SHARED_CONNECTOR_OWNERSHIP",
			`Bay support seam이 ${STATIC_FAB_SEMANTIC_BAY_SUPPORT_SEAM_EDGE_LIMIT} edge 한도 안의 비어 있지 않은 경로가 아닙니다`,
		);
	}
	for (const moduleIndex of seamModuleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module || module.kind !== "straight" || module.advancedSwitchId !== null) {
			throw new PlanningFailure(
				"SHARED_CONNECTOR_OWNERSHIP",
				`Prospective seam module ${module?.key ?? moduleIndex}이 단순 straight support가 아닙니다`,
			);
		}
		for (const edge of module.eraseEdges) {
			const edgeKey = staticFabOrganizationEdgeKey(edge);
			const sourceOwnerIds = organizations.records
				.filter((record) =>
					record.membership.railEdges.some(
						(candidate) => staticFabOrganizationEdgeKey(candidate) === edgeKey,
					),
				)
				.map((record) => record.id);
			if (sourceOwnerIds.length !== 1 || sourceOwnerIds[0] !== source.bank.id) {
				throw new PlanningFailure(
					"SHARED_CONNECTOR_OWNERSHIP",
					`Prospective seam edge ${edgeKey}의 source owner가 선택 Bay의 Bank 하나가 아닙니다`,
				);
			}
		}
	}

	const subtreeCells = moduleCellKeys(ownership, subtreeModuleIndices);
	const subtreeModuleIndicesByCell = new Map<string, number[]>();
	for (const moduleIndex of subtreeModuleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		const cells = new Set<string>();
		for (const edge of module.eraseEdges) {
			cells.add(cellKey(edge.from.x, edge.from.y));
			cells.add(cellKey(edge.to.x, edge.to.y));
		}
		for (const key of cells) appendIndex(subtreeModuleIndicesByCell, key, moduleIndex);
	}
	const seamNeighbors = new Map<string, Set<string>>();
	const seamCells = new Map<string, Cell>();
	for (const edge of seamEdges) {
		const fromKey = cellKey(edge.from.x, edge.from.y);
		const toKey = cellKey(edge.to.x, edge.to.y);
		seamCells.set(fromKey, edge.from);
		seamCells.set(toKey, edge.to);
		appendNeighbor(seamNeighbors, fromKey, toKey);
		appendNeighbor(seamNeighbors, toKey, fromKey);
	}
	if ([...seamNeighbors.values()].some((neighbors) => neighbors.size > 2)) {
		throw new PlanningFailure(
			"SHARED_CONNECTOR_OWNERSHIP",
			"Bay support seam이 branch를 포함합니다",
		);
	}
	const connectorBoundaryCells = new Map<string, Cell>();
	for (const edge of removedEdges) {
		for (const endpoint of [edge.from, edge.to]) {
			const rail = disconnectedMap.getRail(endpoint.x, endpoint.y);
			if ((rail.incoming | rail.outgoing) !== 0) {
				connectorBoundaryCells.set(cellKey(endpoint.x, endpoint.y), endpoint);
			}
		}
	}
	const boundarySupportModuleIndices = new Set<number>();
	for (const moduleIndex of subtreeModuleIndices) {
		const module = ownership.modules[moduleIndex];
		if (
			module?.eraseEdges.some(
				(edge) =>
					connectorBoundaryCells.has(cellKey(edge.from.x, edge.from.y)) ||
					connectorBoundaryCells.has(cellKey(edge.to.x, edge.to.y)),
			)
		) {
			boundarySupportModuleIndices.add(moduleIndex);
		}
	}
	const boundarySupportCells = moduleCellKeys(ownership, boundarySupportModuleIndices);
	if (boundarySupportCells.size === 0) {
		throw new PlanningFailure(
			"SHARED_CONNECTOR_OWNERSHIP",
			"Bay connector boundary와 exact하게 맞닿은 Bay-owned support module이 없습니다",
		);
	}
	const visited = new Set<string>();
	for (const startKey of seamCells.keys()) {
		if (visited.has(startKey)) continue;
		const pending = [startKey];
		const componentKeys: string[] = [];
		for (let offset = 0; offset < pending.length; offset += 1) {
			const key = pending[offset] as string;
			if (visited.has(key)) continue;
			visited.add(key);
			componentKeys.push(key);
			for (const neighbor of seamNeighbors.get(key) ?? []) {
				if (!visited.has(neighbor)) pending.push(neighbor);
			}
		}
		const endpointKeys = componentKeys.filter((key) => (seamNeighbors.get(key)?.size ?? 0) === 1);
		const contactKeys = componentKeys.filter((key) => subtreeCells.has(key));
		const firstEndpointModules = new Set(
			endpointKeys[0] ? (subtreeModuleIndicesByCell.get(endpointKeys[0]) ?? []) : [],
		);
		const secondEndpointModules = new Set(
			endpointKeys[1] ? (subtreeModuleIndicesByCell.get(endpointKeys[1]) ?? []) : [],
		);
		const endpointModulesAreDistinct =
			firstEndpointModules.size > 0 &&
			secondEndpointModules.size > 0 &&
			![...firstEndpointModules].some((moduleIndex) => secondEndpointModules.has(moduleIndex));
		const touchesExactBoundarySupport = endpointKeys.some((key) => boundarySupportCells.has(key));
		if (
			componentKeys.reduce((sum, key) => sum + (seamNeighbors.get(key)?.size ?? 0), 0) / 2 !==
				componentKeys.length - 1 ||
			endpointKeys.length !== 2 ||
			new Set(contactKeys).size !== 2 ||
			!endpointKeys.every((key) => subtreeCells.has(key)) ||
			!endpointModulesAreDistinct ||
			!touchesExactBoundarySupport
		) {
			throw new PlanningFailure(
				"SHARED_CONNECTOR_OWNERSHIP",
				"Bay support seam이 connector boundary에서 서로 다른 두 Bay-owned module을 잇는 단일 path가 아닙니다",
			);
		}
	}
}

function detachedComponentModules(
	map: TileMap,
	index: ModuleReconciliationIndex,
	seedModuleIndices: ReadonlySet<number>,
): ReadonlySet<number> {
	const firstSeed = [...seedModuleIndices]
		.map((moduleIndex) => index.ownership.modules[moduleIndex])
		.find((module) => module && module.eraseEdges.length > 0);
	const firstCell = firstSeed?.eraseEdges[0]?.from;
	if (!firstCell) {
		throw new PlanningFailure(
			"ORGANIZATION_INVALID",
			"Detached Bay component를 시작할 rail seed가 없습니다",
		);
	}
	const componentCells = new Set<string>();
	const pending: Cell[] = [firstCell];
	for (let offset = 0; offset < pending.length; offset += 1) {
		const cell = pending[offset] as Cell;
		const key = cellKey(cell.x, cell.y);
		if (componentCells.has(key)) continue;
		componentCells.add(key);
		const rail = map.getRail(cell.x, cell.y);
		for (const direction of ALL_DIRECTIONS) {
			if (((rail.incoming | rail.outgoing) & direction) === 0) continue;
			const neighbor = moveCell(cell, direction);
			if (!componentCells.has(cellKey(neighbor.x, neighbor.y))) pending.push(neighbor);
		}
	}
	const componentModuleIndices = new Set<number>();
	for (let moduleIndex = 0; moduleIndex < index.ownership.modules.length; moduleIndex += 1) {
		const module = index.ownership.modules[moduleIndex];
		if (
			module?.eraseEdges.some(
				(edge) =>
					componentCells.has(cellKey(edge.from.x, edge.from.y)) ||
					componentCells.has(cellKey(edge.to.x, edge.to.y)),
			)
		) {
			componentModuleIndices.add(moduleIndex);
		}
	}
	for (const seed of seedModuleIndices) {
		if (!componentModuleIndices.has(seed)) {
			throw new PlanningFailure(
				"AMBIGUOUS_CONNECTOR",
				"Bay subtree가 Disconnect 후 둘 이상의 rail component에 걸쳐 있습니다",
			);
		}
	}
	return componentModuleIndices;
}

function membershipFromModuleIndices(
	base: StaticFabOrganizationMembership,
	ownership: RailModuleOwnershipIndex,
	indices: ReadonlySet<number>,
): StaticFabOrganizationMembership {
	const edges = new Map(base.railEdges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]));
	const switches = new Set(base.advancedSwitchIds);
	for (const moduleIndex of indices) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switches.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switches].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...base.equipmentGroupIds]),
	});
}

function reconcileDeletedOrganizations(
	disconnectedOrganizations: StaticFabOrganizationState,
	finalMap: TileMap,
	source: SemanticBaySource,
	removedEdges: readonly DirectedRailEdge[],
	removedSwitchIds: readonly number[],
	removedEquipmentGroupIds: readonly number[],
): StaticFabOrganizationState {
	const removedEdgeKeys = new Set(removedEdges.map(staticFabOrganizationEdgeKey));
	const removedSwitches = new Set(removedSwitchIds);
	const removedGroups = new Set(removedEquipmentGroupIds);
	const index = createModuleReconciliationIndex(finalMap);
	const mutations: StaticFabOrganizationMutation[] = [];
	for (const record of disconnectedOrganizations.records) {
		if (source.subtreeIds.has(record.id)) {
			mutations.push(Object.freeze({ id: record.id, before: record, after: null }));
			continue;
		}
		if (staticFabOrganizationParentIds(record).some((id) => source.subtreeIds.has(id))) {
			throw new PlanningFailure(
				"SHARED_ORGANIZATION_DEPENDENCY",
				`조직 '${record.name}'이 삭제할 Bay subtree를 부모로 참조합니다`,
			);
		}
		const membership = rematerializeMembership(
			record.membership,
			index,
			removedEdgeKeys,
			removedSwitches,
			removedGroups,
		).membership;
		const after = copyStaticFabOrganizationRecord({
			...record,
			properties: staticFabOrganizationProperties(record),
			membership,
		});
		if (!staticFabOrganizationRecordEquals(record, after)) {
			mutations.push(Object.freeze({ id: record.id, before: record, after }));
		}
	}
	return applyStaticFabOrganizationMutations(
		disconnectedOrganizations,
		Object.freeze(mutations.sort((left, right) => left.id - right.id)),
		disconnectedOrganizations.nextOrganizationId,
		true,
	);
}

function createModuleReconciliationIndex(map: TileMap): ModuleReconciliationIndex {
	const ownership = buildRailModuleOwnershipIndex(map);
	const moduleIndicesByEdge = new Map<string, number[]>();
	const moduleIndicesBySwitch = new Map<number, number[]>();
	for (let index = 0; index < ownership.modules.length; index += 1) {
		const module = ownership.modules[index];
		if (!module) continue;
		for (const edge of module.eraseEdges) {
			appendIndex(moduleIndicesByEdge, staticFabOrganizationEdgeKey(edge), index);
		}
		if (module.advancedSwitchId !== null) {
			appendIndex(moduleIndicesBySwitch, module.advancedSwitchId, index);
		}
	}
	return Object.freeze({ ownership, moduleIndicesByEdge, moduleIndicesBySwitch });
}

function rematerializeMembership(
	membership: StaticFabOrganizationMembership,
	index: ModuleReconciliationIndex,
	removedEdgeKeys: ReadonlySet<string>,
	removedSwitchIds: ReadonlySet<number>,
	removedEquipmentGroupIds: ReadonlySet<number>,
	excludedModuleIndices: ReadonlySet<number> = new Set<number>(),
): Readonly<{
	membership: StaticFabOrganizationMembership;
	moduleIndices: ReadonlySet<number>;
}> {
	const moduleIndices = new Set<number>();
	for (const edge of membership.railEdges) {
		const key = staticFabOrganizationEdgeKey(edge);
		const candidates = index.moduleIndicesByEdge.get(key);
		if (!candidates) {
			if (removedEdgeKeys.has(key)) continue;
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`유지할 조직 edge ${key}을 prospective module에서 찾을 수 없습니다`,
			);
		}
		for (const moduleIndex of candidates) {
			if (!excludedModuleIndices.has(moduleIndex)) moduleIndices.add(moduleIndex);
		}
	}
	for (const switchId of membership.advancedSwitchIds) {
		const candidates = index.moduleIndicesBySwitch.get(switchId);
		if (!candidates) {
			if (removedSwitchIds.has(switchId)) continue;
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`유지할 고급 스위치 ${switchId}을 prospective module에서 찾을 수 없습니다`,
			);
		}
		for (const moduleIndex of candidates) {
			if (!excludedModuleIndices.has(moduleIndex)) moduleIndices.add(moduleIndex);
		}
	}
	const edges = new Map<string, DirectedRailEdge>();
	const switches = new Set<number>();
	for (const moduleIndex of moduleIndices) {
		const module = index.ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switches.add(module.advancedSwitchId);
	}
	return Object.freeze({
		moduleIndices,
		membership: Object.freeze({
			railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
			advancedSwitchIds: Object.freeze([...switches].sort((left, right) => left - right)),
			equipmentGroupIds: Object.freeze(
				membership.equipmentGroupIds.filter((id) => !removedEquipmentGroupIds.has(id)),
			),
		}),
	});
}

function exactModuleIndicesForMembership(
	ownership: RailModuleOwnershipIndex,
	membership: StaticFabOrganizationMembership,
): readonly number[] {
	const targetEdges = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const targetSwitches = new Set(membership.advancedSwitchIds);
	const indices: number[] = [];
	const resolvedEdges = new Set<string>();
	const resolvedSwitches = new Set<number>();
	for (let index = 0; index < ownership.modules.length; index += 1) {
		const module = ownership.modules[index];
		if (!module) continue;
		const touches =
			module.eraseEdges.some((edge) => targetEdges.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && targetSwitches.has(module.advancedSwitchId));
		if (!touches) continue;
		if (
			module.eraseEdges.some((edge) => !targetEdges.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && !targetSwitches.has(module.advancedSwitchId))
		) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`Bay effective membership이 module ${module.key} 전체를 포함하지 않습니다`,
			);
		}
		indices.push(index);
		for (const edge of module.eraseEdges) resolvedEdges.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) resolvedSwitches.add(module.advancedSwitchId);
	}
	if (!setEquals(targetEdges, resolvedEdges) || !setEquals(targetSwitches, resolvedSwitches)) {
		throw new PlanningFailure(
			"ORGANIZATION_INVALID",
			"Bay effective membership을 exact module union으로 복원할 수 없습니다",
		);
	}
	return Object.freeze(indices);
}

function moduleEdges(
	ownership: RailModuleOwnershipIndex,
	indices: readonly number[],
): readonly DirectedRailEdge[] {
	return uniqueEdges(indices.flatMap((index) => ownership.modules[index]?.eraseEdges ?? []));
}

function moduleSwitchIds(
	ownership: RailModuleOwnershipIndex,
	indices: readonly number[],
): readonly number[] {
	return Object.freeze(
		[
			...new Set(
				indices
					.map((index) => ownership.modules[index]?.advancedSwitchId ?? null)
					.filter((id): id is number => id !== null),
			),
		].sort((left, right) => left - right),
	);
}

/**
 * Advanced-switch module bulldoze intentionally preserves its four external seams. A semantic Bay
 * Delete may remove a seam only when the exact neighboring module is in the same Bay delete set.
 * Connector edges already cut during Disconnect remain separately authorized and are never added
 * here a second time.
 */
function exactDeletedAdvancedSwitchBoundaryEdges(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	deleteModuleIndices: readonly number[],
	deleteSwitchIds: readonly number[],
	separatelyRemovedConnectorEdges: readonly DirectedRailEdge[],
): readonly DirectedRailEdge[] {
	if (deleteSwitchIds.length === 0) return Object.freeze([]);
	const separatelyRemovedKeys = new Set(
		separatelyRemovedConnectorEdges.map(staticFabOrganizationEdgeKey),
	);
	type PendingBoundary = {
		readonly switchId: number;
		readonly edge: DirectedRailEdge;
		readonly edgeKey: string;
		readonly neighborModuleIndices: number[];
	};
	const targetBoundariesByX = new Map<number, Map<number, Map<number, PendingBoundary[]>>>();
	const targetBoundaries = (
		role: "input" | "output",
		cell: Cell,
		direction: Direction,
		create: boolean,
	): PendingBoundary[] | null => {
		let byY = targetBoundariesByX.get(cell.x);
		if (!byY) {
			if (!create) return null;
			byY = new Map();
			targetBoundariesByX.set(cell.x, byY);
		}
		let byRoleDirection = byY.get(cell.y);
		if (!byRoleDirection) {
			if (!create) return null;
			byRoleDirection = new Map();
			byY.set(cell.y, byRoleDirection);
		}
		const roleDirection = railModuleBoundaryRoleDirection(role, direction);
		let boundaries = byRoleDirection.get(roleDirection);
		if (!boundaries && create) {
			boundaries = [];
			byRoleDirection.set(roleDirection, boundaries);
		}
		return boundaries ?? null;
	};
	const pendingBoundaries: PendingBoundary[] = [];
	for (const switchId of deleteSwitchIds) {
		const record = map.getAdvancedSwitch(switchId);
		if (!record) {
			throw new PlanningFailure(
				"MUTATION_INVALID",
				`삭제할 고급 스위치 ${switchId}의 경계 정보를 찾을 수 없습니다`,
			);
		}
		for (const boundary of deriveAdvancedSwitchGeometry(record).ports) {
			const externalCell = moveCell(boundary.cell, boundary.direction);
			const edge = Object.freeze(
				boundary.role === "input"
					? {
							from: Object.freeze(externalCell),
							to: Object.freeze({ x: boundary.cell.x, y: boundary.cell.y }),
						}
					: {
							from: Object.freeze({ x: boundary.cell.x, y: boundary.cell.y }),
							to: Object.freeze(externalCell),
						},
			);
			const edgeKey = staticFabOrganizationEdgeKey(edge);
			if (separatelyRemovedKeys.has(edgeKey)) continue;
			const liveEdges =
				boundary.role === "input"
					? incomingEdges(map, boundary.cell)
					: outgoingEdges(map, boundary.cell);
			if (!liveEdges.some((candidate) => staticFabOrganizationEdgeKey(candidate) === edgeKey)) {
				throw new PlanningFailure(
					"MUTATION_INVALID",
					`고급 스위치 ${switchId}의 경계 edge ${edgeKey}이 현재 레일과 일치하지 않습니다`,
				);
			}
			const neighborRole = boundary.role === "input" ? "output" : "input";
			const neighborDirection = oppositeDirection(boundary.direction);
			const matchingBoundaries = targetBoundaries(
				neighborRole,
				externalCell,
				neighborDirection,
				true,
			);
			if (!matchingBoundaries) throw new Error("Failed to allocate boundary target index.");
			const neighborModuleIndices: number[] = [];
			const pending: PendingBoundary = Object.freeze({
				switchId,
				edge,
				edgeKey,
				neighborModuleIndices,
			});
			matchingBoundaries.push(pending);
			pendingBoundaries.push(pending);
		}
	}
	for (let moduleIndex = 0; moduleIndex < ownership.modules.length; moduleIndex += 1) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const boundary of module.boundaries) {
			const matchingBoundaries = targetBoundaries(
				boundary.role,
				boundary.cell,
				boundary.direction,
				false,
			);
			if (!matchingBoundaries) continue;
			for (const pending of matchingBoundaries) {
				if (
					module.advancedSwitchId !== pending.switchId &&
					pending.neighborModuleIndices.length < 2
				) {
					pending.neighborModuleIndices.push(moduleIndex);
				}
			}
		}
	}
	const boundaryEdges: DirectedRailEdge[] = [];
	for (const pending of pendingBoundaries) {
		const neighborModuleIndices = pending.neighborModuleIndices;
		if (neighborModuleIndices.length !== 1) {
			throw new PlanningFailure(
				neighborModuleIndices.length === 0
					? "ORGANIZATION_INVALID"
					: "SHARED_ORGANIZATION_DEPENDENCY",
				`고급 스위치 ${pending.switchId}의 경계 edge ${pending.edgeKey}에 exact 이웃 module 하나가 필요합니다`,
			);
		}
		const neighborModuleIndex = neighborModuleIndices[0];
		if (
			neighborModuleIndex === undefined ||
			!sortedNumberArrayIncludes(deleteModuleIndices, neighborModuleIndex)
		) {
			throw new PlanningFailure(
				"SHARED_ORGANIZATION_DEPENDENCY",
				`고급 스위치 ${pending.switchId}의 경계 edge ${pending.edgeKey}이 유지할 외부 module과 연결됩니다`,
			);
		}
		boundaryEdges.push(pending.edge);
	}
	return uniqueEdges(boundaryEdges);
}

function railModuleBoundaryRoleDirection(role: "input" | "output", direction: Direction): number {
	return direction | (role === "output" ? 0x10 : 0);
}

function sortedNumberArrayIncludes(values: readonly number[], target: number): boolean {
	let low = 0;
	let high = values.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const value = values[middle] as number;
		if (value === target) return true;
		if (value < target) low = middle + 1;
		else high = middle - 1;
	}
	return false;
}

function resolveEquipmentRemoval(
	prospectiveMap: TileMap,
	state: PortEquipmentState,
	expectedGroupIds: readonly number[],
	organizations: StaticFabOrganizationState,
	subtreeIds: ReadonlySet<number>,
): EquipmentRemoval {
	const portsById = new Map(state.ports.map((port) => [port.id, port]));
	const invalidatedPortIds = new Set(
		portsInvalidatedInMap(prospectiveMap, state).map((port) => port.id),
	);
	const groupIds: number[] = [];
	const ports: PortRecord[] = [];
	for (const group of state.equipmentGroups) {
		const groupPorts = group.portIds.map((id) => portsById.get(id)).filter(isDefined);
		if (groupPorts.length !== group.portIds.length) {
			throw new PlanningFailure(
				"INVALID_SOURCE",
				`장비 그룹 ${group.id}의 포트 레코드가 완전하지 않습니다`,
			);
		}
		const invalidated = groupPorts.filter((port) => invalidatedPortIds.has(port.id));
		if (invalidated.length === 0) continue;
		if (invalidated.length !== groupPorts.length) {
			throw new PlanningFailure(
				"PARTIAL_EQUIPMENT_GROUP",
				`장비 그룹 ${group.id}이 삭제할 Bay와 유지할 레일에 걸쳐 있습니다`,
			);
		}
		if (group.kind === "STK" && group.template === "CUSTOM") {
			throw new PlanningFailure(
				"LEGACY_CUSTOM_EQUIPMENT",
				`legacy CUSTOM STK 그룹 ${group.id}은 semantic Bay Delete에서 제거할 수 없습니다`,
			);
		}
		for (const record of organizations.records) {
			if (!subtreeIds.has(record.id) && record.membership.equipmentGroupIds.includes(group.id)) {
				throw new PlanningFailure(
					"SHARED_ORGANIZATION_DEPENDENCY",
					`장비 그룹 ${group.id}이 유지할 조직 '${record.name}'과 공유됩니다`,
				);
			}
		}
		groupIds.push(group.id);
		ports.push(...groupPorts);
	}
	for (const expectedGroupId of expectedGroupIds) {
		if (!groupIds.includes(expectedGroupId)) {
			throw new PlanningFailure(
				"SHARED_ORGANIZATION_DEPENDENCY",
				`Bay 소유 장비 그룹 ${expectedGroupId}의 포트 route가 삭제 범위와 일치하지 않습니다`,
			);
		}
	}
	groupIds.sort((left, right) => left - right);
	ports.sort((left, right) => left.id - right.id);
	return Object.freeze({
		groupIds: Object.freeze(groupIds),
		ports: Object.freeze(ports.map(copyPortRecord)),
		portMutations: Object.freeze(
			ports.map((port) =>
				Object.freeze({ id: port.id, before: copyPortRecord(port), after: null }),
			),
		),
		equipmentGroupMutations: Object.freeze(
			groupIds.map((id) => {
				const group = state.equipmentGroups.find((candidate) => candidate.id === id);
				if (!group) throw new Error(`장비 그룹 ${id}을 찾을 수 없습니다`);
				return Object.freeze({
					id,
					before: copyEquipmentGroupRecord(group),
					after: null,
				});
			}),
		),
	});
}

function portsForGroupIds(
	state: PortEquipmentState,
	groupIds: readonly number[],
): readonly PortRecord[] {
	const requested = new Set(groupIds);
	const portsById = new Map(state.ports.map((port) => [port.id, port]));
	const ports: PortRecord[] = [];
	for (const group of state.equipmentGroups) {
		if (!requested.has(group.id)) continue;
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (!port) {
				throw new PlanningFailure(
					"INVALID_SOURCE",
					`장비 그룹 ${group.id}의 PORT-${portId}를 찾을 수 없습니다`,
				);
			}
			ports.push(port);
		}
	}
	return Object.freeze(ports.sort((left, right) => left.id - right.id).map(copyPortRecord));
}

function summarizeDependentPortIds(ports: readonly PortRecord[]): string {
	const sortedIds = ports.map((port) => port.id).sort((left, right) => left - right);
	const previewIds = sortedIds.slice(0, STATIC_FAB_SEMANTIC_BAY_DIAGNOSTIC_PORT_PREVIEW_LIMIT);
	const preview = previewIds.map((id) => `PORT-${id}`).join(", ");
	const remainingCount = sortedIds.length - previewIds.length;
	return remainingCount === 0
		? preview
		: `${preview} · 나머지 ${remainingCount}개 (총 ${sortedIds.length}개)`;
}

/**
 * Format a deterministic, bounded owner preview for fail-closed planning diagnostics. The caller
 * supplies exact owner identities; this function never mutates or truncates that source array.
 */
export function summarizeStaticFabSemanticBayOrganizationOwnerIds(
	ownerIds: readonly number[],
): string {
	const sortedIds = [...ownerIds].sort((left, right) => left - right);
	const previewIds = sortedIds.slice(
		0,
		STATIC_FAB_SEMANTIC_BAY_DIAGNOSTIC_ORGANIZATION_PREVIEW_LIMIT,
	);
	const preview = previewIds.join(", ");
	const remainingCount = sortedIds.length - previewIds.length;
	return remainingCount === 0
		? preview
		: `${preview} · 나머지 ${remainingCount}개 (총 ${sortedIds.length}개)`;
}

function portsInvalidatedInMap(
	prospectiveMap: TileMap,
	state: PortEquipmentState,
): readonly PortRecord[] {
	return Object.freeze(
		state.ports.filter((port) => {
			if (port.route.kind === "ADVANCED_SWITCH_SEGMENT") {
				const record = prospectiveMap.getAdvancedSwitch(port.route.switchId);
				return !record || record.profileClass !== port.route.profileClass;
			}
			const rail = prospectiveMap.getRail(port.route.x, port.route.z);
			if (port.route.from === 0) {
				return !(rail.incoming === 0 && rail.outgoing === port.route.to);
			}
			if (port.route.to === 0) {
				return !(rail.outgoing === 0 && rail.incoming === port.route.from);
			}
			return (rail.incoming & port.route.from) === 0 || (rail.outgoing & port.route.to) === 0;
		}),
	);
}

function assertNoSharedConnectorOwnership(
	organizations: StaticFabOrganizationState,
	source: SemanticBaySource,
	connector: IncidentConnector | null,
): void {
	if (!connector || !source.bank) return;
	const connectorKeys = new Set(connector.edges.map(staticFabOrganizationEdgeKey));
	for (const record of organizations.records) {
		if (record.id === source.bank.id) continue;
		if (
			record.membership.railEdges.some((edge) =>
				connectorKeys.has(staticFabOrganizationEdgeKey(edge)),
			)
		) {
			throw new PlanningFailure(
				"SHARED_CONNECTOR_OWNERSHIP",
				`Bay connector가 유지할 조직 '${record.name}'과 공유됩니다`,
			);
		}
	}
}

function assertNoSharedSourceBankBayContentOwnership(
	source: SemanticBaySource,
	effectiveMembership: StaticFabOrganizationMembership,
): void {
	if (!source.bank) return;
	const bayEdgeKeys = new Set(effectiveMembership.railEdges.map(staticFabOrganizationEdgeKey));
	const baySwitchIds = new Set(effectiveMembership.advancedSwitchIds);
	const sharedRailEdge = source.bank.membership.railEdges.some((edge) =>
		bayEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
	);
	const sharedAdvancedSwitch = source.bank.membership.advancedSwitchIds.some((switchId) =>
		baySwitchIds.has(switchId),
	);
	if (sharedRailEdge || sharedAdvancedSwitch) {
		throw new PlanningFailure(
			"SHARED_ORGANIZATION_DEPENDENCY",
			`Bank '${source.bank.name}'이 Bay subtree의 명시적 rail 또는 advanced switch content를 함께 소유합니다`,
		);
	}
}

function assertNoSharedBayContentOwnership(
	organizations: StaticFabOrganizationState,
	subtreeIds: ReadonlySet<number>,
	deleteEdges: readonly DirectedRailEdge[],
	deleteSwitchIds: readonly number[],
): void {
	const edgeKeys = new Set(deleteEdges.map(staticFabOrganizationEdgeKey));
	const switchIds = new Set(deleteSwitchIds);
	for (const record of organizations.records) {
		if (subtreeIds.has(record.id)) continue;
		if (
			record.membership.railEdges.some((edge) =>
				edgeKeys.has(staticFabOrganizationEdgeKey(edge)),
			) ||
			record.membership.advancedSwitchIds.some((id) => switchIds.has(id))
		) {
			throw new PlanningFailure(
				"SHARED_ORGANIZATION_DEPENDENCY",
				`Bay content가 유지할 조직 '${record.name}'과 공유됩니다`,
			);
		}
	}
}

function planDirectedEdgeRemoval(
	map: TileMap,
	edges: readonly DirectedRailEdge[],
	switchIds: readonly number[],
): Readonly<{
	mutations: readonly RailMutation[];
	switchMutations: readonly AdvancedSwitchMutation[];
}> {
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
	for (const edge of uniqueEdges(edges)) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) {
			throw new PlanningFailure("MUTATION_INVALID", "삭제할 directed edge가 인접하지 않습니다");
		}
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		if ((from.outgoing & direction) === 0 || (to.incoming & opposite) === 0) {
			throw new PlanningFailure(
				"MUTATION_INVALID",
				`삭제할 edge ${staticFabOrganizationEdgeKey(edge)}이 현재 레일과 일치하지 않습니다`,
			);
		}
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
	}
	const switchMutations = Object.freeze(
		switchIds.map((id) => {
			const before = map.getAdvancedSwitch(id);
			if (!before) {
				throw new PlanningFailure(
					"MUTATION_INVALID",
					`삭제할 고급 스위치 ${id}을 찾을 수 없습니다`,
				);
			}
			return Object.freeze({ id, before: copyAdvancedSwitch(before), after: null });
		}),
	);
	const mutations = Object.freeze(
		[...overlay.values()]
			.filter((mutation) => mutation.before !== mutation.after)
			.sort((left, right) => left.y - right.y || left.x - right.x)
			.map((mutation) => Object.freeze(mutation)),
	);
	const topologyError = railMutationTopologyError(map, mutations, switchMutations);
	if (topologyError) throw new PlanningFailure("MUTATION_INVALID", topologyError);
	return Object.freeze({ mutations, switchMutations });
}

/**
 * Derive the narrow relocation authority required when an exact membership mutation already
 * accounts for every protected authored item but the cell-level impact index remains conservative.
 * Shared by source-recognized semantic commands; callers must still certify their own scope.
 */
export function exactStaticFabOrganizationImpactAuthorizations(
	organizations: StaticFabOrganizationState,
	organizationMutations: readonly StaticFabOrganizationMutation[],
	mutations: readonly RailMutation[],
	switchMutations: readonly AdvancedSwitchMutation[],
	portMutations: readonly PortMutation[],
	equipmentGroupMutations: readonly EquipmentGroupMutation[],
	beforeEquipment: PortEquipmentState,
	afterEquipment: PortEquipmentState,
): readonly number[] {
	const index = new StaticFabOrganizationImpactIndex();
	index.synchronize(organizations);
	const impacts = staticFabOrganizationImpactsForPatch(
		index,
		mutations,
		switchMutations,
		portMutations,
		equipmentGroupMutations,
		beforeEquipment,
		afterEquipment,
	);
	const unhandled = unhandledStaticFabOrganizationImpacts(
		index,
		impacts,
		organizationMutations,
		mutations,
		switchMutations,
		portMutations,
		equipmentGroupMutations,
		beforeEquipment,
		afterEquipment,
	);
	if (unhandled.length === 0) return Object.freeze([]);
	const changedEdges = changedDirectedEdges(mutations);
	const changedSwitchIds = new Set(switchMutations.map((mutation) => mutation.id));
	const changedGroupIds = changedEquipmentGroupIds(
		portMutations,
		equipmentGroupMutations,
		beforeEquipment,
		afterEquipment,
	);
	const organizationMutationsById = new Map(
		organizationMutations.map((mutation) => [mutation.id, mutation] as const),
	);
	const authorizations: number[] = [];
	for (const owner of unhandled) {
		const before = organizations.records.find((record) => record.id === owner.organizationId);
		if (!before) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`조직 impact ${owner.organizationId}의 source record를 찾을 수 없습니다`,
			);
		}
		const organizationMutation = organizationMutationsById.get(owner.organizationId);
		if (
			!exactOrganizationChangesAreHandled(
				before,
				organizationMutation,
				changedEdges,
				changedSwitchIds,
				changedGroupIds,
			)
		) {
			throw new PlanningFailure(
				"ORGANIZATION_INVALID",
				`조직 '${before.name}'의 exact 소유 변경이 membership mutation으로 처리되지 않았습니다`,
			);
		}
		// At this point every exact source item is handled. The remaining unhandled impact is the
		// impact index's cell-level junction approximation, so only this retained owner receives a
		// narrow relocation authorization. Deleted owners never reach this branch and therefore undo
		// never carries an authorization for an organization absent from the current index.
		authorizations.push(owner.organizationId);
	}
	return Object.freeze(authorizations.sort((left, right) => left - right));
}

function exactOrganizationChangesAreHandled(
	before: StaticFabOrganizationRecord,
	mutation: StaticFabOrganizationMutation | undefined,
	changedEdges: readonly DirectedRailEdge[],
	changedSwitchIds: ReadonlySet<number>,
	changedGroupIds: ReadonlySet<number>,
): boolean {
	const afterMembership = mutation?.after?.membership ?? before.membership;
	const beforeEdgeKeys = new Set(before.membership.railEdges.map(staticFabOrganizationEdgeKey));
	const afterEdgeKeys = new Set(afterMembership.railEdges.map(staticFabOrganizationEdgeKey));
	for (const edge of changedEdges) {
		const key = staticFabOrganizationEdgeKey(edge);
		const beforeIncludes = beforeEdgeKeys.has(key);
		const afterIncludes = afterEdgeKeys.has(key);
		if ((beforeIncludes || afterIncludes) && beforeIncludes === afterIncludes) return false;
	}
	for (const switchId of changedSwitchIds) {
		const beforeIncludes = before.membership.advancedSwitchIds.includes(switchId);
		const afterIncludes = afterMembership.advancedSwitchIds.includes(switchId);
		if ((beforeIncludes || afterIncludes) && beforeIncludes === afterIncludes) return false;
	}
	for (const groupId of changedGroupIds) {
		const beforeIncludes = before.membership.equipmentGroupIds.includes(groupId);
		const afterIncludes = afterMembership.equipmentGroupIds.includes(groupId);
		if ((beforeIncludes || afterIncludes) && beforeIncludes === afterIncludes) return false;
	}
	return true;
}

function changedDirectedEdges(mutations: readonly RailMutation[]): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const mutation of mutations) {
		const before = decodeRailCell(mutation.before);
		const after = decodeRailCell(mutation.after);
		for (const direction of ALL_DIRECTIONS) {
			if (((before.outgoing ^ after.outgoing) & direction) !== 0) {
				const edge = Object.freeze({
					from: Object.freeze({ x: mutation.x, y: mutation.y }),
					to: Object.freeze(moveCell(mutation, direction)),
				});
				edges.set(staticFabOrganizationEdgeKey(edge), edge);
			}
			if (((before.incoming ^ after.incoming) & direction) !== 0) {
				const edge = Object.freeze({
					from: Object.freeze(moveCell(mutation, direction)),
					to: Object.freeze({ x: mutation.x, y: mutation.y }),
				});
				edges.set(staticFabOrganizationEdgeKey(edge), edge);
			}
		}
	}
	return Object.freeze([...edges.values()].sort(compareDirectedRailEdges));
}

function changedEquipmentGroupIds(
	portMutations: readonly PortMutation[],
	equipmentGroupMutations: readonly EquipmentGroupMutation[],
	beforeEquipment: PortEquipmentState,
	afterEquipment: PortEquipmentState,
): ReadonlySet<number> {
	const ids = new Set(equipmentGroupMutations.map((mutation) => mutation.id));
	const portIds = new Set(portMutations.map((mutation) => mutation.id));
	if (portIds.size === 0) return ids;
	for (const state of [beforeEquipment, afterEquipment]) {
		for (const group of state.equipmentGroups) {
			if (group.portIds.some((portId) => portIds.has(portId))) ids.add(group.id);
		}
	}
	return ids;
}

function createReview(
	intent: StaticFabSemanticBayMutationIntent,
	source: SemanticBaySource,
	ownership: RailModuleOwnershipIndex,
	prospectiveOrganizations: StaticFabOrganizationState,
	connector: IncidentConnector | null,
	effectiveMembership: StaticFabOrganizationMembership,
	deleteModuleIndices: readonly number[],
	equipmentGroupIds: readonly number[],
	ports: readonly PortRecord[],
): StaticFabSemanticBayMutationReview {
	const bank = source.bank
		? prospectiveOrganizations.records.find((record) => record.id === source.bank?.id)
		: null;
	const exactModuleIndices =
		deleteModuleIndices.length > 0
			? deleteModuleIndices
			: exactModuleIndicesForMembership(ownership, effectiveMembership);
	const railModuleKeys = exactModuleIndices
		.map((moduleIndex) => ownership.modules[moduleIndex]?.key)
		.filter((key): key is string => key !== undefined)
		.sort();
	const groupIds = [...new Set(equipmentGroupIds)].sort((left, right) => left - right);
	const portIds = [...new Set(ports.map((port) => port.id))].sort((left, right) => left - right);
	const retainedCirculationCandidatePresent = Boolean(
		bank &&
			(bank.membership.railEdges.length > 0 ||
				bank.membership.advancedSwitchIds.length > 0 ||
				bank.membership.equipmentGroupIds.length > 0),
	);
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action: intent.action,
		bayOrganizationId: source.bay.id,
		bayName: source.bay.name,
		bankOrganizationId: source.bank?.id ?? null,
		removedOrganizationIds:
			intent.action === "DELETE"
				? Object.freeze([...source.subtreeIds].sort((left, right) => left - right))
				: Object.freeze([]),
		processLoopOrganizationIds: source.processLoopOrganizationIds,
		processLoopCount: source.processLoopCount,
		railModuleCount: exactModuleIndices.length,
		railModuleKeys: Object.freeze(railModuleKeys),
		bayDirectedEdgeCount: effectiveMembership.railEdges.length,
		incidentConnectorCount: connector ? 1 : 0,
		connectorDirectedEdgeCount: connector?.edges.length ?? 0,
		connectorOutboundDirectedEdgeKeys: Object.freeze(
			(connector?.outboundEdges ?? []).map(staticFabOrganizationEdgeKey),
		),
		connectorReturnDirectedEdgeKeys: Object.freeze(
			(connector?.inboundEdges ?? []).map(staticFabOrganizationEdgeKey),
		),
		advancedSwitchCount: effectiveMembership.advancedSwitchIds.length,
		equipmentGroupCount: groupIds.length,
		equipmentGroupIds: Object.freeze(groupIds),
		portCount: ports.length,
		portIds: Object.freeze(portIds),
		remainingBankDirectedEdgeCount: bank?.membership.railEdges.length ?? 0,
		retainedCirculationCandidatePresent,
		circulationCertification: "PENDING_WORKER_CERTIFICATION",
		issueCode: null,
	});
}

function validPlan(
	intent: StaticFabSemanticBayMutationIntent,
	map: TileMap,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	mutations: readonly RailMutation[],
	switchMutations: readonly AdvancedSwitchMutation[],
	portMutations: readonly PortMutation[],
	equipmentGroupMutations: readonly EquipmentGroupMutation[],
	organizationMutations: readonly StaticFabOrganizationMutation[],
	organizationImpactAuthorizations: readonly number[],
	review: StaticFabSemanticBayMutationReview,
	reason: string,
): StaticFabSemanticBayMutationPlan {
	if (mutations.length === 0 && switchMutations.length === 0) {
		throw new PlanningFailure("MUTATION_INVALID", "Semantic Bay 명령의 레일 변경이 비어 있습니다");
	}
	if (organizationMutations.length === 0) {
		throw new PlanningFailure("ORGANIZATION_INVALID", "Semantic Bay 조직 변경이 비어 있습니다");
	}
	return Object.freeze({
		kind:
			intent.action === "DELETE"
				? STATIC_FAB_SEMANTIC_BAY_DELETE_KIND
				: STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
		baseRevision: map.getRevision(),
		basePatchSequence,
		mutations: Object.freeze([...mutations]),
		switchMutations: Object.freeze([...switchMutations]),
		portMutations: Object.freeze([...portMutations]),
		equipmentGroupMutations: Object.freeze([...equipmentGroupMutations]),
		organizationMutations: Object.freeze([...organizationMutations]),
		organizationImpactAuthorizations: Object.freeze([...organizationImpactAuthorizations]),
		nextOrganizationIdBefore: organizations.nextOrganizationId,
		nextOrganizationIdAfter: organizations.nextOrganizationId,
		valid: true,
		reason,
		issueCode: null,
		review,
	});
}

function rejected(
	map: TileMap,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabSemanticBayMutationIntent,
	issueCode: StaticFabSemanticBayMutationIssueCode,
	reason: string,
	source: SemanticBaySource | null = null,
): StaticFabSemanticBayMutationPlanningResult {
	const bay =
		source?.bay ?? organizations.records.find((record) => record.id === intent.bayOrganizationId);
	const review = Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action: intent.action,
		bayOrganizationId: intent.bayOrganizationId,
		bayName: bay?.name ?? "Unknown Bay",
		bankOrganizationId: source?.bank?.id ?? null,
		removedOrganizationIds: Object.freeze([]),
		processLoopOrganizationIds: Object.freeze([]),
		processLoopCount: 0,
		railModuleCount: 0,
		railModuleKeys: Object.freeze([]),
		bayDirectedEdgeCount: 0,
		incidentConnectorCount: 0 as const,
		connectorDirectedEdgeCount: 0,
		connectorOutboundDirectedEdgeKeys: Object.freeze([]),
		connectorReturnDirectedEdgeKeys: Object.freeze([]),
		advancedSwitchCount: 0,
		equipmentGroupCount: 0,
		equipmentGroupIds: Object.freeze([]),
		portCount: 0,
		portIds: Object.freeze([]),
		remainingBankDirectedEdgeCount: source?.bank?.membership.railEdges.length ?? 0,
		retainedCirculationCandidatePresent: false,
		circulationCertification: "PENDING_WORKER_CERTIFICATION" as const,
		issueCode,
	}) satisfies StaticFabSemanticBayMutationReview;
	return Object.freeze({
		plan: Object.freeze({
			kind:
				intent.action === "DELETE"
					? STATIC_FAB_SEMANTIC_BAY_DELETE_KIND
					: STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
			baseRevision: map.getRevision(),
			basePatchSequence,
			mutations: Object.freeze([]),
			switchMutations: Object.freeze([]),
			portMutations: Object.freeze([]),
			equipmentGroupMutations: Object.freeze([]),
			organizationMutations: Object.freeze([]),
			organizationImpactAuthorizations: Object.freeze([]),
			nextOrganizationIdBefore: organizations.nextOrganizationId,
			nextOrganizationIdAfter: organizations.nextOrganizationId,
			valid: false,
			reason,
			issueCode,
			review,
		}),
		prospectiveState: null,
	});
}

/** Canonical existing/create/delete record delta between two validated organization generations. */
export function diffStaticFabOrganizations(
	before: StaticFabOrganizationState,
	after: StaticFabOrganizationState,
): readonly StaticFabOrganizationMutation[] {
	const beforeById = new Map(before.records.map((record) => [record.id, record]));
	const afterById = new Map(after.records.map((record) => [record.id, record]));
	const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort(
		(left, right) => left - right,
	);
	return Object.freeze(
		ids.flatMap((id) => {
			const beforeRecord = beforeById.get(id) ?? null;
			const afterRecord = afterById.get(id) ?? null;
			return staticFabOrganizationRecordEquals(beforeRecord, afterRecord)
				? []
				: [Object.freeze({ id, before: beforeRecord, after: afterRecord })];
		}),
	);
}

function outgoingEdges(map: TileMap, cell: Cell): readonly DirectedRailEdge[] {
	const outgoing = map.getRail(cell.x, cell.y).outgoing;
	return Object.freeze(
		ALL_DIRECTIONS.filter((direction) => (outgoing & direction) !== 0).map((direction) =>
			Object.freeze({
				from: Object.freeze({ x: cell.x, y: cell.y }),
				to: Object.freeze(moveCell(cell, direction)),
			}),
		),
	);
}

function incomingEdges(map: TileMap, cell: Cell): readonly DirectedRailEdge[] {
	const incoming = map.getRail(cell.x, cell.y).incoming;
	return Object.freeze(
		ALL_DIRECTIONS.filter((direction) => (incoming & direction) !== 0).map((direction) =>
			Object.freeze({
				from: Object.freeze(moveCell(cell, direction)),
				to: Object.freeze({ x: cell.x, y: cell.y }),
			}),
		),
	);
}

function membershipCells(membership: StaticFabOrganizationMembership): ReadonlyMap<string, Cell> {
	const cells = new Map<string, Cell>();
	for (const edge of membership.railEdges) {
		for (const cell of [edge.from, edge.to]) {
			cells.set(cellKey(cell.x, cell.y), Object.freeze({ x: cell.x, y: cell.y }));
		}
	}
	return cells;
}

function uniqueEdges(edges: readonly DirectedRailEdge[]): readonly DirectedRailEdge[] {
	const byKey = new Map<string, DirectedRailEdge>();
	for (const edge of edges) byKey.set(staticFabOrganizationEdgeKey(edge), edge);
	return Object.freeze([...byKey.values()].sort(compareDirectedRailEdges));
}

function moduleCellKeys(
	ownership: RailModuleOwnershipIndex,
	moduleIndices: ReadonlySet<number>,
): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const moduleIndex of moduleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) {
			keys.add(cellKey(edge.from.x, edge.from.y));
			keys.add(cellKey(edge.to.x, edge.to.y));
		}
	}
	return keys;
}

function appendNeighbor(target: Map<string, Set<string>>, key: string, neighbor: string): void {
	const values = target.get(key);
	if (values) values.add(neighbor);
	else target.set(key, new Set([neighbor]));
}

function appendIndex<Key>(target: Map<Key, number[]>, key: Key, index: number): void {
	const values = target.get(key);
	if (values) values.push(index);
	else target.set(key, [index]);
}

function setEquals<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function isDefined<Value>(value: Value | undefined): value is Value {
	return value !== undefined;
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function safeDiagnosticIntent(value: unknown): StaticFabSemanticBayMutationIntent {
	const record = isRecord(value) ? value : {};
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action: record.action === "DELETE" ? "DELETE" : "DISCONNECT",
		bayOrganizationId: positiveInt32(record.bayOrganizationId) ? record.bayOrganizationId : 1,
	});
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

class PlanningFailure extends Error {
	readonly code: StaticFabSemanticBayMutationIssueCode;

	constructor(code: StaticFabSemanticBayMutationIssueCode, message: string) {
		super(message);
		this.name = "StaticFabSemanticBayPlanningFailure";
		this.code = code;
	}
}

function planningFailure(error: unknown): PlanningFailure {
	return error instanceof PlanningFailure
		? error
		: new PlanningFailure(
				"MUTATION_INVALID",
				error instanceof Error && error.message
					? error.message
					: "Semantic Bay mutation planning failed",
			);
}
