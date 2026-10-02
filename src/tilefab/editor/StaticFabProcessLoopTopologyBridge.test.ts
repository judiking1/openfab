import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import { createStaticFabProcessLoopRailCandidatePreparation } from "../core/StaticFabProcessLoopRailCandidate";
import { prepareStaticFabProcessLoopRegistrationCooperatively } from "../core/StaticFabProcessLoopRegistration";
import {
	checksumRailMap,
	checksumRailPatchResultCooperatively,
} from "../worker/RailMirrorChecksum";
import { INITIAL_RAIL_WORKER_STATE, type RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import type {
	StaticFabProcessLoopTopologyWorkerRequest,
	StaticFabProcessLoopTopologyWorkerResponse,
} from "../worker/StaticFabProcessLoopTopologyProtocol";
import { checkStaticFabProcessLoopTopologyInWorker } from "../worker/StaticFabProcessLoopTopologyRuntime";
import {
	StaticFabProcessLoopTopologyBridge,
	type StaticFabProcessLoopTopologyInput,
	type StaticFabProcessLoopTopologyWorkerPort,
} from "./StaticFabProcessLoopTopologyBridge";

class InlineCandidateWorker implements StaticFabProcessLoopTopologyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabProcessLoopTopologyWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	request: StaticFabProcessLoopTopologyWorkerRequest | null = null;
	terminationCount = 0;
	transferCount = 0;
	readonly posted = deferred();
	postMessage(request: StaticFabProcessLoopTopologyWorkerRequest, transfer: Transferable[]): void {
		this.transferCount = transfer.length;
		this.request = structuredClone(request, { transfer });
		this.posted.resolve();
	}
	terminate(): void {
		this.terminationCount++;
	}
	respond(
		transform: (response: StaticFabProcessLoopTopologyWorkerResponse) => unknown = (response) =>
			response,
	): void {
		if (!this.request) throw new Error("missing posted candidate request");
		this.onmessage?.({
			data: structuredClone(transform(checkStaticFabProcessLoopTopologyInWorker(this.request))),
		} as MessageEvent<StaticFabProcessLoopTopologyWorkerResponse>);
	}
}

afterEach(() => vi.useRealTimers());

