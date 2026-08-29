import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	findDirectedThroughRoute,
	isTangentJunction,
	oppositeDirection,
} from "../core/railShape";
import { type Cell, cellKey, decodeRailCell, type RailCell, TileMap } from "../core/TileMap";
import {
	collectAffectedTurnoutFootprints,
	collectTurnoutFootprints,
	TURNOUT_KIND,
	type TurnoutFootprint,
	type TurnoutKind,
	turnoutTrimKey,
} from "../core/turnout";

export const PATH_KIND = {
	TERMINAL: 0,
	LINEAR: 1,
	CURVE: 2,
	TURNOUT_TRUNK: 3,
	TURNOUT_DIVERGE: 4,
	INVALID: 5,
	COMPOUND_CCW: 6,
	COMPOUND_S: 7,
	COMPOUND_CSC_HOMO: 8,
	COMPOUND_CSC_HETE: 9,
	COMPOUND_RIGHT: 10,
	ADVANCED_SWITCH_SEGMENT: 11,
} as const;

export const PHYSICAL_PATH_SOURCE_KIND = {
	CARDINAL_CELL: 0,
	ADVANCED_SWITCH_SEGMENT: 1,
} as const;

export const NO_ADVANCED_SWITCH_PROFILE_CLASS = 0xff;
export const NO_ADVANCED_SWITCH_SEGMENT_ROLE = 0xff;
export const NO_ADVANCED_SWITCH_SEGMENT_PORT = 0xff;
export const NO_ADVANCED_SWITCH_SEGMENT_ORDINAL = 0xffff;
export const NO_ADVANCED_SWITCH_CATALOG_PROFILE = 0xff;

export type PhysicalPathKind = (typeof PATH_KIND)[keyof typeof PATH_KIND];

export interface CompiledPhysicalPaths {
	revision: number;
	positions: Float32Array;
	tangents: Float32Array;
	distances: Float32Array;
	offsets: Uint32Array;
	kinds: Uint8Array;
	/** Authored cell containing the path entry boundary. */
	cells: Int32Array;
	/** Authored cell containing the path exit boundary; differs for multi-cell paths. */
	exitCells: Int32Array;
	fromDirections: Uint8Array;
	toDirections: Uint8Array;
	lengths: Float32Array;
	bounds: Float32Array;
	startInsets: Float32Array;
	endInsets: Float32Array;
	startExtensions: Float32Array;
	endExtensions: Float32Array;
	coverageOffsets: Uint32Array;
	coverageCells: Int32Array;
	sharedSegmentOffsets: Uint32Array;
	sharedSegmentIds: Uint32Array;
	sharedSegmentStarts: Float32Array;
	sharedSegmentEnds: Float32Array;
	/** Stable source identity for each final path; path indices are never identity. */
	sourceKinds: Uint8Array;
	advancedSwitchIds: Uint32Array;
	advancedSwitchProfileClasses: Uint8Array;
	advancedSwitchSegmentRoles: Uint8Array;
	advancedSwitchSegmentPorts: Uint8Array;
	advancedSwitchSegmentOrdinals: Uint16Array;
	advancedSwitchCatalogProfiles: Uint8Array;
	/** Additional graph edges for synthetic paths that cannot be inferred from authored cells. */
	explicitAdjacencyOffsets: Uint32Array;
	explicitAdjacencyTargets: Uint32Array;
	sharedSegmentCount: number;
	totalLengthMeters: number;
	totalRouteLengthMeters: number;
	pathCount: number;
	pointCount: number;
}

export interface PhysicalPathSample {
	x: number;
	y: number;
	tangentX: number;
	tangentY: number;
}

export interface PhysicalPathPreviewMutation {
	x: number;
	y: number;
	after: number;
}

interface PathSpec {
	x: number;
	y: number;
	exitX?: number;
	exitY?: number;
	kind: PhysicalPathKind;
	from: Direction | 0;
	to: Direction | 0;
	turnoutKind?: TurnoutKind;
	startInset?: number;
	endInset?: number;
	startExtension?: number;
	endExtension?: number;
	coverage?: readonly Cell[];
	sharedSegments?: readonly SharedSegmentSpec[];
}

