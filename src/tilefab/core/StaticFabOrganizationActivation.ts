import {
	type EquipmentGroupRecord,
	isCanonicalPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import {
	type DirectedRailEdge,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import { type Direction, directionBetween, moveCell, oppositeDirection } from "./railShape";
import {
	compareDirectedRailEdges,
	isCanonicalStaticFabOrganizationState,
	normalizeStaticFabOrganizationName,
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import {
	createStaticFabOrganizationMembershipFingerprintAccumulator,
	primeValidatedStaticFabOrganizationMembershipFingerprint,
} from "./StaticFabOrganizationFingerprint";
import { StaticFabOrganizationImpactIndex } from "./StaticFabOrganizationImpactIndex";
import { decodeRailCell, type TileMap } from "./TileMap";

const STATIC_FAB_ORGANIZATION_ACTIVATION = Symbol("StaticFabOrganizationActivation");

/** Runtime proof that one exact authored-state generation passed cooperative semantic validation. */
export interface ValidatedStaticFabOrganizationActivation {
	readonly [STATIC_FAB_ORGANIZATION_ACTIVATION]: true;
}

interface StaticFabOrganizationActivationBinding {
	readonly map: TileMap;
	readonly mapRevision: number;
	readonly mapMutationGeneration: number;
	readonly portEquipment: PortEquipmentState;
	readonly state: StaticFabOrganizationState;
	readonly impactIndex: StaticFabOrganizationImpactIndex;
}

interface OrganizationModuleIndex {
	readonly modules: readonly RailModuleOwnership[];
	readonly moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>;
	readonly moduleIndicesBySwitch: ReadonlyMap<number, readonly number[]>;
}

const activationBindings = new WeakMap<object, StaticFabOrganizationActivationBinding>();
const consumedImpactIndexActivations = new WeakSet<object>();

/**
 * Validate canonical organization truth without monopolizing the caller's event loop.
 *
 * The supplied ownership index must already be hydrated for the same authored revision. The
 * returned value deliberately exposes no data; consumers must use the runtime matcher/assertion so
 * a proof cannot be reused with another map, equipment generation, or organization generation.
 */
export async function validateStaticFabOrganizationActivation(
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
	ownership: RailModuleOwnershipIndex,
	checkpoint: () => Promise<void>,
	operationBudget = 256,
): Promise<ValidatedStaticFabOrganizationActivation> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new Error("Organization activation operation budget must be a positive safe integer.");
	}
	if (!isCanonicalPortEquipmentState(portEquipment)) {
		throw new Error("정적 FAB 조직 활성화에는 canonical port/equipment generation이 필요합니다");
	}
	if (!isCanonicalStaticFabOrganizationState(state)) {
		throw new Error("정적 FAB 조직 활성화에는 canonical 조직 generation이 필요합니다");
	}
	assertFrozenActivationRoot(portEquipment, state);
	const mapRevision = map.getRevision();
	const mapMutationGeneration = map.getMutationGeneration();
	if (!railModuleOwnershipIndexMatchesMap(ownership, map)) {
		throw new Error("정적 FAB 조직 소유권 인덱스가 현재 레일 generation과 일치하지 않습니다");
	}

	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		await checkpoint();
		operations = 0;
		assertStableMapRevision(map, ownership, mapRevision, mapMutationGeneration);
	};

	await validateOrganizationHeaders(state, consumeOperation);
	await validateOrganizationRelationships(state, consumeOperation);
	const moduleIndex = await buildOrganizationModuleIndex(ownership, consumeOperation);
	const groupsById = new Map<number, EquipmentGroupRecord>();
	for (const group of portEquipment.equipmentGroups) {
		assertFrozenValue(group, `장비 그룹 ${group.id}`);
		assertFrozenValue(group.portIds, `장비 그룹 ${group.id}의 port ID 목록`);
		groupsById.set(group.id, group);
		await consumeOperation();
	}
	const portsById = new Map<number, PortEquipmentState["ports"][number]>();
	for (const port of portEquipment.ports) {
		assertFrozenValue(port, `PORT-${port.id}`);
		assertFrozenValue(port.route, `PORT-${port.id} 경로`);
		portsById.set(port.id, port);
		await consumeOperation();
	}

	await validateOrganizationState(map, state, groupsById, portsById, moduleIndex, consumeOperation);
	const impactIndex = await StaticFabOrganizationImpactIndex.prepareCooperatively(
		state,
		consumeOperation,
	);
	await checkpoint();
	assertStableMapRevision(map, ownership, mapRevision, mapMutationGeneration);

	const activation = Object.freeze(Object.create(null) as ValidatedStaticFabOrganizationActivation);
	activationBindings.set(
		activation,
		Object.freeze({
			map,
			mapRevision,
			mapMutationGeneration,
			portEquipment,
			state,
			impactIndex,
		}),
	);
	return activation;
}

