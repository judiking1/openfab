import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabOrganizationOverview,
	prepareStaticFabOrganizationOverview,
	type StaticFabOrganizationOverviewWorkerRequest,
	type StaticFabOrganizationOverviewWorkerResponse,
} from "../worker/StaticFabOrganizationOverviewRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	StaticFabOrganizationOverviewBridge,
	type StaticFabOrganizationOverviewWorkerPort,
} from "./StaticFabOrganizationOverviewBridge";

class RuntimeOverviewWorker implements StaticFabOrganizationOverviewWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabOrganizationOverviewWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	responseTransferCount = 0;

	postMessage(
		message: StaticFabOrganizationOverviewWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.requestTransferCount = transfer.length;
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated) return;
			const response = {
				type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
				requestId: delivered.requestId,
				prepared: prepareStaticFabOrganizationOverview(delivered),
			} satisfies StaticFabOrganizationOverviewWorkerResponse;
			const responseTransfers = collectTransferableBuffers(response.prepared);
			this.responseTransferCount = responseTransfers.length;
			const deliveredResponse = structuredClone(response, { transfer: responseTransfers });
			this.onmessage?.({
				data: deliveredResponse,
			} as MessageEvent<StaticFabOrganizationOverviewWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class SilentOverviewWorker implements StaticFabOrganizationOverviewWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabOrganizationOverviewWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	postMessage(): void {}
	terminate(): void {
		this.terminated = true;
	}
}

