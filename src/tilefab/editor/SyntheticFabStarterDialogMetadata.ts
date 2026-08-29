import {
	createSyntheticFabAssemblyPlan,
	type SyntheticFabAssemblyPlan,
} from "../compile/SyntheticFabAssemblyPlan";
import {
	defaultSyntheticFabStarterRequest,
	type SyntheticFabStarterRequest,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import {
	type SyntheticFabStarterSchematic,
	syntheticFabStarterSchematicFromAssemblyPlan,
} from "../render/SyntheticFabStarterSchematic";

const LARGE_FAB_DIALOG_METADATA_CACHE_LIMIT = 24;
const largeFabDialogMetadataCache = new Map<string, LargeFabDialogMetadata>();

export interface LargeFabDialogMetadata {
	readonly assembly: SyntheticFabAssemblyPlan;
	readonly schematic: SyntheticFabStarterSchematic;
}

export function preloadDefaultLargeFabDialogMetadata(): void {
	largeFabDialogMetadata(defaultSyntheticFabStarterRequest("large-fab-60"));
}

export function largeFabDialogMetadata(
	request: SyntheticFabStarterRequest,
): LargeFabDialogMetadata | null {
	if (request.id !== "large-fab-60") return null;
	const key = syntheticFabStarterRequestFingerprint(request);
	const cached = largeFabDialogMetadataCache.get(key);
	if (cached) {
		largeFabDialogMetadataCache.delete(key);
		largeFabDialogMetadataCache.set(key, cached);
		return cached;
	}
	const assembly = createSyntheticFabAssemblyPlan(
		{
			processBlockCount: request.parameters.processBlockCount,
			totalBayCount: request.parameters.bayCount,
		},
		request.parameters.bayPitchMeters,
	);
	const metadata = Object.freeze({
		assembly,
		schematic: syntheticFabStarterSchematicFromAssemblyPlan(assembly),
	});
	while (largeFabDialogMetadataCache.size >= LARGE_FAB_DIALOG_METADATA_CACHE_LIMIT) {
		const oldest = largeFabDialogMetadataCache.keys().next().value;
		if (typeof oldest !== "string") break;
		largeFabDialogMetadataCache.delete(oldest);
	}
	largeFabDialogMetadataCache.set(key, metadata);
	return metadata;
}
