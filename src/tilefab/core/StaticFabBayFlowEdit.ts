import type { AdvancedSwitchMutation } from "./AdvancedSwitch";
import type { EquipmentGroupMutation, PortEquipmentState } from "./EquipmentGroup";
import { assertPortEquipmentLayout } from "./PortEquipmentLayoutValidator";
import type { PortMutation } from "./PortRecord";
import {
	type ProductionBayBuildStepOwner,
	type ProductionBayInternalFlowPattern,
	type ProductionBayModulePlan,
	type ProductionBayModuleRequest,
	planProductionBayModule,
} from "./ProductionBayModulePlanner";
import {
	type ProductionBayModuleRecognition,
	recognizeProductionBayModule,
} from "./ProductionBayModuleRecognition";
import { type RailMutation, railMutationTopologyError } from "./paint";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell, oppositeDirection } from "./railShape";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	deriveStaticFabOrganizationSemanticRoles,
	replaceStaticFabOrganizationRecordMembership,
	resolveStaticFabOrganizationCoverage,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationRecordEquals,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	diffStaticFabOrganizations,
	exactStaticFabOrganizationImpactAuthorizations,
	planStaticFabSemanticBayMutationWithProspectiveState,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
} from "./StaticFabSemanticBayMutation";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, TileMap } from "./TileMap";

export const STATIC_FAB_BAY_FLOW_EDIT_VERSION = 1 as const;
export const STATIC_FAB_BAY_FLOW_EDIT_KIND = "edit-static-fab-bay-flow" as const;

export type StaticFabBayFlowEditIssueCode =
	| "INVALID_INTENT"
	| "STALE_SOURCE"
	| "INVALID_SOURCE"
	| "UNSUPPORTED_HIERARCHY"
	| "SOURCE_NOT_RECOGNIZED"
	| "TARGET_NOOP"
	| "UNSUPPORTED_DEPENDENCY"
	| "MUTATION_INVALID"
	| "ORGANIZATION_INVALID"
	| "EXTERNAL_GATEWAY_CHANGED"
	| "TARGET_NOT_RECOGNIZED";

export interface StaticFabBayFlowEditIntent {
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_VERSION;
	readonly bayOrganizationId: number;
	readonly targetInternalFlowPattern: ProductionBayInternalFlowPattern;
}

export interface StaticFabBayFlowEditReview {
	readonly version: typeof STATIC_FAB_BAY_FLOW_EDIT_VERSION;
	readonly bayOrganizationId: number;
	readonly bayName: string;
	readonly bankOrganizationId: number | null;
	readonly processLoopOrganizationIds: readonly [number, number];
	readonly sourceInternalFlowPattern: ProductionBayInternalFlowPattern | null;
	readonly targetInternalFlowPattern: ProductionBayInternalFlowPattern;
	readonly sourceAuthoredProjectionFingerprint: string;
	readonly targetAuthoredProjectionFingerprint: string;
	readonly sourceSpecificationAliasCount: number;
	readonly sourceDirectedEdgeCount: number;
	readonly targetDirectedEdgeCount: number;
	readonly removedDirectedEdgeCount: number;
	readonly addedDirectedEdgeCount: number;
	readonly changedCellCount: number;
	readonly changedOrganizationIds: readonly number[];
	readonly incidentConnectorCount: 0 | 1;
	readonly connectorBankToBayDirectedEdgeKeys: readonly string[];
	readonly connectorBayToBankDirectedEdgeKeys: readonly string[];
	readonly shellCertification: "PENDING_WORKER_CERTIFICATION";
	readonly externalGatewayCertification: "PENDING_WORKER_CERTIFICATION";
	readonly topologyCertification: "PENDING_WORKER_CERTIFICATION";
	readonly issueCode: StaticFabBayFlowEditIssueCode | null;
}

export interface StaticFabBayFlowEditPlan {
	readonly kind: typeof STATIC_FAB_BAY_FLOW_EDIT_KIND;
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
	readonly issueCode: StaticFabBayFlowEditIssueCode | null;
	readonly review: StaticFabBayFlowEditReview;
}

