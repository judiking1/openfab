import {
	type EquipmentGroupMutation,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	portEquipmentLoopEditTargetError,
	resolvePortEquipmentLoopEditOwnership,
} from "./PortEquipmentLoopEdit";
import {
	type PortDirection,
	type PortMutation,
	type PortRecord,
	portRecordEquals,
} from "./PortRecord";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";

export function reversePortServiceDirection(direction: PortDirection): PortDirection {
	return direction === "WITH_TRAVEL" ? "AGAINST_TRAVEL" : "WITH_TRAVEL";
}

/**
 * A separate transition from movement/membership editing. Null means no existing Port changed
 * direction. A reversal must change every Port of exactly one group and no other authored field.
 * Document and Worker both derive this proof from their own current source, including for history.
 */
export function resolvePortEquipmentServiceDirectionTransition(
	organizations: StaticFabOrganizationState,
	before: PortEquipmentState,
	after: PortEquipmentState,
	portChanges: readonly PortMutation[],
	groupChanges: readonly EquipmentGroupMutation[],
): { readonly organizationIds: readonly number[]; readonly reason: string | null } | null {
	if (
		!portChanges.some(
			(change) =>
				change.before && change.after && change.before.direction !== change.after.direction,
		)
	) {
		return null;
	}
	const reject = (reason: string) => ({ organizationIds: [], reason });
	if (groupChanges.length !== 0) {
		return reject("서비스 방향 반전은 장비 종류·설정·Port 구성을 함께 변경할 수 없습니다");
	}
	const groupId = portChanges[0]?.before?.equipmentGroupId;
	const group = before.equipmentGroups.find((candidate) => candidate.id === groupId);
	if (
		!group ||
		!equipmentGroupEquals(
			group,
			after.equipmentGroups.find((candidate) => candidate.id === groupId),
		)
	) {
		return reject("서비스 방향을 반전할 장비가 변경되었습니다 · 장비를 다시 선택하세요");
	}
	if (group.kind === "STK" && group.template === "CUSTOM") {
		return reject(
			"이전 CUSTOM Stocker는 서비스 방향 반전을 지원하지 않습니다 · FLEX Stocker로 새로 배치하세요",
		);
	}
	const ports = before.ports.filter((port) => port.equipmentGroupId === group.id);
	if (
		ports.length === 0 ||
		ports.length !== group.portIds.length ||
		new Set(group.portIds).size !== ports.length ||
		ports.some((port) => !group.portIds.includes(port.id) || port.portType !== group.kind) ||
		portChanges.length !== ports.length ||
		new Set(portChanges.map((change) => change.id)).size !== ports.length
	) {
		return reject(
			"서비스 방향 반전은 장비 하나의 전체 Port를 한 번에 변경해야 합니다 · 장비를 다시 선택하세요",
		);
	}
	const changesById = new Map(portChanges.map((change) => [change.id, change]));
	const afterById = new Map(after.ports.map((port) => [port.id, port]));
	for (const port of ports) {
		const change = changesById.get(port.id);
		const expected: PortRecord = {
			...port,
			direction: reversePortServiceDirection(port.direction),
		};
		if (
			!change ||
			!portRecordEquals(port, change.before) ||
			!portRecordEquals(expected, change.after) ||
			!portRecordEquals(expected, afterById.get(port.id))
		) {
			return reject(
				"서비스 방향 반전은 전체 Port의 direction만 뒤집어야 합니다 · 위치·경로·ID·바코드·소속을 유지하세요",
			);
		}
	}
	// Check ownership and containment on the unchanged source. The ordinary movement validator
	// still forbids direction changes; it never receives an exception for a partial flip.
	const reason = portEquipmentLoopEditTargetError(organizations, group, ports, group, ports);
	return {
		organizationIds: reason
			? []
			: resolvePortEquipmentLoopEditOwnership(organizations, group.id).ownerOrganizationIds,
		reason,
	};
}
