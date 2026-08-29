import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithMixedPorts } from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import { compileSimulationScenarioResourceRunConfiguration } from "../compile/SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import {
	compileSimulationScenarioRunAuthorization,
	simulationScenarioRunAuthorizationMatchesSources,
} from "../compile/SimulationScenarioRunAuthorization";
import {
	compileSimulationScenarioServiceTiming,
	type SimulationScenarioEqProcessTimingRecord,
} from "../compile/SimulationScenarioServiceTiming";
import { RailDocument } from "../core/RailDocument";
import { LiveSimulationActiveRunOwner } from "../editor/LiveSimulationActiveRunOwner";
import { LiveSimulationScenarioEditorController } from "../editor/LiveSimulationScenarioEditorController";
import { LiveSimulationScenarioSession } from "../editor/LiveSimulationScenarioSession";
import {
	SimulationScenarioPreparationBridge,
	type SimulationScenarioPreparationWorkerPort,
} from "../editor/SimulationScenarioPreparationBridge";
import {
	SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationScenarioPreparationWorkerRequest,
	type SimulationScenarioPreparationWorkerResponse,
} from "../worker/SimulationScenarioPreparationWorkerProtocol";
import {
	collectSimulationScenarioPreparationResponseTransferBuffers,
	prepareSimulationScenarioWorkerRequest,
} from "../worker/SimulationScenarioPreparationWorkerRuntime";
import { DeterministicScenarioMotionScheduler } from "./DeterministicScenarioMotionScheduler";
import { DeterministicScenarioResourceState } from "./DeterministicScenarioResourceState";
import { selectDeterministicScenarioRuntimeEventWindow } from "./DeterministicScenarioRuntimeEventWindow";
import { DeterministicScenarioRuntimePublisher } from "./DeterministicScenarioRuntimePublisher";

const DEFAULT_REQUEST_COUNT = 100_000;
const MAXIMUM_RSS_BYTES = 2.5 * 1024 * 1024 * 1024;
const MAXIMUM_HEAP_USED_BYTES = 1.25 * 1024 * 1024 * 1024;
const MAXIMUM_ARRAY_BUFFER_BYTES = 768 * 1024 * 1024;
const MAXIMUM_PREPARATION_MILLISECONDS = 90_000;
const MAXIMUM_EXECUTION_MILLISECONDS = 90_000;
const SCALE_LOAD_ID = "PUBLIC-SYNTHETIC-RUNTIME-SCALE-LOAD";
const OPTIONAL_SCALE_PROCESS = (
	globalThis as typeof globalThis & {
		process?: {
			env: Record<string, string | undefined>;
			memoryUsage(): {
				rss: number;
				heapUsed: number;
				arrayBuffers: number;
			};
			stdout: { write(value: string): void };
		};
	}
).process;

if (!OPTIONAL_SCALE_PROCESS) {
	throw new Error("Public synthetic runtime scale gate requires Node.js.");
}
const SCALE_PROCESS = OPTIONAL_SCALE_PROCESS;
const REQUEST_COUNT = readScaleRequestCount();

