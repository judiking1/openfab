import type { RailMapReader } from "./paint";
import { classifyRailCell } from "./RailCellClassification";
import {
	instantiateRailTemplate,
	planRailTemplate,
	type RailTemplateId,
	type RailTemplateParameters,
	type RailTemplatePose,
	type RailTemplateRouteReuseConnector,
	type RailTemplateSharedTrunkConnector,
	transformRailTemplateBlueprint,
} from "./RailTemplateCatalog";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, type RailCell } from "./TileMap";

export const RAIL_TEMPLATE_COMPOSITION_IDS = Object.freeze([
	"long-bay",
	"paired-bay",
	"nested-bay",
	"shift-bay",
	"interbay-spine",
	"outer-loop",
] as const);

export type RailTemplateCompositionId = (typeof RAIL_TEMPLATE_COMPOSITION_IDS)[number];

export interface RailTemplateCompositionGuideMap extends RailMapReader {
	forEachRail(visit: (x: number, y: number, rail: RailCell, encoded: number) => void): void;
}

export interface RailTemplateCompositionInterval {
	readonly connectorId: string;
	readonly startAnchor: Cell;
	readonly endAnchor: Cell;
	readonly firstTargetStart: Cell;
	readonly lastTargetStart: Cell;
	readonly anchorCount: number;
	readonly geometricDirection: Direction;
	readonly travelDirection: Direction;
	readonly spanMeters: number;
	readonly minimumOverlapMeters: number;
	readonly runMinimumCoordinate: number;
	readonly runMaximumCoordinate: number;
}

export interface RailTemplateRouteReuseTarget {
	readonly connectorId: string;
	readonly anchor: Cell;
	readonly handleCell: Cell;
	readonly routeLengthMeters: number;
}

export interface RailTemplateCompositionGuide {
	readonly baseRevision: number;
	readonly templateId: RailTemplateCompositionId;
	readonly templateDefinitionFingerprint: string;
	readonly pose: RailTemplatePose;
	readonly parameters: RailTemplateParameters;
	readonly intervals: readonly RailTemplateCompositionInterval[];
	readonly routeReuseTargets: readonly RailTemplateRouteReuseTarget[];
	readonly scannedRailCellCount: number;
	readonly linearRunCount: number;
	readonly candidateAnchorCount: number;
}

export interface RailTemplateCompositionTargetIndex {
	readonly baseRevision: number;
	readonly runs: readonly DirectedLinearRun[];
	readonly nonlinearCells: readonly Cell[];
	readonly scannedRailCellCount: number;
}

export interface RailTemplateCompositionResolution {
	readonly baseRevision: number;
	readonly connectorId: string;
	readonly mode: "route-reuse" | "shared-trunk";
	readonly anchor: Cell;
	readonly targetStart: Cell;
	readonly targetEnd: Cell;
	readonly overlapStart: Cell;
	readonly overlapEnd: Cell;
	readonly overlapMeters: number;
	readonly distanceMeters: number;
}

interface LinearCandidate {
	readonly axis: 0 | 1;
	readonly lane: number;
	readonly coordinate: number;
	readonly travelDirection: Direction;
}

interface DirectedLinearRun {
	readonly axis: 0 | 1;
	readonly lane: number;
	readonly minimumCoordinate: number;
	readonly maximumCoordinate: number;
	readonly travelDirection: Direction;
}

/**
 * Derive closed-pattern composition targets from ordinary authored rail only. Shared-trunk targets
 * are interval math over maximal directed linear runs; exact parent-route reuse is checked only at
 * non-linear handle candidates. No template provenance is persisted or inferred into project data.
 */
export function deriveRailTemplateCompositionGuide(
	map: RailTemplateCompositionGuideMap,
	templateId: RailTemplateCompositionId,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
): RailTemplateCompositionGuide {
	return deriveRailTemplateCompositionGuideFromTargetIndex(
		map,
		deriveRailTemplateCompositionTargetIndex(map),
		templateId,
		pose,
		parameters,
	);
}

