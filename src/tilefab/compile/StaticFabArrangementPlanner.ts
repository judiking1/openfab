import {
	type AdvancedSwitchMutation,
	copyAdvancedSwitch,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { applyPortEquipmentMutations, type PortEquipmentState } from "../core/EquipmentGroup";
import { portEquipmentLayoutError } from "../core/PortEquipmentLayoutValidator";
import { copyPortRecord, type PortMutation, type PortRecord } from "../core/PortRecord";
import { type RailMutation, railMutationTopologyError } from "../core/paint";
import type { DirectedRailEdge, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell, oppositeDirection } from "../core/railShape";
import type { StaticFabArrangementResult } from "../core/StaticFabArrangement";
import {
	STATIC_FAB_ARRANGEMENT_PLAN_KIND,
	STATIC_FAB_ARRANGEMENT_PLAN_VERSION,
	type StaticFabArrangementPlan,
	type StaticFabArrangementPlanIssueCode,
} from "../core/StaticFabArrangementPlan";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import { staticFabSelectionStaleReason } from "../core/StaticFabSelection";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { additionalStaticFabArrangementClearanceCells } from "./StaticFabArrangementClearance";
import type { ResolvedStaticFabArrangementRoot } from "./StaticFabArrangementRoots";

export const STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES = 200_000;
export const STATIC_FAB_ARRANGEMENT_MAX_PORTS = 100_000;

interface RootMove {
	readonly root: ResolvedStaticFabArrangementRoot;
	readonly deltaX: number;
	readonly deltaZ: number;
}

interface SelectedRailEdge {
	readonly rootKey: string;
	readonly edge: DirectedRailEdge;
	readonly translated: DirectedRailEdge;
}

/** Plan one simultaneous, existing-ID arrangement over exact resolved roots. */
export function planStaticFabArrangement(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
	roots: readonly ResolvedStaticFabArrangementRoot[],
	arrangement: StaticFabArrangementResult,
): StaticFabArrangementPlan {
	if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"INVALID_ARRANGEMENT",
			"편집 순서가 유효하지 않습니다",
		);
	}
	if (!arrangement.valid) {
		return invalid(map, patchSequence, organizations, "INVALID_ARRANGEMENT", arrangement.reason);
	}
	if (roots.length === 0) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"EMPTY_SELECTION",
			"정렬할 정적 FAB 루트가 없습니다",
		);
	}
	const moves = resolveRootMoves(roots, arrangement);
	if (typeof moves === "string") {
		return invalid(map, patchSequence, organizations, "INVALID_ARRANGEMENT", moves);
	}
	for (const move of moves) {
		const staleReason = staticFabSelectionStaleReason(
			map,
			ownership,
			portEquipment,
			patchSequence,
			move.root.selection,
		);
		if (staleReason) {
			return invalid(map, patchSequence, organizations, "STALE_SELECTION", staleReason);
		}
	}

	const selected = collectSelectedContent(map, portEquipment, moves);
	if (!selected.valid) {
		return invalid(
			map,
			patchSequence,
			organizations,
			selected.code,
			selected.reason,
			selected.conflicts,
		);
	}
	if (selected.edges.length > STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"LIMIT_EXCEEDED",
			`한 번에 이동할 수 있는 레일 edge ${STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES.toLocaleString()}개를 초과했습니다`,
		);
	}
	if (selected.ports.length > STATIC_FAB_ARRANGEMENT_MAX_PORTS) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"LIMIT_EXCEEDED",
			`한 번에 이동할 수 있는 포트 ${STATIC_FAB_ARRANGEMENT_MAX_PORTS.toLocaleString()}개를 초과했습니다`,
		);
	}

	const external = externalAttachmentCells(map, selected.edges, selected.sourceCellCoordinates);
	if (external.length > 0) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"EXTERNAL_ATTACHMENT",
			"선택 루트가 이동하지 않는 레일과 연결되어 있습니다 · 상위 폐쇄 루프를 함께 선택하세요",
			external,
		);
	}
	const targetCheck = validateTargetFootprints(map, selected);
	if (!targetCheck.valid) {
		return invalid(
			map,
			patchSequence,
			organizations,
			targetCheck.code,
			targetCheck.reason,
			targetCheck.conflicts,
		);
	}

	const railMutations = buildTranslatedRailMutations(map, selected.edges);
	if (typeof railMutations === "string") {
		return invalid(map, patchSequence, organizations, "TOPOLOGY_INVALID", railMutations);
	}
	const topologyError = railMutationTopologyError(map, railMutations, selected.switchMutations);
	if (topologyError) {
		return invalid(map, patchSequence, organizations, "TOPOLOGY_INVALID", topologyError);
	}

	let prospectiveMap: TileMap;
	try {
		prospectiveMap = map.clone();
		prospectiveMap.applyAtomicMutations(railMutations, selected.switchMutations);
	} catch (error) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"TOPOLOGY_INVALID",
			errorMessage(error, "정렬 레일 topology를 적용할 수 없습니다"),
		);
	}
	const prospectiveEquipment = applyPortEquipmentMutations(
		portEquipment,
		selected.portMutations,
		[],
	);
	const equipmentError = portEquipmentLayoutError(prospectiveMap, prospectiveEquipment);
	if (equipmentError) {
		return invalid(map, patchSequence, organizations, "PORT_LAYOUT_INVALID", equipmentError);
	}

	const organizationPlan = planOrganizationRelocation(
		organizations,
		selected.edges,
		new Set(selected.switchMutations.map((mutation) => mutation.id)),
		selected.movedEquipmentGroupIds,
	);
	let prospectiveOrganizations: StaticFabOrganizationState;
	try {
		prospectiveOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			organizationPlan.mutations,
			organizations.nextOrganizationId,
			true,
		);
	} catch (error) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"ORGANIZATION_INVALID",
			errorMessage(error, "정적 FAB 조직 membership을 이동할 수 없습니다"),
		);
	}
	const organizationError = staticFabOrganizationStateError(
		prospectiveMap,
		prospectiveEquipment,
		prospectiveOrganizations,
	);
	if (organizationError) {
		return invalid(map, patchSequence, organizations, "ORGANIZATION_INVALID", organizationError);
	}
	try {
		const sourceLayout = compilePhysicalRail(map);
		const prospectiveLayout = compilePhysicalRail(prospectiveMap);
		const clearanceConflicts = additionalStaticFabArrangementClearanceCells(
			sourceLayout,
			prospectiveLayout,
		);
		if (clearanceConflicts.length > 0) {
			return invalid(
				map,
				patchSequence,
				organizations,
				"CLEARANCE_INVALID",
				"정렬 후 기존에 없던 레일 물리 간섭이 생깁니다",
				clearanceConflicts,
			);
		}
	} catch (error) {
		return invalid(
			map,
			patchSequence,
			organizations,
			"COMPILE_FAILURE",
			errorMessage(error, "정렬 후 물리 레일을 컴파일할 수 없습니다"),
		);
	}

	const translations = Object.freeze(arrangement.translations.map((translation) => translation));
	return Object.freeze({
		kind: STATIC_FAB_ARRANGEMENT_PLAN_KIND,
		baseRevision: map.getRevision(),
		basePatchSequence: patchSequence,
		valid: true,
		reason: `${moves.length}개 루트 · 레일 ${selected.edges.length}개 · 포트 ${selected.ports.length}개를 기존 ID 그대로 정렬합니다`,
		issueCode: null,
		cells: freezeCells([
			...selected.sourceCellCoordinates.values(),
			...selected.targetCellCoordinates.values(),
		]),
		conflicts: Object.freeze([]),
		mutations: railMutations,
		switchMutations: selected.switchMutations,
		portMutations: selected.portMutations,
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: organizationPlan.mutations,
		organizationImpactAuthorizations: organizationPlan.affectedOrganizationIds,
		nextOrganizationIdBefore: organizations.nextOrganizationId,
		nextOrganizationIdAfter: organizations.nextOrganizationId,
		arrangement: Object.freeze({
			version: STATIC_FAB_ARRANGEMENT_PLAN_VERSION,
			axis: arrangement.axis,
			mode: arrangement.mode,
			translations,
			maximumSnapErrorMeters: arrangement.maximumSnapErrorMeters,
			rootCount: moves.length,
			moduleCount: selected.moduleKeys.size,
			railEdgeCount: selected.edges.length,
			advancedSwitchCount: selected.switchIds.size,
			portCount: selected.ports.length,
			equipmentGroupCount: selected.equipmentGroupIds.size,
			affectedOrganizationIds: organizationPlan.affectedOrganizationIds,
		}),
	});
}

