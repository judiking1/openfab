import { describe, expect, it } from "vitest";
import { composeOpenFabFab } from "../compile/OpenFabFabComposer";
import { createOpenFabFabPreparedProjectIdentity } from "../compile/OpenFabFabPreparedProject";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import type { OpenFabProjectManifest } from "../project/OpenFabProject";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { INITIAL_RAIL_WORKER_STATE, type RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import { railMirrorSnapshotTransfers } from "../worker/railMirrorProtocol";
import {
	OPENFAB_FAB_PROJECT_ACTIVATION_EXPECTATION_KIND,
	type OpenFabFabProjectActivationCandidate,
	type OpenFabFabProjectActivationExpectation,
	openFabFabProjectActivationMatches,
	openFabFabProjectActivationMismatches,
} from "./OpenFabFabProjectActivation";

describe("openFabFabProjectActivationMatches", () => {
	it("binds the exact startup compile and persistent mirror reset before promotion", () => {
		const fixture = activationFixture();

		expect(openFabFabProjectActivationMatches(fixture.candidate, fixture.expected)).toBe(true);
		expect(openFabFabProjectActivationMismatches(fixture.candidate, fixture.expected)).toEqual([]);

		for (const expected of [
			{
				...fixture.expected,
				manifest: { ...fixture.manifest, id: "forged-project-id" },
			},
			{
				...fixture.expected,
				identity: {
					...fixture.identity,
					authoredTopologyFingerprint: "forged-topology",
				},
			},
			{
				...fixture.expected,
				identity: { ...fixture.identity, physicalLayoutFingerprint: "forged-physical" },
			},
			{
				...fixture.expected,
				identity: { ...fixture.identity, readinessReportFingerprint: "forged-readiness" },
			},
			{
				...fixture.expected,
				identity: {
					...fixture.identity,
					counts: { ...fixture.identity.counts, processLoops: 1 },
				},
			},
		] satisfies OpenFabFabProjectActivationExpectation[]) {
			expect(openFabFabProjectActivationMatches(fixture.candidate, expected)).toBe(false);
		}
	}, 60_000);

	it("rejects divergent cursors, counts, or a mirror that is stale or simulation-enabled", () => {
		const fixture = activationFixture();
		const { payload } = fixture.candidate;
		const cursorMismatch: OpenFabFabProjectActivationCandidate = {
			...fixture.candidate,
			payload: {
				...payload,
				snapshot: {
					...payload.snapshot,
					organizations: {
						...payload.snapshot.organizations,
						nextOrganizationId: payload.snapshot.organizations.nextOrganizationId + 1,
					},
				},
			},
		};
		expect(openFabFabProjectActivationMismatches(cursorMismatch, fixture.expected)).toContain(
			"snapshot.nextOrganizationId",
		);

		for (const workerState of [
			{ ...fixture.workerState, simulationReady: true },
			{ ...fixture.workerState, targetOrganizations: fixture.workerState.targetOrganizations + 1 },
			{ ...fixture.workerState, sequence: fixture.workerState.sequence + 1 },
			{ ...fixture.workerState, physicalFingerprint: "forged-physical" },
			{ ...fixture.workerState, previousPhysicalAvailable: true },
		]) {
			expect(
				openFabFabProjectActivationMatches(
					{
						...fixture.candidate,
						candidate: { ...fixture.candidate.candidate, workerState },
					},
					fixture.expected,
				),
			).toBe(false);
		}
	}, 60_000);
});

function activationFixture(): Readonly<{
	manifest: OpenFabProjectManifest;
	identity: ReturnType<typeof createOpenFabFabPreparedProjectIdentity>;
	expected: OpenFabFabProjectActivationExpectation;
	workerState: RailWorkerBridgeState;
	candidate: OpenFabFabProjectActivationCandidate;
}> {
	const certificate = composeOpenFabFab(defaultOpenFabFabProfile());
	const identity = createOpenFabFabPreparedProjectIdentity(certificate);
	const manifest: OpenFabProjectManifest = Object.freeze({
		id: "openfab-profile-activation-001",
		name: "OpenFab Profile Activation",
		createdAt: "2026-08-16T00:00:00.000Z",
		updatedAt: "2026-08-16T00:00:00.000Z",
	});
	const payload = compileRailStartup({
		kind: "project-snapshot",
		snapshot: certificate.roundTrippedSnapshot,
		manifest,
	});
	const workerState = settledWorkerState(payload);
	const document = hydrateRailMirrorSnapshotDocument(payload.snapshot);
	structuredClone(payload.snapshot, {
		transfer: railMirrorSnapshotTransfers(payload.snapshot),
	});
	const expected: OpenFabFabProjectActivationExpectation = Object.freeze({
		kind: OPENFAB_FAB_PROJECT_ACTIVATION_EXPECTATION_KIND,
		manifest,
		identity,
	});
	return Object.freeze({
		manifest,
		identity,
		expected,
		workerState,
		candidate: Object.freeze({
			payload,
			candidate: Object.freeze({
				workerState,
				activation: Object.freeze({
					model: Object.freeze({
						authoredChecksum: payload.authoredChecksum,
						map: document.map,
						document,
					}),
				}),
			}),
		}),
	});
}

function settledWorkerState(payload: ReturnType<typeof compileRailStartup>): RailWorkerBridgeState {
	const snapshot = payload.snapshot;
	const physical = payload.physical.value;
	const switches = snapshot.switchIds.length;
	const ports = snapshot.portEquipment.portIds.length;
	const equipmentGroups = snapshot.portEquipment.equipmentGroupIds.length;
	const organizations = snapshot.organizations.organizationIds.length;
	return {
		...INITIAL_RAIL_WORKER_STATE,
		status: "ready",
		targetSequence: snapshot.sequence,
		targetRevision: snapshot.revision,
		targetChecksum: payload.authoredChecksum,
		targetCells: payload.analysis.value.cells,
		targetEdges: payload.analysis.value.edges,
		targetSwitches: switches,
		targetPorts: ports,
		targetEquipmentGroups: equipmentGroups,
		targetOrganizations: organizations,
		sequence: snapshot.sequence,
		revision: snapshot.revision,
		checksum: payload.authoredChecksum,
		cells: payload.analysis.value.cells,
		edges: payload.analysis.value.edges,
		switches,
		ports,
		equipmentGroups,
		organizations,
		physicalPublicationKind: "reset",
		physicalSequence: snapshot.sequence,
		physicalRevision: snapshot.revision,
		physicalFingerprint: payload.physical.fingerprint,
		physicalPathCount: physical.paths.pathCount,
		physicalPointCount: physical.paths.pointCount,
		physicalCompoundProfileCount: physical.compoundProfiles.count,
		physicalClearanceEnvelopeCount: physical.clearance.envelopes.count,
		physicalClearanceIssueCount: physical.clearance.issues.count,
		physicalIntervalRemapCount: physical.pathIntervalRemap.count,
		physicalJunctionCount: physical.junctions.length,
		physicalAdvancedSwitchCount: physical.advancedSwitches.count,
		physicalValid: physical.valid,
		physicalDiagnosticCount: physical.diagnostics.length,
	};
}
