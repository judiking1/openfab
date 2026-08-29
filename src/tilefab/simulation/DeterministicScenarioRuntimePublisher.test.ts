import { describe, expect, it } from "vitest";
import {
	type PublishedSimulationReadinessSnapshot,
	publishSimulationReadinessSnapshot,
} from "../compile/SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponentsWithEqPorts,
	buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts,
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
import {
	DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE,
	DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE,
	type DeterministicScenarioRuntimePublication,
	DeterministicScenarioRuntimePublisher,
	deterministicScenarioRuntimePublicationError,
	deterministicScenarioRuntimePublicationTransfers,
} from "./DeterministicScenarioRuntimePublisher";

describe("DeterministicScenarioRuntimePublisher", () => {
	it("publishes independently owned typed KPI and pose columns only when simulation cadence is due", async () => {
		const scheduler = await schedulerFixture([transfer("PUBLISH", 0, 10, "LOAD-PUBLISH", 2, 1)]);
		const publisher = new DeterministicScenarioRuntimePublisher(scheduler, {
			cadenceMicroseconds: 100_000,
			maximumPoseCount: 8,
		});

		const initial = requiredPublication(publisher.publishIfDue());
		expect(initial).toMatchObject({
			sequence: 1,
			triggerCode: DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
			scheduledPublicationTimeMicroseconds: 0,
			sampledSimulationTimeMicroseconds: 0,
			eligiblePoseCount: 0,
			publishedPoseCount: 0,
			posesTruncated: false,
			resourceExecutionPrepared: false,
		});
		expect(kpi(initial, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_TOTAL)).toBe(1);
		expect(kpi(initial, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_WAITING_RELEASE)).toBe(1);
		expect(deterministicScenarioRuntimePublicationError(initial)).toBeNull();
		const transfers = deterministicScenarioRuntimePublicationTransfers(initial);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(publisher.publishIfDue()).toBeNull();

		scheduler.advanceSimulationToTimeMicroseconds(100_000);
		const moving = requiredPublication(publisher.publishIfDue());
		expect(moving).toMatchObject({ sequence: 2, eligiblePoseCount: 1, publishedPoseCount: 1 });
		expect([...moving.poseRequestRows]).toEqual([0]);
		expect([...moving.poseVehicleTokenIds]).toEqual([1]);
		expect(moving.poseAnchorDistancesMeters[0]).toBeGreaterThan(0);
		expect(kpi(moving, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_IN_TRANSIT)).toBe(1);
		const schedulerPose = scheduler.worldPose(0);
		moving.poseWorldXMeters[0] = 123_456;
		expect(scheduler.worldPose(0)).toEqual(schedulerPose);
		expect(publisher.publishIfDue()).toBeNull();
	});

	it("reports a canonical truncated pose prefix without scanning for renderer priorities", async () => {
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(),
		);
		const [first, second] = await findDisjointTransfers(snapshot);
		const scheduler = await schedulerFixture(
			[
				transfer("POSE-0", 0, 10, "LOAD-0", first[0], first[1]),
				transfer("POSE-1", 1, 10, "LOAD-1", second[0], second[1]),
			],
			snapshot,
		);
		const publisher = new DeterministicScenarioRuntimePublisher(scheduler, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});
		publisher.publishIfDue();
		scheduler.advanceSimulationToTimeMicroseconds(1_000);

		const publication = requiredPublication(publisher.publishIfDue());
		expect(publication).toMatchObject({
			eligiblePoseCount: 2,
			publishedPoseCount: 1,
			posesTruncated: true,
		});
		expect([...publication.poseRequestRows]).toEqual([0]);
	});

	it("reports skipped simulation cadences and publishes one early terminal snapshot", async () => {
		const scheduler = await schedulerFixture([transfer("CADENCE", 0, 10, "LOAD-CADENCE", 2, 1)]);
		const publisher = new DeterministicScenarioRuntimePublisher(scheduler, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 8,
		});
		publisher.publishIfDue();
		scheduler.advanceSimulationToTimeMicroseconds(5_500);
		const delayed = requiredPublication(publisher.publishIfDue());
		expect(delayed).toMatchObject({
			scheduledPublicationTimeMicroseconds: 1_000,
			sampledSimulationTimeMicroseconds: 5_500,
			skippedCadenceCount: 4,
		});
		expect(publisher.nextScheduledPublicationTimeMicroseconds).toBe(6_000);

		const terminalScheduler = await schedulerFixture([
			transfer("TERMINAL", 0, 10, "LOAD-TERMINAL", 2, 1),
		]);
		const terminalPublisher = new DeterministicScenarioRuntimePublisher(terminalScheduler, {
			cadenceMicroseconds: 60_000_000,
			maximumPoseCount: 8,
		});
		terminalPublisher.publishIfDue();
		terminalScheduler.advanceSimulationToTimeMicroseconds(10);
		const completion = terminalScheduler.motionState(0)
			.scheduledCompletionTimeMicroseconds as number;
		terminalScheduler.advanceSimulationToTimeMicroseconds(completion);
		const terminal = requiredPublication(terminalPublisher.publishIfDue());
		expect(terminal).toMatchObject({
			triggerCode: DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL,
			scheduledPublicationTimeMicroseconds: completion,
			sampledSimulationTimeMicroseconds: completion,
			eligiblePoseCount: 0,
		});
		expect(terminalPublisher.nextScheduledPublicationTimeMicroseconds).toBe(
			Number.POSITIVE_INFINITY,
		);
		expect(terminalPublisher.publishIfDue()).toBeNull();
	});

	it.each(
		DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	)("publishes the same pose and KPI fingerprint at the same simulation time under %ix", async (multiplier) => {
		const record = transfer("SPEED-PUBLICATION", 0, 10, "LOAD-SPEED", 2, 1);
		const referenceScheduler = await schedulerFixture([record]);
		const acceleratedScheduler = await schedulerFixture([record]);
		const reference = new DeterministicScenarioRuntimePublisher(referenceScheduler, {
			cadenceMicroseconds: 100_000,
			maximumPoseCount: 8,
		});
		const accelerated = new DeterministicScenarioRuntimePublisher(acceleratedScheduler, {
			cadenceMicroseconds: 100_000,
			maximumPoseCount: 8,
		});
		reference.publishIfDue();
		accelerated.publishIfDue();
		referenceScheduler.advanceSimulationToTimeMicroseconds(1_000_000);
		acceleratedScheduler.advanceByWallClockMicroseconds(1_000_000 / multiplier, multiplier);

		const expected = requiredPublication(reference.publishIfDue());
		const actual = requiredPublication(accelerated.publishIfDue());
		expect(actual.fingerprint).toBe(expected.fingerprint);
		expect(actual).toEqual(expected);
	});

	it("publishes resource KPI counters without exposing mutable resource state", async () => {
		const scheduler = await resourceSchedulerFixture();
		const publisher = new DeterministicScenarioRuntimePublisher(scheduler, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 8,
		});
		publisher.publishIfDue();
		scheduler.advanceSimulationToTimeMicroseconds(1_000);
		const publication = requiredPublication(publisher.publishIfDue());

		expect(publication.resourceExecutionPrepared).toBe(true);
		expect(kpi(publication, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.STORAGE_RESOURCE_COUNT)).toBe(
			1,
		);
		expect(kpi(publication, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.STORAGE_RESERVED_UNITS)).toBe(
			1,
		);
		expect(
			kpi(publication, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_DESTINATION_REQUEST_COUNT),
		).toBe(1);
		expect(kpi(publication, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_NOT_ARRIVED)).toBe(1);

		scheduler.advanceSimulationToTimeMicroseconds(64_000_000);
		const terminal = requiredPublication(publisher.publishIfDue());
		expect(terminal.triggerCode).toBe(
			DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL,
		);
		expect(kpi(terminal, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_COMPLETED)).toBe(2);
		expect(kpi(terminal, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.DESTINATION_SERVICE_READY)).toBe(
			2,
		);
		expect(kpi(terminal, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_READY)).toBe(1);
		expect(kpi(terminal, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.STORAGE_RESERVED_UNITS)).toBe(0);
	});

	it("rejects unsafe publication budgets and corrupted or aliased snapshots", async () => {
		const scheduler = await schedulerFixture([transfer("INVALID", 0, 10, "LOAD-INVALID", 2, 1)]);
		expect(
			() =>
				new DeterministicScenarioRuntimePublisher(scheduler, {
					cadenceMicroseconds: 999,
					maximumPoseCount: 1,
				}),
		).toThrow(/cadence/i);
		expect(
			() =>
				new DeterministicScenarioRuntimePublisher(scheduler, {
					cadenceMicroseconds: 1_000,
					maximumPoseCount: 8_193,
				}),
		).toThrow(/poses/i);
		const publisher = new DeterministicScenarioRuntimePublisher(scheduler, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});
		const publication = requiredPublication(publisher.publishIfDue());
		const corrupted = {
			...publication,
			kpiValues: publication.kpiValues.slice(),
		};
		corrupted.kpiValues[10] = 999;
		expect(deterministicScenarioRuntimePublicationError(corrupted)).toMatch(/fingerprint/i);
		const aliased = {
			...publication,
			poseVehicleTokenIds: publication.poseRequestRows,
		};
		expect(deterministicScenarioRuntimePublicationError(aliased)).toMatch(/independently owned/i);
	});
});

