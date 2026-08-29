import { describe, expect, it } from "vitest";
import { hydrateStaticFabHierarchyIndexSnapshot } from "../compile/StaticFabHierarchySnapshot";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	PreparedStaticFabHierarchy,
	StaticFabHierarchyWorkerRequest,
	StaticFabHierarchyWorkerResponse,
} from "../worker/StaticFabHierarchyProtocol";
import { prepareStaticFabHierarchy } from "../worker/StaticFabHierarchyRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	StaticFabHierarchyBridge,
	type StaticFabHierarchyWorkerPort,
} from "./StaticFabHierarchyBridge";

class FakeStaticFabHierarchyWorker implements StaticFabHierarchyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabHierarchyWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	transferredBuffers = 0;
	transferredBytes = 0;
	responseTransferredBuffers = 0;
	responseTransferredBytes = 0;

	postMessage(message: StaticFabHierarchyWorkerRequest, transfer: Transferable[] = []): void {
		this.transferredBuffers = transfer.length;
		this.transferredBytes = transfer.reduce<number>(
			(total, item) => total + (item instanceof ArrayBuffer ? item.byteLength : 0),
			0,
		);
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated) return;
			const response = {
				type: "STATIC_FAB_HIERARCHY_PREPARED",
				requestId: delivered.requestId,
				prepared: prepareStaticFabHierarchy(delivered),
			} satisfies StaticFabHierarchyWorkerResponse;
			const responseTransfers = collectTransferableBuffers(response);
			this.responseTransferredBuffers = responseTransfers.length;
			this.responseTransferredBytes = responseTransfers.reduce(
				(total, buffer) => total + buffer.byteLength,
				0,
			);
			const deliveredResponse = structuredClone(response, { transfer: responseTransfers });
			this.onmessage?.({
				data: deliveredResponse,
			} as MessageEvent<StaticFabHierarchyWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class SilentStaticFabHierarchyWorker implements StaticFabHierarchyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabHierarchyWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(): void {}

	terminate(): void {
		this.terminated = true;
	}
}

