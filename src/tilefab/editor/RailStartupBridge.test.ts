import { describe, expect, it } from "vitest";
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
		bridge.dispose();
	});

	it("terminates and rejects active work on cancellation", async () => {
		const port = new FakeStartupWorker();
		const bridge = new RailStartupBridge(() => port);
		const pending = bridge.load({ kind: "scale-probe", cellCount: 12 });
		bridge.dispose();

		await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(port.terminated).toBe(true);
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
		expect(port.terminated).toBe(true);
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
});

class FakeStartupWorker implements RailStartupWorkerPort {
	onmessage: ((event: MessageEvent<RailStartupToMainMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly messages: MainToRailStartupMessage[] = [];
	readonly transfers: Transferable[][] = [];
	terminated = false;
	failPost = false;

	postMessage(message: MainToRailStartupMessage, transfer: Transferable[] = []): void {
		if (this.failPost) throw new Error("Injected startup post failure");
		this.messages.push(message);
		this.transfers.push(transfer);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(message: RailStartupToMainMessage): void {
		this.onmessage?.({ data: message } as MessageEvent<RailStartupToMainMessage>);
	}
}
