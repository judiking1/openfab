import { describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	planStaticFabAssemblyConnector,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorIntent,
} from "../core/StaticFabAssemblyConnector";
import { isIssuedStaticFabAssemblyConnectorPlan } from "../core/StaticFabAssemblyConnectorCertification";
import {
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementProspectiveState,
} from "../core/StaticFabOrganizationBundlePlacement";
import { staticFabBankPairHasResilientCirculation } from "../core/StaticFabOuterCirculation";
import { TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import {
	type PrepareBoundStaticFabAssemblyConnectorRequest,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
	type StaticFabAssemblyConnectorWorkerRequest,
	type StaticFabAssemblyConnectorWorkerResponse,
} from "../worker/StaticFabAssemblyConnectorProtocol";
import {
	hydrateStaticFabAssemblyConnectorSession,
	prepareStaticFabAssemblyConnectorInSession,
	type StaticFabAssemblyConnectorRuntimeSession,
} from "../worker/StaticFabAssemblyConnectorRuntime";
import {
	appliedConnectedBayBankEvidence,
	appliedConnectedBayBankEvidenceIsCurrent,
	connectedBayBankUndoProjectionExists,
} from "./OrdinaryConnectedBayBankDuplicateHandoff";
import {
	appliedConnectedFabEvidence,
	appliedConnectedFabEvidenceIsCurrent,
	connectedFabUndoProjectionExists,
} from "./OrdinaryConnectedFabLoopHandoff";
import {
	appliedResilientFabLoopEvidence,
	appliedResilientFabLoopEvidenceIsCurrent,
	resilientFabLoopUndoProjectionExists,
} from "./OrdinaryResilientFabChecksHandoff";
import {
	type StaticFabAssemblyConnectorBindingInput,
	StaticFabAssemblyConnectorBridge,
	type StaticFabAssemblyConnectorInput,
	type StaticFabAssemblyConnectorWorkerPort,
} from "./StaticFabAssemblyConnectorBridge";

class RuntimeWorker implements StaticFabAssemblyConnectorWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabAssemblyConnectorWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	receivedRequest: StaticFabAssemblyConnectorWorkerRequest | null = null;
	transferredBuffers = 0;
	maxTransferredBuffers = 0;
	receivedRequests: StaticFabAssemblyConnectorWorkerRequest[] = [];
	protected pendingRequest: StaticFabAssemblyConnectorWorkerRequest | null = null;
	protected session: StaticFabAssemblyConnectorRuntimeSession | null = null;

	postMessage(
		message: StaticFabAssemblyConnectorWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.transferredBuffers = transfer.length;
		this.maxTransferredBuffers = Math.max(this.maxTransferredBuffers, transfer.length);
		this.pendingRequest = structuredClone(message, { transfer });
		this.receivedRequest = this.pendingRequest;
		this.receivedRequests.push(this.pendingRequest);
		this.scheduleResponse(this.pendingRequest);
	}

	terminate(): void {
		this.terminated = true;
	}

	protected scheduleResponse(request: StaticFabAssemblyConnectorWorkerRequest): void {
		void request;
		queueMicrotask(() => this.respond());
	}

	protected transformResponse(
		response: StaticFabAssemblyConnectorWorkerResponse,
	): StaticFabAssemblyConnectorWorkerResponse {
		return response;
	}

	protected respond(): void {
		if (this.terminated || !this.pendingRequest) return;
		const request = this.pendingRequest;
		if (request.type === "HYDRATE_STATIC_FAB_ASSEMBLY_CONNECTOR") {
			this.session = hydrateStaticFabAssemblyConnectorSession(request.snapshot);
			const snapshot = this.session.snapshot;
			this.onmessage?.({
				data: {
					type: "STATIC_FAB_ASSEMBLY_CONNECTOR_HYDRATED",
					version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
					requestId: request.requestId,
					sourceRevision: snapshot.revision,
					sourcePatchSequence: snapshot.sequence,
					sourceChecksum: snapshot.checksum,
					sourceNextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
					sourceNextPortId: snapshot.portEquipment.nextPortId,
					sourceNextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
					sourceNextOrganizationId: snapshot.organizations.nextOrganizationId,
					hydrationMilliseconds: 1,
				},
			} as MessageEvent<StaticFabAssemblyConnectorWorkerResponse>);
			return;
		}
		if (!this.session) throw new Error("Test Worker was not hydrated.");
		const response = this.transformResponse({
			type: "STATIC_FAB_ASSEMBLY_CONNECTOR_PREPARED",
			version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
			requestId: request.requestId,
			prepared: prepareStaticFabAssemblyConnectorInSession(
				request as PrepareBoundStaticFabAssemblyConnectorRequest,
				this.session,
			),
		});
		this.onmessage?.({
			data: structuredClone(response),
		} as MessageEvent<StaticFabAssemblyConnectorWorkerResponse>);
	}
}

