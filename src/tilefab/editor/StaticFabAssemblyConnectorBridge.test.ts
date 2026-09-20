import { describe, expect, it, vi } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import {
	RailDocument,
	type RailDocumentCooperativeCommitOptions,
	type RailPatchEvent,
} from "../core/RailDocument";
import {
	discoverStaticFabAssemblyGateways,
	discoverStaticFabOuterCirculationGateways,
	planStaticFabAssemblyConnector,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorIntent,
	type StaticFabAssemblyConnectorPlan,
} from "../core/StaticFabAssemblyConnector";
import {
	adoptStaticFabAssemblyConnectorWorkerPlanCooperatively,
	consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor,
	isIssuedStaticFabAssemblyConnectorPlan,
	issueStaticFabAssemblyConnectorPermit,
	revokeStaticFabAssemblyConnectorPermit,
	staticFabAssemblyConnectorIntentFingerprint,
	staticFabAssemblyConnectorPlanFingerprint,
} from "../core/StaticFabAssemblyConnectorCertification";
import { emptyStaticFabAssemblyRelationshipState } from "../core/StaticFabAssemblyRelationship";
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
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import {
	type PrepareBoundStaticFabAssemblyConnectorRequest,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
	type StaticFabAssemblyConnectorWorkerRequest,
	type StaticFabAssemblyConnectorWorkerResponse,
} from "../worker/StaticFabAssemblyConnectorProtocol";
import {
	hydrateStaticFabAssemblyConnectorSession,
	prepareStaticFabAssemblyConnector,
	prepareStaticFabAssemblyConnectorInSession,
	type StaticFabAssemblyConnectorRuntimeSession,
} from "../worker/StaticFabAssemblyConnectorRuntime";
import { hydrateStaticFabAssemblyRelationshipSnapshot } from "../worker/StaticFabAssemblyRelationshipSoA";
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
					sourceNextRelationshipId: snapshot.relationships.nextRelationshipId,
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

