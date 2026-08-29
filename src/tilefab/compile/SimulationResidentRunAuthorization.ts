import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { SIMULATION_ACTIVE_RUN_EDIT_POLICY } from "./SimulationReadinessCertificate";
import {
	type PublishedSimulationResidentReadinessSnapshot,
	publishedSimulationResidentReadinessSnapshotError,
	SIMULATION_RESIDENT_READINESS_LIMITATIONS,
	SIMULATION_RESIDENT_READINESS_PROFILE_ID,
} from "./SimulationResidentReadinessCertificate";

export const SIMULATION_RESIDENT_RUN_AUTHORIZATION_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_RUN_AUTHORIZATION_POLICY =
	"EXPLICIT_CERTIFIED_HOME_RETURN_BUNDLE_V1" as const;
export const SIMULATION_RESIDENT_RUN_AUTHORIZATION_CONSUMPTION_POLICY =
	"REALM_LOCAL_SYNCHRONOUS_ONE_SHOT_V1" as const;

const AUTHORIZATION_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingRuntimeLayers",
	"authorizationPolicy",
	"consumptionPolicy",
	"activeRunEditPolicy",
	"limitations",
	"projectId",
	"preparationGeneration",
	"authorizationGeneration",
	"sourceKind",
	"sourceRunAssetFingerprint",
	"sourceCertificateFingerprint",
	"sourceReadinessProfileId",
	"sourceFoundationFingerprint",
	"sourceParkingConfigurationFingerprint",
	"sourceManifestFingerprint",
	"sourceRoutesFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceAdmissionProgramFingerprint",
	"sourceServiceTimingFingerprint",
	"sourceResourceRunConfigurationFingerprint",
	"sourceServiceTimingInputFingerprint",
	"sourceResourceRunInputFingerprint",
	"requestCount",
	"loadCount",
	"vehicleCount",
	"eqResourceCount",
	"storageResourceCount",
	"snapshotByteLength",
	"fingerprint",
] as const);
const INPUT_KEYS = Object.freeze([
	"projectId",
	"preparationGeneration",
	"authorizationGeneration",
	"runAssetFingerprint",
	"snapshot",
] as const);

export interface IssueSimulationResidentRunAuthorizationInput {
	readonly projectId: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly runAssetFingerprint: string;
	readonly snapshot: PublishedSimulationResidentReadinessSnapshot;
}

/** Metadata identity only; the realm-local capability is required for actual one-shot adoption. */
export interface SimulationResidentRunAuthorization {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_RUN_AUTHORIZATION_SCHEMA_VERSION;
	readonly simulationRunnable: true;
	readonly missingRuntimeLayers: readonly [];
	readonly authorizationPolicy: typeof SIMULATION_RESIDENT_RUN_AUTHORIZATION_POLICY;
	readonly consumptionPolicy: typeof SIMULATION_RESIDENT_RUN_AUTHORIZATION_CONSUMPTION_POLICY;
	readonly activeRunEditPolicy: typeof SIMULATION_ACTIVE_RUN_EDIT_POLICY;
	readonly limitations: typeof SIMULATION_RESIDENT_READINESS_LIMITATIONS;
	readonly projectId: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly sourceKind: PublishedSimulationResidentReadinessSnapshot["manifest"]["sourceKind"];
	readonly sourceRunAssetFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly sourceReadinessProfileId: typeof SIMULATION_RESIDENT_READINESS_PROFILE_ID;
	readonly sourceFoundationFingerprint: string;
	readonly sourceParkingConfigurationFingerprint: string;
	readonly sourceManifestFingerprint: string;
	readonly sourceRoutesFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceAdmissionProgramFingerprint: string;
	readonly sourceServiceTimingFingerprint: string;
	readonly sourceResourceRunConfigurationFingerprint: string;
	readonly sourceServiceTimingInputFingerprint: string;
	readonly sourceResourceRunInputFingerprint: string;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly vehicleCount: number;
	readonly eqResourceCount: number;
	readonly storageResourceCount: number;
	readonly snapshotByteLength: number;
	readonly fingerprint: string;
}

