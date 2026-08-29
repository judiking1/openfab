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
import {
	checksumSimulationResidentCycleResourceRunConfiguration,
	compileSimulationResidentCycleResourceRunConfiguration,
	SIMULATION_RESIDENT_CYCLE_EQ_CAPACITY_POLICY,
	SIMULATION_RESIDENT_CYCLE_EQ_QUEUE_POLICY,
	SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_TYPED_BYTES,
	SIMULATION_RESIDENT_CYCLE_RESOURCE_MISSING_SAFETY_LAYERS,
	SIMULATION_RESIDENT_CYCLE_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION,
	SIMULATION_RESIDENT_CYCLE_STORAGE_RESERVATION_POLICY,
	type SimulationResidentCycleResourceRunConfigurationInput,
	simulationResidentCycleResourceRunConfigurationError,
	simulationResidentCycleResourceRunConfigurationMatchesPreparedSources,
	simulationResidentCycleResourceRunConfigurationMatchesSources,
	simulationResidentCycleResourceRunConfigurationTransfers,
} from "./SimulationResidentCycleResourceRunConfiguration";
import { compileSimulationResidentCycleRoutes } from "./SimulationResidentCycleRoutes";
import {
	compileSimulationResidentCycleServiceTiming,
	type SimulationResidentCycleServiceTimingInput,
} from "./SimulationResidentCycleServiceTiming";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import {
	compileSimulationResidentTransferPlanManifest,
	type SimulationResidentTransferPlanRecord,
} from "./SimulationResidentScenarioManifest";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";
import { SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE } from "./SimulationScenarioResourceRunConfiguration";

interface PreparedResidentResourceFixture {
	readonly components: SimulationReadinessComponents;
	readonly manifest: ReturnType<typeof compileSimulationResidentTransferPlanManifest>;
	readonly parking: ReturnType<typeof compileSimulationResidentFleetParkingConfiguration>;
	readonly routes: Awaited<ReturnType<typeof compileSimulationResidentCycleRoutes>>;
	readonly leaseClaims: ReturnType<typeof compileSimulationResidentCycleLeaseClaims>;
	readonly admissionProgram: ReturnType<typeof compileSimulationResidentCycleAdmissionProgram>;
	readonly serviceTiming: ReturnType<typeof compileSimulationResidentCycleServiceTiming>;
}

