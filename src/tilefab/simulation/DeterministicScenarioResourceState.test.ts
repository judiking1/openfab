import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithMixedPorts } from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import {
	compileSimulationScenarioResourceRunConfiguration,
	type SimulationScenarioResourceRunConfigurationInput,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import {
	compileSimulationScenarioServiceTiming,
	type SimulationScenarioEqProcessTimingRecord,
} from "../compile/SimulationScenarioServiceTiming";
import {
	DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE,
	DeterministicScenarioResourceState,
} from "./DeterministicScenarioResourceState";

describe("DeterministicScenarioResourceState", () => {
	it("bounds storage reservations by certified occupancy, HWM, and capacity", async () => {
		const records = Array.from({ length: 4 }, (_, row) =>
			transfer(`STORE-${row}`, row, `LOAD-${row}`, 2, 1),
		);
		const prepared = await preparedFixture(records, [], storageOnlyInput(), 1);
		const state = resourceState(prepared);

		expect(state.storageState(0)).toMatchObject({
			equipmentGroupId: 1,
			occupiedUnits: 1,
			reservedUnits: 0,
			capacityUnits: 4,
			highWaterMarkUnits: 4,
		});
		expect(state.reserveDestinationForAdmission(0, 10)).toBe(true);
		expect(state.reserveDestinationForAdmission(1, 10)).toBe(true);
		expect(state.reserveDestinationForAdmission(2, 10)).toBe(true);
		expect(state.reserveDestinationForAdmission(3, 10)).toBe(false);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 1, reservedUnits: 3 });

		state.confirmSourcePickup(0, 10);
		state.confirmDestinationArrival(0, 20);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 2, reservedUnits: 2 });
		expect(state.loadStorageResourceRow(0)).toBe(0);
		expect(state.canReserveDestinationForAdmission(3)).toBe(false);

		state.cancelDestinationReservation(1, 21);
		expect(state.reserveDestinationForAdmission(3, 21)).toBe(true);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 2, reservedUnits: 2 });
		expect(eventTypes(state)).toEqual([
			"STORAGE_DESTINATION_RESERVED",
			"STORAGE_DESTINATION_RESERVED",
			"STORAGE_DESTINATION_RESERVED",
			"STORAGE_DESTINATION_OCCUPIED",
			"STORAGE_DESTINATION_RESERVATION_CANCELLED",
			"STORAGE_DESTINATION_RESERVED",
		]);
	});

	it("releases named source storage before queueing its EQ destination", async () => {
		const records = [transfer("PICKUP-STORAGE", 0, "LOAD-A", 1, 2)];
		const timings = [eqTiming(0, 200)];
		const prepared = await preparedFixture(
			records,
			timings,
			{
				eqResources: [alwaysEq(2, 1)],
				initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
			},
			1,
		);
		const state = resourceState(prepared);

		expect(state.loadStorageResourceRow(0)).toBe(0);
		state.confirmSourcePickup(0, 10);
		expect(state.storageState(0).occupiedUnits).toBe(0);
		expect(state.loadStorageResourceRow(0)).toBeNull();
		state.confirmDestinationArrival(0, 20);
		expect(state.eqServiceState(0)).toMatchObject({
			phaseCode: DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.QUEUED,
			queuedAtMicroseconds: 20,
		});
		state.advanceToTimeMicroseconds(20);
		expect(state.eqServiceState(0)).toMatchObject({
			phaseCode: DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.ACTIVE,
			startedAtMicroseconds: 20,
			readyAtMicroseconds: null,
		});
		state.advanceToTimeMicroseconds(220);
		expect(state.eqServiceState(0)).toMatchObject({
			phaseCode: DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.READY,
			readyAtMicroseconds: 220,
		});
	});

	it("reuses a full same-group source unit without double-counting its destination reservation", async () => {
		const records = [transfer("SAME-STORAGE", 0, "LOAD-SAME", 4, 5)];
		const prepared = await preparedFixture(
			records,
			[],
			{
				eqResources: [],
				initialStorageLoads: [{ loadId: "LOAD-SAME", equipmentGroupId: 3 }],
			},
			8,
		);
		const state = resourceState(prepared);

		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 8, reservedUnits: 0 });
		expect(state.reserveDestinationForAdmission(0, 10)).toBe(true);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 8, reservedUnits: 0 });
		expect(state.confirmSourcePickup(0, 11)).toEqual([]);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 7, reservedUnits: 1 });
		state.confirmDestinationArrival(0, 20);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 8, reservedUnits: 0 });
	});

	it("rejects an out-of-profile sixth resource event before mutating storage custody", async () => {
		const prepared = await preparedFixture(
			[transfer("BOUNDED-RESOURCE-EVENTS", 0, "LOAD-A", 2, 1)],
			[],
			storageOnlyInput(),
			1,
		);
		const state = resourceState(prepared);

		state.reserveDestinationForAdmission(0, 10);
		state.cancelDestinationReservation(0, 10);
		state.reserveDestinationForAdmission(0, 10);
		state.cancelDestinationReservation(0, 10);
		state.reserveDestinationForAdmission(0, 10);
		expect(state.eventCount).toBe(5);
		expect(state.storageState(0).reservedUnits).toBe(1);

		expect(() => state.cancelDestinationReservation(0, 10)).toThrow(/event budget/);
		expect(state.eventCount).toBe(5);
		expect(state.destinationStorageReservationRow(0)).toBe(0);
		expect(state.storageState(0).reservedUnits).toBe(1);
	});

	it("returns only the oldest capacity-blocked storage admission after one source unit is freed", async () => {
		const records = [
			transfer("STORAGE-SOURCE", 0, "LOAD-SOURCE", 1, 2),
			...Array.from({ length: 4 }, (_, index) =>
				transfer(`STORAGE-WAITER-${index}`, index + 1, `LOAD-WAITER-${index}`, 2, 1),
			),
		];
		const prepared = await preparedFixture(
			records,
			[eqTiming(0, 1)],
			{
				eqResources: [alwaysEq(2, 1)],
				initialStorageLoads: [{ loadId: "LOAD-SOURCE", equipmentGroupId: 1 }],
			},
			1,
		);
		const state = resourceState(prepared);

		expect(state.reserveDestinationForAdmission(1, 10)).toBe(true);
		expect(state.reserveDestinationForAdmission(2, 10)).toBe(true);
		expect(state.reserveDestinationForAdmission(3, 10)).toBe(true);
		expect(state.reserveDestinationForAdmission(4, 10)).toBe(false);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 1, reservedUnits: 3 });

		expect(state.confirmSourcePickup(0, 11)).toEqual([4]);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 0, reservedUnits: 3 });
		expect(state.reserveDestinationForAdmission(4, 11)).toBe(true);
		expect(state.storageState(0)).toMatchObject({ occupiedUnits: 0, reservedUnits: 4 });
	});

	it("starts a canonical non-preemptive EQ queue only inside a full availability window", async () => {
		const records = Array.from({ length: 3 }, (_, row) =>
			transfer(`EQ-${row}`, row, `LOAD-${row}`, 3, 2),
		);
		const timings = records.map((record) => eqTiming(record.sourceOrdinal, 200));
		const prepared = await preparedFixture(records, timings, {
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 2,
					availabilityMode: "WINDOWS",
					availabilityWindows: [{ startMicroseconds: 100, endMicroseconds: 1_000 }],
				},
			],
			initialStorageLoads: [],
		});
		const state = resourceState(prepared);
		expect(state.eqWaitQueueRetainedByteCapacity).toBe(24);
		expect(state.eqCompletionHeapRetainedByteCapacity).toBe(32);

		state.confirmDestinationArrival(1, 10);
		state.confirmDestinationArrival(0, 10);
		state.confirmDestinationArrival(2, 20);
		expect(state.nextScheduledTransitionTimeMicroseconds).toBe(100);
		state.advanceToTimeMicroseconds(99);
		expect(state.eqServiceState(0).phaseCode).toBe(DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.QUEUED);

		state.advanceToTimeMicroseconds(100);
		expect(state.eqServiceState(0).startedAtMicroseconds).toBe(100);
		expect(state.eqServiceState(1).startedAtMicroseconds).toBe(100);
		expect(state.eqServiceState(2).phaseCode).toBe(DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.QUEUED);
		state.advanceToTimeMicroseconds(300);
		expect(state.eqServiceState(0).readyAtMicroseconds).toBe(300);
		expect(state.eqServiceState(1).readyAtMicroseconds).toBe(300);
		expect(state.eqServiceState(2).startedAtMicroseconds).toBe(300);
		state.advanceToTimeMicroseconds(500);
		expect(state.eqServiceState(2).readyAtMicroseconds).toBe(500);
		expect(eventTypes(state).filter((type) => type === "EQ_SERVICE_STARTED")).toHaveLength(3);
		expect(
			Array.from({ length: state.eventCount }, (_, index) => state.eventAt(index))
				.filter((event) => event.type === "EQ_SERVICE_STARTED")
				.map((event) => event.requestRow),
		).toEqual([0, 1, 2]);
	});

	it("leaves a service queued when no availability window can contain its duration", async () => {
		const records = [transfer("NO-WINDOW", 0, "LOAD-A", 3, 2)];
		const prepared = await preparedFixture(records, [eqTiming(0, 200)], {
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 1,
					availabilityMode: "WINDOWS",
					availabilityWindows: [{ startMicroseconds: 100, endMicroseconds: 250 }],
				},
			],
			initialStorageLoads: [],
		});
		const state = resourceState(prepared);

		state.confirmDestinationArrival(0, 10);
		expect(state.nextScheduledTransitionTimeMicroseconds).toBe(Number.POSITIVE_INFINITY);
		state.advanceToTimeMicroseconds(1_000);
		expect(state.eqServiceState(0).phaseCode).toBe(DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.QUEUED);
	});

	it("fails closed for arrival without reservation and foreign prepared sources", async () => {
		const records = [transfer("INVALID", 0, "LOAD-A", 2, 1)];
		const prepared = await preparedFixture(records, [], storageOnlyInput(), 1);
		const state = resourceState(prepared);

		expect(() => state.confirmDestinationArrival(0, 10)).toThrow(
			/no destination storage reservation/i,
		);
		expect(() => state.reserveDestinationForAdmission(-1, 10)).toThrow(/request row/i);
		expect(() => state.advanceToTimeMicroseconds(-1)).toThrow(/monotonic/i);

		const foreignSnapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 1),
		);
		const foreignPrepared = { ...prepared, snapshot: foreignSnapshot };
		expect(() => resourceState(foreignPrepared)).not.toThrow();
		const shiftedSnapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(2_000, 1),
		);
		expect(() => resourceState({ ...prepared, snapshot: shiftedSnapshot })).toThrow(
			/sources are inconsistent/i,
		);
	});
});