export interface StaticFabBayFlowEditProspectiveState {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface StaticFabBayFlowEditPlanningResult {
	readonly plan: StaticFabBayFlowEditPlan;
	readonly prospectiveState: StaticFabBayFlowEditProspectiveState | null;
}

export type StaticFabBayFlowEditHierarchyEligibility = Readonly<
	| {
			valid: true;
			issueCode: null;
			reason: string;
	  }
	| {
			valid: false;
			issueCode: "UNSUPPORTED_HIERARCHY";
			reason: string;
	  }
>;

export type StaticFabBayFlowEditProjectionSide = "source" | "target";

interface NormalizedBaySource {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly bay: StaticFabOrganizationRecord;
	readonly bank: StaticFabOrganizationRecord | null;
	readonly incidentConnectorCount: 0 | 1;
	readonly connectorBankToBayDirectedEdgeKeys: readonly string[];
	readonly connectorBayToBankDirectedEdgeKeys: readonly string[];
}

interface AuthoredProjection {
	readonly edgesByKey: ReadonlyMap<string, DirectedRailEdge>;
	readonly ownerOrganizationIdByEdgeKey: ReadonlyMap<string, number>;
}

const INTENT_KEYS = Object.freeze([
	"version",
	"bayOrganizationId",
	"targetInternalFlowPattern",
] as const);

export function staticFabBayFlowEditIntentError(value: unknown): string | null {
	if (!isRecord(value)) return "Bay flow edit intent must be an object.";
	if (!hasExactKeys(value, INTENT_KEYS)) {
		return "Bay flow edit intent fields do not match version 1.";
	}
	if (value.version !== STATIC_FAB_BAY_FLOW_EDIT_VERSION) {
		return "Bay flow edit intent version is invalid.";
	}
	if (!positiveInt32(value.bayOrganizationId)) {
		return "Bay flow edit organization id is invalid.";
	}
	if (
		value.targetInternalFlowPattern !== "alternating" &&
		value.targetInternalFlowPattern !== "co-rotating"
	) {
		return "Bay flow edit target pattern is invalid.";
	}
	return null;
}

/**
 * Cheap selection-time hierarchy gate for the exact Twin Bay command.
 * Geometry, dependencies, gateway identity, and topology remain Worker-certified.
 */
export function staticFabBayFlowEditHierarchyEligibility(
	organizations: StaticFabOrganizationState,
	bayOrganizationId: number,
): StaticFabBayFlowEditHierarchyEligibility {
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bay = recordsById.get(bayOrganizationId);
	if (!bay || roles.get(bay.id) !== "BAY") {
		return Object.freeze({
			valid: false,
			issueCode: "UNSUPPORTED_HIERARCHY" as const,
			reason: "내부 흐름을 지정할 Production Bay 조직 하나를 선택하세요",
		});
	}

	const parentIds = staticFabOrganizationParentIds(bay);
	const bankParentCount = parentIds.filter((parentId) => roles.get(parentId) === "BAY_BANK").length;
	if (parentIds.length !== bankParentCount || bankParentCount > 1) {
		return Object.freeze({
			valid: false,
			issueCode: "UNSUPPORTED_HIERARCHY" as const,
			reason: "Bay의 direct Bank 계층이 모호해 흐름 명령을 시작할 수 없습니다",
		});
	}

	const directChildren = organizations.records.filter((record) =>
		staticFabOrganizationParentIds(record).includes(bay.id),
	);
	const descendantIds = resolveStaticFabOrganizationDescendantIds(organizations, bay.id);
	const exactTwinProcessLoops =
		directChildren.length === 2 &&
		descendantIds?.length === 2 &&
		directChildren.every(
			(record) =>
				roles.get(record.id) === "PROCESS_LOOP" &&
				staticFabOrganizationParentIds(record).length === 1,
		);
	if (!exactTwinProcessLoops) {
		return Object.freeze({
			valid: false,
			issueCode: "UNSUPPORTED_HIERARCHY" as const,
			reason: "내부 흐름 편집은 direct Process Loop 두 개를 가진 Twin Bay에만 사용할 수 있습니다",
		});
	}

	return Object.freeze({
		valid: true,
		issueCode: null,
		reason: "Twin Bay의 목표 흐름을 Worker에서 정확히 검토할 수 있습니다",
	});
}

/**
 * Revalidate one already-certified Bay flow projection without indexing unrelated FAB rails.
 *
 * The source document was globally valid before the one-shot transition. Bay flow v1 cannot edit
 * hierarchy, metadata, switches, ports, equipment, or the Bank gateway. The document boundary can
 * therefore keep those invariants under its ordinary impact guard and re-run exact module
 * recognition over only the three affected persisted records. For an attached Bay, the immutable
 * gateway evidence is removed from this temporary recognition projection while every gateway edge
 * is still required to exist in the live map.
 */
export function assertStaticFabBayFlowEditAppliedProjection(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	review: StaticFabBayFlowEditReview,
	side: StaticFabBayFlowEditProjectionSide,
): void {
	const expectedPattern =
		side === "source" ? review.sourceInternalFlowPattern : review.targetInternalFlowPattern;
	const expectedFingerprint =
		side === "source"
			? review.sourceAuthoredProjectionFingerprint
			: review.targetAuthoredProjectionFingerprint;
	const expectedDirectedEdgeCount =
		side === "source" ? review.sourceDirectedEdgeCount : review.targetDirectedEdgeCount;
	if (!expectedPattern || !expectedFingerprint || expectedDirectedEdgeCount <= 0) {
		throw new Error(`Bay flow ${side} projection evidence is incomplete.`);
	}

	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const bay = recordsById.get(review.bayOrganizationId);
	const processLoopA = recordsById.get(review.processLoopOrganizationIds[0]);
	const processLoopB = recordsById.get(review.processLoopOrganizationIds[1]);
	if (!bay || !processLoopA || !processLoopB) {
		throw new Error("Bay flow projection is missing its exact Bay or Process Loop records.");
	}
	const expectedBayParents =
		review.incidentConnectorCount === 0
			? Object.freeze([] as number[])
			: Object.freeze([review.bankOrganizationId as number]);
	if (
		!sameNumberList(staticFabOrganizationParentIds(bay), expectedBayParents) ||
		!thatRecordHasOnlyParent(processLoopA, bay.id) ||
		!thatRecordHasOnlyParent(processLoopB, bay.id)
	) {
		throw new Error("Bay flow projection changed the certified three-record hierarchy.");
	}
	const directChildIds = organizations.records
		.filter((record) => staticFabOrganizationParentIds(record).includes(bay.id))
		.map((record) => record.id)
		.sort((left, right) => left - right);
	const expectedChildIds = [...review.processLoopOrganizationIds].sort(
		(left, right) => left - right,
	);
	if (!sameNumberList(directChildIds, expectedChildIds)) {
		throw new Error(
			"Bay flow projection no longer has exactly two certified Process Loop children.",
		);
	}
	if (
		review.incidentConnectorCount === 1 &&
		(!review.bankOrganizationId || !recordsById.has(review.bankOrganizationId))
	) {
		throw new Error("Bay flow projection is missing its fixed Bank record.");
	}

	const gatewayKeys = new Set([
		...review.connectorBankToBayDirectedEdgeKeys,
		...review.connectorBayToBankDirectedEdgeKeys,
	]);
	for (const key of gatewayKeys) {
		const edge = parseDirectedEdgeKey(key);
		if (!edge || !directedEdgeExists(map, edge)) {
			throw new Error(`Bay flow fixed gateway edge ${key} is missing from the live map.`);
		}
	}

	const selected = [bay, processLoopA, processLoopB] as const;
	const selectedOwnerByEdgeKey = new Map<string, number>();
	let componentSeed: DirectedRailEdge | null = null;
	for (const record of selected) {
		if (
			record.membership.advancedSwitchIds.length !== 0 ||
			record.membership.equipmentGroupIds.length !== 0
		) {
			throw new Error(`Bay flow record ${record.id} gained an unsupported sidecar membership.`);
		}
		for (const edge of record.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (!directedEdgeExists(map, edge)) {
				throw new Error(`Bay flow record ${record.id} references missing live edge ${key}.`);
			}
			if (gatewayKeys.has(key)) continue;
			const previousOwner = selectedOwnerByEdgeKey.get(key);
			if (previousOwner !== undefined) {
				throw new Error(
					`Bay flow edge ${key} is directly owned by both ${previousOwner} and ${record.id}.`,
				);
			}
			selectedOwnerByEdgeKey.set(key, record.id);
			componentSeed ??= edge;
		}
	}
	if (!componentSeed) {
		throw new Error("Bay flow projection has no internal component seed.");
	}
	const scopedEdges = collectBayFlowRecognitionComponentEdges(map, componentSeed, gatewayKeys);
	const scopedEdgeKeys = new Set(scopedEdges.map(staticFabOrganizationEdgeKey));
	for (const key of selectedOwnerByEdgeKey.keys()) {
		if (!scopedEdgeKeys.has(key)) {
			throw new Error(`Bay flow persisted edge ${key} falls outside the fixed-gateway component.`);
		}
	}
	const fixedBankInternalEdgeKeys = new Set<string>();
	if (review.bankOrganizationId !== null) {
		const bank = recordsById.get(review.bankOrganizationId);
		if (!bank) throw new Error("Bay flow projection is missing its fixed Bank record.");
		const persistedOwnerIds = persistedOwnerIdsByEdgeKey(organizations);
		for (const edge of bank.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (!scopedEdgeKeys.has(key)) continue;
			const owners = persistedOwnerIds.get(key) ?? [];
			if (selectedOwnerByEdgeKey.has(key) || owners.length !== 1 || owners[0] !== bank.id) {
				throw new Error(
					`Bay flow fixed Bank seam ${key} has duplicate or external direct ownership.`,
				);
			}
			fixedBankInternalEdgeKeys.add(key);
			// The exact planner recognizes an attached Bay through a read-only semantic disconnect.
			// Model that same normalization locally without mutating the fixed Bank record.
			selectedOwnerByEdgeKey.set(key, bay.id);
		}
	}
	const persistedCoverageKeys = new Set([
		...selectedOwnerByEdgeKey.keys(),
		...fixedBankInternalEdgeKeys,
	]);
	if (
		persistedCoverageKeys.size !== scopedEdgeKeys.size ||
		[...scopedEdgeKeys].some((key) => !persistedCoverageKeys.has(key))
	) {
		throw new Error(
			"Bay flow fixed-gateway component is not exactly covered by selected or fixed Bank membership.",
		);
	}
	const scopedMap = materializeBayFlowRecognitionMap(scopedEdges);
	const edgesByOwnerId = new Map<number, DirectedRailEdge[]>(
		selected.map((record) => [record.id, []]),
	);
	for (const module of buildRailModuleOwnershipIndex(scopedMap).modules) {
		const claims = new Set<number>();
		for (const edge of module.eraseEdges) {
			const ownerId = selectedOwnerByEdgeKey.get(staticFabOrganizationEdgeKey(edge));
			if (ownerId !== undefined) claims.add(ownerId);
		}
		const ownerId = resolveBayFlowScopedModuleOwner(claims, bay.id, expectedChildIds);
		if (ownerId === null) {
			throw new Error(`Bay flow module ${module.key} has no exact selected-subtree owner.`);
		}
		edgesByOwnerId.get(ownerId)?.push(...module.eraseEdges);
	}
	const scopedRecords = selected.map((record) => {
		const railEdges = uniqueDirectedEdges(edgesByOwnerId.get(record.id) ?? []);
		if (railEdges.length === 0) {
			throw new Error(`Bay flow record ${record.id} has no internal recognition membership.`);
		}
		return copyStaticFabOrganizationRecord({
			...record,
			parentOrganizationIds: record.id === bay.id ? Object.freeze([]) : Object.freeze([bay.id]),
			membership: Object.freeze({
				railEdges: Object.freeze([...railEdges]),
				advancedSwitchIds: Object.freeze([]),
				equipmentGroupIds: Object.freeze([]),
			}),
		});
	});
	const scopedOrganizations = Object.freeze({
		nextOrganizationId: Math.max(...scopedRecords.map((record) => record.id)) + 1,
		records: Object.freeze(scopedRecords.sort((left, right) => left.id - right.id)),
	}) satisfies StaticFabOrganizationState;
	const recognized = recognizeProductionBayModule(scopedMap, scopedOrganizations, bay.id);
	if (!recognized.valid) {
		throw new Error(
			`Bay flow ${side} projection is not an exact Twin Production Bay: ${recognized.reason}`,
		);
	}
	const recognition = recognized.recognition;
	if (
		recognition.plan.specification.internalFlowPattern !== expectedPattern ||
		recognition.authoredProjectionFingerprint !== expectedFingerprint ||
		recognition.authoredDirectedEdgeKeys.length !== expectedDirectedEdgeCount ||
		recognition.processLoopOrganizationIdsByLoopId["process-loop-a"] !==
			review.processLoopOrganizationIds[0] ||
		recognition.processLoopOrganizationIdsByLoopId["process-loop-b"] !==
			review.processLoopOrganizationIds[1]
	) {
		throw new Error(
			`Bay flow ${side} projection diverged from its certified pattern or fingerprint.`,
		);
	}
}

export function planStaticFabBayFlowEdit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabBayFlowEditIntent,
): StaticFabBayFlowEditPlan {
	return planStaticFabBayFlowEditWithProspectiveState(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		intent,
	).plan;
}

