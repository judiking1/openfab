import { ADVANCED_SWITCH_MAX_ID, validateAdvancedSwitchTopology } from "../core/AdvancedSwitch";
import { analyzeRailNetwork } from "../core/network";
import { isSupportedRailCoordinate } from "../core/RailCoordinateDomain";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { directionBetween, oppositeDirection } from "../core/railShape";
import {
	compareDirectedRailEdges,
	STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES,
	type StaticFabOrganizationMembership,
} from "../core/StaticFabOrganization";
import type { StaticFabProcessLoopTopologyResult } from "../core/StaticFabProcessLoopTopologyEvidence";
import { type Cell, cellKey, decodeRailCell, TileMap } from "../core/TileMap";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";

export type {
	StaticFabProcessLoopTopologyEvidence,
	StaticFabProcessLoopTopologyResult,
} from "../core/StaticFabProcessLoopTopologyEvidence";

/**
 * Synchronous candidate compilation for an isolated Worker. Callers separately prove fresh
 * whole-module selection, stored-owner exclusion and one-shot adoption/commit authority.
 * Never invoke this from a main-thread scheduling step: the topology compilers are synchronous.
 */
export function evaluateStaticFabProcessLoopTopology(
	source: TileMap,
	membership: StaticFabOrganizationMembership,
): StaticFabProcessLoopTopologyResult {
	const candidate = projectStaticFabProcessLoopRail(source, membership);
	return evaluateProjectedStaticFabProcessLoopTopology(candidate);
}

/** Worker-only facts over a validated selected-union map; this grants no authoring authority. */
export function evaluateProjectedStaticFabProcessLoopTopology(
	candidate: TileMap,
): StaticFabProcessLoopTopologyResult {
	const authored = analyzeRailNetwork(candidate);
	const layout = compilePhysicalRail(candidate);
	const physical = analyzePhysicalPathTopology(layout.paths);
	const authoredClosed =
		authored.cells > 0 &&
		authored.components === 1 &&
		authored.strongComponents === 1 &&
		authored.openEnds === 0 &&
		authored.unsafeJunctions === 0;
	const physicalClosed =
		layout.valid &&
		physical.paths > 0 &&
		physical.strongComponents === 1 &&
		physical.openPaths === 0 &&
		physical.invalidPaths === 0 &&
		layout.diagnostics.length === 0 &&
		layout.terminals.length === 0 &&
		layout.clearance.issues.count === 0;
	return Object.freeze({
		valid: authoredClosed && physicalClosed,
		authoringAuthority: "NONE",
		evidence: Object.freeze({
			authoredCells: authored.cells,
			authoredEdges: authored.edges,
			authoredComponents: authored.components,
			authoredStrongComponents: authored.strongComponents,
			authoredOpenEnds: authored.openEnds,
			authoredUnsafeJunctions: authored.unsafeJunctions,
			authoredClosed,
			physicalValid: layout.valid,
			physicalPaths: physical.paths,
			physicalStrongComponents: physical.strongComponents,
			physicalOpenPaths: physical.openPaths,
			physicalInvalidPaths: physical.invalidPaths,
			physicalDiagnostics: layout.diagnostics.length,
			physicalTerminals: layout.terminals.length,
			physicalClearanceIssues: layout.clearance.issues.count,
			physicalClosed,
		}),
	});
}

/** Preserve selected directions and switch identity; unselected source bits never enter the map. */
export function projectStaticFabProcessLoopRail(
	source: TileMap,
	membership: StaticFabOrganizationMembership,
): TileMap {
	if (
		!membership ||
		!Array.isArray(membership.railEdges) ||
		!Array.isArray(membership.advancedSwitchIds) ||
		!Array.isArray(membership.equipmentGroupIds) ||
		membership.equipmentGroupIds.length !== 0
	)
		throw new Error("Process Loop topology requires rail-only membership arrays.");
	const references = membership.railEdges.length + membership.advancedSwitchIds.length;
	if (references > STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES)
		throw new Error("Process Loop candidate exceeds the organization reference limit.");
	const cells = new Map<string, { cell: Cell; encoded: number }>();
	const addBits = (cell: Cell, bits: number): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = cells.get(key);
		if (existing) existing.encoded |= bits;
		else cells.set(key, { cell: { x: cell.x, y: cell.y }, encoded: bits });
	};
	let previous: DirectedRailEdge | null = null;
	for (const edge of membership.railEdges) {
		if (
			!edge?.from ||
			!edge.to ||
			!isSupportedRailCoordinate(edge.from.x, edge.from.y) ||
			!isSupportedRailCoordinate(edge.to.x, edge.to.y)
		)
			throw new Error("Process Loop candidate contains unsupported rail coordinates.");
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null || (previous !== null && compareDirectedRailEdges(previous, edge) >= 0))
			throw new Error("Process Loop edges must be adjacent, unique and canonically ordered.");
		const incoming = oppositeDirection(direction);
		if (
			(decodeRailCell(source.getEncoded(edge.from.x, edge.from.y)).outgoing & direction) === 0 ||
			(decodeRailCell(source.getEncoded(edge.to.x, edge.to.y)).incoming & incoming) === 0
		)
			throw new Error("Process Loop directed edge is absent from the source.");
		addBits(edge.from, direction << 4);
		addBits(edge.to, incoming);
		previous = edge;
	}
	const hydrator = TileMap.createHydrator();
	for (const { cell, encoded } of cells.values()) hydrator.addEncodedCell(cell.x, cell.y, encoded);
	let previousId = 0;
	for (const id of membership.advancedSwitchIds) {
		if (!Number.isInteger(id) || id <= previousId || id > ADVANCED_SWITCH_MAX_ID)
			throw new Error("Process Loop switch IDs must be positive, unique and ascending.");
		const record = source.getAdvancedSwitch(id);
		if (!record) throw new Error("Process Loop switch is absent from the source.");
		hydrator.addAdvancedSwitch(record);
		previousId = id;
	}
	const candidate = hydrator.finish(source.getRevision(), source.getAdvancedSwitchIdCursor());
	candidate.forEachAdvancedSwitch((record) => {
		if (validateAdvancedSwitchTopology((x, y) => candidate.getEncoded(x, y), record).length > 0)
			throw new Error("Process Loop candidate omits or invalidates a selected switch footprint.");
	});
	return candidate;
}
