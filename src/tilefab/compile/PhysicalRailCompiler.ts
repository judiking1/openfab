import { type AdvancedSwitchRecord, deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import { type AuthoredRailType, classifyRailCell } from "../core/RailCellClassification";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	findDirectedThroughRoute,
	moveCell,
	oppositeDirection,
	tangentJunctionSide,
} from "../core/railShape";
import { type Cell, cellKey, type RailCell, type TileMap } from "../core/TileMap";
import {
	collectTurnoutFootprints,
	type TurnoutFootprint,
	validateTurnoutFootprints,
} from "../core/turnout";
import {
	type AdvancedSwitchCompileDiagnosticCode,
	type CompiledAdvancedSwitches,
	compileAdvancedSwitches,
	validateCompiledAdvancedSwitches,
} from "./AdvancedSwitchCompiler";
import { integrateAdvancedSwitchPhysicalVariants } from "./AdvancedSwitchPhysicalIntegrator";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_PROFILE_CLASS_CODE,
	ADVANCED_SWITCH_SEGMENT_ROLE,
	advancedSwitchPhysicalProfile,
	collectAdvancedSwitchOwnedSourcePaths,
	compileAdvancedSwitchPhysicalVariants,
} from "./AdvancedSwitchPhysicalVariant";
import {
	COMPOUND_GEOMETRY_KIND,
	COMPOUND_PROFILE_FIT,
	COMPOUND_PROFILE_TYPE,
	type CompiledCompoundProfiles,
	type CompiledPathIntervalRemap,
	stitchCompoundPhysicalPaths,
} from "./CompoundPhysicalPath";
import {
	type CompoundRailEntry,
	type CompoundRailPattern,
	collectCompoundRailPatterns,
} from "./CompoundRailPattern";
import { OPENFAB_COMPOUND_PROFILE_CATALOG } from "./OpenFabCompoundGeometry";
import {
	type CompiledPhysicalPaths,
	compilePhysicalPaths,
	PATH_KIND,
} from "./PhysicalPathCompiler";
import { type CompiledRailClearance, compileRailClearance } from "./RailClearanceValidator";
import { deriveTurnoutClearancePathIntervals } from "./TurnoutClearanceOwnership";

export { type AuthoredRailType, classifyRailCell } from "../core/RailCellClassification";

export type CompiledRailPatternType =
	| "LINEAR"
	| "LEFT_CURVE"
	| "RIGHT_CURVE"
	| "CCW_CURVE"
	| "S_CURVE"
	| "CSC_CURVE_HOMO"
	| "CSC_CURVE_HETE";

export interface CompiledRailPiece {
	id: string;
	type: CompiledRailPatternType;
	cells: readonly Cell[];
	from: Cell;
	to: Cell;
	lengthMeters: number;
	radiusMillimeters: number | null;
	geometryKind?: "BASELINE_STITCHED" | "OPENFAB_PARAMETRIC";
	fitKind?: "NOT_APPLICABLE" | "MAP_EXACT" | "GRID_FIT";
	nominalProfileId?: string;
	rotationDegrees?: number;
	leadInMillimeters?: number;
	leadOutMillimeters?: number;
	middleMillimeters?: number;
	nominalLengthMeters?: number;
	leadInResidualMillimeters?: number;
	leadOutResidualMillimeters?: number;
	middleResidualMillimeters?: number;
	lengthResidualMillimeters?: number;
	forwardFitDeltaMillimeters?: number;
	lateralFitDeltaMillimeters?: number;
	turn?: "left" | "right";
	role?: "TURNOUT_TRUNK" | "TURNOUT_DIVERGE";
	physicalPathIndex?: number;
	advancedSwitchId?: number;
	advancedSwitchProfileClass?: number;
	advancedSwitchSegmentRole?: number;
	advancedSwitchPortIndex?: number;
	advancedSwitchSegmentOrdinal?: number;
}

export interface CompiledJunction {
	id: string;
	type: "BRANCH" | "MERGE";
	cell: Cell;
	incoming: number;
	outgoing: number;
	through: { incoming: Direction; outgoing: Direction };
	divergingSide: Direction;
	tangentSide: Direction;
	profileId: string;
	leadInMillimeters: number;
	leadOutMillimeters: number;
	radiusMillimeters: number;
	footprintCells: readonly Cell[];
	trunkPathIndex: number;
	divergePathIndex: number;
	advancedSwitchId?: number;
}

export interface CompiledTurnoutFootprints {
	count: number;
	kinds: Uint8Array;
	anchors: Int32Array;
	leadInMillimeters: Uint16Array;
	leadOutMillimeters: Uint16Array;
	radiusMillimeters: Uint16Array;
	reservedOffsets: Uint32Array;
	reservedCells: Int32Array;
	pathOffsets: Uint32Array;
	pathIndices: Uint32Array;
	clearancePathOffsets: Uint32Array;
	clearancePathIndices: Uint32Array;
	clearancePathStarts: Float32Array;
	clearancePathEnds: Float32Array;
	bounds: Float32Array;
}

export interface CompiledRailDiagnostic {
	code:
		| "INVALID_CELL"
		| "BROKEN_RECIPROCITY"
		| "MISSING_TURNOUT_LEAD"
		| "OVERLAPPING_TURNOUT"
		| AdvancedSwitchCompileDiagnosticCode;
	cell: Cell;
	cells?: readonly Cell[];
	direction?: Direction;
	switchId?: number;
	inputIndex?: 0 | 1;
	outputIndex?: 0 | 1;
	message: string;
}

