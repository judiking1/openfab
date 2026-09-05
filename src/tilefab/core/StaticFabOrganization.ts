import { completeCooperativeSteps } from "./CooperativeTask";
import type { PortEquipmentState } from "./EquipmentGroup";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import { type Direction, directionBetween, moveCell, oppositeDirection } from "./railShape";
import { decodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_ORGANIZATION_KINDS = ["AREA", "BAY", "AISLE", "PROCESS_FAMILY"] as const;

export const STATIC_FAB_ORGANIZATION_COLORS = [
	"TEAL",
	"CYAN",
	"BLUE",
	"AMBER",
	"VIOLET",
	"ROSE",
	"LIME",
	"GRAY",
] as const;

export const DEFAULT_STATIC_FAB_ORGANIZATION_COLOR = "TEAL" as const;
export const STATIC_FAB_ORGANIZATION_MAX_PARENTS = 32;
export const STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH = 500;
export const STATIC_FAB_ORGANIZATION_MAX_RECORDS = 100_000;
export const STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES = 5_000_000;

export type StaticFabOrganizationKind = (typeof STATIC_FAB_ORGANIZATION_KINDS)[number];
export type StaticFabOrganizationColor = (typeof STATIC_FAB_ORGANIZATION_COLORS)[number];
export type StaticFabOrganizationSemanticRole = "FAB" | "BAY_BANK" | "BAY" | "PROCESS_LOOP";

export interface StaticFabOrganizationProperties {
	readonly description: string;
	readonly color: StaticFabOrganizationColor;
}

export interface StaticFabOrganizationMembership {
	readonly railEdges: readonly DirectedRailEdge[];
	readonly advancedSwitchIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
}

export interface StaticFabOrganizationRecord {
	readonly id: number;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	/** Explicit user-authored organization DAG; inferred topology is never stored here. */
	readonly parentOrganizationIds?: readonly number[];
	readonly properties?: StaticFabOrganizationProperties;
	readonly membership: StaticFabOrganizationMembership;
}

export interface StaticFabOrganizationState {
	readonly nextOrganizationId: number;
	readonly records: readonly StaticFabOrganizationRecord[];
}

export interface StaticFabOrganizationRailValidationOptions {
	readonly ownership?: RailModuleOwnershipIndex;
	readonly maximumRecords?: number;
	readonly maximumMembershipReferences?: number;
}

/** Opaque provenance for plain immutable organization generations built by trusted boundaries. */
const canonicalStaticFabOrganizationStates = new WeakSet<object>();
const canonicalStaticFabOrganizationRecords = new WeakSet<object>();
const canonicalStaticFabOrganizationMemberships = new WeakSet<object>();

export function isCanonicalStaticFabOrganizationState(state: StaticFabOrganizationState): boolean {
	return canonicalStaticFabOrganizationStates.has(state);
}

export interface CanonicalStaticFabOrganizationRecordHeader {
	readonly id: number;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly description: string;
	readonly color: StaticFabOrganizationColor;
}

export interface CanonicalStaticFabOrganizationStateBuilder {
	addParentOrganizationId(id: number): void;
	addRailEdge(edge: DirectedRailEdge): void;
	addAdvancedSwitchId(id: number): void;
	addEquipmentGroupId(id: number): void;
	finishRecord(header: CanonicalStaticFabOrganizationRecordHeader): void;
	finish(): StaticFabOrganizationState;
}

/** Incremental canonical constructor used by the transferable organization hydrator. */
export function createCanonicalStaticFabOrganizationStateBuilder(
	nextOrganizationId: number,
): CanonicalStaticFabOrganizationStateBuilder {
	if (!isPositiveInt32(nextOrganizationId)) {
		throw new Error("다음 정적 FAB 조직 ID는 양의 32-bit 정수여야 합니다");
	}
	const records: StaticFabOrganizationRecord[] = [];
	const namesByKind = new Map<StaticFabOrganizationKind, Set<string>>();
	let parentOrganizationIds: number[] = [];
	let railEdges: DirectedRailEdge[] = [];
	let advancedSwitchIds: number[] = [];
	let equipmentGroupIds: number[] = [];
	let previousOrganizationId = 0;
	let previousParentId = 0;
	let previousRailEdge: DirectedRailEdge | null = null;
	let previousAdvancedSwitchId = 0;
	let previousEquipmentGroupId = 0;
	let pendingRecordData = false;
	let pendingMembershipCount = 0;
	let finished = false;
	const assertOpen = (): void => {
		if (finished) throw new Error("Canonical organization state builder is already finished.");
	};
	const addCanonicalId = (value: number, previous: number, label: string): number => {
		if (!isPositiveInt32(value) || value <= previous) {
			throw new Error(`${label} ID는 중복 없는 양의 정수 오름차순이어야 합니다`);
		}
		pendingRecordData = true;
		return value;
	};
	const resetPendingRecord = (): void => {
		parentOrganizationIds = [];
		railEdges = [];
		advancedSwitchIds = [];
		equipmentGroupIds = [];
		previousParentId = 0;
		previousRailEdge = null;
		previousAdvancedSwitchId = 0;
		previousEquipmentGroupId = 0;
		pendingRecordData = false;
		pendingMembershipCount = 0;
	};
	return Object.freeze({
		addParentOrganizationId(id: number): void {
			assertOpen();
			previousParentId = addCanonicalId(id, previousParentId, "부모 조직");
			if (parentOrganizationIds.length >= STATIC_FAB_ORGANIZATION_MAX_PARENTS) {
				throw new Error(
					`부모 조직은 최대 ${STATIC_FAB_ORGANIZATION_MAX_PARENTS}개까지 지정할 수 있습니다`,
				);
			}
			parentOrganizationIds.push(id);
		},
		addRailEdge(edge: DirectedRailEdge): void {
			assertOpen();
			const copied = copyDirectedRailEdge(edge);
			if (previousRailEdge !== null && compareDirectedRailEdges(previousRailEdge, copied) >= 0) {
				throw new Error("레일 edge는 중복 없이 canonical 순서로 저장되어야 합니다");
			}
			railEdges.push(copied);
			previousRailEdge = copied;
			pendingRecordData = true;
			pendingMembershipCount++;
		},
		addAdvancedSwitchId(id: number): void {
			assertOpen();
			previousAdvancedSwitchId = addCanonicalId(id, previousAdvancedSwitchId, "고급 스위치");
			advancedSwitchIds.push(id);
			pendingMembershipCount++;
		},
		addEquipmentGroupId(id: number): void {
			assertOpen();
			previousEquipmentGroupId = addCanonicalId(id, previousEquipmentGroupId, "장비 그룹");
			equipmentGroupIds.push(id);
			pendingMembershipCount++;
		},
		finishRecord(header: CanonicalStaticFabOrganizationRecordHeader): void {
			assertOpen();
			const id = header.id;
			const kind = header.kind;
			const name = header.name;
			const description = header.description;
			const color = header.color;
			if (id <= previousOrganizationId) {
				throw new Error("정적 FAB 조직은 ID 오름차순으로 한 번씩 저장되어야 합니다");
			}
			if (pendingMembershipCount === 0) {
				throw new Error(`조직 ${id}: 하나 이상의 레일, 스위치 또는 장비 그룹을 포함해야 합니다`);
			}
			const membership = brandCanonicalStaticFabOrganizationMembership(
				Object.freeze({
					railEdges: Object.freeze(railEdges),
					advancedSwitchIds: Object.freeze(advancedSwitchIds),
					equipmentGroupIds: Object.freeze(equipmentGroupIds),
				}),
			);
			const record = Object.freeze({
				id,
				kind,
				name,
				parentOrganizationIds: Object.freeze(parentOrganizationIds),
				properties: Object.freeze({
					description,
					color,
				}),
				membership,
			}) satisfies StaticFabOrganizationRecord;
			const headerError = staticFabOrganizationRecordHeaderError(record);
			if (headerError) throw new Error(`조직 ${record.id}: ${headerError}`);
			const names = namesByKind.get(record.kind) ?? new Set<string>();
			const normalizedName = normalizeStaticFabOrganizationName(record.name);
			if (names.has(normalizedName)) {
				throw new Error(`${record.kind} 조직 이름 '${record.name}'이 중복되었습니다`);
			}
			names.add(normalizedName);
			namesByKind.set(record.kind, names);
			records.push(brandCanonicalStaticFabOrganizationRecord(record));
			previousOrganizationId = record.id;
			resetPendingRecord();
		},
		finish(): StaticFabOrganizationState {
			assertOpen();
			finished = true;
			if (pendingRecordData) {
				throw new Error("Canonical organization state has an unfinished record.");
			}
			if (nextOrganizationId <= previousOrganizationId) {
				throw new Error("다음 정적 FAB 조직 ID는 모든 저장된 조직 ID보다 커야 합니다");
			}
			return brandCanonicalStaticFabOrganizationState(
				Object.freeze({
					nextOrganizationId,
					records: Object.freeze(records),
				}),
			);
		},
	});
}

export interface StaticFabOrganizationMutation {
	readonly id: number;
	readonly before: StaticFabOrganizationRecord | null;
	readonly after: StaticFabOrganizationRecord | null;
}

export function emptyStaticFabOrganizationState(): StaticFabOrganizationState {
	return brandCanonicalStaticFabOrganizationState(
		Object.freeze({ nextOrganizationId: 1, records: Object.freeze([]) }),
	);
}

export function copyStaticFabOrganizationMembership(
	membership: StaticFabOrganizationMembership,
): StaticFabOrganizationMembership {
	const sourceRailEdges = membership.railEdges;
	const sourceAdvancedSwitchIds = membership.advancedSwitchIds;
	const sourceEquipmentGroupIds = membership.equipmentGroupIds;
	if (
		!Array.isArray(sourceRailEdges) ||
		!Array.isArray(sourceAdvancedSwitchIds) ||
		!Array.isArray(sourceEquipmentGroupIds)
	) {
		throw new Error("정적 FAB 조직 멤버십 목록은 배열이어야 합니다");
	}
	const railEdges = new Array<DirectedRailEdge>(sourceRailEdges.length);
	for (let index = 0; index < railEdges.length; index++) {
		railEdges[index] = copyDirectedRailEdge(sourceRailEdges[index] as DirectedRailEdge);
	}
	if (!canonicalDirectedRailEdgeArray(railEdges)) {
		throw new Error("레일 edge는 중복 없이 canonical 순서로 저장되어야 합니다");
	}
	const advancedSwitchIds = new Array<number>(sourceAdvancedSwitchIds.length);
	for (let index = 0; index < advancedSwitchIds.length; index++) {
		advancedSwitchIds[index] = sourceAdvancedSwitchIds[index] as number;
	}
	if (!canonicalPositiveIdArray(advancedSwitchIds)) {
		throw new Error("고급 스위치 ID는 중복 없는 양의 정수 오름차순이어야 합니다");
	}
	const equipmentGroupIds = new Array<number>(sourceEquipmentGroupIds.length);
	for (let index = 0; index < equipmentGroupIds.length; index++) {
		equipmentGroupIds[index] = sourceEquipmentGroupIds[index] as number;
	}
	if (!canonicalPositiveIdArray(equipmentGroupIds)) {
		throw new Error("장비 그룹 ID는 중복 없는 양의 정수 오름차순이어야 합니다");
	}
	return brandCanonicalStaticFabOrganizationMembership(
		Object.freeze({
			railEdges: Object.freeze(railEdges),
			advancedSwitchIds: Object.freeze(advancedSwitchIds),
			equipmentGroupIds: Object.freeze(equipmentGroupIds),
		}),
	);
}

export function copyStaticFabOrganizationRecord(
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationRecord {
	const id = record.id;
	const kind = record.kind;
	const name = record.name;
	const sourceParentIds = record.parentOrganizationIds ?? EMPTY_STATIC_FAB_ORGANIZATION_PARENT_IDS;
	const sourceProperties = record.properties ?? DEFAULT_STATIC_FAB_ORGANIZATION_PROPERTIES;
	const sourceMembership = record.membership;
	if (!Array.isArray(sourceParentIds)) {
		throw new Error(`조직 ${id}: 부모 조직 목록은 배열이어야 합니다`);
	}
	const parentOrganizationIds = new Array<number>(sourceParentIds.length);
	for (let index = 0; index < parentOrganizationIds.length; index++) {
		parentOrganizationIds[index] = sourceParentIds[index] as number;
	}
	const copy = Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze(parentOrganizationIds),
		properties: copyStaticFabOrganizationProperties(sourceProperties),
		membership: copyStaticFabOrganizationMembership(sourceMembership),
	}) satisfies StaticFabOrganizationRecord;
	const error = staticFabOrganizationRecordShapeError(copy);
	if (error) throw new Error(`조직 ${id}: ${error}`);
	return brandCanonicalStaticFabOrganizationRecord(copy);
}

