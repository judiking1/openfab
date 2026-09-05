import { describe, expect, it } from "vitest";
import type { StaticFabArrangementRoot } from "./StaticFabArrangement";
import { recommendStaticFabArrangement } from "./StaticFabArrangementRecommendation";

describe("StaticFabArrangementRecommendation", () => {
	it("recommends perpendicular center alignment for two offset roots", () => {
		const recommendation = recommendStaticFabArrangement([
			root("bay-a", 0, 0, 10, 10),
			root("bay-b", 20, 4, 30, 14),
		]);

		expect(recommendation).toMatchObject({
			valid: true,
			code: null,
			axis: "Z",
			mode: "ALIGN_CENTER",
		});
	});

	it("reports two already aligned roots instead of recommending an overlapping axis", () => {
		const recommendation = recommendStaticFabArrangement([
			root("bay-a", 0, 0, 10, 10),
			root("bay-b", 20, 0, 30, 10),
		]);

		expect(recommendation).toEqual({
			valid: false,
			code: "ALREADY_ARRANGED",
			axis: null,
			mode: null,
			reason: "선택한 FAB 루트는 이미 한 축에 맞춰져 있고, 다른 정렬은 루트 경계를 서로 겹칩니다",
		});
	});

	it("recommends center distribution for an uneven row that is already aligned", () => {
		const recommendation = recommendStaticFabArrangement([
			root("bay-a", 0, 0, 10, 10),
			root("bay-b", 15, 0, 25, 10),
			root("bay-c", 40, 0, 50, 10),
		]);

		expect(recommendation).toMatchObject({
			valid: true,
			axis: "X",
			mode: "DISTRIBUTE_CENTERS",
		});
	});

	it("retains a Worker-reviewed fallback when sparse source bounds already overlap", () => {
		const recommendation = recommendStaticFabArrangement([
			root("sparse-a", 0, 0, 20, 10),
			root("sparse-b", 10, 4, 30, 14),
		]);

		expect(recommendation).toMatchObject({
			valid: true,
			axis: "Z",
			mode: "ALIGN_CENTER",
		});
		expect(recommendation.reason).toContain("exact Worker");
	});

	it("requires at least two roots", () => {
		expect(recommendStaticFabArrangement([root("bay-a", 0, 0, 10, 10)])).toMatchObject({
			valid: false,
			code: "NO_RECOMMENDATION",
		});
	});
});

function root(
	key: string,
	minX: number,
	minZ: number,
	maxXExclusive: number,
	maxZExclusive: number,
): StaticFabArrangementRoot {
	return Object.freeze({
		key,
		bounds: Object.freeze({ minX, minZ, maxXExclusive, maxZExclusive }),
	});
}
