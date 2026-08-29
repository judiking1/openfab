import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchProfileClass,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
	validateAdvancedSwitchTopology,
} from "./AdvancedSwitch";
import {
	type EquipmentGroupRecord,
	equipmentGroupError,
	type PortEquipmentState,
	STK_AUTHORING_TEMPLATES,
	type StkAuthoringTemplate,
} from "./EquipmentGroup";
import { portEquipmentLayoutError } from "./PortEquipmentLayoutValidator";
import {
	type AdvancedSwitchRouteRole,
	type PortDirection,
	type PortRecord,
	type PortSide,
	type PortType,
	portRecordError,
} from "./PortRecord";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import {
	ALL_DIRECTIONS,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import {
	compareDirectedRailEdges,
	normalizeStaticFabOrganizationName,
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationProperties,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import type { StaticFabOrganizationSelectionMode } from "./StaticFabOrganizationSelection";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";

export const STATIC_FAB_ORGANIZATION_BUNDLE_VERSION = 1 as const;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES = 65_536;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES = 1_024;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS = 4_096;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS = 1_024;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS = 1_024;

/** Only recursively frozen graphs may reuse a completed untrusted-input validation. */
const validatedFrozenBundles = new WeakSet<object>();

const BUNDLE_KEYS = Object.freeze([
	"version",
	"captureMode",
	"rootOrganizationIndices",
	"sourceModuleCount",
	"sourceWidthMeters",
	"sourceHeightMeters",
	"railEdges",
	"advancedSwitches",
	"ports",
	"equipmentGroups",
	"organizations",
] as const);
const EDGE_KEYS = Object.freeze(["from", "to"] as const);
const CELL_KEYS = Object.freeze(["x", "y"] as const);
const ADVANCED_SWITCH_KEYS = Object.freeze([
	"profileClass",
	"origin",
	"forward",
	"lateral",
	"movementMask",
] as const);
const PORT_KEYS = Object.freeze([
	"equipmentGroupIndex",
	"route",
	"stationMillimeters",
	"side",
	"lateralOffsetMillimeters",
	"direction",
	"portType",
] as const);
const CARDINAL_ROUTE_KEYS = Object.freeze(["kind", "x", "z", "from", "to"] as const);
const ADVANCED_SWITCH_ROUTE_KEYS = Object.freeze([
	"kind",
	"advancedSwitchIndex",
	"profileClass",
	"role",
	"portIndex",
	"segmentOrdinal",
] as const);
const OHB_GROUP_KEYS = Object.freeze(["kind", "template", "portIndices"] as const);
const EQ_GROUP_KEYS = Object.freeze(["kind", "pitchMillimeters", "recipe", "portIndices"] as const);
const STK_GROUP_KEYS = Object.freeze(["kind", "template", "portIndices"] as const);
const ORGANIZATION_KEYS = Object.freeze([
	"kind",
	"name",
	"parentOrganizationIndices",
	"properties",
	"membership",
] as const);
const ORGANIZATION_PROPERTIES_KEYS = Object.freeze(["description", "color"] as const);
const ORGANIZATION_MEMBERSHIP_KEYS = Object.freeze([
	"railEdgeIndices",
	"advancedSwitchIndices",
	"equipmentGroupIndices",
] as const);

export type StaticFabOrganizationBundleQuarterTurns = 0 | 1 | 2 | 3;

export interface StaticFabOrganizationBundleAdvancedSwitch {
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly origin: Cell;
	readonly forward: Direction;
	readonly lateral: Direction;
	readonly movementMask: typeof ADVANCED_SWITCH_ALL_MOVEMENTS;
}

export type StaticFabOrganizationBundlePortRoute =
	| {
			readonly kind: "CARDINAL_CELL";
			readonly x: number;
			readonly z: number;
			readonly from: 0 | Direction;
			readonly to: 0 | Direction;
	  }
	| {
			readonly kind: "ADVANCED_SWITCH_SEGMENT";
			readonly advancedSwitchIndex: number;
			readonly profileClass: AdvancedSwitchProfileClass;
			readonly role: AdvancedSwitchRouteRole;
			readonly portIndex: 0 | 1 | null;
			readonly segmentOrdinal: number;
	  };

export interface StaticFabOrganizationBundlePort {
	readonly equipmentGroupIndex: number;
	readonly route: StaticFabOrganizationBundlePortRoute;
	readonly stationMillimeters: number;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
	readonly portType: PortType;
}

export type StaticFabOrganizationBundleEquipmentGroup =
	| {
			readonly kind: "OHB";
			readonly template: "SINGLE";
			readonly portIndices: readonly number[];
	  }
	| {
			readonly kind: "EQ";
			readonly pitchMillimeters: number;
			readonly recipe: string | null;
			readonly portIndices: readonly number[];
	  }
	| {
			readonly kind: "STK";
			readonly template: StkAuthoringTemplate;
			readonly portIndices: readonly number[];
	  };

export interface StaticFabOrganizationBundleMembership {
	readonly railEdgeIndices: readonly number[];
	readonly advancedSwitchIndices: readonly number[];
	readonly equipmentGroupIndices: readonly number[];
}

export interface StaticFabOrganizationBundleOrganization {
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly parentOrganizationIndices: readonly number[];
	readonly properties: StaticFabOrganizationProperties;
	readonly membership: StaticFabOrganizationBundleMembership;
}

/** Portable authored truth. Runtime IDs, barcodes, revisions, and renderer state are excluded. */
export interface StaticFabOrganizationBundle {
	readonly version: typeof STATIC_FAB_ORGANIZATION_BUNDLE_VERSION;
	readonly captureMode: StaticFabOrganizationSelectionMode;
	readonly rootOrganizationIndices: readonly number[];
	readonly sourceModuleCount: number;
	readonly sourceWidthMeters: number;
	readonly sourceHeightMeters: number;
	readonly railEdges: readonly DirectedRailEdge[];
	readonly advancedSwitches: readonly StaticFabOrganizationBundleAdvancedSwitch[];
	readonly ports: readonly StaticFabOrganizationBundlePort[];
	readonly equipmentGroups: readonly StaticFabOrganizationBundleEquipmentGroup[];
	readonly organizations: readonly StaticFabOrganizationBundleOrganization[];
}

/**
 * Ephemeral world-space extent of the authored source used for an in-editor capture. It is returned
 * beside the portable bundle so immediate duplicate placement may offer alignment assistance
 * without leaking source coordinates into serialized blueprint data.
 */
export interface StaticFabOrganizationBundleSourceBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface MaterializedStaticFabOrganizationBundle {
	readonly version: typeof STATIC_FAB_ORGANIZATION_BUNDLE_VERSION;
	readonly captureMode: StaticFabOrganizationSelectionMode;
	readonly rootOrganizationIndices: readonly number[];
	readonly sourceModuleCount: number;
	readonly anchor: Cell;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly widthMeters: number;
	readonly heightMeters: number;
	/** Source-local identity order is preserved so organization indices remain stable. */
	readonly railEdges: readonly DirectedRailEdge[];
	readonly advancedSwitches: readonly StaticFabOrganizationBundleAdvancedSwitch[];
	readonly ports: readonly StaticFabOrganizationBundlePort[];
	readonly equipmentGroups: readonly StaticFabOrganizationBundleEquipmentGroup[];
	readonly organizations: readonly StaticFabOrganizationBundleOrganization[];
}

export type StaticFabOrganizationBundleIssueCode =
	| "INVALID_SOURCE"
	| "EMPTY_ROOT_SELECTION"
	| "MISSING_ROOT"
	| "UNRESOLVED_MEMBERSHIP"
	| "INCOMPLETE_ADVANCED_SWITCH"
	| "MISSING_EQUIPMENT_GROUP"
	| "UNSUPPORTED_EQUIPMENT_GROUP"
	| "UNSUPPORTED_PORT_ROUTE"
	| "LIMIT_EXCEEDED"
	| "INVALID_BUNDLE";

export type StaticFabOrganizationBundleCaptureResult =
	| {
			readonly valid: true;
			readonly bundle: StaticFabOrganizationBundle;
			readonly sourceBounds: StaticFabOrganizationBundleSourceBounds;
			readonly reason: string;
	  }
	| {
			readonly valid: false;
			readonly bundle: null;
			readonly code: StaticFabOrganizationBundleIssueCode;
			readonly reason: string;
	  };

export type PreparedStaticFabOrganizationBundleResult =
	| {
			readonly valid: true;
			readonly bundle: StaticFabOrganizationBundle;
			readonly reason: string;
	  }
	| {
			readonly valid: false;
			readonly bundle: null;
			readonly reason: string;
	  };

/**
 * Capture one or more persistent organization roots as a deterministic portable graph.
 * DIRECT includes only the requested records; EFFECTIVE additionally includes descendants.
 */
export function captureStaticFabOrganizationBundle(
	map: TileMap,
	portEquipment: Parameters<typeof portEquipmentLayoutError>[1],
	patchSequence: number,
	state: StaticFabOrganizationState,
	requestedRootIds: readonly number[],
	mode: StaticFabOrganizationSelectionMode = "DIRECT",
): StaticFabOrganizationBundleCaptureResult {
	if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
		return captureFailure("INVALID_SOURCE", "정적 FAB patch sequence가 유효하지 않습니다");
	}
	if (mode !== "DIRECT" && mode !== "EFFECTIVE") {
		return captureFailure("INVALID_SOURCE", "조직 캡처 모드가 유효하지 않습니다");
	}
	if (requestedRootIds.length === 0) {
		return captureFailure("EMPTY_ROOT_SELECTION", "캡처할 조직을 하나 이상 선택하세요");
	}
	if (requestedRootIds.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS) {
		return captureFailure(
			"LIMIT_EXCEEDED",
			`한 조직 번들은 최대 ${STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS.toLocaleString()}개 루트를 지원합니다`,
		);
	}
	const equipmentError = portEquipmentLayoutError(map, portEquipment);
	if (equipmentError) {
		return captureFailure(
			"INVALID_SOURCE",
			`포트/장비 상태가 유효하지 않습니다 · ${equipmentError}`,
		);
	}
	const organizationError = staticFabOrganizationStateError(map, portEquipment, state);
	if (organizationError) {
		return captureFailure("INVALID_SOURCE", `조직 상태가 유효하지 않습니다 · ${organizationError}`);
	}
	const rootIds = [...new Set(requestedRootIds)].sort(numberCompare);
	const recordsById = new Map(state.records.map((record) => [record.id, record] as const));
	for (const rootId of rootIds) {
		if (!recordsById.has(rootId)) {
			return captureFailure("MISSING_ROOT", `조직 ${rootId}을 현재 정적 FAB에서 찾을 수 없습니다`);
		}
	}

	const childrenByParentId = new Map<number, number[]>();
	for (const record of state.records) {
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record.id);
			else childrenByParentId.set(parentId, [record.id]);
		}
	}
	const includedIds = new Set(rootIds);
	if (mode === "EFFECTIVE") {
		const pending = [...rootIds];
		for (let offset = 0; offset < pending.length; offset++) {
			for (const childId of childrenByParentId.get(pending[offset] as number) ?? []) {
				if (includedIds.has(childId)) continue;
				includedIds.add(childId);
				pending.push(childId);
			}
		}
	}
	const orderedIds = [...includedIds].sort(numberCompare);
	if (orderedIds.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS) {
		return captureFailure(
			"LIMIT_EXCEEDED",
			`한 조직 번들은 최대 ${STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS.toLocaleString()}개 조직을 지원합니다`,
		);
	}
	const selectedEdgeByKey = new Map<string, DirectedRailEdge>();
	const selectedSwitchIds = new Set<number>();
	const selectedGroupIds = new Set<number>();
	for (const id of orderedIds) {
		const membership = (recordsById.get(id) as StaticFabOrganizationRecord).membership;
		for (const edge of membership.railEdges) {
			selectedEdgeByKey.set(staticFabOrganizationEdgeKey(edge), edge);
		}
		for (const switchId of membership.advancedSwitchIds) selectedSwitchIds.add(switchId);
		for (const groupId of membership.equipmentGroupIds) selectedGroupIds.add(groupId);
	}
	const resolvedEdgeKeys = new Set<string>();
	const resolvedSwitchIds = new Set<number>();
	const selectedModules = buildRailModuleOwnershipIndex(map).modules.filter((module) => {
		const touchesEdge = module.eraseEdges.some((edge) =>
			selectedEdgeByKey.has(staticFabOrganizationEdgeKey(edge)),
		);
		const touchesSwitch =
			module.advancedSwitchId !== null && selectedSwitchIds.has(module.advancedSwitchId);
		if (!touchesEdge && !touchesSwitch) return false;
		return (
			module.eraseEdges.every((edge) =>
				selectedEdgeByKey.has(staticFabOrganizationEdgeKey(edge)),
			) &&
			(module.advancedSwitchId === null || selectedSwitchIds.has(module.advancedSwitchId))
		);
	});
	for (const module of selectedModules) {
		for (const edge of module.eraseEdges) resolvedEdgeKeys.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) resolvedSwitchIds.add(module.advancedSwitchId);
	}
	if (
		!setsEqual(new Set(selectedEdgeByKey.keys()), resolvedEdgeKeys) ||
		!setsEqual(selectedSwitchIds, resolvedSwitchIds)
	) {
		return captureFailure(
			"UNRESOLVED_MEMBERSHIP",
			"조직 레일/스위치 멤버십이 현재 모듈 경계와 정확히 일치하지 않습니다",
		);
	}
	if (selectedModules.length === 0) {
		return captureFailure("UNRESOLVED_MEMBERSHIP", "조직 레일 모듈을 복원할 수 없습니다");
	}
	if (selectedEdgeByKey.size > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES) {
		return captureFailure(
			"LIMIT_EXCEEDED",
			`한 조직 번들은 최대 ${STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES.toLocaleString()}개 directed edge를 지원합니다`,
		);
	}
	if (selectedSwitchIds.size > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES) {
		return captureFailure(
			"LIMIT_EXCEEDED",
			`한 조직 번들은 최대 ${STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES.toLocaleString()}개 고급 스위치를 지원합니다`,
		);
	}
	if (selectedGroupIds.size > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS) {
		return captureFailure(
			"LIMIT_EXCEEDED",
			`한 조직 번들은 최대 ${STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS.toLocaleString()}개 장비 그룹을 지원합니다`,
		);
	}

	const groupsById = new Map(
		portEquipment.equipmentGroups.map((group) => [group.id, group] as const),
	);
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port] as const));
	const selectedGroupsById = new Map(
		[...selectedGroupIds].map((groupId) => {
			const group = groupsById.get(groupId);
			if (!group) throw new Error(`장비 그룹 ${groupId}을 찾을 수 없습니다`);
			return [
				groupId,
				{
					group,
					ports: group.portIds.map((portId) => {
						const port = portsById.get(portId);
						if (!port) throw new Error(`장비 그룹 ${groupId}의 PORT-${portId}가 없습니다`);
						return port;
					}),
				},
			] as const;
		}),
	);
	if (!setsEqual(selectedGroupIds, new Set(selectedGroupsById.keys()))) {
		return captureFailure(
			"MISSING_EQUIPMENT_GROUP",
			"조직 장비 그룹 멤버십을 완전한 포트 집합으로 복원할 수 없습니다",
		);
	}
	const sourceEdges = [...selectedEdgeByKey.values()].sort(compareDirectedRailEdges);
	const bounds = mutableDirectedEdgeBounds(sourceEdges);
	for (const switchId of selectedSwitchIds) {
		const record = map.getAdvancedSwitch(switchId);
		if (!record) {
			return captureFailure(
				"INCOMPLETE_ADVANCED_SWITCH",
				`고급 스위치 ${switchId}을 찾을 수 없습니다`,
			);
		}
		for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells)
			includeBoundsCell(bounds, cell);
	}
	for (const selected of selectedGroupsById.values()) {
		for (const port of selected.ports) {
			if (port.route.kind === "CARDINAL_CELL") {
				includeBoundsCell(bounds, { x: port.route.x, y: port.route.z });
			}
		}
	}
	if (bounds.maxX - bounds.minX > 0x7fff_ffff || bounds.maxY - bounds.minY > 0x7fff_ffff) {
		return captureFailure(
			"LIMIT_EXCEEDED",
			"조직 번들 footprint span이 signed-int32 배치 범위를 벗어났습니다",
		);
	}
	const railEdges = Object.freeze(
		sourceEdges.map((edge) =>
			freezeDirectedEdge(
				translateCell(edge.from, -bounds.minX, -bounds.minY),
				translateCell(edge.to, -bounds.minX, -bounds.minY),
			),
		),
	);
	const railEdgeIndexBySourceKey = new Map(
		sourceEdges.map((edge, index) => [staticFabOrganizationEdgeKey(edge), index] as const),
	);
	const sourceEdgeKeys = new Set(sourceEdges.map(staticFabOrganizationEdgeKey));

	const orderedSwitchIds = [...selectedSwitchIds].sort(numberCompare);
	const advancedSwitchIndexById = new Map(
		orderedSwitchIds.map((id, index) => [id, index] as const),
	);
	const advancedSwitches: StaticFabOrganizationBundleAdvancedSwitch[] = [];
	for (const switchId of orderedSwitchIds) {
		const record = map.getAdvancedSwitch(switchId);
		if (!record) {
			return captureFailure(
				"INCOMPLETE_ADVANCED_SWITCH",
				`고급 스위치 ${switchId}을 찾을 수 없습니다`,
			);
		}
		for (const route of deriveAdvancedSwitchGeometry(record).routes) {
			for (let index = 1; index < route.length; index++) {
				const key = staticFabOrganizationEdgeKey({
					from: route[index - 1] as Cell,
					to: route[index] as Cell,
				});
				if (!sourceEdgeKeys.has(key)) {
					return captureFailure(
						"INCOMPLETE_ADVANCED_SWITCH",
						`고급 스위치 ${switchId}의 전체 directed route를 함께 선택해야 합니다`,
					);
				}
			}
		}
		advancedSwitches.push(
			Object.freeze({
				profileClass: record.profileClass,
				origin: freezeCell(translateCell(record.origin, -bounds.minX, -bounds.minY)),
				forward: record.forward,
				lateral: record.lateral,
				movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
			}),
		);
	}

	const orderedGroupIds = [...selectedGroupIds].sort(numberCompare);
	const equipmentGroupIndexById = new Map(orderedGroupIds.map((id, index) => [id, index] as const));
	const ports: StaticFabOrganizationBundlePort[] = [];
	const equipmentGroups: StaticFabOrganizationBundleEquipmentGroup[] = [];
	for (const groupId of orderedGroupIds) {
		const selected = selectedGroupsById.get(groupId);
		if (!selected) {
			return captureFailure("MISSING_EQUIPMENT_GROUP", `장비 그룹 ${groupId}을 찾을 수 없습니다`);
		}
		if (selected.group.kind === "STK" && !isStkAuthoringTemplate(selected.group.template)) {
			return captureFailure(
				"UNSUPPORTED_EQUIPMENT_GROUP",
				`legacy CUSTOM STK 그룹 ${groupId}은 portable 조직 번들로 캡처할 수 없습니다`,
			);
		}
		const groupIndex = equipmentGroups.length;
		const portIndices: number[] = [];
		for (const port of selected.ports) {
			if (ports.length >= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS) {
				return captureFailure(
					"LIMIT_EXCEEDED",
					`한 조직 번들은 최대 ${STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS.toLocaleString()}개 포트를 지원합니다`,
				);
			}
			if (port.route.kind === "ADVANCED_SWITCH_SEGMENT" && port.route.segmentOrdinal !== 0) {
				return captureFailure(
					"UNSUPPORTED_PORT_ROUTE",
					`PORT-${port.id}의 고급 스위치 segment ordinal은 현재 0만 지원합니다`,
				);
			}
			const route = portablePortRoute(port, advancedSwitchIndexById, bounds);
			if (!route) {
				return captureFailure(
					"UNSUPPORTED_PORT_ROUTE",
					`PORT-${port.id}의 지지 스위치가 조직 번들에 포함되지 않았습니다`,
				);
			}
			portIndices.push(ports.length);
			ports.push(
				Object.freeze({
					equipmentGroupIndex: groupIndex,
					route,
					stationMillimeters: port.stationMillimeters,
					side: port.side,
					lateralOffsetMillimeters: port.lateralOffsetMillimeters,
					direction: port.direction,
					portType: port.portType,
				}),
			);
		}
		equipmentGroups.push(portableEquipmentGroup(selected.group, Object.freeze(portIndices)));
	}

	const organizationIndexById = new Map(orderedIds.map((id, index) => [id, index] as const));
	const organizations = orderedIds.map((id) => {
		const record = recordsById.get(id) as StaticFabOrganizationRecord;
		return Object.freeze({
			kind: record.kind,
			name: record.name,
			parentOrganizationIndices: Object.freeze(
				staticFabOrganizationParentIds(record)
					.filter((parentId) => includedIds.has(parentId))
					.map((parentId) => requiredIndex(organizationIndexById, parentId, "부모 조직")),
			),
			properties: copyPortableOrganizationProperties(staticFabOrganizationProperties(record)),
			membership: Object.freeze({
				railEdgeIndices: Object.freeze(
					record.membership.railEdges.map((edge) =>
						requiredIndex(
							railEdgeIndexBySourceKey,
							staticFabOrganizationEdgeKey(edge),
							"레일 edge",
						),
					),
				),
				advancedSwitchIndices: Object.freeze(
					record.membership.advancedSwitchIds.map((switchId) =>
						requiredIndex(advancedSwitchIndexById, switchId, "고급 스위치"),
					),
				),
				equipmentGroupIndices: Object.freeze(
					record.membership.equipmentGroupIds.map((groupId) =>
						requiredIndex(equipmentGroupIndexById, groupId, "장비 그룹"),
					),
				),
			}),
		});
	});
	const bundle: StaticFabOrganizationBundle = Object.freeze({
		version: STATIC_FAB_ORGANIZATION_BUNDLE_VERSION,
		captureMode: mode,
		rootOrganizationIndices: Object.freeze(
			rootIds.map((id) => requiredIndex(organizationIndexById, id, "루트 조직")),
		),
		sourceModuleCount: selectedModules.length,
		sourceWidthMeters: bounds.maxX - bounds.minX,
		sourceHeightMeters: bounds.maxY - bounds.minY,
		railEdges,
		advancedSwitches: Object.freeze(advancedSwitches),
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
		organizations: Object.freeze(organizations),
	});
	const bundleError = staticFabOrganizationBundleError(bundle);
	if (bundleError) return captureFailure("INVALID_BUNDLE", bundleError);
	return Object.freeze({
		valid: true,
		bundle,
		sourceBounds: Object.freeze({
			minX: bounds.minX,
			minY: bounds.minY,
			maxX: bounds.maxX,
			maxY: bounds.maxY,
		}),
		reason: `${rootIds.length}개 루트 · ${organizations.length}개 조직을 portable 번들로 캡처했습니다`,
	});
}

