import { cellKey } from "../core/TileMap";
import {
	ADVANCED_SWITCH_PROFILE_CLASS_CODE,
	type AdvancedSwitchPhysicalSegment,
	type AdvancedSwitchPhysicalVariant,
} from "./AdvancedSwitchPhysicalVariant";
import {
	COMPOUND_CONTROL_ROLE,
	COMPOUND_GEOMETRY_KIND,
	COMPOUND_PROFILE_FIT,
	COMPOUND_PROFILE_TYPE,
	type CompiledCompoundProfiles,
	type CompiledPathIntervalRemap,
	NO_PATH_INTERVAL_TARGET,
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
	type StitchedPhysicalPaths,
} from "./CompoundPhysicalPath";
import {
	type CompiledPhysicalPaths,
	PATH_KIND,
	PHYSICAL_PATH_SOURCE_KIND,
} from "./PhysicalPathCompiler";

const EPSILON = 1e-6;

interface OrderedSyntheticSegment {
	readonly segment: AdvancedSwitchPhysicalSegment;
	readonly profileClassCode: number;
}

interface PathBuffers {
	positions: number[];
	tangents: number[];
	distances: number[];
	offsets: number[];
	kinds: number[];
	cells: number[];
	exitCells: number[];
	fromDirections: number[];
	toDirections: number[];
	lengths: number[];
	bounds: number[];
	startInsets: number[];
	endInsets: number[];
	startExtensions: number[];
	endExtensions: number[];
	coverageOffsets: number[];
	coverageCells: number[];
	sharedSegmentOffsets: number[];
	sharedSegmentIds: number[];
	sharedSegmentStarts: number[];
	sharedSegmentEnds: number[];
	sourceKinds: number[];
	advancedSwitchIds: number[];
	advancedSwitchProfileClasses: number[];
	advancedSwitchSegmentRoles: number[];
	advancedSwitchSegmentPorts: number[];
	advancedSwitchSegmentOrdinals: number[];
	advancedSwitchCatalogProfiles: number[];
}

/**
 * Replace switch-owned cardinal paths with one deterministic synthetic physical subgraph.
 * Raw authored-source indices remain stable; only final physical-path indices are compacted.
 */
export function integrateAdvancedSwitchPhysicalVariants(
	stitched: StitchedPhysicalPaths,
	variants: readonly AdvancedSwitchPhysicalVariant[],
	suppressedSourcePaths: ReadonlySet<number>,
): StitchedPhysicalPaths {
	const sourcePathCount = stitched.primaryTargetPathIndices.length;
	assertInputContracts(stitched, sourcePathCount, suppressedSourcePaths);

	const orderedSegments = orderSyntheticSegments(variants);
	const removedFinalPaths = collectRemovedFinalPaths(
		stitched.primaryTargetPathIndices,
		stitched.paths.pathCount,
		suppressedSourcePaths,
	);
	assertNoMixedFinalPathOwnership(
		stitched.primaryTargetPathIndices,
		removedFinalPaths,
		suppressedSourcePaths,
	);

	const oldToNewPathIndices = new Uint32Array(stitched.paths.pathCount);
	oldToNewPathIndices.fill(NO_PATH_INTERVAL_TARGET);
	let retainedPathCount = 0;
	for (let pathIndex = 0; pathIndex < stitched.paths.pathCount; pathIndex++) {
		if (removedFinalPaths.has(pathIndex)) continue;
		oldToNewPathIndices[pathIndex] = retainedPathCount++;
	}

	const syntheticPathIndexByIdentity = new Map<bigint, number>();
	for (let segmentIndex = 0; segmentIndex < orderedSegments.length; segmentIndex++) {
		const identity = orderedSegments[segmentIndex]?.segment.packedIdentity;
		if (identity === undefined || syntheticPathIndexByIdentity.has(identity)) {
			throw new Error(`Duplicate advanced-switch physical segment identity ${String(identity)}.`);
		}
		syntheticPathIndexByIdentity.set(identity, retainedPathCount + segmentIndex);
	}

	const paths = rebuildPaths(
		stitched.paths,
		oldToNewPathIndices,
		orderedSegments,
		syntheticPathIndexByIdentity,
	);
	const retainedProfiles = reindexProfiles(stitched.profiles, oldToNewPathIndices);
	const profiles = appendSyntheticCompoundProfiles(
		retainedProfiles,
		orderedSegments,
		syntheticPathIndexByIdentity,
		sourcePathCount,
	);
	const primaryTargetPathIndices = reindexPrimaryTargets(
		stitched.primaryTargetPathIndices,
		oldToNewPathIndices,
		suppressedSourcePaths,
	);
	const intervalRemap = rebuildIntervalRemap(
		stitched.intervalRemap,
		oldToNewPathIndices,
		orderedSegments,
		syntheticPathIndexByIdentity,
		suppressedSourcePaths,
	);

	return {
		paths,
		profiles,
		primaryTargetPathIndices,
		intervalRemap,
		mergedPathCount: Math.max(
			0,
			stitched.mergedPathCount - (stitched.profiles.count - retainedProfiles.count),
		),
	};
}

function assertInputContracts(
	stitched: StitchedPhysicalPaths,
	sourcePathCount: number,
	suppressedSourcePaths: ReadonlySet<number>,
): void {
	if (stitched.intervalRemap.sourcePathCount !== sourcePathCount) {
		throw new Error(
			"Advanced-switch integration requires one pre-integration remap source per raw cardinal path.",
		);
	}
	for (const sourcePathIndex of suppressedSourcePaths) {
		if (
			!Number.isInteger(sourcePathIndex) ||
			sourcePathIndex < 0 ||
			sourcePathIndex >= sourcePathCount
		) {
			throw new RangeError(`Suppressed raw source path ${sourcePathIndex} is out of range.`);
		}
	}
	const identityBuffers: readonly ArrayLike<number>[] = [
		stitched.intervalRemap.sourceIdentityKinds,
		stitched.intervalRemap.sourceAdvancedSwitchIds,
		stitched.intervalRemap.sourceAdvancedSwitchProfileClasses,
		stitched.intervalRemap.sourceAdvancedSwitchRoles,
		stitched.intervalRemap.sourceAdvancedSwitchPorts,
		stitched.intervalRemap.sourceAdvancedSwitchSegmentOrdinals,
	];
	if (identityBuffers.some((buffer) => buffer.length !== sourcePathCount)) {
		throw new Error("Advanced-switch integration requires complete source identity metadata.");
	}
}

