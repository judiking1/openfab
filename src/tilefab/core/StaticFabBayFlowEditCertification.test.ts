import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "./EquipmentGroup";
import {
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
	type StaticFabBayFlowEditPlan,
} from "./StaticFabBayFlowEdit";
import {
	adoptStaticFabBayFlowEditWorkerPlan,
	consumeCertifiedStaticFabBayFlowEditPlanIssuedFor,
	isIssuedStaticFabBayFlowEditPlan,
	isStaticFabBayFlowEditPlanIssuedFor,
	issueStaticFabBayFlowEditPermit,
	revokeStaticFabBayFlowEditPermit,
	type StaticFabBayFlowEditPermit,
	type StaticFabBayFlowEditWorkerTicket,
	staticFabBayFlowEditIntentFingerprint,
	staticFabBayFlowEditPlanFingerprint,
} from "./StaticFabBayFlowEditCertification";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { TileMap } from "./TileMap";

describe("StaticFabBayFlowEditCertification", () => {
	it("adopts an exact deep copy and consumes its document-bound certification once", () => {
		const proof = workerProof();
		const workerPlan = structuredClone(proof.plan);
		const workerTicket = structuredClone(proof.ticket);

		expect(() =>
			adoptStaticFabBayFlowEditWorkerPlan(
				structuredClone(proof.permit) as StaticFabBayFlowEditPermit,
				workerTicket,
				workerPlan,
				workerTicket.prospectiveChecksum,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.patchSequence,
				proof.fixture.organizations,
				proof.fixture.intent,
			),
		).toThrow(/missing|consumed/i);

		const adopted = adoptStaticFabBayFlowEditWorkerPlan(
			proof.permit,
			workerTicket,
			workerPlan,
			workerTicket.prospectiveChecksum,
			proof.fixture.map,
			proof.fixture.portEquipment,
			proof.fixture.patchSequence,
			proof.fixture.organizations,
			proof.fixture.intent,
		);

		expect(adopted).toEqual(workerPlan);
		expect(adopted).not.toBe(workerPlan);
		expect(adopted.review).not.toBe(workerPlan.review);
		expect(adopted.organizationMutations).not.toBe(workerPlan.organizationMutations);
		expect(isIssuedStaticFabBayFlowEditPlan(workerPlan)).toBe(false);
		expect(isIssuedStaticFabBayFlowEditPlan(adopted)).toBe(true);
		expect(
			isStaticFabBayFlowEditPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(false);
		expect(isIssuedStaticFabBayFlowEditPlan(adopted)).toBe(false);
	});

	it("deep-copies review and organization graphs before granting certification", () => {
		const proof = workerProof();
		const workerPlan = structuredClone(proof.plan);
		const adopted = adoptStaticFabBayFlowEditWorkerPlan(
			proof.permit,
			proof.ticket,
			workerPlan,
			proof.ticket.prospectiveChecksum,
			proof.fixture.map,
			proof.fixture.portEquipment,
			proof.fixture.patchSequence,
			proof.fixture.organizations,
			proof.fixture.intent,
		);
		const fingerprint = staticFabBayFlowEditPlanFingerprint(adopted);
		const connectorKey = adopted.review.connectorBankToBayDirectedEdgeKeys[0];
		const organizationEdgeX =
			adopted.organizationMutations[0]?.after?.membership.railEdges[0]?.from.x;

		const mutableReview = workerPlan.review as unknown as {
			connectorBankToBayDirectedEdgeKeys: string[];
		};
		const mutableAfter = workerPlan.organizationMutations[0]?.after as unknown as {
			membership: { railEdges: Array<{ from: { x: number } }> };
		};
		mutableReview.connectorBankToBayDirectedEdgeKeys[0] = "tampered";
		const mutableEdge = mutableAfter.membership.railEdges[0];
		if (!mutableEdge) throw new Error("Expected a copied organization edge.");
		mutableEdge.from.x += 1_000;

		expect(adopted.review.connectorBankToBayDirectedEdgeKeys[0]).toBe(connectorKey);
		expect(adopted.organizationMutations[0]?.after?.membership.railEdges[0]?.from.x).toBe(
			organizationEdgeX,
		);
		expect(staticFabBayFlowEditPlanFingerprint(adopted)).toBe(fingerprint);
		expect(
			consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(true);
	});

	it("consumes failed permits and rejects malformed, forged, and projection-mismatched evidence", () => {
		const malformed = workerProof();
		expect(() =>
			adoptStaticFabBayFlowEditWorkerPlan(
				malformed.permit,
				null as unknown as StaticFabBayFlowEditWorkerTicket,
				malformed.plan,
				malformed.ticket.prospectiveChecksum,
				malformed.fixture.map,
				malformed.fixture.portEquipment,
				malformed.fixture.patchSequence,
				malformed.fixture.organizations,
				malformed.fixture.intent,
			),
		).toThrow(/malformed/i);
		expect(() => adoptProof(malformed)).toThrow(/missing|consumed/i);

		const forgedProjection = workerProof();
		const projectionTicket = {
			...forgedProjection.ticket,
			targetAuthoredProjectionFingerprint: "forged-target-projection",
		};
		expect(() => adoptProof(forgedProjection, projectionTicket)).toThrow(/stale|invalid/i);
		expect(() => adoptProof(forgedProjection)).toThrow(/missing|consumed/i);

		const forgedPlan = workerProof();
		const tamperedPlan = structuredClone(forgedPlan.plan);
		(tamperedPlan as { reason: string }).reason = "tampered after Worker proof";
		expect(() => adoptProof(forgedPlan, forgedPlan.ticket, tamperedPlan)).toThrow(
			/fingerprint diverged/i,
		);

		const foreignTicket = workerProof();
		const wrongTicket = { ...foreignTicket.ticket, ticketId: foreignTicket.ticket.ticketId + 1 };
		expect(() => adoptProof(foreignTicket, wrongTicket)).toThrow(/ticket|permit/i);
	});

	it("rejects revoked, replayed, foreign-identity, and live-drift capabilities", () => {
		const revoked = workerProof();
		revokeStaticFabBayFlowEditPermit(revoked.permit);
		expect(() => adoptProof(revoked)).toThrow(/missing|consumed/i);

		const replayed = workerProof();
		adoptProof(replayed);
		expect(() => adoptProof(replayed)).toThrow(/missing|consumed/i);

		const foreign = workerProof();
		const differentOrganizations = Object.freeze({
			...foreign.fixture.organizations,
			records: Object.freeze([...foreign.fixture.organizations.records]),
		});
		expect(() =>
			adoptStaticFabBayFlowEditWorkerPlan(
				foreign.permit,
				foreign.ticket,
				foreign.plan,
				foreign.ticket.prospectiveChecksum,
				foreign.fixture.map,
				foreign.fixture.portEquipment,
				foreign.fixture.patchSequence,
				differentOrganizations,
				foreign.fixture.intent,
			),
		).toThrow(/live document/i);

		const stale = workerProof();
		stale.fixture.map.setEncoded(100, 100, 0x12);
		expect(() => adoptProof(stale)).toThrow(/live document/i);
	});

	it("binds intent, every cursor, plan fingerprint, and prospective checksum", () => {
		const base = workerProof();
		const changedIntent: StaticFabBayFlowEditIntent = Object.freeze({
			...base.fixture.intent,
			targetInternalFlowPattern: "alternating",
		});
		expect(() =>
			adoptStaticFabBayFlowEditWorkerPlan(
				base.permit,
				base.ticket,
				base.plan,
				base.ticket.prospectiveChecksum,
				base.fixture.map,
				base.fixture.portEquipment,
				base.fixture.patchSequence,
				base.fixture.organizations,
				changedIntent,
			),
		).toThrow(/intent/i);

		for (const key of [
			"sourceNextAdvancedSwitchId",
			"sourceNextPortId",
			"sourceNextEquipmentGroupId",
			"sourceNextOrganizationId",
			"prospectiveNextAdvancedSwitchId",
			"prospectiveNextPortId",
			"prospectiveNextEquipmentGroupId",
			"prospectiveNextOrganizationId",
		] as const) {
			const proof = workerProof();
			const ticket = { ...proof.ticket, [key]: proof.ticket[key] + 1 };
			expect(() => adoptProof(proof, ticket), key).toThrow(/ticket|permit/i);
		}

		const checksum = workerProof();
		expect(() =>
			adoptProof(
				checksum,
				checksum.ticket,
				checksum.plan,
				`${checksum.ticket.prospectiveChecksum}:wrong`,
			),
		).toThrow(/ticket|permit/i);
	});

	it("fingerprints both authored projections and rejects invalid intents", () => {
		const proof = workerProof();
		const sourceChanged = structuredClone(proof.plan);
		(
			sourceChanged.review as { sourceAuthoredProjectionFingerprint: string }
		).sourceAuthoredProjectionFingerprint = "other-source";
		const targetChanged = structuredClone(proof.plan);
		(
			targetChanged.review as { targetAuthoredProjectionFingerprint: string }
		).targetAuthoredProjectionFingerprint = "other-target";

		expect(staticFabBayFlowEditPlanFingerprint(sourceChanged)).not.toBe(
			staticFabBayFlowEditPlanFingerprint(proof.plan),
		);
		expect(staticFabBayFlowEditPlanFingerprint(targetChanged)).not.toBe(
			staticFabBayFlowEditPlanFingerprint(proof.plan),
		);
		expect(() =>
			staticFabBayFlowEditIntentFingerprint({
				...proof.fixture.intent,
				targetInternalFlowPattern: "invalid",
			} as unknown as StaticFabBayFlowEditIntent),
		).toThrow(/target pattern/i);
	});
});

interface CertificationFixture {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly patchSequence: number;
	readonly intent: StaticFabBayFlowEditIntent;
	readonly sourceChecksum: string;
	readonly prospectiveChecksum: string;
}

interface WorkerProof {
	readonly fixture: CertificationFixture;
	readonly permit: StaticFabBayFlowEditPermit;
	readonly plan: StaticFabBayFlowEditPlan;
	readonly ticket: StaticFabBayFlowEditWorkerTicket;
}

function workerProof(): WorkerProof {
	const fixture = certificationFixture();
	const plan = flowEditPlan(fixture);
	const permit = issueStaticFabBayFlowEditPermit(
		fixture.map,
		fixture.portEquipment,
		fixture.patchSequence,
		fixture.organizations,
		fixture.intent,
		fixture.sourceChecksum,
	);
	const ticket = Object.freeze({
		ticketId: permit.ticketId,
		validationLevel: "exact" as const,
		sourceRevision: fixture.map.getRevision(),
		sourcePatchSequence: fixture.patchSequence,
		sourceChecksum: fixture.sourceChecksum,
		sourceNextAdvancedSwitchId: fixture.map.getAdvancedSwitchIdCursor(),
		sourceNextPortId: fixture.portEquipment.nextPortId,
		sourceNextEquipmentGroupId: fixture.portEquipment.nextEquipmentGroupId,
		sourceNextOrganizationId: fixture.organizations.nextOrganizationId,
		intentFingerprint: staticFabBayFlowEditIntentFingerprint(fixture.intent),
		planFingerprint: staticFabBayFlowEditPlanFingerprint(plan),
		sourceAuthoredProjectionFingerprint: plan.review.sourceAuthoredProjectionFingerprint,
		targetAuthoredProjectionFingerprint: plan.review.targetAuthoredProjectionFingerprint,
		prospectiveChecksum: fixture.prospectiveChecksum,
		prospectiveNextAdvancedSwitchId: fixture.map.getAdvancedSwitchIdCursor(),
		prospectiveNextPortId: fixture.portEquipment.nextPortId,
		prospectiveNextEquipmentGroupId: fixture.portEquipment.nextEquipmentGroupId,
		prospectiveNextOrganizationId: fixture.organizations.nextOrganizationId,
	}) satisfies StaticFabBayFlowEditWorkerTicket;
	return Object.freeze({ fixture, permit, plan, ticket });
}

function certificationFixture(): CertificationFixture {
	const map = new TileMap();
	const portEquipment = emptyPortEquipmentState();
	const organizations = Object.freeze({
		nextOrganizationId: 4,
		records: Object.freeze([]),
	}) satisfies StaticFabOrganizationState;
	const intent = Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: 1,
		targetInternalFlowPattern: "co-rotating" as const,
	}) satisfies StaticFabBayFlowEditIntent;
	return Object.freeze({
		map,
		portEquipment,
		organizations,
		patchSequence: 23,
		intent,
		sourceChecksum: "source-authored-checksum",
		prospectiveChecksum: "prospective-authored-checksum",
	});
}

