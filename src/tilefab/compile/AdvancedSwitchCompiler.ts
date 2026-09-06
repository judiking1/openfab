import {
	ADVANCED_SWITCH_SHARED_TRUNK_PROFILE,
	type AdvancedSwitchBoundaryPort,
	type AdvancedSwitchPortIndex,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	advancedSwitchAllowsMovement,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
	validateAdvancedSwitchTopology,
} from "../core/AdvancedSwitch";
import { type Cell, cellKey, TileMap } from "../core/TileMap";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_SEGMENT_ROLE,
} from "./AdvancedSwitchPhysicalVariant";
import { type CompiledPathIntervalRemap, PATH_INTERVAL_MAPPING_KIND } from "./CompoundPhysicalPath";
import { type CompiledPhysicalPaths, PATH_KIND, samplePhysicalPath } from "./PhysicalPathCompiler";
import { buildPhysicalPathAdjacency, type PhysicalPathAdjacency } from "./PhysicalPathFlow";

export const COMPILED_ADVANCED_SWITCH_PROFILE = {
	A: 0,
	B: 1,
	C: 2,
	D: 3,
} as const;

export const ADVANCED_SWITCH_PORT_ROLE = {
	INPUT: 0,
	OUTPUT: 1,
} as const;

export const ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND = {
	MERGE_SHARED: 0,
	CENTER_THROAT: 1,
	BRANCH_SHARED: 2,
} as const;

export const NO_ADVANCED_SWITCH_PATH = 0xffff_ffff;

const SWITCH_PORT_COUNT = 4;
const SWITCH_MOVEMENT_COUNT = 4;
const STATION_EPSILON = 1e-4;

/**
 * Simulation-facing SoA for project-owned 2-in/2-out switch modules.
 *
 * Port order is input 0, input 1, output 0, output 1. Movement rows are ordered by
 * input index and then output index. Movement path rows are clipped intervals in final
 * physical-path station space; they never imply ownership outside the module boundary.
 */
export interface CompiledAdvancedSwitches {
	count: number;
	ids: Uint32Array;
	profileClasses: Uint8Array;
	origins: Int32Array;
	forwardDirections: Uint8Array;
	lateralDirections: Uint8Array;
	movementMasks: Uint8Array;
	portOffsets: Uint32Array;
	portRoles: Uint8Array;
	portLocalIndices: Uint8Array;
	portCells: Int32Array;
	portDirections: Uint8Array;
	portPathIndices: Uint32Array;
	portPathStations: Float32Array;
	movementOffsets: Uint32Array;
	movementInputIndices: Uint8Array;
	movementOutputIndices: Uint8Array;
	movementPathOffsets: Uint32Array;
	movementPathIndices: Uint32Array;
	movementPathStarts: Float32Array;
	movementPathEnds: Float32Array;
	movementConflictOffsets: Uint32Array;
	movementConflictIntervalIndices: Uint32Array;
	claimedOffsets: Uint32Array;
	claimedCells: Int32Array;
	reservedOffsets: Uint32Array;
	reservedCells: Int32Array;
	mergeAnchors: Int32Array;
	branchAnchors: Int32Array;
	sharedThroatCells: Int32Array;
	sharedThroatLengthsMeters: Float32Array;
	sharedSupportLengthsMeters: Float32Array;
	mergeSharedLeadMeters: Float32Array;
	clearTrunkMeters: Float32Array;
	branchSharedLeadMeters: Float32Array;
	conflictZoneIds: Uint32Array;
	conflictZoneLengthsMeters: Float32Array;
	conflictPathOffsets: Uint32Array;
	conflictPathIndices: Uint32Array;
	conflictPathStarts: Float32Array;
	conflictPathEnds: Float32Array;
	conflictIntervalKinds: Uint8Array;
	/** Input/output alternative within its interval kind; center rows use zero. */
	conflictRouteIndices: Uint8Array;
	conflictBounds: Float32Array;
	bounds: Float32Array;
}

export type AdvancedSwitchCompileDiagnosticCode =
	| "INVALID_ADVANCED_SWITCH_TOPOLOGY"
	| "MISSING_ADVANCED_SWITCH_PORT_PATH"
	| "MISSING_ADVANCED_SWITCH_REMOTE_COMPOUND"
	| "MISSING_ADVANCED_SWITCH_MOVEMENT"
	| "INVALID_ADVANCED_SWITCH_SHARED_THROAT"
	| "INVALID_COMPILED_ADVANCED_SWITCH";

export interface AdvancedSwitchCompileDiagnostic {
	code: AdvancedSwitchCompileDiagnosticCode;
	switchId: number;
	cell: Cell;
	cells?: readonly Cell[];
	inputIndex?: AdvancedSwitchPortIndex;
	outputIndex?: AdvancedSwitchPortIndex;
	message: string;
}

export interface CompiledAdvancedSwitchResult {
	switches: CompiledAdvancedSwitches;
	diagnostics: readonly AdvancedSwitchCompileDiagnostic[];
}

interface ResolvedPort {
	port: AdvancedSwitchBoundaryPort;
	pathIndex: number;
	station: number;
}

interface MappedPathInterval {
	pathIndex: number;
	start: number;
	end: number;
}

interface ConflictRows {
	merge: readonly [readonly number[], readonly number[]];
	center: readonly number[];
	branch: readonly [readonly number[], readonly number[]];
}

export interface AdvancedSwitchCompileObserver {
	onBuildGlobalAuxiliaryIndex(kind: "adjacency" | "raw-path" | "coverage"): void;
}

export type CompiledAdvancedSwitchStructuralIssueCode =
	| "INVALID_FIXED_LENGTH"
	| "INVALID_CSR"
	| "INVALID_IDENTITY"
	| "INVALID_PORT"
	| "INVALID_MOVEMENT"
	| "INVALID_PATH_INTERVAL"
	| "DISCONNECTED_MOVEMENT"
	| "INVALID_CONFLICT_OWNERSHIP"
	| "INVALID_FOOTPRINT"
	| "INVALID_BOUNDS";

export interface CompiledAdvancedSwitchStructuralIssue {
	code: CompiledAdvancedSwitchStructuralIssueCode;
	switchIndex: number;
	switchId: number | null;
	message: string;
}

