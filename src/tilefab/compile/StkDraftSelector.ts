import {
	STK_AUTHORING_TEMPLATES,
	STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS,
	STK_MAXIMUM_PORT_COUNT,
	type StkAuthoringTemplate,
} from "../core/EquipmentGroup";
import { PORT_SIDES } from "../core/PortRecord";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import { analyzeStkPortLayout } from "../core/StkPortLayout";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
	type PortSlotBounds,
} from "./PortSlotCompiler";

export type StkDraftSlotQuery = (bounds: PortSlotBounds, target: number[]) => number[];

export type { StkAuthoringTemplate } from "../core/EquipmentGroup";
export { STK_AUTHORING_TEMPLATES } from "../core/EquipmentGroup";

export interface StkDraftSelection {
	readonly valid: boolean;
	readonly canComplete: boolean;
	readonly reason: string;
	readonly template: StkAuthoringTemplate;
	readonly rows: readonly number[];
	readonly orderedRows: readonly number[];
	readonly laneRows: readonly (readonly number[])[];
	readonly rejectedRow: number | null;
	readonly laneCount: number;
}

/** Evaluate an accepted click set without mutating authored equipment. */
export function evaluateStkDraftSelection(
	slots: CompiledPortSlots,
	availability: PortSlotAvailabilityIndex,
	rows: readonly number[],
	template: StkAuthoringTemplate,
	slotQuery?: StkDraftSlotQuery | null,
	ignoredEquipmentGroupId = 0,
): StkDraftSelection {
	if (slots.portType !== "STK" || availability.portType !== "STK") {
		return invalid(template, rows, "STK 드래프트에는 STK 슬롯이 필요합니다");
	}
	if (slots.revision !== availability.revision) {
		return invalid(template, rows, "현재 레일 세대와 STK 슬롯 세대가 다릅니다");
	}
	if (!STK_AUTHORING_TEMPLATES.includes(template)) {
		return invalid(template, rows, "지원하지 않는 STK 템플릿입니다");
	}
	if (rows.length === 0) {
		return ready(template, rows, false, templateInstruction(template), [], []);
	}
	if (rows.length > STK_MAXIMUM_PORT_COUNT) {
		return invalid(template, rows, `STK 한 그룹은 최대 ${STK_MAXIMUM_PORT_COUNT}개 포트입니다`);
	}

	const uniqueRows = new Set<number>();
	let axis: "X" | "Z" | null = null;
	const laneDirections = new Map<number, { readonly from: Direction; readonly to: Direction }>();
	const lanes = new Set<number>();
	for (const row of rows) {
		if (!isSlotRow(slots, row))
			return invalid(template, rows, "STK 슬롯이 현재 버퍼를 벗어났습니다");
		if (uniqueRows.has(row))
			return invalid(template, rows, "같은 STK 슬롯을 두 번 선택할 수 없습니다");
		uniqueRows.add(row);
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			return invalid(
				template,
				rows,
				"커브·분기·끝점·간격 제한 구간은 STK 포트로 선택할 수 없습니다",
			);
		}
		const slotAvailability =
			ignoredEquipmentGroupId > 0
				? availability.statusForEquipmentGroup(slots, row, ignoredEquipmentGroupId)
				: availability.statusFor(slots, row);
		if (slotAvailability.status !== PORT_SLOT_STATUS.LEGAL) {
			const reason =
				slotAvailability.status === PORT_SLOT_STATUS.PORT_OCCUPIED
					? `이미 Port #${slotAvailability.conflictingPortId}이 이 슬롯을 사용하고 있습니다`
					: slotAvailability.status === PORT_SLOT_STATUS.PORT_CLEARANCE_CONFLICT
						? `기존 포트 ${slotAvailability.conflictingPortId}와의 최소 간격이 부족합니다`
						: slotAvailability.status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT
							? `STK-${slotAvailability.conflictingEquipmentGroupId}이 점유한 레일 구간입니다`
							: "현재 사용할 수 없는 STK 슬롯입니다";
			return invalid(template, rows, reason);
		}
		if (
			PORT_SIDES[slots.sides[row] as number] !== "CENTER" ||
			(slots.lateralOffsetMillimeters[row] as number) !== 0
		) {
			return invalid(template, rows, "STK는 zero-offset CENTER 슬롯만 사용할 수 있습니다");
		}
		const from = slots.routeFromDirections[row] as Direction | 0;
		const to = slots.routeToDirections[row] as Direction | 0;
		if (from === 0 || to === 0 || oppositeDirection(from) !== to) {
			return invalid(template, rows, "STK 포트는 직선 cardinal 레일에만 배치할 수 있습니다");
		}
		const rowAxis = to === DIR_E || to === DIR_W ? "X" : to === DIR_N || to === DIR_S ? "Z" : null;
		if (!rowAxis) {
			return invalid(template, rows, "STK 포트는 직선 cardinal 레일에만 배치할 수 있습니다");
		}
		if (template !== "FLEX" && axis !== null && axis !== rowAxis) {
			return invalid(template, rows, "STK 포트는 하나의 공통 레일 축을 사용해야 합니다");
		}
		if (axis === null) axis = rowAxis;
		const cross = rowAxis === "X" ? (slots.routeZs[row] as number) : (slots.routeXs[row] as number);
		const laneDirection = laneDirections.get(cross);
		if (
			template !== "FLEX" &&
			laneDirection &&
			(laneDirection.from !== from || laneDirection.to !== to)
		) {
			return invalid(template, rows, "한 STK 레일 행의 진행 방향이 서로 다릅니다");
		}
		if (template !== "FLEX") {
			laneDirections.set(cross, { from, to });
			lanes.add(cross);
		}
	}
	const conflictingEquipmentGroupId = availability.conflictingEquipmentGroupForStkRows(
		slots,
		rows,
		ignoredEquipmentGroupId,
	);
	if (conflictingEquipmentGroupId !== 0) {
		return invalid(
			template,
			rows,
			`선택한 Port 사이가 기존 장비 그룹 #${conflictingEquipmentGroupId}의 Port 구간을 가로지릅니다`,
		);
	}

	const maximumLaneCount = template === "BACK_TO_BACK" ? 2 : 1;
	if (lanes.size > maximumLaneCount) {
		return invalid(
			template,
			rows,
			template === "BACK_TO_BACK"
				? "STK 한 그룹은 최대 두 개의 평행 레일 행을 사용할 수 있습니다"
				: "4/6포트 STK는 하나의 직선 레일 행에서 선택해야 합니다",
		);
	}
	if (lanes.size === 2) {
		const cross = [...lanes].sort((left, right) => left - right);
		if (
			(cross[1] as number) - (cross[0] as number) >
			STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS
		) {
			return invalid(
				template,
				rows,
				`Back-to-back 레일 간격은 최대 ${STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS} m입니다`,
			);
		}
		if (template === "BACK_TO_BACK") {
			const firstDirection = laneDirections.get(cross[0] as number);
			const secondDirection = laneDirections.get(cross[1] as number);
			if (
				!firstDirection ||
				!secondDirection ||
				secondDirection.from !== oppositeDirection(firstDirection.from) ||
				secondDirection.to !== oppositeDirection(firstDirection.to)
			) {
				return invalid(template, rows, "Back-to-back STK 레일은 서로 반대 방향이어야 합니다");
			}
		}
	}
	const requiredCount = template === "FOUR_PORT" ? 4 : template === "SIX_PORT" ? 6 : null;
	if (requiredCount !== null && rows.length > requiredCount) {
		return invalid(template, rows, `${requiredCount}포트 템플릿의 선택 개수를 초과했습니다`);
	}

	const analysis = analyzeStkPortLayout(
		rows.map((row) => ({
			id: row,
			x: slots.routeXs[row] as number,
			z: slots.routeZs[row] as number,
			from: slots.routeFromDirections[row] as Direction,
			to: slots.routeToDirections[row] as Direction,
			side: PORT_SIDES[slots.sides[row] as number] as "CENTER",
			lateralOffsetMillimeters: slots.lateralOffsetMillimeters[row] as number,
			direction: "WITH_TRAVEL" as const,
		})),
		template,
	);
	const partialLaneRows = derivePartialStkLaneRows(slots, rows, slotQuery);
	if (analysis.valid) {
		return ready(
			template,
			rows,
			true,
			analysis.reason,
			analysis.orderedIds,
			template === "FLEX" ? partialLaneRows : analysis.laneIds,
		);
	}
	return ready(
		template,
		rows,
		false,
		incompleteReason(template, rows.length, analysis.reason),
		partialLaneRows.flat(),
		partialLaneRows,
	);
}

