import { describe, expect, it } from "vitest";
import {
	compileSimulationReplayHistoryManifest,
	compileSimulationTransferPlanManifest,
	parseSimulationScenarioManifest,
	SIMULATION_SCENARIO_MAX_INPUT_RECORDS,
	SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	SIMULATION_SCENARIO_ORDERING_POLICY,
	serializeSimulationScenarioManifest,
	simulationScenarioManifestError,
} from "./SimulationScenarioManifest";

describe("SimulationScenarioManifest", () => {
	it("canonicalizes Transfer Plan records by integer time, explicit ordinal, and stable ID", () => {
		const first = compileSimulationTransferPlanManifest({
			...header(3),
			records: [
				transfer("T-3", 2, 20, 3, 4),
				transfer("T-2", 1, 10, 2, 3),
				transfer("T-1", 0, 10, 1, 2),
			],
		});
		const reordered = compileSimulationTransferPlanManifest({
			...header(3),
			records: [
				transfer("T-1", 0, 10, 1, 2),
				transfer("T-3", 2, 20, 3, 4),
				transfer("T-2", 1, 10, 2, 3),
			],
		});

		expect(first.orderingPolicy).toBe(SIMULATION_SCENARIO_ORDERING_POLICY);
		expect(first.records.map((record) => record.transferId)).toEqual(["T-1", "T-2", "T-3"]);
		expect(first.fingerprint).toBe(reordered.fingerprint);
		expect(simulationScenarioManifestError(first)).toBeNull();
	});

	it("keeps Replay History provenance and identity separate from Transfer Plan", () => {
		const plan = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("ROW-1", 0, 5, 1, 2)],
		});
		const replay = compileSimulationReplayHistoryManifest({
			...header(1),
			records: [
				{
					historyEventId: "ROW-1",
					sourceOrdinal: 0,
					observedTimeMicroseconds: 5,
					loadId: "LOAD-0",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});

		expect(plan.sourceKind).toBe("TRANSFER_PLAN");
		expect(replay.sourceKind).toBe("REPLAY_HISTORY");
		expect(plan.fingerprint).not.toBe(replay.fingerprint);
		expect(serializeSimulationScenarioManifest(replay)).not.toMatch(/sourceFingerprint|raw/i);
	});

	it("preserves the reviewed accepted/rejected boundary with bounded diagnostics", () => {
		const issues = Array.from({ length: SIMULATION_SCENARIO_MAX_REJECTION_ISSUES }, (_, index) => ({
			sourceOrdinal: index + 1,
			code: "UNMAPPED_PORT",
			message: `Rejected normalized row ${index + 1}`,
		}));
		const manifest = compileSimulationReplayHistoryManifest({
			...header(1 + issues.length + 1),
			inputRecordCount: 1 + issues.length + 1,
			rejectedRecordCount: issues.length + 1,
			rejectionIssues: issues,
			issuesTruncated: true,
			records: [
				{
					historyEventId: "E-ACCEPTED",
					sourceOrdinal: 0,
					observedTimeMicroseconds: 1,
					loadId: "LOAD-0",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});

		expect(manifest).toMatchObject({
			inputRecordCount: 130,
			acceptedRecordCount: 1,
			rejectedRecordCount: 129,
			issuesTruncated: true,
		});
		expect(manifest.rejectionIssues).toHaveLength(SIMULATION_SCENARIO_MAX_REJECTION_ISSUES);
	});

	it("round-trips canonical JSON and rejects fingerprint or canonical-order mutation", () => {
		const manifest = compileSimulationTransferPlanManifest({
			...header(2),
			records: [transfer("T-2", 1, 20, 2, 1), transfer("T-1", 0, 10, 1, 2)],
		});
		const restored = parseSimulationScenarioManifest(serializeSimulationScenarioManifest(manifest));

		expect(restored).toEqual(manifest);
		expect(() =>
			parseSimulationScenarioManifest(
				JSON.stringify({ ...manifest, fingerprint: "00000000:00000000" }),
			),
		).toThrow(/identity/i);
		expect(
			simulationScenarioManifestError({ ...manifest, records: [...manifest.records].reverse() }),
		).toMatch(/canonical order/i);
		expect(
			simulationScenarioManifestError({ ...manifest, rawSourceRow: "must-not-cross" }),
		).toMatch(/unexpected fields/i);
	});

	it("fails closed for duplicate source ordinals and non-integral microsecond time", () => {
		expect(() =>
			compileSimulationTransferPlanManifest({
				...header(2),
				records: [transfer("T-1", 0, 1, 1, 2), transfer("T-2", 0, 2, 2, 1)],
			}),
		).toThrow(/duplicated/i);
		expect(() =>
			compileSimulationTransferPlanManifest({
				...header(1),
				records: [transfer("T-1", 0, 1.5, 1, 2)],
			}),
		).toThrow(/ordinal or time/i);
	});

	it("rejects accepted/rejected ordinal overlap, out-of-domain ordinals, and issue reordering", () => {
		expect(() =>
			compileSimulationTransferPlanManifest({
				...header(2),
				rejectedRecordCount: 1,
				rejectionIssues: [
					{ sourceOrdinal: 0, code: "UNMAPPED_PORT", message: "Rejected normalized row 0" },
				],
				records: [transfer("T-1", 0, 1, 1, 2)],
			}),
		).toThrow(/inconsistent/i);
		expect(() =>
			compileSimulationTransferPlanManifest({
				...header(1),
				records: [transfer("T-1", 1, 1, 1, 2)],
			}),
		).toThrow(/inconsistent/i);

		const manifest = compileSimulationTransferPlanManifest({
			...header(3),
			rejectedRecordCount: 2,
			rejectionIssues: [
				{ sourceOrdinal: 2, code: "UNMAPPED_PORT", message: "Rejected normalized row 2" },
				{ sourceOrdinal: 1, code: "INVALID_TIME", message: "Rejected normalized row 1" },
			],
			records: [transfer("T-1", 0, 1, 1, 2)],
		});
		expect(
			simulationScenarioManifestError({
				...manifest,
				rejectionIssues: [...manifest.rejectionIssues].reverse(),
			}),
		).toMatch(/canonical order/i);
	});

	it("rejects a run asset above the public 100,000-record boundary", () => {
		expect(() =>
			compileSimulationTransferPlanManifest({
				...header(SIMULATION_SCENARIO_MAX_INPUT_RECORDS + 1),
				rejectedRecordCount: SIMULATION_SCENARIO_MAX_INPUT_RECORDS + 1,
				rejectionIssues: Array.from(
					{ length: SIMULATION_SCENARIO_MAX_REJECTION_ISSUES },
					(_, sourceOrdinal) => ({
						sourceOrdinal,
						code: "REJECTED",
						message: "Rejected normalized row",
					}),
				),
				issuesTruncated: true,
				records: [],
			}),
		).toThrow(/limit/i);
	});
});

function header(inputRecordCount: number) {
	return {
		manifestId: "SCENARIO-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function transfer(
	transferId: string,
	sourceOrdinal: number,
	releaseTimeMicroseconds: number,
	sourcePortId: number,
	destinationPortId: number,
) {
	return {
		transferId,
		sourceOrdinal,
		releaseTimeMicroseconds,
		loadId: `LOAD-${sourceOrdinal}`,
		sourcePortId,
		destinationPortId,
	};
}
