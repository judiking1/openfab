import { ADVANCED_SWITCH_SEGMENT_ROLE } from "../compile/AdvancedSwitchPhysicalVariant";
import { compilePhysicalPathCanonicalOwnership } from "../compile/PhysicalPathCanonicalOwnership";
import {
	NO_ADVANCED_SWITCH_PROFILE_CLASS,
	NO_ADVANCED_SWITCH_SEGMENT_ROLE,
} from "../compile/PhysicalPathCompiler";
import { type CompiledRailPresentation, RAIL_DECORATION_KIND } from "./PhysicalRailPresentation";

export const STATIC_FAB_INSPECTION_3D_SOURCE_SCHEMA_VERSION = 3 as const;
export const STATIC_FAB_INSPECTION_3D_ARTIFACT_SCHEMA_VERSION = 2 as const;
export const STATIC_FAB_INSPECTION_3D_CHUNKED_ARTIFACT_SCHEMA_VERSION = 3 as const;
export const STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS = 32 as const;

export const STATIC_FAB_INSPECTION_3D_GEOMETRY_PROFILE = Object.freeze({
	railBaseElevationMeters: 3,
	bedHeightMeters: 0.08,
	beamHeightMeters: 0.09,
	supportHeightMeters: 0.06,
	supportWidthMeters: 0.05,
	flowLengthMeters: 0.28,
	flowWidthMeters: 0.16,
	flowHeightMeters: 0.04,
});

export interface StaticFabInspection3DSourceProfile {
	readonly bedWidthMeters: number;
	readonly beamCenterOffsetMeters: number;
	readonly beamWidthMeters: number;
	readonly supportHalfSpanMeters: number;
}

/**
 * An owned, renderer-neutral copy of the canonical rail presentation.
 * Every typed array owns a distinct backing buffer so this snapshot may be transferred safely.
 */
export interface StaticFabInspection3DSourceSnapshot {
	readonly schemaVersion: typeof STATIC_FAB_INSPECTION_3D_SOURCE_SCHEMA_VERSION;
	readonly sourceGeneration: number;
	readonly sourceRevision: number;
	readonly pathCount: number;
	readonly pointCount: number;
	readonly decorationCount: number;
	readonly ownedIntervalCount: number;
	readonly profile: StaticFabInspection3DSourceProfile;
	/** Packed source-plane x, z pairs. */
	readonly positions: Float32Array;
	/** Packed source-plane x, z normal pairs. */
	readonly pointNormals: Float32Array;
	/** Per-path station in meters for every source point. */
	readonly distances: Float32Array;
	readonly pathOffsets: Uint32Array;
	/** CSR offsets into ownedIntervalStarts/Ends, one row per source path. */
	readonly ownedIntervalOffsets: Uint32Array;
	readonly ownedIntervalStarts: Float32Array;
	readonly ownedIntervalEnds: Float32Array;
	/** Packed source-plane x, z pairs. */
	readonly decorationPositions: Float32Array;
	/** Packed source-plane x, z tangent pairs. */
	readonly decorationTangents: Float32Array;
	readonly decorationKinds: Uint8Array;
	readonly decorationOwnerPathRows: Uint32Array;
	/** Two uint32 words per decoration. */
	readonly decorationStableIds: Uint32Array;
	/** Canonical physical-path sidecars; the Worker reduces these to one rigid instance per switch. */
	readonly advancedSwitchIds: Uint32Array;
	readonly advancedSwitchProfileClasses: Uint8Array;
	readonly advancedSwitchSegmentRoles: Uint8Array;
	readonly byteLength: number;
}

export interface StaticFabInspection3DMesh {
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly indices: Uint32Array;
	readonly vertexCount: number;
	readonly triangleCount: number;
}

export interface StaticFabInspection3DPickLines {
	/** Two non-indexed XYZ vertices per source path segment. */
	readonly positions: Float32Array;
	/** One source path row per line segment. */
	readonly pathRows: Uint32Array;
	readonly segmentCount: number;
}

export interface StaticFabInspection3DInstances {
	readonly positions: Float32Array;
	readonly tangents: Float32Array;
	readonly pathRows: Uint32Array;
	readonly kinds: Uint8Array;
	/** Two uint32 words per instance. */
	readonly stableIds: Uint32Array;
	readonly count: number;
	readonly halfLengthMeters: number;
	readonly halfWidthMeters: number;
	readonly heightMeters: number;
}

export interface StaticFabInspection3DAdvancedSwitchInstances {
	readonly positions: Float32Array;
	readonly tangents: Float32Array;
	readonly pathRows: Uint32Array;
	readonly switchIds: Uint32Array;
	readonly profileClasses: Uint8Array;
	readonly count: number;
}

export interface StaticFabInspection3DBounds {
	readonly minX: number;
	readonly minY: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly maxZ: number;
}

export interface StaticFabInspection3DArtifactProfile extends StaticFabInspection3DSourceProfile {
	readonly railBaseElevationMeters: number;
	readonly bedHeightMeters: number;
	readonly beamHeightMeters: number;
}

export interface StaticFabInspection3DArtifact {
	readonly schemaVersion: typeof STATIC_FAB_INSPECTION_3D_ARTIFACT_SCHEMA_VERSION;
	readonly sourceGeneration: number;
	readonly sourceRevision: number;
	readonly pathCount: number;
	/** Original canonical source points before shared-interval clipping. */
	readonly pointCount: number;
	readonly runCount: number;
	readonly renderPointCount: number;
	readonly segmentCount: number;
	readonly profile: StaticFabInspection3DArtifactProfile;
	readonly bed: StaticFabInspection3DMesh;
	/** Both rectangular beam prisms in one draw-ready mesh. */
	readonly beams: StaticFabInspection3DMesh;
	readonly pickLines: StaticFabInspection3DPickLines;
	readonly supports: StaticFabInspection3DInstances;
	readonly flows: StaticFabInspection3DInstances;
	readonly bounds: StaticFabInspection3DBounds;
	readonly byteLength: number;
}

export interface StaticFabInspection3DRailChunk {
	readonly worldChunkX: number;
	readonly worldChunkZ: number;
	readonly runCount: number;
	readonly renderPointCount: number;
	readonly segmentCount: number;
	readonly pickSegmentOffset: number;
	readonly bed: StaticFabInspection3DMesh;
	readonly beams: StaticFabInspection3DMesh;
	readonly bounds: StaticFabInspection3DBounds;
}

/**
 * Renderer-neutral schema-v3 artifact used by the product 3D boundary. Rail extrusion is already
 * partitioned in the disposable Worker; the UI may bind a bounded resident subset without slicing
 * or rebuilding geometry on camera motion. Pick rows stay contiguous per chunk in one compact
 * overview buffer so semantic path identity is not duplicated.
 */
export interface StaticFabInspection3DChunkedArtifact {
	readonly schemaVersion: typeof STATIC_FAB_INSPECTION_3D_CHUNKED_ARTIFACT_SCHEMA_VERSION;
	readonly sourceGeneration: number;
	readonly sourceRevision: number;
	readonly pathCount: number;
	readonly pointCount: number;
	readonly runCount: number;
	readonly renderPointCount: number;
	readonly segmentCount: number;
	readonly worldChunkSizeMeters: typeof STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS;
	readonly railChunks: readonly StaticFabInspection3DRailChunk[];
	readonly profile: StaticFabInspection3DArtifactProfile;
	readonly pickLines: StaticFabInspection3DPickLines;
	readonly supports: StaticFabInspection3DInstances;
	readonly flows: StaticFabInspection3DInstances;
	readonly advancedSwitches: StaticFabInspection3DAdvancedSwitchInstances;
	readonly bounds: StaticFabInspection3DBounds;
	readonly byteLength: number;
}

const RING_VERTEX_COUNT = 8;
const CAP_VERTEX_COUNT = 8;
const SEGMENT_INDEX_COUNT = 24;
const PATH_CAP_INDEX_COUNT = 12;
const FLOATS_PER_POSITION = 3;
const FLOATS_PER_SOURCE_POINT = 2;
const PICK_VERTICES_PER_SEGMENT = 2;
const INSTANCE_STABLE_ID_WIDTH = 2;
const NORMAL_MAGNITUDE_TOLERANCE = 0.01;
const STATION_EPSILON_METERS = 1e-5;

interface StaticFabInspection3DOwnedRuns {
	readonly positions: Float32Array;
	readonly pointNormals: Float32Array;
	readonly offsets: Uint32Array;
	readonly pathRows: Uint32Array;
	readonly runCount: number;
	readonly pointCount: number;
	readonly segmentCount: number;
}

interface MutableStaticFabInspection3DChunkRuns {
	readonly worldChunkX: number;
	readonly worldChunkZ: number;
	readonly positions: number[];
	readonly pointNormals: number[];
	readonly offsets: number[];
	readonly pathRows: number[];
	segmentCount: number;
}

/** Capture fresh owned arrays before any Worker transfer can detach them. */
export function captureStaticFabInspection3DSource(
	presentation: CompiledRailPresentation,
	sourceGeneration: number,
): StaticFabInspection3DSourceSnapshot {
	assertNonNegativeSafeInteger(sourceGeneration, "source generation");
	if (!isRecord(presentation) || !isRecord(presentation.source)) {
		throw new TypeError("3D inspection source presentation is malformed.");
	}
	const { source, decorations, profile } = presentation;
	if (
		!(source.positions instanceof Float32Array) ||
		!(source.distances instanceof Float32Array) ||
		!(presentation.pointNormals instanceof Float32Array) ||
		!(source.offsets instanceof Uint32Array) ||
		!isRecord(decorations) ||
		!(decorations.positions instanceof Float32Array) ||
		!(decorations.tangents instanceof Float32Array) ||
		!(decorations.kinds instanceof Uint8Array) ||
		!(decorations.ownerPathIndices instanceof Uint32Array) ||
		!(decorations.stableIds instanceof Uint32Array) ||
		!isRecord(profile)
	) {
		throw new TypeError("3D inspection source presentation arrays are malformed.");
	}

	const ownership = compilePhysicalPathCanonicalOwnership(source);
	const positions = new Float32Array(source.positions);
	const pointNormals = new Float32Array(presentation.pointNormals);
	const distances = new Float32Array(source.distances);
	const pathOffsets = new Uint32Array(source.offsets);
	const ownedIntervalOffsets = new Uint32Array(ownership.ownedIntervalOffsets);
	const ownedIntervalStarts = new Float32Array(ownership.ownedIntervalStarts);
	const ownedIntervalEnds = new Float32Array(ownership.ownedIntervalEnds);
	const decorationPositions = new Float32Array(decorations.positions);
	const decorationTangents = new Float32Array(decorations.tangents);
	const decorationKinds = new Uint8Array(decorations.kinds);
	const decorationOwnerPathRows = new Uint32Array(decorations.ownerPathIndices);
	const decorationStableIds = new Uint32Array(decorations.stableIds);
	const advancedSwitchIds = new Uint32Array(source.advancedSwitchIds);
	const advancedSwitchProfileClasses = new Uint8Array(source.advancedSwitchProfileClasses);
	const advancedSwitchSegmentRoles = new Uint8Array(source.advancedSwitchSegmentRoles);
	const snapshot = {
		schemaVersion: STATIC_FAB_INSPECTION_3D_SOURCE_SCHEMA_VERSION,
		sourceGeneration,
		sourceRevision: source.revision,
		pathCount: source.pathCount,
		pointCount: source.pointCount,
		decorationCount: decorations.count,
		ownedIntervalCount: ownership.ownedIntervalStarts.length,
		profile: Object.freeze({
			bedWidthMeters: profile.bedWidthMeters,
			beamCenterOffsetMeters: profile.beamCenterOffsetMeters,
			beamWidthMeters: profile.beamWidthMeters,
			supportHalfSpanMeters: profile.supportHalfSpanMeters,
		}),
		positions,
		pointNormals,
		distances,
		pathOffsets,
		ownedIntervalOffsets,
		ownedIntervalStarts,
		ownedIntervalEnds,
		decorationPositions,
		decorationTangents,
		decorationKinds,
		decorationOwnerPathRows,
		decorationStableIds,
		advancedSwitchIds,
		advancedSwitchProfileClasses,
		advancedSwitchSegmentRoles,
		byteLength: sumBufferByteLengths([
			positions,
			pointNormals,
			distances,
			pathOffsets,
			ownedIntervalOffsets,
			ownedIntervalStarts,
			ownedIntervalEnds,
			decorationPositions,
			decorationTangents,
			decorationKinds,
			decorationOwnerPathRows,
			decorationStableIds,
			advancedSwitchIds,
			advancedSwitchProfileClasses,
			advancedSwitchSegmentRoles,
		]),
	} as const;
	assertStaticFabInspection3DSourceSnapshot(snapshot);
	return Object.freeze(snapshot);
}