/** Return true only for the exact runtime objects and authored map revision that were validated. */
export function staticFabOrganizationActivationMatches(
	activation: unknown,
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
): activation is ValidatedStaticFabOrganizationActivation {
	if ((typeof activation !== "object" && typeof activation !== "function") || activation === null) {
		return false;
	}
	const binding = activationBindings.get(activation);
	return (
		binding !== undefined &&
		binding.map === map &&
		binding.mapRevision === map.getRevision() &&
		binding.mapMutationGeneration === map.getMutationGeneration() &&
		binding.portEquipment === portEquipment &&
		binding.state === state
	);
}

/** Reject a missing, forged, stale, or generation-mismatched activation proof. */
export function assertStaticFabOrganizationActivation(
	activation: unknown,
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
): asserts activation is ValidatedStaticFabOrganizationActivation {
	if (!staticFabOrganizationActivationMatches(activation, map, portEquipment, state)) {
		throw new Error("정적 FAB 조직 활성화가 현재 문서 generation과 일치하지 않습니다");
	}
}

/**
 * Transfer the cooperatively prepared reverse index into exactly one RailDocument.
 *
 * The index is intentionally mutable because later authored edits update it incrementally. A
 * second document must never share that mutable cache, so consumption is synchronous, one-shot,
 * and fail-closed even while the semantic activation itself remains useful as an identity proof.
 */
export function consumeStaticFabOrganizationImpactIndex(
	activation: unknown,
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
): StaticFabOrganizationImpactIndex {
	assertStaticFabOrganizationActivation(activation, map, portEquipment, state);
	if (consumedImpactIndexActivations.has(activation)) {
		throw new Error("정적 FAB 조직 impact index 활성화는 이미 다른 문서에서 소비되었습니다");
	}
	consumedImpactIndexActivations.add(activation);
	return (activationBindings.get(activation) as StaticFabOrganizationActivationBinding).impactIndex;
}

async function buildOrganizationModuleIndex(
	ownership: RailModuleOwnershipIndex,
	consumeOperation: () => Promise<void>,
): Promise<OrganizationModuleIndex> {
	const moduleIndicesByEdge = new Map<string, number[]>();
	const moduleIndicesBySwitch = new Map<number, number[]>();
	for (let moduleIndex = 0; moduleIndex < ownership.modules.length; moduleIndex++) {
		const module = ownership.modules[moduleIndex] as RailModuleOwnership;
		await consumeOperation();
		for (const edge of module.eraseEdges) {
			appendModuleIndex(moduleIndicesByEdge, staticFabOrganizationEdgeKey(edge), moduleIndex);
			await consumeOperation();
		}
		if (module.advancedSwitchId !== null) {
			appendModuleIndex(moduleIndicesBySwitch, module.advancedSwitchId, moduleIndex);
			await consumeOperation();
		}
	}
	return Object.freeze({
		modules: ownership.modules,
		moduleIndicesByEdge,
		moduleIndicesBySwitch,
	});
}

async function validateOrganizationState(
	map: TileMap,
	state: StaticFabOrganizationState,
	groupsById: ReadonlyMap<number, EquipmentGroupRecord>,
	portsById: ReadonlyMap<number, PortEquipmentState["ports"][number]>,
	moduleIndex: OrganizationModuleIndex,
	consumeOperation: () => Promise<void>,
): Promise<void> {
	const ownershipByKind = new Map<StaticFabOrganizationKind, Map<string, number>>();
	for (const record of state.records) {
		await consumeOperation();
		await validateOrganizationRecord(
			map,
			record,
			groupsById,
			portsById,
			moduleIndex,
			ownershipByKind,
			consumeOperation,
		);
	}
}

