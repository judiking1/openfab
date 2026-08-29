import { type CompiledPhysicalPaths, samplePhysicalPath } from "./PhysicalPathCompiler";
import { comparePhysicalPathIdentity } from "./PhysicalPathIdentity";

export interface PhysicalPathCanonicalOwnership {
	readonly sourceRevision: number;
	readonly pathCount: number;
	readonly sharedOccurrenceCount: number;
	/** Canonical owner path row for every row in sharedSegmentIds. */
	readonly sharedOwnerPathRows: Uint32Array;
	/** CSR offsets into ownedIntervalStarts/Ends, one row per physical path. */
	readonly ownedIntervalOffsets: Uint32Array;
	readonly ownedIntervalStarts: Float32Array;
	readonly ownedIntervalEnds: Float32Array;
	readonly totalOwnedLengthMeters: number;
}

interface SharedOccurrence {
	readonly row: number;
	readonly pathRow: number;
	readonly start: number;
	readonly end: number;
}

interface StationInterval {
	readonly start: number;
	readonly end: number;
}

const STATION_EPSILON_METERS = 1e-4;
const GEOMETRY_EPSILON_METERS = 2e-3;
const TANGENT_DOT_TOLERANCE = 0.999;

/**
 * Compiles one deterministic physical-ownership partition for shared turnout/switch intervals.
 * Route alternatives remain selectable paths, but only the stable owner contributes shared surface.
 */
