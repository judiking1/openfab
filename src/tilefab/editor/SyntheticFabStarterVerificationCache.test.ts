import { describe, expect, it } from "vitest";
import { defaultSyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import {
	type SyntheticFabStarterVerificationBridge,
	SyntheticFabStarterVerificationCache,
} from "./SyntheticFabStarterVerificationCache";

describe("SyntheticFabStarterVerificationCache", () => {
	it("shares one independent materialization and reuses its verified result", async () => {
		const request = defaultSyntheticFabStarterRequest("single-loop");
		const preview = prepareSyntheticFabStarter(request);
		const independent = structuredClone(preview);
		const deferred = createDeferred<PreparedSyntheticFabStarter>();
		const cache = new SyntheticFabStarterVerificationCache(2, Number.MAX_SAFE_INTEGER);
		let starts = 0;
		let cancellations = 0;
		const createBridge = (): SyntheticFabStarterVerificationBridge => {
			starts += 1;
			return {
				prepare: () => deferred.promise,
				dispose: () => {
					cancellations += 1;
				},
			};
		};

		const first = cache.acquire(preview, request, createBridge);
		const second = cache.acquire(preview, request, createBridge);
		expect(starts).toBe(1);
		first.cancel();
		expect(cancellations).toBe(0);

		deferred.resolve(independent);
		expect(await second.promise).toBe(independent);
		const cached = cache.acquire(preview, request, createBridge);
		expect(await cached.promise).toBe(independent);
		expect(starts).toBe(1);
	});

	it("rejects and does not retain an independently materialized mismatch", async () => {
		const request = defaultSyntheticFabStarterRequest("single-loop");
		const preview = prepareSyntheticFabStarter(request);
		const mismatched = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("nested-bay"));
		const cache = new SyntheticFabStarterVerificationCache(2, Number.MAX_SAFE_INTEGER);
		let starts = 0;
		const createBridge = (): SyntheticFabStarterVerificationBridge => ({
			prepare: async () => {
				starts += 1;
				return mismatched;
			},
			dispose: () => undefined,
		});

		await expect(cache.acquire(preview, request, createBridge).promise).rejects.toThrow(
			"does not match",
		);
		await expect(cache.acquire(preview, request, createBridge).promise).rejects.toThrow(
			"does not match",
		);
		expect(starts).toBe(2);
	});

	it("retains one independently verified paired-circulation FAB under the default byte budget", async () => {
		const request = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
		const preview = prepareSyntheticFabStarter(request);
		const independent = structuredClone(preview);
		const cache = new SyntheticFabStarterVerificationCache();
		let starts = 0;
		const createBridge = (): SyntheticFabStarterVerificationBridge => ({
			prepare: async () => {
				starts += 1;
				return independent;
			},
			dispose: () => undefined,
		});

		expect(await cache.acquire(preview, request, createBridge).promise).toBe(independent);
		expect(await cache.acquire(preview, request, createBridge).promise).toBe(independent);
		expect(starts).toBe(1);
	}, 30_000);
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
