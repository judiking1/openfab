import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import { buildPhysicalPathAdjacency, type PhysicalPathAdjacency } from "./PhysicalPathFlow";
import { PHYSICAL_PATH_IDENTITY_WIDTH, physicalPathIdentity } from "./PhysicalPathIdentity";
import {
	type CompiledRailEnvelopes,
	compileRailEnvelopes,
	RailEnvelopeSpatialIndex,
} from "./RailClearanceCompiler";
import { DEFAULT_RAIL_CLEARANCE_PROFILE, type RailClearanceProfile } from "./RailClearanceProfile";

export const RAIL_CLEARANCE_RELATION = {
	SAME_PATH: 0,
	CONTINUATION: 1,
	AUTHORIZED_CONFLICT: 2,
	AUTHORIZED_MODULE: 3,
	UNRELATED: 4,
} as const;

export type RailClearanceRelation =
	(typeof RAIL_CLEARANCE_RELATION)[keyof typeof RAIL_CLEARANCE_RELATION];

export const RAIL_CLEARANCE_ISSUE_CODE = {
	BEAM_INTRUSION: 0,
	OHT_SWEEP_INTRUSION: 1,
	INSTALLATION_CLEARANCE: 2,
} as const;

export type RailClearanceIssueCode =
	(typeof RAIL_CLEARANCE_ISSUE_CODE)[keyof typeof RAIL_CLEARANCE_ISSUE_CODE];

export const RAIL_CLEARANCE_PATH_IDENTITY_WIDTH = PHYSICAL_PATH_IDENTITY_WIDTH;

export interface RailClearanceTurnoutOwnership {
	readonly count: number;
	readonly clearancePathOffsets: Uint32Array;
	readonly clearancePathIndices: Uint32Array;
	readonly clearancePathStarts: Float32Array;
	readonly clearancePathEnds: Float32Array;
}

export interface RailClearanceSwitchOwnership {
	readonly count: number;
	readonly movementOffsets: Uint32Array;
	readonly movementPathOffsets: Uint32Array;
	readonly movementPathIndices: Uint32Array;
	readonly movementPathStarts: Float32Array;
	readonly movementPathEnds: Float32Array;
	readonly conflictPathOffsets: Uint32Array;
	readonly conflictPathIndices: Uint32Array;
	readonly conflictPathStarts: Float32Array;
	readonly conflictPathEnds: Float32Array;
}

export const EMPTY_RAIL_CLEARANCE_SWITCH_OWNERSHIP: RailClearanceSwitchOwnership = {
	count: 0,
	movementOffsets: new Uint32Array([0]),
	movementPathOffsets: new Uint32Array([0]),
	movementPathIndices: new Uint32Array(),
	movementPathStarts: new Float32Array(),
	movementPathEnds: new Float32Array(),
	conflictPathOffsets: new Uint32Array([0]),
	conflictPathIndices: new Uint32Array(),
	conflictPathStarts: new Float32Array(),
	conflictPathEnds: new Float32Array(),
};

interface RailClearanceConflictInterval {
	readonly owner: number;
	readonly start: number;
	readonly end: number;
}

export interface RailClearanceRelationshipContext {
	readonly adjacency: PhysicalPathAdjacency;
	readonly turnoutIntervalsByPath: ReadonlyMap<number, readonly RailClearanceConflictInterval[]>;
	readonly switchConflictIntervalsByPath: ReadonlyMap<
		number,
		readonly RailClearanceConflictInterval[]
	>;
	readonly switchModuleIntervalsByPath: ReadonlyMap<
		number,
		readonly RailClearanceConflictInterval[]
	>;
}

export interface CompiledRailClearanceIssues {
	readonly count: number;
	readonly candidateEnvelopePairs: number;
	readonly testedEnvelopePairs: number;
	readonly codes: Uint8Array;
	readonly relations: Uint8Array;
	readonly firstPathIndices: Uint32Array;
	readonly secondPathIndices: Uint32Array;
	/** Stable path identity rows independent of revision-local path ordering. */
	readonly firstPathIdentities: Int32Array;
	readonly secondPathIdentities: Int32Array;
	readonly firstEnvelopeIndices: Uint32Array;
	readonly secondEnvelopeIndices: Uint32Array;
	readonly firstStations: Float32Array;
	readonly secondStations: Float32Array;
	readonly contactPoints: Float32Array;
	readonly centerlineDistances: Float32Array;
	readonly requiredClearances: Float32Array;
	readonly penetrationDepths: Float32Array;
	/** First and second authored reference cells as x0,y0,x1,y1. */
	readonly cells: Int32Array;
}