/**
 * Replace only the runtime-recognized internal flow projection of one exact Twin Production Bay.
 * The planner never persists generator provenance and never turns the normalization disconnect into
 * a command; it is a read-only recognition intermediate for the existing attached topology.
 */
export function planStaticFabBayFlowEditWithProspectiveState(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabBayFlowEditIntent,
): StaticFabBayFlowEditPlanningResult {
	const intentError = staticFabBayFlowEditIntentError(intent);
	if (intentError) {
		return rejected(
			map,
			basePatchSequence,
			organizations,
			safeIntent(intent),
			"INVALID_INTENT",
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
			"Bay flow edit patch sequence is invalid.",
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
			`Static FAB organization source is invalid: ${sourceError}`,
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
			`Port and equipment source is invalid: ${errorMessage(error)}`,
		);
	}

	try {
		const normalized = normalizeBayForRecognition(
			map,
			portEquipment,
			basePatchSequence,
			organizations,
			intent.bayOrganizationId,
		);
		const recognizedResult = recognizeProductionBayModule(
			normalized.map,
			normalized.organizations,
			intent.bayOrganizationId,
		);
		if (!recognizedResult.valid) {
			throw new FlowEditFailure("SOURCE_NOT_RECOGNIZED", recognizedResult.reason);
		}
		const sourceRecognition = recognizedResult.recognition;
		const sourcePattern = sourceRecognition.plan.specification.internalFlowPattern;
		if (sourcePattern === intent.targetInternalFlowPattern) {
			throw new FlowEditFailure(
				"TARGET_NOOP",
				`Production Bay '${normalized.bay.name}' already uses ${sourcePattern} internal flow.`,
			);
		}
		assertNoUnsupportedDependencies(
			map,
			portEquipment,
			normalized.organizations,
			sourceRecognition,
		);

		const targetPlan = planProductionBayModule(
			targetRequest(sourceRecognition.plan, intent.targetInternalFlowPattern),
		);
		assertInvariantShell(sourceRecognition.plan, targetPlan);
		const sourceProjection = authoredProjection(sourceRecognition.plan, sourceRecognition);
		const targetProjection = authoredProjection(targetPlan, sourceRecognition);
		assertRecognitionProjection(sourceRecognition, sourceProjection);

		const removedEdges = edgeDifference(sourceProjection.edgesByKey, targetProjection.edgesByKey);
		const addedEdges = edgeDifference(targetProjection.edgesByKey, sourceProjection.edgesByKey);
		if (removedEdges.length === 0 || addedEdges.length === 0) {
			throw new FlowEditFailure(
				"TARGET_NOOP",
				"Twin Bay flow target does not produce a bidirectional authored-edge replacement.",
			);
		}
		assertChangedEdgesAreSubtreeOwned(
			organizations,
			sourceRecognition,
			removedEdges,
			addedEdges,
			map,
		);
		const mutations = planDirectedEdgeReplacement(map, removedEdges, addedEdges);
		const prospectiveMap = map.clone();
		if (!prospectiveMap.applyAtomicMutations(mutations, [])) {
			throw new FlowEditFailure(
				"MUTATION_INVALID",
				"Bay flow replacement no longer matches the current authored map.",
			);
		}
		const prospectiveOrganizations = rematerializeTargetOrganizations(
			organizations,
			prospectiveMap,
			targetProjection,
			sourceRecognition,
		);
		const organizationError = staticFabOrganizationStateError(
			prospectiveMap,
			portEquipment,
			prospectiveOrganizations,
		);
		if (organizationError) {
			throw new FlowEditFailure(
				"ORGANIZATION_INVALID",
				`Target Bay ownership is invalid: ${organizationError}`,
			);
		}
		assertPortEquipmentLayout(prospectiveMap, portEquipment);

		const normalizedTarget = normalizeBayForRecognition(
			prospectiveMap,
			portEquipment,
			basePatchSequence,
			prospectiveOrganizations,
			intent.bayOrganizationId,
		);
		assertFixedExternalGateway(map, prospectiveMap, normalized, normalizedTarget);
		const targetRecognitionResult = recognizeProductionBayModule(
			normalizedTarget.map,
			normalizedTarget.organizations,
			intent.bayOrganizationId,
		);
		if (!targetRecognitionResult.valid) {
			throw new FlowEditFailure("TARGET_NOT_RECOGNIZED", targetRecognitionResult.reason);
		}
		const targetRecognition = targetRecognitionResult.recognition;
		if (
			targetRecognition.plan.specification.internalFlowPattern !==
				intent.targetInternalFlowPattern ||
			!sameNumberRecord(
				targetRecognition.processLoopOrganizationIdsByLoopId,
				sourceRecognition.processLoopOrganizationIdsByLoopId,
			) ||
			!sameTextList(
				targetRecognition.authoredDirectedEdgeKeys,
				[...targetProjection.edgesByKey.keys()].sort(compareText),
			)
		) {
			throw new FlowEditFailure(
				"TARGET_NOT_RECOGNIZED",
				"Prospective Bay does not recognize as the exact requested flow projection.",
			);
		}

		const organizationMutations = diffStaticFabOrganizations(
			organizations,
			prospectiveOrganizations,
		);
		const subtreeIds = selectedSubtreeIds(sourceRecognition);
		if (
			organizationMutations.length === 0 ||
			organizationMutations.some(
				(mutation) =>
					!subtreeIds.has(mutation.id) || mutation.before === null || mutation.after === null,
			)
		) {
			throw new FlowEditFailure(
				"ORGANIZATION_INVALID",
				"Bay flow edit must mutate existing membership records inside one Bay subtree only.",
			);
		}
		const impactAuthorizations = exactStaticFabOrganizationImpactAuthorizations(
			organizations,
			organizationMutations,
			mutations,
			[],
			[],
			[],
			portEquipment,
			portEquipment,
		);
		const processLoopOrganizationIds = Object.freeze([
			sourceRecognition.processLoopOrganizationIdsByLoopId["process-loop-a"],
			sourceRecognition.processLoopOrganizationIdsByLoopId["process-loop-b"],
		]) as readonly [number, number];
		const review = Object.freeze({
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId: intent.bayOrganizationId,
			bayName: normalized.bay.name,
			bankOrganizationId: normalized.bank?.id ?? null,
			processLoopOrganizationIds,
			sourceInternalFlowPattern: sourcePattern,
			targetInternalFlowPattern: intent.targetInternalFlowPattern,
			sourceAuthoredProjectionFingerprint: sourceRecognition.authoredProjectionFingerprint,
			targetAuthoredProjectionFingerprint: targetRecognition.authoredProjectionFingerprint,
			sourceSpecificationAliasCount: sourceRecognition.specificationAliasCount,
			sourceDirectedEdgeCount: sourceProjection.edgesByKey.size,
			targetDirectedEdgeCount: targetProjection.edgesByKey.size,
			removedDirectedEdgeCount: removedEdges.length,
			addedDirectedEdgeCount: addedEdges.length,
			changedCellCount: mutations.length,
			changedOrganizationIds: Object.freeze(organizationMutations.map((mutation) => mutation.id)),
			incidentConnectorCount: normalized.incidentConnectorCount,
			connectorBankToBayDirectedEdgeKeys: normalized.connectorBankToBayDirectedEdgeKeys,
			connectorBayToBankDirectedEdgeKeys: normalized.connectorBayToBankDirectedEdgeKeys,
			shellCertification: "PENDING_WORKER_CERTIFICATION" as const,
			externalGatewayCertification: "PENDING_WORKER_CERTIFICATION" as const,
			topologyCertification: "PENDING_WORKER_CERTIFICATION" as const,
			issueCode: null,
		}) satisfies StaticFabBayFlowEditReview;
		const plan = Object.freeze({
			kind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
			baseRevision: map.getRevision(),
			basePatchSequence,
			mutations,
			switchMutations: Object.freeze([]),
			portMutations: Object.freeze([]),
			equipmentGroupMutations: Object.freeze([]),
			organizationMutations,
			organizationImpactAuthorizations: impactAuthorizations,
			nextOrganizationIdBefore: organizations.nextOrganizationId,
			nextOrganizationIdAfter: organizations.nextOrganizationId,
			valid: true,
			reason: `Change Production Bay '${normalized.bay.name}' internal flow from ${sourcePattern} to ${intent.targetInternalFlowPattern}.`,
			issueCode: null,
			review,
		}) satisfies StaticFabBayFlowEditPlan;
		return Object.freeze({
			plan,
			prospectiveState: Object.freeze({
				map: prospectiveMap,
				portEquipment,
				organizations: prospectiveOrganizations,
			}),
		});
	} catch (error) {
		const failure =
			error instanceof FlowEditFailure
				? error
				: new FlowEditFailure("INVALID_SOURCE", errorMessage(error));
		return rejected(map, basePatchSequence, organizations, intent, failure.code, failure.message);
	}
}

