import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { type PortEquipmentState, portEquipmentStateError } from "./EquipmentGroup";
import { analyzeRailNetwork } from "./network";
import type { CardinalPortRoute, PortRecord } from "./PortRecord";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex, type RailModuleOwnership } from "./RailModuleOwnership";
import { ALL_DIRECTIONS, bitCount, type Direction, moveCell } from "./railShape";
import {
	compareDirectedRailEdges,
	deriveStaticFabOrganizationSemanticRoles,
	replaceStaticFabOrganizationRecordMembership,
	resolveStaticFabOrganizationCoverage,
	reverseStaticFabOrganizationMutations,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateError,
	updateStaticFabOrganizationRecordMetadata,
} from "./StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "./StaticFabOrganizationImpactIndex";
import {
	planStaticFabSemanticBayMutationWithProspectiveState,
	STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
	STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
	STATIC_FAB_SEMANTIC_BAY_SUPPORT_SEAM_EDGE_LIMIT,
	type StaticFabSemanticBayMutationIntent,
	type StaticFabSemanticBayMutationIssueCode,
	type StaticFabSemanticBayMutationPlanningResult,
	staticFabSemanticBayMutationIntentError,
	summarizeStaticFabSemanticBayOrganizationOwnerIds,
} from "./StaticFabSemanticBayMutation";
import type { TileMap } from "./TileMap";

const DEFAULT_OUTBOUND_CONNECTOR_EDGE_KEYS = Object.freeze([
	"50:36>50:35",
	"50:35>50:34",
	"50:34>50:33",
	"50:33>50:32",
	"50:32>51:32",
	"51:32>52:32",
	"52:32>52:31",
	"52:31>52:30",
	"52:30>52:29",
	"52:29>52:28",
	"52:28>52:27",
	"52:27>52:26",
]);

const DEFAULT_RETURN_CONNECTOR_EDGE_KEYS = Object.freeze([
	"42:26>42:27",
	"42:27>42:28",
	"42:28>42:29",
	"42:29>42:30",
	"42:30>42:31",
	"42:31>42:32",
	"42:32>41:32",
	"41:32>40:32",
	"40:32>40:33",
	"40:33>40:34",
	"40:34>40:35",
	"40:35>40:36",
]);

interface DefaultFabFixture {
	readonly certificate: CertifiedOpenFabFabComposition;
	readonly document: RailDocument;
	readonly fab: StaticFabOrganizationRecord;
	readonly bank: StaticFabOrganizationRecord;
	readonly otherBank: StaticFabOrganizationRecord;
	readonly bay: StaticFabOrganizationRecord;
	readonly siblingBay: StaticFabOrganizationRecord;
	readonly processLoop: StaticFabOrganizationRecord;
	readonly sourceChecksum: string;
	readonly disconnect: StaticFabSemanticBayMutationPlanningResult;
	readonly delete: StaticFabSemanticBayMutationPlanningResult;
}

