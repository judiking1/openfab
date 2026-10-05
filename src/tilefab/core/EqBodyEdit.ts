import {
	type EquipmentGroupMutation,
	eqBodyDimensionsEqual,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	portEquipmentLoopEditTargetError,
	resolvePortEquipmentLoopEditOwnership,
} from "./PortEquipmentLoopEdit";
import type { PortMutation } from "./PortRecord";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";

/** Exact body-only edit; movement/membership editing retains its stricter metadata invariant. */
export function resolveEqBodyEditTransition(
	organizations: StaticFabOrganizationState,
	before: PortEquipmentState,
	after: PortEquipmentState,
	portChanges: readonly PortMutation[],
	groupChanges: readonly EquipmentGroupMutation[],
): { readonly organizationIds: readonly number[]; readonly reason: string | null } | null {
	if (
		!groupChanges.some(
			(change) =>
				change.before?.kind === "EQ" &&
				change.after?.kind === "EQ" &&
				!eqBodyDimensionsEqual(change.before.bodyDimensions, change.after.bodyDimensions),
		)
	)
		return null;
	const reject = (reason: string) => ({ organizationIds: [], reason });
	if (portChanges.length !== 0 || groupChanges.length !== 1)
		return reject("몸체 크기는 EQ 하나의 전체 Port를 고정한 상태에서 변경해야 합니다");
	const change = groupChanges[0] as EquipmentGroupMutation;
	const source = before.equipmentGroups.find((group) => group.id === change.id);
	const target = after.equipmentGroups.find((group) => group.id === change.id);
	if (
		source?.kind !== "EQ" ||
		target?.kind !== "EQ" ||
		!equipmentGroupEquals(source, change.before) ||
		!equipmentGroupEquals(target, change.after) ||
		!equipmentGroupEquals(source, { ...target, bodyDimensions: source.bodyDimensions })
	)
		return reject("EQ 몸체 편집에서는 장비 ID·종류·Port 구성·피치·레시피를 유지해야 합니다");
	const ports = before.ports.filter((port) => port.equipmentGroupId === source.id);
	const reason = portEquipmentLoopEditTargetError(organizations, source, ports, source, ports);
	return {
		organizationIds: reason
			? []
			: resolvePortEquipmentLoopEditOwnership(organizations, source.id).ownerOrganizationIds,
		reason,
	};
}
