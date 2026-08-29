import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	buildPhysicalPathAdjacency,
	type PhysicalPathAdjacency,
	reversePhysicalPathAdjacency,
} from "./PhysicalPathFlow";
import {
	compilePhysicalPathCellIndex,
	compilePhysicalPathIdentityIndex,
	compilePhysicalPathSwitchIndex,
	type Int32CsrIndexSnapshot,
} from "./PhysicalPathLookup";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import {
	compileRailEnvelopeSpatialIndex,
	type RailEnvelopeSpatialIndexSnapshot,
} from "./RailClearanceCompiler";

export interface RailDraftPreparedArtifacts {
	readonly revision: number;
	readonly pathCount: number;
	readonly envelopeCount: number;
	readonly envelopeSpatialIndex: RailEnvelopeSpatialIndexSnapshot;
	readonly pathCellIndex: Int32CsrIndexSnapshot;
	readonly pathSwitchIndex: Int32CsrIndexSnapshot;
	readonly pathIdentityIndex: Int32CsrIndexSnapshot;
	readonly forwardAdjacency: PhysicalPathAdjacency;
	readonly reverseAdjacency: PhysicalPathAdjacency;
}

const validatedRailDraftPreparedArtifacts = new WeakSet<RailDraftPreparedArtifacts>();

/** Precompute immutable committed broad-phase resources away from pointer interaction. */
export function compileRailDraftPreparedArtifacts(
	layout: CompiledPhysicalLayout,
	pathCellIndex = compilePhysicalPathCellIndex(layout.paths),
	forwardAdjacency = buildPhysicalPathAdjacency(layout.paths),
): RailDraftPreparedArtifacts {
	const artifacts = Object.freeze({
		revision: layout.revision,
		pathCount: layout.paths.pathCount,
		envelopeCount: layout.clearance.envelopes.count,
		envelopeSpatialIndex: compileRailEnvelopeSpatialIndex(layout.clearance.envelopes),
		pathCellIndex,
		pathSwitchIndex: compilePhysicalPathSwitchIndex(layout.paths),
		pathIdentityIndex: compilePhysicalPathIdentityIndex(layout.paths),
		forwardAdjacency,
		reverseAdjacency: reversePhysicalPathAdjacency(forwardAdjacency, layout.paths.pathCount),
	});
	validateRailDraftPreparedAdjacencySemantics(layout, artifacts);
	return artifacts;
}

export function railDraftPreparedArtifactsMatch(
	layout: CompiledPhysicalLayout,
	artifacts: RailDraftPreparedArtifacts,
): boolean {
	return (
		artifacts.revision === layout.revision &&
		artifacts.pathCount === layout.paths.pathCount &&
		artifacts.envelopeCount === layout.clearance.envelopes.count &&
		adjacencyShapeMatches(artifacts.forwardAdjacency, layout.paths.pathCount) &&
		adjacencyShapeMatches(artifacts.reverseAdjacency, layout.paths.pathCount)
	);
}

/** Only artifacts compiled locally or independently validated after transfer may be adopted. */
export function railDraftPreparedArtifactsReadyForAdoption(
	layout: CompiledPhysicalLayout,
	artifacts: RailDraftPreparedArtifacts,
): boolean {
	return (
		railDraftPreparedArtifactsMatch(layout, artifacts) &&
		validatedRailDraftPreparedArtifacts.has(artifacts)
	);
}

/** Validate transferred CSR semantics without creating another adjacency on the main thread. */
export async function validateRailDraftPreparedAdjacencySemanticsCooperatively(
	layout: CompiledPhysicalLayout,
	artifacts: RailDraftPreparedArtifacts,
	canonicalForwardAdjacency: PhysicalPathAdjacency,
	checkpoint: () => Promise<void>,
): Promise<void> {
	if (artifacts.forwardAdjacency !== canonicalForwardAdjacency) {
		throw new Error("Prepared forward adjacency is not the canonical render adjacency.");
	}
	let operations = 0;
	for (const _step of railDraftPreparedAdjacencySemanticSteps(layout, artifacts)) {
		void _step;
		operations++;
		if ((operations & 127) === 0) await checkpoint();
	}
	validatedRailDraftPreparedArtifacts.add(artifacts);
}

function validateRailDraftPreparedAdjacencySemantics(
	layout: CompiledPhysicalLayout,
	artifacts: RailDraftPreparedArtifacts,
): void {
	for (const _step of railDraftPreparedAdjacencySemanticSteps(layout, artifacts)) {
		void _step;
	}
	validatedRailDraftPreparedArtifacts.add(artifacts);
}