/** Validate a deserialized portable bundle before preview or placement. */
export function staticFabOrganizationBundleError(bundle: unknown): string | null {
	if (isRecord(bundle) && validatedFrozenBundles.has(bundle)) return null;
	try {
		const error = staticFabOrganizationBundleErrorUnchecked(bundle);
		if (error === null && isRecord(bundle) && recursivelyFrozenObject(bundle)) {
			validatedFrozenBundles.add(bundle);
		}
		return error;
	} catch (error) {
		return error instanceof Error && error.message
			? `조직 번들 구조가 유효하지 않습니다 · ${error.message}`
			: "조직 번들 구조가 유효하지 않습니다";
	}
}

/**
 * Validate one untrusted decode boundary and return a canonical immutable graph. Callers keep the
 * prepared object in memory so pointer previews never repeat the full structural validation.
 */
export function prepareStaticFabOrganizationBundle(
	input: unknown,
): PreparedStaticFabOrganizationBundleResult {
	const error = staticFabOrganizationBundleError(input);
	if (error) {
		return Object.freeze({ valid: false, bundle: null, reason: error });
	}
	const source = input as StaticFabOrganizationBundle;
	if (isRecord(source) && validatedFrozenBundles.has(source)) {
		return Object.freeze({
			valid: true,
			bundle: source,
			reason: "검증된 불변 조직 번들을 준비했습니다",
		});
	}
	const bundle = copyPreparedStaticFabOrganizationBundle(source);
	validatedFrozenBundles.add(bundle);
	return Object.freeze({
		valid: true,
		bundle,
		reason: "조직 번들을 검증하고 불변 portable v1 그래프로 준비했습니다",
	});
}

