import { beforeAll, describe, expect, it } from "vitest";
import {
	defaultSyntheticFabStarterRequest,
	type SyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
	syntheticFabStarterParallelHallAssemblyPlan,
} from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import { emptyStaticFabAssemblyRelationshipState } from "../core/StaticFabAssemblyRelationship";
import { captureStaticFabOrganizationBundle } from "../core/StaticFabOrganizationBundle";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import generatedFullFabArtifactSource from "../generated/synthetic-fab-presets/full-fab-52.default.v5.json?raw";
import generatedArtifactSource from "../generated/synthetic-fab-presets/large-fab-60.default.v5.json?raw";
import generatedPairedCirculationArtifactSource from "../generated/synthetic-fab-presets/paired-circulation-fab-52.default.v6.json?raw";
import generatedParallelHallArtifactSource from "../generated/synthetic-fab-presets/parallel-hall-fab-12.default.v5.json?raw";
import generatedProductionArtifactSource from "../generated/synthetic-fab-presets/production-fab-60.default.v5.json?raw";
import { checksumRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	hydrateStaticFabAssemblyRelationshipSnapshot,
} from "../worker/StaticFabAssemblyRelationshipSoA";
import {
	createStaticFabOrganizationSnapshot,
	hydrateStaticFabOrganizationSnapshot,
} from "../worker/StaticFabOrganizationSoA";
import { SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION } from "../worker/SyntheticFabStarterCertifiedArtifactProtocol";
import { preparedSyntheticFabStarterMatchesRequest } from "./SyntheticFabStarterBridge";
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
import { syntheticFabStarterRelationshipsMatchPlan } from "./SyntheticFabStarterRelationshipContract";

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
	let parallelHallPrimary: PreparedSyntheticFabStarter;
	let parallelHallIndependent: PreparedSyntheticFabStarter;

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
		parallelHallPrimary = prepareSyntheticFabStarter(parallelHallRequest);
		parallelHallIndependent = prepareSyntheticFabStarter(parallelHallRequest);
		parallelHallArtifact = createSyntheticFabStarterCertifiedArtifact(
			parallelHallPrimary,
			parallelHallIndependent,
			parallelHallRequest,
		);
	}, 60_000);

	it("matches the checked-in deterministic public synthetic artifact", () => {
		expect(JSON.parse(generatedArtifactSource)).toEqual(artifact);
		expect(artifact).toMatchObject({
			schemaVersion: 5,
			artifactId: "large-fab-60.default.v5",
			certificationContract: "independent-materialization-v4",
		});
		expect(SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION).toBe(6);
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

	it("refuses undeclared relationship state in producer-free Legacy Large", () => {
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

	it("preserves exact Production relationships across two builds, artifact hydration and portable capture", () => {
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(
			productionArtifact,
			productionRequest,
		);
		if (!hydrated) throw new Error("Expected Production artifact.");
		const expected = hydrateStaticFabAssemblyRelationshipSnapshot(
			productionPrimary.snapshot.relationships,
		);
		expect(expected.records).toHaveLength(3);
		expect(expected.records.map((record) => record.participantOrganizationIds)).toEqual([
			[2],
			[63],
			[124],
		]);
		for (const candidate of [productionIndependent, hydrated.prepared]) {
			expect(
				hydrateStaticFabAssemblyRelationshipSnapshot(candidate.snapshot.relationships),
			).toEqual(expected);
			expect(candidate.placementBundle?.relationships).toEqual(expected);
			expect(candidate.authoredChecksum).toBe(productionPrimary.authoredChecksum);
			expect(preparedSyntheticFabStarterMatchesRequest(candidate, productionRequest)).toBe(true);
		}
	});

	it("preserves both Parallel Hall Bank contacts through independent builds and certified copies", () => {
		const hydrated = hydrateSyntheticFabStarterCertifiedArtifact(
			parallelHallArtifact,
			parallelHallRequest,
		);
		if (!hydrated) throw new Error("Expected Parallel Hall artifact.");
		const expected = hydrateStaticFabAssemblyRelationshipSnapshot(
			parallelHallPrimary.snapshot.relationships,
		);
		expect(expected.records.map((record) => record.participantOrganizationIds)).toEqual([[2], [3]]);
		for (const candidate of [parallelHallIndependent, hydrated.prepared]) {
			expect(
				hydrateStaticFabAssemblyRelationshipSnapshot(candidate.snapshot.relationships),
			).toEqual(expected);
			expect(candidate.placementBundle?.relationships).toEqual(expected);
			expect(candidate.authoredChecksum).toBe(parallelHallPrimary.authoredChecksum);
			expect(preparedSyntheticFabStarterMatchesRequest(candidate, parallelHallRequest)).toBe(true);
		}
	});

	it("rejects removed Parallel Hall contacts despite recomputed snapshot and bundle checksums", () => {
		const plan = syntheticFabStarterParallelHallAssemblyPlan(parallelHallRequest);
		if (!plan) throw new Error("Expected Parallel Hall plan.");
		expect(syntheticFabStarterRelationshipsMatchPlan(parallelHallPrimary, null, plan)).toBe(true);
		const stripped = withNoDeclaredRelationships(parallelHallPrimary);
		expect(syntheticFabStarterRelationshipsMatchPlan(stripped, null, plan)).toBe(false);
		expect(stripped.snapshot.checksum).toBe(checksumRailMirrorSnapshot(stripped.snapshot));
		expect(preparedSyntheticFabStarterMatchesRequest(stripped, parallelHallRequest)).toBe(false);
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(
				stripped,
				withNoDeclaredRelationships(parallelHallIndependent),
				parallelHallRequest,
			),
		).toThrow();
	});

	it("rejects rehashed Parallel Hall Bank name swaps and refuses changed source ownership", () => {
		const altered = structuredClone(parallelHallPrimary);
		expect(preparedSyntheticFabStarterMatchesRequest(altered, parallelHallRequest)).toBe(true);
		const names = altered.snapshot.organizations.records.names as string[];
		[names[1], names[2]] = [names[2] as string, names[1] as string];
		const bundle = altered.placementBundle;
		if (!bundle) throw new Error("Expected Parallel Hall bundle.");
		const placementBundle = {
			...bundle,
			organizations: bundle.organizations.map((row, index) => ({
				...row,
				name: names[index] as string,
			})),
		};
		const checksum = checksumRailMirrorSnapshot(altered.snapshot);
		expect(
			preparedSyntheticFabStarterMatchesRequest(
				{
					...altered,
					authoredChecksum: checksum,
					snapshot: { ...altered.snapshot, checksum },
					placementBundle,
					placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
				},
				parallelHallRequest,
			),
		).toBe(false);
		const state = hydrateStaticFabOrganizationSnapshot(parallelHallPrimary.snapshot.organizations);
		const first = state.records[1];
		const second = state.records[2];
		if (!first || !second) throw new Error("Expected two Parallel Hall Banks.");
		const organizations = createStaticFabOrganizationSnapshot({
			...state,
			records: state.records.map((row) => ({
				...row,
				membership:
					row.id === first.id
						? second.membership
						: row.id === second.id
							? first.membership
							: row.membership,
			})),
		});
		const changed = { ...parallelHallPrimary.snapshot, organizations };
		expect(() =>
			hydrateRailMirrorSnapshotDocument({
				...changed,
				checksum: checksumRailMirrorSnapshot(changed),
			}),
		).toThrow(/조립 관계/);
	});

	it("rejects self-consistent checksums that silently remove declared Production relationships", () => {
		const stripped = withNoDeclaredRelationships(productionPrimary);
		const repeated = withNoDeclaredRelationships(productionIndependent);
		expect(stripped.snapshot.checksum).toBe(checksumRailMirrorSnapshot(stripped.snapshot));
		expect(preparedSyntheticFabStarterMatchesRequest(stripped, productionRequest)).toBe(false);
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(stripped, repeated, productionRequest),
		).toThrow();
	});

	it.each([
		"Production",
		"Parallel Hall",
	])("rejects an independently checksummed %s portable bundle that omits the declared relationships", (producer) => {
		const primary = producer === "Production" ? productionPrimary : parallelHallPrimary;
		const request = producer === "Production" ? productionRequest : parallelHallRequest;
		const bundle = primary.placementBundle;
		if (!bundle) throw new Error("Expected producer bundle.");
		const stripped = { ...bundle, relationships: emptyStaticFabAssemblyRelationshipState() };
		expect(
			preparedSyntheticFabStarterMatchesRequest(
				{
					...primary,
					placementBundle: stripped,
					placementBundleFingerprint: staticFabOrganizationBundleFingerprint(stripped),
				},
				request,
			),
		).toBe(false);
	});

	it("rejects swapped Bank identities even when snapshot and portable checksums are recomputed", () => {
		const altered = structuredClone(productionPrimary);
		const names = altered.snapshot.organizations.records.names as string[];
		[names[1], names[62]] = [names[62] as string, names[1] as string];
		if (!altered.placementBundle) throw new Error("Expected Production bundle.");
		const organizations = altered.placementBundle.organizations.map((row, index) => ({
			...row,
			name: names[index] as string,
		}));
		const placementBundle = { ...altered.placementBundle, organizations };
		const checksum = checksumRailMirrorSnapshot(altered.snapshot);
		const forged = {
			...altered,
			snapshot: { ...altered.snapshot, checksum },
			authoredChecksum: checksum,
			placementBundle,
			placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
		};
		expect(preparedSyntheticFabStarterMatchesRequest(forged, productionRequest)).toBe(false);
		expect(() =>
			createSyntheticFabStarterCertifiedArtifact(
				forged,
				structuredClone(forged),
				productionRequest,
			),
		).toThrow("Independent starter preparations do not match.");
	});

	it("refuses changed Bank ownership before activating a Production project", () => {
		const state = hydrateStaticFabOrganizationSnapshot(productionPrimary.snapshot.organizations);
		const first = state.records[1];
		const second = state.records[62];
		if (!first || !second) throw new Error("Expected two Production Banks.");
		const organizations = createStaticFabOrganizationSnapshot({
			...state,
			records: state.records.map((record) => ({
				...record,
				membership:
					record.id === first.id
						? second.membership
						: record.id === second.id
							? first.membership
							: record.membership,
			})),
		});
		const changed = { ...productionPrimary.snapshot, organizations };
		const snapshot = { ...changed, checksum: checksumRailMirrorSnapshot(changed) };
		expect(snapshot.checksum).not.toBe(productionPrimary.snapshot.checksum);
		expect(() => hydrateRailMirrorSnapshotDocument(snapshot)).toThrow(/조립 관계/);
	});

	it.each([
		"name",
		"parent",
	])("rejects portable-only organization %s drift with a valid bundle fingerprint", (field) => {
		const bundle = productionPrimary.placementBundle;
		if (!bundle) throw new Error("Expected Production bundle.");
		const organizations = bundle.organizations.map((row, index) =>
			index !== (field === "name" ? 1 : 2)
				? row
				: {
						...row,
						...(field === "name"
							? { name: "Undeclared Bank" }
							: { parentOrganizationIndices: [62] }),
					},
		);
		const placementBundle = { ...bundle, organizations };
		expect(
			preparedSyntheticFabStarterMatchesRequest(
				{
					...productionPrimary,
					placementBundle,
					placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
				},
				productionRequest,
			),
		).toBe(false);
	});

	it("rebinds only a request-bound Worker attestation into main-realm evidence", async () => {
		const transferable = hydrateSyntheticFabStarterCertifiedArtifactForTransfer(
			generatedParallelHallArtifactSource,
			parallelHallRequest,
		);
		if (!transferable) throw new Error("Expected transferable Parallel Hall hydration.");
		expect(isSyntheticFabStarterCertificationEvidence(transferable.attestation)).toBe(false);
		expect(transferable.attestation).toMatchObject({
			schemaVersion: 6,
			artifactSchemaVersion: 5,
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
		).toThrow("Independent starter preparations do not match.");
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

function withNoDeclaredRelationships(
	prepared: PreparedSyntheticFabStarter,
): PreparedSyntheticFabStarter {
	const relationships = emptyStaticFabAssemblyRelationshipState();
	const snapshot = {
		...prepared.snapshot,
		relationships: createStaticFabAssemblyRelationshipSnapshot(relationships),
	};
	const checksum = checksumRailMirrorSnapshot(snapshot);
	if (!prepared.placementBundle) throw new Error("Expected Production bundle.");
	const placementBundle = { ...prepared.placementBundle, relationships };
	return {
		...prepared,
		snapshot: { ...snapshot, checksum },
		authoredChecksum: checksum,
		placementBundle,
		placementBundleFingerprint: staticFabOrganizationBundleFingerprint(placementBundle),
	};
}
