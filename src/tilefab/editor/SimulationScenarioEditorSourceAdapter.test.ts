import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import {
	adaptSimulationScenarioEditorRunAsset,
	adaptSimulationScenarioEditorSource,
	SIMULATION_SCENARIO_EDITOR_ADAPTER_ID,
} from "./SimulationScenarioEditorSourceAdapter";

describe("SimulationScenarioEditorSourceAdapter", () => {
	it("keeps Transfer Plan and Replay History as distinct canonical run-local assets", () => {
		const snapshot = readySnapshot();
		const plan = adaptSimulationScenarioEditorSource(snapshot, {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "EDITOR-PLAN-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "PLAN-1",
					releaseTimeMicroseconds: 10,
					loadId: "LOAD-1",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});
		const replay = adaptSimulationScenarioEditorSource(snapshot, {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "EDITOR-REPLAY-1",
			mappingVersion: 1,
			records: [
				{
					historyEventId: "PLAN-1",
					observedTimeMicroseconds: 10,
					loadId: "LOAD-1",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});

		expect(plan).toMatchObject({
			sourceKind: "TRANSFER_PLAN",
			adapterId: SIMULATION_SCENARIO_EDITOR_ADAPTER_ID,
			inputRecordCount: 1,
			acceptedRecordCount: 1,
			rejectedRecordCount: 0,
		});
		expect(replay).toMatchObject({
			sourceKind: "REPLAY_HISTORY",
			adapterId: SIMULATION_SCENARIO_EDITOR_ADAPTER_ID,
		});
		expect(plan.fingerprint).not.toBe(replay.fingerprint);
		expect(Object.isFrozen(plan.records[0])).toBe(true);
		expect(Object.isFrozen(replay.records[0])).toBe(true);
	});

	it("drops unexpected raw fields and reports only a fixed public-safe rejection", () => {
		const manifest = adaptSimulationScenarioEditorSource(readySnapshot(), {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "EDITOR-PRIVATE-FIELD-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "PLAN-PRIVATE",
					releaseTimeMicroseconds: 10,
					loadId: "LOAD-PRIVATE",
					sourcePortId: 1,
					destinationPortId: 2,
					privateCustomerColumn: "must-not-cross",
				},
			],
		});

		expect(manifest.records).toEqual([]);
		expect(manifest.rejectionIssues).toEqual([
			{
				sourceOrdinal: 0,
				code: "MALFORMED_RECORD",
				message: "The reviewed row does not match the public OpenFab source schema.",
			},
		]);
		expect(JSON.stringify(manifest)).not.toContain("must-not-cross");
		expect(JSON.stringify(manifest)).not.toContain("privateCustomerColumn");
	});

	it("reconciles invalid time, identity, exact-certificate ports, duplicates, and same-port rows", () => {
		const manifest = adaptSimulationScenarioEditorSource(readySnapshot(), {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "EDITOR-REJECTIONS-1",
			mappingVersion: 2,
			records: [
				replay("VALID", 40, "LOAD-1", 1, 2),
				replay("BAD-TIME", -1, "LOAD-2", 1, 2),
				replay("BAD ID", 20, "LOAD-3", 1, 2),
				replay("VALID-2", 20, "LOAD-4", 99, 2),
				replay("VALID-3", 20, "LOAD-5", 1, 99),
				replay("VALID-4", 20, "LOAD-6", 1, 1),
				replay("VALID", 20, "LOAD-7", 1, 2),
			],
		});

		expect(manifest).toMatchObject({
			inputRecordCount: 7,
			acceptedRecordCount: 1,
			rejectedRecordCount: 6,
			issuesTruncated: false,
		});
		expect(manifest.rejectionIssues.map((issue) => issue.code)).toEqual([
			"INVALID_TIME",
			"INVALID_RECORD_ID",
			"UNKNOWN_SOURCE_PORT",
			"UNKNOWN_DESTINATION_PORT",
			"SAME_SOURCE_DESTINATION",
			"DUPLICATE_RECORD_ID",
		]);
	});

	it("bounds disclosed issues while retaining exact accepted/rejected reconciliation", () => {
		const records = Array.from({ length: 140 }, (_, row) => replay(`ROW-${row}`, -1, "LOAD", 1, 2));
		const manifest = adaptSimulationScenarioEditorSource(readySnapshot(), {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "EDITOR-BOUNDED-ISSUES-1",
			mappingVersion: 1,
			records,
		});

		expect(manifest).toMatchObject({
			inputRecordCount: 140,
			acceptedRecordCount: 0,
			rejectedRecordCount: 140,
			issuesTruncated: true,
		});
		expect(manifest.rejectionIssues).toHaveLength(128);
	});

	it("owns immutable timing and resource copies without retaining caller arrays", () => {
		const source = {
			sourceKind: "TRANSFER_PLAN" as const,
			manifestId: "EDITOR-ASSET-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "PLAN-1",
					releaseTimeMicroseconds: 10,
					loadId: "LOAD-1",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		};
		const timing = {
			eqProcessTimings: [
				{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 1_000_000 },
			],
		};
		const resources = {
			eqResources: [
				{
					equipmentGroupId: 1,
					concurrentCapacity: 1,
					availabilityMode: "ALWAYS" as const,
					availabilityWindows: [] as Array<{
						startMicroseconds: number;
						endMicroseconds: number;
					}>,
				},
			],
			initialStorageLoads: [] as Array<{ loadId: string; equipmentGroupId: number }>,
		};
		const asset = adaptSimulationScenarioEditorRunAsset(readySnapshot(), source, timing, resources);

		const timingRow = timing.eqProcessTimings[0];
		const resourceRow = resources.eqResources[0];
		if (!timingRow || !resourceRow) throw new Error("Expected mutable caller-owned input rows.");
		timingRow.processingDurationMicroseconds = 2_000_000;
		resourceRow.concurrentCapacity = 2;
		expect(asset.serviceTimingInput.eqProcessTimings[0]?.processingDurationMicroseconds).toBe(
			1_000_000,
		);
		expect(asset.resourceRunInput.eqResources[0]?.concurrentCapacity).toBe(1);
		expect(Object.isFrozen(asset.serviceTimingInput.eqProcessTimings)).toBe(true);
		expect(Object.isFrozen(asset.resourceRunInput.eqResources)).toBe(true);
	});
});

function readySnapshot() {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

function replay(
	historyEventId: string,
	observedTimeMicroseconds: number,
	loadId: string,
	sourcePortId: number,
	destinationPortId: number,
) {
	return {
		historyEventId,
		observedTimeMicroseconds,
		loadId,
		sourcePortId,
		destinationPortId,
	};
}
