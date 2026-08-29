import { describe, expect, it } from "vitest";
import {
	deriveSyntheticFabLayoutPlan,
	type SyntheticFabLayoutGateway,
	type SyntheticFabLayoutLoop,
} from "./SyntheticFabLayoutPlan";
import {
	createSyntheticFabTopologySpec,
	LARGE_FAB_60_TOPOLOGY_SPEC,
	SYNTHETIC_FAB_CARDINAL_SIDES,
} from "./SyntheticFabTopologySpec";

const SUPPORTED_FACTORY_PROFILES = [
	[3, 50],
	[3, 60],
	[3, 100],
	[4, 50],
	[4, 60],
	[4, 100],
	[5, 50],
	[5, 60],
	[5, 100],
	[6, 50],
	[6, 60],
	[6, 100],
] as const;

type LayoutRectangle = Pick<SyntheticFabLayoutLoop, "origin" | "lengthMeters" | "depthMeters">;

function expectStrictlyContains(outer: LayoutRectangle, inner: LayoutRectangle) {
	expect(inner.origin.x).toBeGreaterThan(outer.origin.x);
	expect(inner.origin.y).toBeGreaterThan(outer.origin.y);
	expect(inner.origin.x + inner.lengthMeters).toBeLessThan(outer.origin.x + outer.lengthMeters);
	expect(inner.origin.y + inner.depthMeters).toBeLessThan(outer.origin.y + outer.depthMeters);
}

function expectGatewayOnStraight(gateway: SyntheticFabLayoutGateway, loop: SyntheticFabLayoutLoop) {
	const horizontal = gateway.sourceSide === "north" || gateway.sourceSide === "south";
	const minimum = horizontal ? loop.origin.x : loop.origin.y;
	const maximum = minimum + (horizontal ? loop.lengthMeters : loop.depthMeters);
	expect(gateway.center).toBeGreaterThan(minimum);
	expect(gateway.center).toBeLessThan(maximum);
}