function staticFabOrganizationBundleErrorUnchecked(input: unknown): string | null {
	if (!isRecord(input)) return "조직 번들은 객체여야 합니다";
	if (!hasExactKeys(input, BUNDLE_KEYS)) {
		return "조직 번들 최상위 필드가 portable v1 스키마와 정확히 일치해야 합니다";
	}
	if (
		!Array.isArray(input.rootOrganizationIndices) ||
		!Array.isArray(input.railEdges) ||
		!Array.isArray(input.advancedSwitches) ||
		!Array.isArray(input.ports) ||
		!Array.isArray(input.equipmentGroups) ||
		!Array.isArray(input.organizations)
	) {
		return "조직 번들 payload 배열이 누락되었습니다";
	}
	const bundle = input as unknown as StaticFabOrganizationBundle;
	if (bundle.version !== STATIC_FAB_ORGANIZATION_BUNDLE_VERSION) {
		return "조직 번들 버전이 유효하지 않습니다";
	}
	if (bundle.captureMode !== "DIRECT" && bundle.captureMode !== "EFFECTIVE") {
		return "조직 번들 캡처 모드가 유효하지 않습니다";
	}
	if (
		!positiveBoundedCount(
			bundle.sourceModuleCount,
			STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES,
		) ||
		!boundedSpan(bundle.sourceWidthMeters) ||
		!boundedSpan(bundle.sourceHeightMeters) ||
		(bundle.sourceWidthMeters === 0 && bundle.sourceHeightMeters === 0)
	) {
		return "조직 번들 source 크기 또는 모듈 수가 유효하지 않습니다";
	}
	if (
		bundle.railEdges.length === 0 ||
		bundle.railEdges.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES ||
		bundle.advancedSwitches.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES ||
		bundle.ports.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS ||
		bundle.equipmentGroups.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS ||
		bundle.organizations.length === 0 ||
		bundle.organizations.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS
	) {
		return "조직 번들 payload 개수가 제품 한계를 벗어났습니다";
	}
	if (!canonicalIndexArray(bundle.rootOrganizationIndices, bundle.organizations.length, false)) {
		return "루트 조직 local index는 중복 없는 canonical 순서여야 합니다";
	}

	const railEdgeKeys = new Set<string>();
	let previousEdge: DirectedRailEdge | null = null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const edge of bundle.railEdges) {
		if (
			!isRecord(edge) ||
			!hasExactKeys(edge, EDGE_KEYS) ||
			!isRecord(edge.from) ||
			!hasExactKeys(edge.from, CELL_KEYS) ||
			!isRecord(edge.to) ||
			!hasExactKeys(edge.to, CELL_KEYS)
		) {
			return "조직 번들 레일 edge 필드가 portable v1 스키마와 정확히 일치해야 합니다";
		}
		if (
			!validInt32Cell(edge.from) ||
			!validInt32Cell(edge.to) ||
			directionBetween(edge.from, edge.to) === null
		) {
			return "조직 번들 레일 edge는 인접한 signed-int32 직교 셀이어야 합니다";
		}
		if (edge.from.x < 0 || edge.from.y < 0 || edge.to.x < 0 || edge.to.y < 0) {
			return "조직 번들 레일 좌표는 공통 원점으로 정규화되어야 합니다";
		}
		if (previousEdge && compareDirectedRailEdges(previousEdge, edge) >= 0) {
			return "조직 번들 레일 edge는 중복 없는 canonical 순서여야 합니다";
		}
		previousEdge = edge;
		const key = staticFabOrganizationEdgeKey(edge);
		if (railEdgeKeys.has(key)) return "조직 번들 레일 edge가 중복되었습니다";
		railEdgeKeys.add(key);
		minX = Math.min(minX, edge.from.x, edge.to.x);
		minY = Math.min(minY, edge.from.y, edge.to.y);
		maxX = Math.max(maxX, edge.from.x, edge.to.x);
		maxY = Math.max(maxY, edge.from.y, edge.to.y);
	}
	for (let index = 0; index < bundle.advancedSwitches.length; index++) {
		const portable = bundle.advancedSwitches[index] as StaticFabOrganizationBundleAdvancedSwitch;
		if (
			!isRecord(portable) ||
			!hasExactKeys(portable, ADVANCED_SWITCH_KEYS) ||
			!isRecord(portable.origin) ||
			!hasExactKeys(portable.origin, CELL_KEYS)
		) {
			return `조직 번들 고급 스위치 ${index} 필드가 portable v1 스키마와 정확히 일치해야 합니다`;
		}
		const candidate = {
			id: index + 1,
			profileClass: portable.profileClass,
			origin: portable.origin,
			forward: portable.forward,
			lateral: portable.lateral,
			movementMask: portable.movementMask,
		};
		const error = advancedSwitchRecordError(candidate);
		if (error) return `조직 번들 고급 스위치 ${index}: ${error}`;
		const geometry = deriveAdvancedSwitchGeometry(candidate);
		for (const cell of geometry.claimedCells) {
			minX = Math.min(minX, cell.x);
			minY = Math.min(minY, cell.y);
			maxX = Math.max(maxX, cell.x);
			maxY = Math.max(maxY, cell.y);
		}
		for (const route of geometry.routes) {
			for (let routeIndex = 1; routeIndex < route.length; routeIndex++) {
				if (
					!railEdgeKeys.has(
						staticFabOrganizationEdgeKey({
							from: route[routeIndex - 1] as Cell,
							to: route[routeIndex] as Cell,
						}),
					)
				) {
					return `조직 번들 고급 스위치 ${index}의 directed route가 불완전합니다`;
				}
			}
		}
	}

	const claimedPorts = new Set<number>();
	for (let groupIndex = 0; groupIndex < bundle.equipmentGroups.length; groupIndex++) {
		const group = bundle.equipmentGroups[groupIndex] as StaticFabOrganizationBundleEquipmentGroup;
		if (!portableEquipmentGroupHasExactKeys(group)) {
			return `조직 번들 장비 그룹 ${groupIndex} 필드가 portable v1 스키마와 정확히 일치해야 합니다`;
		}
		if (!canonicalIndexArray(group.portIndices, bundle.ports.length, true)) {
			return `조직 번들 장비 그룹 ${groupIndex}의 port index가 canonical하지 않습니다`;
		}
		const runtimeGroup = runtimeEquipmentGroup(group, groupIndex + 1);
		const groupError = equipmentGroupError(runtimeGroup);
		if (groupError) return `조직 번들 장비 그룹 ${groupIndex}: ${groupError}`;
		if (group.kind === "STK" && !isStkAuthoringTemplate(group.template)) {
			return `조직 번들 장비 그룹 ${groupIndex}은 legacy CUSTOM STK를 사용할 수 없습니다`;
		}
		for (const portIndex of group.portIndices) {
			if (claimedPorts.has(portIndex)) return `조직 번들 port ${portIndex}가 여러 그룹에 속합니다`;
			claimedPorts.add(portIndex);
			if (bundle.ports[portIndex]?.equipmentGroupIndex !== groupIndex) {
				return `조직 번들 port ${portIndex}의 장비 그룹 역참조가 일치하지 않습니다`;
			}
		}
	}
	if (claimedPorts.size !== bundle.ports.length) return "조직 번들에 소유되지 않은 port가 있습니다";
	for (let index = 0; index < bundle.ports.length; index++) {
		const port = bundle.ports[index] as StaticFabOrganizationBundlePort;
		if (
			!isRecord(port) ||
			!hasExactKeys(port, PORT_KEYS) ||
			!portablePortRouteHasExactKeys(port.route)
		) {
			return `조직 번들 port ${index} 필드가 portable v1 스키마와 정확히 일치해야 합니다`;
		}
		if (!validIndex(port.equipmentGroupIndex, bundle.equipmentGroups.length)) {
			return `조직 번들 port ${index}의 장비 그룹 local index가 유효하지 않습니다`;
		}
		if (port.portType !== bundle.equipmentGroups[port.equipmentGroupIndex]?.kind) {
			return `조직 번들 port ${index}의 종류가 장비 그룹과 일치하지 않습니다`;
		}
		const runtime = runtimePortRecord(port, index + 1);
		const portError = portRecordError(runtime);
		if (portError) return `조직 번들 port ${index}: ${portError}`;
		if (port.route.kind === "CARDINAL_CELL") {
			minX = Math.min(minX, port.route.x);
			minY = Math.min(minY, port.route.z);
			maxX = Math.max(maxX, port.route.x);
			maxY = Math.max(maxY, port.route.z);
			if (!bundleSupportsCardinalRoute(port.route, railEdgeKeys)) {
				return `조직 번들 port ${index}의 지지 레일이 번들에 완전히 포함되지 않습니다`;
			}
		} else {
			const switchRecord = bundle.advancedSwitches[port.route.advancedSwitchIndex];
			if (!switchRecord || switchRecord.profileClass !== port.route.profileClass) {
				return `조직 번들 port ${index}의 고급 스위치 참조가 유효하지 않습니다`;
			}
			if (port.portType !== "OHB") {
				return `조직 번들 port ${index}: 고급 스위치 segment에는 OHB만 연결할 수 있습니다`;
			}
			if (port.route.segmentOrdinal !== 0) {
				return `조직 번들 port ${index}: 고급 스위치 segment ordinal은 현재 0만 지원합니다`;
			}
		}
	}
	if (
		minX !== 0 ||
		minY !== 0 ||
		maxX !== bundle.sourceWidthMeters ||
		maxY !== bundle.sourceHeightMeters
	) {
		return "조직 번들 전체 footprint bounds와 source 크기가 일치하지 않습니다";
	}

	const railOwnersByKind = new Map<string, number>();
	const switchOwnersByKind = new Map<string, number>();
	const groupOwnersByKind = new Map<string, number>();
	const referencedEdges = new Set<number>();
	const referencedSwitches = new Set<number>();
	const referencedGroups = new Set<number>();
	const namesByKind = new Map<StaticFabOrganizationKind, Set<string>>();
	for (let index = 0; index < bundle.organizations.length; index++) {
		const organization = bundle.organizations[index] as StaticFabOrganizationBundleOrganization;
		if (
			!isRecord(organization) ||
			!hasExactKeys(organization, ORGANIZATION_KEYS) ||
			!isRecord(organization.properties) ||
			!hasExactKeys(organization.properties, ORGANIZATION_PROPERTIES_KEYS) ||
			!isRecord(organization.membership) ||
			!hasExactKeys(organization.membership, ORGANIZATION_MEMBERSHIP_KEYS)
		) {
			return `조직 번들 조직 ${index} 필드가 portable v1 스키마와 정확히 일치해야 합니다`;
		}
		const metadataError = portableOrganizationMetadataError(organization, namesByKind);
		if (metadataError) return `조직 번들 조직 ${index}: ${metadataError}`;
		if (
			!canonicalIndexArray(
				organization.parentOrganizationIndices,
				bundle.organizations.length,
				true,
			)
		) {
			return `조직 번들 조직 ${index}의 부모 local index가 canonical하지 않습니다`;
		}
		if (organization.parentOrganizationIndices.includes(index)) {
			return `조직 번들 조직 ${index}은 자기 자신을 부모로 지정할 수 없습니다`;
		}
		const membership = organization.membership;
		if (
			!canonicalIndexArray(membership.railEdgeIndices, bundle.railEdges.length, true) ||
			!canonicalIndexArray(
				membership.advancedSwitchIndices,
				bundle.advancedSwitches.length,
				true,
			) ||
			!canonicalIndexArray(membership.equipmentGroupIndices, bundle.equipmentGroups.length, true)
		) {
			return `조직 번들 조직 ${index}의 membership local index가 canonical하지 않습니다`;
		}
		if (
			membership.railEdgeIndices.length +
				membership.advancedSwitchIndices.length +
				membership.equipmentGroupIndices.length ===
			0
		) {
			return `조직 번들 조직 ${index}의 membership이 비어 있습니다`;
		}
		for (const edgeIndex of membership.railEdgeIndices) {
			const conflict = claimPortableMembership(
				railOwnersByKind,
				organization.kind,
				edgeIndex,
				index,
			);
			if (conflict) return conflict;
			referencedEdges.add(edgeIndex);
		}
		for (const switchIndex of membership.advancedSwitchIndices) {
			const conflict = claimPortableMembership(
				switchOwnersByKind,
				organization.kind,
				switchIndex,
				index,
			);
			if (conflict) return conflict;
			referencedSwitches.add(switchIndex);
		}
		for (const groupIndex of membership.equipmentGroupIndices) {
			const conflict = claimPortableMembership(
				groupOwnersByKind,
				organization.kind,
				groupIndex,
				index,
			);
			if (conflict) return conflict;
			referencedGroups.add(groupIndex);
		}
		const organizationEdgeKeys = new Set(
			membership.railEdgeIndices.map((edgeIndex) =>
				staticFabOrganizationEdgeKey(bundle.railEdges[edgeIndex] as DirectedRailEdge),
			),
		);
		const organizationSwitches = new Set(membership.advancedSwitchIndices);
		for (const switchIndex of organizationSwitches) {
			const portable = bundle.advancedSwitches[
				switchIndex
			] as StaticFabOrganizationBundleAdvancedSwitch;
			const geometry = deriveAdvancedSwitchGeometry({
				id: switchIndex + 1,
				profileClass: portable.profileClass,
				origin: portable.origin,
				forward: portable.forward,
				lateral: portable.lateral,
				movementMask: portable.movementMask,
			});
			for (const route of geometry.routes) {
				for (let routeIndex = 1; routeIndex < route.length; routeIndex++) {
					const edgeKey = staticFabOrganizationEdgeKey({
						from: route[routeIndex - 1] as Cell,
						to: route[routeIndex] as Cell,
					});
					if (!organizationEdgeKeys.has(edgeKey)) {
						return `조직 번들 조직 ${index}은 고급 스위치 ${switchIndex}의 전체 route edge를 직접 소유해야 합니다`;
					}
				}
			}
		}
		for (const groupIndex of membership.equipmentGroupIndices) {
			const group = bundle.equipmentGroups[groupIndex] as StaticFabOrganizationBundleEquipmentGroup;
			for (const portIndex of group.portIndices) {
				const route = (bundle.ports[portIndex] as StaticFabOrganizationBundlePort).route;
				const supported =
					route.kind === "CARDINAL_CELL"
						? bundleSupportsCardinalRoute(route, organizationEdgeKeys)
						: organizationSwitches.has(route.advancedSwitchIndex);
				if (!supported) {
					return `조직 번들 조직 ${index}의 장비 그룹 ${groupIndex} port 경로가 직접 멤버십에 완전히 포함되지 않습니다`;
				}
			}
		}
	}
	if (portableOrganizationCycle(bundle.organizations)) return "조직 번들 관계에 순환이 있습니다";
	if (
		referencedEdges.size !== bundle.railEdges.length ||
		referencedSwitches.size !== bundle.advancedSwitches.length ||
		referencedGroups.size !== bundle.equipmentGroups.length
	) {
		return "조직 번들에 어떤 조직도 소유하지 않는 payload가 있습니다";
	}

	const closureError = portableOrganizationRootClosureError(bundle);
	if (closureError) return closureError;

	const reconstructed = reconstructPortableBundleMap(bundle);
	if (typeof reconstructed === "string") return reconstructed;
	const ownership = buildRailModuleOwnershipIndex(reconstructed);
	if (ownership.modules.length !== bundle.sourceModuleCount) {
		return `조직 번들 source 모듈 수가 실제 ${ownership.modules.length}개와 일치하지 않습니다`;
	}

	const portEquipment = runtimePortEquipmentState(bundle);
	const equipmentLayoutError = portEquipmentLayoutError(reconstructed, portEquipment);
	if (equipmentLayoutError) {
		return `조직 번들 포트/장비 배치가 유효하지 않습니다 · ${equipmentLayoutError}`;
	}
	const organizationState = runtimeOrganizationState(bundle);
	const organizationStateError = staticFabOrganizationStateError(
		reconstructed,
		portEquipment,
		organizationState,
	);
	if (organizationStateError) {
		return `조직 번들 조직 상태가 유효하지 않습니다 · ${organizationStateError}`;
	}
	return null;
}

