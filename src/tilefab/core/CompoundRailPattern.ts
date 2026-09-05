import { stableSortSteps, synchronousSortSteps } from "./CooperativeSort";
import { completeCooperativeSteps } from "./CooperativeTask";
import { ALL_DIRECTIONS, bitCount, type Direction, moveCell, oppositeDirection } from "./railShape";
import { type Cell, cellKey, type RailCell } from "./TileMap";

export type CompoundSourceType = "LINEAR" | "LEFT_CURVE" | "RIGHT_CURVE";

export interface CompoundRailEntry {
	cell: Cell;
	rail: RailCell;
	type: CompoundSourceType;
}

export type CompoundRailPatternType =
	| "RIGHT_CURVE"
	| "CCW_CURVE"
	| "S_CURVE"
	| "CSC_CURVE_HOMO"
	| "CSC_CURVE_HETE";

export interface CompoundRailPattern {
	type: CompoundRailPatternType;
	cells: readonly Cell[];
	from: Cell;
	to: Cell;
	fromDirection: Direction;
	toDirection: Direction;
	turn: "left" | "right";
}

interface CompoundCandidate extends CompoundRailPattern {
	firstKey: string;
	lastKey: string;
}

/** Recognize the strict curve-pair and curve-straight-curve authored grammar. */
export function collectCompoundRailPatterns(
	index: ReadonlyMap<string, CompoundRailEntry>,
): CompoundRailPattern[] {
	return completeCooperativeSteps(collectCompoundRailPatternSteps(index, false));
}

/** Shared semantic recognition with bounded candidate scans, ordering, and chain traversal. */
export function* collectCompoundRailPatternSteps(
	index: ReadonlyMap<string, CompoundRailEntry>,
	cooperative = true,
): Generator<void, CompoundRailPattern[]> {
	const sort = cooperative ? stableSortSteps : synchronousSortSteps;
	const candidates: CompoundCandidate[] = [];
	for (const entry of index.values()) {
		if (cooperative) yield;
		if (!isCurve(entry.type)) continue;
		const next = connectedSuccessor(index, entry);
		if (!next) continue;
		if (isCurve(next.type)) {
			candidates.push(createCandidate(entry, next, [entry.cell, next.cell], false));
			continue;
		}
		if (next.type !== "LINEAR") continue;
		const last = connectedSuccessor(index, next);
		if (!last || !isCurve(last.type)) continue;
		candidates.push(createCandidate(entry, last, [entry.cell, next.cell, last.cell], true));
	}
	const candidateTailKeys = new Set<string>();
	const candidateByFirstKey = new Map<string, CompoundCandidate>();
	for (const candidate of candidates) {
		candidateTailKeys.add(candidate.lastKey);
		candidateByFirstKey.set(candidate.firstKey, candidate);
		if (cooperative) yield;
	}
	const orderedCandidates: CompoundCandidate[] = [];
	const visitedCandidates = new Set<string>();
	const walkChain = function* (start: CompoundCandidate): Generator<void, void> {
		let current: CompoundCandidate | undefined = start;
		while (current && !visitedCandidates.has(current.firstKey)) {
			visitedCandidates.add(current.firstKey);
			orderedCandidates.push(current);
			current = candidateByFirstKey.get(current.lastKey);
			if (cooperative) yield;
		}
	};
	const compareCandidates = (left: CompoundCandidate, right: CompoundCandidate): number =>
		compareCells(left.from, right.from) || left.type.localeCompare(right.type);
	const roots: CompoundCandidate[] = [];
	for (const candidate of candidates) {
		if (!candidateTailKeys.has(candidate.firstKey)) roots.push(candidate);
		if (cooperative) yield;
	}
	yield* sort(roots, compareCandidates);
	for (const root of roots) {
		yield* walkChain(root);
		if (cooperative) yield;
	}
	yield* sort(candidates, compareCandidates);
	for (const cycleStart of candidates) {
		yield* walkChain(cycleStart);
		if (cooperative) yield;
	}
	const consumed = new Set<string>();
	const patterns: CompoundRailPattern[] = [];
	for (const candidate of orderedCandidates) {
		if (cooperative) yield;
		if (candidate.cells.some((cell) => consumed.has(cellKey(cell.x, cell.y)))) continue;
		for (const cell of candidate.cells) consumed.add(cellKey(cell.x, cell.y));
		patterns.push({
			type: candidate.type,
			cells: candidate.cells,
			from: candidate.from,
			to: candidate.to,
			fromDirection: candidate.fromDirection,
			toDirection: candidate.toDirection,
			turn: candidate.turn,
		});
	}
	return patterns;
}

function createCandidate(
	first: CompoundRailEntry,
	last: CompoundRailEntry,
	cells: readonly Cell[],
	hasMiddleStraight: boolean,
): CompoundCandidate {
	const sameTurn = first.type === last.type;
	const fromSide = singleDirection(first.rail.incoming) as Direction;
	const toDirection = singleDirection(last.rail.outgoing) as Direction;
	return {
		type: hasMiddleStraight
			? sameTurn
				? "CSC_CURVE_HOMO"
				: "CSC_CURVE_HETE"
			: sameTurn
				? "CCW_CURVE"
				: "S_CURVE",
		cells,
		from: first.cell,
		to: last.cell,
		fromDirection: oppositeDirection(fromSide),
		toDirection,
		turn: first.type === "LEFT_CURVE" ? "left" : "right",
		firstKey: cellKey(first.cell.x, first.cell.y),
		lastKey: cellKey(last.cell.x, last.cell.y),
	};
}

function connectedSuccessor(
	index: ReadonlyMap<string, CompoundRailEntry>,
	entry: CompoundRailEntry,
): CompoundRailEntry | null {
	const outgoing = singleDirection(entry.rail.outgoing);
	if (!outgoing) return null;
	const nextCell = moveCell(entry.cell, outgoing);
	const next = index.get(cellKey(nextCell.x, nextCell.y));
	if (!next) return null;
	return next.rail.incoming === oppositeDirection(outgoing) ? next : null;
}

function isCurve(type: CompoundSourceType): type is "LEFT_CURVE" | "RIGHT_CURVE" {
	return type === "LEFT_CURVE" || type === "RIGHT_CURVE";
}

function singleDirection(mask: number): Direction | null {
	if (bitCount(mask) !== 1) return null;
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}