/** Toggle one station; an invalid addition is rejected while the accepted draft remains intact. */
export function toggleStkDraftRow(
	slots: CompiledPortSlots,
	availability: PortSlotAvailabilityIndex,
	currentRows: readonly number[],
	row: number,
	template: StkAuthoringTemplate,
	slotQuery?: StkDraftSlotQuery | null,
	ignoredEquipmentGroupId = 0,
): StkDraftSelection {
	const existing = currentRows.indexOf(row);
	if (existing >= 0) {
		return evaluateStkDraftSelection(
			slots,
			availability,
			currentRows.filter((_, index) => index !== existing),
			template,
			slotQuery,
			ignoredEquipmentGroupId,
		);
	}
	const proposed = evaluateStkDraftSelection(
		slots,
		availability,
		[...currentRows, row],
		template,
		slotQuery,
		ignoredEquipmentGroupId,
	);
	if (proposed.valid) return proposed;
	const retained = evaluateStkDraftSelection(
		slots,
		availability,
		currentRows,
		template,
		slotQuery,
		ignoredEquipmentGroupId,
	);
	return Object.freeze({
		...retained,
		reason: proposed.reason,
		rejectedRow: row,
	});
}

function derivePartialStkLaneRows(
	slots: CompiledPortSlots,
	rows: readonly number[],
	slotQuery?: StkDraftSlotQuery | null,
): readonly (readonly number[])[] {
	const lanes = new Map<string, number[]>();
	for (const row of rows) {
		const to = slots.routeToDirections[row] as Direction;
		const axis = to === DIR_E || to === DIR_W ? "X" : "Z";
		const cross = axis === "X" ? (slots.routeZs[row] as number) : (slots.routeXs[row] as number);
		const key = `${axis}:${cross}:${slots.routeFromDirections[row]}:${to}`;
		const lane = lanes.get(key);
		if (lane) lane.push(row);
		else lanes.set(key, [row]);
	}
	return [...lanes.entries()]
		.sort((left, right) => left[0].localeCompare(right[0]))
		.flatMap(([, lane]) => {
			const firstRow = lane[0] as number;
			const travel = moveCell({ x: 0, y: 0 }, slots.routeToDirections[firstRow] as Direction);
			lane.sort(
				(left, right) =>
					(slots.routeXs[left] as number) * travel.x +
						(slots.routeZs[left] as number) * travel.y -
						((slots.routeXs[right] as number) * travel.x +
							(slots.routeZs[right] as number) * travel.y) || left - right,
			);
			const connectedRuns: number[][] = [];
			let currentRun: number[] = [];
			for (const row of lane) {
				const previous = currentRun.at(-1);
				if (
					previous !== undefined &&
					!stkRowsShareConnectedStraightRun(slots, previous, row, slotQuery)
				) {
					connectedRuns.push(currentRun);
					currentRun = [];
				}
				currentRun.push(row);
			}
			if (currentRun.length > 0) connectedRuns.push(currentRun);
			return connectedRuns;
		});
}

