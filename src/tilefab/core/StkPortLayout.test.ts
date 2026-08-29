import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";
import { analyzeStkPortLayout, type StkPortLayoutCandidate } from "./StkPortLayout";

describe("StkPortLayout", () => {
	it("canonicalizes a four-port lane in directed travel order", () => {
		const candidates = [3, 1, 4, 2].map((x) => port(x, x, 0, DIR_W, DIR_E));
		const result = analyzeStkPortLayout(candidates, "FOUR_PORT");

		expect(result.valid, result.reason).toBe(true);
		expect(result.orderedIds).toEqual([1, 2, 3, 4]);
		expect(result.laneIds).toEqual([[1, 2, 3, 4]]);
	});

	it("accepts aligned opposite-direction back-to-back lanes", () => {
		const result = analyzeStkPortLayout(
			[
				port(1, 1, 0, DIR_W, DIR_E),
				port(2, 2, 0, DIR_W, DIR_E),
				port(3, 1, 2, DIR_E, DIR_W),
				port(4, 2, 2, DIR_E, DIR_W),
			],
			"BACK_TO_BACK",
		);

		expect(result.valid, result.reason).toBe(true);
		expect(result.laneIds).toEqual([
			[1, 2],
			[4, 3],
		]);
	});

	it("accepts one reversed equipment-facing direction and rejects mixed STK facing", () => {
		const reversed = [1, 2, 3, 4].map((x) => ({
			...port(x, x, 0, DIR_W, DIR_E),
			direction: "AGAINST_TRAVEL" as const,
		}));
		expect(analyzeStkPortLayout(reversed, "FOUR_PORT").valid).toBe(true);

		const mixed = reversed.map((candidate, index) =>
			index === 2 ? { ...candidate, direction: "WITH_TRAVEL" as const } : candidate,
		);
		expect(analyzeStkPortLayout(mixed, "FOUR_PORT").reason).toContain(
			"one equipment-facing direction",
		);
	});

	it("accepts odd asymmetric FLEX lanes with overlapping ranges", () => {
		const result = analyzeStkPortLayout(
			[
				port(1, 1, 0, DIR_W, DIR_E),
				port(2, 3, 0, DIR_W, DIR_E),
				port(3, 6, 0, DIR_W, DIR_E),
				port(4, 5, 2, DIR_E, DIR_W),
				port(5, 2, 2, DIR_E, DIR_W),
			],
			"FLEX",
		);

		expect(result.valid, result.reason).toBe(true);
		expect(result.orderedIds).toEqual([1, 2, 3, 4, 5]);
		expect(result.laneIds).toEqual([
			[1, 2, 3],
			[4, 5],
		]);
	});

	it("treats FLEX as an arbitrary deterministic port set across axes and distant lanes", () => {
		const result = analyzeStkPortLayout(
			[
				port(1, 0, 0, DIR_W, DIR_E),
				port(2, 65, 0, DIR_W, DIR_E),
				port(3, 5, 8, DIR_W, DIR_E),
				port(4, 20, 3, DIR_N, DIR_S),
			],
			"FLEX",
		);

		expect(result.valid, result.reason).toBe(true);
		expect(result.axis).toBeNull();
		expect(result.laneIds).toEqual([[1, 2], [3], [4]]);
		expect(result.orderedIds).toEqual([1, 2, 3, 4]);
	});

	it("preserves legacy CUSTOM freeform semantics", () => {
		const result = analyzeStkPortLayout(
			[port(1, 0, 0, DIR_W, DIR_E), port(2, 70, 0, DIR_W, DIR_E), port(3, 80, 2, DIR_W, DIR_E)],
			"CUSTOM",
		);

		expect(result.valid, result.reason).toBe(true);
	});

	it("rejects gaps, perpendicular lanes, excessive separation, and unpaired stations", () => {
		expect(
			analyzeStkPortLayout(
				[
					port(1, 1, 0, DIR_W, DIR_E),
					port(2, 2, 0, DIR_W, DIR_E),
					port(3, 1, 2, DIR_W, DIR_E),
					port(4, 2, 2, DIR_W, DIR_E),
				],
				"BACK_TO_BACK",
			).reason,
		).toContain("opposite travel directions");
		expect(
			analyzeStkPortLayout(
				[1, 2, 3, 5].map((x) => port(x, x, 0, DIR_W, DIR_E)),
				"FOUR_PORT",
			).reason,
		).toContain("consecutive");
		expect(
			analyzeStkPortLayout(
				[
					port(1, 1, 0, DIR_W, DIR_E),
					port(2, 2, 0, DIR_W, DIR_E),
					port(3, 0, 1, DIR_N, DIR_S),
					port(4, 0, 2, DIR_N, DIR_S),
				],
				"BACK_TO_BACK",
			).reason,
		).toContain("common cardinal rail axis");
		expect(
			analyzeStkPortLayout(
				[
					port(1, 1, 0, DIR_W, DIR_E),
					port(2, 2, 0, DIR_W, DIR_E),
					port(3, 1, 7, DIR_E, DIR_W),
					port(4, 2, 7, DIR_E, DIR_W),
				],
				"BACK_TO_BACK",
			).reason,
		).toContain("1-6 m apart");
		expect(
			analyzeStkPortLayout(
				[
					port(1, 1, 0, DIR_W, DIR_E),
					port(2, 2, 0, DIR_W, DIR_E),
					port(3, 2, 2, DIR_E, DIR_W),
					port(4, 3, 2, DIR_E, DIR_W),
				],
				"BACK_TO_BACK",
			).reason,
		).toContain("aligned");
	});

	it("rejects non-center ports and invalid template counts", () => {
		expect(
			analyzeStkPortLayout(
				[
					{ ...port(1, 1, 0, DIR_W, DIR_E), side: "LEFT", lateralOffsetMillimeters: 700 },
					port(2, 2, 0, DIR_W, DIR_E),
					port(3, 3, 0, DIR_W, DIR_E),
					port(4, 4, 0, DIR_W, DIR_E),
				],
				"FOUR_PORT",
			).reason,
		).toContain("zero-offset CENTER");
		expect(analyzeStkPortLayout([port(1, 1, 0, DIR_W, DIR_E)], "SIX_PORT").reason).toContain(
			"exactly six",
		);
	});
});

function port(
	id: number,
	x: number,
	z: number,
	from: typeof DIR_W | typeof DIR_E | typeof DIR_N | typeof DIR_S,
	to: typeof DIR_W | typeof DIR_E | typeof DIR_N | typeof DIR_S,
): StkPortLayoutCandidate {
	return {
		id,
		x,
		z,
		from,
		to,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
	};
}
