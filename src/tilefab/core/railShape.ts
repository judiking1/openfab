/**
 * railShape — 연결 마스크(N=1,E=2,S=4,W=8) → 타일 모양 파생.
 * auto-tiling의 심장: 코너/분기/합류는 "그리는" 것이 아니라 이웃에서 "생기는" 것.
 */

export const DIR_N = 1;
export const DIR_E = 2;
export const DIR_S = 4;
export const DIR_W = 8;

export type Direction = typeof DIR_N | typeof DIR_E | typeof DIR_S | typeof DIR_W;

export const ALL_DIRECTIONS: readonly Direction[] = [DIR_N, DIR_E, DIR_S, DIR_W];

export function oppositeDirection(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_S;
	if (direction === DIR_E) return DIR_W;
	if (direction === DIR_S) return DIR_N;
	return DIR_E;
}

export function moveCell(
	cell: { x: number; y: number },
	direction: Direction,
): { x: number; y: number } {
	if (direction === DIR_N) return { x: cell.x, y: cell.y - 1 };
	if (direction === DIR_E) return { x: cell.x + 1, y: cell.y };
	if (direction === DIR_S) return { x: cell.x, y: cell.y + 1 };
	return { x: cell.x - 1, y: cell.y };
}

export function directionBetween(
	from: { x: number; y: number },
	to: { x: number; y: number },
): Direction | null {
	if (to.x === from.x && to.y === from.y - 1) return DIR_N;
	if (to.x === from.x + 1 && to.y === from.y) return DIR_E;
	if (to.x === from.x && to.y === from.y + 1) return DIR_S;
	if (to.x === from.x - 1 && to.y === from.y) return DIR_W;
	return null;
}

export const RAIL_SHAPE = {
	Isolated: "isolated",
	EndN: "end-n",
	EndE: "end-e",
	EndS: "end-s",
	EndW: "end-w",
	StraightNS: "straight-ns",
	StraightEW: "straight-ew",
	CornerNE: "corner-ne",
	CornerES: "corner-es",
	CornerSW: "corner-sw",
	CornerWN: "corner-wn",
	TeeN: "tee-n", // N 제외 3방 = 남쪽 변에 붙은 T (개구부가 E,S,W)
	TeeE: "tee-e",
	TeeS: "tee-s",
	TeeW: "tee-w",
	Cross: "cross",
} as const;

export type RailShape = (typeof RAIL_SHAPE)[keyof typeof RAIL_SHAPE];

const SHAPE_BY_MASK: readonly RailShape[] = [
	RAIL_SHAPE.Isolated, // 0
	RAIL_SHAPE.EndN, // 1        N
	RAIL_SHAPE.EndE, // 2        E
	RAIL_SHAPE.CornerNE, // 3    N+E
	RAIL_SHAPE.EndS, // 4        S
	RAIL_SHAPE.StraightNS, // 5  N+S
	RAIL_SHAPE.CornerES, // 6    E+S
	RAIL_SHAPE.TeeW, // 7        N+E+S (W만 빔)
	RAIL_SHAPE.EndW, // 8        W
	RAIL_SHAPE.CornerWN, // 9    N+W
	RAIL_SHAPE.StraightEW, // 10 E+W
	RAIL_SHAPE.TeeS, // 11       N+E+W (S만 빔)
	RAIL_SHAPE.CornerSW, // 12   S+W
	RAIL_SHAPE.TeeE, // 13       N+S+W (E만 빔)
	RAIL_SHAPE.TeeN, // 14       E+S+W (N만 빔)
	RAIL_SHAPE.Cross, // 15
];

export function shapeForMask(mask: number): RailShape {
	return SHAPE_BY_MASK[mask & 15] as RailShape;
}

/** 정확히 직각 2방향(코너)인가 — 렌더가 quarter-arc를 그리는 조건. */
export function isCorner(mask: number): boolean {
	const m = mask & 15;
	return m === 3 || m === 6 || m === 12 || m === 9;
}

/** 마주보는 2방향(직선 관통)인가. */
export function isStraight(mask: number): boolean {
	const m = mask & 15;
	return m === 5 || m === 10;
}

/** 3방향 이상(분기/합류 junction)인가. */
export function isJunction(mask: number): boolean {
	return bitCount(mask & 15) >= 3;
}

/**
 * A physical AMHS turnout always keeps one directed route tangent through the junction.
 * The remaining port may curve away from or into that trunk. A three-way cell without
 * this through route is a head-on T: two vehicles can face each other with no physical
 * switch alignment that preserves one-way travel.
 */
export function hasDirectedThroughRoute(incoming: number, outgoing: number): boolean {
	return findDirectedThroughRoute(incoming, outgoing) !== null;
}

export interface DirectedThroughRoute {
	incoming: Direction;
	outgoing: Direction;
}

export function findDirectedThroughRoute(
	incoming: number,
	outgoing: number,
): DirectedThroughRoute | null {
	for (const incomingSide of ALL_DIRECTIONS) {
		const outgoingSide = oppositeDirection(incomingSide);
		if ((incoming & incomingSide) !== 0 && (outgoing & outgoingSide) !== 0) {
			return { incoming: incomingSide, outgoing: outgoingSide };
		}
	}
	return null;
}

export function isTangentJunction(incoming: number, outgoing: number): boolean {
	const incomingCount = bitCount(incoming);
	const outgoingCount = bitCount(outgoing);
	return (
		(incoming & outgoing) === 0 &&
		bitCount(incoming | outgoing) === 3 &&
		((incomingCount === 1 && outgoingCount === 2) ||
			(incomingCount === 2 && outgoingCount === 1)) &&
		hasDirectedThroughRoute(incoming, outgoing)
	);
}

/** Shared graph-node side where the branch separates or the merge becomes one route. */
export function tangentJunctionSide(incoming: number, outgoing: number): Direction | null {
	if (!isTangentJunction(incoming, outgoing)) return null;
	const singleton = bitCount(incoming) === 1 ? incoming : outgoing;
	return ALL_DIRECTIONS.find((direction) => (singleton & direction) !== 0) ?? null;
}

export function bitCount(mask: number): number {
	let count = 0;
	let m = mask & 15;
	while (m) {
		count += m & 1;
		m >>= 1;
	}
	return count;
}
