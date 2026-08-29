import { describe, expect, it } from "vitest";
import {
	materializePairedRailPerimeterTurnbackRoute,
	PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS,
	type PairedRailPerimeterPlan,
	type PairedRailPerimeterRequest,
	pairedRailPerimeterFingerprint,
	planPairedRailPerimeter,
	validatePairedRailPerimeterRequest,
} from "./PairedRailPerimeterPlanner";
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

describe("PairedRailPerimeterPlanner", () => {
	it("creates two close nested closed rectangles with opposite circulation", () => {
		const plan = planPairedRailPerimeter(request());
		const [outer, inner] = plan.lanes;

		expect(outer.corners).toEqual([
			{ x: 0, y: 0 },
			{ x: 8, y: 0 },
			{ x: 8, y: 6 },
			{ x: 0, y: 6 },
		]);
		expect(inner.corners).toEqual([
			{ x: 1, y: 1 },
			{ x: 7, y: 1 },
			{ x: 7, y: 5 },
			{ x: 1, y: 5 },
		]);
		expect(outer.circulation).toBe("clockwise");
		expect(inner.circulation).toBe("counterclockwise");
		expect(outer.cells[0]).toEqual(outer.cells.at(-1));
		expect(inner.cells[0]).toEqual(inner.cells.at(-1));
		expect(outer.edgeCount).toBe(28);
		expect(inner.edgeCount).toBe(20);
		expect(plan.newEdges).toBe(48);
		expect(plan.lengthMeters).toBe(48);
		expect(plan.turns).toBe(8);
		expect(plan.occupiedCells).toHaveLength(48);
		expect(new Set(plan.occupiedCells.map(cellKey)).size).toBe(plan.occupiedCells.length);
		expect(intersection(outer.cells.slice(0, -1), inner.cells.slice(0, -1))).toEqual([]);
		assertCardinalClosedRoute(outer.cells);
		assertCardinalClosedRoute(inner.cells);
	});

	it.each([
		[DIR_E, { x: 8, y: 0 }, { x: 0, y: 6 }],
		[DIR_S, { x: 0, y: 8 }, { x: -6, y: 0 }],
		[DIR_W, { x: -8, y: 0 }, { x: 0, y: -6 }],
		[DIR_N, { x: 0, y: -8 }, { x: 6, y: 0 }],
	] satisfies readonly [
		Direction,
		Cell,
		Cell,
	][])("applies a cardinal pose for forward direction %s", (forward, expectedForwardCorner, expectedSideCorner) => {
		const plan = planPairedRailPerimeter(request({ pose: { forward, side: "right" } }));

		expect(plan.lanes[0].corners[1]).toEqual(expectedForwardCorner);
		expect(plan.lanes[0].corners[3]).toEqual(expectedSideCorner);
		expect(plan.lanes[0].circulation).toBe("clockwise");
		expect(plan.lanes[1].circulation).toBe("counterclockwise");
		assertCardinalClosedRoute(plan.lanes[0].cells);
		assertCardinalClosedRoute(plan.lanes[1].cells);
	});

	it("mirrors the footprint by side and reverses flow without moving either lane", () => {
		const right = planPairedRailPerimeter(request());
		const left = planPairedRailPerimeter(request({ pose: { forward: DIR_E, side: "left" } }));
		const reversed = planPairedRailPerimeter(
			request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
		);

		expect(left.lanes[0].corners[2]).toEqual({ x: 8, y: -6 });
		expect(left.lanes[1].corners[0]).toEqual({ x: 1, y: -1 });
		expect(left.lanes[0].circulation).toBe("counterclockwise");
		expect(left.lanes[1].circulation).toBe("clockwise");
		expect(sortCells(reversed.occupiedCells)).toEqual(sortCells(right.occupiedCells));
		expect(reversed.lanes[0].cells).toEqual([...right.lanes[0].cells].reverse());
		expect(reversed.lanes[1].cells).toEqual([...right.lanes[1].cells].reverse());
		expect(reversed.lanes[0].circulation).toBe("counterclockwise");
		expect(reversed.lanes[1].circulation).toBe("clockwise");
	});

	it("publishes balanced paired gateway contracts on both long sides", () => {
		const plan = planPairedRailPerimeter(request());

		expect(plan.gateways).toEqual([
			{
				id: "near-side",
				face: "near-side",
				outwardDirection: DIR_N,
				branch: {
					laneId: "outer",
					role: "branch",
					cell: { x: 4, y: 0 },
					travelDirection: DIR_E,
					outwardDirection: DIR_N,
				},
				merge: {
					laneId: "inner",
					role: "merge",
					cell: { x: 4, y: 1 },
					travelDirection: DIR_W,
					outwardDirection: DIR_N,
				},
				laneSpacingMeters: 1,
			},
			{
				id: "opposite-side",
				face: "opposite-side",
				outwardDirection: DIR_S,
				branch: {
					laneId: "inner",
					role: "branch",
					cell: { x: 4, y: 5 },
					travelDirection: DIR_E,
					outwardDirection: DIR_S,
				},
				merge: {
					laneId: "outer",
					role: "merge",
					cell: { x: 4, y: 6 },
					travelDirection: DIR_W,
					outwardDirection: DIR_S,
				},
				laneSpacingMeters: 1,
			},
		]);
		expect(plan.gateways.flatMap((gateway) => [gateway.branch, gateway.merge])).toSatisfy(
			(ports: { role: string }[]) =>
				ports.filter((port) => port.role === "branch").length === 2 &&
				ports.filter((port) => port.role === "merge").length === 2,
		);
		expect(
			plan.gateways.every(
				(gateway) =>
					oppositeDirection(gateway.branch.travelDirection) === gateway.merge.travelDirection,
			),
		).toBe(true);
	});

	it("publishes one cross-lane turnback in each longitudinal end with balanced lane roles", () => {
		const plan = planPairedRailPerimeter(request());

		expect(plan.turnbacks).toEqual([
			{
				id: "origin-end",
				end: "origin",
				outwardDirection: DIR_W,
				departure: {
					laneId: "outer",
					role: "branch",
					cell: { x: 0, y: 3 },
					travelDirection: DIR_N,
					outwardDirection: DIR_W,
				},
				arrival: {
					laneId: "inner",
					role: "merge",
					cell: { x: 1, y: 3 },
					travelDirection: DIR_S,
					outwardDirection: DIR_W,
				},
				laneSpacingMeters: 1,
			},
			{
				id: "far-end",
				end: "far",
				outwardDirection: DIR_E,
				departure: {
					laneId: "inner",
					role: "branch",
					cell: { x: 7, y: 3 },
					travelDirection: DIR_N,
					outwardDirection: DIR_E,
				},
				arrival: {
					laneId: "outer",
					role: "merge",
					cell: { x: 8, y: 3 },
					travelDirection: DIR_S,
					outwardDirection: DIR_E,
				},
				laneSpacingMeters: 1,
			},
		]);
		expect(plan.descriptorBalance).toEqual({
			gatewayBranches: 2,
			gatewayMerges: 2,
			turnbackBranches: 2,
			turnbackMerges: 2,
		});
		expect(plan.turnbacks.map((turnback) => turnback.departure.laneId).sort()).toEqual([
			"inner",
			"outer",
		]);
		expect(plan.turnbacks.map((turnback) => turnback.arrival.laneId).sort()).toEqual([
			"inner",
			"outer",
		]);
		expect(plan.turnbacks.map(materializePairedRailPerimeterTurnbackRoute)).toEqual([
			[
				{ x: 0, y: 3 },
				{ x: 1, y: 3 },
			],
			[
				{ x: 7, y: 3 },
				{ x: 8, y: 3 },
			],
		]);
	});

	it("keeps descriptors balanced when flow is reversed", () => {
		const forward = planPairedRailPerimeter(request());
		const reversed = planPairedRailPerimeter(
			request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
		);

		for (let index = 0; index < forward.gateways.length; index++) {
			expect(reversed.gateways[index]?.branch.laneId).toBe(forward.gateways[index]?.merge.laneId);
			expect(reversed.gateways[index]?.merge.laneId).toBe(forward.gateways[index]?.branch.laneId);
		}
		for (let index = 0; index < forward.turnbacks.length; index++) {
			expect(reversed.turnbacks[index]?.departure.laneId).toBe(
				forward.turnbacks[index]?.arrival.laneId,
			);
			expect(reversed.turnbacks[index]?.arrival.laneId).toBe(
				forward.turnbacks[index]?.departure.laneId,
			);
		}
	});

	it("keeps all gateway and turnback contracts balanced across the complete cardinal pose matrix", () => {
		for (const forward of [DIR_N, DIR_E, DIR_S, DIR_W] as const) {
			for (const side of ["left", "right"] as const) {
				for (const flow of ["forward", "reverse"] as const) {
					const plan = planPairedRailPerimeter(request({ pose: { forward, side, flow } }));
					const gatewayPorts = plan.gateways.flatMap((gateway) => [gateway.branch, gateway.merge]);
					const turnbackPorts = plan.turnbacks.flatMap((turnback) => [
						turnback.departure,
						turnback.arrival,
					]);

					expect(gatewayPorts.filter((port) => port.role === "branch")).toHaveLength(2);
					expect(gatewayPorts.filter((port) => port.role === "merge")).toHaveLength(2);
					expect(turnbackPorts.filter((port) => port.role === "branch")).toHaveLength(2);
					expect(turnbackPorts.filter((port) => port.role === "merge")).toHaveLength(2);
					expect(
						plan.gateways.every((gateway) => gateway.branch.laneId !== gateway.merge.laneId),
					).toBe(true);
					expect(
						plan.turnbacks.every(
							(turnback) => turnback.departure.laneId !== turnback.arrival.laneId,
						),
					).toBe(true);
				}
			}
		}
	});

	it("normalizes input into immutable plain serializable output", () => {
		const mutable = request({ pose: { forward: DIR_S, side: "left" } }) as {
			anchor: Cell;
			pose: {
				forward: Direction;
				side: "left" | "right";
				flow?: "forward" | "reverse";
			};
		};
		const plan = planPairedRailPerimeter(mutable as PairedRailPerimeterRequest);
		const clone = JSON.parse(JSON.stringify(plan)) as PairedRailPerimeterPlan;
		mutable.anchor.x = 999;
		mutable.pose.forward = DIR_N;

		expect(plan.specification.anchor).toEqual({ x: 0, y: 0 });
		expect(plan.specification.pose).toEqual({
			forward: DIR_S,
			side: "left",
			flow: "forward",
		});
		expect(clone).toEqual(plan);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.specification)).toBe(true);
		expect(Object.isFrozen(plan.specification.anchor)).toBe(true);
		expect(Object.isFrozen(plan.specification.pose)).toBe(true);
		expect(Object.isFrozen(plan.lanes)).toBe(true);
		expect(Object.isFrozen(plan.lanes[0])).toBe(true);
		expect(Object.isFrozen(plan.lanes[0].corners)).toBe(true);
		expect(Object.isFrozen(plan.lanes[0].corners[0])).toBe(true);
		expect(Object.isFrozen(plan.lanes[0].cells)).toBe(true);
		expect(Object.isFrozen(plan.lanes[0].cells[0])).toBe(true);
		expect(Object.isFrozen(plan.gateways[0].branch)).toBe(true);
		expect(Object.isFrozen(plan.turnbacks[0].departure)).toBe(true);
	});

	it("produces a deterministic fingerprint that includes dimensions and complete pose", () => {
		const base = request({ version: 1 });
		const cloned = JSON.parse(JSON.stringify(base)) as PairedRailPerimeterRequest;
		const first = planPairedRailPerimeter(base);
		const second = planPairedRailPerimeter(cloned);

		expect(first.fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(pairedRailPerimeterFingerprint(base)).toBe(first.fingerprint);
		expect(planPairedRailPerimeter(request()).fingerprint).toBe(first.fingerprint);
		expect(
			new Set([
				first.fingerprint,
				planPairedRailPerimeter(request({ anchor: { x: 1, y: 0 } })).fingerprint,
				planPairedRailPerimeter(request({ forwardSpanMeters: 9 })).fingerprint,
				planPairedRailPerimeter(request({ sideSpanMeters: 7 })).fingerprint,
				planPairedRailPerimeter(
					request({
						forwardSpanMeters: 10,
						sideSpanMeters: 8,
						laneSpacingMeters: 2,
					}),
				).fingerprint,
				planPairedRailPerimeter(request({ pose: { forward: DIR_S, side: "right" } })).fingerprint,
				planPairedRailPerimeter(request({ pose: { forward: DIR_E, side: "left" } })).fingerprint,
				planPairedRailPerimeter(
					request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
				).fingerprint,
			]).size,
		).toBe(8);
	});

	it.each([
		[{ ...request(), version: 2 }, "version"],
		[{ ...request(), anchor: { x: 0.5, y: 0 } }, "anchor"],
		[{ ...request(), forwardSpanMeters: 0 }, "forward span"],
		[{ ...request(), forwardSpanMeters: 7.5 }, "forward span"],
		[
			{
				...request(),
				forwardSpanMeters: PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS + 1,
			},
			"forward span",
		],
		[{ ...request(), sideSpanMeters: 0 }, "side span"],
		[{ ...request(), laneSpacingMeters: 0 }, "spacing"],
		[{ ...request(), forwardSpanMeters: 5 }, "inner span"],
		[{ ...request(), sideSpanMeters: 5 }, "inner span"],
		[{ ...request(), pose: { forward: 16, side: "right" } }, "cardinal"],
		[{ ...request(), pose: { forward: DIR_E, side: "center" } }, "side"],
		[
			{
				...request(),
				pose: { forward: DIR_E, side: "right", flow: "sideways" },
			},
			"flow",
		],
		[
			{
				...request(),
				anchor: { x: 2_147_483_647, y: 0 },
				forwardSpanMeters: 8,
			},
			"bounds",
		],
	] satisfies readonly [
		unknown,
		string,
	][])("rejects malformed request %# before allocating perimeter geometry", (input, message) => {
		expect(validatePairedRailPerimeterRequest(input)?.toLowerCase()).toContain(message);
		expect(() => planPairedRailPerimeter(input as PairedRailPerimeterRequest)).toThrow(message);
		expect(() => pairedRailPerimeterFingerprint(input as PairedRailPerimeterRequest)).toThrow(
			message,
		);
	});
});

function request(overrides: Partial<PairedRailPerimeterRequest> = {}): PairedRailPerimeterRequest {
	return {
		anchor: { x: 0, y: 0 },
		forwardSpanMeters: 8,
		sideSpanMeters: 6,
		laneSpacingMeters: 1,
		pose: { forward: DIR_E, side: "right" },
		...overrides,
	};
}

function assertCardinalClosedRoute(cells: readonly Cell[]): void {
	expect(cells.length).toBeGreaterThan(4);
	expect(cells[0]).toEqual(cells.at(-1));
	for (let index = 0; index < cells.length - 1; index++) {
		expect(directionBetween(cells[index] as Cell, cells[index + 1] as Cell)).not.toBeNull();
	}
}

function intersection(first: readonly Cell[], second: readonly Cell[]): readonly Cell[] {
	const keys = new Set(first.map(cellKey));
	return second.filter((cell) => keys.has(cellKey(cell)));
}

function sortCells(cells: readonly Cell[]): readonly Cell[] {
	return [...cells].sort((left, right) => left.y - right.y || left.x - right.x);
}

function cellKey(cell: Cell): string {
	return `${cell.x}:${cell.y}`;
}