async function validateOrganizationHeaders(
	state: StaticFabOrganizationState,
	consumeOperation: () => Promise<void>,
): Promise<void> {
	if (!isPositiveInt32(state.nextOrganizationId)) {
		throw new Error("다음 정적 FAB 조직 ID는 양의 32-bit 정수여야 합니다");
	}
	let previousId = 0;
	const namesByKind = new Map<StaticFabOrganizationKind, Set<string>>();
	for (const record of state.records) {
		await consumeOperation();
		assertFrozenValue(record, `조직 ${record.id}`);
		assertFrozenValue(record.membership, `조직 ${record.id} 멤버십`);
		assertFrozenValue(record.membership.railEdges, `조직 ${record.id} 레일 목록`);
		assertFrozenValue(record.membership.advancedSwitchIds, `조직 ${record.id} 스위치 목록`);
		assertFrozenValue(record.membership.equipmentGroupIds, `조직 ${record.id} 장비 목록`);
		if (record.parentOrganizationIds) {
			assertFrozenValue(record.parentOrganizationIds, `조직 ${record.id} 부모 조직 목록`);
		}
		if (record.properties) assertFrozenValue(record.properties, `조직 ${record.id} 속성`);
		const shapeError = organizationRecordHeaderError(record);
		if (shapeError) throw new Error(`조직 ${record.id}: ${shapeError}`);
		if (record.id <= previousId) {
			throw new Error("정적 FAB 조직은 ID 오름차순으로 한 번씩 저장되어야 합니다");
		}
		previousId = record.id;
		const names = namesByKind.get(record.kind) ?? new Set<string>();
		const normalizedName = normalizeStaticFabOrganizationName(record.name);
		if (names.has(normalizedName)) {
			throw new Error(`${record.kind} 조직 이름 '${record.name}'이 중복되었습니다`);
		}
		names.add(normalizedName);
		namesByKind.set(record.kind, names);
	}
	if (state.nextOrganizationId <= previousId) {
		throw new Error("다음 정적 FAB 조직 ID는 모든 저장된 조직 ID보다 커야 합니다");
	}
}

async function validateOrganizationRelationships(
	state: StaticFabOrganizationState,
	consumeOperation: () => Promise<void>,
): Promise<void> {
	const recordsById = new Map<number, StaticFabOrganizationRecord>();
	const childrenByParentId = new Map<number, number[]>();
	const remainingParentsById = new Map<number, number>();
	const ready: number[] = [];
	for (const record of state.records) {
		recordsById.set(record.id, record);
		await consumeOperation();
	}
	for (const record of state.records) {
		await consumeOperation();
		const parentIds = staticFabOrganizationParentIds(record);
		remainingParentsById.set(record.id, parentIds.length);
		if (parentIds.length === 0) ready.push(record.id);
		let previous = 0;
		for (const parentId of parentIds) {
			await consumeOperation();
			if (!isPositiveInt32(parentId) || parentId <= previous) {
				throw new Error(
					`조직 ${record.id}: 부모 조직 ID는 중복 없는 양의 정수 오름차순이어야 합니다`,
				);
			}
			previous = parentId;
			if (parentId === record.id) {
				throw new Error(`조직 ${record.id}: 조직은 자기 자신을 부모로 지정할 수 없습니다`);
			}
			if (!recordsById.has(parentId)) {
				throw new Error(`조직 ${record.id}의 부모 조직 ${parentId}을 찾을 수 없습니다`);
			}
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record.id);
			else childrenByParentId.set(parentId, [record.id]);
		}
	}
	let visited = 0;
	for (let offset = 0; offset < ready.length; offset++) {
		visited++;
		const parentId = ready[offset] as number;
		await consumeOperation();
		for (const childId of childrenByParentId.get(parentId) ?? []) {
			await consumeOperation();
			const remaining = (remainingParentsById.get(childId) ?? 0) - 1;
			remainingParentsById.set(childId, remaining);
			if (remaining === 0) ready.push(childId);
		}
	}
	if (visited !== state.records.length) {
		let cycleId: number | undefined;
		for (const record of state.records) {
			await consumeOperation();
			if ((remainingParentsById.get(record.id) ?? 0) > 0) {
				cycleId = record.id;
				break;
			}
		}
		throw new Error(`조직 관계에 순환이 있습니다${cycleId ? ` · 조직 ${cycleId}` : ""}`);
	}
}

