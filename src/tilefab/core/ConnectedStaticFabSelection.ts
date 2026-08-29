import type { EquipmentGroupRecord, PortEquipmentState } from "./EquipmentGroup";
import type { PortRecord } from "./PortRecord";
import { createRailAreaSelectionFromOwnerships, type RailAreaSelection } from "./RailAreaSelection";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "./RailModuleOwnership";
import { ALL_DIRECTIONS, moveCell, oppositeDirection } from "./railShape";
import { createStaticFabSelection, type StaticFabSelection } from "./StaticFabSelection";
import { type Cell, cellKey, type TileMap } from "./TileMap";

export interface ConnectedStaticFabSelectionSeed {
	readonly railModuleKeys?: readonly string[];
	readonly equipmentGroupIds?: readonly number[];
}

export type ConnectedStaticFabSelectionResult =
	| Readonly<{
			valid: true;
			selection: StaticFabSelection;
			railCellCount: number;
	  }>
	| Readonly<{
			valid: false;
			selection: null;
			railCellCount: 0;
			reason: string;
	  }>;

/**
 * Expand an authored seed through exact weak rail adjacency and complete equipment groups.
 * Equipment is a semantic bridge: selecting one support rail includes the whole reciprocal group
 * and every other rail component supporting that group.
 */
export function createConnectedStaticFabSelection(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	seed: ConnectedStaticFabSelectionSeed,
): ConnectedStaticFabSelectionResult {
	if (ownership.revision !== map.getRevision()) {
		return invalid("레일 소유권 인덱스가 오래되어 연결 선택을 다시 시도해야 합니다");
	}
	if (!Number.isSafeInteger(basePatchSequence) || basePatchSequence < 0) {
		return invalid("연결 선택의 Worker 패치 순서가 유효하지 않습니다");
	}

	const moduleKeys = [...new Set(seed.railModuleKeys ?? [])];
	const equipmentGroupIds = [...new Set(seed.equipmentGroupIds ?? [])];
	if (moduleKeys.length === 0 && equipmentGroupIds.length === 0) {
		return invalid("연결 선택을 시작할 레일 또는 장비가 없습니다");
	}

	const modulesBySwitchId = new Map<number, RailModuleOwnership>();
	const modulesByRailCell = new Map<string, RailModuleOwnership[]>();
	for (const module of ownership.modules) {
		if (module.advancedSwitchId !== null) modulesBySwitchId.set(module.advancedSwitchId, module);
		const moduleCells = new Map<string, Cell>();
		for (const edge of module.eraseEdges) {
			moduleCells.set(cellKey(edge.from.x, edge.from.y), edge.from);
			moduleCells.set(cellKey(edge.to.x, edge.to.y), edge.to);
		}
		for (const cell of module.primaryCells) moduleCells.set(cellKey(cell.x, cell.y), cell);
		for (const key of moduleCells.keys()) {
			const modules = modulesByRailCell.get(key) ?? [];
			if (!modules.some((candidate) => candidate.key === module.key)) modules.push(module);
			modulesByRailCell.set(key, modules);
		}
	}
	const portsById = uniqueRecordsById(portEquipment.ports);
	const groupsById = uniqueRecordsById(portEquipment.equipmentGroups);
	const supportCellsByGroup = new Map<number, readonly Cell[]>();
	const groupsBySupportCell = new Map<string, number[]>();

	for (const group of portEquipment.equipmentGroups) {
		if (groupsById.get(group.id) !== group) continue;
		const supportCells = equipmentGroupSupportCells(map, group, portsById, modulesBySwitchId);
		if (!supportCells) continue;
		supportCellsByGroup.set(group.id, supportCells);
		for (const cell of supportCells) {
			const key = cellKey(cell.x, cell.y);
			const groupIds = groupsBySupportCell.get(key) ?? [];
			if (!groupIds.includes(group.id)) groupIds.push(group.id);
			groupsBySupportCell.set(key, groupIds);
		}
	}

	const railQueue: Cell[] = [];
	const visitedRailCells = new Map<string, Cell>();
	const selectedGroupIds = new Set<number>();
	const enqueueRail = (cell: Cell): void => {
		if (!map.hasRail(cell.x, cell.y)) return;
		const key = cellKey(cell.x, cell.y);
		if (visitedRailCells.has(key)) return;
		const copied = Object.freeze({ x: cell.x, y: cell.y });
		visitedRailCells.set(key, copied);
		railQueue.push(copied);
	};
	const enqueueModule = (module: RailModuleOwnership): void => {
		for (const edge of module.eraseEdges) {
			enqueueRail(edge.from);
			enqueueRail(edge.to);
		}
		for (const cell of module.primaryCells) enqueueRail(cell);
	};
	const enqueueEquipmentGroup = (groupId: number): string | null => {
		if (selectedGroupIds.has(groupId)) return null;
		const group = groupsById.get(groupId);
		const supportCells = supportCellsByGroup.get(groupId);
		if (!group || !supportCells) {
			return `장비 그룹 ${groupId}의 포트 관계 또는 지지 레일이 완전하지 않습니다`;
		}
		selectedGroupIds.add(groupId);
		for (const cell of supportCells) enqueueRail(cell);
		return null;
	};

	for (const key of moduleKeys) {
		const module = ownership.find(key);
		if (!module) return invalid(`레일 모듈 ${key}을 현재 맵에서 찾을 수 없습니다`);
		enqueueModule(module);
	}
	for (const groupId of equipmentGroupIds) {
		const reason = enqueueEquipmentGroup(groupId);
		if (reason) return invalid(reason);
	}

	for (let cursor = 0; cursor < railQueue.length; cursor++) {
		const cell = railQueue[cursor] as Cell;
		const rail = map.getRail(cell.x, cell.y);
		for (const module of modulesByRailCell.get(cellKey(cell.x, cell.y)) ?? []) {
			enqueueModule(module);
		}
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(cell, direction);
			if (!map.hasRail(neighbor.x, neighbor.y)) continue;
			const neighborRail = map.getRail(neighbor.x, neighbor.y);
			const opposite = oppositeDirection(direction);
			const reciprocal =
				((rail.outgoing & direction) !== 0 && (neighborRail.incoming & opposite) !== 0) ||
				((rail.incoming & direction) !== 0 && (neighborRail.outgoing & opposite) !== 0);
			if (reciprocal) enqueueRail(neighbor);
		}
		for (const groupId of groupsBySupportCell.get(cellKey(cell.x, cell.y)) ?? []) {
			const reason = enqueueEquipmentGroup(groupId);
			if (reason) return invalid(reason);
		}
	}

	const selectedModules = ownership.modules.filter((module) =>
		moduleTouchesRailCells(module, visitedRailCells),
	);
	if (selectedModules.length === 0) {
		return invalid("선택한 항목에서 연결된 레일 모듈을 찾을 수 없습니다");
	}

	try {
		const rail: RailAreaSelection = createRailAreaSelectionFromOwnerships(
			ownership,
			selectedModules,
			"fully-contained",
		);
		return Object.freeze({
			valid: true,
			selection: createStaticFabSelection(rail, portEquipment, basePatchSequence, [
				...selectedGroupIds,
			]),
			railCellCount: visitedRailCells.size,
		});
	} catch (error) {
		return invalid(error instanceof Error ? error.message : "연결 선택을 만들 수 없습니다");
	}
}

