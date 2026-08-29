import type { PortEquipmentState } from "./EquipmentGroup";
import type { RailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	renameStaticFabOrganizationRecord,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationRecordEquals,
	staticFabOrganizationStateError,
	updateStaticFabOrganizationRecordMetadata,
} from "./StaticFabOrganization";
import type { StaticFabSelection } from "./StaticFabSelection";
import {
	staticFabSelectionEquipmentGroupIds,
	staticFabSelectionStaleReason,
} from "./StaticFabSelection";
import type { TileMap } from "./TileMap";

export type StaticFabOrganizationPlanKind =
	| "create-static-fab-organization"
	| "assign-static-fab-organization"
	| "rename-static-fab-organization"
	| "update-static-fab-organization"
	| "remove-static-fab-organization";

export interface StaticFabOrganizationMutationPlan {
	readonly kind: StaticFabOrganizationPlanKind;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly nextOrganizationIdBefore: number;
	readonly nextOrganizationIdAfter: number;
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly valid: boolean;
	readonly reason: string;
}

interface StaticFabOrganizationPlanSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

const issuedStaticFabOrganizationPlans = new WeakMap<object, StaticFabOrganizationPlanSource>();

/** Reject structurally forged plans at the document command boundary. */
export function isIssuedStaticFabOrganizationPlan(
	plan: StaticFabOrganizationMutationPlan,
): boolean {
	return issuedStaticFabOrganizationPlans.has(plan);
}

/** Prevent a valid plan from being replayed into a different document with matching counters. */
export function isStaticFabOrganizationPlanIssuedFor(
	plan: StaticFabOrganizationMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): boolean {
	const source = issuedStaticFabOrganizationPlans.get(plan);
	return (
		source?.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations
	);
}

export function planCreateStaticFabOrganizationFromSelection(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	selection: StaticFabSelection,
	name: string,
	kind: StaticFabOrganizationKind = "AREA",
): StaticFabOrganizationMutationPlan {
	const staleReason = staticFabSelectionStaleReason(
		map,
		ownership,
		portEquipment,
		basePatchSequence,
		selection,
	);
	if (staleReason)
		return invalidPlan(
			"create-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			staleReason,
		);
	const edgeByKey = new Map();
	const switchIds = new Set<number>();
	for (const selected of selection.rail.ownerships) {
		for (const edge of selected.eraseEdges) edgeByKey.set(staticFabOrganizationEdgeKey(edge), edge);
		if (selected.advancedSwitchId !== null) switchIds.add(selected.advancedSwitchId);
	}
	const membership = {
		railEdges: [...edgeByKey.values()].sort(compareDirectedRailEdges),
		advancedSwitchIds: [...switchIds].sort((left, right) => left - right),
		equipmentGroupIds: staticFabSelectionEquipmentGroupIds(selection),
	};
	const partialGroupId = partiallyCoveredEquipmentGroupId(portEquipment, membership);
	if (partialGroupId !== null) {
		return invalidPlan(
			"create-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`장비 그룹 ${partialGroupId}의 일부 포트 경로만 선택되었습니다`,
		);
	}
	const record = copyStaticFabOrganizationRecord({
		id: organizations.nextOrganizationId,
		kind,
		name,
		membership,
	});
	const mutation = Object.freeze({
		id: record.id,
		before: null,
		after: record,
	}) satisfies StaticFabOrganizationMutation;
	return validatePlan(
		"create-static-fab-organization",
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		organizations.nextOrganizationId + 1,
		[mutation],
		`${kind} '${name}'을 선택 영역에서 생성합니다`,
	);
}

export interface StaticFabOrganizationAssignmentTarget {
	readonly kind: StaticFabOrganizationKind;
	readonly organizationId: number | null;
	readonly name: string;
	readonly sourceOwners: readonly StaticFabOrganizationSourceOwnerAcknowledgement[];
}

export interface StaticFabOrganizationSourceOwnerAcknowledgement {
	readonly organizationId: number;
	readonly emptyDisposition: "reject" | "remove";
}

/**
 * Move one exact selection into a new or existing organization. Membership is
 * exclusive only within the selected kind, so AREA/BAY/AISLE/PROCESS_FAMILY
 * may describe the same authored content at different semantic levels.
 */
