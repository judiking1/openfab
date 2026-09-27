import { beforeAll, describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import {
	discoverStaticFabAssemblyGateways,
	planStaticFabAssemblyConnector,
	STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
	type StaticFabAssemblyConnectorIntent,
} from "../core/StaticFabAssemblyConnector";
import {
	adoptStaticFabAssemblyConnectorWorkerPlan,
	issueStaticFabAssemblyConnectorPermit,
	staticFabAssemblyConnectorIntentFingerprint,
} from "../core/StaticFabAssemblyConnectorCertification";
import {
	emptyStaticFabAssemblyRelationshipState,
	staticFabAssemblyRelationshipStateSourceError,
} from "../core/StaticFabAssemblyRelationship";
import {
	planStaticFabBayFlowEditWithProspectiveState,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
} from "../core/StaticFabBayFlowEdit";
import {
	adoptStaticFabBayFlowEditWorkerPlan,
	issueStaticFabBayFlowEditPermit,
	staticFabBayFlowEditIntentFingerprint,
} from "../core/StaticFabBayFlowEditCertification";
import {
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import {
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	type StaticFabOrganizationBundlePlacementProspectiveState,
} from "../core/StaticFabOrganizationBundlePlacement";
import type {
	StaticFabSemanticBayMutationAction,
	StaticFabSemanticBayMutationPlan,
} from "../core/StaticFabSemanticBayMutation";
import { staticFabSemanticBayMutationPlanFingerprint } from "../core/StaticFabSemanticBayMutationCertification";
import { TileMap } from "../core/TileMap";
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION } from "../worker/StaticFabAssemblyConnectorProtocol";
import { prepareStaticFabAssemblyConnector } from "../worker/StaticFabAssemblyConnectorRuntime";
import { STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION } from "../worker/StaticFabBayFlowEditProtocol";
import { prepareStaticFabBayFlowEdit } from "../worker/StaticFabBayFlowEditRuntime";
import {
	STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
	type StaticFabSemanticBayMutationWorkerRequest,
	type StaticFabSemanticBayMutationWorkerResponse,
} from "../worker/StaticFabSemanticBayMutationProtocol";
import {
	hydrateStaticFabSemanticBayMutationSession,
	prepareStaticFabSemanticBayMutationInSession,
	type StaticFabSemanticBayMutationRuntimeSession,
} from "../worker/StaticFabSemanticBayMutationRuntime";
import {
	StaticFabSemanticBayMutationBridge,
	type StaticFabSemanticBayMutationWorkerPort,
} from "./StaticFabSemanticBayMutationBridge";

// Structured-cloned messages exercise the production bridge and Worker runtime, without a browser.
class SemanticWorker implements StaticFabSemanticBayMutationWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabSemanticBayMutationWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	private session: StaticFabSemanticBayMutationRuntimeSession | null = null;
	private terminated = false;
	private readonly transform: (
		response: StaticFabSemanticBayMutationWorkerResponse,
	) => StaticFabSemanticBayMutationWorkerResponse;
	constructor(
		transform: (
			response: StaticFabSemanticBayMutationWorkerResponse,
		) => StaticFabSemanticBayMutationWorkerResponse = (value) => value,
	) {
		this.transform = transform;
	}
	postMessage(
		message: StaticFabSemanticBayMutationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const request = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated) return;
			let response: StaticFabSemanticBayMutationWorkerResponse;
			if (request.type === "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION") {
				this.session = hydrateStaticFabSemanticBayMutationSession(request.snapshot);
				response = {
					type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_HYDRATED",
					version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
					requestId: request.requestId,
					source: this.session.sourceIdentity,
					sourceEvidence: this.session.sourceEvidence,
					hydrationMilliseconds: 0,
				};
			} else {
				if (!this.session) throw new Error("Missing hydrated source");
				response = {
					type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED",
					version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
					requestId: request.requestId,
					prepared: prepareStaticFabSemanticBayMutationInSession(request, this.session),
				};
			}
			this.onmessage?.({
				data: structuredClone(this.transform(response)),
			} as MessageEvent<StaticFabSemanticBayMutationWorkerResponse>);
		});
	}
	terminate(): void {
		this.terminated = true;
	}
}

const capture = (document: RailDocument) =>
	captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
