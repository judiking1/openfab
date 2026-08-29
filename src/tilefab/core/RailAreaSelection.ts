import type { AdvancedSwitchMutation } from "./AdvancedSwitch";
import { type RailErasePlan, type RailMutation, railMutationTopologyError } from "./paint";
import type {
	DirectedRailEdge,
	RailModuleOwnership,
	RailModuleOwnershipIndex,
} from "./RailModuleOwnership";
import { directionBetween, oppositeDirection } from "./railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "./TileMap";

export type RailAreaSelectionMode = "intersect" | "fully-contained";

export interface RailAreaSelectionBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/** A transient, revision-bound selection over semantic rail-module ownership. */
export interface RailAreaSelection {
	readonly revision: number;
	readonly bounds: RailAreaSelectionBounds;
	readonly mode: RailAreaSelectionMode;
	readonly ownerships: readonly RailModuleOwnership[];
}

/** Normalize a drag in either direction without enumerating any cells inside the rectangle. */
export function normalizeRailAreaSelectionBounds(start: Cell, end: Cell): RailAreaSelectionBounds {
	assertIntegerCoordinate(start.x, "selection start x");
	assertIntegerCoordinate(start.y, "selection start y");
	assertIntegerCoordinate(end.x, "selection end x");
	assertIntegerCoordinate(end.y, "selection end y");
	return Object.freeze({
		minX: Math.min(start.x, end.x),
		minY: Math.min(start.y, end.y),
		maxX: Math.max(start.x, end.x),
		maxY: Math.max(start.y, end.y),
	});
}

/**
 * Select semantic modules by testing their finite ownership footprints. Cost is proportional to the
 * ownership index, never to the rectangle's width multiplied by its height.
 */
export function createRailAreaSelection(
	index: RailModuleOwnershipIndex,
	start: Cell,
	end: Cell,
	mode: RailAreaSelectionMode = "intersect",
): RailAreaSelection {
	assertSelectionMode(mode);
	const bounds = normalizeRailAreaSelectionBounds(start, end);
	const ownerships = index.modules.filter((ownership) =>
		ownershipMatchesBounds(ownership, bounds, mode),
	);
	return Object.freeze({
		revision: index.revision,
		bounds,
		mode,
		ownerships: Object.freeze(ownerships),
	});
}

/** Create a revision-bound empty rail envelope for an equipment-only semantic selection. */
export function createEmptyRailAreaSelection(
	index: RailModuleOwnershipIndex,
	anchor: Cell,
): RailAreaSelection {
	const bounds = normalizeRailAreaSelectionBounds(anchor, anchor);
	return Object.freeze({
		revision: index.revision,
		bounds,
		mode: "intersect",
		ownerships: Object.freeze([]),
	});
}

/**
 * Create an exact revision-bound selection from already-derived ownership membership.
 *
 * Hierarchy and graph compilers use this adapter so nonrectangular scopes do not have to pretend
 * they came from one marquee rectangle. The bounds remain a derived presentation envelope only.
 */
export function createRailAreaSelectionFromOwnerships(
	index: RailModuleOwnershipIndex,
	ownerships: readonly RailModuleOwnership[],
	mode: RailAreaSelectionMode = "intersect",
): RailAreaSelection {
	assertSelectionMode(mode);
	if (ownerships.length === 0) {
		throw new Error("정확한 레일 영역 선택에는 하나 이상의 모듈이 필요합니다");
	}
	const unique = new Map<string, RailModuleOwnership>();
	for (const ownership of ownerships) {
		if (ownership.revision !== index.revision) {
			throw new Error(`모듈 ${ownership.key}의 revision이 현재 소유권 인덱스와 다릅니다`);
		}
		const current = index.find(ownership.key);
		if (!current || !sameOwnership(current, ownership)) {
			throw new Error(`모듈 ${ownership.key}을 현재 소유권 인덱스에서 확인할 수 없습니다`);
		}
		if (unique.has(ownership.key)) {
			throw new Error(`정확한 레일 영역 선택에 모듈 ${ownership.key}이 중복되었습니다`);
		}
		unique.set(ownership.key, current);
	}
	const ordered = [...unique.values()].sort((left, right) =>
		left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
	);
	const cells = cellsFromOwnerships(ordered);
	const bounds = cellBounds(cells);
	return Object.freeze({
		revision: index.revision,
		bounds,
		mode,
		ownerships: Object.freeze(ordered),
	});
}

