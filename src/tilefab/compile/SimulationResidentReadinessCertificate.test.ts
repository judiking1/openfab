import { describe, expect, it } from "vitest";
import {
	SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationResidentReadinessWorkerRequest,
} from "../worker/SimulationResidentReadinessWorkerProtocol";
import { certifySimulationResidentReadinessWorkerRequest } from "../worker/SimulationResidentReadinessWorkerRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { simulationReadinessCertificateError } from "./SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts } from "./SimulationReadinessTestFixture";
import {
	checksumSimulationResidentCycleResourceRunConfiguration,
	simulationResidentCycleResourceRunConfigurationError,
} from "./SimulationResidentCycleResourceRunConfiguration";
import {
	checksumSimulationResidentReadinessCertificate,
	isPublishedSimulationResidentReadinessSnapshot,
	publishSimulationResidentReadinessSnapshot,
	SIMULATION_RESIDENT_READINESS_CERTIFICATION_MODE,
	SIMULATION_RESIDENT_READINESS_LIMITATIONS,
	SIMULATION_RESIDENT_READINESS_PROFILE_ID,
	simulationResidentReadinessCertificateError,
	simulationResidentReadinessCertificateMatchesSources,
	simulationResidentReadinessSourcesError,
} from "./SimulationResidentReadinessCertificate";
import {
	buildSimulationResidentReadinessTestSources,
	residentReadinessTestRecord,
} from "./SimulationResidentReadinessTestFixture";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";

describe("SimulationResidentReadinessCertificate", () => {
	it("publishes one exact resident-only profile after reconstructing the complete source chain", async () => {
		const sources = await buildSimulationResidentReadinessTestSources();
		const published = await publishSimulationResidentReadinessSnapshot(sources);
		const expectedByteLength =
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
			sources.resourceRunConfiguration.byteLength;

		expect(published.certificate).toMatchObject({
			simulationReady: true,
			readinessProfileId: SIMULATION_RESIDENT_READINESS_PROFILE_ID,
			certificationMode: SIMULATION_RESIDENT_READINESS_CERTIFICATION_MODE,
			limitations: SIMULATION_RESIDENT_READINESS_LIMITATIONS,
			vehicleCount: 1,
			requestCount: 1,
			loadCount: 1,
			eqResourceCount: 1,
			storageResourceCount: 1,
			snapshotByteLength: expectedByteLength,
		});
		expect(simulationResidentReadinessCertificateError(published.certificate)).toBeNull();
		expect(simulationReadinessCertificateError(published.certificate)).not.toBeNull();
		expect(await isPublishedSimulationResidentReadinessSnapshot(published)).toBe(true);
		expect(Object.isFrozen(published.certificate)).toBe(true);
	});

	it("rejects hidden fields, detached certificates, and semantically forged resource rows", async () => {
		const sources = await buildSimulationResidentReadinessTestSources();
		const published = await publishSimulationResidentReadinessSnapshot(sources);

		expect(
			simulationResidentReadinessCertificateError({
				...published.certificate,
				dynamicDispatchApproved: true,
			}),
		).toMatch(/unexpected fields/i);
		const certificateFields = withoutFingerprint(published.certificate);
		const detachedFields = {
			...certificateFields,
			sourceRevision: certificateFields.sourceRevision + 1,
		};
		const detached = {
			...detachedFields,
			fingerprint: checksumSimulationResidentReadinessCertificate(detachedFields),
		};
		expect(simulationResidentReadinessCertificateError(detached)).toBeNull();
		expect(simulationResidentReadinessCertificateMatchesSources(detached, sources)).toBe(false);

		const forgedFields = {
			...sources.resourceRunConfiguration,
			storageCapacityUnits: sources.resourceRunConfiguration.storageCapacityUnits.slice(),
			fingerprint: "pending",
		};
		forgedFields.storageCapacityUnits[0] = (forgedFields.storageCapacityUnits[0] as number) + 1;
		const forgedConfiguration = {
			...forgedFields,
			fingerprint: checksumSimulationResidentCycleResourceRunConfiguration(forgedFields),
		};
		expect(simulationResidentCycleResourceRunConfigurationError(forgedConfiguration)).toBeNull();
		expect(
			simulationResidentReadinessSourcesError({
				...sources,
				resourceRunConfiguration: forgedConfiguration,
			}),
		).toMatch(/resource rows do not match/i);
	});

	it("certifies an owned transferred copy and returns metadata authority without source buffers", async () => {
		const canonical = await buildSimulationResidentReadinessTestSources();
		const canonicalByteLength = canonical.foundation.paths.positions.byteLength;
		const owned = structuredClone(canonical);
		const request: SimulationResidentReadinessWorkerRequest = {
			type: "CERTIFY_SIMULATION_RESIDENT_READINESS",
			protocolVersion: SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
			requestId: 17,
			generation: 8,
			sources: owned,
		};
		const transfers = collectTransferableBuffers(owned);
		const transferred = structuredClone(request, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		const response = await certifySimulationResidentReadinessWorkerRequest(transferred);
		expect(response).toMatchObject({
			type: "SIMULATION_RESIDENT_READINESS_CERTIFIED",
			requestId: 17,
			generation: 8,
		});
		if (response.type !== "SIMULATION_RESIDENT_READINESS_CERTIFIED") {
			throw new Error("Expected resident readiness certification.");
		}
		expect(Object.keys(response).sort()).toEqual(
			["certificate", "generation", "protocolVersion", "requestId", "type"].sort(),
		);
		expect(
			simulationResidentReadinessCertificateMatchesSources(response.certificate, canonical),
		).toBe(true);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalByteLength);

		const hiddenEnvelope = await certifySimulationResidentReadinessWorkerRequest({
			...request,
			sources: canonical,
			bypassExactReconstruction: true,
		});
		expect(hiddenEnvelope).toMatchObject({
			type: "SIMULATION_RESIDENT_READINESS_REJECTED",
			code: "MALFORMED_REQUEST",
		});
	});

	it("rejects retained source mutation while asynchronous exact reconstruction is in flight", async () => {
		const sources = await buildSimulationResidentReadinessTestSources();
		const pending = publishSimulationResidentReadinessSnapshot(sources);
		sources.resourceRunConfiguration.eqConcurrentCapacities[0] = 99;

		await expect(pending).rejects.toThrow(/changed during certification|sources are invalid/i);
	});

	it("reconstructs and certifies the exact 100,000-request boundary", async () => {
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
		const published = await publishSimulationResidentReadinessSnapshot(sources);

		expect(published.certificate).toMatchObject({
			requestCount,
			loadCount: requestCount,
			vehicleCount: 1,
			eqResourceCount: 1,
			storageResourceCount: 0,
		});
		expect(simulationResidentReadinessCertificateError(published.certificate)).toBeNull();
	}, 120_000);
});

function withoutFingerprint<T extends { readonly fingerprint: string }>(
	value: T,
): Omit<T, "fingerprint"> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "fingerprint")) as Omit<
		T,
		"fingerprint"
	>;
}
