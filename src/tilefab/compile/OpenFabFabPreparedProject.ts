import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { OPENFAB_PROJECT_SCHEMA_VERSION } from "../project/OpenFabProject";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	OPENFAB_FAB_ASSEMBLY_PLAN_VERSION,
	openFabFabAssemblyLayoutContractFingerprint,
} from "./OpenFabFabAssemblyPlan";
import {
	type CertifiedOpenFabFabComposition,
	OPENFAB_FAB_COMPOSER_VERSION,
} from "./OpenFabFabComposer";
import { OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION } from "./OpenFabFabOrganizationCompiler";
import {
	normalizeOpenFabFabProfile,
	OPENFAB_FAB_PROFILE_CURRENT_VERSION,
	type OpenFabFabProfile,
	openFabFabProfileDerivationContractFingerprint,
	openFabFabProfileFingerprint,
	openFabFabProfilePlanFingerprint,
} from "./OpenFabFabProfile";

export const OPENFAB_FAB_PREPARED_PROJECT_VERSION = 1 as const;
export const OPENFAB_FAB_PREPARED_PROJECT_KIND = "openfab-fab-prepared-project" as const;
export const OPENFAB_FAB_PREPARED_PROJECT_IDENTITY_KIND =
	"openfab-fab-prepared-project-identity" as const;
export const OPENFAB_FAB_PREPARED_PROJECT_ATTESTATION_KIND =
	"openfab-fab-prepared-project-attestation" as const;

export interface OpenFabFabPreparedProjectCounts {
	readonly layoutBlocks: number;
	readonly banks: number;
	readonly bays: number;
	readonly processLoops: number;
	readonly organizationRecords: number;
	readonly railCells: number;
	readonly directedEdges: number;
	readonly physicalPaths: number;
	readonly junctions: number;
	readonly advancedSwitches: 0;
	readonly ports: 0;
	readonly equipmentGroups: 0;
	readonly openTerminals: 0;
	readonly strongComponents: 1;
}

export interface OpenFabFabPreparedProjectBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/**
 * Manifest-neutral identity for one exact whole-Fab materialization. The actual user project
 * manifest is intentionally added only when this source is consumed for New Project activation.
 */
export interface OpenFabFabPreparedProjectIdentity {
	readonly kind: typeof OPENFAB_FAB_PREPARED_PROJECT_IDENTITY_KIND;
	readonly version: typeof OPENFAB_FAB_PREPARED_PROJECT_VERSION;
	readonly requestFingerprint: string;
	readonly profileFingerprint: string;
	readonly profileDerivationContractFingerprint: string;
	readonly profilePlanFingerprint: string;
	readonly assemblyLayoutContractFingerprint: string;
	readonly assemblyPlanFingerprint: string;
	readonly compositionFingerprint: string;
	readonly childLinksFingerprint: string;
	readonly stepLedgerFingerprint: string;
	readonly organizationManifestFingerprint: string;
	readonly organizationCompilationFingerprint: string;
	readonly organizationEdgeClaimFingerprint: string;
	readonly organizationCertificationFingerprint: string;
	readonly authoredChecksum: string;
	readonly authoredTopologyFingerprint: string;
	readonly authoredCertificateFingerprint: string;
	readonly physicalLayoutFingerprint: string;
	readonly physicalCertificateFingerprint: string;
	readonly readinessReportFingerprint: string;
	readonly readinessCertificateFingerprint: string;
	readonly codecProbePersistenceEvidenceFingerprint: string;
	readonly codecProbeCanonicalJsonFingerprint: string;
	readonly codecProbeSnapshotIdentityFingerprint: string;
	readonly sequence: 0;
	readonly revision: number;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly authoringReady: true;
	readonly simulationReady: false;
	readonly counts: OpenFabFabPreparedProjectCounts;
	readonly bounds: OpenFabFabPreparedProjectBounds;
	readonly fingerprint: string;
}

/** Worker-transfer DTO. It deliberately has no manifest and no portable placement bundle. */
export interface TransferableOpenFabFabPreparedProject {
	readonly kind: typeof OPENFAB_FAB_PREPARED_PROJECT_KIND;
	readonly version: typeof OPENFAB_FAB_PREPARED_PROJECT_VERSION;
	readonly requestFingerprint: string;
	readonly profile: OpenFabFabProfile;
	readonly identity: OpenFabFabPreparedProjectIdentity;
	readonly snapshot: RailMirrorSnapshot;
}