/** Rotate around the portable origin, then translate by one integer-cell anchor. */
export function materializeStaticFabOrganizationBundle(
	bundle: StaticFabOrganizationBundle,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): MaterializedStaticFabOrganizationBundle {
	const error = staticFabOrganizationBundleError(bundle);
	if (error) throw new Error(`조직 번들을 배치할 수 없습니다 · ${error}`);
	if (!validInt32Cell(anchor))
		throw new Error("조직 번들 anchor는 signed-int32 정수 셀이어야 합니다");
	if (![0, 1, 2, 3].includes(quarterTurns)) {
		throw new Error("조직 번들 회전은 0, 90, 180, 270도만 지원합니다");
	}
	const transform = (cell: Cell): Cell =>
		freezeCell(translateCell(rotateCell(cell, quarterTurns), anchor.x, anchor.y));
	const railEdges = Object.freeze(
		bundle.railEdges.map((edge) => freezeDirectedEdge(transform(edge.from), transform(edge.to))),
	);
	const advancedSwitches = Object.freeze(
		bundle.advancedSwitches.map((record) =>
			Object.freeze({
				profileClass: record.profileClass,
				origin: transform(record.origin),
				forward: rotateDirection(record.forward, quarterTurns) as Direction,
				lateral: rotateDirection(record.lateral, quarterTurns) as Direction,
				movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
			}),
		),
	);
	const ports = Object.freeze(
		bundle.ports.map((port) =>
			Object.freeze({
				equipmentGroupIndex: port.equipmentGroupIndex,
				route:
					port.route.kind === "CARDINAL_CELL"
						? Object.freeze({
								kind: "CARDINAL_CELL" as const,
								...cardinalRouteCell(transform({ x: port.route.x, y: port.route.z })),
								from: rotateDirection(port.route.from, quarterTurns),
								to: rotateDirection(port.route.to, quarterTurns),
							})
						: Object.freeze({
								kind: "ADVANCED_SWITCH_SEGMENT" as const,
								advancedSwitchIndex: port.route.advancedSwitchIndex,
								profileClass: port.route.profileClass,
								role: port.route.role,
								portIndex: port.route.portIndex,
								segmentOrdinal: port.route.segmentOrdinal,
							}),
				stationMillimeters: port.stationMillimeters,
				side: port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: port.direction,
				portType: port.portType,
			}),
		),
	);
	const equipmentGroups = Object.freeze(bundle.equipmentGroups.map(copyPortableEquipmentGroup));
	const organizations = Object.freeze(
		bundle.organizations.map((organization) =>
			Object.freeze({
				kind: organization.kind,
				name: organization.name,
				parentOrganizationIndices: Object.freeze([...organization.parentOrganizationIndices]),
				properties: copyPortableOrganizationProperties(organization.properties),
				membership: Object.freeze({
					railEdgeIndices: Object.freeze([...organization.membership.railEdgeIndices]),
					advancedSwitchIndices: Object.freeze([...organization.membership.advancedSwitchIndices]),
					equipmentGroupIndices: Object.freeze([...organization.membership.equipmentGroupIndices]),
				}),
			}),
		),
	);
	return Object.freeze({
		version: bundle.version,
		captureMode: bundle.captureMode,
		rootOrganizationIndices: Object.freeze([...bundle.rootOrganizationIndices]),
		sourceModuleCount: bundle.sourceModuleCount,
		anchor: freezeCell(anchor),
		quarterTurns,
		widthMeters: quarterTurns % 2 === 0 ? bundle.sourceWidthMeters : bundle.sourceHeightMeters,
		heightMeters: quarterTurns % 2 === 0 ? bundle.sourceHeightMeters : bundle.sourceWidthMeters,
		railEdges,
		advancedSwitches,
		ports,
		equipmentGroups,
		organizations,
	});
}

