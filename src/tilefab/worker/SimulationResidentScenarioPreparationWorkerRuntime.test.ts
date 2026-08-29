import { describe, expect, it } from "vitest";
import { simulationResidentReadinessCertificateMatchesSources } from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { adaptSimulationResidentScenarioEditorRunAsset } from "../editor/SimulationResidentScenarioEditorSourceAdapter";
import {
	SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationResidentScenarioPreparationWorkerRequest,
	simulationResidentScenarioPreparationWorkerRequestError,
	simulationResidentScenarioPreparationWorkerResponseError,
} from "./SimulationResidentScenarioPreparationWorkerProtocol";
import { prepareSimulationResidentScenarioWorkerRequest } from "./SimulationResidentScenarioPreparationWorkerRuntime";

describe("SimulationResidentScenarioPreparationWorkerRuntime", () => {
	it("prepares the exact resident route, lease, admission, timing, resource, and certificate chain", async () => {
		const fixture = await workerFixture();
		const request = workerRequest(fixture, 7, 11);

		expect(simulationResidentScenarioPreparationWorkerRequestError(request)).toBeNull();
		const response = await prepareSimulationResidentScenarioWorkerRequest(request);

		expect(simulationResidentScenarioPreparationWorkerResponseError(response)).toBeNull();
		expect(response).toMatchObject({
			type: "SIMULATION_RESIDENT_SCENARIO_PREPARED",
			requestId: 7,
			generation: 11,
			runAssetFingerprint: fixture.runAsset.fingerprint,
		});
		if (response.type !== "SIMULATION_RESIDENT_SCENARIO_PREPARED") {
			throw new Error("Expected a prepared resident response.");
		}
		const sources = {
			...fixture.components,
			parking: fixture.runAsset.parking,
			manifest: fixture.runAsset.manifest,
			routes: response.routes,
			leaseClaims: response.leaseClaims,
			admissionProgram: response.admissionProgram,
			serviceTiming: response.serviceTiming,
			resourceRunConfiguration: response.resourceRunConfiguration,
		};
		expect(
			simulationResidentReadinessCertificateMatchesSources(response.certificate, sources),
		).toBe(true);
		expect(response.certificate).toMatchObject({
			requestCount: 1,
			vehicleCount: 1,
			sourceKind: "TRANSFER_PLAN",
		});
	});

	it("rejects forged explicit-input fingerprints without publishing partial artifacts", async () => {
		const fixture = await workerFixture();
		const request = workerRequest(fixture, 2, 3);
		const response = await prepareSimulationResidentScenarioWorkerRequest({
			...request,
			serviceTimingInputFingerprint: "forged",
		});

		expect(response).toMatchObject({
			type: "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED",
			requestId: 2,
			generation: 3,
			code: "PREPARATION_FAILED",
		});
		expect(simulationResidentScenarioPreparationWorkerResponseError(response)).toBeNull();
		expect(Object.hasOwn(response, "routes")).toBe(false);

		const forgedRunAssetResponse = await prepareSimulationResidentScenarioWorkerRequest({
			...request,
			runAssetFingerprint: "forged",
		});
		expect(forgedRunAssetResponse).toMatchObject({
			type: "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED",
			code: "PREPARATION_FAILED",
		});
		expect(Object.hasOwn(forgedRunAssetResponse, "routes")).toBe(false);
	});

	it("rejects unexpected request and response fields at the strict protocol boundary", async () => {
		const fixture = await workerFixture();
		const request = workerRequest(fixture, 4, 5);
		const malformed = { ...request, privateSourcePath: "/private/station.map" };

		expect(simulationResidentScenarioPreparationWorkerRequestError(malformed)).toMatch(/envelope/i);
		const response = await prepareSimulationResidentScenarioWorkerRequest(malformed);
		expect(response).toMatchObject({
			type: "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED",
			code: "MALFORMED_REQUEST",
		});
		expect(simulationResidentScenarioPreparationWorkerResponseError(response)).toBeNull();
		expect(
			simulationResidentScenarioPreparationWorkerResponseError({
				...response,
				privateSourcePath: "/private/station.map",
			}),
		).toMatch(/unexpected fields/i);
	});
});

type WorkerFixture = Awaited<ReturnType<typeof workerFixture>>;

function workerRequest(
	fixture: WorkerFixture,
	requestId: number,
	generation: number,
): SimulationResidentScenarioPreparationWorkerRequest {
	return {
		type: "PREPARE_SIMULATION_RESIDENT_SCENARIO",
		protocolVersion: SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
		requestId,
		generation,
		runAssetFingerprint: fixture.runAsset.fingerprint,
		serviceTimingInputFingerprint: fixture.runAsset.serviceTimingInputFingerprint,
		resourceRunInputFingerprint: fixture.runAsset.resourceRunInputFingerprint,
		components: fixture.components,
		parking: fixture.runAsset.parking,
		manifest: fixture.runAsset.manifest,
		serviceTimingInput: fixture.runAsset.serviceTimingInput,
		resourceRunInput: fixture.runAsset.resourceRunInput,
	};
}

async function workerFixture() {
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
	const runAsset = adaptSimulationResidentScenarioEditorRunAsset(
		components,
		operational,
		{
			sourceKind: "TRANSFER_PLAN",
			manifestId: "WORKER-PLAN-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "TRANSFER-A",
					releaseTimeMicroseconds: 0,
					loadId: "LOAD-A",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
		{
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 2_000_000,
				},
			],
		},
		{
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 2,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
		},
	);
	return { components, runAsset };
}
