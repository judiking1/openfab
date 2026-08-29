import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	advancedSwitchAllowsMovement,
	deriveAdvancedSwitchGeometry,
	validateAdvancedSwitchPatch,
} from "./AdvancedSwitch";
import type { RailConstructionPlan } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	oppositeDirection,
} from "./railShape";
import { TileMap } from "./TileMap";
import {
	collectTurnoutFootprints,
	isAuthorizedAdvancedSwitchTurnoutOverlap,
	TURNOUT_KIND,
	validateTurnoutFootprints,
} from "./turnout";

const classes: readonly AdvancedSwitchProfileClass[] = ["A", "B", "C", "D"];

function leftOf(direction: (typeof ALL_DIRECTIONS)[number]): (typeof ALL_DIRECTIONS)[number] {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}

function fixture(
	profileClass: AdvancedSwitchProfileClass,
	forward: (typeof ALL_DIRECTIONS)[number] = DIR_E,
	lateral: (typeof ALL_DIRECTIONS)[number] = DIR_S,
): AdvancedSwitchRecord {
	return {
		id: 17,
		profileClass,
		origin: { x: 11, y: -7 },
		forward,
		lateral,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
}

describe("advanced switch catalog and geometry", () => {
	it("derives A-D in every quarter-turn and both lateral sides without a degree-four cell", () => {
		for (const profileClass of classes) {
			for (const forward of ALL_DIRECTIONS) {
				for (const lateral of [leftOf(forward), oppositeDirection(leftOf(forward))]) {
					const geometry = deriveAdvancedSwitchGeometry(fixture(profileClass, forward, lateral));
					expect(geometry.mainPath).toHaveLength(7);
					expect(geometry.ports).toHaveLength(4);
					expect(geometry.reservedCells.length).toBeGreaterThanOrEqual(5);
					expect(new Set(geometry.claimedCells.map((cell) => `${cell.x},${cell.y}`))).toEqual(
						new Set(
							[...geometry.occupiedCells, ...geometry.reservedCells].map(
								(cell) => `${cell.x},${cell.y}`,
							),
						),
					);
					expect(
						geometry.cellStates.every((cell) => bitCount(cell.incoming | cell.outgoing) < 4),
					).toBe(true);
				}
			}
		}
	});

	it("stores an explicit complete input-index by output-index movement matrix", () => {
		const switchRecord = fixture("A");
		for (const input of [0, 1] as const) {
			for (const output of [0, 1] as const) {
				expect(advancedSwitchAllowsMovement(switchRecord, input, output)).toBe(true);
			}
		}
	});
});

describe("advanced switch TileMap sidecar", () => {
	it("shares revision state with rail chunks and clones stable metadata", () => {
		const map = new TileMap();
		const switchRecord = fixture("D");
		const before = map.getRevision();
		expect(map.setAdvancedSwitch(switchRecord)).toBe(true);
		expect(map.getRevision()).toBe(before + 1);
		expect(map.advancedSwitchCount).toBe(1);
		expect(map.getAdvancedSwitchOwningCell(11, -7)?.id).toBe(17);

		const clone = map.clone();
		expect(clone.getAdvancedSwitch(17)).toEqual(map.getAdvancedSwitch(17));
		expect(clone.getNextAdvancedSwitchId()).toBe(18);
		expect(clone.deleteAdvancedSwitch(17)).toBe(true);
		expect(map.getAdvancedSwitch(17)?.profileClass).toBe("D");
	});

	it("restores revision and switch-id allocation after an atomic rollback", () => {
		const map = new TileMap();
		const record = fixture("A");
		const checkpoint = map.createMutationCheckpoint();
		const mutations = [{ id: record.id, before: null, after: record }] as const;

		expect(map.applyAtomicMutations([], mutations)).toBe(true);
		expect(map.getNextAdvancedSwitchId()).toBe(record.id + 1);
		map.rollbackAtomicMutations([], mutations, checkpoint);

		expect(map.getRevision()).toBe(0);
		expect(map.getNextAdvancedSwitchId()).toBe(1);
		expect(map.advancedSwitchCount).toBe(0);
	});

	it("atomically swaps two ownership footprints vacated by the same batch", () => {
		const document = new RailDocument();
		const first = { ...fixture("A"), id: 17, origin: { x: 0, y: 0 } };
		const second = { ...fixture("A"), id: 29, origin: { x: 20, y: 0 } };
		for (const record of [first, second]) {
			for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
				document.map.setEncoded(cell.x, cell.y, cell.encoded);
			}
			document.map.setAdvancedSwitch(record);
		}
		const firstAfter = { ...first, origin: second.origin };
		const secondAfter = { ...second, origin: first.origin };
		const switchMutations = [
			{ id: first.id, before: first, after: firstAfter },
			{ id: second.id, before: second, after: secondAfter },
		];
		expect(validateAdvancedSwitchPatch(document.map, [], switchMutations)).toEqual([]);
		const plan: RailConstructionPlan = {
			kind: "build",
			baseRevision: document.map.getRevision(),
			cells: [],
			mutations: [],
			switchMutations,
			valid: true,
			reason: "ownership swap",
			conflicts: [],
			newEdges: 0,
			lengthMeters: 0,
			turns: 0,
			bend: "horizontal-first",
		};
		const beforeRevision = document.map.getRevision();
		expect(document.commit(plan)).toBe(true);
		expect(document.map.getRevision()).toBe(beforeRevision + 2);
		expect(document.map.getAdvancedSwitchOwningCell(0, 0)?.id).toBe(second.id);
		expect(document.map.getAdvancedSwitchOwningCell(20, 0)?.id).toBe(first.id);
		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitchOwningCell(0, 0)?.id).toBe(first.id);
		expect(document.map.getAdvancedSwitchOwningCell(20, 0)?.id).toBe(second.id);
	});
});

describe("advanced switch turnout overlap", () => {
	it("authorizes exactly the owning merge/branch shared support", () => {
		const map = new TileMap();
		const switchRecord = fixture("A");
		const geometry = deriveAdvancedSwitchGeometry(switchRecord);
		for (const cell of geometry.cellStates) map.setEncoded(cell.x, cell.y, cell.encoded);
		map.setAdvancedSwitch(switchRecord);

		const footprints = collectTurnoutFootprints(map);
		const merge = footprints.find((footprint) => footprint.kind === TURNOUT_KIND.MERGE);
		const branch = footprints.find((footprint) => footprint.kind === TURNOUT_KIND.BRANCH);
		expect(merge).toBeDefined();
		expect(branch).toBeDefined();
		if (!merge || !branch) throw new Error("expected one merge and one branch footprint");
		expect(
			isAuthorizedAdvancedSwitchTurnoutOverlap(switchRecord, merge, branch, [
				geometry.sharedTrunkSupport,
			]),
		).toBe(true);
		expect(isAuthorizedAdvancedSwitchTurnoutOverlap(switchRecord, merge, branch, [])).toBe(false);
		expect(
			validateTurnoutFootprints((x, y) => map.getRail(x, y), footprints, [switchRecord]),
		).toEqual([]);
	});
});