function resolveRootMoves(
	roots: readonly ResolvedStaticFabArrangementRoot[],
	arrangement: Extract<StaticFabArrangementResult, { readonly valid: true }>,
): readonly RootMove[] | string {
	if (arrangement.translations.length !== roots.length) {
		return "정렬 결과와 루트 수가 일치하지 않습니다";
	}
	const rootByKey = new Map<string, ResolvedStaticFabArrangementRoot>();
	for (const root of roots) {
		if (rootByKey.has(root.key)) return `정렬 루트 '${root.key}'가 중복되었습니다`;
		rootByKey.set(root.key, root);
	}
	const moves: RootMove[] = [];
	for (const translation of arrangement.translations) {
		const root = rootByKey.get(translation.key);
		if (!root) return `정렬 결과의 루트 '${translation.key}'가 현재 선택에 없습니다`;
		if (!sameBounds(root.bounds, translation.before)) {
			return `정렬 루트 '${root.key}'의 footprint가 계산 이후 변경되었습니다`;
		}
		if (!isInt32(translation.deltaX) || !isInt32(translation.deltaZ)) {
			return `정렬 루트 '${root.key}'의 이동량이 signed int32 범위를 벗어납니다`;
		}
		moves.push(Object.freeze({ root, deltaX: translation.deltaX, deltaZ: translation.deltaZ }));
		rootByKey.delete(root.key);
	}
	if (rootByKey.size > 0) return "일부 정렬 루트에 이동 결과가 없습니다";
	return Object.freeze(moves.sort((left, right) => compareText(left.root.key, right.root.key)));
}

