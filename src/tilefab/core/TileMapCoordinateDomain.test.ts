import { describe, expect, it, vi } from "vitest";
import { type AdvancedSwitchRecord, deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import {
	RAIL_COORDINATE_MAX_METERS as BOUND,
	isSupportedRailCoordinate,
	isSupportedRailFootprint,
} from "./RailCoordinateDomain";
import { assertRailSourceCapacity, railSourceCapacityError } from "./RailSourceCapacity";
import { TileMap } from "./TileMap";

function record(id: number, x: number): AdvancedSwitchRecord {
	return { id, profileClass: "B", origin: { x, y: 0 }, forward: 2, lateral: 4, movementMask: 15 };
}

function assertCount(map: TileMap, expected: number): void {
	// Independent source walk detects missed setter/sidecar/candidate/rollback maintenance.
	let actual = 0;
	const outside = (x: number, y: number): boolean =>
		x < -BOUND || x > BOUND || y < -BOUND || y > BOUND;
	map.forEachRail((x, y) => {
		if (outside(x, y)) actual++;
	});
	map.forEachAdvancedSwitch((entry) => {
		if (
			[entry.origin, ...deriveAdvancedSwitchGeometry(entry).claimedCells].some((cell) =>
				outside(cell.x, cell.y),
			)
		)
			actual++;
	});
	expect(actual).toBe(expected);
	expect(map.getUnsupportedCoordinateSourceCount()).toBe(actual);
}

function finish(steps: Generator<void, TileMap>): TileMap {
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

describe("V1 coordinate admission and diagnostic source accounting", () => {
	it("admits both closed integer boundaries and checks origin independently of claims", () => {
		for (const x of [-BOUND, 0, BOUND])
			for (const y of [-BOUND, 0, BOUND]) expect(isSupportedRailCoordinate(x, y)).toBe(true);
		for (const value of [-BOUND - 1, BOUND + 1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect(isSupportedRailCoordinate(value, 0)).toBe(false);
			expect(isSupportedRailCoordinate(0, value)).toBe(false);
		}
		expect(isSupportedRailFootprint({ x: BOUND + 1, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
		expect(isSupportedRailFootprint({ x: 0, y: 0 }, [{ x: 0, y: -BOUND - 1 }])).toBe(false);
	});
	it("tracks normalized raw edits, replacement, no-op, deletion and clear", () => {
		const map = new TileMap();
		map.setEncoded(BOUND, -BOUND, 0x28);
		map.setEncoded(BOUND + 1, 0, 0x128);
		map.setEncoded(0, -BOUND - 1, 0x28);
		assertCount(map, 2);
		map.setEncoded(BOUND + 1, 0, 0x24);
		expect(map.setEncoded(BOUND + 1, 0, 0x124)).toBe(false);
		assertCount(map, 2);
		map.setEncoded(0, -BOUND - 1, 0);
		assertCount(map, 1);
		for (const value of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
			expect(() => map.setEncoded(value, 0, 0x28)).toThrow(/safe integers/);
		assertCount(map, 1);
		map.clearAll();
		map.clearAll();
		assertCount(map, 0);
	});
	it("retains raw diagnostic hydration and isolates clones and cooperative candidates", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(-BOUND - 1, 10, 0x28);
		const outside = record(1, BOUND);
		hydrator.addAdvancedSwitch(outside);
		expect(() => hydrator.addAdvancedSwitch(record(2, BOUND))).toThrow(/overlaps/);
		const source = hydrator.finish(7);
		assertCount(source, 2);
		const clone = source.clone();
		clone.deleteAdvancedSwitch(1);
		clone.setEncoded(-BOUND - 1, 10, 0);
		assertCount(clone, 0);
		const repaired = finish(
			source.createMutationCandidateSteps(
				[{ x: -BOUND - 1, y: 10, before: 0x28, after: 0 }],
				[{ id: 1, before: outside, after: record(1, 0) }],
			),
		);
		assertCount(repaired, 0);
		const extra = record(3, -BOUND - 30);
		const added = finish(
			source.createAdditionCandidateSteps(
				[{ x: BOUND + 1, y: 10, before: 0, after: 0x28 }],
				[{ id: 3, before: null, after: extra }],
			),
		);
		assertCount(added, 4);
		assertCount(source, 2);
	});
	it("combines cell and simultaneous switch deltas and restores them by inverse rollback", () => {
		const map = new TileMap();
		const first = record(1, 0),
			second = record(2, BOUND);
		map.setAdvancedSwitch(first);
		map.setAdvancedSwitch(second);
		const cells = [{ x: -BOUND - 1, y: 10, before: 0, after: 0x28 }];
		const switches = [
			{ id: 1, before: first, after: { ...second, id: 1 } },
			{ id: 2, before: second, after: { ...first, id: 2 } },
		];
		const checkpoint = map.createMutationCheckpoint();
		map.applyAtomicMutations(cells, switches);
		assertCount(map, 2);
		map.rollbackAtomicMutations(cells, switches, checkpoint);
		assertCount(map, 1);
		expect(map.getRevision()).toBe(checkpoint.revision);
		const prepared = finish(map.createMutationCandidateSteps(cells, switches));
		assertCount(prepared, 2);
		expect(() =>
			map.applyAtomicMutations(cells, [{ id: 3, before: null, after: record(3, 0) }]),
		).toThrow(/overlaps/);
		expect(() =>
			map.applyAtomicMutations([...cells, { x: 0.5, y: 10, before: 0, after: 0x28 }], []),
		).toThrow(/invalid/);
		assertCount(map, 1);
		expect(map.getRevision()).toBe(checkpoint.revision);
		map.clearAll();
		assertCount(map, 0);
	});
	it("checks prospective cell and reserved-footprint edits without a whole-map traversal", () => {
		const map = new TileMap();
		for (const method of ["forEachRail", "forEachAdvancedSwitch", "clone"] as const)
			vi.spyOn(map, method).mockImplementation(() => {
				throw new Error("unexpected map scan/clone");
			});
		const cell = { x: BOUND + 1, y: 0, before: 0, after: 0x28 };
		expect(railSourceCapacityError(map, [cell])).toContain("지원 범위");
		const switchRecord = record(1, BOUND);
		expect(
			railSourceCapacityError(map, [], [{ id: 1, before: null, after: switchRecord }]),
		).toContain("지원 범위");
		expect(map.getUnsupportedCoordinateSourceCount()).toBe(0);
		map.applyAtomicMutations([cell], [{ id: 1, before: null, after: switchRecord }]);
		expect(() => assertRailSourceCapacity(map)).toThrow(/지원 범위/);
		expect(railSourceCapacityError(map, [{ ...cell, before: 0x28, after: 0 }])).toContain(
			"지원 범위",
		);
		expect(
			railSourceCapacityError(
				map,
				[{ ...cell, before: 0x28, after: 0 }],
				[{ id: 1, before: switchRecord, after: null }],
			),
		).toBeNull();
		expect(railSourceCapacityError(map, [cell])).toContain("원본");
	});
});
