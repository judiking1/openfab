import { describe, expect, it } from "vitest";
import { deriveRailConstructionMetric } from "./RailConstructionMetric";

describe("RailConstructionMetric", () => {
	it("derives signed axes and the inclusive grid footprint", () => {
		expect(
			deriveRailConstructionMetric({
				cells: [
					{ x: 3, y: -2 },
					{ x: 4, y: -2 },
					{ x: 5, y: -2 },
					{ x: 5, y: -3 },
					{ x: 5, y: -4 },
				],
				lengthMeters: 4,
				turns: 1,
			}),
		).toMatchObject({
			start: { x: 3, y: -2 },
			end: { x: 5, y: -4 },
			deltaXMeters: 2,
			deltaZMeters: -2,
			footprintWidthMeters: 3,
			footprintDepthMeters: 3,
			primaryLabel: "4 m · 1 CURVE",
			geometryLabel: "ΔX +2 · ΔZ -2 · 3×3 m",
		});
	});

	it("returns null for an empty draft", () => {
		expect(deriveRailConstructionMetric({ cells: [], lengthMeters: 0, turns: 0 })).toBeNull();
	});
});