type SelectedContentResult =
	| ({ readonly valid: true } & SelectedContent)
	| {
			readonly valid: false;
			readonly code: StaticFabArrangementPlanIssueCode;
			readonly reason: string;
			readonly conflicts: readonly Cell[];
	  };

interface SelectedContent {
	readonly edges: readonly SelectedRailEdge[];
	readonly sourceCells: ReadonlySet<string>;
	readonly sourceCellCoordinates: ReadonlyMap<string, Cell>;
	readonly targetCellsByRoot: ReadonlyMap<string, ReadonlySet<string>>;
	readonly targetCellCoordinates: ReadonlyMap<string, Cell>;
	readonly switchMutations: readonly AdvancedSwitchMutation[];
	readonly switchIds: ReadonlySet<number>;
	readonly ports: readonly PortRecord[];
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupIds: ReadonlySet<number>;
	readonly movedEquipmentGroupIds: ReadonlySet<number>;
	readonly moduleKeys: ReadonlySet<string>;
}

function collectSelectedContent(
	map: TileMap,
	portEquipment: PortEquipmentState,
	moves: readonly RootMove[],
): SelectedContentResult {
	const edgeByKey = new Map<string, SelectedRailEdge>();
	const sourceCellRoot = new Map<string, string>();
	const sourceCellCoordinates = new Map<string, Cell>();
	const targetCellsByRoot = new Map<string, Set<string>>();
	const targetCellCoordinates = new Map<string, Cell>();
	const switchIds = new Set<number>();
	const switchMutations: AdvancedSwitchMutation[] = [];
	const equipmentGroupIds = new Set<number>();
	const movedEquipmentGroupIds = new Set<number>();
	const moduleKeys = new Set<string>();
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port] as const));
	const groupsById = new Map(
		portEquipment.equipmentGroups.map((group) => [group.id, group] as const),
	);
	const ports: PortRecord[] = [];
	const portMutations: PortMutation[] = [];

	const claimSourceCell = (rootKey: string, cell: Cell): string | null => {
		const key = cellKey(cell.x, cell.y);
		const previous = sourceCellRoot.get(key);
		if (previous && previous !== rootKey) {
			return `정렬 루트 '${previous}'와 '${rootKey}'가 X ${cell.x} · Z ${cell.y} footprint를 공유합니다`;
		}
		sourceCellRoot.set(key, rootKey);
		sourceCellCoordinates.set(key, Object.freeze({ x: cell.x, y: cell.y }));
		return null;
	};
	const claimTargetCell = (rootKey: string, cell: Cell): void => {
		const key = cellKey(cell.x, cell.y);
		const keys = targetCellsByRoot.get(rootKey) ?? new Set<string>();
		keys.add(key);
		targetCellsByRoot.set(rootKey, keys);
		targetCellCoordinates.set(key, Object.freeze({ x: cell.x, y: cell.y }));
	};

	for (const move of moves) {
		for (const module of move.root.selection.rail.ownerships) {
			if (moduleKeys.has(module.key))
				return selectedFailure(
					"ROOT_OVERLAP",
					`레일 모듈 '${module.key}'이 둘 이상의 정렬 루트에 포함됩니다`,
				);
			moduleKeys.add(module.key);
			for (const cell of module.footprintCells) {
				const error = claimSourceCell(move.root.key, cell);
				if (error) return selectedFailure("ROOT_OVERLAP", error, [cell]);
				const translated = translateCell(cell, move.deltaX, move.deltaZ);
				if (!translated)
					return selectedFailure(
						"COORDINATE_OVERFLOW",
						`레일 모듈 '${module.key}'이 signed int32 좌표 범위를 벗어납니다`,
						[cell],
					);
				claimTargetCell(move.root.key, translated);
			}
			for (const edge of module.eraseEdges) {
				const key = staticFabOrganizationEdgeKey(edge);
				const existing = edgeByKey.get(key);
				if (existing && existing.rootKey !== move.root.key) {
					return selectedFailure(
						"ROOT_OVERLAP",
						`레일 edge '${key}'가 둘 이상의 정렬 루트에 포함됩니다`,
						[edge.from, edge.to],
					);
				}
				const translated = translateEdge(edge, move.deltaX, move.deltaZ);
				if (!translated)
					return selectedFailure(
						"COORDINATE_OVERFLOW",
						`레일 edge '${key}'가 signed int32 좌표 범위를 벗어납니다`,
						[edge.from, edge.to],
					);
				edgeByKey.set(key, Object.freeze({ rootKey: move.root.key, edge, translated }));
			}
			if (module.advancedSwitchId === null) continue;
			if (switchIds.has(module.advancedSwitchId))
				return selectedFailure(
					"ROOT_OVERLAP",
					`고급 스위치 ${module.advancedSwitchId}가 중복 선택되었습니다`,
				);
			const record = map.getAdvancedSwitch(module.advancedSwitchId);
			if (!record)
				return selectedFailure(
					"STALE_SELECTION",
					`고급 스위치 ${module.advancedSwitchId}를 찾을 수 없습니다`,
				);
			const origin = translateCell(record.origin, move.deltaX, move.deltaZ);
			if (!origin)
				return selectedFailure(
					"COORDINATE_OVERFLOW",
					`고급 스위치 ${record.id}가 signed int32 좌표 범위를 벗어납니다`,
					[record.origin],
				);
			const after = copyAdvancedSwitch({ ...record, origin });
			switchIds.add(record.id);
			if (origin.x !== record.origin.x || origin.y !== record.origin.y) {
				switchMutations.push(Object.freeze({ id: record.id, before: record, after }));
			}
			for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells) {
				const error = claimSourceCell(move.root.key, cell);
				if (error) return selectedFailure("ROOT_OVERLAP", error, [cell]);
			}
			for (const cell of deriveAdvancedSwitchGeometry(after).claimedCells)
				claimTargetCell(move.root.key, cell);
		}

		for (const selectedGroup of move.root.selection.equipmentGroups) {
			const groupId = selectedGroup.group.id;
			if (equipmentGroupIds.has(groupId))
				return selectedFailure(
					"ROOT_OVERLAP",
					`장비 그룹 ${groupId}이 둘 이상의 정렬 루트에 포함됩니다`,
				);
			const currentGroup = groupsById.get(groupId);
			if (!currentGroup)
				return selectedFailure("STALE_SELECTION", `장비 그룹 ${groupId}을 찾을 수 없습니다`);
			if (currentGroup.kind === "STK" && currentGroup.template === "CUSTOM") {
				return selectedFailure(
					"LEGACY_EQUIPMENT_UNSUPPORTED",
					`legacy CUSTOM STK 그룹 ${groupId}은 정렬할 수 없습니다`,
				);
			}
			equipmentGroupIds.add(groupId);
			if (move.deltaX !== 0 || move.deltaZ !== 0) movedEquipmentGroupIds.add(groupId);
			for (const portId of currentGroup.portIds) {
				const port = portsById.get(portId);
				if (!port)
					return selectedFailure(
						"STALE_SELECTION",
						`장비 그룹 ${groupId}의 PORT-${portId}를 찾을 수 없습니다`,
					);
				ports.push(port);
				if (port.route.kind === "ADVANCED_SWITCH_SEGMENT") {
					if (!switchIds.has(port.route.switchId))
						return selectedFailure(
							"PORT_DEPENDENCY",
							`PORT-${port.id}가 이동 루트 밖의 고급 스위치 ${port.route.switchId}에 연결되어 있습니다`,
						);
					continue;
				}
				const routeCell = translateCell(
					{ x: port.route.x, y: port.route.z },
					move.deltaX,
					move.deltaZ,
				);
				if (!routeCell)
					return selectedFailure(
						"COORDINATE_OVERFLOW",
						`PORT-${port.id}가 signed int32 좌표 범위를 벗어납니다`,
					);
				const after = copyPortRecord({
					...port,
					route: Object.freeze({ ...port.route, x: routeCell.x, z: routeCell.y }),
				});
				if (
					after.route.kind === "CARDINAL_CELL" &&
					(after.route.x !== port.route.x || after.route.z !== port.route.z)
				) {
					portMutations.push(Object.freeze({ id: port.id, before: port, after }));
				}
			}
		}
	}
	if (edgeByKey.size === 0)
		return selectedFailure("EMPTY_SELECTION", "정렬 루트에 이동할 레일 edge가 없습니다");
	return Object.freeze({
		valid: true,
		edges: Object.freeze(
			[...edgeByKey.values()].sort((left, right) =>
				compareDirectedRailEdges(left.edge, right.edge),
			),
		),
		sourceCells: new Set(sourceCellRoot.keys()),
		sourceCellCoordinates,
		targetCellsByRoot,
		targetCellCoordinates,
		switchMutations: Object.freeze(switchMutations.sort((left, right) => left.id - right.id)),
		switchIds,
		ports: Object.freeze(ports.sort((left, right) => left.id - right.id)),
		portMutations: Object.freeze(portMutations.sort((left, right) => left.id - right.id)),
		equipmentGroupIds,
		movedEquipmentGroupIds,
		moduleKeys,
	});
}

