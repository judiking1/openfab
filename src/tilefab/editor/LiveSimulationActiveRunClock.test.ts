import { describe, expect, it } from "vitest";
import {
	LiveSimulationActiveRunClock,
	type LiveSimulationActiveRunClockFramePort,
	type LiveSimulationActiveRunClockRuntimePort,
} from "./LiveSimulationActiveRunClock";
import type { LiveSimulationActiveRunStopReason } from "./LiveSimulationActiveRunOwner";

class ControlledFrames implements LiveSimulationActiveRunClockFramePort {
	private readonly callbacks = new Map<number, (timestampMilliseconds: number) => void>();
	private readonly visibilityListeners = new Set<() => void>();
	private nextHandle = 1;
	visible = true;

	requestFrame(callback: (timestampMilliseconds: number) => void): number {
		const handle = this.nextHandle++;
		this.callbacks.set(handle, callback);
		return handle;
	}

	cancelFrame(handle: number): void {
		this.callbacks.delete(handle);
	}

	isVisible(): boolean {
		return this.visible;
	}

	subscribeVisibility(listener: () => void): () => void {
		this.visibilityListeners.add(listener);
		return () => this.visibilityListeners.delete(listener);
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		for (const listener of this.visibilityListeners) listener();
	}

	fire(timestampMilliseconds: number): void {
		const [handle, callback] = this.callbacks.entries().next().value ?? [];
		if (!handle || !callback) throw new Error("No controlled animation frame is scheduled.");
		this.callbacks.delete(handle);
		callback(timestampMilliseconds);
	}

	get scheduledFrameCount(): number {
		return this.callbacks.size;
	}
}

class ControlledRuntime implements LiveSimulationActiveRunClockRuntimePort {
	private readonly listeners = new Set<() => void>();
	state:
		| Readonly<{ phase: "ACTIVE"; completed: boolean }>
		| Readonly<{ phase: "IDLE" | "FAILED" }>
		| Readonly<{ phase: "STOPPED"; reason: LiveSimulationActiveRunStopReason }> = {
		phase: "ACTIVE",
		completed: false,
	};
	readonly advances: number[] = [];
	advanceError: Error | null = null;
	completeOnAdvance = false;

	getState(): ControlledRuntime["state"] {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	advanceByWallClockMicroseconds(wallClockMicroseconds: number): void {
		if (this.advanceError) throw this.advanceError;
		this.advances.push(wallClockMicroseconds);
		if (this.completeOnAdvance) this.publish({ phase: "ACTIVE", completed: true });
	}

	publish(
		state:
			| Readonly<{ phase: "ACTIVE"; completed: boolean }>
			| Readonly<{ phase: "IDLE" | "FAILED" }>
			| Readonly<{ phase: "STOPPED"; reason: LiveSimulationActiveRunStopReason }>,
	): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}
}