/** Serializable transfer receipt. Main-realm opaque evidence is minted only after revalidation. */
export interface OpenFabFabPreparedProjectAttestation {
	readonly kind: typeof OPENFAB_FAB_PREPARED_PROJECT_ATTESTATION_KIND;
	readonly version: typeof OPENFAB_FAB_PREPARED_PROJECT_VERSION;
	readonly requestFingerprint: string;
	readonly materializationFingerprint: string;
	readonly snapshotChecksum: string;
	readonly transferableBufferCount: number;
	readonly transferableByteLength: number;
	readonly fingerprint: string;
}

const IDENTITY_KEYS = Object.freeze([
	"kind",
	"version",
	"requestFingerprint",
	"profileFingerprint",
	"profileDerivationContractFingerprint",
	"profilePlanFingerprint",
	"assemblyLayoutContractFingerprint",
	"assemblyPlanFingerprint",
	"compositionFingerprint",
	"childLinksFingerprint",
	"stepLedgerFingerprint",
	"organizationManifestFingerprint",
	"organizationCompilationFingerprint",
	"organizationEdgeClaimFingerprint",
	"organizationCertificationFingerprint",
	"authoredChecksum",
	"authoredTopologyFingerprint",
	"authoredCertificateFingerprint",
	"physicalLayoutFingerprint",
	"physicalCertificateFingerprint",
	"readinessReportFingerprint",
	"readinessCertificateFingerprint",
	"codecProbePersistenceEvidenceFingerprint",
	"codecProbeCanonicalJsonFingerprint",
	"codecProbeSnapshotIdentityFingerprint",
	"sequence",
	"revision",
	"nextAdvancedSwitchId",
	"nextPortId",
	"nextEquipmentGroupId",
	"nextOrganizationId",
	"authoringReady",
	"simulationReady",
	"counts",
	"bounds",
	"fingerprint",
] as const);

const COUNTS_KEYS = Object.freeze([
	"layoutBlocks",
	"banks",
	"bays",
	"processLoops",
	"organizationRecords",
	"railCells",
	"directedEdges",
	"physicalPaths",
	"junctions",
	"advancedSwitches",
	"ports",
	"equipmentGroups",
	"openTerminals",
	"strongComponents",
] as const);

const BOUNDS_KEYS = Object.freeze(["minX", "minY", "maxX", "maxY"] as const);

const ATTESTATION_KEYS = Object.freeze([
	"kind",
	"version",
	"requestFingerprint",
	"materializationFingerprint",
	"snapshotChecksum",
	"transferableBufferCount",
	"transferableByteLength",
	"fingerprint",
] as const);

export function openFabFabPreparedProjectRequestFingerprint(input: unknown): string {
	const profile = normalizeOpenFabFabProfile(input);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"openfab-fab-prepared-project-request",
		openFabFabProfileFingerprint(profile),
		openFabFabProfileDerivationContractFingerprint(),
		openFabFabProfilePlanFingerprint(profile),
		openFabFabAssemblyLayoutContractFingerprint(),
	]);
	checksum.addNumbers([
		OPENFAB_FAB_PREPARED_PROJECT_VERSION,
		OPENFAB_FAB_PROFILE_CURRENT_VERSION,
		OPENFAB_FAB_ASSEMBLY_PLAN_VERSION,
		OPENFAB_FAB_COMPOSER_VERSION,
		OPENFAB_FAB_ORGANIZATION_CONTRACT_VERSION,
		OPENFAB_PROJECT_SCHEMA_VERSION,
	]);
	return `openfab-fab-prepared-project-request:v${OPENFAB_FAB_PREPARED_PROJECT_VERSION}:${checksum.digest()}`;
}