export function deriveRailTemplateCompositionTargetIndex(
	map: RailTemplateCompositionGuideMap,
): RailTemplateCompositionTargetIndex {
	const baseRevision = map.getRevision();
	const linearCandidates: LinearCandidate[] = [];
	const nonlinearCells: Cell[] = [];
	let scannedRailCellCount = 0;
	map.forEachRail((x, y, rail) => {
		scannedRailCellCount++;
		if (classifyRailCell(rail) !== "LINEAR") {
			nonlinearCells.push(freezeCell({ x, y }));
			return;
		}
		const travelDirection = singleDirection(rail.outgoing);
		if (!travelDirection || rail.incoming !== oppositeDirection(travelDirection)) return;
		const horizontal = travelDirection === DIR_E || travelDirection === DIR_W;
		linearCandidates.push(
			Object.freeze({
				axis: horizontal ? 0 : 1,
				lane: horizontal ? y : x,
				coordinate: horizontal ? x : y,
				travelDirection,
			}),
		);
	});
	if (map.getRevision() !== baseRevision) {
		throw new Error("Rail map revision changed while deriving composition targets.");
	}
	return Object.freeze({
		baseRevision,
		runs: Object.freeze(coalesceLinearRuns(linearCandidates)),
		nonlinearCells: Object.freeze(nonlinearCells),
		scannedRailCellCount,
	});
}

export function deriveRailTemplateCompositionGuideFromTargetIndex(
	map: RailTemplateCompositionGuideMap,
	index: RailTemplateCompositionTargetIndex,
	templateId: RailTemplateCompositionId,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
): RailTemplateCompositionGuide {
	if (!isRailTemplateCompositionId(templateId)) {
		throw new RangeError(
			`Rail template ${templateId as string} is not a closed composition motif.`,
		);
	}
	if (parameters.templateId !== templateId) {
		throw new RangeError("Rail composition parameters do not match the template id.");
	}
	if (map.getRevision() !== index.baseRevision) {
		throw new Error("Rail composition target index is stale.");
	}

	const baseRevision = index.baseRevision;
	const blueprint = instantiateRailTemplate(templateId, parameters);
	const transformed = transformRailTemplateBlueprint(blueprint, { x: 0, y: 0 }, pose);
	const intervals: RailTemplateCompositionInterval[] = [];
	const sharedConnectors = transformed.compositionConnectors.filter(
		(connector): connector is RailTemplateSharedTrunkConnector =>
			connector.kind === "shared-trunk" && connector.routeIndex !== null,
	);
	for (const connector of sharedConnectors) {
		for (const run of index.runs) {
			const interval = compositionInterval(connector, run);
			if (interval) intervals.push(interval);
		}
	}
	intervals.sort(compareIntervals);

	const routeReuseTargets = deriveRouteReuseTargets(
		map,
		templateId,
		pose,
		parameters,
		transformed.buildRoutes,
		transformed.compositionConnectors.filter(
			(connector): connector is RailTemplateRouteReuseConnector => connector.kind === "route-reuse",
		),
		index.nonlinearCells,
	);
	if (map.getRevision() !== baseRevision) {
		throw new Error("Rail map revision changed while matching composition routes.");
	}
	const candidateAnchorCount =
		intervals.reduce((total, interval) => total + interval.anchorCount, 0) +
		routeReuseTargets.length;
	return Object.freeze({
		baseRevision,
		templateId,
		templateDefinitionFingerprint: blueprint.definitionFingerprint,
		pose: Object.freeze({ ...pose }),
		parameters: Object.freeze({ ...parameters }),
		intervals: Object.freeze(intervals),
		routeReuseTargets: Object.freeze(routeReuseTargets),
		scannedRailCellCount: index.scannedRailCellCount,
		linearRunCount: index.runs.length,
		candidateAnchorCount,
	});
}

