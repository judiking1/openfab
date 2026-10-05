import type { PortEquipmentState } from "./EquipmentGroup";
import { assertPortEquipmentLayout } from "./PortEquipmentLayoutValidator";
import { type RailMutation, railMutationTopologyError } from "./paint";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import { type RailPatchTransition, railPatchTransitionFingerprint } from "./RailPatchHistory";
import { directionBetween, oppositeDirection } from "./railShape";
import {
	applyStaticFabAssemblyRelationshipMutations,
	copyStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	applyStaticFabOrganizationMutations,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	resolveStaticFabOrganizationDescendantIds,
	reverseStaticFabOrganizationMutations,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "./StaticFabOrganizationImpactIndex";
import { reviewStaticFabSemanticHierarchyCut } from "./StaticFabSemanticHierarchyCut";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	type StaticFabSemanticHierarchyRecoveryIntent,
	staticFabSemanticHierarchyRecoveryIntentError,
} from "./StaticFabSemanticHierarchyRecovery";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_SEMANTIC_BANK_DETACH_KIND = "detach-static-fab-bank" as const;
export const STATIC_FAB_SEMANTIC_BANK_DETACH_MAX_CUT_EDGES = 4_096;
export const STATIC_FAB_SEMANTIC_BANK_DETACH_ID_SAMPLE_LIMIT = 8;

export interface StaticFabSemanticBankDetachIntent
	extends StaticFabSemanticHierarchyRecoveryIntent {
	readonly action: "DETACH";
	readonly targetRole: "BAY_BANK";
	readonly expectedParentOrganizationId: number;
}

export interface StaticFabSemanticBankDetachReview {
	readonly version: 1;
	readonly bankOrganizationId: number;
	readonly bankName: string;
	readonly fabOrganizationId: number;
	readonly fabName: string;
	readonly preservedOrganizationCount: number;
	readonly preservedBayCount: number;
	readonly preservedLoopCount: number;
	readonly preservedPortCount: number;
	readonly preservedEquipmentGroupCount: number;
	readonly preservedRailModuleCount: number;
	readonly preservedAdvancedSwitchCount: number;
	readonly preservedOrganizationIdSample: readonly number[];
	readonly preservedBayIdSample: readonly number[];
	readonly preservedLoopIdSample: readonly number[];
	readonly preservedPortIdSample: readonly number[];
	readonly preservedEquipmentGroupIdSample: readonly number[];
	readonly preservedRailModuleKeySample: readonly string[];
	readonly preservedAdvancedSwitchIdSample: readonly number[];
	readonly removedRelationshipIds: readonly number[];
	readonly removedDirectedEdgeCount: number;
	readonly removedRailModuleCount: number;
	readonly removedAdvancedSwitchCount: number;
	readonly removedCorridorCount: number;
	readonly removedRailModuleKeySample: readonly string[];
	readonly removedCorridorIdSample: readonly string[];
	readonly retainedBankCount: number;
	readonly structuralCutFingerprint: string;
}

export interface StaticFabSemanticBankDetachPlan {
	readonly kind: typeof STATIC_FAB_SEMANTIC_BANK_DETACH_KIND;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly intent: StaticFabSemanticBankDetachIntent;
	readonly review: StaticFabSemanticBankDetachReview;
	readonly transition: RailPatchTransition;
}

export interface StaticFabSemanticBankDetachProspectiveState {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
}

export type StaticFabSemanticBankDetachIssueCode =
	| "INVALID_SOURCE"
	| "INVALID_INTENT"
	| "HIERARCHY_REJECTED"
	| "RELATIONSHIP_MISSING"
	| "RELATIONSHIP_NOT_DETACHABLE"
	| "SHARED_RELATIONSHIP"
	| "CUT_MISMATCH"
	| "BUDGET_EXCEEDED"
	| "PROSPECTIVE_INVALID";

