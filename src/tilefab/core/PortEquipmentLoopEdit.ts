import {
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { copyEquipmentGroupWithPortIds } from "./EquipmentGroupPortOrder";
import {
	type PortMutation,
	type PortRecord,
	portRecordEquals,
	portRouteIdentityEquals,
} from "./PortRecord";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
} from "./StaticFabOrganization";

export interface PortEquipmentLoopEditOwnership {
	readonly ownerOrganizationIds: readonly number[];
	readonly processLoopId: number | null;
	readonly reason: string | null;
}

/** Eligibility to start an edit; every proposed target still needs the transition check below. */
export function resolvePortEquipmentLoopEditOwnership(
	organizations: StaticFabOrganizationState,
	equipmentGroupId: number,
): PortEquipmentLoopEditOwnership {
	const owners = organizations.records.filter((record) =>
		record.membership.equipmentGroupIds.includes(equipmentGroupId),
	);
	const ownerOrganizationIds = Object.freeze(owners.map((record) => record.id));
	if (owners.length === 0) return { ownerOrganizationIds, processLoopId: null, reason: null };
	if (owners.length !== 1)
		return {
			ownerOrganizationIds,
			processLoopId: null,
			reason: `장비 그룹 ${equipmentGroupId}은 여러 조직(${owners.map((owner) => owner.name).join(", ")})에 소속되어 있습니다 · 단일 Process Loop 소속으로 정리한 뒤 편집하세요`,
		};
	const owner = owners[0] as StaticFabOrganizationRecord;
	if (deriveStaticFabOrganizationSemanticRoles(organizations).get(owner.id) !== "PROCESS_LOOP")
		return {
			ownerOrganizationIds,
			processLoopId: null,
			reason: `장비 그룹 ${equipmentGroupId}의 소유 조직 '${owner.name}'은 Process Loop가 아닙니다 · FAB 구조에서 소속을 먼저 정리하세요`,
		};
	return { ownerOrganizationIds, processLoopId: owner.id, reason: null };
}

