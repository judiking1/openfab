import type { RailNetworkAnalysis } from "../core/network";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { Cell } from "../core/TileMap";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import {
	comparePhysicalPathIdentity,
	PHYSICAL_PATH_IDENTITY_WIDTH,
	physicalPathIdentity,
} from "./PhysicalPathIdentity";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import type { CompiledPhysicalLayout, CompiledRailDiagnostic } from "./PhysicalRailCompiler";
import { RAIL_CLEARANCE_ISSUE_CODE } from "./RailClearanceValidator";

export const RAIL_PROJECT_READINESS_VERSION = 3;

export type RailProjectReadinessStatus = "empty" | "blocked" | "ready";

export type RailProjectReadinessIssueCode =
	| "EMPTY_PROJECT"
	| "OPEN_TERMINAL"
	| "DISCONNECTED_NETWORK"
	| "MULTIPLE_STRONG_COMPONENTS"
	| "UNSUPPORTED_JUNCTION"
	| "TOPOLOGY_ERROR"
	| "INVALID_PHYSICAL_PATH"
	| "PHYSICAL_TERMINAL"
	| "PHYSICAL_OPEN_PATH"
	| "PHYSICAL_DISCONNECTED"
	| "CLEARANCE_CONFLICT";

export interface RailProjectReadinessIssue {
	readonly id: string;
	readonly code: RailProjectReadinessIssueCode;
	readonly sourceCode: string | null;
	readonly message: string;
	readonly affectedCount: number;
	/** Bounded navigation samples; complete deterministic locations live in `locations`. */
	readonly cells: readonly Cell[];
	readonly pathIdentities: readonly Int32Array[];
}

export interface RailProjectReadinessSummary {
	readonly cells: number;
	readonly edges: number;
	readonly physicalPaths: number;
	readonly closure: "empty" | "open" | "closed";
	readonly weakComponents: number;
	readonly strongComponents: number;
	readonly minimumReturnLinks: number;
	readonly openTerminals: number;
	readonly junctions: number;
	readonly unsupportedJunctions: number;
	readonly topologyErrors: number;
	readonly physicalTerminals: number;
	readonly physicalOpenPaths: number;
	readonly physicalStrongComponents: number;
	readonly invalidPhysicalPaths: number;
	readonly clearanceIssues: number;
}

/** Full offending-location buffers stay compact even for hostile or 50k-cell projects. */
export interface RailProjectReadinessLocations {
	readonly openTerminalCells: Int32Array;
	readonly componentRepresentativeCells: Int32Array;
	readonly strongComponentRepresentativeCells: Int32Array;
	readonly oneWayCorridorOffsets: Uint32Array;
	readonly oneWayCorridorCells: Int32Array;
	readonly oneWayCorridorBoundaries: Int32Array;
	readonly unsupportedJunctionCells: Int32Array;
	readonly topologyErrorCells: Int32Array;
	readonly physicalTerminalCells: Int32Array;
	readonly physicalOpenPathIdentities: Int32Array;
	readonly physicalStrongComponentPathIdentities: Int32Array;
	readonly clearanceCells: Int32Array;
	readonly clearancePathIdentities: Int32Array;
}

/** Platform-independent completion report over authored and compiled directed graphs. */
export interface RailProjectReadiness {
	readonly version: typeof RAIL_PROJECT_READINESS_VERSION;
	readonly status: RailProjectReadinessStatus;
	readonly ready: boolean;
	readonly authoredChecksum: string;
	/** Fingerprint of rail topology, diagnostics and locations, independent of static equipment. */
	readonly topologyFingerprint: string;
	readonly fingerprint: string;
	readonly summary: RailProjectReadinessSummary;
	readonly locations: RailProjectReadinessLocations;
	readonly issues: readonly RailProjectReadinessIssue[];
}

type PendingIssue = Omit<RailProjectReadinessIssue, "id">;

const MAX_ISSUE_LOCATION_SAMPLES = 16;

const ISSUE_PRIORITY: Readonly<Record<RailProjectReadinessIssueCode, number>> = {
	EMPTY_PROJECT: 0,
	TOPOLOGY_ERROR: 1,
	INVALID_PHYSICAL_PATH: 2,
	UNSUPPORTED_JUNCTION: 3,
	CLEARANCE_CONFLICT: 4,
	PHYSICAL_TERMINAL: 5,
	PHYSICAL_OPEN_PATH: 6,
	PHYSICAL_DISCONNECTED: 7,
	DISCONNECTED_NETWORK: 8,
	MULTIPLE_STRONG_COMPONENTS: 9,
	OPEN_TERMINAL: 10,
};