const RESIDENT_AUTHORIZATION_CAPABILITY_BRAND: unique symbol = Symbol(
	"OpenFabSimulationResidentRunAuthorizationCapability",
);

/** Opaque realm-local authority. Structured clones and reconstructed metadata are never live. */
export interface SimulationResidentRunAuthorizationCapability {
	readonly [RESIDENT_AUTHORIZATION_CAPABILITY_BRAND]: true;
}

export interface SimulationResidentRunAuthorizationGrant {
	readonly authorization: SimulationResidentRunAuthorization;
	readonly capability: SimulationResidentRunAuthorizationCapability;
}

const RESIDENT_RUN_ADOPTION_BRAND: unique symbol = Symbol(
	"OpenFabSimulationResidentRunAuthorizationAdoption",
);

/** Ephemeral proof available only during the one synchronous authorization adopter. */
export interface SimulationResidentRunAuthorizationAdoption {
	readonly [RESIDENT_RUN_ADOPTION_BRAND]: true;
}

interface RetainedResidentAuthorizationCapability {
	readonly authorization: SimulationResidentRunAuthorization;
	readonly projectId: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly runAssetFingerprint: string;
	readonly snapshot: PublishedSimulationResidentReadinessSnapshot;
}

const liveResidentAuthorizationCapabilities = new WeakMap<
	SimulationResidentRunAuthorizationCapability,
	RetainedResidentAuthorizationCapability
>();
const liveResidentRunAdoptions = new WeakMap<
	SimulationResidentRunAuthorizationAdoption,
	Readonly<{
		authorization: SimulationResidentRunAuthorization;
		snapshot: PublishedSimulationResidentReadinessSnapshot;
	}>
>();

/**
 * Issues metadata plus one realm-local capability only after a fresh exact-source resident
 * publication audit. No scheduler, runtime vehicle, or UI state is created here.
 */
export async function issueSimulationResidentRunAuthorization(
	input: IssueSimulationResidentRunAuthorizationInput,
): Promise<SimulationResidentRunAuthorizationGrant> {
	await assertResidentAuthorizationInput(input);
	const authorization = compileSimulationResidentRunAuthorizationFromValidatedInput(input);
	const capability = Object.freeze({
		[RESIDENT_AUTHORIZATION_CAPABILITY_BRAND]: true as const,
	});
	liveResidentAuthorizationCapabilities.set(capability, retainInput(authorization, input));
	return Object.freeze({ authorization, capability });
}

/** Explicitly revokes an unconsumed local grant. */
export function discardSimulationResidentRunAuthorizationGrant(
	grant: SimulationResidentRunAuthorizationGrant,
): void {
	liveResidentAuthorizationCapabilities.delete(grant.capability);
}

/**
 * Atomically consumes the capability before awaiting a final exact-source audit. The adopter must
 * construct its future owner synchronously; validation failure, mismatch, reuse, or an async adopter
 * yields no authority.
 */
export async function consumeSimulationResidentRunAuthorization<T>(
	grant: SimulationResidentRunAuthorizationGrant,
	input: IssueSimulationResidentRunAuthorizationInput,
	adopter: (
		authorization: SimulationResidentRunAuthorization,
		snapshot: PublishedSimulationResidentReadinessSnapshot,
		adoption: SimulationResidentRunAuthorizationAdoption,
	) => T,
): Promise<T | null> {
	const retained = liveResidentAuthorizationCapabilities.get(grant.capability);
	liveResidentAuthorizationCapabilities.delete(grant.capability);
	if (
		!retained ||
		grant.authorization !== retained.authorization ||
		typeof adopter !== "function" ||
		!retainedInputMatches(retained, input)
	) {
		return null;
	}
	try {
		await assertResidentAuthorizationInput(input);
	} catch {
		return null;
	}
	if (!retainedInputMatches(retained, input)) return null;
	const expected = compileSimulationResidentRunAuthorizationFromValidatedInput(input);
	if (
		simulationResidentRunAuthorizationError(grant.authorization) !== null ||
		expected.fingerprint !== grant.authorization.fingerprint
	) {
		return null;
	}
	const adoption = issueResidentRunAdoption(grant.authorization, input.snapshot);
	try {
		const adopted = adopter(grant.authorization, input.snapshot, adoption);
		if (isPromiseLike(adopted)) {
			throw new Error("Resident Run authorization adopter must complete synchronously.");
		}
		return adopted;
	} finally {
		liveResidentRunAdoptions.delete(adoption);
	}
}

