import { stableSortSteps } from "./CooperativeSort";
import { completeCooperativeSteps } from "./CooperativeTask";
import type { PortEquipmentState } from "./EquipmentGroup";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	type DirectedRailEdge,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell, oppositeDirection } from "./railShape";
import {
	compareDirectedRailEdges,
	deriveStaticFabOrganizationSemanticRoleSteps,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationRailOwnershipIndex,
	staticFabOrganizationRailStateBudgetSteps,
	staticFabOrganizationRailStateError,
} from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationActivation,
	type ValidatedStaticFabOrganizationActivation,
} from "./StaticFabOrganizationActivation";
import { type Cell, decodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS = 100_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_RECORD = 64;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_GROUP = 64;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD = 65_536;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_DOCUMENT = 500_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_DOCUMENT = 1_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT = 1_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_DIRECT_OWNER_IDS_PER_SCOPE = 64;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_RECORD = 65_536;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_DOCUMENT = 1_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_SOURCE_ANCESTRY_STEPS = 5_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES = 128 * 1024 * 1024;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_TRANSITION = 2_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_TRANSITION = 2_000_000;
export const STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES_PER_TRANSITION = 64 * 1024 * 1024;

export type StaticFabAssemblyRelationshipHierarchyRole = "BAY_TO_BANK" | "BANK_TO_FAB";
export type StaticFabAssemblyRelationshipPurpose = "HIERARCHY_LINK" | "FAB_LOOP";
export type StaticFabAssemblyRelationshipReviewPolicy =
	| "REVIEW_REQUIRED"
	| "AUTHORING_NON_DETACHABLE";
export type StaticFabAssemblyRelationshipDirectionRole =
	| "OUTBOUND"
	| "RETURN"
	| "ATTACHMENT"
	| "CONTACT";

export interface StaticFabAssemblyRelationshipStateV1 {
	readonly nextRelationshipId: number;
	readonly records: readonly StaticFabAssemblyRelationshipRecordV1[];
}

export interface StaticFabAssemblyRelationshipMutationV1 {
	readonly id: number;
	readonly before: StaticFabAssemblyRelationshipRecordV1 | null;
	readonly after: StaticFabAssemblyRelationshipRecordV1 | null;
}

export interface StaticFabAssemblyRelationshipTransitionFootprintV1 {
	readonly edgeReferenceCount: number;
	readonly ownerIdCount: number;
	readonly canonicalByteCount: number;
}

/** Optional lower ceilings provide a deterministic test seam and may never raise production caps. */
export interface StaticFabAssemblyRelationshipTransitionFootprintLimitsV1 {
	readonly maximumEdgeReferences?: number;
	readonly maximumOwnerIds?: number;
	readonly maximumCanonicalBytes?: number;
}

export interface StaticFabAssemblyRelationshipRecordV1 {
	readonly id: number;
	readonly hierarchyRole: StaticFabAssemblyRelationshipHierarchyRole;
	readonly purpose: StaticFabAssemblyRelationshipPurpose;
	readonly parentOrganizationId: number;
	readonly participantOrganizationIds: readonly [number] | readonly [number, number];
	readonly managedChildOrganizationIds: readonly number[];
	readonly reviewPolicy: StaticFabAssemblyRelationshipReviewPolicy;
	readonly connectionGroups: readonly StaticFabAssemblyRelationshipConnectionGroupV1[];
}

export interface StaticFabAssemblyRelationshipConnectionGroupV1 {
	readonly ordinal: number;
	readonly legs: readonly StaticFabAssemblyRelationshipLegV1[];
}

export interface StaticFabAssemblyRelationshipLegV1 {
	readonly ordinal: number;
	readonly directionRole: StaticFabAssemblyRelationshipDirectionRole;
	readonly exclusiveCutEdges: readonly StaticFabAssemblyScopedEdgeV1[];
	readonly endpointSupports: readonly StaticFabAssemblyEndpointSupportV1[];
	readonly seamContacts: readonly StaticFabAssemblySeamContactV1[];
}

export type StaticFabAssemblyRelationshipEdgeScopeV1 =
	| { readonly kind: "PARENT_DIRECT" }
	| {
			readonly kind: "PARTICIPANT_EFFECTIVE";
			readonly participantIndex: 0 | 1;
			readonly directOwnerOrganizationIds: readonly number[];
	  }
	| {
			readonly kind: "PARENT_AND_PARTICIPANT_EFFECTIVE";
			readonly participantIndex: 0 | 1;
			readonly directOwnerOrganizationIds: readonly number[];
	  };

export interface StaticFabAssemblyScopedEdgeV1 {
	readonly edge: DirectedRailEdge;
	readonly scope: StaticFabAssemblyRelationshipEdgeScopeV1;
}

export interface StaticFabAssemblyEndpointSupportV1 {
	readonly support: StaticFabAssemblyScopedEdgeV1;
	readonly adjacentExclusiveCutEdgeIndex: number;
	readonly position: "PREDECESSOR" | "SUCCESSOR";
}

export interface StaticFabAssemblySeamContactV1 {
	readonly role: "BRANCH" | "MERGE" | "CONTACT";
	readonly incidences: readonly StaticFabAssemblySeamIncidenceV1[];
}

export interface StaticFabAssemblySeamIncidenceV1 {
	readonly incidence: "INCOMING" | "OUTGOING";
	readonly binding:
		| {
				readonly kind: "EXCLUSIVE_CUT_EDGE";
				readonly exclusiveCutEdgeIndex: number;
		  }
		| {
				readonly kind: "WITNESS";
				readonly scopedEdge: StaticFabAssemblyScopedEdgeV1;
		  };
}

const canonicalRelationshipStates = new WeakSet<object>();

export function emptyStaticFabAssemblyRelationshipState(): StaticFabAssemblyRelationshipStateV1 {
	return brandCanonicalRelationshipState(
		Object.freeze({ nextRelationshipId: 1, records: Object.freeze([]) }),
	);
}

export function isCanonicalStaticFabAssemblyRelationshipState(
	state: StaticFabAssemblyRelationshipStateV1,
): boolean {
	return canonicalRelationshipStates.has(state);
}

/** Validate every count and scalar before allocating a nested immutable copy. */
export function copyStaticFabAssemblyRelationshipState(
	state: StaticFabAssemblyRelationshipStateV1,
): StaticFabAssemblyRelationshipStateV1 {
	const error = staticFabAssemblyRelationshipStateShapeError(state);
	if (error) throw new Error(error);
	const records = state.records.map(copyRecord);
	return brandCanonicalRelationshipState(
		Object.freeze({
			nextRelationshipId: state.nextRelationshipId,
			records: Object.freeze(records),
		}),
	);
}

export function createStaticFabAssemblyRelationshipState(
	input: unknown,
): StaticFabAssemblyRelationshipStateV1 {
	const state = input as StaticFabAssemblyRelationshipStateV1;
	const error = staticFabAssemblyRelationshipStateShapeError(state);
	if (error) throw new Error(error);
	return copyStaticFabAssemblyRelationshipState(state);
}

export function copyStaticFabAssemblyRelationshipRecord(
	record: StaticFabAssemblyRelationshipRecordV1,
): StaticFabAssemblyRelationshipRecordV1 {
	const result = validateRecordShape(record, new Set<string>(), new Set<string>());
	if (typeof result === "string") throw new Error(`조립 관계 ${record?.id ?? "?"}: ${result}`);
	return copyRecord(record);
}

export interface StaticFabAssemblyRelationshipRemapV1 {
	readonly relationshipId: number;
	readonly organizationIds: ReadonlyMap<number, number>;
	readonly quarterTurns: 0 | 1 | 2 | 3;
	readonly offset: Cell;
}

/** Remap complete immutable identity; final portable closure/source proof remains mandatory. */
export function remapStaticFabAssemblyRelationshipRecord(
	record: StaticFabAssemblyRelationshipRecordV1,
	remap: StaticFabAssemblyRelationshipRemapV1,
): StaticFabAssemblyRelationshipRecordV1 {
	return completeCooperativeSteps(remapStaticFabAssemblyRelationshipRecordSteps(record, remap));
}

/** Caller owns a stable ID mapping; every source container must already be deeply immutable. */
export function* remapStaticFabAssemblyRelationshipRecordSteps(
	record: StaticFabAssemblyRelationshipRecordV1,
	remap: StaticFabAssemblyRelationshipRemapV1,
): Generator<void, StaticFabAssemblyRelationshipRecordV1> {
	const { relationshipId, quarterTurns } = remap;
	const offsetX = remap.offset.x,
		offsetY = remap.offset.y;
	if (!isPositiveInt32(relationshipId) || relationshipId >= 2_147_483_647)
		throw new Error("조립 관계의 새 ID를 안전하게 할당할 수 없습니다");
	if (![0, 1, 2, 3].includes(quarterTurns) || !isInt32(offsetX) || !isInt32(offsetY))
		throw new Error("조립 관계 변환은 90도 회전과 정수 셀 이동만 지원합니다");
	const validation = yield* validateRecordShapeSteps(
		record,
		new Set<string>(),
		new Set<string>(),
		true,
	);
	if (typeof validation === "string") throw new Error(validation);
	if (!isPositiveInt32(record.id) || record.id >= 2_147_483_647) {
		throw new Error("변환할 조립 관계의 원본 ID가 유효하지 않습니다");
	}
	const resolvedIds = new Map<number, number>();
	const sourcesByTarget = new Map<number, number>();
	const organizationId = (sourceId: number): number => {
		const cached = resolvedIds.get(sourceId);
		if (cached !== undefined) return cached;
		const target = remap.organizationIds.get(sourceId);
		if (target === undefined || !isPositiveInt32(target))
			throw new Error(`조립 관계 조직 ${sourceId}의 새 ID가 없습니다`);
		const previous = sourcesByTarget.get(target);
		if (previous !== undefined && previous !== sourceId)
			throw new Error("서로 다른 조립 관계 조직을 같은 ID로 합칠 수 없습니다");
		sourcesByTarget.set(target, sourceId);
		resolvedIds.set(sourceId, target);
		return target;
	};
	const transform = (source: Cell): Cell => {
		let x = source.x,
			y = source.y;
		for (let turn = 0; turn < quarterTurns; turn++) [x, y] = [-y, x];
		x += offsetX;
		y += offsetY;
		if (!isInt32(x) || !isInt32(y))
			throw new Error("조립 관계 변환 좌표가 signed-int32 범위를 벗어났습니다");
		return Object.freeze({ x, y });
	};
	function* scopedSteps(
		source: StaticFabAssemblyScopedEdgeV1,
	): Generator<void, StaticFabAssemblyScopedEdgeV1> {
		yield;
		let scope: StaticFabAssemblyRelationshipEdgeScopeV1;
		if (source.scope.kind === "PARENT_DIRECT") scope = Object.freeze({ kind: "PARENT_DIRECT" });
		else {
			const ids: number[] = [];
			for (const id of source.scope.directOwnerOrganizationIds) {
				yield;
				ids.push(organizationId(id));
			}
			yield* stableSortSteps(ids, (a, b) => a - b);
			scope = Object.freeze({
				kind: source.scope.kind,
				participantIndex: source.scope.participantIndex,
				directOwnerOrganizationIds: Object.freeze(ids),
			});
		}
		return Object.freeze({
			edge: Object.freeze({ from: transform(source.edge.from), to: transform(source.edge.to) }),
			scope,
		});
	}
	const parentOrganizationId = organizationId(record.parentOrganizationId);
	const participants: number[] = [];
	for (const id of record.participantOrganizationIds) {
		yield;
		participants.push(organizationId(id));
	}
	const managed: number[] = [];
	for (const id of record.managedChildOrganizationIds) {
		yield;
		managed.push(organizationId(id));
	}
	yield* stableSortSteps(managed, (a, b) => a - b);
	const groups: StaticFabAssemblyRelationshipConnectionGroupV1[] = [];
	for (const group of record.connectionGroups) {
		yield;
		const legs: StaticFabAssemblyRelationshipLegV1[] = [];
		for (const leg of group.legs) {
			yield;
			const exclusive: StaticFabAssemblyScopedEdgeV1[] = [];
			for (const edge of leg.exclusiveCutEdges) exclusive.push(yield* scopedSteps(edge));
			const supports: StaticFabAssemblyEndpointSupportV1[] = [];
			for (const endpoint of leg.endpointSupports) {
				yield;
				supports.push(
					Object.freeze({
						support: yield* scopedSteps(endpoint.support),
						adjacentExclusiveCutEdgeIndex: endpoint.adjacentExclusiveCutEdgeIndex,
						position: endpoint.position,
					}),
				);
			}
			yield* stableSortSteps(supports, compareEndpointSupport);
			const seams: StaticFabAssemblySeamContactV1[] = [];
			for (const seam of leg.seamContacts) {
				yield;
				const incidences: StaticFabAssemblySeamIncidenceV1[] = [];
				for (const incidence of seam.incidences) {
					yield;
					incidences.push(
						Object.freeze({
							incidence: incidence.incidence,
							binding:
								incidence.binding.kind === "EXCLUSIVE_CUT_EDGE"
									? Object.freeze({
											kind: "EXCLUSIVE_CUT_EDGE",
											exclusiveCutEdgeIndex: incidence.binding.exclusiveCutEdgeIndex,
										})
									: Object.freeze({
											kind: "WITNESS",
											scopedEdge: yield* scopedSteps(incidence.binding.scopedEdge),
										}),
						}),
					);
				}
				yield* stableSortSteps(incidences, (a, b) =>
					compareResolvedIncidence(resolveIncidence(a, exclusive), resolveIncidence(b, exclusive)),
				);
				seams.push(Object.freeze({ role: seam.role, incidences: Object.freeze(incidences) }));
			}
			yield* stableSortSteps(seams, (a, b) => compareSeamContact(a, b, exclusive));
			legs.push(
				Object.freeze({
					ordinal: leg.ordinal,
					directionRole: leg.directionRole,
					exclusiveCutEdges: Object.freeze(exclusive),
					endpointSupports: Object.freeze(supports),
					seamContacts: Object.freeze(seams),
				}),
			);
		}
		groups.push(Object.freeze({ ordinal: group.ordinal, legs: Object.freeze(legs) }));
	}
	const first = participants[0];
	if (first === undefined) throw new Error("변환할 조립 관계 참여 조직이 없습니다");
	const second = participants[1];
	const participantOrganizationIds: readonly [number] | readonly [number, number] =
		second === undefined
			? Object.freeze([first] as const)
			: Object.freeze([first, second] as const);
	const result: StaticFabAssemblyRelationshipRecordV1 = Object.freeze({
		id: relationshipId,
		hierarchyRole: record.hierarchyRole,
		purpose: record.purpose,
		parentOrganizationId,
		participantOrganizationIds,
		managedChildOrganizationIds: Object.freeze(managed),
		reviewPolicy: record.reviewPolicy,
		connectionGroups: Object.freeze(groups),
	});
	const resultError = yield* validateRecordShapeSteps(
		result,
		new Set<string>(),
		new Set<string>(),
		true,
	);
	if (typeof resultError === "string") throw new Error(resultError);
	return result;
}

/**
 * Count one reversible transition before allocating copies or applying mutations.
 * Every before/after record occurrence contributes independently to the history footprint.
 */
export function staticFabAssemblyRelationshipTransitionFootprint(
	mutations: readonly StaticFabAssemblyRelationshipMutationV1[],
	limits: StaticFabAssemblyRelationshipTransitionFootprintLimitsV1 = {},
): StaticFabAssemblyRelationshipTransitionFootprintV1 {
	if (!Array.isArray(mutations)) throw new Error("조립 관계 변경 목록은 배열이어야 합니다");
	if (mutations.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS * 2) {
		throw new Error("조립 관계 transition 변경 수가 문서 전후 record 한도를 초과했습니다");
	}
	const maximumEdgeReferences = readTransitionFootprintLimit(
		limits.maximumEdgeReferences,
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_TRANSITION,
		"edge 참조",
	);
	const maximumOwnerIds = readTransitionFootprintLimit(
		limits.maximumOwnerIds,
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_TRANSITION,
		"소유자 ID",
	);
	const maximumCanonicalBytes = readTransitionFootprintLimit(
		limits.maximumCanonicalBytes,
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES_PER_TRANSITION,
		"canonical byte",
	);
	const touched = new Set<number>();
	const beforeExclusiveEdges = new Set<string>();
	const beforeManagedBindings = new Set<string>();
	const afterExclusiveEdges = new Set<string>();
	const afterManagedBindings = new Set<string>();
	let beforeRecordCount = 0;
	let afterRecordCount = 0;
	let edgeReferenceCount = 0;
	let ownerIdCount = 0;
	let canonicalByteCount = 0;
	for (let index = 0; index < mutations.length; index++) {
		const mutation = mutations[index] as StaticFabAssemblyRelationshipMutationV1;
		if (
			!mutation ||
			typeof mutation !== "object" ||
			!hasExactKeys(mutation, ["id", "before", "after"])
		) {
			throw new Error(`조립 관계 변경 ${index} 필드가 V1 계약과 정확히 일치하지 않습니다`);
		}
		if (!isPositiveInt32(mutation.id)) {
			throw new Error(`조립 관계 변경 ID ${mutation.id}이 유효하지 않습니다`);
		}
		if (touched.has(mutation.id)) {
			throw new Error(`조립 관계 ${mutation.id}을 한 transition에서 두 번 변경했습니다`);
		}
		touched.add(mutation.id);
		if (mutation.before === null && mutation.after === null) {
			throw new Error(`조립 관계 ${mutation.id} 변경에 before와 after가 모두 없습니다`);
		}
		for (const [side, record] of [
			["before", mutation.before],
			["after", mutation.after],
		] as const) {
			if (record === null) continue;
			if (!record || typeof record !== "object") {
				throw new Error(`조립 관계 ${mutation.id} 변경의 ${side} 값은 record여야 합니다`);
			}
			if (record.id !== mutation.id) {
				throw new Error(`조립 관계 ${mutation.id} 변경의 ${side} record ID가 일치하지 않습니다`);
			}
			const result = validateRecordShape(
				record,
				side === "before" ? beforeExclusiveEdges : afterExclusiveEdges,
				side === "before" ? beforeManagedBindings : afterManagedBindings,
			);
			if (typeof result === "string") {
				throw new Error(`조립 관계 ${mutation.id} 변경의 ${side} 값: ${result}`);
			}
			if (side === "before") beforeRecordCount++;
			else afterRecordCount++;
			if (
				beforeRecordCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS ||
				afterRecordCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS
			) {
				throw new Error("조립 관계 transition 한쪽의 record 한도를 초과했습니다");
			}
			edgeReferenceCount += result.edgeReferenceCount;
			ownerIdCount += result.ownerIdCount;
			canonicalByteCount += result.canonicalByteCount;
			if (edgeReferenceCount > maximumEdgeReferences) {
				throw new Error("조립 관계 transition edge 참조 한도를 초과했습니다");
			}
			if (ownerIdCount > maximumOwnerIds) {
				throw new Error("조립 관계 transition 소유자 ID 참조 한도를 초과했습니다");
			}
			if (canonicalByteCount > maximumCanonicalBytes) {
				throw new Error("조립 관계 transition canonical byte 예산을 초과했습니다");
			}
		}
		if (staticFabAssemblyRelationshipRecordEquals(mutation.before, mutation.after)) {
			throw new Error(`조립 관계 ${mutation.id} 변경은 no-op입니다`);
		}
	}
	return Object.freeze({ edgeReferenceCount, ownerIdCount, canonicalByteCount });
}

export function applyStaticFabAssemblyRelationshipMutations(
	state: StaticFabAssemblyRelationshipStateV1,
	mutations: readonly StaticFabAssemblyRelationshipMutationV1[],
	plannedNextRelationshipId: number,
): StaticFabAssemblyRelationshipStateV1 {
	const stateError = staticFabAssemblyRelationshipStateShapeError(state);
	if (stateError) throw new Error(stateError);
	if (!isPositiveInt32(plannedNextRelationshipId)) {
		throw new Error("계획된 다음 조립 관계 ID는 양의 32-bit 정수여야 합니다");
	}
	staticFabAssemblyRelationshipTransitionFootprint(mutations);
	const nextRelationshipId = Math.max(state.nextRelationshipId, plannedNextRelationshipId);
	if (mutations.length === 0 && isCanonicalStaticFabAssemblyRelationshipState(state)) {
		if (nextRelationshipId === state.nextRelationshipId) return state;
		return brandCanonicalRelationshipState(
			Object.freeze({ nextRelationshipId, records: state.records }),
		);
	}
	const records = new Map(state.records.map((record) => [record.id, record]));
	const replacementIds = new Set<number>();
	for (const mutation of mutations) {
		const current = records.get(mutation.id) ?? null;
		if (!staticFabAssemblyRelationshipRecordEquals(current, mutation.before)) {
			throw new Error(`조립 관계 ${mutation.id} 변경의 before 값이 현재 문서와 다릅니다`);
		}
		if (mutation.after) {
			records.set(mutation.id, mutation.after);
			replacementIds.add(mutation.id);
		} else records.delete(mutation.id);
	}
	const nextRecords = [...records.values()].sort((left, right) => left.id - right.id);
	const nextState = { nextRelationshipId, records: nextRecords };
	const nextStateError = staticFabAssemblyRelationshipStateShapeError(nextState);
	if (nextStateError) throw new Error(nextStateError);
	const sourceIsCanonical = isCanonicalStaticFabAssemblyRelationshipState(state);
	return brandCanonicalRelationshipState(
		Object.freeze({
			nextRelationshipId,
			records: Object.freeze(
				nextRecords.map((record) =>
					sourceIsCanonical && !replacementIds.has(record.id) ? record : copyRecord(record),
				),
			),
		}),
	);
}

export function reverseStaticFabAssemblyRelationshipMutations(
	mutations: readonly StaticFabAssemblyRelationshipMutationV1[],
): readonly StaticFabAssemblyRelationshipMutationV1[] {
	staticFabAssemblyRelationshipTransitionFootprint(mutations);
	return Object.freeze(
		mutations.map((mutation) =>
			Object.freeze({
				id: mutation.id,
				before: mutation.after ? copyRecord(mutation.after) : null,
				after: mutation.before ? copyRecord(mutation.before) : null,
			}),
		),
	);
}

export function assertStaticFabAssemblyRelationshipStateShape(input: unknown): void {
	const error = staticFabAssemblyRelationshipStateShapeError(
		input as StaticFabAssemblyRelationshipStateV1,
	);
	if (error) throw new Error(error);
}

export function staticFabAssemblyRelationshipStateShapeError(
	state: StaticFabAssemblyRelationshipStateV1,
	maximumCanonicalBytes = STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES,
): string | null {
	return completeCooperativeSteps(relationshipStateShapeSteps(state, maximumCanonicalBytes));
}

/** Reuse the exact shape grammar at cooperatively scheduled portable decode boundaries. */
export function* staticFabAssemblyRelationshipStateShapeErrorSteps(
	state: StaticFabAssemblyRelationshipStateV1,
): Generator<void, string | null> {
	return yield* relationshipStateShapeSteps(state);
}

/** Adopt only a deeply immutable graph, checking every nested value before it is read. */
export function* adoptStaticFabAssemblyRelationshipStateSteps(
	state: StaticFabAssemblyRelationshipStateV1,
): Generator<void, StaticFabAssemblyRelationshipStateV1> {
	const error = yield* relationshipStateShapeSteps(
		state,
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES,
		true,
	);
	if (error) throw new Error(error);
	return brandCanonicalRelationshipState(state);
}

function* relationshipStateShapeSteps(
	state: StaticFabAssemblyRelationshipStateV1,
	maximumCanonicalBytes = STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES,
	requireImmutable = false,
): Generator<void, string | null> {
	if (
		!Number.isSafeInteger(maximumCanonicalBytes) ||
		maximumCanonicalBytes <= 0 ||
		maximumCanonicalBytes > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES
	) {
		return "조립 관계 canonical byte 예산은 양의 safe integer여야 합니다";
	}
	if (requireImmutable && (!Object.isFrozen(state) || !isFrozenRelationshipArray(state?.records)))
		return "조립 관계 상태는 불변이어야 합니다";
	if (!state || typeof state !== "object") return "조립 관계 상태는 객체여야 합니다";
	if (!hasExactKeys(state, ["nextRelationshipId", "records"])) {
		return "조립 관계 상태 필드가 V1 계약과 정확히 일치하지 않습니다";
	}
	if (!isPositiveInt32(state.nextRelationshipId)) {
		return "다음 조립 관계 ID는 양의 32-bit 정수여야 합니다";
	}
	if (!Array.isArray(state.records)) return "조립 관계 레코드 목록은 배열이어야 합니다";
	if (state.records.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS) {
		return `조립 관계는 최대 ${STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS}개까지 저장할 수 있습니다`;
	}

	let previousRecordId = 0;
	let documentGroupCount = 0;
	let documentLegCount = 0;
	let documentEdgeReferenceCount = 0;
	let documentOwnerIdCount = 0;
	let documentCanonicalByteCount = 8;
	const exclusiveEdges = new Set<string>();
	const managedBindings = new Set<string>();

	for (let recordIndex = 0; recordIndex < state.records.length; recordIndex++) {
		yield;
		if (requireImmutable && !hasDataArrayItem(state.records, recordIndex))
			return "조립 관계 배열은 data property여야 합니다";
		const record = state.records[recordIndex] as StaticFabAssemblyRelationshipRecordV1;
		const prefix = `조립 관계 ${record?.id ?? recordIndex + 1}`;
		if (!record || typeof record !== "object") return `${prefix}: 레코드는 객체여야 합니다`;
		if (!isPositiveInt32(record.id) || record.id <= previousRecordId) {
			return "조립 관계는 중복 없는 양의 ID 오름차순이어야 합니다";
		}
		if (record.id >= state.nextRelationshipId) {
			return "다음 조립 관계 ID는 모든 저장된 관계 ID보다 커야 합니다";
		}
		previousRecordId = record.id;
		const result = yield* validateRecordShapeSteps(
			record,
			exclusiveEdges,
			managedBindings,
			requireImmutable,
		);
		if (typeof result === "string") return `${prefix}: ${result}`;
		documentGroupCount += result.groupCount;
		documentLegCount += result.legCount;
		documentEdgeReferenceCount += result.edgeReferenceCount;
		documentOwnerIdCount += result.ownerIdCount;
		documentCanonicalByteCount += result.canonicalByteCount;
		if (documentCanonicalByteCount > maximumCanonicalBytes) {
			return "문서 조립 관계 canonical byte 예산을 초과했습니다";
		}
		if (documentGroupCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_DOCUMENT) {
			return "문서 조립 관계 그룹 한도를 초과했습니다";
		}
		if (documentLegCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_DOCUMENT) {
			return "문서 조립 관계 leg 한도를 초과했습니다";
		}
		if (
			documentEdgeReferenceCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT
		) {
			return "문서 조립 관계 edge 참조 한도를 초과했습니다";
		}
		if (documentOwnerIdCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_DOCUMENT) {
			return "문서 조립 관계 소유자 ID 참조 한도를 초과했습니다";
		}
	}
	return null;
}

interface ShapeCounts {
	readonly groupCount: number;
	readonly legCount: number;
	readonly edgeReferenceCount: number;
	readonly ownerIdCount: number;
	readonly canonicalByteCount: number;
}

function validateRecordShape(
	record: StaticFabAssemblyRelationshipRecordV1,
	documentExclusiveEdges: Set<string>,
	managedBindings: Set<string>,
): ShapeCounts | string {
	return completeCooperativeSteps(
		validateRecordShapeSteps(record, documentExclusiveEdges, managedBindings),
	);
}

function* findRelationshipItemSteps<T>(
	items: readonly T[],
	matches: (item: T) => boolean,
): Generator<void, T | undefined> {
	for (const item of items) {
		yield;
		if (matches(item)) return item;
	}
	return undefined;
}

function* validateRecordShapeSteps(
	record: StaticFabAssemblyRelationshipRecordV1,
	documentExclusiveEdges: Set<string>,
	managedBindings: Set<string>,
	requireImmutable = false,
): Generator<void, ShapeCounts | string> {
	if (
		requireImmutable &&
		(!Object.isFrozen(record) ||
			!isFrozenRelationshipArray(record?.participantOrganizationIds) ||
			!isFrozenRelationshipArray(record?.managedChildOrganizationIds) ||
			!isFrozenRelationshipArray(record?.connectionGroups))
	)
		return "조립 관계 레코드는 불변이어야 합니다";
	if (
		!hasExactKeys(record, [
			"id",
			"hierarchyRole",
			"purpose",
			"parentOrganizationId",
			"participantOrganizationIds",
			"managedChildOrganizationIds",
			"reviewPolicy",
			"connectionGroups",
		])
	) {
		return "레코드 필드가 V1 계약과 정확히 일치하지 않습니다";
	}
	if (record.hierarchyRole !== "BAY_TO_BANK" && record.hierarchyRole !== "BANK_TO_FAB") {
		return "알 수 없는 계층 역할입니다";
	}
	if (record.purpose !== "HIERARCHY_LINK" && record.purpose !== "FAB_LOOP") {
		return "알 수 없는 관계 목적입니다";
	}
	if (!isPositiveInt32(record.parentOrganizationId)) return "부모 조직 ID가 유효하지 않습니다";
	if (
		!Array.isArray(record.participantOrganizationIds) ||
		(record.participantOrganizationIds.length !== 1 &&
			record.participantOrganizationIds.length !== 2)
	) {
		return "참여 조직은 한 개 또는 두 개여야 합니다";
	}
	const participantIds = record.participantOrganizationIds;
	if (
		requireImmutable &&
		!participantIds.every((_, index) => hasDataArrayItem(participantIds, index))
	)
		return "참여 조직 배열은 data property여야 합니다";
	for (const id of participantIds) {
		yield;
		if (!isPositiveInt32(id)) return "참여 조직 ID가 유효하지 않습니다";
		if (id === record.parentOrganizationId) return "부모와 참여 조직은 서로 달라야 합니다";
	}
	if (participantIds.length === 2 && participantIds[0] === participantIds[1]) {
		return "참여 조직은 서로 달라야 합니다";
	}
	if (
		!Array.isArray(record.managedChildOrganizationIds) ||
		record.managedChildOrganizationIds.length > participantIds.length ||
		!isSortedUniquePositiveInt32Array(record.managedChildOrganizationIds) ||
		record.managedChildOrganizationIds.some((id) => !participantIds.includes(id))
	) {
		return "관리 자식 조직은 참여 조직의 중복 없는 ID 오름차순 부분집합이어야 합니다";
	}
	if (record.purpose === "HIERARCHY_LINK" && record.managedChildOrganizationIds.length === 0) {
		return "계층 연결은 하나 이상의 관리 자식 조직이 필요합니다";
	}
	if (
		record.purpose === "FAB_LOOP" &&
		(record.hierarchyRole !== "BANK_TO_FAB" ||
			participantIds.length !== 2 ||
			record.managedChildOrganizationIds.length !== 0)
	) {
		return "FAB Loop는 BANK_TO_FAB의 두 참여 조직과 빈 관리 자식 목록이 필요합니다";
	}
	if (
		requireImmutable &&
		!record.managedChildOrganizationIds.every((_, index) =>
			hasDataArrayItem(record.managedChildOrganizationIds, index),
		)
	)
		return "관리 조직 배열은 data property여야 합니다";
	for (const childId of record.managedChildOrganizationIds) {
		yield;
		const key = `${record.hierarchyRole}:${childId}:${record.parentOrganizationId}`;
		if (managedBindings.has(key)) return `관리 계층 연결 ${key}이 중복되었습니다`;
		managedBindings.add(key);
	}
	if (
		record.reviewPolicy !== "REVIEW_REQUIRED" &&
		record.reviewPolicy !== "AUTHORING_NON_DETACHABLE"
	) {
		return "알 수 없는 검토 정책입니다";
	}
	if (!Array.isArray(record.connectionGroups) || record.connectionGroups.length === 0) {
		return "하나 이상의 연결 그룹이 필요합니다";
	}
	if (record.connectionGroups.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_RECORD) {
		return "관계별 연결 그룹 한도를 초과했습니다";
	}

	let legCount = 0;
	let edgeReferenceCount = 0;
	let ownerIdCount = 0;
	let exclusiveCount = 0;
	let canonicalByteCount =
		32 + participantIds.length * 4 + record.managedChildOrganizationIds.length * 4;
	const seenParticipantIndexes = new Set<number>();
	for (let groupIndex = 0; groupIndex < record.connectionGroups.length; groupIndex++) {
		yield;
		if (requireImmutable && !hasDataArrayItem(record.connectionGroups, groupIndex))
			return "조립 관계 배열은 data property여야 합니다";
		const group = record.connectionGroups[
			groupIndex
		] as StaticFabAssemblyRelationshipConnectionGroupV1;
		if (requireImmutable && (!Object.isFrozen(group) || !isFrozenRelationshipArray(group?.legs)))
			return "조립 관계 그룹은 불변이어야 합니다";
		if (
			!group ||
			typeof group !== "object" ||
			!hasExactKeys(group, ["ordinal", "legs"]) ||
			group.ordinal !== groupIndex
		) {
			return "연결 그룹 ordinal은 0부터 연속이어야 합니다";
		}
		if (!Array.isArray(group.legs) || group.legs.length === 0) {
			return `그룹 ${groupIndex}: 하나 이상의 leg가 필요합니다`;
		}
		if (group.legs.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_GROUP) {
			return `그룹 ${groupIndex}: leg 한도를 초과했습니다`;
		}
		let outboundLegs = 0;
		let returnLegs = 0;
		canonicalByteCount += 8;
		for (let legIndex = 0; legIndex < group.legs.length; legIndex++) {
			yield;
			if (requireImmutable && !hasDataArrayItem(group.legs, legIndex))
				return "조립 관계 배열은 data property여야 합니다";
			const leg = group.legs[legIndex] as StaticFabAssemblyRelationshipLegV1;
			if (
				!leg ||
				typeof leg !== "object" ||
				!hasExactKeys(leg, [
					"ordinal",
					"directionRole",
					"exclusiveCutEdges",
					"endpointSupports",
					"seamContacts",
				]) ||
				leg.ordinal !== legIndex
			) {
				return `그룹 ${groupIndex}: leg ordinal은 0부터 연속이어야 합니다`;
			}
			const legResult = yield* validateLegShapeSteps(
				leg,
				participantIds.length,
				documentExclusiveEdges,
				seenParticipantIndexes,
				requireImmutable,
			);
			if (typeof legResult === "string") {
				return `그룹 ${groupIndex} leg ${legIndex}: ${legResult}`;
			}
			legCount++;
			edgeReferenceCount += legResult.edgeReferenceCount;
			ownerIdCount += legResult.ownerIdCount;
			canonicalByteCount += legResult.canonicalByteCount;
			exclusiveCount += leg.exclusiveCutEdges.length;
			if (edgeReferenceCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD) {
				return "관계별 edge 참조 한도를 초과했습니다";
			}
			if (ownerIdCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_RECORD) {
				return "관계별 소유자 ID 참조 한도를 초과했습니다";
			}
			if (leg.directionRole === "OUTBOUND") {
				if (leg.exclusiveCutEdges.length === 0) {
					return `그룹 ${groupIndex}: outbound leg는 nonempty walk여야 합니다`;
				}
				outboundLegs++;
			}
			if (leg.directionRole === "RETURN") {
				if (leg.exclusiveCutEdges.length === 0) {
					return `그룹 ${groupIndex}: return leg는 nonempty walk여야 합니다`;
				}
				returnLegs++;
			}
		}
		if (participantIds.length === 2 && (outboundLegs !== 1 || returnLegs !== 1)) {
			return `그룹 ${groupIndex}: 두 참여 조직은 정확히 한 outbound/return walk가 필요합니다`;
		}
	}
	if (seenParticipantIndexes.size !== participantIds.length) {
		return "모든 참여 조직은 하나 이상의 seam incidence에 나타나야 합니다";
	}
	if (record.reviewPolicy === "REVIEW_REQUIRED" && exclusiveCount === 0) {
		return "검토 필요 관계는 하나 이상의 exclusive cut edge가 필요합니다";
	}
	if (edgeReferenceCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD) {
		return "관계별 edge 참조 한도를 초과했습니다";
	}
	if (ownerIdCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_RECORD) {
		return "관계별 소유자 ID 참조 한도를 초과했습니다";
	}
	return {
		groupCount: record.connectionGroups.length,
		legCount,
		edgeReferenceCount,
		ownerIdCount,
		canonicalByteCount,
	};
}

interface LegShapeCounts {
	readonly edgeReferenceCount: number;
	readonly ownerIdCount: number;
	readonly canonicalByteCount: number;
}

function* validateLegShapeSteps(
	leg: StaticFabAssemblyRelationshipLegV1,
	participantCount: number,
	documentExclusiveEdges: Set<string>,
	seenParticipantIndexes: Set<number>,
	requireImmutable = false,
): Generator<void, LegShapeCounts | string> {
	if (
		requireImmutable &&
		(!Object.isFrozen(leg) ||
			!isFrozenRelationshipArray(leg?.exclusiveCutEdges) ||
			!isFrozenRelationshipArray(leg?.endpointSupports) ||
			!isFrozenRelationshipArray(leg?.seamContacts))
	)
		return "조립 관계 leg는 불변이어야 합니다";
	if (!isDirectionRole(leg.directionRole)) return "알 수 없는 방향 역할입니다";
	if (
		participantCount === 1 &&
		(leg.directionRole === "OUTBOUND" || leg.directionRole === "RETURN")
	) {
		return "한 참여 조직 관계는 attachment/contact leg만 사용할 수 있습니다";
	}
	if (
		!Array.isArray(leg.exclusiveCutEdges) ||
		!Array.isArray(leg.endpointSupports) ||
		!Array.isArray(leg.seamContacts)
	) {
		return "leg binding 목록은 배열이어야 합니다";
	}
	if (
		leg.exclusiveCutEdges.length >
			STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD ||
		leg.endpointSupports.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD ||
		leg.seamContacts.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD
	) {
		return "leg binding 목록이 관계별 edge 참조 한도를 초과했습니다";
	}
	if (
		leg.exclusiveCutEdges.length + leg.endpointSupports.length * 2 + leg.seamContacts.length * 2 >
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD
	) {
		return "leg binding의 최소 edge 참조 수가 관계별 한도를 초과했습니다";
	}
	if (leg.exclusiveCutEdges.length === 0 && leg.seamContacts.length === 0) {
		return "support-only leg는 관계 identity가 될 수 없습니다";
	}

	let edgeReferenceCount = 0;
	let ownerIdCount = 0;
	let canonicalByteCount = 20;
	const legExclusiveKeys = new Set<string>();
	for (let index = 0; index < leg.exclusiveCutEdges.length; index++) {
		yield;
		if (requireImmutable && !hasDataArrayItem(leg.exclusiveCutEdges, index))
			return "조립 관계 배열은 data property여야 합니다";
		const scoped = leg.exclusiveCutEdges[index] as StaticFabAssemblyScopedEdgeV1;
		const scopedResult = validateScopedEdgeShape(scoped, participantCount, requireImmutable);
		if (typeof scopedResult === "string") return `exclusive edge ${index}: ${scopedResult}`;
		if (
			index > 0 &&
			!cellsEqual(
				(leg.exclusiveCutEdges[index - 1] as StaticFabAssemblyScopedEdgeV1).edge.to,
				scoped.edge.from,
			)
		) {
			return "exclusive cut edge는 저장 순서대로 하나의 연속 directed walk여야 합니다";
		}
		const key = staticFabOrganizationEdgeKey(scoped.edge);
		if (documentExclusiveEdges.has(key)) return `exclusive cut edge ${key}가 중복되었습니다`;
		documentExclusiveEdges.add(key);
		legExclusiveKeys.add(key);
		edgeReferenceCount++;
		ownerIdCount += scopedResult.ownerIdCount;
		canonicalByteCount += scopedResult.canonicalByteCount;
	}

	let previousSupport: StaticFabAssemblyEndpointSupportV1 | null = null;
	for (let index = 0; index < leg.endpointSupports.length; index++) {
		yield;
		if (requireImmutable && !hasDataArrayItem(leg.endpointSupports, index))
			return "조립 관계 배열은 data property여야 합니다";
		const endpoint = leg.endpointSupports[index] as StaticFabAssemblyEndpointSupportV1;
		if (
			!endpoint ||
			typeof endpoint !== "object" ||
			!hasExactKeys(endpoint, ["support", "adjacentExclusiveCutEdgeIndex", "position"])
		)
			return `endpoint support ${index}이 유효하지 않습니다`;
		if (requireImmutable && !Object.isFrozen(endpoint))
			return "endpoint support는 불변이어야 합니다";
		const scopedResult = validateScopedEdgeShape(
			endpoint.support,
			participantCount,
			requireImmutable,
		);
		if (typeof scopedResult === "string") return `endpoint support ${index}: ${scopedResult}`;
		if (
			!Number.isSafeInteger(endpoint.adjacentExclusiveCutEdgeIndex) ||
			endpoint.adjacentExclusiveCutEdgeIndex < 0 ||
			endpoint.adjacentExclusiveCutEdgeIndex >= leg.exclusiveCutEdges.length
		) {
			return `endpoint support ${index}: exclusive edge index가 유효하지 않습니다`;
		}
		if (endpoint.position !== "PREDECESSOR" && endpoint.position !== "SUCCESSOR") {
			return `endpoint support ${index}: 알 수 없는 위치입니다`;
		}
		const cut = leg.exclusiveCutEdges[
			endpoint.adjacentExclusiveCutEdgeIndex
		] as StaticFabAssemblyScopedEdgeV1;
		if (endpoint.position === "PREDECESSOR") {
			if (
				endpoint.adjacentExclusiveCutEdgeIndex !== 0 ||
				!cellsEqual(endpoint.support.edge.to, cut.edge.from) ||
				cellsEqual(endpoint.support.edge.from, cut.edge.to)
			) {
				return `endpoint support ${index}: predecessor가 첫 cut edge와 정확히 인접하지 않습니다`;
			}
		} else if (
			endpoint.adjacentExclusiveCutEdgeIndex !== leg.exclusiveCutEdges.length - 1 ||
			!cellsEqual(endpoint.support.edge.from, cut.edge.to) ||
			cellsEqual(endpoint.support.edge.to, cut.edge.from)
		) {
			return `endpoint support ${index}: successor가 마지막 cut edge와 정확히 인접하지 않습니다`;
		}
		if (legExclusiveKeys.has(staticFabOrganizationEdgeKey(endpoint.support.edge))) {
			return `endpoint support ${index}: support는 removal set 밖에 있어야 합니다`;
		}
		if (previousSupport && compareEndpointSupport(previousSupport, endpoint) >= 0) {
			return "endpoint support는 중복 없이 canonical 순서여야 합니다";
		}
		previousSupport = endpoint;
		edgeReferenceCount += 2;
		ownerIdCount += scopedResult.ownerIdCount;
		canonicalByteCount += 8 + scopedResult.canonicalByteCount;
	}

	let previousSeam: StaticFabAssemblySeamContactV1 | null = null;
	const resolvedSeams: Array<{
		readonly seam: StaticFabAssemblySeamContactV1;
		readonly junction: Cell;
		readonly incidences: readonly ResolvedIncidence[];
	}> = [];
	for (let index = 0; index < leg.seamContacts.length; index++) {
		yield;
		if (requireImmutable && !hasDataArrayItem(leg.seamContacts, index))
			return "조립 관계 배열은 data property여야 합니다";
		const seam = leg.seamContacts[index] as StaticFabAssemblySeamContactV1;
		const seamResult = validateSeamShape(
			seam,
			leg.exclusiveCutEdges,
			legExclusiveKeys,
			participantCount,
			seenParticipantIndexes,
			requireImmutable,
		);
		if (typeof seamResult === "string") return `seam ${index}: ${seamResult}`;
		if (previousSeam && compareSeamContact(previousSeam, seam, leg.exclusiveCutEdges) >= 0) {
			return "seam contact는 중복 없이 canonical 순서여야 합니다";
		}
		previousSeam = seam;
		resolvedSeams.push({ seam, junction: seamResult.junction, incidences: seamResult.incidences });
		edgeReferenceCount += seamResult.edgeReferenceCount;
		ownerIdCount += seamResult.ownerIdCount;
		canonicalByteCount += seamResult.canonicalByteCount;
		if (
			edgeReferenceCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD ||
			ownerIdCount > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_RECORD
		) {
			return "seam binding 누적 참조 수가 관계별 한도를 초과했습니다";
		}
	}

	if (leg.exclusiveCutEdges.length > 0) {
		const first = leg.exclusiveCutEdges[0] as StaticFabAssemblyScopedEdgeV1;
		const last = leg.exclusiveCutEdges[
			leg.exclusiveCutEdges.length - 1
		] as StaticFabAssemblyScopedEdgeV1;
		const start = yield* findRelationshipItemSteps(
			resolvedSeams,
			(candidate) =>
				cellsEqual(candidate.junction, first.edge.from) &&
				candidate.incidences.some(
					(incidence) =>
						incidence.source.incidence === "OUTGOING" &&
						incidence.source.binding.kind === "EXCLUSIVE_CUT_EDGE" &&
						incidence.source.binding.exclusiveCutEdgeIndex === 0,
				),
		);
		const end = yield* findRelationshipItemSteps(
			resolvedSeams,
			(candidate) =>
				cellsEqual(candidate.junction, last.edge.to) &&
				candidate.incidences.some(
					(incidence) =>
						incidence.source.incidence === "INCOMING" &&
						incidence.source.binding.kind === "EXCLUSIVE_CUT_EDGE" &&
						incidence.source.binding.exclusiveCutEdgeIndex === leg.exclusiveCutEdges.length - 1,
				),
		);
		if (!start || !end) return "exclusive walk의 시작/끝 seam alias가 필요합니다";
		if (
			participantCount === 2 &&
			(leg.directionRole === "OUTBOUND" || leg.directionRole === "RETURN")
		) {
			const startParticipant = leg.directionRole === "OUTBOUND" ? 0 : 1;
			const endParticipant = leg.directionRole === "OUTBOUND" ? 1 : 0;
			if (
				!seamIncludesParentAndParticipant(start.incidences, startParticipant) ||
				!seamIncludesParentAndParticipant(end.incidences, endParticipant)
			) {
				return `${leg.directionRole.toLowerCase()} walk seam이 참여 순서를 식별하지 못합니다`;
			}
		}
	}
	return { edgeReferenceCount, ownerIdCount, canonicalByteCount };
}

interface ScopedShapeCounts {
	readonly ownerIdCount: number;
	readonly canonicalByteCount: number;
}

function validateScopedEdgeShape(
	scoped: StaticFabAssemblyScopedEdgeV1,
	participantCount: number,
	requireImmutable = false,
): ScopedShapeCounts | string {
	if (
		requireImmutable &&
		(!Object.isFrozen(scoped) ||
			!Object.isFrozen(scoped?.edge) ||
			!Object.isFrozen(scoped?.edge?.from) ||
			!Object.isFrozen(scoped?.edge?.to) ||
			!Object.isFrozen(scoped?.scope) ||
			(scoped?.scope?.kind !== "PARENT_DIRECT" &&
				!isFrozenRelationshipArray(scoped?.scope?.directOwnerOrganizationIds)))
	)
		return "scoped edge는 불변이어야 합니다";
	if (!scoped || typeof scoped !== "object" || !hasExactKeys(scoped, ["edge", "scope"])) {
		return "scoped edge 필드가 V1 계약과 정확히 일치해야 합니다";
	}
	if (!isDirectedRailEdge(scoped.edge))
		return "edge는 인접한 signed-int32 directed edge여야 합니다";
	const scope = scoped.scope;
	if (!scope || typeof scope !== "object") return "edge scope가 필요합니다";
	if (scope.kind === "PARENT_DIRECT") {
		return hasExactKeys(scope, ["kind"])
			? { ownerIdCount: 0, canonicalByteCount: 20 }
			: "parent-direct scope에 추가 필드가 있습니다";
	}
	if (scope.kind !== "PARTICIPANT_EFFECTIVE" && scope.kind !== "PARENT_AND_PARTICIPANT_EFFECTIVE") {
		return "알 수 없는 edge scope입니다";
	}
	if (!hasExactKeys(scope, ["kind", "participantIndex", "directOwnerOrganizationIds"])) {
		return "participant scope 필드가 V1 계약과 정확히 일치하지 않습니다";
	}
	if (
		!Number.isSafeInteger(scope.participantIndex) ||
		scope.participantIndex < 0 ||
		scope.participantIndex >= participantCount
	) {
		return "scope participant index가 관계 참여자 범위를 벗어났습니다";
	}
	if (
		!Array.isArray(scope.directOwnerOrganizationIds) ||
		scope.directOwnerOrganizationIds.length === 0 ||
		scope.directOwnerOrganizationIds.length >
			STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_DIRECT_OWNER_IDS_PER_SCOPE ||
		!isSortedUniquePositiveInt32Array(scope.directOwnerOrganizationIds)
	) {
		return "scope 직접 소유자 ID는 1-64개의 중복 없는 양의 ID 오름차순이어야 합니다";
	}
	if (
		requireImmutable &&
		!scope.directOwnerOrganizationIds.every((_, index) =>
			hasDataArrayItem(scope.directOwnerOrganizationIds, index),
		)
	)
		return "소유 조직 배열은 data property여야 합니다";
	return {
		ownerIdCount: scope.directOwnerOrganizationIds.length,
		canonicalByteCount: 28 + scope.directOwnerOrganizationIds.length * 4,
	};
}

interface ResolvedIncidence {
	readonly source: StaticFabAssemblySeamIncidenceV1;
	readonly edge: DirectedRailEdge;
	readonly scope: StaticFabAssemblyRelationshipEdgeScopeV1;
}

interface SeamShapeResult {
	readonly junction: Cell;
	readonly incidences: readonly ResolvedIncidence[];
	readonly edgeReferenceCount: number;
	readonly ownerIdCount: number;
	readonly canonicalByteCount: number;
}

function validateSeamShape(
	seam: StaticFabAssemblySeamContactV1,
	exclusiveCutEdges: readonly StaticFabAssemblyScopedEdgeV1[],
	legExclusiveKeys: ReadonlySet<string>,
	participantCount: number,
	seenParticipantIndexes: Set<number>,
	requireImmutable = false,
): SeamShapeResult | string {
	if (requireImmutable && (!Object.isFrozen(seam) || !isFrozenRelationshipArray(seam?.incidences)))
		return "seam contact는 불변이어야 합니다";
	if (
		!seam ||
		typeof seam !== "object" ||
		!hasExactKeys(seam, ["role", "incidences"]) ||
		!Array.isArray(seam.incidences)
	) {
		return "seam contact가 유효하지 않습니다";
	}
	if (seam.incidences.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD) {
		return "seam incidence 목록이 관계별 edge 참조 한도를 초과했습니다";
	}
	const expected =
		seam.role === "BRANCH"
			? { incoming: 1, outgoing: 2 }
			: seam.role === "MERGE"
				? { incoming: 2, outgoing: 1 }
				: seam.role === "CONTACT"
					? { incoming: 1, outgoing: 1 }
					: null;
	if (!expected) return "알 수 없는 seam 역할입니다";
	if (seam.incidences.length !== expected.incoming + expected.outgoing) {
		return `${seam.role} incidence 수가 완전하지 않습니다`;
	}
	const resolved: ResolvedIncidence[] = [];
	let incoming = 0;
	let outgoing = 0;
	let edgeReferenceCount = 0;
	let ownerIdCount = 0;
	let canonicalByteCount = 8;
	let previous: ResolvedIncidence | null = null;
	const physicalIncidences = new Set<string>();
	const regionIdentities = new Set<string>();
	let includesParent = false;
	let includesParticipant = false;
	let junction: Cell | null = null;
	for (let index = 0; index < seam.incidences.length; index++) {
		if (requireImmutable && !hasDataArrayItem(seam.incidences, index))
			return "조립 관계 배열은 data property여야 합니다";
		const incidence = seam.incidences[index] as StaticFabAssemblySeamIncidenceV1;
		if (
			!incidence ||
			typeof incidence !== "object" ||
			!hasExactKeys(incidence, ["incidence", "binding"])
		)
			return `incidence ${index}가 유효하지 않습니다`;
		if (requireImmutable && (!Object.isFrozen(incidence) || !Object.isFrozen(incidence.binding)))
			return "seam incidence는 불변이어야 합니다";
		if (incidence.incidence === "INCOMING") incoming++;
		else if (incidence.incidence === "OUTGOING") outgoing++;
		else return `incidence ${index}: 알 수 없는 방향입니다`;
		let scoped: StaticFabAssemblyScopedEdgeV1;
		if (incidence.binding?.kind === "EXCLUSIVE_CUT_EDGE") {
			if (!hasExactKeys(incidence.binding, ["kind", "exclusiveCutEdgeIndex"])) {
				return `incidence ${index}: exclusive binding에 추가 필드가 있습니다`;
			}
			const edgeIndex = incidence.binding.exclusiveCutEdgeIndex;
			if (
				!Number.isSafeInteger(edgeIndex) ||
				edgeIndex < 0 ||
				edgeIndex >= exclusiveCutEdges.length
			) {
				return `incidence ${index}: exclusive edge index가 유효하지 않습니다`;
			}
			scoped = exclusiveCutEdges[edgeIndex] as StaticFabAssemblyScopedEdgeV1;
			edgeReferenceCount++;
			canonicalByteCount += 12;
		} else if (incidence.binding?.kind === "WITNESS") {
			if (!hasExactKeys(incidence.binding, ["kind", "scopedEdge"])) {
				return `incidence ${index}: witness binding에 추가 필드가 있습니다`;
			}
			scoped = incidence.binding.scopedEdge;
			const scopedResult = validateScopedEdgeShape(scoped, participantCount, requireImmutable);
			if (typeof scopedResult === "string") return `incidence ${index}: ${scopedResult}`;
			if (legExclusiveKeys.has(staticFabOrganizationEdgeKey(scoped.edge))) {
				return `incidence ${index}: 독립 witness는 leg removal set 밖에 있어야 합니다`;
			}
			edgeReferenceCount++;
			ownerIdCount += scopedResult.ownerIdCount;
			canonicalByteCount += 8 + scopedResult.canonicalByteCount;
		} else {
			return `incidence ${index}: 알 수 없는 binding입니다`;
		}
		const resolvedIncidence = { source: incidence, edge: scoped.edge, scope: scoped.scope };
		const derivedJunction = incidence.incidence === "INCOMING" ? scoped.edge.to : scoped.edge.from;
		if (junction && !cellsEqual(junction, derivedJunction)) {
			return "모든 seam incidence는 하나의 junction에서 만나야 합니다";
		}
		junction = derivedJunction;
		const physicalKey = `${incidence.incidence}:${staticFabOrganizationEdgeKey(scoped.edge)}`;
		if (physicalIncidences.has(physicalKey)) return "seam incidence가 중복되었습니다";
		physicalIncidences.add(physicalKey);
		if (previous && compareResolvedIncidence(previous, resolvedIncidence) >= 0) {
			return "seam incidence는 중복 없이 canonical 순서여야 합니다";
		}
		previous = resolvedIncidence;
		resolved.push(resolvedIncidence);
		for (const region of scopeRegionIdentities(scoped.scope)) regionIdentities.add(region);
		if (scopeIncludesParent(scoped.scope)) includesParent = true;
		const participantIndex = scopeParticipantIndex(scoped.scope);
		if (participantIndex !== null) {
			seenParticipantIndexes.add(participantIndex);
			includesParticipant = true;
		}
	}
	if (incoming !== expected.incoming || outgoing !== expected.outgoing) {
		return `${seam.role} incidence 수가 완전하지 않습니다`;
	}
	if (!junction || regionIdentities.size < 2 || !includesParent || !includesParticipant) {
		return "seam은 서로 다른 parent/participant scope region을 함께 식별해야 합니다";
	}
	return {
		junction,
		incidences: resolved,
		edgeReferenceCount,
		ownerIdCount,
		canonicalByteCount,
	};
}

function* collectRelationshipScopedEdgeKeySteps(
	state: StaticFabAssemblyRelationshipStateV1,
): Generator<void, ReadonlySet<string>> {
	const keys = new Set<string>();
	for (const record of state.records) {
		yield;
		for (const group of record.connectionGroups) {
			yield;
			for (const leg of group.legs) {
				yield;
				for (const scoped of leg.exclusiveCutEdges) {
					yield;
					keys.add(staticFabOrganizationEdgeKey(scoped.edge));
				}
				for (const endpoint of leg.endpointSupports) {
					yield;
					keys.add(staticFabOrganizationEdgeKey(endpoint.support.edge));
				}
				for (const seam of leg.seamContacts) {
					yield;
					for (const incidence of seam.incidences) {
						yield;
						if (incidence.binding.kind === "WITNESS") {
							keys.add(staticFabOrganizationEdgeKey(incidence.binding.scopedEdge.edge));
						}
					}
				}
			}
		}
	}
	return keys;
}

export function staticFabAssemblyRelationshipStateSourceError(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	state: StaticFabAssemblyRelationshipStateV1,
	providedOwnership?: RailModuleOwnershipIndex,
): string | null {
	const shapeError = staticFabAssemblyRelationshipStateShapeError(state);
	if (shapeError) return shapeError;
	// An empty relationship domain has no cross-source claims. Organization validity belongs to
	// its own gate; repeating that whole-map proof here blocks otherwise cooperative startup.
	if (state.records.length === 0) return null;
	if (providedOwnership && !railModuleOwnershipIndexMatchesMap(providedOwnership, map)) {
		return "조립 관계 Rail module 소유권 인덱스가 현재 맵 generation과 일치하지 않습니다";
	}
	const organizationRailError = staticFabOrganizationRailStateError(map, organizations, {
		ownership: providedOwnership,
	});
	if (organizationRailError) return `정적 FAB 조직 Rail: ${organizationRailError}`;

	return completeCooperativeSteps(
		relationshipStateSourceSteps(
			map,
			organizations,
			state,
			providedOwnership ?? staticFabOrganizationRailOwnershipIndex(map),
		),
	);
}

/** Check relationship semantics only after the exact organization and ownership generations passed. */
export function* validateStaticFabAssemblyRelationshipSourceSteps(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	state: StaticFabAssemblyRelationshipStateV1,
	ownership: RailModuleOwnershipIndex,
	organizationActivation: ValidatedStaticFabOrganizationActivation,
): Generator<void, string | null> {
	assertStaticFabOrganizationActivation(organizationActivation, map, portEquipment, organizations);
	if (!isCanonicalStaticFabAssemblyRelationshipState(state)) {
		throw new Error("조립 관계 활성화에는 canonical 관계 generation이 필요합니다");
	}
	if (!railModuleOwnershipIndexMatchesMap(ownership, map)) {
		throw new Error("조립 관계 소유권 인덱스가 현재 맵 generation과 일치하지 않습니다");
	}
	if (state.records.length === 0) return null;
	const budgetError = yield* staticFabOrganizationRailStateBudgetSteps(organizations);
	if (budgetError) return `정적 FAB 조직 Rail: ${budgetError}`;
	return yield* relationshipStateSourceSteps(map, organizations, state, ownership);
}

function* relationshipStateSourceSteps(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	state: StaticFabAssemblyRelationshipStateV1,
	ownership: RailModuleOwnershipIndex,
): Generator<void, string | null> {
	if (state.records.length === 0) return null;
	const recordsById = new Map<number, StaticFabOrganizationRecord>();
	for (const record of organizations.records) {
		yield;
		recordsById.set(record.id, record);
	}

	const roles = yield* deriveStaticFabOrganizationSemanticRoleSteps(organizations);
	const ancestryCache = new Map<string, boolean>();
	let ancestrySteps = 0;
	const isInParticipantRegion = function* (
		participantId: number,
		ownerId: number,
	): Generator<void, boolean | null> {
		const pairKey = `${participantId}:${ownerId}`;
		const cached = ancestryCache.get(pairKey);
		if (cached !== undefined) return cached;
		const pending = [ownerId];
		const queued = new Set([ownerId]);
		const visited = new Set<number>();
		for (let offset = 0; offset < pending.length; offset++) {
			yield;
			const currentId = pending[offset] as number;
			if (currentId === participantId) {
				ancestryCache.set(pairKey, true);
				return true;
			}
			if (visited.has(currentId)) continue;
			visited.add(currentId);
			ancestrySteps++;
			if (ancestrySteps > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_SOURCE_ANCESTRY_STEPS) {
				return null;
			}
			const current = recordsById.get(currentId);
			if (current) {
				for (const parentId of staticFabOrganizationParentIds(current)) {
					yield;
					if (visited.has(parentId) || queued.has(parentId)) continue;
					queued.add(parentId);
					pending.push(parentId);
				}
			}
		}
		ancestryCache.set(pairKey, false);
		return false;
	};
	const referencedEdgeKeys = yield* collectRelationshipScopedEdgeKeySteps(state);
	const directOwnersByEdge = new Map<string, number[]>();
	for (const record of organizations.records) {
		yield;
		for (const edge of record.membership.railEdges) {
			yield;
			const key = staticFabOrganizationEdgeKey(edge);
			if (!referencedEdgeKeys.has(key)) continue;
			const owners = directOwnersByEdge.get(key);
			if (owners) owners.push(record.id);
			else directOwnersByEdge.set(key, [record.id]);
		}
	}
	// Organization validation guarantees ascending record IDs, so appended owners are already canonical.

	const exclusiveModuleOwners = new Map<string, string>();
	const modulesByEdge = new Map<string, RailModuleOwnership[]>();
	if (ownership) {
		for (const module of ownership.modules) {
			yield;
			for (const edge of module.eraseEdges) {
				yield;
				const key = staticFabOrganizationEdgeKey(edge);
				if (!referencedEdgeKeys.has(key)) continue;
				const modules = modulesByEdge.get(key);
				if (modules) modules.push(module);
				else modulesByEdge.set(key, [module]);
			}
		}
	}

	for (const relationship of state.records) {
		yield;
		const parent = recordsById.get(relationship.parentOrganizationId);
		if (!parent) return `조립 관계 ${relationship.id}: 부모 조직을 찾을 수 없습니다`;
		const expectedParentRole = relationship.hierarchyRole === "BAY_TO_BANK" ? "BAY_BANK" : "FAB";
		const expectedParticipantRole =
			relationship.hierarchyRole === "BAY_TO_BANK" ? "BAY" : "BAY_BANK";
		if (roles.get(parent.id) !== expectedParentRole) {
			return `조립 관계 ${relationship.id}: 부모 조직의 semantic role이 ${expectedParentRole}이 아닙니다`;
		}
		if (expectedParentRole === "FAB" && staticFabOrganizationParentIds(parent).length !== 0) {
			return `조립 관계 ${relationship.id}: BANK_TO_FAB 부모는 root Fab이어야 합니다`;
		}
		for (const participantId of relationship.participantOrganizationIds) {
			yield;
			const participant = recordsById.get(participantId);
			if (!participant || roles.get(participantId) !== expectedParticipantRole) {
				return `조립 관계 ${relationship.id}: 참여 조직 ${participantId}의 semantic role이 올바르지 않습니다`;
			}
			if (!staticFabOrganizationParentIds(participant).includes(parent.id)) {
				return `조립 관계 ${relationship.id}: 참여 조직 ${participantId}이 현재 부모에 직접 연결되지 않았습니다`;
			}
		}

		for (const group of relationship.connectionGroups) {
			yield;
			const groupKey = `${relationship.id}:${group.ordinal}`;
			const groupExclusiveEdges = new Set<string>();
			const touchedModules = new Map<string, RailModuleOwnership>();
			for (const leg of group.legs) {
				yield;
				for (const scoped of leg.exclusiveCutEdges) {
					yield;
					const edgeKey = staticFabOrganizationEdgeKey(scoped.edge);
					groupExclusiveEdges.add(edgeKey);
					const modules = modulesByEdge.get(edgeKey) ?? [];
					if (modules.length !== 1) {
						return `조립 관계 ${relationship.id}: exclusive edge ${edgeKey}의 Rail module 소유권이 유일하지 않습니다`;
					}
					const module = modules[0] as RailModuleOwnership;
					touchedModules.set(module.key, module);
					const previousOwner = exclusiveModuleOwners.get(module.key);
					if (previousOwner && previousOwner !== groupKey) {
						return `조립 관계 ${relationship.id}: Rail module ${module.key}이 여러 관계/그룹에 걸쳐 있습니다`;
					}
					exclusiveModuleOwners.set(module.key, groupKey);
				}
			}
			for (const module of touchedModules.values()) {
				yield;
				for (const edge of module.eraseEdges) {
					yield;
					if (!groupExclusiveEdges.has(staticFabOrganizationEdgeKey(edge))) {
						return `조립 관계 ${relationship.id}: 그룹 ${group.ordinal}이 Rail module ${module.key} 전체를 포함하지 않습니다`;
					}
				}
			}
			for (const leg of group.legs) {
				yield;
				for (const scoped of leg.exclusiveCutEdges) {
					yield;
					const sourceError = yield* validateScopedEdgeSourceSteps(
						map,
						directOwnersByEdge,
						isInParticipantRegion,
						relationship,
						scoped,
					);
					if (sourceError) return `조립 관계 ${relationship.id}: ${sourceError}`;
				}
				for (const endpoint of leg.endpointSupports) {
					yield;
					const sourceError = yield* validateScopedEdgeSourceSteps(
						map,
						directOwnersByEdge,
						isInParticipantRegion,
						relationship,
						endpoint.support,
					);
					if (sourceError) return `조립 관계 ${relationship.id}: ${sourceError}`;
				}
				for (const seam of leg.seamContacts) {
					yield;
					const resolved = seam.incidences.map((incidence) =>
						resolveIncidence(incidence, leg.exclusiveCutEdges),
					);
					for (const incidence of resolved) {
						yield;
						const sourceError = yield* validateScopedEdgeSourceSteps(
							map,
							directOwnersByEdge,
							isInParticipantRegion,
							relationship,
							{ edge: incidence.edge, scope: incidence.scope },
						);
						if (sourceError) return `조립 관계 ${relationship.id}: ${sourceError}`;
					}
					const junction =
						resolved[0]?.source.incidence === "INCOMING"
							? resolved[0].edge.to
							: resolved[0]?.edge.from;
					if (!junction || !sameIncidenceSet(resolved, currentJunctionIncidences(map, junction))) {
						return `조립 관계 ${relationship.id}: ${seam.role} seam이 현재 Rail junction 전체 incidence와 일치하지 않습니다`;
					}
				}
			}
		}
	}

	// A higher connection may witness a lower connection's cut. Its own cut can never serve as
	// retained support. Revisit references after collecting every exclusive owner; this keeps the
	// complete dependency check cooperative without retaining a second per-witness object graph.
	for (const relationship of state.records) {
		yield;
		for (const group of relationship.connectionGroups) {
			yield;
			for (const leg of group.legs) {
				yield;
				for (const endpoint of leg.endpointSupports) {
					yield;
					const error = yield* witnessModuleSourceSteps(
						endpoint.support.edge,
						relationship.id,
						modulesByEdge,
						exclusiveModuleOwners,
					);
					if (error) return error;
				}
				for (const seam of leg.seamContacts) {
					yield;
					for (const incidence of seam.incidences) {
						yield;
						if (incidence.binding.kind !== "WITNESS") continue;
						const error = yield* witnessModuleSourceSteps(
							incidence.binding.scopedEdge.edge,
							relationship.id,
							modulesByEdge,
							exclusiveModuleOwners,
						);
						if (error) return error;
					}
				}
			}
		}
	}
	return null;
}

function* witnessModuleSourceSteps(
	edge: DirectedRailEdge,
	relationshipId: number,
	modulesByEdge: ReadonlyMap<string, readonly RailModuleOwnership[]>,
	exclusiveModuleOwners: ReadonlyMap<string, string>,
): Generator<void, string | null> {
	const key = staticFabOrganizationEdgeKey(edge);
	const modules = modulesByEdge.get(key) ?? [];
	if (modules.length === 0)
		return `조립 관계 witness ${key}을 현재 Rail module에서 찾을 수 없습니다`;
	const relationshipPrefix = `${relationshipId}:`;
	for (const module of modules) {
		yield;
		if (exclusiveModuleOwners.get(module.key)?.startsWith(relationshipPrefix)) {
			return `조립 관계 witness ${key}가 같은 관계의 exclusive Rail module 안에 있습니다`;
		}
	}
	return null;
}

export function assertStaticFabAssemblyRelationshipStateSource(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	state: StaticFabAssemblyRelationshipStateV1,
	providedOwnership?: RailModuleOwnershipIndex,
): void {
	const error = staticFabAssemblyRelationshipStateSourceError(
		map,
		organizations,
		state,
		providedOwnership,
	);
	if (error) throw new Error(error);
}

function* validateScopedEdgeSourceSteps(
	map: TileMap,
	directOwnersByEdge: ReadonlyMap<string, readonly number[]>,
	isInParticipantRegion: (
		participantId: number,
		ownerId: number,
	) => Generator<void, boolean | null>,
	relationship: StaticFabAssemblyRelationshipRecordV1,
	scoped: StaticFabAssemblyScopedEdgeV1,
): Generator<void, string | null> {
	const key = staticFabOrganizationEdgeKey(scoped.edge);
	if (!directedRailEdgeExists(map, scoped.edge))
		return `scoped edge ${key}을 현재 Rail에서 찾을 수 없습니다`;
	const owners = directOwnersByEdge.get(key) ?? [];
	if (scoped.scope.kind === "PARENT_DIRECT") {
		return numberArrayEquals(owners, [relationship.parentOrganizationId])
			? null
			: `scoped edge ${key}의 parent-direct 소유자가 정확하지 않습니다`;
	}
	if (!numberArrayEquals(owners, scoped.scope.directOwnerOrganizationIds)) {
		return `scoped edge ${key}의 직접 소유자 집합이 변경되었습니다`;
	}
	const participantId = relationship.participantOrganizationIds[scoped.scope.participantIndex];
	if (participantId === undefined)
		return `scoped edge ${key}의 participant index가 유효하지 않습니다`;
	const ownerRegionResults: Array<boolean | null> = [];
	for (const ownerId of owners) {
		yield;
		ownerRegionResults.push(yield* isInParticipantRegion(participantId, ownerId));
	}
	if (ownerRegionResults.some((result) => result === null)) {
		return `scoped edge ${key}의 participant subtree 검증 예산을 초과했습니다`;
	}
	if (scoped.scope.kind === "PARTICIPANT_EFFECTIVE") {
		return ownerRegionResults.every((result) => result === true)
			? null
			: `scoped edge ${key}의 소유자가 participant subtree 밖에 있습니다`;
	}
	if (
		!owners.includes(relationship.parentOrganizationId) ||
		!ownerRegionResults.some((result) => result === true) ||
		owners.some(
			(ownerId, index) =>
				ownerId !== relationship.parentOrganizationId && ownerRegionResults[index] !== true,
		)
	) {
		return `scoped edge ${key}이 parent와 participant subtree의 정확한 공유 소유권이 아닙니다`;
	}
	return null;
}

function currentJunctionIncidences(map: TileMap, junction: Cell): readonly DirectedRailEdge[] {
	const incidences: DirectedRailEdge[] = [];
	for (const direction of ALL_DIRECTIONS) {
		const adjacent = moveCell(junction, direction);
		const incoming = { from: adjacent, to: junction };
		if (directedRailEdgeExists(map, incoming)) incidences.push(incoming);
		const outgoing = { from: junction, to: adjacent };
		if (directedRailEdgeExists(map, outgoing)) incidences.push(outgoing);
	}
	return incidences.sort(compareDirectedRailEdges);
}

function sameIncidenceSet(
	resolved: readonly ResolvedIncidence[],
	current: readonly DirectedRailEdge[],
): boolean {
	if (resolved.length !== current.length) return false;
	const resolvedKeys = resolved
		.map((incidence) => staticFabOrganizationEdgeKey(incidence.edge))
		.sort();
	const currentKeys = current.map(staticFabOrganizationEdgeKey).sort();
	return resolvedKeys.every((key, index) => key === currentKeys[index]);
}

export function checksumStaticFabAssemblyRelationshipState(
	state: StaticFabAssemblyRelationshipStateV1,
): string {
	const error = staticFabAssemblyRelationshipStateShapeError(state);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addCachedString("STATIC_FAB_ASSEMBLY_RELATIONSHIP_STATE_V1");
	checksum.addNumbers([state.nextRelationshipId, state.records.length]);
	for (const record of state.records) addRecordToChecksum(checksum, record);
	return checksum.digest();
}

export function checksumStaticFabAssemblyRelationshipRecord(
	record: StaticFabAssemblyRelationshipRecordV1,
): string {
	return completeCooperativeSteps(relationshipRecordChecksumSteps(record, false));
}

/** Cooperative hashing requires immutable input because callers can yield between references. */
export function* checksumStaticFabAssemblyRelationshipRecordSteps(
	record: StaticFabAssemblyRelationshipRecordV1,
): Generator<void, string> {
	return yield* relationshipRecordChecksumSteps(record, true);
}

function* relationshipRecordChecksumSteps(
	record: StaticFabAssemblyRelationshipRecordV1,
	requireImmutable: boolean,
): Generator<void, string> {
	const result = yield* validateRecordShapeSteps(
		record,
		new Set<string>(),
		new Set<string>(),
		requireImmutable,
	);
	if (typeof result === "string") throw new Error(`조립 관계 ${record?.id ?? "?"}: ${result}`);
	const checksum = new OrderedTypedChecksum();
	checksum.addCachedString("STATIC_FAB_ASSEMBLY_RELATIONSHIP_RECORD_V1");
	yield* addRecordToChecksumSteps(checksum, record);
	return checksum.digest();
}

/** Exact packed V1 accounting used to reject construction before nested copies are allocated. */
export function staticFabAssemblyRelationshipCanonicalByteLength(
	state: StaticFabAssemblyRelationshipStateV1,
): number {
	const error = staticFabAssemblyRelationshipStateShapeError(state);
	if (error) throw new Error(error);
	let bytes = 8;
	for (const record of state.records) {
		bytes +=
			32 +
			record.participantOrganizationIds.length * 4 +
			record.managedChildOrganizationIds.length * 4;
		for (const group of record.connectionGroups) {
			bytes += 8;
			for (const leg of group.legs) {
				bytes += 20;
				for (const scoped of leg.exclusiveCutEdges) bytes += scopedEdgeCanonicalByteLength(scoped);
				for (const endpoint of leg.endpointSupports) {
					bytes += 8 + scopedEdgeCanonicalByteLength(endpoint.support);
				}
				for (const seam of leg.seamContacts) {
					bytes += 8;
					for (const incidence of seam.incidences) {
						bytes +=
							incidence.binding.kind === "EXCLUSIVE_CUT_EDGE"
								? 12
								: 8 + scopedEdgeCanonicalByteLength(incidence.binding.scopedEdge);
					}
				}
			}
		}
	}
	return bytes;
}

function scopedEdgeCanonicalByteLength(scoped: StaticFabAssemblyScopedEdgeV1): number {
	return scoped.scope.kind === "PARENT_DIRECT"
		? 20
		: 28 + scoped.scope.directOwnerOrganizationIds.length * 4;
}

export function staticFabAssemblyRelationshipStateEquals(
	left: StaticFabAssemblyRelationshipStateV1,
	right: StaticFabAssemblyRelationshipStateV1,
): boolean {
	if (left === right) return true;
	if (
		left.nextRelationshipId !== right.nextRelationshipId ||
		left.records.length !== right.records.length
	) {
		return false;
	}
	return left.records.every((record, index) => recordEquals(record, right.records[index]));
}

export function staticFabAssemblyRelationshipRecordEquals(
	left: StaticFabAssemblyRelationshipRecordV1 | null | undefined,
	right: StaticFabAssemblyRelationshipRecordV1 | null | undefined,
): boolean {
	if (!left || !right) return left == null && right == null;
	return recordEquals(left, right);
}

function addRecordToChecksum(
	checksum: OrderedTypedChecksum,
	record: StaticFabAssemblyRelationshipRecordV1,
): void {
	completeCooperativeSteps(addRecordToChecksumSteps(checksum, record));
}

function* addRecordToChecksumSteps(
	checksum: OrderedTypedChecksum,
	record: StaticFabAssemblyRelationshipRecordV1,
): Generator<void> {
	checksum.addNumbers([
		record.id,
		record.parentOrganizationId,
		record.participantOrganizationIds.length,
		...record.participantOrganizationIds,
		record.managedChildOrganizationIds.length,
		...record.managedChildOrganizationIds,
		record.connectionGroups.length,
	]);
	checksum.addCachedStrings([record.hierarchyRole, record.purpose, record.reviewPolicy]);
	for (const group of record.connectionGroups) {
		yield;
		checksum.addNumbers([group.ordinal, group.legs.length]);
		for (const leg of group.legs) {
			yield;
			checksum.addNumbers([
				leg.ordinal,
				leg.exclusiveCutEdges.length,
				leg.endpointSupports.length,
				leg.seamContacts.length,
			]);
			checksum.addCachedString(leg.directionRole);
			for (const scoped of leg.exclusiveCutEdges) {
				yield;
				addScopedEdgeToChecksum(checksum, scoped);
			}
			for (const endpoint of leg.endpointSupports) {
				yield;
				checksum.addNumbers([endpoint.adjacentExclusiveCutEdgeIndex]);
				checksum.addCachedString(endpoint.position);
				addScopedEdgeToChecksum(checksum, endpoint.support);
			}
			for (const seam of leg.seamContacts) {
				yield;
				checksum.addCachedString(seam.role);
				checksum.addNumbers([seam.incidences.length]);
				for (const incidence of seam.incidences) {
					yield;
					checksum.addCachedStrings([incidence.incidence, incidence.binding.kind]);
					if (incidence.binding.kind === "EXCLUSIVE_CUT_EDGE") {
						checksum.addNumbers([incidence.binding.exclusiveCutEdgeIndex]);
					} else {
						addScopedEdgeToChecksum(checksum, incidence.binding.scopedEdge);
					}
				}
			}
		}
	}
}

function addScopedEdgeToChecksum(
	checksum: OrderedTypedChecksum,
	scoped: StaticFabAssemblyScopedEdgeV1,
): void {
	checksum.addNumbers([scoped.edge.from.x, scoped.edge.from.y, scoped.edge.to.x, scoped.edge.to.y]);
	checksum.addCachedString(scoped.scope.kind);
	if (scoped.scope.kind !== "PARENT_DIRECT") {
		checksum.addNumbers([
			scoped.scope.participantIndex,
			scoped.scope.directOwnerOrganizationIds.length,
			...scoped.scope.directOwnerOrganizationIds,
		]);
	}
}

function copyRecord(
	record: StaticFabAssemblyRelationshipRecordV1,
): StaticFabAssemblyRelationshipRecordV1 {
	return Object.freeze({
		id: record.id,
		hierarchyRole: record.hierarchyRole,
		purpose: record.purpose,
		parentOrganizationId: record.parentOrganizationId,
		participantOrganizationIds: Object.freeze([...record.participantOrganizationIds]) as
			| readonly [number]
			| readonly [number, number],
		managedChildOrganizationIds: Object.freeze([...record.managedChildOrganizationIds]),
		reviewPolicy: record.reviewPolicy,
		connectionGroups: Object.freeze(
			record.connectionGroups.map((group) =>
				Object.freeze({
					ordinal: group.ordinal,
					legs: Object.freeze(group.legs.map(copyLeg)),
				}),
			),
		),
	});
}

function copyLeg(leg: StaticFabAssemblyRelationshipLegV1): StaticFabAssemblyRelationshipLegV1 {
	return Object.freeze({
		ordinal: leg.ordinal,
		directionRole: leg.directionRole,
		exclusiveCutEdges: Object.freeze(leg.exclusiveCutEdges.map(copyScopedEdge)),
		endpointSupports: Object.freeze(leg.endpointSupports.map(copyEndpointSupport)),
		seamContacts: Object.freeze(leg.seamContacts.map(copySeamContact)),
	});
}

function copyEndpointSupport(
	endpoint: StaticFabAssemblyEndpointSupportV1,
): StaticFabAssemblyEndpointSupportV1 {
	return Object.freeze({
		support: copyScopedEdge(endpoint.support),
		adjacentExclusiveCutEdgeIndex: endpoint.adjacentExclusiveCutEdgeIndex,
		position: endpoint.position,
	});
}

function copySeamContact(seam: StaticFabAssemblySeamContactV1): StaticFabAssemblySeamContactV1 {
	return Object.freeze({
		role: seam.role,
		incidences: Object.freeze(seam.incidences.map(copySeamIncidence)),
	});
}

function copySeamIncidence(
	incidence: StaticFabAssemblySeamIncidenceV1,
): StaticFabAssemblySeamIncidenceV1 {
	return Object.freeze({
		incidence: incidence.incidence,
		binding:
			incidence.binding.kind === "EXCLUSIVE_CUT_EDGE"
				? Object.freeze({
						kind: incidence.binding.kind,
						exclusiveCutEdgeIndex: incidence.binding.exclusiveCutEdgeIndex,
					})
				: Object.freeze({
						kind: incidence.binding.kind,
						scopedEdge: copyScopedEdge(incidence.binding.scopedEdge),
					}),
	});
}

function copyScopedEdge(scoped: StaticFabAssemblyScopedEdgeV1): StaticFabAssemblyScopedEdgeV1 {
	const scope =
		scoped.scope.kind === "PARENT_DIRECT"
			? Object.freeze({ kind: scoped.scope.kind })
			: Object.freeze({
					kind: scoped.scope.kind,
					participantIndex: scoped.scope.participantIndex,
					directOwnerOrganizationIds: Object.freeze([...scoped.scope.directOwnerOrganizationIds]),
				});
	return Object.freeze({
		edge: Object.freeze({
			from: Object.freeze({ x: scoped.edge.from.x, y: scoped.edge.from.y }),
			to: Object.freeze({ x: scoped.edge.to.x, y: scoped.edge.to.y }),
		}),
		scope,
	});
}

function recordEquals(
	left: StaticFabAssemblyRelationshipRecordV1,
	right: StaticFabAssemblyRelationshipRecordV1 | undefined,
): boolean {
	if (!right) return false;
	return (
		left.id === right.id &&
		left.hierarchyRole === right.hierarchyRole &&
		left.purpose === right.purpose &&
		left.parentOrganizationId === right.parentOrganizationId &&
		numberArrayEquals(left.participantOrganizationIds, right.participantOrganizationIds) &&
		numberArrayEquals(left.managedChildOrganizationIds, right.managedChildOrganizationIds) &&
		left.reviewPolicy === right.reviewPolicy &&
		left.connectionGroups.length === right.connectionGroups.length &&
		left.connectionGroups.every((group, groupIndex) => {
			const otherGroup = right.connectionGroups[groupIndex];
			return (
				otherGroup !== undefined &&
				group.ordinal === otherGroup.ordinal &&
				group.legs.length === otherGroup.legs.length &&
				group.legs.every((leg, legIndex) => legEquals(leg, otherGroup.legs[legIndex]))
			);
		})
	);
}

function legEquals(
	left: StaticFabAssemblyRelationshipLegV1,
	right: StaticFabAssemblyRelationshipLegV1 | undefined,
): boolean {
	return (
		right !== undefined &&
		left.ordinal === right.ordinal &&
		left.directionRole === right.directionRole &&
		scopedEdgeArrayEquals(left.exclusiveCutEdges, right.exclusiveCutEdges) &&
		left.endpointSupports.length === right.endpointSupports.length &&
		left.endpointSupports.every((endpoint, index) => {
			const other = right.endpointSupports[index];
			return (
				other !== undefined &&
				endpoint.adjacentExclusiveCutEdgeIndex === other.adjacentExclusiveCutEdgeIndex &&
				endpoint.position === other.position &&
				scopedEdgeEquals(endpoint.support, other.support)
			);
		}) &&
		left.seamContacts.length === right.seamContacts.length &&
		left.seamContacts.every((seam, index) => seamEquals(seam, right.seamContacts[index]))
	);
}

function seamEquals(
	left: StaticFabAssemblySeamContactV1,
	right: StaticFabAssemblySeamContactV1 | undefined,
): boolean {
	return (
		right !== undefined &&
		left.role === right.role &&
		left.incidences.length === right.incidences.length &&
		left.incidences.every((incidence, index) => {
			const other = right.incidences[index];
			if (
				!other ||
				incidence.incidence !== other.incidence ||
				incidence.binding.kind !== other.binding.kind
			) {
				return false;
			}
			return incidence.binding.kind === "EXCLUSIVE_CUT_EDGE" &&
				other.binding.kind === "EXCLUSIVE_CUT_EDGE"
				? incidence.binding.exclusiveCutEdgeIndex === other.binding.exclusiveCutEdgeIndex
				: incidence.binding.kind === "WITNESS" &&
						other.binding.kind === "WITNESS" &&
						scopedEdgeEquals(incidence.binding.scopedEdge, other.binding.scopedEdge);
		})
	);
}

function scopedEdgeArrayEquals(
	left: readonly StaticFabAssemblyScopedEdgeV1[],
	right: readonly StaticFabAssemblyScopedEdgeV1[],
): boolean {
	return (
		left.length === right.length &&
		left.every((scoped, index) => scopedEdgeEquals(scoped, right[index]))
	);
}

function scopedEdgeEquals(
	left: StaticFabAssemblyScopedEdgeV1,
	right: StaticFabAssemblyScopedEdgeV1 | undefined,
): boolean {
	if (
		!right ||
		compareDirectedRailEdges(left.edge, right.edge) !== 0 ||
		left.scope.kind !== right.scope.kind
	) {
		return false;
	}
	if (left.scope.kind === "PARENT_DIRECT" || right.scope.kind === "PARENT_DIRECT") return true;
	return (
		left.scope.participantIndex === right.scope.participantIndex &&
		numberArrayEquals(left.scope.directOwnerOrganizationIds, right.scope.directOwnerOrganizationIds)
	);
}

function readTransitionFootprintLimit(
	value: number | undefined,
	maximum: number,
	label: string,
): number {
	const resolved = value ?? maximum;
	if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum) {
		throw new Error(`조립 관계 transition ${label} 한도는 0-${maximum} 범위여야 합니다`);
	}
	return resolved;
}

