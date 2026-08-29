import { describe, expect, it } from "vitest";
import {
	type PublishedSimulationReadinessSnapshot,
	publishSimulationReadinessSnapshot,
} from "../compile/SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts,
	buildSimulationReadinessTestComponentsWithEqPorts,
	buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts,
} from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import {
	DeterministicScenarioAdmissionCore,
	type DeterministicScenarioAdmissionResourceGate,
} from "./DeterministicScenarioAdmissionCore";

describe("DeterministicScenarioAdmissionCore", () => {
	it("atomically admits one token and transfers FOUP custody only through explicit events", async () => {
		const fixture = await runtimeFixture([transfer("ONE", 0, 10, "LOAD-ONE", 2, 1)]);
		const core = fixture.core;
		const firstTrackRow = fixture.claims.leaseTrackResourceRows[0] as number;

		expect(core.requestState(0).phase).toBe("WAITING_RELEASE");
		expect(core.loadCustody(0)).toEqual({
			kind: "STATION",
			stationRow: fixture.routes.sourceStationRows[0],
		});
		expect(core.advanceToTimeMicroseconds(9)).toBe(0);
		expect(core.advanceToTimeMicroseconds(10)).toBe(1);
		expect(core.eventAt(0)).toMatchObject({
			sequence: 1,
			timeMicroseconds: 10,
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 0,
			vehicleTokenId: 1,
		});
		expect(core.requestState(0)).toMatchObject({ phase: "ADMITTED", activeVehicleTokenId: 1 });
		expect(core.trackResourceOwnerRequestRow(firstTrackRow)).toBe(0);

		expect(core.confirmPickup(0, 12)).toMatchObject({
			type: "FOUP_PICKED_UP",
			timeMicroseconds: 12,
		});
		expect(core.loadCustody(0)).toEqual({ kind: "VEHICLE_TOKEN", vehicleTokenId: 1 });
		expect(core.requestState(0).phase).toBe("IN_TRANSIT");

		expect(core.completeTransfer(0, 25)).toMatchObject({
			type: "TRANSFER_COMPLETED",
			timeMicroseconds: 25,
		});
		expect(core.loadCustody(0)).toEqual({
			kind: "STATION",
			stationRow: fixture.routes.destinationStationRows[0],
		});
		expect(core.requestState(0)).toMatchObject({
			phase: "COMPLETED",
			activeVehicleTokenId: null,
		});
		expect(core.trackResourceOwnerRequestRow(firstTrackRow)).toBeNull();
		expect(core.eventCount).toBe(3);
		expect(core.completedRequestCount).toBe(1);
		expect(core.allRequestsCompleted).toBe(true);
	});

	it("keeps conflicting waiters resource-free and admits the oldest after release", async () => {
		const fixture = await runtimeFixture([
			transfer("OLDER", 0, 10, "LOAD-A", 2, 1),
			transfer("YOUNGER", 1, 10, "LOAD-B", 2, 1),
		]);
		const core = fixture.core;

		expect(core.advanceToTimeMicroseconds(10)).toBe(1);
		expect(core.requestState(0).phase).toBe("ADMITTED");
		expect(core.requestState(1)).toMatchObject({
			phase: "WAITING_LEASE",
			activeVehicleTokenId: null,
		});
		core.confirmPickup(0, 11);
		core.completeTransfer(0, 20);

		expect(core.requestState(1)).toMatchObject({ phase: "ADMITTED", activeVehicleTokenId: 2 });
		expect(core.eventAt(3)).toMatchObject({
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 1,
			timeMicroseconds: 20,
		});
	});

	it("prioritizes a newly eligible older chain leg ahead of an existing younger waiter", async () => {
		const fixture = await runtimeFixture([
			transfer("CHAIN-OLDER-1", 0, 10, "LOAD-CHAIN", 2, 1),
			transfer("CHAIN-OLDER-2", 1, 10, "LOAD-CHAIN", 1, 2),
			transfer("INDEPENDENT-YOUNGER", 2, 10, "LOAD-YOUNGER", 2, 1),
		]);
		const core = fixture.core;

		core.advanceToTimeMicroseconds(10);
		expect(core.requestState(1).phase).toBe("WAITING_DEPENDENCY");
		expect(core.requestState(2).phase).toBe("WAITING_LEASE");
		core.confirmPickup(0, 11);
		core.completeTransfer(0, 20);

		expect(core.requestState(1).phase).toBe("ADMITTED");
		expect(core.requestState(2).phase).toBe("WAITING_LEASE");
		expect(core.eventAt(3)).toMatchObject({
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 1,
			timeMicroseconds: 20,
		});
	});

	it("allows a younger disjoint route to pass an older active route", async () => {
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(),
		);
		const [first, second] = await findDisjointTransfers(snapshot);
		const fixture = await runtimeFixture(
			[
				transfer("DISJOINT-OLDER", 0, 10, "LOAD-A", first[0], first[1]),
				transfer("DISJOINT-YOUNGER", 1, 10, "LOAD-B", second[0], second[1]),
			],
			snapshot,
		);

		expect(fixture.core.advanceToTimeMicroseconds(10)).toBe(2);
		expect(fixture.core.requestState(0).phase).toBe("ADMITTED");
		expect(fixture.core.requestState(1).phase).toBe("ADMITTED");
		expect(fixture.core.eventAt(0).requestRow).toBe(0);
		expect(fixture.core.eventAt(1).requestRow).toBe(1);
	});

	it("acquires and hands off the exact switch-conflict row with the track bundle", async () => {
		const fixture = await switchRuntimeFixture();
		const core = fixture.core;
		const conflictRow = fixture.claims.switchConflictClaimRows[0] as number;

		core.advanceToTimeMicroseconds(10);
		expect(core.switchConflictOwnerRequestRow(conflictRow)).toBe(0);
		expect(core.requestState(1).phase).toBe("WAITING_LEASE");
		core.confirmPickup(0, 11);
		core.completeTransfer(0, 20);
		expect(core.switchConflictOwnerRequestRow(conflictRow)).toBe(1);
		expect(core.requestState(1).phase).toBe("ADMITTED");
	});

	it("holds a later leg until its predecessor places the same FOUP at the exact source", async () => {
		const fixture = await runtimeFixture([
			transfer("CHAIN-1", 0, 10, "LOAD-CHAIN", 2, 1),
			transfer("CHAIN-2", 1, 20, "LOAD-CHAIN", 1, 2),
		]);
		const core = fixture.core;

		core.advanceToTimeMicroseconds(20);
		expect(core.requestState(0).phase).toBe("ADMITTED");
		expect(core.requestState(1).phase).toBe("WAITING_DEPENDENCY");
		core.confirmPickup(0, 21);
		core.completeTransfer(0, 30);
		expect(core.loadCustody(0)).toEqual({
			kind: "STATION",
			stationRow: fixture.routes.sourceStationRows[1],
		});
		expect(core.requestState(1).phase).toBe("ADMITTED");
		core.confirmPickup(1, 31);
		expect(core.loadCustody(0)).toEqual({ kind: "VEHICLE_TOKEN", vehicleTokenId: 2 });
	});

	it("releases the vehicle lease at arrival but holds a chained leg until service-ready", async () => {
		const fixture = await runtimeFixture([
			transfer("SERVICE-1", 0, 10, "LOAD-SERVICE", 2, 1),
			transfer("SERVICE-2", 1, 20, "LOAD-SERVICE", 1, 2),
		]);
		const core = fixture.core;
		const firstTrackRow = fixture.claims.leaseTrackResourceRows[0] as number;

		core.advanceToTimeMicroseconds(20);
		core.confirmPickup(0, 21);
		core.completeTransfer(0, 30, 50);

		expect(core.loadCustody(0)).toEqual({
			kind: "STATION",
			stationRow: fixture.routes.destinationStationRows[0],
		});
		expect(core.trackResourceOwnerRequestRow(firstTrackRow)).toBeNull();
		expect(core.requestState(1).phase).toBe("WAITING_DEPENDENCY");
		expect(core.destinationServiceState(0)).toEqual({
			requestRow: 0,
			phase: "IN_SERVICE",
			startedAtMicroseconds: 30,
			readyAtMicroseconds: 80,
		});
		expect(core.eventAt(3)).toMatchObject({
			type: "DESTINATION_SERVICE_STARTED",
			requestRow: 0,
			timeMicroseconds: 30,
		});

		core.advanceToTimeMicroseconds(79);
		expect(core.requestState(1).phase).toBe("WAITING_DEPENDENCY");
		expect(core.advanceToTimeMicroseconds(80)).toBe(2);
		expect(core.eventAt(4)).toMatchObject({
			type: "DESTINATION_SERVICE_READY",
			requestRow: 0,
			timeMicroseconds: 80,
		});
		expect(core.eventAt(5)).toMatchObject({
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 1,
			timeMicroseconds: 80,
		});
		expect(core.destinationServiceState(0).phase).toBe("READY");
	});

	it("makes explicit zero-duration service ready before successor admission", async () => {
		const fixture = await runtimeFixture([
			transfer("ZERO-1", 0, 10, "LOAD-ZERO", 2, 1),
			transfer("ZERO-2", 1, 10, "LOAD-ZERO", 1, 2),
		]);
		const core = fixture.core;

		core.advanceToTimeMicroseconds(10);
		core.confirmPickup(0, 11);
		core.completeTransfer(0, 20, 0);

		expect([2, 3, 4, 5].map((index) => core.eventAt(index).type)).toEqual([
			"TRANSFER_COMPLETED",
			"DESTINATION_SERVICE_STARTED",
			"DESTINATION_SERVICE_READY",
			"VEHICLE_TOKEN_ADMITTED",
		]);
		expect(core.requestState(1).phase).toBe("ADMITTED");
	});

	it("leaves the whole route unowned when destination storage cannot be reserved", async () => {
		const fixture = await runtimeFixture([transfer("NO-CAPACITY", 0, 10, "LOAD-NO-CAP", 2, 1)]);
		let reserveCalls = 0;
		let blockedCalls = 0;
		const gate: DeterministicScenarioAdmissionResourceGate = {
			canReserveDestinationForAdmission: () => false,
			destinationReservationBlocked: () => {
				blockedCalls++;
			},
			reserveDestinationForAdmission: () => {
				reserveCalls++;
				return true;
			},
			confirmSourcePickup: () => [],
			confirmDestinationArrival: () => undefined,
		};
		const core = new DeterministicScenarioAdmissionCore(
			fixture.snapshot,
			fixture.manifest,
			fixture.routes,
			fixture.claims,
			fixture.program,
			gate,
		);
		const firstTrackRow = fixture.claims.leaseTrackResourceRows[0] as number;

		expect(core.advanceToTimeMicroseconds(10)).toBe(0);
		expect(core.requestState(0).phase).toBe("WAITING_LEASE");
		expect(core.trackResourceOwnerRequestRow(firstTrackRow)).toBeNull();
		expect(core.eventCount).toBe(0);
		expect(reserveCalls).toBe(0);
		expect(blockedCalls).toBe(1);
	});

	it("retries only affected waiting admissions when source pickup frees storage", async () => {
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(),
		);
		const [first, second] = await findDisjointTransfers(snapshot);
		const fixture = await runtimeFixture(
			[
				transfer("RESOURCE-OLDER", 0, 10, "LOAD-OLDER", first[0], first[1]),
				transfer("RESOURCE-YOUNGER", 1, 10, "LOAD-YOUNGER", second[0], second[1]),
			],
			snapshot,
		);
		const reservable = new Set([0]);
		const gate: DeterministicScenarioAdmissionResourceGate = {
			canReserveDestinationForAdmission: (requestRow) => reservable.has(requestRow),
			reserveDestinationForAdmission: (requestRow) => reservable.has(requestRow),
			confirmSourcePickup: (requestRow) => {
				if (requestRow !== 0) return [];
				reservable.add(1);
				return [1];
			},
			confirmDestinationArrival: () => undefined,
		};
		const core = new DeterministicScenarioAdmissionCore(
			fixture.snapshot,
			fixture.manifest,
			fixture.routes,
			fixture.claims,
			fixture.program,
			gate,
		);

		core.advanceToTimeMicroseconds(10);
		expect(core.requestState(0).phase).toBe("ADMITTED");
		expect(core.requestState(1).phase).toBe("WAITING_LEASE");
		core.confirmPickup(0, 11);
		expect(core.requestState(1).phase).toBe("ADMITTED");
		expect(core.eventAt(2)).toMatchObject({
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 1,
			timeMicroseconds: 11,
		});
	});

	it("defers destination service to the exact resource-gated start time", async () => {
		const fixture = await runtimeFixture([transfer("DEFERRED", 0, 10, "LOAD-DEFERRED", 2, 1)]);
		const resourceTransitions: string[] = [];
		const gate: DeterministicScenarioAdmissionResourceGate = {
			canReserveDestinationForAdmission: () => true,
			reserveDestinationForAdmission: () => {
				resourceTransitions.push("RESERVED");
				return true;
			},
			confirmSourcePickup: () => {
				resourceTransitions.push("PICKED_UP");
				return [];
			},
			confirmDestinationArrival: () => resourceTransitions.push("ARRIVED"),
		};
		const core = new DeterministicScenarioAdmissionCore(
			fixture.snapshot,
			fixture.manifest,
			fixture.routes,
			fixture.claims,
			fixture.program,
			gate,
		);

		core.advanceToTimeMicroseconds(10);
		core.confirmPickup(0, 11);
		expect(() => core.completeTransfer(0, 20)).toThrow(/require deferred/i);
		core.completeTransferWithDeferredDestinationService(0, 20);
		expect(core.destinationServiceState(0).phase).toBe("NOT_STARTED");
		core.startDeferredDestinationService(0, 30, 50);
		expect(core.destinationServiceState(0)).toEqual({
			requestRow: 0,
			phase: "IN_SERVICE",
			startedAtMicroseconds: 30,
			readyAtMicroseconds: 80,
		});
		core.advanceToTimeMicroseconds(80);
		expect(core.destinationServiceState(0).phase).toBe("READY");
		expect(resourceTransitions).toEqual(["RESERVED", "PICKED_UP", "ARRIVED"]);
	});

	it("rejects non-monotonic time and out-of-order custody transitions", async () => {
		const fixture = await runtimeFixture([transfer("ORDER", 0, 10, "LOAD-ORDER", 2, 1)]);
		const core = fixture.core;

		expect(() => core.confirmPickup(0, 5)).toThrow(/no admitted vehicle token/i);
		core.advanceToTimeMicroseconds(10);
		expect(() => core.completeTransfer(0, 11)).toThrow(/not in transit/i);
		core.confirmPickup(0, 12);
		expect(() => core.advanceToTimeMicroseconds(11)).toThrow(/monotonic/i);
		expect(() => core.confirmPickup(0, 13)).toThrow(/no admitted vehicle token/i);
		expect(() => core.completeTransfer(0, 14, -1)).toThrow(/service duration/i);
	});
});

