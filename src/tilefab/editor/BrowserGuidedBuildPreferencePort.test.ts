import { describe, expect, it } from "vitest";
import {
	BrowserGuidedBuildPreferencePort,
	GUIDED_BUILD_PREFERENCES_STORAGE_KEY,
	type GuidedBuildPreferenceStorage,
} from "./BrowserGuidedBuildPreferencePort";
import {
	acknowledgeGuidedBuildNavigation,
	createGuidedBuildPreferences,
	recordGuidedBuildEntryChoice,
} from "./GuidedBuildPreferences";

describe("BrowserGuidedBuildPreferencePort", () => {
	it("round-trips the bounded versioned UI preference record", async () => {
		const storage = new MemoryStorage();
		const port = new BrowserGuidedBuildPreferencePort(storage);
		const preferences = acknowledgeGuidedBuildNavigation(
			recordGuidedBuildEntryChoice(createGuidedBuildPreferences(), "guided"),
		);

		expect(port.available).toBe(true);
		expect(await port.save(preferences)).toBe(true);
		expect(await port.load()).toEqual(preferences);
		expect(storage.value(GUIDED_BUILD_PREFERENCES_STORAGE_KEY)?.length).toBeLessThan(1_024);
	});

	it("fails closed without browser storage", async () => {
		const port = new BrowserGuidedBuildPreferencePort(null);

		expect(port.available).toBe(false);
		expect(await port.load()).toBeNull();
		expect(await port.save(createGuidedBuildPreferences())).toBe(false);
	});

	it("ignores malformed and inaccessible storage", async () => {
		const malformed = new MemoryStorage();
		malformed.setItem(GUIDED_BUILD_PREFERENCES_STORAGE_KEY, "{broken");
		const inaccessible: GuidedBuildPreferenceStorage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		};

		expect(await new BrowserGuidedBuildPreferencePort(malformed).load()).toBeNull();
		expect(await new BrowserGuidedBuildPreferencePort(inaccessible).load()).toBeNull();
		expect(
			await new BrowserGuidedBuildPreferencePort(inaccessible).save(createGuidedBuildPreferences()),
		).toBe(false);
	});
});

class MemoryStorage implements GuidedBuildPreferenceStorage {
	private readonly entries = new Map<string, string>();

	getItem(key: string): string | null {
		return this.entries.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.entries.set(key, value);
	}

	value(key: string): string | null {
		return this.getItem(key);
	}
}
