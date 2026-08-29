import { PATH_KIND, type CompiledPhysicalPaths } from "./PhysicalPathCompiler";
import { buildPhysicalPathAdjacency } from "./PhysicalPathFlow";
import {
	PHYSICAL_PATH_IDENTITY_WIDTH,
	comparePhysicalPathIdentity,
	physicalPathIdentity,
} from "./PhysicalPathIdentity";

export interface PhysicalPathTopologyAnalysis {
	readonly paths: number;
	readonly invalidPaths: number;
	readonly openPaths: number;
	readonly strongComponents: number;
	readonly stronglyConnected: boolean;
	/** Stable identity rows for every path with no predecessor or no successor. */
	readonly openPathIdentities: Int32Array;
	/** One stable identity row for every directed strong component. */
	readonly strongComponentPathIdentities: Int32Array;
}

/** Analyze the compiled directed graph without depending on authored-cell insertion order. */
export function analyzePhysicalPathTopology(
	paths: CompiledPhysicalPaths,
): PhysicalPathTopologyAnalysis {
	const adjacency = buildPhysicalPathAdjacency(paths);
	const valid = new Uint8Array(paths.pathCount);
	const incomingCounts = new Uint32Array(paths.pathCount);
	let validPathCount = 0;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		valid[pathIndex] = 1;
		validPathCount++;
	}
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (valid[pathIndex] === 0) continue;
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let edge = start; edge < end; edge++) {
			const target = adjacency.targets[edge] as number;
			if (valid[target] !== 0) incomingCounts[target]++;
		}
	}

	const openPathIndices: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (valid[pathIndex] === 0) continue;
		const outgoingCount =
			(adjacency.offsets[pathIndex + 1] as number) - (adjacency.offsets[pathIndex] as number);
		if (incomingCounts[pathIndex] === 0 || outgoingCount === 0) openPathIndices.push(pathIndex);
	}
	openPathIndices.sort((left, right) => comparePhysicalPathIdentity(paths, left, right));

	const reverseOffsets = new Uint32Array(paths.pathCount + 1);
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		reverseOffsets[pathIndex + 1] =
			(reverseOffsets[pathIndex] as number) + (incomingCounts[pathIndex] as number);
	}
	const reverseTargets = new Uint32Array(reverseOffsets[paths.pathCount] as number);
	const reverseCursors = reverseOffsets.slice(0, paths.pathCount);
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (valid[pathIndex] === 0) continue;
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let edge = start; edge < end; edge++) {
			const target = adjacency.targets[edge] as number;
			if (valid[target] === 0) continue;
			const cursor = reverseCursors[target] as number;
			reverseTargets[cursor] = pathIndex;
			reverseCursors[target] = cursor + 1;
		}
	}

	const visited = new Uint8Array(paths.pathCount);
	const finishOrder: number[] = [];
	for (let startPath = 0; startPath < paths.pathCount; startPath++) {
		if (valid[startPath] === 0 || visited[startPath] !== 0) continue;
		visited[startPath] = 1;
		const nodes = [startPath];
		const cursors = [adjacency.offsets[startPath] as number];
		while (nodes.length > 0) {
			const stackIndex = nodes.length - 1;
			const current = nodes[stackIndex] as number;
			let cursor = cursors[stackIndex] as number;
			const end = adjacency.offsets[current + 1] as number;
			let descended = false;
			while (cursor < end) {
				const target = adjacency.targets[cursor] as number;
				cursor++;
				cursors[stackIndex] = cursor;
				if (valid[target] === 0 || visited[target] !== 0) continue;
				visited[target] = 1;
				nodes.push(target);
				cursors.push(adjacency.offsets[target] as number);
				descended = true;
				break;
			}
			if (descended) continue;
			finishOrder.push(current);
			nodes.pop();
			cursors.pop();
		}
	}

	visited.fill(0);
	const representativeIndices: number[] = [];
	for (let orderIndex = finishOrder.length - 1; orderIndex >= 0; orderIndex--) {
		const startPath = finishOrder[orderIndex] as number;
		if (visited[startPath] !== 0) continue;
		let representative = startPath;
		visited[startPath] = 1;
		const stack = [startPath];
		while (stack.length > 0) {
			const current = stack.pop() as number;
			if (comparePhysicalPathIdentity(paths, current, representative) < 0) {
				representative = current;
			}
			const start = reverseOffsets[current] as number;
			const end = reverseOffsets[current + 1] as number;
			for (let edge = start; edge < end; edge++) {
				const predecessor = reverseTargets[edge] as number;
				if (visited[predecessor] !== 0) continue;
				visited[predecessor] = 1;
				stack.push(predecessor);
			}
		}
		representativeIndices.push(representative);
	}
	representativeIndices.sort((left, right) => comparePhysicalPathIdentity(paths, left, right));

	const strongComponents = representativeIndices.length;
	return Object.freeze({
		paths: validPathCount,
		invalidPaths: paths.pathCount - validPathCount,
		openPaths: openPathIndices.length,
		strongComponents,
		stronglyConnected: validPathCount > 0 && strongComponents === 1,
		openPathIdentities: flattenPathIdentities(paths, openPathIndices),
		strongComponentPathIdentities: flattenPathIdentities(paths, representativeIndices),
	});
}

function flattenPathIdentities(
	paths: CompiledPhysicalPaths,
	pathIndices: readonly number[],
): Int32Array {
	const identities = new Int32Array(pathIndices.length * PHYSICAL_PATH_IDENTITY_WIDTH);
	for (let index = 0; index < pathIndices.length; index++) {
		identities.set(
			physicalPathIdentity(paths, pathIndices[index] as number),
			index * PHYSICAL_PATH_IDENTITY_WIDTH,
		);
	}
	return identities;
}
