import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	createRailModuleOwnershipIndexHydrator,
	createRailModuleOwnershipIndexHydratorCooperatively,
	planRailModuleBulldoze,
	resolveRailModuleOwnership,
} from "./RailModuleOwnership";
import { planRailModule } from "./RailModulePlanner";
import { ALL_DIRECTIONS, type Direction, moveCell, oppositeDirection } from "./railShape";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";
import { collectTurnoutFootprints } from "./turnout";

describe("RailModuleOwnership", () => {
	it.each([
		["u-turn", "compact", "u-turn"],
		["u-turn", "wide", "u-turn"],
		["shift", "compact", "shift"],
		["shift", "wide", "shift"],
	] as const)("reconstructs every primary cell and exactly bulldozes one %s %s", (moduleKind, span, expectedKind) => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const baseline = mapRows(document.map);
		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, moduleKind, span);
		expect(document.commit(plan)).toBe(true);
		const built = mapRows(document.map);
		const index = buildRailModuleOwnershipIndex(document.map);
		const module = index.modules.find(
			(candidate) => candidate.kind === expectedKind && candidate.construction.span === span,
		);
		if (!module) throw new Error(`expected ${moduleKind} ${span}`);

		for (const cell of module.primaryCells) {
			expect(resolveRailModuleOwnership(index, cell)).toMatchObject({
				status: "resolved",
				module: { key: module.key },
			});
		}
		const erase = planRailModuleBulldoze(document.map, module);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		expect(mapRows(document.map)).toEqual(baseline);
		expect(document.undo()).toBe(true);
		expect(mapRows(document.map)).toEqual(built);
		expect(document.redo()).toBe(true);
		expect(mapRows(document.map)).toEqual(baseline);
	});

	it("reconstructs compound span and chirality in every quarter-turn", () => {
		for (const forward of ALL_DIRECTIONS) {
			for (const side of ["left", "right"] as const) {
				for (const [moduleKind, span] of [
					["u-turn", "compact"],
					["u-turn", "wide"],
					["shift", "compact"],
					["shift", "wide"],
				] as const) {
					const origin = { x: 0, y: 0 };
					const document = documentEndingAt(moveRepeated(origin, oppositeDirection(forward), 3));
					const lateral = side === "left" ? leftOf(forward) : oppositeDirection(leftOf(forward));
					const pointer = moveRepeated(origin, lateral, 3);
					const plan = planRailModule(document.map, origin, pointer, moduleKind, span);
					expect(plan.valid, `${forward}/${side}/${moduleKind}/${span}: ${plan.reason}`).toBe(true);
					expect(document.commit(plan)).toBe(true);
					const module = buildRailModuleOwnershipIndex(document.map).modules.find(
						(candidate) => candidate.kind === moduleKind,
					);
					expect(module?.construction).toMatchObject({ span, side });
				}
			}
		}
	});

	it("partitions every directed straight edge into one deterministic 1-5 m module", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = index.modules.filter((module) => module.kind === "straight");

		expect(straight.map((module) => module.construction.lengthMeters)).toEqual([5, 5, 3]);
		const ownedEdgeKeys = straight.flatMap((module) =>
			module.eraseEdges.map((edge) => edgeKey(edge.from, edge.to)),
		);
		expect(new Set(ownedEdgeKeys).size).toBe(ownedEdgeKeys.length);
		expect(ownedEdgeKeys).toHaveLength(document.map.edgeCount);
		const first = resolveRailModuleOwnership(index, { x: 0, y: 0 });
		const last = resolveRailModuleOwnership(index, { x: 13, y: 0 });
		expect(first).toMatchObject({ status: "resolved", module: { key: straight[0]?.key } });
		expect(last).toMatchObject({ status: "resolved", module: { key: straight[2]?.key } });
		if (first.status !== "resolved") throw new Error(first.reason);
		const erase = planRailModuleBulldoze(document.map, first.module);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		expect(compilePhysicalRail(document.map).valid).toBe(true);
		expect(document.map.hasRail(6, 0)).toBe(true);
	});

	it("round-trips the exact cell candidate index through bounded startup hydration", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const original = buildRailModuleOwnershipIndex(document.map);
		const hydrator = createRailModuleOwnershipIndexHydrator(original.captureSnapshot());
		let steps = 0;
		while (!hydrator.done) {
			expect(hydrator.step(2)).toBeGreaterThan(0);
			steps++;
		}
		const restored = hydrator.finish();

		expect(steps).toBeGreaterThan(1);
		expect(restored.revision).toBe(original.revision);
		expect(restored.modules.map((module) => module.key)).toEqual(
			original.modules.map((module) => module.key),
		);
		for (let x = 0; x <= 13; x++) {
			expect(restored.resolve({ x, y: 0 })).toEqual(original.resolve({ x, y: 0 }));
		}
	});

	it("cooperatively validates a transferred ownership snapshot before bounded hydration", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const original = buildRailModuleOwnershipIndex(document.map);
		let checkpoints = 0;
		const hydrator = await createRailModuleOwnershipIndexHydratorCooperatively(
			original.captureSnapshot(),
			async () => {
				checkpoints++;
			},
			2,
		);
		while (!hydrator.done) expect(hydrator.step(2)).toBeGreaterThan(0);
		const restored = hydrator.finish();

		expect(checkpoints).toBeGreaterThan(1);
		expect(restored.revision).toBe(original.revision);
		expect(restored.modules.map((module) => module.key)).toEqual(
			original.modules.map((module) => module.key),
		);
		for (let x = 0; x <= 13; x++) {
			expect(restored.resolve({ x, y: 0 })).toEqual(original.resolve({ x, y: 0 }));
		}
	});

	it("cooperatively rejects a late invalid ownership candidate reference", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const snapshot = buildRailModuleOwnershipIndex(document.map).captureSnapshot();
		const candidateModuleIndices = snapshot.candidateModuleIndices.slice();
		candidateModuleIndices[candidateModuleIndices.length - 1] = snapshot.modules.moduleCount;
		let checkpoints = 0;

		await expect(
			createRailModuleOwnershipIndexHydratorCooperatively(
				{ ...snapshot, candidateModuleIndices },
				async () => {
					checkpoints++;
				},
				2,
			),
		).rejects.toThrow("references missing module");
		expect(checkpoints).toBeGreaterThan(1);
	});

	it("rejects corrupted startup ownership candidate ranges", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 }));
		const snapshot = buildRailModuleOwnershipIndex(document.map).captureSnapshot();
		const candidateOffsets = snapshot.candidateOffsets.slice();
		candidateOffsets[candidateOffsets.length - 1]++;

		expect(() => createRailModuleOwnershipIndexHydrator({ ...snapshot, candidateOffsets })).toThrow(
			"candidate offsets",
		);
	});

	it("bulldozes a middle straight module without changing either neighbor's edges", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const index = buildRailModuleOwnershipIndex(document.map);
		const straight = index.modules.filter((module) => module.kind === "straight");
		const middle = straight[1];
		if (!middle) throw new Error("expected middle straight module");
		const neighborEdges = [straight[0], straight[2]].flatMap((module) => module?.eraseEdges ?? []);

		const erase = planRailModuleBulldoze(document.map, middle);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		for (const edge of neighborEdges)
			expect(hasDirectedEdge(document.map, edge.from, edge.to)).toBe(true);
		expect(compilePhysicalRail(document.map).valid).toBe(true);
	});

	it("removes only a turnout's diverging edge and preserves the exact trunk bytes", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const trunk = mapRows(document.map);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const footprint = collectTurnoutFootprints(document.map)[0];
		if (!footprint) throw new Error("expected turnout footprint");
		const index = buildRailModuleOwnershipIndex(document.map);
		const selected = resolveRailModuleOwnership(index, footprint.cell, {
			incoming: footprint.curveFrom,
			outgoing: footprint.curveTo,
			role: "turnout-diverge",
		});
		if (selected.status !== "resolved") throw new Error(selected.reason);
		expect(selected.module.kind).toBe("turnout");

		const erase = planRailModuleBulldoze(document.map, selected.module);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		expect(mapRowsInRow(document.map, 0)).toEqual(trunk);
		expect(compilePhysicalRail(document.map).valid).toBe(true);
		expect(compilePhysicalRail(document.map).junctions).toHaveLength(0);
	});

	it("preserves the diverging edge when bulldozing the straight path under a turnout", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const footprint = collectTurnoutFootprints(document.map)[0];
		const support = footprint?.reservedCells.find(
			(cell) => cell.x !== footprint.cell.x || cell.y !== footprint.cell.y,
		);
		if (!support) throw new Error("expected turnout support cell");
		const index = buildRailModuleOwnershipIndex(document.map);
		expect(resolveRailModuleOwnership(index, support).status).toBe("ambiguous");
		const selected = resolveRailModuleOwnership(index, support, {
			incoming: footprint.through.incoming,
			outgoing: footprint.through.outgoing,
			role: "through",
		});
		if (selected.status !== "resolved") throw new Error(selected.reason);
		expect(selected.module.kind).toBe("straight");
		const divergingEdge =
			footprint.kind === 0
				? { from: footprint.cell, to: moveCell(footprint.cell, footprint.divergingSide) }
				: { from: moveCell(footprint.cell, footprint.divergingSide), to: footprint.cell };

		const erase = planRailModuleBulldoze(document.map, selected.module);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		expect(hasDirectedEdge(document.map, divergingEdge.from, divergingEdge.to)).toBe(true);
		expect(compilePhysicalRail(document.map).valid).toBe(true);
	});

	it("rejects a straight bulldoze that would remove a turnout's required diverging lead", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const before = mapRows(document.map);
		const footprint = collectTurnoutFootprints(document.map)[0];
		if (!footprint) throw new Error("expected turnout footprint");
		const divergingSupport = moveCell(footprint.cell, footprint.divergingSide);
		const selected = resolveRailModuleOwnership(
			buildRailModuleOwnershipIndex(document.map),
			divergingSupport,
			{
				incoming: footprint.curveFrom,
				outgoing: footprint.curveTo,
				role: "through",
			},
		);
		if (selected.status !== "resolved") throw new Error(selected.reason);
		expect(selected.module.kind).toBe("straight");

		const erase = planRailModuleBulldoze(document.map, selected.module);
		expect(erase.valid).toBe(false);
		expect(erase.reason).toMatch(/turnout|토폴로지/);
		expect(document.commit(erase)).toBe(false);
		expect(mapRows(document.map)).toEqual(before);
	});

	it("uses a physical-route role to disambiguate every turnout support cell", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const footprint = collectTurnoutFootprints(document.map)[0];
		if (!footprint) throw new Error("expected turnout footprint");
		const index = buildRailModuleOwnershipIndex(document.map);

		for (const cell of footprint.reservedCells) {
			expect(resolveRailModuleOwnership(index, cell).status).toBe("ambiguous");
			expect(
				resolveRailModuleOwnership(index, cell, {
					incoming: footprint.curveFrom,
					outgoing: footprint.curveTo,
					role: "turnout-diverge",
				}),
			).toMatchObject({ status: "resolved", module: { kind: "turnout" } });
			expect(
				resolveRailModuleOwnership(index, cell, {
					incoming: footprint.through.incoming,
					outgoing: footprint.through.outgoing,
					role: "through",
				}),
			).toMatchObject({ status: "resolved", module: { kind: "straight" } });
		}
	});

	it("preserves connected input and output rails while atomically removing an advanced switch", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const inputBaseline = mapRows(document.map);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "D");
		expect(document.commit(switchPlan)).toBe(true);
		const record = document.map.getAdvancedSwitch(switchPlan.switchRecord?.id ?? -1);
		if (!record) throw new Error("expected advanced switch");
		const geometry = deriveAdvancedSwitchGeometry(record);
		const output = geometry.outputs[0];
		const outputEnd = moveRepeated(output.cell, output.direction, 3);
		expect(document.commit(planRailConstruction(document.map, output.cell, outputEnd))).toBe(true);
		const index = buildRailModuleOwnershipIndex(document.map);
		const reserved = geometry.reservedCells[0] as Cell;
		const selected = resolveRailModuleOwnership(index, reserved);
		if (selected.status !== "resolved") throw new Error(selected.reason);

		const erase = planRailModuleBulldoze(document.map, selected.module);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		expect(document.map.advancedSwitchCount).toBe(0);
		for (const [x, y, encoded] of inputBaseline)
			expect(document.map.getEncoded(x, y)).toBe(encoded);
		const outputRail = document.map.getRail(output.cell.x, output.cell.y);
		const outputNeighbor = moveCell(output.cell, output.direction);
		expect(outputRail.outgoing & output.direction).toBe(output.direction);
		expect(document.map.getRail(outputNeighbor.x, outputNeighbor.y).incoming).toBe(
			oppositeDirection(output.direction),
		);
		expect(compilePhysicalRail(document.map).valid).toBe(true);
	});

	it("rejects stale ownership after any authored revision", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const selected = resolveRailModuleOwnership(buildRailModuleOwnershipIndex(document.map), {
			x: -1,
			y: 0,
		});
		if (selected.status !== "resolved") throw new Error(selected.reason);
		expect(
			document.commit(
				planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "u-turn", "compact"),
			),
		).toBe(true);

		const erase = planRailModuleBulldoze(document.map, selected.module);

		expect(erase.valid).toBe(false);
		expect(erase.reason).toContain("오래되어");
	});

	it("does not downgrade an invalid authored cell into a selectable module", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: 1 | 4, outgoing: 8 }));

		expect(
			resolveRailModuleOwnership(buildRailModuleOwnershipIndex(map), { x: 0, y: 0 }),
		).toMatchObject({
			status: "none",
		});
	});
});

