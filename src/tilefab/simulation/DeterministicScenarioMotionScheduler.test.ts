import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponentsWithEqPorts,
	buildSimulationReadinessTestComponentsWithMixedPorts,
} from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import { compileSimulationScenarioResourceRunConfiguration } from "../compile/SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import { compileSimulationScenarioServiceTiming } from "../compile/SimulationScenarioServiceTiming";
import {
	DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	DeterministicScenarioMotionScheduler,
} from "./DeterministicScenarioMotionScheduler";

describe("DeterministicScenarioMotionScheduler", () => {
	it("automatically picks up, advances constant-speed anchor distance, and completes", async () => {
		const scheduler = await schedulerFixture([transfer("MOTION", 0, 10, "LOAD-MOTION", 2, 1)]);

		expect(scheduler.advanceSimulationToTimeMicroseconds(10)).toBe(2);
		expect(scheduler.eventAt(0).type).toBe("VEHICLE_TOKEN_ADMITTED");
		expect(scheduler.eventAt(1).type).toBe("FOUP_PICKED_UP");
		const started = scheduler.motionState(0);
		expect(started).toMatchObject({
			moving: true,
			anchorDistanceMeters: 0,
			pickupTimeMicroseconds: 10,
		});
		const completionTime = started.scheduledCompletionTimeMicroseconds as number;
		const halfway = Math.floor((10 + completionTime) / 2);
		scheduler.advanceSimulationToTimeMicroseconds(halfway);
		const middle = scheduler.motionState(0);
		expect(middle.anchorDistanceMeters).toBeGreaterThan(0);
		expect(middle.anchorDistanceMeters).toBeLessThan(middle.routeDistanceMeters);

		scheduler.advanceSimulationToTimeMicroseconds(completionTime);
		expect(scheduler.eventAt(2)).toMatchObject({
			type: "TRANSFER_COMPLETED",
			timeMicroseconds: completionTime,
		});
		expect(scheduler.motionState(0)).toMatchObject({
			moving: false,
			anchorDistanceMeters: middle.routeDistanceMeters,
		});
		expect(scheduler.worldPose(0)).toMatchObject({
			requestRow: 0,
			anchorDistanceMeters: middle.routeDistanceMeters,
		});
		expect(scheduler.allRequestsCompleted).toBe(true);
	});

	it.each(
		DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	)("derives the same in-flight world pose at %ix wall-clock acceleration", async (multiplier) => {
		const record = transfer("POSE-SPEED", 0, 10, "LOAD-POSE", 2, 1);
		const reference = await schedulerFixture([record]);
		const accelerated = await schedulerFixture([record]);
		const targetSimulationTime = 1_000_000;

		reference.advanceSimulationToTimeMicroseconds(targetSimulationTime);
		accelerated.advanceByWallClockMicroseconds(targetSimulationTime / multiplier, multiplier);

		expect(reference.motionState(0).moving).toBe(true);
		expect(accelerated.currentTimeMicroseconds).toBe(targetSimulationTime);
		expect(accelerated.worldPose(0)).toEqual(reference.worldPose(0));
	});

	it("serializes conflicting whole-route transfers without changing physical duration", async () => {
		const scheduler = await schedulerFixture([
			transfer("SERIAL-1", 0, 10, "LOAD-A", 2, 1),
			transfer("SERIAL-2", 1, 10, "LOAD-B", 2, 1),
		]);
		scheduler.advanceSimulationToTimeMicroseconds(10);
		const firstCompletion = scheduler.motionState(0).scheduledCompletionTimeMicroseconds as number;
		expect(scheduler.requestState(1).phase).toBe("WAITING_LEASE");

		scheduler.advanceSimulationToTimeMicroseconds(firstCompletion);
		expect(scheduler.eventAt(2).type).toBe("TRANSFER_COMPLETED");
		expect(scheduler.eventAt(3)).toMatchObject({
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 1,
			timeMicroseconds: firstCompletion,
		});
		expect(scheduler.eventAt(4)).toMatchObject({
			type: "FOUP_PICKED_UP",
			requestRow: 1,
			timeMicroseconds: firstCompletion,
		});
		const second = scheduler.motionState(1);
		expect(
			(second.scheduledCompletionTimeMicroseconds as number) -
				(second.pickupTimeMicroseconds as number),
		).toBe(firstCompletion - 10);
	});

	it("drops custody and releases transport before delaying a chained leg for destination service", async () => {
		const scheduler = await serviceSchedulerFixture();
		scheduler.advanceSimulationToTimeMicroseconds(10);
		const firstCompletion = scheduler.motionState(0).scheduledCompletionTimeMicroseconds as number;

		scheduler.advanceSimulationToTimeMicroseconds(firstCompletion);
		const serviceReady = firstCompletion + 1_500_000;
		expect(scheduler.requestState(0).phase).toBe("COMPLETED");
		expect(scheduler.requestState(1).phase).toBe("WAITING_DEPENDENCY");
		expect(scheduler.loadCustody(0)).toMatchObject({ kind: "STATION" });
		expect(scheduler.destinationServiceState(0)).toEqual({
			requestRow: 0,
			phase: "IN_SERVICE",
			startedAtMicroseconds: firstCompletion,
			readyAtMicroseconds: serviceReady,
		});

		scheduler.advanceSimulationToTimeMicroseconds(serviceReady - 1);
		expect(scheduler.requestState(1).phase).toBe("WAITING_DEPENDENCY");
		scheduler.advanceSimulationToTimeMicroseconds(serviceReady);
		expect(scheduler.requestState(1).phase).toBe("IN_TRANSIT");
		const secondCompletion = scheduler.motionState(1).scheduledCompletionTimeMicroseconds as number;
		scheduler.advanceSimulationToTimeMicroseconds(secondCompletion);
		expect(scheduler.allRequestsCompleted).toBe(true);
		expect(scheduler.allScenarioWorkCompleted).toBe(false);
		scheduler.advanceSimulationToTimeMicroseconds(secondCompletion + 2_000_000);
		expect(scheduler.allDestinationServicesReady).toBe(true);
		expect(scheduler.allScenarioWorkCompleted).toBe(true);
	});

	it.each(
		DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	)("produces the same semantic event log at %ix wall-clock acceleration", async (multiplier) => {
		const records = [
			transfer("SPEED-1", 0, 10, "LOAD-A", 2, 1),
			transfer("SPEED-2", 1, 20, "LOAD-A", 1, 2),
		];
		const reference = await schedulerFixture(records);
		reference.advanceSimulationToTimeMicroseconds(64_000_000);
		const expected = eventLog(reference);
		const accelerated = await schedulerFixture(records);
		let remainingWallTime = 64_000_000 / multiplier;
		let chunkIndex = 0;
		while (remainingWallTime > 0) {
			const requestedChunk = 37_000 + ((chunkIndex * 17_003) % 91_000);
			const chunk = Math.min(remainingWallTime, requestedChunk);
			accelerated.advanceByWallClockMicroseconds(chunk, multiplier);
			remainingWallTime -= chunk;
			chunkIndex++;
		}

		expect(accelerated.currentTimeMicroseconds).toBe(64_000_000);
		expect(eventLog(accelerated)).toEqual(expected);
		expect(accelerated.allRequestsCompleted).toBe(true);
	});

	it.each(
		DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	)("keeps chained destination-service events invariant at %ix", async (multiplier) => {
		const reference = await serviceSchedulerFixture();
		reference.advanceSimulationToTimeMicroseconds(64_000_000);
		const expected = eventLog(reference);
		const accelerated = await serviceSchedulerFixture();
		let remainingWallTime = 64_000_000 / multiplier;
		let chunkIndex = 0;
		while (remainingWallTime > 0) {
			const requestedChunk = 41_000 + ((chunkIndex * 19_019) % 83_000);
			const chunk = Math.min(remainingWallTime, requestedChunk);
			accelerated.advanceByWallClockMicroseconds(chunk, multiplier);
			remainingWallTime -= chunk;
			chunkIndex++;
		}

		expect(eventLog(accelerated)).toEqual(expected);
		expect(accelerated.allScenarioWorkCompleted).toBe(true);
	});

	it("joins storage reservation, pickup release, and EQ capacity to transport execution", async () => {
		const scheduler = await resourceServiceSchedulerFixture();

		scheduler.advanceSimulationToTimeMicroseconds(10);
		expect(scheduler.destinationStorageReservationRow(0)).toBe(0);
		expect(scheduler.storageState(0)).toMatchObject({ occupiedUnits: 0, reservedUnits: 1 });
		const firstCompletion = scheduler.motionState(0).scheduledCompletionTimeMicroseconds as number;

		scheduler.advanceSimulationToTimeMicroseconds(firstCompletion);
		expect(scheduler.destinationStorageReservationRow(0)).toBeNull();
		expect(scheduler.storageState(0)).toMatchObject({ occupiedUnits: 1, reservedUnits: 0 });
		const firstServiceReady = scheduler.destinationServiceState(0).readyAtMicroseconds as number;

		scheduler.advanceSimulationToTimeMicroseconds(firstServiceReady);
		expect(scheduler.requestState(1).phase).toBe("IN_TRANSIT");
		expect(scheduler.storageState(0).occupiedUnits).toBe(0);
		expect(scheduler.loadStorageResourceRow(0)).toBeNull();
		const secondCompletion = scheduler.motionState(1).scheduledCompletionTimeMicroseconds as number;

		scheduler.advanceSimulationToTimeMicroseconds(secondCompletion);
		expect(scheduler.eqServiceState(1)).toMatchObject({
			phaseCode: 2,
			queuedAtMicroseconds: secondCompletion,
			startedAtMicroseconds: secondCompletion,
		});
		expect(scheduler.destinationServiceState(1)).toMatchObject({
			phase: "IN_SERVICE",
			startedAtMicroseconds: secondCompletion,
			readyAtMicroseconds: secondCompletion + 2_000_000,
		});

		scheduler.advanceSimulationToTimeMicroseconds(secondCompletion + 2_000_000);
		expect(scheduler.eqServiceState(1).phaseCode).toBe(3);
		expect(scheduler.allScenarioWorkCompleted).toBe(true);
		expect(resourceEventLog(scheduler).map((event) => event.type)).toEqual([
			"STORAGE_DESTINATION_RESERVED",
			"STORAGE_DESTINATION_OCCUPIED",
			"STORAGE_SOURCE_RELEASED",
			"EQ_SERVICE_QUEUED",
			"EQ_SERVICE_STARTED",
			"EQ_SERVICE_READY",
		]);
	});

	it("keeps EQ service deferred until an availability window can contain its full duration", async () => {
		const scheduler = await windowedEqSchedulerFixture();
		scheduler.advanceSimulationToTimeMicroseconds(10);
		const completion = scheduler.motionState(0).scheduledCompletionTimeMicroseconds as number;
		expect(completion).toBeLessThan(50_000_000);

		scheduler.advanceSimulationToTimeMicroseconds(completion);
		expect(scheduler.eqServiceState(0).phaseCode).toBe(1);
		expect(scheduler.destinationServiceState(0).phase).toBe("NOT_STARTED");
		scheduler.advanceSimulationToTimeMicroseconds(49_999_999);
		expect(scheduler.destinationServiceState(0).phase).toBe("NOT_STARTED");
		scheduler.advanceSimulationToTimeMicroseconds(50_000_000);
		expect(scheduler.destinationServiceState(0)).toMatchObject({
			phase: "IN_SERVICE",
			startedAtMicroseconds: 50_000_000,
			readyAtMicroseconds: 52_000_000,
		});
	});

	it.each(
		DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	)("keeps resource and transport events invariant at %ix", async (multiplier) => {
		const reference = await resourceServiceSchedulerFixture();
		reference.advanceSimulationToTimeMicroseconds(64_000_000);
		const expectedCoreEvents = eventLog(reference);
		const expectedResourceEvents = resourceEventLog(reference);
		const accelerated = await resourceServiceSchedulerFixture();
		let remainingWallTime = 64_000_000 / multiplier;
		while (remainingWallTime > 0) {
			const chunk = Math.min(remainingWallTime, 73_000);
			accelerated.advanceByWallClockMicroseconds(chunk, multiplier);
			remainingWallTime -= chunk;
		}

		expect(eventLog(accelerated)).toEqual(expectedCoreEvents);
		expect(resourceEventLog(accelerated)).toEqual(expectedResourceEvents);
		expect(accelerated.allScenarioWorkCompleted).toBe(true);
	});

	it("rejects unsupported speed, unsafe wall-time scaling, and backwards simulation time", async () => {
		const scheduler = await schedulerFixture([transfer("INVALID", 0, 10, "LOAD-INVALID", 2, 1)]);

		expect(() =>
			scheduler.advanceByWallClockMicroseconds(
				1,
				3 as (typeof DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS)[number],
			),
		).toThrow(/speed multiplier/i);
		expect(() => scheduler.advanceByWallClockMicroseconds(-1, 1)).toThrow(/non-negative/i);
		scheduler.advanceSimulationToTimeMicroseconds(20);
		expect(() => scheduler.advanceSimulationToTimeMicroseconds(19)).toThrow(/monotonic/i);
	});
});

