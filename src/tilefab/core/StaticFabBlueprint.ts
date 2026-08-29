import {
	applyPortEquipmentMutations,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	type PortEquipmentState,
	STK_AUTHORING_TEMPLATES,
	type StkAuthoringTemplate,
} from "./EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	equipmentGroupPortBarcode,
} from "./EquipmentGroupPortOrder";
import { allocatePortEquipmentRecordIds } from "./PortEquipmentIdAllocator";
import { assertPortEquipmentLayout, portRouteExists } from "./PortEquipmentLayoutValidator";
import {
	type CardinalPortRoute,
	copyPortRecord,
	type PortDirection,
	type PortMutation,
	type PortRecord,
	type PortSide,
	type PortType,
} from "./PortRecord";
import type { RailConstructionPlan } from "./paint";
import {
	createRailAreaStampTemplate,
	createRailAreaStampTemplateFromValidatedSelection,
	planRailAreaStamp,
	type RailAreaStampPlan,
	type RailAreaStampPose,
	type RailAreaStampQuarterTurns,
	type RailAreaStampTemplate,
	railAreaStampPoseBounds,
	transformRailAreaStampTemplate,
} from "./RailAreaStamp";
import { type Direction, directionBetween, moveCell, oppositeDirection } from "./railShape";
import type { StaticFabSelection } from "./StaticFabSelection";
import { type Cell, decodeRailCell, encodeRailCell, TileMap } from "./TileMap";

export const STATIC_FAB_BLUEPRINT_MAX_PORTS = 4_096;
export const STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS = 1_024;
export const STATIC_FAB_MINIMUM_PORT_SPACING_METERS = 0.6;

export interface StaticFabBlueprintPortTemplate {
	readonly equipmentGroupIndex: number;
	readonly route: CardinalPortRoute;
	readonly stationMillimeters: number;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
	readonly portType: PortType;
}

export type StaticFabBlueprintEquipmentGroupTemplate =
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

/** Portable authored truth. Runtime IDs, barcodes, revisions, and renderer data are excluded. */
export interface StaticFabBlueprintTemplate {
	readonly rail: RailAreaStampTemplate;
	readonly ports: readonly StaticFabBlueprintPortTemplate[];
	readonly equipmentGroups: readonly StaticFabBlueprintEquipmentGroupTemplate[];
}

export interface StaticFabBlueprintPortPreview {
	readonly portId: number;
	readonly equipmentGroupId: number;
	readonly portType: PortType;
	readonly railX: number;
	readonly railZ: number;
	readonly worldX: number;
	readonly worldZ: number;
	readonly tangentX: number;
	readonly tangentZ: number;
}

export interface StaticFabBlueprintPlacementMetadata {
	readonly sourceModuleCount: number;
	readonly sourceEdgeCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly quarterTurns: RailAreaStampQuarterTurns;
	readonly reverseFlow: boolean;
	readonly anchor: Cell;
	readonly portPreviews: readonly StaticFabBlueprintPortPreview[];
}

export type StaticFabMutationPlan = RailConstructionPlan & {
	readonly basePatchSequence: number;
	readonly railPlan: RailAreaStampPlan;
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
	readonly staticFab: StaticFabBlueprintPlacementMetadata;
};

export function createStaticFabBlueprintTemplate(
	selection: StaticFabSelection,
): StaticFabBlueprintTemplate {
	return captureStaticFabBlueprintTemplate(selection, false);
}

export function createStaticFabBlueprintTemplateFromValidatedSelection(
	selection: StaticFabSelection,
): StaticFabBlueprintTemplate {
	return captureStaticFabBlueprintTemplate(selection, true);
}

