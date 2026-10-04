import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import type {
	MainToRailStartupMessage,
	RailStartupToMainMessage,
} from "../worker/RailStartupProtocol";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	RailStartupBridge,
	RailStartupCancelledError,
	type RailStartupWorkerPort,
} from "./RailStartupBridge";

describe("RailStartupBridge", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});
	it("accepts only the active typed Worker result", async () => {
		const port = new FakeStartupWorker();
		const bridge = new RailStartupBridge(() => port);
		const pending = bridge.load({ kind: "scale-probe", cellCount: 12 });
		const request = port.messages[0];
		if (!request) throw new Error("expected startup request");
		port.emit({
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId + 1,
			payload: compileRailStartup(request.source),
		});
		port.emit({
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId,
			payload: compileRailStartup(request.source),
		});

		await expect(pending).resolves.toMatchObject({
			source: { kind: "scale-probe", cellCount: 12 },
		});
		expectReleased(port);
		bridge.dispose();
	});

	it("terminates and rejects active work on cancellation", async () => {
		const port = new FakeStartupWorker();
		const bridge = new RailStartupBridge(() => port);
		const pending = bridge.load({ kind: "scale-probe", cellCount: 12 });
		bridge.dispose();

		await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
		expectReleased(port);
	});

	it("transfers every authored snapshot buffer into the disposable Worker", async () => {
		const port = new FakeStartupWorker();
		const bridge = new RailStartupBridge(() => port);
		const document = createRailScaleProbeDocument(12);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const expectedTransfers = collectTransferableBuffers(snapshot);
		const pending = bridge.load({ kind: "snapshot", snapshot });
		const request = port.messages[0];
		if (!request) throw new Error("expected snapshot startup request");

		expect(new Set(port.transfers[0])).toEqual(new Set(expectedTransfers));
		port.emit({
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId,
			payload: compileRailStartup(request.source),
		});
		await expect(pending).resolves.toMatchObject({
			source: { kind: "snapshot", sequence: 1 },
		});
		bridge.dispose();
	});

	it("transfers the direct project snapshot without serializing it", async () => {
		const port = new FakeStartupWorker();
		const bridge = new RailStartupBridge(() => port);
		const document = createRailScaleProbeDocument(12);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const expectedTransfers = collectTransferableBuffers(snapshot);
		const pending = bridge.load({
			kind: "project-snapshot",
			snapshot,
			manifest: {
				id: "direct-bridge-001",
				name: "Direct bridge",
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		});
		const request = port.messages[0];
		if (!request) throw new Error("expected project snapshot startup request");

		expect(new Set(port.transfers[0])).toEqual(new Set(expectedTransfers));
		port.emit({
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId,
			payload: compileRailStartup(request.source),
		});
		await expect(pending).resolves.toMatchObject({
			source: { kind: "project", manifest: { id: "direct-bridge-001" } },
		});
		bridge.dispose();
	});

	it("cancels the active Worker and lets the latest load win", async () => {
		const ports: FakeStartupWorker[] = [];
		const bridge = new RailStartupBridge(() => {
			const port = new FakeStartupWorker();
			ports.push(port);
			return port;
		});
		const first = bridge.load({ kind: "scale-probe", cellCount: 12 });
		const firstRejected = expect(first).rejects.toBeInstanceOf(RailStartupCancelledError);
		const second = bridge.load({ kind: "scale-probe", cellCount: 24 });

		expect(ports[0]?.terminated).toBe(true);
		await firstRejected;
		const request = ports[1]?.messages[0];
		if (!request) throw new Error("expected latest startup request");
		ports[1]?.emit({
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId,
			payload: compileRailStartup(request.source),
		});
		await expect(second).resolves.toMatchObject({
			source: { kind: "scale-probe", cellCount: 24 },
		});
		bridge.dispose();
	});

	it("releases the candidate Worker when request delivery fails", async () => {
		const port = new FakeStartupWorker();
		port.failPost = true;
		const bridge = new RailStartupBridge(() => port);

		await expect(bridge.load({ kind: "scale-probe", cellCount: 12 })).rejects.toThrow(
			"Injected startup post failure",
		);
		expectReleased(port);
		bridge.dispose();
	});

	it("returns Worker construction failures through the Promise rollback path", async () => {
		const bridge = new RailStartupBridge(() => {
			throw new Error("Injected startup Worker creation failure");
		});

		await expect(bridge.load({ kind: "scale-probe", cellCount: 12 })).rejects.toThrow(
			"Injected startup Worker creation failure",
		);
		bridge.dispose();
	});
	it.each([
		"error",
		"messageerror",
		"timeout",
	] as const)("settles and releases startup work after %s", async (fault) => {
		const port = new FakeStartupWorker();
		const bridge = new RailStartupBridge(() => port);
		const pending = bridge.load({ kind: "scale-probe", cellCount: 12 });
		const rejected = expect(pending).rejects.toThrow(
			fault === "error"
				? "Injected startup fault"
				: fault === "messageerror"
					? "unreadable response"
					: "timed out after 40000 ms",
		);
		if (fault === "error") port.onerror?.({ message: "Injected startup fault" } as ErrorEvent);
		if (fault === "messageerror") port.onmessageerror?.({ data: null } as MessageEvent<unknown>);
		if (fault === "timeout") {
			vi.advanceTimersByTime(39_999);
			expect(port.terminated).toBe(false);
			vi.advanceTimersByTime(1);
		}
		await rejected;
		expectReleased(port);
		bridge.dispose();
	});

	it("ignores replaced Worker callbacks and a queued old deadline", async () => {
		const timers = vi.spyOn(globalThis, "setTimeout");
		const ports = [new FakeStartupWorker(), new FakeStartupWorker()];
		let next = 0;
		const bridge = new RailStartupBridge(() => {
			const port = ports[next++];
			if (!port) throw new Error("Unexpected startup Worker");
			return port;
		});
		const firstPort = ports[0];
		const secondPort = ports[1];
		if (!firstPort || !secondPort) throw new Error("Expected two startup Workers");
		const first = bridge.load({ kind: "scale-probe", cellCount: 12 });
		const firstRejected = expect(first).rejects.toBeInstanceOf(RailStartupCancelledError);
		const old = {
			message: firstPort.onmessage,
			error: firstPort.onerror,
			messageerror: firstPort.onmessageerror,
			timeout: timers.mock.calls[0]?.[0],
		};
		const second = bridge.load({ kind: "scale-probe", cellCount: 24 });
		await firstRejected;
		expect(firstPort.terminated).toBe(true);
		expect(firstPort.onmessageerror).toBeNull();
		expect(vi.getTimerCount()).toBe(1);
		const request = secondPort.messages[0];
		if (!request || typeof old.timeout !== "function") throw new Error("Missing request/deadline");
		old.message?.({
			data: {
				type: "RAIL_STARTUP_READY",
				requestId: request.requestId,
				payload: compileRailStartup({ kind: "scale-probe", cellCount: 12 }),
			},
		} as MessageEvent<RailStartupToMainMessage>);
		old.error?.({ message: "Stale startup fault" } as ErrorEvent);
		old.messageerror?.({ data: null } as MessageEvent<unknown>);
		(old.timeout as () => void)();
		expect(secondPort.terminated).toBe(false);
		secondPort.emit({
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId,
			payload: compileRailStartup(request.source),
		});
		await expect(second).resolves.toMatchObject({ source: { cellCount: 24 } });
		expectReleased(secondPort);
		bridge.dispose();
	});

	it("clears the deadline when postMessage resolves synchronously", async () => {
		const port = new FakeStartupWorker();
		port.onPost = (request) =>
			port.emit({
				type: "RAIL_STARTUP_READY",
				requestId: request.requestId,
				payload: compileRailStartup(request.source),
			});
		const bridge = new RailStartupBridge(() => port);
		await expect(bridge.load({ kind: "scale-probe", cellCount: 12 })).resolves.toMatchObject({
			source: { cellCount: 12 },
		});
		expectReleased(port);
		vi.advanceTimersByTime(40_000);
		expectReleased(port);
		bridge.dispose();
	});
});

function expectReleased(port: FakeStartupWorker): void {
	expect(port.terminated).toBe(true);
	expect(port.onmessage).toBeNull();
	expect(port.onerror).toBeNull();
	expect(port.onmessageerror).toBeNull();
	expect(vi.getTimerCount()).toBe(0);
}

class FakeStartupWorker implements RailStartupWorkerPort {
	onmessage: ((event: MessageEvent<RailStartupToMainMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	onPost: ((message: MainToRailStartupMessage) => void) | null = null;
	readonly messages: MainToRailStartupMessage[] = [];
	readonly transfers: Transferable[][] = [];
	terminated = false;
	failPost = false;

	postMessage(message: MainToRailStartupMessage, transfer: Transferable[] = []): void {
		if (this.failPost) throw new Error("Injected startup post failure");
		this.messages.push(message);
		this.transfers.push(transfer);
		this.onPost?.(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: RailStartupToMainMessage): void {
		this.onmessage?.({ data: message } as MessageEvent<RailStartupToMainMessage>);
	}
}