function collectRemovedFinalPaths(
	primaryTargets: Uint32Array,
	finalPathCount: number,
	suppressedSourcePaths: ReadonlySet<number>,
): Set<number> {
	const removed = new Set<number>();
	for (const sourcePathIndex of suppressedSourcePaths) {
		const targetPathIndex = primaryTargets[sourcePathIndex] as number;
		if (targetPathIndex === NO_PATH_INTERVAL_TARGET) continue;
		if (targetPathIndex >= finalPathCount) {
			throw new Error(
				`Raw source path ${sourcePathIndex} has invalid primary target ${targetPathIndex}.`,
			);
		}
		removed.add(targetPathIndex);
	}
	return removed;
}

function assertNoMixedFinalPathOwnership(
	primaryTargets: Uint32Array,
	removedFinalPaths: ReadonlySet<number>,
	suppressedSourcePaths: ReadonlySet<number>,
): void {
	for (let sourcePathIndex = 0; sourcePathIndex < primaryTargets.length; sourcePathIndex++) {
		if (suppressedSourcePaths.has(sourcePathIndex)) continue;
		const targetPathIndex = primaryTargets[sourcePathIndex] as number;
		if (removedFinalPaths.has(targetPathIndex)) {
			throw new Error(
				`Final path ${targetPathIndex} mixes retained raw source ${sourcePathIndex} with switch-owned sources.`,
			);
		}
	}
}

function orderSyntheticSegments(
	variants: readonly AdvancedSwitchPhysicalVariant[],
): OrderedSyntheticSegment[] {
	const ordered = variants.flatMap((variant) => {
		const profileClassCode = ADVANCED_SWITCH_PROFILE_CLASS_CODE[variant.switchRecord.profileClass];
		return variant.segments.map((segment) => {
			if (
				segment.identity.switchId !== variant.switchRecord.id ||
				segment.identity.profileClass !== variant.switchRecord.profileClass
			) {
				throw new Error(
					`Synthetic segment ${segment.packedIdentity} does not match its advanced-switch owner.`,
				);
			}
			return { segment, profileClassCode };
		});
	});
	ordered.sort(
		(left, right) =>
			left.segment.identity.switchId - right.segment.identity.switchId ||
			left.profileClassCode - right.profileClassCode ||
			left.segment.identity.role - right.segment.identity.role ||
			left.segment.identity.portIndex - right.segment.identity.portIndex ||
			left.segment.identity.segmentOrdinal - right.segment.identity.segmentOrdinal ||
			(left.segment.packedIdentity < right.segment.packedIdentity ? -1 : 1),
	);
	return ordered;
}

function rebuildPaths(
	source: CompiledPhysicalPaths,
	oldToNewPathIndices: Uint32Array,
	orderedSegments: readonly OrderedSyntheticSegment[],
	syntheticPathIndexByIdentity: ReadonlyMap<bigint, number>,
): CompiledPhysicalPaths {
	const buffers = emptyPathBuffers();
	for (let oldPathIndex = 0; oldPathIndex < source.pathCount; oldPathIndex++) {
		if ((oldToNewPathIndices[oldPathIndex] as number) === NO_PATH_INTERVAL_TARGET) continue;
		appendExistingPath(buffers, source, oldPathIndex);
	}

	const sharedIdByKey = allocateSyntheticSharedSegmentIds(source, orderedSegments);
	for (const ordered of orderedSegments) {
		appendSyntheticPath(buffers, ordered, sharedIdByKey);
	}
	finishOffsets(buffers);

	const pathCount = buffers.kinds.length;
	const adjacency = rebuildExplicitAdjacency(
		source,
		oldToNewPathIndices,
		orderedSegments,
		syntheticPathIndexByIdentity,
		pathCount,
	);
	const aggregate = computePathAggregates(
		buffers.lengths,
		buffers.sharedSegmentIds,
		buffers.sharedSegmentStarts,
		buffers.sharedSegmentEnds,
	);

	return {
		revision: source.revision,
		positions: new Float32Array(buffers.positions),
		tangents: new Float32Array(buffers.tangents),
		distances: new Float32Array(buffers.distances),
		offsets: new Uint32Array(buffers.offsets),
		kinds: new Uint8Array(buffers.kinds),
		cells: new Int32Array(buffers.cells),
		exitCells: new Int32Array(buffers.exitCells),
		fromDirections: new Uint8Array(buffers.fromDirections),
		toDirections: new Uint8Array(buffers.toDirections),
		lengths: new Float32Array(buffers.lengths),
		bounds: new Float32Array(buffers.bounds),
		startInsets: new Float32Array(buffers.startInsets),
		endInsets: new Float32Array(buffers.endInsets),
		startExtensions: new Float32Array(buffers.startExtensions),
		endExtensions: new Float32Array(buffers.endExtensions),
		coverageOffsets: new Uint32Array(buffers.coverageOffsets),
		coverageCells: new Int32Array(buffers.coverageCells),
		sharedSegmentOffsets: new Uint32Array(buffers.sharedSegmentOffsets),
		sharedSegmentIds: new Uint32Array(buffers.sharedSegmentIds),
		sharedSegmentStarts: new Float32Array(buffers.sharedSegmentStarts),
		sharedSegmentEnds: new Float32Array(buffers.sharedSegmentEnds),
		sourceKinds: new Uint8Array(buffers.sourceKinds),
		advancedSwitchIds: new Uint32Array(buffers.advancedSwitchIds),
		advancedSwitchProfileClasses: new Uint8Array(buffers.advancedSwitchProfileClasses),
		advancedSwitchSegmentRoles: new Uint8Array(buffers.advancedSwitchSegmentRoles),
		advancedSwitchSegmentPorts: new Uint8Array(buffers.advancedSwitchSegmentPorts),
		advancedSwitchSegmentOrdinals: new Uint16Array(buffers.advancedSwitchSegmentOrdinals),
		advancedSwitchCatalogProfiles: new Uint8Array(buffers.advancedSwitchCatalogProfiles),
		explicitAdjacencyOffsets: adjacency.offsets,
		explicitAdjacencyTargets: adjacency.targets,
		sharedSegmentCount: aggregate.sharedSegmentCount,
		totalLengthMeters: aggregate.totalLengthMeters,
		totalRouteLengthMeters: aggregate.totalRouteLengthMeters,
		pathCount,
		pointCount: buffers.distances.length,
	};
}

