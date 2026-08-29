import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	PhysicalPathCellIndex,
	PhysicalPathIdentityIndex,
	PhysicalPathSwitchIndex,
} from "./PhysicalPathLookup";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { railClearancePathIdentity } from "./RailClearanceValidator";

describe("typed physical path lookup indexes", () => {
	it("resolve cell, switch, and identity candidates without JS Maps", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 }));
		document.commit(planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "A"));
		const paths = compilePhysicalRail(document.map).paths;
		const cells = PhysicalPathCellIndex.compile(paths);
		const switches = PhysicalPathSwitchIndex.compile(paths);
		const identities = PhysicalPathIdentityIndex.compile(paths);
		const switchRecord = [...Array(document.map.advancedSwitchCount)].map((_, index) =>
			document.map.getAdvancedSwitch(index + 1),
		)[0];
		if (!switchRecord) throw new Error("expected switch");

		expect([...((cells.get("0,0") ?? new Uint32Array()) as Uint32Array)].length).toBeGreaterThan(0);
		expect([...(switches.get(switchRecord.id) ?? [])]).toHaveLength(5);
		for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
			expect([...(identities.get(railClearancePathIdentity(paths, pathIndex)) ?? [])]).toContain(
				pathIndex,
			);
		}
	});

	it("rejects malformed CSR storage", () => {
		expect(
			() =>
				new PhysicalPathCellIndex({
					keyWidth: 2,
					keys: new Int32Array([0, 0]),
					offsets: new Uint32Array([0, 2]),
					values: new Uint32Array([0]),
				}),
		).toThrow("CSR offsets");
	});
});
