import { describe, expect, it } from "vitest";
import {
	hydrateOpenFabStationProposalArtifact,
	hydrateOpenFabStationProposalArtifactCooperatively,
	hydrateOpenFabStationProposalReadFailure,
	issueIndex,
	OPENFAB_STATION_PROPOSAL_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_MAX_DISTINCT_STRINGS,
	OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	type OpenFabStationProposalArtifact,
	type OpenFabStationProposalReadFailureCode,
	openFabStationProposalArtifactShapeError,
	openFabStationProposalArtifactTransfers,
	openFabStationProposalReadFailureShapeError,
	openFabStationProposalSemanticFingerprint,
	openFabStationProposalSnapshotFingerprint,
	readOpenFabStationProposalRow,
	validateOpenFabStationProposalArtifact,
	validateOpenFabStationProposalReadFailure,
} from "./OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "./OpenFabStationProposalCsvReader";

const REQUIRED_HEADERS = [
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
] as const;

const ALL_HEADERS = [...OPENFAB_STATION_PROPOSAL_V1_HEADERS] as const;

type CsvRow = Partial<Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], string>> &
	Readonly<Record<string, string>>;

describe("OpenFabStationProposalCsvReader", () => {
	it("reads the public v1 schema by exact header name with BOM, comments, quotes, and mixed line endings", () => {
		const headers = ["ignored_public_note", ...[...ALL_HEADERS].reverse()];
		const source = encodeCsv(
			headers,
			[
				stationRow({
					port_key: 'PORT,"A"',
					secondary_aliases: "ALT-B|ALT-A",
					physical_group_key: "GROUP-A",
					physical_group_kind: "EQ",
					organization_alias: "BAY-SYNTHETIC",
					source_x_mm: "-1200",
					source_z_mm: "3400",
					ignored_public_note: "discard-me",
				}),
			],
			{ bom: true, prefix: "# public synthetic fixture\r\n\n", newline: "\r" },
		);

		const result = parseOpenFabStationProposalCsv(source);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		validateOpenFabStationProposalArtifact(result.artifact);
		expect(result.artifact).toMatchObject({
			rowCount: 1,
			sourceRecordCount: 1,
			rejectedRowCount: 0,
			unknownColumnCount: 1,
		});
		expect(result.artifact.issueCounts[issueIndex("UNKNOWN_COLUMN")]).toBe(1);
		expect(readOpenFabStationProposalRow(result.artifact, 0)).toEqual({
			identityScope: "synthetic-scope",
			portKey: 'PORT,"A"',
			secondaryAliases: ["ALT-A", "ALT-B"],
			attachmentScope: "rail-scope",
			attachmentAlias: "RAIL-A",
			stationMillimeters: 1500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			directionEvidence: "DECLARED",
			portType: "EQ",
			physicalGroupKey: "GROUP-A",
			physicalGroupKind: "EQ",
			organizationAlias: "BAY-SYNTHETIC",
			sourceXMillimeters: -1200,
			sourceZMillimeters: 3400,
		});
		expect(openFabStationProposalSemanticFingerprint(result.artifact)).toBe(
			result.artifact.semanticFingerprint,
		);
		expect(openFabStationProposalSnapshotFingerprint(result.artifact)).toBe(
			result.artifact.snapshotFingerprint,
		);
		const transfers = openFabStationProposalArtifactTransfers(result.artifact);
		expect(transfers.every((buffer) => buffer.byteLength > 0)).toBe(true);
		expect(new Set(transfers).size).toBe(transfers.length);
	});

	it("parses a quoted leading hash and quoted multiline unknown cell before discarding it", () => {
		const artifact = success(
			encodeCsv(
				[...REQUIRED_HEADERS, "public_note"],
				[
					stationRow({
						identity_scope: "#synthetic,scope",
						public_note: "line one\r\nline two",
					}),
				],
			),
		);

		expect(artifact.rowCount).toBe(1);
		expect(artifact.unknownColumnCount).toBe(1);
		expect(readOpenFabStationProposalRow(artifact, 0).identityScope).toBe("#synthetic,scope");
	});

	it("canonicalizes header order, row order, aliases, and NFC without locale-sensitive ordering", () => {
		const decomposed = "A\u030A";
		const rows = [
			stationRow({ port_key: "PORT-😀", secondary_aliases: `Z|${decomposed}` }),
			stationRow({ port_key: "PORT-A", attachment_alias: "RAIL-B", station_mm: "900" }),
		];
		const forward = success(encodeCsv(ALL_HEADERS, rows));
		const reversed = success(encodeCsv([...ALL_HEADERS].reverse(), [...rows].reverse()));

		expect(forward.semanticFingerprint).toBe(reversed.semanticFingerprint);
		expect(readOpenFabStationProposalRow(forward, 1).secondaryAliases).toEqual(["Z", "Å"]);
		expect(readOpenFabStationProposalRow(forward, 1).portKey).toBe("PORT-😀");
	});

	it("preserves distinct co-located rows, parallel attachments, and identical multiplicity", () => {
		const artifact = success(
			encodeCsv(REQUIRED_HEADERS, [
				stationRow({ port_key: "PORT-A" }),
				stationRow({ port_key: "PORT-A" }),
				stationRow({ port_key: "PORT-B", attachment_alias: "RAIL-B" }),
				stationRow({ port_key: "PORT-B" }),
			]),
		);

		expect(artifact.rowCount).toBe(4);
		const rows = Array.from({ length: artifact.rowCount }, (_, row) =>
			readOpenFabStationProposalRow(artifact, row),
		);
		expect(rows.map((row) => [row.portKey, row.attachmentAlias, row.stationMillimeters])).toEqual([
			["PORT-A", "RAIL-A", 1500],
			["PORT-A", "RAIL-A", 1500],
			["PORT-B", "RAIL-A", 1500],
			["PORT-B", "RAIL-B", 1500],
		]);
		expect(artifact.issueCounts[issueIndex("PRIMARY_ALIAS_COLLISION")]).toBe(4);
	});

	it("keeps unknown type, side, direction, and evidence as explicit unresolved proposals", () => {
		const artifact = success(
			encodeCsv(REQUIRED_HEADERS, [
				stationRow({
					port_type: "PUBLIC_FUTURE_TYPE",
					side: "PUBLIC_FUTURE_SIDE",
					direction: "PUBLIC_FUTURE_DIRECTION",
					direction_evidence: "PUBLIC_FUTURE_EVIDENCE",
				}),
			]),
		);
		const row = readOpenFabStationProposalRow(artifact, 0);

		expect(row).toMatchObject({
			portType: "UNRESOLVED",
			side: "UNRESOLVED",
			direction: "UNKNOWN",
			directionEvidence: "UNKNOWN",
		});
		expect(artifact.issueCounts[issueIndex("UNRESOLVED_PORT_TYPE")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("UNRESOLVED_SIDE")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("UNRESOLVED_DIRECTION")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("UNRESOLVED_DIRECTION_EVIDENCE")]).toBe(1);
	});

	it("counts scope-aware primary/secondary collisions and physical-group kind conflicts", () => {
		const artifact = success(
			encodeCsv(ALL_HEADERS, [
				stationRow({
					port_key: "P",
					secondary_aliases: "Q|R",
					physical_group_key: "G",
					physical_group_kind: "EQ",
				}),
				stationRow({
					port_key: "P",
					secondary_aliases: "R",
					physical_group_key: "G",
					physical_group_kind: "STK",
				}),
				stationRow({ port_key: "Q", physical_group_key: "G", physical_group_kind: "EQ" }),
				stationRow({
					identity_scope: "different-scope",
					port_key: "P",
					secondary_aliases: "Q|R",
					physical_group_key: "G",
					physical_group_kind: "EQ",
				}),
			]),
		);

		expect(artifact.issueCounts[issueIndex("PRIMARY_ALIAS_COLLISION")]).toBe(2);
		expect(artifact.issueCounts[issueIndex("PRIMARY_SECONDARY_ALIAS_COLLISION")]).toBe(2);
		expect(artifact.issueCounts[issueIndex("SECONDARY_ALIAS_COLLISION")]).toBe(2);
		expect(artifact.issueCounts[issueIndex("PHYSICAL_GROUP_KIND_CONFLICT")]).toBe(3);
	});

	it("keeps optional organization and source positions absent without inventing coordinates", () => {
		const artifact = success(encodeCsv(REQUIRED_HEADERS, [stationRow()]));
		const row = readOpenFabStationProposalRow(artifact, 0);

		expect(row.organizationAlias).toBe("");
		expect(row.physicalGroupKey).toBe("");
		expect(row.physicalGroupKind).toBe("UNRESOLVED");
		expect(row.secondaryAliases).toEqual([]);
		expect(row.sourceXMillimeters).toBeNull();
		expect(row.sourceZMillimeters).toBeNull();
	});

	it("turns direction/evidence and side/offset contradictions into blocking unresolved evidence", () => {
		const artifact = success(
			encodeCsv(REQUIRED_HEADERS, [
				stationRow({
					side: "CENTER",
					lateral_offset_mm: "700",
					direction: "WITH_TRAVEL",
					direction_evidence: "UNKNOWN",
				}),
			]),
		);
		const row = readOpenFabStationProposalRow(artifact, 0);

		expect(row.side).toBe("UNRESOLVED");
		expect(row.direction).toBe("UNKNOWN");
		expect(row.directionEvidence).toBe("UNKNOWN");
		expect(artifact.issueCounts[issueIndex("SIDE_OFFSET_CONTRADICTION")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("DIRECTION_EVIDENCE_CONTRADICTION")]).toBe(1);
	});

	it("rejects invalid rows only through aggregate fixed issue counts", () => {
		const artifact = success(
			encodeCsv(ALL_HEADERS, [
				stationRow({ port_key: "", station_mm: "not-a-number" }),
				stationRow({ attachment_alias: "", source_x_mm: "1", source_z_mm: "" }),
			]),
		);

		expect(artifact.rowCount).toBe(0);
		expect(artifact.rejectedRowCount).toBe(2);
		expect(artifact.issueCounts[issueIndex("MISSING_PORT_KEY")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("INVALID_STATION_MILLIMETERS")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("MISSING_ATTACHMENT_ALIAS")]).toBe(1);
		expect(artifact.issueCounts[issueIndex("INVALID_SOURCE_POSITION")]).toBe(1);
	});

	it("aggregates short and long rows before indexing known cells", () => {
		const cells = rowCells(REQUIRED_HEADERS, stationRow());
		const source = new TextEncoder().encode(
			`${REQUIRED_HEADERS.join(",")}\n${cells.slice(0, -1).join(",")}\n${[...cells, "extra"].join(",")}\n`,
		);
		const artifact = success(source);

		expect(artifact.rowCount).toBe(0);
		expect(artifact.rejectedRowCount).toBe(2);
		expect(artifact.issueCounts[issueIndex("ROW_COLUMN_MISMATCH")]).toBe(2);
	});

	it.each([
		"1e3",
		"0x10",
		"1.5",
		"2147483648",
		"-0",
	])("rejects non-canonical station integer %s without Number coercion", (value) => {
		const artifact = success(encodeCsv(REQUIRED_HEADERS, [stationRow({ station_mm: value })]));
		expect(artifact.rowCount).toBe(0);
		expect(artifact.rejectedRowCount).toBe(1);
		expect(artifact.issueCounts[issueIndex("INVALID_STATION_MILLIMETERS")]).toBe(1);
	});

	it("accepts sixteen secondary aliases and rejects the seventeenth as one aggregate row issue", () => {
		const optionalHeaders = [...REQUIRED_HEADERS, "secondary_aliases"];
		const exactAliasBytes = Math.max(...optionalHeaders.map((header) => header.length));
		expect(
			parseOpenFabStationProposalCsv(
				encodeCsv(optionalHeaders, [
					stationRow({ secondary_aliases: "A".repeat(exactAliasBytes) }),
				]),
				{ maxFieldBytes: exactAliasBytes },
			).ok,
		).toBe(true);
		expect(
			failureCode(
				encodeCsv(optionalHeaders, [
					stationRow({ secondary_aliases: "A".repeat(exactAliasBytes + 1) }),
				]),
				{ maxFieldBytes: exactAliasBytes },
			),
		).toBe("FIELD_LIMIT_EXCEEDED");
		const sixteen = Array.from({ length: 16 }, (_, index) => `A${index}`).join("|");
		const accepted = success(
			encodeCsv(optionalHeaders, [stationRow({ secondary_aliases: sixteen })]),
		);
		expect(readOpenFabStationProposalRow(accepted, 0).secondaryAliases).toHaveLength(16);

		const seventeen = `${sixteen}|A16`;
		const rejected = success(
			encodeCsv(optionalHeaders, [stationRow({ secondary_aliases: seventeen })]),
		);
		expect(rejected.rowCount).toBe(0);
		expect(rejected.issueCounts[issueIndex("INVALID_SECONDARY_ALIASES")]).toBe(1);
	});

	it.each<[string, Uint8Array, OpenFabStationProposalReadFailureCode]>([
		["empty", new Uint8Array(), "SOURCE_EMPTY"],
		["invalid UTF-8", Uint8Array.from([0xc3, 0x28]), "INVALID_UTF8"],
		[
			"malformed quoting",
			new TextEncoder().encode(`${REQUIRED_HEADERS.join(",")}\n"unterminated`),
			"MALFORMED_CSV",
		],
		[
			"garbage after closing quote",
			new TextEncoder().encode(`${REQUIRED_HEADERS.join(",")}\n"closed"garbage`),
			"MALFORMED_CSV",
		],
		[
			"prohibited control",
			new TextEncoder().encode(
				`${REQUIRED_HEADERS.join(",")}\n${rowCells(REQUIRED_HEADERS, stationRow()).join(",")}\u0000`,
			),
			"PROHIBITED_TEXT",
		],
		[
			"mid-file BOM",
			new TextEncoder().encode(
				`${REQUIRED_HEADERS.join(",")}\n\ufeff${rowCells(REQUIRED_HEADERS, stationRow()).join(",")}`,
			),
			"PROHIBITED_TEXT",
		],
		[
			"bidi formatting control",
			new TextEncoder().encode(
				`${REQUIRED_HEADERS.join(",")}\n\u202e${rowCells(REQUIRED_HEADERS, stationRow()).join(",")}`,
			),
			"PROHIBITED_TEXT",
		],
		["missing header", new TextEncoder().encode("# comments only\n\n"), "MISSING_HEADER"],
		[
			"missing required header",
			encodeCsv(
				REQUIRED_HEADERS.filter((header) => header !== "port_key"),
				[],
			),
			"MISSING_REQUIRED_HEADER",
		],
		[
			"duplicate known header",
			new TextEncoder().encode(`${REQUIRED_HEADERS.join(",")},port_key\n`),
			"DUPLICATE_REQUIRED_HEADER",
		],
		[
			"unpaired source headers",
			encodeCsv([...REQUIRED_HEADERS, "source_x_mm"], []),
			"OPTIONAL_HEADER_PAIR_MISMATCH",
		],
	])("fails closed for %s without raw values", (_label, source, code) => {
		const result = parseOpenFabStationProposalCsv(source);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		validateOpenFabStationProposalReadFailure(result.failure);
		expect(result.failure.code).toBe(code);
		expect(Object.keys(result.failure).sort()).toEqual(
			[
				"acceptedRowCount",
				"code",
				"issueCounts",
				"kind",
				"recordsSeen",
				"rejectedRowCount",
				"schemaId",
				"schemaVersion",
				"snapshotFingerprint",
				"sourceByteLength",
				"unknownColumnCount",
			].sort(),
		);
	});

	it("enforces byte, field-byte, logical-record, row, and cell bounds", () => {
		expect(failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow()]), { maxSourceBytes: 32 })).toBe(
			"SOURCE_BYTE_LIMIT_EXCEEDED",
		);
		const exactFieldBytes = Math.max(
			...REQUIRED_HEADERS.map((header) => new TextEncoder().encode(header).length),
		);
		expect(
			parseOpenFabStationProposalCsv(
				encodeCsv(REQUIRED_HEADERS, [stationRow({ port_key: "P".repeat(exactFieldBytes) })]),
				{ maxFieldBytes: exactFieldBytes },
			).ok,
		).toBe(true);
		expect(
			failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow({ port_key: "界".repeat(7) })]), {
				maxFieldBytes: exactFieldBytes,
			}),
		).toBe("FIELD_LIMIT_EXCEEDED");
		const defaultRow = stationRow();
		const exactRecordBytes = Math.max(
			recordPayloadBytes(REQUIRED_HEADERS),
			recordPayloadBytes(rowCells(REQUIRED_HEADERS, defaultRow)),
		);
		expect(
			parseOpenFabStationProposalCsv(encodeCsv(REQUIRED_HEADERS, [defaultRow]), {
				maxRecordBytes: exactRecordBytes,
			}).ok,
		).toBe(true);
		expect(
			failureCode(encodeCsv(REQUIRED_HEADERS, [defaultRow]), {
				maxRecordBytes: exactRecordBytes - 1,
			}),
		).toBe("RECORD_LIMIT_EXCEEDED");
		expect(
			failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow({ port_key: "界".repeat(20) })]), {
				maxFieldBytes: 48,
			}),
		).toBe("FIELD_LIMIT_EXCEEDED");
		expect(failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow()]), { maxRecordBytes: 64 })).toBe(
			"RECORD_LIMIT_EXCEEDED",
		);
		expect(
			failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow(), stationRow({ port_key: "B" })]), {
				maxRows: 1,
			}),
		).toBe("ROW_LIMIT_EXCEEDED");
		const exactHeaders = [
			...REQUIRED_HEADERS,
			...Array.from({ length: 54 }, (_, index) => `unknown_${index}`),
		];
		expect(parseOpenFabStationProposalCsv(encodeCsv(exactHeaders, [])).ok).toBe(true);
		const tooManyHeaders = [...exactHeaders, "unknown_54"];
		expect(failureCode(encodeCsv(tooManyHeaders, []))).toBe("COLUMN_LIMIT_EXCEEDED");
		expect(
			failureCode(
				encodeCsv(
					[...REQUIRED_HEADERS, "secondary_aliases"],
					[
						stationRow({ secondary_aliases: "A" }),
						stationRow({ port_key: "B", secondary_aliases: "B" }),
					],
				),
				{ maxTotalSecondaryAliases: 1 },
			),
		).toBe("SECONDARY_ALIAS_LIMIT_EXCEEDED");
		expect(
			failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow()]), { maxDistinctStrings: 4 }),
		).toBe("STRING_POOL_LIMIT_EXCEEDED");
		expect(
			failureCode(encodeCsv(REQUIRED_HEADERS, [stationRow()]), { maxStringPoolBytes: 4 }),
		).toBe("STRING_POOL_LIMIT_EXCEEDED");
	});

	it("materializes a representative fixture as compact canonical SoA", async () => {
		const rowCount = 512;
		const header = REQUIRED_HEADERS.join(",");
		const rows = Array.from(
			{ length: rowCount },
			(_, index) => `s,P${index},r,a,${index},CENTER,0,UNKNOWN,UNKNOWN,OHB`,
		);
		const source = new TextEncoder().encode(`${header}\n${rows.join("\n")}\n`);

		const artifact = success(source);

		expect(artifact.rowCount).toBe(rowCount);
		expect(artifact.rejectedRowCount).toBe(0);
		expect(openFabStationProposalSemanticFingerprint(artifact)).toBe(artifact.semanticFingerprint);
		const transferableBytes = openFabStationProposalArtifactTransfers(artifact).reduce(
			(total, buffer) => total + buffer.byteLength,
			0,
		);
		expect(transferableBytes).toBeLessThan(128 * 1024);

		let checkpointCount = 0;
		const facade = await hydrateOpenFabStationProposalArtifactCooperatively(artifact, {
			async checkpoint() {
				checkpointCount++;
				await Promise.resolve();
			},
		});
		expect(checkpointCount).toBeGreaterThan(10);
		expect(facade.rowCount).toBe(rowCount);
		expect(facade.readRow(rowCount - 1).portKey).toBe("P99");
	});
});