function compareEndpointSupport(
	left: StaticFabAssemblyEndpointSupportV1,
	right: StaticFabAssemblyEndpointSupportV1,
): number {
	return (
		left.adjacentExclusiveCutEdgeIndex - right.adjacentExclusiveCutEdgeIndex ||
		positionRank(left.position) - positionRank(right.position) ||
		compareScopedEdges(left.support, right.support)
	);
}

function compareSeamContact(
	left: StaticFabAssemblySeamContactV1,
	right: StaticFabAssemblySeamContactV1,
	exclusive: readonly StaticFabAssemblyScopedEdgeV1[],
): number {
	const leftResolved = resolveIncidence(
		left.incidences[0] as StaticFabAssemblySeamIncidenceV1,
		exclusive,
	);
	const rightResolved = resolveIncidence(
		right.incidences[0] as StaticFabAssemblySeamIncidenceV1,
		exclusive,
	);
	const leftJunction =
		leftResolved.source.incidence === "INCOMING" ? leftResolved.edge.to : leftResolved.edge.from;
	const rightJunction =
		rightResolved.source.incidence === "INCOMING" ? rightResolved.edge.to : rightResolved.edge.from;
	return (
		leftJunction.x - rightJunction.x ||
		leftJunction.y - rightJunction.y ||
		seamRoleRank(left.role) - seamRoleRank(right.role) ||
		compareIncidenceArrays(left.incidences, right.incidences, exclusive)
	);
}

