import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "./SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithMixedPorts } from "./SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "./SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "./SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "./SimulationScenarioManifest";
import {
	compileSimulationScenarioResourceRunConfiguration,
	SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE,
	type SimulationScenarioResourceRunConfigurationInput,
	simulationScenarioResourceRunConfigurationError,
	simulationScenarioResourceRunConfigurationMatchesPreparedSources,
	simulationScenarioResourceRunConfigurationMatchesSources,
	simulationScenarioResourceRunConfigurationTransfers,
} from "./SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "./SimulationScenarioRouteRequests";
import { compileSimulationScenarioServiceTiming } from "./SimulationScenarioServiceTiming";

describe("SimulationScenarioResourceRunConfiguration", () => {
	it("compiles exact EQ availability and named/background storage inventory", async () => {
		const prepared = await preparedFixture(1);
		const configuration = compile(prepared, windowedInput());

		expect(configuration.simulationRunnable).toBe(false);
		expect(configuration.missingRuntimeLayers).toEqual(["EXACT_SOURCE_RUN_AUTHORIZATION"]);
		expect([...configuration.eqEquipmentGroupIds]).toEqual([2]);
		expect([...configuration.eqConcurrentCapacities]).toEqual([2]);
		expect([...configuration.eqAvailabilityModeCodes]).toEqual([
			SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.WINDOWS,
		]);
		expect([...configuration.eqAvailabilityWindowOffsets]).toEqual([0, 2]);
		expect([...configuration.eqAvailabilityWindowStartsMicroseconds]).toEqual([0, 10_000_000]);
		expect([...configuration.eqAvailabilityWindowEndsMicroseconds]).toEqual([
			5_000_000, 20_000_000,
		]);
		expect([...configuration.storageEquipmentGroupIds]).toEqual([1, 3]);
		expect([...configuration.storageCapacityUnits]).toEqual([4, 8]);
		expect([...configuration.storageInitialOccupiedUnits]).toEqual([1, 1]);
		expect([...configuration.storageInitialNamedLoadOffsets]).toEqual([0, 1, 1]);
		expect([...configuration.storageInitialNamedLoadRows]).toEqual([0]);
		expect([...configuration.storageInitialAnonymousOccupiedUnits]).toEqual([0, 1]);
		expect([...configuration.initialLoadStorageResourceRows]).toEqual([0, -1]);
		expect(simulationScenarioResourceRunConfigurationError(configuration)).toBeNull();
	});

	it("canonicalizes input order and supports an explicit always-available EQ mode", async () => {
		const prepared = await preparedFixture(1);
		const first = compile(prepared, {
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 3,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
		});
		const second = compile(prepared, {
			initialStorageLoads: [{ equipmentGroupId: 1, loadId: "LOAD-A" }],
			eqResources: [
				{
					availabilityWindows: [],
					availabilityMode: "ALWAYS",
					concurrentCapacity: 3,
					equipmentGroupId: 2,
				},
			],
		});

		expect(first.fingerprint).toBe(second.fingerprint);
		expect([...first.eqAvailabilityModeCodes]).toEqual([
			SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.ALWAYS,
		]);
		expect([...first.eqAvailabilityWindowOffsets]).toEqual([0, 0]);
	});

	it("requires every and only used EQ destination group with coherent windows", async () => {
		const prepared = await preparedFixture(1);

		expect(() =>
			compile(prepared, { eqResources: [], initialStorageLoads: storageLoads() }),
		).toThrow(/every and only used destination group/i);
		expect(() =>
			compile(prepared, {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [{ startMicroseconds: 0, endMicroseconds: 1 }],
					},
				],
				initialStorageLoads: storageLoads(),
			}),
		).toThrow(/mode and windows are inconsistent/i);
		expect(() =>
			compile(prepared, {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "WINDOWS",
						availabilityWindows: [
							{ startMicroseconds: 0, endMicroseconds: 10 },
							{ startMicroseconds: 9, endMicroseconds: 20 },
						],
					},
				],
				initialStorageLoads: storageLoads(),
			}),
		).toThrow(/windows overlap/i);
	});

	it("requires an exact initial group for every storage-resident named load", async () => {
		const prepared = await preparedFixture(1);

		expect(() => compile(prepared, { ...windowedInput(), initialStorageLoads: [] })).toThrow(
			/name every storage-resident load/i,
		);
		expect(() =>
			compile(prepared, {
				...windowedInput(),
				initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 3 }],
			}),
		).toThrow(/initial storage group is inconsistent/i);

		const noInitialCapacity = await preparedFixture(0);
		expect(() => compile(noInitialCapacity, windowedInput())).toThrow(
			/more named loads than certified initial occupancy/i,
		);
	});

	it("matches exact sources and exposes only independent transferable columns", async () => {
		const prepared = await preparedFixture(1);
		const input = windowedInput();
		const configuration = compile(prepared, input);
		const transfers = simulationScenarioResourceRunConfigurationTransfers(configuration);

		expect(new Set(transfers).size).toBe(transfers.length);
		expect(
			simulationScenarioResourceRunConfigurationMatchesPreparedSources(
				prepared.snapshot,
				prepared.manifest,
				prepared.routes,
				prepared.claims,
				prepared.program,
				prepared.timing,
				configuration,
			),
		).toBe(true);
		expect(
			simulationScenarioResourceRunConfigurationMatchesSources(
				prepared.snapshot,
				prepared.manifest,
				prepared.routes,
				prepared.claims,
				prepared.program,
				prepared.timing,
				input,
				configuration,
			),
		).toBe(true);
		expect(
			simulationScenarioResourceRunConfigurationMatchesSources(
				prepared.snapshot,
				prepared.manifest,
				prepared.routes,
				prepared.claims,
				prepared.program,
				prepared.timing,
				{
					...input,
					eqResources: [{ ...input.eqResources[0], concurrentCapacity: 4 }],
				},
				configuration,
			),
		).toBe(false);
		configuration.eqConcurrentCapacities[0] = 99;
		expect(simulationScenarioResourceRunConfigurationError(configuration)).toMatch(/fingerprint/i);
		expect(
			simulationScenarioResourceRunConfigurationMatchesPreparedSources(
				prepared.snapshot,
				prepared.manifest,
				prepared.routes,
				prepared.claims,
				prepared.program,
				prepared.timing,
				configuration,
			),
		).toBe(false);
	});
});