const CLEARANCE_CODE_NAMES: Readonly<Record<number, string>> = {
	[RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION]: "BEAM_INTRUSION",
	[RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION]: "OHT_SWEEP_INTRUSION",
	[RAIL_CLEARANCE_ISSUE_CODE.INSTALLATION_CLEARANCE]: "INSTALLATION_CLEARANCE",
};

export function createRailProjectReadiness(
	analysis: RailNetworkAnalysis,
	physical: CompiledPhysicalLayout,
	authoredChecksum: string,
): RailProjectReadiness {
	const physicalTopology = analyzePhysicalPathTopology(physical.paths);
	const locations = createLocations(analysis, physical, physicalTopology);
	const summary: RailProjectReadinessSummary = Object.freeze({
		cells: analysis.cells,
		edges: analysis.edges,
		physicalPaths: physicalTopology.paths,
		closure: analysis.cells === 0 ? "empty" : analysis.openEnds === 0 ? "closed" : "open",
		weakComponents: analysis.components,
		strongComponents: analysis.strongComponents,
		minimumReturnLinks: analysis.minimumReturnLinks,
		openTerminals: analysis.openEnds,
		junctions: analysis.junctions,
		unsupportedJunctions: analysis.unsafeJunctions,
		topologyErrors: physical.diagnostics.length,
		physicalTerminals: physical.terminals.length,
		physicalOpenPaths: physicalTopology.openPaths,
		physicalStrongComponents: physicalTopology.strongComponents,
		invalidPhysicalPaths: physicalTopology.invalidPaths,
		clearanceIssues: physical.clearance.issues.count,
	});
	const pending = collectIssues(analysis, physical, physicalTopology, locations);
	const issues = Object.freeze(
		pending
			.map(finalizeIssue)
			.sort(
				(left, right) =>
					ISSUE_PRIORITY[left.code] - ISSUE_PRIORITY[right.code] ||
					compareAscii(left.sourceCode ?? "", right.sourceCode ?? "") ||
					compareAscii(left.id, right.id),
			),
	);
	const ready =
		analysis.cells > 0 &&
		analysis.openEnds === 0 &&
		analysis.components === 1 &&
		analysis.strongComponents === 1 &&
		analysis.unsafeJunctions === 0 &&
		physical.valid &&
		physical.diagnostics.length === 0 &&
		physical.terminals.length === 0 &&
		physicalTopology.paths > 0 &&
		physicalTopology.invalidPaths === 0 &&
		physicalTopology.openPaths === 0 &&
		physicalTopology.strongComponents === 1 &&
		physical.clearance.issues.count === 0;
	const status: RailProjectReadinessStatus =
		analysis.cells === 0 ? "empty" : ready ? "ready" : "blocked";
	const reportWithoutFingerprints = {
		version: RAIL_PROJECT_READINESS_VERSION,
		status,
		ready,
		authoredChecksum,
		summary,
		locations,
		issues,
	} as const;
	const topologyFingerprint = checksumRailProjectReadinessTopology(reportWithoutFingerprints);
	return Object.freeze({
		...reportWithoutFingerprints,
		topologyFingerprint,
		fingerprint: bindRailProjectReadinessFingerprint(topologyFingerprint, authoredChecksum),
	});
}

/**
 * Rebind unchanged rail readiness to static-world edits without traversing large typed location
 * buffers again. Callers must only use this when the authored rail revision is unchanged.
 */
export function rebindRailProjectReadinessAuthoredChecksum(
	report: RailProjectReadiness,
	authoredChecksum: string,
): RailProjectReadiness {
	if (report.authoredChecksum === authoredChecksum) return report;
	return Object.freeze({
		...report,
		authoredChecksum,
		fingerprint: bindRailProjectReadinessFingerprint(report.topologyFingerprint, authoredChecksum),
	});
}