/**
 * Bake a placement rotation into portable organization data while preserving every membership
 * index. Spatially re-sorting transformed edges requires an explicit old-to-new index remap.
 */
export function transformStaticFabOrganizationBundle(
	bundle: StaticFabOrganizationBundle,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): StaticFabOrganizationBundle {
	const prepared = prepareStaticFabOrganizationBundle(bundle);
	if (!prepared.valid) throw new Error(`조직 번들을 변환할 수 없습니다 · ${prepared.reason}`);
	const source = prepared.bundle;
	if (quarterTurns === 0) return copyPreparedStaticFabOrganizationBundle(source);

	const anchor = organizationBundleNormalizationAnchor(source, quarterTurns);
	const materialized = materializeStaticFabOrganizationBundle(source, anchor, quarterTurns);
	const indexedEdges = materialized.railEdges
		.map((edge, sourceIndex) => Object.freeze({ edge, sourceIndex }))
		.sort((left, right) => compareDirectedRailEdges(left.edge, right.edge));
	const transformedIndexBySourceIndex = new Int32Array(indexedEdges.length);
	const railEdges = Object.freeze(
		indexedEdges.map(({ edge, sourceIndex }, transformedIndex) => {
			transformedIndexBySourceIndex[sourceIndex] = transformedIndex;
			return freezeDirectedEdge(edge.from, edge.to);
		}),
	);
	const organizations = Object.freeze(
		materialized.organizations.map((organization) =>
			Object.freeze({
				kind: organization.kind,
				name: organization.name,
				parentOrganizationIndices: Object.freeze([...organization.parentOrganizationIndices]),
				properties: copyPortableOrganizationProperties(organization.properties),
				membership: Object.freeze({
					railEdgeIndices: Object.freeze(
						organization.membership.railEdgeIndices
							.map((sourceIndex) => transformedIndexBySourceIndex[sourceIndex] as number)
							.sort(numberCompare),
					),
					advancedSwitchIndices: Object.freeze([...organization.membership.advancedSwitchIndices]),
					equipmentGroupIndices: Object.freeze([...organization.membership.equipmentGroupIndices]),
				}),
			}),
		),
	);
	const transformed = {
		version: STATIC_FAB_ORGANIZATION_BUNDLE_VERSION,
		captureMode: materialized.captureMode,
		rootOrganizationIndices: Object.freeze([...materialized.rootOrganizationIndices]),
		sourceModuleCount: materialized.sourceModuleCount,
		sourceWidthMeters: materialized.widthMeters,
		sourceHeightMeters: materialized.heightMeters,
		railEdges,
		advancedSwitches: materialized.advancedSwitches,
		ports: materialized.ports,
		equipmentGroups: materialized.equipmentGroups,
		organizations,
	} satisfies StaticFabOrganizationBundle;
	const normalized = prepareStaticFabOrganizationBundle(transformed);
	if (!normalized.valid) {
		throw new Error(`회전한 조직 번들을 정규화할 수 없습니다 · ${normalized.reason}`);
	}
	return normalized.bundle;
}

