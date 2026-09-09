import { afterEach, describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { DeferredStaticFabArrangementBridge } from "./DeferredStaticFabArrangementBridge";
import type {
	StaticFabArrangementInput,
	StaticFabArrangementSessionInput,
	ValidatedStaticFabArrangement,
} from "./StaticFabArrangementBridge";

const intent: StaticFabArrangementInput = {
	intent: {
		version: 1,
		arrangementVersion: 1,
		axis: "X",
		mode: "ALIGN_MIN",
		roots: [{ kind: "ORGANIZATION", organizationId: 1, selectionMode: "EFFECTIVE" }],
	},
};
const result: ValidatedStaticFabArrangement = {
	plan: null,
	certified: false,
	workerRoundTripMilliseconds: 0,
	responseValidationMilliseconds: 0,
	adoptionMilliseconds: 0,
	sessionHydrationMilliseconds: 0,
	sessionCompilationMilliseconds: 0,
	sourcePlanIndex: 1,
	validation: {
		plan: null,
		ticket: null,
		valid: false,
		failureCode: "selection",
		reason: "Test selection",
		conflictCells: [],
		conflictCount: 0,
		planningMilliseconds: 0,
		validationMilliseconds: 0,
	},
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture() {
	const document = new RailDocument();
	const input: StaticFabArrangementSessionInput = {
		snapshot: captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot,
		getCurrentState: () => ({
			map: document.map,
			patchSequence: document.getPatchSequence(),
			portEquipment: document.portEquipment,
			organizations: document.organizations,
			relationships: document.relationships,
		}),
	};
	const delegate = {
		startSession: vi.fn(),
		prepare: vi.fn(async () => result),
		cancelPending: vi.fn(),
		dispose: vi.fn(),
	};
	const create = vi.fn(() => delegate);
	const loading = deferred<typeof create>();
	const load = vi.fn(() => loading.promise);
	const bridge = new DeferredStaticFabArrangementBridge(load, 100);
	return { document, input, delegate, create, loading, load, bridge };
}
const flush = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

describe("deferred arrangement preparation", () => {
	it("loads on demand and passes the exact session and latest intent to full validation", async () => {
		const f = fixture();
		expect(f.load).not.toHaveBeenCalled();
		f.bridge.startSession(f.input);
		const first = f.bridge.prepare(intent);
		const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
		const latest = { intent: { ...intent.intent, axis: "Z" as const } };
		const second = f.bridge.prepare(latest);
		await firstRejected;
		f.loading.resolve(f.create);
		await expect(second).resolves.toBe(result);
		expect(f.load).toHaveBeenCalledTimes(1);
		expect(f.delegate.startSession).toHaveBeenCalledExactlyOnceWith(f.input);
		expect(f.delegate.prepare).toHaveBeenCalledExactlyOnceWith(latest);
		f.bridge.dispose();
	});
	it("cancels immediately during loading and never starts a late worker", async () => {
		const f = fixture();
		f.bridge.startSession(f.input);
		const pending = f.bridge.prepare(intent);
		const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
		f.bridge.dispose();
		await rejected;
		f.loading.resolve(f.create);
		await flush();
		expect(f.create).not.toHaveBeenCalled();
	});
	it.each(["mutation", "rollback"])("rejects %s of the source while code loads", async (mode) => {
		const f = fixture();
		f.bridge.startSession(f.input);
		const pending = f.bridge.prepare(intent);
		const rejected = expect(pending).rejects.toThrow("FAB가 변경");
		const checkpoint = f.document.map.createMutationCheckpoint();
		const changes = [{ x: 2, y: 2, before: 0, after: 0x82 }];
		f.document.map.applyAtomicMutations(changes, []);
		if (mode === "rollback") f.document.map.rollbackAtomicMutations(changes, [], checkpoint);
		f.loading.resolve(f.create);
		await rejected;
		expect(f.create).not.toHaveBeenCalled();
		f.bridge.dispose();
	});
	it("ends a failed load and can start a new session without reviving the old request", async () => {
		const f = fixture();
		const next = deferred<typeof f.create>();
		f.load
			.mockImplementationOnce(() => f.loading.promise)
			.mockImplementationOnce(() => next.promise);
		f.bridge.startSession(f.input);
		const pending = f.bridge.prepare(intent);
		const rejected = expect(pending).rejects.toThrow("offline");
		f.loading.reject(new Error("offline"));
		await rejected;
		f.bridge.startSession(f.input);
		const retry = f.bridge.prepare(intent);
		next.resolve(f.create);
		await expect(retry).resolves.toBe(result);
		expect(f.create).toHaveBeenCalledTimes(1);
		f.bridge.dispose();
	});
	it("times out an unavailable module and discards a late successful load", async () => {
		vi.useFakeTimers();
		const f = fixture();
		f.bridge.startSession(f.input);
		const pending = f.bridge.prepare(intent);
		const rejected = expect(pending).rejects.toThrow("시간이 초과");
		await vi.advanceTimersByTimeAsync(101);
		await rejected;
		f.loading.resolve(f.create);
		await flush();
		expect(f.create).not.toHaveBeenCalled();
		f.bridge.dispose();
	});
	it("cancels a pending validation after loading and releases its worker", async () => {
		const f = fixture();
		const validation = deferred<ValidatedStaticFabArrangement>();
		f.delegate.prepare.mockImplementation(() => validation.promise);
		f.bridge.startSession(f.input);
		const pending = f.bridge.prepare(intent);
		const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
		f.loading.resolve(f.create);
		await flush();
		expect(f.delegate.prepare).toHaveBeenCalledTimes(1);
		f.bridge.dispose();
		await rejected;
		validation.resolve(result);
		await flush();
		expect(f.delegate.dispose).toHaveBeenCalledTimes(1);
	});
});