/** Compile switch sidecar identity onto the final stitched physical-path graph. */
export function compileAdvancedSwitches(
	map: TileMap,
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
	observer?: AdvancedSwitchCompileObserver,
): CompiledAdvancedSwitchResult {
	const records: AdvancedSwitchRecord[] = [];
	map.forEachAdvancedSwitch((switchRecord) => records.push(switchRecord));
	if (records.length === 0) {
		return { switches: emptyCompiledAdvancedSwitches(), diagnostics: [] };
	}

	observer?.onBuildGlobalAuxiliaryIndex("adjacency");
	const adjacency = buildPhysicalPathAdjacency(paths);
	observer?.onBuildGlobalAuxiliaryIndex("raw-path");
	const { rawPathsByCell, syntheticSourcePaths } = indexSourcePaths(remap);
	observer?.onBuildGlobalAuxiliaryIndex("coverage");
	const finalPathsByCoverageCell = indexFinalPathsByCoverageCell(paths);

	const ids: number[] = [];
	const profileClasses: number[] = [];
	const origins: number[] = [];
	const forwardDirections: number[] = [];
	const lateralDirections: number[] = [];
	const movementMasks: number[] = [];
	const portOffsets: number[] = [];
	const portRoles: number[] = [];
	const portLocalIndices: number[] = [];
	const portCells: number[] = [];
	const portDirections: number[] = [];
	const portPathIndices: number[] = [];
	const portPathStations: number[] = [];
	const movementOffsets: number[] = [];
	const movementInputIndices: number[] = [];
	const movementOutputIndices: number[] = [];
	const movementPathOffsets: number[] = [0];
	const movementPathIndices: number[] = [];
	const movementPathStarts: number[] = [];
	const movementPathEnds: number[] = [];
	const movementConflictOffsets: number[] = [0];
	const movementConflictIntervalIndices: number[] = [];
	const claimedOffsets: number[] = [];
	const claimedCells: number[] = [];
	const reservedOffsets: number[] = [];
	const reservedCells: number[] = [];
	const mergeAnchors: number[] = [];
	const branchAnchors: number[] = [];
	const sharedThroatCells: number[] = [];
	const sharedThroatLengthsMeters: number[] = [];
	const sharedSupportLengthsMeters: number[] = [];
	const mergeSharedLeadMeters: number[] = [];
	const clearTrunkMeters: number[] = [];
	const branchSharedLeadMeters: number[] = [];
	const conflictZoneIds: number[] = [];
	const conflictZoneLengthsMeters: number[] = [];
	const conflictPathOffsets: number[] = [];
	const conflictPathIndices: number[] = [];
	const conflictPathStarts: number[] = [];
	const conflictPathEnds: number[] = [];
	const conflictIntervalKinds: number[] = [];
	const conflictRouteIndices: number[] = [];
	const conflictBounds: number[] = [];
	const bounds: number[] = [];
	const diagnostics: AdvancedSwitchCompileDiagnostic[] = [];

	for (const switchRecord of records) {
		const geometry = deriveAdvancedSwitchGeometry(switchRecord);
		ids.push(switchRecord.id);
		profileClasses.push(encodeProfileClass(switchRecord.profileClass));
		origins.push(switchRecord.origin.x, switchRecord.origin.y);
		forwardDirections.push(switchRecord.forward);
		lateralDirections.push(switchRecord.lateral);
		movementMasks.push(switchRecord.movementMask);
		mergeAnchors.push(geometry.mergeAnchor.x, geometry.mergeAnchor.y);
		branchAnchors.push(geometry.branchAnchor.x, geometry.branchAnchor.y);
		sharedThroatCells.push(geometry.sharedTrunkSupport.x, geometry.sharedTrunkSupport.y);
		sharedSupportLengthsMeters.push(ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters);
		mergeSharedLeadMeters.push(ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters);
		clearTrunkMeters.push(ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters);
		branchSharedLeadMeters.push(ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters);

		for (const issue of validateAdvancedSwitchTopology(
			(x, y) => map.getEncoded(x, y),
			switchRecord,
		)) {
			diagnostics.push({
				code: "INVALID_ADVANCED_SWITCH_TOPOLOGY",
				switchId: switchRecord.id,
				cell: issue.cells[0] ?? switchRecord.origin,
				cells: issue.cells,
				message: issue.message,
			});
		}

		portOffsets.push(portRoles.length);
		const resolvedPorts: ResolvedPort[] = [];
		for (const port of geometry.ports) {
			const resolved = resolveBoundaryPort(
				switchRecord.id,
				port,
				paths,
				remap,
				syntheticSourcePaths,
			);
			resolvedPorts.push({ port, ...resolved });
			portRoles.push(
				port.role === "input" ? ADVANCED_SWITCH_PORT_ROLE.INPUT : ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
			);
			portLocalIndices.push(port.index);
			portCells.push(port.cell.x, port.cell.y);
			portDirections.push(port.direction);
			portPathIndices.push(resolved.pathIndex);
			portPathStations.push(resolved.station);
			if (resolved.pathIndex === NO_ADVANCED_SWITCH_PATH) {
				diagnostics.push({
					code: "MISSING_ADVANCED_SWITCH_PORT_PATH",
					switchId: switchRecord.id,
					cell: port.cell,
					...(port.role === "input" ? { inputIndex: port.index } : { outputIndex: port.index }),
					message: `advanced switch ${port.role} ${port.index} cannot be mapped to a final physical-path station`,
				});
			}
		}

		claimedOffsets.push(claimedCells.length / 2);
		for (const cell of geometry.claimedCells) claimedCells.push(cell.x, cell.y);
		reservedOffsets.push(reservedCells.length / 2);
		for (const cell of geometry.reservedCells) reservedCells.push(cell.x, cell.y);

		const allowedPaths = collectClaimedPathIndices(
			geometry.claimedCells,
			paths,
			remap,
			rawPathsByCell,
			finalPathsByCoverageCell,
		);
		for (const port of resolvedPorts) {
			if (port.pathIndex !== NO_ADVANCED_SWITCH_PATH) allowedPaths.add(port.pathIndex);
		}

		conflictPathOffsets.push(conflictPathIndices.length);
		const conflictRows = compileConflictRows(
			switchRecord,
			paths,
			remap,
			syntheticSourcePaths,
			conflictPathIndices,
			conflictPathStarts,
			conflictPathEnds,
			conflictIntervalKinds,
			conflictRouteIndices,
		);
		const switchConflictStart = conflictPathOffsets.at(-1) as number;
		const switchConflictEnd = conflictPathIndices.length;
		const centerLength = sumIntervalLengths(
			conflictRows.center,
			conflictPathStarts,
			conflictPathEnds,
		);
		sharedThroatLengthsMeters.push(centerLength);
		conflictZoneIds.push(switchRecord.id);
		conflictZoneLengthsMeters.push(ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters);
		writeIntervalUnionBounds(
			conflictBounds,
			paths,
			conflictPathIndices,
			conflictPathStarts,
			conflictPathEnds,
			switchConflictStart,
			switchConflictEnd,
			geometry.sharedTrunkSupport,
		);
		if (!conflictRowsAreComplete(conflictRows, conflictPathStarts, conflictPathEnds)) {
			diagnostics.push({
				code: "INVALID_ADVANCED_SWITCH_SHARED_THROAT",
				switchId: switchRecord.id,
				cell: geometry.sharedTrunkSupport,
				message:
					"advanced switch hardware ownership must map merge 400 mm, center 200 mm, and branch 400 mm intervals",
			});
		}

		movementOffsets.push(movementInputIndices.length);
		const movementIntervalStart = movementPathIndices.length;
		for (const inputIndex of [0, 1] as const) {
			for (const outputIndex of [0, 1] as const) {
				if (!advancedSwitchAllowsMovement(switchRecord, inputIndex, outputIndex)) continue;
				movementInputIndices.push(inputIndex);
				movementOutputIndices.push(outputIndex);
				const input = resolvedPorts[inputIndex];
				const output = resolvedPorts[2 + outputIndex];
				const sequence =
					!input ||
					!output ||
					input.pathIndex === NO_ADVANCED_SWITCH_PATH ||
					output.pathIndex === NO_ADVANCED_SWITCH_PATH
						? null
						: findDirectedPathSequence(input.pathIndex, output.pathIndex, allowedPaths, adjacency);
				if (!sequence || !input || !output) {
					diagnostics.push({
						code: "MISSING_ADVANCED_SWITCH_MOVEMENT",
						switchId: switchRecord.id,
						cell: geometry.sharedTrunkSupport,
						inputIndex,
						outputIndex,
						message: `advanced switch movement ${inputIndex}->${outputIndex} has no connected physical-path sequence`,
					});
				} else {
					appendClippedMovementIntervals(
						sequence,
						input,
						output,
						paths,
						movementPathIndices,
						movementPathStarts,
						movementPathEnds,
					);
				}
				movementPathOffsets.push(movementPathIndices.length);

				movementConflictIntervalIndices.push(
					...conflictRows.merge[inputIndex],
					...conflictRows.center,
					...conflictRows.branch[outputIndex],
				);
				movementConflictOffsets.push(movementConflictIntervalIndices.length);
			}
		}
		writeIntervalUnionBounds(
			bounds,
			paths,
			movementPathIndices,
			movementPathStarts,
			movementPathEnds,
			movementIntervalStart,
			movementPathIndices.length,
			switchRecord.origin,
		);
	}

	portOffsets.push(portRoles.length);
	movementOffsets.push(movementInputIndices.length);
	claimedOffsets.push(claimedCells.length / 2);
	reservedOffsets.push(reservedCells.length / 2);
	conflictPathOffsets.push(conflictPathIndices.length);

	return {
		switches: {
			count: records.length,
			ids: new Uint32Array(ids),
			profileClasses: new Uint8Array(profileClasses),
			origins: new Int32Array(origins),
			forwardDirections: new Uint8Array(forwardDirections),
			lateralDirections: new Uint8Array(lateralDirections),
			movementMasks: new Uint8Array(movementMasks),
			portOffsets: new Uint32Array(portOffsets),
			portRoles: new Uint8Array(portRoles),
			portLocalIndices: new Uint8Array(portLocalIndices),
			portCells: new Int32Array(portCells),
			portDirections: new Uint8Array(portDirections),
			portPathIndices: new Uint32Array(portPathIndices),
			portPathStations: new Float32Array(portPathStations),
			movementOffsets: new Uint32Array(movementOffsets),
			movementInputIndices: new Uint8Array(movementInputIndices),
			movementOutputIndices: new Uint8Array(movementOutputIndices),
			movementPathOffsets: new Uint32Array(movementPathOffsets),
			movementPathIndices: new Uint32Array(movementPathIndices),
			movementPathStarts: new Float32Array(movementPathStarts),
			movementPathEnds: new Float32Array(movementPathEnds),
			movementConflictOffsets: new Uint32Array(movementConflictOffsets),
			movementConflictIntervalIndices: new Uint32Array(movementConflictIntervalIndices),
			claimedOffsets: new Uint32Array(claimedOffsets),
			claimedCells: new Int32Array(claimedCells),
			reservedOffsets: new Uint32Array(reservedOffsets),
			reservedCells: new Int32Array(reservedCells),
			mergeAnchors: new Int32Array(mergeAnchors),
			branchAnchors: new Int32Array(branchAnchors),
			sharedThroatCells: new Int32Array(sharedThroatCells),
			sharedThroatLengthsMeters: new Float32Array(sharedThroatLengthsMeters),
			sharedSupportLengthsMeters: new Float32Array(sharedSupportLengthsMeters),
			mergeSharedLeadMeters: new Float32Array(mergeSharedLeadMeters),
			clearTrunkMeters: new Float32Array(clearTrunkMeters),
			branchSharedLeadMeters: new Float32Array(branchSharedLeadMeters),
			conflictZoneIds: new Uint32Array(conflictZoneIds),
			conflictZoneLengthsMeters: new Float32Array(conflictZoneLengthsMeters),
			conflictPathOffsets: new Uint32Array(conflictPathOffsets),
			conflictPathIndices: new Uint32Array(conflictPathIndices),
			conflictPathStarts: new Float32Array(conflictPathStarts),
			conflictPathEnds: new Float32Array(conflictPathEnds),
			conflictIntervalKinds: new Uint8Array(conflictIntervalKinds),
			conflictRouteIndices: new Uint8Array(conflictRouteIndices),
			conflictBounds: new Float32Array(conflictBounds),
			bounds: new Float32Array(bounds),
		},
		diagnostics,
	};
}

