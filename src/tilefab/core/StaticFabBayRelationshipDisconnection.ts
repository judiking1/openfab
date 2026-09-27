import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import {
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
	staticFabAssemblyRelationshipStateShapeError,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	deriveStaticFabOrganizationSemanticRoles,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import type { Cell, TileMap } from "./TileMap";

export type StaticFabBayRelationshipDisconnectionIssue =
	| "INVALID_SOURCE"
	| "AMBIGUOUS_CONNECTOR"
	| "SHARED_ORGANIZATION_DEPENDENCY"
	| "SHARED_CONNECTOR_OWNERSHIP"
	| "RELATIONSHIP_NOT_DETACHABLE";

export type StaticFabBayRelationshipDisconnection =
	| Readonly<{ kind: "absent" }>
	| Readonly<{
			kind: "rejected";
			issueCode: StaticFabBayRelationshipDisconnectionIssue;
			reason: string;
	  }>
	| Readonly<{
			kind: "candidate";
			relationship: StaticFabAssemblyRelationshipRecordV1;
			branchJunction: Cell;
			mergeJunction: Cell;
			outboundEdges: readonly DirectedRailEdge[];
			inboundEdges: readonly DirectedRailEdge[];
			edges: readonly DirectedRailEdge[];
	  }>;

/** Exact authored cut identity only. This never certifies a mutation or grants commit authority. */
export function reviewStaticFabBayRelationshipDisconnection(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	bayId: number,
	maximumCutEdges: number,
): StaticFabBayRelationshipDisconnection {
	const shapeError = staticFabAssemblyRelationshipStateShapeError(relationships);
	if (shapeError)
		return rejected("INVALID_SOURCE", `조립 관계 형식이 유효하지 않습니다 · ${shapeError}`);
	if (relationships.records.length === 0) return Object.freeze({ kind: "absent" });
	const ownership = buildRailModuleOwnershipIndex(map);
	const sourceError = staticFabAssemblyRelationshipStateSourceError(
		map,
		organizations,
		relationships,
		ownership,
	);
	if (sourceError)
		return rejected("INVALID_SOURCE", `조립 관계 원본이 유효하지 않습니다 · ${sourceError}`);
	const subtree = new Set([
		bayId,
		...(resolveStaticFabOrganizationDescendantIds(organizations, bayId) ?? []),
	]);
	const affected = relationships.records.filter((record) => referencesSubtree(record, subtree));
	if (affected.length === 0) return Object.freeze({ kind: "absent" });
	if (affected.length !== 1) {
		return rejected(
			"AMBIGUOUS_CONNECTOR",
			"이 Bay에 여러 조립 관계가 연결되어 있습니다 · 연결 전체의 영향 검토가 필요합니다",
		);
	}
	const record = affected[0] as StaticFabAssemblyRelationshipRecordV1;
	if (record.reviewPolicy !== "REVIEW_REQUIRED") {
		return rejected(
			"RELATIONSHIP_NOT_DETACHABLE",
			"이 조립 관계는 현재 개별 Bay 연결 해제를 지원하지 않습니다",
		);
	}
	if (
		record.managedChildOrganizationIds.length !== 1 ||
		record.managedChildOrganizationIds[0] !== bayId
	) {
		return rejected(
			"SHARED_ORGANIZATION_DEPENDENCY",
			"이 연결은 다른 Bay의 소속도 함께 관리합니다 · 선택한 Bay만 분리할 수 없습니다",
		);
	}
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bank = organizations.records.find(
		(candidate) => candidate.id === record.parentOrganizationId,
	);
	const bankParents = bank ? staticFabOrganizationParentIds(bank) : [];
	const fab =
		bankParents.length === 1
			? organizations.records.find((candidate) => candidate.id === bankParents[0])
			: undefined;
	if (
		!bank ||
		(bankParents.length !== 0 &&
			(!fab || roles.get(fab.id) !== "FAB" || staticFabOrganizationParentIds(fab).length !== 0))
	) {
		return rejected(
			"SHARED_ORGANIZATION_DEPENDENCY",
			"Bank의 상위 소속이 독립 FAB 또는 최상위 Bank가 아닙니다",
		);
	}
	if (
		record.hierarchyRole !== "BAY_TO_BANK" ||
		record.purpose !== "HIERARCHY_LINK" ||
		roles.get(record.parentOrganizationId) !== "BAY_BANK" ||
		record.participantOrganizationIds.length !== 2 ||
		!record.participantOrganizationIds.includes(bayId) ||
		record.participantOrganizationIds.some((id) => {
			const participant = organizations.records.find((candidate) => candidate.id === id);
			return (
				!participant ||
				roles.get(id) !== "BAY" ||
				staticFabOrganizationParentIds(participant).length !== 1 ||
				staticFabOrganizationParentIds(participant)[0] !== record.parentOrganizationId
			);
		}) ||
		record.connectionGroups.length !== 1 ||
		record.connectionGroups[0]?.legs.length !== 2
	) {
		return rejected(
			"AMBIGUOUS_CONNECTOR",
			"현재는 명시적으로 연결한 두 Bay 사이의 단일 왕복 연결만 해제할 수 있습니다",
		);
	}
	const legs = record.connectionGroups[0].legs;
	const outboundRole = record.participantOrganizationIds[0] === bayId ? "OUTBOUND" : "RETURN";
	const outbound = legs.find((leg) => leg.directionRole === outboundRole);
	const inbound = legs.find(
		(leg) => leg.directionRole === (outboundRole === "OUTBOUND" ? "RETURN" : "OUTBOUND"),
	);
	if (!outbound?.exclusiveCutEdges.length || !inbound?.exclusiveCutEdges.length)
		return rejected("INVALID_SOURCE", "왕복 연결 경로가 없습니다");
	const cuts = legs.flatMap((leg) => leg.exclusiveCutEdges);
	if (
		cuts.length === 0 ||
		cuts.length > maximumCutEdges ||
		cuts.some((cut) => cut.scope.kind !== "PARENT_DIRECT")
	) {
		return rejected(
			"SHARED_CONNECTOR_OWNERSHIP",
			"연결의 제거 경로가 지원 범위 안의 Bank 전용 레일이 아닙니다",
		);
	}
	const cutKeys = new Set(cuts.map((cut) => staticFabOrganizationEdgeKey(cut.edge)));
	const cutModuleKeys = new Set<string>();
	const moduleKeysByEdge = new Map<string, string[]>();
	for (const module of ownership.modules) {
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			const keys = moduleKeysByEdge.get(key) ?? [];
			keys.push(module.key);
			moduleKeysByEdge.set(key, keys);
		}
		if (!module.eraseEdges.some((edge) => cutKeys.has(staticFabOrganizationEdgeKey(edge))))
			continue;
		cutModuleKeys.add(module.key);
		if (
			module.advancedSwitchId !== null ||
			module.eraseEdges.some((edge) => !cutKeys.has(staticFabOrganizationEdgeKey(edge)))
		) {
			return rejected(
				"SHARED_CONNECTOR_OWNERSHIP",
				"연결 제거가 공유 레일 또는 분기 부품의 일부를 침범합니다",
			);
		}
	}
	for (const retained of relationships.records) {
		if (retained.id === record.id) continue;
		for (const scoped of scopedEdges(retained)) {
			const key = staticFabOrganizationEdgeKey(scoped.edge);
			if (
				cutKeys.has(key) ||
				moduleKeysByEdge.get(key)?.some((moduleKey) => cutModuleKeys.has(moduleKey))
			) {
				return rejected(
					"SHARED_CONNECTOR_OWNERSHIP",
					"다른 조립 관계가 이 연결의 레일 부품을 참조합니다 · 함께 제거할 수 없습니다",
				);
			}
		}
	}
	const outboundEdges = Object.freeze(outbound.exclusiveCutEdges.map((cut) => cut.edge));
	const inboundEdges = Object.freeze(inbound.exclusiveCutEdges.map((cut) => cut.edge));
	return Object.freeze({
		kind: "candidate",
		relationship: record,
		branchJunction: (outboundEdges[0] as DirectedRailEdge).from,
		mergeJunction: (inboundEdges[inboundEdges.length - 1] as DirectedRailEdge).to,
		outboundEdges,
		inboundEdges,
		edges: Object.freeze([...outboundEdges, ...inboundEdges]),
	});
}