export interface CompiledPhysicalLayout {
	revision: number;
	paths: CompiledPhysicalPaths;
	compoundProfiles: CompiledCompoundProfiles;
	pathIntervalRemap: CompiledPathIntervalRemap;
	pieces: readonly CompiledRailPiece[];
	junctions: readonly CompiledJunction[];
	turnoutFootprints: CompiledTurnoutFootprints;
	advancedSwitches: CompiledAdvancedSwitches;
	clearance: CompiledRailClearance;
	terminals: readonly Cell[];
	counts: Readonly<Record<CompiledRailPatternType, number>>;
	valid: boolean;
	diagnostics: readonly CompiledRailDiagnostic[];
}

const COMPILED_PHYSICAL_LAYOUT_SOURCES = new WeakMap<CompiledPhysicalLayout, TileMap>();

/** Bind a structured-cloned layout only after its complete Worker fingerprint has been validated. */
export function bindValidatedCompiledPhysicalLayoutSource(
	layout: CompiledPhysicalLayout,
	map: TileMap,
): void {
	if (layout.revision !== map.getRevision()) {
		throw new Error(
			`Compiled physical layout revision ${layout.revision} does not match map revision ${map.getRevision()}.`,
		);
	}
	COMPILED_PHYSICAL_LAYOUT_SOURCES.set(layout, map);
}

/** Reject any layout not compiled from this exact in-process map instance. */
export function compiledPhysicalLayoutHasDifferentSource(
	layout: CompiledPhysicalLayout,
	map: TileMap,
): boolean {
	const source = COMPILED_PHYSICAL_LAYOUT_SOURCES.get(layout);
	return source !== map;
}

export function diagnoseCompiledAdvancedSwitches(
	switches: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
): readonly CompiledRailDiagnostic[] {
	return validateCompiledAdvancedSwitches(switches, paths, remap).map((issue) => {
		const originOffset = Math.max(0, issue.switchIndex) * 2;
		return {
			code: "INVALID_COMPILED_ADVANCED_SWITCH" as const,
			switchId: issue.switchId ?? 0,
			cell: {
				x: switches.origins[originOffset] ?? 0,
				y: switches.origins[originOffset + 1] ?? 0,
			},
			message: `${issue.code}: ${issue.message}`,
		};
	});
}

interface IndexedRail {
	cell: Cell;
	rail: RailCell;
	type: AuthoredRailType;
}

/**
 * Compiles authored 1 m cells into the fixed physical-rail catalog vocabulary.
 * Straight runs are split at 5 m, while adjacent curve pairs become 180 or S pieces.
 */
