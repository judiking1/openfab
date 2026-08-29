import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES } from "../project/OpenFabStationProposalPorts";

export const OPENFAB_STATION_PROPOSAL_SCHEMA_ID = "openfab/station-proposal" as const;
export const OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_MAX_SECONDARY_ALIASES = 16;
export const OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES = 100_000;
export const OPENFAB_STATION_PROPOSAL_MAX_DISTINCT_STRINGS = 300_000;
export const OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES = 16 * 1024;
export const OPENFAB_STATION_PROPOSAL_MAX_STRING_POOL_BYTES =
	OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES * 4;
export const OPENFAB_STATION_PROPOSAL_MAX_ROWS = 100_000;

export const OPENFAB_STATION_PROPOSAL_V1_HEADERS = Object.freeze([
	"identity_scope",
	"port_key",
	"secondary_aliases",
	"attachment_scope",
	"attachment_alias",
	"station_mm",
	"side",
	"lateral_offset_mm",
	"direction",
	"direction_evidence",
	"port_type",
	"physical_group_key",
	"physical_group_kind",
	"organization_alias",
	"source_x_mm",
	"source_z_mm",
] as const);

/** Public OpenFab-owned exchange schema. Import adapters may target it, but may not redefine it. */
export const OPENFAB_STATION_PROPOSAL_V1_SCHEMA = Object.freeze({
	id: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	version: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	headers: OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	requiredHeaders: Object.freeze([
		"identity_scope",
		"port_key",
		"attachment_scope",
		"attachment_alias",
		"station_mm",
		"side",
		"lateral_offset_mm",
		"direction",
		"direction_evidence",
		"port_type",
	] as const),
});

export const OPENFAB_STATION_PROPOSAL_V1_REQUIRED_HEADERS =
	OPENFAB_STATION_PROPOSAL_V1_SCHEMA.requiredHeaders;

export const OPENFAB_STATION_PROPOSAL_PORT_TYPES = Object.freeze([
	"UNRESOLVED",
	"OHB",
	"EQ",
	"STK",
] as const);
export type OpenFabStationProposalPortType = (typeof OPENFAB_STATION_PROPOSAL_PORT_TYPES)[number];

export const OPENFAB_STATION_PROPOSAL_SIDES = Object.freeze([
	"UNRESOLVED",
	"LEFT",
	"CENTER",
	"RIGHT",
] as const);
export type OpenFabStationProposalSide = (typeof OPENFAB_STATION_PROPOSAL_SIDES)[number];

export const OPENFAB_STATION_PROPOSAL_DIRECTIONS = Object.freeze([
	"UNKNOWN",
	"WITH_TRAVEL",
	"AGAINST_TRAVEL",
] as const);
export type OpenFabStationProposalDirection = (typeof OPENFAB_STATION_PROPOSAL_DIRECTIONS)[number];

export const OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE = Object.freeze([
	"UNKNOWN",
	"DECLARED",
	"HEURISTIC",
] as const);
export type OpenFabStationProposalDirectionEvidence =
	(typeof OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE)[number];

export const OPENFAB_STATION_PROPOSAL_ISSUE_CODES = Object.freeze([
	"UNKNOWN_COLUMN",
	"ROW_COLUMN_MISMATCH",
	"MISSING_IDENTITY_SCOPE",
	"MISSING_PORT_KEY",
	"INVALID_SECONDARY_ALIASES",
	"MISSING_ATTACHMENT_SCOPE",
	"MISSING_ATTACHMENT_ALIAS",
	"INVALID_STATION_MILLIMETERS",
	"UNRESOLVED_SIDE",
	"INVALID_LATERAL_OFFSET_MILLIMETERS",
	"UNRESOLVED_DIRECTION",
	"UNRESOLVED_DIRECTION_EVIDENCE",
	"DIRECTION_EVIDENCE_CONTRADICTION",
	"SIDE_OFFSET_CONTRADICTION",
	"UNRESOLVED_PORT_TYPE",
	"UNRESOLVED_PHYSICAL_GROUP_KIND",
	"PHYSICAL_GROUP_KIND_WITHOUT_KEY",
	"INVALID_SOURCE_POSITION",
	"PRIMARY_ALIAS_COLLISION",
	"PRIMARY_SECONDARY_ALIAS_COLLISION",
	"SECONDARY_ALIAS_COLLISION",
	"PHYSICAL_GROUP_KIND_CONFLICT",
] as const);
export type OpenFabStationProposalIssueCode = (typeof OPENFAB_STATION_PROPOSAL_ISSUE_CODES)[number];

export const OPENFAB_STATION_PROPOSAL_READ_FAILURE_CODES = Object.freeze([
	"SOURCE_EMPTY",
	"SOURCE_BYTE_LIMIT_EXCEEDED",
	"INVALID_UTF8",
	"MALFORMED_CSV",
	"PROHIBITED_TEXT",
	"FIELD_LIMIT_EXCEEDED",
	"RECORD_LIMIT_EXCEEDED",
	"COLUMN_LIMIT_EXCEEDED",
	"ROW_LIMIT_EXCEEDED",
	"SECONDARY_ALIAS_LIMIT_EXCEEDED",
	"STRING_POOL_LIMIT_EXCEEDED",
	"MISSING_HEADER",
	"MISSING_REQUIRED_HEADER",
	"DUPLICATE_REQUIRED_HEADER",
	"OPTIONAL_HEADER_PAIR_MISMATCH",
] as const);
export type OpenFabStationProposalReadFailureCode =
	(typeof OPENFAB_STATION_PROPOSAL_READ_FAILURE_CODES)[number];

export const OPENFAB_STATION_PROPOSAL_ARTIFACT_ERROR_CODES = Object.freeze([
	"NOT_OBJECT",
	"CONTRACT_MISMATCH",
	"SCALAR_MISMATCH",
	"TYPED_ARRAY_MISMATCH",
	"BUFFER_OWNERSHIP_MISMATCH",
	"COLUMN_LENGTH_MISMATCH",
	"STRING_POOL_MISMATCH",
	"COLUMN_VALUE_MISMATCH",
	"CANONICAL_ORDER_MISMATCH",
	"ISSUE_COUNT_MISMATCH",
	"SEMANTIC_FINGERPRINT_MISMATCH",
	"SNAPSHOT_FINGERPRINT_MISMATCH",
] as const);
export type OpenFabStationProposalArtifactErrorCode =
	(typeof OPENFAB_STATION_PROPOSAL_ARTIFACT_ERROR_CODES)[number];

export interface OpenFabStationProposalArtifact {
	readonly kind: "openfab-station-proposal-artifact";
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly sourceByteLength: number;
	readonly sourceRecordCount: number;
	readonly rowCount: number;
	readonly rejectedRowCount: number;
	readonly unknownColumnCount: number;
	readonly stringCount: number;
	readonly stringBytes: Uint8Array;
	readonly stringOffsets: Uint32Array;
	readonly identityScopeStringIndices: Uint32Array;
	readonly portKeyStringIndices: Uint32Array;
	readonly secondaryAliasOffsets: Uint32Array;
	readonly secondaryAliasStringIndices: Uint32Array;
	readonly attachmentScopeStringIndices: Uint32Array;
	readonly attachmentAliasStringIndices: Uint32Array;
	readonly stationMillimeters: Int32Array;
	readonly sides: Uint8Array;
	readonly lateralOffsetMillimeters: Int32Array;
	readonly directions: Uint8Array;
	readonly directionEvidence: Uint8Array;
	readonly portTypes: Uint8Array;
	readonly physicalGroupKeyStringIndices: Uint32Array;
	readonly physicalGroupKinds: Uint8Array;
	readonly organizationAliasStringIndices: Uint32Array;
	readonly sourcePositionPresence: Uint8Array;
	readonly sourceXMillimeters: Int32Array;
	readonly sourceZMillimeters: Int32Array;
	readonly issueCounts: Uint32Array;
	readonly semanticFingerprint: string;
	readonly snapshotFingerprint: string;
}

export interface OpenFabStationProposalRow {
	readonly identityScope: string;
	readonly portKey: string;
	readonly secondaryAliases: readonly string[];
	readonly attachmentScope: string;
	readonly attachmentAlias: string;
	readonly stationMillimeters: number;
	readonly side: OpenFabStationProposalSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: OpenFabStationProposalDirection;
	readonly directionEvidence: OpenFabStationProposalDirectionEvidence;
	readonly portType: OpenFabStationProposalPortType;
	readonly physicalGroupKey: string;
	readonly physicalGroupKind: OpenFabStationProposalPortType;
	readonly organizationAlias: string;
	readonly sourceXMillimeters: number | null;
	readonly sourceZMillimeters: number | null;
}

