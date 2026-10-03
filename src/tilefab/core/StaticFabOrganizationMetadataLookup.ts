import {
	createSourceBoundCooperativeTask,
	type SourceBoundCooperativeTask,
} from "./SourceBoundCooperativeTask";
import {
	deriveStaticFabOrganizationSemanticRoleSteps,
	isCanonicalStaticFabOrganizationRecord,
	isCanonicalStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";

const lookupBrand: unique symbol = Symbol("StaticFabOrganizationMetadataLookup");
// Provenance only. All organization data stays in each issued lookup's private closure.
const issuedMetadataLookups = new WeakSet<object>();

export interface StaticFabOrganizationMetadataLookup {
	readonly [lookupBrand]: true;
	readonly organizations: StaticFabOrganizationState;
	readonly recordCount: number;
	record(id: number): StaticFabOrganizationRecord | undefined;
	semanticRole(id: number): StaticFabOrganizationSemanticRole | undefined;
	assertCurrent(organizations: StaticFabOrganizationState): void;
	/** Claim exactly one downstream owner after preparation handoff. */
	claim(): StaticFabOrganizationMetadataLookupLease;
	revoke(): void;
}

export interface StaticFabOrganizationMetadataLookupLease {
	readonly lookup: StaticFabOrganizationMetadataLookup;
	readonly released: boolean;
	release(): void;
}

export type StaticFabOrganizationMetadataLookupErrorCode =
	| "NON_CANONICAL_SOURCE"
	| "DUPLICATE_ORGANIZATION_ID"
	| "STALE_SOURCE"
	| "FOREIGN_SOURCE"
	| "UNISSUED_LOOKUP"
	| "REVOKED"
	| "LOOKUP_ALREADY_OWNED"
	| "REENTRANT_SOURCE_CHECK";

export class StaticFabOrganizationMetadataLookupError extends Error {
	readonly code: StaticFabOrganizationMetadataLookupErrorCode;

	constructor(code: StaticFabOrganizationMetadataLookupErrorCode) {
		super(`Organization metadata lookup: ${code}`);
		this.name = "StaticFabOrganizationMetadataLookupError";
		this.code = code;
	}
}

interface LookupTables {
	readonly records: ReadonlyMap<number, StaticFabOrganizationRecord>;
	readonly roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
}

/**
 * One lazy, cooperative canonical derivation. It accepts no caller tables or record/role callbacks.
 * The O(1) lifetime predicate may cancel/revoke synchronously. The result remains advisory data,
 * not topology/gateway/patch certification. No source data is globally cached.
 */
export function createStaticFabOrganizationMetadataLookupPreparation(
	organizations: StaticFabOrganizationState,
	isSourceCurrent: (organizations: StaticFabOrganizationState) => boolean,
): SourceBoundCooperativeTask<StaticFabOrganizationMetadataLookup> {
	let tables: LookupTables | null = null;
	let failure: unknown;
	let failed = false;
	let checkingSource = false;
	let ownerClaimed = false;
	let ownerReleased = false;
	const revoke = (error: unknown): void => {
		if (!failed) {
			failure = error;
			failed = true;
		}
		ownerReleased = true;
		tables = null;
	};
	const abort = (error: unknown, fromPreparationCleanup = false): void => {
		// A preparation task can be cancelled by a scheduler after its result was
		// handed off. Its cleanup must not revoke the live downstream owner.
		if (fromPreparationCleanup && ownerClaimed && !ownerReleased) return;
		revoke(error);
	};
	const assertCurrent = (): void => {
		if (failed) throw failure;
		if (checkingSource) {
			abort(new StaticFabOrganizationMetadataLookupError("REENTRANT_SOURCE_CHECK"));
			throw failure;
		}
		if (!isCanonicalStaticFabOrganizationState(organizations)) {
			abort(new StaticFabOrganizationMetadataLookupError("NON_CANONICAL_SOURCE"));
			throw failure;
		}
		let current: boolean;
		try {
			checkingSource = true;
			current = isSourceCurrent(organizations);
		} catch (error) {
			abort(error);
			throw failure;
		} finally {
			checkingSource = false;
		}
		if (failed) throw failure;
		if (current !== true) {
			abort(new StaticFabOrganizationMetadataLookupError("STALE_SOURCE"));
			throw failure;
		}
	};
	const data = (): LookupTables => {
		if (tables === null) throw new StaticFabOrganizationMetadataLookupError("REVOKED");
		return tables;
	};
	const read = <T>(get: (owned: LookupTables) => T): T => {
		assertCurrent();
		const value = get(data());
		assertCurrent();
		return value;
	};
	// Create exported methods outside the generator's local record/role Map scope.
	const issue = (): StaticFabOrganizationMetadataLookup => {
		const lookup: StaticFabOrganizationMetadataLookup = Object.freeze({
			[lookupBrand]: true as const,
			organizations,
			recordCount: organizations.records.length,
			record(id: number) {
				return read((owned) => owned.records.get(id));
			},
			semanticRole(id: number) {
				return read((owned) => owned.roles.get(id));
			},
			assertCurrent(expected: StaticFabOrganizationState) {
				if (expected !== organizations)
					throw new StaticFabOrganizationMetadataLookupError("FOREIGN_SOURCE");
				assertCurrent();
			},
			claim() {
				// Terminal revocation wins over the historical owner bit. A released
				// lease cannot be mistaken for a live duplicate owner.
				if (failed || tables === null || ownerReleased) {
					throw new StaticFabOrganizationMetadataLookupError("REVOKED");
				}
				if (ownerClaimed) {
					throw new StaticFabOrganizationMetadataLookupError("LOOKUP_ALREADY_OWNED");
				}
				// Direct claim callers must perform the same source/lifetime check as
				// index preparation; otherwise an unowned stale lookup could acquire
				// a lease before its first read notices staleness.
				assertCurrent();
				ownerClaimed = true;
				const lease: StaticFabOrganizationMetadataLookupLease = Object.freeze({
					lookup,
					get released() {
						return ownerReleased;
					},
					release() {
						revoke(new StaticFabOrganizationMetadataLookupError("REVOKED"));
					},
				});
				return lease;
			},
			revoke() {
				revoke(new StaticFabOrganizationMetadataLookupError("REVOKED"));
			},
		});
		issuedMetadataLookups.add(lookup);
		return lookup;
	};
	function* prepare(): Generator<void, StaticFabOrganizationMetadataLookup> {
		const records = new Map<number, StaticFabOrganizationRecord>();
		for (const record of organizations.records) {
			yield;
			if (!isCanonicalStaticFabOrganizationRecord(record)) {
				throw new StaticFabOrganizationMetadataLookupError("NON_CANONICAL_SOURCE");
			}
			if (records.has(record.id)) {
				throw new StaticFabOrganizationMetadataLookupError("DUPLICATE_ORGANIZATION_ID");
			}
			records.set(record.id, record);
		}
		const roles = yield* deriveStaticFabOrganizationSemanticRoleSteps(organizations);
		tables = { records, roles };
		return issue();
	}
	return createSourceBoundCooperativeTask(prepare(), assertCurrent, (error) => abort(error, true));
}

/** Reject forged/cloned objects before reading their properties or calling their functions. */
export function assertStaticFabOrganizationMetadataLookupCurrent(
	lookup: unknown,
	organizations: StaticFabOrganizationState,
): asserts lookup is StaticFabOrganizationMetadataLookup {
	if (!isIssuedStaticFabOrganizationMetadataLookup(lookup)) {
		throw new StaticFabOrganizationMetadataLookupError("UNISSUED_LOOKUP");
	}
	lookup.assertCurrent(organizations);
}

/** Provenance only; revoked objects still require the current check and never regain authority. */
export function isIssuedStaticFabOrganizationMetadataLookup(
	lookup: unknown,
): lookup is StaticFabOrganizationMetadataLookup {
	return typeof lookup === "object" && lookup !== null && issuedMetadataLookups.has(lookup);
}

/** Legacy canonical synchronous callers only. Never call this from the new Checks UI path. */
export function completeStaticFabOrganizationMetadataLookup(
	organizations: StaticFabOrganizationState,
): StaticFabOrganizationMetadataLookup {
	const task = createStaticFabOrganizationMetadataLookupPreparation(
		organizations,
		(source) => source === organizations,
	);
	while (!task.done) task.step(128);
	return task.finish();
}
