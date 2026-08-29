import type { CompiledPhysicalPaths } from "./PhysicalPathCompiler";
import {
	DEFAULT_RAIL_CLEARANCE_PROFILE,
	type RailClearanceProfile,
	railClearanceProfileError,
} from "./RailClearanceProfile";

export interface CompiledRailEnvelopes {
	readonly profileId: string;
	readonly profileVersion: number;
	readonly count: number;
	/** Path-to-envelope CSR; zero-length physical paths own an empty row. */
	readonly pathOffsets: Uint32Array;
	readonly pathIndices: Uint32Array;
	/** Global physical point index at the start of each sampled centerline segment. */
	readonly pointIndices: Uint32Array;
	readonly stationStarts: Float32Array;
	readonly stationEnds: Float32Array;
	readonly startPoints: Float32Array;
	readonly endPoints: Float32Array;
	/** Installation envelope AABB, including the declared approximation tolerance. */
	readonly bounds: Float32Array;
	readonly beamRadiusMillimeters: Uint16Array;
	readonly ohtSweepRadiusMillimeters: Uint16Array;
	readonly installationRadiusMillimeters: Uint16Array;
	readonly approximationToleranceMillimeters: Uint16Array;
}

export interface RailEnvelopeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface RailEnvelopeSpatialStats {
	readonly chunkSizeMeters: number;
	readonly chunkCount: number;
	readonly envelopeReferences: number;
}

export interface RailEnvelopeSpatialIndexSnapshot {
	readonly envelopeCount: number;
	readonly chunkSizeMeters: number;
	readonly chunkCoordinates: Int32Array;
	readonly chunkOffsets: Uint32Array;
	readonly envelopeIndices: Uint32Array;
}

export const DEFAULT_ENVELOPE_CHUNK_SIZE_METERS = 8;
const MIN_SEGMENT_LENGTH_METERS = 1e-7;
const MIN_SIGNED_INT32 = -0x8000_0000;
const MAX_SIGNED_INT32 = 0x7fff_ffff;

interface PrevalidatedRailEnvelopeSpatialIndex {
	readonly snapshot: RailEnvelopeSpatialIndexSnapshot;
	readonly chunks: ReadonlyMap<string, Uint32Array>;
}

/** Int32Array publication must preserve the exact derived sparse-grid coordinate. */
export function railEnvelopeChunkCoordinateIsCanonical(coordinate: number): boolean {
	return (
		Number.isInteger(coordinate) && coordinate >= MIN_SIGNED_INT32 && coordinate <= MAX_SIGNED_INT32
	);
}