export function compilePhysicalRail(
	map: TileMap,
	revision = map.getRevision(),
): CompiledPhysicalLayout {
	const advancedSwitchRecords: AdvancedSwitchRecord[] = [];
	map.forEachAdvancedSwitch((switchRecord) => advancedSwitchRecords.push(switchRecord));
	const advancedSwitchIdByJunctionCell = indexAdvancedSwitchJunctions(advancedSwitchRecords);
	const footprints = collectTurnoutFootprints(map);
	const paths = compilePhysicalPaths(map, footprints, revision);
	const advancedSwitchVariants = compileAdvancedSwitchPhysicalVariants(map);
	const advancedSwitchOwnedSourcePaths = collectAdvancedSwitchOwnedSourcePaths(
		advancedSwitchVariants,
		paths,
	);
	const advancedSwitchOwnedCells = new Set(
		advancedSwitchVariants.flatMap((variant) =>
			variant.ownedCells.map((cell) => cellKey(cell.x, cell.y)),
		),
	);
	const ordinaryFootprints = footprints.filter(
		(footprint) => !advancedSwitchIdByJunctionCell.has(cellKey(footprint.cell.x, footprint.cell.y)),
	);
	const pathIndexByCellKind = indexPhysicalPaths(paths);
	const footprintByCell = new Map(
		footprints.map((footprint) => [cellKey(footprint.cell.x, footprint.cell.y), footprint]),
	);
	const index = new Map<string, IndexedRail>();
	map.forEachRail((x, y, rail) => {
		index.set(cellKey(x, y), { cell: { x, y }, rail, type: classifyRailCell(rail) });
	});

	const pieces: CompiledRailPiece[] = [];
	const junctions: CompiledJunction[] = [];
	const terminals: Cell[] = [];
	const diagnostics: CompiledRailDiagnostic[] = [];
	const ordered = [...index.values()].sort(compareIndexedRail);
	for (const issue of validateTurnoutFootprints(
		(x, y) => map.getRail(x, y),
		footprints,
		advancedSwitchRecords,
	)) {
		diagnostics.push({
			code: issue.code === "MISSING_STRAIGHT_LEAD" ? "MISSING_TURNOUT_LEAD" : "OVERLAPPING_TURNOUT",
			cell: issue.cells[0] as Cell,
			cells: issue.cells,
			message: issue.message,
		});
	}

	for (const entry of ordered) {
		const ownedByAdvancedSwitch = advancedSwitchOwnedCells.has(cellKey(entry.cell.x, entry.cell.y));
		if (entry.type === "TERMINAL" && !ownedByAdvancedSwitch) terminals.push(entry.cell);
		if (entry.type === "INVALID" && !ownedByAdvancedSwitch) {
			diagnostics.push({
				code: "INVALID_CELL",
				cell: entry.cell,
				message: "방향 또는 switch 기하가 유효하지 않은 레일 셀입니다",
			});
		}
		if (entry.type === "BRANCH" || entry.type === "MERGE") {
			if (ownedByAdvancedSwitch) continue;
			const footprint = footprintByCell.get(cellKey(entry.cell.x, entry.cell.y));
			const through = findDirectedThroughRoute(entry.rail.incoming, entry.rail.outgoing);
			const tangentSide = tangentJunctionSide(entry.rail.incoming, entry.rail.outgoing);
			const throughMask = through ? through.incoming | through.outgoing : 0;
			const divergingSide = singleDirection(
				(entry.rail.incoming | entry.rail.outgoing) & ~throughMask,
			);
			if (!footprint || !through || !tangentSide || !divergingSide) continue;
			const trunkPathIndex =
				pathIndexByCellKind.get(pathIndexKey(entry.cell, PATH_KIND.TURNOUT_TRUNK)) ?? -1;
			const divergePathIndex =
				pathIndexByCellKind.get(pathIndexKey(entry.cell, PATH_KIND.TURNOUT_DIVERGE)) ?? -1;
			junctions.push({
				id: `${entry.type}:${cellKey(entry.cell.x, entry.cell.y)}`,
				type: entry.type,
				cell: entry.cell,
				incoming: entry.rail.incoming,
				outgoing: entry.rail.outgoing,
				through,
				divergingSide,
				tangentSide,
				profileId: footprint.profileId,
				leadInMillimeters: Math.round(footprint.leadInMeters * 1_000),
				leadOutMillimeters: Math.round(footprint.leadOutMeters * 1_000),
				radiusMillimeters: Math.round(footprint.radiusMeters * 1_000),
				footprintCells: footprint.reservedCells,
				trunkPathIndex,
				divergePathIndex,
				...(advancedSwitchIdByJunctionCell.get(cellKey(entry.cell.x, entry.cell.y)) !== undefined
					? {
							advancedSwitchId: advancedSwitchIdByJunctionCell.get(
								cellKey(entry.cell.x, entry.cell.y),
							),
						}
					: {}),
			});
			appendTurnoutPieces(pieces, paths, footprint, trunkPathIndex, divergePathIndex);
		}
	}
	validateReciprocity(index, diagnostics);

	const physicalLengths = physicalPathLengths(paths);
	const compoundIndex = new Map<string, CompoundRailEntry>();
	for (const [key, entry] of index) {
		if (advancedSwitchOwnedCells.has(key)) continue;
		if (entry.type === "LINEAR" || isCurve(entry.type)) {
			compoundIndex.set(key, { cell: entry.cell, rail: entry.rail, type: entry.type });
		}
	}
	const compoundPatterns = collectCompoundRailPatterns(compoundIndex);
	const consumedCompoundCells = new Set<string>(advancedSwitchOwnedCells);
	for (const pattern of compoundPatterns) {
		for (const cell of pattern.cells) consumedCompoundCells.add(cellKey(cell.x, cell.y));
		pieces.push({
			id: `${pattern.type}:${cellKey(pattern.from.x, pattern.from.y)}`,
			type: pattern.type,
			cells: pattern.cells,
			from: pattern.from,
			to: pattern.to,
			lengthMeters: sumPhysicalLengths(pattern.cells, physicalLengths),
			radiusMillimeters: 500,
			turn: pattern.turn,
		});
	}

	for (const entry of ordered) {
		const key = cellKey(entry.cell.x, entry.cell.y);
		if (!isCurve(entry.type) || consumedCompoundCells.has(key)) continue;
		pieces.push({
			id: `${entry.type}:${key}`,
			type: entry.type,
			cells: [entry.cell],
			from: entry.cell,
			to: entry.cell,
			lengthMeters: physicalLengths.get(key) ?? Math.PI / 4,
			radiusMillimeters: 500,
			turn: entry.type === "LEFT_CURVE" ? "left" : "right",
		});
	}

	const ordinaryStitched = stitchCompoundPhysicalPaths(paths, compoundPatterns);
	const stitched = integrateAdvancedSwitchPhysicalVariants(
		ordinaryStitched,
		advancedSwitchVariants,
		advancedSwitchOwnedSourcePaths,
	);
	compileLinearRuns(
		index,
		ordered,
		pieces,
		physicalPathLengths(stitched.paths),
		consumedCompoundCells,
	);
	applyCompoundProfileMetadata(pieces, stitched.paths, stitched.profiles);
	appendAdvancedSwitchLinearPieces(pieces, stitched.paths);
	for (const junction of junctions) {
		junction.trunkPathIndex = remapPathIndex(
			junction.trunkPathIndex,
			stitched.primaryTargetPathIndices,
		);
		junction.divergePathIndex = remapPathIndex(
			junction.divergePathIndex,
			stitched.primaryTargetPathIndices,
		);
	}
	const advancedSwitchCompilation = compileAdvancedSwitches(
		map,
		stitched.paths,
		stitched.intervalRemap,
	);
	diagnostics.push(...advancedSwitchCompilation.diagnostics);
	for (const switchRecord of advancedSwitchRecords) {
		const expected = new Set([
			`${ADVANCED_SWITCH_SEGMENT_ROLE.INPUT}:0`,
			`${ADVANCED_SWITCH_SEGMENT_ROLE.INPUT}:1`,
			`${ADVANCED_SWITCH_SEGMENT_ROLE.THROAT}:${ADVANCED_SWITCH_NO_PORT}`,
			`${ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT}:0`,
			`${ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT}:1`,
		]);
		const actual = new Set<string>();
		let malformed = false;
		for (let pathIndex = 0; pathIndex < stitched.paths.pathCount; pathIndex++) {
			if ((stitched.paths.advancedSwitchIds[pathIndex] as number) !== switchRecord.id) continue;
			const role = stitched.paths.advancedSwitchSegmentRoles[pathIndex] as number;
			const port = stitched.paths.advancedSwitchSegmentPorts[pathIndex] as number;
			const key = `${role}:${port}`;
			if (
				(stitched.paths.kinds[pathIndex] as number) !== PATH_KIND.ADVANCED_SWITCH_SEGMENT ||
				(stitched.paths.advancedSwitchProfileClasses[pathIndex] as number) !==
					ADVANCED_SWITCH_PROFILE_CLASS_CODE[switchRecord.profileClass] ||
				(stitched.paths.advancedSwitchSegmentOrdinals[pathIndex] as number) !== 0 ||
				!expected.has(key) ||
				actual.has(key)
			) {
				malformed = true;
			}
			actual.add(key);
		}
		if (
			malformed ||
			actual.size !== expected.size ||
			[...expected].some((key) => !actual.has(key))
		) {
			diagnostics.push({
				code: "MISSING_ADVANCED_SWITCH_REMOTE_COMPOUND",
				switchId: switchRecord.id,
				cell: switchRecord.origin,
				message: `advanced switch profile ${switchRecord.profileClass} did not emit its five-path synthetic subgraph`,
			});
		}
	}
	diagnostics.push(
		...diagnoseCompiledAdvancedSwitches(
			advancedSwitchCompilation.switches,
			stitched.paths,
			stitched.intervalRemap,
		),
	);
	for (const switchRecord of advancedSwitchRecords) {
		for (const port of deriveAdvancedSwitchGeometry(switchRecord).ports) {
			const rail = map.getRail(port.cell.x, port.cell.y);
			if (!rail) continue;
			const connected =
				port.role === "input"
					? (rail.incoming & port.direction) !== 0
					: (rail.outgoing & port.direction) !== 0;
			if (!connected) terminals.push(port.cell);
		}
	}
	pieces.sort(comparePieces);
	junctions.sort((left, right) => left.cell.y - right.cell.y || left.cell.x - right.cell.x);
	terminals.sort(compareCells);

	const counts: Record<CompiledRailPatternType, number> = {
		LINEAR: 0,
		LEFT_CURVE: 0,
		RIGHT_CURVE: 0,
		CCW_CURVE: 0,
		S_CURVE: 0,
		CSC_CURVE_HOMO: 0,
		CSC_CURVE_HETE: 0,
	};
	for (const piece of pieces) counts[piece.type]++;
	const turnoutFootprints = compileTurnoutFootprintSoA(
		ordinaryFootprints,
		junctions,
		stitched.paths,
	);
	const clearance = compileRailClearance(
		stitched.paths,
		turnoutFootprints,
		advancedSwitchCompilation.switches,
	);
	const layout: CompiledPhysicalLayout = {
		revision,
		paths: stitched.paths,
		compoundProfiles: stitched.profiles,
		pathIntervalRemap: stitched.intervalRemap,
		pieces,
		junctions,
		turnoutFootprints,
		advancedSwitches: advancedSwitchCompilation.switches,
		clearance,
		terminals,
		counts,
		valid: diagnostics.length === 0,
		diagnostics,
	};
	COMPILED_PHYSICAL_LAYOUT_SOURCES.set(layout, map);
	return layout;
}