const checksum = (document: RailDocument) =>
	checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);

function forgeSelfConsistentPreparedPlan(
	response: StaticFabSemanticBayMutationWorkerResponse,
	change: (plan: StaticFabSemanticBayMutationPlan) => StaticFabSemanticBayMutationPlan,
	sourceChecksum: string,
): StaticFabSemanticBayMutationWorkerResponse {
	if (
		response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED" ||
		!response.prepared.plan ||
		!response.prepared.ticket
	)
		return response;
	const plan = change(response.prepared.plan);
	const prospectiveChecksum = checksumRailPatchResult(sourceChecksum, {
		changes: plan.mutations,
		switchChanges: plan.switchMutations,
		portChanges: plan.portMutations,
		equipmentGroupChanges: plan.equipmentGroupMutations,
		organizationChanges: plan.organizationMutations,
		organizationNextIdBefore: plan.nextOrganizationIdBefore,
		organizationNextIdAfter: plan.nextOrganizationIdAfter,
		relationshipChanges: plan.relationshipMutations,
		relationshipNextIdBefore: plan.nextRelationshipIdBefore,
		relationshipNextIdAfter: plan.nextRelationshipIdAfter,
	});
	return {
		...response,
		prepared: {
			...response.prepared,
			plan,
			ticket: {
				...response.prepared.ticket,
				planFingerprint: staticFabSemanticBayMutationPlanFingerprint(plan),
				prospectiveChecksum,
			},
		},
	};
}

async function prepare(
	document: RailDocument,
	bayId: number,
	action: StaticFabSemanticBayMutationAction = "DISCONNECT",
	worker = new SemanticWorker(),
) {
	const bridge = new StaticFabSemanticBayMutationBridge(() => worker);
	try {
		return await bridge.prepare({
			snapshot: capture(document),
			intent: { version: 1, action, bayOrganizationId: bayId },
			getCurrentState: () => ({
				map: document.map,
				portEquipment: document.portEquipment,
				organizations: document.organizations,
				relationships: document.relationships,
				patchSequence: document.getPatchSequence(),
			}),
		});
	} finally {
		bridge.dispose();
	}
}

function connectedBays(
	catalogId: "single-production-bay" | "twin-production-bay",
	count: number,
	reverseSecondConnector = false,
): RailDocument {
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest(catalogId),
	);
	let state: StaticFabOrganizationBundlePlacementProspectiveState = {
		map: new TileMap(),
		portEquipment: emptyPortEquipmentState(),
		organizations: emptyStaticFabOrganizationState(),
		relationships: emptyStaticFabAssemblyRelationshipState(),
	};
	for (let i = 0; i < count; i++) {
		const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			state.map,
			state.portEquipment,
			i,
			state.organizations,
			state.relationships,
			artifact.organizationBundle,
			{ x: i * 100, y: 0 },
			0,
			null,
		);
		if (!placement.plan.valid || !placement.prospectiveState)
			throw new Error(placement.plan.reason);
		state = placement.prospectiveState;
	}
	const document = RailDocument.fromLoadedMap(
		state.map,
		count,
		state.portEquipment,
		state.organizations,
		undefined,
		state.relationships,
	);
	const bays = document.organizations.records.filter((record) => record.kind === "BAY");
	for (let i = 0; i < count - 1; i++) {
		if (count === 5 && i === 2) continue;
		const sourceId = reverseSecondConnector && i === 1 ? bays[i + 1].id : bays[i].id;
		const targetId = reverseSecondConnector && i === 1 ? bays[i].id : bays[i + 1].id;
		connect(document, connectingIntent(document, sourceId, targetId));
	}
	if (count === 5) {
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const banks = document.organizations.records.filter(
			(record) => roles.get(record.id) === "BAY_BANK",
		);
		connect(document, connectingIntent(document, banks[0].id, banks[1].id));
	}
	return document;
}

function connect(document: RailDocument, intent: StaticFabAssemblyConnectorIntent): void {
	const snapshot = capture(document);
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
		snapshot,
		expectedIntentFingerprint: staticFabAssemblyConnectorIntentFingerprint(intent),
	});
	if (!prepared.valid || !prepared.plan || !prepared.ticket) throw new Error(prepared.reason);
	const plan = adoptStaticFabAssemblyConnectorWorkerPlan(
		permit,
		prepared.ticket,
		structuredClone(prepared.plan),
		prepared.ticket.prospectiveChecksum,
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		document.relationships,
	);
	if (!document.commitStaticFabAssemblyConnector(plan))
		throw new Error(document.getLastCommandError() ?? "Connector rejected");
}

