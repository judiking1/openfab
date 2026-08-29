import {
	defaultSyntheticFabStarterRequest,
	SYNTHETIC_FAB_STARTER_VERSION,
	type SyntheticFabStarterRequest,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import {
	SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES,
	SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION,
} from "../compile/SyntheticFabStarterRouteGeometry";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { staticFabOrganizationBundleError } from "../core/StaticFabOrganizationBundle";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import {
	preparedSyntheticFabStarterMatchesIndependentPreparation,
	preparedSyntheticFabStarterMatchesRequest,
	preparedSyntheticFabStarterMaterializationFingerprint,
} from "./SyntheticFabStarterBridge";

export const SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID = "large-fab-60.default.v1" as const;
export const PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID =
	"paired-circulation-fab-52.default.v2" as const;
export const FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID = "full-fab-52.default.v1" as const;
export const CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID =
	"central-spine-fab-24.default.v1" as const;
export const PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID =
	"parallel-hall-fab-12.default.v1" as const;
export const PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID = "production-fab-60.default.v1" as const;
export const SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_TYPED_ARRAY_BYTES = 2 * 1024 * 1024;
export const SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES =
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES + 64 * 1024;
export const SYNTHETIC_FAB_STARTER_CERTIFICATION_ATTESTATION_SCHEMA_VERSION = 2 as const;

export type SyntheticFabStarterCertifiedArtifactId =
	| typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID
	| typeof PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID
	| typeof FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID
	| typeof PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID
	| typeof CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID
	| typeof PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID;

const CERTIFIED_PAYLOAD_KIND = "openfab-prepared-synthetic-fab-starter" as const;
const CERTIFICATION_CONTRACT = "independent-materialization-v1" as const;
const MAXIMUM_SERIALIZED_DEPTH = 32;
const MAXIMUM_SERIALIZED_NODES = 650_000;
const MAXIMUM_SERIALIZED_STRING_BYTES = 2 * 1024 * 1024;
const MAXIMUM_BUILD_STEPS = 256;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_DECODE = createBase64DecodeTable();
const HOST_IS_LITTLE_ENDIAN = (() => {
	const word = new Uint16Array([0x0102]);
	return new Uint8Array(word.buffer)[0] === 0x02;
})();
const CERTIFICATION_EVIDENCE_BRAND: unique symbol = Symbol("OpenFabCertifiedStarterEvidence");

type SupportedTypedArray =
	| Int8Array
	| Uint8Array
	| Uint16Array
	| Int32Array
	| Uint32Array
	| Float32Array
	| Float64Array;

type SupportedTypedArrayName =
	| "Int8Array"
	| "Uint8Array"
	| "Uint16Array"
	| "Int32Array"
	| "Uint32Array"
	| "Float32Array"
	| "Float64Array";

interface SerializedTypedArray {
	readonly $openfabTypedArray: SupportedTypedArrayName;
	readonly length: number;
	readonly byteLength: number;
	readonly base64: string;
}

type SerializedValue =
	| null
	| boolean
	| number
	| string
	| readonly SerializedValue[]
	| SerializedTypedArray
	| { readonly [key: string]: SerializedValue };

export interface SyntheticFabStarterCertifiedArtifact {
	readonly schemaVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION;
	readonly artifactId: SyntheticFabStarterCertifiedArtifactId;
	readonly payloadKind: typeof CERTIFIED_PAYLOAD_KIND;
	readonly certificationContract: typeof CERTIFICATION_CONTRACT;
	readonly starterVersion: typeof SYNTHETIC_FAB_STARTER_VERSION;
	readonly routeGeometrySchemaVersion: typeof SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION;
	readonly requestFingerprint: string;
	readonly materializationFingerprint: string;
	readonly payloadChecksum: string;
	readonly certificationChecksum: string;
	readonly payloadByteLength: number;
	readonly typedArrayByteLength: number;
	readonly payload: SerializedValue;
}

export interface SyntheticFabStarterCertificationEvidence {
	readonly artifactId: SyntheticFabStarterCertifiedArtifactId;
	readonly certificationFingerprint: string;
	readonly [CERTIFICATION_EVIDENCE_BRAND]: true;
}

export interface HydratedCertifiedSyntheticFabStarter {
	readonly prepared: PreparedSyntheticFabStarter;
	readonly evidence: SyntheticFabStarterCertificationEvidence;
}

/**
 * Serializable evidence emitted by the hydration Worker. This is deliberately not certification
 * evidence: the main realm must validate it and bind a fresh symbol/WeakMap-backed capability.
 */
export interface SyntheticFabStarterCertificationAttestation {
	readonly schemaVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFICATION_ATTESTATION_SCHEMA_VERSION;
	readonly artifactSchemaVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION;
	readonly artifactId: SyntheticFabStarterCertifiedArtifactId;
	readonly payloadKind: typeof CERTIFIED_PAYLOAD_KIND;
	readonly certificationContract: typeof CERTIFICATION_CONTRACT;
	readonly starterVersion: typeof SYNTHETIC_FAB_STARTER_VERSION;
	readonly routeGeometrySchemaVersion: typeof SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION;
	readonly requestFingerprint: string;
	readonly materializationFingerprint: string;
	readonly payloadChecksum: string;
	readonly certificationChecksum: string;
	readonly payloadByteLength: number;
	readonly typedArrayByteLength: number;
	readonly transferredTypedArrayFingerprint: string;
}

export interface TransferableHydratedCertifiedSyntheticFabStarter {
	readonly prepared: PreparedSyntheticFabStarter;
	readonly attestation: SyntheticFabStarterCertificationAttestation;
}

interface ValidatedCertifiedSyntheticFabStarter {
	readonly artifact: SyntheticFabStarterCertifiedArtifact;
	readonly prepared: PreparedSyntheticFabStarter;
}

interface SerializationBudget {
	depth: number;
	nodes: number;
	stringBytes: number;
	typedArrayBytes: number;
}

interface CertificationEvidenceState {
	readonly requestFingerprint: string;
	readonly materializationFingerprint: string;
	readonly transferredTypedArrayFingerprint: string;
	readonly prepared: PreparedSyntheticFabStarter;
}

interface CertifiedStarterSpecification {
	readonly requestId:
		| "large-fab-60"
		| "paired-circulation-fab-52"
		| "full-fab-52"
		| "parallel-hall-fab-12"
		| "central-spine-fab-24"
		| "production-fab-60";
	readonly artifactId: SyntheticFabStarterCertifiedArtifactId;
}

const LEGACY_LARGE_FAB_CERTIFIED_SPECIFICATION = Object.freeze({
	requestId: "large-fab-60",
	artifactId: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
}) satisfies CertifiedStarterSpecification;

const PAIRED_CIRCULATION_FAB_CERTIFIED_SPECIFICATION = Object.freeze({
	requestId: "paired-circulation-fab-52",
	artifactId: PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
}) satisfies CertifiedStarterSpecification;

const FULL_FAB_CERTIFIED_SPECIFICATION = Object.freeze({
	requestId: "full-fab-52",
	artifactId: FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
}) satisfies CertifiedStarterSpecification;

const PRODUCTION_FAB_CERTIFIED_SPECIFICATION = Object.freeze({
	requestId: "production-fab-60",
	artifactId: PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
}) satisfies CertifiedStarterSpecification;

const CENTRAL_SPINE_FAB_CERTIFIED_SPECIFICATION = Object.freeze({
	requestId: "central-spine-fab-24",
	artifactId: CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
}) satisfies CertifiedStarterSpecification;

const PARALLEL_HALL_FAB_CERTIFIED_SPECIFICATION = Object.freeze({
	requestId: "parallel-hall-fab-12",
	artifactId: PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID,
}) satisfies CertifiedStarterSpecification;

const certificationEvidenceStates = new WeakMap<object, CertificationEvidenceState>();

export function isDefaultLargeFabCertifiedRequest(request: SyntheticFabStarterRequest): boolean {
	return requestMatchesExactDefault(request, "large-fab-60");
}

export function isDefaultFullFabCertifiedRequest(request: SyntheticFabStarterRequest): boolean {
	return requestMatchesExactDefault(request, "full-fab-52");
}

export function isDefaultPairedCirculationFabCertifiedRequest(
	request: SyntheticFabStarterRequest,
): boolean {
	return requestMatchesExactDefault(request, "paired-circulation-fab-52");
}

export function isDefaultProductionFabCertifiedRequest(
	request: SyntheticFabStarterRequest,
): boolean {
	return requestMatchesExactDefault(request, "production-fab-60");
}

export function isDefaultCentralSpineFabCertifiedRequest(
	request: SyntheticFabStarterRequest,
): boolean {
	return requestMatchesExactDefault(request, "central-spine-fab-24");
}

export function isDefaultParallelHallFabCertifiedRequest(
	request: SyntheticFabStarterRequest,
): boolean {
	return requestMatchesExactDefault(request, "parallel-hall-fab-12");
}

export function isDefaultSyntheticFabCertifiedRequest(
	request: SyntheticFabStarterRequest,
): boolean {
	return certifiedSpecificationForRequest(request) !== null;
}

export function syntheticFabStarterCertifiedArtifactIdForRequest(
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterCertifiedArtifactId | null {
	return certifiedSpecificationForRequest(request)?.artifactId ?? null;
}

function certifiedSpecificationForRequest(
	request: SyntheticFabStarterRequest,
): CertifiedStarterSpecification | null {
	if (requestMatchesExactDefault(request, "paired-circulation-fab-52")) {
		return PAIRED_CIRCULATION_FAB_CERTIFIED_SPECIFICATION;
	}
	if (requestMatchesExactDefault(request, "full-fab-52")) {
		return FULL_FAB_CERTIFIED_SPECIFICATION;
	}
	if (requestMatchesExactDefault(request, "large-fab-60")) {
		return LEGACY_LARGE_FAB_CERTIFIED_SPECIFICATION;
	}
	if (requestMatchesExactDefault(request, "production-fab-60")) {
		return PRODUCTION_FAB_CERTIFIED_SPECIFICATION;
	}
	if (requestMatchesExactDefault(request, "central-spine-fab-24")) {
		return CENTRAL_SPINE_FAB_CERTIFIED_SPECIFICATION;
	}
	if (requestMatchesExactDefault(request, "parallel-hall-fab-12")) {
		return PARALLEL_HALL_FAB_CERTIFIED_SPECIFICATION;
	}
	return null;
}

function requestMatchesExactDefault(
	request: SyntheticFabStarterRequest,
	id: CertifiedStarterSpecification["requestId"],
): boolean {
	try {
		const expected = defaultSyntheticFabStarterRequest(id);
		return (
			request.version === expected.version &&
			request.id === expected.id &&
			request.parameters.aisleLengthMeters === expected.parameters.aisleLengthMeters &&
			request.parameters.laneSpacingMeters === expected.parameters.laneSpacingMeters &&
			request.parameters.bayCount === expected.parameters.bayCount &&
			request.parameters.bayPitchMeters === expected.parameters.bayPitchMeters &&
			request.parameters.outerbayDepthMeters === expected.parameters.outerbayDepthMeters &&
			request.parameters.processBlockCount === expected.parameters.processBlockCount
		);
	} catch {
		return false;
	}
}

function isCertifiedArtifactId(value: unknown): value is SyntheticFabStarterCertifiedArtifactId {
	return (
		value === SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_ID ||
		value === PAIRED_CIRCULATION_FAB_STARTER_CERTIFIED_ARTIFACT_ID ||
		value === FULL_FAB_STARTER_CERTIFIED_ARTIFACT_ID ||
		value === PARALLEL_HALL_FAB_STARTER_CERTIFIED_ARTIFACT_ID ||
		value === CENTRAL_SPINE_FAB_STARTER_CERTIFIED_ARTIFACT_ID ||
		value === PRODUCTION_FAB_STARTER_CERTIFIED_ARTIFACT_ID
	);
}

/**
 * Build-time certification requires two separately materialized, byte-independent preparations.
 * Runtime callers should consume generated JSON through the hydrator instead.
 */
export function createSyntheticFabStarterCertifiedArtifact(
	prepared: PreparedSyntheticFabStarter,
	independent: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest = defaultSyntheticFabStarterRequest("large-fab-60"),
): SyntheticFabStarterCertifiedArtifact {
	const specification = assertDefaultCertifiedRequest(request);
	if (prepared === independent) {
		throw new Error("Certified starter generation requires an independent preparation object.");
	}
	assertIndependentPreparedBuffers(prepared, independent);
	if (!preparedSyntheticFabStarterMatchesIndependentPreparation(prepared, independent, request)) {
		throw new Error("Independent starter preparations do not match.");
	}
	assertCertifiedPreparedContract(prepared, request);
	assertCertifiedPreparedContract(independent, request);

	const budget = createSerializationBudget();
	const payload = serializeValue(prepared, budget);
	const payloadText = JSON.stringify(payload);
	const payloadByteLength = utf8ByteLength(payloadText);
	assertArtifactSize(payloadByteLength, budget.typedArrayBytes);
	const requestFingerprint = syntheticFabStarterRequestFingerprint(request);
	const materializationFingerprint =
		preparedSyntheticFabStarterMaterializationFingerprint(prepared);
	const payloadChecksum = checksumPayload(payloadText);
	const certificationChecksum = checksumCertification({
		artifactId: specification.artifactId,
		requestFingerprint,
		materializationFingerprint,
		payloadChecksum,
		payloadByteLength,
		typedArrayByteLength: budget.typedArrayBytes,
	});

	return Object.freeze({
		schemaVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION,
		artifactId: specification.artifactId,
		payloadKind: CERTIFIED_PAYLOAD_KIND,
		certificationContract: CERTIFICATION_CONTRACT,
		starterVersion: SYNTHETIC_FAB_STARTER_VERSION,
		routeGeometrySchemaVersion: SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION,
		requestFingerprint,
		materializationFingerprint,
		payloadChecksum,
		certificationChecksum,
		payloadByteLength,
		typedArrayByteLength: budget.typedArrayBytes,
		payload,
	});
}

function assertIndependentPreparedBuffers(
	prepared: PreparedSyntheticFabStarter,
	independent: PreparedSyntheticFabStarter,
): void {
	const preparedViews = collectPreparedTypedViews(prepared);
	const independentViews = collectPreparedTypedViews(independent);
	if (preparedViews.size === 0 || preparedViews.size !== independentViews.size) {
		throw new Error("Independent starter preparations have different typed-array shapes.");
	}
	const preparedBuffers = new Set([...preparedViews.values()].map((view) => view.buffer));
	for (const [path, preparedView] of preparedViews) {
		const independentView = independentViews.get(path);
		if (
			!independentView ||
			independentView.constructor !== preparedView.constructor ||
			independentView.byteLength !== preparedView.byteLength ||
			preparedBuffers.has(independentView.buffer)
		) {
			throw new Error(
				`Independent starter preparations must not share typed-array buffers (${path}).`,
			);
		}
	}
}

function collectPreparedTypedViews(value: unknown): Map<string, ArrayBufferView> {
	const views = new Map<string, ArrayBufferView>();
	visitPreparedTypedViews(value, "$", views, new WeakSet<object>());
	return views;
}

function preparedTypedArrayFingerprint(prepared: PreparedSyntheticFabStarter): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["synthetic-fab-transferred-typed-arrays-v1"]);
	checksum.addViews([...collectPreparedTypedViews(prepared).values()]);
	return checksum.digest();
}