export function compilePhysicalPathCanonicalOwnership(
	paths: CompiledPhysicalPaths,
): PhysicalPathCanonicalOwnership {
	assertOwnershipSource(paths);
	const occurrencesById = new Map<number, SharedOccurrence[]>();
	const intervalsByPath: SharedOccurrence[][] = Array.from({ length: paths.pathCount }, () => []);

	for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
		const pathLength = paths.lengths[pathRow] as number;
		const rowStart = paths.sharedSegmentOffsets[pathRow] as number;
		const rowEnd = paths.sharedSegmentOffsets[pathRow + 1] as number;
		const idsOnPath = new Set<number>();
		for (let row = rowStart; row < rowEnd; row++) {
			const id = paths.sharedSegmentIds[row] as number;
			if (idsOnPath.has(id)) {
				throw new RangeError(`Physical path ${pathRow} repeats shared segment ${id}.`);
			}
			idsOnPath.add(id);
			const start = paths.sharedSegmentStarts[row] as number;
			const end = paths.sharedSegmentEnds[row] as number;
			if (
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				start < -STATION_EPSILON_METERS ||
				end <= start + STATION_EPSILON_METERS ||
				end > pathLength + STATION_EPSILON_METERS
			) {
				throw new RangeError(`Physical path ${pathRow} has invalid shared interval ${id}.`);
			}
			const occurrence = Object.freeze({
				row,
				pathRow,
				start: Math.max(0, start),
				end: Math.min(pathLength, end),
			});
			intervalsByPath[pathRow]?.push(occurrence);
			const occurrences = occurrencesById.get(id);
			if (occurrences) occurrences.push(occurrence);
			else occurrencesById.set(id, [occurrence]);
		}
	}

	for (let pathRow = 0; pathRow < intervalsByPath.length; pathRow++) {
		const intervals = intervalsByPath[pathRow] as SharedOccurrence[];
		intervals.sort(
			(left, right) => left.start - right.start || left.end - right.end || left.row - right.row,
		);
		for (let index = 1; index < intervals.length; index++) {
			const prior = intervals[index - 1] as SharedOccurrence;
			const current = intervals[index] as SharedOccurrence;
			if (current.start < prior.end - STATION_EPSILON_METERS) {
				throw new RangeError(`Physical path ${pathRow} has overlapping shared intervals.`);
			}
		}
	}

	const sharedOwnerPathRows = new Uint32Array(paths.sharedSegmentIds.length);
	const excludedByPath: StationInterval[][] = Array.from({ length: paths.pathCount }, () => []);
	for (const [id, occurrences] of occurrencesById) {
		validateSharedGeometry(paths, id, occurrences);
		let owner = (occurrences[0] as SharedOccurrence).pathRow;
		for (let index = 1; index < occurrences.length; index++) {
			const candidate = (occurrences[index] as SharedOccurrence).pathRow;
			if (comparePhysicalPathIdentity(paths, candidate, owner) < 0) owner = candidate;
		}
		for (const occurrence of occurrences) {
			sharedOwnerPathRows[occurrence.row] = owner;
			if (occurrence.pathRow !== owner) {
				excludedByPath[occurrence.pathRow]?.push({
					start: occurrence.start,
					end: occurrence.end,
				});
			}
		}
	}

	const ownedIntervalOffsets = new Uint32Array(paths.pathCount + 1);
	const ownedIntervalStarts: number[] = [];
	const ownedIntervalEnds: number[] = [];
	let totalOwnedLengthMeters = 0;
	for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
		ownedIntervalOffsets[pathRow] = ownedIntervalStarts.length;
		const pathLength = paths.lengths[pathRow] as number;
		if (pathLength <= STATION_EPSILON_METERS) continue;
		const excluded = excludedByPath[pathRow] as StationInterval[];
		excluded.sort((left, right) => left.start - right.start || left.end - right.end);
		let cursor = 0;
		for (const interval of excluded) {
			if (interval.start > cursor + STATION_EPSILON_METERS) {
				ownedIntervalStarts.push(cursor);
				ownedIntervalEnds.push(interval.start);
				totalOwnedLengthMeters += interval.start - cursor;
			}
			cursor = Math.max(cursor, interval.end);
		}
		if (cursor < pathLength - STATION_EPSILON_METERS) {
			ownedIntervalStarts.push(cursor);
			ownedIntervalEnds.push(pathLength);
			totalOwnedLengthMeters += pathLength - cursor;
		}
	}
	ownedIntervalOffsets[paths.pathCount] = ownedIntervalStarts.length;
	const lengthTolerance = Math.max(1e-3, Math.abs(paths.totalLengthMeters) * 1e-5);
	if (Math.abs(totalOwnedLengthMeters - paths.totalLengthMeters) > lengthTolerance) {
		throw new RangeError(
			`Canonical physical ownership length ${totalOwnedLengthMeters} does not match ${paths.totalLengthMeters}.`,
		);
	}

	return Object.freeze({
		sourceRevision: paths.revision,
		pathCount: paths.pathCount,
		sharedOccurrenceCount: paths.sharedSegmentIds.length,
		sharedOwnerPathRows,
		ownedIntervalOffsets,
		ownedIntervalStarts: Float32Array.from(ownedIntervalStarts),
		ownedIntervalEnds: Float32Array.from(ownedIntervalEnds),
		totalOwnedLengthMeters,
	});
}

function validateSharedGeometry(
	paths: CompiledPhysicalPaths,
	id: number,
	occurrences: readonly SharedOccurrence[],
): void {
	const reference = occurrences[0] as SharedOccurrence;
	const referenceLength = reference.end - reference.start;
	const sampleRatios = sharedGeometrySampleRatios(paths, occurrences, referenceLength);
	for (let index = 1; index < occurrences.length; index++) {
		const candidate = occurrences[index] as SharedOccurrence;
		const candidateLength = candidate.end - candidate.start;
		if (Math.abs(candidateLength - referenceLength) > STATION_EPSILON_METERS) {
			throw new RangeError(`Shared physical segment ${id} has inconsistent lengths.`);
		}
		for (const ratio of sampleRatios) {
			const referenceSample = samplePhysicalPath(
				paths,
				reference.pathRow,
				reference.start + referenceLength * ratio,
			);
			const candidateSample = samplePhysicalPath(
				paths,
				candidate.pathRow,
				candidate.start + candidateLength * ratio,
			);
			if (!referenceSample || !candidateSample) {
				throw new RangeError(`Shared physical segment ${id} cannot be sampled.`);
			}
			if (
				Math.hypot(referenceSample.x - candidateSample.x, referenceSample.y - candidateSample.y) >
					GEOMETRY_EPSILON_METERS ||
				referenceSample.tangentX * candidateSample.tangentX +
					referenceSample.tangentY * candidateSample.tangentY <
					TANGENT_DOT_TOLERANCE
			) {
				throw new RangeError(`Shared physical segment ${id} has inconsistent geometry.`);
			}
		}
	}
}

