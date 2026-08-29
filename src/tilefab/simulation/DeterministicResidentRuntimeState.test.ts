import { describe, expect, it } from "vitest";
import {
	buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts,
	buildSimulationReadinessTestComponentsWithMixedPorts,
} from "../compile/SimulationReadinessTestFixture";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	buildSimulationResidentReadinessTestSources,
	residentReadinessTestRecord,
	type SimulationResidentReadinessTestFixtureInput,
} from "../compile/SimulationResidentReadinessTestFixture";
import {
	consumeSimulationResidentRunAuthorization,
	type IssueSimulationResidentRunAuthorizationInput,
	issueSimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorizationAdoption,
} from "../compile/SimulationResidentRunAuthorization";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "../compile/SimulationScenarioManifest";
import {
	adoptDeterministicResidentRuntimeState,
	DETERMINISTIC_RESIDENT_RUNTIME_STATE_MAX_TYPED_BYTES,
	DeterministicResidentRuntimeState,
	type DeterministicResidentSpeedMultiplier,
} from "./DeterministicResidentRuntimeState";

describe("DeterministicResidentRuntimeState", () => {
	it("initializes exact dedicated-home ownership, custody, and storage only through consumed authority", async () => {
		const input = await runtimeInput();
		const grant = await issueSimulationResidentRunAuthorization(input);
		const runtime = await consumeSimulationResidentRunAuthorization(
			grant,
			input,
			(authorization, snapshot, adoption) =>
				adoptDeterministicResidentRuntimeState(authorization, snapshot, adoption),
		);
		if (!runtime) throw new Error("Expected resident runtime state adoption.");

		expect(runtime.sourceAuthorizationFingerprint).toBe(grant.authorization.fingerprint);
		expect(runtime.sourceCertificateFingerprint).toBe(input.snapshot.certificate.fingerprint);
		expect(runtime.requestState(0)).toMatchObject({
			phase: "WAITING_RELEASE",
			loadRow: 0,
			vehicleRow: 0,
		});
		expect(runtime.vehicleState(0)).toMatchObject({
			phase: "IDLE_AT_HOME",
			homeSlotId: 1,
			homePortId: 3,
			currentRequestRow: null,
		});
		expect(runtime.loadCustody(0)).toEqual({ kind: "STATION", stationRow: 0 });
		expect(runtime.loadStorageResourceRow(0)).toBe(0);
		expect(runtime.storageState(0)).toMatchObject({
			equipmentGroupId: 1,
			occupiedUnits: 1,
			reservedUnits: 0,
		});

		const homeRows = new Set(input.snapshot.parking.footprintTrackResourceRows);
		let ownedHomeRows = 0;
		for (let row = 0; row < input.snapshot.trackResources.trackResourceCount; row++) {
			const owner = runtime.trackResourceOwnerVehicleRow(row);
			if (homeRows.has(row)) {
				expect(owner).toBe(0);
				ownedHomeRows++;
			} else {
				expect(owner).toBeNull();
			}
		}
		expect(ownedHomeRows).toBe(homeRows.size);
		for (let row = 0; row < input.snapshot.trackResources.switchConflictResourceCount; row++) {
			expect(runtime.switchConflictOwnerVehicleRow(row)).toBeNull();
		}
		expect(runtime.runtimeSummary()).toMatchObject({
			requestCount: 1,
			requestWaitingReleaseCount: 1,
			requestCompletedCount: 0,
			vehicleCount: 1,
			vehicleIdleAtHomeCount: 1,
			vehicleMovingCount: 0,
			loadCount: 1,
			homeTrackResourceCount: homeRows.size,
			nonHomeOwnedTrackResourceCount: 0,
			ownedSwitchConflictResourceCount: 0,
			storageResourceCount: 1,
			storageOccupiedUnits: 1,
			storageReservedUnits: 0,
		});
	});

	it("rejects direct construction plus copied, reused, or escaped adoption proof", async () => {
		const input = await runtimeInput();
		const grant = await issueSimulationResidentRunAuthorization(input);
		expect(
			() =>
				new DeterministicResidentRuntimeState(
					Symbol("foreign") as never,
					grant.authorization,
					input.snapshot,
				),
		).toThrow(/consumed one-shot authorization/i);

		let escapedAdoption: SimulationResidentRunAuthorizationAdoption | null = null;
		let escapedAuthorization: SimulationResidentRunAuthorization | null = null;
		const runtime = await consumeSimulationResidentRunAuthorization(
			grant,
			input,
			(authorization, snapshot, adoption) => {
				escapedAdoption = adoption;
				escapedAuthorization = authorization;
				const copied = structuredClone(adoption) as SimulationResidentRunAuthorizationAdoption;
				expect(() =>
					adoptDeterministicResidentRuntimeState(authorization, snapshot, copied),
				).toThrow(/stale, copied, reused, or mismatched/i);
				return adoptDeterministicResidentRuntimeState(authorization, snapshot, adoption);
			},
		);
		expect(runtime).not.toBeNull();
		if (!escapedAdoption || !escapedAuthorization) {
			throw new Error("Expected an escaped adoption fixture.");
		}
		expect(() =>
			adoptDeterministicResidentRuntimeState(
				escapedAuthorization as SimulationResidentRunAuthorization,
				input.snapshot,
				escapedAdoption as SimulationResidentRunAuthorizationAdoption,
			),
		).toThrow(/stale, copied, reused, or mismatched/i);
	});

	it("rejects out-of-range observation without changing initial runtime state", async () => {
		const runtime = await adoptedRuntime();

		expect(() => runtime.requestState(1)).toThrow(/outside 1 rows/i);
		expect(() => runtime.vehicleState(-1)).toThrow(/outside 1 rows/i);
		expect(() => runtime.loadCustody(1)).toThrow(/outside 1 rows/i);
		expect(() => runtime.storageState(1)).toThrow(/outside 1 rows/i);
		expect(runtime.runtimeSummary().requestWaitingReleaseCount).toBe(1);
		expect(runtime.runtimeSummary().vehicleIdleAtHomeCount).toBe(1);
	});

	it("releases and acquires every non-home cycle resource atomically before departure", async () => {
		const { runtime, input } = await adoptedRuntimeFixture();

		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(1);
		expect(runtime.requestState(0).phase).toBe("TO_PICKUP");
		expect(runtime.vehicleState(0).phase).toBe("TO_PICKUP");
		const claims = input.snapshot.leaseClaims;
		expect(
			(claims.nonHomeTrackResourceOffsets[1] as number) -
				(claims.nonHomeTrackResourceOffsets[0] as number),
		).toBeGreaterThan(0);
		for (
			let offset = claims.nonHomeTrackResourceOffsets[0] as number;
			offset < (claims.nonHomeTrackResourceOffsets[1] as number);
			offset++
		) {
			expect(
				runtime.trackResourceOwnerVehicleRow(claims.nonHomeTrackResourceRows[offset] as number),
			).toBe(0);
		}
		for (
			let offset = claims.switchConflictClaimOffsets[0] as number;
			offset < (claims.switchConflictClaimOffsets[1] as number);
			offset++
		) {
			expect(
				runtime.switchConflictOwnerVehicleRow(claims.switchConflictClaimRows[offset] as number),
			).toBe(0);
		}
		expect(runtime.destinationStorageReservationRow(0)).toBeNull();
		expect(runtime.runtimeSummary()).toMatchObject({
			requestWaitingReleaseCount: 0,
			requestWaitingCompleteCycleLeaseCount: 0,
			requestToPickupCount: 1,
			vehicleIdleAtHomeCount: 0,
			vehicleMovingCount: 1,
		});
		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(0);
		runtime.advanceSimulationToTimeMicroseconds(10);
		expect(() => runtime.advanceSimulationToTimeMicroseconds(9)).toThrow(/monotonic/i);
	});

	it("moves through pickup, dropoff, and exact home return before releasing the cycle", async () => {
		const { runtime, input } = await adoptedRuntimeFixture();
		const [toPickup, toDropoff, toHome] = residentLegDurations(input, 0);

		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(1);
		expect(runtime.motionState(0)).toMatchObject({
			legIndex: 0,
			legStartedAtMicroseconds: 0,
			legCompletesAtMicroseconds: toPickup,
		});
		runtime.advanceSimulationToTimeMicroseconds(toPickup - 1);
		expect(runtime.requestState(0).phase).toBe("TO_PICKUP");
		expect(runtime.motionState(0).legAnchorDistanceMeters).toBeGreaterThan(0);
		expect(runtime.motionState(0).legAnchorDistanceMeters).toBeLessThan(
			runtime.motionState(0).legDistanceMeters,
		);

		runtime.advanceSimulationToTimeMicroseconds(toPickup);
		expect(runtime.requestState(0).phase).toBe("TO_DROPOFF");
		expect(runtime.vehicleState(0).phase).toBe("TO_DROPOFF");
		expect(runtime.loadCustody(0)).toEqual({ kind: "VEHICLE", vehicleRow: 0 });
		expect(runtime.motionState(0)).toMatchObject({
			legIndex: 1,
			legStartedAtMicroseconds: toPickup,
			legCompletesAtMicroseconds: toPickup + toDropoff,
		});

		runtime.advanceSimulationToTimeMicroseconds(toPickup + toDropoff);
		expect(runtime.destinationServiceState(0)).toMatchObject({
			phase: "ACTIVE",
			queuedAtMicroseconds: toPickup + toDropoff,
			startedAtMicroseconds: toPickup + toDropoff,
			readyAtMicroseconds: null,
		});
		const destinationStationRow = [...input.snapshot.foundation.stations.ids].indexOf(
			input.snapshot.routes.dropoffPortIds[0] as number,
		);
		expect(destinationStationRow).toBeGreaterThanOrEqual(0);
		expect(runtime.requestState(0).phase).toBe("RETURNING_HOME");
		expect(runtime.vehicleState(0).phase).toBe("RETURNING_HOME");
		expect(runtime.loadCustody(0)).toEqual({
			kind: "STATION",
			stationRow: destinationStationRow,
		});

		const completedAt = toPickup + toDropoff + toHome;
		runtime.advanceSimulationToTimeMicroseconds(completedAt);
		expect(runtime.requestState(0).phase).toBe("COMPLETED");
		expect(runtime.vehicleState(0)).toMatchObject({
			phase: "IDLE_AT_HOME",
			currentRequestRow: null,
		});
		expect(runtime.motionState(0)).toMatchObject({
			legIndex: null,
			legStartedAtMicroseconds: toPickup + toDropoff,
			legCompletesAtMicroseconds: completedAt,
		});
		expect(runtime.motionState(0).cycleAnchorDistanceMeters).toBe(
			runtime.motionState(0).cycleDistanceMeters,
		);
		expect(runtime.runtimeSummary()).toMatchObject({
			requestCompletedCount: 1,
			vehicleIdleAtHomeCount: 1,
			nonHomeOwnedTrackResourceCount: 0,
			ownedSwitchConflictResourceCount: 0,
		});
	});

	it("starts EQ service only inside a window that contains its full duration", async () => {
		const sources = await buildSimulationResidentReadinessTestSources({
			resourceInput: {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "WINDOWS",
						availabilityWindows: [{ startMicroseconds: 50_000_000, endMicroseconds: 60_000_000 }],
					},
				],
				initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
			},
		});
		const { runtime, input } = await adoptedRuntimeFixture(sources);
		const [toPickup, toDropoff] = residentLegDurations(input, 0);
		const arrivedAt = toPickup + toDropoff;
		expect(arrivedAt).toBeLessThan(50_000_000);

		runtime.advanceSimulationToTimeMicroseconds(arrivedAt);
		expect(runtime.destinationServiceState(0)).toMatchObject({
			phase: "QUEUED",
			queuedAtMicroseconds: arrivedAt,
			startedAtMicroseconds: null,
		});
		runtime.advanceSimulationToTimeMicroseconds(49_999_999);
		expect(runtime.destinationServiceState(0).phase).toBe("QUEUED");
		runtime.advanceSimulationToTimeMicroseconds(50_000_000);
		expect(runtime.destinationServiceState(0)).toMatchObject({
			phase: "ACTIVE",
			startedAtMicroseconds: 50_000_000,
		});
		runtime.advanceSimulationToTimeMicroseconds(52_000_000);
		expect(runtime.destinationServiceState(0)).toMatchObject({
			phase: "READY",
			readyAtMicroseconds: 52_000_000,
		});
	});

	it("queues a later EQ arrival behind exact concurrent capacity", async () => {
		const sources = await buildSimulationResidentReadinessTestSources({
			components: buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 2),
			records: [
				residentReadinessTestRecord(0, "LOAD-A", 1, 2),
				residentReadinessTestRecord(1, "LOAD-B", 1, 2),
			],
			timingInput: {
				eqProcessTimings: [
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 30_000_000 },
					{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 1 },
				],
			},
			resourceInput: {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [
					{ loadId: "LOAD-A", equipmentGroupId: 1 },
					{ loadId: "LOAD-B", equipmentGroupId: 1 },
				],
			},
		});
		const { runtime, input } = await adoptedRuntimeFixture(sources);
		const firstLegs = residentLegDurations(input, 0);
		const secondLegs = residentLegDurations(input, 1);
		const firstDropoffAt = firstLegs[0] + firstLegs[1];
		const firstHomeAt = firstLegs.reduce((sum, value) => sum + value, 0);
		const secondDropoffAt = firstHomeAt + secondLegs[0] + secondLegs[1];
		const firstReadyAt = firstDropoffAt + 30_000_000;
		expect(secondDropoffAt).toBeLessThan(firstReadyAt);

		runtime.advanceSimulationToTimeMicroseconds(secondDropoffAt);
		expect(runtime.destinationServiceState(0).phase).toBe("ACTIVE");
		expect(runtime.destinationServiceState(1)).toMatchObject({
			phase: "QUEUED",
			queuedAtMicroseconds: secondDropoffAt,
			startedAtMicroseconds: null,
		});
		runtime.advanceSimulationToTimeMicroseconds(firstReadyAt);
		expect(runtime.destinationServiceState(0).phase).toBe("READY");
		expect(runtime.destinationServiceState(1)).toMatchObject({
			phase: "ACTIVE",
			startedAtMicroseconds: firstReadyAt,
		});
		runtime.advanceSimulationToTimeMicroseconds(firstReadyAt + 1);
		expect(runtime.destinationServiceState(1).phase).toBe("READY");
	});

	it("keeps a repeated load blocked until service and full assigned-vehicle home return", async () => {
		const sources = await buildResidentSourcesAtFirstValidHome(
			{
				records: [
					residentReadinessTestRecord(0, "LOAD-A", 1, 2),
					residentReadinessTestRecord(1, "LOAD-A", 2, 4),
				],
				timingInput: {
					eqProcessTimings: [
						{
							sourceOrdinal: 0,
							capabilityId: 1,
							processingDurationMicroseconds: 20_000_000,
						},
					],
				},
				resourceInput: {
					eqResources: [
						{
							equipmentGroupId: 2,
							concurrentCapacity: 1,
							availabilityMode: "ALWAYS",
							availabilityWindows: [],
						},
					],
					initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
				},
			},
			[3, 5, 1],
		);
		const { runtime, input } = await adoptedRuntimeFixture(sources);
		const [toPickup, toDropoff, toHome] = residentLegDurations(input, 0);
		const homeAt = toPickup + toDropoff + toHome;
		const serviceReadyAt = toPickup + toDropoff + 20_000_000;
		expect(serviceReadyAt).toBeGreaterThan(homeAt);

		runtime.advanceSimulationToTimeMicroseconds(homeAt);
		expect(runtime.requestState(0).phase).toBe("COMPLETED");
		expect(runtime.destinationServiceState(0).phase).toBe("ACTIVE");
		expect(runtime.requestState(1).phase).toBe("WAITING_PREDECESSOR");
		expect(runtime.advanceSimulationToTimeMicroseconds(serviceReadyAt)).toBe(1);
		expect(runtime.destinationServiceState(0).phase).toBe("READY");
		expect(runtime.requestState(1).phase).toBe("TO_PICKUP");
	});

	it("keeps terminal semantics identical under 1x and 64x wall-clock advance", async () => {
		const sources = await buildSimulationResidentReadinessTestSources();
		const reference = await adoptedRuntimeFixture(sources);
		const accelerated = await adoptedRuntimeFixture(sources);
		const legs = residentLegDurations(reference.input, 0);
		const homeAt = legs.reduce((sum, value) => sum + value, 0);
		const serviceReadyAt =
			legs[0] +
			legs[1] +
			(reference.input.snapshot.serviceTiming.serviceDurationMicroseconds[0] as number);
		const terminalAt = Math.max(homeAt, serviceReadyAt);

		reference.runtime.advanceByWallClockMicroseconds(terminalAt, 1);
		accelerated.runtime.advanceByWallClockMicroseconds(Math.ceil(terminalAt / 64), 64);
		expect(reference.runtime.allResidentWorkCompleted).toBe(true);
		expect(accelerated.runtime.allResidentWorkCompleted).toBe(true);
		expect(accelerated.runtime.requestState(0)).toEqual(reference.runtime.requestState(0));
		expect(accelerated.runtime.vehicleState(0)).toEqual(reference.runtime.vehicleState(0));
		expect(accelerated.runtime.loadCustody(0)).toEqual(reference.runtime.loadCustody(0));
		expect(accelerated.runtime.destinationServiceState(0)).toEqual(
			reference.runtime.destinationServiceState(0),
		);
		expect(
			Array.from(
				{ length: reference.runtime.coreEventCount },
				(_, index) => reference.runtime.coreEventAt(index).type,
			),
		).toEqual([
			"REQUEST_RELEASED",
			"CYCLE_ADMITTED",
			"LOAD_PICKED_UP",
			"LOAD_DROPPED_OFF",
			"VEHICLE_RETURNED_HOME",
		]);
		expect(
			Array.from(
				{ length: reference.runtime.resourceEventCount },
				(_, index) => reference.runtime.resourceEventAt(index).type,
			),
		).toEqual([
			"STORAGE_SOURCE_RELEASED",
			"EQ_SERVICE_QUEUED",
			"EQ_SERVICE_STARTED",
			"EQ_SERVICE_READY",
		]);
		expect(
			Array.from({ length: accelerated.runtime.coreEventCount }, (_, index) =>
				accelerated.runtime.coreEventAt(index),
			),
		).toEqual(
			Array.from({ length: reference.runtime.coreEventCount }, (_, index) =>
				reference.runtime.coreEventAt(index),
			),
		);
		expect(
			Array.from({ length: accelerated.runtime.resourceEventCount }, (_, index) =>
				accelerated.runtime.resourceEventAt(index),
			),
		).toEqual(
			Array.from({ length: reference.runtime.resourceEventCount }, (_, index) =>
				reference.runtime.resourceEventAt(index),
			),
		);
		expect(() =>
			accelerated.runtime.advanceByWallClockMicroseconds(
				1,
				3 as DeterministicResidentSpeedMultiplier,
			),
		).toThrow(/speed multiplier/i);
	});

	it("keeps later work waiting on exact load and vehicle predecessor completion", async () => {
		const sources = await buildSimulationResidentReadinessTestSources({
			components: buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 2),
			records: [
				residentReadinessTestRecord(0, "LOAD-A", 1, 2),
				residentReadinessTestRecord(1, "LOAD-B", 1, 2),
			],
			timingInput: {
				eqProcessTimings: [
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 1 },
					{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 1 },
				],
			},
			resourceInput: {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [
					{ loadId: "LOAD-A", equipmentGroupId: 1 },
					{ loadId: "LOAD-B", equipmentGroupId: 1 },
				],
			},
		});
		const { runtime, input } = await adoptedRuntimeFixture(sources);

		expect(runtime.advanceSimulationToTimeMicroseconds(1)).toBe(1);
		expect(runtime.requestState(0).phase).toBe("TO_PICKUP");
		expect(runtime.requestState(1).phase).toBe("WAITING_PREDECESSOR");
		expect(runtime.runtimeSummary().requestWaitingPredecessorCount).toBe(1);
		const firstHomeReturn = residentLegDurations(input, 0).reduce((sum, value) => sum + value, 0);
		expect(runtime.advanceSimulationToTimeMicroseconds(firstHomeReturn)).toBe(1);
		expect(runtime.requestState(0).phase).toBe("COMPLETED");
		expect(runtime.requestState(1).phase).toBe("TO_PICKUP");
	});

	it("leaves every cycle resource free when destination storage has no atomic capacity", async () => {
		const sources = await buildResidentSourcesAtFirstValidHome(
			{
				components: buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 8),
				records: [residentReadinessTestRecord(0, "LOAD-A", 1, 4)],
				timingInput: { eqProcessTimings: [] },
				resourceInput: {
					eqResources: [],
					initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
				},
			},
			[2, 3, 5],
		);
		const { runtime, input } = await adoptedRuntimeFixture(sources);

		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(0);
		expect(runtime.requestState(0).phase).toBe("WAITING_COMPLETE_CYCLE_LEASE");
		expect(runtime.vehicleState(0).phase).toBe("WAITING_FOR_COMPLETE_CYCLE");
		expect(runtime.destinationStorageReservationRow(0)).toBeNull();
		expect(runtime.storageState(1)).toMatchObject({ occupiedUnits: 8, reservedUnits: 0 });
		const claims = input.snapshot.leaseClaims;
		expect(
			(claims.nonHomeTrackResourceOffsets[1] as number) -
				(claims.nonHomeTrackResourceOffsets[0] as number),
		).toBeGreaterThan(0);
		for (
			let offset = claims.nonHomeTrackResourceOffsets[0] as number;
			offset < (claims.nonHomeTrackResourceOffsets[1] as number);
			offset++
		) {
			expect(
				runtime.trackResourceOwnerVehicleRow(claims.nonHomeTrackResourceRows[offset] as number),
			).toBeNull();
		}
		for (
			let offset = claims.switchConflictClaimOffsets[0] as number;
			offset < (claims.switchConflictClaimOffsets[1] as number);
			offset++
		) {
			expect(
				runtime.switchConflictOwnerVehicleRow(claims.switchConflictClaimRows[offset] as number),
			).toBeNull();
		}
		expect(runtime.runtimeSummary()).toMatchObject({
			nonHomeOwnedTrackResourceCount: 0,
			ownedSwitchConflictResourceCount: 0,
			storageReservedUnits: 0,
		});
	});

	it("reserves a same-storage-group destination by reusing the load source unit", async () => {
		const sources = await buildResidentSourcesAtFirstValidHome(
			{
				components: buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 1),
				records: [residentReadinessTestRecord(0, "LOAD-A", 4, 5)],
				timingInput: { eqProcessTimings: [] },
				resourceInput: {
					eqResources: [],
					initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 3 }],
				},
			},
			[1, 2, 3],
		);
		const { runtime, input } = await adoptedRuntimeFixture(sources);

		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(1);
		expect(runtime.destinationStorageReservationRow(0)).toBe(0);
		expect(runtime.storageState(0)).toMatchObject({ occupiedUnits: 1, reservedUnits: 0 });
		const [toPickup, toDropoff] = residentLegDurations(input, 0);
		runtime.advanceSimulationToTimeMicroseconds(toPickup);
		expect(runtime.storageState(0)).toMatchObject({ occupiedUnits: 0, reservedUnits: 1 });
		expect(runtime.loadStorageResourceRow(0)).toBeNull();
		runtime.advanceSimulationToTimeMicroseconds(toPickup + toDropoff);
		expect(runtime.storageState(0)).toMatchObject({ occupiedUnits: 1, reservedUnits: 0 });
		expect(runtime.destinationStorageReservationRow(0)).toBeNull();
		expect(runtime.loadStorageResourceRow(0)).toBe(0);
		expect(runtime.destinationServiceState(0)).toMatchObject({
			phase: "ACTIVE",
			startedAtMicroseconds: toPickup + toDropoff,
		});
		const readyAt =
			toPickup +
			toDropoff +
			(input.snapshot.serviceTiming.serviceDurationMicroseconds[0] as number);
		runtime.advanceSimulationToTimeMicroseconds(readyAt);
		expect(runtime.destinationServiceState(0)).toMatchObject({
			phase: "READY",
			readyAtMicroseconds: readyAt,
		});
	});

	it("makes Stop terminal and rejects mutable runtime access through stale references", async () => {
		const runtime = await adoptedRuntime();
		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(1);
		expect(runtime.dispose("EXPLICIT_STOP")).toBe(true);
		expect(runtime.disposed).toBe(true);
		expect(runtime.disposalReason).toBe("EXPLICIT_STOP");
		expect(runtime.dispose("OWNER_DISPOSED")).toBe(false);
		expect(runtime.disposalReason).toBe("EXPLICIT_STOP");
		expect(() => runtime.advanceSimulationToTimeMicroseconds(1)).toThrow(/disposed/i);
		expect(() => runtime.requestState(0)).toThrow(/disposed/i);
		expect(() => runtime.runtimeSummary()).toThrow(/disposed/i);
		expect(() => runtime.coreEventAt(0)).toThrow(/disposed/i);
		expect(() => runtime.dispose("UNKNOWN" as never)).toThrow(/reason/i);
	});

	it("enters terminal disposal when a retained certified source becomes inconsistent", async () => {
		const { runtime, input } = await adoptedRuntimeFixture();
		input.snapshot.admissionProgram.requestVehicleRows[0] = runtime.vehicleCount;

		expect(() => runtime.advanceSimulationToTimeMicroseconds(0)).toThrow(/vehicle/i);
		expect(runtime.disposed).toBe(true);
		expect(runtime.disposalReason).toBe("RUNTIME_FAILURE");
		expect(() => runtime.currentTimeMicroseconds).toThrow(/disposed/i);
	});

	it("adopts the exact 100,000-request initial state within its typed-memory cap", async () => {
		const requestCount = SIMULATION_SCENARIO_MAX_INPUT_RECORDS;
		const sources = await buildSimulationResidentReadinessTestSources({
			components: buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8),
			homePortId: 1,
			records: Array.from({ length: requestCount }, (_, row) =>
				residentReadinessTestRecord(row, `LOAD-${row}`, 2, 4),
			),
			timingInput: {
				eqProcessTimings: Array.from({ length: requestCount }, (_, sourceOrdinal) => ({
					sourceOrdinal,
					capabilityId: 1,
					processingDurationMicroseconds: 1,
				})),
			},
			resourceInput: {
				eqResources: [
					{
						equipmentGroupId: 1,
						concurrentCapacity: 100,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [],
			},
		});
		const snapshot = await publishSimulationResidentReadinessSnapshot(sources);
		const input = residentRuntimeInput(snapshot);
		const grant = await issueSimulationResidentRunAuthorization(input);
		const runtime = await consumeSimulationResidentRunAuthorization(
			grant,
			input,
			(authorization, exactSnapshot, adoption) =>
				adoptDeterministicResidentRuntimeState(authorization, exactSnapshot, adoption),
		);
		if (!runtime) throw new Error("Expected 100,000-request resident runtime adoption.");

		expect(runtime.requestCount).toBe(requestCount);
		expect(runtime.loadCount).toBe(requestCount);
		expect(runtime.vehicleCount).toBe(1);
		expect(runtime.requestState(requestCount - 1).phase).toBe("WAITING_RELEASE");
		expect(runtime.typedByteLength).toBeLessThan(
			DETERMINISTIC_RESIDENT_RUNTIME_STATE_MAX_TYPED_BYTES,
		);
		const cycleDurationMicroseconds = residentLegDurations(input, 0).reduce(
			(sum, value) => sum + value,
			0,
		);
		const terminalTimeMicroseconds = cycleDurationMicroseconds * requestCount;
		expect(Number.isSafeInteger(terminalTimeMicroseconds)).toBe(true);
		expect(runtime.advanceSimulationToTimeMicroseconds(terminalTimeMicroseconds)).toBe(
			requestCount,
		);
		expect(runtime.allResidentWorkCompleted).toBe(true);
		expect(runtime.completedRequestCount).toBe(requestCount);
		expect(runtime.readyDestinationServiceCount).toBe(requestCount);
		expect(runtime.coreEventCount).toBe(requestCount * 5);
		expect(runtime.resourceEventCount).toBe(requestCount * 3);
		expect(runtime.requestState(requestCount - 1).phase).toBe("COMPLETED");
		expect(runtime.vehicleState(0).phase).toBe("IDLE_AT_HOME");
		expect(runtime.runtimeSummary()).toMatchObject({
			requestCompletedCount: requestCount,
			destinationServiceReadyCount: requestCount,
			nonHomeOwnedTrackResourceCount: 0,
			ownedSwitchConflictResourceCount: 0,
		});
	}, 120_000);
});