async function preparedTypedArrayFingerprintCooperatively(
	prepared: PreparedSyntheticFabStarter,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["synthetic-fab-transferred-typed-arrays-v1"]);
	await checksum.addViewsCooperatively(
		[...collectPreparedTypedViews(prepared).values()],
		checkpoint,
		32 * 1024,
	);
	await checkpoint();
	return checksum.digest();
}

function visitPreparedTypedViews(
	value: unknown,
	path: string,
	views: Map<string, ArrayBufferView>,
	visited: WeakSet<object>,
): void {
	if (ArrayBuffer.isView(value)) {
		views.set(path, value);
		return;
	}
	if (typeof value !== "object" || value === null || visited.has(value)) return;
	visited.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			visitPreparedTypedViews(value[index], `${path}[${index}]`, views, visited);
		}
		return;
	}
	for (const key of Object.keys(value).sort()) {
		visitPreparedTypedViews(
			(value as Readonly<Record<string, unknown>>)[key],
			`${path}.${key}`,
			views,
			visited,
		);
	}
}

/**
 * Fail-closed hydration for shipped data. Every successful call owns new ArrayBuffers.
 */
export function hydrateSyntheticFabStarterCertifiedArtifact(
	value: unknown,
	request: SyntheticFabStarterRequest = defaultSyntheticFabStarterRequest("large-fab-60"),
): HydratedCertifiedSyntheticFabStarter | null {
	const validated = validateAndHydrateCertifiedArtifact(value, request);
	if (!validated) return null;
	return Object.freeze({
		prepared: validated.prepared,
		evidence: createCertificationEvidence(validated.artifact, validated.prepared),
	});
}