interface SharedSegmentSpec {
	id: number;
	lengthMeters: number;
	edge: "start" | "end";
}

export interface PhysicalPathGeometry {
	positions: number[];
	tangents: number[];
	distances: number[];
	length: number;
	bounds: [number, number, number, number];
}

type PathPoints = PhysicalPathGeometry;

interface PathTrim {
	startInset: number;
	endInset: number;
}

const CURVE_RADIUS_METERS = 0.5;
const QUARTER_ARC_LENGTH = (Math.PI * CURVE_RADIUS_METERS) / 2;
const MAX_ARC_SAMPLE_SPACING_METERS = 0.1;

/** Compile every authored cell-local directed route in deterministic map order. */
export function compilePhysicalPaths(
	map: TileMap,
	knownFootprints?: readonly TurnoutFootprint[],
	revision = map.getRevision(),
): CompiledPhysicalPaths {
	const cells: { x: number; y: number; rail: RailCell }[] = [];
	map.forEachRail((x, y, rail) => cells.push({ x, y, rail }));
	cells.sort((left, right) => left.y - right.y || left.x - right.x);

	const footprints = knownFootprints ?? collectTurnoutFootprints(map);
	const footprintByCell = new Map(
		footprints.map((footprint) => [cellKey(footprint.cell.x, footprint.cell.y), footprint]),
	);
	const sharedSegmentByCell = new Map(
		footprints.map((footprint, index) => [cellKey(footprint.cell.x, footprint.cell.y), index]),
	);
	const trims = buildTrimLookup(footprints);
	const specs: PathSpec[] = [];
	for (const cell of cells) {
		appendCellRoutes(
			specs,
			cell.x,
			cell.y,
			cell.rail,
			footprintByCell.get(cellKey(cell.x, cell.y)),
			sharedSegmentByCell.get(cellKey(cell.x, cell.y)),
		);
	}
	for (const spec of specs) {
		if (spec.from === 0 || spec.to === 0 || spec.turnoutKind !== undefined) continue;
		const trim = trims.get(turnoutTrimKey({ x: spec.x, y: spec.y }, spec.from, spec.to));
		if (!trim) continue;
		spec.startInset = trim.startInset;
		spec.endInset = trim.endInset;
	}

	const offsets = new Uint32Array(specs.length + 1);
	const kinds = new Uint8Array(specs.length);
	const pathCells = new Int32Array(specs.length * 2);
	const pathExitCells = new Int32Array(specs.length * 2);
	const fromDirections = new Uint8Array(specs.length);
	const toDirections = new Uint8Array(specs.length);
	const lengths = new Float32Array(specs.length);
	const bounds = new Float32Array(specs.length * 4);
	const startInsets = new Float32Array(specs.length);
	const endInsets = new Float32Array(specs.length);
	const startExtensions = new Float32Array(specs.length);
	const endExtensions = new Float32Array(specs.length);
	const coverageOffsets = new Uint32Array(specs.length + 1);
	const sharedSegmentOffsets = new Uint32Array(specs.length + 1);
	const allCoverageCells: number[] = [];
	const allSharedSegmentIds: number[] = [];
	const allSharedSegmentStarts: number[] = [];
	const allSharedSegmentEnds: number[] = [];
	const allPositions: number[] = [];
	const allTangents: number[] = [];
	const allDistances: number[] = [];
	const sharedSegmentUsage = new Map<number, { lengthMeters: number; count: number }>();
	let totalRouteLengthMeters = 0;

	for (let pathIndex = 0; pathIndex < specs.length; pathIndex++) {
		const spec = specs[pathIndex] as PathSpec;
		const path = buildPath(spec);
		offsets[pathIndex] = allDistances.length;
		allPositions.push(...path.positions);
		allTangents.push(...path.tangents);
		allDistances.push(...path.distances);
		kinds[pathIndex] = spec.kind;
		pathCells[pathIndex * 2] = spec.x;
		pathCells[pathIndex * 2 + 1] = spec.y;
		pathExitCells[pathIndex * 2] = spec.exitX ?? spec.x;
		pathExitCells[pathIndex * 2 + 1] = spec.exitY ?? spec.y;
		fromDirections[pathIndex] = spec.from;
		toDirections[pathIndex] = spec.to;
		lengths[pathIndex] = path.length;
		bounds.set(path.bounds, pathIndex * 4);
		startInsets[pathIndex] = spec.startInset ?? 0;
		endInsets[pathIndex] = spec.endInset ?? 0;
		startExtensions[pathIndex] = spec.startExtension ?? 0;
		endExtensions[pathIndex] = spec.endExtension ?? 0;
		coverageOffsets[pathIndex] = allCoverageCells.length / 2;
		for (const cell of spec.coverage ?? [{ x: spec.x, y: spec.y }]) {
			allCoverageCells.push(cell.x, cell.y);
		}
		sharedSegmentOffsets[pathIndex] = allSharedSegmentIds.length;
		for (const shared of spec.sharedSegments ?? []) {
			const lengthMeters = Math.min(path.length, shared.lengthMeters);
			const startMeters = shared.edge === "start" ? 0 : path.length - lengthMeters;
			allSharedSegmentIds.push(shared.id);
			allSharedSegmentStarts.push(startMeters);
			allSharedSegmentEnds.push(startMeters + lengthMeters);
			const previous = sharedSegmentUsage.get(shared.id);
			sharedSegmentUsage.set(shared.id, {
				lengthMeters: Math.max(previous?.lengthMeters ?? 0, lengthMeters),
				count: (previous?.count ?? 0) + 1,
			});
		}
		totalRouteLengthMeters += path.length;
	}
	offsets[specs.length] = allDistances.length;
	coverageOffsets[specs.length] = allCoverageCells.length / 2;
	sharedSegmentOffsets[specs.length] = allSharedSegmentIds.length;
	let duplicatedSharedLengthMeters = 0;
	for (const shared of sharedSegmentUsage.values()) {
		duplicatedSharedLengthMeters += shared.lengthMeters * Math.max(0, shared.count - 1);
	}

	return {
		revision,
		positions: new Float32Array(allPositions),
		tangents: new Float32Array(allTangents),
		distances: new Float32Array(allDistances),
		offsets,
		kinds,
		cells: pathCells,
		exitCells: pathExitCells,
		fromDirections,
		toDirections,
		lengths,
		bounds,
		startInsets,
		endInsets,
		startExtensions,
		endExtensions,
		coverageOffsets,
		coverageCells: new Int32Array(allCoverageCells),
		sharedSegmentOffsets,
		sharedSegmentIds: new Uint32Array(allSharedSegmentIds),
		sharedSegmentStarts: new Float32Array(allSharedSegmentStarts),
		sharedSegmentEnds: new Float32Array(allSharedSegmentEnds),
		sourceKinds: new Uint8Array(specs.length),
		advancedSwitchIds: new Uint32Array(specs.length),
		advancedSwitchProfileClasses: filledUint8(specs.length, NO_ADVANCED_SWITCH_PROFILE_CLASS),
		advancedSwitchSegmentRoles: filledUint8(specs.length, NO_ADVANCED_SWITCH_SEGMENT_ROLE),
		advancedSwitchSegmentPorts: filledUint8(specs.length, NO_ADVANCED_SWITCH_SEGMENT_PORT),
		advancedSwitchSegmentOrdinals: filledUint16(specs.length, NO_ADVANCED_SWITCH_SEGMENT_ORDINAL),
		advancedSwitchCatalogProfiles: filledUint8(specs.length, NO_ADVANCED_SWITCH_CATALOG_PROFILE),
		explicitAdjacencyOffsets: new Uint32Array(specs.length + 1),
		explicitAdjacencyTargets: new Uint32Array(),
		sharedSegmentCount: sharedSegmentUsage.size,
		totalLengthMeters: totalRouteLengthMeters - duplicatedSharedLengthMeters,
		totalRouteLengthMeters,
		pathCount: specs.length,
		pointCount: allDistances.length,
	};
}

