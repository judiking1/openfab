import { describe, expect, it } from "vitest";
import type { DeterministicResidentRuntimePublication } from "../simulation/DeterministicResidentRuntimePublisher";
import type { DeterministicScenarioRuntimePublication } from "../simulation/DeterministicScenarioRuntimePublisher";
import {
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	simulationResidentRuntimePoseFingerprint,
	simulationRuntimePoseFingerprint,
	simulationRuntimePresentationMatchesPublication,
} from "./SimulationRuntimePresentation";

describe("simulation runtime pose presentation identity", () => {
	it("changes only when the bounded moving-pose prefix changes", () => {
		const first = publicationWithWorldX(1, 2.5);
		const nextSequence = {
			...first,
			sequence: 2,
			sampledSimulationTimeMicroseconds: 200_000,
		} as DeterministicScenarioRuntimePublication;
		const moved = publicationWithWorldX(2, 3.5);

		expect(simulationRuntimePoseFingerprint(first)).toBe(
			simulationRuntimePoseFingerprint(nextSequence),
		);
		expect(simulationRuntimePoseFingerprint(moved)).not.toBe(
			simulationRuntimePoseFingerprint(first),
		);
	});

	it("fails closed for a malformed or unbounded pose prefix", () => {
		const malformed = publicationWithWorldX(1, 2.5);
		Object.defineProperty(malformed, "poseWorldXMeters", { value: new Float64Array() });

		expect(simulationRuntimePoseFingerprint(malformed)).toBeNull();
	});

	it("keeps resident vehicle-row pose identity separate and ignores cadence-only changes", () => {
		const first = residentPublicationWithWorldX(1, 2.5);
		const nextSequence = {
			...first,
			sequence: 2,
			sampledSimulationTimeMicroseconds: 200_000,
		} as DeterministicResidentRuntimePublication;
		const moved = residentPublicationWithWorldX(2, 3.5);

		expect(simulationResidentRuntimePoseFingerprint(first)).toBe(
			simulationResidentRuntimePoseFingerprint(nextSequence),
		);
		expect(simulationResidentRuntimePoseFingerprint(moved)).not.toBe(
			simulationResidentRuntimePoseFingerprint(first),
		);
		const presentation = {
			policy: RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
			activeRunGeneration: 1,
			projectId: "PROJECT-RESIDENT-POSE-1",
			sourceKind: "TRANSFER_PLAN" as const,
			readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
			authorizationFingerprint: "resident-authorization",
			certificateFingerprint: "resident-certificate",
			poseFingerprint: simulationResidentRuntimePoseFingerprint(first) as string,
			publication: first,
		};
		expect(simulationRuntimePresentationMatchesPublication(presentation)).toBe(true);
		expect(
			simulationRuntimePresentationMatchesPublication({
				...presentation,
				authorizationFingerprint: "foreign-authorization",
			}),
		).toBe(false);
	});
});

function publicationWithWorldX(
	sequence: number,
	worldX: number,
): DeterministicScenarioRuntimePublication {
	return {
		sequence,
		poseOrderPolicy: "IN_TRANSIT_REQUEST_ROW_ASCENDING_V1",
		runIdentityFingerprint: "PUBLIC-MOVING-POSE-RUN",
		resourceExecutionPrepared: true,
		sampledSimulationTimeMicroseconds: sequence * 100_000,
		publishedPoseCount: 1,
		posesTruncated: false,
		poseRequestRows: Uint32Array.of(0),
		poseVehicleTokenIds: Uint32Array.of(1),
		poseSourcePortIds: Uint32Array.of(1),
		poseDestinationPortIds: Uint32Array.of(2),
		posePathRows: Uint32Array.of(0),
		poseRouteDistancesMeters: Float64Array.of(10),
		poseAnchorDistancesMeters: Float64Array.of(worldX),
		posePathStationsMeters: Float64Array.of(worldX),
		poseWorldXMeters: Float64Array.of(worldX),
		poseWorldZMeters: Float64Array.of(4),
		poseTangentX: Float64Array.of(1),
		poseTangentZ: Float64Array.of(0),
		poseYawRadians: Float64Array.of(0),
	} as DeterministicScenarioRuntimePublication;
}

function residentPublicationWithWorldX(
	sequence: number,
	worldX: number,
): DeterministicResidentRuntimePublication {
	return {
		sequence,
		poseOrderPolicy: "PERSISTED_HOME_SLOT_VEHICLE_ROW_ASCENDING_V1",
		sourceAuthorizationFingerprint: "resident-authorization",
		sourceCertificateFingerprint: "resident-certificate",
		sampledSimulationTimeMicroseconds: sequence * 100_000,
		maximumPoseCount: 8,
		publishedPoseCount: 1,
		posesTruncated: false,
		poseVehicleRows: Uint32Array.of(0),
		poseRequestRows: Int32Array.of(0),
		poseVehiclePhaseCodes: Uint8Array.of(1),
		poseLegIndices: Int8Array.of(0),
		poseSourcePortIds: Uint32Array.of(1),
		poseDestinationPortIds: Uint32Array.of(2),
		posePathRows: Uint32Array.of(0),
		poseLegDistancesMeters: Float64Array.of(10),
		poseLegAnchorDistancesMeters: Float64Array.of(worldX),
		poseCycleDistancesMeters: Float64Array.of(30),
		poseCycleAnchorDistancesMeters: Float64Array.of(worldX),
		posePathStationsMeters: Float64Array.of(worldX),
		poseWorldXMeters: Float64Array.of(worldX),
		poseWorldZMeters: Float64Array.of(4),
		poseTangentX: Float64Array.of(1),
		poseTangentZ: Float64Array.of(0),
		poseYawRadians: Float64Array.of(0),
	} as DeterministicResidentRuntimePublication;
}
