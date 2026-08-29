import { describe, expect, it, vi } from "vitest";
import {
	LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	type SimulationRuntimePresentation,
	type SimulationRuntimePresentationStore,
} from "../render/SimulationRuntimePresentation";
import { SimulationRuntimePresentationRouter } from "./SimulationRuntimePresentationRouter";

class ControlledPresentationStore implements SimulationRuntimePresentationStore {
	private readonly listeners = new Set<() => void>();
	snapshot: SimulationRuntimePresentation | null = null;

	getSnapshot(): SimulationRuntimePresentation | null {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	publish(snapshot: SimulationRuntimePresentation | null): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

describe("SimulationRuntimePresentationRouter", () => {
	it("selects one exact current or resident presentation without copying it", () => {
		const current = new ControlledPresentationStore();
		const resident = new ControlledPresentationStore();
		const router = new SimulationRuntimePresentationRouter(current, resident);
		const currentSnapshot = presentation(LIVE_SIMULATION_RUNTIME_VIEW_POLICY);
		current.publish(currentSnapshot);

		expect(router.getState()).toEqual({
			phase: "READY",
			profile: "CURRENT",
			snapshot: currentSnapshot,
		});
		expect(router.getSnapshot()).toBe(currentSnapshot);
		current.publish(null);
		const residentSnapshot = presentation(RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY);
		resident.publish(residentSnapshot);
		expect(router.getState()).toEqual({
			phase: "READY",
			profile: "RESIDENT",
			snapshot: residentSnapshot,
		});
		expect(router.getSnapshot()).toBe(residentSnapshot);
	});

	it("fails closed while both profiles are active and recovers after either clears", () => {
		const current = new ControlledPresentationStore();
		const resident = new ControlledPresentationStore();
		const router = new SimulationRuntimePresentationRouter(current, resident);
		const currentSnapshot = presentation(LIVE_SIMULATION_RUNTIME_VIEW_POLICY);
		const residentSnapshot = presentation(RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY);
		current.publish(currentSnapshot);
		resident.publish(residentSnapshot);

		expect(router.getSnapshot()).toBeNull();
		expect(router.getState()).toEqual({
			phase: "FAILED",
			message: "Current and resident runtime presentations cannot be active together.",
		});
		current.publish(null);
		expect(router.getSnapshot()).toBe(residentSnapshot);
		expect(router.getState()).toMatchObject({ phase: "READY", profile: "RESIDENT" });
	});

	it("deduplicates source noise and releases both subscriptions on dispose", () => {
		const current = new ControlledPresentationStore();
		const resident = new ControlledPresentationStore();
		const router = new SimulationRuntimePresentationRouter(current, resident);
		const listener = vi.fn();
		router.subscribe(listener);
		const currentSnapshot = presentation(LIVE_SIMULATION_RUNTIME_VIEW_POLICY);
		current.publish(currentSnapshot);
		current.publish(currentSnapshot);
		expect(listener).toHaveBeenCalledOnce();
		expect(current.listenerCount).toBe(1);
		expect(resident.listenerCount).toBe(1);

		router.dispose();
		router.dispose();
		expect(current.listenerCount).toBe(0);
		expect(resident.listenerCount).toBe(0);
		expect(router.getSnapshot()).toBeNull();
		expect(() => router.subscribe(vi.fn())).toThrow(/disposed/i);
	});
});

function presentation(
	policy:
		| typeof LIVE_SIMULATION_RUNTIME_VIEW_POLICY
		| typeof RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
): SimulationRuntimePresentation {
	return {
		policy,
		poseFingerprint: `${policy}-pose`,
		publication: {},
	} as SimulationRuntimePresentation;
}