function equipmentGroupSupportCells(
	map: TileMap,
	group: EquipmentGroupRecord,
	portsById: ReadonlyMap<number, PortRecord>,
	modulesBySwitchId: ReadonlyMap<number, RailModuleOwnership>,
): readonly Cell[] | null {
	const cells = new Map<string, Cell>();
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (!port || port.equipmentGroupId !== group.id || port.portType !== group.kind) {
			return null;
		}
		if (port.route.kind === "CARDINAL_CELL") {
			if (!map.hasRail(port.route.x, port.route.z)) return null;
			const cell = Object.freeze({ x: port.route.x, y: port.route.z });
			cells.set(cellKey(cell.x, cell.y), cell);
			continue;
		}
		const module = modulesBySwitchId.get(port.route.switchId);
		if (!module) return null;
		let foundSwitchRail = false;
		for (const edge of module.eraseEdges) {
			for (const cell of [edge.from, edge.to]) {
				if (!map.hasRail(cell.x, cell.y)) continue;
				foundSwitchRail = true;
				cells.set(cellKey(cell.x, cell.y), cell);
			}
		}
		for (const cell of module.primaryCells) {
			if (!map.hasRail(cell.x, cell.y)) continue;
			foundSwitchRail = true;
			cells.set(cellKey(cell.x, cell.y), cell);
		}
		if (!foundSwitchRail) return null;
	}
	return cells.size > 0 ? Object.freeze([...cells.values()]) : null;
}

function moduleTouchesRailCells(
	module: RailModuleOwnership,
	visitedRailCells: ReadonlyMap<string, Cell>,
): boolean {
	for (const edge of module.eraseEdges) {
		if (
			visitedRailCells.has(cellKey(edge.from.x, edge.from.y)) ||
			visitedRailCells.has(cellKey(edge.to.x, edge.to.y))
		) {
			return true;
		}
	}
	return module.primaryCells.some((cell) => visitedRailCells.has(cellKey(cell.x, cell.y)));
}

function uniqueRecordsById<T extends { readonly id: number }>(
	records: readonly T[],
): Map<number, T> {
	const result = new Map<number, T>();
	const duplicates = new Set<number>();
	for (const record of records) {
		if (result.has(record.id)) duplicates.add(record.id);
		else result.set(record.id, record);
	}
	for (const id of duplicates) result.delete(id);
	return result;
}

function invalid(reason: string): ConnectedStaticFabSelectionResult {
	return Object.freeze({ valid: false, selection: null, railCellCount: 0, reason });
}
