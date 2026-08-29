import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND } from "./AdvancedSwitchCompiler";
import { PHYSICAL_PATH_IDENTITY_WIDTH } from "./PhysicalPathIdentity";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";

export const SIMULATION_TRACK_RESOURCE_TOPOLOGY_SCHEMA_VERSION = 1;
export const SIMULATION_TRACK_RESOURCE_PARTITION_PROFILE_ID =
	"OPENFAB_DIRECTED_1M_TRACK_RESOURCES_V1";
export const SIMULATION_TRACK_RESOURCE_MAXIMUM_LENGTH_METERS = 1;

export const SIMULATION_TRACK_RESOURCE_KIND = {
	UNIQUE_PATH: 0,
	SHARED_PHYSICAL: 1,
} as const;

export interface SimulationTrackResourceTopology {
	readonly schemaVersion: typeof SIMULATION_TRACK_RESOURCE_TOPOLOGY_SCHEMA_VERSION;
	/** Track resources alone never authorize a simulation run. */
	readonly simulationReady: false;
	readonly sourceFoundationFingerprint: string;
	readonly partitionProfileId: typeof SIMULATION_TRACK_RESOURCE_PARTITION_PROFILE_ID;
	readonly maximumTrackResourceLengthMeters: number;
	readonly pathCount: number;
	readonly pathLengths: Float32Array;
	readonly trackResourceCount: number;
	readonly trackResourceKinds: Uint8Array;
	readonly trackResourceOwnerPathRows: Uint32Array;
	/** Meaningful only when the corresponding kind is SHARED_PHYSICAL. */
	readonly trackResourceSharedSegmentIds: Uint32Array;
	/** Resource interval in the canonical owner's path-station space. */
	readonly trackResourceStarts: Float32Array;
	readonly trackResourceEnds: Float32Array;
	/** Per-path ordered resource occurrences in that path's station space. */
	readonly pathResourceOffsets: Uint32Array;
	readonly pathResourceRows: Uint32Array;
	readonly pathResourceStarts: Float32Array;
	readonly pathResourceEnds: Float32Array;
	/** One exclusive conflict resource per canonical advanced switch. */
	readonly switchConflictResourceCount: number;
	readonly switchConflictResourceIds: Uint32Array;
	readonly switchConflictLengthsMeters: Float32Array;
	readonly conflictIntervalOffsets: Uint32Array;
	readonly conflictPathRows: Uint32Array;
	readonly conflictPathStarts: Float32Array;
	readonly conflictPathEnds: Float32Array;
	readonly conflictIntervalKinds: Uint8Array;
	readonly conflictRouteIndices: Uint8Array;
	/** Exact track resources covered by each switch conflict interval. */
	readonly conflictTrackResourceOffsets: Uint32Array;
	readonly conflictTrackResourceRows: Uint32Array;
	readonly movementCount: number;
	readonly movementSwitchIds: Uint32Array;
	readonly movementInputIndices: Uint8Array;
	readonly movementOutputIndices: Uint8Array;
	readonly movementConflictResourceRows: Uint32Array;
	readonly movementConflictIntervalOffsets: Uint32Array;
	readonly movementConflictIntervalRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

interface SharedOccurrenceDraft {
	readonly pathRow: number;
	readonly start: number;
	readonly end: number;
}

interface SharedResourceDraft {
	readonly id: number;
	readonly ownerPathRow: number;
	readonly occurrences: SharedOccurrenceDraft[];
}

interface TrackResourceDraft {
	readonly key: string;
	readonly kind: number;
	readonly ownerPathRow: number;
	readonly sharedSegmentId: number;
	readonly start: number;
	readonly end: number;
}

interface PathResourceOccurrenceDraft {
	readonly key: string;
	readonly start: number;
	readonly end: number;
}

const STATION_EPSILON_METERS = 1e-4;

/**
 * Compiles vehicle-neutral track and switch-conflict resources from the immutable static world.
 * Vehicle footprint, acquire/release timing, priority, and deadlock policy remain separate gates.
 */
export function compileSimulationTrackResourceTopology(
	foundation: SimulationStaticWorldFoundation,
): SimulationTrackResourceTopology {
	const foundationError = simulationStaticWorldFoundationError(foundation);
	if (foundationError) {
		throw new Error(`Simulation static-world foundation is invalid: ${foundationError}`);
	}

	const hardBreakpoints = collectHardBreakpoints(foundation);
	const resources: TrackResourceDraft[] = [];
	const occurrencesByPath: PathResourceOccurrenceDraft[][] = Array.from(
		{ length: foundation.paths.pathCount },
		() => [],
	);
	const sharedById = collectSharedResources(foundation);
	appendSharedResources(hardBreakpoints, sharedById, resources, occurrencesByPath);
	appendUniqueResources(foundation, hardBreakpoints, sharedById, resources, occurrencesByPath);
	resources.sort((left, right) => compareResourceDrafts(foundation, left, right));

	const resourceRowByKey = new Map<string, number>();
	for (let row = 0; row < resources.length; row++) {
		const key = (resources[row] as TrackResourceDraft).key;
		if (resourceRowByKey.has(key)) throw new Error(`Duplicate track-resource key ${key}.`);
		resourceRowByKey.set(key, row);
	}
	const pathMapping = compilePathResourceMapping(occurrencesByPath, resourceRowByKey);
	const conflicts = compileSwitchConflictResources(foundation, pathMapping);
	const topologyWithoutIdentity = {
		schemaVersion: SIMULATION_TRACK_RESOURCE_TOPOLOGY_SCHEMA_VERSION,
		simulationReady: false,
		sourceFoundationFingerprint: foundation.fingerprint,
		partitionProfileId: SIMULATION_TRACK_RESOURCE_PARTITION_PROFILE_ID,
		maximumTrackResourceLengthMeters: SIMULATION_TRACK_RESOURCE_MAXIMUM_LENGTH_METERS,
		pathCount: foundation.paths.pathCount,
		pathLengths: foundation.paths.lengths.slice(),
		trackResourceCount: resources.length,
		trackResourceKinds: Uint8Array.from(resources.map((resource) => resource.kind)),
		trackResourceOwnerPathRows: Uint32Array.from(
			resources.map((resource) => resource.ownerPathRow),
		),
		trackResourceSharedSegmentIds: Uint32Array.from(
			resources.map((resource) => resource.sharedSegmentId),
		),
		trackResourceStarts: Float32Array.from(resources.map((resource) => resource.start)),
		trackResourceEnds: Float32Array.from(resources.map((resource) => resource.end)),
		...pathMapping,
		...conflicts,
	} as const;
	const views = simulationTrackResourceTopologyViews(topologyWithoutIdentity);
	const topology = Object.freeze({
		...topologyWithoutIdentity,
		fingerprint: checksumSimulationTrackResourceTopology(topologyWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationTrackResourceTopology;
	const error = simulationTrackResourceTopologyError(topology);
	if (error) throw new Error(`Compiled simulation track-resource topology is invalid: ${error}`);
	return topology;
}

export function checksumSimulationTrackResourceTopology(
	topology: Omit<SimulationTrackResourceTopology, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		topology.schemaVersion,
		topology.simulationReady ? 1 : 0,
		topology.maximumTrackResourceLengthMeters,
		topology.pathCount,
		topology.trackResourceCount,
		topology.switchConflictResourceCount,
		topology.movementCount,
	]);
	checksum.addStrings([topology.sourceFoundationFingerprint, topology.partitionProfileId]);
	checksum.addViews(simulationTrackResourceTopologyViews(topology));
	return checksum.digest();
}

export function simulationTrackResourceTopologyError(value: unknown): string | null {
	if (!isRecord(value)) return "track-resource topology must be an object";
	if (value.schemaVersion !== SIMULATION_TRACK_RESOURCE_TOPOLOGY_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationReady !== false) return "track resources cannot authorize simulation";
	if (!isNonEmptyString(value.sourceFoundationFingerprint)) {
		return "source foundation fingerprint is invalid";
	}
	if (value.partitionProfileId !== SIMULATION_TRACK_RESOURCE_PARTITION_PROFILE_ID) {
		return "partition profile is invalid";
	}
	if (value.maximumTrackResourceLengthMeters !== SIMULATION_TRACK_RESOURCE_MAXIMUM_LENGTH_METERS) {
		return "maximum track-resource length is invalid";
	}
	if (
		!isNonNegativeSafeInteger(value.pathCount) ||
		!isNonNegativeSafeInteger(value.trackResourceCount) ||
		!isNonNegativeSafeInteger(value.switchConflictResourceCount) ||
		!isNonNegativeSafeInteger(value.movementCount)
	) {
		return "resource counts are invalid";
	}
	const pathOccurrenceCount =
		value.pathResourceRows instanceof Uint32Array ? value.pathResourceRows.length : -1;
	const conflictIntervalCount =
		value.conflictPathRows instanceof Uint32Array ? value.conflictPathRows.length : -1;
	const conflictTrackReferenceCount =
		value.conflictTrackResourceRows instanceof Uint32Array
			? value.conflictTrackResourceRows.length
			: -1;
	const movementConflictReferenceCount =
		value.movementConflictIntervalRows instanceof Uint32Array
			? value.movementConflictIntervalRows.length
			: -1;
	if (
		!isFloat32Array(value.pathLengths, value.pathCount) ||
		!isUint8Array(value.trackResourceKinds, value.trackResourceCount) ||
		!isUint32Array(value.trackResourceOwnerPathRows, value.trackResourceCount) ||
		!isUint32Array(value.trackResourceSharedSegmentIds, value.trackResourceCount) ||
		!isFloat32Array(value.trackResourceStarts, value.trackResourceCount) ||
		!isFloat32Array(value.trackResourceEnds, value.trackResourceCount) ||
		!isCsr(value.pathResourceOffsets, value.pathCount, pathOccurrenceCount) ||
		!isUint32Array(value.pathResourceRows, pathOccurrenceCount) ||
		!isFloat32Array(value.pathResourceStarts, pathOccurrenceCount) ||
		!isFloat32Array(value.pathResourceEnds, pathOccurrenceCount)
	) {
		return "track-resource columns are malformed";
	}
	if (
		!isUint32Array(value.switchConflictResourceIds, value.switchConflictResourceCount) ||
		!isFloat32Array(value.switchConflictLengthsMeters, value.switchConflictResourceCount) ||
		!isCsr(
			value.conflictIntervalOffsets,
			value.switchConflictResourceCount,
			conflictIntervalCount,
		) ||
		!isUint32Array(value.conflictPathRows, conflictIntervalCount) ||
		!isFloat32Array(value.conflictPathStarts, conflictIntervalCount) ||
		!isFloat32Array(value.conflictPathEnds, conflictIntervalCount) ||
		!isUint8Array(value.conflictIntervalKinds, conflictIntervalCount) ||
		!isUint8Array(value.conflictRouteIndices, conflictIntervalCount) ||
		!isCsr(
			value.conflictTrackResourceOffsets,
			conflictIntervalCount,
			conflictTrackReferenceCount,
		) ||
		!isUint32Array(value.conflictTrackResourceRows, conflictTrackReferenceCount)
	) {
		return "switch-conflict columns are malformed";
	}
	if (
		!isUint32Array(value.movementSwitchIds, value.movementCount) ||
		!isUint8Array(value.movementInputIndices, value.movementCount) ||
		!isUint8Array(value.movementOutputIndices, value.movementCount) ||
		!isUint32Array(value.movementConflictResourceRows, value.movementCount) ||
		!isCsr(
			value.movementConflictIntervalOffsets,
			value.movementCount,
			movementConflictReferenceCount,
		) ||
		!isUint32Array(value.movementConflictIntervalRows, movementConflictReferenceCount)
	) {
		return "switch-movement columns are malformed";
	}
	const topology = value as unknown as SimulationTrackResourceTopology;
	if (!allFiniteTopologyNumbers(topology)) return "resource numbers must be finite";
	if (
		!rowsWithin(topology.trackResourceOwnerPathRows, topology.pathCount) ||
		!rowsWithin(topology.pathResourceRows, topology.trackResourceCount) ||
		!rowsWithin(topology.conflictPathRows, topology.pathCount) ||
		!rowsWithin(topology.conflictTrackResourceRows, topology.trackResourceCount) ||
		!rowsWithin(topology.movementConflictResourceRows, topology.switchConflictResourceCount) ||
		!rowsWithin(topology.movementConflictIntervalRows, topology.conflictPathRows.length)
	) {
		return "resource references are outside their row domains";
	}
	if (!validTrackResourceCoverage(topology)) return "track-resource coverage is invalid";
	if (!validSwitchConflictTopology(topology)) return "switch-conflict topology is invalid";
	const views = simulationTrackResourceTopologyViews(topology);
	if (!hasDistinctOwnedBuffers(views)) return "typed arrays must own distinct buffers";
	if (!isNonNegativeSafeInteger(value.byteLength) || value.byteLength !== sumByteLengths(views)) {
		return "transfer byte length is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "fingerprint is invalid";
	try {
		if (checksumSimulationTrackResourceTopology(topology) !== topology.fingerprint) {
			return "fingerprint does not match track-resource content";
		}
	} catch {
		return "track-resource fingerprint cannot be recomputed";
	}
	return null;
}

export function isSimulationTrackResourceTopology(
	value: unknown,
): value is SimulationTrackResourceTopology {
	return simulationTrackResourceTopologyError(value) === null;
}

function collectHardBreakpoints(foundation: SimulationStaticWorldFoundation): number[][] {
	const result = Array.from({ length: foundation.paths.pathCount }, (_, pathRow) => [
		0,
		foundation.paths.lengths[pathRow] as number,
	]);
	for (let row = 0; row < foundation.paths.sharedSegmentIds.length; row++) {
		const pathRow = pathRowForCsrItem(foundation.paths.sharedSegmentOffsets, row);
		addBreakpoint(result, foundation, pathRow, foundation.paths.sharedSegmentStarts[row] as number);
		addBreakpoint(result, foundation, pathRow, foundation.paths.sharedSegmentEnds[row] as number);
	}
	for (let row = 0; row < foundation.stations.count; row++) {
		addBreakpoint(
			result,
			foundation,
			foundation.stations.finalPathIndices[row] as number,
			foundation.stations.finalPathStationsMeters[row] as number,
		);
	}
	for (let row = 0; row < foundation.switches.movementPathIndices.length; row++) {
		const pathRow = foundation.switches.movementPathIndices[row] as number;
		addBreakpoint(
			result,
			foundation,
			pathRow,
			foundation.switches.movementPathStarts[row] as number,
		);
		addBreakpoint(result, foundation, pathRow, foundation.switches.movementPathEnds[row] as number);
	}
	for (let row = 0; row < foundation.switches.conflictPathIndices.length; row++) {
		const pathRow = foundation.switches.conflictPathIndices[row] as number;
		addBreakpoint(
			result,
			foundation,
			pathRow,
			foundation.switches.conflictPathStarts[row] as number,
		);
		addBreakpoint(result, foundation, pathRow, foundation.switches.conflictPathEnds[row] as number);
	}
	return result.map((breakpoints, pathRow) => {
		const ordered = dedupeSorted(breakpoints);
		ordered[0] = 0;
		ordered[ordered.length - 1] = foundation.paths.lengths[pathRow] as number;
		return ordered;
	});
}

function addBreakpoint(
	target: number[][],
	foundation: SimulationStaticWorldFoundation,
	pathRow: number,
	station: number,
): void {
	if (pathRow >= foundation.paths.pathCount || !Number.isFinite(station)) return;
	const pathLength = foundation.paths.lengths[pathRow] as number;
	if (station < -STATION_EPSILON_METERS || station > pathLength + STATION_EPSILON_METERS) return;
	target[pathRow]?.push(Math.max(0, Math.min(pathLength, station)));
}

function collectSharedResources(
	foundation: SimulationStaticWorldFoundation,
): SharedResourceDraft[] {
	const byId = new Map<number, SharedResourceDraft>();
	for (let pathRow = 0; pathRow < foundation.paths.pathCount; pathRow++) {
		const start = foundation.paths.sharedSegmentOffsets[pathRow] as number;
		const end = foundation.paths.sharedSegmentOffsets[pathRow + 1] as number;
		for (let row = start; row < end; row++) {
			const id = foundation.paths.sharedSegmentIds[row] as number;
			const ownerPathRow = foundation.paths.sharedOwnerPathRows[row] as number;
			const occurrence = {
				pathRow,
				start: foundation.paths.sharedSegmentStarts[row] as number,
				end: foundation.paths.sharedSegmentEnds[row] as number,
			};
			const shared = byId.get(id);
			if (shared) shared.occurrences.push(occurrence);
			else byId.set(id, { id, ownerPathRow, occurrences: [occurrence] });
		}
	}
	return [...byId.values()].sort((left, right) => left.id - right.id);
}

function appendSharedResources(
	hardBreakpoints: readonly (readonly number[])[],
	sharedResources: readonly SharedResourceDraft[],
	resources: TrackResourceDraft[],
	occurrencesByPath: PathResourceOccurrenceDraft[][],
): void {
	for (const shared of sharedResources) {
		const reference = shared.occurrences[0] as SharedOccurrenceDraft;
		const length = reference.end - reference.start;
		const cuts = [0, length];
		appendEvenInteriorCuts(cuts, 0, length);
		for (const occurrence of shared.occurrences) {
			for (const breakpoint of hardBreakpoints[occurrence.pathRow] ?? []) {
				if (
					breakpoint > occurrence.start + STATION_EPSILON_METERS &&
					breakpoint < occurrence.end - STATION_EPSILON_METERS
				) {
					cuts.push(breakpoint - occurrence.start);
				}
			}
		}
		const orderedCuts = dedupeSorted(cuts);
		orderedCuts[0] = 0;
		orderedCuts[orderedCuts.length - 1] = length;
		const ownerOccurrence = shared.occurrences.find(
			(occurrence) => occurrence.pathRow === shared.ownerPathRow,
		);
		if (!ownerOccurrence) throw new Error(`Shared segment ${shared.id} has no owner occurrence.`);
		for (let slice = 0; slice < orderedCuts.length - 1; slice++) {
			const relativeStart = orderedCuts[slice] as number;
			const relativeEnd = orderedCuts[slice + 1] as number;
			const key = `shared:${shared.id}:${slice}`;
			resources.push({
				key,
				kind: SIMULATION_TRACK_RESOURCE_KIND.SHARED_PHYSICAL,
				ownerPathRow: shared.ownerPathRow,
				sharedSegmentId: shared.id,
				start: ownerOccurrence.start + relativeStart,
				end: ownerOccurrence.start + relativeEnd,
			});
			for (const occurrence of shared.occurrences) {
				occurrencesByPath[occurrence.pathRow]?.push({
					key,
					start: occurrence.start + relativeStart,
					end: occurrence.start + relativeEnd,
				});
			}
		}
	}
}

function appendUniqueResources(
	foundation: SimulationStaticWorldFoundation,
	hardBreakpoints: readonly (readonly number[])[],
	sharedResources: readonly SharedResourceDraft[],
	resources: TrackResourceDraft[],
	occurrencesByPath: PathResourceOccurrenceDraft[][],
): void {
	const sharedByPath: SharedOccurrenceDraft[][] = Array.from(
		{ length: foundation.paths.pathCount },
		() => [],
	);
	for (const shared of sharedResources) {
		for (const occurrence of shared.occurrences) sharedByPath[occurrence.pathRow]?.push(occurrence);
	}
	for (let pathRow = 0; pathRow < foundation.paths.pathCount; pathRow++) {
		const boundaries = [...(hardBreakpoints[pathRow] ?? [])];
		for (const occurrence of sharedByPath[pathRow] ?? []) {
			boundaries.push(occurrence.start, occurrence.end);
		}
		const ordered = dedupeSorted(boundaries);
		let sequence = 0;
		for (let index = 0; index < ordered.length - 1; index++) {
			const start = ordered[index] as number;
			const end = ordered[index + 1] as number;
			if (end - start <= STATION_EPSILON_METERS) continue;
			const midpoint = (start + end) / 2;
			if (
				(sharedByPath[pathRow] ?? []).some(
					(shared) =>
						midpoint > shared.start - STATION_EPSILON_METERS &&
						midpoint < shared.end + STATION_EPSILON_METERS,
				)
			) {
				continue;
			}
			const cuts = [start, end];
			appendEvenInteriorCuts(cuts, start, end);
			const blockCuts = dedupeSorted(cuts);
			for (let block = 0; block < blockCuts.length - 1; block++) {
				const blockStart = blockCuts[block] as number;
				const blockEnd = blockCuts[block + 1] as number;
				const key = `unique:${pathRow}:${sequence++}`;
				resources.push({
					key,
					kind: SIMULATION_TRACK_RESOURCE_KIND.UNIQUE_PATH,
					ownerPathRow: pathRow,
					sharedSegmentId: 0,
					start: blockStart,
					end: blockEnd,
				});
				occurrencesByPath[pathRow]?.push({ key, start: blockStart, end: blockEnd });
			}
		}
	}
}

function appendEvenInteriorCuts(target: number[], start: number, end: number): void {
	const length = end - start;
	const count = Math.max(1, Math.ceil(length / SIMULATION_TRACK_RESOURCE_MAXIMUM_LENGTH_METERS));
	for (let index = 1; index < count; index++) target.push(start + (length * index) / count);
}

function compilePathResourceMapping(
	occurrencesByPath: readonly (readonly PathResourceOccurrenceDraft[])[],
	resourceRowByKey: ReadonlyMap<string, number>,
): Pick<
	SimulationTrackResourceTopology,
	"pathResourceOffsets" | "pathResourceRows" | "pathResourceStarts" | "pathResourceEnds"
> {
	const offsets = new Uint32Array(occurrencesByPath.length + 1);
	const rows: number[] = [];
	const starts: number[] = [];
	const ends: number[] = [];
	for (let pathRow = 0; pathRow < occurrencesByPath.length; pathRow++) {
		offsets[pathRow] = rows.length;
		const occurrences = [...(occurrencesByPath[pathRow] ?? [])].sort(
			(left, right) =>
				left.start - right.start || left.end - right.end || left.key.localeCompare(right.key),
		);
		for (const occurrence of occurrences) {
			const resourceRow = resourceRowByKey.get(occurrence.key);
			if (resourceRow === undefined) throw new Error(`Missing track resource ${occurrence.key}.`);
			rows.push(resourceRow);
			starts.push(occurrence.start);
			ends.push(occurrence.end);
		}
	}
	offsets[occurrencesByPath.length] = rows.length;
	return {
		pathResourceOffsets: offsets,
		pathResourceRows: Uint32Array.from(rows),
		pathResourceStarts: Float32Array.from(starts),
		pathResourceEnds: Float32Array.from(ends),
	};
}

function compileSwitchConflictResources(
	foundation: SimulationStaticWorldFoundation,
	pathMapping: Pick<
		SimulationTrackResourceTopology,
		"pathResourceOffsets" | "pathResourceRows" | "pathResourceStarts" | "pathResourceEnds"
	>,
): Pick<
	SimulationTrackResourceTopology,
	| "switchConflictResourceCount"
	| "switchConflictResourceIds"
	| "switchConflictLengthsMeters"
	| "conflictIntervalOffsets"
	| "conflictPathRows"
	| "conflictPathStarts"
	| "conflictPathEnds"
	| "conflictIntervalKinds"
	| "conflictRouteIndices"
	| "conflictTrackResourceOffsets"
	| "conflictTrackResourceRows"
	| "movementCount"
	| "movementSwitchIds"
	| "movementInputIndices"
	| "movementOutputIndices"
	| "movementConflictResourceRows"
	| "movementConflictIntervalOffsets"
	| "movementConflictIntervalRows"
> {
	const switches = foundation.switches;
	const intervalCount = switches.conflictPathIndices.length;
	const conflictTrackResourceOffsets = new Uint32Array(intervalCount + 1);
	const conflictTrackResourceRows: number[] = [];
	for (let intervalRow = 0; intervalRow < intervalCount; intervalRow++) {
		conflictTrackResourceOffsets[intervalRow] = conflictTrackResourceRows.length;
		const pathRow = switches.conflictPathIndices[intervalRow] as number;
		const intervalStart = switches.conflictPathStarts[intervalRow] as number;
		const intervalEnd = switches.conflictPathEnds[intervalRow] as number;
		const start = pathMapping.pathResourceOffsets[pathRow] as number;
		const end = pathMapping.pathResourceOffsets[pathRow + 1] as number;
		for (let row = start; row < end; row++) {
			const resourceStart = pathMapping.pathResourceStarts[row] as number;
			const resourceEnd = pathMapping.pathResourceEnds[row] as number;
			if (
				resourceEnd <= intervalStart + STATION_EPSILON_METERS ||
				resourceStart >= intervalEnd - STATION_EPSILON_METERS
			) {
				continue;
			}
			if (
				resourceStart < intervalStart - STATION_EPSILON_METERS ||
				resourceEnd > intervalEnd + STATION_EPSILON_METERS
			) {
				throw new Error("A switch conflict interval cuts through a track resource.");
			}
			conflictTrackResourceRows.push(pathMapping.pathResourceRows[row] as number);
		}
	}
	conflictTrackResourceOffsets[intervalCount] = conflictTrackResourceRows.length;

	const movementCount = switches.movementInputIndices.length;
	const movementSwitchIds = new Uint32Array(movementCount);
	const movementConflictResourceRows = new Uint32Array(movementCount);
	for (let switchRow = 0; switchRow < switches.count; switchRow++) {
		const start = switches.movementOffsets[switchRow] as number;
		const end = switches.movementOffsets[switchRow + 1] as number;
		for (let movementRow = start; movementRow < end; movementRow++) {
			movementSwitchIds[movementRow] = switches.ids[switchRow] as number;
			movementConflictResourceRows[movementRow] = switchRow;
		}
	}
	return {
		switchConflictResourceCount: switches.count,
		switchConflictResourceIds: switches.conflictZoneIds.slice(),
		switchConflictLengthsMeters: switches.conflictZoneLengthsMeters.slice(),
		conflictIntervalOffsets: switches.conflictPathOffsets.slice(),
		conflictPathRows: switches.conflictPathIndices.slice(),
		conflictPathStarts: switches.conflictPathStarts.slice(),
		conflictPathEnds: switches.conflictPathEnds.slice(),
		conflictIntervalKinds: switches.conflictIntervalKinds.slice(),
		conflictRouteIndices: switches.conflictRouteIndices.slice(),
		conflictTrackResourceOffsets,
		conflictTrackResourceRows: Uint32Array.from(conflictTrackResourceRows),
		movementCount,
		movementSwitchIds,
		movementInputIndices: switches.movementInputIndices.slice(),
		movementOutputIndices: switches.movementOutputIndices.slice(),
		movementConflictResourceRows,
		movementConflictIntervalOffsets: switches.movementConflictOffsets.slice(),
		movementConflictIntervalRows: switches.movementConflictIntervalIndices.slice(),
	};
}

function compareResourceDrafts(
	foundation: SimulationStaticWorldFoundation,
	left: TrackResourceDraft,
	right: TrackResourceDraft,
): number {
	if (left.kind !== right.kind) return left.kind - right.kind;
	if (left.kind === SIMULATION_TRACK_RESOURCE_KIND.SHARED_PHYSICAL) {
		return left.sharedSegmentId - right.sharedSegmentId || left.start - right.start;
	}
	return (
		compareFoundationPathRows(foundation, left.ownerPathRow, right.ownerPathRow) ||
		left.start - right.start ||
		left.end - right.end
	);
}

function compareFoundationPathRows(
	foundation: SimulationStaticWorldFoundation,
	leftPathRow: number,
	rightPathRow: number,
): number {
	const leftOffset = leftPathRow * PHYSICAL_PATH_IDENTITY_WIDTH;
	const rightOffset = rightPathRow * PHYSICAL_PATH_IDENTITY_WIDTH;
	for (let field = 0; field < PHYSICAL_PATH_IDENTITY_WIDTH; field++) {
		const difference =
			(foundation.paths.identities[leftOffset + field] as number) -
			(foundation.paths.identities[rightOffset + field] as number);
		if (difference !== 0) return difference;
	}
	return 0;
}

function pathRowForCsrItem(offsets: Uint32Array, itemRow: number): number {
	let low = 0;
	let high = offsets.length - 1;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if ((offsets[middle + 1] as number) <= itemRow) low = middle + 1;
		else high = middle;
	}
	return low;
}

function dedupeSorted(values: readonly number[]): number[] {
	const sorted = [...values].sort((left, right) => left - right);
	const result: number[] = [];
	for (const value of sorted) {
		const prior = result.at(-1);
		if (prior === undefined || value - prior > STATION_EPSILON_METERS) result.push(value);
	}
	return result;
}

function validTrackResourceCoverage(topology: SimulationTrackResourceTopology): boolean {
	const occurrenceCounts = new Uint32Array(topology.trackResourceCount);
	const ownerOccurrencePresent = new Uint8Array(topology.trackResourceCount);
	for (let pathRow = 0; pathRow < topology.pathCount; pathRow++) {
		const pathLength = topology.pathLengths[pathRow] as number;
		const start = topology.pathResourceOffsets[pathRow] as number;
		const end = topology.pathResourceOffsets[pathRow + 1] as number;
		let cursor = 0;
		for (let row = start; row < end; row++) {
			const resourceRow = topology.pathResourceRows[row] as number;
			const intervalStart = topology.pathResourceStarts[row] as number;
			const intervalEnd = topology.pathResourceEnds[row] as number;
			if (
				!approximately(intervalStart, cursor) ||
				intervalEnd <= intervalStart + STATION_EPSILON_METERS ||
				intervalEnd > pathLength + STATION_EPSILON_METERS ||
				intervalEnd - intervalStart >
					topology.maximumTrackResourceLengthMeters + STATION_EPSILON_METERS ||
				!approximately(
					intervalEnd - intervalStart,
					(topology.trackResourceEnds[resourceRow] as number) -
						(topology.trackResourceStarts[resourceRow] as number),
				)
			) {
				return false;
			}
			occurrenceCounts[resourceRow] = (occurrenceCounts[resourceRow] as number) + 1;
			if (topology.trackResourceOwnerPathRows[resourceRow] === pathRow) {
				if (
					!approximately(intervalStart, topology.trackResourceStarts[resourceRow] as number) ||
					!approximately(intervalEnd, topology.trackResourceEnds[resourceRow] as number)
				) {
					return false;
				}
				ownerOccurrencePresent[resourceRow] = 1;
			}
			cursor = intervalEnd;
		}
		if (!approximately(cursor, pathLength)) return false;
	}
	for (let resourceRow = 0; resourceRow < topology.trackResourceCount; resourceRow++) {
		const kind = topology.trackResourceKinds[resourceRow] as number;
		const ownerPathRow = topology.trackResourceOwnerPathRows[resourceRow] as number;
		const start = topology.trackResourceStarts[resourceRow] as number;
		const end = topology.trackResourceEnds[resourceRow] as number;
		if (
			start < -STATION_EPSILON_METERS ||
			end <= start + STATION_EPSILON_METERS ||
			end > (topology.pathLengths[ownerPathRow] as number) + STATION_EPSILON_METERS ||
			end - start > topology.maximumTrackResourceLengthMeters + STATION_EPSILON_METERS ||
			ownerOccurrencePresent[resourceRow] !== 1
		) {
			return false;
		}
		if (
			(kind === SIMULATION_TRACK_RESOURCE_KIND.UNIQUE_PATH &&
				occurrenceCounts[resourceRow] !== 1) ||
			(kind === SIMULATION_TRACK_RESOURCE_KIND.SHARED_PHYSICAL &&
				occurrenceCounts[resourceRow] < 2) ||
			(kind !== SIMULATION_TRACK_RESOURCE_KIND.UNIQUE_PATH &&
				kind !== SIMULATION_TRACK_RESOURCE_KIND.SHARED_PHYSICAL)
		) {
			return false;
		}
	}
	return true;
}

function validSwitchConflictTopology(topology: SimulationTrackResourceTopology): boolean {
	const switchIds = new Set(topology.switchConflictResourceIds);
	if (switchIds.size !== topology.switchConflictResourceCount) return false;
	for (let resourceRow = 0; resourceRow < topology.switchConflictResourceCount; resourceRow++) {
		if (
			(topology.switchConflictLengthsMeters[resourceRow] as number) <= STATION_EPSILON_METERS ||
			(topology.conflictIntervalOffsets[resourceRow] as number) ===
				(topology.conflictIntervalOffsets[resourceRow + 1] as number)
		) {
			return false;
		}
	}
	for (let intervalRow = 0; intervalRow < topology.conflictPathRows.length; intervalRow++) {
		const pathRow = topology.conflictPathRows[intervalRow] as number;
		const intervalStart = topology.conflictPathStarts[intervalRow] as number;
		const intervalEnd = topology.conflictPathEnds[intervalRow] as number;
		if (
			intervalStart < -STATION_EPSILON_METERS ||
			intervalEnd <= intervalStart + STATION_EPSILON_METERS ||
			intervalEnd > (topology.pathLengths[pathRow] as number) + STATION_EPSILON_METERS ||
			(topology.conflictIntervalKinds[intervalRow] as number) >
				ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED ||
			(topology.conflictRouteIndices[intervalRow] as number) > 1 ||
			((topology.conflictIntervalKinds[intervalRow] as number) ===
				ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT &&
				(topology.conflictRouteIndices[intervalRow] as number) !== 0)
		) {
			return false;
		}
		const expectedRows: number[] = [];
		let cursor = intervalStart;
		const pathStart = topology.pathResourceOffsets[pathRow] as number;
		const pathEnd = topology.pathResourceOffsets[pathRow + 1] as number;
		for (let row = pathStart; row < pathEnd; row++) {
			const resourceStart = topology.pathResourceStarts[row] as number;
			const resourceEnd = topology.pathResourceEnds[row] as number;
			if (
				resourceEnd <= intervalStart + STATION_EPSILON_METERS ||
				resourceStart >= intervalEnd - STATION_EPSILON_METERS
			) {
				continue;
			}
			if (
				!approximately(resourceStart, cursor) ||
				resourceStart < intervalStart - STATION_EPSILON_METERS ||
				resourceEnd > intervalEnd + STATION_EPSILON_METERS
			) {
				return false;
			}
			expectedRows.push(topology.pathResourceRows[row] as number);
			cursor = resourceEnd;
		}
		if (!approximately(cursor, intervalEnd)) return false;
		const actualStart = topology.conflictTrackResourceOffsets[intervalRow] as number;
		const actualEnd = topology.conflictTrackResourceOffsets[intervalRow + 1] as number;
		if (actualEnd - actualStart !== expectedRows.length) return false;
		for (let index = 0; index < expectedRows.length; index++) {
			if (topology.conflictTrackResourceRows[actualStart + index] !== expectedRows[index]) {
				return false;
			}
		}
	}
	const movementPairsByResource = Array.from(
		{ length: topology.switchConflictResourceCount },
		() => new Set<number>(),
	);
	for (let movementRow = 0; movementRow < topology.movementCount; movementRow++) {
		const resourceRow = topology.movementConflictResourceRows[movementRow] as number;
		const inputIndex = topology.movementInputIndices[movementRow] as number;
		const outputIndex = topology.movementOutputIndices[movementRow] as number;
		if (
			topology.movementSwitchIds[movementRow] !== topology.switchConflictResourceIds[resourceRow] ||
			inputIndex > 1 ||
			outputIndex > 1
		) {
			return false;
		}
		const movementPair = inputIndex * 2 + outputIndex;
		if (movementPairsByResource[resourceRow]?.has(movementPair)) return false;
		movementPairsByResource[resourceRow]?.add(movementPair);
		const intervalDomainStart = topology.conflictIntervalOffsets[resourceRow] as number;
		const intervalDomainEnd = topology.conflictIntervalOffsets[resourceRow + 1] as number;
		const referenceStart = topology.movementConflictIntervalOffsets[movementRow] as number;
		const referenceEnd = topology.movementConflictIntervalOffsets[movementRow + 1] as number;
		if (referenceStart === referenceEnd) return false;
		const seen = new Set<number>();
		const seenKinds = new Set<number>();
		for (let row = referenceStart; row < referenceEnd; row++) {
			const intervalRow = topology.movementConflictIntervalRows[row] as number;
			if (
				intervalRow < intervalDomainStart ||
				intervalRow >= intervalDomainEnd ||
				seen.has(intervalRow)
			) {
				return false;
			}
			seen.add(intervalRow);
			const kind = topology.conflictIntervalKinds[intervalRow] as number;
			const route = topology.conflictRouteIndices[intervalRow] as number;
			if (
				(kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED && route !== inputIndex) ||
				(kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED && route !== outputIndex)
			) {
				return false;
			}
			seenKinds.add(kind);
		}
		if (seenKinds.size !== 3) return false;
	}
	for (const movementPairs of movementPairsByResource) {
		if (movementPairs.size !== 4) return false;
	}
	return true;
}

function simulationTrackResourceTopologyViews(
	topology: Omit<SimulationTrackResourceTopology, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		topology.pathLengths,
		topology.trackResourceKinds,
		topology.trackResourceOwnerPathRows,
		topology.trackResourceSharedSegmentIds,
		topology.trackResourceStarts,
		topology.trackResourceEnds,
		topology.pathResourceOffsets,
		topology.pathResourceRows,
		topology.pathResourceStarts,
		topology.pathResourceEnds,
		topology.switchConflictResourceIds,
		topology.switchConflictLengthsMeters,
		topology.conflictIntervalOffsets,
		topology.conflictPathRows,
		topology.conflictPathStarts,
		topology.conflictPathEnds,
		topology.conflictIntervalKinds,
		topology.conflictRouteIndices,
		topology.conflictTrackResourceOffsets,
		topology.conflictTrackResourceRows,
		topology.movementSwitchIds,
		topology.movementInputIndices,
		topology.movementOutputIndices,
		topology.movementConflictResourceRows,
		topology.movementConflictIntervalOffsets,
		topology.movementConflictIntervalRows,
	];
}

function allFiniteTopologyNumbers(topology: SimulationTrackResourceTopology): boolean {
	return [
		topology.pathLengths,
		topology.trackResourceStarts,
		topology.trackResourceEnds,
		topology.pathResourceStarts,
		topology.pathResourceEnds,
		topology.switchConflictLengthsMeters,
		topology.conflictPathStarts,
		topology.conflictPathEnds,
	].every(allFinite);
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}

function hasDistinctOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBufferLike>();
	for (const view of views) {
		if (
			view.byteOffset !== 0 ||
			view.byteLength !== view.buffer.byteLength ||
			buffers.has(view.buffer)
		) {
			return false;
		}
		buffers.add(view.buffer);
	}
	return true;
}