function emptyPathBuffers(): PathBuffers {
	return {
		positions: [],
		tangents: [],
		distances: [],
		offsets: [],
		kinds: [],
		cells: [],
		exitCells: [],
		fromDirections: [],
		toDirections: [],
		lengths: [],
		bounds: [],
		startInsets: [],
		endInsets: [],
		startExtensions: [],
		endExtensions: [],
		coverageOffsets: [],
		coverageCells: [],
		sharedSegmentOffsets: [],
		sharedSegmentIds: [],
		sharedSegmentStarts: [],
		sharedSegmentEnds: [],
		sourceKinds: [],
		advancedSwitchIds: [],
		advancedSwitchProfileClasses: [],
		advancedSwitchSegmentRoles: [],
		advancedSwitchSegmentPorts: [],
		advancedSwitchSegmentOrdinals: [],
		advancedSwitchCatalogProfiles: [],
	};
}

function appendExistingPath(
	buffers: PathBuffers,
	source: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	buffers.offsets.push(buffers.distances.length);
	buffers.coverageOffsets.push(buffers.coverageCells.length / 2);
	buffers.sharedSegmentOffsets.push(buffers.sharedSegmentIds.length);
	appendPathPointRange(buffers, source, pathIndex);
	appendPair(buffers.cells, source.cells, pathIndex);
	appendPair(buffers.exitCells, source.exitCells, pathIndex);
	appendQuad(buffers.bounds, source.bounds, pathIndex);
	buffers.kinds.push(source.kinds[pathIndex] as number);
	buffers.fromDirections.push(source.fromDirections[pathIndex] as number);
	buffers.toDirections.push(source.toDirections[pathIndex] as number);
	buffers.lengths.push(source.lengths[pathIndex] as number);
	buffers.startInsets.push(source.startInsets[pathIndex] as number);
	buffers.endInsets.push(source.endInsets[pathIndex] as number);
	buffers.startExtensions.push(source.startExtensions[pathIndex] as number);
	buffers.endExtensions.push(source.endExtensions[pathIndex] as number);
	buffers.sourceKinds.push(source.sourceKinds[pathIndex] as number);
	buffers.advancedSwitchIds.push(source.advancedSwitchIds[pathIndex] as number);
	buffers.advancedSwitchProfileClasses.push(
		source.advancedSwitchProfileClasses[pathIndex] as number,
	);
	buffers.advancedSwitchSegmentRoles.push(source.advancedSwitchSegmentRoles[pathIndex] as number);
	buffers.advancedSwitchSegmentPorts.push(source.advancedSwitchSegmentPorts[pathIndex] as number);
	buffers.advancedSwitchSegmentOrdinals.push(
		source.advancedSwitchSegmentOrdinals[pathIndex] as number,
	);
	buffers.advancedSwitchCatalogProfiles.push(
		source.advancedSwitchCatalogProfiles[pathIndex] as number,
	);
	appendCoverageRange(buffers, source, pathIndex);
	appendSharedSegmentRange(buffers, source, pathIndex);
}

function appendSyntheticPath(
	buffers: PathBuffers,
	ordered: OrderedSyntheticSegment,
	sharedIdByKey: ReadonlyMap<string, number>,
): void {
	const { segment, profileClassCode } = ordered;
	validateSyntheticGeometry(segment);
	buffers.offsets.push(buffers.distances.length);
	buffers.coverageOffsets.push(buffers.coverageCells.length / 2);
	buffers.sharedSegmentOffsets.push(buffers.sharedSegmentIds.length);
	buffers.positions.push(...segment.geometry.positions);
	buffers.tangents.push(...segment.geometry.tangents);
	buffers.distances.push(...segment.geometry.distances);
	buffers.kinds.push(PATH_KIND.ADVANCED_SWITCH_SEGMENT);
	buffers.cells.push(segment.entryCell.x, segment.entryCell.y);
	buffers.exitCells.push(segment.exitCell.x, segment.exitCell.y);
	buffers.fromDirections.push(segment.fromDirection);
	buffers.toDirections.push(segment.toDirection);
	buffers.lengths.push(segment.geometry.length);
	buffers.bounds.push(...segment.geometry.bounds);
	buffers.startInsets.push(0);
	buffers.endInsets.push(0);
	buffers.startExtensions.push(0);
	buffers.endExtensions.push(0);
	const covered = new Set<string>();
	for (const cell of segment.coverage) {
		const key = cellKey(cell.x, cell.y);
		if (covered.has(key)) continue;
		covered.add(key);
		buffers.coverageCells.push(cell.x, cell.y);
	}
	if (segment.sharedEdge !== null) {
		const sharedId = sharedIdByKey.get(syntheticSharedSegmentKey(segment));
		if (sharedId === undefined) {
			throw new Error(`Synthetic segment ${segment.packedIdentity} is missing shared ownership.`);
		}
		const sharedLength = segment.sharedLengthMeters;
		const sharedStart = segment.sharedEdge === "start" ? 0 : segment.geometry.length - sharedLength;
		buffers.sharedSegmentIds.push(sharedId);
		buffers.sharedSegmentStarts.push(sharedStart);
		buffers.sharedSegmentEnds.push(sharedStart + sharedLength);
	}
	buffers.sourceKinds.push(PHYSICAL_PATH_SOURCE_KIND.ADVANCED_SWITCH_SEGMENT);
	buffers.advancedSwitchIds.push(segment.identity.switchId);
	buffers.advancedSwitchProfileClasses.push(profileClassCode);
	buffers.advancedSwitchSegmentRoles.push(segment.identity.role);
	buffers.advancedSwitchSegmentPorts.push(segment.identity.portIndex);
	buffers.advancedSwitchSegmentOrdinals.push(segment.identity.segmentOrdinal);
	buffers.advancedSwitchCatalogProfiles.push(segment.catalogProfileCode);
}

