import { describe, expect, it } from "vitest";
import {
	defaultSyntheticFabStarterRequest,
	SYNTHETIC_FAB_STARTER_CATALOG,
} from "../compile/SyntheticFabStarter";
import { prepareSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import type {
	SyntheticFabStarterWorkerRequest,
	SyntheticFabStarterWorkerResponse,
} from "../worker/SyntheticFabStarterProtocol";
import {
	independentlyVerifyPreparedSyntheticFabStarter,
	preparedSyntheticFabStarterMatchesIndependentPreparation,
	preparedSyntheticFabStarterMatchesRequest,
	SyntheticFabStarterBridge,
	type SyntheticFabStarterIndependentPreparationBridge,
	type SyntheticFabStarterWorkerPort,
} from "./SyntheticFabStarterBridge";

class FakeStarterWorker implements SyntheticFabStarterWorkerPort {
	onmessage: ((event: MessageEvent<SyntheticFabStarterWorkerResponse>) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;

	postMessage(message: SyntheticFabStarterWorkerRequest): void {
		const prepared = structuredClone(prepareSyntheticFabStarter(message.starter));
		queueMicrotask(() => {
			this.onmessage?.({
				data: {
					type: "SYNTHETIC_FAB_STARTER_PREPARED",
					requestId: message.requestId,
					prepared,
				},
			} as MessageEvent<SyntheticFabStarterWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class ManualStarterWorker implements SyntheticFabStarterWorkerPort {
	onmessage: ((event: MessageEvent<SyntheticFabStarterWorkerResponse>) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;
	terminationCount = 0;
	request: SyntheticFabStarterWorkerRequest | null = null;
	postError: Error | null = null;

	postMessage(message: SyntheticFabStarterWorkerRequest): void {
		if (this.postError) throw this.postError;
		this.request = message;
	}

	respond(response: unknown): void {
		this.onmessage?.({
			data: response,
		} as MessageEvent<SyntheticFabStarterWorkerResponse>);
	}

	terminate(): void {
		this.terminated = true;
		this.terminationCount++;
	}
}

function pausedAdmission(advanceTime = true) {
	let resume!: () => void;
	let notifyEntered!: () => void;
	const blocked = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const entered = new Promise<void>((resolve) => {
		notifyEntered = resolve;
	});
	let first = true;
	let time = 0;
	return {
		entered,
		resume: () => resume(),
		scheduler: {
			now: () => {
				if (advanceTime) time += 5;
				return time;
			},
			yield: async () => {
				if (!first) return;
				first = false;
				notifyEntered();
				await blocked;
			},
		},
	};
}

function respondWithClonedStarter(
	worker: ManualStarterWorker,
	starter: Parameters<SyntheticFabStarterBridge["prepare"]>[0],
) {
	if (!worker.request) throw new Error("Expected a posted starter request.");
	const prepared = structuredClone(prepareSyntheticFabStarter(starter));
	worker.respond({
		type: "SYNTHETIC_FAB_STARTER_PREPARED",
		requestId: worker.request.requestId,
		prepared,
	});
	return prepared;
}

describe("SyntheticFabStarterBridge", () => {
	it("cancels a response while cooperative admission is suspended", async () => {
		const worker = new ManualStarterWorker();
		const pause = pausedAdmission();
		const bridge = new SyntheticFabStarterBridge(() => worker, 30_000, pause.scheduler);
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const result = bridge.prepare(starter).catch((error: unknown) => error);
		respondWithClonedStarter(worker, starter);
		await pause.entered;
		bridge.cancel();
		expect(await result).toMatchObject({ name: "AbortError" });
		pause.resume();
		await Promise.resolve();
		await Promise.resolve();
		expect(worker.terminationCount).toBe(1);
	});

	it("cannot release a superseding request even when the factory reuses the same Worker", async () => {
		const worker = new ManualStarterWorker();
		const pause = pausedAdmission();
		const bridge = new SyntheticFabStarterBridge(() => worker, 30_000, pause.scheduler);
		const firstStarter = defaultSyntheticFabStarterRequest("single-loop");
		const first = bridge.prepare(firstStarter).catch((error: unknown) => error);
		const oldCallback = worker.onmessage;
		respondWithClonedStarter(worker, firstStarter);
		await pause.entered;
		const secondStarter = defaultSyntheticFabStarterRequest("dual-loop");
		const second = bridge.prepare(secondStarter);
		expect(await first).toMatchObject({ name: "AbortError" });
		oldCallback?.({
			data: { type: "UNKNOWN" },
		} as unknown as MessageEvent<SyntheticFabStarterWorkerResponse>);
		pause.resume();
		await Promise.resolve();
		await Promise.resolve();
		expect(worker.terminationCount).toBe(1);
		expect(worker.onmessage).not.toBeNull();
		respondWithClonedStarter(worker, secondStarter);
		await expect(second).resolves.toMatchObject({ request: { id: "dual-loop" } });
		expect(worker.terminationCount).toBe(2);
	});

	it("keeps the watchdog active through response admission", async () => {
		const worker = new ManualStarterWorker();
		const pause = pausedAdmission();
		const bridge = new SyntheticFabStarterBridge(() => worker, 20, pause.scheduler);
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const result = bridge.prepare(starter).catch((error: unknown) => error);
		respondWithClonedStarter(worker, starter);
		await pause.entered;
		expect(await result).toMatchObject({ message: "FAB starter Worker timed out." });
		pause.resume();
		expect(worker.terminationCount).toBe(1);
	});

	it("handles Worker errors while admission is suspended", async () => {
		const worker = new ManualStarterWorker();
		const pause = pausedAdmission();
		const bridge = new SyntheticFabStarterBridge(() => worker, 30_000, pause.scheduler);
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const result = bridge.prepare(starter).catch((error: unknown) => error);
		respondWithClonedStarter(worker, starter);
		await pause.entered;
		worker.onerror?.({ message: "admission worker error" } as ErrorEvent);
		expect(await result).toMatchObject({ message: "admission worker error" });
		pause.resume();
		expect(worker.terminationCount).toBe(1);
	});

	it("admits only the first matching response and ignores later duplicates", async () => {
		const worker = new ManualStarterWorker();
		const pause = pausedAdmission();
		const bridge = new SyntheticFabStarterBridge(() => worker, 30_000, pause.scheduler);
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const result = bridge.prepare(starter);
		const prepared = respondWithClonedStarter(worker, starter);
		await pause.entered;
		worker.respond({ type: "UNKNOWN" });
		pause.resume();
		expect(await result).toBe(prepared);
		expect(worker.terminationCount).toBe(1);
	});

	it("rechecks mutable snapshot bytes after the final suspension", async () => {
		const worker = new ManualStarterWorker();
		const pause = pausedAdmission(false);
		const bridge = new SyntheticFabStarterBridge(() => worker, 30_000, pause.scheduler);
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const result = bridge.prepare(starter).catch((error: unknown) => error);
		const prepared = respondWithClonedStarter(worker, starter);
		await pause.entered;
		prepared.snapshot.xs[0] = (prepared.snapshot.xs[0] as number) + 1;
		pause.resume();
		expect(await result).toMatchObject({
			message: "FAB starter Worker returned a mismatched prepared project.",
		});
		expect(worker.terminationCount).toBe(1);
	});

	it("rejects independent verification that resolves after its signal was aborted", async () => {
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const source = prepareSyntheticFabStarter(starter);
		const independent = prepareSyntheticFabStarter(starter);
		const controller = new AbortController();
		let disposed = false;
		await expect(
			independentlyVerifyPreparedSyntheticFabStarter(source, starter, controller.signal, () => ({
				prepare: async () => {
					controller.abort();
					return independent;
				},
				cancel: () => {},
				dispose: () => {
					disposed = true;
				},
			})),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(disposed).toBe(true);
	});
	it("does not accept one prepared object as its own independent verification", () => {
		const request = defaultSyntheticFabStarterRequest("single-loop");
		const prepared = prepareSyntheticFabStarter(request);

		expect(
			preparedSyntheticFabStarterMatchesIndependentPreparation(prepared, prepared, request),
		).toBe(false);
	});

	it("accepts a prepared snapshot for every starter catalog entry", () => {
		for (const item of SYNTHETIC_FAB_STARTER_CATALOG) {
			const request = defaultSyntheticFabStarterRequest(item.id);
			const prepared = prepareSyntheticFabStarter(request);
			expect(preparedSyntheticFabStarterMatchesRequest(prepared, request), item.id).toBe(true);
		}
	}, 180_000);

	it("binds the Full FAB gateways and Process Loops to its independent assembly plan", () => {
		const request = defaultSyntheticFabStarterRequest("full-fab-52");
		const prepared = prepareSyntheticFabStarter(request);

		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(true);
		expect(prepared.steps).toHaveLength(171);
		expect(prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			strongComponents: 1,
			openTerminals: 0,
		});
		const gatewayIndex = prepared.steps.findIndex(
			(step) => step.connectionId === "PROCESS-HALL-1-WEST-OUTER-GATEWAY",
		);
		expect(gatewayIndex).toBeGreaterThan(0);
		const wrongGateway = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === gatewayIndex
					? Object.freeze({ ...step, connectionRole: "spine-wall" as const })
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(wrongGateway, request)).toBe(false);

		const loopIndex = prepared.steps.findIndex((step) => step.hierarchyRole === "process-loop");
		const displacedLoop = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === loopIndex
					? Object.freeze({
							...step,
							anchor: Object.freeze({ x: step.anchor.x, y: step.anchor.y + 1 }),
						})
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(displacedLoop, request)).toBe(false);
	}, 30_000);

	it("binds paired outer lanes, gateways, and variable Bay loops to the production plan", () => {
		const request = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
		const prepared = prepareSyntheticFabStarter(request);

		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(true);
		expect(prepared.steps).toHaveLength(201);
		const outerLaneIndex = prepared.steps.findIndex((step) => step.entityId === "FAB-OUTER-LANE-B");
		const pairedCorridorIndex = prepared.steps.findIndex(
			(step) => step.templateId === "paired-corridor",
		);
		const gatewayIndex = prepared.steps.findIndex(
			(step) => step.kind === "paired-turnback" && step.connectionId === "origin-end",
		);
		const bayGatewayIndex = prepared.steps.findIndex(
			(step) => step.connectionId === "PAIRED-BAY-001-INTERBAY-GATEWAY",
		);
		const firstBayLoopIndex = prepared.steps.findIndex(
			(step) => step.entityId === "PAIRED-BAY-001-PROCESS-LOOP-01",
		);
		expect(outerLaneIndex).toBeGreaterThan(0);
		expect(pairedCorridorIndex).toBeGreaterThan(outerLaneIndex);
		expect(gatewayIndex).toBeGreaterThan(outerLaneIndex);
		expect(firstBayLoopIndex).toBeGreaterThan(gatewayIndex);
		expect(bayGatewayIndex).toBeGreaterThan(firstBayLoopIndex);

		for (const targetIndex of [
			outerLaneIndex,
			pairedCorridorIndex,
			gatewayIndex,
			firstBayLoopIndex,
			bayGatewayIndex,
		]) {
			const displaced = {
				...prepared,
				steps: prepared.steps.map((step, index) =>
					index === targetIndex
						? Object.freeze({
								...step,
								anchor: Object.freeze({
									x: step.anchor.x + 1,
									y: step.anchor.y,
								}),
							})
						: step,
				),
			};
			expect(preparedSyntheticFabStarterMatchesRequest(displaced, request)).toBe(false);
		}
	}, 30_000);

	it("returns one serializable preview and project snapshot from the worker", async () => {
		const worker = new FakeStarterWorker();
		const bridge = new SyntheticFabStarterBridge(() => worker);

		const prepared = await bridge.prepare(defaultSyntheticFabStarterRequest("single-loop"));

		expect(prepared?.summary.strongComponents).toBe(1);
		expect(prepared?.summary.openTerminals).toBe(0);
		expect(prepared?.geometry?.pathData.startsWith("M")).toBe(true);
		expect(prepared?.snapshot.checksum).toBe(prepared?.authoredChecksum);
		expect(prepared?.snapshot.revision).toBe(prepared?.authoredRevision);
		expect(prepared?.snapshot.sequence).toBe(prepared?.steps.length);
		expect(prepared?.snapshot.xs.length).toBe(prepared?.summary.railCells);
		expect(worker.terminated).toBe(true);
	});

	it("restores cloned bundle immutability without trusting changed snapshot bytes", async () => {
		const request = defaultSyntheticFabStarterRequest("production-fab-60");
		const worker = new FakeStarterWorker();
		const bridge = new SyntheticFabStarterBridge(() => worker);
		const prepared = await bridge.prepare(request);
		const bundle = prepared.placementBundle;
		if (!bundle) throw new Error("Expected a portable production FAB bundle.");

		expect(Object.isFrozen(prepared)).toBe(true);
		expect(Object.isFrozen(bundle)).toBe(true);
		expect(Object.isFrozen(bundle.railEdges)).toBe(true);
		expect(Object.isFrozen(bundle.railEdges[0]?.from)).toBe(true);
		expect(Object.isFrozen(bundle.organizations[0]?.membership.railEdgeIndices)).toBe(true);
		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(true);
		expect(worker.terminated).toBe(true);

		prepared.snapshot.encoded[0] = (prepared.snapshot.encoded[0] as number) ^ 1;
		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(false);
	}, 30_000);

	it("rejects cloned source-invalid bundles even after restoring frozen containers", async () => {
		const request = defaultSyntheticFabStarterRequest("production-fab-60");
		const prepared = structuredClone(prepareSyntheticFabStarter(request));
		const bundle = prepared.placementBundle;
		if (!bundle) throw new Error("Expected a portable production FAB bundle.");
		const invalid = {
			...prepared,
			placementBundle: { ...bundle, sourceModuleCount: bundle.sourceModuleCount + 1 },
		};
		const worker = new ManualStarterWorker();
		const bridge = new SyntheticFabStarterBridge(() => worker);
		const preparation = bridge.prepare(request);
		worker.respond({
			type: "SYNTHETIC_FAB_STARTER_PREPARED",
			requestId: worker.request?.requestId,
			prepared: invalid,
		});

		await expect(preparation).rejects.toThrow(/mismatched prepared project/);
		expect(Object.isFrozen(invalid.placementBundle)).toBe(true);
		expect(worker.terminated).toBe(true);
	}, 30_000);

	it("accepts the production FAB plan without transferring oversized route geometry", async () => {
		const request = defaultSyntheticFabStarterRequest("production-fab-60");
		const prepared = prepareSyntheticFabStarter(request);

		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(true);
		expect(prepared.planFingerprint).not.toBeNull();
		expect(prepared.geometry).toBeNull();
		expect(prepared.exactGeometry).toBeNull();
		expect(prepared.steps).toHaveLength(185);
		expect(prepared.summary).toMatchObject({
			zoneCount: 3,
			bayCount: 60,
			strongComponents: 1,
			openTerminals: 0,
		});
		const processLoopIndex = prepared.steps.findIndex(
			(step) => step.hierarchyRole === "process-loop",
		);
		expect(processLoopIndex).toBeGreaterThan(0);
		const processLoopStep = prepared.steps[processLoopIndex];
		if (!processLoopStep?.pose) throw new Error("Expected a planned Process Loop step.");
		const processLoopForward = processLoopStep.pose.forward;
		const processLoopSide = processLoopStep.pose.side;
		if (processLoopForward === undefined || processLoopSide === undefined) {
			throw new Error("Expected a complete planned Process Loop pose.");
		}
		const displaced = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === processLoopIndex
					? Object.freeze({
							...step,
							anchor: Object.freeze({ x: step.anchor.x + 1, y: step.anchor.y }),
						})
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(displaced, request)).toBe(false);
		const reversed = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === processLoopIndex
					? Object.freeze({
							...step,
							pose: Object.freeze({
								forward: processLoopForward,
								side: processLoopSide,
								flow: "reverse" as const,
							}),
						})
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(reversed, request)).toBe(false);
	}, 30_000);

	it("binds Parallel Hall steps to the independent assembly plan", () => {
		const request = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");
		const prepared = prepareSyntheticFabStarter(request);

		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(true);
		expect(prepared.steps).toHaveLength(44);
		const processLoopIndex = prepared.steps.findIndex(
			(step) => step.hierarchyRole === "process-loop",
		);
		expect(processLoopIndex).toBeGreaterThan(0);
		const displaced = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === processLoopIndex
					? Object.freeze({
							...step,
							anchor: Object.freeze({ x: step.anchor.x + 1, y: step.anchor.y }),
						})
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(displaced, request)).toBe(false);

		const gatewayIndex = prepared.steps.findIndex(
			(step) => step.connectionId === "WEST-OUTER-GATEWAY",
		);
		expect(gatewayIndex).toBeGreaterThan(0);
		const wrongGateway = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === gatewayIndex
					? Object.freeze({ ...step, connectionRole: "spine-wall" as const })
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(wrongGateway, request)).toBe(false);
	});

	it("binds Dense Central-Spine steps to its independent assembly plan", () => {
		const request = defaultSyntheticFabStarterRequest("central-spine-fab-24");
		const prepared = prepareSyntheticFabStarter(request);

		expect(preparedSyntheticFabStarterMatchesRequest(prepared, request)).toBe(true);
		expect(prepared.steps).toHaveLength(74);
		const bayIndex = prepared.steps.findIndex((step) => step.hierarchyRole === "process-bay");
		expect(bayIndex).toBeGreaterThan(0);
		const displaced = {
			...prepared,
			steps: prepared.steps.map((step, index) =>
				index === bayIndex
					? Object.freeze({
							...step,
							anchor: Object.freeze({ x: step.anchor.x, y: step.anchor.y + 1 }),
						})
					: step,
			),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(displaced, request)).toBe(false);
	});

	it("terminates and rejects an in-flight preparation when cancelled", async () => {
		const worker = new FakeStarterWorker();
		const bridge = new SyntheticFabStarterBridge(() => worker);
		const preparation = bridge.prepare(defaultSyntheticFabStarterRequest("single-loop"));

		bridge.cancel();

		await expect(preparation).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
	});

	it("rejects stale, malformed, and mismatched prepared responses without leaving a worker", async () => {
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const prepared = prepareSyntheticFabStarter(starter);
		if (!prepared) throw new Error("Expected a prepared starter.");
		const corruptedSnapshot = structuredClone(prepared.snapshot);
		corruptedSnapshot.encoded[0] = (corruptedSnapshot.encoded[0] as number) ^ 1;

		for (const response of [
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId + 1,
				prepared,
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					requestFingerprint: "wrong-request",
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					planFingerprint: "wrong-plan",
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					summary: undefined,
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					geometry: {
						...prepared.geometry,
						markers: [{ x: Number.NaN, y: 0, angleDegrees: 0 }],
					},
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					snapshot: corruptedSnapshot,
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					snapshot: {
						...prepared.snapshot,
						sequence: 0,
					},
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					authoredRevision: prepared.authoredRevision + 1,
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					steps: prepared.steps.map((step, index) =>
						index === 0 ? { ...step, ordinal: 2 } : step,
					),
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: {
					...prepared,
					summary: {
						...prepared.summary,
						railCells: prepared.summary.railCells + 1,
					},
				},
			}),
			(request: SyntheticFabStarterWorkerRequest) => ({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: null,
			}),
			() => ({ type: "UNKNOWN", requestId: 1 }),
		]) {
			const worker = new ManualStarterWorker();
			const bridge = new SyntheticFabStarterBridge(() => worker);
			const preparation = bridge.prepare(starter);
			const request = worker.request;
			if (!request) throw new Error("Expected a posted starter request.");

			worker.respond(response(request));

			await expect(preparation).rejects.toThrow();
			expect(worker.terminated).toBe(true);
		}
	});

	it("rejects forged large-FAB assembly step identities at receipt and activation", async () => {
		const starter = defaultSyntheticFabStarterRequest("large-fab-60");
		const prepared = prepareSyntheticFabStarter(starter);
		const exactGeometry = prepared.exactGeometry;
		if (!exactGeometry) throw new Error("Expected exact large-FAB geometry.");
		const corruptedPositions = new Float32Array(exactGeometry.positions);
		corruptedPositions[0] = (corruptedPositions[0] as number) + 1;
		const linkIndex = prepared.steps.findIndex(
			(step) => step.kind === "network-link" && step.hierarchyRole === "process-wing",
		);
		if (linkIndex < 0) throw new Error("Expected a large-FAB network-link step.");
		const corruptions = [
			{
				...prepared,
				steps: prepared.steps.map((step, index) =>
					index === 0 ? { ...step, entityId: "forged-outer" } : step,
				),
			},
			{
				...prepared,
				steps: prepared.steps.map((step, index) =>
					index === linkIndex ? { ...step, connectionRole: "wall-outer" as const } : step,
				),
			},
			{
				...prepared,
				steps: prepared.steps.map((step, index) =>
					index === 0 ? { ...step, anchor: { x: 999_999, y: -999_999 } } : step,
				),
			},
			{
				...prepared,
				steps: prepared.steps.map((step, index) =>
					index === linkIndex ? { ...step, outboundTurns: 1 } : step,
				),
			},
			{
				...prepared,
				steps: prepared.steps.map((step, index) =>
					index === linkIndex && step.junctions
						? {
								...step,
								junctions: {
									...step.junctions,
									sourceDeparture: {
										...step.junctions.sourceDeparture,
										y: step.junctions.sourceDeparture.y + 1,
									},
								},
							}
						: step,
				),
			},
			{
				...prepared,
				exactGeometry: { ...exactGeometry, positions: corruptedPositions },
			},
			{
				...prepared,
				exactGeometry: {
					...exactGeometry,
					sourcePhysicalFingerprint: "forged-physical-layout",
				},
			},
		];

		for (const corrupted of corruptions) {
			expect(preparedSyntheticFabStarterMatchesRequest(corrupted, starter)).toBe(false);
			const worker = new ManualStarterWorker();
			const bridge = new SyntheticFabStarterBridge(() => worker);
			const preparation = bridge.prepare(starter);
			const request = worker.request;
			if (!request) throw new Error("Expected a posted starter request.");

			worker.respond({
				type: "SYNTHETIC_FAB_STARTER_PREPARED",
				requestId: request.requestId,
				prepared: corrupted,
			});

			await expect(preparation).rejects.toThrow(/mismatched prepared project/);
			expect(worker.terminated).toBe(true);
		}
	}, 15_000);

	it("rejects a snapshot that no longer matches exact physical preview geometry", () => {
		const starter = defaultSyntheticFabStarterRequest("large-fab-60");
		const prepared = prepareSyntheticFabStarter(starter);
		const unrelated = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const forgedSnapshot = {
			...structuredClone(unrelated.snapshot),
			sequence: prepared.steps.length,
		};
		const forged = {
			...prepared,
			authoredChecksum: unrelated.authoredChecksum,
			authoredRevision: forgedSnapshot.revision,
			physicalFingerprint: unrelated.physicalFingerprint,
			snapshot: forgedSnapshot,
			summary: {
				...prepared.summary,
				railCells: unrelated.summary.railCells,
				directedEdges: unrelated.summary.directedEdges,
				physicalPaths: unrelated.summary.physicalPaths,
				totalLengthMeters: unrelated.summary.totalLengthMeters,
				junctions: unrelated.summary.junctions,
				openTerminals: unrelated.summary.openTerminals,
				strongComponents: unrelated.summary.strongComponents,
				bounds: unrelated.summary.bounds,
			},
		};

		expect(preparedSyntheticFabStarterMatchesRequest(forged, starter)).toBe(false);
		expect(
			preparedSyntheticFabStarterMatchesIndependentPreparation(forged, prepared, starter),
		).toBe(false);
	}, 15_000);

	it("binds independent materialization to authoring readiness identity", () => {
		const starter = defaultSyntheticFabStarterRequest("large-fab-60");
		const prepared = prepareSyntheticFabStarter(starter);
		const forged = {
			...prepared,
			readinessFingerprint: "forged-readiness",
			authoringReady: false,
		};

		expect(prepared.authoringReady).toBe(true);
		expect(preparedSyntheticFabStarterMatchesRequest(forged, starter)).toBe(true);
		expect(
			preparedSyntheticFabStarterMatchesIndependentPreparation(forged, prepared, starter),
		).toBe(false);
	}, 15_000);

	it("cancels the independent materialization when project creation is aborted", async () => {
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const prepared = prepareSyntheticFabStarter(starter);
		let rejectPreparation: ((error: unknown) => void) | null = null;
		let cancelled = false;
		let disposed = false;
		const verificationBridge: SyntheticFabStarterIndependentPreparationBridge = {
			prepare: () =>
				new Promise((_, reject) => {
					rejectPreparation = reject;
				}),
			cancel: () => {
				cancelled = true;
				rejectPreparation?.(new DOMException("cancelled", "AbortError"));
			},
			dispose: () => {
				disposed = true;
			},
		};
		const controller = new AbortController();
		const verification = independentlyVerifyPreparedSyntheticFabStarter(
			prepared,
			starter,
			controller.signal,
			() => verificationBridge,
		);

		controller.abort();

		await expect(verification).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelled).toBe(true);
		expect(disposed).toBe(true);
	});

	it("rejects an invalid request before constructing a worker", async () => {
		let workerCreations = 0;
		const bridge = new SyntheticFabStarterBridge(() => {
			workerCreations++;
			return new ManualStarterWorker();
		});
		const invalid = {
			...defaultSyntheticFabStarterRequest("single-loop"),
			version: 999,
		} as unknown as Parameters<SyntheticFabStarterBridge["prepare"]>[0];

		await expect(bridge.prepare(invalid)).rejects.toThrow(/Unsupported/);
		expect(workerCreations).toBe(0);
	});

	it("cancels an older request before accepting the latest worker response", async () => {
		const workers = [new ManualStarterWorker(), new ManualStarterWorker()];
		const bridge = new SyntheticFabStarterBridge(() => {
			const worker = workers.shift();
			if (!worker) throw new Error("Unexpected Worker request.");
			return worker;
		});
		const firstWorker = workers[0] as ManualStarterWorker;
		const first = bridge.prepare(defaultSyntheticFabStarterRequest("single-loop"));
		const secondWorker = workers[0] as ManualStarterWorker;
		const secondStarter = defaultSyntheticFabStarterRequest("dual-loop");
		const second = bridge.prepare(secondStarter);
		const secondRequest = secondWorker.request;
		if (!secondRequest) throw new Error("Expected the latest posted request.");

		firstWorker.respond({
			type: "SYNTHETIC_FAB_STARTER_PREPARED",
			requestId: firstWorker.request?.requestId ?? 0,
			prepared: prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop")),
		});
		secondWorker.respond({
			type: "SYNTHETIC_FAB_STARTER_PREPARED",
			requestId: secondRequest.requestId,
			prepared: prepareSyntheticFabStarter(secondStarter),
		});

		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		await expect(second).resolves.toMatchObject({
			request: { id: "dual-loop" },
		});
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it("rejects timeout, message decoding, creation, and postMessage failures", async () => {
		const starter = defaultSyntheticFabStarterRequest("single-loop");
		const timeoutWorker = new ManualStarterWorker();
		const timeoutBridge = new SyntheticFabStarterBridge(() => timeoutWorker, 5);
		await expect(timeoutBridge.prepare(starter)).rejects.toThrow(/timed out/);
		expect(timeoutWorker.terminated).toBe(true);

		const messageWorker = new ManualStarterWorker();
		const messageBridge = new SyntheticFabStarterBridge(() => messageWorker);
		const messagePreparation = messageBridge.prepare(starter);
		messageWorker.onmessageerror?.({ data: null } as MessageEvent<unknown>);
		await expect(messagePreparation).rejects.toThrow(/decoded/);
		expect(messageWorker.terminated).toBe(true);

		const postWorker = new ManualStarterWorker();
		postWorker.postError = new Error("post failed");
		const postBridge = new SyntheticFabStarterBridge(() => postWorker);
		await expect(postBridge.prepare(starter)).rejects.toThrow(/post failed/);
		expect(postWorker.terminated).toBe(true);

		const createBridge = new SyntheticFabStarterBridge(() => {
			throw new Error("create failed");
		});
		await expect(createBridge.prepare(starter)).rejects.toThrow(/create failed/);
	});
});