describe.each([
	"sync",
	"cooperative",
] as const)("StaticFabAssemblyConnectorBridge (%s document)", (mode) => {
	const commit = async (document: RailDocument, plan: StaticFabAssemblyConnectorPlan) =>
		mode === "sync"
			? document.commitStaticFabAssemblyConnector(plan)
			: (
					await document.commitStaticFabAssemblyConnectorCooperatively(
						plan,
						documentTestScheduler(),
					)
				).committed;
	const replay = async (document: RailDocument, direction: "undo" | "redo") =>
		mode === "sync"
			? document[direction]()
			: (
					await document.replayStaticFabAssemblyConnectorCooperatively(
						direction,
						documentTestScheduler(),
					)
				).committed;
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
		expect(await commit(foreign, prepared.plan)).toBe(false);
		expect(isIssuedStaticFabAssemblyConnectorPlan(prepared.plan)).toBe(true);

		expect(
			await commit(document, prepared.plan),
			document.getLastCommandError() ?? "Assembly Connector commit failed",
		).toBe(true);
		expect(isIssuedStaticFabAssemblyConnectorPlan(prepared.plan)).toBe(false);
		expect(await commit(document, prepared.plan)).toBe(false);
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
		expect(document.relationships.records).toHaveLength(1);
		expect(document.relationships.nextRelationshipId).toBe(2);
		expect(events[0]?.relationshipChanges).toEqual(prepared.plan.relationshipProduction?.mutations);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[0] as RailPatchEvent).patch))
				.checksum,
		).toBe(documentChecksum(document));
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
		});
		const connectedChecksum = documentChecksum(document);

		expect(await replay(document, "undo")).toBe(true);
		expect(events).toHaveLength(2);
		expect(events[1]?.kind).toBe("undo");
		expect(checksumRailMap(document.map)).toBe(sourceRailChecksum);
		expect(document.organizations.records).toEqual(sourceOrganizations);
		expect(document.relationships.records).toEqual([]);
		expect(document.relationships.nextRelationshipId).toBe(2);
		expect(document.canRedo).toBe(true);
		expect(mirror.applyPatch(events[1] as RailPatchEvent).checksum).toBe(
			documentChecksum(document),
		);

		expect(await replay(document, "redo")).toBe(true);
		expect(events).toHaveLength(3);
		expect(events[2]?.kind).toBe("redo");
		expect(documentChecksum(document)).toBe(connectedChecksum);
		expect(document.canRedo).toBe(false);
		expect(mirror.applyPatch(events[2] as RailPatchEvent).checksum).toBe(connectedChecksum);
		expect(mirror.getPhysicalPublication().current.identity.revision).toBe(
			document.map.getRevision(),
		);
		const project = captureOpenFabProject(document, {
			manifest: createOpenFabProjectManifest(
				"connector-production",
				"Explicit Connector",
				"2026-09-13T00:00:00.000Z",
			),
		});
		const reopened = createRailSnapshotFromOpenFabProject(
			parseOpenFabProjectJson(serializeOpenFabProject(project)).project,
		);
		expect(reopened.checksum).toBe(connectedChecksum);
		expect(hydrateStaticFabAssemblyRelationshipSnapshot(reopened.relationships)).toEqual(
			document.relationships,
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
		expect(await commit(document, firstPrepared.plan)).toBe(true);
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

		expect(await commit(document, extendPrepared.plan)).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(organizationCursorBeforeExtend);
		expect(appliedConnectedBayBankEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		const extendedChecksum = documentChecksum(document);

		expect(await replay(document, "undo")).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(organizationCursorBeforeExtend);
		expect(connectedBayBankUndoProjectionExists(document.organizations, evidence)).toBe(true);
		expect(appliedConnectedBayBankEvidenceIsCurrent(document.organizations, evidence)).toBe(false);

		expect(await replay(document, "redo")).toBe(true);
		expect(documentChecksum(document)).toBe(extendedChecksum);
		expect(document.organizations.nextOrganizationId).toBe(organizationCursorBeforeExtend);
		expect(appliedConnectedBayBankEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		extendBridge.dispose();
	});

	it("binds one newly created Fab receipt to an exact real Worker plan through undo and redo", async () => {
		const document = productionBayDocument(4);
		const mirror = new RailPatchMirror();
		mirror.sync(connectorBindingInput(document).snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			expect(
				mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(event).patch)).checksum,
			).toBe(documentChecksum(document));
		});
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
			expect(await commit(document, prepared.plan)).toBe(true);
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

		expect(await commit(document, prepared.plan)).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(appliedConnectedFabEvidenceIsCurrent(document.organizations, evidence)).toBe(true);
		const connectedChecksum = documentChecksum(document);
		expect(await replay(document, "undo")).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(connectedFabUndoProjectionExists(document.organizations, evidence)).toBe(true);
		expect(await replay(document, "redo")).toBe(true);
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

		expect(await commit(document, loopPrepared.plan)).toBe(true);
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

		expect(await replay(document, "undo")).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(cursorBeforeFabApply + 1);
		expect(
			resilientFabLoopUndoProjectionExists(document.map, document.organizations, loopEvidence),
		).toBe(true);
		expect(await replay(document, "redo")).toBe(true);
		expect(documentChecksum(document)).toBe(loopChecksum);
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(document.map, document.organizations, loopEvidence),
		).toBe(true);
		expect(document.relationships.records).toHaveLength(4);
		expect(document.relationships.nextRelationshipId).toBe(5);
		expect(events).toHaveLength(8);
		const project = captureOpenFabProject(document, {
			manifest: createOpenFabProjectManifest(
				"nested-connectors",
				"Nested connectors",
				"2026-09-20T00:00:00.000Z",
			),
		});
		const reopened = createRailSnapshotFromOpenFabProject(
			parseOpenFabProjectJson(serializeOpenFabProject(project)).project,
		);
		expect(reopened.checksum).toBe(loopChecksum);
		expect(hydrateStaticFabAssemblyRelationshipSnapshot(reopened.relationships)).toEqual(
			document.relationships,
		);
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
		await expect(planning).rejects.toThrow(/source changed/);
		expect(worker.terminated).toBe(true);
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
		relationships: emptyStaticFabAssemblyRelationshipState(),
		patchSequence: 0,
	};
	for (const anchor of Array.from({ length: count }, (_, index) => ({ x: index * 100, y: 0 }))) {
		const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			fixture.map,
			fixture.portEquipment,
			fixture.patchSequence,
			fixture.organizations,
			fixture.relationships,
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
	return checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
}