export function isRailTemplateCompositionGuideCurrent(
	map: Pick<RailMapReader, "getRevision">,
	guide: RailTemplateCompositionGuide,
): boolean {
	return map.getRevision() === guide.baseRevision;
}

export function resolveRailTemplateCompositionSnap(
	guide: RailTemplateCompositionGuide,
	world: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): RailTemplateCompositionResolution | null {
	const candidates = resolveRailTemplateCompositionSnaps(guide, world, maximumDistanceMeters);
	return candidates.find((candidate) => candidate.mode === "route-reuse") ?? candidates[0] ?? null;
}

/**
 * Resolve a bounded nearest-first candidate set. Multiple candidates are retained so the caller can
 * skip an overlap rejected by the final planner without jumping to another pose or a free placement.
 */
export function resolveRailTemplateCompositionSnaps(
	guide: RailTemplateCompositionGuide,
	world: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): readonly RailTemplateCompositionResolution[] {
	if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0)
		return Object.freeze([]);
	const candidates: RailTemplateCompositionResolution[] = [];
	const seen = new Set<string>();
	for (const target of guide.routeReuseTargets) {
		const distanceMeters = distanceToCellCenter(world, target.handleCell);
		if (distanceMeters > maximumDistanceMeters) continue;
		const candidate = freezeResolution({
			baseRevision: guide.baseRevision,
			connectorId: target.connectorId,
			mode: "route-reuse",
			anchor: target.anchor,
			targetStart: target.handleCell,
			targetEnd: target.handleCell,
			overlapStart: target.handleCell,
			overlapEnd: target.handleCell,
			overlapMeters: target.routeLengthMeters,
			distanceMeters,
		});
		pushUniqueResolution(candidates, seen, candidate);
	}

	for (const interval of guide.intervals) {
		for (const targetStart of nearestTargetStarts(interval, world, maximumDistanceMeters)) {
			const distanceMeters = distanceToCellCenter(world, targetStart);
			const connectorStartOffset = subtractCells(interval.firstTargetStart, interval.startAnchor);
			const anchor = subtractCells(targetStart, connectorStartOffset);
			const targetEnd = moveRepeated(targetStart, interval.geometricDirection, interval.spanMeters);
			const overlap = sharedOverlap(interval, targetStart);
			if (!overlap || overlap.meters < interval.minimumOverlapMeters) continue;
			pushUniqueResolution(
				candidates,
				seen,
				freezeResolution({
					baseRevision: guide.baseRevision,
					connectorId: interval.connectorId,
					mode: "shared-trunk",
					anchor,
					targetStart,
					targetEnd,
					overlapStart: overlap.start,
					overlapEnd: overlap.end,
					overlapMeters: overlap.meters,
					distanceMeters,
				}),
			);
		}
	}
	candidates.sort(compareResolutions);
	return Object.freeze(candidates);
}

export function isRailTemplateCompositionId(
	id: RailTemplateId | string,
): id is RailTemplateCompositionId {
	return (RAIL_TEMPLATE_COMPOSITION_IDS as readonly string[]).includes(id);
}

function coalesceLinearRuns(candidates: LinearCandidate[]): DirectedLinearRun[] {
	candidates.sort(
		(left, right) =>
			left.axis - right.axis ||
			left.lane - right.lane ||
			left.travelDirection - right.travelDirection ||
			left.coordinate - right.coordinate,
	);
	const runs: DirectedLinearRun[] = [];
	for (const candidate of candidates) {
		const previous = runs.at(-1);
		if (
			previous &&
			previous.axis === candidate.axis &&
			previous.lane === candidate.lane &&
			previous.travelDirection === candidate.travelDirection &&
			previous.maximumCoordinate + 1 === candidate.coordinate
		) {
			runs[runs.length - 1] = Object.freeze({
				...previous,
				maximumCoordinate: candidate.coordinate,
			});
			continue;
		}
		runs.push(
			Object.freeze({
				axis: candidate.axis,
				lane: candidate.lane,
				minimumCoordinate: candidate.coordinate,
				maximumCoordinate: candidate.coordinate,
				travelDirection: candidate.travelDirection,
			}),
		);
	}
	return runs;
}