/** Parse and hydrate an immutable artifact entirely inside a disposable Worker realm. */
export function hydrateSyntheticFabStarterCertifiedArtifactForTransfer(
	source: string,
	request: SyntheticFabStarterRequest,
): TransferableHydratedCertifiedSyntheticFabStarter | null {
	try {
		if (
			typeof source !== "string" ||
			utf8ByteLength(source) > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_SOURCE_BYTES
		) {
			return null;
		}
		const validated = validateAndHydrateCertifiedArtifact(JSON.parse(source) as unknown, request);
		if (!validated) return null;
		return Object.freeze({
			prepared: validated.prepared,
			attestation: createCertificationAttestation(validated.artifact, validated.prepared),
		});
	} catch {
		return null;
	}
}

/**
 * Rebind a transferred preparation to a main-realm certification capability. A structured-cloned
 * attestation alone is never accepted as evidence.
 */
export function rebindSyntheticFabStarterCertificationEvidence(
	prepared: PreparedSyntheticFabStarter,
	value: unknown,
	request: SyntheticFabStarterRequest,
): HydratedCertifiedSyntheticFabStarter | null {
	try {
		const attestation = validateTransferredCertificationPrelude(prepared, value, request);
		if (preparedTypedArrayFingerprint(prepared) !== attestation.transferredTypedArrayFingerprint) {
			throw new Error("Transferred certified starter typed buffers do not match.");
		}
		return bindTransferredCertificationEvidence(prepared, attestation);
	} catch {
		return null;
	}
}

/** Cooperative browser-path rebinding; opaque evidence is issued only after every byte matches. */
export async function rebindSyntheticFabStarterCertificationEvidenceCooperatively(
	prepared: PreparedSyntheticFabStarter,
	value: unknown,
	request: SyntheticFabStarterRequest,
	checkpoint: () => Promise<void>,
): Promise<HydratedCertifiedSyntheticFabStarter | null> {
	try {
		const attestation = validateTransferredCertificationPrelude(prepared, value, request);
		if (
			(await preparedTypedArrayFingerprintCooperatively(prepared, checkpoint)) !==
			attestation.transferredTypedArrayFingerprint
		) {
			throw new Error("Transferred certified starter typed buffers do not match.");
		}
		return bindTransferredCertificationEvidence(prepared, attestation);
	} catch {
		return null;
	}
}