describe("StaticFabSemanticBayMutation", () => {
	let fixture: DefaultFabFixture;

	beforeAll(() => {
		const certificate = composeOpenFabFab(defaultOpenFabFabProfile());
		const document = hydrateRailMirrorSnapshotDocument(certificate.roundTrippedSnapshot);
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const fab = requireRecord(
			document.organizations.records.find((record) => roles.get(record.id) === "FAB"),
			"default Fab",
		);
		const bay = requireRecord(
			document.organizations.records.find((record) => roles.get(record.id) === "BAY"),
			"default Bay",
		);
		const bankId = staticFabOrganizationParentIds(bay)[0];
		const bank = requireRecord(
			document.organizations.records.find((record) => record.id === bankId),
			"Bay Bank",
		);
		const otherBank = requireRecord(
			document.organizations.records.find(
				(record) => roles.get(record.id) === "BAY_BANK" && record.id !== bank.id,
			),
			"second Bay Bank",
		);
		const siblingBay = requireRecord(
			document.organizations.records.find(
				(record) =>
					roles.get(record.id) === "BAY" &&
					record.id !== bay.id &&
					staticFabOrganizationParentIds(record).includes(bank.id),
			),
			"sibling Bay",
		);
		const processLoop = requireRecord(
			document.organizations.records.find(
				(record) =>
					roles.get(record.id) === "PROCESS_LOOP" &&
					staticFabOrganizationParentIds(record).includes(bay.id),
			),
			"Bay Process Loop",
		);
		const sourceChecksum = authoredChecksum(document);
		const intent = semanticIntent("DISCONNECT", bay.id);
		const disconnect = planStaticFabSemanticBayMutationWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			intent,
		);
		const deleteResult = planStaticFabSemanticBayMutationWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			semanticIntent("DELETE", bay.id),
		);
		fixture = Object.freeze({
			certificate,
			document,
			fab,
			bank,
			otherBank,
			bay,
			siblingBay,
			processLoop,
			sourceChecksum,
			disconnect,
			delete: deleteResult,
		});
	}, 120_000);

	it("accepts only the exact versioned intent shape", () => {
		expect(staticFabSemanticBayMutationIntentError(semanticIntent("DISCONNECT", 3))).toBeNull();
		expect(staticFabSemanticBayMutationIntentError(semanticIntent("DELETE", 3))).toBeNull();
		expect(staticFabSemanticBayMutationIntentError(null)).toMatch(/object/);
		expect(
			staticFabSemanticBayMutationIntentError({
				...semanticIntent("DELETE", 3),
				unexpected: true,
			}),
		).toMatch(/fields/);
		expect(
			staticFabSemanticBayMutationIntentError({
				...semanticIntent("DELETE", 3),
				version: 2,
			}),
		).toMatch(/version/);
		expect(
			staticFabSemanticBayMutationIntentError({
				...semanticIntent("DELETE", 3),
				action: "REMOVE",
			}),
		).toMatch(/action/);
		expect(
			staticFabSemanticBayMutationIntentError({
				...semanticIntent("DELETE", 3),
				bayOrganizationId: 0,
			}),
		).toMatch(/organization id/);
	});

	it("disconnects one exact paired connector while preserving the detached Bay subtree", () => {
		const { document, bay, bank, processLoop, disconnect } = fixture;
		const prospective = requireProspective(disconnect);

		expect(disconnect.plan).toMatchObject({
			kind: STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
			valid: true,
			issueCode: null,
			baseRevision: document.map.getRevision(),
			basePatchSequence: document.getPatchSequence(),
			nextOrganizationIdBefore: document.organizations.nextOrganizationId,
			nextOrganizationIdAfter: document.organizations.nextOrganizationId,
			review: {
				action: "DISCONNECT",
				bayOrganizationId: bay.id,
				bankOrganizationId: bank.id,
				removedOrganizationIds: [],
				processLoopOrganizationIds: [processLoop.id],
				processLoopCount: 1,
				railModuleCount: 62,
				incidentConnectorCount: 1,
				connectorDirectedEdgeCount: 24,
				connectorOutboundDirectedEdgeKeys: DEFAULT_OUTBOUND_CONNECTOR_EDGE_KEYS,
				connectorReturnDirectedEdgeKeys: DEFAULT_RETURN_CONNECTOR_EDGE_KEYS,
				advancedSwitchCount: 0,
				equipmentGroupCount: 0,
				equipmentGroupIds: [],
				portCount: 0,
				portIds: [],
				remainingBankDirectedEdgeCount: 959,
				retainedCirculationCandidatePresent: true,
				circulationCertification: "PENDING_WORKER_CERTIFICATION",
				issueCode: null,
			},
		});
		expect(document.map.edgeCount - prospective.map.edgeCount).toBe(24);
		expect(analyzeRailNetwork(prospective.map)).toMatchObject({
			status: "disconnected",
			edges: 11_408,
			components: 2,
			strongComponents: 2,
			stronglyConnected: false,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(prospective.organizations.records).toHaveLength(63);
		expect(prospective.portEquipment).toEqual(document.portEquipment);
		expect(
			staticFabOrganizationStateError(
				prospective.map,
				prospective.portEquipment,
				prospective.organizations,
			),
		).toBeNull();

		const detachedBay = requireRecord(
			prospective.organizations.records.find((record) => record.id === bay.id),
			"detached Bay",
		);
		const preservedLoop = requireRecord(
			prospective.organizations.records.find((record) => record.id === processLoop.id),
			"preserved Process Loop",
		);
		expect(staticFabOrganizationParentIds(detachedBay)).toEqual([]);
		expect(preservedLoop).toEqual(processLoop);
		expect(deriveStaticFabOrganizationSemanticRoles(prospective.organizations).get(bay.id)).toBe(
			"BAY",
		);
		const detachedCoverage = resolveStaticFabOrganizationCoverage(
			prospective.organizations,
			bay.id,
		);
		expect(detachedCoverage?.descendantOrganizationIds).toEqual([processLoop.id]);
		expect(detachedCoverage?.effective.railEdges).toHaveLength(244);
		if (!detachedCoverage) throw new Error("Expected detached Bay coverage.");
		const sourceCoverage = resolveStaticFabOrganizationCoverage(document.organizations, bay.id);
		if (!sourceCoverage) throw new Error("Expected source Bay coverage.");
		const sourceBayEdgeKeys = new Set(
			sourceCoverage.effective.railEdges.map(staticFabOrganizationEdgeKey),
		);
		const sourceBankEdgeKeys = new Set(bank.membership.railEdges.map(staticFabOrganizationEdgeKey));
		const supportSeamEdgeKeys = detachedCoverage.effective.railEdges
			.map(staticFabOrganizationEdgeKey)
			.filter((edgeKey) => sourceBankEdgeKeys.has(edgeKey) && !sourceBayEdgeKeys.has(edgeKey));
		expect(supportSeamEdgeKeys.length).toBeGreaterThan(0);
		expect(supportSeamEdgeKeys.length).toBeLessThanOrEqual(
			STATIC_FAB_SEMANTIC_BAY_SUPPORT_SEAM_EDGE_LIMIT,
		);
		const detachedBank = requireRecord(
			prospective.organizations.records.find((record) => record.id === bank.id),
			"retained Bank",
		);
		const detachedBankEdgeKeys = new Set(
			detachedBank.membership.railEdges.map(staticFabOrganizationEdgeKey),
		);
		for (const edgeKey of supportSeamEdgeKeys) {
			const sourceOwnerIds = document.organizations.records
				.filter((record) =>
					record.membership.railEdges.some(
						(edge) => staticFabOrganizationEdgeKey(edge) === edgeKey,
					),
				)
				.map((record) => record.id);
			expect(sourceOwnerIds).toEqual([bank.id]);
			expect(detachedBankEdgeKeys.has(edgeKey)).toBe(false);
		}
		const exactModuleKeys = exactModuleKeysForMembership(
			prospective.map,
			detachedCoverage.effective,
		);
		expect(exactModuleKeys).toHaveLength(62);
		expect(disconnect.plan.review.railModuleKeys).toEqual(exactModuleKeys);
		expect(new Set(disconnect.plan.review.railModuleKeys)).toHaveLength(62);
		assertExactDirectedEdgeOwnership(prospective.map, prospective.organizations);
		assertSourceToProspectivePatch(
			document,
			disconnect,
			prospective.map,
			prospective.organizations,
		);
		assertSourceUnchanged();
	});

	it("deletes the Bay, its Process Loop, and connector as one source-to-final patch", () => {
		const { document, bay, bank, processLoop, delete: deleteResult } = fixture;
		const prospective = requireProspective(deleteResult);

		expect(deleteResult.plan).toMatchObject({
			kind: STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
			valid: true,
			issueCode: null,
			baseRevision: document.map.getRevision(),
			basePatchSequence: document.getPatchSequence(),
			nextOrganizationIdBefore: 64,
			nextOrganizationIdAfter: 64,
			review: {
				action: "DELETE",
				bayOrganizationId: bay.id,
				bankOrganizationId: bank.id,
				removedOrganizationIds: [bay.id, processLoop.id],
				processLoopOrganizationIds: [processLoop.id],
				processLoopCount: 1,
				railModuleCount: 62,
				incidentConnectorCount: 1,
				connectorDirectedEdgeCount: 24,
				connectorOutboundDirectedEdgeKeys: DEFAULT_OUTBOUND_CONNECTOR_EDGE_KEYS,
				connectorReturnDirectedEdgeKeys: DEFAULT_RETURN_CONNECTOR_EDGE_KEYS,
				bayDirectedEdgeCount: 244,
				advancedSwitchCount: 0,
				equipmentGroupCount: 0,
				equipmentGroupIds: [],
				portCount: 0,
				portIds: [],
				remainingBankDirectedEdgeCount: 959,
				retainedCirculationCandidatePresent: true,
				circulationCertification: "PENDING_WORKER_CERTIFICATION",
				issueCode: null,
			},
		});
		expect(deleteResult.plan.review.railModuleKeys).toEqual(
			fixture.disconnect.plan.review.railModuleKeys,
		);
		expect(document.map.edgeCount - prospective.map.edgeCount).toBe(268);
		expect(analyzeRailNetwork(prospective.map)).toMatchObject({
			status: "closed",
			edges: 11_164,
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(prospective.organizations.records).toHaveLength(61);
		expect(prospective.organizations.records.some((record) => record.id === bay.id)).toBe(false);
		expect(prospective.organizations.records.some((record) => record.id === processLoop.id)).toBe(
			false,
		);
		expect(prospective.organizations.records.some((record) => record.id === bank.id)).toBe(true);
		expect(prospective.portEquipment).toEqual(document.portEquipment);
		expect(deleteResult.plan.switchMutations).toEqual([]);
		expect(deleteResult.plan.portMutations).toEqual([]);
		expect(deleteResult.plan.equipmentGroupMutations).toEqual([]);
		expect(
			staticFabOrganizationStateError(
				prospective.map,
				prospective.portEquipment,
				prospective.organizations,
			),
		).toBeNull();
		assertExactDirectedEdgeOwnership(prospective.map, prospective.organizations);
		assertSourceToProspectivePatch(
			document,
			deleteResult,
			prospective.map,
			prospective.organizations,
		);
		assertSourceUnchanged();
	});

	it("deletes an already detached Bay without inventing a second connector", () => {
		const disconnected = requireProspective(fixture.disconnect);
		const detachedDelete = planStaticFabSemanticBayMutationWithProspectiveState(
			disconnected.map,
			disconnected.portEquipment,
			fixture.document.getPatchSequence(),
			disconnected.organizations,
			semanticIntent("DELETE", fixture.bay.id),
		);
		const prospective = requireProspective(detachedDelete);
		const directDelete = requireProspective(fixture.delete);

		expect(detachedDelete.plan).toMatchObject({
			kind: STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
			valid: true,
			issueCode: null,
			review: {
				incidentConnectorCount: 0,
				connectorDirectedEdgeCount: 0,
				connectorOutboundDirectedEdgeKeys: [],
				connectorReturnDirectedEdgeKeys: [],
				removedOrganizationIds: [fixture.bay.id, fixture.processLoop.id],
				processLoopOrganizationIds: [fixture.processLoop.id],
				railModuleCount: 62,
				railModuleKeys: fixture.disconnect.plan.review.railModuleKeys,
				equipmentGroupIds: [],
				portIds: [],
				retainedCirculationCandidatePresent: false,
				circulationCertification: "PENDING_WORKER_CERTIFICATION",
			},
		});
		expect(disconnected.map.edgeCount - prospective.map.edgeCount).toBe(244);
		expect(analyzeRailNetwork(prospective.map)).toMatchObject({
			status: "closed",
			edges: 11_164,
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});
		expect(
			authoredChecksumForState(
				prospective.map,
				prospective.portEquipment,
				prospective.organizations,
			),
		).toBe(
			authoredChecksumForState(
				directDelete.map,
				directDelete.portEquipment,
				directDelete.organizations,
			),
		);
		expect(prospective.organizations).toEqual(directDelete.organizations);
		assertExactDirectedEdgeOwnership(prospective.map, prospective.organizations);

		const repeatedDisconnect = planStaticFabSemanticBayMutationWithProspectiveState(
			disconnected.map,
			disconnected.portEquipment,
			fixture.document.getPatchSequence(),
			disconnected.organizations,
			semanticIntent("DISCONNECT", fixture.bay.id),
		);
		assertRejected(repeatedDisconnect, "ALREADY_DISCONNECTED");
		assertSourceUnchanged();
	});

	it("preserves other closed work-in-progress components across repeated Bay commands", () => {
		const firstDisconnect = requireProspective(fixture.disconnect);
		const firstDisconnectChecksum = authoredChecksumForState(
			firstDisconnect.map,
			firstDisconnect.portEquipment,
			firstDisconnect.organizations,
		);
		expect(analyzeRailNetwork(firstDisconnect.map)).toMatchObject({
			status: "disconnected",
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			unsafeJunctions: 0,
		});

		const secondDisconnect = planStaticFabSemanticBayMutationWithProspectiveState(
			firstDisconnect.map,
			firstDisconnect.portEquipment,
			fixture.document.getPatchSequence(),
			firstDisconnect.organizations,
			semanticIntent("DISCONNECT", fixture.siblingBay.id),
		);
		const twiceDisconnected = requireProspective(secondDisconnect);
		expect(secondDisconnect.plan.review.incidentConnectorCount).toBe(1);
		expect(analyzeRailNetwork(twiceDisconnected.map)).toMatchObject({
			status: "disconnected",
			components: 3,
			strongComponents: 3,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		assertExactDirectedEdgeOwnership(twiceDisconnected.map, twiceDisconnected.organizations);

		const attachedDelete = planStaticFabSemanticBayMutationWithProspectiveState(
			firstDisconnect.map,
			firstDisconnect.portEquipment,
			fixture.document.getPatchSequence(),
			firstDisconnect.organizations,
			semanticIntent("DELETE", fixture.siblingBay.id),
		);
		const afterAttachedDelete = requireProspective(attachedDelete);
		expect(attachedDelete.plan.review.incidentConnectorCount).toBe(1);
		expect(analyzeRailNetwork(afterAttachedDelete.map)).toMatchObject({
			status: "disconnected",
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		assertExactDirectedEdgeOwnership(afterAttachedDelete.map, afterAttachedDelete.organizations);
		expect(
			authoredChecksumForState(
				firstDisconnect.map,
				firstDisconnect.portEquipment,
				firstDisconnect.organizations,
			),
		).toBe(firstDisconnectChecksum);
		assertSourceUnchanged();
	});

	it("handles every protected organization impact symmetrically with narrow authorizations", () => {
		for (const result of [fixture.disconnect, fixture.delete]) {
			const prospective = requireProspective(result);
			assertOrganizationImpactDirection(
				fixture.document.organizations,
				fixture.document.portEquipment,
				prospective.portEquipment,
				result,
				false,
			);
			assertOrganizationImpactDirection(
				prospective.organizations,
				prospective.portEquipment,
				fixture.document.portEquipment,
				result,
				true,
			);
		}
		assertSourceUnchanged();
	});

	it("fails closed for malformed, stale, missing, and non-Bay sources", () => {
		const malformed = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			{
				version: 2,
				action: "DELETE",
				bayOrganizationId: fixture.bay.id,
			} as unknown as StaticFabSemanticBayMutationIntent,
		);
		assertRejected(malformed, "INVALID_SOURCE");

		const stale = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			-1,
			fixture.document.organizations,
			semanticIntent("DELETE", fixture.bay.id),
		);
		assertRejected(stale, "STALE_SOURCE");

		const missing = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			semanticIntent("DELETE", 0x7fff_ffff),
		);
		assertRejected(missing, "MISSING_BAY");

		const processLoop = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			semanticIntent("DELETE", fixture.processLoop.id),
		);
		assertRejected(processLoop, "UNSUPPORTED_ORGANIZATION");
		assertSourceUnchanged();
	});

	it("rejects multi-parent and externally shared Bay hierarchies before mutation", () => {
		const multiParent = withParentUpdates(
			fixture.document.organizations,
			new Map([
				[fixture.bay.id, [fixture.fab.id, fixture.bank.id].sort((left, right) => left - right)],
			]),
		);
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				fixture.document.portEquipment,
				multiParent,
			),
		).toBeNull();
		assertRejected(planForState(multiParent, "DELETE"), "AMBIGUOUS_HIERARCHY");

		const sharedDescendant = withParentUpdates(
			fixture.document.organizations,
			new Map([
				[
					fixture.processLoop.id,
					[fixture.bay.id, fixture.siblingBay.id].sort((left, right) => left - right),
				],
			]),
		);
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				fixture.document.portEquipment,
				sharedDescendant,
			),
		).toBeNull();
		assertRejected(planForState(sharedDescendant, "DELETE"), "SHARED_ORGANIZATION_DEPENDENCY");
		assertSourceUnchanged();
	});

	it("rejects source Bank ownership of an exact Bay rail module before reconciliation", () => {
		const sourceOwnership = buildRailModuleOwnershipIndex(fixture.document.map);
		const bayEdgeKeys = new Set(fixture.bay.membership.railEdges.map(staticFabOrganizationEdgeKey));
		const bankEdgeKeys = new Set(
			fixture.bank.membership.railEdges.map(staticFabOrganizationEdgeKey),
		);
		const sharedModule = sourceOwnership.modules.find(
			(module) =>
				module.advancedSwitchId === null &&
				module.eraseEdges.length > 0 &&
				module.eraseEdges.every((edge) => bayEdgeKeys.has(staticFabOrganizationEdgeKey(edge))) &&
				module.eraseEdges.every((edge) => !bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge))),
		);
		expect(sharedModule).toBeDefined();
		if (!sharedModule) throw new Error("Expected one Bay-owned rail module.");
		const sharedBankEdges = new Map(
			fixture.bank.membership.railEdges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]),
		);
		for (const edge of sharedModule.eraseEdges) {
			sharedBankEdges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		const sharedBank = replaceStaticFabOrganizationRecordMembership(fixture.bank, {
			railEdges: Object.freeze([...sharedBankEdges.values()].sort(compareDirectedRailEdges)),
			advancedSwitchIds: fixture.bank.membership.advancedSwitchIds,
			equipmentGroupIds: fixture.bank.membership.equipmentGroupIds,
		});
		const organizations = Object.freeze({
			nextOrganizationId: fixture.document.organizations.nextOrganizationId,
			records: Object.freeze(
				fixture.document.organizations.records.map((record) =>
					record.id === sharedBank.id ? sharedBank : record,
				),
			),
		}) satisfies StaticFabOrganizationState;
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				fixture.document.portEquipment,
				organizations,
			),
		).toBeNull();
		const sourceChecksum = authoredChecksumForState(
			fixture.document.map,
			fixture.document.portEquipment,
			organizations,
		);

		for (const action of ["DISCONNECT", "DELETE"] as const) {
			const result = planForState(organizations, action);
			assertRejected(result, "SHARED_ORGANIZATION_DEPENDENCY");
			expect(result.plan.reason).toMatch(/명시적 rail 또는 advanced switch/);
		}
		expect(
			authoredChecksumForState(fixture.document.map, fixture.document.portEquipment, organizations),
		).toBe(sourceChecksum);
		assertSourceUnchanged();
	});

	it("rejects source Bank ownership of an exact Bay advanced-switch module", () => {
		const switchFixture = new RailDocument();
		const origin = Object.freeze({ x: 1_000_000, y: 1_000_000 });
		const terminalPlan = planRailConstruction(
			switchFixture.map,
			{ x: origin.x - 3, y: origin.y },
			origin,
		);
		expect(terminalPlan.valid, terminalPlan.reason).toBe(true);
		expect(switchFixture.commit(terminalPlan)).toBe(true);
		const switchPlan = planAdvancedSwitch(
			switchFixture.map,
			origin,
			{ x: origin.x, y: origin.y + 2 },
			"C",
		);
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(switchFixture.commit(switchPlan)).toBe(true);
		const map = fixture.document.map.clone();
		expect(
			map.applyAtomicMutations(terminalPlan.mutations, terminalPlan.switchMutations ?? []),
		).toBe(true);
		expect(map.applyAtomicMutations(switchPlan.mutations, switchPlan.switchMutations)).toBe(true);
		const switchId = switchPlan.switchRecord?.id;
		if (!switchId) throw new Error("Expected one advanced switch.");
		const sharedModule = buildRailModuleOwnershipIndex(map).modules.find(
			(module) => module.advancedSwitchId === switchId,
		);
		expect(sharedModule).toBeDefined();
		if (!sharedModule) throw new Error("Expected one advanced-switch module.");
		const claimSharedModule = (
			record: StaticFabOrganizationRecord,
		): StaticFabOrganizationRecord => {
			const edges = new Map(
				record.membership.railEdges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]),
			);
			for (const edge of sharedModule.eraseEdges) {
				edges.set(staticFabOrganizationEdgeKey(edge), edge);
			}
			return replaceStaticFabOrganizationRecordMembership(record, {
				railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
				advancedSwitchIds: Object.freeze(
					[...new Set([...record.membership.advancedSwitchIds, switchId])].sort(
						(left, right) => left - right,
					),
				),
				equipmentGroupIds: record.membership.equipmentGroupIds,
			});
		};
		const sharedBank = claimSharedModule(fixture.bank);
		const sharedBay = claimSharedModule(fixture.bay);
		const organizations = Object.freeze({
			nextOrganizationId: fixture.document.organizations.nextOrganizationId,
			records: Object.freeze(
				fixture.document.organizations.records.map((record) =>
					record.id === sharedBank.id
						? sharedBank
						: record.id === sharedBay.id
							? sharedBay
							: record,
				),
			),
		}) satisfies StaticFabOrganizationState;
		expect(
			staticFabOrganizationStateError(map, fixture.document.portEquipment, organizations),
		).toBeNull();
		const sourceChecksum = authoredChecksumForState(
			map,
			fixture.document.portEquipment,
			organizations,
		);

		for (const action of ["DISCONNECT", "DELETE"] as const) {
			const result = planStaticFabSemanticBayMutationWithProspectiveState(
				map,
				fixture.document.portEquipment,
				fixture.document.getPatchSequence(),
				organizations,
				semanticIntent(action, fixture.bay.id),
			);
			assertRejected(result, "SHARED_ORGANIZATION_DEPENDENCY");
			expect(result.plan.reason).toMatch(/명시적 rail 또는 advanced switch/);
		}
		expect(authoredChecksumForState(map, fixture.document.portEquipment, organizations)).toBe(
			sourceChecksum,
		);
		expect(map.getAdvancedSwitch(switchId)).toEqual(switchPlan.switchRecord);
		assertSourceUnchanged();
	});

	it("bounds and sorts shared organization owner diagnostics with an exact total", () => {
		const ownerCount = 500;
		const firstOwnerId = 1_000_000_001;
		const ownerIds = Object.freeze(
			Array.from({ length: ownerCount }, (_, index) => firstOwnerId + ownerCount - index - 1),
		);
		const sourceOwnerIds = [...ownerIds];

		const summary = summarizeStaticFabSemanticBayOrganizationOwnerIds(ownerIds);

		expect(summary.length).toBeLessThan(256);
		expect(summary).toContain(`${firstOwnerId}`);
		expect(summary).toContain(`${firstOwnerId + 7}`);
		expect(summary).not.toContain(`${firstOwnerId + 8}`);
		expect(summary).not.toContain(`${firstOwnerId + ownerCount - 1}`);
		const countSummary = /나머지 (\d+)개 \(총 (\d+)개\)/.exec(summary);
		expect(countSummary).not.toBeNull();
		expect(Number(countSummary?.[1]) + 8).toBe(ownerCount);
		expect(Number(countSummary?.[2])).toBe(ownerCount);
		expect(ownerIds).toEqual(sourceOwnerIds);
	});

	it("reports the same bounded shared-module reason when source ownership is reversed", () => {
		const disconnected = requireProspective(fixture.disconnect);
		const sourceOwnership = buildRailModuleOwnershipIndex(fixture.document.map);
		const disconnectedOwnership = buildRailModuleOwnershipIndex(disconnected.map);
		const sourceModuleByEdgeKey = new Map<string, RailModuleOwnership>();
		for (const module of sourceOwnership.modules) {
			for (const edge of module.eraseEdges) {
				sourceModuleByEdgeKey.set(staticFabOrganizationEdgeKey(edge), module);
			}
		}
		const bayEdgeKeys = new Set(fixture.bay.membership.railEdges.map(staticFabOrganizationEdgeKey));
		const processLoopEdgeKeys = new Set(
			fixture.processLoop.membership.railEdges.map(staticFabOrganizationEdgeKey),
		);
		let reversibleSourceModules: readonly [RailModuleOwnership, RailModuleOwnership] | null = null;
		for (const prospectiveModule of disconnectedOwnership.modules) {
			const candidatesByKey = new Map<string, RailModuleOwnership>();
			for (const edge of prospectiveModule.eraseEdges) {
				const sourceModule = sourceModuleByEdgeKey.get(staticFabOrganizationEdgeKey(edge));
				if (sourceModule) candidatesByKey.set(sourceModule.key, sourceModule);
			}
			const candidates = [...candidatesByKey.values()].filter((sourceModule) =>
				sourceModule.eraseEdges.every((edge) => {
					const key = staticFabOrganizationEdgeKey(edge);
					return bayEdgeKeys.has(key) && !processLoopEdgeKeys.has(key);
				}),
			);
			if (candidates.length >= 2) {
				reversibleSourceModules = [
					candidates[0] as RailModuleOwnership,
					candidates[1] as RailModuleOwnership,
				];
				break;
			}
		}
		expect(reversibleSourceModules).not.toBeNull();
		if (!reversibleSourceModules) throw new Error("Expected a reversible source module pair.");

		const reasons: string[] = [];
		for (const movedModule of reversibleSourceModules) {
			const movedEdgeKeys = new Set(movedModule.eraseEdges.map(staticFabOrganizationEdgeKey));
			const movedEdgesByKey = new Map(
				fixture.processLoop.membership.railEdges.map((edge) => [
					staticFabOrganizationEdgeKey(edge),
					edge,
				]),
			);
			for (const edge of movedModule.eraseEdges) {
				movedEdgesByKey.set(staticFabOrganizationEdgeKey(edge), edge);
			}
			const movedBay = replaceStaticFabOrganizationRecordMembership(fixture.bay, {
				railEdges: Object.freeze(
					fixture.bay.membership.railEdges.filter(
						(edge) => !movedEdgeKeys.has(staticFabOrganizationEdgeKey(edge)),
					),
				),
				advancedSwitchIds: fixture.bay.membership.advancedSwitchIds,
				equipmentGroupIds: fixture.bay.membership.equipmentGroupIds,
			});
			const movedProcessLoop = replaceStaticFabOrganizationRecordMembership(fixture.processLoop, {
				railEdges: Object.freeze([...movedEdgesByKey.values()].sort(compareDirectedRailEdges)),
				advancedSwitchIds: fixture.processLoop.membership.advancedSwitchIds,
				equipmentGroupIds: fixture.processLoop.membership.equipmentGroupIds,
			});
			const organizations = Object.freeze({
				nextOrganizationId: fixture.document.organizations.nextOrganizationId,
				records: Object.freeze(
					fixture.document.organizations.records.map((record) =>
						record.id === movedBay.id
							? movedBay
							: record.id === movedProcessLoop.id
								? movedProcessLoop
								: record,
					),
				),
			}) satisfies StaticFabOrganizationState;
			expect(
				staticFabOrganizationStateError(
					fixture.document.map,
					fixture.document.portEquipment,
					organizations,
				),
			).toBeNull();
			const sourceChecksum = authoredChecksumForState(
				fixture.document.map,
				fixture.document.portEquipment,
				organizations,
			);
			for (const action of ["DISCONNECT", "DELETE"] as const) {
				const result = planForState(organizations, action);
				assertRejected(result, "SHARED_ORGANIZATION_DEPENDENCY");
				reasons.push(result.plan.reason);
			}
			expect(
				authoredChecksumForState(
					fixture.document.map,
					fixture.document.portEquipment,
					organizations,
				),
			).toBe(sourceChecksum);
		}
		expect(new Set(reasons).size).toBe(1);
		const reason = reasons[0] as string;
		expect(reason.length).toBeLessThan(256);
		expect(reason).toContain(
			`조직 ${Math.min(fixture.bay.id, fixture.processLoop.id)}, ${Math.max(
				fixture.bay.id,
				fixture.processLoop.id,
			)}`,
		);
		assertSourceUnchanged();
	});

	it("rejects a hierarchy whose declared Bank does not own the live connector", () => {
		const wrongBank = withParentUpdates(
			fixture.document.organizations,
			new Map([[fixture.bay.id, [fixture.otherBank.id]]]),
		);
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				fixture.document.portEquipment,
				wrongBank,
			),
		).toBeNull();
		assertRejected(planForState(wrongBank, "DISCONNECT"), "CONNECTOR_NOT_RECOGNIZED");
		assertSourceUnchanged();
	});

	it("removes a fully dependent unassigned group and reports its exact equipment identities", () => {
		const route = regularCardinalRouteForMembership(
			fixture.document.map,
			fixture.bay.membership.railEdges,
		);
		const portEquipment = singleFlexEquipmentState(route);
		expect(portEquipmentStateError(portEquipment)).toBeNull();
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				portEquipment,
				fixture.document.organizations,
			),
		).toBeNull();

		const result = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			semanticIntent("DELETE", fixture.bay.id),
		);
		const prospective = requireProspective(result);
		expect(result.plan.review).toMatchObject({
			equipmentGroupCount: 1,
			equipmentGroupIds: [1],
			portCount: 1,
			portIds: [1],
			circulationCertification: "PENDING_WORKER_CERTIFICATION",
		});
		expect(result.plan.portMutations).toEqual([
			{ id: 1, before: portEquipment.ports[0], after: null },
		]);
		expect(result.plan.equipmentGroupMutations).toEqual([
			{ id: 1, before: portEquipment.equipmentGroups[0], after: null },
		]);
		expect(prospective.portEquipment).toEqual({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [],
			equipmentGroups: [],
		});
		expect(portEquipment.ports).toHaveLength(1);
		expect(portEquipment.equipmentGroups).toHaveLength(1);
		assertExactDirectedEdgeOwnership(prospective.map, prospective.organizations);
		assertSourceUnchanged();
	});

	it("preserves Bay-owned equipment on Disconnect and removes it atomically on Delete", () => {
		const route = regularCardinalRouteForMembership(
			fixture.document.map,
			fixture.bay.membership.railEdges,
		);
		const portEquipment = singleFlexEquipmentState(route);
		const organizations = Object.freeze({
			nextOrganizationId: fixture.document.organizations.nextOrganizationId,
			records: Object.freeze(
				fixture.document.organizations.records.map((record) =>
					record.id === fixture.bay.id
						? replaceStaticFabOrganizationRecordMembership(
								record,
								Object.freeze({
									railEdges: record.membership.railEdges,
									advancedSwitchIds: record.membership.advancedSwitchIds,
									equipmentGroupIds: Object.freeze([1]),
								}),
							)
						: record,
				),
			),
		}) satisfies StaticFabOrganizationState;
		expect(
			staticFabOrganizationStateError(fixture.document.map, portEquipment, organizations),
		).toBeNull();

		const disconnect = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			portEquipment,
			fixture.document.getPatchSequence(),
			organizations,
			semanticIntent("DISCONNECT", fixture.bay.id),
		);
		const disconnected = requireProspective(disconnect);
		expect(disconnect.plan.review).toMatchObject({
			equipmentGroupCount: 1,
			equipmentGroupIds: [1],
			portCount: 1,
			portIds: [1],
		});
		expect(disconnect.plan.portMutations).toEqual([]);
		expect(disconnect.plan.equipmentGroupMutations).toEqual([]);
		expect(disconnected.portEquipment).toBe(portEquipment);
		expect(
			resolveStaticFabOrganizationCoverage(disconnected.organizations, fixture.bay.id)?.effective
				.equipmentGroupIds,
		).toEqual([1]);

		const deleteResult = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			portEquipment,
			fixture.document.getPatchSequence(),
			organizations,
			semanticIntent("DELETE", fixture.bay.id),
		);
		const afterDelete = requireProspective(deleteResult);
		expect(deleteResult.plan.review).toMatchObject({
			equipmentGroupCount: 1,
			equipmentGroupIds: [1],
			portCount: 1,
			portIds: [1],
		});
		expect(deleteResult.plan.portMutations).toHaveLength(1);
		expect(deleteResult.plan.equipmentGroupMutations).toHaveLength(1);
		expect(afterDelete.portEquipment).toEqual({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [],
			equipmentGroups: [],
		});
		expect(afterDelete.organizations.records.some((record) => record.id === fixture.bay.id)).toBe(
			false,
		);
		assertExactDirectedEdgeOwnership(afterDelete.map, afterDelete.organizations);
		assertSourceUnchanged();
	});

	it("rejects connector-dependent equipment for both Disconnect and Delete", () => {
		const connectorRoute = regularCardinalRouteAt(fixture.document.map, 52, 29);
		const portEquipment = singleFlexEquipmentState(connectorRoute);
		expect(portEquipmentStateError(portEquipment)).toBeNull();
		for (const action of ["DISCONNECT", "DELETE"] as const) {
			const result = planStaticFabSemanticBayMutationWithProspectiveState(
				fixture.document.map,
				portEquipment,
				fixture.document.getPatchSequence(),
				fixture.document.organizations,
				semanticIntent(action, fixture.bay.id),
			);
			assertRejected(result, "CONNECTOR_EQUIPMENT_DEPENDENCY");
			expect(result.plan.reason).toMatch(/PORT-1/);
		}
		expect(portEquipment.ports).toHaveLength(1);
		expect(portEquipment.equipmentGroups).toHaveLength(1);
		assertSourceUnchanged();
	});

	it("bounds connector-dependent port diagnostics while preserving the exact omitted count", () => {
		const connectorRoute = regularCardinalRouteAt(fixture.document.map, 52, 29);
		const dependentPortCount = 500;
		const firstPortId = 1_000_000_001;
		const descendingIndexes = Array.from(
			{ length: dependentPortCount },
			(_, index) => dependentPortCount - index - 1,
		);
		const portEquipment = Object.freeze({
			nextPortId: firstPortId + dependentPortCount,
			nextEquipmentGroupId: firstPortId + dependentPortCount,
			ports: Object.freeze(
				descendingIndexes.map((index) => {
					const id = firstPortId + index;
					const side = (["CENTER", "LEFT", "RIGHT"] as const)[index % 3] as
						| "CENTER"
						| "LEFT"
						| "RIGHT";
					return Object.freeze({
						id,
						equipmentGroupId: id,
						route: connectorRoute,
						stationMillimeters: Math.floor(index / 3) * 600,
						side,
						lateralOffsetMillimeters: side === "CENTER" ? 0 : 1_000,
						direction: "WITH_TRAVEL" as const,
						portType: "OHB" as const,
						barcode: null,
					});
				}),
			),
			equipmentGroups: Object.freeze(
				descendingIndexes.map((index) => {
					const id = firstPortId + index;
					return Object.freeze({
						id,
						kind: "OHB" as const,
						portIds: Object.freeze([id]),
						template: "SINGLE" as const,
					});
				}),
			),
		}) satisfies PortEquipmentState;
		expect(portEquipmentStateError(portEquipment)).toBeNull();

		const reasons = (["DISCONNECT", "DELETE"] as const).map((action) => {
			const result = planStaticFabSemanticBayMutationWithProspectiveState(
				fixture.document.map,
				portEquipment,
				fixture.document.getPatchSequence(),
				fixture.document.organizations,
				semanticIntent(action, fixture.bay.id),
			);
			assertRejected(result, "CONNECTOR_EQUIPMENT_DEPENDENCY");
			return result.plan.reason;
		});
		expect(reasons[1]).toBe(reasons[0]);
		const reason = reasons[0] as string;
		expect(reason.length).toBeLessThan(256);
		expect(reason).toContain(`PORT-${firstPortId}`);
		expect(reason).toContain(`PORT-${firstPortId + 7}`);
		expect(reason).not.toContain(`PORT-${firstPortId + 8}`);
		expect(reason).not.toContain(`PORT-${firstPortId + dependentPortCount - 1}`);
		const countSummary = /나머지 (\d+)개 \(총 (\d+)개\)/.exec(reason);
		expect(countSummary).not.toBeNull();
		expect(Number(countSummary?.[1]) + 8).toBe(dependentPortCount);
		expect(Number(countSummary?.[2])).toBe(dependentPortCount);
		expect(portEquipment.ports).toHaveLength(dependentPortCount);
		expect(portEquipment.equipmentGroups).toHaveLength(dependentPortCount);
		assertSourceUnchanged();
	});

	it("rejects an unassigned equipment group when only one of its ports depends on deleted Bay rail", () => {
		const removedRoute = regularCardinalRouteForMembership(
			fixture.document.map,
			fixture.bay.membership.railEdges,
		);
		const retainedRoute = regularCardinalRouteForMembership(
			fixture.document.map,
			fixture.siblingBay.membership.railEdges,
		);
		const portEquipment = Object.freeze({
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports: Object.freeze([
				equipmentPort(1, 1, removedRoute, "STK"),
				equipmentPort(2, 1, retainedRoute, "STK"),
			]),
			equipmentGroups: Object.freeze([
				Object.freeze({
					id: 1,
					kind: "STK" as const,
					portIds: Object.freeze([1, 2]),
					template: "FLEX" as const,
				}),
			]),
		}) satisfies PortEquipmentState;
		expect(portEquipmentStateError(portEquipment)).toBeNull();
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				portEquipment,
				fixture.document.organizations,
			),
		).toBeNull();

		const partialGroupDelete = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			semanticIntent("DELETE", fixture.bay.id),
		);
		assertRejected(partialGroupDelete, "PARTIAL_EQUIPMENT_GROUP");
		expect(partialGroupDelete.plan.reason).toMatch(/1/);
		expect(portEquipment.ports).toHaveLength(2);
		expect(portEquipment.equipmentGroups[0]?.portIds).toEqual([1, 2]);
		assertSourceUnchanged();
	});

	it("rejects either action when it would leave the retained Bank without a semantic Bay", () => {
		const roles = deriveStaticFabOrganizationSemanticRoles(fixture.document.organizations);
		const updates = new Map<number, readonly number[]>();
		for (const record of fixture.document.organizations.records) {
			if (
				record.id !== fixture.bay.id &&
				roles.get(record.id) === "BAY" &&
				staticFabOrganizationParentIds(record).includes(fixture.bank.id)
			) {
				updates.set(record.id, [fixture.otherBank.id]);
			}
		}
		const lastBay = withParentUpdates(fixture.document.organizations, updates);
		expect(
			staticFabOrganizationStateError(
				fixture.document.map,
				fixture.document.portEquipment,
				lastBay,
			),
		).toBeNull();
		for (const action of ["DISCONNECT", "DELETE"] as const) {
			assertRejected(planForState(lastBay, action), "ANCESTOR_COLLAPSE_UNRESOLVED");
		}
		assertSourceUnchanged();
	});

	function planForState(
		organizations: StaticFabOrganizationState,
		action: StaticFabSemanticBayMutationIntent["action"],
	): StaticFabSemanticBayMutationPlanningResult {
		return planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			organizations,
			semanticIntent(action, fixture.bay.id),
		);
	}

	function assertSourceUnchanged(): void {
		expect(fixture.document.map.edgeCount).toBe(fixture.certificate.authored.directedEdges);
		expect(fixture.document.map.size).toBe(fixture.certificate.authored.cells);
		expect(fixture.document.map.getRevision()).toBe(fixture.certificate.authored.revision);
		expect(fixture.document.organizations.records).toHaveLength(63);
		expect(authoredChecksum(fixture.document)).toBe(fixture.sourceChecksum);
	}
});

