import { describe, expect, it, vi } from "vitest";
import { SIMULATION_RESIDENT_READINESS_LIMITATIONS } from "../compile/SimulationResidentReadinessCertificate";
import {
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	simulationResidentRuntimePoseFingerprint,
} from "../render/SimulationRuntimePresentation";
import type {
	DeterministicResidentActiveRunOwnerState,
	DeterministicResidentActiveRunStopReason,
} from "../simulation/DeterministicResidentActiveRunOwner";
import type { DeterministicResidentRuntimePublication } from "../simulation/DeterministicResidentRuntimePublisher";
import {
	ResidentSimulationRuntimeView,
	type ResidentSimulationRuntimeViewSource,
} from "./ResidentSimulationRuntimeView";

class ControlledResidentSource implements ResidentSimulationRuntimeViewSource {
	private readonly listeners = new Set<() => void>();
	state: DeterministicResidentActiveRunOwnerState = { phase: "IDLE", generation: 0 };

	getState(): DeterministicResidentActiveRunOwnerState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	publish(state: DeterministicResidentActiveRunOwnerState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

describe("ResidentSimulationRuntimeView", () => {
	it("publishes only the exact bounded resident authorization publication", () => {
		const source = new ControlledResidentSource();
		const publication = residentPublication(1, "authorization-1");
		source.state = activeState(1, publication);
		const view = new ResidentSimulationRuntimeView(source);

		expect(view.getState()).toEqual({
			phase: "READY",
			snapshot: {
				policy: RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
				activeRunGeneration: 1,
				projectId: "PROJECT-RESIDENT-VIEW-1",
				sourceKind: "TRANSFER_PLAN",
				readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
				authorizationFingerprint: "authorization-1",
				certificateFingerprint: "resident-certificate",
				poseFingerprint: simulationResidentRuntimePoseFingerprint(publication),
				publication,
			},
		});
		expect(Object.isFrozen(view.getSnapshot())).toBe(true);
	});

	it("deduplicates speed-only updates and publishes each resident publication reference once", () => {
		const source = new ControlledResidentSource();
		const first = residentPublication(1, "authorization-1");
		source.state = activeState(1, first);
		const view = new ResidentSimulationRuntimeView(source);
		const listener = vi.fn();
		view.subscribe(listener);

		source.publish({ ...activeState(1, first), speedMultiplier: 64 });
		expect(listener).not.toHaveBeenCalled();
		const second = residentPublication(2, "authorization-1");
		source.publish({ ...activeState(1, second), speedMultiplier: 64 });
		expect(listener).toHaveBeenCalledOnce();
		expect(view.getSnapshot()?.publication).toBe(second);
	});

	it("clears on every resident Stop reason and fails closed on identity mismatch", () => {
		const source = new ControlledResidentSource();
		source.state = activeState(2, residentPublication(3, "authorization-2"));
		const view = new ResidentSimulationRuntimeView(source);
		for (const reason of ["AUTHORED_MUTATION", "PROJECT_REPLACEMENT", "SOURCE_SWITCH"] as const) {
			source.publish(stoppedState(2, reason));
			expect(view.getSnapshot()).toBeNull();
			expect(view.getState()).toEqual({
				phase: "EMPTY",
				activeRunGeneration: 2,
				reason: "ACTIVE_RUN_STOPPED",
			});
			source.publish(activeState(2, residentPublication(3, "authorization-2")));
		}

		source.publish(activeState(3, residentPublication(1, "foreign-authorization")));
		expect(view.getState()).toEqual({
			phase: "FAILED",
			activeRunGeneration: 3,
			message: "Resident runtime publication does not match its authorization identity.",
		});
	});

	it("unsubscribes and drops the borrowed resident publication on dispose", () => {
		const source = new ControlledResidentSource();
		source.state = activeState(1, residentPublication(1, "authorization-1"));
		const view = new ResidentSimulationRuntimeView(source);
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
	publication: DeterministicResidentRuntimePublication,
): Extract<DeterministicResidentActiveRunOwnerState, { phase: "ACTIVE" }> {
	return {
		phase: "ACTIVE",
		generation,
		projectId: "PROJECT-RESIDENT-VIEW-1",
		sourceKind: "TRANSFER_PLAN",
		authorizationFingerprint: `authorization-${generation}`,
		readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
		limitations: SIMULATION_RESIDENT_READINESS_LIMITATIONS,
		requestCount: 1,
		loadCount: 1,
		vehicleCount: 1,
		eqResourceCount: 0,
		storageResourceCount: 1,
		speedMultiplier: 1,
		sampledSimulationTimeMicroseconds: publication.sampledSimulationTimeMicroseconds,
		completed: false,
		latestPublication: publication,
	};
}

function stoppedState(
	generation: number,
	reason: DeterministicResidentActiveRunStopReason,
): DeterministicResidentActiveRunOwnerState {
	return { phase: "STOPPED", generation, reason };
}

function residentPublication(
	sequence: number,
	authorizationFingerprint: string,
): DeterministicResidentRuntimePublication {
	return {
		sequence,
		poseOrderPolicy: "PERSISTED_HOME_SLOT_VEHICLE_ROW_ASCENDING_V1",
		sourceAuthorizationFingerprint: authorizationFingerprint,
		sourceCertificateFingerprint: "resident-certificate",
		sampledSimulationTimeMicroseconds: sequence * 100_000,
		maximumPoseCount: 8,
		publishedPoseCount: 0,
		posesTruncated: false,
		poseVehicleRows: new Uint32Array(),
		poseRequestRows: new Int32Array(),
		poseVehiclePhaseCodes: new Uint8Array(),
		poseLegIndices: new Int8Array(),
		poseSourcePortIds: new Uint32Array(),
		poseDestinationPortIds: new Uint32Array(),
		posePathRows: new Uint32Array(),
		poseLegDistancesMeters: new Float64Array(),
		poseLegAnchorDistancesMeters: new Float64Array(),
		poseCycleDistancesMeters: new Float64Array(),
		poseCycleAnchorDistancesMeters: new Float64Array(),
		posePathStationsMeters: new Float64Array(),
		poseWorldXMeters: new Float64Array(),
		poseWorldZMeters: new Float64Array(),
		poseTangentX: new Float64Array(),
		poseTangentZ: new Float64Array(),
		poseYawRadians: new Float64Array(),
	} as DeterministicResidentRuntimePublication;
}