/**
 * Validate every structural invariant required before switch rows can be mirrored to workers.
 * The validator is deliberately non-throwing so corrupt persisted or migrated layouts latch a
 * physical-layout diagnostic instead of escaping into rendering/simulation consumers.
 */
export function validateCompiledAdvancedSwitches(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
): readonly CompiledAdvancedSwitchStructuralIssue[] {
	const issues: CompiledAdvancedSwitchStructuralIssue[] = [];
	const add = (
		code: CompiledAdvancedSwitchStructuralIssueCode,
		switchIndex: number,
		message: string,
	): void => {
		issues.push({
			code,
			switchIndex,
			switchId:
				switchIndex >= 0 && switchIndex < compiled.ids.length
					? (compiled.ids[switchIndex] as number)
					: null,
			message,
		});
	};
	const fixedLengths: readonly [string, ArrayLike<number>, number][] = [
		["ids", compiled.ids, compiled.count],
		["profileClasses", compiled.profileClasses, compiled.count],
		["origins", compiled.origins, compiled.count * 2],
		["forwardDirections", compiled.forwardDirections, compiled.count],
		["lateralDirections", compiled.lateralDirections, compiled.count],
		["movementMasks", compiled.movementMasks, compiled.count],
		["mergeAnchors", compiled.mergeAnchors, compiled.count * 2],
		["branchAnchors", compiled.branchAnchors, compiled.count * 2],
		["sharedThroatCells", compiled.sharedThroatCells, compiled.count * 2],
		["sharedThroatLengthsMeters", compiled.sharedThroatLengthsMeters, compiled.count],
		["sharedSupportLengthsMeters", compiled.sharedSupportLengthsMeters, compiled.count],
		["mergeSharedLeadMeters", compiled.mergeSharedLeadMeters, compiled.count],
		["clearTrunkMeters", compiled.clearTrunkMeters, compiled.count],
		["branchSharedLeadMeters", compiled.branchSharedLeadMeters, compiled.count],
		["conflictZoneIds", compiled.conflictZoneIds, compiled.count],
		["conflictZoneLengthsMeters", compiled.conflictZoneLengthsMeters, compiled.count],
		["conflictBounds", compiled.conflictBounds, compiled.count * 4],
		["bounds", compiled.bounds, compiled.count * 4],
	];
	let fixedLengthsValid = true;
	for (const [name, values, expected] of fixedLengths) {
		if (values.length !== expected) {
			fixedLengthsValid = false;
			add("INVALID_FIXED_LENGTH", -1, `${name} length ${values.length} must equal ${expected}`);
		}
	}
	if (!Number.isInteger(compiled.count) || compiled.count < 0) {
		add("INVALID_FIXED_LENGTH", -1, "count must be a non-negative integer");
		return issues;
	}

	const portCsrValid = validateCsr(
		compiled.portOffsets,
		compiled.count,
		compiled.portRoles.length,
		"portOffsets",
		add,
	);
	const movementCsrValid = validateCsr(
		compiled.movementOffsets,
		compiled.count,
		compiled.movementInputIndices.length,
		"movementOffsets",
		add,
	);
	const claimedCsrValid = validateCsr(
		compiled.claimedOffsets,
		compiled.count,
		compiled.claimedCells.length / 2,
		"claimedOffsets",
		add,
	);
	const reservedCsrValid = validateCsr(
		compiled.reservedOffsets,
		compiled.count,
		compiled.reservedCells.length / 2,
		"reservedOffsets",
		add,
	);
	const conflictCsrValid = validateCsr(
		compiled.conflictPathOffsets,
		compiled.count,
		compiled.conflictPathIndices.length,
		"conflictPathOffsets",
		add,
	);
	const movementCount = compiled.movementInputIndices.length;
	const movementPathCsrValid = validateCsr(
		compiled.movementPathOffsets,
		movementCount,
		compiled.movementPathIndices.length,
		"movementPathOffsets",
		add,
	);
	const movementConflictCsrValid = validateCsr(
		compiled.movementConflictOffsets,
		movementCount,
		compiled.movementConflictIntervalIndices.length,
		"movementConflictOffsets",
		add,
	);

	for (const [name, length] of [
		["portLocalIndices", compiled.portLocalIndices.length],
		["portDirections", compiled.portDirections.length],
		["portPathIndices", compiled.portPathIndices.length],
		["portPathStations", compiled.portPathStations.length],
	] as const) {
		if (length !== compiled.portRoles.length) {
			add("INVALID_FIXED_LENGTH", -1, `${name} must match port row count`);
		}
	}
	if (compiled.portCells.length !== compiled.portRoles.length * 2) {
		add("INVALID_FIXED_LENGTH", -1, "portCells must contain one x/y pair per port");
	}
	if (compiled.movementOutputIndices.length !== movementCount) {
		add("INVALID_FIXED_LENGTH", -1, "movement input/output row counts must match");
	}
	for (const [name, length] of [
		["movementPathStarts", compiled.movementPathStarts.length],
		["movementPathEnds", compiled.movementPathEnds.length],
	] as const) {
		if (length !== compiled.movementPathIndices.length) {
			add("INVALID_FIXED_LENGTH", -1, `${name} must match movement path interval rows`);
		}
	}
	for (const [name, length] of [
		["conflictPathStarts", compiled.conflictPathStarts.length],
		["conflictPathEnds", compiled.conflictPathEnds.length],
		["conflictIntervalKinds", compiled.conflictIntervalKinds.length],
		["conflictRouteIndices", compiled.conflictRouteIndices.length],
	] as const) {
		if (length !== compiled.conflictPathIndices.length) {
			add("INVALID_FIXED_LENGTH", -1, `${name} must match conflict interval rows`);
		}
	}
	if (compiled.claimedCells.length % 2 !== 0 || compiled.reservedCells.length % 2 !== 0) {
		add("INVALID_FOOTPRINT", -1, "claimed/reserved cell arrays must contain x/y pairs");
	}
	if (compiled.count === 0) return issues;

	let adjacency: PhysicalPathAdjacency;
	try {
		adjacency = buildPhysicalPathAdjacency(paths);
	} catch (error) {
		add(
			"INVALID_PATH_INTERVAL",
			-1,
			error instanceof Error ? error.message : "physical path adjacency is malformed",
		);
		return issues;
	}
	const globallyClaimed = new Map<string, number>();
	for (let switchIndex = 0; switchIndex < compiled.count; switchIndex++) {
		if (compiled.conflictZoneIds[switchIndex] !== compiled.ids[switchIndex]) {
			add("INVALID_CONFLICT_OWNERSHIP", switchIndex, "conflict zone identity must match switch id");
		}
		if (
			!approximately(
				compiled.sharedSupportLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters,
			) ||
			!approximately(
				compiled.conflictZoneLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters,
			)
		) {
			add("INVALID_CONFLICT_OWNERSHIP", switchIndex, "switch hardware zone must own 1.0 m");
		}
		if (
			!approximately(
				compiled.mergeSharedLeadMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			) ||
			!approximately(
				compiled.clearTrunkMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
			) ||
			!approximately(
				compiled.branchSharedLeadMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			) ||
			!approximately(
				compiled.sharedThroatLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
			)
		) {
			add(
				"INVALID_CONFLICT_OWNERSHIP",
				switchIndex,
				"switch throat metadata must retain the OpenFab 400 mm + 200 mm + 400 mm dimensions",
			);
		}

		if (portCsrValid) validateSwitchPorts(compiled, paths, switchIndex, add);
		if (movementCsrValid && movementPathCsrValid && movementConflictCsrValid) {
			validateSwitchMovements(compiled, paths, adjacency, switchIndex, add);
		}
		if (conflictCsrValid) validateSwitchConflicts(compiled, paths, switchIndex, add);
		if (claimedCsrValid && reservedCsrValid) {
			validateSwitchFootprint(compiled, switchIndex, globallyClaimed, add);
		}
	}
	if (
		fixedLengthsValid &&
		portCsrValid &&
		movementCsrValid &&
		claimedCsrValid &&
		reservedCsrValid &&
		conflictCsrValid &&
		movementPathCsrValid &&
		movementConflictCsrValid
	) {
		validateSemanticSwitchLayout(compiled, paths, remap, add);
	}
	return issues;
}

