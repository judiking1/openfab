import {
	type BendPreference,
	planRailConstruction,
	type RailConstructionPlan,
	type RailMapReader,
} from "./paint";
import { bitCount } from "./railShape";
import type { Cell } from "./TileMap";

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