describe("cooperative Connector relationship admission", () => {
	it("owns the Worker plan and consumes its relationship-bound authority only once", async () => {
		const proof = connectorAdoptionProof();
		const before = documentChecksum(proof.document);
		let checkpoints = 0;
		const adopted = await adoptConnectorProof(proof, async () => {
			checkpoints++;
		});
		expect(checkpoints).toBeGreaterThan(20);
		expect(adopted).not.toBe(proof.plan);
		expect(adopted.relationshipProduction).not.toBe(proof.plan.relationshipProduction);
		expect(staticFabAssemblyConnectorPlanFingerprint(adopted)).toBe(proof.ticket.planFingerprint);
		const legs = adopted.relationshipProduction?.mutations[0]?.after?.connectionGroups[0]?.legs;
		expect(legs?.length).toBeGreaterThan(0);
		expect(Object.isFrozen(legs)).toBe(true);
		expect(documentChecksum(proof.document)).toBe(before);
		expect(isIssuedStaticFabAssemblyConnectorPlan(proof.plan)).toBe(false);
		const consume = () =>
			consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor(
				adopted,
				proof.document.map,
				proof.document.portEquipment,
				proof.document.organizations,
				proof.document.relationships,
			);
		expect(consume()).toBe(true);
		expect(consume()).toBe(false);
		await expect(adoptConnectorProof(proof, async () => {})).rejects.toThrow(/consumed/);
	});

	it("revokes admission at the first, middle and final checkpoint without changing the document", async () => {
		const baseline = connectorAdoptionProof();
		let total = 0;
		await adoptConnectorProof(baseline, async () => {
			total++;
		});
		for (const stop of [1, Math.floor(total / 2), total]) {
			const proof = connectorAdoptionProof();
			const before = documentChecksum(proof.document);
			let visited = 0;
			await expect(
				adoptConnectorProof(proof, async () => {
					if (++visited === stop) revokeStaticFabAssemblyConnectorPermit(proof.permit);
				}),
			).rejects.toThrow(/cancelled/);
			expect(documentChecksum(proof.document)).toBe(before);
			expect(proof.document.relationships.records).toHaveLength(0);
			await expect(adoptConnectorProof(proof, async () => {})).rejects.toThrow(/consumed/);
		}
	});

	it("rejects restored-revision ABA during admission and before authority consumption", async () => {
		const rollback = (document: RailDocument) => {
			const map = document.map,
				revision = map.getRevision(),
				checkpoint = map.createMutationCheckpoint();
			const cell = document.organizations.records[0]?.membership.railEdges[0]?.from;
			if (!cell) throw new Error("Missing source rail");
			const change = { x: -99, y: -99, before: 0, after: map.getEncoded(cell.x, cell.y) };
			map.applyAtomicMutations([change], []);
			map.rollbackAtomicMutations([change], [], checkpoint);
			expect(map.getRevision()).toBe(revision);
		};
		const proof = connectorAdoptionProof();
		let first = true;
		await expect(
			adoptConnectorProof(proof, async () => {
				if (first) {
					first = false;
					rollback(proof.document);
				}
			}),
		).rejects.toThrow(/source changed/);
		const later = connectorAdoptionProof();
		const adopted = await adoptConnectorProof(later, async () => {});
		rollback(later.document);
		expect(
			consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor(
				adopted,
				later.document.map,
				later.document.portEquipment,
				later.document.organizations,
				later.document.relationships,
			),
		).toBe(false);
	});

	it.each([
		"cursor",
		"fingerprint",
		"relationship",
	] as const)("rejects a forged %s result", async (fault) => {
		const proof = connectorAdoptionProof();
		const corrupted = {
			...proof,
			ticket: {
				...proof.ticket,
				...(fault === "cursor"
					? { prospectiveNextRelationshipId: proof.ticket.prospectiveNextRelationshipId + 1 }
					: {}),
				...(fault === "fingerprint" ? { planFingerprint: "forged" } : {}),
			},
			plan: fault === "relationship" ? { ...proof.plan, relationshipProduction: null } : proof.plan,
		};
		await expect(adoptConnectorProof(corrupted, async () => {})).rejects.toThrow();
		expect(proof.document.relationships.records).toHaveLength(0);
		await expect(adoptConnectorProof(proof, async () => {})).rejects.toThrow(/consumed/);
	});
});

