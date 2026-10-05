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
import { type RailMutation, railMutationTopologyError } from "./paint";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { type RailPatchTransition, railPatchTransitionFingerprint } from "./RailPatchHistory";
import { ALL_DIRECTIONS, moveCell } from "./railShape";
import {
	applyStaticFabAssemblyRelationshipMutations,
	copyStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
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
	staticFabOrganizationParentIds,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	planStaticFabSemanticBankDetach,
	type StaticFabSemanticBankDetachProspectiveState,
} from "./StaticFabSemanticBankDetach";
import {
	exactDeletedAdvancedSwitchBoundaryEdges,
	exactStaticFabOrganizationImpactAuthorizations,
	planDirectedEdgeRemoval,
} from "./StaticFabSemanticBayMutation";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	type StaticFabSemanticHierarchyRecoveryIntent,
	staticFabSemanticHierarchyRecoveryIntentError,
} from "./StaticFabSemanticHierarchyRecovery";
import { cellKey, TileMap } from "./TileMap";

export const STATIC_FAB_SEMANTIC_BANK_DELETE_KIND = "delete-static-fab-bank" as const;
export const STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS = 100_000;
export const STATIC_FAB_SEMANTIC_BANK_DELETE_ID_SAMPLE_LIMIT = 8;
export interface StaticFabSemanticBankDeleteIntent
	extends StaticFabSemanticHierarchyRecoveryIntent {
	readonly action: "DELETE";
	readonly targetRole: "BAY_BANK";
}
export interface StaticFabSemanticBankDeleteImpactSample {
	readonly count: number;
	readonly idSample: readonly (number | string)[];
	readonly omittedCount: number;
}
export const STATIC_FAB_SEMANTIC_BANK_DELETE_IMPACT_KEYS = [
	"organizations",
	"bays",
	"loops",
	"banks",
	"fabs",
	"railModules",
	"advancedSwitches",
	"equipmentGroups",
	"ports",
	"relationships",
	"corridors",
	"directedEdges",
] as const;
export type StaticFabSemanticBankDeleteImpact = Readonly<
	Record<
		(typeof STATIC_FAB_SEMANTIC_BANK_DELETE_IMPACT_KEYS)[number],
		StaticFabSemanticBankDeleteImpactSample
	>
>;
export interface StaticFabSemanticBankDeleteReview {
	readonly version: 1;
	readonly bankOrganizationId: number;
	readonly bankName: string;
	readonly parentFabOrganizationId: number | null;
	readonly parentFabName: string | null;
	readonly includesDetach: boolean;
	readonly removed: StaticFabSemanticBankDeleteImpact;
	readonly preserved: StaticFabSemanticBankDeleteImpact;
}
export interface StaticFabSemanticBankDeletePlan {
	readonly kind: typeof STATIC_FAB_SEMANTIC_BANK_DELETE_KIND;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly intent: StaticFabSemanticBankDeleteIntent;
	readonly review: StaticFabSemanticBankDeleteReview;
	readonly transition: RailPatchTransition;
}
export type StaticFabSemanticBankDeletePlanningResult =
	| Readonly<{
			valid: true;
			plan: StaticFabSemanticBankDeletePlan;
			prospectiveState: StaticFabSemanticBankDetachProspectiveState;
			detachedState: StaticFabSemanticBankDetachProspectiveState;
			deletedMap: TileMap;
			issueCode: null;
			reason: string;
	  }>
	| Readonly<{
			valid: false;
			plan: null;
			prospectiveState: null;
			detachedState: null;
			deletedMap: null;
			issueCode: string;
			reason: string;
	  }>;

export function staticFabSemanticBankDeleteIntentError(value: unknown): string | null {
	const error = staticFabSemanticHierarchyRecoveryIntentError(value);
	if (error) return error;
	const intent = value as StaticFabSemanticHierarchyRecoveryIntent;
	return intent.action === "DELETE" && intent.targetRole === "BAY_BANK"
		? null
		: "Bank 삭제는 DELETE / BAY_BANK intent만 지원합니다";
}