export function compileStaticFabInspection3DArtifactFromPresentation(
	presentation: CompiledRailPresentation,
	sourceGeneration: number,
): StaticFabInspection3DArtifact {
	return compileStaticFabInspection3DArtifact(
		captureStaticFabInspection3DSource(presentation, sourceGeneration),
	);
}

export function compileStaticFabInspection3DArtifact(
	snapshot: StaticFabInspection3DSourceSnapshot,
): StaticFabInspection3DArtifact {
	assertStaticFabInspection3DSourceSnapshot(snapshot);
	const runs = compileOwnedRailRuns(snapshot);
	const segmentCount = runs.segmentCount;
	const geometryProfile = STATIC_FAB_INSPECTION_3D_GEOMETRY_PROFILE;
	const bedBottom = geometryProfile.railBaseElevationMeters;
	const bedTop = bedBottom + geometryProfile.bedHeightMeters;
	const beamBottom = bedTop;
	const beamTop = beamBottom + geometryProfile.beamHeightMeters;
	const bed = compileSweptPrisms(runs, [0], snapshot.profile.bedWidthMeters, bedBottom, bedTop);
	const beams = compileSweptPrisms(
		runs,
		[-snapshot.profile.beamCenterOffsetMeters, snapshot.profile.beamCenterOffsetMeters],
		snapshot.profile.beamWidthMeters,
		beamBottom,
		beamTop,
	);
	const pickLines = compilePickLines(runs, beamTop);
	const supports = compileDecorationInstances(
		snapshot,
		(kind) => kind === RAIL_DECORATION_KIND.SUPPORT,
		bedBottom - geometryProfile.supportHeightMeters / 2,
		snapshot.profile.supportHalfSpanMeters,
		geometryProfile.supportWidthMeters / 2,
		geometryProfile.supportHeightMeters,
	);
	const flows = compileDecorationInstances(
		snapshot,
		(kind) => kind === RAIL_DECORATION_KIND.FLOW || kind === RAIL_DECORATION_KIND.FLOW_COMPACT,
		beamTop + geometryProfile.flowHeightMeters / 2,
		geometryProfile.flowLengthMeters / 2,
		geometryProfile.flowWidthMeters / 2,
		geometryProfile.flowHeightMeters,
	);
	const profile = Object.freeze({
		...snapshot.profile,
		railBaseElevationMeters: geometryProfile.railBaseElevationMeters,
		bedHeightMeters: geometryProfile.bedHeightMeters,
		beamHeightMeters: geometryProfile.beamHeightMeters,
	});
	const bounds = compileArtifactBounds(bed, beams, supports, flows);
	const artifactWithoutBytes = {
		schemaVersion: STATIC_FAB_INSPECTION_3D_ARTIFACT_SCHEMA_VERSION,
		sourceGeneration: snapshot.sourceGeneration,
		sourceRevision: snapshot.sourceRevision,
		pathCount: snapshot.pathCount,
		pointCount: snapshot.pointCount,
		runCount: runs.runCount,
		renderPointCount: runs.pointCount,
		segmentCount,
		profile,
		bed,
		beams,
		pickLines,
		supports,
		flows,
		bounds,
	} as const;
	const artifact = {
		...artifactWithoutBytes,
		byteLength: sumBufferByteLengths(artifactViews(artifactWithoutBytes)),
	};
	if (!isStaticFabInspection3DArtifact(artifact)) {
		throw new Error("Compiled 3D inspection artifact failed its structural validation.");
	}
	return Object.freeze(artifact);
}

export function compileStaticFabInspection3DChunkedArtifact(
	snapshot: StaticFabInspection3DSourceSnapshot,
): StaticFabInspection3DChunkedArtifact {
	assertStaticFabInspection3DSourceSnapshot(snapshot);
	const ownedRuns = compileOwnedRailRuns(snapshot);
	const chunkRuns = partitionOwnedRailRunsByWorldChunk(ownedRuns);
	const geometryProfile = STATIC_FAB_INSPECTION_3D_GEOMETRY_PROFILE;
	const bedBottom = geometryProfile.railBaseElevationMeters;
	const bedTop = bedBottom + geometryProfile.bedHeightMeters;
	const beamBottom = bedTop;
	const beamTop = beamBottom + geometryProfile.beamHeightMeters;
	const publicChunks: StaticFabInspection3DRailChunk[] = [];
	const pickPositions = new Float32Array(
		checkedMultiply(
			ownedRuns.segmentCount,
			PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION,
			"chunked pick line scalars",
		),
	);
	const pickPathRows = new Uint32Array(ownedRuns.segmentCount);
	let pickSegmentOffset = 0;
	let runCount = 0;
	let renderPointCount = 0;
	let segmentCount = 0;

	for (const chunkRun of chunkRuns) {
		const bed = compileSweptPrisms(
			chunkRun,
			[0],
			snapshot.profile.bedWidthMeters,
			bedBottom,
			bedTop,
		);
		const beams = compileSweptPrisms(
			chunkRun,
			[-snapshot.profile.beamCenterOffsetMeters, snapshot.profile.beamCenterOffsetMeters],
			snapshot.profile.beamWidthMeters,
			beamBottom,
			beamTop,
		);
		const chunkPickLines = compilePickLines(chunkRun, beamTop);
		pickPositions.set(
			chunkPickLines.positions,
			pickSegmentOffset * PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION,
		);
		pickPathRows.set(chunkPickLines.pathRows, pickSegmentOffset);
		const bounds = compileRailChunkBounds(bed, beams);
		publicChunks.push(
			Object.freeze({
				worldChunkX: chunkRun.worldChunkX,
				worldChunkZ: chunkRun.worldChunkZ,
				runCount: chunkRun.runCount,
				renderPointCount: chunkRun.pointCount,
				segmentCount: chunkRun.segmentCount,
				pickSegmentOffset,
				bed,
				beams,
				bounds,
			}),
		);
		pickSegmentOffset += chunkRun.segmentCount;
		runCount += chunkRun.runCount;
		renderPointCount += chunkRun.pointCount;
		segmentCount += chunkRun.segmentCount;
	}
	if (pickSegmentOffset !== ownedRuns.segmentCount || segmentCount !== ownedRuns.segmentCount) {
		throw new Error("3D inspection chunk partition changed the owned rail segment count.");
	}
	const pickLines = Object.freeze({
		positions: pickPositions,
		pathRows: pickPathRows,
		segmentCount,
	});
	const supports = compileDecorationInstances(
		snapshot,
		(kind) => kind === RAIL_DECORATION_KIND.SUPPORT,
		bedBottom - geometryProfile.supportHeightMeters / 2,
		snapshot.profile.supportHalfSpanMeters,
		geometryProfile.supportWidthMeters / 2,
		geometryProfile.supportHeightMeters,
	);
	const flows = compileDecorationInstances(
		snapshot,
		(kind) => kind === RAIL_DECORATION_KIND.FLOW || kind === RAIL_DECORATION_KIND.FLOW_COMPACT,
		beamTop + geometryProfile.flowHeightMeters / 2,
		geometryProfile.flowLengthMeters / 2,
		geometryProfile.flowWidthMeters / 2,
		geometryProfile.flowHeightMeters,
	);
	const advancedSwitches = compileAdvancedSwitchInstances(snapshot, beamTop + 0.11);
	const profile = Object.freeze({
		...snapshot.profile,
		railBaseElevationMeters: geometryProfile.railBaseElevationMeters,
		bedHeightMeters: geometryProfile.bedHeightMeters,
		beamHeightMeters: geometryProfile.beamHeightMeters,
	});
	const bounds = compileChunkedArtifactBounds(publicChunks, supports, flows, advancedSwitches);
	const artifactWithoutBytes = {
		schemaVersion: STATIC_FAB_INSPECTION_3D_CHUNKED_ARTIFACT_SCHEMA_VERSION,
		sourceGeneration: snapshot.sourceGeneration,
		sourceRevision: snapshot.sourceRevision,
		pathCount: snapshot.pathCount,
		pointCount: snapshot.pointCount,
		runCount,
		renderPointCount,
		segmentCount,
		worldChunkSizeMeters: STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS,
		railChunks: Object.freeze(publicChunks),
		profile,
		pickLines,
		supports,
		flows,
		advancedSwitches,
		bounds,
	} as const;
	const artifact = Object.freeze({
		...artifactWithoutBytes,
		byteLength: sumBufferByteLengths(chunkedArtifactViews(artifactWithoutBytes)),
	});
	if (!isStaticFabInspection3DChunkedArtifact(artifact)) {
		throw new Error("Compiled chunked 3D inspection artifact failed structural validation.");
	}
	return artifact;
}

