import { PORT_SIDES } from "../core/PortRecord";
import { type Direction, moveCell } from "../core/railShape";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
	type PortSlotBounds,
} from "./PortSlotCompiler";

export interface OhbRowDragSelection {
	readonly valid: boolean;
	readonly reason: string;
	readonly anchorRow: number;
	readonly targetRow: number;
	readonly rows: readonly number[];
	readonly skippedRows: readonly number[];
	readonly conflictingEquipmentGroupIds: readonly number[];
}

const ROW_QUERY_MARGIN_METERS = 0.25;
const TARGET_QUERY_RADIUS_METERS = 1.75;
const TARGET_LONGITUDINAL_SNAP_METERS = 0.75;
const TARGET_LATERAL_DRIFT_METERS = 1.75;

export function ohbRowDragBounds(
	slots: CompiledPortSlots,
	anchorRow: number,
	targetRow: number,
): PortSlotBounds {
	assertSlotRow(slots, anchorRow);
	assertSlotRow(slots, targetRow);
	const anchorOffset = anchorRow * 2;
	const targetOffset = targetRow * 2;
	const anchorX = slots.worldPositions[anchorOffset] as number;
	const anchorZ = slots.worldPositions[anchorOffset + 1] as number;
	const targetX = slots.worldPositions[targetOffset] as number;
	const targetZ = slots.worldPositions[targetOffset + 1] as number;
	return {
		minX: Math.min(anchorX, targetX) - ROW_QUERY_MARGIN_METERS,
		minZ: Math.min(anchorZ, targetZ) - ROW_QUERY_MARGIN_METERS,
		maxX: Math.max(anchorX, targetX) + ROW_QUERY_MARGIN_METERS,
		maxZ: Math.max(anchorZ, targetZ) + ROW_QUERY_MARGIN_METERS,
	};
}

export const portRowDragBounds = ohbRowDragBounds;

export function ohbRowDragTargetBounds(world: {
	readonly x: number;
	readonly y: number;
}): PortSlotBounds {
	return {
		minX: world.x - TARGET_QUERY_RADIUS_METERS,
		minZ: world.y - TARGET_QUERY_RADIUS_METERS,
		maxX: world.x + TARGET_QUERY_RADIUS_METERS,
		maxZ: world.y + TARGET_QUERY_RADIUS_METERS,
	};
}

export const portRowDragTargetBounds = ohbRowDragTargetBounds;

/** Resolve pointer progress on the side and cardinal lane locked at pointer-down. */
export function findOhbRowDragTarget(
	slots: CompiledPortSlots,
	anchorRow: number,
	world: { readonly x: number; readonly y: number },
	candidateRows: readonly number[],
): number | null {
	if (!isSlotRow(slots, anchorRow)) return null;
	const anchorSide = slots.sides[anchorRow] as number;
	const anchorFrom = slots.routeFromDirections[anchorRow] as number;
	const anchorTo = slots.routeToDirections[anchorRow] as Direction;
	const anchorX = slots.routeXs[anchorRow] as number;
	const anchorZ = slots.routeZs[anchorRow] as number;
	const travel = moveCell({ x: 0, y: 0 }, anchorTo);
	let bestRow: number | null = null;
	let bestLongitudinalDistance = Number.POSITIVE_INFINITY;
	let bestLateralDistance = Number.POSITIVE_INFINITY;

	for (const row of candidateRows) {
		if (!isSlotRow(slots, row)) continue;
		if (
			(slots.sides[row] as number) !== anchorSide ||
			(slots.routeFromDirections[row] as number) !== anchorFrom ||
			(slots.routeToDirections[row] as number) !== anchorTo
		) {
			continue;
		}
		const routeDeltaX = (slots.routeXs[row] as number) - anchorX;
		const routeDeltaZ = (slots.routeZs[row] as number) - anchorZ;
		if (routeDeltaX * -travel.y + routeDeltaZ * travel.x !== 0) continue;

		const worldDeltaX = world.x - (slots.worldPositions[row * 2] as number);
		const worldDeltaZ = world.y - (slots.worldPositions[row * 2 + 1] as number);
		const longitudinalDistance = Math.abs(worldDeltaX * travel.x + worldDeltaZ * travel.y);
		const lateralDistance = Math.abs(worldDeltaX * -travel.y + worldDeltaZ * travel.x);
		if (
			longitudinalDistance > TARGET_LONGITUDINAL_SNAP_METERS ||
			lateralDistance > TARGET_LATERAL_DRIFT_METERS
		) {
			continue;
		}
		if (
			longitudinalDistance < bestLongitudinalDistance ||
			(longitudinalDistance === bestLongitudinalDistance &&
				(lateralDistance < bestLateralDistance ||
					(lateralDistance === bestLateralDistance && (bestRow === null || row < bestRow))))
		) {
			bestRow = row;
			bestLongitudinalDistance = longitudinalDistance;
			bestLateralDistance = lateralDistance;
		}
	}
	return bestRow;
}

export const findPortRowDragTarget = findOhbRowDragTarget;