class MutatingOverviewWorker implements StaticFabOrganizationOverviewWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabOrganizationOverviewWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	private readonly mutate: (
		request: StaticFabOrganizationOverviewWorkerRequest,
		prepared: PreparedStaticFabOrganizationOverview,
	) => unknown;

	constructor(
		mutate: (
			request: StaticFabOrganizationOverviewWorkerRequest,
			prepared: PreparedStaticFabOrganizationOverview,
		) => unknown,
	) {
		this.mutate = mutate;
	}

	postMessage(
		message: StaticFabOrganizationOverviewWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated) return;
			const prepared = prepareStaticFabOrganizationOverview(delivered);
			this.onmessage?.({
				data: this.mutate(delivered, prepared),
			} as MessageEvent<StaticFabOrganizationOverviewWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("StaticFabOrganizationOverviewBridge", () => {
	it("transfers a 50k canonical snapshot and reconstructs only the read-only artifact on main", async () => {
		const map = snakeMap(250, 200);
		const capture = captureRailMirrorSnapshot(map, 9);
		const source = sourceOf(capture.snapshot);
		const expectedRailReadinessFingerprint = readinessFingerprintFor(map, source.checksum);
		const worker = new RuntimeOverviewWorker();
		const bridge = new StaticFabOrganizationOverviewBridge(() => worker, 30_000);

		const overview = await bridge.prepare({
			snapshot: capture.snapshot,
			source,
			expectedRailReadinessFingerprint,
		});

		expect(overview).toMatchObject({
			sourceRevision: 41,
			sourceChecksum: source.checksum,
			sourceSequence: 9,
			counts: { railEdgeCount: 49_999 },
		});
		expect(overview.railSilhouette.sourceCellCount).toBe(50_000);
		expect(overview.railSilhouette.sampleCount).toBeLessThanOrEqual(8_192);
		expect(overview.readRailEdge(0)).toMatchObject({ fromX: 0, fromZ: 0, toX: 1, toZ: 0 });
		expect(worker.requestTransferCount).toBeGreaterThan(10);
		expect(worker.responseTransferCount).toBeGreaterThan(20);
		expect(capture.snapshot.xs.byteLength).toBe(0);
		expect(worker.terminated).toBe(true);
	}, 30_000);

	it("rejects mismatched input identity before creating or detaching a Worker snapshot", async () => {
		const map = straightDocument().map;
		const capture = captureRailMirrorSnapshot(map, 1);
		let workerCreations = 0;
		const bridge = new StaticFabOrganizationOverviewBridge(() => {
			workerCreations++;
			return new RuntimeOverviewWorker();
		});

		await expect(
			bridge.prepare({
				snapshot: capture.snapshot,
				source: { ...sourceOf(capture.snapshot), sequence: 2 },
				expectedRailReadinessFingerprint: readinessFingerprintFor(map, capture.snapshot.checksum),
			}),
		).rejects.toThrow(/sequence does not match snapshot/i);
		expect(workerCreations).toBe(0);
		expect(capture.snapshot.xs.byteLength).toBeGreaterThan(0);
	});

	it("rejects stale request and stale source identities instead of waiting for timeout", async () => {
		const staleRequestWorker = new MutatingOverviewWorker((request, prepared) => ({
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
			requestId: request.requestId + 1,
			prepared,
		}));
		await expect(prepareWith(staleRequestWorker)).rejects.toThrow(/stale request/i);
		expect(staleRequestWorker.terminated).toBe(true);

		const staleSourceWorker = new MutatingOverviewWorker((request, prepared) => ({
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
			requestId: request.requestId,
			prepared: { ...prepared, sourceSequence: prepared.sourceSequence + 1 },
		}));
		await expect(prepareWith(staleSourceWorker)).rejects.toThrow(/stale source sequence/i);
		expect(staleSourceWorker.terminated).toBe(true);
	});

	it("rejects a malformed typed-array response before exposing an artifact", async () => {
		const worker = new MutatingOverviewWorker((request, prepared) => ({
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
			requestId: request.requestId,
			prepared: {
				...prepared,
				overviewSnapshot: {
					...prepared.overviewSnapshot,
					counts: new Uint32Array(4),
				},
			},
		}));
		await expect(prepareWith(worker)).rejects.toThrow(/overview counts.*malformed/i);
		expect(worker.terminated).toBe(true);

		const malformedChecks = new MutatingOverviewWorker((request, prepared) => ({
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
			requestId: request.requestId,
			prepared: {
				...prepared,
				checksSnapshot: {
					...prepared.checksSnapshot,
					summary: new Uint32Array(4),
				},
			},
		}));
		await expect(prepareWith(malformedChecks)).rejects.toThrow(/checks summary is malformed/i);
		expect(malformedChecks.terminated).toBe(true);

		const contradictoryOverview = new MutatingOverviewWorker((request, prepared) => ({
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
			requestId: request.requestId,
			prepared: {
				...prepared,
				overviewError: "forged simultaneous failure",
			},
		}));
		await expect(prepareWith(contradictoryOverview)).rejects.toThrow(/malformed prepared data/i);
		expect(contradictoryOverview.terminated).toBe(true);
	});

	it("exposes one atomic overview and project-check generation", async () => {
		const map = straightDocument().map;
		const capture = captureRailMirrorSnapshot(map, 5);
		const source = sourceOf(capture.snapshot);
		const expectedRailReadinessFingerprint = readinessFingerprintFor(map, source.checksum);
		const worker = new RuntimeOverviewWorker();
		const inspection = await new StaticFabOrganizationOverviewBridge(
			() => worker,
		).prepareInspection({
			snapshot: capture.snapshot,
			source,
			expectedRailReadinessFingerprint,
		});

		expect(inspection.overview).toMatchObject({
			sourceRevision: source.revision,
			sourceChecksum: source.checksum,
			sourceSequence: source.sequence,
		});
		expect(inspection.overviewError).toBeNull();
		expect(inspection.checks).toMatchObject({
			sourceRevision: source.revision,
			sourceChecksum: source.checksum,
			sourceSequence: source.sequence,
			railReadinessFingerprint: expectedRailReadinessFingerprint,
		});
		expect(worker.terminated).toBe(true);
	});

	it("honors both pre-aborted and in-flight AbortSignal cancellation", async () => {
		const beforeMap = straightDocument().map;
		const before = captureRailMirrorSnapshot(beforeMap, 1);
		const preAborted = new AbortController();
		preAborted.abort();
		let creations = 0;
		const bridge = new StaticFabOrganizationOverviewBridge(() => {
			creations++;
			return new SilentOverviewWorker();
		});
		await expect(
			bridge.prepare({
				snapshot: before.snapshot,
				source: sourceOf(before.snapshot),
				expectedRailReadinessFingerprint: readinessFingerprintFor(
					beforeMap,
					before.snapshot.checksum,
				),
				signal: preAborted.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(creations).toBe(0);
		expect(before.snapshot.xs.byteLength).toBeGreaterThan(0);

		const duringMap = straightDocument().map;
		const during = captureRailMirrorSnapshot(duringMap, 2);
		const worker = new SilentOverviewWorker();
		const controller = new AbortController();
		const pending = new StaticFabOrganizationOverviewBridge(() => worker).prepare({
			snapshot: during.snapshot,
			source: sourceOf(during.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprintFor(
				duringMap,
				during.snapshot.checksum,
			),
			signal: controller.signal,
		});
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
	});

	it("cancels a superseded request and resolves only the newest source generation", async () => {
		const firstWorker = new SilentOverviewWorker();
		const secondWorker = new RuntimeOverviewWorker();
		let index = 0;
		const bridge = new StaticFabOrganizationOverviewBridge(
			() => [firstWorker, secondWorker][index++] as StaticFabOrganizationOverviewWorkerPort,
		);
		const firstMap = straightDocument().map;
		const secondMap = straightDocument().map;
		const first = captureRailMirrorSnapshot(firstMap, 1);
		const second = captureRailMirrorSnapshot(secondMap, 2);
		const firstPending = bridge.prepare({
			snapshot: first.snapshot,
			source: sourceOf(first.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprintFor(firstMap, first.snapshot.checksum),
		});
		const secondPending = bridge.prepare({
			snapshot: second.snapshot,
			source: sourceOf(second.snapshot),
			expectedRailReadinessFingerprint: readinessFingerprintFor(
				secondMap,
				second.snapshot.checksum,
			),
		});

		await expect(firstPending).rejects.toMatchObject({ name: "AbortError" });
		await expect(secondPending).resolves.toMatchObject({ sourceSequence: 2 });
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});
});

async function prepareWith(worker: StaticFabOrganizationOverviewWorkerPort) {
	const map = straightDocument().map;
	const capture = captureRailMirrorSnapshot(map, 4);
	return new StaticFabOrganizationOverviewBridge(() => worker, 1_000).prepare({
		snapshot: capture.snapshot,
		source: sourceOf(capture.snapshot),
		expectedRailReadinessFingerprint: readinessFingerprintFor(map, capture.snapshot.checksum),
	});
}

function readinessFingerprintFor(map: TileMap, checksum: string): string {
	return createRailProjectReadiness(
		analyzeRailNetwork(map),
		compilePhysicalRail(map, map.getRevision()),
		checksum,
	).fingerprint;
}

function sourceOf(snapshot: { revision: number; checksum: string; sequence: number }) {
	return {
		revision: snapshot.revision,
		checksum: snapshot.checksum,
		sequence: snapshot.sequence,
	};
}

function straightDocument(): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 });
	if (!plan.valid || !document.commit(plan))
		throw new Error(`Straight fixture failed: ${plan.reason}`);
	return document;
}

function snakeMap(width: number, height: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let rowMajor = 0; rowMajor < width * height; rowMajor++) {
		const x = rowMajor % width;
		const z = Math.floor(rowMajor / width);
		hydrator.addEncodedCell(
			x,
			z,
			encodeRailCell({
				incoming: snakeIncoming(x, z, width),
				outgoing: snakeOutgoing(x, z, width, height),
			}),
		);
	}
	return hydrator.finish(41);
}

function snakeIncoming(x: number, z: number, width: number): 0 | Direction {
	if ((z & 1) === 0) {
		if (x > 0) return DIR_W;
		return z === 0 ? 0 : DIR_N;
	}
	if (x < width - 1) return DIR_E;
	return DIR_N;
}

function snakeOutgoing(x: number, z: number, width: number, height: number): 0 | Direction {
	if ((z & 1) === 0) {
		if (x < width - 1) return DIR_E;
		return z < height - 1 ? DIR_S : 0;
	}
	if (x > 0) return DIR_W;
	return z < height - 1 ? DIR_S : 0;
}
