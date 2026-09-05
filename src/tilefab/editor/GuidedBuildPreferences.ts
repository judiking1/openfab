export const GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION = 2;

export type GuidedBuildEntryChoice = "guided" | "template" | "blank" | "dismissed";

export interface GuidedBuildPreferences {
	readonly schemaVersion: typeof GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION;
	readonly lastEntryChoice: GuidedBuildEntryChoice | null;
	readonly navigationAcknowledged: boolean;
	readonly graduatedProjectId: string | null;
}

export interface GuidedBuildPreferencePort {
	readonly available: boolean;
	load(): Promise<GuidedBuildPreferences | null>;
	save(preferences: GuidedBuildPreferences): Promise<boolean>;
}

export function createGuidedBuildPreferences(): GuidedBuildPreferences {
	return freezeGuidedBuildPreferences({
		schemaVersion: GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION,
		lastEntryChoice: null,
		navigationAcknowledged: false,
		graduatedProjectId: null,
	});
}

export function parseGuidedBuildPreferences(value: unknown): GuidedBuildPreferences | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Omit<Partial<GuidedBuildPreferences>, "schemaVersion"> & {
		readonly schemaVersion?: number;
	};
	if (
		candidate.schemaVersion === 1 &&
		(candidate.lastEntryChoice === null || isGuidedBuildEntryChoice(candidate.lastEntryChoice)) &&
		typeof candidate.navigationAcknowledged === "boolean"
	) {
		return freezeGuidedBuildPreferences({
			schemaVersion: GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION,
			lastEntryChoice: candidate.lastEntryChoice,
			navigationAcknowledged: candidate.navigationAcknowledged,
			graduatedProjectId: null,
		});
	}
	if (
		candidate.schemaVersion !== GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION ||
		(candidate.lastEntryChoice !== null && !isGuidedBuildEntryChoice(candidate.lastEntryChoice)) ||
		typeof candidate.navigationAcknowledged !== "boolean" ||
		(candidate.graduatedProjectId !== null &&
			(typeof candidate.graduatedProjectId !== "string" ||
				candidate.graduatedProjectId.trim().length === 0))
	) {
		return null;
	}
	return freezeGuidedBuildPreferences(candidate as GuidedBuildPreferences);
}

export function recordGuidedBuildEntryChoice(
	preferences: GuidedBuildPreferences | null,
	choice: GuidedBuildEntryChoice,
): GuidedBuildPreferences {
	return freezeGuidedBuildPreferences({
		...(preferences ?? createGuidedBuildPreferences()),
		lastEntryChoice: choice,
	});
}

/**
 * Project evidence must remain live while a minimized guide can be resumed.
 * Transient panel guidance may stop with the panel, but discarding canonical evidence here would
 * make the resume affordance report an earlier mission than the one the user just minimized.
 */
export function guidedBuildNeedsProjectEvidence(
	guidedBuildOpen: boolean,
	preferences: GuidedBuildPreferences | null,
): boolean {
	return guidedBuildOpen || preferences?.lastEntryChoice === "guided";
}

export function acknowledgeGuidedBuildNavigation(
	preferences: GuidedBuildPreferences | null,
): GuidedBuildPreferences {
	return freezeGuidedBuildPreferences({
		...(preferences ?? createGuidedBuildPreferences()),
		navigationAcknowledged: true,
	});
}

export function graduateGuidedBuildPractice(
	preferences: GuidedBuildPreferences | null,
	projectId: string,
): GuidedBuildPreferences {
	const normalizedProjectId = projectId.trim();
	if (normalizedProjectId.length === 0) throw new TypeError("Graduated project id is required.");
	return freezeGuidedBuildPreferences({
		...(preferences ?? createGuidedBuildPreferences()),
		graduatedProjectId: normalizedProjectId,
	});
}

function isGuidedBuildEntryChoice(value: unknown): value is GuidedBuildEntryChoice {
	return value === "guided" || value === "template" || value === "blank" || value === "dismissed";
}

function freezeGuidedBuildPreferences(preferences: GuidedBuildPreferences): GuidedBuildPreferences {
	return Object.freeze({ ...preferences });
}
