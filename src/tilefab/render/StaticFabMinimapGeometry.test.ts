import { describe, expect, it } from "vitest";
import {
	createStaticFabMinimapTransform,
	staticFabMinimapPointAtWorld,
	staticFabMinimapRectForWorldBounds,
	staticFabMinimapWorldAtPoint,
} from "./StaticFabMinimapGeometry";

describe("StaticFabMinimapGeometry", () => {
	it("fits a wide FAB without stretching its world aspect ratio", () => {
		const transform = createStaticFabMinimapTransform(
			{ minX: -20, minY: 10, maxX: 180, maxY: 110 },
			300,
			200,
			10,
		);

		expect(transform.scale).toBe(1.4);
		expect(transform.content).toEqual({ x: 10, y: 30, width: 280, height: 140 });
		expect(staticFabMinimapPointAtWorld(transform, { x: -20, y: 10 })).toEqual({
			x: 10,
			y: 30,
		});
		expect(staticFabMinimapPointAtWorld(transform, { x: 180, y: 110 })).toEqual({
			x: 290,
			y: 170,
		});
	});

	it("round-trips negative world coordinates and clamps pointer input", () => {
		const transform = createStaticFabMinimapTransform(
			{ minX: -100, minY: -50, maxX: 100, maxY: 50 },
			220,
			120,
			10,
		);
		const point = staticFabMinimapPointAtWorld(transform, { x: -37.5, y: 12.25 });

		expect(staticFabMinimapWorldAtPoint(transform, point)).toEqual({ x: -37.5, y: 12.25 });
		expect(staticFabMinimapWorldAtPoint(transform, { x: -100, y: 500 })).toEqual({
			x: -100,
			y: 50,
		});
	});

	it("clips viewport bounds to the map footprint", () => {
		const transform = createStaticFabMinimapTransform(
			{ minX: 0, minY: 0, maxX: 100, maxY: 50 },
			220,
			120,
			10,
		);

		expect(
			staticFabMinimapRectForWorldBounds(transform, {
				minX: -20,
				minY: 10,
				maxX: 25,
				maxY: 70,
			}),
		).toEqual({ x: 10, y: 30, width: 50, height: 80 });
	});

	it("returns an empty boundary rect when viewport and map do not overlap", () => {
		const transform = createStaticFabMinimapTransform(
			{ minX: 0, minY: 0, maxX: 100, maxY: 50 },
			220,
			120,
			10,
		);

		expect(
			staticFabMinimapRectForWorldBounds(transform, {
				minX: 140,
				minY: 70,
				maxX: 180,
				maxY: 90,
			}),
		).toEqual({ x: 210, y: 110, width: 0, height: 0 });
		expect(
			staticFabMinimapRectForWorldBounds(transform, {
				minX: -80,
				minY: 10,
				maxX: -20,
				maxY: 20,
			}),
		).toEqual({ x: 10, y: 40, width: 0, height: 0 });
	});

	it("rejects empty or non-finite geometry", () => {
		expect(() =>
			createStaticFabMinimapTransform({ minX: 0, minY: 0, maxX: 0, maxY: 1 }, 100, 100),
		).toThrow(/non-empty/);
		expect(() =>
			createStaticFabMinimapTransform({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0, 100),
		).toThrow(/positive/);
	});
});
