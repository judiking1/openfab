import { describe, expect, it } from "vitest";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts } from "./SimulationReadinessTestFixture";
import {
	checksumSimulationResidentCycleAdmissionProgram,
	compileSimulationResidentCycleAdmissionProgram,
	SIMULATION_RESIDENT_CYCLE_ADMISSION_MAX_TYPED_BYTES,
	SIMULATION_RESIDENT_CYCLE_ADMISSION_MISSING_SAFETY_LAYERS,
	SIMULATION_RESIDENT_CYCLE_ADMISSION_PROGRAM_SCHEMA_VERSION,
	SIMULATION_RESIDENT_LOAD_CHAIN_POLICY,
	SIMULATION_RESIDENT_LOAD_ORDERING_POLICY,
	SIMULATION_RESIDENT_VEHICLE_CHAIN_POLICY,
	SIMULATION_RESIDENT_VEHICLE_ORDERING_POLICY,
	simulationResidentCycleAdmissionProgramError,
	simulationResidentCycleAdmissionProgramMatchesSources,
	simulationResidentCycleAdmissionProgramMatchesValidatedSources,
	simulationResidentCycleAdmissionProgramTransfers,
} from "./SimulationResidentCycleAdmissionProgram";
import { compileSimulationResidentCycleLeaseClaims } from "./SimulationResidentCycleLeaseClaims";
import { compileSimulationResidentCycleRoutes } from "./SimulationResidentCycleRoutes";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import {
	compileSimulationResidentTransferPlanManifest,
	type SimulationResidentTransferPlanRecord,
} from "./SimulationResidentScenarioManifest";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";

