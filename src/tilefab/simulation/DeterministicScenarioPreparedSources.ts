import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import {
	type SimulationScenarioAdmissionProgram,
	simulationScenarioAdmissionProgramMatchesSources,
} from "../compile/SimulationScenarioAdmissionProgram";
import type { SimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import type { SimulationScenarioManifest } from "../compile/SimulationScenarioManifest";
import {
	consumeSimulationScenarioPreparedArtifactChainValidation,
	type SimulationScenarioPreparedArtifactChainValidation,
} from "../compile/SimulationScenarioPreparedArtifacts";
import {
	type SimulationScenarioResourceRunConfiguration,
	simulationScenarioResourceRunConfigurationMatchesPreparedSources,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import type { SimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import {
	type SimulationScenarioServiceTiming,
	simulationScenarioServiceTimingMatchesPreparedSources,
} from "../compile/SimulationScenarioServiceTiming";

const DETERMINISTIC_SCENARIO_PREPARED_SOURCES = Symbol("DETERMINISTIC_SCENARIO_PREPARED_SOURCES");

/**
 * Opaque proof for immediate, synchronous construction of one scheduler and its internal states.
 * The public state constructors still validate independently when this proof is absent.
 */
export interface DeterministicScenarioPreparedSources {
	readonly [DETERMINISTIC_SCENARIO_PREPARED_SOURCES]: true;
	readonly snapshot: PublishedSimulationReadinessSnapshot;
	readonly manifest: SimulationScenarioManifest;
	readonly routes: SimulationScenarioRouteRequests;
	readonly leaseClaims: SimulationScenarioLeaseClaims;
	readonly admissionProgram: SimulationScenarioAdmissionProgram;
	readonly serviceTiming: SimulationScenarioServiceTiming | undefined;
	readonly resourceRunConfiguration: SimulationScenarioResourceRunConfiguration | undefined;
}

export function validateDeterministicScenarioPreparedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming?: SimulationScenarioServiceTiming,
	resourceRunConfiguration?: SimulationScenarioResourceRunConfiguration,
): DeterministicScenarioPreparedSources {
	if (resourceRunConfiguration && !serviceTiming) {
		throw new Error("Scenario resource execution requires prepared service timing.");
	}
	if (resourceRunConfiguration && serviceTiming) {
		if (
			!simulationScenarioResourceRunConfigurationMatchesPreparedSources(
				snapshot,
				manifest,
				routes,
				leaseClaims,
				admissionProgram,
				serviceTiming,
				resourceRunConfiguration,
			)
		) {
			throw new Error(
				"Scenario resource configuration does not match the motion scheduler sources.",
			);
		}
	} else if (serviceTiming) {
		if (
			!simulationScenarioServiceTimingMatchesPreparedSources(
				snapshot,
				manifest,
				routes,
				leaseClaims,
				admissionProgram,
				serviceTiming,
			)
		) {
			throw new Error("Scenario service timing does not match the motion scheduler sources.");
		}
	} else if (
		!simulationScenarioAdmissionProgramMatchesSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
		)
	) {
		throw new Error("Scenario admission program does not match the motion scheduler sources.");
	}

	return Object.freeze({
		[DETERMINISTIC_SCENARIO_PREPARED_SOURCES]: true as const,
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration,
	});
}

/**
 * Consumes the Controller's exact one-use proof for immediate scheduler construction. Direct
 * scheduler construction continues through the independent validator above.
 */
export function adoptDeterministicScenarioPreparedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	validation: SimulationScenarioPreparedArtifactChainValidation,
): DeterministicScenarioPreparedSources {
	const prepared = validation.prepared;
	if (
		!consumeSimulationScenarioPreparedArtifactChainValidation(
			validation,
			snapshot,
			manifest,
			validation.serviceTimingInputFingerprint,
			validation.resourceRunInputFingerprint,
			prepared,
		)
	) {
		throw new Error("Scenario prepared-source adoption proof is stale or mismatched.");
	}
	return Object.freeze({
		[DETERMINISTIC_SCENARIO_PREPARED_SOURCES]: true as const,
		snapshot,
		manifest,
		routes: prepared.routes,
		leaseClaims: prepared.leaseClaims,
		admissionProgram: prepared.admissionProgram,
		serviceTiming: prepared.serviceTiming,
		resourceRunConfiguration: prepared.resourceRunConfiguration,
	});
}

export function deterministicScenarioPreparedSourcesMatch(
	prepared: DeterministicScenarioPreparedSources,
	expected: Readonly<{
		snapshot: PublishedSimulationReadinessSnapshot;
		manifest?: SimulationScenarioManifest;
		routes: SimulationScenarioRouteRequests;
		leaseClaims?: SimulationScenarioLeaseClaims;
		admissionProgram: SimulationScenarioAdmissionProgram;
		serviceTiming?: SimulationScenarioServiceTiming;
		resourceRunConfiguration?: SimulationScenarioResourceRunConfiguration;
	}>,
): boolean {
	return (
		prepared[DETERMINISTIC_SCENARIO_PREPARED_SOURCES] === true &&
		prepared.snapshot === expected.snapshot &&
		(expected.manifest === undefined || prepared.manifest === expected.manifest) &&
		prepared.routes === expected.routes &&
		(expected.leaseClaims === undefined || prepared.leaseClaims === expected.leaseClaims) &&
		prepared.admissionProgram === expected.admissionProgram &&
		(expected.serviceTiming === undefined || prepared.serviceTiming === expected.serviceTiming) &&
		(expected.resourceRunConfiguration === undefined ||
			prepared.resourceRunConfiguration === expected.resourceRunConfiguration)
	);
}
