import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { updateOpenFabProjectBlueprint } from "./OpenFabBlueprintLibrary";
import {
	copyOpenFabUserBlueprintRecord,
	OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
	OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
	OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
	OpenFabUserBlueprintParseError,
	type OpenFabUserBlueprintRecord,
	openFabUserBlueprintRecordJsonByteLength,
	openFabUtf8ByteLength,
	parseOpenFabUserBlueprintRecord,
	serializeLegacyOpenFabUserBlueprintRecord,
	serializeOpenFabUserBlueprintRecord,
	updateOpenFabUserBlueprintRecord,
} from "./OpenFabUserBlueprintLibrary";

export const OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_SCHEMA_VERSION = 2 as const;
export const OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_KIND = "OPENFAB_USER_BLUEPRINT_LIBRARY" as const;
export const OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION = ".openfablib";
export const OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES = 128 * 1024 * 1024;
export const OPENFAB_USER_BLUEPRINT_RESTORE_GENERATED_ID_LENGTH = 51;

export interface OpenFabUserBlueprintLibraryBundle {
	readonly schemaVersion: typeof OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_SCHEMA_VERSION;
	readonly kind: typeof OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_KIND;
	readonly exportedAt: string;
	readonly recordCount: number;
	readonly aggregateEdgeCount: number;
	readonly fingerprint: string;
	readonly records: readonly OpenFabUserBlueprintRecord[];
}

export interface OpenFabUserBlueprintLibraryBundleFileRead {
	readonly name: string;
	readonly json: string;
}