export function isStaticFabInspection3DSourceSnapshot(
	value: unknown,
): value is StaticFabInspection3DSourceSnapshot {
	if (
		!isRecord(value) ||
		value.schemaVersion !== STATIC_FAB_INSPECTION_3D_SOURCE_SCHEMA_VERSION ||
		!isNonNegativeSafeInteger(value.sourceGeneration) ||
		!isNonNegativeSafeInteger(value.sourceRevision) ||
		!isNonNegativeSafeInteger(value.pathCount) ||
		!isNonNegativeSafeInteger(value.pointCount) ||
		!isNonNegativeSafeInteger(value.decorationCount) ||
		!isNonNegativeSafeInteger(value.ownedIntervalCount) ||
		!isNonNegativeSafeInteger(value.byteLength) ||
		!isSourceProfile(value.profile) ||
		!(value.positions instanceof Float32Array) ||
		!(value.pointNormals instanceof Float32Array) ||
		!(value.distances instanceof Float32Array) ||
		!(value.pathOffsets instanceof Uint32Array) ||
		!(value.ownedIntervalOffsets instanceof Uint32Array) ||
		!(value.ownedIntervalStarts instanceof Float32Array) ||
		!(value.ownedIntervalEnds instanceof Float32Array) ||
		!(value.decorationPositions instanceof Float32Array) ||
		!(value.decorationTangents instanceof Float32Array) ||
		!(value.decorationKinds instanceof Uint8Array) ||
		!(value.decorationOwnerPathRows instanceof Uint32Array) ||
		!(value.decorationStableIds instanceof Uint32Array) ||
		!(value.advancedSwitchIds instanceof Uint32Array) ||
		!(value.advancedSwitchProfileClasses instanceof Uint8Array) ||
		!(value.advancedSwitchSegmentRoles instanceof Uint8Array)
	) {
		return false;
	}
	const snapshot = value as unknown as StaticFabInspection3DSourceSnapshot;
	if (
		snapshot.positions.length !== snapshot.pointCount * FLOATS_PER_SOURCE_POINT ||
		snapshot.pointNormals.length !== snapshot.pointCount * FLOATS_PER_SOURCE_POINT ||
		snapshot.distances.length !== snapshot.pointCount ||
		snapshot.pathOffsets.length !== snapshot.pathCount + 1 ||
		snapshot.ownedIntervalOffsets.length !== snapshot.pathCount + 1 ||
		snapshot.ownedIntervalStarts.length !== snapshot.ownedIntervalCount ||
		snapshot.ownedIntervalEnds.length !== snapshot.ownedIntervalCount ||
		snapshot.decorationPositions.length !== snapshot.decorationCount * FLOATS_PER_SOURCE_POINT ||
		snapshot.decorationTangents.length !== snapshot.decorationCount * FLOATS_PER_SOURCE_POINT ||
		snapshot.decorationKinds.length !== snapshot.decorationCount ||
		snapshot.decorationOwnerPathRows.length !== snapshot.decorationCount ||
		snapshot.decorationStableIds.length !== snapshot.decorationCount * INSTANCE_STABLE_ID_WIDTH ||
		snapshot.advancedSwitchIds.length !== snapshot.pathCount ||
		snapshot.advancedSwitchProfileClasses.length !== snapshot.pathCount ||
		snapshot.advancedSwitchSegmentRoles.length !== snapshot.pathCount ||
		!hasOwnedDistinctBuffers(sourceViews(snapshot)) ||
		snapshot.byteLength !== sumBufferByteLengths(sourceViews(snapshot)) ||
		!hasValidPathOffsets(snapshot) ||
		!hasValidAdvancedSwitchMetadata(snapshot) ||
		!hasValidOwnedIntervals(snapshot) ||
		!allFinite(snapshot.positions) ||
		!allFinite(snapshot.distances) ||
		!hasUnitPairs(snapshot.pointNormals) ||
		!allFinite(snapshot.decorationPositions) ||
		!hasNonZeroFinitePairs(snapshot.decorationTangents)
	) {
		return false;
	}
	for (let index = 0; index < snapshot.decorationCount; index++) {
		if (
			(snapshot.decorationKinds[index] as number) > RAIL_DECORATION_KIND.FLOW_COMPACT ||
			(snapshot.decorationOwnerPathRows[index] as number) >= snapshot.pathCount
		) {
			return false;
		}
	}
	return true;
}

function hasValidAdvancedSwitchMetadata(snapshot: StaticFabInspection3DSourceSnapshot): boolean {
	const profileBySwitchId = new Map<number, number>();
	const throatCountBySwitchId = new Map<number, number>();
	for (let pathRow = 0; pathRow < snapshot.pathCount; pathRow++) {
		const switchId = snapshot.advancedSwitchIds[pathRow] as number;
		const profileClass = snapshot.advancedSwitchProfileClasses[pathRow] as number;
		const role = snapshot.advancedSwitchSegmentRoles[pathRow] as number;
		if (switchId === 0) {
			if (
				profileClass !== NO_ADVANCED_SWITCH_PROFILE_CLASS ||
				role !== NO_ADVANCED_SWITCH_SEGMENT_ROLE
			) {
				return false;
			}
			continue;
		}
		if (
			switchId > 0x7fff_ffff ||
			profileClass > 3 ||
			(role !== ADVANCED_SWITCH_SEGMENT_ROLE.INPUT &&
				role !== ADVANCED_SWITCH_SEGMENT_ROLE.THROAT &&
				role !== ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT)
		) {
			return false;
		}
		const priorProfileClass = profileBySwitchId.get(switchId);
		if (priorProfileClass !== undefined && priorProfileClass !== profileClass) return false;
		profileBySwitchId.set(switchId, profileClass);
		if (role === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT) {
			throatCountBySwitchId.set(switchId, (throatCountBySwitchId.get(switchId) ?? 0) + 1);
		}
	}
	for (const switchId of profileBySwitchId.keys()) {
		if (throatCountBySwitchId.get(switchId) !== 1) return false;
	}
	return true;
}

export function isStaticFabInspection3DArtifact(
	value: unknown,
): value is StaticFabInspection3DArtifact {
	if (
		!isRecord(value) ||
		value.schemaVersion !== STATIC_FAB_INSPECTION_3D_ARTIFACT_SCHEMA_VERSION ||
		!isNonNegativeSafeInteger(value.sourceGeneration) ||
		!isNonNegativeSafeInteger(value.sourceRevision) ||
		!isNonNegativeSafeInteger(value.pathCount) ||
		!isNonNegativeSafeInteger(value.pointCount) ||
		!isNonNegativeSafeInteger(value.runCount) ||
		!isNonNegativeSafeInteger(value.renderPointCount) ||
		!isNonNegativeSafeInteger(value.segmentCount) ||
		!isNonNegativeSafeInteger(value.byteLength) ||
		!isArtifactProfile(value.profile) ||
		!isFiniteBounds(value.bounds) ||
		!isMesh(value.bed) ||
		!isMesh(value.beams) ||
		!isPickLines(value.pickLines) ||
		!isInstances(value.supports) ||
		!isInstances(value.flows)
	) {
		return false;
	}
	const artifact = value as unknown as StaticFabInspection3DArtifact;
	const perPrismVertices =
		artifact.renderPointCount * RING_VERTEX_COUNT + artifact.runCount * CAP_VERTEX_COUNT;
	const perPrismIndices =
		artifact.segmentCount * SEGMENT_INDEX_COUNT + artifact.runCount * PATH_CAP_INDEX_COUNT;
	if (
		artifact.renderPointCount !== artifact.segmentCount + artifact.runCount ||
		artifact.runCount > artifact.pathCount + artifact.segmentCount ||
		artifact.bed.vertexCount !== perPrismVertices ||
		artifact.bed.indices.length !== perPrismIndices ||
		artifact.beams.vertexCount !== perPrismVertices * 2 ||
		artifact.beams.indices.length !== perPrismIndices * 2 ||
		artifact.pickLines.segmentCount !== artifact.segmentCount ||
		artifact.pickLines.positions.length !==
			artifact.segmentCount * PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION ||
		artifact.pickLines.pathRows.length !== artifact.segmentCount ||
		!rowsWithinPathCount(artifact.pickLines.pathRows, artifact.pathCount) ||
		!rowsWithinPathCount(artifact.supports.pathRows, artifact.pathCount) ||
		!rowsWithinPathCount(artifact.flows.pathRows, artifact.pathCount)
	) {
		return false;
	}
	const views = artifactViews(artifact);
	return (
		hasOwnedDistinctBuffers(views) &&
		artifact.byteLength === sumBufferByteLengths(views) &&
		allFinite(artifact.pickLines.positions)
	);
}

/**
 * Constant-time adoption guard for an artifact that the OpenFab Worker already validated in full.
 * Structured clone preserves scalar values and typed-array bytes, so the UI thread only needs to
 * recheck the transfer envelope and request identity instead of rescanning every vertex/index.
 */
export function isStaticFabInspection3DArtifactTransferEnvelope(
	value: unknown,
): value is StaticFabInspection3DArtifact {
	if (
		!isRecord(value) ||
		value.schemaVersion !== STATIC_FAB_INSPECTION_3D_ARTIFACT_SCHEMA_VERSION ||
		!isNonNegativeSafeInteger(value.sourceGeneration) ||
		!isNonNegativeSafeInteger(value.sourceRevision) ||
		!isNonNegativeSafeInteger(value.pathCount) ||
		!isNonNegativeSafeInteger(value.pointCount) ||
		!isNonNegativeSafeInteger(value.runCount) ||
		!isNonNegativeSafeInteger(value.renderPointCount) ||
		!isNonNegativeSafeInteger(value.segmentCount) ||
		!isNonNegativeSafeInteger(value.byteLength) ||
		!isArtifactProfile(value.profile) ||
		!isFiniteBounds(value.bounds) ||
		!isMeshTransferEnvelope(value.bed) ||
		!isMeshTransferEnvelope(value.beams) ||
		!isPickLinesTransferEnvelope(value.pickLines) ||
		!isInstancesTransferEnvelope(value.supports) ||
		!isInstancesTransferEnvelope(value.flows)
	) {
		return false;
	}
	const artifact = value as unknown as StaticFabInspection3DArtifact;
	const perPrismVertices =
		artifact.renderPointCount * RING_VERTEX_COUNT + artifact.runCount * CAP_VERTEX_COUNT;
	const perPrismIndices =
		artifact.segmentCount * SEGMENT_INDEX_COUNT + artifact.runCount * PATH_CAP_INDEX_COUNT;
	if (
		!Number.isSafeInteger(perPrismVertices) ||
		!Number.isSafeInteger(perPrismIndices) ||
		artifact.renderPointCount !== artifact.segmentCount + artifact.runCount ||
		artifact.runCount > artifact.pathCount + artifact.segmentCount ||
		artifact.bed.vertexCount !== perPrismVertices ||
		artifact.bed.indices.length !== perPrismIndices ||
		artifact.beams.vertexCount !== perPrismVertices * 2 ||
		artifact.beams.indices.length !== perPrismIndices * 2 ||
		artifact.pickLines.segmentCount !== artifact.segmentCount ||
		artifact.pickLines.positions.length !==
			artifact.segmentCount * PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION ||
		artifact.pickLines.pathRows.length !== artifact.segmentCount
	) {
		return false;
	}
	const views = artifactViews(artifact);
	return hasOwnedDistinctBuffers(views) && artifact.byteLength === sumBufferByteLengths(views);
}