function validateTransferredCertificationPrelude(
	prepared: PreparedSyntheticFabStarter,
	value: unknown,
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterCertificationAttestation {
	const specification = assertDefaultCertifiedRequest(request);
	const attestation = parseCertificationAttestation(value);
	const expectedRequestFingerprint = syntheticFabStarterRequestFingerprint(request);
	if (
		attestation.artifactId !== specification.artifactId ||
		attestation.requestFingerprint !== expectedRequestFingerprint ||
		prepared.requestFingerprint !== expectedRequestFingerprint
	) {
		throw new Error("Transferred certified starter identity does not match its request.");
	}
	if (
		checksumCertification({
			artifactId: attestation.artifactId,
			requestFingerprint: attestation.requestFingerprint,
			materializationFingerprint: attestation.materializationFingerprint,
			payloadChecksum: attestation.payloadChecksum,
			payloadByteLength: attestation.payloadByteLength,
			typedArrayByteLength: attestation.typedArrayByteLength,
		}) !== attestation.certificationChecksum
	) {
		throw new Error("Transferred certified starter attestation checksum does not match.");
	}
	assertTransferredPreparedBuffers(prepared, attestation.typedArrayByteLength);
	deepFreezeContainers(prepared);
	// The disposable same-origin Worker already performed strict shape, request, topology,
	// organization, and certification-contract validation before transferring this graph. The main
	// realm validates buffer ownership and identity without repeating those full domain walks.
	if (
		preparedSyntheticFabStarterMaterializationFingerprint(prepared) !==
		attestation.materializationFingerprint
	) {
		throw new Error("Transferred certified starter materialization does not match.");
	}
	return attestation;
}

function bindTransferredCertificationEvidence(
	prepared: PreparedSyntheticFabStarter,
	attestation: SyntheticFabStarterCertificationAttestation,
): HydratedCertifiedSyntheticFabStarter {
	return Object.freeze({
		prepared,
		evidence: createCertificationEvidenceFromIdentity(
			attestation.artifactId,
			attestation.certificationChecksum,
			attestation.requestFingerprint,
			attestation.materializationFingerprint,
			attestation.transferredTypedArrayFingerprint,
			prepared,
		),
	});
}

function validateAndHydrateCertifiedArtifact(
	value: unknown,
	request: SyntheticFabStarterRequest,
): ValidatedCertifiedSyntheticFabStarter | null {
	try {
		const specification = assertDefaultCertifiedRequest(request);
		const artifact = parseArtifactEnvelope(value);
		if (artifact.artifactId !== specification.artifactId) {
			throw new Error("Certified starter artifact does not match the requested preset.");
		}
		const expectedRequestFingerprint = syntheticFabStarterRequestFingerprint(request);
		if (artifact.requestFingerprint !== expectedRequestFingerprint) {
			throw new Error("Certified starter request fingerprint does not match.");
		}
		const payloadText = JSON.stringify(artifact.payload);
		const payloadByteLength = utf8ByteLength(payloadText);
		if (
			payloadByteLength !== artifact.payloadByteLength ||
			payloadByteLength > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES ||
			checksumPayload(payloadText) !== artifact.payloadChecksum
		) {
			throw new Error("Certified starter payload identity does not match.");
		}
		if (
			checksumCertification({
				artifactId: artifact.artifactId,
				requestFingerprint: artifact.requestFingerprint,
				materializationFingerprint: artifact.materializationFingerprint,
				payloadChecksum: artifact.payloadChecksum,
				payloadByteLength: artifact.payloadByteLength,
				typedArrayByteLength: artifact.typedArrayByteLength,
			}) !== artifact.certificationChecksum
		) {
			throw new Error("Certified starter evidence checksum does not match.");
		}

		const budget = createSerializationBudget();
		const decoded = deserializeValue(artifact.payload, budget);
		if (budget.typedArrayBytes !== artifact.typedArrayByteLength) {
			throw new Error("Certified starter typed-array byte count does not match.");
		}
		// Freeze the decoded container graph before structural validation. Large FAB placement
		// bundles are validated and fingerprinted several times by the fail-closed contract;
		// immutable containers let those checks safely reuse their WeakMap/WeakSet evidence.
		deepFreezeContainers(decoded);
		assertStrictPreparedShape(decoded);
		const prepared = decoded as unknown as PreparedSyntheticFabStarter;
		if (!preparedSyntheticFabStarterMatchesRequest(prepared, request)) {
			throw new Error("Certified starter does not satisfy the prepared-project contract.");
		}
		assertCertifiedPreparedContract(prepared, request);
		if (
			preparedSyntheticFabStarterMaterializationFingerprint(prepared) !==
			artifact.materializationFingerprint
		) {
			throw new Error("Certified starter materialization fingerprint does not match.");
		}
		return Object.freeze({ artifact, prepared });
	} catch {
		return null;
	}
}

export function isSyntheticFabStarterCertificationEvidence(
	value: unknown,
): value is SyntheticFabStarterCertificationEvidence {
	return typeof value === "object" && value !== null && certificationEvidenceStates.has(value);
}

/**
 * Cheap render-time identity check for evidence produced by successful fail-closed hydration.
 * Mutation-sensitive fingerprint verification still runs at the project activation boundary.
 */
export function certificationEvidenceBindsPreparedIdentity(
	evidence: SyntheticFabStarterCertificationEvidence,
	prepared: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): boolean {
	const state = certificationEvidenceStates.get(evidence);
	return (
		state?.prepared === prepared &&
		isDefaultSyntheticFabCertifiedRequest(request) &&
		state.requestFingerprint === syntheticFabStarterRequestFingerprint(request) &&
		prepared.requestFingerprint === state.requestFingerprint
	);
}

export function certificationEvidenceMatchesPrepared(
	evidence: SyntheticFabStarterCertificationEvidence,
	prepared: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): boolean {
	const state = certificationEvidenceStates.get(evidence);
	if (!state || state.prepared !== prepared || !isDefaultSyntheticFabCertifiedRequest(request)) {
		return false;
	}
	return (
		state.requestFingerprint === syntheticFabStarterRequestFingerprint(request) &&
		state.materializationFingerprint ===
			preparedSyntheticFabStarterMaterializationFingerprint(prepared) &&
		state.transferredTypedArrayFingerprint === preparedTypedArrayFingerprint(prepared) &&
		preparedSyntheticFabStarterMatchesRequest(prepared, request)
	);
}

/** Mutation-sensitive activation check that never monopolizes the browser main thread. */
export async function certificationEvidenceMatchesPreparedCooperatively(
	evidence: SyntheticFabStarterCertificationEvidence,
	prepared: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
	checkpoint: () => Promise<void>,
): Promise<boolean> {
	const state = certificationEvidenceStates.get(evidence);
	if (!state || state.prepared !== prepared || !isDefaultSyntheticFabCertifiedRequest(request)) {
		return false;
	}
	try {
		if (state.requestFingerprint !== syntheticFabStarterRequestFingerprint(request)) {
			return false;
		}
		// Every non-typed container was recursively frozen when evidence was bound, so only typed
		// buffers can change between preview hydration and activation. Recomputing the full
		// materialization fingerprint here would synchronously walk the same large immutable graph.
		return (
			state.transferredTypedArrayFingerprint ===
			(await preparedTypedArrayFingerprintCooperatively(prepared, checkpoint))
		);
	} catch {
		return false;
	}
}

function assertDefaultCertifiedRequest(
	request: SyntheticFabStarterRequest,
): CertifiedStarterSpecification {
	const specification = certifiedSpecificationForRequest(request);
	if (!specification) {
		throw new Error("Only exact default certified FAB preset requests have shipped artifacts.");
	}
	return specification;
}

function assertCertifiedPreparedContract(
	prepared: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): void {
	if (!preparedSyntheticFabStarterMatchesRequest(prepared, request)) {
		throw new Error("Prepared starter does not match the exact certified request.");
	}
	const commonContract =
		prepared.requestFingerprint === syntheticFabStarterRequestFingerprint(request) &&
		prepared.authoringReady === true &&
		prepared.geometry === null &&
		prepared.summary.bayCount === request.parameters.bayCount &&
		prepared.summary.openTerminals === 0 &&
		prepared.summary.strongComponents === 1;
	if (!commonContract) {
		throw new Error("Prepared starter does not satisfy shared certification invariants.");
	}
	if (request.id === "paired-circulation-fab-52") {
		const processBaySteps = prepared.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = prepared.steps.filter((step) => step.hierarchyRole === "process-loop");
		const outerSteps = prepared.steps.filter((step) => step.hierarchyRole === "outer-circulation");
		const turnbackSteps = prepared.steps.filter((step) => step.kind === "paired-turnback");
		const interbaySteps = prepared.steps.filter((step) => step.hierarchyRole === "interbay-spine");
		const gatewaySteps = prepared.steps.filter((step) => step.hierarchyRole === "network-link");
		if (
			prepared.request.id !== "paired-circulation-fab-52" ||
			prepared.planFingerprint === null ||
			prepared.exactGeometry !== null ||
			prepared.summary.zoneCount !== 4 ||
			prepared.summary.railCells !== 33_663 ||
			prepared.summary.directedEdges !== 33_864 ||
			prepared.summary.physicalPaths !== 34_065 ||
			prepared.steps.length !== 201 ||
			outerSteps.length !== 4 ||
			turnbackSteps.length !== 2 ||
			interbaySteps.length !== 2 ||
			processBaySteps.length !== 52 ||
			new Set(processBaySteps.map((step) => step.entityId)).size !== 52 ||
			processLoopSteps.length !== 87 ||
			new Set(processLoopSteps.map((step) => step.entityId)).size !== 87 ||
			gatewaySteps.length !== 56 ||
			prepared.snapshot.organizations.organizationIds.length !== 144 ||
			prepared.snapshot.organizations.nextOrganizationId !== 145 ||
			prepared.placementBundle === null ||
			prepared.placementBundleFingerprint === null
		) {
			throw new Error(
				"Prepared starter does not satisfy fixed Paired-Circulation FAB certification invariants.",
			);
		}
		return;
	}
	if (request.id === "full-fab-52") {
		const processBaySteps = prepared.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = prepared.steps.filter((step) => step.hierarchyRole === "process-loop");
		const bankSteps = prepared.steps.filter((step) => step.hierarchyRole === "bay-bank");
		const gatewaySteps = prepared.steps.filter((step) => step.hierarchyRole === "network-link");
		if (
			prepared.request.id !== "full-fab-52" ||
			prepared.planFingerprint === null ||
			prepared.exactGeometry !== null ||
			prepared.summary.zoneCount !== 4 ||
			prepared.steps.length !== 171 ||
			processBaySteps.length !== 52 ||
			new Set(processBaySteps.map((step) => step.entityId)).size !== 52 ||
			processLoopSteps.length !== 104 ||
			new Set(processLoopSteps.map((step) => step.entityId)).size !== 104 ||
			bankSteps.length !== 4 ||
			gatewaySteps.length !== 8 ||
			prepared.snapshot.organizations.organizationIds.length !== 161 ||
			prepared.snapshot.organizations.nextOrganizationId !== 162 ||
			prepared.placementBundle === null ||
			prepared.placementBundleFingerprint === null
		) {
			throw new Error("Prepared starter does not satisfy fixed Full FAB certification invariants.");
		}
		return;
	}
	if (request.id === "production-fab-60") {
		const processBaySteps = prepared.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = prepared.steps.filter((step) => step.hierarchyRole === "process-loop");
		const bankSteps = prepared.steps.filter((step) => step.hierarchyRole === "bay-bank");
		if (
			prepared.request.id !== "production-fab-60" ||
			prepared.planFingerprint === null ||
			prepared.exactGeometry !== null ||
			prepared.summary.zoneCount !== 3 ||
			prepared.steps.length !== 185 ||
			processBaySteps.length !== 60 ||
			new Set(processBaySteps.map((step) => step.entityId)).size !== 60 ||
			processLoopSteps.length !== 120 ||
			new Set(processLoopSteps.map((step) => step.entityId)).size !== 120 ||
			bankSteps.length !== 3 ||
			prepared.snapshot.organizations.organizationIds.length !== 184 ||
			prepared.snapshot.organizations.nextOrganizationId !== 185 ||
			prepared.placementBundle === null ||
			prepared.placementBundleFingerprint === null
		) {
			throw new Error(
				"Prepared starter does not satisfy fixed Production FAB certification invariants.",
			);
		}
		return;
	}
	if (request.id === "central-spine-fab-24") {
		const processBaySteps = prepared.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = prepared.steps.filter((step) => step.hierarchyRole === "process-loop");
		if (
			prepared.request.id !== "central-spine-fab-24" ||
			prepared.planFingerprint === null ||
			prepared.exactGeometry !== null ||
			prepared.summary.zoneCount !== 2 ||
			prepared.steps.length !== 74 ||
			processBaySteps.length !== 24 ||
			processLoopSteps.length !== 48 ||
			prepared.snapshot.organizations.organizationIds.length !== 73 ||
			prepared.placementBundle === null ||
			prepared.placementBundleFingerprint === null
		) {
			throw new Error(
				"Prepared starter does not satisfy fixed Central Spine FAB certification invariants.",
			);
		}
		return;
	}
	if (request.id === "parallel-hall-fab-12") {
		const processBaySteps = prepared.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = prepared.steps.filter((step) => step.hierarchyRole === "process-loop");
		const bankSteps = prepared.steps.filter((step) => step.hierarchyRole === "bay-bank");
		if (
			prepared.request.id !== "parallel-hall-fab-12" ||
			prepared.planFingerprint === null ||
			prepared.exactGeometry !== null ||
			prepared.summary.zoneCount !== 2 ||
			prepared.steps.length !== 44 ||
			processBaySteps.length !== 12 ||
			processLoopSteps.length !== 24 ||
			bankSteps.length !== 2 ||
			prepared.snapshot.organizations.organizationIds.length !== 39 ||
			prepared.placementBundle === null ||
			prepared.placementBundleFingerprint === null
		) {
			throw new Error(
				"Prepared starter does not satisfy fixed Parallel Hall FAB certification invariants.",
			);
		}
		return;
	}
	if (
		prepared.request.id !== "large-fab-60" ||
		prepared.exactGeometry === null ||
		prepared.exactGeometry.byteLength > SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES ||
		prepared.summary.zoneCount !== request.parameters.processBlockCount * 4
	) {
		throw new Error("Prepared starter does not satisfy fixed Large FAB certification invariants.");
	}
}

function parseArtifactEnvelope(value: unknown): SyntheticFabStarterCertifiedArtifact {
	const artifact = assertExactRecord(
		value,
		[
			"schemaVersion",
			"artifactId",
			"payloadKind",
			"certificationContract",
			"starterVersion",
			"routeGeometrySchemaVersion",
			"requestFingerprint",
			"materializationFingerprint",
			"payloadChecksum",
			"certificationChecksum",
			"payloadByteLength",
			"typedArrayByteLength",
			"payload",
		],
		"Certified starter artifact",
	);
	if (
		artifact.schemaVersion !== SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION ||
		!isCertifiedArtifactId(artifact.artifactId) ||
		artifact.payloadKind !== CERTIFIED_PAYLOAD_KIND ||
		artifact.certificationContract !== CERTIFICATION_CONTRACT ||
		artifact.starterVersion !== SYNTHETIC_FAB_STARTER_VERSION ||
		artifact.routeGeometrySchemaVersion !== SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION ||
		typeof artifact.requestFingerprint !== "string" ||
		typeof artifact.materializationFingerprint !== "string" ||
		typeof artifact.payloadChecksum !== "string" ||
		typeof artifact.certificationChecksum !== "string" ||
		!isBoundedNonnegativeInteger(
			artifact.payloadByteLength,
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES,
		) ||
		!isBoundedNonnegativeInteger(
			artifact.typedArrayByteLength,
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_TYPED_ARRAY_BYTES,
		)
	) {
		throw new Error("Certified starter artifact envelope is invalid.");
	}
	return artifact as unknown as SyntheticFabStarterCertifiedArtifact;
}

function parseCertificationAttestation(
	value: unknown,
): SyntheticFabStarterCertificationAttestation {
	const attestation = assertExactRecord(
		value,
		[
			"schemaVersion",
			"artifactSchemaVersion",
			"artifactId",
			"payloadKind",
			"certificationContract",
			"starterVersion",
			"routeGeometrySchemaVersion",
			"requestFingerprint",
			"materializationFingerprint",
			"payloadChecksum",
			"certificationChecksum",
			"payloadByteLength",
			"typedArrayByteLength",
			"transferredTypedArrayFingerprint",
		],
		"Certified starter attestation",
	);
	if (
		attestation.schemaVersion !== SYNTHETIC_FAB_STARTER_CERTIFICATION_ATTESTATION_SCHEMA_VERSION ||
		attestation.artifactSchemaVersion !== SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION ||
		!isCertifiedArtifactId(attestation.artifactId) ||
		attestation.payloadKind !== CERTIFIED_PAYLOAD_KIND ||
		attestation.certificationContract !== CERTIFICATION_CONTRACT ||
		attestation.starterVersion !== SYNTHETIC_FAB_STARTER_VERSION ||
		attestation.routeGeometrySchemaVersion !==
			SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION ||
		typeof attestation.requestFingerprint !== "string" ||
		typeof attestation.materializationFingerprint !== "string" ||
		typeof attestation.payloadChecksum !== "string" ||
		typeof attestation.certificationChecksum !== "string" ||
		typeof attestation.transferredTypedArrayFingerprint !== "string" ||
		!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(attestation.transferredTypedArrayFingerprint) ||
		!isBoundedNonnegativeInteger(
			attestation.payloadByteLength,
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES,
		) ||
		!isBoundedNonnegativeInteger(
			attestation.typedArrayByteLength,
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_TYPED_ARRAY_BYTES,
		)
	) {
		throw new Error("Certified starter attestation is invalid.");
	}
	return attestation as unknown as SyntheticFabStarterCertificationAttestation;
}

function assertTransferredPreparedBuffers(
	prepared: PreparedSyntheticFabStarter,
	expectedByteLength: number,
): void {
	const views = collectPreparedTypedViews(prepared);
	const buffers = new Set<ArrayBuffer>();
	let byteLength = 0;
	for (const view of views.values()) {
		if (
			!isSupportedTypedArray(view) ||
			!(view.buffer instanceof ArrayBuffer) ||
			view.byteOffset !== 0 ||
			view.byteLength !== view.buffer.byteLength ||
			buffers.has(view.buffer)
		) {
			throw new Error("Transferred certified starter buffers are not independently owned.");
		}
		buffers.add(view.buffer);
		byteLength += view.byteLength;
	}
	if (views.size === 0 || !Number.isSafeInteger(byteLength) || byteLength !== expectedByteLength) {
		throw new Error("Transferred certified starter buffer byte count does not match.");
	}
}

function isSupportedTypedArray(value: ArrayBufferView): value is SupportedTypedArray {
	return (
		value instanceof Int8Array ||
		value instanceof Uint8Array ||
		value instanceof Uint16Array ||
		value instanceof Int32Array ||
		value instanceof Uint32Array ||
		value instanceof Float32Array ||
		value instanceof Float64Array
	);
}

function assertStrictPreparedShape(value: unknown): void {
	const prepared = assertExactRecord(
		value,
		[
			"request",
			"requestFingerprint",
			"planFingerprint",
			"summary",
			"steps",
			"authoredChecksum",
			"authoredRevision",
			"analysisFingerprint",
			"physicalFingerprint",
			"readinessFingerprint",
			"authoringReady",
			"snapshot",
			"placementBundle",
			"placementBundleFingerprint",
			"geometry",
			"exactGeometry",
		],
		"Prepared starter",
	);
	assertRequestShape(prepared.request);
	assertSummaryShape(prepared.summary);
	assertStepsShape(prepared.steps);
	assertSnapshotShape(prepared.snapshot);
	if (prepared.placementBundle === null || prepared.placementBundleFingerprint === null) {
		if (prepared.placementBundle !== null || prepared.placementBundleFingerprint !== null) {
			throw new Error("Prepared starter placement bundle identity is incomplete.");
		}
	} else if (
		typeof prepared.placementBundleFingerprint !== "string" ||
		staticFabOrganizationBundleError(prepared.placementBundle) !== null ||
		staticFabOrganizationBundleFingerprint(prepared.placementBundle) !==
			prepared.placementBundleFingerprint
	) {
		throw new Error("Prepared starter placement bundle is invalid.");
	}
	if (prepared.geometry !== null) {
		throw new Error("Certified FAB geometry must be omitted from the serialized payload.");
	}
	if (prepared.exactGeometry !== null) {
		assertRouteGeometryShape(prepared.exactGeometry);
	}
}

function assertRequestShape(value: unknown): void {
	const request = assertExactRecord(value, ["version", "id", "parameters"], "Starter request");
	assertExactRecord(
		request.parameters,
		[
			"aisleLengthMeters",
			"laneSpacingMeters",
			"bayCount",
			"bayPitchMeters",
			"outerbayDepthMeters",
			"processBlockCount",
		],
		"Starter request parameters",
	);
}

function assertSummaryShape(value: unknown): void {
	const summary = assertExactRecord(
		value,
		[
			"zoneCount",
			"bayCount",
			"railCells",
			"directedEdges",
			"physicalPaths",
			"totalLengthMeters",
			"junctions",
			"openTerminals",
			"strongComponents",
			"bounds",
		],
		"Starter summary",
	);
	if (summary.bounds !== null) {
		assertExactRecord(
			summary.bounds,
			["minX", "minY", "maxX", "maxY", "widthMeters", "heightMeters"],
			"Starter summary bounds",
		);
	}
}

function assertStepsShape(value: unknown): void {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_BUILD_STEPS) {
		throw new Error("Certified starter build steps are invalid.");
	}
	for (const [index, candidate] of value.entries()) {
		const step = assertExactRecord(
			candidate,
			[
				"ordinal",
				"kind",
				"templateId",
				"hierarchyRole",
				"entityId",
				"connectionId",
				"connectionRole",
				"bayCount",
				"bayIds",
				"label",
				"anchor",
				"targetAnchor",
				"junctions",
				"pose",
				"addedEdges",
				"outboundTurns",
				"returnTurns",
			],
			`Starter step ${index}`,
		);
		assertCellShape(step.anchor, `Starter step ${index} anchor`);
		if (step.targetAnchor !== null) {
			assertCellShape(step.targetAnchor, `Starter step ${index} target anchor`);
		}
		if (step.junctions !== null) {
			const junctions = assertExactRecord(
				step.junctions,
				["sourceDeparture", "sourceArrival", "targetArrival", "targetDeparture"],
				`Starter step ${index} junctions`,
			);
			for (const key of [
				"sourceDeparture",
				"sourceArrival",
				"targetArrival",
				"targetDeparture",
			] as const) {
				assertCellShape(junctions[key], `Starter step ${index} ${key}`);
			}
		}
		if (step.pose !== null) {
			assertRecordKeys(step.pose, ["forward", "side"], ["flow"], `Starter step ${index} pose`);
		}
	}
}