describe("SyntheticFabLayoutPlan", () => {
	it.each([
		20, 22, 24,
	])("derives V4 outer, shared-wall, spine, Wing, bank, and block hierarchy at %i m Bay pitch", (bayPitchMeters) => {
		const plan = deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, bayPitchMeters);

		expect(plan.version).toBe(4);
		expect(plan.topologyVersion).toBe(7);
		expect(plan.wallCircuit.role).toBe("wall-circuit");
		expect(plan.wallCircuit.id).toBe(LARGE_FAB_60_TOPOLOGY_SPEC.wallCircuit.id);
		expect(plan.wings).toHaveLength(12);
		expect(plan.rows).toHaveLength(6);
		expect(plan.banks).toHaveLength(6);
		expect(plan.blocks).toHaveLength(3);
		expect(plan.spineWallGateways).toHaveLength(2);
		expect(plan.wallOuterGateways).toHaveLength(4);
		expect(plan.spine.origin.x).toBe(0);

		expectStrictlyContains(plan.outer, plan.wallCircuit);
		expectStrictlyContains(plan.wallCircuit, plan.spine);
		for (const wing of plan.wings) expectStrictlyContains(plan.wallCircuit, wing);

		for (const row of plan.rows) {
			expect(row.leftWing.profile.column).toBe(0);
			expect(row.rightWing.profile.column).toBe(1);
			expect(row.leftWing.origin.y).toBe(row.rightWing.origin.y);
			expect(row.leftWing.lengthMeters).toBe(row.rightWing.lengthMeters);
			expect(row.leftLinkCenterY).toBe(row.rightLinkCenterY);
			expect(row.corridor.westOuterX).toBeLessThan(row.corridor.westWallX);
			expect(row.corridor.westWallX).toBeLessThan(row.corridor.westWingOuterX);
			expect(row.corridor.westWingOuterX).toBeLessThan(row.corridor.westWingInnerX);
			expect(row.corridor.westWingInnerX).toBeLessThan(row.corridor.spineWestX);
			expect(row.corridor.spineWestX).toBeLessThan(row.corridor.spineEastX);
			expect(row.corridor.spineEastX).toBeLessThan(row.corridor.eastWingInnerX);
			expect(row.corridor.eastWingInnerX).toBeLessThan(row.corridor.eastWingOuterX);
			expect(row.corridor.eastWingOuterX).toBeLessThan(row.corridor.eastWallX);
			expect(row.corridor.eastWallX).toBeLessThan(row.corridor.eastOuterX);
		}
	});

	it.each(
		SUPPORTED_FACTORY_PROFILES,
	)("keeps %i blocks and %i Bays inside one outer and one shared wall circuit", (processBlockCount, totalBayCount) => {
		const spec = createSyntheticFabTopologySpec({ processBlockCount, totalBayCount });
		const plan = deriveSyntheticFabLayoutPlan(spec, 20);

		expect(plan.version).toBe(4);
		expect(plan.rows).toHaveLength(processBlockCount * 2);
		expect(plan.wings).toHaveLength(processBlockCount * 4);
		expect(plan.banks).toHaveLength(processBlockCount * 2);
		expect(plan.blocks).toHaveLength(processBlockCount);
		expect(plan.spineWallGateways).toHaveLength(2);
		expect(plan.wallOuterGateways).toHaveLength(4);
		expectStrictlyContains(plan.outer, plan.wallCircuit);
		expectStrictlyContains(plan.wallCircuit, plan.spine);

		const bays = plan.wings.flatMap((wing) => wing.bays);
		expect(bays).toHaveLength(totalBayCount);
		expect(new Set(bays.map((bay) => bay.id)).size).toBe(totalBayCount);
		for (const wing of plan.wings) {
			expectStrictlyContains(plan.wallCircuit, wing);
			expect(wing.bays).toHaveLength(wing.profile.bayCount);
			for (const [index, bay] of wing.bays.entries()) {
				expect(bay.wingId).toBe(wing.id);
				expect(bay.index).toBe(index);
				expect(bay.id).toBe(wing.profile.bays[index]?.id);
				expect(bay.label).toBe(wing.profile.bays[index]?.label);
				expect(Object.keys(bay).sort()).toEqual(["id", "index", "label", "wingId"]);
			}
		}

		for (const gateway of plan.spineWallGateways) {
			expectGatewayOnStraight(gateway, plan.spine);
			expectGatewayOnStraight(gateway, plan.wallCircuit);
		}
		for (const gateway of plan.wallOuterGateways) {
			expectGatewayOnStraight(gateway, plan.wallCircuit);
			expectGatewayOnStraight(gateway, plan.outer);
		}
	});

	it("places north/south spine-wall links and four wall-outer gateways on safe straight segments", () => {
		const spec = LARGE_FAB_60_TOPOLOGY_SPEC;
		const plan = deriveSyntheticFabLayoutPlan(spec, 20);

		expect(plan.spineWallGateways.map((gateway) => gateway.sourceSide)).toEqual(["north", "south"]);
		for (const gateway of plan.spineWallGateways) {
			expect(gateway.kind).toBe("spine-wall");
			expect(gateway.sourceId).toBe(plan.spine.id);
			expect(gateway.targetId).toBe(plan.wallCircuit.id);
			expect(gateway.sourceSide).toBe(gateway.targetSide);
			expectGatewayOnStraight(gateway, plan.spine);
			expectGatewayOnStraight(gateway, plan.wallCircuit);
		}

		expect(new Set(plan.wallOuterGateways.map((gateway) => gateway.sourceSide))).toEqual(
			new Set(SYNTHETIC_FAB_CARDINAL_SIDES),
		);
		const spineWallCenter = plan.spineWallGateways[0]?.center;
		if (spineWallCenter === undefined) throw new Error("Expected spine/wall gateways.");
		for (const gateway of plan.wallOuterGateways) {
			expect(gateway.kind).toBe("wall-outer");
			expect(gateway.sourceId).toBe(plan.wallCircuit.id);
			expect(gateway.targetId).toBe(plan.outer.id);
			expect(gateway.sourceSide).toBe(gateway.targetSide);
			expectGatewayOnStraight(gateway, plan.wallCircuit);
			expectGatewayOnStraight(gateway, plan.outer);
			if (gateway.sourceSide === "north" || gateway.sourceSide === "south") {
				expect(Math.abs(gateway.center - spineWallCenter)).toBeGreaterThanOrEqual(
					spec.spineWidthMeters + spec.rowLinkWindowMeters,
				);
			} else {
				for (const row of plan.rows) {
					expect(
						gateway.center < row.corridor.windowMinY || gateway.center > row.corridor.windowMaxY,
					).toBe(true);
				}
			}
		}
	});

	it("groups six rows into three visibly separated process blocks", () => {
		const plan = deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, 20);
		const rowY = plan.rows.map((row) => row.leftWing.origin.y);

		expect(rowY).toEqual([0, 60, 160, 220, 320, 380]);
		expect(
			plan.blocks.map((block) => [
				block.upperRow.row,
				block.lowerRow.row,
				block.leftBank.column,
				block.rightBank.column,
			]),
		).toEqual([
			[0, 1, 0, 1],
			[2, 3, 0, 1],
			[4, 5, 0, 1],
		]);
		const sideGateways = plan.wallOuterGateways
			.filter((gateway) => gateway.sourceSide === "west" || gateway.sourceSide === "east")
			.map((gateway) => [gateway.sourceSide, gateway.center]);
		expect(sideGateways).toEqual([
			["east", 270],
			["west", 110],
		]);
	});

	it("derives each side gateway from its matching bank when Wing depths are asymmetric", () => {
		const asymmetric = Object.freeze({
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			processBlockPitchMeters: 160,
			wings: Object.freeze(
				LARGE_FAB_60_TOPOLOGY_SPEC.wings.map((wing) =>
					wing.id === "METAL-BACK"
						? Object.freeze({ ...wing, laneSpacingMeters: 20 })
						: wing.id === "WET-CLEAN"
							? Object.freeze({ ...wing, laneSpacingMeters: 12 })
							: wing,
				),
			),
		});
		const plan = deriveSyntheticFabLayoutPlan(asymmetric, 20);

		expect(
			plan.wallOuterGateways
				.filter((gateway) => gateway.sourceSide === "west" || gateway.sourceSide === "east")
				.map((gateway) => [gateway.sourceSide, gateway.center]),
		).toEqual([
			["east", 274],
			["west", 110],
		]);
	});

	it("scales shared wall and outer width with Bay pitch without changing vertical hierarchy", () => {
		const compact = deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, 20);
		const expanded = deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, 24);

		expect(expanded.wallCircuit.lengthMeters).toBeGreaterThan(compact.wallCircuit.lengthMeters);
		expect(expanded.outer.lengthMeters).toBeGreaterThan(compact.outer.lengthMeters);
		expect(expanded.wallCircuit.depthMeters).toBe(compact.wallCircuit.depthMeters);
		expect(expanded.outer.depthMeters).toBe(compact.outer.depthMeters);
		expect(expanded.spine).toEqual(compact.spine);
		expect(expanded.rows.map((row) => row.id)).toEqual(compact.rows.map((row) => row.id));
	});

	it("derives the same immutable V3 plan for the same inputs", () => {
		const first = deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, 20);
		const second = deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, 20);

		expect(second).toEqual(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.wallCircuit)).toBe(true);
		expect(Object.isFrozen(first.wallOuterGateways)).toBe(true);
	});

	it("rejects unsupported or fractional Bay pitch before deriving geometry", () => {
		for (const pitch of [11, 20.5, 31]) {
			expect(() => deriveSyntheticFabLayoutPlan(LARGE_FAB_60_TOPOLOGY_SPEC, pitch)).toThrow(
				/12-30 m integer/,
			);
		}
	});
});