function normalizeBayForRecognition(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	bayOrganizationId: number,
): NormalizedBaySource {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bay = organizations.records.find((record) => record.id === bayOrganizationId);
	if (!bay || roles.get(bay.id) !== "BAY") {
		throw new FlowEditFailure(
			"UNSUPPORTED_HIERARCHY",
			`Organization ${bayOrganizationId} is not one semantic Bay.`,
		);
	}
	const parents = staticFabOrganizationParentIds(bay);
	if (parents.length === 0) {
		return Object.freeze({
			map,
			organizations,
			bay,
			bank: null,
			incidentConnectorCount: 0,
			connectorBankToBayDirectedEdgeKeys: Object.freeze([]),
			connectorBayToBankDirectedEdgeKeys: Object.freeze([]),
		});
	}
	const bankParents = parents
		.map((id) => organizations.records.find((record) => record.id === id))
		.filter(
			(record): record is StaticFabOrganizationRecord =>
				record !== undefined && roles.get(record.id) === "BAY_BANK",
		);
	if (parents.length !== 1 || bankParents.length !== 1) {
		throw new FlowEditFailure(
			"UNSUPPORTED_HIERARCHY",
			"Bay flow edit requires either a detached Bay or one exact direct Bay Bank parent.",
		);
	}
	const bank = bankParents[0] as StaticFabOrganizationRecord;
	const disconnect = planStaticFabSemanticBayMutationWithProspectiveState(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		Object.freeze({
			version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
			action: "DISCONNECT",
			bayOrganizationId,
		}),
	);
	if (!disconnect.plan.valid || !disconnect.prospectiveState) {
		throw new FlowEditFailure(
			"SOURCE_NOT_RECOGNIZED",
			`Attached Bay gateway could not be normalized: ${disconnect.plan.reason}`,
		);
	}
	const detachedBay = disconnect.prospectiveState.organizations.records.find(
		(record) => record.id === bayOrganizationId,
	);
	if (!detachedBay || staticFabOrganizationParentIds(detachedBay).length !== 0) {
		throw new FlowEditFailure(
			"SOURCE_NOT_RECOGNIZED",
			"Bay normalization did not produce one exact detached Bay root.",
		);
	}
	return Object.freeze({
		map: disconnect.prospectiveState.map,
		organizations: disconnect.prospectiveState.organizations,
		bay: detachedBay,
		bank,
		incidentConnectorCount: 1,
		connectorBankToBayDirectedEdgeKeys: disconnect.plan.review.connectorOutboundDirectedEdgeKeys,
		connectorBayToBankDirectedEdgeKeys: disconnect.plan.review.connectorReturnDirectedEdgeKeys,
	});
}