export interface CompiledRailClearance {
	readonly envelopes: CompiledRailEnvelopes;
	readonly issues: CompiledRailClearanceIssues;
}

interface ClosestSegmentPair {
	readonly firstAmount: number;
	readonly secondAmount: number;
	readonly firstX: number;
	readonly firstY: number;
	readonly secondX: number;
	readonly secondY: number;
	readonly distance: number;
}

interface PendingIssue {
	code: RailClearanceIssueCode;
	relation: RailClearanceRelation;
	firstPathIndex: number;
	secondPathIndex: number;
	firstEnvelopeIndex: number;
	secondEnvelopeIndex: number;
	firstStation: number;
	secondStation: number;
	contactX: number;
	contactY: number;
	centerlineDistance: number;
	requiredClearance: number;
	penetrationDepth: number;
	firstCellX: number;
	firstCellY: number;
	secondCellX: number;
	secondCellY: number;
}

const STATION_TOLERANCE_METERS = 0.002;
const DISTANCE_EPSILON = 1e-8;

export function compileRailClearance(
	paths: CompiledPhysicalPaths,
	turnoutOwnership: RailClearanceTurnoutOwnership,
	switchOwnership: RailClearanceSwitchOwnership = EMPTY_RAIL_CLEARANCE_SWITCH_OWNERSHIP,
	profile: RailClearanceProfile = DEFAULT_RAIL_CLEARANCE_PROFILE,
): CompiledRailClearance {
	const envelopes = compileRailEnvelopes(paths, profile);
	return {
		envelopes,
		issues: validateRailClearance(paths, envelopes, turnoutOwnership, switchOwnership),
	};
}

export function createRailClearanceRelationshipContext(
	paths: CompiledPhysicalPaths,
	turnoutOwnership: RailClearanceTurnoutOwnership,
	switchOwnership: RailClearanceSwitchOwnership = EMPTY_RAIL_CLEARANCE_SWITCH_OWNERSHIP,
): RailClearanceRelationshipContext {
	const turnoutIntervalsByPath = new Map<number, RailClearanceConflictInterval[]>();
	for (let turnoutIndex = 0; turnoutIndex < turnoutOwnership.count; turnoutIndex++) {
		appendConflictIntervals(
			paths,
			turnoutIntervalsByPath,
			turnoutIndex,
			turnoutOwnership.clearancePathOffsets[turnoutIndex] as number,
			turnoutOwnership.clearancePathOffsets[turnoutIndex + 1] as number,
			turnoutOwnership.clearancePathIndices,
			turnoutOwnership.clearancePathStarts,
			turnoutOwnership.clearancePathEnds,
		);
	}
	const switchConflictIntervalsByPath = new Map<number, RailClearanceConflictInterval[]>();
	const switchModuleIntervalsByPath = new Map<number, RailClearanceConflictInterval[]>();
	for (let owner = 0; owner < switchOwnership.count; owner++) {
		const movementStart = switchOwnership.movementOffsets[owner] as number;
		const movementEnd = switchOwnership.movementOffsets[owner + 1] as number;
		for (let movement = movementStart; movement < movementEnd; movement++) {
			appendConflictIntervals(
				paths,
				switchModuleIntervalsByPath,
				owner,
				switchOwnership.movementPathOffsets[movement] as number,
				switchOwnership.movementPathOffsets[movement + 1] as number,
				switchOwnership.movementPathIndices,
				switchOwnership.movementPathStarts,
				switchOwnership.movementPathEnds,
			);
		}
		const start = switchOwnership.conflictPathOffsets[owner] as number;
		const end = switchOwnership.conflictPathOffsets[owner + 1] as number;
		appendConflictIntervals(
			paths,
			switchConflictIntervalsByPath,
			owner,
			start,
			end,
			switchOwnership.conflictPathIndices,
			switchOwnership.conflictPathStarts,
			switchOwnership.conflictPathEnds,
		);
	}
	return {
		adjacency: buildPhysicalPathAdjacency(paths),
		turnoutIntervalsByPath,
		switchConflictIntervalsByPath,
		switchModuleIntervalsByPath,
	};
}