export function planAssignStaticFabOrganizationFromSelection(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	selection: StaticFabSelection,
	target: StaticFabOrganizationAssignmentTarget,
): StaticFabOrganizationMutationPlan {
	const staleReason = staticFabSelectionStaleReason(
		map,
		ownership,
		portEquipment,
		basePatchSequence,
		selection,
	);
	if (staleReason) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			staleReason,
		);
	}
	const selectedMembership = staticFabOrganizationMembershipFromSelection(selection);
	const partialGroupId = partiallyCoveredEquipmentGroupId(portEquipment, selectedMembership);
	if (partialGroupId !== null) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`장비 그룹 ${partialGroupId}의 일부 포트 경로만 선택되었습니다`,
		);
	}
	const existingTarget =
		target.organizationId === null
			? null
			: (organizations.records.find((record) => record.id === target.organizationId) ?? null);
	if (target.organizationId !== null && !existingTarget) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`조직 ${target.organizationId}을 찾을 수 없습니다`,
		);
	}
	if (existingTarget && existingTarget.kind !== target.kind) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`${existingTarget.kind} 조직은 ${target.kind} 멤버십을 받을 수 없습니다`,
		);
	}

	const selectedEdgeKeys = new Set(selectedMembership.railEdges.map(staticFabOrganizationEdgeKey));
	const selectedSwitchIds = new Set(selectedMembership.advancedSwitchIds);
	const selectedEquipmentGroupIds = new Set(selectedMembership.equipmentGroupIds);
	const conflictRecords = organizations.records.filter(
		(record) =>
			record.kind === target.kind &&
			record.id !== existingTarget?.id &&
			organizationMembershipIntersects(
				record.membership,
				selectedEdgeKeys,
				selectedSwitchIds,
				selectedEquipmentGroupIds,
			),
	);
	const sourceOwners = [...target.sourceOwners];
	if (
		sourceOwners.some((source, index) => {
			const previousSource = index > 0 ? sourceOwners[index - 1] : undefined;
			return (
				!Number.isSafeInteger(source.organizationId) ||
				source.organizationId <= 0 ||
				!(["reject", "remove"] as const).includes(source.emptyDisposition) ||
				(previousSource !== undefined && source.organizationId <= previousSource.organizationId)
			);
		}) ||
		sourceOwners.length !== conflictRecords.length ||
		sourceOwners.some((source, index) => source.organizationId !== conflictRecords[index]?.id)
	) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			"재할당 검토 이후 충돌 조직이 변경되었습니다 · 원본 조직을 다시 확인하세요",
		);
	}
	const sourceOwnersById = new Map(sourceOwners.map((source) => [source.organizationId, source]));
	const mutations: StaticFabOrganizationMutation[] = [];
	for (const record of conflictRecords) {
		const remainingMembership = subtractOrganizationMembership(
			record.membership,
			selectedEdgeKeys,
			selectedSwitchIds,
			selectedEquipmentGroupIds,
		);
		if (remainingMembership === record.membership) continue;
		if (
			organizationMembershipIsEmpty(remainingMembership) &&
			sourceOwnersById.get(record.id)?.emptyDisposition !== "remove"
		) {
			return invalidPlan(
				"assign-static-fab-organization",
				map,
				basePatchSequence,
				organizations,
				`${record.kind} '${record.name}'이 비게 됩니다 · 빈 원본 조직 제거를 확인하세요`,
			);
		}
		mutations.push(
			Object.freeze({
				id: record.id,
				before: record,
				after: organizationMembershipIsEmpty(remainingMembership)
					? null
					: copyStaticFabOrganizationRecord({ ...record, membership: remainingMembership }),
			}),
		);
	}

	let assignedRecord: StaticFabOrganizationRecord;
	try {
		assignedRecord = copyStaticFabOrganizationRecord({
			id: existingTarget?.id ?? organizations.nextOrganizationId,
			kind: target.kind,
			name: existingTarget?.name ?? target.name,
			parentOrganizationIds: existingTarget
				? staticFabOrganizationParentIds(existingTarget)
				: undefined,
			properties: existingTarget ? staticFabOrganizationProperties(existingTarget) : undefined,
			membership: existingTarget
				? mergeOrganizationMembership(existingTarget.membership, selectedMembership)
				: selectedMembership,
		});
	} catch (error) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			error instanceof Error ? error.message : "조직 재할당을 검증할 수 없습니다",
		);
	}
	if (!existingTarget || !staticFabOrganizationRecordEquals(existingTarget, assignedRecord)) {
		mutations.push(
			Object.freeze({
				id: assignedRecord.id,
				before: existingTarget,
				after: assignedRecord,
			}),
		);
	}
	mutations.sort((left, right) => left.id - right.id);
	if (mutations.length === 0) {
		return invalidPlan(
			"assign-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`${target.kind} '${assignedRecord.name}'이 이미 선택 멤버십을 소유합니다`,
		);
	}
	const nextOrganizationIdAfter = existingTarget
		? organizations.nextOrganizationId
		: organizations.nextOrganizationId + 1;
	return validatePlan(
		"assign-static-fab-organization",
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		nextOrganizationIdAfter,
		mutations,
		conflictRecords.length === 0
			? `${target.kind} '${assignedRecord.name}'에 선택 멤버십을 할당합니다`
			: `${target.kind} ${conflictRecords.length}개 조직의 충돌 멤버십을 '${assignedRecord.name}'(으)로 재할당합니다`,
	);
}

