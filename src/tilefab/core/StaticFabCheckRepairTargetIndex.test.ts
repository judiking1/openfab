import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceBoundCooperativeTask } from "./SourceBoundCooperativeTask";
import { staticFabAssemblyConnectorHierarchyEligibilityFromLookup } from "./StaticFabAssemblyConnector";
import {
	advance,
	bay,
	expectCode,
	lookup,
	loops,
	record,
	state,
} from "./StaticFabCheckRepair.test-fixtures";
import {
	createStaticFabCheckRepairTargetIndexPreparation,
	type StaticFabCheckRepairTargetIndex,
	type StaticFabCheckRepairTargetPage,
} from "./StaticFabCheckRepairTargetIndex";
import * as organizationsModule from "./StaticFabOrganization";
import {
	copyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import type { StaticFabOrganizationMetadataLookup } from "./StaticFabOrganizationMetadataLookup";

function prepared(
	organizations: StaticFabOrganizationState,
	isCurrent: (source: StaticFabOrganizationState) => boolean = (source) => source === organizations,
): StaticFabCheckRepairTargetIndex {
	const metadata = lookup(organizations, isCurrent);
	const task = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
	advance(task);
	return task.finish();
}

afterEach(() => vi.restoreAllMocks());

describe("Checks options over shared issued metadata", () => {
	it("derives semantics once across both phases, queries and O(1) selection, with no inferred default", () => {
		const organizations = state([
			record(1, "AISLE", [], true),
			record(2, "BAY", [6]),
			record(3, "AISLE", [2]),
			record(4, "AISLE", [2], true),
			record(5, "AISLE", [], false, "PROCESS_LOOP"),
			record(6, "AREA", [7]),
			record(7, "AREA"),
		]);
		const derive = vi.spyOn(organizationsModule, "deriveStaticFabOrganizationSemanticRoleSteps");
		const current = vi.fn((source: StaticFabOrganizationState) => source === organizations);
		const metadata = lookup(organizations, current);
		expect(derive).toHaveBeenCalledTimes(1);
		const before = current.mock.calls.length;
		const task = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		expect(current.mock.calls.length - before).toBeGreaterThan(0);
		expect(current.mock.calls.length - before).toBeLessThanOrEqual(4);
		expect(derive).toHaveBeenCalledTimes(1);
		expectCode(() => task.finish(), "NOT_COMPLETE");
		advance(task);
		const index = task.finish();
		const query = index.query();
		advance(query);
		expect(query.finish().matches.map((item) => [item.id, item.role])).toEqual([
			[1, "PROCESS_LOOP"],
			[2, "BAY"],
			[6, "BAY_BANK"],
		]);
		expect(query.finish().selected).toEqual([]);
		for (const id of [3, 4, 5, 7])
			expect(index.resolveSelected(id)).toEqual({ status: "unsupported", organizationId: id });
		expect(index.resolveSelected(99)).toEqual({ status: "missing", organizationId: 99 });
		expect(index.organization(2)).toBe(organizations.records[1]);
		expect(index.semanticRole(7)).toBe("FAB");
		expect(index.metadataLookup).toBe(metadata);
		expect(derive).toHaveBeenCalledTimes(1);
	});

	it("normalizes name/role, preserves source order and resolves explicit rows outside the search/filter", () => {
		const organizations = state([
			record(1, "AISLE", [], true, "Ｌｏｏｐ　Alpha"),
			record(2, "BAY"),
			record(3, "AISLE", [2]),
			record(4, "AISLE", [], true, "zeta"),
		]);
		const index = prepared(organizations);
		const byName = index.query({ searchText: "  loop\tALPHA  " });
		advance(byName);
		expect(byName.finish()).toMatchObject({
			normalizedSearchText: "loop alpha",
			matches: [{ id: 1, name: "Ｌｏｏｐ　Alpha", role: "PROCESS_LOOP" }],
		});
		const role = index.query({ searchText: "Process_Loop", role: "PROCESS_LOOP" });
		advance(role);
		expect(role.finish().matches.map((item) => item.id)).toEqual([1, 4]);
		const ids = [4, 2];
		const selected = index.query({
			searchText: "absent",
			role: "PROCESS_LOOP",
			selectedOrganizationIds: ids,
		});
		ids[0] = 99;
		advance(selected);
		expect(selected.finish().matches).toEqual([]);
		expect(selected.finish().selected.map((item) => item.organizationId)).toEqual([4, 2]);
		expect(selected.finish().selected.every((item) => item.status === "available")).toBe(true);
	});

	it("excludes selected IDs and counts only unselected matches for 100/101 hasMore", () => {
		const index = prepared(loops(104));
		const task = index.query({ selectedOrganizationIds: [2, 1] });
		advance(task);
		expect(task.finish().selected.map((item) => item.organizationId)).toEqual([2, 1]);
		expect(task.finish().matches.map((item) => item.id)).toEqual(
			Array.from({ length: 100 }, (_, index) => index + 3),
		);
		expect(task.finish()).toMatchObject({ hasMore: true, scannedRecordCount: 103 });
		const exact = prepared(loops(102)).query({ selectedOrganizationIds: [1, 2] });
		advance(exact);
		expect(exact.finish()).toMatchObject({ hasMore: false, scannedRecordCount: 102 });
		expect(exact.finish().matches).toHaveLength(100);
		const same = index.query({ selectedOrganizationIds: [1, 1] });
		advance(same);
		expect(same.finish().selected.map((item) => item.organizationId)).toEqual([1, 1]);
		expect(same.finish().matches.map((item) => item.id)).toEqual(
			Array.from({ length: 100 }, (_, index) => index + 2),
		);
		expect(same.finish()).toMatchObject({ hasMore: true, scannedRecordCount: 102 });
	});

	it("does not count unsupported source rows as matches or infer selection with 0/1/2 results", () => {
		for (const count of [0, 1, 2, 100, 101]) {
			const task = prepared(loops(count)).query();
			advance(task);
			expect(task.finish().selected).toEqual([]);
			expect(task.finish().matches).toHaveLength(Math.min(count, 100));
			expect(task.finish().hasMore).toBe(count === 101);
		}
		const records = Array.from({ length: 150 }, (_, index) =>
			record(index + 1, index < 100 ? "AISLE" : "PROCESS_FAMILY", [], index < 100),
		);
		const task = prepared(state(records)).query({ role: "PROCESS_LOOP" });
		advance(task);
		expect(task.finish()).toMatchObject({ hasMore: false, scannedRecordCount: 150 });
		expect(task.finish().matches).toHaveLength(100);
	});

	it("keeps max128 and 100k rare/no-match cooperative while selected outside-page lookup is bounded", () => {
		const organizations = loops(100_000, `Shared visible prefix ${"Long ".repeat(14)}`);
		expect(organizations.records[0]?.name.length).toBeGreaterThan(80);
		expect(organizations.records[99_999]?.name.length).toBeLessThanOrEqual(120);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		expect(preparation.step(100_000)).toBe(128);
		expect(preparation.done).toBe(false);
		advance(preparation);
		const index = preparation.finish();
		const commonNames = index.query({ searchText: "shared visible prefix" });
		advance(commonNames);
		expect(commonNames.finish().matches.map((item) => item.id)).toEqual(
			Array.from({ length: 100 }, (_, offset) => offset + 1),
		);
		expect(commonNames.finish()).toMatchObject({
			hasMore: true,
			selected: [],
			scannedRecordCount: 101,
		});
		const page = index.query({ selectedOrganizationIds: [100_000, 99_999] });
		advance(page);
		expect(page.finish()).toMatchObject({ hasMore: true, scannedRecordCount: 101 });
		expect(page.finish().selected.map((item) => item.organizationId)).toEqual([100_000, 99_999]);
		const exact = index.query({ searchText: "#100000" });
		expect(exact.step(100_000)).toBeLessThanOrEqual(128);
		expect(exact.done).toBe(true);
		expect(exact.finish()).toMatchObject({
			queryMode: "exact-id",
			queryStatus: "exact-id-match",
			scannedRecordCount: 0,
			hasMore: false,
			selected: [],
		});
		expect(exact.finish().matches.map((item) => item.id)).toEqual([100_000]);
		expect(exact.finish().matches[0]?.name).toBe(organizations.records[99_999]?.name);
		const selectedExact = index.query({
			searchText: "#100000",
			selectedOrganizationIds: [100_000],
		});
		advance(selectedExact);
		expect(selectedExact.finish()).toMatchObject({
			queryStatus: "exact-id-selected",
			scannedRecordCount: 0,
			matches: [],
		});
		expect(selectedExact.finish().selected[0]).toMatchObject({
			status: "available",
			organizationId: 100_000,
		});
		for (const text of ["no-match", "rare last"]) {
			const query = index.query({ searchText: text, selectedOrganizationIds: [99_999] });
			expect(query.step(100_000)).toBe(128);
			expect(query.done).toBe(false);
			expect(advance(query)).toBeGreaterThan(700);
			expect(query.finish()).toMatchObject({ hasMore: false, scannedRecordCount: 100_000 });
			expect(query.finish().matches.map((item) => item.id)).toEqual(
				text === "no-match" ? [] : [100_000],
			);
		}
		index.dispose();
	}, 15_000);

	it("returns no inferred target for invalid/missing/unsupported/filtered/selected #ID, with clear status", () => {
		const organizations = state([
			record(1, "AISLE", [], true),
			record(2, "BAY", [4]),
			record(3, "AISLE", [2]),
			record(4, "AREA"),
			record(5, "PROCESS_FAMILY"),
		]);
		const index = prepared(organizations);
		for (const searchText of [
			"#",
			"#0",
			"#-1",
			"#+1",
			"#01",
			"#1.0",
			"#1e2",
			"# 1",
			"#1_0",
			"#2147483648",
			"#99999999999999999999",
			"#name",
		]) {
			const task = index.query({ searchText });
			advance(task);
			expect(task.finish()).toMatchObject({
				queryMode: "invalid-id",
				queryStatus: "invalid-id",
				matches: [],
				selected: [],
				scannedRecordCount: 0,
				hasMore: false,
			});
			expect(task.finish().explanation).toContain("#");
		}
		for (const [searchText, role, queryStatus] of [
			["#99", "ALL", "exact-id-missing"],
			["#2147483647", "ALL", "exact-id-missing"],
			["#3", "ALL", "exact-id-unsupported"],
			["#5", "ALL", "exact-id-unsupported"],
			["#1", "BAY", "exact-id-filtered"],
		] as const) {
			const task = index.query({ searchText, role });
			advance(task);
			expect(task.finish()).toMatchObject({
				queryMode: "exact-id",
				queryStatus,
				matches: [],
				selected: [],
				scannedRecordCount: 0,
			});
			expect(task.finish().explanation).not.toBeNull();
		}
		const normalized = index.query({ searchText: "  ＃２  ", role: "BAY" });
		advance(normalized);
		expect(normalized.finish()).toMatchObject({
			queryStatus: "exact-id-match",
			selected: [],
			scannedRecordCount: 0,
		});
		expect(normalized.finish().matches[0]?.id).toBe(2);
	});

	it("distinguishes identical cross-kind names by #ID without weakening canonical name uniqueness", () => {
		const organizations = state([
			record(1, "BAY", [4], false, "Shared visible name"),
			record(2, "AISLE", [1]),
			record(4, "AREA", [], false, "Shared visible name"),
		]);
		const index = prepared(organizations);
		const names = index.query({ searchText: "shared visible name" });
		advance(names);
		expect(names.finish().matches.map((item) => [item.id, item.role])).toEqual([
			[1, "BAY"],
			[4, "BAY_BANK"],
		]);
		const exact = index.query({ searchText: "#4" });
		advance(exact);
		expect(exact.finish().matches.map((item) => [item.id, item.role])).toEqual([[4, "BAY_BANK"]]);
		expect(exact.finish().selected).toEqual([]);
	});

	it("cancels exact #ID inside a missing-record read without revoking replacement queries", () => {
		const organizations = loops(2);
		let armed = false;
		let checks = 0;
		const index = prepared(organizations, () => {
			if (armed && ++checks === 2) query.cancel();
			return true;
		});
		const query: SourceBoundCooperativeTask<StaticFabCheckRepairTargetPage> = index.query({
			searchText: "#99",
		});
		query.step(1);
		armed = true;
		expectCode(() => query.step(128), "CANCELLED");
		let published: unknown;
		expectCode(() => {
			published = query.finish();
		}, "CANCELLED");
		expect(published).toBeUndefined();
		armed = false;
		const replacement = index.query({ searchText: "#2" });
		advance(replacement);
		expect(replacement.finish()).toMatchObject({
			queryStatus: "exact-id-match",
			selected: [],
			scannedRecordCount: 0,
		});
		expect(replacement.finish().matches[0]?.id).toBe(2);
	});

	it.each([
		1, 2,
	])("latches exact #ID cancellation in final source callback %i while returning true", (cancelAt) => {
		const organizations = loops(2);
		let finishing = false;
		let checks = 0;
		const index = prepared(organizations, () => {
			if (finishing && ++checks === cancelAt) query.cancel();
			return true;
		});
		const query: SourceBoundCooperativeTask<StaticFabCheckRepairTargetPage> = index.query({
			searchText: "#2",
		});
		advance(query);
		finishing = true;
		let published: unknown;
		expectCode(() => {
			published = query.finish();
		}, "CANCELLED");
		expect(published).toBeUndefined();
		finishing = false;
		const replacement = index.query({ searchText: "#1" });
		advance(replacement);
		expect(replacement.finish().matches[0]?.id).toBe(1);
	});

	it("rejects forged/foreign lookup without invoking caller functions or revoking the rightful source", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const forged = {
			...metadata,
			revoke: vi.fn(),
			semanticRole: vi.fn(),
		} as StaticFabOrganizationMetadataLookup;
		expectCode(
			() => createStaticFabCheckRepairTargetIndexPreparation(organizations, forged),
			"UNISSUED_LOOKUP",
		);
		expect(forged.revoke).not.toHaveBeenCalled();
		expect(forged.semanticRole).not.toHaveBeenCalled();
		expectCode(
			() =>
				createStaticFabCheckRepairTargetIndexPreparation(
					copyStaticFabOrganizationState(organizations),
					metadata,
				),
			"FOREIGN_SOURCE",
		);
		expect(metadata.record(1)?.id).toBe(1);
	});

	it("cancels during a guarded lookup inside options generator.next without reentrant close or publication", () => {
		const organizations = loops(2);
		let armed = false;
		let checks = 0;
		const metadata = lookup(organizations, () => {
			if (armed && ++checks === 3) task.cancel();
			return true;
		});
		const task: SourceBoundCooperativeTask<StaticFabCheckRepairTargetIndex> =
			createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		task.step(1);
		armed = true;
		expectCode(() => task.step(128), "CANCELLED");
		expectCode(() => task.finish(), "CANCELLED");
		expectCode(() => metadata.record(1), "REVOKED");
	});

	it("claims one lookup for one index and rejects duplicate index ownership", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const first = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		expectCode(
			() => createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata),
			"LOOKUP_ALREADY_OWNED",
		);
		advance(first);
		const index = first.finish();
		index.dispose();
		expectCode(() => metadata.record(1), "REVOKED");
		expectCode(
			() => createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata),
			"REVOKED",
		);
	});

	it.each([
		1, 2,
	])("releases the claimed lookup when index public finish is cancelled at final source check %i", (cancelAt) => {
		const organizations = loops(2);
		let finishing = false;
		let checks = 0;
		const metadata = lookup(organizations, () => {
			if (finishing && ++checks === cancelAt) task.cancel();
			return true;
		});
		const task: SourceBoundCooperativeTask<StaticFabCheckRepairTargetIndex> =
			createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		advance(task);
		finishing = true;
		let published: unknown;
		expectCode(() => {
			published = task.finish();
		}, "CANCELLED");
		expect(published).toBeUndefined();
		expectCode(() => metadata.record(1), "REVOKED");
		expectCode(
			() => createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata),
			"REVOKED",
		);
	});

	it("makes post-finish preparation cancellation harmless while explicit index disposal revokes once", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		advance(preparation);
		const index = preparation.finish();
		preparation.cancel();
		preparation.cancel();
		const query = index.query();
		advance(query);
		expect(query.finish().matches.map((item) => item.id)).toEqual([1, 2]);
		index.dispose();
		expectCode(() => metadata.record(1), "REVOKED");
	});

	it("does not let completed index-preparation cleanup revoke the handed-off index", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		advance(preparation);
		const index = preparation.finish();
		preparation.cancel();
		const page = index.query();
		advance(page);
		expect(page.finish().matches.map((item) => item.id)).toEqual([1, 2]);
		index.dispose();
		expectCode(() => metadata.record(1), "REVOKED");
	});

	it("releases an index when the preparation only reaches done before finish", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		while (!preparation.done) preparation.step(128);
		preparation.cancel();
		expectCode(() => metadata.record(1), "REVOKED");
	});

	it("releases the claimed lookup after a premature finish and later cancellation", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		expectCode(() => preparation.finish(), "NOT_COMPLETE");
		preparation.cancel();
		expectCode(() => metadata.record(1), "REVOKED");
	});

	it("cancellation during index preparation releases the claimed lookup without reactivation", () => {
		const organizations = loops(2);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		preparation.cancel();
		expectCode(() => preparation.finish(), "CANCELLED");
		expectCode(() => metadata.record(1), "REVOKED");
		expectCode(
			() => createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata),
			"REVOKED",
		);
	});

	it("keeps the index-owned lookup usable for advisory hierarchy reads without a second claim", () => {
		const organizations = state([...bay(1), ...bay(4)]);
		const metadata = lookup(organizations);
		const preparation = createStaticFabCheckRepairTargetIndexPreparation(organizations, metadata);
		advance(preparation);
		const index = preparation.finish();
		expect(
			staticFabAssemblyConnectorHierarchyEligibilityFromLookup(organizations, metadata, 1, 4),
		).toMatchObject({ valid: true, purpose: "HIERARCHY_LINK" });
		index.dispose();
		expectCode(
			() => staticFabAssemblyConnectorHierarchyEligibilityFromLookup(organizations, metadata, 1, 4),
			"REVOKED",
		);
	});

	it("query cancellation from lookup callback affects only that request, including selected missing row", () => {
		const organizations = loops(2);
		let armed = false;
		let checks = 0;
		const index = prepared(organizations, () => {
			if (armed && ++checks === 2) query.cancel();
			return true;
		});
		const query: SourceBoundCooperativeTask<StaticFabCheckRepairTargetPage> = index.query({
			selectedOrganizationIds: [99],
		});
		query.step(1);
		armed = true;
		expectCode(() => query.step(), "CANCELLED");
		expectCode(() => query.finish(), "CANCELLED");
		armed = false;
		const replacement = index.query();
		advance(replacement);
		expect(replacement.finish().matches).toHaveLength(2);
	});

	it("final source callback can dispose while returning true; stale/dispose never auto-reactivates", () => {
		const organizations = loops(2);
		let finishing = false;
		let checks = 0;
		const index: StaticFabCheckRepairTargetIndex = prepared(organizations, () => {
			if (finishing && ++checks === 2) index.dispose();
			return true;
		});
		const query = index.query();
		advance(query);
		finishing = true;
		let published: unknown;
		expectCode(() => {
			published = query.finish();
		}, "REVOKED");
		expect(published).toBeUndefined();
		let current = true;
		const stale = prepared(organizations, () => current);
		const pending = stale.query();
		pending.step(1);
		current = false;
		expectCode(() => pending.step(), "STALE_SOURCE");
		current = true;
		expectCode(() => stale.resolveSelected(1), "STALE_SOURCE");
		expect(prepared(organizations).organization(1)?.id).toBe(1);
	});

	it("owns bounded query inputs and freezes outputs without mutating caller/source", () => {
		const organizations = loops(2);
		const before = JSON.stringify(organizations);
		const index = prepared(organizations);
		const ids = [1, 1];
		const query = index.query({ selectedOrganizationIds: ids });
		advance(query);
		const page = query.finish();
		expect(page.selected.map((item) => item.organizationId)).toEqual([1, 1]);
		expect(page.matches.map((item) => item.id)).toEqual([2]);
		expect(ids).toEqual([1, 1]);
		expect(JSON.stringify(organizations)).toBe(before);
		for (const object of [
			index,
			page,
			page.matches,
			page.matches[0],
			page.selected,
			page.selected[0],
		])
			expect(Object.isFrozen(object)).toBe(true);
		for (const selectedOrganizationIds of [[0], [-1], [1.5], [0x80000000], [1, 1, 1]])
			expectCode(() => index.query({ selectedOrganizationIds }), "INVALID_QUERY");
		expectCode(() => index.query({ searchText: "x".repeat(121) }), "INVALID_QUERY");
		expectCode(() => index.query({ role: "FAB" as "BAY" }), "INVALID_QUERY");
	});
});