function indexAdvancedSwitchJunctions(
	switches: readonly AdvancedSwitchRecord[],
): Map<string, number> {
	const result = new Map<string, number>();
	for (const switchRecord of switches) {
		const geometry = deriveAdvancedSwitchGeometry(switchRecord);
		result.set(cellKey(geometry.mergeAnchor.x, geometry.mergeAnchor.y), switchRecord.id);
		result.set(cellKey(geometry.branchAnchor.x, geometry.branchAnchor.y), switchRecord.id);
	}
	return result;
}

function remapPathIndex(pathIndex: number, oldToNewPathIndices: Uint32Array): number {
	if (pathIndex < 0) return -1;
	const target = oldToNewPathIndices[pathIndex] as number;
	return target === 0xffff_ffff ? -1 : target;
}

function applyCompoundProfileMetadata(
	pieces: CompiledRailPiece[],
	paths: CompiledPhysicalPaths,
	profiles: CompiledCompoundProfiles,
): void {
	const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
	for (let profileIndex = 0; profileIndex < profiles.count; profileIndex++) {
		const pathIndex = profiles.pathIndices[profileIndex] as number;
		const pathOffset = pathIndex * 2;
		const type = compoundProfileTypeName(profiles.types[profileIndex] as number);
		const advancedSwitchId = profiles.advancedSwitchIds[profileIndex] as number;
		const id =
			advancedSwitchId === 0
				? `${type}:${cellKey(
						paths.cells[pathOffset] as number,
						paths.cells[pathOffset + 1] as number,
					)}`
				: advancedSwitchPieceId(paths, pathIndex);
		let piece = pieceById.get(id);
		if (!piece) {
			const coverageStart = paths.coverageOffsets[pathIndex] as number;
			const coverageEnd = paths.coverageOffsets[pathIndex + 1] as number;
			const cells: Cell[] = [];
			for (let row = coverageStart; row < coverageEnd; row++) {
				cells.push({
					x: paths.coverageCells[row * 2] as number,
					y: paths.coverageCells[row * 2 + 1] as number,
				});
			}
			piece = {
				id,
				type,
				cells,
				from: {
					x: paths.cells[pathOffset] as number,
					y: paths.cells[pathOffset + 1] as number,
				},
				to: {
					x: paths.exitCells[pathOffset] as number,
					y: paths.exitCells[pathOffset + 1] as number,
				},
				lengthMeters: paths.lengths[pathIndex] as number,
				radiusMillimeters: null,
				turn: (profiles.lateralSideSigns[profileIndex] as number) < 0 ? "left" : "right",
			};
			pieces.push(piece);
			pieceById.set(id, piece);
		}
		const nominalProfileIndex = profiles.nominalProfileIndices[profileIndex] as number;
		const nominal =
			nominalProfileIndex >= 0 ? OPENFAB_COMPOUND_PROFILE_CATALOG[nominalProfileIndex] : undefined;
		piece.lengthMeters = paths.lengths[pathIndex] as number;
		piece.physicalPathIndex = pathIndex;
		if (advancedSwitchId !== 0) applyAdvancedSwitchPieceIdentity(piece, paths, pathIndex);
		piece.geometryKind = compoundGeometryKindName(profiles.geometryKinds[profileIndex] as number);
		piece.fitKind = compoundProfileFitName(profiles.fitKinds[profileIndex] as number);
		piece.nominalProfileId = nominal?.id;
		piece.nominalLengthMeters = nominal ? nominal.lengthMillimeters / 1_000 : undefined;
		if (piece.geometryKind === "OPENFAB_PARAMETRIC") {
			piece.radiusMillimeters = profiles.compiledRadiusMillimeters[profileIndex] as number;
			piece.rotationDegrees = (profiles.compiledTurnAngleTenths[profileIndex] as number) / 10;
			piece.leadInMillimeters = profiles.compiledLeadInMillimeters[profileIndex] as number;
			piece.leadOutMillimeters = profiles.compiledLeadOutMillimeters[profileIndex] as number;
			piece.middleMillimeters = profiles.compiledMiddleMillimeters[profileIndex] as number;
			piece.leadInResidualMillimeters = profiles.leadInResidualMillimeters[profileIndex] as number;
			piece.leadOutResidualMillimeters = profiles.leadOutResidualMillimeters[
				profileIndex
			] as number;
			piece.middleResidualMillimeters = profiles.middleResidualMillimeters[profileIndex] as number;
			piece.lengthResidualMillimeters = profiles.lengthResidualMillimeters[profileIndex] as number;
			piece.forwardFitDeltaMillimeters = profiles.forwardFitDeltaMillimeters[
				profileIndex
			] as number;
			piece.lateralFitDeltaMillimeters = profiles.lateralFitDeltaMillimeters[
				profileIndex
			] as number;
		} else {
			piece.radiusMillimeters = null;
			piece.rotationDegrees = undefined;
			piece.leadInMillimeters = undefined;
			piece.leadOutMillimeters = undefined;
			piece.middleMillimeters = undefined;
			piece.leadInResidualMillimeters = undefined;
			piece.leadOutResidualMillimeters = undefined;
			piece.middleResidualMillimeters = undefined;
			piece.lengthResidualMillimeters = undefined;
			piece.forwardFitDeltaMillimeters = undefined;
			piece.lateralFitDeltaMillimeters = undefined;
		}
	}
}

