import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import { staticFabBayFlowEditHierarchyEligibility } from "../core/StaticFabBayFlowEdit";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import { staticFabSemanticBayConnectionEligibility } from "../core/StaticFabSemanticBayMutation";
import type { TileMap } from "../core/TileMap";

export interface StaticFabBayStructureSupport {
	readonly state: "ready" | "blocked";
	readonly reason: string;
	readonly detail: string | null;
}

/** Entry guidance only. The live command and Worker still certify the requested flow. */
export function staticFabBayStructureSupport(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bayId: number,
): StaticFabBayStructureSupport {
	const hierarchy = staticFabBayFlowEditHierarchyEligibility(organizations, bayId);
	if (!hierarchy.valid) {
		return {
			state: "blocked",
			reason: "현재 Bay 구성 · 흐름 변경 미지원",
			detail: "공유 소속이 없는 2-Loop Bay에서 흐름을 변경할 수 있습니다.",
		};
	}
	const connection = staticFabSemanticBayConnectionEligibility(
		map,
		organizations,
		relationships,
		bayId,
	);
	if (!connection.valid) {
		return {
			state: "blocked",
			reason:
				connection.issueCode === "RELATIONSHIP_NOT_DETACHABLE"
					? "고정된 연결 구조 · 흐름 변경 미지원"
					: connection.issueCode === "AMBIGUOUS_CONNECTOR"
						? "연결 경로가 불명확해 흐름 변경 미지원"
						: "현재 연결 구조 · 흐름 변경 미지원",
			detail:
				connection.issueCode === "RELATIONSHIP_NOT_DETACHABLE"
					? "이 구성은 Bay 연결을 고정해 개별 흐름 변경을 지원하지 않습니다."
					: "Bay당 왕복 연결 한 쌍인 구조에서 흐름 변경을 검토할 수 있습니다.",
		};
	}
	return { state: "ready", reason: "현재 구조의 흐름 변경을 검토합니다", detail: null };
}
