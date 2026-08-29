import { describe, expect, it } from "vitest";
import { planRailConstruction, planRailErase } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { planRailModule } from "../core/RailModulePlanner";
import { DIR_E, DIR_W } from "../core/railShape";
import { type Cell, encodeRailCell, TileMap } from "../core/TileMap";
import { PATH_KIND } from "./PhysicalPathCompiler";
import {
	compilePhysicalPathMigration,
	decodeRawCellRouteKey,
	NO_MIGRATION_TARGET_PATH,
	PHYSICAL_PATH_MIGRATION_KIND,
	rawCellRouteKey,
	validatePhysicalPathMigration,
} from "./PhysicalPathMigration";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";

describe("PhysicalPathMigration", () => {
	it("maps an unchanged layout exactly across logical revisions", () => {
		const document = buildWestboundLine();
		const previous = compilePhysicalRail(document.map, 100);
		const next = compilePhysicalRail(document.map, 200);
		const migration = compilePhysicalPathMigration(previous, next);

		expect(migration.fromRevision).toBe(100);
		expect(migration.toRevision).toBe(200);
		expect(migration.sourcePathCount).toBe(previous.paths.pathCount);
		expect(migration.matchedRawPathCount).toBe(previous.pathIntervalRemap.sourcePathCount);
		expect(migration.unmappableLengthMeters).toBeCloseTo(0, 6);
		expect(migration.unmappableSourcePathCount).toBe(0);
		expect([...migration.mappingKinds]).toEqual(
			Array.from({ length: migration.count }, () => PHYSICAL_PATH_MIGRATION_KIND.IDENTITY),
		);
		expect(migration.mappedLengthMeters).toBeCloseTo(previous.paths.totalRouteLengthMeters, 6);
	});

	it("keeps a stable route mapped when earlier cells shift every path index", () => {
		const document = buildWestboundLine();
		const previous = compilePhysicalRail(document.map);
		const previousPath = findPathAt(previous, { x: 2, y: 0 });
		const extension = planRailConstruction(document.map, { x: 0, y: 0 }, { x: -4, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		expect(document.commit(extension)).toBe(true);
		const next = compilePhysicalRail(document.map);
		const nextPath = findPathAt(next, { x: 2, y: 0 });
		const migration = compilePhysicalPathMigration(previous, next);
		const rows = rowsForPath(migration.sourcePathOffsets, previousPath);

		expect(nextPath).not.toBe(previousPath);
		expect(rows).toHaveLength(1);
		expect(migration.targetPathIndices[rows[0] as number]).toBe(nextPath);
		expect(migration.mappingKinds[rows[0] as number]).toBe(PHYSICAL_PATH_MIGRATION_KIND.IDENTITY);
	});

	it("maps a stitched compound after unrelated upstream insertion", () => {
		const document = buildCompactShift();
		const previous = compilePhysicalRail(document.map);
		const previousCompound = findPathOfKind(previous, PATH_KIND.COMPOUND_S);
		const extension = planRailConstruction(document.map, { x: -8, y: 0 }, { x: -4, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		expect(document.commit(extension)).toBe(true);
		const next = compilePhysicalRail(document.map);
		const nextCompound = findPathOfKind(next, PATH_KIND.COMPOUND_S);
		const migration = compilePhysicalPathMigration(previous, next);
		const rows = rowsForPath(migration.sourcePathOffsets, previousCompound);

		expect(nextCompound).not.toBe(previousCompound);
		expect(rows.length).toBeGreaterThan(0);
		expect(migration.sourceStarts[rows[0] as number]).toBeCloseTo(0, 6);
		expect(migration.sourceEnds[rows.at(-1) as number]).toBeCloseTo(
			previous.paths.lengths[previousCompound] as number,
			5,
		);
		expect(
			rows.every(
				(row) =>
					migration.targetPathIndices[row] === nextCompound &&
					migration.mappingKinds[row] !== PHYSICAL_PATH_MIGRATION_KIND.DELETED &&
					migration.mappingKinds[row] !== PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE,
			),
		).toBe(true);
	});

	it("emits an explicit unmappable interval for a deleted route", () => {
		const document = buildWestboundLine();
		const previous = compilePhysicalRail(document.map);
		const deletedPath = findPathAt(previous, { x: 2, y: 0 });
		const erase = planRailErase(document.map, [{ x: 2, y: 0 }]);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		const next = compilePhysicalRail(document.map);
		const migration = compilePhysicalPathMigration(previous, next);
		const rows = rowsForPath(migration.sourcePathOffsets, deletedPath);

		expect(rows).toHaveLength(1);
		expect(migration.mappingKinds[rows[0] as number]).toBe(PHYSICAL_PATH_MIGRATION_KIND.DELETED);
		expect(migration.targetPathIndices[rows[0] as number]).toBe(NO_MIGRATION_TARGET_PATH);
		expect(migration.sourceStarts[rows[0] as number]).toBeCloseTo(0, 6);
		expect(migration.sourceEnds[rows[0] as number]).toBeCloseTo(
			previous.paths.lengths[deletedPath] as number,
			6,
		);
	});

	it("partitions a partially deleted compound into mapped and unmappable intervals", () => {
		const document = buildCompactShift();
		const previous = compilePhysicalRail(document.map);
		const previousCompound = findPathOfKind(previous, PATH_KIND.COMPOUND_S);
		const memberSourcePath = previous.compoundProfiles.memberPathIndices[0] as number;
		const memberOffset = memberSourcePath * 2;
		const nextMap = document.map.clone();
		nextMap.setEncoded(
			previous.pathIntervalRemap.sourcePathCells[memberOffset] as number,
			previous.pathIntervalRemap.sourcePathCells[memberOffset + 1] as number,
			0,
		);
		const next = compilePhysicalRail(nextMap);
		const migration = compilePhysicalPathMigration(previous, next);
		const rows = rowsForPath(migration.sourcePathOffsets, previousCompound);

		expect(findPathOfKind(next, PATH_KIND.COMPOUND_S)).toBe(-1);
		expect(
			rows.some((row) => migration.mappingKinds[row] === PHYSICAL_PATH_MIGRATION_KIND.DELETED),
		).toBe(true);
		expect(
			rows.some(
				(row) =>
					migration.mappingKinds[row] !== PHYSICAL_PATH_MIGRATION_KIND.DELETED &&
					migration.mappingKinds[row] !== PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE,
			),
		).toBe(true);
		expect(migration.sourceStarts[rows[0] as number]).toBeCloseTo(0, 6);
		expect(migration.sourceEnds[rows.at(-1) as number]).toBeCloseTo(
			previous.paths.lengths[previousCompound] as number,
			5,
		);
	});

	it("preserves canonical station when a linear route becomes turnout trunk", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const previous = compilePhysicalRail(document.map, 100);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 2 })),
		).toBe(true);
		const next = compilePhysicalRail(document.map, 200);
		const migration = compilePhysicalPathMigration(previous, next);

		const trimmedSupport = findPathAt(previous, { x: 2, y: 0 });
		const supportRows = rowsForPath(migration.sourcePathOffsets, trimmedSupport);
		expect(supportRows).toHaveLength(2);
		expect(migration.mappingKinds[supportRows[0] as number]).toBe(
			PHYSICAL_PATH_MIGRATION_KIND.IDENTITY,
		);
		expect(migration.sourceEnds[supportRows[0] as number]).toBeCloseTo(0.6, 5);
		expect(migration.mappingKinds[supportRows[1] as number]).toBe(
			PHYSICAL_PATH_MIGRATION_KIND.DELETED,
		);
		expect(migration.sourceStarts[supportRows[1] as number]).toBeCloseTo(0.6, 5);

		const previousJunctionRoute = findPathAt(previous, { x: 3, y: 0 });
		const junctionRows = rowsForPath(migration.sourcePathOffsets, previousJunctionRoute);
		expect(junctionRows).toHaveLength(1);
		const junctionRow = junctionRows[0] as number;
		expect(migration.mappingKinds[junctionRow]).toBe(PHYSICAL_PATH_MIGRATION_KIND.TRANSLATION);
		expect(migration.targetStarts[junctionRow]).toBeCloseTo(0.4, 5);
		expect(migration.targetEnds[junctionRow]).toBeCloseTo(1.4, 5);
		expect(previous.pathIntervalRemap.sourcePathKinds[previousJunctionRoute]).toBe(
			PATH_KIND.LINEAR,
		);
		expect(next.pathIntervalRemap.sourcePathKinds[previousJunctionRoute]).toBe(
			PATH_KIND.TURNOUT_TRUNK,
		);
	});

	it("preserves the shared half-cell when a straight terminal expands and retracts", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const baseMap = document.map.clone();
		const terminalLayout = compilePhysicalRail(baseMap, 100);
		const previousTerminal = findPathAt(terminalLayout, { x: 4, y: 0 });
		expect(terminalLayout.paths.kinds[previousTerminal]).toBe(PATH_KIND.TERMINAL);
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const extendedLayout = compilePhysicalRail(document.map, 200);
		const expanded = compilePhysicalPathMigration(terminalLayout, extendedLayout);
		const expandedRows = rowsForPath(expanded.sourcePathOffsets, previousTerminal);

		expect(expandedRows).toHaveLength(1);
		expect(expanded.sourceStarts[expandedRows[0] as number]).toBeCloseTo(0, 6);
		expect(expanded.sourceEnds[expandedRows[0] as number]).toBeCloseTo(0.5, 6);
		expect(expanded.targetStarts[expandedRows[0] as number]).toBeCloseTo(0, 6);
		expect(expanded.targetEnds[expandedRows[0] as number]).toBeCloseTo(0.5, 6);
		expect(expanded.mappingKinds[expandedRows[0] as number]).toBe(
			PHYSICAL_PATH_MIGRATION_KIND.IDENTITY,
		);

		const restoredLayout = compilePhysicalRail(baseMap, 300);
		const previousFullPath = findPathAt(extendedLayout, { x: 4, y: 0 });
		const retracted = compilePhysicalPathMigration(extendedLayout, restoredLayout);
		const retractedRows = rowsForPath(retracted.sourcePathOffsets, previousFullPath);
		expect(retractedRows).toHaveLength(2);
		expect(retracted.sourceStarts[retractedRows[0] as number]).toBeCloseTo(0, 6);
		expect(retracted.sourceEnds[retractedRows[0] as number]).toBeCloseTo(0.5, 6);
		expect(retracted.targetPathIndices[retractedRows[0] as number]).not.toBe(
			NO_MIGRATION_TARGET_PATH,
		);
		expect(retracted.mappingKinds[retractedRows[1] as number]).toBe(
			PHYSICAL_PATH_MIGRATION_KIND.DELETED,
		);
		expect(retracted.sourceStarts[retractedRows[1] as number]).toBeCloseTo(0.5, 6);
		expect(retracted.sourceEnds[retractedRows[1] as number]).toBeCloseTo(1, 6);
	});

	it("encodes signed-int32 raw route identities without collisions", () => {
		const cases = [
			{ x: -0x80000000, y: -0x80000000, from: DIR_W, to: DIR_E },
			{ x: 0x7fffffff, y: 0x7fffffff, from: DIR_E, to: DIR_W },
			{ x: -1, y: 0, from: DIR_W, to: DIR_E },
			{ x: 0, y: -1, from: DIR_W, to: DIR_E },
		] as const;
		const keys = cases.map(({ x, y, from, to }) => rawCellRouteKey(x, y, from, to));
		expect(keys.every((key) => key !== null)).toBe(true);
		expect(new Set(keys).size).toBe(cases.length);
		for (let index = 0; index < cases.length; index++) {
			expect(decodeRawCellRouteKey(keys[index] as NonNullable<(typeof keys)[number]>)).toEqual(
				cases[index],
			);
		}
		expect(rawCellRouteKey(0, 0, 0, 0)).toBeNull();
		expect(() => rawCellRouteKey(0, 0, 3 as never, DIR_E)).toThrow("cardinal direction");
	});

	it("rejects malformed raw partitions and duplicate stable identities", () => {
		const document = buildWestboundLine();
		const previous = compilePhysicalRail(document.map, 10);
		const malformedPartition = compilePhysicalRail(document.map, 11);
		malformedPartition.pathIntervalRemap.sourceStarts[0] = 0.25;
		expect(() => compilePhysicalPathMigration(previous, malformedPartition)).toThrow(
			"malformed remap row",
		);

		const duplicateIdentity = compilePhysicalRail(document.map, 12);
		const remap = duplicateIdentity.pathIntervalRemap;
		remap.sourcePathCells[2] = remap.sourcePathCells[0] as number;
		remap.sourcePathCells[3] = remap.sourcePathCells[1] as number;
		remap.sourcePathFromDirections[1] = remap.sourcePathFromDirections[0] as number;
		remap.sourcePathToDirections[1] = remap.sourcePathToDirections[0] as number;
		expect(() => compilePhysicalPathMigration(previous, duplicateIdentity)).toThrow(
			"Duplicate stable raw path key",
		);

		const invalidTarget = compilePhysicalPathMigration(
			compilePhysicalRail(document.map, 13),
			compilePhysicalRail(document.map, 14),
		);
		invalidTarget.targetStarts[0] = -0.25;
		invalidTarget.targetEnds[0] = 0.75;
		expect(() => validatePhysicalPathMigration(invalidTarget)).toThrow("invalid target interval");

		const invalidIdentity = compilePhysicalPathMigration(
			compilePhysicalRail(document.map, 15),
			compilePhysicalRail(document.map, 16),
		);
		invalidIdentity.targetStarts[0] = 0.1;
		invalidIdentity.targetEnds[0] = 0.9;
		expect(() => validatePhysicalPathMigration(invalidIdentity)).toThrow(
			"identity mapping semantics",
		);

		const sourceLengthMismatch = compilePhysicalPathMigration(
			compilePhysicalRail(document.map, 17),
			compilePhysicalRail(document.map, 18),
		);
		const sourceLayout = compilePhysicalRail(document.map, 17);
		sourceLengthMismatch.sourcePathLengths[0] += 0.25;
		expect(() => validatePhysicalPathMigration(sourceLengthMismatch, sourceLayout)).toThrow(
			"length does not match its source layout",
		);

		const excessiveMatchedCount = compilePhysicalPathMigration(
			sourceLayout,
			compilePhysicalRail(document.map, 19),
		);
		excessiveMatchedCount.matchedRawPathCount = sourceLayout.pathIntervalRemap.sourcePathCount + 1;
		expect(() => validatePhysicalPathMigration(excessiveMatchedCount, sourceLayout)).toThrow(
			"matched raw path count exceeds",
		);
	});

	it("permits zero-length invalid paths without creating migration rows", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_E, outgoing: DIR_E }));
		const previous = compilePhysicalRail(map, 20);
		const next = compilePhysicalRail(map, 21);
		const migration = compilePhysicalPathMigration(previous, next);

		expect(previous.paths.pathCount).toBe(1);
		expect(previous.paths.lengths[0]).toBe(0);
		expect(migration.sourcePathCount).toBe(1);
		expect(migration.count).toBe(0);
		expect([...migration.sourcePathOffsets]).toEqual([0, 0]);
	});

	it("keeps 50,000 stable raw routes within the migration budget", () => {
		const map = new TileMap();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) map.setEncoded(index, 100, straight);
		const previous = compilePhysicalRail(map, 10_000);
		const nextMap = map.clone();
		nextMap.setEncoded(-100, -100, straight);
		const next = compilePhysicalRail(nextMap, 10_001);

		const startedAt = Date.now();
		const migration = compilePhysicalPathMigration(previous, next);
		const elapsedMilliseconds = Date.now() - startedAt;

		expect(migration.matchedRawPathCount).toBe(50_000);
		expect(migration.unmappableSourcePathCount).toBe(0);
		expect(migration.count).toBe(50_000);
		expect(elapsedMilliseconds).toBeLessThan(1_000);
	});
});

function buildWestboundLine(): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 4, y: 0 }, { x: 0, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function buildCompactShift(): RailDocument {
	const document = new RailDocument();
	const lead = planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 });
	expect(lead.valid, lead.reason).toBe(true);
	expect(document.commit(lead)).toBe(true);
	const shift = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact");
	expect(shift.valid, shift.reason).toBe(true);
	expect(document.commit(shift)).toBe(true);
	return document;
}

function findPathAt(layout: CompiledPhysicalLayout, cell: Cell): number {
	for (let pathIndex = 0; pathIndex < layout.paths.pathCount; pathIndex++) {
		const offset = pathIndex * 2;
		if (layout.paths.cells[offset] === cell.x && layout.paths.cells[offset + 1] === cell.y) {
			return pathIndex;
		}
	}
	return -1;
}

function findPathOfKind(layout: CompiledPhysicalLayout, kind: number): number {
	return layout.paths.kinds.indexOf(kind);
}

function rowsForPath(offsets: Uint32Array, pathIndex: number): number[] {
	return Array.from(
		{ length: (offsets[pathIndex + 1] as number) - (offsets[pathIndex] as number) },
		(_, index) => (offsets[pathIndex] as number) + index,
	);
}
