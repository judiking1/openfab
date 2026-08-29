import type { PublishedSimulationReadinessSnapshot } from "./SimulationReadinessCertificate";
import type { SimulationScenarioAdmissionProgram } from "./SimulationScenarioAdmissionProgram";
import type { SimulationScenarioLeaseClaims } from "./SimulationScenarioLeaseClaims";
import type { SimulationScenarioManifest } from "./SimulationScenarioManifest";
import {
	checksumSimulationScenarioResourceRunConfigurationInput,
	type SimulationScenarioResourceRunConfiguration,
	type SimulationScenarioResourceRunConfigurationInput,
	simulationScenarioResourceRunConfigurationMatchesPreparedSources,
	simulationScenarioResourceRunConfigurationMatchesSources,
} from "./SimulationScenarioResourceRunConfiguration";
import type { SimulationScenarioRouteRequests } from "./SimulationScenarioRouteRequests";
import {
	checksumSimulationScenarioServiceTimingInput,
	type SimulationScenarioServiceTiming,
	type SimulationScenarioServiceTimingInput,
} from "./SimulationScenarioServiceTiming";

export interface SimulationScenarioPreparedArtifactChain {
	readonly routes: SimulationScenarioRouteRequests;
	readonly leaseClaims: SimulationScenarioLeaseClaims;
	readonly admissionProgram: SimulationScenarioAdmissionProgram;
	readonly serviceTiming: SimulationScenarioServiceTiming;
	readonly resourceRunConfiguration: SimulationScenarioResourceRunConfiguration;
}

const PREPARED_ARTIFACT_VALIDATION_BRAND: unique symbol = Symbol(
	"OpenFabSimulationScenarioPreparedArtifactValidation",
);
const livePreparedArtifactValidations =
	new WeakSet<SimulationScenarioPreparedArtifactChainValidation>();

/** Opaque, one-use proof that one retained complete chain matched exact raw run inputs. */
export interface SimulationScenarioPreparedArtifactChainValidation {
	readonly [PREPARED_ARTIFACT_VALIDATION_BRAND]: true;
	readonly snapshot: PublishedSimulationReadinessSnapshot;
	readonly manifest: SimulationScenarioManifest;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
	readonly prepared: SimulationScenarioPreparedArtifactChain;
}

/**
 * Validates an already-input-bound complete chain without retaining its raw run inputs. The final
 * resource artifact validator covers every upstream artifact and their exact source bindings.
 */
export function simulationScenarioPreparedArtifactChainMatchesPreparedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	prepared: SimulationScenarioPreparedArtifactChain,
): boolean {
	return simulationScenarioResourceRunConfigurationMatchesPreparedSources(
		snapshot,
		manifest,
		prepared.routes,
		prepared.leaseClaims,
		prepared.admissionProgram,
		prepared.serviceTiming,
		prepared.resourceRunConfiguration,
	);
}

/**
 * Validates one transferred complete chain exactly once at an adoption boundary.
 * Resource matching covers every upstream artifact; timing input remains an independent run input.
 */
export function simulationScenarioPreparedArtifactChainMatchesSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInput: SimulationScenarioServiceTimingInput,
	resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	prepared: SimulationScenarioPreparedArtifactChain,
): boolean {
	const validation = validateSimulationScenarioPreparedArtifactChainSources(
		snapshot,
		manifest,
		serviceTimingInput,
		resourceRunInput,
		prepared,
	);
	if (!validation) return false;
	discardSimulationScenarioPreparedArtifactChainValidation(validation);
	return true;
}

/**
 * Performs the expensive exact-source check and returns a realm-local proof. The proof retains no
 * raw run input and must be consumed synchronously by one downstream adoption boundary.
 */
export function validateSimulationScenarioPreparedArtifactChainSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInput: SimulationScenarioServiceTimingInput,
	resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	prepared: SimulationScenarioPreparedArtifactChain,
): SimulationScenarioPreparedArtifactChainValidation | null {
	const inputFingerprints = preparedArtifactInputFingerprints(
		manifest,
		serviceTimingInput,
		resourceRunInput,
	);
	if (!inputFingerprints) return null;
	const { timingInputFingerprint, resourceInputFingerprint } = inputFingerprints;
	if (
		prepared.serviceTiming.sourceTimingInputFingerprint === timingInputFingerprint &&
		prepared.resourceRunConfiguration.sourceResourceInputFingerprint === resourceInputFingerprint &&
		simulationScenarioResourceRunConfigurationMatchesSources(
			snapshot,
			manifest,
			prepared.routes,
			prepared.leaseClaims,
			prepared.admissionProgram,
			prepared.serviceTiming,
			resourceRunInput,
			prepared.resourceRunConfiguration,
		)
	) {
		return issueSimulationScenarioPreparedArtifactChainValidation(
			snapshot,
			manifest,
			timingInputFingerprint,
			resourceInputFingerprint,
			prepared,
		);
	}
	return null;
}

