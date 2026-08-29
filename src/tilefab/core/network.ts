import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	isTangentJunction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, type RailCell, type TileMap } from "./TileMap";

export interface RailNetworkAnalysis {
	status: "empty" | "open" | "disconnected" | "unsafe" | "closed";
	cells: number;
	edges: number;
	components: number;
	openEnds: number;
	curves: number;
	junctions: number;
	unsafeJunctions: number;
	strongComponents: number;
	stronglyConnected: boolean;
	/** Flattened, x/y ordered authored cells with no incoming or no outgoing route. */
	openEndCells: Int32Array;
	/** Flattened, x/y ordered authored cells whose three-port grammar is unsupported. */
	unsafeJunctionCells: Int32Array;
	/** One deterministic x/y representative for every weak component. */
	componentRepresentatives: Int32Array;
	/** One deterministic x/y representative for every directed strong component. */
	strongComponentRepresentatives: Int32Array;
	/** Lower bound for additional directed links required to make the condensation graph cyclic. */
	minimumReturnLinks: number;
	/** CSR offsets into `oneWayCorridorCells`, measured in authored cells. */
	oneWayCorridorOffsets: Uint32Array;
	/** Flattened x/y cells along every maximal one-way corridor between SCC boundaries. */
	oneWayCorridorCells: Int32Array;
	/** Per corridor: departure from/to x/y followed by arrival from/to x/y. */
	oneWayCorridorBoundaries: Int32Array;
}

export function analyzeRailNetwork(map: TileMap): RailNetworkAnalysis {
	const rails = new Map<string, { cell: Cell; rail: RailCell }>();
	map.forEachRail((x, y, rail) => rails.set(cellKey(x, y), { cell: { x, y }, rail }));
	if (rails.size === 0) {
		return {
			status: "empty",
			cells: 0,
			edges: 0,
			components: 0,
			openEnds: 0,
			curves: 0,
			junctions: 0,
			unsafeJunctions: 0,
			strongComponents: 0,
			stronglyConnected: false,
			openEndCells: new Int32Array(),
			unsafeJunctionCells: new Int32Array(),
			componentRepresentatives: new Int32Array(),
			strongComponentRepresentatives: new Int32Array(),
			minimumReturnLinks: 0,
			oneWayCorridorOffsets: new Uint32Array([0]),
			oneWayCorridorCells: new Int32Array(),
			oneWayCorridorBoundaries: new Int32Array(),
		};
	}

	let openEnds = 0;
	let curves = 0;
	let junctions = 0;
	let unsafeJunctions = 0;
	const orderedRails = [...rails.values()].sort((left, right) =>
		compareCells(left.cell, right.cell),
	);
	const openEndCellList: Cell[] = [];
	const unsafeJunctionCellList: Cell[] = [];
	for (const { cell, rail } of orderedRails) {
		const incomingCount = bitCount(rail.incoming);
		const outgoingCount = bitCount(rail.outgoing);
		const degree = bitCount(rail.incoming | rail.outgoing);
		if (incomingCount === 0 || outgoingCount === 0) {
			openEnds++;
			openEndCellList.push(cell);
		}
		if (degree === 2 && incomingCount === 1 && outgoingCount === 1) {
			const mask = rail.incoming | rail.outgoing;
			if (mask !== 5 && mask !== 10) curves++;
		}
		if (degree === 3) {
			junctions++;
			if (!isTangentJunction(rail.incoming, rail.outgoing)) {
				unsafeJunctions++;
				unsafeJunctionCellList.push(cell);
			}
		}
	}

	const weakComponents = collectWeakComponentRepresentatives(rails, orderedRails);
	const strongComponentAnalysis = collectStrongComponents(rails, orderedRails);
	const strongComponentCells = strongComponentAnalysis.representatives;
	const components = weakComponents.length;
	const strongComponents = strongComponentCells.length;
	const stronglyConnected = strongComponents === 1;
	const status =
		unsafeJunctions > 0
			? "unsafe"
			: components > 1
				? "disconnected"
				: openEnds === 0 && stronglyConnected
					? "closed"
					: "open";
	return {
		status,
		cells: rails.size,
		edges: map.edgeCount,
		components,
		openEnds,
		curves,
		junctions,
		unsafeJunctions,
		strongComponents,
		stronglyConnected,
		openEndCells: flattenCells(openEndCellList),
		unsafeJunctionCells: flattenCells(unsafeJunctionCellList),
		componentRepresentatives: flattenCells(weakComponents),
		strongComponentRepresentatives: flattenCells(strongComponentCells),
		minimumReturnLinks: strongComponentAnalysis.minimumReturnLinks,
		oneWayCorridorOffsets: flattenCorridorOffsets(strongComponentAnalysis.oneWayCorridors),
		oneWayCorridorCells: flattenCorridorCells(strongComponentAnalysis.oneWayCorridors),
		oneWayCorridorBoundaries: flattenCorridorBoundaries(strongComponentAnalysis.oneWayCorridors),
	};
}

