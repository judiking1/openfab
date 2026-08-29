import { describe, expect, it } from "vitest";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import { issueSimulationResidentRunAuthorization } from "../compile/SimulationResidentRunAuthorization";
import { DeterministicResidentActiveRunOwner } from "../simulation/DeterministicResidentActiveRunOwner";
import {
	DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE,
	DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE,
	type DeterministicResidentRuntimePublication,
} from "../simulation/DeterministicResidentRuntimePublisher";
import {
	SIMULATION_RESIDENT_RUNTIME_OUTCOME_PRESENTATION_POLICY,
	simulationResidentRuntimeOutcomePresentation,
} from "./SimulationResidentRuntimeOutcomePresentation";

describe("simulationResidentRuntimeOutcomePresentation", () => {
	it("projects fixed resident facts and copies named bounded event tails", () => {
		const publication = residentPublication();
		const presentation = simulationResidentRuntimeOutcomePresentation(publication);

		expect(presentation).toEqual({
			policy: SIMULATION_RESIDENT_RUNTIME_OUTCOME_PRESENTATION_POLICY,
			publicationSequence: 7,
			sampledSimulationTimeMicroseconds: 250_000,
			terminal: false,
			requests: {
				total: 2,
				waitingRelease: 0,
				waitingPredecessor: 0,
				waitingCycleLease: 0,
				toPickup: 0,
				toDropoff: 1,
				returningHome: 0,
				completed: 1,
			},
			service: { notArrived: 0, queued: 0, active: 1, ready: 1 },
			vehicles: { total: 2, idleAtHome: 1, waitingCycle: 0, moving: 1 },
			loadCount: 2,
			resources: {
				nonHomeTrackOwned: 3,
				switchConflictOwned: 1,
				storageOccupied: 2,
				storageReserved: 1,
			},
			poses: { eligible: 2, published: 2, truncated: false },
			coreEvents: {
				total: 2,
				truncated: false,
				rows: [
					{ sequence: 1, timeMicroseconds: 10, type: "REQUEST_RELEASED", requestRow: 0 },
					{ sequence: 2, timeMicroseconds: 20, type: "CYCLE_ADMITTED", requestRow: 0 },
				],
			},
			resourceEvents: {
				total: 2,
				truncated: false,
				rows: [
					{
						sequence: 1,
						timeMicroseconds: 30,
						type: "STORAGE_DESTINATION_RESERVED",
						requestRow: 0,
						resourceRow: 4,
					},
					{
						sequence: 2,
						timeMicroseconds: 40,
						type: "EQ_SERVICE_STARTED",
						requestRow: 1,
						resourceRow: 7,
					},
				],
			},
		});
		publication.coreEventTypeCodes[0] = 5;
		expect(presentation?.coreEvents.rows[0]?.type).toBe("REQUEST_RELEASED");
	});

	it("accepts only fully settled terminal resident facts", () => {
		const terminal = residentPublication();
		terminal.triggerCode = DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL;
		terminal.kpiValues = terminalValues();
		terminal.eligiblePoseCount = 2;
		terminal.publishedPoseCount = 2;

		expect(simulationResidentRuntimeOutcomePresentation(terminal)?.terminal).toBe(true);
		terminal.kpiValues[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.STORAGE_RESERVED - 1] = 1;
		expect(simulationResidentRuntimeOutcomePresentation(terminal)).toBeNull();
	});

	it("fails closed on KPI order, phase sums, or event-tail sequence drift", () => {
		const reordered = residentPublication();
		reordered.kpiCodes[0] = DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_COMPLETED;
		expect(simulationResidentRuntimeOutcomePresentation(reordered)).toBeNull();

		const inconsistent = residentPublication();
		inconsistent.kpiValues[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_COMPLETED - 1] = 0;
		expect(simulationResidentRuntimeOutcomePresentation(inconsistent)).toBeNull();

		const tailDrift = residentPublication();
		tailDrift.coreEventSequences[0] = 2;
		expect(simulationResidentRuntimeOutcomePresentation(tailDrift)).toBeNull();
	});

	it("discloses an exact eight-row tail when the full event stream is truncated", () => {
		const publication = residentPublication();
		publication.coreEventCount = 10;
		publication.publishedCoreEventCount = 8;
		publication.coreEventsTruncated = true;
		publication.coreEventSequences = Uint32Array.from({ length: 8 }, (_, row) => row + 3);
		publication.coreEventTimesMicroseconds = Float64Array.from({ length: 8 }, (_, row) => row + 10);
		publication.coreEventTypeCodes = new Uint8Array(8).fill(5);
		publication.coreEventRequestRows = new Uint32Array(8);
		publication.kpiValues[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.CORE_EVENT_COUNT - 1] = 10;

		const presentation = simulationResidentRuntimeOutcomePresentation(publication);
		expect(presentation?.coreEvents).toMatchObject({ total: 10, truncated: true });
		expect(presentation?.coreEvents.rows).toHaveLength(8);
		expect(presentation?.coreEvents.rows[0]?.sequence).toBe(3);
		expect(presentation?.coreEvents.rows[7]?.sequence).toBe(10);
	});

	it("projects the actual authorized runtime terminal EQ outcome", async () => {
		const snapshot = await publishSimulationResidentReadinessSnapshot(
			await buildSimulationResidentReadinessTestSources(),
		);
		const input = {
			projectId: "PROJECT-RESIDENT-OUTCOME-1",
			preparationGeneration: 1,
			authorizationGeneration: 1,
			runAssetFingerprint: "resident-outcome-asset-1",
			snapshot,
		};
		const owner = new DeterministicResidentActiveRunOwner({
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});
		await owner.start(await issueSimulationResidentRunAuthorization(input), input, 64);
		owner.advanceByWallClockMicroseconds(1_000_000_000);
		const state = owner.getState();
		if (state.phase !== "ACTIVE") throw new Error("Expected active terminal resident state.");

		const presentation = simulationResidentRuntimeOutcomePresentation(state.latestPublication);
		expect(state.completed).toBe(true);
		expect(presentation).toMatchObject({
			terminal: true,
			requests: { total: 1, completed: 1 },
			service: { ready: 1, active: 0, queued: 0 },
			vehicles: { total: 1, idleAtHome: 1, moving: 0 },
			resources: {
				nonHomeTrackOwned: 0,
				switchConflictOwned: 0,
				storageReserved: 0,
			},
		});
		expect(presentation?.resourceEvents.rows.map((event) => event.type)).toContain(
			"EQ_SERVICE_READY",
		);
		owner.dispose();
	});
});

