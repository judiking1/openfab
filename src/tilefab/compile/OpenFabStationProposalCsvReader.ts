import { OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES } from "../project/OpenFabStationProposalPorts";
import {
	compareOpenFabStationProposalRows,
	issueIndex,
	OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE,
	OPENFAB_STATION_PROPOSAL_DIRECTIONS,
	OPENFAB_STATION_PROPOSAL_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_MAX_DISTINCT_STRINGS,
	OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES,
	OPENFAB_STATION_PROPOSAL_MAX_ROWS,
	OPENFAB_STATION_PROPOSAL_MAX_SECONDARY_ALIASES,
	OPENFAB_STATION_PROPOSAL_MAX_STRING_POOL_BYTES,
	OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES,
	OPENFAB_STATION_PROPOSAL_PORT_TYPES,
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	OPENFAB_STATION_PROPOSAL_SIDES,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	OPENFAB_STATION_PROPOSAL_V1_REQUIRED_HEADERS,
	type OpenFabStationProposalArtifact,
	type OpenFabStationProposalDirection,
	type OpenFabStationProposalDirectionEvidence,
	type OpenFabStationProposalPortType,
	type OpenFabStationProposalReadFailure,
	type OpenFabStationProposalReadFailureCode,
	type OpenFabStationProposalReadResult,
	type OpenFabStationProposalRow,
	openFabStationProposalReadFailureFingerprint,
	openFabStationProposalSemanticFingerprint,
	openFabStationProposalSnapshotFingerprint,
	validateOpenFabStationProposalArtifact,
	validateOpenFabStationProposalReadFailure,
} from "./OpenFabStationProposalArtifact";

export const OPENFAB_STATION_PROPOSAL_CSV_LIMITS = Object.freeze({
	maxSourceBytes: OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES,
	maxRows: OPENFAB_STATION_PROPOSAL_MAX_ROWS,
	maxColumns: 64,
	maxFieldBytes: 4_096,
	maxRecordBytes: 64 * 1024,
	maxTotalSecondaryAliases: OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES,
	maxDistinctStrings: OPENFAB_STATION_PROPOSAL_MAX_DISTINCT_STRINGS,
	maxStringPoolBytes: OPENFAB_STATION_PROPOSAL_MAX_STRING_POOL_BYTES,
});

export interface OpenFabStationProposalCsvReaderOptions {
	/** A caller may lower, but never raise, the registered public limits. */
	readonly maxSourceBytes?: number;
	readonly maxRows?: number;
	readonly maxColumns?: number;
	readonly maxFieldBytes?: number;
	readonly maxRecordBytes?: number;
	readonly maxTotalSecondaryAliases?: number;
	readonly maxDistinctStrings?: number;
	readonly maxStringPoolBytes?: number;
}

interface ReaderLimits {
	readonly maxSourceBytes: number;
	readonly maxRows: number;
	readonly maxColumns: number;
	readonly maxFieldBytes: number;
	readonly maxRecordBytes: number;
	readonly maxTotalSecondaryAliases: number;
	readonly maxDistinctStrings: number;
	readonly maxStringPoolBytes: number;
}

interface ReaderState {
	readonly sourceByteLength: number;
	readonly limits: ReaderLimits;
	readonly issueCounts: Uint32Array;
	readonly rows: OpenFabStationProposalRow[];
	headerIndices: Readonly<
		Partial<Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], number>>
	> | null;
	headerColumnCount: number;
	recordsSeen: number;
	rejectedRows: number;
	unknownColumnCount: number;
	totalSecondaryAliasCount: number;
}

interface CsvReadOutcome {
	readonly code: OpenFabStationProposalReadFailureCode | null;
}

const MAX_INT32 = 0x7fff_ffff;
const MIN_INT32 = -0x8000_0000;
const UTF8_BOM = Object.freeze([0xef, 0xbb, 0xbf] as const);

/**
 * Parse only the registered OpenFab v1 CSV schema. This is a proposal reader, not a project loader:
 * unknown columns are discarded and there is no positional or caller-configurable header fallback.
 */