function targetRequest(
	source: ProductionBayModulePlan,
	targetInternalFlowPattern: ProductionBayInternalFlowPattern,
): ProductionBayModuleRequest {
	const specification = source.specification;
	return Object.freeze({
		version: specification.version,
		anchor: Object.freeze({ ...specification.anchor }),
		outerLengthMeters: specification.outerLengthMeters,
		outerDepthMeters: specification.outerDepthMeters,
		shellMarginMeters: specification.shellMarginMeters,
		processLoopGapMeters: specification.processLoopGapMeters,
		gatewayLengthMeters: specification.gatewayLengthMeters,
		processLoopCount: specification.processLoopCount,
		internalFlowPattern: targetInternalFlowPattern,
		pose: Object.freeze({ ...specification.pose }),
	});
}

function authoredProjection(
	plan: ProductionBayModulePlan,
	recognition: ProductionBayModuleRecognition,
): AuthoredProjection {
	const edgesByKey = new Map<string, DirectedRailEdge>();
	const ownerOrganizationIdByEdgeKey = new Map<string, number>();
	for (const step of plan.buildSteps) {
		const ownerOrganizationId = organizationIdForPlannerOwner(step.owner, recognition);
		for (let index = 0; index < step.route.length - 1; index += 1) {
			const from = step.route[index];
			const to = step.route[index + 1];
			if (!from || !to || directionBetween(from, to) === null) {
				throw new FlowEditFailure(
					"SOURCE_NOT_RECOGNIZED",
					`Production Bay build step '${step.id}' contains a malformed edge.`,
				);
			}
			const edge = Object.freeze({
				from: Object.freeze({ x: from.x, y: from.y }),
				to: Object.freeze({ x: to.x, y: to.y }),
			});
			const key = staticFabOrganizationEdgeKey(edge);
			const previous = ownerOrganizationIdByEdgeKey.get(key);
			if (previous !== undefined) {
				throw new FlowEditFailure(
					"SOURCE_NOT_RECOGNIZED",
					`Production Bay authored edge ${key} is generated more than once.`,
				);
			}
			edgesByKey.set(key, edge);
			ownerOrganizationIdByEdgeKey.set(key, ownerOrganizationId);
		}
	}
	return Object.freeze({
		edgesByKey,
		ownerOrganizationIdByEdgeKey,
	});
}

function organizationIdForPlannerOwner(
	owner: ProductionBayBuildStepOwner,
	recognition: ProductionBayModuleRecognition,
): number {
	if (owner === "BAY") return recognition.bayOrganizationId;
	return recognition.processLoopOrganizationIdsByLoopId[owner];
}

function assertRecognitionProjection(
	recognition: ProductionBayModuleRecognition,
	projection: AuthoredProjection,
): void {
	if (
		!sameTextList(
			recognition.authoredDirectedEdgeKeys,
			[...projection.edgesByKey.keys()].sort(compareText),
		)
	) {
		throw new FlowEditFailure(
			"SOURCE_NOT_RECOGNIZED",
			"Recognized Production Bay projection diverges from its execution representative.",
		);
	}
}

function assertInvariantShell(
	source: ProductionBayModulePlan,
	target: ProductionBayModulePlan,
): void {
	const sourceEdges = directedRouteEdges(source.outerLoop.cells).map(staticFabOrganizationEdgeKey);
	const targetEdges = directedRouteEdges(target.outerLoop.cells).map(staticFabOrganizationEdgeKey);
	if (
		source.specification.anchor.x !== target.specification.anchor.x ||
		source.specification.anchor.y !== target.specification.anchor.y ||
		source.specification.outerLengthMeters !== target.specification.outerLengthMeters ||
		source.specification.outerDepthMeters !== target.specification.outerDepthMeters ||
		source.specification.shellMarginMeters !== target.specification.shellMarginMeters ||
		source.specification.processLoopGapMeters !== target.specification.processLoopGapMeters ||
		source.specification.processLoopCount !== 2 ||
		target.specification.processLoopCount !== 2 ||
		source.specification.pose.forward !== target.specification.pose.forward ||
		source.specification.pose.side !== target.specification.pose.side ||
		source.specification.pose.flow !== target.specification.pose.flow ||
		!sameTextList(sourceEdges, targetEdges)
	) {
		throw new FlowEditFailure(
			"MUTATION_INVALID",
			"Bay flow edit changed the recognized envelope, pose, dimensions, or directed shell.",
		);
	}
}

function assertNoUnsupportedDependencies(
	map: TileMap,
	portEquipment: PortEquipmentState,
	normalizedOrganizations: StaticFabOrganizationState,
	recognition: ProductionBayModuleRecognition,
): void {
	const coverage = resolveStaticFabOrganizationCoverage(
		normalizedOrganizations,
		recognition.bayOrganizationId,
	);
	if (!coverage) {
		throw new FlowEditFailure(
			"SOURCE_NOT_RECOGNIZED",
			"Recognized Bay effective membership is missing.",
		);
	}
	if (
		coverage.effective.advancedSwitchIds.length > 0 ||
		coverage.effective.equipmentGroupIds.length > 0
	) {
		throw new FlowEditFailure(
			"UNSUPPORTED_DEPENDENCY",
			"Bay flow edit v1 does not move Bay-owned advanced switches or equipment groups.",
		);
	}
	const bounds = recognition.plan.bounds;
	for (const port of portEquipment.ports) {
		if (
			port.route.kind === "CARDINAL_CELL" &&
			port.route.x >= bounds.minX &&
			port.route.x <= bounds.maxX &&
			port.route.z >= bounds.minY &&
			port.route.z <= bounds.maxY
		) {
			throw new FlowEditFailure(
				"UNSUPPORTED_DEPENDENCY",
				`Port ${port.id} attaches inside the selected Bay envelope.`,
			);
		}
	}
	for (const cell of recognition.plan.occupiedCells) {
		const advancedSwitch = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (advancedSwitch) {
			throw new FlowEditFailure(
				"UNSUPPORTED_DEPENDENCY",
				`Advanced switch ${advancedSwitch.id} intersects the selected Bay envelope.`,
			);
		}
	}
}

function assertChangedEdgesAreSubtreeOwned(
	organizations: StaticFabOrganizationState,
	recognition: ProductionBayModuleRecognition,
	removedEdges: readonly DirectedRailEdge[],
	addedEdges: readonly DirectedRailEdge[],
	map: TileMap,
): void {
	const subtreeIds = selectedSubtreeIds(recognition);
	const ownersByEdgeKey = persistedOwnerIdsByEdgeKey(organizations);
	for (const edge of removedEdges) {
		const key = staticFabOrganizationEdgeKey(edge);
		const outsideOwners = (ownersByEdgeKey.get(key) ?? []).filter((id) => !subtreeIds.has(id));
		if (outsideOwners.length > 0) {
			throw new FlowEditFailure(
				"UNSUPPORTED_DEPENDENCY",
				`Changed source edge ${key} is also persisted by an organization outside the Bay subtree.`,
			);
		}
	}
	for (const edge of addedEdges) {
		if (directedEdgeExists(map, edge)) {
			throw new FlowEditFailure(
				"MUTATION_INVALID",
				`Target edge ${staticFabOrganizationEdgeKey(edge)} already belongs to live authored topology.`,
			);
		}
	}
}