function collectIssues(
	analysis: RailNetworkAnalysis,
	physical: CompiledPhysicalLayout,
	physicalTopology: ReturnType<typeof analyzePhysicalPathTopology>,
	locations: RailProjectReadinessLocations,
): PendingIssue[] {
	const issues: PendingIssue[] = [];
	if (analysis.cells === 0) {
		issues.push(
			pendingIssue("EMPTY_PROJECT", null, "The project does not contain authored rail cells.", 1),
		);
	}
	if (analysis.openEnds > 0) {
		issues.push(
			pendingIssue(
				"OPEN_TERMINAL",
				null,
				`The authored directed graph contains ${analysis.openEnds} open terminals.`,
				analysis.openEnds,
				sampleCells(locations.openTerminalCells),
			),
		);
	}
	if (analysis.components > 1) {
		issues.push(
			pendingIssue(
				"DISCONNECTED_NETWORK",
				null,
				`The authored map contains ${analysis.components} disconnected rail networks.`,
				analysis.components,
				sampleCells(locations.componentRepresentativeCells),
			),
		);
	}
	if (analysis.strongComponents > 1) {
		const oneWayCorridorCount = Math.max(0, locations.oneWayCorridorOffsets.length - 1);
		const hasOneWayCorridor =
			analysis.components === 1 && analysis.openEnds === 0 && oneWayCorridorCount > 0;
		issues.push(
			pendingIssue(
				"MULTIPLE_STRONG_COMPONENTS",
				hasOneWayCorridor ? "ONE_WAY_CORRIDOR" : null,
				hasOneWayCorridor
					? `The authored graph contains ${oneWayCorridorCount} one-way corridor${oneWayCorridorCount === 1 ? "" : "s"} across ${analysis.strongComponents} strong components and needs at least ${analysis.minimumReturnLinks} validated return link${analysis.minimumReturnLinks === 1 ? "" : "s"}.`
					: `The authored directed graph contains ${analysis.strongComponents} strong components.`,
				hasOneWayCorridor ? oneWayCorridorCount : analysis.strongComponents,
				hasOneWayCorridor
					? sampleCorridorBoundaryCells(locations.oneWayCorridorBoundaries)
					: sampleCells(locations.strongComponentRepresentativeCells),
			),
		);
	}
	if (analysis.unsafeJunctions > 0) {
		issues.push(
			pendingIssue(
				"UNSUPPORTED_JUNCTION",
				null,
				`${analysis.unsafeJunctions} junctions are outside the tangent AMHS grammar.`,
				analysis.unsafeJunctions,
				sampleCells(locations.unsupportedJunctionCells),
			),
		);
	}
	issues.push(...physicalDiagnosticIssues(physical.diagnostics));
	if (!physical.valid && physical.diagnostics.length === 0) {
		issues.push(
			pendingIssue("TOPOLOGY_ERROR", "INVALID_LAYOUT", "The physical layout is invalid.", 1),
		);
	}
	if (analysis.cells > 0 && physicalTopology.invalidPaths > 0) {
		const identities = invalidPhysicalPathSamples(physical.paths);
		issues.push(
			pendingIssue(
				"INVALID_PHYSICAL_PATH",
				null,
				`${physicalTopology.invalidPaths} compiled physical paths are invalid.`,
				physicalTopology.invalidPaths,
				cellsFromPathIdentities(identities),
				identities,
			),
		);
	}
	if (analysis.cells > 0 && physical.terminals.length > 0) {
		issues.push(
			pendingIssue(
				"PHYSICAL_TERMINAL",
				null,
				`The compiled physical layout contains ${physical.terminals.length} terminal cells.`,
				physical.terminals.length,
				sampleCells(locations.physicalTerminalCells),
			),
		);
	}
	if (analysis.cells > 0 && physicalTopology.openPaths > 0) {
		const identities = samplePathIdentityRows(locations.physicalOpenPathIdentities);
		issues.push(
			pendingIssue(
				"PHYSICAL_OPEN_PATH",
				null,
				`The compiled graph contains ${physicalTopology.openPaths} paths without complete flow adjacency.`,
				physicalTopology.openPaths,
				cellsFromPathIdentities(identities),
				identities,
			),
		);
	}
	if (
		analysis.cells > 0 &&
		(physicalTopology.paths === 0 || physicalTopology.strongComponents !== 1)
	) {
		const identities = samplePathIdentityRows(locations.physicalStrongComponentPathIdentities);
		issues.push(
			pendingIssue(
				"PHYSICAL_DISCONNECTED",
				null,
				`The compiled directed graph contains ${physicalTopology.strongComponents} strong components.`,
				physicalTopology.strongComponents,
				cellsFromPathIdentities(identities),
				identities,
			),
		);
	}
	issues.push(...clearanceIssues(physical));
	return issues;
}