function assertCellShape(value: unknown, label: string): void {
	assertExactRecord(value, ["x", "y"], label);
}

function assertSnapshotShape(value: unknown): void {
	const snapshot = assertExactRecord(
		value,
		[
			"sequence",
			"revision",
			"nextAdvancedSwitchId",
			"xs",
			"ys",
			"encoded",
			"switchIds",
			"switchRecords",
			"portEquipment",
			"organizations",
			"checksum",
		],
		"Rail mirror snapshot",
	);
	assertOwnedTypedArray(snapshot.xs, Int32Array, "Rail snapshot xs");
	assertOwnedTypedArray(snapshot.ys, Int32Array, "Rail snapshot ys");
	assertOwnedTypedArray(snapshot.encoded, Uint8Array, "Rail snapshot encoded");
	assertOwnedTypedArray(snapshot.switchIds, Int32Array, "Rail snapshot switch ids");
	const switches = assertExactRecord(
		snapshot.switchRecords,
		["profileClasses", "origins", "forwardDirections", "lateralDirections", "movementMasks"],
		"Rail snapshot switch records",
	);
	assertOwnedTypedArray(switches.profileClasses, Uint8Array, "Switch profile classes");
	assertOwnedTypedArray(switches.origins, Int32Array, "Switch origins");
	assertOwnedTypedArray(switches.forwardDirections, Uint8Array, "Switch forward directions");
	assertOwnedTypedArray(switches.lateralDirections, Uint8Array, "Switch lateral directions");
	assertOwnedTypedArray(switches.movementMasks, Uint8Array, "Switch movement masks");
	assertPortEquipmentShape(snapshot.portEquipment);
	assertOrganizationShape(snapshot.organizations);
}

