import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
	SIMULATION_ACTIVE_RUN_EDIT_POLICY,
	SIMULATION_READINESS_LIMITATIONS,
} from "./SimulationReadinessCertificate";
import type { SimulationScenarioAdmissionProgram } from "./SimulationScenarioAdmissionProgram";
import type { SimulationScenarioLeaseClaims } from "./SimulationScenarioLeaseClaims";
import {
	type SimulationScenarioManifest,
	simulationScenarioManifestError,
} from "./SimulationScenarioManifest";
import {
	advanceSimulationScenarioPreparedArtifactChainValidation,
	consumeSimulationScenarioPreparedArtifactChainValidation,
	discardSimulationScenarioPreparedArtifactChainValidation,
	type SimulationScenarioPreparedArtifactChainValidation,
	simulationScenarioPreparedArtifactChainMatchesPreparedSources,
} from "./SimulationScenarioPreparedArtifacts";
import type { SimulationScenarioResourceRunConfiguration } from "./SimulationScenarioResourceRunConfiguration";
import type { SimulationScenarioRouteRequests } from "./SimulationScenarioRouteRequests";
import type { SimulationScenarioServiceTiming } from "./SimulationScenarioServiceTiming";

export const SIMULATION_SCENARIO_RUN_AUTHORIZATION_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_RUN_AUTHORIZATION_POLICY =
	"EXPLICIT_CURRENT_PREPARED_BUNDLE_V1" as const;
export const SIMULATION_SCENARIO_RUN_AUTHORIZATION_CONSUMPTION_POLICY =
	"CONTROLLER_OWNED_ONE_SHOT_V1" as const;

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
	"sourceManifestFingerprint",
	"sourceCertificateFingerprint",
	"sourceReadinessProfileId",
	"sourceRouteRequestsFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceAdmissionProgramFingerprint",
	"sourceServiceTimingFingerprint",
	"sourceResourceRunConfigurationFingerprint",
	"sourceServiceTimingInputFingerprint",
	"sourceResourceRunInputFingerprint",
	"runIdentityFingerprint",
	"requestCount",
	"loadCount",
	"eqResourceCount",
	"storageResourceCount",
	"fingerprint",
] as const);

export interface SimulationScenarioPreparedAuthorizationSources {
	readonly routes: SimulationScenarioRouteRequests;
	readonly leaseClaims: SimulationScenarioLeaseClaims;
	readonly admissionProgram: SimulationScenarioAdmissionProgram;
	readonly serviceTiming: SimulationScenarioServiceTiming;
	readonly resourceRunConfiguration: SimulationScenarioResourceRunConfiguration;
}

export interface CompileSimulationScenarioRunAuthorizationInput {
	readonly projectId: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly runAssetFingerprint: string;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
	readonly snapshot: PublishedSimulationReadinessSnapshot;
	readonly manifest: SimulationScenarioManifest;
	readonly prepared: SimulationScenarioPreparedAuthorizationSources;
}

/**
 * Metadata-only authority for the disclosed unlaunched-token profile. Prepared artifacts remain
 * non-runnable inputs; only this exact, controller-owned, one-shot proof authorizes construction of
 * a limited run owner after a final current-source recheck.
 */
export interface SimulationScenarioRunAuthorization {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_RUN_AUTHORIZATION_SCHEMA_VERSION;
	readonly simulationRunnable: true;
	readonly missingRuntimeLayers: readonly [];
	readonly authorizationPolicy: typeof SIMULATION_SCENARIO_RUN_AUTHORIZATION_POLICY;
	readonly consumptionPolicy: typeof SIMULATION_SCENARIO_RUN_AUTHORIZATION_CONSUMPTION_POLICY;
	readonly activeRunEditPolicy: typeof SIMULATION_ACTIVE_RUN_EDIT_POLICY;
	readonly limitations: typeof SIMULATION_READINESS_LIMITATIONS;
	readonly projectId: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly sourceRunAssetFingerprint: string;
	readonly sourceManifestFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly sourceReadinessProfileId: string;
	readonly sourceRouteRequestsFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceAdmissionProgramFingerprint: string;
	readonly sourceServiceTimingFingerprint: string;
	readonly sourceResourceRunConfigurationFingerprint: string;
	readonly sourceServiceTimingInputFingerprint: string;
	readonly sourceResourceRunInputFingerprint: string;
	readonly runIdentityFingerprint: string;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly eqResourceCount: number;
	readonly storageResourceCount: number;
	readonly fingerprint: string;
}

