import type { PortEquipmentState } from "./EquipmentGroup";
import type { RailReplacementPlan } from "./edit";
import { type RailMutation, railMutationTopologyError } from "./paint";
import type { RailAreaSelection } from "./RailAreaSelection";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import {
	railPatternCandidateIdentity,
	recognizeRailPattern,
	type RailPatternCandidate,
} from "./RailPatternRecognition";
import {
	instantiateRailTemplate,
	railTemplateCatalogItem,
	transformRailTemplateBlueprint,
	type RailTemplateParameters,
} from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	directionBetween,
	isCorner,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "./TileMap";

export interface RailPatternResizeMetadata {
	readonly templateId: RailPatternCandidate["templateId"];
	readonly templateVersion: number;
	readonly anchor: Cell;
	readonly pose: RailPatternCandidate["pose"];
	readonly beforeParameters: RailTemplateParameters;
	readonly afterParameters: RailTemplateParameters;
	readonly beforeEdgeCount: number;
	readonly afterEdgeCount: number;
}

export type RailPatternResizePlan = RailReplacementPlan & {
	readonly patternResize: RailPatternResizeMetadata;
};

/**
 * Replace one recognized closed catalog graph in place. The returned edit is a single immutable
 * authored mutation batch; RailDocument owns undo/redo and the typed Worker patch publication.
 */
