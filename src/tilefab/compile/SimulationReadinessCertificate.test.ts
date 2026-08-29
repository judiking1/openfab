import { describe, expect, it } from "vitest";
import {
	SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationReadinessWorkerRequest,
} from "../worker/SimulationReadinessWorkerProtocol";
import {
	certifySimulationReadinessWorkerRequest,
	collectSimulationReadinessWorkerResponseTransferBuffers,
} from "../worker/SimulationReadinessWorkerRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	checksumSimulationReadinessCertificate,
	compileSimulationReadinessCertificate,
	isPublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
	publishSimulationReadinessSnapshot,
	SIMULATION_ACTIVE_RUN_EDIT_POLICY,
	SIMULATION_READINESS_CERTIFICATION_MODE,
	SIMULATION_READINESS_LIMITATIONS,
	SIMULATION_READINESS_PROFILE_ID,
	simulationReadinessCertificateError,
	simulationReadinessComponentsError,
} from "./SimulationReadinessCertificate";
import {
	buildSimulationReadinessLongBay,
	buildSimulationReadinessTestComponents,
	buildSimulationReadinessTestFoundation,
} from "./SimulationReadinessTestFixture";
import { compileSimulationStaticWorldFoundation } from "./SimulationStaticWorldFoundation";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

describe("SimulationReadinessCertificate", () => {
	it("binds every exact component and exposes only the conservative token profile", () => {
		const components = buildSimulationReadinessTestComponents();
		const certificate = compileSimulationReadinessCertificate(components);
		const published = publishSimulationReadinessSnapshot(components);

		expect(certificate).toMatchObject({
			simulationReady: true,
			missingLayers: [],
			readinessProfileId: SIMULATION_READINESS_PROFILE_ID,
			certificationMode: SIMULATION_READINESS_CERTIFICATION_MODE,
			activeRunEditPolicy: SIMULATION_ACTIVE_RUN_EDIT_POLICY,
			limitations: SIMULATION_READINESS_LIMITATIONS,
			foundationFingerprint: components.foundation.fingerprint,
			trackResourceFingerprint: components.trackResources.fingerprint,
			stationCapabilitiesFingerprint: components.stationCapabilities.fingerprint,
			equipmentResourcesFingerprint: components.equipmentResources.fingerprint,
			occupancyPolicyFingerprint: components.occupancyPolicy.fingerprint,
			pathCount: components.foundation.paths.pathCount,
			trackResourceCount: components.trackResources.trackResourceCount,
			stationCount: 0,
			equipmentGroupCount: 0,
		});
		expect(certificate.snapshotByteLength).toBe(
			components.foundation.byteLength +
				components.trackResources.byteLength +
				components.stationCapabilities.byteLength +
				components.equipmentResources.byteLength +
				components.occupancyPolicy.byteLength,
		);
		expect(checksumSimulationReadinessCertificate(certificate)).toBe(certificate.fingerprint);
		expect(simulationReadinessCertificateError(certificate)).toBeNull();
		expect(published.certificate.fingerprint).toBe(certificate.fingerprint);
		expect(isPublishedSimulationReadinessSnapshot(published)).toBe(true);
	});

	it("rejects individually valid artifacts from different authored generations", () => {
		const first = buildSimulationReadinessTestComponents();
		const second = buildSimulationReadinessTestComponents(
			buildSimulationReadinessTestFoundation(buildSimulationReadinessLongBay(40)),
		);
		const mixed = { ...first, trackResources: second.trackResources };

		expect(simulationReadinessComponentsError(mixed)).toMatch(/foundation fingerprints/i);
		expect(() => compileSimulationReadinessCertificate(mixed)).toThrow(/foundation fingerprints/i);
		const wrongCertificate = {
			...second,
			certificate: compileSimulationReadinessCertificate(first),
		};
		expect(publishedSimulationReadinessSnapshotError(wrongCertificate)).toMatch(
			/does not match its components/i,
		);
	});

	it("detects certificate mutation independently of its component fingerprints", () => {
		const certificate = compileSimulationReadinessCertificate(
			buildSimulationReadinessTestComponents(),
		);
		const mutated = { ...certificate, sourceRevision: certificate.sourceRevision + 1 };

		expect(simulationReadinessCertificateError(mutated)).toMatch(/fingerprint/i);
		expect(certificate.simulationReady).toBe(true);
	});

	it("one-shot Worker runtime publishes an attached transferable snapshot with exact correlation", () => {
		const canonical = buildSimulationReadinessTestComponents();
		const canonicalFoundationBytes = canonical.foundation.paths.positions.byteLength;
		const owned = structuredClone(canonical);
		const request: SimulationReadinessWorkerRequest = {
			type: "CERTIFY_SIMULATION_READINESS",
			protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
			requestId: 17,
			generation: 9,
			components: owned,
		};
		const delivered = structuredClone(request, {
			transfer: collectTransferableBuffers(owned),
		});
		expect(owned.foundation.paths.positions.byteLength).toBe(0);
		const response = certifySimulationReadinessWorkerRequest(delivered);
		expect(response).toMatchObject({
			type: "SIMULATION_READINESS_CERTIFIED",
			requestId: 17,
			generation: 9,
		});
		const responseTransfers = collectSimulationReadinessWorkerResponseTransferBuffers(response);
		expect(responseTransfers.length).toBeGreaterThan(0);
		const received = structuredClone(response, { transfer: responseTransfers });
		if (received.type !== "SIMULATION_READINESS_CERTIFIED") {
			throw new Error("Expected certified readiness response.");
		}
		expect(isPublishedSimulationReadinessSnapshot(received.published)).toBe(true);
		expect(received.published.foundation.paths.positions.byteLength).toBeGreaterThan(0);
		expect(canonical.foundation.paths.positions.byteLength).toBe(canonicalFoundationBytes);
	});

	it("Worker runtime rejects malformed and source-mixed requests without readiness", () => {
		expect(certifySimulationReadinessWorkerRequest(null)).toMatchObject({
			type: "SIMULATION_READINESS_REJECTED",
			requestId: 0,
			generation: 0,
			code: "MALFORMED_REQUEST",
		});

		const first = buildSimulationReadinessTestComponents();
		const second = buildSimulationReadinessTestComponents(
			buildSimulationReadinessTestFoundation(buildSimulationReadinessLongBay(50)),
		);
		const response = certifySimulationReadinessWorkerRequest({
			type: "CERTIFY_SIMULATION_READINESS",
			protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
			requestId: 22,
			generation: 3,
			components: { ...first, occupancyPolicy: second.occupancyPolicy },
		});
		expect(response).toMatchObject({
			type: "SIMULATION_READINESS_REJECTED",
			requestId: 22,
			generation: 3,
			code: "SOURCE_IDENTITY_MISMATCH",
		});
	});

	it("certifies the public-safe 60-Bay component set with a compact certificate", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const readiness = createRailProjectReadiness(
			build.analysis,
			build.physical,
			build.authoredChecksum,
		);
		expect(readiness.ready).toBe(true);
		const foundation = compileSimulationStaticWorldFoundation({
			patchSequence: build.document.getPatchSequence(),
			authoredChecksum: build.authoredChecksum,
			physicalFingerprint: build.physicalFingerprint,
			readiness,
			physical: build.physical,
			portEquipment: build.document.portEquipment,
		});
		const components = buildSimulationReadinessTestComponents(foundation);
		const certificate = compileSimulationReadinessCertificate(components);
		const owned = structuredClone(components);
		const delivered = structuredClone(
			{
				type: "CERTIFY_SIMULATION_READINESS" as const,
				protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
				requestId: 60,
				generation: 1,
				components: owned,
			} satisfies SimulationReadinessWorkerRequest,
			{ transfer: collectTransferableBuffers(owned) },
		);
		const response = certifySimulationReadinessWorkerRequest(delivered);
		const received = structuredClone(response, {
			transfer: collectSimulationReadinessWorkerResponseTransferBuffers(response),
		});

		expect(build.summary.railCells).toBe(9_896);
		expect(certificate.snapshotByteLength).toBeGreaterThan(0);
		expect(certificate.fingerprint.length).toBeLessThan(128);
		expect(certificate.simulationReady).toBe(true);
		expect(simulationReadinessCertificateError(certificate)).toBeNull();
		expect(received.type).toBe("SIMULATION_READINESS_CERTIFIED");
		if (received.type === "SIMULATION_READINESS_CERTIFIED") {
			expect(isPublishedSimulationReadinessSnapshot(received.published)).toBe(true);
			expect(received.published.certificate.snapshotByteLength).toBe(
				certificate.snapshotByteLength,
			);
		}
	});
});