function documentEndingAt(from: Cell): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, from, { x: 0, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function moveRepeated(
	cell: Cell,
	direction: Parameters<typeof moveCell>[1],
	distance: number,
): Cell {
	let current = cell;
	for (let step = 0; step < distance; step++) current = moveCell(current, direction);
	return current;
}

function leftOf(direction: Direction): Direction {
	if (direction === 1) return 8;
	if (direction === 2) return 1;
	if (direction === 4) return 2;
	return 4;
}

function mapRows(map: TileMap): readonly [number, number, number][] {
	const rows: [number, number, number][] = [];
	map.forEachRail((x, y, _rail, encoded) => rows.push([x, y, encoded]));
	return rows.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
}

function mapRowsInRow(map: TileMap, y: number): readonly [number, number, number][] {
	return mapRows(map).filter((row) => row[1] === y);
}

function edgeKey(from: Cell, to: Cell): string {
	return `${from.x},${from.y}>${to.x},${to.y}`;
}

function hasDirectedEdge(map: TileMap, from: Cell, to: Cell): boolean {
	const direction = ALL_DIRECTIONS.find((candidate) => {
		const moved = moveCell(from, candidate);
		return moved.x === to.x && moved.y === to.y;
	});
	return direction ? (map.getRail(from.x, from.y).outgoing & direction) !== 0 : false;
}
