import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import type { ResolvedStaticFabArrangementRoot } from "./StaticFabArrangementRoots";

/** Source-only scope check shared by UI entry and authoritative Worker root resolution. */
export function staticFabTranslationSelectionReason(
	organizations: StaticFabOrganizationState,
	roots: readonly ResolvedStaticFabArrangementRoot[],
	selectedEquipmentGroupIds: readonly number[],
): string | null {
	const root = roots[0];
	if (roots.length !== 1 || root?.kind !== "STATIC_COMPONENT")
		return "서로 연결된 독립 구조 하나를 선택하세요";
	const selected = new Set(selectedEquipmentGroupIds);
	if (
		selected.size !== selectedEquipmentGroupIds.length ||
		selected.size !== root.equipmentGroupIds.length ||
		root.equipmentGroupIds.some((id) => !selected.has(id))
	)
		return "부착 장비가 빠졌습니다 · 연결 구조 전체를 선택하세요";
	const edges = new Set(
		root.selection.rail.ownerships.flatMap((module) =>
			module.eraseEdges.map(staticFabOrganizationEdgeKey),
		),
	);
	const switches = new Set(root.advancedSwitchIds);
	for (const organization of organizations.records) {
		const membership = organization.membership;
		if (
			membership.railEdges.some((edge) => edges.has(staticFabOrganizationEdgeKey(edge))) ||
			membership.advancedSwitchIds.some((id) => switches.has(id)) ||
			membership.equipmentGroupIds.some((id) => selected.has(id))
		)
			return "조직에 소속된 구조입니다 · 이번 이동은 미소속 구조만 지원합니다";
	}
	return null;
}

/** Exact rail-only projection for the existing Worker-only authored/physical closed-loop gate. */
export function staticFabTranslationRailMembership(
	root: ResolvedStaticFabArrangementRoot,
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	for (const module of root.selection.rail.ownerships)
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
	return {
		railEdges: [...edges.values()].sort(compareDirectedRailEdges),
		advancedSwitchIds: root.advancedSwitchIds,
		equipmentGroupIds: [],
	};
}
