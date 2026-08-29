import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type SimulationEquipmentResourceConfiguration,
	simulationEquipmentResourceConfigurationError,
} from "./SimulationEquipmentResourceConfiguration";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import {
	type SimulationStationOperationalCapabilities,
	simulationStationOperationalCapabilitiesError,
} from "./SimulationStationOperationalCapabilities";
import {
	type SimulationTrackOccupancyPolicy,
	simulationTrackOccupancyPolicyError,
} from "./SimulationTrackOccupancyPolicy";
import {
	type SimulationTrackResourceTopology,
	simulationTrackResourceTopologyError,
} from "./SimulationTrackResourceTopology";

export const SIMULATION_READINESS_CERTIFICATE_SCHEMA_VERSION = 1;
export const SIMULATION_READINESS_PROFILE_ID =
	"OPENFAB_UNLAUNCHED_TRANSFER_TOKEN_READINESS_V1" as const;
export const SIMULATION_ACTIVE_RUN_EDIT_POLICY =
	"STOP_AND_REBUILD_ON_AUTHORED_MUTATION_V1" as const;
export const SIMULATION_READINESS_CERTIFICATION_MODE = "DISPOSABLE_WORKER_EXACT_V1" as const;
export const SIMULATION_READINESS_LIMITATIONS = Object.freeze([
	"UNLAUNCHED_TRANSFER_TOKENS_ONLY",
	"NO_RESIDENT_FLEET",
	"NO_IDLE_TRACK_PARKING",
	"NO_MID_ROUTE_REPLAN",
] as const);

export interface SimulationReadinessComponents {
	readonly foundation: SimulationStaticWorldFoundation;
	readonly trackResources: SimulationTrackResourceTopology;
	readonly stationCapabilities: SimulationStationOperationalCapabilities;
	readonly equipmentResources: SimulationEquipmentResourceConfiguration;
	readonly occupancyPolicy: SimulationTrackOccupancyPolicy;
}

export interface SimulationReadinessCertificate {
	readonly schemaVersion: typeof SIMULATION_READINESS_CERTIFICATE_SCHEMA_VERSION;
	/** True only on the exact certificate produced after complete independent component validation. */
	readonly simulationReady: true;
	readonly missingLayers: readonly [];
	readonly readinessProfileId: typeof SIMULATION_READINESS_PROFILE_ID;
	readonly certificationMode: typeof SIMULATION_READINESS_CERTIFICATION_MODE;
	readonly activeRunEditPolicy: typeof SIMULATION_ACTIVE_RUN_EDIT_POLICY;
	readonly limitations: typeof SIMULATION_READINESS_LIMITATIONS;
	readonly sourcePatchSequence: number;
	readonly sourceRevision: number;
	readonly sourceAuthoredChecksum: string;
	readonly sourcePhysicalFingerprint: string;
	readonly sourceRailReadinessFingerprint: string;
	readonly foundationFingerprint: string;
	readonly trackResourceFingerprint: string;
	readonly stationCapabilitiesFingerprint: string;
	readonly equipmentResourcesFingerprint: string;
	readonly occupancyPolicyFingerprint: string;
	readonly pathCount: number;
	readonly trackResourceCount: number;
	readonly switchConflictResourceCount: number;
	readonly stationCount: number;
	readonly equipmentGroupCount: number;
	readonly eqCapabilityCount: number;
	readonly storagePolicyCount: number;
	readonly vehicleProfileId: string;
	readonly vehicleProfileVersion: number;
	readonly snapshotByteLength: number;
	readonly fingerprint: string;
}

export interface PublishedSimulationReadinessSnapshot extends SimulationReadinessComponents {
	readonly certificate: SimulationReadinessCertificate;
}