describe("StaticFabProcessLoopTopologyBridge", () => {
	it("answers the exact pending core registration request after owned candidate transfer validation", async () => {
		const f = fixture(),
			worker = new InlineCandidateWorker(),
			bridge = new StaticFabProcessLoopTopologyBridge(() => worker);
		const request = {
			document: f.document,
			source: f.input.source,
			candidate: f.input.candidate,
			name: "Manual Loop",
			sourceChecksum: f.mirror.checksum,
			mirrorEpoch: f.mirror.epoch,
		};
		const preparation = prepareStaticFabProcessLoopRegistrationCooperatively(request, {
			checkpoint: f.input.checkpoint,
			isCurrent: f.input.isCurrent,
			cancelTopology: (pending) => bridge.cancelRegistrationRequest(pending),
			checksumTransition: checksumRailPatchResultCooperatively,
			validateTopology: (pending) => bridge.validateRegistrationRequest(pending, f.input),
		});
		await worker.posted.promise;
		worker.respond();
		await expect(preparation.promise).resolves.toEqual({
			kind: "register-static-fab-process-loop",
			organizationId: 1,
			name: "Manual Loop",
		});
		expect(worker.terminationCount).toBe(1);
		expect(f.document.organizations.records).toHaveLength(0);
		preparation.cancel();
		bridge.dispose();
	});

	it.each([
		"document",
		"candidate",
		"checksum",
		"epoch",
	] as const)("refuses unrelated registration %s before creating a Worker", async (kind) => {
		const f = fixture(),
			factory = vi.fn(() => new InlineCandidateWorker()),
			bridge = new StaticFabProcessLoopTopologyBridge(factory);
		const request = {
			document: kind === "document" ? new RailDocument() : f.document,
			source: f.input.source,
			candidate: kind === "candidate" ? structuredClone(f.input.candidate) : f.input.candidate,
			name: "Manual Loop",
			sourceChecksum: kind === "checksum" ? "wrong" : f.mirror.checksum,
			mirrorEpoch: f.mirror.epoch + (kind === "epoch" ? 1 : 0),
		};
		await expect(bridge.validateRegistrationRequest(request, f.input)).rejects.toThrow(
			"adapter source",
		);
		expect(factory).not.toHaveBeenCalled();
		bridge.dispose();
	});

	it("keeps replacement registration alive when the revoked old request rejects and cancels", async () => {
		const f = fixture(),
			workers = [new InlineCandidateWorker(), new InlineCandidateWorker()];
		let created = 0;
		const bridge = new StaticFabProcessLoopTopologyBridge(() => workers[created++]);
		const start = (name: string) =>
			prepareStaticFabProcessLoopRegistrationCooperatively(
				{
					document: f.document,
					source: f.input.source,
					candidate: f.input.candidate,
					name,
					sourceChecksum: f.mirror.checksum,
					mirrorEpoch: f.mirror.epoch,
				},
				{
					checkpoint: f.input.checkpoint,
					isCurrent: f.input.isCurrent,
					cancelTopology: (request) => bridge.cancelRegistrationRequest(request),
					checksumTransition: checksumRailPatchResultCooperatively,
					validateTopology: (request) => bridge.validateRegistrationRequest(request, f.input),
				},
			);
		const old = start("Old Loop"),
			rejected = expect(old.promise).rejects.toThrow();
		await workers[0].posted.promise;
		const replacement = start("New Loop");
		await workers[1].posted.promise;
		await rejected;
		old.cancel();
		expect(workers[0].terminationCount).toBe(1);
		expect(workers[1].terminationCount).toBe(0);
		workers[1].respond();
		await expect(replacement.promise).resolves.toMatchObject({ name: "New Loop" });
		expect(workers[1].terminationCount).toBe(1);
		replacement.cancel();
		bridge.dispose();
	});

	it("returns owned bounded facts, transfers only selected columns and terminates once", async () => {
		const f = fixture();
		const worker = new InlineCandidateWorker();
		const bridge = new StaticFabProcessLoopTopologyBridge(() => worker);
		const sequence = f.document.getPatchSequence();
		const organizations = f.document.organizations;
		const events = vi.fn();
		f.document.subscribe(events);
		const pending = bridge.check(f.input);
		await worker.posted.promise;
		expect(worker.transferCount).toBe(7);
		expect(Object.keys(worker.request?.columns ?? {})).toEqual([
			"version",
			"revision",
			"patchSequence",
			"nextAdvancedSwitchId",
			"edgeCells",
			"switchIds",
			"switchRecords",
		]);
		worker.respond();
		const result = await pending;
		expect(result.valid).toBe(true);
		expect(result.authoringAuthority).toBe("NONE");
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.evidence)).toBe(true);
		expect(f.document.organizations).toBe(organizations);
		expect(f.document.getPatchSequence()).toBe(sequence);
		expect(events).not.toHaveBeenCalled();
		expect(worker.terminationCount).toBe(1);
		expect(worker.onmessage).toBeNull();
		bridge.dispose();
		expect(worker.terminationCount).toBe(1);
	});

	it("resolves an open candidate as negative facts rather than a transport failure", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 })),
		).toBe(true);
		const f = fixture(document);
		const worker = new InlineCandidateWorker();
		const pending = new StaticFabProcessLoopTopologyBridge(() => worker).check(f.input);
		await worker.posted.promise;
		worker.respond();
		await expect(pending).resolves.toMatchObject({
			valid: false,
			authoringAuthority: "NONE",
			evidence: { authoredOpenEnds: 2 },
		});
		expect(worker.terminationCount).toBe(1);
	});

	it.each([
		"not-ready",
		"epoch",
		"checksum",
		"counts",
	] as const)("rejects an unmatched mirror %s before Worker creation", async (kind) => {
		const f = fixture();
		if (kind === "not-ready") f.mirror.status = "syncing";
		if (kind === "epoch") f.mirror.epoch = -1;
		if (kind === "checksum") f.mirror.checksum = f.mirror.checksum.replace(/.$/, "f");
		if (kind === "counts") f.mirror.cells++;
		const factory = vi.fn(() => new InlineCandidateWorker());
		await expect(new StaticFabProcessLoopTopologyBridge(factory).check(f.input)).rejects.toThrow();
		expect(factory).not.toHaveBeenCalled();
	});

	it.each([
		"abort",
		"mutation",
		"selection",
	] as const)("discards %s during cooperative packing without creating a Worker", async (kind) => {
		const f = fixture();
		const gate = deferred();
		const reached = deferred();
		const factory = vi.fn(() => new InlineCandidateWorker());
		const pending = new StaticFabProcessLoopTopologyBridge(factory).check({
			...f.input,
			checkpoint: async () => {
				reached.resolve();
				await gate.promise;
			},
		});
		await reached.promise;
		if (kind === "abort") f.controller.abort();
		if (kind === "mutation") f.document.map.setEncoded(200, 200, 0x11);
		if (kind === "selection") f.replaceSelection();
		gate.resolve();
		await expect(pending).rejects.toThrow();
		expect(factory).not.toHaveBeenCalled();
	});

	it.each([
		"epoch",
		"port-only",
		"rollback",
		"document",
	] as const)("rejects %s change after post even when source rail counters match", async (kind) => {
		const f = fixture();
		const worker = new InlineCandidateWorker();
		const pending = new StaticFabProcessLoopTopologyBridge(() => worker).check(f.input);
		await worker.posted.promise;
		const beforeRevision = f.document.map.getRevision();
		if (kind === "epoch") f.mirror.epoch++;
		if (kind === "document") f.current = false;
		if (kind === "rollback") {
			const checkpoint = f.document.map.createMutationCheckpoint();
			const mutation = { x: 200, y: 200, before: 0, after: 0x11 };
			f.document.map.applyAtomicMutations([mutation], []);
			f.document.map.rollbackAtomicMutations([mutation], [], checkpoint);
		}
		if (kind === "port-only") {
			const plan = createPortEquipmentMutationPlan(
				"place-ohb",
				beforeRevision,
				f.document.getPatchSequence(),
				[
					{
						id: 1,
						before: null,
						after: {
							id: 1,
							equipmentGroupId: 1,
							route: { kind: "CARDINAL_CELL", x: 10, z: 0, from: DIR_W, to: DIR_E },
							stationMillimeters: 500,
							side: "LEFT",
							lateralOffsetMillimeters: 700,
							direction: "WITH_TRAVEL",
							portType: "OHB",
							barcode: null,
						},
					},
				],
				[{ id: 1, before: null, after: { id: 1, kind: "OHB", template: "SINGLE", portIds: [1] } }],
			);
			expect(
				f.document.commitPortEquipment(plan),
				f.document.getLastCommandError() ?? "port-only commit",
			).toBe(true);
		}
		expect(f.document.map.getRevision()).toBe(beforeRevision);
		worker.respond();
		await expect(pending).rejects.toThrow();
		expect(worker.terminationCount).toBe(1);
	});

	it.each([
		"request",
		"fingerprint",
		"source",
		"authority",
		"facts",
		"extra",
	] as const)("rejects malformed %s responses and releases the Worker", async (kind) => {
		const f = fixture();
		const worker = new InlineCandidateWorker();
		const pending = new StaticFabProcessLoopTopologyBridge(() => worker).check(f.input);
		await worker.posted.promise;
		worker.respond((response) => {
			if (response.type !== "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED")
				throw new Error(response.message);
			if (kind === "request") return { ...response, requestId: response.requestId + 1 };
			if (kind === "fingerprint") return { ...response, fingerprint: "00000000:00000000" };
			if (kind === "source")
				return { ...response, source: { ...response.source, nextOrganizationId: 2 } };
			if (kind === "authority")
				return { ...response, result: { ...response.result, authoringAuthority: "COMMIT" } };
			if (kind === "facts")
				return {
					...response,
					result: {
						...response.result,
						evidence: { ...response.result.evidence, authoredEdges: 101 },
					},
				};
			return { ...response, graph: [] };
		});
		await expect(pending).rejects.toThrow();
		expect(worker.terminationCount).toBe(1);
	});

	it("ignores retained callbacks from a cancelled Worker while a replacement is pending", async () => {
		const first = fixture();
		const second = fixture();
		const old = new InlineCandidateWorker(),
			next = new InlineCandidateWorker();
		const workers = [old, next];
		const bridge = new StaticFabProcessLoopTopologyBridge(() => {
			const worker = workers.shift();
			if (!worker) throw new Error("unexpected Worker creation");
			return worker;
		});
		const oldPending = bridge.check(first.input);
		await old.posted.promise;
		const oldMessage = old.onmessage,
			oldError = old.onerror,
			oldMessageError = old.onmessageerror;
		const oldRejection = expect(oldPending).rejects.toMatchObject({ name: "AbortError" });
		const newPending = bridge.check(second.input);
		await next.posted.promise;
		oldMessage?.({
			data: { nonsense: true },
		} as unknown as MessageEvent<StaticFabProcessLoopTopologyWorkerResponse>);
		oldError?.({ message: "late" } as ErrorEvent);
		oldMessageError?.({ data: null } as MessageEvent<unknown>);
		expect(next.terminationCount).toBe(0);
		next.respond();
		await oldRejection;
		await expect(newPending).resolves.toMatchObject({ valid: true });
		expect(old.terminationCount).toBe(1);
		expect(next.terminationCount).toBe(1);
	});

	it("terminates and rejects on abort, Worker errors and timeout", async () => {
		for (const action of ["abort", "error", "messageerror", "timeout"] as const) {
			vi.useFakeTimers();
			const f = fixture();
			const worker = new InlineCandidateWorker();
			const pending = new StaticFabProcessLoopTopologyBridge(() => worker, 20).check(f.input);
			await worker.posted.promise;
			const rejection = expect(pending).rejects.toThrow();
			if (action === "abort") f.controller.abort();
			if (action === "error") worker.onerror?.({ message: "synthetic" } as ErrorEvent);
			if (action === "messageerror")
				worker.onmessageerror?.({ data: null } as MessageEvent<unknown>);
			if (action === "timeout") vi.advanceTimersByTime(20);
			await rejection;
			expect(worker.terminationCount).toBe(1);
			expect(vi.getTimerCount()).toBe(0);
			vi.useRealTimers();
		}
	});

	it("cleans up Worker creation and post failures", async () => {
		const f = fixture();
		await expect(
			new StaticFabProcessLoopTopologyBridge(() => {
				throw new Error("create failure");
			}).check(f.input),
		).rejects.toThrow("create failure");
		const worker = new InlineCandidateWorker();
		worker.postMessage = () => {
			throw new Error("post failure");
		};
		await expect(
			new StaticFabProcessLoopTopologyBridge(() => worker).check(f.input),
		).rejects.toThrow("post failure");
		expect(worker.terminationCount).toBe(1);
		expect(worker.onmessage).toBeNull();
	});
});

