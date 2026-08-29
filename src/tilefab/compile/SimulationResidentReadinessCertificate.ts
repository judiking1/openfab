import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	SIMULATION_ACTIVE_RUN_EDIT_POLICY,
	simulationReadinessComponentsError,
} from "./SimulationReadinessCertificate";
import {
	simulationResidentCycleAdmissionProgramError,
	simulationResidentCycleAdmissionProgramMatchesValidatedSources,
} from "./SimulationResidentCycleAdmissionProgram";
import {
	simulationResidentCycleLeaseClaimsError,
	simulationResidentCycleLeaseClaimsMatchSources,
} from "./SimulationResidentCycleLeaseClaims";
import {
	type SimulationResidentCycleResourceRunConfiguration,
	type SimulationResidentCycleResourceSources,
	simulationResidentCycleResourceRunConfigurationError,
	simulationResidentCycleResourceRunConfigurationMatchesValidatedSources,
} from "./SimulationResidentCycleResourceRunConfiguration";
import {
	simulationResidentCycleRoutesError,
	simulationResidentCycleRoutesMatchSources,
} from "./SimulationResidentCycleRoutes";
import {
	simulationResidentCycleServiceTimingError,
	simulationResidentCycleServiceTimingMatchesValidatedSources,
} from "./SimulationResidentCycleServiceTiming";
import { simulationResidentFleetParkingConfigurationError } from "./SimulationResidentFleetParkingConfiguration";
import {
	type SimulationResidentScenarioManifest,
	simulationResidentScenarioManifestError,
} from "./SimulationResidentScenarioManifest";
import type { SimulationStationOperationalCapabilities } from "./SimulationStationOperationalCapabilities";

export const SIMULATION_RESIDENT_READINESS_CERTIFICATE_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_READINESS_PROFILE_ID =
	"OPENFAB_EXPLICIT_HOME_RETURN_RESIDENT_FLEET_READINESS_V1" as const;
export const SIMULATION_RESIDENT_READINESS_CERTIFICATION_MODE =
	"DISPOSABLE_WORKER_EXACT_V1" as const;
export const SIMULATION_RESIDENT_READINESS_LIMITATIONS = Object.freeze([
	"EXPLICIT_CONFIGURED_VEHICLE_ASSIGNMENT_ONLY",
	"DEDICATED_HOME_RETURN_ONLY",
	"PAIRWISE_DISJOINT_HOME_FOOTPRINTS",
	"ATOMIC_COMPLETE_NON_HOME_CYCLE_LEASE_BEFORE_DEPARTURE",
	"NO_DYNAMIC_DISPATCH",
	"NO_SHARED_PARKING",
	"NO_IDLE_RELOCATION",
	"NO_MID_ROUTE_REPLAN",
	"NO_FAILURE_RECOVERY",
] as const);

const SOURCE_KEYS = Object.freeze([
	"foundation",
	"trackResources",
	"stationCapabilities",
	"equipmentResources",
	"occupancyPolicy",
	"parking",
	"manifest",
	"routes",
	"leaseClaims",
	"admissionProgram",
	"serviceTiming",
	"resourceRunConfiguration",
] as const);
const PUBLISHED_KEYS = Object.freeze([...SOURCE_KEYS, "certificate"] as const);

const CERTIFICATE_KEYS = Object.freeze([
	"schemaVersion",
	"simulationReady",
	"missingLayers",
	"readinessProfileId",
	"certificationMode",
	"activeRunEditPolicy",
	"limitations",
	"sourceKind",
	"sourcePatchSequence",
	"sourceRevision",
	"sourceAuthoredChecksum",
	"sourcePhysicalFingerprint",
	"sourceRailReadinessFingerprint",
	"foundationFingerprint",
	"trackResourceFingerprint",
	"stationCapabilitiesFingerprint",
	"equipmentResourcesFingerprint",
	"occupancyPolicyFingerprint",
	"parkingConfigurationFingerprint",
	"manifestFingerprint",
	"routesFingerprint",
	"leaseClaimsFingerprint",
	"admissionProgramFingerprint",
	"serviceTimingFingerprint",
	"resourceRunConfigurationFingerprint",
	"serviceTimingInputFingerprint",
	"resourceRunInputFingerprint",
	"pathCount",
	"trackResourceCount",
	"switchConflictResourceCount",
	"stationCount",
	"equipmentGroupCount",
	"vehicleCount",
	"requestCount",
	"loadCount",
	"eqResourceCount",
	"storageResourceCount",
	"snapshotByteLength",
	"fingerprint",
] as const);