function resourceState(prepared: Awaited<ReturnType<typeof preparedFixture>>) {
	return new DeterministicScenarioResourceState(
		prepared.snapshot,
		prepared.routes,
		prepared.program,
		prepared.timing,
		prepared.configuration,
	);
}

async function preparedFixture(
	records: readonly SimulationTransferPlanRecord[],
	eqProcessTimings: readonly SimulationScenarioEqProcessTimingRecord[],
	resourceInput: SimulationScenarioResourceRunConfigurationInput,
	storageInitialOccupiedUnits = 0,
) {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(1_500, storageInitialOccupiedUnits),
	);
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "RESOURCE-STATE-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: records.length,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records,
	});
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const program = compileSimulationScenarioAdmissionProgram(snapshot, manifest, routes, claims);
	const timing = compileSimulationScenarioServiceTiming(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		{ eqProcessTimings },
	);
	const configuration = compileSimulationScenarioResourceRunConfiguration(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		timing,
		resourceInput,
	);
	return { snapshot, routes, program, timing, configuration };
}

function storageOnlyInput(): SimulationScenarioResourceRunConfigurationInput {
	return { eqResources: [], initialStorageLoads: [] };
}

function alwaysEq(equipmentGroupId: number, concurrentCapacity: number) {
	return {
		equipmentGroupId,
		concurrentCapacity,
		availabilityMode: "ALWAYS" as const,
		availabilityWindows: [],
	};
}

function eqTiming(
	sourceOrdinal: number,
	processingDurationMicroseconds: number,
): SimulationScenarioEqProcessTimingRecord {
	return { sourceOrdinal, capabilityId: 1, processingDurationMicroseconds };
}

function transfer(
	transferId: string,
	sourceOrdinal: number,
	loadId: string,
	sourcePortId: number,
	destinationPortId: number,
): SimulationTransferPlanRecord {
	return {
		transferId,
		sourceOrdinal,
		releaseTimeMicroseconds: 10,
		loadId,
		sourcePortId,
		destinationPortId,
	};
}

function eventTypes(state: DeterministicScenarioResourceState): string[] {
	return Array.from({ length: state.eventCount }, (_, index) => state.eventAt(index).type);
}
