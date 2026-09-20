import { describe, expect, it } from "vitest";
import { stkDraftFrameTranslation, stkDraftSelectionFit } from "./StkDraftFraming";

describe("stkDraftFrameTranslation", () => {
	const frame = { left: 72, top: 64, width: 308, height: 128 };
	it("brings all six selected ports into the compact canvas without centering or zooming", () => {
		const points = Array.from({ length: 6 }, (_, i) => ({ x: 234 + i * 38, y: 132 }));
		expect(stkDraftFrameTranslation(points, { x: 234, y: 132 }, frame)).toEqual({ x: -72, y: 0 });
	});
	it("keeps an already visible selection stationary", () => {
		expect(stkDraftFrameTranslation([{ x: 200, y: 132 }], { x: 200, y: 132 }, frame)).toEqual({
			x: 0,
			y: 0,
		});
	});
	it("reserves the cursor caption and handles vertical selections", () => {
		expect(
			stkDraftFrameTranslation(
				[
					{ x: 200, y: 60 },
					{ x: 200, y: 98 },
				],
				{ x: 200, y: 60 },
				frame,
			),
		).toEqual({ x: 0, y: 56 });
	});
	it("defers oversized sparse drafts to cursor following instead of changing scale", () => {
		expect(
			stkDraftFrameTranslation(
				[
					{ x: 200, y: 132 },
					{ x: 1200, y: 132 },
				],
				{ x: 200, y: 132 },
				frame,
			),
		).toBeNull();
		expect(
			stkDraftFrameTranslation(
				[
					{ x: 200, y: 132 },
					{ x: 200, y: 400 },
				],
				{ x: 200, y: 132 },
				frame,
			),
		).toBeNull();
		expect(stkDraftFrameTranslation([], { x: 200, y: 132 }, frame)).toBeNull();
	});
});

describe("stkDraftSelectionFit", () => {
	const frame = { left: 72, top: 64, width: 308, height: 196 };
	const zoomBounds = { minimum: 2 ** -30, maximum: 38 };
	it("fits the complete B2B selection with its current caption above a compact dock", () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 4 },
			{ x: 1, y: 4 },
		];
		const camera = stkDraftSelectionFit(points, 0, frame, zoomBounds);
		expect(camera).not.toBeNull();
		expect(camera?.zoom).toBe(29);
		expectContained(points, 0, frame, camera);
	});
	it("fits all four rotations and sparse16-port selections without inventing draft state", () => {
		const source = Array.from({ length: 16 }, (_, i) => ({
			x: -100000 + i * 1000,
			y: i % 2 === 0 ? 100000 : 100004,
		}));
		for (const rotation of [0, 1, 2, 3]) {
			const points = source.map(({ x, y }) =>
				rotation === 0
					? { x, y }
					: rotation === 1
						? { x: -y, y: x }
						: rotation === 2
							? { x: -x, y: -y }
							: { x: y, y: -x },
			);
			const before = structuredClone(points);
			const camera = stkDraftSelectionFit(points, 15, frame, zoomBounds);
			expect(camera).not.toBeNull();
			expectContained(points, 15, frame, camera);
			expect(points).toEqual(before);
		}
	});
	it("retains detail zoom for a single selected Port and ignores an unselected cursor", () => {
		const points = [{ x: 25, y: -30 }];
		const camera = stkDraftSelectionFit(points, -1, frame, zoomBounds);
		expect(camera?.zoom).toBe(38);
		expectContained(points, -1, frame, camera);
	});
	it("uses the clear space beside the toolbar when it preserves a readable B2B scale", () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 4 },
			{ x: 1, y: 4 },
		];
		const toolbar = { left: 220, top: 64, width: 160, height: 64 };
		const camera = stkDraftSelectionFit(points, 0, frame, zoomBounds, toolbar);
		expect(camera?.zoom).toBe(29);
		expectContained(points, 0, { ...frame, width: 148 }, camera);
		expect(stkDraftSelectionFit(points, 0, frame, zoomBounds, frame)).toBeNull();
	});
	it("rejects impossible marker space and invalid inputs instead of hiding selected Ports", () => {
		expect(stkDraftSelectionFit([], 0, frame, zoomBounds)).toBeNull();
		expect(
			stkDraftSelectionFit([{ x: 0, y: 0 }], 0, { ...frame, width: 100 }, zoomBounds),
		).toBeNull();
		expect(
			stkDraftSelectionFit([{ x: 0, y: 0 }], 0, { ...frame, height: 79 }, zoomBounds),
		).toBeNull();
		expect(stkDraftSelectionFit([{ x: NaN, y: 0 }], 0, frame, zoomBounds)).toBeNull();
		expect(
			stkDraftSelectionFit(
				[
					{ x: 0, y: 0 },
					{ x: 100000, y: 0 },
				],
				0,
				frame,
				{ minimum: 1, maximum: 38 },
			),
		).toBeNull();
		expect(
			stkDraftSelectionFit(
				Array.from({ length: 17 }, (_, x) => ({ x, y: 0 })),
				0,
				frame,
				zoomBounds,
			),
		).toBeNull();
	});
});

function expectContained(
	points: readonly { x: number; y: number }[],
	current: number,
	frame: { left: number; top: number; width: number; height: number },
	camera: ReturnType<typeof stkDraftSelectionFit>,
) {
	if (!camera) throw new Error("Expected a fitted selection");
	points.forEach(({ x, y }, index) => {
		const screenX = x * camera.zoom + camera.offsetX,
			screenY = y * camera.zoom + camera.offsetY;
		expect(screenX - (index === current ? 64 : 28)).toBeGreaterThanOrEqual(frame.left - 1e-8);
		expect(screenX + (index === current ? 64 : 28)).toBeLessThanOrEqual(
			frame.left + frame.width + 1e-8,
		);
		expect(screenY - (index === current ? 52 : 28)).toBeGreaterThanOrEqual(frame.top - 1e-8);
		expect(screenY + 28).toBeLessThanOrEqual(frame.top + frame.height + 1e-8);
	});
}
