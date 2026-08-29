import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import type { StaticFabProjectChecks } from "../compile/StaticFabProjectChecks";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";

export const LIVE_SIMULATION_READINESS_BLOCK_CODES = [
	"RAIL_READINESS_REQUIRED",
	"STATIC_CHECKS_REQUIRED",
	"STATIC_CHECKS_FAILED",
	"OPERATIONAL_CONFIGURATION_REQUIRED",
	"RAIL_MIRROR_REQUIRED",
	"SOURCE_IDENTITY_MISMATCH",
] as const;

export type LiveSimulationReadinessBlockCode =
	(typeof LIVE_SIMULATION_READINESS_BLOCK_CODES)[number];

export interface LiveSimulationReadinessSourceIdentity {
	readonly modelGeneration: number;
	readonly patchSequence: number;
	readonly revision: number;
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
	readonly railReadinessFingerprint: string;
	readonly staticChecksFingerprint: string;
	readonly operationalConfigurationRevision: number;
	readonly operationalConfigurationFingerprint: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

export interface ResolveLiveSimulationReadinessInput {
	readonly modelGeneration: number;
	readonly patchSequence: number;
	readonly revision: number;
	readonly authoredChecksum: string;
	readonly railReadinessFingerprint: string;
	readonly railReadinessReady: boolean;
	readonly operationalConfigurationRevision: number;
	readonly operationalConfigurationFingerprint: string;
	readonly operationalIssueCount: number;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly staticChecks: StaticFabProjectChecks | null;
	readonly worker: RailWorkerBridgeState;
}

export type LiveSimulationReadinessEligibility =
	| Readonly<{
			eligible: true;
			source: LiveSimulationReadinessSourceIdentity;
	  }>
	| Readonly<{
			eligible: false;
			code: LiveSimulationReadinessBlockCode;
			message: string;
	  }>;

export interface BoundLiveSimulationReadinessPublication {
	readonly source: LiveSimulationReadinessSourceIdentity;
	readonly published: PublishedSimulationReadinessSnapshot;
}

export function resolveLiveSimulationReadinessEligibility(
	input: ResolveLiveSimulationReadinessInput,
): LiveSimulationReadinessEligibility {
	if (!input.railReadinessReady) {
		return blocked(
			"RAIL_READINESS_REQUIRED",
			"Rail flow, physical validity, closure, and clearance must pass first.",
		);
	}
	if (!input.staticChecks) {
		return blocked(
			"STATIC_CHECKS_REQUIRED",
			"Run exact Static FAB Checks for the current authored source.",
		);
	}
	if (!staticChecksMatchInput(input.staticChecks, input)) {
		return blocked(
			"SOURCE_IDENTITY_MISMATCH",
			"Static FAB Checks no longer match the current authored source.",
		);
	}
	if (!input.staticChecks.ready) {
		return blocked(
			"STATIC_CHECKS_FAILED",
			"Resolve every blocking Static FAB Check before certification.",
		);
	}
	if (input.operationalIssueCount > 0) {
		return blocked(
			"OPERATIONAL_CONFIGURATION_REQUIRED",
			"Resolve and review every operational configuration input for this source.",
		);
	}
	if (!railWorkerMatchesInput(input.worker, input)) {
		return blocked(
			"RAIL_MIRROR_REQUIRED",
			"Wait for the Rail Worker mirror and physical publication to match this source.",
		);
	}
	return Object.freeze({
		eligible: true,
		source: Object.freeze({
			modelGeneration: input.modelGeneration,
			patchSequence: input.patchSequence,
			revision: input.revision,
			authoredChecksum: input.authoredChecksum,
			physicalFingerprint: input.worker.physicalFingerprint,
			railReadinessFingerprint: input.railReadinessFingerprint,
			staticChecksFingerprint: input.staticChecks.fingerprint,
			operationalConfigurationRevision: input.operationalConfigurationRevision,
			operationalConfigurationFingerprint: input.operationalConfigurationFingerprint,
			nextAdvancedSwitchId: input.nextAdvancedSwitchId,
			nextPortId: input.nextPortId,
			nextEquipmentGroupId: input.nextEquipmentGroupId,
			nextOrganizationId: input.nextOrganizationId,
		}),
	});
}

export function liveSimulationReadinessSourceKey(
	source: LiveSimulationReadinessSourceIdentity,
): string {
	return [
		source.modelGeneration,
		source.patchSequence,
		source.revision,
		source.authoredChecksum,
		source.physicalFingerprint,
		source.railReadinessFingerprint,
		source.staticChecksFingerprint,
		source.operationalConfigurationRevision,
		source.operationalConfigurationFingerprint,
		source.nextAdvancedSwitchId,
		source.nextPortId,
		source.nextEquipmentGroupId,
		source.nextOrganizationId,
	].join(":");
}

export function boundLiveSimulationReadinessMatchesSource(
	binding: BoundLiveSimulationReadinessPublication,
	source: LiveSimulationReadinessSourceIdentity,
): boolean {
	if (
		liveSimulationReadinessSourceKey(binding.source) !== liveSimulationReadinessSourceKey(source)
	) {
		return false;
	}
	if (!publishedSnapshotMatchesCertificate(binding.published)) return false;
	const certificate = binding.published.certificate;
	return (
		certificate.sourcePatchSequence === source.patchSequence &&
		certificate.sourceRevision === source.revision &&
		certificate.sourceAuthoredChecksum === source.authoredChecksum &&
		certificate.sourcePhysicalFingerprint === source.physicalFingerprint &&
		certificate.sourceRailReadinessFingerprint === source.railReadinessFingerprint
	);
}

function publishedSnapshotMatchesCertificate(
	published: PublishedSimulationReadinessSnapshot,
): boolean {
	const { certificate } = published;
	return (
		certificate.simulationReady === true &&
		certificate.fingerprint.length > 0 &&
		certificate.foundationFingerprint === published.foundation.fingerprint &&
		certificate.trackResourceFingerprint === published.trackResources.fingerprint &&
		certificate.stationCapabilitiesFingerprint === published.stationCapabilities.fingerprint &&
		certificate.equipmentResourcesFingerprint === published.equipmentResources.fingerprint &&
		certificate.occupancyPolicyFingerprint === published.occupancyPolicy.fingerprint
	);
}

function staticChecksMatchInput(
	checks: StaticFabProjectChecks,
	input: ResolveLiveSimulationReadinessInput,
): boolean {
	return (
		checks.sourceSequence === input.patchSequence &&
		checks.sourceRevision === input.revision &&
		checks.sourceChecksum === input.authoredChecksum &&
		checks.sourceNextAdvancedSwitchId === input.nextAdvancedSwitchId &&
		checks.sourceNextPortId === input.nextPortId &&
		checks.sourceNextEquipmentGroupId === input.nextEquipmentGroupId &&
		checks.sourceNextOrganizationId === input.nextOrganizationId &&
		checks.railReadinessFingerprint === input.railReadinessFingerprint
	);
}

function railWorkerMatchesInput(
	worker: RailWorkerBridgeState,
	input: ResolveLiveSimulationReadinessInput,
): boolean {
	return (
		worker.status === "ready" &&
		worker.simulationReady === false &&
		worker.targetSequence === input.patchSequence &&
		worker.sequence === input.patchSequence &&
		worker.targetRevision === input.revision &&
		worker.revision === input.revision &&
		worker.targetChecksum === input.authoredChecksum &&
		worker.checksum === input.authoredChecksum &&
		worker.physicalSequence === input.patchSequence &&
		worker.physicalRevision === input.revision &&
		worker.physicalFingerprint.length > 0 &&
		worker.targetOperationalConfigurationRevision === input.operationalConfigurationRevision &&
		worker.operationalConfigurationRevision === input.operationalConfigurationRevision &&
		worker.targetOperationalConfigurationFingerprint ===
			input.operationalConfigurationFingerprint &&
		worker.operationalConfigurationFingerprint === input.operationalConfigurationFingerprint
	);
}

function blocked(
	code: LiveSimulationReadinessBlockCode,
	message: string,
): LiveSimulationReadinessEligibility {
	return Object.freeze({ eligible: false, code, message });
}