/** Private, accessor-only adoption of an exact transferable snapshot. */
export interface HydratedOpenFabStationProposalArtifact {
	readonly kind: "hydrated-openfab-station-proposal-artifact";
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly sourceByteLength: number;
	readonly sourceRecordCount: number;
	readonly rowCount: number;
	readonly rejectedRowCount: number;
	readonly unknownColumnCount: number;
	readonly semanticFingerprint: string;
	readonly snapshotFingerprint: string;
	readRow(row: number): OpenFabStationProposalRow;
	issueCount(code: OpenFabStationProposalIssueCode): number;
}

export interface OpenFabStationProposalReadFailure {
	readonly kind: "openfab-station-proposal-read-failure";
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly code: OpenFabStationProposalReadFailureCode;
	readonly sourceByteLength: number;
	readonly recordsSeen: number;
	readonly acceptedRowCount: number;
	readonly rejectedRowCount: number;
	readonly unknownColumnCount: number;
	readonly issueCounts: Uint32Array;
	readonly snapshotFingerprint: string;
}

export interface HydratedOpenFabStationProposalReadFailure {
	readonly kind: "hydrated-openfab-station-proposal-read-failure";
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly code: OpenFabStationProposalReadFailureCode;
	readonly sourceByteLength: number;
	readonly recordsSeen: number;
	readonly acceptedRowCount: number;
	readonly rejectedRowCount: number;
	readonly unknownColumnCount: number;
	readonly snapshotFingerprint: string;
	issueCount(code: OpenFabStationProposalIssueCode): number;
}

export type OpenFabStationProposalReadResult =
	| { readonly ok: true; readonly artifact: OpenFabStationProposalArtifact }
	| { readonly ok: false; readonly failure: OpenFabStationProposalReadFailure };

export type HydratedOpenFabStationProposalReadResult =
	| { readonly ok: true; readonly artifact: HydratedOpenFabStationProposalArtifact }
	| { readonly ok: false; readonly failure: HydratedOpenFabStationProposalReadFailure };

export interface OpenFabStationProposalCooperativeHydrationOptions {
	readonly checkpoint: () => Promise<void>;
	readonly signal?: AbortSignal;
	readonly rowsPerCheckpoint?: number;
	readonly stringsPerCheckpoint?: number;
	readonly checksumBytesPerCheckpoint?: number;
}

export interface OpenFabStationProposalCooperativeCaptureOptions {
	readonly checkpoint: () => Promise<void>;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
	readonly sliceMilliseconds?: number;
	readonly bytesPerChunk?: number;
}

/** One exact serializable copy plus private, main-realm one-shot source authority. */
export interface OpenFabStationProposalArtifactCapture {
	readonly artifact: OpenFabStationProposalArtifact;
}

export interface ReleasedOpenFabStationProposalArtifactCaptureTransfer {
	readonly artifact: OpenFabStationProposalArtifact;
	readonly transfers: readonly ArrayBuffer[];
}

const ARTIFACT_KIND = "openfab-station-proposal-artifact" as const;
const FAILURE_KIND = "openfab-station-proposal-read-failure" as const;
const SEMANTIC_FINGERPRINT_PREFIX = "openfab-station-proposal-semantic:v1:";
const SNAPSHOT_FINGERPRINT_PREFIX = "openfab-station-proposal-snapshot:v1:";
const FAILURE_FINGERPRINT_PREFIX = "openfab-station-proposal-failure:v1:";
const MAX_UINT32 = 0xffff_ffff;
const DEFAULT_COOPERATIVE_ROWS = 128;
const DEFAULT_COOPERATIVE_STRINGS = 128;
const DEFAULT_COOPERATIVE_CHECKSUM_BYTES = 64 * 1024;
const DEFAULT_COOPERATIVE_CAPTURE_SLICE_MILLISECONDS = 4;
const DEFAULT_COOPERATIVE_CAPTURE_BYTES_PER_CHUNK = 64 * 1024;
const MAX_COOPERATIVE_CAPTURE_SLICE_MILLISECONDS = 1_000;
const MAX_COOPERATIVE_CAPTURE_BYTES_PER_CHUNK = 1024 * 1024;

interface ResolvedCooperativeHydrationOptions {
	readonly rowsPerCheckpoint: number;
	readonly stringsPerCheckpoint: number;
	readonly checksumBytesPerCheckpoint: number;
}

interface CooperativeArtifactValidationResult {
	readonly error: OpenFabStationProposalArtifactErrorCode | null;
	readonly strings: readonly string[];
}

interface CooperativeArtifactCaptureScheduler {
	readonly bytesPerChunk: number;
	checkpointIfDue(): Promise<void>;
	checkpointNow(): Promise<void>;
	throwIfAborted(): void;
}

const adoptedArtifactsByHydratedFacade = new WeakMap<object, OpenFabStationProposalArtifact>();
const capturedArtifactAuthorities = new WeakMap<object, HydratedOpenFabStationProposalArtifact>();

const ROW_ARRAY_KEYS = Object.freeze([
	"identityScopeStringIndices",
	"portKeyStringIndices",
	"attachmentScopeStringIndices",
	"attachmentAliasStringIndices",
	"stationMillimeters",
	"sides",
	"lateralOffsetMillimeters",
	"directions",
	"directionEvidence",
	"portTypes",
	"physicalGroupKeyStringIndices",
	"physicalGroupKinds",
	"organizationAliasStringIndices",
	"sourcePositionPresence",
	"sourceXMillimeters",
	"sourceZMillimeters",
] as const);

const ARTIFACT_ARRAY_KEYS = Object.freeze([
	"stringBytes",
	"stringOffsets",
	"secondaryAliasOffsets",
	"secondaryAliasStringIndices",
	...ROW_ARRAY_KEYS,
	"issueCounts",
] as const);

type OpenFabStationProposalArtifactArrayKey = (typeof ARTIFACT_ARRAY_KEYS)[number];
type OpenFabStationProposalArtifactArray =
	OpenFabStationProposalArtifact[OpenFabStationProposalArtifactArrayKey];

const ARTIFACT_KEYS = Object.freeze([
	"kind",
	"schemaId",
	"schemaVersion",
	"sourceByteLength",
	"sourceRecordCount",
	"rowCount",
	"rejectedRowCount",
	"unknownColumnCount",
	"stringCount",
	...ARTIFACT_ARRAY_KEYS,
	"semanticFingerprint",
	"snapshotFingerprint",
] as const);

const FAILURE_KEYS = Object.freeze([
	"kind",
	"schemaId",
	"schemaVersion",
	"code",
	"sourceByteLength",
	"recordsSeen",
	"acceptedRowCount",
	"rejectedRowCount",
	"unknownColumnCount",
	"issueCounts",
	"snapshotFingerprint",
] as const);

export function openFabStationProposalSemanticFingerprint(
	artifact: OpenFabStationProposalArtifact,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([artifact.schemaId]);
	checksum.addNumbers([
		artifact.schemaVersion,
		artifact.sourceRecordCount,
		artifact.rowCount,
		artifact.rejectedRowCount,
		artifact.unknownColumnCount,
		artifact.stringCount,
	]);
	checksum.addViews([
		artifact.stringBytes,
		artifact.stringOffsets,
		artifact.secondaryAliasOffsets,
		artifact.secondaryAliasStringIndices,
		...ROW_ARRAY_KEYS.map((key) => artifact[key]),
		artifact.issueCounts,
	]);
	return `${SEMANTIC_FINGERPRINT_PREFIX}${checksum.digest()}`;
}

export function openFabStationProposalSnapshotFingerprint(
	artifact: OpenFabStationProposalArtifact,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([artifact.semanticFingerprint]);
	checksum.addNumbers([artifact.sourceByteLength]);
	return `${SNAPSHOT_FINGERPRINT_PREFIX}${checksum.digest()}`;
}

export function openFabStationProposalReadFailureFingerprint(
	failure: OpenFabStationProposalReadFailure,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([failure.schemaId, failure.code]);
	checksum.addNumbers([
		failure.schemaVersion,
		failure.sourceByteLength,
		failure.recordsSeen,
		failure.acceptedRowCount,
		failure.rejectedRowCount,
		failure.unknownColumnCount,
	]);
	checksum.addViews([failure.issueCounts]);
	return `${FAILURE_FINGERPRINT_PREFIX}${checksum.digest()}`;
}