function residentPublication(): MutableResidentPublication {
	return {
		sequence: 7,
		triggerCode: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
		sampledSimulationTimeMicroseconds: 250_000,
		maximumPoseCount: 8,
		eligiblePoseCount: 2,
		publishedPoseCount: 2,
		posesTruncated: false,
		kpiCodes: Uint8Array.from(Object.values(DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE)),
		kpiValues: Float64Array.from([
			2, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 2, 1, 0, 1, 2, 3, 1, 2, 1, 2, 2,
		]),
		coreEventCount: 2,
		publishedCoreEventCount: 2,
		coreEventsTruncated: false,
		coreEventSequences: Uint32Array.of(1, 2),
		coreEventTimesMicroseconds: Float64Array.of(10, 20),
		coreEventTypeCodes: Uint8Array.of(1, 2),
		coreEventRequestRows: Uint32Array.of(0, 0),
		resourceEventCount: 2,
		publishedResourceEventCount: 2,
		resourceEventsTruncated: false,
		resourceEventSequences: Uint32Array.of(1, 2),
		resourceEventTimesMicroseconds: Float64Array.of(30, 40),
		resourceEventTypeCodes: Uint8Array.of(1, 5),
		resourceEventRequestRows: Uint32Array.of(0, 1),
		resourceEventResourceRows: Uint32Array.of(4, 7),
	} as MutableResidentPublication;
}

function terminalValues(): Float64Array {
	return Float64Array.from([2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 0, 0, 2, 0, 0, 2, 0, 2, 2]);
}

type MutableResidentPublication = {
	-readonly [Key in keyof DeterministicResidentRuntimePublication]: DeterministicResidentRuntimePublication[Key];
};