describe("Connector response suspension ownership", () => {
	it.each([
		"cancel",
		"supersede",
		"duplicate",
		"source ABA",
	] as const)("revokes the old response on %s during admission", async (action) => {
		const document = productionBayDocument(),
			checksum = documentChecksum(document);
		const worker = new RuntimeWorker();
		let entered!: () => void, resume!: () => void;
		const suspended = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const released = new Promise<void>((resolve) => {
			resume = resolve;
		});
		let first = true,
			time = 0;
		const clock = vi.spyOn(performance, "now").mockImplementation(() => ++time);
		const bridge = new StaticFabAssemblyConnectorBridge(
			() => worker,
			30_000,
			async () => {
				if (!first) return;
				first = false;
				entered();
				await released;
			},
		);
		try {
			await bridge.initialize(connectorBindingInput(document));
			const input = connectorInput(document);
			const pending = bridge.prepare(input);
			const rejected = expect(pending).rejects.toThrow(
				action === "duplicate"
					? /duplicate/
					: action === "source ABA"
						? /source changed/
						: /cancel|superseded/i,
			);
			await suspended;
			let latest: ReturnType<StaticFabAssemblyConnectorBridge["prepare"]> | null = null;
			if (action === "cancel") bridge.cancel();
			if (action === "supersede") latest = bridge.prepare(input);
			if (action === "source ABA") rollbackSourceMutation(document);
			if (action === "duplicate") {
				const request = worker.receivedRequest;
				if (!request) throw new Error("Missing response identity");
				worker.onmessage?.({
					data: {
						type: "STATIC_FAB_ASSEMBLY_CONNECTOR_PREPARED",
						version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
						requestId: request.requestId,
					},
				} as MessageEvent<StaticFabAssemblyConnectorWorkerResponse>);
			}
			resume();
			await rejected;
			if (latest) {
				const accepted = await latest;
				expect(accepted.certified).toBe(true);
				expect(worker.terminated).toBe(false);
				expect(
					worker.receivedRequests.filter((request) => request.type.startsWith("PREPARE")),
				).toHaveLength(2);
			} else expect(worker.terminated).toBe(true);
			expect(documentChecksum(document)).toBe(checksum);
			expect(document.relationships.records).toEqual([]);
		} finally {
			resume();
			bridge.dispose();
			clock.mockRestore();
		}
	});
});