class ErrorStaticFabHierarchyWorker implements StaticFabHierarchyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabHierarchyWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(message: StaticFabHierarchyWorkerRequest): void {
		queueMicrotask(() => {
			if (this.terminated) return;
			this.onmessage?.({
				data: {
					type: "STATIC_FAB_HIERARCHY_ERROR",
					requestId: message.requestId,
					message: "revision mismatch",
				},
			} as MessageEvent<StaticFabHierarchyWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class PreparedMetadataStaticFabHierarchyWorker implements StaticFabHierarchyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabHierarchyWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	private readonly transformPrepared: (
		prepared: PreparedStaticFabHierarchy,
	) => PreparedStaticFabHierarchy;

	constructor(
		transformPrepared: (prepared: PreparedStaticFabHierarchy) => PreparedStaticFabHierarchy,
	) {
		this.transformPrepared = transformPrepared;
	}

	postMessage(message: StaticFabHierarchyWorkerRequest, transfer: Transferable[] = []): void {
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated) return;
			const prepared = this.transformPrepared({
				sourceRevision: delivered.snapshot.revision,
				sourceChecksum: delivered.snapshot.checksum,
				hierarchySnapshot: {
					revision: delivered.snapshot.revision,
				} as PreparedStaticFabHierarchy["hierarchySnapshot"],
				preparationMilliseconds: 0,
			});
			this.onmessage?.({
				data: {
					type: "STATIC_FAB_HIERARCHY_PREPARED",
					requestId: delivered.requestId,
					prepared,
				},
			} as MessageEvent<StaticFabHierarchyWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class MalformedPreparedStaticFabHierarchyWorker implements StaticFabHierarchyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabHierarchyWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(message: StaticFabHierarchyWorkerRequest): void {
		queueMicrotask(() => {
			if (this.terminated) return;
			this.onmessage?.({
				data: {
					type: "STATIC_FAB_HIERARCHY_PREPARED",
					requestId: message.requestId,
					prepared: null,
				},
			} as unknown as MessageEvent<StaticFabHierarchyWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

async function expectPreparedResponseMismatch(
	transformPrepared: (prepared: PreparedStaticFabHierarchy) => PreparedStaticFabHierarchy,
	expectedMessage: string,
): Promise<void> {
	const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
	const worker = new PreparedMetadataStaticFabHierarchyWorker(transformPrepared);
	const bridge = new StaticFabHierarchyBridge(() => worker);

	await expect(
		bridge.prepare({
			snapshot: captureRailMirrorSnapshot(
				build.document.map,
				build.document.getPatchSequence(),
				build.document.portEquipment,
			).snapshot,
		}),
	).rejects.toThrow(expectedMessage);
	expect(worker.terminated).toBe(true);
}

describe("StaticFabHierarchyBridge", () => {
	it("transfers and derives the complete Large FAB hierarchy off the caller boundary", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const snapshot = captureRailMirrorSnapshot(
			build.document.map,
			build.document.getPatchSequence(),
			build.document.portEquipment,
		).snapshot;
		const worker = new FakeStaticFabHierarchyWorker();
		const bridge = new StaticFabHierarchyBridge(() => worker, 60_000);

		const prepared = await bridge.prepare({ snapshot });
		const index = hydrateStaticFabHierarchyIndexSnapshot(prepared.hierarchySnapshot, ownership);

		expect(prepared.sourceRevision).toBe(build.document.map.getRevision());
		expect(prepared.sourceChecksum).toBe(build.authoredChecksum);
		expect(index.branches).toHaveLength(1);
		expect(index.branches[0]?.wings).toHaveLength(12);
		expect(index.branches[0]?.processRows).toHaveLength(6);
		expect(index.branches[0]?.processBanks).toHaveLength(6);
		expect(index.branches[0]?.processBlocks).toHaveLength(3);
		expect(worker.transferredBuffers).toBeGreaterThan(10);
		expect(worker.transferredBytes).toBeGreaterThan(0);
		expect(worker.responseTransferredBuffers).toBeGreaterThan(5);
		expect(worker.responseTransferredBytes).toBeLessThan(128 * 1024);
		expect(snapshot.xs.byteLength).toBe(0);
		expect(worker.terminated).toBe(true);
	}, 120_000);

	it("rejects a matching-request response with a stale source revision", async () => {
		await expectPreparedResponseMismatch(
			(prepared) => ({
				...prepared,
				sourceRevision: prepared.sourceRevision + 1,
			}),
			"source revision",
		);
	});

	it("rejects a matching-request response with a stale source checksum", async () => {
		await expectPreparedResponseMismatch(
			(prepared) => ({
				...prepared,
				sourceChecksum: `${prepared.sourceChecksum}-stale`,
			}),
			"source checksum",
		);
	});

	it("rejects a matching-request response with a stale hierarchy revision", async () => {
		await expectPreparedResponseMismatch(
			(prepared) => ({
				...prepared,
				hierarchySnapshot: {
					...prepared.hierarchySnapshot,
					revision: prepared.hierarchySnapshot.revision + 1,
				},
			}),
			"hierarchy revision",
		);
	});

	it("rejects malformed prepared data without leaving the request pending", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const worker = new MalformedPreparedStaticFabHierarchyWorker();
		const bridge = new StaticFabHierarchyBridge(() => worker, 5);

		await expect(
			bridge.prepare({
				snapshot: captureRailMirrorSnapshot(
					build.document.map,
					build.document.getPatchSequence(),
					build.document.portEquipment,
				).snapshot,
			}),
		).rejects.toThrow("malformed prepared data");
		expect(worker.terminated).toBe(true);
	});

	it("terminates and rejects superseded hierarchy inference", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const firstWorker = new SilentStaticFabHierarchyWorker();
		const secondWorker = new FakeStaticFabHierarchyWorker();
		let workerIndex = 0;
		const bridge = new StaticFabHierarchyBridge(
			() => [firstWorker, secondWorker][workerIndex++] as StaticFabHierarchyWorkerPort,
		);
		const firstPreparation = bridge.prepare({
			snapshot: captureRailMirrorSnapshot(
				build.document.map,
				build.document.getPatchSequence(),
				build.document.portEquipment,
			).snapshot,
		});
		const secondPreparation = bridge.prepare({
			snapshot: captureRailMirrorSnapshot(
				build.document.map,
				build.document.getPatchSequence(),
				build.document.portEquipment,
			).snapshot,
		});

		await expect(firstPreparation).rejects.toMatchObject({ name: "AbortError" });
		await expect(secondPreparation).resolves.toMatchObject({
			sourceRevision: build.document.map.getRevision(),
		});
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it("disposes a pending hierarchy inference with the cancellation contract intact", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const worker = new SilentStaticFabHierarchyWorker();
		const bridge = new StaticFabHierarchyBridge(() => worker);
		const preparation = bridge.prepare({
			snapshot: captureRailMirrorSnapshot(
				build.document.map,
				build.document.getPatchSequence(),
				build.document.portEquipment,
			).snapshot,
		});

		bridge.dispose();

		await expect(preparation).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
	});

	it("terminates a hierarchy Worker that misses its deadline", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const worker = new SilentStaticFabHierarchyWorker();
		const bridge = new StaticFabHierarchyBridge(() => worker, 1);

		await expect(
			bridge.prepare({
				snapshot: captureRailMirrorSnapshot(
					build.document.map,
					build.document.getPatchSequence(),
					build.document.portEquipment,
				).snapshot,
			}),
		).rejects.toThrow("timed out");
		expect(worker.terminated).toBe(true);
	});

	it("surfaces a typed Worker failure and releases the failed Worker", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const worker = new ErrorStaticFabHierarchyWorker();
		const bridge = new StaticFabHierarchyBridge(() => worker);

		await expect(
			bridge.prepare({
				snapshot: captureRailMirrorSnapshot(
					build.document.map,
					build.document.getPatchSequence(),
					build.document.portEquipment,
				).snapshot,
			}),
		).rejects.toThrow("revision mismatch");
		expect(worker.terminated).toBe(true);
	});

	it("turns synchronous Worker construction failure into a rejected preparation", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const bridge = new StaticFabHierarchyBridge(() => {
			throw new Error("worker unavailable");
		});

		await expect(
			bridge.prepare({
				snapshot: captureRailMirrorSnapshot(
					build.document.map,
					build.document.getPatchSequence(),
					build.document.portEquipment,
				).snapshot,
			}),
		).rejects.toThrow("worker unavailable");
	});
});