function semanticIntent(
	action: StaticFabSemanticBayMutationIntent["action"],
	bayOrganizationId: number,
): StaticFabSemanticBayMutationIntent {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action,
		bayOrganizationId,
	});
}

function requireRecord(
	record: StaticFabOrganizationRecord | undefined,
	label: string,
): StaticFabOrganizationRecord {
	if (!record) throw new Error(`Expected ${label} in the default OpenFab Fab fixture.`);
	return record;
}

function requireProspective(
	result: StaticFabSemanticBayMutationPlanningResult,
): NonNullable<StaticFabSemanticBayMutationPlanningResult["prospectiveState"]> {
	expect(result.plan.valid, `${result.plan.issueCode ?? "UNKNOWN"}: ${result.plan.reason}`).toBe(
		true,
	);
	expect(result.prospectiveState).not.toBeNull();
	if (!result.prospectiveState) {
		throw new Error(`${result.plan.issueCode ?? "UNKNOWN"}: ${result.plan.reason}`);
	}
	return result.prospectiveState;
}

function assertRejected(
	result: StaticFabSemanticBayMutationPlanningResult,
	issueCode: StaticFabSemanticBayMutationIssueCode,
): void {
	expect(result.plan).toMatchObject({
		valid: false,
		issueCode,
		review: {
			removedOrganizationIds: [],
			processLoopOrganizationIds: [],
			railModuleKeys: [],
			connectorOutboundDirectedEdgeKeys: [],
			connectorReturnDirectedEdgeKeys: [],
			equipmentGroupIds: [],
			portIds: [],
			retainedCirculationCandidatePresent: false,
			circulationCertification: "PENDING_WORKER_CERTIFICATION",
			issueCode,
		},
	});
	expect(result.prospectiveState).toBeNull();
	expect(result.plan.mutations).toEqual([]);
	expect(result.plan.switchMutations).toEqual([]);
	expect(result.plan.portMutations).toEqual([]);
	expect(result.plan.equipmentGroupMutations).toEqual([]);
	expect(result.plan.organizationMutations).toEqual([]);
}

