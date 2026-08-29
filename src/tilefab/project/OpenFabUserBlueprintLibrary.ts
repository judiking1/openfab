import {
	copyOpenFabProjectBlueprint,
	type OpenFabProjectBlueprint,
} from "./OpenFabBlueprintLibrary";
import { parseOpenFabProjectBlueprintValue } from "./OpenFabProjectCodec";

export const OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION = 1 as const;
export const OPENFAB_USER_BLUEPRINT_MAX_RECORDS = 1_024;
export const OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES = 250_000;
export const OPENFAB_USER_BLUEPRINT_MAX_FOLDER_DEPTH = 4;
export const OPENFAB_USER_BLUEPRINT_MAX_FOLDER_SEGMENT_LENGTH = 80;
export const OPENFAB_USER_BLUEPRINT_MIN_QUICK_SLOT = 1;
export const OPENFAB_USER_BLUEPRINT_MAX_QUICK_SLOT = 9;
export const OPENFAB_USER_BLUEPRINT_FILE_EXTENSION = ".openfabbp";
export const OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES = 16 * 1024 * 1024;
export const OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES = 120 * 1024 * 1024;
export const OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION = ".openfabbp.invalid.json";
export const OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS = 16;
export const OPENFAB_USER_BLUEPRINT_MAX_DIAGNOSTIC_DEPTH = 64;
export const OPENFAB_USER_BLUEPRINT_MAX_DIAGNOSTIC_NODES = 250_000;

export interface OpenFabUserBlueprintRecord {
	readonly schemaVersion: typeof OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION;
	readonly id: string;
	readonly folderPath: readonly string[];
	readonly quickSlot: number | null;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly blueprint: OpenFabProjectBlueprint;
}

export interface CreateOpenFabUserBlueprintRecordOptions {
	readonly id: string;
	readonly folderPath?: readonly string[];
	readonly quickSlot?: number | null;
	readonly createdAt: string;
}