async function validateOrganizationRecord(
	map: TileMap,
	record: StaticFabOrganizationRecord,
	groupsById: ReadonlyMap<number, EquipmentGroupRecord>,
	portsById: ReadonlyMap<number, PortEquipmentState["ports"][number]>,
	moduleIndex: OrganizationModuleIndex,
	ownershipByKind: Map<StaticFabOrganizationKind, Map<string, number>>,
	consumeOperation: () => Promise<void>,
): Promise<void> {
	const { railEdges, advancedSwitchIds, equipmentGroupIds } = record.membership;
	const membershipFingerprint = createStaticFabOrganizationMembershipFingerprintAccumulator();
	const targetEdges = new Set<string>();
	const targetSwitches = new Set<number>();
	const touchedModuleIndices = new Set<number>();
	let previousEdge: DirectedRailEdge | null = null;
	let edgeIndex = 0;
	for (const edge of railEdges) {
		await consumeOperation();
		membershipFingerprint.addRailEdge(edgeIndex, edge);
		edgeIndex++;
		assertFrozenValue(edge, `조직 ${record.id} 레일 edge`);
		assertFrozenValue(edge.from, `조직 ${record.id} 레일 시작점`);
		assertFrozenValue(edge.to, `조직 ${record.id} 레일 끝점`);
		const edgeShapeError = directedRailEdgeShapeError(edge, previousEdge);
		if (edgeShapeError) throw new Error(`조직 ${record.id}: ${edgeShapeError}`);
		previousEdge = edge;
		const edgeKey = staticFabOrganizationEdgeKey(edge);
		if (!directedRailEdgeExists(map, edge)) {
			throw new Error(`조직 ${record.id}의 레일 ${edgeKey}을 현재 맵에서 찾을 수 없습니다`);
		}
		claimMembership(ownershipByKind, record.kind, `rail:${edgeKey}`, record.id);
		targetEdges.add(edgeKey);
		for (const index of moduleIndex.moduleIndicesByEdge.get(edgeKey) ?? []) {
			touchedModuleIndices.add(index);
			await consumeOperation();
		}
	}

	let previousSwitchId = 0;
	let switchIndex = 0;
	for (const switchId of advancedSwitchIds) {
		await consumeOperation();
		membershipFingerprint.addAdvancedSwitchId(switchIndex, switchId);
		switchIndex++;
		if (!isPositiveInt32(switchId) || switchId <= previousSwitchId) {
			throw new Error(
				`조직 ${record.id}: 고급 스위치 ID는 중복 없는 양의 정수 오름차순이어야 합니다`,
			);
		}
		previousSwitchId = switchId;
		if (!map.getAdvancedSwitch(switchId)) {
			throw new Error(`조직 ${record.id}의 고급 스위치 ${switchId}을 현재 맵에서 찾을 수 없습니다`);
		}
		claimMembership(ownershipByKind, record.kind, `switch:${switchId}`, record.id);
		targetSwitches.add(switchId);
		for (const index of moduleIndex.moduleIndicesBySwitch.get(switchId) ?? []) {
			touchedModuleIndices.add(index);
			await consumeOperation();
		}
	}

	let previousGroupId = 0;
	let groupIndex = 0;
	for (const groupId of equipmentGroupIds) {
		await consumeOperation();
		membershipFingerprint.addEquipmentGroupId(groupIndex, groupId);
		groupIndex++;
		if (!isPositiveInt32(groupId) || groupId <= previousGroupId) {
			throw new Error(
				`조직 ${record.id}: 장비 그룹 ID는 중복 없는 양의 정수 오름차순이어야 합니다`,
			);
		}
		previousGroupId = groupId;
		const group = groupsById.get(groupId);
		if (!group) throw new Error(`조직 ${record.id}의 장비 그룹 ${groupId}을 찾을 수 없습니다`);
		claimMembership(ownershipByKind, record.kind, `equipment:${groupId}`, record.id);
		for (const portId of group.portIds) {
			await consumeOperation();
			const port = portsById.get(portId);
			if (!port) {
				throw new Error(`조직 ${record.id}의 장비 그룹 ${groupId}에 PORT-${portId}가 없습니다`);
			}
			if (!membershipSupportsPortRoute(port.route, targetEdges, targetSwitches)) {
				throw new Error(
					`조직 ${record.id}의 PORT-${portId} 경로가 조직 레일 멤버십에 완전히 포함되지 않습니다`,
				);
			}
		}
	}

	if (railEdges.length + advancedSwitchIds.length + equipmentGroupIds.length === 0) {
		throw new Error(`조직 ${record.id}: 하나 이상의 레일, 스위치 또는 장비 그룹을 포함해야 합니다`);
	}
	await validateExactModuleUnion(
		record,
		targetEdges,
		targetSwitches,
		touchedModuleIndices,
		moduleIndex.modules,
		consumeOperation,
	);
	primeValidatedStaticFabOrganizationMembershipFingerprint(
		record.membership,
		membershipFingerprint.finish(),
	);
}

