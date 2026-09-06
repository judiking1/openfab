import { describe, expect, it, vi } from "vitest";
import {
	defaultSyntheticFabStarterRequest,
	type SyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "../compile/SyntheticFabStarter";
import generatedFullFabArtifactSource from "../generated/synthetic-fab-presets/full-fab-52.default.v3.json?raw";
import generatedArtifactSource from "../generated/synthetic-fab-presets/large-fab-60.default.v3.json?raw";
import generatedPairedCirculationArtifactSource from "../generated/synthetic-fab-presets/paired-circulation-fab-52.default.v4.json?raw";
import generatedParallelHallArtifactSource from "../generated/synthetic-fab-presets/parallel-hall-fab-12.default.v3.json?raw";
import generatedProductionArtifactSource from "../generated/synthetic-fab-presets/production-fab-60.default.v3.json?raw";
import {
	hydrateSyntheticFabStarterCertifiedArtifact,
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES,
} from "./SyntheticFabStarterCertifiedArtifact";
import {
	loadCertifiedSyntheticFabStarter,
	preloadDefaultFullFabCertifiedStarter,
	preloadDefaultPairedCirculationFabCertifiedStarter,
	preloadDefaultParallelHallFabCertifiedStarter,
	preloadDefaultProductionFabCertifiedStarter,
	SYNTHETIC_FAB_STARTER_CERTIFIED_CATALOG_METADATA,
	SyntheticFabStarterCertifiedCatalog,
	syntheticFabStarterCertifiedCatalogMetadataForRequest,
} from "./SyntheticFabStarterCertifiedCatalog";

describe("SyntheticFabStarterCertifiedCatalog", () => {
	const request = defaultSyntheticFabStarterRequest("large-fab-60");
	const fullFabRequest = defaultSyntheticFabStarterRequest("full-fab-52");
	const productionRequest = defaultSyntheticFabStarterRequest("production-fab-60");
	const parallelHallRequest = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");
	const pairedRequest = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
	const generatedArtifact = JSON.parse(generatedArtifactSource) as unknown;
	const generatedFullFabArtifact = JSON.parse(generatedFullFabArtifactSource) as unknown;
	const generatedProductionArtifact = JSON.parse(generatedProductionArtifactSource) as unknown;
	const generatedParallelHallArtifact = JSON.parse(generatedParallelHallArtifactSource) as unknown;
	const generatedPairedCirculationArtifact = JSON.parse(
		generatedPairedCirculationArtifactSource,
	) as unknown;

	it("exposes static lightweight identities without loading or hydrating an artifact", () => {
		let loads = 0;
		let hydrations = 0;
		new SyntheticFabStarterCertifiedCatalog(
			async () => {
				loads += 1;
				return generatedArtifact;
			},
			() => {
				hydrations += 1;
				return null;
			},
		);

		expect(SYNTHETIC_FAB_STARTER_CERTIFIED_CATALOG_METADATA).toHaveLength(6);
		expect(syntheticFabStarterCertifiedCatalogMetadataForRequest(pairedRequest)).toEqual({
			requestId: "paired-circulation-fab-52",
			artifactId: "paired-circulation-fab-52.default.v4",
			loading: "lazy-raw-import",
		});
		expect(
			syntheticFabStarterCertifiedCatalogMetadataForRequest(
				defaultSyntheticFabStarterRequest("single-loop"),
			),
		).toBeNull();
		expect(loads).toBe(0);
		expect(hydrations).toBe(0);
	});

	it("does not load an artifact for non-fixed or custom requests", async () => {
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(async () => {
			loads += 1;
			return generatedArtifact;
		});

		await expect(
			catalog.load(defaultSyntheticFabStarterRequest("single-loop")),
		).resolves.toBeNull();
		await expect(
			catalog.load(setSyntheticFabStarterParameter(request, "processBlockCount", 4)),
		).resolves.toBeNull();
		await expect(catalog.load({} as SyntheticFabStarterRequest)).resolves.toBeNull();
		expect(loads).toBe(0);
	});

	it("coalesces concurrent source loads and returns fresh prepared buffers", async () => {
		const deferred = createDeferred<unknown>();
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(() => {
			loads += 1;
			return deferred.promise;
		});

		const firstPromise = catalog.load(request);
		const secondPromise = catalog.load(request);
		const thirdPromise = catalog.load(request);
		await Promise.resolve();
		expect(loads).toBe(1);
		deferred.resolve(generatedArtifact);
		const [first, second, third] = await Promise.all([firstPromise, secondPromise, thirdPromise]);
		if (!first || !second || !third) throw new Error("Expected certified catalog results.");

		expect(loads).toBe(1);
		expect(first.prepared.snapshot.xs.buffer).not.toBe(second.prepared.snapshot.xs.buffer);
		expect(second.prepared.snapshot.xs.buffer).not.toBe(third.prepared.snapshot.xs.buffer);
		expect(first.prepared.exactGeometry?.positions.buffer).not.toBe(
			second.prepared.exactGeometry?.positions.buffer,
		);

		const cached = await catalog.load(request);
		if (!cached) throw new Error("Expected cached certified catalog result.");
		expect(loads).toBe(1);
		expect(cached.prepared.snapshot.xs.buffer).not.toBe(first.prepared.snapshot.xs.buffer);
	});

	it("selects and caches the shipped artifact independently for each certified request", async () => {
		const loadedIds: string[] = [];
		const catalog = new SyntheticFabStarterCertifiedCatalog(async (candidate) => {
			loadedIds.push(candidate.id);
			return candidate.id === "production-fab-60" ? generatedProductionArtifact : generatedArtifact;
		});

		const [legacy, production] = await Promise.all([
			catalog.load(request),
			catalog.load(productionRequest),
		]);
		if (!legacy || !production) throw new Error("Expected both certified catalog results.");
		expect(loadedIds.sort()).toEqual(["large-fab-60", "production-fab-60"]);
		expect(legacy.prepared.steps).toHaveLength(81);
		expect(legacy.prepared.exactGeometry).not.toBeNull();
		expect(production.prepared.steps).toHaveLength(185);
		expect(production.prepared.summary.zoneCount).toBe(3);
		expect(production.prepared.exactGeometry).toBeNull();

		const [secondLegacy, secondProduction] = await Promise.all([
			catalog.load(request),
			catalog.load(productionRequest),
		]);
		if (!secondLegacy || !secondProduction) throw new Error("Expected cached certified results.");
		expect(loadedIds).toHaveLength(2);
		expect(secondLegacy.prepared.snapshot.xs.buffer).not.toBe(legacy.prepared.snapshot.xs.buffer);
		expect(secondProduction.prepared.snapshot.xs.buffer).not.toBe(
			production.prepared.snapshot.xs.buffer,
		);
	});

	it("preloads only raw source and defers parse plus hydration until load", async () => {
		let loads = 0;
		let hydrations = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(
			async () => {
				loads += 1;
				return generatedArtifactSource;
			},
			(artifact, candidate) => {
				hydrations += 1;
				return hydrateSyntheticFabStarterCertifiedArtifact(artifact, candidate);
			},
		);
		const parse = vi.spyOn(JSON, "parse");
		try {
			await expect(catalog.preload()).resolves.toBe(true);
			await expect(catalog.preload()).resolves.toBe(true);
			expect(loads).toBe(1);
			expect(parse).not.toHaveBeenCalled();
			expect(hydrations).toBe(0);

			const first = await catalog.load(request);
			if (!first) throw new Error("Expected the first certified load.");
			expect(loads).toBe(1);
			expect(parse).toHaveBeenCalledTimes(1);
			expect(hydrations).toBe(1);

			const fresh = await catalog.load(request);
			if (!fresh) throw new Error("Expected a fresh certified result.");
			expect(loads).toBe(1);
			expect(parse).toHaveBeenCalledTimes(1);
			expect(hydrations).toBe(2);
			expect(fresh.prepared.snapshot.xs.buffer).not.toBe(first.prepared.snapshot.xs.buffer);
		} finally {
			parse.mockRestore();
		}
	});

	it("routes an explicitly configured shipped source through Worker hydration without main parsing", async () => {
		let loads = 0;
		let mainHydrations = 0;
		let workerHydrations = 0;
		let disposals = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(
			async () => {
				loads += 1;
				return generatedArtifactSource;
			},
			() => {
				mainHydrations += 1;
				return null;
			},
			() => ({
				async hydrate(source, candidate) {
					workerHydrations += 1;
					expect(source).toBe(generatedArtifactSource);
					return hydrateSyntheticFabStarterCertifiedArtifact(generatedArtifact, candidate);
				},
				cancel() {},
				dispose() {
					disposals += 1;
				},
			}),
		);
		const parse = vi.spyOn(JSON, "parse");
		try {
			await expect(catalog.preload(request)).resolves.toBe(true);
			const first = await catalog.load(request);
			const second = await catalog.load(request);
			if (!first || !second) throw new Error("Expected two Worker-hydrated catalog results.");

			expect(loads).toBe(1);
			expect(mainHydrations).toBe(0);
			expect(workerHydrations).toBe(2);
			expect(disposals).toBe(2);
			expect(parse).not.toHaveBeenCalled();
			expect(second.prepared.snapshot.xs.buffer).not.toBe(first.prepared.snapshot.xs.buffer);
		} finally {
			parse.mockRestore();
		}
	});

	it("retains an independent Production FAB preload", async () => {
		let loads = 0;
		let hydrations = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(
			async (candidate) => {
				loads += 1;
				return candidate.id === "production-fab-60"
					? generatedProductionArtifact
					: generatedArtifact;
			},
			(artifact, candidate) => {
				hydrations += 1;
				return hydrateSyntheticFabStarterCertifiedArtifact(artifact, candidate);
			},
		);

		await expect(catalog.preload(productionRequest)).resolves.toBe(true);
		expect(loads).toBe(1);
		expect(hydrations).toBe(0);
		const production = await catalog.load(productionRequest);
		if (!production) throw new Error("Expected Production FAB after source preload.");
		expect(loads).toBe(1);
		expect(hydrations).toBe(1);
		expect(production.prepared.steps).toHaveLength(185);
		expect(production.prepared.geometry).toBeNull();
		expect(production.prepared.exactGeometry).toBeNull();

		await expect(catalog.preload()).resolves.toBe(true);
		expect(loads).toBe(2);
	});

	it("loads and independently caches the Parallel Hall certified artifact", async () => {
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(async () => {
			loads += 1;
			return generatedParallelHallArtifact;
		});

		await expect(catalog.preload(parallelHallRequest)).resolves.toBe(true);
		const first = await catalog.load(parallelHallRequest);
		const second = await catalog.load(parallelHallRequest);
		if (!first || !second) throw new Error("Expected certified Parallel Hall results.");
		expect(loads).toBe(1);
		expect(first.prepared.steps).toHaveLength(44);
		expect(first.prepared.summary).toMatchObject({
			zoneCount: 2,
			bayCount: 12,
		});
		expect(first.prepared.placementBundle).not.toBeNull();
		expect(second.prepared.snapshot.xs.buffer).not.toBe(first.prepared.snapshot.xs.buffer);
	});

	it("loads and independently caches the Full FAB certified artifact", async () => {
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(async () => {
			loads += 1;
			return generatedFullFabArtifact;
		});

		await expect(catalog.preload(fullFabRequest)).resolves.toBe(true);
		const first = await catalog.load(fullFabRequest);
		const second = await catalog.load(fullFabRequest);
		if (!first || !second) throw new Error("Expected certified Full FAB results.");
		expect(loads).toBe(1);
		expect(first.prepared.steps).toHaveLength(171);
		expect(first.prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
		});
		expect(first.prepared.snapshot.organizations.organizationIds).toHaveLength(161);
		expect(first.prepared.placementBundle).not.toBeNull();
		expect(second.prepared.snapshot.xs.buffer).not.toBe(first.prepared.snapshot.xs.buffer);
	});

	it("loads and independently caches the paired production default", async () => {
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(async () => {
			loads += 1;
			return generatedPairedCirculationArtifact;
		});

		await expect(catalog.preload(pairedRequest)).resolves.toBe(true);
		const first = await catalog.load(pairedRequest);
		const second = await catalog.load(pairedRequest);
		if (!first || !second) throw new Error("Expected certified paired FAB results.");
		expect(loads).toBe(1);
		expect(first.prepared.steps).toHaveLength(201);
		expect(first.prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
		});
		expect(first.prepared.snapshot.organizations.organizationIds).toHaveLength(144);
		expect(first.prepared.placementBundle).not.toBeNull();
		expect(second.prepared.snapshot.xs.buffer).not.toBe(first.prepared.snapshot.xs.buffer);
	});

	it("coalesces source fetch when preload races a first consumer", async () => {
		const deferred = createDeferred<unknown>();
		let loads = 0;
		let hydrations = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(
			() => {
				loads += 1;
				return deferred.promise;
			},
			(artifact, candidate) => {
				hydrations += 1;
				return hydrateSyntheticFabStarterCertifiedArtifact(artifact, candidate);
			},
		);

		const consumer = catalog.load(request);
		const preload = catalog.preload();
		await Promise.resolve();
		deferred.resolve(generatedArtifact);
		await expect(preload).resolves.toBe(true);
		await expect(consumer).resolves.not.toBeNull();
		expect(loads).toBe(1);
		expect(hydrations).toBe(1);
	});

	it("retries a transient loader failure", async () => {
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(async () => {
			loads += 1;
			if (loads === 1) throw new Error("transient load failure");
			return generatedArtifact;
		});

		await expect(catalog.load(request)).resolves.toBeNull();
		await expect(catalog.load(request)).resolves.not.toBeNull();
		expect(loads).toBe(2);
	});

	it("discards an in-flight preload when the catalog is cleared", async () => {
		const first = createDeferred<unknown>();
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(() => {
			loads += 1;
			return loads === 1 ? first.promise : Promise.resolve(generatedArtifact);
		});

		const stalePreload = catalog.preload();
		await Promise.resolve();
		catalog.clear();
		first.resolve(generatedArtifact);

		await expect(stalePreload).resolves.toBe(false);
		await expect(catalog.load(request)).resolves.not.toBeNull();
		expect(loads).toBe(2);
	});

	it("caches malformed shipped data as unavailable and fails closed", async () => {
		let loads = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(async () => {
			loads += 1;
			return { schemaVersion: 999 };
		});

		await expect(catalog.load(request)).resolves.toBeNull();
		await expect(catalog.load(request)).resolves.toBeNull();
		expect(loads).toBe(1);

		catalog.clear();
		await expect(catalog.load(request)).resolves.toBeNull();
		expect(loads).toBe(2);
	});

	it("may prefetch malformed raw JSON but rejects it before the hydrator at load", async () => {
		let loads = 0;
		let hydrations = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(
			async () => {
				loads += 1;
				return "{not-json";
			},
			() => {
				hydrations += 1;
				return null;
			},
		);

		await expect(catalog.preload(request)).resolves.toBe(true);
		await expect(catalog.load(request)).resolves.toBeNull();
		await expect(catalog.load(request)).resolves.toBeNull();
		expect(loads).toBe(1);
		expect(hydrations).toBe(0);
	});

	it("defers exact UTF-8 source budget validation to load and fails closed", async () => {
		const maximumSourceBytes =
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES + 64 * 1024;
		const oversizedUtf8Source = "é".repeat(Math.floor(maximumSourceBytes / 2) + 1);
		let hydrations = 0;
		const catalog = new SyntheticFabStarterCertifiedCatalog(
			async () => oversizedUtf8Source,
			() => {
				hydrations += 1;
				return null;
			},
		);

		expect(oversizedUtf8Source.length).toBeLessThan(maximumSourceBytes);
		await expect(catalog.preload(request)).resolves.toBe(true);
		await expect(catalog.load(request)).resolves.toBeNull();
		expect(hydrations).toBe(0);
	});

	it("does not let one malformed artifact poison the other certified preset", async () => {
		const loads: string[] = [];
		const catalog = new SyntheticFabStarterCertifiedCatalog(async (candidate) => {
			loads.push(candidate.id);
			return candidate.id === "production-fab-60" ? { schemaVersion: 999 } : generatedArtifact;
		});

		await expect(catalog.load(productionRequest)).resolves.toBeNull();
		await expect(catalog.load(productionRequest)).resolves.toBeNull();
		await expect(catalog.load(request)).resolves.not.toBeNull();
		expect(loads).toEqual(["production-fab-60", "large-fab-60"]);
	});

	it("loads the checked-in generated artifact through the production raw loader", async () => {
		const catalog = new SyntheticFabStarterCertifiedCatalog();
		await expect(catalog.preload()).resolves.toBe(true);
		await expect(catalog.preload(productionRequest)).resolves.toBe(true);
		const hydrated = await catalog.load(request);
		const production = await catalog.load(productionRequest);

		expect(hydrated?.prepared.summary.bayCount).toBe(60);
		expect(hydrated?.prepared.steps).toHaveLength(81);
		expect(hydrated?.prepared.authoringReady).toBe(true);
		expect(production?.prepared.summary.bayCount).toBe(60);
		expect(production?.prepared.summary.zoneCount).toBe(3);
		expect(production?.prepared.steps).toHaveLength(185);
		expect(production?.prepared.exactGeometry).toBeNull();
	});

	it("exposes shared Production FAB preload without changing legacy defaults", async () => {
		await expect(preloadDefaultProductionFabCertifiedStarter()).resolves.toBe(true);
		const production = await loadCertifiedSyntheticFabStarter(productionRequest);
		expect(production?.prepared.steps).toHaveLength(185);
		expect(production?.prepared.planFingerprint).not.toBeNull();
	});

	it("exposes the shared Parallel Hall preload used by the preset dialog", async () => {
		await expect(preloadDefaultParallelHallFabCertifiedStarter()).resolves.toBe(true);
		const parallelHall = await loadCertifiedSyntheticFabStarter(parallelHallRequest);
		expect(parallelHall?.prepared.steps).toHaveLength(44);
		expect(parallelHall?.prepared.summary.bayCount).toBe(12);
	});

	it("exposes the shared Full FAB preload used by the default preset dialog", async () => {
		await expect(preloadDefaultFullFabCertifiedStarter()).resolves.toBe(true);
		const fullFab = await loadCertifiedSyntheticFabStarter(fullFabRequest);
		expect(fullFab?.prepared.steps).toHaveLength(171);
		expect(fullFab?.prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
		});
	});

	it("exposes the shared paired FAB preload used by the default preset dialog", async () => {
		await expect(preloadDefaultPairedCirculationFabCertifiedStarter()).resolves.toBe(true);
		const paired = await loadCertifiedSyntheticFabStarter(pairedRequest);
		expect(paired?.prepared.steps).toHaveLength(201);
		expect(paired?.prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
		});
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
			if (!resolver) throw new Error("Deferred resolver is unavailable.");
			resolver(value);
		},
	});
}
