import { describe, expect, it } from "vitest";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import type { SimulationReadinessComponents } from "./SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts,
	buildSimulationReadinessTestComponentsWithMixedPorts,
} from "./SimulationReadinessTestFixture";
import { compileSimulationResidentCycleAdmissionProgram } from "./SimulationResidentCycleAdmissionProgram";
import { compileSimulationResidentCycleLeaseClaims } from "./SimulationResidentCycleLeaseClaims";
import { compileSimulationResidentCycleRoutes } from "./SimulationResidentCycleRoutes";
import {
	checksumSimulationResidentCycleServiceTiming,
	compileSimulationResidentCycleServiceTiming,
	SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MAX_TYPED_BYTES,
	SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MISSING_SAFETY_LAYERS,
	SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_POLICY,
	SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_SCHEMA_VERSION,
	type SimulationResidentCycleServiceTimingInput,
	simulationResidentCycleServiceTimingError,
	simulationResidentCycleServiceTimingMatchesSources,
	simulationResidentCycleServiceTimingTransfers,
} from "./SimulationResidentCycleServiceTiming";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import {
	compileSimulationResidentTransferPlanManifest,
	type SimulationResidentTransferPlanRecord,
} from "./SimulationResidentScenarioManifest";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";
import { SIMULATION_SCENARIO_SERVICE_KIND_CODE } from "./SimulationScenarioServiceTiming";

interface ResidentServiceFixtureBase {
	readonly components: SimulationReadinessComponents;
	readonly manifest: ReturnType<typeof compileSimulationResidentTransferPlanManifest>;
	readonly parking: ReturnType<typeof compileSimulationResidentFleetParkingConfiguration>;
	readonly routes: Awaited<ReturnType<typeof compileSimulationResidentCycleRoutes>>;
	readonly leaseClaims: ReturnType<typeof compileSimulationResidentCycleLeaseClaims>;
	readonly admissionProgram: ReturnType<typeof compileSimulationResidentCycleAdmissionProgram>;
	readonly input: SimulationResidentCycleServiceTimingInput;
}

