import { describe, expect, it } from "vitest";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import { createOpenFabRailAreaBlueprint } from "../project/OpenFabBlueprintLibrary";
import {
	createOpenFabUserBlueprintRecord,
	type OpenFabUserBlueprintRecord,
} from "../project/OpenFabUserBlueprintLibrary";
import {
	createOpenFabUserBlueprintLibraryBundle,
	serializeOpenFabUserBlueprintLibraryBundle,
} from "../project/OpenFabUserBlueprintLibraryBundle";
import type {
	OpenFabUserBlueprintLibraryRestoreWorkerRequest,
	OpenFabUserBlueprintLibraryRestoreWorkerResponse,
} from "../worker/OpenFabUserBlueprintLibraryRestoreProtocol";
import { OpenFabUserBlueprintLibraryRestoreRuntime } from "../worker/OpenFabUserBlueprintLibraryRestoreRuntime";
import {
	consumePreparedUserBlueprintLibraryRestore,
	OpenFabUserBlueprintLibraryRestoreBridge,
	OpenFabUserBlueprintLibraryRestoreCancelledError,
	type OpenFabUserBlueprintLibraryRestoreWorkerPort,
} from "./OpenFabUserBlueprintLibraryRestoreBridge";

describe("OpenFabUserBlueprintLibraryRestoreBridge", () => {
	it("parses and preflights a whole-library file off the caller thread", async () => {
		const worker = new RuntimeWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const current = [record("current", "Current")];
		const incoming = record("incoming", "Incoming");
		const json = serializeOpenFabUserBlueprintLibraryBundle(
			createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z"),
		);

		const inspection = await bridge.inspect(json, current);

		expect(inspection.bundle.records).toEqual([incoming]);
		expect(inspection.preflight.currentRecords).toEqual(current);
		expect(inspection.preflight.additiveRecords).toEqual([incoming]);
		expect(inspection.replaceImpact.addedCount).toBe(1);
		expect(worker.terminated).toBe(false);

		const preview = await bridge.preview("merge", new Map());
		expect(preview).toMatchObject({ valid: true, recordCount: 2, aggregateEdgeCount: 8 });
		const plan = await bridge.plan("merge", new Map(), "2026-08-03T01:00:00.000Z");
		expect(plan.records.map(({ id }) => id)).toEqual(["current", "incoming"]);

		bridge.dispose();
		expect(worker.terminated).toBe(true);
	});

	it("rebases a retained restore session after a stale IndexedDB compare-and-swap", async () => {
		const worker = new RuntimeWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const incoming = record("incoming", "Incoming");
		const json = serializeOpenFabUserBlueprintLibraryBundle(
			createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z"),
		);
		await bridge.inspect(json, [record("current", "Current")]);

		const concurrent = record("concurrent", "Concurrent");
		const rebased = await bridge.rebase([concurrent]);
		const preview = await bridge.preview("merge", new Map());

		expect(rebased.preflight.currentRecords).toEqual([concurrent]);
		expect(rebased.preflight.additiveRecords).toEqual([incoming]);
		expect(preview).toMatchObject({ valid: true, recordCount: 2, aggregateEdgeCount: 8 });
		expect(worker.terminated).toBe(false);
		bridge.dispose();
	});

	it("keeps the parsed session available when a preview request is already cancelled", async () => {
		const worker = new RuntimeWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const incoming = record("incoming", "Incoming");
		const json = serializeOpenFabUserBlueprintLibraryBundle(
			createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z"),
		);
		await bridge.inspect(json, []);
		const controller = new AbortController();
		controller.abort();

		await expect(bridge.preview("merge", new Map(), controller.signal)).rejects.toBeInstanceOf(
			OpenFabUserBlueprintLibraryRestoreCancelledError,
		);
		expect(worker.terminated).toBe(false);
		await expect(bridge.preview("merge", new Map())).resolves.toMatchObject({
			valid: true,
			recordCount: 1,
		});
		bridge.dispose();
	});

	it("coalesces aborted preview changes behind the one active Worker calculation", async () => {
		const worker = new HeldPreviewRuntimeWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const incoming = record("incoming", "Incoming");
		const json = serializeOpenFabUserBlueprintLibraryBundle(
			createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z"),
		);
		await bridge.inspect(json, []);
		const firstController = new AbortController();
		const first = bridge.preview("merge", new Map(), firstController.signal);
		await Promise.resolve();
		firstController.abort();
		await expect(first).rejects.toBeInstanceOf(OpenFabUserBlueprintLibraryRestoreCancelledError);

		const second = bridge.preview("replace", new Map());
		await Promise.resolve();
		expect(worker.previewRequestCount).toBe(1);
		worker.releaseHeldPreview();

		await expect(second).resolves.toMatchObject({ valid: true, recordCount: 1 });
		expect(worker.previewRequestCount).toBe(2);
		bridge.dispose();
	});

	it("freezes and consumes a Worker restore permit exactly once", async () => {
		const worker = new RuntimeWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const current = [record("current", "Current")];
		const incoming = record("incoming", "Incoming");
		const json = serializeOpenFabUserBlueprintLibraryBundle(
			createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z"),
		);
		await bridge.inspect(json, current);
		const plan = await bridge.plan("merge", new Map(), "2026-08-03T01:00:00.000Z");

		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.records)).toBe(true);
		expect(Object.isFrozen(plan.records[0]?.blueprint)).toBe(true);
		expect(() =>
			(plan.records as OpenFabUserBlueprintRecord[]).push(record("mutated", "Mutated")),
		).toThrow();
		const permit = consumePreparedUserBlueprintLibraryRestore(plan);
		expect(permit?.expectedRecords).toEqual(current);
		expect(permit?.replacementRecords).toBe(plan.records);
		expect(consumePreparedUserBlueprintLibraryRestore(plan)).toBeNull();
		bridge.dispose();
	});

	it("does not post a queued preview into a replacement Worker session", async () => {
		const firstWorker = new HeldPreviewRuntimeWorker();
		const secondWorker = new RuntimeWorker();
		const workers: OpenFabUserBlueprintLibraryRestoreWorkerPort[] = [firstWorker, secondWorker];
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => {
			const worker = workers.shift();
			if (!worker) throw new Error("Unexpected restore Worker creation.");
			return worker;
		});
		const incoming = record("incoming", "Incoming");
		const json = serializeOpenFabUserBlueprintLibraryBundle(
			createOpenFabUserBlueprintLibraryBundle([incoming], "2026-08-03T00:00:00.000Z"),
		);
		await bridge.inspect(json, []);
		const active = bridge.preview("merge", new Map());
		const queued = bridge.preview("replace", new Map());
		const activeResult = expect(active).rejects.toBeInstanceOf(
			OpenFabUserBlueprintLibraryRestoreCancelledError,
		);
		const queuedResult = expect(queued).rejects.toBeInstanceOf(
			OpenFabUserBlueprintLibraryRestoreCancelledError,
		);
		await Promise.resolve();

		await bridge.inspect(json, []);

		await activeResult;
		await queuedResult;
		expect(secondWorker.lastMessage?.type).toBe("INSPECT_OPENFAB_USER_BLUEPRINT_LIBRARY");
		bridge.dispose();
	});

	it("terminates the active worker when inspection is cancelled", async () => {
		const worker = new DeferredWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const controller = new AbortController();
		const pending = bridge.inspect("{}", [], controller.signal);

		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(OpenFabUserBlueprintLibraryRestoreCancelledError);
		expect(worker.terminated).toBe(true);
	});

	it("rejects a response that does not match the active request", async () => {
		const worker = new DeferredWorker();
		const bridge = new OpenFabUserBlueprintLibraryRestoreBridge(() => worker);
		const pending = bridge.inspect("{}", []);

		worker.respond({
			type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PREVIEWED",
			requestId: worker.lastMessage?.requestId ?? -1,
			preview: {
				valid: true,
				reason: null,
				recordCount: 0,
				aggregateEdgeCount: 0,
				aggregateJsonBytes: 0,
			},
			elapsedMilliseconds: 1,
		});

		await expect(pending).rejects.toThrow("mismatched response");
		expect(worker.terminated).toBe(true);
	});
});