function stkRowsShareConnectedStraightRun(
	slots: CompiledPortSlots,
	startRow: number,
	endRow: number,
	slotQuery?: StkDraftSlotQuery | null,
): boolean {
	const from = slots.routeFromDirections[startRow] as Direction;
	const to = slots.routeToDirections[startRow] as Direction;
	if (
		(slots.routeFromDirections[endRow] as number) !== from ||
		(slots.routeToDirections[endRow] as number) !== to ||
		(slots.sides[endRow] as number) !== (slots.sides[startRow] as number)
	) {
		return false;
	}
	const travel = moveCell({ x: 0, y: 0 }, to);
	const deltaX = (slots.routeXs[endRow] as number) - (slots.routeXs[startRow] as number);
	const deltaZ = (slots.routeZs[endRow] as number) - (slots.routeZs[startRow] as number);
	const distance = deltaX * travel.x + deltaZ * travel.y;
	if (distance < 0 || deltaX * -travel.y + deltaZ * travel.x !== 0) return false;
	if (distance <= 1 || !slotQuery) return true;

	const startX = slots.worldPositions[startRow * 2] as number;
	const startZ = slots.worldPositions[startRow * 2 + 1] as number;
	const endX = slots.worldPositions[endRow * 2] as number;
	const endZ = slots.worldPositions[endRow * 2 + 1] as number;
	const candidateRows = slotQuery(
		{
			minX: Math.min(startX, endX) - 0.25,
			minZ: Math.min(startZ, endZ) - 0.25,
			maxX: Math.max(startX, endX) + 0.25,
			maxZ: Math.max(startZ, endZ) + 0.25,
		},
		[],
	);
	const routeCells = new Set<string>();
	for (const row of candidateRows) {
		if (
			!isSlotRow(slots, row) ||
			(slots.routeFromDirections[row] as number) !== from ||
			(slots.routeToDirections[row] as number) !== to ||
			(slots.sides[row] as number) !== (slots.sides[startRow] as number)
		) {
			continue;
		}
		routeCells.add(`${slots.routeXs[row]}:${slots.routeZs[row]}`);
	}
	const routeStartX = slots.routeXs[startRow] as number;
	const routeStartZ = slots.routeZs[startRow] as number;
	for (let offset = 0; offset <= distance; offset++) {
		if (!routeCells.has(`${routeStartX + travel.x * offset}:${routeStartZ + travel.y * offset}`)) {
			return false;
		}
	}
	return true;
}

