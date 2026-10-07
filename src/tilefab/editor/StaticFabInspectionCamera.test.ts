import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
	bounds3DFromArray,
	fitStaticFabInspectionCamera,
	staticFabInspectionCameraClipping,
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

	it.each(
		[1440 / 756, 390 / 772].flatMap((aspect) =>
			(["isometric", "top"] as const).flatMap((preset) =>
				[
					{ x: 0, z: 0 },
					{ x: 12, z: -2 },
					{ x: 35, z: -50 },
				].map((focus) => ({
					aspect,
					preset,
					focus,
				})),
			),
		),
	)("keeps every scene corner in view around an off-center focus: %j", ({
		aspect,
		preset,
		focus,
	}) => {
		const bounds = { minX: 2, minY: 0, minZ: -2, maxX: 13, maxY: 3.6, maxZ: -1 };
		const pose = fitStaticFabInspectionCamera(bounds, aspect, 38, preset, focus);
		const camera = new PerspectiveCamera(38, aspect, pose.near, pose.far);
		camera.position.set(pose.positionX, pose.positionY, pose.positionZ);
		camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
		camera.updateMatrixWorld();
		expect(pose.targetX).toBe(focus.x);
		expect(pose.targetZ).toBe(focus.z);
		for (const x of [bounds.minX, bounds.maxX]) {
			for (const y of [bounds.minY, bounds.maxY]) {
				for (const z of [bounds.minZ, bounds.maxZ]) {
					const projected = new Vector3(x, y, z).project(camera);
					expect(Math.abs(projected.x)).toBeLessThan(1);
					expect(Math.abs(projected.y)).toBeLessThan(1);
					expect(projected.z).toBeGreaterThan(-1);
					expect(projected.z).toBeLessThan(1);
				}
			}
		}
	});

	it.each(
		[1440 / 756, 390 / 772].flatMap((aspect) =>
			[
				{ x: 0, z: 0 },
				{ x: 7.5, z: -1.5 },
			].flatMap((focus) =>
				(["minimum", "middle", "initial", "maximum"] as const).map((zoom) => ({
					aspect,
					focus,
					zoom,
				})),
			),
		),
	)("keeps in-frame geometry between clip planes through orbit zoom: %j", ({
		aspect,
		focus,
		zoom,
	}) => {
		const bounds = { minX: 2, minY: 0, minZ: -2, maxX: 13, maxY: 3.6, maxZ: -1 };
		const pose = fitStaticFabInspectionCamera(bounds, aspect, 38, "isometric", focus);
		const target = new Vector3(pose.targetX, pose.targetY, pose.targetZ);
		const distance =
			zoom === "minimum"
				? pose.minimumDistance
				: zoom === "middle"
					? 18
					: zoom === "maximum"
						? pose.maximumDistance
						: pose.distance;
		const direction = new Vector3(pose.positionX, pose.positionY, pose.positionZ)
			.sub(target)
			.normalize();
		const clip = staticFabInspectionCameraClipping(bounds, target, distance);
		const camera = new PerspectiveCamera(38, aspect, clip.near, clip.far);
		camera.position.copy(target).addScaledVector(direction, distance);
		camera.lookAt(target);
		camera.updateMatrixWorld();
		const projectedTarget = target.clone().project(camera);
		expect(projectedTarget.z).toBeGreaterThan(-1);
		expect(projectedTarget.z).toBeLessThan(1);
		let visibleSamples = 0;
		for (let x = 0; x <= 8; x++) {
			for (let y = 0; y <= 8; y++) {
				for (let z = 0; z <= 8; z++) {
					const point = new Vector3(2 + (11 * x) / 8, (3.6 * y) / 8, -2 + z / 8);
					const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
					const projected = point.project(camera);
					if (depth <= 0.02 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue;
					visibleSamples++;
					expect(projected.z).toBeGreaterThan(-1);
					expect(projected.z).toBeLessThan(1);
				}
			}
		}
		if (zoom !== "minimum" || focus.x === 7.5) expect(visibleSamples).toBeGreaterThan(0);
	});

	it("rejects malformed camera inputs", () => {
		expect(() => bounds3DFromArray([0, 0, 0, 1, 1])).toThrow("six values");
		expect(() => bounds3DFromArray([2, 0, 0, 1, 1, 1])).toThrow("inverted");
		expect(() =>
			fitStaticFabInspectionCamera({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }, 0, 40),
		).toThrow("aspect");
		expect(() =>
			staticFabInspectionCameraClipping(
				{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
				{ x: 0, y: 0, z: 0 },
				0,
			),
		).toThrow("positive distance");
	});

	it("keeps rail picking usable in screen space without swallowing adjacent lanes", () => {
		expect(staticFabInspectionRailPickThreshold(8, 38, 900)).toBe(0.25);
		expect(staticFabInspectionRailPickThreshold(100, 38, 900)).toBeGreaterThan(0.25);
		expect(staticFabInspectionRailPickThreshold(10_000, 38, 390)).toBe(2.5);
		expect(() => staticFabInspectionRailPickThreshold(0, 38, 900)).toThrow("distance");
	});
});