class DeferredWorker implements OpenFabUserBlueprintLibraryRestoreWorkerPort {
	onmessage:
		| ((event: MessageEvent<OpenFabUserBlueprintLibraryRestoreWorkerResponse>) => void)
		| null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;
	lastMessage: OpenFabUserBlueprintLibraryRestoreWorkerRequest | null = null;

	postMessage(message: OpenFabUserBlueprintLibraryRestoreWorkerRequest): void {
		this.lastMessage = message;
	}

	respond(response: OpenFabUserBlueprintLibraryRestoreWorkerResponse): void {
		this.onmessage?.({
			data: response,
		} as MessageEvent<OpenFabUserBlueprintLibraryRestoreWorkerResponse>);
	}

	terminate(): void {
		this.terminated = true;
	}
}

class RuntimeWorker extends DeferredWorker {
	private readonly runtime = new OpenFabUserBlueprintLibraryRestoreRuntime(
		() => "user-blueprint-00000000-0000-4000-8000-000000000000",
	);

	override postMessage(message: OpenFabUserBlueprintLibraryRestoreWorkerRequest): void {
		this.lastMessage = message;
		queueMicrotask(() => this.respond(this.runtime.handle(message)));
	}
}

class HeldPreviewRuntimeWorker extends DeferredWorker {
	private readonly runtime = new OpenFabUserBlueprintLibraryRestoreRuntime(
		() => "user-blueprint-00000000-0000-4000-8000-000000000000",
	);
	private heldPreview: OpenFabUserBlueprintLibraryRestoreWorkerResponse | null = null;
	previewRequestCount = 0;

	override postMessage(message: OpenFabUserBlueprintLibraryRestoreWorkerRequest): void {
		this.lastMessage = message;
		const response = this.runtime.handle(message);
		if (message.type === "PREVIEW_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE") {
			this.previewRequestCount += 1;
			if (this.previewRequestCount === 1) {
				this.heldPreview = response;
				return;
			}
		}
		queueMicrotask(() => this.respond(response));
	}

	releaseHeldPreview(): void {
		const response = this.heldPreview;
		if (!response) throw new Error("Expected one held preview response.");
		this.heldPreview = null;
		this.respond(response);
	}
}

function record(id: string, name: string) {
	return createOpenFabUserBlueprintRecord(
		createOpenFabRailAreaBlueprint(TEMPLATE, {
			id: `${id}-portable`,
			name,
			createdAt: "2026-08-02T00:00:00.000Z",
		}),
		{ id, createdAt: "2026-08-02T00:00:00.000Z" },
	);
}

const TEMPLATE: RailAreaStampTemplate = Object.freeze({
	sourceRevision: 1,
	sourceModuleKeys: Object.freeze(["loop"]),
	sourceModuleCount: 1,
	sourceEdgeCount: 4,
	sourceWidthMeters: 1,
	sourceHeightMeters: 1,
	edges: Object.freeze([
		Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 0 }), to: Object.freeze({ x: 1, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 1 }), to: Object.freeze({ x: 0, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 0, y: 1 }), to: Object.freeze({ x: 0, y: 0 }) }),
	]),
});