export function parseOpenFabStationProposalCsv(
	source: Uint8Array,
	options: OpenFabStationProposalCsvReaderOptions = {},
): OpenFabStationProposalReadResult {
	const limits = resolveLimits(options);
	const issueCounts = new Uint32Array(OPENFAB_STATION_PROPOSAL_ISSUE_CODES.length);
	const state: ReaderState = {
		sourceByteLength: source.byteLength,
		limits,
		issueCounts,
		rows: [],
		headerIndices: null,
		headerColumnCount: 0,
		recordsSeen: 0,
		rejectedRows: 0,
		unknownColumnCount: 0,
		totalSecondaryAliasCount: 0,
	};
	if (source.byteLength === 0) return rejected(state, "SOURCE_EMPTY");
	if (source.byteLength > limits.maxSourceBytes) {
		return rejected(state, "SOURCE_BYTE_LIMIT_EXCEEDED");
	}

	let text: string;
	try {
		const start = hasUtf8Bom(source) ? UTF8_BOM.length : 0;
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			source.subarray(start),
		);
	} catch {
		return rejected(state, "INVALID_UTF8");
	}
	if (containsProhibitedSourceText(text)) return rejected(state, "PROHIBITED_TEXT");

	const csv = readCsvRecords(text, limits, (record) => acceptRecord(state, record));
	if (csv.code) return rejected(state, csv.code);
	if (!state.headerIndices) return rejected(state, "MISSING_HEADER");

	countProposalCollisions(state.rows, issueCounts);
	state.rows.sort(compareOpenFabStationProposalRows);
	const artifact = buildArtifact(state);
	return artifact
		? Object.freeze({ ok: true, artifact })
		: rejected(state, "STRING_POOL_LIMIT_EXCEEDED");
}

function acceptRecord(
	state: ReaderState,
	record: readonly string[],
): OpenFabStationProposalReadFailureCode | null {
	if (!state.headerIndices) {
		if (record.some(containsProhibitedFieldText)) return "PROHIBITED_TEXT";
		return acceptHeader(state, record);
	}
	state.recordsSeen++;
	if (state.recordsSeen > state.limits.maxRows) return "ROW_LIMIT_EXCEEDED";
	if (record.length !== state.headerColumnCount) {
		incrementIssue(state.issueCounts, "ROW_COLUMN_MISMATCH");
		state.rejectedRows++;
		return null;
	}
	for (const index of Object.values(state.headerIndices)) {
		if (index !== undefined && containsProhibitedFieldText(record[index] as string)) {
			return "PROHIBITED_TEXT";
		}
	}
	const normalized = normalizeRow(state, record);
	if (!normalized) {
		state.rejectedRows++;
		return null;
	}
	const totalSecondaryAliasCount =
		state.totalSecondaryAliasCount + normalized.secondaryAliases.length;
	if (totalSecondaryAliasCount > state.limits.maxTotalSecondaryAliases) {
		return "SECONDARY_ALIAS_LIMIT_EXCEEDED";
	}
	state.totalSecondaryAliasCount = totalSecondaryAliasCount;
	state.rows.push(normalized);
	return null;
}

function acceptHeader(
	state: ReaderState,
	record: readonly string[],
): OpenFabStationProposalReadFailureCode | null {
	if (record.length > state.limits.maxColumns) return "COLUMN_LIMIT_EXCEEDED";
	const knownHeaders = new Set<string>(OPENFAB_STATION_PROPOSAL_V1_HEADERS);
	const indices: Partial<Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], number>> = {};
	let unknownColumnCount = 0;
	for (let index = 0; index < record.length; index++) {
		const header = record[index] as string;
		if (!knownHeaders.has(header)) {
			unknownColumnCount++;
			continue;
		}
		const known = header as (typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number];
		if (indices[known] !== undefined) return "DUPLICATE_REQUIRED_HEADER";
		indices[known] = index;
	}
	if (
		OPENFAB_STATION_PROPOSAL_V1_REQUIRED_HEADERS.some((header) => indices[header] === undefined)
	) {
		return "MISSING_REQUIRED_HEADER";
	}
	const sourceXPresent = indices.source_x_mm !== undefined;
	const sourceZPresent = indices.source_z_mm !== undefined;
	if (sourceXPresent !== sourceZPresent) return "OPTIONAL_HEADER_PAIR_MISMATCH";
	state.headerIndices = indices;
	state.headerColumnCount = record.length;
	state.unknownColumnCount = unknownColumnCount;
	state.issueCounts[issueIndex("UNKNOWN_COLUMN")] = unknownColumnCount;
	return null;
}