function assertPortEquipmentShape(value: unknown): void {
	const snapshot = assertExactRecord(
		value,
		[
			"schemaVersion",
			"nextPortId",
			"nextEquipmentGroupId",
			"portIds",
			"ports",
			"equipmentGroupIds",
			"equipmentGroups",
		],
		"Port/equipment snapshot",
	);
	assertOwnedTypedArray(snapshot.portIds, Int32Array, "Port ids");
	assertOwnedTypedArray(snapshot.equipmentGroupIds, Int32Array, "Equipment group ids");
	const ports = assertExactRecord(
		snapshot.ports,
		[
			"equipmentGroupIds",
			"routeKinds",
			"routeXs",
			"routeZs",
			"routeFromDirections",
			"routeToDirections",
			"routeSwitchIds",
			"routeProfileClasses",
			"routeRoles",
			"routePortIndices",
			"routeSegmentOrdinals",
			"stationMillimeters",
			"sides",
			"lateralOffsetMillimeters",
			"directions",
			"portTypes",
			"barcodes",
		],
		"Port fields",
	);
	assertOwnedTypedArray(ports.equipmentGroupIds, Int32Array, "Port equipment group ids");
	assertOwnedTypedArray(ports.routeKinds, Uint8Array, "Port route kinds");
	assertOwnedTypedArray(ports.routeXs, Int32Array, "Port route xs");
	assertOwnedTypedArray(ports.routeZs, Int32Array, "Port route zs");
	assertOwnedTypedArray(ports.routeFromDirections, Uint8Array, "Port route from directions");
	assertOwnedTypedArray(ports.routeToDirections, Uint8Array, "Port route to directions");
	assertOwnedTypedArray(ports.routeSwitchIds, Int32Array, "Port route switch ids");
	assertOwnedTypedArray(ports.routeProfileClasses, Uint8Array, "Port route profile classes");
	assertOwnedTypedArray(ports.routeRoles, Uint8Array, "Port route roles");
	assertOwnedTypedArray(ports.routePortIndices, Int8Array, "Port route port indices");
	assertOwnedTypedArray(ports.routeSegmentOrdinals, Uint16Array, "Port route segment ordinals");
	assertOwnedTypedArray(ports.stationMillimeters, Int32Array, "Port station millimeters");
	assertOwnedTypedArray(ports.sides, Uint8Array, "Port sides");
	assertOwnedTypedArray(
		ports.lateralOffsetMillimeters,
		Uint32Array,
		"Port lateral offset millimeters",
	);
	assertOwnedTypedArray(ports.directions, Uint8Array, "Port directions");
	assertOwnedTypedArray(ports.portTypes, Uint8Array, "Port types");
	assertNullableStringArray(ports.barcodes, "Port barcodes");

	const groups = assertExactRecord(
		snapshot.equipmentGroups,
		["kinds", "portOffsets", "portIds", "templates", "pitchMillimeters", "recipes"],
		"Equipment group fields",
	);
	assertOwnedTypedArray(groups.kinds, Uint8Array, "Equipment group kinds");
	assertOwnedTypedArray(groups.portOffsets, Uint32Array, "Equipment group port offsets");
	assertOwnedTypedArray(groups.portIds, Int32Array, "Equipment group port ids");
	assertOwnedTypedArray(groups.templates, Uint8Array, "Equipment group templates");
	assertOwnedTypedArray(groups.pitchMillimeters, Uint32Array, "Equipment group pitch");
	assertNullableStringArray(groups.recipes, "Equipment group recipes");
}

function assertOrganizationShape(value: unknown): void {
	const snapshot = assertExactRecord(
		value,
		["schemaVersion", "nextOrganizationId", "organizationIds", "records"],
		"Organization snapshot",
	);
	assertOwnedTypedArray(snapshot.organizationIds, Int32Array, "Organization ids");
	const records = assertExactRecord(
		snapshot.records,
		[
			"kinds",
			"names",
			"parentOrganizationOffsets",
			"parentOrganizationIds",
			"descriptions",
			"colors",
			"railEdgeOffsets",
			"railEdgeCoordinates",
			"advancedSwitchOffsets",
			"advancedSwitchIds",
			"equipmentGroupOffsets",
			"equipmentGroupIds",
		],
		"Organization records",
	);
	assertOwnedTypedArray(records.kinds, Uint8Array, "Organization kinds");
	assertStringArray(records.names, "Organization names");
	assertOwnedTypedArray(
		records.parentOrganizationOffsets,
		Uint32Array,
		"Organization parent offsets",
	);
	assertOwnedTypedArray(records.parentOrganizationIds, Int32Array, "Organization parent ids");
	assertStringArray(records.descriptions, "Organization descriptions");
	assertOwnedTypedArray(records.colors, Uint8Array, "Organization colors");
	assertOwnedTypedArray(records.railEdgeOffsets, Uint32Array, "Organization rail offsets");
	assertOwnedTypedArray(records.railEdgeCoordinates, Int32Array, "Organization rail coordinates");
	assertOwnedTypedArray(records.advancedSwitchOffsets, Uint32Array, "Organization switch offsets");
	assertOwnedTypedArray(records.advancedSwitchIds, Int32Array, "Organization switch ids");
	assertOwnedTypedArray(
		records.equipmentGroupOffsets,
		Uint32Array,
		"Organization equipment offsets",
	);
	assertOwnedTypedArray(records.equipmentGroupIds, Int32Array, "Organization equipment ids");
}