function assertOrganizationImpactDirection(
	beforeOrganizations: StaticFabOrganizationState,
	beforePortEquipment: PortEquipmentState,
	afterPortEquipment: PortEquipmentState,
	result: StaticFabSemanticBayMutationPlanningResult,
	reverse: boolean,
): void {
	const railChanges = reverse
		? result.plan.mutations.map((mutation) =>
				Object.freeze({
					x: mutation.x,
					y: mutation.y,
					before: mutation.after,
					after: mutation.before,
				}),
			)
		: result.plan.mutations;
	const switchChanges = reverse
		? result.plan.switchMutations.map((mutation) =>
				Object.freeze({ id: mutation.id, before: mutation.after, after: mutation.before }),
			)
		: result.plan.switchMutations;
	const portChanges = reverse
		? result.plan.portMutations.map((mutation) =>
				Object.freeze({ id: mutation.id, before: mutation.after, after: mutation.before }),
			)
		: result.plan.portMutations;
	const equipmentGroupChanges = reverse
		? result.plan.equipmentGroupMutations.map((mutation) =>
				Object.freeze({ id: mutation.id, before: mutation.after, after: mutation.before }),
			)
		: result.plan.equipmentGroupMutations;
	const organizationChanges = reverse
		? reverseStaticFabOrganizationMutations(result.plan.organizationMutations)
		: result.plan.organizationMutations;
	const index = new StaticFabOrganizationImpactIndex();
	index.synchronize(beforeOrganizations);
	const impacts = staticFabOrganizationImpactsForPatch(
		index,
		railChanges,
		switchChanges,
		portChanges,
		equipmentGroupChanges,
		beforePortEquipment,
		afterPortEquipment,
	);
	const impactIds = new Set(impacts.map((owner) => owner.organizationId));
	const authorizations = result.plan.organizationImpactAuthorizations;
	expect(authorizations).toEqual([...new Set(authorizations)].sort((left, right) => left - right));
	for (const organizationId of authorizations) {
		expect(
			impactIds.has(organizationId),
			`${reverse ? "reverse" : "forward"} authorization ${organizationId} must be a current impact`,
		).toBe(true);
		expect(beforeOrganizations.records.some((record) => record.id === organizationId)).toBe(true);
	}
	expect(
		unhandledStaticFabOrganizationImpacts(
			index,
			impacts,
			organizationChanges,
			railChanges,
			switchChanges,
			portChanges,
			equipmentGroupChanges,
			beforePortEquipment,
			afterPortEquipment,
			new Set(authorizations),
		),
	).toEqual([]);
}