function rowsWithin(values: Uint32Array, rowCount: number): boolean {
	for (const value of values) if (value >= rowCount) return false;
	return true;
}

function isCsr(offsets: unknown, rowCount: number, itemCount: number): offsets is Uint32Array {
	return (
		Number.isInteger(itemCount) &&
		itemCount >= 0 &&
		isUint32Array(offsets, rowCount + 1) &&
		offsets[0] === 0 &&
		offsets[rowCount] === itemCount &&
		isNonDecreasing(offsets)
	);
}

function isNonDecreasing(values: Uint32Array): boolean {
	for (let index = 1; index < values.length; index++) {
		if ((values[index] as number) < (values[index - 1] as number)) return false;
	}
	return true;
}

function allFinite(values: ArrayLike<number>): boolean {
	for (let index = 0; index < values.length; index++) {
		if (!Number.isFinite(values[index])) return false;
	}
	return true;
}

function approximately(left: number, right: number): boolean {
	return Math.abs(left - right) <= STATION_EPSILON_METERS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32Array(value: unknown, length?: number): value is Uint32Array {
	return value instanceof Uint32Array && (length === undefined || value.length === length);
}

function isUint8Array(value: unknown, length?: number): value is Uint8Array {
	return value instanceof Uint8Array && (length === undefined || value.length === length);
}

function isFloat32Array(value: unknown, length?: number): value is Float32Array {
	return value instanceof Float32Array && (length === undefined || value.length === length);
}