/** Build one exact 1 m cardinal module without consulting authored map bytes. */
export function buildCardinalCellPathGeometry(
	x: number,
	y: number,
	from: Direction,
	to: Direction,
): PhysicalPathGeometry | null {
	if (from === to || !ALL_DIRECTIONS.includes(from) || !ALL_DIRECTIONS.includes(to)) return null;
	if (to === oppositeDirection(from)) return linePath(x, y, from, to);
	return curvePath(x, y, from, to);
}

/** Compile only the future-state paths touched by a speculative editor command. */
export function compilePhysicalPathPreview(
	map: TileMap,
	mutations: readonly PhysicalPathPreviewMutation[],
	focusCells: readonly Cell[],
): CompiledPhysicalPaths {
	const afterByCell = new Map(
		mutations.map((mutation) => [cellKey(mutation.x, mutation.y), mutation.after]),
	);
	const readEncoded = (x: number, y: number): number =>
		afterByCell.get(cellKey(x, y)) ?? map.getEncoded(x, y);
	const candidateCells = new Map<string, Cell>();
	for (const cell of focusCells) candidateCells.set(cellKey(cell.x, cell.y), cell);
	for (const mutation of mutations) {
		const cell = { x: mutation.x, y: mutation.y };
		candidateCells.set(cellKey(cell.x, cell.y), cell);
	}
	const seeds = [...candidateCells.values()];
	const footprints = collectAffectedTurnoutFootprints(
		(x, y) => decodeRailCell(readEncoded(x, y)),
		seeds,
	);
	for (const footprint of footprints) {
		candidateCells.set(cellKey(footprint.cell.x, footprint.cell.y), footprint.cell);
		for (const cell of footprint.reservedCells) {
			candidateCells.set(cellKey(cell.x, cell.y), cell);
		}
	}

	const localMap = new TileMap();
	for (const cell of candidateCells.values()) {
		const encoded = readEncoded(cell.x, cell.y);
		if (encoded !== 0) localMap.setEncoded(cell.x, cell.y, encoded);
	}
	return { ...compilePhysicalPaths(localMap, footprints), revision: map.getRevision() };
}

