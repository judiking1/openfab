import { describe, expect, it, vi } from "vitest";
import {
	awaitOpenFabProjectSaveMetadata,
	saveOpenFabProject,
} from "./OpenFabProjectSaveTransaction";
import { RailStartupCancelledError } from "./RailStartupBridge";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
function fixture(delivery: "file" | "download" = "file") {
	const calls: string[] = [];
	let current = true;
	const reference = Object.freeze({
		id: "test-write",
		name: "Test.openfab",
		writable: true,
		reopenable: true,
	});
	const prepared = Object.freeze({ json: "authored-project-json", checksum: "test-checksum" });
	const commit = vi.fn(async (json: string) => {
		calls.push("commit");
		expect(json).toBe(prepared.json);
		return reference;
	});
	const capability = { name: reference.name, delivery, commit };
	const acquireWrite = vi.fn(async () => {
		calls.push("acquire");
		return capability;
	});
	const prepare = vi.fn(async () => {
		calls.push("prepare");
		return prepared;
	});
	const assertCurrent = vi.fn(() => {
		calls.push("assert");
		if (!current) throw new RailStartupCancelledError();
	});
	return {
		calls,
		reference,
		prepared,
		commit,
		capability,
		acquireWrite,
		prepare,
		assertCurrent,
		replace: () => {
			current = false;
		},
		save: () => saveOpenFabProject({ acquireWrite, prepare, assertCurrent }),
	};
}

describe("project save transaction", () => {
	it("starts destination acquisition synchronously before delayed preparation", async () => {
		const f = fixture();
		const selection = deferred<typeof f.capability>();
		f.acquireWrite.mockImplementation(() => {
			f.calls.push("acquire");
			return selection.promise;
		});
		const saving = f.save();
		expect(f.calls).toEqual(["acquire"]);
		expect(f.prepare).not.toHaveBeenCalled();
		selection.resolve(f.capability);
		expect(await saving).toEqual({
			status: "written",
			reference: f.reference,
			prepared: f.prepared,
		});
		expect(f.calls).toEqual(["acquire", "assert", "prepare", "assert", "commit"]);
	});
	it("does no snapshot, serialization or write after user picker cancellation", async () => {
		const f = fixture();
		const prepare = vi.fn();
		const assertCurrent = vi.fn();
		expect(
			await saveOpenFabProject({ acquireWrite: async () => null, prepare, assertCurrent }),
		).toEqual({ status: "cancelled" });
		expect(prepare).not.toHaveBeenCalled();
		expect(assertCurrent).not.toHaveBeenCalled();
		expect(f.commit).not.toHaveBeenCalled();
	});
	it("returns a download request, never a confirmed write, through the same preparation guards", async () => {
		const f = fixture("download");
		expect(await f.save()).toEqual({
			status: "download-requested",
			reference: f.reference,
			prepared: f.prepared,
		});
		expect(f.calls).toEqual(["acquire", "assert", "prepare", "assert", "commit"]);
	});
	it("refuses a download after source replacement during serialization", async () => {
		const f = fixture("download");
		f.prepare.mockImplementation(async () => {
			f.replace();
			return f.prepared;
		});
		await expect(f.save()).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(f.commit).not.toHaveBeenCalled();
	});
	it("does not return a download receipt when preparation or browser dispatch fails", async () => {
		const f = fixture("download");
		const invalid = new Error("project validation failed");
		f.prepare.mockRejectedValueOnce(invalid);
		await expect(f.save()).rejects.toBe(invalid);
		expect(f.commit).not.toHaveBeenCalled();
		const blocked = new DOMException("download blocked", "NotAllowedError");
		f.commit.mockRejectedValueOnce(blocked);
		await expect(f.save()).rejects.toBe(blocked);
	});
	it.each([
		"SecurityError",
		"AbortError",
	])("propagates %s instead of treating it as user cancellation", async (name) => {
		const f = fixture();
		const error = new DOMException("acquisition failed", name);
		f.acquireWrite.mockRejectedValue(error);
		await expect(f.save()).rejects.toBe(error);
		expect(f.prepare).not.toHaveBeenCalled();
		expect(f.commit).not.toHaveBeenCalled();
	});
	it("rejects source replacement while a native destination chooser is pending", async () => {
		const f = fixture();
		const selection = deferred<typeof f.capability>();
		f.acquireWrite.mockReturnValue(selection.promise);
		const saving = f.save();
		f.replace();
		selection.resolve(f.capability);
		await expect(saving).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(f.prepare).not.toHaveBeenCalled();
		expect(f.commit).not.toHaveBeenCalled();
	});
	it("rejects replacement during serialization before commit", async () => {
		const f = fixture();
		const serialization = deferred<typeof f.prepared>();
		const entered = deferred<void>();
		f.prepare.mockImplementation(() => {
			entered.resolve();
			return serialization.promise;
		});
		const saving = f.save();
		await entered.promise;
		f.replace();
		serialization.resolve(f.prepared);
		await expect(saving).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(f.commit).not.toHaveBeenCalled();
	});
	it("returns the actual written receipt if source changes while close is pending", async () => {
		const f = fixture();
		const closing = deferred<typeof f.reference>();
		const entered = deferred<void>();
		f.commit.mockImplementation(() => {
			entered.resolve();
			return closing.promise;
		});
		const saving = f.save();
		await entered.promise;
		f.replace();
		closing.resolve(f.reference);
		expect(await saving).toEqual({
			status: "written",
			reference: f.reference,
			prepared: f.prepared,
		});
		expect(f.assertCurrent).toHaveBeenCalledTimes(2);
	});
	it("does not return a written receipt when write or close actually fails", async () => {
		const f = fixture();
		const error = new Error("close failed");
		f.commit.mockRejectedValue(error);
		await expect(f.save()).rejects.toBe(error);
	});
});

describe("saved-file metadata cancellation", () => {
	it("does not start metadata work for an already aborted save", async () => {
		const controller = new AbortController();
		controller.abort();
		const work = vi.fn(async () => "late");
		await expect(awaitOpenFabProjectSaveMetadata(work, controller.signal)).rejects.toBeInstanceOf(
			RailStartupCancelledError,
		);
		expect(work).not.toHaveBeenCalled();
	});
	it("releases the waiting save on abort without waiting for the database", async () => {
		const controller = new AbortController();
		const gate = deferred<string>();
		const waiting = awaitOpenFabProjectSaveMetadata(() => gate.promise, controller.signal);
		controller.abort();
		await expect(waiting).rejects.toBeInstanceOf(RailStartupCancelledError);
		gate.resolve("database eventually completed");
		await Promise.resolve();
	});
	it("consumes late adapter rejection after an aborted save", async () => {
		const controller = new AbortController();
		let reject!: (error: unknown) => void;
		const work = new Promise<string>((_, no) => {
			reject = no;
		});
		const waiting = awaitOpenFabProjectSaveMetadata(() => work, controller.signal);
		controller.abort();
		await expect(waiting).rejects.toBeInstanceOf(RailStartupCancelledError);
		reject(new Error("late database failure"));
		await Promise.resolve();
	});
	it("returns successful metadata and removes the abort listener", async () => {
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		expect(await awaitOpenFabProjectSaveMetadata(async () => "recent", controller.signal)).toBe(
			"recent",
		);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		controller.abort();
	});
	it("propagates a synchronous metadata failure and removes the abort listener", async () => {
		const controller = new AbortController();
		const error = new Error("adapter failed");
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		await expect(
			awaitOpenFabProjectSaveMetadata(() => {
				throw error;
			}, controller.signal),
		).rejects.toBe(error);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});
});