function exactModuleKeysForMembership(
	map: TileMap,
	membership: StaticFabOrganizationRecord["membership"],
): readonly string[] {
	const ownership = buildRailModuleOwnershipIndex(map);
	const targetEdgeKeys = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const targetSwitchIds = new Set(membership.advancedSwitchIds);
	const resolvedEdgeKeys = new Set<string>();
	const resolvedSwitchIds = new Set<number>();
	const keys: string[] = [];
	for (const module of ownership.modules) {
		const touches =
			module.eraseEdges.some((edge) => targetEdgeKeys.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && targetSwitchIds.has(module.advancedSwitchId));
		if (!touches) continue;
		expect(
			module.eraseEdges.every((edge) => targetEdgeKeys.has(staticFabOrganizationEdgeKey(edge))),
			`membership partially included module ${module.key}`,
		).toBe(true);
		if (module.advancedSwitchId !== null) {
			expect(targetSwitchIds.has(module.advancedSwitchId)).toBe(true);
			resolvedSwitchIds.add(module.advancedSwitchId);
		}
		keys.push(module.key);
		for (const edge of module.eraseEdges) {
			resolvedEdgeKeys.add(staticFabOrganizationEdgeKey(edge));
		}
	}
	expect([...resolvedEdgeKeys].sort()).toEqual([...targetEdgeKeys].sort());
	expect([...resolvedSwitchIds].sort((left, right) => left - right)).toEqual(
		[...targetSwitchIds].sort((left, right) => left - right),
	);
	return Object.freeze(keys.sort());
}

