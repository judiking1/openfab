import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceBoundCooperativeTask } from "./SourceBoundCooperativeTask";
import {
	advance,
	expectCode,
	lookup,
	loops,
	record,
	state,
} from "./StaticFabCheckRepair.test-fixtures";
import * as organizationsModule from "./StaticFabOrganization";
import {
	copyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationMetadataLookupCurrent,
	createStaticFabOrganizationMetadataLookupPreparation,
	type StaticFabOrganizationMetadataLookup,
} from "./StaticFabOrganizationMetadataLookup";

afterEach(() => vi.restoreAllMocks());

describe("issued canonical organization metadata", () => {
	it("is lazy and delegates canonical semantics once while retaining exact immutable records", () => {
		const organizations = state([
			record(1, "AISLE", [], true),
			record(2, "BAY", [4]),
			record(3, "AISLE", [2]),
			record(4, "AREA", [5]),
			record(5, "AREA"),
		]);
		const derive = vi.spyOn(organizationsModule, "deriveStaticFabOrganizationSemanticRoleSteps");
		const current = vi.fn((source: StaticFabOrganizationState) => source === organizations);
		const task = createStaticFabOrganizationMetadataLookupPreparation(organizations, current);
		expect(derive).not.toHaveBeenCalled();
		expect(current).not.toHaveBeenCalled();
		task.step(1);
		expect(derive).not.toHaveBeenCalled();
		advance(task);
		const issued = task.finish();
		expect(derive).toHaveBeenCalledTimes(1);
		expect(issued.organizations).toBe(organizations);
		expect(issued.record(2)).toBe(organizations.records[1]);
		expect(issued.semanticRole(1)).toBe("PROCESS_LOOP");
		expect(issued.semanticRole(2)).toBe("BAY");
		expect(issued.semanticRole(4)).toBe("BAY_BANK");
		expect(issued.semanticRole(5)).toBe("FAB");
		expect(derive).toHaveBeenCalledTimes(1);
		expect(Object.isFrozen(issued)).toBe(true);
	});

	it("rejects raw/frozen lookalikes and duplicate identities without issuing a lookup", () => {
		const canonical = state([record(1, "AISLE", [], true)]);
		for (const raw of [
			{ ...canonical },
			Object.freeze({ ...canonical, records: Object.freeze([...canonical.records]) }),
			Object.freeze({
				nextOrganizationId: 2,
				records: Object.freeze([canonical.records[0], canonical.records[0]]),
			}),
		]) {
			const task = createStaticFabOrganizationMetadataLookupPreparation(
				raw as StaticFabOrganizationState,
				() => true,
			);
			expectCode(() => task.step(), "NON_CANONICAL_SOURCE");
			expectCode(() => task.finish(), "NON_CANONICAL_SOURCE");
		}
		expect(() =>
			copyStaticFabOrganizationState({
				nextOrganizationId: 2,
				records: [
					canonical.records[0] as organizationsModule.StaticFabOrganizationRecord,
					canonical.records[0] as organizationsModule.StaticFabOrganizationRecord,
				],
			}),
		).toThrow();
	});

	it("checks provenance before calling properties/functions and rejects a same-content foreign source", () => {
		const organizations = loops(2);
		const issued = lookup(organizations);
		const foreign = copyStaticFabOrganizationState(organizations);
		expectCode(
			() => assertStaticFabOrganizationMetadataLookupCurrent(issued, foreign),
			"FOREIGN_SOURCE",
		);
		expect(issued.record(1)?.id).toBe(1);
		expectCode(
			() => assertStaticFabOrganizationMetadataLookupCurrent({ ...issued }, organizations),
			"UNISSUED_LOOKUP",
		);
		let reads = 0;
		const proxy = new Proxy(issued, {
			get(target, property, receiver) {
				reads++;
				return Reflect.get(target, property, receiver);
			},
		});
		expectCode(
			() => assertStaticFabOrganizationMetadataLookupCurrent(proxy, organizations),
			"UNISSUED_LOOKUP",
		);
		expect(reads).toBe(0);
		issued.revoke();
		expectCode(() => issued.record(1), "REVOKED");
		expectCode(
			() => assertStaticFabOrganizationMetadataLookupCurrent(issued, organizations),
			"REVOKED",
		);
	});

	for (const boundary of [1, 2]) {
		it(`latches callback revocation at lookup read boundary ${boundary} even when callback returns true`, () => {
			const organizations = loops(2);
			let active = false;
			let calls = 0;
			const issued: StaticFabOrganizationMetadataLookup = lookup(organizations, () => {
				if (active && ++calls === boundary) issued.revoke();
				return true;
			});
			active = true;
			expectCode(() => issued.record(1), "REVOKED");
			expect(calls).toBe(boundary);
		});

		it(`prevents issuing a final result when source callback cancels at finish boundary ${boundary}`, () => {
			const organizations = loops(2);
			let finishing = false;
			let calls = 0;
			const task: SourceBoundCooperativeTask<StaticFabOrganizationMetadataLookup> =
				createStaticFabOrganizationMetadataLookupPreparation(organizations, () => {
					if (finishing && ++calls === boundary) task.cancel();
					return true;
				});
			advance(task);
			finishing = true;
			let published: StaticFabOrganizationMetadataLookup | undefined;
			expectCode(() => {
				published = task.finish();
			}, "CANCELLED");
			expect(published).toBeUndefined();
		});
	}

	it("stales permanently after source generation replacement, including a same organizations reference", () => {
		const organizations = loops(2);
		let generation = 1;
		const issued = lookup(organizations, (source) => source === organizations && generation === 1);
		generation = 2;
		expectCode(() => issued.semanticRole(1), "STALE_SOURCE");
		generation = 1;
		expectCode(() => issued.record(1), "STALE_SOURCE");
		const current = lookup(organizations);
		expect(current.record(1)?.id).toBe(1);
		issued.revoke();
		expect(current.record(1)?.id).toBe(1);
	});

	it("does not grant a direct owner lease to an unowned stale lookup", () => {
		const organizations = loops(2);
		let current = true;
		const issued = lookup(organizations, () => current);
		current = false;
		expectCode(() => issued.claim(), "STALE_SOURCE");
		current = true;
		expectCode(() => issued.claim(), "REVOKED");
	});

	it("reports live duplicate ownership before terminal revoke, then terminal REVOKED", () => {
		const organizations = loops(2);
		const issued = lookup(organizations);
		const lease = issued.claim();
		expectCode(() => issued.claim(), "LOOKUP_ALREADY_OWNED");
		lease.release();
		expect(lease.released).toBe(true);
		expectCode(() => issued.claim(), "REVOKED");
		issued.revoke();
		expectCode(() => issued.claim(), "REVOKED");
	});

	it("claims one downstream owner and ignores late preparation cleanup after handoff", () => {
		const organizations = loops(2);
		const preparation = createStaticFabOrganizationMetadataLookupPreparation(
			organizations,
			() => true,
		);
		advance(preparation);
		const issued = preparation.finish();
		const lease = issued.claim();
		expect(lease.lookup).toBe(issued);
		expect(lease.released).toBe(false);
		expectCode(() => issued.claim(), "LOOKUP_ALREADY_OWNED");
		preparation.cancel();
		expect(issued.record(1)?.id).toBe(1);
		lease.release();
		expect(lease.released).toBe(true);
		expectCode(() => issued.record(1), "REVOKED");
		expectCode(() => issued.claim(), "REVOKED");
	});

	it("releases a claimed lookup on explicit source revocation and never reactivates it", () => {
		const organizations = loops(2);
		const issued = lookup(organizations);
		const lease = issued.claim();
		issued.revoke();
		expect(lease.released).toBe(true);
		expectCode(() => issued.record(1), "REVOKED");
		expectCode(() => issued.claim(), "REVOKED");
	});
});
