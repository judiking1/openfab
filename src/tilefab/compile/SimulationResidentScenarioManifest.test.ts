import { describe, expect, it } from "vitest";
import {
	checksumOperationalConfiguration,
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts } from "./SimulationReadinessTestFixture";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import {
	checksumSimulationResidentScenarioManifest,
	compileSimulationResidentReplayHistoryManifest,
	compileSimulationResidentTransferPlanManifest,
	parseSimulationResidentScenarioManifest,
	SIMULATION_RESIDENT_SCENARIO_ASSIGNMENT_POLICY,
	SIMULATION_RESIDENT_SCENARIO_MANIFEST_SCHEMA_VERSION,
	SIMULATION_RESIDENT_SCENARIO_MISSING_SAFETY_LAYERS,
	serializeSimulationResidentScenarioManifest,
	simulationResidentScenarioManifestError,
	simulationResidentScenarioManifestMatchesOperationalConfiguration,
	simulationResidentScenarioManifestMatchesParkingConfiguration,
} from "./SimulationResidentScenarioManifest";
import {
	compileSimulationTransferPlanManifest,
	SIMULATION_SCENARIO_MAX_INPUT_RECORDS,
	SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	simulationScenarioManifestError,
} from "./SimulationScenarioManifest";

describe("SimulationResidentScenarioManifest", () => {
	it("canonicalizes explicit configured-vehicle Transfer Plan rows without becoming runnable", () => {
		const operational = reviewedOperations();
		const first = compileSimulationResidentTransferPlanManifest(operational, {
			...header(3),
			records: [
				plan("T-3", 2, 20, "OHT-002", 3, 4),
				plan("T-2", 1, 10, "OHT-002", 2, 3),
				plan("T-1", 0, 10, "OHT-001", 1, 2),
			],
		});
		const reordered = compileSimulationResidentTransferPlanManifest(operational, {
			...header(3),
			records: [...first.records].reverse(),
		});

		expect(first).toMatchObject({
			schemaVersion: SIMULATION_RESIDENT_SCENARIO_MANIFEST_SCHEMA_VERSION,
			simulationRunnable: false,
			vehicleAssignmentPolicy: SIMULATION_RESIDENT_SCENARIO_ASSIGNMENT_POLICY,
			missingSafetyLayers: SIMULATION_RESIDENT_SCENARIO_MISSING_SAFETY_LAYERS,
			sourceOperationalConfigurationFingerprint: checksumOperationalConfiguration(operational),
		});
		expect(first.records.map((record) => [record.transferId, record.vehicleId])).toEqual([
			["T-1", "OHT-001"],
			["T-2", "OHT-002"],
			["T-3", "OHT-002"],
		]);
		expect(first.fingerprint).toBe(reordered.fingerprint);
		expect(simulationResidentScenarioManifestError(first)).toBeNull();
		expect(
			simulationResidentScenarioManifestMatchesOperationalConfiguration(first, operational),
		).toBe(true);
	});

	it("keeps resident Replay History provenance separate from resident Transfer Plan", () => {
		const operational = reviewedOperations();
		const planManifest = compileSimulationResidentTransferPlanManifest(operational, {
			...header(1),
			records: [plan("ROW-1", 0, 5, "OHT-001", 1, 2)],
		});
		const replayManifest = compileSimulationResidentReplayHistoryManifest(operational, {
			...header(1),
			records: [
				{
					historyEventId: "ROW-1",
					sourceOrdinal: 0,
					observedTimeMicroseconds: 5,
					loadId: "LOAD-0",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});

		expect(replayManifest.sourceKind).toBe("REPLAY_HISTORY");
		expect(planManifest.fingerprint).not.toBe(replayManifest.fingerprint);
		expect(serializeSimulationResidentScenarioManifest(replayManifest)).not.toMatch(
			/rawSource|coordinate|sourceAlias/i,
		);
	});

	it("round-trips only against the same reviewed home-slot configuration", () => {
		const operational = reviewedOperations();
		const manifest = compileSimulationResidentTransferPlanManifest(operational, {
			...header(2),
			records: [plan("T-2", 1, 20, "OHT-002", 2, 1), plan("T-1", 0, 10, "OHT-001", 1, 2)],
		});
		const restored = parseSimulationResidentScenarioManifest(
			serializeSimulationResidentScenarioManifest(manifest),
			operational,
		);
		const foreignOperational = reviewOperationalConfiguration(
			{
				...operational,
				review: null,
				residentHomeSlots: [
					{ id: 1, vehicleId: "OHT-009", anchorPortId: 11, policy: "DEDICATED_HOME_RETURN" },
				],
			},
			{ revision: 8, authoredChecksum: "resident-source-b" },
		);

		expect(restored).toEqual(manifest);
		expect(
			simulationResidentScenarioManifestMatchesOperationalConfiguration(
				manifest,
				foreignOperational,
			),
		).toBe(false);
		expect(() =>
			parseSimulationResidentScenarioManifest(
				serializeSimulationResidentScenarioManifest(manifest),
				foreignOperational,
			),
		).toThrow(/reviewed operational configuration|no reviewed home slot/i);
	});

	it("rejects missing review, unknown vehicle assignment, hidden fields, and mutation", () => {
		const operational = reviewedOperations();
		expect(() =>
			compileSimulationResidentTransferPlanManifest(emptyOperationalConfigurationState(), {
				...header(0),
				records: [],
			}),
		).toThrow(/requires reviewed/i);
		expect(() =>
			compileSimulationResidentTransferPlanManifest(operational, {
				...header(1),
				records: [plan("T-1", 0, 10, "OHT-999", 1, 2)],
			}),
		).toThrow(/no reviewed home slot/i);
		expect(() =>
			compileSimulationResidentTransferPlanManifest(operational, {
				...header(1),
				records: [{ ...plan("T-1", 0, 10, "OHT-001", 1, 2), sourceAlias: "private" } as never],
			}),
		).toThrow(/unexpected fields/i);

		const manifest = compileSimulationResidentTransferPlanManifest(operational, {
			...header(1),
			records: [plan("T-1", 0, 10, "OHT-001", 1, 2)],
		});
		expect(
			simulationResidentScenarioManifestError({
				...manifest,
				records: [{ ...manifest.records[0], vehicleId: "OHT-002" }],
			}),
		).toMatch(/fingerprint/i);
		expect(
			simulationResidentScenarioManifestError({ ...manifest, rawSourceRow: "must-not-cross" }),
		).toMatch(/unexpected fields/i);
	});

	it("is structurally disjoint from the current runnable-profile manifest v1", () => {
		const operational = reviewedOperations();
		const resident = compileSimulationResidentTransferPlanManifest(operational, {
			...header(1),
			records: [plan("T-1", 0, 10, "OHT-001", 1, 2)],
		});
		const current = compileSimulationTransferPlanManifest({
			...header(1),
			records: [
				{
					transferId: "T-1",
					sourceOrdinal: 0,
					releaseTimeMicroseconds: 10,
					loadId: "LOAD-0",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});

		expect(simulationScenarioManifestError(resident)).not.toBeNull();
		expect(simulationResidentScenarioManifestError(current)).not.toBeNull();
		expect(checksumSimulationResidentScenarioManifest(resident)).toBe(resident.fingerprint);
	});

	it("matches parking evidence only when both derive from the exact same operational fingerprint", () => {
		const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
		const operational = reviewOperationalConfiguration(
			{
				...emptyOperationalConfigurationState(),
				nextResidentHomeSlotId: 3,
				residentHomeSlots: [
					{ id: 1, vehicleId: "OHT-001", anchorPortId: 1, policy: "DEDICATED_HOME_RETURN" },
					{ id: 2, vehicleId: "OHT-002", anchorPortId: 5, policy: "DEDICATED_HOME_RETURN" },
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
			...header(1),
			records: [plan("T-1", 0, 10, "OHT-001", 1, 2)],
		});

		expect(simulationResidentScenarioManifestMatchesParkingConfiguration(manifest, parking)).toBe(
			true,
		);
		const sameContentForeignReview = reviewOperationalConfiguration(
			{ ...operational, review: null },
			{
				revision: components.foundation.source.revision + 1,
				authoredChecksum: components.foundation.source.authoredChecksum,
			},
		);
		expect(
			simulationResidentScenarioManifestMatchesParkingConfiguration(
				compileSimulationResidentTransferPlanManifest(sameContentForeignReview, {
					...header(1),
					records: [plan("T-1", 0, 10, "OHT-001", 1, 2)],
				}),
				parking,
			),
		).toBe(false);
		expect(
			simulationResidentScenarioManifestMatchesParkingConfiguration(
				compileSimulationResidentTransferPlanManifest(reviewedOperations(), {
					...header(1),
					records: [plan("T-1", 0, 10, "OHT-001", 1, 2)],
				}),
				parking,
			),
		).toBe(false);
	});

	it("retains the exact public 100,000-row boundary with explicit vehicle assignment", () => {
		const operational = reviewedOperations();
		const manifest = compileSimulationResidentTransferPlanManifest(operational, {
			...header(SIMULATION_SCENARIO_MAX_INPUT_RECORDS),
			records: Array.from({ length: SIMULATION_SCENARIO_MAX_INPUT_RECORDS }, (_, row) =>
				plan(`T-${row}`, row, row, row % 2 === 0 ? "OHT-001" : "OHT-002", 1, 2),
			),
		});

		expect(manifest.acceptedRecordCount).toBe(SIMULATION_SCENARIO_MAX_INPUT_RECORDS);
		expect(manifest.records.at(-1)?.transferId).toBe("T-99999");
		expect(Object.isFrozen(manifest.records)).toBe(true);
		expect(simulationResidentScenarioManifestError(manifest)).toBeNull();

		expect(() =>
			compileSimulationResidentTransferPlanManifest(operational, {
				...header(SIMULATION_SCENARIO_MAX_INPUT_RECORDS + 1),
				rejectedRecordCount: SIMULATION_SCENARIO_MAX_INPUT_RECORDS + 1,
				rejectionIssues: Array.from(
					{ length: SIMULATION_SCENARIO_MAX_REJECTION_ISSUES },
					(_, sourceOrdinal) => ({
						sourceOrdinal,
						code: "REJECTED",
						message: "Rejected normalized resident row",
					}),
				),
				issuesTruncated: true,
				records: [],
			}),
		).toThrow(/limit/i);
	});
});

function reviewedOperations() {
	return reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 3,
			residentHomeSlots: [
				{ id: 1, vehicleId: "OHT-001", anchorPortId: 11, policy: "DEDICATED_HOME_RETURN" },
				{ id: 2, vehicleId: "OHT-002", anchorPortId: 22, policy: "DEDICATED_HOME_RETURN" },
			],
		},
		{ revision: 7, authoredChecksum: "resident-source-a" },
	);
}

function header(inputRecordCount: number) {
	return {
		manifestId: "RESIDENT-SCENARIO-1",
		adapterId: "OPENFAB_RESIDENT_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function plan(
	transferId: string,
	sourceOrdinal: number,
	releaseTimeMicroseconds: number,
	vehicleId: string,
	sourcePortId: number,
	destinationPortId: number,
) {
	return {
		transferId,
		sourceOrdinal,
		releaseTimeMicroseconds,
		loadId: `LOAD-${sourceOrdinal}`,
		vehicleId,
		sourcePortId,
		destinationPortId,
	};
}
