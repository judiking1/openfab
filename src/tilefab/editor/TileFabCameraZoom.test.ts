import { describe, expect, it } from "vitest";
import {
	OPENFAB_PROJECT_VIEW_MAX_ZOOM_PIXELS_PER_METER,
	OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER,
} from "../project/OpenFabProject";
import type { Camera } from "../render/TileRenderer";
import { applyTileFabCameraZoom, fitTileFabCameraZoom } from "./TileFabCameraZoom";

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

	it("preserves manual zoom direction below the interactive minimum", () => {
		const camera: Camera = { offsetX: 24, offsetY: 36, zoom: 0.25, rotation: 0 };
		const anchor = { x: 100, y: 80 };

		expect(applyTileFabCameraZoom(camera, 0.8, anchor, { minimum: 1, maximum: 96 })).toBe(false);
		expect(camera).toEqual({ offsetX: 24, offsetY: 36, zoom: 0.25, rotation: 0 });

		expect(applyTileFabCameraZoom(camera, 1.25, anchor, { minimum: 1, maximum: 96 })).toBe(true);
		expect(camera.zoom).toBeCloseTo(0.3125);
		expect((anchor.x - camera.offsetX) / camera.zoom).toBeCloseTo((100 - 24) / 0.25);
		expect((anchor.y - camera.offsetY) / camera.zoom).toBeCloseTo((80 - 36) / 0.25);
	});
});

describe("fitTileFabCameraZoom", () => {
	it("uses the same saved-view range for zooming in and out of a fitted overview", () => {
		const bounds = {
			minimum: OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER,
			maximum: OPENFAB_PROJECT_VIEW_MAX_ZOOM_PIXELS_PER_METER,
		};
		const camera: Camera = { offsetX: 20, offsetY: 30, zoom: 0.023, rotation: 0 };
		const anchor = { x: 180, y: 100 };
		const worldX = (anchor.x - camera.offsetX) / camera.zoom;
		expect(applyTileFabCameraZoom(camera, 1 / 1.12, anchor, bounds)).toBe(true);
		expect(camera.zoom).toBeLessThan(0.023);
		expect((anchor.x - camera.offsetX) / camera.zoom).toBeCloseTo(worldX);
		expect(applyTileFabCameraZoom(camera, 1.12, anchor, bounds)).toBe(true);
		expect(camera.zoom).toBeCloseTo(0.023);
		camera.zoom = bounds.maximum;
		expect(applyTileFabCameraZoom(camera, 1.12, anchor, bounds)).toBe(false);
		expect(camera.zoom).toBe(bounds.maximum);
	});

	it.each([
		0, 1, 2, 3,
	] as const)("fits the complete int32 extent in a compact frame at rotation %s", (rotation) => {
		const bounds = { minX: -(2 ** 31), minY: -32, maxX: 2 ** 31 - 1, maxY: 4291 };
		const frame = { width: 48, height: 80 };
		const zoom = fitTileFabCameraZoom(bounds, frame, rotation, 2, 1, {
			minimum: OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER,
			maximum: 96,
		});
		const spanX = bounds.maxX - bounds.minX + 5;
		const spanY = bounds.maxY - bounds.minY + 5;
		expect((rotation % 2 === 0 ? spanX : spanY) * zoom).toBeLessThanOrEqual(frame.width - 24);
		expect((rotation % 2 === 0 ? spanY : spanX) * zoom).toBeLessThanOrEqual(frame.height - 24);
		expect(zoom).toBeGreaterThanOrEqual(OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER);
	});

	it("frames the real 8594m project at desktop and compact usable sizes", () => {
		for (const frame of [
			{ width: 1200, height: 780 },
			{ width: 280, height: 80 },
		]) {
			const zoom = fitTileFabCameraZoom(
				{ minX: 0, minY: -32, maxX: 8594, maxY: 4291 },
				frame,
				0,
				2,
				1,
				{ minimum: OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER, maximum: 96 },
			);
			expect(zoom).toBeLessThan(0.25);
			expect(8599 * zoom).toBeLessThanOrEqual(frame.width - 24);
			expect(4328 * zoom).toBeLessThanOrEqual(frame.height - 24);
			const camera: Camera = { offsetX: 76, offsetY: 60, rotation: 0, zoom };
			const anchor = { x: 210, y: 150 };
			const worldX = (anchor.x - camera.offsetX) / zoom;
			expect(applyTileFabCameraZoom(camera, 1.12, anchor, { minimum: 1, maximum: 96 })).toBe(true);
			expect(camera.zoom).toBeCloseTo(zoom * 1.12);
			expect((anchor.x - camera.offsetX) / camera.zoom).toBeCloseTo(worldX);
		}
	});
});
