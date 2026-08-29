import {
	STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS,
	STK_MAXIMUM_PORT_COUNT,
	type StkEquipmentTemplate,
} from "./EquipmentGroup";
import type { PortDirection, PortSide } from "./PortRecord";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";

export interface StkPortLayoutCandidate {
	readonly id: number;
	readonly x: number;
	readonly z: number;
	readonly from: Direction | 0;
	readonly to: Direction | 0;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
}

export interface StkPortLayoutAnalysis {
	readonly valid: boolean;
	readonly reason: string;
	readonly axis: "X" | "Z" | null;
	readonly orderedIds: readonly number[];
	readonly laneIds: readonly (readonly number[])[];
}

/** Canonical complete-layout grammar shared by planners, project load, and the Worker mirror. */
export function analyzeStkPortLayout(
	candidates: readonly StkPortLayoutCandidate[],
	template: StkEquipmentTemplate,
): StkPortLayoutAnalysis {
	const countError = stkTemplateCountError(template, candidates.length);
	if (countError) return invalid(countError);

	const occupiedCells = new Set<string>();
	const candidateAxes = new Map<number, "X" | "Z">();
	let equipmentDirection: PortDirection | null = null;
	for (const candidate of candidates) {
		if (candidate.side !== "CENTER" || candidate.lateralOffsetMillimeters !== 0) {
			return invalid(`STK port ${candidate.id} must be a zero-offset CENTER port`);
		}
		if (equipmentDirection !== null && candidate.direction !== equipmentDirection) {
			return invalid("Every STK port must preserve one equipment-facing direction");
		}
		equipmentDirection = candidate.direction;
		if (
			candidate.from === 0 ||
			candidate.to === 0 ||
			candidate.to !== oppositeDirection(candidate.from)
		) {
			return invalid(`STK port ${candidate.id} must attach to a straight cardinal through route`);
		}
		const candidateAxis = cardinalAxis(candidate.to);
		if (!candidateAxis) return invalid(`STK port ${candidate.id} has an invalid travel direction`);
		candidateAxes.set(candidate.id, candidateAxis);
		const cell = `${candidate.x}:${candidate.z}`;
		if (occupiedCells.has(cell)) return invalid(`STK port cell ${cell} is repeated`);
		occupiedCells.add(cell);
	}

	if (template === "FLEX") {
		return analyzeFlexiblePortSet(candidates, candidateAxes);
	}

	let axis: "X" | "Z" | null = null;
	const lanes = new Map<number, StkPortLayoutCandidate[]>();
	for (const candidate of candidates) {
		const candidateAxis = candidateAxes.get(candidate.id);
		if (!candidateAxis) return invalid(`STK port ${candidate.id} has an invalid travel direction`);
		if (axis !== null && axis !== candidateAxis) {
			return invalid("STK ports must use one common cardinal rail axis");
		}
		axis = candidateAxis;
		const cross = crossCoordinate(candidate, candidateAxis);
		const lane = lanes.get(cross);
		if (lane) lane.push(candidate);
		else lanes.set(cross, [candidate]);
	}
	if (!axis) return invalid("STK equipment must own at least one port");

	const freeform = template === "CUSTOM";
	const expectedLaneCount = template === "BACK_TO_BACK" ? 2 : 1;
	if (!freeform && lanes.size !== expectedLaneCount) {
		return invalid(
			template === "BACK_TO_BACK"
				? "Back-to-back STK equipment requires exactly two parallel rail lanes"
				: `${templateLabel(template)} STK equipment requires one directed rail lane`,
		);
	}
	if (freeform && lanes.size > 2) {
		return invalid(
			`${templateLabel(template)} STK equipment can span at most two parallel rail lanes`,
		);
	}

	const orderedLanes = [...lanes.entries()].sort((left, right) => left[0] - right[0]);
	const laneIds: number[][] = [];
	const longitudinalSets: number[][] = [];
	for (const [, lane] of orderedLanes) {
		const first = lane[0] as StkPortLayoutCandidate;
		if (lane.some((candidate) => candidate.from !== first.from || candidate.to !== first.to)) {
			return invalid("Every STK lane must preserve one directed travel orientation");
		}
		if (first.from === 0 || first.to === 0) {
			return invalid(`STK port ${first.id} must attach to a straight cardinal through route`);
		}
		const travel = moveCell({ x: 0, y: 0 }, first.to);
		lane.sort(
			(left, right) =>
				left.x * travel.x + left.z * travel.y - (right.x * travel.x + right.z * travel.y) ||
				left.id - right.id,
		);
		if (!freeform) {
			for (let index = 1; index < lane.length; index++) {
				const previous = lane[index - 1] as StkPortLayoutCandidate;
				const current = lane[index] as StkPortLayoutCandidate;
				if (current.x !== previous.x + travel.x || current.z !== previous.z + travel.y) {
					return invalid("Template STK ports must occupy consecutive 1 m rail cells");
				}
			}
		}
		laneIds.push(lane.map((candidate) => candidate.id));
		longitudinalSets.push(
			lane
				.map((candidate) => longitudinalCoordinate(candidate, axis as "X" | "Z"))
				.sort((left, right) => left - right),
		);
	}
	if (orderedLanes.length === 2) {
		const separation = Math.abs(orderedLanes[1][0] - orderedLanes[0][0]);
		if (separation < 1 || separation > STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS) {
			return invalid(
				`Parallel STK lanes must be 1-${STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS} m apart`,
			);
		}
	}
	if (template === "BACK_TO_BACK") {
		const firstLane = orderedLanes[0]?.[1][0];
		const secondLane = orderedLanes[1]?.[1][0];
		if (
			!firstLane ||
			!secondLane ||
			firstLane.from === 0 ||
			firstLane.to === 0 ||
			secondLane.from === 0 ||
			secondLane.to === 0 ||
			secondLane.from !== oppositeDirection(firstLane.from) ||
			secondLane.to !== oppositeDirection(firstLane.to)
		) {
			return invalid("Back-to-back STK lanes must use opposite travel directions");
		}
	}
	if (template === "BACK_TO_BACK") {
		const first = longitudinalSets[0] as number[];
		const second = longitudinalSets[1] as number[];
		if (first.length !== second.length || first.some((value, index) => value !== second[index])) {
			return invalid("Back-to-back STK lanes must have aligned, paired port stations");
		}
	}

	return Object.freeze({
		valid: true,
		reason: `${templateLabel(template)} · ${candidates.length} PORT`,
		axis,
		orderedIds: Object.freeze(laneIds.flat()),
		laneIds: Object.freeze(laneIds.map((ids) => Object.freeze(ids))),
	});
}