function compareIncidenceArrays(
	left: readonly StaticFabAssemblySeamIncidenceV1[],
	right: readonly StaticFabAssemblySeamIncidenceV1[],
	exclusive: readonly StaticFabAssemblyScopedEdgeV1[],
): number {
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const compared = compareResolvedIncidence(
			resolveIncidence(left[index] as StaticFabAssemblySeamIncidenceV1, exclusive),
			resolveIncidence(right[index] as StaticFabAssemblySeamIncidenceV1, exclusive),
		);
		if (compared !== 0) return compared;
	}
	return left.length - right.length;
}

function compareResolvedIncidence(left: ResolvedIncidence, right: ResolvedIncidence): number {
	return (
		incidenceRank(left.source.incidence) - incidenceRank(right.source.incidence) ||
		compareDirectedRailEdges(left.edge, right.edge) ||
		bindingRank(left.source.binding.kind) - bindingRank(right.source.binding.kind) ||
		bindingIndex(left.source) - bindingIndex(right.source) ||
		compareScopes(left.scope, right.scope)
	);
}

function compareScopedEdges(
	left: StaticFabAssemblyScopedEdgeV1,
	right: StaticFabAssemblyScopedEdgeV1,
): number {
	return compareDirectedRailEdges(left.edge, right.edge) || compareScopes(left.scope, right.scope);
}

