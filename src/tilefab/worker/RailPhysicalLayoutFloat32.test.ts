import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { ALL_DIRECTIONS, DIR_E, DIR_S, oppositeDirection } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	validateRailPhysicalLayoutContract,
	validateRailPhysicalLayoutContractCooperatively,
} from "./RailPhysicalLayout";

describe("synthetic physical Float32 coordinates", () => {
	it.each([
		{ x: 260, y: 0 },
		{ x: -260, y: 0 },
		{ x: 0, y: 260 },
		{ x: 0, y: -260 },
		{ x: 4096, y: -4096 },
	])("accepts canonical switch samples away from the origin at $x,$y", async (origin) => {
		for (const profileClass of ADVANCED_SWITCH_PROFILE_CLASSES) {
			for (const forward of ALL_DIRECTIONS) {
				for (const lateral of ALL_DIRECTIONS) {
					if (lateral === forward || lateral === oppositeDirection(forward)) continue;
					const layout = switchLayout({
						id: 14,
						profileClass,
						origin,
						forward,
						lateral,
						movementMask: 15,
					});
					expect(() => validateRailPhysicalLayoutContract(layout)).not.toThrow();
					await expect(
						validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
					).resolves.toBeUndefined();
				}
			}
		}
	});

	it.each([0, 260])("rejects a one-Float32-step interior sample corruption at x=%s", async (x) => {
		const layout = switchLayout({
			id: 1,
			profileClass: "B",
			origin: { x, y: 0 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: 15,
		});
		const paths = layout.paths;
		const curvedPath = paths.offsets.findIndex(
			(start, index) => index < paths.pathCount && (paths.offsets[index + 1] as number) - start > 2,
		);
		expect(curvedPath).toBeGreaterThanOrEqual(0);
		const coordinate = ((paths.offsets[curvedPath] as number) + 1) * 2;
		const words = new Uint32Array(
			paths.positions.buffer,
			paths.positions.byteOffset,
			paths.positions.length,
		);
		const before = paths.positions[coordinate] as number;
		words[coordinate] = (words[coordinate] as number) + 1;
		expect(paths.positions[coordinate]).not.toBe(before);
		expect(() => validateRailPhysicalLayoutContract(layout)).toThrow(
			"Synthetic physical geometry samples differ",
		);
		await expect(
			validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
		).rejects.toThrow("Synthetic physical geometry samples differ");
	});

	it("rejects a one-Float32-step expansion of a distant synthetic bound", async () => {
		const layout = switchLayout({
			id: 1,
			profileClass: "B",
			origin: { x: 4096, y: 0 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: 15,
		});
		const bounds = layout.paths.bounds;
		const words = new Uint32Array(bounds.buffer, bounds.byteOffset, bounds.length);
		const before = bounds[2] as number;
		words[2] = (words[2] as number) + 1;
		expect(bounds[2]).toBeGreaterThan(before);
		expect(() => validateRailPhysicalLayoutContract(layout)).toThrow(
			"Synthetic physical bounds differ",
		);
		await expect(
			validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
		).rejects.toThrow("Synthetic physical bounds differ");
	});
});

function switchLayout(record: AdvancedSwitchRecord) {
	const map = new TileMap();
	for (const cell of deriveAdvancedSwitchGeometry(record).cellStates)
		map.setEncoded(cell.x, cell.y, cell.encoded);
	map.setAdvancedSwitch(record);
	return compilePhysicalRail(map);
}