function compositionInterval(
	connector: RailTemplateSharedTrunkConnector,
	run: DirectedLinearRun,
): RailTemplateCompositionInterval | null {
	const horizontal =
		connector.geometricDirection === DIR_E || connector.geometricDirection === DIR_W;
	if (run.axis !== (horizontal ? 0 : 1) || run.travelDirection !== connector.travelDirection) {
		return null;
	}
	const geometricSign =
		connector.geometricDirection === DIR_E || connector.geometricDirection === DIR_S ? 1 : -1;
	const orientedRunMinimum = geometricSign > 0 ? run.minimumCoordinate : -run.maximumCoordinate;
	const orientedRunMaximum = geometricSign > 0 ? run.maximumCoordinate : -run.minimumCoordinate;
	const availableMeters = orientedRunMaximum - orientedRunMinimum;
	const minimumOverlapMeters = Math.min(connector.minimumOverlapMeters, connector.spanMeters);
	if (availableMeters < minimumOverlapMeters || minimumOverlapMeters <= 0) return null;
	const firstOrientedCoordinate =
		orientedRunMinimum - (connector.spanMeters - minimumOverlapMeters);
	const lastOrientedCoordinate = orientedRunMaximum - minimumOverlapMeters;
	const firstCoordinate = geometricSign * firstOrientedCoordinate;
	const lastCoordinate = geometricSign * lastOrientedCoordinate;
	const anchorCount = lastOrientedCoordinate - firstOrientedCoordinate + 1;
	if (anchorCount <= 0) return null;
	const firstTargetStart = axisCell(run.axis, run.lane, firstCoordinate);
	const lastTargetStart = axisCell(run.axis, run.lane, lastCoordinate);
	const connectorOffset = connector.startCell;
	return Object.freeze({
		connectorId: connector.id,
		startAnchor: freezeCell(subtractCells(firstTargetStart, connectorOffset)),
		endAnchor: freezeCell(subtractCells(lastTargetStart, connectorOffset)),
		firstTargetStart: freezeCell(firstTargetStart),
		lastTargetStart: freezeCell(lastTargetStart),
		anchorCount,
		geometricDirection: connector.geometricDirection,
		travelDirection: connector.travelDirection,
		spanMeters: connector.spanMeters,
		minimumOverlapMeters,
		runMinimumCoordinate: run.minimumCoordinate,
		runMaximumCoordinate: run.maximumCoordinate,
	});
}

function sharedOverlap(
	interval: RailTemplateCompositionInterval,
	targetStart: Cell,
): { readonly start: Cell; readonly end: Cell; readonly meters: number } | null {
	const horizontal = interval.geometricDirection === DIR_E || interval.geometricDirection === DIR_W;
	const sign =
		interval.geometricDirection === DIR_E || interval.geometricDirection === DIR_S ? 1 : -1;
	const targetCoordinate = horizontal ? targetStart.x : targetStart.y;
	const orientedTarget = sign * targetCoordinate;
	const orientedRunMinimum =
		sign > 0 ? interval.runMinimumCoordinate : -interval.runMaximumCoordinate;
	const orientedRunMaximum =
		sign > 0 ? interval.runMaximumCoordinate : -interval.runMinimumCoordinate;
	const overlapMinimum = Math.max(orientedRunMinimum, orientedTarget);
	const overlapMaximum = Math.min(orientedRunMaximum, orientedTarget + interval.spanMeters);
	const meters = overlapMaximum - overlapMinimum;
	if (meters <= 0) return null;
	const startCoordinate = sign * overlapMinimum;
	const endCoordinate = sign * overlapMaximum;
	const lane = horizontal ? targetStart.y : targetStart.x;
	return Object.freeze({
		start: freezeCell(
			horizontal ? { x: startCoordinate, y: lane } : { x: lane, y: startCoordinate },
		),
		end: freezeCell(horizontal ? { x: endCoordinate, y: lane } : { x: lane, y: endCoordinate }),
		meters,
	});
}