describe("SimulationResidentCycleAdmissionProgram", () => {
	it("publishes a valid non-runnable empty custody and vehicle program", async () => {
		const fixture = await residentFixture([]);
		const program = compileProgram(fixture);

		expect(program).toMatchObject({
			schemaVersion: SIMULATION_RESIDENT_CYCLE_ADMISSION_PROGRAM_SCHEMA_VERSION,
			simulationRunnable: false,
			missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_ADMISSION_MISSING_SAFETY_LAYERS,
			loadOrderingPolicy: SIMULATION_RESIDENT_LOAD_ORDERING_POLICY,
			loadChainPolicy: SIMULATION_RESIDENT_LOAD_CHAIN_POLICY,
			vehicleOrderingPolicy: SIMULATION_RESIDENT_VEHICLE_ORDERING_POLICY,
			vehicleChainPolicy: SIMULATION_RESIDENT_VEHICLE_CHAIN_POLICY,
			requestCount: 0,
			loadCount: 0,
			vehicleCount: 0,
		});
		expect(program.byteLength).toBe(0);
		expect(simulationResidentCycleAdmissionProgramError(program)).toBeNull();
	});

	it("canonically maps loads and serializes each resident vehicle through full home returns", async () => {
		const fixture = await residentFixture([record(0, "LOAD-B"), record(1, "LOAD-A")]);
		const program = compileProgram(fixture);

		expect([...program.requestLoadRows]).toEqual([1, 0]);
		expect([...program.loadPredecessorRequestRows]).toEqual([-1, -1]);
		expect([...program.loadSuccessorRequestRows]).toEqual([-1, -1]);
		expect([...program.initialCustodyStationRows]).toEqual([1, 1]);
		expect([...program.requestVehicleRows]).toEqual([0, 0]);
		expect([...program.vehiclePredecessorRequestRows]).toEqual([-1, 0]);
		expect([...program.vehicleSuccessorRequestRows]).toEqual([1, -1]);
		expect([...program.vehicleHomeSlotIds]).toEqual([1]);
		expect(checksumSimulationResidentCycleAdmissionProgram(program)).toBe(program.fingerprint);
		expect(matches(fixture, program)).toBe(true);
		expect(
			simulationResidentCycleAdmissionProgramMatchesValidatedSources(
				fixture.components.foundation,
				fixture.manifest,
				fixture.parking,
				fixture.routes,
				fixture.leaseClaims,
				program,
			),
		).toBe(true);
	});

	it("rejects a repeated load whose next pickup is not its previous destination", async () => {
		const fixture = await residentFixture([record(0, "LOAD-1"), record(1, "LOAD-1")]);

		expect(() => compileProgram(fixture)).toThrow(/previous destination port/i);
	});

	it("links a continuous repeated-load custody chain", async () => {
		const fixture = await residentFixture([record(0, "LOAD-1", 2, 4), record(1, "LOAD-1", 4, 5)]);
		const program = compileProgram(fixture);

		expect([...program.requestLoadRows]).toEqual([0, 0]);
		expect([...program.loadPredecessorRequestRows]).toEqual([-1, 0]);
		expect([...program.loadSuccessorRequestRows]).toEqual([1, -1]);
		expect([...program.initialCustodyStationRows]).toEqual([1]);
	});

	it("rejects hidden fields, mutation, and exact source drift", async () => {
		const fixture = await residentFixture([record(0, "LOAD-1")]);
		const program = compileProgram(fixture);
		expect(
			simulationResidentCycleAdmissionProgramError({ ...program, inferredCustody: true }),
		).toMatch(/unexpected fields/i);
		program.requestLoadRows[0] = 40;
		expect(simulationResidentCycleAdmissionProgramError(program)).toMatch(/chains|fingerprint/i);

		const clean = compileProgram(fixture);
		const foreign = await residentFixture([record(0, "LOAD-2")]);
		expect(matches(foreign, clean)).toBe(false);
	});

	it("survives owned structured-clone transfer", async () => {
		const fixture = await residentFixture([record(0, "LOAD-1")]);
		const program = compileProgram(fixture);
		const transfers = simulationResidentCycleAdmissionProgramTransfers(program);
		const transferred = structuredClone(program, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationResidentCycleAdmissionProgramError(transferred)).toBeNull();
		expect(matches(fixture, transferred)).toBe(true);
	});

	it("retains the exact 100,000-request boundary within the admission memory cap", async () => {
		const fixture = await residentFixture(
			Array.from({ length: SIMULATION_SCENARIO_MAX_INPUT_RECORDS }, (_, row) =>
				record(row, `LOAD-${row}`),
			),
		);
		const program = compileProgram(fixture);

		expect(program.requestCount).toBe(SIMULATION_SCENARIO_MAX_INPUT_RECORDS);
		expect(program.byteLength).toBe(2_800_004);
		expect(program.byteLength).toBeLessThan(SIMULATION_RESIDENT_CYCLE_ADMISSION_MAX_TYPED_BYTES);
		expect(simulationResidentCycleAdmissionProgramError(program)).toBeNull();
	}, 120_000);
});

async function residentFixture(records: readonly SimulationResidentTransferPlanRecord[]) {
	const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: records.length === 0 ? 1 : 2,
			residentHomeSlots:
				records.length === 0
					? []
					: [
							{
								id: 1,
								vehicleId: "OHT-001",
								anchorPortId: 1,
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
		manifestId: "RESIDENT-ADMISSION-1",
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
	return { components, manifest, parking, routes, leaseClaims };
}

function record(
	sourceOrdinal: number,
	loadId: string,
	sourcePortId = 2,
	destinationPortId = 4,
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

function compileProgram(fixture: Awaited<ReturnType<typeof residentFixture>>) {
	return compileSimulationResidentCycleAdmissionProgram(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.manifest,
		fixture.parking,
		fixture.routes,
		fixture.leaseClaims,
	);
}

function matches(
	fixture: Awaited<ReturnType<typeof residentFixture>>,
	program: ReturnType<typeof compileProgram>,
) {
	return simulationResidentCycleAdmissionProgramMatchesSources(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.manifest,
		fixture.parking,
		fixture.routes,
		fixture.leaseClaims,
		program,
	);
}
