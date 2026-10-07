import type { StaticFabAssemblyRelationshipRecordV1 } from "../core/StaticFabAssemblyRelationship";
import {
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";

export interface StaticFabBankStructureSupport {
	readonly state: "ready" | "blocked";
	readonly reason: string;
	readonly supportNotice?: "non-detachable-bank";
}

/** Structural review eligibility only; live command guards and certified Apply remain separate. */
export function staticFabBankStructureSupport(
	operation: "detach" | "delete",
	bank: StaticFabOrganizationRecord,
	semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	records: readonly StaticFabAssemblyRelationshipRecordV1[],
): StaticFabBankStructureSupport {
	const action = operation === "detach" ? "분리" : "삭제";
	const blocked = (reason: string): StaticFabBankStructureSupport => ({ state: "blocked", reason });
	const parents = staticFabOrganizationParentIds(bank);
	if (operation === "detach") {
		if (parents.length !== 1 || semanticRoles.get(parents[0] as number) !== "FAB") {
			return blocked("하나의 FAB에 속한 Bank만 분리할 수 있습니다");
		}
	} else {
		if (
			parents.length > 1 ||
			(parents.length === 1 && semanticRoles.get(parents[0] as number) !== "FAB")
		) {
			return blocked("독립 Bank 또는 하나의 FAB에 속한 Bank만 삭제할 수 있습니다");
		}
		if (parents.length === 0) {
			return { state: "ready", reason: "독점 소유한 Bank 하위 구성의 삭제 범위를 검토합니다" };
		}
	}
	const relationships = records.filter((record) =>
		record.managedChildOrganizationIds.includes(bank.id),
	);
	if (relationships.length === 0) return blocked("이 Bank를 추가한 명시적 연결 관계가 없습니다");
	const relationship = relationships[0];
	if (
		relationships.length !== 1 ||
		!relationship ||
		relationship.managedChildOrganizationIds.length !== 1
	) {
		return blocked(`다른 Bank와 소속 관계를 공유하여 단독 ${action}할 수 없습니다`);
	}
	if (
		relationship.parentOrganizationId !== parents[0] ||
		relationship.hierarchyRole !== "BANK_TO_FAB" ||
		relationship.purpose !== "HIERARCHY_LINK"
	) {
		return blocked(`이 연결 관계는 현재 Bank ${action} 범위에 해당하지 않습니다`);
	}
	if (relationship.reviewPolicy === "AUTHORING_NON_DETACHABLE") {
		return {
			state: "blocked",
			reason: `이 구성의 Bank 연결은 개별 ${action}를 지원하지 않습니다`,
			supportNotice: "non-detachable-bank",
		};
	}
	if (relationship.reviewPolicy !== "REVIEW_REQUIRED") {
		return blocked(`이 연결 관계는 현재 Bank ${action} 범위에 해당하지 않습니다`);
	}
	return {
		state: "ready",
		reason:
			operation === "detach"
				? "Bank 내부 구성을 보존하고 FAB 연결 제거를 검토합니다"
				: "FAB 연결과 Bank 하위 구성의 삭제 범위를 함께 검토합니다",
	};
}