export function planRailPatternResize(
	map: TileMap,
	portEquipment: PortEquipmentState,
	selection: RailAreaSelection,
	candidate: RailPatternCandidate,
	afterParameters: RailTemplateParameters,
): RailPatternResizePlan {
	let metadata = resizeMetadata(candidate, afterParameters, candidate.edgeCount);
	if (selection.revision !== map.getRevision()) {
		return invalidResize(map, metadata, "선택 영역이 오래되어 패턴을 다시 선택해야 합니다");
	}
	if (afterParameters.templateId !== candidate.templateId) {
		return invalidResize(map, metadata, "구조 편집 중에는 패턴 종류를 바꿀 수 없습니다");
	}
	const catalogItem = railTemplateCatalogItem(candidate.templateId);
	if (catalogItem.version !== candidate.templateVersion) {
		return invalidResize(map, metadata, "패턴 카탈로그 버전이 변경되어 다시 선택해야 합니다");
	}

	const recognition = recognizeRailPattern(selection);
	const currentCandidate = recognition.candidates.find(
		(match) => railPatternCandidateIdentity(match) === railPatternCandidateIdentity(candidate),
	);
	if (!currentCandidate) {
		return invalidResize(
			map,
			metadata,
			"선택한 레일이 원래 인식한 카탈로그 패턴과 더 이상 일치하지 않습니다",
		);
	}

	const oldEdges = selectedDirectedEdges(selection);
	const oldEdgeKeys = new Set(oldEdges.map(directedEdgeKey));
	const oldCells = uniqueEdgeCells(oldEdges);
	const oldCellKeys = new Set(oldCells.map((cell) => cellKey(cell.x, cell.y)));
	const external = firstExternalAttachment(map, oldEdges, oldEdgeKeys, oldCells);
	if (external) {
		return invalidResize(
			map,
			metadata,
			"선택한 패턴에 외부 분기·합류 레일이 연결되어 있어 v1 구조 편집을 할 수 없습니다",
			[external],
		);
	}
	const ownedPort = portEquipment.ports.find(
		(port) =>
			port.route.kind === "CARDINAL_CELL" && oldCellKeys.has(cellKey(port.route.x, port.route.z)),
	);
	if (ownedPort) {
		const route = ownedPort.route;
		if (route.kind !== "CARDINAL_CELL") {
			return invalidResize(map, metadata, `PORT-${ownedPort.id} route identity가 변경되었습니다`);
		}
		return invalidResize(
			map,
			metadata,
			`PORT-${ownedPort.id}가 선택 패턴에 배치되어 있어 먼저 장비를 이동하거나 철거해야 합니다`,
			[{ x: route.x, y: route.z }],
		);
	}

	let blueprint;
	try {
		blueprint = instantiateRailTemplate(candidate.templateId, afterParameters);
	} catch (error) {
		return invalidResize(
			map,
			metadata,
			error instanceof Error ? error.message : "변경할 패턴 치수가 유효하지 않습니다",
		);
	}
	let transformed;
	try {
		transformed = transformRailTemplateBlueprint(blueprint, candidate.anchor, candidate.pose);
	} catch (error) {
		return invalidResize(
			map,
			metadata,
			error instanceof Error ? error.message : "변경된 패턴 좌표를 만들 수 없습니다",
		);
	}
	const newEdges = routeEdges(transformed.buildRoutes);
	metadata = resizeMetadata(candidate, afterParameters, newEdges.length);
	const expectedOldEdges = routeEdges(
		transformRailTemplateBlueprint(
			instantiateRailTemplate(candidate.templateId, candidate.parameters),
			candidate.anchor,
			candidate.pose,
		).buildRoutes,
	);
	if (!sameEdgeSets(oldEdges, expectedOldEdges)) {
		return invalidResize(
			map,
			metadata,
			"선택한 레일 edge와 인식된 패턴 geometry가 일치하지 않습니다",
		);
	}

	const states = new Map<string, number>();
	const cellsByKey = new Map<string, Cell>();
	const read = (cell: Cell): number => {
		const key = cellKey(cell.x, cell.y);
		return states.get(key) ?? map.getEncoded(cell.x, cell.y);
	};
	const write = (cell: Cell, encoded: number): void => {
		const key = cellKey(cell.x, cell.y);
		states.set(key, encoded);
		cellsByKey.set(key, freezeCell(cell));
	};
	for (const edge of oldEdges) {
		const direction = directionBetween(edge.from, edge.to);
		if (!direction) {
			return invalidResize(map, metadata, "선택 패턴에 인접하지 않은 edge가 있습니다", [edge.from]);
		}
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		const incoming = oppositeDirection(direction);
		if ((from.outgoing & direction) === 0 || (to.incoming & incoming) === 0) {
			return invalidResize(
				map,
				metadata,
				"선택 패턴의 directed edge가 현재 레일과 일치하지 않습니다",
				[edge.from, edge.to],
			);
		}
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~incoming }));
	}

	const newCells = uniqueEdgeCells(newEdges);
	for (const cell of newCells) {
		const switchOwner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (switchOwner) {
			return invalidResize(
				map,
				metadata,
				`변경된 패턴이 고급 스위치 ${switchOwner.id} 영역과 충돌합니다`,
				[cell],
			);
		}
		if (read(cell) !== 0) {
			return invalidResize(map, metadata, "변경된 패턴의 확장 영역에 다른 레일이 있습니다", [cell]);
		}
	}
	for (const edge of newEdges) {
		const direction = directionBetween(edge.from, edge.to);
		if (!direction) {
			return invalidResize(map, metadata, "변경된 패턴에 인접하지 않은 edge가 있습니다", [
				edge.from,
			]);
		}
		const incoming = oppositeDirection(direction);
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing | direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming | incoming }));
	}

	const mutations = Object.freeze(
		[...cellsByKey.values()]
			.map((cell) =>
				Object.freeze({
					x: cell.x,
					y: cell.y,
					before: map.getEncoded(cell.x, cell.y),
					after: read(cell),
				}),
			)
			.filter((mutation) => mutation.before !== mutation.after)
			.sort(compareMutations),
	);
	if (mutations.length === 0) {
		return invalidResize(map, metadata, "변경된 패턴 치수가 없습니다");
	}
	const topologyError = railMutationTopologyError(map, mutations);
	if (topologyError) return invalidResize(map, metadata, topologyError, newCells);

	const affectedCells = Object.freeze(
		[
			...new Map(
				[...oldCells, ...newCells].map((cell) => [cellKey(cell.x, cell.y), freezeCell(cell)]),
			).values(),
		].sort(compareCells),
	);
	return Object.freeze({
		kind: "edit",
		baseRevision: map.getRevision(),
		cells: affectedCells,
		mutations,
		valid: true,
		reason: `${catalogItem.label} 구조를 한 번의 편집으로 변경할 수 있습니다`,
		conflicts: Object.freeze([]),
		newEdges: newEdges.length,
		lengthMeters: newEdges.length,
		turns: countCorners(states, newCells),
		bend: "horizontal-first",
		patternResize: metadata,
	});
}