function normalizeRow(
	state: ReaderState,
	record: readonly string[],
): OpenFabStationProposalRow | null {
	const indices = state.headerIndices;
	if (!indices) return null;
	const identityScope = normalizeIdentifier(cell(record, indices, "identity_scope"));
	const portKey = normalizeIdentifier(cell(record, indices, "port_key"));
	const secondaryAliases = parseSecondaryAliases(cell(record, indices, "secondary_aliases"));
	const attachmentScope = normalizeIdentifier(cell(record, indices, "attachment_scope"));
	const attachmentAlias = normalizeIdentifier(cell(record, indices, "attachment_alias"));
	const stationMillimeters = parseNonnegativeInt32(cell(record, indices, "station_mm"));
	const rawSide = cell(record, indices, "side");
	const side = enumValue(rawSide, OPENFAB_STATION_PROPOSAL_SIDES) ?? "UNRESOLVED";
	const lateralOffsetMillimeters = parseNonnegativeInt32(
		cell(record, indices, "lateral_offset_mm"),
	);

	let rejectedRow = false;
	if (identityScope.length === 0) {
		incrementIssue(state.issueCounts, "MISSING_IDENTITY_SCOPE");
		rejectedRow = true;
	}
	if (portKey.length === 0) {
		incrementIssue(state.issueCounts, "MISSING_PORT_KEY");
		rejectedRow = true;
	}
	if (secondaryAliases === null) {
		incrementIssue(state.issueCounts, "INVALID_SECONDARY_ALIASES");
		rejectedRow = true;
	}
	if (attachmentScope.length === 0) {
		incrementIssue(state.issueCounts, "MISSING_ATTACHMENT_SCOPE");
		rejectedRow = true;
	}
	if (attachmentAlias.length === 0) {
		incrementIssue(state.issueCounts, "MISSING_ATTACHMENT_ALIAS");
		rejectedRow = true;
	}
	if (stationMillimeters === null) {
		incrementIssue(state.issueCounts, "INVALID_STATION_MILLIMETERS");
		rejectedRow = true;
	}
	if (lateralOffsetMillimeters === null) {
		incrementIssue(state.issueCounts, "INVALID_LATERAL_OFFSET_MILLIMETERS");
		rejectedRow = true;
	}

	const rawDirection = cell(record, indices, "direction");
	let direction = enumValue(rawDirection, OPENFAB_STATION_PROPOSAL_DIRECTIONS) ?? "UNKNOWN";
	if (
		!OPENFAB_STATION_PROPOSAL_DIRECTIONS.includes(rawDirection as OpenFabStationProposalDirection)
	) {
		incrementIssue(state.issueCounts, "UNRESOLVED_DIRECTION");
	}
	const rawEvidence = cell(record, indices, "direction_evidence");
	let directionEvidence =
		enumValue(rawEvidence, OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE) ?? "UNKNOWN";
	if (
		!OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.includes(
			rawEvidence as OpenFabStationProposalDirectionEvidence,
		)
	) {
		incrementIssue(state.issueCounts, "UNRESOLVED_DIRECTION_EVIDENCE");
	}
	const rawPortType = cell(record, indices, "port_type");
	const portType = resolvePortType(rawPortType);
	const physicalGroupKey = normalizeIdentifier(cell(record, indices, "physical_group_key"));
	const rawPhysicalGroupKind = cell(record, indices, "physical_group_kind");
	const physicalGroupKind = resolvePortType(rawPhysicalGroupKind);
	const sourcePosition = parseOptionalSourcePosition(
		cell(record, indices, "source_x_mm"),
		cell(record, indices, "source_z_mm"),
	);
	if (sourcePosition === null) {
		incrementIssue(state.issueCounts, "INVALID_SOURCE_POSITION");
		rejectedRow = true;
	}

	if (
		rejectedRow ||
		secondaryAliases === null ||
		stationMillimeters === null ||
		lateralOffsetMillimeters === null ||
		sourcePosition === null
	) {
		return null;
	}
	if (side === "UNRESOLVED") incrementIssue(state.issueCounts, "UNRESOLVED_SIDE");
	if (
		(direction === "UNKNOWN" && directionEvidence !== "UNKNOWN") ||
		(direction !== "UNKNOWN" && directionEvidence === "UNKNOWN")
	) {
		incrementIssue(state.issueCounts, "DIRECTION_EVIDENCE_CONTRADICTION");
		direction = "UNKNOWN";
		directionEvidence = "UNKNOWN";
	}
	let resolvedSide = side;
	if (
		(side === "CENTER" && lateralOffsetMillimeters !== 0) ||
		((side === "LEFT" || side === "RIGHT") && lateralOffsetMillimeters === 0)
	) {
		incrementIssue(state.issueCounts, "SIDE_OFFSET_CONTRADICTION");
		if (resolvedSide !== "UNRESOLVED") {
			resolvedSide = "UNRESOLVED";
			incrementIssue(state.issueCounts, "UNRESOLVED_SIDE");
		}
	}
	if (portType === "UNRESOLVED") incrementIssue(state.issueCounts, "UNRESOLVED_PORT_TYPE");
	if (physicalGroupKey.length > 0 && physicalGroupKind === "UNRESOLVED") {
		incrementIssue(state.issueCounts, "UNRESOLVED_PHYSICAL_GROUP_KIND");
	}
	if (physicalGroupKey.length === 0 && physicalGroupKind !== "UNRESOLVED") {
		incrementIssue(state.issueCounts, "PHYSICAL_GROUP_KIND_WITHOUT_KEY");
	}
	return Object.freeze({
		identityScope,
		portKey,
		secondaryAliases: Object.freeze(secondaryAliases),
		attachmentScope,
		attachmentAlias,
		stationMillimeters,
		side: resolvedSide,
		lateralOffsetMillimeters,
		direction,
		directionEvidence,
		portType,
		physicalGroupKey,
		physicalGroupKind,
		organizationAlias: normalizeIdentifier(cell(record, indices, "organization_alias")),
		sourceXMillimeters: sourcePosition.x,
		sourceZMillimeters: sourcePosition.z,
	});
}