function deriveRouteReuseTargets(
	map: RailTemplateCompositionGuideMap,
	templateId: RailTemplateCompositionId,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
	routes: readonly (readonly Cell[])[],
	connectors: readonly RailTemplateRouteReuseConnector[],
	nonlinearCells: readonly Cell[],
): RailTemplateRouteReuseTarget[] {
	const targets = new Map<string, RailTemplateRouteReuseTarget>();
	for (const connector of connectors) {
		const route = routes[connector.routeIndex];
		if (!route || route.length < 3) continue;
		const first = route[0] as Cell;
		const second = route[1] as Cell;
		const previous = route.at(-2) as Cell;
		const outgoing = directionBetween(first, second);
		const incomingTravel = directionBetween(previous, first);
		if (!outgoing || !incomingTravel) continue;
		for (const handleCell of nonlinearCells) {
			const rail = map.getRail(handleCell.x, handleCell.y);
			if (
				(rail.outgoing & outgoing) === 0 ||
				(rail.incoming & oppositeDirection(incomingTravel)) === 0
			) {
				continue;
			}
			const anchor = subtractCells(handleCell, connector.handleCell);
			if (!routeExistsAt(map, route, anchor)) continue;
			const plan = planRailTemplate(map, templateId, anchor, pose, parameters);
			if (!plan.valid || plan.newEdges === 0) continue;
			const key = `${connector.id}:${cellKey(anchor.x, anchor.y)}`;
			targets.set(
				key,
				Object.freeze({
					connectorId: connector.id,
					anchor: freezeCell(anchor),
					handleCell: freezeCell(handleCell),
					routeLengthMeters: connector.routeLengthMeters,
				}),
			);
		}
	}
	return [...targets.values()].sort(
		(left, right) =>
			left.handleCell.y - right.handleCell.y ||
			left.handleCell.x - right.handleCell.x ||
			left.connectorId.localeCompare(right.connectorId),
	);
}

function routeExistsAt(map: RailMapReader, routeOffsets: readonly Cell[], anchor: Cell): boolean {
	for (let index = 0; index < routeOffsets.length - 1; index++) {
		const fromOffset = routeOffsets[index] as Cell;
		const toOffset = routeOffsets[index + 1] as Cell;
		const direction = directionBetween(fromOffset, toOffset);
		if (!direction) return false;
		const from = addCells(anchor, fromOffset);
		const to = addCells(anchor, toOffset);
		if (
			(map.getRail(from.x, from.y).outgoing & direction) === 0 ||
			(map.getRail(to.x, to.y).incoming & oppositeDirection(direction)) === 0
		) {
			return false;
		}
	}
	return true;
}

const MAX_NEAREST_TARGETS_PER_INTERVAL = 9;

