import { describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { recognizeProductionBayModule } from "../core/ProductionBayModuleRecognition";
import { RailDocument } from "../core/RailDocument";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	StaticFabOrganizationBundlePlacementWorkerRequest,
	StaticFabOrganizationBundlePlacementWorkerResponse,
} from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import { prepareStaticFabOrganizationBundlePlacement } from "../worker/StaticFabOrganizationBundlePlacementRuntime";
import {
	StaticFabOrganizationBundlePlacementBridge,
	type StaticFabOrganizationBundlePlacementInput,
	type StaticFabOrganizationBundlePlacementWorkerPort,
} from "./StaticFabOrganizationBundlePlacementBridge";

class RuntimeWorker implements StaticFabOrganizationBundlePlacementWorkerPort {
	onmessage:
		| ((event: MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>) => void)
		| null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(message: StaticFabOrganizationBundlePlacementWorkerRequest): void {
		queueMicrotask(() => {
			if (this.terminated) return;
			this.onmessage?.({
				data: Object.freeze({
					type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED" as const,
					requestId: message.requestId,
					prepared: prepareStaticFabOrganizationBundlePlacement(message),
				}),
			} as MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("Production Bay organization-bundle placement", () => {
	it("commits one Worker-certified command and preserves exact undo/redo parity", async () => {
		const document = new RailDocument();
		const artifact = certifyProductionBayModuleCatalogRequest(
			defaultProductionBayModuleCatalogRequest("twin-production-bay"),
		);
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => new RuntimeWorker());

		const prepared = await bridge.prepare(
			placementInput(document, artifact.organizationBundle, { x: 100, y: -50 }),
		);
		expect(prepared.certified).toBe(true);
		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		if (!prepared.plan) throw new Error("Expected a certified Production Bay placement plan.");
		expect(
			document.commitStaticFabOrganizationBundle(prepared.plan),
			document.getLastCommandError() ?? "Production Bay commit failed",
		).toBe(true);

		const placedChecksum = documentChecksum(document);
		const placedEdgeCount = artifact.organizationBundle.railEdges.length;
		expect(document.getPatchSequence()).toBe(1);
		expect(document.map.edgeCount).toBe(placedEdgeCount);
		expect(document.organizations.records.map((record) => record.kind)).toEqual([
			"BAY",
			"AISLE",
			"AISLE",
		]);
		const placedBay = document.organizations.records.find((record) => record.kind === "BAY");
		if (!placedBay) throw new Error("Expected the placed Production Bay root.");
		const placedRecognition = recognizeProductionBayModule(
			document.map,
			document.organizations,
			placedBay.id,
		);
		expect(placedRecognition.valid).toBe(true);
		if (!placedRecognition.valid) throw new Error(placedRecognition.reason);
		const processLoopIds = Object.values(
			placedRecognition.recognition.processLoopOrganizationIdsByLoopId,
		).sort((left, right) => left - right);
		expect(processLoopIds).toHaveLength(2);
		expect(
			document.organizations.records
				.filter((record) => processLoopIds.includes(record.id))
				.map((record) => ({
					kind: record.kind,
					parentOrganizationIds: record.parentOrganizationIds,
				})),
		).toEqual([
			{ kind: "AISLE", parentOrganizationIds: [placedBay.id] },
			{ kind: "AISLE", parentOrganizationIds: [placedBay.id] },
		]);

		expect(document.undo()).toBe(true);
		expect(document.getPatchSequence()).toBe(2);
		expect(document.map.edgeCount).toBe(0);
		expect(document.organizations.records).toEqual([]);
		expect(document.redo()).toBe(true);
		expect(document.getPatchSequence()).toBe(3);
		expect(document.map.edgeCount).toBe(placedEdgeCount);
		expect(documentChecksum(document)).toBe(placedChecksum);
		const redoneRecognition = recognizeProductionBayModule(
			document.map,
			document.organizations,
			placedBay.id,
		);
		expect(redoneRecognition.valid).toBe(true);
		if (!redoneRecognition.valid) throw new Error(redoneRecognition.reason);
		expect(redoneRecognition.recognition.authoredProjectionFingerprint).toBe(
			placedRecognition.recognition.authoredProjectionFingerprint,
		);
	});

	it("supports detached repeat placement with fresh identities and rejects overlap atomically", async () => {
		const document = new RailDocument();
		const artifact = certifyProductionBayModuleCatalogRequest(
			defaultProductionBayModuleCatalogRequest("single-production-bay"),
		);
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => new RuntimeWorker());

		await prepareAndCommit(bridge, document, artifact.organizationBundle, { x: 0, y: 0 });
		const firstOrganizationIds = document.organizations.records.map((record) => record.id);
		const firstEdgeCount = document.map.edgeCount;
		await prepareAndCommit(bridge, document, artifact.organizationBundle, { x: 120, y: 0 });

		expect(document.getPatchSequence()).toBe(2);
		expect(document.map.edgeCount).toBe(firstEdgeCount * 2);
		const secondOrganizationIds = document.organizations.records
			.slice(firstOrganizationIds.length)
			.map((record) => record.id);
		expect(secondOrganizationIds).toHaveLength(firstOrganizationIds.length);
		expect(secondOrganizationIds.every((id) => !firstOrganizationIds.includes(id))).toBe(true);

		const beforeCollisionChecksum = documentChecksum(document);
		const beforeCollisionSequence = document.getPatchSequence();
		const collision = await bridge.prepare(
			placementInput(document, artifact.organizationBundle, { x: 0, y: 0 }),
		);
		expect(collision.certified).toBe(false);
		expect(collision.validation.valid).toBe(false);
		expect(collision.validation.conflictCount).toBeGreaterThan(0);
		expect(document.getPatchSequence()).toBe(beforeCollisionSequence);
		expect(documentChecksum(document)).toBe(beforeCollisionChecksum);
	});
});

async function prepareAndCommit(
	bridge: StaticFabOrganizationBundlePlacementBridge,
	document: RailDocument,
	bundle: ReturnType<typeof certifyProductionBayModuleCatalogRequest>["organizationBundle"],
	anchor: Readonly<{ x: number; y: number }>,
): Promise<void> {
	const prepared = await bridge.prepare(placementInput(document, bundle, anchor));
	if (!prepared.plan || !prepared.certified) throw new Error(prepared.validation.reason);
	if (!document.commitStaticFabOrganizationBundle(prepared.plan)) {
		throw new Error(document.getLastCommandError() ?? "Production Bay commit failed");
	}
}

function placementInput(
	document: RailDocument,
	bundle: ReturnType<typeof certifyProductionBayModuleCatalogRequest>["organizationBundle"],
	anchor: Readonly<{ x: number; y: number }>,
): StaticFabOrganizationBundlePlacementInput {
	return {
		bundle,
		anchor,
		quarterTurns: 0,
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
}

function documentChecksum(document: RailDocument): string {
	return captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot.checksum;
}
