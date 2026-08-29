import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	consumeRailMirrorSnapshotCaptureAuthority,
} from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import type { RailConstructionPlan } from "./paint";
import type { RailPatchEvent } from "./RailDocument";
import {
	planStaticFabBayFlowEditWithProspectiveState,
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
} from "./StaticFabBayFlowEdit";
import {
	adoptStaticFabBayFlowEditWorkerPlan,
	issueStaticFabBayFlowEditPermit,
	type StaticFabBayFlowEditWorkerTicket,
	staticFabBayFlowEditIntentFingerprint,
	staticFabBayFlowEditPlanFingerprint,
} from "./StaticFabBayFlowEditCertification";
import { deriveStaticFabOrganizationSemanticRoles } from "./StaticFabOrganization";

const MINIMUM_TWIN_PROFILE = Object.freeze({
	...defaultOpenFabFabProfile(),
	layoutBlockCount: 1 as const,
	banksPerLayoutBlock: 1 as const,
	processLoopsPerBank: 12 as const,
	bayPackingPolicy: "TWIN" as const,
	processLoopLongAxisMeters: 36 as const,
	processLoopCenterPitchMeters: 12 as const,
});

describe("RailDocument Bay flow edit", () => {
	let composition: CertifiedOpenFabFabComposition;
	let balancedComposition: CertifiedOpenFabFabComposition;

	beforeAll(() => {
		composition = composeOpenFabFab(MINIMUM_TWIN_PROFILE);
		balancedComposition = composeOpenFabFab(defaultOpenFabFabProfile());
	}, 120_000);

	it("commits, mirrors, undoes, and redoes one certified Twin Bay flow replacement atomically", () => {
		const fixture = certifiedFixture(composition);
		const events: RailPatchEvent[] = [];
		fixture.document.subscribe((event) => events.push(event));

		// A semantic organization mutation cannot leak through the generic rail-only boundary.
		expect(fixture.document.commit(fixture.plan as unknown as RailConstructionPlan)).toBe(false);
		expect(fixture.document.getPatchSequence()).toBe(0);
		expect(
			fixture.document.commitStaticFabBayFlowEdit(fixture.plan),
			fixture.document.getLastCommandError() ?? undefined,
		).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			sequence: 1,
			kind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
		});
		expect(fixture.mirror.applyPatch(roundTripPatch(events[0] as RailPatchEvent)).checksum).toBe(
			fixture.prospectiveChecksum,
		);
		expect(
			checksumRailMap(
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(fixture.prospectiveChecksum);

		expect(fixture.document.undo()).toBe(true);
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			sequence: 2,
			kind: "undo",
			historyOriginKind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
		});
		expect(fixture.mirror.applyPatch(roundTripPatch(events[1] as RailPatchEvent)).checksum).toBe(
			fixture.sourceChecksum,
		);
		expect(
			checksumRailMap(
				fixture.document.map,
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(fixture.sourceChecksum);

		expect(fixture.document.redo()).toBe(true);
		expect(events).toHaveLength(3);
		expect(events[2]).toMatchObject({
			sequence: 3,
			kind: "redo",
			historyOriginKind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
		});
		expect(fixture.mirror.applyPatch(roundTripPatch(events[2] as RailPatchEvent)).checksum).toBe(
			fixture.prospectiveChecksum,
		);
		expect(fixture.document.commitStaticFabBayFlowEdit(fixture.plan)).toBe(false);
	}, 120_000);

	it("commits the default balanced attached Twin Bay support seam through undo and redo", () => {
		const fixture = certifiedDocumentFixture(
			hydrateRailMirrorSnapshotDocument(balancedComposition.roundTrippedSnapshot),
			"Production Bay 1.2",
		);
		const events: RailPatchEvent[] = [];
		fixture.document.subscribe((event) => events.push(event));

		expect(
			fixture.document.commitStaticFabBayFlowEdit(fixture.plan),
			fixture.document.getLastCommandError() ?? undefined,
		).toBe(true);
		expect(fixture.mirror.applyPatch(roundTripPatch(events[0] as RailPatchEvent)).checksum).toBe(
			fixture.prospectiveChecksum,
		);
		const resynchronizedMirror = new RailPatchMirror();
		const resynchronizedCapture = captureRailMirrorSnapshot(
			fixture.document.map,
			fixture.document.getPatchSequence(),
			fixture.document.portEquipment,
			fixture.document.organizations,
		);
		resynchronizedMirror.sync(
			resynchronizedCapture.snapshot,
			fixture.document.captureRailMirrorHistoryLedger(),
		);
		expect(fixture.document.undo(), fixture.document.getLastCommandError() ?? undefined).toBe(true);
		expect(
			resynchronizedMirror.applyPatch(roundTripPatch(events[1] as RailPatchEvent)).checksum,
		).toBe(fixture.sourceChecksum);
		expect(fixture.document.redo(), fixture.document.getLastCommandError() ?? undefined).toBe(true);
		expect(
			resynchronizedMirror.applyPatch(roundTripPatch(events[2] as RailPatchEvent)).checksum,
		).toBe(fixture.prospectiveChecksum);
	}, 120_000);

	it("rejects an unissued structural clone even when every public field matches", () => {
		const fixture = certifiedFixture(composition);
		const clone = Object.freeze({ ...fixture.plan });

		expect(fixture.document.commitStaticFabBayFlowEdit(clone)).toBe(false);
		expect(fixture.document.getPatchSequence()).toBe(0);
		expect(
			fixture.document.commitStaticFabBayFlowEdit(fixture.plan),
			fixture.document.getLastCommandError() ?? undefined,
		).toBe(true);
	}, 120_000);
});

