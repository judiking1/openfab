import { describe, expect, it } from "vitest";
import {
	defaultSyntheticFabStarterRequest,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import { prepareSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import {
	certificationEvidenceMatchesPrepared,
	createSyntheticFabStarterCertifiedArtifact,
	isSyntheticFabStarterCertificationEvidence,
	PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	rebindSyntheticFabStarterCertificationEvidence,
} from "../editor/SyntheticFabStarterCertifiedArtifact";
import { SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION } from "./SyntheticFabStarterCertifiedArtifactProtocol";
import { hydrateSyntheticFabStarterCertifiedArtifactRequest } from "./SyntheticFabStarterCertifiedArtifactRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

describe("SyntheticFabStarterCertifiedArtifactRuntime", () => {
	const starter = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");
	const artifactSource = JSON.stringify(
		createSyntheticFabStarterCertifiedArtifact(
			prepareSyntheticFabStarter(starter),
			prepareSyntheticFabStarter(starter),
			starter,
		),
	);

	it("hydrates in the Worker realm and transfers every prepared buffer for main-realm rebinding", () => {
		const response = hydrateSyntheticFabStarterCertifiedArtifactRequest({
			type: "HYDRATE_SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT",
			protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
			requestId: 7,
			artifactId: PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
			requestFingerprint: syntheticFabStarterRequestFingerprint(starter),
			source: artifactSource,
			starter,
		});
		expect(response.type).toBe("SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED");
		if (response.type !== "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED") {
			throw new Error("Expected a hydrated certified artifact response.");
		}
		const transfers = collectTransferableBuffers(response.prepared);
		expect(transfers.length).toBeGreaterThan(20);
		const equipment = response.prepared.snapshot.portEquipment;
		expect(equipment.schemaVersion).toBe(2);
		for (const dimensions of [
			equipment.equipmentGroups.bodyLengthMillimeters,
			equipment.equipmentGroups.bodyWidthMillimeters,
		]) {
			expect(dimensions).toBeInstanceOf(Uint32Array);
			expect(dimensions).toHaveLength(equipment.equipmentGroupIds.length);
			expect(dimensions.every((dimension) => dimension === 0)).toBe(true);
			expect(transfers).toContain(dimensions.buffer);
		}

		const cloned = structuredClone(response, { transfer: transfers });
		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		const hydrated = rebindSyntheticFabStarterCertificationEvidence(
			cloned.prepared,
			cloned.attestation,
			starter,
		);
		if (!hydrated) throw new Error("Expected main-realm certification rebinding.");
		expect(hydrated.prepared.snapshot.portEquipment.equipmentGroups.bodyLengthMillimeters).toEqual(
			new Uint32Array(hydrated.prepared.snapshot.portEquipment.equipmentGroupIds.length),
		);
		expect(hydrated.prepared.snapshot.portEquipment.equipmentGroups.bodyWidthMillimeters).toEqual(
			new Uint32Array(hydrated.prepared.snapshot.portEquipment.equipmentGroupIds.length),
		);
		expect(isSyntheticFabStarterCertificationEvidence(hydrated.evidence)).toBe(true);
		expect(
			certificationEvidenceMatchesPrepared(hydrated.evidence, hydrated.prepared, starter),
		).toBe(true);
	});

	it("rejects malformed source and request-bound identity mismatches", () => {
		const base = {
			type: "HYDRATE_SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT" as const,
			protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
			requestId: 3,
			artifactId: PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
			requestFingerprint: syntheticFabStarterRequestFingerprint(starter),
			source: artifactSource,
			starter,
		};
		expect(
			hydrateSyntheticFabStarterCertifiedArtifactRequest({ ...base, source: "{not-json" }).type,
		).toBe("SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED");
		expect(
			hydrateSyntheticFabStarterCertifiedArtifactRequest({
				...base,
				requestFingerprint: "stale-request",
			}).type,
		).toBe("SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED");
		expect(
			hydrateSyntheticFabStarterCertifiedArtifactRequest({
				...base,
				artifactId: PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
			}).type,
		).toBe("SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED");
	});

	it("throws before hydration for malformed protocol metadata", () => {
		expect(() =>
			hydrateSyntheticFabStarterCertifiedArtifactRequest({
				type: "HYDRATE_SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT",
				protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
				requestId: 0,
				artifactId: PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
				requestFingerprint: syntheticFabStarterRequestFingerprint(starter),
				source: artifactSource,
				starter,
			}),
		).toThrow(/malformed/);
	});
});