export function staticFabOrganizationConflictsForSelection(
	organizations: StaticFabOrganizationState,
	selection: StaticFabSelection,
	kind: StaticFabOrganizationKind,
	excludeOrganizationId: number | null = null,
): readonly StaticFabOrganizationRecord[] {
	return Object.freeze(
		staticFabOrganizationAssignmentSourcesForSelection(
			organizations,
			selection,
			kind,
			excludeOrganizationId,
		).map((source) => source.record),
	);
}

export interface StaticFabOrganizationAssignmentSource {
	readonly record: StaticFabOrganizationRecord;
	readonly empties: boolean;
}

export function staticFabOrganizationAssignmentSourcesForSelection(
	organizations: StaticFabOrganizationState,
	selection: StaticFabSelection,
	kind: StaticFabOrganizationKind,
	excludeOrganizationId: number | null = null,
	candidateOrganizationIds: readonly number[] | null = null,
): readonly StaticFabOrganizationAssignmentSource[] {
	const membership = staticFabOrganizationMembershipFromSelection(selection);
	const edgeKeys = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const switchIds = new Set(membership.advancedSwitchIds);
	const equipmentGroupIds = new Set(membership.equipmentGroupIds);
	const candidateIds = candidateOrganizationIds === null ? null : new Set(candidateOrganizationIds);
	return Object.freeze(
		organizations.records.flatMap((record) => {
			if (
				(candidateIds !== null && !candidateIds.has(record.id)) ||
				record.kind !== kind ||
				record.id === excludeOrganizationId ||
				!organizationMembershipIntersects(record.membership, edgeKeys, switchIds, equipmentGroupIds)
			) {
				return [];
			}
			const remaining = subtractOrganizationMembership(
				record.membership,
				edgeKeys,
				switchIds,
				equipmentGroupIds,
			);
			return [Object.freeze({ record, empties: organizationMembershipIsEmpty(remaining) })];
		}),
	);
}

export function planRenameStaticFabOrganization(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	id: number,
	name: string,
): StaticFabOrganizationMutationPlan {
	const current = organizations.records.find((record) => record.id === id);
	if (!current) {
		return invalidPlan(
			"rename-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`조직 ${id}을 찾을 수 없습니다`,
		);
	}
	if (current.name === name) {
		return invalidPlan(
			"rename-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			"조직 이름이 변경되지 않았습니다",
		);
	}
	let after: StaticFabOrganizationRecord;
	try {
		after = renameStaticFabOrganizationRecord(current, name);
	} catch (error) {
		return invalidPlan(
			"rename-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			error instanceof Error ? error.message : "조직 이름을 검증할 수 없습니다",
		);
	}
	return validateMetadataOnlyPlan(
		"rename-static-fab-organization",
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		organizations.nextOrganizationId,
		[Object.freeze({ id, before: current, after })],
		`${current.kind} '${current.name}'의 이름을 '${name}'(으)로 변경합니다`,
	);
}

export interface StaticFabOrganizationDetailsUpdate {
	readonly parentOrganizationIds: readonly number[];
	readonly description: string;
	readonly color: StaticFabOrganizationColor;
}

