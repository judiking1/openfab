import { updateOpenFabProjectBlueprint } from "../project/OpenFabBlueprintLibrary";
import { OPENFAB_PROJECT_MAX_JSON_CHARACTERS } from "../project/OpenFabProjectCodec";
import type {
	OpenFabProjectFileGateway,
	OpenFabProjectFileRead,
	OpenFabProjectFileReference,
	OpenFabProjectIdentityProvider,
	OpenFabProjectMetadataStore,
	OpenFabRecentProject,
	OpenFabRecoveryCleanupPlan,
	OpenFabRecoveryCleanupRequest,
	OpenFabRecoveryCleanupResult,
	OpenFabRecoveryProject,
	OpenFabRecoveryProjectInventory,
	OpenFabRecoveryProjectInventoryRequest,
	OpenFabRecoveryProjectSummary,
} from "../project/OpenFabProjectPorts";
import {
	planOpenFabRecoveryCleanup,
	recoveryCleanupPlansEqual,
	recoveryProjectSummariesEqual,
} from "../project/OpenFabRecoveryCleanup";
import {
	compareOpenFabUserBlueprintRecords,
	copyOpenFabUserBlueprintRecord,
	OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION,
	OPENFAB_USER_BLUEPRINT_FILE_EXTENSION,
	OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES,
	OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
	OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS,
	OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
	OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
	type OpenFabUserBlueprintFileGateway,
	type OpenFabUserBlueprintFileRead,
	type OpenFabUserBlueprintInsertResult,
	type OpenFabUserBlueprintLibraryChangePort,
	type OpenFabUserBlueprintLibraryStatus,
	type OpenFabUserBlueprintLibraryStore,
	type OpenFabUserBlueprintMutationDurability,
	OpenFabUserBlueprintParseError,
	type OpenFabUserBlueprintRecord,
	type OpenFabUserBlueprintRejectedDiagnostic,
	type OpenFabUserBlueprintRejectedDiagnosticRead,
	type OpenFabUserBlueprintRejectedDiagnosticRemoveResult,
	type OpenFabUserBlueprintRemoveResult,
	type OpenFabUserBlueprintReplaceAllResult,
	type OpenFabUserBlueprintUpdateResult,
	openFabUserBlueprintRecordJsonByteLength,
	openFabUserBlueprintsShareFolderAndName,
	openFabUtf8ByteLength,
	parseOpenFabUserBlueprintRecord,
	serializeOpenFabUserBlueprintDiagnosticValue,
	serializeOpenFabUserBlueprintRecord,
	updateOpenFabUserBlueprintRecord,
} from "../project/OpenFabUserBlueprintLibrary";
import {
	OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION,
	OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES,
	type OpenFabUserBlueprintLibraryBundleFileGateway,
	type OpenFabUserBlueprintLibraryBundleFileRead,
	type OpenFabUserBlueprintLibraryRestorePlan,
	validateOpenFabUserBlueprintLibrarySnapshot,
} from "../project/OpenFabUserBlueprintLibraryBundle";
import { consumePreparedUserBlueprintLibraryRestore } from "./OpenFabUserBlueprintLibraryRestoreBridge";

const DATABASE_NAME = "openfab-native-projects";
const DATABASE_VERSION = 5;
const HANDLE_STORE = "file-handles";
const RECENT_STORE = "recent-projects";
const RECOVERY_STORE = "recovery-projects";
const RECOVERY_SUMMARY_STORE = "recovery-project-summaries";
const USER_BLUEPRINT_STORE = "user-blueprints";
const USER_BLUEPRINT_QUICK_SLOT_INDEX = "quick-slot";
const MAX_RECENT_PROJECTS = 12;
const MAX_VISIBLE_RECOVERY_PROJECTS = 12;
const DATABASE_BLOCKED_FALLBACK_MILLISECONDS = 1_000;
const USER_BLUEPRINT_LEGACY_SCAN_RECORD_LIMIT =
	OPENFAB_USER_BLUEPRINT_MAX_RECORDS + OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS * 2;

export class BrowserOpenFabProjectIdentityProvider implements OpenFabProjectIdentityProvider {
	createProjectId(): string {
		return `project-${createRuntimeId()}`;
	}

	now(): string {
		return new Date().toISOString();
	}
}

export interface BrowserProjectDatabasePort {
	get<Value>(storeName: string, key: IDBValidKey): Promise<Value | null>;
	getAll<Value>(storeName: string, count?: number): Promise<Value[]>;
	scan(
		storeName: string,
		visit: (value: unknown, key: IDBValidKey) => boolean,
		maximumRecords: number,
	): Promise<BrowserProjectDatabaseScanResult>;
	put(storeName: string, value: unknown): Promise<void>;
	putMany(records: readonly BrowserProjectDatabaseStoreValue[]): Promise<void>;
	insertIfCapacity(
		storeName: string,
		value: unknown,
		maximumRecords: number,
		maximumTotalEdges?: number,
		conflictsWith?: BrowserProjectDatabaseConflictPredicate,
		maximumTotalJsonBytes?: number,
	): Promise<BrowserProjectDatabaseInsertStatus>;
	replaceIfUnchanged(
		storeName: string,
		expected: unknown,
		replacement: unknown,
		maximumTotalEdges?: number,
		conflictsWith?: BrowserProjectDatabaseConflictPredicate,
		maximumTotalJsonBytes?: number,
	): Promise<BrowserProjectDatabaseReplaceStatus>;
	deleteIfUnchanged(
		storeName: string,
		expected: unknown,
	): Promise<"removed" | "missing" | "conflict">;
	replaceAllIfUnchanged(
		storeName: string,
		expected: readonly unknown[],
		replacement: readonly unknown[],
		maximumRecords: number,
		maximumTotalEdges: number,
		maximumTotalJsonBytes: number,
		prevalidated?: boolean,
	): Promise<BrowserProjectDatabaseReplaceAllStatus>;
	delete(storeName: string, key: IDBValidKey): Promise<void>;
	deleteMany(records: readonly BrowserProjectDatabaseStoreKey[]): Promise<void>;
	deleteRecoveriesIfSummariesUnchanged(
		expected: readonly OpenFabRecoveryProjectSummary[],
	): Promise<"removed" | "conflict">;
}

export interface BrowserProjectDatabaseStoreValue {
	readonly storeName: string;
	readonly value: unknown;
}

export interface BrowserProjectDatabaseStoreKey {
	readonly storeName: string;
	readonly key: IDBValidKey;
}

export type BrowserProjectDatabaseConflictPredicate = (storedValue: unknown) => boolean;
export type BrowserProjectDatabaseInsertStatus = "inserted" | "id-conflict" | "value-conflict";
export type BrowserProjectDatabaseReplaceStatus =
	| "updated"
	| "missing"
	| "conflict"
	| "value-conflict";
export type BrowserProjectDatabaseReplaceAllStatus = "replaced" | "conflict";

export interface BrowserProjectDatabaseScanResult {
	readonly visited: number;
	readonly truncated: boolean;
}

export interface BrowserOpenFabProjectPersistenceOptions {
	readonly forceFileInputFallback?: boolean;
	readonly userBlueprintLibraryChanges?: OpenFabUserBlueprintLibraryChangePort;
}

interface BrowserWritableFileStream {
	write(data: string): Promise<void>;
	close(): Promise<void>;
	abort?(reason?: unknown): Promise<void>;
}

interface BrowserFileHandle {
	readonly kind: "file";
	readonly name: string;
	getFile(): Promise<File>;
	createWritable(): Promise<BrowserWritableFileStream>;
	queryPermission?(options: { readonly mode: "read" | "readwrite" }): Promise<PermissionState>;
	requestPermission?(options: { readonly mode: "read" | "readwrite" }): Promise<PermissionState>;
}

interface StoredHandle {
	readonly id: string;
	readonly name: string;
	readonly handle: BrowserFileHandle;
}

type BrowserOpenPicker = (options: {
	readonly multiple: false;
	readonly types: readonly {
		readonly description: string;
		readonly accept: Readonly<Record<string, readonly string[]>>;
	}[];
}) => Promise<readonly BrowserFileHandle[]>;

type BrowserSavePicker = (options: {
	readonly suggestedName: string;
	readonly types: readonly {
		readonly description: string;
		readonly accept: Readonly<Record<string, readonly string[]>>;
	}[];
}) => Promise<BrowserFileHandle>;

