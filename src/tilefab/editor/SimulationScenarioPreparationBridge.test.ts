import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import { simulationScenarioAdmissionProgramMatchesSources } from "../compile/SimulationScenarioAdmissionProgram";
import { simulationScenarioLeaseClaimsMatchSources } from "../compile/SimulationScenarioLeaseClaims";
import {
	compileSimulationReplayHistoryManifest,
	compileSimulationTransferPlanManifest,
} from "../compile/SimulationScenarioManifest";
import { simulationScenarioResourceRunConfigurationMatchesSources } from "../compile/SimulationScenarioResourceRunConfiguration";
import { simulationScenarioRouteRequestsMatchSources } from "../compile/SimulationScenarioRouteRequests";
import { simulationScenarioServiceTimingMatchesSources } from "../compile/SimulationScenarioServiceTiming";
import type {
	SimulationScenarioPreparationWorkerRequest,
	SimulationScenarioPreparationWorkerResponse,
} from "../worker/SimulationScenarioPreparationWorkerProtocol";
import {
	collectSimulationScenarioPreparationResponseTransferBuffers,
	prepareSimulationScenarioWorkerRequest,
} from "../worker/SimulationScenarioPreparationWorkerRuntime";
import {
	SimulationScenarioPreparationBridge,
	type SimulationScenarioPreparationWorkerPort,
	simulationScenarioPreparationBridgeAdoptedArtifacts,
} from "./SimulationScenarioPreparationBridge";

