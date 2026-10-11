import { describe, expect, it, vi } from "vitest";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	discoverStaticFabAisleIntegration,
	prepareStaticFabAisleIntegration,
	type StaticFabAisleIntegrationWorkerRequest,
	type StaticFabAisleIntegrationWorkerResponse,
} from "../worker/StaticFabAisleIntegrationRuntime";
import { aisleIntegrationFixture } from "../worker/StaticFabAisleIntegrationTestFixture";
import {
	StaticFabAisleIntegrationBridge,
	type StaticFabAisleIntegrationWorkerPort,
} from "./StaticFabAisleIntegrationBridge";

class TestWorker implements StaticFabAisleIntegrationWorkerPort {
	onmessage: StaticFabAisleIntegrationWorkerPort["onmessage"] = null;
	onerror: StaticFabAisleIntegrationWorkerPort["onerror"] = null;
	onmessageerror: StaticFabAisleIntegrationWorkerPort["onmessageerror"] = null;
	request: StaticFabAisleIntegrationWorkerRequest | null = null;
	terminated = false;
	transform = (response: StaticFabAisleIntegrationWorkerResponse) => response;
	postMessage(request: StaticFabAisleIntegrationWorkerRequest, transfer: Transferable[] = []) {
		this.request = structuredClone(request, { transfer });
	}
	terminate() {
		this.terminated = true;
	}
	deliver() {
		const request = this.request!;
		const response: StaticFabAisleIntegrationWorkerResponse =
			request.type === "PREPARE_STATIC_FAB_AISLE_INTEGRATION"
				? {
						type: "STATIC_FAB_AISLE_INTEGRATION_PREPARED",
						version: 1,
						requestId: request.requestId,
						prepared: prepareStaticFabAisleIntegration(request),
					}
				: {
						type: "STATIC_FAB_AISLE_INTEGRATION_DISCOVERED",
						version: 1,
						requestId: request.requestId,
						discovered: discoverStaticFabAisleIntegration(request),
					};
		this.onmessage?.({
			data: structuredClone(this.transform(response)),
		} as MessageEvent<StaticFabAisleIntegrationWorkerResponse>);
	}
}
function fixture() {
	const source = aisleIntegrationFixture(),
		worker = new TestWorker(),
		bridge = new StaticFabAisleIntegrationBridge(() => worker, 100);
	const input = {
		intent: source.intent,
		snapshot: captureRailMirrorSnapshot(
			source.document.map,
			0,
			source.document.portEquipment,
			source.document.organizations,
			source.document.relationships,
		).snapshot,
		getCurrentSource: () => source,
	};
	return { ...source, worker, bridge, input };
}
describe("AISLE integration disposable Worker bridge", () => {
	it("transfers the snapshot, adopts one exact plan and revokes it on cancel", async () => {
		const f = fixture(),
			promise = f.bridge.prepare(f.input);
		f.worker.deliver();
		const result = await promise;
		expect(f.worker.terminated).toBe(true);
		expect(result.plan).not.toBeNull();
		expect(f.document.canUndo).toBe(false);
		f.bridge.cancel();
		expect(f.document.commitStaticFabAisleIntegration(result.plan!, f.scope)).toBe(false);
	});
	it("cancels a pending Worker without partial changes", async () => {
		const f = fixture(),
			promise = f.bridge.prepare(f.input);
		const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
		f.bridge.cancel();
		f.worker.deliver();
		await rejection;
		expect(f.worker.terminated).toBe(true);
		expect(f.document.getPatchSequence()).toBe(0);
		expect(f.document.canUndo).toBe(false);
	});
	it("rejects a copied snapshot without capture authority", async () => {
		const f = fixture();
		await expect(
			f.bridge.prepare({ ...f.input, snapshot: structuredClone(f.input.snapshot) }),
		).rejects.toThrow(/snapshot/);
		expect(f.worker.request).toBeNull();
	});
	it("rejects stale project generation", async () => {
		const f = fixture();
		let generation = 1;
		const promise = f.bridge.prepare({
			...f.input,
			getCurrentSource: () => ({
				document: f.document,
				scope: { ...f.scope, projectGeneration: generation },
			}),
		});
		generation++;
		f.worker.deliver();
		await expect(promise).rejects.toThrow(/변경/);
		expect(f.document.canUndo).toBe(false);
	});
	it("rejects a corrupted prospective checksum and plan", async () => {
		const f = fixture();
		f.worker.transform = (response) =>
			response.type === "STATIC_FAB_AISLE_INTEGRATION_PREPARED" && response.prepared.ticket
				? {
						...response,
						prepared: {
							...response.prepared,
							ticket: {
								...response.prepared.ticket,
								prospective: { ...response.prepared.ticket.prospective, checksum: "corrupt" },
							},
						},
					}
				: response;
		const promise = f.bridge.prepare(f.input);
		f.worker.deliver();
		await expect(promise).rejects.toThrow();
		expect(f.document.canUndo).toBe(false);
	});
	it("terminates and revokes a timed-out Worker", async () => {
		vi.useFakeTimers();
		try {
			const f = fixture(),
				promise = f.bridge.prepare(f.input);
			const rejected = expect(promise).rejects.toThrow(/시간/);
			await vi.advanceTimersByTimeAsync(101);
			await rejected;
			expect(f.worker.terminated).toBe(true);
			expect(f.document.canUndo).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
