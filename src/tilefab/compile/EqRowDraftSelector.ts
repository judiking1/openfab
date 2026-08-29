import { EQ_MAXIMUM_PORT_COUNT, EQ_PORT_PITCHES_MILLIMETERS } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { type Direction, moveCell } from "../core/railShape";
import type { PortEquipmentGroupSlotIndex } from "./PortEquipmentGroupEditPlanner";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
} from "./PortSlotCompiler";

export { EQ_PORT_PITCHES_MILLIMETERS } from "../core/EquipmentGroup";

export type EqRowDraftState = "ANCHORED" | "READY" | "BLOCKED";

export interface EqRowDraftSelection {
	readonly state: EqRowDraftState;
	readonly valid: boolean;
	readonly reason: string;
	readonly anchorRow: number;
	readonly targetRow: number;
	readonly pitchMillimeters: number;
	/** Every pitch-selected row, including rows currently blocked by another port. */
	readonly rows: readonly number[];
	readonly blockedRows: readonly number[];
	/** Every 1 m source row proving uninterrupted rail between the first and last port. */
	readonly continuityRows: readonly number[];
}

/**
 * Rebuild the bounded continuity candidate row from the modular slot index.
 *
 * Membership-edit start can run before the renderer has rebound a newly compiled
 * slot catalog. This lookup therefore must not depend on the renderer's spatial
 * index. EQ groups are capped at 64 ports, so walking the source span remains
 * bounded even at the maximum 5 m pitch.
 */
export function eqRowDraftCandidatesFromSlotIndex(
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	sourcePort: PortRecord,
	anchorRow: number,
	targetRow: number,
	target: number[] = [],
): number[] {
	target.length = 0;
	if (
		slots.portType !== "EQ" ||
		!slotIndex.matches(slots) ||
		sourcePort.portType !== "EQ" ||
		sourcePort.route.kind !== "CARDINAL_CELL" ||
		!isSlotRow(slots, anchorRow) ||
		!isSlotRow(slots, targetRow)
	) {
		return target;
	}
	const travel = moveCell({ x: 0, y: 0 }, slots.routeToDirections[anchorRow] as Direction);
	const anchorX = slots.routeXs[anchorRow] as number;
	const anchorZ = slots.routeZs[anchorRow] as number;
	const deltaX = (slots.routeXs[targetRow] as number) - anchorX;
	const deltaZ = (slots.routeZs[targetRow] as number) - anchorZ;
	const longitudinal = deltaX * travel.x + deltaZ * travel.y;
	if (deltaX * -travel.y + deltaZ * travel.x !== 0) return target;
	const stepSign = longitudinal < 0 ? -1 : 1;
	for (let step = 0; step <= Math.abs(longitudinal); step++) {
		const row = slotIndex.rowForPort({
			...sourcePort,
			route: {
				...sourcePort.route,
				x: anchorX + travel.x * step * stepSign,
				z: anchorZ + travel.y * step * stepSign,
			},
		});
		if (row !== null) target.push(row);
	}
	return target;
}