/** Production calls this only after a disposable Worker has adopted the exact component snapshot. */
export function compileSimulationReadinessCertificate(
	components: SimulationReadinessComponents,
): SimulationReadinessCertificate {
	const componentError = simulationReadinessComponentsError(components);
	if (componentError)
		throw new Error(`Simulation readiness components are invalid: ${componentError}`);
	const { foundation, trackResources, stationCapabilities, equipmentResources, occupancyPolicy } =
		components;
	const certificateWithoutIdentity = {
		schemaVersion: SIMULATION_READINESS_CERTIFICATE_SCHEMA_VERSION,
		simulationReady: true,
		missingLayers: Object.freeze([]) as readonly [],
		readinessProfileId: SIMULATION_READINESS_PROFILE_ID,
		certificationMode: SIMULATION_READINESS_CERTIFICATION_MODE,
		activeRunEditPolicy: SIMULATION_ACTIVE_RUN_EDIT_POLICY,
		limitations: SIMULATION_READINESS_LIMITATIONS,
		sourcePatchSequence: foundation.source.patchSequence,
		sourceRevision: foundation.source.revision,
		sourceAuthoredChecksum: foundation.source.authoredChecksum,
		sourcePhysicalFingerprint: foundation.source.physicalFingerprint,
		sourceRailReadinessFingerprint: foundation.source.readinessFingerprint,
		foundationFingerprint: foundation.fingerprint,
		trackResourceFingerprint: trackResources.fingerprint,
		stationCapabilitiesFingerprint: stationCapabilities.fingerprint,
		equipmentResourcesFingerprint: equipmentResources.fingerprint,
		occupancyPolicyFingerprint: occupancyPolicy.fingerprint,
		pathCount: foundation.paths.pathCount,
		trackResourceCount: trackResources.trackResourceCount,
		switchConflictResourceCount: trackResources.switchConflictResourceCount,
		stationCount: foundation.stations.count,
		equipmentGroupCount: foundation.equipmentGroups.count,
		eqCapabilityCount: equipmentResources.eqCapabilityCount,
		storagePolicyCount: equipmentResources.storagePolicyCount,
		vehicleProfileId: occupancyPolicy.vehicleProfileId,
		vehicleProfileVersion: occupancyPolicy.vehicleProfileVersion,
		snapshotByteLength:
			foundation.byteLength +
			trackResources.byteLength +
			stationCapabilities.byteLength +
			equipmentResources.byteLength +
			occupancyPolicy.byteLength,
	} as const;
	const certificate = Object.freeze({
		...certificateWithoutIdentity,
		fingerprint: checksumSimulationReadinessCertificate(certificateWithoutIdentity),
	}) satisfies SimulationReadinessCertificate;
	const error = simulationReadinessCertificateError(certificate);
	if (error) throw new Error(`Compiled simulation readiness certificate is invalid: ${error}`);
	return certificate;
}

export function publishSimulationReadinessSnapshot(
	components: SimulationReadinessComponents,
): PublishedSimulationReadinessSnapshot {
	const certificate = compileSimulationReadinessCertificate(components);
	return Object.freeze({ ...components, certificate });
}

export function checksumSimulationReadinessCertificate(
	certificate: Omit<SimulationReadinessCertificate, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		certificate.schemaVersion,
		certificate.simulationReady ? 1 : 0,
		certificate.sourcePatchSequence,
		certificate.sourceRevision,
		certificate.pathCount,
		certificate.trackResourceCount,
		certificate.switchConflictResourceCount,
		certificate.stationCount,
		certificate.equipmentGroupCount,
		certificate.eqCapabilityCount,
		certificate.storagePolicyCount,
		certificate.vehicleProfileVersion,
		certificate.snapshotByteLength,
	]);
	checksum.addStrings([
		...certificate.missingLayers,
		certificate.readinessProfileId,
		certificate.certificationMode,
		certificate.activeRunEditPolicy,
		...certificate.limitations,
		certificate.sourceAuthoredChecksum,
		certificate.sourcePhysicalFingerprint,
		certificate.sourceRailReadinessFingerprint,
		certificate.foundationFingerprint,
		certificate.trackResourceFingerprint,
		certificate.stationCapabilitiesFingerprint,
		certificate.equipmentResourcesFingerprint,
		certificate.occupancyPolicyFingerprint,
		certificate.vehicleProfileId,
	]);
	return checksum.digest();
}