export interface OpenFabUserBlueprintLibraryStore {
	list(signal?: AbortSignal): Promise<readonly OpenFabUserBlueprintRecord[]>;
	get(id: string, signal?: AbortSignal): Promise<OpenFabUserBlueprintRecord | null>;
	getStatus(): OpenFabUserBlueprintLibraryStatus;
	getRejectedDiagnostics(): readonly OpenFabUserBlueprintRejectedDiagnostic[];
	readRejectedDiagnostic(
		token: string,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintRejectedDiagnosticRead | null>;
	removeRejectedDiagnostic(
		token: string,
		expected: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintRejectedDiagnosticRemoveResult>;
	insert(
		record: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintInsertResult>;
	update(
		expected: OpenFabUserBlueprintRecord,
		replacement: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintUpdateResult>;
	remove(
		expected: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintRemoveResult>;
	replaceAllIfUnchanged(
		expected: readonly OpenFabUserBlueprintRecord[],
		replacement: readonly OpenFabUserBlueprintRecord[],
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintReplaceAllResult>;
}

/**
 * Installation-local change signal only. Implementations never carry blueprint records through
 * this port; subscribers re-read the bounded store and retain its CAS authority.
 */
export interface OpenFabUserBlueprintLibraryChangePort {
	readonly available: boolean;
	publishChange(): void;
	subscribe(listener: () => void): () => void;
	dispose(): void;
}

export interface OpenFabUserBlueprintFileRead {
	readonly name: string;
	readonly json: string;
}

export interface OpenFabUserBlueprintFileGateway {
	chooseImport(signal?: AbortSignal): Promise<OpenFabUserBlueprintFileRead | null>;
	chooseExport(suggestedName: string, json: string, signal?: AbortSignal): Promise<boolean>;
	chooseDiagnosticExport(
		suggestedName: string,
		json: string,
		signal?: AbortSignal,
	): Promise<boolean>;
}

export type OpenFabUserBlueprintMutationDurability = "persistent" | "session-only";

export interface OpenFabUserBlueprintInsertResult {
	readonly status: "inserted" | "id-conflict" | "name-conflict" | "quick-slot-conflict";
	readonly durability: OpenFabUserBlueprintMutationDurability;
}

export interface OpenFabUserBlueprintUpdateResult {
	readonly status: "updated" | "missing" | "conflict" | "name-conflict" | "quick-slot-conflict";
	readonly durability: OpenFabUserBlueprintMutationDurability;
}

export interface OpenFabUserBlueprintRemoveResult {
	readonly status: "removed" | "missing" | "conflict";
	readonly durability: OpenFabUserBlueprintMutationDurability;
}

export interface OpenFabUserBlueprintReplaceAllResult {
	readonly status: "replaced" | "conflict" | "storage-unavailable" | "storage-invalid";
}

export interface OpenFabUserBlueprintLibraryStatus {
	readonly durability: OpenFabUserBlueprintMutationDurability;
	readonly rejectedRecordCount: number;
	readonly rejectedRecordCountIsLowerBound: boolean;
	readonly diagnosticsTruncated: boolean;
	readonly overflowDetected: boolean;
}

export type OpenFabUserBlueprintRejectedDiagnosticCode =
	| OpenFabUserBlueprintParseErrorCode
	| "INVALID_RECORD";

export interface OpenFabUserBlueprintRejectedDiagnostic {
	readonly token: string;
	readonly ordinal: number;
	readonly code: OpenFabUserBlueprintRejectedDiagnosticCode;
	readonly path: string;
	readonly message: string;
}

export interface OpenFabUserBlueprintRejectedDiagnosticRead {
	readonly diagnostic: OpenFabUserBlueprintRejectedDiagnostic;
	readonly json: string;
	readonly byteLength: number;
	readonly recoverableRecord: OpenFabUserBlueprintRecord | null;
}

export interface OpenFabUserBlueprintRejectedDiagnosticRemoveResult {
	readonly status: "removed" | "missing" | "conflict" | "not-recoverable";
}

export type OpenFabUserBlueprintParseErrorCode =
	| "INVALID_JSON"
	| "INVALID_ROOT"
	| "UNSUPPORTED_VERSION"
	| "INVALID_FIELD"
	| "LIMIT_EXCEEDED";

export class OpenFabUserBlueprintParseError extends Error {
	readonly code: OpenFabUserBlueprintParseErrorCode;
	readonly path: string;

	constructor(code: OpenFabUserBlueprintParseErrorCode, path: string, message: string) {
		super(`${path}: ${message}`);
		this.name = "OpenFabUserBlueprintParseError";
		this.code = code;
		this.path = path;
	}
}

export type OpenFabUserBlueprintDiagnosticExportErrorCode = "NON_JSON_VALUE" | "LIMIT_EXCEEDED";

export class OpenFabUserBlueprintDiagnosticExportError extends Error {
	readonly code: OpenFabUserBlueprintDiagnosticExportErrorCode;
	readonly path: string;

	constructor(code: OpenFabUserBlueprintDiagnosticExportErrorCode, path: string, message: string) {
		super(`${path}: ${message}`);
		this.name = "OpenFabUserBlueprintDiagnosticExportError";
		this.code = code;
		this.path = path;
	}
}

export function createOpenFabUserBlueprintRecord(
	blueprint: OpenFabProjectBlueprint,
	options: CreateOpenFabUserBlueprintRecordOptions,
): OpenFabUserBlueprintRecord {
	return parseOpenFabUserBlueprintRecord({
		schemaVersion: OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION,
		id: options.id,
		folderPath: options.folderPath ?? [],
		quickSlot: options.quickSlot ?? null,
		createdAt: options.createdAt,
		updatedAt: options.createdAt,
		blueprint,
	});
}

export function parseOpenFabUserBlueprintRecord(value: unknown): OpenFabUserBlueprintRecord {
	const record = expectRecord(value, "$", "INVALID_ROOT");
	expectExactKeys(
		record,
		["schemaVersion", "id", "folderPath", "quickSlot", "createdAt", "updatedAt", "blueprint"],
		"$",
	);
	if (record.schemaVersion !== OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION) {
		fail(
			"UNSUPPORTED_VERSION",
			"$.schemaVersion",
			`expected schema version ${OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION}`,
		);
	}
	const id = expectPortableId(record.id, "$.id");
	const folderPath = expectFolderPath(record.folderPath, "$.folderPath");
	const quickSlot = expectQuickSlot(record.quickSlot, "$.quickSlot");
	const createdAt = expectCanonicalTimestamp(record.createdAt, "$.createdAt");
	const updatedAt = expectCanonicalTimestamp(record.updatedAt, "$.updatedAt");
	if (updatedAt < createdAt) {
		fail("INVALID_FIELD", "$.updatedAt", "updatedAt cannot precede createdAt");
	}
	const blueprint = parseOpenFabProjectBlueprintValue(record.blueprint);
	return Object.freeze({
		schemaVersion: OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION,
		id,
		folderPath,
		quickSlot,
		createdAt,
		updatedAt,
		blueprint,
	});
}

export function parseOpenFabUserBlueprintJson(source: string): OpenFabUserBlueprintRecord {
	if (openFabUtf8ByteLength(source) > OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES) {
		fail(
			"LIMIT_EXCEEDED",
			"$",
			`blueprint JSON exceeds the ${formatMebibytes(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES)} MiB parsing limit`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		const detail = error instanceof Error ? error.message : "invalid JSON";
		throw new OpenFabUserBlueprintParseError("INVALID_JSON", "$", detail);
	}
	return parseOpenFabUserBlueprintRecord(value);
}

export function serializeOpenFabUserBlueprintRecord(record: OpenFabUserBlueprintRecord): string {
	const normalized = parseOpenFabUserBlueprintRecord(record);
	const json = `${JSON.stringify(sortJsonObjectKeys(normalized), null, "\t")}\n`;
	if (openFabUtf8ByteLength(json) > OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES) {
		fail(
			"LIMIT_EXCEEDED",
			"$",
			`blueprint JSON exceeds the ${formatMebibytes(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES)} MiB serialization limit`,
		);
	}
	return json;
}

export function openFabUserBlueprintRecordJsonByteLength(
	record: OpenFabUserBlueprintRecord,
): number {
	return openFabUtf8ByteLength(serializeOpenFabUserBlueprintRecord(record));
}

/**
 * Serializes the exact JSON-compatible IndexedDB value for user-controlled quarantine export.
 * Values that JSON.stringify would silently coerce or omit are rejected instead.
 */
export function serializeOpenFabUserBlueprintDiagnosticValue(value: unknown): string {
	assertDiagnosticJsonValue(value);
	const json = `${JSON.stringify(value, null, "\t")}\n`;
	if (openFabUtf8ByteLength(json) > OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES) {
		throw new OpenFabUserBlueprintDiagnosticExportError(
			"LIMIT_EXCEEDED",
			"$",
			`diagnostic JSON exceeds the ${formatMebibytes(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES)} MiB export limit`,
		);
	}
	return json;
}

export function openFabUtf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x7f) {
			bytes += 1;
		} else if (code <= 0x7ff) {
			bytes += 2;
		} else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index += 1;
		} else {
			// Lone surrogates are encoded as the three-byte replacement character.
			bytes += 3;
		}
	}
	return bytes;
}

export function copyOpenFabUserBlueprintRecord(
	record: OpenFabUserBlueprintRecord,
): OpenFabUserBlueprintRecord {
	return Object.freeze({
		schemaVersion: OPENFAB_USER_BLUEPRINT_SCHEMA_VERSION,
		id: record.id,
		folderPath: Object.freeze([...record.folderPath]),
		quickSlot: record.quickSlot,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		blueprint: copyOpenFabProjectBlueprint(record.blueprint),
	});
}

export function updateOpenFabUserBlueprintRecord(
	record: OpenFabUserBlueprintRecord,
	changes: Readonly<{
		folderPath?: readonly string[];
		quickSlot?: number | null;
		updatedAt: string;
		blueprint?: OpenFabProjectBlueprint;
	}>,
): OpenFabUserBlueprintRecord {
	return parseOpenFabUserBlueprintRecord({
		...record,
		folderPath: changes.folderPath ?? record.folderPath,
		quickSlot: changes.quickSlot === undefined ? record.quickSlot : changes.quickSlot,
		updatedAt: changes.updatedAt,
		blueprint: changes.blueprint ?? record.blueprint,
	});
}

export function openFabUserBlueprintsShareFolderAndName(
	left: OpenFabUserBlueprintRecord,
	right: OpenFabUserBlueprintRecord,
): boolean {
	return (
		left.blueprint.name.toLocaleLowerCase("en-US") ===
			right.blueprint.name.toLocaleLowerCase("en-US") &&
		left.folderPath.length === right.folderPath.length &&
		left.folderPath.every(
			(segment, index) =>
				segment.toLocaleLowerCase("en-US") === right.folderPath[index]?.toLocaleLowerCase("en-US"),
		)
	);
}

export function compareOpenFabUserBlueprintRecords(
	left: OpenFabUserBlueprintRecord,
	right: OpenFabUserBlueprintRecord,
): number {
	if (left.blueprint.favorite !== right.blueprint.favorite) {
		return left.blueprint.favorite ? -1 : 1;
	}
	if (left.quickSlot !== right.quickSlot) {
		if (left.quickSlot === null) return 1;
		if (right.quickSlot === null) return -1;
		return left.quickSlot - right.quickSlot;
	}
	const folderOrder = left.folderPath
		.join("/")
		.localeCompare(right.folderPath.join("/"), "en-US", { sensitivity: "base" });
	if (folderOrder !== 0) return folderOrder;
	const nameOrder = left.blueprint.name.localeCompare(right.blueprint.name, "en-US", {
		sensitivity: "base",
	});
	if (nameOrder !== 0) return nameOrder;
	const updatedOrder = right.updatedAt.localeCompare(left.updatedAt, "en-US");
	return updatedOrder || left.id.localeCompare(right.id, "en-US");
}

function expectRecord(
	value: unknown,
	path: string,
	code: OpenFabUserBlueprintParseErrorCode = "INVALID_FIELD",
): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(code, path, "expected an object");
	}
	return value as Readonly<Record<string, unknown>>;
}

function expectExactKeys(
	record: Readonly<Record<string, unknown>>,
	expected: readonly string[],
	path: string,
): void {
	const expectedKeys = new Set(expected);
	for (const key of Object.keys(record)) {
		if (!expectedKeys.has(key)) fail("INVALID_FIELD", `${path}.${key}`, "unknown field");
	}
	for (const key of expected) {
		if (!(key in record)) fail("INVALID_FIELD", `${path}.${key}`, "missing field");
	}
}

function expectPortableId(value: unknown, path: string): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
		fail("INVALID_FIELD", path, "id must be a portable 1-128 character identifier");
	}
	return value;
}

