import { describe, expect, it } from "vitest";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import {
	consumeSimulationResidentRunAuthorization,
	issueSimulationResidentRunAuthorization,
} from "../compile/SimulationResidentRunAuthorization";
import {
	adoptDeterministicResidentRuntimeState,
	type DeterministicResidentRuntimeState,
} from "./DeterministicResidentRuntimeState";
import { DeterministicResidentWorldPoseSampler } from "./DeterministicResidentWorldPoseSampler";

describe("DeterministicResidentWorldPoseSampler", () => {
	it("samples idle home, continuous first-leg motion, pickup boundary, and exact home return", async () => {
		const { snapshot, runtime } = await residentRuntime();
		const sampler = new DeterministicResidentWorldPoseSampler(snapshot, runtime);
		const initial = sampler.sampleVehicle(0);
		expect(initial).toMatchObject({
			vehicleRow: 0,
			currentRequestRow: null,
			vehiclePhase: "IDLE_AT_HOME",
			legIndex: null,
			sourcePortId: snapshot.routes.homePortIds[0],
			destinationPortId: snapshot.routes.homePortIds[0],
		});
		expect(Math.hypot(initial.tangentX, initial.tangentZ)).toBeCloseTo(1, 8);

		const [toPickup, toDropoff, toHome] = legDurations(snapshot, 0);
		runtime.advanceSimulationToTimeMicroseconds(0);
		const departure = sampler.sampleVehicle(0);
		expect(departure).toMatchObject({
			currentRequestRow: 0,
			vehiclePhase: "TO_PICKUP",
			legIndex: 0,
			legAnchorDistanceMeters: 0,
		});
		expectSpatialPose(departure, initial);

		runtime.advanceSimulationToTimeMicroseconds(Math.floor(toPickup / 2));
		const moving = sampler.sampleVehicle(0);
		expect(moving.legAnchorDistanceMeters).toBeGreaterThan(0);
		expect(moving.legAnchorDistanceMeters).toBeLessThan(moving.legDistanceMeters);
		expect(moving.cycleAnchorDistanceMeters).toBe(moving.legAnchorDistanceMeters);
		expect(Math.hypot(moving.tangentX, moving.tangentZ)).toBeCloseTo(1, 8);

		runtime.advanceSimulationToTimeMicroseconds(toPickup);
		const pickup = sampler.sampleVehicle(0);
		const pickupStationRow = [...snapshot.foundation.stations.ids].indexOf(
			snapshot.routes.pickupPortIds[0] as number,
		);
		expect(pickup).toMatchObject({
			vehiclePhase: "TO_DROPOFF",
			legIndex: 1,
			sourcePortId: snapshot.routes.pickupPortIds[0],
			legAnchorDistanceMeters: 0,
			pathRow: snapshot.foundation.stations.finalPathIndices[pickupStationRow],
			pathStationMeters: snapshot.foundation.stations.finalPathStationsMeters[pickupStationRow],
		});

		runtime.advanceSimulationToTimeMicroseconds(toPickup + toDropoff + toHome);
		const returned = sampler.sampleVehicle(0);
		expect(returned).toMatchObject({
			currentRequestRow: null,
			vehiclePhase: "IDLE_AT_HOME",
			legIndex: null,
		});
		expectSpatialPose(returned, initial);
	});

	it("rejects a foreign authorized runtime and out-of-range vehicle row", async () => {
		const first = await residentRuntime();
		const foreign = await residentRuntime(3_000_000);

		expect(
			() => new DeterministicResidentWorldPoseSampler(first.snapshot, foreign.runtime),
		).toThrow(/do not match/i);
		const sampler = new DeterministicResidentWorldPoseSampler(first.snapshot, first.runtime);
		expect(() => sampler.sampleVehicle(1)).toThrow(/outside 1 rows/i);
	});
});

async function residentRuntime(processingDurationMicroseconds = 2_000_000): Promise<{
	snapshot: Awaited<ReturnType<typeof publishSimulationResidentReadinessSnapshot>>;
	runtime: DeterministicResidentRuntimeState;
}> {
	const sources = await buildSimulationResidentReadinessTestSources({
		timingInput: {
			eqProcessTimings: [{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds }],
		},
	});
	const snapshot = await publishSimulationResidentReadinessSnapshot(sources);
	const input = {
		projectId: "PROJECT-RESIDENT-POSE-1",
		preparationGeneration: 1,
		authorizationGeneration: 1,
		runAssetFingerprint: `resident-pose-${processingDurationMicroseconds}`,
		snapshot,
	};
	const grant = await issueSimulationResidentRunAuthorization(input);
	const runtime = await consumeSimulationResidentRunAuthorization(
		grant,
		input,
		(authorization, exactSnapshot, adoption) =>
			adoptDeterministicResidentRuntimeState(authorization, exactSnapshot, adoption),
	);
	if (!runtime) throw new Error("Expected resident runtime adoption for pose sampling.");
	return { snapshot, runtime };
}

function legDurations(
	snapshot: Awaited<ReturnType<typeof publishSimulationResidentReadinessSnapshot>>,
	requestRow: number,
): [number, number, number] {
	const speed = snapshot.occupancyPolicy.maximumSpeedMillimetersPerSecond;
	const duration = (legIndex: number): number =>
		Math.ceil(
			(Math.ceil((snapshot.routes.legDistancesMeters[requestRow * 3 + legIndex] as number) * 1e6) *
				1_000) /
				speed,
		);
	return [duration(0), duration(1), duration(2)];
}

function expectSpatialPose(
	actual: Readonly<{ worldXMeters: number; worldZMeters: number; yawRadians: number }>,
	expected: Readonly<{ worldXMeters: number; worldZMeters: number; yawRadians: number }>,
): void {
	expect(actual.worldXMeters).toBeCloseTo(expected.worldXMeters, 8);
	expect(actual.worldZMeters).toBeCloseTo(expected.worldZMeters, 8);
	expect(actual.yawRadians).toBeCloseTo(expected.yawRadians, 8);
}