/** Add another drag result to a revision-bound semantic selection without duplicating modules. */
export function unionRailAreaSelections(
	current: RailAreaSelection | null,
	incoming: RailAreaSelection,
): RailAreaSelection {
	if (!current) return incoming;
	if (current.revision !== incoming.revision) {
		throw new Error("서로 다른 레일 revision의 영역 선택은 합칠 수 없습니다");
	}
	if (incoming.ownerships.length === 0) return current;
	if (current.ownerships.length === 0) return incoming;

	const ownershipByKey = new Map<string, RailModuleOwnership>();
	for (const ownership of [...current.ownerships, ...incoming.ownerships]) {
		const existing = ownershipByKey.get(ownership.key);
		if (existing && !sameOwnership(existing, ownership)) {
			throw new Error(`모듈 ${ownership.key}의 소유권이 선택 중 변경되었습니다`);
		}
		ownershipByKey.set(ownership.key, ownership);
	}

	return Object.freeze({
		revision: current.revision,
		bounds: Object.freeze({
			minX: Math.min(current.bounds.minX, incoming.bounds.minX),
			minY: Math.min(current.bounds.minY, incoming.bounds.minY),
			maxX: Math.max(current.bounds.maxX, incoming.bounds.maxX),
			maxY: Math.max(current.bounds.maxY, incoming.bounds.maxY),
		}),
		mode: "intersect",
		ownerships: Object.freeze(
			[...ownershipByKey.values()].sort((left, right) =>
				left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
			),
		),
	});
}

/**
 * Remove exact semantic modules named by another revision-bound selection.
 *
 * The result keeps a valid empty rail envelope so a StaticFabSelection may still contain only
 * equipment groups. Bounds are otherwise recomputed from the surviving authored modules instead
 * of retaining a stale marquee rectangle.
 */
export function subtractRailAreaSelections(
	current: RailAreaSelection,
	incoming: RailAreaSelection,
): RailAreaSelection {
	assertRailAreaSelectionIntegrity(current, "현재");
	assertRailAreaSelectionIntegrity(incoming, "제외할");
	if (current.revision !== incoming.revision) {
		throw new Error("서로 다른 레일 revision의 영역 선택은 제외할 수 없습니다");
	}
	if (current.ownerships.length === 0 || incoming.ownerships.length === 0) return current;

	const incomingByKey = new Map<string, RailModuleOwnership>();
	for (const ownership of incoming.ownerships) {
		incomingByKey.set(ownership.key, ownership);
	}

	let changed = false;
	const remaining = current.ownerships.filter((ownership) => {
		const removed = incomingByKey.get(ownership.key);
		if (!removed) return true;
		if (!sameOwnership(ownership, removed)) {
			throw new Error(`모듈 ${ownership.key}의 소유권이 선택 중 변경되었습니다`);
		}
		changed = true;
		return false;
	});
	if (!changed) return current;

	return Object.freeze({
		revision: current.revision,
		bounds:
			remaining.length > 0
				? cellBounds(cellsFromOwnerships(remaining))
				: Object.freeze({ ...current.bounds }),
		mode: "intersect",
		ownerships: Object.freeze([...remaining]),
	});
}

