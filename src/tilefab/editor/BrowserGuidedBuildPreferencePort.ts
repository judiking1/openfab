import {
	GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION,
	type GuidedBuildPreferencePort,
	type GuidedBuildPreferences,
	parseGuidedBuildPreferences,
} from "./GuidedBuildPreferences";

export const GUIDED_BUILD_PREFERENCES_STORAGE_KEY = "openfab.guided-build.preferences.v1";
const GUIDED_BUILD_PREFERENCES_MAX_CHARACTERS = 1_024;

export interface GuidedBuildPreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export class BrowserGuidedBuildPreferencePort implements GuidedBuildPreferencePort {
	readonly available: boolean;
	private readonly storage: GuidedBuildPreferenceStorage | null;

	constructor(storage: GuidedBuildPreferenceStorage | null = browserStorage()) {
		this.storage = storage;
		this.available = storage !== null;
	}

	async load(): Promise<GuidedBuildPreferences | null> {
		if (!this.storage) return null;
		try {
			const json = this.storage.getItem(GUIDED_BUILD_PREFERENCES_STORAGE_KEY);
			if (!json || json.length > GUIDED_BUILD_PREFERENCES_MAX_CHARACTERS) return null;
			return parseGuidedBuildPreferences(JSON.parse(json));
		} catch {
			return null;
		}
	}

	async save(preferences: GuidedBuildPreferences): Promise<boolean> {
		if (!this.storage) return false;
		const parsed = parseGuidedBuildPreferences(preferences);
		if (!parsed || parsed.schemaVersion !== GUIDED_BUILD_PREFERENCES_SCHEMA_VERSION) return false;
		try {
			const json = JSON.stringify(parsed);
			if (json.length > GUIDED_BUILD_PREFERENCES_MAX_CHARACTERS) return false;
			this.storage.setItem(GUIDED_BUILD_PREFERENCES_STORAGE_KEY, json);
			return true;
		} catch {
			return false;
		}
	}
}

function browserStorage(): GuidedBuildPreferenceStorage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