class ManualRuntimeWorker extends RuntimeWorker {
	protected override scheduleResponse(request: StaticFabAssemblyConnectorWorkerRequest): void {
		if (request.type === "HYDRATE_STATIC_FAB_ASSEMBLY_CONNECTOR") super.scheduleResponse(request);
	}

	deliver(): void {
		super.respond();
	}
}

class MalformedWorker extends RuntimeWorker {
	protected override transformResponse(
		response: StaticFabAssemblyConnectorWorkerResponse,
	): StaticFabAssemblyConnectorWorkerResponse {
		if (response.type !== "STATIC_FAB_ASSEMBLY_CONNECTOR_PREPARED") return response;
		return {
			...response,
			prepared: { ...response.prepared, conflictCount: 0.5 },
		};
	}
}

describe("StaticFabAssemblyConnectorBridge", () => {
	it("hydrates one persistent Worker and commits rail plus hierarchy as one replay-safe event", async () => {
		const document = productionBayDocument();
		const mirrorSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const mirror = new RailPatchMirror();
		mirror.sync(mirrorSnapshot);
		const sourceSequence = document.getPatchSequence();
		const sourceRailChecksum = checksumRailMap(document.map);
		const sourceOrganizations = document.organizations.records;
		const worker = new RuntimeWorker();
		const bridge = new StaticFabAssemblyConnectorBridge(() => worker);
		const events: RailPatchEvent[] = [];
		const unsubscribe = document.subscribe((event) => events.push(event));

		await bridge.initialize(connectorBindingInput(document));
		const prepared = await bridge.prepare(connectorInput(document));

		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		expect(prepared.certified).toBe(true);
		expect(prepared.plan).not.toBeNull();
		expect(worker.receivedRequests.map((request) => request.type)).toEqual([
			"HYDRATE_STATIC_FAB_ASSEMBLY_CONNECTOR",
			"PREPARE_STATIC_FAB_ASSEMBLY_CONNECTOR",
		]);
		expect(worker.receivedRequest).not.toHaveProperty("snapshot");
		expect(worker.receivedRequest).not.toHaveProperty("plan");
		expect(worker.maxTransferredBuffers).toBeGreaterThan(0);
		expect(worker.transferredBuffers).toBe(0);
		expect(worker.terminated).toBe(false);
		if (!prepared.plan) throw new Error("Expected one adopted Assembly Connector plan.");
		expect(isIssuedStaticFabAssemblyConnectorPlan(prepared.plan)).toBe(true);

		const foreign = RailDocument.fromLoadedMap(
			document.map.clone(),
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		);
		expect(foreign.commitStaticFabAssemblyConnector(prepared.plan)).toBe(false);
		expect(isIssuedStaticFabAssemblyConnectorPlan(prepared.plan)).toBe(true);

		expect(
			document.commitStaticFabAssemblyConnector(prepared.plan),
			document.getLastCommandError() ?? "Assembly Connector commit failed",
		).toBe(true);
		expect(isIssuedStaticFabAssemblyConnectorPlan(prepared.plan)).toBe(false);
		expect(document.commitStaticFabAssemblyConnector(prepared.plan)).toBe(false);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			sequence: sourceSequence + 1,
			kind: STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
			baseRevision: prepared.plan.baseRevision,
			changes: prepared.plan.mutations,
			organizationChanges: prepared.plan.organizationMutations,
			organizationNextIdBefore: prepared.plan.nextOrganizationIdBefore,
			organizationNextIdAfter: prepared.plan.nextOrganizationIdAfter,
		});
		expect(events[0]?.changes.length).toBeGreaterThan(0);
		expect(events[0]?.organizationChanges.length).toBeGreaterThan(0);
		expect(events[0]?.switchChanges).toEqual([]);
		expect(events[0]?.portChanges).toEqual([]);
		expect(events[0]?.equipmentGroupChanges).toEqual([]);
		expect(mirror.applyPatch(events[0] as RailPatchEvent).checksum).toBe(
			documentChecksum(document),
		);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
		});
		const connectedChecksum = documentChecksum(document);

		expect(document.undo()).toBe(true);
		expect(events).toHaveLength(2);
		expect(events[1]?.kind).toBe("undo");
		expect(checksumRailMap(document.map)).toBe(sourceRailChecksum);
		expect(document.organizations.records).toEqual(sourceOrganizations);
		expect(document.canRedo).toBe(true);
		expect(mirror.applyPatch(events[1] as RailPatchEvent).checksum).toBe(
			documentChecksum(document),
		);

		expect(document.redo()).toBe(true);
		expect(events).toHaveLength(3);
		expect(events[2]?.kind).toBe("redo");
		expect(documentChecksum(document)).toBe(connectedChecksum);
		expect(document.canRedo).toBe(false);
		expect(mirror.applyPatch(events[2] as RailPatchEvent).checksum).toBe(connectedChecksum);
		expect(mirror.getPhysicalPublication().current.identity.revision).toBe(
			document.map.getRevision(),
		);
		unsubscribe();
		bridge.dispose();
		expect(worker.terminated).toBe(true);
	});

	it("binds an attached/detached Bank extension to an exact real plan through undo and redo", async () => {
		const document = productionBayDocument(3);
		const bayIds = document.organizations.records
			.filter((record) => record.kind === "BAY")
			.map((record) => record.id);
		const [firstBayId, attachedBayId, detachedBayId] = bayIds;
		if (firstBayId === undefined || attachedBayId === undefined || detachedBayId === undefined) {
			throw new Error("Expected three Production Bay fixtures.");
		}
		const firstBridge = new StaticFabAssemblyConnectorBridge(() => new RuntimeWorker());
		await firstBridge.initialize(connectorBindingInput(document));
		const firstPrepared = await firstBridge.prepare({
			intent: firstValidIntentFor(document, firstBayId, attachedBayId),
		});
		if (!firstPrepared.plan) throw new Error("Expected initial Bank Connector plan.");
		expect(firstPrepared.plan.assemblyConnector.createdBank).toBe(true);
		expect(document.commitStaticFabAssemblyConnector(firstPrepared.plan)).toBe(true);
		firstBridge.dispose();

		const organizationsBeforeExtend = document.organizations;
		const organizationCursorBeforeExtend = organizationsBeforeExtend.nextOrganizationId;
		const extendBridge = new StaticFabAssemblyConnectorBridge(() => new RuntimeWorker());
		await extendBridge.initialize(connectorBindingInput(document));
		const extendPrepared = await extendBridge.prepare({
			intent: firstValidIntentFor(document, attachedBayId, detachedBayId),
		});
		if (!extendPrepared.plan) throw new Error("Expected Bank extension Connector plan.");
		expect(extendPrepared.plan.assemblyConnector).toMatchObject({
			createdBank: false,
			sourceOrganizationId: attachedBayId,
			targetOrganizationId: detachedBayId,
		});
		expect(extendPrepared.plan.nextOrganizationIdAfter).toBe(organizationCursorBeforeExtend);
		const evidence = appliedConnectedBayBankEvidence(
			extendPrepared.plan,
			organizationsBeforeExtend,
		);
		expect(evidence).not.toBeNull();
		if (!evidence) throw new Error("Expected exact Bank extension evidence.");
		expect(evidence.connectedTwinBayParentOrganizationIdsBefore).toEqual([
			[evidence.bankOrganizationId],
			[],
		]);

		expect(document.commitStaticFabAssemblyConnector(extendPrepared.plan)).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(organizationCursorBeforeExtend);
		expect(appliedConnectedBayBankEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		const extendedChecksum = documentChecksum(document);

		expect(document.undo()).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(organizationCursorBeforeExtend);
		expect(connectedBayBankUndoProjectionExists(document.organizations, evidence)).toBe(true);
		expect(appliedConnectedBayBankEvidenceIsCurrent(document.organizations, evidence)).toBe(false);

		expect(document.redo()).toBe(true);
		expect(documentChecksum(document)).toBe(extendedChecksum);
		expect(document.organizations.nextOrganizationId).toBe(organizationCursorBeforeExtend);
		expect(appliedConnectedBayBankEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		extendBridge.dispose();
	});

	it("binds one newly created Fab receipt to an exact real Worker plan through undo and redo", async () => {
		const document = productionBayDocument(4);
		const bayIds = document.organizations.records
			.filter((record) => record.kind === "BAY")
			.map((record) => record.id);
		if (bayIds.length !== 4) throw new Error("Expected four Production Bay fixtures.");
		const connectBays = async (sourceId: number, targetId: number) => {
			const bridge = new StaticFabAssemblyConnectorBridge(() => new RuntimeWorker());
			await bridge.initialize(connectorBindingInput(document));
			const prepared = await bridge.prepare({
				intent: firstValidIntentFor(document, sourceId, targetId),
			});
			if (!prepared.plan) throw new Error("Expected an exact Bay Connector plan.");
			expect(document.commitStaticFabAssemblyConnector(prepared.plan)).toBe(true);
			bridge.dispose();
		};

		await connectBays(bayIds[0] as number, bayIds[1] as number);
		await connectBays(bayIds[2] as number, bayIds[3] as number);
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const bankIds = document.organizations.records
			.filter((record) => roles.get(record.id) === "BAY_BANK")
			.map((record) => record.id);
		expect(bankIds).toHaveLength(2);
		const organizationsBeforeFabApply = document.organizations;
		const cursorBeforeFabApply = organizationsBeforeFabApply.nextOrganizationId;
		const fabBridge = new StaticFabAssemblyConnectorBridge(() => new RuntimeWorker());
		await fabBridge.initialize(connectorBindingInput(document));
		const prepared = await fabBridge.prepare({
			intent: firstValidIntentFor(document, bankIds[0] as number, bankIds[1] as number),
		});
		if (!prepared.plan) throw new Error("Expected one exact new-Fab Connector plan.");
		expect(prepared.plan.assemblyConnector).toMatchObject({
			hierarchyRole: "BANK_TO_FAB",
			purpose: "HIERARCHY_LINK",
			fabOrganizationId: cursorBeforeFabApply,
			createdFab: true,
		});
		const evidence = appliedConnectedFabEvidence(prepared.plan, organizationsBeforeFabApply);
		expect(evidence).toMatchObject({
			fabOrganizationId: cursorBeforeFabApply,
			connectedBayBankOrganizationIds: [...bankIds].sort((left, right) => left - right),
			createdFab: true,
		});
		if (!evidence) throw new Error("Expected exact newly created Fab evidence.");

		expect(document.commitStaticFabAssemblyConnector(prepared.plan)).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(appliedConnectedFabEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		const connectedChecksum = documentChecksum(document);
		expect(document.undo()).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(connectedFabUndoProjectionExists(document.organizations, evidence)).toBe(true);
		expect(document.redo()).toBe(true);
		expect(documentChecksum(document)).toBe(connectedChecksum);
		expect(appliedConnectedFabEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		fabBridge.dispose();

		const organizationsBeforeLoop = document.organizations;
		const mapBeforeLoop = document.map.clone();
		const loopBridge = new StaticFabAssemblyConnectorBridge(() => new RuntimeWorker());
		await loopBridge.initialize(connectorBindingInput(document));
		const loopPrepared = await loopBridge.prepare({
			intent: firstValidFabLoopIntentFor(
				document,
				evidence.fabOrganizationId,
				bankIds[0] as number,
				bankIds[1] as number,
			),
		});
		if (!loopPrepared.plan) throw new Error("Expected one exact Fab Loop plan.");
		expect(loopPrepared.plan.assemblyConnector).toMatchObject({
			hierarchyRole: "BANK_TO_FAB",
			purpose: "FAB_LOOP",
			fabOrganizationId: evidence.fabOrganizationId,
			createdFab: false,
		});
		const loopEvidence = appliedResilientFabLoopEvidence(
			loopPrepared.plan,
			mapBeforeLoop,
			organizationsBeforeLoop,
		);
		expect(loopEvidence).not.toBeNull();
		if (!loopEvidence) throw new Error("Expected exact resilient Fab Loop evidence.");
		expect(loopEvidence.connectedBayBankOrganizationIds).toEqual(
			[...bankIds].sort((left, right) => left - right),
		);

		expect(document.commitStaticFabAssemblyConnector(loopPrepared.plan)).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(document.map, document.organizations, loopEvidence),
		).toBe(true);
		expect(
			staticFabBankPairHasResilientCirculation(
				document.organizations,
				loopEvidence.fabOrganizationId,
				loopEvidence.connectedBayBankOrganizationIds[0],
				loopEvidence.connectedBayBankOrganizationIds[1],
			),
		).toBe(true);
		const loopChecksum = documentChecksum(document);

		expect(document.undo()).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(
			resilientFabLoopUndoProjectionExists(document.map, document.organizations, loopEvidence),
		).toBe(true);
		expect(document.redo()).toBe(true);
		expect(documentChecksum(document)).toBe(loopChecksum);
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(document.map, document.organizations, loopEvidence),
		).toBe(true);
		loopBridge.dispose();
	});

	it("does not certify a Worker result after its live document becomes stale", async () => {
		const document = productionBayDocument();
		const worker = new ManualRuntimeWorker();
		const bridge = new StaticFabAssemblyConnectorBridge(() => worker);
		await bridge.initialize(connectorBindingInput(document));
		const planning = bridge.prepare(connectorInput(document));

		expect(document.clear()).toBe(true);
		worker.deliver();
		const prepared = await planning;

		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		expect(prepared.certified).toBe(false);
		if (!prepared.plan) throw new Error("Expected the stale Worker plan for inspection.");
		expect(isIssuedStaticFabAssemblyConnectorPlan(prepared.plan)).toBe(false);
		expect(document.commitStaticFabAssemblyConnector(prepared.plan)).toBe(false);
	});

	it("cancels an in-flight persistent Worker and revokes its adoption permit", async () => {
		const document = productionBayDocument();
		const worker = new ManualRuntimeWorker();
		const bridge = new StaticFabAssemblyConnectorBridge(() => worker);
		await bridge.initialize(connectorBindingInput(document));
		const planning = bridge.prepare(connectorInput(document));

		bridge.cancel();

		await expect(planning).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
	});

	it("keeps one Worker alive and coalesces rapid intents to the latest queued request", async () => {
		const document = productionBayDocument();
		const worker = new ManualRuntimeWorker();
		const bridge = new StaticFabAssemblyConnectorBridge(() => worker);
		await bridge.initialize(connectorBindingInput(document));
		const intent = firstValidIntent(document);
		const first = bridge.prepare({ intent });
		const second = bridge.prepare({ intent: { ...intent, side: "right" } });
		const latest = bridge.prepare({ intent: { ...intent, side: "left" } });

		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		expect(
			worker.receivedRequests.filter((request) => request.type.startsWith("PREPARE")),
		).toHaveLength(1);
		worker.deliver();
		expect(
			worker.receivedRequests.filter((request) => request.type.startsWith("PREPARE")),
		).toHaveLength(2);
		worker.deliver();
		const prepared = await latest;

		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		expect(prepared.certified).toBe(true);
		expect(worker.terminated).toBe(false);
		expect(
			worker.receivedRequests.filter((request) => request.type.startsWith("PREPARE")),
		).toHaveLength(2);
		bridge.dispose();
	});

	it("rejects malformed Worker diagnostics before plan adoption", async () => {
		const document = productionBayDocument();
		const worker = new MalformedWorker();
		const bridge = new StaticFabAssemblyConnectorBridge(() => worker);
		await bridge.initialize(connectorBindingInput(document));

		await expect(bridge.prepare(connectorInput(document))).rejects.toThrow(
			"malformed planning data",
		);
		expect(worker.terminated).toBe(true);
		await expect(bridge.prepare(connectorInput(document))).rejects.toThrow(
			"malformed planning data",
		);
	});
});

