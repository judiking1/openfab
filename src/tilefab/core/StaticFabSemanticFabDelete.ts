import {
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	type OperationalConfigurationState,
	operationalConfigurationStateError,
} from "./OperationalConfiguration";
import { assertPortEquipmentLayout } from "./PortEquipmentLayoutValidator";
import { copyPortRecord } from "./PortRecord";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { type RailPatchTransition, railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	applyStaticFabAssemblyRelationshipMutations,
	copyStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	applyStaticFabOrganizationMutations,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	resolveStaticFabOrganizationCoverage,
	reverseStaticFabOrganizationMutations,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import type { StaticFabSemanticBankDetachProspectiveState } from "./StaticFabSemanticBankDetach";
import {
	exactDeletedAdvancedSwitchBoundaryEdges,
	exactStaticFabOrganizationImpactAuthorizations,
	planDirectedEdgeRemoval,
} from "./StaticFabSemanticBayMutation";
import {
	assertNoOperationalReferences,
	StaticFabSemanticDeleteFailure as DeleteFailure,
	staticFabSemanticDeleteDirectedEdgeSample as directedEdgeSample,
	failStaticFabSemanticDelete as fail,
	createStaticFabSemanticDeleteImpact as impact,
	staticFabSemanticDeleteErrorMessage as message,
	relationshipOrganizationIds,
	type StaticFabSemanticDeleteImpact as StaticFabSemanticFabDeleteImpact,
} from "./StaticFabSemanticDeleteSupport";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	type StaticFabSemanticHierarchyRecoveryIntent,
	staticFabSemanticHierarchyRecoveryIntentError,
} from "./StaticFabSemanticHierarchyRecovery";
import { TileMap } from "./TileMap";

export const STATIC_FAB_SEMANTIC_FAB_DELETE_KIND = "delete-static-fab" as const;
export const STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS = 100_000;
export const STATIC_FAB_SEMANTIC_FAB_DELETE_ID_SAMPLE_LIMIT = 8;
export interface StaticFabSemanticFabDeleteIntent extends StaticFabSemanticHierarchyRecoveryIntent {
	readonly action: "DELETE";
	readonly targetRole: "FAB";
	readonly expectedParentOrganizationId: null;
}
export type {
	StaticFabSemanticDeleteImpact as StaticFabSemanticFabDeleteImpact,
	StaticFabSemanticDeleteImpactSample as StaticFabSemanticFabDeleteImpactSample,
} from "./StaticFabSemanticDeleteSupport";
export { STATIC_FAB_SEMANTIC_DELETE_IMPACT_KEYS as STATIC_FAB_SEMANTIC_FAB_DELETE_IMPACT_KEYS } from "./StaticFabSemanticDeleteSupport";
export interface StaticFabSemanticFabDeleteReview {
	readonly version: 1;
	readonly fabOrganizationId: number;
	readonly fabName: string;
	readonly removed: StaticFabSemanticFabDeleteImpact;
	readonly preserved: StaticFabSemanticFabDeleteImpact;
}
export interface StaticFabSemanticFabDeletePlan {
	readonly kind: typeof STATIC_FAB_SEMANTIC_FAB_DELETE_KIND;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly intent: StaticFabSemanticFabDeleteIntent;
	readonly review: StaticFabSemanticFabDeleteReview;
	readonly transition: RailPatchTransition;
}
export type StaticFabSemanticFabDeletePlanningResult =
	| Readonly<{
			valid: true;
			plan: StaticFabSemanticFabDeletePlan;
			prospectiveState: StaticFabSemanticBankDetachProspectiveState;
			deletedMap: TileMap;
			issueCode: null;
			reason: string;
	  }>
	| Readonly<{
			valid: false;
			plan: null;
			prospectiveState: null;
			deletedMap: null;
			issueCode: string;
			reason: string;
	  }>;