export class BrowserOpenFabProjectPersistence
	implements
		OpenFabProjectFileGateway,
		OpenFabProjectMetadataStore,
		OpenFabUserBlueprintLibraryStore,
		OpenFabUserBlueprintFileGateway,
		OpenFabUserBlueprintLibraryBundleFileGateway
{
	private readonly handles = new Map<string, BrowserFileHandle>();
	private readonly volatileUserBlueprints = new Map<string, OpenFabUserBlueprintRecord>();
	private readonly volatileInsertOnlyUserBlueprintIds = new Set<string>();
	private readonly volatileExpectedUserBlueprints = new Map<string, OpenFabUserBlueprintRecord>();
	private readonly volatileDeleteExpectedUserBlueprints = new Map<
		string,
		OpenFabUserBlueprintRecord
	>();
	private rejectedUserBlueprintDiagnostics: readonly OpenFabUserBlueprintRejectedDiagnostic[] =
		Object.freeze([]);
	private rejectedUserBlueprintKeys = new Map<string, IDBValidKey>();
	private rejectedUserBlueprintExpectedRecords = new Map<string, OpenFabUserBlueprintRecord>();
	private rejectedUserBlueprintGeneration = 0;
	private userBlueprintStatus: OpenFabUserBlueprintLibraryStatus = Object.freeze({
		durability: "persistent",
		rejectedRecordCount: 0,
		rejectedRecordCountIsLowerBound: false,
		diagnosticsTruncated: false,
		overflowDetected: false,
	});
	private readonly database: BrowserProjectDatabasePort;
	private readonly forceFileInputFallback: boolean;
	private readonly userBlueprintLibraryChanges: OpenFabUserBlueprintLibraryChangePort | null;

	constructor(
		database: BrowserProjectDatabasePort = new BrowserProjectDatabase(),
		options: BrowserOpenFabProjectPersistenceOptions = {},
	) {
		this.database = database;
		this.forceFileInputFallback = options.forceFileInputFallback ?? false;
		this.userBlueprintLibraryChanges = options.userBlueprintLibraryChanges ?? null;
	}

	async chooseOpen(signal?: AbortSignal): Promise<OpenFabProjectFileRead | null> {
		throwIfAborted(signal);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserOpenPicker>("showOpenFilePicker");
		if (!picker) return chooseOpenWithInput(signal);
		try {
			const handles = await picker({ multiple: false, types: PROJECT_FILE_TYPES });
			throwIfAborted(signal);
			const handle = handles[0];
			if (!handle) return null;
			const reference = await this.rememberHandle(handle);
			return this.readHandle(reference, handle, signal);
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return null;
			throw error;
		}
	}

	async openRecent(
		reference: OpenFabProjectFileReference,
		signal?: AbortSignal,
	): Promise<OpenFabProjectFileRead | null> {
		throwIfAborted(signal);
		if (!reference.reopenable) return null;
		const handle = this.handles.get(reference.id) ?? (await this.loadStoredHandle(reference.id));
		if (!handle) return null;
		const granted = await ensurePermission(handle, "read");
		if (!granted || signal?.aborted) return null;
		return this.readHandle(reference, handle, signal);
	}

	async write(
		reference: OpenFabProjectFileReference,
		json: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		throwIfAborted(signal);
		if (!reference.writable) return false;
		const handle = this.handles.get(reference.id) ?? (await this.loadStoredHandle(reference.id));
		if (!handle || !(await ensurePermission(handle, "readwrite"))) return false;
		await writeHandle(handle, json, signal);
		return true;
	}

	async chooseSave(
		suggestedName: string,
		json: string,
		signal?: AbortSignal,
	): Promise<OpenFabProjectFileReference | null> {
		throwIfAborted(signal);
		const safeName = normalizeSuggestedFileName(suggestedName);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserSavePicker>("showSaveFilePicker");
		if (!picker) {
			downloadJsonFile(safeName, json);
			return Object.freeze({
				id: createRuntimeId(),
				name: safeName,
				writable: false,
				reopenable: false,
			});
		}
		try {
			const handle = await picker({ suggestedName: safeName, types: PROJECT_FILE_TYPES });
			throwIfAborted(signal);
			await writeHandle(handle, json, signal);
			return this.rememberHandle(handle);
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return null;
			throw error;
		}
	}

	async chooseImport(signal?: AbortSignal): Promise<OpenFabUserBlueprintFileRead | null> {
		throwIfAborted(signal);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserOpenPicker>("showOpenFilePicker");
		if (!picker) return chooseUserBlueprintOpenWithInput(signal);
		try {
			const handles = await picker({ multiple: false, types: USER_BLUEPRINT_FILE_TYPES });
			throwIfAborted(signal);
			const handle = handles[0];
			if (!handle) return null;
			const file = await handle.getFile();
			assertUserBlueprintFileSize(file.size);
			const json = await file.text();
			throwIfAborted(signal);
			return Object.freeze({ name: file.name, json });
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return null;
			throw error;
		}
	}

	async chooseExport(suggestedName: string, json: string, signal?: AbortSignal): Promise<boolean> {
		throwIfAborted(signal);
		assertUserBlueprintFileSize(openFabUtf8ByteLength(json));
		const safeName = normalizeSuggestedUserBlueprintFileName(suggestedName);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserSavePicker>("showSaveFilePicker");
		if (!picker) {
			downloadJsonFile(safeName, json);
			return true;
		}
		try {
			const handle = await picker({ suggestedName: safeName, types: USER_BLUEPRINT_FILE_TYPES });
			throwIfAborted(signal);
			await writeHandle(handle, json, signal);
			return true;
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return false;
			throw error;
		}
	}

	async chooseLibraryImport(
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintLibraryBundleFileRead | null> {
		throwIfAborted(signal);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserOpenPicker>("showOpenFilePicker");
		if (!picker) return chooseUserBlueprintLibraryOpenWithInput(signal);
		try {
			const handles = await picker({
				multiple: false,
				types: USER_BLUEPRINT_LIBRARY_FILE_TYPES,
			});
			throwIfAborted(signal);
			const handle = handles[0];
			if (!handle) return null;
			const file = await handle.getFile();
			assertUserBlueprintLibraryFileSize(file.size);
			const json = await readUserBlueprintLibraryFileText(file, signal);
			throwIfAborted(signal);
			return Object.freeze({ name: file.name, json });
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return null;
			throw error;
		}
	}

	async chooseLibraryExport(
		suggestedName: string,
		json: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		throwIfAborted(signal);
		assertUserBlueprintLibraryFileSize(openFabUtf8ByteLength(json));
		const safeName = normalizeSuggestedUserBlueprintLibraryFileName(suggestedName);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserSavePicker>("showSaveFilePicker");
		if (!picker) {
			downloadJsonFile(safeName, json);
			return true;
		}
		try {
			const handle = await picker({
				suggestedName: safeName,
				types: USER_BLUEPRINT_LIBRARY_FILE_TYPES,
			});
			throwIfAborted(signal);
			await writeHandle(handle, json, signal);
			return true;
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return false;
			throw error;
		}
	}

	async chooseDiagnosticExport(
		suggestedName: string,
		json: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		throwIfAborted(signal);
		assertUserBlueprintFileSize(openFabUtf8ByteLength(json));
		const safeName = normalizeSuggestedUserBlueprintDiagnosticFileName(suggestedName);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserSavePicker>("showSaveFilePicker");
		if (!picker) {
			downloadJsonFile(safeName, json);
			return true;
		}
		try {
			const handle = await picker({
				suggestedName: safeName,
				types: USER_BLUEPRINT_DIAGNOSTIC_FILE_TYPES,
			});
			throwIfAborted(signal);
			await writeHandle(handle, json, signal);
			return true;
		} catch (error) {
			if (isUserCancellation(error) || signal?.aborted) return false;
			throw error;
		}
	}

	async listRecent(): Promise<readonly OpenFabRecentProject[]> {
		const records = await this.database.getAll<OpenFabRecentProject>(RECENT_STORE);
		return Object.freeze(
			records
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.slice(0, MAX_RECENT_PROJECTS)
				.map(copyRecentProject),
		);
	}

	async putRecent(project: OpenFabRecentProject): Promise<void> {
		const previous = await this.database.get<OpenFabRecentProject>(RECENT_STORE, project.projectId);
		await this.database.put(RECENT_STORE, copyRecentProject(project));
		if (previous?.reference && previous.reference.id !== project.reference?.id) {
			this.handles.delete(previous.reference.id);
			await this.database.delete(HANDLE_STORE, previous.reference.id);
		}
		const records = await this.database.getAll<OpenFabRecentProject>(RECENT_STORE);
		records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		await Promise.all(
			records.slice(MAX_RECENT_PROJECTS).map((record) => this.removeRecent(record.projectId)),
		);
	}

	async removeRecent(projectId: string): Promise<void> {
		const previous = await this.database.get<OpenFabRecentProject>(RECENT_STORE, projectId);
		await this.database.delete(RECENT_STORE, projectId);
		if (previous?.reference) {
			this.handles.delete(previous.reference.id);
			await this.database.delete(HANDLE_STORE, previous.reference.id);
		}
	}

	async listRecovery(
		request: OpenFabRecoveryProjectInventoryRequest = {},
	): Promise<OpenFabRecoveryProjectInventory> {
		const offset = parseRecoveryInventoryOffset(request.offset);
		const stored = await this.database.getAll<unknown>(RECOVERY_SUMMARY_STORE);
		const summaries = stored
			.map(parseRecoveryProjectSummary)
			.filter((summary): summary is OpenFabRecoveryProjectSummary => summary !== null)
			.sort(
				(left, right) =>
					right.updatedAt.localeCompare(left.updatedAt) ||
					left.projectId.localeCompare(right.projectId),
			);
		const latest = summaries[0] ? copyRecoveryProjectSummary(summaries[0]) : null;
		const records = Object.freeze(
			summaries
				.slice(offset, offset + MAX_VISIBLE_RECOVERY_PROJECTS)
				.map(copyRecoveryProjectSummary),
		);
		return Object.freeze({
			latest,
			records,
			totalCount: summaries.length,
			offset,
			pageSize: MAX_VISIBLE_RECOVERY_PROJECTS,
			truncated: offset > 0 || offset + records.length < summaries.length,
		});
	}

	async loadRecovery(projectId: string): Promise<OpenFabRecoveryProject | null> {
		const stored = await this.database.get<unknown>(RECOVERY_STORE, projectId);
		return parseRecoveryProject(stored);
	}

	async loadRecoverySummary(projectId: string): Promise<OpenFabRecoveryProjectSummary | null> {
		const stored = await this.database.get<unknown>(RECOVERY_SUMMARY_STORE, projectId);
		return parseRecoveryProjectSummary(stored);
	}

	async putRecovery(project: OpenFabRecoveryProject): Promise<void> {
		const copied = copyRecoveryProject(project);
		await this.database.putMany([
			Object.freeze({ storeName: RECOVERY_STORE, value: copied }),
			Object.freeze({
				storeName: RECOVERY_SUMMARY_STORE,
				value: summarizeRecoveryProject(copied),
			}),
		]);
	}

	async removeRecovery(projectId: string): Promise<void> {
		await this.database.deleteMany([
			Object.freeze({ storeName: RECOVERY_STORE, key: projectId }),
			Object.freeze({ storeName: RECOVERY_SUMMARY_STORE, key: projectId }),
		]);
	}

	async prepareRecoveryCleanup(
		request: OpenFabRecoveryCleanupRequest,
	): Promise<OpenFabRecoveryCleanupPlan> {
		const stored = await this.database.getAll<unknown>(RECOVERY_SUMMARY_STORE);
		const summaries = stored
			.map(parseRecoveryProjectSummary)
			.filter((summary): summary is OpenFabRecoveryProjectSummary => summary !== null);
		return planOpenFabRecoveryCleanup(summaries, request);
	}

	async applyRecoveryCleanup(
		plan: OpenFabRecoveryCleanupPlan,
	): Promise<OpenFabRecoveryCleanupResult> {
		const current = await this.prepareRecoveryCleanup({
			retainedProjectCount: plan.retainedProjectCount,
			protectedProjectIds: plan.protectedProjectIds,
		});
		if (!recoveryCleanupPlansEqual(plan, current)) {
			return Object.freeze({ status: "conflict", removedCount: 0 });
		}
		const status = await this.database.deleteRecoveriesIfSummariesUnchanged(plan.candidates);
		return status === "removed"
			? Object.freeze({ status, removedCount: plan.removableCount })
			: Object.freeze({ status, removedCount: 0 });
	}

	async list(signal?: AbortSignal): Promise<readonly OpenFabUserBlueprintRecord[]> {
		throwIfAborted(signal);
		const diagnosticGeneration = this.rejectedUserBlueprintGeneration + 1;
		this.rejectedUserBlueprintGeneration = diagnosticGeneration;
		const recoverableDiagnostics: OpenFabUserBlueprintRejectedDiagnostic[] = [];
		const malformedDiagnostics: OpenFabUserBlueprintRejectedDiagnostic[] = [];
		const diagnosticKeys = new Map<string, IDBValidKey>();
		const diagnosticExpectedRecords = new Map<string, OpenFabUserBlueprintRecord>();
		const stored: OpenFabUserBlueprintRecord[] = [];
		const storedIds = new Set<string>();
		let persistentRead = true;
		let rejectedRecordCount = 0;
		let rejectedRecordCountIsLowerBound = false;
		let retainedEdgeCount = 0;
		let retainedJsonBytes = 0;
		let overflowDetected = false;
		let reconciledPersistentMutation = false;
		try {
			const scan = await this.database.scan(
				USER_BLUEPRINT_STORE,
				(value, key) => {
					try {
						const record = parseOpenFabUserBlueprintRecord(value);
						if (storedIds.has(record.id)) return true;
						const nextEdgeCount = retainedEdgeCount + record.blueprint.edges.length;
						const nextJsonBytes =
							retainedJsonBytes + openFabUserBlueprintRecordJsonByteLength(record);
						if (
							stored.length >= OPENFAB_USER_BLUEPRINT_MAX_RECORDS ||
							nextEdgeCount > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES ||
							nextJsonBytes > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES
						) {
							overflowDetected = true;
							rejectedRecordCount += 1;
							if (recoverableDiagnostics.length < OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS) {
								const token = `rejected-${diagnosticGeneration}-${rejectedRecordCount}`;
								recoverableDiagnostics.push(
									createOverflowUserBlueprintDiagnostic(token, rejectedRecordCount),
								);
								diagnosticKeys.set(token, key);
								diagnosticExpectedRecords.set(token, copyOpenFabUserBlueprintRecord(record));
							}
							return true;
						}
						storedIds.add(record.id);
						stored.push(record);
						retainedEdgeCount = nextEdgeCount;
						retainedJsonBytes = nextJsonBytes;
					} catch (error) {
						rejectedRecordCount += 1;
						if (malformedDiagnostics.length < OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS) {
							const token = `rejected-${diagnosticGeneration}-${rejectedRecordCount}`;
							malformedDiagnostics.push(
								createRejectedUserBlueprintDiagnostic(token, rejectedRecordCount, error),
							);
							diagnosticKeys.set(token, key);
						}
					}
					return true;
				},
				USER_BLUEPRINT_LEGACY_SCAN_RECORD_LIMIT,
			);
			overflowDetected ||= scan.truncated;
			rejectedRecordCountIsLowerBound = scan.truncated;
		} catch {
			persistentRead = false;
			// The independently retained session records remain usable while storage reconnects.
		}
		throwIfAborted(signal);
		if (persistentRead && this.volatileDeleteExpectedUserBlueprints.size > 0) {
			for (const [id, expected] of [...this.volatileDeleteExpectedUserBlueprints]) {
				try {
					const status = await this.database.deleteIfUnchanged(USER_BLUEPRINT_STORE, expected);
					this.volatileDeleteExpectedUserBlueprints.delete(id);
					if (status === "conflict") continue;
					if (status === "removed") reconciledPersistentMutation = true;
					storedIds.delete(id);
					const storedIndex = stored.findIndex((record) => record.id === id);
					if (storedIndex >= 0) stored.splice(storedIndex, 1);
				} catch {
					// Keep the delete tombstone hidden and retry it on the next explicit refresh.
				}
			}
		}
		const volatileSnapshot = [...this.volatileUserBlueprints.values()].map(
			copyOpenFabUserBlueprintRecord,
		);
		if (persistentRead && volatileSnapshot.length > 0) {
			for (let snapshotIndex = 0; snapshotIndex < volatileSnapshot.length; snapshotIndex++) {
				const snapshotRecord = volatileSnapshot[snapshotIndex];
				if (!snapshotRecord) continue;
				try {
					let record = snapshotRecord;
					if (this.volatileInsertOnlyUserBlueprintIds.has(record.id)) {
						for (let attempt = 0; attempt < 8; attempt++) {
							let insertStatus: BrowserProjectDatabaseInsertStatus;
							try {
								insertStatus = await this.database.insertIfCapacity(
									USER_BLUEPRINT_STORE,
									record,
									OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
									OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
									(existing) => storedUserBlueprintNameConflicts(existing, record),
									OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
								);
							} catch (error) {
								if (!isIndexedDbConstraintError(error) || record.quickSlot === null) throw error;
								const withoutQuickSlot = updateOpenFabUserBlueprintRecord(record, {
									quickSlot: null,
									updatedAt: record.updatedAt,
								});
								this.replaceVolatileUserBlueprint(record, withoutQuickSlot, true);
								record = withoutQuickSlot;
								continue;
							}
							if (insertStatus === "value-conflict") {
								const recovered = recoverUserBlueprintNameCollision(record, [
									...stored,
									...this.volatileUserBlueprints.values(),
								]);
								this.replaceVolatileUserBlueprint(record, recovered, true);
								record = recovered;
								continue;
							}
							if (insertStatus === "id-conflict") {
								const reassigned = reidentifyOpenFabUserBlueprintRecord(record);
								this.replaceVolatileUserBlueprint(record, reassigned, true);
								record = reassigned;
								continue;
							}
							this.removeVolatileUserBlueprint(record.id);
							storedIds.add(record.id);
							stored.push(copyOpenFabUserBlueprintRecord(record));
							reconciledPersistentMutation = true;
							break;
						}
						continue;
					}
					const expected = this.volatileExpectedUserBlueprints.get(record.id);
					if (!expected) continue;
					let replacement = record;
					let status: BrowserProjectDatabaseReplaceStatus;
					try {
						status = await this.database.replaceIfUnchanged(
							USER_BLUEPRINT_STORE,
							expected,
							replacement,
							OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
							(existing) => storedUserBlueprintNameConflicts(existing, replacement, replacement.id),
							OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
						);
					} catch (error) {
						if (!isIndexedDbConstraintError(error) || replacement.quickSlot === null) throw error;
						replacement = updateOpenFabUserBlueprintRecord(replacement, {
							quickSlot: null,
							updatedAt: replacement.updatedAt,
						});
						this.volatileUserBlueprints.set(
							replacement.id,
							copyOpenFabUserBlueprintRecord(replacement),
						);
						status = await this.database.replaceIfUnchanged(
							USER_BLUEPRINT_STORE,
							expected,
							replacement,
							OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
							(existing) => storedUserBlueprintNameConflicts(existing, replacement, replacement.id),
							OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
						);
					}
					if (status !== "updated") {
						const recovered = reidentifyOpenFabUserBlueprintRecord(
							recoverUserBlueprintNameCollision(
								updateOpenFabUserBlueprintRecord(replacement, {
									quickSlot: null,
									updatedAt: replacement.updatedAt,
								}),
								[...stored, ...this.volatileUserBlueprints.values()],
							),
						);
						this.replaceVolatileUserBlueprint(replacement, recovered, true);
						volatileSnapshot.push(recovered);
						continue;
					}
					const persisted = copyOpenFabUserBlueprintRecord(replacement);
					reconciledPersistentMutation = true;
					this.removeVolatileUserBlueprint(replacement.id);
					const storedIndex = stored.findIndex(({ id }) => id === persisted.id);
					if (storedIndex >= 0) stored[storedIndex] = persisted;
					else stored.push(persisted);
					storedIds.add(persisted.id);
				} catch (error) {
					if (error instanceof BrowserProjectDatabaseCapacityError) overflowDetected = true;
					// Keep the session copy until the next explicit refresh can persist it.
				}
			}
		}
		const presentedVolatileSnapshot = [...this.volatileUserBlueprints.values()].map(
			copyOpenFabUserBlueprintRecord,
		);
		const byId = new Map<string, OpenFabUserBlueprintRecord>();
		for (const record of stored) {
			if (!this.volatileDeleteExpectedUserBlueprints.has(record.id)) byId.set(record.id, record);
		}
		for (const record of presentedVolatileSnapshot) {
			byId.set(record.id, copyOpenFabUserBlueprintRecord(record));
		}
		const quickSlots = new Set<number>();
		const records: OpenFabUserBlueprintRecord[] = [];
		let presentedJsonBytes = 0;
		for (const record of [...byId.values()].sort(compareOpenFabUserBlueprintRecords)) {
			let presented = record;
			if (record.quickSlot !== null) {
				if (quickSlots.has(record.quickSlot)) {
					presented = updateOpenFabUserBlueprintRecord(record, {
						quickSlot: null,
						updatedAt: record.updatedAt,
					});
				} else {
					quickSlots.add(record.quickSlot);
				}
			}
			records.push(copyOpenFabUserBlueprintRecord(presented));
			presentedJsonBytes += openFabUserBlueprintRecordJsonByteLength(presented);
			if (presentedJsonBytes > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES) {
				overflowDetected = true;
			}
			if (records.length === OPENFAB_USER_BLUEPRINT_MAX_RECORDS) break;
		}
		const rejectedDiagnostics = Object.freeze(
			[...recoverableDiagnostics, ...malformedDiagnostics].slice(
				0,
				OPENFAB_USER_BLUEPRINT_MAX_REJECTED_DIAGNOSTICS,
			),
		);
		const rejectedKeys = new Map<string, IDBValidKey>();
		const rejectedExpectedRecords = new Map<string, OpenFabUserBlueprintRecord>();
		for (const diagnostic of rejectedDiagnostics) {
			const key = diagnosticKeys.get(diagnostic.token);
			if (key !== undefined) rejectedKeys.set(diagnostic.token, key);
			const expected = diagnosticExpectedRecords.get(diagnostic.token);
			if (expected) rejectedExpectedRecords.set(diagnostic.token, expected);
		}
		this.userBlueprintStatus = Object.freeze({
			durability:
				persistentRead && !this.hasVolatileUserBlueprintMutations() ? "persistent" : "session-only",
			rejectedRecordCount,
			rejectedRecordCountIsLowerBound,
			diagnosticsTruncated:
				rejectedRecordCountIsLowerBound || rejectedRecordCount > rejectedDiagnostics.length,
			overflowDetected,
		});
		if (persistentRead && this.rejectedUserBlueprintGeneration === diagnosticGeneration) {
			this.rejectedUserBlueprintDiagnostics = rejectedDiagnostics;
			this.rejectedUserBlueprintKeys = rejectedKeys;
			this.rejectedUserBlueprintExpectedRecords = rejectedExpectedRecords;
		}
		if (reconciledPersistentMutation) this.publishUserBlueprintLibraryChange();
		return Object.freeze(records);
	}

	getStatus(): OpenFabUserBlueprintLibraryStatus {
		return Object.freeze({ ...this.userBlueprintStatus });
	}

	getRejectedDiagnostics(): readonly OpenFabUserBlueprintRejectedDiagnostic[] {
		return Object.freeze(
			this.rejectedUserBlueprintDiagnostics.map(copyRejectedUserBlueprintDiagnostic),
		);
	}

	async readRejectedDiagnostic(
		token: string,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintRejectedDiagnosticRead | null> {
		throwIfAborted(signal);
		const key = this.rejectedUserBlueprintKeys.get(token);
		const listed = this.rejectedUserBlueprintDiagnostics.find(
			(diagnostic) => diagnostic.token === token,
		);
		if (key === undefined || !listed) return null;
		const value = await this.database.get<unknown>(USER_BLUEPRINT_STORE, key);
		throwIfAborted(signal);
		if (this.rejectedUserBlueprintKeys.get(token) !== key) return null;
		if (value === null) {
			this.forgetRejectedUserBlueprintDiagnostic(token);
			return null;
		}
		let diagnostic = listed;
		let recoverableRecord: OpenFabUserBlueprintRecord | null = null;
		try {
			recoverableRecord = parseOpenFabUserBlueprintRecord(value);
			if (listed.code !== "LIMIT_EXCEEDED") {
				this.forgetRejectedUserBlueprintDiagnostic(token);
				return null;
			}
			const expected = this.rejectedUserBlueprintExpectedRecords.get(token);
			if (!expected || !userBlueprintRecordsEqual(recoverableRecord, expected)) {
				this.forgetRejectedUserBlueprintDiagnostic(token);
				return null;
			}
		} catch (error) {
			diagnostic = createRejectedUserBlueprintDiagnostic(token, listed.ordinal, error);
		}
		const json = recoverableRecord
			? serializeOpenFabUserBlueprintRecord(recoverableRecord)
			: serializeOpenFabUserBlueprintDiagnosticValue(value);
		return Object.freeze({
			diagnostic,
			json,
			byteLength: openFabUtf8ByteLength(json),
			recoverableRecord: recoverableRecord
				? copyOpenFabUserBlueprintRecord(recoverableRecord)
				: null,
		});
	}

	async removeRejectedDiagnostic(
		token: string,
		expected: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintRejectedDiagnosticRemoveResult> {
		throwIfAborted(signal);
		const key = this.rejectedUserBlueprintKeys.get(token);
		const listed = this.rejectedUserBlueprintDiagnostics.find(
			(diagnostic) => diagnostic.token === token,
		);
		if (key === undefined || !listed) return Object.freeze({ status: "missing" });
		if (listed.code !== "LIMIT_EXCEEDED") {
			return Object.freeze({ status: "not-recoverable" });
		}
		const listedExpected = this.rejectedUserBlueprintExpectedRecords.get(token);
		if (
			this.rejectedUserBlueprintKeys.get(token) !== key ||
			!listedExpected ||
			!userBlueprintRecordsEqual(expected, listedExpected)
		) {
			this.forgetRejectedUserBlueprintDiagnostic(token);
			return Object.freeze({ status: "conflict" });
		}
		const status = await this.database.deleteIfUnchanged(
			USER_BLUEPRINT_STORE,
			copyOpenFabUserBlueprintRecord(expected),
		);
		if (status === "removed" || status === "missing") {
			this.forgetRejectedUserBlueprintDiagnostic(token);
		}
		if (status === "removed") this.publishUserBlueprintLibraryChange();
		return Object.freeze({ status });
	}

	async get(id: string, signal?: AbortSignal): Promise<OpenFabUserBlueprintRecord | null> {
		assertUserBlueprintId(id);
		throwIfAborted(signal);
		if (this.volatileDeleteExpectedUserBlueprints.has(id)) return null;
		const volatile = this.volatileUserBlueprints.get(id);
		if (volatile) return copyOpenFabUserBlueprintRecord(volatile);
		const stored = await this.database.get<unknown>(USER_BLUEPRINT_STORE, id);
		throwIfAborted(signal);
		if (stored === null) return null;
		try {
			return copyOpenFabUserBlueprintRecord(parseOpenFabUserBlueprintRecord(stored));
		} catch {
			return null;
		}
	}

	async insert(
		record: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintInsertResult> {
		const prepared = parseOpenFabUserBlueprintRecord(record);
		throwIfAborted(signal);
		const current = await this.list(signal);
		if (current.some(({ id }) => id === prepared.id)) {
			return Object.freeze({
				status: "id-conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		if (current.some((existing) => openFabUserBlueprintsShareFolderAndName(existing, prepared))) {
			return Object.freeze({
				status: "name-conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		if (
			current.length >= OPENFAB_USER_BLUEPRINT_MAX_RECORDS ||
			this.userBlueprintStatus.overflowDetected
		) {
			throw new Error(
				`User blueprint library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_RECORDS} records.`,
			);
		}
		const projectedEdgeCount =
			current.reduce((total, entry) => total + entry.blueprint.edges.length, 0) +
			prepared.blueprint.edges.length;
		if (projectedEdgeCount > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES) {
			throw new Error(
				`User blueprint library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES.toLocaleString()} directed edges.`,
			);
		}
		const projectedJsonBytes =
			current.reduce((total, entry) => total + openFabUserBlueprintRecordJsonByteLength(entry), 0) +
			openFabUserBlueprintRecordJsonByteLength(prepared);
		if (projectedJsonBytes > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES) {
			throw new Error(
				userBlueprintJsonCapacityMessage(OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES),
			);
		}
		if (
			prepared.quickSlot !== null &&
			current.some(({ quickSlot }) => quickSlot === prepared.quickSlot)
		) {
			return Object.freeze({
				status: "quick-slot-conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		const copy = copyOpenFabUserBlueprintRecord(prepared);
		throwIfAborted(signal);
		try {
			const insertStatus = await this.database.insertIfCapacity(
				USER_BLUEPRINT_STORE,
				copy,
				OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
				(existing) => storedUserBlueprintNameConflicts(existing, copy),
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
			);
			if (insertStatus === "id-conflict") {
				return Object.freeze({ status: "id-conflict", durability: "persistent" });
			}
			if (insertStatus === "value-conflict") {
				return Object.freeze({ status: "name-conflict", durability: "persistent" });
			}
			this.removeVolatileUserBlueprint(prepared.id);
			this.setUserBlueprintDurabilityFromVolatileRecords();
			this.publishUserBlueprintLibraryChange();
			return Object.freeze({ status: "inserted", durability: "persistent" });
		} catch (error) {
			if (isIndexedDbConstraintError(error)) {
				if (prepared.quickSlot !== null) {
					return Object.freeze({ status: "quick-slot-conflict", durability: "persistent" });
				}
				return Object.freeze({ status: "id-conflict", durability: "persistent" });
			}
			if (error instanceof BrowserProjectDatabaseCapacityError) throw error;
			if (this.volatileUserBlueprints.has(prepared.id)) {
				return Object.freeze({ status: "id-conflict", durability: "session-only" });
			}
			this.volatileUserBlueprints.set(prepared.id, copy);
			this.volatileInsertOnlyUserBlueprintIds.add(prepared.id);
			this.setUserBlueprintDurability("session-only");
			return Object.freeze({ status: "inserted", durability: "session-only" });
		}
	}

	async update(
		expected: OpenFabUserBlueprintRecord,
		replacement: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintUpdateResult> {
		const preparedExpected = parseOpenFabUserBlueprintRecord(expected);
		const prepared = parseOpenFabUserBlueprintRecord(replacement);
		if (preparedExpected.id !== prepared.id) {
			throw new TypeError("User blueprint updates cannot change the envelope id.");
		}
		throwIfAborted(signal);
		const current = await this.list(signal);
		const listedPrevious = current.find(({ id }) => id === prepared.id);
		const previous =
			listedPrevious ??
			(this.userBlueprintStatus.durability === "session-only" ? preparedExpected : null);
		if (!previous) {
			return Object.freeze({
				status: "missing",
				durability: this.userBlueprintStatus.durability,
			});
		}
		if (listedPrevious && !userBlueprintRecordsEqual(listedPrevious, preparedExpected)) {
			return Object.freeze({
				status: "conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		if (
			current.some(
				(existing) =>
					existing.id !== prepared.id &&
					openFabUserBlueprintsShareFolderAndName(existing, prepared),
			)
		) {
			return Object.freeze({
				status: "name-conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		const projectedEdgeCount =
			current.reduce((total, entry) => total + entry.blueprint.edges.length, 0) -
			(listedPrevious?.blueprint.edges.length ?? 0) +
			prepared.blueprint.edges.length;
		if (projectedEdgeCount > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES) {
			throw new Error(
				`User blueprint library cannot exceed ${OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES.toLocaleString()} directed edges.`,
			);
		}
		const projectedJsonBytes =
			current.reduce((total, entry) => total + openFabUserBlueprintRecordJsonByteLength(entry), 0) -
			(listedPrevious ? openFabUserBlueprintRecordJsonByteLength(listedPrevious) : 0) +
			openFabUserBlueprintRecordJsonByteLength(prepared);
		if (projectedJsonBytes > OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES) {
			throw new Error(
				userBlueprintJsonCapacityMessage(OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES),
			);
		}
		if (
			prepared.quickSlot !== null &&
			current.some(
				(existing) => existing.id !== prepared.id && existing.quickSlot === prepared.quickSlot,
			)
		) {
			return Object.freeze({
				status: "quick-slot-conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		const copy = copyOpenFabUserBlueprintRecord(prepared);
		throwIfAborted(signal);
		try {
			const status = await this.database.replaceIfUnchanged(
				USER_BLUEPRINT_STORE,
				preparedExpected,
				copy,
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
				(existing) => storedUserBlueprintNameConflicts(existing, copy, copy.id),
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
			);
			if (status === "value-conflict") {
				return Object.freeze({ status: "name-conflict", durability: "persistent" });
			}
			if (status !== "updated") {
				return Object.freeze({ status, durability: "persistent" });
			}
			this.removeVolatileUserBlueprint(prepared.id);
			this.setUserBlueprintDurabilityFromVolatileRecords();
			this.publishUserBlueprintLibraryChange();
			return Object.freeze({ status: "updated", durability: "persistent" });
		} catch (error) {
			if (isIndexedDbConstraintError(error) && prepared.quickSlot !== null) {
				return Object.freeze({ status: "quick-slot-conflict", durability: "persistent" });
			}
			if (error instanceof BrowserProjectDatabaseCapacityError) throw error;
			this.volatileUserBlueprints.set(prepared.id, copy);
			this.volatileInsertOnlyUserBlueprintIds.delete(prepared.id);
			if (!this.volatileExpectedUserBlueprints.has(prepared.id)) {
				this.volatileExpectedUserBlueprints.set(
					prepared.id,
					copyOpenFabUserBlueprintRecord(preparedExpected),
				);
			}
			this.setUserBlueprintDurability("session-only");
			return Object.freeze({ status: "updated", durability: "session-only" });
		}
	}

	async remove(
		expected: OpenFabUserBlueprintRecord,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintRemoveResult> {
		const preparedExpected = parseOpenFabUserBlueprintRecord(expected);
		const id = preparedExpected.id;
		throwIfAborted(signal);
		const current = (await this.list(signal)).find((record) => record.id === id);
		if (!current) {
			return Object.freeze({
				status: "missing",
				durability: this.userBlueprintStatus.durability,
			});
		}
		if (!userBlueprintRecordsEqual(current, preparedExpected)) {
			return Object.freeze({
				status: "conflict",
				durability: this.userBlueprintStatus.durability,
			});
		}
		const hadVolatileRecord = this.volatileUserBlueprints.has(id);
		try {
			const status = await this.database.deleteIfUnchanged(USER_BLUEPRINT_STORE, preparedExpected);
			if (status !== "removed") {
				return Object.freeze({ status, durability: "persistent" });
			}
			this.removeVolatileUserBlueprint(id);
			this.volatileDeleteExpectedUserBlueprints.delete(id);
			this.setUserBlueprintDurabilityFromVolatileRecords();
			this.publishUserBlueprintLibraryChange();
			return Object.freeze({ status: "removed", durability: "persistent" });
		} catch (error) {
			if (!hadVolatileRecord) throw error;
			const insertOnly = this.volatileInsertOnlyUserBlueprintIds.has(id);
			const persistentExpected = this.volatileExpectedUserBlueprints.get(id);
			this.removeVolatileUserBlueprint(id);
			if (!insertOnly) {
				this.volatileDeleteExpectedUserBlueprints.set(
					id,
					copyOpenFabUserBlueprintRecord(persistentExpected ?? preparedExpected),
				);
			}
			this.setUserBlueprintDurability("session-only");
			return Object.freeze({ status: "removed", durability: "session-only" });
		}
	}

	async replaceAllIfUnchanged(
		expected: readonly OpenFabUserBlueprintRecord[],
		replacement: readonly OpenFabUserBlueprintRecord[],
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintReplaceAllResult> {
		const preparedExpected = validateOpenFabUserBlueprintLibrarySnapshot(expected);
		const preparedReplacement = validateOpenFabUserBlueprintLibrarySnapshot(replacement);
		return this.replacePreparedAllIfUnchanged(preparedExpected, preparedReplacement, signal, false);
	}

	async replacePreparedRestoreIfUnchanged(
		plan: OpenFabUserBlueprintLibraryRestorePlan,
		signal?: AbortSignal,
	): Promise<OpenFabUserBlueprintReplaceAllResult> {
		const permit = consumePreparedUserBlueprintLibraryRestore(plan);
		if (!permit) {
			throw new TypeError(
				"Blueprint library restore plan was not prepared by the active Worker bridge.",
			);
		}
		return this.replacePreparedAllIfUnchanged(
			permit.expectedRecords,
			permit.replacementRecords,
			signal,
			true,
		);
	}

	private async replacePreparedAllIfUnchanged(
		preparedExpected: readonly OpenFabUserBlueprintRecord[],
		preparedReplacement: readonly OpenFabUserBlueprintRecord[],
		signal: AbortSignal | undefined,
		workerPrepared: boolean,
	): Promise<OpenFabUserBlueprintReplaceAllResult> {
		throwIfAborted(signal);
		const current = workerPrepared ? null : await this.list(signal);
		const storageStatus = this.getStatus();
		if (storageStatus.durability !== "persistent") {
			return Object.freeze({ status: "storage-unavailable" });
		}
		if (
			storageStatus.rejectedRecordCount > 0 ||
			storageStatus.rejectedRecordCountIsLowerBound ||
			storageStatus.diagnosticsTruncated ||
			storageStatus.overflowDetected
		) {
			return Object.freeze({ status: "storage-invalid" });
		}
		if (
			!workerPrepared &&
			current &&
			!userBlueprintLibrarySnapshotsEqual(current, preparedExpected)
		) {
			return Object.freeze({ status: "conflict" });
		}
		throwIfAborted(signal);
		try {
			const status = await this.database.replaceAllIfUnchanged(
				USER_BLUEPRINT_STORE,
				preparedExpected,
				preparedReplacement,
				OPENFAB_USER_BLUEPRINT_MAX_RECORDS,
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES,
				OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES,
				workerPrepared,
			);
			if (status !== "replaced") return Object.freeze({ status: "conflict" });
			this.volatileUserBlueprints.clear();
			this.volatileInsertOnlyUserBlueprintIds.clear();
			this.volatileExpectedUserBlueprints.clear();
			this.volatileDeleteExpectedUserBlueprints.clear();
			this.rejectedUserBlueprintDiagnostics = Object.freeze([]);
			this.rejectedUserBlueprintKeys.clear();
			this.rejectedUserBlueprintExpectedRecords.clear();
			this.userBlueprintStatus = Object.freeze({
				durability: "persistent",
				rejectedRecordCount: 0,
				rejectedRecordCountIsLowerBound: false,
				diagnosticsTruncated: false,
				overflowDetected: false,
			});
			this.publishUserBlueprintLibraryChange();
			return Object.freeze({ status: "replaced" });
		} catch (error) {
			if (error instanceof BrowserProjectDatabaseUnavailableError) {
				return Object.freeze({ status: "storage-unavailable" });
			}
			throw error;
		}
	}

	private publishUserBlueprintLibraryChange(): void {
		try {
			this.userBlueprintLibraryChanges?.publishChange();
		} catch {
			// Persistence is authoritative. A best-effort notification failure cannot roll back or
			// misreport the already committed IndexedDB transaction.
		}
	}

	private replaceVolatileUserBlueprint(
		previous: OpenFabUserBlueprintRecord,
		replacement: OpenFabUserBlueprintRecord,
		insertOnly: boolean,
	): void {
		this.removeVolatileUserBlueprint(previous.id);
		this.volatileUserBlueprints.set(replacement.id, copyOpenFabUserBlueprintRecord(replacement));
		if (insertOnly) this.volatileInsertOnlyUserBlueprintIds.add(replacement.id);
	}

	private removeVolatileUserBlueprint(id: string): void {
		this.volatileUserBlueprints.delete(id);
		this.volatileInsertOnlyUserBlueprintIds.delete(id);
		this.volatileExpectedUserBlueprints.delete(id);
	}

	private setUserBlueprintDurability(durability: OpenFabUserBlueprintMutationDurability): void {
		this.userBlueprintStatus = Object.freeze({
			...this.userBlueprintStatus,
			durability,
		});
	}

	private setUserBlueprintDurabilityFromVolatileRecords(): void {
		this.setUserBlueprintDurability(
			this.hasVolatileUserBlueprintMutations() ? "session-only" : "persistent",
		);
	}

	private hasVolatileUserBlueprintMutations(): boolean {
		return (
			this.volatileUserBlueprints.size > 0 || this.volatileDeleteExpectedUserBlueprints.size > 0
		);
	}

	private forgetRejectedUserBlueprintDiagnostic(token: string): void {
		this.rejectedUserBlueprintKeys.delete(token);
		this.rejectedUserBlueprintExpectedRecords.delete(token);
		this.rejectedUserBlueprintDiagnostics = Object.freeze(
			this.rejectedUserBlueprintDiagnostics.filter((diagnostic) => diagnostic.token !== token),
		);
	}

	private async rememberHandle(handle: BrowserFileHandle): Promise<OpenFabProjectFileReference> {
		const id = createRuntimeId();
		this.handles.set(id, handle);
		let reopenable = true;
		try {
			await this.database.put(HANDLE_STORE, {
				id,
				name: handle.name,
				handle,
			} satisfies StoredHandle);
		} catch {
			// The file is already open and remains writable for this session even if
			// the browser cannot structured-clone its handle into IndexedDB.
			reopenable = false;
		}
		return Object.freeze({ id, name: handle.name, writable: true, reopenable });
	}

	private async loadStoredHandle(id: string): Promise<BrowserFileHandle | null> {
		const stored = await this.database.get<StoredHandle>(HANDLE_STORE, id);
		if (!stored?.handle) return null;
		this.handles.set(id, stored.handle);
		return stored.handle;
	}

	private async readHandle(
		reference: OpenFabProjectFileReference,
		handle: BrowserFileHandle,
		signal?: AbortSignal,
	): Promise<OpenFabProjectFileRead> {
		const file = await handle.getFile();
		throwIfAborted(signal);
		assertProjectFileSize(file.size);
		const json = await file.text();
		throwIfAborted(signal);
		return Object.freeze({ reference, json });
	}
}

class BrowserProjectDatabase implements BrowserProjectDatabasePort {
	private pending: Promise<IDBDatabase | null> | null = null;
	private database: IDBDatabase | null = null;
	private blockedAttemptActive = false;

	async get<Value>(storeName: string, key: IDBValidKey): Promise<Value | null> {
		return this.request(storeName, "readonly", (store) => store.get(key));
	}

	async getAll<Value>(storeName: string, count?: number): Promise<Value[]> {
		return (
			(await this.request<Value[]>(storeName, "readonly", (store) =>
				count === undefined ? store.getAll() : store.getAll(undefined, count),
			)) ?? []
		);
	}

	async scan(
		storeName: string,
		visit: (value: unknown, key: IDBValidKey) => boolean,
		maximumRecords: number,
	): Promise<BrowserProjectDatabaseScanResult> {
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		return new Promise<BrowserProjectDatabaseScanResult>((resolve, reject) => {
			const transaction = database.transaction(storeName, "readonly");
			const request = transaction.objectStore(storeName).openCursor();
			let visited = 0;
			let truncated = false;
			let explicitError: Error | null = null;
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return;
				if (visited >= maximumRecords) {
					truncated = true;
					return;
				}
				visited += 1;
				try {
					if (!visit(cursor.value, cursor.primaryKey)) {
						truncated = true;
						return;
					}
				} catch (error) {
					explicitError = normalizeDatabaseError(error, "IndexedDB scan visitor failed.");
					transaction.abort();
					return;
				}
				cursor.continue();
			};
			request.onerror = () => {
				explicitError = request.error ?? new Error("IndexedDB cursor scan failed.");
			};
			transaction.oncomplete = () => resolve(Object.freeze({ visited, truncated }));
			transaction.onerror = () =>
				reject(explicitError ?? transaction.error ?? new Error("IndexedDB scan failed."));
			transaction.onabort = () =>
				reject(explicitError ?? transaction.error ?? new Error("IndexedDB scan was aborted."));
		});
	}

	async put(storeName: string, value: unknown): Promise<void> {
		await this.request(storeName, "readwrite", (store) => store.put(value));
	}

	async putMany(records: readonly BrowserProjectDatabaseStoreValue[]): Promise<void> {
		if (records.length === 0) return;
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(
				[...new Set(records.map((record) => record.storeName))],
				"readwrite",
			);
			let explicitError: Error | null = null;
			for (const record of records) {
				const request = transaction.objectStore(record.storeName).put(record.value);
				request.onerror = () => {
					explicitError = request.error ?? new Error("IndexedDB multi-store put failed.");
				};
			}
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB multi-store put failed."),
				);
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB multi-store put aborted."),
				);
		});
	}

	async insertIfCapacity(
		storeName: string,
		value: unknown,
		maximumRecords: number,
		maximumTotalEdges?: number,
		conflictsWith?: BrowserProjectDatabaseConflictPredicate,
		maximumTotalJsonBytes?: number,
	): Promise<BrowserProjectDatabaseInsertStatus> {
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		if (!isObjectRecord(value) || typeof value.id !== "string") {
			throw new TypeError("Capacity-guarded IndexedDB values require a string id.");
		}
		const id = value.id;
		const edgeLimit = maximumTotalEdges;
		const jsonByteLimit = maximumTotalJsonBytes;
		return new Promise<BrowserProjectDatabaseInsertStatus>((resolve, reject) => {
			const transaction = database.transaction(storeName, "readwrite");
			const store = transaction.objectStore(storeName);
			let explicitError: Error | null = null;
			let status: BrowserProjectDatabaseInsertStatus = "id-conflict";
			const addValue = (): void => {
				const request = store.add(value);
				request.onsuccess = () => {
					status = "inserted";
				};
				request.onerror = () => {
					explicitError = request.error ?? new Error("IndexedDB add failed.");
				};
			};
			transaction.oncomplete = () => resolve(status);
			transaction.onerror = () =>
				reject(explicitError ?? transaction.error ?? new Error("IndexedDB transaction failed."));
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB transaction was aborted."),
				);
			const existing = store.get(id);
			existing.onsuccess = () => {
				if (existing.result !== undefined) return;
				const count = store.count();
				count.onsuccess = () => {
					if (count.result >= maximumRecords) {
						explicitError = new BrowserProjectDatabaseCapacityError("records", maximumRecords);
						transaction.abort();
						return;
					}
					if (edgeLimit === undefined && !conflictsWith && jsonByteLimit === undefined) {
						addValue();
						return;
					}
					const incomingEdges =
						edgeLimit === undefined ? 0 : storedUserBlueprintEdgeCount(value, edgeLimit);
					const incomingJsonBytes =
						jsonByteLimit === undefined
							? 0
							: storedUserBlueprintJsonByteLength(value, jsonByteLimit);
					let aggregateEdges = 0;
					let aggregateJsonBytes = 0;
					const cursor = store.openCursor();
					cursor.onsuccess = () => {
						const current = cursor.result;
						if (!current) {
							if (edgeLimit !== undefined && aggregateEdges + incomingEdges > edgeLimit) {
								explicitError = new BrowserProjectDatabaseCapacityError("edges", edgeLimit);
								transaction.abort();
								return;
							}
							if (
								jsonByteLimit !== undefined &&
								aggregateJsonBytes + incomingJsonBytes > jsonByteLimit
							) {
								explicitError = new BrowserProjectDatabaseCapacityError(
									"json-bytes",
									jsonByteLimit,
								);
								transaction.abort();
								return;
							}
							addValue();
							return;
						}
						try {
							if (conflictsWith?.(current.value)) {
								status = "value-conflict";
								return;
							}
						} catch (error) {
							explicitError = normalizeDatabaseError(
								error,
								"IndexedDB guarded insert conflict check failed.",
							);
							transaction.abort();
							return;
						}
						if (edgeLimit !== undefined) {
							aggregateEdges += storedUserBlueprintEdgeCount(current.value, edgeLimit);
						}
						if (jsonByteLimit !== undefined) {
							aggregateJsonBytes += storedUserBlueprintJsonByteLength(current.value, jsonByteLimit);
						}
						if (edgeLimit !== undefined && aggregateEdges + incomingEdges > edgeLimit) {
							explicitError = new BrowserProjectDatabaseCapacityError("edges", edgeLimit);
							transaction.abort();
							return;
						}
						if (
							jsonByteLimit !== undefined &&
							aggregateJsonBytes + incomingJsonBytes > jsonByteLimit
						) {
							explicitError = new BrowserProjectDatabaseCapacityError("json-bytes", jsonByteLimit);
							transaction.abort();
							return;
						}
						current.continue();
					};
					cursor.onerror = () => {
						explicitError = cursor.error ?? new Error("IndexedDB guarded insert scan failed.");
					};
				};
				count.onerror = () => {
					explicitError = count.error ?? new Error("IndexedDB capacity count failed.");
				};
			};
			existing.onerror = () => {
				explicitError = existing.error ?? new Error("IndexedDB capacity lookup failed.");
			};
		});
	}

	async replaceIfUnchanged(
		storeName: string,
		expected: unknown,
		replacement: unknown,
		maximumTotalEdges?: number,
		conflictsWith?: BrowserProjectDatabaseConflictPredicate,
		maximumTotalJsonBytes?: number,
	): Promise<BrowserProjectDatabaseReplaceStatus> {
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		if (
			!isObjectRecord(expected) ||
			typeof expected.id !== "string" ||
			!isObjectRecord(replacement) ||
			replacement.id !== expected.id
		) {
			throw new TypeError("Conditional IndexedDB replacement requires one matching string id.");
		}
		const expectedId = expected.id;
		const edgeLimit = maximumTotalEdges;
		const jsonByteLimit = maximumTotalJsonBytes;
		return new Promise<BrowserProjectDatabaseReplaceStatus>((resolve, reject) => {
			const transaction = database.transaction(storeName, "readwrite");
			const store = transaction.objectStore(storeName);
			let explicitError: Error | null = null;
			let status: BrowserProjectDatabaseReplaceStatus = "missing";
			const putReplacement = (): void => {
				const request = store.put(replacement);
				request.onsuccess = () => {
					status = "updated";
				};
				request.onerror = () => {
					explicitError = request.error ?? new Error("IndexedDB conditional put failed.");
				};
			};
			transaction.oncomplete = () => resolve(status);
			transaction.onerror = () =>
				reject(explicitError ?? transaction.error ?? new Error("IndexedDB transaction failed."));
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB transaction was aborted."),
				);
			const current = store.get(expectedId);
			current.onsuccess = () => {
				if (current.result === undefined) return;
				if (!userBlueprintRecordsEqual(current.result, expected)) {
					status = "conflict";
					return;
				}
				if (edgeLimit === undefined && !conflictsWith && jsonByteLimit === undefined) {
					putReplacement();
					return;
				}
				const previousEdges =
					edgeLimit === undefined ? 0 : storedUserBlueprintEdgeCount(current.result, edgeLimit);
				const incomingEdges =
					edgeLimit === undefined ? 0 : storedUserBlueprintEdgeCount(replacement, edgeLimit);
				const previousJsonBytes =
					jsonByteLimit === undefined
						? 0
						: storedUserBlueprintJsonByteLength(current.result, jsonByteLimit);
				const incomingJsonBytes =
					jsonByteLimit === undefined
						? 0
						: storedUserBlueprintJsonByteLength(replacement, jsonByteLimit);
				let aggregateEdges = 0;
				let aggregateJsonBytes = 0;
				const cursor = store.openCursor();
				cursor.onsuccess = () => {
					const entry = cursor.result;
					if (!entry) {
						if (
							edgeLimit !== undefined &&
							aggregateEdges - previousEdges + incomingEdges > edgeLimit
						) {
							explicitError = new BrowserProjectDatabaseCapacityError("edges", edgeLimit);
							transaction.abort();
							return;
						}
						if (
							jsonByteLimit !== undefined &&
							aggregateJsonBytes - previousJsonBytes + incomingJsonBytes > jsonByteLimit
						) {
							explicitError = new BrowserProjectDatabaseCapacityError("json-bytes", jsonByteLimit);
							transaction.abort();
							return;
						}
						putReplacement();
						return;
					}
					try {
						if (conflictsWith?.(entry.value)) {
							status = "value-conflict";
							return;
						}
					} catch (error) {
						explicitError = normalizeDatabaseError(
							error,
							"IndexedDB guarded replacement conflict check failed.",
						);
						transaction.abort();
						return;
					}
					if (edgeLimit !== undefined) {
						aggregateEdges += storedUserBlueprintEdgeCount(entry.value, edgeLimit);
					}
					if (jsonByteLimit !== undefined) {
						aggregateJsonBytes += storedUserBlueprintJsonByteLength(entry.value, jsonByteLimit);
					}
					if (edgeLimit !== undefined && aggregateEdges > edgeLimit + previousEdges) {
						explicitError = new BrowserProjectDatabaseCapacityError("edges", edgeLimit);
						transaction.abort();
						return;
					}
					if (
						jsonByteLimit !== undefined &&
						aggregateJsonBytes > jsonByteLimit + previousJsonBytes
					) {
						explicitError = new BrowserProjectDatabaseCapacityError("json-bytes", jsonByteLimit);
						transaction.abort();
						return;
					}
					entry.continue();
				};
				cursor.onerror = () => {
					explicitError = cursor.error ?? new Error("IndexedDB guarded replacement scan failed.");
				};
			};
			current.onerror = () => {
				explicitError = current.error ?? new Error("IndexedDB conditional lookup failed.");
			};
		});
	}

	async deleteIfUnchanged(
		storeName: string,
		expected: unknown,
	): Promise<"removed" | "missing" | "conflict"> {
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		if (!isObjectRecord(expected) || typeof expected.id !== "string") {
			throw new TypeError("Conditional IndexedDB deletion requires a string id.");
		}
		const expectedId = expected.id;
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(storeName, "readwrite");
			const store = transaction.objectStore(storeName);
			let explicitError: Error | null = null;
			let status: "removed" | "missing" | "conflict" = "missing";
			transaction.oncomplete = () => resolve(status);
			transaction.onerror = () =>
				reject(explicitError ?? transaction.error ?? new Error("IndexedDB transaction failed."));
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB transaction was aborted."),
				);
			const current = store.get(expectedId);
			current.onsuccess = () => {
				if (current.result === undefined) return;
				if (!userBlueprintRecordsEqual(current.result, expected)) {
					status = "conflict";
					return;
				}
				const request = store.delete(expectedId);
				request.onsuccess = () => {
					status = "removed";
				};
				request.onerror = () => {
					explicitError = request.error ?? new Error("IndexedDB conditional delete failed.");
				};
			};
			current.onerror = () => {
				explicitError = current.error ?? new Error("IndexedDB conditional lookup failed.");
			};
		});
	}

	async replaceAllIfUnchanged(
		storeName: string,
		expected: readonly unknown[],
		replacement: readonly unknown[],
		maximumRecords: number,
		maximumTotalEdges: number,
		maximumTotalJsonBytes: number,
		prevalidated = false,
	): Promise<BrowserProjectDatabaseReplaceAllStatus> {
		if (storeName !== USER_BLUEPRINT_STORE) {
			throw new TypeError("Atomic library replacement is limited to user blueprints.");
		}
		if (
			maximumRecords !== OPENFAB_USER_BLUEPRINT_MAX_RECORDS ||
			maximumTotalEdges !== OPENFAB_USER_BLUEPRINT_MAX_TOTAL_EDGES ||
			maximumTotalJsonBytes !== OPENFAB_USER_BLUEPRINT_MAX_TOTAL_JSON_BYTES
		) {
			throw new TypeError("Atomic library replacement requires the canonical library limits.");
		}
		const preparedExpected = prevalidated
			? (expected as readonly OpenFabUserBlueprintRecord[])
			: validateOpenFabUserBlueprintLibrarySnapshot(
					expected as readonly OpenFabUserBlueprintRecord[],
				);
		const preparedReplacement = prevalidated
			? (replacement as readonly OpenFabUserBlueprintRecord[])
			: validateOpenFabUserBlueprintLibrarySnapshot(
					replacement as readonly OpenFabUserBlueprintRecord[],
				);
		const expectedById = new Map(preparedExpected.map((record) => [record.id, record] as const));
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		return new Promise<BrowserProjectDatabaseReplaceAllStatus>((resolve, reject) => {
			const transaction = database.transaction(storeName, "readwrite");
			const store = transaction.objectStore(storeName);
			let explicitError: Error | null = null;
			let status: BrowserProjectDatabaseReplaceAllStatus = "conflict";
			let visited = 0;
			const cursorRequest = store.openCursor();
			transaction.oncomplete = () => resolve(status);
			transaction.onerror = () =>
				reject(explicitError ?? transaction.error ?? new Error("IndexedDB transaction failed."));
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB transaction was aborted."),
				);
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (cursor) {
					visited += 1;
					const value = cursor.value as unknown;
					const id = isObjectRecord(value) && typeof value.id === "string" ? value.id : null;
					const expectedRecord = id === null ? null : expectedById.get(id);
					if (
						visited > maximumRecords ||
						!expectedRecord ||
						!userBlueprintRecordsEqual(value, expectedRecord)
					) {
						return;
					}
					cursor.continue();
					return;
				}
				if (visited !== preparedExpected.length) return;
				const clearRequest = store.clear();
				clearRequest.onerror = () => {
					explicitError = clearRequest.error ?? new Error("IndexedDB library clear failed.");
				};
				clearRequest.onsuccess = () => {
					if (preparedReplacement.length === 0) {
						status = "replaced";
						return;
					}
					let inserted = 0;
					for (const record of preparedReplacement) {
						const addRequest = store.add(record);
						addRequest.onsuccess = () => {
							inserted += 1;
							if (inserted === preparedReplacement.length) status = "replaced";
						};
						addRequest.onerror = () => {
							explicitError =
								addRequest.error ?? new Error("IndexedDB library replacement add failed.");
						};
					}
				};
			};
			cursorRequest.onerror = () => {
				explicitError = cursorRequest.error ?? new Error("IndexedDB library scan failed.");
			};
		});
	}

	async delete(storeName: string, key: IDBValidKey): Promise<void> {
		await this.request(storeName, "readwrite", (store) => store.delete(key));
	}

	async deleteMany(records: readonly BrowserProjectDatabaseStoreKey[]): Promise<void> {
		if (records.length === 0) return;
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(
				[...new Set(records.map((record) => record.storeName))],
				"readwrite",
			);
			let explicitError: Error | null = null;
			for (const record of records) {
				const request = transaction.objectStore(record.storeName).delete(record.key);
				request.onerror = () => {
					explicitError = request.error ?? new Error("IndexedDB multi-store delete failed.");
				};
			}
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB multi-store delete failed."),
				);
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB multi-store delete aborted."),
				);
		});
	}

	async deleteRecoveriesIfSummariesUnchanged(
		expected: readonly OpenFabRecoveryProjectSummary[],
	): Promise<"removed" | "conflict"> {
		if (expected.length === 0) return "removed";
		const expectedById = new Map(expected.map((summary) => [summary.projectId, summary] as const));
		if (expectedById.size !== expected.length) {
			throw new TypeError("Recovery cleanup candidates must have unique project ids.");
		}
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(
				[RECOVERY_SUMMARY_STORE, RECOVERY_STORE],
				"readwrite",
			);
			const summaryStore = transaction.objectStore(RECOVERY_SUMMARY_STORE);
			const payloadStore = transaction.objectStore(RECOVERY_STORE);
			const cursorRequest = summaryStore.openCursor();
			let explicitError: Error | null = null;
			let matched = 0;
			let status: "removed" | "conflict" = "conflict";
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (cursor) {
					const projectId =
						isObjectRecord(cursor.value) && typeof cursor.value.projectId === "string"
							? cursor.value.projectId
							: null;
					const expectedSummary = projectId ? expectedById.get(projectId) : undefined;
					if (expectedSummary) {
						const current = parseRecoveryProjectSummary(cursor.value);
						if (!current || !recoveryProjectSummariesEqual(expectedSummary, current)) return;
						matched += 1;
					}
					cursor.continue();
					return;
				}
				if (matched !== expected.length) return;
				for (const summary of expected) {
					const deleteSummary = summaryStore.delete(summary.projectId);
					deleteSummary.onerror = () => {
						explicitError =
							deleteSummary.error ?? new Error("IndexedDB recovery summary cleanup failed.");
					};
					const deletePayload = payloadStore.delete(summary.projectId);
					deletePayload.onerror = () => {
						explicitError =
							deletePayload.error ?? new Error("IndexedDB recovery payload cleanup failed.");
					};
				}
				status = "removed";
			};
			cursorRequest.onerror = () => {
				explicitError = cursorRequest.error ?? new Error("IndexedDB recovery cleanup scan failed.");
			};
			transaction.oncomplete = () => resolve(status);
			transaction.onerror = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB recovery cleanup failed."),
				);
			transaction.onabort = () =>
				reject(
					explicitError ?? transaction.error ?? new Error("IndexedDB recovery cleanup aborted."),
				);
		});
	}

	private async request<Value>(
		storeName: string,
		mode: IDBTransactionMode,
		operation: (store: IDBObjectStore) => IDBRequest,
	): Promise<Value | null> {
		const database = await this.open();
		if (!database) throw new BrowserProjectDatabaseUnavailableError();
		return new Promise<Value | null>((resolve, reject) => {
			const transaction = database.transaction(storeName, mode);
			const request = operation(transaction.objectStore(storeName));
			let result: Value | null = null;
			request.onsuccess = () => {
				result = (request.result as Value | undefined) ?? null;
			};
			request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
			transaction.oncomplete = () => resolve(result);
			transaction.onerror = () =>
				reject(transaction.error ?? new Error("IndexedDB transaction failed."));
			transaction.onabort = () =>
				reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
		});
	}

	private open(): Promise<IDBDatabase | null> {
		if (this.database) return Promise.resolve(this.database);
		if (this.pending) return this.pending;
		if (this.blockedAttemptActive) return Promise.resolve(null);
		if (typeof indexedDB === "undefined") return Promise.resolve(null);
		const attempt = new Promise<IDBDatabase | null>((resolve) => {
			let request: IDBOpenDBRequest;
			try {
				request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
			} catch {
				resolve(null);
				return;
			}
			let settled = false;
			let blockedTimer: number | null = null;
			const settle = (database: IDBDatabase | null): void => {
				if (settled) {
					database?.close();
					return;
				}
				settled = true;
				if (blockedTimer !== null) globalThis.clearTimeout(blockedTimer);
				resolve(database);
			};
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(HANDLE_STORE)) {
					database.createObjectStore(HANDLE_STORE, { keyPath: "id" });
				}
				if (!database.objectStoreNames.contains(RECENT_STORE)) {
					database.createObjectStore(RECENT_STORE, { keyPath: "projectId" });
				}
				if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
					database.createObjectStore(RECOVERY_STORE, { keyPath: "projectId" });
				}
				const recoverySummaryStore = database.objectStoreNames.contains(RECOVERY_SUMMARY_STORE)
					? request.transaction?.objectStore(RECOVERY_SUMMARY_STORE)
					: database.createObjectStore(RECOVERY_SUMMARY_STORE, { keyPath: "projectId" });
				const recoveryPayloadStore = request.transaction?.objectStore(RECOVERY_STORE);
				if (recoverySummaryStore && recoveryPayloadStore) {
					const recoveryCursor = recoveryPayloadStore.openCursor();
					recoveryCursor.onsuccess = () => {
						const cursor = recoveryCursor.result;
						if (!cursor) return;
						const project = parseRecoveryProject(cursor.value);
						if (project) recoverySummaryStore.put(summarizeRecoveryProject(project));
						cursor.continue();
					};
					recoveryCursor.onerror = () => request.transaction?.abort();
				}
				const userBlueprintStore = database.objectStoreNames.contains(USER_BLUEPRINT_STORE)
					? request.transaction?.objectStore(USER_BLUEPRINT_STORE)
					: database.createObjectStore(USER_BLUEPRINT_STORE, { keyPath: "id" });
				if (userBlueprintStore) ensureUniqueUserBlueprintQuickSlotIndex(userBlueprintStore);
			};
			request.onsuccess = () => {
				const database = request.result;
				this.blockedAttemptActive = false;
				if (this.database && this.database !== database) {
					database.close();
					return;
				}
				this.database = database;
				database.onversionchange = () => {
					database.close();
					if (this.database === database) this.database = null;
				};
				if (!settled) settle(database);
			};
			request.onerror = () => {
				this.blockedAttemptActive = false;
				settle(null);
			};
			request.onblocked = () => {
				this.blockedAttemptActive = true;
				if (blockedTimer !== null) return;
				blockedTimer = globalThis.setTimeout(
					() => settle(null),
					DATABASE_BLOCKED_FALLBACK_MILLISECONDS,
				);
			};
		});
		this.pending = attempt;
		const clearPending = (): void => {
			if (this.pending === attempt) this.pending = null;
		};
		void attempt.then(clearPending, clearPending);
		return attempt;
	}
}