export function createOpenFabFabPreparedProjectIdentity(
	certificate: CertifiedOpenFabFabComposition,
): OpenFabFabPreparedProjectIdentity {
	const snapshotIdentity = certificate.persistenceEvidence.snapshotIdentity;
	const counts = Object.freeze({
		layoutBlocks: certificate.assemblyPlan.profileDerived.counts.layoutBlocks,
		banks: certificate.assemblyPlan.profileDerived.counts.banks,
		bays: certificate.assemblyPlan.profileDerived.counts.bays,
		processLoops: certificate.assemblyPlan.profileDerived.counts.processLoops,
		organizationRecords: certificate.organizations.manifest.counts.organizationRecords,
		railCells: certificate.authored.cells,
		directedEdges: certificate.authored.directedEdges,
		physicalPaths: certificate.physical.paths,
		junctions: certificate.authored.junctions,
		advancedSwitches: 0 as const,
		ports: 0 as const,
		equipmentGroups: 0 as const,
		openTerminals: 0 as const,
		strongComponents: 1 as const,
	});
	const bounds = Object.freeze({ ...certificate.assemblyPlan.bounds });
	const withoutFingerprint = Object.freeze({
		kind: OPENFAB_FAB_PREPARED_PROJECT_IDENTITY_KIND,
		version: OPENFAB_FAB_PREPARED_PROJECT_VERSION,
		requestFingerprint: openFabFabPreparedProjectRequestFingerprint(certificate.profile),
		profileFingerprint: certificate.assemblyPlan.profileDerived.profileFingerprint,
		profileDerivationContractFingerprint:
			certificate.assemblyPlan.profileDerived.derivationContractFingerprint,
		profilePlanFingerprint: certificate.assemblyPlan.profileDerived.planFingerprint,
		assemblyLayoutContractFingerprint: certificate.assemblyPlan.layoutContractFingerprint,
		assemblyPlanFingerprint: certificate.assemblyPlan.fingerprint,
		compositionFingerprint: certificate.fingerprint,
		childLinksFingerprint: certificate.childLinks.fingerprint,
		stepLedgerFingerprint: certificate.stepLedgerFingerprint,
		organizationManifestFingerprint: certificate.organizations.manifest.fingerprint,
		organizationCompilationFingerprint: certificate.organizations.compilation.fingerprint,
		organizationEdgeClaimFingerprint: certificate.organizations.edgeClaimFingerprint,
		organizationCertificationFingerprint: certificate.organizations.fingerprint,
		authoredChecksum: certificate.authored.checksum,
		authoredTopologyFingerprint: certificate.authored.topologyFingerprint,
		authoredCertificateFingerprint: certificate.authored.fingerprint,
		physicalLayoutFingerprint: certificate.physical.layoutFingerprint,
		physicalCertificateFingerprint: certificate.physical.fingerprint,
		readinessReportFingerprint: certificate.readiness.reportFingerprint,
		readinessCertificateFingerprint: certificate.readiness.fingerprint,
		codecProbePersistenceEvidenceFingerprint: certificate.persistenceEvidence.fingerprint,
		codecProbeCanonicalJsonFingerprint: certificate.persistenceEvidence.canonicalJsonFingerprint,
		codecProbeSnapshotIdentityFingerprint: snapshotIdentity.fingerprint,
		sequence: snapshotIdentity.sequence,
		revision: snapshotIdentity.revision,
		nextAdvancedSwitchId: snapshotIdentity.nextAdvancedSwitchId,
		nextPortId: snapshotIdentity.nextPortId,
		nextEquipmentGroupId: snapshotIdentity.nextEquipmentGroupId,
		nextOrganizationId: snapshotIdentity.nextOrganizationId,
		authoringReady: true as const,
		simulationReady: false as const,
		counts,
		bounds,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabPreparedProjectIdentityFingerprint(withoutFingerprint),
	});
}