function appendAdvancedSwitchLinearPieces(
	pieces: CompiledRailPiece[],
	paths: CompiledPhysicalPaths,
): void {
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const switchId = paths.advancedSwitchIds[pathIndex] as number;
		if (switchId === 0) continue;
		const profile = advancedSwitchPhysicalProfile(
			paths.advancedSwitchCatalogProfiles[pathIndex] as number,
		);
		if (profile.kind !== "LINEAR") continue;
		const coverageStart = paths.coverageOffsets[pathIndex] as number;
		const coverageEnd = paths.coverageOffsets[pathIndex + 1] as number;
		const cells: Cell[] = [];
		for (let row = coverageStart; row < coverageEnd; row++) {
			cells.push({
				x: paths.coverageCells[row * 2] as number,
				y: paths.coverageCells[row * 2 + 1] as number,
			});
		}
		const piece: CompiledRailPiece = {
			id: advancedSwitchPieceId(paths, pathIndex),
			type: "LINEAR",
			cells,
			from: {
				x: paths.cells[pathIndex * 2] as number,
				y: paths.cells[pathIndex * 2 + 1] as number,
			},
			to: {
				x: paths.exitCells[pathIndex * 2] as number,
				y: paths.exitCells[pathIndex * 2 + 1] as number,
			},
			lengthMeters: paths.lengths[pathIndex] as number,
			radiusMillimeters: null,
			geometryKind: "OPENFAB_PARAMETRIC",
			fitKind: "MAP_EXACT",
			nominalProfileId: profile.id,
			nominalLengthMeters: paths.lengths[pathIndex] as number,
			leadInResidualMillimeters: 0,
			leadOutResidualMillimeters: 0,
			middleResidualMillimeters: 0,
			lengthResidualMillimeters: 0,
			forwardFitDeltaMillimeters: 0,
			lateralFitDeltaMillimeters: 0,
			physicalPathIndex: pathIndex,
		};
		applyAdvancedSwitchPieceIdentity(piece, paths, pathIndex);
		pieces.push(piece);
	}
}