export interface OpenFabUserBlueprintLibraryBundleFileGateway {
	chooseLibraryImport(
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintLibraryBundleFileRead | null>;
	chooseLibraryExport(suggestedName: string, json: string, signal?: AbortSignal): Promise<boolean>;
}

export type OpenFabUserBlueprintLibraryRestoreMode = "merge" | "replace";
export type OpenFabUserBlueprintLibraryConflictDecision = "keep-current" | "import-copy";
export type OpenFabUserBlueprintLibraryConflictKind = "id" | "folder-name" | "quick-slot";

export interface OpenFabUserBlueprintLibraryConflictReason {
	readonly kind: OpenFabUserBlueprintLibraryConflictKind;
	readonly currentRecordId: string;
	readonly currentRecordName: string;
	readonly currentFolderPath: readonly string[];
	readonly currentQuickSlot: number | null;
}

export interface OpenFabUserBlueprintLibraryRestoreConflict {
	readonly incomingRecord: OpenFabUserBlueprintRecord;
	readonly reasons: readonly OpenFabUserBlueprintLibraryConflictReason[];
}

export interface OpenFabUserBlueprintLibraryRestorePreflight {
	readonly bundle: OpenFabUserBlueprintLibraryBundle;
	readonly currentRecords: readonly OpenFabUserBlueprintRecord[];
	readonly additiveRecords: readonly OpenFabUserBlueprintRecord[];
	readonly duplicateRecords: readonly OpenFabUserBlueprintRecord[];
	readonly conflicts: readonly OpenFabUserBlueprintLibraryRestoreConflict[];
}

export interface OpenFabUserBlueprintLibraryRestorePlan {
	readonly mode: OpenFabUserBlueprintLibraryRestoreMode;
	readonly records: readonly OpenFabUserBlueprintRecord[];
	readonly importedCount: number;
	readonly importedAsCopyCount: number;
	readonly retainedCount: number;
	readonly skippedDuplicateCount: number;
	readonly skippedConflictCount: number;
	readonly aggregateEdgeCount: number;
}

export type OpenFabUserBlueprintLibraryReplaceImpactKind = "added" | "changed" | "removed";

export interface OpenFabUserBlueprintLibraryReplaceImpactEntry {
	readonly kind: OpenFabUserBlueprintLibraryReplaceImpactKind;
	readonly recordId: string;
	readonly name: string;
	readonly folderPath: readonly string[];
	readonly previousName: string | null;
	readonly previousFolderPath: readonly string[] | null;
	readonly edgeCount: number;
	readonly previousEdgeCount: number | null;
	readonly portCount: number;
	readonly previousPortCount: number | null;
	readonly equipmentGroupCount: number;
	readonly previousEquipmentGroupCount: number | null;
	readonly organizationCount: number;
	readonly previousOrganizationCount: number | null;
	readonly quickSlot: number | null;
	readonly previousQuickSlot: number | null;
}

export interface OpenFabUserBlueprintLibraryReplaceImpact {
	readonly addedCount: number;
	readonly changedCount: number;
	readonly removedCount: number;
	readonly unchangedCount: number;
	readonly entries: readonly OpenFabUserBlueprintLibraryReplaceImpactEntry[];
}

export interface OpenFabUserBlueprintLibraryRestorePlanPreview {
	readonly valid: boolean;
	readonly reason: string | null;
	readonly recordCount: number;
	readonly aggregateEdgeCount: number;
	readonly aggregateJsonBytes: number;
}

export function createOpenFabUserBlueprintLibraryBundle(
	records: readonly OpenFabUserBlueprintRecord[],
	exportedAt: string,
): OpenFabUserBlueprintLibraryBundle {
	const normalizedRecords = validateOpenFabUserBlueprintLibrarySnapshot(records);
	const canonicalExportedAt = expectCanonicalTimestamp(exportedAt, "$.exportedAt");
	const aggregateEdgeCount = aggregateEdges(normalizedRecords);
	return Object.freeze({
		schemaVersion: OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_SCHEMA_VERSION,
		kind: OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_KIND,
		exportedAt: canonicalExportedAt,
		recordCount: normalizedRecords.length,
		aggregateEdgeCount,
		fingerprint: fingerprintNormalizedOpenFabUserBlueprintLibrary(normalizedRecords),
		records: normalizedRecords,
	});
}

export function parseOpenFabUserBlueprintLibraryBundleJson(
	source: string,
): OpenFabUserBlueprintLibraryBundle {
	if (openFabUtf8ByteLength(source) > OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES) {
		fail(
			"LIMIT_EXCEEDED",
			"$",
			`library JSON exceeds the ${formatMebibytes(OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES)} MiB parsing limit`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		const detail = error instanceof Error ? error.message : "invalid JSON";
		throw new OpenFabUserBlueprintParseError("INVALID_JSON", "$", detail);
	}
	return parseOpenFabUserBlueprintLibraryBundleValue(value);
}

export function parseOpenFabUserBlueprintLibraryBundleValue(
	value: unknown,
): OpenFabUserBlueprintLibraryBundle {
	const envelope = expectRecord(value, "$", "INVALID_ROOT");
	expectExactKeys(
		envelope,
		[
			"schemaVersion",
			"kind",
			"exportedAt",
			"recordCount",
			"aggregateEdgeCount",
			"fingerprint",
			"records",
		],
		"$",
	);
	if (
		envelope.schemaVersion !== 1 &&
		envelope.schemaVersion !== OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_SCHEMA_VERSION
	) {
		fail(
			"UNSUPPORTED_VERSION",
			"$.schemaVersion",
			`expected schema version ${OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_SCHEMA_VERSION}`,
		);
	}
	if (envelope.kind !== OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_KIND) {
		fail("INVALID_FIELD", "$.kind", `expected ${OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_KIND}`);
	}
	const exportedAt = expectCanonicalTimestamp(envelope.exportedAt, "$.exportedAt");
	const recordCount = expectBoundedInteger(
		envelope.recordCount,
		"$.recordCount",
		OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
	);
	const aggregateEdgeCount = expectBoundedInteger(
		envelope.aggregateEdgeCount,
		"$.aggregateEdgeCount",
		OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
	);
	if (typeof envelope.fingerprint !== "string" || envelope.fingerprint.length > 96) {
		fail("INVALID_FIELD", "$.fingerprint", "fingerprint must be a bounded string");
	}
	if (!Array.isArray(envelope.records)) {
		fail("INVALID_FIELD", "$.records", "records must be an array");
	}
	if (envelope.records.length > OPENFAB_USER_BLUEPRINT_MAX_RECORDS) {
		fail(
			"LIMIT_EXCEEDED",
			"$.records",
			`library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_RECORDS} records`,
		);
	}
	for (let index = 0; index < envelope.records.length; index++) {
		const record = expectRecord(envelope.records[index], `$.records[${index}]`);
		if (record.schemaVersion !== envelope.schemaVersion) {
			fail(
				"UNSUPPORTED_VERSION",
				`$.records[${index}].schemaVersion`,
				"record version must match the library envelope",
			);
		}
	}
	const records = validateOpenFabUserBlueprintLibrarySnapshot(
		envelope.records.map((record, index) => parseRecordAt(record, index)),
	);
	const actualEdgeCount = aggregateEdges(records);
	if (recordCount !== records.length) {
		fail("INVALID_FIELD", "$.recordCount", "record count does not match records");
	}
	if (aggregateEdgeCount !== actualEdgeCount) {
		fail("INVALID_FIELD", "$.aggregateEdgeCount", "edge count does not match records");
	}
	const fingerprint = fingerprintNormalizedOpenFabUserBlueprintLibrary(records);
	let sourceFingerprint = fingerprint;
	if (envelope.schemaVersion === 1) {
		const rawById = new Map(
			envelope.records.map((value, index) => {
				const record = expectRecord(value, `$.records[${index}]`);
				return [record.id, value] as const;
			}),
		);
		const checksum = new OrderedTypedChecksum();
		checksum.addStrings([
			"openfab-user-blueprint-library-v1",
			`${records.length}`,
			`${actualEdgeCount}`,
		]);
		checksum.addStrings(
			records.map((record) => serializeLegacyOpenFabUserBlueprintRecord(rawById.get(record.id))),
		);
		sourceFingerprint = `ofubl1-${checksum.digest()}`;
	}
	if (envelope.fingerprint !== sourceFingerprint) {
		fail("INVALID_FIELD", "$.fingerprint", "library fingerprint does not match records");
	}
	return Object.freeze({
		schemaVersion: OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_SCHEMA_VERSION,
		kind: OPENFAB_USER_BLUEPRINT_LIBRARY_BUNDLE_KIND,
		exportedAt,
		recordCount,
		aggregateEdgeCount,
		fingerprint,
		records,
	});
}

export function serializeOpenFabUserBlueprintLibraryBundle(
	bundle: OpenFabUserBlueprintLibraryBundle,
): string {
	const normalized = parseOpenFabUserBlueprintLibraryBundleValue(bundle);
	const json = `${JSON.stringify(sortJsonObjectKeys(normalized))}\n`;
	if (openFabUtf8ByteLength(json) > OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES) {
		fail(
			"LIMIT_EXCEEDED",
			"$",
			`library JSON exceeds the ${formatMebibytes(OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES)} MiB serialization limit`,
		);
	}
	return json;
}

export function validateOpenFabUserBlueprintLibrarySnapshot(
	records: readonly OpenFabUserBlueprintRecord[],
): readonly OpenFabUserBlueprintRecord[] {
	if (records.length > OPENFAB_USER_BLUEPRINT_MAX_RECORDS) {
		fail(
			"LIMIT_EXCEEDED",
			"$.records",
			`library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_RECORDS} records`,
		);
	}
	const normalized: OpenFabUserBlueprintRecord[] = [];
	const ids = new Set<string>();
	const folderNames = new Set<string>();
	const quickSlots = new Set<number>();
	let edgeCount = 0;
	let aggregateJsonBytes = 0;
	for (let index = 0; index < records.length; index++) {
		const record = parseRecordAt(records[index], index);
		if (ids.has(record.id)) {
			fail("INVALID_FIELD", `$.records[${index}].id`, "duplicate record id");
		}
		ids.add(record.id);
		const folderName = folderNameKey(record);
		if (folderNames.has(folderName)) {
			fail(
				"INVALID_FIELD",
				`$.records[${index}].blueprint.name`,
				"duplicate folder and name identity",
			);
		}
		folderNames.add(folderName);
		if (record.quickSlot !== null) {
			if (quickSlots.has(record.quickSlot)) {
				fail("INVALID_FIELD", `$.records[${index}].quickSlot`, "duplicate quick slot");
			}
			quickSlots.add(record.quickSlot);
		}
		edgeCount += record.blueprint.edges.length;
		if (edgeCount > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES) {
			fail(
				"LIMIT_EXCEEDED",
				"$.records",
				`library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES.toLocaleString("en-US")} directed edges`,
			);
		}
		aggregateJsonBytes += openFabUserBlueprintRecordJsonByteLength(record);
		if (aggregateJsonBytes > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES) {
			fail(
				"LIMIT_EXCEEDED",
				"$.records",
				`library cannot exceed ${formatMebibytes(OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES)} MiB of canonical blueprint JSON`,
			);
		}
		normalized.push(copyOpenFabUserBlueprintRecord(record));
	}
	normalized.sort((left, right) => compareCanonicalCodeUnits(left.id, right.id));
	return Object.freeze(normalized);
}

export function fingerprintOpenFabUserBlueprintLibrary(
	records: readonly OpenFabUserBlueprintRecord[],
): string {
	const normalized = validateOpenFabUserBlueprintLibrarySnapshot(records);
	return fingerprintNormalizedOpenFabUserBlueprintLibrary(normalized);
}

function fingerprintNormalizedOpenFabUserBlueprintLibrary(
	normalized: readonly OpenFabUserBlueprintRecord[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"openfab-user-blueprint-library-v2",
		`${normalized.length}`,
		`${aggregateEdges(normalized)}`,
	]);
	checksum.addStrings(normalized.map((record) => serializeOpenFabUserBlueprintRecord(record)));
	return `ofubl2-${checksum.digest()}`;
}

export function createOpenFabUserBlueprintLibraryRestorePreflight(
	bundle: OpenFabUserBlueprintLibraryBundle,
	currentRecords: readonly OpenFabUserBlueprintRecord[],
): OpenFabUserBlueprintLibraryRestorePreflight {
	const normalizedBundle = parseOpenFabUserBlueprintLibraryBundleValue(bundle);
	const current = validateOpenFabUserBlueprintLibrarySnapshot(currentRecords);
	const currentById = new Map(current.map((record) => [record.id, record] as const));
	const currentByFolderName = new Map(
		current.map((record) => [folderNameKey(record), record] as const),
	);
	const currentByQuickSlot = new Map(
		current
			.filter((record) => record.quickSlot !== null)
			.map((record) => [record.quickSlot as number, record] as const),
	);
	const additiveRecords: OpenFabUserBlueprintRecord[] = [];
	const duplicateRecords: OpenFabUserBlueprintRecord[] = [];
	const conflicts: OpenFabUserBlueprintLibraryRestoreConflict[] = [];
	for (const incoming of normalizedBundle.records) {
		const sameId = currentById.get(incoming.id);
		if (sameId && openFabUserBlueprintRecordsEqual(sameId, incoming)) {
			duplicateRecords.push(copyOpenFabUserBlueprintRecord(incoming));
			continue;
		}
		const reasons: OpenFabUserBlueprintLibraryConflictReason[] = [];
		if (sameId) reasons.push(conflictReason("id", sameId));
		const sameFolderName = currentByFolderName.get(folderNameKey(incoming));
		if (sameFolderName) reasons.push(conflictReason("folder-name", sameFolderName));
		if (incoming.quickSlot !== null) {
			const sameQuickSlot = currentByQuickSlot.get(incoming.quickSlot);
			if (sameQuickSlot) reasons.push(conflictReason("quick-slot", sameQuickSlot));
		}
		const uniqueReasons = deduplicateConflictReasons(reasons);
		if (uniqueReasons.length === 0) {
			additiveRecords.push(copyOpenFabUserBlueprintRecord(incoming));
		} else {
			conflicts.push(
				Object.freeze({
					incomingRecord: copyOpenFabUserBlueprintRecord(incoming),
					reasons: uniqueReasons,
				}),
			);
		}
	}
	return Object.freeze({
		bundle: normalizedBundle,
		currentRecords: current,
		additiveRecords: Object.freeze(additiveRecords),
		duplicateRecords: Object.freeze(duplicateRecords),
		conflicts: Object.freeze(conflicts),
	});
}

export function planOpenFabUserBlueprintLibraryRestore(
	preflight: OpenFabUserBlueprintLibraryRestorePreflight,
	mode: OpenFabUserBlueprintLibraryRestoreMode,
	decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
	options: Readonly<{ createId: () => string; restoredAt: string }>,
): OpenFabUserBlueprintLibraryRestorePlan {
	const restoredAt = expectCanonicalTimestamp(options.restoredAt, "$.restoredAt");
	if (mode === "replace") {
		const records = validateOpenFabUserBlueprintLibrarySnapshot(preflight.bundle.records);
		return Object.freeze({
			mode,
			records,
			importedCount: records.length,
			importedAsCopyCount: 0,
			retainedCount: 0,
			skippedDuplicateCount: 0,
			skippedConflictCount: 0,
			aggregateEdgeCount: aggregateEdges(records),
		});
	}

	const merged = [...validateOpenFabUserBlueprintLibrarySnapshot(preflight.currentRecords)];
	const occupiedIds = new Set(merged.map(({ id }) => id));
	let importedAsCopyCount = 0;
	let skippedConflictCount = 0;
	for (const record of preflight.additiveRecords) {
		merged.push(copyOpenFabUserBlueprintRecord(record));
		occupiedIds.add(record.id);
	}
	for (const conflict of preflight.conflicts) {
		const decision = decisions.get(conflict.incomingRecord.id) ?? "keep-current";
		if (decision === "keep-current") {
			skippedConflictCount += 1;
			continue;
		}
		const copied = createImportedCopy(
			conflict.incomingRecord,
			merged,
			occupiedIds,
			options.createId,
			restoredAt,
		);
		merged.push(copied);
		occupiedIds.add(copied.id);
		importedAsCopyCount += 1;
	}
	const records = validateOpenFabUserBlueprintLibrarySnapshot(merged);
	return Object.freeze({
		mode,
		records,
		importedCount: preflight.additiveRecords.length + importedAsCopyCount,
		importedAsCopyCount,
		retainedCount: preflight.currentRecords.length,
		skippedDuplicateCount: preflight.duplicateRecords.length,
		skippedConflictCount,
		aggregateEdgeCount: aggregateEdges(records),
	});
}

export function previewOpenFabUserBlueprintLibraryRestorePlan(
	preflight: OpenFabUserBlueprintLibraryRestorePreflight,
	mode: OpenFabUserBlueprintLibraryRestoreMode,
	decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
): OpenFabUserBlueprintLibraryRestorePlanPreview {
	try {
		let ordinal = 0;
		const plan = planOpenFabUserBlueprintLibraryRestore(preflight, mode, decisions, {
			createId: () => maximumLengthPreviewId(ordinal++),
			restoredAt: "9999-12-31T23:59:59.999Z",
		});
		return Object.freeze({
			valid: true,
			reason: null,
			recordCount: plan.records.length,
			aggregateEdgeCount: plan.aggregateEdgeCount,
			aggregateJsonBytes: aggregateJsonBytes(plan.records),
		});
	} catch (error) {
		return Object.freeze({
			valid: false,
			reason: error instanceof Error ? error.message : "restore plan is invalid",
			recordCount: 0,
			aggregateEdgeCount: 0,
			aggregateJsonBytes: 0,
		});
	}
}

export function createOpenFabUserBlueprintLibraryReplaceImpact(
	preflight: OpenFabUserBlueprintLibraryRestorePreflight,
): OpenFabUserBlueprintLibraryReplaceImpact {
	const currentById = new Map(
		preflight.currentRecords.map((record) => [record.id, record] as const),
	);
	const incomingIds = new Set(preflight.bundle.records.map(({ id }) => id));
	const entries: OpenFabUserBlueprintLibraryReplaceImpactEntry[] = [];
	let addedCount = 0;
	let changedCount = 0;
	let unchangedCount = 0;
	for (const incoming of preflight.bundle.records) {
		const current = currentById.get(incoming.id);
		if (!current) {
			addedCount += 1;
			entries.push(replaceImpactEntry("added", incoming));
			continue;
		}
		if (openFabUserBlueprintRecordsEqual(current, incoming)) {
			unchangedCount += 1;
			continue;
		}
		changedCount += 1;
		entries.push(replaceImpactEntry("changed", incoming, current));
	}
	let removedCount = 0;
	for (const current of preflight.currentRecords) {
		if (incomingIds.has(current.id)) continue;
		removedCount += 1;
		entries.push(replaceImpactEntry("removed", current));
	}
	entries.sort((left, right) => {
		const kindOrder = replaceImpactKindOrder(left.kind) - replaceImpactKindOrder(right.kind);
		if (kindOrder !== 0) return kindOrder;
		const folderOrder = compareCanonicalCodeUnits(
			left.folderPath.join("/").toLocaleLowerCase("en-US"),
			right.folderPath.join("/").toLocaleLowerCase("en-US"),
		);
		return (
			folderOrder ||
			compareCanonicalCodeUnits(
				left.name.toLocaleLowerCase("en-US"),
				right.name.toLocaleLowerCase("en-US"),
			)
		);
	});
	return Object.freeze({
		addedCount,
		changedCount,
		removedCount,
		unchangedCount,
		entries: Object.freeze(entries),
	});
}

export function openFabUserBlueprintRecordsEqual(
	left: OpenFabUserBlueprintRecord,
	right: OpenFabUserBlueprintRecord,
): boolean {
	return serializeOpenFabUserBlueprintRecord(left) === serializeOpenFabUserBlueprintRecord(right);
}

function createImportedCopy(
	record: OpenFabUserBlueprintRecord,
	occupied: readonly OpenFabUserBlueprintRecord[],
	occupiedIds: ReadonlySet<string>,
	createId: () => string,
	restoredAt: string,
): OpenFabUserBlueprintRecord {
	let id = "";
	for (let attempt = 0; attempt < OPENFAB_USER_BLUEPRINT_MAX_RECORDS * 2; attempt++) {
		id = createId();
		try {
			parseOpenFabUserBlueprintRecord({ ...record, id });
		} catch {
			continue;
		}
		if (!occupiedIds.has(id)) break;
		id = "";
	}
	if (!id) throw new Error("Unable to allocate a unique imported blueprint id.");
	const name = uniqueImportedName(record, occupied);
	const updatedAt = [restoredAt, record.createdAt, record.updatedAt, record.blueprint.updatedAt]
		.sort()
		.at(-1) as string;
	const blueprint = updateOpenFabProjectBlueprint(record.blueprint, {
		name,
		folder: record.folderPath.join("/"),
		updatedAt,
	});
	return parseOpenFabUserBlueprintRecord({
		...updateOpenFabUserBlueprintRecord(record, {
			quickSlot: null,
			updatedAt,
			blueprint,
		}),
		id,
	});
}

function uniqueImportedName(
	record: OpenFabUserBlueprintRecord,
	occupied: readonly OpenFabUserBlueprintRecord[],
): string {
	const identities = new Set(occupied.map(folderNameKey));
	for (let ordinal = 1; ordinal <= OPENFAB_USER_BLUEPRINT_MAX_RECORDS + 1; ordinal++) {
		const suffix = ordinal === 1 ? " (Imported)" : ` (Imported ${ordinal})`;
		const name = `${record.blueprint.name.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
		const identity = `${folderPathKey(record.folderPath)}\u0000${name.toLocaleLowerCase("en-US")}`;
		if (!identities.has(identity)) return name;
	}
	throw new Error("Unable to allocate a unique imported blueprint name.");
}

function conflictReason(
	kind: OpenFabUserBlueprintLibraryConflictKind,
	record: OpenFabUserBlueprintRecord,
): OpenFabUserBlueprintLibraryConflictReason {
	return Object.freeze({
		kind,
		currentRecordId: record.id,
		currentRecordName: record.blueprint.name,
		currentFolderPath: Object.freeze([...record.folderPath]),
		currentQuickSlot: record.quickSlot,
	});
}

function aggregateJsonBytes(records: readonly OpenFabUserBlueprintRecord[]): number {
	return records.reduce(
		(total, record) => total + openFabUserBlueprintRecordJsonByteLength(record),
		0,
	);
}

function maximumLengthPreviewId(ordinal: number): string {
	const suffix = `-${ordinal.toString(36)}`;
	return `restore-preview-${"x".repeat(
		OPENFAB_USER_BLUEPRINT_RESTORE_GENERATED_ID_LENGTH - "restore-preview-".length - suffix.length,
	)}${suffix}`;
}

function replaceImpactEntry(
	kind: OpenFabUserBlueprintLibraryReplaceImpactKind,
	record: OpenFabUserBlueprintRecord,
	previous?: OpenFabUserBlueprintRecord,
): OpenFabUserBlueprintLibraryReplaceImpactEntry {
	const counts = blueprintContentCounts(record);
	const previousCounts = previous ? blueprintContentCounts(previous) : null;
	return Object.freeze({
		kind,
		recordId: record.id,
		name: record.blueprint.name,
		folderPath: Object.freeze([...record.folderPath]),
		previousName: previous?.blueprint.name ?? null,
		previousFolderPath: previous ? Object.freeze([...previous.folderPath]) : null,
		edgeCount: counts.edges,
		previousEdgeCount: previousCounts?.edges ?? null,
		portCount: counts.ports,
		previousPortCount: previousCounts?.ports ?? null,
		equipmentGroupCount: counts.equipmentGroups,
		previousEquipmentGroupCount: previousCounts?.equipmentGroups ?? null,
		organizationCount: counts.organizations,
		previousOrganizationCount: previousCounts?.organizations ?? null,
		quickSlot: record.quickSlot,
		previousQuickSlot: previous?.quickSlot ?? null,
	});
}

function blueprintContentCounts(record: OpenFabUserBlueprintRecord): Readonly<{
	edges: number;
	ports: number;
	equipmentGroups: number;
	organizations: number;
}> {
	const blueprint = record.blueprint;
	if (blueprint.kind === "STATIC_FAB") {
		return Object.freeze({
			edges: blueprint.edges.length,
			ports: blueprint.ports.length,
			equipmentGroups: blueprint.equipmentGroups.length,
			organizations: 0,
		});
	}
	if (blueprint.kind === "STATIC_FAB_ORGANIZATION") {
		return Object.freeze({
			edges: blueprint.edges.length,
			ports: blueprint.bundle.ports.length,
			equipmentGroups: blueprint.bundle.equipmentGroups.length,
			organizations: blueprint.bundle.organizations.length,
		});
	}
	return Object.freeze({
		edges: blueprint.edges.length,
		ports: 0,
		equipmentGroups: 0,
		organizations: 0,
	});
}

function compareCanonicalCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function replaceImpactKindOrder(kind: OpenFabUserBlueprintLibraryReplaceImpactKind): number {
	if (kind === "added") return 0;
	if (kind === "changed") return 1;
	return 2;
}

function deduplicateConflictReasons(
	reasons: readonly OpenFabUserBlueprintLibraryConflictReason[],
): readonly OpenFabUserBlueprintLibraryConflictReason[] {
	const seen = new Set<string>();
	return Object.freeze(
		reasons.filter((reason) => {
			const key = `${reason.kind}\u0000${reason.currentRecordId}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}),
	);
}

