import { describe, expect, it, vi } from "vitest";
import { createCooperativeTask } from "./CooperativeTask";
import { planRailConstruction } from "./paint";
import { createRailAreaSelectionFromOwnerships, planRailAreaBulldoze } from "./RailAreaSelection";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { planStaticFabProcessLoopSelectionEraseSteps } from "./StaticFabProcessLoopSelectionErase";
import { TileMap } from "./TileMap";

describe("cooperative standalone Loop selected-module erase plan", () => {
	it("matches existing directed module removal and preserves unselected endpoint masks", () => {
		const map = rectangle();
		const ownership = buildRailModuleOwnershipIndex(map);
		const module = ownership.modules.find((value) => value.kind === "straight");
		if (!module) throw new Error("missing synthetic straight module");
		const before = map.getRevision();
		const expected = planRailAreaBulldoze(
			map,
			ownership,
			createRailAreaSelectionFromOwnerships(ownership, [module]),
		);
		const task = createCooperativeTask(
			planStaticFabProcessLoopSelectionEraseSteps(map, ownership, Object.freeze([module])),
		);
		while (!task.done) task.step(16);
		const plan = task.finish();
		expect(plan.valid, plan.reason).toBe(expected.valid);
		expect(ordered(plan.mutations)).toEqual(ordered(expected.mutations));
		expect(map.getRevision()).toBe(before);
		expect(plan.switchMutations).toEqual([]);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(plan.mutations.every(Object.isFrozen)).toBe(true);
	});

	it("refuses duplicate, forged or stale module selections without source edits", () => {
		const map = rectangle();
		const ownership = buildRailModuleOwnershipIndex(map);
		const module = ownership.modules[0];
		if (!module) throw new Error("missing module");
		for (const modules of [[module, module], [Object.freeze({ ...module })]]) {
			const task = createCooperativeTask(
				planStaticFabProcessLoopSelectionEraseSteps(map, ownership, Object.freeze(modules)),
			);
			expect(() => {
				while (!task.done) task.step(16);
			}).toThrow(/중복|변경/);
		}
		const fakeArray = Object.freeze({
			0: module,
			length: 1,
		}) as unknown as readonly (typeof module)[];
		const fake = createCooperativeTask(
			planStaticFabProcessLoopSelectionEraseSteps(map, ownership, fakeArray),
		);
		expect(() => fake.step()).toThrow(/목록/);
		const original = map.getEncoded(0, 0);
		map.applyAtomicMutations([{ x: 0, y: 0, before: original, after: 0 }], []);
		map.applyAtomicMutations([{ x: 0, y: 0, before: 0, after: original }], []);
		const task = createCooperativeTask(
			planStaticFabProcessLoopSelectionEraseSteps(map, ownership, Object.freeze([module])),
		);
		expect(() => task.step()).toThrow(/오래/);
	});

	it("bounds source reads across a genuine 100k-cell selected union and keeps the source unchanged", () => {
		const map = new TileMap();
		const construction = planRailConstruction(map, { x: -50000, y: 0 }, { x: 49999, y: 0 });
		if (!construction.valid) throw new Error(construction.reason);
		map.applyAtomicMutations(construction.mutations, []);
		const ownership = buildRailModuleOwnershipIndex(map);
		const revision = map.getRevision();
		const read = vi.spyOn(map, "getEncoded");
		const task = createCooperativeTask(
			planStaticFabProcessLoopSelectionEraseSteps(map, ownership, ownership.modules),
		);
		let steps = 0;
		while (!task.done) {
			const before = read.mock.calls.length;
			task.step(128);
			expect(read.mock.calls.length - before).toBeLessThanOrEqual(512);
			steps++;
		}
		const plan = task.finish();
		expect(steps).toBeGreaterThan(1000);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.mutations).toHaveLength(100000);
		expect(plan.mutations.every((value) => value.after === 0)).toBe(true);
		expect(map.size).toBe(100000);
		expect(map.getRevision()).toBe(revision);
		read.mockRestore();
	}, 60000);
});

function rectangle(): TileMap {
	const map = new TileMap();
	const cells = [
		{ x: 0, y: 0 },
		{ x: 30, y: 0 },
		{ x: 30, y: 20 },
		{ x: 0, y: 20 },
		{ x: 0, y: 0 },
	];
	for (let i = 0; i < 4; i++) {
		const from = cells[i],
			to = cells[i + 1];
		if (!from || !to) throw new Error("missing synthetic corner");
		const plan = planRailConstruction(map, from, to);
		if (!plan.valid) throw new Error(plan.reason);
		map.applyAtomicMutations(plan.mutations, []);
	}
	return map;
}

function ordered(mutations: readonly { x: number; y: number; before: number; after: number }[]) {
	return mutations
		.map((value) => [value.x, value.y, value.before, value.after] as const)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
