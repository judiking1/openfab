import {
	createSourceBoundCooperativeTask,
	SOURCE_BOUND_COOPERATIVE_TASK_STEP_LIMIT,
	type SourceBoundCooperativeTask,
} from "./SourceBoundCooperativeTask";
import {
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	type StaticFabOrganizationState,
	staticFabOrganizationDeclaredSemanticRole,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationMetadataLookupCurrent,
	isIssuedStaticFabOrganizationMetadataLookup,
	type StaticFabOrganizationMetadataLookup,
	type StaticFabOrganizationMetadataLookupLease,
} from "./StaticFabOrganizationMetadataLookup";

export const STATIC_FAB_CHECK_REPAIR_TARGET_STEP_LIMIT = SOURCE_BOUND_COOPERATIVE_TASK_STEP_LIMIT;
export const STATIC_FAB_CHECK_REPAIR_TARGET_MATCH_LIMIT = 100;
export const STATIC_FAB_CHECK_REPAIR_TARGET_SELECTED_LIMIT = 2;
export const STATIC_FAB_CHECK_REPAIR_TARGET_SEARCH_LENGTH_LIMIT = 120;

export type StaticFabCheckRepairTargetRole = "PROCESS_LOOP" | "BAY" | "BAY_BANK";

export interface StaticFabCheckRepairTargetOption {
	readonly id: number;
	readonly name: string;
	readonly role: StaticFabCheckRepairTargetRole;
}

export type StaticFabCheckRepairTargetSelection = Readonly<
	| { status: "available"; organizationId: number; option: StaticFabCheckRepairTargetOption }
	| { status: "missing" | "unsupported"; organizationId: number }
>;

export interface StaticFabCheckRepairTargetQuery {
	readonly searchText?: string;
	readonly role?: StaticFabCheckRepairTargetRole | "ALL";
	readonly selectedOrganizationIds?: readonly number[];
}

export interface StaticFabCheckRepairTargetPage {
	readonly organizations: StaticFabOrganizationState;
	readonly normalizedSearchText: string;
	readonly role: StaticFabCheckRepairTargetRole | "ALL";
	readonly queryMode: "text" | "exact-id" | "invalid-id";
	readonly queryStatus:
		| "text-results"
		| "exact-id-match"
		| "exact-id-missing"
		| "exact-id-unsupported"
		| "exact-id-filtered"
		| "exact-id-selected"
		| "invalid-id";
	readonly explanation: string | null;
	/** At most 100 unselected matches, in exact source order. */
	readonly matches: readonly StaticFabCheckRepairTargetOption[];
	/** At most two explicit selections, resolved independently of the filter/page. */
	readonly selected: readonly StaticFabCheckRepairTargetSelection[];
	readonly hasMore: boolean;
	readonly scannedRecordCount: number;
}

export type StaticFabCheckRepairTargetIndexErrorCode = "INVALID_QUERY" | "INDEX_UNAVAILABLE";

export class StaticFabCheckRepairTargetIndexError extends Error {
	readonly code: StaticFabCheckRepairTargetIndexErrorCode;

	constructor(code: StaticFabCheckRepairTargetIndexErrorCode) {
		super(`Checks repair target index: ${code}`);
		this.name = "StaticFabCheckRepairTargetIndexError";
		this.code = code;
	}
}

export type StaticFabCheckRepairTargetTask<T> = SourceBoundCooperativeTask<T>;

export interface StaticFabCheckRepairTargetIndex {
	readonly organizations: StaticFabOrganizationState;
	readonly metadataLookup: StaticFabOrganizationMetadataLookup;
	readonly recordCount: number;
	organization(id: number): StaticFabOrganizationRecord | undefined;
	semanticRole(id: number): StaticFabOrganizationSemanticRole | undefined;
	resolveSelected(id: number): StaticFabCheckRepairTargetSelection;
	query(
		request?: StaticFabCheckRepairTargetQuery,
	): StaticFabCheckRepairTargetTask<StaticFabCheckRepairTargetPage>;
	/** Owns one claimed lookup lease; replacement indexes must claim a fresh lookup. */
	dispose(): void;
}

interface IndexedOption {
	readonly option: StaticFabCheckRepairTargetOption;
	readonly normalizedName: string;
	readonly normalizedRole: string;
}

interface OwnedQuery {
	readonly searchText: string;
	readonly role: StaticFabCheckRepairTargetRole | "ALL";
	readonly selectedIds: readonly number[];
	readonly mode: "text" | "exact-id" | "invalid-id";
	readonly exactId: number | null;
}

