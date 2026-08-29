import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	type CompiledRailPresentation,
	compilePhysicalRailPresentation,
} from "../render/PhysicalRailPresentation";
import {
	collectStaticFabInspection3DChunkedArtifactTransferBuffers,
	isStaticFabInspection3DChunkedArtifact,
	type StaticFabInspection3DChunkedArtifact,
} from "../render/StaticFabInspection3DArtifact";
import {
	compileStaticFabInspection3DWorkerRequest,
	type StaticFabInspection3DWorkerRequest,
	type StaticFabInspection3DWorkerResponse,
} from "../worker/StaticFabInspection3DRuntime";
import {
	StaticFabInspection3DBridge,
	type StaticFabInspection3DWorkerPort,
} from "./StaticFabInspection3DBridge";

class RuntimeInspectionWorker implements StaticFabInspection3DWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabInspection3DWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestTransferBytes = 0;
	responseTransferCount = 0;
	responseTransferBytes = 0;
	requestSnapshotWasDetached = false;

	postMessage(message: StaticFabInspection3DWorkerRequest, transfer: Transferable[] = []): void {
		this.requestTransferCount = transfer.length;
		this.requestTransferBytes = transferByteLength(transfer);
		const delivered = structuredClone(message, { transfer });
		this.requestSnapshotWasDetached = message.snapshot.positions.byteLength === 0;
		queueMicrotask(() => {
			if (this.terminated) return;
			try {
				const artifact = compileStaticFabInspection3DWorkerRequest(delivered);
				const response = {
					type: "STATIC_FAB_INSPECTION_3D_COMPILED",
					requestId: delivered.requestId,
					artifact,
				} satisfies StaticFabInspection3DWorkerResponse;
				const responseTransfers =
					collectStaticFabInspection3DChunkedArtifactTransferBuffers(artifact);
				this.responseTransferCount = responseTransfers.length;
				this.responseTransferBytes = transferByteLength(responseTransfers);
				const deliveredResponse = structuredClone(response, { transfer: responseTransfers });
				this.onmessage?.({
					data: deliveredResponse,
				} as MessageEvent<StaticFabInspection3DWorkerResponse>);
			} catch (error) {
				this.onmessage?.({
					data: {
						type: "STATIC_FAB_INSPECTION_3D_ERROR",
						requestId: delivered.requestId,
						message: error instanceof Error ? error.message : "runtime failed",
					},
				} as MessageEvent<StaticFabInspection3DWorkerResponse>);
			}
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class ControlledInspectionWorker implements StaticFabInspection3DWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabInspection3DWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	request: StaticFabInspection3DWorkerRequest | null = null;

	postMessage(message: StaticFabInspection3DWorkerRequest, transfer: Transferable[] = []): void {
		this.request = structuredClone(message, { transfer });
	}

	compileArtifact(): StaticFabInspection3DChunkedArtifact {
		if (!this.request) throw new Error("Expected a posted 3D inspection request.");
		return compileStaticFabInspection3DWorkerRequest(this.request);
	}

	emit(response: StaticFabInspection3DWorkerResponse): void {
		this.onmessage?.({ data: response } as MessageEvent<StaticFabInspection3DWorkerResponse>);
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

describe("StaticFabInspection3DBridge", () => {
	it("transfers an owned snapshot through the runtime and returns an attached artifact", async () => {
		const presentation = presentationFixture();
		const canonicalPositions = presentation.source.positions;
		const canonicalByteLength = canonicalPositions.byteLength;
		const worker = new RuntimeInspectionWorker();
		const bridge = new StaticFabInspection3DBridge(() => worker);

		const artifact = await bridge.compile(presentation, 19);

		expect(artifact).toMatchObject({
			sourceGeneration: 19,
			sourceRevision: presentation.source.revision,
			pathCount: presentation.source.pathCount,
		});
		expect(isStaticFabInspection3DChunkedArtifact(artifact)).toBe(true);
		expect(artifact.railChunks[0]?.bed.positions.byteLength).toBeGreaterThan(0);
		expect(worker.requestTransferCount).toBe(15);
		expect(worker.requestTransferBytes).toBeGreaterThan(0);
		expect(worker.responseTransferCount).toBe(23);
		expect(worker.responseTransferBytes).toBe(artifact.byteLength);
		expect(worker.requestSnapshotWasDetached).toBe(true);
		expect(worker.terminated).toBe(true);
		expect(canonicalPositions.byteLength).toBe(canonicalByteLength);
	});

	it("rejects an invalid source generation before creating a Worker", async () => {
		let workerCreations = 0;
		const bridge = new StaticFabInspection3DBridge(() => {
			workerCreations++;
			return new ControlledInspectionWorker();
		});

		await expect(bridge.compile(presentationFixture(), -1)).rejects.toBeInstanceOf(RangeError);
		expect(workerCreations).toBe(0);
	});

	it("rejects stale request ids and mismatched or malformed derived artifacts", async () => {
		await expectRejectedResponse(
			(request, artifact) => ({
				type: "STATIC_FAB_INSPECTION_3D_COMPILED",
				requestId: request.requestId + 1,
				artifact,
			}),
			/stale request/i,
		);
		await expectRejectedResponse(
			(request, artifact) => ({
				type: "STATIC_FAB_INSPECTION_3D_COMPILED",
				requestId: request.requestId,
				artifact: { ...artifact, sourceGeneration: artifact.sourceGeneration + 1 },
			}),
			/mismatched derived geometry/i,
		);
		await expectRejectedResponse(
			(request, artifact) => ({
				type: "STATIC_FAB_INSPECTION_3D_COMPILED",
				requestId: request.requestId,
				artifact: { ...artifact, sourceRevision: artifact.sourceRevision + 1 },
			}),
			/mismatched derived geometry/i,
		);
		await expectRejectedResponse(
			(request, artifact) => ({
				type: "STATIC_FAB_INSPECTION_3D_COMPILED",
				requestId: request.requestId,
				artifact: { ...artifact, byteLength: artifact.byteLength + 1 },
			}),
			/mismatched derived geometry/i,
		);
	});

	it("surfaces typed, native, and unreadable Worker failures and releases each Worker", async () => {
		const typedWorker = new ControlledInspectionWorker();
		const typedPending = new StaticFabInspection3DBridge(() => typedWorker).compile(
			presentationFixture(),
			3,
		);
		if (!typedWorker.request) throw new Error("Expected typed failure request.");
		typedWorker.emit({
			type: "STATIC_FAB_INSPECTION_3D_ERROR",
			requestId: typedWorker.request.requestId,
			message: "geometry budget exceeded",
		});
		await expect(typedPending).rejects.toThrow("geometry budget exceeded");
		expect(typedWorker.terminated).toBe(true);

		const nativeWorker = new ControlledInspectionWorker();
		const nativePending = new StaticFabInspection3DBridge(() => nativeWorker).compile(
			presentationFixture(),
			4,
		);
		nativeWorker.emitError("worker crashed");
		await expect(nativePending).rejects.toThrow("worker crashed");
		expect(nativeWorker.terminated).toBe(true);

		const unreadableWorker = new ControlledInspectionWorker();
		const unreadablePending = new StaticFabInspection3DBridge(() => unreadableWorker).compile(
			presentationFixture(),
			5,
		);
		unreadableWorker.emitMessageError();
		await expect(unreadablePending).rejects.toThrow(/unreadable response/i);
		expect(unreadableWorker.terminated).toBe(true);
	});

	it("honors pre-aborted and in-flight AbortSignals without detaching canonical data", async () => {
		const preAborted = new AbortController();
		preAborted.abort();
		const prePresentation = presentationFixture();
		const preByteLength = prePresentation.source.positions.byteLength;
		let workerCreations = 0;
		const bridge = new StaticFabInspection3DBridge(() => {
			workerCreations++;
			return new ControlledInspectionWorker();
		});

		await expect(bridge.compile(prePresentation, 1, preAborted.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(workerCreations).toBe(0);
		expect(prePresentation.source.positions.byteLength).toBe(preByteLength);

		const worker = new ControlledInspectionWorker();
		const controller = new AbortController();
		const pending = new StaticFabInspection3DBridge(() => worker).compile(
			presentationFixture(),
			2,
			controller.signal,
		);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
	});

	it("cancels an in-flight compile through the public cancellation contract", async () => {
		const worker = new ControlledInspectionWorker();
		const bridge = new StaticFabInspection3DBridge(() => worker);
		const pending = bridge.compile(presentationFixture(), 8);

		bridge.cancel();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
	});

	it("cancels a superseded compile and resolves only the newest source generation", async () => {
		const firstWorker = new ControlledInspectionWorker();
		const secondWorker = new RuntimeInspectionWorker();
		let workerIndex = 0;
		const bridge = new StaticFabInspection3DBridge(
			() => [firstWorker, secondWorker][workerIndex++] as StaticFabInspection3DWorkerPort,
		);
		const first = bridge.compile(presentationFixture(), 10);
		const second = bridge.compile(presentationFixture(), 11);

		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		await expect(second).resolves.toMatchObject({ sourceGeneration: 11 });
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it("settles once and ignores a duplicate response delivered through a captured handler", async () => {
		const worker = new ControlledInspectionWorker();
		const pending = new StaticFabInspection3DBridge(() => worker).compile(presentationFixture(), 7);
		if (!worker.request || !worker.onmessage)
			throw new Error("Expected an active request handler.");
		const request = worker.request;
		const handler = worker.onmessage;
		let resolveCount = 0;
		void pending.then(() => {
			resolveCount++;
		});
		handler({
			data: {
				type: "STATIC_FAB_INSPECTION_3D_COMPILED",
				requestId: request.requestId,
				artifact: worker.compileArtifact(),
			},
		} as MessageEvent<StaticFabInspection3DWorkerResponse>);
		await expect(pending).resolves.toMatchObject({ sourceGeneration: 7 });

		handler({
			data: {
				type: "STATIC_FAB_INSPECTION_3D_ERROR",
				requestId: request.requestId,
				message: "late duplicate",
			},
		} as MessageEvent<StaticFabInspection3DWorkerResponse>);
		await Promise.resolve();
		expect(resolveCount).toBe(1);
		expect(worker.terminated).toBe(true);
	});
});

async function expectRejectedResponse(
	createResponse: (
		request: StaticFabInspection3DWorkerRequest,
		artifact: StaticFabInspection3DChunkedArtifact,
	) => unknown,
	expectedMessage: RegExp,
): Promise<void> {
	const worker = new ControlledInspectionWorker();
	const pending = new StaticFabInspection3DBridge(() => worker).compile(presentationFixture(), 6);
	if (!worker.request) throw new Error("Expected a posted request.");
	worker.emit(
		createResponse(worker.request, worker.compileArtifact()) as StaticFabInspection3DWorkerResponse,
	);
	await expect(pending).rejects.toThrow(expectedMessage);
	expect(worker.terminated).toBe(true);
}

function presentationFixture(): CompiledRailPresentation {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`3D inspection presentation fixture failed: ${plan.reason}`);
	}
	return compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
}

function transferByteLength(transfer: readonly Transferable[]): number {
	return transfer.reduce<number>(
		(total, item) => total + (item instanceof ArrayBuffer ? item.byteLength : 0),
		0,
	);
}