export function compileSimulationScenarioRunAuthorization(
	input: CompileSimulationScenarioRunAuthorizationInput,
): SimulationScenarioRunAuthorization {
	assertAuthorizationInput(input);
	return compileSimulationScenarioRunAuthorizationFromValidatedInput(input);
}

/**
 * Controller-only fast path. A realm-local proof is consumed once, so callers cannot reuse an old
 * validation after retained typed-array buffers change.
 */
export function compileSimulationScenarioRunAuthorizationFromValidatedPreparedSources(
	input: CompileSimulationScenarioRunAuthorizationInput,
	validation: SimulationScenarioPreparedArtifactChainValidation,
): SimulationScenarioRunAuthorization {
	if (
		!consumeSimulationScenarioPreparedArtifactChainValidation(
			validation,
			input.snapshot,
			input.manifest,
			input.serviceTimingInputFingerprint,
			input.resourceRunInputFingerprint,
			input.prepared,
		)
	) {
		throw new Error("Run authorization prepared-source validation is stale or mismatched.");
	}
	assertAuthorizationMetadataInput(input);
	return compileSimulationScenarioRunAuthorizationFromValidatedInput(input);
}

function compileSimulationScenarioRunAuthorizationFromValidatedInput(
	input: CompileSimulationScenarioRunAuthorizationInput,
): SimulationScenarioRunAuthorization {
	const { snapshot, manifest, prepared } = input;
	const authorizationWithoutFingerprint = {
		schemaVersion: SIMULATION_SCENARIO_RUN_AUTHORIZATION_SCHEMA_VERSION,
		simulationRunnable: true,
		missingRuntimeLayers: Object.freeze([]) as readonly [],
		authorizationPolicy: SIMULATION_SCENARIO_RUN_AUTHORIZATION_POLICY,
		consumptionPolicy: SIMULATION_SCENARIO_RUN_AUTHORIZATION_CONSUMPTION_POLICY,
		activeRunEditPolicy: SIMULATION_ACTIVE_RUN_EDIT_POLICY,
		limitations: SIMULATION_READINESS_LIMITATIONS,
		projectId: input.projectId,
		preparationGeneration: input.preparationGeneration,
		authorizationGeneration: input.authorizationGeneration,
		sourceKind: manifest.sourceKind,
		sourceRunAssetFingerprint: input.runAssetFingerprint,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		sourceReadinessProfileId: snapshot.certificate.readinessProfileId,
		sourceRouteRequestsFingerprint: prepared.routes.fingerprint,
		sourceLeaseClaimsFingerprint: prepared.leaseClaims.fingerprint,
		sourceAdmissionProgramFingerprint: prepared.admissionProgram.fingerprint,
		sourceServiceTimingFingerprint: prepared.serviceTiming.fingerprint,
		sourceResourceRunConfigurationFingerprint: prepared.resourceRunConfiguration.fingerprint,
		sourceServiceTimingInputFingerprint: input.serviceTimingInputFingerprint,
		sourceResourceRunInputFingerprint: input.resourceRunInputFingerprint,
		runIdentityFingerprint: prepared.routes.runIdentityFingerprint,
		requestCount: prepared.routes.requestCount,
		loadCount: prepared.admissionProgram.loadCount,
		eqResourceCount: prepared.resourceRunConfiguration.eqResourceCount,
		storageResourceCount: prepared.resourceRunConfiguration.storageResourceCount,
	} as const;
	const authorization = Object.freeze({
		...authorizationWithoutFingerprint,
		fingerprint: checksumSimulationScenarioRunAuthorization(authorizationWithoutFingerprint),
	}) satisfies SimulationScenarioRunAuthorization;
	const error = simulationScenarioRunAuthorizationError(authorization);
	if (error) throw new Error(`Simulation scenario Run authorization is invalid: ${error}`);
	return authorization;
}