function appendPathPointRange(
	buffers: PathBuffers,
	source: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	const start = source.offsets[pathIndex] as number;
	const end = source.offsets[pathIndex + 1] as number;
	for (let pointIndex = start; pointIndex < end; pointIndex++) {
		buffers.positions.push(
			source.positions[pointIndex * 2] as number,
			source.positions[pointIndex * 2 + 1] as number,
		);
		buffers.tangents.push(
			source.tangents[pointIndex * 2] as number,
			source.tangents[pointIndex * 2 + 1] as number,
		);
		buffers.distances.push(source.distances[pointIndex] as number);
	}
}

function appendCoverageRange(
	buffers: PathBuffers,
	source: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	const start = source.coverageOffsets[pathIndex] as number;
	const end = source.coverageOffsets[pathIndex + 1] as number;
	for (let row = start; row < end; row++) {
		buffers.coverageCells.push(
			source.coverageCells[row * 2] as number,
			source.coverageCells[row * 2 + 1] as number,
		);
	}
}

function appendSharedSegmentRange(
	buffers: PathBuffers,
	source: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	const start = source.sharedSegmentOffsets[pathIndex] as number;
	const end = source.sharedSegmentOffsets[pathIndex + 1] as number;
	for (let row = start; row < end; row++) {
		buffers.sharedSegmentIds.push(source.sharedSegmentIds[row] as number);
		buffers.sharedSegmentStarts.push(source.sharedSegmentStarts[row] as number);
		buffers.sharedSegmentEnds.push(source.sharedSegmentEnds[row] as number);
	}
}

function appendPair(target: number[], source: ArrayLike<number>, row: number): void {
	target.push(source[row * 2] as number, source[row * 2 + 1] as number);
}

function appendQuad(target: number[], source: ArrayLike<number>, row: number): void {
	target.push(
		source[row * 4] as number,
		source[row * 4 + 1] as number,
		source[row * 4 + 2] as number,
		source[row * 4 + 3] as number,
	);
}

function finishOffsets(buffers: PathBuffers): void {
	buffers.offsets.push(buffers.distances.length);
	buffers.coverageOffsets.push(buffers.coverageCells.length / 2);
	buffers.sharedSegmentOffsets.push(buffers.sharedSegmentIds.length);
}

function allocateSyntheticSharedSegmentIds(
	source: CompiledPhysicalPaths,
	orderedSegments: readonly OrderedSyntheticSegment[],
): Map<string, number> {
	let nextId = 0;
	for (const id of source.sharedSegmentIds) nextId = Math.max(nextId, id + 1);
	const result = new Map<string, number>();
	for (const { segment } of orderedSegments) {
		if (segment.sharedEdge === null) continue;
		const key = syntheticSharedSegmentKey(segment);
		if (result.has(key)) continue;
		if (nextId >= NO_PATH_INTERVAL_TARGET) {
			throw new Error("Advanced-switch shared-segment identity exceeds uint32 capacity.");
		}
		result.set(key, nextId++);
	}
	return result;
}

function syntheticSharedSegmentKey(segment: AdvancedSwitchPhysicalSegment): string {
	return `${segment.identity.switchId}:${segment.identity.role}`;
}

function validateSyntheticGeometry(segment: AdvancedSwitchPhysicalSegment): void {
	const { geometry } = segment;
	if (
		!Number.isFinite(geometry.length) ||
		geometry.length <= EPSILON ||
		geometry.distances.length < 2 ||
		geometry.positions.length !== geometry.distances.length * 2 ||
		geometry.tangents.length !== geometry.positions.length ||
		geometry.bounds.length !== 4 ||
		Math.abs((geometry.distances[geometry.distances.length - 1] as number) - geometry.length) >
			EPSILON
	) {
		throw new Error(`Synthetic segment ${segment.packedIdentity} has malformed geometry.`);
	}
	if (
		segment.sharedEdge === null
			? Math.abs(segment.sharedLengthMeters) > EPSILON
			: !Number.isFinite(segment.sharedLengthMeters) ||
				segment.sharedLengthMeters <= EPSILON ||
				segment.sharedLengthMeters > geometry.length + EPSILON
	) {
		throw new Error(`Synthetic segment ${segment.packedIdentity} has invalid shared ownership.`);
	}
}

function rebuildExplicitAdjacency(
	source: CompiledPhysicalPaths,
	oldToNewPathIndices: Uint32Array,
	orderedSegments: readonly OrderedSyntheticSegment[],
	syntheticPathIndexByIdentity: ReadonlyMap<bigint, number>,
	pathCount: number,
): { offsets: Uint32Array; targets: Uint32Array } {
	const rows = Array.from({ length: pathCount }, () => [] as number[]);
	for (let oldPathIndex = 0; oldPathIndex < source.pathCount; oldPathIndex++) {
		const nextPathIndex = oldToNewPathIndices[oldPathIndex] as number;
		if (nextPathIndex === NO_PATH_INTERVAL_TARGET) continue;
		const targets = rows[nextPathIndex] as number[];
		const start = source.explicitAdjacencyOffsets[oldPathIndex] as number;
		const end = source.explicitAdjacencyOffsets[oldPathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const oldTarget = source.explicitAdjacencyTargets[row] as number;
			if (oldTarget >= source.pathCount) {
				throw new Error(`Physical path ${oldPathIndex} has invalid explicit target ${oldTarget}.`);
			}
			const nextTarget = oldToNewPathIndices[oldTarget] as number;
			if (nextTarget !== NO_PATH_INTERVAL_TARGET) targets.push(nextTarget);
		}
	}
	for (const { segment } of orderedSegments) {
		const sourcePathIndex = syntheticPathIndexByIdentity.get(segment.packedIdentity);
		if (sourcePathIndex === undefined) {
			throw new Error(`Synthetic segment ${segment.packedIdentity} has no final path.`);
		}
		const targets = rows[sourcePathIndex] as number[];
		for (const successor of segment.successors) {
			const targetPathIndex = syntheticPathIndexByIdentity.get(successor);
			if (targetPathIndex === undefined) {
				throw new Error(
					`Synthetic segment ${segment.packedIdentity} references missing successor ${successor}.`,
				);
			}
			targets.push(targetPathIndex);
		}
	}

	const offsets = new Uint32Array(pathCount + 1);
	const targets: number[] = [];
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		offsets[pathIndex] = targets.length;
		targets.push(...[...new Set(rows[pathIndex])].sort((left, right) => left - right));
	}
	offsets[pathCount] = targets.length;
	return { offsets, targets: new Uint32Array(targets) };
}

