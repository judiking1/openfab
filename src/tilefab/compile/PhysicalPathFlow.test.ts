import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import {
	authoredPhysicalPathContinuation,
	buildPhysicalPathAdjacency,
	hitTestPhysicalPaths,
	reversePhysicalPathAdjacency,
	tracePhysicalPathFlow,
} from "./PhysicalPathFlow";

function put(map: TileMap, x: number, y: number, incoming: number, outgoing: number): void {
	map.setEncoded(x, y, encodeRailCell({ incoming, outgoing }));
}

describe("physical path flow", () => {
	it("rejects coincident physical seams without the authored directed cell relation", () => {
		const firstMap = new TileMap();
		const secondMap = new TileMap();
		put(firstMap, 0, 0, DIR_W, DIR_E);
		put(secondMap, 1, 0, DIR_W, DIR_E);
		const first = compilePhysicalPaths(firstMap);
		const second = compilePhysicalPaths(secondMap);

		expect(authoredPhysicalPathContinuation(first, 0, second, 0)).toBe(true);
		const counterfeit = { ...second, cells: second.cells.slice() };
		counterfeit.cells[0] = 9;
		expect(authoredPhysicalPathContinuation(first, 0, counterfeit, 0)).toBe(false);
	});

	it("links reciprocal directed paths and stops at malformed neighbors", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_W, DIR_E);
		put(map, 1, 0, DIR_W, DIR_E);
		put(map, 2, 0, DIR_N, DIR_S);
		const paths = compilePhysicalPaths(map);
		const adjacency = buildPhysicalPathAdjacency(paths);

		expect([...adjacency.targets]).toEqual([1]);
		const trace = tracePhysicalPathFlow(
			paths,
			adjacency,
			{ pathIndex: 0, distanceMeters: 0.5, distanceToPathMeters: 0 },
			12,
		);
		expect(trace.map((entry) => entry.pathIndex)).toEqual([0, 1]);
	});

	it("links from an explicit multi-cell exit instead of assuming the entry cell", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_W, DIR_E);
		put(map, 2, 0, DIR_W, DIR_E);
		const paths = compilePhysicalPaths(map);
		paths.exitCells[0] = 1;
		paths.exitCells[1] = 0;

		const adjacency = buildPhysicalPathAdjacency(paths);
		expect([...adjacency.targets]).toEqual([1]);
	});

	it("selects one turnout route from pointer geometry before tracing", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_W, DIR_E | DIR_S);
		put(map, 1, 0, DIR_W, DIR_E);
		put(map, 0, 1, DIR_N, DIR_S);
		const paths = compilePhysicalPaths(map);
		const adjacency = buildPhysicalPathAdjacency(paths);
		const turnoutIndices = Array.from({ length: paths.pathCount }, (_, index) => index).filter(
			(index) =>
				(paths.cells[index * 2] as number) === 0 && (paths.cells[index * 2 + 1] as number) === 0,
		);
		const divergeIndex = turnoutIndices.find(
			(index) => (paths.kinds[index] as number) === PATH_KIND.TURNOUT_DIVERGE,
		) as number;
		const trunkIndex = turnoutIndices.find(
			(index) => (paths.kinds[index] as number) === PATH_KIND.TURNOUT_TRUNK,
		) as number;
		const hit = hitTestPhysicalPaths(paths, turnoutIndices, { x: 0.58, y: 0.86 }, 0.22);

		expect(hit?.pathIndex).toBe(divergeIndex);
		const trace = tracePhysicalPathFlow(paths, adjacency, hit as NonNullable<typeof hit>);
		expect(trace.map((entry) => entry.pathIndex)).toContain(divergeIndex);
		expect(trace.map((entry) => entry.pathIndex)).not.toContain(trunkIndex);
	});

	it("fans out only when the selected path reaches a branch downstream", () => {
		const map = new TileMap();
		put(map, -1, 0, DIR_W, DIR_E);
		put(map, 0, 0, DIR_W, DIR_E | DIR_S);
		put(map, 1, 0, DIR_W, DIR_E);
		put(map, 0, 1, DIR_N, DIR_S);
		const paths = compilePhysicalPaths(map);
		const adjacency = buildPhysicalPathAdjacency(paths);
		const sourceIndex = Array.from({ length: paths.pathCount }, (_, index) => index).find(
			(index) => (paths.cells[index * 2] as number) === -1,
		) as number;
		const trace = tracePhysicalPathFlow(paths, adjacency, {
			pathIndex: sourceIndex,
			distanceMeters: 0.5,
			distanceToPathMeters: 0,
		});

		expect(trace).toHaveLength(5);
		expect(new Set(trace.map((entry) => paths.kinds[entry.pathIndex]))).toContain(
			PATH_KIND.TURNOUT_DIVERGE,
		);
	});

	it("caps cyclic traversal by path count and metric horizon", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_S, DIR_E);
		put(map, 1, 0, DIR_W, DIR_S);
		put(map, 1, 1, DIR_N, DIR_W);
		put(map, 0, 1, DIR_E, DIR_N);
		const paths = compilePhysicalPaths(map);
		const adjacency = buildPhysicalPathAdjacency(paths);
		const trace = tracePhysicalPathFlow(
			paths,
			adjacency,
			{ pathIndex: 0, distanceMeters: 0.2, distanceToPathMeters: 0 },
			100,
			64,
		);

		expect(trace).toHaveLength(4);
	});

	it("reverses canonical CSR adjacency without changing deterministic source order", () => {
		const reverse = reversePhysicalPathAdjacency(
			{
				offsets: new Uint32Array([0, 2, 2, 3]),
				targets: new Uint32Array([1, 2, 1]),
			},
			3,
		);

		expect([...reverse.offsets]).toEqual([0, 0, 2, 3]);
		expect([...reverse.targets]).toEqual([0, 2, 0]);
	});

	it("binds a 10,000-path corridor into flat adjacency buffers", () => {
		const map = new TileMap();
		for (let x = 0; x < 10_000; x++) {
			put(map, x, 0, x === 0 ? 0 : DIR_W, x === 9_999 ? 0 : DIR_E);
		}
		const paths = compilePhysicalPaths(map);
		const adjacency = buildPhysicalPathAdjacency(paths);

		expect(paths.pathCount).toBe(10_000);
		expect(adjacency.offsets).toBeInstanceOf(Uint32Array);
		expect(adjacency.targets).toBeInstanceOf(Uint32Array);
		expect(adjacency.targets).toHaveLength(9_999);
		expect(adjacency.offsets[10_000]).toBe(9_999);
	});
});