/** Select one uninterrupted cardinal slot row; unavailable stations are explicit skipped rows. */
export function selectOhbRowDrag(
	slots: CompiledPortSlots,
	availability: PortSlotAvailabilityIndex,
	anchorRow: number,
	targetRow: number,
	candidateRows: readonly number[],
): OhbRowDragSelection {
	if (slots.portType !== "OHB" || availability.portType !== "OHB") {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"OHB 행 드래그에는 OHB 슬롯이 필요합니다",
		);
	}
	if (slots.revision !== availability.revision) {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"현재 레일 세대와 OHB 슬롯 세대가 다릅니다",
		);
	}
	if (!isSlotRow(slots, anchorRow) || !isSlotRow(slots, targetRow)) {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"OHB 행 드래그 슬롯이 현재 버퍼 범위를 벗어났습니다",
		);
	}
	const anchorAvailability = availability.statusFor(slots, anchorRow);
	if (anchorAvailability.status !== PORT_SLOT_STATUS.LEGAL) {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			anchorAvailability.status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT
				? `OHB 행 시작점이 STK-${anchorAvailability.conflictingEquipmentGroupId} 점유 구간과 겹칩니다`
				: "행 드래그는 배치 가능한 OHB 슬롯에서 시작해야 합니다",
			anchorAvailability.status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT &&
				anchorAvailability.conflictingEquipmentGroupId > 0
				? [anchorAvailability.conflictingEquipmentGroupId]
				: [],
		);
	}
	if ((slots.sides[anchorRow] as number) !== (slots.sides[targetRow] as number)) {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"같은 레일 측면의 OHB 슬롯으로 드래그하세요",
		);
	}
	if (
		(slots.routeFromDirections[anchorRow] as number) !==
			(slots.routeFromDirections[targetRow] as number) ||
		(slots.routeToDirections[anchorRow] as number) !==
			(slots.routeToDirections[targetRow] as number)
	) {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"같은 진행 방향의 직선 레일 행으로 드래그하세요",
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
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"평행하거나 떨어진 레일은 하나의 OHB 행으로 묶을 수 없습니다",
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
			return createInvalidOhbRowDragSelection(
				anchorRow,
				targetRow,
				"OHB 행에 중복된 레일 슬롯이 있습니다",
			);
		}
		matchingRows.set(key, row);
	}

	const rows: number[] = [];
	const skippedRows: number[] = [];
	const conflictingEquipmentGroupIds = new Set<number>();
	const stepSign = longitudinal < 0 ? -1 : 1;
	for (let step = 0; step <= Math.abs(longitudinal); step++) {
		const x = anchorX + travel.x * step * stepSign;
		const z = anchorZ + travel.y * step * stepSign;
		const row = matchingRows.get(routeCellKey(x, z));
		if (row === undefined) {
			return createInvalidOhbRowDragSelection(
				anchorRow,
				targetRow,
				"커브, 분기, 끝점 또는 빈 구간을 가로질러 OHB 행을 만들 수 없습니다",
			);
		}
		const result = availability.statusFor(slots, row);
		if (result.status === PORT_SLOT_STATUS.LEGAL) rows.push(row);
		else {
			skippedRows.push(row);
			if (
				result.status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT &&
				result.conflictingEquipmentGroupId > 0
			) {
				conflictingEquipmentGroupIds.add(result.conflictingEquipmentGroupId);
			}
		}
	}

	if (rows.length === 0) {
		return createInvalidOhbRowDragSelection(
			anchorRow,
			targetRow,
			"선택한 OHB 행에 배치 가능한 슬롯이 없습니다",
		);
	}
	const side = PORT_SIDES[slots.sides[anchorRow] as number];
	const conflictIds = [...conflictingEquipmentGroupIds].sort((left, right) => left - right);
	return Object.freeze({
		valid: true,
		reason:
			skippedRows.length === 0
				? `${side} 측면 OHB ${rows.length}개`
				: conflictIds.length > 0
					? `${side} 측면 OHB ${rows.length}개 · STK-${conflictIds.join(", STK-")} 점유 구간의 ${skippedRows.length}개 슬롯 제외`
					: `${side} 측면 OHB ${rows.length}개 · 충돌 ${skippedRows.length}개 제외`,
		anchorRow,
		targetRow,
		rows: Object.freeze(rows),
		skippedRows: Object.freeze(skippedRows),
		conflictingEquipmentGroupIds: Object.freeze(conflictIds),
	});
}

export function createInvalidOhbRowDragSelection(
	anchorRow: number,
	targetRow: number,
	reason: string,
	conflictingEquipmentGroupIds: readonly number[] = [],
): OhbRowDragSelection {
	return Object.freeze({
		valid: false,
		reason,
		anchorRow,
		targetRow,
		rows: Object.freeze([]),
		skippedRows: Object.freeze([]),
		conflictingEquipmentGroupIds: Object.freeze([...conflictingEquipmentGroupIds]),
	});
}

function assertSlotRow(slots: CompiledPortSlots, row: number): void {
	if (!isSlotRow(slots, row)) {
		throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
	}
}

function isSlotRow(slots: CompiledPortSlots, row: number): boolean {
	return Number.isInteger(row) && row >= 0 && row < slots.count;
}

function routeCellKey(x: number, z: number): string {
	return `${x}:${z}`;
}