export function checksumRailNetworkAnalysis(
	analysis: RailNetworkAnalysis,
	authoredChecksum: string,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([authoredChecksum, analysis.status]);
	checksum.addNumbers([
		analysis.cells,
		analysis.edges,
		analysis.components,
		analysis.openEnds,
		analysis.curves,
		analysis.junctions,
		analysis.unsafeJunctions,
		analysis.strongComponents,
		analysis.stronglyConnected ? 1 : 0,
		analysis.minimumReturnLinks,
	]);
	checksum.addViews([
		analysis.openEndCells,
		analysis.unsafeJunctionCells,
		analysis.componentRepresentatives,
		analysis.strongComponentRepresentatives,
		analysis.oneWayCorridorOffsets,
		analysis.oneWayCorridorCells,
		analysis.oneWayCorridorBoundaries,
	]);
	return checksum.digest();
}

function collectWeakComponentRepresentatives(
	rails: Map<string, { cell: Cell; rail: RailCell }>,
	orderedRails: readonly { cell: Cell; rail: RailCell }[],
): Cell[] {
	const visited = new Set<string>();
	const representatives: Cell[] = [];
	for (const { cell } of orderedRails) {
		const startKey = cellKey(cell.x, cell.y);
		if (visited.has(startKey)) continue;
		representatives.push(cell);
		const stack = [cell];
		while (stack.length > 0) {
			const current = stack.pop() as Cell;
			const key = cellKey(current.x, current.y);
			if (visited.has(key)) continue;
			visited.add(key);
			const currentRail = rails.get(key)?.rail;
			if (!currentRail) continue;
			for (const direction of ALL_DIRECTIONS) {
				const next = moveCell(current, direction);
				const nextRail = rails.get(cellKey(next.x, next.y))?.rail;
				if (!nextRail) continue;
				const currentConnects = ((currentRail.incoming | currentRail.outgoing) & direction) !== 0;
				const nextConnects =
					((nextRail.incoming | nextRail.outgoing) & oppositeDirection(direction)) !== 0;
				if (currentConnects || nextConnects) stack.push(next);
			}
		}
	}
	return representatives;
}

interface StrongComponent {
	representative: Cell;
	cells: Cell[];
}

interface StrongComponentAnalysis {
	representatives: Cell[];
	minimumReturnLinks: number;
	oneWayCorridors: OneWayCorridor[];
}

interface CondensationEdge {
	readonly fromComponent: number;
	readonly toComponent: number;
	readonly from: Cell;
	readonly to: Cell;
}

interface OneWayCorridor {
	readonly departure: CondensationEdge;
	readonly arrival: CondensationEdge;
	readonly cells: readonly Cell[];
}

