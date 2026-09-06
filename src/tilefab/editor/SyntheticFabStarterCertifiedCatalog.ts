import {
	defaultSyntheticFabStarterRequest,
	type SyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";
import {
	CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	type HydratedCertifiedSyntheticFabStarter,
	hydrateSyntheticFabStarterCertifiedArtifact,
	PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES,
	type SyntheticFabStarterCertifiedArtifactId,
	syntheticFabStarterCertifiedArtifactIdForRequest,
} from "./SyntheticFabStarterCertifiedArtifact";
import {
	SyntheticFabStarterCertifiedArtifactBridge,
	type SyntheticFabStarterCertifiedArtifactHydrationBridge,
} from "./SyntheticFabStarterCertifiedArtifactBridge";

const NO_CACHED_SOURCE: unique symbol = Symbol("no-certified-starter-source");
const NO_VERIFIED_ARTIFACT: unique symbol = Symbol("no-verified-certified-starter-artifact");

interface ArtifactLoadSuccess {
	readonly ok: true;
	readonly value: unknown;
}

interface ArtifactLoadFailure {
	readonly ok: false;
}

type ArtifactLoadResult = ArtifactLoadSuccess | ArtifactLoadFailure;

export type SyntheticFabStarterCertifiedArtifactLoader = (
	request: SyntheticFabStarterRequest,
) => Promise<unknown>;
export type SyntheticFabStarterCertifiedArtifactHydrator = (
	artifact: unknown,
	request: SyntheticFabStarterRequest,
) => HydratedCertifiedSyntheticFabStarter | null;
export type SyntheticFabStarterCertifiedArtifactHydrationBridgeFactory =
	() => SyntheticFabStarterCertifiedArtifactHydrationBridge;

export interface SyntheticFabStarterCertifiedCatalogMetadata {
	readonly requestId: SyntheticFabStarterRequest["id"];
	readonly artifactId: SyntheticFabStarterCertifiedArtifactId;
	readonly loading: "lazy-raw-import";
}

/** Static catalog identity only. It never imports, parses, hydrates, or validates artifact payloads. */
export const SYNTHETIC_FAB_STARTER_CERTIFIED_CATALOG_METADATA = Object.freeze([
	metadata("paired-circulation-fab-52", PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID),
	metadata("full-fab-52", FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID),
	metadata("large-fab-60", SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID),
	metadata("production-fab-60", PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID),
	metadata("central-spine-fab-24", CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID),
	metadata("parallel-hall-fab-12", PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID),
]);

const CATALOG_METADATA_BY_ARTIFACT_ID = new Map(
	SYNTHETIC_FAB_STARTER_CERTIFIED_CATALOG_METADATA.map((entry) => [entry.artifactId, entry]),
);

interface CatalogArtifactState {
	cachedSource: unknown | typeof NO_CACHED_SOURCE;
	verifiedArtifact: unknown | typeof NO_VERIFIED_ARTIFACT;
	sourceInFlight: Promise<ArtifactLoadResult> | null;
	invalidArtifact: boolean;
}

/**
 * Fetches each immutable shipped source once and defers parse/hydration until an actual consumer
 * calls load. The production shipped path performs that work in a disposable Worker; injected
 * loaders/hydrators retain the deterministic synchronous path used by tests and alternate hosts.
 * Every load receives fresh typed buffers. Unsupported requests and failures return null for the
 * live generator fallback.
 */
export class SyntheticFabStarterCertifiedCatalog {
	private readonly loader: SyntheticFabStarterCertifiedArtifactLoader;
	private readonly hydrator: SyntheticFabStarterCertifiedArtifactHydrator;
	private readonly createHydrationBridge: SyntheticFabStarterCertifiedArtifactHydrationBridgeFactory | null;
	private readonly states = new Map<SyntheticFabStarterCertifiedArtifactId, CatalogArtifactState>();
	private readonly activeHydrationBridges =
		new Set<SyntheticFabStarterCertifiedArtifactHydrationBridge>();
	private generation = 0;

	constructor(
		loader: SyntheticFabStarterCertifiedArtifactLoader = loadShippedCertifiedArtifactSource,
		hydrator: SyntheticFabStarterCertifiedArtifactHydrator = hydrateSyntheticFabStarterCertifiedArtifact,
		createHydrationBridge?: SyntheticFabStarterCertifiedArtifactHydrationBridgeFactory | null,
	) {
		this.loader = loader;
		this.hydrator = hydrator;
		this.createHydrationBridge =
			createHydrationBridge === undefined
				? loader === loadShippedCertifiedArtifactSource &&
					hydrator === hydrateSyntheticFabStarterCertifiedArtifact &&
					canUseCertifiedArtifactHydrationWorker()
					? () => new SyntheticFabStarterCertifiedArtifactBridge()
					: null
				: createHydrationBridge;
	}

	async load(
		request: SyntheticFabStarterRequest,
	): Promise<HydratedCertifiedSyntheticFabStarter | null> {
		const state = this.stateForRequest(request);
		if (!state || state.invalidArtifact) return null;
		return this.hydrateFresh(request, state);
	}

	/** Fetch/cache only. Parsing and integrity validation remain at load(). */
	async preload(
		request: SyntheticFabStarterRequest = defaultSyntheticFabStarterRequest("large-fab-60"),
	): Promise<boolean> {
		const state = this.stateForRequest(request);
		if (!state || state.invalidArtifact) return false;
		const generation = this.generation;
		const source = await this.loadSource(request, state);
		return source.ok && generation === this.generation;
	}

	clear(): void {
		this.generation += 1;
		for (const bridge of this.activeHydrationBridges) bridge.dispose();
		this.activeHydrationBridges.clear();
		this.states.clear();
	}

	private async hydrateFresh(
		request: SyntheticFabStarterRequest,
		state: CatalogArtifactState,
		generation = this.generation,
	): Promise<HydratedCertifiedSyntheticFabStarter | null> {
		const source = await this.loadSource(request, state);
		if (!source.ok || generation !== this.generation) return null;
		if (this.createHydrationBridge && typeof source.value === "string") {
			return this.hydrateFreshInWorker(request, state, source.value, generation);
		}
		let artifact = state.verifiedArtifact;
		if (artifact === NO_VERIFIED_ARTIFACT) {
			try {
				artifact = decodeArtifactSource(source.value);
			} catch {
				this.invalidate(state);
				return null;
			}
		}
		let hydrated: HydratedCertifiedSyntheticFabStarter | null;
		try {
			hydrated = this.hydrator(artifact, request);
		} catch {
			this.invalidate(state);
			return null;
		}
		if (generation !== this.generation) return null;
		if (!hydrated) {
			this.invalidate(state);
			return null;
		}
		if (state.verifiedArtifact === NO_VERIFIED_ARTIFACT) {
			state.verifiedArtifact = freezeJsonContainers(artifact);
			state.cachedSource = NO_CACHED_SOURCE;
		}
		return hydrated;
	}

	private async hydrateFreshInWorker(
		request: SyntheticFabStarterRequest,
		state: CatalogArtifactState,
		source: string,
		generation: number,
	): Promise<HydratedCertifiedSyntheticFabStarter | null> {
		const createBridge = this.createHydrationBridge;
		if (!createBridge) return null;
		let bridge: SyntheticFabStarterCertifiedArtifactHydrationBridge;
		try {
			bridge = createBridge();
		} catch {
			return null;
		}
		this.activeHydrationBridges.add(bridge);
		try {
			const hydrated = await bridge.hydrate(source, request);
			if (generation !== this.generation) return null;
			if (!hydrated) this.invalidate(state);
			return hydrated;
		} catch {
			return null;
		} finally {
			this.activeHydrationBridges.delete(bridge);
			bridge.dispose();
		}
	}

	private async loadSource(
		request: SyntheticFabStarterRequest,
		state: CatalogArtifactState,
	): Promise<ArtifactLoadResult> {
		if (state.verifiedArtifact !== NO_VERIFIED_ARTIFACT) {
			return Object.freeze({ ok: true, value: state.verifiedArtifact });
		}
		if (state.cachedSource !== NO_CACHED_SOURCE) {
			return Object.freeze({ ok: true, value: state.cachedSource });
		}
		if (state.sourceInFlight) return state.sourceInFlight;
		const loading = Promise.resolve()
			.then(() => this.loader(request))
			.then(
				(value): ArtifactLoadResult => {
					state.cachedSource = value;
					return Object.freeze({ ok: true, value });
				},
				(): ArtifactLoadResult => Object.freeze({ ok: false }),
			)
			.finally(() => {
				if (state.sourceInFlight === loading) state.sourceInFlight = null;
			});
		state.sourceInFlight = loading;
		return loading;
	}

	private invalidate(state: CatalogArtifactState): void {
		state.cachedSource = NO_CACHED_SOURCE;
		state.verifiedArtifact = NO_VERIFIED_ARTIFACT;
		state.invalidArtifact = true;
	}

	private stateForRequest(request: SyntheticFabStarterRequest): CatalogArtifactState | null {
		const artifactId = syntheticFabStarterCertifiedArtifactIdForRequest(request);
		if (!artifactId) return null;
		const existing = this.states.get(artifactId);
		if (existing) return existing;
		const state: CatalogArtifactState = {
			cachedSource: NO_CACHED_SOURCE,
			verifiedArtifact: NO_VERIFIED_ARTIFACT,
			sourceInFlight: null,
			invalidArtifact: false,
		};
		this.states.set(artifactId, state);
		return state;
	}
}

const sharedCertifiedCatalog = new SyntheticFabStarterCertifiedCatalog();
const shippedArtifactSourcePromises = new Map<
	SyntheticFabStarterCertifiedArtifactId,
	Promise<string>
>();

export function loadCertifiedSyntheticFabStarter(
	request: SyntheticFabStarterRequest,
): Promise<HydratedCertifiedSyntheticFabStarter | null> {
	return sharedCertifiedCatalog.load(request);
}

export function syntheticFabStarterCertifiedCatalogMetadataForRequest(
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterCertifiedCatalogMetadata | null {
	const artifactId = syntheticFabStarterCertifiedArtifactIdForRequest(request);
	return artifactId ? (CATALOG_METADATA_BY_ARTIFACT_ID.get(artifactId) ?? null) : null;
}

export function preloadDefaultLargeFabCertifiedStarter(): Promise<boolean> {
	return sharedCertifiedCatalog.preload();
}

export function preloadDefaultFullFabCertifiedStarter(): Promise<boolean> {
	return sharedCertifiedCatalog.preload(defaultSyntheticFabStarterRequest("full-fab-52"));
}

export function preloadDefaultPairedCirculationFabCertifiedStarter(): Promise<boolean> {
	return sharedCertifiedCatalog.preload(
		defaultSyntheticFabStarterRequest("paired-circulation-fab-52"),
	);
}

export function preloadDefaultProductionFabCertifiedStarter(): Promise<boolean> {
	return sharedCertifiedCatalog.preload(defaultSyntheticFabStarterRequest("production-fab-60"));
}

export function preloadDefaultCentralSpineFabCertifiedStarter(): Promise<boolean> {
	return sharedCertifiedCatalog.preload(defaultSyntheticFabStarterRequest("central-spine-fab-24"));
}

export function preloadDefaultParallelHallFabCertifiedStarter(): Promise<boolean> {
	return sharedCertifiedCatalog.preload(defaultSyntheticFabStarterRequest("parallel-hall-fab-12"));
}

/** Fetch the immutable raw module without parsing or hydrating its large payload on the UI thread. */
export function prefetchDefaultParallelHallFabCertifiedArtifactSource(): Promise<boolean> {
	return loadShippedCertifiedArtifactSource(
		defaultSyntheticFabStarterRequest("parallel-hall-fab-12"),
	).then(
		() => true,
		() => false,
	);
}

/** Fetch the default full-FAB source ahead of opening its dialog without hydrating typed arrays. */
export function prefetchDefaultFullFabCertifiedArtifactSource(): Promise<boolean> {
	return loadShippedCertifiedArtifactSource(defaultSyntheticFabStarterRequest("full-fab-52")).then(
		() => true,
		() => false,
	);
}

export function prefetchDefaultPairedCirculationFabCertifiedArtifactSource(): Promise<boolean> {
	return loadShippedCertifiedArtifactSource(
		defaultSyntheticFabStarterRequest("paired-circulation-fab-52"),
	).then(
		() => true,
		() => false,
	);
}

async function loadShippedCertifiedArtifactSource(
	request: SyntheticFabStarterRequest,
): Promise<string> {
	const artifactId = syntheticFabStarterCertifiedArtifactIdForRequest(request);
	if (!artifactId) throw new Error("No shipped certified artifact exists for this request.");
	const cached = shippedArtifactSourcePromises.get(artifactId);
	if (cached) return cached;
	const loading = importShippedCertifiedArtifactSource(artifactId).catch((error) => {
		if (shippedArtifactSourcePromises.get(artifactId) === loading) {
			shippedArtifactSourcePromises.delete(artifactId);
		}
		throw error;
	});
	shippedArtifactSourcePromises.set(artifactId, loading);
	return loading;
}

async function importShippedCertifiedArtifactSource(
	artifactId: SyntheticFabStarterCertifiedArtifactId,
): Promise<string> {
	const module = await SHIPPED_ARTIFACT_SOURCE_IMPORTERS[artifactId]();
	const source = module.default;
	// Exact UTF-8 validation is intentionally deferred to decodeArtifactSource at the load boundary.
	// This lower-bound guard prevents an obviously oversized source without scanning or allocating it.
	if (
		typeof source !== "string" ||
		source.length > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES
	) {
		throw new Error("Shipped certified FAB artifact exceeds its source byte budget.");
	}
	return source;
}

type ShippedArtifactSourceModule = Readonly<{ default: string }>;
type ShippedArtifactSourceImporter = () => Promise<ShippedArtifactSourceModule>;

const SHIPPED_ARTIFACT_SOURCE_IMPORTERS: Readonly<
	Record<SyntheticFabStarterCertifiedArtifactId, ShippedArtifactSourceImporter>
> = Object.freeze({
	[SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID]: () =>
		import("../generated/synthetic-fab-presets/large-fab-60.default.v3.json?raw"),
	[PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID]: () =>
		import("../generated/synthetic-fab-presets/paired-circulation-fab-52.default.v4.json?raw"),
	[FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID]: () =>
		import("../generated/synthetic-fab-presets/full-fab-52.default.v3.json?raw"),
	[PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID]: () =>
		import("../generated/synthetic-fab-presets/parallel-hall-fab-12.default.v3.json?raw"),
	[CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID]: () =>
		import("../generated/synthetic-fab-presets/central-spine-fab-24.default.v3.json?raw"),
	[PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID]: () =>
		import("../generated/synthetic-fab-presets/production-fab-60.default.v3.json?raw"),
});

function metadata(
	requestId: SyntheticFabStarterRequest["id"],
	artifactId: SyntheticFabStarterCertifiedArtifactId,
): SyntheticFabStarterCertifiedCatalogMetadata {
	return Object.freeze({ requestId, artifactId, loading: "lazy-raw-import" });
}

function decodeArtifactSource(source: unknown): unknown {
	if (typeof source !== "string") return source;
	if (utf8ByteLengthExceeds(source, SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES)) {
		throw new Error("Shipped certified FAB artifact exceeds its source byte budget.");
	}
	return JSON.parse(source) as unknown;
}

/** Exact UTF-8 budget check without allocating a second source-sized Uint8Array. */
function utf8ByteLengthExceeds(source: string, maximumBytes: number): boolean {
	if (source.length > maximumBytes) return true;
	let bytes = 0;
	for (let index = 0; index < source.length; index++) {
		const code = source.charCodeAt(index);
		if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = source.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index += 1;
			} else {
				bytes += 3;
			}
		} else {
			bytes += 3;
		}
		if (bytes > maximumBytes) return true;
	}
	return false;
}

function freezeJsonContainers(value: unknown): unknown {
	if (typeof value !== "object" || value === null || ArrayBuffer.isView(value)) return value;
	for (const child of Array.isArray(value) ? value : Object.values(value)) {
		freezeJsonContainers(child);
	}
	return Object.freeze(value);
}

function canUseCertifiedArtifactHydrationWorker(): boolean {
	return typeof globalThis.Worker === "function";
}