export type StaticFabSemanticBankDetachPlanningResult =
	| Readonly<{
			valid: true;
			plan: StaticFabSemanticBankDetachPlan;
			prospectiveState: StaticFabSemanticBankDetachProspectiveState;
			issueCode: null;
			reason: string;
	  }>
	| Readonly<{
			valid: false;
			plan: null;
			prospectiveState: null;
			issueCode: StaticFabSemanticBankDetachIssueCode;
			reason: string;
	  }>;

export function staticFabSemanticBankDetachIntentError(value: unknown): string | null {
	const error = staticFabSemanticHierarchyRecoveryIntentError(value);
	if (error) return error;
	const intent = value as StaticFabSemanticHierarchyRecoveryIntent;
	return intent.action === "DETACH" &&
		intent.targetRole === "BAY_BANK" &&
		intent.expectedParentOrganizationId !== null
		? null
		: "현재는 명시적 연결로 추가한 Bank 하나의 분리만 지원합니다";
}

/** Mirror-side authored/redo proof; Undo must instead match its exact forward-history ledger. */
export function assertStaticFabSemanticBankDetachPatchSource(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	patch: RailPatchTransition,
): void {
	const relationship = patch.relationshipChanges?.[0]?.before;
	if (!relationship || patch.relationshipChanges?.length !== 1)
		throw new Error("Bank 분리 patch에는 정확한 원본 관계 제거가 필요합니다");
	const planned = planStaticFabSemanticBankDetach(
		map,
		portEquipment,
		patchSequence,
		organizations,
		relationships,
		{
			version: 1,
			action: "DETACH",
			targetRole: "BAY_BANK",
			targetOrganizationId: relationship.managedChildOrganizationIds[0],
			expectedParentOrganizationId: relationship.parentOrganizationId,
		},
	);
	if (!planned.valid) throw new Error(planned.reason);
	if (
		railPatchTransitionFingerprint(patch) !==
		railPatchTransitionFingerprint(planned.plan.transition)
	)
		throw new Error("Bank 분리 patch가 원본의 정확한 연결·조직·관계 변경과 다릅니다");
}