function collectStrongComponents(
	rails: Map<string, { cell: Cell; rail: RailCell }>,
	orderedRails: readonly { cell: Cell; rail: RailCell }[],
): StrongComponentAnalysis {
	const visited = new Set<string>();
	const finishOrder: Cell[] = [];
	for (const { cell } of orderedRails) {
		const startKey = cellKey(cell.x, cell.y);
		if (visited.has(startKey)) continue;
		visited.add(startKey);
		const stack: Array<{ cell: Cell; directionIndex: number }> = [{ cell, directionIndex: 0 }];
		while (stack.length > 0) {
			const frame = stack[stack.length - 1] as { cell: Cell; directionIndex: number };
			const rail = rails.get(cellKey(frame.cell.x, frame.cell.y))?.rail;
			let descended = false;
			while (rail && frame.directionIndex < ALL_DIRECTIONS.length) {
				const direction = ALL_DIRECTIONS[frame.directionIndex] as Direction;
				frame.directionIndex++;
				if ((rail.outgoing & direction) === 0) continue;
				const next = moveCell(frame.cell, direction);
				const nextKey = cellKey(next.x, next.y);
				if (!rails.has(nextKey) || visited.has(nextKey)) continue;
				visited.add(nextKey);
				stack.push({ cell: next, directionIndex: 0 });
				descended = true;
				break;
			}
			if (descended) continue;
			finishOrder.push(frame.cell);
			stack.pop();
		}
	}

	visited.clear();
	const components: StrongComponent[] = [];
	for (let index = finishOrder.length - 1; index >= 0; index--) {
		const start = finishOrder[index] as Cell;
		const startKey = cellKey(start.x, start.y);
		if (visited.has(startKey)) continue;
		let representative = start;
		const cells: Cell[] = [];
		visited.add(startKey);
		const stack = [start];
		while (stack.length > 0) {
			const current = stack.pop() as Cell;
			cells.push(current);
			if (compareCells(current, representative) < 0) representative = current;
			for (const direction of ALL_DIRECTIONS) {
				const predecessor = moveCell(current, direction);
				const predecessorKey = cellKey(predecessor.x, predecessor.y);
				const predecessorRail = rails.get(predecessorKey)?.rail;
				if (
					!predecessorRail ||
					(predecessorRail.outgoing & oppositeDirection(direction)) === 0 ||
					visited.has(predecessorKey)
				) {
					continue;
				}
				visited.add(predecessorKey);
				stack.push(predecessor);
			}
		}
		components.push({ representative, cells });
	}
	components.sort((left, right) => compareCells(left.representative, right.representative));
	const componentByCell = new Map<string, number>();
	for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
		for (const cell of (components[componentIndex] as StrongComponent).cells) {
			componentByCell.set(cellKey(cell.x, cell.y), componentIndex);
		}
	}
	const edges: CondensationEdge[] = [];
	for (const { cell, rail } of orderedRails) {
		const source = componentByCell.get(cellKey(cell.x, cell.y));
		if (source === undefined) continue;
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) === 0) continue;
			const targetCell = moveCell(cell, direction);
			const target = componentByCell.get(cellKey(targetCell.x, targetCell.y));
			if (target === undefined || target === source) continue;
			edges.push(Object.freeze({
				fromComponent: source,
				toComponent: target,
				from: cell,
				to: targetCell,
			}));
		}
	}
	edges.sort(compareCondensationEdges);
	const incomingCounts = new Uint32Array(components.length);
	const outgoingEdges = Array.from({ length: components.length }, () => [] as CondensationEdge[]);
	for (const edge of edges) {
		incomingCounts[edge.toComponent]++;
		outgoingEdges[edge.fromComponent]?.push(edge);
	}
	const sourceComponents: number[] = [];
	const sinkComponents: number[] = [];
	for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
		if (incomingCounts[componentIndex] === 0) sourceComponents.push(componentIndex);
		if (outgoingEdges[componentIndex]?.length === 0) sinkComponents.push(componentIndex);
	}
	const minimumReturnLinks =
		components.length > 1 ? Math.max(sourceComponents.length, sinkComponents.length) : 0;
	const oneWayCorridors = collectOneWayCorridors(components, edges, incomingCounts, outgoingEdges);
	return {
		representatives: components.map((component) => component.representative),
		minimumReturnLinks,
		oneWayCorridors,
	};
}

