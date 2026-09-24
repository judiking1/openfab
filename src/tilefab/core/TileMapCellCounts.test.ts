import { describe, expect, it } from "vitest";
import { TileMap } from "./TileMap";

function counts(map: TileMap): number[] {
	return Array.from({ length: 256 }, (_, encoded) => map.getEncodedCellCount(encoded));
}

function assertCounts(map: TileMap): void {
	const actual = new Array<number>(256).fill(0);
	map.forEachRail((_x, _y, _rail, encoded) => actual[encoded]++);
	expect(counts(map)).toEqual(actual);
	expect(actual.reduce((sum, count) => sum + count, 0)).toBe(map.size);
}

function finish(steps: Generator<void, TileMap>): TileMap {
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

describe("runtime encoded cell counts", () => {
	it("tracks normalized edits, no-ops, deletion and clear without counting empty cells", () => {
		const map = new TileMap();
		for (let byte = 0; byte < 256; byte++) map.setEncoded(byte - 128, -33, byte + 256);
		assertCounts(map);
		expect(map.getEncodedCellCount(0)).toBe(0);
		expect(map.setEncoded(1, -33, 129)).toBe(false);
		map.setEncoded(1, -33, 0);
		map.setEncoded(-128, -33, 0x28);
		map.setEncoded(2, -33, 0x28);
		assertCounts(map);
		map.clearAll();
		assertCounts(map);
		map.clearAll();
		assertCounts(map);
	});
	it("keeps hydration, synchronous clones and both cooperative candidates independent", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(-33, 0, 0x28);
		hydrator.addEncodedCell(32, 0, 0x82);
		const source = hydrator.finish(7);
		const clone = source.clone();
		const changed = finish(
			source.createMutationCandidateSteps(
				[
					{ x: -33, y: 0, before: 0x28, after: 0x24 },
					{ x: 32, y: 0, before: 0x82, after: 0 },
				],
				[],
			),
		);
		const added = finish(
			source.createAdditionCandidateSteps([{ x: 64, y: 0, before: 0, after: 0x28 }], []),
		);
		clone.setEncoded(-33, 0, 0);
		source.setEncoded(32, 0, 0x28);
		for (const map of [source, clone, changed, added]) assertCounts(map);
		expect(source.getEncodedCellCount(0x28)).toBe(2);
		expect(clone.getEncodedCellCount(0x28)).toBe(0);
		expect(changed.getEncodedCellCount(0x24)).toBe(1);
		expect(added.getEncodedCellCount(0x82)).toBe(1);
	});
	it("restores counts through atomic rollback and leaves rejected batches unchanged", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, 0x28);
		const before = counts(map);
		const checkpoint = map.createMutationCheckpoint();
		const changes = [
			{ x: 0, y: 0, before: 0x28, after: 0x24 },
			{ x: 1, y: 0, before: 0, after: 0x82 },
		];
		map.applyAtomicMutations(changes, []);
		assertCounts(map);
		map.rollbackAtomicMutations(changes, [], checkpoint);
		expect(counts(map)).toEqual(before);
		expect(map.getRevision()).toBe(checkpoint.revision);
		expect(() => map.applyAtomicMutations([changes[0], changes[0]], [])).toThrow(/Duplicate/);
		expect(counts(map)).toEqual(before);
		assertCounts(map);
	});
});