export interface SimulationResidentReadinessSources extends SimulationResidentCycleResourceSources {
	readonly stationCapabilities: SimulationStationOperationalCapabilities;
	readonly resourceRunConfiguration: SimulationResidentCycleResourceRunConfiguration;
}

export interface SimulationResidentReadinessCertificate {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_READINESS_CERTIFICATE_SCHEMA_VERSION;
	readonly simulationReady: true;
	readonly missingLayers: readonly [];
	readonly readinessProfileId: typeof SIMULATION_RESIDENT_READINESS_PROFILE_ID;
	readonly certificationMode: typeof SIMULATION_RESIDENT_READINESS_CERTIFICATION_MODE;
	readonly activeRunEditPolicy: typeof SIMULATION_ACTIVE_RUN_EDIT_POLICY;
	readonly limitations: typeof SIMULATION_RESIDENT_READINESS_LIMITATIONS;
	readonly sourceKind: SimulationResidentScenarioManifest["sourceKind"];
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
	readonly parkingConfigurationFingerprint: string;
	readonly manifestFingerprint: string;
	readonly routesFingerprint: string;
	readonly leaseClaimsFingerprint: string;
	readonly admissionProgramFingerprint: string;
	readonly serviceTimingFingerprint: string;
	readonly resourceRunConfigurationFingerprint: string;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
	readonly pathCount: number;
	readonly trackResourceCount: number;
	readonly switchConflictResourceCount: number;
	readonly stationCount: number;
	readonly equipmentGroupCount: number;
	readonly vehicleCount: number;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly eqResourceCount: number;
	readonly storageResourceCount: number;
	readonly snapshotByteLength: number;
	readonly fingerprint: string;
}

export interface PublishedSimulationResidentReadinessSnapshot
	extends SimulationResidentReadinessSources {
	readonly certificate: SimulationResidentReadinessCertificate;
}

/** Worker-only publication entry: validates every exact source before setting simulationReady=true. */
export async function publishSimulationResidentReadinessSnapshot(
	sources: SimulationResidentReadinessSources,
): Promise<PublishedSimulationResidentReadinessSnapshot> {
	const error = simulationResidentReadinessSourcesError(sources);
	if (error) throw new Error(`Simulation resident readiness sources are invalid: ${error}`);
	if (
		!(await simulationResidentCycleRoutesMatchSources(
			sources.foundation,
			sources.trackResources,
			sources.occupancyPolicy,
			sources.stationCapabilities,
			sources.manifest,
			sources.parking,
			sources.routes,
		))
	) {
		throw new Error("Resident readiness routes do not reconstruct from their exact sources.");
	}
	if (
		!simulationResidentCycleLeaseClaimsMatchSources(
			sources.foundation,
			sources.trackResources,
			sources.occupancyPolicy,
			sources.parking,
			sources.routes,
			sources.leaseClaims,
		)
	) {
		throw new Error("Resident readiness lease claims do not reconstruct from exact routes.");
	}
	const finalError = simulationResidentReadinessSourcesError(sources);
	if (finalError) {
		throw new Error(`Resident readiness sources changed during certification: ${finalError}`);
	}
	const certificate = compileSimulationResidentReadinessCertificateFromValidatedSources(sources);
	return Object.freeze({ ...sources, certificate });
}