function buildArtifact(state: ReaderState): OpenFabStationProposalArtifact | null {
	const rows = state.rows;
	const stringPool = createStringPool(
		rows,
		state.limits.maxDistinctStrings,
		Math.min(state.limits.maxStringPoolBytes, state.sourceByteLength * 4),
	);
	if (!stringPool) return null;
	const rowCount = rows.length;
	const stringIndex = stringPool.indices;
	const identityScopeStringIndices = new Uint32Array(rowCount);
	const portKeyStringIndices = new Uint32Array(rowCount);
	const secondaryAliasOffsets = new Uint32Array(rowCount + 1);
	const secondaryAliasStringIndices = new Uint32Array(
		rows.reduce((total, row) => total + row.secondaryAliases.length, 0),
	);
	const attachmentScopeStringIndices = new Uint32Array(rowCount);
	const attachmentAliasStringIndices = new Uint32Array(rowCount);
	const stationMillimeters = new Int32Array(rowCount);
	const sides = new Uint8Array(rowCount);
	const lateralOffsetMillimeters = new Int32Array(rowCount);
	const directions = new Uint8Array(rowCount);
	const directionEvidence = new Uint8Array(rowCount);
	const portTypes = new Uint8Array(rowCount);
	const physicalGroupKeyStringIndices = new Uint32Array(rowCount);
	const physicalGroupKinds = new Uint8Array(rowCount);
	const organizationAliasStringIndices = new Uint32Array(rowCount);
	const sourcePositionPresence = new Uint8Array(rowCount);
	const sourceXMillimeters = new Int32Array(rowCount);
	const sourceZMillimeters = new Int32Array(rowCount);
	let secondaryAliasIndex = 0;
	for (let row = 0; row < rowCount; row++) {
		const value = rows[row] as OpenFabStationProposalRow;
		identityScopeStringIndices[row] = requiredStringIndex(stringIndex, value.identityScope);
		portKeyStringIndices[row] = requiredStringIndex(stringIndex, value.portKey);
		secondaryAliasOffsets[row] = secondaryAliasIndex;
		for (const alias of value.secondaryAliases) {
			secondaryAliasStringIndices[secondaryAliasIndex++] = requiredStringIndex(stringIndex, alias);
		}
		attachmentScopeStringIndices[row] = requiredStringIndex(stringIndex, value.attachmentScope);
		attachmentAliasStringIndices[row] = requiredStringIndex(stringIndex, value.attachmentAlias);
		stationMillimeters[row] = value.stationMillimeters;
		sides[row] = OPENFAB_STATION_PROPOSAL_SIDES.indexOf(value.side);
		lateralOffsetMillimeters[row] = value.lateralOffsetMillimeters;
		directions[row] = OPENFAB_STATION_PROPOSAL_DIRECTIONS.indexOf(value.direction);
		directionEvidence[row] = OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.indexOf(
			value.directionEvidence,
		);
		portTypes[row] = OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(value.portType);
		physicalGroupKeyStringIndices[row] = requiredStringIndex(stringIndex, value.physicalGroupKey);
		physicalGroupKinds[row] = OPENFAB_STATION_PROPOSAL_PORT_TYPES.indexOf(value.physicalGroupKind);
		organizationAliasStringIndices[row] = requiredStringIndex(stringIndex, value.organizationAlias);
		if (value.sourceXMillimeters !== null && value.sourceZMillimeters !== null) {
			sourcePositionPresence[row] = 1;
			sourceXMillimeters[row] = value.sourceXMillimeters;
			sourceZMillimeters[row] = value.sourceZMillimeters;
		}
	}
	secondaryAliasOffsets[rowCount] = secondaryAliasIndex;

	const withoutFingerprints: OpenFabStationProposalArtifact = {
		kind: "openfab-station-proposal-artifact",
		schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
		schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
		sourceByteLength: state.sourceByteLength,
		sourceRecordCount: state.recordsSeen,
		rowCount,
		rejectedRowCount: state.rejectedRows,
		unknownColumnCount: state.unknownColumnCount,
		stringCount: stringPool.strings.length,
		stringBytes: stringPool.bytes,
		stringOffsets: stringPool.offsets,
		identityScopeStringIndices,
		portKeyStringIndices,
		secondaryAliasOffsets,
		secondaryAliasStringIndices,
		attachmentScopeStringIndices,
		attachmentAliasStringIndices,
		stationMillimeters,
		sides,
		lateralOffsetMillimeters,
		directions,
		directionEvidence,
		portTypes,
		physicalGroupKeyStringIndices,
		physicalGroupKinds,
		organizationAliasStringIndices,
		sourcePositionPresence,
		sourceXMillimeters,
		sourceZMillimeters,
		issueCounts: state.issueCounts,
		semanticFingerprint: "",
		snapshotFingerprint: "",
	};
	const semanticFingerprint = openFabStationProposalSemanticFingerprint(withoutFingerprints);
	const withSemantic = { ...withoutFingerprints, semanticFingerprint };
	const artifact = Object.freeze({
		...withSemantic,
		snapshotFingerprint: openFabStationProposalSnapshotFingerprint(withSemantic),
	});
	validateOpenFabStationProposalArtifact(artifact);
	return artifact;
}

