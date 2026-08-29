export interface RailClearanceProfile {
	readonly id: string;
	readonly version: number;
	readonly beamRadiusMillimeters: number;
	readonly ohtSweepRadiusMillimeters: number;
	readonly installationRadiusMillimeters: number;
	readonly approximationToleranceMillimeters: number;
}

const PROFILE_FIELDS = Object.freeze([
	"id",
	"version",
	"beamRadiusMillimeters",
	"ohtSweepRadiusMillimeters",
	"installationRadiusMillimeters",
	"approximationToleranceMillimeters",
] as const satisfies readonly (keyof RailClearanceProfile)[]);

/**
 * OpenFab-owned design defaults for compact AMHS authoring on a 1 m grid.
 * These values are project geometry parameters, not measured, certified, or
 * proprietary real-FAB dimensions.
 */
const OPENFAB_COMPACT_AMHS_V1 = Object.freeze({
	id: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
	version: 1,
	beamRadiusMillimeters: 100,
	ohtSweepRadiusMillimeters: 350,
	installationRadiusMillimeters: 450,
	approximationToleranceMillimeters: 10,
} satisfies RailClearanceProfile);

export const OPENFAB_CLEARANCE_PROFILE_CATALOG: readonly RailClearanceProfile[] = Object.freeze([
	OPENFAB_COMPACT_AMHS_V1,
]);

export const DEFAULT_RAIL_CLEARANCE_PROFILE: RailClearanceProfile = OPENFAB_COMPACT_AMHS_V1;

/** Resolve an exact, versioned OpenFab catalog ID without normalization or fallback. */
export function resolveRailClearanceProfile(id: string): RailClearanceProfile | null {
	for (const profile of OPENFAB_CLEARANCE_PROFILE_CATALOG) {
		if (profile.id === id) return profile;
	}
	return null;
}

/**
 * Validate parsed project input against the immutable OpenFab catalog.
 * Custom IDs or changed dimensions are rejected until a later roadmap phase
 * defines an explicit extension contract.
 */
export function railClearanceProfileError(profile: unknown): string | null {
	if (!isRecord(profile)) return "Rail clearance profile must be an object.";

	const keys = Object.keys(profile).sort();
	const expectedKeys = [...PROFILE_FIELDS].sort();
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key, index) => key !== expectedKeys[index])
	) {
		return "Rail clearance profile fields do not match the OpenFab contract.";
	}

	if (typeof profile.id !== "string" || profile.id.length === 0) {
		return "Rail clearance profile id must be a non-empty string.";
	}
	if (!isPositiveInteger(profile.version)) {
		return "Rail clearance profile version must be a positive integer.";
	}

	for (const field of [
		"beamRadiusMillimeters",
		"ohtSweepRadiusMillimeters",
		"installationRadiusMillimeters",
		"approximationToleranceMillimeters",
	] as const) {
		if (!isPositiveInteger(profile[field])) {
			return `Rail clearance profile ${field} must be a positive integer in millimeters.`;
		}
	}
	const validatedProfile = profile as unknown as RailClearanceProfile;

	if (
		validatedProfile.approximationToleranceMillimeters > validatedProfile.beamRadiusMillimeters ||
		validatedProfile.beamRadiusMillimeters >= validatedProfile.ohtSweepRadiusMillimeters ||
		validatedProfile.ohtSweepRadiusMillimeters >= validatedProfile.installationRadiusMillimeters
	) {
		return "Rail clearance radii must satisfy 0 < tolerance <= beam < OHT sweep < installation.";
	}

	const catalogProfile = resolveRailClearanceProfile(profile.id);
	if (!catalogProfile) return `Unknown OpenFab rail clearance profile id: ${profile.id}.`;
	for (const field of PROFILE_FIELDS) {
		if (profile[field] !== catalogProfile[field]) {
			return `Rail clearance profile ${profile.id} does not match its immutable catalog entry.`;
		}
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