/** Verify that a transient selection still names the exact current semantic ownership snapshot. */
export function railAreaSelectionStaleReason(
	map: TileMap,
	currentIndex: RailModuleOwnershipIndex,
	selection: RailAreaSelection,
): string | null {
	if (selection.revision !== map.getRevision() || currentIndex.revision !== map.getRevision()) {
		return "선택 영역 또는 레일 모듈 인덱스가 오래되어 다시 선택해야 합니다";
	}
	if (!isSelectionMode(selection.mode) || normalizedBoundsError(selection.bounds)) {
		return "선택 영역 정의가 현재 편집기 규격과 일치하지 않습니다";
	}
	const keys = new Set<string>();
	for (const selected of selection.ownerships) {
		if (selected.revision !== selection.revision) {
			return `선택한 모듈 ${selected.key}의 revision이 만료되었습니다`;
		}
		if (keys.has(selected.key)) return `선택 영역에 중복된 모듈 ${selected.key}가 있습니다`;
		keys.add(selected.key);
		const current = currentIndex.find(selected.key);
		if (!current || !sameOwnership(current, selected)) {
			return `레일 토폴로지가 변경되어 모듈 ${selected.key}의 소유권이 만료되었습니다`;
		}
	}
	return null;
}

/**
 * Union exact directed ownership edges into one atomic erase plan. The caller can commit the result
 * once through RailDocument, producing one undo entry and one typed Worker patch.
 */
export function planRailAreaBulldoze(
	map: TileMap,
	currentIndex: RailModuleOwnershipIndex,
	selection: RailAreaSelection,
): RailErasePlan {
	const selectionCells = cellsFromOwnerships(selection.ownerships);
	const boundsError = normalizedBoundsError(selection.bounds);
	if (boundsError) return invalidAreaBulldoze(map, selectionCells, boundsError);
	if (!isSelectionMode(selection.mode)) {
		return invalidAreaBulldoze(map, selectionCells, "선택 영역 모드가 유효하지 않습니다");
	}
	if (currentIndex.revision !== map.getRevision()) {
		return invalidAreaBulldoze(
			map,
			selectionCells,
			"현재 모듈 소유권 인덱스가 오래되어 다시 선택해야 합니다",
		);
	}
	if (selection.revision !== currentIndex.revision) {
		return invalidAreaBulldoze(map, selectionCells, "선택 영역이 오래되어 다시 선택해야 합니다");
	}
	if (selection.ownerships.length === 0) {
		return invalidAreaBulldoze(map, [], "철거할 레일 모듈이 선택되지 않았습니다");
	}

	const selectedKeys = new Set<string>();
	const currentByKey = new Map<string, RailModuleOwnership>();
	for (const selected of selection.ownerships) {
		if (selectedKeys.has(selected.key)) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`선택 영역에 중복된 모듈 ${selected.key}가 있습니다`,
			);
		}
		selectedKeys.add(selected.key);
		if (selected.revision !== selection.revision) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`선택한 모듈 ${selected.key}의 revision이 만료되었습니다`,
			);
		}
		const current = currentIndex.find(selected.key);
		if (!current || !sameOwnership(current, selected)) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`레일 토폴로지가 변경되어 모듈 ${selected.key}의 소유권이 만료되었습니다`,
			);
		}
		currentByKey.set(current.key, current);
	}

	const currentOwnerships = currentIndex.modules.filter((ownership) =>
		currentByKey.has(ownership.key),
	);
	if (currentOwnerships.length !== selection.ownerships.length) {
		return invalidAreaBulldoze(
			map,
			selectionCells,
			"선택한 모듈 집합을 현재 소유권 인덱스에서 확인할 수 없습니다",
		);
	}

	const edgeByKey = new Map<string, DirectedRailEdge>();
	const switchMutationById = new Map<number, AdvancedSwitchMutation>();
	for (const ownership of currentOwnerships) {
		if (ownership.kind === "advanced-switch" && ownership.advancedSwitchId === null) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`고급 스위치 ${ownership.key}의 sidecar identity가 없습니다`,
			);
		}
		if (ownership.kind !== "advanced-switch" && ownership.advancedSwitchId !== null) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`일반 모듈 ${ownership.key}에 잘못된 스위치 identity가 있습니다`,
			);
		}
		for (const edge of ownership.eraseEdges) edgeByKey.set(directedEdgeKey(edge), edge);
		if (ownership.advancedSwitchId === null) continue;
		if (switchMutationById.has(ownership.advancedSwitchId)) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`고급 스위치 ${ownership.advancedSwitchId}가 중복 선택되었습니다`,
			);
		}
		const record = map.getAdvancedSwitch(ownership.advancedSwitchId);
		if (!record) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`고급 스위치 ${ownership.advancedSwitchId}의 sidecar를 찾을 수 없습니다`,
			);
		}
		switchMutationById.set(
			ownership.advancedSwitchId,
			Object.freeze({ id: record.id, before: record, after: null }),
		);
	}
	if (edgeByKey.size === 0) {
		return invalidAreaBulldoze(map, selectionCells, "선택한 모듈에 철거할 edge가 없습니다");
	}

	const edges = [...edgeByKey.values()].sort(compareEdges);
	const overlay = new Map<string, RailMutation>();
	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, after: number): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = overlay.get(key);
		overlay.set(key, {
			x: cell.x,
			y: cell.y,
			before: existing?.before ?? map.getEncoded(cell.x, cell.y),
			after,
		});
	};
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`모듈 소유 edge ${directedEdgeKey(edge)}가 인접하지 않습니다`,
			);
		}
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(edge.from));
		const to = decodeRailCell(read(edge.to));
		if ((from.outgoing & direction) === 0 || (to.incoming & opposite) === 0) {
			return invalidAreaBulldoze(
				map,
				selectionCells,
				`모듈 소유 edge ${directedEdgeKey(edge)}가 현재 레일과 일치하지 않습니다`,
			);
		}
		write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
	}

	const mutations = Object.freeze(
		[...overlay.values()]
			.filter((mutation) => mutation.before !== mutation.after)
			.sort(compareMutations)
			.map((mutation) => Object.freeze({ ...mutation })),
	);
	const switchMutations = Object.freeze(
		[...switchMutationById.values()].sort((left, right) => left.id - right.id),
	);
	const topologyError = railMutationTopologyError(map, mutations, switchMutations);
	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: cellsFromOwnerships(currentOwnerships),
		mutations,
		switchMutations,
		valid: mutations.length > 0 && topologyError === null,
		reason:
			topologyError ??
			(mutations.length > 0
				? `선택한 레일 모듈 ${currentOwnerships.length}개 일괄 철거`
				: "철거할 edge가 없습니다"),
	};
}

