import { describe, expect, it, vi } from "vitest";
import { type AdvancedSwitchRecord, deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { createCooperativeTask } from "./CooperativeTask";
import {
	createRailModuleOwnershipIndexCompiler,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import { encodeRailCell, TileMap } from "./TileMap";

describe("cooperative authored module compilation", () => {
	it("does not traverse on creation and cannot publish an unfinished partition", () => {
		const map = straightMap(13);
		const traverse = vi.spyOn(map, "railTraversalSteps");
		const task = createRailModuleOwnershipIndexCompiler(map);
		expect(traverse).not.toHaveBeenCalled();
		expect(() => task.finish()).toThrow("not complete");
		for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => task.step(invalid)).toThrow("positive safe integer");
		}
		while (!task.done) expect(task.step(1)).toBe(1);
		const result = task.finish();
		expect(railModuleOwnershipIndexMatchesMap(result, map)).toBe(true);
		expect(result.modules.map((module) => module.construction.lengthMeters)).toEqual([5, 5, 3]);
		expect(task.step(1)).toBe(0);
		expect(task.finish()).toBe(result);
	});

	it("partitions long directed chains exactly once and preserves both terminal owners", () => {
		const map = straightMap(10_003);
		const task = createRailModuleOwnershipIndexCompiler(map);
		let steps = 0;
		while (!task.done) {
			task.step(128);
			steps++;
		}
		const index = task.finish();
		const edges = index.modules.flatMap((module) => module.eraseEdges);
		const keys = edges.map((edge) => `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`);
		expect(steps).toBeGreaterThan(100);
		expect(index.modules).toHaveLength(2_001);
		expect(new Set(keys).size).toBe(10_003);
		expect(edges).toHaveLength(10_003);
		expect(index.modules.at(-1)?.construction.lengthMeters).toBe(3);
		expect(index.resolve({ x: 0, y: 0 })).toMatchObject({
			status: "resolved",
			module: { key: "LINEAR_EDGE:0,0>1,0" },
		});
		expect(index.resolve({ x: 10_003, y: 0 })).toMatchObject({
			status: "resolved",
			module: { key: "LINEAR_EDGE:10000,0>10001,0" },
		});
	});

	it.each([
		"before-first-step",
		"mid-compile",
		"after-completion",
	] as const)("rejects source mutation %s", (phase) => {
		const map = straightMap(13);
		const task = createRailModuleOwnershipIndexCompiler(map);
		if (phase === "mid-compile") task.step(1);
		if (phase === "after-completion") while (!task.done) task.step(128);
		map.setEncoded(0, 0, 0);
		expect(() => task.step(1)).toThrow("source changed");
		expect(() => task.finish()).toThrow("source changed");
	});

	it("rejects edit/rollback ABA even when authored bytes and revision are restored", () => {
		const map = straightMap(13);
		const task = createRailModuleOwnershipIndexCompiler(map);
		task.step(1);
		const revision = map.getRevision();
		const checkpoint = map.createMutationCheckpoint();
		const mutations = [{ x: 0, y: 0, before: map.getEncoded(0, 0), after: 0 }];
		map.applyAtomicMutations(mutations, []);
		map.rollbackAtomicMutations(mutations, [], checkpoint);
		expect(map.getRevision()).toBe(revision);
		expect(map.getEncoded(0, 0)).toBe(mutations[0]?.before);
		expect(() => task.step(1)).toThrow("source changed");
		expect(() => task.finish()).toThrow("source changed");
	});

	it("accounts for empty storage cells before reaching a sparse rail entry", () => {
		const hydrate = TileMap.createHydrator();
		hydrate.addEncodedCell(31, 31, encodeRailCell({ incoming: 8, outgoing: 0 }));
		const map = hydrate.finish(1);
		const seen: number[][] = [];
		const task = createCooperativeTask(map.railTraversalSteps((x, y) => seen.push([x, y])));
		for (let index = 0; index < 31; index++) expect(task.step(1)).toBe(1);
		expect(seen).toEqual([]);
		expect(task.done).toBe(false);
		task.step(1);
		expect(seen).toEqual([[31, 31]]);
		while (!task.done) task.step(1);
		task.finish();
	});

	it("visits advanced switches in ID order and rejects changes before traversal starts", () => {
		const hydrate = TileMap.createHydrator();
		for (const [offset, id] of [30, 2, 17].entries()) {
			const record: AdvancedSwitchRecord = {
				id,
				profileClass: "B",
				origin: { x: offset * 20, y: 0 },
				forward: 2,
				lateral: 4,
				movementMask: 15,
			};
			for (const cell of deriveAdvancedSwitchGeometry(record).cellStates)
				hydrate.addEncodedCell(cell.x, cell.y, cell.encoded);
			hydrate.addAdvancedSwitch(record);
		}
		const map = hydrate.finish(1);
		const seen: number[] = [];
		const steps = map.advancedSwitchTraversalSteps((record) => seen.push(record.id));
		const task = createCooperativeTask(steps);
		expect(seen).toEqual([]);
		while (!task.done) task.step(1);
		expect(seen).toEqual([2, 17, 30]);
		const stale = createCooperativeTask(map.advancedSwitchTraversalSteps(() => undefined));
		map.setEncoded(100, 100, encodeRailCell({ incoming: 8, outgoing: 0 }));
		expect(() => stale.step(1)).toThrow("source traversal");
		expect(() => stale.finish()).toThrow("source traversal");
	});
});

function straightMap(length: number): TileMap {
	const hydrate = TileMap.createHydrator();
	for (let x = 0; x <= length; x++)
		hydrate.addEncodedCell(
			x,
			0,
			encodeRailCell({ incoming: x === 0 ? 0 : 8, outgoing: x === length ? 0 : 2 }),
		);
	return hydrate.finish(1);
}