/** Select one deterministic centerline EQ port row over an uninterrupted cardinal rail lane. */
export function selectEqRowDraft(
	slots: CompiledPortSlots,
	availability: PortSlotAvailabilityIndex,
	anchorRow: number,
	targetRow: number,
	candidateRows: readonly number[],
	pitchMillimeters: number,
	ignoredEquipmentGroupId = 0,
): EqRowDraftSelection {
	if (slots.portType !== "EQ" || availability.portType !== "EQ") {
		return invalid(anchorRow, targetRow, pitchMillimeters, "EQ 드래프트에는 EQ 슬롯이 필요합니다");
	}
	if (slots.revision !== availability.revision) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			"현재 레일 세대와 EQ 슬롯 세대가 다릅니다",
		);
	}
	if (!isEqPitch(pitchMillimeters)) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			"EQ 포트 피치는 1~5 m 정수 단위여야 합니다",
		);
	}
	if (!isSlotRow(slots, anchorRow) || !isSlotRow(slots, targetRow)) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			"EQ 행 드래프트 슬롯이 현재 버퍼 범위를 벗어났습니다",
		);
	}
	const anchorAvailability = availabilityForGroup(
		availability,
		slots,
		anchorRow,
		ignoredEquipmentGroupId,
	);
	if (anchorAvailability.status !== PORT_SLOT_STATUS.LEGAL) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			anchorAvailability.status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT
				? `EQ 행 시작점이 STK-${anchorAvailability.conflictingEquipmentGroupId} 점유 구간과 겹칩니다`
				: "EQ 행은 배치 가능한 CENTER 슬롯에서 시작해야 합니다",
		);
	}
	if (
		(slots.sides[anchorRow] as number) !== (slots.sides[targetRow] as number) ||
		(slots.routeFromDirections[anchorRow] as number) !==
			(slots.routeFromDirections[targetRow] as number) ||
		(slots.routeToDirections[anchorRow] as number) !==
			(slots.routeToDirections[targetRow] as number)
	) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			"같은 진행 방향의 CENTER 직선 레일 행으로 드래그하세요",
		);
	}

	const travel = moveCell({ x: 0, y: 0 }, slots.routeToDirections[anchorRow] as Direction);
	const anchorX = slots.routeXs[anchorRow] as number;
	const anchorZ = slots.routeZs[anchorRow] as number;
	const targetDeltaX = (slots.routeXs[targetRow] as number) - anchorX;
	const targetDeltaZ = (slots.routeZs[targetRow] as number) - anchorZ;
	const longitudinal = targetDeltaX * travel.x + targetDeltaZ * travel.y;
	const lateral = targetDeltaX * -travel.y + targetDeltaZ * travel.x;
	if (lateral !== 0) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			"평행하거나 떨어진 레일은 하나의 EQ로 묶을 수 없습니다",
		);
	}
	const pitchCells = pitchMillimeters / 1_000;
	const selectedPortCount = Math.floor(Math.abs(longitudinal) / pitchCells) + 1;
	if (selectedPortCount > EQ_MAXIMUM_PORT_COUNT) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			`EQ 한 그룹은 최대 ${EQ_MAXIMUM_PORT_COUNT}개 포트까지 배치할 수 있습니다`,
		);
	}

	const matchingRows = new Map<string, number>();
	for (const row of candidateRows) {
		if (!isSlotRow(slots, row)) continue;
		if ((slots.sides[row] as number) !== (slots.sides[anchorRow] as number)) continue;
		if (
			(slots.routeFromDirections[row] as number) !==
				(slots.routeFromDirections[anchorRow] as number) ||
			(slots.routeToDirections[row] as number) !== (slots.routeToDirections[anchorRow] as number)
		) {
			continue;
		}
		const key = routeCellKey(slots.routeXs[row] as number, slots.routeZs[row] as number);
		if (matchingRows.has(key)) {
			return invalid(anchorRow, targetRow, pitchMillimeters, "EQ 행에 중복된 레일 슬롯이 있습니다");
		}
		matchingRows.set(key, row);
	}

	const selectedRows: number[] = [];
	const continuityRows: number[] = [];
	const stepSign = longitudinal < 0 ? -1 : 1;
	const selectedSpanCells = (selectedPortCount - 1) * pitchCells;
	for (let step = 0; step <= selectedSpanCells; step++) {
		const x = anchorX + travel.x * step * stepSign;
		const z = anchorZ + travel.y * step * stepSign;
		const row = matchingRows.get(routeCellKey(x, z));
		if (row === undefined) {
			return invalid(
				anchorRow,
				targetRow,
				pitchMillimeters,
				"커브, 분기, 끝점 또는 빈 구간을 가로질러 EQ를 만들 수 없습니다",
			);
		}
		continuityRows.push(row);
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			return invalid(
				anchorRow,
				targetRow,
				pitchMillimeters,
				"EQ 행은 커브·분기·끝점·레일 간격 제한 구간을 통과할 수 없습니다",
				selectedRows,
				[],
				continuityRows,
			);
		}
		if (step % pitchCells === 0) selectedRows.push(row);
	}
	if (selectedRows.length < 2) {
		return selection(
			"ANCHORED",
			false,
			anchorRow,
			targetRow,
			pitchMillimeters,
			`EQ에는 ${pitchCells} m 피치의 포트가 최소 2개 필요합니다`,
			selectedRows,
			[],
			continuityRows,
		);
	}
	for (const row of continuityRows) {
		const result = availabilityForGroup(availability, slots, row, ignoredEquipmentGroupId);
		if (
			result.status !== PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT &&
			result.conflictingEquipmentGroupId === 0
		) {
			continue;
		}
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			`EQ 배치 구간이 STK-${result.conflictingEquipmentGroupId} 점유 구간과 겹칩니다`,
			selectedRows,
			[row],
			continuityRows,
		);
	}

	const blockedRows = selectedRows.filter(
		(row) =>
			availabilityForGroup(availability, slots, row, ignoredEquipmentGroupId).status !==
			PORT_SLOT_STATUS.LEGAL,
	);
	if (blockedRows.length > 0) {
		return invalid(
			anchorRow,
			targetRow,
			pitchMillimeters,
			`EQ 포트 ${blockedRows.length}개가 기존 포트와 충돌합니다`,
			selectedRows,
			blockedRows,
			continuityRows,
		);
	}
	return Object.freeze({
		state: "READY",
		valid: true,
		reason: `EQ ${selectedRows.length} PORT · PITCH ${pitchCells} m`,
		anchorRow,
		targetRow,
		pitchMillimeters,
		rows: Object.freeze(selectedRows),
		blockedRows: Object.freeze([]),
		continuityRows: Object.freeze(continuityRows),
	});
}