/** Consumes the ephemeral proof once at a synchronous resident runtime construction boundary. */
export function consumeSimulationResidentRunAuthorizationAdoption(
	adoption: SimulationResidentRunAuthorizationAdoption,
	authorization: SimulationResidentRunAuthorization,
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): boolean {
	const retained = liveResidentRunAdoptions.get(adoption);
	liveResidentRunAdoptions.delete(adoption);
	return retained?.authorization === authorization && retained.snapshot === snapshot;
}

export function checksumSimulationResidentRunAuthorization(
	authorization: Omit<SimulationResidentRunAuthorization, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		authorization.schemaVersion,
		authorization.simulationRunnable ? 1 : 0,
		authorization.preparationGeneration,
		authorization.authorizationGeneration,
		authorization.requestCount,
		authorization.loadCount,
		authorization.vehicleCount,
		authorization.eqResourceCount,
		authorization.storageResourceCount,
		authorization.snapshotByteLength,
	]);
	checksum.addStrings([
		...authorization.missingRuntimeLayers,
		authorization.authorizationPolicy,
		authorization.consumptionPolicy,
		authorization.activeRunEditPolicy,
		...authorization.limitations,
		authorization.projectId,
		authorization.sourceKind,
		authorization.sourceRunAssetFingerprint,
		authorization.sourceCertificateFingerprint,
		authorization.sourceReadinessProfileId,
		authorization.sourceFoundationFingerprint,
		authorization.sourceParkingConfigurationFingerprint,
		authorization.sourceManifestFingerprint,
		authorization.sourceRoutesFingerprint,
		authorization.sourceLeaseClaimsFingerprint,
		authorization.sourceAdmissionProgramFingerprint,
		authorization.sourceServiceTimingFingerprint,
		authorization.sourceResourceRunConfigurationFingerprint,
		authorization.sourceServiceTimingInputFingerprint,
		authorization.sourceResourceRunInputFingerprint,
	]);
	return checksum.digest();
}