export function checksumSimulationResidentReadinessCertificate(
	certificate: Omit<SimulationResidentReadinessCertificate, "fingerprint">,
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
		certificate.vehicleCount,
		certificate.requestCount,
		certificate.loadCount,
		certificate.eqResourceCount,
		certificate.storageResourceCount,
		certificate.snapshotByteLength,
	]);
	checksum.addStrings([
		...certificate.missingLayers,
		certificate.readinessProfileId,
		certificate.certificationMode,
		certificate.activeRunEditPolicy,
		...certificate.limitations,
		certificate.sourceKind,
		certificate.sourceAuthoredChecksum,
		certificate.sourcePhysicalFingerprint,
		certificate.sourceRailReadinessFingerprint,
		certificate.foundationFingerprint,
		certificate.trackResourceFingerprint,
		certificate.stationCapabilitiesFingerprint,
		certificate.equipmentResourcesFingerprint,
		certificate.occupancyPolicyFingerprint,
		certificate.parkingConfigurationFingerprint,
		certificate.manifestFingerprint,
		certificate.routesFingerprint,
		certificate.leaseClaimsFingerprint,
		certificate.admissionProgramFingerprint,
		certificate.serviceTimingFingerprint,
		certificate.resourceRunConfigurationFingerprint,
		certificate.serviceTimingInputFingerprint,
		certificate.resourceRunInputFingerprint,
	]);
	return checksum.digest();
}

export function simulationResidentReadinessSourcesError(value: unknown): string | null {
	if (!isRecord(value)) return "resident readiness sources must be an object";
	if (!hasExactKeys(value, SOURCE_KEYS)) {
		return "resident readiness sources contain missing or unexpected fields";
	}
	const staticError = simulationReadinessComponentsError(value);
	if (staticError) return `static components are invalid: ${staticError}`;
	for (const [label, error] of [
		["parking", simulationResidentFleetParkingConfigurationError(value.parking)],
		["manifest", simulationResidentScenarioManifestError(value.manifest)],
		["routes", simulationResidentCycleRoutesError(value.routes)],
		["lease claims", simulationResidentCycleLeaseClaimsError(value.leaseClaims)],
		["admission", simulationResidentCycleAdmissionProgramError(value.admissionProgram)],
		["service timing", simulationResidentCycleServiceTimingError(value.serviceTiming)],
		[
			"resource run configuration",
			simulationResidentCycleResourceRunConfigurationError(value.resourceRunConfiguration),
		],
	] as const) {
		if (error) return `${label} is invalid: ${error}`;
	}
	const sources = value as unknown as SimulationResidentReadinessSources;
	if (
		!simulationResidentCycleAdmissionProgramMatchesValidatedSources(
			sources.foundation,
			sources.manifest,
			sources.parking,
			sources.routes,
			sources.leaseClaims,
			sources.admissionProgram,
		)
	) {
		return "resident admission rows do not match exact sources";
	}
	if (
		!simulationResidentCycleServiceTimingMatchesValidatedSources(
			sources.foundation,
			sources.equipmentResources,
			sources.manifest,
			sources.routes,
			sources.leaseClaims,
			sources.admissionProgram,
			sources.serviceTiming,
		)
	) {
		return "resident service timing rows do not match exact sources";
	}
	if (
		!simulationResidentCycleResourceRunConfigurationMatchesValidatedSources(
			resourceSources(sources),
			sources.resourceRunConfiguration,
		)
	) {
		return "resident resource rows do not match exact sources";
	}
	return null;
}