/** Sample a path in its one-way travel direction, clamping distance to the path ends. */
export function samplePhysicalPath(
	layout: CompiledPhysicalPaths,
	pathIndex: number,
	distanceMeters: number,
): PhysicalPathSample | null {
	if (
		!Number.isInteger(pathIndex) ||
		pathIndex < 0 ||
		pathIndex >= layout.pathCount ||
		!Number.isFinite(distanceMeters)
	) {
		return null;
	}

	const start = layout.offsets[pathIndex] as number;
	const end = layout.offsets[pathIndex + 1] as number;
	if (start >= end) return null;
	const distance = Math.max(0, Math.min(distanceMeters, layout.lengths[pathIndex] as number));
	if (end - start === 1 || distance <= (layout.distances[start] as number)) {
		return pointSample(layout, start);
	}
	if (distance >= (layout.distances[end - 1] as number)) return pointSample(layout, end - 1);

	let low = start + 1;
	let high = end - 1;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((layout.distances[middle] as number) < distance) low = middle + 1;
		else high = middle;
	}
	const next = low;
	const previous = next - 1;
	const d0 = layout.distances[previous] as number;
	const d1 = layout.distances[next] as number;
	const amount = d1 === d0 ? 0 : (distance - d0) / (d1 - d0);
	const x = lerp(
		layout.positions[previous * 2] as number,
		layout.positions[next * 2] as number,
		amount,
	);
	const y = lerp(
		layout.positions[previous * 2 + 1] as number,
		layout.positions[next * 2 + 1] as number,
		amount,
	);
	const rawTangentX = lerp(
		layout.tangents[previous * 2] as number,
		layout.tangents[next * 2] as number,
		amount,
	);
	const rawTangentY = lerp(
		layout.tangents[previous * 2 + 1] as number,
		layout.tangents[next * 2 + 1] as number,
		amount,
	);
	const magnitude = Math.hypot(rawTangentX, rawTangentY);
	return {
		x,
		y,
		tangentX: magnitude === 0 ? 0 : rawTangentX / magnitude,
		tangentY: magnitude === 0 ? 0 : rawTangentY / magnitude,
	};
}