/** Derive continuous capsule-chain ownership from the canonical compiled centerline samples. */
export function compileRailEnvelopes(
	paths: CompiledPhysicalPaths,
	profile: RailClearanceProfile = DEFAULT_RAIL_CLEARANCE_PROFILE,
): CompiledRailEnvelopes {
	const profileError = railClearanceProfileError(profile);
	if (profileError) throw new Error(`Invalid rail clearance profile: ${profileError}`);

	const pathOffsets = new Uint32Array(paths.pathCount + 1);
	const pathIndices: number[] = [];
	const pointIndices: number[] = [];
	const stationStarts: number[] = [];
	const stationEnds: number[] = [];
	const startPoints: number[] = [];
	const endPoints: number[] = [];
	const bounds: number[] = [];
	const beamRadii: number[] = [];
	const ohtRadii: number[] = [];
	const installationRadii: number[] = [];
	const approximationTolerances: number[] = [];
	const boundsRadiusMeters =
		(profile.installationRadiusMillimeters + profile.approximationToleranceMillimeters) / 1_000;

	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		pathOffsets[pathIndex] = pathIndices.length;
		const pointStart = paths.offsets[pathIndex] as number;
		const pointEnd = paths.offsets[pathIndex + 1] as number;
		for (let pointIndex = pointStart; pointIndex < pointEnd - 1; pointIndex++) {
			const stationStart = paths.distances[pointIndex] as number;
			const stationEnd = paths.distances[pointIndex + 1] as number;
			if (!Number.isFinite(stationStart) || !Number.isFinite(stationEnd)) {
				throw new Error(`Physical path ${pathIndex} has non-finite clearance stations.`);
			}
			if (stationEnd < stationStart) {
				throw new Error(`Physical path ${pathIndex} has decreasing clearance stations.`);
			}
			const x0 = paths.positions[pointIndex * 2] as number;
			const y0 = paths.positions[pointIndex * 2 + 1] as number;
			const x1 = paths.positions[(pointIndex + 1) * 2] as number;
			const y1 = paths.positions[(pointIndex + 1) * 2 + 1] as number;
			if (![x0, y0, x1, y1].every(Number.isFinite)) {
				throw new Error(`Physical path ${pathIndex} has non-finite clearance geometry.`);
			}
			const stationSpan = stationEnd - stationStart;
			const geometricSpan = Math.hypot(x1 - x0, y1 - y0);
			if (stationSpan <= MIN_SEGMENT_LENGTH_METERS) {
				if (geometricSpan <= MIN_SEGMENT_LENGTH_METERS) continue;
				throw new Error(
					`Physical path ${pathIndex} has nonzero geometry with zero clearance station span.`,
				);
			}
			if (geometricSpan <= MIN_SEGMENT_LENGTH_METERS) {
				throw new Error(
					`Physical path ${pathIndex} has zero geometry with a positive clearance station span.`,
				);
			}

			pathIndices.push(pathIndex);
			pointIndices.push(pointIndex);
			stationStarts.push(stationStart);
			stationEnds.push(stationEnd);
			startPoints.push(x0, y0);
			endPoints.push(x1, y1);
			bounds.push(
				Math.min(x0, x1) - boundsRadiusMeters,
				Math.min(y0, y1) - boundsRadiusMeters,
				Math.max(x0, x1) + boundsRadiusMeters,
				Math.max(y0, y1) + boundsRadiusMeters,
			);
			beamRadii.push(profile.beamRadiusMillimeters);
			ohtRadii.push(profile.ohtSweepRadiusMillimeters);
			installationRadii.push(profile.installationRadiusMillimeters);
			approximationTolerances.push(profile.approximationToleranceMillimeters);
		}
	}
	pathOffsets[paths.pathCount] = pathIndices.length;

	return {
		profileId: profile.id,
		profileVersion: profile.version,
		count: pathIndices.length,
		pathOffsets,
		pathIndices: new Uint32Array(pathIndices),
		pointIndices: new Uint32Array(pointIndices),
		stationStarts: new Float32Array(stationStarts),
		stationEnds: new Float32Array(stationEnds),
		startPoints: new Float32Array(startPoints),
		endPoints: new Float32Array(endPoints),
		bounds: new Float32Array(bounds),
		beamRadiusMillimeters: new Uint16Array(beamRadii),
		ohtSweepRadiusMillimeters: new Uint16Array(ohtRadii),
		installationRadiusMillimeters: new Uint16Array(installationRadii),
		approximationToleranceMillimeters: new Uint16Array(approximationTolerances),
	};
}

/** Sparse broad-phase index over expanded installation-envelope bounds. */
export class RailEnvelopeSpatialIndex {
	private readonly envelopes: CompiledRailEnvelopes;
	private readonly chunks: ReadonlyMap<string, Uint32Array>;
	private readonly stamps: Uint32Array;
	private readonly snapshot: RailEnvelopeSpatialIndexSnapshot;
	private queryStamp = 0;
	readonly stats: RailEnvelopeSpatialStats;

	constructor(
		envelopes: CompiledRailEnvelopes,
		chunkSizeMeters = DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		preparedSnapshot?: RailEnvelopeSpatialIndexSnapshot,
		prevalidated?: PrevalidatedRailEnvelopeSpatialIndex,
	) {
		this.envelopes = envelopes;
		this.snapshot =
			prevalidated?.snapshot ??
			preparedSnapshot ??
			compileRailEnvelopeSpatialIndex(envelopes, chunkSizeMeters);
		if (!prevalidated) validateEnvelopeSpatialSnapshot(envelopes, this.snapshot);
		const chunkCount = this.snapshot.chunkOffsets.length - 1;
		this.chunks = prevalidated?.chunks ?? hydrateEnvelopeSpatialChunks(this.snapshot);
		this.stamps = new Uint32Array(envelopes.count);
		this.stats = {
			chunkSizeMeters: this.snapshot.chunkSizeMeters,
			chunkCount,
			envelopeReferences: this.snapshot.envelopeIndices.length,
		};
	}

