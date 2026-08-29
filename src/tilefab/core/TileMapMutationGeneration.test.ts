import { describe, expect, it } from "vitest";
import { ADVANCED_SWITCH_ALL_MOVEMENTS } from "./AdvancedSwitch";
import { DIR_E, DIR_S } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";

describe("TileMap runtime mutation generation", () => {
	it("isolates copy-on-write rail chunks across clone mutations and clears", () => {
		const source = new TileMap();
		const east = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		const south = encodeRailCell({ incoming: 0, outgoing: DIR_S });
		source.setEncoded(0, 0, east);
		source.setEncoded(64, 0, south);
		const clone = source.clone();
		const cloneOfClone = clone.clone();

		source.setEncoded(0, 0, south);
		source.setEncoded(1, 0, east);
		clone.setEncoded(64, 0, east);
		clone.setEncoded(0, 0, 0);

		expect(source.getEncoded(0, 0)).toBe(south);
		expect(source.getEncoded(1, 0)).toBe(east);
		expect(source.getEncoded(64, 0)).toBe(south);
		expect(clone.getEncoded(0, 0)).toBe(0);
		expect(clone.getEncoded(1, 0)).toBe(0);
		expect(clone.getEncoded(64, 0)).toBe(east);
		expect(cloneOfClone.getEncoded(0, 0)).toBe(east);
		expect(cloneOfClone.getEncoded(1, 0)).toBe(0);
		expect(cloneOfClone.getEncoded(64, 0)).toBe(south);

		source.clearAll();
		expect(source.size).toBe(0);
		expect(clone.size).toBe(1);
		expect(cloneOfClone.size).toBe(2);
	});

	it("iterates the same rail cells cooperatively and rejects a mid-iteration mutation", async () => {
		const map = new TileMap();
		const encoded = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		map.setEncoded(0, 0, encoded);
		map.setEncoded(1, 0, encoded);
		const synchronous: string[] = [];
		map.forEachRail((x, y, _rail, value) => synchronous.push(`${x},${y}:${value}`));
		const cooperative: string[] = [];
		let checkpoints = 0;
		await map.forEachRailCooperatively(
			(x, y, _rail, value) => cooperative.push(`${x},${y}:${value}`),
			async () => {
				checkpoints++;
			},
			1,
		);
		expect(cooperative).toEqual(synchronous);
		expect(checkpoints).toBe(3);

		let mutated = false;
		await expect(
			map.forEachRailCooperatively(
				() => undefined,
				async () => {
					if (mutated) return;
					mutated = true;
					map.setEncoded(2, 0, encoded);
				},
				1,
			),
		).rejects.toThrow(/changed during cooperative rail iteration/i);
	});

	it("advances for actual cell, clear, and hydration-cursor mutations only", () => {
		const map = new TileMap();
		const encoded = encodeRailCell({ incoming: 0, outgoing: DIR_E });

		expect(map.setEncoded(0, 0, 0)).toBe(false);
		expect(map.getMutationGeneration()).toBe(0);
		expect(map.setEncoded(0, 0, encoded)).toBe(true);
		expect(map.getMutationGeneration()).toBe(1);
		map.clearAll();
		expect(map.getMutationGeneration()).toBe(2);
		map.clearAll();
		expect(map.getMutationGeneration()).toBe(2);

		expect(TileMap.createHydrator().finish(0).getMutationGeneration()).toBe(0);
		expect(TileMap.createHydrator().finish(0, 2).getMutationGeneration()).toBe(1);
	});

	it("rejects an empty rollback and never rewinds across a real rollback", () => {
		const map = new TileMap();
		const checkpoint = map.createMutationCheckpoint();
		expect(() => map.rollbackAtomicMutations([], [], checkpoint)).toThrow(/at least one/);

		const after = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		const mutation = Object.freeze({ x: 0, y: 0, before: 0, after });
		map.applyAtomicMutations([mutation], []);
		const generationAfterApply = map.getMutationGeneration();
		map.rollbackAtomicMutations([mutation], [], checkpoint);

		expect(map.getRevision()).toBe(checkpoint.revision);
		expect(map.getEncoded(0, 0)).toBe(0);
		expect(map.getMutationGeneration()).toBeGreaterThan(generationAfterApply);
	});

	it("preflights inverse and cursor-reset advances before an overflow can partially roll back", () => {
		const record = Object.freeze({
			id: 2,
			profileClass: "A" as const,
			origin: Object.freeze({ x: 0, y: 0 }),
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		});
		const mutation = Object.freeze({ id: 2, before: null, after: record });
		const succeeds = TileMap.createHydrator().finish(0, 2);
		setRuntimeGenerationForTest(succeeds, Number.MAX_SAFE_INTEGER - 4);
		const succeedsCheckpoint = succeeds.createMutationCheckpoint();
		succeeds.applyAtomicMutations([], [mutation]);

		succeeds.rollbackAtomicMutations([], [mutation], succeedsCheckpoint);
		expect(succeeds.getMutationGeneration()).toBe(Number.MAX_SAFE_INTEGER);
		expect(succeeds.getAdvancedSwitchIdCursor()).toBe(2);
		expect(succeeds.advancedSwitchCount).toBe(0);

		const rejected = TileMap.createHydrator().finish(0, 2);
		setRuntimeGenerationForTest(rejected, Number.MAX_SAFE_INTEGER - 3);
		const rejectedCheckpoint = rejected.createMutationCheckpoint();
		rejected.applyAtomicMutations([], [mutation]);

		expect(() => rejected.rollbackAtomicMutations([], [mutation], rejectedCheckpoint)).toThrow(
			/generation is exhausted/,
		);
		expect(rejected.getMutationGeneration()).toBe(Number.MAX_SAFE_INTEGER - 1);
		expect(rejected.getAdvancedSwitchIdCursor()).toBe(3);
		expect(rejected.getRevision()).toBe(1);
		expect(rejected.advancedSwitchCount).toBe(1);
	});

	it("rejects forged, foreign, and successfully consumed rollback checkpoints", () => {
		const after = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		const mutation = Object.freeze({ x: 0, y: 0, before: 0, after });
		const map = new TileMap();
		const checkpoint = map.createMutationCheckpoint();
		map.applyAtomicMutations([mutation], []);

		expect(() =>
			map.rollbackAtomicMutations(
				[mutation],
				[],
				Object.freeze({ revision: 0, nextAdvancedSwitchId: 100 }),
			),
		).toThrow(/invalid, foreign, or already consumed/i);
		expect(map.getAdvancedSwitchIdCursor()).toBe(1);

		const foreignCheckpoint = new TileMap().createMutationCheckpoint();
		expect(() => map.rollbackAtomicMutations([mutation], [], foreignCheckpoint)).toThrow(
			/invalid, foreign, or already consumed/i,
		);

		map.rollbackAtomicMutations([mutation], [], checkpoint);
		expect(() => map.rollbackAtomicMutations([mutation], [], checkpoint)).toThrow(
			/invalid, foreign, or already consumed/i,
		);
	});

	it("rejects an unused checkpoint after a rollback ABA cycle", () => {
		const after = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		const mutation = Object.freeze({ x: 0, y: 0, before: 0, after });
		const map = new TileMap();
		const stale = map.createMutationCheckpoint();
		const rollback = map.createMutationCheckpoint();

		map.applyAtomicMutations([mutation], []);
		map.rollbackAtomicMutations([mutation], [], rollback);
		map.applyAtomicMutations([mutation], []);

		expect(map.getRevision()).toBe(stale.revision + 1);
		expect(() => map.rollbackAtomicMutations([mutation], [], stale)).toThrow(
			/stale for the runtime mutation generation/i,
		);
		expect(map.getEncoded(0, 0)).toBe(after);
	});
});

function setRuntimeGenerationForTest(map: TileMap, generation: number): void {
	(map as unknown as { mutationGeneration: number }).mutationGeneration = generation;
}