function planDirectedEdgeReplacement(
	map: TileMap,
	removedEdges: readonly DirectedRailEdge[],
	addedEdges: readonly DirectedRailEdge[],
): readonly RailMutation[] {
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
	for (const edge of removedEdges) {
		mutateDirectedEdge(read, write, edge, false);
	}
	for (const edge of addedEdges) {
		mutateDirectedEdge(read, write, edge, true);
	}
	const mutations = Object.freeze(
		[...overlay.values()]
			.filter((mutation) => mutation.before !== mutation.after)
			.sort((left, right) => left.y - right.y || left.x - right.x)
			.map((mutation) => Object.freeze(mutation)),
	);
	if (mutations.length === 0) {
		throw new FlowEditFailure("TARGET_NOOP", "Bay flow replacement contains no changed cell.");
	}
	const topologyError = railMutationTopologyError(map, mutations, []);
	if (topologyError) throw new FlowEditFailure("MUTATION_INVALID", topologyError);
	return mutations;
}

function mutateDirectedEdge(
	read: (cell: Cell) => number,
	write: (cell: Cell, after: number) => void,
	edge: DirectedRailEdge,
	add: boolean,
): void {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) {
		throw new FlowEditFailure("MUTATION_INVALID", "Bay flow edge is not cardinal and adjacent.");
	}
	const opposite = oppositeDirection(direction);
	const from = decodeRailCell(read(edge.from));
	const to = decodeRailCell(read(edge.to));
	const fromExists = (from.outgoing & direction) !== 0;
	const toExists = (to.incoming & opposite) !== 0;
	if (fromExists !== toExists) {
		throw new FlowEditFailure(
			"MUTATION_INVALID",
			`Edge ${staticFabOrganizationEdgeKey(edge)} has asymmetric live endpoint bits.`,
		);
	}
	const exists = fromExists;
	if (add ? exists : !exists) {
		throw new FlowEditFailure(
			"MUTATION_INVALID",
			`${add ? "Target" : "Source"} edge ${staticFabOrganizationEdgeKey(edge)} has stale live bits.`,
		);
	}
	write(
		edge.from,
		encodeRailCell({
			...from,
			outgoing: add ? from.outgoing | direction : from.outgoing & ~direction,
		}),
	);
	write(
		edge.to,
		encodeRailCell({
			...to,
			incoming: add ? to.incoming | opposite : to.incoming & ~opposite,
		}),
	);
}

function rematerializeTargetOrganizations(
	organizations: StaticFabOrganizationState,
	prospectiveMap: TileMap,
	targetProjection: AuthoredProjection,
	recognition: ProductionBayModuleRecognition,
): StaticFabOrganizationState {
	const selectedIds = selectedSubtreeIds(recognition);
	const sourceOwnerIdsByEdgeKey = persistedOwnerIdsByEdgeKey(organizations);
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const ancestorsById = organizationAncestorsById(organizations);
	const edgesBySelectedOwner = new Map<number, DirectedRailEdge[]>(
		[...selectedIds].map((id) => [id, []]),
	);
	const switchesBySelectedOwner = new Map<number, number[]>([...selectedIds].map((id) => [id, []]));
	const coveredTargetEdgeKeys = new Set<string>();
	const ownership = buildRailModuleOwnershipIndex(prospectiveMap);
	for (const module of ownership.modules) {
		const targetEdgeKeys = module.eraseEdges
			.map(staticFabOrganizationEdgeKey)
			.filter((key) => targetProjection.edgesByKey.has(key));
		if (targetEdgeKeys.length === 0) continue;
		const claims = new Set<number>();
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			const targetOwnerId = targetProjection.ownerOrganizationIdByEdgeKey.get(key);
			if (targetOwnerId !== undefined) {
				claims.add(targetOwnerId);
				coveredTargetEdgeKeys.add(key);
				continue;
			}
			const sourceOwners = sourceOwnerIdsByEdgeKey.get(key) ?? [];
			if (sourceOwners.length === 0) {
				throw new FlowEditFailure(
					"ORGANIZATION_INVALID",
					`Prospective crossing module ${module.key} contains unclaimed outside edge ${key}.`,
				);
			}
			for (const ownerId of sourceOwners) claims.add(ownerId);
		}
		const resolvedOwnerId = resolveClaimedAncestorOwner(claims, ancestorsById);
		if (resolvedOwnerId === null) {
			throw new FlowEditFailure(
				"ORGANIZATION_INVALID",
				`Prospective module ${module.key} has ambiguous semantic claims ${[...claims].sort((a, b) => a - b).join(", ")}.`,
			);
		}
		if (selectedIds.has(resolvedOwnerId)) {
			if (module.advancedSwitchId !== null) {
				throw new FlowEditFailure(
					"UNSUPPORTED_DEPENDENCY",
					`Prospective Bay module ${module.key} contains advanced switch ${module.advancedSwitchId}.`,
				);
			}
			edgesBySelectedOwner.get(resolvedOwnerId)?.push(...module.eraseEdges);
			if (module.advancedSwitchId !== null) {
				switchesBySelectedOwner.get(resolvedOwnerId)?.push(module.advancedSwitchId);
			}
		} else {
			const owner = recordsById.get(resolvedOwnerId);
			if (!owner || owner.id !== staticParentBankId(recognition, organizations)) {
				throw new FlowEditFailure(
					"ORGANIZATION_INVALID",
					`Prospective Bay geometry crosses unrelated organization ${resolvedOwnerId}.`,
				);
			}
		}
	}
	if (
		coveredTargetEdgeKeys.size !== targetProjection.edgesByKey.size ||
		[...targetProjection.edgesByKey.keys()].some((key) => !coveredTargetEdgeKeys.has(key))
	) {
		throw new FlowEditFailure(
			"ORGANIZATION_INVALID",
			"Target Bay authored edges do not resolve through the complete prospective module partition.",
		);
	}
	const nextRecords = organizations.records.map((record) => {
		if (!selectedIds.has(record.id)) return record;
		if (
			record.membership.advancedSwitchIds.length > 0 ||
			record.membership.equipmentGroupIds.length > 0
		) {
			throw new FlowEditFailure(
				"UNSUPPORTED_DEPENDENCY",
				`Bay subtree organization ${record.id} contains unsupported sidecar membership.`,
			);
		}
		const railEdges = uniqueDirectedEdges(edgesBySelectedOwner.get(record.id) ?? []);
		if (railEdges.length === 0) {
			throw new FlowEditFailure(
				"ORGANIZATION_INVALID",
				`Bay subtree organization ${record.id} owns no target rail module.`,
			);
		}
		const membership = Object.freeze({
			railEdges,
			advancedSwitchIds: Object.freeze(
				[...new Set(switchesBySelectedOwner.get(record.id) ?? [])].sort((a, b) => a - b),
			),
			equipmentGroupIds: Object.freeze([...record.membership.equipmentGroupIds]),
		}) satisfies StaticFabOrganizationMembership;
		return replaceStaticFabOrganizationRecordMembership(record, membership);
	});
	const prospective = copyStaticFabOrganizationState({
		nextOrganizationId: organizations.nextOrganizationId,
		records: Object.freeze(nextRecords),
	});
	const mutations = diffStaticFabOrganizations(organizations, prospective);
	return applyStaticFabOrganizationMutations(
		organizations,
		mutations,
		organizations.nextOrganizationId,
		true,
	);
}

