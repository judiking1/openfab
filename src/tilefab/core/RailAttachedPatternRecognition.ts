import type { RailAreaSelection } from "./RailAreaSelection";
import type { DirectedRailEdge, RailModuleOwnership } from "./RailModuleOwnership";
import type { RailMapReader } from "./paint";
import type { TransformedRailTemplateBlueprint } from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	bitCount,
	directionBetween,
	moveCell,
	oppositeDirection,
	type Direction,
} from "./railShape";
import { cellKey, type Cell } from "./TileMap";

export interface AttachedPatternSelection {
	readonly deltaEdges: readonly DirectedRailEdge[];
	readonly contextEdges: readonly DirectedRailEdge[];
}

/** Trace one complete selected diverging path from its branch ownership to its merge ownership. */
export function extractAttachedPatternSelection(
	selection: RailAreaSelection,
	map: RailMapReader,
): AttachedPatternSelection | null {
	const branches = selection.ownerships.filter(
		(ownership) => ownership.construction.grammar === "directed-branch",
	);
	const merges = selection.ownerships.filter(
		(ownership) => ownership.construction.grammar === "directed-merge",
	);
	if (branches.length !== 1 || merges.length !== 1) return null;
	const branchEdge = singleOwnershipEdge(branches[0]);
	const mergeEdge = singleOwnershipEdge(merges[0]);
	if (!branchEdge || !mergeEdge) return null;

	const selectedEdges = selectedDirectedEdges(selection);
	const selectedKeys = new Set(selectedEdges.map(edgeKey));
	const mergeKey = edgeKey(mergeEdge);
	const delta: DirectedRailEdge[] = [];
	const visited = new Set<string>([cellKey(branchEdge.from.x, branchEdge.from.y)]);
	let current = branchEdge;
	for (let edgeIndex = 0; edgeIndex < 2_000; edgeIndex++) {
		const currentKey = edgeKey(current);
		if (!selectedKeys.has(currentKey)) return null;
		delta.push(current);
		if (currentKey === mergeKey) {
			const deltaKeys = new Set(delta.map(edgeKey));
			return Object.freeze({
				deltaEdges: Object.freeze(delta.map(freezeEdge)),
				contextEdges: Object.freeze(
					selectedEdges.filter((edge) => !deltaKeys.has(edgeKey(edge))).map(freezeEdge),
				),
			});
		}

		const cell = current.to;
		const key = cellKey(cell.x, cell.y);
		if (visited.has(key) || map.getAdvancedSwitchOwningCell(cell.x, cell.y)) return null;
		visited.add(key);
		const rail = map.getRail(cell.x, cell.y);
		const incomingDirection = directionBetween(cell, current.from);
		if (
			!incomingDirection ||
			(rail.incoming & incomingDirection) === 0 ||
			bitCount(rail.incoming) !== 1 ||
			bitCount(rail.outgoing) !== 1
		)
			return null;
		const outgoingDirection = ALL_DIRECTIONS.find(
			(direction) => (rail.outgoing & direction) !== 0,
		);
		if (!outgoingDirection) return null;
		current = Object.freeze({ from: cell, to: moveCell(cell, outgoingDirection) });
	}
	return null;
}

/** Permit semantic straight chunks selected around the branch/merge, but no unrelated context. */
export function attachedSelectionContextMatchesTrunk(
	map: RailMapReader,
	contextEdges: readonly DirectedRailEdge[],
	connectors: TransformedRailTemplateBlueprint["compositionConnectors"],
): boolean {
	if (contextEdges.length === 0) return true;
	const connector = connectors.find((candidate) => candidate.kind === "shared-trunk");
	if (!connector || connector.kind !== "shared-trunk") return false;
	let minimumDistance = -1;
	for (let step = 0; step < 2_000; step++) {
		const candidate = moveRepeated(
			connector.startCell,
			connector.geometricDirection,
			minimumDistance - 1,
		);
		if (!exactLinearRail(map, candidate, connector.travelDirection)) break;
		minimumDistance--;
	}
	let maximumDistance = connector.spanMeters + 1;
	for (let step = 0; step < 2_000; step++) {
		const candidate = moveRepeated(
			connector.startCell,
			connector.geometricDirection,
			maximumDistance + 1,
		);
		if (!exactLinearRail(map, candidate, connector.travelDirection)) break;
		maximumDistance++;
	}
	const allowed = new Set<string>();
	for (let distance = minimumDistance; distance < maximumDistance; distance++) {
		const current = moveRepeated(connector.startCell, connector.geometricDirection, distance);
		const next = moveCell(current, connector.geometricDirection);
		allowed.add(
			edgeKey(
				connector.travelDirection === connector.geometricDirection
					? { from: current, to: next }
					: { from: next, to: current },
			),
		);
	}
	return contextEdges.every((edge) => allowed.has(edgeKey(edge)));
}