export function openFabStationProposalArtifactShapeError(
	value: unknown,
): OpenFabStationProposalArtifactErrorCode | null {
	const shallowError = openFabStationProposalArtifactShallowShapeError(value);
	if (shallowError) return shallowError;
	const artifact = value as OpenFabStationProposalArtifact;

	let strings: readonly string[];
	try {
		strings = decodeCanonicalStringPool(artifact);
	} catch {
		return "STRING_POOL_MISMATCH";
	}
	if (!columnsHaveValidValues(artifact, strings.length)) return "COLUMN_VALUE_MISMATCH";
	if (!rowsAndStringPoolAreCanonical(artifact, strings)) return "CANONICAL_ORDER_MISMATCH";
	if (!issueCountsAreConsistent(artifact, strings)) return "ISSUE_COUNT_MISMATCH";
	if (openFabStationProposalSemanticFingerprint(artifact) !== artifact.semanticFingerprint) {
		return "SEMANTIC_FINGERPRINT_MISMATCH";
	}
	if (openFabStationProposalSnapshotFingerprint(artifact) !== artifact.snapshotFingerprint) {
		return "SNAPSHOT_FINGERPRINT_MISMATCH";
	}
	return null;
}

function openFabStationProposalArtifactShallowShapeError(
	value: unknown,
): OpenFabStationProposalArtifactErrorCode | null {
	if (!isRecord(value)) return "NOT_OBJECT";
	if (!hasExactKeys(value, ARTIFACT_KEYS)) return "CONTRACT_MISMATCH";
	if (
		value.kind !== ARTIFACT_KIND ||
		value.schemaId !== OPENFAB_STATION_PROPOSAL_SCHEMA_ID ||
		value.schemaVersion !== OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION
	) {
		return "CONTRACT_MISMATCH";
	}
	if (
		!isUint32(value.sourceByteLength) ||
		value.sourceByteLength > OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES ||
		!isUint32(value.sourceRecordCount) ||
		value.sourceRecordCount > OPENFAB_STATION_PROPOSAL_MAX_ROWS ||
		!isUint32(value.rowCount) ||
		!isUint32(value.rejectedRowCount) ||
		!isUint32(value.unknownColumnCount) ||
		!isUint32(value.stringCount) ||
		value.sourceRecordCount !== value.rowCount + value.rejectedRowCount
	) {
		return "SCALAR_MISMATCH";
	}
	if (!artifactArraysHaveExactTypes(value)) return "TYPED_ARRAY_MISMATCH";
	const artifact = value as unknown as OpenFabStationProposalArtifact;
	if (!arraysOwnUniqueBuffers(ARTIFACT_ARRAY_KEYS.map((key) => artifact[key]))) {
		return "BUFFER_OWNERSHIP_MISMATCH";
	}
	const maximumStringCount = Math.min(
		OPENFAB_STATION_PROPOSAL_MAX_DISTINCT_STRINGS,
		1 + artifact.rowCount * 6 + artifact.secondaryAliasStringIndices.length,
	);
	if (artifact.stringCount > maximumStringCount) return "SCALAR_MISMATCH";
	if (
		artifact.stringOffsets.length !== artifact.stringCount + 1 ||
		artifact.secondaryAliasOffsets.length !== artifact.rowCount + 1 ||
		ROW_ARRAY_KEYS.some((key) => artifact[key].length !== artifact.rowCount) ||
		artifact.issueCounts.length !== OPENFAB_STATION_PROPOSAL_ISSUE_CODES.length
	) {
		return "COLUMN_LENGTH_MISMATCH";
	}
	const maximumAliasCount = Math.min(
		OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES,
		artifact.rowCount * OPENFAB_STATION_PROPOSAL_MAX_SECONDARY_ALIASES,
	);
	if (artifact.secondaryAliasStringIndices.length > maximumAliasCount) {
		return "COLUMN_LENGTH_MISMATCH";
	}
	if (
		artifact.stringBytes.length > OPENFAB_STATION_PROPOSAL_MAX_STRING_POOL_BYTES ||
		artifact.stringBytes.length > artifact.sourceByteLength * 4
	) {
		return "STRING_POOL_MISMATCH";
	}
	return null;
}

async function validateAdoptedArtifactCooperatively(
	artifact: OpenFabStationProposalArtifact,
	options: OpenFabStationProposalCooperativeHydrationOptions,
	limits: ResolvedCooperativeHydrationOptions,
): Promise<CooperativeArtifactValidationResult> {
	const decoded = await decodeCanonicalStringPoolCooperatively(artifact, options, limits);
	if (decoded.error) return decoded;
	const strings = decoded.strings;
	const columnError = await columnsShapeErrorCooperatively(
		artifact,
		strings.length,
		options,
		limits,
	);
	if (columnError) return { error: columnError, strings };
	const semanticError = await rowsAndIssuesShapeErrorCooperatively(
		artifact,
		strings,
		options,
		limits,
	);
	if (semanticError) return { error: semanticError, strings };
	const semanticFingerprint = await semanticFingerprintCooperatively(artifact, options, limits);
	if (semanticFingerprint !== artifact.semanticFingerprint) {
		return { error: "SEMANTIC_FINGERPRINT_MISMATCH", strings };
	}
	if (openFabStationProposalSnapshotFingerprint(artifact) !== artifact.snapshotFingerprint) {
		return { error: "SNAPSHOT_FINGERPRINT_MISMATCH", strings };
	}
	return { error: null, strings };
}

async function decodeCanonicalStringPoolCooperatively(
	artifact: OpenFabStationProposalArtifact,
	options: OpenFabStationProposalCooperativeHydrationOptions,
	limits: ResolvedCooperativeHydrationOptions,
): Promise<CooperativeArtifactValidationResult> {
	if (
		artifact.stringOffsets[0] !== 0 ||
		artifact.stringOffsets[artifact.stringCount] !== artifact.stringBytes.length
	) {
		return { error: "STRING_POOL_MISMATCH", strings: [] };
	}
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const encoder = new TextEncoder();
	const strings: string[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < artifact.stringCount; index++) {
		const from = artifact.stringOffsets[index] as number;
		const to = artifact.stringOffsets[index + 1] as number;
		if (
			to < from ||
			to > artifact.stringBytes.length ||
			to - from > OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES
		) {
			return { error: "STRING_POOL_MISMATCH", strings: [] };
		}
		const bytes = artifact.stringBytes.subarray(from, to);
		let decoded: string;
		try {
			decoded = decoder.decode(bytes);
		} catch {
			return { error: "STRING_POOL_MISMATCH", strings: [] };
		}
		if (
			!bytesEqual(bytes, encoder.encode(decoded)) ||
			decoded.normalize("NFC") !== decoded ||
			containsProhibitedArtifactText(decoded) ||
			seen.has(decoded)
		) {
			return { error: "STRING_POOL_MISMATCH", strings: [] };
		}
		seen.add(decoded);
		strings.push(decoded);
		if ((index + 1) % limits.stringsPerCheckpoint === 0) {
			await cooperativeCheckpoint(options);
		}
	}
	if (strings.length === 0 || strings[0] !== "") {
		return { error: "STRING_POOL_MISMATCH", strings: [] };
	}
	return { error: null, strings };
}

async function columnsShapeErrorCooperatively(
	artifact: OpenFabStationProposalArtifact,
	stringCount: number,
	options: OpenFabStationProposalCooperativeHydrationOptions,
	limits: ResolvedCooperativeHydrationOptions,
): Promise<OpenFabStationProposalArtifactErrorCode | null> {
	if (
		artifact.secondaryAliasOffsets[0] !== 0 ||
		artifact.secondaryAliasOffsets[artifact.rowCount] !==
			artifact.secondaryAliasStringIndices.length
	) {
		return "COLUMN_VALUE_MISMATCH";
	}
	for (let row = 0; row < artifact.rowCount; row++) {
		const aliasFrom = artifact.secondaryAliasOffsets[row] as number;
		const aliasTo = artifact.secondaryAliasOffsets[row + 1] as number;
		if (
			aliasFrom > aliasTo ||
			aliasTo - aliasFrom > OPENFAB_STATION_PROPOSAL_MAX_SECONDARY_ALIASES ||
			(artifact.identityScopeStringIndices[row] as number) >= stringCount ||
			(artifact.portKeyStringIndices[row] as number) >= stringCount ||
			(artifact.attachmentScopeStringIndices[row] as number) >= stringCount ||
			(artifact.attachmentAliasStringIndices[row] as number) >= stringCount ||
			(artifact.physicalGroupKeyStringIndices[row] as number) >= stringCount ||
			(artifact.organizationAliasStringIndices[row] as number) >= stringCount ||
			(artifact.stationMillimeters[row] as number) < 0 ||
			(artifact.lateralOffsetMillimeters[row] as number) < 0 ||
			(artifact.sides[row] as number) >= OPENFAB_STATION_PROPOSAL_SIDES.length ||
			(artifact.directions[row] as number) >= OPENFAB_STATION_PROPOSAL_DIRECTIONS.length ||
			(artifact.directionEvidence[row] as number) >=
				OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.length ||
			(artifact.portTypes[row] as number) >= OPENFAB_STATION_PROPOSAL_PORT_TYPES.length ||
			(artifact.physicalGroupKinds[row] as number) >= OPENFAB_STATION_PROPOSAL_PORT_TYPES.length ||
			(artifact.sourcePositionPresence[row] !== 0 && artifact.sourcePositionPresence[row] !== 1) ||
			(artifact.sourcePositionPresence[row] === 0 &&
				(artifact.sourceXMillimeters[row] !== 0 || artifact.sourceZMillimeters[row] !== 0))
		) {
			return "COLUMN_VALUE_MISMATCH";
		}
		for (let aliasIndex = aliasFrom; aliasIndex < aliasTo; aliasIndex++) {
			if ((artifact.secondaryAliasStringIndices[aliasIndex] as number) >= stringCount) {
				return "COLUMN_VALUE_MISMATCH";
			}
		}
		if ((row + 1) % limits.rowsPerCheckpoint === 0) {
			await cooperativeCheckpoint(options);
		}
	}
	return null;
}