describe("OpenFabStationProposalArtifact", () => {
	it("rejects extra keys, aliases, subviews, value drift, and fingerprint drift", () => {
		const artifact = success(encodeCsv(REQUIRED_HEADERS, [stationRow()]));
		const arrayForgery = Object.assign([], structuredClone(artifact));
		expect(openFabStationProposalArtifactShapeError(arrayForgery)).toBe("NOT_OBJECT");
		const rawFailure = rejectedResult(new Uint8Array()).failure;
		const failureArrayForgery = Object.assign([], structuredClone(rawFailure));
		expect(openFabStationProposalReadFailureShapeError(failureArrayForgery)).toBe("NOT_OBJECT");
		const extra = structuredClone(artifact) as OpenFabStationProposalArtifact & { extra: boolean };
		extra.extra = true;
		expect(openFabStationProposalArtifactShapeError(extra)).toBe("CONTRACT_MISMATCH");

		const subview = structuredClone(artifact);
		const oversized = new Uint32Array(subview.portKeyStringIndices.length + 1);
		oversized.set(subview.portKeyStringIndices, 1);
		const subviewForgery = {
			...subview,
			portKeyStringIndices: oversized.subarray(1),
		};
		expect(openFabStationProposalArtifactShapeError(subviewForgery)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);

		const aliased = structuredClone(artifact);
		expect(
			openFabStationProposalArtifactShapeError({ ...aliased, directions: aliased.sides }),
		).toBe("BUFFER_OWNERSHIP_MISMATCH");
		const shared = structuredClone(artifact);
		const sharedSides = new Uint8Array(new SharedArrayBuffer(shared.sides.byteLength));
		sharedSides.set(shared.sides);
		expect(openFabStationProposalArtifactShapeError({ ...shared, sides: sharedSides })).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);

		const drift = structuredClone(artifact);
		drift.stationMillimeters[0] = 1600;
		expect(openFabStationProposalArtifactShapeError(drift)).toBe("SEMANTIC_FINGERPRINT_MISMATCH");

		const excessiveStringCount = {
			...structuredClone(artifact),
			stringCount: OPENFAB_STATION_PROPOSAL_MAX_DISTINCT_STRINGS + 1,
		};
		expect(openFabStationProposalArtifactShapeError(excessiveStringCount)).toBe("SCALAR_MISMATCH");

		const oversizedSpan = structuredClone(artifact);
		const largeBytes = new Uint8Array(OPENFAB_STATION_PROPOSAL_MAX_NORMALIZED_STRING_BYTES + 1);
		const largeOffsets = new Uint32Array(oversizedSpan.stringOffsets);
		largeOffsets[largeOffsets.length - 1] = largeBytes.length;
		const spanForgery = {
			...oversizedSpan,
			sourceByteLength: 16 * 1024 * 1024,
			stringBytes: largeBytes,
			stringOffsets: largeOffsets,
		};
		expect(openFabStationProposalArtifactShapeError(spanForgery)).toBe("STRING_POOL_MISMATCH");
	});

	it("adopts transferred snapshots and failures behind immutable accessor-only facades", () => {
		const artifact = success(encodeCsv(REQUIRED_HEADERS, [stationRow()]));
		const sourceColumn = artifact.stationMillimeters;
		const facade = hydrateOpenFabStationProposalArtifact(artifact);
		const row = facade.readRow(0);

		expect(sourceColumn.byteLength).toBe(0);
		expect(facade.kind).toBe("hydrated-openfab-station-proposal-artifact");
		expect(Object.keys(facade).sort()).toEqual(
			[
				"kind",
				"schemaId",
				"schemaVersion",
				"sourceByteLength",
				"sourceRecordCount",
				"rowCount",
				"rejectedRowCount",
				"unknownColumnCount",
				"semanticFingerprint",
				"snapshotFingerprint",
				"readRow",
				"issueCount",
			].sort(),
		);
		expect(Object.values(facade).some((value) => ArrayBuffer.isView(value))).toBe(false);
		expect(row.stationMillimeters).toBe(1500);
		expect(Object.isFrozen(row)).toBe(true);
		expect(Object.isFrozen(row.secondaryAliases)).toBe(true);
		expect("stationMillimeters" in facade).toBe(false);
		expect(() => facade.readRow(1)).toThrow("ROW_INDEX_OUT_OF_RANGE");

		const rawFailure = rejectedResult(new Uint8Array()).failure;
		const sourceIssues = rawFailure.issueCounts;
		const failureFacade = hydrateOpenFabStationProposalReadFailure(rawFailure);
		expect(sourceIssues.byteLength).toBe(0);
		expect(failureFacade.kind).toBe("hydrated-openfab-station-proposal-read-failure");
		expect(Object.values(failureFacade).some((value) => ArrayBuffer.isView(value))).toBe(false);
		expect(failureFacade.issueCount(OPENFAB_STATION_PROPOSAL_ISSUE_CODES[0])).toBe(0);
		expect("issueCounts" in failureFacade).toBe(false);
	});

	it("cancels cooperative adoption after taking private buffer ownership", async () => {
		const artifact = success(encodeCsv(REQUIRED_HEADERS, [stationRow()]));
		const sourceColumn = artifact.stationMillimeters;
		const controller = new AbortController();

		await expect(
			hydrateOpenFabStationProposalArtifactCooperatively(artifact, {
				signal: controller.signal,
				async checkpoint() {
					controller.abort();
				},
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "STATION_PROPOSAL_HYDRATION_ABORTED",
		});
		expect(sourceColumn.byteLength).toBe(0);
	});

	it("cooperatively rejects deep snapshot drift after shallow ownership transfer", async () => {
		const artifact = success(encodeCsv(REQUIRED_HEADERS, [stationRow()]));
		artifact.stationMillimeters[0] = 1600;
		const sourceColumn = artifact.stationMillimeters;

		await expect(
			hydrateOpenFabStationProposalArtifactCooperatively(artifact, {
				async checkpoint() {
					await Promise.resolve();
				},
			}),
		).rejects.toThrow("SEMANTIC_FINGERPRINT_MISMATCH");
		expect(sourceColumn.byteLength).toBe(0);
	});
});