function assertRouteGeometryShape(value: unknown): void {
	const geometry = assertExactRecord(
		value,
		[
			"schemaVersion",
			"sourcePhysicalFingerprint",
			"bounds",
			"positions",
			"offsets",
			"kinds",
			"runOffsets",
			"runPathIndices",
			"runClosed",
			"markers",
			"markerScale",
			"pathCount",
			"pointCount",
			"runCount",
			"byteLength",
			"fingerprint",
		],
		"Exact route geometry",
	);
	assertExactRecord(geometry.bounds, ["minX", "minY", "maxX", "maxY"], "Route bounds");
	assertOwnedTypedArray(geometry.positions, Float32Array, "Route positions");
	assertOwnedTypedArray(geometry.offsets, Uint32Array, "Route offsets");
	assertOwnedTypedArray(geometry.kinds, Uint8Array, "Route kinds");
	assertOwnedTypedArray(geometry.runOffsets, Uint32Array, "Route run offsets");
	assertOwnedTypedArray(geometry.runPathIndices, Uint32Array, "Route run path indices");
	assertOwnedTypedArray(geometry.runClosed, Uint8Array, "Route run closed flags");
	assertOwnedTypedArray(geometry.markers, Float32Array, "Route markers");
}

function assertOwnedTypedArray<T extends SupportedTypedArray>(
	value: unknown,
	arrayConstructor: { new (length: number): T; readonly name: string },
	label: string,
): asserts value is T {
	if (
		!(value instanceof arrayConstructor) ||
		!(value.buffer instanceof ArrayBuffer) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength
	) {
		throw new Error(`${label} must own an exact ${arrayConstructor.name} ArrayBuffer.`);
	}
}

