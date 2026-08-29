import { describe, expect, it } from "vitest";
import {
	decodeSimulationScenarioEditorRunAssetFile,
	parseSimulationScenarioEditorRunAsset,
	SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES,
} from "./SimulationScenarioEditorRunAssetFile";

describe("SimulationScenarioEditorRunAssetFile", () => {
	it("owns an exact Transfer Plan envelope without retaining private file metadata", () => {
		const input = transferPlanFile();
		const parsed = parseSimulationScenarioEditorRunAsset(input, "TRANSFER_PLAN");

		expect(Object.keys(parsed)).toEqual([
			"schemaVersion",
			"source",
			"serviceTimingInput",
			"resourceRunInput",
		]);
		expect(parsed.source).toMatchObject({
			sourceKind: "TRANSFER_PLAN",
			manifestId: "PLAN-PUBLIC-1",
			mappingVersion: 1,
		});
		expect(parsed.source.records).toHaveLength(2);
		expect(parsed.serviceTimingInput.eqProcessTimings).toHaveLength(1);
		expect(parsed.resourceRunInput.eqResources).toHaveLength(1);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.source.records)).toBe(true);
		expect(Object.isFrozen(parsed.source.records[0])).toBe(true);
		expect(Object.isFrozen(parsed.resourceRunInput.eqResources[0]?.availabilityWindows)).toBe(true);

		(input.source.records[0] as { loadId: string }).loadId = "MUTATED";
		const inputTiming = input.serviceTimingInput.eqProcessTimings[0];
		if (!inputTiming) throw new Error("Expected a timing fixture.");
		inputTiming.processingDurationMicroseconds = 99;
		expect((parsed.source.records[0] as { loadId: string }).loadId).toBe("LOAD-1");
		expect(parsed.serviceTimingInput.eqProcessTimings[0]?.processingDurationMicroseconds).toBe(
			1_000_000,
		);
	});

	it("keeps Transfer Plan and Replay History selection workflows disjoint", () => {
		expect(() =>
			parseSimulationScenarioEditorRunAsset(transferPlanFile(), "REPLAY_HISTORY"),
		).toThrow(/Replay History workflow/);
		const history = replayHistoryFile();
		expect(parseSimulationScenarioEditorRunAsset(history, "REPLAY_HISTORY").source).toMatchObject({
			sourceKind: "REPLAY_HISTORY",
			manifestId: "HISTORY-PUBLIC-1",
		});
	});

	it("rejects unexpected envelope and configuration fields before controller adoption", () => {
		const extraEnvelope = { ...transferPlanFile(), localFileName: "private.json" };
		expect(() => parseSimulationScenarioEditorRunAsset(extraEnvelope, "TRANSFER_PLAN")).toThrow(
			/unexpected fields/,
		);

		const malformedTiming = transferPlanFile();
		const firstTiming = malformedTiming.serviceTimingInput.eqProcessTimings[0];
		if (!firstTiming) throw new Error("Expected a timing fixture.");
		Object.assign(firstTiming, { externalAlias: "EQ-X" });
		expect(() => parseSimulationScenarioEditorRunAsset(malformedTiming, "TRANSFER_PLAN")).toThrow(
			/timing record is malformed/,
		);
	});

	it("decodes only bounded UTF-8 JSON", () => {
		const bytes = new TextEncoder().encode(JSON.stringify(replayHistoryFile()));
		const parsed = decodeSimulationScenarioEditorRunAssetFile(
			bytes.buffer as ArrayBuffer,
			"REPLAY_HISTORY",
		);
		expect(parsed.source.sourceKind).toBe("REPLAY_HISTORY");

		expect(() =>
			decodeSimulationScenarioEditorRunAssetFile(Uint8Array.of(0xc3, 0x28).buffer, "TRANSFER_PLAN"),
		).toThrow(/valid UTF-8/);
		expect(() =>
			decodeSimulationScenarioEditorRunAssetFile(
				new ArrayBuffer(SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES + 1),
				"TRANSFER_PLAN",
			),
		).toThrow(/16 MiB/);
	});
});

function transferPlanFile() {
	return {
		schemaVersion: 1,
		source: {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "PLAN-PUBLIC-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "TRANSFER-1",
					releaseTimeMicroseconds: 10,
					loadId: "LOAD-1",
					sourcePortId: 1,
					destinationPortId: 2,
				},
				{
					transferId: "TRANSFER-2",
					releaseTimeMicroseconds: 20,
					loadId: "LOAD-2",
					sourcePortId: 2,
					destinationPortId: 3,
				},
			],
		},
		serviceTimingInput: {
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 1_000_000,
				},
			],
		},
		resourceRunInput: {
			eqResources: [
				{
					equipmentGroupId: 1,
					concurrentCapacity: 2,
					availabilityMode: "WINDOWS",
					availabilityWindows: [{ startMicroseconds: 0, endMicroseconds: 5_000_000 }],
				},
			],
			initialStorageLoads: [{ loadId: "LOAD-STORED", equipmentGroupId: 2 }],
		},
	};
}

function replayHistoryFile() {
	return {
		...transferPlanFile(),
		source: {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "HISTORY-PUBLIC-1",
			mappingVersion: 1,
			records: [
				{
					historyEventId: "HISTORY-1",
					observedTimeMicroseconds: 10,
					loadId: "LOAD-1",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
	};
}
