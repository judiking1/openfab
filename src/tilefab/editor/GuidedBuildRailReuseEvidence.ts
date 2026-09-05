import {
	RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
	RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS,
} from "../core/RailNetworkLinkPlanner";
import { ALL_DIRECTIONS, DIR_E, DIR_W, moveCell, oppositeDirection } from "../core/railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "../core/TileMap";

export interface GuidedBuildRailReuseEvidence {
	readonly weakComponentCount: number;
	readonly networkLinkSupportedComponentCount: number;
	/** Presentation evidence that explains why a bent first attempt has not completed Mission 2. */
	readonly longestStraightRunMeters?: number;
	/** Closed, strongly connected components that can advance practice while drafts remain elsewhere. */
	readonly closedStrongComponentCount?: number;
	readonly repeatedComponentKindCount: number;
	readonly repeatedComponentCopyCount: number;
}

export const EMPTY_GUIDED_BUILD_RAIL_REUSE_EVIDENCE: GuidedBuildRailReuseEvidence = Object.freeze({
	weakComponentCount: 0,
	networkLinkSupportedComponentCount: 0,
	longestStraightRunMeters: 0,
	closedStrongComponentCount: 0,
	repeatedComponentKindCount: 0,
	repeatedComponentCopyCount: 0,
});

interface EncodedRailCell extends Cell {
	readonly encoded: number;
}

export function analyzeGuidedBuildRailReuse(map: TileMap): GuidedBuildRailReuseEvidence {
	const rails = new Map<string, EncodedRailCell>();
	map.forEachRail((x, y, _rail, encoded) => {
		rails.set(cellKey(x, y), Object.freeze({ x, y, encoded }));
	});
	const components = collectWeakComponents(rails);
	const runEvidence = components.map(analyzeComponentStraightRuns);
	const networkLinkSupportedComponentCount = runEvidence.reduce(
		(count, evidence) => count + (evidence.networkLinkSupported ? 1 : 0),
		0,
	);
	const longestStraightRunMeters = runEvidence.reduce(
		(longest, evidence) => Math.max(longest, evidence.longestStraightRunMeters),
		0,
	);
	const closedStrongComponentCount = components.reduce(
		(count, component) => count + (componentHasClosedStrongFlow(component, rails) ? 1 : 0),
		0,
	);
	if (components.length < 2) {
		return Object.freeze({
			weakComponentCount: components.length,
			networkLinkSupportedComponentCount,
			longestStraightRunMeters,
			closedStrongComponentCount,
			repeatedComponentKindCount: 0,
			repeatedComponentCopyCount: 0,
		});
	}
	const counts = new Map<string, number>();
	for (const component of components) {
		const signature = canonicalRotationSignature(component);
		counts.set(signature, (counts.get(signature) ?? 0) + 1);
	}
	let repeatedComponentKindCount = 0;
	let repeatedComponentCopyCount = 0;
	for (const count of counts.values()) {
		if (count < 2) continue;
		repeatedComponentKindCount++;
		repeatedComponentCopyCount += count;
	}
	return Object.freeze({
		weakComponentCount: components.length,
		networkLinkSupportedComponentCount,
		longestStraightRunMeters,
		closedStrongComponentCount,
		repeatedComponentKindCount,
		repeatedComponentCopyCount,
	});
}

function componentHasClosedStrongFlow(
	component: readonly EncodedRailCell[],
	rails: ReadonlyMap<string, EncodedRailCell>,
): boolean {
	if (component.length === 0) return false;
	const keys = new Set(component.map((cell) => cellKey(cell.x, cell.y)));
	for (const cell of component) {
		const rail = decodeRailCell(cell.encoded);
		if (rail.incoming === 0 || rail.outgoing === 0) return false;
		for (const direction of ALL_DIRECTIONS) {
			const incoming = (rail.incoming & direction) !== 0;
			const outgoing = (rail.outgoing & direction) !== 0;
			if (!incoming && !outgoing) continue;
			const neighborCell = moveCell(cell, direction);
			const neighbor = rails.get(cellKey(neighborCell.x, neighborCell.y));
			if (!neighbor || !keys.has(cellKey(neighbor.x, neighbor.y))) return false;
			const neighborRail = decodeRailCell(neighbor.encoded);
			const opposite = oppositeDirection(direction);
			if (incoming && (neighborRail.outgoing & opposite) === 0) return false;
			if (outgoing && (neighborRail.incoming & opposite) === 0) return false;
		}
	}
	return (
		directedReachCount(component[0] as EncodedRailCell, rails, keys, false) === keys.size &&
		directedReachCount(component[0] as EncodedRailCell, rails, keys, true) === keys.size
	);
}

function directedReachCount(
	start: EncodedRailCell,
	rails: ReadonlyMap<string, EncodedRailCell>,
	componentKeys: ReadonlySet<string>,
	reverse: boolean,
): number {
	const visited = new Set<string>();
	const stack: EncodedRailCell[] = [start];
	while (stack.length > 0) {
		const current = stack.pop() as EncodedRailCell;
		const currentKey = cellKey(current.x, current.y);
		if (visited.has(currentKey)) continue;
		visited.add(currentKey);
		const currentRail = decodeRailCell(current.encoded);
		const directions = reverse ? currentRail.incoming : currentRail.outgoing;
		for (const direction of ALL_DIRECTIONS) {
			if ((directions & direction) === 0) continue;
			const nextCell = moveCell(current, direction);
			const nextKey = cellKey(nextCell.x, nextCell.y);
			if (!componentKeys.has(nextKey)) continue;
			const next = rails.get(nextKey);
			if (next) stack.push(next);
		}
	}
	return visited.size;
}

