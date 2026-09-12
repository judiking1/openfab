import { completeCooperativeSteps } from "./CooperativeTask";
import {
	isCanonicalStaticFabAssemblyRelationshipState,
	remapStaticFabAssemblyRelationshipRecordSteps,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
} from "./StaticFabAssemblyRelationship";
import {
	isCanonicalStaticFabOrganizationState,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import type { Cell } from "./TileMap";

/** Exact authored membership translations, never rendering bounds or inferred proximity. */
export interface StaticFabAssemblyRelocationTranslations {
	readonly railEdges: ReadonlyMap<string, Cell>;
	readonly advancedSwitches: ReadonlyMap<number, Cell>;
	readonly equipmentGroups: ReadonlyMap<number, Cell>;
}

export type StaticFabAssemblyRelationshipRelocationResult =
	| {
			readonly valid: true;
			readonly mutations: readonly StaticFabAssemblyRelationshipMutationV1[];
			readonly nextRelationshipId: number;
	  }
	| {
			readonly valid: false;
			readonly relationshipId: number;
			readonly code: "PARTIAL_RELATIONSHIP" | "INCOMPATIBLE_RELATIONSHIP_TRANSFORMS";
			readonly reason: string;
			readonly mutations: readonly [];
	  };

const ZERO: Cell = Object.freeze({ x: 0, y: 0 });
const PARTIAL = Symbol("partly stationary relationship");
const SPLIT = Symbol("incompatible authored translations");
type Motion = Cell | typeof PARTIAL | typeof SPLIT | null;

export function planStaticFabAssemblyRelationshipRelocation(
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	translations: StaticFabAssemblyRelocationTranslations,
): StaticFabAssemblyRelationshipRelocationResult {
	return completeCooperativeSteps(
		planStaticFabAssemblyRelationshipRelocationSteps(organizations, relationships, translations),
	);
}

/**
 * Caller owns stable translation maps and source-generation cancellation while advancing steps.
 * This proves movement closure only; prospective map/organization/relationship validation and
 * one-shot command certification remain mandatory before publication.
 */
export function* planStaticFabAssemblyRelationshipRelocationSteps(
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	translations: StaticFabAssemblyRelocationTranslations,
): Generator<void, StaticFabAssemblyRelationshipRelocationResult> {
	if (
		!isCanonicalStaticFabOrganizationState(organizations) ||
		!isCanonicalStaticFabAssemblyRelationshipState(relationships)
	) {
		throw new Error("관계 이동은 검증된 불변 조직·관계 상태가 필요합니다");
	}
	if (relationships.records.length === 0) return success([], relationships.nextRelationshipId);
	for (const values of [
		translations.railEdges.values(),
		translations.advancedSwitches.values(),
		translations.equipmentGroups.values(),
	]) {
		for (const delta of values) {
			yield;
			if (
				!Number.isInteger(delta.x) ||
				!Number.isInteger(delta.y) ||
				delta.x < -2_147_483_648 ||
				delta.x > 2_147_483_647 ||
				delta.y < -2_147_483_648 ||
				delta.y > 2_147_483_647
			) {
				throw new Error("관계 이동량은 signed-int32 정수 셀이어야 합니다");
			}
		}
	}
	const direct = new Map<number, Motion>();
	const children = new Map<number, number[]>();
	const ids = new Map<number, number>();
	for (const record of organizations.records) {
		yield;
		ids.set(record.id, record.id);
		let motion: Motion = null;
		for (const edge of record.membership.railEdges) {
			yield;
			motion = merge(
				motion,
				translations.railEdges.get(staticFabOrganizationEdgeKey(edge)) ?? ZERO,
			);
		}
		for (const id of record.membership.advancedSwitchIds) {
			yield;
			motion = merge(motion, translations.advancedSwitches.get(id) ?? ZERO);
		}
		for (const id of record.membership.equipmentGroupIds) {
			yield;
			motion = merge(motion, translations.equipmentGroups.get(id) ?? ZERO);
		}
		direct.set(record.id, motion);
		for (const parentId of staticFabOrganizationParentIds(record)) {
			yield;
			const siblings = children.get(parentId);
			if (siblings) siblings.push(record.id);
			else children.set(parentId, [record.id]);
		}
	}
	const effective = new Map<number, Motion>();
	const visiting = new Set<number>();
	for (const id of ids.keys()) {
		const pending = [{ id, exit: false }];
		while (pending.length) {
			yield;
			const current = pending.pop();
			if (!current || effective.has(current.id)) continue;
			if (!direct.has(current.id)) throw new Error("관계 이동 조직이 원본에 없습니다");
			if (current.exit) {
				let motion = direct.get(current.id) ?? null;
				for (const child of children.get(current.id) ?? []) {
					yield;
					motion = merge(motion, effective.get(child) ?? null);
				}
				effective.set(current.id, motion);
				visiting.delete(current.id);
			} else {
				if (visiting.has(current.id)) throw new Error("관계 이동 조직 계층에 순환이 있습니다");
				visiting.add(current.id);
				pending.push({ id: current.id, exit: true });
				for (const child of children.get(current.id) ?? []) {
					yield;
					if (!effective.has(child)) pending.push({ id: child, exit: false });
				}
			}
		}
	}
	const mutations: StaticFabAssemblyRelationshipMutationV1[] = [];
	for (const record of relationships.records) {
		yield;
		const collected: { motion: Motion } = { motion: null };
		const includeOrganization = (id: number): void => {
			if (!effective.has(id)) throw new Error(`관계 ${record.id}의 조직 ${id}가 없습니다`);
			collected.motion = merge(collected.motion, effective.get(id) ?? null);
		};
		includeOrganization(record.parentOrganizationId);
		for (const id of record.participantOrganizationIds) {
			yield;
			includeOrganization(id);
		}
		for (const id of record.managedChildOrganizationIds) {
			yield;
			includeOrganization(id);
		}
		function* includeEdge(scoped: StaticFabAssemblyScopedEdgeV1): Generator<void> {
			yield;
			collected.motion = merge(
				collected.motion,
				translations.railEdges.get(staticFabOrganizationEdgeKey(scoped.edge)) ?? ZERO,
			);
			if (scoped.scope.kind !== "PARENT_DIRECT") {
				for (const id of scoped.scope.directOwnerOrganizationIds) {
					yield;
					includeOrganization(id);
				}
			}
		}
		for (const group of record.connectionGroups) {
			yield;
			for (const leg of group.legs) {
				yield;
				for (const edge of leg.exclusiveCutEdges) yield* includeEdge(edge);
				for (const support of leg.endpointSupports) yield* includeEdge(support.support);
				for (const contact of leg.seamContacts) {
					yield;
					for (const incidence of contact.incidences) {
						yield;
						if (incidence.binding.kind === "WITNESS")
							yield* includeEdge(incidence.binding.scopedEdge);
					}
				}
			}
		}
		const motion = collected.motion;
		if (motion === PARTIAL || motion === SPLIT)
			return Object.freeze({
				valid: false,
				relationshipId: record.id,
				code: motion === PARTIAL ? "PARTIAL_RELATIONSHIP" : "INCOMPATIBLE_RELATIONSHIP_TRANSFORMS",
				reason:
					motion === PARTIAL
						? `관계 ${record.id}의 일부 구조가 이동하지 않습니다 · 상위 조직과 하위 구조 전체를 함께 선택하세요`
						: `관계 ${record.id}의 연결 구조가 서로 다른 위치로 이동합니다 · 상위 조직 전체를 함께 선택하세요`,
				mutations: Object.freeze([] as const),
			});
		if (!motion || (motion.x === 0 && motion.y === 0)) continue;
		const after = yield* remapStaticFabAssemblyRelationshipRecordSteps(record, {
			relationshipId: record.id,
			organizationIds: ids,
			quarterTurns: 0,
			offset: motion,
		});
		mutations.push(Object.freeze({ id: record.id, before: record, after }));
	}
	return success(mutations, relationships.nextRelationshipId);
}

function merge(a: Motion, b: Motion): Motion {
	if (a === PARTIAL || b === PARTIAL) return PARTIAL;
	if (!a) return b;
	if (!b) return a;
	if (a === SPLIT || b === SPLIT) {
		const other = a === SPLIT ? b : a;
		return other !== SPLIT && other.x === 0 && other.y === 0 ? PARTIAL : SPLIT;
	}
	if (a.x === b.x && a.y === b.y) return a;
	return (a.x === 0 && a.y === 0) || (b.x === 0 && b.y === 0) ? PARTIAL : SPLIT;
}

function success(
	mutations: StaticFabAssemblyRelationshipMutationV1[],
	nextRelationshipId: number,
): StaticFabAssemblyRelationshipRelocationResult {
	return Object.freeze({ valid: true, mutations: Object.freeze(mutations), nextRelationshipId });
}
