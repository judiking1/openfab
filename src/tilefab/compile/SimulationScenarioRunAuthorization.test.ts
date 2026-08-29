import { describe, expect, it } from "vitest";
import {
	publishSimulationReadinessSnapshot,
	SIMULATION_READINESS_LIMITATIONS,
} from "./SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "./SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "./SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "./SimulationScenarioLeaseClaims";
import { compileSimulationTransferPlanManifest } from "./SimulationScenarioManifest";
import { validateSimulationScenarioPreparedArtifactChainSources } from "./SimulationScenarioPreparedArtifacts";
import {
	checksumSimulationScenarioResourceRunConfigurationInput,
	compileSimulationScenarioResourceRunConfiguration,
} from "./SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "./SimulationScenarioRouteRequests";
import {
	compileSimulationScenarioRunAuthorization,
	compileSimulationScenarioRunAuthorizationFromValidatedPreparedSources,
	simulationScenarioRunAuthorizationError,
	simulationScenarioRunAuthorizationMatchesSources,
} from "./SimulationScenarioRunAuthorization";
import {
	checksumSimulationScenarioServiceTimingInput,
	compileSimulationScenarioServiceTiming,
} from "./SimulationScenarioServiceTiming";

describe("SimulationScenarioRunAuthorization", () => {
	it("authorizes only the exact limited prepared bundle as a one-shot controller capability", async () => {
		const input = await authorizationInput();
		const authorization = compileSimulationScenarioRunAuthorization(input);

		expect(simulationScenarioRunAuthorizationError(authorization)).toBeNull();
		expect(simulationScenarioRunAuthorizationMatchesSources(authorization, input)).toBe(true);
		expect(authorization).toMatchObject({
			simulationRunnable: true,
			missingRuntimeLayers: [],
			authorizationPolicy: "EXPLICIT_CURRENT_PREPARED_BUNDLE_V1",
			consumptionPolicy: "CONTROLLER_OWNED_ONE_SHOT_V1",
			projectId: "PROJECT-AUTH-1",
			preparationGeneration: 3,
			authorizationGeneration: 7,
			sourceKind: "TRANSFER_PLAN",
			requestCount: 1,
			loadCount: 1,
			eqResourceCount: 1,
		});
		expect(authorization.limitations).toEqual(SIMULATION_READINESS_LIMITATIONS);
		expect(Object.isFrozen(authorization)).toBe(true);
	});

	it("rejects a foreign certificate or prepared-input fingerprint", async () => {
		const input = await authorizationInput();
		const authorization = compileSimulationScenarioRunAuthorization(input);
		const foreignSnapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(40),
		);

		expect(() =>
			compileSimulationScenarioRunAuthorization({ ...input, snapshot: foreignSnapshot }),
		).toThrow(/exact prepared bundle|sources/i);
		expect(
			simulationScenarioRunAuthorizationMatchesSources(authorization, {
				...input,
				serviceTimingInputFingerprint: "foreign-timing-input",
			}),
		).toBe(false);
	});

	it("binds project, preparation, authorization, and run-asset generations into identity", async () => {
		const input = await authorizationInput();
		const first = compileSimulationScenarioRunAuthorization(input);
		const nextPreparation = compileSimulationScenarioRunAuthorization({
			...input,
			preparationGeneration: input.preparationGeneration + 1,
		});
		const nextAuthorization = compileSimulationScenarioRunAuthorization({
			...input,
			authorizationGeneration: input.authorizationGeneration + 1,
		});
		const nextRunAsset = compileSimulationScenarioRunAuthorization({
			...input,
			runAssetFingerprint: "run-asset-next",
		});

		expect(
			new Set([
				first.fingerprint,
				nextPreparation.fingerprint,
				nextAuthorization.fingerprint,
				nextRunAsset.fingerprint,
			]).size,
		).toBe(4);
		expect(
			simulationScenarioRunAuthorizationError({
				...first,
				projectId: "FOREIGN-PROJECT",
			}),
		).toMatch(/fingerprint/i);
	});

	it("consumes an exact prepared-source validation proof once and fails closed on reuse", async () => {
		const input = await authorizationInput();
		const validation = validateSimulationScenarioPreparedArtifactChainSources(
			input.snapshot,
			input.manifest,
			serviceTimingInput(),
			resourceRunInput(),
			input.prepared,
		);
		expect(validation).not.toBeNull();
		if (!validation) throw new Error("Expected exact prepared-source validation.");
		const authorization = compileSimulationScenarioRunAuthorizationFromValidatedPreparedSources(
			input,
			validation,
		);
		expect(authorization.requestCount).toBe(1);
		expect(() =>
			compileSimulationScenarioRunAuthorizationFromValidatedPreparedSources(input, validation),
		).toThrow(/stale|mismatched/i);
	});
});

async function authorizationInput() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	);
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "PLAN-AUTH-1",
		mappingVersion: 1,
		adapterId: "AUTHORIZATION_TEST",
		adapterVersion: 1,
		inputRecordCount: 1,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records: [
			{
				sourceOrdinal: 0,
				transferId: "TRANSFER-1",
				releaseTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	});
	const timingInput = serviceTimingInput();
	const resourcesInput = resourceRunInput();
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const leaseClaims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const admissionProgram = compileSimulationScenarioAdmissionProgram(
		snapshot,
		manifest,
		routes,
		leaseClaims,
	);
	const serviceTiming = compileSimulationScenarioServiceTiming(
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		timingInput,
	);
	const resourceRunConfiguration = compileSimulationScenarioResourceRunConfiguration(
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourcesInput,
	);
	return {
		projectId: "PROJECT-AUTH-1",
		preparationGeneration: 3,
		authorizationGeneration: 7,
		runAssetFingerprint: "run-asset-auth-1",
		serviceTimingInputFingerprint: checksumSimulationScenarioServiceTimingInput(
			manifest,
			timingInput,
		),
		resourceRunInputFingerprint: checksumSimulationScenarioResourceRunConfigurationInput(
			manifest,
			resourcesInput,
		),
		snapshot,
		manifest,
		prepared: Object.freeze({
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			resourceRunConfiguration,
		}),
	};
}

function serviceTimingInput() {
	return {
		eqProcessTimings: [
			{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 1_000_000 },
		],
	};
}

function resourceRunInput() {
	return {
		eqResources: [
			{
				equipmentGroupId: 1,
				concurrentCapacity: 1,
				availabilityMode: "ALWAYS" as const,
				availabilityWindows: [],
			},
		],
		initialStorageLoads: [],
	};
}