function certifiedFixture(composition: CertifiedOpenFabFabComposition) {
	return certifiedDocumentFixture(
		hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot),
	);
}

function certifiedDocumentFixture(
	document: ReturnType<typeof hydrateRailMirrorSnapshotDocument>,
	bayName?: string,
) {
	const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
	const bay = document.organizations.records.find(
		(record) =>
			roles.get(record.id) === "BAY" && (bayName === undefined || record.name === bayName),
	);
	if (!bay) throw new Error("Expected one generated Twin Bay.");
	const capture = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	);
	if (
		!consumeRailMirrorSnapshotCaptureAuthority(
			capture.snapshot,
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		)
	) {
		throw new Error("Expected direct Bay flow fixture capture authority.");
	}
	const intent = Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: bay.id,
		targetInternalFlowPattern: "co-rotating",
	}) satisfies StaticFabBayFlowEditIntent;
	const result = planStaticFabBayFlowEditWithProspectiveState(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
	);
	if (!result.plan.valid || !result.prospectiveState) throw new Error(result.plan.reason);
	const prospectiveChecksum = checksumRailMap(
		result.prospectiveState.map,
		result.prospectiveState.portEquipment,
		result.prospectiveState.organizations,
	);
	const permit = issueStaticFabBayFlowEditPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		capture.snapshot.checksum,
	);
	const ticket = Object.freeze({
		ticketId: permit.ticketId,
		validationLevel: "exact",
		sourceRevision: document.map.getRevision(),
		sourcePatchSequence: document.getPatchSequence(),
		sourceChecksum: capture.snapshot.checksum,
		sourceNextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
		sourceNextPortId: document.portEquipment.nextPortId,
		sourceNextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		sourceNextOrganizationId: document.organizations.nextOrganizationId,
		intentFingerprint: staticFabBayFlowEditIntentFingerprint(intent),
		planFingerprint: staticFabBayFlowEditPlanFingerprint(result.plan),
		sourceAuthoredProjectionFingerprint: result.plan.review.sourceAuthoredProjectionFingerprint,
		targetAuthoredProjectionFingerprint: result.plan.review.targetAuthoredProjectionFingerprint,
		prospectiveChecksum,
		prospectiveNextAdvancedSwitchId: result.prospectiveState.map.getAdvancedSwitchIdCursor(),
		prospectiveNextPortId: result.prospectiveState.portEquipment.nextPortId,
		prospectiveNextEquipmentGroupId: result.prospectiveState.portEquipment.nextEquipmentGroupId,
		prospectiveNextOrganizationId: result.prospectiveState.organizations.nextOrganizationId,
	}) satisfies StaticFabBayFlowEditWorkerTicket;
	const plan = adoptStaticFabBayFlowEditWorkerPlan(
		permit,
		ticket,
		result.plan,
		prospectiveChecksum,
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
	);
	const mirror = new RailPatchMirror();
	mirror.sync(capture.snapshot);
	return Object.freeze({
		document,
		mirror,
		plan,
		sourceChecksum: capture.snapshot.checksum,
		prospectiveChecksum,
	});
}

function roundTripPatch(event: RailPatchEvent) {
	return decodeRailPatchSoA(encodeRailPatchEvent(event).patch);
}
