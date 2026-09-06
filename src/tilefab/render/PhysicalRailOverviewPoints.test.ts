import { describe, expect, it } from "vitest";
import {
	nextPhysicalRailOverviewPoint,
	OVERVIEW_RAIL_POINT_TOLERANCE_PIXELS,
	overviewRailPointDistanceSquared,
} from "./PhysicalRailOverviewPoints";

function emittedIndices(
	positions: Float32Array,
	start: number,
	end: number,
	zoom: number,
): number[] {
	const result: number[] = [];
	const distance = overviewRailPointDistanceSquared(zoom);
	for (
		let index = start;
		index < end;
		index = nextPhysicalRailOverviewPoint(positions, index, end, distance)
	) {
		result.push(index);
	}
	return result;
}

describe("physical rail overview points", () => {
	it("retains detail points and does not decimate invalid camera scales", () => {
		const positions = new Float32Array([0, 0, 0.01, 0, 0.02, 0, 1, 0]);
		for (const zoom of [6, 40, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(emittedIndices(positions, 0, 4, zoom)).toEqual([0, 1, 2, 3]);
		}
	});

	it("preserves each path's endpoints and never joins neighboring paths", () => {
		const positions = new Float32Array([99, 99, 0, 0, 0.05, 0, 0.1, 0, 50, 50]);
		expect(emittedIndices(positions, 1, 4, 1)).toEqual([1, 3]);
		expect(emittedIndices(positions, 0, 1, 1)).toEqual([0]);
		expect(emittedIndices(positions, 1, 3, 1)).toEqual([1, 2]);
		expect(emittedIndices(positions, 2, 2, 1)).toEqual([]);
	});

	it("retains excursions and reversals even when later points return to the origin", () => {
		const positions = new Float32Array([0, 0, 0.05, 0, 1, 0, 0.95, 0, 0, 0]);
		expect(emittedIndices(positions, 0, 5, 1)).toEqual([0, 2, 4]);
	});

	it.each([
		0.25, 0.667, 1.5, 5.99,
	])("bounds every omitted point in screen space at zoom %s without changing source bytes", (zoom) => {
		const positions = new Float32Array(2049 * 2);
		for (let index = 0; index < 2049; index++) {
			const angle = (index / 2048) * Math.PI * 2;
			positions[index * 2] = 1000 + Math.cos(angle) * 4;
			positions[index * 2 + 1] = -1000 + Math.sin(angle) * 4;
		}
		const original = positions.slice();
		const indices = emittedIndices(positions, 0, 2049, zoom);
		expect(indices[0]).toBe(0);
		expect(indices.at(-1)).toBe(2048);
		expect(indices.length).toBeLessThan(1024);
		for (let row = 1; row < indices.length; row++) {
			const from = indices[row - 1] as number;
			const to = indices[row] as number;
			for (let index = from + 1; index < to; index++) {
				const dx = (positions[index * 2] as number) - (positions[from * 2] as number);
				const dy = (positions[index * 2 + 1] as number) - (positions[from * 2 + 1] as number);
				expect(Math.hypot(dx, dy) * zoom).toBeLessThan(OVERVIEW_RAIL_POINT_TOLERANCE_PIXELS);
			}
		}
		expect(positions).toEqual(original);
	});
});