/**
 * Second cooperative phase over one already-issued canonical lookup. The index takes ownership
 * of that lookup's continuation lifetime. It never derives roles or accepts caller record/role maps.
 */
export function createStaticFabCheckRepairTargetIndexPreparation(
	organizations: StaticFabOrganizationState,
	metadataLookup: StaticFabOrganizationMetadataLookup,
): StaticFabCheckRepairTargetTask<StaticFabCheckRepairTargetIndex> {
	assertStaticFabOrganizationMetadataLookupCurrent(metadataLookup, organizations);
	const ownership: StaticFabOrganizationMetadataLookupLease = metadataLookup.claim();
	let optionsById: ReadonlyMap<number, IndexedOption> | null = null;
	let handoffCompleted = false;
	const assertCurrent = (): void => {
		try {
			assertStaticFabOrganizationMetadataLookupCurrent(metadataLookup, organizations);
		} catch (error) {
			optionsById = null;
			throw error;
		}
	};
	const dispose = (): void => {
		optionsById = null;
		// The index owns exactly one claimed lookup. Never release a foreign or forged object.
		if (
			ownership.lookup === metadataLookup &&
			isIssuedStaticFabOrganizationMetadataLookup(metadataLookup) &&
			metadataLookup.organizations === organizations
		)
			ownership.release();
	};
	const options = (): ReadonlyMap<number, IndexedOption> => {
		if (optionsById === null) throw new StaticFabCheckRepairTargetIndexError("INDEX_UNAVAILABLE");
		return optionsById;
	};
	const read = <T>(get: () => T): T => {
		assertCurrent();
		const value = get();
		assertCurrent();
		return value;
	};
	const selected = (id: number): StaticFabCheckRepairTargetSelection => {
		const entry = options().get(id);
		return entry !== undefined
			? Object.freeze({ status: "available", organizationId: id, option: entry.option })
			: Object.freeze({
					status: metadataLookup.record(id) === undefined ? "missing" : "unsupported",
					organizationId: id,
				});
	};
	function* querySteps(query: OwnedQuery): Generator<void, StaticFabCheckRepairTargetPage> {
		const selectedOptions: StaticFabCheckRepairTargetSelection[] = [];
		for (const id of query.selectedIds) {
			yield;
			selectedOptions.push(selected(id));
		}
		const matches: StaticFabCheckRepairTargetOption[] = [];
		let scannedRecordCount = 0;
		let hasMore = false;
		let queryStatus: StaticFabCheckRepairTargetPage["queryStatus"] = "text-results";
		let explanation: string | null = null;
		if (query.mode === "invalid-id") {
			queryStatus = "invalid-id";
			explanation = "조직 ID는 # 뒤에 양의 32-bit 정수로 입력하세요 · 예: #100001";
		} else if (query.mode === "exact-id" && query.exactId !== null) {
			// Exact #ID uses one candidate lookup, never a first-page/global name scan.
			yield;
			const entry = options().get(query.exactId);
			if (entry === undefined) {
				const exists = metadataLookup.record(query.exactId) !== undefined;
				queryStatus = exists ? "exact-id-unsupported" : "exact-id-missing";
				explanation = exists
					? "현재 수리 대상으로 제공하지 않는 조직 ID입니다"
					: "현재 프로젝트에서 해당 조직 ID를 찾을 수 없습니다";
			} else if (query.role !== "ALL" && entry.option.role !== query.role) {
				queryStatus = "exact-id-filtered";
				explanation = "선택한 역할 필터와 다른 조직입니다";
			} else if (query.selectedIds.includes(query.exactId)) {
				queryStatus = "exact-id-selected";
				explanation = "이미 직접 선택한 조직입니다";
			} else {
				queryStatus = "exact-id-match";
				matches.push(entry.option);
			}
		} else {
			for (const record of organizations.records) {
				// Selected/unsupported/nonmatching rows all yield; absent names cannot drain 100k here.
				yield;
				scannedRecordCount++;
				if (query.selectedIds.includes(record.id)) continue;
				const entry = options().get(record.id);
				if (
					entry === undefined ||
					(query.role !== "ALL" && entry.option.role !== query.role) ||
					(query.searchText !== "" &&
						!entry.normalizedName.includes(query.searchText) &&
						!entry.normalizedRole.includes(query.searchText))
				)
					continue;
				if (matches.length === STATIC_FAB_CHECK_REPAIR_TARGET_MATCH_LIMIT) {
					hasMore = true;
					break;
				}
				matches.push(entry.option);
			}
		}
		return Object.freeze({
			organizations,
			normalizedSearchText: query.searchText,
			role: query.role,
			queryMode: query.mode,
			queryStatus,
			explanation,
			matches: Object.freeze(matches),
			selected: Object.freeze(selectedOptions),
			hasMore,
			scannedRecordCount,
		});
	}
	// Avoid retaining the generator's private normalized-options Map through method closures.
	const issueIndex = (): StaticFabCheckRepairTargetIndex => {
		return Object.freeze({
			organizations,
			metadataLookup,
			recordCount: metadataLookup.recordCount,
			organization(id: number) {
				return read(() => metadataLookup.record(id));
			},
			semanticRole(id: number) {
				return read(() => metadataLookup.semanticRole(id));
			},
			resolveSelected(id: number) {
				if (!isPositiveInt32(id)) throw new StaticFabCheckRepairTargetIndexError("INVALID_QUERY");
				return read(() => selected(id));
			},
			query(request: StaticFabCheckRepairTargetQuery = {}) {
				return createSourceBoundCooperativeTask(querySteps(ownQuery(request)), assertCurrent);
			},
			dispose,
		});
	};
	function* prepare(): Generator<void, StaticFabCheckRepairTargetIndex> {
		const indexed = new Map<number, IndexedOption>();
		for (const record of organizations.records) {
			yield;
			const role = metadataLookup.semanticRole(record.id);
			if (!isOfferedRole(record, role)) continue;
			indexed.set(record.id, {
				option: Object.freeze({ id: record.id, name: record.name, role }),
				normalizedName: normalizeSearchText(record.name),
				normalizedRole: normalizeSearchText(role),
			});
		}
		optionsById = indexed;
		return issueIndex();
	}
	const inner = createSourceBoundCooperativeTask(prepare(), assertCurrent, dispose);
	return Object.freeze({
		get done() {
			return inner.done;
		},
		step(operationBudget?: number) {
			return inner.step(operationBudget);
		},
		finish() {
			const index = inner.finish();
			// Only a successful public finish() publishes the index owner. A task that
			// merely reached done but never finished remains cancellable and releasable.
			handoffCompleted = true;
			return index;
		},
		cancel() {
			if (handoffCompleted) return;
			inner.cancel();
		},
	});
}