describe("SimulationResidentCycleResourceRunConfiguration", () => {
	it("publishes an empty non-runnable resource artifact without inventing activity", async () => {
		const prepared = await prepare(buildSimulationReadinessTestComponentsWithMixedPorts(), 1, [], {
			eqProcessTimings: [],
		});
		const configuration = compile(prepared, {
			eqResources: [],
			initialStorageLoads: [],
		});

		expect(configuration.requestCount).toBe(0);
		expect(configuration.loadCount).toBe(0);
		expect(configuration.eqResourceCount).toBe(0);
		expect(configuration.storageResourceCount).toBe(0);
		expect(configuration.byteLength).toBe(8);
		expect(simulationResidentCycleResourceRunConfigurationError(configuration)).toBeNull();
	});

	it("compiles exact EQ windows and named/background storage inventory", async () => {
		const prepared = await preparedFixture(1);
		const configuration = compile(prepared, windowedInput());

		expect(configuration).toMatchObject({
			schemaVersion: SIMULATION_RESIDENT_CYCLE_RESOURCE_RUN_CONFIGURATION_SCHEMA_VERSION,
			simulationRunnable: false,
			missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_RESOURCE_MISSING_SAFETY_LAYERS,
			eqCapacityPolicy: SIMULATION_RESIDENT_CYCLE_EQ_CAPACITY_POLICY,
			eqQueuePolicy: SIMULATION_RESIDENT_CYCLE_EQ_QUEUE_POLICY,
			storageReservationPolicy: SIMULATION_RESIDENT_CYCLE_STORAGE_RESERVATION_POLICY,
		});
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
		expect([...configuration.storageEquipmentGroupIds]).toEqual([1]);
		expect([...configuration.storageCapacityUnits]).toEqual([4]);
		expect([...configuration.storageInitialOccupiedUnits]).toEqual([1]);
		expect([...configuration.storageInitialNamedLoadOffsets]).toEqual([0, 1]);
		expect([...configuration.storageInitialNamedLoadRows]).toEqual([0]);
		expect([...configuration.storageInitialAnonymousOccupiedUnits]).toEqual([0]);
		expect([...configuration.initialLoadStorageResourceRows]).toEqual([0]);
		expect(checksumSimulationResidentCycleResourceRunConfiguration(configuration)).toBe(
			configuration.fingerprint,
		);
		expect(simulationResidentCycleResourceRunConfigurationError(configuration)).toBeNull();
	});

	it("includes an exact storage destination with reviewed anonymous occupancy", async () => {
		const components = buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 1);
		const prepared = await prepare(components, 1, [record(0, "LOAD-A", 3, 4)], {
			eqProcessTimings: [],
		});
		const configuration = compile(prepared, {
			eqResources: [],
			initialStorageLoads: [],
		});

		expect([...configuration.storageEquipmentGroupIds]).toEqual([3]);
		expect([...configuration.storageInitialOccupiedUnits]).toEqual([1]);
		expect([...configuration.storageInitialNamedLoadOffsets]).toEqual([0, 0]);
		expect([...configuration.storageInitialNamedLoadRows]).toEqual([]);
		expect([...configuration.storageInitialAnonymousOccupiedUnits]).toEqual([1]);
		expect([...configuration.initialLoadStorageResourceRows]).toEqual([-1]);
	});

	it("canonicalizes input and supports explicit always-available EQ mode", async () => {
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
			initialStorageLoads: storageLoads(),
		});
		const reordered = compile(prepared, {
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

		expect(first.fingerprint).toBe(reordered.fingerprint);
		expect([...first.eqAvailabilityModeCodes]).toEqual([
			SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.ALWAYS,
		]);
		expect([...first.eqAvailabilityWindowOffsets]).toEqual([0, 0]);
	});

	it("requires every used EQ group with coherent explicit windows", async () => {
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
		expect(() =>
			compile(prepared, {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
						inferredShift: "must-not-cross",
					} as never,
				],
				initialStorageLoads: storageLoads(),
			}),
		).toThrow(/malformed/i);
	});

	it("requires exact named initial storage and sufficient reviewed occupancy", async () => {
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
			/more named loads than reviewed initial occupancy/i,
		);
	});

	it("rejects hidden fields, mutation, and exact input drift", async () => {
		const prepared = await preparedFixture(1);
		const input = windowedInput();
		const configuration = compile(prepared, input);
		const sources = sourceBundle(prepared);

		expect(
			simulationResidentCycleResourceRunConfigurationError({
				...configuration,
				dynamicSubstitution: true,
			}),
		).toMatch(/unexpected fields/i);
		expect(
			simulationResidentCycleResourceRunConfigurationMatchesPreparedSources(sources, configuration),
		).toBe(true);
		expect(
			simulationResidentCycleResourceRunConfigurationMatchesSources(
				sources,
				{
					...input,
					eqResources: [{ ...input.eqResources[0], concurrentCapacity: 4 }],
				},
				configuration,
			),
		).toBe(false);
		const forged = {
			...configuration,
			storageCapacityUnits: configuration.storageCapacityUnits.slice(),
			fingerprint: "pending",
		};
		forged.storageCapacityUnits[0] = 5;
		forged.fingerprint = checksumSimulationResidentCycleResourceRunConfiguration(forged);
		expect(simulationResidentCycleResourceRunConfigurationError(forged)).toBeNull();
		expect(
			simulationResidentCycleResourceRunConfigurationMatchesPreparedSources(sources, forged),
		).toBe(false);
		configuration.eqConcurrentCapacities[0] = 99;
		expect(simulationResidentCycleResourceRunConfigurationError(configuration)).toMatch(
			/fingerprint/i,
		);
	});

	it("survives owned structured-clone transfer", async () => {
		const prepared = await preparedFixture(1);
		const input = windowedInput();
		const configuration = compile(prepared, input);
		const transfers = simulationResidentCycleResourceRunConfigurationTransfers(configuration);
		const transferred = structuredClone(configuration, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationResidentCycleResourceRunConfigurationError(transferred)).toBeNull();
		expect(
			simulationResidentCycleResourceRunConfigurationMatchesSources(
				sourceBundle(prepared),
				input,
				transferred,
			),
		).toBe(true);
	});

	it("retains the exact 100,000-request boundary within the resource memory cap", async () => {
		const requestCount = SIMULATION_SCENARIO_MAX_INPUT_RECORDS;
		const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
		const prepared = await prepare(
			components,
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
		const configuration = compile(prepared, {
			eqResources: [
				{
					equipmentGroupId: 1,
					concurrentCapacity: 100,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [],
		});

		expect(configuration.requestCount).toBe(requestCount);
		expect(configuration.byteLength).toBe(400_021);
		expect(configuration.byteLength).toBeLessThan(
			SIMULATION_RESIDENT_CYCLE_RESOURCE_MAX_TYPED_BYTES,
		);
		expect(simulationResidentCycleResourceRunConfigurationError(configuration)).toBeNull();
	}, 120_000);
});

function compile(
	prepared: PreparedResidentResourceFixture,
	input: SimulationResidentCycleResourceRunConfigurationInput,
) {
	return compileSimulationResidentCycleResourceRunConfiguration(
		prepared.components.foundation,
		prepared.components.trackResources,
		prepared.components.occupancyPolicy,
		prepared.components.equipmentResources,
		prepared.manifest,
		prepared.parking,
		prepared.routes,
		prepared.leaseClaims,
		prepared.admissionProgram,
		prepared.serviceTiming,
		input,
	);
}

async function preparedFixture(
	storageInitialOccupiedUnits: number,
): Promise<PreparedResidentResourceFixture> {
	return prepare(
		buildSimulationReadinessTestComponentsWithMixedPorts(1_500, storageInitialOccupiedUnits),
		3,
		[record(0, "LOAD-A", 1, 2)],
		{
			eqProcessTimings: [
				{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 2_000_000 },
			],
		},
	);
}

async function prepare(
	components: SimulationReadinessComponents,
	homePortId: number,
	records: readonly SimulationResidentTransferPlanRecord[],
	timingInput: SimulationResidentCycleServiceTimingInput,
): Promise<PreparedResidentResourceFixture> {
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 2,
			residentHomeSlots: [
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
		manifestId: "RESIDENT-RESOURCE-1",
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
	const serviceTiming = compileSimulationResidentCycleServiceTiming(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		timingInput,
	);
	return {
		components,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
	};
}

function sourceBundle(prepared: PreparedResidentResourceFixture) {
	return {
		foundation: prepared.components.foundation,
		trackResources: prepared.components.trackResources,
		occupancyPolicy: prepared.components.occupancyPolicy,
		equipmentResources: prepared.components.equipmentResources,
		manifest: prepared.manifest,
		parking: prepared.parking,
		routes: prepared.routes,
		leaseClaims: prepared.leaseClaims,
		admissionProgram: prepared.admissionProgram,
		serviceTiming: prepared.serviceTiming,
	};
}

function windowedInput(): SimulationResidentCycleResourceRunConfigurationInput {
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