describe("SimulationResidentCycleServiceTiming", () => {
	it("publishes a valid non-runnable empty timing artifact", async () => {
		const fixture = await residentFixture(
			buildSimulationReadinessTestComponentsWithMixedPorts(),
			0,
			[],
			{ eqProcessTimings: [] },
		);

		expect(fixture.timing).toMatchObject({
			schemaVersion: SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_SCHEMA_VERSION,
			simulationRunnable: false,
			missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MISSING_SAFETY_LAYERS,
			timingPolicy: SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_POLICY,
			requestCount: 0,
			eqProcessTimingCount: 0,
			byteLength: 0,
		});
		expect(simulationResidentCycleServiceTimingError(fixture.timing)).toBeNull();
	});

	it("binds explicit qualified EQ timing and reviewed OHB/STK minimum dwell", async () => {
		const components = buildSimulationReadinessTestComponentsWithMixedPorts(1_500);
		const ohbAndEq = await residentFixture(
			components,
			3,
			[record(0, "LOAD-A", 5, 1), record(1, "LOAD-B", 1, 2)],
			{
				eqProcessTimings: [
					{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 2_000_000 },
				],
			},
		);
		const stk = await residentFixture(components, 1, [record(0, "LOAD-C", 3, 4)], {
			eqProcessTimings: [],
		});

		expect([...ohbAndEq.timing.destinationEquipmentGroupIds]).toEqual([1, 2]);
		expect([...ohbAndEq.timing.serviceKindCodes]).toEqual([
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE,
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS,
		]);
		expect([...ohbAndEq.timing.eqCapabilityIds]).toEqual([0, 1]);
		expect([...ohbAndEq.timing.storagePolicyIds]).toEqual([1, 0]);
		expect([...ohbAndEq.timing.serviceDurationMicroseconds]).toEqual([1_500_000, 2_000_000]);
		expect([...stk.timing.serviceKindCodes]).toEqual([
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE,
		]);
		expect([...stk.timing.serviceDurationMicroseconds]).toEqual([1_500_000]);
		expect(checksumSimulationResidentCycleServiceTiming(ohbAndEq.timing)).toBe(
			ohbAndEq.timing.fingerprint,
		);
		expect(matches(ohbAndEq, ohbAndEq.input, ohbAndEq.timing)).toBe(true);
	});

	it("canonicalizes timing input independently of row order", async () => {
		const components = buildSimulationReadinessTestComponentsWithMixedPorts();
		const fixture = await residentFixture(
			components,
			4,
			[record(0, "LOAD-A", 1, 2), record(1, "LOAD-B", 1, 3)],
			{
				eqProcessTimings: [
					{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 20 },
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 10 },
				],
			},
		);
		const reversed = compileTiming(fixture, {
			eqProcessTimings: [...fixture.input.eqProcessTimings].reverse(),
		});

		expect(reversed.sourceTimingInputFingerprint).toBe(fixture.timing.sourceTimingInputFingerprint);
		expect(reversed.fingerprint).toBe(fixture.timing.fingerprint);
	});

	it("rejects missing, unqualified, foreign, duplicate, hidden, and storage-target EQ timing", async () => {
		const components = buildSimulationReadinessTestComponentsWithMixedPorts();
		const eqFixture = await residentFixture(components, 4, [record(0, "LOAD-A", 1, 2)], {
			eqProcessTimings: [{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 10 }],
		});
		const storageFixture = await residentFixture(components, 1, [record(0, "LOAD-B", 3, 4)], {
			eqProcessTimings: [],
		});

		expect(() => compileTiming(eqFixture, { eqProcessTimings: [] })).toThrow(
			/no explicit process timing/i,
		);
		expect(() =>
			compileTiming(eqFixture, {
				eqProcessTimings: [
					{ sourceOrdinal: 0, capabilityId: 99, processingDurationMicroseconds: 10 },
				],
			}),
		).toThrow(/not qualified/i);
		expect(() =>
			compileTiming(eqFixture, {
				eqProcessTimings: [
					{ sourceOrdinal: 999, capabilityId: 1, processingDurationMicroseconds: 10 },
				],
			}),
		).toThrow(/outside the manifest/i);
		expect(() =>
			compileTiming(eqFixture, {
				eqProcessTimings: [
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 10 },
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 20 },
				],
			}),
		).toThrow(/repeats source ordinal/i);
		expect(() =>
			compileTiming(eqFixture, {
				eqProcessTimings: [
					{
						sourceOrdinal: 0,
						capabilityId: 1,
						processingDurationMicroseconds: 10,
						rawRecipe: "must-not-cross",
					} as never,
				],
			}),
		).toThrow(/malformed/i);
		expect(() =>
			compileTiming(storageFixture, {
				eqProcessTimings: [
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 10 },
				],
			}),
		).toThrow(/storage destination/i);
	});

	it("rejects mutation and exact source/input drift", async () => {
		const fixture = await residentFixture(
			buildSimulationReadinessTestComponentsWithMixedPorts(),
			4,
			[record(0, "LOAD-A", 1, 2)],
			{
				eqProcessTimings: [
					{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 10 },
				],
			},
		);
		expect(
			simulationResidentCycleServiceTimingError({ ...fixture.timing, inferredRecipe: true }),
		).toMatch(/unexpected fields/i);
		fixture.timing.serviceDurationMicroseconds[0] = 11;
		expect(simulationResidentCycleServiceTimingError(fixture.timing)).toMatch(/fingerprint/i);

		const clean = compileTiming(fixture, fixture.input);
		const foreignInput = {
			eqProcessTimings: [{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 11 }],
		};
		expect(matches(fixture, foreignInput, clean)).toBe(false);
	});

	it("survives owned structured-clone transfer", async () => {
		const fixture = await residentFixture(
			buildSimulationReadinessTestComponentsWithMixedPorts(),
			1,
			[record(0, "LOAD-A", 3, 4)],
			{ eqProcessTimings: [] },
		);
		const transfers = simulationResidentCycleServiceTimingTransfers(fixture.timing);
		const transferred = structuredClone(fixture.timing, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationResidentCycleServiceTimingError(transferred)).toBeNull();
		expect(matches(fixture, fixture.input, transferred)).toBe(true);
	});

	it("retains the exact 100,000-request boundary within the timing memory cap", async () => {
		const requestCount = SIMULATION_SCENARIO_MAX_INPUT_RECORDS;
		const fixture = await residentFixture(
			buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8),
			1,
			Array.from({ length: requestCount }, (_, row) => record(row, `LOAD-${row}`, 2, 4)),
			{
				eqProcessTimings: Array.from({ length: requestCount }, (_, sourceOrdinal) => ({
					sourceOrdinal,
					capabilityId: 1,
					processingDurationMicroseconds: 1,
				})),
			},
		);

		expect(fixture.timing.requestCount).toBe(requestCount);
		expect(fixture.timing.byteLength).toBe(2_100_000);
		expect(fixture.timing.byteLength).toBeLessThan(
			SIMULATION_RESIDENT_CYCLE_SERVICE_TIMING_MAX_TYPED_BYTES,
		);
		expect(simulationResidentCycleServiceTimingError(fixture.timing)).toBeNull();
	}, 120_000);
});

