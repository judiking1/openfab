import { describe, expect, it } from "vitest";
import { buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts } from "./SimulationReadinessTestFixture";
import { publishSimulationResidentReadinessSnapshot } from "./SimulationResidentReadinessCertificate";
import {
	buildSimulationResidentReadinessTestSources,
	residentReadinessTestRecord,
} from "./SimulationResidentReadinessTestFixture";
import {
	consumeSimulationResidentRunAuthorization,
	discardSimulationResidentRunAuthorizationGrant,
	type IssueSimulationResidentRunAuthorizationInput,
	issueSimulationResidentRunAuthorization,
	SIMULATION_RESIDENT_RUN_AUTHORIZATION_CONSUMPTION_POLICY,
	SIMULATION_RESIDENT_RUN_AUTHORIZATION_POLICY,
	type SimulationResidentRunAuthorizationGrant,
	simulationResidentRunAuthorizationError,
} from "./SimulationResidentRunAuthorization";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";
import { simulationScenarioRunAuthorizationError } from "./SimulationScenarioRunAuthorization";

describe("SimulationResidentRunAuthorization", () => {
	it("issues and synchronously consumes one exact realm-local resident authority", async () => {
		const input = await authorizationInput();
		const grant = await issueSimulationResidentRunAuthorization(input);

		expect(grant.authorization).toMatchObject({
			simulationRunnable: true,
			missingRuntimeLayers: [],
			authorizationPolicy: SIMULATION_RESIDENT_RUN_AUTHORIZATION_POLICY,
			consumptionPolicy: SIMULATION_RESIDENT_RUN_AUTHORIZATION_CONSUMPTION_POLICY,
			projectId: "PROJECT-RESIDENT-AUTH-1",
			preparationGeneration: 3,
			authorizationGeneration: 7,
			sourceKind: "TRANSFER_PLAN",
			requestCount: 1,
			loadCount: 1,
			vehicleCount: 1,
			eqResourceCount: 1,
			storageResourceCount: 1,
		});
		expect(simulationResidentRunAuthorizationError(grant.authorization)).toBeNull();
		expect(simulationScenarioRunAuthorizationError(grant.authorization)).not.toBeNull();
		expect(Object.isFrozen(grant.authorization)).toBe(true);
		expect(Object.isFrozen(grant.capability)).toBe(true);

		const adopted = await consumeSimulationResidentRunAuthorization(
			grant,
			input,
			(authorization, snapshot) => ({
				fingerprint: authorization.fingerprint,
				snapshot,
			}),
		);
		expect(adopted?.fingerprint).toBe(grant.authorization.fingerprint);
		expect(adopted?.snapshot).toBe(input.snapshot);
		expect(
			await consumeSimulationResidentRunAuthorization(grant, input, () => "reused"),
		).toBeNull();
	});

	it("binds project, generations, and reviewed run-asset identity", async () => {
		const input = await authorizationInput();
		const grants = await Promise.all([
			issueSimulationResidentRunAuthorization(input),
			issueSimulationResidentRunAuthorization({
				...input,
				preparationGeneration: input.preparationGeneration + 1,
			}),
			issueSimulationResidentRunAuthorization({
				...input,
				authorizationGeneration: input.authorizationGeneration + 1,
			}),
			issueSimulationResidentRunAuthorization({
				...input,
				runAssetFingerprint: "resident-run-asset-next",
			}),
		]);

		expect(new Set(grants.map((grant) => grant.authorization.fingerprint)).size).toBe(4);
		for (const grant of grants) discardSimulationResidentRunAuthorizationGrant(grant);
	});

	it("consumes stale authority fail-closed and detects retained typed-buffer mutation", async () => {
		const input = await authorizationInput();
		const staleGrant = await issueSimulationResidentRunAuthorization(input);
		expect(
			await consumeSimulationResidentRunAuthorization(
				staleGrant,
				{ ...input, projectId: "PROJECT-RESIDENT-FOREIGN" },
				() => "adopted",
			),
		).toBeNull();
		expect(
			await consumeSimulationResidentRunAuthorization(staleGrant, input, () => "reused"),
		).toBeNull();

		const mutatedInput = await authorizationInput();
		const mutatedGrant = await issueSimulationResidentRunAuthorization(mutatedInput);
		mutatedInput.snapshot.resourceRunConfiguration.eqConcurrentCapacities[0] = 99;
		expect(
			await consumeSimulationResidentRunAuthorization(mutatedGrant, mutatedInput, () => "adopted"),
		).toBeNull();
	});

	it("rejects hidden input/metadata, copied capabilities, and asynchronous adoption", async () => {
		const input = await authorizationInput();
		await expect(
			issueSimulationResidentRunAuthorization({
				...input,
				implicitDispatch: true,
			} as never),
		).rejects.toThrow(/unexpected fields/i);

		const grant = await issueSimulationResidentRunAuthorization(input);
		expect(
			simulationResidentRunAuthorizationError({
				...grant.authorization,
				sharedParkingApproved: true,
			}),
		).toMatch(/unexpected fields/i);
		const copied = structuredClone(grant) as SimulationResidentRunAuthorizationGrant;
		expect(
			await consumeSimulationResidentRunAuthorization(copied, input, () => "copied"),
		).toBeNull();
		expect(await consumeSimulationResidentRunAuthorization(grant, input, () => "original")).toBe(
			"original",
		);

		const asyncGrant = await issueSimulationResidentRunAuthorization(input);
		await expect(
			consumeSimulationResidentRunAuthorization(asyncGrant, input, async () => "async"),
		).rejects.toThrow(/must complete synchronously/i);
		expect(
			await consumeSimulationResidentRunAuthorization(asyncGrant, input, () => "reused"),
		).toBeNull();
	});

	it("issues and consumes the exact 100,000-request resident boundary", async () => {
		const requestCount = SIMULATION_SCENARIO_MAX_INPUT_RECORDS;
		const sources = await buildSimulationResidentReadinessTestSources({
			components: buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8),
			homePortId: 1,
			records: Array.from({ length: requestCount }, (_, row) =>
				residentReadinessTestRecord(row, `LOAD-${row}`, 2, 4),
			),
			timingInput: {
				eqProcessTimings: Array.from({ length: requestCount }, (_, sourceOrdinal) => ({
					sourceOrdinal,
					capabilityId: 1,
					processingDurationMicroseconds: 1,
				})),
			},
			resourceInput: {
				eqResources: [
					{
						equipmentGroupId: 1,
						concurrentCapacity: 100,
						availabilityMode: "ALWAYS",
						availabilityWindows: [],
					},
				],
				initialStorageLoads: [],
			},
		});
		const snapshot = await publishSimulationResidentReadinessSnapshot(sources);
		const input = residentAuthorizationInput(snapshot);
		const grant = await issueSimulationResidentRunAuthorization(input);
		const adoptedRequestCount = await consumeSimulationResidentRunAuthorization(
			grant,
			input,
			(authorization) => authorization.requestCount,
		);

		expect(adoptedRequestCount).toBe(requestCount);
	}, 120_000);
});

async function authorizationInput(): Promise<IssueSimulationResidentRunAuthorizationInput> {
	const sources = await buildSimulationResidentReadinessTestSources();
	return residentAuthorizationInput(await publishSimulationResidentReadinessSnapshot(sources));
}

function residentAuthorizationInput(
	snapshot: Awaited<ReturnType<typeof publishSimulationResidentReadinessSnapshot>>,
): IssueSimulationResidentRunAuthorizationInput {
	return {
		projectId: "PROJECT-RESIDENT-AUTH-1",
		preparationGeneration: 3,
		authorizationGeneration: 7,
		runAssetFingerprint: "resident-run-asset-1",
		snapshot,
	};
}
