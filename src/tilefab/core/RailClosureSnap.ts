import {
	type BendPreference,
	planRailConstruction,
	type RailConstructionPlan,
	type RailMapReader,
} from "./paint";
import type { RailDocument } from "./RailDocument";
import { ALL_DIRECTIONS, bitCount, directionBetween, moveCell } from "./railShape";
import { type Cell, cellKey, decodeRailCell } from "./TileMap";

export const RAIL_CLOSURE_SNAP_RADIUS_METERS = 0.82;

export interface RailClosureSnap {
	readonly cell: Cell;
	readonly distanceMeters: number;
	readonly plan: RailConstructionPlan;
}

/**
 * Magnetize a chained Smart Route to a nearby compatible source terminal.
 * The bounded 3x3 probe stays independent of map size and only accepts a route
 * that passes the same authored topology planner used by commit.
 */
export function resolveRailClosureSnap(
	map: RailMapReader,
	start: Cell,
	pointerWorld: Readonly<{ x: number; y: number }>,
	preference: BendPreference,
	maximumDistanceMeters = RAIL_CLOSURE_SNAP_RADIUS_METERS,
): RailClosureSnap | null {
	if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters <= 0) return null;
	const startRail = map.getRail(start.x, start.y);
	if (bitCount(startRail.incoming) !== 1 || startRail.outgoing !== 0) return null;

	const pointerCell = { x: Math.floor(pointerWorld.x), y: Math.floor(pointerWorld.y) };
	const candidates: RailClosureSnap[] = [];
	for (let y = pointerCell.y - 1; y <= pointerCell.y + 1; y++) {
		for (let x = pointerCell.x - 1; x <= pointerCell.x + 1; x++) {
			if (x === start.x && y === start.y) continue;
			const rail = map.getRail(x, y);
			if (rail.incoming !== 0 || bitCount(rail.outgoing) !== 1) continue;
			const distanceMeters = Math.hypot(x + 0.5 - pointerWorld.x, y + 0.5 - pointerWorld.y);
			if (distanceMeters > maximumDistanceMeters) continue;
			const cell = Object.freeze({ x, y });
			const plan = planRailConstruction(map, start, cell, preference);
			if (!plan.valid) continue;
			candidates.push(Object.freeze({ cell, distanceMeters, plan }));
		}
	}

	candidates.sort(
		(left, right) =>
			left.distanceMeters - right.distanceMeters ||
			left.cell.y - right.cell.y ||
			left.cell.x - right.cell.x,
	);
	return candidates[0] ?? null;
}

export interface OpenRailClosureProposal {
	readonly start: Cell;
	readonly target: Cell | null;
	/** Each bend must pass the ordinary physical evaluator before the caller chooses a preview. */
	readonly candidates: readonly RailConstructionPlan[];
}

/** Trace the selected sink's entire unowned path; never guess another component's source. */
export function proposeOpenRailClosure(
	document: Pick<RailDocument, "map" | "staticFabOrganizationOwnersForCell">,
	selected: Cell,
): OpenRailClosureProposal {
	const map = document.map;
	const start = Object.freeze({ ...selected });
	const reject = (reason: string, conflict: Cell): OpenRailClosureProposal => ({
		start,
		target: null,
		candidates: [
			Object.freeze({
				kind: "build",
				baseRevision: map.getRevision(),
				cells: [start],
				mutations: [],
				valid: false,
				reason,
				issueCode: "topology",
				conflicts: [conflict],
				newEdges: 0,
				lengthMeters: 0,
				turns: 0,
				bend: "horizontal-first",
			}),
		],
	});
	const visited = new Set<string>();
	let cell = start;
	let downstream: Cell | null = null;
	for (;;) {
		const key = cellKey(cell.x, cell.y);
		if (visited.has(key)) return reject("순환·중복 연결이 있어 닫을 수 없습니다", cell);
		visited.add(key);
		if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) {
			return reject("스위치가 포함된 경로입니다 · 계속 건설을 사용하세요", cell);
		}
		if (document.staticFabOrganizationOwnersForCell(cell.x, cell.y).length > 0) {
			return reject("조직에 속한 경로입니다 · 조직 편집을 사용하세요", cell);
		}
		const rail = map.getRail(cell.x, cell.y);
		if (!downstream) {
			if (bitCount(rail.incoming) !== 1 || rail.outgoing !== 0) {
				return reject("진행이 끝나는 열린 끝점을 선택하세요", cell);
			}
		} else if (
			rail.outgoing !== directionBetween(cell, downstream) ||
			bitCount(rail.incoming) > 1
		) {
			return reject("분기·합류 또는 끊긴 연결이 있습니다 · 계속 건설을 사용하세요", cell);
		}
		if (downstream && rail.incoming === 0) break;
		const incoming = ALL_DIRECTIONS.find((direction) => rail.incoming === direction);
		if (!incoming) return reject("단일 방향 경로를 확인할 수 없습니다", cell);
		downstream = cell;
		cell = Object.freeze(moveCell(cell, incoming));
	}
	const target = cell;
	const bends: readonly BendPreference[] =
		start.x === target.x || start.y === target.y
			? ["auto"]
			: ["horizontal-first", "vertical-first"];
	const candidates = bends.map((bend) => {
		const plan = planRailConstruction(map, start, target, bend);
		if (!plan.valid) return plan;
		const occupied = plan.cells
			.slice(1, -1)
			.filter(
				(candidate) =>
					map.hasRail(candidate.x, candidate.y) ||
					map.getAdvancedSwitchOwningCell(candidate.x, candidate.y) ||
					document.staticFabOrganizationOwnersForCell(candidate.x, candidate.y).length > 0,
			);
		if (occupied.length > 0)
			return Object.freeze({
				...plan,
				valid: false,
				reason: "닫는 경로가 기존 레일과 겹칩니다 · 계속 건설로 우회하세요",
				conflicts: occupied,
			});
		// The old interior is 1-in/1-out; every new or changed cell must complete the same cycle.
		const invalid = plan.mutations.filter((mutation) => {
			const rail = decodeRailCell(mutation.after);
			return bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1;
		});
		if (invalid.length > 0)
			return Object.freeze({
				...plan,
				valid: false,
				reason: "하나의 방향 순환로로 닫을 수 없습니다",
				conflicts: invalid,
			});
		return plan;
	});
	return Object.freeze({ start, target, candidates: Object.freeze(candidates) });
}