function buildTrimLookup(footprints: readonly TurnoutFootprint[]): Map<string, PathTrim> {
	const lookup = new Map<string, PathTrim>();
	for (const footprint of footprints) {
		for (const trim of footprint.trims) {
			const key = turnoutTrimKey(trim.cell, trim.from, trim.to);
			const previous = lookup.get(key);
			lookup.set(key, {
				startInset: Math.max(previous?.startInset ?? 0, trim.startInsetMeters),
				endInset: Math.max(previous?.endInset ?? 0, trim.endInsetMeters),
			});
		}
	}
	return lookup;
}

function appendCellRoutes(
	specs: PathSpec[],
	x: number,
	y: number,
	rail: RailCell,
	turnout: TurnoutFootprint | undefined,
	sharedSegmentId: number | undefined,
): void {
	const incomingCount = bitCount(rail.incoming);
	const outgoingCount = bitCount(rail.outgoing);
	const degree = bitCount(rail.incoming | rail.outgoing);
	if (degree === 1 && incomingCount + outgoingCount === 1) {
		const incoming = singleDirection(rail.incoming);
		const outgoing = singleDirection(rail.outgoing);
		specs.push({
			x,
			y,
			kind: PATH_KIND.TERMINAL,
			from: incoming ?? 0,
			to: outgoing ?? 0,
		});
		return;
	}

	if (degree === 2 && incomingCount === 1 && outgoingCount === 1) {
		const from = singleDirection(rail.incoming);
		const to = singleDirection(rail.outgoing);
		if (from && to && from !== to) {
			specs.push({
				x,
				y,
				kind: to === oppositeDirection(from) ? PATH_KIND.LINEAR : PATH_KIND.CURVE,
				from,
				to,
			});
			return;
		}
	}

	if (degree === 3 && isTangentJunction(rail.incoming, rail.outgoing)) {
		const through = findDirectedThroughRoute(rail.incoming, rail.outgoing);
		if (through) {
			const sharedSegments = turnoutSharedSegments(turnout, sharedSegmentId);
			const trunkCoverage = turnout
				? turnout.kind === TURNOUT_KIND.BRANCH
					? [turnout.reservedCells[0] as Cell, turnout.cell]
					: [turnout.cell, turnout.reservedCells[2] as Cell]
				: undefined;
			specs.push({
				x,
				y,
				kind: PATH_KIND.TURNOUT_TRUNK,
				from: through.incoming,
				to: through.outgoing,
				turnoutKind: turnout?.kind,
				startExtension: turnout?.kind === TURNOUT_KIND.BRANCH ? turnout.leadInMeters : 0,
				endExtension: turnout?.kind === TURNOUT_KIND.MERGE ? turnout.leadOutMeters : 0,
				coverage: trunkCoverage,
				sharedSegments,
			});
			if (incomingCount === 1) {
				const divergingTo = singleDirection(rail.outgoing & ~through.outgoing);
				if (divergingTo) {
					specs.push({
						x,
						y,
						kind: PATH_KIND.TURNOUT_DIVERGE,
						from: through.incoming,
						to: divergingTo,
						turnoutKind: turnout?.kind,
						startExtension: turnout?.leadInMeters ?? 0,
						endExtension: turnout?.leadOutMeters ?? 0,
						coverage: turnout?.reservedCells,
						sharedSegments,
					});
					return;
				}
			} else {
				const divergingFrom = singleDirection(rail.incoming & ~through.incoming);
				if (divergingFrom) {
					specs.push({
						x,
						y,
						kind: PATH_KIND.TURNOUT_DIVERGE,
						from: divergingFrom,
						to: through.outgoing,
						turnoutKind: turnout?.kind,
						startExtension: turnout?.leadInMeters ?? 0,
						endExtension: turnout?.leadOutMeters ?? 0,
						coverage: turnout?.reservedCells,
						sharedSegments,
					});
					return;
				}
			}
			specs.pop();
		}
	}

	specs.push({ x, y, kind: PATH_KIND.INVALID, from: 0, to: 0 });
}