export function emptyCompiledAdvancedSwitches(): CompiledAdvancedSwitches {
	return {
		count: 0,
		ids: new Uint32Array(),
		profileClasses: new Uint8Array(),
		origins: new Int32Array(),
		forwardDirections: new Uint8Array(),
		lateralDirections: new Uint8Array(),
		movementMasks: new Uint8Array(),
		portOffsets: new Uint32Array([0]),
		portRoles: new Uint8Array(),
		portLocalIndices: new Uint8Array(),
		portCells: new Int32Array(),
		portDirections: new Uint8Array(),
		portPathIndices: new Uint32Array(),
		portPathStations: new Float32Array(),
		movementOffsets: new Uint32Array([0]),
		movementInputIndices: new Uint8Array(),
		movementOutputIndices: new Uint8Array(),
		movementPathOffsets: new Uint32Array([0]),
		movementPathIndices: new Uint32Array(),
		movementPathStarts: new Float32Array(),
		movementPathEnds: new Float32Array(),
		movementConflictOffsets: new Uint32Array([0]),
		movementConflictIntervalIndices: new Uint32Array(),
		claimedOffsets: new Uint32Array([0]),
		claimedCells: new Int32Array(),
		reservedOffsets: new Uint32Array([0]),
		reservedCells: new Int32Array(),
		mergeAnchors: new Int32Array(),
		branchAnchors: new Int32Array(),
		sharedThroatCells: new Int32Array(),
		sharedThroatLengthsMeters: new Float32Array(),
		sharedSupportLengthsMeters: new Float32Array(),
		mergeSharedLeadMeters: new Float32Array(),
		clearTrunkMeters: new Float32Array(),
		branchSharedLeadMeters: new Float32Array(),
		conflictZoneIds: new Uint32Array(),
		conflictZoneLengthsMeters: new Float32Array(),
		conflictPathOffsets: new Uint32Array([0]),
		conflictPathIndices: new Uint32Array(),
		conflictPathStarts: new Float32Array(),
		conflictPathEnds: new Float32Array(),
		conflictIntervalKinds: new Uint8Array(),
		conflictRouteIndices: new Uint8Array(),
		conflictBounds: new Float32Array(),
		bounds: new Float32Array(),
	};
}

function encodeProfileClass(profileClass: AdvancedSwitchProfileClass): number {
	return COMPILED_ADVANCED_SWITCH_PROFILE[profileClass];
}

type SyntheticSourcePathIndex = ReadonlyMap<string, number>;

function indexSourcePaths(remap: CompiledPathIntervalRemap): {
	rawPathsByCell: Map<string, number[]>;
	syntheticSourcePaths: SyntheticSourcePathIndex;
} {
	const rawPathsByCell = new Map<string, number[]>();
	const syntheticSourcePaths = new Map<string, number>();
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		const offset = sourcePathIndex * 2;
		const key = cellKey(
			remap.sourcePathCells[offset] as number,
			remap.sourcePathCells[offset + 1] as number,
		);
		const pathIndices = rawPathsByCell.get(key);
		if (pathIndices) pathIndices.push(sourcePathIndex);
		else rawPathsByCell.set(key, [sourcePathIndex]);

		const switchId = remap.sourceAdvancedSwitchIds[sourcePathIndex] as number;
		if (switchId <= 0 || remap.sourceAdvancedSwitchSegmentOrdinals[sourcePathIndex] !== 0) continue;
		const identity = syntheticSourcePathKey(
			switchId,
			remap.sourceAdvancedSwitchRoles[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchPorts[sourcePathIndex] as number,
		);
		// Ambiguous identities stay unresolved even if a third matching row appears.
		syntheticSourcePaths.set(identity, syntheticSourcePaths.has(identity) ? -1 : sourcePathIndex);
	}
	return { rawPathsByCell, syntheticSourcePaths };
}

function resolveBoundaryPort(
	switchId: number,
	port: AdvancedSwitchBoundaryPort,
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
	syntheticSourcePaths: SyntheticSourcePathIndex,
): { pathIndex: number; station: number } {
	const synthetic = findSyntheticSourcePath(
		syntheticSourcePaths,
		switchId,
		port.role === "input"
			? ADVANCED_SWITCH_SEGMENT_ROLE.INPUT
			: ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
		port.index,
	);
	if (synthetic < 0) return missingResolvedPath();
	const station = port.role === "input" ? 0 : (remap.sourcePathLengths[synthetic] as number);
	const mapped = mapSourceStation(remap, synthetic, station, port.role === "output");
	if (
		!mapped ||
		mapped.pathIndex >= paths.pathCount ||
		(paths.kinds[mapped.pathIndex] as number) === PATH_KIND.INVALID
	) {
		return missingResolvedPath();
	}
	return mapped;
}

function missingResolvedPath(): { pathIndex: number; station: number } {
	return { pathIndex: NO_ADVANCED_SWITCH_PATH, station: Number.NaN };
}