function advancedSwitchPieceId(paths: CompiledPhysicalPaths, pathIndex: number): string {
	return [
		"ADVANCED_SWITCH",
		paths.advancedSwitchIds[pathIndex] as number,
		paths.advancedSwitchProfileClasses[pathIndex] as number,
		paths.advancedSwitchSegmentRoles[pathIndex] as number,
		paths.advancedSwitchSegmentPorts[pathIndex] as number,
		paths.advancedSwitchSegmentOrdinals[pathIndex] as number,
	].join(":");
}

function applyAdvancedSwitchPieceIdentity(
	piece: CompiledRailPiece,
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	piece.advancedSwitchId = paths.advancedSwitchIds[pathIndex] as number;
	piece.advancedSwitchProfileClass = paths.advancedSwitchProfileClasses[pathIndex] as number;
	piece.advancedSwitchSegmentRole = paths.advancedSwitchSegmentRoles[pathIndex] as number;
	piece.advancedSwitchPortIndex = paths.advancedSwitchSegmentPorts[pathIndex] as number;
	piece.advancedSwitchSegmentOrdinal = paths.advancedSwitchSegmentOrdinals[pathIndex] as number;
}

function compoundProfileTypeName(type: number): CompoundRailPattern["type"] {
	if (type === COMPOUND_PROFILE_TYPE.RIGHT_CURVE) return "RIGHT_CURVE";
	if (type === COMPOUND_PROFILE_TYPE.CCW_CURVE) return "CCW_CURVE";
	if (type === COMPOUND_PROFILE_TYPE.S_CURVE) return "S_CURVE";
	if (type === COMPOUND_PROFILE_TYPE.CSC_CURVE_HOMO) return "CSC_CURVE_HOMO";
	return "CSC_CURVE_HETE";
}

function compoundProfileFitName(fit: number): "NOT_APPLICABLE" | "MAP_EXACT" | "GRID_FIT" {
	if (fit === COMPOUND_PROFILE_FIT.MAP_EXACT) return "MAP_EXACT";
	if (fit === COMPOUND_PROFILE_FIT.GRID_FIT) return "GRID_FIT";
	return "NOT_APPLICABLE";
}

function compoundGeometryKindName(kind: number): "BASELINE_STITCHED" | "OPENFAB_PARAMETRIC" {
	if (kind === COMPOUND_GEOMETRY_KIND.OPENFAB_PARAMETRIC) return "OPENFAB_PARAMETRIC";
	return "BASELINE_STITCHED";
}

function validateReciprocity(
	index: ReadonlyMap<string, IndexedRail>,
	diagnostics: CompiledRailDiagnostic[],
): void {
	for (const entry of index.values()) {
		for (const direction of ALL_DIRECTIONS) {
			const opposite = oppositeDirection(direction);
			const neighborCell = moveCell(entry.cell, direction);
			const neighbor = index.get(cellKey(neighborCell.x, neighborCell.y));
			if (
				(entry.rail.outgoing & direction) !== 0 &&
				(!neighbor || (neighbor.rail.incoming & opposite) === 0)
			) {
				diagnostics.push({
					code: "BROKEN_RECIPROCITY",
					cell: entry.cell,
					direction,
					message: "출발 포트와 이웃의 진입 포트가 연결되지 않았습니다",
				});
			}
			if (
				(entry.rail.incoming & direction) !== 0 &&
				(!neighbor || (neighbor.rail.outgoing & opposite) === 0)
			) {
				diagnostics.push({
					code: "BROKEN_RECIPROCITY",
					cell: entry.cell,
					direction,
					message: "진입 포트와 이웃의 출발 포트가 연결되지 않았습니다",
				});
			}
		}
	}
}

function compileLinearRuns(
	index: Map<string, IndexedRail>,
	ordered: readonly IndexedRail[],
	pieces: CompiledRailPiece[],
	physicalLengths: ReadonlyMap<string, number>,
	consumedCompoundCells: ReadonlySet<string>,
): void {
	const visited = new Set<string>();
	const starts = ordered.filter(
		(entry) =>
			entry.type === "LINEAR" &&
			!consumedCompoundCells.has(cellKey(entry.cell.x, entry.cell.y)) &&
			!hasLinearPredecessor(index, entry),
	);
	for (const start of starts) {
		compileLinearChain(index, start, visited, pieces, physicalLengths, consumedCompoundCells);
	}
	for (const entry of ordered) {
		const key = cellKey(entry.cell.x, entry.cell.y);
		if (entry.type === "LINEAR" && !consumedCompoundCells.has(key) && !visited.has(key)) {
			compileLinearChain(index, entry, visited, pieces, physicalLengths, consumedCompoundCells);
		}
	}
}