function organizationBundleNormalizationAnchor(
	bundle: StaticFabOrganizationBundle,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): Cell {
	if (quarterTurns === 1) return freezeCell({ x: bundle.sourceHeightMeters, y: 0 });
	if (quarterTurns === 2) {
		return freezeCell({ x: bundle.sourceWidthMeters, y: bundle.sourceHeightMeters });
	}
	if (quarterTurns === 3) return freezeCell({ x: 0, y: bundle.sourceWidthMeters });
	return freezeCell({ x: 0, y: 0 });
}

function copyPreparedStaticFabOrganizationBundle(
	source: StaticFabOrganizationBundle,
): StaticFabOrganizationBundle {
	return Object.freeze({
		version: STATIC_FAB_ORGANIZATION_BUNDLE_VERSION,
		captureMode: source.captureMode,
		rootOrganizationIndices: Object.freeze([...source.rootOrganizationIndices]),
		sourceModuleCount: source.sourceModuleCount,
		sourceWidthMeters: source.sourceWidthMeters,
		sourceHeightMeters: source.sourceHeightMeters,
		railEdges: Object.freeze(
			source.railEdges.map((edge) => freezeDirectedEdge(edge.from, edge.to)),
		),
		advancedSwitches: Object.freeze(
			source.advancedSwitches.map((record) =>
				Object.freeze({
					profileClass: record.profileClass,
					origin: freezeCell(record.origin),
					forward: record.forward,
					lateral: record.lateral,
					movementMask: record.movementMask,
				}),
			),
		),
		ports: Object.freeze(
			source.ports.map((port) =>
				Object.freeze({
					equipmentGroupIndex: port.equipmentGroupIndex,
					route: copyPortablePortRoute(port.route),
					stationMillimeters: port.stationMillimeters,
					side: port.side,
					lateralOffsetMillimeters: port.lateralOffsetMillimeters,
					direction: port.direction,
					portType: port.portType,
				}),
			),
		),
		equipmentGroups: Object.freeze(source.equipmentGroups.map(copyPortableEquipmentGroup)),
		organizations: Object.freeze(
			source.organizations.map((organization) =>
				Object.freeze({
					kind: organization.kind,
					name: organization.name,
					parentOrganizationIndices: Object.freeze([...organization.parentOrganizationIndices]),
					properties: copyPortableOrganizationProperties(organization.properties),
					membership: Object.freeze({
						railEdgeIndices: Object.freeze([...organization.membership.railEdgeIndices]),
						advancedSwitchIndices: Object.freeze([
							...organization.membership.advancedSwitchIndices,
						]),
						equipmentGroupIndices: Object.freeze([
							...organization.membership.equipmentGroupIndices,
						]),
					}),
				}),
			),
		),
	});
}

function copyPortablePortRoute(
	route: StaticFabOrganizationBundlePortRoute,
): StaticFabOrganizationBundlePortRoute {
	if (route.kind === "CARDINAL_CELL") {
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: route.x,
			z: route.z,
			from: route.from,
			to: route.to,
		});
	}
	return Object.freeze({
		kind: "ADVANCED_SWITCH_SEGMENT",
		advancedSwitchIndex: route.advancedSwitchIndex,
		profileClass: route.profileClass,
		role: route.role,
		portIndex: route.portIndex,
		segmentOrdinal: route.segmentOrdinal,
	});
}

function copyPortableEquipmentGroup(
	group: StaticFabOrganizationBundleEquipmentGroup,
): StaticFabOrganizationBundleEquipmentGroup {
	const portIndices = Object.freeze([...group.portIndices]);
	if (group.kind === "OHB") {
		return Object.freeze({ kind: "OHB", template: "SINGLE", portIndices });
	}
	if (group.kind === "EQ") {
		return Object.freeze({
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters,
			recipe: group.recipe,
			portIndices,
		});
	}
	return Object.freeze({ kind: "STK", template: group.template, portIndices });
}

function copyPortableOrganizationProperties(
	properties: StaticFabOrganizationProperties,
): StaticFabOrganizationProperties {
	return Object.freeze({
		description: properties.description,
		color: properties.color,
	});
}