function selectedFailure(
	code: StaticFabArrangementPlanIssueCode,
	reason: string,
	conflicts: readonly Cell[] = [],
): SelectedContentResult {
	return Object.freeze({ valid: false, code, reason, conflicts: freezeCells(conflicts) });
}

function externalAttachmentCells(
	map: TileMap,
	edges: readonly SelectedRailEdge[],
	sourceCells: ReadonlyMap<string, Cell>,
): readonly Cell[] {
	const selectedEdgeKeys = new Set(
		edges.map((selected) => staticFabOrganizationEdgeKey(selected.edge)),
	);
	const conflicts = new Map<string, Cell>();
	const inspectEdge = (from: Cell, to: Cell): void => {
		if (selectedEdgeKeys.has(staticFabOrganizationEdgeKey({ from, to }))) return;
		conflicts.set(cellKey(from.x, from.y), from);
		conflicts.set(cellKey(to.x, to.y), to);
	};
	for (const source of sourceCells.values()) {
		const rail = decodeRailCell(map.getEncoded(source.x, source.y));
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = Object.freeze(moveCell(source, direction));
			if ((rail.outgoing & direction) !== 0) inspectEdge(source, neighbor);
			const neighborRail = decodeRailCell(map.getEncoded(neighbor.x, neighbor.y));
			const inboundDirection = oppositeDirection(direction);
			if ((neighborRail.outgoing & inboundDirection) !== 0) inspectEdge(neighbor, source);
		}
	}
	return Object.freeze([...conflicts.values()].sort(compareCells));
}

