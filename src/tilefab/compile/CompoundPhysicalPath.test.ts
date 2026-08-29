import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	planRailModule,
	type RailModuleKind,
	type RailModuleSpan,
} from "../core/RailModulePlanner";
import { DIR_E, DIR_W } from "../core/railShape";
import { type Cell, encodeRailCell } from "../core/TileMap";
import {
	COMPOUND_CONTROL_ROLE,
	COMPOUND_GEOMETRY_KIND,
	COMPOUND_PROFILE_FIT,
	type CompiledPathIntervalRemap,
	detectCompoundPhysicalPathPatterns,
	PATH_INTERVAL_MAPPING_KIND,
	stitchDetectedCompoundPhysicalPaths,
} from "./CompoundPhysicalPath";
import { compilePhysicalPaths, PATH_KIND, samplePhysicalPath } from "./PhysicalPathCompiler";
import { buildPhysicalPathAdjacency } from "./PhysicalPathFlow";

describe("CompoundPhysicalPath", () => {
	it("stitches adjacent U-turn curves into one metric CCW path", () => {
		const document = buildModule("u-turn", "compact");
		const raw = compilePhysicalPaths(document.map);
		const patterns = detectCompoundPhysicalPathPatterns(raw);
		const result = stitchDetectedCompoundPhysicalPaths(raw);

		expect(patterns.map((pattern) => pattern.type)).toEqual(["CCW_CURVE"]);
		expect(result.mergedPathCount).toBe(1);
		expect(result.paths.pathCount).toBe(raw.pathCount - 1);
		const compound = pathOfKind(result.paths.kinds, PATH_KIND.COMPOUND_CCW);
		expect(pathCell(result.paths.cells, compound)).toEqual({ x: 1, y: 0 });
		expect(pathCell(result.paths.exitCells, compound)).toEqual({ x: 1, y: 1 });
		expect(result.paths.lengths[compound]).toBeCloseTo(1 + Math.PI / 2, 6);
		expect(pathCoverage(result.paths, compound)).toEqual([
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 0 },
			{ x: 0, y: 1 },
		]);
		expect(result.paths.totalRouteLengthMeters).toBeCloseTo(raw.totalRouteLengthMeters, 6);
		expect(result.profiles.count).toBe(1);
		expect(result.profiles.fitKinds[0]).toBe(COMPOUND_PROFILE_FIT.MAP_EXACT);
		expect(result.profiles.compiledRadiusMillimeters[0]).toBe(500);
		expect(result.profiles.compiledLeadInMillimeters[0]).toBe(500);
		expect(result.profiles.compiledLeadOutMillimeters[0]).toBe(500);
		expect([...result.profiles.controlOffsets]).toEqual([0, 4]);
		expect([...result.profiles.controlRoles]).toEqual([
			COMPOUND_CONTROL_ROLE.START,
			COMPOUND_CONTROL_ROLE.TMP_FROM,
			COMPOUND_CONTROL_ROLE.TMP_TO,
			COMPOUND_CONTROL_ROLE.END,
		]);
		expect([...result.profiles.memberOffsets]).toEqual([0, 2]);
		expect(result.profiles.nominalProfileIndices[0]).toBe(0);
		expect(result.profiles.compiledLengthMillimeters[0]).toBe(2_571);
		expect([...result.profiles.controlDistances]).toEqual([
			0,
			expect.closeTo(0.5, 6),
			expect.closeTo(0.5 + Math.PI / 2, 6),
			expect.closeTo(1 + Math.PI / 2, 6),
		]);
		expectCompleteRemap(raw, result.intervalRemap);
	});

	it("stitches a wide shift and links adjacency from its explicit exit cell", () => {
		const document = buildModule("shift", "wide");
		const raw = compilePhysicalPaths(document.map);
		const result = stitchDetectedCompoundPhysicalPaths(raw);
		const paths = result.paths;
		const compound = pathOfKind(paths.kinds, PATH_KIND.COMPOUND_CSC_HETE);
		const startPath = findPathAt(paths.cells, { x: 0, y: 0 });
		const endPath = findPathAt(paths.cells, { x: 2, y: 2 });

		expect(result.mergedPathCount).toBe(1);
		expect(paths.pathCount).toBe(raw.pathCount - 2);
		expect(pathCell(paths.cells, compound)).toEqual({ x: 1, y: 0 });
		expect(pathCell(paths.exitCells, compound)).toEqual({ x: 1, y: 2 });
		expect(paths.lengths[compound]).toBeCloseTo(2 + Math.PI / 2, 6);
		expect(pathCoverage(paths, compound)).toEqual([
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 1, y: 2 },
			{ x: 0, y: 0 },
			{ x: 2, y: 2 },
		]);
		expect(result.profiles.fitKinds[0]).toBe(COMPOUND_PROFILE_FIT.MAP_EXACT);
		expect(result.profiles.compiledLeadInMillimeters[0]).toBe(500);
		expect(result.profiles.compiledLeadOutMillimeters[0]).toBe(500);
		expect(result.profiles.compiledMiddleMillimeters[0]).toBe(1_000);
		expect(result.profiles.nominalProfileIndices[0]).toBe(3);
		expect(result.profiles.compiledLengthMillimeters[0]).toBe(3_571);

		const adjacency = buildPhysicalPathAdjacency(paths);
		const incomingTargets = [
			...adjacency.targets.slice(
				adjacency.offsets[startPath] as number,
				adjacency.offsets[startPath + 1] as number,
			),
		];
		const targets = [
			...adjacency.targets.slice(
				adjacency.offsets[compound] as number,
				adjacency.offsets[compound + 1] as number,
			),
		];
		expect(incomingTargets).toEqual([compound]);
		expect(targets).toEqual([endPath]);
		expectCompleteRemap(raw, result.intervalRemap);
	});

	it("keeps source indices remapped and samples continuously across a stitched seam", () => {
		const document = buildModule("shift", "compact");
		const raw = compilePhysicalPaths(document.map);
		const memberIndices = [
			findPathAt(raw.cells, { x: 1, y: 0 }),
			findPathAt(raw.cells, { x: 1, y: 1 }),
		];
		const result = stitchDetectedCompoundPhysicalPaths(raw);
		const compound = pathOfKind(result.paths.kinds, PATH_KIND.COMPOUND_S);

		expect(memberIndices.map((index) => result.primaryTargetPathIndices[index])).toEqual([
			compound,
			compound,
		]);
		expect(result.profiles.compiledRadiusMillimeters[0]).toBe(500);
		expect(result.profiles.compiledTurnAngleTenths[0]).toBe(900);
		expect(result.profiles.fitKinds[0]).toBe(COMPOUND_PROFILE_FIT.MAP_EXACT);
		expect(result.profiles.forwardFitDeltaMillimeters[0]).toBe(0);
		expect(result.profiles.lateralFitDeltaMillimeters[0]).toBe(0);
		const firstArcEnd =
			(result.profiles.compiledLeadInMillimeters[0] as number) / 1_000 + 0.5 * (Math.PI / 2);
		const before = samplePhysicalPath(result.paths, compound, firstArcEnd - 0.0001);
		const after = samplePhysicalPath(result.paths, compound, firstArcEnd + 0.0001);
		expect(
			Math.hypot((after?.x ?? 0) - (before?.x ?? 0), (after?.y ?? 0) - (before?.y ?? 0)),
		).toBeLessThan(0.0003);
		expect(Math.hypot(after?.tangentX ?? 0, after?.tangentY ?? 0)).toBeCloseTo(1, 6);
		for (const member of memberIndices) {
			const remapIndex = remapRowsForSource(result.intervalRemap, member)[0] as number;
			expect(result.intervalRemap.targetPathIndices[remapIndex]).toBe(compound);
			expect(result.intervalRemap.mappingKinds[remapIndex]).toBe(
				PATH_INTERVAL_MAPPING_KIND.MONOTONIC_PROJECTION,
			);
		}
		expectCompleteRemap(raw, result.intervalRemap);
	});

	it("keeps a turnout support path intact and marks the compound as baseline", () => {
		const document = buildModule("shift", "compact");
		const branch = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: -3 });
		expect(branch.valid, branch.reason).toBe(true);
		expect(document.commit(branch)).toBe(true);
		const raw = compilePhysicalPaths(document.map);
		const result = stitchDetectedCompoundPhysicalPaths(raw);
		const compound = pathOfKind(result.paths.kinds, PATH_KIND.COMPOUND_S);
		const trunk = pathOfKind(raw.kinds, PATH_KIND.TURNOUT_TRUNK);
		const remappedTrunk = result.primaryTargetPathIndices[trunk] as number;

		expect(result.profiles.geometryKinds[0]).toBe(COMPOUND_GEOMETRY_KIND.BASELINE_STITCHED);
		expect(result.profiles.fitKinds[0]).toBe(COMPOUND_PROFILE_FIT.NOT_APPLICABLE);
		expect(result.profiles.nominalProfileIndices[0]).toBe(-1);
		expect(result.profiles.fitReasonMasks[0]).toBe(0);
		expect(result.profiles.compiledRadiusMillimeters[0]).toBe(0);
		expect(result.paths.lengths[compound]).toBeCloseTo(Math.PI / 2, 6);
		expect(result.paths.lengths[remappedTrunk]).toBeCloseTo(raw.lengths[trunk] as number, 6);
		expect(pathCoverage(result.paths, compound)).toEqual([
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		]);
	});

	it("splits one shared support path across two adjacent compound profiles", () => {
		const document = buildModule("shift", "compact");
		const second = planRailModule(document.map, { x: 2, y: 1 }, { x: 2, y: 4 }, "shift", "compact");
		expect(second.valid, second.reason).toBe(true);
		expect(document.commit(second)).toBe(true);
		const raw = compilePhysicalPaths(document.map);
		const sharedSource = findPathAt(raw.cells, { x: 2, y: 1 });
		const result = stitchDetectedCompoundPhysicalPaths(raw);
		const retainedTarget = result.primaryTargetPathIndices[sharedSource] as number;
		const remapIndices = remapRowsForSource(result.intervalRemap, sharedSource);

		expect(result.profiles.count).toBe(2);
		expect(result.paths.lengths[retainedTarget]).toBe(0);
		expect(remapIndices).toHaveLength(2);
		expect(
			remapIndices.map((index) => [
				result.intervalRemap.sourceStarts[index],
				result.intervalRemap.sourceEnds[index],
			]),
		).toEqual([
			[0, 0.5],
			[0.5, 1],
		]);
		expect(
			remapIndices
				.map((index) => result.intervalRemap.targetPathIndices[index] as number)
				.filter((pathIndex) => pathIndex !== retainedTarget)
				.map((pathIndex) => result.paths.kinds[pathIndex]),
		).toEqual([PATH_KIND.COMPOUND_S, PATH_KIND.COMPOUND_S]);
		const adjacency = buildPhysicalPathAdjacency(result.paths);
		const firstCompound = result.profiles.pathIndices[0] as number;
		const secondCompound = result.profiles.pathIndices[1] as number;
		expect(adjacencyTargets(adjacency, firstCompound)).toEqual([retainedTarget]);
		expect(adjacencyTargets(adjacency, retainedTarget)).toEqual([secondCompound]);
		expectCompleteRemap(raw, result.intervalRemap);
	});

	it("returns the original typed buffers when no compound pattern exists", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: -2, y: 0 }, { x: 2, y: 0 }));
		const raw = compilePhysicalPaths(document.map);
		const result = stitchDetectedCompoundPhysicalPaths(raw);

		expect(result.paths).toBe(raw);
		expect(result.profiles.count).toBe(0);
		expect(result.mergedPathCount).toBe(0);
		expect([...result.primaryTargetPathIndices]).toEqual(
			Array.from({ length: raw.pathCount }, (_, index) => index),
		);
		expect(result.intervalRemap.count).toBe(raw.pathCount);
		expect([...result.intervalRemap.sourcePathOffsets]).toEqual(
			Array.from({ length: raw.pathCount + 1 }, (_, index) => index),
		);
	});

	it("refuses to stitch a compound whose source seam is discontinuous", () => {
		const document = buildModule("shift", "compact");
		const raw = compilePhysicalPaths(document.map);
		const secondMember = findPathAt(raw.cells, { x: 1, y: 1 });
		const positions = raw.positions.slice();
		positions[(raw.offsets[secondMember] as number) * 2] += 0.1;
		const malformed = { ...raw, positions };

		const result = stitchDetectedCompoundPhysicalPaths(malformed);

		expect(result.mergedPathCount).toBe(0);
		expect(result.paths).toBe(malformed);
		expect(result.profiles.count).toBe(0);
	});

	it("stitches one compound in a 10k unrelated-path layout within the compile budget", () => {
		const document = buildModule("u-turn", "compact");
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 10_000; index++) {
			document.map.setEncoded(100_000 + index, 100, straight);
		}
		const raw = compilePhysicalPaths(document.map);

		const startedAt = Date.now();
		const result = stitchDetectedCompoundPhysicalPaths(raw);
		const elapsedMilliseconds = Date.now() - startedAt;

		expect(result.mergedPathCount).toBe(1);
		expect(result.paths.pathCount).toBe(raw.pathCount - 1);
		expect(result.paths.totalRouteLengthMeters).toBeCloseTo(raw.totalRouteLengthMeters, 4);
		expect(elapsedMilliseconds).toBeLessThan(1_000);
	});
});

