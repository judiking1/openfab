import { describe, expect, it } from "vitest";
import {
	centralSpineFabMinimumPitchMeters,
	createCentralSpineFabAssemblyPlan,
} from "./CentralSpineFabAssemblyPlan";

const DEFAULT_PROFILE = Object.freeze({
	bayCount: 24,
	bayDepthMeters: 72,
	bayFrontageMeters: 48,
	bayPitchMeters: 52,
});

describe("CentralSpineFabAssemblyPlan", () => {
	it("builds two opposed deep Bay banks inside one outer circulation", () => {
		const plan = createCentralSpineFabAssemblyPlan(DEFAULT_PROFILE);

		expect(plan).toMatchObject({
			version: 1,
			id: "central-spine-fab-24",
			outer: { origin: { x: 0, y: 0 }, lengthMeters: 668, depthMeters: 200 },
			interbaySpine: { origin: { x: 0, y: 92 }, lengthMeters: 668, depthMeters: 16 },
		});
		expect(plan.banks.map((bank) => [bank.side, bank.bays.length])).toEqual([
			["north", 12],
			["south", 12],
		]);
		expect(plan.banks.flatMap((bank) => bank.bays)).toHaveLength(24);
	});

	it("reserves physical turnout clearance around two full-depth Process Loops per Bay", () => {
		const plan = createCentralSpineFabAssemblyPlan(DEFAULT_PROFILE);
		for (const bay of plan.banks.flatMap((bank) => bank.bays)) {
			expect(bay.processLoops).toHaveLength(2);
			expect(bay.processLoops.map((loop) => loop.frontageMeters)).toEqual([18, 18]);
			expect(bay.processLoops.map((loop) => loop.depthMeters)).toEqual([64, 64]);
			const [first, second] = bay.processLoops;
			if (!first || !second) throw new Error("Expected two Process Loops.");
			expect(Math.abs(second.anchor.x - first.anchor.x)).toBe(22);
		}
		expect(centralSpineFabMinimumPitchMeters(DEFAULT_PROFILE.bayFrontageMeters)).toBe(52);
	});

	it("is deterministic and changes identity when a supported dimension changes", () => {
		const first = createCentralSpineFabAssemblyPlan(DEFAULT_PROFILE);
		const second = createCentralSpineFabAssemblyPlan({ ...DEFAULT_PROFILE });
		const deeper = createCentralSpineFabAssemblyPlan({ ...DEFAULT_PROFILE, bayDepthMeters: 76 });

		expect(second).toEqual(first);
		expect(second.planFingerprint).toBe(first.planFingerprint);
		expect(deeper.planFingerprint).not.toBe(first.planFingerprint);
		expect(deeper.outer.depthMeters).toBe(208);
	});

	it("rejects dimensions that cannot preserve the modular grammar", () => {
		expect(() =>
			createCentralSpineFabAssemblyPlan({ ...DEFAULT_PROFILE, bayFrontageMeters: 44 }),
		).toThrow(/frontage/i);
		expect(() =>
			createCentralSpineFabAssemblyPlan({ ...DEFAULT_PROFILE, bayPitchMeters: 48 }),
		).toThrow(/pitch/i);
		expect(() =>
			createCentralSpineFabAssemblyPlan({ ...DEFAULT_PROFILE, bayDepthMeters: 73 }),
		).toThrow(/depth/i);
	});
});
