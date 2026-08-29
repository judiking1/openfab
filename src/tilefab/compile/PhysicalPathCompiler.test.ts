import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	compilePhysicalPathPreview,
	compilePhysicalPaths,
	PATH_KIND,
	samplePhysicalPath,
} from "./PhysicalPathCompiler";

function mapWithRail(incoming: number, outgoing: number, x = 0, y = 0): TileMap {
	const map = new TileMap();
	map.setEncoded(x, y, encodeRailCell({ incoming, outgoing }));
	return map;
}

function pathPoints(layout: ReturnType<typeof compilePhysicalPaths>, pathIndex = 0): number[] {
	const start = (layout.offsets[pathIndex] as number) * 2;
	const end = (layout.offsets[pathIndex + 1] as number) * 2;
	return [...layout.positions.slice(start, end)];
}

function expectPointsClose(actual: readonly number[], expected: readonly number[]): void {
	expect(actual).toHaveLength(expected.length);
	for (let index = 0; index < expected.length; index++) {
		expect(actual[index]).toBeCloseTo(expected[index] as number, 6);
	}
}

function pathCoverage(
	layout: ReturnType<typeof compilePhysicalPaths>,
	pathIndex: number,
): Array<[number, number]> {
	const start = layout.coverageOffsets[pathIndex] as number;
	const end = layout.coverageOffsets[pathIndex + 1] as number;
	const cells: Array<[number, number]> = [];
	for (let index = start; index < end; index++) {
		cells.push([
			layout.coverageCells[index * 2] as number,
			layout.coverageCells[index * 2 + 1] as number,
		]);
	}
	return cells;
}

const TURNOUT_CASES = [
	{ incoming: DIR_W, outgoing: DIR_E | DIR_N, kind: "branch" },
	{ incoming: DIR_W, outgoing: DIR_E | DIR_S, kind: "branch" },
	{ incoming: DIR_E, outgoing: DIR_W | DIR_N, kind: "branch" },
	{ incoming: DIR_E, outgoing: DIR_W | DIR_S, kind: "branch" },
	{ incoming: DIR_N, outgoing: DIR_S | DIR_E, kind: "branch" },
	{ incoming: DIR_N, outgoing: DIR_S | DIR_W, kind: "branch" },
	{ incoming: DIR_S, outgoing: DIR_N | DIR_E, kind: "branch" },
	{ incoming: DIR_S, outgoing: DIR_N | DIR_W, kind: "branch" },
	{ incoming: DIR_W | DIR_N, outgoing: DIR_E, kind: "merge" },
	{ incoming: DIR_W | DIR_S, outgoing: DIR_E, kind: "merge" },
	{ incoming: DIR_E | DIR_N, outgoing: DIR_W, kind: "merge" },
	{ incoming: DIR_E | DIR_S, outgoing: DIR_W, kind: "merge" },
	{ incoming: DIR_N | DIR_E, outgoing: DIR_S, kind: "merge" },
	{ incoming: DIR_N | DIR_W, outgoing: DIR_S, kind: "merge" },
	{ incoming: DIR_S | DIR_E, outgoing: DIR_N, kind: "merge" },
	{ incoming: DIR_S | DIR_W, outgoing: DIR_N, kind: "merge" },
] as const;