function mapSourceStation(
	remap: CompiledPathIntervalRemap,
	sourcePathIndex: number,
	sourceStation: number,
	preferEnd: boolean,
): { pathIndex: number; station: number } | null {
	const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
	const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
	const orderedRows: number[] = [];
	for (let row = rowStart; row < rowEnd; row++) orderedRows.push(row);
	if (preferEnd) orderedRows.reverse();
	for (const row of orderedRows) {
		if ((remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) continue;
		const sourceStart = remap.sourceStarts[row] as number;
		const sourceEnd = remap.sourceEnds[row] as number;
		if (
			sourceStation < sourceStart - STATION_EPSILON ||
			sourceStation > sourceEnd + STATION_EPSILON
		) {
			continue;
		}
		const amount =
			sourceEnd - sourceStart <= STATION_EPSILON
				? 0
				: Math.max(0, Math.min(1, (sourceStation - sourceStart) / (sourceEnd - sourceStart)));
		const targetStart = remap.targetStarts[row] as number;
		const targetEnd = remap.targetEnds[row] as number;
		return {
			pathIndex: remap.targetPathIndices[row] as number,
			station: targetStart + (targetEnd - targetStart) * amount,
		};
	}
	return null;
}

function mapSourceInterval(
	remap: CompiledPathIntervalRemap,
	sourcePathIndex: number,
	sourceStart: number,
	sourceEnd: number,
): MappedPathInterval[] {
	const result: MappedPathInterval[] = [];
	const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
	const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
	for (let row = rowStart; row < rowEnd; row++) {
		if ((remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) continue;
		const rowSourceStart = remap.sourceStarts[row] as number;
		const rowSourceEnd = remap.sourceEnds[row] as number;
		const overlapStart = Math.max(sourceStart, rowSourceStart);
		const overlapEnd = Math.min(sourceEnd, rowSourceEnd);
		if (overlapEnd - overlapStart <= STATION_EPSILON) continue;
		const rowLength = rowSourceEnd - rowSourceStart;
		if (rowLength <= STATION_EPSILON) continue;
		const targetStart = remap.targetStarts[row] as number;
		const targetEnd = remap.targetEnds[row] as number;
		const mappedStart =
			targetStart + (targetEnd - targetStart) * ((overlapStart - rowSourceStart) / rowLength);
		const mappedEnd =
			targetStart + (targetEnd - targetStart) * ((overlapEnd - rowSourceStart) / rowLength);
		if (mappedEnd - mappedStart <= STATION_EPSILON) continue;
		result.push({
			pathIndex: remap.targetPathIndices[row] as number,
			start: mappedStart,
			end: mappedEnd,
		});
	}
	return result;
}

function collectClaimedPathIndices(
	claimedCells: readonly Cell[],
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
	rawPathsByCell: ReadonlyMap<string, readonly number[]>,
	finalPathsByCoverageCell: ReadonlyMap<string, readonly number[]>,
): Set<number> {
	const result = new Set<number>();
	for (const cell of claimedCells) {
		const key = cellKey(cell.x, cell.y);
		for (const sourcePathIndex of rawPathsByCell.get(key) ?? []) {
			const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
			const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
			for (let row = rowStart; row < rowEnd; row++) {
				if ((remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) continue;
				const target = remap.targetPathIndices[row] as number;
				if (target < paths.pathCount && (paths.kinds[target] as number) !== PATH_KIND.INVALID) {
					result.add(target);
				}
			}
		}
		for (const pathIndex of finalPathsByCoverageCell.get(key) ?? []) result.add(pathIndex);
	}
	return result;
}

function indexFinalPathsByCoverageCell(paths: CompiledPhysicalPaths): Map<string, number[]> {
	const result = new Map<string, number[]>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const start = paths.coverageOffsets[pathIndex] as number;
		const end = paths.coverageOffsets[pathIndex + 1] as number;
		for (let coverageIndex = start; coverageIndex < end; coverageIndex++) {
			const offset = coverageIndex * 2;
			const key = cellKey(
				paths.coverageCells[offset] as number,
				paths.coverageCells[offset + 1] as number,
			);
			const indices = result.get(key);
			if (indices) indices.push(pathIndex);
			else result.set(key, [pathIndex]);
		}
	}
	return result;
}

function findDirectedPathSequence(
	startPath: number,
	endPath: number,
	allowedPaths: ReadonlySet<number>,
	adjacency: PhysicalPathAdjacency,
): number[] | null {
	if (!allowedPaths.has(startPath) || !allowedPaths.has(endPath)) return null;
	const parents = new Map<number, number>([[startPath, -1]]);
	const queue = [startPath];
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const pathIndex = queue[cursor] as number;
		if (pathIndex === endPath) break;
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let index = start; index < end; index++) {
			const target = adjacency.targets[index] as number;
			if (!allowedPaths.has(target) || parents.has(target)) continue;
			parents.set(target, pathIndex);
			queue.push(target);
		}
	}
	if (!parents.has(endPath)) return null;
	const reversed: number[] = [];
	for (let current = endPath; current >= 0; current = parents.get(current) as number) {
		reversed.push(current);
	}
	return reversed.reverse();
}

function appendClippedMovementIntervals(
	sequence: readonly number[],
	input: ResolvedPort,
	output: ResolvedPort,
	paths: CompiledPhysicalPaths,
	pathIndices: number[],
	starts: number[],
	ends: number[],
): void {
	for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex++) {
		const pathIndex = sequence[sequenceIndex] as number;
		const pathLength = paths.lengths[pathIndex] as number;
		const start = sequenceIndex === 0 ? input.station : 0;
		const end = sequenceIndex === sequence.length - 1 ? output.station : pathLength;
		const clippedStart = Math.max(0, Math.min(pathLength, start));
		const clippedEnd = Math.max(clippedStart, Math.min(pathLength, end));
		pathIndices.push(pathIndex);
		starts.push(clippedStart);
		ends.push(clippedEnd);
	}
}

function compileConflictRows(
	switchRecord: AdvancedSwitchRecord,
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
	syntheticSourcePaths: SyntheticSourcePathIndex,
	pathIndices: number[],
	starts: number[],
	ends: number[],
	kinds: number[],
	routeIndices: number[],
): ConflictRows {
	const syntheticMerge = ([0, 1] as const).map((portIndex) =>
		findSyntheticSourcePath(
			syntheticSourcePaths,
			switchRecord.id,
			ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
			portIndex,
		),
	) as [number, number];
	const syntheticCenter = findSyntheticSourcePath(
		syntheticSourcePaths,
		switchRecord.id,
		ADVANCED_SWITCH_SEGMENT_ROLE.THROAT,
		ADVANCED_SWITCH_NO_PORT,
	);
	const syntheticBranch = ([0, 1] as const).map((portIndex) =>
		findSyntheticSourcePath(
			syntheticSourcePaths,
			switchRecord.id,
			ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
			portIndex,
		),
	) as [number, number];
	return appendConflictRows(
		remap,
		paths,
		syntheticMerge,
		syntheticCenter,
		syntheticBranch,
		pathIndices,
		starts,
		ends,
		kinds,
		routeIndices,
	);
}

function appendConflictRows(
	remap: CompiledPathIntervalRemap,
	paths: CompiledPhysicalPaths,
	mergeSources: readonly [number, number],
	centerSource: number,
	branchSources: readonly [number, number],
	pathIndices: number[],
	starts: number[],
	ends: number[],
	kinds: number[],
	routeIndices: number[],
): ConflictRows {
	const merge = mergeSources.map((sourcePathIndex, routeIndex) =>
		appendMappedConflictInterval(
			remap,
			paths,
			sourcePathIndex,
			"end",
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED,
			routeIndex,
			pathIndices,
			starts,
			ends,
			kinds,
			routeIndices,
		),
	) as [number[], number[]];
	const center = appendMappedConflictInterval(
		remap,
		paths,
		centerSource,
		"all",
		ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
		ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT,
		0,
		pathIndices,
		starts,
		ends,
		kinds,
		routeIndices,
	);
	const branch = branchSources.map((sourcePathIndex, routeIndex) =>
		appendMappedConflictInterval(
			remap,
			paths,
			sourcePathIndex,
			"start",
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED,
			routeIndex,
			pathIndices,
			starts,
			ends,
			kinds,
			routeIndices,
		),
	) as [number[], number[]];
	return { merge, center, branch };
}

function findSyntheticSourcePath(
	index: SyntheticSourcePathIndex,
	switchId: number,
	role: number,
	port: number,
): number {
	return index.get(syntheticSourcePathKey(switchId, role, port)) ?? -1;
}

function syntheticSourcePathKey(switchId: number, role: number, port: number): string {
	return `${switchId}:${role}:${port}`;
}

