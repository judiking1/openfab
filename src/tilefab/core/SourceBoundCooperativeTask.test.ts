import { describe, expect, it } from "vitest";
import {
	createSourceBoundCooperativeTask,
	type SourceBoundCooperativeTask,
} from "./SourceBoundCooperativeTask";
import { advance, expectCode } from "./StaticFabCheckRepair.test-fixtures";

describe("source-bound cooperative task", () => {
	it("clamps steps, checks final publication and treats premature finish/invalid budget as nonterminal", () => {
		let checks = 0;
		function* steps(): Generator<void, number> {
			for (let index = 0; index < 300; index++) yield;
			return 300;
		}
		const task = createSourceBoundCooperativeTask(steps(), () => {
			checks++;
		});
		expect(checks).toBe(0);
		expectCode(() => task.finish(), "NOT_COMPLETE");
		for (const budget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expectCode(() => task.step(budget), "INVALID_OPERATION_BUDGET");
		}
		expect(task.step(100_000)).toBe(128);
		expect(task.done).toBe(false);
		advance(task);
		const before = checks;
		expect(task.finish()).toBe(300);
		expect(checks).toBe(before + 2);
	});

	it("defers close when cancellation occurs inside generator.next and stops before another operation", () => {
		let closed = 0;
		let visited = 0;
		function* steps(): Generator<void, number> {
			try {
				yield;
				task.cancel();
				visited++;
				yield;
				visited++;
				return visited;
			} finally {
				closed++;
			}
		}
		const task: SourceBoundCooperativeTask<number> = createSourceBoundCooperativeTask(
			steps(),
			() => {},
		);
		task.step(1);
		expectCode(() => task.step(128), "CANCELLED");
		expect(visited).toBe(1);
		expect(closed).toBe(1);
		expectCode(() => task.finish(), "CANCELLED");
		expectCode(() => task.step(), "CANCELLED");
	});

	for (const boundary of [1, 2]) {
		it(`rejects synchronous cancellation at final callback ${boundary}`, () => {
			let finishing = false;
			let calls = 0;
			function* steps(): Generator<void, number> {
				yield;
				return 1;
			}
			const task: SourceBoundCooperativeTask<number> = createSourceBoundCooperativeTask(
				steps(),
				() => {
					if (finishing && ++calls === boundary) task.cancel();
				},
			);
			advance(task);
			finishing = true;
			let published: number | undefined;
			expectCode(() => {
				published = task.finish();
			}, "CANCELLED");
			expect(published).toBeUndefined();
		});
	}

	it("preserves the first failure even if cleanup throws", () => {
		const failure = new Error("exact source failed");
		function* steps(): Generator<void, number> {
			yield;
			return 1;
		}
		const task = createSourceBoundCooperativeTask(
			steps(),
			() => {
				throw failure;
			},
			() => {
				throw new Error("cleanup");
			},
		);
		expect(() => task.step()).toThrow(failure);
		expect(() => task.finish()).toThrow(failure);
	});
});