const EMPTY_STATIC_FAB_ORGANIZATION_PARENT_IDS = Object.freeze([]) as readonly number[];
const DEFAULT_STATIC_FAB_ORGANIZATION_PROPERTIES = Object.freeze({
	description: "",
	color: DEFAULT_STATIC_FAB_ORGANIZATION_COLOR,
}) satisfies StaticFabOrganizationProperties;

export function staticFabOrganizationParentIds(
	record: StaticFabOrganizationRecord,
): readonly number[] {
	return record.parentOrganizationIds ?? EMPTY_STATIC_FAB_ORGANIZATION_PARENT_IDS;
}

export function staticFabOrganizationProperties(
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationProperties {
	return record.properties ?? DEFAULT_STATIC_FAB_ORGANIZATION_PROPERTIES;
}

/**
 * Derive the public FAB hierarchy from the persisted organization DAG. The generic organization
 * kinds remain the stable project format; semantic roles are deliberately not inferred from names.
 */
export function deriveStaticFabOrganizationSemanticRoles(
	state: StaticFabOrganizationState,
): ReadonlyMap<number, StaticFabOrganizationSemanticRole> {
	return completeCooperativeSteps(deriveStaticFabOrganizationSemanticRoleSteps(state));
}

/** Same ordered semantic derivation, with a checkpoint opportunity for every record/child. */
export function* deriveStaticFabOrganizationSemanticRoleSteps(
	state: StaticFabOrganizationState,
): Generator<void, ReadonlyMap<number, StaticFabOrganizationSemanticRole>> {
	const recordsById = new Map<number, StaticFabOrganizationRecord>();
	for (const record of state.records) {
		yield;
		recordsById.set(record.id, record);
	}
	const childrenByParentId = new Map<number, StaticFabOrganizationRecord[]>();
	for (const record of state.records) {
		yield;
		for (const parentId of staticFabOrganizationParentIds(record)) {
			yield;
			if (!recordsById.has(parentId)) continue;
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record);
			else childrenByParentId.set(parentId, [record]);
		}
	}
	const roles = new Map<number, StaticFabOrganizationSemanticRole>();
	for (const record of state.records) {
		yield;
		if (record.kind !== "AISLE") continue;
		for (const parentId of staticFabOrganizationParentIds(record)) {
			yield;
			if (recordsById.get(parentId)?.kind === "BAY") {
				roles.set(record.id, "PROCESS_LOOP");
				break;
			}
		}
	}
	for (const [kind, childRole, role] of [
		["BAY", "PROCESS_LOOP", "BAY"],
		["AREA", "BAY", "BAY_BANK"],
		["AREA", "BAY_BANK", "FAB"],
	] as const) {
		for (const record of state.records) {
			yield;
			if (record.kind !== kind) continue;
			for (const child of childrenByParentId.get(record.id) ?? []) {
				yield;
				if (roles.get(child.id) === childRole) {
					roles.set(record.id, role);
					break;
				}
			}
		}
	}
	return roles;
}