function appendConflictIntervals(
	paths: CompiledPhysicalPaths,
	target: Map<number, RailClearanceConflictInterval[]>,
	owner: number,
	start: number,
	end: number,
	pathIndices: Uint32Array,
	pathStarts: Float32Array,
	pathEnds: Float32Array,
): void {
	for (let row = start; row < end; row++) {
		const pathIndex = pathIndices[row] as number;
		if (pathIndex >= paths.pathCount) continue;
		const interval = {
			owner,
			start: pathStarts[row] as number,
			end: pathEnds[row] as number,
		};
		const intervals = target.get(pathIndex);
		if (intervals) intervals.push(interval);
		else target.set(pathIndex, [interval]);
	}
}

export function classifyRailClearanceRelationship(
	paths: CompiledPhysicalPaths,
	context: RailClearanceRelationshipContext,
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
	continuationWindowMeters = STATION_TOLERANCE_METERS,
): RailClearanceRelation {
	if (firstPathIndex === secondPathIndex) return RAIL_CLEARANCE_RELATION.SAME_PATH;
	if (
		shareIntervalOwnershipAtStations(
			context.switchConflictIntervalsByPath,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_CONFLICT;
	}
	if (
		sharePhysicalHardwareAtStations(
			paths,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_CONFLICT;
	}
	if (
		shareIntervalOwnershipAtStations(
			context.switchModuleIntervalsByPath,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE;
	}
	if (
		shareIntervalOwnershipAtStations(
			context.turnoutIntervalsByPath,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE;
	}
	if (shareCompoundModuleSupport(paths, firstPathIndex, secondPathIndex)) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE;
	}
	if (
		isContinuationAtStations(
			paths,
			context.adjacency,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			continuationWindowMeters,
		)
	) {
		return RAIL_CLEARANCE_RELATION.CONTINUATION;
	}
	return RAIL_CLEARANCE_RELATION.UNRELATED;
}

export function validateRailClearance(
	paths: CompiledPhysicalPaths,
	envelopes: CompiledRailEnvelopes,
	turnoutOwnership: RailClearanceTurnoutOwnership,
	switchOwnership: RailClearanceSwitchOwnership = EMPTY_RAIL_CLEARANCE_SWITCH_OWNERSHIP,
): CompiledRailClearanceIssues {
	const context = createRailClearanceRelationshipContext(paths, turnoutOwnership, switchOwnership);
	const spatial = new RailEnvelopeSpatialIndex(envelopes);
	const candidates: number[] = [];
	const pendingByPathPair = new Map<string, PendingIssue[]>();
	let candidateEnvelopePairs = 0;
	let testedEnvelopePairs = 0;

	for (let firstEnvelopeIndex = 0; firstEnvelopeIndex < envelopes.count; firstEnvelopeIndex++) {
		const boundsOffset = firstEnvelopeIndex * 4;
		spatial.query(
			{
				minX: envelopes.bounds[boundsOffset] as number,
				minY: envelopes.bounds[boundsOffset + 1] as number,
				maxX: envelopes.bounds[boundsOffset + 2] as number,
				maxY: envelopes.bounds[boundsOffset + 3] as number,
			},
			candidates,
		);
		candidates.sort((left, right) => left - right);
		for (const secondEnvelopeIndex of candidates) {
			if (secondEnvelopeIndex <= firstEnvelopeIndex) continue;
			candidateEnvelopePairs++;
			const firstPathIndex = envelopes.pathIndices[firstEnvelopeIndex] as number;
			const secondPathIndex = envelopes.pathIndices[secondEnvelopeIndex] as number;
			if (firstPathIndex === secondPathIndex) continue;
			const closest = closestEnvelopeSegments(envelopes, firstEnvelopeIndex, secondEnvelopeIndex);
			testedEnvelopePairs++;
			const firstTolerance =
				(envelopes.approximationToleranceMillimeters[firstEnvelopeIndex] as number) / 1_000;
			const secondTolerance =
				(envelopes.approximationToleranceMillimeters[secondEnvelopeIndex] as number) / 1_000;
			const tolerance = firstTolerance + secondTolerance;
			const installationClearance =
				((envelopes.installationRadiusMillimeters[firstEnvelopeIndex] as number) +
					(envelopes.installationRadiusMillimeters[secondEnvelopeIndex] as number)) /
					1_000 +
				tolerance;
			if (closest.distance + DISTANCE_EPSILON >= installationClearance) continue;

			const firstStation = interpolate(
				envelopes.stationStarts[firstEnvelopeIndex] as number,
				envelopes.stationEnds[firstEnvelopeIndex] as number,
				closest.firstAmount,
			);
			const secondStation = interpolate(
				envelopes.stationStarts[secondEnvelopeIndex] as number,
				envelopes.stationEnds[secondEnvelopeIndex] as number,
				closest.secondAmount,
			);
			const relation = classifyRailClearanceRelationship(
				paths,
				context,
				firstPathIndex,
				firstStation,
				secondPathIndex,
				secondStation,
				installationClearance,
			);
			if (relation !== RAIL_CLEARANCE_RELATION.UNRELATED) continue;

			const beamClearance =
				((envelopes.beamRadiusMillimeters[firstEnvelopeIndex] as number) +
					(envelopes.beamRadiusMillimeters[secondEnvelopeIndex] as number)) /
					1_000 +
				tolerance;
			const ohtClearance =
				((envelopes.ohtSweepRadiusMillimeters[firstEnvelopeIndex] as number) +
					(envelopes.ohtSweepRadiusMillimeters[secondEnvelopeIndex] as number)) /
					1_000 +
				tolerance;
			const code =
				closest.distance < beamClearance
					? RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION
					: closest.distance < ohtClearance
						? RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION
						: RAIL_CLEARANCE_ISSUE_CODE.INSTALLATION_CLEARANCE;
			const requiredClearance =
				code === RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION
					? beamClearance
					: code === RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION
						? ohtClearance
						: installationClearance;
			const normalized = normalizeIssueOrder({
				code,
				relation,
				firstPathIndex,
				secondPathIndex,
				firstEnvelopeIndex,
				secondEnvelopeIndex,
				firstStation,
				secondStation,
				contactX: (closest.firstX + closest.secondX) / 2,
				contactY: (closest.firstY + closest.secondY) / 2,
				centerlineDistance: closest.distance,
				requiredClearance,
				penetrationDepth: requiredClearance - closest.distance,
				...referenceCells(closest),
			});
			const key = `${normalized.firstPathIndex}:${normalized.secondPathIndex}`;
			const pending = pendingByPathPair.get(key);
			if (pending) pending.push(normalized);
			else pendingByPathPair.set(key, [normalized]);
		}
	}

	const pending = [...pendingByPathPair.values()]
		.flatMap((issues) => coalesceIssueRegions(issues))
		.sort(compareIssues);
	return compileIssueBuffers(paths, pending, candidateEnvelopePairs, testedEnvelopePairs);
}

export function railClearanceIssueMessage(code: RailClearanceIssueCode): string {
	if (code === RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION) {
		return "Rail beam envelopes overlap an unrelated rail path.";
	}
	if (code === RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION) {
		return "OHT swept-volume envelopes overlap an unrelated rail path.";
	}
	return "Rail installation-clearance envelopes overlap an unrelated rail path.";
}

export function closestEnvelopeSegments(
	envelopes: CompiledRailEnvelopes,
	firstEnvelopeIndex: number,
	secondEnvelopeIndex: number,
): ClosestSegmentPair {
	return closestLineSegments(
		envelopes.startPoints[firstEnvelopeIndex * 2] as number,
		envelopes.startPoints[firstEnvelopeIndex * 2 + 1] as number,
		envelopes.endPoints[firstEnvelopeIndex * 2] as number,
		envelopes.endPoints[firstEnvelopeIndex * 2 + 1] as number,
		envelopes.startPoints[secondEnvelopeIndex * 2] as number,
		envelopes.startPoints[secondEnvelopeIndex * 2 + 1] as number,
		envelopes.endPoints[secondEnvelopeIndex * 2] as number,
		envelopes.endPoints[secondEnvelopeIndex * 2 + 1] as number,
	);
}

export function closestLineSegments(
	firstStartX: number,
	firstStartY: number,
	firstEndX: number,
	firstEndY: number,
	secondStartX: number,
	secondStartY: number,
	secondEndX: number,
	secondEndY: number,
): ClosestSegmentPair {
	const firstDx = firstEndX - firstStartX;
	const firstDy = firstEndY - firstStartY;
	const secondDx = secondEndX - secondStartX;
	const secondDy = secondEndY - secondStartY;
	const offsetX = firstStartX - secondStartX;
	const offsetY = firstStartY - secondStartY;
	const firstLengthSquared = firstDx * firstDx + firstDy * firstDy;
	const secondLengthSquared = secondDx * secondDx + secondDy * secondDy;
	const secondProjection = secondDx * offsetX + secondDy * offsetY;
	let firstAmount = 0;
	let secondAmount = 0;

	if (firstLengthSquared <= DISTANCE_EPSILON && secondLengthSquared <= DISTANCE_EPSILON) {
		firstAmount = 0;
		secondAmount = 0;
	} else if (firstLengthSquared <= DISTANCE_EPSILON) {
		firstAmount = 0;
		secondAmount = clamp(secondProjection / secondLengthSquared, 0, 1);
	} else {
		const firstProjection = firstDx * offsetX + firstDy * offsetY;
		if (secondLengthSquared <= DISTANCE_EPSILON) {
			secondAmount = 0;
			firstAmount = clamp(-firstProjection / firstLengthSquared, 0, 1);
		} else {
			const crossProjection = firstDx * secondDx + firstDy * secondDy;
			const denominator =
				firstLengthSquared * secondLengthSquared - crossProjection * crossProjection;
			firstAmount =
				Math.abs(denominator) <= DISTANCE_EPSILON
					? 0
					: clamp(
							(crossProjection * secondProjection - firstProjection * secondLengthSquared) /
								denominator,
							0,
							1,
						);
			secondAmount = (crossProjection * firstAmount + secondProjection) / secondLengthSquared;
			if (secondAmount < 0) {
				secondAmount = 0;
				firstAmount = clamp(-firstProjection / firstLengthSquared, 0, 1);
			} else if (secondAmount > 1) {
				secondAmount = 1;
				firstAmount = clamp((crossProjection - firstProjection) / firstLengthSquared, 0, 1);
			}
		}
	}

	const firstX = firstStartX + firstDx * firstAmount;
	const firstY = firstStartY + firstDy * firstAmount;
	const secondX = secondStartX + secondDx * secondAmount;
	const secondY = secondStartY + secondDy * secondAmount;
	return {
		firstAmount,
		secondAmount,
		firstX,
		firstY,
		secondX,
		secondY,
		distance: Math.hypot(firstX - secondX, firstY - secondY),
	};
}

function shareIntervalOwnershipAtStations(
	intervalsByPath: ReadonlyMap<number, readonly RailClearanceConflictInterval[]>,
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
): boolean {
	const firstIntervals = intervalsByPath.get(firstPathIndex);
	const secondIntervals = intervalsByPath.get(secondPathIndex);
	if (!firstIntervals || !secondIntervals) return false;
	for (const first of firstIntervals) {
		if (!stationInInterval(first, firstStation)) continue;
		for (const second of secondIntervals) {
			if (first.owner === second.owner && stationInInterval(second, secondStation)) return true;
		}
	}
	return false;
}

function stationInInterval(interval: RailClearanceConflictInterval, station: number): boolean {
	return (
		station >= interval.start - STATION_TOLERANCE_METERS &&
		station <= interval.end + STATION_TOLERANCE_METERS
	);
}

function sharePhysicalHardwareAtStations(
	paths: CompiledPhysicalPaths,
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
): boolean {
	const firstStart = paths.sharedSegmentOffsets[firstPathIndex] as number;
	const firstEnd = paths.sharedSegmentOffsets[firstPathIndex + 1] as number;
	const secondStart = paths.sharedSegmentOffsets[secondPathIndex] as number;
	const secondEnd = paths.sharedSegmentOffsets[secondPathIndex + 1] as number;
	for (let firstRow = firstStart; firstRow < firstEnd; firstRow++) {
		if (!stationInSharedInterval(paths, firstRow, firstStation)) continue;
		for (let secondRow = secondStart; secondRow < secondEnd; secondRow++) {
			if (
				paths.sharedSegmentIds[firstRow] === paths.sharedSegmentIds[secondRow] &&
				stationInSharedInterval(paths, secondRow, secondStation)
			) {
				return true;
			}
		}
	}
	return false;
}

function shareCompoundModuleSupport(
	paths: CompiledPhysicalPaths,
	firstPathIndex: number,
	secondPathIndex: number,
): boolean {
	const firstCompound = isOrdinaryCompoundKind(paths.kinds[firstPathIndex] as number);
	const secondCompound = isOrdinaryCompoundKind(paths.kinds[secondPathIndex] as number);
	if (firstCompound === secondCompound) return false;
	const compoundPathIndex = firstCompound ? firstPathIndex : secondPathIndex;
	const supportPathIndex = firstCompound ? secondPathIndex : firstPathIndex;
	const supportKind = paths.kinds[supportPathIndex] as number;
	if (supportKind !== PATH_KIND.LINEAR && supportKind !== PATH_KIND.TERMINAL) return false;
	const supportCells = new Set<string>();
	const supportStart = paths.coverageOffsets[supportPathIndex] as number;
	const supportEnd = paths.coverageOffsets[supportPathIndex + 1] as number;
	for (let row = supportStart; row < supportEnd; row++) {
		supportCells.add(
			`${paths.coverageCells[row * 2] as number},${paths.coverageCells[row * 2 + 1] as number}`,
		);
	}
	const compoundStart = paths.coverageOffsets[compoundPathIndex] as number;
	const compoundEnd = paths.coverageOffsets[compoundPathIndex + 1] as number;
	for (let row = compoundStart; row < compoundEnd; row++) {
		if (
			supportCells.has(
				`${paths.coverageCells[row * 2] as number},${paths.coverageCells[row * 2 + 1] as number}`,
			)
		) {
			return true;
		}
	}
	return false;
}

function isOrdinaryCompoundKind(kind: number): boolean {
	return (
		kind === PATH_KIND.COMPOUND_CCW ||
		kind === PATH_KIND.COMPOUND_S ||
		kind === PATH_KIND.COMPOUND_CSC_HOMO ||
		kind === PATH_KIND.COMPOUND_CSC_HETE ||
		kind === PATH_KIND.COMPOUND_RIGHT
	);
}

function stationInSharedInterval(
	paths: CompiledPhysicalPaths,
	row: number,
	station: number,
): boolean {
	return (
		station >= (paths.sharedSegmentStarts[row] as number) - STATION_TOLERANCE_METERS &&
		station <= (paths.sharedSegmentEnds[row] as number) + STATION_TOLERANCE_METERS
	);
}

function isContinuationAtStations(
	paths: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
	maxRouteDistanceMeters: number,
): boolean {
	return (
		continuationRouteFits(
			paths,
			adjacency,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			maxRouteDistanceMeters,
		) ||
		continuationRouteFits(
			paths,
			adjacency,
			secondPathIndex,
			secondStation,
			firstPathIndex,
			firstStation,
			maxRouteDistanceMeters,
		)
	);
}

function continuationRouteFits(
	paths: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	fromPathIndex: number,
	fromStation: number,
	toPathIndex: number,
	toStation: number,
	maxRouteDistanceMeters: number,
): boolean {
	const limit = Math.max(STATION_TOLERANCE_METERS, maxRouteDistanceMeters);
	const initialDistance = Math.max(0, (paths.lengths[fromPathIndex] as number) - fromStation);
	if (initialDistance > limit + STATION_TOLERANCE_METERS) return false;
	const best = new Map<number, number>();
	const queue: Array<{ pathIndex: number; distanceToStart: number }> = [];
	const enqueueTargets = (pathIndex: number, distanceToEnd: number): void => {
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const target = adjacency.targets[row] as number;
			if (!continuationGeometryMatches(paths, pathIndex, target)) continue;
			const previous = best.get(target);
			if (previous !== undefined && previous <= distanceToEnd) continue;
			best.set(target, distanceToEnd);
			queue.push({ pathIndex: target, distanceToStart: distanceToEnd });
		}
	};
	enqueueTargets(fromPathIndex, initialDistance);
	while (queue.length > 0) {
		queue.sort((left, right) => left.distanceToStart - right.distanceToStart);
		const current = queue.shift() as { pathIndex: number; distanceToStart: number };
		if (current.pathIndex === toPathIndex) {
			return current.distanceToStart + Math.max(0, toStation) <= limit + STATION_TOLERANCE_METERS;
		}
		const distanceToEnd = current.distanceToStart + (paths.lengths[current.pathIndex] as number);
		if (distanceToEnd > limit + STATION_TOLERANCE_METERS) continue;
		enqueueTargets(current.pathIndex, distanceToEnd);
	}
	return false;
}

function continuationGeometryMatches(
	paths: CompiledPhysicalPaths,
	fromPathIndex: number,
	toPathIndex: number,
): boolean {
	const fromPoint = (paths.offsets[fromPathIndex + 1] as number) - 1;
	const toPoint = paths.offsets[toPathIndex] as number;
	if (fromPoint < (paths.offsets[fromPathIndex] as number) || toPoint >= paths.pointCount) {
		return false;
	}
	const endpointDistance = Math.hypot(
		(paths.positions[fromPoint * 2] as number) - (paths.positions[toPoint * 2] as number),
		(paths.positions[fromPoint * 2 + 1] as number) - (paths.positions[toPoint * 2 + 1] as number),
	);
	if (!Number.isFinite(endpointDistance) || endpointDistance > STATION_TOLERANCE_METERS)
		return false;
	const fromTangentX = paths.tangents[fromPoint * 2] as number;
	const fromTangentY = paths.tangents[fromPoint * 2 + 1] as number;
	const toTangentX = paths.tangents[toPoint * 2] as number;
	const toTangentY = paths.tangents[toPoint * 2 + 1] as number;
	const fromLength = Math.hypot(fromTangentX, fromTangentY);
	const toLength = Math.hypot(toTangentX, toTangentY);
	if (
		!Number.isFinite(fromLength) ||
		!Number.isFinite(toLength) ||
		fromLength <= DISTANCE_EPSILON ||
		toLength <= DISTANCE_EPSILON
	) {
		return false;
	}
	const normalizedDot =
		(fromTangentX * toTangentX + fromTangentY * toTangentY) / (fromLength * toLength);
	return Number.isFinite(normalizedDot) && normalizedDot >= 1 - 1e-5;
}

function referenceCells(
	closest: ClosestSegmentPair,
): Pick<PendingIssue, "firstCellX" | "firstCellY" | "secondCellX" | "secondCellY"> {
	return {
		firstCellX: Math.floor(closest.firstX),
		firstCellY: Math.floor(closest.firstY),
		secondCellX: Math.floor(closest.secondX),
		secondCellY: Math.floor(closest.secondY),
	};
}

function normalizeIssueOrder(issue: PendingIssue): PendingIssue {
	if (issue.firstPathIndex < issue.secondPathIndex) return issue;
	return {
		...issue,
		firstPathIndex: issue.secondPathIndex,
		secondPathIndex: issue.firstPathIndex,
		firstEnvelopeIndex: issue.secondEnvelopeIndex,
		secondEnvelopeIndex: issue.firstEnvelopeIndex,
		firstStation: issue.secondStation,
		secondStation: issue.firstStation,
		firstCellX: issue.secondCellX,
		firstCellY: issue.secondCellY,
		secondCellX: issue.firstCellX,
		secondCellY: issue.firstCellY,
	};
}

function compareIssues(left: PendingIssue, right: PendingIssue): number {
	return (
		left.firstPathIndex - right.firstPathIndex ||
		left.secondPathIndex - right.secondPathIndex ||
		left.firstStation - right.firstStation ||
		left.secondStation - right.secondStation ||
		left.code - right.code
	);
}

function coalesceIssueRegions(issues: readonly PendingIssue[]): PendingIssue[] {
	if (issues.length <= 1) return [...issues];
	const ordered = [...issues].sort(
		(left, right) =>
			left.firstEnvelopeIndex - right.firstEnvelopeIndex ||
			left.secondEnvelopeIndex - right.secondEnvelopeIndex,
	);
	const parents = new Uint32Array(ordered.length);
	const pairIndices = new Map<string, number>();
	for (let index = 0; index < ordered.length; index++) {
		parents[index] = index;
		const issue = ordered[index] as PendingIssue;
		for (let firstDelta = -1; firstDelta <= 1; firstDelta++) {
			for (let secondDelta = -1; secondDelta <= 1; secondDelta++) {
				const neighbor = pairIndices.get(
					`${issue.firstEnvelopeIndex + firstDelta}:${issue.secondEnvelopeIndex + secondDelta}`,
				);
				if (neighbor !== undefined) unionIssueRegions(parents, index, neighbor);
			}
		}
		pairIndices.set(`${issue.firstEnvelopeIndex}:${issue.secondEnvelopeIndex}`, index);
	}
	const deepestByRegion = new Map<number, PendingIssue>();
	for (let index = 0; index < ordered.length; index++) {
		const root = findIssueRegion(parents, index);
		const issue = ordered[index] as PendingIssue;
		const previous = deepestByRegion.get(root);
		if (!previous || compareIssueDepth(issue, previous) < 0) deepestByRegion.set(root, issue);
	}
	return [...deepestByRegion.values()];
}

function findIssueRegion(parents: Uint32Array, index: number): number {
	let root = index;
	while ((parents[root] as number) !== root) root = parents[root] as number;
	let cursor = index;
	while ((parents[cursor] as number) !== root) {
		const next = parents[cursor] as number;
		parents[cursor] = root;
		cursor = next;
	}
	return root;
}

function unionIssueRegions(parents: Uint32Array, left: number, right: number): void {
	const leftRoot = findIssueRegion(parents, left);
	const rightRoot = findIssueRegion(parents, right);
	if (leftRoot === rightRoot) return;
	if (leftRoot < rightRoot) parents[rightRoot] = leftRoot;
	else parents[leftRoot] = rightRoot;
}

function compareIssueDepth(left: PendingIssue, right: PendingIssue): number {
	return (
		left.centerlineDistance - right.centerlineDistance ||
		left.firstEnvelopeIndex - right.firstEnvelopeIndex ||
		left.secondEnvelopeIndex - right.secondEnvelopeIndex
	);
}

function compileIssueBuffers(
	paths: CompiledPhysicalPaths,
	issues: readonly PendingIssue[],
	candidateEnvelopePairs: number,
	testedEnvelopePairs: number,
): CompiledRailClearanceIssues {
	const codes = new Uint8Array(issues.length);
	const relations = new Uint8Array(issues.length);
	const firstPathIndices = new Uint32Array(issues.length);
	const secondPathIndices = new Uint32Array(issues.length);
	const firstPathIdentities = new Int32Array(issues.length * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH);
	const secondPathIdentities = new Int32Array(issues.length * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH);
	const firstEnvelopeIndices = new Uint32Array(issues.length);
	const secondEnvelopeIndices = new Uint32Array(issues.length);
	const firstStations = new Float32Array(issues.length);
	const secondStations = new Float32Array(issues.length);
	const contactPoints = new Float32Array(issues.length * 2);
	const centerlineDistances = new Float32Array(issues.length);
	const requiredClearances = new Float32Array(issues.length);
	const penetrationDepths = new Float32Array(issues.length);
	const cells = new Int32Array(issues.length * 4);
	for (let issueIndex = 0; issueIndex < issues.length; issueIndex++) {
		const issue = issues[issueIndex] as PendingIssue;
		codes[issueIndex] = issue.code;
		relations[issueIndex] = issue.relation;
		firstPathIndices[issueIndex] = issue.firstPathIndex;
		secondPathIndices[issueIndex] = issue.secondPathIndex;
		writePathIdentity(firstPathIdentities, issueIndex, paths, issue.firstPathIndex);
		writePathIdentity(secondPathIdentities, issueIndex, paths, issue.secondPathIndex);
		firstEnvelopeIndices[issueIndex] = issue.firstEnvelopeIndex;
		secondEnvelopeIndices[issueIndex] = issue.secondEnvelopeIndex;
		firstStations[issueIndex] = issue.firstStation;
		secondStations[issueIndex] = issue.secondStation;
		contactPoints[issueIndex * 2] = issue.contactX;
		contactPoints[issueIndex * 2 + 1] = issue.contactY;
		centerlineDistances[issueIndex] = issue.centerlineDistance;
		requiredClearances[issueIndex] = issue.requiredClearance;
		penetrationDepths[issueIndex] = issue.penetrationDepth;
		cells[issueIndex * 4] = issue.firstCellX;
		cells[issueIndex * 4 + 1] = issue.firstCellY;
		cells[issueIndex * 4 + 2] = issue.secondCellX;
		cells[issueIndex * 4 + 3] = issue.secondCellY;
	}
	return {
		count: issues.length,
		candidateEnvelopePairs,
		testedEnvelopePairs,
		codes,
		relations,
		firstPathIndices,
		secondPathIndices,
		firstPathIdentities,
		secondPathIdentities,
		firstEnvelopeIndices,
		secondEnvelopeIndices,
		firstStations,
		secondStations,
		contactPoints,
		centerlineDistances,
		requiredClearances,
		penetrationDepths,
		cells,
	};
}

function writePathIdentity(
	target: Int32Array,
	row: number,
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	const offset = row * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH;
	target.set(railClearancePathIdentity(paths, pathIndex), offset);
}

/** Stable, ordering-independent physical-path identity used by draft and Worker diagnostics. */
export function railClearancePathIdentity(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): Int32Array {
	return physicalPathIdentity(paths, pathIndex);
}

function interpolate(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
