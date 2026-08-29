import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponents,
	buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts,
	buildSimulationReadinessTestComponentsWithEqPorts,
	simulationReadinessTestVehicleProfile,
} from "../compile/SimulationReadinessTestFixture";
import { simulationScenarioAdmissionProgramMatchesSources } from "../compile/SimulationScenarioAdmissionProgram";
import { simulationScenarioLeaseClaimsMatchSources } from "../compile/SimulationScenarioLeaseClaims";
import { compileSimulationTransferPlanManifest } from "../compile/SimulationScenarioManifest";
import { simulationScenarioResourceRunConfigurationMatchesSources } from "../compile/SimulationScenarioResourceRunConfiguration";
import { simulationScenarioRouteRequestsMatchSources } from "../compile/SimulationScenarioRouteRequests";
import { simulationScenarioServiceTimingMatchesSources } from "../compile/SimulationScenarioServiceTiming";
import {
	SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationScenarioPreparationWorkerRequest,
} from "./SimulationScenarioPreparationWorkerProtocol";
import {
	collectSimulationScenarioPreparationResponseTransferBuffers,
	prepareSimulationScenarioWorkerRequest,
} from "./SimulationScenarioPreparationWorkerRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

describe("SimulationScenarioPreparationWorkerRuntime", () => {
	it("owns the exact snapshot and returns independently transferable prepared columns", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();
		const serviceTimingInput = timingInput(manifest);
		const resourceRunInput = resourceInput();
		const canonicalPositionBytes = snapshot.foundation.paths.positions.byteLength;
		const owned = structuredClone({ snapshot, manifest, serviceTimingInput, resourceRunInput });
		const request: SimulationScenarioPreparationWorkerRequest = {
			type: "PREPARE_SIMULATION_SCENARIO",
			protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
			requestId: 17,
			generation: 9,
			sourceKind: "TRANSFER_PLAN",
			snapshot: owned.snapshot,
			manifest: owned.manifest,
			serviceTimingInput: owned.serviceTimingInput,
			resourceRunInput: owned.resourceRunInput,
		};
		const requestTransfers = collectTransferableBuffers(owned.snapshot);
		const delivered = structuredClone(request, { transfer: requestTransfers });

		expect(owned.snapshot.foundation.paths.positions.byteLength).toBe(0);
		const response = await prepareSimulationScenarioWorkerRequest(delivered);
		expect(response).toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARED",
			requestId: 17,
			generation: 9,
			sourceKind: "TRANSFER_PLAN",
		});
		const responseTransfers = collectSimulationScenarioPreparationResponseTransferBuffers(response);
		const received = structuredClone(response, { transfer: [...responseTransfers] });
		if (received.type !== "SIMULATION_SCENARIO_PREPARED") {
			throw new Error("Expected a prepared scenario response.");
		}
		expect(responseTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationScenarioRouteRequestsMatchSources(snapshot, manifest, received.routes)).toBe(
			true,
		);
		expect(
			simulationScenarioLeaseClaimsMatchSources(
				snapshot,
				manifest,
				received.routes,
				received.leaseClaims,
			),
		).toBe(true);
		expect(
			simulationScenarioResourceRunConfigurationMatchesSources(
				snapshot,
				manifest,
				received.routes,
				received.leaseClaims,
				received.admissionProgram,
				received.serviceTiming,
				resourceRunInput,
				received.resourceRunConfiguration,
			),
		).toBe(true);
		expect(
			simulationScenarioAdmissionProgramMatchesSources(
				snapshot,
				manifest,
				received.routes,
				received.leaseClaims,
				received.admissionProgram,
			),
		).toBe(true);
		expect(
			simulationScenarioServiceTimingMatchesSources(
				snapshot,
				manifest,
				received.routes,
				received.leaseClaims,
				received.admissionProgram,
				serviceTimingInput,
				received.serviceTiming,
			),
		).toBe(true);
		expect(responseTransfers.length).toBeGreaterThan(11);
		expect(snapshot.foundation.paths.positions.byteLength).toBe(canonicalPositionBytes);
	});

	it("rejects malformed envelopes and source-kind mixing before route preparation", async () => {
		await expect(prepareSimulationScenarioWorkerRequest(null)).resolves.toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARATION_REJECTED",
			requestId: 0,
			generation: 0,
			sourceKind: "UNKNOWN",
			code: "MALFORMED_REQUEST",
		});
		const snapshot = readySnapshot();
		const manifest = planManifest();
		await expect(
			prepareSimulationScenarioWorkerRequest({
				...request(snapshot, manifest),
				sourceKind: "REPLAY_HISTORY",
			}),
		).resolves.toMatchObject({
			code: "SOURCE_KIND_MISMATCH",
			sourceKind: "REPLAY_HISTORY",
		});
		await expect(
			prepareSimulationScenarioWorkerRequest({
				...request(snapshot, manifest),
				rawSourceRow: "must-not-cross",
			}),
		).resolves.toMatchObject({ code: "MALFORMED_REQUEST" });
	});

	it("returns typed route rejection and cancellation without a partial artifact", async () => {
		const snapshot = readySnapshot();
		const foreignPortManifest = compileSimulationTransferPlanManifest({
			...header(),
			records: [transfer("FOREIGN", 99, 2)],
		});
		await expect(
			prepareSimulationScenarioWorkerRequest(request(snapshot, foreignPortManifest)),
		).resolves.toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARATION_REJECTED",
			code: "ROUTE_REJECTED",
		});

		const controller = new AbortController();
		controller.abort();
		await expect(
			prepareSimulationScenarioWorkerRequest(request(snapshot, planManifest()), {
				signal: controller.signal,
			}),
		).resolves.toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARATION_REJECTED",
			code: "PREPARATION_CANCELLED",
		});
	});

	it("returns a typed lease rejection when an extension reaches an unselected switch branch", async () => {
		const foundation = buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts().foundation;
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponents(foundation, undefined, {
				...simulationReadinessTestVehicleProfile(),
				frontSafetyMarginMillimeters: 100_000,
			}),
		);
		let leaseRejected = false;
		for (const [sourcePortId, destinationPortId] of [
			[1, 2],
			[2, 1],
		] as const) {
			const response = await prepareSimulationScenarioWorkerRequest(
				request(
					snapshot,
					compileSimulationTransferPlanManifest({
						...header(),
						records: [transfer("LEASE-BRANCH", sourcePortId, destinationPortId)],
					}),
				),
			);
			if (
				response.type === "SIMULATION_SCENARIO_PREPARATION_REJECTED" &&
				response.code === "LEASE_REJECTED"
			) {
				leaseRejected = true;
				break;
			}
		}
		expect(leaseRejected).toBe(true);
	});

	it("returns a typed custody-chain rejection without partial prepared artifacts", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(),
			inputRecordCount: 2,
			records: [
				transfer("CHAIN-1", 2, 1, 0, "LOAD-CHAIN"),
				transfer("CHAIN-2", 2, 1, 1, "LOAD-CHAIN"),
			],
		});

		await expect(
			prepareSimulationScenarioWorkerRequest(request(snapshot, manifest)),
		).resolves.toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARATION_REJECTED",
			code: "CUSTODY_CHAIN_REJECTED",
		});
	});

	it("returns a typed service-timing rejection without partial prepared artifacts", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();

		await expect(
			prepareSimulationScenarioWorkerRequest({
				...request(snapshot, manifest),
				serviceTimingInput: { eqProcessTimings: [] },
			}),
		).resolves.toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARATION_REJECTED",
			code: "SERVICE_TIMING_REJECTED",
		});
	});

	it("returns a typed resource-run rejection without partial prepared artifacts", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();

		await expect(
			prepareSimulationScenarioWorkerRequest({
				...request(snapshot, manifest),
				resourceRunInput: { eqResources: [], initialStorageLoads: [] },
			}),
		).resolves.toMatchObject({
			type: "SIMULATION_SCENARIO_PREPARATION_REJECTED",
			code: "RESOURCE_RUN_CONFIGURATION_REJECTED",
		});
	});
});