/** FLEX is a user-authored port set. Lane runs are derived only for stable ordering and display. */
function analyzeFlexiblePortSet(
	candidates: readonly StkPortLayoutCandidate[],
	candidateAxes: ReadonlyMap<number, "X" | "Z">,
): StkPortLayoutAnalysis {
	interface Lane {
		readonly axis: "X" | "Z";
		readonly cross: number;
		readonly from: Direction;
		readonly to: Direction;
		readonly candidates: StkPortLayoutCandidate[];
	}

	const lanes = new Map<string, Lane>();
	let commonAxis: "X" | "Z" | null = null;
	let mixedAxes = false;
	for (const candidate of candidates) {
		const axis = candidateAxes.get(candidate.id);
		if (!axis || candidate.from === 0 || candidate.to === 0) {
			return invalid(`STK port ${candidate.id} has an invalid travel direction`);
		}
		if (commonAxis === null) commonAxis = axis;
		else if (commonAxis !== axis) mixedAxes = true;
		const cross = crossCoordinate(candidate, axis);
		const key = `${axis}:${cross}:${candidate.from}:${candidate.to}`;
		const lane = lanes.get(key);
		if (lane) lane.candidates.push(candidate);
		else
			lanes.set(key, {
				axis,
				cross,
				from: candidate.from,
				to: candidate.to,
				candidates: [candidate],
			});
	}

	const orderedLanes = [...lanes.values()].sort(
		(left, right) =>
			(left.axis === right.axis ? 0 : left.axis === "X" ? -1 : 1) ||
			left.cross - right.cross ||
			left.from - right.from ||
			left.to - right.to,
	);
	const laneIds = orderedLanes.map((lane) => {
		const travel = moveCell({ x: 0, y: 0 }, lane.to);
		lane.candidates.sort(
			(left, right) =>
				left.x * travel.x + left.z * travel.y - (right.x * travel.x + right.z * travel.y) ||
				left.id - right.id,
		);
		return Object.freeze(lane.candidates.map((candidate) => candidate.id));
	});
	return Object.freeze({
		valid: true,
		reason: `FLEX · ${candidates.length} PORT`,
		axis: mixedAxes ? null : commonAxis,
		orderedIds: Object.freeze(laneIds.flat()),
		laneIds: Object.freeze(laneIds),
	});
}

export function stkTemplateCountError(
	template: StkEquipmentTemplate,
	count: number,
): string | null {
	if (!Number.isSafeInteger(count) || count < 1) return "STK equipment must own at least one port";
	if (count > STK_MAXIMUM_PORT_COUNT) {
		return `STK equipment cannot own more than ${STK_MAXIMUM_PORT_COUNT} ports`;
	}
	if (template === "FOUR_PORT" && count !== 4) return "Four-port STK requires exactly four ports";
	if (template === "SIX_PORT" && count !== 6) return "Six-port STK requires exactly six ports";
	if (template === "BACK_TO_BACK" && (count < 4 || count % 2 !== 0)) {
		return "Back-to-back STK requires an even port count of at least four";
	}
	return null;
}

function cardinalAxis(direction: Direction): "X" | "Z" | null {
	if (direction === DIR_E || direction === DIR_W) return "X";
	if (direction === DIR_N || direction === DIR_S) return "Z";
	return null;
}

function crossCoordinate(candidate: StkPortLayoutCandidate, axis: "X" | "Z"): number {
	return axis === "X" ? candidate.z : candidate.x;
}

function longitudinalCoordinate(candidate: StkPortLayoutCandidate, axis: "X" | "Z"): number {
	return axis === "X" ? candidate.x : candidate.z;
}

function templateLabel(template: StkEquipmentTemplate): string {
	return template.replaceAll("_", " ");
}

function invalid(reason: string): StkPortLayoutAnalysis {
	return Object.freeze({
		valid: false,
		reason,
		axis: null,
		orderedIds: Object.freeze([]),
		laneIds: Object.freeze([]),
	});
}