function analyzeComponentStraightRuns(component: readonly EncodedRailCell[]): Readonly<{
	networkLinkSupported: boolean;
	longestStraightRunMeters: number;
}> {
	const coordinatesByRun = new Map<string, number[]>();
	for (const cell of component) {
		const rail = decodeRailCell(cell.encoded);
		const incoming = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
		const outgoing = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0);
		if (
			incoming === undefined ||
			outgoing === undefined ||
			rail.incoming !== incoming ||
			rail.outgoing !== outgoing ||
			incoming !== oppositeDirection(outgoing)
		) {
			continue;
		}
		const horizontal = outgoing === DIR_E || outgoing === DIR_W;
		const key = `${horizontal ? "x" : "y"}:${horizontal ? cell.y : cell.x}:${outgoing}`;
		const coordinates = coordinatesByRun.get(key) ?? [];
		coordinates.push(horizontal ? cell.x : cell.y);
		coordinatesByRun.set(key, coordinates);
	}
	const minimumCellCount =
		RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS + RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS * 2 + 1;
	let networkLinkSupported = false;
	let longestStraightRunMeters = 0;
	for (const coordinates of coordinatesByRun.values()) {
		coordinates.sort((left, right) => left - right);
		let consecutive = 0;
		let previous = Number.NEGATIVE_INFINITY;
		for (const coordinate of coordinates) {
			consecutive = coordinate === previous + 1 ? consecutive + 1 : 1;
			// N interior straight cells span N + 1 authored one-meter edges.
			longestStraightRunMeters = Math.max(longestStraightRunMeters, consecutive + 1);
			if (consecutive >= minimumCellCount) networkLinkSupported = true;
			previous = coordinate;
		}
	}
	return Object.freeze({ networkLinkSupported, longestStraightRunMeters });
}

function collectWeakComponents(
	rails: ReadonlyMap<string, EncodedRailCell>,
): readonly (readonly EncodedRailCell[])[] {
	const ordered = [...rails.values()].sort(compareEncodedCells);
	const visited = new Set<string>();
	const components: EncodedRailCell[][] = [];
	for (const start of ordered) {
		if (visited.has(cellKey(start.x, start.y))) continue;
		const component: EncodedRailCell[] = [];
		const stack: EncodedRailCell[] = [start];
		while (stack.length > 0) {
			const current = stack.pop() as EncodedRailCell;
			const currentKey = cellKey(current.x, current.y);
			if (visited.has(currentKey)) continue;
			visited.add(currentKey);
			component.push(current);
			const currentRail = decodeRailCell(current.encoded);
			for (const direction of ALL_DIRECTIONS) {
				const nextCell = moveCell(current, direction);
				const next = rails.get(cellKey(nextCell.x, nextCell.y));
				if (!next) continue;
				const nextRail = decodeRailCell(next.encoded);
				const opposite = oppositeDirection(direction);
				if (
					((currentRail.outgoing & direction) !== 0 && (nextRail.incoming & opposite) !== 0) ||
					((currentRail.incoming & direction) !== 0 && (nextRail.outgoing & opposite) !== 0)
				) {
					stack.push(next);
				}
			}
		}
		components.push(component);
	}
	return Object.freeze(components.map((component) => Object.freeze(component)));
}

function canonicalRotationSignature(component: readonly EncodedRailCell[]): string {
	const candidates = [0, 1, 2, 3].map((quarterTurns) => rotationSignature(component, quarterTurns));
	candidates.sort(compareAscii);
	return candidates[0] ?? "";
}

function rotationSignature(component: readonly EncodedRailCell[], quarterTurns: number): string {
	const rotated = component.map((cell) => {
		const point = rotatePoint(cell.x, cell.y, quarterTurns);
		return {
			x: point.x,
			y: point.y,
			encoded: rotateEncodedRail(cell.encoded, quarterTurns),
		};
	});
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	for (const cell of rotated) {
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
	}
	rotated.sort(compareEncodedCells);
	return rotated
		.map((cell) => `${cell.x - minX},${cell.y - minY},${cell.encoded.toString(16)}`)
		.join(";");
}

function rotatePoint(x: number, y: number, quarterTurns: number): Cell {
	if (quarterTurns === 1) return { x: -y, y: x };
	if (quarterTurns === 2) return { x: -x, y: -y };
	if (quarterTurns === 3) return { x: y, y: -x };
	return { x, y };
}

function rotateEncodedRail(encoded: number, quarterTurns: number): number {
	const rail = decodeRailCell(encoded);
	return encodeRailCell({
		incoming: rotateDirectionMask(rail.incoming, quarterTurns),
		outgoing: rotateDirectionMask(rail.outgoing, quarterTurns),
	});
}

function rotateDirectionMask(mask: number, quarterTurns: number): number {
	let result = mask & 15;
	for (let turn = 0; turn < quarterTurns; turn++) {
		result = ((result << 1) & 15) | ((result >> 3) & 1);
	}
	return result;
}

function compareEncodedCells(left: EncodedRailCell, right: EncodedRailCell): number {
	return left.x - right.x || left.y - right.y || left.encoded - right.encoded;
}

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
