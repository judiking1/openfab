import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import {
	planMoveCorner,
	planMoveEndpoint,
	planOffsetStraight,
	planRemoveBranchRoute,
	planRemoveOneWayCorridor,
	planRepairOneWayCorridor,
} from "./edit";
import { analyzeRailNetwork } from "./network";
import { planRailConstruction } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { DIR_E, DIR_W } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";

function buildLoopWithBypass(): RailDocument {
	const document = new RailDocument();
	const build = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
		expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
	};
	build({ x: 0, y: 0 }, { x: 10, y: 0 });
	build({ x: 10, y: 0 }, { x: 10, y: 8 });
	build({ x: 10, y: 8 }, { x: 0, y: 8 });
	build({ x: 0, y: 8 }, { x: 0, y: 0 });
	build({ x: 3, y: 0 }, { x: 3, y: -3 });
	build({ x: 3, y: -3 }, { x: 7, y: -3 });
	build({ x: 7, y: -3 }, { x: 7, y: 0 });
	return document;
}

function buildPlainLoop(): RailDocument {
	const document = new RailDocument();
	for (const [from, to] of [
		[
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		],
		[
			{ x: 10, y: 0 },
			{ x: 10, y: 8 },
		],
		[
			{ x: 10, y: 8 },
			{ x: 0, y: 8 },
		],
		[
			{ x: 0, y: 8 },
			{ x: 0, y: 0 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
	}
	return document;
}

function buildOpenLine(): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(
		true,
	);
	return document;
}

function buildOneWayBridge(): RailDocument {
	const first = new RailDocument();
	const second = new RailDocument();
	buildLoopAt(first, 0, 0);
	buildLoopAt(second, 20, 0);
	const hydrator = TileMap.createHydrator();
	first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
	second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
	const document = RailDocument.fromLoadedMap(hydrator.finish(1), 0);
	expect(document.commit(planRailConstruction(document.map, { x: 8, y: 3 }, { x: 20, y: 3 }))).toBe(
		true,
	);
	return document;
}

function buildLoopAt(document: RailDocument, x: number, y: number, width = 8, height = 6): void {
	for (const [from, to] of [
		[
			{ x, y },
			{ x: x + width, y },
		],
		[
			{ x: x + width, y },
			{ x: x + width, y: y + height },
		],
		[
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
		[
			{ x, y: y + height },
			{ x, y },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
	}
}

function buildRepairableOneWayBridge(): RailDocument {
	const first = new RailDocument();
	const second = new RailDocument();
	buildLoopAt(first, 0, 0, 24, 6);
	buildLoopAt(second, 0, 14, 24, 6);
	const hydrator = TileMap.createHydrator();
	first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
	second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
	const document = RailDocument.fromLoadedMap(hydrator.finish(1), 0);
	expect(
		document.commit(planRailConstruction(document.map, { x: 16, y: 6 }, { x: 16, y: 14 })),
	).toBe(true);
	return document;
}

function diagnosedOneWayCorridor(document: RailDocument) {
	const analysis = analyzeRailNetwork(document.map);
	const start = analysis.oneWayCorridorOffsets[0] as number;
	const end = analysis.oneWayCorridorOffsets[1] as number;
	return {
		cells: Array.from({ length: end - start }, (_, index) => ({
			x: analysis.oneWayCorridorCells[(start + index) * 2] as number,
			y: analysis.oneWayCorridorCells[(start + index) * 2 + 1] as number,
		})),
		departure: {
			from: {
				x: analysis.oneWayCorridorBoundaries[0] as number,
				y: analysis.oneWayCorridorBoundaries[1] as number,
			},
			to: {
				x: analysis.oneWayCorridorBoundaries[2] as number,
				y: analysis.oneWayCorridorBoundaries[3] as number,
			},
		},
		arrival: {
			from: {
				x: analysis.oneWayCorridorBoundaries[4] as number,
				y: analysis.oneWayCorridorBoundaries[5] as number,
			},
			to: {
				x: analysis.oneWayCorridorBoundaries[6] as number,
				y: analysis.oneWayCorridorBoundaries[7] as number,
			},
		},
	};
}

describe("branch route editing", () => {
	it("removes the complete bypass from a branch while preserving the closed trunk", () => {
		const document = buildLoopWithBypass();
		expect(analyzeRailNetwork(document.map).junctions).toBe(2);
		const plan = planRemoveBranchRoute(document.map, { x: 3, y: 0 });
		expect(plan.valid).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const analysis = analyzeRailNetwork(document.map);
		expect(analysis.status).toBe("closed");
		expect(analysis.junctions).toBe(0);
		expect(document.map.hasRail(5, -3)).toBe(false);
	});

	it("can trace the same bypass backward from the merge", () => {
		const document = buildLoopWithBypass();
		const plan = planRemoveBranchRoute(document.map, { x: 7, y: 0 });
		expect(plan.valid).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
		expect(analyzeRailNetwork(document.map).junctions).toBe(0);
	});

	it("undo restores the exact bypass and both junctions", () => {
		const document = buildLoopWithBypass();
		document.commit(planRemoveBranchRoute(document.map, { x: 3, y: 0 }));
		expect(document.undo()).toBe(true);
		const analysis = analyzeRailNetwork(document.map);
		expect(analysis.status).toBe("closed");
		expect(analysis.junctions).toBe(2);
		expect(document.map.hasRail(5, -3)).toBe(true);
	});
});

describe("one-way bridge recovery", () => {
	it("removes only the exact diagnosed corridor and preserves two closed loops", () => {
		const document = buildOneWayBridge();
		const before = analyzeRailNetwork(document.map);
		expect(before.components).toBe(1);
		expect(before.strongComponents).toBeGreaterThan(1);

		const plan = planRemoveOneWayCorridor(document.map, diagnosedOneWayCorridor(document));
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			status: "disconnected",
		});

		expect(document.undo()).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({ components: 1, openEnds: 0 });
	});

	it("refuses a stale or incomplete corridor proof without mutating the map", () => {
		const document = buildOneWayBridge();
		const corridor = diagnosedOneWayCorridor(document);
		const revision = document.map.getRevision();
		const plan = planRemoveOneWayCorridor(document.map, {
			...corridor,
			cells: corridor.cells.slice(0, -1),
		});

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("다시 검사");
		expect(document.map.getRevision()).toBe(revision);
	});

	it("atomically replaces a repairable one-way bridge with outbound and return routes", () => {
		const document = buildRepairableOneWayBridge();
		const originalCorridor = diagnosedOneWayCorridor(document);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const plan = planRepairOneWayCorridor(document.map, originalCorridor);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]?.kind).toBe("edit");
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});

		expect(document.undo()).toBe(true);
		const restored = analyzeRailNetwork(document.map);
		expect(restored.components).toBe(1);
		expect(restored.strongComponents).toBeGreaterThan(1);
		expect(restored.oneWayCorridorOffsets.length).toBeGreaterThan(1);
	});

	it("keeps the original bridge when its loop runs cannot support a Network Link", () => {
		const document = buildOneWayBridge();
		const revision = document.map.getRevision();
		const plan = planRepairOneWayCorridor(document.map, diagnosedOneWayCorridor(document));

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("자동 왕복 연결 지점이 부족");
		expect(document.map.getRevision()).toBe(revision);
		expect(analyzeRailNetwork(document.map).components).toBe(1);
	});

	it("refuses to remove one of several parallel one-way bridges", () => {
		const document = buildRepairableOneWayBridge();
		expect(
			document.commit(planRailConstruction(document.map, { x: 8, y: 6 }, { x: 8, y: 14 })),
		).toBe(true);
		const analysis = analyzeRailNetwork(document.map);
		expect(analysis.oneWayCorridorOffsets.length).toBe(3);
		const revision = document.map.getRevision();

		const plan = planRemoveOneWayCorridor(document.map, diagnosedOneWayCorridor(document));
		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("자동 철거하지 않았습니다");
		expect(document.map.getRevision()).toBe(revision);
	});
});