/** Plan one atomic persisted relationship/property edit without touching authored geometry. */
export function planUpdateStaticFabOrganizationDetails(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	id: number,
	update: StaticFabOrganizationDetailsUpdate,
): StaticFabOrganizationMutationPlan {
	const current = organizations.records.find((record) => record.id === id);
	if (!current) {
		return invalidPlan(
			"update-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`조직 ${id}을 찾을 수 없습니다`,
		);
	}
	let after: StaticFabOrganizationRecord;
	try {
		after = updateStaticFabOrganizationRecordMetadata(current, {
			parentOrganizationIds: Object.freeze([...update.parentOrganizationIds]),
			properties: Object.freeze({
				description: update.description,
				color: update.color,
			}),
		});
	} catch (error) {
		return invalidPlan(
			"update-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			error instanceof Error ? error.message : "조직 관계와 속성을 검증할 수 없습니다",
		);
	}
	if (staticFabOrganizationRecordEquals(current, after)) {
		return invalidPlan(
			"update-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			"조직 관계와 속성이 변경되지 않았습니다",
		);
	}
	return validateMetadataOnlyPlan(
		"update-static-fab-organization",
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		organizations.nextOrganizationId,
		[Object.freeze({ id, before: current, after })],
		`${current.kind} '${current.name}'의 관계와 속성을 변경합니다`,
	);
}

export function staticFabOrganizationDetailsEqual(
	record: StaticFabOrganizationRecord,
	update: StaticFabOrganizationDetailsUpdate,
): boolean {
	const properties = staticFabOrganizationProperties(record);
	const parents = staticFabOrganizationParentIds(record);
	return (
		parents.length === update.parentOrganizationIds.length &&
		parents.every((id, index) => id === update.parentOrganizationIds[index]) &&
		properties.description === update.description &&
		properties.color === update.color
	);
}

export function planRemoveStaticFabOrganization(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	id: number,
): StaticFabOrganizationMutationPlan {
	const current = organizations.records.find((record) => record.id === id);
	if (!current) {
		return invalidPlan(
			"remove-static-fab-organization",
			map,
			basePatchSequence,
			organizations,
			`조직 ${id}을 찾을 수 없습니다`,
		);
	}
	return validateMetadataOnlyPlan(
		"remove-static-fab-organization",
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		organizations.nextOrganizationId,
		[Object.freeze({ id, before: current, after: null })],
		`${current.kind} '${current.name}' 메타데이터를 제거합니다`,
	);
}

function validateMetadataOnlyPlan(
	kind:
		| "rename-static-fab-organization"
		| "update-static-fab-organization"
		| "remove-static-fab-organization",
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	nextOrganizationIdAfter: number,
	organizationMutations: readonly StaticFabOrganizationMutation[],
	reason: string,
): StaticFabOrganizationMutationPlan {
	try {
		applyStaticFabOrganizationMutations(
			organizations,
			organizationMutations,
			nextOrganizationIdAfter,
			true,
		);
	} catch (error) {
		return invalidPlan(
			kind,
			map,
			basePatchSequence,
			organizations,
			error instanceof Error ? error.message : "정적 FAB 조직 메타데이터를 검증할 수 없습니다",
		);
	}
	return issuePlan(
		{
			kind,
			baseRevision: map.getRevision(),
			basePatchSequence,
			nextOrganizationIdBefore: organizations.nextOrganizationId,
			nextOrganizationIdAfter,
			organizationMutations: Object.freeze(organizationMutations),
			valid: true,
			reason,
		},
		map,
		portEquipment,
		organizations,
	);
}

function validatePlan(
	kind: StaticFabOrganizationPlanKind,
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	nextOrganizationIdAfter: number,
	organizationMutations: readonly StaticFabOrganizationMutation[],
	reason: string,
): StaticFabOrganizationMutationPlan {
	try {
		const prospective = applyStaticFabOrganizationMutations(
			organizations,
			organizationMutations,
			nextOrganizationIdAfter,
		);
		const error = staticFabOrganizationStateError(map, portEquipment, prospective);
		if (error) return invalidPlan(kind, map, basePatchSequence, organizations, error);
	} catch (error) {
		return invalidPlan(
			kind,
			map,
			basePatchSequence,
			organizations,
			error instanceof Error ? error.message : "정적 FAB 조직 변경을 검증할 수 없습니다",
		);
	}
	return issuePlan(
		{
			kind,
			baseRevision: map.getRevision(),
			basePatchSequence,
			nextOrganizationIdBefore: organizations.nextOrganizationId,
			nextOrganizationIdAfter,
			organizationMutations: Object.freeze(organizationMutations),
			valid: true,
			reason,
		},
		map,
		portEquipment,
		organizations,
	);
}

