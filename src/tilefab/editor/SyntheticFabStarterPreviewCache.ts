import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";

export const SYNTHETIC_FAB_STARTER_PREVIEW_CACHE_BYTES_LIMIT = 16 * 1024 * 1024;

interface StarterPreviewCacheEntry {
	readonly preview: PreparedSyntheticFabStarter;
	readonly retainedBytes: number;
}

export interface StarterPreviewPreparation {
	readonly promise: Promise<PreparedSyntheticFabStarter | null>;
	readonly cancel: () => void;
}

interface StarterPreviewInFlightEntry {
	promise: Promise<PreparedSyntheticFabStarter | null>;
	readonly cancelSource: () => void;
	subscribers: number;
}

type StarterPreviewEstimator = (preview: PreparedSyntheticFabStarter) => number;

export class SyntheticFabStarterPreviewCache {
	private readonly entries = new Map<string, StarterPreviewCacheEntry>();
	private readonly inFlight = new Map<string, StarterPreviewInFlightEntry>();
	private readonly maxEntries: number;
	private readonly maxRetainedBytes: number;
	private readonly estimate: StarterPreviewEstimator;
	private retainedBytesValue = 0;

	constructor(
		maxEntries: number,
		maxRetainedBytes: number,
		estimate: StarterPreviewEstimator = estimateStarterPreviewRetainedBytes,
	) {
		this.maxEntries = maxEntries;
		this.maxRetainedBytes = maxRetainedBytes;
		this.estimate = estimate;
	}

	get size(): number {
		return this.entries.size;
	}

	get retainedBytes(): number {
		return this.retainedBytesValue;
	}

	get inFlightSize(): number {
		return this.inFlight.size;
	}

	get(cacheKey: string): PreparedSyntheticFabStarter | undefined {
		const entry = this.entries.get(cacheKey);
		if (!entry) return undefined;
		this.entries.delete(cacheKey);
		this.entries.set(cacheKey, entry);
		return entry.preview;
	}

	delete(cacheKey: string): boolean {
		const entry = this.entries.get(cacheKey);
		if (!entry) return false;
		this.entries.delete(cacheKey);
		this.retainedBytesValue -= entry.retainedBytes;
		return true;
	}

	set(cacheKey: string, preview: PreparedSyntheticFabStarter): void {
		const existing = this.entries.get(cacheKey);
		if (existing) this.retainedBytesValue -= existing.retainedBytes;
		const entry = Object.freeze({
			preview,
			retainedBytes: this.estimate(preview),
		});
		this.entries.delete(cacheKey);
		this.entries.set(cacheKey, entry);
		this.retainedBytesValue += entry.retainedBytes;
		while (this.entries.size > this.maxEntries || this.retainedBytesValue > this.maxRetainedBytes) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			const oldest = this.entries.get(oldestKey);
			if (oldest) this.retainedBytesValue -= oldest.retainedBytes;
			this.entries.delete(oldestKey);
		}
	}

	acquire(cacheKey: string, prepare: () => StarterPreviewPreparation): StarterPreviewPreparation {
		const cached = this.get(cacheKey);
		if (cached !== undefined) {
			return Object.freeze({
				promise: Promise.resolve(cached),
				cancel: () => undefined,
			});
		}
		let entry = this.inFlight.get(cacheKey);
		if (!entry) {
			const source = prepare();
			const created: StarterPreviewInFlightEntry = {
				promise: Promise.resolve(null),
				cancelSource: source.cancel,
				subscribers: 0,
			};
			created.promise = source.promise
				.then((preview) => {
					if (preview !== null && this.inFlight.get(cacheKey) === created) {
						this.set(cacheKey, preview);
					}
					return preview;
				})
				.finally(() => {
					if (this.inFlight.get(cacheKey) === created) this.inFlight.delete(cacheKey);
				});
			entry = created;
			this.inFlight.set(cacheKey, entry);
		}
		entry.subscribers += 1;
		let released = false;
		return Object.freeze({
			promise: entry.promise,
			cancel: () => {
				if (released) return;
				released = true;
				const current = this.inFlight.get(cacheKey);
				if (current !== entry) return;
				current.subscribers -= 1;
				if (current.subscribers > 0) return;
				this.inFlight.delete(cacheKey);
				current.cancelSource();
			},
		});
	}
}

export function estimateStarterPreviewRetainedBytes(preview: PreparedSyntheticFabStarter): number {
	return estimateRetainedBytes(preview);
}

export function estimateRetainedBytes(value: unknown): number {
	return estimateRetainedValue(value, new Set<object>(), new Set<ArrayBufferLike>());
}

function estimateRetainedValue(
	value: unknown,
	seenObjects: Set<object>,
	seenBuffers: Set<ArrayBufferLike>,
): number {
	if (value === null || value === undefined) return 0;
	if (typeof value === "string") return value.length * 2;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return 8;
	}
	if (typeof value !== "object") return 0;
	if (ArrayBuffer.isView(value)) {
		if (seenBuffers.has(value.buffer)) return 0;
		seenBuffers.add(value.buffer);
		return value.buffer.byteLength;
	}
	if (value instanceof ArrayBuffer) {
		if (seenBuffers.has(value)) return 0;
		seenBuffers.add(value);
		return value.byteLength;
	}
	if (seenObjects.has(value)) return 0;
	seenObjects.add(value);
	let bytes = 64;
	for (const nested of Object.values(value)) {
		bytes += estimateRetainedValue(nested, seenObjects, seenBuffers);
	}
	return bytes;
}