export function simulationResidentReadinessCertificateError(value: unknown): string | null {
	if (!isRecord(value)) return "resident readiness certificate must be an object";
	if (!hasExactKeys(value, CERTIFICATE_KEYS)) {
		return "resident readiness certificate contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_READINESS_CERTIFICATE_SCHEMA_VERSION ||
		value.simulationReady !== true ||
		!Array.isArray(value.missingLayers) ||
		value.missingLayers.length !== 0 ||
		value.readinessProfileId !== SIMULATION_RESIDENT_READINESS_PROFILE_ID ||
		value.certificationMode !== SIMULATION_RESIDENT_READINESS_CERTIFICATION_MODE ||
		value.activeRunEditPolicy !== SIMULATION_ACTIVE_RUN_EDIT_POLICY ||
		!sameStrings(value.limitations, SIMULATION_RESIDENT_READINESS_LIMITATIONS) ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY")
	) {
		return "resident readiness profile, policy, limitations, or source kind is invalid";
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
		"parkingConfigurationFingerprint",
		"manifestFingerprint",
		"routesFingerprint",
		"leaseClaimsFingerprint",
		"admissionProgramFingerprint",
		"serviceTimingFingerprint",
		"resourceRunConfigurationFingerprint",
		"serviceTimingInputFingerprint",
		"resourceRunInputFingerprint",
	] as const) {
		if (!isNonEmptyString(value[field])) return `resident certificate ${field} is invalid`;
	}
	for (const field of [
		"sourcePatchSequence",
		"sourceRevision",
		"pathCount",
		"trackResourceCount",
		"switchConflictResourceCount",
		"stationCount",
		"equipmentGroupCount",
		"vehicleCount",
		"requestCount",
		"loadCount",
		"eqResourceCount",
		"storageResourceCount",
		"snapshotByteLength",
	] as const) {
		if (!isNonNegativeSafeInteger(value[field])) return `resident certificate ${field} is invalid`;
	}
	if ((value.loadCount as number) > (value.requestCount as number)) {
		return "resident certificate load count exceeds request count";
	}
	if (!isNonEmptyString(value.fingerprint)) return "resident certificate fingerprint is invalid";
	const certificate = value as unknown as SimulationResidentReadinessCertificate;
	if (checksumSimulationResidentReadinessCertificate(certificate) !== certificate.fingerprint) {
		return "resident certificate fingerprint does not match its contents";
	}
	return null;
}

export function simulationResidentReadinessCertificateMatchesSources(
	certificate: SimulationResidentReadinessCertificate,
	sources: SimulationResidentReadinessSources,
): boolean {
	if (
		simulationResidentReadinessCertificateError(certificate) ||
		simulationResidentReadinessSourcesError(sources)
	) {
		return false;
	}
	try {
		return (
			compileSimulationResidentReadinessCertificateFromValidatedSources(sources).fingerprint ===
			certificate.fingerprint
		);
	} catch {
		return false;
	}
}

export async function publishedSimulationResidentReadinessSnapshotError(
	value: unknown,
): Promise<string | null> {
	if (!isRecord(value)) return "published resident readiness snapshot must be an object";
	if (!hasExactKeys(value, PUBLISHED_KEYS)) {
		return "published resident readiness snapshot contains missing or unexpected fields";
	}
	const published = value as unknown as PublishedSimulationResidentReadinessSnapshot;
	const sources = sourceFields(published);
	const sourceError = simulationResidentReadinessSourcesError(sources);
	if (sourceError) return sourceError;
	const certificateError = simulationResidentReadinessCertificateError(value.certificate);
	if (certificateError) return certificateError;
	try {
		const expected = await publishSimulationResidentReadinessSnapshot(sources);
		return expected.certificate.fingerprint === published.certificate.fingerprint
			? null
			: "published resident certificate does not match its sources";
	} catch {
		return "published resident certificate cannot be reconstructed";
	}
}

export async function isPublishedSimulationResidentReadinessSnapshot(
	value: unknown,
): Promise<boolean> {
	return (await publishedSimulationResidentReadinessSnapshotError(value)) === null;
}

