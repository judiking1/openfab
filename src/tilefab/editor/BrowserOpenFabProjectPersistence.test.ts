import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import {
	createOpenFabRailAreaBlueprint,
	updateOpenFabProjectBlueprint,
} from "../project/OpenFabBlueprintLibrary";
import { OPENFAB_PROJECT_MAX_JSON_CHARACTERS } from "../project/OpenFabProjectCodec";
import type { OpenFabRecoveryProjectSummary } from "../project/OpenFabProjectPorts";
import {
	createOpenFabUserBlueprintRecord,
	OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION,
	OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES,
	OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
	OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS,
	OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
	type OpenFabUserBlueprintLibraryChangePort,
	type OpenFabUserBlueprintMutationDurability,
	type OpenFabUserBlueprintRecord,
	type OpenFabUserBlueprintRejectedDiagnostic,
	openFabUserBlueprintRecordJsonByteLength,
	parseOpenFabUserBlueprintRecord,
	serializeOpenFabUserBlueprintRecord,
	updateOpenFabUserBlueprintRecord,
} from "../project/OpenFabUserBlueprintLibrary";
import {
	OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION,
	OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES,
} from "../project/OpenFabUserBlueprintLibraryBundle";
import {
	BrowserOpenFabProjectPersistence,
	type BrowserProjectDatabaseConflictPredicate,
	type BrowserProjectDatabaseInsertStatus,
	type BrowserProjectDatabasePort,
	type BrowserProjectDatabaseReplaceStatus,
	type BrowserProjectDatabaseStoreKey,
	type BrowserProjectDatabaseStoreValue,
} from "./BrowserOpenFabProjectPersistence";