export function openFabFabPreparedProjectIdentityFingerprint(
	identity: Omit<OpenFabFabPreparedProjectIdentity, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		identity.kind,
		identity.requestFingerprint,
		identity.profileFingerprint,
		identity.profileDerivationContractFingerprint,
		identity.profilePlanFingerprint,
		identity.assemblyLayoutContractFingerprint,
		identity.assemblyPlanFingerprint,
		identity.compositionFingerprint,
		identity.childLinksFingerprint,
		identity.stepLedgerFingerprint,
		identity.organizationManifestFingerprint,
		identity.organizationCompilationFingerprint,
		identity.organizationEdgeClaimFingerprint,
		identity.organizationCertificationFingerprint,
		identity.authoredChecksum,
		identity.authoredTopologyFingerprint,
		identity.authoredCertificateFingerprint,
		identity.physicalLayoutFingerprint,
		identity.physicalCertificateFingerprint,
		identity.readinessReportFingerprint,
		identity.readinessCertificateFingerprint,
		identity.codecProbePersistenceEvidenceFingerprint,
		identity.codecProbeCanonicalJsonFingerprint,
		identity.codecProbeSnapshotIdentityFingerprint,
	]);
	checksum.addNumbers([
		identity.version,
		identity.sequence,
		identity.revision,
		identity.nextAdvancedSwitchId,
		identity.nextPortId,
		identity.nextEquipmentGroupId,
		identity.nextOrganizationId,
		identity.authoringReady ? 1 : 0,
		identity.simulationReady ? 1 : 0,
		identity.counts.layoutBlocks,
		identity.counts.banks,
		identity.counts.bays,
		identity.counts.processLoops,
		identity.counts.organizationRecords,
		identity.counts.railCells,
		identity.counts.directedEdges,
		identity.counts.physicalPaths,
		identity.counts.junctions,
		identity.counts.advancedSwitches,
		identity.counts.ports,
		identity.counts.equipmentGroups,
		identity.counts.openTerminals,
		identity.counts.strongComponents,
		identity.bounds.minX,
		identity.bounds.minY,
		identity.bounds.maxX,
		identity.bounds.maxY,
	]);
	return `openfab-fab-prepared-project:v${OPENFAB_FAB_PREPARED_PROJECT_VERSION}:${checksum.digest()}`;
}