async function schedulerFixture(records: readonly SimulationTransferPlanRecord[]) {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	);
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "MOTION-SCHEDULER-1",
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
	return new DeterministicScenarioMotionScheduler(snapshot, manifest, routes, claims, program);
}

async function serviceSchedulerFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(),
	);
	const records = [
		transfer("SERVICE-LEG-1", 0, 10, "LOAD-SERVICE", 2, 1),
		transfer("SERVICE-LEG-2", 1, 20, "LOAD-SERVICE", 1, 3),
	];
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "MOTION-SERVICE-1",
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
		{
			eqProcessTimings: [
				{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 2_000_000 },
			],
		},
	);
	return new DeterministicScenarioMotionScheduler(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		timing,
	);
}

async function resourceServiceSchedulerFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(),
	);
	const records = [
		transfer("RESOURCE-LEG-1", 0, 10, "LOAD-RESOURCE", 2, 1),
		transfer("RESOURCE-LEG-2", 1, 20, "LOAD-RESOURCE", 1, 3),
	];
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "MOTION-RESOURCE-1",
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
		{
			eqProcessTimings: [
				{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 2_000_000 },
			],
		},
	);
	const resources = compileSimulationScenarioResourceRunConfiguration(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		timing,
		{
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 1,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [],
		},
	);
	return new DeterministicScenarioMotionScheduler(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		timing,
		resources,
	);
}

