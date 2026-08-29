import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { CardinalPortRoute, PortRecord } from "../core/PortRecord";
import type { RailDocument } from "../core/RailDocument";
import { ALL_DIRECTIONS, bitCount, type Direction, moveCell } from "../core/railShape";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import {
	planStaticFabSemanticBayMutationWithProspectiveState,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
	type StaticFabSemanticBayMutationIntent,
} from "../core/StaticFabSemanticBayMutation";
import {
	adoptStaticFabSemanticBayMutationWorkerPlan,
	consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor,
	isIssuedStaticFabSemanticBayMutationPlan,
	isStaticFabSemanticBayMutationPlanIssuedFor,
	issueStaticFabSemanticBayMutationPermit,
	revokeStaticFabSemanticBayMutationPermit,
	staticFabSemanticBayMutationIntentFingerprint,
	staticFabSemanticBayMutationPlanFingerprint,
} from "../core/StaticFabSemanticBayMutationCertification";
import type { TileMap } from "../core/TileMap";
import {
	captureRailMirrorSnapshot,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PrepareBoundStaticFabSemanticBayMutationRequest,
	type PreparedStaticFabSemanticBayMutation,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
} from "./StaticFabSemanticBayMutationProtocol";
import { staticFabSemanticBayMutationPreparedShapeError } from "./StaticFabSemanticBayMutationResponseValidator";
import {
	hydrateStaticFabSemanticBayMutationSession,
	prepareStaticFabSemanticBayMutationInSession,
	type StaticFabSemanticBayMutationRuntimeSession,
} from "./StaticFabSemanticBayMutationRuntime";

interface Fixture {
	readonly certificate: CertifiedOpenFabFabComposition;
	readonly document: RailDocument;
	readonly snapshot: RailMirrorSnapshot;
	readonly session: StaticFabSemanticBayMutationRuntimeSession;
	readonly bay: StaticFabOrganizationRecord;
	readonly siblingBay: StaticFabOrganizationRecord;
	readonly disconnectPrepared: PreparedStaticFabSemanticBayMutation;
	readonly deletePrepared: PreparedStaticFabSemanticBayMutation;
}

