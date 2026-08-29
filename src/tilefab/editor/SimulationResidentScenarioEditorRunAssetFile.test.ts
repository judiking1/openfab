import { describe, expect, it } from "vitest";
import {
	decodeSimulationResidentScenarioEditorRunAssetFile,
	parseSimulationResidentScenarioEditorRunAsset,
	SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID,
	SIMULATION_RESIDENT_SCENARIO_EDITOR_MAX_FILE_BYTES,
} from "./SimulationResidentScenarioEditorRunAssetFile";
import { parseSimulationScenarioEditorRunAsset } from "./SimulationScenarioEditorRunAssetFile";

describe("SimulationResidentScenarioEditorRunAssetFile", () => {
	it("owns the distinct resident Plan envelope and exact public home-slot assignment rows", () => {
		const input = residentPlanEnvelope();
		const parsed = parseSimulationResidentScenarioEditorRunAsset(input, "TRANSFER_PLAN");

		expect(Object.keys(parsed)).toEqual([
			"schemaVersion",
			"profileId",
			"source",
			"serviceTimingInput",
			"resourceRunInput",
		]);
		expect(parsed).toMatchObject({
			schemaVersion: 1,
			profileId: SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID,
			source: {
				sourceKind: "TRANSFER_PLAN",
				manifestId: "RESIDENT-PLAN-PUBLIC-1",
			},
		});
		expect(parsed.source.records[0]).toEqual({
			transferId: "TRANSFER-1",
			releaseTimeMicroseconds: 0,
			loadId: "LOAD-1",
			vehicleId: "OHT-001",
			sourcePortId: 1,
			destinationPortId: 2,
		});
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.source.records[0])).toBe(true);

		(input.source.records[0] as { vehicleId: string }).vehicleId = "MUTATED";
		expect((parsed.source.records[0] as { vehicleId: string }).vehicleId).toBe("OHT-001");
	});

	it("cannot be parsed as the current scenario file and rejects current or foreign profiles", () => {
		const resident = residentPlanEnvelope();
		expect(() => parseSimulationScenarioEditorRunAsset(resident, "TRANSFER_PLAN")).toThrow(
			/unexpected fields/i,
		);
		const currentShape: Record<string, unknown> = { ...resident };
		delete currentShape.profileId;
		expect(() =>
			parseSimulationResidentScenarioEditorRunAsset(currentShape, "TRANSFER_PLAN"),
		).toThrow(/missing or unexpected/i);
		expect(() =>
			parseSimulationResidentScenarioEditorRunAsset(
				{ ...residentPlanEnvelope(), profileId: "FOREIGN_PROFILE" },
				"TRANSFER_PLAN",
			),
		).toThrow(/profile is unsupported/i);
	});

	it("keeps Plan and Replay workflows disjoint and decodes only bounded UTF-8 JSON", () => {
		expect(() =>
			parseSimulationResidentScenarioEditorRunAsset(residentPlanEnvelope(), "REPLAY_HISTORY"),
		).toThrow(/Replay History workflow/);
		const history = residentHistoryEnvelope();
		const bytes = new TextEncoder().encode(JSON.stringify(history));
		expect(
			decodeSimulationResidentScenarioEditorRunAssetFile(
				bytes.buffer as ArrayBuffer,
				"REPLAY_HISTORY",
			).source,
		).toMatchObject({
			sourceKind: "REPLAY_HISTORY",
			manifestId: "RESIDENT-HISTORY-PUBLIC-1",
		});
		expect(() =>
			decodeSimulationResidentScenarioEditorRunAssetFile(
				new ArrayBuffer(SIMULATION_RESIDENT_SCENARIO_EDITOR_MAX_FILE_BYTES + 1),
				"TRANSFER_PLAN",
			),
		).toThrow(/16 MiB/);
	});
});

function residentPlanEnvelope() {
	return {
		schemaVersion: 1,
		profileId: SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID,
		source: {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "RESIDENT-PLAN-PUBLIC-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "TRANSFER-1",
					releaseTimeMicroseconds: 0,
					loadId: "LOAD-1",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
		serviceTimingInput: { eqProcessTimings: [] },
		resourceRunInput: { eqResources: [], initialStorageLoads: [] },
	};
}

function residentHistoryEnvelope() {
	return {
		...residentPlanEnvelope(),
		source: {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "RESIDENT-HISTORY-PUBLIC-1",
			mappingVersion: 1,
			records: [
				{
					historyEventId: "HISTORY-1",
					observedTimeMicroseconds: 0,
					loadId: "LOAD-1",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
	};
}
