import {
	type SyntheticFabStarterRequest,
	syntheticFabStarterAssemblyFingerprint,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import {
	preparedSyntheticFabStarterMatchesIndependentPreparation,
	SyntheticFabStarterBridge,
} from "./SyntheticFabStarterBridge";
import {
	type StarterPreviewPreparation,
	SyntheticFabStarterPreviewCache,
} from "./SyntheticFabStarterPreviewCache";

const VERIFIED_STARTER_CACHE_LIMIT = 8;
const VERIFIED_STARTER_CACHE_BYTES_LIMIT = 16 * 1024 * 1024;

export interface SyntheticFabStarterVerificationBridge {
	prepare(request: SyntheticFabStarterRequest): Promise<PreparedSyntheticFabStarter>;
	dispose(): void;
}

export class SyntheticFabStarterVerificationCache {
	private readonly cache: SyntheticFabStarterPreviewCache;

	constructor(
		maxEntries = VERIFIED_STARTER_CACHE_LIMIT,
		maxRetainedBytes = VERIFIED_STARTER_CACHE_BYTES_LIMIT,
	) {
		this.cache = new SyntheticFabStarterPreviewCache(maxEntries, maxRetainedBytes);
	}

	acquire(
		preview: PreparedSyntheticFabStarter,
		request: SyntheticFabStarterRequest,
		createBridge: () => SyntheticFabStarterVerificationBridge = () =>
			new SyntheticFabStarterBridge(),
	): StarterPreviewPreparation {
		const cacheKey = verifiedStarterCacheKey(request);
		const cached = this.cache.get(cacheKey);
		if (cached) {
			if (preparedSyntheticFabStarterMatchesIndependentPreparation(preview, cached, request)) {
				return Object.freeze({
					promise: Promise.resolve(cached),
					cancel: () => undefined,
				});
			}
			this.cache.delete(cacheKey);
		}
		return this.cache.acquire(cacheKey, () => {
			const bridge = createBridge();
			return Object.freeze({
				promise: bridge.prepare(request).then((independent) => {
					if (
						!preparedSyntheticFabStarterMatchesIndependentPreparation(preview, independent, request)
					) {
						throw new Error("Independent FAB verification does not match the prepared preview.");
					}
					return independent;
				}),
				cancel: () => bridge.dispose(),
			});
		});
	}
}

const sharedVerificationCache = new SyntheticFabStarterVerificationCache();

export function acquireVerifiedSyntheticFabStarter(
	preview: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): StarterPreviewPreparation {
	return sharedVerificationCache.acquire(preview, request);
}

function verifiedStarterCacheKey(request: SyntheticFabStarterRequest): string {
	return `${syntheticFabStarterRequestFingerprint(request)}|${syntheticFabStarterAssemblyFingerprint(request) ?? "no-plan"}`;
}