export function normalizeOpenFabFabPreparedProjectIdentity(
	value: unknown,
): OpenFabFabPreparedProjectIdentity {
	if (!isRecord(value) || !hasExactKeys(value, IDENTITY_KEYS)) {
		throw new Error("OpenFab prepared-project identity fields are malformed.");
	}
	if (!isRecord(value.counts) || !hasExactKeys(value.counts, COUNTS_KEYS)) {
		throw new Error("OpenFab prepared-project counts are malformed.");
	}
	if (!isRecord(value.bounds) || !hasExactKeys(value.bounds, BOUNDS_KEYS)) {
		throw new Error("OpenFab prepared-project bounds are malformed.");
	}
	if (
		value.kind !== OPENFAB_FAB_PREPARED_PROJECT_IDENTITY_KIND ||
		value.version !== OPENFAB_FAB_PREPARED_PROJECT_VERSION ||
		value.sequence !== 0 ||
		value.authoringReady !== true ||
		value.simulationReady !== false
	) {
		throw new Error("OpenFab prepared-project identity contract is invalid.");
	}
	for (const key of IDENTITY_STRING_KEYS) {
		if (typeof value[key] !== "string" || value[key].length === 0 || value[key].length > 512) {
			throw new Error(`OpenFab prepared-project identity ${key} is invalid.`);
		}
	}
	for (const key of IDENTITY_INTEGER_KEYS) {
		if (!isNonnegativeSafeInteger(value[key])) {
			throw new Error(`OpenFab prepared-project identity ${key} is invalid.`);
		}
	}
	if (
		!isPositiveSafeInteger(value.nextAdvancedSwitchId) ||
		!isPositiveSafeInteger(value.nextPortId) ||
		!isPositiveSafeInteger(value.nextEquipmentGroupId) ||
		!isPositiveSafeInteger(value.nextOrganizationId)
	) {
		throw new Error("OpenFab prepared-project cursors are invalid.");
	}
	for (const key of COUNTS_KEYS) {
		if (!isNonnegativeSafeInteger(value.counts[key])) {
			throw new Error(`OpenFab prepared-project count ${key} is invalid.`);
		}
	}
	const countValues = value.counts as unknown as OpenFabFabPreparedProjectCounts;
	if (
		countValues.layoutBlocks < 1 ||
		countValues.banks < 1 ||
		countValues.bays < 1 ||
		countValues.processLoops < 1 ||
		countValues.organizationRecords < 1 ||
		countValues.railCells < 1 ||
		countValues.directedEdges < 1 ||
		countValues.physicalPaths < 1 ||
		countValues.advancedSwitches !== 0 ||
		countValues.ports !== 0 ||
		countValues.equipmentGroups !== 0 ||
		countValues.openTerminals !== 0 ||
		countValues.strongComponents !== 1
	) {
		throw new Error("OpenFab prepared-project exact counts violate the v1 contract.");
	}
	for (const key of BOUNDS_KEYS) {
		if (!Number.isSafeInteger(value.bounds[key])) {
			throw new Error(`OpenFab prepared-project bound ${key} is invalid.`);
		}
	}
	const boundValues = value.bounds as unknown as OpenFabFabPreparedProjectBounds;
	if (boundValues.maxX <= boundValues.minX || boundValues.maxY <= boundValues.minY) {
		throw new Error("OpenFab prepared-project bounds are empty.");
	}

	const counts = Object.freeze({
		layoutBlocks: countValues.layoutBlocks,
		banks: countValues.banks,
		bays: countValues.bays,
		processLoops: countValues.processLoops,
		organizationRecords: countValues.organizationRecords,
		railCells: countValues.railCells,
		directedEdges: countValues.directedEdges,
		physicalPaths: countValues.physicalPaths,
		junctions: countValues.junctions,
		advancedSwitches: 0 as const,
		ports: 0 as const,
		equipmentGroups: 0 as const,
		openTerminals: 0 as const,
		strongComponents: 1 as const,
	});
	const bounds = Object.freeze({
		minX: boundValues.minX,
		minY: boundValues.minY,
		maxX: boundValues.maxX,
		maxY: boundValues.maxY,
	});
	const withoutFingerprint = Object.freeze({
		kind: OPENFAB_FAB_PREPARED_PROJECT_IDENTITY_KIND,
		version: OPENFAB_FAB_PREPARED_PROJECT_VERSION,
		requestFingerprint: value.requestFingerprint as string,
		profileFingerprint: value.profileFingerprint as string,
		profileDerivationContractFingerprint: value.profileDerivationContractFingerprint as string,
		profilePlanFingerprint: value.profilePlanFingerprint as string,
		assemblyLayoutContractFingerprint: value.assemblyLayoutContractFingerprint as string,
		assemblyPlanFingerprint: value.assemblyPlanFingerprint as string,
		compositionFingerprint: value.compositionFingerprint as string,
		childLinksFingerprint: value.childLinksFingerprint as string,
		stepLedgerFingerprint: value.stepLedgerFingerprint as string,
		organizationManifestFingerprint: value.organizationManifestFingerprint as string,
		organizationCompilationFingerprint: value.organizationCompilationFingerprint as string,
		organizationEdgeClaimFingerprint: value.organizationEdgeClaimFingerprint as string,
		organizationCertificationFingerprint: value.organizationCertificationFingerprint as string,
		authoredChecksum: value.authoredChecksum as string,
		authoredTopologyFingerprint: value.authoredTopologyFingerprint as string,
		authoredCertificateFingerprint: value.authoredCertificateFingerprint as string,
		physicalLayoutFingerprint: value.physicalLayoutFingerprint as string,
		physicalCertificateFingerprint: value.physicalCertificateFingerprint as string,
		readinessReportFingerprint: value.readinessReportFingerprint as string,
		readinessCertificateFingerprint: value.readinessCertificateFingerprint as string,
		codecProbePersistenceEvidenceFingerprint:
			value.codecProbePersistenceEvidenceFingerprint as string,
		codecProbeCanonicalJsonFingerprint: value.codecProbeCanonicalJsonFingerprint as string,
		codecProbeSnapshotIdentityFingerprint: value.codecProbeSnapshotIdentityFingerprint as string,
		sequence: 0 as const,
		revision: value.revision as number,
		nextAdvancedSwitchId: value.nextAdvancedSwitchId as number,
		nextPortId: value.nextPortId as number,
		nextEquipmentGroupId: value.nextEquipmentGroupId as number,
		nextOrganizationId: value.nextOrganizationId as number,
		authoringReady: true as const,
		simulationReady: false as const,
		counts,
		bounds,
	});
	const fingerprint = openFabFabPreparedProjectIdentityFingerprint(withoutFingerprint);
	if (value.fingerprint !== fingerprint) {
		throw new Error("OpenFab prepared-project identity fingerprint is invalid.");
	}
	return Object.freeze({ ...withoutFingerprint, fingerprint });
}