async function rowsAndIssuesShapeErrorCooperatively(
	artifact: OpenFabStationProposalArtifact,
	strings: readonly string[],
	options: OpenFabStationProposalCooperativeHydrationOptions,
	limits: ResolvedCooperativeHydrationOptions,
): Promise<OpenFabStationProposalArtifactErrorCode | null> {
	const expectedPool = [""];
	const expectedIndices = new Map<string, number>([["", 0]]);
	const aliasOccurrences = new Map<string, { primary: number; secondary: number }>();
	const groupKinds = new Map<string, Map<number, number>>();
	let previous: OpenFabStationProposalRow | null = null;
	let unresolvedTypeCount = 0;
	let unresolvedSideCount = 0;
	let unresolvedGroupKindCount = 0;
	let groupKindWithoutKeyCount = 0;
	for (let row = 0; row < artifact.rowCount; row++) {
		const current = readRowUnchecked(artifact, strings, row);
		if (
			current.identityScope.length === 0 ||
			current.portKey.length === 0 ||
			current.attachmentScope.length === 0 ||
			current.attachmentAlias.length === 0 ||
			current.secondaryAliases.some((alias) => alias.length === 0) ||
			(current.direction === "UNKNOWN") !== (current.directionEvidence === "UNKNOWN") ||
			(current.side === "CENTER" && current.lateralOffsetMillimeters !== 0) ||
			((current.side === "LEFT" || current.side === "RIGHT") &&
				current.lateralOffsetMillimeters === 0)
		) {
			return "COLUMN_VALUE_MISMATCH";
		}
		for (let index = 1; index < current.secondaryAliases.length; index++) {
			if (
				compareStrings(
					current.secondaryAliases[index - 1] as string,
					current.secondaryAliases[index] as string,
				) > 0
			) {
				return "CANONICAL_ORDER_MISMATCH";
			}
		}
		if (previous && compareRows(previous, current) > 0) {
			return "CANONICAL_ORDER_MISMATCH";
		}
		previous = current;
		for (const value of [
			current.identityScope,
			current.portKey,
			...current.secondaryAliases,
			current.attachmentScope,
			current.attachmentAlias,
			current.physicalGroupKey,
			current.organizationAlias,
		]) {
			if (!expectedIndices.has(value)) {
				expectedIndices.set(value, expectedPool.length);
				expectedPool.push(value);
			}
		}
		if (current.portType === "UNRESOLVED") unresolvedTypeCount++;
		if (current.side === "UNRESOLVED") unresolvedSideCount++;
		addAliasOccurrence(
			aliasOccurrences,
			scopedKey(current.identityScope, current.portKey),
			"primary",
		);
		for (const alias of current.secondaryAliases) {
			addAliasOccurrence(aliasOccurrences, scopedKey(current.identityScope, alias), "secondary");
		}
		if (current.physicalGroupKey.length === 0) {
			if (current.physicalGroupKind !== "UNRESOLVED") groupKindWithoutKeyCount++;
		} else {
			if (current.physicalGroupKind === "UNRESOLVED") unresolvedGroupKindCount++;
			const groupKey = scopedKey(current.identityScope, current.physicalGroupKey);
			const counts = groupKinds.get(groupKey) ?? new Map<number, number>();
			const kind = OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(current.physicalGroupKind);
			counts.set(kind, (counts.get(kind) ?? 0) + 1);
			groupKinds.set(groupKey, counts);
		}
		if ((row + 1) % limits.rowsPerCheckpoint === 0) {
			await cooperativeCheckpoint(options);
		}
	}
	if (expectedPool.length !== strings.length) return "CANONICAL_ORDER_MISMATCH";
	for (let index = 0; index < expectedPool.length; index++) {
		if (expectedPool[index] !== strings[index]) return "CANONICAL_ORDER_MISMATCH";
		if ((index + 1) % limits.stringsPerCheckpoint === 0) {
			await cooperativeCheckpoint(options);
		}
	}

	let primaryCollisionCount = 0;
	let primarySecondaryCollisionCount = 0;
	let secondaryCollisionCount = 0;
	let scanned = 0;
	for (const occurrence of aliasOccurrences.values()) {
		if (occurrence.primary > 1) primaryCollisionCount += occurrence.primary;
		if (occurrence.primary > 0 && occurrence.secondary > 0) {
			primarySecondaryCollisionCount += occurrence.primary + occurrence.secondary;
		}
		if (occurrence.secondary > 1) secondaryCollisionCount += occurrence.secondary;
		if (++scanned % limits.rowsPerCheckpoint === 0) {
			await cooperativeCheckpoint(options);
		}
	}
	let groupKindConflictCount = 0;
	scanned = 0;
	for (const counts of groupKinds.values()) {
		if ([...counts.keys()].filter((kind) => kind !== 0).length > 1) {
			for (const count of counts.values()) groupKindConflictCount += count;
		}
		if (++scanned % limits.rowsPerCheckpoint === 0) {
			await cooperativeCheckpoint(options);
		}
	}
	if (
		artifact.issueCounts[issueIndex("UNKNOWN_COLUMN")] !== artifact.unknownColumnCount ||
		artifact.issueCounts[issueIndex("UNRESOLVED_PORT_TYPE")] !== unresolvedTypeCount ||
		artifact.issueCounts[issueIndex("UNRESOLVED_SIDE")] !== unresolvedSideCount ||
		artifact.issueCounts[issueIndex("UNRESOLVED_PHYSICAL_GROUP_KIND")] !==
			unresolvedGroupKindCount ||
		artifact.issueCounts[issueIndex("PHYSICAL_GROUP_KIND_WITHOUT_KEY")] !==
			groupKindWithoutKeyCount ||
		artifact.issueCounts[issueIndex("PRIMARY_ALIAS_COLLISION")] !== primaryCollisionCount ||
		artifact.issueCounts[issueIndex("PRIMARY_SECONDARY_ALIAS_COLLISION")] !==
			primarySecondaryCollisionCount ||
		artifact.issueCounts[issueIndex("SECONDARY_ALIAS_COLLISION")] !== secondaryCollisionCount ||
		artifact.issueCounts[issueIndex("PHYSICAL_GROUP_KIND_CONFLICT")] !== groupKindConflictCount
	) {
		return "ISSUE_COUNT_MISMATCH";
	}
	return null;
}

async function semanticFingerprintCooperatively(
	artifact: OpenFabStationProposalArtifact,
	options: OpenFabStationProposalCooperativeHydrationOptions,
	limits: ResolvedCooperativeHydrationOptions,
): Promise<string> {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([artifact.schemaId]);
	checksum.addNumbers([
		artifact.schemaVersion,
		artifact.sourceRecordCount,
		artifact.rowCount,
		artifact.rejectedRowCount,
		artifact.unknownColumnCount,
		artifact.stringCount,
	]);
	await checksum.addViewsCooperatively(
		[
			artifact.stringBytes,
			artifact.stringOffsets,
			artifact.secondaryAliasOffsets,
			artifact.secondaryAliasStringIndices,
			...ROW_ARRAY_KEYS.map((key) => artifact[key]),
			artifact.issueCounts,
		],
		() => cooperativeCheckpoint(options),
		limits.checksumBytesPerCheckpoint,
	);
	return `${SEMANTIC_FINGERPRINT_PREFIX}${checksum.digest()}`;
}

export function validateOpenFabStationProposalArtifact(
	value: unknown,
): asserts value is OpenFabStationProposalArtifact {
	const error = openFabStationProposalArtifactShapeError(value);
	if (error) throw new Error(error);
}

/**
 * Transfer an untrusted snapshot into a private accessor-only facade. The caller's positive-length
 * buffers are detached, so later mutation of the supplied object cannot invalidate the adopted view.
 */
export function hydrateOpenFabStationProposalArtifact(
	value: unknown,
): HydratedOpenFabStationProposalArtifact {
	validateOpenFabStationProposalArtifact(value);
	const strings = decodeCanonicalStringPool(value);
	const adopted = structuredClone(value, {
		transfer: openFabStationProposalArtifactTransfersUnchecked(value),
	});
	return createHydratedArtifactFacade(adopted, strings);
}

