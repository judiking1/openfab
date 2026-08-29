import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { resolveReadinessPathIdentityIndex } from "./ReadinessPathIdentityIndex";

describe("ReadinessPathIdentityIndex", () => {
	it("lazily compiles once per physical path generation and reuses prepared artifacts", () => {
		const first = physicalPaths(4);
		const firstBinding = resolveReadinessPathIdentityIndex(first, null, null, true);
		expect(firstBinding?.snapshot.values.length).toBe(first.pathCount);
		expect(resolveReadinessPathIdentityIndex(first, null, firstBinding, true)).toBe(firstBinding);

		const second = physicalPaths(6);
		expect(resolveReadinessPathIdentityIndex(second, null, firstBinding, false)).toBeNull();
		const secondBinding = resolveReadinessPathIdentityIndex(second, null, firstBinding, true);
		expect(secondBinding).not.toBe(firstBinding);
		expect(secondBinding?.paths).toBe(second);

		const prepared = secondBinding?.snapshot ?? null;
		expect(resolveReadinessPathIdentityIndex(second, prepared, null, false)?.snapshot).toBe(
			prepared,
		);
	});
});

function physicalPaths(length: number) {
	const document = new RailDocument();
	expect(
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: length, y: 0 })),
	).toBe(true);
	return compilePhysicalRail(document.map).paths;
}