function collectOneWayCorridors(
	components: readonly StrongComponent[],
	edges: readonly CondensationEdge[],
	incomingCounts: Uint32Array,
	outgoingEdges: readonly CondensationEdge[][],
): OneWayCorridor[] {
	const visited = new Set<string>();
	const corridors: OneWayCorridor[] = [];
	const trace = (departure: CondensationEdge): void => {
		const departureKey = condensationEdgeKey(departure);
		if (visited.has(departureKey)) return;
		visited.add(departureKey);
		const cells: Cell[] = [departure.from, departure.to];
		let arrival = departure;
		let componentIndex = departure.toComponent;
		while (
			(components[componentIndex]?.cells.length ?? 0) === 1 &&
			incomingCounts[componentIndex] === 1 &&
			outgoingEdges[componentIndex]?.length === 1
		) {
			const next = outgoingEdges[componentIndex]?.[0];
			if (!next || visited.has(condensationEdgeKey(next))) break;
			visited.add(condensationEdgeKey(next));
			const last = cells.at(-1);
			if (!last || compareCells(last, next.from) !== 0) cells.push(next.from);
			cells.push(next.to);
			arrival = next;
			componentIndex = next.toComponent;
		}
		corridors.push(
			Object.freeze({ departure, arrival, cells: Object.freeze(cells.map(freezeCell)) }),
		);
	};

	for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
		const component = components[componentIndex];
		const isBoundary =
			(component?.cells.length ?? 0) > 1 ||
			incomingCounts[componentIndex] !== 1 ||
			outgoingEdges[componentIndex]?.length !== 1;
		if (!isBoundary) continue;
		for (const edge of outgoingEdges[componentIndex] ?? []) trace(edge);
	}
	for (const edge of edges) trace(edge);
	return corridors.sort((left, right) => compareCondensationEdges(left.departure, right.departure));
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

function flattenCorridorOffsets(corridors: readonly OneWayCorridor[]): Uint32Array {
	const offsets = new Uint32Array(corridors.length + 1);
	for (let index = 0; index < corridors.length; index++) {
		offsets[index + 1] = (offsets[index] as number) + (corridors[index]?.cells.length ?? 0);
	}
	return offsets;
}

function flattenCorridorCells(corridors: readonly OneWayCorridor[]): Int32Array {
	const offsets = flattenCorridorOffsets(corridors);
	const flattened = new Int32Array((offsets.at(-1) as number) * 2);
	for (let corridorIndex = 0; corridorIndex < corridors.length; corridorIndex++) {
		const cells = corridors[corridorIndex]?.cells ?? [];
		for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
			const cell = cells[cellIndex] as Cell;
			const offset = ((offsets[corridorIndex] as number) + cellIndex) * 2;
			flattened[offset] = cell.x;
			flattened[offset + 1] = cell.y;
		}
	}
	return flattened;
}

function flattenCorridorBoundaries(corridors: readonly OneWayCorridor[]): Int32Array {
	const flattened = new Int32Array(corridors.length * 8);
	for (let index = 0; index < corridors.length; index++) {
		const corridor = corridors[index] as OneWayCorridor;
		flattened.set(
			[
				corridor.departure.from.x,
				corridor.departure.from.y,
				corridor.departure.to.x,
				corridor.departure.to.y,
				corridor.arrival.from.x,
				corridor.arrival.from.y,
				corridor.arrival.to.x,
				corridor.arrival.to.y,
			],
			index * 8,
		);
	}
	return flattened;
}

function condensationEdgeKey(edge: CondensationEdge): string {
	return [
		edge.fromComponent,
		edge.toComponent,
		edge.from.x,
		edge.from.y,
		edge.to.x,
		edge.to.y,
	].join(":");
}

function compareCondensationEdges(left: CondensationEdge, right: CondensationEdge): number {
	return (
		compareCells(left.from, right.from) ||
		compareCells(left.to, right.to) ||
		left.fromComponent - right.fromComponent ||
		left.toComponent - right.toComponent
	);
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}

function compareCells(left: Cell, right: Cell): number {
	return left.x - right.x || left.y - right.y;
}