function compile(
	prepared: Awaited<ReturnType<typeof preparedFixture>>,
	input: SimulationScenarioResourceRunConfigurationInput,
) {
	return compileSimulationScenarioResourceRunConfiguration(
		prepared.snapshot,
		prepared.manifest,
		prepared.routes,
		prepared.claims,
		prepared.program,
		prepared.timing,
		input,
	);
}

async function preparedFixture(storageInitialOccupiedUnits: number) {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(1_500, storageInitialOccupiedUnits),
	);
	const records: readonly SimulationTransferPlanRecord[] = [
		transfer("RESOURCE-EQ", 0, "LOAD-A", 1, 2),
		transfer("RESOURCE-STORAGE", 1, "LOAD-B", 2, 4),
	];
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "RESOURCE-RUN-1",
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
	return { snapshot, manifest, routes, claims, program, timing };
}

function windowedInput(): SimulationScenarioResourceRunConfigurationInput {
	return {
		eqResources: [
			{
				equipmentGroupId: 2,
				concurrentCapacity: 2,
				availabilityMode: "WINDOWS",
				availabilityWindows: [
					{ startMicroseconds: 10_000_000, endMicroseconds: 20_000_000 },
					{ startMicroseconds: 0, endMicroseconds: 5_000_000 },
				],
			},
		],
		initialStorageLoads: storageLoads(),
	};
}

function storageLoads() {
	return [{ loadId: "LOAD-A", equipmentGroupId: 1 }] as const;
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
		releaseTimeMicroseconds: sourceOrdinal * 10 + 10,
		loadId,
		sourcePortId,
		destinationPortId,
	};
}