function computePathAggregates(
	lengths: readonly number[],
	sharedIds: readonly number[],
	sharedStarts: readonly number[],
	sharedEnds: readonly number[],
): {
	sharedSegmentCount: number;
	totalLengthMeters: number;
	totalRouteLengthMeters: number;
} {
	const totalRouteLengthMeters = lengths.reduce((sum, length) => sum + length, 0);
	const usage = new Map<number, { count: number; length: number }>();
	for (let row = 0; row < sharedIds.length; row++) {
		const length = (sharedEnds[row] as number) - (sharedStarts[row] as number);
		if (!Number.isFinite(length) || length <= EPSILON) {
			throw new Error(`Shared physical segment row ${row} has invalid stations.`);
		}
		const id = sharedIds[row] as number;
		const previous = usage.get(id);
		usage.set(id, {
			count: (previous?.count ?? 0) + 1,
			length: Math.max(previous?.length ?? 0, length),
		});
	}
	let duplicatedLengthMeters = 0;
	for (const shared of usage.values()) {
		duplicatedLengthMeters += shared.length * Math.max(0, shared.count - 1);
	}
	return {
		sharedSegmentCount: usage.size,
		totalLengthMeters: totalRouteLengthMeters - duplicatedLengthMeters,
		totalRouteLengthMeters,
	};
}

function reindexProfiles(
	source: CompiledCompoundProfiles,
	oldToNewPathIndices: Uint32Array,
): CompiledCompoundProfiles {
	const pathIndices: number[] = [];
	const advancedSwitchIds: number[] = [];
	const types: number[] = [];
	const geometryKinds: number[] = [];
	const fitKinds: number[] = [];
	const nominalProfileIndices: number[] = [];
	const lateralSideSigns: number[] = [];
	const compiledRadiusMillimeters: number[] = [];
	const compiledTurnAngleTenths: number[] = [];
	const compiledLeadInMillimeters: number[] = [];
	const compiledLeadOutMillimeters: number[] = [];
	const compiledMiddleMillimeters: number[] = [];
	const compiledLengthMillimeters: number[] = [];
	const leadInResidualMillimeters: number[] = [];
	const leadOutResidualMillimeters: number[] = [];
	const middleResidualMillimeters: number[] = [];
	const lengthResidualMillimeters: number[] = [];
	const forwardFitDeltaMillimeters: number[] = [];
	const lateralFitDeltaMillimeters: number[] = [];
	const fitReasonMasks: number[] = [];
	const controlOffsets = [0];
	const controlPoints: number[] = [];
	const controlDistances: number[] = [];
	const controlRoles: number[] = [];
	const memberOffsets = [0];
	const memberPathIndices: number[] = [];

	for (let profileIndex = 0; profileIndex < source.count; profileIndex++) {
		const oldPathIndex = source.pathIndices[profileIndex] as number;
		if (oldPathIndex >= oldToNewPathIndices.length) {
			throw new Error(`Compound profile ${profileIndex} has invalid path ${oldPathIndex}.`);
		}
		const nextPathIndex = oldToNewPathIndices[oldPathIndex] as number;
		if (nextPathIndex === NO_PATH_INTERVAL_TARGET) continue;
		pathIndices.push(nextPathIndex);
		advancedSwitchIds.push(source.advancedSwitchIds[profileIndex] as number);
		types.push(source.types[profileIndex] as number);
		geometryKinds.push(source.geometryKinds[profileIndex] as number);
		fitKinds.push(source.fitKinds[profileIndex] as number);
		nominalProfileIndices.push(source.nominalProfileIndices[profileIndex] as number);
		lateralSideSigns.push(source.lateralSideSigns[profileIndex] as number);
		compiledRadiusMillimeters.push(source.compiledRadiusMillimeters[profileIndex] as number);
		compiledTurnAngleTenths.push(source.compiledTurnAngleTenths[profileIndex] as number);
		compiledLeadInMillimeters.push(source.compiledLeadInMillimeters[profileIndex] as number);
		compiledLeadOutMillimeters.push(source.compiledLeadOutMillimeters[profileIndex] as number);
		compiledMiddleMillimeters.push(source.compiledMiddleMillimeters[profileIndex] as number);
		compiledLengthMillimeters.push(source.compiledLengthMillimeters[profileIndex] as number);
		leadInResidualMillimeters.push(source.leadInResidualMillimeters[profileIndex] as number);
		leadOutResidualMillimeters.push(source.leadOutResidualMillimeters[profileIndex] as number);
		middleResidualMillimeters.push(source.middleResidualMillimeters[profileIndex] as number);
		lengthResidualMillimeters.push(source.lengthResidualMillimeters[profileIndex] as number);
		forwardFitDeltaMillimeters.push(source.forwardFitDeltaMillimeters[profileIndex] as number);
		lateralFitDeltaMillimeters.push(source.lateralFitDeltaMillimeters[profileIndex] as number);
		fitReasonMasks.push(source.fitReasonMasks[profileIndex] as number);

		const controlStart = source.controlOffsets[profileIndex] as number;
		const controlEnd = source.controlOffsets[profileIndex + 1] as number;
		for (let row = controlStart; row < controlEnd; row++) {
			controlPoints.push(
				source.controlPoints[row * 2] as number,
				source.controlPoints[row * 2 + 1] as number,
			);
			controlDistances.push(source.controlDistances[row] as number);
			controlRoles.push(source.controlRoles[row] as number);
		}
		controlOffsets.push(controlPoints.length / 2);

		const memberStart = source.memberOffsets[profileIndex] as number;
		const memberEnd = source.memberOffsets[profileIndex + 1] as number;
		// Compound members identify raw authored paths, whose indices remain stable through integration.
		for (let row = memberStart; row < memberEnd; row++) {
			memberPathIndices.push(source.memberPathIndices[row] as number);
		}
		memberOffsets.push(memberPathIndices.length);
	}

	return {
		count: pathIndices.length,
		pathIndices: new Uint32Array(pathIndices),
		advancedSwitchIds: new Uint32Array(advancedSwitchIds),
		types: new Uint8Array(types),
		geometryKinds: new Uint8Array(geometryKinds),
		fitKinds: new Uint8Array(fitKinds),
		nominalProfileIndices: new Int16Array(nominalProfileIndices),
		lateralSideSigns: new Int8Array(lateralSideSigns),
		compiledRadiusMillimeters: new Uint16Array(compiledRadiusMillimeters),
		compiledTurnAngleTenths: new Uint16Array(compiledTurnAngleTenths),
		compiledLeadInMillimeters: new Uint32Array(compiledLeadInMillimeters),
		compiledLeadOutMillimeters: new Uint32Array(compiledLeadOutMillimeters),
		compiledMiddleMillimeters: new Uint32Array(compiledMiddleMillimeters),
		compiledLengthMillimeters: new Uint32Array(compiledLengthMillimeters),
		leadInResidualMillimeters: new Int32Array(leadInResidualMillimeters),
		leadOutResidualMillimeters: new Int32Array(leadOutResidualMillimeters),
		middleResidualMillimeters: new Int32Array(middleResidualMillimeters),
		lengthResidualMillimeters: new Int32Array(lengthResidualMillimeters),
		forwardFitDeltaMillimeters: new Int32Array(forwardFitDeltaMillimeters),
		lateralFitDeltaMillimeters: new Int32Array(lateralFitDeltaMillimeters),
		fitReasonMasks: new Uint8Array(fitReasonMasks),
		controlOffsets: new Uint32Array(controlOffsets),
		controlPoints: new Float32Array(controlPoints),
		controlDistances: new Float32Array(controlDistances),
		controlRoles: new Uint8Array(controlRoles),
		memberOffsets: new Uint32Array(memberOffsets),
		memberPathIndices: new Uint32Array(memberPathIndices),
	};
}

