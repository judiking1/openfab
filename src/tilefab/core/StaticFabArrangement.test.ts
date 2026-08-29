import { describe, expect, it } from "vitest";
import {
	STATIC_FAB_ARRANGEMENT_VERSION,
	type StaticFabArrangementIntent,
	solveStaticFabArrangement,
} from "./StaticFabArrangement";

describe("StaticFabArrangement", () => {
	it("aligns minimum and maximum bounds on either axis", () => {
		const min = solve("X", "ALIGN_MIN", [root("a", 4, 0, 7, 2), root("b", -2, 5, 0, 8)]);
		expect(min).toMatchObject({ valid: true, maximumSnapErrorMeters: 0 });
		if (!min.valid) throw new Error(min.reason);
		expect(delta(min, "a")).toEqual({ x: -6, z: 0 });
		expect(delta(min, "b")).toEqual({ x: 0, z: 0 });

		const max = solve("Z", "ALIGN_MAX", [root("a", 4, 0, 7, 2), root("b", -2, 5, 0, 8)]);
		expect(max.valid).toBe(true);
		if (!max.valid) throw new Error(max.reason);
		expect(delta(max, "a")).toEqual({ x: 0, z: 6 });
		expect(delta(max, "b")).toEqual({ x: 0, z: 0 });
	});

	it("snaps mixed-parity center alignment with symmetric ties-to-even rounding", () => {
		const result = solve("X", "ALIGN_CENTER", [
			root("negative-half", -4, 0, -1, 1),
			root("center", 0, 0, 2, 1),
			root("positive-half", 3, 0, 6, 1),
		]);
		expect(result).toMatchObject({ valid: true, maximumSnapErrorMeters: 0.5 });
		if (!result.valid) throw new Error(result.reason);
		expect(delta(result, "negative-half").x).toBe(4);
		expect(delta(result, "center").x).toBe(0);
		expect(delta(result, "positive-half").x).toBe(-4);
	});

	it("distributes centers while keeping geometric endpoints fixed", () => {
		const result = solve("X", "DISTRIBUTE_CENTERS", [
			root("last", 12, 0, 14, 2),
			root("first", 0, 0, 2, 2),
			root("middle-b", 9, 0, 11, 2),
			root("middle-a", 3, 0, 5, 2),
		]);
		expect(result).toMatchObject({ valid: true, maximumSnapErrorMeters: 0 });
		if (!result.valid) throw new Error(result.reason);
		expect(delta(result, "first").x).toBe(0);
		expect(delta(result, "middle-a").x).toBe(1);
		expect(delta(result, "middle-b").x).toBe(-1);
		expect(delta(result, "last").x).toBe(0);
	});

	it("distributes unequal widths into equal snapped gaps", () => {
		const result = solve("X", "DISTRIBUTE_GAPS", [
			root("first", 0, 0, 2, 1),
			root("middle-a", 2, 0, 5, 1),
			root("middle-b", 8, 0, 9, 1),
			root("last", 14, 0, 18, 1),
		]);
		expect(result).toMatchObject({ valid: true, maximumSnapErrorMeters: expect.closeTo(1 / 3) });
		if (!result.valid) throw new Error(result.reason);
		expect(delta(result, "first").x).toBe(0);
		expect(delta(result, "middle-a").x).toBe(3);
		expect(delta(result, "middle-b").x).toBe(2);
		expect(delta(result, "last").x).toBe(0);
	});

	it("rejects gap distribution when the anchored span is too small", () => {
		expect(
			solve("X", "DISTRIBUTE_GAPS", [
				root("a", 0, 0, 5, 1),
				root("b", 3, 0, 8, 1),
				root("c", 7, 0, 12, 1),
			]),
		).toMatchObject({ valid: false, code: "INSUFFICIENT_SPAN" });
	});

	it("is deterministic under input permutation", () => {
		const roots = [
			root("a", -10, 0, -8, 2),
			root("b", -3, 0, 1, 2),
			root("c", 4, 0, 5, 2),
			root("d", 13, 0, 16, 2),
		];
		const forward = solve("X", "DISTRIBUTE_CENTERS", roots);
		const reverse = solve("X", "DISTRIBUTE_CENTERS", [...roots].reverse());
		expect(translationMap(forward)).toEqual(translationMap(reverse));
	});

	it("uses canonical keys to break coincident-root ordering ties", () => {
		const result = solve("X", "DISTRIBUTE_CENTERS", [
			root("z", 4, 0, 6, 1),
			root("a", 4, 0, 6, 1),
			root("first", 0, 0, 2, 1),
			root("last", 10, 0, 12, 1),
		]);
		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(delta(result, "a").x).toBe(-1);
		expect(delta(result, "z").x).toBe(3);
	});

	it("rejects duplicates, too few roots, and no-ops", () => {
		expect(
			solve("X", "ALIGN_MIN", [root("same", 0, 0, 1, 1), root("same", 2, 0, 3, 1)]),
		).toMatchObject({ valid: false, code: "DUPLICATE_ROOT" });
		expect(solve("X", "DISTRIBUTE_GAPS", [root("a", 0, 0, 1, 1)])).toMatchObject({
			valid: false,
			code: "TOO_FEW_ROOTS",
		});
		expect(solve("X", "ALIGN_MIN", [root("a", 0, 0, 1, 1), root("b", 0, 2, 1, 3)])).toMatchObject({
			valid: false,
			code: "NO_CHANGE",
		});
	});

	it("rejects malformed untrusted intent without throwing", () => {
		for (const value of [null, {}, { version: 1, axis: "Y", mode: "ALIGN_MIN", roots: [] }]) {
			expect(() => solveStaticFabArrangement(value)).not.toThrow();
			expect(solveStaticFabArrangement(value)).toMatchObject({
				valid: false,
				code: "INVALID_INTENT",
			});
		}
		expect(
			solveStaticFabArrangement({
				version: 1,
				axis: "X",
				mode: "ALIGN_MIN",
				roots: [root("a", 0, 0, 1, 1), root("b", 3, 0, 3, 1)],
			}),
		).toMatchObject({ valid: false, code: "INVALID_INTENT" });
	});
});

function solve(
	axis: StaticFabArrangementIntent["axis"],
	mode: StaticFabArrangementIntent["mode"],
	roots: StaticFabArrangementIntent["roots"],
) {
	return solveStaticFabArrangement({ version: STATIC_FAB_ARRANGEMENT_VERSION, axis, mode, roots });
}

function root(
	key: string,
	minX: number,
	minZ: number,
	maxXExclusive: number,
	maxZExclusive: number,
) {
	return Object.freeze({
		key,
		bounds: Object.freeze({ minX, minZ, maxXExclusive, maxZExclusive }),
	});
}

function delta(
	result: ReturnType<typeof solveStaticFabArrangement> & { readonly valid: true },
	key: string,
) {
	const translation = result.translations.find((candidate) => candidate.key === key);
	if (!translation) throw new Error(`Missing translation for ${key}`);
	return { x: translation.deltaX, z: translation.deltaZ };
}

function translationMap(result: ReturnType<typeof solveStaticFabArrangement>) {
	if (!result.valid) throw new Error(result.reason);
	return Object.fromEntries(
		result.translations.map((translation) => [
			translation.key,
			{ x: translation.deltaX, z: translation.deltaZ },
		]),
	);
}