/**
 * Revalidates an adopted, frozen outer bundle. Initial adoption already proved exact raw-input
 * derivation; this pass detects changed inputs or mutable typed-buffer bytes without rebuilding the
 * expected resource configuration.
 */
export function validateRetainedSimulationScenarioPreparedArtifactChainSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInput: SimulationScenarioServiceTimingInput,
	resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	prepared: SimulationScenarioPreparedArtifactChain,
): SimulationScenarioPreparedArtifactChainValidation | null {
	if (!Object.isFrozen(prepared)) return null;
	const inputFingerprints = preparedArtifactInputFingerprints(
		manifest,
		serviceTimingInput,
		resourceRunInput,
	);
	if (!inputFingerprints) return null;
	const { timingInputFingerprint, resourceInputFingerprint } = inputFingerprints;
	if (
		prepared.serviceTiming.sourceTimingInputFingerprint !== timingInputFingerprint ||
		prepared.resourceRunConfiguration.sourceResourceInputFingerprint !== resourceInputFingerprint ||
		!simulationScenarioPreparedArtifactChainMatchesPreparedSources(snapshot, manifest, prepared)
	) {
		return null;
	}
	return issueSimulationScenarioPreparedArtifactChainValidation(
		snapshot,
		manifest,
		timingInputFingerprint,
		resourceInputFingerprint,
		prepared,
	);
}

/** Consumes one exact validation proof; stale, forged, reused, or cross-source proofs fail closed. */
export function consumeSimulationScenarioPreparedArtifactChainValidation(
	validation: SimulationScenarioPreparedArtifactChainValidation,
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInputFingerprint: string,
	resourceRunInputFingerprint: string,
	prepared: SimulationScenarioPreparedArtifactChain,
): boolean {
	return takeSimulationScenarioPreparedArtifactChainValidation(
		validation,
		snapshot,
		manifest,
		serviceTimingInputFingerprint,
		resourceRunInputFingerprint,
		prepared,
	);
}

/**
 * Atomically consumes one proof and issues its one-use successor for an immediate synchronous
 * boundary. The source chain is not exposed or changed between the two steps.
 */
export function advanceSimulationScenarioPreparedArtifactChainValidation(
	validation: SimulationScenarioPreparedArtifactChainValidation,
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInputFingerprint: string,
	resourceRunInputFingerprint: string,
	prepared: SimulationScenarioPreparedArtifactChain,
): SimulationScenarioPreparedArtifactChainValidation | null {
	if (
		!takeSimulationScenarioPreparedArtifactChainValidation(
			validation,
			snapshot,
			manifest,
			serviceTimingInputFingerprint,
			resourceRunInputFingerprint,
			prepared,
		)
	) {
		return null;
	}
	return issueSimulationScenarioPreparedArtifactChainValidation(
		snapshot,
		manifest,
		serviceTimingInputFingerprint,
		resourceRunInputFingerprint,
		prepared,
	);
}

/** Revokes an unconsumed proof when its immediate synchronous adoption scope exits. */
export function discardSimulationScenarioPreparedArtifactChainValidation(
	validation: SimulationScenarioPreparedArtifactChainValidation,
): void {
	livePreparedArtifactValidations.delete(validation);
}

function issueSimulationScenarioPreparedArtifactChainValidation(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInputFingerprint: string,
	resourceRunInputFingerprint: string,
	prepared: SimulationScenarioPreparedArtifactChain,
): SimulationScenarioPreparedArtifactChainValidation {
	const validation = Object.freeze({
		[PREPARED_ARTIFACT_VALIDATION_BRAND]: true as const,
		snapshot,
		manifest,
		serviceTimingInputFingerprint,
		resourceRunInputFingerprint,
		prepared,
	});
	livePreparedArtifactValidations.add(validation);
	return validation;
}

function takeSimulationScenarioPreparedArtifactChainValidation(
	validation: SimulationScenarioPreparedArtifactChainValidation,
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInputFingerprint: string,
	resourceRunInputFingerprint: string,
	prepared: SimulationScenarioPreparedArtifactChain,
): boolean {
	if (!livePreparedArtifactValidations.delete(validation)) return false;
	return (
		validation.snapshot === snapshot &&
		validation.manifest === manifest &&
		validation.serviceTimingInputFingerprint === serviceTimingInputFingerprint &&
		validation.resourceRunInputFingerprint === resourceRunInputFingerprint &&
		validation.prepared === prepared
	);
}

function preparedArtifactInputFingerprints(
	manifest: SimulationScenarioManifest,
	serviceTimingInput: SimulationScenarioServiceTimingInput,
	resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
): Readonly<{
	timingInputFingerprint: string;
	resourceInputFingerprint: string;
}> | null {
	try {
		return {
			timingInputFingerprint: checksumSimulationScenarioServiceTimingInput(
				manifest,
				serviceTimingInput,
			),
			resourceInputFingerprint: checksumSimulationScenarioResourceRunConfigurationInput(
				manifest,
				resourceRunInput,
			),
		};
	} catch {
		return null;
	}
}