function readySnapshot() {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

function planManifest() {
	return compileSimulationTransferPlanManifest({
		...header(),
		records: [transfer("PLAN-1", 1, 2)],
	});
}

function header() {
	return {
		manifestId: "WORKER-SCENARIO-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: 1,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function transfer(
	transferId: string,
	sourcePortId: number,
	destinationPortId: number,
	sourceOrdinal = 0,
	loadId = "LOAD-1",
) {
	return {
		transferId,
		sourceOrdinal,
		releaseTimeMicroseconds: 10 + sourceOrdinal,
		loadId,
		sourcePortId,
		destinationPortId,
	};
}

function request(
	snapshot: ReturnType<typeof readySnapshot>,
	manifest: ReturnType<typeof planManifest>,
): SimulationScenarioPreparationWorkerRequest {
	return {
		type: "PREPARE_SIMULATION_SCENARIO",
		protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
		requestId: 1,
		generation: 1,
		sourceKind: manifest.sourceKind,
		snapshot,
		manifest,
		serviceTimingInput: timingInput(manifest),
		resourceRunInput: resourceInput(),
	};
}

function timingInput(manifest: ReturnType<typeof planManifest>) {
	return {
		eqProcessTimings: manifest.records.map((record) => ({
			sourceOrdinal: record.sourceOrdinal,
			capabilityId: 1,
			processingDurationMicroseconds: 1_000_000,
		})),
	};
}

function resourceInput() {
	return {
		eqResources: [
			{
				equipmentGroupId: 1,
				concurrentCapacity: 1,
				availabilityMode: "ALWAYS" as const,
				availabilityWindows: [],
			},
		],
		initialStorageLoads: [],
	};
}