	static fromSnapshot(
		envelopes: CompiledRailEnvelopes,
		snapshot: RailEnvelopeSpatialIndexSnapshot,
	): RailEnvelopeSpatialIndex {
		return new RailEnvelopeSpatialIndex(envelopes, snapshot.chunkSizeMeters, snapshot);
	}

	static async fromSnapshotCooperatively(
		envelopes: CompiledRailEnvelopes,
		snapshot: RailEnvelopeSpatialIndexSnapshot,
		checkpoint: () => Promise<void>,
	): Promise<RailEnvelopeSpatialIndex> {
		let operations = 0;
		for (const _step of envelopeSpatialSnapshotValidationSteps(envelopes, snapshot)) {
			void _step;
			operations++;
			if ((operations & 127) === 0) await checkpoint();
		}
		const chunks = new Map<string, Uint32Array>();
		const chunkCount = snapshot.chunkOffsets.length - 1;
		for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
			chunks.set(
				chunkKey(
					snapshot.chunkCoordinates[chunkIndex * 2] as number,
					snapshot.chunkCoordinates[chunkIndex * 2 + 1] as number,
				),
				snapshot.envelopeIndices.subarray(
					snapshot.chunkOffsets[chunkIndex] as number,
					snapshot.chunkOffsets[chunkIndex + 1] as number,
				),
			);
			if (((chunkIndex + 1) & 127) === 0) await checkpoint();
		}
		await checkpoint();
		return new RailEnvelopeSpatialIndex(envelopes, snapshot.chunkSizeMeters, snapshot, {
			snapshot,
			chunks,
		});
	}

	captureSnapshot(): RailEnvelopeSpatialIndexSnapshot {
		return this.snapshot;
	}

	query(bounds: RailEnvelopeBounds, target: number[] = []): number[] {
		target.length = 0;
		if (this.envelopes.count === 0) return target;
		this.queryStamp++;
		if (this.queryStamp === 0xffff_ffff) {
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
				for (const envelopeIndex of bucket) {
					if ((this.stamps[envelopeIndex] as number) === this.queryStamp) continue;
					this.stamps[envelopeIndex] = this.queryStamp;
					if (intersectsEnvelope(this.envelopes, envelopeIndex, bounds)) {
						target.push(envelopeIndex);
					}
				}
			}
		}
		return target;
	}
}

export function compileRailEnvelopeSpatialIndex(
	envelopes: CompiledRailEnvelopes,
	chunkSizeMeters = DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
): RailEnvelopeSpatialIndexSnapshot {
	const chunkSize = Math.max(1, Math.floor(chunkSizeMeters));
	const mutable = new Map<
		string,
		{ readonly x: number; readonly y: number; readonly envelopeIndices: number[] }
	>();
	for (let envelopeIndex = 0; envelopeIndex < envelopes.count; envelopeIndex++) {
		const offset = envelopeIndex * 4;
		const minChunkX = Math.floor((envelopes.bounds[offset] as number) / chunkSize);
		const minChunkY = Math.floor((envelopes.bounds[offset + 1] as number) / chunkSize);
		const maxChunkX = Math.floor((envelopes.bounds[offset + 2] as number) / chunkSize);
		const maxChunkY = Math.floor((envelopes.bounds[offset + 3] as number) / chunkSize);
		assertCanonicalEnvelopeChunkRange(minChunkX, minChunkY, maxChunkX, maxChunkY);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const key = chunkKey(chunkX, chunkY);
				const bucket = mutable.get(key);
				if (bucket) bucket.envelopeIndices.push(envelopeIndex);
				else mutable.set(key, { x: chunkX, y: chunkY, envelopeIndices: [envelopeIndex] });
			}
		}
	}
	const entries = [...mutable.values()].sort((left, right) => left.y - right.y || left.x - right.x);
	const chunkCoordinates = new Int32Array(entries.length * 2);
	const chunkOffsets = new Uint32Array(entries.length + 1);
	let referenceCount = 0;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index] as (typeof entries)[number];
		chunkCoordinates[index * 2] = entry.x;
		chunkCoordinates[index * 2 + 1] = entry.y;
		chunkOffsets[index] = referenceCount;
		referenceCount += entry.envelopeIndices.length;
	}
	chunkOffsets[entries.length] = referenceCount;
	const envelopeIndices = new Uint32Array(referenceCount);
	let writeIndex = 0;
	for (const entry of entries) {
		for (const envelopeIndex of entry.envelopeIndices)
			envelopeIndices[writeIndex++] = envelopeIndex;
	}
	return Object.freeze({
		envelopeCount: envelopes.count,
		chunkSizeMeters: chunkSize,
		chunkCoordinates,
		chunkOffsets,
		envelopeIndices,
	});
}