class BrowserProjectDatabaseUnavailableError extends Error {
	constructor() {
		super("Browser project database is unavailable.");
		this.name = "BrowserProjectDatabaseUnavailableError";
	}
}

class BrowserProjectDatabaseCapacityError extends Error {
	constructor(kind: "records" | "edges" | "json-bytes", maximum: number) {
		super(
			kind === "records"
				? `User blueprint library cannot exceed ${maximum} records.`
				: kind === "edges"
					? `User blueprint library cannot exceed ${maximum.toLocaleString()} directed edges.`
					: userBlueprintJsonCapacityMessage(maximum),
		);
		this.name = "BrowserProjectDatabaseCapacityError";
	}
}

function userBlueprintRecordsEqual(left: unknown, right: unknown): boolean {
	try {
		return (
			JSON.stringify(parseOpenFabUserBlueprintRecord(left)) ===
			JSON.stringify(parseOpenFabUserBlueprintRecord(right))
		);
	} catch {
		return false;
	}
}

function userBlueprintLibrarySnapshotsEqual(
	left: readonly OpenFabUserBlueprintRecord[],
	right: readonly OpenFabUserBlueprintRecord[],
): boolean {
	if (left.length !== right.length) return false;
	const rightById = new Map(right.map((record) => [record.id, record] as const));
	return left.every((record) => {
		const expected = rightById.get(record.id);
		return expected !== undefined && userBlueprintRecordsEqual(record, expected);
	});
}

