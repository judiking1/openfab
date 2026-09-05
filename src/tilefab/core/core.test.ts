import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchRecord,
} from "./AdvancedSwitch";
import { analyzeRailNetwork } from "./network";
import {
	lShapedPath,
	planClosedRailPathComponent,
	planRailConstruction,
	planRailErase,
} from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	directionBetween,
	findDirectedThroughRoute,
	hasDirectedThroughRoute,
	isCorner,
	isJunction,
	isStraight,
	isTangentJunction,
	RAIL_SHAPE,
	shapeForMask,
	tangentJunctionSide,
} from "./railShape";
import { decodeRailCell, encodeRailCell, TileMap } from "./TileMap";

describe("TileMap — directed modular rail storage", () => {
	it("stores incoming/outgoing masks in one byte and tracks edge count", () => {
		const map = new TileMap();
		const encoded = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		expect(map.setEncoded(0, 0, encoded)).toBe(true);
		expect(map.setEncoded(0, 0, encoded)).toBe(false);
		expect(map.getRail(0, 0)).toEqual({ incoming: DIR_W, outgoing: DIR_E });
		expect(map.size).toBe(1);
		expect(map.edgeCount).toBe(1);
		expect(map.setEncoded(0, 0, 0)).toBe(true);
		expect(map.size).toBe(0);
		expect(map.edgeCount).toBe(0);
	});

	it("adjacent rails do not connect unless a path command connected them", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(0, 1, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		expect(map.connectionMask(0, 0)).toBe(DIR_W | DIR_E);
		expect(map.connectionMask(0, 1)).toBe(DIR_W | DIR_E);
	});

	it("supports negative coordinates and chunk boundaries", () => {
		const map = new TileMap();
		map.setEncoded(-1, -1, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		map.setEncoded(-33, 40, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
		expect(map.hasRail(-1, -1)).toBe(true);
		expect(map.hasRail(-33, 40)).toBe(true);
		const cells: string[] = [];
		map.forEachRail((x, y) => cells.push(`${x},${y}`));
		expect(cells.sort()).toEqual(["-1,-1", "-33,40"]);
	});

	it("iterates and bounds 50k sparse typed cells without coordinate aliasing", () => {
		const map = new TileMap();
		const encoded = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			map.setEncoded(index - 25_000, (index % 97) - 48, encoded);
		}
		let visited = 0;
		map.forEachRail(() => visited++);
		expect(visited).toBe(50_000);
		expect(map.size).toBe(50_000);
		expect(map.bounds()).toEqual({ minX: -25_000, minY: -48, maxX: 24_999, maxY: 48 });
	});

	it("encode/decode is stable for every nibble", () => {
		for (let incoming = 0; incoming < 16; incoming++) {
			for (let outgoing = 0; outgoing < 16; outgoing++) {
				expect(decodeRailCell(encodeRailCell({ incoming, outgoing }))).toEqual({
					incoming,
					outgoing,
				});
			}
		}
	});

	it("hydrates a validated baseline incrementally and seals the builder", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(-1, 2, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		hydrator.addEncodedCell(0, 2, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
		const map = hydrator.finish(77);

		expect(map.size).toBe(2);
		expect(map.edgeCount).toBe(1);
		expect(map.getRevision()).toBe(77);
		expect(() => hydrator.addEncodedCell(1, 2, 1)).toThrow("already finished");
	});

	it("rejects duplicate or empty hydrated cells", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(0, 0, 1);
		expect(() => hydrator.addEncodedCell(0, 0, 2)).toThrow("Duplicate");
		expect(() => hydrator.addEncodedCell(1, 0, 0)).toThrow("non-zero byte");
	});

	it("preserves the advanced-switch id cursor independently of live records", () => {
		const source = new TileMap();
		const record = {
			id: 17,
			profileClass: "A" as const,
			origin: { x: 20, y: -4 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		} satisfies AdvancedSwitchRecord;
		expect(source.setAdvancedSwitch(record)).toBe(true);
		expect(source.deleteAdvancedSwitch(record.id)).toBe(true);
		expect(source.advancedSwitchCount).toBe(0);
		expect(source.getAdvancedSwitchIdCursor()).toBe(18);

		const loaded = TileMap.createHydrator().finish(42, source.getAdvancedSwitchIdCursor());
		expect(loaded.getRevision()).toBe(42);
		expect(loaded.getNextAdvancedSwitchId()).toBe(18);

		const exhausted = TileMap.createHydrator().finish(43, ADVANCED_SWITCH_MAX_ID + 1);
		expect(exhausted.getAdvancedSwitchIdCursor()).toBe(ADVANCED_SWITCH_MAX_ID + 1);
		expect(exhausted.getNextAdvancedSwitchId()).toBeNull();
	});
});

describe("railShape", () => {
	it("derives all familiar visual shapes from the union mask", () => {
		expect(shapeForMask(0)).toBe(RAIL_SHAPE.Isolated);
		expect(shapeForMask(DIR_N)).toBe(RAIL_SHAPE.EndN);
		expect(shapeForMask(DIR_N | DIR_S)).toBe(RAIL_SHAPE.StraightNS);
		expect(shapeForMask(DIR_E | DIR_W)).toBe(RAIL_SHAPE.StraightEW);
		expect(shapeForMask(DIR_N | DIR_E)).toBe(RAIL_SHAPE.CornerNE);
		expect(shapeForMask(DIR_E | DIR_S)).toBe(RAIL_SHAPE.CornerES);
		expect(shapeForMask(DIR_S | DIR_W)).toBe(RAIL_SHAPE.CornerSW);
		expect(shapeForMask(DIR_W | DIR_N)).toBe(RAIL_SHAPE.CornerWN);
		expect(shapeForMask(DIR_N | DIR_E | DIR_S)).toBe(RAIL_SHAPE.TeeW);
		expect(shapeForMask(15)).toBe(RAIL_SHAPE.Cross);
	});

	it("provides direction and mask helpers", () => {
		expect(directionBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(DIR_E);
		expect(directionBetween({ x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
		expect(isCorner(DIR_N | DIR_E)).toBe(true);
		expect(isStraight(DIR_E | DIR_W)).toBe(true);
		expect(isJunction(DIR_N | DIR_E | DIR_S)).toBe(true);
		expect(hasDirectedThroughRoute(DIR_E | DIR_S, DIR_W)).toBe(true);
		expect(hasDirectedThroughRoute(DIR_N | DIR_S, DIR_W)).toBe(false);
		expect(isTangentJunction(DIR_E | DIR_S, DIR_W)).toBe(true);
		expect(isTangentJunction(DIR_N | DIR_S, DIR_W)).toBe(false);
		expect(bitCount(15)).toBe(4);
	});

	it("accepts tangent turnouts and rejects head-on T shapes in every orientation", () => {
		const valid = [
			{ incoming: DIR_W, outgoing: DIR_E | DIR_N },
			{ incoming: DIR_W, outgoing: DIR_E | DIR_S },
			{ incoming: DIR_N, outgoing: DIR_S | DIR_E },
			{ incoming: DIR_N, outgoing: DIR_S | DIR_W },
			{ incoming: DIR_E, outgoing: DIR_W | DIR_N },
			{ incoming: DIR_E, outgoing: DIR_W | DIR_S },
			{ incoming: DIR_S, outgoing: DIR_N | DIR_E },
			{ incoming: DIR_S, outgoing: DIR_N | DIR_W },
			{ incoming: DIR_W | DIR_N, outgoing: DIR_E },
			{ incoming: DIR_W | DIR_S, outgoing: DIR_E },
			{ incoming: DIR_N | DIR_E, outgoing: DIR_S },
			{ incoming: DIR_N | DIR_W, outgoing: DIR_S },
			{ incoming: DIR_E | DIR_N, outgoing: DIR_W },
			{ incoming: DIR_E | DIR_S, outgoing: DIR_W },
			{ incoming: DIR_S | DIR_E, outgoing: DIR_N },
			{ incoming: DIR_S | DIR_W, outgoing: DIR_N },
		];
		const invalid = [
			{ incoming: DIR_W, outgoing: DIR_N | DIR_S },
			{ incoming: DIR_E, outgoing: DIR_N | DIR_S },
			{ incoming: DIR_N, outgoing: DIR_E | DIR_W },
			{ incoming: DIR_S, outgoing: DIR_E | DIR_W },
			{ incoming: DIR_N | DIR_S, outgoing: DIR_W },
			{ incoming: DIR_N | DIR_S, outgoing: DIR_E },
			{ incoming: DIR_E | DIR_W, outgoing: DIR_N },
			{ incoming: DIR_E | DIR_W, outgoing: DIR_S },
		];

		for (const rail of valid) {
			expect(isTangentJunction(rail.incoming, rail.outgoing)).toBe(true);
			expect(findDirectedThroughRoute(rail.incoming, rail.outgoing)).not.toBeNull();
			expect(tangentJunctionSide(rail.incoming, rail.outgoing)).not.toBeNull();
		}
		for (const rail of invalid) {
			expect(isTangentJunction(rail.incoming, rail.outgoing)).toBe(false);
			expect(tangentJunctionSide(rail.incoming, rail.outgoing)).toBeNull();
		}
	});
});

describe("construction planning", () => {
	it("creates one atomic directed L route with a real curve cell", () => {
		const map = new TileMap();
		const plan = planRailConstruction(map, { x: 0, y: 0 }, { x: 3, y: 2 });
		expect(plan.valid).toBe(true);
		expect(plan.lengthMeters).toBe(5);
		expect(plan.turns).toBe(1);
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 2 })),
		).toBe(true);
		expect(document.map.getRail(3, 0)).toEqual({ incoming: DIR_W, outgoing: DIR_S });
	});

	it("always returns a plan for axis-aligned routes under either locked bend mode", () => {
		const map = new TileMap();
		const vertical = planRailConstruction(map, { x: 0, y: -3 }, { x: 0, y: 3 }, "vertical-first");
		const horizontal = planRailConstruction(
			map,
			{ x: -3, y: 0 },
			{ x: 3, y: 0 },
			"horizontal-first",
		);
		expect(vertical.valid).toBe(true);
		expect(vertical.bend).toBe("vertical-first");
		expect(vertical.lengthMeters).toBe(6);
		expect(horizontal.valid).toBe(true);
		expect(horizontal.bend).toBe("horizontal-first");
		expect(horizontal.lengthMeters).toBe(6);
	});

	it("supports smooth 1→2 branch and rejects a planar cross", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 }));
		const branch = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 });
		expect(branch.valid).toBe(true);
		document.commit(branch);
		expect(document.map.getRail(3, 0)).toEqual({ incoming: DIR_W, outgoing: DIR_E | DIR_S });

		const cross = planRailConstruction(document.map, { x: 5, y: -2 }, { x: 5, y: 2 });
		expect(cross.valid).toBe(false);
		expect(cross.reason).toContain("십자 교차");
		expect(cross.conflicts).toContainEqual({ x: 5, y: 0 });
	});

	it("reserves one straight support cell on both sides of a turnout", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 }));

		const tooShort = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 1 });
		expect(tooShort.valid).toBe(false);
		expect(tooShort.reason).toContain("400 mm 대칭 리드");
		expect(tooShort.conflicts).toContainEqual({ x: 3, y: 1 });

		const supported = planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 2 });
		expect(supported.valid).toBe(true);
	});

	it("allows disconnected construction drafts while catalog roots still prove self-closure", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 }));
		const disconnected = planRailConstruction(document.map, { x: 20, y: 20 }, { x: 24, y: 20 });
		expect(disconnected.valid).toBe(true);
		expect(disconnected.reason).toBe("배치 가능");
		expect(document.commit(disconnected)).toBe(true);
		const openEscapeAttempt = planClosedRailPathComponent(document.map, [
			{ x: 40, y: 40 },
			{ x: 41, y: 40 },
		]);
		expect(openEscapeAttempt.valid).toBe(false);
		expect(openEscapeAttempt.reason).toContain("자체 폐합");
	});

	it("keeps detached closed placement subject to crossing and reverse-overlap rules", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);

		const crossingLoop = planClosedRailPathComponent(document.map, [
			{ x: 2, y: -2 },
			{ x: 2, y: -1 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 2, y: 2 },
			{ x: 3, y: 2 },
			{ x: 4, y: 2 },
			{ x: 4, y: 1 },
			{ x: 4, y: 0 },
			{ x: 4, y: -1 },
			{ x: 4, y: -2 },
			{ x: 3, y: -2 },
			{ x: 2, y: -2 },
		]);
		expect(crossingLoop.valid).toBe(false);
		expect(crossingLoop.reason).toContain("십자 교차");

		const reverseOverlapLoop = planClosedRailPathComponent(document.map, [
			{ x: 6, y: 0 },
			{ x: 5, y: 0 },
			{ x: 4, y: 0 },
			{ x: 3, y: 0 },
			{ x: 2, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
			{ x: 3, y: 1 },
			{ x: 4, y: 1 },
			{ x: 5, y: 1 },
			{ x: 6, y: 1 },
			{ x: 6, y: 0 },
		]);
		expect(reverseOverlapLoop.valid).toBe(false);
		expect(reverseOverlapLoop.reason).toContain("역방향");
	});

	it("rejects reverse-direction overlap on the same physical rail", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 }));
		const reverse = planRailConstruction(document.map, { x: 4, y: 0 }, { x: 0, y: 0 });
		expect(reverse.valid).toBe(false);
		expect(reverse.reason).toContain("역방향");
	});

	it("auto bend chooses the valid side when one L route would cross", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 }));
		const plan = planRailConstruction(document.map, { x: 2, y: 0 }, { x: 5, y: 3 });
		expect(plan.valid).toBe(true);
		expect(plan.cells[0]).toEqual({ x: 2, y: 0 });
		expect(plan.cells.at(-1)).toEqual({ x: 5, y: 3 });
	});

	it("auto bend continues an open endpoint in its current travel direction", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 3 }));
		const continuation = planRailConstruction(document.map, { x: 5, y: 3 }, { x: 1, y: 6 });
		expect(continuation.valid).toBe(true);
		expect(continuation.bend).toBe("vertical-first");
		expect(continuation.cells[1]).toEqual({ x: 5, y: 4 });
	});

	it("rejects a head-on T merge with opposing incoming routes", () => {
		const document = new RailDocument();
		expect(
			document.commit(
				planRailConstruction(document.map, { x: 0, y: -3 }, { x: -3, y: 0 }, "vertical-first"),
			),
		).toBe(true);

		const headOn = planRailConstruction(document.map, { x: 0, y: 3 }, { x: 0, y: 0 });
		expect(headOn.valid).toBe(false);
		expect(headOn.reason).toContain("정면 충돌 T자");
		expect(headOn.conflicts).toContainEqual({ x: 0, y: 0 });
	});

	it("rejects a head-on T branch with opposing outgoing routes", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: -3 })),
		).toBe(true);

		const headOn = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 });
		expect(headOn.valid).toBe(false);
		expect(headOn.reason).toContain("정면 충돌 T자");
		expect(headOn.conflicts).toContainEqual({ x: 0, y: 0 });
	});

	it("allows a tangent merge with one straight trunk and one curved approach", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: -3, y: 0 })),
		).toBe(true);

		const tangent = planRailConstruction(document.map, { x: 0, y: 3 }, { x: 0, y: 0 });
		expect(tangent.valid).toBe(true);
		expect(document.commit(tangent)).toBe(true);
		expect(document.map.getRail(0, 0)).toEqual({
			incoming: DIR_E | DIR_S,
			outgoing: DIR_W,
		});
	});
});