async function validateExactModuleUnion(
	record: StaticFabOrganizationRecord,
	targetEdges: ReadonlySet<string>,
	targetSwitches: ReadonlySet<number>,
	touchedModuleIndices: ReadonlySet<number>,
	modules: readonly RailModuleOwnership[],
	consumeOperation: () => Promise<void>,
): Promise<void> {
	const resolvedEdges = new Set<string>();
	const resolvedSwitches = new Set<number>();
	for (const moduleIndex of touchedModuleIndices) {
		await consumeOperation();
		const module = modules[moduleIndex];
		if (!module) {
			throw new Error(`조직 ${record.id}의 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`);
		}
		for (const edge of module.eraseEdges) {
			await consumeOperation();
			const edgeKey = staticFabOrganizationEdgeKey(edge);
			if (!targetEdges.has(edgeKey)) {
				throw new Error(
					`조직 ${record.id}의 멤버십은 현재 레일 모듈 ${module.key} 전체를 포함해야 합니다`,
				);
			}
			resolvedEdges.add(edgeKey);
		}
		if (module.advancedSwitchId !== null) {
			await consumeOperation();
			if (!targetSwitches.has(module.advancedSwitchId)) {
				throw new Error(
					`조직 ${record.id}의 멤버십은 현재 레일 모듈 ${module.key} 전체를 포함해야 합니다`,
				);
			}
			resolvedSwitches.add(module.advancedSwitchId);
		}
	}
	if (
		!(await setsEqualCooperatively(targetEdges, resolvedEdges, consumeOperation)) ||
		!(await setsEqualCooperatively(targetSwitches, resolvedSwitches, consumeOperation))
	) {
		throw new Error(`조직 ${record.id}의 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`);
	}
}

function organizationRecordHeaderError(record: StaticFabOrganizationRecord): string | null {
	if (!isPositiveInt32(record.id)) return "ID는 양의 32-bit 정수여야 합니다";
	if (!STATIC_FAB_ORGANIZATION_KINDS.includes(record.kind)) return "알 수 없는 조직 종류입니다";
	if (
		record.name.length === 0 ||
		record.name.length > 120 ||
		record.name !== record.name.trim() ||
		hasAsciiControlCharacter(record.name)
	) {
		return "이름은 제어문자 없는 1-120자의 trim된 문자열이어야 합니다";
	}
	const parentIds = staticFabOrganizationParentIds(record);
	if (parentIds.length > STATIC_FAB_ORGANIZATION_MAX_PARENTS) {
		return `부모 조직은 최대 ${STATIC_FAB_ORGANIZATION_MAX_PARENTS}개까지 지정할 수 있습니다`;
	}
	const properties = staticFabOrganizationProperties(record);
	if (
		properties.description.length > STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH ||
		properties.description !== properties.description.trim() ||
		hasDisallowedTextControlCharacter(properties.description)
	) {
		return `설명은 허용되지 않은 제어문자 없이 trim된 ${STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH}자 이하여야 합니다`;
	}
	if (!STATIC_FAB_ORGANIZATION_COLORS.includes(properties.color)) {
		return "알 수 없는 조직 색상입니다";
	}
	return null;
}

