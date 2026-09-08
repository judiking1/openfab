import { describe, expect, it } from "vitest";
import { completeCooperativeSteps } from "./CooperativeTask";
import {
	prepareRailHistoryAppendSteps,
	RAIL_MIRROR_HISTORY_ENTRY_LIMIT,
	RAIL_MIRROR_HISTORY_RELATIONSHIP_CANONICAL_BYTE_LIMIT,
	RAIL_MIRROR_HISTORY_RELATIONSHIP_EDGE_REFERENCE_LIMIT,
	RAIL_MIRROR_HISTORY_RELATIONSHIP_OWNER_ID_LIMIT,
	type RailMirrorHistoryLedgerEntry,
	trimRailMirrorHistoryRelationshipBudget,
} from "./RailPatchHistory";

const EMPTY: RailMirrorHistoryLedgerEntry = Object.freeze({
	originKind: "build",
	forwardFingerprint: "00000000:00000000",
	reverseFingerprint: "00000000:00000000",
	relationshipEdgeReferences: 0,
	relationshipOwnerIds: 0,
	relationshipCanonicalBytes: 0,
});
const fields = [
	["relationshipEdgeReferences", RAIL_MIRROR_HISTORY_RELATIONSHIP_EDGE_REFERENCE_LIMIT],
	["relationshipOwnerIds", RAIL_MIRROR_HISTORY_RELATIONSHIP_OWNER_ID_LIMIT],
	["relationshipCanonicalBytes", RAIL_MIRROR_HISTORY_RELATIONSHIP_CANONICAL_BYTE_LIMIT],
] as const;

function oldTrim(undo: RailMirrorHistoryLedgerEntry[], redo: RailMirrorHistoryLedgerEntry[]): void {
	const fits = () =>
		fields.every(
			([field, limit]) => [...undo, ...redo].reduce((sum, entry) => sum + entry[field], 0) <= limit,
		);
	while (!fits()) {
		if (undo.length > 0) undo.shift();
		else if (redo.length > 0) redo.shift();
		else break;
	}
}

const ledger = (entry: RailMirrorHistoryLedgerEntry) => entry;

describe("history retention preparation", () => {
	it("preserves oldest-undo-first eviction for each budget and mixed stacks", () => {
		for (const [field, limit] of fields) {
			for (let seed = 0; seed < 64; seed++) {
				const entries = Array.from({ length: 24 }, (_, index) =>
					Object.freeze({
						...EMPTY,
						forwardFingerprint: `${index.toString(16).padStart(8, "0")}:00000000`,
						[field]: Math.floor((((seed * 17 + index * 31) % 8) * limit) / 6),
					}),
				);
				const split = seed % (entries.length + 1);
				const undo = entries.slice(0, split);
				const redo = entries.slice(split);
				const expectedUndo = [...undo];
				const expectedRedo = [...redo];
				oldTrim(expectedUndo, expectedRedo);
				trimRailMirrorHistoryRelationshipBudget(undo, redo);
				expect(undo).toEqual(expectedUndo);
				expect(redo).toEqual(expectedRedo);
				for (let index = 0; index < undo.length; index++)
					expect(undo[index]).toBe(expectedUndo[index]);
				for (let index = 0; index < redo.length; index++)
					expect(redo[index]).toBe(expectedRedo[index]);
			}
		}
	});

	it("keeps exact budget boundaries and discards an oversized newest entry", () => {
		for (const [field, limit] of fields) {
			const exact = Object.freeze({ ...EMPTY, [field]: limit });
			const history = [EMPTY, exact];
			expect(
				completeCooperativeSteps(prepareRailHistoryAppendSteps(history, EMPTY, ledger)),
			).toEqual([EMPTY, exact, EMPTY]);
			const oversized = Object.freeze({ ...EMPTY, [field]: limit + 1 });
			expect(
				completeCooperativeSteps(prepareRailHistoryAppendSteps(history, oversized, ledger)),
			).toEqual([]);
			expect(history).toEqual([EMPTY, exact]);
		}
	});

	it("prepares the newest 100000 entries without mutating or reordering the source", () => {
		const history = Array.from({ length: RAIL_MIRROR_HISTORY_ENTRY_LIMIT }, (_, id) => ({
			id,
			ledger: EMPTY,
		}));
		const appended = { id: history.length, ledger: EMPTY };
		const originalFirst = history[0];
		const next = completeCooperativeSteps(
			prepareRailHistoryAppendSteps(history, appended, (entry) => entry.ledger),
		);
		expect(next).not.toBe(history);
		expect(next).toHaveLength(RAIL_MIRROR_HISTORY_ENTRY_LIMIT);
		expect(next[0]).toBe(history[1]);
		expect(next.at(-1)).toBe(appended);
		expect(history).toHaveLength(RAIL_MIRROR_HISTORY_ENTRY_LIMIT);
		expect(history[0]).toBe(originalFirst);
	});

	it("does not rescan a long evicted prefix for each removed entry", () => {
		let reads = 0;
		const large = Object.freeze({
			...EMPTY,
			get relationshipCanonicalBytes() {
				reads++;
				return 70 * 1024 * 1024;
			},
		});
		const history = [
			...Array.from({ length: RAIL_MIRROR_HISTORY_ENTRY_LIMIT - 2 }, () => EMPTY),
			large,
			large,
		];
		trimRailMirrorHistoryRelationshipBudget(history, []);
		expect(reads).toBeLessThanOrEqual(4);
		expect(history).toEqual([large]);
	});

	it("leaves the source intact when selection or retained-copy preparation is abandoned", () => {
		const history = Array.from({ length: 128 }, () => Object.freeze({ ...EMPTY }));
		for (const advances of [1, 64, 130, 200, 256]) {
			const steps = prepareRailHistoryAppendSteps(history, EMPTY, ledger);
			for (let index = 0; index < advances; index++) expect(steps.next().done).toBe(false);
			steps.return([]);
			expect(history).toHaveLength(128);
			expect(history.every((entry) => entry !== EMPTY)).toBe(true);
		}
		expect(() =>
			completeCooperativeSteps(prepareRailHistoryAppendSteps(history, EMPTY, ledger, 0)),
		).toThrow("positive safe integer");
	});
});