export function planStaticFabSemanticBankDelete(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	operations: OperationalConfigurationState,
	intentValue: unknown,
): StaticFabSemanticBankDeletePlanningResult {
	try {
		const intentError = staticFabSemanticBankDeleteIntentError(intentValue);
		if (intentError) fail("INVALID_INTENT", intentError);
		const intent = Object.freeze({ ...(intentValue as StaticFabSemanticBankDeleteIntent) });
		if (!Number.isSafeInteger(patchSequence) || patchSequence < 0)
			fail("INVALID_SOURCE", "문서 순서가 유효하지 않습니다");
		if (
			map.size > STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS ||
			portEquipment.ports.length > STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS ||
			organizations.records.length > 4_096
		)
			fail("BUDGET_EXCEEDED", "Bank 삭제 원본의 rail/Port/조직 검토 한도를 초과했습니다");
		const hierarchy = reviewStaticFabSemanticHierarchyRecovery(organizations, intent);
		if (!hierarchy.accepted) fail("HIERARCHY_REJECTED", hierarchy.reason);
		// Explain unsupported authored equipment before expensive whole-source geometry checks.
		const equipmentScope = resolveStaticFabOrganizationCoverage(
			organizations,
			intent.targetOrganizationId,
		)?.effective;
		if (!equipmentScope) fail("HIERARCHY_REJECTED", "Bank의 장비 소유 범위를 찾을 수 없습니다");
		const scopedGroupIds = new Set(equipmentScope.equipmentGroupIds);
		const scopedEdges = new Set(equipmentScope.railEdges.map(staticFabOrganizationEdgeKey));
		const scopedSwitches = new Set(equipmentScope.advancedSwitchIds);
		for (const group of portEquipment.equipmentGroups) {
			if (scopedGroupIds.has(group.id) && group.kind === "STK" && group.template === "CUSTOM")
				fail(
					"CUSTOM_EQUIPMENT",
					`legacy CUSTOM STK ${group.id}는 Bank 일괄 삭제를 지원하지 않습니다`,
				);
		}
		for (const port of portEquipment.ports) {
			if (
				scopedGroupIds.has(port.equipmentGroupId) &&
				!staticFabOrganizationMembershipSupportsPortRoute(port.route, scopedEdges, scopedSwitches)
			)
				fail(
					"PARTIAL_EQUIPMENT",
					`장비 ${port.equipmentGroupId}의 PORT-${port.id}가 Bank 밖 레일을 참조합니다`,
				);
		}
		const error =
			staticFabOrganizationStateError(map, portEquipment, organizations) ??
			staticFabAssemblyRelationshipStateSourceError(map, organizations, relationships) ??
			operationalConfigurationStateError(operations);
		if (error) fail("INVALID_SOURCE", error);
		assertPortEquipmentLayout(map, portEquipment);
		const source = { map, portEquipment, organizations, relationships };
		const detach =
			intent.expectedParentOrganizationId === null
				? null
				: planStaticFabSemanticBankDetach(
						map,
						portEquipment,
						patchSequence,
						organizations,
						relationships,
						{ ...intent, action: "DETACH" },
					);
		if (detach && !detach.valid) fail("DETACH_REJECTED", detach.reason);
		const intermediate = detach?.valid ? detach.prospectiveState : source;
		const coverage = resolveStaticFabOrganizationCoverage(
			intermediate.organizations,
			intent.targetOrganizationId,
		);
		if (!coverage) fail("HIERARCHY_REJECTED", "Bank의 전체 하위 소유권을 찾을 수 없습니다");
		const selectedIds = new Set([
			intent.targetOrganizationId,
			...coverage.descendantOrganizationIds,
		]);
		const edges = new Set(coverage.effective.railEdges.map(staticFabOrganizationEdgeKey));
		const switches = new Set(coverage.effective.advancedSwitchIds);
		const groups = new Set(coverage.effective.equipmentGroupIds);
		for (const row of intermediate.organizations.records) {
			if (selectedIds.has(row.id)) continue;
			if (
				row.membership.railEdges.some((edge) => edges.has(staticFabOrganizationEdgeKey(edge))) ||
				row.membership.advancedSwitchIds.some((id) => switches.has(id)) ||
				row.membership.equipmentGroupIds.some((id) => groups.has(id))
			)
				fail(
					"SHARED_OWNERSHIP",
					`유지할 조직 ${row.id} '${row.name}'이 삭제 Bank의 레일·스위치·장비를 공유합니다`,
				);
		}
		const ownership = buildRailModuleOwnershipIndex(intermediate.map);
		if (ownership.modules.length > STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS)
			fail("BUDGET_EXCEEDED", "Bank 삭제 모듈 검토 한도를 초과했습니다");
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
			fail("PARTIAL_MODULE", "Bank 소유권이 정확한 전체 모듈 집합이 아닙니다");
		const deletedGroups = portEquipment.equipmentGroups.filter((group) => groups.has(group.id));
		const deletedPorts = portEquipment.ports.filter((port) => groups.has(port.equipmentGroupId));
		const portIds = new Set(deletedPorts.map((port) => port.id));
		for (const group of deletedGroups) {
			if (group.kind === "STK" && group.template === "CUSTOM")
				fail(
					"CUSTOM_EQUIPMENT",
					`legacy CUSTOM STK ${group.id}는 Bank 일괄 삭제를 지원하지 않습니다`,
				);
			if (group.portIds.some((id) => !portIds.has(id)))
				fail("PARTIAL_EQUIPMENT", `장비 ${group.id}의 모든 Port가 삭제 범위에 없습니다`);
		}
		for (const port of deletedPorts)
			if (!staticFabOrganizationMembershipSupportsPortRoute(port.route, edges, switches))
				fail(
					"PARTIAL_EQUIPMENT",
					`장비 ${port.equipmentGroupId}의 PORT-${port.id}가 Bank 밖 레일을 참조합니다`,
				);
		assertNoOperationalReferences(operations, groups, portIds);
		const selectedKeys = new Set(modules.map((module) => module.key));
		const indices = ownership.modules.flatMap((module, index) =>
			selectedKeys.has(module.key) ? [index] : [],
		);
		const boundaryEdges = exactDeletedAdvancedSwitchBoundaryEdges(
			intermediate.map,
			ownership,
			indices,
			[...switches],
			[],
		);
		const railDelete = planDirectedEdgeRemoval(
			intermediate.map,
			[...modules.flatMap((module) => module.eraseEdges), ...boundaryEdges],
			[...switches],
		);
		// An isolated whole Bank can have no surviving rail bit at a deleted cell.
		if (railDelete.mutations.some((change) => change.after !== 0))
			fail(
				"EXTERNAL_RAIL_REFERENCE",
				"Bank의 레일 접점이 외부 또는 무소속 레일과 연결되어 있습니다",
			);
		const nextMap = intermediate.map.clone();
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
		const removedRelationships = intermediate.relationships.records.filter((row) => {
			const ids = relationshipOrganizationIds(row);
			if (!ids.some((id) => selectedIds.has(id))) return false;
			if (ids.some((id) => !selectedIds.has(id)))
				fail(
					"EXTERNAL_RELATIONSHIP",
					`관계 ${row.id}가 삭제 Bank 밖 조직·support·witness를 참조합니다`,
				);
			return true;
		});
		const allRemovedRelationshipIds = new Set([
			...(detach?.valid ? detach.plan.review.removedRelationshipIds : []),
			...removedRelationships.map((row) => row.id),
		]);
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
				const change = detach?.valid
					? detach.plan.transition.organizationChanges.find((change) => change.id === row.id)
					: undefined;
				return change ? [change] : [];
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
		const merged = new Map<string, RailMutation>();
		for (const change of [
			...(detach?.valid ? detach.plan.transition.changes : []),
			...railDelete.mutations,
		]) {
			const key = cellKey(change.x, change.y);
			const previous = merged.get(key);
			if (previous && previous.after !== change.before)
				fail("INVALID_TRANSITION", "분리와 삭제의 중간 레일 세대가 다릅니다");
			merged.set(key, { ...change, before: previous?.before ?? change.before });
		}
		const changes = Object.freeze(
			[...merged.values()]
				.filter((change) => change.before !== change.after)
				.sort((a, b) => a.y - b.y || a.x - b.x)
				.map((change) => Object.freeze(change)),
		);
		const topologyError = railMutationTopologyError(map, changes, railDelete.switchMutations);
		if (topologyError) fail("INVALID_TRANSITION", topologyError);
		// Materialize the combined command once, so its revision matches one atomic patch.
		const finalMap = map.clone();
		finalMap.applyAtomicMutations(changes, railDelete.switchMutations);
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
		if (authorizations.some((id) => selectedIds.has(id)))
			fail("INVALID_TRANSITION", "삭제 조직에는 보존 접점 권한을 부여할 수 없습니다");
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
		const sourceOwnership = buildRailModuleOwnershipIndex(map);
		const cutKeys = new Set(
			detach?.valid
				? (detach.plan.transition.relationshipChanges?.flatMap(
						(change) =>
							change.before?.connectionGroups.flatMap((group) =>
								group.legs.flatMap((leg) =>
									leg.exclusiveCutEdges.map((edge) => staticFabOrganizationEdgeKey(edge.edge)),
								),
							) ?? [],
					) ?? [])
				: [],
		);
		const removedModuleKeys = new Set(modules.map((module) => module.key));
		// Detach's cut modules are certified separately from the isolated subtree.
		if (detach?.valid)
			for (const module of sourceOwnership.modules)
				if (module.eraseEdges.some((edge) => cutKeys.has(staticFabOrganizationEdgeKey(edge))))
					removedModuleKeys.add(module.key);
		const bank = organizations.records.find((row) => row.id === intent.targetOrganizationId);
		if (!bank) fail("HIERARCHY_REJECTED", "삭제할 Bank 원본이 없습니다");
		const parent = organizations.records.find(
			(row) => row.id === intent.expectedParentOrganizationId,
		);
		const review: StaticFabSemanticBankDeleteReview = Object.freeze({
			version: 1,
			bankOrganizationId: bank.id,
			bankName: bank.name,
			parentFabOrganizationId: intent.expectedParentOrganizationId,
			parentFabName: parent?.name ?? null,
			includesDetach: detach !== null,
			removed: impact(
				organizations,
				removedRows,
				[...removedModuleKeys],
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
			kind: STATIC_FAB_SEMANTIC_BANK_DELETE_KIND,
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
			detachedState: intermediate,
			deletedMap,
			issueCode: null,
			reason: `Bank '${bank.name}'의 독점 소유 하위 조직·레일·장비·Port를 하나의 명령으로 삭제합니다`,
		});
	} catch (error) {
		return Object.freeze({
			valid: false,
			plan: null,
			prospectiveState: null,
			detachedState: null,
			deletedMap: null,
			issueCode: error instanceof DeleteFailure ? error.code : "INVALID_SOURCE",
			reason: message(error),
		});
	}
}

export function assertStaticFabSemanticBankDeletePatchSource(
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
		(change) => change.after === null && roles.get(change.id) === "BAY_BANK",
	);
	if (targets.length !== 1 || !targets[0]?.before)
		throw new Error("Bank 삭제 patch에는 정확히 하나의 Bank 제거가 필요합니다");
	const target = targets[0].before;
	const planned = planStaticFabSemanticBankDelete(
		map,
		equipment,
		sequence,
		organizations,
		relationships,
		operations,
		{
			version: 1,
			action: "DELETE",
			targetRole: "BAY_BANK",
			targetOrganizationId: target.id,
			expectedParentOrganizationId: staticFabOrganizationParentIds(target)[0] ?? null,
		},
	);
	if (!planned.valid) throw new Error(planned.reason);
	if (
		railPatchTransitionFingerprint(patch) !==
		railPatchTransitionFingerprint(planned.plan.transition)
	)
		throw new Error("Bank 삭제 patch가 원본의 정확한 독점 삭제 범위와 다릅니다");
}
function assertNoOperationalReferences(
	state: OperationalConfigurationState,
	groups: ReadonlySet<number>,
	ports: ReadonlySet<number>,
): void {
	const port =
		state.stationCapabilities.find((row) => ports.has(row.portId))?.portId ??
		state.eqPortQualificationOverrides.find((row) => ports.has(row.portId))?.portId ??
		state.residentHomeSlots.find((row) => ports.has(row.anchorPortId))?.anchorPortId;
	if (port !== undefined)
		fail(
			"EXTERNAL_OPERATIONAL_REFERENCE",
			`PORT-${port}를 참조하는 운영 설정이 있어 Bank를 삭제할 수 없습니다`,
		);
	const group =
		state.eqGroupQualifications.find((row) => groups.has(row.equipmentGroupId))?.equipmentGroupId ??
		state.storageGroups.find((row) => groups.has(row.equipmentGroupId))?.equipmentGroupId;
	if (group !== undefined)
		fail(
			"EXTERNAL_OPERATIONAL_REFERENCE",
			`장비 ${group}를 참조하는 운영 설정이 있어 Bank를 삭제할 수 없습니다`,
		);
}
function relationshipOrganizationIds(row: StaticFabAssemblyRelationshipRecordV1): number[] {
	const result = [
		row.parentOrganizationId,
		...row.participantOrganizationIds,
		...row.managedChildOrganizationIds,
	];
	for (const group of row.connectionGroups)
		for (const leg of group.legs)
			for (const edge of [
				...leg.exclusiveCutEdges,
				...leg.endpointSupports.map((support) => support.support),
				...leg.seamContacts.flatMap((contact) =>
					contact.incidences.flatMap((incidence) =>
						incidence.binding.kind === "WITNESS" ? [incidence.binding.scopedEdge] : [],
					),
				),
			])
				if (edge.scope.kind !== "PARENT_DIRECT")
					result.push(...edge.scope.directOwnerOrganizationIds);
	return result;
}
function sample(
	ids: readonly (number | string)[],
	count = ids.length,
): StaticFabSemanticBankDeleteImpactSample {
	const sorted = [...ids].sort((a, b) =>
		typeof a === "number" && typeof b === "number"
			? a - b
			: String(a) < String(b)
				? -1
				: String(a) > String(b)
					? 1
					: 0,
	);
	const idSample = Object.freeze(sorted.slice(0, STATIC_FAB_SEMANTIC_BANK_DELETE_ID_SAMPLE_LIMIT));
	return Object.freeze({ count, idSample, omittedCount: count - idSample.length });
}
function impact(
	state: StaticFabOrganizationState,
	rows: StaticFabOrganizationState["records"],
	moduleKeys: readonly string[],
	switchIds: readonly number[],
	groups: readonly number[],
	ports: readonly number[],
	relationships: readonly StaticFabAssemblyRelationshipRecordV1[],
	edgeCount: number,
	edgeIds: readonly string[],
): StaticFabSemanticBankDeleteImpact {
	const roles = deriveStaticFabOrganizationSemanticRoles(state);
	const roleIds = (role: string) =>
		rows.filter((row) => roles.get(row.id) === role).map((row) => row.id);
	return Object.freeze({
		organizations: sample(rows.map((row) => row.id)),
		bays: sample(roleIds("BAY")),
		loops: sample(roleIds("PROCESS_LOOP")),
		banks: sample(roleIds("BAY_BANK")),
		fabs: sample(roleIds("FAB")),
		railModules: sample(moduleKeys),
		advancedSwitches: sample(switchIds),
		equipmentGroups: sample(groups),
		ports: sample(ports),
		relationships: sample(relationships.map((row) => row.id)),
		corridors: sample(
			relationships.flatMap((row) =>
				row.connectionGroups.flatMap((group, gi) =>
					group.legs.map((_leg, li) => `${row.id}:${gi}:${li}`),
				),
			),
		),
		directedEdges: sample(edgeIds, edgeCount),
	});
}
class DeleteFailure extends Error {
	readonly code: string;
	constructor(code: string, reason: string) {
		super(reason);
		this.code = code;
	}
}
function fail(code: string, reason: string): never {
	throw new DeleteFailure(code, reason);
}
function message(error: unknown): string {
	return error instanceof Error ? error.message : "Bank 삭제를 검토할 수 없습니다";
}

function directedEdgeSample(map: TileMap, retained?: TileMap): readonly string[] {
	const result: string[] = [];
	map.forEachRail((x, y, rail) => {
		for (const direction of ALL_DIRECTIONS) {
			if (!(rail.outgoing & direction) || (retained && retained.getRail(x, y).outgoing & direction))
				continue;
			result.push(
				staticFabOrganizationEdgeKey({ from: { x, y }, to: moveCell({ x, y }, direction) }),
			);
			result.sort();
			if (result.length > STATIC_FAB_SEMANTIC_BANK_DELETE_ID_SAMPLE_LIMIT) result.pop();
		}
	});
	return result;
}