function ownershipMatchesBounds(
	ownership: RailModuleOwnership,
	bounds: RailAreaSelectionBounds,
	mode: RailAreaSelectionMode,
): boolean {
	if (ownership.footprintCells.length === 0) return false;
	return mode === "fully-contained"
		? ownership.footprintCells.every((cell) => cellInsideBounds(cell, bounds))
		: ownership.footprintCells.some((cell) => cellInsideBounds(cell, bounds));
}

function cellInsideBounds(cell: Cell, bounds: RailAreaSelectionBounds): boolean {
	return (
		cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.y >= bounds.minY && cell.y <= bounds.maxY
	);
}

function sameOwnership(left: RailModuleOwnership, right: RailModuleOwnership): boolean {
	return (
		left.revision === right.revision &&
		left.key === right.key &&
		left.kind === right.kind &&
		left.advancedSwitchId === right.advancedSwitchId &&
		sameCellSet(left.primaryCells, right.primaryCells) &&
		sameCellSet(left.footprintCells, right.footprintCells) &&
		sameEdgeSet(left.eraseEdges, right.eraseEdges) &&
		sameBoundaries(left.boundaries, right.boundaries) &&
		left.construction.catalogId === right.construction.catalogId &&
		left.construction.grammar === right.construction.grammar &&
		left.construction.forward === right.construction.forward &&
		left.construction.span === right.construction.span &&
		left.construction.side === right.construction.side &&
		left.construction.advancedSwitchProfile === right.construction.advancedSwitchProfile &&
		left.construction.lengthMeters === right.construction.lengthMeters
	);
}

function assertRailAreaSelectionIntegrity(
	selection: RailAreaSelection,
	label: "현재" | "제외할",
): void {
	const keys = new Set<string>();
	for (const ownership of selection.ownerships) {
		if (ownership.revision !== selection.revision) {
			throw new Error(`${label} 레일 선택의 모듈 ${ownership.key} revision이 일치하지 않습니다`);
		}
		if (keys.has(ownership.key)) {
			throw new Error(`${label} 레일 선택에 모듈 ${ownership.key}이 중복되었습니다`);
		}
		keys.add(ownership.key);
	}
}

