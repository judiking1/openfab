import type { CompiledPhysicalPaths } from "./PhysicalPathCompiler";

export interface PhysicalWorldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PhysicalPathSpatialStats {
	chunkSizeMeters: number;
	chunkCount: number;
	pathReferences: number;
}

export interface PhysicalPathSpatialIndexSnapshot {
	readonly pathCount: number;
	readonly chunkSizeMeters: number;
	readonly chunkCoordinates: Int32Array;
	readonly chunkOffsets: Uint32Array;
	readonly pathIndices: Uint32Array;
}

const DEFAULT_CHUNK_SIZE_METERS = 32;

/** Sparse world-chunk index used for viewport path queries without scanning the complete layout. */
export class PhysicalPathSpatialIndex {
	private readonly paths: CompiledPhysicalPaths;
	private readonly chunks: ReadonlyMap<string, Uint32Array>;
	private readonly stamps: Uint32Array;
	private readonly snapshot: PhysicalPathSpatialIndexSnapshot;
	private queryStamp = 0;
	readonly stats: PhysicalPathSpatialStats;

	constructor(
		paths: CompiledPhysicalPaths,
		chunkSizeMeters = DEFAULT_CHUNK_SIZE_METERS,
		preparedSnapshot?: PhysicalPathSpatialIndexSnapshot,
	) {
		this.paths = paths;
		this.snapshot = preparedSnapshot ?? compilePhysicalPathSpatialIndex(paths, chunkSizeMeters);
		validateSnapshot(this.snapshot, paths.pathCount);
		const chunkCount = this.snapshot.chunkOffsets.length - 1;
		const chunks = new Map<string, Uint32Array>();
		for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
			chunks.set(
				chunkKey(
					this.snapshot.chunkCoordinates[chunkIndex * 2] as number,
					this.snapshot.chunkCoordinates[chunkIndex * 2 + 1] as number,
				),
				this.snapshot.pathIndices.subarray(
					this.snapshot.chunkOffsets[chunkIndex] as number,
					this.snapshot.chunkOffsets[chunkIndex + 1] as number,
				),
			);
		}
		this.chunks = chunks;
		this.stamps = new Uint32Array(paths.pathCount);
		this.stats = {
			chunkSizeMeters: this.snapshot.chunkSizeMeters,
			chunkCount,
			pathReferences: this.snapshot.pathIndices.length,
		};
	}

	static fromSnapshot(
		paths: CompiledPhysicalPaths,
		snapshot: PhysicalPathSpatialIndexSnapshot,
	): PhysicalPathSpatialIndex {
		return new PhysicalPathSpatialIndex(paths, snapshot.chunkSizeMeters, snapshot);
	}

	captureSnapshot(): PhysicalPathSpatialIndexSnapshot {
		return this.snapshot;
	}

	query(bounds: PhysicalWorldBounds, target: number[] = []): number[] {
		target.length = 0;
		if (this.paths.pathCount === 0) return target;
		this.queryStamp++;
		if (this.queryStamp === 0xffffffff) {
			this.stamps.fill(0);
			this.queryStamp = 1;
		}
		const chunkSize = this.stats.chunkSizeMeters;
		const minChunkX = Math.floor(bounds.minX / chunkSize);
		const minChunkY = Math.floor(bounds.minY / chunkSize);
		const maxChunkX = Math.floor(bounds.maxX / chunkSize);
		const maxChunkY = Math.floor(bounds.maxY / chunkSize);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const bucket = this.chunks.get(chunkKey(chunkX, chunkY));
				if (!bucket) continue;
				for (const pathIndex of bucket) {
					if ((this.stamps[pathIndex] as number) === this.queryStamp) continue;
					this.stamps[pathIndex] = this.queryStamp;
					if (intersectsPath(this.paths, pathIndex, bounds)) target.push(pathIndex);
				}
			}
		}
		return target;
	}
}