function storedUserBlueprintNameConflicts(
	value: unknown,
	candidate: OpenFabUserBlueprintRecord,
	excludedId?: string,
): boolean {
	try {
		const stored = parseOpenFabUserBlueprintRecord(value);
		return stored.id !== excludedId && openFabUserBlueprintsShareFolderAndName(stored, candidate);
	} catch {
		return false;
	}
}

function recoverUserBlueprintNameCollision(
	record: OpenFabUserBlueprintRecord,
	occupied: Iterable<OpenFabUserBlueprintRecord>,
): OpenFabUserBlueprintRecord {
	const others = [...occupied].filter(({ id }) => id !== record.id);
	if (!others.some((candidate) => openFabUserBlueprintsShareFolderAndName(candidate, record))) {
		return record;
	}
	for (let ordinal = 1; ordinal <= OPENFAB_USER_BLUEPRINT_MAX_RECORDS + 1; ordinal++) {
		const suffix = ordinal === 1 ? " (Recovered)" : ` (Recovered ${ordinal})`;
		const name = `${record.blueprint.name.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
		const recovered = updateOpenFabUserBlueprintRecord(record, {
			quickSlot: null,
			updatedAt: record.updatedAt,
			blueprint: updateOpenFabProjectBlueprint(record.blueprint, {
				name,
				updatedAt: record.blueprint.updatedAt,
			}),
		});
		if (
			!others.some((candidate) => openFabUserBlueprintsShareFolderAndName(candidate, recovered))
		) {
			return recovered;
		}
	}
	throw new Error("Unable to recover a unique browser-local blueprint name.");
}

function storedUserBlueprintEdgeCount(value: unknown, maximum: number): number {
	try {
		return Math.min(parseOpenFabUserBlueprintRecord(value).blueprint.edges.length, maximum + 1);
	} catch {
		return 0;
	}
}

function storedUserBlueprintJsonByteLength(value: unknown, maximum: number): number {
	try {
		return Math.min(
			openFabUserBlueprintRecordJsonByteLength(parseOpenFabUserBlueprintRecord(value)),
			maximum + 1,
		);
	} catch {
		return 0;
	}
}

function userBlueprintJsonCapacityMessage(maximum: number): string {
	return `User blueprint library cannot exceed ${maximum / (1024 * 1024)} MiB of canonical JSON.`;
}

function normalizeDatabaseError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function ensureUniqueUserBlueprintQuickSlotIndex(store: IDBObjectStore): void {
	if (store.indexNames.contains(USER_BLUEPRINT_QUICK_SLOT_INDEX)) return;
	const occupied = new Set<number>();
	const cursorRequest = store.openCursor();
	cursorRequest.onsuccess = () => {
		const cursor = cursorRequest.result;
		if (!cursor) {
			store.createIndex(USER_BLUEPRINT_QUICK_SLOT_INDEX, "quickSlot", { unique: true });
			return;
		}
		const value = cursor.value as unknown;
		let shouldClearSlot = false;
		try {
			const record = parseOpenFabUserBlueprintRecord(value);
			if (record.quickSlot !== null) {
				shouldClearSlot = occupied.has(record.quickSlot);
				occupied.add(record.quickSlot);
			}
		} catch {
			shouldClearSlot = hasIndexedQuickSlot(value);
		}
		if (shouldClearSlot && isObjectRecord(value)) {
			cursor.update({ ...value, quickSlot: null });
		}
		cursor.continue();
	};
}

function hasIndexedQuickSlot(value: unknown): boolean {
	return isObjectRecord(value) && value.quickSlot !== null && value.quickSlot !== undefined;
}

function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndexedDbConstraintError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "ConstraintError"
	);
}

const PROJECT_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab project",
		accept: Object.freeze({ "application/json": Object.freeze([".openfab", ".json"]) }),
	}),
]);

const USER_BLUEPRINT_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab blueprint",
		accept: Object.freeze({
			"application/json": Object.freeze([OPENFAB_USER_BLUEPRINT_FILE_EXTENSION]),
		}),
	}),
]);

const USER_BLUEPRINT_LIBRARY_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab blueprint library backup",
		accept: Object.freeze({
			"application/json": Object.freeze([OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION]),
		}),
	}),
]);

const USER_BLUEPRINT_DIAGNOSTIC_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab quarantined blueprint diagnostic",
		accept: Object.freeze({
			"application/json": Object.freeze([OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION]),
		}),
	}),
]);

async function chooseOpenWithInput(signal?: AbortSignal): Promise<OpenFabProjectFileRead | null> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".openfab,.json,application/json";
		input.hidden = true;
		const finish = (result: OpenFabProjectFileRead | null): void => {
			cleanup();
			resolve(result);
		};
		const cancel = (): void => finish(null);
		const abort = (): void => finish(null);
		const change = async (): Promise<void> => {
			try {
				const file = input.files?.[0];
				if (!file) return finish(null);
				assertProjectFileSize(file.size);
				const json = await file.text();
				if (signal?.aborted) return finish(null);
				finish({
					reference: Object.freeze({
						id: createRuntimeId(),
						name: file.name,
						writable: false,
						reopenable: false,
					}),
					json,
				});
			} catch (error) {
				cleanup();
				reject(error);
			}
		};
		const cleanup = (): void => {
			input.removeEventListener("change", change);
			input.removeEventListener("cancel", cancel);
			signal?.removeEventListener("abort", abort);
			input.remove();
		};
		input.addEventListener("change", change);
		input.addEventListener("cancel", cancel);
		signal?.addEventListener("abort", abort, { once: true });
		document.body.append(input);
		input.click();
	});
}

async function chooseUserBlueprintOpenWithInput(
	signal?: AbortSignal,
): Promise<OpenFabUserBlueprintFileRead | null> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = `${OPENFAB_USER_BLUEPRINT_FILE_EXTENSION},application/json`;
		input.hidden = true;
		const finish = (result: OpenFabUserBlueprintFileRead | null): void => {
			cleanup();
			resolve(result);
		};
		const cancel = (): void => finish(null);
		const abort = (): void => finish(null);
		const change = async (): Promise<void> => {
			try {
				const file = input.files?.[0];
				if (!file) return finish(null);
				assertUserBlueprintFileSize(file.size);
				const json = await file.text();
				if (signal?.aborted) return finish(null);
				finish(Object.freeze({ name: file.name, json }));
			} catch (error) {
				cleanup();
				reject(error);
			}
		};
		const cleanup = (): void => {
			input.removeEventListener("change", change);
			input.removeEventListener("cancel", cancel);
			signal?.removeEventListener("abort", abort);
			input.remove();
		};
		input.addEventListener("change", change);
		input.addEventListener("cancel", cancel);
		signal?.addEventListener("abort", abort, { once: true });
		document.body.append(input);
		input.click();
	});
}

async function chooseUserBlueprintLibraryOpenWithInput(
	signal?: AbortSignal,
): Promise<OpenFabUserBlueprintLibraryBundleFileRead | null> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = `${OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION},application/json`;
		input.hidden = true;
		const finish = (result: OpenFabUserBlueprintLibraryBundleFileRead | null): void => {
			cleanup();
			resolve(result);
		};
		const cancel = (): void => finish(null);
		const abort = (): void => finish(null);
		const change = async (): Promise<void> => {
			try {
				const file = input.files?.[0];
				if (!file) return finish(null);
				assertUserBlueprintLibraryFileSize(file.size);
				const json = await readUserBlueprintLibraryFileText(file, signal);
				if (signal?.aborted) return finish(null);
				finish(Object.freeze({ name: file.name, json }));
			} catch (error) {
				cleanup();
				reject(error);
			}
		};
		const cleanup = (): void => {
			input.removeEventListener("change", change);
			input.removeEventListener("cancel", cancel);
			signal?.removeEventListener("abort", abort);
			input.remove();
		};
		input.addEventListener("change", change);
		input.addEventListener("cancel", cancel);
		signal?.addEventListener("abort", abort, { once: true });
		document.body.append(input);
		input.click();
	});
}

async function writeHandle(
	handle: BrowserFileHandle,
	json: string,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	const writable = await handle.createWritable();
	try {
		throwIfAborted(signal);
		await writable.write(json);
		throwIfAborted(signal);
		await writable.close();
	} catch (error) {
		await writable.abort?.(error);
		throw error;
	}
}

async function readUserBlueprintLibraryFileText(file: File, signal?: AbortSignal): Promise<string> {
	assertUserBlueprintLibraryFileSize(file.size);
	throwIfAborted(signal);
	const reader = file.stream().getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const chunks: string[] = [];
	let byteCount = 0;
	const abort = (): void => {
		void reader.cancel(new DOMException("The operation was aborted.", "AbortError"));
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			throwIfAborted(signal);
			const chunk = await reader.read();
			throwIfAborted(signal);
			if (chunk.done) break;
			byteCount += chunk.value.byteLength;
			assertUserBlueprintLibraryFileSize(byteCount);
			chunks.push(decoder.decode(chunk.value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		signal?.removeEventListener("abort", abort);
		reader.releaseLock();
	}
}

async function ensurePermission(
	handle: BrowserFileHandle,
	mode: "read" | "readwrite",
): Promise<boolean> {
	if (!handle.queryPermission) return true;
	if ((await handle.queryPermission({ mode })) === "granted") return true;
	return handle.requestPermission
		? (await handle.requestPermission({ mode })) === "granted"
		: false;
}

function browserFunction<FunctionType>(name: string): FunctionType | null {
	const value = Reflect.get(window, name) as unknown;
	return typeof value === "function" ? (value.bind(window) as FunctionType) : null;
}

function downloadJsonFile(name: string, json: string): void {
	const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	document.body.append(anchor);
	try {
		anchor.click();
	} finally {
		anchor.remove();
	}
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function normalizeSuggestedFileName(value: string): string {
	const base = value
		.trim()
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, " ")
		.slice(0, 100);
	const name = base || "Untitled FAB";
	return name.toLowerCase().endsWith(".openfab") ? name : `${name}.openfab`;
}

function normalizeSuggestedUserBlueprintFileName(value: string): string {
	const base = value
		.trim()
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, " ")
		.slice(0, 100);
	const name = base || "OpenFab Blueprint";
	return name.toLowerCase().endsWith(OPENFAB_USER_BLUEPRINT_FILE_EXTENSION)
		? name
		: `${name}${OPENFAB_USER_BLUEPRINT_FILE_EXTENSION}`;
}

function normalizeSuggestedUserBlueprintLibraryFileName(value: string): string {
	const base = value
		.trim()
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, " ")
		.slice(0, 100);
	const name = base || "OpenFab Blueprint Library";
	return name.toLowerCase().endsWith(OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION)
		? name
		: `${name}${OPENFAB_USER_BLUEPRINT_LIBRARY_FILE_EXTENSION}`;
}

function normalizeSuggestedUserBlueprintDiagnosticFileName(value: string): string {
	const base = value
		.trim()
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, " ")
		.slice(0, 100);
	const name = base || "Quarantined OpenFab Blueprint";
	return name.toLowerCase().endsWith(OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION)
		? name
		: `${name}${OPENFAB_USER_BLUEPRINT_DIAGNOSTIC_FILE_EXTENSION}`;
}

function createRejectedUserBlueprintDiagnostic(
	token: string,
	ordinal: number,
	error: unknown,
): OpenFabUserBlueprintRejectedDiagnostic {
	const code = error instanceof OpenFabUserBlueprintParseError ? error.code : "INVALID_RECORD";
	const path = error instanceof OpenFabUserBlueprintParseError ? error.path : "$";
	const detail = error instanceof Error ? error.message : "record validation failed";
	return Object.freeze({
		token,
		ordinal,
		code,
		path: path.slice(0, 160),
		message: detail.slice(0, 320),
	});
}

function createOverflowUserBlueprintDiagnostic(
	token: string,
	ordinal: number,
): OpenFabUserBlueprintRejectedDiagnostic {
	return Object.freeze({
		token,
		ordinal,
		code: "LIMIT_EXCEEDED",
		path: "$.records",
		message:
			"이 레코드는 라이브러리 총량 한도를 넘겨 격리했습니다. 원본 JSON을 내보낸 뒤 불필요한 항목을 정리하고 다시 가져오세요.",
	});
}

function copyRejectedUserBlueprintDiagnostic(
	diagnostic: OpenFabUserBlueprintRejectedDiagnostic,
): OpenFabUserBlueprintRejectedDiagnostic {
	return Object.freeze({ ...diagnostic });
}

function reidentifyOpenFabUserBlueprintRecord(
	record: OpenFabUserBlueprintRecord,
): OpenFabUserBlueprintRecord {
	return parseOpenFabUserBlueprintRecord({
		...record,
		id: `user-blueprint-${createRuntimeId()}`,
	});
}

function createRuntimeId(): string {
	return typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `openfab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function assertProjectFileSize(bytes: number): void {
	if (bytes > OPENFAB_PROJECT_MAX_JSON_CHARACTERS) {
		throw new Error("OpenFab project exceeds the 128 MiB JSON parsing budget.");
	}
}

function assertUserBlueprintFileSize(bytes: number): void {
	if (bytes > OPENFAB_USER_BLUEPRINT_MAX_JSON_BYTES) {
		throw new Error("OpenFab blueprint exceeds the 16 MiB JSON parsing budget.");
	}
}

function assertUserBlueprintLibraryFileSize(bytes: number): void {
	if (bytes > OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_JSON_BYTES) {
		throw new Error("OpenFab blueprint library exceeds the 128 MiB JSON parsing budget.");
	}
}

function assertUserBlueprintId(id: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
		throw new TypeError("User blueprint id must be a portable 1-128 character identifier.");
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Project operation was aborted.", "AbortError");
}

function isUserCancellation(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function copyRecentProject(project: OpenFabRecentProject): OpenFabRecentProject {
	return Object.freeze({
		projectId: project.projectId,
		name: project.name,
		updatedAt: project.updatedAt,
		authoredChecksum: project.authoredChecksum,
		reference: project.reference ? Object.freeze({ ...project.reference }) : null,
	});
}

function copyRecoveryProject(project: OpenFabRecoveryProject): OpenFabRecoveryProject {
	return Object.freeze({ ...project });
}

function copyRecoveryProjectSummary(
	project: OpenFabRecoveryProjectSummary,
): OpenFabRecoveryProjectSummary {
	return Object.freeze({
		projectId: project.projectId,
		name: project.name,
		updatedAt: project.updatedAt,
		authoredChecksum: project.authoredChecksum,
		jsonCharacters: project.jsonCharacters,
	});
}

function parseRecoveryProjectIdentity(
	value: unknown,
): Omit<OpenFabRecoveryProjectSummary, "jsonCharacters"> | null {
	if (
		!isObjectRecord(value) ||
		typeof value.projectId !== "string" ||
		value.projectId.length === 0 ||
		typeof value.name !== "string" ||
		value.name.length === 0 ||
		typeof value.updatedAt !== "string" ||
		value.updatedAt.length === 0 ||
		typeof value.authoredChecksum !== "string" ||
		value.authoredChecksum.length === 0
	) {
		return null;
	}
	return Object.freeze({
		projectId: value.projectId,
		name: value.name,
		updatedAt: value.updatedAt,
		authoredChecksum: value.authoredChecksum,
	});
}

function parseRecoveryProjectSummary(value: unknown): OpenFabRecoveryProjectSummary | null {
	const identity = parseRecoveryProjectIdentity(value);
	if (
		!identity ||
		!isObjectRecord(value) ||
		!Number.isSafeInteger(value.jsonCharacters) ||
		(value.jsonCharacters as number) < 0
	) {
		return null;
	}
	return copyRecoveryProjectSummary({
		...identity,
		jsonCharacters: value.jsonCharacters as number,
	});
}

function parseRecoveryProject(value: unknown): OpenFabRecoveryProject | null {
	const identity = parseRecoveryProjectIdentity(value);
	if (!identity || !isObjectRecord(value) || typeof value.json !== "string") return null;
	return Object.freeze({ ...identity, json: value.json });
}

function summarizeRecoveryProject(project: OpenFabRecoveryProject): OpenFabRecoveryProjectSummary {
	return copyRecoveryProjectSummary({
		projectId: project.projectId,
		name: project.name,
		updatedAt: project.updatedAt,
		authoredChecksum: project.authoredChecksum,
		jsonCharacters: project.json.length,
	});
}

function parseRecoveryInventoryOffset(value: number | undefined): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError("Recovery inventory offset must be a non-negative safe integer.");
	}
	return value;
}
