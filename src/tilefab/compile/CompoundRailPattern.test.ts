import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { cellKey } from "../core/TileMap";
import { type CompoundRailEntry, collectCompoundRailPatterns } from "./CompoundRailPattern";

describe("CompoundRailPattern", () => {
	it("consumes overlapping north-west candidates in directed source order", () => {
		const flowOrdered: CompoundRailEntry[] = [
			curve(2, 2, DIR_E, DIR_N, "RIGHT_CURVE"),
			curve(2, 1, DIR_S, DIR_W, "LEFT_CURVE"),
			curve(1, 1, DIR_E, DIR_N, "RIGHT_CURVE"),
			curve(1, 0, DIR_S, DIR_W, "LEFT_CURVE"),
			curve(0, 0, DIR_E, DIR_N, "RIGHT_CURVE"),
		];
		const index = new Map(
			[...flowOrdered]
				.reverse()
				.map((entry) => [cellKey(entry.cell.x, entry.cell.y), entry] as const),
		);

		const patterns = collectCompoundRailPatterns(index);
		expect(patterns).toHaveLength(2);
		expect(patterns.map((pattern) => pattern.type)).toEqual(["S_CURVE", "S_CURVE"]);
		expect(patterns.map((pattern) => pattern.cells)).toEqual([
			[
				{ x: 2, y: 2 },
				{ x: 2, y: 1 },
			],
			[
				{ x: 1, y: 1 },
				{ x: 1, y: 0 },
			],
		]);
	});

	it("is invariant to map insertion order", () => {
		const entries: CompoundRailEntry[] = [
			curve(3, 1, DIR_E, DIR_N, "RIGHT_CURVE"),
			curve(3, 0, DIR_S, DIR_W, "LEFT_CURVE"),
		];
		const forward = new Map(entries.map((entry) => [key(entry), entry] as const));
		const reverse = new Map([...entries].reverse().map((entry) => [key(entry), entry] as const));

		expect(collectCompoundRailPatterns(reverse)).toEqual(collectCompoundRailPatterns(forward));
	});

	it("requires exact directed reciprocity at both pair and CSC seams", () => {
		const first = curve(0, 0, DIR_W, DIR_S, "RIGHT_CURVE");
		const last = curve(0, 2, DIR_N, DIR_E, "LEFT_CURVE");
		const brokenPair = new Map([
			[key(first), first],
			[cellKey(0, 1), curve(0, 1, DIR_E, DIR_W, "RIGHT_CURVE")],
		] as const);
		const brokenFirstCscSeam = new Map([
			[key(first), first],
			[
				cellKey(0, 1),
				{ cell: { x: 0, y: 1 }, rail: { incoming: DIR_E, outgoing: DIR_W }, type: "LINEAR" },
			],
			[key(last), last],
		] as const);
		const brokenSecondCscSeam = new Map([
			[key(first), first],
			[
				cellKey(0, 1),
				{ cell: { x: 0, y: 1 }, rail: { incoming: DIR_N, outgoing: DIR_S }, type: "LINEAR" },
			],
			[key(last), { ...last, rail: { incoming: DIR_E, outgoing: DIR_N } }],
		] as const);

		expect(collectCompoundRailPatterns(brokenPair)).toEqual([]);
		expect(collectCompoundRailPatterns(brokenFirstCscSeam)).toEqual([]);
		expect(collectCompoundRailPatterns(brokenSecondCscSeam)).toEqual([]);
	});
});

function curve(
	x: number,
	y: number,
	incoming: number,
	outgoing: number,
	type: "LEFT_CURVE" | "RIGHT_CURVE",
): CompoundRailEntry {
	return { cell: { x, y }, rail: { incoming, outgoing }, type };
}

function key(entry: CompoundRailEntry): string {
	return cellKey(entry.cell.x, entry.cell.y);
}
