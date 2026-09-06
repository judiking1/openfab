import { beforeAll, describe, expect, it } from "vitest";
import {
	defaultSyntheticFabStarterRequest,
	type SyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import { captureStaticFabOrganizationBundle } from "../core/StaticFabOrganizationBundle";
import generatedFullFabArtifactSource from "../generated/synthetic-fab-presets/full-fab-52.default.v3.json?raw";
import generatedArtifactSource from "../generated/synthetic-fab-presets/large-fab-60.default.v3.json?raw";
import generatedPairedCirculationArtifactSource from "../generated/synthetic-fab-presets/paired-circulation-fab-52.default.v4.json?raw";
import generatedParallelHallArtifactSource from "../generated/synthetic-fab-presets/parallel-hall-fab-12.default.v3.json?raw";
import generatedProductionArtifactSource from "../generated/synthetic-fab-presets/production-fab-60.default.v3.json?raw";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION } from "../worker/SyntheticFabStarterCertifiedArtifactProtocol";
import {
	certificationEvidenceBindsPreparedIdentity,
	certificationEvidenceMatchesPrepared,
	certificationEvidenceMatchesPreparedCooperatively,
	createSyntheticFabStarterCertifiedArtifact,
	FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	hydrateSyntheticFabStarterCertifiedArtifact,
	hydrateSyntheticFabStarterCertifiedArtifactForTransfer,
	isDefaultFullFabCertifiedRequest,
	isDefaultLargeFabCertifiedRequest,
	isDefaultPairedCirculationFabCertifiedRequest,
	isDefaultParallelHallFabCertifiedRequest,
	isDefaultProductionFabCertifiedRequest,
	isDefaultSyntheticFabCertifiedRequest,
	isSyntheticFabStarterCertificationEvidence,
	PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
	rebindSyntheticFabStarterCertificationEvidence,
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES,
	type SyntheticFabStarterCertifiedArtifact,
	syntheticFabStarterCertifiedArtifactIdForRequest,
} from "./SyntheticFabStarterCertifiedArtifact";