function sharedGeometrySampleRatios(
	paths: CompiledPhysicalPaths,
	occurrences: readonly SharedOccurrence[],
	referenceLength: number,
): readonly number[] {
	const ratios = new Set<number>([0, 0.5, 1]);
	for (const occurrence of occurrences) {
		const occurrenceLength = occurrence.end - occurrence.start;
		const pointStart = paths.offsets[occurrence.pathRow] as number;
		const pointEnd = paths.offsets[occurrence.pathRow + 1] as number;
		for (let pointRow = pointStart; pointRow < pointEnd; pointRow++) {
			const station = paths.distances[pointRow] as number;
			if (
				station <= occurrence.start + STATION_EPSILON_METERS ||
				station >= occurrence.end - STATION_EPSILON_METERS
			) {
				continue;
			}
			const ratio = (station - occurrence.start) / occurrenceLength;
			ratios.add(Math.max(0, Math.min(1, ratio)));
		}
	}
	const maximumStepCount = Math.min(2_048, Math.max(1, Math.ceil(referenceLength / 0.125)));
	for (let step = 1; step < maximumStepCount; step++) ratios.add(step / maximumStepCount);
	const ordered = [...ratios].sort((left, right) => left - right);
	const withMidpoints = [...ordered];
	for (let index = 1; index < ordered.length; index++) {
		withMidpoints.push(((ordered[index - 1] as number) + (ordered[index] as number)) / 2);
	}
	return Object.freeze(withMidpoints.sort((left, right) => left - right));
}

function assertOwnershipSource(paths: CompiledPhysicalPaths): void {
	if (!Number.isSafeInteger(paths.pathCount) || paths.pathCount < 0) {
		throw new RangeError("Canonical ownership path count is invalid.");
	}
	if (
		!(paths.lengths instanceof Float32Array) ||
		paths.lengths.length !== paths.pathCount ||
		!(paths.offsets instanceof Uint32Array) ||
		paths.offsets.length !== paths.pathCount + 1 ||
		!(paths.distances instanceof Float32Array) ||
		(paths.offsets[paths.pathCount] as number) !== paths.distances.length ||
		!(paths.sharedSegmentOffsets instanceof Uint32Array) ||
		paths.sharedSegmentOffsets.length !== paths.pathCount + 1 ||
		!(paths.sharedSegmentIds instanceof Uint32Array) ||
		!(paths.sharedSegmentStarts instanceof Float32Array) ||
		!(paths.sharedSegmentEnds instanceof Float32Array) ||
		paths.sharedSegmentStarts.length !== paths.sharedSegmentIds.length ||
		paths.sharedSegmentEnds.length !== paths.sharedSegmentIds.length ||
		(paths.sharedSegmentOffsets[paths.pathCount] as number) !== paths.sharedSegmentIds.length ||
		!Number.isFinite(paths.totalLengthMeters) ||
		paths.totalLengthMeters < 0
	) {
		throw new RangeError("Canonical ownership shared-segment columns are malformed.");
	}
	for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
		const start = paths.sharedSegmentOffsets[pathRow] as number;
		const end = paths.sharedSegmentOffsets[pathRow + 1] as number;
		if (start > end || end > paths.sharedSegmentIds.length) {
			throw new RangeError("Canonical ownership shared-segment offsets are malformed.");
		}
		const length = paths.lengths[pathRow] as number;
		if (!Number.isFinite(length) || length < 0) {
			throw new RangeError(`Physical path ${pathRow} length is invalid.`);
		}
	}
}
