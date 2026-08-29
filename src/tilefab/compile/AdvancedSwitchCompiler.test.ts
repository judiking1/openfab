import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { planAdvancedSwitch, planAdvancedSwitchReshape } from "../core/AdvancedSwitchPlanner";
import { planRailPath } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	oppositeDirection,
} from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND,
	ADVANCED_SWITCH_PORT_ROLE,
	COMPILED_ADVANCED_SWITCH_PROFILE,
	type CompiledAdvancedSwitches,
	compileAdvancedSwitches,
	validateCompiledAdvancedSwitches,
} from "./AdvancedSwitchCompiler";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_PROFILE_CLASS_CODE,
	ADVANCED_SWITCH_SEGMENT_ROLE,
} from "./AdvancedSwitchPhysicalVariant";
import {
	COMPOUND_GEOMETRY_KIND,
	COMPOUND_PROFILE_FIT,
	type CompiledPathIntervalRemap,
	NO_PATH_INTERVAL_TARGET,
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
} from "./CompoundPhysicalPath";
import type { CompiledPhysicalPaths } from "./PhysicalPathCompiler";
import { buildPhysicalPathAdjacency } from "./PhysicalPathFlow";
import {
	compilePhysicalPathMigration,
	NO_MIGRATION_TARGET_PATH,
	PHYSICAL_PATH_MIGRATION_KIND,
} from "./PhysicalPathMigration";
import { compilePhysicalRail, diagnoseCompiledAdvancedSwitches } from "./PhysicalRailCompiler";