function assertExactDirectedEdgeOwnership(
	map: TileMap,
	organizations: StaticFabOrganizationState,
): void {
	const edgeKeys = organizations.records.flatMap((record) =>
		record.membership.railEdges.map(staticFabOrganizationEdgeKey),
	);
	expect(edgeKeys).toHaveLength(map.edgeCount);
	expect(new Set(edgeKeys)).toHaveLength(map.edgeCount);
}

function assertSourceToProspectivePatch(
	document: RailDocument,
	result: StaticFabSemanticBayMutationPlanningResult,
	prospectiveMap: TileMap,
	prospectiveOrganizations: StaticFabOrganizationState,
): void {
	const mutationCells = new Set(
		result.plan.mutations.map((mutation) => `${mutation.x}:${mutation.y}`),
	);
	expect(mutationCells).toHaveLength(result.plan.mutations.length);
	for (const mutation of result.plan.mutations) {
		expect(document.map.getEncoded(mutation.x, mutation.y)).toBe(mutation.before);
		expect(prospectiveMap.getEncoded(mutation.x, mutation.y)).toBe(mutation.after);
	}

	const organizationIds = new Set(result.plan.organizationMutations.map((mutation) => mutation.id));
	expect(organizationIds).toHaveLength(result.plan.organizationMutations.length);
	const sourceById = new Map(document.organizations.records.map((record) => [record.id, record]));
	const prospectiveById = new Map(
		prospectiveOrganizations.records.map((record) => [record.id, record]),
	);
	for (const mutation of result.plan.organizationMutations) {
		expect(mutation.before).toEqual(sourceById.get(mutation.id) ?? null);
		expect(mutation.after).toEqual(prospectiveById.get(mutation.id) ?? null);
	}
}