export function simulationResidentRunAuthorizationError(value: unknown): string | null {
	if (!isRecord(value)) return "resident Run authorization must be an object";
	if (!hasExactKeys(value, AUTHORIZATION_KEYS)) {
		return "resident Run authorization contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_RUN_AUTHORIZATION_SCHEMA_VERSION ||
		value.simulationRunnable !== true ||
		!Array.isArray(value.missingRuntimeLayers) ||
		value.missingRuntimeLayers.length !== 0 ||
		value.authorizationPolicy !== SIMULATION_RESIDENT_RUN_AUTHORIZATION_POLICY ||
		value.consumptionPolicy !== SIMULATION_RESIDENT_RUN_AUTHORIZATION_CONSUMPTION_POLICY ||
		value.activeRunEditPolicy !== SIMULATION_ACTIVE_RUN_EDIT_POLICY ||
		!sameStrings(value.limitations, SIMULATION_RESIDENT_READINESS_LIMITATIONS) ||
		value.sourceReadinessProfileId !== SIMULATION_RESIDENT_READINESS_PROFILE_ID
	) {
		return "resident Run authorization profile, policy, or limitations are invalid";
	}
	if (!isProjectId(value.projectId)) return "resident Run authorization project ID is invalid";
	if (
		!isPositiveSafeInteger(value.preparationGeneration) ||
		!isPositiveSafeInteger(value.authorizationGeneration)
	) {
		return "resident Run authorization generations are invalid";
	}
	if (value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") {
		return "resident Run authorization source kind is invalid";
	}
	for (const key of [
		"sourceRunAssetFingerprint",
		"sourceCertificateFingerprint",
		"sourceFoundationFingerprint",
		"sourceParkingConfigurationFingerprint",
		"sourceManifestFingerprint",
		"sourceRoutesFingerprint",
		"sourceLeaseClaimsFingerprint",
		"sourceAdmissionProgramFingerprint",
		"sourceServiceTimingFingerprint",
		"sourceResourceRunConfigurationFingerprint",
		"sourceServiceTimingInputFingerprint",
		"sourceResourceRunInputFingerprint",
	] as const) {
		if (!isBoundedIdentity(value[key])) return `resident Run authorization ${key} is invalid`;
	}
	if (
		!isPositiveSafeInteger(value.requestCount) ||
		!isPositiveSafeInteger(value.loadCount) ||
		!isPositiveSafeInteger(value.vehicleCount) ||
		!isNonNegativeSafeInteger(value.eqResourceCount) ||
		!isNonNegativeSafeInteger(value.storageResourceCount) ||
		(value.loadCount as number) > (value.requestCount as number) ||
		(value.eqResourceCount as number) + (value.storageResourceCount as number) === 0 ||
		!isPositiveSafeInteger(value.snapshotByteLength)
	) {
		return "resident Run authorization counts or byte length are invalid";
	}
	if (!isBoundedIdentity(value.fingerprint)) {
		return "resident Run authorization fingerprint is invalid";
	}
	try {
		const authorization = value as unknown as SimulationResidentRunAuthorization;
		if (checksumSimulationResidentRunAuthorization(authorization) !== authorization.fingerprint) {
			return "resident Run authorization fingerprint does not match its contents";
		}
	} catch {
		return "resident Run authorization fingerprint cannot be recomputed";
	}
	return null;
}

function compileSimulationResidentRunAuthorizationFromValidatedInput(
	input: IssueSimulationResidentRunAuthorizationInput,
): SimulationResidentRunAuthorization {
	const { snapshot } = input;
	const fields = {
		schemaVersion: SIMULATION_RESIDENT_RUN_AUTHORIZATION_SCHEMA_VERSION,
		simulationRunnable: true,
		missingRuntimeLayers: Object.freeze([]) as readonly [],
		authorizationPolicy: SIMULATION_RESIDENT_RUN_AUTHORIZATION_POLICY,
		consumptionPolicy: SIMULATION_RESIDENT_RUN_AUTHORIZATION_CONSUMPTION_POLICY,
		activeRunEditPolicy: SIMULATION_ACTIVE_RUN_EDIT_POLICY,
		limitations: SIMULATION_RESIDENT_READINESS_LIMITATIONS,
		projectId: input.projectId,
		preparationGeneration: input.preparationGeneration,
		authorizationGeneration: input.authorizationGeneration,
		sourceKind: snapshot.manifest.sourceKind,
		sourceRunAssetFingerprint: input.runAssetFingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		sourceReadinessProfileId: snapshot.certificate.readinessProfileId,
		sourceFoundationFingerprint: snapshot.foundation.fingerprint,
		sourceParkingConfigurationFingerprint: snapshot.parking.fingerprint,
		sourceManifestFingerprint: snapshot.manifest.fingerprint,
		sourceRoutesFingerprint: snapshot.routes.fingerprint,
		sourceLeaseClaimsFingerprint: snapshot.leaseClaims.fingerprint,
		sourceAdmissionProgramFingerprint: snapshot.admissionProgram.fingerprint,
		sourceServiceTimingFingerprint: snapshot.serviceTiming.fingerprint,
		sourceResourceRunConfigurationFingerprint: snapshot.resourceRunConfiguration.fingerprint,
		sourceServiceTimingInputFingerprint: snapshot.serviceTiming.sourceTimingInputFingerprint,
		sourceResourceRunInputFingerprint:
			snapshot.resourceRunConfiguration.sourceResourceInputFingerprint,
		requestCount: snapshot.routes.requestCount,
		loadCount: snapshot.admissionProgram.loadCount,
		vehicleCount: snapshot.parking.slotCount,
		eqResourceCount: snapshot.resourceRunConfiguration.eqResourceCount,
		storageResourceCount: snapshot.resourceRunConfiguration.storageResourceCount,
		snapshotByteLength: snapshot.certificate.snapshotByteLength,
	} as const;
	const authorization = Object.freeze({
		...fields,
		fingerprint: checksumSimulationResidentRunAuthorization(fields),
	}) satisfies SimulationResidentRunAuthorization;
	const error = simulationResidentRunAuthorizationError(authorization);
	if (error) throw new Error(`Compiled resident Run authorization is invalid: ${error}`);
	return authorization;
}

