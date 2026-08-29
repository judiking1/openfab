import { beforeAll, describe, expect, it } from "vitest";
import { composeOpenFabFab } from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import type { RailDocument } from "../core/RailDocument";
import {
	planStaticFabBayFlowEditWithProspectiveState,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
} from "../core/StaticFabBayFlowEdit";
import {
	adoptStaticFabBayFlowEditWorkerPlan,
	consumeCertifiedStaticFabBayFlowEditPlanIssuedFor,
	isIssuedStaticFabBayFlowEditPlan,
	issueStaticFabBayFlowEditPermit,
	staticFabBayFlowEditIntentFingerprint,
	staticFabBayFlowEditPlanFingerprint,
} from "../core/StaticFabBayFlowEditCertification";
import {
	deriveStaticFabOrganizationSemanticRoles,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import {
	planStaticFabSemanticBayMutationWithProspectiveState,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
} from "../core/StaticFabSemanticBayMutation";
import {
	captureRailMirrorSnapshot,
	checksumRailPatchResult,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PreparedStaticFabBayFlowEdit,
	STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
} from "./StaticFabBayFlowEditProtocol";
import { staticFabBayFlowEditPreparedShapeError } from "./StaticFabBayFlowEditResponseValidator";
import {
	hydrateStaticFabBayFlowEditSession,
	prepareStaticFabBayFlowEdit,
	prepareStaticFabBayFlowEditInSession,
	type StaticFabBayFlowEditRuntimeSession,
} from "./StaticFabBayFlowEditRuntime";

const MINIMUM_TWIN_PROFILE = Object.freeze({
	...defaultOpenFabFabProfile(),
	layoutBlockCount: 1 as const,
	banksPerLayoutBlock: 1 as const,
	processLoopsPerBank: 12 as const,
	bayPackingPolicy: "TWIN" as const,
	processLoopLongAxisMeters: 36 as const,
	processLoopCenterPitchMeters: 12 as const,
});

interface Fixture {
	readonly document: RailDocument;
	readonly snapshot: RailMirrorSnapshot;
	readonly session: StaticFabBayFlowEditRuntimeSession;
	readonly bayId: number;
	readonly bankId: number;
	readonly intent: StaticFabBayFlowEditIntent;
}

describe("StaticFabBayFlowEdit disposable Worker certification", () => {
	let fixture: Fixture;

	beforeAll(() => {
		const composition = composeOpenFabFab(MINIMUM_TWIN_PROFILE);
		const snapshot = composition.roundTrippedSnapshot;
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const bay = document.organizations.records.find((record) => roles.get(record.id) === "BAY");
		if (!bay) throw new Error("Expected one generated Twin Bay.");
		const bankId = staticFabOrganizationParentIds(bay).find((id) => roles.get(id) === "BAY_BANK");
		if (!bankId) throw new Error("Expected the Twin Bay parent Bank.");
		const intent = Object.freeze({
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId: bay.id,
			targetInternalFlowPattern: "co-rotating" as const,
		});
		fixture = Object.freeze({
			document,
			snapshot,
			session: hydrateStaticFabBayFlowEditSession(snapshot),
			bayId: bay.id,
			bankId,
			intent,
		});
	}, 120_000);

	it("certifies exact closed/SCC parity, immutable gateways, and all checksum paths", () => {
		const prepared = requirePrepared(prepare(fixture.session, fixture.intent, 101));

		expect(staticFabBayFlowEditPreparedShapeError(prepared)).toBeNull();
		expect(prepared.plan).toMatchObject({
			valid: true,
			switchMutations: [],
			portMutations: [],
			equipmentGroupMutations: [],
			review: {
				bayOrganizationId: fixture.bayId,
				bankOrganizationId: fixture.bankId,
				sourceInternalFlowPattern: "alternating",
				targetInternalFlowPattern: "co-rotating",
				incidentConnectorCount: 1,
			},
		});
		expect(prepared.sourceEvidence).toMatchObject({
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
		expect(prepared.prospectiveEvidence).toEqual(prepared.sourceEvidence);
		expect(prepared.ticket).toMatchObject({
			ticketId: 101,
			validationLevel: "exact",
			sourceRevision: fixture.snapshot.revision,
			sourcePatchSequence: fixture.snapshot.sequence,
			sourceChecksum: fixture.snapshot.checksum,
			sourceAuthoredProjectionFingerprint: prepared.plan.review.sourceAuthoredProjectionFingerprint,
			targetAuthoredProjectionFingerprint: prepared.plan.review.targetAuthoredProjectionFingerprint,
			prospectiveChecksum: incrementalChecksum(fixture.snapshot, prepared.plan),
		});
		expect(prepared.ticket.planFingerprint).toBe(
			staticFabBayFlowEditPlanFingerprint(prepared.plan),
		);
		expect("snapshot" in fixture.session).toBe(false);
		expect("sourceLayout" in fixture.session).toBe(false);
		expect("prospectiveState" in prepared).toBe(false);
	});

	it("produces a permit-compatible one-shot ticket and deep-cloned adopted plan", () => {
		const permit = issueStaticFabBayFlowEditPermit(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			fixture.intent,
			fixture.snapshot.checksum,
		);
		const prepared = requirePrepared(prepare(fixture.session, fixture.intent, permit.ticketId));
		const workerPlan = structuredClone(prepared.plan);
		const adopted = adoptStaticFabBayFlowEditWorkerPlan(
			permit,
			structuredClone(prepared.ticket),
			workerPlan,
			prepared.ticket.prospectiveChecksum,
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			fixture.intent,
		);

		expect(adopted).toEqual(workerPlan);
		expect(adopted).not.toBe(workerPlan);
		expect(isIssuedStaticFabBayFlowEditPlan(adopted)).toBe(true);
		expect(
			consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
				adopted,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
				adopted,
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(false);
	});

	it("runtime-recognizes a co-rotating source and certifies exact reversal", () => {
		const forward = planStaticFabBayFlowEditWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			fixture.intent,
		);
		if (!forward.plan.valid || !forward.prospectiveState) {
			throw new Error(forward.plan.reason);
		}
		const targetSnapshot = captureRailMirrorSnapshot(
			forward.prospectiveState.map,
			fixture.snapshot.sequence + 1,
			forward.prospectiveState.portEquipment,
			forward.prospectiveState.organizations,
		).snapshot;
		const targetSession = hydrateStaticFabBayFlowEditSession(targetSnapshot);
		const reverseIntent = Object.freeze({
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId: fixture.bayId,
			targetInternalFlowPattern: "alternating" as const,
		});
		const prepared = requirePrepared(prepare(targetSession, reverseIntent, 102));

		expect(prepared.plan.review).toMatchObject({
			sourceInternalFlowPattern: "co-rotating",
			targetInternalFlowPattern: "alternating",
		});
		expect(prepared.ticket.prospectiveChecksum).toBe(fixture.snapshot.checksum);
		expect(prepared.sourceEvidence).toEqual(prepared.prospectiveEvidence);
	}, 120_000);

	it("preserves every closed component when editing an already detached Bay", () => {
		const disconnect = planStaticFabSemanticBayMutationWithProspectiveState(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.document.organizations,
			Object.freeze({
				version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
				action: "DISCONNECT" as const,
				bayOrganizationId: fixture.bayId,
			}),
		);
		if (!disconnect.plan.valid || !disconnect.prospectiveState) {
			throw new Error(disconnect.plan.reason);
		}
		const detachedSnapshot = captureRailMirrorSnapshot(
			disconnect.prospectiveState.map,
			fixture.snapshot.sequence + 1,
			disconnect.prospectiveState.portEquipment,
			disconnect.prospectiveState.organizations,
		).snapshot;
		const detachedSession = hydrateStaticFabBayFlowEditSession(detachedSnapshot);
		const prepared = requirePrepared(prepare(detachedSession, fixture.intent, 108));

		expect(prepared.plan.review).toMatchObject({
			bankOrganizationId: null,
			incidentConnectorCount: 0,
			connectorBankToBayDirectedEdgeKeys: [],
			connectorBayToBankDirectedEdgeKeys: [],
		});
		expect(prepared.sourceEvidence).toMatchObject({
			authoredStatus: "disconnected",
			authoredComponentCount: 2,
			authoredStrongComponentCount: 2,
			physicalComponentCount: 2,
			physicalStrongComponentCount: 2,
			authoredComponentsClosed: true,
			physicalComponentsClosed: true,
		});
		expect(prepared.prospectiveEvidence).toEqual(prepared.sourceEvidence);
	}, 120_000);

	it("rejects stale identity, intent drift, no-op, and non-closed source evidence", () => {
		const stale = prepareStaticFabBayFlowEditInSession(
			request(fixture.session, fixture.intent, 103, {
				checksum: `${fixture.session.sourceIdentity.checksum}:stale`,
			}),
			fixture.session,
		);
		expect(stale).toMatchObject({ valid: false, failureCode: "stale", ticket: null });

		const fingerprintDrift = prepareStaticFabBayFlowEditInSession(
			{
				...request(fixture.session, fixture.intent, 104),
				expectedIntentFingerprint: "forged-intent",
			},
			fixture.session,
		);
		expect(fingerprintDrift).toMatchObject({
			valid: false,
			failureCode: "fingerprint",
			ticket: null,
		});

		const noOp = prepare(
			fixture.session,
			Object.freeze({
				...fixture.intent,
				targetInternalFlowPattern: "alternating" as const,
			}),
			105,
		);
		expect(noOp).toMatchObject({
			valid: false,
			failureCode: "plan",
			ticket: null,
			plan: { valid: false, issueCode: "TARGET_NOOP", mutations: [] },
		});
		expect(staticFabBayFlowEditPreparedShapeError(noOp)).toBeNull();

		const forgedOpenSession = Object.freeze({
			...fixture.session,
			sourceEvidence: Object.freeze({
				...fixture.session.sourceEvidence,
				authoredStatus: "open" as const,
				authoredComponentsClosed: false,
			}),
		});
		const open = prepare(forgedOpenSession, fixture.intent, 106);
		expect(open).toMatchObject({
			valid: false,
			failureCode: "source-topology",
			ticket: null,
			plan: null,
			review: null,
			planningMilliseconds: 0,
		});
		expect(staticFabBayFlowEditPreparedShapeError(open)).toBeNull();
	});

	it("maps malformed one-shot snapshots to a bounded snapshot failure", () => {
		const snapshot = structuredClone(fixture.snapshot);
		snapshot.checksum = "malformed";
		const prepared = prepareStaticFabBayFlowEdit({
			type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: 107,
			ticketId: 107,
			intent: fixture.intent,
			expectedIntentFingerprint: staticFabBayFlowEditIntentFingerprint(fixture.intent),
			snapshot,
		});
		expect(prepared).toMatchObject({
			valid: false,
			failureCode: "snapshot",
			plan: null,
			review: null,
			ticket: null,
			sourceEvidence: null,
			prospectiveEvidence: null,
		});
	});
});

function prepare(
	session: StaticFabBayFlowEditRuntimeSession,
	intent: StaticFabBayFlowEditIntent,
	ticketId: number,
): PreparedStaticFabBayFlowEdit {
	return prepareStaticFabBayFlowEditInSession(request(session, intent, ticketId), session);
}

function request(
	session: StaticFabBayFlowEditRuntimeSession,
	intent: StaticFabBayFlowEditIntent,
	ticketId: number,
	sourceOverride: Partial<StaticFabBayFlowEditRuntimeSession["sourceIdentity"]> = {},
) {
	return {
		type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT" as const,
		version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
		requestId: ticketId,
		ticketId,
		intent,
		expectedIntentFingerprint: staticFabBayFlowEditIntentFingerprint(intent),
		expectedSource: Object.freeze({ ...session.sourceIdentity, ...sourceOverride }),
	};
}

function requirePrepared(prepared: PreparedStaticFabBayFlowEdit) {
	if (
		!prepared.valid ||
		!prepared.plan ||
		!prepared.review ||
		!prepared.ticket ||
		!prepared.sourceEvidence ||
		!prepared.prospectiveEvidence
	) {
		throw new Error(prepared.reason);
	}
	return {
		...prepared,
		plan: prepared.plan,
		review: prepared.review,
		ticket: prepared.ticket,
		sourceEvidence: prepared.sourceEvidence,
		prospectiveEvidence: prepared.prospectiveEvidence,
	};
}

function incrementalChecksum(
	snapshot: RailMirrorSnapshot,
	plan: NonNullable<PreparedStaticFabBayFlowEdit["plan"]>,
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
