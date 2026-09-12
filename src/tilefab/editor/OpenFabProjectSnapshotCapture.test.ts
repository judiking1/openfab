import { describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { INITIAL_RAIL_WORKER_STATE } from "../worker/RailWorkerBridge";
import { captureOpenFabProjectSnapshot } from "./OpenFabProjectSnapshotCapture";
import { RailStartupCancelledError } from "./RailStartupBridge";

function fixture() {
	const document = new RailDocument();
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
	const state = {
		...INITIAL_RAIL_WORKER_STATE,
		status: "ready" as const,
		checksum: snapshot.checksum,
		targetChecksum: snapshot.checksum,
		physicalValid: false,
	};
	const controller = new AbortController();
	let current = true;
	const mirror = {
		getState: vi.fn(() => state),
		waitUntilSnapshotReady: vi.fn(async () => state),
		captureCurrentSnapshot: vi.fn(async () => snapshot),
	};
	return {
		document,
		snapshot,
		state,
		controller,
		mirror,
		replace: () => {
			current = false;
		},
		capture: () =>
			captureOpenFabProjectSnapshot(document, mirror, controller.signal, () => current),
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

describe("project mirror snapshot capture", () => {
	it("saves an incomplete physical layout without traversing the main-thread map", async () => {
		const f = fixture();
		const traversal = vi.spyOn(f.document.map, "forEachRail").mockImplementation(() => {
			throw new Error("Main-thread full-map traversal is forbidden during project capture");
		});
		const result = await f.capture();
		expect(result.snapshot).toBe(f.snapshot);
		expect(result.operations).toBe(f.document.operationalConfiguration);
		expect(f.mirror.waitUntilSnapshotReady).toHaveBeenCalledWith(
			{ sequence: 0, revision: 0, checksum: f.snapshot.checksum },
			f.controller.signal,
		);
		expect(f.mirror.captureCurrentSnapshot).toHaveBeenCalledWith(f.controller.signal);
		expect(traversal).not.toHaveBeenCalled();
		result.assertCurrent();
	});

	it("rejects a mirror targeting another source before requesting a capture", async () => {
		const f = fixture();
		f.state.targetSequence++;
		await expect(f.capture()).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(f.mirror.waitUntilSnapshotReady).not.toHaveBeenCalled();
		expect(f.mirror.captureCurrentSnapshot).not.toHaveBeenCalled();
	});

	it("rejects a readiness response that has not synchronized the authored snapshot", async () => {
		const f = fixture();
		f.state.sequence++;
		await expect(f.capture()).rejects.toThrow("동기화");
		expect(f.mirror.captureCurrentSnapshot).not.toHaveBeenCalled();
	});

	for (const phase of ["wait", "capture"] as const) {
		it(`discards a replaced request while ${phase} is pending`, async () => {
			const f = fixture();
			const gate = deferred<void>();
			if (phase === "wait")
				f.mirror.waitUntilSnapshotReady.mockImplementation(async () => {
					await gate.promise;
					return f.state;
				});
			else
				f.mirror.captureCurrentSnapshot.mockImplementation(async () => {
					await gate.promise;
					return f.snapshot;
				});
			const pending = f.capture();
			await Promise.resolve();
			f.replace();
			gate.resolve();
			await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
			if (phase === "wait") expect(f.mirror.captureCurrentSnapshot).not.toHaveBeenCalled();
		});
		it(`normalizes cancellation while ${phase} is pending`, async () => {
			const f = fixture();
			const gate = deferred<never>();
			if (phase === "wait") f.mirror.waitUntilSnapshotReady.mockReturnValue(gate.promise);
			else f.mirror.captureCurrentSnapshot.mockReturnValue(gate.promise);
			const pending = f.capture();
			await Promise.resolve();
			f.controller.abort();
			gate.reject(new DOMException("Aborted", "AbortError"));
			await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
		});
	}

	it("rejects rollback ABA even when revision, sequence and rail values return to baseline", async () => {
		const f = fixture();
		const gate = deferred<typeof f.snapshot>();
		f.mirror.captureCurrentSnapshot.mockReturnValue(gate.promise);
		const pending = f.capture();
		await Promise.resolve();
		const checkpoint = f.document.map.createMutationCheckpoint();
		const mutation = { x: 100, y: 100, before: 0, after: 0x11 };
		f.document.map.applyAtomicMutations([mutation], []);
		f.document.map.rollbackAtomicMutations([mutation], [], checkpoint);
		expect(f.document.map.getRevision()).toBe(f.snapshot.revision);
		gate.resolve(f.snapshot);
		await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
	});

	it("invalidates a completed capture before late serializer or persistence feedback", async () => {
		const f = fixture();
		const old = await f.capture();
		f.replace();
		expect(() => old.assertCurrent()).toThrow(RailStartupCancelledError);
		const fresh = fixture();
		const next = await fresh.capture();
		expect(() => next.assertCurrent()).not.toThrow();
	});

	it("pins operations and every non-rail authored domain by identity", async () => {
		for (const key of [
			"operationalConfiguration",
			"portEquipment",
			"organizations",
			"relationships",
		] as const) {
			const f = fixture();
			const capture = await f.capture();
			vi.spyOn(f.document, key, "get").mockReturnValue({ ...f.document[key] });
			expect(() => capture.assertCurrent()).toThrow(RailStartupCancelledError);
		}
	});

	it("rejects snapshot identity and cursor mismatches", async () => {
		for (const altered of [
			{ sequence: 1 },
			{ revision: 1 },
			{ checksum: "wrong" },
			{ nextAdvancedSwitchId: 2 },
		]) {
			const f = fixture();
			f.mirror.captureCurrentSnapshot.mockResolvedValue({ ...f.snapshot, ...altered });
			await expect(f.capture()).rejects.toThrow("일치하지");
		}
		for (const [key, cursor] of [
			["portEquipment", "nextPortId"],
			["portEquipment", "nextEquipmentGroupId"],
			["organizations", "nextOrganizationId"],
			["relationships", "nextRelationshipId"],
		] as const) {
			const f = fixture();
			f.mirror.captureCurrentSnapshot.mockResolvedValue({
				...f.snapshot,
				[key]: { ...f.snapshot[key], [cursor]: 99 },
			});
			await expect(f.capture()).rejects.toThrow("일치하지");
		}
	});

	it("invalidates captures after a mirror epoch changes and preserves current failures", async () => {
		const f = fixture();
		const result = await f.capture();
		f.state.epoch++;
		expect(() => result.assertCurrent()).toThrow(RailStartupCancelledError);
		const fresh = fixture();
		fresh.mirror.captureCurrentSnapshot.mockRejectedValue(new Error("Worker failed"));
		await expect(fresh.capture()).rejects.toThrow("Worker failed");
	});
});
