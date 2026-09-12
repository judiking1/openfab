import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	type CompiledPhysicalPaths,
	compilePhysicalPaths,
	PATH_KIND,
} from "./PhysicalPathCompiler";
import { authoredPhysicalPathContinuation } from "./PhysicalPathFlow";
import { TurnoutClearancePathIndex } from "./TurnoutClearanceOwnership";

function reference(paths: CompiledPhysicalPaths, core: number, port: "incoming" | "outgoing") {
	for (let row = 0; row < paths.pathCount; row++) {
		if (
			port === "incoming"
				? authoredPhysicalPathContinuation(paths, row, paths, core)
				: authoredPhysicalPathContinuation(paths, core, paths, row)
		)
			return row;
	}
	return -1;
}

function fixture() {
	const map = new TileMap();
	for (const [x, y, incoming, outgoing] of [
		[-2, 0, DIR_W, DIR_E],
		[-1, 0, DIR_W, DIR_E],
		[0, 0, DIR_W, DIR_E | DIR_S],
		[1, 0, DIR_W, DIR_E],
		[0, 1, DIR_N, DIR_S],
		[0, 2, DIR_N, DIR_E],
		[1, 2, DIR_W | DIR_N, DIR_E],
		[1, 1, DIR_N, DIR_S],
		[2, 2, DIR_W, DIR_E],
		[9, 0, DIR_N, DIR_S],
	])
		map.setEncoded(x, y, encodeRailCell({ incoming, outgoing }));
	return compilePhysicalPaths(map);
}

describe("turnout clearance seam index", () => {
	it.each([
		"ordinary",
		"multi-cell",
		"invalid",
		"no-direction",
		"coincident",
	])("matches the directed seam scan for %s paths, including stable first-row ownership", (kind) => {
		const paths = fixture();
		if (kind === "multi-cell") paths.exitCells[0] = -1;
		if (kind === "invalid") paths.kinds[1] = PATH_KIND.INVALID;
		if (kind === "no-direction") {
			paths.fromDirections[1] = 0;
			paths.toDirections[0] = 0;
		}
		if (kind === "coincident") {
			paths.cells[2] = paths.cells[0] as number;
			paths.cells[3] = paths.cells[1] as number;
			paths.exitCells[2] = paths.exitCells[0] as number;
			paths.exitCells[3] = paths.exitCells[1] as number;
		}
		const index = new TurnoutClearancePathIndex(paths);
		for (let row = -1; row <= paths.pathCount; row++) {
			for (const port of ["incoming", "outgoing"] as const)
				expect(index.findConnectedPath(row, port)).toBe(reference(paths, row, port));
		}
	});

	it("indexes once and bounds path reads independently of the number of turnout lookups", () => {
		const map = new TileMap();
		for (let x = 0; x < 20_000; x++)
			map.setEncoded(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		const original = compilePhysicalPaths(map);
		let reads = 0;
		const paths = {
			...original,
			kinds: new Proxy(original.kinds, {
				get(target, key) {
					if (typeof key === "string" && /^\d+$/.test(key)) reads++;
					return Reflect.get(target, key, target);
				},
			}),
		};
		const index = new TurnoutClearancePathIndex(paths);
		expect(reads).toBe(paths.pathCount);
		for (let row = 1; row < paths.pathCount - 1; row += 20) {
			expect(index.findConnectedPath(row, "incoming")).toBe(row - 1);
			expect(index.findConnectedPath(row, "outgoing")).toBe(row + 1);
		}
		expect(reads).toBe(paths.pathCount + 2_000);
	});
});