describe("LiveSimulationActiveRunClock", () => {
	it("converts frame timestamps to integer microseconds with bounded visible catch-up", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		const clock = controlledClock(runtime, frames);

		clock.start();
		expect(clock.getState()).toMatchObject({
			phase: "RUNNING",
			generation: 1,
			maximumWallClockAdvancePerFrameMicroseconds: 25_000,
			maximumPendingWallClockMicroseconds: 100_000,
		});
		frames.fire(100);
		expect(runtime.advances).toEqual([]);
		frames.fire(116.667);
		frames.fire(316.667);
		frames.fire(333.334);
		expect(runtime.advances).toEqual([16_667, 25_000, 25_000]);

		expect(clock.pause()).toBe(true);
		expect(clock.getState()).toEqual({
			phase: "PAUSED",
			generation: 1,
			reason: "EXPLICIT_PAUSE",
			summary: {
				advanceCallCount: 3,
				observedWallClockMicroseconds: 233_334,
				advancedWallClockMicroseconds: 66_667,
				discardedWallClockMicroseconds: 166_667,
			},
		});
		expect(frames.scheduledFrameCount).toBe(0);
	});

	it("pauses while hidden and requires explicit resume without background catch-up", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		const clock = controlledClock(runtime, frames);
		clock.start();
		frames.fire(100);
		frames.fire(116);
		expect(runtime.advances).toEqual([16_000]);

		frames.setVisible(false);
		expect(clock.getState()).toMatchObject({
			phase: "PAUSED",
			reason: "DOCUMENT_HIDDEN",
		});
		expect(frames.scheduledFrameCount).toBe(0);
		expect(() => clock.resume()).toThrow(/hidden/i);
		frames.setVisible(true);
		expect(clock.getState()).toMatchObject({ phase: "PAUSED" });

		clock.resume();
		frames.fire(500);
		frames.fire(516);
		expect(runtime.advances).toEqual([16_000, 16_000]);
	});

	it("cancels its scheduled frame synchronously when the active runtime stops", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		const clock = controlledClock(runtime, frames);
		clock.start();
		expect(frames.scheduledFrameCount).toBe(1);

		runtime.publish({ phase: "STOPPED", reason: "AUTHORED_MUTATION" });
		expect(clock.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "ACTIVE_RUN_STOPPED",
			activeRunStopReason: "AUTHORED_MUTATION",
			summary: {
				advanceCallCount: 0,
				observedWallClockMicroseconds: 0,
				advancedWallClockMicroseconds: 0,
				discardedWallClockMicroseconds: 0,
			},
		});
		expect(frames.scheduledFrameCount).toBe(0);
	});

	it("pauses on terminal runtime publication and fails closed on invalid frame input", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		const clock = controlledClock(runtime, frames);
		clock.start();
		frames.fire(100);
		runtime.publish({ phase: "ACTIVE", completed: true });
		expect(clock.getState()).toMatchObject({ phase: "PAUSED", reason: "RUN_COMPLETED" });
		expect(frames.scheduledFrameCount).toBe(0);

		runtime.publish({ phase: "ACTIVE", completed: false });
		clock.start();
		frames.fire(200);
		frames.fire(199);
		expect(clock.getState()).toMatchObject({
			phase: "FAILED",
			message: "Simulation clock frame timestamps must be monotonic.",
		});
		expect(frames.scheduledFrameCount).toBe(0);
	});

	it("accounts the final successful advance before a reentrant completion publication", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		const clock = controlledClock(runtime, frames);
		clock.start();
		frames.fire(100);
		runtime.completeOnAdvance = true;
		frames.fire(116);

		expect(clock.getState()).toEqual({
			phase: "PAUSED",
			generation: 1,
			reason: "RUN_COMPLETED",
			summary: {
				advanceCallCount: 1,
				observedWallClockMicroseconds: 16_000,
				advancedWallClockMicroseconds: 16_000,
				discardedWallClockMicroseconds: 0,
			},
		});
		expect(frames.scheduledFrameCount).toBe(0);
	});

	it("accounts a rejected runtime advance as discarded and exposes a bounded failure", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		const clock = controlledClock(runtime, frames);
		clock.start();
		frames.fire(100);
		runtime.advanceError = new Error("controlled runtime rejection");
		frames.fire(116);

		expect(clock.getState()).toEqual({
			phase: "FAILED",
			generation: 1,
			message: "controlled runtime rejection",
			summary: {
				advanceCallCount: 0,
				observedWallClockMicroseconds: 16_000,
				advancedWallClockMicroseconds: 0,
				discardedWallClockMicroseconds: 16_000,
			},
		});
	});

	it("rejects invalid budgets before attaching to the runtime", () => {
		const runtime = new ControlledRuntime();
		const frames = new ControlledFrames();
		expect(
			() =>
				new LiveSimulationActiveRunClock(runtime, frames, {
					maximumWallClockAdvancePerFrameMicroseconds: 25_000,
					maximumPendingWallClockMicroseconds: 20_000,
				}),
		).toThrow(/configuration/i);
	});
});

function controlledClock(runtime: ControlledRuntime, frames: ControlledFrames) {
	return new LiveSimulationActiveRunClock(runtime, frames, {
		maximumWallClockAdvancePerFrameMicroseconds: 25_000,
		maximumPendingWallClockMicroseconds: 100_000,
	});
}
