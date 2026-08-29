import { describe, expect, it } from "vitest";
import { createFullFabAssemblyPlan, fullFabMinimumPitchMeters } from "./FullFabAssemblyPlan";

const DEFAULT_PROFILE = Object.freeze({
	bayCount: 52,
	bayDepthMeters: 104,
	bayFrontageMeters: 40,
	bayPitchMeters: 44,
});

describe("FullFabAssemblyPlan", () => {
	it("builds one factory perimeter around two halls, four Banks, and 52 large Bays", () => {
		const plan = createFullFabAssemblyPlan(DEFAULT_PROFILE);

		expect(plan.id).toBe("full-fab-52");
		expect(plan.halls).toHaveLength(2);
		expect(plan.banks).toHaveLength(4);
		expect(plan.banks.map((bank) => bank.bays.length)).toEqual([13, 13, 13, 13]);
		expect(plan.banks.flatMap((bank) => bank.bays)).toHaveLength(52);
		expect(plan.banks.flatMap((bank) => bank.bays.flatMap((bay) => bay.processLoops))).toHaveLength(
			104,
		);
		expect(plan.gateways).toHaveLength(8);
		expect(plan.outer.lengthMeters).toBe(632);
		expect(plan.outer.depthMeters).toBe(608);
	});

	it("keeps all nested Process Loops slender and inside their Bay depth", () => {
		const plan = createFullFabAssemblyPlan(DEFAULT_PROFILE);

		for (const bay of plan.banks.flatMap((bank) => bank.bays)) {
			expect(bay.processLoops).toHaveLength(2);
			for (const loop of bay.processLoops) {
				expect(loop.depthMeters).toBeLessThan(bay.depthMeters);
				expect(loop.depthMeters / loop.frontageMeters).toBeGreaterThanOrEqual(6);
			}
		}
	});

	it("is deterministic and changes identity across every public sizing axis", () => {
		const base = createFullFabAssemblyPlan(DEFAULT_PROFILE);
		expect(createFullFabAssemblyPlan(DEFAULT_PROFILE).planFingerprint).toBe(base.planFingerprint);
		for (const profile of [
			{ ...DEFAULT_PROFILE, bayCount: 56 },
			{ ...DEFAULT_PROFILE, bayDepthMeters: 108 },
			{ ...DEFAULT_PROFILE, bayFrontageMeters: 44, bayPitchMeters: 48 },
			{ ...DEFAULT_PROFILE, bayPitchMeters: 48 },
		]) {
			expect(createFullFabAssemblyPlan(profile).planFingerprint).not.toBe(base.planFingerprint);
		}
	});

	it("rejects partial Banks and spacing without the modular service gap", () => {
		expect(fullFabMinimumPitchMeters(40)).toBe(44);
		expect(() => createFullFabAssemblyPlan({ ...DEFAULT_PROFILE, bayCount: 50 })).toThrow(
			/divisible by four/,
		);
		expect(() => createFullFabAssemblyPlan({ ...DEFAULT_PROFILE, bayDepthMeters: 124 })).toThrow(
			/80-120 m/,
		);
		expect(() => createFullFabAssemblyPlan({ ...DEFAULT_PROFILE, bayPitchMeters: 40 })).toThrow(
			/at least 4 m/,
		);
	});
});
