import { afterEach, describe, expect, it, vi } from "vitest";
import { createStaticFabArrangementCheckpoint } from "./StaticFabArrangementCheckpoint";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Arrangement preparation checkpoint", () => {
	it("lets a queued ordinary cancellation task run during prioritized preparation", async () => {
		let workTime = 0;
		vi.spyOn(performance, "now").mockImplementation(() => workTime);
		const prioritizedYield = vi.fn(async () => {});
		vi.stubGlobal("scheduler", { yield: prioritizedYield });
		const checkpoint = createStaticFabArrangementCheckpoint();
		await checkpoint();
		let cancelled = false;
		const ordinaryTask = new Promise<void>((resolve) => {
			setTimeout(() => {
				cancelled = true;
				resolve();
			}, 0);
		});
		try {
			for (let slice = 0; slice < 8 && !cancelled; slice++) {
				workTime += 4;
				await checkpoint();
			}
			expect(cancelled).toBe(true);
			expect(prioritizedYield).toHaveBeenCalled();
		} finally {
			await ordinaryTask;
		}
	});

	it("still admits ordinary tasks when native scheduling is unavailable", async () => {
		vi.spyOn(performance, "now").mockReturnValue(0);
		vi.stubGlobal("scheduler", undefined);
		const checkpoint = createStaticFabArrangementCheckpoint();
		await checkpoint();
		let taskRan = false;
		const ordinaryTask = new Promise<void>((resolve) => {
			setTimeout(() => {
				taskRan = true;
				resolve();
			}, 0);
		});
		try {
			await checkpoint();
			expect(taskRan).toBe(true);
		} finally {
			await ordinaryTask;
		}
	});
});