function createLocations(
	analysis: RailNetworkAnalysis,
	physical: CompiledPhysicalLayout,
	physicalTopology: ReturnType<typeof analyzePhysicalPathTopology>,
): RailProjectReadinessLocations {
	const topologyCells = uniqueSortedCells(
		physical.diagnostics.flatMap((diagnostic) => [diagnostic.cell, ...(diagnostic.cells ?? [])]),
	);
	const clearanceCells: Cell[] = [];
	const clearancePathRows: Int32Array[] = [];
	const clearance = physical.clearance.issues;
	for (let index = 0; index < clearance.count; index++) {
		clearanceCells.push(
			{ x: clearance.cells[index * 4] as number, y: clearance.cells[index * 4 + 1] as number },
			{ x: clearance.cells[index * 4 + 2] as number, y: clearance.cells[index * 4 + 3] as number },
		);
		clearancePathRows.push(
			pathIdentityRow(clearance.firstPathIdentities, index),
			pathIdentityRow(clearance.secondPathIdentities, index),
		);
	}
	clearancePathRows.sort(compareInt32Rows);
	return Object.freeze({
		openTerminalCells: analysis.openEndCells.slice(),
		componentRepresentativeCells: analysis.componentRepresentatives.slice(),
		strongComponentRepresentativeCells: analysis.strongComponentRepresentatives.slice(),
		oneWayCorridorOffsets: analysis.oneWayCorridorOffsets.slice(),
		oneWayCorridorCells: analysis.oneWayCorridorCells.slice(),
		oneWayCorridorBoundaries: analysis.oneWayCorridorBoundaries.slice(),
		unsupportedJunctionCells: analysis.unsafeJunctionCells.slice(),
		topologyErrorCells: flattenCells(topologyCells),
		physicalTerminalCells: flattenCells(uniqueSortedCells(physical.terminals)),
		physicalOpenPathIdentities: physicalTopology.openPathIdentities.slice(),
		physicalStrongComponentPathIdentities: physicalTopology.strongComponentPathIdentities.slice(),
		clearanceCells: flattenCells(uniqueSortedCells(clearanceCells)),
		clearancePathIdentities: flattenRows(clearancePathRows),
	});
}

function physicalDiagnosticIssues(diagnostics: readonly CompiledRailDiagnostic[]): PendingIssue[] {
	const groups = new Map<string, CompiledRailDiagnostic[]>();
	for (const diagnostic of diagnostics) {
		const group = groups.get(diagnostic.code);
		if (group) group.push(diagnostic);
		else groups.set(diagnostic.code, [diagnostic]);
	}
	return [...groups.entries()].map(([sourceCode, group]) =>
		pendingIssue(
			"TOPOLOGY_ERROR",
			sourceCode,
			group[0]?.message ?? sourceCode,
			group.length,
			uniqueSortedCells(
				group.flatMap((diagnostic) => [diagnostic.cell, ...(diagnostic.cells ?? [])]),
			).slice(0, MAX_ISSUE_LOCATION_SAMPLES),
		),
	);
}

function clearanceIssues(physical: CompiledPhysicalLayout): PendingIssue[] {
	const source = physical.clearance.issues;
	const groups = new Map<string, number[]>();
	for (let index = 0; index < source.count; index++) {
		const sourceCode = CLEARANCE_CODE_NAMES[source.codes[index] as number] ?? "UNKNOWN_CLEARANCE";
		const group = groups.get(sourceCode);
		if (group) group.push(index);
		else groups.set(sourceCode, [index]);
	}
	return [...groups.entries()].map(([sourceCode, indices]) => {
		const cells: Cell[] = [];
		const identities: Int32Array[] = [];
		for (const index of indices) {
			cells.push(
				{ x: source.cells[index * 4] as number, y: source.cells[index * 4 + 1] as number },
				{ x: source.cells[index * 4 + 2] as number, y: source.cells[index * 4 + 3] as number },
			);
			identities.push(
				pathIdentityRow(source.firstPathIdentities, index),
				pathIdentityRow(source.secondPathIdentities, index),
			);
		}
		identities.sort(compareInt32Rows);
		return pendingIssue(
			"CLEARANCE_CONFLICT",
			sourceCode,
			`${indices.length} ${sourceCode} physical clearance conflicts were found.`,
			indices.length,
			uniqueSortedCells(cells).slice(0, MAX_ISSUE_LOCATION_SAMPLES),
			identities.slice(0, MAX_ISSUE_LOCATION_SAMPLES),
		);
	});
}