async function windowedEqSchedulerFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(),
	);
	const records = [transfer("WINDOWED-EQ", 0, 10, "LOAD-WINDOW", 3, 2)];
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "MOTION-WINDOWED-EQ-1",
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
		{
			eqProcessTimings: [
				{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 2_000_000 },
			],
		},
	);
	const resources = compileSimulationScenarioResourceRunConfiguration(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		timing,
		{
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 1,
					availabilityMode: "WINDOWS",
					availabilityWindows: [{ startMicroseconds: 50_000_000, endMicroseconds: 60_000_000 }],
				},
			],
			initialStorageLoads: [],
		},
	);
	return new DeterministicScenarioMotionScheduler(
		snapshot,
		manifest,
		routes,
		claims,
		program,
		timing,
		resources,
	);
}

function eventLog(scheduler: DeterministicScenarioMotionScheduler) {
	return Array.from({ length: scheduler.eventCount }, (_, index) => scheduler.eventAt(index));
}

function resourceEventLog(scheduler: DeterministicScenarioMotionScheduler) {
	return Array.from({ length: scheduler.resourceEventCount }, (_, index) =>
		scheduler.resourceEventAt(index),
	);
}

function transfer(
	transferId: string,
	sourceOrdinal: number,
	releaseTimeMicroseconds: number,
	loadId: string,
	sourcePortId: number,
	destinationPortId: number,
): SimulationTransferPlanRecord {
	return {
		transferId,
		sourceOrdinal,
		releaseTimeMicroseconds,
		loadId,
		sourcePortId,
		destinationPortId,
	};
}