async function adoptedRuntime(): Promise<DeterministicResidentRuntimeState> {
	return (await adoptedRuntimeFixture()).runtime;
}

async function adoptedRuntimeFixture(
	sources?: Awaited<ReturnType<typeof buildSimulationResidentReadinessTestSources>>,
): Promise<{
	runtime: DeterministicResidentRuntimeState;
	input: IssueSimulationResidentRunAuthorizationInput;
}> {
	const exactSources = sources ?? (await buildSimulationResidentReadinessTestSources());
	const input = residentRuntimeInput(
		await publishSimulationResidentReadinessSnapshot(exactSources),
	);
	const grant = await issueSimulationResidentRunAuthorization(input);
	const runtime = await consumeSimulationResidentRunAuthorization(
		grant,
		input,
		(authorization, snapshot, adoption) =>
			adoptDeterministicResidentRuntimeState(authorization, snapshot, adoption),
	);
	if (!runtime) throw new Error("Expected resident runtime state adoption.");
	return { runtime, input };
}

async function runtimeInput(): Promise<IssueSimulationResidentRunAuthorizationInput> {
	const sources = await buildSimulationResidentReadinessTestSources();
	return residentRuntimeInput(await publishSimulationResidentReadinessSnapshot(sources));
}

function residentRuntimeInput(
	snapshot: Awaited<ReturnType<typeof publishSimulationResidentReadinessSnapshot>>,
): IssueSimulationResidentRunAuthorizationInput {
	return {
		projectId: "PROJECT-RESIDENT-RUNTIME-1",
		preparationGeneration: 11,
		authorizationGeneration: 13,
		runAssetFingerprint: "resident-runtime-run-asset-1",
		snapshot,
	};
}

function residentLegDurations(
	input: IssueSimulationResidentRunAuthorizationInput,
	requestRow: number,
): [number, number, number] {
	const speed = input.snapshot.occupancyPolicy.maximumSpeedMillimetersPerSecond;
	const duration = (legIndex: number): number => {
		const distance = input.snapshot.routes.legDistancesMeters[requestRow * 3 + legIndex] as number;
		return Math.ceil((Math.ceil(distance * 1_000_000) * 1_000) / speed);
	};
	return [duration(0), duration(1), duration(2)];
}

async function buildResidentSourcesAtFirstValidHome(
	input: SimulationResidentReadinessTestFixtureInput,
	homePortIds: readonly number[],
): Promise<Awaited<ReturnType<typeof buildSimulationResidentReadinessTestSources>>> {
	let lastError: unknown;
	for (const homePortId of homePortIds) {
		try {
			return await buildSimulationResidentReadinessTestSources({ ...input, homePortId });
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("No valid resident home fixture was found.");
}