function connectingIntent(
	document: RailDocument,
	sourceId: number,
	targetId: number,
): StaticFabAssemblyConnectorIntent {
	for (const source of discoverStaticFabAssemblyGateways(
		document.map,
		document.organizations,
		sourceId,
	)) {
		for (const target of discoverStaticFabAssemblyGateways(
			document.map,
			document.organizations,
			targetId,
		)) {
			const intent: StaticFabAssemblyConnectorIntent = {
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
				purpose: "HIERARCHY_LINK",
				sourceOrganizationId: sourceId,
				sourceGatewayId: source.id,
				sourceAnchor: source.anchor,
				targetOrganizationId: targetId,
				targetGatewayId: target.id,
				targetAnchor: target.anchor,
				side: null,
			};
			if (
				planStaticFabAssemblyConnector(
					document.map,
					document.portEquipment,
					document.getPatchSequence(),
					document.organizations,
					intent,
				).valid
			)
				return intent;
		}
	}
	throw new Error("No valid independently generated Bay connector");
}

describe.each([
	"single-production-bay",
	"twin-production-bay",
] as const)("declared %s disconnection", (catalogId) => {
	let snapshot: RailMirrorSnapshot;
	let bayIds: number[];
	beforeAll(() => {
		const source = connectedBays(catalogId, 3);
		bayIds = source.organizations.records
			.filter((record) => record.kind === "BAY")
			.map((record) => record.id);
		expect(
			source.relationships.records.map((record) => record.managedChildOrganizationIds),
		).toEqual([[bayIds[0], bayIds[1]], [bayIds[2]]]);
		snapshot = capture(source);
	});

	it("disconnects C through Worker certification, one patch, mirror, history, and native reload", async () => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const sourceRelationships = document.relationships;
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const mirror = new RailPatchMirror();
		mirror.sync(capture(document));
		const result = await prepare(document, bayIds[2]);
		expect(result.validation.valid, result.validation.reason).toBe(true);
		if (!result.plan) throw new Error("Missing certified plan");
		expect(result.plan.relationshipMutations).toEqual([
			{
				id: sourceRelationships.records[1].id,
				before: sourceRelationships.records[1],
				after: null,
			},
		]);
		expect(
			document.commitStaticFabSemanticBayMutation(result.plan),
			document.getLastCommandError() ?? undefined,
		).toBe(true);
		const disconnected = checksum(document);
		expect(events).toHaveLength(1);
		expect(events[0].relationshipChanges).toEqual(result.plan.relationshipMutations);
		expect(document.relationships).toEqual({
			nextRelationshipId: sourceRelationships.nextRelationshipId,
			records: [sourceRelationships.records[0]],
		});
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				document.map,
				document.organizations,
				document.relationships,
			),
		).toBeNull();
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		const bay = document.organizations.records.find((record) => record.id === bayIds[2]);
		if (!bay) throw new Error("Disconnected Bay was deleted");
		expect(staticFabOrganizationParentIds(bay)).toEqual([]);
		expect(
			[...deriveStaticFabOrganizationSemanticRoles(document.organizations).values()].filter(
				(role) => role === "BAY_BANK",
			),
		).toHaveLength(1);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[0]).patch)).checksum,
		).toBe(disconnected);
		expect(document.undo()).toBe(true);
		expect(events).toHaveLength(2);
		expect(checksum(document)).toBe(snapshot.checksum);
		expect(document.relationships).toEqual(sourceRelationships);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[1]).patch)).checksum,
		).toBe(snapshot.checksum);
		expect(document.redo()).toBe(true);
		expect(events).toHaveLength(3);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[2]).patch)).checksum,
		).toBe(disconnected);
		const project = captureOpenFabProject(document, {
			manifest: createOpenFabProjectManifest(
				"declared-bay-test",
				"Synthetic Bay lifecycle",
				"2026-09-25T00:00:00.000Z",
			),
		});
		const parsed = parseOpenFabProjectJson(serializeOpenFabProject(project));
		const reopened = hydrateRailMirrorSnapshotDocument(
			createRailSnapshotFromOpenFabProject(parsed.project),
		);
		expect(checksum(reopened)).toBe(disconnected);
		expect(reopened.relationships).toEqual(document.relationships);
		const deletion = await prepare(reopened, bayIds[2], "DELETE");
		expect(deletion.validation.valid, deletion.validation.reason).toBe(true);
		if (!deletion.plan) throw new Error("Missing detached Delete plan");
		expect(deletion.plan.relationshipMutations).toEqual([]);
		expect(reopened.commitStaticFabSemanticBayMutation(deletion.plan)).toBe(true);
		expect(reopened.relationships).toEqual(document.relationships);
		expect(analyzeRailNetwork(reopened.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});
	});

	it.each([
		0, 1,
	])("refuses Bay index %i whose managed-child closure includes another Bay", async (index) => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const result = await prepare(document, bayIds[index]);
		expect(result.validation.valid).toBe(false);
		expect(result.plan).toMatchObject({ valid: false, mutations: [], relationshipMutations: [] });
		if (!result.plan) throw new Error("Missing compact refusal review");
		expect(document.commitStaticFabSemanticBayMutation(result.plan)).toBe(false);
		expect(result.validation.reason).toMatch(/다른 Bay|여러 조립 관계/);
		expect(checksum(document)).toBe(snapshot.checksum);
		expect(events).toEqual([]);
		expect(document.canUndo).toBe(false);
	});

	it("refuses related Delete with a disconnect-first explanation", async () => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const result = await prepare(document, bayIds[2], "DELETE");
		expect(result.validation.valid).toBe(false);
		expect(result.validation.reason).toMatch(/먼저 연결 해제/);
		expect(checksum(document)).toBe(snapshot.checksum);
	});

	it("preserves the other Bank and Fab relationship when detaching C under a root Fab", async () => {
		const document = connectedBays(catalogId, 5);
		const before = document.relationships;
		const selected = document.organizations.records.filter((record) => record.kind === "BAY")[2].id;
		const result = await prepare(document, selected);
		expect(result.validation.valid, result.validation.reason).toBe(true);
		if (!result.plan) throw new Error("Missing certified child disconnection");
		expect(
			document.commitStaticFabSemanticBayMutation(result.plan),
			document.getLastCommandError() ?? undefined,
		).toBe(true);
		expect(document.relationships).toEqual({
			...before,
			records: before.records.filter((record) => record.id !== 2),
		});
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 2,
			strongComponents: 2,
			openEnds: 0,
		});
	});

	it("disconnects a sole-managed Bay when it is the first relationship participant", async () => {
		const document = connectedBays(catalogId, 3, true);
		const bays = document.organizations.records.filter((record) => record.kind === "BAY");
		const target = bays[2];
		if (!target) throw new Error("Missing reverse-participant Bay");
		const beforeRelationships = document.relationships;
		const relation = beforeRelationships.records[1];
		if (!relation) throw new Error("Missing reverse-participant relationship");
		expect(relation.participantOrganizationIds[0]).toBe(target.id);
		expect(relation.managedChildOrganizationIds).toEqual([target.id]);
		const mirror = new RailPatchMirror();
		mirror.sync(capture(document));
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const prepared = await prepare(document, target.id);
		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		if (!prepared.plan) throw new Error("Missing certified reverse-participant plan");
		expect(prepared.plan.relationshipMutations).toEqual([
			{ id: relation.id, before: relation, after: null },
		]);
		expect(
			document.commitStaticFabSemanticBayMutation(prepared.plan),
			document.getLastCommandError() ?? undefined,
		).toBe(true);
		const disconnectedChecksum = checksum(document);
		expect(document.relationships).toEqual({
			nextRelationshipId: beforeRelationships.nextRelationshipId,
			records: [beforeRelationships.records[0]],
		});
		expect(events).toHaveLength(1);
		expect(events[0].relationshipChanges).toEqual(prepared.plan.relationshipMutations);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[0]).patch)).checksum,
		).toBe(disconnectedChecksum);
		expect(document.undo()).toBe(true);
		expect(document.relationships).toEqual(beforeRelationships);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[1]).patch)).checksum,
		).toBe(checksum(document));
		expect(document.redo()).toBe(true);
		expect(checksum(document)).toBe(disconnectedChecksum);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[2]).patch)).checksum,
		).toBe(disconnectedChecksum);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				document.map,
				document.organizations,
				document.relationships,
			),
		).toBeNull();
	});

	it("refuses a valid higher relationship's witness of the removed lower connector", async () => {
		const source = connectedBays(catalogId, 5);
		const bays = source.organizations.records.filter((record) => record.kind === "BAY");
		// Explicit alternate managed-child assignment in this synthetic negative fixture:
		// geometry and upper witnesses come from actual Connectors; this is not a producer change.
		const relationships = {
			...source.relationships,
			records: source.relationships.records.map((record) =>
				record.id === 1
					? { ...record, managedChildOrganizationIds: [bays[0].id] }
					: record.id === 2
						? { ...record, managedChildOrganizationIds: [bays[1].id, bays[2].id] }
						: record,
			),
		};
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				source.map,
				source.organizations,
				relationships,
			),
		).toBeNull();
		const document = RailDocument.fromLoadedMap(
			source.map,
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
			undefined,
			relationships,
		);
		const before = checksum(document);
		const result = await prepare(document, bays[0].id);
		expect(result.validation.valid).toBe(false);
		expect(result.plan?.issueCode).toBe("SHARED_CONNECTOR_OWNERSHIP");
		expect(result.validation.reason).toMatch(/다른 조립 관계가 이 연결의 레일 부품/);
		expect(checksum(document)).toBe(before);
		expect(document.relationships).toEqual(relationships);
	});

	it("rejects a certified plan after a rail mutation is rolled back to the same revision", async () => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const result = await prepare(document, bayIds[2]);
		if (!result.plan) throw new Error("Missing certified plan");
		const revision = document.map.getRevision();
		const checkpoint = document.map.createMutationCheckpoint();
		const edge = document.organizations.records[0].membership.railEdges[0];
		const change = {
			x: -99,
			y: -99,
			before: 0,
			after: document.map.getEncoded(edge.from.x, edge.from.y),
		};
		expect(document.map.applyAtomicMutations([change], [])).toBe(true);
		document.map.rollbackAtomicMutations([change], [], checkpoint);
		expect(document.map.getRevision()).toBe(revision);
		expect(checksum(document)).toBe(snapshot.checksum);
		expect(document.commitStaticFabSemanticBayMutation(result.plan)).toBe(false);
		expect(document.canUndo).toBe(false);
		expect(checksum(document)).toBe(snapshot.checksum);
	});

	it("refuses a non-detachable producer record without changing its identity", async () => {
		const source = hydrateRailMirrorSnapshotDocument(snapshot);
		const relationships = {
			...source.relationships,
			records: source.relationships.records.map((record) => ({
				...record,
				reviewPolicy: "AUTHORING_NON_DETACHABLE" as const,
			})),
		};
		const document = RailDocument.fromLoadedMap(
			source.map,
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
			undefined,
			relationships,
		);
		const before = checksum(document);
		const result = await prepare(document, bayIds[2]);
		expect(result.validation.valid).toBe(false);
		expect(result.plan?.issueCode).toBe("RELATIONSHIP_NOT_DETACHABLE");
		expect(checksum(document)).toBe(before);
	});

	it("rejects a forged relationship before-record and never publishes a patch", async () => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const worker = new SemanticWorker((response) => {
			if (response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED" || !response.prepared.plan)
				return response;
			const plan = response.prepared.plan;
			const mutation = plan.relationshipMutations[0];
			if (!mutation?.before) throw new Error("Expected declared removal");
			return {
				...response,
				prepared: {
					...response.prepared,
					plan: {
						...plan,
						relationshipMutations: [
							{ ...mutation, before: { ...mutation.before, id: mutation.before.id + 1 } },
						],
					},
				},
			};
		});
		await expect(prepare(document, bayIds[2], "DISCONNECT", worker)).rejects.toThrow(
			/relationship|malformed/i,
		);
		expect(checksum(document)).toBe(snapshot.checksum);
		expect(document.canUndo).toBe(false);
	});

	it("rejects a self-consistent Worker plan that omits the live relationship removal", async () => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const worker = new SemanticWorker((response) =>
			forgeSelfConsistentPreparedPlan(
				response,
				(plan) => ({ ...plan, relationshipMutations: [] }),
				snapshot.checksum,
			),
		);
		await expect(prepare(document, bayIds[2], "DISCONNECT", worker)).rejects.toThrow(
			/omitted or invented a declared relationship removal/,
		);
		expect(events).toHaveLength(0);
		expect(checksum(document)).toBe(snapshot.checksum);
		expect(document.canUndo).toBe(false);
	});

	it("rejects a self-consistent Worker plan whose rail cut omits a declared cell", async () => {
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const worker = new SemanticWorker((response) =>
			forgeSelfConsistentPreparedPlan(
				response,
				(plan) => ({ ...plan, mutations: plan.mutations.slice(1) }),
				snapshot.checksum,
			),
		);
		await expect(prepare(document, bayIds[2], "DISCONNECT", worker)).rejects.toThrow(
			/rail cut differs from its declared relationship/,
		);
		expect(events).toHaveLength(0);
		expect(checksum(document)).toBe(snapshot.checksum);
		expect(document.canUndo).toBe(false);
	});

	it("refuses both Bays of the first shared-managed pair", async () => {
		const document = connectedBays(catalogId, 2);
		const before = checksum(document);
		for (const bay of document.organizations.records.filter((record) => record.kind === "BAY")) {
			const result = await prepare(document, bay.id);
			expect(result.validation.valid).toBe(false);
			expect(result.validation.reason).toMatch(/다른 Bay의 소속/);
		}
		expect(checksum(document)).toBe(before);
	});
});

