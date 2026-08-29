import type { OpenFabFabPreparedProjectIdentity } from "../compile/OpenFabFabPreparedProject";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import type { OpenFabProjectManifest } from "../project/OpenFabProject";
import type { RailStartupPayload } from "../worker/RailStartupProtocol";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";

export const OPENFAB_FAB_PROJECT_ACTIVATION_EXPECTATION_KIND =
	"openfab-fab-project-activation-expectation" as const;

export interface OpenFabFabProjectActivationExpectation {
	readonly kind: typeof OPENFAB_FAB_PROJECT_ACTIVATION_EXPECTATION_KIND;
	readonly manifest: OpenFabProjectManifest;
	readonly identity: OpenFabFabPreparedProjectIdentity;
}

export interface OpenFabFabProjectActivationCandidate {
	readonly payload: RailStartupPayload;
	readonly candidate: Readonly<{
		workerState: RailWorkerBridgeState;
		activation: Readonly<{
			model: Readonly<{
				authoredChecksum: string;
				map: Readonly<{
					size: number;
					edgeCount: number;
					advancedSwitchCount: number;
					getRevision(): number;
					getAdvancedSwitchIdCursor(): number;
				}>;
				document: Readonly<{
					getPatchSequence(): number;
					portEquipment: PortEquipmentState;
					organizations: StaticFabOrganizationState;
				}>;
			}>;
		}>;
	}>;
}

export function openFabFabProjectActivationMatches(
	prepared: OpenFabFabProjectActivationCandidate,
	expected: OpenFabFabProjectActivationExpectation,
): boolean {
	return openFabFabProjectActivationMismatches(prepared, expected).length === 0;
}

/**
 * Independently binds the startup compile and the persistent Rail mirror reset to the exact
 * manifest-neutral materialization identity. This is the final fail-closed check before promotion.
 */