function compareScopes(
	left: StaticFabAssemblyRelationshipEdgeScopeV1,
	right: StaticFabAssemblyRelationshipEdgeScopeV1,
): number {
	const kind = scopeRank(left.kind) - scopeRank(right.kind);
	if (kind !== 0) return kind;
	if (left.kind === "PARENT_DIRECT" || right.kind === "PARENT_DIRECT") return 0;
	return (
		left.participantIndex - right.participantIndex ||
		compareNumberArrays(left.directOwnerOrganizationIds, right.directOwnerOrganizationIds)
	);
}

function resolveIncidence(
	incidence: StaticFabAssemblySeamIncidenceV1,
	exclusive: readonly StaticFabAssemblyScopedEdgeV1[],
): ResolvedIncidence {
	const scoped =
		incidence.binding.kind === "EXCLUSIVE_CUT_EDGE"
			? (exclusive[incidence.binding.exclusiveCutEdgeIndex] as StaticFabAssemblyScopedEdgeV1)
			: incidence.binding.scopedEdge;
	return { source: incidence, edge: scoped.edge, scope: scoped.scope };
}

function seamIncludesParentAndParticipant(
	incidences: readonly ResolvedIncidence[],
	participantIndex: number,
): boolean {
	return (
		incidences.some((incidence) => scopeIncludesParent(incidence.scope)) &&
		incidences.some((incidence) => scopeParticipantIndex(incidence.scope) === participantIndex)
	);
}