function withParentUpdates(
	state: StaticFabOrganizationState,
	parentIdsByRecordId: ReadonlyMap<number, readonly number[]>,
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId: state.nextOrganizationId,
		records: Object.freeze(
			state.records.map((record) => {
				const parentOrganizationIds = parentIdsByRecordId.get(record.id);
				return parentOrganizationIds
					? updateStaticFabOrganizationRecordMetadata(record, { parentOrganizationIds })
					: record;
			}),
		),
	});
}

function regularCardinalRouteForMembership(
	map: TileMap,
	edges: StaticFabOrganizationRecord["membership"]["railEdges"],
): CardinalPortRoute {
	const edgeKeys = new Set(edges.map(staticFabOrganizationEdgeKey));
	const cells = new Map<string, Readonly<{ x: number; y: number }>>();
	for (const edge of edges) {
		cells.set(`${edge.from.x}:${edge.from.y}`, edge.from);
		cells.set(`${edge.to.x}:${edge.to.y}`, edge.to);
	}
	const orderedCells = [...cells.values()].sort(
		(left, right) => left.x - right.x || left.y - right.y,
	);
	for (const cell of orderedCells) {
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) continue;
		const from = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
		const to = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0);
		if (from === undefined || to === undefined) continue;
		const source = moveCell(cell, from);
		const target = moveCell(cell, to);
		const sourceRail = map.getRail(source.x, source.y);
		const targetRail = map.getRail(target.x, target.y);
		if (
			!edgeKeys.has(staticFabOrganizationEdgeKey({ from: source, to: { x: cell.x, y: cell.y } })) ||
			!edgeKeys.has(staticFabOrganizationEdgeKey({ from: { x: cell.x, y: cell.y }, to: target })) ||
			from === to ||
			bitCount(sourceRail.incoming) !== 1 ||
			bitCount(sourceRail.outgoing) !== 1 ||
			bitCount(targetRail.incoming) !== 1 ||
			bitCount(targetRail.outgoing) !== 1
		) {
			continue;
		}
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: cell.x,
			z: cell.y,
			from: from as Direction,
			to: to as Direction,
		});
	}
	throw new Error("Expected a complete regular cardinal route in organization membership.");
}

