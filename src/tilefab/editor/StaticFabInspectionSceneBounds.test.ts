import { describe, expect, it } from "vitest";
import {
	staticFabInspectionCombinedBounds,
	staticFabInspectionEquipmentBodyCenterY,
	staticFabInspectionEquipmentBodyHeight,
	staticFabInspectionEquipmentOpeningCenterY,
	staticFabInspectionEquipmentPickHeight,
} from "./StaticFabInspectionSceneBounds";

describe("StaticFabInspectionSceneBounds", () => {
	it("includes equipment sections and ports that extend beyond rail bounds", () => {
		const bounds = staticFabInspectionCombinedBounds(
			{ minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 0.2, maxZ: 10 },
			3.2,
			{
				count: 1,
				worldPositions: Float32Array.of(26, -7),
				groupKinds: Uint8Array.of(2),
				bodySectionCount: 1,
				bodySectionGroupRows: Uint32Array.of(0),
				bodySectionBounds: Float32Array.of(20, -5, 24, -2),
			},
		);
		expect(bounds).toEqual({
			minX: 0,
			minY: 0,
			minZ: -7.15,
			maxX: 26.15,
			maxY: 3.25,
			maxZ: 10,
		});
	});

	it("shares one equipment-height contract between rendering, framing, and picking", () => {
		expect(staticFabInspectionEquipmentBodyHeight(0)).toBe(0.42);
		expect(staticFabInspectionEquipmentBodyCenterY(0, 3.2)).toBeCloseTo(2.68);
		expect(staticFabInspectionEquipmentBodyCenterY(1, 3.2)).toBe(1.15);
		expect(staticFabInspectionEquipmentOpeningCenterY(0, 3.2)).toBeCloseTo(2.68);
		expect(staticFabInspectionEquipmentOpeningCenterY(1, 3.2)).toBe(1.45);
		expect(staticFabInspectionEquipmentOpeningCenterY(2, 3.2)).toBe(2.05);
		expect(staticFabInspectionEquipmentPickHeight(2)).toBe(3.5);
		expect(() => staticFabInspectionEquipmentBodyHeight(3)).toThrow("out of range");
		expect(() => staticFabInspectionEquipmentOpeningCenterY(3, 3.2)).toThrow("out of range");
	});
});