describe("corner replacement editing", () => {
	it("moves a corner through one atomic edit while preserving the closed loop", () => {
		const document = buildPlainLoop();
		const plan = planMoveCorner(document.map, { x: 10, y: 0 }, { x: 12, y: -2 });
		expect(plan.valid).toBe(true);
		expect(plan.kind).toBe("edit");
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
		expect(document.map.hasRail(10, 0)).toBe(false);
		expect(document.map.hasRail(12, -2)).toBe(true);
	});

	it("undo restores the original corner and removes the detour", () => {
		const document = buildPlainLoop();
		document.commit(planMoveCorner(document.map, { x: 10, y: 0 }, { x: 12, y: -2 }));
		expect(document.undo()).toBe(true);
		expect(document.map.hasRail(10, 0)).toBe(true);
		expect(document.map.hasRail(12, -2)).toBe(false);
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
	});

	it("rejects a corner move through occupied trunk cells", () => {
		const document = buildPlainLoop();
		const plan = planMoveCorner(document.map, { x: 10, y: 0 }, { x: 5, y: 8 });
		expect(plan.valid).toBe(false);
		expect(plan.conflicts.length).toBeGreaterThan(0);
	});

	it("preserves unrelated graph components through a local corner replacement", () => {
		const document = buildPlainLoop();
		document.map.setEncoded(30, 30, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		for (let x = 31; x < 35; x++) {
			document.map.setEncoded(x, 30, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		document.map.setEncoded(35, 30, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
		const before = analyzeRailNetwork(document.map);
		expect(before.components).toBe(2);

		const plan = planMoveCorner(document.map, { x: 10, y: 0 }, { x: 12, y: -2 });
		expect(plan.valid).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const after = analyzeRailNetwork(document.map);
		expect(after.components).toBe(before.components);
		expect(after.status).toBe(before.status);
	});

	it("plans against a 50k-cell map without cloning or globally analyzing unrelated chunks", () => {
		const document = buildPlainLoop();
		const expected = planMoveCorner(document.map, { x: 10, y: 0 }, { x: 12, y: -2 });
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			document.map.setEncoded(100_000 + index, 100, straight);
		}

		const startedAt = Date.now();
		const actual = planMoveCorner(document.map, { x: 10, y: 0 }, { x: 12, y: -2 });
		const elapsedMilliseconds = Date.now() - startedAt;

		expect(actual.valid).toBe(true);
		expect(actual.cells).toEqual(expected.cells);
		expect(actual.mutations).toEqual(expected.mutations);
		expect(elapsedMilliseconds).toBeLessThan(100);
	});
});

describe("endpoint replacement editing", () => {
	it("moves the outgoing start terminal without changing the directed open path", () => {
		const document = buildOpenLine();
		const plan = planMoveEndpoint(document.map, { x: 0, y: 0 }, { x: -2, y: -2 });

		expect(plan.valid).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("open");
		expect(analyzeRailNetwork(document.map).openEnds).toBe(2);
		expect(document.map.getRail(-2, -2).incoming).toBe(0);
		expect(document.map.getRail(-2, -2).outgoing).not.toBe(0);
		expect(document.map.hasRail(0, 0)).toBe(false);
	});

	it("moves the incoming end terminal and preserves its flow orientation", () => {
		const document = buildOpenLine();
		const plan = planMoveEndpoint(document.map, { x: 10, y: 0 }, { x: 12, y: 2 });

		expect(plan.valid).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("open");
		expect(document.map.getRail(12, 2).incoming).not.toBe(0);
		expect(document.map.getRail(12, 2).outgoing).toBe(0);
		expect(document.map.getRail(10, 0).outgoing).not.toBe(0);
	});

	it("undo restores the exact original endpoint arm", () => {
		const document = buildOpenLine();
		document.commit(planMoveEndpoint(document.map, { x: 10, y: 0 }, { x: 12, y: 2 }));

		expect(document.undo()).toBe(true);
		expect(document.map.hasRail(10, 0)).toBe(true);
		expect(document.map.hasRail(12, 2)).toBe(false);
		expect(analyzeRailNetwork(document.map).status).toBe("open");
	});

	it("rejects a moved endpoint route that would overlap another rail", () => {
		const document = buildOpenLine();
		document.map.setEncoded(7, 2, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));

		const plan = planMoveEndpoint(document.map, { x: 10, y: 0 }, { x: 7, y: 3 });
		expect(plan.valid).toBe(false);
		expect(plan.conflicts).toContainEqual({ x: 7, y: 2 });
	});
});

describe("straight offset editing", () => {
	it("replaces a horizontal run with a four-corner dogleg and keeps the loop closed", () => {
		const document = buildPlainLoop();
		const plan = planOffsetStraight(document.map, { x: 5, y: 0 }, { x: 5, y: -2 });

		expect(plan.valid).toBe(true);
		expect(plan.turns).toBe(4);
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
		expect(document.map.hasRail(5, 0)).toBe(false);
		expect(document.map.hasRail(5, -2)).toBe(true);
	});

	it("offsets a vertical run perpendicular to its axis", () => {
		const document = buildPlainLoop();
		const plan = planOffsetStraight(document.map, { x: 0, y: 4 }, { x: -2, y: 4 });

		expect(plan.valid).toBe(true);
		expect(document.commit(plan)).toBe(true);
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
		expect(document.map.hasRail(0, 4)).toBe(false);
		expect(document.map.hasRail(-2, 4)).toBe(true);
	});

	it("undo restores the straight run and removes the offset route", () => {
		const document = buildPlainLoop();
		document.commit(planOffsetStraight(document.map, { x: 5, y: 0 }, { x: 5, y: -2 }));

		expect(document.undo()).toBe(true);
		expect(document.map.hasRail(5, 0)).toBe(true);
		expect(document.map.hasRail(5, -2)).toBe(false);
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
	});

	it("rejects occupied offset lanes instead of creating an implicit junction", () => {
		const document = buildPlainLoop();
		document.map.setEncoded(5, -2, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));

		const plan = planOffsetStraight(document.map, { x: 5, y: 0 }, { x: 5, y: -2 });
		expect(plan.valid).toBe(false);
		expect(plan.conflicts).toContainEqual({ x: 5, y: -2 });
	});

	it("requires 3 m of consistent straight support on both sides", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 }));

		const plan = planOffsetStraight(document.map, { x: 2, y: 0 }, { x: 2, y: 2 });
		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("3 m");
	});

	it("plans locally with 50k unrelated cells", () => {
		const document = buildPlainLoop();
		const expected = planOffsetStraight(document.map, { x: 5, y: 0 }, { x: 5, y: -2 });
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			document.map.setEncoded(100_000 + index, 100, straight);
		}

		const startedAt = Date.now();
		const actual = planOffsetStraight(document.map, { x: 5, y: 0 }, { x: 5, y: -2 });
		const elapsedMilliseconds = Date.now() - startedAt;

		expect(actual.valid).toBe(true);
		expect(actual.cells).toEqual(expected.cells);
		expect(actual.mutations).toEqual(expected.mutations);
		expect(elapsedMilliseconds).toBeLessThan(100);
	});
});
