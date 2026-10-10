import {
	applyPortEquipmentMutations,
	collectPortEquipmentIntegrityIssues,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	copyEquipmentGroupWithPortIds,
} from "../core/EquipmentGroupPortOrder";
import {
	assertPortEquipmentLayout,
	stkBodySectionDimensionsEqual,
} from "../core/PortEquipmentLayoutValidator";
import { portEquipmentLoopEditTargetError } from "../core/PortEquipmentLoopEdit";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import { type CardinalPortRoute, type PortRecord, portRecordEquals } from "../core/PortRecord";
import { moveCell } from "../core/railShape";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import { decodeRailCell, type TileMap } from "../core/TileMap";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import {
	capturePortEquipmentGroupEditSnapshot,
	type PortEquipmentGroupEditMetadata,
	type PortEquipmentGroupEditPlan,
	type PortEquipmentGroupSlotIndex,
} from "./PortEquipmentGroupEditPlanner";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
	portSlotRecord,
} from "./PortSlotCompiler";
import { type StkBodySweep, StkBodySweepIndex } from "./StkBodySweep";

/** Derive only this group's prospective bodies with the same compiler used after Apply. */
export function deriveFlexStkPortMoveBodyPreview(
	layout: CompiledPhysicalLayout,
	state: PortEquipmentState,
	plan: PortEquipmentGroupEditPlan,
): readonly StkBodySweep[] {
	if (!plan.valid || plan.groupEdit.scope !== "port" || layout.revision !== plan.baseRevision)
		return [];
	const id = plan.groupEdit.sourceEquipmentGroupId;
	const source = state.equipmentGroups.find((group) => group.id === id);
	const group = plan.equipmentGroupMutations.find((change) => change.id === id)?.after ?? source;
	if (!group || group.kind !== "STK" || group.template !== "FLEX") return [];
	const portsById = new Map(
		state.ports.filter((port) => port.equipmentGroupId === id).map((port) => [port.id, port]),
	);
	for (const change of plan.portMutations) {
		if (!change.after || !portRecordEquals(portsById.get(change.id), change.before)) return [];
		portsById.set(change.id, change.after);
	}
	const ports = group.portIds.map((portId) => portsById.get(portId));
	if (!ports.every((port): port is PortRecord => port !== undefined)) return [];
	return new StkBodySweepIndex(layout, { ...state, ports, equipmentGroups: [group] }, false).sweeps;
}

/** Signed metres from the source along its authored travel direction; admission still uses the move planner. */
export function flexStkPortRowAtDistance(
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	source: PortRecord,
	distance: number,
): number | null {
	if (
		!slotIndex.matches(slots) ||
		slots.portType !== "STK" ||
		!Number.isSafeInteger(distance) ||
		source.route.kind !== "CARDINAL_CELL" ||
		source.route.to === 0 ||
		slotIndex.rowForPort(source) === null
	)
		return null;
	const travel = moveCell({ x: 0, y: 0 }, source.route.to);
	return slotIndex.rowForPort({
		...source,
		route: {
			...source.route,
			x: source.route.x + travel.x * distance,
			z: source.route.z + travel.y * distance,
		},
	});
}

export function flexStkPortDistanceForRow(
	slots: CompiledPortSlots,
	source: PortRecord,
	row: number | null,
): number | null {
	if (
		row === null ||
		!Number.isInteger(row) ||
		row < 0 ||
		row >= slots.count ||
		source.route.kind !== "CARDINAL_CELL" ||
		source.route.to === 0
	)
		return null;
	const travel = moveCell({ x: 0, y: 0 }, source.route.to);
	const dx = (slots.routeXs[row] as number) - source.route.x;
	const dz = (slots.routeZs[row] as number) - source.route.z;
	return dx * travel.y === dz * travel.x ? dx * travel.x + dz * travel.y : null;
}

