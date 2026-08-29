import { describe, expect, it } from "vitest";
import { initialRailTemplatePose } from "./RailTemplateCatalog";
import {
	AUTO_RAIL_TEMPLATE_POSE_LOCK,
	isRailTemplatePoseAuto,
	isRailTemplatePoseFullyLocked,
	LOCKED_RAIL_TEMPLATE_POSE,
	lockRailTemplatePoseAxis,
	rankedRailTemplatePoses,
} from "./RailTemplatePoseSearch";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";

describe("RailTemplatePoseSearch", () => {
	it("preserves deterministic cardinal, side, and flow preference order", () => {
		const candidates = rankedRailTemplatePoses(initialRailTemplatePose());
		expect(candidates).toHaveLength(16);
		expect(candidates.slice(0, 4).map(({ pose }) => pose)).toEqual([
			{ forward: DIR_E, side: "right", flow: "forward" },
			{ forward: DIR_E, side: "left", flow: "forward" },
			{ forward: DIR_E, side: "right", flow: "reverse" },
			{ forward: DIR_E, side: "left", flow: "reverse" },
		]);
		expect(candidates.map(({ pose }) => pose.forward)).toEqual([
			DIR_E,
			DIR_E,
			DIR_E,
			DIR_E,
			DIR_S,
			DIR_S,
			DIR_S,
			DIR_S,
			DIR_N,
			DIR_N,
			DIR_N,
			DIR_N,
			DIR_W,
			DIR_W,
			DIR_W,
			DIR_W,
		]);
		expect(candidates.map(({ order }) => order)).toEqual(
			Array.from({ length: 16 }, (_, index) => index),
		);
	});

	it("prunes only the explicitly locked axes", () => {
		const preferred = initialRailTemplatePose();
		expect(rankedRailTemplatePoses(preferred, lockRailTemplatePoseAxis(AUTO_RAIL_TEMPLATE_POSE_LOCK, "forward"))).toHaveLength(4);
		expect(rankedRailTemplatePoses(preferred, lockRailTemplatePoseAxis(AUTO_RAIL_TEMPLATE_POSE_LOCK, "side"))).toHaveLength(8);
		expect(rankedRailTemplatePoses(preferred, lockRailTemplatePoseAxis(AUTO_RAIL_TEMPLATE_POSE_LOCK, "flow"))).toHaveLength(8);
		expect(rankedRailTemplatePoses(preferred, LOCKED_RAIL_TEMPLATE_POSE)).toEqual([
			{
				pose: preferred,
				tier: 0,
				mutationCount: 0,
				order: 0,
			},
		]);
	});

	it("reports AUTO and fully locked states without mutating shared constants", () => {
		const sideLocked = lockRailTemplatePoseAxis(AUTO_RAIL_TEMPLATE_POSE_LOCK, "side");
		expect(isRailTemplatePoseAuto(AUTO_RAIL_TEMPLATE_POSE_LOCK)).toBe(true);
		expect(isRailTemplatePoseAuto(sideLocked)).toBe(false);
		expect(isRailTemplatePoseFullyLocked(sideLocked)).toBe(false);
		expect(isRailTemplatePoseFullyLocked(LOCKED_RAIL_TEMPLATE_POSE)).toBe(true);
		expect(AUTO_RAIL_TEMPLATE_POSE_LOCK).toEqual({ forward: false, side: false, flow: false });
		expect(Object.isFrozen(sideLocked)).toBe(true);
	});
});
