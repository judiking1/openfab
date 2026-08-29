import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planRailConstruction } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	moduleCells,
	planRailModule,
	type RailModuleKind,
	type RailModuleSpan,
} from "./RailModulePlanner";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction, oppositeDirection } from "./railShape";
import { type Cell, encodeRailCell } from "./TileMap";

const ORIENTATIONS: readonly [string, Direction, Cell][] = [
	["east", DIR_E, { x: -3, y: 0 }],
	["south", DIR_S, { x: 0, y: -3 }],
	["west", DIR_W, { x: 3, y: 0 }],
	["north", DIR_N, { x: 0, y: 3 }],
];

describe("RailModulePlanner", () => {
	it.each(
		ORIENTATIONS,
	)("places compact U-turns in %s flow on either side", (_name, forward, from) => {
		for (const pointer of [leftPointer(forward), rightPointer(forward)]) {
			const document = documentEndingAt(from);
			const plan = planRailModule(document.map, { x: 0, y: 0 }, pointer, "u-turn", "compact");

			expect(plan.valid, plan.reason).toBe(true);
			expect(plan.turns).toBe(2);
			expect(plan.lengthMeters).toBe(3);
			expect(document.commit(plan)).toBe(true);
			expect(compilePhysicalRail(document.map).counts.CCW_CURVE).toBe(1);
		}
	});

	it.each(ORIENTATIONS)("places wide U-turns in %s flow", (_name, forward, from) => {
		const document = documentEndingAt(from);
		const plan = planRailModule(
			document.map,
			{ x: 0, y: 0 },
			rightPointer(forward),
			"u-turn",
			"wide",
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.lengthMeters).toBe(4);
		expect(document.commit(plan)).toBe(true);
		expect(compilePhysicalRail(document.map).counts.CSC_CURVE_HOMO).toBe(1);
	});

	it.each([
		["compact", "S_CURVE"],
		["wide", "CSC_CURVE_HETE"],
	] as const)("compiles a %s shift to the corresponding catalog piece", (span, expectedType) => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", span);

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(
			compilePhysicalRail(document.map).pieces.some((piece) => piece.type === expectedType),
		).toBe(true);
	});

	it.each([
		["u-turn", "compact"],
		["u-turn", "wide"],
		["shift", "compact"],
		["shift", "wide"],
	] as readonly [
		RailModuleKind,
		RailModuleSpan,
	][])("keeps the %s %s footprint exact and undoable", (moduleKind, span) => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const before = mapSnapshot(document);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, moduleKind, span);

		expect(document.commit(plan)).toBe(true);
		expect(events.at(-1)?.kind).toBe("build");
		expect(events.at(-1)?.changes).toEqual(plan.mutations);
		expect(document.undo()).toBe(true);
		expect(mapSnapshot(document)).toEqual(before);
	});

	it("rejects module placement from a non-terminal cell", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 3, y: 0 })),
		).toBe(true);

		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact");
		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("열린 끝점");
		expect(plan.mutations).toEqual([]);
	});

	it("uses copied chirality for neutral intent and lets explicit pointer intent override it", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const copied = planRailModule(
			document.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			"u-turn",
			"compact",
			"left",
		);
		const overridden = planRailModule(
			document.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 3 },
			"u-turn",
			"compact",
			"left",
		);

		expect(copied.valid, copied.reason).toBe(true);
		expect(copied.side).toBe("left");
		expect(overridden.valid, overridden.reason).toBe(true);
		expect(overridden.side).toBe("right");
	});

	it("rejects a module whose footprint overlaps reverse traffic", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		document.map.setEncoded(1, 0, encodeRailCell({ incoming: DIR_S, outgoing: 0 }));
		document.map.setEncoded(1, 1, encodeRailCell({ incoming: 0, outgoing: DIR_N }));

		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact");
		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("역방향");
		expect(plan.conflicts).toEqual(
			expect.arrayContaining([
				{ x: 1, y: 0 },
				{ x: 1, y: 1 },
			]),
		);
	});

	it("exposes exact compact and wide footprints without floating geometry", () => {
		expect(moduleCells({ x: 0, y: 0 }, DIR_E, DIR_S, "u-turn", "compact")).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 1 },
		]);
		expect(moduleCells({ x: 0, y: 0 }, DIR_E, DIR_N, "shift", "wide")).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: -1 },
			{ x: 1, y: -2 },
			{ x: 2, y: -2 },
		]);
	});

	it("plans locally with 50k unrelated authored cells", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const expected = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "wide");
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			document.map.setEncoded(100_000 + index, 100, straight);
		}

		const startedAt = Date.now();
		const actual = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "wide");

		expect(actual.valid).toBe(true);
		expect(actual.cells).toEqual(expected.cells);
		expect(actual.mutations).toEqual(expected.mutations);
		expect(Date.now() - startedAt).toBeLessThan(100);
	});
});

function documentEndingAt(from: Cell): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, from, { x: 0, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function mapSnapshot(document: RailDocument): [number, number, number][] {
	const cells: [number, number, number][] = [];
	document.map.forEachRail((x, y, _rail, encoded) => cells.push([x, y, encoded]));
	return cells.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
}

function leftPointer(forward: Direction): Cell {
	return pointerAlong(leftDirection(forward));
}

function rightPointer(forward: Direction): Cell {
	return pointerAlong(oppositeDirection(leftDirection(forward)));
}

function pointerAlong(direction: Direction): Cell {
	if (direction === DIR_N) return { x: 0, y: -3 };
	if (direction === DIR_E) return { x: 3, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 3 };
	return { x: -3, y: 0 };
}

function leftDirection(forward: Direction): Direction {
	if (forward === DIR_N) return DIR_W;
	if (forward === DIR_E) return DIR_N;
	if (forward === DIR_S) return DIR_E;
	return DIR_S;
}
