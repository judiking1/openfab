import type { CompiledPhysicalPaths } from "../compile/PhysicalPathCompiler";
import {
	buildPhysicalPathAdjacency,
	type PhysicalPathAdjacency,
} from "../compile/PhysicalPathFlow";
import {
	compilePhysicalPathCellIndex,
	type Int32CsrIndexSnapshot,
} from "../compile/PhysicalPathLookup";
import {
	compilePhysicalPathSpatialIndex,
	type PhysicalPathSpatialIndexSnapshot,
} from "../compile/PhysicalPathSpatialIndex";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type CompiledRailPresentation,
	compilePhysicalRailPresentation,
	RAIL_DECORATION_KIND,
} from "./PhysicalRailPresentation";

export interface PhysicalRailDecorationCounts {
	readonly joints: number;
	readonly supports: number;
	readonly flowMarkers: number;
}

export interface CompiledPhysicalRailRenderArtifacts {
	readonly revision: number;
	readonly pathCount: number;
	readonly presentation: CompiledRailPresentation;
	readonly spatialIndex: PhysicalPathSpatialIndexSnapshot;
	readonly cellIndex: Int32CsrIndexSnapshot;
	readonly adjacency: PhysicalPathAdjacency;
	readonly decorationCounts: PhysicalRailDecorationCounts;
}

/** Canvas-independent typed resources that may be compiled in the startup Worker. */
export function compilePhysicalRailRenderArtifacts(
	paths: CompiledPhysicalPaths,
	cellIndex = compilePhysicalPathCellIndex(paths),
): CompiledPhysicalRailRenderArtifacts {
	const presentation = compilePhysicalRailPresentation(paths);
	let joints = 0;
	let supports = 0;
	let flowMarkers = 0;
	for (const kind of presentation.decorations.kinds) {
		if (kind <= RAIL_DECORATION_KIND.SWITCH_JOINT) joints++;
		else if (kind === RAIL_DECORATION_KIND.SUPPORT) supports++;
		else if (kind === RAIL_DECORATION_KIND.FLOW || kind === RAIL_DECORATION_KIND.FLOW_COMPACT) {
			flowMarkers++;
		}
	}
	return Object.freeze({
		revision: paths.revision,
		pathCount: paths.pathCount,
		presentation,
		spatialIndex: compilePhysicalPathSpatialIndex(paths),
		cellIndex,
		adjacency: buildPhysicalPathAdjacency(paths),
		decorationCounts: Object.freeze({ joints, supports, flowMarkers }),
	});
}

export function physicalRailRenderArtifactsMatch(
	paths: CompiledPhysicalPaths,
	artifacts: CompiledPhysicalRailRenderArtifacts,
): boolean {
	return (
		artifacts.presentation.source === paths &&
		artifacts.revision === paths.revision &&
		artifacts.pathCount === paths.pathCount &&
		artifacts.presentation.source.revision === paths.revision &&
		artifacts.presentation.source.pathCount === paths.pathCount &&
		artifacts.spatialIndex.pathCount === paths.pathCount
	);
}

export function checksumPhysicalRailRenderArtifacts(
	artifacts: CompiledPhysicalRailRenderArtifacts,
	physicalFingerprint: string,
): string {
	const { checksum, views } = createRenderArtifactChecksum(artifacts, physicalFingerprint);
	checksum.addViews(views);
	return checksum.digest();
}

export async function checksumPhysicalRailRenderArtifactsCooperatively(
	artifacts: CompiledPhysicalRailRenderArtifacts,
	physicalFingerprint: string,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const { checksum, views } = createRenderArtifactChecksum(artifacts, physicalFingerprint);
	await checksum.addViewsCooperatively(views, checkpoint);
	return checksum.digest();
}

function createRenderArtifactChecksum(
	artifacts: CompiledPhysicalRailRenderArtifacts,
	physicalFingerprint: string,
): {
	readonly checksum: OrderedTypedChecksum;
	readonly views: readonly ArrayBufferView[];
} {
	const { presentation, spatialIndex, cellIndex, adjacency, decorationCounts } = artifacts;
	const { profile, runs, decorations } = presentation;
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		artifacts.revision,
		artifacts.pathCount,
		presentation.source.revision,
		presentation.source.pathCount,
		presentation.maxLateralExtentMeters,
		profile.version,
		profile.constructionShadowWidthMeters,
		profile.bedWidthMeters,
		profile.beamCenterOffsetMeters,
		profile.beamWidthMeters,
		profile.beamHighlightWidthMeters,
		profile.slotWidthMeters,
		profile.jointIntervalMeters,
		profile.jointHalfSpanMeters,
		profile.supportIntervalMeters,
		profile.supportHalfSpanMeters,
		profile.supportJointExclusionMeters,
		profile.supportCurvatureProbeMeters,
		profile.supportMinimumTangentDot,
		profile.flowIntervalMeters,
		profile.flowHardwareExclusionMeters,
		runs.count,
		decorations.count,
		spatialIndex.pathCount,
		spatialIndex.chunkSizeMeters,
		cellIndex.keyWidth,
		decorationCounts.joints,
		decorationCounts.supports,
		decorationCounts.flowMarkers,
	]);
	checksum.addStrings([physicalFingerprint, profile.id, profile.engineeringStatus]);
	return {
		checksum,
		views: [
			presentation.pointNormals,
			runs.offsets,
			runs.pathIndices,
			runs.pathStarts,
			runs.lengths,
			runs.closed,
			runs.pathRunIndices,
			runs.pathRunStarts,
			decorations.pathOffsets,
			decorations.ownerPathIndices,
			decorations.runIndices,
			decorations.pathStations,
			decorations.runStations,
			decorations.positions,
			decorations.tangents,
			decorations.kinds,
			decorations.priorities,
			decorations.stableIds,
			spatialIndex.chunkCoordinates,
			spatialIndex.chunkOffsets,
			spatialIndex.pathIndices,
			cellIndex.keys,
			cellIndex.offsets,
			cellIndex.values,
			adjacency.offsets,
			adjacency.targets,
		],
	};
}