export function isStaticFabInspection3DChunkedArtifact(
	value: unknown,
): value is StaticFabInspection3DChunkedArtifact {
	return validateStaticFabInspection3DChunkedArtifact(value, true);
}

/** Constant-work-per-chunk UI adoption guard; vertex and index bytes were fully checked in Worker. */
export function isStaticFabInspection3DChunkedArtifactTransferEnvelope(
	value: unknown,
): value is StaticFabInspection3DChunkedArtifact {
	return validateStaticFabInspection3DChunkedArtifact(value, false);
}

export function collectStaticFabInspection3DSourceTransferBuffers(
	snapshot: StaticFabInspection3DSourceSnapshot,
): ArrayBuffer[] {
	return collectUniqueArrayBuffers(sourceViews(snapshot));
}

export function collectStaticFabInspection3DArtifactTransferBuffers(
	artifact: StaticFabInspection3DArtifact,
): ArrayBuffer[] {
	return collectUniqueArrayBuffers(artifactViews(artifact));
}

export function collectStaticFabInspection3DChunkedArtifactTransferBuffers(
	artifact: StaticFabInspection3DChunkedArtifact,
): ArrayBuffer[] {
	return collectUniqueArrayBuffers(chunkedArtifactViews(artifact));
}

function assertStaticFabInspection3DSourceSnapshot(
	snapshot: StaticFabInspection3DSourceSnapshot,
): void {
	if (!isStaticFabInspection3DSourceSnapshot(snapshot)) {
		throw new RangeError("3D inspection source snapshot is malformed.");
	}
}

function compileOwnedRailRuns(
	snapshot: StaticFabInspection3DSourceSnapshot,
): StaticFabInspection3DOwnedRuns {
	const positions: number[] = [];
	const pointNormals: number[] = [];
	const offsets = new Uint32Array(snapshot.ownedIntervalCount + 1);
	const pathRows = new Uint32Array(snapshot.ownedIntervalCount);
	let runRow = 0;
	let segmentCount = 0;

	for (let pathRow = 0; pathRow < snapshot.pathCount; pathRow++) {
		const intervalStart = snapshot.ownedIntervalOffsets[pathRow] as number;
		const intervalEnd = snapshot.ownedIntervalOffsets[pathRow + 1] as number;
		const pointStart = snapshot.pathOffsets[pathRow] as number;
		const pointEnd = snapshot.pathOffsets[pathRow + 1] as number;
		for (let intervalRow = intervalStart; intervalRow < intervalEnd; intervalRow++) {
			const startStation = snapshot.ownedIntervalStarts[intervalRow] as number;
			const endStation = snapshot.ownedIntervalEnds[intervalRow] as number;
			offsets[runRow] = positions.length / FLOATS_PER_SOURCE_POINT;
			pathRows[runRow] = pathRow;
			appendSourceSampleAtStation(
				snapshot,
				pointStart,
				pointEnd,
				startStation,
				positions,
				pointNormals,
			);
			for (let pointIndex = pointStart + 1; pointIndex < pointEnd - 1; pointIndex++) {
				const station = snapshot.distances[pointIndex] as number;
				if (
					station > startStation + STATION_EPSILON_METERS &&
					station < endStation - STATION_EPSILON_METERS
				) {
					appendSourcePoint(snapshot, pointIndex, positions, pointNormals);
				}
			}
			appendSourceSampleAtStation(
				snapshot,
				pointStart,
				pointEnd,
				endStation,
				positions,
				pointNormals,
			);
			const pointCount = positions.length / FLOATS_PER_SOURCE_POINT - offsets[runRow];
			if (pointCount < 2) {
				throw new RangeError(`3D inspection owned run ${runRow} has fewer than two points.`);
			}
			segmentCount += pointCount - 1;
			runRow++;
		}
	}
	offsets[runRow] = positions.length / FLOATS_PER_SOURCE_POINT;
	if (runRow !== snapshot.ownedIntervalCount) {
		throw new Error(
			`3D inspection compiled ${runRow} runs; expected ${snapshot.ownedIntervalCount}.`,
		);
	}
	return Object.freeze({
		positions: Float32Array.from(positions),
		pointNormals: Float32Array.from(pointNormals),
		offsets,
		pathRows,
		runCount: runRow,
		pointCount: positions.length / FLOATS_PER_SOURCE_POINT,
		segmentCount,
	});
}

function partitionOwnedRailRunsByWorldChunk(
	runs: StaticFabInspection3DOwnedRuns,
): readonly (StaticFabInspection3DOwnedRuns & {
	readonly worldChunkX: number;
	readonly worldChunkZ: number;
})[] {
	const mutable = new Map<string, MutableStaticFabInspection3DChunkRuns>();
	for (let runRow = 0; runRow < runs.runCount; runRow++) {
		const start = runs.offsets[runRow] as number;
		const end = runs.offsets[runRow + 1] as number;
		const pathRow = runs.pathRows[runRow] as number;
		let active: MutableStaticFabInspection3DChunkRuns | null = null;
		for (let pointIndex = start; pointIndex < end - 1; pointIndex++) {
			const offset = pointIndex * FLOATS_PER_SOURCE_POINT;
			const nextOffset = offset + FLOATS_PER_SOURCE_POINT;
			const worldChunkX = Math.floor(
				(((runs.positions[offset] as number) + (runs.positions[nextOffset] as number)) * 0.5) /
					STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS,
			);
			const worldChunkZ = Math.floor(
				(((runs.positions[offset + 1] as number) + (runs.positions[nextOffset + 1] as number)) *
					0.5) /
					STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS,
			);
			const key = `${worldChunkX},${worldChunkZ}`;
			let chunk = mutable.get(key);
			if (!chunk) {
				chunk = {
					worldChunkX,
					worldChunkZ,
					positions: [],
					pointNormals: [],
					offsets: [0],
					pathRows: [],
					segmentCount: 0,
				};
				mutable.set(key, chunk);
			}
			if (active !== chunk) {
				if (active) active.offsets.push(active.positions.length / FLOATS_PER_SOURCE_POINT);
				active = chunk;
				active.pathRows.push(pathRow);
				appendOwnedRunPoint(runs, pointIndex, active.positions, active.pointNormals);
			}
			appendOwnedRunPoint(runs, pointIndex + 1, chunk.positions, chunk.pointNormals);
			chunk.segmentCount++;
		}
		if (active) active.offsets.push(active.positions.length / FLOATS_PER_SOURCE_POINT);
	}
	return Object.freeze(
		[...mutable.values()]
			.sort(
				(left, right) =>
					left.worldChunkZ - right.worldChunkZ || left.worldChunkX - right.worldChunkX,
			)
			.map((chunk) => {
				const runCount = chunk.pathRows.length;
				const pointCount = chunk.positions.length / FLOATS_PER_SOURCE_POINT;
				if (
					chunk.offsets.length !== runCount + 1 ||
					(chunk.offsets[runCount] as number) !== pointCount ||
					pointCount !== chunk.segmentCount + runCount
				) {
					throw new Error("3D inspection rail chunk run partition is inconsistent.");
				}
				return Object.freeze({
					worldChunkX: chunk.worldChunkX,
					worldChunkZ: chunk.worldChunkZ,
					positions: Float32Array.from(chunk.positions),
					pointNormals: Float32Array.from(chunk.pointNormals),
					offsets: Uint32Array.from(chunk.offsets),
					pathRows: Uint32Array.from(chunk.pathRows),
					runCount,
					pointCount,
					segmentCount: chunk.segmentCount,
				});
			}),
	);
}

function appendOwnedRunPoint(
	runs: StaticFabInspection3DOwnedRuns,
	pointIndex: number,
	positions: number[],
	pointNormals: number[],
): void {
	const offset = pointIndex * FLOATS_PER_SOURCE_POINT;
	positions.push(runs.positions[offset] as number, runs.positions[offset + 1] as number);
	pointNormals.push(runs.pointNormals[offset] as number, runs.pointNormals[offset + 1] as number);
}

function appendSourcePoint(
	snapshot: StaticFabInspection3DSourceSnapshot,
	pointIndex: number,
	positions: number[],
	pointNormals: number[],
): void {
	const offset = pointIndex * FLOATS_PER_SOURCE_POINT;
	positions.push(snapshot.positions[offset] as number, snapshot.positions[offset + 1] as number);
	pointNormals.push(
		snapshot.pointNormals[offset] as number,
		snapshot.pointNormals[offset + 1] as number,
	);
}

function appendSourceSampleAtStation(
	snapshot: StaticFabInspection3DSourceSnapshot,
	pointStart: number,
	pointEnd: number,
	station: number,
	positions: number[],
	pointNormals: number[],
): void {
	let low = pointStart;
	let high = pointEnd;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((snapshot.distances[middle] as number) < station) low = middle + 1;
		else high = middle;
	}
	const next = Math.min(pointEnd - 1, low);
	const nextStation = snapshot.distances[next] as number;
	if (Math.abs(nextStation - station) <= STATION_EPSILON_METERS || next === pointStart) {
		appendSourcePoint(snapshot, next, positions, pointNormals);
		return;
	}
	const previous = next - 1;
	const previousStation = snapshot.distances[previous] as number;
	const span = nextStation - previousStation;
	if (!(span > STATION_EPSILON_METERS)) {
		throw new RangeError("3D inspection source station interval is not increasing.");
	}
	const ratio = Math.max(0, Math.min(1, (station - previousStation) / span));
	const previousOffset = previous * FLOATS_PER_SOURCE_POINT;
	const nextOffset = next * FLOATS_PER_SOURCE_POINT;
	positions.push(
		lerp(
			snapshot.positions[previousOffset] as number,
			snapshot.positions[nextOffset] as number,
			ratio,
		),
		lerp(
			snapshot.positions[previousOffset + 1] as number,
			snapshot.positions[nextOffset + 1] as number,
			ratio,
		),
	);
	const normalX = lerp(
		snapshot.pointNormals[previousOffset] as number,
		snapshot.pointNormals[nextOffset] as number,
		ratio,
	);
	const normalZ = lerp(
		snapshot.pointNormals[previousOffset + 1] as number,
		snapshot.pointNormals[nextOffset + 1] as number,
		ratio,
	);
	const magnitude = Math.hypot(normalX, normalZ);
	if (!(magnitude > Number.EPSILON)) {
		throw new RangeError("3D inspection interpolated a zero-length rail normal.");
	}
	pointNormals.push(normalX / magnitude, normalZ / magnitude);
}

function lerp(start: number, end: number, ratio: number): number {
	return start + (end - start) * ratio;
}