function pendingIssue(
	code: RailProjectReadinessIssueCode,
	sourceCode: string | null,
	message: string,
	affectedCount: number,
	cells: readonly Cell[] = [],
	pathIdentities: readonly Int32Array[] = [],
): PendingIssue {
	return {
		code,
		sourceCode,
		message,
		affectedCount,
		cells: freezeCells(cells.slice(0, MAX_ISSUE_LOCATION_SAMPLES)),
		pathIdentities: Object.freeze(
			pathIdentities.slice(0, MAX_ISSUE_LOCATION_SAMPLES).map((identity) => identity.slice()),
		),
	};
}

function finalizeIssue(issue: PendingIssue): RailProjectReadinessIssue {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([issue.code, issue.sourceCode ?? ""]);
	checksum.addNumbers([issue.affectedCount, ...issue.cells.flatMap((cell) => [cell.x, cell.y])]);
	checksum.addViews(issue.pathIdentities);
	return Object.freeze({ ...issue, id: `${issue.code}:${checksum.digest()}` });
}

export function checksumRailProjectReadiness(
	report: Omit<RailProjectReadiness, "fingerprint">,
): string {
	const topologyFingerprint = checksumRailProjectReadinessTopology(report);
	assertRailProjectReadinessTopologyFingerprint(report.topologyFingerprint, topologyFingerprint);
	return bindRailProjectReadinessFingerprint(topologyFingerprint, report.authoredChecksum);
}

function checksumRailProjectReadinessTopology(
	report: Omit<RailProjectReadiness, "fingerprint" | "topologyFingerprint">,
): string {
	const { checksum, views } = createRailProjectReadinessTopologyChecksum(report);
	checksum.addViews(views);
	finishRailProjectReadinessTopologyChecksum(checksum, report);
	return checksum.digest();
}

export async function checksumRailProjectReadinessCooperatively(
	report: Omit<RailProjectReadiness, "fingerprint">,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const { checksum, views } = createRailProjectReadinessTopologyChecksum(report);
	await checksum.addViewsCooperatively(views, checkpoint);
	finishRailProjectReadinessTopologyChecksum(checksum, report);
	await checkpoint();
	const topologyFingerprint = checksum.digest();
	assertRailProjectReadinessTopologyFingerprint(report.topologyFingerprint, topologyFingerprint);
	return bindRailProjectReadinessFingerprint(topologyFingerprint, report.authoredChecksum);
}

function createRailProjectReadinessTopologyChecksum(
	report: Omit<RailProjectReadiness, "fingerprint" | "topologyFingerprint">,
): { readonly checksum: OrderedTypedChecksum; readonly views: readonly ArrayBufferView[] } {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([report.status, report.summary.closure]);
	checksum.addNumbers([
		report.version,
		report.ready ? 1 : 0,
		report.summary.cells,
		report.summary.edges,
		report.summary.physicalPaths,
		report.summary.weakComponents,
		report.summary.strongComponents,
		report.summary.minimumReturnLinks,
		report.summary.openTerminals,
		report.summary.junctions,
		report.summary.unsupportedJunctions,
		report.summary.topologyErrors,
		report.summary.physicalTerminals,
		report.summary.physicalOpenPaths,
		report.summary.physicalStrongComponents,
		report.summary.invalidPhysicalPaths,
		report.summary.clearanceIssues,
	]);
	return {
		checksum,
		views: [
			report.locations.openTerminalCells,
			report.locations.componentRepresentativeCells,
			report.locations.strongComponentRepresentativeCells,
			report.locations.oneWayCorridorOffsets,
			report.locations.oneWayCorridorCells,
			report.locations.oneWayCorridorBoundaries,
			report.locations.unsupportedJunctionCells,
			report.locations.topologyErrorCells,
			report.locations.physicalTerminalCells,
			report.locations.physicalOpenPathIdentities,
			report.locations.physicalStrongComponentPathIdentities,
			report.locations.clearanceCells,
			report.locations.clearancePathIdentities,
		],
	};
}

function finishRailProjectReadinessTopologyChecksum(
	checksum: OrderedTypedChecksum,
	report: Omit<RailProjectReadiness, "fingerprint" | "topologyFingerprint">,
): void {
	for (const issue of report.issues) {
		checksum.addStrings([issue.id, issue.code, issue.sourceCode ?? ""]);
		checksum.addNumbers([issue.affectedCount]);
	}
}

