import { describe, expect, it } from "vitest";
import {
	materializeClosedPairedRailCorridorRoute,
	PAIRED_RAIL_CORRIDOR_MAXIMUM_LENGTH_METERS,
	type PairedRailCorridorEndpointDescriptor,
	type PairedRailCorridorEndpointId,
	type PairedRailCorridorPlan,
	type PairedRailCorridorRequest,
	pairedRailCorridorFingerprint,
	planPairedRailCorridor,
	validatePairedRailCorridorRequest,
} from "./PairedRailCorridorPlanner";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

describe("PairedRailCorridorPlanner", () => {
	it.each([
		["east", DIR_E, { x: 14, y: -5 }, { x: 10, y: -3 }],
		["south", DIR_S, { x: 10, y: -1 }, { x: 8, y: -5 }],
		["west", DIR_W, { x: 6, y: -5 }, { x: 10, y: -7 }],
		["north", DIR_N, { x: 10, y: -9 }, { x: 12, y: -5 }],
	] satisfies readonly [
		string,
		Direction,
		Cell,
		Cell,
	][])("rotates the paired footprint toward %s on the cardinal grid", (_name, forward, expectedFar, expectedSecondaryOrigin) => {
		const plan = planPairedRailCorridor(
			request({ anchor: { x: 10, y: -5 }, pose: { forward, side: "right" } }),
		);

		expect(endpoint(plan, "primary-far").cell).toEqual(expectedFar);
		expect(endpoint(plan, "secondary-origin").cell).toEqual(expectedSecondaryOrigin);
		expect(plan.lanes[0].cells).toHaveLength(5);
		expect(plan.lanes[1].cells).toHaveLength(5);
		for (const lane of plan.lanes) {
			for (let index = 0; index < lane.cells.length - 1; index++) {
				expect(directionBetween(lane.cells[index] as Cell, lane.cells[index + 1] as Cell)).toBe(
					lane.travelDirection,
				);
			}
		}
	});

	it("mirrors only the secondary lane when the pose side changes", () => {
		const right = planPairedRailCorridor(request({ pose: { forward: DIR_E, side: "right" } }));
		const left = planPairedRailCorridor(request({ pose: { forward: DIR_E, side: "left" } }));

		expect(right.lanes[0].cells).toEqual(left.lanes[0].cells);
		expect(endpoint(right, "secondary-origin").cell).toEqual({ x: 0, y: 2 });
		expect(endpoint(left, "secondary-origin").cell).toEqual({ x: 0, y: -2 });
	});

	it("authors opposite lane flow and reverses both lanes without moving the footprint", () => {
		const forward = planPairedRailCorridor(request());
		const reversed = planPairedRailCorridor(
			request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
		);

		expect(forward.lanes[0].travelDirection).toBe(DIR_E);
		expect(forward.lanes[1].travelDirection).toBe(DIR_W);
		expect(reversed.lanes[0].travelDirection).toBe(DIR_W);
		expect(reversed.lanes[1].travelDirection).toBe(DIR_E);
		expect(forward.lanes[1].travelDirection).toBe(
			oppositeDirection(forward.lanes[0].travelDirection),
		);
		expect(reversed.lanes[1].travelDirection).toBe(
			oppositeDirection(reversed.lanes[0].travelDirection),
		);
		expect(reversed.lanes[0].cells).toEqual([...forward.lanes[0].cells].reverse());
		expect(reversed.lanes[1].cells).toEqual([...forward.lanes[1].cells].reverse());
		expect(sortCells(reversed.occupiedCells)).toEqual(sortCells(forward.occupiedCells));
		expect(endpoint(reversed, "primary-origin")).toMatchObject({
			flowRole: "exit",
			gatewayRole: "merge",
		});
		expect(endpoint(reversed, "secondary-origin")).toMatchObject({
			flowRole: "entry",
			gatewayRole: "branch",
		});
	});

	it("describes one branch and one merge endpoint at each physical end", () => {
		const plan = planPairedRailCorridor(request());

		expect(plan.endpoints).toEqual([
			expect.objectContaining({
				id: "primary-origin",
				cell: { x: 0, y: 0 },
				end: "origin",
				flowRole: "entry",
				gatewayRole: "branch",
				travelDirection: DIR_E,
				outwardDirection: DIR_W,
				pairedEndpointId: "secondary-origin",
			}),
			expect.objectContaining({
				id: "secondary-origin",
				cell: { x: 0, y: 2 },
				end: "origin",
				flowRole: "exit",
				gatewayRole: "merge",
				travelDirection: DIR_W,
				outwardDirection: DIR_W,
				pairedEndpointId: "primary-origin",
			}),
			expect.objectContaining({
				id: "primary-far",
				cell: { x: 4, y: 0 },
				end: "far",
				flowRole: "exit",
				gatewayRole: "merge",
				travelDirection: DIR_E,
				outwardDirection: DIR_E,
				pairedEndpointId: "secondary-far",
			}),
			expect.objectContaining({
				id: "secondary-far",
				cell: { x: 4, y: 2 },
				end: "far",
				flowRole: "entry",
				gatewayRole: "branch",
				travelDirection: DIR_W,
				outwardDirection: DIR_E,
				pairedEndpointId: "primary-far",
			}),
		]);
		expect(plan.newEdges).toBe(8);
		expect(plan.lengthMeters).toBe(8);
		expect(plan.turns).toBe(0);
		expect(plan.cells).toHaveLength(10);
		expect(plan.endpoints.every((item) => item.attachment === "open-terminal")).toBe(true);
	});

	it.each([
		[DIR_E, "forward"],
		[DIR_S, "forward"],
		[DIR_W, "reverse"],
		[DIR_N, "reverse"],
	] as const)("closes both paired terminals with cardinal turnbacks for direction %s and %s flow", (forward, flow) => {
		const plan = planPairedRailCorridor(
			request({ lengthMeters: 12, pose: { forward, side: "right", flow } }),
		);
		const route = materializeClosedPairedRailCorridorRoute(plan);
		const first = route[0] as Cell;
		const last = route.at(-1) as Cell;

		expect(last).toEqual(first);
		expect(route).toHaveLength(plan.lengthMeters + plan.specification.laneSpacingMeters * 2 + 5);
		for (let index = 0; index < route.length - 1; index++) {
			expect(directionBetween(route[index] as Cell, route[index + 1] as Cell)).not.toBeNull();
		}
		const unique = new Set(route.slice(0, -1).map((cell) => `${cell.x}:${cell.y}`));
		expect(unique.size).toBe(route.length - 1);
	});

	it("rejects invalid turnback clearance before allocating closure geometry", () => {
		const plan = planPairedRailCorridor(request());
		expect(() => materializeClosedPairedRailCorridorRoute(plan, 0)).toThrow(/clearance/);
	});

	it("produces a deterministic, pose-sensitive fingerprint from serializable input", () => {
		const base = request({ version: 1 });
		const cloned = JSON.parse(JSON.stringify(base)) as PairedRailCorridorRequest;
		const first = planPairedRailCorridor(base);
		const second = planPairedRailCorridor(cloned);

		expect(first.fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(pairedRailCorridorFingerprint(base)).toBe(first.fingerprint);
		expect(planPairedRailCorridor(request()).fingerprint).toBe(first.fingerprint);
		expect(
			new Set([
				first.fingerprint,
				planPairedRailCorridor(request({ anchor: { x: 1, y: 0 } })).fingerprint,
				planPairedRailCorridor(request({ lengthMeters: 5 })).fingerprint,
				planPairedRailCorridor(request({ laneSpacingMeters: 3 })).fingerprint,
				planPairedRailCorridor(request({ pose: { forward: DIR_S, side: "right" } })).fingerprint,
				planPairedRailCorridor(request({ pose: { forward: DIR_E, side: "left" } })).fingerprint,
				planPairedRailCorridor(
					request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
				).fingerprint,
			]).size,
		).toBe(7);
		expect(JSON.parse(JSON.stringify(first))).toMatchObject({
			kind: "paired-rail-corridor",
			valid: true,
			fingerprint: first.fingerprint,
		});
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.specification.pose)).toBe(true);
		expect(Object.isFrozen(first.lanes[0].cells)).toBe(true);
		expect(Object.isFrozen(first.endpoints)).toBe(true);
	});

	it.each([
		[{ ...request(), version: 2 }, "version"],
		[{ ...request(), lengthMeters: 0 }, "length"],
		[{ ...request(), lengthMeters: 1.5 }, "length"],
		[
			{
				...request(),
				lengthMeters: PAIRED_RAIL_CORRIDOR_MAXIMUM_LENGTH_METERS + 1,
			},
			"length",
		],
		[{ ...request(), laneSpacingMeters: 0 }, "spacing"],
		[{ ...request(), pose: { forward: 16, side: "right" } }, "cardinal"],
		[{ ...request(), pose: { forward: DIR_E, side: "center" } }, "side"],
		[
			{
				...request(),
				pose: { forward: DIR_E, side: "right", flow: "sideways" },
			},
			"flow",
		],
		[{ ...request(), anchor: { x: 2_147_483_647, y: 0 }, lengthMeters: 1 }, "bounds"],
	] satisfies readonly [
		unknown,
		string,
	][])("rejects malformed serializable request %# before geometry planning", (input, message) => {
		expect(validatePairedRailCorridorRequest(input)?.toLowerCase()).toContain(message);
		expect(() => planPairedRailCorridor(input as PairedRailCorridorRequest)).toThrow(message);
		expect(() => pairedRailCorridorFingerprint(input as PairedRailCorridorRequest)).toThrow(
			message,
		);
	});
});

function request(overrides: Partial<PairedRailCorridorRequest> = {}): PairedRailCorridorRequest {
	return {
		anchor: { x: 0, y: 0 },
		lengthMeters: 4,
		laneSpacingMeters: 2,
		pose: { forward: DIR_E, side: "right" },
		...overrides,
	};
}

function endpoint(
	plan: PairedRailCorridorPlan,
	id: PairedRailCorridorEndpointId,
): PairedRailCorridorEndpointDescriptor {
	const item = plan.endpoints.find((candidate) => candidate.id === id);
	if (!item) throw new Error(`Missing endpoint ${id}.`);
	return item;
}

function sortCells(cells: readonly Cell[]): readonly Cell[] {
	return [...cells].sort((left, right) => left.y - right.y || left.x - right.x);
}