function compileSweptPrisms(
	runs: StaticFabInspection3DOwnedRuns,
	centerOffsets: readonly number[],
	width: number,
	bottomY: number,
	topY: number,
): StaticFabInspection3DMesh {
	const verticesPerPrism = checkedAdd(
		checkedMultiply(runs.pointCount, RING_VERTEX_COUNT, "prism ring vertices"),
		checkedMultiply(runs.runCount, CAP_VERTEX_COUNT, "prism cap vertices"),
		"prism vertices",
	);
	const indicesPerPrism = checkedAdd(
		checkedMultiply(runs.segmentCount, SEGMENT_INDEX_COUNT, "prism segment indices"),
		checkedMultiply(runs.runCount, PATH_CAP_INDEX_COUNT, "prism cap indices"),
		"prism indices",
	);
	const vertexCount = checkedMultiply(verticesPerPrism, centerOffsets.length, "mesh vertices");
	const indexCount = checkedMultiply(indicesPerPrism, centerOffsets.length, "mesh indices");
	const positions = new Float32Array(
		checkedMultiply(vertexCount, FLOATS_PER_POSITION, "mesh position scalars"),
	);
	const normals = new Float32Array(positions.length);
	const indices = new Uint32Array(indexCount);
	const halfWidth = width / 2;
	let indexCursor = 0;

	for (let prismIndex = 0; prismIndex < centerOffsets.length; prismIndex++) {
		const centerOffset = centerOffsets[prismIndex] as number;
		const prismVertexBase = prismIndex * verticesPerPrism;
		for (let pointIndex = 0; pointIndex < runs.pointCount; pointIndex++) {
			const sourceOffset = pointIndex * FLOATS_PER_SOURCE_POINT;
			const x = runs.positions[sourceOffset] as number;
			const z = runs.positions[sourceOffset + 1] as number;
			const normalX = runs.pointNormals[sourceOffset] as number;
			const normalZ = runs.pointNormals[sourceOffset + 1] as number;
			writePrismRing(
				positions,
				normals,
				prismVertexBase + pointIndex * RING_VERTEX_COUNT,
				x,
				z,
				normalX,
				normalZ,
				centerOffset,
				halfWidth,
				bottomY,
				topY,
			);
		}

		for (let runRow = 0; runRow < runs.runCount; runRow++) {
			const start = runs.offsets[runRow] as number;
			const end = runs.offsets[runRow + 1] as number;
			for (let pointIndex = start; pointIndex < end - 1; pointIndex++) {
				const from = prismVertexBase + pointIndex * RING_VERTEX_COUNT;
				const to = from + RING_VERTEX_COUNT;
				indexCursor = writeQuad(indices, indexCursor, from, from + 1, to + 1, to);
				indexCursor = writeQuad(indices, indexCursor, from + 2, to + 2, to + 3, from + 3);
				indexCursor = writeQuad(indices, indexCursor, from + 4, to + 4, to + 5, from + 5);
				indexCursor = writeQuad(indices, indexCursor, from + 6, from + 7, to + 7, to + 6);
			}

			const capBase =
				prismVertexBase + runs.pointCount * RING_VERTEX_COUNT + runRow * CAP_VERTEX_COUNT;
			writePrismCap(
				positions,
				normals,
				capBase,
				runs,
				start,
				centerOffset,
				halfWidth,
				bottomY,
				topY,
				false,
			);
			writePrismCap(
				positions,
				normals,
				capBase + 4,
				runs,
				end - 1,
				centerOffset,
				halfWidth,
				bottomY,
				topY,
				true,
			);
			indices[indexCursor++] = capBase;
			indices[indexCursor++] = capBase + 1;
			indices[indexCursor++] = capBase + 2;
			indices[indexCursor++] = capBase;
			indices[indexCursor++] = capBase + 2;
			indices[indexCursor++] = capBase + 3;
			indices[indexCursor++] = capBase + 4;
			indices[indexCursor++] = capBase + 5;
			indices[indexCursor++] = capBase + 6;
			indices[indexCursor++] = capBase + 4;
			indices[indexCursor++] = capBase + 6;
			indices[indexCursor++] = capBase + 7;
		}
	}

	if (indexCursor !== indices.length) {
		throw new Error(`3D inspection mesh wrote ${indexCursor} indices; expected ${indices.length}.`);
	}
	return Object.freeze({
		positions,
		normals,
		indices,
		vertexCount,
		triangleCount: indices.length / 3,
	});
}

function compilePickLines(
	runs: StaticFabInspection3DOwnedRuns,
	y: number,
): StaticFabInspection3DPickLines {
	const segmentCount = runs.segmentCount;
	const positions = new Float32Array(
		checkedMultiply(
			segmentCount,
			PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION,
			"pick line scalars",
		),
	);
	const pathRows = new Uint32Array(segmentCount);
	let segmentRow = 0;
	for (let runRow = 0; runRow < runs.runCount; runRow++) {
		const start = runs.offsets[runRow] as number;
		const end = runs.offsets[runRow + 1] as number;
		for (let pointIndex = start; pointIndex < end - 1; pointIndex++) {
			const sourceOffset = pointIndex * FLOATS_PER_SOURCE_POINT;
			const nextOffset = sourceOffset + FLOATS_PER_SOURCE_POINT;
			const targetOffset = segmentRow * PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION;
			positions[targetOffset] = runs.positions[sourceOffset] as number;
			positions[targetOffset + 1] = y;
			positions[targetOffset + 2] = runs.positions[sourceOffset + 1] as number;
			positions[targetOffset + 3] = runs.positions[nextOffset] as number;
			positions[targetOffset + 4] = y;
			positions[targetOffset + 5] = runs.positions[nextOffset + 1] as number;
			pathRows[segmentRow] = runs.pathRows[runRow] as number;
			segmentRow++;
		}
	}
	return Object.freeze({ positions, pathRows, segmentCount });
}

function compileDecorationInstances(
	snapshot: StaticFabInspection3DSourceSnapshot,
	include: (kind: number) => boolean,
	y: number,
	halfLengthMeters: number,
	halfWidthMeters: number,
	heightMeters: number,
): StaticFabInspection3DInstances {
	let count = 0;
	for (const kind of snapshot.decorationKinds) {
		if (include(kind)) count++;
	}
	const positions = new Float32Array(count * FLOATS_PER_POSITION);
	const tangents = new Float32Array(count * FLOATS_PER_POSITION);
	const pathRows = new Uint32Array(count);
	const kinds = new Uint8Array(count);
	const stableIds = new Uint32Array(count * INSTANCE_STABLE_ID_WIDTH);
	let row = 0;
	for (let sourceRow = 0; sourceRow < snapshot.decorationCount; sourceRow++) {
		const kind = snapshot.decorationKinds[sourceRow] as number;
		if (!include(kind)) continue;
		const sourceOffset = sourceRow * FLOATS_PER_SOURCE_POINT;
		const targetOffset = row * FLOATS_PER_POSITION;
		const tangentX = snapshot.decorationTangents[sourceOffset] as number;
		const tangentZ = snapshot.decorationTangents[sourceOffset + 1] as number;
		const tangentMagnitude = Math.hypot(tangentX, tangentZ);
		positions[targetOffset] = snapshot.decorationPositions[sourceOffset] as number;
		positions[targetOffset + 1] = y;
		positions[targetOffset + 2] = snapshot.decorationPositions[sourceOffset + 1] as number;
		tangents[targetOffset] = tangentX / tangentMagnitude;
		tangents[targetOffset + 1] = 0;
		tangents[targetOffset + 2] = tangentZ / tangentMagnitude;
		pathRows[row] = snapshot.decorationOwnerPathRows[sourceRow] as number;
		kinds[row] = kind;
		stableIds[row * INSTANCE_STABLE_ID_WIDTH] = snapshot.decorationStableIds[
			sourceRow * INSTANCE_STABLE_ID_WIDTH
		] as number;
		stableIds[row * INSTANCE_STABLE_ID_WIDTH + 1] = snapshot.decorationStableIds[
			sourceRow * INSTANCE_STABLE_ID_WIDTH + 1
		] as number;
		row++;
	}
	return Object.freeze({
		positions,
		tangents,
		pathRows,
		kinds,
		stableIds,
		count,
		halfLengthMeters,
		halfWidthMeters,
		heightMeters,
	});
}

function compileAdvancedSwitchInstances(
	snapshot: StaticFabInspection3DSourceSnapshot,
	y: number,
): StaticFabInspection3DAdvancedSwitchInstances {
	const positions: number[] = [];
	const tangents: number[] = [];
	const pathRows: number[] = [];
	const switchIds: number[] = [];
	const profileClasses: number[] = [];
	const seenSwitchIds = new Set<number>();
	for (let pathRow = 0; pathRow < snapshot.pathCount; pathRow++) {
		if (
			(snapshot.advancedSwitchSegmentRoles[pathRow] as number) !==
			ADVANCED_SWITCH_SEGMENT_ROLE.THROAT
		) {
			continue;
		}
		const switchId = snapshot.advancedSwitchIds[pathRow] as number;
		const profileClass = snapshot.advancedSwitchProfileClasses[pathRow] as number;
		if (switchId <= 0 || profileClass > 3 || seenSwitchIds.has(switchId)) {
			throw new RangeError("3D inspection advanced-switch throat metadata is malformed.");
		}
		seenSwitchIds.add(switchId);
		const pointStart = snapshot.pathOffsets[pathRow] as number;
		const pointEnd = snapshot.pathOffsets[pathRow + 1] as number;
		const pathLength = snapshot.distances[pointEnd - 1] as number;
		const sample = sampleSourcePathPositionAndTangent(
			snapshot,
			pointStart,
			pointEnd,
			pathLength * 0.5,
		);
		positions.push(sample.x, y, sample.z);
		tangents.push(sample.tangentX, 0, sample.tangentZ);
		pathRows.push(pathRow);
		switchIds.push(switchId);
		profileClasses.push(profileClass);
	}
	return Object.freeze({
		positions: Float32Array.from(positions),
		tangents: Float32Array.from(tangents),
		pathRows: Uint32Array.from(pathRows),
		switchIds: Uint32Array.from(switchIds),
		profileClasses: Uint8Array.from(profileClasses),
		count: switchIds.length,
	});
}

function sampleSourcePathPositionAndTangent(
	snapshot: StaticFabInspection3DSourceSnapshot,
	pointStart: number,
	pointEnd: number,
	station: number,
): Readonly<{ x: number; z: number; tangentX: number; tangentZ: number }> {
	let low = pointStart;
	let high = pointEnd;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((snapshot.distances[middle] as number) < station) low = middle + 1;
		else high = middle;
	}
	const next = Math.min(pointEnd - 1, Math.max(pointStart + 1, low));
	const previous = next - 1;
	const previousStation = snapshot.distances[previous] as number;
	const nextStation = snapshot.distances[next] as number;
	const ratio = Math.max(
		0,
		Math.min(1, (station - previousStation) / (nextStation - previousStation)),
	);
	const previousOffset = previous * FLOATS_PER_SOURCE_POINT;
	const nextOffset = next * FLOATS_PER_SOURCE_POINT;
	const deltaX =
		(snapshot.positions[nextOffset] as number) - (snapshot.positions[previousOffset] as number);
	const deltaZ =
		(snapshot.positions[nextOffset + 1] as number) -
		(snapshot.positions[previousOffset + 1] as number);
	const magnitude = Math.hypot(deltaX, deltaZ);
	return Object.freeze({
		x: lerp(
			snapshot.positions[previousOffset] as number,
			snapshot.positions[nextOffset] as number,
			ratio,
		),
		z: lerp(
			snapshot.positions[previousOffset + 1] as number,
			snapshot.positions[nextOffset + 1] as number,
			ratio,
		),
		tangentX: deltaX / magnitude,
		tangentZ: deltaZ / magnitude,
	});
}