function createStringPool(
	rows: readonly OpenFabStationProposalRow[],
	maxDistinctStrings: number,
	maxStringPoolBytes: number,
): {
	readonly strings: readonly string[];
	readonly indices: ReadonlyMap<string, number>;
	readonly bytes: Uint8Array;
	readonly offsets: Uint32Array;
} | null {
	const strings = [""];
	const indices = new Map<string, number>([["", 0]]);
	for (const row of rows) {
		for (const value of [
			row.identityScope,
			row.portKey,
			...row.secondaryAliases,
			row.attachmentScope,
			row.attachmentAlias,
			row.physicalGroupKey,
			row.organizationAlias,
		]) {
			if (!indices.has(value)) {
				if (strings.length >= maxDistinctStrings) return null;
				indices.set(value, strings.length);
				strings.push(value);
			}
		}
	}
	const encoder = new TextEncoder();
	const offsets = new Uint32Array(strings.length + 1);
	let byteLength = 0;
	for (let index = 0; index < strings.length; index++) {
		const encodedLength = encoder.encode(strings[index] as string).length;
		if (
			encodedLength > OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES ||
			byteLength + encodedLength > maxStringPoolBytes
		) {
			return null;
		}
		offsets[index] = byteLength;
		byteLength += encodedLength;
	}
	offsets[strings.length] = byteLength;
	const bytes = new Uint8Array(byteLength);
	for (let index = 0; index < strings.length; index++) {
		bytes.set(encoder.encode(strings[index] as string), offsets[index] as number);
	}
	return { strings: Object.freeze(strings), indices, bytes, offsets };
}