function portablePortRoute(
	port: PortRecord,
	advancedSwitchIndexById: ReadonlyMap<number, number>,
	bounds: DirectedEdgeBounds,
): StaticFabOrganizationBundlePortRoute | null {
	if (port.route.kind === "CARDINAL_CELL") {
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: port.route.x - bounds.minX,
			z: port.route.z - bounds.minY,
			from: port.route.from,
			to: port.route.to,
		});
	}
	const advancedSwitchIndex = advancedSwitchIndexById.get(port.route.switchId);
	if (advancedSwitchIndex === undefined) return null;
	return Object.freeze({
		kind: "ADVANCED_SWITCH_SEGMENT",
		advancedSwitchIndex,
		profileClass: port.route.profileClass,
		role: port.route.role,
		portIndex: port.route.portIndex,
		segmentOrdinal: port.route.segmentOrdinal,
	});
}

function portableEquipmentGroup(
	group: EquipmentGroupRecord,
	portIndices: readonly number[],
): StaticFabOrganizationBundleEquipmentGroup {
	if (group.kind === "OHB") {
		return Object.freeze({ kind: "OHB", template: "SINGLE", portIndices });
	}
	if (group.kind === "EQ") {
		return Object.freeze({
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters,
			recipe: group.recipe,
			portIndices,
		});
	}
	if (!isStkAuthoringTemplate(group.template)) {
		throw new Error("legacy CUSTOM STK 그룹은 portable 조직 번들로 캡처할 수 없습니다");
	}
	return Object.freeze({ kind: "STK", template: group.template, portIndices });
}

function runtimeEquipmentGroup(
	group: StaticFabOrganizationBundleEquipmentGroup,
	id: number,
): EquipmentGroupRecord {
	const portIds = group.portIndices.map((index) => index + 1);
	if (group.kind === "OHB") return { id, kind: "OHB", template: "SINGLE", portIds };
	if (group.kind === "EQ") {
		return {
			id,
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters,
			recipe: group.recipe,
			portIds,
		};
	}
	return { id, kind: "STK", template: group.template, portIds };
}

function runtimePortRecord(port: StaticFabOrganizationBundlePort, id: number): PortRecord {
	return {
		id,
		equipmentGroupId: port.equipmentGroupIndex + 1,
		route:
			port.route.kind === "CARDINAL_CELL"
				? port.route
				: {
						kind: "ADVANCED_SWITCH_SEGMENT",
						switchId: port.route.advancedSwitchIndex + 1,
						profileClass: port.route.profileClass,
						role: port.route.role,
						portIndex: port.route.portIndex,
						segmentOrdinal: port.route.segmentOrdinal,
					},
		stationMillimeters: port.stationMillimeters,
		side: port.side,
		lateralOffsetMillimeters: port.lateralOffsetMillimeters,
		direction: port.direction,
		portType: port.portType,
		barcode: null,
	};
}

function portableOrganizationMetadataError(
	organization: StaticFabOrganizationBundleOrganization,
	namesByKind: Map<StaticFabOrganizationKind, Set<string>>,
): string | null {
	if (!STATIC_FAB_ORGANIZATION_KINDS.includes(organization.kind))
		return "조직 종류가 유효하지 않습니다";
	if (
		organization.name.length === 0 ||
		organization.name.length > 120 ||
		organization.name !== organization.name.trim() ||
		hasAsciiControlCharacter(organization.name)
	) {
		return "이름은 제어문자 없는 1-120자의 trim된 문자열이어야 합니다";
	}
	const names = namesByKind.get(organization.kind) ?? new Set<string>();
	const normalizedName = normalizeStaticFabOrganizationName(organization.name);
	if (names.has(normalizedName))
		return `같은 종류의 조직 이름 '${organization.name}'이 중복되었습니다`;
	names.add(normalizedName);
	namesByKind.set(organization.kind, names);
	if (organization.parentOrganizationIndices.length > STATIC_FAB_ORGANIZATION_MAX_PARENTS) {
		return `부모 조직은 최대 ${STATIC_FAB_ORGANIZATION_MAX_PARENTS}개까지 지정할 수 있습니다`;
	}
	if (
		organization.properties.description.length > STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH ||
		organization.properties.description !== organization.properties.description.trim() ||
		hasDisallowedTextControlCharacter(organization.properties.description)
	) {
		return `설명은 허용되지 않은 제어문자 없이 trim된 ${STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH}자 이하여야 합니다`;
	}
	if (!STATIC_FAB_ORGANIZATION_COLORS.includes(organization.properties.color)) {
		return "조직 색상이 유효하지 않습니다";
	}
	return null;
}

function portableOrganizationCycle(
	organizations: readonly StaticFabOrganizationBundleOrganization[],
): boolean {
	const children = new Map<number, number[]>();
	const remaining = organizations.map(
		(organization) => organization.parentOrganizationIndices.length,
	);
	for (let childIndex = 0; childIndex < organizations.length; childIndex++) {
		for (const parentIndex of organizations[childIndex]?.parentOrganizationIndices ?? []) {
			const list = children.get(parentIndex);
			if (list) list.push(childIndex);
			else children.set(parentIndex, [childIndex]);
		}
	}
	const ready = remaining.flatMap((count, index) => (count === 0 ? [index] : []));
	let visited = 0;
	for (let offset = 0; offset < ready.length; offset++) {
		visited++;
		for (const childIndex of children.get(ready[offset] as number) ?? []) {
			remaining[childIndex] = (remaining[childIndex] as number) - 1;
			if (remaining[childIndex] === 0) ready.push(childIndex);
		}
	}
	return visited !== organizations.length;
}

function portableOrganizationRootClosureError(bundle: StaticFabOrganizationBundle): string | null {
	if (bundle.captureMode === "DIRECT") {
		if (
			bundle.rootOrganizationIndices.length !== bundle.organizations.length ||
			bundle.rootOrganizationIndices.some((index, position) => index !== position)
		) {
			return "DIRECT 조직 번들은 포함된 모든 조직을 명시적 루트로 기록해야 합니다";
		}
		return null;
	}

	const children = new Map<number, number[]>();
	for (let childIndex = 0; childIndex < bundle.organizations.length; childIndex++) {
		for (const parentIndex of bundle.organizations[childIndex]?.parentOrganizationIndices ?? []) {
			const list = children.get(parentIndex);
			if (list) list.push(childIndex);
			else children.set(parentIndex, [childIndex]);
		}
	}
	const reached = new Set(bundle.rootOrganizationIndices);
	const pending = [...bundle.rootOrganizationIndices];
	for (let offset = 0; offset < pending.length; offset++) {
		for (const childIndex of children.get(pending[offset] as number) ?? []) {
			if (reached.has(childIndex)) continue;
			reached.add(childIndex);
			pending.push(childIndex);
		}
	}
	return reached.size === bundle.organizations.length
		? null
		: "EFFECTIVE 조직 번들에는 루트에서 도달할 수 없는 조직이 있습니다";
}

function reconstructPortableBundleMap(bundle: StaticFabOrganizationBundle): TileMap | string {
	const cellStates = new Map<
		string,
		{ readonly x: number; readonly y: number; incoming: number; outgoing: number }
	>();
	const stateAt = (cell: Cell) => {
		const key = `${cell.x},${cell.y}`;
		const existing = cellStates.get(key);
		if (existing) return existing;
		const created = { x: cell.x, y: cell.y, incoming: 0, outgoing: 0 };
		cellStates.set(key, created);
		return created;
	};
	for (const edge of bundle.railEdges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) {
			return "조직 번들 레일 edge를 TileMap으로 복원할 수 없습니다";
		}
		stateAt(edge.from).outgoing |= direction;
		stateAt(edge.to).incoming |= oppositeDirection(direction);
	}

	const map = new TileMap();
	for (const state of cellStates.values()) {
		map.setEncoded(
			state.x,
			state.y,
			encodeRailCell({ incoming: state.incoming, outgoing: state.outgoing }),
		);
	}
	for (let index = 0; index < bundle.advancedSwitches.length; index++) {
		const portable = bundle.advancedSwitches[index] as StaticFabOrganizationBundleAdvancedSwitch;
		const record = {
			id: index + 1,
			profileClass: portable.profileClass,
			origin: portable.origin,
			forward: portable.forward,
			lateral: portable.lateral,
			movementMask: portable.movementMask,
		};
		try {
			if (!map.setAdvancedSwitch(record)) {
				return `조직 번들 고급 스위치 ${index}을 복원할 수 없습니다`;
			}
		} catch (error) {
			return `조직 번들 고급 스위치 ${index} 점유 영역이 충돌합니다 · ${caughtMessage(error)}`;
		}
	}
	for (let index = 0; index < bundle.advancedSwitches.length; index++) {
		const record = map.getAdvancedSwitch(index + 1);
		if (!record) return `조직 번들 고급 스위치 ${index}이 누락되었습니다`;
		const issues = validateAdvancedSwitchTopology((x, y) => map.getEncoded(x, y), record);
		if (issues.length > 0) {
			return `조직 번들 고급 스위치 ${index} topology가 유효하지 않습니다 · ${issues[0]?.message ?? "unknown issue"}`;
		}
	}
	return map;
}