function bindRailProjectReadinessFingerprint(
	topologyFingerprint: string,
	authoredChecksum: string,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([topologyFingerprint, authoredChecksum]);
	return checksum.digest();
}

function assertRailProjectReadinessTopologyFingerprint(expected: string, actual: string): void {
	if (expected !== actual) {
		throw new Error(
			`Rail readiness topology fingerprint mismatch: expected ${expected}, received ${actual}.`,
		);
	}
}

function sampleCells(pairs: Int32Array): Cell[] {
	const cells: Cell[] = [];
	for (
		let index = 0;
		index + 1 < pairs.length && cells.length < MAX_ISSUE_LOCATION_SAMPLES;
		index += 2
	) {
		cells.push({ x: pairs[index] as number, y: pairs[index + 1] as number });
	}
	return cells;
}

function sampleCorridorBoundaryCells(boundaries: Int32Array): Cell[] {
	const cells: Cell[] = [];
	for (
		let offset = 0;
		offset + 7 < boundaries.length && cells.length < MAX_ISSUE_LOCATION_SAMPLES;
		offset += 8
	) {
		cells.push(
			{ x: boundaries[offset] as number, y: boundaries[offset + 1] as number },
			{ x: boundaries[offset + 2] as number, y: boundaries[offset + 3] as number },
			{ x: boundaries[offset + 4] as number, y: boundaries[offset + 5] as number },
			{ x: boundaries[offset + 6] as number, y: boundaries[offset + 7] as number },
		);
	}
	return uniqueSortedCells(cells);
}

function samplePathIdentityRows(rows: Int32Array): Int32Array[] {
	const result: Int32Array[] = [];
	for (
		let offset = 0;
		offset + PHYSICAL_PATH_IDENTITY_WIDTH <= rows.length &&
		result.length < MAX_ISSUE_LOCATION_SAMPLES;
		offset += PHYSICAL_PATH_IDENTITY_WIDTH
	) {
		result.push(rows.slice(offset, offset + PHYSICAL_PATH_IDENTITY_WIDTH));
	}
	return result;
}

function invalidPhysicalPathSamples(paths: CompiledPhysicalPaths): Int32Array[] {
	const pathIndices: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) pathIndices.push(pathIndex);
	}
	pathIndices.sort((left, right) => comparePhysicalPathIdentity(paths, left, right));
	return pathIndices
		.slice(0, MAX_ISSUE_LOCATION_SAMPLES)
		.map((pathIndex) => physicalPathIdentity(paths, pathIndex));
}

function cellsFromPathIdentities(identities: readonly Int32Array[]): Cell[] {
	return uniqueSortedCells(
		identities.map((identity) => ({ x: identity[2] as number, y: identity[3] as number })),
	);
}

function pathIdentityRow(rows: Int32Array, row: number): Int32Array {
	return rows.slice(row * PHYSICAL_PATH_IDENTITY_WIDTH, (row + 1) * PHYSICAL_PATH_IDENTITY_WIDTH);
}

function uniqueSortedCells(cells: readonly Cell[]): Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells) unique.set(`${cell.x},${cell.y}`, cell);
	return [...unique.values()].sort(compareCells);
}

function flattenCells(cells: readonly Cell[]): Int32Array {
	const flattened = new Int32Array(cells.length * 2);
	for (let index = 0; index < cells.length; index++) {
		const cell = cells[index] as Cell;
		flattened[index * 2] = cell.x;
		flattened[index * 2 + 1] = cell.y;
	}
	return flattened;
}

function flattenRows(rows: readonly Int32Array[]): Int32Array {
	const flattened = new Int32Array(rows.length * PHYSICAL_PATH_IDENTITY_WIDTH);
	for (let index = 0; index < rows.length; index++) {
		flattened.set(rows[index] as Int32Array, index * PHYSICAL_PATH_IDENTITY_WIDTH);
	}
	return flattened;
}

function freezeCells(cells: readonly Cell[]): readonly Cell[] {
	return Object.freeze(
		cells.map((cell) => Object.freeze({ x: cell.x, y: cell.y })).sort(compareCells),
	);
}

function compareCells(left: Cell, right: Cell): number {
	return left.x - right.x || left.y - right.y;
}

function compareInt32Rows(left: Int32Array, right: Int32Array): number {
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const difference = (left[index] as number) - (right[index] as number);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
