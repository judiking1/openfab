import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { planRailModule } from "../core/RailModulePlanner";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import { collectTurnoutFootprints } from "../core/turnout";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import {
	collectPhysicalModulePathCandidates,
	compilePhysicalModuleSelection,
	railRouteHintForPhysicalPath,
} from "./PhysicalPathSelection";
import { compilePhysicalRail } from "./PhysicalRailCompiler";

describe("PhysicalPathSelection", () => {
	it("derives only current-generation cardinal route hints for semantic 3D picking", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const pathIndex = [...paths.kinds].indexOf(PATH_KIND.LINEAR);
		expect(pathIndex).toBeGreaterThanOrEqual(0);
		expect(railRouteHintForPhysicalPath(paths, pathIndex)).toMatchObject({ role: "through" });
		expect(railRouteHintForPhysicalPath(paths, -1)).toBeUndefined();
		expect(railRouteHintForPhysicalPath(paths, paths.pathCount)).toBeUndefined();
	});

	it("partitions a long straight into exact five-meter physical module spans", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const modules = buildRailModuleOwnershipIndex(document.map).modules.filter(
			(module) => module.kind === "straight",
		);
		const selections = modules.map((module) => compilePhysicalModuleSelection(paths, module));
		const candidateSelections = modules.map((module) => compileIndexedSelection(paths, module));

		expect(modules.map((module) => module.construction.lengthMeters)).toEqual([5, 5, 3]);
		expect(selections.map((selection) => selection.totalLengthMeters)).toEqual([5, 5, 3]);
		expect(selections.every((selection) => selection.count > 0)).toBe(true);
		expect(candidateSelections.map((selection) => selection.totalLengthMeters)).toEqual([5, 5, 3]);
		for (let index = 0; index < selections.length; index++) {
			expectSelectionEquivalent(candidateSelections[index], selections[index]);
		}
		expect(
			selections.reduce((total, selection) => total + selection.totalLengthMeters, 0),
		).toBeCloseTo(paths.totalLengthMeters, 6);
	});

	it("selects only the curved physical route owned by a turnout module", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const footprint = collectTurnoutFootprints(document.map)[0];
		if (!footprint) throw new Error("expected turnout footprint");
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(
			(candidate) => candidate.kind === "turnout",
		);
		if (!module) throw new Error("expected turnout ownership");
		const paths = compilePhysicalRail(document.map).paths;
		const selection = compilePhysicalModuleSelection(paths, module);
		expectSelectionEquivalent(compileIndexedSelection(paths, module), selection);

		expect(selection.count).toBe(1);
		expect(paths.kinds[selection.pathIndices[0] as number]).toBe(PATH_KIND.TURNOUT_DIVERGE);
		expect(selection.startStations[0]).toBe(0);
		expect(selection.endStations[0]).toBeCloseTo(
			paths.lengths[selection.pathIndices[0] as number] as number,
		);
	});

	it.each([
		["u-turn", PATH_KIND.COMPOUND_CCW],
		["shift", PATH_KIND.COMPOUND_S],
	] as const)("maps a compact %s to its stitched compound path", (moduleKind, expectedKind) => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const plan = planRailModule(
			document.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 3 },
			moduleKind,
			"compact",
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(
			(candidate) => candidate.kind === moduleKind,
		);
		if (!module) throw new Error(`expected ${moduleKind} ownership`);
		const paths = compilePhysicalRail(document.map).paths;
		const selection = compilePhysicalModuleSelection(paths, module);
		expectSelectionEquivalent(compileIndexedSelection(paths, module), selection);

		expect(selection.count).toBe(1);
		expect(paths.kinds[selection.pathIndices[0] as number]).toBe(expectedKind);
		expect(selection.totalLengthMeters).toBeCloseTo(
			paths.lengths[selection.pathIndices[0] as number] as number,
		);
	});

	it("maps one advanced-switch ownership identity to all five synthetic paths", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 })),
		).toBe(true);
		const plan = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "A");
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(
			(candidate) => candidate.kind === "advanced-switch",
		);
		if (!module) throw new Error("expected switch ownership");
		const paths = compilePhysicalRail(document.map).paths;
		const selection = compilePhysicalModuleSelection(paths, module);
		expectSelectionEquivalent(compileIndexedSelection(paths, module), selection);

		expect(selection.count).toBe(5);
		expect(
			[...selection.pathIndices].every(
				(pathIndex) => (paths.advancedSwitchIds[pathIndex] as number) === module.advancedSwitchId,
			),
		).toBe(true);
	});

	it("maps every compound span, direction, and chirality to one stitched path", () => {
		const expectedKinds = {
			"u-turn:compact": PATH_KIND.COMPOUND_CCW,
			"u-turn:wide": PATH_KIND.COMPOUND_CSC_HOMO,
			"shift:compact": PATH_KIND.COMPOUND_S,
			"shift:wide": PATH_KIND.COMPOUND_CSC_HETE,
		} as const;
		for (const forward of ALL_DIRECTIONS) {
			for (const lateral of [leftOf(forward), oppositeDirection(leftOf(forward))]) {
				for (const [moduleKind, span] of [
					["u-turn", "compact"],
					["u-turn", "wide"],
					["shift", "compact"],
					["shift", "wide"],
				] as const) {
					const document = documentWithTerminal(forward);
					const plan = planRailModule(
						document.map,
						ORIGIN,
						moveRepeated(ORIGIN, lateral, 3),
						moduleKind,
						span,
					);
					expect(plan.valid, `${forward}/${lateral}/${moduleKind}/${span}: ${plan.reason}`).toBe(
						true,
					);
					expect(document.commit(plan)).toBe(true);
					const module = buildRailModuleOwnershipIndex(document.map).modules.find(
						(candidate) => candidate.kind === moduleKind && candidate.construction.span === span,
					);
					if (!module) throw new Error(`expected ${moduleKind}/${span}`);
					const paths = compilePhysicalRail(document.map).paths;
					const selection = compilePhysicalModuleSelection(paths, module);
					expectSelectionEquivalent(compileIndexedSelection(paths, module), selection);
					expect(selection.count).toBe(1);
					expect(paths.kinds[selection.pathIndices[0] as number]).toBe(
						expectedKinds[`${moduleKind}:${span}`],
					);
				}
			}
		}
	});

	it("keeps branch and merge ownership on the diverging path in all rotations and sides", () => {
		for (const forward of [
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: -1, y: 0 },
			{ x: 0, y: -1 },
		] as const) {
			for (const sideSign of [-1, 1] as const) {
				const side = { x: -forward.y * sideSign, y: forward.x * sideSign };
				for (const kind of ["branch", "merge"] as const) {
					const document = new RailDocument();
					expect(
						document.commit(
							planRailConstruction(
								document.map,
								{ x: -forward.x * 3, y: -forward.y * 3 },
								{ x: forward.x * 3, y: forward.y * 3 },
							),
						),
					).toBe(true);
					const origin = { x: 0, y: 0 };
					const sideEnd = { x: side.x * 3, y: side.y * 3 };
					const plan =
						kind === "branch"
							? planRailConstruction(document.map, origin, sideEnd)
							: planRailConstruction(document.map, sideEnd, origin);
					expect(plan.valid, plan.reason).toBe(true);
					expect(document.commit(plan)).toBe(true);
					const ownership = buildRailModuleOwnershipIndex(document.map);
					const module = ownership.modules.find((candidate) => candidate.kind === "turnout");
					if (!module) throw new Error(`expected ${kind} turnout`);
					const paths = compilePhysicalRail(document.map).paths;
					const selection = compilePhysicalModuleSelection(paths, module);
					expectSelectionEquivalent(compileIndexedSelection(paths, module), selection);
					expect(selection.count).toBe(1);
					expect(paths.kinds[selection.pathIndices[0] as number]).toBe(PATH_KIND.TURNOUT_DIVERGE);
					for (const straight of ownership.modules.filter(
						(candidate) => candidate.kind === "straight",
					)) {
						const straightSelection = compilePhysicalModuleSelection(paths, straight);
						expectSelectionEquivalent(compileIndexedSelection(paths, straight), straightSelection);
						expect(
							[...straightSelection.pathIndices].every(
								(pathIndex) => (paths.kinds[pathIndex] as number) !== PATH_KIND.TURNOUT_DIVERGE,
							),
							`${kind}/${forward.x},${forward.y}/${sideSign}/${straight.key}`,
						).toBe(true);
						expect(
							straightSelection.totalLengthMeters,
							`${kind}/${forward.x},${forward.y}/${sideSign}/${straight.key}`,
						).toBeCloseTo(straight.construction.lengthMeters ?? Number.NaN, 5);
					}
				}
			}
		}
	});

	it("maps A-D switches in every rotation and chirality to five owned paths", () => {
		for (const profileClass of ["A", "B", "C", "D"] as const) {
			for (const forward of ALL_DIRECTIONS) {
				for (const lateral of [leftOf(forward), oppositeDirection(leftOf(forward))]) {
					const document = documentWithTerminal(forward);
					const plan = planAdvancedSwitch(
						document.map,
						ORIGIN,
						moveCell(ORIGIN, lateral),
						profileClass,
					);
					expect(plan.valid, `${profileClass}/${forward}/${lateral}: ${plan.reason}`).toBe(true);
					expect(document.commit(plan)).toBe(true);
					const module = buildRailModuleOwnershipIndex(document.map).modules.find(
						(candidate) => candidate.kind === "advanced-switch",
					);
					if (!module) throw new Error("expected advanced switch");
					const paths = compilePhysicalRail(document.map).paths;
					const selection = compilePhysicalModuleSelection(paths, module);
					expectSelectionEquivalent(compileIndexedSelection(paths, module), selection);
					expect(selection.count).toBe(5);
					expect(
						[...selection.pathIndices].every(
							(pathIndex) =>
								(paths.advancedSwitchIds[pathIndex] as number) === module.advancedSwitchId,
						),
					).toBe(true);
				}
			}
		}
	});

	it("rejects stale semantic ownership against a newer path revision", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 })),
		).toBe(true);
		const module = buildRailModuleOwnershipIndex(document.map).modules[0];
		if (!module) throw new Error("expected ownership");
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const selection = compilePhysicalModuleSelection(
			compilePhysicalRail(document.map).paths,
			module,
		);

		expect(selection.count).toBe(0);
		expect(selection.totalLengthMeters).toBe(0);
	});
});

