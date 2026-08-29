import { describe, expect, it } from "vitest";
import { PORT_RECORD_MAX_ID } from "./PortRecord";
import { allocatePortEquipmentRecordIds } from "./PortEquipmentIdAllocator";

describe("PortEquipmentIdAllocator", () => {
	it("allocates deterministic contiguous IDs without mutating cursor input", () => {
		const cursor = Object.freeze({ nextPortId: 41, nextEquipmentGroupId: 7 });
		expect(allocatePortEquipmentRecordIds(cursor, 3, 2)).toEqual({
			portIds: [41, 42, 43],
			equipmentGroupIds: [7, 8],
		});
		expect(cursor).toEqual({ nextPortId: 41, nextEquipmentGroupId: 7 });
	});

	it("accepts an exhausted cursor only for an empty allocation", () => {
		const exhausted = {
			nextPortId: PORT_RECORD_MAX_ID + 1,
			nextEquipmentGroupId: PORT_RECORD_MAX_ID + 1,
		};
		expect(allocatePortEquipmentRecordIds(exhausted, 0, 0)).toEqual({
			portIds: [],
			equipmentGroupIds: [],
		});
		expect(() => allocatePortEquipmentRecordIds(exhausted, 1, 0)).toThrow(/port IDs remain/);
		expect(() => allocatePortEquipmentRecordIds(exhausted, 0, 1)).toThrow(
			/equipment group IDs remain/,
		);
	});
});