function fixture(document = loopDocument()) {
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
	const source = Object.freeze({
		map: document.map,
		ownership,
		organizations: document.organizations,
		patchSequence: document.getPatchSequence(),
		selection: Object.freeze({
			baseRevision: document.map.getRevision(),
			basePatchSequence: document.getPatchSequence(),
			rail,
			equipmentGroups: Object.freeze([]),
		}),
	});
	const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
	while (!task.done) task.step(128);
	const candidate = task.finish();
	if (!candidate.valid) throw new Error(candidate.error.code);
	const checksum = checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
	const mirror: RailWorkerBridgeState = {
		...INITIAL_RAIL_WORKER_STATE,
		status: "ready",
		epoch: 2,
		targetSequence: document.getPatchSequence(),
		sequence: document.getPatchSequence(),
		targetRevision: document.map.getRevision(),
		revision: document.map.getRevision(),
		targetChecksum: checksum,
		checksum,
		targetCells: document.map.size,
		cells: document.map.size,
		targetEdges: document.map.edgeCount,
		edges: document.map.edgeCount,
	};
	let liveSource = source;
	const f = {
		document,
		mirror,
		current: true,
		controller: new AbortController(),
		replaceSelection() {
			liveSource = Object.freeze({ ...source, selection: Object.freeze({ ...source.selection }) });
		},
		input: undefined as unknown as StaticFabProcessLoopTopologyInput,
	};
	f.input = {
		document,
		source,
		candidate: candidate.candidate,
		signal: f.controller.signal,
		getCurrentSource: () => liveSource,
		isCurrent: () => f.current,
		getMirrorState: () => mirror,
		checkpoint: () => Promise.resolve(),
	};
	return f;
}

function loopDocument(): RailDocument {
	const document = new RailDocument();
	const points = [
		{ x: 0, y: 0 },
		{ x: 30, y: 0 },
		{ x: 30, y: 20 },
		{ x: 0, y: 20 },
		{ x: 0, y: 0 },
	];
	for (let index = 1; index < points.length; index++)
		expect(
			document.commit(
				planRailConstruction(
					document.map,
					points[index - 1] as { x: number; y: number },
					points[index] as { x: number; y: number },
				),
			),
		).toBe(true);
	return document;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve = (): void => {
		throw new Error("Deferred was not initialized.");
	};
	const promise = new Promise<void>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
