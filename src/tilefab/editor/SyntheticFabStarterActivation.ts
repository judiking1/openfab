import type { SyntheticFabStarterSummary } from "../compile/SyntheticFabStarter";
import type { RailStartupPayload } from "../worker/RailStartupProtocol";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";

export interface SyntheticFabProjectActivationExpectation {
	readonly manifestId: string;
	readonly authoredChecksum: string;
	readonly analysisFingerprint: string;
	readonly physicalFingerprint: string;
	readonly readinessFingerprint: string;
	readonly authoringReady: boolean;
	readonly sequence: number;
	readonly revision: number;
	readonly switches: number;
	readonly ports: number;
	readonly equipmentGroups: number;
	readonly organizations: number;
	readonly openTerminals: number;
	readonly strongComponents: number;
	readonly summary: Pick<
		SyntheticFabStarterSummary,
		"railCells" | "directedEdges" | "physicalPaths" | "totalLengthMeters" | "junctions"
	>;
}

export interface SyntheticFabProjectActivationCandidate {
	readonly payload: RailStartupPayload;
	readonly candidate: Readonly<{ workerState: RailWorkerBridgeState }>;
}

export function syntheticFabProjectActivationMatches(
	prepared: SyntheticFabProjectActivationCandidate,
	expected: SyntheticFabProjectActivationExpectation,
): boolean {
	return syntheticFabProjectActivationMismatches(prepared, expected).length === 0;
}

export function syntheticFabProjectActivationMismatches(
	prepared: SyntheticFabProjectActivationCandidate,
	expected: SyntheticFabProjectActivationExpectation,
): readonly string[] {
	const { payload } = prepared;
	const source = payload.source;
	const worker = prepared.candidate.workerState;
	if (source.kind !== "project") return Object.freeze(["source.kind"]);
	const snapshot = payload.snapshot;
	const physical = payload.physical.value;
	const checks: ReadonlyArray<readonly [string, boolean]> = [
		["source.manifest.id", source.manifest.id === expected.manifestId],
		["payload.authoredChecksum", payload.authoredChecksum === expected.authoredChecksum],
		["snapshot.checksum", snapshot.checksum === expected.authoredChecksum],
		["snapshot.sequence", snapshot.sequence === expected.sequence],
		["snapshot.revision", snapshot.revision === expected.revision],
		["source.checksum", source.checksum === expected.authoredChecksum],
		["source.sequence", source.sequence === expected.sequence],
		["source.revision", source.revision === expected.revision],
		["analysis.fingerprint", payload.analysis.fingerprint === expected.analysisFingerprint],
		["analysis.cells", payload.analysis.value.cells === expected.summary.railCells],
		["analysis.edges", payload.analysis.value.edges === expected.summary.directedEdges],
		["analysis.junctions", payload.analysis.value.junctions === expected.summary.junctions],
		["physical.fingerprint", payload.physical.fingerprint === expected.physicalFingerprint],
		["physical.paths", physical.paths.pathCount === expected.summary.physicalPaths],
		[
			"physical.totalLength",
			Math.abs(physical.paths.totalLengthMeters - expected.summary.totalLengthMeters) < 1e-6,
		],
		[
			"readiness.physicalFingerprint",
			payload.readiness.physicalFingerprint === expected.physicalFingerprint,
		],
		[
			"readiness.authoredChecksum",
			payload.readiness.authoredChecksum === expected.authoredChecksum,
		],
		["readiness.fingerprint", payload.readiness.fingerprint === expected.readinessFingerprint],
		[
			"readiness.value.fingerprint",
			payload.readiness.value.fingerprint === expected.readinessFingerprint,
		],
		["readiness.ready", payload.readiness.value.ready === expected.authoringReady],
		["readiness.status", (payload.readiness.value.status === "ready") === expected.authoringReady],
		["analysis.openEnds", payload.analysis.value.openEnds === expected.openTerminals],
		[
			"analysis.strongComponents",
			payload.analysis.value.strongComponents === expected.strongComponents,
		],
		["worker.status", worker.status === "ready"],
		["worker.simulationReady", worker.simulationReady === false],
		["worker.targetChecksum", worker.targetChecksum === expected.authoredChecksum],
		["worker.targetSequence", worker.targetSequence === expected.sequence],
		["worker.targetRevision", worker.targetRevision === expected.revision],
		["worker.targetCells", worker.targetCells === expected.summary.railCells],
		["worker.targetEdges", worker.targetEdges === expected.summary.directedEdges],
		["worker.targetSwitches", worker.targetSwitches === expected.switches],
		["worker.targetPorts", worker.targetPorts === expected.ports],
		["worker.targetEquipmentGroups", worker.targetEquipmentGroups === expected.equipmentGroups],
		["worker.targetOrganizations", worker.targetOrganizations === expected.organizations],
		["worker.checksum", worker.checksum === expected.authoredChecksum],
		["worker.physicalFingerprint", worker.physicalFingerprint === expected.physicalFingerprint],
		["worker.sequence", worker.sequence === expected.sequence],
		["worker.revision", worker.revision === expected.revision],
		["worker.cells", worker.cells === expected.summary.railCells],
		["worker.edges", worker.edges === expected.summary.directedEdges],
		["worker.switches", worker.switches === expected.switches],
		["worker.ports", worker.ports === expected.ports],
		["worker.equipmentGroups", worker.equipmentGroups === expected.equipmentGroups],
		["worker.organizations", worker.organizations === expected.organizations],
		["worker.physicalPublicationKind", worker.physicalPublicationKind === "reset"],
		["worker.physicalSequence", worker.physicalSequence === expected.sequence],
		["worker.physicalRevision", worker.physicalRevision === expected.revision],
		["worker.physicalPathCount", worker.physicalPathCount === physical.paths.pathCount],
		["worker.physicalPointCount", worker.physicalPointCount === physical.paths.pointCount],
		[
			"worker.physicalCompoundProfileCount",
			worker.physicalCompoundProfileCount === physical.compoundProfiles.count,
		],
		[
			"worker.physicalClearanceEnvelopeCount",
			worker.physicalClearanceEnvelopeCount === physical.clearance.envelopes.count,
		],
		[
			"worker.physicalClearanceIssueCount",
			worker.physicalClearanceIssueCount === physical.clearance.issues.count,
		],
		[
			"worker.physicalIntervalRemapCount",
			worker.physicalIntervalRemapCount === physical.pathIntervalRemap.count,
		],
		["worker.physicalJunctionCount", worker.physicalJunctionCount === physical.junctions.length],
		[
			"worker.physicalAdvancedSwitchCount",
			worker.physicalAdvancedSwitchCount === physical.advancedSwitches.count,
		],
		["worker.physicalValid", worker.physicalValid === physical.valid],
		[
			"worker.physicalDiagnosticCount",
			worker.physicalDiagnosticCount === physical.diagnostics.length,
		],
		["worker.previousPhysicalAvailable", worker.previousPhysicalAvailable === false],
		["worker.migrationAvailable", worker.migrationAvailable === false],
	];
	return Object.freeze(checks.filter(([, matches]) => !matches).map(([field]) => field));
}
