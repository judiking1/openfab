import type { PortEquipmentState } from "./EquipmentGroup";
import { createRailAreaSelectionFromOwnerships } from "./RailAreaSelection";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import { createStaticFabSelection, type StaticFabSelection } from "./StaticFabSelection";

export type StaticFabOrganizationSelectionMode = "DIRECT" | "EFFECTIVE";

/** Product safety bound for one interactive organization-root selection. */
export const STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS = 1_024;

export type StaticFabOrganizationSelectionResolution =
	| {
			readonly valid: true;
			readonly selection: StaticFabSelection;
			readonly reason: string;
	  }
	| {
			readonly valid: false;
			readonly selection: null;
			readonly reason: string;
	  };

/** Resolve persistent semantic membership back into an exact transient editor selection. */
export function resolveStaticFabOrganizationSelection(
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationSelectionResolution {
	return resolveStaticFabOrganizationMembershipSelection(
		ownership,
		portEquipment,
		patchSequence,
		record,
		record.membership,
		"DIRECT",
	);
}

/**
 * Resolve one current organization by ID. DIRECT preserves the record's own membership while
 * EFFECTIVE derives the union of every recursively related descendant from the persisted DAG.
 */
export function resolveStaticFabOrganizationSelectionFromState(
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	state: StaticFabOrganizationState,
	organizationId: number,
	mode: StaticFabOrganizationSelectionMode = "DIRECT",
): StaticFabOrganizationSelectionResolution {
	return resolveStaticFabOrganizationSelectionsFromState(
		ownership,
		portEquipment,
		patchSequence,
		state,
		[organizationId],
		mode,
	);
}

/**
 * Resolve multiple organization roots into one exact transient selection. Root order and duplicate
 * roots do not affect the result. EFFECTIVE includes each reachable descendant once even when the
 * persisted organization DAG has multiple parents.
 */
export function resolveStaticFabOrganizationSelectionsFromState(
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	state: StaticFabOrganizationState,
	organizationIds: readonly number[],
	mode: StaticFabOrganizationSelectionMode = "DIRECT",
): StaticFabOrganizationSelectionResolution {
	if (organizationIds.length > STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS) {
		return invalidResolution(
			`한 번에 최대 ${STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS.toLocaleString()}개 조직을 선택할 수 있습니다`,
		);
	}
	const rootIds = [...new Set(organizationIds)].sort((left, right) => left - right);
	if (rootIds.length === 0) {
		return invalidResolution("선택할 조직을 하나 이상 지정해야 합니다");
	}
	if (mode !== "DIRECT" && mode !== "EFFECTIVE") {
		return invalidResolution("조직 선택 범위가 유효하지 않습니다");
	}

	const recordsById = new Map(state.records.map((record) => [record.id, record] as const));
	for (const rootId of rootIds) {
		if (!recordsById.has(rootId)) {
			return invalidResolution(`조직 ${rootId}을 현재 정적 FAB에서 찾을 수 없습니다`);
		}
	}

	const includedOrganizationIds = new Set(rootIds);
	if (mode === "EFFECTIVE") {
		const childrenByParentId = new Map<number, number[]>();
		for (const record of state.records) {
			for (const parentId of staticFabOrganizationParentIds(record)) {
				const children = childrenByParentId.get(parentId);
				if (children) children.push(record.id);
				else childrenByParentId.set(parentId, [record.id]);
			}
		}
		const pending = [...rootIds];
		for (let offset = 0; offset < pending.length; offset++) {
			for (const descendantId of childrenByParentId.get(pending[offset] as number) ?? []) {
				if (includedOrganizationIds.has(descendantId)) continue;
				includedOrganizationIds.add(descendantId);
				pending.push(descendantId);
			}
		}
	}

	const records = [...includedOrganizationIds]
		.sort((left, right) => left - right)
		.map((id) => recordsById.get(id) as StaticFabOrganizationRecord);
	const firstRecord = records[0] as StaticFabOrganizationRecord;
	return resolveStaticFabOrganizationMembershipSelection(
		ownership,
		portEquipment,
		patchSequence,
		firstRecord,
		mergeStaticFabOrganizationMemberships(records.map((record) => record.membership)),
		mode,
		rootIds.length,
	);
}

function resolveStaticFabOrganizationMembershipSelection(
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	record: StaticFabOrganizationRecord,
	membership: StaticFabOrganizationRecord["membership"],
	mode: StaticFabOrganizationSelectionMode,
	rootCount = 1,
): StaticFabOrganizationSelectionResolution {
	const targetEdges = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const targetSwitches = new Set(membership.advancedSwitchIds);
	const candidateModules = new Map<string, RailModuleOwnership>();
	for (const edge of membership.railEdges) {
		for (const cell of [edge.from, edge.to]) {
			for (const module of ownership.candidates(cell)) candidateModules.set(module.key, module);
		}
	}
	const selectedModules = [...candidateModules.values()].filter((module) => {
		const touchesEdge = module.eraseEdges.some((edge) =>
			targetEdges.has(staticFabOrganizationEdgeKey(edge)),
		);
		const touchesSwitch =
			module.advancedSwitchId !== null && targetSwitches.has(module.advancedSwitchId);
		if (!touchesEdge && !touchesSwitch) return false;
		if (
			module.eraseEdges.some((edge) => !targetEdges.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && !targetSwitches.has(module.advancedSwitchId))
		) {
			return false;
		}
		return true;
	});
	if (selectedModules.length === 0) {
		return invalidResolution(
			rootCount === 1
				? `'${record.name}'의 저장 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`
				: `선택한 ${rootCount}개 조직의 저장 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`,
		);
	}
	const resolvedEdges = new Set<string>();
	const resolvedSwitches = new Set<number>();
	for (const module of selectedModules) {
		for (const edge of module.eraseEdges) resolvedEdges.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) resolvedSwitches.add(module.advancedSwitchId);
	}
	if (!setsEqual(targetEdges, resolvedEdges) || !setsEqual(targetSwitches, resolvedSwitches)) {
		return invalidResolution(
			rootCount === 1
				? `'${record.name}'의 저장 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`
				: `선택한 ${rootCount}개 조직의 저장 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`,
		);
	}
	try {
		const rail = createRailAreaSelectionFromOwnerships(
			ownership,
			selectedModules,
			"fully-contained",
		);
		return Object.freeze({
			valid: true,
			selection: createStaticFabSelection(
				rail,
				portEquipment,
				patchSequence,
				membership.equipmentGroupIds,
			),
			reason:
				rootCount === 1
					? mode === "DIRECT"
						? `${record.kind} '${record.name}'을 선택했습니다`
						: `${record.kind} '${record.name}'과 하위 조직을 선택했습니다`
					: mode === "DIRECT"
						? `${rootCount}개 조직을 선택했습니다`
						: `${rootCount}개 조직과 하위 조직을 선택했습니다`,
		});
	} catch (error) {
		return invalidResolution(
			error instanceof Error
				? error.message
				: rootCount === 1
					? `'${record.name}' 선택을 복원할 수 없습니다`
					: `선택한 ${rootCount}개 조직을 복원할 수 없습니다`,
		);
	}
}

function mergeStaticFabOrganizationMemberships(
	memberships: readonly StaticFabOrganizationMembership[],
): StaticFabOrganizationMembership {
	const edgesByKey = new Map<string, StaticFabOrganizationMembership["railEdges"][number]>();
	const switchIds = new Set<number>();
	const equipmentGroupIds = new Set<number>();
	for (const membership of memberships) {
		for (const edge of membership.railEdges) {
			edgesByKey.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		for (const switchId of membership.advancedSwitchIds) switchIds.add(switchId);
		for (const groupId of membership.equipmentGroupIds) equipmentGroupIds.add(groupId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edgesByKey.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function invalidResolution(reason: string): StaticFabOrganizationSelectionResolution {
	return Object.freeze({ valid: false, selection: null, reason });
}

function setsEqual<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}