async function assertResidentAuthorizationInput(
	input: IssueSimulationResidentRunAuthorizationInput,
): Promise<void> {
	const initialError = residentAuthorizationInputMetadataError(input);
	if (initialError) throw new Error(`Resident Run authorization input is invalid: ${initialError}`);
	const snapshot = input.snapshot;
	const snapshotError = await publishedSimulationResidentReadinessSnapshotError(snapshot);
	if (snapshotError) {
		throw new Error(`Resident Run authorization snapshot is invalid: ${snapshotError}`);
	}
	const finalError = residentAuthorizationInputMetadataError(input);
	if (finalError || input.snapshot !== snapshot) {
		throw new Error(
			`Resident Run authorization input changed during validation${finalError ? `: ${finalError}` : "."}`,
		);
	}
}

function residentAuthorizationInputMetadataError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, INPUT_KEYS)) {
		return "input contains missing or unexpected fields";
	}
	if (!isProjectId(value.projectId)) return "project identity is invalid";
	if (
		!isPositiveSafeInteger(value.preparationGeneration) ||
		!isPositiveSafeInteger(value.authorizationGeneration)
	) {
		return "generations must be positive safe integers";
	}
	if (!isBoundedIdentity(value.runAssetFingerprint)) {
		return "run-asset fingerprint is invalid";
	}
	if (!isRecord(value.snapshot)) return "resident readiness snapshot is invalid";
	return null;
}

function retainInput(
	authorization: SimulationResidentRunAuthorization,
	input: IssueSimulationResidentRunAuthorizationInput,
): RetainedResidentAuthorizationCapability {
	return Object.freeze({
		authorization,
		projectId: input.projectId,
		preparationGeneration: input.preparationGeneration,
		authorizationGeneration: input.authorizationGeneration,
		runAssetFingerprint: input.runAssetFingerprint,
		snapshot: input.snapshot,
	});
}

function issueResidentRunAdoption(
	authorization: SimulationResidentRunAuthorization,
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): SimulationResidentRunAuthorizationAdoption {
	const adoption = Object.freeze({ [RESIDENT_RUN_ADOPTION_BRAND]: true as const });
	liveResidentRunAdoptions.set(adoption, Object.freeze({ authorization, snapshot }));
	return adoption;
}

function retainedInputMatches(
	retained: RetainedResidentAuthorizationCapability,
	input: IssueSimulationResidentRunAuthorizationInput,
): boolean {
	return (
		retained.projectId === input.projectId &&
		retained.preparationGeneration === input.preparationGeneration &&
		retained.authorizationGeneration === input.authorizationGeneration &&
		retained.runAssetFingerprint === input.runAssetFingerprint &&
		retained.snapshot === input.snapshot
	);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
}

function isBoundedIdentity(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, index) => entry === expected[index])
	);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return isRecord(value) && typeof value.then === "function";
}
