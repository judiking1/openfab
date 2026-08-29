import { describe, expect, it } from "vitest";
import {
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { createEmptyOpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import type { OpenFabProjectManifest } from "../project/OpenFabProject";
import type {
	OpenFabProjectSerializationRequest,
	OpenFabProjectSerializationResponse,
} from "../worker/OpenFabProjectSerializationProtocol";
import { serializeOpenFabProjectSnapshot } from "../worker/OpenFabProjectSerializationRuntime";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	OpenFabProjectSerializationBridge,
	type OpenFabProjectSerializationWorkerPort,
} from "./OpenFabProjectSerializationBridge";
import { RailStartupCancelledError } from "./RailStartupBridge";

describe("OpenFabProjectSerializationBridge", () => {
	it("transfers the disposable snapshot and returns only canonical JSON metadata", async () => {
		const worker = new FakeSerializationWorker();
		const bridge = new OpenFabProjectSerializationBridge(() => worker);
		const document = createRailScaleProbeDocument(12);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const expectedTransfers = collectTransferableBuffers(snapshot);
		const operations = operationalConfigurationFixture();
		const pending = bridge.serialize(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS, operations);
		const request = worker.request;
		if (!request) throw new Error("expected serialization request");

		expect(new Set(worker.transfers)).toEqual(new Set(expectedTransfers));
		expect(request.operations).toEqual(operations);
		const serialized = serializeOpenFabProjectSnapshot(
			request.snapshot,
			request.manifest,
			null,
			request.blueprints,
			request.operations,
		);
		worker.emit({
			type: "OPENFAB_PROJECT_SERIALIZED",
			requestId: request.requestId,
			...serialized,
		});

		await expect(pending).resolves.toMatchObject({
			authoredChecksum: serialized.authoredChecksum,
			characterCount: serialized.characterCount,
		});
		expect(worker.terminated).toBe(true);
		expect(JSON.parse(serialized.json).operations).toEqual(operations);
	});

	it("terminates and rejects active serialization on cancellation", async () => {
		const worker = new FakeSerializationWorker();
		const bridge = new OpenFabProjectSerializationBridge(() => worker);
		const document = createRailScaleProbeDocument(12);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const pending = bridge.serialize(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS);
		bridge.cancel();

		await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(worker.terminated).toBe(true);
	});

	it("rejects malformed, stale, and mismatched serialization responses", async () => {
		for (const response of [
			(request: OpenFabProjectSerializationRequest, serialized: SerializedResult) => ({
				type: "UNKNOWN",
				requestId: request.requestId,
				...serialized,
			}),
			(request: OpenFabProjectSerializationRequest, serialized: SerializedResult) => ({
				type: "OPENFAB_PROJECT_SERIALIZED",
				requestId: request.requestId + 1,
				...serialized,
			}),
			(request: OpenFabProjectSerializationRequest, serialized: SerializedResult) => ({
				type: "OPENFAB_PROJECT_SERIALIZED",
				requestId: request.requestId,
				...serialized,
				authoredChecksum: "wrong-checksum",
			}),
			(request: OpenFabProjectSerializationRequest, serialized: SerializedResult) => ({
				type: "OPENFAB_PROJECT_SERIALIZED",
				requestId: request.requestId,
				...serialized,
				characterCount: serialized.characterCount + 1,
			}),
		]) {
			const worker = new FakeSerializationWorker();
			const bridge = new OpenFabProjectSerializationBridge(() => worker);
			const document = createRailScaleProbeDocument(12);
			const snapshot = captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
			).snapshot;
			const pending = bridge.serialize(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS);
			const request = worker.request;
			if (!request) throw new Error("expected serialization request");
			const serialized = serializeOpenFabProjectSnapshot(
				request.snapshot,
				request.manifest,
				request.view,
				request.blueprints,
				request.operations,
			);

			worker.emit(response(request, serialized));

			await expect(pending).rejects.toThrow();
			expect(worker.terminated).toBe(true);
		}
	});

	it("rejects timeout, decoding, worker creation, and postMessage failures", async () => {
		const timeoutWorker = new FakeSerializationWorker();
		const timeoutBridge = new OpenFabProjectSerializationBridge(() => timeoutWorker, 5);
		const timeoutDocument = createRailScaleProbeDocument(12);
		const timeoutSnapshot = captureRailMirrorSnapshot(
			timeoutDocument.map,
			timeoutDocument.getPatchSequence(),
		).snapshot;
		await expect(
			timeoutBridge.serialize(timeoutSnapshot, MANIFEST, null, EMPTY_BLUEPRINTS),
		).rejects.toThrow(/timed out/);
		expect(timeoutWorker.terminated).toBe(true);

		const messageWorker = new FakeSerializationWorker();
		const messageBridge = new OpenFabProjectSerializationBridge(() => messageWorker);
		const messageDocument = createRailScaleProbeDocument(12);
		const messageSnapshot = captureRailMirrorSnapshot(
			messageDocument.map,
			messageDocument.getPatchSequence(),
		).snapshot;
		const messagePending = messageBridge.serialize(
			messageSnapshot,
			MANIFEST,
			null,
			EMPTY_BLUEPRINTS,
		);
		messageWorker.onmessageerror?.({ data: null } as MessageEvent<unknown>);
		await expect(messagePending).rejects.toThrow(/decoded/);
		expect(messageWorker.terminated).toBe(true);

		const postWorker = new FakeSerializationWorker();
		postWorker.postError = new Error("post failed");
		const postBridge = new OpenFabProjectSerializationBridge(() => postWorker);
		const postDocument = createRailScaleProbeDocument(12);
		const postSnapshot = captureRailMirrorSnapshot(
			postDocument.map,
			postDocument.getPatchSequence(),
		).snapshot;
		await expect(
			postBridge.serialize(postSnapshot, MANIFEST, null, EMPTY_BLUEPRINTS),
		).rejects.toThrow(/post failed/);
		expect(postWorker.terminated).toBe(true);

		const createBridge = new OpenFabProjectSerializationBridge(() => {
			throw new Error("create failed");
		});
		const createDocument = createRailScaleProbeDocument(12);
		const createSnapshot = captureRailMirrorSnapshot(
			createDocument.map,
			createDocument.getPatchSequence(),
		).snapshot;
		await expect(
			createBridge.serialize(createSnapshot, MANIFEST, null, EMPTY_BLUEPRINTS),
		).rejects.toThrow(/create failed/);
	});
});

