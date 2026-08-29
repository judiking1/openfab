import type {
	DirectedRailEdge,
	RailModuleOwnership,
	RailRouteHint,
} from "../core/RailModuleOwnership";
import { type Direction, moveCell } from "../core/railShape";
import { cellKey } from "../core/TileMap";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";

export interface CompiledPhysicalPathSelection {
	readonly count: number;
	readonly pathIndices: Uint32Array;
	readonly startStations: Float32Array;
	readonly endStations: Float32Array;
	readonly totalLengthMeters: number;
}

/** Convert one current-generation physical path into the semantic route hint used by ownership. */
export function railRouteHintForPhysicalPath(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): RailRouteHint | undefined {
	if (pathIndex < 0 || pathIndex >= paths.pathCount) return undefined;
	const incoming = paths.fromDirections[pathIndex] as Direction | 0;
	const outgoing = paths.toDirections[pathIndex] as Direction | 0;
	if (incoming === 0 || outgoing === 0) return undefined;
	const kind = paths.kinds[pathIndex] as number;
	return Object.freeze({
		incoming,
		outgoing,
		role:
			kind === PATH_KIND.TURNOUT_DIVERGE
				? "turnout-diverge"
				: kind === PATH_KIND.TURNOUT_TRUNK || kind === PATH_KIND.LINEAR
					? "through"
					: undefined,
	});
}

/** Reuse a coverage-cell lookup to collect only paths that can belong to one semantic module. */
export function collectPhysicalModulePathCandidates(
	pathIndicesByCell: {
		get(key: string): Iterable<number> | undefined;
	},
	module: RailModuleOwnership,
	visitStamps: Uint32Array,
	visitGeneration: number,
	target: number[],
): readonly number[] {
	target.length = 0;
	for (const cell of module.footprintCells) {
		for (const pathIndex of pathIndicesByCell.get(cellKey(cell.x, cell.y)) ?? []) {
			if (pathIndex < 0 || pathIndex >= visitStamps.length) continue;
			if ((visitStamps[pathIndex] as number) === visitGeneration) continue;
			visitStamps[pathIndex] = visitGeneration;
			target.push(pathIndex);
		}
	}
	target.sort((left, right) => left - right);
	return target;
}

/**
 * Resolve semantic module ownership into exact metric spans of the compiled physical paths.
 * The returned data is presentation-only and never becomes authored map state.
 */
export function compilePhysicalModuleSelection(
	paths: CompiledPhysicalPaths,
	module: RailModuleOwnership,
	candidatePathIndices?: ArrayLike<number>,
): CompiledPhysicalPathSelection {
	if (module.revision !== paths.revision) return emptySelection();
	const footprint = new Set(module.footprintCells.map((cell) => cellKey(cell.x, cell.y)));
	const ownedEdges = new Set(module.eraseEdges.map(directedEdgeKey));
	const indices: number[] = [];
	const starts: number[] = [];
	const ends: number[] = [];
	let totalLengthMeters = 0;

	const candidateCount = candidatePathIndices?.length ?? paths.pathCount;
	for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
		const pathIndex = candidatePathIndices?.[candidateIndex] ?? candidateIndex;
		if (pathIndex < 0 || pathIndex >= paths.pathCount) continue;
		const kind = paths.kinds[pathIndex] as number;
		if (kind === PATH_KIND.INVALID || !pathTouchesFootprint(paths, pathIndex, footprint)) continue;
		const length = paths.lengths[pathIndex] as number;
		if (!(length > 0)) continue;

		if (module.advancedSwitchId !== null) {
			if ((paths.advancedSwitchIds[pathIndex] as number) !== module.advancedSwitchId) continue;
			indices.push(pathIndex);
			starts.push(0);
			ends.push(length);
			totalLengthMeters += length;
			continue;
		}

		if (module.kind === "turnout" && kind !== PATH_KIND.TURNOUT_DIVERGE) continue;
		if (module.kind !== "turnout" && kind === PATH_KIND.TURNOUT_DIVERGE) continue;
		const incomingOwned = pathBoundaryEdgeKey(paths, pathIndex, "incoming");
		const outgoingOwned = pathBoundaryEdgeKey(paths, pathIndex, "outgoing");
		const ownsIncoming = incomingOwned !== null && ownedEdges.has(incomingOwned);
		const ownsOutgoing = outgoingOwned !== null && ownedEdges.has(outgoingOwned);
		if (!ownsIncoming && !ownsOutgoing) continue;

		let start = 0;
		let end = length;
		if (
			module.kind === "straight" &&
			(paths.fromDirections[pathIndex] as number) !== 0 &&
			(paths.toDirections[pathIndex] as number) !== 0 &&
			ownsIncoming !== ownsOutgoing
		) {
			if (ownsIncoming) end = pathCellCenterStation(paths, pathIndex, "incoming");
			else start = pathCellCenterStation(paths, pathIndex, "outgoing");
		}
		indices.push(pathIndex);
		starts.push(start);
		ends.push(end);
		totalLengthMeters += end - start;
	}

	return Object.freeze({
		count: indices.length,
		pathIndices: Uint32Array.from(indices),
		startStations: Float32Array.from(starts),
		endStations: Float32Array.from(ends),
		totalLengthMeters,
	});
}