function readCsvRecords(
	text: string,
	limits: ReaderLimits,
	onRecord: (record: readonly string[]) => OpenFabStationProposalReadFailureCode | null,
): CsvReadOutcome {
	let index = 0;
	let recordStart = true;
	let state: "FIELD_START" | "UNQUOTED" | "QUOTED" | "AFTER_QUOTE" = "FIELD_START";
	let fields: string[] = [];
	let field = "";
	let fieldBytes = 0;
	let recordBytes = 0;

	const append = (value: string): OpenFabStationProposalReadFailureCode | null => {
		const addedBytes = utf8ScalarByteLength(value);
		if (fieldBytes + addedBytes > limits.maxFieldBytes) return "FIELD_LIMIT_EXCEEDED";
		if (recordBytes + addedBytes > limits.maxRecordBytes) return "RECORD_LIMIT_EXCEEDED";
		field += value;
		fieldBytes += addedBytes;
		recordBytes += addedBytes;
		return null;
	};
	const finishField = (): OpenFabStationProposalReadFailureCode | null => {
		if (fields.length >= limits.maxColumns) return "COLUMN_LIMIT_EXCEEDED";
		fields.push(field);
		field = "";
		fieldBytes = 0;
		state = "FIELD_START";
		return null;
	};
	const finishRecord = (): OpenFabStationProposalReadFailureCode | null => {
		const fieldFailure = finishField();
		if (fieldFailure) return fieldFailure;
		const failure = onRecord(Object.freeze(fields));
		fields = [];
		recordBytes = 0;
		recordStart = true;
		return failure;
	};

	while (index < text.length) {
		if (recordStart) {
			let probe = index;
			while (text[probe] === " " || text[probe] === "\t") probe++;
			if (probe - index > limits.maxRecordBytes) return { code: "RECORD_LIMIT_EXCEEDED" };
			if (probe >= text.length) {
				index = text.length;
				continue;
			}
			if (text[probe] === "#") {
				let commentBytes = probe - index + 1;
				index = probe + 1;
				while (index < text.length && !isNewline(text[index] as string)) {
					const character = String.fromCodePoint(text.codePointAt(index) as number);
					commentBytes += utf8ScalarByteLength(character);
					if (commentBytes > limits.maxRecordBytes) {
						return { code: "RECORD_LIMIT_EXCEEDED" };
					}
					index += character.length;
				}
				index = consumeNewline(text, index);
				continue;
			}
			if (isNewline(text[probe] as string)) {
				index = consumeNewline(text, probe);
				continue;
			}
			recordStart = false;
		}

		const character = String.fromCodePoint(text.codePointAt(index) as number);
		const characterWidth = character.length;
		if (state === "QUOTED") {
			if (character === '"') {
				state = "AFTER_QUOTE";
				index++;
				continue;
			}
			if (isNewline(character)) {
				const appendFailure = append("\n");
				if (appendFailure) return { code: appendFailure };
				index = consumeNewline(text, index);
				continue;
			}
			const appendFailure = append(character);
			if (appendFailure) return { code: appendFailure };
			index += characterWidth;
			continue;
		}

		if (state === "AFTER_QUOTE") {
			if (character === '"') {
				const appendFailure = append('"');
				if (appendFailure) return { code: appendFailure };
				state = "QUOTED";
				index++;
				continue;
			}
			if (character === ",") {
				const fieldFailure = finishField();
				if (fieldFailure) return { code: fieldFailure };
				index++;
				continue;
			}
			if (isNewline(character)) {
				const recordFailure = finishRecord();
				if (recordFailure) return { code: recordFailure };
				index = consumeNewline(text, index);
				continue;
			}
			return { code: "MALFORMED_CSV" };
		}

		if (state === "FIELD_START" && character === '"') {
			state = "QUOTED";
			index++;
			continue;
		}
		if (character === '"') return { code: "MALFORMED_CSV" };
		if (character === ",") {
			const fieldFailure = finishField();
			if (fieldFailure) return { code: fieldFailure };
			index++;
			continue;
		}
		if (isNewline(character)) {
			const recordFailure = finishRecord();
			if (recordFailure) return { code: recordFailure };
			index = consumeNewline(text, index);
			continue;
		}
		state = "UNQUOTED";
		const appendFailure = append(character);
		if (appendFailure) return { code: appendFailure };
		index += characterWidth;
	}

	if (state === "QUOTED") return { code: "MALFORMED_CSV" };
	if (!recordStart) {
		const recordFailure = finishRecord();
		if (recordFailure) return { code: recordFailure };
	}
	return { code: null };
}