function compileLinearChain(
	index: Map<string, IndexedRail>,
	start: IndexedRail,
	visited: Set<string>,
	pieces: CompiledRailPiece[],
	physicalLengths: ReadonlyMap<string, number>,
	consumedCompoundCells: ReadonlySet<string>,
): void {
	let current: IndexedRail | undefined = start;
	while (
		current &&
		current.type === "LINEAR" &&
		!consumedCompoundCells.has(cellKey(current.cell.x, current.cell.y)) &&
		!visited.has(cellKey(current.cell.x, current.cell.y))
	) {
		const cells: Cell[] = [];
		let lengthMeters = 0;
		const direction = singleDirection(current.rail.outgoing);
		if (!direction) return;
		while (
			current &&
			current.type === "LINEAR" &&
			!consumedCompoundCells.has(cellKey(current.cell.x, current.cell.y)) &&
			!visited.has(cellKey(current.cell.x, current.cell.y)) &&
			singleDirection(current.rail.outgoing) === direction
		) {
			const currentLength = physicalLengths.get(cellKey(current.cell.x, current.cell.y)) ?? 1;
			if (currentLength <= Number.EPSILON) {
				visited.add(cellKey(current.cell.x, current.cell.y));
				const nextCell = moveCell(current.cell, direction);
				const next = index.get(cellKey(nextCell.x, nextCell.y));
				current =
					next && (next.rail.incoming & oppositeDirection(direction)) !== 0 ? next : undefined;
				continue;
			}
			if (cells.length > 0 && lengthMeters + currentLength > 5) break;
			cells.push(current.cell);
			lengthMeters += currentLength;
			visited.add(cellKey(current.cell.x, current.cell.y));
			const nextCell = moveCell(current.cell, direction);
			const next = index.get(cellKey(nextCell.x, nextCell.y));
			if (!next || (next.rail.incoming & oppositeDirection(direction)) === 0) {
				current = undefined;
				break;
			}
			current = next;
		}
		if (cells.length > 0) {
			pieces.push({
				id: `LINEAR:${cellKey(cells[0]?.x ?? 0, cells[0]?.y ?? 0)}`,
				type: "LINEAR",
				cells,
				from: cells[0] as Cell,
				to: cells.at(-1) as Cell,
				lengthMeters,
				radiusMillimeters: null,
			});
		}
	}
}

function physicalPathLengths(paths: CompiledPhysicalPaths): Map<string, number> {
	const lengths = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const kind = paths.kinds[pathIndex] as number;
		if (kind !== PATH_KIND.LINEAR && kind !== PATH_KIND.CURVE) continue;
		const cellOffset = pathIndex * 2;
		lengths.set(
			cellKey(paths.cells[cellOffset] as number, paths.cells[cellOffset + 1] as number),
			paths.lengths[pathIndex] as number,
		);
	}
	return lengths;
}

function sumPhysicalLengths(
	cells: readonly Cell[],
	physicalLengths: ReadonlyMap<string, number>,
): number {
	let lengthMeters = 0;
	for (const cell of cells) {
		lengthMeters += physicalLengths.get(cellKey(cell.x, cell.y)) ?? 0;
	}
	return lengthMeters;
}

function indexPhysicalPaths(paths: CompiledPhysicalPaths): Map<string, number> {
	const index = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const cellOffset = pathIndex * 2;
		const cell = {
			x: paths.cells[cellOffset] as number,
			y: paths.cells[cellOffset + 1] as number,
		};
		index.set(pathIndexKey(cell, paths.kinds[pathIndex] as number), pathIndex);
	}
	return index;
}

function pathIndexKey(cell: Cell, kind: number): string {
	return `${cellKey(cell.x, cell.y)}:${kind}`;
}

function appendTurnoutPieces(
	pieces: CompiledRailPiece[],
	paths: CompiledPhysicalPaths,
	footprint: TurnoutFootprint,
	trunkPathIndex: number,
	divergePathIndex: number,
): void {
	if (trunkPathIndex >= 0) {
		const cells = pathCoverage(paths, trunkPathIndex);
		pieces.push({
			id: `TURNOUT_TRUNK:${cellKey(footprint.cell.x, footprint.cell.y)}`,
			type: "LINEAR",
			cells,
			from: cells[0] ?? footprint.cell,
			to: cells.at(-1) ?? footprint.cell,
			lengthMeters: paths.lengths[trunkPathIndex] as number,
			radiusMillimeters: null,
			role: "TURNOUT_TRUNK",
		});
	}

	if (divergePathIndex < 0) return;
	const cells = pathCoverage(paths, divergePathIndex);
	const curveType = classifyRailCell({
		incoming: footprint.curveFrom,
		outgoing: footprint.curveTo,
	});
	const type = curveType === "LEFT_CURVE" ? "LEFT_CURVE" : "RIGHT_CURVE";
	pieces.push({
		id: `TURNOUT_DIVERGE:${cellKey(footprint.cell.x, footprint.cell.y)}`,
		type,
		cells,
		from: cells[0] ?? footprint.cell,
		to: cells.at(-1) ?? footprint.cell,
		lengthMeters: paths.lengths[divergePathIndex] as number,
		radiusMillimeters: Math.round(footprint.radiusMeters * 1_000),
		turn: type === "LEFT_CURVE" ? "left" : "right",
		role: "TURNOUT_DIVERGE",
	});
}

function pathCoverage(paths: CompiledPhysicalPaths, pathIndex: number): Cell[] {
	if (pathIndex < 0 || pathIndex >= paths.pathCount) return [];
	const start = paths.coverageOffsets[pathIndex] as number;
	const end = paths.coverageOffsets[pathIndex + 1] as number;
	const cells: Cell[] = [];
	for (let coverageIndex = start; coverageIndex < end; coverageIndex++) {
		const cellOffset = coverageIndex * 2;
		cells.push({
			x: paths.coverageCells[cellOffset] as number,
			y: paths.coverageCells[cellOffset + 1] as number,
		});
	}
	return cells;
}