function referencesSubtree(
	record: StaticFabAssemblyRelationshipRecordV1,
	subtree: ReadonlySet<number>,
): boolean {
	if (
		subtree.has(record.parentOrganizationId) ||
		record.participantOrganizationIds.some((id) => subtree.has(id)) ||
		record.managedChildOrganizationIds.some((id) => subtree.has(id))
	)
		return true;
	for (const { scope } of scopedEdges(record)) {
		if (
			scope.kind !== "PARENT_DIRECT" &&
			scope.directOwnerOrganizationIds.some((id) => subtree.has(id))
		)
			return true;
	}
	return false;
}

function* scopedEdges(
	record: StaticFabAssemblyRelationshipRecordV1,
): Generator<StaticFabAssemblyScopedEdgeV1> {
	for (const group of record.connectionGroups)
		for (const leg of group.legs) {
			yield* leg.exclusiveCutEdges;
			for (const support of leg.endpointSupports) yield support.support;
			for (const seam of leg.seamContacts)
				for (const incidence of seam.incidences) {
					if (incidence.binding.kind === "WITNESS") yield incidence.binding.scopedEdge;
				}
		}
}

function rejected(
	issueCode: StaticFabBayRelationshipDisconnectionIssue,
	reason: string,
): StaticFabBayRelationshipDisconnection {
	return Object.freeze({ kind: "rejected", issueCode, reason });
}