function assertFixedExternalGateway(
	sourceMap: TileMap,
	targetMap: TileMap,
	source: NormalizedBaySource,
	target: NormalizedBaySource,
): void {
	if (
		source.incidentConnectorCount !== target.incidentConnectorCount ||
		source.bank?.id !== target.bank?.id ||
		!sameTextList(
			source.connectorBankToBayDirectedEdgeKeys,
			target.connectorBankToBayDirectedEdgeKeys,
		) ||
		!sameTextList(
			source.connectorBayToBankDirectedEdgeKeys,
			target.connectorBayToBankDirectedEdgeKeys,
		) ||
		!staticFabOrganizationRecordEquals(source.bank, target.bank)
	) {
		throw new FlowEditFailure(
			"EXTERNAL_GATEWAY_CHANGED",
			"Prospective Bay changed its attached state, Bank record, or exact external connector.",
		);
	}
	const connectorKeys = [
		...source.connectorBankToBayDirectedEdgeKeys,
		...source.connectorBayToBankDirectedEdgeKeys,
	];
	const protectedCells = new Set<string>();
	for (const key of connectorKeys) {
		const edge = parseDirectedEdgeKey(key);
		if (!edge) {
			throw new FlowEditFailure(
				"EXTERNAL_GATEWAY_CHANGED",
				`External connector edge key '${key}' is malformed.`,
			);
		}
		protectedCells.add(cellKey(edge.from.x, edge.from.y));
		protectedCells.add(cellKey(edge.to.x, edge.to.y));
	}
	for (const key of protectedCells) {
		const cell = parseCellKey(key);
		if (!cell || sourceMap.getEncoded(cell.x, cell.y) !== targetMap.getEncoded(cell.x, cell.y)) {
			throw new FlowEditFailure(
				"EXTERNAL_GATEWAY_CHANGED",
				`External gateway cell ${key} changed encoded rail identity.`,
			);
		}
	}
}

function organizationAncestorsById(
	organizations: StaticFabOrganizationState,
): ReadonlyMap<number, ReadonlySet<number>> {
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const result = new Map<number, ReadonlySet<number>>();
	const active = new Set<number>();
	const visit = (id: number): ReadonlySet<number> => {
		const cached = result.get(id);
		if (cached) return cached;
		if (active.has(id)) {
			throw new FlowEditFailure("INVALID_SOURCE", "Organization hierarchy contains a cycle.");
		}
		const record = recordsById.get(id);
		if (!record) {
			throw new FlowEditFailure(
				"INVALID_SOURCE",
				`Organization hierarchy references missing parent ${id}.`,
			);
		}
		active.add(id);
		const ancestors = new Set<number>();
		for (const parentId of staticFabOrganizationParentIds(record)) {
			ancestors.add(parentId);
			for (const ancestorId of visit(parentId)) ancestors.add(ancestorId);
		}
		active.delete(id);
		result.set(id, ancestors);
		return ancestors;
	};
	for (const record of organizations.records) visit(record.id);
	return result;
}

function resolveClaimedAncestorOwner(
	claims: ReadonlySet<number>,
	ancestorsById: ReadonlyMap<number, ReadonlySet<number>>,
): number | null {
	const candidates = [...claims].filter((candidateId) =>
		[...claims].every(
			(otherId) =>
				otherId === candidateId || (ancestorsById.get(otherId)?.has(candidateId) ?? false),
		),
	);
	return candidates.length === 1 ? (candidates[0] as number) : null;
}

function persistedOwnerIdsByEdgeKey(
	organizations: StaticFabOrganizationState,
): ReadonlyMap<string, readonly number[]> {
	const owners = new Map<string, number[]>();
	for (const record of organizations.records) {
		for (const edge of record.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			const current = owners.get(key);
			if (current) current.push(record.id);
			else owners.set(key, [record.id]);
		}
	}
	for (const ids of owners.values()) ids.sort((left, right) => left - right);
	return owners;
}

function staticParentBankId(
	recognition: ProductionBayModuleRecognition,
	organizations: StaticFabOrganizationState,
): number | null {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bay = organizations.records.find((record) => record.id === recognition.bayOrganizationId);
	if (!bay) return null;
	const bankIds = staticFabOrganizationParentIds(bay).filter((id) => roles.get(id) === "BAY_BANK");
	return bankIds.length === 1 ? (bankIds[0] as number) : null;
}

function selectedSubtreeIds(recognition: ProductionBayModuleRecognition): ReadonlySet<number> {
	return new Set([
		recognition.bayOrganizationId,
		recognition.processLoopOrganizationIdsByLoopId["process-loop-a"],
		recognition.processLoopOrganizationIdsByLoopId["process-loop-b"],
	]);
}

function edgeDifference(
	left: ReadonlyMap<string, DirectedRailEdge>,
	right: ReadonlyMap<string, DirectedRailEdge>,
): readonly DirectedRailEdge[] {
	return Object.freeze(
		[...left.entries()]
			.filter(([key]) => !right.has(key))
			.map(([, edge]) => edge)
			.sort(compareDirectedRailEdges),
	);
}

function directedRouteEdges(route: readonly Cell[]): readonly DirectedRailEdge[] {
	return Object.freeze(
		route.slice(0, -1).map((from, index) =>
			Object.freeze({
				from: Object.freeze({ x: from.x, y: from.y }),
				to: Object.freeze({
					x: (route[index + 1] as Cell).x,
					y: (route[index + 1] as Cell).y,
				}),
			}),
		),
	);
}

function uniqueDirectedEdges(edges: readonly DirectedRailEdge[]): readonly DirectedRailEdge[] {
	const byKey = new Map<string, DirectedRailEdge>();
	for (const edge of edges) byKey.set(staticFabOrganizationEdgeKey(edge), edge);
	return Object.freeze([...byKey.values()].sort(compareDirectedRailEdges));
}

function materializeBayFlowRecognitionMap(edges: readonly DirectedRailEdge[]): TileMap {
	const encodedByCell = new Map<
		string,
		{ readonly cell: Cell; incoming: number; outgoing: number }
	>();
	const stateFor = (cell: Cell) => {
		const key = cellKey(cell.x, cell.y);
		const existing = encodedByCell.get(key);
		if (existing) return existing;
		const created = { cell: Object.freeze({ x: cell.x, y: cell.y }), incoming: 0, outgoing: 0 };
		encodedByCell.set(key, created);
		return created;
	};
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) {
			throw new Error(
				`Bay flow recognition edge ${staticFabOrganizationEdgeKey(edge)} is invalid.`,
			);
		}
		stateFor(edge.from).outgoing |= direction;
		stateFor(edge.to).incoming |= oppositeDirection(direction);
	}
	const scopedMap = new TileMap();
	for (const state of encodedByCell.values()) {
		scopedMap.setEncoded(state.cell.x, state.cell.y, encodeRailCell(state));
	}
	return scopedMap;
}