function flowEditPlan(fixture: CertificationFixture): StaticFabBayFlowEditPlan {
	const before = organizationRecord("alternating", {
		from: { x: 0, y: 0 },
		to: { x: 1, y: 0 },
	});
	const after = organizationRecord("co-rotating", {
		from: { x: 1, y: 0 },
		to: { x: 0, y: 0 },
	});
	return Object.freeze({
		kind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
		baseRevision: fixture.map.getRevision(),
		basePatchSequence: fixture.patchSequence,
		mutations: Object.freeze([{ x: 0, y: 0, before: 0x12, after: 0x21 }]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([Object.freeze({ id: before.id, before, after })]),
		organizationImpactAuthorizations: Object.freeze([before.id]),
		nextOrganizationIdBefore: fixture.organizations.nextOrganizationId,
		nextOrganizationIdAfter: fixture.organizations.nextOrganizationId,
		valid: true,
		reason: "Change one recognized Twin Production Bay internal flow.",
		issueCode: null,
		review: Object.freeze({
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId: fixture.intent.bayOrganizationId,
			bayName: "Bay 1",
			bankOrganizationId: null,
			processLoopOrganizationIds: Object.freeze([2, 3] as const),
			sourceInternalFlowPattern: "alternating",
			targetInternalFlowPattern: fixture.intent.targetInternalFlowPattern,
			sourceAuthoredProjectionFingerprint: "source-projection-fingerprint",
			targetAuthoredProjectionFingerprint: "target-projection-fingerprint",
			sourceSpecificationAliasCount: 5,
			sourceDirectedEdgeCount: 100,
			targetDirectedEdgeCount: 100,
			removedDirectedEdgeCount: 20,
			addedDirectedEdgeCount: 20,
			changedCellCount: 24,
			changedOrganizationIds: Object.freeze([2]),
			incidentConnectorCount: 0,
			connectorBankToBayDirectedEdgeKeys: Object.freeze(["0,0>1,0"]),
			connectorBayToBankDirectedEdgeKeys: Object.freeze(["1,1>0,1"]),
			shellCertification: "PENDING_WORKER_CERTIFICATION",
			externalGatewayCertification: "PENDING_WORKER_CERTIFICATION",
			topologyCertification: "PENDING_WORKER_CERTIFICATION",
			issueCode: null,
		}),
	});
}

function organizationRecord(
	flow: string,
	edge: {
		readonly from: { readonly x: number; readonly y: number };
		readonly to: { readonly x: number; readonly y: number };
	},
): StaticFabOrganizationRecord {
	return Object.freeze({
		id: 2,
		kind: "AISLE",
		name: `Process Loop ${flow}`,
		parentOrganizationIds: Object.freeze([1]),
		properties: Object.freeze({ description: flow, color: "CYAN" }),
		membership: Object.freeze({
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ ...edge.from }),
					to: Object.freeze({ ...edge.to }),
				}),
			]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function adoptProof(
	proof: WorkerProof,
	ticket: StaticFabBayFlowEditWorkerTicket = proof.ticket,
	plan: StaticFabBayFlowEditPlan = proof.plan,
	expectedProspectiveChecksum: string = ticket.prospectiveChecksum,
): StaticFabBayFlowEditPlan {
	return adoptStaticFabBayFlowEditWorkerPlan(
		proof.permit,
		ticket,
		plan,
		expectedProspectiveChecksum,
		proof.fixture.map,
		proof.fixture.portEquipment,
		proof.fixture.patchSequence,
		proof.fixture.organizations,
		proof.fixture.intent,
	);
}