function rejected(
	state: ReaderState,
	code: OpenFabStationProposalReadFailureCode,
): OpenFabStationProposalReadResult {
	const withoutFingerprint: OpenFabStationProposalReadFailure = {
		kind: "openfab-station-proposal-read-failure",
		schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
		schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
		code,
		sourceByteLength: state.sourceByteLength,
		recordsSeen: state.recordsSeen,
		acceptedRowCount: state.rows.length,
		rejectedRowCount: state.rejectedRows,
		unknownColumnCount: state.unknownColumnCount,
		issueCounts: state.issueCounts,
		snapshotFingerprint: "",
	};
	const failure = Object.freeze({
		...withoutFingerprint,
		snapshotFingerprint: openFabStationProposalReadFailureFingerprint(withoutFingerprint),
	});
	validateOpenFabStationProposalReadFailure(failure);
	return Object.freeze({ ok: false, failure });
}

function resolveLimits(options: OpenFabStationProposalCsvReaderOptions): ReaderLimits {
	return Object.freeze({
		maxSourceBytes: boundedLimit(
			options.maxSourceBytes,
			OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxSourceBytes,
		),
		maxRows: boundedLimit(options.maxRows, OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxRows),
		maxColumns: boundedLimit(options.maxColumns, OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxColumns),
		maxFieldBytes: boundedLimit(
			options.maxFieldBytes,
			OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxFieldBytes,
		),
		maxRecordBytes: boundedLimit(
			options.maxRecordBytes,
			OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxRecordBytes,
		),
		maxTotalSecondaryAliases: boundedLimit(
			options.maxTotalSecondaryAliases,
			OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxTotalSecondaryAliases,
		),
		maxDistinctStrings: boundedLimit(
			options.maxDistinctStrings,
			OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxDistinctStrings,
		),
		maxStringPoolBytes: boundedLimit(
			options.maxStringPoolBytes,
			OPENFAB_STATION_PROPOSAL_CSV_LIMITS.maxStringPoolBytes,
		),
	});
}

function boundedLimit(value: number | undefined, maximum: number): number {
	const resolved = value ?? maximum;
	if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
		throw new Error("INVALID_READER_LIMITS");
	}
	return resolved;
}

function countProposalCollisions(
	rows: readonly OpenFabStationProposalRow[],
	issueCounts: Uint32Array,
): void {
	const aliases = new Map<string, { primary: number; secondary: number }>();
	const groups = new Map<string, Map<OpenFabStationProposalPortType, number>>();
	for (const row of rows) {
		addAliasOccurrence(aliases, scopedKey(row.identityScope, row.portKey), "primary");
		for (const alias of row.secondaryAliases) {
			addAliasOccurrence(aliases, scopedKey(row.identityScope, alias), "secondary");
		}
		if (row.physicalGroupKey.length > 0) {
			const key = scopedKey(row.identityScope, row.physicalGroupKey);
			const counts = groups.get(key) ?? new Map<OpenFabStationProposalPortType, number>();
			counts.set(row.physicalGroupKind, (counts.get(row.physicalGroupKind) ?? 0) + 1);
			groups.set(key, counts);
		}
	}
	let primary = 0;
	let primarySecondary = 0;
	let secondary = 0;
	for (const occurrence of aliases.values()) {
		if (occurrence.primary > 1) primary += occurrence.primary;
		if (occurrence.primary > 0 && occurrence.secondary > 0) {
			primarySecondary += occurrence.primary + occurrence.secondary;
		}
		if (occurrence.secondary > 1) secondary += occurrence.secondary;
	}
	let groupKindConflict = 0;
	for (const counts of groups.values()) {
		if ([...counts.keys()].filter((kind) => kind !== "UNRESOLVED").length > 1) {
			for (const count of counts.values()) groupKindConflict += count;
		}
	}
	issueCounts[issueIndex("PRIMARY_ALIAS_COLLISION")] = primary;
	issueCounts[issueIndex("PRIMARY_SECONDARY_ALIAS_COLLISION")] = primarySecondary;
	issueCounts[issueIndex("SECONDARY_ALIAS_COLLISION")] = secondary;
	issueCounts[issueIndex("PHYSICAL_GROUP_KIND_CONFLICT")] = groupKindConflict;
}