function isOfferedRole(
	record: StaticFabOrganizationRecord,
	role: StaticFabOrganizationSemanticRole | undefined,
): role is StaticFabCheckRepairTargetRole {
	return (
		role === "BAY" ||
		role === "BAY_BANK" ||
		(role === "PROCESS_LOOP" &&
			record.kind === "AISLE" &&
			staticFabOrganizationDeclaredSemanticRole(record) === "PROCESS_LOOP" &&
			staticFabOrganizationParentIds(record).length === 0)
	);
}

function normalizeSearchText(value: string): string {
	return value.normalize("NFKC").replace(/_/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase();
}

function ownQuery(request: StaticFabCheckRepairTargetQuery): OwnedQuery {
	const searchText = request.searchText ?? "";
	const role = request.role ?? "ALL";
	const ids = request.selectedOrganizationIds ?? [];
	if (
		typeof searchText !== "string" ||
		searchText.length > STATIC_FAB_CHECK_REPAIR_TARGET_SEARCH_LENGTH_LIMIT ||
		(role !== "ALL" && role !== "PROCESS_LOOP" && role !== "BAY" && role !== "BAY_BANK") ||
		!Array.isArray(ids) ||
		ids.length > STATIC_FAB_CHECK_REPAIR_TARGET_SELECTED_LIMIT
	)
		throw new StaticFabCheckRepairTargetIndexError("INVALID_QUERY");
	const selectedIds: number[] = [];
	for (let index = 0; index < ids.length; index++) {
		const id = ids[index];
		if (id === undefined || !isPositiveInt32(id))
			throw new StaticFabCheckRepairTargetIndexError("INVALID_QUERY");
		selectedIds.push(id);
	}
	const normalized = normalizeSearchText(searchText);
	const startsWithId = normalized.startsWith("#");
	const parsedId =
		startsWithId && normalized.length <= 11 && /^#[1-9][0-9]*$/u.test(normalized)
			? Number(normalized.slice(1))
			: null;
	const exactId = parsedId !== null && isPositiveInt32(parsedId) ? parsedId : null;
	return Object.freeze({
		searchText: normalized,
		role,
		selectedIds: Object.freeze(selectedIds),
		mode: startsWithId ? (exactId === null ? "invalid-id" : "exact-id") : "text",
		exactId,
	});
}

function isPositiveInt32(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value < 0x80000000;
}