function validateEnvelopeSpatialSnapshot(
	envelopes: CompiledRailEnvelopes,
	snapshot: RailEnvelopeSpatialIndexSnapshot,
): void {
	for (const _step of envelopeSpatialSnapshotValidationSteps(envelopes, snapshot)) {
		void _step;
	}
}

function* envelopeSpatialSnapshotValidationSteps(
	envelopes: CompiledRailEnvelopes,
	snapshot: RailEnvelopeSpatialIndexSnapshot,
): Generator<void> {
	const envelopeCount = envelopes.count;
	const chunkCount = snapshot.chunkOffsets.length - 1;
	if (
		snapshot.envelopeCount !== envelopeCount ||
		!Number.isSafeInteger(snapshot.envelopeCount) ||
		snapshot.envelopeCount < 0 ||
		!Number.isSafeInteger(snapshot.chunkSizeMeters) ||
		snapshot.chunkSizeMeters <= 0 ||
		!(snapshot.chunkCoordinates instanceof Int32Array) ||
		!(snapshot.chunkOffsets instanceof Uint32Array) ||
		!(snapshot.envelopeIndices instanceof Uint32Array) ||
		chunkCount < 0 ||
		snapshot.chunkCoordinates.length !== chunkCount * 2 ||
		snapshot.chunkOffsets[0] !== 0 ||
		snapshot.chunkOffsets[chunkCount] !== snapshot.envelopeIndices.length
	) {
		throw new Error("Rail envelope spatial snapshot is malformed.");
	}
	let previous = 0;
	for (const offset of snapshot.chunkOffsets) {
		if (offset < previous || offset > snapshot.envelopeIndices.length) {
			throw new Error("Rail envelope spatial snapshot is malformed.");
		}
		previous = offset;
		yield;
	}
	const expectedReferences = new Uint32Array(envelopeCount);
	const seenReferences = new Uint32Array(envelopeCount);
	let expectedReferenceCount = 0;
	for (let envelopeIndex = 0; envelopeIndex < envelopeCount; envelopeIndex++) {
		const offset = envelopeIndex * 4;
		const minChunkX = Math.floor((envelopes.bounds[offset] as number) / snapshot.chunkSizeMeters);
		const minChunkY = Math.floor(
			(envelopes.bounds[offset + 1] as number) / snapshot.chunkSizeMeters,
		);
		const maxChunkX = Math.floor(
			(envelopes.bounds[offset + 2] as number) / snapshot.chunkSizeMeters,
		);
		const maxChunkY = Math.floor(
			(envelopes.bounds[offset + 3] as number) / snapshot.chunkSizeMeters,
		);
		assertCanonicalEnvelopeChunkRange(minChunkX, minChunkY, maxChunkX, maxChunkY);
		const referenceCount = (maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1);
		if (!Number.isSafeInteger(referenceCount) || referenceCount <= 0) {
			throw new Error("Rail envelope spatial snapshot is malformed.");
		}
		expectedReferences[envelopeIndex] = referenceCount;
		expectedReferenceCount += referenceCount;
		if (!Number.isSafeInteger(expectedReferenceCount)) {
			throw new Error("Rail envelope spatial snapshot is malformed.");
		}
		yield;
	}
	if (expectedReferenceCount !== snapshot.envelopeIndices.length) {
		throw new Error("Rail envelope spatial snapshot is not canonical.");
	}
	let previousChunkX = 0;
	let previousChunkY = 0;
	for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
		const chunkX = snapshot.chunkCoordinates[chunkIndex * 2] as number;
		const chunkY = snapshot.chunkCoordinates[chunkIndex * 2 + 1] as number;
		if (
			chunkIndex > 0 &&
			(chunkY < previousChunkY || (chunkY === previousChunkY && chunkX <= previousChunkX))
		) {
			throw new Error("Rail envelope spatial snapshot is not canonical.");
		}
		previousChunkX = chunkX;
		previousChunkY = chunkY;
		const start = snapshot.chunkOffsets[chunkIndex] as number;
		const end = snapshot.chunkOffsets[chunkIndex + 1] as number;
		if (start === end) throw new Error("Rail envelope spatial snapshot is not canonical.");
		let previousEnvelopeIndex = -1;
		for (let row = start; row < end; row++) {
			const envelopeIndex = snapshot.envelopeIndices[row] as number;
			if (envelopeIndex >= envelopeCount || envelopeIndex <= previousEnvelopeIndex) {
				throw new Error("Rail envelope spatial snapshot is malformed.");
			}
			const boundsOffset = envelopeIndex * 4;
			const minChunkX = Math.floor(
				(envelopes.bounds[boundsOffset] as number) / snapshot.chunkSizeMeters,
			);
			const minChunkY = Math.floor(
				(envelopes.bounds[boundsOffset + 1] as number) / snapshot.chunkSizeMeters,
			);
			const maxChunkX = Math.floor(
				(envelopes.bounds[boundsOffset + 2] as number) / snapshot.chunkSizeMeters,
			);
			const maxChunkY = Math.floor(
				(envelopes.bounds[boundsOffset + 3] as number) / snapshot.chunkSizeMeters,
			);
			if (chunkX < minChunkX || chunkX > maxChunkX || chunkY < minChunkY || chunkY > maxChunkY) {
				throw new Error("Rail envelope spatial snapshot is not canonical.");
			}
			previousEnvelopeIndex = envelopeIndex;
			seenReferences[envelopeIndex]++;
			yield;
		}
	}
	for (let envelopeIndex = 0; envelopeIndex < envelopeCount; envelopeIndex++) {
		if (seenReferences[envelopeIndex] !== expectedReferences[envelopeIndex]) {
			throw new Error("Rail envelope spatial snapshot is not canonical.");
		}
		yield;
	}
}