function availabilityForGroup(
	availability: PortSlotAvailabilityIndex,
	slots: CompiledPortSlots,
	row: number,
	ignoredEquipmentGroupId: number,
) {
	return ignoredEquipmentGroupId > 0
		? availability.statusForEquipmentGroup(slots, row, ignoredEquipmentGroupId)
		: availability.statusFor(slots, row);
}

/** Cheap preflight used before querying every slot between a distant pointer and its anchor. */
export function eqRowDraftExceedsMaximum(
	slots: CompiledPortSlots,
	anchorRow: number,
	targetRow: number,
	pitchMillimeters: number,
): boolean {
	if (
		!isEqPitch(pitchMillimeters) ||
		!isSlotRow(slots, anchorRow) ||
		!isSlotRow(slots, targetRow)
	) {
		return false;
	}
	const travel = moveCell({ x: 0, y: 0 }, slots.routeToDirections[anchorRow] as Direction);
	const deltaX = (slots.routeXs[targetRow] as number) - (slots.routeXs[anchorRow] as number);
	const deltaZ = (slots.routeZs[targetRow] as number) - (slots.routeZs[anchorRow] as number);
	if (deltaX * -travel.y + deltaZ * travel.x !== 0) return false;
	const longitudinal = Math.abs(deltaX * travel.x + deltaZ * travel.y);
	return Math.floor(longitudinal / (pitchMillimeters / 1_000)) + 1 > EQ_MAXIMUM_PORT_COUNT;
}

export function createInvalidEqRowDraftSelection(
	anchorRow: number,
	targetRow: number,
	pitchMillimeters: number,
	reason: string,
): EqRowDraftSelection {
	return invalid(anchorRow, targetRow, pitchMillimeters, reason);
}

export function isEqPitch(value: number): boolean {
	return EQ_PORT_PITCHES_MILLIMETERS.includes(value);
}

function invalid(
	anchorRow: number,
	targetRow: number,
	pitchMillimeters: number,
	reason: string,
	rows: readonly number[] = [],
	blockedRows: readonly number[] = [],
	continuityRows: readonly number[] = [],
): EqRowDraftSelection {
	return selection(
		"BLOCKED",
		false,
		anchorRow,
		targetRow,
		pitchMillimeters,
		reason,
		rows,
		blockedRows,
		continuityRows,
	);
}

function selection(
	state: EqRowDraftState,
	valid: boolean,
	anchorRow: number,
	targetRow: number,
	pitchMillimeters: number,
	reason: string,
	rows: readonly number[] = [],
	blockedRows: readonly number[] = [],
	continuityRows: readonly number[] = [],
): EqRowDraftSelection {
	return Object.freeze({
		state,
		valid,
		reason,
		anchorRow,
		targetRow,
		pitchMillimeters,
		rows: Object.freeze([...rows]),
		blockedRows: Object.freeze([...blockedRows]),
		continuityRows: Object.freeze([...continuityRows]),
	});
}

function isSlotRow(slots: CompiledPortSlots, row: number): boolean {
	return Number.isInteger(row) && row >= 0 && row < slots.count;
}

function routeCellKey(x: number, z: number): string {
	return `${x}:${z}`;
}