function issuePlan(
	plan: StaticFabOrganizationMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): StaticFabOrganizationMutationPlan {
	const issued = Object.freeze(plan);
	issuedStaticFabOrganizationPlans.set(
		issued,
		Object.freeze({ map, portEquipment, organizations }),
	);
	return issued;
}

function invalidPlan(
	kind: StaticFabOrganizationPlanKind,
	map: TileMap,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	reason: string,
): StaticFabOrganizationMutationPlan {
	return Object.freeze({
		kind,
		baseRevision: map.getRevision(),
		basePatchSequence,
		nextOrganizationIdBefore: organizations.nextOrganizationId,
		nextOrganizationIdAfter: organizations.nextOrganizationId,
		organizationMutations: Object.freeze([]),
		valid: false,
		reason,
	});
}

function partiallyCoveredEquipmentGroupId(
	portEquipment: PortEquipmentState,
	membership: StaticFabOrganizationRecord["membership"],
): number | null {
	const selectedEdges = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const selectedSwitches = new Set(membership.advancedSwitchIds);
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	for (const group of portEquipment.equipmentGroups) {
		let supported = 0;
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (
				port &&
				staticFabOrganizationMembershipSupportsPortRoute(
					port.route,
					selectedEdges,
					selectedSwitches,
				)
			) {
				supported++;
			}
		}
		if (supported > 0 && supported < group.portIds.length) return group.id;
	}
	return null;
}

export function staticFabOrganizationMembershipFromSelection(
	selection: StaticFabSelection,
): StaticFabOrganizationRecord["membership"] {
	const edges = new Map<string, StaticFabOrganizationRecord["membership"]["railEdges"][number]>();
	const switchIds = new Set<number>();
	for (const selected of selection.rail.ownerships) {
		for (const edge of selected.eraseEdges) {
			edges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		if (selected.advancedSwitchId !== null) switchIds.add(selected.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: staticFabSelectionEquipmentGroupIds(selection),
	});
}

function subtractOrganizationMembership(
	membership: StaticFabOrganizationRecord["membership"],
	edgeKeys: ReadonlySet<string>,
	switchIds: ReadonlySet<number>,
	equipmentGroupIds: ReadonlySet<number>,
): StaticFabOrganizationRecord["membership"] {
	if (!organizationMembershipIntersects(membership, edgeKeys, switchIds, equipmentGroupIds)) {
		return membership;
	}
	return Object.freeze({
		railEdges: Object.freeze(
			membership.railEdges.filter((edge) => !edgeKeys.has(staticFabOrganizationEdgeKey(edge))),
		),
		advancedSwitchIds: Object.freeze(
			membership.advancedSwitchIds.filter((id) => !switchIds.has(id)),
		),
		equipmentGroupIds: Object.freeze(
			membership.equipmentGroupIds.filter((id) => !equipmentGroupIds.has(id)),
		),
	});
}

function mergeOrganizationMembership(
	left: StaticFabOrganizationRecord["membership"],
	right: StaticFabOrganizationRecord["membership"],
): StaticFabOrganizationRecord["membership"] {
	const edges = new Map(left.railEdges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]));
	for (const edge of right.railEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze(
			[...new Set([...left.advancedSwitchIds, ...right.advancedSwitchIds])].sort((a, b) => a - b),
		),
		equipmentGroupIds: Object.freeze(
			[...new Set([...left.equipmentGroupIds, ...right.equipmentGroupIds])].sort((a, b) => a - b),
		),
	});
}

function organizationMembershipIntersects(
	membership: StaticFabOrganizationRecord["membership"],
	edgeKeys: ReadonlySet<string>,
	switchIds: ReadonlySet<number>,
	equipmentGroupIds: ReadonlySet<number>,
): boolean {
	return (
		membership.railEdges.some((edge) => edgeKeys.has(staticFabOrganizationEdgeKey(edge))) ||
		membership.advancedSwitchIds.some((id) => switchIds.has(id)) ||
		membership.equipmentGroupIds.some((id) => equipmentGroupIds.has(id))
	);
}

function organizationMembershipIsEmpty(
	membership: StaticFabOrganizationRecord["membership"],
): boolean {
	return (
		membership.railEdges.length === 0 &&
		membership.advancedSwitchIds.length === 0 &&
		membership.equipmentGroupIds.length === 0
	);
}