/** Bake the current placement pose into one immutable, origin-normalized mixed FAB template. */
export function transformStaticFabBlueprintTemplate(
	template: StaticFabBlueprintTemplate,
	pose: RailAreaStampPose,
): StaticFabBlueprintTemplate {
	const bounds = railAreaStampPoseBounds(template.rail, pose);
	const normalizationAnchor = Object.freeze({ x: -bounds.minX, y: -bounds.minY });
	return Object.freeze({
		rail: transformRailAreaStampTemplate(template.rail, pose),
		ports: Object.freeze(
			template.ports.map((port) =>
				Object.freeze({
					equipmentGroupIndex: port.equipmentGroupIndex,
					route: transformCardinalRoute(port.route, normalizationAnchor, pose),
					stationMillimeters: port.stationMillimeters,
					side: pose.reverseFlow ? reversePortSide(port.side) : port.side,
					lateralOffsetMillimeters: port.lateralOffsetMillimeters,
					direction: pose.reverseFlow ? reversePortDirection(port.direction) : port.direction,
					portType: port.portType,
				}),
			),
		),
		equipmentGroups: Object.freeze(
			template.equipmentGroups.map(copyBlueprintEquipmentGroupTemplate),
		),
	});
}

function captureStaticFabBlueprintTemplate(
	selection: StaticFabSelection,
	selectionValidated: boolean,
): StaticFabBlueprintTemplate {
	const rail = selectionValidated
		? createRailAreaStampTemplateFromValidatedSelection(selection.rail)
		: createRailAreaStampTemplate(selection.rail);
	if (selection.equipmentGroups.length > STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS) {
		throw new Error(
			`한 청사진은 최대 ${STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS.toLocaleString()}개 장비 그룹을 지원합니다`,
		);
	}
	const sourceOrigin = selectedRailOrigin(selection);
	const selectedRail = railTemplateMap(rail);
	const ports: StaticFabBlueprintPortTemplate[] = [];
	const equipmentGroups: StaticFabBlueprintEquipmentGroupTemplate[] = [];
	for (let groupIndex = 0; groupIndex < selection.equipmentGroups.length; groupIndex++) {
		const selected = selection.equipmentGroups[groupIndex];
		if (!selected) continue;
		if (selected.group.kind === "STK" && !isStkAuthoringTemplate(selected.group.template)) {
			throw new Error("legacy CUSTOM STK 그룹은 새 청사진으로 복제할 수 없습니다");
		}
		const portIndices: number[] = [];
		for (const port of selected.ports) {
			if (ports.length >= STATIC_FAB_BLUEPRINT_MAX_PORTS) {
				throw new Error(
					`한 청사진은 최대 ${STATIC_FAB_BLUEPRINT_MAX_PORTS.toLocaleString()}개 포트를 지원합니다`,
				);
			}
			if (port.route.kind !== "CARDINAL_CELL") {
				throw new Error("고급 스위치에 연결된 포트는 현재 혼합 청사진으로 복제할 수 없습니다");
			}
			if (
				port.route.from === 0 ||
				port.route.to === 0 ||
				port.route.to !== oppositeDirection(port.route.from)
			) {
				throw new Error(`PORT-${port.id}는 연속 직선 레일 중앙에 연결되어야 합니다`);
			}
			if (port.stationMillimeters !== 500) {
				throw new Error(`PORT-${port.id}는 현재 혼합 청사진의 500 mm 중앙 station이 아닙니다`);
			}
			const route = Object.freeze({
				...port.route,
				x: port.route.x - sourceOrigin.x,
				z: port.route.z - sourceOrigin.y,
			});
			if (!portRouteExists(selectedRail, route)) {
				throw new Error(
					`PORT-${port.id}의 지지 레일이 선택되지 않았습니다 · 장비와 해당 레일을 함께 선택하세요`,
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
		equipmentGroups.push(copyGroupTemplate(selected.group, portIndices));
	}
	return Object.freeze({
		rail,
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
	});
}

export function planStaticFabBlueprintPlacement(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	template: StaticFabBlueprintTemplate,
	anchor: Cell,
	pose: RailAreaStampPose,
): StaticFabMutationPlan {
	const railPlan = planRailAreaStamp(map, template.rail, anchor, pose);
	const preflightReason = staticFabPlacementPreflightError(
		portEquipment,
		basePatchSequence,
		template,
	);
	if (preflightReason) {
		return invalidStaticFabPlacement(
			railPlan,
			basePatchSequence,
			template,
			anchor,
			pose,
			preflightReason,
		);
	}
	let equipmentGroups: readonly EquipmentGroupRecord[];
	let finalPorts: readonly PortRecord[];
	let portMutations: readonly PortMutation[];
	let equipmentGroupMutations: readonly EquipmentGroupMutation[];
	let previews: readonly StaticFabBlueprintPortPreview[];
	try {
		const allocation = allocatePortEquipmentRecordIds(
			portEquipment,
			template.ports.length,
			template.equipmentGroups.length,
		);
		const groupIds = allocation.equipmentGroupIds;
		const portIds = allocation.portIds;
		const portRecords: PortRecord[] = template.ports.map((port, index) => {
			const groupId = groupIds[port.equipmentGroupIndex];
			if (groupId === undefined) {
				throw new Error(`혼합 청사진 포트 ${index}의 장비 그룹 index가 유효하지 않습니다`);
			}
			const route = transformCardinalRoute(port.route, anchor, pose);
			return {
				id: portIds[index] as number,
				equipmentGroupId: groupId,
				route,
				stationMillimeters: port.stationMillimeters,
				side: pose.reverseFlow ? reversePortSide(port.side) : port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: pose.reverseFlow ? reversePortDirection(port.direction) : port.direction,
				portType: port.portType,
				barcode: null,
			} satisfies PortRecord;
		});
		equipmentGroups = template.equipmentGroups.map((group, index) =>
			instantiateEquipmentGroup(group, groupIds[index] as number, group.portIndices, portRecords),
		);
		const portById = new Map(portRecords.map((port) => [port.id, port]));
		for (const group of equipmentGroups) {
			for (let index = 0; index < group.portIds.length; index++) {
				const portId = group.portIds[index] as number;
				const port = portById.get(portId);
				if (!port) throw new Error(`혼합 청사진 PORT-${portId}를 찾을 수 없습니다`);
				portById.set(
					portId,
					Object.freeze({
						...port,
						barcode: equipmentGroupPortBarcode(group.kind, group.id, portId, index),
					}),
				);
			}
		}
		finalPorts = portRecords.map((port) => copyPortRecord(portById.get(port.id) as PortRecord));
		portMutations = Object.freeze(
			finalPorts.map((port) => Object.freeze({ id: port.id, before: null, after: port })),
		);
		equipmentGroupMutations = Object.freeze(
			equipmentGroups.map((group) => Object.freeze({ id: group.id, before: null, after: group })),
		);
		previews = Object.freeze(finalPorts.map(portPreview));
	} catch (error) {
		return invalidStaticFabPlacement(
			railPlan,
			basePatchSequence,
			template,
			anchor,
			pose,
			error instanceof Error ? error.message : "혼합 청사진 장비를 구성할 수 없습니다",
		);
	}
	let validationReason: string | null = null;
	if (railPlan.valid) {
		validationReason = staticFabPortSpacingConflict(portEquipment.ports, finalPorts);
		if (!validationReason) {
			try {
				const prospectiveMap = map.clone();
				prospectiveMap.applyAtomicMutations(railPlan.mutations, []);
				const prospectiveEquipment = applyPortEquipmentMutations(
					portEquipment,
					portMutations,
					equipmentGroupMutations,
				);
				assertPortEquipmentLayout(prospectiveMap, prospectiveEquipment);
			} catch (error) {
				validationReason = error instanceof Error ? error.message : "포트 배치 검증에 실패했습니다";
			}
		}
	}
	const valid = railPlan.valid && validationReason === null;
	const reason = valid
		? `레일 ${template.rail.sourceModuleCount}개 · 장비 ${equipmentGroups.length}개 · 포트 ${finalPorts.length}개 배치 가능`
		: (validationReason ?? railPlan.reason);
	const portConflictCells = validationReason
		? finalPorts.flatMap((port) =>
				port.route.kind === "CARDINAL_CELL"
					? [Object.freeze({ x: port.route.x, y: port.route.z })]
					: [],
			)
		: [];
	return Object.freeze({
		...railPlan,
		valid,
		reason,
		conflicts: Object.freeze(uniqueCells([...railPlan.conflicts, ...portConflictCells])),
		basePatchSequence,
		railPlan,
		portMutations,
		equipmentGroupMutations,
		staticFab: Object.freeze({
			sourceModuleCount: template.rail.sourceModuleCount,
			sourceEdgeCount: template.rail.sourceEdgeCount,
			portCount: finalPorts.length,
			equipmentGroupCount: equipmentGroups.length,
			quarterTurns: pose.quarterTurns,
			reverseFlow: pose.reverseFlow,
			anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
			portPreviews: previews,
		}),
	});
}

function staticFabPlacementPreflightError(
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	template: StaticFabBlueprintTemplate,
): string | null {
	if (!Number.isSafeInteger(basePatchSequence) || basePatchSequence < 0) {
		return "혼합 청사진 patch sequence가 유효하지 않습니다";
	}
	if (
		template.ports.length > STATIC_FAB_BLUEPRINT_MAX_PORTS ||
		template.equipmentGroups.length > STATIC_FAB_BLUEPRINT_MAX_EQUIPMENT_GROUPS
	) {
		return "혼합 청사진이 지원 크기를 초과했습니다";
	}
	try {
		allocatePortEquipmentRecordIds(
			portEquipment,
			template.ports.length,
			template.equipmentGroups.length,
		);
	} catch (error) {
		return error instanceof Error ? error.message : "포트 또는 장비 그룹 ID를 할당할 수 없습니다";
	}
	return null;
}

function invalidStaticFabPlacement(
	railPlan: RailAreaStampPlan,
	basePatchSequence: number,
	template: StaticFabBlueprintTemplate,
	anchor: Cell,
	pose: RailAreaStampPose,
	reason: string,
): StaticFabMutationPlan {
	return Object.freeze({
		...railPlan,
		valid: false,
		reason,
		basePatchSequence,
		railPlan,
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		staticFab: Object.freeze({
			sourceModuleCount: template.rail.sourceModuleCount,
			sourceEdgeCount: template.rail.sourceEdgeCount,
			portCount: template.ports.length,
			equipmentGroupCount: template.equipmentGroups.length,
			quarterTurns: pose.quarterTurns,
			reverseFlow: pose.reverseFlow,
			anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
			portPreviews: Object.freeze([]),
		}),
	});
}

export function isStaticFabMutationPlan(plan: unknown): plan is StaticFabMutationPlan {
	return typeof plan === "object" && plan !== null && "staticFab" in plan;
}

function selectedRailOrigin(selection: StaticFabSelection): Cell {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	for (const ownership of selection.rail.ownerships) {
		for (const edge of ownership.eraseEdges) {
			minX = Math.min(minX, edge.from.x, edge.to.x);
			minY = Math.min(minY, edge.from.y, edge.to.y);
		}
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		throw new Error("혼합 청사진에 정규화할 레일 edge가 없습니다");
	}
	return Object.freeze({ x: minX, y: minY });
}

function railTemplateMap(template: RailAreaStampTemplate): TileMap {
	const map = new TileMap();
	for (const edge of template.edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) throw new Error("혼합 청사진 레일 edge가 인접하지 않습니다");
		const opposite = oppositeDirection(direction);
		const from = decodeRailCell(map.getEncoded(edge.from.x, edge.from.y));
		const to = decodeRailCell(map.getEncoded(edge.to.x, edge.to.y));
		map.setEncoded(
			edge.from.x,
			edge.from.y,
			encodeRailCell({ ...from, outgoing: from.outgoing | direction }),
		);
		map.setEncoded(
			edge.to.x,
			edge.to.y,
			encodeRailCell({ ...to, incoming: to.incoming | opposite }),
		);
	}
	return map;
}

function copyGroupTemplate(
	group: EquipmentGroupRecord,
	portIndices: readonly number[],
): StaticFabBlueprintEquipmentGroupTemplate {
	const frozenPortIndices = Object.freeze([...portIndices]);
	if (group.kind === "OHB") {
		return Object.freeze({ kind: "OHB", template: "SINGLE", portIndices: frozenPortIndices });
	}
	if (group.kind === "EQ") {
		return Object.freeze({
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters,
			recipe: group.recipe,
			portIndices: frozenPortIndices,
		});
	}
	if (!isStkAuthoringTemplate(group.template)) {
		throw new Error("legacy CUSTOM STK 그룹은 새 청사진으로 복제할 수 없습니다");
	}
	return Object.freeze({
		kind: "STK",
		template: group.template,
		portIndices: frozenPortIndices,
	});
}

function copyBlueprintEquipmentGroupTemplate(
	group: StaticFabBlueprintEquipmentGroupTemplate,
): StaticFabBlueprintEquipmentGroupTemplate {
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

function isStkAuthoringTemplate(value: string): value is StkAuthoringTemplate {
	return (STK_AUTHORING_TEMPLATES as readonly string[]).includes(value);
}

function transformCardinalRoute(
	route: CardinalPortRoute,
	anchor: Cell,
	pose: RailAreaStampPose,
): CardinalPortRoute {
	const offset = rotateOffset({ x: route.x, y: route.z }, pose.quarterTurns);
	const from = rotateDirection(route.from, pose.quarterTurns);
	const to = rotateDirection(route.to, pose.quarterTurns);
	return Object.freeze({
		kind: "CARDINAL_CELL",
		x: anchor.x + offset.x,
		z: anchor.y + offset.y,
		from: pose.reverseFlow ? to : from,
		to: pose.reverseFlow ? from : to,
	});
}

function instantiateEquipmentGroup(
	template: StaticFabBlueprintEquipmentGroupTemplate,
	id: number,
	portIndices: readonly number[],
	ports: readonly PortRecord[],
): EquipmentGroupRecord {
	const candidatePortIds = portIndices.map((index) => {
		const port = ports[index];
		if (!port) throw new Error(`혼합 청사진 장비 그룹 ${id}의 port index가 유효하지 않습니다`);
		if (port.equipmentGroupId !== id || port.portType !== template.kind) {
			throw new Error(`혼합 청사진 장비 그룹 ${id}의 포트 소유권이 일치하지 않습니다`);
		}
		return port.id;
	});
	const portIds = canonicalEquipmentGroupPortIds(template, candidatePortIds, ports);
	if (template.kind === "OHB") {
		return Object.freeze({ id, kind: "OHB", template: "SINGLE", portIds });
	}
	if (template.kind === "EQ") {
		return Object.freeze({
			id,
			kind: "EQ",
			pitchMillimeters: template.pitchMillimeters,
			recipe: template.recipe,
			portIds,
		});
	}
	return Object.freeze({ id, kind: "STK", template: template.template, portIds });
}

export function staticFabPortSpacingConflict(
	existingPorts: readonly PortRecord[],
	candidatePorts: readonly PortRecord[],
): string | null {
	type PositionedPort = Readonly<{
		port: PortRecord;
		world: Readonly<{ x: number; z: number }>;
		candidate: boolean;
	}>;
	const buckets = new Map<string, PositionedPort[]>();
	const insert = (positioned: PositionedPort): void => {
		const key = portSpacingBucketKey(positioned.world.x, positioned.world.z);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(positioned);
		else buckets.set(key, [positioned]);
	};
	for (const port of existingPorts) {
		const world = cardinalPortWorld(port);
		if (world) insert({ port, world, candidate: false });
	}
	for (const port of candidatePorts) {
		const world = cardinalPortWorld(port);
		if (!world) return `PORT-${port.id}의 위치를 계산할 수 없습니다`;
		const bucketX = Math.floor(world.x / STATIC_FAB_MINIMUM_PORT_SPACING_METERS);
		const bucketZ = Math.floor(world.z / STATIC_FAB_MINIMUM_PORT_SPACING_METERS);
		for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
			for (let deltaX = -1; deltaX <= 1; deltaX++) {
				const nearby = buckets.get(`${bucketX + deltaX}:${bucketZ + deltaZ}`);
				if (!nearby) continue;
				for (const other of nearby) {
					if (
						Math.hypot(world.x - other.world.x, world.z - other.world.z) >=
						STATIC_FAB_MINIMUM_PORT_SPACING_METERS - 1e-6
					) {
						continue;
					}
					return other.candidate
						? `청사진 PORT-${port.id}와 PORT-${other.port.id}의 간격이 600 mm 미만입니다`
						: `PORT-${port.id}가 기존 PORT-${other.port.id}와 최소 600 mm 간격을 확보하지 못합니다`;
				}
			}
		}
		insert({ port, world, candidate: true });
	}
	return null;
}

function portSpacingBucketKey(x: number, z: number): string {
	return `${Math.floor(x / STATIC_FAB_MINIMUM_PORT_SPACING_METERS)}:${Math.floor(z / STATIC_FAB_MINIMUM_PORT_SPACING_METERS)}`;
}

function portPreview(port: PortRecord): StaticFabBlueprintPortPreview {
	const world = cardinalPortWorld(port);
	if (!world || port.route.kind !== "CARDINAL_CELL" || port.route.to === 0) {
		throw new Error(`PORT-${port.id}의 혼합 청사진 미리보기를 계산할 수 없습니다`);
	}
	const tangent = moveCell({ x: 0, y: 0 }, port.route.to);
	const stationOffset = port.stationMillimeters / 1_000 - 0.5;
	return Object.freeze({
		portId: port.id,
		equipmentGroupId: port.equipmentGroupId,
		portType: port.portType,
		railX: port.route.x + 0.5 + tangent.x * stationOffset,
		railZ: port.route.z + 0.5 + tangent.y * stationOffset,
		worldX: world.x,
		worldZ: world.z,
		tangentX: tangent.x,
		tangentZ: tangent.y,
	});
}

function cardinalPortWorld(port: PortRecord): { readonly x: number; readonly z: number } | null {
	if (port.route.kind !== "CARDINAL_CELL" || port.route.to === 0) return null;
	const tangent = moveCell({ x: 0, y: 0 }, port.route.to);
	const normal = { x: -tangent.y, y: tangent.x };
	const stationOffset = port.stationMillimeters / 1_000 - 0.5;
	const sideSign = port.side === "LEFT" ? 1 : port.side === "RIGHT" ? -1 : 0;
	const lateralOffset = (port.lateralOffsetMillimeters / 1_000) * sideSign;
	return Object.freeze({
		x: port.route.x + 0.5 + tangent.x * stationOffset + normal.x * lateralOffset,
		z: port.route.z + 0.5 + tangent.y * stationOffset + normal.y * lateralOffset,
	});
}

function rotateOffset(offset: Cell, quarterTurns: RailAreaStampQuarterTurns): Cell {
	if (quarterTurns === 0) return { x: offset.x, y: offset.y };
	if (quarterTurns === 1) return { x: -offset.y, y: offset.x };
	if (quarterTurns === 2) return { x: -offset.x, y: -offset.y };
	return { x: offset.y, y: -offset.x };
}

function rotateDirection(
	direction: 0 | Direction,
	quarterTurns: RailAreaStampQuarterTurns,
): 0 | Direction {
	if (direction === 0) return 0;
	const vector = moveCell({ x: 0, y: 0 }, direction);
	const rotated = rotateOffset(vector, quarterTurns);
	const result = directionBetween({ x: 0, y: 0 }, rotated);
	if (result === null) throw new Error("혼합 청사진 방향 회전에 실패했습니다");
	return result;
}

function reversePortSide(side: PortSide): PortSide {
	if (side === "LEFT") return "RIGHT";
	if (side === "RIGHT") return "LEFT";
	return "CENTER";
}

function reversePortDirection(direction: PortDirection): PortDirection {
	return direction === "WITH_TRAVEL" ? "AGAINST_TRAVEL" : "WITH_TRAVEL";
}

function uniqueCells(cells: readonly Cell[]): readonly Cell[] {
	const byKey = new Map(cells.map((cell) => [`${cell.x}:${cell.y}`, cell]));
	return [...byKey.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}