export function compilePhysicalPathSpatialIndex(
	paths: CompiledPhysicalPaths,
	chunkSizeMeters = DEFAULT_CHUNK_SIZE_METERS,
): PhysicalPathSpatialIndexSnapshot {
	const chunkSize = Math.max(1, Math.floor(chunkSizeMeters));
	const mutable = new Map<
		string,
		{ readonly x: number; readonly y: number; readonly pathIndices: number[] }
	>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const offset = pathIndex * 4;
		const minChunkX = Math.floor((paths.bounds[offset] as number) / chunkSize);
		const minChunkY = Math.floor((paths.bounds[offset + 1] as number) / chunkSize);
		const maxChunkX = Math.floor((paths.bounds[offset + 2] as number) / chunkSize);
		const maxChunkY = Math.floor((paths.bounds[offset + 3] as number) / chunkSize);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const key = chunkKey(chunkX, chunkY);
				const bucket = mutable.get(key);
				if (bucket) bucket.pathIndices.push(pathIndex);
				else mutable.set(key, { x: chunkX, y: chunkY, pathIndices: [pathIndex] });
			}
		}
	}
	const entries = [...mutable.values()].sort((left, right) => left.y - right.y || left.x - right.x);
	const chunkCoordinates = new Int32Array(entries.length * 2);
	const chunkOffsets = new Uint32Array(entries.length + 1);
	let pathReferenceCount = 0;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index] as (typeof entries)[number];
		chunkCoordinates[index * 2] = entry.x;
		chunkCoordinates[index * 2 + 1] = entry.y;
		chunkOffsets[index] = pathReferenceCount;
		pathReferenceCount += entry.pathIndices.length;
	}
	chunkOffsets[entries.length] = pathReferenceCount;
	const pathIndices = new Uint32Array(pathReferenceCount);
	let writeIndex = 0;
	for (const entry of entries) {
		for (const pathIndex of entry.pathIndices) pathIndices[writeIndex++] = pathIndex;
	}
	return Object.freeze({
		pathCount: paths.pathCount,
		chunkSizeMeters: chunkSize,
		chunkCoordinates,
		chunkOffsets,
		pathIndices,
	});
}

function validateSnapshot(snapshot: PhysicalPathSpatialIndexSnapshot, pathCount: number): void {
	const chunkCount = snapshot.chunkOffsets.length - 1;
	if (
		snapshot.pathCount !== pathCount ||
		!Number.isSafeInteger(snapshot.pathCount) ||
		snapshot.pathCount < 0 ||
		!Number.isSafeInteger(snapshot.chunkSizeMeters) ||
		snapshot.chunkSizeMeters <= 0 ||
		!(snapshot.chunkCoordinates instanceof Int32Array) ||
		!(snapshot.chunkOffsets instanceof Uint32Array) ||
		!(snapshot.pathIndices instanceof Uint32Array) ||
		chunkCount < 0 ||
		snapshot.chunkCoordinates.length !== chunkCount * 2 ||
		snapshot.chunkOffsets[0] !== 0 ||
		snapshot.chunkOffsets[chunkCount] !== snapshot.pathIndices.length
	) {
		throw new Error("Physical path spatial snapshot is malformed.");
	}
	validateSpatialCsr(snapshot.chunkOffsets, snapshot.pathIndices, pathCount);
}

function validateSpatialCsr(offsets: Uint32Array, indices: Uint32Array, itemCount: number): void {
	let previous = 0;
	for (const offset of offsets) {
		if (offset < previous || offset > indices.length) {
			throw new Error("Physical path spatial snapshot is malformed.");
		}
		previous = offset;
	}
	for (const index of indices) {
		if (index >= itemCount) throw new Error("Physical path spatial snapshot is malformed.");
	}
}

function intersectsPath(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	bounds: PhysicalWorldBounds,
): boolean {
	const offset = pathIndex * 4;
	return !(
		(paths.bounds[offset + 2] as number) < bounds.minX ||
		(paths.bounds[offset] as number) > bounds.maxX ||
		(paths.bounds[offset + 3] as number) < bounds.minY ||
		(paths.bounds[offset + 1] as number) > bounds.maxY
	);
}

function chunkKey(x: number, y: number): string {
	return `${x},${y}`;
}