describe("Deterministic scenario resource-backed serialized scale gate", () => {
	it("executes the exact public 100k request ceiling with bounded terminal state and event retention", async () => {
		const peak = memoryPeak();
		const preparationStartedAt = performance.now();
		const preparationPhases: Record<string, number> = {};
		let phaseStartedAt = preparationStartedAt;
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(0, 1),
		);
		preparationPhases.snapshot = performance.now() - phaseStartedAt;
		phaseStartedAt = performance.now();
		const { records, eqProcessTimings } = scaleInputs(REQUEST_COUNT);
		preparationPhases.inputs = performance.now() - phaseStartedAt;
		peak.sample();
		phaseStartedAt = performance.now();
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "PUBLIC-SYNTHETIC-RUNTIME-SCALE-V1",
			adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: REQUEST_COUNT,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records,
		});
		preparationPhases.manifest = performance.now() - phaseStartedAt;
		peak.sample();
		phaseStartedAt = performance.now();
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		preparationPhases.routes = performance.now() - phaseStartedAt;
		peak.sample();
		phaseStartedAt = performance.now();
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
		preparationPhases.claims = performance.now() - phaseStartedAt;
		phaseStartedAt = performance.now();
		const program = compileSimulationScenarioAdmissionProgram(snapshot, manifest, routes, claims);
		preparationPhases.program = performance.now() - phaseStartedAt;
		phaseStartedAt = performance.now();
		const timing = compileSimulationScenarioServiceTiming(
			snapshot,
			manifest,
			routes,
			claims,
			program,
			{ eqProcessTimings },
		);
		preparationPhases.timing = performance.now() - phaseStartedAt;
		phaseStartedAt = performance.now();
		const resources = compileSimulationScenarioResourceRunConfiguration(
			snapshot,
			manifest,
			routes,
			claims,
			program,
			timing,
			{
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [{ loadId: SCALE_LOAD_ID, equipmentGroupId: 1 }],
			},
		);
		preparationPhases.resources = performance.now() - phaseStartedAt;
		phaseStartedAt = performance.now();
		const scheduler = new DeterministicScenarioMotionScheduler(
			snapshot,
			manifest,
			routes,
			claims,
			program,
			timing,
			resources,
		);
		preparationPhases.scheduler = performance.now() - phaseStartedAt;
		peak.sample();
		const preparationMilliseconds = performance.now() - preparationStartedAt;
		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_RUNTIME_SCALE_PREPARED ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				preparationMilliseconds: Math.round(preparationMilliseconds),
				preparationPhasesMilliseconds: roundTimings(preparationPhases),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
		const terminalTimeMicroseconds = expectedTerminalTimeMicroseconds(
			routes.routeDistancesMeters,
			timing.serviceDurationMicroseconds,
			snapshot.occupancyPolicy.maximumSpeedMillimetersPerSecond,
		);

		const executionStartedAt = performance.now();
		const acceleratedWallTime = Math.floor(terminalTimeMicroseconds / 64);
		scheduler.advanceByWallClockMicroseconds(acceleratedWallTime, 64);
		scheduler.advanceSimulationToTimeMicroseconds(terminalTimeMicroseconds);
		const executionMilliseconds = performance.now() - executionStartedAt;
		peak.sample();

		const expectedCoreEventCount = REQUEST_COUNT * 5;
		const expectedResourceEventCount = REQUEST_COUNT * 3;
		const kpi = scheduler.runtimeKpiState();
		expect(scheduler.currentTimeMicroseconds).toBe(terminalTimeMicroseconds);
		expect(scheduler.allScenarioWorkCompleted).toBe(true);
		expect(kpi).toMatchObject({
			requestCount: REQUEST_COUNT,
			requestCompletedCount: REQUEST_COUNT,
			destinationServiceReadyCount: REQUEST_COUNT,
			coreEventCount: expectedCoreEventCount,
			resourceEventCount: expectedResourceEventCount,
			eqDestinationRequestCount: REQUEST_COUNT / 2,
			eqReadyCount: REQUEST_COUNT / 2,
			storageResourceCount: 1,
			storageOccupiedUnits: 1,
			storageReservedUnits: 0,
		});
		expect(scheduler.eventAt(0)).toMatchObject({
			type: "VEHICLE_TOKEN_ADMITTED",
			requestRow: 0,
		});
		expect(scheduler.eventAt(expectedCoreEventCount - 1)).toMatchObject({
			type: "DESTINATION_SERVICE_READY",
			requestRow: REQUEST_COUNT - 1,
		});
		expect(scheduler.resourceEventAt(0)).toMatchObject({
			type: "STORAGE_SOURCE_RELEASED",
			requestRow: 0,
		});
		expect(scheduler.resourceEventAt(expectedResourceEventCount - 1)).toMatchObject({
			type: "STORAGE_DESTINATION_OCCUPIED",
			requestRow: REQUEST_COUNT - 1,
		});
		expect(preparationMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(executionMilliseconds).toBeLessThan(MAXIMUM_EXECUTION_MILLISECONDS);
		expect(peak.rssBytes).toBeLessThan(MAXIMUM_RSS_BYTES);
		expect(peak.heapUsedBytes).toBeLessThan(MAXIMUM_HEAP_USED_BYTES);
		expect(peak.arrayBufferBytes).toBeLessThan(MAXIMUM_ARRAY_BUFFER_BYTES);

		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_RUNTIME_SCALE ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				terminalTimeMicroseconds,
				coreEventCount: scheduler.eventCount,
				resourceEventCount: scheduler.resourceEventCount,
				preparationMilliseconds: Math.round(preparationMilliseconds),
				executionMilliseconds: Math.round(executionMilliseconds),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
	}, 180_000);

	it("queues and completes 100k independent EQ arrivals without retained objects or front shifts", async () => {
		const peak = memoryPeak();
		const preparationStartedAt = performance.now();
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(0, 0),
		);
		const { records, eqProcessTimings } = independentEqInputs(REQUEST_COUNT);
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "PUBLIC-SYNTHETIC-EQ-QUEUE-SCALE-V1",
			adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: REQUEST_COUNT,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records,
		});
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
		const program = compileSimulationScenarioAdmissionProgram(snapshot, manifest, routes, claims);
		const timing = compileSimulationScenarioServiceTiming(
			snapshot,
			manifest,
			routes,
			claims,
			program,
			{ eqProcessTimings },
		);
		const resources = compileSimulationScenarioResourceRunConfiguration(
			snapshot,
			manifest,
			routes,
			claims,
			program,
			timing,
			{
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: REQUEST_COUNT,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [],
			},
		);
		const state = new DeterministicScenarioResourceState(
			snapshot,
			routes,
			program,
			timing,
			resources,
		);
		peak.sample();
		const preparationMilliseconds = performance.now() - preparationStartedAt;

		const queueStartedAt = performance.now();
		for (let requestRow = 0; requestRow < REQUEST_COUNT; requestRow++) {
			state.confirmDestinationArrival(requestRow, 0);
		}
		const queueMilliseconds = performance.now() - queueStartedAt;
		peak.sample();
		expect(state.eventCount).toBe(REQUEST_COUNT);
		expect(state.eqWaitQueueRetainedByteCapacity).toBe(REQUEST_COUNT * 4 + 12);
		expect(state.eqCompletionHeapRetainedByteCapacity).toBe(REQUEST_COUNT * 16);

		const startStartedAt = performance.now();
		state.advanceToTimeMicroseconds(0);
		const startMilliseconds = performance.now() - startStartedAt;
		peak.sample();
		expect(state.resourceSummary()).toMatchObject({
			eqQueuedCount: 0,
			eqActiveCount: REQUEST_COUNT,
			eqReadyCount: 0,
		});
		expect(state.eventCount).toBe(REQUEST_COUNT * 2);

		const drainStartedAt = performance.now();
		state.advanceToTimeMicroseconds(1);
		const drainMilliseconds = performance.now() - drainStartedAt;
		peak.sample();
		const summary = state.resourceSummary();
		expect(summary).toMatchObject({
			eqDestinationRequestCount: REQUEST_COUNT,
			eqNotArrivedCount: 0,
			eqQueuedCount: 0,
			eqActiveCount: 0,
			eqReadyCount: REQUEST_COUNT,
		});
		expect(state.eventCount).toBe(REQUEST_COUNT * 3);
		expect(state.eventAt(0)).toMatchObject({ type: "EQ_SERVICE_QUEUED", requestRow: 0 });
		expect(state.eventAt(REQUEST_COUNT)).toMatchObject({
			type: "EQ_SERVICE_STARTED",
			requestRow: 0,
		});
		expect(state.eventAt(REQUEST_COUNT * 3 - 1)).toMatchObject({
			type: "EQ_SERVICE_READY",
			requestRow: REQUEST_COUNT - 1,
		});
		expect(preparationMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(queueMilliseconds).toBeLessThan(MAXIMUM_EXECUTION_MILLISECONDS);
		expect(startMilliseconds).toBeLessThan(MAXIMUM_EXECUTION_MILLISECONDS);
		expect(drainMilliseconds).toBeLessThan(MAXIMUM_EXECUTION_MILLISECONDS);
		expect(peak.rssBytes).toBeLessThan(MAXIMUM_RSS_BYTES);
		expect(peak.heapUsedBytes).toBeLessThan(MAXIMUM_HEAP_USED_BYTES);
		expect(peak.arrayBufferBytes).toBeLessThan(MAXIMUM_ARRAY_BUFFER_BYTES);

		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_EQ_QUEUE_SCALE ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				resourceEventCount: state.eventCount,
				queueRetainedBytes: state.eqWaitQueueRetainedByteCapacity,
				completionRetainedBytes: state.eqCompletionHeapRetainedByteCapacity,
				preparationMilliseconds: Math.round(preparationMilliseconds),
				queueMilliseconds: Math.round(queueMilliseconds),
				startMilliseconds: Math.round(startMilliseconds),
				drainMilliseconds: Math.round(drainMilliseconds),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
	}, 180_000);

	it("prepares the exact 100k request ceiling through the Worker runtime", async () => {
		const peak = memoryPeak();
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(0, 1),
		);
		const { records, eqProcessTimings } = scaleInputs(REQUEST_COUNT);
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "PUBLIC-SYNTHETIC-WORKER-SCALE-V1",
			adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: REQUEST_COUNT,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records,
		});
		const request: SimulationScenarioPreparationWorkerRequest = {
			type: "PREPARE_SIMULATION_SCENARIO",
			protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
			requestId: 1,
			generation: 1,
			sourceKind: "TRANSFER_PLAN",
			snapshot,
			manifest,
			serviceTimingInput: { eqProcessTimings },
			resourceRunInput: {
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [{ loadId: SCALE_LOAD_ID, equipmentGroupId: 1 }],
			},
		};
		peak.sample();
		const startedAt = performance.now();
		const response = await prepareSimulationScenarioWorkerRequest(request);
		const preparationMilliseconds = performance.now() - startedAt;
		peak.sample();
		expect(response.type).toBe("SIMULATION_SCENARIO_PREPARED");
		if (response.type !== "SIMULATION_SCENARIO_PREPARED") {
			throw new Error(`Public synthetic Worker preparation failed: ${response.message}`);
		}
		expect(response.routes.requestCount).toBe(REQUEST_COUNT);
		expect(response.leaseClaims.requestCount).toBe(REQUEST_COUNT);
		expect(response.admissionProgram.requestCount).toBe(REQUEST_COUNT);
		expect(response.serviceTiming.requestCount).toBe(REQUEST_COUNT);
		expect(response.resourceRunConfiguration.requestCount).toBe(REQUEST_COUNT);
		expect(preparationMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(peak.rssBytes).toBeLessThan(MAXIMUM_RSS_BYTES);
		expect(peak.heapUsedBytes).toBeLessThan(MAXIMUM_HEAP_USED_BYTES);
		expect(peak.arrayBufferBytes).toBeLessThan(MAXIMUM_ARRAY_BUFFER_BYTES);

		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_WORKER_PREPARATION_SCALE ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				preparationMilliseconds: Math.round(preparationMilliseconds),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
	}, 180_000);

	it("transfers and adopts the exact 100k request ceiling through the main-realm Bridge", async () => {
		const peak = memoryPeak();
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(0, 1),
		);
		const { records, eqProcessTimings } = scaleInputs(REQUEST_COUNT);
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "PUBLIC-SYNTHETIC-BRIDGE-SCALE-V1",
			adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: REQUEST_COUNT,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records,
		});
		const worker = new PublicSyntheticScenarioPreparationWorker();
		const bridge = new SimulationScenarioPreparationBridge(() => worker, 180_000);
		peak.sample();
		const startedAt = performance.now();
		const prepared = await bridge.prepare(
			snapshot,
			manifest,
			{ eqProcessTimings },
			{
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [{ loadId: SCALE_LOAD_ID, equipmentGroupId: 1 }],
			},
			1,
		);
		const bridgeMilliseconds = performance.now() - startedAt;
		peak.sample();
		expect(prepared.routes.requestCount).toBe(REQUEST_COUNT);
		expect(prepared.resourceRunConfiguration.requestCount).toBe(REQUEST_COUNT);
		expect(worker.terminated).toBe(true);
		expect(bridgeMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(peak.rssBytes).toBeLessThan(MAXIMUM_RSS_BYTES);
		expect(peak.heapUsedBytes).toBeLessThan(MAXIMUM_HEAP_USED_BYTES);
		expect(peak.arrayBufferBytes).toBeLessThan(MAXIMUM_ARRAY_BUFFER_BYTES);

		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_BRIDGE_ADOPTION_SCALE ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				bridgeMilliseconds: Math.round(bridgeMilliseconds),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
	}, 180_000);

	it("prepares the exact 100k request ceiling through the live Session", async () => {
		const peak = memoryPeak();
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(0, 1),
		);
		const { records, eqProcessTimings } = scaleInputs(REQUEST_COUNT);
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "PUBLIC-SYNTHETIC-SESSION-SCALE-V1",
			adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: REQUEST_COUNT,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records,
		});
		const worker = new PublicSyntheticScenarioPreparationWorker();
		const bridge = new SimulationScenarioPreparationBridge(() => worker, 180_000);
		const session = new LiveSimulationScenarioSession(bridge);
		peak.sample();
		const startedAt = performance.now();
		const prepared = await session.prepare(
			snapshot,
			manifest,
			{ eqProcessTimings },
			{
				eqResources: [
					{
						equipmentGroupId: 2,
						concurrentCapacity: 1,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [{ loadId: SCALE_LOAD_ID, equipmentGroupId: 1 }],
			},
		);
		const sessionMilliseconds = performance.now() - startedAt;
		peak.sample();
		expect(prepared.routes.requestCount).toBe(REQUEST_COUNT);
		expect(session.getState().phase).toBe("PREPARED");
		expect(worker.terminated).toBe(true);
		const authorizationInput = Object.freeze({
			projectId: "PUBLIC-SYNTHETIC-SCALE-PROJECT",
			preparationGeneration: 1,
			authorizationGeneration: 1,
			runAssetFingerprint: "PUBLIC-SYNTHETIC-SCALE-RUN-ASSET",
			serviceTimingInputFingerprint: prepared.serviceTiming.sourceTimingInputFingerprint,
			resourceRunInputFingerprint: prepared.resourceRunConfiguration.sourceResourceInputFingerprint,
			snapshot,
			manifest,
			prepared,
		});
		const authorizationStartedAt = performance.now();
		const authorization = compileSimulationScenarioRunAuthorization(authorizationInput);
		const authorizationMilliseconds = performance.now() - authorizationStartedAt;
		peak.sample();
		const authorizationMatchStartedAt = performance.now();
		expect(
			simulationScenarioRunAuthorizationMatchesSources(authorization, authorizationInput),
		).toBe(true);
		const authorizationMatchMilliseconds = performance.now() - authorizationMatchStartedAt;
		peak.sample();
		expect(sessionMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(authorizationMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(authorizationMatchMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(peak.rssBytes).toBeLessThan(MAXIMUM_RSS_BYTES);
		expect(peak.heapUsedBytes).toBeLessThan(MAXIMUM_HEAP_USED_BYTES);
		expect(peak.arrayBufferBytes).toBeLessThan(MAXIMUM_ARRAY_BUFFER_BYTES);
		session.dispose();

		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_SESSION_PREPARATION_SCALE ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				sessionMilliseconds: Math.round(sessionMilliseconds),
				authorizationMilliseconds: Math.round(authorizationMilliseconds),
				authorizationMatchMilliseconds: Math.round(authorizationMatchMilliseconds),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
	}, 180_000);

	it("authorizes, consumes, and starts the exact 100k request ceiling through the live owner", async () => {
		const peak = memoryPeak();
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithMixedPorts(0, 1),
		);
		const { records, eqProcessTimings } = scaleInputs(REQUEST_COUNT);
		const resourceRunInput = {
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 1,
					availabilityMode: "ALWAYS" as const,
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [{ loadId: SCALE_LOAD_ID, equipmentGroupId: 1 }],
		};
		const worker = new PublicSyntheticScenarioPreparationWorker();
		const bridge = new SimulationScenarioPreparationBridge(() => worker, 180_000);
		const controller = new LiveSimulationScenarioEditorController(
			"PUBLIC-SYNTHETIC-SCALE-PROJECT",
			new RailDocument(),
			new LiveSimulationScenarioSession(bridge),
		);
		peak.sample();
		const preparationStartedAt = performance.now();
		await controller.prepare(
			snapshot,
			{
				sourceKind: "TRANSFER_PLAN",
				manifestId: "PUBLIC-SYNTHETIC-CONTROLLER-SCALE-V1",
				mappingVersion: 1,
				records: records.map((record) => ({
					transferId: record.transferId,
					releaseTimeMicroseconds: record.releaseTimeMicroseconds,
					loadId: record.loadId,
					sourcePortId: record.sourcePortId,
					destinationPortId: record.destinationPortId,
				})),
			},
			{ eqProcessTimings },
			resourceRunInput,
		);
		const preparationMilliseconds = performance.now() - preparationStartedAt;
		peak.sample();
		const authorizationStartedAt = performance.now();
		const authorization = controller.authorizeCurrentPrepared(snapshot);
		const authorizationMilliseconds = performance.now() - authorizationStartedAt;
		peak.sample();
		const owner = new LiveSimulationActiveRunOwner(controller, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 8,
		});
		const startStartedAt = performance.now();
		const state = owner.start(snapshot, 64);
		const startMilliseconds = performance.now() - startStartedAt;
		peak.sample();
		expect(authorization.requestCount).toBe(REQUEST_COUNT);
		expect(state).toMatchObject({
			phase: "ACTIVE",
			requestCount: REQUEST_COUNT,
			speedMultiplier: 64,
			latestPublication: { resourceExecutionPrepared: true },
		});
		expect(controller.getState().authorization).toBeNull();
		expect(worker.terminated).toBe(true);
		expect(owner.stop()).toBe(true);
		controller.authorizeCurrentPrepared(snapshot);
		const consumeStartedAt = performance.now();
		const consumed = controller.consumeAuthorizedRunForCurrent(snapshot);
		const consumeMilliseconds = performance.now() - consumeStartedAt;
		if (!consumed) throw new Error("Expected a second exact current authorization consumption.");
		peak.sample();
		const schedulerStartedAt = performance.now();
		const scheduler = new DeterministicScenarioMotionScheduler(
			snapshot,
			consumed.runAsset.manifest,
			consumed.prepared.routes,
			consumed.prepared.leaseClaims,
			consumed.prepared.admissionProgram,
			consumed.prepared.serviceTiming,
			consumed.prepared.resourceRunConfiguration,
		);
		const schedulerMilliseconds = performance.now() - schedulerStartedAt;
		peak.sample();
		const publicationStartedAt = performance.now();
		const publisher = new DeterministicScenarioRuntimePublisher(scheduler, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 8,
		});
		const publication = publisher.publishIfDue();
		const publicationMilliseconds = performance.now() - publicationStartedAt;
		const eventWindowStartedAt = performance.now();
		const eventWindow = selectDeterministicScenarioRuntimeEventWindow(
			scheduler,
			consumed.runAsset.manifest,
		);
		const eventWindowMilliseconds = performance.now() - eventWindowStartedAt;
		expect(publication?.resourceExecutionPrepared).toBe(true);
		expect(eventWindow).toMatchObject({ coreEventCount: 0, resourceEventCount: 0 });
		expect(preparationMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(authorizationMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(startMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(consumeMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(schedulerMilliseconds).toBeLessThan(MAXIMUM_PREPARATION_MILLISECONDS);
		expect(peak.rssBytes).toBeLessThan(MAXIMUM_RSS_BYTES);
		expect(peak.heapUsedBytes).toBeLessThan(MAXIMUM_HEAP_USED_BYTES);
		expect(peak.arrayBufferBytes).toBeLessThan(MAXIMUM_ARRAY_BUFFER_BYTES);
		owner.dispose();
		controller.dispose();

		SCALE_PROCESS.stdout.write(
			`PUBLIC_SYNTHETIC_LIVE_OWNER_SCALE ${JSON.stringify({
				requestCount: REQUEST_COUNT,
				preparationMilliseconds: Math.round(preparationMilliseconds),
				authorizationMilliseconds: Math.round(authorizationMilliseconds),
				startMilliseconds: Math.round(startMilliseconds),
				consumeMilliseconds: Math.round(consumeMilliseconds),
				schedulerMilliseconds: Math.round(schedulerMilliseconds),
				publicationMilliseconds: Math.round(publicationMilliseconds),
				eventWindowMilliseconds: Math.round(eventWindowMilliseconds),
				peakRssBytes: peak.rssBytes,
				peakHeapUsedBytes: peak.heapUsedBytes,
				peakArrayBufferBytes: peak.arrayBufferBytes,
			})}\n`,
		);
	}, 180_000);
});

class PublicSyntheticScenarioPreparationWorker implements SimulationScenarioPreparationWorkerPort {
	onmessage: ((event: MessageEvent<SimulationScenarioPreparationWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(
		message: SimulationScenarioPreparationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => void this.respond(delivered));
	}

	terminate(): void {
		this.terminated = true;
	}

	private async respond(request: SimulationScenarioPreparationWorkerRequest): Promise<void> {
		if (this.terminated) return;
		try {
			const response = await prepareSimulationScenarioWorkerRequest(request);
			const transfers = collectSimulationScenarioPreparationResponseTransferBuffers(response);
			const delivered = structuredClone(response, { transfer: [...transfers] });
			this.onmessage?.({
				data: delivered,
			} as MessageEvent<SimulationScenarioPreparationWorkerResponse>);
		} catch (error) {
			this.onerror?.({
				message:
					error instanceof Error ? error.message : "public synthetic Worker preparation failed",
			} as ErrorEvent);
		}
	}
}

function scaleInputs(requestCount: number): Readonly<{
	records: SimulationTransferPlanRecord[];
	eqProcessTimings: SimulationScenarioEqProcessTimingRecord[];
}> {
	const records: SimulationTransferPlanRecord[] = [];
	const eqProcessTimings: SimulationScenarioEqProcessTimingRecord[] = [];
	for (let sourceOrdinal = 0; sourceOrdinal < requestCount; sourceOrdinal++) {
		const eqDestination = sourceOrdinal % 2 === 0;
		records.push({
			transferId: `PUBLIC-SCALE-${sourceOrdinal.toString().padStart(6, "0")}`,
			sourceOrdinal,
			releaseTimeMicroseconds: 0,
			loadId: SCALE_LOAD_ID,
			sourcePortId: eqDestination ? 1 : 3,
			destinationPortId: eqDestination ? 3 : 1,
		});
		if (eqDestination) {
			eqProcessTimings.push({
				sourceOrdinal,
				capabilityId: 1,
				processingDurationMicroseconds: 1,
			});
		}
	}
	return { records, eqProcessTimings };
}

function independentEqInputs(requestCount: number): Readonly<{
	records: SimulationTransferPlanRecord[];
	eqProcessTimings: SimulationScenarioEqProcessTimingRecord[];
}> {
	const records: SimulationTransferPlanRecord[] = [];
	const eqProcessTimings: SimulationScenarioEqProcessTimingRecord[] = [];
	for (let sourceOrdinal = 0; sourceOrdinal < requestCount; sourceOrdinal++) {
		records.push({
			transferId: `PUBLIC-EQ-QUEUE-${sourceOrdinal.toString().padStart(6, "0")}`,
			sourceOrdinal,
			releaseTimeMicroseconds: 0,
			loadId: `PUBLIC-EQ-LOAD-${sourceOrdinal.toString().padStart(6, "0")}`,
			sourcePortId: 3,
			destinationPortId: 2,
		});
		eqProcessTimings.push({
			sourceOrdinal,
			capabilityId: 1,
			processingDurationMicroseconds: 1,
		});
	}
	return { records, eqProcessTimings };
}

function roundTimings(timings: Readonly<Record<string, number>>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(timings).map(([phase, milliseconds]) => [phase, Math.round(milliseconds)]),
	);
}

function expectedTerminalTimeMicroseconds(
	routeDistancesMeters: Float64Array,
	serviceDurationsMicroseconds: Float64Array,
	maximumSpeedMillimetersPerSecond: number,
): number {
	let total = 0;
	for (let requestRow = 0; requestRow < routeDistancesMeters.length; requestRow++) {
		const distanceMicrometers = Math.ceil((routeDistancesMeters[requestRow] as number) * 1_000_000);
		total += Math.ceil((distanceMicrometers * 1_000) / maximumSpeedMillimetersPerSecond);
		total += serviceDurationsMicroseconds[requestRow] as number;
		if (!Number.isSafeInteger(total)) {
			throw new RangeError("Public synthetic runtime scale terminal time is unsafe.");
		}
	}
	return total;
}

function memoryPeak() {
	let rssBytes = 0;
	let heapUsedBytes = 0;
	let arrayBufferBytes = 0;
	return {
		get rssBytes() {
			return rssBytes;
		},
		get heapUsedBytes() {
			return heapUsedBytes;
		},
		get arrayBufferBytes() {
			return arrayBufferBytes;
		},
		sample() {
			const usage = SCALE_PROCESS.memoryUsage();
			rssBytes = Math.max(rssBytes, usage.rss);
			heapUsedBytes = Math.max(heapUsedBytes, usage.heapUsed);
			arrayBufferBytes = Math.max(arrayBufferBytes, usage.arrayBuffers);
		},
	};
}

function readScaleRequestCount(): number {
	const raw = SCALE_PROCESS?.env.OPENFAB_RUNTIME_SCALE_REQUEST_COUNT;
	if (!raw) return DEFAULT_REQUEST_COUNT;
	const value = Number(raw);
	if (
		!Number.isSafeInteger(value) ||
		value <= 0 ||
		value > DEFAULT_REQUEST_COUNT ||
		value % 2 !== 0
	) {
		throw new RangeError(
			"OPENFAB_RUNTIME_SCALE_REQUEST_COUNT must be an even integer from 2 to 100000.",
		);
	}
	return value;
}
