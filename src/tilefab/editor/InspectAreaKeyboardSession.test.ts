import { describe, expect, it } from "vitest";
import {
	clampInspectAreaKeyboardCell,
	createInspectAreaKeyboardSession,
	type InspectAreaKeyboardBounds,
	inspectAreaKeyboardSessionIsCurrent,
	inspectAreaKeyboardSessionReadout,
	moveInspectAreaKeyboardSession,
} from "./InspectAreaKeyboardSession";

const BOUNDS = Object.freeze({ minX: -2, minY: 3, maxX: 2, maxY: 7 });

describe("InspectAreaKeyboardSession", () => {
	it("creates an immutable transient session and clamps its initial cell", () => {
		const start = { x: -10, y: 5 };
		const session = createInspectAreaKeyboardSession({
			modelGeneration: 7,
			revision: 11,
			patchSequence: 13,
			start,
			bounds: BOUNDS,
		});

		expect(session).toEqual({
			modelGeneration: 7,
			revision: 11,
			patchSequence: 13,
			start: { x: -2, y: 5 },
			current: { x: -2, y: 5 },
			bounds: BOUNDS,
		});
		expect(session.current).toBe(session.start);
		expect(Object.isFrozen(session)).toBe(true);
		expect(Object.isFrozen(session.start)).toBe(true);
		expect(Object.isFrozen(session.bounds)).toBe(true);
		expect(start).toEqual({ x: -10, y: 5 });
	});

	it("moves the active corner by one metre in every direction and clamps at bounds", () => {
		const initial = createInspectAreaKeyboardSession({
			modelGeneration: 1,
			revision: 2,
			patchSequence: 3,
			start: { x: 0, y: 5 },
			bounds: BOUNDS,
		});
		const up = moveInspectAreaKeyboardSession(initial, "up");
		const left = moveInspectAreaKeyboardSession(up, "left");
		const down = moveInspectAreaKeyboardSession(left, "down");
		const right = moveInspectAreaKeyboardSession(down, "right");

		expect(initial.current).toEqual({ x: 0, y: 5 });
		expect(up.current).toEqual({ x: 0, y: 4 });
		expect(left.current).toEqual({ x: -1, y: 4 });
		expect(down.current).toEqual({ x: -1, y: 5 });
		expect(right.current).toEqual({ x: 0, y: 5 });

		const edge = createInspectAreaKeyboardSession({
			modelGeneration: 1,
			revision: 2,
			patchSequence: 3,
			start: { x: -2, y: 3 },
			bounds: BOUNDS,
		});
		expect(moveInspectAreaKeyboardSession(edge, "up")).toBe(edge);
		expect(moveInspectAreaKeyboardSession(edge, "left")).toBe(edge);
	});

	it("compares the exact model generation, revision, and patch sequence", () => {
		const session = createInspectAreaKeyboardSession({
			modelGeneration: 4,
			revision: 8,
			patchSequence: 12,
			start: { x: 0, y: 3 },
			bounds: BOUNDS,
		});

		expect(
			inspectAreaKeyboardSessionIsCurrent(session, {
				modelGeneration: 4,
				revision: 8,
				patchSequence: 12,
			}),
		).toBe(true);
		for (const current of [
			{ modelGeneration: 5, revision: 8, patchSequence: 12 },
			{ modelGeneration: 4, revision: 9, patchSequence: 12 },
			{ modelGeneration: 4, revision: 8, patchSequence: 13 },
			{ modelGeneration: 4, revision: 8, patchSequence: Number.NaN },
		]) {
			expect(inspectAreaKeyboardSessionIsCurrent(session, current)).toBe(false);
		}
	});

	it("publishes normalized inclusive bounds and a stable coordinate readout", () => {
		const initial = createInspectAreaKeyboardSession({
			modelGeneration: 0,
			revision: 0,
			patchSequence: 0,
			start: { x: 1, y: 6 },
			bounds: BOUNDS,
		});
		const moved = moveInspectAreaKeyboardSession(
			moveInspectAreaKeyboardSession(moveInspectAreaKeyboardSession(initial, "left"), "left"),
			"up",
		);

		expect(inspectAreaKeyboardSessionReadout(moved)).toEqual({
			summary:
				"키보드 부분 영역 선택 · 시작 X 1미터 · Z 6미터 · 현재 X -1미터 · Z 5미터 · 범위 3 × 2셀",
			minX: -1,
			minY: 5,
			maxX: 1,
			maxY: 6,
			widthCells: 3,
			heightCells: 2,
		});
	});

	it("normalizes fractional finite limits and rejects empty or malformed bounds", () => {
		expect(
			clampInspectAreaKeyboardCell(
				{ x: 10, y: -10 },
				{ minX: -1.8, minY: 2.2, maxX: 3.9, maxY: 8.7 },
			),
		).toEqual({ x: 3, y: 3 });

		for (const bounds of [
			{ minX: Number.NEGATIVE_INFINITY, minY: 0, maxX: 1, maxY: 1 },
			{ minX: 0, minY: Number.NaN, maxX: 1, maxY: 1 },
			{ minX: 2, minY: 0, maxX: 1, maxY: 1 },
			{ minX: 0.2, minY: 0, maxX: 0.8, maxY: 1 },
		] satisfies InspectAreaKeyboardBounds[]) {
			expect(() =>
				createInspectAreaKeyboardSession({
					modelGeneration: 0,
					revision: 0,
					patchSequence: 0,
					start: { x: 0, y: 0 },
					bounds,
				}),
			).toThrow(RangeError);
		}
	});

	it("rejects malformed identities and non-integer authored cells", () => {
		expect(() =>
			createInspectAreaKeyboardSession({
				modelGeneration: -1,
				revision: 0,
				patchSequence: 0,
				start: { x: 0, y: 0 },
				bounds: BOUNDS,
			}),
		).toThrow(RangeError);
		expect(() => clampInspectAreaKeyboardCell({ x: 0.5, y: 4 }, BOUNDS)).toThrow(RangeError);
	});
});
