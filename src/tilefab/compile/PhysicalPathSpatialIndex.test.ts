import { describe, expect, it } from "vitest";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalPaths } from "./PhysicalPathCompiler";
import { PhysicalPathSpatialIndex } from "./PhysicalPathSpatialIndex";

describe("PhysicalPathSpatialIndex", () => {
	it("queries only paths intersecting visible chunks, including negative coordinates", () => {
		const map = new TileMap();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (const [x, y] of [
			[-40, -4],
			[-1, 0],
			[0, 0],
			[31, 0],
			[32, 0],
			[80, 20],
		] as const) {
			map.setEncoded(x, y, straight);
		}
		const paths = compilePhysicalPaths(map);
		const index = new PhysicalPathSpatialIndex(paths);

		expect(index.query({ minX: -2, minY: -1, maxX: 33, maxY: 1 })).toEqual([1, 2, 3, 4]);
		expect(index.query({ minX: -41, minY: -5, maxX: -39, maxY: -3 })).toEqual([0]);
		expect(index.stats.chunkCount).toBeGreaterThan(1);
	});

	it("deduplicates a path referenced by multiple chunks", () => {
		const map = new TileMap();
		map.setEncoded(31, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		const paths = compilePhysicalPaths(map);
		const index = new PhysicalPathSpatialIndex(paths, 1);

		expect(index.stats.pathReferences).toBe(2);
		expect(index.query({ minX: 30, minY: -1, maxX: 33, maxY: 2 })).toEqual([0]);
	});

	it("hydrates a typed snapshot with query-equivalent results and rejects corrupt CSR", () => {
		const map = new TileMap();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (const [x, y] of [
			[-40, 0],
			[0, 0],
			[31, 0],
			[64, 8],
		] as const) {
			map.setEncoded(x, y, straight);
		}
		const paths = compilePhysicalPaths(map);
		const compiled = new PhysicalPathSpatialIndex(paths);
		const hydrated = PhysicalPathSpatialIndex.fromSnapshot(paths, compiled.captureSnapshot());
		const bounds = { minX: -2, minY: -2, maxX: 34, maxY: 2 };
		expect(hydrated.query(bounds)).toEqual(compiled.query(bounds));
		expect(hydrated.stats).toEqual(compiled.stats);

		const snapshot = compiled.captureSnapshot();
		const offsets = snapshot.chunkOffsets.slice();
		if (offsets.length > 2) offsets[1] = snapshot.pathIndices.length + 1;
		expect(() =>
			PhysicalPathSpatialIndex.fromSnapshot(paths, { ...snapshot, chunkOffsets: offsets }),
		).toThrow("malformed");
	});

	it("indexes and queries 50k paths within the frame-budget harness", () => {
		const map = new TileMap();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			map.setEncoded(index % 1_000, Math.floor(index / 1_000) * 2, straight);
		}
		const paths = compilePhysicalPaths(map);
		const buildStartedAt = Date.now();
		const spatial = new PhysicalPathSpatialIndex(paths);
		const buildMilliseconds = Date.now() - buildStartedAt;
		const queryStartedAt = Date.now();
		const visible = spatial.query({ minX: 100, minY: 10, maxX: 260, maxY: 50 });
		const queryMilliseconds = Date.now() - queryStartedAt;

		expect(visible.length).toBeGreaterThan(0);
		expect(visible.length).toBeLessThan(paths.pathCount / 5);
		expect(buildMilliseconds).toBeLessThan(1_000);
		expect(queryMilliseconds).toBeLessThan(50);
	});
});