function turnoutSharedSegments(
	turnout: TurnoutFootprint | undefined,
	id: number | undefined,
): readonly SharedSegmentSpec[] | undefined {
	if (!turnout || id === undefined) return undefined;
	const branch = turnout.kind === TURNOUT_KIND.BRANCH;
	return [
		{
			id,
			lengthMeters: branch ? turnout.leadInMeters : turnout.leadOutMeters,
			edge: branch ? "start" : "end",
		},
	];
}

function buildPath(spec: PathSpec): PathPoints {
	if (spec.kind === PATH_KIND.INVALID) return invalidPath(spec.x, spec.y);
	if (spec.kind === PATH_KIND.TERMINAL) return terminalPath(spec);
	if (spec.kind === PATH_KIND.TURNOUT_TRUNK) {
		return extendedLinePath(
			spec.x,
			spec.y,
			spec.from as Direction,
			spec.to as Direction,
			spec.startExtension ?? 0,
			spec.endExtension ?? 0,
		);
	}
	if (spec.kind === PATH_KIND.TURNOUT_DIVERGE) {
		return leadCurvePath(
			spec.x,
			spec.y,
			spec.from as Direction,
			spec.to as Direction,
			spec.startExtension ?? 0,
			spec.endExtension ?? 0,
		);
	}
	const base =
		spec.kind === PATH_KIND.LINEAR
			? linePath(spec.x, spec.y, spec.from as Direction, spec.to as Direction)
			: curvePath(spec.x, spec.y, spec.from as Direction, spec.to as Direction);
	return trimPath(base, spec.startInset ?? 0, spec.endInset ?? 0);
}

function terminalPath(spec: PathSpec): PathPoints {
	const center = { x: spec.x + 0.5, y: spec.y + 0.5 };
	if (spec.from) {
		const side = sidePoint(spec.x, spec.y, spec.from);
		return twoPointPath(side, center);
	}
	const side = sidePoint(spec.x, spec.y, spec.to as Direction);
	return twoPointPath(center, side);
}

function linePath(x: number, y: number, from: Direction, to: Direction): PathPoints {
	return twoPointPath(sidePoint(x, y, from), sidePoint(x, y, to));
}

function extendedLinePath(
	x: number,
	y: number,
	from: Direction,
	to: Direction,
	startExtension: number,
	endExtension: number,
): PathPoints {
	const start = sidePoint(x, y, from);
	const end = sidePoint(x, y, to);
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);
	const tangent = { x: dx / length, y: dy / length };
	return twoPointPath(
		{
			x: start.x - tangent.x * startExtension,
			y: start.y - tangent.y * startExtension,
		},
		{
			x: end.x + tangent.x * endExtension,
			y: end.y + tangent.y * endExtension,
		},
	);
}

function twoPointPath(from: { x: number; y: number }, to: { x: number; y: number }): PathPoints {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	const tangentX = length === 0 ? 0 : dx / length;
	const tangentY = length === 0 ? 0 : dy / length;
	return {
		positions: [from.x, from.y, to.x, to.y],
		tangents: [tangentX, tangentY, tangentX, tangentY],
		distances: [0, length],
		length,
		bounds: [
			Math.min(from.x, to.x),
			Math.min(from.y, to.y),
			Math.max(from.x, to.x),
			Math.max(from.y, to.y),
		],
	};
}

