import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	comparePhysicalPathIdentity,
	PHYSICAL_PATH_IDENTITY_WIDTH,
	physicalPathIdentity,
	physicalPathIdentityField,
	physicalPathIdentityKey,
} from "./PhysicalPathIdentity";
import { compilePhysicalRail } from "./PhysicalRailCompiler";

describe("PhysicalPathIdentity", () => {
	it("keeps the existing 14-field diagnostic identity ordering-independent", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -2, y: 4 }, { x: 4, y: 4 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;

		for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
			const identity = physicalPathIdentity(paths, pathIndex);
			expect(identity).toHaveLength(PHYSICAL_PATH_IDENTITY_WIDTH);
			expect(physicalPathIdentityKey(paths, pathIndex).split(":")).toHaveLength(
				PHYSICAL_PATH_IDENTITY_WIDTH,
			);
			expect(comparePhysicalPathIdentity(paths, pathIndex, pathIndex)).toBe(0);
		}
	});

	it("sorts by authored identity instead of compiled array position", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 8, y: -3 }, { x: 14, y: -3 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const indices = Array.from({ length: paths.pathCount }, (_, index) => index).reverse();
		indices.sort((left, right) => comparePhysicalPathIdentity(paths, left, right));

		for (let index = 1; index < indices.length; index++) {
			expect(
				comparePhysicalPathIdentity(paths, indices[index - 1] as number, indices[index] as number),
			).toBeLessThanOrEqual(0);
		}
	});

	it("rejects invalid path and field indices", () => {
		const emptyPaths = compilePhysicalRail(new RailDocument().map).paths;
		expect(() => physicalPathIdentity(emptyPaths, 0)).toThrow(/outside/);
		expect(() => comparePhysicalPathIdentity(emptyPaths, -1, 0)).toThrow(/outside/);

		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		expect(() => physicalPathIdentityField(paths, -1, 0)).toThrow(/outside/);
		expect(() => physicalPathIdentityField(paths, paths.pathCount, 0)).toThrow(/outside/);
		expect(() => physicalPathIdentityField(paths, 0, PHYSICAL_PATH_IDENTITY_WIDTH)).toThrow(
			/outside/,
		);
	});
});