type TargetValidation =
	| { readonly valid: true }
	| {
			readonly valid: false;
			readonly code: "TARGET_COLLISION" | "TARGET_OVERLAP";
			readonly reason: string;
			readonly conflicts: readonly Cell[];
	  };

function validateTargetFootprints(map: TileMap, selected: SelectedContent): TargetValidation {
	const targetOwner = new Map<string, string>();
	const overlap = new Map<string, Cell>();
	for (const [rootKey, cells] of selected.targetCellsByRoot) {
		for (const key of cells) {
			const previous = targetOwner.get(key);
			if (previous && previous !== rootKey) {
				const cell = selected.targetCellCoordinates.get(key);
				if (cell) overlap.set(key, cell);
			}
			targetOwner.set(key, rootKey);
		}
	}
	if (overlap.size > 0) {
		return Object.freeze({
			valid: false,
			code: "TARGET_OVERLAP",
			reason: "정렬 후 둘 이상의 루트 footprint가 겹칩니다",
			conflicts: Object.freeze([...overlap.values()].sort(compareCells)),
		});
	}
	const collisions = new Map<string, Cell>();
	for (const [key, cell] of selected.targetCellCoordinates) {
		if (selected.sourceCells.has(key)) continue;
		const switchOwner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (
			map.getEncoded(cell.x, cell.y) !== 0 ||
			(switchOwner && !selected.switchIds.has(switchOwner.id))
		) {
			collisions.set(key, cell);
		}
	}
	if (collisions.size > 0) {
		return Object.freeze({
			valid: false,
			code: "TARGET_COLLISION",
			reason: "정렬 목표 footprint에 이동하지 않는 레일 또는 스위치가 있습니다",
			conflicts: Object.freeze([...collisions.values()].sort(compareCells)),
		});
	}
	return Object.freeze({ valid: true });
}