/** Consume and validate a transferable snapshot in bounded, cancellable main-thread slices. */
export async function hydrateOpenFabStationProposalArtifactCooperatively(
	value: unknown,
	options: OpenFabStationProposalCooperativeHydrationOptions,
): Promise<HydratedOpenFabStationProposalArtifact> {
	const limits = resolveCooperativeHydrationOptions(options);
	throwIfHydrationAborted(options.signal);
	const shallowError = openFabStationProposalArtifactShallowShapeError(value);
	if (shallowError) throw new Error(shallowError);
	const source = value as OpenFabStationProposalArtifact;
	const adopted = structuredClone(source, {
		transfer: openFabStationProposalArtifactTransfersUnchecked(source),
	});
	await cooperativeCheckpoint(options);
	const validation = await validateAdoptedArtifactCooperatively(adopted, options, limits);
	if (validation.error) throw new Error(validation.error);
	await cooperativeCheckpoint(options);
	return createHydratedArtifactFacade(adopted, validation.strings);
}

/**
 * Copy one genuine hydrated facade into fresh transferable SoA ownership without detaching or
 * exposing its private adopted source. Copying is byte-chunked and yields on a configurable time
 * slice; authority is issued only after the complete copy and final cancellation checkpoint.
 */
export async function captureOpenFabStationProposalArtifactCooperatively(
	facade: HydratedOpenFabStationProposalArtifact,
	options: OpenFabStationProposalCooperativeCaptureOptions,
): Promise<OpenFabStationProposalArtifactCapture> {
	const adopted = adoptedArtifactsByHydratedFacade.get(facade);
	if (!adopted) throw new Error("STATION_PROPOSAL_CAPTURE_SOURCE_INVALID");
	const scheduler = createCooperativeArtifactCaptureScheduler(options);
	const entries: Array<
		readonly [OpenFabStationProposalArtifactArrayKey, OpenFabStationProposalArtifactArray]
	> = [];
	for (const key of ARTIFACT_ARRAY_KEYS) {
		entries.push([key, await copyArtifactArrayCooperatively(adopted[key], scheduler)]);
	}
	await scheduler.checkpointNow();
	const arrays = Object.fromEntries(entries) as Pick<
		OpenFabStationProposalArtifact,
		OpenFabStationProposalArtifactArrayKey
	>;
	const artifact = Object.freeze({
		kind: adopted.kind,
		schemaId: adopted.schemaId,
		schemaVersion: adopted.schemaVersion,
		sourceByteLength: adopted.sourceByteLength,
		sourceRecordCount: adopted.sourceRecordCount,
		rowCount: adopted.rowCount,
		rejectedRowCount: adopted.rejectedRowCount,
		unknownColumnCount: adopted.unknownColumnCount,
		stringCount: adopted.stringCount,
		...arrays,
		semanticFingerprint: adopted.semanticFingerprint,
		snapshotFingerprint: adopted.snapshotFingerprint,
	}) satisfies OpenFabStationProposalArtifact;
	scheduler.throwIfAborted();
	const capture = Object.freeze({ artifact });
	capturedArtifactAuthorities.set(capture, facade);
	return capture;
}

/** Consume exact-facade authority for one capture. Every success or failure is terminal. */
export function consumeOpenFabStationProposalArtifactCaptureAuthority(
	capture: OpenFabStationProposalArtifactCapture,
	facade: HydratedOpenFabStationProposalArtifact,
): boolean {
	const authorizedFacade = capturedArtifactAuthorities.get(capture);
	capturedArtifactAuthorities.delete(capture);
	return authorizedFacade === facade;
}

/**
 * Terminal O(column-count) release for the exact facade that minted a cooperative capture.
 * The Worker remains responsible for full semantic validation after transfer.
 */
export function consumeOpenFabStationProposalArtifactCaptureTransfer(
	capture: OpenFabStationProposalArtifactCapture,
	facade: HydratedOpenFabStationProposalArtifact,
): ReleasedOpenFabStationProposalArtifactCaptureTransfer {
	const authorizedFacade = capturedArtifactAuthorities.get(capture);
	capturedArtifactAuthorities.delete(capture);
	if (authorizedFacade !== facade) {
		throw new Error("STATION_PROPOSAL_CAPTURE_AUTHORITY_INVALID");
	}
	return Object.freeze({
		artifact: capture.artifact,
		transfers: Object.freeze(openFabStationProposalArtifactTransfersUnchecked(capture.artifact)),
	});
}

export function revokeOpenFabStationProposalArtifactCaptureAuthority(
	capture: OpenFabStationProposalArtifactCapture,
): void {
	capturedArtifactAuthorities.delete(capture);
}

function createHydratedArtifactFacade(
	adopted: OpenFabStationProposalArtifact,
	strings: readonly string[],
): HydratedOpenFabStationProposalArtifact {
	const facade = Object.freeze({
		kind: "hydrated-openfab-station-proposal-artifact" as const,
		schemaId: adopted.schemaId,
		schemaVersion: adopted.schemaVersion,
		sourceByteLength: adopted.sourceByteLength,
		sourceRecordCount: adopted.sourceRecordCount,
		rowCount: adopted.rowCount,
		rejectedRowCount: adopted.rejectedRowCount,
		unknownColumnCount: adopted.unknownColumnCount,
		semanticFingerprint: adopted.semanticFingerprint,
		snapshotFingerprint: adopted.snapshotFingerprint,
		readRow(row: number): OpenFabStationProposalRow {
			assertRowIndex(adopted, row);
			return readRowUnchecked(adopted, strings, row);
		},
		issueCount(code: OpenFabStationProposalIssueCode): number {
			return adopted.issueCounts[issueIndex(code)] as number;
		},
	});
	adoptedArtifactsByHydratedFacade.set(facade, adopted);
	return facade;
}

export function openFabStationProposalArtifactTransfers(
	artifact: OpenFabStationProposalArtifact,
): ArrayBuffer[] {
	validateOpenFabStationProposalArtifact(artifact);
	return openFabStationProposalArtifactTransfersUnchecked(artifact);
}

export function readOpenFabStationProposalRow(
	artifact: OpenFabStationProposalArtifact,
	row: number,
): OpenFabStationProposalRow {
	assertRowIndex(artifact, row);
	const strings = decodeCanonicalStringPool(artifact);
	return readRowUnchecked(artifact, strings, row);
}

export function openFabStationProposalReadFailureShapeError(
	value: unknown,
): OpenFabStationProposalArtifactErrorCode | null {
	if (!isRecord(value)) return "NOT_OBJECT";
	if (!hasExactKeys(value, FAILURE_KEYS)) return "CONTRACT_MISMATCH";
	if (
		value.kind !== FAILURE_KIND ||
		value.schemaId !== OPENFAB_STATION_PROPOSAL_SCHEMA_ID ||
		value.schemaVersion !== OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION ||
		!OPENFAB_STATION_PROPOSAL_READ_FAILURE_CODES.includes(
			value.code as OpenFabStationProposalReadFailureCode,
		)
	) {
		return "CONTRACT_MISMATCH";
	}
	if (
		!isUint32(value.sourceByteLength) ||
		!isUint32(value.recordsSeen) ||
		!isUint32(value.acceptedRowCount) ||
		!isUint32(value.rejectedRowCount) ||
		!isUint32(value.unknownColumnCount) ||
		value.acceptedRowCount + value.rejectedRowCount > value.recordsSeen
	) {
		return "SCALAR_MISMATCH";
	}
	if (!(value.issueCounts instanceof Uint32Array)) return "TYPED_ARRAY_MISMATCH";
	if (!arraysOwnUniqueBuffers([value.issueCounts])) return "BUFFER_OWNERSHIP_MISMATCH";
	if (value.issueCounts.length !== OPENFAB_STATION_PROPOSAL_ISSUE_CODES.length) {
		return "COLUMN_LENGTH_MISMATCH";
	}
	const failure = value as unknown as OpenFabStationProposalReadFailure;
	if (failure.issueCounts[issueIndex("UNKNOWN_COLUMN")] !== failure.unknownColumnCount) {
		return "ISSUE_COUNT_MISMATCH";
	}
	if (openFabStationProposalReadFailureFingerprint(failure) !== failure.snapshotFingerprint) {
		return "SNAPSHOT_FINGERPRINT_MISMATCH";
	}
	return null;
}

export function validateOpenFabStationProposalReadFailure(
	value: unknown,
): asserts value is OpenFabStationProposalReadFailure {
	const error = openFabStationProposalReadFailureShapeError(value);
	if (error) throw new Error(error);
}