function pathCellCenterStation(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	boundary: "incoming" | "outgoing",
): number {
	const cellOffset = pathIndex * 2;
	const cells = boundary === "incoming" ? paths.cells : paths.exitCells;
	const targetX = (cells[cellOffset] as number) + 0.5;
	const targetY = (cells[cellOffset + 1] as number) + 0.5;
	const pointStart = paths.offsets[pathIndex] as number;
	const pointEnd = paths.offsets[pathIndex + 1] as number;
	let bestDistanceSquared = Number.POSITIVE_INFINITY;
	let bestStation = (paths.lengths[pathIndex] as number) / 2;

	for (let pointIndex = pointStart; pointIndex < pointEnd - 1; pointIndex++) {
		const pointOffset = pointIndex * 2;
		const nextOffset = pointOffset + 2;
		const x0 = paths.positions[pointOffset] as number;
		const y0 = paths.positions[pointOffset + 1] as number;
		const x1 = paths.positions[nextOffset] as number;
		const y1 = paths.positions[nextOffset + 1] as number;
		const dx = x1 - x0;
		const dy = y1 - y0;
		const segmentLengthSquared = dx * dx + dy * dy;
		const amount =
			segmentLengthSquared <= Number.EPSILON
				? 0
				: Math.max(
						0,
						Math.min(1, ((targetX - x0) * dx + (targetY - y0) * dy) / segmentLengthSquared),
					);
		const projectedX = x0 + dx * amount;
		const projectedY = y0 + dy * amount;
		const distanceSquared =
			(projectedX - targetX) * (projectedX - targetX) +
			(projectedY - targetY) * (projectedY - targetY);
		if (distanceSquared >= bestDistanceSquared) continue;
		bestDistanceSquared = distanceSquared;
		const startStation = paths.distances[pointIndex] as number;
		const endStation = paths.distances[pointIndex + 1] as number;
		bestStation = startStation + (endStation - startStation) * amount;
	}

	return Math.max(0, Math.min(paths.lengths[pathIndex] as number, bestStation));
}

function pathTouchesFootprint(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	footprint: ReadonlySet<string>,
): boolean {
	const start = paths.coverageOffsets[pathIndex] as number;
	const end = paths.coverageOffsets[pathIndex + 1] as number;
	for (let row = start; row < end; row++) {
		if (
			footprint.has(
				cellKey(paths.coverageCells[row * 2] as number, paths.coverageCells[row * 2 + 1] as number),
			)
		) {
			return true;
		}
	}
	return false;
}

function pathBoundaryEdgeKey(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	boundary: "incoming" | "outgoing",
): string | null {
	const offset = pathIndex * 2;
	if (boundary === "incoming") {
		const direction = paths.fromDirections[pathIndex] as number;
		if (direction === 0) return null;
		const cell = {
			x: paths.cells[offset] as number,
			y: paths.cells[offset + 1] as number,
		};
		return directedEdgeKey({ from: moveCell(cell, direction as Direction), to: cell });
	}
	const direction = paths.toDirections[pathIndex] as number;
	if (direction === 0) return null;
	const cell = {
		x: paths.exitCells[offset] as number,
		y: paths.exitCells[offset + 1] as number,
	};
	return directedEdgeKey({ from: cell, to: moveCell(cell, direction as Direction) });
}

function directedEdgeKey(edge: DirectedRailEdge): string {
	return `${cellKey(edge.from.x, edge.from.y)}>${cellKey(edge.to.x, edge.to.y)}`;
}

function emptySelection(): CompiledPhysicalPathSelection {
	return Object.freeze({
		count: 0,
		pathIndices: new Uint32Array(),
		startStations: new Float32Array(),
		endStations: new Float32Array(),
		totalLengthMeters: 0,
	});
}