export function simulationReadinessComponentsError(value: unknown): string | null {
	if (!isRecord(value)) return "readiness components must be an object";
	const foundationError = simulationStaticWorldFoundationError(value.foundation);
	if (foundationError) return `foundation is invalid: ${foundationError}`;
	const trackError = simulationTrackResourceTopologyError(value.trackResources);
	if (trackError) return `track resources are invalid: ${trackError}`;
	const stationError = simulationStationOperationalCapabilitiesError(value.stationCapabilities);
	if (stationError) return `station capabilities are invalid: ${stationError}`;
	const equipmentError = simulationEquipmentResourceConfigurationError(value.equipmentResources);
	if (equipmentError) return `equipment resources are invalid: ${equipmentError}`;
	const occupancyError = simulationTrackOccupancyPolicyError(value.occupancyPolicy);
	if (occupancyError) return `occupancy policy is invalid: ${occupancyError}`;
	const components = value as unknown as SimulationReadinessComponents;
	const foundationFingerprint = components.foundation.fingerprint;
	if (
		components.trackResources.sourceFoundationFingerprint !== foundationFingerprint ||
		components.stationCapabilities.sourceFoundationFingerprint !== foundationFingerprint ||
		components.equipmentResources.sourceFoundationFingerprint !== foundationFingerprint ||
		components.occupancyPolicy.sourceFoundationFingerprint !== foundationFingerprint
	) {
		return "component foundation fingerprints do not match";
	}
	if (
		components.equipmentResources.sourceStationCapabilitiesFingerprint !==
		components.stationCapabilities.fingerprint
	) {
		return "equipment resources do not match station capabilities";
	}
	if (
		components.occupancyPolicy.sourceTrackResourceTopologyFingerprint !==
		components.trackResources.fingerprint
	) {
		return "occupancy policy does not match track resources";
	}
	if (
		components.stationCapabilities.stationCount !== components.foundation.stations.count ||
		components.stationCapabilities.equipmentGroupCount !==
			components.foundation.equipmentGroups.count ||
		components.equipmentResources.stationCount !== components.foundation.stations.count ||
		components.equipmentResources.equipmentGroupCount !==
			components.foundation.equipmentGroups.count ||
		components.occupancyPolicy.trackResourceCount !==
			components.trackResources.trackResourceCount ||
		components.occupancyPolicy.switchConflictResourceCount !==
			components.trackResources.switchConflictResourceCount
	) {
		return "component entity counts do not match";
	}
	return null;
}

export function simulationReadinessCertificateError(value: unknown): string | null {
	if (!isRecord(value)) return "readiness certificate must be an object";
	if (value.schemaVersion !== SIMULATION_READINESS_CERTIFICATE_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationReady !== true)
		return "readiness certificate must authorize its exact profile";
	if (!Array.isArray(value.missingLayers) || value.missingLayers.length !== 0) {
		return "published readiness certificate cannot retain missing layers";
	}
	if (
		value.readinessProfileId !== SIMULATION_READINESS_PROFILE_ID ||
		value.certificationMode !== SIMULATION_READINESS_CERTIFICATION_MODE ||
		value.activeRunEditPolicy !== SIMULATION_ACTIVE_RUN_EDIT_POLICY ||
		!sameStrings(value.limitations, SIMULATION_READINESS_LIMITATIONS)
	) {
		return "readiness profile, edit policy, or limitations are invalid";
	}
	for (const field of [
		"sourceAuthoredChecksum",
		"sourcePhysicalFingerprint",
		"sourceRailReadinessFingerprint",
		"foundationFingerprint",
		"trackResourceFingerprint",
		"stationCapabilitiesFingerprint",
		"equipmentResourcesFingerprint",
		"occupancyPolicyFingerprint",
		"vehicleProfileId",
	] as const) {
		if (!isNonEmptyString(value[field])) return `certificate ${field} is invalid`;
	}
	for (const field of [
		"sourcePatchSequence",
		"sourceRevision",
		"pathCount",
		"trackResourceCount",
		"switchConflictResourceCount",
		"stationCount",
		"equipmentGroupCount",
		"eqCapabilityCount",
		"storagePolicyCount",
		"snapshotByteLength",
	] as const) {
		if (!isNonNegativeSafeInteger(value[field])) return `certificate ${field} is invalid`;
	}
	if (!isPositiveSafeInteger(value.vehicleProfileVersion)) {
		return "certificate vehicle profile version is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "certificate fingerprint is invalid";
	try {
		const certificate = value as unknown as SimulationReadinessCertificate;
		if (checksumSimulationReadinessCertificate(certificate) !== certificate.fingerprint) {
			return "fingerprint does not match readiness certificate";
		}
	} catch {
		return "readiness certificate fingerprint cannot be recomputed";
	}
	return null;
}

export function publishedSimulationReadinessSnapshotError(value: unknown): string | null {
	if (!isRecord(value)) return "published readiness snapshot must be an object";
	const componentsError = simulationReadinessComponentsError(value);
	if (componentsError) return componentsError;
	const certificateError = simulationReadinessCertificateError(value.certificate);
	if (certificateError) return certificateError;
	const published = value as unknown as PublishedSimulationReadinessSnapshot;
	let expected: SimulationReadinessCertificate;
	try {
		expected = compileSimulationReadinessCertificate(published);
	} catch {
		return "published readiness certificate cannot be reconstructed";
	}
	return expected.fingerprint === published.certificate.fingerprint
		? null
		: "published readiness certificate does not match its components";
}

export function isPublishedSimulationReadinessSnapshot(
	value: unknown,
): value is PublishedSimulationReadinessSnapshot {
	return publishedSimulationReadinessSnapshotError(value) === null;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, index) => entry === expected[index])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
