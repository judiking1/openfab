import { type Direction, moveCell, oppositeDirection } from "../core/railShape";
import { cellKey } from "../core/TileMap";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";

export interface PhysicalPathAdjacency {
	offsets: Uint32Array;
	targets: Uint32Array;
}

export interface PhysicalPathHit {
	pathIndex: number;
	distanceMeters: number;
	distanceToPathMeters: number;
}

export interface PhysicalFlowTraceEntry {
	pathIndex: number;
	/** Signed distance from the pointer to this path's authored start. */
	pathStartMeters: number;
}

/**
 * A directed TileMap seam can own two turnout routes. The advanced-switch shared support is the
 * only wider compiled case: its throat and two input/output segments make exactly three paths.
 */
export const MAX_CANONICAL_PHYSICAL_PATHS_PER_DIRECTED_SEAM = 3;

export function physicalPathDirectedSeamKey(x: number, y: number, from: number): string {
	return `${cellKey(x, y)}:${from}`;
}

export function assertCanonicalPhysicalPathSeamCardinality(cardinality: number): void {
	if (cardinality > MAX_CANONICAL_PHYSICAL_PATHS_PER_DIRECTED_SEAM) {
		throw new Error(
			`Physical path directed seam exceeds the canonical ${MAX_CANONICAL_PHYSICAL_PATHS_PER_DIRECTED_SEAM}-path capacity.`,
		);
	}
}

/** Directed authored seam check shared by same-layout and speculative cross-layout consumers. */
export function authoredPhysicalPathContinuation(
	fromPaths: CompiledPhysicalPaths,
	fromPathIndex: number,
	toPaths: CompiledPhysicalPaths,
	toPathIndex: number,
): boolean {
	if (
		fromPathIndex < 0 ||
		fromPathIndex >= fromPaths.pathCount ||
		toPathIndex < 0 ||
		toPathIndex >= toPaths.pathCount ||
		(fromPaths.kinds[fromPathIndex] as number) === PATH_KIND.INVALID ||
		(toPaths.kinds[toPathIndex] as number) === PATH_KIND.INVALID
	) {
		return false;
	}
	const to = fromPaths.toDirections[fromPathIndex] as Direction | 0;
	const from = toPaths.fromDirections[toPathIndex] as Direction | 0;
	if (to === 0 || from === 0 || from !== oppositeDirection(to)) return false;
	const fromCellOffset = fromPathIndex * 2;
	const next = moveCell(
		{
			x: fromPaths.exitCells[fromCellOffset] as number,
			y: fromPaths.exitCells[fromCellOffset + 1] as number,
		},
		to,
	);
	const toCellOffset = toPathIndex * 2;
	return (
		next.x === (toPaths.cells[toCellOffset] as number) &&
		next.y === (toPaths.cells[toCellOffset + 1] as number)
	);
}

/** Build directed path-to-path adjacency once for each compiled physical layout. */
export function buildPhysicalPathAdjacency(paths: CompiledPhysicalPaths): PhysicalPathAdjacency {
	const byEntry = new Map<string, number[]>();
	const exitCardinality = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const from = paths.fromDirections[pathIndex] as number;
		const cellOffset = pathIndex * 2;
		if (from !== 0) {
			const key = physicalPathDirectedSeamKey(
				paths.cells[cellOffset] as number,
				paths.cells[cellOffset + 1] as number,
				from,
			);
			const entries = byEntry.get(key);
			assertCanonicalPhysicalPathSeamCardinality((entries?.length ?? 0) + 1);
			if (entries) entries.push(pathIndex);
			else byEntry.set(key, [pathIndex]);
		}
		const to = paths.toDirections[pathIndex] as number;
		if (to !== 0) {
			const next = moveCell(
				{
					x: paths.exitCells[cellOffset] as number,
					y: paths.exitCells[cellOffset + 1] as number,
				},
				to as Direction,
			);
			const key = physicalPathDirectedSeamKey(next.x, next.y, oppositeDirection(to as Direction));
			const cardinality = (exitCardinality.get(key) ?? 0) + 1;
			assertCanonicalPhysicalPathSeamCardinality(cardinality);
			exitCardinality.set(key, cardinality);
		}
	}

	const offsets = new Uint32Array(paths.pathCount + 1);
	const flatTargets: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		offsets[pathIndex] = flatTargets.length;
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const targets = new Set<number>();
		const to = paths.toDirections[pathIndex] as number;
		if (to !== 0) {
			const cellOffset = pathIndex * 2;
			const next = moveCell(
				{
					x: paths.exitCells[cellOffset] as number,
					y: paths.exitCells[cellOffset + 1] as number,
				},
				to as Direction,
			);
			const candidates = byEntry.get(
				physicalPathDirectedSeamKey(next.x, next.y, oppositeDirection(to as Direction)),
			);
			for (const candidate of candidates ?? []) targets.add(candidate);
		}
		const explicitStart = paths.explicitAdjacencyOffsets[pathIndex] as number;
		const explicitEnd = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
		for (let row = explicitStart; row < explicitEnd; row++) {
			const target = paths.explicitAdjacencyTargets[row] as number;
			if (target < paths.pathCount && (paths.kinds[target] as number) !== PATH_KIND.INVALID) {
				targets.add(target);
			}
		}
		flatTargets.push(...[...targets].sort((left, right) => left - right));
	}
	offsets[paths.pathCount] = flatTargets.length;
	return { offsets, targets: new Uint32Array(flatTargets) };
}