function runtimePortEquipmentState(bundle: StaticFabOrganizationBundle): PortEquipmentState {
	return {
		nextPortId: bundle.ports.length + 1,
		nextEquipmentGroupId: bundle.equipmentGroups.length + 1,
		ports: bundle.ports.map((port, index) => runtimePortRecord(port, index + 1)),
		equipmentGroups: bundle.equipmentGroups.map((group, index) =>
			runtimeEquipmentGroup(group, index + 1),
		),
	};
}

function runtimeOrganizationState(bundle: StaticFabOrganizationBundle): StaticFabOrganizationState {
	return {
		nextOrganizationId: bundle.organizations.length + 1,
		records: bundle.organizations.map((organization, index) => ({
			id: index + 1,
			kind: organization.kind,
			name: organization.name,
			parentOrganizationIds: organization.parentOrganizationIndices.map(
				(parentIndex) => parentIndex + 1,
			),
			properties: {
				description: organization.properties.description,
				color: organization.properties.color,
			},
			membership: {
				railEdges: organization.membership.railEdgeIndices.map((edgeIndex) => {
					const edge = bundle.railEdges[edgeIndex] as DirectedRailEdge;
					return {
						from: { x: edge.from.x, y: edge.from.y },
						to: { x: edge.to.x, y: edge.to.y },
					};
				}),
				advancedSwitchIds: organization.membership.advancedSwitchIndices.map(
					(switchIndex) => switchIndex + 1,
				),
				equipmentGroupIds: organization.membership.equipmentGroupIndices.map(
					(groupIndex) => groupIndex + 1,
				),
			},
		})),
	};
}

function claimPortableMembership(
	owners: Map<string, number>,
	kind: StaticFabOrganizationKind,
	resourceIndex: number,
	organizationIndex: number,
): string | null {
	const key = `${kind}:${resourceIndex}`;
	const owner = owners.get(key);
	if (owner !== undefined) {
		return `${kind} 조직 ${owner}과 ${organizationIndex}이 같은 portable membership을 소유합니다`;
	}
	owners.set(key, organizationIndex);
	return null;
}

function bundleSupportsCardinalRoute(
	route: Extract<StaticFabOrganizationBundlePortRoute, { readonly kind: "CARDINAL_CELL" }>,
	edgeKeys: ReadonlySet<string>,
): boolean {
	const cell = { x: route.x, y: route.z };
	if (route.from !== 0) {
		const source = moveCell(cell, route.from);
		if (!edgeKeys.has(staticFabOrganizationEdgeKey({ from: source, to: cell }))) return false;
	}
	if (route.to !== 0) {
		const target = moveCell(cell, route.to);
		if (!edgeKeys.has(staticFabOrganizationEdgeKey({ from: cell, to: target }))) return false;
	}
	return true;
}

interface DirectedEdgeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function directedEdgeBounds(edges: readonly DirectedRailEdge[]): DirectedEdgeBounds {
	const first = edges[0];
	if (!first) throw new Error("조직 번들에는 하나 이상의 레일 edge가 필요합니다");
	let minX = Math.min(first.from.x, first.to.x);
	let minY = Math.min(first.from.y, first.to.y);
	let maxX = Math.max(first.from.x, first.to.x);
	let maxY = Math.max(first.from.y, first.to.y);
	for (let index = 1; index < edges.length; index++) {
		const edge = edges[index] as DirectedRailEdge;
		minX = Math.min(minX, edge.from.x, edge.to.x);
		minY = Math.min(minY, edge.from.y, edge.to.y);
		maxX = Math.max(maxX, edge.from.x, edge.to.x);
		maxY = Math.max(maxY, edge.from.y, edge.to.y);
	}
	return { minX, minY, maxX, maxY };
}

function mutableDirectedEdgeBounds(edges: readonly DirectedRailEdge[]): DirectedEdgeBounds {
	return directedEdgeBounds(edges);
}

function includeBoundsCell(bounds: DirectedEdgeBounds, cell: Cell): void {
	bounds.minX = Math.min(bounds.minX, cell.x);
	bounds.minY = Math.min(bounds.minY, cell.y);
	bounds.maxX = Math.max(bounds.maxX, cell.x);
	bounds.maxY = Math.max(bounds.maxY, cell.y);
}

function rotateCell(cell: Cell, quarterTurns: StaticFabOrganizationBundleQuarterTurns): Cell {
	if (quarterTurns === 0) return { x: cell.x, y: cell.y };
	if (quarterTurns === 1) return { x: -cell.y, y: cell.x };
	if (quarterTurns === 2) return { x: -cell.x, y: -cell.y };
	return { x: cell.y, y: -cell.x };
}

function rotateDirection(
	direction: 0 | Direction,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): 0 | Direction {
	if (direction === 0) return 0;
	const rotated = rotateCell(moveCell({ x: 0, y: 0 }, direction), quarterTurns);
	const result = directionBetween({ x: 0, y: 0 }, rotated);
	if (result === null || !ALL_DIRECTIONS.includes(result))
		throw new Error("조직 번들 방향 회전에 실패했습니다");
	return result;
}

function translateCell(cell: Cell, deltaX: number, deltaY: number): Cell {
	const translated = { x: cell.x + deltaX, y: cell.y + deltaY };
	if (!validInt32Cell(translated))
		throw new Error("조직 번들 좌표가 signed-int32 범위를 벗어났습니다");
	return translated;
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}

function freezeDirectedEdge(from: Cell, to: Cell): DirectedRailEdge {
	return Object.freeze({ from: freezeCell(from), to: freezeCell(to) });
}

function cardinalRouteCell(cell: Cell): {
	readonly x: number;
	readonly z: number;
} {
	return { x: cell.x, z: cell.y };
}

function requiredIndex<Key>(indices: ReadonlyMap<Key, number>, key: Key, label: string): number {
	const index = indices.get(key);
	if (index === undefined) throw new Error(`${label} local index를 만들 수 없습니다`);
	return index;
}

function captureFailure(
	code: StaticFabOrganizationBundleIssueCode,
	reason: string,
): StaticFabOrganizationBundleCaptureResult {
	return Object.freeze({ valid: false, bundle: null, code, reason });
}

function canonicalIndexArray(
	values: readonly number[],
	upperBound: number,
	allowEmpty: boolean,
): boolean {
	if (!allowEmpty && values.length === 0) return false;
	let previous = -1;
	for (const value of values) {
		if (!validIndex(value, upperBound) || value <= previous) return false;
		previous = value;
	}
	return true;
}

function validIndex(value: number, upperBound: number): boolean {
	return Number.isInteger(value) && value >= 0 && value < upperBound;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function portablePortRouteHasExactKeys(route: unknown): boolean {
	if (!isRecord(route)) return false;
	if (route.kind === "CARDINAL_CELL") {
		return hasExactKeys(route, CARDINAL_ROUTE_KEYS);
	}
	if (route.kind === "ADVANCED_SWITCH_SEGMENT") {
		return hasExactKeys(route, ADVANCED_SWITCH_ROUTE_KEYS);
	}
	return false;
}

function portableEquipmentGroupHasExactKeys(group: unknown): boolean {
	if (!isRecord(group)) return false;
	if (group.kind === "OHB") return hasExactKeys(group, OHB_GROUP_KEYS);
	if (group.kind === "EQ") return hasExactKeys(group, EQ_GROUP_KEYS);
	if (group.kind === "STK") return hasExactKeys(group, STK_GROUP_KEYS);
	return false;
}

function recursivelyFrozenObject(value: unknown, seen = new Set<object>()): boolean {
	if (typeof value !== "object" || value === null) return true;
	if (seen.has(value)) return true;
	if (!Object.isFrozen(value)) return false;
	seen.add(value);
	for (const child of Object.values(value)) {
		if (!recursivelyFrozenObject(child, seen)) return false;
	}
	return true;
}

function positiveBoundedCount(value: number, maximum: number): boolean {
	return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function boundedSpan(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0 && value <= 0x7fff_ffff;
}

function validInt32Cell(cell: Cell): boolean {
	return isInt32(cell.x) && isInt32(cell.y);
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff;
}

function isStkAuthoringTemplate(value: string): value is StkAuthoringTemplate {
	return (STK_AUTHORING_TEMPLATES as readonly string[]).includes(value);
}

function setsEqual<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function numberCompare(left: number, right: number): number {
	return left - right;
}

function hasAsciiControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function hasDisallowedTextControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if ((code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f) return true;
	}
	return false;
}

function caughtMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "unknown error";
}
