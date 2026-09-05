import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { TileMap } from "./TileMap";

describe("private advanced-switch hydration", () => {
	it("preserves ordinary mutation generations, out-of-order IDs, claims, and cursor restoration", () => {
		const hydrate = TileMap.createHydrator();
		const ordinary = new TileMap();
		const records = [record(30, 0), record(2, 20), record(17, 40)];
		for (const switchRecord of records) {
			for (const cell of deriveAdvancedSwitchGeometry(switchRecord).cellStates) {
				hydrate.addEncodedCell(cell.x, cell.y, cell.encoded);
				ordinary.setEncoded(cell.x, cell.y, cell.encoded);
			}
			hydrate.addAdvancedSwitch(switchRecord);
			ordinary.setAdvancedSwitch(switchRecord);
		}
		const map = hydrate.finish(999, 41);
		expect(map.getRevision()).toBe(999);
		expect(map.getMutationGeneration()).toBe(ordinary.getMutationGeneration() + 1);
		expect(map.getAdvancedSwitchIdCursor()).toBe(41);
		expect(map.size).toBe(ordinary.size);
		for (const switchRecord of records) {
			expect(map.getAdvancedSwitch(switchRecord.id)).toEqual(
				ordinary.getAdvancedSwitch(switchRecord.id),
			);
			for (const cell of deriveAdvancedSwitchGeometry(switchRecord).claimedCells)
				expect(map.getAdvancedSwitchOwningCell(cell.x, cell.y)?.id).toBe(switchRecord.id);
		}
		expect(() => hydrate.addAdvancedSwitch(record(40, 80))).toThrow("already finished");
	});

	it("keeps failed inserts atomic and retains a valid unpublished stream", () => {
		const hydrate = TileMap.createHydrator();
		const first = record(4, 0);
		hydrate.addAdvancedSwitch(first);
		const conflict = record(100, -1);
		const firstClaims = new Set(
			deriveAdvancedSwitchGeometry(first).claimedCells.map((cell) => `${cell.x},${cell.y}`),
		);
		const conflictingClaims = deriveAdvancedSwitchGeometry(conflict).claimedCells;
		expect(
			conflictingClaims.findIndex((cell) => firstClaims.has(`${cell.x},${cell.y}`)),
		).toBeGreaterThan(0);
		expect(() => hydrate.addAdvancedSwitch(conflict)).toThrow("overlaps switch 4");
		expect(() => hydrate.addAdvancedSwitch(record(4, 80))).toThrow(
			"duplicate advanced switch id 4",
		);
		expect(() =>
			hydrate.addAdvancedSwitch({
				...record(50, 80),
				profileClass: "invalid",
			} as unknown as AdvancedSwitchRecord),
		).toThrow();
		expect(hydrate.advancedSwitchCount).toBe(1);
		const second = record(2, 40);
		hydrate.addAdvancedSwitch(second);
		for (const switchRecord of [first, second])
			for (const cell of deriveAdvancedSwitchGeometry(switchRecord).cellStates)
				hydrate.addEncodedCell(cell.x, cell.y, cell.encoded);
		const map = hydrate.finish(7, 5);
		expect(map.advancedSwitchCount).toBe(2);
		expect(map.getAdvancedSwitchIdCursor()).toBe(5);
		expect(map.getMutationGeneration()).toBe(map.size + 3);
		expect(map.getAdvancedSwitch(100)).toBeUndefined();
		expect(map.getAdvancedSwitch(50)).toBeUndefined();
		for (const cell of conflictingClaims)
			if (!firstClaims.has(`${cell.x},${cell.y}`))
				expect(map.getAdvancedSwitchOwningCell(cell.x, cell.y)).toBeUndefined();
	});

	it("retains an exhausted allocator after a maximum-ID sidecar", () => {
		const hydrate = TileMap.createHydrator();
		hydrate.addAdvancedSwitch(record(ADVANCED_SWITCH_MAX_ID, 0));
		expect(() => hydrate.addAdvancedSwitch(record(ADVANCED_SWITCH_MAX_ID + 1, 40))).toThrow();
		const map = hydrate.finish(1);
		expect(map.getAdvancedSwitchIdCursor()).toBe(ADVANCED_SWITCH_MAX_ID + 1);
		expect(map.getNextAdvancedSwitchId()).toBeNull();
		expect(map.advancedSwitchCount).toBe(1);
		expect(map.getMutationGeneration()).toBe(2);
	});

	it("owns an immutable copy of each caller record before publication", () => {
		const hydrate = TileMap.createHydrator();
		const source = { ...record(1, 0), origin: { x: 0, y: 0 } };
		hydrate.addAdvancedSwitch(source);
		source.origin.x = 999;
		const map = hydrate.finish(1);
		const adopted = map.getAdvancedSwitch(1);
		expect(adopted?.origin).toEqual({ x: 0, y: 0 });
		expect(Object.isFrozen(adopted)).toBe(true);
		expect(Object.isFrozen(adopted?.origin)).toBe(true);
		expect(map.getAdvancedSwitchIdCursor()).toBe(2);
		expect(map.getMutationGeneration()).toBe(2);
	});
});

function record(id: number, x: number): AdvancedSwitchRecord {
	return { id, profileClass: "B", origin: { x, y: 0 }, forward: 2, lateral: 4, movementMask: 15 };
}