function scopeIncludesParent(scope: StaticFabAssemblyRelationshipEdgeScopeV1): boolean {
	return scope.kind === "PARENT_DIRECT" || scope.kind === "PARENT_AND_PARTICIPANT_EFFECTIVE";
}

function scopeParticipantIndex(scope: StaticFabAssemblyRelationshipEdgeScopeV1): number | null {
	return scope.kind === "PARENT_DIRECT" ? null : scope.participantIndex;
}

function scopeRegionIdentities(scope: StaticFabAssemblyRelationshipEdgeScopeV1): readonly string[] {
	if (scope.kind === "PARENT_DIRECT") return ["PARENT_DIRECT"];
	if (scope.kind === "PARTICIPANT_EFFECTIVE")
		return [`PARTICIPANT_EFFECTIVE:${scope.participantIndex}`];
	return [`PARENT_AND_PARTICIPANT_EFFECTIVE:${scope.participantIndex}`];
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

function isDirectedRailEdge(edge: DirectedRailEdge): boolean {
	return (
		edge !== null &&
		typeof edge === "object" &&
		hasExactKeys(edge, ["from", "to"]) &&
		edge.from !== null &&
		typeof edge.from === "object" &&
		hasExactKeys(edge.from, ["x", "y"]) &&
		edge.to !== null &&
		typeof edge.to === "object" &&
		hasExactKeys(edge.to, ["x", "y"]) &&
		isInt32(edge.from?.x) &&
		isInt32(edge.from?.y) &&
		isInt32(edge.to?.x) &&
		isInt32(edge.to?.y) &&
		directionBetween(edge.from, edge.to) !== null
	);
}

function hasExactKeys(value: object, expectedKeys: readonly string[]): boolean {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const actualKeys = Reflect.ownKeys(value);
	return (
		actualKeys.length === expectedKeys.length &&
		expectedKeys.every((key) =>
			Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
		)
	);
}

function isDirectionRole(value: string): value is StaticFabAssemblyRelationshipDirectionRole {
	return (
		value === "OUTBOUND" || value === "RETURN" || value === "ATTACHMENT" || value === "CONTACT"
	);
}

function isSortedUniquePositiveInt32Array(values: readonly number[]): boolean {
	let previous = 0;
	for (const value of values) {
		if (!isPositiveInt32(value) || value <= previous) return false;
		previous = value;
	}
	return true;
}

function numberArrayEquals(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const compared = (left[index] as number) - (right[index] as number);
		if (compared !== 0) return compared;
	}
	return left.length - right.length;
}