const profileClasses: readonly AdvancedSwitchProfileClass[] = ["A", "B", "C", "D"];
const orientations = profileClasses.flatMap((profileClass) =>
	ALL_DIRECTIONS.flatMap((forward) => [
		{ profileClass, forward, lateral: leftOf(forward) },
		{ profileClass, forward, lateral: oppositeDirection(leftOf(forward)) },
	]),
);
describe("advanced switch physical compilation", () => {
	it.each(
		orientations,
	)("compiles profile $profileClass facing $forward/$lateral as four connected K2,2 movements", ({
		profileClass,
		forward,
		lateral,
	}) => {
		const switchRecord = fixture(profileClass, forward, lateral);
		const geometry = deriveAdvancedSwitchGeometry(switchRecord);
		const layout = compilePhysicalRail(buildSwitchMap(switchRecord));
		const compiled = layout.advancedSwitches;

		expect(layout.valid, layout.diagnostics.map((item) => item.message).join("\n")).toBe(true);
		expect(compiled.count).toBe(1);
		expect([...compiled.ids]).toEqual([switchRecord.id]);
		expect([...compiled.profileClasses]).toEqual([COMPILED_ADVANCED_SWITCH_PROFILE[profileClass]]);
		expect([...compiled.origins]).toEqual([switchRecord.origin.x, switchRecord.origin.y]);
		expect([...compiled.forwardDirections]).toEqual([forward]);
		expect([...compiled.lateralDirections]).toEqual([lateral]);
		expect([...compiled.movementMasks]).toEqual([ADVANCED_SWITCH_ALL_MOVEMENTS]);

		expect([...compiled.portOffsets]).toEqual([0, 4]);
		expect([...compiled.portRoles]).toEqual([
			ADVANCED_SWITCH_PORT_ROLE.INPUT,
			ADVANCED_SWITCH_PORT_ROLE.INPUT,
			ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
			ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
		]);
		expect([...compiled.portLocalIndices]).toEqual([0, 1, 0, 1]);
		expect([...compiled.portCells]).toEqual(
			geometry.ports.flatMap((port) => [port.cell.x, port.cell.y]),
		);
		expect([...compiled.portDirections]).toEqual(geometry.ports.map((port) => port.direction));
		expect(
			[...compiled.portPathIndices].every((pathIndex) => pathIndex < layout.paths.pathCount),
		).toBe(true);
		expect([...compiled.portPathStations].every((station) => Number.isFinite(station))).toBe(true);

		expect(layout.compoundProfiles.count).toBe(2);
		const syntheticPaths = Array.from(
			{ length: layout.paths.pathCount },
			(_, pathIndex) => pathIndex,
		).filter((pathIndex) => layout.paths.advancedSwitchIds[pathIndex] === switchRecord.id);
		expect(syntheticPaths).toHaveLength(5);
		expect(
			syntheticPaths.map((pathIndex) => layout.paths.advancedSwitchSegmentRoles[pathIndex]),
		).toEqual([
			ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
			ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
			ADVANCED_SWITCH_SEGMENT_ROLE.THROAT,
			ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
			ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
		]);
		expect(
			syntheticPaths.map((pathIndex) => layout.paths.advancedSwitchSegmentPorts[pathIndex]),
		).toEqual([0, 1, ADVANCED_SWITCH_NO_PORT, 0, 1]);
		for (const pathIndex of syntheticPaths) {
			expect(layout.paths.advancedSwitchProfileClasses[pathIndex]).toBe(
				ADVANCED_SWITCH_PROFILE_CLASS_CODE[profileClass],
			);
			expect(layout.paths.advancedSwitchSegmentOrdinals[pathIndex]).toBe(0);
			expect(layout.paths.lengths[pathIndex]).toBeGreaterThan(0);
		}
		const inputPaths = syntheticPaths.filter(
			(pathIndex) =>
				layout.paths.advancedSwitchSegmentRoles[pathIndex] === ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
		);
		const throatPath = syntheticPaths.find(
			(pathIndex) =>
				layout.paths.advancedSwitchSegmentRoles[pathIndex] === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT,
		) as number;
		const outputPaths = syntheticPaths.filter(
			(pathIndex) =>
				layout.paths.advancedSwitchSegmentRoles[pathIndex] === ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
		);
		for (const inputPath of inputPaths) {
			expect(explicitTargets(layout.paths, inputPath)).toEqual([throatPath]);
		}
		expect(explicitTargets(layout.paths, throatPath)).toEqual(outputPaths);
		for (const outputPath of outputPaths)
			expect(explicitTargets(layout.paths, outputPath)).toEqual([]);

		const remap = layout.pathIntervalRemap;
		const ownedCells = new Set(geometry.occupiedCells.map((cell) => `${cell.x}:${cell.y}`));
		const suppressedRawSources = Array.from(
			{ length: remap.sourcePathCount },
			(_, sourcePathIndex) => sourcePathIndex,
		).filter(
			(sourcePathIndex) =>
				remap.sourceIdentityKinds[sourcePathIndex] === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
				ownedCells.has(
					`${remap.sourcePathCells[sourcePathIndex * 2]}:${remap.sourcePathCells[sourcePathIndex * 2 + 1]}`,
				),
		);
		expect(suppressedRawSources.length).toBeGreaterThan(0);
		for (const sourcePathIndex of suppressedRawSources) {
			const start = remap.sourcePathOffsets[sourcePathIndex] as number;
			const end = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
			expect(end - start).toBe(1);
			expect(remap.mappingKinds[start]).toBe(PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE);
			expect(remap.targetPathIndices[start]).toBe(NO_PATH_INTERVAL_TARGET);
		}
		expect(
			[...remap.sourceIdentityKinds].filter(
				(identityKind) => identityKind === PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT,
			),
		).toHaveLength(5);
		const switchPieces = layout.pieces.filter(
			(piece) => piece.advancedSwitchId === switchRecord.id,
		);
		expect(switchPieces).toHaveLength(5);
		expect(new Set(switchPieces.map((piece) => piece.id)).size).toBe(5);
		expect(new Set(switchPieces.map((piece) => piece.physicalPathIndex))).toEqual(
			new Set(syntheticPaths),
		);
		expect(
			switchPieces.every((piece) => piece.fitKind === "MAP_EXACT" || piece.fitKind === "GRID_FIT"),
		).toBe(true);
		expect(switchPieces.every((piece) => piece.nominalProfileId?.startsWith("OPENFAB_ADV_"))).toBe(
			true,
		);
		for (let profileIndex = 0; profileIndex < layout.compoundProfiles.count; profileIndex++) {
			expect(layout.compoundProfiles.advancedSwitchIds[profileIndex]).toBe(switchRecord.id);
			expect(layout.compoundProfiles.geometryKinds[profileIndex]).toBe(
				COMPOUND_GEOMETRY_KIND.OPENFAB_PARAMETRIC,
			);
			expect([COMPOUND_PROFILE_FIT.MAP_EXACT, COMPOUND_PROFILE_FIT.GRID_FIT]).toContain(
				layout.compoundProfiles.fitKinds[profileIndex],
			);
			expect(layout.compoundProfiles.nominalProfileIndices[profileIndex]).toBeGreaterThanOrEqual(0);
			expect(layout.compoundProfiles.fitReasonMasks[profileIndex]).toBeGreaterThan(0);
			const memberStart = layout.compoundProfiles.memberOffsets[profileIndex] as number;
			const memberEnd = layout.compoundProfiles.memberOffsets[profileIndex + 1] as number;
			expect(memberEnd - memberStart).toBe(1);
			const sourcePathIndex = layout.compoundProfiles.memberPathIndices[memberStart] as number;
			const finalPathIndex = layout.compoundProfiles.pathIndices[profileIndex] as number;
			expect(remap.sourceIdentityKinds[sourcePathIndex]).toBe(
				PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT,
			);
			expect(remap.sourceAdvancedSwitchIds[sourcePathIndex]).toBe(switchRecord.id);
			expect(remap.sourceAdvancedSwitchRoles[sourcePathIndex]).toBe(
				layout.paths.advancedSwitchSegmentRoles[finalPathIndex],
			);
			expect(remap.sourceAdvancedSwitchPorts[sourcePathIndex]).toBe(
				layout.paths.advancedSwitchSegmentPorts[finalPathIndex],
			);
		}

		expect([...compiled.movementOffsets]).toEqual([0, 4]);
		expect([...compiled.movementInputIndices]).toEqual([0, 0, 1, 1]);
		expect([...compiled.movementOutputIndices]).toEqual([0, 1, 0, 1]);
		expect(compiled.movementPathOffsets).toHaveLength(5);
		expect([...compiled.claimedOffsets]).toEqual([0, geometry.claimedCells.length]);
		expect([...compiled.reservedOffsets]).toEqual([0, geometry.reservedCells.length]);
		expect([...compiled.mergeAnchors]).toEqual([geometry.mergeAnchor.x, geometry.mergeAnchor.y]);
		expect([...compiled.branchAnchors]).toEqual([geometry.branchAnchor.x, geometry.branchAnchor.y]);
		expect([...compiled.sharedThroatCells]).toEqual([
			geometry.sharedTrunkSupport.x,
			geometry.sharedTrunkSupport.y,
		]);
		expect(compiled.sharedThroatLengthsMeters[0]).toBeCloseTo(0.2, 5);
		expect(compiled.mergeSharedLeadMeters[0]).toBeCloseTo(0.4, 5);
		expect(compiled.clearTrunkMeters[0]).toBeCloseTo(0.2, 5);
		expect(compiled.branchSharedLeadMeters[0]).toBeCloseTo(0.4, 5);
		expect([...compiled.conflictZoneIds]).toEqual([switchRecord.id]);
		expect([...compiled.conflictZoneLengthsMeters]).toEqual([1]);
		expect([...compiled.conflictPathOffsets]).toEqual([0, 5]);
		expect([...compiled.conflictIntervalKinds]).toEqual([
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED,
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED,
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT,
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED,
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED,
		]);
		expect([...compiled.conflictRouteIndices]).toEqual([0, 1, 0, 0, 1]);
		const conflictLengths = [...compiled.conflictPathEnds].map(
			(end, index) => end - (compiled.conflictPathStarts[index] as number),
		);
		for (const [index, expected] of [0.4, 0.4, 0.2, 0.4, 0.4].entries()) {
			expect(conflictLengths[index]).toBeCloseTo(expected, 5);
		}
		expect(compiled.conflictBounds).toHaveLength(4);
		expect(compiled.bounds).toHaveLength(4);

		const adjacency = buildPhysicalPathAdjacency(layout.paths);
		const conflictPath = compiled.conflictPathIndices[2] as number;
		expect([...compiled.movementConflictOffsets]).toEqual([0, 3, 6, 9, 12]);
		for (let movementIndex = 0; movementIndex < 4; movementIndex++) {
			const inputIndex = compiled.movementInputIndices[movementIndex] as 0 | 1;
			const outputIndex = compiled.movementOutputIndices[movementIndex] as 0 | 1;
			const start = compiled.movementPathOffsets[movementIndex] as number;
			const end = compiled.movementPathOffsets[movementIndex + 1] as number;
			const sequence = [...compiled.movementPathIndices.slice(start, end)];
			expect(sequence.length).toBeGreaterThan(0);
			expect(sequence[0]).toBe(compiled.portPathIndices[inputIndex]);
			expect(sequence.at(-1)).toBe(compiled.portPathIndices[2 + outputIndex]);
			expect(compiled.movementPathStarts[start]).toBeCloseTo(
				compiled.portPathStations[inputIndex] as number,
				5,
			);
			expect(compiled.movementPathEnds[end - 1]).toBeCloseTo(
				compiled.portPathStations[2 + outputIndex] as number,
				5,
			);
			expect(sequence).toContain(conflictPath);
			for (let row = start; row < end; row++) {
				expect(compiled.movementPathStarts[row]).toBeGreaterThanOrEqual(0);
				expect(compiled.movementPathEnds[row]).toBeGreaterThanOrEqual(
					compiled.movementPathStarts[row] as number,
				);
				expect(compiled.movementPathEnds[row]).toBeLessThanOrEqual(
					layout.paths.lengths[compiled.movementPathIndices[row] as number] as number,
				);
			}
			for (let pathOffset = 0; pathOffset < sequence.length - 1; pathOffset++) {
				expect(adjacentTargets(adjacency, sequence[pathOffset] as number)).toContain(
					sequence[pathOffset + 1],
				);
			}
		}
		expect(
			validateCompiledAdvancedSwitches(compiled, layout.paths, layout.pathIntervalRemap),
		).toEqual([]);
		const selfMigration = compilePhysicalPathMigration(layout, layout);
		expect(selfMigration.unmappableSourcePathCount).toBe(0);

		expect(layout.turnoutFootprints.count).toBe(0);
		expect(layout.junctions).toHaveLength(0);
		expect(new Set(layout.terminals.map((cell) => `${cell.x}:${cell.y}`))).toEqual(
			new Set(geometry.ports.map((port) => `${port.cell.x}:${port.cell.y}`)),
		);
		expect(geometry.cellStates.every((cell) => bitCount(cell.incoming | cell.outgoing) < 4)).toBe(
			true,
		);
	});

	it("emits deterministic empty CSR boundaries", () => {
		const compiled = compilePhysicalRail(new TileMap()).advancedSwitches;
		expect(compiled.count).toBe(0);
		expect([...compiled.portOffsets]).toEqual([0]);
		expect([...compiled.movementOffsets]).toEqual([0]);
		expect([...compiled.movementPathOffsets]).toEqual([0]);
		expect([...compiled.movementConflictOffsets]).toEqual([0]);
		expect([...compiled.claimedOffsets]).toEqual([0]);
		expect([...compiled.reservedOffsets]).toEqual([0]);
		expect([...compiled.conflictPathOffsets]).toEqual([0]);
	});

	it.each(
		profileClasses,
	)("emits profile %s as a synthetic subgraph instead of retaining raw cardinal routes", (profileClass) => {
		const switchRecord = fixture(profileClass, DIR_E, DIR_S);
		const authoredCells = deriveAdvancedSwitchGeometry(switchRecord).cellStates;
		const withSidecar = compilePhysicalRail(buildSwitchMap(switchRecord));
		const withoutSidecarMap = new TileMap();
		for (const cell of authoredCells) withoutSidecarMap.setEncoded(cell.x, cell.y, cell.encoded);
		const withoutSidecar = compilePhysicalRail(withoutSidecarMap);

		expect(withSidecar.compoundProfiles.count).toBe(2);
		expect(
			[...withSidecar.paths.advancedSwitchIds].filter((id) => id === switchRecord.id),
		).toHaveLength(5);
		expect([...withSidecar.paths.kinds]).not.toEqual([...withoutSidecar.paths.kinds]);
		expect([...withSidecar.paths.positions]).not.toEqual([...withoutSidecar.paths.positions]);
		expect(withSidecar.paths.pathCount).toBeLessThan(withoutSidecar.paths.pathCount);
	});

	it("rejects corrupt CSR, path index, station, movement identity, and throat ownership buffers", () => {
		const layout = compilePhysicalRail(buildSwitchMap(fixture("D", DIR_E, DIR_S)));
		const cases: readonly {
			name: string;
			code: string;
			mutate(compiled: CompiledAdvancedSwitches): void;
		}[] = [
			{
				name: "fixed length",
				code: "INVALID_FIXED_LENGTH",
				mutate: (compiled) => {
					compiled.ids = new Uint32Array();
				},
			},
			{
				name: "offset",
				code: "INVALID_CSR",
				mutate: (compiled) => {
					compiled.movementPathOffsets[compiled.movementPathOffsets.length - 1]--;
				},
			},
			{
				name: "movement station",
				code: "INVALID_PATH_INTERVAL",
				mutate: (compiled) => {
					compiled.movementPathEnds[0] = Number.POSITIVE_INFINITY;
				},
			},
			{
				name: "path index",
				code: "INVALID_PATH_INTERVAL",
				mutate: (compiled) => {
					compiled.movementPathIndices[0] = layout.paths.pathCount;
				},
			},
			{
				name: "port station",
				code: "INVALID_PORT",
				mutate: (compiled) => {
					compiled.portPathStations[0] = Number.NaN;
				},
			},
			{
				name: "movement identity",
				code: "INVALID_MOVEMENT",
				mutate: (compiled) => {
					compiled.movementInputIndices[2] = 0;
				},
			},
			{
				name: "throat data",
				code: "INVALID_CONFLICT_OWNERSHIP",
				mutate: (compiled) => {
					compiled.sharedThroatLengthsMeters[0] = 0.3;
				},
			},
			{
				name: "conflict reference",
				code: "INVALID_CONFLICT_OWNERSHIP",
				mutate: (compiled) => {
					compiled.movementConflictIntervalIndices[0] = compiled.conflictPathIndices.length;
				},
			},
			{
				name: "movement conflict coverage",
				code: "INVALID_CONFLICT_OWNERSHIP",
				mutate: (compiled) => {
					const conflictIndex = compiled.conflictIntervalKinds.indexOf(
						ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT,
					);
					const conflictPathIndex = compiled.conflictPathIndices[conflictIndex] as number;
					const rowStart = compiled.movementPathOffsets[0] as number;
					const rowEnd = compiled.movementPathOffsets[1] as number;
					for (let row = rowStart; row < rowEnd; row++) {
						if (compiled.movementPathIndices[row] !== conflictPathIndex) continue;
						compiled.movementPathStarts[row] = compiled.conflictPathEnds[conflictIndex] as number;
						compiled.movementPathEnds[row] = compiled.conflictPathEnds[conflictIndex] as number;
						return;
					}
					throw new Error("fixture movement did not contain the center conflict path");
				},
			},
			{
				name: "reserved footprint",
				code: "INVALID_FOOTPRINT",
				mutate: (compiled) => {
					compiled.reservedCells[0] = 1_000_000;
				},
			},
			{
				name: "profile class",
				code: "INVALID_IDENTITY",
				mutate: (compiled) => {
					compiled.profileClasses[0] = 255;
				},
			},
			{
				name: "origin",
				code: "INVALID_IDENTITY",
				mutate: (compiled) => {
					compiled.origins[0]++;
				},
			},
			{
				name: "orientation",
				code: "INVALID_IDENTITY",
				mutate: (compiled) => {
					compiled.forwardDirections[0] = DIR_E | DIR_S;
				},
			},
			{
				name: "merge anchor",
				code: "INVALID_IDENTITY",
				mutate: (compiled) => {
					compiled.mergeAnchors[0]++;
				},
			},
			{
				name: "port cell",
				code: "INVALID_PORT",
				mutate: (compiled) => {
					compiled.portCells[0]++;
				},
			},
			{
				name: "port direction",
				code: "INVALID_PORT",
				mutate: (compiled) => {
					compiled.portDirections[0] = DIR_N;
				},
			},
			{
				name: "shifted conflict interval",
				code: "INVALID_CONFLICT_OWNERSHIP",
				mutate: (compiled) => {
					compiled.conflictPathStarts[0] += 0.001;
					compiled.conflictPathEnds[0] += 0.001;
				},
			},
			{
				name: "switch bounds",
				code: "INVALID_BOUNDS",
				mutate: (compiled) => {
					compiled.bounds[0] += 0.001;
				},
			},
		];
		for (const testCase of cases) {
			const corrupt = cloneCompiledSwitches(layout.advancedSwitches);
			testCase.mutate(corrupt);
			const issues = validateCompiledAdvancedSwitches(
				corrupt,
				layout.paths,
				layout.pathIntervalRemap,
			);
			expect(
				issues.some((issue) => issue.code === testCase.code),
				`${testCase.name}: ${issues.map((issue) => issue.code).join(", ")}`,
			).toBe(true);
			expect(
				diagnoseCompiledAdvancedSwitches(corrupt, layout.paths, layout.pathIntervalRemap).some(
					(diagnostic) => diagnostic.code === "INVALID_COMPILED_ADVANCED_SWITCH",
				),
				`${testCase.name}: malformed switch output was not promoted to a layout diagnostic`,
			).toBe(true);
		}
	});

	it("rejects duplicate compiled switch identities", () => {
		const first = fixture("A", DIR_E, DIR_S, 17);
		const second: AdvancedSwitchRecord = {
			...fixture("C", DIR_E, DIR_N, 29),
			origin: { x: 100, y: 100 },
		};
		const map = new TileMap();
		for (const switchRecord of [first, second]) {
			for (const cell of deriveAdvancedSwitchGeometry(switchRecord).cellStates) {
				map.setEncoded(cell.x, cell.y, cell.encoded);
			}
			map.setAdvancedSwitch(switchRecord);
		}
		const layout = compilePhysicalRail(map);
		const corrupt = cloneCompiledSwitches(layout.advancedSwitches);
		corrupt.ids[1] = corrupt.ids[0] as number;

		expect(
			validateCompiledAdvancedSwitches(corrupt, layout.paths, layout.pathIntervalRemap).some(
				(issue) => issue.code === "INVALID_IDENTITY",
			),
		).toBe(true);
	});

	it("takes the zero-switch fast path on a 50k-cell ordinary map without global indexes", () => {
		const map = new TileMap();
		const ordinary = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) map.setEncoded(index, 0, ordinary);
		const touched: string[] = [];
		const poisonPaths = new Proxy({} as CompiledPhysicalPaths, {
			get: (_target, property) => {
				throw new Error(`unexpected physical-path access: ${String(property)}`);
			},
		});
		const poisonRemap = new Proxy({} as CompiledPathIntervalRemap, {
			get: (_target, property) => {
				throw new Error(`unexpected interval-remap access: ${String(property)}`);
			},
		});

		const result = compileAdvancedSwitches(map, poisonPaths, poisonRemap, {
			onBuildGlobalAuxiliaryIndex: (kind) => touched.push(kind),
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.switches.count).toBe(0);
		expect(validateCompiledAdvancedSwitches(result.switches, poisonPaths, poisonRemap)).toEqual([]);
		expect(touched).toEqual([]);
	});

	it("compiles one switch identically with 50k unrelated authored cells", () => {
		const switchRecord = fixture("A", DIR_E, DIR_S);
		const isolated = compilePhysicalRail(buildSwitchMap(switchRecord));
		const crowdedMap = buildSwitchMap(switchRecord);
		const ordinary = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			crowdedMap.setEncoded(10_000 + index, 10_000, ordinary);
		}
		const crowded = compilePhysicalRail(crowdedMap);

		expect(advancedSwitchPathIdentitySnapshot(crowded)).toEqual(
			advancedSwitchPathIdentitySnapshot(isolated),
		);
		expect(normalizeCompiledSwitchPathIndices(crowded)).toEqual(
			normalizeCompiledSwitchPathIndices(isolated),
		);
		expect(normalizeCompoundProfileIndices(crowded)).toEqual(
			normalizeCompoundProfileIndices(isolated),
		);
	});

	it("resolves boundary paths when built from an already-connected input terminal", () => {
		const document = new RailDocument();
		const approach = planRailPath(document.map, [
			{ x: -3, y: 0 },
			{ x: -2, y: 0 },
			{ x: -1, y: 0 },
			{ x: 0, y: 0 },
		]);
		expect(document.commit(approach)).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 2 }, "C");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid, layout.diagnostics.map((item) => item.message).join("\n")).toBe(true);
		expect(layout.advancedSwitches.count).toBe(1);
		expect([...layout.advancedSwitches.portPathIndices]).toHaveLength(4);
		expect(layout.advancedSwitches.movementPathOffsets).toHaveLength(5);
		expect([...layout.paths.advancedSwitchIds].filter((id) => id > 0)).toHaveLength(5);
		expect(layout.terminals).toHaveLength(4);
		expect(layout.terminals).not.toContainEqual({ x: 0, y: 0 });
	});

	it("recompiles an in-place reshape under the same switch identity", () => {
		const document = new RailDocument();
		expect(
			document.commit(
				planRailPath(document.map, [
					{ x: -3, y: 0 },
					{ x: -2, y: 0 },
					{ x: -1, y: 0 },
					{ x: 0, y: 0 },
				]),
			),
		).toBe(true);
		const build = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 2 }, "A");
		expect(document.commit(build)).toBe(true);
		const id = build.switchRecord?.id;
		if (id === undefined) throw new Error("expected a switch id");
		const reshape = planAdvancedSwitchReshape(document.map, id, "D", "left");
		expect(reshape.valid, reshape.reason).toBe(true);
		expect(document.commit(reshape)).toBe(true);

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid, layout.diagnostics.map((item) => item.message).join("\n")).toBe(true);
		expect([...layout.advancedSwitches.ids]).toEqual([id]);
		expect([...layout.advancedSwitches.profileClasses]).toEqual([
			COMPILED_ADVANCED_SWITCH_PROFILE.D,
		]);
		expect([...layout.advancedSwitches.movementInputIndices]).toEqual([0, 0, 1, 1]);
		expect([...layout.advancedSwitches.movementOutputIndices]).toEqual([0, 1, 0, 1]);
		expect([...layout.paths.advancedSwitchIds].filter((switchId) => switchId === id)).toHaveLength(
			5,
		);
	});

	it("diagnoses a broken sidecar topology and its unresolvable movements", () => {
		const switchRecord = fixture("A", DIR_E, DIR_S);
		const map = buildSwitchMap(switchRecord);
		const throat = deriveAdvancedSwitchGeometry(switchRecord).sharedTrunkSupport;
		map.setEncoded(throat.x, throat.y, 0);

		const layout = compilePhysicalRail(map);

		expect(layout.valid).toBe(false);
		expect(
			layout.diagnostics.some((item) => item.code === "INVALID_ADVANCED_SWITCH_TOPOLOGY"),
		).toBe(true);
		expect(layout.advancedSwitches.count).toBe(1);
	});

	it("keeps sidecar identity in the compiled layout even when byte geometry is identical", () => {
		const first = fixture("B", DIR_N, DIR_W, 17);
		const second = fixture("B", DIR_N, DIR_W, 29);
		const firstLayout = compilePhysicalRail(buildSwitchMap(first));
		const secondLayout = compilePhysicalRail(buildSwitchMap(second));

		expect([...firstLayout.paths.positions]).toEqual([...secondLayout.paths.positions]);
		expect([...firstLayout.advancedSwitches.ids]).toEqual([17]);
		expect([...secondLayout.advancedSwitches.ids]).toEqual([29]);
		expect([...firstLayout.advancedSwitches.conflictZoneIds]).toEqual([17]);
		expect([...secondLayout.advancedSwitches.conflictZoneIds]).toEqual([29]);
	});

	it("does not migrate worker path state across different advanced-switch identities", () => {
		const previous = compilePhysicalRail(buildSwitchMap(fixture("B", DIR_N, DIR_W, 17)));
		const next = compilePhysicalRail(buildSwitchMap(fixture("B", DIR_N, DIR_W, 29)));
		const migration = compilePhysicalPathMigration(previous, next);

		for (const pathIndex of advancedSwitchOwnedPaths(previous)) {
			const rowStart = migration.sourcePathOffsets[pathIndex] as number;
			const rowEnd = migration.sourcePathOffsets[pathIndex + 1] as number;
			expect(rowEnd).toBeGreaterThan(rowStart);
			for (let row = rowStart; row < rowEnd; row++) {
				expect(migration.targetPathIndices[row]).toBe(NO_MIGRATION_TARGET_PATH);
				expect(migration.mappingKinds[row]).toBe(PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE);
			}
		}
	});

	it("makes every owned path unmappable when the same switch id is reshaped", () => {
		const previous = compilePhysicalRail(buildSwitchMap(fixture("A", DIR_E, DIR_S, 17)));
		const next = compilePhysicalRail(buildSwitchMap(fixture("D", DIR_E, DIR_N, 17)));
		const migration = compilePhysicalPathMigration(previous, next);

		for (const pathIndex of advancedSwitchOwnedPaths(previous)) {
			const rowStart = migration.sourcePathOffsets[pathIndex] as number;
			const rowEnd = migration.sourcePathOffsets[pathIndex + 1] as number;
			expect(rowEnd - rowStart).toBe(1);
			expect(migration.targetPathIndices[rowStart]).toBe(NO_MIGRATION_TARGET_PATH);
			expect(migration.mappingKinds[rowStart]).toBe(PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE);
		}
	});

	it.each([
		{
			label: "chirality changes",
			next: { ...fixture("A", DIR_E, DIR_S, 17), lateral: DIR_N },
		},
		{
			label: "quarter-turn orientation changes",
			next: { ...fixture("A", DIR_E, DIR_S, 17), forward: DIR_S, lateral: DIR_E },
		},
		{
			label: "the footprint is relocated",
			next: { ...fixture("A", DIR_E, DIR_S, 17), origin: { x: 48, y: -26 } },
		},
	] satisfies readonly {
		label: string;
		next: AdvancedSwitchRecord;
	}[])("makes every owned path unmappable when $label", ({ next }) => {
		const previous = compilePhysicalRail(buildSwitchMap(fixture("A", DIR_E, DIR_S, 17)));
		const current = compilePhysicalRail(buildSwitchMap(next));
		const migration = compilePhysicalPathMigration(previous, current);

		expectAdvancedSwitchMigrationKind(previous, migration, PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE);
	});

	it("makes every owned path unmappable when the switch is removed", () => {
		const previous = compilePhysicalRail(buildSwitchMap(fixture("A", DIR_E, DIR_S, 17)));
		const current = compilePhysicalRail(new TileMap());
		const migration = compilePhysicalPathMigration(previous, current);

		expectAdvancedSwitchMigrationKind(previous, migration, PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE);
	});

	it("makes every owned path unmappable when a boundary terminal is extended", () => {
		const switchRecord = fixture("A", DIR_E, DIR_S, 17);
		const previousMap = buildSwitchMap(switchRecord);
		const nextMap = previousMap.clone();
		const output = deriveAdvancedSwitchGeometry(switchRecord).outputs[0];
		const extension = planRailPath(nextMap, [
			output.cell,
			{ x: output.cell.x + 1, y: output.cell.y },
		]);
		expect(extension.valid, extension.reason).toBe(true);
		nextMap.applyAtomicMutations(extension.mutations, []);
		const previous = compilePhysicalRail(previousMap);
		const next = compilePhysicalRail(nextMap);
		const migration = compilePhysicalPathMigration(previous, next);

		for (const pathIndex of advancedSwitchOwnedPaths(previous)) {
			const row = migration.sourcePathOffsets[pathIndex] as number;
			expect(migration.sourcePathOffsets[pathIndex + 1] - row).toBe(1);
			expect(migration.mappingKinds[row]).toBe(PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE);
		}
	});

	it("preserves switch-owned paths across an unrelated path-index insertion", () => {
		const previousMap = buildSwitchMap(fixture("A", DIR_E, DIR_S, 17));
		const nextMap = previousMap.clone();
		nextMap.setEncoded(-10_000, -10_000, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		const previous = compilePhysicalRail(previousMap);
		const next = compilePhysicalRail(nextMap);
		const migration = compilePhysicalPathMigration(previous, next);

		for (const pathIndex of advancedSwitchOwnedPaths(previous)) {
			const rowStart = migration.sourcePathOffsets[pathIndex] as number;
			const rowEnd = migration.sourcePathOffsets[pathIndex + 1] as number;
			expect(rowEnd).toBeGreaterThan(rowStart);
			for (let row = rowStart; row < rowEnd; row++) {
				expect(migration.targetPathIndices[row]).not.toBe(NO_MIGRATION_TARGET_PATH);
				expect(migration.mappingKinds[row]).not.toBe(PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE);
			}
		}
	});

	it("does not legitimize a metadata-free degree-four crossing", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W | DIR_S, outgoing: DIR_E | DIR_N }));

		const layout = compilePhysicalRail(map);

		expect(layout.valid).toBe(false);
		expect(layout.advancedSwitches.count).toBe(0);
		expect(layout.diagnostics.some((item) => item.code === "INVALID_CELL")).toBe(true);
	});
});

