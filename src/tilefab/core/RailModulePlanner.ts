import { planRailPath, type RailConstructionPlan, type RailMapReader } from "./paint";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

export type RailModuleKind = "u-turn" | "shift";
export type RailModuleSpan = "compact" | "wide";
export type RailModuleSide = "left" | "right";

export interface RailModulePlan extends RailConstructionPlan {
	moduleKind: RailModuleKind;
	span: RailModuleSpan;
	side: RailModuleSide;
	entry: Cell;
	exit: Cell;
}

/**
 * Place a fixed two-curve grammar from a one-way end terminal. The pointer only
 * chooses left/right; dimensions remain exact and grid-owned.
 */
export function planRailModule(
	map: RailMapReader,
	anchor: Cell,
	pointer: Cell,
	moduleKind: RailModuleKind,
	span: RailModuleSpan,
	preferredSide: RailModuleSide | null = null,
	explicitSide: RailModuleSide | null = null,
): RailModulePlan {
	const forward = terminalForwardDirection(map, anchor);
	const side =
		(explicitSide ? sideChoice(forward ?? DIR_E, explicitSide) : null) ??
		chooseSide(anchor, pointer, forward ?? DIR_E) ??
		(preferredSide ? sideChoice(forward ?? DIR_E, preferredSide) : null);
	if (!forward) {
		return invalidModulePlan(
			map,
			anchor,
			moduleKind,
			span,
			side?.side ?? "right",
			"진행 방향의 열린 끝점에서만 모듈을 건설할 수 있습니다",
		);
	}
	if (!side) {
		return invalidModulePlan(
			map,
			anchor,
			moduleKind,
			span,
			"right",
			"끝점의 왼쪽 또는 오른쪽으로 포인터를 이동해 방향을 선택하세요",
		);
	}

	const cells = moduleCells(anchor, forward, side.direction, moduleKind, span);
	const construction = planRailPath(map, cells);
	return {
		...construction,
		moduleKind,
		span,
		side: side.side,
		entry: anchor,
		exit: cells.at(-1) as Cell,
	};
}

export function terminalForwardDirection(map: RailMapReader, anchor: Cell): Direction | null {
	const rail = map.getRail(anchor.x, anchor.y);
	if (bitCount(rail.incoming) !== 1 || rail.outgoing !== 0) return null;
	const incoming = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
	return incoming ? oppositeDirection(incoming) : null;
}

export function moduleCells(
	anchor: Cell,
	forward: Direction,
	side: Direction,
	moduleKind: RailModuleKind,
	span: RailModuleSpan,
): Cell[] {
	const firstCurve = moveCell(anchor, forward);
	const middle = moveCell(firstCurve, side);
	const secondCurve = span === "wide" ? moveCell(middle, side) : middle;
	const exitDirection = moduleKind === "u-turn" ? oppositeDirection(forward) : forward;
	return [
		anchor,
		firstCurve,
		...(span === "wide" ? [middle] : []),
		secondCurve,
		moveCell(secondCurve, exitDirection),
	];
}

function chooseSide(
	anchor: Cell,
	pointer: Cell,
	forward: Direction,
): { side: RailModuleSide; direction: Direction } | null {
	const left = leftDirection(forward);
	const leftVector = directionVector(left);
	const lateralProjection =
		(pointer.x - anchor.x) * leftVector.x + (pointer.y - anchor.y) * leftVector.y;
	if (lateralProjection === 0) return null;
	return lateralProjection > 0
		? { side: "left", direction: left }
		: { side: "right", direction: oppositeDirection(left) };
}

function sideChoice(
	forward: Direction,
	side: RailModuleSide,
): { side: RailModuleSide; direction: Direction } {
	const left = leftDirection(forward);
	return side === "left" ? { side, direction: left } : { side, direction: oppositeDirection(left) };
}

function leftDirection(forward: Direction): Direction {
	if (forward === DIR_N) return DIR_W;
	if (forward === DIR_E) return DIR_N;
	if (forward === DIR_S) return DIR_E;
	return DIR_S;
}

function directionVector(direction: Direction): { x: number; y: number } {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function invalidModulePlan(
	map: RailMapReader,
	anchor: Cell,
	moduleKind: RailModuleKind,
	span: RailModuleSpan,
	side: RailModuleSide,
	reason: string,
): RailModulePlan {
	return {
		kind: "build",
		baseRevision: map.getRevision(),
		cells: [anchor],
		mutations: [],
		valid: false,
		reason,
		conflicts: [anchor],
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		moduleKind,
		span,
		side,
		entry: anchor,
		exit: anchor,
	};
}