export function checksumSimulationScenarioRunAuthorization(
	authorization: Omit<SimulationScenarioRunAuthorization, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		authorization.schemaVersion,
		authorization.simulationRunnable ? 1 : 0,
		authorization.preparationGeneration,
		authorization.authorizationGeneration,
		authorization.requestCount,
		authorization.loadCount,
		authorization.eqResourceCount,
		authorization.storageResourceCount,
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
		authorization.sourceManifestFingerprint,
		authorization.sourceCertificateFingerprint,
		authorization.sourceReadinessProfileId,
		authorization.sourceRouteRequestsFingerprint,
		authorization.sourceLeaseClaimsFingerprint,
		authorization.sourceAdmissionProgramFingerprint,
		authorization.sourceServiceTimingFingerprint,
		authorization.sourceResourceRunConfigurationFingerprint,
		authorization.sourceServiceTimingInputFingerprint,
		authorization.sourceResourceRunInputFingerprint,
		authorization.runIdentityFingerprint,
	]);
	return checksum.digest();
}

export function simulationScenarioRunAuthorizationError(value: unknown): string | null {
	if (!isRecord(value)) return "Run authorization must be an object";
	if (!hasExactKeys(value, AUTHORIZATION_KEYS)) {
		return "Run authorization contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_SCENARIO_RUN_AUTHORIZATION_SCHEMA_VERSION ||
		value.simulationRunnable !== true ||
		!Array.isArray(value.missingRuntimeLayers) ||
		value.missingRuntimeLayers.length !== 0 ||
		value.authorizationPolicy !== SIMULATION_SCENARIO_RUN_AUTHORIZATION_POLICY ||
		value.consumptionPolicy !== SIMULATION_SCENARIO_RUN_AUTHORIZATION_CONSUMPTION_POLICY ||
		value.activeRunEditPolicy !== SIMULATION_ACTIVE_RUN_EDIT_POLICY ||
		!sameStrings(value.limitations, SIMULATION_READINESS_LIMITATIONS)
	) {
		return "Run authorization policy or limitations are invalid";
	}
	if (!isProjectId(value.projectId)) return "Run authorization project identity is invalid";
	if (
		!isPositiveSafeInteger(value.preparationGeneration) ||
		!isPositiveSafeInteger(value.authorizationGeneration)
	) {
		return "Run authorization generations are invalid";
	}
	if (value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") {
		return "Run authorization source kind is invalid";
	}
	for (const key of [
		"sourceRunAssetFingerprint",
		"sourceManifestFingerprint",
		"sourceCertificateFingerprint",
		"sourceReadinessProfileId",
		"sourceRouteRequestsFingerprint",
		"sourceLeaseClaimsFingerprint",
		"sourceAdmissionProgramFingerprint",
		"sourceServiceTimingFingerprint",
		"sourceResourceRunConfigurationFingerprint",
		"sourceServiceTimingInputFingerprint",
		"sourceResourceRunInputFingerprint",
		"runIdentityFingerprint",
	] as const) {
		if (!isBoundedIdentity(value[key])) return `Run authorization ${key} is invalid`;
	}
	if (
		!isPositiveSafeInteger(value.requestCount) ||
		!isPositiveSafeInteger(value.loadCount) ||
		!isNonNegativeSafeInteger(value.eqResourceCount) ||
		!isNonNegativeSafeInteger(value.storageResourceCount) ||
		(value.loadCount as number) > (value.requestCount as number)
	) {
		return "Run authorization counts are invalid";
	}
	if (!isBoundedIdentity(value.fingerprint)) return "Run authorization fingerprint is invalid";
	try {
		const authorization = value as unknown as SimulationScenarioRunAuthorization;
		if (checksumSimulationScenarioRunAuthorization(authorization) !== authorization.fingerprint) {
			return "Run authorization fingerprint does not match";
		}
	} catch {
		return "Run authorization fingerprint cannot be recomputed";
	}
	return null;
}