describe("BrowserOpenFabProjectPersistence", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("writes, remembers, reopens, and rewrites a File System Access handle", async () => {
		const database = new MemoryProjectDatabase();
		const file = createFileHandle("Main Bay.openfab");
		vi.stubGlobal("window", {
			showSaveFilePicker: vi.fn(async () => file.handle),
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);

		const reference = await persistence.chooseSave("Main Bay", '{"revision":1}');

		expect(reference).toMatchObject({
			name: "Main Bay.openfab",
			writable: true,
			reopenable: true,
		});
		if (!reference) throw new Error("expected a saved file reference");
		expect(file.content()).toBe('{"revision":1}');
		expect(await persistence.write(reference, '{"revision":2}')).toBe(true);
		expect(file.content()).toBe('{"revision":2}');
		expect(await persistence.openRecent(reference)).toMatchObject({
			reference,
			json: '{"revision":2}',
		});
		await persistence.putRecent({
			projectId: "project-main-bay",
			name: "Main Bay",
			updatedAt: "2026-07-18T00:00:00.000Z",
			authoredChecksum: "checksum-main-bay",
			reference,
		});
		await persistence.putRecent({
			projectId: "project-main-bay",
			name: "Main Bay",
			updatedAt: "2026-07-18T00:01:00.000Z",
			authoredChecksum: "checksum-main-bay",
			reference: null,
		});
		expect(await persistence.openRecent(reference)).toBeNull();
	});

	it("keeps an already-written handle usable when IndexedDB cannot store it", async () => {
		const database = new MemoryProjectDatabase({ rejectHandleWrites: true });
		const file = createFileHandle("Fallback.openfab");
		vi.stubGlobal("window", {
			showSaveFilePicker: vi.fn(async () => file.handle),
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);

		const reference = await persistence.chooseSave("Fallback", "first");

		expect(reference).toMatchObject({ writable: true, reopenable: false });
		if (!reference) throw new Error("expected a fallback file reference");
		expect(await persistence.write(reference, "second")).toBe(true);
		expect(file.content()).toBe("second");
	});

	it("sorts and caps recents while listing recovery summaries without reading payloads", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		for (let index = 0; index < 14; index++) {
			await persistence.putRecent({
				projectId: `project-${index}`,
				name: `Project ${index}`,
				updatedAt: `2026-07-18T00:00:${String(index).padStart(2, "0")}.000Z`,
				authoredChecksum: `checksum-${index}`,
				reference: null,
			});
			await persistence.putRecovery({
				projectId: `recovery-${index}`,
				name: `Recovered FAB ${index}`,
				updatedAt: `2026-07-18T01:00:${String(index).padStart(2, "0")}.000Z`,
				authoredChecksum: `recovery-checksum-${index}`,
				json: `{"payload":${index}}`,
			});
		}

		const recents = await persistence.listRecent();
		expect(recents).toHaveLength(12);
		expect(recents[0]?.projectId).toBe("project-13");
		expect(recents.at(-1)?.projectId).toBe("project-2");
		const recovery = await persistence.listRecovery();
		expect(recovery).toMatchObject({
			totalCount: 14,
			offset: 0,
			pageSize: 12,
			truncated: true,
		});
		expect(recovery.latest?.projectId).toBe("recovery-13");
		expect(recovery.records).toHaveLength(12);
		expect(recovery.records[0]?.projectId).toBe("recovery-13");
		expect(recovery.records.at(-1)?.projectId).toBe("recovery-2");
		expect(recovery.records[0]).not.toHaveProperty("json");
		expect(database.getAllStoreNames).toContain("recovery-project-summaries");
		expect(database.getAllStoreNames).not.toContain("recovery-projects");
		expect(await persistence.loadRecoverySummary("recovery-7")).toEqual({
			projectId: "recovery-7",
			name: "Recovered FAB 7",
			updatedAt: "2026-07-18T01:00:07.000Z",
			authoredChecksum: "recovery-checksum-7",
			jsonCharacters: '{"payload":7}'.length,
		});
		expect(await persistence.loadRecovery("recovery-7")).toMatchObject({
			projectId: "recovery-7",
			json: '{"payload":7}',
		});
		const olderRecovery = await persistence.listRecovery({ offset: 12 });
		expect(olderRecovery).toMatchObject({
			totalCount: 14,
			offset: 12,
			pageSize: 12,
			truncated: true,
		});
		expect(olderRecovery.latest?.projectId).toBe("recovery-13");
		expect(olderRecovery.records.map(({ projectId }) => projectId)).toEqual([
			"recovery-1",
			"recovery-0",
		]);
		await expect(persistence.listRecovery({ offset: -1 })).rejects.toThrow("offset");
		await persistence.removeRecovery("recovery-13");
		expect(await persistence.loadRecovery("recovery-13")).toBeNull();
		expect(await persistence.listRecovery()).toMatchObject({ totalCount: 13, truncated: true });
	});

	it("migrates v3 recovery payloads into the lightweight summary inventory", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const legacy = await openLegacyRecoveryDatabase(factory, {
			projectId: "legacy-recovery",
			name: "Legacy Recovery",
			updatedAt: "2026-07-18T01:00:00.000Z",
			authoredChecksum: "legacy-checksum",
			json: '{"legacy":true}',
		});
		legacy.close();
		const persistence = new BrowserOpenFabProjectPersistence();

		expect(await persistence.listRecovery()).toEqual({
			latest: {
				projectId: "legacy-recovery",
				name: "Legacy Recovery",
				updatedAt: "2026-07-18T01:00:00.000Z",
				authoredChecksum: "legacy-checksum",
				jsonCharacters: '{"legacy":true}'.length,
			},
			records: [
				{
					projectId: "legacy-recovery",
					name: "Legacy Recovery",
					updatedAt: "2026-07-18T01:00:00.000Z",
					authoredChecksum: "legacy-checksum",
					jsonCharacters: '{"legacy":true}'.length,
				},
			],
			totalCount: 1,
			offset: 0,
			pageSize: 12,
			truncated: false,
		});
		expect(await persistence.loadRecovery("legacy-recovery")).toMatchObject({
			json: '{"legacy":true}',
		});
	});

	it("previews and atomically removes only cleanup candidates", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		for (let index = 0; index < 6; index++) {
			await persistence.putRecovery({
				projectId: `cleanup-${index}`,
				name: `Cleanup ${index}`,
				updatedAt: `2026-07-18T01:00:0${index}.000Z`,
				authoredChecksum: `cleanup-checksum-${index}`,
				json: `{"payload":"${"x".repeat(index + 1)}"}`,
			});
		}

		const plan = await persistence.prepareRecoveryCleanup({
			retainedProjectCount: 2,
			protectedProjectIds: ["cleanup-1"],
		});

		expect(plan).toMatchObject({ totalCount: 6, retainedCount: 3, removableCount: 3 });
		expect(plan.candidates.map(({ projectId }) => projectId)).toEqual([
			"cleanup-3",
			"cleanup-2",
			"cleanup-0",
		]);
		expect(await persistence.applyRecoveryCleanup(plan)).toEqual({
			status: "removed",
			removedCount: 3,
		});
		expect((await persistence.listRecovery()).records.map(({ projectId }) => projectId)).toEqual([
			"cleanup-5",
			"cleanup-4",
			"cleanup-1",
		]);
		expect(await persistence.loadRecovery("cleanup-3")).toBeNull();
	});

	it("leaves every cleanup candidate intact when its preview becomes stale", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		for (let index = 0; index < 4; index++) {
			await persistence.putRecovery({
				projectId: `stale-${index}`,
				name: `Stale ${index}`,
				updatedAt: `2026-07-18T01:00:0${index}.000Z`,
				authoredChecksum: `stale-checksum-${index}`,
				json: `{"payload":${index}}`,
			});
		}
		const plan = await persistence.prepareRecoveryCleanup({ retainedProjectCount: 1 });
		await persistence.putRecovery({
			projectId: "stale-1",
			name: "Stale 1 changed",
			updatedAt: "2026-07-18T02:00:00.000Z",
			authoredChecksum: "stale-checksum-changed",
			json: '{"payload":"changed"}',
		});

		expect(await persistence.applyRecoveryCleanup(plan)).toEqual({
			status: "conflict",
			removedCount: 0,
		});
		expect((await persistence.listRecovery()).totalCount).toBe(4);
		for (let index = 0; index < 4; index++) {
			expect(await persistence.loadRecovery(`stale-${index}`)).not.toBeNull();
		}
	});

	it("atomically aborts when a cleanup candidate changes after the final replan", async () => {
		let replacement: OpenFabRecoveryProjectSummary | null = null;
		const database: MemoryProjectDatabase = new MemoryProjectDatabase({
			beforeRecoveryCleanup: () => {
				if (replacement) database.overwriteRecoverySummaryForTest(replacement);
			},
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);
		for (let index = 0; index < 3; index++) {
			await persistence.putRecovery({
				projectId: `atomic-${index}`,
				name: `Atomic ${index}`,
				updatedAt: `2026-07-18T01:00:0${index}.000Z`,
				authoredChecksum: `atomic-checksum-${index}`,
				json: `{"payload":${index}}`,
			});
		}
		const plan = await persistence.prepareRecoveryCleanup({ retainedProjectCount: 1 });
		const firstCandidate = plan.candidates[0];
		if (!firstCandidate) throw new Error("expected an atomic cleanup candidate");
		replacement = Object.freeze({ ...firstCandidate, name: "Changed during cleanup" });

		expect(await persistence.applyRecoveryCleanup(plan)).toEqual({
			status: "conflict",
			removedCount: 0,
		});
		expect((await persistence.listRecovery()).totalCount).toBe(3);
		for (let index = 0; index < 3; index++) {
			expect(await persistence.loadRecovery(`atomic-${index}`)).not.toBeNull();
		}
	});

	it("rolls back a recovery payload when its summary cannot commit", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const constrained = await openConstrainedRecoveryDatabase(factory);
		constrained.close();
		const persistence = new BrowserOpenFabProjectPersistence();

		await expect(
			persistence.putRecovery({
				projectId: "conflicting-recovery",
				name: "Duplicate Recovery",
				updatedAt: "2026-07-18T02:00:00.000Z",
				authoredChecksum: "conflicting-checksum",
				json: '{"must":"rollback"}',
			}),
		).rejects.toMatchObject({ name: "ConstraintError" });
		expect(await persistence.loadRecovery("conflicting-recovery")).toBeNull();
		expect(await persistence.listRecovery()).toMatchObject({ totalCount: 1 });
	});

	it("rejects oversized files before reading their text", async () => {
		const text = vi.fn(async () => "should not be read");
		const handle = {
			kind: "file",
			name: "oversized.openfab",
			getFile: async () => ({
				size: OPENFAB_PROJECT_MAX_JSON_CHARACTERS + 1,
				text,
			}),
			createWritable: async () => createWritable(() => undefined),
		};
		vi.stubGlobal("window", {
			showOpenFilePicker: vi.fn(async () => [handle]),
		});
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());

		await expect(persistence.chooseOpen()).rejects.toThrow("128 MiB");
		expect(text).not.toHaveBeenCalled();
	});

	it("uses the UTF-8 byte budget for portable blueprint import and export", async () => {
		const text = vi.fn(async () => "should not be read");
		const handle = {
			kind: "file",
			name: "oversized.openfabbp",
			getFile: async () => ({
				size: OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES + 1,
				text,
			}),
			createWritable: async () => createWritable(() => undefined),
		};
		vi.stubGlobal("window", {
			showOpenFilePicker: vi.fn(async () => [handle]),
		});
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());

		await expect(persistence.chooseImport()).rejects.toThrow("16 MiB");
		expect(text).not.toHaveBeenCalled();
		await expect(
			persistence.chooseExport(
				"unicode-heavy",
				"가".repeat(Math.floor(OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES / 3) + 1),
			),
		).rejects.toThrow("16 MiB");
	});

	it("keeps whole-library backup files distinct and rejects oversized input before reading", async () => {
		const text = vi.fn(async () => "should not be read");
		const oversizedHandle = {
			kind: "file",
			name: `oversized${OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION}`,
			getFile: async () => ({
				size: OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES + 1,
				text,
			}),
			createWritable: async () => createWritable(() => undefined),
		};
		vi.stubGlobal("window", {
			showOpenFilePicker: vi.fn(async () => [oversizedHandle]),
		});
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());

		await expect(persistence.chooseLibraryImport()).rejects.toThrow("128 MiB");
		expect(text).not.toHaveBeenCalled();

		const output = createFileHandle("ignored");
		const savePicker = vi.fn(async () => output.handle);
		vi.stubGlobal("window", { showSaveFilePicker: savePicker });
		await expect(
			persistence.chooseLibraryExport("Production Library", '{"records":[]}'),
		).resolves.toBe(true);
		expect(savePicker).toHaveBeenCalledWith(
			expect.objectContaining({
				suggestedName: `Production Library${OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION}`,
			}),
		);
		expect(output.content()).toBe('{"records":[]}');
	});

	it("can force the portable fallback without invoking native pickers", async () => {
		const nativeSavePicker = vi.fn();
		vi.stubGlobal("window", { showSaveFilePicker: nativeSavePicker });
		vi.stubGlobal("document", {
			body: { append: vi.fn() },
			createElement: () => ({
				href: "",
				download: "",
				click: vi.fn(),
				remove: vi.fn(),
			}),
		});
		vi.stubGlobal("URL", {
			createObjectURL: () => "blob:openfab-test",
			revokeObjectURL: vi.fn(),
		});
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase(), {
			forceFileInputFallback: true,
		});

		const reference = await persistence.chooseSave("Portable FAB", "{}");

		expect(nativeSavePicker).not.toHaveBeenCalled();
		expect(reference).toMatchObject({
			name: "Portable FAB.openfab",
			writable: false,
			reopenable: false,
		});
	});

	it("treats native save chooser AbortError as a cancellation without retaining a file handle", async () => {
		const savePicker = vi.fn(async () => {
			throw new DOMException("user cancelled", "AbortError");
		});
		vi.stubGlobal("window", { showSaveFilePicker: savePicker });
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());

		await expect(persistence.chooseSave("Cancelled FAB", '{"revision":1}')).resolves.toBeNull();
		expect(savePicker).toHaveBeenCalledOnce();
		await expect(persistence.listRecent()).resolves.toEqual([]);
	});

	it("persists, sorts, defensively reads, and removes cross-project user blueprints", async () => {
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());
		const second = userBlueprint("library-second", "Second Bay", 2);
		const first = userBlueprint("library-first", "First Bay", 1);

		expect(await insertUserBlueprint(persistence, second)).toBe("persistent");
		expect(await insertUserBlueprint(persistence, first)).toBe("persistent");

		const listed = await persistence.list();
		expect(listed.map(({ id }) => id)).toEqual(["library-first", "library-second"]);
		expect(await persistence.get("library-first")).toEqual(first);
		expect(await persistence.get("library-first")).not.toBe(first);
		expect(await removeUserBlueprint(persistence, first)).toBe("persistent");
		expect(await persistence.get("library-first")).toBeNull();
	});

	it("inserts new records without overwriting an existing envelope id", async () => {
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());
		const existing = userBlueprint("library-shared", "Existing Bay", null);
		const incoming = userBlueprint("library-shared", "Incoming Bay", null);
		await insertUserBlueprint(persistence, existing);

		await expect(persistence.insert(incoming)).resolves.toEqual({
			status: "id-conflict",
			durability: "persistent",
		});
		expect(await persistence.get(existing.id)).toEqual(existing);
	});

	it("rejects occupied quick slots before replacing a different record", async () => {
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());
		await insertUserBlueprint(persistence, userBlueprint("library-first", "First Bay", 1));

		await expect(
			insertUserBlueprint(persistence, userBlueprint("library-second", "Second Bay", 1)),
		).rejects.toThrow("Quick slot 1 is already assigned");
		expect((await persistence.list()).map(({ id }) => id)).toEqual(["library-first"]);
	});

	it("keeps every valid record visible when legacy quick slots collide", async () => {
		const database = new MemoryProjectDatabase();
		await database.put("user-blueprints", userBlueprint("library-first", "First Bay", 1));
		await database.put("user-blueprints", userBlueprint("library-second", "Second Bay", 1));
		const persistence = new BrowserOpenFabProjectPersistence(database);

		const listed = await persistence.list();

		expect(listed.map(({ id }) => id)).toEqual(["library-first", "library-second"]);
		expect(listed.map(({ quickSlot }) => quickSlot)).toEqual([1, null]);
	});

	it("isolates corrupt IndexedDB rows without blocking valid library records", async () => {
		const database = new MemoryProjectDatabase();
		const corrupt = { id: "corrupt", schemaVersion: 99, note: ["preserve", 7, true] };
		await database.put("user-blueprints", corrupt);
		const persistence = new BrowserOpenFabProjectPersistence(database);
		await expect(
			insertUserBlueprint(persistence, userBlueprint("library-valid", "Valid Bay", null)),
		).resolves.toBe("persistent");

		expect((await persistence.list()).map(({ id }) => id)).toEqual(["library-valid"]);
		expect(persistence.getStatus()).toMatchObject({ rejectedRecordCount: 1 });
		expect(persistence.getStatus()).toMatchObject({
			rejectedRecordCountIsLowerBound: false,
			diagnosticsTruncated: false,
			durability: "persistent",
		});
		const diagnostics = persistence.getRejectedDiagnostics();
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			ordinal: 1,
			code: "INVALID_FIELD",
			path: "$.note",
		});
		expect(await persistence.readRejectedDiagnostic(diagnostics[0]?.token ?? "missing")).toEqual({
			diagnostic: diagnostics[0],
			json: `${JSON.stringify(corrupt, null, "\t")}\n`,
			byteLength: new TextEncoder().encode(`${JSON.stringify(corrupt, null, "\t")}\n`).byteLength,
			recoverableRecord: null,
		});
		expect(await persistence.get("corrupt")).toBeNull();
	});

	it("backs up and conditionally removes a valid legacy over-limit record", async () => {
		const database = new MemoryProjectDatabase();
		const stored = userBlueprint("legacy-over-limit", "Legacy Over Limit", null);
		await database.put("user-blueprints", stored);
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const token = "rejected-legacy-over-limit";
		const diagnostic: OpenFabUserBlueprintRejectedDiagnostic = Object.freeze({
			token,
			ordinal: 1,
			code: "LIMIT_EXCEEDED",
			path: "$.records",
			message: "legacy aggregate capacity exceeded",
		});
		const state = persistence as unknown as {
			rejectedUserBlueprintDiagnostics: readonly OpenFabUserBlueprintRejectedDiagnostic[];
			rejectedUserBlueprintKeys: Map<string, IDBValidKey>;
			rejectedUserBlueprintExpectedRecords: Map<string, OpenFabUserBlueprintRecord>;
		};
		state.rejectedUserBlueprintDiagnostics = Object.freeze([diagnostic]);
		state.rejectedUserBlueprintKeys = new Map([[token, stored.id]]);
		state.rejectedUserBlueprintExpectedRecords = new Map([[token, stored]]);

		await expect(persistence.readRejectedDiagnostic(token)).resolves.toEqual({
			diagnostic,
			json: serializeOpenFabUserBlueprintRecord(stored),
			byteLength: openFabUserBlueprintRecordJsonByteLength(stored),
			recoverableRecord: stored,
		});
		await expect(persistence.removeRejectedDiagnostic(token, stored)).resolves.toEqual({
			status: "removed",
		});
		expect(await database.get("user-blueprints", stored.id)).toBeNull();
		expect(persistence.getRejectedDiagnostics()).toEqual([]);
	});

	it("never deletes a legacy row that changed after its recovery export", async () => {
		const database = new MemoryProjectDatabase();
		const exported = userBlueprint("legacy-race", "Exported revision", null);
		const changed = updateOpenFabUserBlueprintRecord(exported, {
			quickSlot: 4,
			updatedAt: "2026-08-03T01:00:00.000Z",
		});
		await database.put("user-blueprints", exported);
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const token = "rejected-legacy-race";
		const diagnostic: OpenFabUserBlueprintRejectedDiagnostic = Object.freeze({
			token,
			ordinal: 1,
			code: "LIMIT_EXCEEDED",
			path: "$.records",
			message: "legacy aggregate capacity exceeded",
		});
		const state = persistence as unknown as {
			rejectedUserBlueprintDiagnostics: readonly OpenFabUserBlueprintRejectedDiagnostic[];
			rejectedUserBlueprintKeys: Map<string, IDBValidKey>;
			rejectedUserBlueprintExpectedRecords: Map<string, OpenFabUserBlueprintRecord>;
		};
		state.rejectedUserBlueprintDiagnostics = Object.freeze([diagnostic]);
		state.rejectedUserBlueprintKeys = new Map([[token, exported.id]]);
		state.rejectedUserBlueprintExpectedRecords = new Map([[token, exported]]);

		await database.put("user-blueprints", changed);

		await expect(persistence.removeRejectedDiagnostic(token, exported)).resolves.toEqual({
			status: "conflict",
		});
		expect(await database.get("user-blueprints", changed.id)).toEqual(changed);
	});

	it("reports a committed quarantine removal even if cancellation arrives after deletion", async () => {
		const controller = new AbortController();
		const database = new MemoryProjectDatabase({
			afterUserBlueprintDelete: () => controller.abort(),
		});
		const stored = userBlueprint("legacy-post-commit", "Legacy Post Commit", null);
		await database.put("user-blueprints", stored);
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const token = "rejected-legacy-post-commit";
		const diagnostic: OpenFabUserBlueprintRejectedDiagnostic = Object.freeze({
			token,
			ordinal: 1,
			code: "LIMIT_EXCEEDED",
			path: "$.records",
			message: "legacy aggregate capacity exceeded",
		});
		const state = persistence as unknown as {
			rejectedUserBlueprintDiagnostics: readonly OpenFabUserBlueprintRejectedDiagnostic[];
			rejectedUserBlueprintKeys: Map<string, IDBValidKey>;
			rejectedUserBlueprintExpectedRecords: Map<string, OpenFabUserBlueprintRecord>;
		};
		state.rejectedUserBlueprintDiagnostics = Object.freeze([diagnostic]);
		state.rejectedUserBlueprintKeys = new Map([[token, stored.id]]);
		state.rejectedUserBlueprintExpectedRecords = new Map([[token, stored]]);

		await expect(
			persistence.removeRejectedDiagnostic(token, stored, controller.signal),
		).resolves.toEqual({ status: "removed" });
		expect(controller.signal.aborted).toBe(true);
		expect(await database.get("user-blueprints", stored.id)).toBeNull();
	});

	it("bounds corrupt-row metadata while counting every scanned rejection", async () => {
		const database = new MemoryProjectDatabase();
		for (let index = 0; index < OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS + 4; index += 1) {
			await database.put("user-blueprints", { id: `corrupt-${index}`, schemaVersion: 99 });
		}
		const persistence = new BrowserOpenFabProjectPersistence(database);

		expect(await persistence.list()).toEqual([]);
		expect(persistence.getStatus().rejectedRecordCount).toBe(
			OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS + 4,
		);
		expect(persistence.getRejectedDiagnostics()).toHaveLength(
			OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS,
		);
		expect(persistence.getStatus()).toMatchObject({
			rejectedRecordCountIsLowerBound: false,
			diagnosticsTruncated: true,
		});
		expect(persistence.getRejectedDiagnostics().map(({ ordinal }) => ordinal)).toEqual(
			Array.from(
				{ length: OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS },
				(_, index) => index + 1,
			),
		);
	});

	it("prioritizes recoverable overflow rows even when malformed diagnostics are full", async () => {
		const database = new MemoryProjectDatabase();
		for (let index = 0; index < OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS; index += 1) {
			await database.put("user-blueprints", {
				id: `malformed-before-overflow-${index}`,
				schemaVersion: 99,
			});
		}
		for (let index = 0; index <= OPENFAB_USER_BLUEPRINT_MAX_RECORDS; index += 1) {
			await database.put(
				"user-blueprints",
				userBlueprint(`legacy-capacity-${index}`, `Legacy Capacity ${index}`, null),
			);
		}
		const persistence = new BrowserOpenFabProjectPersistence(database);

		expect(await persistence.list()).toHaveLength(OPENFAB_USER_BLUEPRINT_MAX_RECORDS);
		const diagnostics = persistence.getRejectedDiagnostics();
		expect(diagnostics).toHaveLength(OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS);
		expect(diagnostics[0]?.code).toBe("LIMIT_EXCEEDED");
		const recoverable = await persistence.readRejectedDiagnostic(
			diagnostics[0]?.token ?? "missing",
		);
		expect(recoverable?.recoverableRecord?.id).toBe(
			`legacy-capacity-${OPENFAB_USER_BLUEPRINT_MAX_RECORDS}`,
		);
	});

	it("marks rejection counts as lower bounds when the physical store scan is truncated", async () => {
		const database = new MemoryProjectDatabase();
		const scanLimit =
			OPENFAB_USER_BLUEPRINT_MAX_RECORDS + OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS * 2;
		for (let index = 0; index <= scanLimit; index += 1) {
			await database.put("user-blueprints", { id: `overflow-corrupt-${index}`, schemaVersion: 99 });
		}
		const persistence = new BrowserOpenFabProjectPersistence(database);

		await persistence.list();

		expect(persistence.getStatus()).toMatchObject({
			rejectedRecordCount: scanLimit,
			rejectedRecordCountIsLowerBound: true,
			diagnosticsTruncated: true,
			overflowDetected: true,
		});
	});

	it("invalidates a corrupt-row diagnostic token when the stored row becomes valid", async () => {
		const database = new MemoryProjectDatabase();
		await database.put("user-blueprints", { id: "repaired", schemaVersion: 99 });
		const persistence = new BrowserOpenFabProjectPersistence(database);
		await persistence.list();
		const diagnostic = persistence.getRejectedDiagnostics()[0];
		if (!diagnostic) throw new Error("Expected a quarantined row diagnostic.");

		await database.put("user-blueprints", userBlueprint("repaired", "Repaired", null));

		expect(await persistence.readRejectedDiagnostic(diagnostic.token)).toBeNull();
		expect(persistence.getRejectedDiagnostics()).toEqual([]);
		expect(await persistence.readRejectedDiagnostic(diagnostic.token)).toBeNull();
	});

	it("writes quarantined diagnostics through a visibly non-importable file type", async () => {
		const file = createFileHandle("ignored");
		const savePicker = vi.fn(async () => file.handle);
		vi.stubGlobal("window", { showSaveFilePicker: savePicker });
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());

		await expect(
			persistence.chooseDiagnosticExport("Corrupt Bay", '{\n\t"bad": true\n}\n'),
		).resolves.toBe(true);

		expect(savePicker).toHaveBeenCalledWith(
			expect.objectContaining({
				suggestedName: `Corrupt Bay${OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION}`,
			}),
		);
		expect(file.content()).toBe('{\n\t"bad": true\n}\n');
	});

	it("retains a volatile session copy when IndexedDB is unavailable", async () => {
		const persistence = new BrowserOpenFabProjectPersistence(
			new MemoryProjectDatabase({ rejectUserBlueprintOperations: true }),
		);
		const record = userBlueprint("library-volatile", "Volatile Bay", null);

		expect(await insertUserBlueprint(persistence, record)).toBe("session-only");
		expect(persistence.getStatus().durability).toBe("session-only");

		expect(await persistence.get(record.id)).toEqual(record);
		expect(await persistence.list()).toEqual([record]);
		expect(await removeUserBlueprint(persistence, record)).toBe("session-only");
		expect(await persistence.list()).toEqual([]);
		expect(persistence.getStatus().durability).toBe("session-only");
	});

	it("persists retained session records after IndexedDB becomes available again", async () => {
		const database = new MemoryProjectDatabase({ rejectUserBlueprintOperations: true });
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const record = userBlueprint("library-recovered", "Recovered Bay", null);

		expect(await insertUserBlueprint(persistence, record)).toBe("session-only");
		database.setRejectUserBlueprintOperations(false);

		expect(await persistence.list()).toEqual([record]);
		expect(persistence.getStatus().durability).toBe("persistent");
		expect(await database.get("user-blueprints", record.id)).toEqual(record);
	});

	it("publishes only committed persistent library mutations and later reconciliation", async () => {
		const changes = new RecordingUserBlueprintLibraryChangePort();
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database, {
			userBlueprintLibraryChanges: changes,
		});
		const first = userBlueprint("notified-first", "Notified First", null);
		const second = userBlueprint("notified-second", "Notified Second", null);

		expect(await persistence.insert(first)).toMatchObject({ status: "inserted" });
		expect(changes.publicationCount).toBe(1);
		expect(await persistence.insert(first)).toMatchObject({ status: "id-conflict" });
		expect(changes.publicationCount).toBe(1);

		const renamed = renameUserBlueprint(first, "Notified Rename", "2026-08-26T00:00:00.001Z");
		expect(await persistence.update(first, renamed)).toMatchObject({ status: "updated" });
		expect(changes.publicationCount).toBe(2);
		expect(await persistence.replaceAllIfUnchanged([renamed], [second])).toEqual({
			status: "replaced",
		});
		expect(changes.publicationCount).toBe(3);
		expect(await persistence.remove(second)).toMatchObject({ status: "removed" });
		expect(changes.publicationCount).toBe(4);

		const recoveringChanges = new RecordingUserBlueprintLibraryChangePort();
		const recoveringDatabase = new MemoryProjectDatabase({ rejectUserBlueprintOperations: true });
		const recovering = new BrowserOpenFabProjectPersistence(recoveringDatabase, {
			userBlueprintLibraryChanges: recoveringChanges,
		});
		expect(await recovering.insert(first)).toMatchObject({ durability: "session-only" });
		expect(recoveringChanges.publicationCount).toBe(0);
		recoveringDatabase.setRejectUserBlueprintOperations(false);
		expect(await recovering.list()).toEqual([first]);
		expect(recoveringChanges.publicationCount).toBe(1);
	});

	it("treats a synchronous IndexedDB open exception as unavailable storage", async () => {
		vi.stubGlobal("indexedDB", {
			open: () => {
				throw new DOMException("storage disabled", "SecurityError");
			},
		});
		const persistence = new BrowserOpenFabProjectPersistence();

		expect(await persistence.list()).toEqual([]);
		expect(persistence.getStatus().durability).toBe("session-only");
		await Promise.resolve();
	});

	it("reports an unavailable persistent read instead of presenting an authoritative empty library", async () => {
		const persistence = new BrowserOpenFabProjectPersistence(
			new MemoryProjectDatabase({ rejectUserBlueprintOperations: true }),
		);

		expect(await persistence.list()).toEqual([]);
		expect(persistence.getStatus()).toEqual({
			durability: "session-only",
			rejectedRecordCount: 0,
			rejectedRecordCountIsLowerBound: false,
			diagnosticsTruncated: false,
			overflowDetected: false,
		});
	});

	it("honors cancellation before user-library mutation", async () => {
		const persistence = new BrowserOpenFabProjectPersistence(new MemoryProjectDatabase());
		const controller = new AbortController();
		controller.abort();

		await expect(
			insertUserBlueprint(
				persistence,
				userBlueprint("library-aborted", "Aborted Bay", null),
				controller.signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(await persistence.list()).toEqual([]);
	});

	it("does not report AbortError after a submitted mutation commits", async () => {
		const putController = new AbortController();
		const removeController = new AbortController();
		let armRemoveAbort = false;
		const database = new MemoryProjectDatabase({
			afterUserBlueprintPut: () => putController.abort(),
			afterUserBlueprintDelete: () => {
				if (armRemoveAbort) removeController.abort();
			},
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const record = userBlueprint("library-committed", "Committed Bay", null);

		await expect(insertUserBlueprint(persistence, record, putController.signal)).resolves.toBe(
			"persistent",
		);
		armRemoveAbort = true;
		await expect(removeUserBlueprint(persistence, record, removeController.signal)).resolves.toBe(
			"persistent",
		);
		expect(await persistence.get(record.id)).toBeNull();
	});

	it("upgrades v2 rows, repairs slot collisions, and atomically rejects a concurrent slot claim", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const legacy = await openLegacyUserBlueprintDatabase(factory);
		await putIndexedDbRecords(legacy, [
			userBlueprint("legacy-first", "Legacy First", 1),
			userBlueprint("legacy-second", "Legacy Second", 1),
		]);
		legacy.close();
		const persistence = new BrowserOpenFabProjectPersistence();

		const migrated = await persistence.list();

		expect(migrated.map(({ id }) => id)).toEqual(["legacy-first", "legacy-second"]);
		expect(migrated.map(({ quickSlot }) => quickSlot)).toEqual([1, null]);
		const claims = await Promise.allSettled([
			insertUserBlueprint(persistence, userBlueprint("claim-a", "Claim A", 2)),
			insertUserBlueprint(persistence, userBlueprint("claim-b", "Claim B", 2)),
		]);
		expect(claims.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
		expect(claims.filter(({ status }) => status === "rejected")).toHaveLength(1);
		expect((await persistence.list()).filter(({ quickSlot }) => quickSlot === 2)).toHaveLength(1);
	});

	it("atomically resolves concurrent inserts of the same envelope id without last-writer overwrite", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const firstWriter = new BrowserOpenFabProjectPersistence();
		const secondWriter = new BrowserOpenFabProjectPersistence();
		const first = userBlueprint("shared-import", "First Import", null);
		const second = userBlueprint("shared-import", "Second Import", null);

		const results = await Promise.all([firstWriter.insert(first), secondWriter.insert(second)]);

		expect(results.filter(({ status }) => status === "inserted")).toHaveLength(1);
		expect(results.filter(({ status }) => status === "id-conflict")).toHaveLength(1);
		const stored = await firstWriter.get("shared-import");
		expect([first.blueprint.name, second.blueprint.name]).toContain(stored?.blueprint.name);
		expect(await secondWriter.get("shared-import")).toEqual(stored);
	});

	it("atomically rejects concurrent folder and name duplicates across IndexedDB writers", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const firstWriter = new BrowserOpenFabProjectPersistence();
		const secondWriter = new BrowserOpenFabProjectPersistence();

		const results = await Promise.all([
			firstWriter.insert(userBlueprint("name-import-a", "Photo Bay", null)),
			secondWriter.insert(userBlueprint("name-import-b", "PHOTO BAY", null)),
		]);

		expect(results.filter(({ status }) => status === "inserted")).toHaveLength(1);
		expect(results.filter(({ status }) => status === "name-conflict")).toHaveLength(1);
		expect(await firstWriter.list()).toHaveLength(1);
	});

	it("reports an atomic quick-slot conflict between concurrent inserts", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const firstWriter = new BrowserOpenFabProjectPersistence();
		const secondWriter = new BrowserOpenFabProjectPersistence();

		const results = await Promise.all([
			firstWriter.insert(userBlueprint("slot-import-a", "Slot Import A", 4)),
			secondWriter.insert(userBlueprint("slot-import-b", "Slot Import B", 4)),
		]);

		expect(results.filter(({ status }) => status === "inserted")).toHaveLength(1);
		expect(results.filter(({ status }) => status === "quick-slot-conflict")).toHaveLength(1);
		expect((await firstWriter.list()).filter(({ quickSlot }) => quickSlot === 4)).toHaveLength(1);
	});

	it("reports an atomic quick-slot conflict during a conditional metadata update", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const persistence = new BrowserOpenFabProjectPersistence();
		const occupied = userBlueprint("slot-owner", "Slot Owner", 5);
		const candidate = userBlueprint("slot-candidate", "Slot Candidate", null);
		await insertUserBlueprint(persistence, occupied);
		await insertUserBlueprint(persistence, candidate);
		const updated = updateOpenFabUserBlueprintRecord(candidate, {
			quickSlot: 5,
			updatedAt: "2026-08-02T00:00:00.001Z",
		});

		await expect(persistence.update(candidate, updated)).resolves.toEqual({
			status: "quick-slot-conflict",
			durability: "persistent",
		});
		expect((await persistence.get(candidate.id))?.quickSlot).toBeNull();
	});

	it("atomically rejects concurrent metadata updates to the same folder and name", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const firstWriter = new BrowserOpenFabProjectPersistence();
		const secondWriter = new BrowserOpenFabProjectPersistence();
		const first = userBlueprint("rename-a", "Etch Bay", null);
		const second = userBlueprint("rename-b", "CMP Bay", null);
		await insertUserBlueprint(firstWriter, first);
		await insertUserBlueprint(firstWriter, second);
		const firstExpected = await firstWriter.get(first.id);
		const secondExpected = await secondWriter.get(second.id);
		if (!firstExpected || !secondExpected) throw new Error("expected shared records");

		const results = await Promise.all([
			firstWriter.update(
				firstExpected,
				renameUserBlueprint(firstExpected, "Shared Bay", "2026-08-02T00:00:00.001Z"),
			),
			secondWriter.update(
				secondExpected,
				renameUserBlueprint(secondExpected, "SHARED BAY", "2026-08-02T00:00:00.002Z"),
			),
		]);

		expect(results.filter(({ status }) => status === "updated")).toHaveLength(1);
		expect(results.filter(({ status }) => status === "name-conflict")).toHaveLength(1);
	});

	it("rejects stale cross-tab updates and deletions without overwriting the newer record", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const firstWriter = new BrowserOpenFabProjectPersistence();
		const secondWriter = new BrowserOpenFabProjectPersistence();
		const original = userBlueprint("shared-edit", "Original", null);
		await insertUserBlueprint(firstWriter, original);
		const firstExpected = await firstWriter.get(original.id);
		const secondExpected = await secondWriter.get(original.id);
		if (!firstExpected || !secondExpected) throw new Error("expected shared records");

		const firstUpdate = renameUserBlueprint(
			firstExpected,
			"First Writer",
			"2026-08-02T00:00:00.001Z",
		);
		const staleUpdate = renameUserBlueprint(
			secondExpected,
			"Stale Writer",
			"2026-08-02T00:00:00.002Z",
		);

		await expect(firstWriter.update(firstExpected, firstUpdate)).resolves.toEqual({
			status: "updated",
			durability: "persistent",
		});
		await expect(secondWriter.update(secondExpected, staleUpdate)).resolves.toEqual({
			status: "conflict",
			durability: "persistent",
		});
		await expect(secondWriter.remove(secondExpected)).resolves.toEqual({
			status: "conflict",
			durability: "persistent",
		});
		expect((await firstWriter.get(original.id))?.blueprint.name).toBe("First Writer");
	});

	it("rekeys a session-only insert if its id is claimed before IndexedDB reconnects", async () => {
		const database = new MemoryProjectDatabase({ rejectUserBlueprintOperations: true });
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const local = userBlueprint("reconnect-collision", "Session Copy", null);
		await expect(insertUserBlueprint(persistence, local)).resolves.toBe("session-only");

		database.setRejectUserBlueprintOperations(false);
		await database.put(
			"user-blueprints",
			userBlueprint("reconnect-collision", "Persistent Copy", null),
		);
		const reconciled = await persistence.list();

		expect(reconciled.map(({ blueprint }) => blueprint.name).sort()).toEqual([
			"Persistent Copy",
			"Session Copy",
		]);
		expect(new Set(reconciled.map(({ id }) => id)).size).toBe(2);
		expect(persistence.getStatus().durability).toBe("persistent");
	});

	it("renames and persists a session-only insert if its folder and name are claimed before reconnect", async () => {
		const database = new MemoryProjectDatabase({ rejectUserBlueprintOperations: true });
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const local = userBlueprint("offline-name", "Photo Bay", null);
		await expect(insertUserBlueprint(persistence, local)).resolves.toBe("session-only");

		database.setRejectUserBlueprintOperations(false);
		await database.put("user-blueprints", userBlueprint("remote-name", "PHOTO BAY", null));
		const reconciled = await persistence.list();

		expect(reconciled.map(({ blueprint }) => blueprint.name).sort()).toEqual([
			"PHOTO BAY",
			"Photo Bay (Recovered)",
		]);
		expect(persistence.getStatus().durability).toBe("persistent");
		expect((await database.getAll<OpenFabUserBlueprintRecord>("user-blueprints")).length).toBe(2);
	});

	it("preserves a conflicting offline metadata edit as a separately rekeyed record", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("offline-edit", "Original", null);
		await insertUserBlueprint(persistence, original);
		database.setRejectUserBlueprintOperations(true);
		const localUpdate = renameUserBlueprint(original, "Offline Copy", "2026-08-02T00:00:00.001Z");

		await expect(persistence.update(original, localUpdate)).resolves.toEqual({
			status: "updated",
			durability: "session-only",
		});
		database.setRejectUserBlueprintOperations(false);
		await database.put(
			"user-blueprints",
			renameUserBlueprint(original, "Remote Copy", "2026-08-02T00:00:00.002Z"),
		);

		const firstRefresh = await persistence.list();
		expect(firstRefresh.map(({ blueprint }) => blueprint.name).sort()).toEqual([
			"Offline Copy",
			"Remote Copy",
		]);
		expect(persistence.getStatus().durability).toBe("persistent");
		const persisted = await persistence.list();
		expect(persisted.map(({ blueprint }) => blueprint.name).sort()).toEqual([
			"Offline Copy",
			"Remote Copy",
		]);
		expect(persistence.getStatus().durability).toBe("persistent");
	});

	it("rekeys and renames an offline metadata edit if its target name is claimed before reconnect", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("offline-name-edit", "Original", null);
		await insertUserBlueprint(persistence, original);
		database.setRejectUserBlueprintOperations(true);
		const offlineUpdate = renameUserBlueprint(original, "Shared Bay", "2026-08-02T00:00:00.001Z");
		await expect(persistence.update(original, offlineUpdate)).resolves.toEqual({
			status: "updated",
			durability: "session-only",
		});

		database.setRejectUserBlueprintOperations(false);
		await database.put("user-blueprints", userBlueprint("remote-name-edit", "SHARED BAY", null));
		const reconciled = await persistence.list();

		expect(reconciled.map(({ blueprint }) => blueprint.name).sort()).toEqual([
			"Original",
			"SHARED BAY",
			"Shared Bay (Recovered)",
		]);
		expect(new Set(reconciled.map(({ id }) => id)).size).toBe(3);
		expect(persistence.getStatus().durability).toBe("persistent");
	});

	it("retries deletion of an offline metadata edit without resurrecting the persisted value", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("offline-delete", "Original", null);
		await insertUserBlueprint(persistence, original);
		database.setRejectUserBlueprintOperations(true);
		const offlineUpdate = renameUserBlueprint(
			original,
			"Offline Update",
			"2026-08-02T00:00:00.001Z",
		);

		await expect(persistence.update(original, offlineUpdate)).resolves.toEqual({
			status: "updated",
			durability: "session-only",
		});
		await expect(persistence.remove(offlineUpdate)).resolves.toEqual({
			status: "removed",
			durability: "session-only",
		});
		expect(await persistence.get(original.id)).toBeNull();
		expect(await persistence.list()).toEqual([]);

		database.setRejectUserBlueprintOperations(false);
		expect(await persistence.list()).toEqual([]);
		expect(await database.get("user-blueprints", original.id)).toBeNull();
		expect(persistence.getStatus().durability).toBe("persistent");
	});

	it("reveals a concurrent remote edit instead of deleting it during tombstone reconciliation", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("offline-delete-conflict", "Original", null);
		await insertUserBlueprint(persistence, original);
		database.setRejectUserBlueprintOperations(true);
		const offlineUpdate = renameUserBlueprint(
			original,
			"Offline Update",
			"2026-08-02T00:00:00.001Z",
		);
		await persistence.update(original, offlineUpdate);
		await persistence.remove(offlineUpdate);

		database.setRejectUserBlueprintOperations(false);
		const remoteUpdate = renameUserBlueprint(original, "Remote Update", "2026-08-02T00:00:00.002Z");
		await database.put("user-blueprints", remoteUpdate);

		expect(await persistence.list()).toEqual([remoteUpdate]);
		expect(persistence.getStatus().durability).toBe("persistent");
	});

	it("clears an offline quick-slot claim that becomes occupied before reconnect", async () => {
		const database = new MemoryProjectDatabase({ enforceUniqueUserBlueprintQuickSlots: true });
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("offline-slot", "Offline Slot", null);
		await insertUserBlueprint(persistence, original);
		database.setRejectUserBlueprintOperations(true);
		const offlineUpdate = updateOpenFabUserBlueprintRecord(original, {
			quickSlot: 6,
			updatedAt: "2026-08-02T00:00:00.001Z",
		});

		await expect(persistence.update(original, offlineUpdate)).resolves.toEqual({
			status: "updated",
			durability: "session-only",
		});
		database.setRejectUserBlueprintOperations(false);
		await database.put("user-blueprints", userBlueprint("remote-slot-owner", "Remote Slot", 6));

		const reconciled = await persistence.list();
		expect(reconciled.find(({ id }) => id === original.id)?.quickSlot).toBeNull();
		expect(reconciled.find(({ id }) => id === "remote-slot-owner")?.quickSlot).toBe(6);
		expect(persistence.getStatus().durability).toBe("persistent");
		expect(
			(await database.get<OpenFabUserBlueprintRecord>("user-blueprints", original.id))?.quickSlot,
		).toBeNull();
	});

	it("does not duplicate an insert when storage becomes unreadable after commit", async () => {
		let armed = false;
		const database = new MemoryProjectDatabase({
			afterUserBlueprintPut: () => {
				if (armed) database.setRejectUserBlueprintOperations(true);
			},
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const record = userBlueprint("committed-insert", "Committed Insert", null);
		armed = true;

		await expect(persistence.insert(record)).resolves.toEqual({
			status: "inserted",
			durability: "persistent",
		});
		database.setRejectUserBlueprintOperations(false);

		expect(await persistence.list()).toEqual([record]);
	});

	it("does not duplicate an update when storage becomes unreadable after commit", async () => {
		let armed = false;
		const database = new MemoryProjectDatabase({
			afterUserBlueprintPut: () => {
				if (armed) database.setRejectUserBlueprintOperations(true);
			},
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("committed-update", "Original", null);
		await insertUserBlueprint(persistence, original);
		const updated = renameUserBlueprint(original, "Committed Update", "2026-08-02T00:00:00.001Z");
		armed = true;

		await expect(persistence.update(original, updated)).resolves.toEqual({
			status: "updated",
			durability: "persistent",
		});
		database.setRejectUserBlueprintOperations(false);

		expect(await persistence.list()).toEqual([updated]);
	});

	it("retries IndexedDB after a blocked upgrade instead of caching volatile mode", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const blockingLegacyConnection = await openLegacyUserBlueprintDatabase(factory);
		const persistence = new BrowserOpenFabProjectPersistence();

		await expect(
			insertUserBlueprint(persistence, userBlueprint("blocked", "Blocked Upgrade", null)),
		).resolves.toBe("session-only");
		blockingLegacyConnection.close();

		let durability: OpenFabUserBlueprintMutationDurability = "session-only";
		const deadline = Date.now() + 2_000;
		while (durability !== "persistent" && Date.now() < deadline) {
			await persistence.list();
			durability = persistence.getStatus().durability;
			if (durability !== "persistent") {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		expect(durability).toBe("persistent");
		await insertUserBlueprint(persistence, userBlueprint("reconnected", "Reconnected", null));
		expect((await persistence.list()).map(({ id }) => id)).toEqual(["blocked", "reconnected"]);
	}, 10_000);

	it("atomically replaces a complete persistent library only from its expected snapshot", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		await insertUserBlueprint(persistence, userBlueprint("library-a", "Bay A", 1));
		await insertUserBlueprint(persistence, userBlueprint("library-b", "Bay B", 2));
		const expected = await persistence.list();
		const replacement = [userBlueprint("library-c", "Bay C", 3)];

		await expect(persistence.replaceAllIfUnchanged(expected, replacement)).resolves.toEqual({
			status: "replaced",
		});
		expect(await persistence.list()).toEqual(replacement);
	});

	it("reports success when cancellation arrives after the atomic replacement committed", async () => {
		const controller = new AbortController();
		let armed = false;
		const database = new MemoryProjectDatabase({
			afterUserBlueprintPut: () => {
				if (armed) controller.abort();
			},
		});
		const persistence = new BrowserOpenFabProjectPersistence(database);
		await insertUserBlueprint(persistence, userBlueprint("library-a", "Bay A", 1));
		const expected = await persistence.list();
		const replacement = [userBlueprint("library-b", "Bay B", 2)];
		armed = true;

		await expect(
			persistence.replaceAllIfUnchanged(expected, replacement, controller.signal),
		).resolves.toEqual({ status: "replaced" });
		expect(await persistence.list()).toEqual(replacement);
	});

	it("rejects a stale whole-library restore without changing any current record", async () => {
		const database = new MemoryProjectDatabase();
		const persistence = new BrowserOpenFabProjectPersistence(database);
		const original = userBlueprint("library-a", "Bay A", 1);
		await insertUserBlueprint(persistence, original);
		const expected = await persistence.list();
		const concurrent = userBlueprint("library-concurrent", "Concurrent", 2);
		await database.put("user-blueprints", concurrent);

		await expect(
			persistence.replaceAllIfUnchanged(expected, [userBlueprint("library-b", "Bay B", 3)]),
		).resolves.toEqual({ status: "conflict" });
		expect((await persistence.list()).map(({ id }) => id)).toEqual([
			"library-a",
			"library-concurrent",
		]);
	});

	it("blocks whole-library replacement for session-only or quarantined storage", async () => {
		const unavailableDatabase = new MemoryProjectDatabase();
		const unavailablePersistence = new BrowserOpenFabProjectPersistence(unavailableDatabase);
		const expected = [userBlueprint("library-a", "Bay A", null)];
		const expectedRecord = expected[0];
		if (!expectedRecord) throw new Error("Expected a user blueprint fixture.");
		await insertUserBlueprint(unavailablePersistence, expectedRecord);
		unavailableDatabase.setRejectUserBlueprintOperations(true);
		await expect(unavailablePersistence.replaceAllIfUnchanged(expected, [])).resolves.toEqual({
			status: "storage-unavailable",
		});
		unavailableDatabase.setRejectUserBlueprintOperations(false);
		expect(await unavailablePersistence.list()).toEqual(expected);

		const corruptDatabase = new MemoryProjectDatabase();
		await corruptDatabase.put("user-blueprints", expectedRecord);
		await corruptDatabase.put("user-blueprints", { id: "corrupt", schemaVersion: 99 });
		const corruptPersistence = new BrowserOpenFabProjectPersistence(corruptDatabase);
		const visible = await corruptPersistence.list();
		await expect(corruptPersistence.replaceAllIfUnchanged(visible, [])).resolves.toEqual({
			status: "storage-invalid",
		});
		expect(await corruptDatabase.get("user-blueprints", "corrupt")).not.toBeNull();
	});

	it("persists an atomic whole-library replacement across a real IndexedDB reopen", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const first = new BrowserOpenFabProjectPersistence();
		await insertUserBlueprint(first, userBlueprint("library-a", "Bay A", 1));
		await insertUserBlueprint(first, userBlueprint("library-b", "Bay B", 2));
		const expected = await first.list();
		const replacement = [
			userBlueprint("library-c", "Bay C", 3),
			userBlueprint("library-d", "Bay D", 4),
		];

		await expect(first.replaceAllIfUnchanged(expected, replacement)).resolves.toEqual({
			status: "replaced",
		});
		const reopened = new BrowserOpenFabProjectPersistence();
		expect(await reopened.list()).toEqual(replacement);
	});

	it("allows exactly one concurrent whole-library CAS writer to commit in IndexedDB", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const seed = new BrowserOpenFabProjectPersistence();
		await insertUserBlueprint(seed, userBlueprint("library-a", "Bay A", 1));
		const expected = await seed.list();
		const firstWriter = new BrowserOpenFabProjectPersistence();
		const secondWriter = new BrowserOpenFabProjectPersistence();
		const firstReplacement = [userBlueprint("library-first", "First Writer", 2)];
		const secondReplacement = [userBlueprint("library-second", "Second Writer", 3)];

		const results = await Promise.all([
			firstWriter.replaceAllIfUnchanged(expected, firstReplacement),
			secondWriter.replaceAllIfUnchanged(expected, secondReplacement),
		]);

		expect(results.map(({ status }) => status).sort()).toEqual(["conflict", "replaced"]);
		const reopened = new BrowserOpenFabProjectPersistence();
		const storedIds = (await reopened.list()).map(({ id }) => id);
		expect(
			[firstReplacement, secondReplacement].map((records) => records.map(({ id }) => id)),
		).toContainEqual(storedIds);
	});

	it("rolls back clear and earlier adds when a later IndexedDB replacement add fails", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const database = await openUserBlueprintDatabaseWithTestNameConstraint(factory);
		const original = [
			userBlueprint("library-a", "Original A", 1),
			userBlueprint("library-b", "Original B", 2),
		];
		await putIndexedDbRecords(database, original);
		database.close();
		const persistence = new BrowserOpenFabProjectPersistence();
		const expected = await persistence.list();
		const replacement = [
			moveUserBlueprintToFolder(
				userBlueprint("library-c", "Shared Name", 3),
				Object.freeze(["Photo"]),
			),
			moveUserBlueprintToFolder(
				userBlueprint("library-d", "Shared Name", 4),
				Object.freeze(["Etch"]),
			),
		];

		await expect(persistence.replaceAllIfUnchanged(expected, replacement)).rejects.toMatchObject({
			name: "ConstraintError",
		});
		const reopened = new BrowserOpenFabProjectPersistence();
		expect(await reopened.list()).toEqual(original);
	});

	it("guards aggregate canonical JSON bytes inside the database capacity operation", async () => {
		const database = new MemoryProjectDatabase();
		const first = userBlueprint("json-a", "JSON A", null);
		const second = userBlueprint("json-b", "JSON B", null);
		const maximumJsonBytes =
			openFabUserBlueprintRecordJsonByteLength(first) +
			openFabUserBlueprintRecordJsonByteLength(second) -
			1;

		await expect(
			database.insertIfCapacity(
				"user-blueprints",
				first,
				OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
				undefined,
				maximumJsonBytes,
			),
		).resolves.toBe("inserted");
		await expect(
			database.insertIfCapacity(
				"user-blueprints",
				second,
				OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
				undefined,
				maximumJsonBytes,
			),
		).rejects.toThrow("canonical JSON");
	});

	it("atomically enforces user-library capacity across concurrent IndexedDB writers", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const database = await openCurrentUserBlueprintDatabase(factory);
		await putIndexedDbRecords(
			database,
			Array.from({ length: 1_023 }, (_, index) =>
				userBlueprint(`legacy-capacity-${index}`, `Legacy Capacity ${index}`, null),
			),
		);
		database.close();
		const persistence = new BrowserOpenFabProjectPersistence();

		const results = await Promise.allSettled([
			insertUserBlueprint(persistence, userBlueprint("capacity-a", "Capacity A", null)),
			insertUserBlueprint(persistence, userBlueprint("capacity-b", "Capacity B", null)),
		]);

		expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
		expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
		expect(results.find(({ status }) => status === "rejected")).toMatchObject({
			reason: expect.objectContaining({
				message: "User blueprint library cannot exceed 1024 records.",
			}),
		});
	});

	it("atomically counts new records against the aggregate IndexedDB edge budget", async () => {
		const factory = new IDBFactory();
		vi.stubGlobal("indexedDB", factory);
		const database = await openCurrentUserBlueprintDatabase(factory);
		const edgeCount = 20_000;
		await putIndexedDbRecords(
			database,
			Array.from({ length: 11 }, (_, index) =>
				userBlueprintWithEdgeCount(
					`aggregate-capacity-${index}`,
					`Aggregate Capacity ${index}`,
					edgeCount,
				),
			),
		);
		database.close();
		const persistence = new BrowserOpenFabProjectPersistence();

		const results = await Promise.allSettled([
			insertUserBlueprint(
				persistence,
				userBlueprintWithEdgeCount("aggregate-a", "Aggregate A", edgeCount),
			),
			insertUserBlueprint(
				persistence,
				userBlueprintWithEdgeCount("aggregate-b", "Aggregate B", edgeCount),
			),
		]);

		expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
		expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
		expect(results.find(({ status }) => status === "rejected")).toMatchObject({
			reason: expect.objectContaining({
				message: `User blueprint library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES.toLocaleString()} directed edges.`,
			}),
		});
		const stored = await persistence.list();
		expect(stored).toHaveLength(12);
		expect(stored.reduce((total, record) => total + record.blueprint.edges.length, 0)).toBe(
			240_000,
		);
	}, 30_000);
});

