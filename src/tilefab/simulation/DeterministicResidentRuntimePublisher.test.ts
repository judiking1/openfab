import { describe, expect, it } from "vitest";
import { buildSimulationReadinessTestComponentsWithMixedPorts } from "../compile/SimulationReadinessTestFixture";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	buildSimulationResidentReadinessTestSources,
	residentReadinessTestRecord,
} from "../compile/SimulationResidentReadinessTestFixture";
import {
	consumeSimulationResidentRunAuthorization,
	issueSimulationResidentRunAuthorization,
} from "../compile/SimulationResidentRunAuthorization";
import {
	DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT,
	DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE,
	DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE,
	DeterministicResidentRuntimePublisher,
	deterministicResidentRuntimePublicationError,
} from "./DeterministicResidentRuntimePublisher";
import {
	adoptDeterministicResidentRuntimeState,
	type DeterministicResidentRuntimeState,
} from "./DeterministicResidentRuntimeState";

describe("DeterministicResidentRuntimePublisher", () => {
	it("publishes bounded idle/moving/terminal poses, KPIs, and semantic event tails", async () => {
		const { snapshot, runtime } = await residentRuntime();
		const publisher = new DeterministicResidentRuntimePublisher(snapshot, runtime, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});

		const initial = publisher.publishIfDue();
		expect(initial).not.toBeNull();
		expect(initial).toMatchObject({
			sequence: 1,
			triggerCode: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
			scheduledPublicationTimeMicroseconds: 0,
			sampledSimulationTimeMicroseconds: 0,
			eligiblePoseCount: 1,
			publishedPoseCount: 1,
			posesTruncated: false,
			coreEventCount: 0,
			resourceEventCount: 0,
		});
		expect(initial?.poseRequestRows[0]).toBe(-1);
		expect(initial?.poseLegIndices[0]).toBe(-1);
		expect(deterministicResidentRuntimePublicationError(initial)).toBeNull();
		expect(publisher.publishIfDue()).toBeNull();

		const legs = legDurations(snapshot, 0);
		const movingTime = Math.floor(legs[0] / 2);
		runtime.advanceSimulationToTimeMicroseconds(movingTime);
		const moving = publisher.publishIfDue();
		expect(moving).toMatchObject({
			sequence: 2,
			triggerCode: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
			scheduledPublicationTimeMicroseconds: 1_000,
			sampledSimulationTimeMicroseconds: movingTime,
			publishedCoreEventCount: 2,
		});
		expect(moving?.skippedCadenceCount).toBe(Math.floor((movingTime - 1_000) / 1_000));
		expect(moving?.poseRequestRows[0]).toBe(0);
		expect(moving?.poseLegIndices[0]).toBe(0);
		expect(moving?.poseLegAnchorDistancesMeters[0]).toBeGreaterThan(0);
		expect(moving?.coreEventTypeCodes).toEqual(Uint8Array.from([1, 2]));
		expect(deterministicResidentRuntimePublicationError(moving)).toBeNull();

		const terminalTime = Math.max(
			legs[0] + legs[1] + legs[2],
			legs[0] + legs[1] + (snapshot.serviceTiming.serviceDurationMicroseconds[0] as number),
		);
		runtime.advanceSimulationToTimeMicroseconds(terminalTime);
		const terminal = publisher.publishIfDue();
		expect(terminal).toMatchObject({
			sequence: 3,
			triggerCode: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL,
			coreEventCount: 5,
			publishedCoreEventCount: 5,
			resourceEventCount: 4,
			publishedResourceEventCount: 4,
		});
		expect(terminal?.poseRequestRows[0]).toBe(-1);
		expect(terminal?.poseLegIndices[0]).toBe(-1);
		expect(terminal?.kpiValues[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_COMPLETED - 1]).toBe(
			1,
		);
		expect(deterministicResidentRuntimePublicationError(terminal)).toBeNull();
		expect(publisher.nextScheduledPublicationTimeMicroseconds).toBe(Number.POSITIVE_INFINITY);
		expect(publisher.publishIfDue()).toBeNull();

		const forged = {
			...(terminal as NonNullable<typeof terminal>),
			poseWorldXMeters: (terminal as NonNullable<typeof terminal>).poseWorldXMeters.slice(),
		};
		forged.poseWorldXMeters[0] += 1;
		expect(deterministicResidentRuntimePublicationError(forged)).toMatch(/fingerprint/i);
		const invalidPosePhase = {
			...(terminal as NonNullable<typeof terminal>),
			poseVehiclePhaseCodes: (
				terminal as NonNullable<typeof terminal>
			).poseVehiclePhaseCodes.slice(),
		};
		invalidPosePhase.poseVehiclePhaseCodes[0] = 2;
		expect(deterministicResidentRuntimePublicationError(invalidPosePhase)).toMatch(/pose columns/i);
		const aliasedBuffer = {
			...(terminal as NonNullable<typeof terminal>),
			poseSourcePortIds: (terminal as NonNullable<typeof terminal>).poseDestinationPortIds,
		};
		expect(deterministicResidentRuntimePublicationError(aliasedBuffer)).toMatch(/accounting/i);
		expect(
			deterministicResidentRuntimePublicationError({
				...(terminal as NonNullable<typeof terminal>),
				unexpectedField: true,
			}),
		).toMatch(/unexpected/i);
	});

	it("retains only the fixed tail of each full semantic event stream", async () => {
		const requestCount = 4;
		const sources = await buildSimulationResidentReadinessTestSources({
			components: buildSimulationReadinessTestComponentsWithMixedPorts(1_500, requestCount),
			records: Array.from({ length: requestCount }, (_, row) =>
				residentReadinessTestRecord(row, `LOAD-${row}`, 1, 2),
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
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: Array.from({ length: requestCount }, (_, row) => ({
					loadId: `LOAD-${row}`,
					equipmentGroupId: 1,
				})),
			},
		});
		const adopted = await residentRuntimeFromSources(sources);
		const cycleDuration = legDurations(adopted.snapshot, 0).reduce((sum, value) => sum + value, 0);
		adopted.runtime.advanceSimulationToTimeMicroseconds(cycleDuration * requestCount);
		const publisher = new DeterministicResidentRuntimePublisher(adopted.snapshot, adopted.runtime, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});
		const terminal = publisher.publishIfDue();

		expect(terminal).toMatchObject({
			coreEventCount: requestCount * 5,
			publishedCoreEventCount: DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT,
			coreEventsTruncated: true,
			resourceEventCount: requestCount * 4,
			publishedResourceEventCount: DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT,
			resourceEventsTruncated: true,
		});
		expect(terminal?.coreEventSequences[0]).toBe(
			requestCount * 5 - DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT + 1,
		);
		expect(terminal?.resourceEventSequences[0]).toBe(
			requestCount * 4 - DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT + 1,
		);
		expect(deterministicResidentRuntimePublicationError(terminal)).toBeNull();
	});

	it("rejects unsafe cadence and pose bounds", async () => {
		const { snapshot, runtime } = await residentRuntime();
		expect(
			() =>
				new DeterministicResidentRuntimePublisher(snapshot, runtime, {
					cadenceMicroseconds: 999,
					maximumPoseCount: 1,
				}),
		).toThrow(/configuration/i);
		expect(
			() =>
				new DeterministicResidentRuntimePublisher(snapshot, runtime, {
					cadenceMicroseconds: 1_000,
					maximumPoseCount: 8_193,
				}),
		).toThrow(/configuration/i);
		expect(
			() =>
				new DeterministicResidentRuntimePublisher(snapshot, runtime, {
					cadenceMicroseconds: 1_000,
					maximumPoseCount: 1,
					unexpectedField: true,
				} as never),
		).toThrow(/configuration/i);
	});

	it("cannot publish through a stale reference after runtime disposal", async () => {
		const { snapshot, runtime } = await residentRuntime();
		const publisher = new DeterministicResidentRuntimePublisher(snapshot, runtime, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});
		expect(publisher.publishIfDue()).not.toBeNull();
		expect(runtime.dispose("EXPLICIT_STOP")).toBe(true);
		expect(() => publisher.publishIfDue()).toThrow(/disposed/i);
	});
});

async function residentRuntime() {
	return residentRuntimeFromSources(await buildSimulationResidentReadinessTestSources());
}

async function residentRuntimeFromSources(
	sources: Awaited<ReturnType<typeof buildSimulationResidentReadinessTestSources>>,
): Promise<{
	snapshot: Awaited<ReturnType<typeof publishSimulationResidentReadinessSnapshot>>;
	runtime: DeterministicResidentRuntimeState;
}> {
	const snapshot = await publishSimulationResidentReadinessSnapshot(sources);
	const input = {
		projectId: "PROJECT-RESIDENT-PUBLISHER-1",
		preparationGeneration: 1,
		authorizationGeneration: 1,
		runAssetFingerprint: "resident-publisher-asset-1",
		snapshot,
	};
	const grant = await issueSimulationResidentRunAuthorization(input);
	const runtime = await consumeSimulationResidentRunAuthorization(
		grant,
		input,
		(authorization, exactSnapshot, adoption) =>
			adoptDeterministicResidentRuntimeState(authorization, exactSnapshot, adoption),
	);
	if (!runtime) throw new Error("Expected resident runtime adoption for publication.");
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