describe("SyntheticFabStarterCertifiedArtifact", () => {
	let request: SyntheticFabStarterRequest;
	let primary: PreparedSyntheticFabStarter;
	let independent: PreparedSyntheticFabStarter;
	let artifact: SyntheticFabStarterCertifiedArtifact;
	let productionRequest: SyntheticFabStarterRequest;
	let productionPrimary: PreparedSyntheticFabStarter;
	let productionIndependent: PreparedSyntheticFabStarter;
	let productionArtifact: SyntheticFabStarterCertifiedArtifact;
	let parallelHallRequest: SyntheticFabStarterRequest;
	let parallelHallArtifact: SyntheticFabStarterCertifiedArtifact;

	beforeAll(() => {
		request = defaultSyntheticFabStarterRequest("large-fab-60");
		primary = prepareSyntheticFabStarter(request);
		independent = prepareSyntheticFabStarter(request);
		artifact = createSyntheticFabStarterCertifiedArtifact(primary, independent, request);
		productionRequest = defaultSyntheticFabStarterRequest("production-fab-60");
		productionPrimary = prepareSyntheticFabStarter(productionRequest);
		productionIndependent = prepareSyntheticFabStarter(productionRequest);
		productionArtifact = createSyntheticFabStarterCertifiedArtifact(
			productionPrimary,
			productionIndependent,
			productionRequest,
		);
		parallelHallRequest = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");
		parallelHallArtifact = createSyntheticFabStarterCertifiedArtifact(
			prepareSyntheticFabStarter(parallelHallRequest),
			prepareSyntheticFabStarter(parallelHallRequest),
			parallelHallRequest,
		);
	}, 60_000);

	it("matches the checked-in deterministic public synthetic artifact", () => {
		expect(JSON.parse(generatedArtifactSource)).toEqual(artifact);
		expect(artifact).toMatchObject({
			schemaVersion: 3,
			artifactId: "large-fab-60.default.v3",
			certificationContract: "independent-materialization-v2",
		});
		expect(SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION).toBe(4);
		expect(artifact.typedArrayByteLength).toBeGreaterThan(0);
		expect(artifact.payloadByteLength).toBeLessThan(
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES,
		);
	});

	it("hydrates the exact default Large FAB and exposes bound opaque evidence", () => {
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(artifact, request);
		expect(hydrated).not.toBeNull();
		if (!hydrated) throw new Error("Expected certified Large FAB hydration.");

		expect(hydrated.prepared.summary.bayCount).toBe(60);
		expect(hydrated.prepared.steps).toHaveLength(81);
		expect(hydrated.prepared.authoringReady).toBe(true);
		expect(hydrated.prepared.snapshot.checksum).toBe(hydrated.prepared.authoredChecksum);
		expect(hydrated.prepared.geometry).toBeNull();
		expect(hydrated.prepared.exactGeometry).not.toBeNull();
		expect(isSyntheticFabStarterCertificationEvidence(hydrated.evidence)).toBe(true);
		expect(
			certificationEvidenceBindsPreparedIdentity(hydrated.evidence, hydrated.prepared, request),
		).toBe(true);
		expect(
			certificationEvidenceMatchesPrepared(hydrated.evidence, hydrated.prepared, request),
		).toBe(true);
		expect(
			isSyntheticFabStarterCertificationEvidence({
				artifactId: hydrated.evidence.artifactId,
				certificationFingerprint: hydrated.evidence.certificationFingerprint,
			}),
		).toBe(false);
	});

	it("refuses to certify relationship-producing starters before producer activation", () => {
		const relationshipPrimary = structuredClone(primary);
		const relationshipIndependent = structuredClone(independent);
		(
			relationshipPrimary.snapshot.relationships as unknown as {
				nextRelationshipId: number;
			}
		).nextRelationshipId = 2;
		(
			relationshipIndependent.snapshot.relationships as unknown as {
				nextRelationshipId: number;
			}
		).nextRelationshipId = 2;

		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(
				relationshipPrimary,
				relationshipIndependent,
				request,
			),
		).toThrow(/independent|certification invariants/i);
	});

	it("captures adjacent certified Parallel Hall Bays as one portable DIRECT bundle", () => {
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(
			parallelHallArtifact,
			parallelHallRequest,
		);
		if (!hydrated) throw new Error("Expected certified Parallel Hall hydration.");
		const document = hydrateRailMirrorSnapshotDocument(hydrated.prepared.snapshot);
		const selectedBayIds = ["BAY-001", "BAY-002"].map((name) => {
			const record = document.organizations.records.find((candidate) => candidate.name === name);
			if (!record) throw new Error(`Expected ${name} organization.`);
			return record.id;
		});

		const captured = captureStaticFabOrganizationBundle(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			document.relationships,
			selectedBayIds,
			"DIRECT",
		);

		expect(captured.valid, captured.reason).toBe(true);
		if (!captured.valid) return;
		expect(captured.bundle.sourceModuleCount).toBe(104);
	});

	it("rebinds only a request-bound Worker attestation into main-realm evidence", async () => {
		const transferable = hydrateSyntheticFabStarterCertifiedArtifactForTransfer(
			generatedParallelHallArtifactSource,
			parallelHallRequest,
		);
		if (!transferable) throw new Error("Expected transferable Parallel Hall hydration.");
		expect(isSyntheticFabStarterCertificationEvidence(transferable.attestation)).toBe(false);
		expect(transferable.attestation).toMatchObject({
			schemaVersion: 4,
			artifactSchemaVersion: 3,
		});

		const rebound = rebindSyntheticFabStarterCertificationEvidence(
			transferable.prepared,
			transferable.attestation,
			parallelHallRequest,
		);
		if (!rebound) throw new Error("Expected main-realm evidence rebinding.");
		expect(isSyntheticFabStarterCertificationEvidence(rebound.evidence)).toBe(true);
		expect(Object.isFrozen(rebound.prepared)).toBe(true);
		expect(Object.isFrozen(rebound.prepared.snapshot)).toBe(true);
		expect(Object.isFrozen(rebound.prepared.steps)).toBe(true);
		expect(
			certificationEvidenceMatchesPrepared(rebound.evidence, rebound.prepared, parallelHallRequest),
		).toBe(true);

		expect(
			rebindSyntheticFabStarterCertificationEvidence(
				transferable.prepared,
				{ ...transferable.attestation, requestFingerprint: "forged" },
				parallelHallRequest,
			),
		).toBeNull();
		expect(
			rebindSyntheticFabStarterCertificationEvidence(
				transferable.prepared,
				{ ...transferable.attestation, unexpected: true },
				parallelHallRequest,
			),
		).toBeNull();

		let checkpoints = 0;
		expect(
			await certificationEvidenceMatchesPreparedCooperatively(
				rebound.evidence,
				rebound.prepared,
				parallelHallRequest,
				async () => {
					checkpoints += 1;
				},
			),
		).toBe(true);
		expect(checkpoints).toBeGreaterThan(1);
		rebound.prepared.snapshot.xs[0] = (rebound.prepared.snapshot.xs[0] as number) + 1;
		expect(
			await certificationEvidenceMatchesPreparedCooperatively(
				rebound.evidence,
				rebound.prepared,
				parallelHallRequest,
				async () => undefined,
			),
		).toBe(false);
	});

	it("creates fresh owned buffers for every hydration", () => {
		const first = hydrateSyntheticFabStarterCertifiedArtifact(artifact, request);
		const second = hydrateSyntheticFabStarterCertifiedArtifact(artifact, request);
		if (!first || !second) throw new Error("Expected two certified hydrations.");
		const firstViews = collectTypedViews(first.prepared);
		const secondViews = collectTypedViews(second.prepared);

		expect(firstViews.size).toBeGreaterThan(20);
		expect([...firstViews.keys()]).toEqual([...secondViews.keys()]);
		for (const [path, firstView] of firstViews) {
			const secondView = secondViews.get(path);
			if (!secondView) throw new Error(`Missing hydrated typed view ${path}.`);
			expect(secondView.constructor).toBe(firstView.constructor);
			expect(secondView.byteLength).toBe(firstView.byteLength);
			expect(secondView.buffer, path).not.toBe(firstView.buffer);
			expect(firstView.byteOffset, path).toBe(0);
			expect(firstView.byteLength, path).toBe(firstView.buffer.byteLength);
			expect(secondView.byteOffset, path).toBe(0);
			expect(secondView.byteLength, path).toBe(secondView.buffer.byteLength);
		}

		const originalSecondX = second.prepared.snapshot.xs[0];
		first.prepared.snapshot.xs[0] = (first.prepared.snapshot.xs[0] as number) + 1;
		expect(second.prepared.snapshot.xs[0]).toBe(originalSecondX);
		expect(primary.snapshot.xs[0]).toBe(originalSecondX);
		expect(
			certificationEvidenceBindsPreparedIdentity(first.evidence, second.prepared, request),
		).toBe(false);
		expect(certificationEvidenceMatchesPrepared(first.evidence, second.prepared, request)).toBe(
			false,
		);
	});

	it("requires two independent materializations at generation time", () => {
		expect(() => createSyntheticFabStarterCertifiedArtifact(primary, primary, request)).toThrow(
			/independent preparation object/,
		);
		const sharedBuffers = {
			...independent,
			snapshot: { ...independent.snapshot, ys: primary.snapshot.ys },
		};
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(primary, sharedBuffers, request),
		).toThrow(/must not share typed-array buffers/);
	});

	it("supports only the exact default request", () => {
		const custom = setSyntheticFabStarterParameter(request, "bayCount", 61);
		expect(isDefaultLargeFabCertifiedRequest(request)).toBe(true);
		expect(isDefaultSyntheticFabCertifiedRequest(request)).toBe(true);
		expect(isDefaultLargeFabCertifiedRequest(custom)).toBe(false);
		expect(hydrateSyntheticFabStarterCertifiedArtifact(artifact, custom)).toBeNull();
		expect(() => createSyntheticFabStarterCertifiedArtifact(primary, independent, custom)).toThrow(
			/exact default/,
		);
	});

	it("certifies the exact default Production FAB without serialized preview geometry", () => {
		expect(JSON.parse(generatedProductionArtifactSource)).toEqual(productionArtifact);
		expect(productionArtifact.artifactId).toBe(PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID);
		expect(isDefaultProductionFabCertifiedRequest(productionRequest)).toBe(true);
		expect(isDefaultLargeFabCertifiedRequest(productionRequest)).toBe(false);
		expect(isDefaultSyntheticFabCertifiedRequest(productionRequest)).toBe(true);
		expect(syntheticFabStarterCertifiedArtifactIdForRequest(productionRequest)).toBe(
			PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
		);

		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(
			productionArtifact,
			productionRequest,
		);
		if (!hydrated) throw new Error("Expected certified Production FAB hydration.");
		expect(hydrated.prepared.summary.bayCount).toBe(60);
		expect(hydrated.prepared.summary.zoneCount).toBe(3);
		expect(hydrated.prepared.summary.strongComponents).toBe(1);
		expect(hydrated.prepared.summary.openTerminals).toBe(0);
		expect(hydrated.prepared.steps).toHaveLength(185);
		expect(
			hydrated.prepared.steps.filter((step) => step.hierarchyRole === "process-loop"),
		).toHaveLength(120);
		expect(
			hydrated.prepared.steps.filter((step) => step.hierarchyRole === "process-bay"),
		).toHaveLength(60);
		expect(
			hydrated.prepared.steps.filter((step) => step.hierarchyRole === "bay-bank"),
		).toHaveLength(3);
		expect(hydrated.prepared.snapshot.organizations.organizationIds).toHaveLength(184);
		expect(hydrated.prepared.planFingerprint).not.toBeNull();
		expect(hydrated.prepared.geometry).toBeNull();
		expect(hydrated.prepared.exactGeometry).toBeNull();
		expect(
			certificationEvidenceBindsPreparedIdentity(
				hydrated.evidence,
				hydrated.prepared,
				productionRequest,
			),
		).toBe(true);
		expect(
			certificationEvidenceMatchesPrepared(hydrated.evidence, hydrated.prepared, productionRequest),
		).toBe(true);
	});

	it("hydrates the shipped Full FAB hierarchy as the repeat-placeable default", () => {
		const fullRequest = defaultSyntheticFabStarterRequest("full-fab-52");
		const fullArtifact = JSON.parse(
			generatedFullFabArtifactSource,
		) as SyntheticFabStarterCertifiedArtifact;

		expect(fullArtifact.artifactId).toBe(FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID);
		expect(isDefaultFullFabCertifiedRequest(fullRequest)).toBe(true);
		expect(syntheticFabStarterCertifiedArtifactIdForRequest(fullRequest)).toBe(
			FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
		);
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(fullArtifact, fullRequest);
		if (!hydrated) throw new Error("Expected certified Full FAB hydration.");
		expect(hydrated.prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			strongComponents: 1,
			openTerminals: 0,
		});
		expect(hydrated.prepared.steps).toHaveLength(171);
		expect(
			hydrated.prepared.steps.filter((step) => step.hierarchyRole === "process-loop"),
		).toHaveLength(104);
		expect(hydrated.prepared.snapshot.organizations.organizationIds).toHaveLength(161);
		expect(hydrated.prepared.placementBundle).not.toBeNull();
		expect(hydrated.prepared.geometry).toBeNull();
		expect(hydrated.prepared.exactGeometry).toBeNull();
	});

	it("hydrates the shipped paired-circulation FAB as the production default", () => {
		const pairedRequest = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
		const pairedArtifact = JSON.parse(
			generatedPairedCirculationArtifactSource,
		) as SyntheticFabStarterCertifiedArtifact;

		expect(pairedArtifact.artifactId).toBe(PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID);
		expect(isDefaultPairedCirculationFabCertifiedRequest(pairedRequest)).toBe(true);
		expect(syntheticFabStarterCertifiedArtifactIdForRequest(pairedRequest)).toBe(
			PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
		);
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(pairedArtifact, pairedRequest);
		if (!hydrated) throw new Error("Expected certified Paired-Circulation FAB hydration.");
		expect(hydrated.prepared.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			strongComponents: 1,
			openTerminals: 0,
		});
		expect(hydrated.prepared.steps).toHaveLength(201);
		expect(
			hydrated.prepared.steps.filter((step) => step.hierarchyRole === "outer-circulation"),
		).toHaveLength(4);
		expect(
			hydrated.prepared.steps.filter((step) => step.hierarchyRole === "process-loop"),
		).toHaveLength(87);
		expect(hydrated.prepared.snapshot.organizations.organizationIds).toHaveLength(144);
		expect(hydrated.prepared.placementBundle).not.toBeNull();
		expect(hydrated.prepared.geometry).toBeNull();
		expect(hydrated.prepared.exactGeometry).toBeNull();
	});

	it("refuses to certify a repeat-placeable Production FAB after its placement bundle is removed", () => {
		const withoutPlacement = Object.freeze({
			...productionPrimary,
			placementBundle: null,
			placementBundleFingerprint: null,
		});
		const independentWithoutPlacement = Object.freeze({
			...productionIndependent,
			placementBundle: null,
			placementBundleFingerprint: null,
		});
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(
				withoutPlacement,
				independentWithoutPlacement,
				productionRequest,
			),
		).toThrow(/Production FAB certification invariants/);
	});

	it("certifies the default Parallel Hall FAB as a repeat-placeable authored hierarchy", () => {
		expect(JSON.parse(generatedParallelHallArtifactSource)).toEqual(parallelHallArtifact);
		expect(parallelHallArtifact.artifactId).toBe(PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID);
		expect(isDefaultParallelHallFabCertifiedRequest(parallelHallRequest)).toBe(true);
		expect(syntheticFabStarterCertifiedArtifactIdForRequest(parallelHallRequest)).toBe(
			PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
		);

		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(
			parallelHallArtifact,
			parallelHallRequest,
		);
		if (!hydrated) throw new Error("Expected certified Parallel Hall FAB hydration.");
		expect(hydrated.prepared.summary).toMatchObject({
			zoneCount: 2,
			bayCount: 12,
			strongComponents: 1,
			openTerminals: 0,
		});
		expect(hydrated.prepared.steps).toHaveLength(44);
		expect(hydrated.prepared.snapshot.organizations.organizationIds).toHaveLength(39);
		expect(hydrated.prepared.placementBundle).not.toBeNull();
		expect(hydrated.prepared.geometry).toBeNull();
		expect(hydrated.prepared.exactGeometry).toBeNull();
	});

	it("isolates Production FAB buffers and rejects cross-preset artifact identities", () => {
		const first = hydrateSyntheticFabStarterCertifiedArtifact(
			productionArtifact,
			productionRequest,
		);
		const second = hydrateSyntheticFabStarterCertifiedArtifact(
			productionArtifact,
			productionRequest,
		);
		if (!first || !second) throw new Error("Expected two certified Production FAB hydrations.");
		const firstViews = collectTypedViews(first.prepared);
		const secondViews = collectTypedViews(second.prepared);
		expect(firstViews.size).toBeGreaterThan(20);
		expect([...firstViews.keys()]).toEqual([...secondViews.keys()]);
		for (const [path, firstView] of firstViews) {
			const secondView = secondViews.get(path);
			if (!secondView) throw new Error(`Missing hydrated Production FAB typed view ${path}.`);
			expect(secondView.buffer, path).not.toBe(firstView.buffer);
		}
		expect(first.prepared.exactGeometry).toBeNull();
		expect(second.prepared.exactGeometry).toBeNull();
		expect(hydrateSyntheticFabStarterCertifiedArtifact(productionArtifact, request)).toBeNull();
		expect(hydrateSyntheticFabStarterCertifiedArtifact(artifact, productionRequest)).toBeNull();

		const customProduction = setSyntheticFabStarterParameter(productionRequest, "bayCount", 61);
		expect(isDefaultProductionFabCertifiedRequest(customProduction)).toBe(false);
		expect(
			hydrateSyntheticFabStarterCertifiedArtifact(productionArtifact, customProduction),
		).toBeNull();
	});

	it("fails closed for envelope, checksum, size, and typed-array corruption", () => {
		const extraField = cloneArtifact(artifact);
		extraField.unexpected = true;

		const wrongSchema = cloneArtifact(artifact);
		wrongSchema.schemaVersion = 999;

		const wrongPayloadChecksum = cloneArtifact(artifact);
		wrongPayloadChecksum.payloadChecksum = "00000000:00000000";

		const oversized = cloneArtifact(artifact);
		oversized.payloadByteLength = SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES + 1;

		const wrongMaterialization = cloneArtifact(artifact);
		wrongMaterialization.materializationFingerprint = "00000000:00000000";

		const wrongTypedName = cloneArtifact(artifact);
		const typed = findSerializedTypedArray(wrongTypedName.payload);
		if (!typed) throw new Error("Expected a serialized typed array.");
		typed.$openfabTypedArray = "BigInt64Array";

		const wrongTypedLength = cloneArtifact(artifact);
		const lengthTyped = findSerializedTypedArray(wrongTypedLength.payload);
		if (!lengthTyped) throw new Error("Expected a serialized typed array.");
		lengthTyped.length = Number(lengthTyped.length) + 1;

		const badBase64 = cloneArtifact(artifact);
		const base64Typed = findSerializedTypedArray(badBase64.payload);
		if (!base64Typed) throw new Error("Expected a serialized typed array.");
		base64Typed.base64 = `!${String(base64Typed.base64).slice(1)}`;

		for (const corrupted of [
			extraField,
			wrongSchema,
			wrongPayloadChecksum,
			oversized,
			wrongMaterialization,
			wrongTypedName,
			wrongTypedLength,
			badBase64,
		]) {
			expect(hydrateSyntheticFabStarterCertifiedArtifact(corrupted, request)).toBeNull();
		}
	});
});

function cloneArtifact(artifact: SyntheticFabStarterCertifiedArtifact): Record<string, unknown> {
	return JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
}

function findSerializedTypedArray(value: unknown): Record<string, unknown> | null {
	if (Array.isArray(value)) {
		for (const child of value) {
			const match = findSerializedTypedArray(child);
			if (match) return match;
		}
		return null;
	}
	if (!isRecord(value)) return null;
	if (Object.hasOwn(value, "$openfabTypedArray")) return value;
	for (const child of Object.values(value)) {
		const match = findSerializedTypedArray(child);
		if (match) return match;
	}
	return null;
}

function collectTypedViews(value: unknown): Map<string, ArrayBufferView> {
	const views = new Map<string, ArrayBufferView>();
	visitTypedViews(value, "$", views);
	return views;
}

function visitTypedViews(value: unknown, path: string, views: Map<string, ArrayBufferView>): void {
	if (ArrayBuffer.isView(value)) {
		views.set(path, value);
		return;
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			visitTypedViews(value[index], `${path}[${index}]`, views);
		}
		return;
	}
	if (!isRecord(value)) return;
	for (const key of Object.keys(value).sort()) {
		visitTypedViews(value[key], `${path}.${key}`, views);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