class MemoryProjectDatabase implements BrowserProjectDatabasePort {
	private readonly stores = new Map<string, Map<IDBValidKey, unknown>>();
	readonly getAllStoreNames: string[] = [];
	private readonly rejectHandleWrites: boolean;
	private rejectUserBlueprintOperations: boolean;
	private readonly afterUserBlueprintPut: (() => void) | undefined;
	private readonly afterUserBlueprintDelete: (() => void) | undefined;
	private readonly enforceUniqueUserBlueprintQuickSlots: boolean;
	private readonly beforeRecoveryCleanup: (() => void) | undefined;

	constructor(
		options: {
			readonly rejectHandleWrites?: boolean;
			readonly rejectUserBlueprintOperations?: boolean;
			readonly afterUserBlueprintPut?: () => void;
			readonly afterUserBlueprintDelete?: () => void;
			readonly enforceUniqueUserBlueprintQuickSlots?: boolean;
			readonly beforeRecoveryCleanup?: () => void;
		} = {},
	) {
		this.rejectHandleWrites = options.rejectHandleWrites ?? false;
		this.rejectUserBlueprintOperations = options.rejectUserBlueprintOperations ?? false;
		this.afterUserBlueprintPut = options.afterUserBlueprintPut;
		this.afterUserBlueprintDelete = options.afterUserBlueprintDelete;
		this.enforceUniqueUserBlueprintQuickSlots =
			options.enforceUniqueUserBlueprintQuickSlots ?? false;
		this.beforeRecoveryCleanup = options.beforeRecoveryCleanup;
	}

