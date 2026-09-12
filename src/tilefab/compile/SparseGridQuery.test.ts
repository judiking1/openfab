import { describe, expect, it } from "vitest";
import { visitSparseGridBuckets } from "./SparseGridQuery";

describe("sparse viewport bucket queries", () => {
	it.each([
		",",
		":",
	] as const)("preserves row-major order and boundary inclusion with %s keys", (separator) => {
		const buckets = new Map([
			[`2${separator}1`, "last"],
			[`1${separator}-1`, "second"],
			[`-1${separator}-1`, "first"],
			[`3${separator}0`, "outside"],
		]);
		for (const minY of [-1, -100_000]) {
			const result: string[] = [];
			visitSparseGridBuckets(buckets, { minX: -1, maxX: 2, minY, maxY: 1 }, separator, (row) =>
				result.push(row),
			);
			expect(result).toEqual(["first", "second", "last"]);
		}
	});

	it("does not probe the empty coordinate domain for an extreme sparse overview", () => {
		class OccupiedBuckets extends Map<string, number> {
			override get(key: string): number | undefined {
				throw new Error(`Unexpected empty-space probe at ${key}`);
			}
		}
		const buckets = new OccupiedBuckets([
			["-67108864,-67108864", 1],
			["67108863,67108863", 2],
		]);
		const result: number[] = [];
		visitSparseGridBuckets(
			buckets,
			{ minX: -67108864, maxX: 67108863, minY: -67108864, maxY: 67108863 },
			",",
			(row) => result.push(row),
		);
		expect(result).toEqual([1, 2]);
	});

	it("rejects nonfinite, unsafe and inverted query bounds", () => {
		const result: number[] = [];
		for (const bounds of [
			{ minX: 0, maxX: Number.POSITIVE_INFINITY, minY: 0, maxY: 1 },
			{ minX: 0, maxX: Number.MAX_SAFE_INTEGER + 1, minY: 0, maxY: 1 },
			{ minX: 1, maxX: 0, minY: 0, maxY: 1 },
		])
			visitSparseGridBuckets(new Map([["0,0", 1]]), bounds, ",", (row) => result.push(row));
		expect(result).toEqual([]);
	});
});