export function hydrateOpenFabStationProposalReadFailure(
	value: unknown,
): HydratedOpenFabStationProposalReadFailure {
	validateOpenFabStationProposalReadFailure(value);
	const adopted = structuredClone(value, {
		transfer: value.issueCounts.byteLength > 0 ? [value.issueCounts.buffer as ArrayBuffer] : [],
	});
	return Object.freeze({
		kind: "hydrated-openfab-station-proposal-read-failure" as const,
		schemaId: adopted.schemaId,
		schemaVersion: adopted.schemaVersion,
		code: adopted.code,
		sourceByteLength: adopted.sourceByteLength,
		recordsSeen: adopted.recordsSeen,
		acceptedRowCount: adopted.acceptedRowCount,
		rejectedRowCount: adopted.rejectedRowCount,
		unknownColumnCount: adopted.unknownColumnCount,
		snapshotFingerprint: adopted.snapshotFingerprint,
		issueCount(code: OpenFabStationProposalIssueCode): number {
			return adopted.issueCounts[issueIndex(code)] as number;
		},
	});
}

export function openFabStationProposalReadFailureTransfers(
	failure: OpenFabStationProposalReadFailure,
): ArrayBuffer[] {
	validateOpenFabStationProposalReadFailure(failure);
	return failure.issueCounts.byteLength > 0 ? [failure.issueCounts.buffer as ArrayBuffer] : [];
}

export function hydrateOpenFabStationProposalReadResult(
	value: unknown,
): HydratedOpenFabStationProposalReadResult {
	if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("CONTRACT_MISMATCH");
	if (value.ok) {
		if (!hasExactKeys(value, ["ok", "artifact"] as const)) {
			throw new Error("CONTRACT_MISMATCH");
		}
		return Object.freeze({
			ok: true,
			artifact: hydrateOpenFabStationProposalArtifact(value.artifact),
		});
	}
	if (!hasExactKeys(value, ["ok", "failure"] as const)) throw new Error("CONTRACT_MISMATCH");
	return Object.freeze({
		ok: false,
		failure: hydrateOpenFabStationProposalReadFailure(value.failure),
	});
}

export async function hydrateOpenFabStationProposalReadResultCooperatively(
	value: unknown,
	options: OpenFabStationProposalCooperativeHydrationOptions,
): Promise<HydratedOpenFabStationProposalReadResult> {
	if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("CONTRACT_MISMATCH");
	if (value.ok) {
		if (!hasExactKeys(value, ["ok", "artifact"] as const)) {
			throw new Error("CONTRACT_MISMATCH");
		}
		return Object.freeze({
			ok: true,
			artifact: await hydrateOpenFabStationProposalArtifactCooperatively(value.artifact, options),
		});
	}
	if (!hasExactKeys(value, ["ok", "failure"] as const)) throw new Error("CONTRACT_MISMATCH");
	throwIfHydrationAborted(options.signal);
	return Object.freeze({
		ok: false,
		failure: hydrateOpenFabStationProposalReadFailure(value.failure),
	});
}

export function issueIndex(code: OpenFabStationProposalIssueCode): number {
	return OPENFAB_STATION_PROPOSAL_ISSUE_CODES.indexOf(code);
}

function artifactArraysHaveExactTypes(value: Record<string, unknown>): boolean {
	return (
		value.stringBytes instanceof Uint8Array &&
		value.stringOffsets instanceof Uint32Array &&
		value.identityScopeStringIndices instanceof Uint32Array &&
		value.portKeyStringIndices instanceof Uint32Array &&
		value.secondaryAliasOffsets instanceof Uint32Array &&
		value.secondaryAliasStringIndices instanceof Uint32Array &&
		value.attachmentScopeStringIndices instanceof Uint32Array &&
		value.attachmentAliasStringIndices instanceof Uint32Array &&
		value.stationMillimeters instanceof Int32Array &&
		value.sides instanceof Uint8Array &&
		value.lateralOffsetMillimeters instanceof Int32Array &&
		value.directions instanceof Uint8Array &&
		value.directionEvidence instanceof Uint8Array &&
		value.portTypes instanceof Uint8Array &&
		value.physicalGroupKeyStringIndices instanceof Uint32Array &&
		value.physicalGroupKinds instanceof Uint8Array &&
		value.organizationAliasStringIndices instanceof Uint32Array &&
		value.sourcePositionPresence instanceof Uint8Array &&
		value.sourceXMillimeters instanceof Int32Array &&
		value.sourceZMillimeters instanceof Int32Array &&
		value.issueCounts instanceof Uint32Array
	);
}

function arraysOwnUniqueBuffers(arrays: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBuffer>();
	for (const array of arrays) {
		if (
			!(array.buffer instanceof ArrayBuffer) ||
			array.byteOffset !== 0 ||
			array.byteLength !== array.buffer.byteLength ||
			buffers.has(array.buffer)
		) {
			return false;
		}
		buffers.add(array.buffer);
	}
	return true;
}

function decodeCanonicalStringPool(artifact: OpenFabStationProposalArtifact): readonly string[] {
	if (artifact.stringOffsets[0] !== 0) throw new Error("STRING_POOL_MISMATCH");
	if (artifact.stringOffsets[artifact.stringCount] !== artifact.stringBytes.length) {
		throw new Error("STRING_POOL_MISMATCH");
	}
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const encoder = new TextEncoder();
	const strings: string[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < artifact.stringCount; index++) {
		const from = artifact.stringOffsets[index] as number;
		const to = artifact.stringOffsets[index + 1] as number;
		if (
			to < from ||
			to > artifact.stringBytes.length ||
			to - from > OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES
		) {
			throw new Error("STRING_POOL_MISMATCH");
		}
		const bytes = artifact.stringBytes.subarray(from, to);
		const decoded = decoder.decode(bytes);
		if (
			!bytesEqual(bytes, encoder.encode(decoded)) ||
			decoded.normalize("NFC") !== decoded ||
			containsProhibitedArtifactText(decoded) ||
			seen.has(decoded)
		) {
			throw new Error("STRING_POOL_MISMATCH");
		}
		seen.add(decoded);
		strings.push(decoded);
	}
	if (strings.length === 0 || strings[0] !== "") throw new Error("STRING_POOL_MISMATCH");
	return strings;
}

function columnsHaveValidValues(
	artifact: OpenFabStationProposalArtifact,
	stringCount: number,
): boolean {
	for (let row = 0; row < artifact.rowCount; row++) {
		if (
			(artifact.identityScopeStringIndices[row] as number) >= stringCount ||
			(artifact.portKeyStringIndices[row] as number) >= stringCount ||
			(artifact.attachmentScopeStringIndices[row] as number) >= stringCount ||
			(artifact.attachmentAliasStringIndices[row] as number) >= stringCount ||
			(artifact.physicalGroupKeyStringIndices[row] as number) >= stringCount ||
			(artifact.organizationAliasStringIndices[row] as number) >= stringCount ||
			(artifact.stationMillimeters[row] as number) < 0 ||
			(artifact.lateralOffsetMillimeters[row] as number) < 0 ||
			(artifact.sides[row] as number) >= OPENFAB_STATION_PROPOSAL_SIDES.length ||
			(artifact.directions[row] as number) >= OPENFAB_STATION_PROPOSAL_DIRECTIONS.length ||
			(artifact.directionEvidence[row] as number) >=
				OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.length ||
			(artifact.portTypes[row] as number) >= OPENFAB_STATION_PROPOSAL_PORT_TYPES.length ||
			(artifact.physicalGroupKinds[row] as number) >= OPENFAB_STATION_PROPOSAL_PORT_TYPES.length ||
			(artifact.sourcePositionPresence[row] !== 0 && artifact.sourcePositionPresence[row] !== 1) ||
			(artifact.sourcePositionPresence[row] === 0 &&
				(artifact.sourceXMillimeters[row] !== 0 || artifact.sourceZMillimeters[row] !== 0))
		) {
			return false;
		}
	}
	if (artifact.secondaryAliasOffsets[0] !== 0) return false;
	if (
		artifact.secondaryAliasOffsets[artifact.rowCount] !==
		artifact.secondaryAliasStringIndices.length
	) {
		return false;
	}
	for (let row = 0; row < artifact.rowCount; row++) {
		if (
			(artifact.secondaryAliasOffsets[row] as number) >
				(artifact.secondaryAliasOffsets[row + 1] as number) ||
			(artifact.secondaryAliasOffsets[row + 1] as number) -
				(artifact.secondaryAliasOffsets[row] as number) >
				OPENFAB_STATION_PROPOSAL_MAX_SECONDARY_ALIASES
		) {
			return false;
		}
	}
	for (const index of artifact.secondaryAliasStringIndices) {
		if (index >= stringCount) return false;
	}
	return true;
}