function appendMappedConflictInterval(
	remap: CompiledPathIntervalRemap,
	paths: CompiledPhysicalPaths,
	sourcePathIndex: number,
	edge: "start" | "end" | "all",
	lengthMeters: number,
	kind: number,
	routeIndex: number,
	pathIndices: number[],
	starts: number[],
	ends: number[],
	kinds: number[],
	routeIndices: number[],
): number[] {
	if (sourcePathIndex < 0 || sourcePathIndex >= remap.sourcePathCount) return [];
	const sourceLength = remap.sourcePathLengths[sourcePathIndex] as number;
	const sourceStart = edge === "end" ? Math.max(0, sourceLength - lengthMeters) : 0;
	const sourceEnd = edge === "start" ? Math.min(sourceLength, lengthMeters) : sourceLength;
	const result: number[] = [];
	for (const mapped of mapSourceInterval(remap, sourcePathIndex, sourceStart, sourceEnd)) {
		if (
			mapped.pathIndex >= paths.pathCount ||
			(paths.kinds[mapped.pathIndex] as number) === PATH_KIND.INVALID
		) {
			continue;
		}
		result.push(pathIndices.length);
		pathIndices.push(mapped.pathIndex);
		starts.push(mapped.start);
		ends.push(mapped.end);
		kinds.push(kind);
		routeIndices.push(routeIndex);
	}
	return result;
}

function conflictRowsAreComplete(
	rows: ConflictRows,
	starts: readonly number[],
	ends: readonly number[],
): boolean {
	const expected = ADVANCED_SWITCH_SHARED_TRUNK_PROFILE;
	return (
		rows.merge.every(
			(indices) =>
				Math.abs(sumIntervalLengths(indices, starts, ends) - expected.mergeSharedLeadMeters) <=
				STATION_EPSILON,
		) &&
		Math.abs(sumIntervalLengths(rows.center, starts, ends) - expected.clearTrunkMeters) <=
			STATION_EPSILON &&
		rows.branch.every(
			(indices) =>
				Math.abs(sumIntervalLengths(indices, starts, ends) - expected.branchSharedLeadMeters) <=
				STATION_EPSILON,
		)
	);
}

function sumIntervalLengths(
	indices: readonly number[],
	starts: readonly number[],
	ends: readonly number[],
): number {
	let result = 0;
	for (const index of indices) result += (ends[index] as number) - (starts[index] as number);
	return result;
}

function writeIntervalUnionBounds(
	target: number[],
	paths: CompiledPhysicalPaths,
	pathIndices: readonly number[],
	starts: readonly number[],
	ends: readonly number[],
	rowStart: number,
	rowEnd: number,
	fallbackCell: Cell,
): void {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const include = (x: number, y: number): void => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	};
	for (let row = rowStart; row < rowEnd; row++) {
		const pathIndex = pathIndices[row] as number;
		const start = starts[row] as number;
		const end = ends[row] as number;
		const startSample = samplePhysicalPath(paths, pathIndex, start);
		const endSample = samplePhysicalPath(paths, pathIndex, end);
		if (startSample) include(startSample.x, startSample.y);
		const pointStart = paths.offsets[pathIndex] as number;
		const pointEnd = paths.offsets[pathIndex + 1] as number;
		for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex++) {
			const station = paths.distances[pointIndex] as number;
			if (station <= start || station >= end) continue;
			include(
				paths.positions[pointIndex * 2] as number,
				paths.positions[pointIndex * 2 + 1] as number,
			);
		}
		if (endSample) include(endSample.x, endSample.y);
	}
	if (rowStart >= rowEnd || !Number.isFinite(minX)) {
		minX = fallbackCell.x + 0.5;
		minY = fallbackCell.y + 0.5;
		maxX = minX;
		maxY = minY;
	}
	target.push(minX, minY, maxX, maxY);
}

type StructuralIssueAppender = (
	code: CompiledAdvancedSwitchStructuralIssueCode,
	switchIndex: number,
	message: string,
) => void;

function validateCsr(
	offsets: ArrayLike<number>,
	rowCount: number,
	terminal: number,
	name: string,
	add: StructuralIssueAppender,
): boolean {
	if (offsets.length !== rowCount + 1) {
		add("INVALID_CSR", -1, `${name} must contain ${rowCount + 1} offsets`);
		return false;
	}
	let previous = -1;
	for (let index = 0; index < offsets.length; index++) {
		const value = offsets[index] as number;
		if (!Number.isInteger(value) || value < 0 || value < previous) {
			add("INVALID_CSR", -1, `${name} must be finite, integer, and monotonic`);
			return false;
		}
		previous = value;
	}
	if ((offsets[0] as number) !== 0 || (offsets[offsets.length - 1] as number) !== terminal) {
		add("INVALID_CSR", -1, `${name} must start at zero and terminate at ${terminal}`);
		return false;
	}
	return true;
}

function validateSemanticSwitchLayout(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	remap: CompiledPathIntervalRemap,
	add: StructuralIssueAppender,
): void {
	// This private reconstruction retains claim checks without copying prior maps per record.
	const semanticHydrator = TileMap.createHydrator();
	const semanticCells = new Map<string, number>();
	const ids = new Set<number>();
	let recordsValid = true;
	for (let switchIndex = 0; switchIndex < compiled.count; switchIndex++) {
		const profileClass = decodeProfileClass(compiled.profileClasses[switchIndex] as number);
		const record: AdvancedSwitchRecord | null = profileClass
			? {
					id: compiled.ids[switchIndex] as number,
					profileClass,
					origin: {
						x: compiled.origins[switchIndex * 2] as number,
						y: compiled.origins[switchIndex * 2 + 1] as number,
					},
					forward: compiled.forwardDirections[switchIndex] as AdvancedSwitchRecord["forward"],
					lateral: compiled.lateralDirections[switchIndex] as AdvancedSwitchRecord["lateral"],
					movementMask: compiled.movementMasks[switchIndex] as number,
				}
			: null;
		const recordError = record ? advancedSwitchRecordError(record) : "unknown profile class code";
		if (!record || recordError || ids.has(record.id)) {
			add(
				"INVALID_IDENTITY",
				switchIndex,
				recordError ?? `advanced switch id ${record?.id ?? 0} is duplicated`,
			);
			recordsValid = false;
			continue;
		}
		ids.add(record.id);
		try {
			const geometry = deriveAdvancedSwitchGeometry(record);
			for (const cell of geometry.cellStates) {
				const key = cellKey(cell.x, cell.y);
				const before = semanticCells.get(key) ?? 0;
				if (before !== 0 && before !== cell.encoded) {
					throw new Error(`switch ${record.id} overlaps incompatible rail at ${cell.x},${cell.y}`);
				}
				if (before === 0) {
					semanticHydrator.addEncodedCell(cell.x, cell.y, cell.encoded);
					semanticCells.set(key, cell.encoded);
				}
			}
			semanticHydrator.addAdvancedSwitch(record);
		} catch (error) {
			add(
				"INVALID_FOOTPRINT",
				switchIndex,
				error instanceof Error
					? error.message
					: "advanced switch footprint cannot be reconstructed",
			);
			recordsValid = false;
		}
	}
	if (!recordsValid) return;

	const semanticMap = semanticHydrator.finish(0);

	const expectedResult = compileAdvancedSwitches(semanticMap, paths, remap);
	if (expectedResult.diagnostics.length > 0) {
		add(
			"INVALID_IDENTITY",
			-1,
			`compiled switch records cannot reproduce a coherent layout: ${expectedResult.diagnostics
				.map((diagnostic) => diagnostic.code)
				.join(", ")}`,
		);
		return;
	}
	const expected = expectedResult.switches;
	const groups: readonly {
		code: CompiledAdvancedSwitchStructuralIssueCode;
		fields: readonly (keyof CompiledAdvancedSwitches)[];
	}[] = [
		{
			code: "INVALID_IDENTITY",
			fields: [
				"ids",
				"profileClasses",
				"origins",
				"forwardDirections",
				"lateralDirections",
				"movementMasks",
				"mergeAnchors",
				"branchAnchors",
				"sharedThroatCells",
			],
		},
		{
			code: "INVALID_PORT",
			fields: [
				"portOffsets",
				"portRoles",
				"portLocalIndices",
				"portCells",
				"portDirections",
				"portPathIndices",
				"portPathStations",
			],
		},
		{
			code: "INVALID_MOVEMENT",
			fields: [
				"movementOffsets",
				"movementInputIndices",
				"movementOutputIndices",
				"movementPathOffsets",
				"movementPathIndices",
				"movementPathStarts",
				"movementPathEnds",
			],
		},
		{
			code: "INVALID_CONFLICT_OWNERSHIP",
			fields: [
				"movementConflictOffsets",
				"movementConflictIntervalIndices",
				"sharedThroatLengthsMeters",
				"sharedSupportLengthsMeters",
				"mergeSharedLeadMeters",
				"clearTrunkMeters",
				"branchSharedLeadMeters",
				"conflictZoneIds",
				"conflictZoneLengthsMeters",
				"conflictPathOffsets",
				"conflictPathIndices",
				"conflictPathStarts",
				"conflictPathEnds",
				"conflictIntervalKinds",
				"conflictRouteIndices",
			],
		},
		{
			code: "INVALID_FOOTPRINT",
			fields: ["claimedOffsets", "claimedCells", "reservedOffsets", "reservedCells"],
		},
		{ code: "INVALID_BOUNDS", fields: ["conflictBounds", "bounds"] },
	];
	for (const group of groups) {
		for (const field of group.fields) {
			const actualValues = compiled[field];
			const expectedValues = expected[field];
			if (
				typeof actualValues === "number" ||
				typeof expectedValues === "number" ||
				!numericBuffersEqual(actualValues, expectedValues)
			) {
				add(
					group.code,
					-1,
					`${String(field)} does not match the geometry derived from switch records`,
				);
			}
		}
	}
}

function numericBuffersEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		const leftValue = left[index] as number;
		const rightValue = right[index] as number;
		if (!Number.isFinite(leftValue) || Math.abs(leftValue - rightValue) > 1e-6) return false;
	}
	return true;
}

function decodeProfileClass(value: number): AdvancedSwitchProfileClass | null {
	if (value === COMPILED_ADVANCED_SWITCH_PROFILE.A) return "A";
	if (value === COMPILED_ADVANCED_SWITCH_PROFILE.B) return "B";
	if (value === COMPILED_ADVANCED_SWITCH_PROFILE.C) return "C";
	if (value === COMPILED_ADVANCED_SWITCH_PROFILE.D) return "D";
	return null;
}

function validateSwitchPorts(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	switchIndex: number,
	add: StructuralIssueAppender,
): void {
	const start = compiled.portOffsets[switchIndex] as number;
	const end = compiled.portOffsets[switchIndex + 1] as number;
	if (end - start !== SWITCH_PORT_COUNT) {
		add("INVALID_PORT", switchIndex, "each advanced switch must publish exactly four ports");
		return;
	}
	const expectedRoles = [
		ADVANCED_SWITCH_PORT_ROLE.INPUT,
		ADVANCED_SWITCH_PORT_ROLE.INPUT,
		ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
		ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
	];
	const expectedLocalIndices = [0, 1, 0, 1];
	for (let local = 0; local < SWITCH_PORT_COUNT; local++) {
		const row = start + local;
		if (
			compiled.portRoles[row] !== expectedRoles[local] ||
			compiled.portLocalIndices[row] !== expectedLocalIndices[local]
		) {
			add(
				"INVALID_PORT",
				switchIndex,
				"port roles/local indices must use input0,input1,output0,output1 order",
			);
		}
		validatePathStation(
			paths,
			compiled.portPathIndices[row] as number,
			compiled.portPathStations[row] as number,
			"port",
			switchIndex,
			add,
		);
	}
}

function validateSwitchMovements(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	switchIndex: number,
	add: StructuralIssueAppender,
): void {
	const movementStart = compiled.movementOffsets[switchIndex] as number;
	const movementEnd = compiled.movementOffsets[switchIndex + 1] as number;
	const expected = new Set<string>();
	for (const inputIndex of [0, 1] as const) {
		for (const outputIndex of [0, 1] as const) {
			if (
				((compiled.movementMasks[switchIndex] as number) &
					(1 << (inputIndex * 2 + outputIndex))) !==
				0
			) {
				expected.add(`${inputIndex}:${outputIndex}`);
			}
		}
	}
	const actual = new Set<string>();
	for (let movementIndex = movementStart; movementIndex < movementEnd; movementIndex++) {
		const inputIndex = compiled.movementInputIndices[movementIndex] as number;
		const outputIndex = compiled.movementOutputIndices[movementIndex] as number;
		const identity = `${inputIndex}:${outputIndex}`;
		if (!expected.has(identity) || actual.has(identity)) {
			add("INVALID_MOVEMENT", switchIndex, `movement ${identity} is unauthorized or duplicated`);
		}
		actual.add(identity);
		const intervalStart = compiled.movementPathOffsets[movementIndex] as number;
		const intervalEnd = compiled.movementPathOffsets[movementIndex + 1] as number;
		if (intervalStart >= intervalEnd) {
			add(
				"INVALID_MOVEMENT",
				switchIndex,
				`movement ${identity} must contain a path interval sequence`,
			);
			continue;
		}
		for (let row = intervalStart; row < intervalEnd; row++) {
			const pathIndex = compiled.movementPathIndices[row] as number;
			const start = compiled.movementPathStarts[row] as number;
			const end = compiled.movementPathEnds[row] as number;
			if (!validatePathInterval(paths, pathIndex, start, end)) {
				add(
					"INVALID_PATH_INTERVAL",
					switchIndex,
					`movement ${identity} has an invalid final-path interval`,
				);
			}
			if (
				row + 1 < intervalEnd &&
				!adjacentPath(adjacency, pathIndex, compiled.movementPathIndices[row + 1] as number)
			) {
				add(
					"DISCONNECTED_MOVEMENT",
					switchIndex,
					`movement ${identity} contains disconnected path rows`,
				);
			}
		}
		const portStart = compiled.portOffsets[switchIndex] as number;
		const inputPort = portStart + inputIndex;
		const outputPort = portStart + 2 + outputIndex;
		const firstRow = intervalStart;
		const lastRow = intervalEnd - 1;
		if (
			compiled.movementPathIndices[firstRow] !== compiled.portPathIndices[inputPort] ||
			!approximately(
				compiled.movementPathStarts[firstRow] as number,
				compiled.portPathStations[inputPort] as number,
			)
		) {
			add(
				"INVALID_MOVEMENT",
				switchIndex,
				`movement ${identity} does not start at its exact input port station`,
			);
		}
		if (
			compiled.movementPathIndices[lastRow] !== compiled.portPathIndices[outputPort] ||
			!approximately(
				compiled.movementPathEnds[lastRow] as number,
				compiled.portPathStations[outputPort] as number,
			)
		) {
			add(
				"INVALID_MOVEMENT",
				switchIndex,
				`movement ${identity} does not end at its exact output port station`,
			);
		}
		validateMovementConflictOwnership(
			compiled,
			switchIndex,
			movementIndex,
			inputIndex,
			outputIndex,
			add,
		);
	}
	if (actual.size !== expected.size || [...expected].some((identity) => !actual.has(identity))) {
		add(
			"INVALID_MOVEMENT",
			switchIndex,
			"movement rows must exactly match the explicit movement mask",
		);
	}
	if (expected.size !== SWITCH_MOVEMENT_COUNT) {
		add("INVALID_MOVEMENT", switchIndex, "K2,2 switches must authorize exactly four movements");
	}
}

