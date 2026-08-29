import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "./SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "./SimulationReadinessTestFixture";
import {
	compileSimulationScenarioAdmissionProgram,
	SIMULATION_SCENARIO_ADMISSION_MISSING_RUNTIME_LAYERS,
	simulationScenarioAdmissionProgramError,
	simulationScenarioAdmissionProgramMatchesSources,
	simulationScenarioAdmissionProgramTransfers,
} from "./SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "./SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "./SimulationScenarioManifest";
import { compileSimulationScenarioRouteRequests } from "./SimulationScenarioRouteRequests";

describe("SimulationScenarioAdmissionProgram", () => {
	it("publishes a valid non-runnable empty program", async () => {
		const fixture = await programFixture([]);

		expect(fixture.program).toMatchObject({
			simulationRunnable: false,
			missingRuntimeLayers: SIMULATION_SCENARIO_ADMISSION_MISSING_RUNTIME_LAYERS,
			requestCount: 0,
			loadCount: 0,
		});
		expect(simulationScenarioAdmissionProgramError(fixture.program)).toBeNull();
		expect(
			simulationScenarioAdmissionProgramMatchesSources(
				fixture.snapshot,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.program,
			),
		).toBe(true);
	});

	it("assigns stable token IDs and load rows independently of first occurrence order", async () => {
		const fixture = await programFixture([
			transfer("FIRST-Z", 0, 10, "LOAD-Z", 2, 1),
			transfer("FIRST-A", 1, 20, "LOAD-A", 2, 1),
		]);

		expect([...fixture.program.requestVehicleTokenIds]).toEqual([1, 2]);
		expect([...fixture.program.requestLoadRows]).toEqual([1, 0]);
		expect([...fixture.program.predecessorRequestRows]).toEqual([-1, -1]);
		expect([...fixture.program.successorRequestRows]).toEqual([-1, -1]);
		expect(fixture.program.loadCount).toBe(2);
	});

	it("compiles one exact sequential FOUP custody chain", async () => {
		const fixture = await programFixture([
			transfer("LEG-1", 0, 10, "LOAD-CHAIN", 2, 1),
			transfer("LEG-2", 1, 20, "LOAD-CHAIN", 1, 2),
		]);

		expect([...fixture.program.requestLoadRows]).toEqual([0, 0]);
		expect([...fixture.program.predecessorRequestRows]).toEqual([-1, 0]);
		expect([...fixture.program.successorRequestRows]).toEqual([1, -1]);
		expect(fixture.program.initialCustodyStationRows[0]).toBe(fixture.routes.sourceStationRows[0]);
		expect(simulationScenarioAdmissionProgramError(fixture.program)).toBeNull();
	});

	it("rejects a repeated load whose next source is not the previous destination", async () => {
		const snapshot = readySnapshot();
		const manifest = manifestFor([
			transfer("BROKEN-1", 0, 10, "LOAD-BROKEN", 2, 1),
			transfer("BROKEN-2", 1, 20, "LOAD-BROKEN", 2, 1),
		]);
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);

		expect(() =>
			compileSimulationScenarioAdmissionProgram(snapshot, manifest, routes, claims),
		).toThrow(/does not continue from its previous destination port/i);
	});

	it("rejects mutation, hidden fields, and foreign source adoption", async () => {
		const fixture = await programFixture([transfer("BOUND", 0, 10, "LOAD-1", 2, 1)]);
		const foreign = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(40),
		);

		expect(
			simulationScenarioAdmissionProgramError({ ...fixture.program, rawLoadId: "must-not-cross" }),
		).toMatch(/unexpected fields/i);
		expect(
			simulationScenarioAdmissionProgramMatchesSources(
				foreign,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.program,
			),
		).toBe(false);
		fixture.program.requestLoadRows[0] = 99;
		expect(simulationScenarioAdmissionProgramError(fixture.program)).toMatch(/custody chains/i);
	});

	it("survives structured cloning through independently owned columns", async () => {
		const fixture = await programFixture([
			transfer("COPY-1", 0, 10, "LOAD-1", 2, 1),
			transfer("COPY-2", 1, 20, "LOAD-1", 1, 2),
		]);
		const transfers = simulationScenarioAdmissionProgramTransfers(fixture.program);
		const transferred = structuredClone(fixture.program, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationScenarioAdmissionProgramError(transferred)).toBeNull();
		expect(
			simulationScenarioAdmissionProgramMatchesSources(
				fixture.snapshot,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				transferred,
			),
		).toBe(true);
	});
});

function readySnapshot() {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

async function programFixture(records: readonly SimulationTransferPlanRecord[]) {
	const snapshot = readySnapshot();
	const manifest = manifestFor(records);
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const leaseClaims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const program = compileSimulationScenarioAdmissionProgram(
		snapshot,
		manifest,
		routes,
		leaseClaims,
	);
	return { snapshot, manifest, routes, leaseClaims, program };
}

function manifestFor(records: readonly SimulationTransferPlanRecord[]) {
	return compileSimulationTransferPlanManifest({
		manifestId: "ADMISSION-PROGRAM-1",
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
