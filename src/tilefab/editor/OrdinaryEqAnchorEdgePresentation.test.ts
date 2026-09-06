import { describe, expect, it } from "vitest";
import { ordinaryEqAnchorEdgePresentation } from "./OrdinaryEqAnchorEdgePresentation";

const FRAME = Object.freeze({ left: 180, top: 46, width: 210, height: 578 });

describe("ordinaryEqAnchorEdgePresentation", () => {
	it("keeps the smaller surface while the real anchor and label are safe", () => {
		expect(
			ordinaryEqAnchorEdgePresentation({
				anchor: { x: 290, y: 320 },
				activeEnd: { x: 330, y: 320 },
				frame: FRAME,
				distanceMeters: 40,
			}),
		).toBeNull();
	});

	it("docks a left-pointing distance locator inside the safe frame", () => {
		const presentation = ordinaryEqAnchorEdgePresentation({
			anchor: { x: -120, y: 260 },
			activeEnd: { x: 340, y: 420 },
			frame: FRAME,
			distanceMeters: 66.2,
		});
		expect(presentation).toEqual({
			x: 250,
			y: 260,
			direction: "left",
			label: "← 1 시작 · 66 m",
		});
	});

	it("moves a horizontal edge locator away from the active endpoint", () => {
		const presentation = ordinaryEqAnchorEdgePresentation({
			anchor: { x: -120, y: 300 },
			activeEnd: { x: 290, y: 300 },
			frame: FRAME,
			distanceMeters: 90,
		});
		expect(presentation?.direction).toBe("left");
		expect(Math.abs((presentation?.y ?? 0) - 300)).toBeGreaterThanOrEqual(72);
	});

	it.each([
		"top",
		"bottom",
	])("clears the wide locator from the active endpoint at the %s edge", (edge) => {
		const activeEnd = { x: 380, y: edge === "top" ? 95 : 410 };
		const presentation = ordinaryEqAnchorEdgePresentation({
			anchor: { x: 380, y: edge === "top" ? -100 : 900 },
			activeEnd,
			frame: { left: 72, top: 46, width: 596, height: 410 },
			distanceMeters: 4,
		});
		expect(presentation?.direction).toBe(edge);
		// 140px locator + 44px target require more than the old shared 84px shift.
		expect(Math.abs((presentation?.x ?? 0) - activeEnd.x)).toBeGreaterThanOrEqual(104);
		expect((presentation?.x ?? 0) - 70).toBeGreaterThanOrEqual(72);
		expect((presentation?.x ?? 0) + 70).toBeLessThanOrEqual(668);
	});

	it("retains diagonal direction and clamps into a compact frame", () => {
		const presentation = ordinaryEqAnchorEdgePresentation({
			anchor: { x: 800, y: -100 },
			activeEnd: { x: 200, y: 400 },
			frame: { left: 168, top: 48, width: 190, height: 520 },
			distanceMeters: 1_234,
		});
		expect(presentation).toEqual({
			x: 288,
			y: 70,
			direction: "top-right",
			label: "↗ 1 시작 · 1,234 m",
		});
	});
});
