import {
	EQ_PORT_PITCHES_MILLIMETERS,
	type EqEquipmentGroup,
	type EquipmentGroupMutation,
	equipmentGroupEquals,
	equipmentGroupError,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	portEquipmentLoopEditTargetError,
	resolvePortEquipmentLoopEditOwnership,
} from "./PortEquipmentLoopEdit";
import { type PortMutation, type PortRecord, portRecordEquals } from "./PortRecord";
import { moveCell, oppositeDirection } from "./railShape";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";

/** Preserve the canonical Port order and every field except the longitudinal cell coordinate. */
export function eqPitchPortTargets(
	group: EqEquipmentGroup,
	ports: readonly PortRecord[],
	anchorPortId: number,
	pitchMillimeters: number,
): readonly PortRecord[] {
	if (!EQ_PORT_PITCHES_MILLIMETERS.includes(pitchMillimeters))
		throw new Error("EQ Port 간격은 1–5 m 중에서 선택하세요");
	const anchorIndex = group.portIds.indexOf(anchorPortId);
	const byId = new Map(ports.map((port) => [port.id, port]));
	const anchor = byId.get(anchorPortId);
	if (
		anchorIndex < 0 ||
		!anchor ||
		anchor.route.kind !== "CARDINAL_CELL" ||
		anchor.route.to === 0 ||
		anchor.route.from !== oppositeDirection(anchor.route.to)
	)
		throw new Error("고정할 EQ Port를 다시 선택하세요");
	const route = anchor.route;
	const travel = moveCell({ x: 0, y: 0 }, anchor.route.to);
	return group.portIds.map((id, index) => {
		const port = byId.get(id);
		const sourceDistance = ((index - anchorIndex) * group.pitchMillimeters) / 1_000;
		if (
			!port ||
			port.equipmentGroupId !== group.id ||
			port.portType !== "EQ" ||
			port.route.kind !== "CARDINAL_CELL" ||
			port.route.from !== route.from ||
			port.route.to !== route.to ||
			port.route.x !== route.x + sourceDistance * travel.x ||
			port.route.z !== route.z + sourceDistance * travel.y ||
			port.stationMillimeters !== 500 ||
			port.side !== "CENTER" ||
			port.lateralOffsetMillimeters !== 0
		)
			throw new Error("기존 EQ Port의 순서·간격·직선 슬롯을 확인하세요");
		const distance = ((index - anchorIndex) * pitchMillimeters) / 1_000;
		return {
			...port,
			route: { ...port.route, x: route.x + distance * travel.x, z: route.z + distance * travel.y },
		};
	});
}

/** Re-prove the pitch-only exemption in both directions at document/history and Worker admission. */
export function resolveEqPitchEditTransition(
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
				change.before.pitchMillimeters !== change.after.pitchMillimeters,
		)
	)
		return null;
	const reject = (reason: string) => ({ organizationIds: [], reason });
	if (groupChanges.length !== 1) return reject("Port 간격은 EQ 하나씩 변경하세요");
	const change = groupChanges[0] as EquipmentGroupMutation;
	const source = before.equipmentGroups.find((group) => group.id === change.id);
	const target = after.equipmentGroups.find((group) => group.id === change.id);
	if (
		source?.kind !== "EQ" ||
		target?.kind !== "EQ" ||
		!equipmentGroupEquals(source, change.before) ||
		!equipmentGroupEquals(target, change.after) ||
		!equipmentGroupEquals(source, { ...target, pitchMillimeters: source.pitchMillimeters }) ||
		before.nextPortId !== after.nextPortId ||
		before.nextEquipmentGroupId !== after.nextEquipmentGroupId
	)
		return reject("간격 편집에서는 EQ ID·Port 구성·몸체 설정·레시피를 유지해야 합니다");
	const groupError = equipmentGroupError(target);
	if (groupError) return reject(groupError);
	const sourcePorts = before.ports.filter((port) => port.equipmentGroupId === source.id);
	const targetPorts = after.ports.filter((port) => port.equipmentGroupId === source.id);
	const targets = new Map(targetPorts.map((port) => [port.id, port]));
	const anchors = sourcePorts.filter((port) => portRecordEquals(port, targets.get(port.id)));
	if (
		anchors.length !== 1 ||
		sourcePorts.length !== source.portIds.length ||
		targetPorts.length !== sourcePorts.length ||
		portChanges.length !== sourcePorts.length - 1 ||
		new Set(portChanges.map((port) => port.id)).size !== portChanges.length ||
		portChanges.some(
			(port) =>
				!port.before ||
				!port.after ||
				!portRecordEquals(
					port.before,
					sourcePorts.find((sourcePort) => sourcePort.id === port.id),
				) ||
				!portRecordEquals(port.after, targets.get(port.id)),
		)
	)
		return reject("간격 편집에서는 기준 Port 하나를 고정하고 기존 Port ID·개수를 유지해야 합니다");
	try {
		const expected = eqPitchPortTargets(
			source,
			sourcePorts,
			(anchors[0] as PortRecord).id,
			target.pitchMillimeters,
		);
		if (expected.some((port) => !portRecordEquals(port, targets.get(port.id))))
			return reject(
				"기준 Port를 중심으로 간격만 변경하세요 · 바코드·방향·슬롯 속성은 유지해야 합니다",
			);
	} catch (error) {
		return reject(error instanceof Error ? error.message : "EQ 간격을 확인할 수 없습니다");
	}
	// Only pitch has been proved different. Reuse every ownership and containment check with
	// the original configuration; do not relax the generic movement/membership contract.
	const reason = portEquipmentLoopEditTargetError(
		organizations,
		source,
		sourcePorts,
		source,
		targetPorts,
	);
	return {
		organizationIds: reason
			? []
			: resolvePortEquipmentLoopEditOwnership(organizations, source.id).ownerOrganizationIds,
		reason,
	};
}
