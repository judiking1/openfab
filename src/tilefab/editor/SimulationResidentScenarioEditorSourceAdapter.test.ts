import { describe, expect, it } from "vitest";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "../compile/SimulationScenarioManifest";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import {
	adaptSimulationResidentScenarioEditorRunAsset,
	simulationResidentScenarioEditorRunAssetError,
} from "./SimulationResidentScenarioEditorSourceAdapter";

describe("SimulationResidentScenarioEditorSourceAdapter", () => {
	it("canonicalizes Plan rows against exact ports and configured home-slot vehicles", async () => {
		const fixture = await adapterFixture();
		const records: Array<Record<string, unknown>> = [
			planRow("TRANSFER-A", "OHT-001", 1, 2),
			planRow("TRANSFER-B", "OHT-UNKNOWN", 1, 2),
		];
		const timing = timingInput();
		const resources = resourceInput();
		const asset = adaptSimulationResidentScenarioEditorRunAsset(
			fixture.components,
			fixture.operational,
			{
				sourceKind: "TRANSFER_PLAN",
				manifestId: "RESIDENT-PLAN-1",
				mappingVersion: 1,
				records,
			},
			timing,
			resources,
		);

		expect(asset.manifest).toMatchObject({
			sourceKind: "TRANSFER_PLAN",
			inputRecordCount: 2,
			acceptedRecordCount: 1,
			rejectedRecordCount: 1,
			rejectionIssues: [
				{
					sourceOrdinal: 1,
					code: "UNKNOWN_VEHICLE",
					message: "The reviewed resident row vehicle has no configured home slot.",
				},
			],
			records: [
				{
					sourceOrdinal: 0,
					transferId: "TRANSFER-A",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});
		expect(asset.parking.vehicleIds).toEqual(["OHT-001"]);
		expect(simulationResidentScenarioEditorRunAssetError(asset)).toBeNull();

		records[0] = planRow("MUTATED", "OHT-UNKNOWN", 2, 1);
		timing.eqProcessTimings[0] = {
			sourceOrdinal: 0,
			capabilityId: 999,
			processingDurationMicroseconds: 999,
		};
		resources.eqResources[0]?.availabilityWindows.push({
			startMicroseconds: 1,
			endMicroseconds: 2,
		});
		expect(asset.manifest.records[0]).toMatchObject({
			transferId: "TRANSFER-A",
			vehicleId: "OHT-001",
		});
		expect(asset.serviceTimingInput.eqProcessTimings[0]).toMatchObject({ capabilityId: 1 });
		expect(asset.resourceRunInput.eqResources[0]?.availabilityWindows).toEqual([]);
		expect(simulationResidentScenarioEditorRunAssetError(asset)).toBeNull();
	});

	it("keeps Replay History separate and reports only bounded public-safe rejection facts", async () => {
		const fixture = await adapterFixture();
		const asset = adaptSimulationResidentScenarioEditorRunAsset(
			fixture.components,
			fixture.operational,
			{
				sourceKind: "REPLAY_HISTORY",
				manifestId: "RESIDENT-HISTORY-1",
				mappingVersion: 1,
				records: [
					{
						historyEventId: "HISTORY-A",
						observedTimeMicroseconds: 0,
						loadId: "LOAD-A",
						vehicleId: "OHT-001",
						sourcePortId: 1,
						destinationPortId: 2,
					},
					{
						historyEventId: "PRIVATE-CUSTOMER-ID",
						observedTimeMicroseconds: 1,
						loadId: "LOAD-B",
						vehicleId: "OHT-001",
						sourcePortId: 999_999,
						destinationPortId: 2,
					},
				],
			},
			timingInput(),
			resourceInput(),
		);

		expect(asset.manifest).toMatchObject({
			sourceKind: "REPLAY_HISTORY",
			acceptedRecordCount: 1,
			rejectedRecordCount: 1,
			rejectionIssues: [
				{
					sourceOrdinal: 1,
					code: "UNKNOWN_SOURCE_PORT",
					message: "The reviewed source port is not present in the exact OpenFab foundation.",
				},
			],
		});
		expect(JSON.stringify(asset.manifest.rejectionIssues)).not.toContain("PRIVATE-CUSTOMER-ID");
	});

	it("fails closed for unexpected source fields, zero accepted rows, and oversized input", async () => {
		const fixture = await adapterFixture();
		const adapt = (source: never) =>
			adaptSimulationResidentScenarioEditorRunAsset(
				fixture.components,
				fixture.operational,
				source,
				timingInput(),
				resourceInput(),
			);

		expect(() =>
			adapt({
				sourceKind: "TRANSFER_PLAN",
				manifestId: "UNEXPECTED",
				mappingVersion: 1,
				records: [planRow("A", "OHT-001", 1, 2)],
				privateFileName: "station.map",
			} as never),
		).toThrow(/malformed/i);
		expect(() =>
			adapt({
				sourceKind: "TRANSFER_PLAN",
				manifestId: "ALL-REJECTED",
				mappingVersion: 1,
				records: [planRow("A", "OHT-UNKNOWN", 1, 2)],
			} as never),
		).toThrow(/no accepted/i);
		expect(() =>
			adapt({
				sourceKind: "TRANSFER_PLAN",
				manifestId: "TOO-MANY",
				mappingVersion: 1,
				records: new Array(SIMULATION_SCENARIO_MAX_INPUT_RECORDS + 1),
			} as never),
		).toThrow(/limit/i);
	});

	it("detects copied run-asset mutation and unexpected retained fields", async () => {
		const fixture = await adapterFixture();
		const asset = adaptSimulationResidentScenarioEditorRunAsset(
			fixture.components,
			fixture.operational,
			{
				sourceKind: "TRANSFER_PLAN",
				manifestId: "RESIDENT-FORGE-1",
				mappingVersion: 1,
				records: [planRow("TRANSFER-A", "OHT-001", 1, 2)],
			},
			timingInput(),
			resourceInput(),
		);
		expect(
			simulationResidentScenarioEditorRunAssetError({ ...asset, fingerprint: "forged" }),
		).toMatch(/fingerprint/i);
		expect(
			simulationResidentScenarioEditorRunAssetError({ ...asset, privateSourcePath: "/private" }),
		).toMatch(/unexpected/i);
	});
});

function planRow(
	transferId: string,
	vehicleId: string,
	sourcePortId: number,
	destinationPortId: number,
): Record<string, unknown> {
	return {
		transferId,
		releaseTimeMicroseconds: 0,
		loadId: "LOAD-A",
		vehicleId,
		sourcePortId,
		destinationPortId,
	};
}

function timingInput() {
	return {
		eqProcessTimings: [
			{
				sourceOrdinal: 0,
				capabilityId: 1,
				processingDurationMicroseconds: 2_000_000,
			},
		],
	};
}

function resourceInput() {
	return {
		eqResources: [
			{
				equipmentGroupId: 2,
				concurrentCapacity: 2,
				availabilityMode: "ALWAYS" as const,
				availabilityWindows: [] as Array<{
					startMicroseconds: number;
					endMicroseconds: number;
				}>,
			},
		],
		initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
	};
}

async function adapterFixture() {
	const sources = await buildSimulationResidentReadinessTestSources();
	const components = {
		foundation: sources.foundation,
		trackResources: sources.trackResources,
		stationCapabilities: sources.stationCapabilities,
		equipmentResources: sources.equipmentResources,
		occupancyPolicy: sources.occupancyPolicy,
	};
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 2,
			residentHomeSlots: [
				{
					id: 1,
					vehicleId: "OHT-001",
					anchorPortId: 3,
					policy: "DEDICATED_HOME_RETURN",
				},
			],
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
	return { components, operational };
}