export function simulationScenarioRunAuthorizationMatchesSources(
	authorization: SimulationScenarioRunAuthorization,
	input: CompileSimulationScenarioRunAuthorizationInput,
): boolean {
	if (simulationScenarioRunAuthorizationError(authorization)) return false;
	try {
		return (
			compileSimulationScenarioRunAuthorization(input).fingerprint === authorization.fingerprint
		);
	} catch {
		return false;
	}
}

/** Recomputes authorization identity while consuming one exact current-source validation proof. */
export function simulationScenarioRunAuthorizationMatchesValidatedPreparedSources(
	authorization: SimulationScenarioRunAuthorization,
	input: CompileSimulationScenarioRunAuthorizationInput,
	validation: SimulationScenarioPreparedArtifactChainValidation,
): boolean {
	const nextValidation = simulationScenarioRunAuthorizationAdvanceValidatedPreparedSources(
		authorization,
		input,
		validation,
	);
	if (!nextValidation) return false;
	discardSimulationScenarioPreparedArtifactChainValidation(nextValidation);
	return true;
}

/**
 * Checks exact authorization identity and rotates the one-use proof for one immediate downstream
 * scheduler adoption. Callers must revoke the successor if construction does not consume it.
 */
export function simulationScenarioRunAuthorizationAdvanceValidatedPreparedSources(
	authorization: SimulationScenarioRunAuthorization,
	input: CompileSimulationScenarioRunAuthorizationInput,
	validation: SimulationScenarioPreparedArtifactChainValidation,
): SimulationScenarioPreparedArtifactChainValidation | null {
	const nextValidation = advanceSimulationScenarioPreparedArtifactChainValidation(
		validation,
		input.snapshot,
		input.manifest,
		input.serviceTimingInputFingerprint,
		input.resourceRunInputFingerprint,
		input.prepared,
	);
	if (!nextValidation) return null;
	try {
		assertAuthorizationMetadataInput(input);
		const expected = compileSimulationScenarioRunAuthorizationFromValidatedInput(input);
		if (
			simulationScenarioRunAuthorizationError(authorization) === null &&
			expected.fingerprint === authorization.fingerprint
		) {
			return nextValidation;
		}
	} catch {
		// The successor is revoked below.
	}
	discardSimulationScenarioPreparedArtifactChainValidation(nextValidation);
	return null;
}

function assertAuthorizationInput(input: CompileSimulationScenarioRunAuthorizationInput): void {
	assertAuthorizationMetadataInput(input);
	const snapshotError = publishedSimulationReadinessSnapshotError(input.snapshot);
	const manifestError = simulationScenarioManifestError(input.manifest);
	if (snapshotError || manifestError) {
		throw new Error(
			snapshotError
				? `Run authorization readiness snapshot is invalid: ${snapshotError}`
				: `Run authorization manifest is invalid: ${manifestError}`,
		);
	}
	const { snapshot, manifest, prepared } = input;
	if (
		!simulationScenarioPreparedArtifactChainMatchesPreparedSources(snapshot, manifest, prepared) ||
		prepared.serviceTiming.sourceTimingInputFingerprint !== input.serviceTimingInputFingerprint ||
		prepared.resourceRunConfiguration.sourceResourceInputFingerprint !==
			input.resourceRunInputFingerprint
	) {
		throw new Error("Run authorization sources do not match the exact prepared bundle.");
	}
}

function assertAuthorizationMetadataInput(
	input: CompileSimulationScenarioRunAuthorizationInput,
): void {
	if (!isProjectId(input.projectId))
		throw new Error("Run authorization project identity is invalid.");
	if (
		!isPositiveSafeInteger(input.preparationGeneration) ||
		!isPositiveSafeInteger(input.authorizationGeneration)
	) {
		throw new Error("Run authorization generations must be positive safe integers.");
	}
	for (const [label, value] of [
		["run asset", input.runAssetFingerprint],
		["service timing input", input.serviceTimingInputFingerprint],
		["resource run input", input.resourceRunInputFingerprint],
	] as const) {
		if (!isBoundedIdentity(value))
			throw new Error(`Run authorization ${label} fingerprint is invalid.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
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
