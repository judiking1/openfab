import { describe, expect, it } from "vitest";
import { analyzeRailNetwork, checksumRailNetworkAnalysis } from "./network";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";

describe("RailNetworkAnalysis", () => {
	it("publishes empty deterministic component buffers", () => {
		const analysis = analyzeRailNetwork(new TileMap());

		expect(analysis).toMatchObject({
			status: "empty",
			components: 0,
			strongComponents: 0,
			stronglyConnected: false,
		});
		expect(analysis.openEndCells).toEqual(new Int32Array());
		expect(analysis.strongComponentRepresentatives).toEqual(new Int32Array());
		expect(analysis.minimumReturnLinks).toBe(0);
		expect(analysis.oneWayCorridorOffsets).toEqual(new Uint32Array([0]));
	});

	it("reports every directed component and sorted open terminal", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -2, y: 3 }, { x: 2, y: 3 })),
		).toBe(true);

		const analysis = analyzeRailNetwork(document.map);
		expect(analysis).toMatchObject({
			status: "open",
			components: 1,
			strongComponents: 5,
			openEnds: 2,
			stronglyConnected: false,
		});
		expect(analysis.openEndCells).toEqual(new Int32Array([-2, 3, 2, 3]));
		expect(analysis.componentRepresentatives).toEqual(new Int32Array([-2, 3]));
		expect(analysis.strongComponentRepresentatives).toEqual(
			new Int32Array([-2, 3, -1, 3, 0, 3, 1, 3, 2, 3]),
		);
		expect(analysis.minimumReturnLinks).toBe(1);
		expect(analysis.oneWayCorridorOffsets).toEqual(new Uint32Array([0, 5]));
	});

	it("distinguishes weak and strong connectivity for disconnected closed loops", () => {
		const first = new RailDocument();
		const second = new RailDocument();
		buildLoop(first, 0, 0);
		buildLoop(second, 20, 4);
		const hydrator = TileMap.createHydrator();
		first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));

		const analysis = analyzeRailNetwork(hydrator.finish(1));
		expect(analysis).toMatchObject({
			status: "disconnected",
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			stronglyConnected: false,
		});
		expect(analysis.componentRepresentatives).toEqual(new Int32Array([0, 0, 20, 4]));
		expect(analysis.strongComponentRepresentatives).toEqual(new Int32Array([0, 0, 20, 4]));
		expect(analysis.minimumReturnLinks).toBe(2);
		expect(analysis.oneWayCorridorOffsets).toEqual(new Uint32Array([0]));
	});

	it("reduces a one-way bridge between closed loops to one actionable return pair", () => {
		const first = new RailDocument();
		const second = new RailDocument();
		buildLoop(first, 0, 0);
		buildLoop(second, 20, 0);
		const hydrator = TileMap.createHydrator();
		first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		const joined = RailDocument.fromLoadedMap(hydrator.finish(1), 0);
		expect(joined.commit(planRailConstruction(joined.map, { x: 6, y: 2 }, { x: 20, y: 2 }))).toBe(
			true,
		);

		const analysis = analyzeRailNetwork(joined.map);
		expect(analysis.components).toBe(1);
		expect(analysis.openEnds).toBe(0);
		expect(analysis.strongComponents).toBeGreaterThan(1);
		expect(analysis.minimumReturnLinks).toBe(1);
		expect(analysis.oneWayCorridorOffsets).toEqual(new Uint32Array([0, 15]));
		expect(analysis.oneWayCorridorBoundaries).toEqual(new Int32Array([6, 2, 7, 2, 19, 2, 20, 2]));
	});

	it("retains parallel one-way bridges between the same flow regions as distinct corridors", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S | DIR_E }));
		map.setEncoded(0, 1, encodeRailCell({ incoming: DIR_S, outgoing: DIR_N | DIR_E }));
		map.setEncoded(1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(1, 1, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(2, 0, encodeRailCell({ incoming: DIR_W | DIR_N, outgoing: DIR_S }));
		map.setEncoded(2, 1, encodeRailCell({ incoming: DIR_W | DIR_S, outgoing: DIR_N }));

		const analysis = analyzeRailNetwork(map);

		expect(analysis.components).toBe(1);
		expect(analysis.strongComponents).toBe(4);
		expect(analysis.minimumReturnLinks).toBe(1);
		expect(analysis.oneWayCorridorOffsets).toEqual(new Uint32Array([0, 3, 6]));
		expect(analysis.oneWayCorridorBoundaries).toEqual(
			new Int32Array([0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 1, 1, 1, 1, 2, 1]),
		);
	});

	it("includes SCC and offending-cell buffers in the analysis fingerprint", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_N | DIR_S, outgoing: DIR_W }));
		const analysis = analyzeRailNetwork(map);
		const baseline = checksumRailNetworkAnalysis(analysis, "authored");

		expect(analysis.unsafeJunctionCells).toEqual(new Int32Array([0, 0]));
		expect(
			checksumRailNetworkAnalysis(
				{ ...analysis, unsafeJunctionCells: new Int32Array([1, 0]) },
				"authored",
			),
		).not.toBe(baseline);
	});

	it("keeps weak connectivity symmetric when malformed reciprocity reverses coordinate order", () => {
		for (const [sourceX, outgoing, targetX] of [
			[0, DIR_W, -1],
			[-1, DIR_E, 0],
		] as const) {
			const map = new TileMap();
			map.setEncoded(sourceX, 0, encodeRailCell({ incoming: 0, outgoing }));
			map.setEncoded(targetX, 0, encodeRailCell({ incoming: 0, outgoing: DIR_N }));
			expect(analyzeRailNetwork(map).components).toBe(1);
		}
	});
});

function buildLoop(document: RailDocument, x: number, y: number): void {
	for (const [from, to] of [
		[
			{ x, y },
			{ x: x + 6, y },
		],
		[
			{ x: x + 6, y },
			{ x: x + 6, y: y + 4 },
		],
		[
			{ x: x + 6, y: y + 4 },
			{ x, y: y + 4 },
		],
		[
			{ x, y: y + 4 },
			{ x, y },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
	}
}