interface ProductionBayFixture extends StaticFabOrganizationBundlePlacementProspectiveState {
	readonly patchSequence: number;
}

function productionBayDocument(count = 2): RailDocument {
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest("single-production-bay"),
	);
	let fixture: ProductionBayFixture = {
		map: new TileMap(),
		portEquipment: emptyPortEquipmentState(),
		organizations: emptyStaticFabOrganizationState(),
		patchSequence: 0,
	};
	for (const anchor of Array.from({ length: count }, (_, index) => ({ x: index * 100, y: 0 }))) {
		const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			artifact.organizationBundle,
			anchor,
			0,
			null,
		);
		if (!placement.plan.valid || !placement.prospectiveState) {
			throw new Error(placement.plan.reason);
		}
		fixture = {
			...placement.prospectiveState,
			patchSequence: fixture.patchSequence + 1,
		};
	}
	return RailDocument.fromLoadedMap(
		fixture.map,
		fixture.patchSequence,
		fixture.portEquipment,
		fixture.organizations,
	);
}

function connectorBindingInput(document: RailDocument): StaticFabAssemblyConnectorBindingInput {
	return {
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

function connectorInput(document: RailDocument): StaticFabAssemblyConnectorInput {
	return { intent: firstValidIntent(document) };
}

function firstValidIntent(document: RailDocument): StaticFabAssemblyConnectorIntent {
	const bays = document.organizations.records.filter((record) => record.kind === "BAY");
	const sourceBay = bays[0];
	const targetBay = bays[1];
	if (!sourceBay || !targetBay) throw new Error("Expected two public Production Bay fixtures.");
	return firstValidIntentFor(document, sourceBay.id, targetBay.id);
}

function firstValidIntentFor(
	document: RailDocument,
	sourceOrganizationId: number,
	targetOrganizationId: number,
): StaticFabAssemblyConnectorIntent {
	const sourceBay = document.organizations.records.find(
		(record) => record.id === sourceOrganizationId,
	);
	const targetBay = document.organizations.records.find(
		(record) => record.id === targetOrganizationId,
	);
	if (!sourceBay || !targetBay) throw new Error("Expected exact Production Bay fixtures.");
	const sources = discoverStaticFabAssemblyGateways(
		document.map,
		document.organizations,
		sourceBay.id,
	);
	const targets = discoverStaticFabAssemblyGateways(
		document.map,
		document.organizations,
		targetBay.id,
	);
	let lastReason = "No Assembly Connector gateway pair was found.";
	for (const source of sources) {
		for (const target of targets) {
			const intent = Object.freeze({
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: sourceBay.id,
				sourceGatewayId: source.id,
				sourceAnchor: source.anchor,
				targetOrganizationId: targetBay.id,
				targetGatewayId: target.id,
				targetAnchor: target.anchor,
				side: null,
			}) satisfies StaticFabAssemblyConnectorIntent;
			const plan = planStaticFabAssemblyConnector(
				document.map,
				document.portEquipment,
				document.getPatchSequence(),
				document.organizations,
				intent,
			);
			if (plan.valid) return intent;
			lastReason = plan.reason;
		}
	}
	throw new Error(lastReason);
}

function firstValidFabLoopIntentFor(
	document: RailDocument,
	fabOrganizationId: number,
	sourceBankOrganizationId: number,
	targetBankOrganizationId: number,
): StaticFabAssemblyConnectorIntent {
	const sources = discoverStaticFabOuterCirculationGateways(
		document.map,
		document.organizations,
		sourceBankOrganizationId,
	);
	const targets = discoverStaticFabOuterCirculationGateways(
		document.map,
		document.organizations,
		targetBankOrganizationId,
	);
	let lastReason = "No Fab Loop gateway pair was found.";
	for (const source of sources) {
		for (const target of targets) {
			const intent = Object.freeze({
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "FAB_LOOP",
				sourceOrganizationId: sourceBankOrganizationId,
				sourceGatewayId: source.id,
				sourceAnchor: source.anchor,
				targetOrganizationId: targetBankOrganizationId,
				targetGatewayId: target.id,
				targetAnchor: target.anchor,
				side: null,
			}) satisfies StaticFabAssemblyConnectorIntent;
			const plan = planStaticFabAssemblyConnector(
				document.map,
				document.portEquipment,
				document.getPatchSequence(),
				document.organizations,
				intent,
			);
			if (plan.valid && plan.assemblyConnector.fabOrganizationId === fabOrganizationId)
				return intent;
			lastReason = plan.reason;
		}
	}
	throw new Error(lastReason);
}

function documentChecksum(document: RailDocument): string {
	return checksumRailMap(document.map, document.portEquipment, document.organizations);
}
