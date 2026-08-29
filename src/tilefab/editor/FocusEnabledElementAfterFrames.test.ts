import { describe, expect, it, vi } from "vitest";
import {
	type FocusFrameScheduler,
	focusEnabledElementAfterFrames,
} from "./FocusEnabledElementAfterFrames";

describe("focusEnabledElementAfterFrames", () => {
	it("waits for an enabled control and focuses it without scrolling", () => {
		const scheduler = new QueuedFrameScheduler();
		const focus = vi.fn();
		let disabled = true;

		focusEnabledElementAfterFrames(() => ({ disabled, focus }), 4, scheduler);
		scheduler.runNext();
		expect(focus).not.toHaveBeenCalled();
		disabled = false;
		scheduler.runNext();

		expect(focus).toHaveBeenCalledOnce();
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(scheduler.pendingCount).toBe(0);
	});

	it("stops after the bounded frame budget when the control stays unavailable", () => {
		const scheduler = new QueuedFrameScheduler();
		const focus = vi.fn();

		focusEnabledElementAfterFrames(() => ({ disabled: true, focus }), 3, scheduler);
		scheduler.runAll();

		expect(focus).not.toHaveBeenCalled();
		expect(scheduler.requestCount).toBe(3);
	});

	it("rejects invalid frame budgets before scheduling work", () => {
		const scheduler = new QueuedFrameScheduler();

		expect(() => focusEnabledElementAfterFrames(() => null, 0, scheduler)).toThrow(RangeError);
		expect(scheduler.requestCount).toBe(0);
	});
});

class QueuedFrameScheduler implements FocusFrameScheduler {
	private readonly callbacks: Array<() => void> = [];
	requestCount = 0;

	get pendingCount(): number {
		return this.callbacks.length;
	}

	request(callback: () => void): void {
		this.requestCount += 1;
		this.callbacks.push(callback);
	}

	runNext(): void {
		const callback = this.callbacks.shift();
		if (!callback) throw new Error("No focus frame is queued.");
		callback();
	}

	runAll(): void {
		while (this.callbacks.length > 0) this.runNext();
	}
}
