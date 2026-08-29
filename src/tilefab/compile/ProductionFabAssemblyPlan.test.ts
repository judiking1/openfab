import { describe, expect, it } from "vitest";
import { DIR_E, DIR_S, DIR_W } from "../core/railShape";
import {
	createProductionFabAssemblyPlan,
	PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION,
	type ProductionFabAssemblyPlan,
	type ProductionFabBayPlacement,
	type ProductionFabProfile,
	productionFabMaximumBayPitchMeters,
} from "./ProductionFabAssemblyPlan";

const DEFAULT_PROFILE = Object.freeze({
	bayCount: 60,
	bankCount: 3,
	bayPitchMeters: 112,
}) satisfies ProductionFabProfile;

interface Bounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

describe("ProductionFabAssemblyPlan", () => {
	it("builds the default 60-Bay hierarchy as three balanced Bay Banks", () => {
		const plan = createProductionFabAssemblyPlan(DEFAULT_PROFILE);
		const bays = plan.banks.flatMap((bank) => bank.bays);

		expect(plan.version).toBe(PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION);
		expect(plan.id).toBe("production-fab-60");
		expect(plan.profile).toEqual(DEFAULT_PROFILE);
		expect(plan.bayLengthMeters).toBe(96);
		expect(plan.bayDepthMeters).toBe(32);
		expect(plan.outer).toEqual({
			id: "FAB-OUTER-CIRCULATION",
			origin: { x: 0, y: 0 },
			lengthMeters: 1_176,
			depthMeters: 376,
			pose: { forward: DIR_E, side: "right", flow: "forward" },
		});
		expect(plan.interbaySpine).toEqual({
			id: "FAB-INTERBAY-SPINE",
			origin: { x: 0, y: 0 },
			lengthMeters: 24,
			depthMeters: 376,
			pose: { forward: DIR_E, side: "right", flow: "forward" },
		});
		expect(plan.banks.map((bank) => bank.id)).toEqual([
			"BAY-BANK-01",
			"BAY-BANK-02",
			"BAY-BANK-03",
		]);
		expect(plan.banks.map((bank) => bank.index)).toEqual([0, 1, 2]);
		expect(plan.banks.map((bank) => bank.bayCount)).toEqual([20, 20, 20]);
		expect(plan.banks.map((bank) => [bank.northBayCount, bank.southBayCount])).toEqual([
			[10, 10],
			[10, 10],
			[10, 10],
		]);
		expect(bays).toHaveLength(60);
		expect(bays.map((bay) => bay.id)).toEqual(
			Array.from({ length: 60 }, (_, index) => `BAY-${String(index + 1).padStart(3, "0")}`),
		);
		expect(new Set(bays.map((bay) => bay.id))).toHaveLength(60);
		const processLoops = bays.flatMap((bay) => bay.processLoops);
		expect(processLoops).toHaveLength(120);
		expect(new Set(processLoops.map((loop) => loop.id))).toHaveLength(120);

		for (const bank of plan.banks) {
			expect(bank.bays).toHaveLength(bank.bayCount);
			expect(bank.bays.every((bay) => bay.bankId === bank.id)).toBe(true);
			expect(bank.bays.slice(0, bank.northBayCount).map((bay) => bay.side)).toEqual(
				Array.from({ length: bank.northBayCount }, () => "north"),
			);
			expect(bank.bays.slice(bank.northBayCount).map((bay) => bay.side)).toEqual(
				Array.from({ length: bank.southBayCount }, () => "south"),
			);
			for (const bay of bank.bays) {
				expect(bay.processLoops.map((loop) => loop.id)).toEqual([
					`${bay.id}-PROCESS-LOOP-01`,
					`${bay.id}-PROCESS-LOOP-02`,
				]);
				expect(bay.processLoops.every((loop) => loop.pose === bay.pose)).toBe(true);
				expect(bay.processLoops.every((loop) => loop.depthMeters === 26)).toBe(true);
			}
		}
	});

	it("contains every spine, collector, and Bay footprint inside the outer circulation", () => {
		const plan = createProductionFabAssemblyPlan(DEFAULT_PROFILE);

		expectPlanContained(plan);
	});

	it.each([
		[{ bayCount: 50, bankCount: 3, bayPitchMeters: 104 }, [17, 17, 16]],
		[{ bayCount: 73, bankCount: 4, bayPitchMeters: 112 }, [19, 18, 18, 18]],
		[{ bayCount: 100, bankCount: 6, bayPitchMeters: 140 }, [17, 17, 17, 17, 16, 16]],
	] as const)("distributes the $0.bayCount-Bay/$0.bankCount-Bank/$0.bayPitchMeters m edge profile", (profile, expectedBankCounts) => {
		const plan = createProductionFabAssemblyPlan(profile);
		const bayIds = plan.banks.flatMap((bank) => bank.bays.map((bay) => bay.id));

		expect(plan.profile).toEqual(profile);
		expect(plan.banks.map((bank) => bank.bayCount)).toEqual(expectedBankCounts);
		expect(plan.banks.reduce((total, bank) => total + bank.bayCount, 0)).toBe(profile.bayCount);
		expect(
			Math.max(...plan.banks.map((bank) => bank.bayCount)) -
				Math.min(...plan.banks.map((bank) => bank.bayCount)),
		).toBeLessThanOrEqual(1);
		expect(bayIds).toHaveLength(profile.bayCount);
		expect(new Set(bayIds)).toHaveLength(profile.bayCount);
		for (const bank of plan.banks) {
			expect(bank.northBayCount).toBe(Math.ceil(bank.bayCount / 2));
			expect(bank.southBayCount).toBe(Math.floor(bank.bayCount / 2));
			expect(bank.bays).toHaveLength(bank.bayCount);
		}
		expectPlanContained(plan);
	});

	it("produces a deterministic fingerprint that changes with each profile axis", () => {
		const first = createProductionFabAssemblyPlan(DEFAULT_PROFILE);
		const repeated = createProductionFabAssemblyPlan({ ...DEFAULT_PROFILE });
		const variants = [
			createProductionFabAssemblyPlan({ ...DEFAULT_PROFILE, bayCount: 61 }),
			createProductionFabAssemblyPlan({ ...DEFAULT_PROFILE, bankCount: 4 }),
			createProductionFabAssemblyPlan({ ...DEFAULT_PROFILE, bayPitchMeters: 116 }),
		];

		expect(first).toEqual(repeated);
		expect(first.planFingerprint).toBe(repeated.planFingerprint);
		expect(first.planFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(new Set(variants.map((plan) => plan.planFingerprint))).toHaveLength(3);
		for (const variant of variants) {
			expect(variant.planFingerprint).not.toBe(first.planFingerprint);
		}
	});

	it("derives the pitch ceiling from Bay and Bank density", () => {
		expect(productionFabMaximumBayPitchMeters(60, 3)).toBe(140);
		expect(productionFabMaximumBayPitchMeters(100, 3)).toBe(112);
		expect(productionFabMaximumBayPitchMeters(100, 6)).toBe(140);
		expect(() => productionFabMaximumBayPitchMeters(101, 3)).toThrow(/must be valid/);
	});

	it.each([
		["Bay count below minimum", { ...DEFAULT_PROFILE, bayCount: 49 }, /50-100 integer/],
		["Bay count above maximum", { ...DEFAULT_PROFILE, bayCount: 101 }, /50-100 integer/],
		["fractional Bay count", { ...DEFAULT_PROFILE, bayCount: 60.5 }, /50-100 integer/],
		["Bank count below minimum", { ...DEFAULT_PROFILE, bankCount: 2 }, /3-6 integer/],
		["Bank count above maximum", { ...DEFAULT_PROFILE, bankCount: 7 }, /3-6 integer/],
		["fractional Bank count", { ...DEFAULT_PROFILE, bankCount: 3.5 }, /3-6 integer/],
		["Bay pitch below minimum", { ...DEFAULT_PROFILE, bayPitchMeters: 100 }, /104-140 m/],
		["Bay pitch above maximum", { ...DEFAULT_PROFILE, bayPitchMeters: 144 }, /104-140 m/],
		["Bay pitch off the 4 m step", { ...DEFAULT_PROFILE, bayPitchMeters: 106 }, /4 m steps/],
		["fractional Bay pitch", { ...DEFAULT_PROFILE, bayPitchMeters: 112.5 }, /integer/],
	] as const)("rejects %s", (_label, profile, expectedMessage) => {
		expect(() => createProductionFabAssemblyPlan(profile)).toThrow(RangeError);
		expect(() => createProductionFabAssemblyPlan(profile)).toThrow(expectedMessage);
	});
});

function expectPlanContained(plan: ProductionFabAssemblyPlan): void {
	const outer = loopBounds(
		plan.outer.origin.x,
		plan.outer.origin.y,
		plan.outer.lengthMeters,
		plan.outer.depthMeters,
	);
	const spine = loopBounds(
		plan.interbaySpine.origin.x,
		plan.interbaySpine.origin.y,
		plan.interbaySpine.lengthMeters,
		plan.interbaySpine.depthMeters,
	);
	expectContained(spine, outer, "interbay spine");

	for (const bank of plan.banks) {
		const collector = loopBounds(
			bank.collector.origin.x,
			bank.collector.origin.y,
			bank.collector.depthMeters,
			bank.collector.lengthMeters,
		);
		expect(bank.collector.pose, bank.id).toEqual({
			forward: DIR_S,
			side: "left",
			flow: "forward",
		});
		expect(bank.collector.origin.x, bank.id).toBe(spine.maxX);
		expectContained(collector, outer, bank.collector.id);

		const sameSideBounds = { north: [] as Bounds[], south: [] as Bounds[] };
		for (const bay of bank.bays) {
			const bounds = bayBounds(bay);
			expectContained(bounds, outer, bay.id);
			expectContained(
				bounds,
				{
					...collector,
					minY: bay.side === "north" ? outer.minY : collector.maxY,
					maxY: bay.side === "north" ? collector.minY : outer.maxY,
				},
				bay.id,
			);
			expect(bay.pose.side, bay.id).toBe("right");
			expect(bay.pose.flow, bay.id).toBe("forward");
			if (bay.side === "north") {
				expect(bay.pose.forward, bay.id).toBe(DIR_W);
				expect(bounds.maxY, bay.id).toBe(collector.minY);
			} else {
				expect(bay.pose.forward, bay.id).toBe(DIR_E);
				expect(bounds.minY, bay.id).toBe(collector.maxY);
			}
			for (const processLoop of bay.processLoops) {
				expectContained(
					processLoopBounds(
						bay,
						processLoop.anchor.x,
						processLoop.anchor.y,
						processLoop.spanMeters,
						processLoop.depthMeters,
					),
					bounds,
					processLoop.id,
				);
				expect(processLoop.pose, processLoop.id).toEqual(bay.pose);
			}
			sameSideBounds[bay.side].push(bounds);
		}

		for (const side of ["north", "south"] as const) {
			const ordered = sameSideBounds[side].toSorted((left, right) => left.minX - right.minX);
			for (let index = 1; index < ordered.length; index++) {
				expect((ordered[index] as Bounds).minX, `${bank.id} ${side} Bay overlap`).toBeGreaterThan(
					(ordered[index - 1] as Bounds).maxX,
				);
			}
		}
	}
}

function processLoopBounds(
	bay: ProductionFabBayPlacement,
	anchorX: number,
	anchorY: number,
	spanMeters: number,
	depthMeters: number,
): Bounds {
	if (bay.pose.forward === DIR_W) {
		return loopBounds(anchorX - spanMeters, anchorY - depthMeters, spanMeters, depthMeters);
	}
	if (bay.pose.forward === DIR_E) {
		return loopBounds(anchorX, anchorY, spanMeters, depthMeters);
	}
	throw new Error(`Unsupported Process Loop pose for ${bay.id}.`);
}

function bayBounds(bay: ProductionFabBayPlacement): Bounds {
	if (bay.side === "north" && bay.pose.forward === DIR_W && bay.pose.side === "right") {
		return loopBounds(
			bay.anchor.x - bay.lengthMeters,
			bay.anchor.y - bay.depthMeters,
			bay.lengthMeters,
			bay.depthMeters,
		);
	}
	if (bay.side === "south" && bay.pose.forward === DIR_E && bay.pose.side === "right") {
		return loopBounds(bay.anchor.x, bay.anchor.y, bay.lengthMeters, bay.depthMeters);
	}
	throw new Error(`Unsupported production Bay pose for ${bay.id}.`);
}

function loopBounds(x: number, y: number, width: number, height: number): Bounds {
	return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

function expectContained(inner: Bounds, outer: Bounds, label: string): void {
	expect(inner.minX, `${label} min X`).toBeGreaterThanOrEqual(outer.minX);
	expect(inner.minY, `${label} min Y`).toBeGreaterThanOrEqual(outer.minY);
	expect(inner.maxX, `${label} max X`).toBeLessThanOrEqual(outer.maxX);
	expect(inner.maxY, `${label} max Y`).toBeLessThanOrEqual(outer.maxY);
}