function writePrismRing(
	positions: Float32Array,
	normals: Float32Array,
	vertexBase: number,
	x: number,
	z: number,
	normalX: number,
	normalZ: number,
	centerOffset: number,
	halfWidth: number,
	bottomY: number,
	topY: number,
): void {
	const centerX = x + normalX * centerOffset;
	const centerZ = z + normalZ * centerOffset;
	const leftX = centerX + normalX * halfWidth;
	const leftZ = centerZ + normalZ * halfWidth;
	const rightX = centerX - normalX * halfWidth;
	const rightZ = centerZ - normalZ * halfWidth;
	writeVertex(positions, normals, vertexBase, leftX, bottomY, leftZ, 0, -1, 0);
	writeVertex(positions, normals, vertexBase + 1, rightX, bottomY, rightZ, 0, -1, 0);
	writeVertex(positions, normals, vertexBase + 2, leftX, topY, leftZ, 0, 1, 0);
	writeVertex(positions, normals, vertexBase + 3, rightX, topY, rightZ, 0, 1, 0);
	writeVertex(positions, normals, vertexBase + 4, leftX, bottomY, leftZ, normalX, 0, normalZ);
	writeVertex(positions, normals, vertexBase + 5, leftX, topY, leftZ, normalX, 0, normalZ);
	writeVertex(positions, normals, vertexBase + 6, rightX, bottomY, rightZ, -normalX, 0, -normalZ);
	writeVertex(positions, normals, vertexBase + 7, rightX, topY, rightZ, -normalX, 0, -normalZ);
}

function writePrismCap(
	positions: Float32Array,
	normals: Float32Array,
	vertexBase: number,
	runs: StaticFabInspection3DOwnedRuns,
	pointIndex: number,
	centerOffset: number,
	halfWidth: number,
	bottomY: number,
	topY: number,
	isEnd: boolean,
): void {
	const pointOffset = pointIndex * FLOATS_PER_SOURCE_POINT;
	const x = runs.positions[pointOffset] as number;
	const z = runs.positions[pointOffset + 1] as number;
	const normalX = runs.pointNormals[pointOffset] as number;
	const normalZ = runs.pointNormals[pointOffset + 1] as number;
	const centerX = x + normalX * centerOffset;
	const centerZ = z + normalZ * centerOffset;
	const leftX = centerX + normalX * halfWidth;
	const leftZ = centerZ + normalZ * halfWidth;
	const rightX = centerX - normalX * halfWidth;
	const rightZ = centerZ - normalZ * halfWidth;
	const tangent = endpointTangent(runs, pointIndex, isEnd);
	const direction = isEnd ? 1 : -1;
	const capNormalX = tangent.x * direction;
	const capNormalZ = tangent.z * direction;
	const vertices = isEnd
		? ([
				[leftX, bottomY, leftZ],
				[rightX, bottomY, rightZ],
				[rightX, topY, rightZ],
				[leftX, topY, leftZ],
			] as const)
		: ([
				[leftX, bottomY, leftZ],
				[leftX, topY, leftZ],
				[rightX, topY, rightZ],
				[rightX, bottomY, rightZ],
			] as const);
	for (let index = 0; index < vertices.length; index++) {
		const vertex = vertices[index] as readonly [number, number, number];
		writeVertex(
			positions,
			normals,
			vertexBase + index,
			vertex[0],
			vertex[1],
			vertex[2],
			capNormalX,
			0,
			capNormalZ,
		);
	}
}

function endpointTangent(
	runs: StaticFabInspection3DOwnedRuns,
	pointIndex: number,
	isEnd: boolean,
): { x: number; z: number } {
	const otherIndex = isEnd ? pointIndex - 1 : pointIndex + 1;
	const offset = pointIndex * FLOATS_PER_SOURCE_POINT;
	const otherOffset = otherIndex * FLOATS_PER_SOURCE_POINT;
	const x = (runs.positions[offset] as number) - (runs.positions[otherOffset] as number);
	const z = (runs.positions[offset + 1] as number) - (runs.positions[otherOffset + 1] as number);
	const direction = isEnd ? 1 : -1;
	const magnitude = Math.hypot(x, z);
	return { x: (x / magnitude) * direction, z: (z / magnitude) * direction };
}

function writeVertex(
	positions: Float32Array,
	normals: Float32Array,
	vertex: number,
	x: number,
	y: number,
	z: number,
	normalX: number,
	normalY: number,
	normalZ: number,
): void {
	const offset = vertex * FLOATS_PER_POSITION;
	positions[offset] = x;
	positions[offset + 1] = y;
	positions[offset + 2] = z;
	normals[offset] = normalX;
	normals[offset + 1] = normalY;
	normals[offset + 2] = normalZ;
}

function writeQuad(
	indices: Uint32Array,
	cursor: number,
	a: number,
	b: number,
	c: number,
	d: number,
): number {
	indices[cursor++] = a;
	indices[cursor++] = b;
	indices[cursor++] = c;
	indices[cursor++] = a;
	indices[cursor++] = c;
	indices[cursor++] = d;
	return cursor;
}

function compileArtifactBounds(
	bed: StaticFabInspection3DMesh,
	beams: StaticFabInspection3DMesh,
	supports: StaticFabInspection3DInstances,
	flows: StaticFabInspection3DInstances,
): StaticFabInspection3DBounds {
	const accumulator = new BoundsAccumulator();
	accumulator.includePositions(bed.positions);
	accumulator.includePositions(beams.positions);
	accumulator.includeInstances(supports);
	accumulator.includeInstances(flows);
	return accumulator.finish();
}

function compileRailChunkBounds(
	bed: StaticFabInspection3DMesh,
	beams: StaticFabInspection3DMesh,
): StaticFabInspection3DBounds {
	const accumulator = new BoundsAccumulator();
	accumulator.includePositions(bed.positions);
	accumulator.includePositions(beams.positions);
	return accumulator.finish();
}

function compileChunkedArtifactBounds(
	chunks: readonly StaticFabInspection3DRailChunk[],
	supports: StaticFabInspection3DInstances,
	flows: StaticFabInspection3DInstances,
	advancedSwitches: StaticFabInspection3DAdvancedSwitchInstances,
): StaticFabInspection3DBounds {
	const accumulator = new BoundsAccumulator();
	for (const chunk of chunks) accumulator.includeBounds(chunk.bounds);
	accumulator.includeInstances(supports);
	accumulator.includeInstances(flows);
	accumulator.includeAdvancedSwitches(advancedSwitches);
	return accumulator.finish();
}

class BoundsAccumulator {
	private minX = Number.POSITIVE_INFINITY;
	private minY = Number.POSITIVE_INFINITY;
	private minZ = Number.POSITIVE_INFINITY;
	private maxX = Number.NEGATIVE_INFINITY;
	private maxY = Number.NEGATIVE_INFINITY;
	private maxZ = Number.NEGATIVE_INFINITY;

	includePositions(positions: Float32Array): void {
		for (let offset = 0; offset < positions.length; offset += FLOATS_PER_POSITION) {
			this.include(
				positions[offset] as number,
				positions[offset + 1] as number,
				positions[offset + 2] as number,
			);
		}
	}

	includeAdvancedSwitches(instances: StaticFabInspection3DAdvancedSwitchInstances): void {
		for (let row = 0; row < instances.count; row++) {
			const offset = row * FLOATS_PER_POSITION;
			const x = instances.positions[offset] as number;
			const y = instances.positions[offset + 1] as number;
			const z = instances.positions[offset + 2] as number;
			this.include(x - 0.5, y - 0.2, z - 0.5);
			this.include(x + 0.5, y + 0.3, z + 0.5);
		}
	}

	includeInstances(instances: StaticFabInspection3DInstances): void {
		for (let row = 0; row < instances.count; row++) {
			const offset = row * FLOATS_PER_POSITION;
			const x = instances.positions[offset] as number;
			const y = instances.positions[offset + 1] as number;
			const z = instances.positions[offset + 2] as number;
			const tangentX = instances.tangents[offset] as number;
			const tangentZ = instances.tangents[offset + 2] as number;
			const normalX = -tangentZ;
			const normalZ = tangentX;
			for (const lengthSign of [-1, 1]) {
				for (const widthSign of [-1, 1]) {
					this.include(
						x +
							tangentX * instances.halfLengthMeters * lengthSign +
							normalX * instances.halfWidthMeters * widthSign,
						y - instances.heightMeters / 2,
						z +
							tangentZ * instances.halfLengthMeters * lengthSign +
							normalZ * instances.halfWidthMeters * widthSign,
					);
					this.include(
						x +
							tangentX * instances.halfLengthMeters * lengthSign +
							normalX * instances.halfWidthMeters * widthSign,
						y + instances.heightMeters / 2,
						z +
							tangentZ * instances.halfLengthMeters * lengthSign +
							normalZ * instances.halfWidthMeters * widthSign,
					);
				}
			}
		}
	}

	includeBounds(bounds: StaticFabInspection3DBounds): void {
		this.include(bounds.minX, bounds.minY, bounds.minZ);
		this.include(bounds.maxX, bounds.maxY, bounds.maxZ);
	}

