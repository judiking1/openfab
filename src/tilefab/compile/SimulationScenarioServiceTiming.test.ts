import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "./SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponentsWithEqPorts,
	buildSimulationReadinessTestComponentsWithMixedPorts,
} from "./SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "./SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "./SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "./SimulationScenarioManifest";
import { compileSimulationScenarioRouteRequests } from "./SimulationScenarioRouteRequests";
import {
	compileSimulationScenarioServiceTiming,
	SIMULATION_SCENARIO_SERVICE_KIND_CODE,
	type SimulationScenarioServiceTimingInput,
	simulationScenarioServiceTimingError,
	simulationScenarioServiceTimingMatchesSources,
	simulationScenarioServiceTimingTransfers,
} from "./SimulationScenarioServiceTiming";

describe("SimulationScenarioServiceTiming", () => {
	it("binds explicit qualified EQ steps and certified OHB/STK minimum dwell", async () => {
		const fixture = await serviceFixture();

		expect([...fixture.timing.destinationEquipmentGroupIds]).toEqual([2, 1, 3, 2]);
		expect([...fixture.timing.serviceKindCodes]).toEqual([
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS,
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.OHB_STORAGE,
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.STK_STORAGE,
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS,
		]);
		expect([...fixture.timing.eqCapabilityIds]).toEqual([1, 0, 0, 1]);
		expect([...fixture.timing.storagePolicyIds]).toEqual([0, 1, 1, 0]);
		expect([...fixture.timing.serviceDurationMicroseconds]).toEqual([
			2_000_000, 1_500_000, 1_500_000, 2_500_000,
		]);
		expect(fixture.timing.eqProcessTimingCount).toBe(2);
		expect(simulationScenarioServiceTimingError(fixture.timing)).toBeNull();
		expect(
			simulationScenarioServiceTimingMatchesSources(
				fixture.snapshot,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.admissionProgram,
				fixture.input,
				fixture.timing,
			),
		).toBe(true);
	});

	it("canonicalizes timing input independently of row order", async () => {
		const fixture = await serviceFixture();
		const reversedInput = {
			eqProcessTimings: [...fixture.input.eqProcessTimings].reverse(),
		};
		const reordered = compileSimulationScenarioServiceTiming(
			fixture.snapshot,
			fixture.manifest,
			fixture.routes,
			fixture.leaseClaims,
			fixture.admissionProgram,
			reversedInput,
		);

		expect(reordered.sourceTimingInputFingerprint).toBe(
			fixture.timing.sourceTimingInputFingerprint,
		);
		expect(reordered.fingerprint).toBe(fixture.timing.fingerprint);
	});

	it("rejects missing, foreign, unqualified, duplicate, and storage-target EQ timing", async () => {
		const fixture = await serviceFixture();
		const compile = (input: SimulationScenarioServiceTimingInput) =>
			compileSimulationScenarioServiceTiming(
				fixture.snapshot,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.admissionProgram,
				input,
			);

		expect(() => compile({ eqProcessTimings: [] })).toThrow(/no explicit process timing/i);
		expect(() =>
			compile({
				eqProcessTimings: fixture.input.eqProcessTimings.map((record, index) =>
					index === 0 ? { ...record, capabilityId: 99 } : record,
				),
			}),
		).toThrow(/not qualified/i);
		expect(() =>
			compile({
				eqProcessTimings: [
					...fixture.input.eqProcessTimings,
					{ sourceOrdinal: 1, capabilityId: 1, processingDurationMicroseconds: 1 },
				],
			}),
		).toThrow(/storage destination/i);
		expect(() =>
			compile({
				eqProcessTimings: [
					...fixture.input.eqProcessTimings,
					fixture.input.eqProcessTimings[0] as (typeof fixture.input.eqProcessTimings)[number],
				],
			}),
		).toThrow(/repeats source ordinal/i);
		expect(() =>
			compile({
				eqProcessTimings: [
					...fixture.input.eqProcessTimings,
					{ sourceOrdinal: 999, capabilityId: 1, processingDurationMicroseconds: 1 },
				],
			}),
		).toThrow(/outside the manifest/i);
		expect(() =>
			compile({
				eqProcessTimings: [
					{
						...fixture.input.eqProcessTimings[0],
						rawProcessName: "must-not-cross",
					} as never,
					fixture.input.eqProcessTimings[1] as (typeof fixture.input.eqProcessTimings)[number],
				],
			}),
		).toThrow(/malformed/i);
	});

	it("detects timing mutation and foreign timing-input adoption", async () => {
		const fixture = await serviceFixture();
		const foreignInput = {
			eqProcessTimings: fixture.input.eqProcessTimings.map((record, index) =>
				index === 0
					? { ...record, processingDurationMicroseconds: record.processingDurationMicroseconds + 1 }
					: record,
			),
		};

		expect(
			simulationScenarioServiceTimingMatchesSources(
				fixture.snapshot,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.admissionProgram,
				foreignInput,
				fixture.timing,
			),
		).toBe(false);
		fixture.timing.serviceDurationMicroseconds[0] += 1;
		expect(simulationScenarioServiceTimingError(fixture.timing)).toMatch(/fingerprint/i);
	});

	it("survives structured cloning through independently owned columns", async () => {
		const fixture = await serviceFixture();
		const transfers = simulationScenarioServiceTimingTransfers(fixture.timing);
		const transferred = structuredClone(fixture.timing, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationScenarioServiceTimingError(transferred)).toBeNull();
		expect(
			simulationScenarioServiceTimingMatchesSources(
				fixture.snapshot,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.admissionProgram,
				fixture.input,
				transferred,
			),
		).toBe(true);
	});

	it("fails source matching against another certified physical source", async () => {
		const fixture = await serviceFixture();
		const foreign = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(40),
		);

		expect(
			simulationScenarioServiceTimingMatchesSources(
				foreign,
				fixture.manifest,
				fixture.routes,
				fixture.leaseClaims,
				fixture.admissionProgram,
				fixture.input,
				fixture.timing,
			),
		).toBe(false);
	});
});

async function serviceFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithMixedPorts(),
	);
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "SERVICE-TIMING-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: 4,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records: [
			transfer("EQ-ONE", 0, 10, "LOAD-A", 2, 3),
			transfer("OHB-ONE", 1, 20, "LOAD-B", 2, 1),
			transfer("STK-ONE", 2, 30, "LOAD-C", 1, 4),
			transfer("EQ-TWO", 3, 40, "LOAD-D", 4, 2),
		],
	});
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const leaseClaims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const admissionProgram = compileSimulationScenarioAdmissionProgram(
		snapshot,
		manifest,
		routes,
		leaseClaims,
	);
	const input: SimulationScenarioServiceTimingInput = {
		eqProcessTimings: [
			{ sourceOrdinal: 3, capabilityId: 1, processingDurationMicroseconds: 2_500_000 },
			{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 2_000_000 },
		],
	};
	const timing = compileSimulationScenarioServiceTiming(
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		input,
	);
	return { snapshot, manifest, routes, leaseClaims, admissionProgram, input, timing };
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