export function isRailPatternResizePlan(plan: unknown): plan is RailPatternResizePlan {
	return typeof plan === "object" && plan !== null && "patternResize" in plan;
}

function firstExternalAttachment(
	map: TileMap,
	edges: readonly DirectedRailEdge[],
	edgeKeys: ReadonlySet<string>,
	cells: readonly Cell[],
): Cell | null {
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (!direction) return edge.from;
		const from = map.getRail(edge.from.x, edge.from.y);
		const to = map.getRail(edge.to.x, edge.to.y);
		if ((from.outgoing & direction) === 0 || (to.incoming & oppositeDirection(direction)) === 0) {
			return edge.from;
		}
	}
	for (const cell of cells) {
		const rail = map.getRail(cell.x, cell.y);
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) !== 0) {
				const target = moveCell(cell, direction);
				if (!edgeKeys.has(directedEdgeKey({ from: cell, to: target }))) return cell;
			}
			if ((rail.incoming & direction) !== 0) {
				const source = moveCell(cell, direction);
				if (!edgeKeys.has(directedEdgeKey({ from: source, to: cell }))) return cell;
			}
		}
	}
	return null;
}

function selectedDirectedEdges(selection: RailAreaSelection): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const ownership of selection.ownerships) {
		for (const edge of ownership.eraseEdges) edges.set(directedEdgeKey(edge), edge);
	}
	return Object.freeze([...edges.values()].sort(compareEdges));
}

function routeEdges(routes: readonly (readonly Cell[])[]): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const route of routes) {
		for (let index = 0; index < route.length - 1; index++) {
			const from = route[index];
			const to = route[index + 1];
			if (!from || !to) continue;
			const edge = Object.freeze({ from: freezeCell(from), to: freezeCell(to) });
			edges.set(directedEdgeKey(edge), edge);
		}
	}
	return Object.freeze([...edges.values()].sort(compareEdges));
}

function uniqueEdgeCells(edges: readonly DirectedRailEdge[]): readonly Cell[] {
	const cells = new Map<string, Cell>();
	for (const edge of edges) {
		cells.set(cellKey(edge.from.x, edge.from.y), freezeCell(edge.from));
		cells.set(cellKey(edge.to.x, edge.to.y), freezeCell(edge.to));
	}
	return Object.freeze([...cells.values()].sort(compareCells));
}

function sameEdgeSets(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (
			directedEdgeKey(left[index] as DirectedRailEdge) !==
			directedEdgeKey(right[index] as DirectedRailEdge)
		) {
			return false;
		}
	}
	return true;
}

function countCorners(states: ReadonlyMap<string, number>, cells: readonly Cell[]): number {
	let count = 0;
	for (const cell of cells) {
		const rail = decodeRailCell(states.get(cellKey(cell.x, cell.y)) ?? 0);
		if (isCorner(rail.incoming | rail.outgoing)) count++;
	}
	return count;
}

function resizeMetadata(
	candidate: RailPatternCandidate,
	afterParameters: RailTemplateParameters,
	afterEdgeCount: number,
): RailPatternResizeMetadata {
	return Object.freeze({
		templateId: candidate.templateId,
		templateVersion: candidate.templateVersion,
		anchor: freezeCell(candidate.anchor),
		pose: Object.freeze({ ...candidate.pose }),
		beforeParameters: Object.freeze({ ...candidate.parameters }),
		afterParameters: Object.freeze({ ...afterParameters }),
		beforeEdgeCount: candidate.edgeCount,
		afterEdgeCount,
	});
}

function invalidResize(
	map: TileMap,
	metadata: RailPatternResizeMetadata,
	reason: string,
	conflicts: readonly Cell[] = [],
): RailPatternResizePlan {
	return Object.freeze({
		kind: "edit",
		baseRevision: map.getRevision(),
		cells: Object.freeze(conflicts.map(freezeCell)),
		mutations: Object.freeze([]),
		valid: false,
		reason,
		conflicts: Object.freeze(conflicts.map(freezeCell)),
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		patternResize: metadata,
	});
}

function directedEdgeKey(edge: DirectedRailEdge): string {
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

function compareMutations(left: RailMutation, right: RailMutation): number {
	return left.y - right.y || left.x - right.x;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