function equipmentPort(
	id: number,
	equipmentGroupId: number,
	route: CardinalPortRoute,
	portType: PortRecord["portType"] = "EQ",
): PortRecord {
	return Object.freeze({
		id,
		equipmentGroupId,
		route,
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType,
		barcode: null,
	});
}

function regularCardinalRouteAt(map: TileMap, x: number, y: number): CardinalPortRoute {
	const rail = map.getRail(x, y);
	if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) {
		throw new Error(`Expected a regular cardinal route at ${x}:${y}.`);
	}
	const from = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
	const to = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0);
	if (from === undefined || to === undefined) {
		throw new Error(`Expected directed route ends at ${x}:${y}.`);
	}
	return Object.freeze({ kind: "CARDINAL_CELL", x, z: y, from, to });
}

function singleFlexEquipmentState(route: CardinalPortRoute): PortEquipmentState {
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([equipmentPort(1, 1, route, "STK")]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "STK",
				portIds: Object.freeze([1]),
				template: "FLEX",
			}),
		]),
	});
}

function authoredChecksum(document: RailDocument): string {
	return authoredChecksumForState(document.map, document.portEquipment, document.organizations);
}

function authoredChecksumForState(
	map: TileMap,
	portEquipment: RailDocument["portEquipment"],
	organizations: StaticFabOrganizationState,
): string {
	return captureRailMirrorSnapshot(map, 0, portEquipment, organizations).snapshot.checksum;
}