/** Prove the current map is exactly the candidate delta plus its directed straight trunk contract. */
export function attachedPatternMatchesMap(
	map: RailMapReader,
	routes: readonly (readonly Cell[])[],
	connectors: TransformedRailTemplateBlueprint["compositionConnectors"],
): boolean {
	const route = routes[0];
	const connector = connectors.find((candidate) => candidate.kind === "shared-trunk");
	if (!route || route.length < 3 || !connector || connector.kind !== "shared-trunk") return false;

	const expected = new Map<string, { cell: Cell; incoming: number; outgoing: number }>();
	const addEdge = (from: Cell, to: Cell): boolean => {
		const direction = directionBetween(from, to);
		if (!direction) return false;
		const fromKey = cellKey(from.x, from.y);
		const toKey = cellKey(to.x, to.y);
		const fromExpected = expected.get(fromKey) ?? { cell: from, incoming: 0, outgoing: 0 };
		const toExpected = expected.get(toKey) ?? { cell: to, incoming: 0, outgoing: 0 };
		fromExpected.outgoing |= direction;
		toExpected.incoming |= oppositeDirection(direction);
		expected.set(fromKey, fromExpected);
		expected.set(toKey, toExpected);
		return true;
	};

	for (let index = 0; index < route.length - 1; index++) {
		if (!addEdge(route[index] as Cell, route[index + 1] as Cell)) return false;
	}
	for (let distance = 0; distance < connector.spanMeters; distance++) {
		const current = moveRepeated(connector.startCell, connector.geometricDirection, distance);
		const next = moveCell(current, connector.geometricDirection);
		if (
			!addEdge(
				connector.travelDirection === connector.geometricDirection ? current : next,
				connector.travelDirection === connector.geometricDirection ? next : current,
			)
		)
			return false;
	}
	const startExpected = expected.get(cellKey(connector.startCell.x, connector.startCell.y));
	const endExpected = expected.get(cellKey(connector.endCell.x, connector.endCell.y));
	if (!startExpected || !endExpected) return false;
	if (connector.travelDirection === connector.geometricDirection) {
		startExpected.incoming |= oppositeDirection(connector.travelDirection);
		endExpected.outgoing |= connector.travelDirection;
	} else {
		startExpected.outgoing |= connector.travelDirection;
		endExpected.incoming |= oppositeDirection(connector.travelDirection);
	}

	for (const value of expected.values()) {
		if (map.getAdvancedSwitchOwningCell(value.cell.x, value.cell.y)) return false;
		const rail = map.getRail(value.cell.x, value.cell.y);
		if (rail.incoming !== value.incoming || rail.outgoing !== value.outgoing) return false;
	}

	const before = moveCell(connector.startCell, oppositeDirection(connector.geometricDirection));
	const after = moveCell(connector.endCell, connector.geometricDirection);
	return (
		exactLinearRail(map, before, connector.travelDirection) &&
		exactLinearRail(map, after, connector.travelDirection)
	);
}

function selectedDirectedEdges(selection: RailAreaSelection): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const ownership of selection.ownerships) {
		for (const edge of ownership.eraseEdges) edges.set(edgeKey(edge), edge);
	}
	return Object.freeze([...edges.values()].sort(compareEdges));
}

function singleOwnershipEdge(ownership: RailModuleOwnership | undefined): DirectedRailEdge | null {
	return ownership?.eraseEdges.length === 1 ? (ownership.eraseEdges[0] ?? null) : null;
}

function exactLinearRail(map: RailMapReader, cell: Cell, travelDirection: Direction): boolean {
	if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) return false;
	const rail = map.getRail(cell.x, cell.y);
	return (
		rail.incoming === oppositeDirection(travelDirection) && rail.outgoing === travelDirection
	);
}

function moveRepeated(origin: Cell, direction: Direction, count: number): Cell {
	let current = origin;
	const stepDirection = count < 0 ? oppositeDirection(direction) : direction;
	for (let index = 0; index < Math.abs(count); index++) current = moveCell(current, stepDirection);
	return current;
}

function freezeEdge(edge: DirectedRailEdge): DirectedRailEdge {
	return Object.freeze({
		from: Object.freeze({ x: edge.from.x, y: edge.from.y }),
		to: Object.freeze({ x: edge.to.x, y: edge.to.y }),
	});
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`;
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.y - right.from.y ||
		left.from.x - right.from.x ||
		left.to.y - right.to.y ||
		left.to.x - right.to.x
	);
}