function stationRow(overrides: Readonly<Record<string, string>> = {}): CsvRow {
	return {
		identity_scope: "synthetic-scope",
		port_key: "PORT-A",
		secondary_aliases: "",
		attachment_scope: "rail-scope",
		attachment_alias: "RAIL-A",
		station_mm: "1500",
		side: "LEFT",
		lateral_offset_mm: "700",
		direction: "WITH_TRAVEL",
		direction_evidence: "DECLARED",
		port_type: "EQ",
		physical_group_key: "",
		physical_group_kind: "",
		organization_alias: "",
		source_x_mm: "",
		source_z_mm: "",
		...overrides,
	};
}

function encodeCsv(
	headers: readonly string[],
	rows: readonly CsvRow[],
	options: { readonly bom?: boolean; readonly prefix?: string; readonly newline?: string } = {},
): Uint8Array {
	const newline = options.newline ?? "\n";
	const text = `${options.prefix ?? ""}${headers.map(csvCell).join(",")}${newline}${rows
		.map((row) => rowCells(headers, row).map(csvCell).join(","))
		.join(newline)}${rows.length > 0 ? newline : ""}`;
	const encoded = new TextEncoder().encode(text);
	if (!options.bom) return encoded;
	const withBom = new Uint8Array(encoded.length + 3);
	withBom.set([0xef, 0xbb, 0xbf]);
	withBom.set(encoded, 3);
	return withBom;
}

function rowCells(headers: readonly string[], row: CsvRow): string[] {
	return headers.map((header) => row[header] ?? "");
}

function recordPayloadBytes(cells: readonly string[]): number {
	return cells.reduce((total, cell) => total + new TextEncoder().encode(cell).length, 0);
}

function csvCell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function success(source: Uint8Array): OpenFabStationProposalArtifact {
	const result = parseOpenFabStationProposalCsv(source);
	expect(result.ok, result.ok ? undefined : result.failure.code).toBe(true);
	if (!result.ok) throw new Error(result.failure.code);
	return result.artifact;
}

function rejectedResult(source: Uint8Array) {
	const result = parseOpenFabStationProposalCsv(source);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error("expected rejection");
	return result;
}

function failureCode(
	source: Uint8Array,
	options: Parameters<typeof parseOpenFabStationProposalCsv>[1] = {},
): OpenFabStationProposalReadFailureCode {
	const result = parseOpenFabStationProposalCsv(source, options);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error("expected rejection");
	return result.failure.code;
}