function buildModule(moduleKind: RailModuleKind, span: RailModuleSpan): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 }))).toBe(
		true,
	);
	const module = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, moduleKind, span);
	expect(module.valid, module.reason).toBe(true);
	expect(document.commit(module)).toBe(true);
	return document;
}

function pathOfKind(kinds: Uint8Array, kind: number): number {
	const index = kinds.indexOf(kind);
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}

function findPathAt(cells: Int32Array, cell: Cell): number {
	for (let pathIndex = 0; pathIndex < cells.length / 2; pathIndex++) {
		if (cells[pathIndex * 2] === cell.x && cells[pathIndex * 2 + 1] === cell.y) return pathIndex;
	}
	return -1;
}

function pathCell(cells: Int32Array, pathIndex: number): Cell {
	return { x: cells[pathIndex * 2] as number, y: cells[pathIndex * 2 + 1] as number };
}

function pathCoverage(paths: ReturnType<typeof compilePhysicalPaths>, pathIndex: number): Cell[] {
	const cells: Cell[] = [];
	const start = paths.coverageOffsets[pathIndex] as number;
	const end = paths.coverageOffsets[pathIndex + 1] as number;
	for (let index = start; index < end; index++) {
		cells.push({
			x: paths.coverageCells[index * 2] as number,
			y: paths.coverageCells[index * 2 + 1] as number,
		});
	}
	return cells;
}

