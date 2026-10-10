import {
	type EquipmentGroupMutation,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	portEquipmentLoopEditTargetError,
	resolvePortEquipmentLoopEditOwnership,
} from "./PortEquipmentLoopEdit";
import type { PortMutation } from "./PortRecord";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";

/** Authoring label only: exactly one retained EQ, with no Port or other setting changes. */
export function resolveEqRecipeEditTransition(
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
				change.before.recipe !== change.after.recipe,
		)
	)
		return null;
	const reject = (reason: string) => ({ organizationIds: [], reason });
	if (
		portChanges.length !== 0 ||
		groupChanges.length !== 1 ||
		before.nextPortId !== after.nextPortId ||
		before.nextEquipmentGroupId !== after.nextEquipmentGroupId
	)
		return reject("Recipe 편집은 기존 EQ 하나의 Recipe만 변경해야 합니다");
	const change = groupChanges[0] as EquipmentGroupMutation;
	const source = before.equipmentGroups.find((group) => group.id === change.id);
	const target = after.equipmentGroups.find((group) => group.id === change.id);
	if (
		source?.kind !== "EQ" ||
		target?.kind !== "EQ" ||
		!equipmentGroupEquals(source, change.before) ||
		!equipmentGroupEquals(target, change.after) ||
		!equipmentGroupEquals(source, { ...target, recipe: source.recipe })
	)
		return reject("Recipe 편집에서는 장비 ID·Port 구성·피치·몸체 크기를 유지해야 합니다");
	const ports = before.ports.filter((port) => port.equipmentGroupId === source.id);
	const reason = portEquipmentLoopEditTargetError(organizations, source, ports, source, ports);
	return {
		organizationIds: reason
			? []
			: resolvePortEquipmentLoopEditOwnership(organizations, source.id).ownerOrganizationIds,
		reason,
	};
}