export function openFabFabPreparedProjectIdentitiesEqual(
	left: OpenFabFabPreparedProjectIdentity,
	right: OpenFabFabPreparedProjectIdentity,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function createOpenFabFabPreparedProjectAttestation(
	input: Readonly<{
		requestFingerprint: string;
		materializationFingerprint: string;
		snapshotChecksum: string;
		transferableBufferCount: number;
		transferableByteLength: number;
	}>,
): OpenFabFabPreparedProjectAttestation {
	const withoutFingerprint = Object.freeze({
		kind: OPENFAB_FAB_PREPARED_PROJECT_ATTESTATION_KIND,
		version: OPENFAB_FAB_PREPARED_PROJECT_VERSION,
		...input,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabPreparedProjectAttestationFingerprint(withoutFingerprint),
	});
}

export function openFabFabPreparedProjectAttestationFingerprint(
	attestation: Omit<OpenFabFabPreparedProjectAttestation, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		attestation.kind,
		attestation.requestFingerprint,
		attestation.materializationFingerprint,
		attestation.snapshotChecksum,
	]);
	checksum.addNumbers([
		attestation.version,
		attestation.transferableBufferCount,
		attestation.transferableByteLength,
	]);
	return `openfab-fab-prepared-project-attestation:v${OPENFAB_FAB_PREPARED_PROJECT_VERSION}:${checksum.digest()}`;
}

export function normalizeOpenFabFabPreparedProjectAttestation(
	value: unknown,
): OpenFabFabPreparedProjectAttestation {
	if (!isRecord(value) || !hasExactKeys(value, ATTESTATION_KEYS)) {
		throw new Error("OpenFab prepared-project attestation fields are malformed.");
	}
	if (
		value.kind !== OPENFAB_FAB_PREPARED_PROJECT_ATTESTATION_KIND ||
		value.version !== OPENFAB_FAB_PREPARED_PROJECT_VERSION ||
		!isBoundedString(value.requestFingerprint) ||
		!isBoundedString(value.materializationFingerprint) ||
		!isBoundedString(value.snapshotChecksum) ||
		!isPositiveSafeInteger(value.transferableBufferCount) ||
		!isPositiveSafeInteger(value.transferableByteLength) ||
		!isBoundedString(value.fingerprint)
	) {
		throw new Error("OpenFab prepared-project attestation is invalid.");
	}
	const withoutFingerprint = Object.freeze({
		kind: OPENFAB_FAB_PREPARED_PROJECT_ATTESTATION_KIND,
		version: OPENFAB_FAB_PREPARED_PROJECT_VERSION,
		requestFingerprint: value.requestFingerprint,
		materializationFingerprint: value.materializationFingerprint,
		snapshotChecksum: value.snapshotChecksum,
		transferableBufferCount: value.transferableBufferCount,
		transferableByteLength: value.transferableByteLength,
	});
	const fingerprint = openFabFabPreparedProjectAttestationFingerprint(withoutFingerprint);
	if (value.fingerprint !== fingerprint) {
		throw new Error("OpenFab prepared-project attestation fingerprint is invalid.");
	}
	return Object.freeze({ ...withoutFingerprint, fingerprint });
}

const IDENTITY_STRING_KEYS = Object.freeze([
	"requestFingerprint",
	"profileFingerprint",
	"profileDerivationContractFingerprint",
	"profilePlanFingerprint",
	"assemblyLayoutContractFingerprint",
	"assemblyPlanFingerprint",
	"compositionFingerprint",
	"childLinksFingerprint",
	"stepLedgerFingerprint",
	"organizationManifestFingerprint",
	"organizationCompilationFingerprint",
	"organizationEdgeClaimFingerprint",
	"organizationCertificationFingerprint",
	"authoredChecksum",
	"authoredTopologyFingerprint",
	"authoredCertificateFingerprint",
	"physicalLayoutFingerprint",
	"physicalCertificateFingerprint",
	"readinessReportFingerprint",
	"readinessCertificateFingerprint",
	"codecProbePersistenceEvidenceFingerprint",
	"codecProbeCanonicalJsonFingerprint",
	"codecProbeSnapshotIdentityFingerprint",
	"fingerprint",
] as const);

const IDENTITY_INTEGER_KEYS = Object.freeze(["revision"] as const);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isBoundedString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 512;
}