function buildTranslatedRailMutations(
	map: TileMap,
	edges: readonly SelectedRailEdge[],
): readonly RailMutation[] | string {
	const overlay = new Map<string, RailMutation>();
	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, after: number): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = overlay.get(key);
		overlay.set(
			key,
			Object.freeze({
				x: cell.x,
				y: cell.y,
				before: existing?.before ?? map.getEncoded(cell.x, cell.y),
				after,
			}),
		);
	};
	for (const selected of edges) {
		const direction = directionBetween(selected.edge.from, selected.edge.to);
		if (direction === null)
			return `원본 레일 edge '${staticFabOrganizationEdgeKey(selected.edge)}'가 인접하지 않습니다`;
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(selected.edge.from));
		const to = decodeRailCell(read(selected.edge.to));
		if ((from.outgoing & direction) === 0 || (to.incoming & opposite) === 0) {
			return `원본 레일 edge '${staticFabOrganizationEdgeKey(selected.edge)}'가 현재 topology와 일치하지 않습니다`;
		}
		write(selected.edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
		write(selected.edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
	}
	for (const selected of edges) {
		const direction = directionBetween(selected.translated.from, selected.translated.to);
		if (direction === null)
			return `이동 레일 edge '${staticFabOrganizationEdgeKey(selected.translated)}'가 인접하지 않습니다`;
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(read(selected.translated.from));
		const to = decodeRailCell(read(selected.translated.to));
		write(
			selected.translated.from,
			encodeRailCell({ ...from, outgoing: from.outgoing | direction }),
		);
		write(selected.translated.to, encodeRailCell({ ...to, incoming: to.incoming | opposite }));
	}
	return Object.freeze(
		[...overlay.values()]
			.filter((mutation) => mutation.before !== mutation.after)
			.sort(compareMutations)
			.map((mutation) => Object.freeze({ ...mutation })),
	);
}