function remapRowsForSource(remap: CompiledPathIntervalRemap, sourcePathIndex: number): number[] {
	const start = remap.sourcePathOffsets[sourcePathIndex] as number;
	const end = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
	return Array.from({ length: end - start }, (_, index) => start + index);
}

function adjacencyTargets(
	adjacency: ReturnType<typeof buildPhysicalPathAdjacency>,
	pathIndex: number,
): number[] {
	return [
		...adjacency.targets.slice(
			adjacency.offsets[pathIndex] as number,
			adjacency.offsets[pathIndex + 1] as number,
		),
	];
}

function expectCompleteRemap(
	source: ReturnType<typeof compilePhysicalPaths>,
	remap: CompiledPathIntervalRemap,
): void {
	for (let sourcePathIndex = 0; sourcePathIndex < source.pathCount; sourcePathIndex++) {
		const rows = remapRowsForSource(remap, sourcePathIndex);
		expect(rows.length).toBeGreaterThan(0);
		let sourceStation = 0;
		for (const row of rows) {
			expect(remap.sourceStarts[row]).toBeCloseTo(sourceStation, 6);
			expect(remap.sourceEnds[row]).toBeGreaterThan(remap.sourceStarts[row] as number);
			expect(remap.targetEnds[row]).toBeGreaterThanOrEqual(remap.targetStarts[row] as number);
			expect(remap.mappingKinds[row]).not.toBe(PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE);
			expect(Number.isFinite(remap.projectionErrors[row])).toBe(true);
			sourceStation = remap.sourceEnds[row] as number;
		}
		expect(sourceStation).toBeCloseTo(source.lengths[sourcePathIndex] as number, 6);
	}
}
