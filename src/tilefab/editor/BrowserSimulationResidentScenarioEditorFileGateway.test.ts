import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSimulationResidentScenarioEditorFileGateway } from "./BrowserSimulationResidentScenarioEditorFileGateway";
import { SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID } from "./SimulationResidentScenarioEditorRunAssetFile";

describe("BrowserSimulationResidentScenarioEditorFileGateway", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("returns only the distinct parsed resident draft and discards local file identity", async () => {
		const bytes = new TextEncoder().encode(JSON.stringify(residentEnvelope()));
		let index = 0;
		const reader = {
			read: vi.fn(async () => {
				const value = index++ === 0 ? bytes : undefined;
				return value
					? ({ done: false, value } as ReadableStreamReadValueResult<Uint8Array>)
					: ({ done: true, value: undefined } as ReadableStreamReadDoneResult<Uint8Array>);
			}),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn(),
		};
		const file = {
			name: "private-customer-station-map-export.json",
			size: bytes.length,
			stream: () => ({ getReader: () => reader }),
		} as unknown as File;
		vi.stubGlobal("window", {
			showOpenFilePicker: vi.fn(async () => [{ kind: "file" as const, getFile: async () => file }]),
		});

		const result = await new BrowserSimulationResidentScenarioEditorFileGateway().chooseOpen(
			"TRANSFER_PLAN",
		);

		expect(result).toMatchObject({
			profileId: SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID,
			source: {
				sourceKind: "TRANSFER_PLAN",
				records: [{ vehicleId: "OHT-001" }],
			},
		});
		expect(JSON.stringify(result)).not.toContain("private-customer-station-map-export");
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});
});

function residentEnvelope() {
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