/** Shared by pointer previews, document commits/history, and the independent Worker mirror. */
export function portEquipmentLoopEditTargetError(
	organizations: StaticFabOrganizationState,
	beforeGroup: EquipmentGroupRecord,
	beforePorts: readonly PortRecord[],
	afterGroup: EquipmentGroupRecord | undefined,
	afterPorts: readonly PortRecord[],
): string | null {
	const ownership = resolvePortEquipmentLoopEditOwnership(organizations, beforeGroup.id);
	if (ownership.reason) return ownership.reason;
	if (ownership.processLoopId === null) return null;
	const owner = organizations.records.find((record) => record.id === ownership.processLoopId);
	if (!owner) return "소유 Loop가 변경되었습니다 · 장비를 다시 선택하세요";
	if (!afterGroup)
		return `장비 그룹 ${beforeGroup.id}은 '${owner.name}'에 소속되어 있습니다 · 철거하려면 소속을 먼저 분리하세요`;
	if (beforeGroup.kind === "STK" && beforeGroup.template === "CUSTOM")
		return "이전 CUSTOM Stocker는 소속을 유지한 이동·Port 편집을 지원하지 않습니다 · FLEX Stocker로 새로 배치하세요";
	if (
		!equipmentGroupEquals(
			copyEquipmentGroupWithPortIds(beforeGroup, beforeGroup.id, afterGroup.portIds),
			afterGroup,
		)
	) {
		return "소속 유지 편집에서는 장비 ID·종류·설정을 유지해야 합니다";
	}
	const beforeById = new Map(beforePorts.map((port) => [port.id, port]));
	const membershipChanged =
		beforePorts.length !== afterPorts.length || afterPorts.some((port) => !beforeById.has(port.id));
	if (membershipChanged) {
		if (beforeGroup.kind === "OHB") return "OHB 이동은 기존 Port ID를 유지해야 합니다";
		const retained = afterPorts.filter((port) => beforeById.has(port.id));
		if (retained.length === 0)
			return "Port ID 전체를 교체할 수 없습니다 · 장비 이동으로 기존 ID를 유지하세요";
		// Membership edits keep every surviving station byte-exact. Movement uses the same ID set.
		if (retained.some((port) => !portRecordEquals(beforeById.get(port.id) as PortRecord, port))) {
			return "Port 증감에서는 남아 있는 Port의 ID·위치·바코드·방향을 유지해야 합니다 · 이동과 Port 증감을 나누어 적용하세요";
		}
		for (const port of afterPorts) {
			if (beforeById.has(port.id)) continue;
			if (
				beforePorts.some(
					(before) =>
						portRouteIdentityEquals(before.route, port.route) &&
						before.stationMillimeters === port.stationMillimeters &&
						before.side === port.side &&
						before.lateralOffsetMillimeters === port.lateralOffsetMillimeters,
				)
			) {
				return "기존 정차 슬롯의 Port ID를 새 ID로 교체할 수 없습니다";
			}
			if (port.direction !== beforePorts[0]?.direction)
				return "추가 Port는 기존 장비의 서비스 방향을 유지해야 합니다";
		}
	}
	for (const port of afterPorts) {
		const before = beforeById.get(port.id);
		if (
			before &&
			(before.equipmentGroupId !== port.equipmentGroupId ||
				before.portType !== port.portType ||
				before.barcode !== port.barcode ||
				before.direction !== port.direction)
		) {
			return `PORT-${port.id}의 장비 소속·종류·바코드·서비스 방향은 소속 유지 편집에서 변경할 수 없습니다`;
		}
	}
	const edges = new Set(owner.membership.railEdges.map(staticFabOrganizationEdgeKey));
	const switches = new Set(owner.membership.advancedSwitchIds);
	for (const [group, ports] of [
		[beforeGroup, beforePorts],
		[afterGroup, afterPorts],
	] as const) {
		if (
			ports.length === 0 ||
			ports.length !== group.portIds.length ||
			new Set(ports.map((port) => port.id)).size !== ports.length ||
			ports.some(
				(port) =>
					!group.portIds.includes(port.id) ||
					port.equipmentGroupId !== group.id ||
					port.portType !== group.kind,
			)
		) {
			return `장비 그룹 ${group.id}의 전체 Port 관계를 다시 확인하세요`;
		}
		const outside = ports.find(
			(port) => !staticFabOrganizationMembershipSupportsPortRoute(port.route, edges, switches),
		);
		if (outside)
			return `PORT-${outside.id}가 소유 Loop '${owner.name}' 밖에 있습니다 · 모든 Port를 같은 Loop 안의 합법 슬롯에 배치하세요`;
	}
	return null;
}

/** Port-only, organization-unchanged patches may edit exactly one existing owned group. */
export function resolvePortEquipmentLoopEditTransition(
	organizations: StaticFabOrganizationState,
	before: PortEquipmentState,
	after: PortEquipmentState,
	portChanges: readonly PortMutation[],
	groupChanges: readonly EquipmentGroupMutation[],
): { readonly organizationIds: readonly number[]; readonly reason: string | null } {
	const groupIds = new Set(groupChanges.map((change) => change.id));
	for (const change of portChanges) {
		if (change.before) groupIds.add(change.before.equipmentGroupId);
		if (change.after) groupIds.add(change.after.equipmentGroupId);
	}
	const ownedIds = [...groupIds].filter((id) =>
		organizations.records.some((record) => record.membership.equipmentGroupIds.includes(id)),
	);
	if (ownedIds.length === 0) return { organizationIds: [], reason: null };
	if (groupIds.size !== 1)
		return {
			organizationIds: [],
			reason: "소속을 유지한 편집은 한 번에 장비 그룹 하나만 변경할 수 있습니다",
		};
	const groupId = ownedIds[0] as number;
	const beforeGroup = before.equipmentGroups.find((group) => group.id === groupId);
	if (!beforeGroup)
		return { organizationIds: [], reason: "소속 장비의 원본 그룹을 찾을 수 없습니다" };
	const afterGroup = after.equipmentGroups.find((group) => group.id === groupId);
	const reason = portEquipmentLoopEditTargetError(
		organizations,
		beforeGroup,
		before.ports.filter((port) => port.equipmentGroupId === groupId),
		afterGroup,
		after.ports.filter((port) => port.equipmentGroupId === groupId),
	);
	return {
		organizationIds: reason
			? []
			: resolvePortEquipmentLoopEditOwnership(organizations, groupId).ownerOrganizationIds,
		reason,
	};
}