/** A single-Port nudge never skips a gap or waits for the renderer to bind its spatial index. */
export function adjacentFlexStkPortRow(
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	source: PortRecord,
	currentRow: number,
	deltaX: number,
	deltaZ: number,
): number | null {
	if (
		!slotIndex.matches(slots) ||
		slots.portType !== "STK" ||
		!Number.isInteger(currentRow) ||
		currentRow < 0 ||
		currentRow >= slots.count ||
		!Number.isInteger(deltaX) ||
		!Number.isInteger(deltaZ) ||
		Math.abs(deltaX) + Math.abs(deltaZ) !== 1
	)
		return null;
	if (source.route.kind !== "CARDINAL_CELL" || source.route.to === 0) return null;
	const travel = moveCell({ x: 0, y: 0 }, source.route.to);
	if (travel.x * deltaZ !== travel.y * deltaX) return null;
	return slotIndex.rowForPort({
		...source,
		route: {
			...source.route,
			x: (slots.routeXs[currentRow] as number) + deltaX,
			z: (slots.routeZs[currentRow] as number) + deltaZ,
		},
	});
}

/** One retained identity, one prospective state, and the ordinary Document/Worker admission. */
export function planMoveFlexStkPort(
	map: TileMap,
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	selection: { readonly equipmentGroupId: number; readonly portId: number },
	targetRow: number,
	baseRevision: number,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
): PortEquipmentGroupEditPlan {
	const groupEdit: PortEquipmentGroupEditMetadata = Object.freeze({
		scope: "port",
		mode: "move",
		sourceEquipmentGroupId: selection.equipmentGroupId,
		targetEquipmentGroupId: selection.equipmentGroupId,
		sourceAnchorPortId: selection.portId,
		targetAnchorRow: targetRow,
		quarterTurns: 0,
		portTargets: Object.freeze([
			Object.freeze({
				sourcePortId: selection.portId,
				targetPortId: selection.portId,
				row: targetRow,
			}),
		]),
	});
	const fail = (reason: string): PortEquipmentGroupEditPlan =>
		Object.freeze({
			...createInvalidPortEquipmentMutationPlan(
				"edit-port-equipment",
				baseRevision,
				basePatchSequence,
				reason,
			),
			groupEdit,
		});
	if (
		map.getRevision() !== baseRevision ||
		slots.revision !== baseRevision ||
		slotIndex.revision !== baseRevision ||
		availability.revision !== baseRevision ||
		!slotIndex.matches(slots) ||
		!availability.matchesState(state)
	)
		return fail("원본 슬롯이나 장비가 변경되었습니다 · Port 이동을 다시 시작하세요");
	if (slots.portType !== "STK" || slotIndex.portType !== "STK" || availability.portType !== "STK")
		return fail("FLEX STK Port의 직선 슬롯을 선택하세요");
	if (!Number.isInteger(targetRow) || targetRow < 0 || targetRow >= slots.count)
		return fail("선택한 Port를 놓을 직선 슬롯이 없습니다");
	if (collectPortEquipmentIntegrityIssues(state).length > 0)
		return fail("장비 Port 관계가 불완전합니다 · 장비를 다시 확인하세요");
	try {
		const snapshot = capturePortEquipmentGroupEditSnapshot(
			state,
			selection.equipmentGroupId,
			selection.portId,
		);
		const group = snapshot.equipmentGroup;
		if (group.kind !== "STK" || group.template !== "FLEX" || group.portIds.length < 2)
			return fail("여러 Port가 있는 FLEX STK에서 이동할 Port 하나를 선택하세요");
		const source = snapshot.ports.find((port) => port.id === selection.portId);
		if (!source || source.route.kind !== "CARDINAL_CELL" || slotIndex.rowForPort(source) === null)
			return fail("선택한 Port의 기존 슬롯이 정확하지 않습니다");
		const targetSlot = portSlotRecord(slots, targetRow, source.id, group.id, source.barcode);
		if (
			targetSlot.route.kind !== "CARDINAL_CELL" ||
			!sameDirectedStraightRun(map, source.route, targetSlot.route) ||
			targetSlot.stationMillimeters !== source.stationMillimeters ||
			targetSlot.side !== source.side ||
			targetSlot.lateralOffsetMillimeters !== source.lateralOffsetMillimeters
		)
			return fail("선택한 Port와 같은 연속 직선 구간의 슬롯을 선택하세요");
		const moved = Object.freeze({ ...source, route: Object.freeze({ ...targetSlot.route }) });
		if (portRecordEquals(source, moved)) return fail("현재 위치입니다 · 다른 슬롯을 선택하세요");
		if (slots.statuses[targetRow] !== PORT_SLOT_STATUS.LEGAL)
			return fail(`PORT-${source.id}가 놓일 슬롯이 안전하지 않습니다`);
		if (
			availability.statusForEquipmentGroup(slots, targetRow, group.id).status !==
			PORT_SLOT_STATUS.LEGAL
		)
			return fail(`PORT-${source.id}의 대상 슬롯이 다른 장비와 겹칩니다`);
		const occupiedPort = snapshot.ports.find(
			(port) => port.id !== source.id && slotIndex.rowForPort(port) === targetRow,
		);
		if (occupiedPort)
			return fail(`PORT-${occupiedPort.id}가 사용 중인 슬롯입니다 · 다른 위치를 선택하세요`);
		const targetPorts = snapshot.ports.map((port) => (port.id === source.id ? moved : port));
		const targetGroup = copyEquipmentGroupWithPortIds(
			group,
			group.id,
			canonicalEquipmentGroupPortIds(group, group.portIds, targetPorts),
		);
		const ownershipError = portEquipmentLoopEditTargetError(
			organizations,
			group,
			snapshot.ports,
			targetGroup,
			targetPorts,
		);
		if (ownershipError) return fail(ownershipError);
		const portMutations = [Object.freeze({ id: source.id, before: source, after: moved })];
		const groupMutations = equipmentGroupEquals(group, targetGroup)
			? []
			: [Object.freeze({ id: group.id, before: group, after: targetGroup })];
		const prospective = applyPortEquipmentMutations(state, portMutations, groupMutations);
		assertPortEquipmentLayout(map, prospective);
		if (!stkBodySectionDimensionsEqual(map, group, snapshot.ports, targetPorts))
			return fail(
				"몸체 길이를 유지하는 슬롯을 선택하세요 · 끝 Port 이동은 몸체 길이를 바꿀 수 있습니다",
			);
		return Object.freeze({
			...createPortEquipmentMutationPlan(
				"edit-port-equipment",
				baseRevision,
				basePatchSequence,
				portMutations,
				groupMutations,
			),
			reason: `PORT-${source.id}만 이동 · 다른 Port와 ID·바코드·방향·소속 유지`,
			groupEdit,
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : "STK Port를 이동할 수 없습니다";
		return fail(reason.replace(/^Port equipment layout is invalid:\s*/, "") || reason);
	}
}

/** Exact directed 1/1 cells exclude gaps, corners, branches, opposite and parallel runs. */
function sameDirectedStraightRun(
	map: TileMap,
	source: CardinalPortRoute,
	target: CardinalPortRoute,
): boolean {
	if (source.to === 0 || source.from !== target.from || source.to !== target.to) return false;
	const travel = moveCell({ x: 0, y: 0 }, source.to);
	const dx = target.x - source.x,
		dz = target.z - source.z;
	if (dx * travel.y !== dz * travel.x) return false;
	const distance = dx * travel.x + dz * travel.y;
	for (let index = 0; index <= Math.abs(distance); index++) {
		const step = index * Math.sign(distance);
		const rail = decodeRailCell(
			map.getEncoded(source.x + step * travel.x, source.z + step * travel.y),
		);
		if (rail.incoming !== source.from || rail.outgoing !== source.to) return false;
	}
	return true;
}