function appendSyntheticCompoundProfiles(
	source: CompiledCompoundProfiles,
	orderedSegments: readonly OrderedSyntheticSegment[],
	syntheticPathIndexByIdentity: ReadonlyMap<bigint, number>,
	ordinarySourcePathCount: number,
): CompiledCompoundProfiles {
	const pathIndices = [...source.pathIndices];
	const advancedSwitchIds = [...source.advancedSwitchIds];
	const types = [...source.types];
	const geometryKinds = [...source.geometryKinds];
	const fitKinds = [...source.fitKinds];
	const nominalProfileIndices = [...source.nominalProfileIndices];
	const lateralSideSigns = [...source.lateralSideSigns];
	const compiledRadiusMillimeters = [...source.compiledRadiusMillimeters];
	const compiledTurnAngleTenths = [...source.compiledTurnAngleTenths];
	const compiledLeadInMillimeters = [...source.compiledLeadInMillimeters];
	const compiledLeadOutMillimeters = [...source.compiledLeadOutMillimeters];
	const compiledMiddleMillimeters = [...source.compiledMiddleMillimeters];
	const compiledLengthMillimeters = [...source.compiledLengthMillimeters];
	const leadInResidualMillimeters = [...source.leadInResidualMillimeters];
	const leadOutResidualMillimeters = [...source.leadOutResidualMillimeters];
	const middleResidualMillimeters = [...source.middleResidualMillimeters];
	const lengthResidualMillimeters = [...source.lengthResidualMillimeters];
	const forwardFitDeltaMillimeters = [...source.forwardFitDeltaMillimeters];
	const lateralFitDeltaMillimeters = [...source.lateralFitDeltaMillimeters];
	const fitReasonMasks = [...source.fitReasonMasks];
	const controlOffsets = [...source.controlOffsets];
	const controlPoints = [...source.controlPoints];
	const controlDistances = [...source.controlDistances];
	const controlRoles = [...source.controlRoles];
	const memberOffsets = [...source.memberOffsets];
	const memberPathIndices = [...source.memberPathIndices];

	for (let segmentIndex = 0; segmentIndex < orderedSegments.length; segmentIndex++) {
		const segment = orderedSegments[segmentIndex]?.segment;
		const geometry = segment?.compoundGeometry;
		if (!segment || !geometry) continue;
		const pathIndex = syntheticPathIndexByIdentity.get(segment.packedIdentity);
		if (pathIndex === undefined) {
			throw new Error(`Synthetic profile ${segment.catalogProfileId} has no final path.`);
		}
		if (geometry.nominalProfileIndex < 0) {
			throw new Error(`Synthetic profile ${segment.catalogProfileId} has no catalog profile.`);
		}
		pathIndices.push(pathIndex);
		advancedSwitchIds.push(segment.identity.switchId);
		types.push(
			geometry.type === "S_CURVE"
				? COMPOUND_PROFILE_TYPE.S_CURVE
				: COMPOUND_PROFILE_TYPE.RIGHT_CURVE,
		);
		geometryKinds.push(COMPOUND_GEOMETRY_KIND.OPENFAB_PARAMETRIC);
		fitKinds.push(
			geometry.fitKind === "MAP_EXACT"
				? COMPOUND_PROFILE_FIT.MAP_EXACT
				: COMPOUND_PROFILE_FIT.GRID_FIT,
		);
		nominalProfileIndices.push(geometry.nominalProfileIndex);
		lateralSideSigns.push(geometry.lateralSideSign);
		compiledRadiusMillimeters.push(geometry.radiusMillimeters);
		compiledTurnAngleTenths.push(geometry.turnAngleTenths);
		compiledLeadInMillimeters.push(geometry.leadInMillimeters);
		compiledLeadOutMillimeters.push(geometry.leadOutMillimeters);
		compiledMiddleMillimeters.push(geometry.middleMillimeters);
		compiledLengthMillimeters.push(geometry.compiledLengthMillimeters);
		leadInResidualMillimeters.push(geometry.leadInResidualMillimeters);
		leadOutResidualMillimeters.push(geometry.leadOutResidualMillimeters);
		middleResidualMillimeters.push(geometry.middleResidualMillimeters);
		lengthResidualMillimeters.push(geometry.lengthResidualMillimeters);
		forwardFitDeltaMillimeters.push(geometry.forwardFitDeltaMillimeters);
		lateralFitDeltaMillimeters.push(geometry.lateralFitDeltaMillimeters);
		fitReasonMasks.push(geometry.fitReasonMask);
		controlPoints.push(...geometry.controlPoints);
		controlDistances.push(...geometry.controlDistances);
		controlRoles.push(
			...(geometry.type === "RIGHT_CURVE"
				? [
						COMPOUND_CONTROL_ROLE.START,
						COMPOUND_CONTROL_ROLE.TMP_FROM,
						COMPOUND_CONTROL_ROLE.TMP_TO,
						COMPOUND_CONTROL_ROLE.END,
					]
				: [
						COMPOUND_CONTROL_ROLE.START,
						COMPOUND_CONTROL_ROLE.TMP_FROM,
						COMPOUND_CONTROL_ROLE.ARC_1_END,
						COMPOUND_CONTROL_ROLE.ARC_2_START,
						COMPOUND_CONTROL_ROLE.TMP_TO,
						COMPOUND_CONTROL_ROLE.END,
					]),
		);
		controlOffsets.push(controlPoints.length / 2);
		memberPathIndices.push(ordinarySourcePathCount + segmentIndex);
		memberOffsets.push(memberPathIndices.length);
	}

	return {
		count: pathIndices.length,
		pathIndices: new Uint32Array(pathIndices),
		advancedSwitchIds: new Uint32Array(advancedSwitchIds),
		types: new Uint8Array(types),
		geometryKinds: new Uint8Array(geometryKinds),
		fitKinds: new Uint8Array(fitKinds),
		nominalProfileIndices: new Int16Array(nominalProfileIndices),
		lateralSideSigns: new Int8Array(lateralSideSigns),
		compiledRadiusMillimeters: new Uint16Array(compiledRadiusMillimeters),
		compiledTurnAngleTenths: new Uint16Array(compiledTurnAngleTenths),
		compiledLeadInMillimeters: new Uint32Array(compiledLeadInMillimeters),
		compiledLeadOutMillimeters: new Uint32Array(compiledLeadOutMillimeters),
		compiledMiddleMillimeters: new Uint32Array(compiledMiddleMillimeters),
		compiledLengthMillimeters: new Uint32Array(compiledLengthMillimeters),
		leadInResidualMillimeters: new Int32Array(leadInResidualMillimeters),
		leadOutResidualMillimeters: new Int32Array(leadOutResidualMillimeters),
		middleResidualMillimeters: new Int32Array(middleResidualMillimeters),
		lengthResidualMillimeters: new Int32Array(lengthResidualMillimeters),
		forwardFitDeltaMillimeters: new Int32Array(forwardFitDeltaMillimeters),
		lateralFitDeltaMillimeters: new Int32Array(lateralFitDeltaMillimeters),
		fitReasonMasks: new Uint8Array(fitReasonMasks),
		controlOffsets: new Uint32Array(controlOffsets),
		controlPoints: new Float32Array(controlPoints),
		controlDistances: new Float32Array(controlDistances),
		controlRoles: new Uint8Array(controlRoles),
		memberOffsets: new Uint32Array(memberOffsets),
		memberPathIndices: new Uint32Array(memberPathIndices),
	};
}