describe("StaticFabSemanticBayMutation disposable Worker certification", () => {
	let fixture: Fixture;

	beforeAll(() => {
		const certificate = composeOpenFabFab(defaultOpenFabFabProfile());
		const snapshot = certificate.roundTrippedSnapshot;
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const bays = document.organizations.records.filter((record) => roles.get(record.id) === "BAY");
		const bay = requireRecord(bays[0], "default semantic Bay");
		const siblingBay = requireRecord(
			bays.find(
				(record) =>
					record.id !== bay.id &&
					staticFabOrganizationParentIds(record)[0] === staticFabOrganizationParentIds(bay)[0],
			),
			"sibling semantic Bay",
		);
		const session = hydrateStaticFabSemanticBayMutationSession(snapshot);
		const disconnectPrepared = prepare(session, semanticIntent("DISCONNECT", bay.id), 10);
		const deletePrepared = prepare(session, semanticIntent("DELETE", bay.id), 11);
		fixture = Object.freeze({
			certificate,
			document,
			snapshot,
			session,
			bay,
			siblingBay,
			disconnectPrepared,
			deletePrepared,
		});
	}, 120_000);

	it("certifies attached Disconnect/Delete with exact physical evidence and checksum parity", () => {
		const disconnect = requirePrepared(fixture.disconnectPrepared);
		const attachedDelete = requirePrepared(fixture.deletePrepared);

		expect(staticFabSemanticBayMutationPreparedShapeError(disconnect)).toBeNull();
		expect(staticFabSemanticBayMutationPreparedShapeError(attachedDelete)).toBeNull();
		expect(disconnect.review).toBe(disconnect.plan.review);
		expect(disconnect.sourceEvidence).toMatchObject({
			authoredStatus: "closed",
			authoredComponentCount: 1,
			authoredStrongComponentCount: 1,
			authoredOpenTerminalCount: 0,
			authoredUnsafeJunctionCount: 0,
			authoredComponentsClosed: true,
			physicalValid: true,
			physicalComponentCount: 1,
			physicalStrongComponentCount: 1,
			physicalOpenPathCount: 0,
			physicalInvalidPathCount: 0,
			physicalDiagnosticCount: 0,
			physicalTerminalCount: 0,
			physicalClearanceIssueCount: 0,
			physicalComponentsClosed: true,
		});
		expect(disconnect.prospectiveEvidence).toMatchObject({
			authoredStatus: "disconnected",
			authoredComponentCount: 2,
			authoredStrongComponentCount: 2,
			physicalComponentCount: 2,
			physicalStrongComponentCount: 2,
			authoredComponentsClosed: true,
			physicalComponentsClosed: true,
		});
		expect(attachedDelete.prospectiveEvidence).toMatchObject({
			authoredStatus: "closed",
			authoredComponentCount: 1,
			authoredStrongComponentCount: 1,
			physicalComponentCount: 1,
			physicalStrongComponentCount: 1,
			authoredComponentsClosed: true,
			physicalComponentsClosed: true,
		});
		expect(disconnect.ticket.prospectiveChecksum).toBe(
			incrementalChecksum(fixture.snapshot, disconnect.plan),
		);
		expect(attachedDelete.ticket.prospectiveChecksum).toBe(
			incrementalChecksum(fixture.snapshot, attachedDelete.plan),
		);
		expect("simulationReady" in disconnect.ticket).toBe(false);
		expect(fixture.snapshot.checksum).toBe(fixture.session.sourceIdentity.checksum);
		expect("snapshot" in fixture.session).toBe(false);
		expect("sourceLayout" in fixture.session).toBe(false);
	});

	it("supports repeated editing over multiple closed components and detached Delete", () => {
		const firstDisconnect = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			semanticIntent("DISCONNECT", fixture.bay.id),
		);
		if (!firstDisconnect.plan.valid || !firstDisconnect.prospectiveState) {
			throw new Error(firstDisconnect.plan.reason);
		}
		const disconnected = firstDisconnect.prospectiveState;
		const disconnectedSnapshot = captureRailMirrorSnapshot(
			disconnected.map,
			fixture.document.getPatchSequence() + 1,
			disconnected.portEquipment,
			disconnected.organizations,
		).snapshot;
		const disconnectedSession = hydrateStaticFabSemanticBayMutationSession(disconnectedSnapshot);

		const secondDisconnect = requirePrepared(
			prepare(disconnectedSession, semanticIntent("DISCONNECT", fixture.siblingBay.id), 20),
		);
		expect(secondDisconnect.sourceEvidence.authoredComponentCount).toBe(2);
		expect(secondDisconnect.sourceEvidence.physicalComponentCount).toBe(2);
		expect(secondDisconnect.prospectiveEvidence.authoredComponentCount).toBe(3);
		expect(secondDisconnect.prospectiveEvidence.physicalComponentCount).toBe(3);
		expect(staticFabSemanticBayMutationPreparedShapeError(secondDisconnect)).toBeNull();

		const attachedDelete = requirePrepared(
			prepare(disconnectedSession, semanticIntent("DELETE", fixture.siblingBay.id), 21),
		);
		expect(attachedDelete.plan.review.incidentConnectorCount).toBe(1);
		expect(attachedDelete.sourceEvidence.authoredComponentCount).toBe(2);
		expect(attachedDelete.prospectiveEvidence.authoredComponentCount).toBe(2);
		expect(attachedDelete.prospectiveEvidence.physicalComponentCount).toBe(2);

		const detachedDelete = requirePrepared(
			prepare(disconnectedSession, semanticIntent("DELETE", fixture.bay.id), 22),
		);
		expect(detachedDelete.plan.review).toMatchObject({
			incidentConnectorCount: 0,
			bankOrganizationId: null,
			retainedCirculationCandidatePresent: false,
		});
		expect(detachedDelete.sourceEvidence.authoredComponentCount).toBe(2);
		expect(detachedDelete.prospectiveEvidence.authoredComponentCount).toBe(1);
		expect(detachedDelete.prospectiveEvidence.physicalComponentCount).toBe(1);
		expect(detachedDelete.prospectiveEvidence.authoredComponentsClosed).toBe(true);
		expect(detachedDelete.prospectiveEvidence.physicalComponentsClosed).toBe(true);
		expect(staticFabSemanticBayMutationPreparedShapeError(detachedDelete)).toBeNull();
	}, 120_000);

	it("reconstructs and certifies exact prospective port/equipment removals", () => {
		const portEquipment = singleFlexEquipmentState(
			regularCardinalRouteForMembership(fixture.document.map, fixture.bay.membership.railEdges),
		);
		const snapshot = captureRailMirrorSnapshot(
			fixture.document.map,
			fixture.document.getPatchSequence(),
			portEquipment,
			fixture.document.organizations,
		).snapshot;
		const session = hydrateStaticFabSemanticBayMutationSession(snapshot);
		const prepared = requirePrepared(
			prepare(session, semanticIntent("DELETE", fixture.bay.id), 23),
		);

		expect(prepared.plan.review).toMatchObject({
			portCount: 1,
			portIds: [1],
			equipmentGroupCount: 1,
			equipmentGroupIds: [1],
		});
		expect(prepared.plan.portMutations).toEqual([
			{ id: 1, before: portEquipment.ports[0], after: null },
		]);
		expect(prepared.plan.equipmentGroupMutations).toEqual([
			{ id: 1, before: portEquipment.equipmentGroups[0], after: null },
		]);
		expect(prepared.ticket.prospectiveChecksum).toBe(incrementalChecksum(snapshot, prepared.plan));
		expect(prepared.prospectiveEvidence).toMatchObject({
			authoredComponentsClosed: true,
			physicalValid: true,
			physicalComponentsClosed: true,
		});
		expect(staticFabSemanticBayMutationPreparedShapeError(prepared)).toBeNull();
	}, 120_000);

	it("adopts a deep-cloned source-bound plan once and consumes certification once", () => {
		const intent = semanticIntent("DELETE", fixture.bay.id);
		const permit = issueStaticFabSemanticBayMutationPermit(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			intent,
			fixture.snapshot.checksum,
		);
		const prepared = requirePrepared(prepare(fixture.session, intent, permit.ticketId));
		const workerPlan = structuredClone(prepared.plan);
		const workerTicket = structuredClone(prepared.ticket);
		const expectedChecksum = incrementalChecksum(fixture.snapshot, workerPlan);
		const adopted = adoptStaticFabSemanticBayMutationWorkerPlan(
			permit,
			workerTicket,
			workerPlan,
			expectedChecksum,
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			intent,
		);
		const adoptedFingerprint = staticFabSemanticBayMutationPlanFingerprint(adopted);
		const adoptedModuleKey = adopted.review.railModuleKeys[0];

		const mutableReview = workerPlan.review as unknown as {
			railModuleKeys: string[];
		};
		mutableReview.railModuleKeys[0] = "tampered-after-adoption";
		expect(adopted).not.toBe(workerPlan);
		expect(adopted.review).not.toBe(workerPlan.review);
		expect(adopted.review.railModuleKeys[0]).toBe(adoptedModuleKey);
		expect(staticFabSemanticBayMutationPlanFingerprint(adopted)).toBe(adoptedFingerprint);
		expect(isIssuedStaticFabSemanticBayMutationPlan(workerPlan)).toBe(false);
		expect(isIssuedStaticFabSemanticBayMutationPlan(adopted)).toBe(true);
		expect(
			isStaticFabSemanticBayMutationPlanIssuedFor(
				adopted,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor(
				adopted,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor(
				adopted,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(false);
		expect(() =>
			adoptStaticFabSemanticBayMutationWorkerPlan(
				permit,
				workerTicket,
				prepared.plan,
				expectedChecksum,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.getPatchSequence(),
				fixture.document.organizations,
				intent,
			),
		).toThrow(/missing|consumed/i);
	}, 120_000);

	it("consumes failed/revoked permits and rejects plan, checksum, and deleted-owner tampering", () => {
		const intent = semanticIntent("DELETE", fixture.bay.id);
		const permit = issueStaticFabSemanticBayMutationPermit(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			intent,
			fixture.snapshot.checksum,
		);
		const prepared = requirePrepared(prepare(fixture.session, intent, permit.ticketId));
		const tampered = structuredClone(prepared.plan);
		(tampered as { reason: string }).reason = "tampered";
		expect(() =>
			adoptStaticFabSemanticBayMutationWorkerPlan(
				permit,
				prepared.ticket,
				tampered,
				prepared.ticket.prospectiveChecksum,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.getPatchSequence(),
				fixture.document.organizations,
				intent,
			),
		).toThrow(/fingerprint diverged/i);
		expect(() =>
			adoptStaticFabSemanticBayMutationWorkerPlan(
				permit,
				prepared.ticket,
				prepared.plan,
				prepared.ticket.prospectiveChecksum,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.getPatchSequence(),
				fixture.document.organizations,
				intent,
			),
		).toThrow(/missing|consumed/i);

		const revoked = issueStaticFabSemanticBayMutationPermit(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			intent,
			fixture.snapshot.checksum,
		);
		revokeStaticFabSemanticBayMutationPermit(revoked);
		expect(() =>
			adoptStaticFabSemanticBayMutationWorkerPlan(
				revoked,
				prepared.ticket,
				prepared.plan,
				prepared.ticket.prospectiveChecksum,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.getPatchSequence(),
				fixture.document.organizations,
				intent,
			),
		).toThrow(/missing|consumed/i);
	});

	it("rejects malformed or authority-bearing responses before main-realm adoption", () => {
		const valid = structuredClone(requirePrepared(fixture.deletePrepared));
		expect(staticFabSemanticBayMutationPreparedShapeError(valid)).toBeNull();

		const mismatchedReview = structuredClone(valid);
		(
			mismatchedReview as unknown as {
				review: Record<string, unknown>;
			}
		).review = {
			...(mismatchedReview.review as unknown as Record<string, unknown>),
			bayName: "different",
		};
		expect(staticFabSemanticBayMutationPreparedShapeError(mismatchedReview)).toMatch(
			/exactly match/,
		);

		const forgedTopology = structuredClone(valid);
		(
			forgedTopology.prospectiveEvidence as { physicalComponentCount: number }
		).physicalComponentCount += 1;
		expect(staticFabSemanticBayMutationPreparedShapeError(forgedTopology)).toMatch(
			/parity|delta|closed/,
		);

		const connectorlessDisconnect = structuredClone(requirePrepared(fixture.disconnectPrepared));
		for (const review of [connectorlessDisconnect.plan.review, connectorlessDisconnect.review]) {
			(review as { incidentConnectorCount: number }).incidentConnectorCount = 0;
			(review as { bankOrganizationId: number | null }).bankOrganizationId = null;
		}
		expect(staticFabSemanticBayMutationPreparedShapeError(connectorlessDisconnect)).toMatch(
			/connector|Bank/,
		);

		const deletedOwnerAuthorization = structuredClone(valid);
		const deletedId = deletedOwnerAuthorization.plan.review.removedOrganizationIds[0] as number;
		const currentIds = deletedOwnerAuthorization.plan.organizationImpactAuthorizations as number[];
		(
			deletedOwnerAuthorization.plan as unknown as {
				organizationImpactAuthorizations: number[];
			}
		).organizationImpactAuthorizations = [...new Set([...currentIds, deletedId])].sort(
			(left, right) => left - right,
		);
		expect(staticFabSemanticBayMutationPreparedShapeError(deletedOwnerAuthorization)).toMatch(
			/deleted by the same patch/,
		);

		const unknownField = structuredClone(valid) as unknown as Record<string, unknown>;
		unknownField.unexpected = true;
		expect(staticFabSemanticBayMutationPreparedShapeError(unknownField)).toMatch(/fields/);

		const missingBay = prepare(fixture.session, semanticIntent("DELETE", 0x7fff_ffff), 99);
		expect(missingBay.valid).toBe(false);
		expect(staticFabSemanticBayMutationPreparedShapeError(missingBay)).toBeNull();
		const armedRejection = structuredClone(missingBay);
		if (!armedRejection.plan) throw new Error("Expected a compact rejected plan.");
		(armedRejection.plan.mutations as unknown as Array<Record<string, number>>).push({
			x: 0,
			y: 0,
			before: 1,
			after: 2,
		});
		expect(staticFabSemanticBayMutationPreparedShapeError(armedRejection)).toMatch(
			/authored authority/,
		);
	});

	it("rejects aggregate before/after organization membership reference amplification", () => {
		const corruptions = [
			{
				label: "rail edges",
				apply(before: MutableOrganizationMembership, after: MutableOrganizationMembership): void {
					const edge = before.railEdges[0] ?? {
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
					};
					const references = new Array(500_001).fill(edge);
					before.railEdges = references;
					after.railEdges = references;
				},
			},
			{
				label: "advanced switches",
				apply(before: MutableOrganizationMembership, after: MutableOrganizationMembership): void {
					const references = Array.from({ length: 32_769 }, (_, index) => index + 1);
					before.advancedSwitchIds = references;
					after.advancedSwitchIds = references;
				},
			},
			{
				label: "equipment groups",
				apply(before: MutableOrganizationMembership, after: MutableOrganizationMembership): void {
					const references = Array.from({ length: 32_769 }, (_, index) => index + 1);
					before.equipmentGroupIds = references;
					after.equipmentGroupIds = references;
				},
			},
		] as const;

		for (const corruption of corruptions) {
			const hostile = structuredClone(requirePrepared(fixture.disconnectPrepared));
			const mutation = hostile.plan.organizationMutations.find(
				(candidate) => candidate.before !== null && candidate.after !== null,
			);
			if (!mutation?.before || !mutation.after) {
				throw new Error("Expected Disconnect to preserve at least one changed organization.");
			}
			corruption.apply(
				mutation.before.membership as MutableOrganizationMembership,
				mutation.after.membership as MutableOrganizationMembership,
			);
			expect(staticFabSemanticBayMutationPreparedShapeError(hostile), corruption.label).toMatch(
				/organization membership references exceed their aggregate budget/,
			);
		}
	});
});

interface MutableOrganizationMembership {
	railEdges: Array<StaticFabOrganizationRecord["membership"]["railEdges"][number]>;
	advancedSwitchIds: number[];
	equipmentGroupIds: number[];
}

function prepare(
	session: StaticFabSemanticBayMutationRuntimeSession,
	intent: StaticFabSemanticBayMutationIntent,
	ticketId: number,
): PreparedStaticFabSemanticBayMutation {
	const request: PrepareBoundStaticFabSemanticBayMutationRequest = {
		type: "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
		requestId: ticketId,
		ticketId,
		intent,
		expectedIntentFingerprint: staticFabSemanticBayMutationIntentFingerprint(intent),
		expectedSource: session.sourceIdentity,
	};
	return prepareStaticFabSemanticBayMutationInSession(request, session);
}

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

function requirePrepared(
	prepared: PreparedStaticFabSemanticBayMutation,
): PreparedStaticFabSemanticBayMutation & {
	readonly valid: true;
	readonly plan: NonNullable<PreparedStaticFabSemanticBayMutation["plan"]>;
	readonly review: NonNullable<PreparedStaticFabSemanticBayMutation["review"]>;
	readonly ticket: NonNullable<PreparedStaticFabSemanticBayMutation["ticket"]>;
	readonly sourceEvidence: NonNullable<PreparedStaticFabSemanticBayMutation["sourceEvidence"]>;
	readonly prospectiveEvidence: NonNullable<
		PreparedStaticFabSemanticBayMutation["prospectiveEvidence"]
	>;
} {
	if (
		!prepared.valid ||
		!prepared.plan ||
		!prepared.review ||
		!prepared.ticket ||
		!prepared.sourceEvidence ||
		!prepared.prospectiveEvidence
	) {
		throw new Error(`Expected exact semantic Bay Worker proof: ${prepared.reason}`);
	}
	return prepared as ReturnType<typeof requirePrepared>;
}

function incrementalChecksum(
	snapshot: RailMirrorSnapshot,
	plan: NonNullable<PreparedStaticFabSemanticBayMutation["plan"]>,
): string {
	return checksumRailPatchResult(snapshot.checksum, {
		changes: plan.mutations,
		switchChanges: plan.switchMutations,
		portChanges: plan.portMutations,
		equipmentGroupChanges: plan.equipmentGroupMutations,
		organizationChanges: plan.organizationMutations,
		organizationNextIdBefore: plan.nextOrganizationIdBefore,
		organizationNextIdAfter: plan.nextOrganizationIdAfter,
	});
}

function requireRecord(
	record: StaticFabOrganizationRecord | undefined,
	label: string,
): StaticFabOrganizationRecord {
	if (!record) throw new Error(`Expected ${label}.`);
	return record;
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
	for (const cell of [...cells.values()].sort(
		(left, right) => left.x - right.x || left.y - right.y,
	)) {
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) continue;
		const from = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0);
		const to = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0);
		if (from === undefined || to === undefined || from === to) continue;
		const source = moveCell(cell, from);
		const target = moveCell(cell, to);
		const sourceRail = map.getRail(source.x, source.y);
		const targetRail = map.getRail(target.x, target.y);
		if (
			!edgeKeys.has(staticFabOrganizationEdgeKey({ from: source, to: { x: cell.x, y: cell.y } })) ||
			!edgeKeys.has(staticFabOrganizationEdgeKey({ from: { x: cell.x, y: cell.y }, to: target })) ||
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
	throw new Error("Expected a complete regular cardinal route in Bay membership.");
}

function singleFlexEquipmentState(route: CardinalPortRoute): PortEquipmentState {
	const port = Object.freeze({
		id: 1,
		equipmentGroupId: 1,
		route,
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "STK",
		barcode: null,
	}) satisfies PortRecord;
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([port]),
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