function compileSimulationResidentReadinessCertificateFromValidatedSources(
	sources: SimulationResidentReadinessSources,
): SimulationResidentReadinessCertificate {
	const certificateWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_READINESS_CERTIFICATE_SCHEMA_VERSION,
		simulationReady: true,
		missingLayers: Object.freeze([]) as readonly [],
		readinessProfileId: SIMULATION_RESIDENT_READINESS_PROFILE_ID,
		certificationMode: SIMULATION_RESIDENT_READINESS_CERTIFICATION_MODE,
		activeRunEditPolicy: SIMULATION_ACTIVE_RUN_EDIT_POLICY,
		limitations: SIMULATION_RESIDENT_READINESS_LIMITATIONS,
		sourceKind: sources.manifest.sourceKind,
		sourcePatchSequence: sources.foundation.source.patchSequence,
		sourceRevision: sources.foundation.source.revision,
		sourceAuthoredChecksum: sources.foundation.source.authoredChecksum,
		sourcePhysicalFingerprint: sources.foundation.source.physicalFingerprint,
		sourceRailReadinessFingerprint: sources.foundation.source.readinessFingerprint,
		foundationFingerprint: sources.foundation.fingerprint,
		trackResourceFingerprint: sources.trackResources.fingerprint,
		stationCapabilitiesFingerprint: sources.stationCapabilities.fingerprint,
		equipmentResourcesFingerprint: sources.equipmentResources.fingerprint,
		occupancyPolicyFingerprint: sources.occupancyPolicy.fingerprint,
		parkingConfigurationFingerprint: sources.parking.fingerprint,
		manifestFingerprint: sources.manifest.fingerprint,
		routesFingerprint: sources.routes.fingerprint,
		leaseClaimsFingerprint: sources.leaseClaims.fingerprint,
		admissionProgramFingerprint: sources.admissionProgram.fingerprint,
		serviceTimingFingerprint: sources.serviceTiming.fingerprint,
		resourceRunConfigurationFingerprint: sources.resourceRunConfiguration.fingerprint,
		serviceTimingInputFingerprint: sources.serviceTiming.sourceTimingInputFingerprint,
		resourceRunInputFingerprint: sources.resourceRunConfiguration.sourceResourceInputFingerprint,
		pathCount: sources.foundation.paths.pathCount,
		trackResourceCount: sources.trackResources.trackResourceCount,
		switchConflictResourceCount: sources.trackResources.switchConflictResourceCount,
		stationCount: sources.foundation.stations.count,
		equipmentGroupCount: sources.foundation.equipmentGroups.count,
		vehicleCount: sources.parking.slotCount,
		requestCount: sources.routes.requestCount,
		loadCount: sources.admissionProgram.loadCount,
		eqResourceCount: sources.resourceRunConfiguration.eqResourceCount,
		storageResourceCount: sources.resourceRunConfiguration.storageResourceCount,
		snapshotByteLength: residentReadinessSnapshotByteLength(sources),
	} as const;
	const certificate = Object.freeze({
		...certificateWithoutIdentity,
		fingerprint: checksumSimulationResidentReadinessCertificate(certificateWithoutIdentity),
	}) satisfies SimulationResidentReadinessCertificate;
	const error = simulationResidentReadinessCertificateError(certificate);
	if (error) throw new Error(`Compiled resident readiness certificate is invalid: ${error}`);
	return certificate;
}

function residentReadinessSnapshotByteLength(sources: SimulationResidentReadinessSources): number {
	return (
		sources.foundation.byteLength +
		sources.trackResources.byteLength +
		sources.stationCapabilities.byteLength +
		sources.equipmentResources.byteLength +
		sources.occupancyPolicy.byteLength +
		sources.parking.byteLength +
		sources.routes.byteLength +
		sources.leaseClaims.byteLength +
		sources.admissionProgram.byteLength +
		sources.serviceTiming.byteLength +
		sources.resourceRunConfiguration.byteLength
	);
}

function resourceSources(
	sources: SimulationResidentReadinessSources,
): SimulationResidentCycleResourceSources {
	return {
		foundation: sources.foundation,
		trackResources: sources.trackResources,
		occupancyPolicy: sources.occupancyPolicy,
		equipmentResources: sources.equipmentResources,
		manifest: sources.manifest,
		parking: sources.parking,
		routes: sources.routes,
		leaseClaims: sources.leaseClaims,
		admissionProgram: sources.admissionProgram,
		serviceTiming: sources.serviceTiming,
	};
}

function sourceFields(
	published: PublishedSimulationResidentReadinessSnapshot,
): SimulationResidentReadinessSources {
	return {
		foundation: published.foundation,
		trackResources: published.trackResources,
		stationCapabilities: published.stationCapabilities,
		equipmentResources: published.equipmentResources,
		occupancyPolicy: published.occupancyPolicy,
		parking: published.parking,
		manifest: published.manifest,
		routes: published.routes,
		leaseClaims: published.leaseClaims,
		admissionProgram: published.admissionProgram,
		serviceTiming: published.serviceTiming,
		resourceRunConfiguration: published.resourceRunConfiguration,
	};
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, row) => entry === expected[row])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
