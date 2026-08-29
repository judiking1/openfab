import { describe, expect, it } from "vitest";
import {
	createParallelHallFabAssemblyPlan,
	parallelHallFabMinimumPitchMeters,
} from "./ParallelHallFabAssemblyPlan";

const DEFAULT_PROFILE = Object.freeze({
	bayCount: 12,
	bayDepthMeters: 104,
	bayFrontageMeters: 40,
	bayPitchMeters: 44,
});

describe("ParallelHallFabAssemblyPlan", () => {
	it("creates two balanced Banks with slender full-depth Process Loops", () => {
		const plan = createParallelHallFabAssemblyPlan(DEFAULT_PROFILE);

		expect(plan.id).toBe("parallel-hall-fab-12");
		expect(plan.banks.map((bank) => bank.bays.length)).toEqual([6, 6]);
		expect(plan.banks.flatMap((bank) => bank.bays)).toHaveLength(12);
		expect(plan.banks.flatMap((bank) => bank.bays.flatMap((bay) => bay.processLoops))).toHaveLength(
			24,
		);
		expect(plan.gateways).toHaveLength(4);
		expect(plan.outer.lengthMeters).toBe(324);
		expect(plan.outer.depthMeters).toBe(316);
		for (const bay of plan.banks.flatMap((bank) => bank.bays)) {
			expect(bay.processLoops).toHaveLength(2);
			for (const loop of bay.processLoops) {
				expect(loop.depthMeters / loop.frontageMeters).toBeGreaterThanOrEqual(6);
			}
		}
	});

	it("keeps collectors, interbay, and outer circulation geometrically separated", () => {
		const plan = createParallelHallFabAssemblyPlan(DEFAULT_PROFILE);
		const north = plan.banks[0].collector;
		const south = plan.banks[1].collector;

		expect(north.origin.y + north.depthMeters).toBeLessThan(plan.interbaySpine.origin.y);
		expect(plan.interbaySpine.origin.y + plan.interbaySpine.depthMeters).toBeLessThan(
			south.origin.y,
		);
		expect(plan.interbaySpine.origin.x).toBeGreaterThan(plan.outer.origin.x);
		expect(plan.interbaySpine.origin.x + plan.interbaySpine.lengthMeters).toBeLessThan(
			plan.outer.origin.x + plan.outer.lengthMeters,
		);
	});

	it("is deterministic and changes identity with every exposed sizing axis", () => {
		const base = createParallelHallFabAssemblyPlan(DEFAULT_PROFILE);
		expect(createParallelHallFabAssemblyPlan(DEFAULT_PROFILE).planFingerprint).toBe(
			base.planFingerprint,
		);
		for (const profile of [
			{ ...DEFAULT_PROFILE, bayCount: 14 },
			{ ...DEFAULT_PROFILE, bayDepthMeters: 108 },
			{ ...DEFAULT_PROFILE, bayFrontageMeters: 44, bayPitchMeters: 48 },
			{ ...DEFAULT_PROFILE, bayPitchMeters: 48 },
		]) {
			expect(createParallelHallFabAssemblyPlan(profile).planFingerprint).not.toBe(
				base.planFingerprint,
			);
		}
	});

	it("rejects odd counts and spacing that cannot preserve service clearance", () => {
		expect(parallelHallFabMinimumPitchMeters(40)).toBe(44);
		expect(
			createParallelHallFabAssemblyPlan({ ...DEFAULT_PROFILE, bayDepthMeters: 120 }).profile
				.bayDepthMeters,
		).toBe(120);
		expect(() => createParallelHallFabAssemblyPlan({ ...DEFAULT_PROFILE, bayCount: 11 })).toThrow(
			/even 8-20/,
		);
		expect(() =>
			createParallelHallFabAssemblyPlan({ ...DEFAULT_PROFILE, bayDepthMeters: 124 }),
		).toThrow(/80-120 m/);
		expect(() =>
			createParallelHallFabAssemblyPlan({ ...DEFAULT_PROFILE, bayPitchMeters: 40 }),
		).toThrow(/at least 4 m/);
	});
});