it("certifies and commits a related Twin Bay flow edit against its real relationship state", () => {
	const document = connectedBays("twin-production-bay", 5);
	const bay = document.organizations.records.filter((record) => record.kind === "BAY")[2];
	if (!bay) throw new Error("Missing related Twin Bay");
	const beforeRelationships = document.relationships;
	const beforeChecksum = checksum(document);
	const intent = {
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: bay.id,
		targetInternalFlowPattern: "co-rotating" as const,
	};
	const planning = planStaticFabBayFlowEditWithProspectiveState(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		document.relationships,
	);
	expect(planning.plan.valid, planning.plan.reason).toBe(true);
	if (!planning.prospectiveState) throw new Error("Missing related flow projection");
	expect(
		staticFabAssemblyRelationshipStateSourceError(
			planning.prospectiveState.map,
			planning.prospectiveState.organizations,
			document.relationships,
		),
	).toBeNull();
	const snapshot = capture(document);
	const mirror = new RailPatchMirror();
	mirror.sync(snapshot);
	const permit = issueStaticFabBayFlowEditPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		snapshot.checksum,
	);
	const prepared = prepareStaticFabBayFlowEdit({
		type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
		version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
		requestId: 1,
		ticketId: permit.ticketId,
		intent,
		expectedIntentFingerprint: staticFabBayFlowEditIntentFingerprint(intent),
		snapshot,
	});
	expect(prepared.valid, prepared.reason).toBe(true);
	if (!prepared.plan || !prepared.ticket) throw new Error("Missing certified flow edit");
	const certified = adoptStaticFabBayFlowEditWorkerPlan(
		permit,
		structuredClone(prepared.ticket),
		structuredClone(prepared.plan),
		prepared.ticket.prospectiveChecksum,
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
	);
	const events: RailPatchEvent[] = [];
	document.subscribe((event) => events.push(event));
	expect(
		document.commitStaticFabBayFlowEdit(certified),
		document.getLastCommandError() ?? undefined,
	).toBe(true);
	expect(events).toHaveLength(1);
	expect(document.relationships).toEqual(beforeRelationships);
	expect(checksum(document)).toBe(prepared.ticket.prospectiveChecksum);
	expect(
		mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[0]).patch)).checksum,
	).toBe(checksum(document));
	expect(document.undo()).toBe(true);
	expect(checksum(document)).toBe(beforeChecksum);
	expect(
		mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[1]).patch)).checksum,
	).toBe(beforeChecksum);
	expect(document.redo()).toBe(true);
	expect(document.relationships).toEqual(beforeRelationships);
	expect(
		mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[2]).patch)).checksum,
	).toBe(checksum(document));
});