function expectFolderPath(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value)) fail("INVALID_FIELD", path, "folderPath must be an array");
	if (value.length > OPENFAB_USER_BLUEPRINT_MAX_FOLDER_DEPTH) {
		fail(
			"INVALID_FIELD",
			path,
			`folderPath cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_FOLDER_DEPTH} segments`,
		);
	}
	return Object.freeze(
		value.map((segment, index) => {
			const segmentPath = `${path}[${index}]`;
			if (typeof segment !== "string") {
				fail("INVALID_FIELD", segmentPath, "folder segment must be a string");
			}
			if (
				segment.length === 0 ||
				segment.length > OPENFAB_USER_BLUEPRINT_MAX_FOLDER_SEGMENT_LENGTH ||
				segment.trim() !== segment ||
				segment === "." ||
				segment === ".." ||
				segment.includes("/") ||
				segment.includes("\\") ||
				hasControlCharacter(segment)
			) {
				fail("INVALID_FIELD", segmentPath, "folder segment is not normalized or portable");
			}
			return segment;
		}),
	);
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

function expectQuickSlot(value: unknown, path: string): number | null {
	if (value === null) return null;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < OPENFAB_USER_BLUEPRINT_MIN_QUICK_SLOT ||
		value > OPENFAB_USER_BLUEPRINT_MAX_QUICK_SLOT
	) {
		fail(
			"INVALID_FIELD",
			path,
			`quickSlot must be null or ${OPENFAB_USER_BLUEPRINT_MIN_QUICK_SLOT}-${OPENFAB_USER_BLUEPRINT_MAX_QUICK_SLOT}`,
		);
	}
	return value;
}

function expectCanonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
		fail("INVALID_FIELD", path, "timestamp must be a canonical UTC ISO-8601 value");
	}
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
		fail("INVALID_FIELD", path, "timestamp is not a real canonical UTC instant");
	}
	return value;
}

function sortJsonObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
	if (typeof value !== "object" || value === null) return value;
	const record = value as Readonly<Record<string, unknown>>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) {
		sorted[key] = sortJsonObjectKeys(record[key]);
	}
	return sorted;
}

function assertDiagnosticJsonValue(value: unknown): void {
	const seen = new WeakSet<object>();
	const stack: Array<Readonly<{ value: unknown; path: string; depth: number }>> = [
		Object.freeze({ value, path: "$", depth: 0 }),
	];
	let nodeCount = 0;
	let estimatedJsonBytes = 0;
	const consumeEstimatedJsonBytes = (bytes: number, path: string): void => {
		estimatedJsonBytes += bytes;
		if (estimatedJsonBytes <= OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES) return;
		throw new OpenFabUserBlueprintDiagnosticExportError(
			"LIMIT_EXCEEDED",
			path,
			`diagnostic JSON exceeds the ${formatMebibytes(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES)} MiB export limit`,
		);
	};
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		nodeCount += 1;
		consumeEstimatedJsonBytes(16 + current.depth * 2, current.path);
		if (nodeCount > OPENFAB_USER_BLUEPRINT_MAX_DIAGNOSTIC_NODES) {
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"LIMIT_EXCEEDED",
				current.path,
				`diagnostic value exceeds ${OPENFAB_USER_BLUEPRINT_MAX_DIAGNOSTIC_NODES.toLocaleString("en-US")} nodes`,
			);
		}
		if (current.depth > OPENFAB_USER_BLUEPRINT_MAX_DIAGNOSTIC_DEPTH) {
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"LIMIT_EXCEEDED",
				current.path,
				`diagnostic value exceeds ${OPENFAB_USER_BLUEPRINT_MAX_DIAGNOSTIC_DEPTH} levels`,
			);
		}
		if (current.value === null || typeof current.value === "boolean") {
			continue;
		}
		if (typeof current.value === "string") {
			consumeEstimatedJsonBytes(escapedJsonStringByteLength(current.value), current.path);
			continue;
		}
		if (typeof current.value === "number") {
			if (Number.isFinite(current.value) && !Object.is(current.value, -0)) continue;
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"NON_JSON_VALUE",
				current.path,
				"number cannot be represented exactly in JSON",
			);
		}
		if (typeof current.value !== "object") {
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"NON_JSON_VALUE",
				current.path,
				`${typeof current.value} cannot be represented in JSON`,
			);
		}
		if (seen.has(current.value)) {
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"NON_JSON_VALUE",
				current.path,
				"repeated or cyclic references cannot be represented exactly in JSON",
			);
		}
		seen.add(current.value);
		if (Array.isArray(current.value)) {
			if (Object.getOwnPropertySymbols(current.value).length > 0) {
				throw new OpenFabUserBlueprintDiagnosticExportError(
					"NON_JSON_VALUE",
					current.path,
					"symbol properties cannot be represented in JSON",
				);
			}
			const descriptors = Object.getOwnPropertyDescriptors(current.value);
			for (const key of Object.keys(descriptors)) {
				if (key === "length") continue;
				const index = Number(key);
				if (
					!Number.isSafeInteger(index) ||
					index < 0 ||
					index >= current.value.length ||
					`${index}` !== key
				) {
					throw new OpenFabUserBlueprintDiagnosticExportError(
						"NON_JSON_VALUE",
						`${current.path}.${key}`,
						"extra array properties cannot be represented exactly in JSON",
					);
				}
			}
			for (let index = current.value.length - 1; index >= 0; index -= 1) {
				if (!(index in current.value)) {
					throw new OpenFabUserBlueprintDiagnosticExportError(
						"NON_JSON_VALUE",
						`${current.path}[${index}]`,
						"sparse array entries cannot be represented exactly in JSON",
					);
				}
				const descriptor = descriptors[index];
				if (!descriptor?.enumerable || !("value" in descriptor)) {
					throw new OpenFabUserBlueprintDiagnosticExportError(
						"NON_JSON_VALUE",
						`${current.path}[${index}]`,
						"non-enumerable or accessor array entries cannot be represented exactly in JSON",
					);
				}
				stack.push(
					Object.freeze({
						value: descriptor.value,
						path: `${current.path}[${index}]`,
						depth: current.depth + 1,
					}),
				);
			}
			continue;
		}
		const prototype = Object.getPrototypeOf(current.value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"NON_JSON_VALUE",
				current.path,
				"only plain objects can be represented exactly in diagnostic JSON",
			);
		}
		if (Object.getOwnPropertySymbols(current.value).length > 0) {
			throw new OpenFabUserBlueprintDiagnosticExportError(
				"NON_JSON_VALUE",
				current.path,
				"symbol properties cannot be represented in JSON",
			);
		}
		const descriptors = Object.getOwnPropertyDescriptors(current.value);
		for (const key of Object.keys(descriptors).reverse()) {
			consumeEstimatedJsonBytes(escapedJsonStringByteLength(key), `${current.path}.${key}`);
			const descriptor = descriptors[key];
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new OpenFabUserBlueprintDiagnosticExportError(
					"NON_JSON_VALUE",
					`${current.path}.${key}`,
					"non-enumerable or accessor properties cannot be represented exactly in JSON",
				);
			}
			stack.push(
				Object.freeze({
					value: descriptor.value,
					path: `${current.path}.${key}`,
					depth: current.depth + 1,
				}),
			);
		}
	}
}

function escapedJsonStringByteLength(value: string): number {
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f) {
			bytes += 6;
		} else if (code === 0x22 || code === 0x5c) {
			bytes += 2;
		} else if (code <= 0x7f) {
			bytes += 1;
		} else if (code <= 0x7ff) {
			bytes += 2;
		} else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index += 1;
		} else if (code >= 0xd800 && code <= 0xdfff) {
			bytes += 6;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function formatMebibytes(characters: number): string {
	return (characters / (1024 * 1024)).toLocaleString("en-US");
}

function fail(code: OpenFabUserBlueprintParseErrorCode, path: string, message: string): never {
	throw new OpenFabUserBlueprintParseError(code, path, message);
}