function rowsAndStringPoolAreCanonical(
	artifact: OpenFabStationProposalArtifact,
	strings: readonly string[],
): boolean {
	const expectedPool = [""];
	const expectedIndices = new Map<string, number>([["", 0]]);
	let previous: OpenFabStationProposalRow | null = null;
	for (let row = 0; row < artifact.rowCount; row++) {
		const current = readRowUnchecked(artifact, strings, row);
		if (
			current.identityScope.length === 0 ||
			current.portKey.length === 0 ||
			current.attachmentScope.length === 0 ||
			current.attachmentAlias.length === 0 ||
			current.secondaryAliases.some((alias) => alias.length === 0) ||
			(current.direction === "UNKNOWN") !== (current.directionEvidence === "UNKNOWN") ||
			(current.side === "CENTER" && current.lateralOffsetMillimeters !== 0) ||
			((current.side === "LEFT" || current.side === "RIGHT") &&
				current.lateralOffsetMillimeters === 0)
		) {
			return false;
		}
		for (let index = 1; index < current.secondaryAliases.length; index++) {
			if (
				compareStrings(
					current.secondaryAliases[index - 1] as string,
					current.secondaryAliases[index] as string,
				) > 0
			) {
				return false;
			}
		}
		if (previous && compareRows(previous, current) > 0) return false;
		previous = current;
		for (const value of [
			current.identityScope,
			current.portKey,
			...current.secondaryAliases,
			current.attachmentScope,
			current.attachmentAlias,
			current.physicalGroupKey,
			current.organizationAlias,
		]) {
			if (!expectedIndices.has(value)) {
				expectedIndices.set(value, expectedPool.length);
				expectedPool.push(value);
			}
		}
	}
	return (
		expectedPool.length === strings.length &&
		expectedPool.every((value, index) => value === strings[index])
	);
}

function issueCountsAreConsistent(
	artifact: OpenFabStationProposalArtifact,
	strings: readonly string[],
): boolean {
	if (artifact.issueCounts[issueIndex("UNKNOWN_COLUMN")] !== artifact.unknownColumnCount) {
		return false;
	}
	let unresolvedTypeCount = 0;
	let unresolvedSideCount = 0;
	let unresolvedGroupKindCount = 0;
	let groupKindWithoutKeyCount = 0;
	const aliasOccurrences = new Map<string, { primary: number; secondary: number }>();
	const groupKinds = new Map<string, Map<number, number>>();
	for (let row = 0; row < artifact.rowCount; row++) {
		if (artifact.portTypes[row] === 0) unresolvedTypeCount++;
		if (artifact.sides[row] === 0) unresolvedSideCount++;
		const identityScope = strings[artifact.identityScopeStringIndices[row] as number] as string;
		const primary = strings[artifact.portKeyStringIndices[row] as number] as string;
		addAliasOccurrence(aliasOccurrences, scopedKey(identityScope, primary), "primary");
		const aliasFrom = artifact.secondaryAliasOffsets[row] as number;
		const aliasTo = artifact.secondaryAliasOffsets[row + 1] as number;
		for (let index = aliasFrom; index < aliasTo; index++) {
			const alias = strings[artifact.secondaryAliasStringIndices[index] as number] as string;
			addAliasOccurrence(aliasOccurrences, scopedKey(identityScope, alias), "secondary");
		}
		const groupKey = strings[artifact.physicalGroupKeyStringIndices[row] as number] as string;
		const groupKind = artifact.physicalGroupKinds[row] as number;
		if (groupKey.length === 0) {
			if (groupKind !== 0) groupKindWithoutKeyCount++;
		} else {
			if (groupKind === 0) unresolvedGroupKindCount++;
			const counts =
				groupKinds.get(scopedKey(identityScope, groupKey)) ?? new Map<number, number>();
			counts.set(groupKind, (counts.get(groupKind) ?? 0) + 1);
			groupKinds.set(scopedKey(identityScope, groupKey), counts);
		}
	}
	let primaryCollisionCount = 0;
	let primarySecondaryCollisionCount = 0;
	let secondaryCollisionCount = 0;
	for (const occurrence of aliasOccurrences.values()) {
		if (occurrence.primary > 1) primaryCollisionCount += occurrence.primary;
		if (occurrence.primary > 0 && occurrence.secondary > 0) {
			primarySecondaryCollisionCount += occurrence.primary + occurrence.secondary;
		}
		if (occurrence.secondary > 1) secondaryCollisionCount += occurrence.secondary;
	}
	let groupKindConflictCount = 0;
	for (const counts of groupKinds.values()) {
		const resolvedKinds = [...counts.keys()].filter((kind) => kind !== 0);
		if (resolvedKinds.length > 1) {
			for (const count of counts.values()) groupKindConflictCount += count;
		}
	}
	return (
		artifact.issueCounts[issueIndex("UNRESOLVED_PORT_TYPE")] === unresolvedTypeCount &&
		artifact.issueCounts[issueIndex("UNRESOLVED_SIDE")] === unresolvedSideCount &&
		artifact.issueCounts[issueIndex("UNRESOLVED_PHYSICAL_GROUP_KIND")] ===
			unresolvedGroupKindCount &&
		artifact.issueCounts[issueIndex("PHYSICAL_GROUP_KIND_WITHOUT_KEY")] ===
			groupKindWithoutKeyCount &&
		artifact.issueCounts[issueIndex("PRIMARY_ALIAS_COLLISION")] === primaryCollisionCount &&
		artifact.issueCounts[issueIndex("PRIMARY_SECONDARY_ALIAS_COLLISION")] ===
			primarySecondaryCollisionCount &&
		artifact.issueCounts[issueIndex("SECONDARY_ALIAS_COLLISION")] === secondaryCollisionCount &&
		artifact.issueCounts[issueIndex("PHYSICAL_GROUP_KIND_CONFLICT")] === groupKindConflictCount
	);
}

function readRowUnchecked(
	artifact: OpenFabStationProposalArtifact,
	strings: readonly string[],
	row: number,
): OpenFabStationProposalRow {
	const aliasFrom = artifact.secondaryAliasOffsets[row] as number;
	const aliasTo = artifact.secondaryAliasOffsets[row + 1] as number;
	const secondaryAliases: string[] = [];
	for (let index = aliasFrom; index < aliasTo; index++) {
		secondaryAliases.push(strings[artifact.secondaryAliasStringIndices[index] as number] as string);
	}
	const hasSourcePosition = artifact.sourcePositionPresence[row] === 1;
	return Object.freeze({
		identityScope: strings[artifact.identityScopeStringIndices[row] as number] as string,
		portKey: strings[artifact.portKeyStringIndices[row] as number] as string,
		secondaryAliases: Object.freeze(secondaryAliases),
		attachmentScope: strings[artifact.attachmentScopeStringIndices[row] as number] as string,
		attachmentAlias: strings[artifact.attachmentAliasStringIndices[row] as number] as string,
		stationMillimeters: artifact.stationMillimeters[row] as number,
		side: OPENFAB_STATION_PROPOSAL_SIDES[
			artifact.sides[row] as number
		] as OpenFabStationProposalSide,
		lateralOffsetMillimeters: artifact.lateralOffsetMillimeters[row] as number,
		direction: OPENFAB_STATION_PROPOSAL_DIRECTIONS[
			artifact.directions[row] as number
		] as OpenFabStationProposalDirection,
		directionEvidence: OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE[
			artifact.directionEvidence[row] as number
		] as OpenFabStationProposalDirectionEvidence,
		portType: OPENFAB_STATION_PROPOSAL_PORT_TYPES[
			artifact.portTypes[row] as number
		] as OpenFabStationProposalPortType,
		physicalGroupKey: strings[artifact.physicalGroupKeyStringIndices[row] as number] as string,
		physicalGroupKind: OPENFAB_STATION_PROPOSAL_PORT_TYPES[
			artifact.physicalGroupKinds[row] as number
		] as OpenFabStationProposalPortType,
		organizationAlias: strings[artifact.organizationAliasStringIndices[row] as number] as string,
		sourceXMillimeters: hasSourcePosition ? (artifact.sourceXMillimeters[row] as number) : null,
		sourceZMillimeters: hasSourcePosition ? (artifact.sourceZMillimeters[row] as number) : null,
	});
}

export function compareOpenFabStationProposalRows(
	left: OpenFabStationProposalRow,
	right: OpenFabStationProposalRow,
): number {
	return compareRows(left, right);
}