function curvePath(x: number, y: number, from: Direction, to: Direction): PathPoints {
	const start = sidePoint(x, y, from);
	const center = {
		x: from === DIR_E || to === DIR_E ? x + 1 : from === DIR_W || to === DIR_W ? x : x + 0.5,
		y: from === DIR_S || to === DIR_S ? y + 1 : from === DIR_N || to === DIR_N ? y : y + 0.5,
	};
	const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
	const inward = directionVector(oppositeDirection(from));
	const positiveTangent = { x: -Math.sin(startAngle), y: Math.cos(startAngle) };
	const angleSign = positiveTangent.x * inward.x + positiveTangent.y * inward.y > 0 ? 1 : -1;
	const segmentCount = Math.ceil(QUARTER_ARC_LENGTH / MAX_ARC_SAMPLE_SPACING_METERS);
	const positions: number[] = [];
	const tangents: number[] = [];
	const distances: number[] = [];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index <= segmentCount; index++) {
		const amount = index / segmentCount;
		const angle = startAngle + angleSign * amount * (Math.PI / 2);
		const pointX = center.x + CURVE_RADIUS_METERS * Math.cos(angle);
		const pointY = center.y + CURVE_RADIUS_METERS * Math.sin(angle);
		positions.push(pointX, pointY);
		tangents.push(angleSign * -Math.sin(angle), angleSign * Math.cos(angle));
		distances.push(amount * QUARTER_ARC_LENGTH);
		minX = Math.min(minX, pointX);
		minY = Math.min(minY, pointY);
		maxX = Math.max(maxX, pointX);
		maxY = Math.max(maxY, pointY);
	}
	return {
		positions,
		tangents,
		distances,
		length: QUARTER_ARC_LENGTH,
		bounds: [minX, minY, maxX, maxY],
	};
}

function leadCurvePath(
	x: number,
	y: number,
	from: Direction,
	to: Direction,
	startExtension: number,
	endExtension: number,
): PathPoints {
	const arc = curvePath(x, y, from, to);
	const positions: number[] = [];
	const tangents: number[] = [];
	const distances: number[] = [];
	const startX = arc.positions[0] as number;
	const startY = arc.positions[1] as number;
	const startTangentX = arc.tangents[0] as number;
	const startTangentY = arc.tangents[1] as number;
	if (startExtension > 0) {
		positions.push(
			startX - startTangentX * startExtension,
			startY - startTangentY * startExtension,
		);
		tangents.push(startTangentX, startTangentY);
		distances.push(0);
	}
	for (let index = 0; index < arc.distances.length; index++) {
		positions.push(arc.positions[index * 2] as number, arc.positions[index * 2 + 1] as number);
		tangents.push(arc.tangents[index * 2] as number, arc.tangents[index * 2 + 1] as number);
		distances.push(startExtension + (arc.distances[index] as number));
	}
	const endPointIndex = arc.distances.length - 1;
	const endX = arc.positions[endPointIndex * 2] as number;
	const endY = arc.positions[endPointIndex * 2 + 1] as number;
	const endTangentX = arc.tangents[endPointIndex * 2] as number;
	const endTangentY = arc.tangents[endPointIndex * 2 + 1] as number;
	if (endExtension > 0) {
		positions.push(endX + endTangentX * endExtension, endY + endTangentY * endExtension);
		tangents.push(endTangentX, endTangentY);
		distances.push(startExtension + arc.length + endExtension);
	}
	return pathFromSamples(positions, tangents, distances);
}

