import { describe, expect, it } from "vitest";
import { compileStaticFabHierarchyIndex } from "../compile/StaticFabHierarchy";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";
import { planRailConstruction } from "../core/paint";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	type RailAreaStampTemplate,
	rotateRailAreaStampPose,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import type {
	BlueprintPlacementWorkerRequest,
	BlueprintPlacementWorkerResponse,
} from "../worker/BlueprintPlacementProtocol";
import { prepareBlueprintPlacement } from "../worker/BlueprintPlacementRuntime";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	BlueprintPlacementBridge,
	type BlueprintPlacementWorkerPort,
} from "./BlueprintPlacementBridge";

const ROUTE = Object.freeze({
	sourceRevision: 0,
	sourceModuleKeys: Object.freeze(["BRIDGE-ROUTE"]),
	sourceModuleCount: 1,
	sourceEdgeCount: 2,
	sourceWidthMeters: 2,
	sourceHeightMeters: 0,
	edges: Object.freeze([
		Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 0 }), to: Object.freeze({ x: 2, y: 0 }) }),
	]),
}) satisfies RailAreaStampTemplate;

class FakeBlueprintPlacementWorker implements BlueprintPlacementWorkerPort {
	onmessage: ((event: MessageEvent<BlueprintPlacementWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	transferredBuffers = 0;
	transferredBytes = 0;
	receivedSourceEdges = 0;
	responseCloned = false;

	postMessage(message: BlueprintPlacementWorkerRequest, transfer: Transferable[] = []): void {
		this.transferredBuffers = transfer.length;
		this.transferredBytes = transfer.reduce<number>(
			(total, item) => total + (item instanceof ArrayBuffer ? item.byteLength : 0),
			0,
		);
		const delivered = structuredClone(message, { transfer });
		this.receivedSourceEdges = delivered.railTemplate.sourceEdgeCount;
		const prepared = prepareBlueprintPlacement(delivered);
		const response = structuredClone({
			type: "BLUEPRINT_PLACEMENT_PREPARED",
			requestId: delivered.requestId,
			prepared,
		} satisfies BlueprintPlacementWorkerResponse);
		this.responseCloned = true;
		queueMicrotask(() => {
			this.onmessage?.({
				data: response,
			} as MessageEvent<BlueprintPlacementWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class SilentBlueprintPlacementWorker implements BlueprintPlacementWorkerPort {
	onmessage: ((event: MessageEvent<BlueprintPlacementWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(): void {}

	terminate(): void {
		this.terminated = true;
	}
}

describe("BlueprintPlacementBridge", () => {
	it("transfers the authored snapshot and returns the active exact result", async () => {
		const worker = new FakeBlueprintPlacementWorker();
		const bridge = new BlueprintPlacementBridge(() => worker);
		const document = new RailDocument();
		const prepared = await bridge.prepare({
			snapshot: captureRailMirrorSnapshot(document.map, 0).snapshot,
			railTemplate: ROUTE,
			staticFabTemplate: null,
			anchor: { x: 12, y: 5 },
			pose: initialRailAreaStampPose(),
		});

		expect(prepared.valid, prepared.reason).toBe(true);
		if (!("areaStamp" in prepared.plan)) throw new Error("Expected a rail-area placement plan.");
		expect(prepared.plan.areaStamp.planningLevel).toBe("exact");
		expect(worker.transferredBuffers).toBeGreaterThan(0);
		expect(worker.terminated).toBe(true);
	});

	it("round-trips the full Large FAB template through the disposable placement Worker", async () => {
		const source = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(source.document.map);
		const factory = compileStaticFabHierarchyIndex(source.document.map, ownership).branches[0]
			?.factory;
		if (!factory) throw new Error("expected generated Factory hierarchy");
		const railTemplate = createRailAreaStampTemplate(factory.selection);
		const worker = new FakeBlueprintPlacementWorker();
		const bridge = new BlueprintPlacementBridge(() => worker, 60_000);
		const target = new RailDocument();
		expect(target.commit(planRailConstruction(target.map, { x: 0, y: 0 }, { x: 4, y: 0 }))).toBe(
			true,
		);
		const targetEdgesBeforePlacement = target.map.edgeCount;
		let pose = initialRailAreaStampPose();
		for (let rotation = 0; rotation < 3; rotation++) {
			pose = rotateRailAreaStampPose(pose, 1);
		}

		const prepared = await bridge.prepare({
			snapshot: captureRailMirrorSnapshot(
				target.map,
				target.getPatchSequence(),
				target.portEquipment,
			).snapshot,
			railTemplate,
			staticFabTemplate: null,
			anchor: { x: 2_000, y: 2_000 },
			pose,
		});

		expect(prepared.valid, prepared.reason).toBe(true);
		expect(worker.receivedSourceEdges).toBe(railTemplate.sourceEdgeCount);
		expect(worker.receivedSourceEdges).toBeGreaterThan(0);
		expect(worker.transferredBuffers).toBeGreaterThan(0);
		expect(worker.transferredBytes).toBeGreaterThan(0);
		expect(worker.responseCloned).toBe(true);
		if (!("areaStamp" in prepared.plan)) throw new Error("expected rail-area placement plan");
		expect(prepared.plan.areaStamp).toMatchObject({
			quarterTurns: 3,
			anchor: { x: 2_000, y: 2_000 },
			widthMeters: railTemplate.sourceHeightMeters,
			heightMeters: railTemplate.sourceWidthMeters,
		});
		expect(target.commit(structuredClone(prepared).plan)).toBe(true);
		expect(target.map.edgeCount).toBe(targetEdgesBeforePlacement + railTemplate.sourceEdgeCount);
		expect(worker.terminated).toBe(true);
	}, 120_000);

	it("terminates and rejects an in-flight placement when cancelled", async () => {
		const worker = new FakeBlueprintPlacementWorker();
		const bridge = new BlueprintPlacementBridge(() => worker);
		const document = new RailDocument();
		const placement = bridge.prepare({
			snapshot: captureRailMirrorSnapshot(document.map, 0).snapshot,
			railTemplate: ROUTE,
			staticFabTemplate: null,
			anchor: { x: 12, y: 5 },
			pose: initialRailAreaStampPose(),
		});

		bridge.cancel();

		await expect(placement).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
	});

	it("terminates a Worker that does not answer before the placement deadline", async () => {
		const worker = new SilentBlueprintPlacementWorker();
		const bridge = new BlueprintPlacementBridge(() => worker, 1);
		const document = new RailDocument();

		await expect(
			bridge.prepare({
				snapshot: captureRailMirrorSnapshot(document.map, 0).snapshot,
				railTemplate: ROUTE,
				staticFabTemplate: null,
				anchor: { x: 12, y: 5 },
				pose: initialRailAreaStampPose(),
			}),
		).rejects.toThrow("timed out");
		expect(worker.terminated).toBe(true);
	});
});
