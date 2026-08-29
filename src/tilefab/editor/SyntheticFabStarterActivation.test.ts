import { describe, expect, it } from "vitest";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { INITIAL_RAIL_WORKER_STATE, type RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import {
	type SyntheticFabProjectActivationCandidate,
	type SyntheticFabProjectActivationExpectation,
	syntheticFabProjectActivationMatches,
	syntheticFabProjectActivationMismatches,
} from "./SyntheticFabStarterActivation";

describe("syntheticFabProjectActivationMatches", () => {
	it("requires startup and mirror identities to match the prepared starter exactly", () => {
		const payload = projectPayload(32);
		const expected: SyntheticFabProjectActivationExpectation = {
			manifestId: payload.source.kind === "project" ? payload.source.manifest.id : "",
			authoredChecksum: payload.authoredChecksum,
			analysisFingerprint: payload.analysis.fingerprint,
			physicalFingerprint: payload.physical.fingerprint,
			readinessFingerprint: payload.readiness.fingerprint,
			authoringReady: payload.readiness.value.ready,
			sequence: payload.snapshot.sequence,
			revision: payload.snapshot.revision,
			switches: payload.snapshot.switchIds.length,
			ports: payload.snapshot.portEquipment.portIds.length,
			equipmentGroups: payload.snapshot.portEquipment.equipmentGroupIds.length,
			organizations: payload.snapshot.organizations.organizationIds.length,
			openTerminals: payload.analysis.value.openEnds,
			strongComponents: payload.analysis.value.strongComponents,
			summary: {
				railCells: payload.analysis.value.cells,
				directedEdges: payload.analysis.value.edges,
				physicalPaths: payload.physical.value.paths.pathCount,
				totalLengthMeters: payload.physical.value.paths.totalLengthMeters,
				junctions: payload.analysis.value.junctions,
			},
		};
		const prepared: SyntheticFabProjectActivationCandidate = {
			payload,
			candidate: { workerState: settledWorkerState(payload) },
		};

		expect(syntheticFabProjectActivationMatches(prepared, expected)).toBe(true);
		expect(syntheticFabProjectActivationMismatches(prepared, expected)).toEqual([]);
		expect(
			syntheticFabProjectActivationMatches(prepared, {
				...expected,
				authoringReady: !payload.readiness.value.ready,
			}),
		).toBe(false);
		expect(
			syntheticFabProjectActivationMismatches(prepared, {
				...expected,
				authoringReady: !payload.readiness.value.ready,
			}),
		).toEqual(["readiness.ready", "readiness.status"]);
		for (const changed of [
			{ ...expected, manifestId: "forged-project-id" },
			{ ...expected, authoredChecksum: "forged-checksum" },
			{ ...expected, analysisFingerprint: "forged-analysis" },
			{ ...expected, physicalFingerprint: "deadbeef:00000000" },
			{ ...expected, readinessFingerprint: "forged-readiness" },
			{ ...expected, authoringReady: !expected.authoringReady },
			{ ...expected, sequence: expected.sequence + 1 },
			{ ...expected, revision: expected.revision + 1 },
			{ ...expected, openTerminals: expected.openTerminals + 1 },
			{ ...expected, strongComponents: expected.strongComponents + 1 },
			{
				...expected,
				summary: { ...expected.summary, physicalPaths: expected.summary.physicalPaths + 1 },
			},
		]) {
			expect(syntheticFabProjectActivationMatches(prepared, changed)).toBe(false);
		}
		const snapshotPayload = compileRailStartup({ kind: "snapshot", snapshot: payload.snapshot });
		expect(
			syntheticFabProjectActivationMatches({ ...prepared, payload: snapshotPayload }, expected),
		).toBe(false);
	});

	it("rejects a candidate whose mirror enables simulation or diverges after startup", () => {
		const payload = projectPayload(8);
		const expected: SyntheticFabProjectActivationExpectation = {
			manifestId: payload.source.kind === "project" ? payload.source.manifest.id : "",
			authoredChecksum: payload.authoredChecksum,
			analysisFingerprint: payload.analysis.fingerprint,
			physicalFingerprint: payload.physical.fingerprint,
			readinessFingerprint: payload.readiness.fingerprint,
			authoringReady: payload.readiness.value.ready,
			sequence: payload.snapshot.sequence,
			revision: payload.snapshot.revision,
			switches: payload.snapshot.switchIds.length,
			ports: payload.snapshot.portEquipment.portIds.length,
			equipmentGroups: payload.snapshot.portEquipment.equipmentGroupIds.length,
			organizations: payload.snapshot.organizations.organizationIds.length,
			openTerminals: payload.analysis.value.openEnds,
			strongComponents: payload.analysis.value.strongComponents,
			summary: {
				railCells: payload.analysis.value.cells,
				directedEdges: payload.analysis.value.edges,
				physicalPaths: payload.physical.value.paths.pathCount,
				totalLengthMeters: payload.physical.value.paths.totalLengthMeters,
				junctions: payload.analysis.value.junctions,
			},
		};
		const workerState = settledWorkerState(payload);

		expect(
			syntheticFabProjectActivationMatches(
				{ payload, candidate: { workerState: { ...workerState, simulationReady: true } } },
				expected,
			),
		).toBe(false);
		expect(
			syntheticFabProjectActivationMatches(
				{
					payload,
					candidate: { workerState: { ...workerState, sequence: expected.sequence + 1 } },
				},
				expected,
			),
		).toBe(false);
		for (const changed of [
			{ ...workerState, targetChecksum: "forged-target" },
			{ ...workerState, targetSequence: workerState.targetSequence + 1 },
			{ ...workerState, targetRevision: workerState.targetRevision + 1 },
			{ ...workerState, targetCells: workerState.targetCells + 1 },
			{ ...workerState, targetEdges: workerState.targetEdges + 1 },
			{ ...workerState, cells: workerState.cells + 1 },
			{ ...workerState, edges: workerState.edges + 1 },
			{ ...workerState, physicalSequence: workerState.physicalSequence + 1 },
			{ ...workerState, physicalRevision: workerState.physicalRevision + 1 },
			{ ...workerState, physicalPathCount: workerState.physicalPathCount + 1 },
			{ ...workerState, physicalPointCount: workerState.physicalPointCount + 1 },
			{ ...workerState, physicalValid: false },
			{ ...workerState, previousPhysicalAvailable: true },
			{ ...workerState, migrationAvailable: true },
		]) {
			expect(
				syntheticFabProjectActivationMatches(
					{ payload, candidate: { workerState: changed } },
					expected,
				),
			).toBe(false);
		}
	});
});

function projectPayload(cellCount: number) {
	const document = createRailScaleProbeDocument(cellCount);
	const project = captureOpenFabProject(document, {
		manifest: {
			id: `activation-${cellCount}`,
			name: "Activation fixture",
			createdAt: "2026-07-31T00:00:00.000Z",
			updatedAt: "2026-07-31T00:00:00.000Z",
		},
	});
	return compileRailStartup({ kind: "project-json", json: serializeOpenFabProject(project) });
}

function settledWorkerState(payload: ReturnType<typeof projectPayload>): RailWorkerBridgeState {
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
