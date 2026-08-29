import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";
import {
	collectTurnoutFootprints,
	STANDARD_BRANCH_TURNOUT_PROFILE,
	STANDARD_MERGE_TURNOUT_PROFILE,
	TURNOUT_KIND,
	turnoutFootprintAt,
	validateTurnoutFootprints,
} from "./turnout";

function put(map: TileMap, x: number, y: number, incoming: number, outgoing: number): void {
	map.setEncoded(x, y, encodeRailCell({ incoming, outgoing }));
}

describe("turnout footprints", () => {
	it("derives branch lead cells and path trims in every travel role", () => {
		const footprint = turnoutFootprintAt(
			{ x: 4, y: 7 },
			{ incoming: DIR_W, outgoing: DIR_E | DIR_S },
		);

		expect(footprint).toMatchObject({
			kind: TURNOUT_KIND.BRANCH,
			through: { incoming: DIR_W, outgoing: DIR_E },
			divergingSide: DIR_S,
			curveFrom: DIR_W,
			curveTo: DIR_S,
			profileId: STANDARD_BRANCH_TURNOUT_PROFILE.id,
			leadInMeters: 0.4,
			leadOutMeters: 0.4,
			reservedCells: [
				{ x: 3, y: 7 },
				{ x: 4, y: 7 },
				{ x: 4, y: 8 },
			],
		});
		expect(footprint?.trims).toEqual([
			{
				cell: { x: 3, y: 7 },
				from: DIR_W,
				to: DIR_E,
				startInsetMeters: 0,
				endInsetMeters: 0.4,
			},
			{
				cell: { x: 4, y: 8 },
				from: DIR_N,
				to: DIR_S,
				startInsetMeters: 0.4,
				endInsetMeters: 0,
			},
		]);
	});

	it("derives merge lead cells on the incoming branch and common outgoing trunk", () => {
		const footprint = turnoutFootprintAt(
			{ x: 4, y: 7 },
			{ incoming: DIR_W | DIR_N, outgoing: DIR_E },
		);

		expect(footprint).toMatchObject({
			kind: TURNOUT_KIND.MERGE,
			profileId: STANDARD_MERGE_TURNOUT_PROFILE.id,
			leadInMeters: 0.4,
			leadOutMeters: 0.4,
			divergingSide: DIR_N,
			curveFrom: DIR_N,
			curveTo: DIR_E,
			reservedCells: [
				{ x: 4, y: 6 },
				{ x: 4, y: 7 },
				{ x: 5, y: 7 },
			],
		});
	});

	it("requires straight support cells for both 400 mm leads", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_W, DIR_E | DIR_S);
		put(map, -1, 0, DIR_W, DIR_E);
		put(map, 0, 1, DIR_N, DIR_S);
		const footprints = collectTurnoutFootprints(map);
		expect(validateTurnoutFootprints((x, y) => map.getRail(x, y), footprints)).toEqual([]);

		put(map, 0, 1, DIR_N, DIR_E);
		expect(validateTurnoutFootprints((x, y) => map.getRail(x, y), footprints)).toContainEqual(
			expect.objectContaining({ code: "MISSING_STRAIGHT_LEAD" }),
		);
	});

	it("rejects footprints that reserve the same support cell", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_W, DIR_E | DIR_S);
		put(map, -1, 0, DIR_W, DIR_E);
		put(map, 0, 1, DIR_N | DIR_W, DIR_S);
		const footprints = collectTurnoutFootprints(map);
		const issues = validateTurnoutFootprints((x, y) => map.getRail(x, y), footprints);

		expect(footprints).toHaveLength(2);
		expect(issues.some((issue) => issue.code === "OVERLAPPING_FOOTPRINT")).toBe(true);
	});
});
