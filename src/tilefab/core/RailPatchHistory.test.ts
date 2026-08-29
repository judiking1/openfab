import { describe, expect, it } from "vitest";
import {
	appendBoundedRailHistoryEntry,
	copyRailMirrorHistoryLedger,
	createRailMirrorHistoryLedgerEntry,
	createRailMirrorHistoryLedgerEntryCooperatively,
	RAIL_MIRROR_HISTORY_ENTRY_LIMIT,
	type RailMirrorHistoryLedgerEntry,
	railPatchTransitionFingerprint,
	railPatchTransitionFingerprintCooperatively,
} from "./RailPatchHistory";
import type { StaticFabOrganizationRecord } from "./StaticFabOrganization";
import {
	cachedStaticFabOrganizationMembershipFingerprint,
	cacheStaticFabOrganizationMembershipFingerprint,
	createStaticFabOrganizationMembershipFingerprintAccumulator,
	staticFabOrganizationFingerprint,
	staticFabOrganizationMembershipFingerprint,
} from "./StaticFabOrganizationFingerprint";

const ENTRY: RailMirrorHistoryLedgerEntry = Object.freeze({
	originKind: "build",
	forwardFingerprint: "00000000:00000000",
	reverseFingerprint: "00000000:00000000",
});

describe("RailPatchHistory", () => {
	it("keeps the newest entries when a bounded authored history reaches capacity", () => {
		const history = [1, 2, 3];

		appendBoundedRailHistoryEntry(history, 4, 3);

		expect(history).toEqual([2, 3, 4]);
		expect(() => appendBoundedRailHistoryEntry(history, 5, 0)).toThrow("positive safe integer");
	});

	it("rejects oversized and sparse synchronization ledgers", () => {
		const oversized: RailMirrorHistoryLedgerEntry[] = [];
		oversized.length = RAIL_MIRROR_HISTORY_ENTRY_LIMIT + 1;
		expect(() => copyRailMirrorHistoryLedger({ undo: oversized, redo: [] })).toThrow(
			"exceeds its entry budget",
		);

		const sparse: RailMirrorHistoryLedgerEntry[] = [];
		sparse.length = 1;
		expect(() => copyRailMirrorHistoryLedger({ undo: sparse, redo: [] })).toThrow(
			"ledger entry is malformed",
		);
	});

	it("fingerprints reversible deltas independently from the monotonic organization cursor", async () => {
		const transition = {
			changes: [],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: [],
			organizationNextIdBefore: 1,
			organizationNextIdAfter: 2,
			organizationImpactAuthorizations: [],
		};

		const changedCursorTransition = {
			...transition,
			organizationNextIdBefore: 9,
			organizationNextIdAfter: 9,
		};
		expect(railPatchTransitionFingerprint(changedCursorTransition)).toBe(
			railPatchTransitionFingerprint(transition),
		);
		let checkpoints = 0;
		expect(
			await railPatchTransitionFingerprintCooperatively(
				changedCursorTransition,
				async () => {
					checkpoints++;
				},
				1,
			),
		).toBe(railPatchTransitionFingerprint(transition));
		expect(checkpoints).toBe(1);
		expect(
			await createRailMirrorHistoryLedgerEntryCooperatively(
				"build",
				changedCursorTransition,
				async () => {
					checkpoints++;
				},
				1,
			),
		).toEqual(createRailMirrorHistoryLedgerEntry("build", transition));
		expect(checkpoints).toBe(3);
	});

	it("reuses a validated immutable membership digest for metadata history", () => {
		let membershipReads = 0;
		const railEdges = new Proxy(
			[Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) })],
			{
				get(target, property, receiver) {
					if (
						property === Symbol.iterator ||
						(typeof property === "string" && /^\d+$/.test(property))
					) {
						membershipReads++;
					}
					return Reflect.get(target, property, receiver);
				},
			},
		);
		Object.freeze(railEdges);
		const membership = Object.freeze({
			railEdges,
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		});
		const before = Object.freeze({
			id: 1,
			kind: "AREA",
			name: "Factory Envelope",
			membership,
		}) satisfies StaticFabOrganizationRecord;
		const after = Object.freeze({ ...before, name: "North Production Hall" });
		staticFabOrganizationFingerprint(before);
		membershipReads = 0;
		const transition = organizationTransition(before, after);

		const forward = railPatchTransitionFingerprint(transition);
		const reverse = railPatchTransitionFingerprint(transition, true);

		expect(membershipReads).toBe(0);
		expect(forward).not.toBe(reverse);
		const cloneableMembership = Object.freeze({
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ x: 0, y: 0 }),
					to: Object.freeze({ x: 1, y: 0 }),
				}),
			]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		});
		const cloneableBefore = Object.freeze({ ...before, membership: cloneableMembership });
		const cloneableAfter = Object.freeze({ ...after, membership: cloneableMembership });
		const cloneableTransition = organizationTransition(cloneableBefore, cloneableAfter);
		const ledger = createRailMirrorHistoryLedgerEntry(
			"rename-static-fab-organization",
			cloneableTransition,
		);
		expect(
			createRailMirrorHistoryLedgerEntry(
				"rename-static-fab-organization",
				structuredClone(cloneableTransition),
			),
		).toEqual(ledger);
		expect(
			railPatchTransitionFingerprint(
				organizationTransition(before, Object.freeze({ ...after, name: "Forged Name" })),
			),
		).not.toBe(forward);
		const changedMembership = Object.freeze({
			...membership,
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ x: 0, y: 0 }),
					to: Object.freeze({ x: 2, y: 0 }),
				}),
			]),
		});
		expect(
			railPatchTransitionFingerprint(
				organizationTransition(before, Object.freeze({ ...after, membership: changedMembership })),
			),
		).not.toBe(forward);
	});

	it("builds the cooperative membership digest identically to the direct encoder", () => {
		const membership = Object.freeze({
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ x: -2, y: 3 }),
					to: Object.freeze({ x: -1, y: 3 }),
				}),
				Object.freeze({
					from: Object.freeze({ x: -1, y: 3 }),
					to: Object.freeze({ x: -1, y: 4 }),
				}),
			]),
			advancedSwitchIds: Object.freeze([7, 11]),
			equipmentGroupIds: Object.freeze([13]),
		});
		const accumulator = createStaticFabOrganizationMembershipFingerprintAccumulator();
		membership.railEdges.forEach((edge, index) => {
			accumulator.addRailEdge(index, edge);
		});
		membership.advancedSwitchIds.forEach((id, index) => {
			accumulator.addAdvancedSwitchId(index, id);
		});
		membership.equipmentGroupIds.forEach((id, index) => {
			accumulator.addEquipmentGroupId(index, id);
		});

		expect(accumulator.finish()).toEqual(staticFabOrganizationMembershipFingerprint(membership));
	});

	it("copies uint32 cache entries and rejects conflicting or malformed digests", () => {
		const membership = Object.freeze({
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ x: 0, y: 0 }),
					to: Object.freeze({ x: 1, y: 0 }),
				}),
			]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		});
		const fingerprint = staticFabOrganizationMembershipFingerprint(membership);
		const mutableInput = { ...fingerprint };
		cacheStaticFabOrganizationMembershipFingerprint(membership, mutableInput);
		mutableInput.xor = mutableInput.xor ^ 1;

		expect(cachedStaticFabOrganizationMembershipFingerprint(membership)).toEqual(fingerprint);
		expect(Object.isFrozen(cachedStaticFabOrganizationMembershipFingerprint(membership))).toBe(
			true,
		);
		expect(() =>
			cacheStaticFabOrganizationMembershipFingerprint(membership, {
				xor: (fingerprint.xor ^ 1) >>> 0,
				sum: fingerprint.sum,
			}),
		).toThrow("conflicts with its cache");
		expect(() =>
			cacheStaticFabOrganizationMembershipFingerprint(membership, {
				xor: -1,
				sum: fingerprint.sum,
			}),
		).toThrow("uint32 pair");
	});

	it("copies and freezes a valid synchronization ledger", () => {
		const copied = copyRailMirrorHistoryLedger({ undo: [ENTRY], redo: [] });

		expect(copied).toEqual({ undo: [ENTRY], redo: [] });
		expect(copied.undo[0]).not.toBe(ENTRY);
		expect(Object.isFrozen(copied)).toBe(true);
		expect(Object.isFrozen(copied.undo)).toBe(true);
		expect(Object.isFrozen(copied.undo[0])).toBe(true);
	});
});

function organizationTransition(
	before: StaticFabOrganizationRecord,
	after: StaticFabOrganizationRecord,
) {
	return {
		changes: [],
		switchChanges: [],
		portChanges: [],
		equipmentGroupChanges: [],
		organizationChanges: [Object.freeze({ id: before.id, before, after })],
		organizationNextIdBefore: 2,
		organizationNextIdAfter: 2,
		organizationImpactAuthorizations: [],
	};
}
