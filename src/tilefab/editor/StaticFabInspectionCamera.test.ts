import { describe, expect, it } from "vitest";
import {
	bounds3DFromArray,
	fitStaticFabInspectionCamera,
	staticFabInspectionRailPickThreshold,
} from "./StaticFabInspectionCamera";

describe("StaticFabInspectionCamera", () => {
	it("fits a deterministic isometric pose around finite scene bounds", () => {
		const pose = fitStaticFabInspectionCamera(
			{ minX: -20, minY: 0, minZ: -10, maxX: 20, maxY: 5, maxZ: 10 },
			16 / 9,
			38,
		);
		expect(pose.targetX).toBe(0);
		expect(pose.targetZ).toBe(0);
		expect(pose.positionY).toBeGreaterThan(pose.targetY);
		expect(pose.distance).toBeGreaterThan(20);
		expect(pose.near).toBeGreaterThan(0);
		expect(pose.far).toBeGreaterThan(pose.distance);
	});

	it("preserves an explicit X/Z focus and uses a steeper top preset", () => {
		const bounds = { minX: 0, minY: 0, minZ: 0, maxX: 100, maxY: 4, maxZ: 50 };
		const iso = fitStaticFabInspectionCamera(bounds, 1, 40, "isometric", { x: 8, z: 12 });
		const top = fitStaticFabInspectionCamera(bounds, 1, 40, "top", { x: 8, z: 12 });
		expect(top.targetX).toBe(8);
		expect(top.targetZ).toBe(12);
		expect(top.positionX).toBeCloseTo(top.targetX);
		expect(top.positionZ).toBeLessThan(top.targetZ);
		expect(top.positionY - top.targetY).toBeGreaterThan(iso.positionY - iso.targetY);
	});

	it("rejects malformed camera inputs", () => {
		expect(() => bounds3DFromArray([0, 0, 0, 1, 1])).toThrow("six values");
		expect(() => bounds3DFromArray([2, 0, 0, 1, 1, 1])).toThrow("inverted");
		expect(() =>
			fitStaticFabInspectionCamera({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }, 0, 40),
		).toThrow("aspect");
	});

	it("keeps rail picking usable in screen space without swallowing adjacent lanes", () => {
		expect(staticFabInspectionRailPickThreshold(8, 38, 900)).toBe(0.25);
		expect(staticFabInspectionRailPickThreshold(100, 38, 900)).toBeGreaterThan(0.25);
		expect(staticFabInspectionRailPickThreshold(10_000, 38, 390)).toBe(2.5);
		expect(() => staticFabInspectionRailPickThreshold(0, 38, 900)).toThrow("distance");
	});
});