function cellsEqual(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647;
}

function isPositiveInt32(value: number): boolean {
	return isInt32(value) && value > 0;
}

function positionRank(value: StaticFabAssemblyEndpointSupportV1["position"]): number {
	return value === "PREDECESSOR" ? 0 : 1;
}

function scopeRank(value: StaticFabAssemblyRelationshipEdgeScopeV1["kind"]): number {
	return value === "PARENT_DIRECT" ? 0 : value === "PARTICIPANT_EFFECTIVE" ? 1 : 2;
}

function seamRoleRank(value: StaticFabAssemblySeamContactV1["role"]): number {
	return value === "BRANCH" ? 0 : value === "MERGE" ? 1 : 2;
}

function incidenceRank(value: StaticFabAssemblySeamIncidenceV1["incidence"]): number {
	return value === "INCOMING" ? 0 : 1;
}

function bindingRank(value: StaticFabAssemblySeamIncidenceV1["binding"]["kind"]): number {
	return value === "EXCLUSIVE_CUT_EDGE" ? 0 : 1;
}

function bindingIndex(incidence: StaticFabAssemblySeamIncidenceV1): number {
	return incidence.binding.kind === "EXCLUSIVE_CUT_EDGE"
		? incidence.binding.exclusiveCutEdgeIndex
		: -1;
}

function brandCanonicalRelationshipState(
	state: StaticFabAssemblyRelationshipStateV1,
): StaticFabAssemblyRelationshipStateV1 {
	canonicalRelationshipStates.add(state);
	return state;
}

function hasDataArrayItem(values: readonly unknown[], index: number): boolean {
	return Object.hasOwn(Object.getOwnPropertyDescriptor(values, index) ?? {}, "value");
}

function isFrozenRelationshipArray(value: unknown): boolean {
	if (
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype ||
		!Object.isFrozen(value)
	)
		return false;
	// The canonical graph is consumed using normal Array iteration and lookup methods.
	return [
		Symbol.iterator,
		"map",
		"some",
		"every",
		"includes",
		"find",
		"forEach",
		"filter",
		"slice",
		"at",
		"toJSON",
	].every((key) => !Object.hasOwn(value, key));
}
