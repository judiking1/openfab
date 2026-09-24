import { describe, expect, it, vi } from "vitest";
import { PATH_SOURCE_IDENTITY_KIND } from "../compile/CompoundPhysicalPath";
import { compilePhysicalPaths, PATH_KIND } from "../compile/PhysicalPathCompiler";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { compileBasePortSlots } from "../compile/PortSlotCompiler";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { PORT_SLOT_MAX_ROWS } from "./PortSlotPolicy";
import {
	assertRailSourceCapacity,
	railSourceCapacityError,
	railSourceCounts,
} from "./RailSourceCapacity";
import { ALL_DIRECTIONS, oppositeDirection } from "./railShape";
import { TileMap } from "./TileMap";

describe("authored rail source capacity", () => {
	it("matches actual raw compiler contributions for all 256 encoded bytes", () => {
		for (let encoded = 0; encoded < 256; encoded++) {
			const map = new TileMap();
			map.setEncoded(0, 0, encoded);
			const paths = compilePhysicalPaths(map);
			expect(railSourceCounts(map), `encoded ${encoded}`).toEqual({
				sourcePaths: paths.pathCount,
				cardinalLinearSources: [...paths.kinds].filter((kind) => kind === PATH_KIND.LINEAR).length,
			});
			const layout = compilePhysicalRail(map);
			expect(railSourceCounts(map).sourcePaths).toBe(layout.pathIntervalRemap.sourcePathCount);
			expect(railSourceCounts(map).cardinalLinearSources * 2).toBe(
				compileBasePortSlots(layout).count,
			);
		}
	});
	it("retains suppressed source metadata and matches all 32 advanced switch profiles/poses", () => {
		let variants = 0;
		for (const profileClass of ADVANCED_SWITCH_PROFILE_CLASSES) {
			for (const forward of ALL_DIRECTIONS) {
				for (const lateral of ALL_DIRECTIONS) {
					if (lateral === forward || lateral === oppositeDirection(forward)) continue;
					const record: AdvancedSwitchRecord = {
						id: 1,
						profileClass,
						origin: { x: 0, y: 0 },
						forward,
						lateral,
						movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
					};
					const map = new TileMap();
					for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
						map.setEncoded(cell.x, cell.y, cell.encoded);
					}
					map.setAdvancedSwitch(record);
					const layout = compilePhysicalRail(map);
					expect(layout.valid).toBe(true);
					const remap = layout.pathIntervalRemap;
					let linear = 0;
					for (let row = 0; row < remap.sourcePathCount; row++) {
						if (
							remap.sourceIdentityKinds[row] === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
							remap.sourcePathKinds[row] === PATH_KIND.LINEAR &&
							remap.sourcePathFromDirections[row] !== 0 &&
							remap.sourcePathToDirections[row] !== 0
						)
							linear++;
					}
					expect(railSourceCounts(map)).toEqual({
						sourcePaths: remap.sourcePathCount,
						cardinalLinearSources: linear,
					});
					variants++;
				}
			}
		}
		expect(variants).toBe(32);
	});
	it("checks the exact row threshold from bounded deltas without scanning or cloning the map", () => {
		const map = new TileMap();
		for (let x = 0; x < PORT_SLOT_MAX_ROWS / 2; x++) map.setEncoded(x, 0, 0x28);
		vi.spyOn(map, "forEachRail").mockImplementation(() => {
			throw new Error("unexpected scan");
		});
		vi.spyOn(map, "clone").mockImplementation(() => {
			throw new Error("unexpected clone");
		});
		expect(() => assertRailSourceCapacity(map)).not.toThrow();
		const addition = { x: -1, y: 0, before: 0, after: 0x28 };
		expect(railSourceCapacityError(map, [addition])).toContain("204,098");
		expect(
			railSourceCapacityError(map, [addition, { x: 0, y: 0, before: 0x28, after: 0 }]),
		).toBeNull();
		// Classification changes can increase rows while reducing raw source count.
		map.setEncoded(0, 0, 0x68);
		expect(
			railSourceCapacityError(map, [addition, { x: 0, y: 0, before: 0x68, after: 0x28 }]),
		).toContain("204,098");
		expect(railSourceCapacityError(map, [{ ...addition, after: 256 }])).toContain("원본");
		expect(railSourceCapacityError(map, [addition, addition])).toContain("원본");
		expect(railSourceCapacityError(map, [{ ...addition, before: 0x28 }])).toContain("원본");
	});
	it("includes advanced switch additions, replacements and removals at the source boundary", () => {
		const map = new TileMap();
		for (let x = 0; x < PORT_SLOT_MAX_ROWS - 5; x++) map.setEncoded(x, 100, 0x20);
		const record: AdvancedSwitchRecord = {
			id: 1,
			profileClass: "A",
			origin: { x: 0, y: 0 },
			forward: 2,
			lateral: 4,
			movementMask: 15,
		};
		expect(railSourceCapacityError(map, [], [{ id: 1, before: null, after: record }])).toBeNull();
		map.setAdvancedSwitch(record);
		expect(() => assertRailSourceCapacity(map)).not.toThrow();
		const replacement = { ...record, profileClass: "B" as const };
		expect(
			railSourceCapacityError(map, [], [{ id: 1, before: record, after: replacement }]),
		).toBeNull();
		const addition = { x: -1, y: 100, before: 0, after: 0x20 };
		expect(railSourceCapacityError(map, [addition])).toContain("레일 계산 규모");
		expect(
			railSourceCapacityError(map, [addition], [{ id: 1, before: record, after: null }]),
		).toBeNull();
		expect(
			railSourceCapacityError(map, [], [{ id: 1, before: replacement, after: record }]),
		).toContain("원본");
		expect(railSourceCapacityError(map, [], [{ id: 2, before: record, after: null }])).toContain(
			"원본",
		);
		expect(
			railSourceCapacityError(
				map,
				[],
				[
					{ id: 1, before: record, after: null },
					{ id: 1, before: record, after: null },
				],
			),
		).toContain("원본");
	});
});