function compareRows(left: OpenFabStationProposalRow, right: OpenFabStationProposalRow): number {
	return (
		compareStrings(left.identityScope, right.identityScope) ||
		compareStrings(left.portKey, right.portKey) ||
		compareStringArrays(left.secondaryAliases, right.secondaryAliases) ||
		compareStrings(left.attachmentScope, right.attachmentScope) ||
		compareStrings(left.attachmentAlias, right.attachmentAlias) ||
		left.stationMillimeters - right.stationMillimeters ||
		OPENFAB_STATION_PROPOSAL_SIDES.indexOf(left.side) -
			OPENFAB_STATION_PROPOSAL_SIDES.indexOf(right.side) ||
		left.lateralOffsetMillimeters - right.lateralOffsetMillimeters ||
		OPENFAB_STATION_PROPOSAL_DIRECTIONS.indexOf(left.direction) -
			OPENFAB_STATION_PROPOSAL_DIRECTIONS.indexOf(right.direction) ||
		OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.indexOf(left.directionEvidence) -
			OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.indexOf(right.directionEvidence) ||
		OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(left.portType) -
			OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(right.portType) ||
		compareStrings(left.physicalGroupKey, right.physicalGroupKey) ||
		OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(left.physicalGroupKind) -
			OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(right.physicalGroupKind) ||
		compareStrings(left.organizationAlias, right.organizationAlias) ||
		compareNullableNumber(left.sourceXMillimeters, right.sourceXMillimeters) ||
		compareNullableNumber(left.sourceZMillimeters, right.sourceZMillimeters)
	);
}

function compareStrings(left: string, right: string): number {
	const leftPoints = left[Symbol.iterator]();
	const rightPoints = right[Symbol.iterator]();
	while (true) {
		const leftNext = leftPoints.next();
		const rightNext = rightPoints.next();
		if (leftNext.done || rightNext.done) {
			if (leftNext.done && rightNext.done) return 0;
			return leftNext.done ? -1 : 1;
		}
		const difference =
			(leftNext.value.codePointAt(0) as number) - (rightNext.value.codePointAt(0) as number);
		if (difference !== 0) return difference;
	}
}

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index++) {
		const difference = compareStrings(left[index] as string, right[index] as string);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function compareNullableNumber(left: number | null, right: number | null): number {
	if (left === null || right === null) {
		if (left === right) return 0;
		return left === null ? -1 : 1;
	}
	return left - right;
}

function scopedKey(scope: string, alias: string): string {
	return `${scope.length}:${scope}${alias}`;
}

function addAliasOccurrence(
	target: Map<string, { primary: number; secondary: number }>,
	key: string,
	kind: "primary" | "secondary",
): void {
	const occurrence = target.get(key) ?? { primary: 0, secondary: 0 };
	occurrence[kind]++;
	target.set(key, occurrence);
}

function openFabStationProposalArtifactTransfersUnchecked(
	artifact: OpenFabStationProposalArtifact,
): ArrayBuffer[] {
	return ARTIFACT_ARRAY_KEYS.map((key) => artifact[key].buffer as ArrayBuffer).filter(
		(buffer) => buffer.byteLength > 0,
	);
}

function assertRowIndex(artifact: OpenFabStationProposalArtifact, row: number): void {
	if (!Number.isSafeInteger(row) || row < 0 || row >= artifact.rowCount) {
		throw new Error("ROW_INDEX_OUT_OF_RANGE");
	}
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function containsProhibitedArtifactText(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) as number;
		if (codePoint <= 0x1f || codePoint === 0x7f) return true;
	}
	return /\p{Cf}/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function copyArtifactArrayCooperatively(
	source: OpenFabStationProposalArtifactArray,
	scheduler: CooperativeArtifactCaptureScheduler,
): Promise<OpenFabStationProposalArtifactArray> {
	scheduler.throwIfAborted();
	const targetBytes = new Uint8Array(source.byteLength);
	const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
	for (let offset = 0; offset < sourceBytes.length; offset += scheduler.bytesPerChunk) {
		const end = Math.min(sourceBytes.length, offset + scheduler.bytesPerChunk);
		targetBytes.set(sourceBytes.subarray(offset, end), offset);
		scheduler.throwIfAborted();
		await scheduler.checkpointIfDue();
	}
	scheduler.throwIfAborted();
	if (source instanceof Uint8Array) return targetBytes;
	if (source instanceof Uint32Array) return new Uint32Array(targetBytes.buffer);
	if (source instanceof Int32Array) return new Int32Array(targetBytes.buffer);
	throw new Error("STATION_PROPOSAL_CAPTURE_ARRAY_INVALID");
}

function createCooperativeArtifactCaptureScheduler(
	options: OpenFabStationProposalCooperativeCaptureOptions,
): CooperativeArtifactCaptureScheduler {
	if (!options || typeof options.checkpoint !== "function") {
		throw new Error("INVALID_COOPERATIVE_CAPTURE_OPTIONS");
	}
	const now = options.now ?? Date.now;
	if (typeof now !== "function") throw new Error("INVALID_COOPERATIVE_CAPTURE_OPTIONS");
	const sliceMilliseconds = boundedCooperativeCaptureSlice(options.sliceMilliseconds);
	const bytesPerChunk = boundedCooperativeCaptureBytes(options.bytesPerChunk);
	throwIfCaptureAborted(options.signal);
	let sliceStartedAt = readCooperativeCaptureTime(now);
	const checkpoint = async (): Promise<void> => {
		throwIfCaptureAborted(options.signal);
		await options.checkpoint();
		throwIfCaptureAborted(options.signal);
		sliceStartedAt = readCooperativeCaptureTime(now);
	};
	return Object.freeze({
		bytesPerChunk,
		async checkpointIfDue(): Promise<void> {
			throwIfCaptureAborted(options.signal);
			const current = readCooperativeCaptureTime(now);
			if (current < sliceStartedAt) {
				sliceStartedAt = current;
				return;
			}
			if (current - sliceStartedAt < sliceMilliseconds) return;
			await checkpoint();
		},
		checkpointNow: checkpoint,
		throwIfAborted(): void {
			throwIfCaptureAborted(options.signal);
		},
	});
}

function boundedCooperativeCaptureSlice(value: number | undefined): number {
	const resolved = value ?? DEFAULT_COOPERATIVE_CAPTURE_SLICE_MILLISECONDS;
	if (
		!Number.isFinite(resolved) ||
		resolved <= 0 ||
		resolved > MAX_COOPERATIVE_CAPTURE_SLICE_MILLISECONDS
	) {
		throw new Error("INVALID_COOPERATIVE_CAPTURE_OPTIONS");
	}
	return resolved;
}

function boundedCooperativeCaptureBytes(value: number | undefined): number {
	const resolved = value ?? DEFAULT_COOPERATIVE_CAPTURE_BYTES_PER_CHUNK;
	if (
		!Number.isSafeInteger(resolved) ||
		resolved <= 0 ||
		resolved > MAX_COOPERATIVE_CAPTURE_BYTES_PER_CHUNK
	) {
		throw new Error("INVALID_COOPERATIVE_CAPTURE_OPTIONS");
	}
	return resolved;
}

function readCooperativeCaptureTime(now: () => number): number {
	const value = now();
	if (!Number.isFinite(value)) throw new Error("INVALID_COOPERATIVE_CAPTURE_OPTIONS");
	return value;
}

function throwIfCaptureAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	const error = new Error("STATION_PROPOSAL_CAPTURE_ABORTED");
	error.name = "AbortError";
	throw error;
}

function resolveCooperativeHydrationOptions(
	options: OpenFabStationProposalCooperativeHydrationOptions,
): ResolvedCooperativeHydrationOptions {
	if (!options || typeof options.checkpoint !== "function") {
		throw new Error("INVALID_COOPERATIVE_HYDRATION_OPTIONS");
	}
	return Object.freeze({
		rowsPerCheckpoint: boundedCooperativeLimit(
			options.rowsPerCheckpoint,
			DEFAULT_COOPERATIVE_ROWS,
			1_024,
		),
		stringsPerCheckpoint: boundedCooperativeLimit(
			options.stringsPerCheckpoint,
			DEFAULT_COOPERATIVE_STRINGS,
			1_024,
		),
		checksumBytesPerCheckpoint: boundedCooperativeLimit(
			options.checksumBytesPerCheckpoint,
			DEFAULT_COOPERATIVE_CHECKSUM_BYTES,
			DEFAULT_COOPERATIVE_CHECKSUM_BYTES,
		),
	});
}

function boundedCooperativeLimit(
	value: number | undefined,
	fallback: number,
	maximum: number,
): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
		throw new Error("INVALID_COOPERATIVE_HYDRATION_OPTIONS");
	}
	return resolved;
}

async function cooperativeCheckpoint(
	options: OpenFabStationProposalCooperativeHydrationOptions,
): Promise<void> {
	throwIfHydrationAborted(options.signal);
	await options.checkpoint();
	throwIfHydrationAborted(options.signal);
}

function throwIfHydrationAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	const error = new Error("STATION_PROPOSAL_HYDRATION_ABORTED");
	error.name = "AbortError";
	throw error;
}

function isUint32(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_UINT32;
}