export function openFabFabProjectActivationMismatches(
	prepared: OpenFabFabProjectActivationCandidate,
	expected: OpenFabFabProjectActivationExpectation,
): readonly string[] {
	const source = prepared.payload.source;
	if (source.kind !== "project") return Object.freeze(["source.kind"]);

	const { identity } = expected;
	const { counts } = identity;
	const payload = prepared.payload;
	const snapshot = payload.snapshot;
	const analysis = payload.analysis.value;
	const physical = payload.physical.value;
	const readiness = payload.readiness.value;
	const worker = prepared.candidate.workerState;
	const model = prepared.candidate.activation.model;
	const modelMap = model.map;
	const modelDocument = model.document;
	const semanticCounts = countSemanticOrganizations(modelDocument.organizations);
	const checks: ReadonlyArray<readonly [string, boolean]> = [
		["source.manifest.id", source.manifest.id === expected.manifest.id],
		["source.manifest.name", source.manifest.name === expected.manifest.name],
		["source.manifest.createdAt", source.manifest.createdAt === expected.manifest.createdAt],
		["source.manifest.updatedAt", source.manifest.updatedAt === expected.manifest.updatedAt],
		["payload.authoredChecksum", payload.authoredChecksum === identity.authoredChecksum],
		["source.checksum", source.checksum === identity.authoredChecksum],
		["source.sequence", source.sequence === identity.sequence],
		["source.revision", source.revision === identity.revision],
		["snapshot.checksum", snapshot.checksum === identity.authoredChecksum],
		["snapshot.sequence", snapshot.sequence === identity.sequence],
		["snapshot.revision", snapshot.revision === identity.revision],
		[
			"snapshot.nextAdvancedSwitchId",
			snapshot.nextAdvancedSwitchId === identity.nextAdvancedSwitchId,
		],
		["snapshot.nextPortId", snapshot.portEquipment.nextPortId === identity.nextPortId],
		[
			"snapshot.nextEquipmentGroupId",
			snapshot.portEquipment.nextEquipmentGroupId === identity.nextEquipmentGroupId,
		],
		[
			"snapshot.nextOrganizationId",
			snapshot.organizations.nextOrganizationId === identity.nextOrganizationId,
		],
		// Candidate construction has already transferred the snapshot buffers to the persistent
		// mirror. Their scalar identity remains readable; all counts are independently checked
		// against both the hydrated activation model and the mirror ACK below.
		["model.authoredChecksum", model.authoredChecksum === identity.authoredChecksum],
		["model.sequence", modelDocument.getPatchSequence() === identity.sequence],
		["model.revision", modelMap.getRevision() === identity.revision],
		[
			"model.nextAdvancedSwitchId",
			modelMap.getAdvancedSwitchIdCursor() === identity.nextAdvancedSwitchId,
		],
		["model.nextPortId", modelDocument.portEquipment.nextPortId === identity.nextPortId],
		[
			"model.nextEquipmentGroupId",
			modelDocument.portEquipment.nextEquipmentGroupId === identity.nextEquipmentGroupId,
		],
		[
			"model.nextOrganizationId",
			modelDocument.organizations.nextOrganizationId === identity.nextOrganizationId,
		],
		["model.cells", modelMap.size === counts.railCells],
		["model.edges", modelMap.edgeCount === counts.directedEdges],
		["model.switches", modelMap.advancedSwitchCount === counts.advancedSwitches],
		["model.ports", modelDocument.portEquipment.ports.length === counts.ports],
		[
			"model.equipmentGroups",
			modelDocument.portEquipment.equipmentGroups.length === counts.equipmentGroups,
		],
		[
			"model.organizations",
			modelDocument.organizations.records.length === counts.organizationRecords,
		],
		["model.semanticFabs", semanticCounts.fabs === 1],
		["model.semanticBanks", semanticCounts.banks === counts.banks],
		["model.semanticBays", semanticCounts.bays === counts.bays],
		["model.semanticProcessLoops", semanticCounts.processLoops === counts.processLoops],
		["analysis.fingerprint", payload.analysis.fingerprint === identity.authoredTopologyFingerprint],
		["analysis.status", analysis.status === "closed"],
		["analysis.cells", analysis.cells === counts.railCells],
		["analysis.edges", analysis.edges === counts.directedEdges],
		["analysis.components", analysis.components === 1],
		["analysis.strongComponents", analysis.strongComponents === counts.strongComponents],
		["analysis.stronglyConnected", analysis.stronglyConnected],
		["analysis.openEnds", analysis.openEnds === counts.openTerminals],
		["analysis.unsafeJunctions", analysis.unsafeJunctions === 0],
		["analysis.junctions", analysis.junctions === counts.junctions],
		["physical.fingerprint", payload.physical.fingerprint === identity.physicalLayoutFingerprint],
		["physical.paths", physical.paths.pathCount === counts.physicalPaths],
		["physical.valid", physical.valid],
		["physical.diagnostics", physical.diagnostics.length === 0],
		["physical.clearanceIssues", physical.clearance.issues.count === 0],
		[
			"readiness.authoredChecksum",
			payload.readiness.authoredChecksum === identity.authoredChecksum,
		],
		[
			"readiness.physicalFingerprint",
			payload.readiness.physicalFingerprint === identity.physicalLayoutFingerprint,
		],
		[
			"readiness.fingerprint",
			payload.readiness.fingerprint === identity.readinessReportFingerprint,
		],
		["readiness.value.fingerprint", readiness.fingerprint === identity.readinessReportFingerprint],
		["readiness.ready", readiness.ready === identity.authoringReady],
		["readiness.status", readiness.status === "ready"],
		["worker.status", worker.status === "ready"],
		["identity.simulationReady", identity.simulationReady === false],
		["worker.simulationReady", worker.simulationReady === false],
		["worker.targetChecksum", worker.targetChecksum === identity.authoredChecksum],
		["worker.targetSequence", worker.targetSequence === identity.sequence],
		["worker.targetRevision", worker.targetRevision === identity.revision],
		["worker.targetCells", worker.targetCells === counts.railCells],
		["worker.targetEdges", worker.targetEdges === counts.directedEdges],
		["worker.targetSwitches", worker.targetSwitches === counts.advancedSwitches],
		["worker.targetPorts", worker.targetPorts === counts.ports],
		["worker.targetEquipmentGroups", worker.targetEquipmentGroups === counts.equipmentGroups],
		["worker.targetOrganizations", worker.targetOrganizations === counts.organizationRecords],
		["worker.checksum", worker.checksum === identity.authoredChecksum],
		["worker.sequence", worker.sequence === identity.sequence],
		["worker.revision", worker.revision === identity.revision],
		["worker.cells", worker.cells === counts.railCells],
		["worker.edges", worker.edges === counts.directedEdges],
		["worker.switches", worker.switches === counts.advancedSwitches],
		["worker.ports", worker.ports === counts.ports],
		["worker.equipmentGroups", worker.equipmentGroups === counts.equipmentGroups],
		["worker.organizations", worker.organizations === counts.organizationRecords],
		["worker.physicalPublicationKind", worker.physicalPublicationKind === "reset"],
		["worker.physicalSequence", worker.physicalSequence === identity.sequence],
		["worker.physicalRevision", worker.physicalRevision === identity.revision],
		[
			"worker.physicalFingerprint",
			worker.physicalFingerprint === identity.physicalLayoutFingerprint,
		],
		["worker.physicalPathCount", worker.physicalPathCount === counts.physicalPaths],
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

function countSemanticOrganizations(state: StaticFabOrganizationState): Readonly<{
	fabs: number;
	banks: number;
	bays: number;
	processLoops: number;
}> {
	let fabs = 0;
	let banks = 0;
	let bays = 0;
	let processLoops = 0;
	for (const role of deriveStaticFabOrganizationSemanticRoles(state).values()) {
		if (role === "FAB") fabs += 1;
		else if (role === "BAY_BANK") banks += 1;
		else if (role === "BAY") bays += 1;
		else if (role === "PROCESS_LOOP") processLoops += 1;
	}
	return Object.freeze({ fabs, banks, bays, processLoops });
}