function directedRailEdgeShapeError(
	edge: DirectedRailEdge,
	previousEdge: DirectedRailEdge | null,
): string | null {
	if (
		!isInt32(edge.from.x) ||
		!isInt32(edge.from.y) ||
		!isInt32(edge.to.x) ||
		!isInt32(edge.to.y)
	) {
		return "레일 edge 좌표는 signed 32-bit 정수여야 합니다";
	}
	if (directionBetween(edge.from, edge.to) === null)
		return "레일 edge는 인접한 직교 셀이어야 합니다";
	if (previousEdge && compareDirectedRailEdges(previousEdge, edge) >= 0) {
		return "레일 edge는 중복 없이 canonical 순서로 저장되어야 합니다";
	}
	return null;
}

function directedRailEdgeExists(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) return false;
	const source = decodeRailCell(map.getEncoded(edge.from.x, edge.from.y));
	const target = decodeRailCell(map.getEncoded(edge.to.x, edge.to.y));
	return (
		(source.outgoing & direction) !== 0 && (target.incoming & oppositeDirection(direction)) !== 0
	);
}

function membershipSupportsPortRoute(
	route: PortEquipmentState["ports"][number]["route"],
	selectedEdges: ReadonlySet<string>,
	selectedSwitches: ReadonlySet<number>,
): boolean {
	if (route.kind === "ADVANCED_SWITCH_SEGMENT") return selectedSwitches.has(route.switchId);
	const cell = { x: route.x, y: route.z };
	if (route.from !== 0) {
		const source = moveCell(cell, route.from as Direction);
		if (!selectedEdges.has(staticFabOrganizationEdgeKey({ from: source, to: cell }))) return false;
	}
	if (route.to !== 0) {
		const target = moveCell(cell, route.to as Direction);
		if (!selectedEdges.has(staticFabOrganizationEdgeKey({ from: cell, to: target }))) return false;
	}
	return true;
}

function claimMembership(
	ownershipByKind: Map<StaticFabOrganizationKind, Map<string, number>>,
	kind: StaticFabOrganizationKind,
	key: string,
	recordId: number,
): void {
	const owners = ownershipByKind.get(kind) ?? new Map<string, number>();
	const owner = owners.get(key);
	if (owner !== undefined) {
		throw new Error(`${kind} 조직 ${owner}과 ${recordId}이 ${key} 멤버십을 함께 소유합니다`);
	}
	owners.set(key, recordId);
	ownershipByKind.set(kind, owners);
}

function appendModuleIndex<Key>(target: Map<Key, number[]>, key: Key, moduleIndex: number): void {
	const indices = target.get(key);
	if (indices) indices.push(moduleIndex);
	else target.set(key, [moduleIndex]);
}

async function setsEqualCooperatively<Value>(
	left: ReadonlySet<Value>,
	right: ReadonlySet<Value>,
	consumeOperation: () => Promise<void>,
): Promise<boolean> {
	if (left.size !== right.size) return false;
	for (const value of left) {
		await consumeOperation();
		if (!right.has(value)) return false;
	}
	return true;
}

function assertStableMapRevision(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	expectedRevision: number,
	expectedMutationGeneration: number,
): void {
	if (
		map.getRevision() !== expectedRevision ||
		map.getMutationGeneration() !== expectedMutationGeneration ||
		ownership.revision !== expectedRevision ||
		!railModuleOwnershipIndexMatchesMap(ownership, map)
	) {
		throw new Error("정적 FAB 조직 활성화 중 레일 revision이 변경되었습니다");
	}
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

function isPositiveInt32(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function assertFrozenActivationRoot(
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
): void {
	assertFrozenValue(portEquipment, "port/equipment 상태");
	assertFrozenValue(portEquipment.ports, "port 목록");
	assertFrozenValue(portEquipment.equipmentGroups, "장비 그룹 목록");
	assertFrozenValue(state, "정적 FAB 조직 상태");
	assertFrozenValue(state.records, "정적 FAB 조직 목록");
}

function assertFrozenValue(value: object, label: string): void {
	if (!Object.isFrozen(value)) {
		throw new Error(`${label}은 활성화 전에 immutable 상태로 고정되어야 합니다`);
	}
}