describe("atomic cooperative Connector publication", () => {
	it.each([
		"apply",
		"undo",
		"redo",
	] as const)("cancels %s at early, middle and final preparation without publishing", async (operation) => {
		const fixture = async () => {
			const proof = connectorAdoptionProof();
			const plan = await adoptConnectorProof(proof, async () => {});
			if (operation !== "apply")
				expect(
					(
						await proof.document.commitStaticFabAssemblyConnectorCooperatively(
							plan,
							documentTestScheduler(),
						)
					).committed,
				).toBe(true);
			if (operation === "redo")
				expect(
					(
						await proof.document.replayStaticFabAssemblyConnectorCooperatively(
							"undo",
							documentTestScheduler(),
						)
					).committed,
				).toBe(true);
			const run = (options: RailDocumentCooperativeCommitOptions) =>
				operation === "apply"
					? proof.document.commitStaticFabAssemblyConnectorCooperatively(plan, options)
					: proof.document.replayStaticFabAssemblyConnectorCooperatively(operation, options);
			return { document: proof.document, run };
		};
		const baseline = await fixture();
		let total = 0;
		expect(
			(
				await baseline.run(
					documentTestScheduler(async () => {
						total++;
					}),
				)
			).committed,
		).toBe(true);
		expect(total).toBeGreaterThan(10);
		for (const stop of [1, Math.floor(total / 2), total]) {
			const { document, run } = await fixture();
			const checksum = documentChecksum(document),
				sequence = document.getPatchSequence();
			const source = [
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			];
			const history = [document.canUndo, document.canRedo];
			const events: RailPatchEvent[] = [];
			document.subscribe((event) => events.push(event));
			let visited = 0;
			await expect(
				run(
					documentTestScheduler(async () => {
						if (++visited === stop) throw new Error("user cancelled");
					}),
				),
			).rejects.toThrow("user cancelled");
			expect(documentChecksum(document)).toBe(checksum);
			expect(document.getPatchSequence()).toBe(sequence);
			[
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			].forEach((value, index) => {
				expect(value).toBe(source[index]);
			});
			expect([document.canUndo, document.canRedo]).toEqual(history);
			expect(events).toEqual([]);
			// Apply authority is one-shot; a cancelled replay keeps its original owned history.
			expect((await run(documentTestScheduler())).committed).toBe(operation !== "apply");
		}
	});

	it.each([
		"throw",
		"source ABA",
	] as const)("rejects %s at typed-patch preparation without a partial document", async (fault) => {
		const proof = connectorAdoptionProof();
		const plan = await adoptConnectorProof(proof, async () => {});
		const document = proof.document,
			checksum = documentChecksum(document),
			sequence = document.getPatchSequence();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		let prepared = 0;
		const commit = document.commitStaticFabAssemblyConnectorCooperatively(plan, {
			...documentTestScheduler(),
			preparePatch: async (event) => {
				prepared++;
				expect(event.relationshipChanges).toHaveLength(1);
				expect(documentChecksum(document)).toBe(checksum);
				if (fault === "throw") throw new Error("patch admission cancelled");
				rollbackSourceMutation(document);
			},
		});
		if (fault === "throw") await expect(commit).rejects.toThrow("patch admission cancelled");
		else expect((await commit).committed).toBe(false);
		expect(prepared).toBe(1);
		expect(documentChecksum(document)).toBe(checksum);
		expect(document.getPatchSequence()).toBe(sequence);
		expect(events).toEqual([]);
	});
});

function rollbackSourceMutation(document: RailDocument): void {
	const map = document.map,
		revision = map.getRevision(),
		checkpoint = map.createMutationCheckpoint();
	const cell = document.organizations.records[0]?.membership.railEdges[0]?.from;
	if (!cell) throw new Error("Missing source rail");
	const change = { x: -99, y: -99, before: 0, after: map.getEncoded(cell.x, cell.y) };
	map.applyAtomicMutations([change], []);
	map.rollbackAtomicMutations([change], [], checkpoint);
	expect(map.getRevision()).toBe(revision);
}

function connectorAdoptionProof() {
	const document = productionBayDocument();
	const intent = firstValidIntent(document);
	const snapshot = connectorBindingInput(document).snapshot;
	const permit = issueStaticFabAssemblyConnectorPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		snapshot.checksum,
		document.relationships,
	);
	const prepared = prepareStaticFabAssemblyConnector({
		type: "PREPARE_STATIC_FAB_ASSEMBLY_CONNECTOR",
		version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
		requestId: 1,
		ticketId: permit.ticketId,
		intent,
		expectedIntentFingerprint: staticFabAssemblyConnectorIntentFingerprint(intent),
		snapshot,
	});
	if (!prepared.valid || !prepared.plan || !prepared.ticket) throw new Error(prepared.reason);
	return {
		document,
		intent,
		permit,
		plan: structuredClone(prepared.plan),
		ticket: prepared.ticket,
	};
}

function adoptConnectorProof(
	proof: ReturnType<typeof connectorAdoptionProof>,
	checkpoint: () => Promise<void>,
) {
	return adoptStaticFabAssemblyConnectorWorkerPlanCooperatively(
		proof.permit,
		proof.ticket,
		proof.plan,
		proof.ticket.prospectiveChecksum,
		proof.document.map,
		proof.document.portEquipment,
		proof.document.getPatchSequence(),
		proof.document.organizations,
		proof.intent,
		proof.document.relationships,
		checkpoint,
		128,
	);
}

function documentTestScheduler(
	checkpoint: () => Promise<void> = async () => {},
): RailDocumentCooperativeCommitOptions {
	let time = 0;
	return { checkpoint, now: () => ++time, sliceMilliseconds: 1 };
}
