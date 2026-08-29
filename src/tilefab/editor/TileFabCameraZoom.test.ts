import { describe, expect, it } from "vitest";
import type { Camera } from "../render/TileRenderer";
import { applyTileFabCameraZoom } from "./TileFabCameraZoom";

describe("TileFabCameraZoom", () => {
	it("keeps the anchored world point fixed and clamps the shared zoom range", () => {
		const camera: Camera = { offsetX: 120, offsetY: 80, zoom: 20, rotation: 0 };
		const anchor = { x: 320, y: 230 };
		const worldBefore = {
			x: (anchor.x - camera.offsetX) / camera.zoom,
			y: (anchor.y - camera.offsetY) / camera.zoom,
		};

		expect(applyTileFabCameraZoom(camera, 1.25, anchor, { minimum: 1, maximum: 96 })).toBe(true);
		expect(camera.zoom).toBe(25);
		expect((anchor.x - camera.offsetX) / camera.zoom).toBeCloseTo(worldBefore.x);
		expect((anchor.y - camera.offsetY) / camera.zoom).toBeCloseTo(worldBefore.y);
		expect(applyTileFabCameraZoom(camera, 100, anchor, { minimum: 1, maximum: 96 })).toBe(true);
		expect(camera.zoom).toBe(96);
		expect(applyTileFabCameraZoom(camera, 2, anchor, { minimum: 1, maximum: 96 })).toBe(false);
	});

	it("rejects malformed input without changing the camera", () => {
		const camera: Camera = { offsetX: 10, offsetY: 20, zoom: 38, rotation: 0 };
		const before = { ...camera };

		expect(
			applyTileFabCameraZoom(camera, Number.NaN, { x: 20, y: 20 }, { minimum: 1, maximum: 96 }),
		).toBe(false);
		expect(camera).toEqual(before);
	});
});
