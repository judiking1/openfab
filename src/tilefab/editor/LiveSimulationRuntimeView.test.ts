import { describe, expect, it, vi } from "vitest";
import {
	LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
	simulationRuntimePoseFingerprint,
} from "../render/SimulationRuntimePresentation";
import type { DeterministicScenarioRuntimePublication } from "../simulation/DeterministicScenarioRuntimePublisher";
import type { LiveSimulationActiveRunOwnerState } from "./LiveSimulationActiveRunOwner";
import {
	LiveSimulationRuntimeView,
	type LiveSimulationRuntimeViewSource,
} from "./LiveSimulationRuntimeView";

class ControlledSource implements LiveSimulationRuntimeViewSource {
	private readonly listeners = new Set<() => void>();
	state: LiveSimulationActiveRunOwnerState = { phase: "IDLE", generation: 0 };

	getState(): LiveSimulationActiveRunOwnerState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	publish(state: LiveSimulationActiveRunOwnerState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

describe("LiveSimulationRuntimeView", () => {
	it("publishes only a matching bounded active-run publication", () => {
		const source = new ControlledSource();
		const publication = runtimePublication(1, "run-1");
		source.state = activeState(1, publication);
		const view = new LiveSimulationRuntimeView(source);

		expect(view.getState()).toEqual({
			phase: "READY",
			snapshot: {
				policy: LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
				activeRunGeneration: 1,
				projectId: "PROJECT-VIEW-1",
				sourceKind: "TRANSFER_PLAN",
				readinessProfileId: "OPENFAB_UNLAUNCHED_TRANSFER_TOKEN_READINESS_V1",
				runIdentityFingerprint: "run-1",
				poseFingerprint: simulationRuntimePoseFingerprint(publication),
				publication,
			},
		});
		expect(Object.isFrozen(view.getSnapshot())).toBe(true);
	});

	it("deduplicates speed-only owner updates and publishes each new sequence once", () => {
		const source = new ControlledSource();
		const first = runtimePublication(1, "run-1");
		source.state = activeState(1, first);
		const view = new LiveSimulationRuntimeView(source);
		const listener = vi.fn();
		view.subscribe(listener);

		source.publish({ ...activeState(1, first), speedMultiplier: 64 });
		expect(listener).not.toHaveBeenCalled();
		const second = runtimePublication(2, "run-1");
		source.publish({ ...activeState(1, second), speedMultiplier: 64 });
		expect(listener).toHaveBeenCalledOnce();
		expect(view.getSnapshot()?.publication).toBe(second);
	});

	it("clears its current reference on Stop and fails closed on identity mismatch", () => {
		const source = new ControlledSource();
		source.state = activeState(2, runtimePublication(3, "run-2"));
		const view = new LiveSimulationRuntimeView(source);
		source.publish({ phase: "STOPPED", generation: 2, reason: "AUTHORED_MUTATION" });
		expect(view.getSnapshot()).toBeNull();
		expect(view.getState()).toEqual({
			phase: "EMPTY",
			activeRunGeneration: 2,
			reason: "ACTIVE_RUN_STOPPED",
		});

		source.publish(activeState(3, runtimePublication(1, "wrong-run")));
		expect(view.getState()).toEqual({
			phase: "FAILED",
			activeRunGeneration: 3,
			message: "Active runtime publication does not match its run identity.",
		});
	});

	it("unsubscribes and drops its retained view state on dispose", () => {
		const source = new ControlledSource();
		source.state = activeState(1, runtimePublication(1, "run-1"));
		const view = new LiveSimulationRuntimeView(source);
		expect(source.listenerCount).toBe(1);

		view.dispose();
		view.dispose();
		expect(source.listenerCount).toBe(0);
		expect(view.getSnapshot()).toBeNull();
		expect(() => view.subscribe(vi.fn())).toThrow(/disposed/i);
	});
});

function activeState(
	generation: number,
	publication: DeterministicScenarioRuntimePublication,
): Extract<LiveSimulationActiveRunOwnerState, { phase: "ACTIVE" }> {
	return {
		phase: "ACTIVE",
		generation,
		projectId: "PROJECT-VIEW-1",
		sourceKind: "TRANSFER_PLAN",
		authorizationFingerprint: "authorization",
		readinessProfileId: "OPENFAB_UNLAUNCHED_TRANSFER_TOKEN_READINESS_V1",
		limitations: [
			"UNLAUNCHED_TRANSFER_TOKENS_ONLY",
			"NO_RESIDENT_FLEET",
			"NO_IDLE_TRACK_PARKING",
			"NO_MID_ROUTE_REPLAN",
		],
		runIdentityFingerprint: `run-${generation}`,
		requestCount: 1,
		loadCount: 1,
		eqResourceCount: 0,
		storageResourceCount: 1,
		speedMultiplier: 1,
		sampledSimulationTimeMicroseconds: publication.sampledSimulationTimeMicroseconds,
		completed: false,
		latestPublication: publication,
	};
}

function runtimePublication(
	sequence: number,
	runIdentityFingerprint: string,
): DeterministicScenarioRuntimePublication {
	return {
		sequence,
		runIdentityFingerprint,
		poseOrderPolicy: "IN_TRANSIT_REQUEST_ROW_ASCENDING_V1",
		resourceExecutionPrepared: true,
		sampledSimulationTimeMicroseconds: sequence * 100_000,
		publishedPoseCount: 0,
		posesTruncated: false,
		poseRequestRows: new Uint32Array(),
		poseVehicleTokenIds: new Uint32Array(),
		poseSourcePortIds: new Uint32Array(),
		poseDestinationPortIds: new Uint32Array(),
		posePathRows: new Uint32Array(),
		poseRouteDistancesMeters: new Float64Array(),
		poseAnchorDistancesMeters: new Float64Array(),
		posePathStationsMeters: new Float64Array(),
		poseWorldXMeters: new Float64Array(),
		poseWorldZMeters: new Float64Array(),
		poseTangentX: new Float64Array(),
		poseTangentZ: new Float64Array(),
		poseYawRadians: new Float64Array(),
	} as DeterministicScenarioRuntimePublication;
}