describe("RailDocument and network analysis", () => {
	it("activates a loaded map with empty history and the supplied patch sequence", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(0, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		hydrator.addEncodedCell(1, 0, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
		const document = RailDocument.fromLoadedMap(hydrator.finish(31), 9);

		expect(document.map.size).toBe(2);
		expect(document.map.getRevision()).toBe(31);
		expect(document.getPatchSequence()).toBe(9);
		expect(document.canUndo).toBe(false);
		expect(document.canRedo).toBe(false);
	});

	it("builds a closed directed loop and reports it as simulation-ready", () => {
		const document = new RailDocument();
		const build = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
			expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
		};
		build({ x: 0, y: 0 }, { x: 6, y: 0 });
		build({ x: 6, y: 0 }, { x: 6, y: 4 });
		build({ x: 6, y: 4 }, { x: 0, y: 4 });
		build({ x: 0, y: 4 }, { x: 0, y: 0 });

		const analysis = analyzeRailNetwork(document.map);
		expect(analysis.status).toBe("closed");
		expect(analysis.openEnds).toBe(0);
		expect(analysis.stronglyConnected).toBe(true);
		expect(analysis.curves).toBe(4);
	});

	it("erase is atomic and undo/redo restore exact directed ports", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 }));
		const before = document.map.edgeCount;
		const erase = planRailErase(document.map, lShapedPath({ x: 2, y: 0 }, { x: 3, y: 0 }));
		expect(document.commit(erase)).toBe(true);
		expect(document.map.edgeCount).toBeLessThan(before);
		expect(document.undo()).toBe(true);
		expect(document.map.edgeCount).toBe(before);
		expect(document.redo()).toBe(true);
		expect(document.map.edgeCount).toBeLessThan(before);
	});

	it("emits revisioned patches for the future worker bridge", () => {
		const document = new RailDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 }));
		document.undo();
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ sequence: 1, kind: "build", baseRevision: 0 });
		expect(events[0]?.revision).toBeGreaterThan(0);
		expect(events[1]).toMatchObject({
			sequence: 2,
			kind: "undo",
			baseRevision: events[0]?.revision,
		});
		expect(events[1]?.revision).toBeGreaterThan(events[1]?.baseRevision ?? 0);
	});

	it("marks externally supplied head-on T junctions as unsafe", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_N | DIR_S, outgoing: DIR_W }));
		const analysis = analyzeRailNetwork(map);
		expect(analysis.status).toBe("unsafe");
		expect(analysis.unsafeJunctions).toBe(1);
	});
});