function reindexPrimaryTargets(
	source: Uint32Array,
	oldToNewPathIndices: Uint32Array,
	suppressedSourcePaths: ReadonlySet<number>,
): Uint32Array {
	const result = new Uint32Array(source.length);
	result.fill(NO_PATH_INTERVAL_TARGET);
	for (let sourcePathIndex = 0; sourcePathIndex < source.length; sourcePathIndex++) {
		if (suppressedSourcePaths.has(sourcePathIndex)) continue;
		const oldTarget = source[sourcePathIndex] as number;
		if (oldTarget === NO_PATH_INTERVAL_TARGET) continue;
		if (oldTarget >= oldToNewPathIndices.length) {
			throw new Error(
				`Raw source path ${sourcePathIndex} has invalid primary target ${oldTarget}.`,
			);
		}
		result[sourcePathIndex] = oldToNewPathIndices[oldTarget] as number;
	}
	return result;
}

function rebuildIntervalRemap(
	source: CompiledPathIntervalRemap,
	oldToNewPathIndices: Uint32Array,
	orderedSegments: readonly OrderedSyntheticSegment[],
	syntheticPathIndexByIdentity: ReadonlyMap<bigint, number>,
	suppressedSourcePaths: ReadonlySet<number>,
): CompiledPathIntervalRemap {
	const sourcePathCells = [...source.sourcePathCells];
	const sourcePathKinds = [...source.sourcePathKinds];
	const sourcePathFromDirections = [...source.sourcePathFromDirections];
	const sourcePathToDirections = [...source.sourcePathToDirections];
	const sourceIdentityKinds = [...source.sourceIdentityKinds];
	const sourceAdvancedSwitchIds = [...source.sourceAdvancedSwitchIds];
	const sourceAdvancedSwitchProfileClasses = [...source.sourceAdvancedSwitchProfileClasses];
	const sourceAdvancedSwitchRoles = [...source.sourceAdvancedSwitchRoles];
	const sourceAdvancedSwitchPorts = [...source.sourceAdvancedSwitchPorts];
	const sourceAdvancedSwitchSegmentOrdinals = [...source.sourceAdvancedSwitchSegmentOrdinals];
	const sourcePathCanonicalStarts = [...source.sourcePathCanonicalStarts];
	const sourcePathLengths = [...source.sourcePathLengths];
	const sourcePathOffsets: number[] = [];
	const sourceStarts: number[] = [];
	const sourceEnds: number[] = [];
	const targetPathIndices: number[] = [];
	const targetStarts: number[] = [];
	const targetEnds: number[] = [];
	const mappingKinds: number[] = [];
	const projectionErrors: number[] = [];
	const append = (
		sourceStart: number,
		sourceEnd: number,
		targetPathIndex: number,
		targetStart: number,
		targetEnd: number,
		mappingKind: number,
		projectionError: number,
	): void => {
		sourceStarts.push(sourceStart);
		sourceEnds.push(sourceEnd);
		targetPathIndices.push(targetPathIndex);
		targetStarts.push(targetStart);
		targetEnds.push(targetEnd);
		mappingKinds.push(mappingKind);
		projectionErrors.push(projectionError);
	};

	for (let sourcePathIndex = 0; sourcePathIndex < source.sourcePathCount; sourcePathIndex++) {
		sourcePathOffsets.push(sourceStarts.length);
		const sourceLength = source.sourcePathLengths[sourcePathIndex] as number;
		if (sourceLength <= EPSILON) continue;
		if (suppressedSourcePaths.has(sourcePathIndex)) {
			append(
				0,
				sourceLength,
				NO_PATH_INTERVAL_TARGET,
				0,
				0,
				PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE,
				0,
			);
			continue;
		}
		const rowStart = source.sourcePathOffsets[sourcePathIndex] as number;
		const rowEnd = source.sourcePathOffsets[sourcePathIndex + 1] as number;
		for (let row = rowStart; row < rowEnd; row++) {
			const oldTarget = source.targetPathIndices[row] as number;
			const mappingKind = source.mappingKinds[row] as number;
			const targetless =
				oldTarget === NO_PATH_INTERVAL_TARGET ||
				mappingKind === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE ||
				oldTarget >= oldToNewPathIndices.length ||
				(oldToNewPathIndices[oldTarget] as number) === NO_PATH_INTERVAL_TARGET;
			append(
				source.sourceStarts[row] as number,
				source.sourceEnds[row] as number,
				targetless ? NO_PATH_INTERVAL_TARGET : (oldToNewPathIndices[oldTarget] as number),
				targetless ? 0 : (source.targetStarts[row] as number),
				targetless ? 0 : (source.targetEnds[row] as number),
				targetless ? PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE : mappingKind,
				source.projectionErrors[row] as number,
			);
		}
	}

	for (const { segment, profileClassCode } of orderedSegments) {
		sourcePathOffsets.push(sourceStarts.length);
		sourcePathCells.push(segment.entryCell.x, segment.entryCell.y);
		sourcePathKinds.push(PATH_KIND.ADVANCED_SWITCH_SEGMENT);
		sourcePathFromDirections.push(segment.fromDirection);
		sourcePathToDirections.push(segment.toDirection);
		sourceIdentityKinds.push(PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT);
		sourceAdvancedSwitchIds.push(segment.identity.switchId);
		sourceAdvancedSwitchProfileClasses.push(profileClassCode);
		sourceAdvancedSwitchRoles.push(segment.identity.role);
		sourceAdvancedSwitchPorts.push(segment.identity.portIndex);
		sourceAdvancedSwitchSegmentOrdinals.push(segment.identity.segmentOrdinal);
		sourcePathCanonicalStarts.push(0);
		sourcePathLengths.push(segment.geometry.length);
		const targetPathIndex = syntheticPathIndexByIdentity.get(segment.packedIdentity);
		if (targetPathIndex === undefined) {
			throw new Error(`Synthetic segment ${segment.packedIdentity} has no remap target.`);
		}
		append(
			0,
			segment.geometry.length,
			targetPathIndex,
			0,
			segment.geometry.length,
			PATH_INTERVAL_MAPPING_KIND.IDENTITY,
			0,
		);
	}
	sourcePathOffsets.push(sourceStarts.length);

	return {
		count: sourceStarts.length,
		sourcePathCount: source.sourcePathCount + orderedSegments.length,
		sourcePathCells: new Int32Array(sourcePathCells),
		sourcePathKinds: new Uint8Array(sourcePathKinds),
		sourcePathFromDirections: new Uint8Array(sourcePathFromDirections),
		sourcePathToDirections: new Uint8Array(sourcePathToDirections),
		sourceIdentityKinds: new Uint8Array(sourceIdentityKinds),
		sourceAdvancedSwitchIds: new Uint32Array(sourceAdvancedSwitchIds),
		sourceAdvancedSwitchProfileClasses: new Uint8Array(sourceAdvancedSwitchProfileClasses),
		sourceAdvancedSwitchRoles: new Uint8Array(sourceAdvancedSwitchRoles),
		sourceAdvancedSwitchPorts: new Uint8Array(sourceAdvancedSwitchPorts),
		sourceAdvancedSwitchSegmentOrdinals: new Uint16Array(sourceAdvancedSwitchSegmentOrdinals),
		sourcePathCanonicalStarts: new Float32Array(sourcePathCanonicalStarts),
		sourcePathLengths: new Float32Array(sourcePathLengths),
		sourcePathOffsets: new Uint32Array(sourcePathOffsets),
		sourceStarts: new Float32Array(sourceStarts),
		sourceEnds: new Float32Array(sourceEnds),
		targetPathIndices: new Uint32Array(targetPathIndices),
		targetStarts: new Float32Array(targetStarts),
		targetEnds: new Float32Array(targetEnds),
		mappingKinds: new Uint8Array(mappingKinds),
		projectionErrors: new Float32Array(projectionErrors),
	};
}