function incompleteReason(
	template: StkAuthoringTemplate,
	count: number,
	analysisReason: string,
): string {
	if (template === "FOUR_PORT" && count < 4) return `4 PORT · ${count}/4 선택`;
	if (template === "SIX_PORT" && count < 6) return `6 PORT · ${count}/6 선택`;
	if (template === "BACK_TO_BACK" && count < 4) return `BACK TO BACK · ${count}/4 이상 선택`;
	if (template === "BACK_TO_BACK" && count % 2 !== 0)
		return "반대편 레일의 짝 포트를 하나 더 선택하세요";
	return analysisReason;
}

function templateInstruction(template: StkAuthoringTemplate): string {
	if (template === "FLEX") return "서로 다른 레일과 Bay의 원하는 포트를 선택한 뒤 COMPLETE하세요";
	if (template === "FOUR_PORT") return "한 직선 레일 행에서 연속 포트 4개를 선택하세요";
	if (template === "SIX_PORT") return "한 직선 레일 행에서 연속 포트 6개를 선택하세요";
	return "평행한 두 레일 행에서 서로 정렬된 포트를 짝으로 선택하세요";
}

function ready(
	template: StkAuthoringTemplate,
	rows: readonly number[],
	canComplete: boolean,
	reason: string,
	orderedRows: readonly number[],
	laneRows: readonly (readonly number[])[],
): StkDraftSelection {
	return Object.freeze({
		valid: true,
		canComplete,
		reason,
		template,
		rows: Object.freeze([...rows]),
		orderedRows: Object.freeze([...orderedRows]),
		laneRows: Object.freeze(laneRows.map((lane) => Object.freeze([...lane]))),
		rejectedRow: null,
		laneCount: laneRows.length,
	});
}

function invalid(
	template: StkAuthoringTemplate,
	rows: readonly number[],
	reason: string,
): StkDraftSelection {
	return Object.freeze({
		valid: false,
		canComplete: false,
		reason,
		template,
		rows: Object.freeze([...rows]),
		orderedRows: Object.freeze([]),
		laneRows: Object.freeze([]),
		rejectedRow: null,
		laneCount: 0,
	});
}

function isSlotRow(slots: CompiledPortSlots, row: number): boolean {
	return Number.isInteger(row) && row >= 0 && row < slots.count;
}