export function copyStaticFabOrganizationProperties(
	properties: StaticFabOrganizationProperties,
): StaticFabOrganizationProperties {
	const description = properties.description;
	const color = properties.color;
	return Object.freeze({ description, color });
}

export interface StaticFabOrganizationCoverage {
	readonly direct: StaticFabOrganizationMembership;
	readonly inherited: StaticFabOrganizationMembership;
	readonly effective: StaticFabOrganizationMembership;
	readonly descendantOrganizationIds: readonly number[];
}

/** Resolve only the relationship graph; this never walks or copies rail membership. */
export function resolveStaticFabOrganizationDescendantIds(
	state: StaticFabOrganizationState,
	organizationId: number,
): readonly number[] | null {
	if (!state.records.some((record) => record.id === organizationId)) return null;
	const childrenByParentId = new Map<number, number[]>();
	for (const record of state.records) {
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record.id);
			else childrenByParentId.set(parentId, [record.id]);
		}
	}
	const descendantIds = new Set<number>();
	const pending = [...(childrenByParentId.get(organizationId) ?? [])];
	for (let offset = 0; offset < pending.length; offset++) {
		const id = pending[offset] as number;
		if (descendantIds.has(id)) continue;
		descendantIds.add(id);
		pending.push(...(childrenByParentId.get(id) ?? []));
	}
	return Object.freeze([...descendantIds].sort((left, right) => left - right));
}

/** Derive direct/inherited/effective coverage from the persisted DAG without storing bounds. */
export function resolveStaticFabOrganizationCoverage(
	state: StaticFabOrganizationState,
	organizationId: number,
): StaticFabOrganizationCoverage | null {
	const root = state.records.find((record) => record.id === organizationId);
	if (!root) return null;
	const recordsById = new Map(state.records.map((record) => [record.id, record]));
	const descendantOrganizationIds = resolveStaticFabOrganizationDescendantIds(state, root.id);
	if (!descendantOrganizationIds) return null;
	const inheritedRecords = descendantOrganizationIds
		.map((id) => recordsById.get(id))
		.filter((record): record is StaticFabOrganizationRecord => record !== undefined);
	const inherited = mergeStaticFabOrganizationMemberships(
		inheritedRecords.map((record) => record.membership),
	);
	const effective = mergeStaticFabOrganizationMemberships([root.membership, inherited]);
	return Object.freeze({
		direct: root.membership,
		inherited,
		effective,
		descendantOrganizationIds,
	});
}

function mergeStaticFabOrganizationMemberships(
	memberships: readonly StaticFabOrganizationMembership[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	const equipmentGroupIds = new Set<number>();
	for (const membership of memberships) {
		for (const edge of membership.railEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		for (const id of membership.advancedSwitchIds) switchIds.add(id);
		for (const id of membership.equipmentGroupIds) equipmentGroupIds.add(id);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((a, b) => a - b)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((a, b) => a - b)),
	});
}

export function copyStaticFabOrganizationState(
	state: StaticFabOrganizationState,
): StaticFabOrganizationState {
	const nextOrganizationId = state.nextOrganizationId;
	const sourceRecords = state.records;
	if (!Array.isArray(sourceRecords)) {
		throw new Error("정적 FAB 조직 레코드 목록은 배열이어야 합니다");
	}
	const records = new Array<StaticFabOrganizationRecord>(sourceRecords.length);
	for (let index = 0; index < records.length; index++) {
		records[index] = copyStaticFabOrganizationRecord(
			sourceRecords[index] as StaticFabOrganizationRecord,
		);
	}
	const copy = Object.freeze({
		nextOrganizationId,
		records: Object.freeze(records),
	});
	const error = staticFabOrganizationStateShapeError(copy);
	if (error) throw new Error(error);
	return brandCanonicalStaticFabOrganizationState(copy);
}