function* railDraftPreparedAdjacencySemanticSteps(
	layout: CompiledPhysicalLayout,
	artifacts: RailDraftPreparedArtifacts,
): Generator<void> {
	if (!railDraftPreparedArtifactsMatch(layout, artifacts)) {
		throw new Error("Prepared draft artifacts do not match the physical layout.");
	}
	const pathCount = layout.paths.pathCount;
	validateAdjacencyStructure(artifacts.forwardAdjacency, pathCount, "forward");
	yield* adjacencyValidationSteps(artifacts.forwardAdjacency, pathCount, "forward");
	validateAdjacencyStructure(artifacts.reverseAdjacency, pathCount, "reverse");
	yield* adjacencyValidationSteps(artifacts.reverseAdjacency, pathCount, "reverse");
	if (artifacts.forwardAdjacency.targets.length !== artifacts.reverseAdjacency.targets.length) {
		throw new Error("Prepared reverse adjacency edge count diverged from forward adjacency.");
	}
	const forward = artifacts.forwardAdjacency;
	const reverse = artifacts.reverseAdjacency;
	for (let sourcePathIndex = 0; sourcePathIndex < pathCount; sourcePathIndex++) {
		const start = forward.offsets[sourcePathIndex] as number;
		const end = forward.offsets[sourcePathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const targetPathIndex = forward.targets[row] as number;
			const reverseStart = reverse.offsets[targetPathIndex] as number;
			const reverseEnd = reverse.offsets[targetPathIndex + 1] as number;
			if (!sortedRowContains(reverse.targets, reverseStart, reverseEnd, sourcePathIndex)) {
				throw new Error(
					`Prepared reverse adjacency is not the transpose of forward edge ${sourcePathIndex} -> ${targetPathIndex}.`,
				);
			}
			yield;
		}
	}
}

function validateAdjacencyStructure(
	adjacency: PhysicalPathAdjacency,
	pathCount: number,
	label: string,
): void {
	if (!adjacencyShapeMatches(adjacency, pathCount)) {
		throw new Error(`Prepared ${label} adjacency shape is invalid.`);
	}
}

function* adjacencyValidationSteps(
	adjacency: PhysicalPathAdjacency,
	pathCount: number,
	label: string,
): Generator<void> {
	let previousOffset = 0;
	for (let pathIndex = 0; pathIndex <= pathCount; pathIndex++) {
		const offset = adjacency.offsets[pathIndex] as number;
		if (offset < previousOffset || offset > adjacency.targets.length) {
			throw new Error(`Prepared ${label} adjacency offset ${pathIndex} is not monotonic.`);
		}
		previousOffset = offset;
		yield;
	}
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		let previousTarget = -1;
		for (let row = start; row < end; row++) {
			const target = adjacency.targets[row] as number;
			if (target >= pathCount) {
				throw new Error(`Prepared ${label} adjacency target ${target} is out of range.`);
			}
			if (target <= previousTarget) {
				throw new Error(`Prepared ${label} adjacency row ${pathIndex} is not strictly sorted.`);
			}
			previousTarget = target;
			yield;
		}
	}
}

function sortedRowContains(
	targets: Uint32Array,
	start: number,
	end: number,
	needle: number,
): boolean {
	let low = start;
	let high = end;
	while (low < high) {
		const middle = low + ((high - low) >> 1);
		const candidate = targets[middle] as number;
		if (candidate < needle) low = middle + 1;
		else high = middle;
	}
	return low < end && targets[low] === needle;
}

export function checksumRailDraftPreparedArtifacts(
	artifacts: RailDraftPreparedArtifacts,
	physicalFingerprint: string,
): string {
	const { checksum, views } = createDraftArtifactChecksum(artifacts, physicalFingerprint);
	checksum.addViews(views);
	return checksum.digest();
}

export async function checksumRailDraftPreparedArtifactsCooperatively(
	artifacts: RailDraftPreparedArtifacts,
	physicalFingerprint: string,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const { checksum, views } = createDraftArtifactChecksum(artifacts, physicalFingerprint);
	await checksum.addViewsCooperatively(views, checkpoint);
	return checksum.digest();
}

function createDraftArtifactChecksum(
	artifacts: RailDraftPreparedArtifacts,
	physicalFingerprint: string,
): {
	readonly checksum: OrderedTypedChecksum;
	readonly views: readonly ArrayBufferView[];
} {
	const checksum = new OrderedTypedChecksum();
	const envelope = artifacts.envelopeSpatialIndex;
	checksum.addNumbers([
		artifacts.revision,
		artifacts.pathCount,
		artifacts.envelopeCount,
		envelope.envelopeCount,
		envelope.chunkSizeMeters,
		artifacts.pathCellIndex.keyWidth,
		artifacts.pathSwitchIndex.keyWidth,
		artifacts.pathIdentityIndex.keyWidth,
		artifacts.forwardAdjacency.targets.length,
		artifacts.reverseAdjacency.targets.length,
	]);
	checksum.addStrings([physicalFingerprint]);
	return {
		checksum,
		views: [
			envelope.chunkCoordinates,
			envelope.chunkOffsets,
			envelope.envelopeIndices,
			artifacts.pathCellIndex.keys,
			artifacts.pathCellIndex.offsets,
			artifacts.pathCellIndex.values,
			artifacts.pathSwitchIndex.keys,
			artifacts.pathSwitchIndex.offsets,
			artifacts.pathSwitchIndex.values,
			artifacts.pathIdentityIndex.keys,
			artifacts.pathIdentityIndex.offsets,
			artifacts.pathIdentityIndex.values,
			artifacts.forwardAdjacency.offsets,
			artifacts.forwardAdjacency.targets,
			artifacts.reverseAdjacency.offsets,
			artifacts.reverseAdjacency.targets,
		],
	};
}

function adjacencyShapeMatches(adjacency: PhysicalPathAdjacency, pathCount: number): boolean {
	return (
		adjacency.offsets instanceof Uint32Array &&
		adjacency.targets instanceof Uint32Array &&
		adjacency.offsets.length === pathCount + 1 &&
		adjacency.offsets[0] === 0 &&
		adjacency.offsets[pathCount] === adjacency.targets.length
	);
}