async function runtimeFixture(
	records: readonly SimulationTransferPlanRecord[],
	snapshot: PublishedSimulationReadinessSnapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	),
) {
	const manifest = manifestFor(records);
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const program = compileSimulationScenarioAdmissionProgram(snapshot, manifest, routes, claims);
	return {
		snapshot,
		manifest,
		routes,
		claims,
		program,
		core: new DeterministicScenarioAdmissionCore(snapshot, manifest, routes, claims, program),
	};
}

async function findDisjointTransfers(
	snapshot: PublishedSimulationReadinessSnapshot,
): Promise<readonly [readonly [number, number], readonly [number, number]]> {
	const candidates: Array<{
		readonly ports: readonly [number, number];
		readonly trackRows: ReadonlySet<number>;
	}> = [];
	for (let sourcePortId = 1; sourcePortId <= 8; sourcePortId++) {
		const destinationPortId = sourcePortId === 8 ? 1 : sourcePortId + 1;
		const manifest = manifestFor([
			transfer("CANDIDATE", 0, 10, "LOAD-CANDIDATE", sourcePortId, destinationPortId),
		]);
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		try {
			const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
			candidates.push({
				ports: [sourcePortId, destinationPortId],
				trackRows: new Set(claims.leaseTrackResourceRows),
			});
		} catch {
			// A candidate adjacent to an unspecified branch is not eligible for this fixture search.
		}
	}
	for (let left = 0; left < candidates.length; left++) {
		for (let right = left + 1; right < candidates.length; right++) {
			const first = candidates[left];
			const second = candidates[right];
			if (first && second && [...first.trackRows].every((row) => !second.trackRows.has(row))) {
				return [first.ports, second.ports];
			}
		}
	}
	throw new Error("Public runtime fixture did not provide two disjoint extended routes.");
}

async function switchRuntimeFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts(),
	);
	for (const [sourcePortId, destinationPortId] of [
		[1, 2],
		[2, 1],
	] as const) {
		try {
			const fixture = await runtimeFixture(
				[
					transfer("SWITCH-OLDER", 0, 10, "LOAD-A", sourcePortId, destinationPortId),
					transfer("SWITCH-YOUNGER", 1, 10, "LOAD-B", sourcePortId, destinationPortId),
				],
				snapshot,
			);
			if (fixture.claims.switchConflictClaimRows.length > 0) return fixture;
		} catch {
			// The opposite direction may own the unambiguous extended movement.
		}
	}
	throw new Error("Public switch runtime fixture did not produce a conflict claim.");
}

function manifestFor(
	records: readonly SimulationTransferPlanRecord[],
): SimulationTransferPlanManifest {
	return compileSimulationTransferPlanManifest({
		manifestId: "ADMISSION-RUNTIME-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: records.length,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records,
	});
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
