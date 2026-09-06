import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { ALL_DIRECTIONS, DIR_E, DIR_N, oppositeDirection } from "./railShape";
import { cellKey, TileMap } from "./TileMap";
import {
	collectTurnoutFootprints,
	isAuthorizedAdvancedSwitchTurnoutOverlap,
	validateTurnoutFootprints,
} from "./turnout";

describe("advanced switch turnout candidate indexing", () => {
	it("preserves exact overlap authorization across every profile, orientation, and chirality", () => {
		const records: AdvancedSwitchRecord[] = [];
		for (const profileClass of ADVANCED_SWITCH_PROFILE_CLASSES)
			for (const forward of ALL_DIRECTIONS)
				for (const lateral of ALL_DIRECTIONS) {
					if (lateral === forward || lateral === oppositeDirection(forward)) continue;
					records.push({
						id: records.length + 1,
						profileClass,
						origin: { x: records.length * 20 - 320, y: -100 },
						forward,
						lateral,
						movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
					});
				}
		const map = fixtureMap(records);
		const footprints = collectTurnoutFootprints(map);
		const read = (x: number, y: number) => map.getRail(x, y);
		const missingOwners = validateTurnoutFootprints(read, footprints);
		expect(missingOwners.filter((issue) => issue.code === "OVERLAPPING_FOOTPRINT")).toHaveLength(
			records.length,
		);
		expect(validateTurnoutFootprints(read, footprints, [...records].reverse())).toEqual([]);
		const available = records.filter((_, index) => index % 3 !== 0);
		const byAnchor = new Map(
			footprints.map((footprint) => [cellKey(footprint.cell.x, footprint.cell.y), footprint]),
		);
		const expected = missingOwners.filter((issue) => {
			if (issue.code !== "OVERLAPPING_FOOTPRINT") return true;
			const [leftCell, rightCell, ...overlapCells] = issue.cells;
			if (!leftCell || !rightCell) throw new Error("Overlap issue lacks its two anchors.");
			const left = byAnchor.get(cellKey(leftCell.x, leftCell.y));
			const right = byAnchor.get(cellKey(rightCell.x, rightCell.y));
			if (!left || !right) throw new Error("Overlap issue references an unknown footprint.");
			return !available.some((record) =>
				isAuthorizedAdvancedSwitchTurnoutOverlap(record, left, right, overlapCells),
			);
		});
		expect(expected).toHaveLength(11);
		expect(validateTurnoutFootprints(read, footprints, available)).toEqual(expected);
	});

	it("keeps all candidates at one anchor and does not reuse authority after an input changes", () => {
		const record: AdvancedSwitchRecord = {
			id: 1,
			profileClass: "B",
			origin: { x: -20, y: 30 },
			forward: DIR_N,
			lateral: DIR_E,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		};
		const map = fixtureMap([record]);
		const footprints = collectTurnoutFootprints(map);
		const read = (x: number, y: number) => map.getRail(x, y);
		const invalid = { ...record, id: 0 };
		const wrongSide = { ...record, id: 2, lateral: oppositeDirection(record.lateral) };
		expect(validateTurnoutFootprints(read, footprints, [invalid, wrongSide, record])).toEqual([]);
		expect(validateTurnoutFootprints(read, footprints, [record, wrongSide, invalid])).toEqual([]);
		expect(validateTurnoutFootprints(read, footprints, [invalid, wrongSide])).toEqual(
			validateTurnoutFootprints(read, footprints),
		);
		expect(
			validateTurnoutFootprints(read, footprints, [{ ...record, origin: { x: 200, y: 30 } }]),
		).toEqual(validateTurnoutFootprints(read, footprints));
	});
	it("still rejects a second shared footprint cell even for the correct owning anchors", () => {
		const record: AdvancedSwitchRecord = {
			id: 1,
			profileClass: "B",
			origin: { x: -20, y: 30 },
			forward: DIR_N,
			lateral: DIR_E,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		};
		const map = fixtureMap([record]);
		const footprints = collectTurnoutFootprints(map).map((footprint) => ({
			...footprint,
			reservedCells: [...footprint.reservedCells, { x: 200, y: 200 }],
		}));
		const read = (x: number, y: number) => map.getRail(x, y);
		const expected = validateTurnoutFootprints(read, footprints);
		expect(expected.filter((issue) => issue.code === "OVERLAPPING_FOOTPRINT")).toHaveLength(1);
		expect(validateTurnoutFootprints(read, footprints, [record])).toEqual(expected);
	});
});

function fixtureMap(records: readonly AdvancedSwitchRecord[]): TileMap {
	const hydrator = TileMap.createHydrator();
	for (const record of records) {
		for (const cell of deriveAdvancedSwitchGeometry(record).cellStates)
			hydrator.addEncodedCell(cell.x, cell.y, cell.encoded);
		hydrator.addAdvancedSwitch(record);
	}
	return hydrator.finish(0);
}