function assertCanonicalEnvelopeChunkRange(
	minChunkX: number,
	minChunkY: number,
	maxChunkX: number,
	maxChunkY: number,
): void {
	if (
		!railEnvelopeChunkCoordinateIsCanonical(minChunkX) ||
		!railEnvelopeChunkCoordinateIsCanonical(minChunkY) ||
		!railEnvelopeChunkCoordinateIsCanonical(maxChunkX) ||
		!railEnvelopeChunkCoordinateIsCanonical(maxChunkY)
	) {
		throw new Error("Rail envelope spatial chunk coordinates exceed signed int32 capacity.");
	}
}

function hydrateEnvelopeSpatialChunks(
	snapshot: RailEnvelopeSpatialIndexSnapshot,
): ReadonlyMap<string, Uint32Array> {
	const chunks = new Map<string, Uint32Array>();
	const chunkCount = snapshot.chunkOffsets.length - 1;
	for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
		chunks.set(
			chunkKey(
				snapshot.chunkCoordinates[chunkIndex * 2] as number,
				snapshot.chunkCoordinates[chunkIndex * 2 + 1] as number,
			),
			snapshot.envelopeIndices.subarray(
				snapshot.chunkOffsets[chunkIndex] as number,
				snapshot.chunkOffsets[chunkIndex + 1] as number,
			),
		);
	}
	return chunks;
}

function intersectsEnvelope(
	envelopes: CompiledRailEnvelopes,
	envelopeIndex: number,
	bounds: RailEnvelopeBounds,
): boolean {
	const offset = envelopeIndex * 4;
	return !(
		(envelopes.bounds[offset + 2] as number) < bounds.minX ||
		(envelopes.bounds[offset] as number) > bounds.maxX ||
		(envelopes.bounds[offset + 3] as number) < bounds.minY ||
		(envelopes.bounds[offset + 1] as number) > bounds.maxY
	);
}

function chunkKey(x: number, y: number): string {
	return `${x},${y}`;
}