	private include(x: number, y: number, z: number): void {
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			throw new RangeError("3D inspection artifact produced non-finite bounds.");
		}
		this.minX = Math.min(this.minX, x);
		this.minY = Math.min(this.minY, y);
		this.minZ = Math.min(this.minZ, z);
		this.maxX = Math.max(this.maxX, x);
		this.maxY = Math.max(this.maxY, y);
		this.maxZ = Math.max(this.maxZ, z);
	}

	finish(): StaticFabInspection3DBounds {
		if (this.minX === Number.POSITIVE_INFINITY) {
			return Object.freeze({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
		}
		const bounds = {
			minX: this.minX,
			minY: this.minY,
			minZ: this.minZ,
			maxX: this.maxX,
			maxY: this.maxY,
			maxZ: this.maxZ,
		};
		if (!isFiniteBounds(bounds)) {
			throw new RangeError("3D inspection artifact bounds are malformed.");
		}
		return Object.freeze(bounds);
	}
}

function validateStaticFabInspection3DChunkedArtifact(
	value: unknown,
	fullValidation: boolean,
): value is StaticFabInspection3DChunkedArtifact {
	if (
		!isRecord(value) ||
		value.schemaVersion !== STATIC_FAB_INSPECTION_3D_CHUNKED_ARTIFACT_SCHEMA_VERSION ||
		!isNonNegativeSafeInteger(value.sourceGeneration) ||
		!isNonNegativeSafeInteger(value.sourceRevision) ||
		!isNonNegativeSafeInteger(value.pathCount) ||
		!isNonNegativeSafeInteger(value.pointCount) ||
		!isNonNegativeSafeInteger(value.runCount) ||
		!isNonNegativeSafeInteger(value.renderPointCount) ||
		!isNonNegativeSafeInteger(value.segmentCount) ||
		value.worldChunkSizeMeters !== STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS ||
		!Array.isArray(value.railChunks) ||
		!isArtifactProfile(value.profile) ||
		!isFiniteBounds(value.bounds) ||
		!(fullValidation
			? isPickLines(value.pickLines)
			: isPickLinesTransferEnvelope(value.pickLines)) ||
		!(fullValidation ? isInstances(value.supports) : isInstancesTransferEnvelope(value.supports)) ||
		!(fullValidation ? isInstances(value.flows) : isInstancesTransferEnvelope(value.flows)) ||
		!(fullValidation
			? isAdvancedSwitchInstances(value.advancedSwitches)
			: isAdvancedSwitchInstancesTransferEnvelope(value.advancedSwitches)) ||
		!isNonNegativeSafeInteger(value.byteLength)
	) {
		return false;
	}
	const artifact = value as unknown as StaticFabInspection3DChunkedArtifact;
	if (
		artifact.renderPointCount !== artifact.segmentCount + artifact.runCount ||
		artifact.runCount > artifact.pathCount + artifact.segmentCount ||
		artifact.pickLines.segmentCount !== artifact.segmentCount ||
		artifact.pickLines.positions.length !==
			artifact.segmentCount * PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION ||
		artifact.pickLines.pathRows.length !== artifact.segmentCount
	) {
		return false;
	}
	let priorChunkX = Number.NEGATIVE_INFINITY;
	let priorChunkZ = Number.NEGATIVE_INFINITY;
	let runCount = 0;
	let renderPointCount = 0;
	let segmentCount = 0;
	for (const candidate of artifact.railChunks) {
		if (
			!isRecord(candidate) ||
			!isInt32(candidate.worldChunkX) ||
			!isInt32(candidate.worldChunkZ) ||
			!isNonNegativeSafeInteger(candidate.runCount) ||
			!isNonNegativeSafeInteger(candidate.renderPointCount) ||
			!isNonNegativeSafeInteger(candidate.segmentCount) ||
			!isNonNegativeSafeInteger(candidate.pickSegmentOffset) ||
			!isFiniteBounds(candidate.bounds) ||
			!(fullValidation ? isMesh(candidate.bed) : isMeshTransferEnvelope(candidate.bed)) ||
			!(fullValidation ? isMesh(candidate.beams) : isMeshTransferEnvelope(candidate.beams))
		) {
			return false;
		}
		const chunk = candidate as unknown as StaticFabInspection3DRailChunk;
		if (
			chunk.segmentCount === 0 ||
			chunk.runCount === 0 ||
			chunk.renderPointCount !== chunk.segmentCount + chunk.runCount ||
			chunk.pickSegmentOffset !== segmentCount ||
			chunk.worldChunkZ < priorChunkZ ||
			(chunk.worldChunkZ === priorChunkZ && chunk.worldChunkX <= priorChunkX)
		) {
			return false;
		}
		const perPrismVertices =
			chunk.renderPointCount * RING_VERTEX_COUNT + chunk.runCount * CAP_VERTEX_COUNT;
		const perPrismIndices =
			chunk.segmentCount * SEGMENT_INDEX_COUNT + chunk.runCount * PATH_CAP_INDEX_COUNT;
		if (
			!Number.isSafeInteger(perPrismVertices) ||
			!Number.isSafeInteger(perPrismIndices) ||
			chunk.bed.vertexCount !== perPrismVertices ||
			chunk.bed.indices.length !== perPrismIndices ||
			chunk.beams.vertexCount !== perPrismVertices * 2 ||
			chunk.beams.indices.length !== perPrismIndices * 2
		) {
			return false;
		}
		priorChunkX = chunk.worldChunkX;
		priorChunkZ = chunk.worldChunkZ;
		runCount += chunk.runCount;
		renderPointCount += chunk.renderPointCount;
		segmentCount += chunk.segmentCount;
	}
	if (
		runCount !== artifact.runCount ||
		renderPointCount !== artifact.renderPointCount ||
		segmentCount !== artifact.segmentCount ||
		artifact.railChunks.length > artifact.segmentCount ||
		(fullValidation &&
			(!rowsWithinPathCount(artifact.pickLines.pathRows, artifact.pathCount) ||
				!rowsWithinPathCount(artifact.supports.pathRows, artifact.pathCount) ||
				!rowsWithinPathCount(artifact.flows.pathRows, artifact.pathCount) ||
				!rowsWithinPathCount(artifact.advancedSwitches.pathRows, artifact.pathCount) ||
				!allFinite(artifact.pickLines.positions)))
	) {
		return false;
	}
	const views = chunkedArtifactViews(artifact);
	return hasOwnedDistinctBuffers(views) && artifact.byteLength === sumBufferByteLengths(views);
}

function isSourceProfile(value: unknown): value is StaticFabInspection3DSourceProfile {
	if (!isRecord(value)) return false;
	const bedWidth = value.bedWidthMeters;
	const beamOffset = value.beamCenterOffsetMeters;
	const beamWidth = value.beamWidthMeters;
	const supportHalfSpan = value.supportHalfSpanMeters;
	return (
		isPositiveFinite(bedWidth) &&
		isPositiveFinite(beamOffset) &&
		isPositiveFinite(beamWidth) &&
		isPositiveFinite(supportHalfSpan) &&
		beamOffset > beamWidth / 2 &&
		beamOffset + beamWidth / 2 <= bedWidth / 2
	);
}

function isArtifactProfile(value: unknown): value is StaticFabInspection3DArtifactProfile {
	return (
		isSourceProfile(value) &&
		isRecord(value) &&
		isPositiveFinite(value.railBaseElevationMeters) &&
		isPositiveFinite(value.bedHeightMeters) &&
		isPositiveFinite(value.beamHeightMeters)
	);
}

function isMesh(value: unknown): value is StaticFabInspection3DMesh {
	if (
		!isRecord(value) ||
		!(value.positions instanceof Float32Array) ||
		!(value.normals instanceof Float32Array) ||
		!(value.indices instanceof Uint32Array) ||
		!isNonNegativeSafeInteger(value.vertexCount) ||
		!isNonNegativeSafeInteger(value.triangleCount)
	) {
		return false;
	}
	const mesh = value as unknown as StaticFabInspection3DMesh;
	if (
		mesh.positions.length !== mesh.vertexCount * FLOATS_PER_POSITION ||
		mesh.normals.length !== mesh.positions.length ||
		mesh.indices.length !== mesh.triangleCount * 3 ||
		!allFinite(mesh.positions) ||
		!hasUnitTriples(mesh.normals)
	) {
		return false;
	}
	for (const index of mesh.indices) {
		if (index >= mesh.vertexCount) return false;
	}
	return true;
}

function isMeshTransferEnvelope(value: unknown): value is StaticFabInspection3DMesh {
	if (
		!isRecord(value) ||
		!(value.positions instanceof Float32Array) ||
		!(value.normals instanceof Float32Array) ||
		!(value.indices instanceof Uint32Array) ||
		!isNonNegativeSafeInteger(value.vertexCount) ||
		!isNonNegativeSafeInteger(value.triangleCount)
	) {
		return false;
	}
	const mesh = value as unknown as StaticFabInspection3DMesh;
	return (
		mesh.positions.length === mesh.vertexCount * FLOATS_PER_POSITION &&
		mesh.normals.length === mesh.positions.length &&
		mesh.indices.length === mesh.triangleCount * 3
	);
}

function isPickLines(value: unknown): value is StaticFabInspection3DPickLines {
	return (
		isRecord(value) &&
		value.positions instanceof Float32Array &&
		value.pathRows instanceof Uint32Array &&
		isNonNegativeSafeInteger(value.segmentCount)
	);
}

function isPickLinesTransferEnvelope(value: unknown): value is StaticFabInspection3DPickLines {
	return (
		isPickLines(value) &&
		value.positions.length ===
			value.segmentCount * PICK_VERTICES_PER_SEGMENT * FLOATS_PER_POSITION &&
		value.pathRows.length === value.segmentCount
	);
}

function isInstances(value: unknown): value is StaticFabInspection3DInstances {
	if (
		!isRecord(value) ||
		!(value.positions instanceof Float32Array) ||
		!(value.tangents instanceof Float32Array) ||
		!(value.pathRows instanceof Uint32Array) ||
		!(value.kinds instanceof Uint8Array) ||
		!(value.stableIds instanceof Uint32Array) ||
		!isNonNegativeSafeInteger(value.count) ||
		!isPositiveFinite(value.halfLengthMeters) ||
		!isPositiveFinite(value.halfWidthMeters) ||
		!isPositiveFinite(value.heightMeters)
	) {
		return false;
	}
	const instances = value as unknown as StaticFabInspection3DInstances;
	return (
		instances.positions.length === instances.count * FLOATS_PER_POSITION &&
		instances.tangents.length === instances.positions.length &&
		instances.pathRows.length === instances.count &&
		instances.kinds.length === instances.count &&
		instances.stableIds.length === instances.count * INSTANCE_STABLE_ID_WIDTH &&
		allFinite(instances.positions) &&
		hasUnitHorizontalTriples(instances.tangents)
	);
}

function isInstancesTransferEnvelope(value: unknown): value is StaticFabInspection3DInstances {
	if (
		!isRecord(value) ||
		!(value.positions instanceof Float32Array) ||
		!(value.tangents instanceof Float32Array) ||
		!(value.pathRows instanceof Uint32Array) ||
		!(value.kinds instanceof Uint8Array) ||
		!(value.stableIds instanceof Uint32Array) ||
		!isNonNegativeSafeInteger(value.count) ||
		!isPositiveFinite(value.halfLengthMeters) ||
		!isPositiveFinite(value.halfWidthMeters) ||
		!isPositiveFinite(value.heightMeters)
	) {
		return false;
	}
	const instances = value as unknown as StaticFabInspection3DInstances;
	return (
		instances.positions.length === instances.count * FLOATS_PER_POSITION &&
		instances.tangents.length === instances.positions.length &&
		instances.pathRows.length === instances.count &&
		instances.kinds.length === instances.count &&
		instances.stableIds.length === instances.count * INSTANCE_STABLE_ID_WIDTH
	);
}

function isAdvancedSwitchInstances(
	value: unknown,
): value is StaticFabInspection3DAdvancedSwitchInstances {
	if (!isAdvancedSwitchInstancesTransferEnvelope(value)) return false;
	const instances = value as StaticFabInspection3DAdvancedSwitchInstances;
	if (!allFinite(instances.positions) || !hasUnitHorizontalTriples(instances.tangents))
		return false;
	const seen = new Set<number>();
	for (let row = 0; row < instances.count; row++) {
		const switchId = instances.switchIds[row] as number;
		if (switchId <= 0 || seen.has(switchId) || (instances.profileClasses[row] as number) > 3) {
			return false;
		}
		seen.add(switchId);
	}
	return true;
}

function isAdvancedSwitchInstancesTransferEnvelope(
	value: unknown,
): value is StaticFabInspection3DAdvancedSwitchInstances {
	if (
		!isRecord(value) ||
		!(value.positions instanceof Float32Array) ||
		!(value.tangents instanceof Float32Array) ||
		!(value.pathRows instanceof Uint32Array) ||
		!(value.switchIds instanceof Uint32Array) ||
		!(value.profileClasses instanceof Uint8Array) ||
		!isNonNegativeSafeInteger(value.count)
	) {
		return false;
	}
	const instances = value as unknown as StaticFabInspection3DAdvancedSwitchInstances;
	return (
		instances.positions.length === instances.count * FLOATS_PER_POSITION &&
		instances.tangents.length === instances.positions.length &&
		instances.pathRows.length === instances.count &&
		instances.switchIds.length === instances.count &&
		instances.profileClasses.length === instances.count
	);
}

function hasValidPathOffsets(snapshot: StaticFabInspection3DSourceSnapshot): boolean {
	if (snapshot.pathOffsets[0] !== 0) return false;
	if ((snapshot.pathOffsets[snapshot.pathCount] as number) !== snapshot.pointCount) return false;
	let previous = 0;
	for (let pathRow = 0; pathRow < snapshot.pathCount; pathRow++) {
		const next = snapshot.pathOffsets[pathRow + 1] as number;
		if (next - previous < 2 || next > snapshot.pointCount) return false;
		if (Math.abs(snapshot.distances[previous] as number) > STATION_EPSILON_METERS) return false;
		for (let pointIndex = previous; pointIndex < next - 1; pointIndex++) {
			const offset = pointIndex * FLOATS_PER_SOURCE_POINT;
			const nextOffset = offset + FLOATS_PER_SOURCE_POINT;
			const segmentLength = Math.hypot(
				(snapshot.positions[nextOffset] as number) - (snapshot.positions[offset] as number),
				(snapshot.positions[nextOffset + 1] as number) - (snapshot.positions[offset + 1] as number),
			);
			if (
				(snapshot.distances[pointIndex + 1] as number) <=
					(snapshot.distances[pointIndex] as number) + STATION_EPSILON_METERS ||
				segmentLength <= Number.EPSILON ||
				segmentLength > STATIC_FAB_INSPECTION_3D_WORLD_CHUNK_METERS + STATION_EPSILON_METERS
			) {
				return false;
			}
		}
		previous = next;
	}
	return snapshot.pathCount !== 0 || snapshot.pointCount === 0;
}

function hasValidOwnedIntervals(snapshot: StaticFabInspection3DSourceSnapshot): boolean {
	if (snapshot.ownedIntervalOffsets[0] !== 0) return false;
	if (
		(snapshot.ownedIntervalOffsets[snapshot.pathCount] as number) !== snapshot.ownedIntervalCount
	) {
		return false;
	}
	for (let pathRow = 0; pathRow < snapshot.pathCount; pathRow++) {
		const start = snapshot.ownedIntervalOffsets[pathRow] as number;
		const end = snapshot.ownedIntervalOffsets[pathRow + 1] as number;
		if (start > end || end > snapshot.ownedIntervalCount) return false;
		const pointEnd = snapshot.pathOffsets[pathRow + 1] as number;
		const pathLength = snapshot.distances[pointEnd - 1] as number;
		let priorEnd = 0;
		for (let intervalRow = start; intervalRow < end; intervalRow++) {
			const intervalStart = snapshot.ownedIntervalStarts[intervalRow] as number;
			const intervalEnd = snapshot.ownedIntervalEnds[intervalRow] as number;
			if (
				!Number.isFinite(intervalStart) ||
				!Number.isFinite(intervalEnd) ||
				intervalStart < -STATION_EPSILON_METERS ||
				intervalStart < priorEnd - STATION_EPSILON_METERS ||
				intervalEnd <= intervalStart + STATION_EPSILON_METERS ||
				intervalEnd > pathLength + STATION_EPSILON_METERS
			) {
				return false;
			}
			priorEnd = intervalEnd;
		}
	}
	return true;
}

function sourceViews(snapshot: StaticFabInspection3DSourceSnapshot): readonly ArrayBufferView[] {
	return [
		snapshot.positions,
		snapshot.pointNormals,
		snapshot.distances,
		snapshot.pathOffsets,
		snapshot.ownedIntervalOffsets,
		snapshot.ownedIntervalStarts,
		snapshot.ownedIntervalEnds,
		snapshot.decorationPositions,
		snapshot.decorationTangents,
		snapshot.decorationKinds,
		snapshot.decorationOwnerPathRows,
		snapshot.decorationStableIds,
		snapshot.advancedSwitchIds,
		snapshot.advancedSwitchProfileClasses,
		snapshot.advancedSwitchSegmentRoles,
	];
}

function artifactViews(
	artifact: Pick<
		StaticFabInspection3DArtifact,
		"bed" | "beams" | "pickLines" | "supports" | "flows"
	>,
): readonly ArrayBufferView[] {
	return [
		artifact.bed.positions,
		artifact.bed.normals,
		artifact.bed.indices,
		artifact.beams.positions,
		artifact.beams.normals,
		artifact.beams.indices,
		artifact.pickLines.positions,
		artifact.pickLines.pathRows,
		artifact.supports.positions,
		artifact.supports.tangents,
		artifact.supports.pathRows,
		artifact.supports.kinds,
		artifact.supports.stableIds,
		artifact.flows.positions,
		artifact.flows.tangents,
		artifact.flows.pathRows,
		artifact.flows.kinds,
		artifact.flows.stableIds,
	];
}

function chunkedArtifactViews(
	artifact: Pick<
		StaticFabInspection3DChunkedArtifact,
		"railChunks" | "pickLines" | "supports" | "flows" | "advancedSwitches"
	>,
): readonly ArrayBufferView[] {
	const views: ArrayBufferView[] = [];
	for (const chunk of artifact.railChunks) {
		views.push(
			chunk.bed.positions,
			chunk.bed.normals,
			chunk.bed.indices,
			chunk.beams.positions,
			chunk.beams.normals,
			chunk.beams.indices,
		);
	}
	views.push(
		artifact.pickLines.positions,
		artifact.pickLines.pathRows,
		artifact.supports.positions,
		artifact.supports.tangents,
		artifact.supports.pathRows,
		artifact.supports.kinds,
		artifact.supports.stableIds,
		artifact.flows.positions,
		artifact.flows.tangents,
		artifact.flows.pathRows,
		artifact.flows.kinds,
		artifact.flows.stableIds,
		artifact.advancedSwitches.positions,
		artifact.advancedSwitches.tangents,
		artifact.advancedSwitches.pathRows,
		artifact.advancedSwitches.switchIds,
		artifact.advancedSwitches.profileClasses,
	);
	return views;
}

function collectUniqueArrayBuffers(views: readonly ArrayBufferView[]): ArrayBuffer[] {
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		if (view.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
	}
	return [...buffers];
}

function sumBufferByteLengths(views: readonly ArrayBufferView[]): number {
	return collectUniqueArrayBuffers(views).reduce((total, buffer) => total + buffer.byteLength, 0);
}

function hasOwnedDistinctBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		if (
			!(view.buffer instanceof ArrayBuffer) ||
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

function rowsWithinPathCount(rows: Uint32Array, pathCount: number): boolean {
	for (const row of rows) {
		if (row >= pathCount) return false;
	}
	return true;
}

function allFinite(values: Float32Array): boolean {
	for (const value of values) {
		if (!Number.isFinite(value)) return false;
	}
	return true;
}

function hasUnitPairs(values: Float32Array): boolean {
	for (let offset = 0; offset < values.length; offset += 2) {
		const x = values[offset] as number;
		const y = values[offset + 1] as number;
		if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
		const magnitude = Math.hypot(x, y);
		if (Math.abs(magnitude - 1) > NORMAL_MAGNITUDE_TOLERANCE) return false;
	}
	return true;
}

function hasNonZeroFinitePairs(values: Float32Array): boolean {
	for (let offset = 0; offset < values.length; offset += 2) {
		const x = values[offset] as number;
		const y = values[offset + 1] as number;
		if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) <= Number.EPSILON) {
			return false;
		}
	}
	return true;
}

