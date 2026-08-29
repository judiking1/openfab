import { describe, expect, it } from "vitest";
import { isPublishedSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import type {
	SimulationResidentScenarioPreparationWorkerRequest,
	SimulationResidentScenarioPreparationWorkerResponse,
} from "../worker/SimulationResidentScenarioPreparationWorkerProtocol";
import { prepareSimulationResidentScenarioWorkerRequest } from "../worker/SimulationResidentScenarioPreparationWorkerRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { adaptSimulationResidentScenarioEditorRunAsset } from "./SimulationResidentScenarioEditorSourceAdapter";
import {
	SimulationResidentScenarioPreparationBridge,
	type SimulationResidentScenarioPreparationWorkerPort,
} from "./SimulationResidentScenarioPreparationBridge";

class RuntimePreparationWorker implements SimulationResidentScenarioPreparationWorkerPort {
	onmessage:
		| ((event: MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>) => void)
		| null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestTransferBytes = 0;
	responseTransferCount = 0;
	responseTransferBytes = 0;

	postMessage(
		message: SimulationResidentScenarioPreparationWorkerRequest,
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

	private async respond(
		request: SimulationResidentScenarioPreparationWorkerRequest,
	): Promise<void> {
		if (this.terminated) return;
		try {
			const response = await prepareSimulationResidentScenarioWorkerRequest(request);
			const transfers = collectTransferableBuffers(response);
			this.responseTransferCount = transfers.length;
			this.responseTransferBytes = transferByteLength(transfers);
			const delivered = structuredClone(response, { transfer: [...transfers] });
			this.onmessage?.({
				data: delivered,
			} as MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>);
		} catch (error) {
			this.onerror?.({
				message: error instanceof Error ? error.message : "resident scenario preparation failed",
			} as ErrorEvent);
		}
	}
}

class ControlledPreparationWorker implements SimulationResidentScenarioPreparationWorkerPort {
	onmessage:
		| ((event: MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>) => void)
		| null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	request: SimulationResidentScenarioPreparationWorkerRequest | null = null;

	postMessage(
		message: SimulationResidentScenarioPreparationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.request = structuredClone(message, { transfer });
	}

	async preparedResponse(): Promise<SimulationResidentScenarioPreparationWorkerResponse> {
		if (!this.request) throw new Error("Expected a resident preparation request.");
		return prepareSimulationResidentScenarioWorkerRequest(this.request);
	}

	emit(response: SimulationResidentScenarioPreparationWorkerResponse): void {
		this.onmessage?.({
			data: response,
		} as MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>);
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("SimulationResidentScenarioPreparationBridge", () => {
	it("keeps canonical OpenFab sources attached while adopting exact Worker-derived artifacts", async () => {
		const fixture = await bridgeFixture();
		const canonicalPositionBytes = fixture.components.foundation.paths.positions.byteLength;
		const worker = new RuntimePreparationWorker();
		const bridge = new SimulationResidentScenarioPreparationBridge(() => worker);

		const snapshot = await bridge.prepare(fixture.components, fixture.runAsset, 9);

		expect(await isPublishedSimulationResidentReadinessSnapshot(snapshot)).toBe(true);
		expect(snapshot.foundation).toBe(fixture.components.foundation);
		expect(snapshot.parking).toBe(fixture.runAsset.parking);
		expect(snapshot.manifest).toBe(fixture.runAsset.manifest);
		expect(snapshot.foundation.paths.positions.byteLength).toBe(canonicalPositionBytes);
		expect(worker.requestTransferCount).toBeGreaterThan(0);
		expect(worker.requestTransferBytes).toBeGreaterThan(canonicalPositionBytes);
		expect(worker.responseTransferCount).toBeGreaterThan(0);
		expect(worker.responseTransferBytes).toBeGreaterThan(0);
		expect(worker.terminated).toBe(true);
	});

	it("captures only the five static components from an app binding that also carries a certificate", async () => {
		const fixture = await bridgeFixture();
		const worker = new RuntimePreparationWorker();
		const bridge = new SimulationResidentScenarioPreparationBridge(() => worker);
		const appBinding = Object.freeze({
			...fixture.components,
			certificate: Object.freeze({ fingerprint: "CURRENT-READINESS-CERTIFICATE" }),
		});

		const snapshot = await bridge.prepare(appBinding, fixture.runAsset, 10);

		expect(await isPublishedSimulationResidentReadinessSnapshot(snapshot)).toBe(true);
		expect(snapshot.certificate.readinessProfileId).toBe(
			"OPENFAB_EXPLICIT_HOME_RETURN_RESIDENT_FLEET_READINESS_V1",
		);
		expect(Object.keys(snapshot)).toEqual([
			"foundation",
			"trackResources",
			"stationCapabilities",
			"equipmentResources",
			"occupancyPolicy",
			"parking",
			"manifest",
			"routes",
			"leaseClaims",
			"admissionProgram",
			"serviceTiming",
			"resourceRunConfiguration",
			"certificate",
		]);
	});

	it("rejects stale correlation and a response bound to a foreign run asset", async () => {
		const fixture = await bridgeFixture();
		const staleWorker = new ControlledPreparationWorker();
		const stalePending = new SimulationResidentScenarioPreparationBridge(() => staleWorker).prepare(
			fixture.components,
			fixture.runAsset,
			4,
		);
		const staleResponse = await staleWorker.preparedResponse();
		staleWorker.emit({ ...staleResponse, requestId: staleResponse.requestId + 1 });
		await expect(stalePending).rejects.toThrow(/stale correlation/i);
		expect(staleWorker.terminated).toBe(true);

		const foreignWorker = new ControlledPreparationWorker();
		const foreignPending = new SimulationResidentScenarioPreparationBridge(
			() => foreignWorker,
		).prepare(fixture.components, fixture.runAsset, 5);
		const foreignResponse = await foreignWorker.preparedResponse();
		if (foreignResponse.type !== "SIMULATION_RESIDENT_SCENARIO_PREPARED") {
			throw new Error("Expected a prepared resident response.");
		}
		foreignWorker.emit({ ...foreignResponse, runAssetFingerprint: "foreign" });
		await expect(foreignPending).rejects.toThrow(/foreign run asset/i);
		expect(foreignWorker.terminated).toBe(true);
	});

	it("rejects otherwise valid derived artifacts that alias one transferred buffer", async () => {
		const fixture = await bridgeFixture();
		const worker = new ControlledPreparationWorker();
		const pending = new SimulationResidentScenarioPreparationBridge(() => worker).prepare(
			fixture.components,
			fixture.runAsset,
			6,
		);
		const response = await worker.preparedResponse();
		if (response.type !== "SIMULATION_RESIDENT_SCENARIO_PREPARED") {
			throw new Error("Expected a prepared resident response.");
		}
		expect(response.leaseClaims.switchConflictClaimRows.byteLength).toBe(0);
		expect(
			response.resourceRunConfiguration.eqAvailabilityWindowStartsMicroseconds.byteLength,
		).toBe(0);
		const sharedEmptyBuffer = new ArrayBuffer(0);
		worker.emit({
			...response,
			leaseClaims: {
				...response.leaseClaims,
				switchConflictClaimRows: new Uint32Array(sharedEmptyBuffer),
			},
			resourceRunConfiguration: {
				...response.resourceRunConfiguration,
				eqAvailabilityWindowStartsMicroseconds: new Float64Array(sharedEmptyBuffer),
			},
		});

		await expect(pending).rejects.toThrow(/aliases derived artifacts/i);
		expect(worker.terminated).toBe(true);
	});

	it("cancels an older generation and ignores its late Worker response", async () => {
		const fixture = await bridgeFixture();
		const workers: ControlledPreparationWorker[] = [];
		const bridge = new SimulationResidentScenarioPreparationBridge(() => {
			const worker = new ControlledPreparationWorker();
			workers.push(worker);
			return worker;
		});
		const firstPending = bridge.prepare(fixture.components, fixture.runAsset, 1);
		const firstWorker = workers[0] as ControlledPreparationWorker;
		const firstResponse = await firstWorker.preparedResponse();
		const secondPending = bridge.prepare(fixture.components, fixture.runAsset, 2);

		await expect(firstPending).rejects.toMatchObject({ name: "AbortError" });
		expect(firstWorker.terminated).toBe(true);
		firstWorker.emit(firstResponse);
		const secondWorker = workers[1] as ControlledPreparationWorker;
		secondWorker.emit(await secondWorker.preparedResponse());
		await expect(secondPending).resolves.toMatchObject({
			certificate: { sourceKind: "TRANSFER_PLAN" },
		});
		expect(secondWorker.terminated).toBe(true);
	});
});

async function bridgeFixture() {
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
			manifestId: "BRIDGE-PLAN-1",
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

function transferByteLength(values: readonly Transferable[]): number {
	let total = 0;
	for (const value of values) {
		if (value instanceof ArrayBuffer) total += value.byteLength;
	}
	return total;
}
