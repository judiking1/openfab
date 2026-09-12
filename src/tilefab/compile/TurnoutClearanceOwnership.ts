import { type Direction, moveCell, oppositeDirection } from "../core/railShape";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import { physicalPathDirectedSeamKey } from "./PhysicalPathFlow";
import type { CompiledJunction } from "./PhysicalRailCompiler";

export interface TurnoutClearancePathInterval {
	readonly pathIndex: number;
	readonly start: number;
	readonly end: number;
}

/** One compilation-owned seam index; explicit switch adjacency is not turnout clearance. */
export class TurnoutClearancePathIndex {
	private readonly paths: CompiledPhysicalPaths;
	private readonly firstEntry = new Map<string, number>();
	private readonly firstExit = new Map<string, number>();

	constructor(paths: CompiledPhysicalPaths) {
		this.paths = paths;
		for (let row = 0; row < paths.pathCount; row++) {
			if (paths.kinds[row] === PATH_KIND.INVALID) continue;
			const from = paths.fromDirections[row] as Direction | 0;
			if (from !== 0) {
				const key = physicalPathDirectedSeamKey(
					paths.cells[row * 2] as number,
					paths.cells[row * 2 + 1] as number,
					from,
				);
				if (!this.firstEntry.has(key)) this.firstEntry.set(key, row);
			}
			const to = paths.toDirections[row] as Direction | 0;
			if (to !== 0) {
				const next = moveCell(
					{ x: paths.exitCells[row * 2] as number, y: paths.exitCells[row * 2 + 1] as number },
					to,
				);
				const key = physicalPathDirectedSeamKey(next.x, next.y, oppositeDirection(to));
				if (!this.firstExit.has(key)) this.firstExit.set(key, row);
			}
		}
	}

	intervalsFor(junction: CompiledJunction): readonly TurnoutClearancePathInterval[] {
		return deriveTurnoutClearancePathIntervals(junction, this.paths, this);
	}

	findConnectedPath(row: number, port: "incoming" | "outgoing"): number {
		const paths = this.paths;
		if (row < 0 || row >= paths.pathCount || paths.kinds[row] === PATH_KIND.INVALID) return -1;
		if (port === "incoming") {
			const from = paths.fromDirections[row] as number;
			if (from === 0) return -1;
			return (
				this.firstExit.get(
					physicalPathDirectedSeamKey(
						paths.cells[row * 2] as number,
						paths.cells[row * 2 + 1] as number,
						from,
					),
				) ?? -1
			);
		}
		const to = paths.toDirections[row] as Direction | 0;
		if (to === 0) return -1;
		const next = moveCell(
			{ x: paths.exitCells[row * 2] as number, y: paths.exitCells[row * 2 + 1] as number },
			to,
		);
		return (
			this.firstEntry.get(physicalPathDirectedSeamKey(next.x, next.y, oppositeDirection(to))) ?? -1
		);
	}
}

/**
 * Derive interval-exact clearance ownership for one ordinary three-port turnout.
 * The two synthetic turnout routes own their full geometry; neighboring routes
 * are owned only at the connection station where their envelopes must meet.
 */
function deriveTurnoutClearancePathIntervals(
	junction: CompiledJunction,
	paths: CompiledPhysicalPaths,
	index: TurnoutClearancePathIndex,
): readonly TurnoutClearancePathInterval[] {
	const intervals: TurnoutClearancePathInterval[] = [];
	appendFullPath(intervals, paths, junction.trunkPathIndex);
	appendFullPath(intervals, paths, junction.divergePathIndex);

	appendConnectedPortInterval(intervals, paths, index, junction.trunkPathIndex, "incoming");
	appendConnectedPortInterval(intervals, paths, index, junction.trunkPathIndex, "outgoing");
	appendConnectedPortInterval(
		intervals,
		paths,
		index,
		junction.divergePathIndex,
		junction.type === "BRANCH" ? "outgoing" : "incoming",
	);

	intervals.sort(
		(left, right) =>
			left.pathIndex - right.pathIndex || left.start - right.start || left.end - right.end,
	);
	return Object.freeze(
		intervals.filter(
			(interval, index) =>
				index === 0 ||
				interval.pathIndex !== intervals[index - 1]?.pathIndex ||
				interval.start !== intervals[index - 1]?.start ||
				interval.end !== intervals[index - 1]?.end,
		),
	);
}

function appendFullPath(
	target: TurnoutClearancePathInterval[],
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	if (pathIndex < 0 || pathIndex >= paths.pathCount) return;
	target.push(Object.freeze({ pathIndex, start: 0, end: paths.lengths[pathIndex] as number }));
}

function appendConnectedPortInterval(
	target: TurnoutClearancePathInterval[],
	paths: CompiledPhysicalPaths,
	index: TurnoutClearancePathIndex,
	corePathIndex: number,
	port: "incoming" | "outgoing",
): void {
	const pathIndex = index.findConnectedPath(corePathIndex, port);
	if (pathIndex < 0) return;
	const station = port === "outgoing" ? 0 : (paths.lengths[pathIndex] as number);
	target.push(Object.freeze({ pathIndex, start: station, end: station }));
}