function hasUnitTriples(values: Float32Array): boolean {
	for (let offset = 0; offset < values.length; offset += 3) {
		const x = values[offset] as number;
		const y = values[offset + 1] as number;
		const z = values[offset + 2] as number;
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
		const magnitude = Math.hypot(x, y, z);
		if (Math.abs(magnitude - 1) > NORMAL_MAGNITUDE_TOLERANCE) return false;
	}
	return true;
}

function hasUnitHorizontalTriples(values: Float32Array): boolean {
	for (let offset = 0; offset < values.length; offset += 3) {
		const x = values[offset] as number;
		const y = values[offset + 1] as number;
		const z = values[offset + 2] as number;
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
		if (Math.abs(y) > Number.EPSILON) return false;
		const magnitude = Math.hypot(x, z);
		if (Math.abs(magnitude - 1) > NORMAL_MAGNITUDE_TOLERANCE) return false;
	}
	return true;
}

function isFiniteBounds(value: unknown): value is StaticFabInspection3DBounds {
	if (!isRecord(value)) return false;
	const values = [value.minX, value.minY, value.minZ, value.maxX, value.maxY, value.maxZ];
	if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return false;
	return (
		(value.minX as number) <= (value.maxX as number) &&
		(value.minY as number) <= (value.maxY as number) &&
		(value.minZ as number) <= (value.maxZ as number)
	);
}

function checkedMultiply(left: number, right: number, label: string): number {
	const result = left * right;
	if (!Number.isSafeInteger(result) || result < 0 || result > 0xffff_ffff) {
		throw new RangeError(`3D inspection ${label} exceeds typed-array limits.`);
	}
	return result;
}

function checkedAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0 || result > 0xffff_ffff) {
		throw new RangeError(`3D inspection ${label} exceeds typed-array limits.`);
	}
	return result;
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
	if (!isNonNegativeSafeInteger(value)) {
		throw new RangeError(`3D inspection ${label} must be a non-negative safe integer.`);
	}
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isInt32(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= -0x8000_0000 &&
		value <= 0x7fff_ffff
	);
}

function isPositiveFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
