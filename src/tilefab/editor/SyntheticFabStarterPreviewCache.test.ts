import { describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import { prepareSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import {
	estimateRetainedBytes,
	SYNTHETIC_FAB_STARTER_PREVIEW_CACHE_BYTES_LIMIT,
	SyntheticFabStarterPreviewCache,
} from "./SyntheticFabStarterPreviewCache";

describe("SyntheticFabStarterPreviewCache", () => {
	it("counts nested typed-array buffers once even when views share storage", () => {
		const shared = new ArrayBuffer(64);
		const oneView = estimateRetainedBytes({
			nested: { first: new Int32Array(shared) },
		});
		const twoViews = estimateRetainedBytes({
			nested: {
				first: new Int32Array(shared),
				second: new Uint8Array(shared),
			},
		});
		const separateBuffer = estimateRetainedBytes({
			nested: {
				first: new Int32Array(shared),
				second: new Uint8Array(48),
			},
		});

		expect(twoViews).toBe(oneView);
		expect(separateBuffer - oneView).toBe(48);
	});

	it("evicts the least-recently-used entry by count", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		expect(prepared).not.toBeNull();
		const cache = new SyntheticFabStarterPreviewCache(2, Number.MAX_SAFE_INTEGER, () => 1);

		cache.set("first", prepared);
		cache.set("second", prepared);
		expect(cache.get("first")).toBe(prepared);
		cache.set("third", prepared);

		expect(cache.get("second")).toBeUndefined();
		expect(cache.get("first")).toBe(prepared);
		expect(cache.get("third")).toBe(prepared);
		expect(cache.size).toBe(2);
	});

	it("evicts by retained bytes and never retains one oversized entry", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		expect(prepared).not.toBeNull();
		const cache = new SyntheticFabStarterPreviewCache(10, 150, () => 100);

		cache.set("first", prepared);
		cache.set("second", prepared);
		expect(cache.get("first")).toBeUndefined();
		expect(cache.get("second")).toBe(prepared);
		expect(cache.retainedBytes).toBe(100);

		const oversized = new SyntheticFabStarterPreviewCache(10, 50, () => 100);
		oversized.set("oversized", prepared);
		expect(oversized.get("oversized")).toBeUndefined();
		expect(oversized.size).toBe(0);
		expect(oversized.retainedBytes).toBe(0);
	});

	it("reuses one certified factory-sized preview within the product cache budget", async () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const retainedBytes = 9_320_000;
		const cache = new SyntheticFabStarterPreviewCache(
			32,
			SYNTHETIC_FAB_STARTER_PREVIEW_CACHE_BYTES_LIMIT,
			() => retainedBytes,
		);
		cache.set("paired-fab", prepared);
		let preparations = 0;

		const reopened = cache.acquire("paired-fab", () => {
			preparations += 1;
			return { promise: Promise.resolve(prepared), cancel: () => undefined };
		});

		expect(await reopened.promise).toBe(prepared);
		expect(preparations).toBe(0);
		expect(cache.retainedBytes).toBe(retainedBytes);
	});

	it("removes one cached generation and releases its retained-byte budget", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const cache = new SyntheticFabStarterPreviewCache(4, 1_000, () => 125);
		cache.set("generation", prepared);

		expect(cache.delete("generation")).toBe(true);
		expect(cache.delete("generation")).toBe(false);
		expect(cache.size).toBe(0);
		expect(cache.retainedBytes).toBe(0);
	});

	it("coalesces in-flight preparation and cancels only after the final subscriber leaves", async () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		expect(prepared).not.toBeNull();
		const cache = new SyntheticFabStarterPreviewCache(4, Number.MAX_SAFE_INTEGER, () => 1);
		let deferred = createDeferred<typeof prepared>();
		let starts = 0;
		let cancellations = 0;
		const prepare = () => {
			starts += 1;
			deferred = createDeferred<typeof prepared>();
			return {
				promise: deferred.promise,
				cancel: () => {
					cancellations += 1;
				},
			};
		};

		const first = cache.acquire("shared", prepare);
		const second = cache.acquire("shared", prepare);
		expect(starts).toBe(1);
		expect(cache.inFlightSize).toBe(1);

		first.cancel();
		expect(cancellations).toBe(0);
		second.cancel();
		expect(cancellations).toBe(1);
		expect(cache.inFlightSize).toBe(0);

		const third = cache.acquire("shared", prepare);
		expect(starts).toBe(2);
		if (!prepared) throw new Error("expected prepared starter");
		deferred.resolve(prepared);
		expect(await third.promise).toBe(prepared);
		expect(cache.get("shared")).toBe(prepared);
		expect(cache.inFlightSize).toBe(0);
	});

	it("does not cache a late result from a cancelled preparation generation", async () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		expect(prepared).not.toBeNull();
		const cache = new SyntheticFabStarterPreviewCache(4, Number.MAX_SAFE_INTEGER, () => 1);
		const deferred = createDeferred<typeof prepared>();
		const preparation = cache.acquire("cancelled", () => ({
			promise: deferred.promise,
			cancel: () => undefined,
		}));

		preparation.cancel();
		if (!prepared) throw new Error("expected prepared starter");
		deferred.resolve(prepared);
		expect(await preparation.promise).toBe(prepared);
		expect(cache.get("cancelled")).toBeUndefined();
		expect(cache.inFlightSize).toBe(0);
	});
});

function createDeferred<T>(): Readonly<{
	promise: Promise<T>;
	resolve: (value: T) => void;
}> {
	let resolver: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolver = resolve;
	});
	return Object.freeze({
		promise,
		resolve: (value: T) => {
			if (!resolver) throw new Error("deferred resolver is unavailable");
			resolver(value);
		},
	});
}