function collectBayFlowRecognitionComponentEdges(
	map: TileMap,
	seed: DirectedRailEdge,
	excludedEdgeKeys: ReadonlySet<string>,
): readonly DirectedRailEdge[] {
	const visitedCells = new Set<string>();
	const componentEdges = new Map<string, DirectedRailEdge>();
	const pending: Cell[] = [seed.from];
	for (let offset = 0; offset < pending.length; offset++) {
		const cell = pending[offset] as Cell;
		const key = cellKey(cell.x, cell.y);
		if (visitedCells.has(key)) continue;
		visitedCells.add(key);
		if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) {
			throw new Error(`Bay flow scoped component crosses an advanced switch at ${key}.`);
		}
		const rail = map.getRail(cell.x, cell.y);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = Object.freeze(moveCell(cell, direction));
			const neighborRail = map.getRail(neighbor.x, neighbor.y);
			let connected = false;
			if (
				(rail.outgoing & direction) !== 0 &&
				(neighborRail.incoming & oppositeDirection(direction)) !== 0
			) {
				const edge = Object.freeze({ from: Object.freeze({ ...cell }), to: neighbor });
				const edgeKey = staticFabOrganizationEdgeKey(edge);
				if (!excludedEdgeKeys.has(edgeKey)) {
					componentEdges.set(edgeKey, edge);
					connected = true;
				}
			}
			if (
				(rail.incoming & direction) !== 0 &&
				(neighborRail.outgoing & oppositeDirection(direction)) !== 0
			) {
				const edge = Object.freeze({ from: neighbor, to: Object.freeze({ ...cell }) });
				const edgeKey = staticFabOrganizationEdgeKey(edge);
				if (!excludedEdgeKeys.has(edgeKey)) {
					componentEdges.set(edgeKey, edge);
					connected = true;
				}
			}
			if (connected && !visitedCells.has(cellKey(neighbor.x, neighbor.y))) pending.push(neighbor);
		}
	}
	return Object.freeze([...componentEdges.values()].sort(compareDirectedRailEdges));
}

function resolveBayFlowScopedModuleOwner(
	claims: ReadonlySet<number>,
	bayId: number,
	processLoopIds: readonly number[],
): number | null {
	if (claims.size === 0) return null;
	if ([...claims].some((id) => id !== bayId && !processLoopIds.includes(id))) return null;
	if (claims.size === 1) return claims.values().next().value ?? null;
	return bayId;
}

function thatRecordHasOnlyParent(record: StaticFabOrganizationRecord, parentId: number): boolean {
	const parentIds = staticFabOrganizationParentIds(record);
	return parentIds.length === 1 && parentIds[0] === parentId;
}

function directedEdgeExists(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) return false;
	const opposite = oppositeDirection(direction);
	return (
		(map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0 &&
		(map.getRail(edge.to.x, edge.to.y).incoming & opposite) !== 0
	);
}

function parseDirectedEdgeKey(key: string): DirectedRailEdge | null {
	const match = /^(-?\d+):(-?\d+)>(-?\d+):(-?\d+)$/.exec(key);
	if (!match) return null;
	const values = match.slice(1).map(Number);
	if (!values.every(int32)) return null;
	const edge = Object.freeze({
		from: Object.freeze({ x: values[0] as number, y: values[1] as number }),
		to: Object.freeze({ x: values[2] as number, y: values[3] as number }),
	});
	return directionBetween(edge.from, edge.to) === null ? null : edge;
}

function parseCellKey(key: string): Cell | null {
	const separator = key.indexOf(",");
	if (separator <= 0) return null;
	const x = Number(key.slice(0, separator));
	const y = Number(key.slice(separator + 1));
	return int32(x) && int32(y) ? Object.freeze({ x, y }) : null;
}

function rejected(
	map: TileMap,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabBayFlowEditIntent,
	issueCode: StaticFabBayFlowEditIssueCode,
	reason: string,
): StaticFabBayFlowEditPlanningResult {
	const bay = organizations.records.find((record) => record.id === intent.bayOrganizationId);
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const processLoopIds = bay
		? organizations.records
				.filter(
					(record) =>
						roles.get(record.id) === "PROCESS_LOOP" &&
						staticFabOrganizationParentIds(record).includes(bay.id),
				)
				.map((record) => record.id)
				.sort((left, right) => left - right)
		: [];
	const safeLoopIds = Object.freeze([processLoopIds[0] ?? 0, processLoopIds[1] ?? 0]) as readonly [
		number,
		number,
	];
	const bankId = bay
		? (staticFabOrganizationParentIds(bay).find((id) => roles.get(id) === "BAY_BANK") ?? null)
		: null;
	const review = Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: positiveInt32(intent.bayOrganizationId) ? intent.bayOrganizationId : 0,
		bayName: bay?.name ?? "Unavailable Bay",
		bankOrganizationId: bankId,
		processLoopOrganizationIds: safeLoopIds,
		sourceInternalFlowPattern: null,
		targetInternalFlowPattern:
			intent.targetInternalFlowPattern === "co-rotating" ? "co-rotating" : "alternating",
		sourceAuthoredProjectionFingerprint: "",
		targetAuthoredProjectionFingerprint: "",
		sourceSpecificationAliasCount: 0,
		sourceDirectedEdgeCount: 0,
		targetDirectedEdgeCount: 0,
		removedDirectedEdgeCount: 0,
		addedDirectedEdgeCount: 0,
		changedCellCount: 0,
		changedOrganizationIds: Object.freeze([]),
		incidentConnectorCount: 0,
		connectorBankToBayDirectedEdgeKeys: Object.freeze([]),
		connectorBayToBankDirectedEdgeKeys: Object.freeze([]),
		shellCertification: "PENDING_WORKER_CERTIFICATION" as const,
		externalGatewayCertification: "PENDING_WORKER_CERTIFICATION" as const,
		topologyCertification: "PENDING_WORKER_CERTIFICATION" as const,
		issueCode,
	}) satisfies StaticFabBayFlowEditReview;
	return Object.freeze({
		plan: Object.freeze({
			kind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
			baseRevision: map.getRevision(),
			basePatchSequence: Number.isSafeInteger(basePatchSequence) ? basePatchSequence : -1,
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

function safeIntent(value: unknown): StaticFabBayFlowEditIntent {
	if (!isRecord(value)) {
		return Object.freeze({
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId: 0,
			targetInternalFlowPattern: "alternating",
		});
	}
	return Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: positiveInt32(value.bayOrganizationId)
			? (value.bayOrganizationId as number)
			: 0,
		targetInternalFlowPattern:
			value.targetInternalFlowPattern === "co-rotating" ? "co-rotating" : "alternating",
	});
}

class FlowEditFailure extends Error {
	readonly code: StaticFabBayFlowEditIssueCode;

	constructor(code: StaticFabBayFlowEditIssueCode, message: string) {
		super(message);
		this.name = "FlowEditFailure";
		this.code = code;
	}
}

function sameNumberRecord(
	left: Readonly<Record<"process-loop-a" | "process-loop-b", number>>,
	right: Readonly<Record<"process-loop-a" | "process-loop-b", number>>,
): boolean {
	return (
		left["process-loop-a"] === right["process-loop-a"] &&
		left["process-loop-b"] === right["process-loop-b"]
	);
}

function sameTextList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumberList(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown Bay flow edit failure.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const Key extends string>(
	value: Record<string, unknown>,
	keys: readonly Key[],
): boolean {
	const actual = Object.keys(value).sort(compareText);
	const expected = [...keys].sort(compareText);
	return sameTextList(actual, expected);
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function int32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff;
}