describe("PhysicalPathCompiler", () => {
	it("compiles a one-meter straight in vehicle direction", () => {
		const layout = compilePhysicalPaths(mapWithRail(DIR_W, DIR_E));
		expect(layout.kinds[0]).toBe(PATH_KIND.LINEAR);
		expect(layout.lengths[0]).toBe(1);
		expect(pathPoints(layout)).toEqual([0, 0.5, 1, 0.5]);
		expect([...layout.tangents]).toEqual([1, 0, 1, 0]);
		expect(layout.fromDirections[0]).toBe(DIR_W);
		expect(layout.toDirections[0]).toBe(DIR_E);
	});

	it.each([
		[DIR_N, DIR_E, [0.5, 0], [1, 0.5], [0, 1], [1, 0]],
		[DIR_N, DIR_W, [0.5, 0], [0, 0.5], [0, 1], [-1, 0]],
		[DIR_E, DIR_S, [1, 0.5], [0.5, 1], [-1, 0], [0, 1]],
		[DIR_E, DIR_N, [1, 0.5], [0.5, 0], [-1, 0], [0, -1]],
		[DIR_S, DIR_W, [0.5, 1], [0, 0.5], [0, -1], [-1, 0]],
		[DIR_S, DIR_E, [0.5, 1], [1, 0.5], [0, -1], [1, 0]],
		[DIR_W, DIR_N, [0, 0.5], [0.5, 0], [1, 0], [0, -1]],
		[DIR_W, DIR_S, [0, 0.5], [0.5, 1], [1, 0], [0, 1]],
	] as const)("compiles rotated R500 curve %s to %s", (from, to, startPoint, endPoint, startTangent, endTangent) => {
		const layout = compilePhysicalPaths(mapWithRail(from, to));
		expect(layout.kinds[0]).toBe(PATH_KIND.CURVE);
		expect(layout.lengths[0]).toBeCloseTo(Math.PI / 4, 6);
		expect(layout.offsets[1]).toBe(9);
		expect(layout.positions[0]).toBeCloseTo(startPoint[0], 6);
		expect(layout.positions[1]).toBeCloseTo(startPoint[1], 6);
		expect(layout.tangents[0]).toBeCloseTo(startTangent[0], 6);
		expect(layout.tangents[1]).toBeCloseTo(startTangent[1], 6);
		const end = ((layout.offsets[1] as number) - 1) * 2;
		expect(layout.positions[end]).toBeCloseTo(endPoint[0], 6);
		expect(layout.positions[end + 1]).toBeCloseTo(endPoint[1], 6);
		expect(layout.tangents[end]).toBeCloseTo(endTangent[0], 6);
		expect(layout.tangents[end + 1]).toBeCloseTo(endTangent[1], 6);
		for (let index = 1; index < layout.pointCount; index++) {
			expect(
				(layout.distances[index] as number) - (layout.distances[index - 1] as number),
			).toBeLessThanOrEqual(0.1);
		}
	});

	it.each(
		TURNOUT_CASES,
	)("compiles every $kind turnout rotation to exactly trunk plus diverge", (rail) => {
		const layout = compilePhysicalPaths(mapWithRail(rail.incoming, rail.outgoing));
		expect(layout.pathCount).toBe(2);
		expect([...layout.kinds]).toEqual([PATH_KIND.TURNOUT_TRUNK, PATH_KIND.TURNOUT_DIVERGE]);
		expect(layout.lengths[0]).toBeCloseTo(1.4, 6);
		expect(layout.lengths[1]).toBeCloseTo(Math.PI / 4 + 0.8, 6);
		if (rail.kind === "branch") {
			expect(layout.startExtensions[1]).toBeCloseTo(0.4, 6);
			expect(layout.endExtensions[1]).toBeCloseTo(0.4, 6);
			expect(layout.startExtensions[0]).toBeCloseTo(0.4, 6);
			expect(layout.endExtensions[0]).toBe(0);
		} else {
			expect(layout.startExtensions[1]).toBeCloseTo(0.4, 6);
			expect(layout.endExtensions[1]).toBeCloseTo(0.4, 6);
			expect(layout.startExtensions[0]).toBe(0);
			expect(layout.endExtensions[0]).toBeCloseTo(0.4, 6);
		}
		expect(layout.sharedSegmentCount).toBe(1);
		expect([...layout.sharedSegmentOffsets]).toEqual([0, 1, 2]);
		expect([...layout.sharedSegmentIds]).toEqual([0, 0]);
		if (rail.kind === "branch") {
			expect([...layout.sharedSegmentStarts]).toEqual([0, 0]);
			expect(layout.sharedSegmentEnds[0]).toBeCloseTo(0.4, 6);
			expect(layout.sharedSegmentEnds[1]).toBeCloseTo(0.4, 6);
		} else {
			expect(layout.sharedSegmentStarts[0]).toBeCloseTo(1, 6);
			expect(layout.sharedSegmentStarts[1]).toBeCloseTo(Math.PI / 4 + 0.4, 6);
			expect(layout.sharedSegmentEnds[0]).toBeCloseTo(layout.lengths[0] as number, 6);
			expect(layout.sharedSegmentEnds[1]).toBeCloseTo(layout.lengths[1] as number, 6);
		}
		expect(layout.totalRouteLengthMeters - layout.totalLengthMeters).toBeCloseTo(0.4, 6);
	});

	it("trims support rails so a branch footprint has no overlapping physical distance", () => {
		const map = new TileMap();
		map.setEncoded(-1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E | DIR_S }));
		map.setEncoded(0, 1, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }));
		const layout = compilePhysicalPaths(map);
		const predecessor = findPath(layout, -1, 0, PATH_KIND.LINEAR);
		const trunk = findPath(layout, 0, 0, PATH_KIND.TURNOUT_TRUNK);
		const diverge = findPath(layout, 0, 0, PATH_KIND.TURNOUT_DIVERGE);
		const successor = findPath(layout, 0, 1, PATH_KIND.LINEAR);

		expect(layout.lengths[predecessor]).toBeCloseTo(0.6, 6);
		expectPointsClose(pathPoints(layout, predecessor), [-1, 0.5, -0.4, 0.5]);
		expectPointsClose(pathPoints(layout, trunk), [-0.4, 0.5, 1, 0.5]);
		const divergePoints = pathPoints(layout, diverge);
		expectPointsClose(divergePoints.slice(0, 2), [-0.4, 0.5]);
		expectPointsClose(divergePoints.slice(-2), [0.5, 1.4]);
		expectPointsClose(pathPoints(layout, successor), [0.5, 1.4, 0.5, 2]);
		expect(layout.endInsets[predecessor]).toBeCloseTo(0.4, 6);
		expect(layout.startInsets[successor]).toBeCloseTo(0.4, 6);
		expect(pathCoverage(layout, trunk)).toEqual([
			[-1, 0],
			[0, 0],
		]);
		expect(pathCoverage(layout, diverge)).toEqual([
			[-1, 0],
			[0, 0],
			[0, 1],
		]);
	});

	it("reverses the asymmetric trims for a merge without gaps or overlap", () => {
		const map = new TileMap();
		map.setEncoded(0, 1, encodeRailCell({ incoming: DIR_S, outgoing: DIR_N }));
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_E | DIR_S, outgoing: DIR_W }));
		map.setEncoded(-1, 0, encodeRailCell({ incoming: DIR_E, outgoing: DIR_W }));
		const layout = compilePhysicalPaths(map);
		const predecessor = findPath(layout, 0, 1, PATH_KIND.LINEAR);
		const trunk = findPath(layout, 0, 0, PATH_KIND.TURNOUT_TRUNK);
		const diverge = findPath(layout, 0, 0, PATH_KIND.TURNOUT_DIVERGE);
		const successor = findPath(layout, -1, 0, PATH_KIND.LINEAR);

		expect(layout.lengths[predecessor]).toBeCloseTo(0.6, 6);
		expectPointsClose(pathPoints(layout, predecessor), [0.5, 2, 0.5, 1.4]);
		expectPointsClose(pathPoints(layout, trunk), [1, 0.5, -0.4, 0.5]);
		const divergePoints = pathPoints(layout, diverge);
		expectPointsClose(divergePoints.slice(0, 2), [0.5, 1.4]);
		expectPointsClose(divergePoints.slice(-2), [-0.4, 0.5]);
		expectPointsClose(pathPoints(layout, successor), [-0.4, 0.5, -1, 0.5]);
		expect(layout.endInsets[predecessor]).toBeCloseTo(0.4, 6);
		expect(layout.startInsets[successor]).toBeCloseTo(0.4, 6);
		expect(pathCoverage(layout, trunk)).toEqual([
			[0, 0],
			[-1, 0],
		]);
		expect(pathCoverage(layout, diverge)).toEqual([
			[0, 1],
			[0, 0],
			[-1, 0],
		]);
	});

	it("compiles a local construction preview identical to the matching future paths", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 }));
		const plan = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 2 });
		expect(plan.valid).toBe(true);

		const preview = compilePhysicalPathPreview(document.map, plan.mutations, plan.cells);
		const futureMap = document.map.clone();
		for (const mutation of plan.mutations) {
			futureMap.setEncoded(mutation.x, mutation.y, mutation.after);
		}
		const future = compilePhysicalPaths(futureMap);
		for (const [x, y, kind] of [
			[3, 0, PATH_KIND.TURNOUT_TRUNK],
			[3, 0, PATH_KIND.TURNOUT_DIVERGE],
			[2, 0, PATH_KIND.LINEAR],
			[3, 1, PATH_KIND.LINEAR],
		] as const) {
			const previewPath = findPath(preview, x, y, kind);
			const futurePath = findPath(future, x, y, kind);
			expectPointsClose(pathPoints(preview, previewPath), pathPoints(future, futurePath));
			expect(preview.lengths[previewPath]).toBeCloseTo(future.lengths[futurePath] as number, 6);
		}
		expect(preview.pathCount).toBeLessThan(future.pathCount);
		expect(preview.revision).toBe(document.map.getRevision());
	});

	it("emits safe metadata for an invalid head-on junction", () => {
		const layout = compilePhysicalPaths(mapWithRail(DIR_N | DIR_S, DIR_W));
		expect(layout.pathCount).toBe(1);
		expect(layout.kinds[0]).toBe(PATH_KIND.INVALID);
		expect(layout.lengths[0]).toBe(0);
		expect([...layout.bounds]).toEqual([0.5, 0.5, 0.5, 0.5]);
		expect(samplePhysicalPath(layout, 0, 0)).toEqual({
			x: 0.5,
			y: 0.5,
			tangentX: 0,
			tangentY: 0,
		});
	});

	it("samples by path-local distance and clamps to endpoints", () => {
		const layout = compilePhysicalPaths(mapWithRail(DIR_W, DIR_E, 3, 4));
		expect(samplePhysicalPath(layout, 0, 0.25)).toEqual({
			x: 3.25,
			y: 4.5,
			tangentX: 1,
			tangentY: 0,
		});
		expect(samplePhysicalPath(layout, 0, 2)?.x).toBe(4);
		expect(samplePhysicalPath(layout, 1, 0)).toBeNull();
	});

	it("has deterministic ordering and exact typed-array sizes", () => {
		const map = new TileMap();
		map.setEncoded(4, 2, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(-1, -3, encodeRailCell({ incoming: 0, outgoing: DIR_S }));
		const first = compilePhysicalPaths(map);
		const second = compilePhysicalPaths(map);
		expect([...first.cells]).toEqual([-1, -3, 4, 2]);
		expect([...first.exitCells]).toEqual([...first.cells]);
		expect([...first.positions]).toEqual([...second.positions]);
		expect(first.revision).toBe(map.getRevision());
		expect(first.offsets).toHaveLength(first.pathCount + 1);
		expect(first.positions).toHaveLength(first.pointCount * 2);
		expect(first.tangents).toHaveLength(first.pointCount * 2);
		expect(first.distances).toHaveLength(first.pointCount);
		expect(first.kinds).toHaveLength(first.pathCount);
		expect(first.cells).toHaveLength(first.pathCount * 2);
		expect(first.exitCells).toHaveLength(first.pathCount * 2);
		expect(first.bounds).toHaveLength(first.pathCount * 4);
		expect(first.startInsets).toHaveLength(first.pathCount);
		expect(first.endInsets).toHaveLength(first.pathCount);
		expect(first.startExtensions).toHaveLength(first.pathCount);
		expect(first.endExtensions).toHaveLength(first.pathCount);
		expect(first.coverageOffsets).toHaveLength(first.pathCount + 1);
		expect(first.coverageCells.length % 2).toBe(0);
		expect(first.sharedSegmentOffsets).toHaveLength(first.pathCount + 1);
		expect(first.sharedSegmentIds).toHaveLength(first.sharedSegmentStarts.length);
		expect(first.sharedSegmentIds).toHaveLength(first.sharedSegmentEnds.length);
	});

	it("compiles 10k cells into a compact linear layout", () => {
		const map = new TileMap();
		const encoded = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 10_000; index++) map.setEncoded(index, index % 17, encoded);
		const startedAt = Date.now();
		const layout = compilePhysicalPaths(map);
		const elapsedMilliseconds = Date.now() - startedAt;
		expect(layout.pathCount).toBe(10_000);
		expect(layout.pointCount).toBe(20_000);
		expect(layout.totalLengthMeters).toBe(10_000);
		expect(layout.positions.byteLength).toBe(20_000 * 2 * Float32Array.BYTES_PER_ELEMENT);
		expect(elapsedMilliseconds).toBeLessThan(1_000);
	});
});

function findPath(
	layout: ReturnType<typeof compilePhysicalPaths>,
	x: number,
	y: number,
	kind: number,
): number {
	for (let index = 0; index < layout.pathCount; index++) {
		if (
			layout.cells[index * 2] === x &&
			layout.cells[index * 2 + 1] === y &&
			layout.kinds[index] === kind
		) {
			return index;
		}
	}
	throw new Error(`Missing path ${x},${y}:${kind}`);
}
