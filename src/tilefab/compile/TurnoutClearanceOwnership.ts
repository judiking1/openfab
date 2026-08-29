import type { CompiledPhysicalPaths } from "./PhysicalPathCompiler";
import { authoredPhysicalPathContinuation } from "./PhysicalPathFlow";
import type { CompiledJunction } from "./PhysicalRailCompiler";

export interface TurnoutClearancePathInterval {
	readonly pathIndex: number;
	readonly start: number;
	readonly end: number;
}

/**
 * Derive interval-exact clearance ownership for one ordinary three-port turnout.
 * The two synthetic turnout routes own their full geometry; neighboring routes
 * are owned only at the connection station where their envelopes must meet.
 */
export function deriveTurnoutClearancePathIntervals(
	junction: CompiledJunction,
	paths: CompiledPhysicalPaths,
): readonly TurnoutClearancePathInterval[] {
	const intervals: TurnoutClearancePathInterval[] = [];
	appendFullPath(intervals, paths, junction.trunkPathIndex);
	appendFullPath(intervals, paths, junction.divergePathIndex);

	appendConnectedPortInterval(intervals, paths, junction.trunkPathIndex, "incoming");
	appendConnectedPortInterval(intervals, paths, junction.trunkPathIndex, "outgoing");
	appendConnectedPortInterval(
		intervals,
		paths,
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
	corePathIndex: number,
	port: "incoming" | "outgoing",
): void {
	const pathIndex = findConnectedPath(paths, corePathIndex, port);
	if (pathIndex < 0) return;
	const station = port === "outgoing" ? 0 : (paths.lengths[pathIndex] as number);
	target.push(Object.freeze({ pathIndex, start: station, end: station }));
}

function findConnectedPath(
	paths: CompiledPhysicalPaths,
	corePathIndex: number,
	port: "incoming" | "outgoing",
): number {
	if (corePathIndex < 0 || corePathIndex >= paths.pathCount) return -1;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const connected =
			port === "incoming"
				? authoredPhysicalPathContinuation(paths, pathIndex, paths, corePathIndex)
				: authoredPhysicalPathContinuation(paths, corePathIndex, paths, pathIndex);
		if (connected) return pathIndex;
	}
	return -1;
}