function assertStringArray(value: unknown, label: string): void {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${label} must be a string array.`);
	}
}

function assertNullableStringArray(value: unknown, label: string): void {
	if (!Array.isArray(value) || !value.every((item) => item === null || typeof item === "string")) {
		throw new Error(`${label} must be a nullable string array.`);
	}
}

function serializeValue(value: unknown, budget: SerializationBudget): SerializedValue {
	enterSerializationNode(budget);
	try {
		if (value === null || typeof value === "boolean") return value;
		if (typeof value === "number") {
			if (!Number.isFinite(value)) throw new Error("Certified payload numbers must be finite.");
			return value;
		}
		if (typeof value === "string") {
			budget.stringBytes += utf8ByteLength(value);
			assertSerializationBudget(budget);
			return value;
		}
		const typedName = supportedTypedArrayName(value);
		if (typedName) {
			const typedValue = value as SupportedTypedArray;
			assertOwnedSupportedTypedArray(typedValue);
			budget.typedArrayBytes += typedValue.byteLength;
			assertSerializationBudget(budget);
			return Object.freeze({
				$openfabTypedArray: typedName,
				length: typedValue.length,
				byteLength: typedValue.byteLength,
				base64: encodeBase64(canonicalLittleEndianBytes(typedValue)),
			});
		}
		if (Array.isArray(value)) {
			return Object.freeze(value.map((item) => serializeValue(item, budget)));
		}
		if (!isPlainRecord(value)) {
			throw new Error("Certified payload contains a non-plain object.");
		}
		const output: Record<string, SerializedValue> = {};
		for (const key of Object.keys(value).sort()) {
			assertSafeObjectKey(key);
			output[key] = serializeValue(value[key], budget);
		}
		return Object.freeze(output);
	} finally {
		budget.depth -= 1;
	}
}

function deserializeValue(value: unknown, budget: SerializationBudget): unknown {
	enterSerializationNode(budget);
	try {
		if (value === null || typeof value === "boolean") return value;
		if (typeof value === "number") {
			if (!Number.isFinite(value)) throw new Error("Certified payload numbers must be finite.");
			return value;
		}
		if (typeof value === "string") {
			budget.stringBytes += utf8ByteLength(value);
			assertSerializationBudget(budget);
			return value;
		}
		if (Array.isArray(value)) {
			return value.map((item) => deserializeValue(item, budget));
		}
		if (!isPlainRecord(value)) {
			throw new Error("Certified payload contains a non-plain serialized value.");
		}
		if (Object.hasOwn(value, "$openfabTypedArray")) {
			return deserializeTypedArray(value, budget);
		}
		const keys = Object.keys(value);
		for (let index = 1; index < keys.length; index += 1) {
			if ((keys[index - 1] as string) >= (keys[index] as string)) {
				throw new Error("Certified payload object keys are not canonical.");
			}
		}
		const output: Record<string, unknown> = {};
		for (const key of keys) {
			assertSafeObjectKey(key);
			output[key] = deserializeValue(value[key], budget);
		}
		return output;
	} finally {
		budget.depth -= 1;
	}
}

function deserializeTypedArray(
	value: Record<string, unknown>,
	budget: SerializationBudget,
): SupportedTypedArray {
	const serialized = assertExactRecord(
		value,
		["$openfabTypedArray", "length", "byteLength", "base64"],
		"Serialized typed array",
	);
	const name = serialized.$openfabTypedArray;
	if (!isSupportedTypedArrayName(name)) {
		throw new Error("Serialized typed-array constructor is unsupported.");
	}
	const bytesPerElement = bytesPerElementFor(name);
	if (
		!isBoundedNonnegativeInteger(serialized.length, Number.MAX_SAFE_INTEGER) ||
		!isBoundedNonnegativeInteger(
			serialized.byteLength,
			SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_TYPED_ARRAY_BYTES,
		) ||
		serialized.byteLength !== serialized.length * bytesPerElement ||
		typeof serialized.base64 !== "string"
	) {
		throw new Error("Serialized typed-array dimensions are invalid.");
	}
	budget.typedArrayBytes += serialized.byteLength;
	assertSerializationBudget(budget);
	const littleEndianBytes = decodeBase64(serialized.base64, serialized.byteLength);
	const hostBytes =
		HOST_IS_LITTLE_ENDIAN || bytesPerElement === 1
			? littleEndianBytes
			: swapElementByteOrder(littleEndianBytes, bytesPerElement);
	return constructTypedArray(name, hostBytes.buffer as ArrayBuffer, serialized.length);
}

function supportedTypedArrayName(value: unknown): SupportedTypedArrayName | null {
	if (value instanceof Int8Array) return "Int8Array";
	if (value instanceof Uint8Array) return "Uint8Array";
	if (value instanceof Uint16Array) return "Uint16Array";
	if (value instanceof Int32Array) return "Int32Array";
	if (value instanceof Uint32Array) return "Uint32Array";
	if (value instanceof Float32Array) return "Float32Array";
	if (value instanceof Float64Array) return "Float64Array";
	return null;
}

function isSupportedTypedArrayName(value: unknown): value is SupportedTypedArrayName {
	return (
		value === "Int8Array" ||
		value === "Uint8Array" ||
		value === "Uint16Array" ||
		value === "Int32Array" ||
		value === "Uint32Array" ||
		value === "Float32Array" ||
		value === "Float64Array"
	);
}

function assertOwnedSupportedTypedArray(value: SupportedTypedArray): void {
	if (
		!(value.buffer instanceof ArrayBuffer) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength
	) {
		throw new Error("Certified payload typed arrays must own transferable ArrayBuffers.");
	}
}

function bytesPerElementFor(name: SupportedTypedArrayName): number {
	switch (name) {
		case "Int8Array":
		case "Uint8Array":
			return 1;
		case "Uint16Array":
			return 2;
		case "Int32Array":
		case "Uint32Array":
		case "Float32Array":
			return 4;
		case "Float64Array":
			return 8;
	}
}

function constructTypedArray(
	name: SupportedTypedArrayName,
	buffer: ArrayBuffer,
	length: number,
): SupportedTypedArray {
	switch (name) {
		case "Int8Array":
			return new Int8Array(buffer, 0, length);
		case "Uint8Array":
			return new Uint8Array(buffer, 0, length);
		case "Uint16Array":
			return new Uint16Array(buffer, 0, length);
		case "Int32Array":
			return new Int32Array(buffer, 0, length);
		case "Uint32Array":
			return new Uint32Array(buffer, 0, length);
		case "Float32Array":
			return new Float32Array(buffer, 0, length);
		case "Float64Array":
			return new Float64Array(buffer, 0, length);
	}
}

function canonicalLittleEndianBytes(value: SupportedTypedArray): Uint8Array {
	const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
	if (HOST_IS_LITTLE_ENDIAN || value.BYTES_PER_ELEMENT === 1) return bytes;
	return swapElementByteOrder(bytes, value.BYTES_PER_ELEMENT);
}

function swapElementByteOrder(bytes: Uint8Array, bytesPerElement: number): Uint8Array {
	const swapped = new Uint8Array(bytes.length);
	for (let offset = 0; offset < bytes.length; offset += bytesPerElement) {
		for (let index = 0; index < bytesPerElement; index += 1) {
			swapped[offset + index] = bytes[offset + bytesPerElement - index - 1] as number;
		}
	}
	return swapped;
}

function encodeBase64(bytes: Uint8Array): string {
	let output = "";
	for (let offset = 0; offset < bytes.length; offset += 3) {
		const first = bytes[offset] as number;
		const second = bytes[offset + 1];
		const third = bytes[offset + 2];
		output += BASE64_ALPHABET[first >>> 2] as string;
		output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)] as string;
		output +=
			second === undefined
				? "="
				: (BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)] as string);
		output += third === undefined ? "=" : (BASE64_ALPHABET[third & 0x3f] as string);
	}
	return output;
}

function decodeBase64(value: string, expectedByteLength: number): Uint8Array {
	const expectedCharacters = Math.ceil(expectedByteLength / 3) * 4;
	if (value.length !== expectedCharacters || value.length % 4 !== 0) {
		throw new Error("Serialized typed-array base64 length is invalid.");
	}
	const output = new Uint8Array(expectedByteLength);
	let outputOffset = 0;
	for (let offset = 0; offset < value.length; offset += 4) {
		const lastBlock = offset + 4 === value.length;
		const first = decodeBase64Character(value.charCodeAt(offset));
		const second = decodeBase64Character(value.charCodeAt(offset + 1));
		const thirdCharacter = value[offset + 2] as string;
		const fourthCharacter = value[offset + 3] as string;
		const third = thirdCharacter === "=" ? 0 : decodeBase64Character(value.charCodeAt(offset + 2));
		const fourth =
			fourthCharacter === "=" ? 0 : decodeBase64Character(value.charCodeAt(offset + 3));
		if (
			(!lastBlock && (thirdCharacter === "=" || fourthCharacter === "=")) ||
			(thirdCharacter === "=" && fourthCharacter !== "=")
		) {
			throw new Error("Serialized typed-array base64 padding is invalid.");
		}
		const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
		if (outputOffset < output.length) output[outputOffset++] = packed >>> 16;
		if (thirdCharacter !== "=" && outputOffset < output.length) {
			output[outputOffset++] = (packed >>> 8) & 0xff;
		}
		if (fourthCharacter !== "=" && outputOffset < output.length) {
			output[outputOffset++] = packed & 0xff;
		}
	}
	if (outputOffset !== expectedByteLength || encodeBase64(output) !== value) {
		throw new Error("Serialized typed-array base64 is not canonical.");
	}
	return output;
}

function createBase64DecodeTable(): Int16Array {
	const table = new Int16Array(128);
	table.fill(-1);
	for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
		table[BASE64_ALPHABET.charCodeAt(index)] = index;
	}
	return table;
}

function decodeBase64Character(code: number): number {
	const value = code < BASE64_DECODE.length ? (BASE64_DECODE[code] as number) : -1;
	if (value < 0) throw new Error("Serialized typed-array base64 contains an invalid character.");
	return value;
}

function createSerializationBudget(): SerializationBudget {
	return { depth: 0, nodes: 0, stringBytes: 0, typedArrayBytes: 0 };
}

function enterSerializationNode(budget: SerializationBudget): void {
	budget.depth += 1;
	budget.nodes += 1;
	assertSerializationBudget(budget);
}

function assertSerializationBudget(budget: SerializationBudget): void {
	if (
		budget.depth > MAXIMUM_SERIALIZED_DEPTH ||
		budget.nodes > MAXIMUM_SERIALIZED_NODES ||
		budget.stringBytes > MAXIMUM_SERIALIZED_STRING_BYTES ||
		budget.typedArrayBytes > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_TYPED_ARRAY_BYTES
	) {
		throw new Error("Certified starter payload exceeds its structural budget.");
	}
}

function assertArtifactSize(payloadBytes: number, typedArrayBytes: number): void {
	if (
		payloadBytes > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_PAYLOAD_BYTES ||
		typedArrayBytes > SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_MAX_TYPED_ARRAY_BYTES
	) {
		throw new Error("Certified starter artifact exceeds its byte budget.");
	}
}

function checksumPayload(payloadText: string): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["synthetic-fab-certified-payload-v1", payloadText]);
	return checksum.digest();
}

function checksumCertification(
	input: Readonly<{
		artifactId: SyntheticFabStarterCertifiedArtifactId;
		requestFingerprint: string;
		materializationFingerprint: string;
		payloadChecksum: string;
		payloadByteLength: number;
		typedArrayByteLength: number;
	}>,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"synthetic-fab-certified-evidence-v1",
		input.artifactId,
		CERTIFICATION_CONTRACT,
		input.requestFingerprint,
		input.materializationFingerprint,
		input.payloadChecksum,
	]);
	checksum.addNumbers([
		SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_SCHEMA_VERSION,
		SYNTHETIC_FAB_STARTER_VERSION,
		SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION,
		input.payloadByteLength,
		input.typedArrayByteLength,
	]);
	return checksum.digest();
}

function createCertificationAttestation(
	artifact: SyntheticFabStarterCertifiedArtifact,
	prepared: PreparedSyntheticFabStarter,
): SyntheticFabStarterCertificationAttestation {
	return Object.freeze({
		schemaVersion: SYNTHETIC_FAB_STARTER_CERTIFICATION_ATTESTATION_SCHEMA_VERSION,
		artifactSchemaVersion: artifact.schemaVersion,
		artifactId: artifact.artifactId,
		payloadKind: artifact.payloadKind,
		certificationContract: artifact.certificationContract,
		starterVersion: artifact.starterVersion,
		routeGeometrySchemaVersion: artifact.routeGeometrySchemaVersion,
		requestFingerprint: artifact.requestFingerprint,
		materializationFingerprint: artifact.materializationFingerprint,
		payloadChecksum: artifact.payloadChecksum,
		certificationChecksum: artifact.certificationChecksum,
		payloadByteLength: artifact.payloadByteLength,
		typedArrayByteLength: artifact.typedArrayByteLength,
		transferredTypedArrayFingerprint: preparedTypedArrayFingerprint(prepared),
	});
}

function createCertificationEvidence(
	artifact: SyntheticFabStarterCertifiedArtifact,
	prepared: PreparedSyntheticFabStarter,
): SyntheticFabStarterCertificationEvidence {
	return createCertificationEvidenceFromIdentity(
		artifact.artifactId,
		artifact.certificationChecksum,
		artifact.requestFingerprint,
		artifact.materializationFingerprint,
		preparedTypedArrayFingerprint(prepared),
		prepared,
	);
}

function createCertificationEvidenceFromIdentity(
	artifactId: SyntheticFabStarterCertifiedArtifactId,
	certificationFingerprint: string,
	requestFingerprint: string,
	materializationFingerprint: string,
	transferredTypedArrayFingerprint: string,
	prepared: PreparedSyntheticFabStarter,
): SyntheticFabStarterCertificationEvidence {
	const evidence = Object.freeze({
		artifactId,
		certificationFingerprint,
		[CERTIFICATION_EVIDENCE_BRAND]: true as const,
	});
	certificationEvidenceStates.set(
		evidence,
		Object.freeze({
			requestFingerprint,
			materializationFingerprint,
			transferredTypedArrayFingerprint,
			prepared,
		}),
	);
	return evidence;
}

function assertExactRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
): Record<string, unknown> {
	return assertRecordKeys(value, keys, [], label);
}

function assertRecordKeys(
	value: unknown,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!isPlainRecord(value)) throw new Error(`${label} must be a plain object.`);
	const actual = Object.keys(value).sort();
	const allowed = [...requiredKeys, ...optionalKeys].sort();
	if (
		!requiredKeys.every((key) => Object.hasOwn(value, key)) ||
		actual.some((key) => !allowed.includes(key))
	) {
		throw new Error(`${label} has unexpected or missing fields.`);
	}
	return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function assertSafeObjectKey(key: string): void {
	if (key === "__proto__" || key === "prototype" || key === "constructor") {
		throw new Error("Certified payload contains an unsafe object key.");
	}
}

function isBoundedNonnegativeInteger(value: unknown, maximum: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function deepFreezeContainers(value: unknown, visited = new WeakSet<object>()): void {
	if (
		typeof value !== "object" ||
		value === null ||
		ArrayBuffer.isView(value) ||
		visited.has(value)
	) {
		return;
	}
	visited.add(value);
	for (const child of Array.isArray(value) ? value : Object.values(value)) {
		deepFreezeContainers(child, visited);
	}
	Object.freeze(value);
}