function sameCellSet(left: readonly Cell[], right: readonly Cell[]): boolean {
	if (left.length !== right.length) return false;
	const leftKeys = new Set(left.map((cell) => cellKey(cell.x, cell.y)));
	const rightKeys = new Set(right.map((cell) => cellKey(cell.x, cell.y)));
	return (
		leftKeys.size === left.length &&
		rightKeys.size === right.length &&
		[...rightKeys].every((key) => leftKeys.has(key))
	);
}

function sameEdgeSet(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): boolean {
	if (left.length !== right.length) return false;
	const leftKeys = new Set(left.map(directedEdgeKey));
	const rightKeys = new Set(right.map(directedEdgeKey));
	return (
		leftKeys.size === left.length &&
		rightKeys.size === right.length &&
		[...rightKeys].every((key) => leftKeys.has(key))
	);
}

function sameBoundaries(
	left: RailModuleOwnership["boundaries"],
	right: RailModuleOwnership["boundaries"],
): boolean {
	if (left.length !== right.length) return false;
	const key = (boundary: RailModuleOwnership["boundaries"][number]): string =>
		`${boundary.role}:${cellKey(boundary.cell.x, boundary.cell.y)}:${boundary.direction}`;
	const leftKeys = new Set(left.map(key));
	const rightKeys = new Set(right.map(key));
	return (
		leftKeys.size === left.length &&
		rightKeys.size === right.length &&
		[...rightKeys].every((boundaryKey) => leftKeys.has(boundaryKey))
	);
}

function cellsFromOwnerships(ownerships: readonly RailModuleOwnership[]): readonly Cell[] {
	const cells = new Map<string, Cell>();
	for (const ownership of ownerships) {
		for (const cell of ownership.footprintCells) cells.set(cellKey(cell.x, cell.y), cell);
	}
	return Object.freeze(
		[...cells.values()].sort(compareCells).map((cell) => Object.freeze({ x: cell.x, y: cell.y })),
	);
}

function cellBounds(cells: readonly Cell[]): RailAreaSelectionBounds {
	const first = cells[0];
	if (!first) throw new Error("레일 모듈 footprint가 비어 있습니다");
	let minX = first.x;
	let minY = first.y;
	let maxX = first.x;
	let maxY = first.y;
	for (const cell of cells.slice(1)) {
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
		maxX = Math.max(maxX, cell.x);
		maxY = Math.max(maxY, cell.y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function invalidAreaBulldoze(map: TileMap, cells: readonly Cell[], reason: string): RailErasePlan {
	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells,
		mutations: [],
		switchMutations: [],
		valid: false,
		reason,
	};
}

function normalizedBoundsError(bounds: RailAreaSelectionBounds): string | null {
	for (const [label, value] of [
		["minX", bounds.minX],
		["minY", bounds.minY],
		["maxX", bounds.maxX],
		["maxY", bounds.maxY],
	] as const) {
		if (!Number.isSafeInteger(value)) return `선택 영역 ${label}는 정수여야 합니다`;
	}
	if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
		return "선택 영역 bounds가 정규화되지 않았습니다";
	}
	return null;
}

function assertIntegerCoordinate(value: number, label: string): void {
	if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer.`);
}

function assertSelectionMode(mode: RailAreaSelectionMode): void {
	if (!isSelectionMode(mode)) throw new TypeError(`Unsupported rail area selection mode ${mode}.`);
}

function isSelectionMode(mode: string): mode is RailAreaSelectionMode {
	return mode === "intersect" || mode === "fully-contained";
}

function directedEdgeKey(edge: DirectedRailEdge): string {
	return `${cellKey(edge.from.x, edge.from.y)}>${cellKey(edge.to.x, edge.to.y)}`;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return compareCells(left.from, right.from) || compareCells(left.to, right.to);
}

function compareMutations(left: RailMutation, right: RailMutation): number {
	return left.y - right.y || left.x - right.x;
}