	async get<Value>(storeName: string, key: IDBValidKey): Promise<Value | null> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		return (this.store(storeName).get(key) as Value | undefined) ?? null;
	}

	async getAll<Value>(storeName: string, count?: number): Promise<Value[]> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		this.getAllStoreNames.push(storeName);
		const values = [...this.store(storeName).values()];
		return (count === undefined ? values : values.slice(0, count)) as Value[];
	}

	async scan(
		storeName: string,
		visit: (value: unknown, key: IDBValidKey) => boolean,
		maximumRecords: number,
	): Promise<Readonly<{ visited: number; truncated: boolean }>> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		let visited = 0;
		for (const [key, value] of this.store(storeName)) {
			if (visited >= maximumRecords) return Object.freeze({ visited, truncated: true });
			visited += 1;
			if (!visit(value, key)) return Object.freeze({ visited, truncated: true });
		}
		return Object.freeze({ visited, truncated: false });
	}

	async put(storeName: string, value: unknown): Promise<void> {
		if (this.rejectHandleWrites && storeName === "file-handles") {
			throw new DOMException("handle clone failed", "DataCloneError");
		}
		this.rejectUnavailableUserBlueprintOperation(storeName);
		if (!isRecord(value)) throw new Error("memory database values must be records");
		const key = value.id ?? value.projectId;
		if (typeof key !== "string") throw new Error("memory database record key is missing");
		if (
			storeName === "user-blueprints" &&
			this.enforceUniqueUserBlueprintQuickSlots &&
			typeof value.quickSlot === "number" &&
			[...this.store(storeName).entries()].some(
				([existingKey, existing]) =>
					existingKey !== key && isRecord(existing) && existing.quickSlot === value.quickSlot,
			)
		) {
			throw new DOMException("quick slot is already occupied", "ConstraintError");
		}
		this.store(storeName).set(key, value);
		if (storeName === "user-blueprints") this.afterUserBlueprintPut?.();
	}

	async putMany(records: readonly BrowserProjectDatabaseStoreValue[]): Promise<void> {
		const snapshots = this.snapshotStores(records.map(({ storeName }) => storeName));
		try {
			for (const { storeName, value } of records) await this.put(storeName, value);
		} catch (error) {
			this.restoreStores(snapshots);
			throw error;
		}
	}

	async insertIfCapacity(
		storeName: string,
		value: unknown,
		maximumRecords: number,
		maximumTotalEdges?: number,
		conflictsWith?: BrowserProjectDatabaseConflictPredicate,
		maximumTotalJsonBytes?: number,
	): Promise<BrowserProjectDatabaseInsertStatus> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		if (!isRecord(value)) throw new Error("memory database values must be records");
		const key = value.id ?? value.projectId;
		if (typeof key !== "string") throw new Error("memory database record key is missing");
		const store = this.store(storeName);
		if (store.has(key)) return "id-conflict";
		if (store.size >= maximumRecords) {
			throw new Error(`User blueprint library cannot exceed ${maximumRecords} records.`);
		}
		if (maximumTotalEdges !== undefined) {
			const projected =
				[...store.values()].reduce<number>(
					(total, candidate) => total + memoryBlueprintEdgeCount(candidate),
					0,
				) + memoryBlueprintEdgeCount(value);
			if (projected > maximumTotalEdges) {
				throw new Error(
					`User blueprint library cannot exceed ${maximumTotalEdges.toLocaleString()} directed edges.`,
				);
			}
		}
		if (maximumTotalJsonBytes !== undefined) {
			const projected =
				[...store.values()].reduce<number>(
					(total, candidate) => total + memoryBlueprintJsonByteLength(candidate),
					0,
				) + memoryBlueprintJsonByteLength(value);
			if (projected > maximumTotalJsonBytes) {
				throw new Error(
					`User blueprint library cannot exceed ${maximumTotalJsonBytes / (1024 * 1024)} MiB of canonical JSON.`,
				);
			}
		}
		if ([...store.values()].some((candidate) => conflictsWith?.(candidate) === true)) {
			return "value-conflict";
		}
		await this.put(storeName, value);
		return "inserted";
	}

	async replaceIfUnchanged(
		storeName: string,
		expected: unknown,
		replacement: unknown,
		maximumTotalEdges?: number,
		conflictsWith?: BrowserProjectDatabaseConflictPredicate,
		maximumTotalJsonBytes?: number,
	): Promise<BrowserProjectDatabaseReplaceStatus> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		if (!isRecord(expected) || typeof expected.id !== "string" || !isRecord(replacement)) {
			throw new Error("memory conditional replacement requires records");
		}
		const store = this.store(storeName);
		const current = store.get(expected.id);
		if (current === undefined) return "missing";
		if (JSON.stringify(current) !== JSON.stringify(expected)) return "conflict";
		if ([...store.values()].some((candidate) => conflictsWith?.(candidate) === true)) {
			return "value-conflict";
		}
		if (maximumTotalEdges !== undefined) {
			const projected =
				[...store.values()].reduce<number>(
					(total, candidate) => total + memoryBlueprintEdgeCount(candidate),
					0,
				) -
				memoryBlueprintEdgeCount(current) +
				memoryBlueprintEdgeCount(replacement);
			if (projected > maximumTotalEdges) {
				throw new Error(
					`User blueprint library cannot exceed ${maximumTotalEdges.toLocaleString()} directed edges.`,
				);
			}
		}
		if (maximumTotalJsonBytes !== undefined) {
			const projected =
				[...store.values()].reduce<number>(
					(total, candidate) => total + memoryBlueprintJsonByteLength(candidate),
					0,
				) -
				memoryBlueprintJsonByteLength(current) +
				memoryBlueprintJsonByteLength(replacement);
			if (projected > maximumTotalJsonBytes) {
				throw new Error(
					`User blueprint library cannot exceed ${maximumTotalJsonBytes / (1024 * 1024)} MiB of canonical JSON.`,
				);
			}
		}
		await this.put(storeName, replacement);
		return "updated";
	}

	async deleteIfUnchanged(
		storeName: string,
		expected: unknown,
	): Promise<"removed" | "missing" | "conflict"> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		if (!isRecord(expected) || typeof expected.id !== "string") {
			throw new Error("memory conditional deletion requires a record");
		}
		const store = this.store(storeName);
		const current = store.get(expected.id);
		if (current === undefined) return "missing";
		if (JSON.stringify(current) !== JSON.stringify(expected)) return "conflict";
		await this.delete(storeName, expected.id);
		return "removed";
	}

	async replaceAllIfUnchanged(
		storeName: string,
		expected: readonly unknown[],
		replacement: readonly unknown[],
		maximumRecords: number,
		maximumTotalEdges: number,
		maximumTotalJsonBytes: number,
	): Promise<"replaced" | "conflict"> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		const store = this.store(storeName);
		const current = [...store.values()];
		if (!memoryBlueprintSnapshotsEqual(current, expected)) return "conflict";
		if (replacement.length > maximumRecords) {
			throw new Error(`User blueprint library cannot exceed ${maximumRecords} records.`);
		}
		const totalEdges = replacement.reduce<number>(
			(total, value) => total + memoryBlueprintEdgeCount(value),
			0,
		);
		if (totalEdges > maximumTotalEdges) {
			throw new Error(
				`User blueprint library cannot exceed ${maximumTotalEdges.toLocaleString()} directed edges.`,
			);
		}
		const totalJsonBytes = replacement.reduce<number>(
			(total, value) => total + memoryBlueprintJsonByteLength(value),
			0,
		);
		if (totalJsonBytes > maximumTotalJsonBytes) {
			throw new Error(
				`User blueprint library cannot exceed ${maximumTotalJsonBytes / (1024 * 1024)} MiB of canonical JSON.`,
			);
		}
		const next = new Map<IDBValidKey, unknown>();
		const slots = new Set<number>();
		for (const value of replacement) {
			if (!isRecord(value) || typeof value.id !== "string") {
				throw new Error("memory atomic replacement requires blueprint records");
			}
			if (next.has(value.id)) throw new DOMException("duplicate id", "ConstraintError");
			if (typeof value.quickSlot === "number") {
				if (slots.has(value.quickSlot)) {
					throw new DOMException("duplicate quick slot", "ConstraintError");
				}
				slots.add(value.quickSlot);
			}
			next.set(value.id, value);
		}
		store.clear();
		for (const [key, value] of next) store.set(key, value);
		this.afterUserBlueprintPut?.();
		return "replaced";
	}

	async delete(storeName: string, key: IDBValidKey): Promise<void> {
		this.rejectUnavailableUserBlueprintOperation(storeName);
		this.store(storeName).delete(key);
		if (storeName === "user-blueprints") this.afterUserBlueprintDelete?.();
	}

	async deleteMany(records: readonly BrowserProjectDatabaseStoreKey[]): Promise<void> {
		const snapshots = this.snapshotStores(records.map(({ storeName }) => storeName));
		try {
			for (const { storeName, key } of records) await this.delete(storeName, key);
		} catch (error) {
			this.restoreStores(snapshots);
			throw error;
		}
	}

	async deleteRecoveriesIfSummariesUnchanged(
		expected: readonly OpenFabRecoveryProjectSummary[],
	): Promise<"removed" | "conflict"> {
		this.beforeRecoveryCleanup?.();
		const summaries = this.store("recovery-project-summaries");
		for (const candidate of expected) {
			const current = summaries.get(candidate.projectId);
			if (JSON.stringify(current) !== JSON.stringify(candidate)) return "conflict";
		}
		const snapshots = this.snapshotStores(["recovery-project-summaries", "recovery-projects"]);
		try {
			for (const candidate of expected) {
				summaries.delete(candidate.projectId);
				this.store("recovery-projects").delete(candidate.projectId);
			}
			return "removed";
		} catch (error) {
			this.restoreStores(snapshots);
			throw error;
		}
	}

	overwriteRecoverySummaryForTest(summary: OpenFabRecoveryProjectSummary): void {
		this.store("recovery-project-summaries").set(summary.projectId, summary);
	}

	setRejectUserBlueprintOperations(reject: boolean): void {
		this.rejectUserBlueprintOperations = reject;
	}

	private rejectUnavailableUserBlueprintOperation(storeName: string): void {
		if (this.rejectUserBlueprintOperations && storeName === "user-blueprints") {
			throw new Error("IndexedDB unavailable");
		}
	}

	private store(name: string): Map<IDBValidKey, unknown> {
		let store = this.stores.get(name);
		if (!store) {
			store = new Map();
			this.stores.set(name, store);
		}
		return store;
	}

	private snapshotStores(
		storeNames: readonly string[],
	): ReadonlyMap<string, Map<IDBValidKey, unknown>> {
		return new Map(
			[...new Set(storeNames)].map((storeName) => [storeName, new Map(this.store(storeName))]),
		);
	}

	private restoreStores(snapshots: ReadonlyMap<string, Map<IDBValidKey, unknown>>): void {
		for (const [storeName, snapshot] of snapshots) this.stores.set(storeName, new Map(snapshot));
	}
}

