import { describe, expect, it } from "vitest";
import {
	DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE,
	DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE,
	type DeterministicScenarioRuntimePublication,
} from "../simulation/DeterministicScenarioRuntimePublisher";
import {
	SIMULATION_RUNTIME_KPI_PRESENTATION_POLICY,
	simulationRuntimeKpiPresentation,
} from "./SimulationRuntimeKpiPresentation";

describe("simulationRuntimeKpiPresentation", () => {
	it("projects the fixed aggregate row without retaining mutable KPI columns", () => {
		const publication = publicationWithValues([
			4, 1, 0, 0, 1, 1, 1, 2, 1, 1, 12, 6, 2, 1, 0, 0, 1, 1, 3, 1,
		]);

		expect(simulationRuntimeKpiPresentation(publication)).toEqual({
			policy: SIMULATION_RUNTIME_KPI_PRESENTATION_POLICY,
			publicationSequence: 7,
			sampledSimulationTimeMicroseconds: 250_000,
			terminal: false,
			requests: {
				total: 4,
				waitingRelease: 1,
				waitingDependency: 0,
				waitingLease: 0,
				admitted: 1,
				inTransit: 1,
				completed: 1,
				queued: 1,
			},
			destinationService: { notStarted: 2, inService: 1, ready: 1 },
			events: { core: 12, resource: 6 },
			eq: { destinationRequests: 2, notArrived: 1, queued: 0, active: 0, ready: 1 },
			storage: { resourceCount: 1, occupiedUnits: 3, reservedUnits: 1 },
			poses: { eligible: 1, published: 1, truncated: false },
		});
	});

	it("recognizes only a fully completed terminal aggregate", () => {
		const publication = publicationWithValues(
			[2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 8, 4, 1, 0, 0, 0, 1, 1, 2, 0],
			DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL,
		);
		publication.eligiblePoseCount = 0;
		publication.publishedPoseCount = 0;

		expect(simulationRuntimeKpiPresentation(publication)?.terminal).toBe(true);
	});

	it("fails closed when the fixed KPI code order or aggregate relationships drift", () => {
		const reordered = publicationWithValues([
			4, 1, 0, 0, 1, 1, 1, 2, 1, 1, 12, 6, 2, 1, 0, 0, 1, 1, 3, 1,
		]);
		reordered.kpiCodes[0] = DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_COMPLETED;
		expect(simulationRuntimeKpiPresentation(reordered)).toBeNull();

		const inconsistent = publicationWithValues([
			4, 1, 0, 0, 1, 1, 0, 2, 1, 1, 12, 6, 2, 1, 0, 0, 1, 1, 3, 1,
		]);
		expect(simulationRuntimeKpiPresentation(inconsistent)).toBeNull();
	});

	it("fails closed for an unprepared, unknown-trigger, or over-budget publication", () => {
		const values = [4, 1, 0, 0, 1, 1, 1, 2, 1, 1, 12, 6, 2, 1, 0, 0, 1, 1, 3, 1];
		const unprepared = publicationWithValues(values);
		unprepared.resourceExecutionPrepared = false;
		expect(simulationRuntimeKpiPresentation(unprepared)).toBeNull();

		const unknownTrigger = publicationWithValues(values);
		unknownTrigger.triggerCode = 255;
		expect(simulationRuntimeKpiPresentation(unknownTrigger)).toBeNull();

		const overBudget = publicationWithValues(values);
		overBudget.maximumPoseCount = 0;
		expect(simulationRuntimeKpiPresentation(overBudget)).toBeNull();
	});
});

function publicationWithValues(
	values: readonly number[],
	triggerCode: number = DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
): MutablePublication {
	return {
		sequence: 7,
		triggerCode,
		resourceExecutionPrepared: true,
		sampledSimulationTimeMicroseconds: 250_000,
		maximumPoseCount: 8,
		eligiblePoseCount: 1,
		publishedPoseCount: 1,
		posesTruncated: false,
		kpiCount: values.length,
		kpiCodes: Uint8Array.from(Object.values(DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE)),
		kpiValues: Float64Array.from(values),
	} as MutablePublication;
}

type MutablePublication = {
	-readonly [Key in keyof DeterministicScenarioRuntimePublication]: DeterministicScenarioRuntimePublication[Key];
};