function compileTurnoutFootprintSoA(
	footprints: readonly TurnoutFootprint[],
	junctions: readonly CompiledJunction[],
	paths: CompiledPhysicalPaths,
): CompiledTurnoutFootprints {
	const junctionByCell = new Map(
		junctions.map((junction) => [cellKey(junction.cell.x, junction.cell.y), junction]),
	);
	const kinds = new Uint8Array(footprints.length);
	const anchors = new Int32Array(footprints.length * 2);
	const leadInMillimeters = new Uint16Array(footprints.length);
	const leadOutMillimeters = new Uint16Array(footprints.length);
	const radiusMillimeters = new Uint16Array(footprints.length);
	const reservedOffsets = new Uint32Array(footprints.length + 1);
	const pathOffsets = new Uint32Array(footprints.length + 1);
	const clearancePathOffsets = new Uint32Array(footprints.length + 1);
	const bounds = new Float32Array(footprints.length * 4);
	const allReservedCells: number[] = [];
	const allPathIndices: number[] = [];
	const allClearancePathIndices: number[] = [];
	const allClearancePathStarts: number[] = [];
	const allClearancePathEnds: number[] = [];

	for (let footprintIndex = 0; footprintIndex < footprints.length; footprintIndex++) {
		const footprint = footprints[footprintIndex] as TurnoutFootprint;
		const junction = junctionByCell.get(cellKey(footprint.cell.x, footprint.cell.y));
		kinds[footprintIndex] = footprint.kind;
		anchors[footprintIndex * 2] = footprint.cell.x;
		anchors[footprintIndex * 2 + 1] = footprint.cell.y;
		leadInMillimeters[footprintIndex] = Math.round(footprint.leadInMeters * 1_000);
		leadOutMillimeters[footprintIndex] = Math.round(footprint.leadOutMeters * 1_000);
		radiusMillimeters[footprintIndex] = Math.round(footprint.radiusMeters * 1_000);
		reservedOffsets[footprintIndex] = allReservedCells.length / 2;
		for (const cell of footprint.reservedCells) allReservedCells.push(cell.x, cell.y);
		pathOffsets[footprintIndex] = allPathIndices.length;
		const footprintPathIndices = [
			junction?.trunkPathIndex ?? -1,
			junction?.divergePathIndex ?? -1,
		].filter((pathIndex) => pathIndex >= 0 && pathIndex < paths.pathCount);
		allPathIndices.push(...footprintPathIndices);
		clearancePathOffsets[footprintIndex] = allClearancePathIndices.length;
		if (junction) {
			for (const interval of deriveTurnoutClearancePathIntervals(junction, paths)) {
				allClearancePathIndices.push(interval.pathIndex);
				allClearancePathStarts.push(interval.start);
				allClearancePathEnds.push(interval.end);
			}
		}
		writePathUnionBounds(bounds, footprintIndex, paths, footprintPathIndices, footprint.cell);
	}
	reservedOffsets[footprints.length] = allReservedCells.length / 2;
	pathOffsets[footprints.length] = allPathIndices.length;
	clearancePathOffsets[footprints.length] = allClearancePathIndices.length;

	return {
		count: footprints.length,
		kinds,
		anchors,
		leadInMillimeters,
		leadOutMillimeters,
		radiusMillimeters,
		reservedOffsets,
		reservedCells: new Int32Array(allReservedCells),
		pathOffsets,
		pathIndices: new Uint32Array(allPathIndices),
		clearancePathOffsets,
		clearancePathIndices: new Uint32Array(allClearancePathIndices),
		clearancePathStarts: new Float32Array(allClearancePathStarts),
		clearancePathEnds: new Float32Array(allClearancePathEnds),
		bounds,
	};
}

function writePathUnionBounds(
	target: Float32Array,
	footprintIndex: number,
	paths: CompiledPhysicalPaths,
	pathIndices: readonly number[],
	fallbackCell: Cell,
): void {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const pathIndex of pathIndices) {
		const offset = pathIndex * 4;
		minX = Math.min(minX, paths.bounds[offset] as number);
		minY = Math.min(minY, paths.bounds[offset + 1] as number);
		maxX = Math.max(maxX, paths.bounds[offset + 2] as number);
		maxY = Math.max(maxY, paths.bounds[offset + 3] as number);
	}
	if (pathIndices.length === 0) {
		minX = fallbackCell.x + 0.5;
		minY = fallbackCell.y + 0.5;
		maxX = minX;
		maxY = minY;
	}
	target.set([minX, minY, maxX, maxY], footprintIndex * 4);
}

function hasLinearPredecessor(index: Map<string, IndexedRail>, entry: IndexedRail): boolean {
	const incoming = singleDirection(entry.rail.incoming);
	const outgoing = singleDirection(entry.rail.outgoing);
	if (!incoming || !outgoing) return false;
	const previousCell = moveCell(entry.cell, incoming);
	const previous = index.get(cellKey(previousCell.x, previousCell.y));
	return (
		previous?.type === "LINEAR" &&
		singleDirection(previous.rail.outgoing) === outgoing &&
		(previous.rail.outgoing & oppositeDirection(incoming)) !== 0
	);
}

function isCurve(type: AuthoredRailType): type is "LEFT_CURVE" | "RIGHT_CURVE" {
	return type === "LEFT_CURVE" || type === "RIGHT_CURVE";
}

function singleDirection(mask: number): Direction | null {
	if (bitCount(mask) !== 1) return null;
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function compareIndexedRail(left: IndexedRail, right: IndexedRail): number {
	return compareCells(left.cell, right.cell);
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function comparePieces(left: CompiledRailPiece, right: CompiledRailPiece): number {
	return compareCells(left.from, right.from) || left.type.localeCompare(right.type);
}