/** Removal-only proposal. Only a fresh, exact Worker certificate can grant commit authority. */
export function planStaticFabSemanticBankDetach(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	intentValue: unknown,
): StaticFabSemanticBankDetachPlanningResult {
	try {
		const intentError = staticFabSemanticBankDetachIntentError(intentValue);
		if (intentError) fail("INVALID_INTENT", intentError);
		if (!Number.isSafeInteger(patchSequence) || patchSequence < 0)
			fail("INVALID_SOURCE", "Bank 분리의 문서 순서가 유효하지 않습니다");
		const intent = Object.freeze({ ...(intentValue as StaticFabSemanticBankDetachIntent) });
		const hierarchy = reviewStaticFabSemanticHierarchyRecovery(organizations, intent);
		if (!hierarchy.accepted) fail("HIERARCHY_REJECTED", hierarchy.reason);
		const sourceError =
			staticFabOrganizationStateError(map, portEquipment, organizations) ??
			staticFabAssemblyRelationshipStateSourceError(map, organizations, relationships);
		if (sourceError) fail("INVALID_SOURCE", sourceError);
		assertPortEquipmentLayout(map, portEquipment);
		const selectedIds = new Set([
			intent.targetOrganizationId,
			...(resolveStaticFabOrganizationDescendantIds(organizations, intent.targetOrganizationId) ??
				[]),
		]);
		const seeds = relationships.records.filter((record) =>
			record.managedChildOrganizationIds.includes(intent.targetOrganizationId),
		);
		if (seeds.length === 0)
			fail(
				"RELATIONSHIP_MISSING",
				"이 Bank를 추가한 명시적 조립 관계가 없습니다 · 자동 추론하지 않습니다",
			);
		if (seeds.length !== 1)
			fail("SHARED_RELATIONSHIP", "이 Bank의 소속을 여러 관계가 관리하여 단독 분리할 수 없습니다");
		const relationship = seeds[0];
		if (
			relationship.reviewPolicy !== "REVIEW_REQUIRED" ||
			relationship.hierarchyRole !== "BANK_TO_FAB" ||
			relationship.purpose !== "HIERARCHY_LINK"
		)
			fail("RELATIONSHIP_NOT_DETACHABLE", "이 조립 관계는 개별 Bank 분리를 지원하지 않습니다");
		if (
			relationship.parentOrganizationId !== intent.expectedParentOrganizationId ||
			relationship.managedChildOrganizationIds.length !== 1 ||
			relationship.participantOrganizationIds.length !== 2 ||
			!relationship.participantOrganizationIds.includes(intent.targetOrganizationId) ||
			relationship.connectionGroups.length !== 1 ||
			relationship.connectionGroups[0].legs.length !== 2 ||
			!relationship.connectionGroups[0].legs.some((leg) => leg.directionRole === "OUTBOUND") ||
			!relationship.connectionGroups[0].legs.some((leg) => leg.directionRole === "RETURN")
		)
			fail("SHARED_RELATIONSHIP", "다른 Bank의 소속도 관리하거나 지원 범위를 벗어난 연결입니다");
		const cuts = relationship.connectionGroups[0].legs.flatMap((leg) => leg.exclusiveCutEdges);
		if (cuts.length > STATIC_FAB_SEMANTIC_BANK_DETACH_MAX_CUT_EDGES)
			fail("BUDGET_EXCEEDED", "Bank 연결의 제거 레일 수가 분리 한도를 초과합니다");
		if (
			relationship.connectionGroups[0].legs.some((leg) => leg.exclusiveCutEdges.length === 0) ||
			cuts.some((cut) => cut.scope.kind !== "PARENT_DIRECT")
		)
			fail("CUT_MISMATCH", "Fab 전용 왕복 연결 레일만 제거할 수 있습니다");
		const cutKeys = new Set(cuts.map((cut) => staticFabOrganizationEdgeKey(cut.edge)));
		const ownership = buildRailModuleOwnershipIndex(map);
		const cutModuleEdgeKeys = new Set<string>();
		for (const module of ownership.modules) {
			if (!module.eraseEdges.some((edge) => cutKeys.has(staticFabOrganizationEdgeKey(edge))))
				continue;
			if (
				module.advancedSwitchId !== null ||
				module.eraseEdges.some((edge) => !cutKeys.has(staticFabOrganizationEdgeKey(edge)))
			)
				fail("CUT_MISMATCH", "제거 연결이 공유 레일 부품 또는 고급 스위치를 침범합니다");
			for (const edge of module.eraseEdges)
				cutModuleEdgeKeys.add(staticFabOrganizationEdgeKey(edge));
		}
		for (const record of relationships.records) {
			if (record.id === relationship.id) continue;
			const references = [
				record.parentOrganizationId,
				...record.participantOrganizationIds,
				...record.managedChildOrganizationIds,
			];
			for (const scoped of scopedEdges(record)) {
				if (scoped.scope.kind !== "PARENT_DIRECT")
					references.push(...scoped.scope.directOwnerOrganizationIds);
				if (cutModuleEdgeKeys.has(staticFabOrganizationEdgeKey(scoped.edge)))
					fail(
						"SHARED_RELATIONSHIP",
						`관계 ${record.id}의 연결·support·witness가 제거할 레일 부품을 공유합니다`,
					);
			}
			if (
				references.some((id) => selectedIds.has(id)) &&
				references.some((id) => !selectedIds.has(id))
			)
				fail(
					"SHARED_RELATIONSHIP",
					`관계 ${record.id}가 선택 Bank와 남은 Fab에 걸쳐 있습니다 · 함께 재작성하지 않습니다`,
				);
		}
		const cut = reviewStaticFabSemanticHierarchyCut(
			map,
			portEquipment,
			organizations,
			intent,
			hierarchy,
		);
		if (!cut.structuralCutProved || !cut.completeCutFingerprint) fail("CUT_MISMATCH", cut.reason);
		const structuralKeys = new Set(cut.corridors.flatMap((corridor) => corridor.directedEdgeKeys));
		if (
			cutKeys.size !== cuts.length ||
			structuralKeys.size !== cutKeys.size ||
			[...cutKeys].some((key) => !structuralKeys.has(key))
		)
			fail("CUT_MISMATCH", "저장된 관계의 제거 레일과 현재 Bank의 전체 경계가 일치하지 않습니다");

		const changes = removalMutations(
			map,
			cuts.map((cut) => cut.edge),
		);
		const nextMap = map.clone();
		if (!nextMap.applyAtomicMutations(changes, []))
			fail("PROSPECTIVE_INVALID", "분리할 연결 레일이 없습니다");
		const bank = organizations.records.find((record) => record.id === intent.targetOrganizationId);
		const fab = organizations.records.find(
			(record) => record.id === intent.expectedParentOrganizationId,
		);
		if (!bank || !fab) fail("HIERARCHY_REJECTED", "Bank 또는 Fab 원본이 없습니다");
		const organizationChanges: readonly StaticFabOrganizationMutation[] = Object.freeze(
			[
				{
					id: bank.id,
					before: bank,
					after: copyStaticFabOrganizationRecord({ ...bank, parentOrganizationIds: [] }),
				},
				{
					id: fab.id,
					before: fab,
					after: copyStaticFabOrganizationRecord({
						...fab,
						membership: {
							...fab.membership,
							railEdges: fab.membership.railEdges.filter(
								(edge) => !cutKeys.has(staticFabOrganizationEdgeKey(edge)),
							),
						},
					}),
				},
			]
				.sort((left, right) => left.id - right.id)
				.map((entry) => Object.freeze(entry)),
		);
		const nextOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			organizationChanges,
			organizations.nextOrganizationId,
			true,
		);
		const relationshipChanges = Object.freeze([
			Object.freeze({
				id: relationship.id,
				before: copyStaticFabAssemblyRelationshipRecord(relationship),
				after: null,
			}),
		]);
		const nextRelationships = applyStaticFabAssemblyRelationshipMutations(
			relationships,
			relationshipChanges,
			relationships.nextRelationshipId,
		);
		const nextRoles = deriveStaticFabOrganizationSemanticRoles(nextOrganizations);
		if (nextRoles.get(fab.id) !== "FAB" || nextRoles.get(bank.id) !== "BAY_BANK")
			fail("PROSPECTIVE_INVALID", "분리 후 Bank 또는 남은 Fab의 의미 역할을 유지할 수 없습니다");
		const prospectiveError =
			staticFabOrganizationStateError(nextMap, portEquipment, nextOrganizations) ??
			staticFabAssemblyRelationshipStateSourceError(nextMap, nextOrganizations, nextRelationships);
		if (prospectiveError) fail("PROSPECTIVE_INVALID", prospectiveError);
		assertPortEquipmentLayout(nextMap, portEquipment);
		const impactIndex = new StaticFabOrganizationImpactIndex();
		impactIndex.synchronize(organizations);
		const impacts = staticFabOrganizationImpactsForPatch(
			impactIndex,
			changes,
			[],
			[],
			[],
			portEquipment,
			portEquipment,
		);
		const forwardUnhandled = unhandledStaticFabOrganizationImpacts(
			impactIndex,
			impacts,
			organizationChanges,
			changes,
			[],
			[],
			[],
			portEquipment,
			portEquipment,
		);
		const afterIndex = new StaticFabOrganizationImpactIndex();
		afterIndex.synchronize(nextOrganizations);
		const reverseChanges = changes.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		}));
		const reverseImpacts = staticFabOrganizationImpactsForPatch(
			afterIndex,
			reverseChanges,
			[],
			[],
			[],
			portEquipment,
			portEquipment,
		);
		const reverseUnhandled = unhandledStaticFabOrganizationImpacts(
			afterIndex,
			reverseImpacts,
			reverseStaticFabOrganizationMutations(organizationChanges),
			reverseChanges,
			[],
			[],
			[],
			portEquipment,
			portEquipment,
		);
		const authorizedIds = new Set(
			[...forwardUnhandled, ...reverseUnhandled].map((owner) => owner.organizationId),
		);
		if (
			[...authorizedIds].some(
				(id) =>
					!impacts.some((owner) => owner.organizationId === id) ||
					!reverseImpacts.some((owner) => owner.organizationId === id),
			)
		)
			fail(
				"PROSPECTIVE_INVALID",
				"Bank 분리의 보호된 접점 소유권을 Undo/Redo 양쪽에서 증명할 수 없습니다",
			);
		// Exact rail ownership changes are already handled above. Only surviving seam owners
		// need the cell-level impact exemption, with identical authority in both directions.
		const authorizations = Object.freeze([...authorizedIds].sort((left, right) => left - right));
		const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
		const selectedOrganizations = organizations.records.filter((record) =>
			selectedIds.has(record.id),
		);
		const groupIds = new Set(
			selectedOrganizations.flatMap((record) => record.membership.equipmentGroupIds),
		);
		const selectedEdgeKeys = new Set(
			selectedOrganizations.flatMap((record) =>
				record.membership.railEdges.map(staticFabOrganizationEdgeKey),
			),
		);
		const selectedSwitchIds = new Set(
			selectedOrganizations.flatMap((record) => record.membership.advancedSwitchIds),
		);
		const preservedModules = ownership.modules.filter(
			(module) =>
				(module.advancedSwitchId !== null && selectedSwitchIds.has(module.advancedSwitchId)) ||
				module.eraseEdges.some((edge) => selectedEdgeKeys.has(staticFabOrganizationEdgeKey(edge))),
		);
		const removedModules = ownership.modules.filter((module) =>
			module.eraseEdges.some((edge) => cutKeys.has(staticFabOrganizationEdgeKey(edge))),
		);
		const preservedBayIds = [...selectedIds].filter((id) => roles.get(id) === "BAY");
		const preservedLoopIds = [...selectedIds].filter((id) => roles.get(id) === "PROCESS_LOOP");
		const preservedPortIds = portEquipment.ports
			.filter((port) => groupIds.has(port.equipmentGroupId))
			.map((port) => port.id);
		const review: StaticFabSemanticBankDetachReview = Object.freeze({
			version: 1,
			bankOrganizationId: bank.id,
			bankName: bank.name,
			fabOrganizationId: fab.id,
			fabName: fab.name,
			preservedOrganizationCount: selectedIds.size,
			preservedBayCount: preservedBayIds.length,
			preservedLoopCount: preservedLoopIds.length,
			preservedPortCount: preservedPortIds.length,
			preservedEquipmentGroupCount: groupIds.size,
			preservedRailModuleCount: preservedModules.length,
			preservedAdvancedSwitchCount: selectedSwitchIds.size,
			preservedOrganizationIdSample: numberSample([...selectedIds]),
			preservedBayIdSample: numberSample(preservedBayIds),
			preservedLoopIdSample: numberSample(preservedLoopIds),
			preservedPortIdSample: numberSample(preservedPortIds),
			preservedEquipmentGroupIdSample: numberSample([...groupIds]),
			preservedRailModuleKeySample: stringSample(preservedModules.map((module) => module.key)),
			preservedAdvancedSwitchIdSample: numberSample([...selectedSwitchIds]),
			removedRelationshipIds: Object.freeze([relationship.id]),
			removedDirectedEdgeCount: cuts.length,
			removedRailModuleCount: removedModules.length,
			removedAdvancedSwitchCount: 0,
			removedCorridorCount: cut.corridorCount,
			removedRailModuleKeySample: stringSample(removedModules.map((module) => module.key)),
			removedCorridorIdSample: stringSample(cut.corridors.map((corridor) => corridor.fingerprint)),
			retainedBankCount: cut.retainedSiblingBankOrganizationCount,
			structuralCutFingerprint: cut.completeCutFingerprint,
		});
		const transition: RailPatchTransition = Object.freeze({
			changes,
			switchChanges: Object.freeze([]),
			portChanges: Object.freeze([]),
			equipmentGroupChanges: Object.freeze([]),
			organizationChanges,
			organizationNextIdBefore: organizations.nextOrganizationId,
			organizationNextIdAfter: organizations.nextOrganizationId,
			organizationImpactAuthorizations: authorizations,
			operationalConfigurationPatch: null,
			relationshipChanges,
			relationshipNextIdBefore: relationships.nextRelationshipId,
			relationshipNextIdAfter: relationships.nextRelationshipId,
		});
		const plan = Object.freeze({
			kind: STATIC_FAB_SEMANTIC_BANK_DETACH_KIND,
			baseRevision: map.getRevision(),
			basePatchSequence: patchSequence,
			intent,
			review,
			transition,
		});
		return Object.freeze({
			valid: true,
			plan,
			prospectiveState: Object.freeze({
				map: nextMap,
				portEquipment,
				organizations: nextOrganizations,
				relationships: nextRelationships,
			}),
			issueCode: null,
			reason: "Bank 내부 구성과 모든 장비·Port를 보존하며 Fab 연결만 분리합니다",
		});
	} catch (error) {
		return Object.freeze({
			valid: false,
			plan: null,
			prospectiveState: null,
			issueCode: error instanceof BankDetachFailure ? error.code : "INVALID_SOURCE",
			reason: error instanceof Error ? error.message : "Bank 분리 원본을 검토할 수 없습니다",
		});
	}
}