function createFileHandle(name: string): {
	readonly handle: {
		readonly kind: "file";
		readonly name: string;
		getFile(): Promise<{ size: number; text(): Promise<string> }>;
		createWritable(): Promise<ReturnType<typeof createWritable>>;
	};
	readonly content: () => string;
} {
	let content = "";
	return {
		handle: {
			kind: "file",
			name,
			getFile: async () => ({ size: content.length, text: async () => content }),
			createWritable: async () => createWritable((value) => (content = value)),
		},
		content: () => content,
	};
}

function createWritable(commit: (value: string) => void): {
	write(value: string): Promise<void>;
	close(): Promise<void>;
	abort(): Promise<void>;
} {
	let staged = "";
	return {
		write: async (value) => {
			staged = value;
		},
		close: async () => commit(staged),
		abort: async () => undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function insertUserBlueprint(
	persistence: BrowserOpenFabProjectPersistence,
	record: OpenFabUserBlueprintRecord,
	signal?: AbortSignal,
): Promise<OpenFabUserBlueprintMutationDurability> {
	const result = await persistence.insert(record, signal);
	if (result.status === "id-conflict") throw new Error(`Blueprint ${record.id} already exists.`);
	if (result.status === "name-conflict") {
		throw new Error(`Blueprint ${record.blueprint.name} already exists in this folder.`);
	}
	if (result.status === "quick-slot-conflict") {
		throw new Error(`Quick slot ${record.quickSlot} is already assigned.`);
	}
	return result.durability;
}

async function removeUserBlueprint(
	persistence: BrowserOpenFabProjectPersistence,
	record: OpenFabUserBlueprintRecord,
	signal?: AbortSignal,
): Promise<OpenFabUserBlueprintMutationDurability> {
	const result = await persistence.remove(record, signal);
	if (result.status !== "removed") throw new Error(`Blueprint removal ${result.status}.`);
	return result.durability;
}

function memoryBlueprintEdgeCount(value: unknown): number {
	try {
		return parseOpenFabUserBlueprintRecord(value).blueprint.edges.length;
	} catch {
		return 0;
	}
}

function memoryBlueprintJsonByteLength(value: unknown): number {
	try {
		return openFabUserBlueprintRecordJsonByteLength(parseOpenFabUserBlueprintRecord(value));
	} catch {
		return 0;
	}
}

function memoryBlueprintSnapshotsEqual(
	left: readonly unknown[],
	right: readonly unknown[],
): boolean {
	if (left.length !== right.length) return false;
	const rightById = new Map(
		right
			.filter(isRecord)
			.map((value) => [typeof value.id === "string" ? value.id : "", value] as const),
	);
	return left.every((value) => {
		if (!isRecord(value) || typeof value.id !== "string") return false;
		return JSON.stringify(value) === JSON.stringify(rightById.get(value.id));
	});
}

function userBlueprint(id: string, name: string, quickSlot: number | null) {
	return createOpenFabUserBlueprintRecord(
		createOpenFabRailAreaBlueprint(USER_BLUEPRINT_TEMPLATE, {
			id: `${id}-portable`,
			name,
			createdAt: "2026-08-02T00:00:00.000Z",
		}),
		{
			id,
			folderPath: ["Production"],
			quickSlot,
			createdAt: "2026-08-02T00:00:00.000Z",
		},
	);
}

function renameUserBlueprint(
	record: OpenFabUserBlueprintRecord,
	name: string,
	updatedAt: string,
): OpenFabUserBlueprintRecord {
	return updateOpenFabUserBlueprintRecord(record, {
		updatedAt,
		blueprint: updateOpenFabProjectBlueprint(record.blueprint, {
			name,
			updatedAt,
		}),
	});
}

function moveUserBlueprintToFolder(
	record: OpenFabUserBlueprintRecord,
	folderPath: readonly string[],
): OpenFabUserBlueprintRecord {
	return updateOpenFabUserBlueprintRecord(record, {
		folderPath,
		updatedAt: record.updatedAt,
		blueprint: updateOpenFabProjectBlueprint(record.blueprint, {
			folder: folderPath.join("/"),
			updatedAt: record.blueprint.updatedAt,
		}),
	});
}

function userBlueprintWithEdgeCount(id: string, name: string, edgeCount: number) {
	const template: RailAreaStampTemplate = Object.freeze({
		sourceRevision: 1,
		sourceModuleKeys: Object.freeze(["aggregate-capacity"]),
		sourceModuleCount: 1,
		sourceEdgeCount: edgeCount,
		sourceWidthMeters: edgeCount,
		sourceHeightMeters: 0,
		edges: Object.freeze(
			Array.from({ length: edgeCount }, (_, x) =>
				Object.freeze({
					from: Object.freeze({ x, y: 0 }),
					to: Object.freeze({ x: x + 1, y: 0 }),
				}),
			),
		),
	});
	return createOpenFabUserBlueprintRecord(
		createOpenFabRailAreaBlueprint(template, {
			id: `${id}-portable`,
			name,
			createdAt: "2026-08-02T00:00:00.000Z",
		}),
		{
			id,
			folderPath: ["Production"],
			quickSlot: null,
			createdAt: "2026-08-02T00:00:00.000Z",
		},
	);
}

class RecordingUserBlueprintLibraryChangePort implements OpenFabUserBlueprintLibraryChangePort {
	readonly available = true;
	publicationCount = 0;

	publishChange(): void {
		this.publicationCount += 1;
	}

	subscribe(): () => void {
		return () => undefined;
	}

	dispose(): void {}
}

const USER_BLUEPRINT_TEMPLATE: RailAreaStampTemplate = Object.freeze({
	sourceRevision: 1,
	sourceModuleKeys: Object.freeze(["closed-loop"]),
	sourceModuleCount: 1,
	sourceEdgeCount: 4,
	sourceWidthMeters: 1,
	sourceHeightMeters: 1,
	edges: Object.freeze([
		Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 0 }), to: Object.freeze({ x: 1, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 1 }), to: Object.freeze({ x: 0, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 0, y: 1 }), to: Object.freeze({ x: 0, y: 0 }) }),
	]),
});