function resolvePortType(value: string): OpenFabStationProposalPortType {
	return value === "OHB" || value === "EQ" || value === "STK" ? value : "UNRESOLVED";
}

function enumValue<T extends string>(value: string, values: readonly T[]): T | null {
	return values.includes(value as T) ? (value as T) : null;
}

function parseNonnegativeInt32(value: string): number | null {
	if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed <= MAX_INT32 ? parsed : null;
}

function parseSignedInt32(value: string): number | null {
	if (!/^(0|-?[1-9][0-9]*)$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= MIN_INT32 && parsed <= MAX_INT32 ? parsed : null;
}

function parseOptionalSourcePosition(
	rawX: string,
	rawZ: string,
): { readonly x: number | null; readonly z: number | null } | null {
	if (rawX.length === 0 && rawZ.length === 0) return Object.freeze({ x: null, z: null });
	if (rawX.length === 0 || rawZ.length === 0) return null;
	const x = parseSignedInt32(rawX);
	const z = parseSignedInt32(rawZ);
	return x === null || z === null ? null : Object.freeze({ x, z });
}

function parseSecondaryAliases(value: string): readonly string[] | null {
	if (value.length === 0) return Object.freeze([]);
	const aliases = value.split("|");
	if (
		aliases.length > OPENFAB_STATION_PROPOSAL_MAX_SECONDARY_ALIASES ||
		aliases.some((alias) => alias.length === 0)
	) {
		return null;
	}
	const normalized = aliases.map(normalizeIdentifier);
	normalized.sort(compareIdentifiers);
	return Object.freeze(normalized);
}

function normalizeIdentifier(value: string): string {
	return value.normalize("NFC");
}

function cell(
	record: readonly string[],
	indices: Readonly<Partial<Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], number>>>,
	header: (typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number],
): string {
	const index = indices[header];
	return index === undefined ? "" : (record[index] as string);
}

function compareIdentifiers(left: string, right: string): number {
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

function containsProhibitedSourceText(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) as number;
		if (
			(codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
			codePoint === 0x7f
		) {
			return true;
		}
	}
	return /\p{Cf}/u.test(value);
}

function containsProhibitedFieldText(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) as number;
		if (codePoint <= 0x1f || codePoint === 0x7f) return true;
	}
	return /\p{Cf}/u.test(value);
}

function utf8ScalarByteLength(value: string): number {
	const codePoint = value.codePointAt(0) as number;
	if (codePoint <= 0x7f) return 1;
	if (codePoint <= 0x7ff) return 2;
	if (codePoint <= 0xffff) return 3;
	return 4;
}

function requiredStringIndex(indices: ReadonlyMap<string, number>, value: string): number {
	const index = indices.get(value);
	if (index === undefined) throw new Error("STRING_POOL_MISMATCH");
	return index;
}

function incrementIssue(
	issueCounts: Uint32Array,
	code: (typeof OPENFAB_STATION_PROPOSAL_ISSUE_CODES)[number],
): void {
	const index = issueIndex(code);
	issueCounts[index] = (issueCounts[index] as number) + 1;
}

function hasUtf8Bom(source: Uint8Array): boolean {
	return (
		source.length >= UTF8_BOM.length &&
		source[0] === UTF8_BOM[0] &&
		source[1] === UTF8_BOM[1] &&
		source[2] === UTF8_BOM[2]
	);
}

function isNewline(character: string): boolean {
	return character === "\r" || character === "\n";
}

function consumeNewline(text: string, index: number): number {
	if (index >= text.length) return index;
	return text[index] === "\r" && text[index + 1] === "\n" ? index + 2 : index + 1;
}