function validateMovementConflictOwnership(
	compiled: CompiledAdvancedSwitches,
	switchIndex: number,
	movementIndex: number,
	inputIndex: number,
	outputIndex: number,
	add: StructuralIssueAppender,
): void {
	const conflictStart = compiled.conflictPathOffsets[switchIndex] as number;
	const conflictEnd = compiled.conflictPathOffsets[switchIndex + 1] as number;
	const referenceStart = compiled.movementConflictOffsets[movementIndex] as number;
	const referenceEnd = compiled.movementConflictOffsets[movementIndex + 1] as number;
	const seen = new Set<number>();
	let mergeLength = 0;
	let centerLength = 0;
	let branchLength = 0;
	for (let row = referenceStart; row < referenceEnd; row++) {
		const conflictIndex = compiled.movementConflictIntervalIndices[row] as number;
		if (
			!Number.isInteger(conflictIndex) ||
			conflictIndex < conflictStart ||
			conflictIndex >= conflictEnd ||
			seen.has(conflictIndex)
		) {
			add(
				"INVALID_CONFLICT_OWNERSHIP",
				switchIndex,
				"movement conflict references must be unique and switch-local",
			);
			continue;
		}
		seen.add(conflictIndex);
		if (!movementContainsConflictInterval(compiled, movementIndex, conflictIndex)) {
			add(
				"INVALID_CONFLICT_OWNERSHIP",
				switchIndex,
				"movement path intervals must physically contain every referenced conflict interval",
			);
		}
		const length =
			(compiled.conflictPathEnds[conflictIndex] as number) -
			(compiled.conflictPathStarts[conflictIndex] as number);
		const kind = compiled.conflictIntervalKinds[conflictIndex] as number;
		const route = compiled.conflictRouteIndices[conflictIndex] as number;
		if (kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED) {
			if (route !== inputIndex) {
				add(
					"INVALID_CONFLICT_OWNERSHIP",
					switchIndex,
					"movement references the wrong merge alternative",
				);
			}
			mergeLength += length;
		} else if (kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT) {
			centerLength += length;
		} else if (kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED) {
			if (route !== outputIndex) {
				add(
					"INVALID_CONFLICT_OWNERSHIP",
					switchIndex,
					"movement references the wrong branch alternative",
				);
			}
			branchLength += length;
		} else {
			add(
				"INVALID_CONFLICT_OWNERSHIP",
				switchIndex,
				"movement references an unknown conflict interval kind",
			);
		}
	}
	if (
		!approximately(mergeLength, ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters) ||
		!approximately(centerLength, ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters) ||
		!approximately(branchLength, ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters)
	) {
		add(
			"INVALID_CONFLICT_OWNERSHIP",
			switchIndex,
			"movement must own 400 mm + 200 mm + 400 mm conflict intervals",
		);
	}
}

function movementContainsConflictInterval(
	compiled: CompiledAdvancedSwitches,
	movementIndex: number,
	conflictIndex: number,
): boolean {
	const conflictPathIndex = compiled.conflictPathIndices[conflictIndex] as number;
	const conflictStart = compiled.conflictPathStarts[conflictIndex] as number;
	const conflictEnd = compiled.conflictPathEnds[conflictIndex] as number;
	const movementStart = compiled.movementPathOffsets[movementIndex] as number;
	const movementEnd = compiled.movementPathOffsets[movementIndex + 1] as number;
	for (let row = movementStart; row < movementEnd; row++) {
		if (compiled.movementPathIndices[row] !== conflictPathIndex) continue;
		if (
			(compiled.movementPathStarts[row] as number) <= conflictStart + STATION_EPSILON &&
			(compiled.movementPathEnds[row] as number) + STATION_EPSILON >= conflictEnd
		) {
			return true;
		}
	}
	return false;
}

function validateSwitchConflicts(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	switchIndex: number,
	add: StructuralIssueAppender,
): void {
	const start = compiled.conflictPathOffsets[switchIndex] as number;
	const end = compiled.conflictPathOffsets[switchIndex + 1] as number;
	const lengths = new Map<string, number>();
	for (let row = start; row < end; row++) {
		const pathIndex = compiled.conflictPathIndices[row] as number;
		const intervalStart = compiled.conflictPathStarts[row] as number;
		const intervalEnd = compiled.conflictPathEnds[row] as number;
		if (!validatePathInterval(paths, pathIndex, intervalStart, intervalEnd)) {
			add(
				"INVALID_PATH_INTERVAL",
				switchIndex,
				"conflict ownership contains an invalid final-path interval",
			);
		}
		const kind = compiled.conflictIntervalKinds[row] as number;
		const route = compiled.conflictRouteIndices[row] as number;
		if (kind < 0 || kind > ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED) {
			add("INVALID_CONFLICT_OWNERSHIP", switchIndex, "conflict interval kind is invalid");
			continue;
		}
		if (
			route > 1 ||
			(kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT && route !== 0)
		) {
			add("INVALID_CONFLICT_OWNERSHIP", switchIndex, "conflict route alternative is invalid");
		}
		const key = `${kind}:${route}`;
		lengths.set(key, (lengths.get(key) ?? 0) + intervalEnd - intervalStart);
	}
	for (const route of [0, 1]) {
		if (
			!approximately(
				lengths.get(`${ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED}:${route}`) ?? 0,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			) ||
			!approximately(
				lengths.get(`${ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED}:${route}`) ?? 0,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			)
		) {
			add(
				"INVALID_CONFLICT_OWNERSHIP",
				switchIndex,
				`conflict alternative ${route} must own both 400 mm shared leads`,
			);
		}
	}
	if (
		!approximately(
			lengths.get(`${ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT}:0`) ?? 0,
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
		)
	) {
		add(
			"INVALID_CONFLICT_OWNERSHIP",
			switchIndex,
			"conflict zone must own the common 200 mm center throat",
		);
	}
}

function validateSwitchFootprint(
	compiled: CompiledAdvancedSwitches,
	switchIndex: number,
	globallyClaimed: Map<string, number>,
	add: StructuralIssueAppender,
): void {
	const claimedStart = compiled.claimedOffsets[switchIndex] as number;
	const claimedEnd = compiled.claimedOffsets[switchIndex + 1] as number;
	const reservedStart = compiled.reservedOffsets[switchIndex] as number;
	const reservedEnd = compiled.reservedOffsets[switchIndex + 1] as number;
	const claimed = new Set<string>();
	for (let row = claimedStart; row < claimedEnd; row++) {
		const x = compiled.claimedCells[row * 2] as number;
		const y = compiled.claimedCells[row * 2 + 1] as number;
		if (!Number.isInteger(x) || !Number.isInteger(y)) {
			add("INVALID_FOOTPRINT", switchIndex, "claimed cells must use integer coordinates");
			continue;
		}
		const key = cellKey(x, y);
		if (claimed.has(key)) add("INVALID_FOOTPRINT", switchIndex, "claimed cells must be unique");
		claimed.add(key);
		const previousOwner = globallyClaimed.get(key);
		if (previousOwner !== undefined && previousOwner !== switchIndex) {
			add("INVALID_FOOTPRINT", switchIndex, "advanced switch claimed footprints may not overlap");
		} else {
			globallyClaimed.set(key, switchIndex);
		}
	}
	const reserved = new Set<string>();
	for (let row = reservedStart; row < reservedEnd; row++) {
		const x = compiled.reservedCells[row * 2] as number;
		const y = compiled.reservedCells[row * 2 + 1] as number;
		const key = cellKey(x, y);
		if (!Number.isInteger(x) || !Number.isInteger(y) || !claimed.has(key) || reserved.has(key)) {
			add(
				"INVALID_FOOTPRINT",
				switchIndex,
				"reserved cells must be unique integer members of the claimed footprint",
			);
		}
		reserved.add(key);
	}
}

function validatePathStation(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	station: number,
	label: string,
	switchIndex: number,
	add: StructuralIssueAppender,
): boolean {
	if (
		!Number.isInteger(pathIndex) ||
		pathIndex < 0 ||
		pathIndex >= paths.pathCount ||
		!Number.isFinite(station) ||
		station < -STATION_EPSILON ||
		station > (paths.lengths[pathIndex] as number) + STATION_EPSILON
	) {
		add("INVALID_PORT", switchIndex, `${label} path index/station is outside the physical layout`);
		return false;
	}
	return true;
}

function validatePathInterval(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	start: number,
	end: number,
): boolean {
	return (
		Number.isInteger(pathIndex) &&
		pathIndex >= 0 &&
		pathIndex < paths.pathCount &&
		Number.isFinite(start) &&
		Number.isFinite(end) &&
		start >= -STATION_EPSILON &&
		end + STATION_EPSILON >= start &&
		end <= (paths.lengths[pathIndex] as number) + STATION_EPSILON
	);
}

function adjacentPath(adjacency: PhysicalPathAdjacency, from: number, to: number): boolean {
	if (from < 0 || from + 1 >= adjacency.offsets.length) return false;
	const start = adjacency.offsets[from] as number;
	const end = adjacency.offsets[from + 1] as number;
	for (let row = start; row < end; row++) {
		if ((adjacency.targets[row] as number) === to) return true;
	}
	return false;
}

function approximately(left: number, right: number): boolean {
	return Number.isFinite(left) && Math.abs(left - right) <= STATION_EPSILON;
}