function parseRecordAt(value: unknown, index: number): OpenFabUserBlueprintRecord {
	try {
		return parseOpenFabUserBlueprintRecord(value);
	} catch (error) {
		if (error instanceof OpenFabUserBlueprintParseError) {
			const suffix = error.path === "$" ? "" : error.path.slice(1);
			throw new OpenFabUserBlueprintParseError(
				error.code,
				`$.records[${index}]${suffix}`,
				error.message.replace(/^\$[^:]*:\s*/, ""),
			);
		}
		throw error;
	}
}

function aggregateEdges(records: readonly OpenFabUserBlueprintRecord[]): number {
	return records.reduce((total, record) => total + record.blueprint.edges.length, 0);
}

function folderNameKey(record: OpenFabUserBlueprintRecord): string {
	return `${folderPathKey(record.folderPath)}\u0000${record.blueprint.name.toLocaleLowerCase("en-US")}`;
}

function folderPathKey(folderPath: readonly string[]): string {
	return folderPath.map((segment) => segment.toLocaleLowerCase("en-US")).join("\u0000");
}

function expectRecord(
	value: unknown,
	path: string,
	code: "INVALID_ROOT" | "INVALID_FIELD" = "INVALID_FIELD",
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
	const keys = new Set(expected);
	for (const key of Object.keys(record)) {
		if (!keys.has(key)) fail("INVALID_FIELD", `${path}.${key}`, "unknown field");
	}
	for (const key of expected) {
		if (!(key in record)) fail("INVALID_FIELD", `${path}.${key}`, "missing field");
	}
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

function expectBoundedInteger(value: unknown, path: string, maximum: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
		fail("INVALID_FIELD", path, `expected an integer from 0 to ${maximum}`);
	}
	return value;
}

function sortJsonObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
	if (typeof value !== "object" || value === null) return value;
	const record = value as Readonly<Record<string, unknown>>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) sorted[key] = sortJsonObjectKeys(record[key]);
	return sorted;
}

function formatMebibytes(bytes: number): number {
	return bytes / (1024 * 1024);
}

function fail(
	code:
		| "INVALID_ROOT"
		| "INVALID_JSON"
		| "UNSUPPORTED_VERSION"
		| "INVALID_FIELD"
		| "LIMIT_EXCEEDED",
	path: string,
	message: string,
): never {
	throw new OpenFabUserBlueprintParseError(code, path, message);
}
