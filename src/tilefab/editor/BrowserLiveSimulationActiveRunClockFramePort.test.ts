import { describe, expect, it, vi } from "vitest";
import { BrowserLiveSimulationActiveRunClockFramePort } from "./BrowserLiveSimulationActiveRunClockFramePort";

describe("BrowserLiveSimulationActiveRunClockFramePort", () => {
	it("adapts animation frames and visibility without owning simulation state", () => {
		const callback = vi.fn();
		const frameTarget = {
			requestAnimationFrame: vi.fn((registeredCallback: FrameRequestCallback) => {
				void registeredCallback;
				return 17;
			}),
			cancelAnimationFrame: vi.fn(),
		};
		const listeners = new Set<() => void>();
		const visibilityTarget = {
			visibilityState: "visible" as DocumentVisibilityState,
			addEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => {
				listeners.add(listener);
			}),
			removeEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => {
				listeners.delete(listener);
			}),
		};
		const port = new BrowserLiveSimulationActiveRunClockFramePort(frameTarget, visibilityTarget);

		expect(port.requestFrame(callback)).toBe(17);
		expect(frameTarget.requestAnimationFrame).toHaveBeenCalledWith(callback);
		port.cancelFrame(17);
		expect(frameTarget.cancelAnimationFrame).toHaveBeenCalledWith(17);
		expect(port.isVisible()).toBe(true);

		const visibilityListener = vi.fn();
		const unsubscribe = port.subscribeVisibility(visibilityListener);
		expect(listeners.size).toBe(1);
		for (const listener of listeners) listener();
		expect(visibilityListener).toHaveBeenCalledOnce();
		visibilityTarget.visibilityState = "hidden";
		expect(port.isVisible()).toBe(false);
		unsubscribe();
		unsubscribe();
		expect(listeners.size).toBe(0);
		expect(visibilityTarget.removeEventListener).toHaveBeenCalledOnce();
	});
});