class FakeSerializationWorker implements OpenFabProjectSerializationWorkerPort {
	onmessage: ((event: MessageEvent<OpenFabProjectSerializationResponse>) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	request: OpenFabProjectSerializationRequest | null = null;
	transfers: Transferable[] = [];
	terminated = false;
	postError: Error | null = null;

	postMessage(request: OpenFabProjectSerializationRequest, transfers: Transferable[] = []): void {
		if (this.postError) throw this.postError;
		this.request = request;
		this.transfers = transfers;
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(response: unknown): void {
		this.onmessage?.({ data: response } as MessageEvent<OpenFabProjectSerializationResponse>);
	}
}

type SerializedResult = ReturnType<typeof serializeOpenFabProjectSnapshot>;

const MANIFEST: OpenFabProjectManifest = Object.freeze({
	id: "bridge-project",
	name: "Bridge project",
	createdAt: "2026-07-18T00:00:00.000Z",
	updatedAt: "2026-07-18T00:00:00.000Z",
});

const EMPTY_BLUEPRINTS = createEmptyOpenFabProjectBlueprintSection();

function operationalConfigurationFixture(): OperationalConfigurationState {
	return {
		...emptyOperationalConfigurationState(),
		revision: 1,
		vehicleProfile: {
			id: "OPENFAB_SERIALIZATION_TEST_OHT_V1",
			version: 1,
			bodyLengthMillimeters: 1_200,
			referenceToFrontMillimeters: 600,
			referenceToRearMillimeters: 600,
			bodyWidthMillimeters: 500,
			lateralSafetyMarginMillimeters: 50,
			frontSafetyMarginMillimeters: 200,
			rearSafetyMarginMillimeters: 200,
			maximumSpeedMillimetersPerSecond: 2_000,
			controlReactionMilliseconds: 100,
			minimumServiceDecelerationMillimetersPerSecondSquared: 1_000,
		},
	};
}
