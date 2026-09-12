import { describe, expect, it } from "vitest";
import { stkDraftFrameTranslation } from "./StkDraftFraming";

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