function nearestTargetStarts(
	interval: RailTemplateCompositionInterval,
	world: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): readonly Cell[] {
	const vertical = interval.firstTargetStart.x === interval.lastTargetStart.x;
	const firstCoordinate = vertical ? interval.firstTargetStart.y : interval.firstTargetStart.x;
	const lastCoordinate = vertical ? interval.lastTargetStart.y : interval.lastTargetStart.x;
	const minimumCoordinate = Math.min(firstCoordinate, lastCoordinate);
	const maximumCoordinate = Math.max(firstCoordinate, lastCoordinate);
	const worldCoordinate = vertical ? world.y : world.x;
	const nearestCoordinate = clampInteger(
		Math.round(worldCoordinate - 0.5),
		minimumCoordinate,
		maximumCoordinate,
	);
	const cells: Cell[] = [];
	for (let offset = 0; cells.length < MAX_NEAREST_TARGETS_PER_INTERVAL; offset++) {
		const coordinates =
			offset === 0 ? [nearestCoordinate] : [nearestCoordinate - offset, nearestCoordinate + offset];
		let foundInRange = false;
		for (const coordinate of coordinates) {
			if (coordinate < minimumCoordinate || coordinate > maximumCoordinate) continue;
			foundInRange = true;
			const cell = vertical
				? { x: interval.firstTargetStart.x, y: coordinate }
				: { x: coordinate, y: interval.firstTargetStart.y };
			if (distanceToCellCenter(world, cell) <= maximumDistanceMeters) cells.push(freezeCell(cell));
			if (cells.length >= MAX_NEAREST_TARGETS_PER_INTERVAL) break;
		}
		if (
			!foundInRange &&
			nearestCoordinate - offset < minimumCoordinate &&
			nearestCoordinate + offset > maximumCoordinate
		) {
			break;
		}
		const minimumPossibleDistance = Math.max(0, offset - 0.5);
		if (minimumPossibleDistance > maximumDistanceMeters) break;
	}
	return cells;
}

function axisCell(axis: 0 | 1, lane: number, coordinate: number): Cell {
	return axis === 0 ? { x: coordinate, y: lane } : { x: lane, y: coordinate };
}

function clampInteger(value: number, first: number, second: number): number {
	return Math.max(Math.min(first, second), Math.min(Math.max(first, second), value));
}

function moveRepeated(cell: Cell, direction: Direction, distance: number): Cell {
	let current = cell;
	for (let step = 0; step < distance; step++) current = moveCell(current, direction);
	return current;
}

function addCells(left: Cell, right: Cell): Cell {
	return { x: left.x + right.x, y: left.y + right.y };
}

function subtractCells(left: Cell, right: Cell): Cell {
	return { x: left.x - right.x, y: left.y - right.y };
}

function distanceToCellCenter(world: Readonly<{ x: number; y: number }>, cell: Cell): number {
	return Math.hypot(world.x - (cell.x + 0.5), world.y - (cell.y + 0.5));
}

function freezeResolution(
	resolution: RailTemplateCompositionResolution,
): RailTemplateCompositionResolution {
	return Object.freeze({
		...resolution,
		anchor: freezeCell(resolution.anchor),
		targetStart: freezeCell(resolution.targetStart),
		targetEnd: freezeCell(resolution.targetEnd),
		overlapStart: freezeCell(resolution.overlapStart),
		overlapEnd: freezeCell(resolution.overlapEnd),
	});
}

function pushUniqueResolution(
	resolutions: RailTemplateCompositionResolution[],
	seen: Set<string>,
	resolution: RailTemplateCompositionResolution,
): void {
	const key = `${resolution.mode}:${resolution.connectorId}:${cellKey(resolution.anchor.x, resolution.anchor.y)}`;
	if (seen.has(key)) return;
	seen.add(key);
	resolutions.push(resolution);
}

function compareResolutions(
	left: RailTemplateCompositionResolution,
	right: RailTemplateCompositionResolution,
): number {
	return (
		left.distanceMeters - right.distanceMeters ||
		right.overlapMeters - left.overlapMeters ||
		left.connectorId.localeCompare(right.connectorId) ||
		left.anchor.y - right.anchor.y ||
		left.anchor.x - right.anchor.x
	);
}

function compareIntervals(
	left: RailTemplateCompositionInterval,
	right: RailTemplateCompositionInterval,
): number {
	return (
		left.firstTargetStart.y - right.firstTargetStart.y ||
		left.firstTargetStart.x - right.firstTargetStart.x ||
		right.spanMeters - left.spanMeters ||
		left.connectorId.localeCompare(right.connectorId)
	);
}

function singleDirection(mask: number): Direction | null {
	if (mask === DIR_N || mask === DIR_E || mask === DIR_S || mask === DIR_W) return mask;
	return null;
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
