import { describe, expect, it } from "vitest";
import { stableSortSteps } from "./CooperativeSort";
import { createCooperativeTask } from "./CooperativeTask";

describe("cooperative stable sorting", () => {
	it("matches native stable ordering across run boundaries and incomplete merge levels", () => {
		for (const length of [0, 1, 7, 31, 32, 33, 63, 64, 65, 1_025, 10_003]) {
			const input = Array.from({ length }, (_, id) => ({ id, key: (id * 7_919) % 97 }));
			const expected = [...input].sort((left, right) => left.key - right.key);
			const task = createCooperativeTask(
				stableSortSteps(input, (left, right) => left.key - right.key),
			);
			while (!task.done) expect(task.step(7)).toBeLessThanOrEqual(7);
			task.finish();
			expect(input).toEqual(expected);
		}
	});

	it("does no comparison on creation or finish and bounds each native run", () => {
		const input = Array.from({ length: 1_033 }, (_, index) => 1_033 - index);
		let comparisons = 0;
		const task = createCooperativeTask(
			stableSortSteps(input, (left, right) => {
				comparisons++;
				return left - right;
			}),
		);
		expect(comparisons).toBe(0);
		expect(() => task.finish()).toThrow("not complete");
		while (!task.done) {
			const before = comparisons;
			expect(task.step(1)).toBe(1);
			expect(comparisons - before).toBeLessThanOrEqual(32 * 32);
		}
		const completed = comparisons;
		task.finish();
		expect(task.step(1)).toBe(0);
		expect(comparisons).toBe(completed);
		expect(input[0]).toBe(1);
		expect(input.at(-1)).toBe(1_033);
	});

	it("retains equal items and latches comparator failures without returning partial order", () => {
		const input = Array.from({ length: 100 }, (_, id) => ({ id }));
		const equal = createCooperativeTask(stableSortSteps(input, () => Number.NaN));
		while (!equal.done) equal.step(3);
		equal.finish();
		expect(input.map(({ id }) => id)).toEqual(Array.from({ length: 100 }, (_, id) => id));
		const failure = new Error("invalid ordering source");
		const broken = createCooperativeTask(
			stableSortSteps([3, 2, 1], () => {
				throw failure;
			}),
		);
		expect(() => broken.step(1)).toThrow(failure);
		expect(() => broken.step(1)).toThrow(failure);
		expect(() => broken.finish()).toThrow(failure);
		expect(broken.done).toBe(false);
	});
});