export function normalizeStaticFabOrganizationName(name: string): string {
	return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function staticFabOrganizationRecordEquals(
	left: StaticFabOrganizationRecord | null | undefined,
	right: StaticFabOrganizationRecord | null | undefined,
): boolean {
	if (!left || !right) return left == null && right == null;
	if (left === right) return true;
	return (
		left.id === right.id &&
		left.kind === right.kind &&
		left.name === right.name &&
		numberArrayEquals(
			staticFabOrganizationParentIds(left),
			staticFabOrganizationParentIds(right),
		) &&
		staticFabOrganizationProperties(left).description ===
			staticFabOrganizationProperties(right).description &&
		staticFabOrganizationProperties(left).color === staticFabOrganizationProperties(right).color &&
		left.membership.railEdges.length === right.membership.railEdges.length &&
		left.membership.railEdges.every((edge, index) =>
			directedRailEdgeEquals(edge, right.membership.railEdges[index]),
		) &&
		numberArrayEquals(left.membership.advancedSwitchIds, right.membership.advancedSwitchIds) &&
		numberArrayEquals(left.membership.equipmentGroupIds, right.membership.equipmentGroupIds)
	);
}

export function staticFabOrganizationStateShapeError(
	state: StaticFabOrganizationState,
): string | null {
	if (!isPositiveInt32(state.nextOrganizationId)) {
		return "다음 정적 FAB 조직 ID는 양의 32-bit 정수여야 합니다";
	}
	let previousId = 0;
	const namesByKind = new Map<StaticFabOrganizationKind, Set<string>>();
	for (const record of state.records) {
		const error = staticFabOrganizationRecordShapeError(record);
		if (error) return `조직 ${record.id}: ${error}`;
		if (record.id <= previousId) return "정적 FAB 조직은 ID 오름차순으로 한 번씩 저장되어야 합니다";
		previousId = record.id;
		const names = namesByKind.get(record.kind) ?? new Set<string>();
		const normalizedName = normalizeStaticFabOrganizationName(record.name);
		if (names.has(normalizedName)) {
			return `${record.kind} 조직 이름 '${record.name}'이 중복되었습니다`;
		}
		names.add(normalizedName);
		namesByKind.set(record.kind, names);
	}
	if (state.nextOrganizationId <= previousId) {
		return "다음 정적 FAB 조직 ID는 모든 저장된 조직 ID보다 커야 합니다";
	}
	const relationshipError = staticFabOrganizationRelationshipError(state);
	if (relationshipError) return relationshipError;
	return null;
}

/** Bounded preflight shared by synchronous Rail validation and cooperative relationship activation. */
export function* staticFabOrganizationRailStateBudgetSteps(
	state: StaticFabOrganizationState,
	options: StaticFabOrganizationRailValidationOptions = {},
): Generator<void, string | null> {
	const maximumRecords = options.maximumRecords ?? STATIC_FAB_ORGANIZATION_MAX_RECORDS;
	const maximumMembershipReferences =
		options.maximumMembershipReferences ?? STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES;
	if (
		!Number.isSafeInteger(maximumRecords) ||
		maximumRecords <= 0 ||
		maximumRecords > STATIC_FAB_ORGANIZATION_MAX_RECORDS ||
		!Number.isSafeInteger(maximumMembershipReferences) ||
		maximumMembershipReferences <= 0 ||
		maximumMembershipReferences > STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES
	) {
		return "정적 FAB 조직 Rail 검증 예산이 유효하지 않습니다";
	}
	if (!state || typeof state !== "object" || !Array.isArray(state.records)) {
		return "정적 FAB 조직 레코드 목록은 배열이어야 합니다";
	}
	if (state.records.length > maximumRecords) {
		return `정적 FAB 조직은 최대 ${maximumRecords}개까지 검증할 수 있습니다`;
	}
	let membershipReferenceCount = 0;
	for (let index = 0; index < state.records.length; index++) {
		yield;
		const record = state.records[index];
		const membership = record?.membership;
		if (
			!membership ||
			!Array.isArray(membership.railEdges) ||
			!Array.isArray(membership.advancedSwitchIds) ||
			!Array.isArray(membership.equipmentGroupIds)
		) {
			return `조직 ${record?.id ?? index + 1}: 멤버십 목록이 유효하지 않습니다`;
		}
		const recordReferenceCount =
			membership.railEdges.length +
			membership.advancedSwitchIds.length +
			membership.equipmentGroupIds.length;
		if (
			!Number.isSafeInteger(recordReferenceCount) ||
			recordReferenceCount > maximumMembershipReferences - membershipReferenceCount
		) {
			return `정적 FAB 조직 멤버십 참조는 최대 ${maximumMembershipReferences}개까지 검증할 수 있습니다`;
		}
		membershipReferenceCount += recordReferenceCount;
	}
	return null;
}

/**
 * Validate the current Rail-facing portion of organization truth without coupling callers to Port
 * or equipment state. Relationship identity uses this gate before trusting direct-owner evidence.
 */
export function staticFabOrganizationRailStateError(
	map: TileMap,
	state: StaticFabOrganizationState,
	options: StaticFabOrganizationRailValidationOptions = {},
): string | null {
	const budgetError = completeCooperativeSteps(
		staticFabOrganizationRailStateBudgetSteps(state, options),
	);
	if (budgetError) return budgetError;
	const shapeError = staticFabOrganizationStateShapeError(state);
	if (shapeError) return shapeError;
	if (options.ownership && !railModuleOwnershipIndexMatchesMap(options.ownership, map)) {
		return "정적 FAB 조직 Rail module 소유권 인덱스가 현재 맵 generation과 일치하지 않습니다";
	}
	const ownership =
		state.records.length > 0 ? organizationOwnershipIndex(map, options.ownership) : null;
	for (const record of state.records) {
		for (const edge of record.membership.railEdges) {
			if (!directedRailEdgeExists(map, edge)) {
				return `조직 ${record.id}의 레일 ${staticFabOrganizationEdgeKey(edge)}을 현재 맵에서 찾을 수 없습니다`;
			}
		}
		for (const switchId of record.membership.advancedSwitchIds) {
			if (!map.getAdvancedSwitch(switchId)) {
				return `조직 ${record.id}의 고급 스위치 ${switchId}을 현재 맵에서 찾을 수 없습니다`;
			}
		}
		const ownershipError = ownership
			? staticFabOrganizationOwnershipError(ownership, record)
			: null;
		if (ownershipError) return ownershipError;
	}
	const railOverlap = staticFabOrganizationSameKindRailOverlapError(state);
	if (railOverlap) return railOverlap;
	const switchOverlap = staticFabOrganizationSameKindSwitchOverlapError(state);
	if (switchOverlap) return switchOverlap;
	return null;
}

export function staticFabOrganizationStateError(
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
): string | null {
	const shapeError = staticFabOrganizationStateShapeError(state);
	if (shapeError) return shapeError;
	const groupsById = new Map(portEquipment.equipmentGroups.map((group) => [group.id, group]));
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	const ownershipByKind = new Map<StaticFabOrganizationKind, Map<string, number>>();
	const ownership = state.records.length > 0 ? organizationOwnershipIndex(map) : null;

	for (const record of state.records) {
		for (const edge of record.membership.railEdges) {
			if (!directedRailEdgeExists(map, edge)) {
				return `조직 ${record.id}의 레일 ${staticFabOrganizationEdgeKey(edge)}을 현재 맵에서 찾을 수 없습니다`;
			}
			const overlap = claimMembership(
				ownershipByKind,
				record.kind,
				`rail:${staticFabOrganizationEdgeKey(edge)}`,
				record.id,
			);
			if (overlap) return overlap;
		}
		for (const switchId of record.membership.advancedSwitchIds) {
			if (!map.getAdvancedSwitch(switchId)) {
				return `조직 ${record.id}의 고급 스위치 ${switchId}을 현재 맵에서 찾을 수 없습니다`;
			}
			const overlap = claimMembership(
				ownershipByKind,
				record.kind,
				`switch:${switchId}`,
				record.id,
			);
			if (overlap) return overlap;
		}
		const selectedEdges = new Set(record.membership.railEdges.map(staticFabOrganizationEdgeKey));
		const selectedSwitches = new Set(record.membership.advancedSwitchIds);
		for (const groupId of record.membership.equipmentGroupIds) {
			const group = groupsById.get(groupId);
			if (!group) return `조직 ${record.id}의 장비 그룹 ${groupId}을 찾을 수 없습니다`;
			const overlap = claimMembership(
				ownershipByKind,
				record.kind,
				`equipment:${groupId}`,
				record.id,
			);
			if (overlap) return overlap;
			for (const portId of group.portIds) {
				const port = portsById.get(portId);
				if (!port) return `조직 ${record.id}의 장비 그룹 ${groupId}에 PORT-${portId}가 없습니다`;
				if (
					!staticFabOrganizationMembershipSupportsPortRoute(
						port.route,
						selectedEdges,
						selectedSwitches,
					)
				) {
					return `조직 ${record.id}의 PORT-${portId} 경로가 조직 레일 멤버십에 완전히 포함되지 않습니다`;
				}
			}
		}
		const ownershipError = ownership
			? staticFabOrganizationOwnershipError(ownership, record)
			: null;
		if (ownershipError) return ownershipError;
	}
	return null;
}

export function assertStaticFabOrganizationState(
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationState,
): void {
	const error = staticFabOrganizationStateError(map, portEquipment, state);
	if (error) throw new Error(error);
}

export function applyStaticFabOrganizationMutations(
	state: StaticFabOrganizationState,
	mutations: readonly StaticFabOrganizationMutation[],
	nextOrganizationId: number,
	reuseValidatedRecords = false,
): StaticFabOrganizationState {
	if (!isPositiveInt32(nextOrganizationId)) {
		throw new Error("다음 정적 FAB 조직 ID는 양의 32-bit 정수여야 합니다");
	}
	const records = new Map(state.records.map((record) => [record.id, record]));
	const touched = new Set<number>();
	for (const mutation of mutations) {
		if (!isPositiveInt32(mutation.id))
			throw new Error(`조직 변경 ID ${mutation.id}이 유효하지 않습니다`);
		if (touched.has(mutation.id))
			throw new Error(`조직 ${mutation.id}을 한 패치에서 두 번 변경했습니다`);
		touched.add(mutation.id);
		if (!mutation.before && !mutation.after) {
			throw new Error(`조직 ${mutation.id} 변경에 before와 after가 모두 없습니다`);
		}
		if (
			(mutation.before && mutation.before.id !== mutation.id) ||
			(mutation.after && mutation.after.id !== mutation.id)
		) {
			throw new Error(`조직 ${mutation.id} 변경의 레코드 ID가 일치하지 않습니다`);
		}
		const current = records.get(mutation.id);
		if (!staticFabOrganizationRecordEquals(current, mutation.before)) {
			throw new Error(`조직 ${mutation.id} 변경의 before 값이 현재 문서와 다릅니다`);
		}
		if (staticFabOrganizationRecordEquals(mutation.before, mutation.after)) {
			throw new Error(`조직 ${mutation.id} 변경은 no-op입니다`);
		}
		if (mutation.after) {
			const after = reuseValidatedRecords
				? retainValidatedStaticFabOrganizationRecord(mutation.after)
				: current &&
						mutation.before?.membership === current.membership &&
						mutation.after.membership === current.membership
					? copyStaticFabOrganizationMetadata(mutation.after, current.membership)
					: copyStaticFabOrganizationRecord(mutation.after);
			records.set(mutation.id, after);
		} else records.delete(mutation.id);
	}
	let expectedNextOrganizationId = state.nextOrganizationId;
	for (const mutation of mutations) {
		if (!mutation.before && mutation.after) {
			expectedNextOrganizationId = Math.max(expectedNextOrganizationId, mutation.id + 1);
		}
	}
	if (nextOrganizationId !== expectedNextOrganizationId) {
		throw new Error(
			`다음 정적 FAB 조직 ID는 ${expectedNextOrganizationId}이어야 하지만 ${nextOrganizationId}입니다`,
		);
	}
	const nextState = Object.freeze({
		nextOrganizationId,
		records: Object.freeze([...records.values()].sort((left, right) => left.id - right.id)),
	});
	const headerError = staticFabOrganizationStateHeaderError(nextState);
	if (headerError) throw new Error(headerError);
	return isCanonicalStaticFabOrganizationState(state)
		? brandCanonicalStaticFabOrganizationState(nextState)
		: nextState;
}

export function reverseStaticFabOrganizationMutations(
	mutations: readonly StaticFabOrganizationMutation[],
): readonly StaticFabOrganizationMutation[] {
	return Object.freeze(
		mutations.map((mutation) =>
			Object.freeze({
				id: mutation.id,
				before: mutation.after,
				after: mutation.before,
			}),
		),
	);
}

/** Replace metadata while retaining one already-validated immutable membership generation. */
export function renameStaticFabOrganizationRecord(
	record: StaticFabOrganizationRecord,
	name: string,
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationMetadata({ ...record, name }, record.membership);
}

export interface StaticFabOrganizationMetadataUpdate {
	readonly name?: string;
	readonly parentOrganizationIds?: readonly number[];
	readonly properties?: StaticFabOrganizationProperties;
}

/** Replace user-authored metadata while retaining one validated immutable membership generation. */
export function updateStaticFabOrganizationRecordMetadata(
	record: StaticFabOrganizationRecord,
	update: StaticFabOrganizationMetadataUpdate,
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationMetadata(
		{
			...record,
			name: update.name ?? record.name,
			parentOrganizationIds: update.parentOrganizationIds ?? staticFabOrganizationParentIds(record),
			properties: update.properties ?? staticFabOrganizationProperties(record),
		},
		record.membership,
	);
}

/** Replace one validated membership generation while retaining immutable identity and metadata. */
export function replaceStaticFabOrganizationRecordMembership(
	record: StaticFabOrganizationRecord,
	membership: StaticFabOrganizationMembership,
): StaticFabOrganizationRecord {
	const parentOrganizationIds = Object.freeze([...staticFabOrganizationParentIds(record)]);
	const properties = copyStaticFabOrganizationProperties(staticFabOrganizationProperties(record));
	const replaced = Object.freeze({
		id: record.id,
		kind: record.kind,
		name: record.name,
		parentOrganizationIds,
		properties,
		membership,
	});
	const error = staticFabOrganizationRecordShapeError(replaced);
	if (error) throw new Error(`조직 ${record.id}: ${error}`);
	return canonicalStaticFabOrganizationMemberships.has(membership)
		? brandCanonicalStaticFabOrganizationRecord(replaced)
		: replaced;
}

export function staticFabOrganizationEdgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`;
}

export function compareDirectedRailEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.x - right.from.x ||
		left.from.y - right.from.y ||
		left.to.x - right.to.x ||
		left.to.y - right.to.y
	);
}

function staticFabOrganizationRecordHeaderError(
	record: StaticFabOrganizationRecord,
): string | null {
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
	if (!canonicalPositiveIdArray(parentIds)) {
		return "부모 조직 ID는 중복 없는 양의 정수 오름차순이어야 합니다";
	}
	if (parentIds.includes(record.id)) return "조직은 자기 자신을 부모로 지정할 수 없습니다";
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
	const { railEdges, advancedSwitchIds, equipmentGroupIds } = record.membership;
	if (railEdges.length + advancedSwitchIds.length + equipmentGroupIds.length === 0) {
		return "하나 이상의 레일, 스위치 또는 장비 그룹을 포함해야 합니다";
	}
	return null;
}

function staticFabOrganizationRecordShapeError(record: StaticFabOrganizationRecord): string | null {
	const headerError = staticFabOrganizationRecordHeaderError(record);
	if (headerError) return headerError;
	const { railEdges, advancedSwitchIds, equipmentGroupIds } = record.membership;
	for (let index = 0; index < railEdges.length; index++) {
		const edge = railEdges[index] as DirectedRailEdge;
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
		if (
			index > 0 &&
			compareDirectedRailEdges(railEdges[index - 1] as DirectedRailEdge, edge) >= 0
		) {
			return "레일 edge는 중복 없이 canonical 순서로 저장되어야 합니다";
		}
	}
	if (!canonicalPositiveIdArray(advancedSwitchIds)) {
		return "고급 스위치 ID는 중복 없는 양의 정수 오름차순이어야 합니다";
	}
	if (!canonicalPositiveIdArray(equipmentGroupIds)) {
		return "장비 그룹 ID는 중복 없는 양의 정수 오름차순이어야 합니다";
	}
	return null;
}

function staticFabOrganizationStateHeaderError(state: StaticFabOrganizationState): string | null {
	if (!isPositiveInt32(state.nextOrganizationId)) {
		return "다음 정적 FAB 조직 ID는 양의 32-bit 정수여야 합니다";
	}
	let previousId = 0;
	const namesByKind = new Map<StaticFabOrganizationKind, Set<string>>();
	for (const record of state.records) {
		const error = staticFabOrganizationRecordHeaderError(record);
		if (error) return `조직 ${record.id}: ${error}`;
		if (record.id <= previousId) return "정적 FAB 조직은 ID 오름차순으로 한 번씩 저장되어야 합니다";
		previousId = record.id;
		const names = namesByKind.get(record.kind) ?? new Set<string>();
		const normalizedName = normalizeStaticFabOrganizationName(record.name);
		if (names.has(normalizedName)) {
			return `${record.kind} 조직 이름 '${record.name}'이 중복되었습니다`;
		}
		names.add(normalizedName);
		namesByKind.set(record.kind, names);
	}
	if (state.nextOrganizationId <= previousId) {
		return "다음 정적 FAB 조직 ID는 모든 저장된 조직 ID보다 커야 합니다";
	}
	return staticFabOrganizationRelationshipError(state);
}

function copyStaticFabOrganizationMetadata(
	record: StaticFabOrganizationRecord,
	membership: StaticFabOrganizationMembership,
): StaticFabOrganizationRecord {
	const copy = Object.freeze({
		id: record.id,
		kind: record.kind,
		name: record.name,
		parentOrganizationIds: Object.freeze([...staticFabOrganizationParentIds(record)]),
		properties: copyStaticFabOrganizationProperties(staticFabOrganizationProperties(record)),
		membership,
	});
	const error = staticFabOrganizationRecordHeaderError(copy);
	if (error) throw new Error(`조직 ${record.id}: ${error}`);
	return canonicalStaticFabOrganizationMemberships.has(membership)
		? brandCanonicalStaticFabOrganizationRecord(copy)
		: copy;
}

function retainValidatedStaticFabOrganizationRecord(
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationRecord {
	return canonicalStaticFabOrganizationRecords.has(record)
		? record
		: copyStaticFabOrganizationRecord(record);
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

export function staticFabOrganizationRelationshipError(
	state: StaticFabOrganizationState,
): string | null {
	const recordsById = new Map(state.records.map((record) => [record.id, record]));
	const childrenByParentId = new Map<number, number[]>();
	const remainingParentsById = new Map<number, number>();
	for (const record of state.records) {
		const parentIds = staticFabOrganizationParentIds(record);
		remainingParentsById.set(record.id, parentIds.length);
		for (const parentId of parentIds) {
			if (!recordsById.has(parentId)) {
				return `조직 ${record.id}의 부모 조직 ${parentId}을 찾을 수 없습니다`;
			}
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record.id);
			else childrenByParentId.set(parentId, [record.id]);
		}
	}

	const ready = state.records
		.filter((record) => (remainingParentsById.get(record.id) ?? 0) === 0)
		.map((record) => record.id);
	let visited = 0;
	for (let offset = 0; offset < ready.length; offset++) {
		const parentId = ready[offset] as number;
		visited++;
		for (const childId of childrenByParentId.get(parentId) ?? []) {
			const remaining = (remainingParentsById.get(childId) ?? 0) - 1;
			remainingParentsById.set(childId, remaining);
			if (remaining === 0) ready.push(childId);
		}
	}
	if (visited !== state.records.length) {
		const cycleId = state.records.find(
			(record) => (remainingParentsById.get(record.id) ?? 0) > 0,
		)?.id;
		return `조직 관계에 순환이 있습니다${cycleId ? ` · 조직 ${cycleId}` : ""}`;
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

export function staticFabOrganizationMembershipSupportsPortRoute(
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
): string | null {
	const owners = ownershipByKind.get(kind) ?? new Map<string, number>();
	const owner = owners.get(key);
	if (owner !== undefined) {
		return `${kind} 조직 ${owner}과 ${recordId}이 ${key} 멤버십을 함께 소유합니다`;
	}
	owners.set(key, recordId);
	ownershipByKind.set(kind, owners);
	return null;
}

function copyDirectedRailEdge(edge: DirectedRailEdge): DirectedRailEdge {
	const from = edge.from;
	const to = edge.to;
	const copy = Object.freeze({
		from: Object.freeze({ x: from.x, y: from.y }),
		to: Object.freeze({ x: to.x, y: to.y }),
	});
	if (!canonicalDirectedRailEdgeArray([copy])) {
		throw new Error("레일 edge는 인접한 직교 signed-int32 좌표여야 합니다");
	}
	return copy;
}

function brandCanonicalStaticFabOrganizationState(
	state: StaticFabOrganizationState,
): StaticFabOrganizationState {
	canonicalStaticFabOrganizationStates.add(state);
	return state;
}

function brandCanonicalStaticFabOrganizationRecord(
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationRecord {
	canonicalStaticFabOrganizationRecords.add(record);
	return record;
}

function brandCanonicalStaticFabOrganizationMembership(
	membership: StaticFabOrganizationMembership,
): StaticFabOrganizationMembership {
	canonicalStaticFabOrganizationMemberships.add(membership);
	return membership;
}

function directedRailEdgeEquals(
	left: DirectedRailEdge,
	right: DirectedRailEdge | undefined,
): boolean {
	return (
		right !== undefined &&
		left.from.x === right.from.x &&
		left.from.y === right.from.y &&
		left.to.x === right.to.x &&
		left.to.y === right.to.y
	);
}

function canonicalPositiveIdArray(values: readonly number[]): boolean {
	let previous = 0;
	for (const value of values) {
		if (!isPositiveInt32(value) || value <= previous) return false;
		previous = value;
	}
	return true;
}

function canonicalDirectedRailEdgeArray(edges: readonly DirectedRailEdge[]): boolean {
	for (let index = 0; index < edges.length; index++) {
		const edge = edges[index] as DirectedRailEdge;
		if (
			!isInt32(edge.from.x) ||
			!isInt32(edge.from.y) ||
			!isInt32(edge.to.x) ||
			!isInt32(edge.to.y) ||
			directionBetween(edge.from, edge.to) === null ||
			(index > 0 && compareDirectedRailEdges(edges[index - 1] as DirectedRailEdge, edge) >= 0)
		) {
			return false;
		}
	}
	return true;
}

interface OrganizationRailMembershipCursor {
	readonly recordId: number;
	readonly edges: readonly DirectedRailEdge[];
	index: number;
}

interface OrganizationSwitchMembershipCursor {
	readonly recordId: number;
	readonly switchIds: readonly number[];
	index: number;
}

function staticFabOrganizationSameKindRailOverlapError(
	state: StaticFabOrganizationState,
): string | null {
	for (const kind of STATIC_FAB_ORGANIZATION_KINDS) {
		const heap: OrganizationRailMembershipCursor[] = [];
		for (const record of state.records) {
			if (record.kind === kind && record.membership.railEdges.length > 0) {
				minHeapPush(
					heap,
					{ recordId: record.id, edges: record.membership.railEdges, index: 0 },
					compareOrganizationRailMembershipCursors,
				);
			}
		}
		let previous: { readonly recordId: number; readonly edge: DirectedRailEdge } | null = null;
		while (heap.length > 0) {
			const cursor = minHeapPop(heap, compareOrganizationRailMembershipCursors);
			if (!cursor) break;
			const edge = cursor.edges[cursor.index] as DirectedRailEdge;
			if (previous && compareDirectedRailEdges(previous.edge, edge) === 0) {
				return `${kind} 조직 ${previous.recordId}과 ${cursor.recordId}이 rail:${staticFabOrganizationEdgeKey(edge)} 멤버십을 함께 소유합니다`;
			}
			previous = { recordId: cursor.recordId, edge };
			cursor.index++;
			if (cursor.index < cursor.edges.length) {
				minHeapPush(heap, cursor, compareOrganizationRailMembershipCursors);
			}
		}
	}
	return null;
}

function staticFabOrganizationSameKindSwitchOverlapError(
	state: StaticFabOrganizationState,
): string | null {
	for (const kind of STATIC_FAB_ORGANIZATION_KINDS) {
		const heap: OrganizationSwitchMembershipCursor[] = [];
		for (const record of state.records) {
			if (record.kind === kind && record.membership.advancedSwitchIds.length > 0) {
				minHeapPush(
					heap,
					{
						recordId: record.id,
						switchIds: record.membership.advancedSwitchIds,
						index: 0,
					},
					compareOrganizationSwitchMembershipCursors,
				);
			}
		}
		let previousRecordId = 0;
		let previousSwitchId: number | null = null;
		while (heap.length > 0) {
			const cursor = minHeapPop(heap, compareOrganizationSwitchMembershipCursors);
			if (!cursor) break;
			const switchId = cursor.switchIds[cursor.index] as number;
			if (previousSwitchId === switchId) {
				return `${kind} 조직 ${previousRecordId}과 ${cursor.recordId}이 switch:${switchId} 멤버십을 함께 소유합니다`;
			}
			previousRecordId = cursor.recordId;
			previousSwitchId = switchId;
			cursor.index++;
			if (cursor.index < cursor.switchIds.length) {
				minHeapPush(heap, cursor, compareOrganizationSwitchMembershipCursors);
			}
		}
	}
	return null;
}

function compareOrganizationRailMembershipCursors(
	left: OrganizationRailMembershipCursor,
	right: OrganizationRailMembershipCursor,
): number {
	return (
		compareDirectedRailEdges(
			left.edges[left.index] as DirectedRailEdge,
			right.edges[right.index] as DirectedRailEdge,
		) || left.recordId - right.recordId
	);
}

function compareOrganizationSwitchMembershipCursors(
	left: OrganizationSwitchMembershipCursor,
	right: OrganizationSwitchMembershipCursor,
): number {
	return (
		(left.switchIds[left.index] as number) - (right.switchIds[right.index] as number) ||
		left.recordId - right.recordId
	);
}

function minHeapPush<Value>(
	heap: Value[],
	value: Value,
	compare: (left: Value, right: Value) => number,
): void {
	heap.push(value);
	let index = heap.length - 1;
	while (index > 0) {
		const parentIndex = Math.floor((index - 1) / 2);
		const parent = heap[parentIndex] as Value;
		if (compare(parent, value) <= 0) break;
		heap[index] = parent;
		index = parentIndex;
	}
	heap[index] = value;
}

function minHeapPop<Value>(
	heap: Value[],
	compare: (left: Value, right: Value) => number,
): Value | undefined {
	const first = heap[0];
	const last = heap.pop();
	if (first === undefined || last === undefined || heap.length === 0) return first;
	let index = 0;
	while (true) {
		const leftIndex = index * 2 + 1;
		if (leftIndex >= heap.length) break;
		const rightIndex = leftIndex + 1;
		const childIndex =
			rightIndex < heap.length && compare(heap[rightIndex] as Value, heap[leftIndex] as Value) < 0
				? rightIndex
				: leftIndex;
		const child = heap[childIndex] as Value;
		if (compare(last, child) <= 0) break;
		heap[index] = child;
		index = childIndex;
	}
	heap[index] = last;
	return first;
}

const organizationOwnershipCache = new WeakMap<
	TileMap,
	Readonly<{
		revision: number;
		index: OrganizationOwnershipValidationIndex;
	}>
>();

interface OrganizationOwnershipValidationIndex {
	readonly ownership: RailModuleOwnershipIndex;
	readonly modules: RailModuleOwnershipIndex["modules"];
	readonly moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>;
	readonly moduleIndicesBySwitch: ReadonlyMap<number, readonly number[]>;
}

function organizationOwnershipIndex(
	map: TileMap,
	providedOwnership?: RailModuleOwnershipIndex,
): OrganizationOwnershipValidationIndex {
	const revision = map.getRevision();
	if (!providedOwnership) {
		const cached = organizationOwnershipCache.get(map);
		if (
			cached?.revision === revision &&
			railModuleOwnershipIndexMatchesMap(cached.index.ownership, map)
		) {
			return cached.index;
		}
	}
	const ownership = providedOwnership ?? buildRailModuleOwnershipIndex(map);
	const moduleIndicesByEdge = new Map<string, number[]>();
	const moduleIndicesBySwitch = new Map<number, number[]>();
	for (let moduleIndex = 0; moduleIndex < ownership.modules.length; moduleIndex += 1) {
		const module = ownership.modules[moduleIndex];
		if (!module) continue;
		for (const edge of module.eraseEdges) {
			appendOrganizationModuleIndex(
				moduleIndicesByEdge,
				staticFabOrganizationEdgeKey(edge),
				moduleIndex,
			);
		}
		if (module.advancedSwitchId !== null) {
			appendOrganizationModuleIndex(moduleIndicesBySwitch, module.advancedSwitchId, moduleIndex);
		}
	}
	const index = Object.freeze({
		ownership,
		modules: ownership.modules,
		moduleIndicesByEdge,
		moduleIndicesBySwitch,
	});
	if (!providedOwnership) {
		organizationOwnershipCache.set(map, Object.freeze({ revision, index }));
	}
	return index;
}

/** Reuse the same source-bound module graph after Rail-only organization validation. */
export function staticFabOrganizationRailOwnershipIndex(map: TileMap): RailModuleOwnershipIndex {
	return organizationOwnershipIndex(map).ownership;
}

function staticFabOrganizationOwnershipError(
	ownership: OrganizationOwnershipValidationIndex,
	record: StaticFabOrganizationRecord,
): string | null {
	const targetEdges = new Set(record.membership.railEdges.map(staticFabOrganizationEdgeKey));
	const targetSwitches = new Set(record.membership.advancedSwitchIds);
	const touchedModuleIndices = new Set<number>();
	for (const edgeKey of targetEdges) {
		for (const moduleIndex of ownership.moduleIndicesByEdge.get(edgeKey) ?? []) {
			touchedModuleIndices.add(moduleIndex);
		}
	}
	for (const switchId of targetSwitches) {
		for (const moduleIndex of ownership.moduleIndicesBySwitch.get(switchId) ?? []) {
			touchedModuleIndices.add(moduleIndex);
		}
	}
	const resolvedEdges = new Set<string>();
	const resolvedSwitches = new Set<number>();
	for (const moduleIndex of touchedModuleIndices) {
		const module = ownership.modules[moduleIndex];
		if (!module) {
			return `조직 ${record.id}의 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`;
		}
		if (
			module.eraseEdges.some((edge) => !targetEdges.has(staticFabOrganizationEdgeKey(edge))) ||
			(module.advancedSwitchId !== null && !targetSwitches.has(module.advancedSwitchId))
		) {
			return `조직 ${record.id}의 멤버십은 현재 레일 모듈 ${module.key} 전체를 포함해야 합니다`;
		}
		for (const edge of module.eraseEdges) resolvedEdges.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) resolvedSwitches.add(module.advancedSwitchId);
	}
	if (!setEquals(targetEdges, resolvedEdges) || !setEquals(targetSwitches, resolvedSwitches)) {
		return `조직 ${record.id}의 멤버십을 현재 레일 모듈로 정확히 복원할 수 없습니다`;
	}
	return null;
}

function appendOrganizationModuleIndex<Key>(
	target: Map<Key, number[]>,
	key: Key,
	moduleIndex: number,
): void {
	const indices = target.get(key);
	if (indices) indices.push(moduleIndex);
	else target.set(key, [moduleIndex]);
}

function setEquals<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) if (!right.has(value)) return false;
	return true;
}

function numberArrayEquals(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPositiveInt32(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}