class RuntimeScenarioPreparationWorker implements SimulationScenarioPreparationWorkerPort {
	onmessage: ((event: MessageEvent<SimulationScenarioPreparationWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestTransferBytes = 0;
	responseTransferCount = 0;
	responseTransferBytes = 0;

	postMessage(
		message: SimulationScenarioPreparationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.requestTransferCount = transfer.length;
		this.requestTransferBytes = transferByteLength(transfer);
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
			this.responseTransferCount = transfers.length;
			this.responseTransferBytes = transferByteLength(transfers);
			const delivered = structuredClone(response, { transfer: [...transfers] });
			this.onmessage?.({
				data: delivered,
			} as MessageEvent<SimulationScenarioPreparationWorkerResponse>);
		} catch (error) {
			this.onerror?.({
				message: error instanceof Error ? error.message : "scenario preparation runtime failed",
			} as ErrorEvent);
		}
	}
}

class ControlledScenarioPreparationWorker implements SimulationScenarioPreparationWorkerPort {
	onmessage: ((event: MessageEvent<SimulationScenarioPreparationWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	request: SimulationScenarioPreparationWorkerRequest | null = null;

	postMessage(
		message: SimulationScenarioPreparationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.request = structuredClone(message, { transfer });
	}

	async preparedResponse(): Promise<SimulationScenarioPreparationWorkerResponse> {
		if (!this.request) throw new Error("Expected a scenario preparation request.");
		return prepareSimulationScenarioWorkerRequest(this.request);
	}

	emit(response: SimulationScenarioPreparationWorkerResponse): void {
		this.onmessage?.({
			data: response,
		} as MessageEvent<SimulationScenarioPreparationWorkerResponse>);
	}

	emitError(message: string): void {
		this.onerror?.({ message } as ErrorEvent);
	}

	emitMessageError(): void {
		this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("SimulationScenarioPreparationBridge", () => {
	it("preserves canonical sources and adopts one exact Worker-owned route artifact", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();
		const canonicalPositionBytes = snapshot.foundation.paths.positions.byteLength;
		const worker = new RuntimeScenarioPreparationWorker();
		const bridge = new SimulationScenarioPreparationBridge(() => worker);

		const input = timingInput(manifest);
		const resources = resourceInput();
		const prepared = await bridge.prepare(snapshot, manifest, input, resources, 12);
		expect(simulationScenarioPreparationBridgeAdoptedArtifacts(prepared)).toBe(true);
		expect(
			simulationScenarioPreparationBridgeAdoptedArtifacts(Object.freeze({ ...prepared })),
		).toBe(false);

		expect(simulationScenarioRouteRequestsMatchSources(snapshot, manifest, prepared.routes)).toBe(
			true,
		);
		expect(
			simulationScenarioLeaseClaimsMatchSources(
				snapshot,
				manifest,
				prepared.routes,
				prepared.leaseClaims,
			),
		).toBe(true);
		expect(
			simulationScenarioResourceRunConfigurationMatchesSources(
				snapshot,
				manifest,
				prepared.routes,
				prepared.leaseClaims,
				prepared.admissionProgram,
				prepared.serviceTiming,
				resources,
				prepared.resourceRunConfiguration,
			),
		).toBe(true);
		expect(
			simulationScenarioAdmissionProgramMatchesSources(
				snapshot,
				manifest,
				prepared.routes,
				prepared.leaseClaims,
				prepared.admissionProgram,
			),
		).toBe(true);
		expect(
			simulationScenarioServiceTimingMatchesSources(
				snapshot,
				manifest,
				prepared.routes,
				prepared.leaseClaims,
				prepared.admissionProgram,
				input,
				prepared.serviceTiming,
			),
		).toBe(true);
		expect(snapshot.foundation.paths.positions.byteLength).toBe(canonicalPositionBytes);
		expect(worker.requestTransferCount).toBeGreaterThan(0);
		expect(worker.requestTransferBytes).toBe(snapshot.certificate.snapshotByteLength);
		expect(worker.responseTransferCount).toBeGreaterThan(0);
		expect(worker.responseTransferBytes).toBe(
			prepared.routes.byteLength +
				prepared.leaseClaims.byteLength +
				prepared.admissionProgram.byteLength +
				prepared.serviceTiming.byteLength +
				prepared.resourceRunConfiguration.byteLength,
		);
		expect(worker.terminated).toBe(true);
	});

	it("rejects stale correlation and routes that do not match the retained sources", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();
		const staleWorker = new ControlledScenarioPreparationWorker();
		const stalePending = new SimulationScenarioPreparationBridge(() => staleWorker).prepare(
			snapshot,
			manifest,
			timingInput(manifest),
			resourceInput(),
			4,
		);
		const staleResponse = await staleWorker.preparedResponse();
		staleWorker.emit({ ...staleResponse, generation: staleResponse.generation + 1 });
		await expect(stalePending).rejects.toThrow(/stale or mismatched response/i);
		expect(staleWorker.terminated).toBe(true);

		const foreignWorker = new ControlledScenarioPreparationWorker();
		const foreignPending = new SimulationScenarioPreparationBridge(() => foreignWorker).prepare(
			snapshot,
			manifest,
			timingInput(manifest),
			resourceInput(),
			5,
		);
		const foreignResponse = await foreignWorker.preparedResponse();
		if (foreignResponse.type !== "SIMULATION_SCENARIO_PREPARED") {
			throw new Error("Expected prepared scenario fixture response.");
		}
		foreignWorker.emit({
			...foreignResponse,
			routes: {
				...foreignResponse.routes,
				sourceCertificateFingerprint: "00000000:00000000",
			},
		});
		await expect(foreignPending).rejects.toThrow(/different sources/i);
		expect(foreignWorker.terminated).toBe(true);

		const unsafeWorker = new ControlledScenarioPreparationWorker();
		const unsafePending = new SimulationScenarioPreparationBridge(() => unsafeWorker).prepare(
			snapshot,
			manifest,
			timingInput(manifest),
			resourceInput(),
			6,
		);
		const unsafeResponse = await unsafeWorker.preparedResponse();
		if (unsafeResponse.type !== "SIMULATION_SCENARIO_PREPARED") {
			throw new Error("Expected prepared safety artifact fixture response.");
		}
		unsafeWorker.emit({
			...unsafeResponse,
			leaseClaims: {
				...unsafeResponse.leaseClaims,
				sourceRouteRequestsFingerprint: "00000000:00000000",
			},
		});
		await expect(unsafePending).rejects.toThrow(/incomplete safety artifacts/i);
		expect(unsafeWorker.terminated).toBe(true);
	});

	it("source-switching cancels the previous generation and ignores its late response", async () => {
		const workers: ControlledScenarioPreparationWorker[] = [];
		const bridge = new SimulationScenarioPreparationBridge(() => {
			const worker = new ControlledScenarioPreparationWorker();
			workers.push(worker);
			return worker;
		});
		const snapshot = readySnapshot();
		const plan = planManifest();
		const replay = replayManifest();
		const planPending = bridge.prepare(snapshot, plan, timingInput(plan), resourceInput(), 1);
		const planResponse = await (
			workers[0] as ControlledScenarioPreparationWorker
		).preparedResponse();
		const replayPending = bridge.prepare(snapshot, replay, timingInput(replay), resourceInput(), 2);

		await expect(planPending).rejects.toMatchObject({ name: "AbortError" });
		expect(workers[0]?.terminated).toBe(true);
		workers[0]?.emit(planResponse);
		const replayWorker = workers[1] as ControlledScenarioPreparationWorker;
		const replayResponse = await replayWorker.preparedResponse();
		replayWorker.emit(replayResponse);
		const prepared = await replayPending;
		expect(prepared.routes.sourceKind).toBe("REPLAY_HISTORY");
		expect(simulationScenarioRouteRequestsMatchSources(snapshot, replay, prepared.routes)).toBe(
			true,
		);
		expect(
			simulationScenarioLeaseClaimsMatchSources(
				snapshot,
				replay,
				prepared.routes,
				prepared.leaseClaims,
			),
		).toBe(true);
		expect(
			simulationScenarioAdmissionProgramMatchesSources(
				snapshot,
				replay,
				prepared.routes,
				prepared.leaseClaims,
				prepared.admissionProgram,
			),
		).toBe(true);
	});

	it("honors pre-abort, in-flight cancellation, native failure, and timeout", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();
		const preAborted = new AbortController();
		preAborted.abort();
		let creations = 0;
		const bridge = new SimulationScenarioPreparationBridge(() => {
			creations++;
			return new ControlledScenarioPreparationWorker();
		});
		await expect(
			bridge.prepare(
				snapshot,
				manifest,
				timingInput(manifest),
				resourceInput(),
				1,
				preAborted.signal,
			),
		).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(creations).toBe(0);

		const cancelledWorker = new ControlledScenarioPreparationWorker();
		const controller = new AbortController();
		const cancelled = new SimulationScenarioPreparationBridge(() => cancelledWorker).prepare(
			snapshot,
			manifest,
			timingInput(manifest),
			resourceInput(),
			2,
			controller.signal,
		);
		controller.abort();
		await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelledWorker.terminated).toBe(true);

		const failedWorker = new ControlledScenarioPreparationWorker();
		const failed = new SimulationScenarioPreparationBridge(() => failedWorker).prepare(
			snapshot,
			manifest,
			timingInput(manifest),
			resourceInput(),
			3,
		);
		failedWorker.emitError("worker crashed");
		await expect(failed).rejects.toThrow("worker crashed");

		const unreadableWorker = new ControlledScenarioPreparationWorker();
		const unreadable = new SimulationScenarioPreparationBridge(() => unreadableWorker).prepare(
			snapshot,
			manifest,
			timingInput(manifest),
			resourceInput(),
			4,
		);
		unreadableWorker.emitMessageError();
		await expect(unreadable).rejects.toThrow(/unreadable response/i);

		const silentWorker = new ControlledScenarioPreparationWorker();
		const timeoutBridge = new SimulationScenarioPreparationBridge(() => silentWorker, 1);
		await expect(
			timeoutBridge.prepare(snapshot, manifest, timingInput(manifest), resourceInput(), 5),
		).rejects.toThrow(/timed out after 1 ms/i);
		expect(silentWorker.terminated).toBe(true);
	});
});

function readySnapshot() {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

function planManifest() {
	return compileSimulationTransferPlanManifest({
		...header("PLAN-WORKER-1"),
		records: [
			{
				transferId: "PLAN-1",
				sourceOrdinal: 0,
				releaseTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	});
}

function replayManifest() {
	return compileSimulationReplayHistoryManifest({
		...header("REPLAY-WORKER-1"),
		records: [
			{
				historyEventId: "HISTORY-1",
				sourceOrdinal: 0,
				observedTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	});
}

function header(manifestId: string) {
	return {
		manifestId,
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: 1,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function transferByteLength(values: readonly Transferable[]): number {
	let total = 0;
	for (const value of values) {
		if (value instanceof ArrayBuffer) total += value.byteLength;
	}
	return total;
}

function timingInput(
	manifest: ReturnType<typeof planManifest> | ReturnType<typeof replayManifest>,
) {
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