function fixture(
	profileClass: AdvancedSwitchProfileClass,
	forward: Direction,
	lateral: Direction,
	id = 17,
): AdvancedSwitchRecord {
	return {
		id,
		profileClass,
		origin: { x: 11, y: -7 },
		forward,
		lateral,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
}

function buildSwitchMap(switchRecord: AdvancedSwitchRecord): TileMap {
	const map = new TileMap();
	for (const cell of deriveAdvancedSwitchGeometry(switchRecord).cellStates) {
		map.setEncoded(cell.x, cell.y, cell.encoded);
	}
	map.setAdvancedSwitch(switchRecord);
	return map;
}

function leftOf(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}

function adjacentTargets(
	adjacency: ReturnType<typeof buildPhysicalPathAdjacency>,
	pathIndex: number,
): number[] {
	const start = adjacency.offsets[pathIndex] as number;
	const end = adjacency.offsets[pathIndex + 1] as number;
	return [...adjacency.targets.slice(start, end)];
}

function explicitTargets(paths: CompiledPhysicalPaths, pathIndex: number): number[] {
	const start = paths.explicitAdjacencyOffsets[pathIndex] as number;
	const end = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
	return [...paths.explicitAdjacencyTargets.slice(start, end)];
}

function advancedSwitchPathIdentitySnapshot(
	layout: ReturnType<typeof compilePhysicalRail>,
): readonly Record<string, number>[] {
	const result: Record<string, number>[] = [];
	for (let pathIndex = 0; pathIndex < layout.paths.pathCount; pathIndex++) {
		const switchId = layout.paths.advancedSwitchIds[pathIndex] as number;
		if (switchId === 0) continue;
		result.push({
			switchId,
			profileClass: layout.paths.advancedSwitchProfileClasses[pathIndex] as number,
			role: layout.paths.advancedSwitchSegmentRoles[pathIndex] as number,
			port: layout.paths.advancedSwitchSegmentPorts[pathIndex] as number,
			ordinal: layout.paths.advancedSwitchSegmentOrdinals[pathIndex] as number,
			length: layout.paths.lengths[pathIndex] as number,
		});
	}
	return result;
}

function normalizeCompiledSwitchPathIndices(
	layout: ReturnType<typeof compilePhysicalRail>,
): CompiledAdvancedSwitches {
	const compiled = structuredClone(layout.advancedSwitches);
	compiled.portPathIndices.fill(0);
	compiled.movementPathIndices.fill(0);
	compiled.conflictPathIndices.fill(0);
	return compiled;
}

function normalizeCompoundProfileIndices(layout: ReturnType<typeof compilePhysicalRail>) {
	const profiles = structuredClone(layout.compoundProfiles);
	profiles.pathIndices.fill(0);
	profiles.memberPathIndices.fill(0);
	return profiles;
}

function cloneCompiledSwitches(source: CompiledAdvancedSwitches): CompiledAdvancedSwitches {
	return structuredClone(source);
}

function advancedSwitchOwnedPaths(layout: ReturnType<typeof compilePhysicalRail>): Set<number> {
	const switches = layout.advancedSwitches;
	return new Set([
		...switches.portPathIndices,
		...switches.movementPathIndices,
		...switches.conflictPathIndices,
		...layout.compoundProfiles.pathIndices,
	]);
}

function expectAdvancedSwitchMigrationKind(
	previous: ReturnType<typeof compilePhysicalRail>,
	migration: ReturnType<typeof compilePhysicalPathMigration>,
	expectedKind: number,
): void {
	for (const pathIndex of advancedSwitchOwnedPaths(previous)) {
		const row = migration.sourcePathOffsets[pathIndex] as number;
		expect(migration.sourcePathOffsets[pathIndex + 1] - row).toBe(1);
		expect(migration.targetPathIndices[row]).toBe(NO_MIGRATION_TARGET_PATH);
		expect(migration.mappingKinds[row]).toBe(expectedKind);
	}
}
