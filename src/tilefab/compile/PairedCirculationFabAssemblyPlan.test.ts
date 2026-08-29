import { describe, expect, it } from "vitest";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	createPairedCirculationFabAssemblyPlan,
	pairedCirculationFabMinimumPitchMeters,
} from "./PairedCirculationFabAssemblyPlan";

const DEFAULT_PROFILE = Object.freeze({
	bayCount: 52,
	bayDepthMeters: 104,
	bayFrontageMeters: 40,
	bayPitchMeters: 48,
});

describe("PairedCirculationFabAssemblyPlan", () => {
	it("builds paired outer circulation, two paired halls, and four 13-Bay Banks", () => {
		const plan = createPairedCirculationFabAssemblyPlan(DEFAULT_PROFILE);

		expect(plan.id).toBe("paired-circulation-fab-52");
		expect(plan.outer.laneSpacingMeters).toBe(4);
		expect(plan.outer.plannerFingerprint).toMatch(/^[0-9a-f:]+$/);
		expect(plan.outer.laneA.pose.flow).toBe("forward");
		expect(plan.outer.laneB.pose.flow).toBe("reverse");
		expect(plan.halls).toHaveLength(2);
		expect(plan.banks.map((bank) => bank.bays.length)).toEqual([13, 13, 13, 13]);
		expect(plan.banks.flatMap((bank) => bank.bays)).toHaveLength(52);
		expect(plan.gateways).toHaveLength(4);
		expect(plan.outer.turnbacks.map((turnback) => turnback.id)).toEqual(["origin-end", "far-end"]);
		for (const hall of plan.halls) {
			expect(hall.interbay.laneAFlow).toBe(DIR_E);
			expect(hall.interbay.laneBFlow).toBe(DIR_W);
			expect(hall.interbay.laneSpacingMeters).toBe(2);
		}
	});

	it("binds every Hall gateway to exact owned runs and junctions", () => {
		const plan = createPairedCirculationFabAssemblyPlan(DEFAULT_PROFILE);

		for (const gateway of plan.gateways) {
			expect(gateway.exactJunctions, gateway.id).toBeDefined();
			expect(runContains(gateway.sourceRun, gateway.sourceAnchor), gateway.id).toBe(true);
			expect(runContains(gateway.targetRun, gateway.targetAnchor), gateway.id).toBe(true);
			expect(gateway.expectedOutboundTurns, gateway.id).not.toBeNull();
			expect(gateway.expectedReturnTurns, gateway.id).not.toBeNull();
		}

		for (const hall of plan.halls) {
			const east = plan.gateways.find((gateway) => gateway.id === `${hall.id}-EAST-INNER-GATEWAY`);
			expect(east?.sourceRun.ownerId).toBe(plan.outer.laneB.id);
			expect(east?.targetRun.ownerId).toBe(hall.interbay.id);
			expect(east?.sourceRun.axis).toBe("y");
			expect(east?.targetRun.axis).toBe("x");
		}
	});

	it("places every internal Process Loop inside a longitudinal closed Bay envelope", () => {
		const plan = createPairedCirculationFabAssemblyPlan(DEFAULT_PROFILE);

		for (const bay of plan.banks.flatMap((bank) => bank.bays)) {
			expect(bay.processLoops).toHaveLength(bay.variant === "single-loop" ? 1 : 2);
			for (const loop of bay.processLoops) {
				expect(loop.pose.side).toBe(bay.shellPose.side);
				expect(loop.pose.forward).toBe(bay.shellPose.forward);
				expect(loop.depthMeters).toBe(bay.frontageMeters - 8);
				if (bay.side === "north") {
					expect(loop.anchor.y).toBeLessThan(bay.shellAnchor.y);
				} else {
					expect(loop.anchor.y).toBeGreaterThan(bay.shellAnchor.y);
				}
			}
			expect(bay.gateway.sourceAnchor.x).toBe(bay.gateway.targetAnchor.x);
			expect(Math.abs(bay.gateway.sourceAnchor.y - bay.gateway.targetAnchor.y)).toBe(6);
			const hall = plan.halls[bay.bankId.startsWith("PAIRED-HALL-1") ? 0 : 1];
			expect(bay.gateway.sourceRun.ownerId).toBe(hall.interbay.id);
		}
	});

	it("mixes explicit Single-loop and Twin-loop Bay families deterministically", () => {
		const first = createPairedCirculationFabAssemblyPlan(DEFAULT_PROFILE);
		const second = createPairedCirculationFabAssemblyPlan(DEFAULT_PROFILE);
		const variants = first.banks.flatMap((bank) => bank.bays.map((bay) => bay.variant));

		expect(variants).toContain("single-loop");
		expect(variants).toContain("twin-loop");
		expect(second.planFingerprint).toBe(first.planFingerprint);
		expect(
			createPairedCirculationFabAssemblyPlan({
				...DEFAULT_PROFILE,
				bayPitchMeters: 52,
			}).planFingerprint,
		).not.toBe(first.planFingerprint);
	});

	it("rejects partial Banks and service gaps smaller than eight meters", () => {
		expect(pairedCirculationFabMinimumPitchMeters(40)).toBe(48);
		expect(() =>
			createPairedCirculationFabAssemblyPlan({
				...DEFAULT_PROFILE,
				bayCount: 50,
			}),
		).toThrow(/divisible by four/);
		expect(() =>
			createPairedCirculationFabAssemblyPlan({
				...DEFAULT_PROFILE,
				bayPitchMeters: 44,
			}),
		).toThrow(/8 m service gap/);
	});
});

function runContains(
	run: ReturnType<typeof createPairedCirculationFabAssemblyPlan>["gateways"][number]["sourceRun"],
	cell: Readonly<{ x: number; y: number }>,
): boolean {
	const fixed = run.axis === "x" ? cell.y : cell.x;
	const variable = run.axis === "x" ? cell.x : cell.y;
	return fixed === run.fixedCoordinate && variable >= run.minimum && variable <= run.maximum;
}