async function openLegacyUserBlueprintDatabase(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open("openfab-native-projects", 2);
		request.onupgradeneeded = () => {
			request.result.createObjectStore("user-blueprints", { keyPath: "id" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function openLegacyRecoveryDatabase(
	factory: IDBFactory,
	recovery: Readonly<Record<string, unknown>>,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open("openfab-native-projects", 3);
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore("recovery-projects", {
				keyPath: "projectId",
			});
			store.put(recovery);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function openCurrentUserBlueprintDatabase(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open("openfab-native-projects", 3);
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore("user-blueprints", { keyPath: "id" });
			store.createIndex("quick-slot", "quickSlot", { unique: true });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function openConstrainedRecoveryDatabase(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open("openfab-native-projects", 4);
		request.onupgradeneeded = () => {
			const payloads = request.result.createObjectStore("recovery-projects", {
				keyPath: "projectId",
			});
			const summaries = request.result.createObjectStore("recovery-project-summaries", {
				keyPath: "projectId",
			});
			summaries.createIndex("test-unique-name", "name", { unique: true });
			summaries.put({
				projectId: "existing-recovery",
				name: "Duplicate Recovery",
				updatedAt: "2026-07-18T01:00:00.000Z",
				authoredChecksum: "existing-checksum",
			});
			payloads.put({
				projectId: "existing-recovery",
				name: "Duplicate Recovery",
				updatedAt: "2026-07-18T01:00:00.000Z",
				authoredChecksum: "existing-checksum",
				json: '{"existing":true}',
			});
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function openUserBlueprintDatabaseWithTestNameConstraint(
	factory: IDBFactory,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open("openfab-native-projects", 3);
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore("user-blueprints", { keyPath: "id" });
			store.createIndex("quick-slot", "quickSlot", { unique: true });
			store.createIndex("test-blueprint-name", "blueprint.name", { unique: true });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function putIndexedDbRecords(
	database: IDBDatabase,
	records: readonly unknown[],
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction("user-blueprints", "readwrite");
		const store = transaction.objectStore("user-blueprints");
		for (const record of records) store.put(record);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}