function planOrganizationRelocation(
	organizations: StaticFabOrganizationState,
	edges: readonly SelectedRailEdge[],
	switchIds: ReadonlySet<number>,
	equipmentGroupIds: ReadonlySet<number>,
): {
	readonly mutations: readonly StaticFabOrganizationMutation[];
	readonly affectedOrganizationIds: readonly number[];
} {
	const translatedByKey = new Map(
		edges
			.filter(
				(selected) =>
					staticFabOrganizationEdgeKey(selected.edge) !==
					staticFabOrganizationEdgeKey(selected.translated),
			)
			.map(
				(selected) => [staticFabOrganizationEdgeKey(selected.edge), selected.translated] as const,
			),
	);
	const mutations: StaticFabOrganizationMutation[] = [];
	const affectedIds: number[] = [];
	for (const record of organizations.records) {
		let affected = record.membership.advancedSwitchIds.some((id) => switchIds.has(id));
		affected ||= record.membership.equipmentGroupIds.some((id) => equipmentGroupIds.has(id));
		let railChanged = false;
		const railEdges = record.membership.railEdges.map((edge) => {
			const translated = translatedByKey.get(staticFabOrganizationEdgeKey(edge));
			if (!translated) return edge;
			affected = true;
			railChanged = true;
			return translated;
		});
		if (!affected) continue;
		affectedIds.push(record.id);
		if (!railChanged) continue;
		const after = copyStaticFabOrganizationRecord({
			...record,
			membership: {
				...record.membership,
				railEdges: railEdges.sort(compareDirectedRailEdges),
			},
		});
		mutations.push(Object.freeze({ id: record.id, before: record, after }));
	}
	return Object.freeze({
		mutations: Object.freeze(mutations.sort((left, right) => left.id - right.id)),
		affectedOrganizationIds: Object.freeze(affectedIds.sort((left, right) => left - right)),
	});
}

function invalid(
	map: TileMap,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	issueCode: StaticFabArrangementPlanIssueCode,
	reason: string,
	conflicts: readonly Cell[] = [],
): StaticFabArrangementPlan {
	return Object.freeze({
		kind: STATIC_FAB_ARRANGEMENT_PLAN_KIND,
		baseRevision: map.getRevision(),
		basePatchSequence:
			Number.isSafeInteger(patchSequence) && patchSequence >= 0 ? patchSequence : 0,
		valid: false,
		reason,
		issueCode,
		cells: Object.freeze([]),
		conflicts: freezeCells(conflicts),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([]),
		nextOrganizationIdBefore: organizations.nextOrganizationId,
		nextOrganizationIdAfter: organizations.nextOrganizationId,
		arrangement: null,
	});
}

function translateCell(cell: Cell, deltaX: number, deltaZ: number): Cell | null {
	const x = cell.x + deltaX;
	const y = cell.y + deltaZ;
	return isInt32(x) && isInt32(y) ? Object.freeze({ x, y }) : null;
}

function translateEdge(
	edge: DirectedRailEdge,
	deltaX: number,
	deltaZ: number,
): DirectedRailEdge | null {
	const from = translateCell(edge.from, deltaX, deltaZ);
	const to = translateCell(edge.to, deltaX, deltaZ);
	return from && to ? Object.freeze({ from, to }) : null;
}

function freezeCells(cells: readonly Cell[]): readonly Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells)
		unique.set(cellKey(cell.x, cell.y), Object.freeze({ x: cell.x, y: cell.y }));
	return Object.freeze([...unique.values()].sort(compareCells));
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function compareMutations(left: RailMutation, right: RailMutation): number {
	return left.y - right.y || left.x - right.x;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sameBounds(
	left: ResolvedStaticFabArrangementRoot["bounds"],
	right: ResolvedStaticFabArrangementRoot["bounds"],
): boolean {
	return (
		left.minX === right.minX &&
		left.minZ === right.minZ &&
		left.maxXExclusive === right.maxXExclusive &&
		left.maxZExclusive === right.maxZExclusive
	);
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