async function schedulerFixture(
	records: readonly SimulationTransferPlanRecord[],
	snapshot: PublishedSimulationReadinessSnapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	),
) {
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "RUNTIME-PUBLICATION-1",
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

async function resourceSchedulerFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(),
	);
	const records = [
		transfer("RESOURCE-STORAGE", 0, 10, "LOAD-RESOURCE", 2, 1),
		transfer("RESOURCE-EQ", 1, 20, "LOAD-RESOURCE", 1, 3),
	];
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "RUNTIME-PUBLICATION-RESOURCE-1",
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

async function findDisjointTransfers(
	snapshot: PublishedSimulationReadinessSnapshot,
): Promise<readonly [readonly [number, number], readonly [number, number]]> {
	const candidates: Array<{
		readonly ports: readonly [number, number];
		readonly trackRows: ReadonlySet<number>;
	}> = [];
	for (let sourcePortId = 1; sourcePortId <= 8; sourcePortId++) {
		const destinationPortId = sourcePortId === 8 ? 1 : sourcePortId + 1;
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "RUNTIME-PUBLICATION-DISJOINT-1",
			adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: 1,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records: [transfer("CANDIDATE", 0, 10, "LOAD-CANDIDATE", sourcePortId, destinationPortId)],
		});
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		try {
			const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
			candidates.push({
				ports: [sourcePortId, destinationPortId],
				trackRows: new Set(claims.leaseTrackResourceRows),
			});
		} catch {
			// An unspecified branch candidate is intentionally ineligible.
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
	throw new Error("Public runtime fixture did not provide two disjoint routes.");
}

function requiredPublication(
	publication: DeterministicScenarioRuntimePublication | null,
): DeterministicScenarioRuntimePublication {
	if (!publication) throw new Error("Expected a due runtime publication.");
	return publication;
}

function kpi(publication: DeterministicScenarioRuntimePublication, code: number): number {
	const row = publication.kpiCodes.indexOf(code);
	if (row < 0) throw new Error(`Runtime KPI code ${code} is missing.`);
	return publication.kpiValues[row] as number;
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