function trimPath(path: PathPoints, startInset: number, endInset: number): PathPoints {
	if (startInset <= 0 && endInset <= 0) return path;
	const start = Math.min(path.length, Math.max(0, startInset));
	const end = Math.max(start, path.length - Math.max(0, endInset));
	const positions: number[] = [];
	const tangents: number[] = [];
	const distances: number[] = [];
	appendPathSample(path, start, start, positions, tangents, distances);
	for (let index = 1; index < path.distances.length - 1; index++) {
		const distance = path.distances[index] as number;
		if (distance <= start || distance >= end) continue;
		positions.push(path.positions[index * 2] as number, path.positions[index * 2 + 1] as number);
		tangents.push(path.tangents[index * 2] as number, path.tangents[index * 2 + 1] as number);
		distances.push(distance - start);
	}
	if (end > start) appendPathSample(path, end, start, positions, tangents, distances);
	return pathFromSamples(positions, tangents, distances);
}

function appendPathSample(
	path: PathPoints,
	distance: number,
	distanceOrigin: number,
	positions: number[],
	tangents: number[],
	distances: number[],
): void {
	let next = 1;
	while (next < path.distances.length && (path.distances[next] as number) < distance) next++;
	if (next >= path.distances.length) next = path.distances.length - 1;
	const previous = Math.max(0, next - 1);
	const d0 = path.distances[previous] as number;
	const d1 = path.distances[next] as number;
	const amount = d1 === d0 ? 0 : (distance - d0) / (d1 - d0);
	const x = lerp(
		path.positions[previous * 2] as number,
		path.positions[next * 2] as number,
		amount,
	);
	const y = lerp(
		path.positions[previous * 2 + 1] as number,
		path.positions[next * 2 + 1] as number,
		amount,
	);
	const tangentX = lerp(
		path.tangents[previous * 2] as number,
		path.tangents[next * 2] as number,
		amount,
	);
	const tangentY = lerp(
		path.tangents[previous * 2 + 1] as number,
		path.tangents[next * 2 + 1] as number,
		amount,
	);
	const magnitude = Math.hypot(tangentX, tangentY);
	positions.push(x, y);
	tangents.push(
		magnitude === 0 ? 0 : tangentX / magnitude,
		magnitude === 0 ? 0 : tangentY / magnitude,
	);
	distances.push(distance - distanceOrigin);
}

function pathFromSamples(positions: number[], tangents: number[], distances: number[]): PathPoints {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < positions.length; index += 2) {
		minX = Math.min(minX, positions[index] as number);
		minY = Math.min(minY, positions[index + 1] as number);
		maxX = Math.max(maxX, positions[index] as number);
		maxY = Math.max(maxY, positions[index + 1] as number);
	}
	return {
		positions,
		tangents,
		distances,
		length: distances.at(-1) ?? 0,
		bounds: [minX, minY, maxX, maxY],
	};
}

function invalidPath(x: number, y: number): PathPoints {
	const centerX = x + 0.5;
	const centerY = y + 0.5;
	return {
		positions: [centerX, centerY],
		tangents: [0, 0],
		distances: [0],
		length: 0,
		bounds: [centerX, centerY, centerX, centerY],
	};
}

function sidePoint(x: number, y: number, direction: Direction): { x: number; y: number } {
	if (direction === DIR_N) return { x: x + 0.5, y };
	if (direction === DIR_E) return { x: x + 1, y: y + 0.5 };
	if (direction === DIR_S) return { x: x + 0.5, y: y + 1 };
	return { x, y: y + 0.5 };
}

function directionVector(direction: Direction): { x: number; y: number } {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function singleDirection(mask: number): Direction | null {
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function pointSample(layout: CompiledPhysicalPaths, pointIndex: number): PhysicalPathSample {
	return {
		x: layout.positions[pointIndex * 2] as number,
		y: layout.positions[pointIndex * 2 + 1] as number,
		tangentX: layout.tangents[pointIndex * 2] as number,
		tangentY: layout.tangents[pointIndex * 2 + 1] as number,
	};
}

function lerp(from: number, to: number, amount: number): number {
	return from + (to - from) * amount;
}

function filledUint8(length: number, value: number): Uint8Array {
	const result = new Uint8Array(length);
	result.fill(value);
	return result;
}

function filledUint16(length: number, value: number): Uint16Array {
	const result = new Uint16Array(length);
	result.fill(value);
	return result;
}