/** Reverse one canonical CSR adjacency without rebuilding spatial string-key indexes. */
export function reversePhysicalPathAdjacency(
	forward: PhysicalPathAdjacency,
	pathCount: number,
): PhysicalPathAdjacency {
	const counts = new Uint32Array(pathCount);
	for (const target of forward.targets) {
		if (target < pathCount) counts[target] = (counts[target] as number) + 1;
	}
	const offsets = new Uint32Array(pathCount + 1);
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		offsets[pathIndex + 1] = (offsets[pathIndex] as number) + (counts[pathIndex] as number);
	}
	const targets = new Uint32Array(offsets[pathCount] as number);
	const cursors = offsets.slice(0, pathCount);
	for (let sourcePathIndex = 0; sourcePathIndex < pathCount; sourcePathIndex++) {
		const start = forward.offsets[sourcePathIndex] as number;
		const end = forward.offsets[sourcePathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const targetPathIndex = forward.targets[row] as number;
			if (targetPathIndex >= pathCount) continue;
			const cursor = cursors[targetPathIndex] as number;
			targets[cursor] = sourcePathIndex;
			cursors[targetPathIndex] = cursor + 1;
		}
	}
	return Object.freeze({ offsets, targets });
}

/** Hit-test only the already culled path candidates in one hovered authoring cell. */
export function hitTestPhysicalPaths(
	paths: CompiledPhysicalPaths,
	pathIndices: Iterable<number>,
	world: { x: number; y: number },
	maxDistanceMeters: number,
): PhysicalPathHit | null {
	let best: PhysicalPathHit | null = null;
	let bestSquared = maxDistanceMeters * maxDistanceMeters;
	for (const pathIndex of pathIndices) {
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const start = paths.offsets[pathIndex] as number;
		const end = paths.offsets[pathIndex + 1] as number;
		for (let pointIndex = start; pointIndex < end - 1; pointIndex++) {
			const positionOffset = pointIndex * 2;
			const nextOffset = positionOffset + 2;
			const x0 = paths.positions[positionOffset] as number;
			const y0 = paths.positions[positionOffset + 1] as number;
			const x1 = paths.positions[nextOffset] as number;
			const y1 = paths.positions[nextOffset + 1] as number;
			const dx = x1 - x0;
			const dy = y1 - y0;
			const segmentSquared = dx * dx + dy * dy;
			const amount =
				segmentSquared === 0
					? 0
					: clamp(((world.x - x0) * dx + (world.y - y0) * dy) / segmentSquared, 0, 1);
			const projectionX = x0 + dx * amount;
			const projectionY = y0 + dy * amount;
			const offsetX = world.x - projectionX;
			const offsetY = world.y - projectionY;
			const squared = offsetX * offsetX + offsetY * offsetY;
			if (squared >= bestSquared) continue;
			bestSquared = squared;
			const d0 = paths.distances[pointIndex] as number;
			const d1 = paths.distances[pointIndex + 1] as number;
			best = {
				pathIndex,
				distanceMeters: d0 + (d1 - d0) * amount,
				distanceToPathMeters: Math.sqrt(squared),
			};
		}
	}
	return best;
}

/**
 * Trace the selected physical route downstream by metric distance. At a future branch both legal
 * routes are returned; hovering one route inside a turnout does not highlight its sibling route.
 */
export function tracePhysicalPathFlow(
	paths: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	hit: PhysicalPathHit,
	horizonMeters = 12,
	maxPaths = 64,
): readonly PhysicalFlowTraceEntry[] {
	if (
		hit.pathIndex < 0 ||
		hit.pathIndex >= paths.pathCount ||
		horizonMeters <= 0 ||
		maxPaths <= 0
	) {
		return [];
	}

	const queue: PhysicalFlowTraceEntry[] = [
		{ pathIndex: hit.pathIndex, pathStartMeters: -hit.distanceMeters },
	];
	const bestStart = new Map<number, number>();
	const result: PhysicalFlowTraceEntry[] = [];
	while (queue.length > 0 && result.length < maxPaths) {
		let nearestIndex = 0;
		for (let index = 1; index < queue.length; index++) {
			if (
				(queue[index] as PhysicalFlowTraceEntry).pathStartMeters <
				(queue[nearestIndex] as PhysicalFlowTraceEntry).pathStartMeters
			) {
				nearestIndex = index;
			}
		}
		const current = queue.splice(nearestIndex, 1)[0] as PhysicalFlowTraceEntry;
		const previous = bestStart.get(current.pathIndex);
		if (previous !== undefined && previous <= current.pathStartMeters) continue;
		bestStart.set(current.pathIndex, current.pathStartMeters);
		if (current.pathStartMeters > horizonMeters) continue;
		result.push(current);

		const nextDistance = current.pathStartMeters + (paths.lengths[current.pathIndex] as number);
		if (nextDistance >= horizonMeters) continue;
		const start = adjacency.offsets[current.pathIndex] as number;
		const end = adjacency.offsets[current.pathIndex + 1] as number;
		for (let adjacencyIndex = start; adjacencyIndex < end; adjacencyIndex++) {
			queue.push({
				pathIndex: adjacency.targets[adjacencyIndex] as number,
				pathStartMeters: nextDistance,
			});
		}
	}
	return result;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