export function staticFabSemanticFabDeleteIntentError(value: unknown): string | null {
	const error = staticFabSemanticHierarchyRecoveryIntentError(value);
	if (error) return error;
	const intent = value as StaticFabSemanticHierarchyRecoveryIntent;
	return intent.action === "DELETE" &&
		intent.targetRole === "FAB" &&
		intent.expectedParentOrganizationId === null
		? null
		: "Fab 삭제는 DELETE / root FAB intent만 지원합니다";
}

export function planStaticFabSemanticFabDelete(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	operations: OperationalConfigurationState,
	intentValue: unknown,
): StaticFabSemanticFabDeletePlanningResult {
	try {
		const intentError = staticFabSemanticFabDeleteIntentError(intentValue);
		if (intentError) fail("INVALID_INTENT", intentError);
		const intent = Object.freeze({ ...(intentValue as StaticFabSemanticFabDeleteIntent) });
		if (!Number.isSafeInteger(patchSequence) || patchSequence < 0)
			fail("INVALID_SOURCE", "문서 순서가 유효하지 않습니다");
		if (
			map.size > STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS ||
			portEquipment.ports.length > STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS ||
			organizations.records.length > 4_096
		)
			fail("BUDGET_EXCEEDED", "Fab 삭제 원본의 rail/Port/조직 검토 한도를 초과했습니다");
		const hierarchy = reviewStaticFabSemanticHierarchyRecovery(organizations, intent);
		if (!hierarchy.accepted) fail("HIERARCHY_REJECTED", hierarchy.reason);
		// Explain unsupported authored equipment before expensive whole-source geometry checks.
		const equipmentScope = resolveStaticFabOrganizationCoverage(
			organizations,
			intent.targetOrganizationId,
		)?.effective;
		if (!equipmentScope) fail("HIERARCHY_REJECTED", "Fab의 장비 소유 범위를 찾을 수 없습니다");
		const scopedGroupIds = new Set(equipmentScope.equipmentGroupIds);
		const scopedEdges = new Set(equipmentScope.railEdges.map(staticFabOrganizationEdgeKey));
		const scopedSwitches = new Set(equipmentScope.advancedSwitchIds);
		for (const group of portEquipment.equipmentGroups) {
			if (scopedGroupIds.has(group.id) && group.kind === "STK" && group.template === "CUSTOM")
				fail(
					"CUSTOM_EQUIPMENT",
					`legacy CUSTOM STK ${group.id}는 Fab 일괄 삭제를 지원하지 않습니다`,
				);
		}
		for (const port of portEquipment.ports) {
			if (
				scopedGroupIds.has(port.equipmentGroupId) &&
				!staticFabOrganizationMembershipSupportsPortRoute(port.route, scopedEdges, scopedSwitches)
			)
				fail(
					"PARTIAL_EQUIPMENT",
					`장비 ${port.equipmentGroupId}의 PORT-${port.id}가 Fab 밖 레일을 참조합니다`,
				);
		}
		const error =
			staticFabOrganizationStateError(map, portEquipment, organizations) ??
			staticFabAssemblyRelationshipStateSourceError(map, organizations, relationships) ??
			operationalConfigurationStateError(operations);
		if (error) fail("INVALID_SOURCE", error);
		assertPortEquipmentLayout(map, portEquipment);
		const coverage = resolveStaticFabOrganizationCoverage(
			organizations,
			intent.targetOrganizationId,
		);
		if (!coverage) fail("HIERARCHY_REJECTED", "Fab의 전체 하위 소유권을 찾을 수 없습니다");
		const selectedIds = new Set([
			intent.targetOrganizationId,
			...coverage.descendantOrganizationIds,
		]);
		const edges = new Set(coverage.effective.railEdges.map(staticFabOrganizationEdgeKey));
		const switches = new Set(coverage.effective.advancedSwitchIds);
		const groups = new Set(coverage.effective.equipmentGroupIds);
		for (const row of organizations.records) {
			if (selectedIds.has(row.id)) continue;
			if (
				row.membership.railEdges.some((edge) => edges.has(staticFabOrganizationEdgeKey(edge))) ||
				row.membership.advancedSwitchIds.some((id) => switches.has(id)) ||
				row.membership.equipmentGroupIds.some((id) => groups.has(id))
			)
				fail(
					"SHARED_OWNERSHIP",
					`유지할 조직 ${row.id} '${row.name}'이 삭제 Fab의 레일·스위치·장비를 공유합니다`,
				);
		}
		const ownership = buildRailModuleOwnershipIndex(map);
		if (ownership.modules.length > STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS)
			fail("BUDGET_EXCEEDED", "Fab 삭제 모듈 검토 한도를 초과했습니다");
		const modules = ownership.modules.filter(
			(module) =>
				module.eraseEdges.some((edge) => edges.has(staticFabOrganizationEdgeKey(edge))) ||
				(module.advancedSwitchId !== null && switches.has(module.advancedSwitchId)),
		);
		const resolvedEdges = new Set<string>();
		const resolvedSwitches = new Set<number>();
		for (const module of modules) {
			if (
				module.eraseEdges.some((edge) => !edges.has(staticFabOrganizationEdgeKey(edge))) ||
				(module.advancedSwitchId !== null && !switches.has(module.advancedSwitchId))
			)
				fail("PARTIAL_MODULE", `삭제 소유권이 전체 모듈 ${module.key}을 포함하지 않습니다`);
			for (const edge of module.eraseEdges) resolvedEdges.add(staticFabOrganizationEdgeKey(edge));
			if (module.advancedSwitchId !== null) resolvedSwitches.add(module.advancedSwitchId);
		}
		if (
			!modules.length ||
			resolvedEdges.size !== edges.size ||
			resolvedSwitches.size !== switches.size
		)
			fail("PARTIAL_MODULE", "Fab 소유권이 정확한 전체 모듈 집합이 아닙니다");
		const deletedGroups = portEquipment.equipmentGroups.filter((group) => groups.has(group.id));
		const deletedPorts = portEquipment.ports.filter((port) => groups.has(port.equipmentGroupId));
		const portIds = new Set(deletedPorts.map((port) => port.id));
		for (const group of deletedGroups) {
			if (group.kind === "STK" && group.template === "CUSTOM")
				fail(
					"CUSTOM_EQUIPMENT",
					`legacy CUSTOM STK ${group.id}는 Fab 일괄 삭제를 지원하지 않습니다`,
				);
			if (group.portIds.some((id) => !portIds.has(id)))
				fail("PARTIAL_EQUIPMENT", `장비 ${group.id}의 모든 Port가 삭제 범위에 없습니다`);
		}
		for (const port of deletedPorts)
			if (!staticFabOrganizationMembershipSupportsPortRoute(port.route, edges, switches))
				fail(
					"PARTIAL_EQUIPMENT",
					`장비 ${port.equipmentGroupId}의 PORT-${port.id}가 Fab 밖 레일을 참조합니다`,
				);
		assertNoOperationalReferences(operations, groups, portIds, "Fab");
		const selectedKeys = new Set(modules.map((module) => module.key));
		const indices = ownership.modules.flatMap((module, index) =>
			selectedKeys.has(module.key) ? [index] : [],
		);
		const boundaryEdges = exactDeletedAdvancedSwitchBoundaryEdges(
			map,
			ownership,
			indices,
			[...switches],
			[],
		);
		const railDelete = planDirectedEdgeRemoval(
			map,
			[...modules.flatMap((module) => module.eraseEdges), ...boundaryEdges],
			[...switches],
		);
		// An isolated whole root Fab can have no surviving rail bit at a deleted cell.
		if (railDelete.mutations.some((change) => change.after !== 0))
			fail(
				"EXTERNAL_RAIL_REFERENCE",
				"Fab의 레일 접점이 외부 또는 무소속 레일과 연결되어 있습니다",
			);
		const nextMap = map.clone();
		nextMap.applyAtomicMutations(railDelete.mutations, railDelete.switchMutations);
		const deletedHydrator = TileMap.createHydrator();
		for (const change of railDelete.mutations)
			deletedHydrator.addEncodedCell(change.x, change.y, change.before);
		for (const change of railDelete.switchMutations)
			if (change.before) deletedHydrator.addAdvancedSwitch(change.before);
		const deletedMap = deletedHydrator.finish(0, map.getAdvancedSwitchIdCursor());
		const portChanges = Object.freeze(
			deletedPorts.map((port) =>
				Object.freeze({ id: port.id, before: copyPortRecord(port), after: null }),
			),
		);
		const equipmentGroupChanges = Object.freeze(
			deletedGroups.map((group) =>
				Object.freeze({ id: group.id, before: copyEquipmentGroupRecord(group), after: null }),
			),
		);
		const nextEquipment = applyPortEquipmentMutations(
			portEquipment,
			portChanges,
			equipmentGroupChanges,
		);
		try {
			assertPortEquipmentLayout(nextMap, nextEquipment);
		} catch (error) {
			fail("EXTERNAL_PORT_REFERENCE", `보존할 Port가 삭제 레일을 참조합니다 · ${message(error)}`);
		}
		const removedRelationships = relationships.records.filter((row) => {
			const ids = relationshipOrganizationIds(row);
			if (!ids.some((id) => selectedIds.has(id))) return false;
			if (ids.some((id) => !selectedIds.has(id)))
				fail(
					"EXTERNAL_RELATIONSHIP",
					`관계 ${row.id}가 삭제 Fab 밖 조직·support·witness를 참조합니다`,
				);
			return true;
		});
		const allRemovedRelationshipIds = new Set([...removedRelationships.map((row) => row.id)]);
		const relationshipChanges = Object.freeze(
			relationships.records
				.filter((row) => allRemovedRelationshipIds.has(row.id))
				.map((row) =>
					Object.freeze({
						id: row.id,
						before: copyStaticFabAssemblyRelationshipRecord(row),
						after: null,
					}),
				),
		);
		const organizationChanges = Object.freeze(
			organizations.records.flatMap((row) => {
				if (selectedIds.has(row.id))
					return [
						Object.freeze({
							id: row.id,
							before: copyStaticFabOrganizationRecord(row),
							after: null,
						}),
					];
				return [];
			}),
		);
		const nextOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			organizationChanges,
			organizations.nextOrganizationId,
			true,
		);
		const nextRelationships = applyStaticFabAssemblyRelationshipMutations(
			relationships,
			relationshipChanges,
			relationships.nextRelationshipId,
		);
		const prospectiveError =
			staticFabOrganizationStateError(nextMap, nextEquipment, nextOrganizations) ??
			staticFabAssemblyRelationshipStateSourceError(nextMap, nextOrganizations, nextRelationships);
		if (prospectiveError)
			fail(
				"EXTERNAL_REFERENCE",
				`삭제 후 외부 소유권·관계가 유효하지 않습니다 · ${prospectiveError}`,
			);
		const changes = railDelete.mutations;
		const finalMap = nextMap;
		const forward = exactStaticFabOrganizationImpactAuthorizations(
			organizations,
			organizationChanges,
			changes,
			railDelete.switchMutations,
			portChanges,
			equipmentGroupChanges,
			portEquipment,
			nextEquipment,
		);
		const reverse = exactStaticFabOrganizationImpactAuthorizations(
			nextOrganizations,
			reverseStaticFabOrganizationMutations(organizationChanges),
			changes.map((change) => ({ ...change, before: change.after, after: change.before })),
			railDelete.switchMutations.map((change) => ({
				...change,
				before: change.after,
				after: change.before,
			})),
			portChanges.map((change) => ({ ...change, before: change.after, after: change.before })),
			equipmentGroupChanges.map((change) => ({
				...change,
				before: change.after,
				after: change.before,
			})),
			nextEquipment,
			portEquipment,
		);
		const authorizations = Object.freeze(
			[...new Set([...forward, ...reverse])].sort((a, b) => a - b),
		);
		if (authorizations.length > 0)
			fail("INVALID_TRANSITION", "EXCLUSIVE root Fab 삭제가 보존할 조직의 레일 접점을 침범합니다");
		const transition: RailPatchTransition = Object.freeze({
			changes,
			switchChanges: railDelete.switchMutations,
			portChanges,
			equipmentGroupChanges,
			organizationChanges,
			organizationNextIdBefore: organizations.nextOrganizationId,
			organizationNextIdAfter: organizations.nextOrganizationId,
			organizationImpactAuthorizations: authorizations,
			operationalConfigurationPatch: null,
			relationshipChanges,
			relationshipNextIdBefore: relationships.nextRelationshipId,
			relationshipNextIdAfter: relationships.nextRelationshipId,
		});
		const removedRows = organizations.records.filter((row) => selectedIds.has(row.id));
		const nextOwnership = buildRailModuleOwnershipIndex(finalMap);
		const fab = organizations.records.find((row) => row.id === intent.targetOrganizationId);
		if (!fab) fail("HIERARCHY_REJECTED", "삭제할 root Fab 원본이 없습니다");
		const review: StaticFabSemanticFabDeleteReview = Object.freeze({
			version: 1,
			fabOrganizationId: fab.id,
			fabName: fab.name,
			removed: impact(
				organizations,
				removedRows,
				modules.map((module) => module.key),
				railDelete.switchMutations.map((row) => row.id),
				deletedGroups.map((row) => row.id),
				deletedPorts.map((row) => row.id),
				relationships.records.filter((row) => allRemovedRelationshipIds.has(row.id)),
				map.edgeCount - finalMap.edgeCount,
				directedEdgeSample(map, finalMap),
			),
			preserved: impact(
				nextOrganizations,
				nextOrganizations.records,
				nextOwnership.modules.map((module) => module.key),
				nextOwnership.modules.flatMap((module) =>
					module.advancedSwitchId === null ? [] : [module.advancedSwitchId],
				),
				nextEquipment.equipmentGroups.map((row) => row.id),
				nextEquipment.ports.map((row) => row.id),
				nextRelationships.records,
				finalMap.edgeCount,
				directedEdgeSample(finalMap),
			),
		});
		const plan = Object.freeze({
			kind: STATIC_FAB_SEMANTIC_FAB_DELETE_KIND,
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
				map: finalMap,
				portEquipment: nextEquipment,
				organizations: nextOrganizations,
				relationships: nextRelationships,
			}),
			deletedMap,
			issueCode: null,
			reason: `Fab '${fab.name}'의 독점 소유 하위 조직·레일·장비·Port를 하나의 명령으로 삭제합니다`,
		});
	} catch (error) {
		return Object.freeze({
			valid: false,
			plan: null,
			prospectiveState: null,
			deletedMap: null,
			issueCode: error instanceof DeleteFailure ? error.code : "INVALID_SOURCE",
			reason: message(error),
		});
	}
}

export function assertStaticFabSemanticFabDeletePatchSource(
	map: TileMap,
	equipment: PortEquipmentState,
	sequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	operations: OperationalConfigurationState,
	patch: RailPatchTransition,
): void {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const targets = patch.organizationChanges.filter(
		(change) => change.after === null && roles.get(change.id) === "FAB",
	);
	if (targets.length !== 1 || !targets[0]?.before)
		throw new Error("Fab 삭제 patch에는 정확히 하나의 root Fab 제거가 필요합니다");
	const target = targets[0].before;
	const planned = planStaticFabSemanticFabDelete(
		map,
		equipment,
		sequence,
		organizations,
		relationships,
		operations,
		{
			version: 1,
			action: "DELETE",
			targetRole: "FAB",
			targetOrganizationId: target.id,
			expectedParentOrganizationId: null,
		},
	);
	if (!planned.valid) throw new Error(planned.reason);
	if (
		railPatchTransitionFingerprint(patch) !==
		railPatchTransitionFingerprint(planned.plan.transition)
	)
		throw new Error("Fab 삭제 patch가 원본의 정확한 독점 삭제 범위와 다릅니다");
}