function numberSample(values: number[]): readonly number[] {
	return Object.freeze(
		values
			.sort((left, right) => left - right)
			.slice(0, STATIC_FAB_SEMANTIC_BANK_DETACH_ID_SAMPLE_LIMIT),
	);
}

function stringSample(values: string[]): readonly string[] {
	return Object.freeze(values.sort().slice(0, STATIC_FAB_SEMANTIC_BANK_DETACH_ID_SAMPLE_LIMIT));
}

function* scopedEdges(
	record: StaticFabAssemblyRelationshipRecordV1,
): Generator<StaticFabAssemblyScopedEdgeV1> {
	for (const group of record.connectionGroups)
		for (const leg of group.legs) {
			yield* leg.exclusiveCutEdges;
			for (const support of leg.endpointSupports) yield support.support;
			for (const seam of leg.seamContacts)
				for (const incidence of seam.incidences)
					if (incidence.binding.kind === "WITNESS") yield incidence.binding.scopedEdge;
		}
}

function removalMutations(
	map: TileMap,
	edges: readonly DirectedRailEdge[],
): readonly RailMutation[] {
	const overlay = new Map<string, RailMutation>();
	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, after: number): void => {
		const key = cellKey(cell.x, cell.y);
		overlay.set(key, {
			...cell,
			before: overlay.get(key)?.before ?? map.getEncoded(cell.x, cell.y),
			after,
		});
	};
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) fail("CUT_MISMATCH", "연결 레일이 cardinal edge가 아닙니다");
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		if (!(from.outgoing & direction) || !(to.incoming & opposite))
			fail("CUT_MISMATCH", "제거할 연결 레일이 원본에 없습니다");
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
	}
	const changes = Object.freeze(
		[...overlay.values()]
			.filter((change) => change.before !== change.after)
			.sort((left, right) => left.y - right.y || left.x - right.x)
			.map((entry) => Object.freeze(entry)),
	);
	const error = railMutationTopologyError(map, changes);
	if (error) fail("CUT_MISMATCH", error);
	return changes;
}

class BankDetachFailure extends Error {
	readonly code: StaticFabSemanticBankDetachIssueCode;
	constructor(code: StaticFabSemanticBankDetachIssueCode, reason: string) {
		super(reason);
		this.code = code;
	}
}

function fail(code: StaticFabSemanticBankDetachIssueCode, reason: string): never {
	throw new BankDetachFailure(code, reason);
}