function compileIndexedSelection(
	paths: CompiledPhysicalPaths,
	module: RailModuleOwnership,
): ReturnType<typeof compilePhysicalModuleSelection> {
	const pathIndicesByCell = new Map<string, number[]>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const start = paths.coverageOffsets[pathIndex] as number;
		const end = paths.coverageOffsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const key = `${paths.coverageCells[row * 2]},${paths.coverageCells[row * 2 + 1]}`;
			const candidates = pathIndicesByCell.get(key);
			if (candidates) candidates.push(pathIndex);
			else pathIndicesByCell.set(key, [pathIndex]);
		}
	}
	const candidates: number[] = [];
	collectPhysicalModulePathCandidates(
		pathIndicesByCell,
		module,
		new Uint32Array(paths.pathCount),
		1,
		candidates,
	);
	return compilePhysicalModuleSelection(paths, module, candidates);
}

function expectSelectionEquivalent(
	actual: ReturnType<typeof compilePhysicalModuleSelection> | undefined,
	expected: ReturnType<typeof compilePhysicalModuleSelection> | undefined,
): void {
	expect(actual).toBeDefined();
	expect(expected).toBeDefined();
	if (!actual || !expected) return;
	expect([...actual.pathIndices]).toEqual([...expected.pathIndices]);
	expect([...actual.startStations]).toEqual([...expected.startStations]);
	expect([...actual.endStations]).toEqual([...expected.endStations]);
	expect(actual.totalLengthMeters).toBeCloseTo(expected.totalLengthMeters, 6);
}

const ORIGIN = { x: 0, y: 0 } as const;

function documentWithTerminal(forward: Direction): RailDocument {
	const document = new RailDocument();
	const start = moveRepeated(ORIGIN, oppositeDirection(forward), 3);
	const plan = planRailConstruction(document.map, start, ORIGIN);
	if (!plan.valid || !document.commit(plan)) throw new Error(`terminal fixture: ${plan.reason}`);
	return document;
}

function moveRepeated(cell: { x: number; y: number }, direction: Direction, distance: number) {
	let current = cell;
	for (let step = 0; step < distance; step++) current = moveCell(current, direction);
	return current;
}

function leftOf(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}