async function residentFixture(
	components: SimulationReadinessComponents,
	homePortId: number,
	records: readonly SimulationResidentTransferPlanRecord[],
	input: SimulationResidentCycleServiceTimingInput,
): Promise<ResidentServiceFixtureBase & { timing: ReturnType<typeof compileTiming> }> {
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: homePortId === 0 ? 1 : 2,
			residentHomeSlots:
				homePortId === 0
					? []
					: [
							{
								id: 1,
								vehicleId: "OHT-001",
								anchorPortId: homePortId,
								policy: "DEDICATED_HOME_RETURN" as const,
							},
						],
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
	const parking = compileSimulationResidentFleetParkingConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		operational,
	);
	const manifest = compileSimulationResidentTransferPlanManifest(operational, {
		manifestId: "RESIDENT-SERVICE-1",
		adapterId: "OPENFAB_RESIDENT_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: records.length,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records,
	});
	const routes = await compileSimulationResidentCycleRoutes(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.stationCapabilities,
		manifest,
		parking,
	);
	const leaseClaims = compileSimulationResidentCycleLeaseClaims(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		parking,
		routes,
	);
	const admissionProgram = compileSimulationResidentCycleAdmissionProgram(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		manifest,
		parking,
		routes,
		leaseClaims,
	);
	const fixture = { components, manifest, parking, routes, leaseClaims, admissionProgram, input };
	return { ...fixture, timing: compileTiming(fixture, input) };
}

function compileTiming(
	fixture: ResidentServiceFixtureBase,
	input: SimulationResidentCycleServiceTimingInput,
) {
	return compileSimulationResidentCycleServiceTiming(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.components.equipmentResources,
		fixture.manifest,
		fixture.parking,
		fixture.routes,
		fixture.leaseClaims,
		fixture.admissionProgram,
		input,
	);
}

function matches(
	fixture: ResidentServiceFixtureBase,
	input: SimulationResidentCycleServiceTimingInput,
	timing: ReturnType<typeof compileTiming>,
) {
	return simulationResidentCycleServiceTimingMatchesSources(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.components.equipmentResources,
		fixture.manifest,
		fixture.parking,
		fixture.routes,
		fixture.leaseClaims,
		fixture.admissionProgram,
		input,
		timing,
	);
}

function record(
	sourceOrdinal: number,
	loadId: string,
	sourcePortId: number,
	destinationPortId: number,
): SimulationResidentTransferPlanRecord {
	return {
		transferId: `TRANSFER-${sourceOrdinal}`,
		sourceOrdinal,
		releaseTimeMicroseconds: sourceOrdinal,
		loadId,
		vehicleId: "OHT-001",
		sourcePortId,
		destinationPortId,
	};
}
