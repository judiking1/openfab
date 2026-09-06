import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell, oppositeDirection } from "./railShape";
import {
	type StaticFabAssemblyConnectorPlanningResult,
	staticFabAssemblyConnectorAddedDirectedEdges,
} from "./StaticFabAssemblyConnector";
import {
	copyStaticFabAssemblyRelationshipRecord,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
	type StaticFabAssemblyEndpointSupportV1,
	type StaticFabAssemblyRelationshipLegV1,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyScopedEdgeV1,
	type StaticFabAssemblySeamContactV1,
	type StaticFabAssemblySeamIncidenceV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	compareDirectedRailEdges,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import { type Cell, cellKey, decodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_ASSEMBLY_CONNECTOR_RELATIONSHIP_DESCRIPTOR_VERSION = 1 as const;

export interface StaticFabAssemblyConnectorRelationshipDescriptor {
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_RELATIONSHIP_DESCRIPTOR_VERSION;
	readonly record: StaticFabAssemblyRelationshipRecordV1;
}

/** Describe an explicit accepted Connector. This is identity evidence, never a commit or removal permit. */
export function describeStaticFabAssemblyConnectorRelationship(
	sourceOrganizations: StaticFabOrganizationState,
	planning: StaticFabAssemblyConnectorPlanningResult,
	relationshipId: number,
): StaticFabAssemblyConnectorRelationshipDescriptor {
	const { plan, prospectiveState: final } = planning;
	const metadata = plan.assemblyConnector;
	if (
		!plan.valid ||
		!final ||
		!metadata.hierarchyRole ||
		!metadata.purpose ||
		metadata.issueCode !== null
	)
		throw new Error("유효한 Assembly Connector의 완성 상태가 필요합니다");
	if (!Number.isInteger(relationshipId) || relationshipId < 1 || relationshipId >= 2_147_483_647)
		throw new Error("조립 관계 ID를 안전하게 할당할 수 없습니다");
	if (
		plan.nextOrganizationIdBefore !== sourceOrganizations.nextOrganizationId ||
		plan.nextOrganizationIdAfter !== final.organizations.nextOrganizationId
	)
		throw new Error("Connector 조직 generation이 일치하지 않습니다");
	if (plan.mutations.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD)
		throw new Error("Connector 관계 경로 예산을 초과했습니다");
	const parentId =
		metadata.hierarchyRole === "BAY_TO_BANK"
			? metadata.bankOrganizationId
			: metadata.fabOrganizationId;
	if (parentId === null) throw new Error("Connector 부모 조직을 찾을 수 없습니다");
	const participants = [metadata.sourceOrganizationId, metadata.targetOrganizationId] as const;
	const sourceParticipants = participants.map((id) => {
		const record = sourceOrganizations.records.find((candidate) => candidate.id === id);
		if (!record) throw new Error("Connector 참여 조직이 원본에 없습니다");
		return record;
	});
	const managed = sourceParticipants
		.filter((record) => !staticFabOrganizationParentIds(record).includes(parentId))
		.map((record) => record.id)
		.sort((a, b) => a - b);
	if (metadata.purpose === "FAB_LOOP" && managed.length !== 0)
		throw new Error("Fab Loop가 기존 계층에 속하지 않습니다");
	const ownership = buildRailModuleOwnershipIndex(final.map);
	const addedEdges = staticFabAssemblyConnectorAddedDirectedEdges(plan);
	if (addedEdges.length === 0) throw new Error("Connector에 새 레일이 없습니다");
	const addedKeys = new Set(addedEdges.map(staticFabOrganizationEdgeKey));
	const seedModules = new Map<string, RailModuleOwnership[]>();
	for (const module of ownership.modules)
		for (const edge of module.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (!addedKeys.has(key)) continue;
			const candidates = seedModules.get(key);
			if (candidates) candidates.push(module);
			else seedModules.set(key, [module]);
		}
	const consumedSeeds = new Set<string>();
	const walks = [plan.networkLink.outboundCells, plan.networkLink.returnCells].map((path) =>
		expandedConnectorWalk(path, addedKeys, seedModules, consumedSeeds),
	);
	if (consumedSeeds.size !== addedKeys.size)
		throw new Error("Connector의 모든 새 레일이 명시된 왕복 경로에 포함되어야 합니다");
	const regions = participants.map(
		(id) =>
			new Set([id, ...(resolveStaticFabOrganizationDescendantIds(final.organizations, id) ?? [])]),
	);
	const owners = new Map<string, number[]>();
	const referencedKeys = new Set<string>();
	for (const walk of walks) {
		for (const edge of walk) referencedKeys.add(staticFabOrganizationEdgeKey(edge));
		for (const junction of connectorWalkEndpoints(walk))
			for (const incidence of junctionIncidences(final.map, junction))
				referencedKeys.add(staticFabOrganizationEdgeKey(incidence.edge));
	}
	for (const record of final.organizations.records)
		for (const edge of record.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (!referencedKeys.has(key)) continue;
			const ids = owners.get(key);
			if (ids) ids.push(record.id);
			else owners.set(key, [record.id]);
		}
	const scoped = (edge: DirectedRailEdge): StaticFabAssemblyScopedEdgeV1 => {
		const ids = [...(owners.get(staticFabOrganizationEdgeKey(edge)) ?? [])].sort((a, b) => a - b);
		if (ids.length === 1 && ids[0] === parentId) return { edge, scope: { kind: "PARENT_DIRECT" } };
		const indexes = regions.flatMap((region, index) =>
			ids.some((id) => id !== parentId && region.has(id)) &&
			ids.every((id) => id === parentId || region.has(id))
				? [index]
				: [],
		);
		if (indexes.length !== 1)
			throw new Error("Connector 레일의 정확한 부모·참여 조직 소유 범위를 확정할 수 없습니다");
		return {
			edge,
			scope: {
				kind: ids.includes(parentId) ? "PARENT_AND_PARTICIPANT_EFFECTIVE" : "PARTICIPANT_EFFECTIVE",
				participantIndex: indexes[0] as 0 | 1,
				directOwnerOrganizationIds: ids,
			},
		};
	};
	const legs = walks.map((walk, ordinal) => connectorLeg(final.map, walk, ordinal, scoped));
	const record: StaticFabAssemblyRelationshipRecordV1 = {
		id: relationshipId,
		hierarchyRole: metadata.hierarchyRole,
		purpose: metadata.purpose,
		parentOrganizationId: parentId,
		participantOrganizationIds: participants,
		managedChildOrganizationIds: managed,
		reviewPolicy: "REVIEW_REQUIRED",
		connectionGroups: [{ ordinal: 0, legs }],
	};
	const error = staticFabAssemblyRelationshipStateSourceError(
		final.map,
		final.organizations,
		{ nextRelationshipId: relationshipId + 1, records: [record] },
		ownership,
	);
	if (error) throw new Error(error);
	return Object.freeze({
		version: STATIC_FAB_ASSEMBLY_CONNECTOR_RELATIONSHIP_DESCRIPTOR_VERSION,
		record: copyStaticFabAssemblyRelationshipRecord(record),
	});
}

function expandedConnectorWalk(
	path: readonly Cell[],
	addedKeys: ReadonlySet<string>,
	modules: ReadonlyMap<string, readonly RailModuleOwnership[]>,
	consumedSeeds: Set<string>,
): readonly DirectedRailEdge[] {
	if (
		path.length < 2 ||
		path.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD
	)
		throw new Error("Connector leg 경로 길이가 유효하지 않습니다");
	const expanded = new Map<string, DirectedRailEdge>();
	const seeds: string[] = [];
	for (let index = 1; index < path.length; index++) {
		const edge = { from: path[index - 1] as Cell, to: path[index] as Cell };
		if (directionBetween(edge.from, edge.to) === null)
			throw new Error("Connector leg는 연속 단방향 1m 경로여야 합니다");
		const key = staticFabOrganizationEdgeKey(edge);
		if (!addedKeys.has(key)) continue;
		if (consumedSeeds.has(key)) throw new Error("Connector 왕복 leg가 새 레일을 중복 소유합니다");
		consumedSeeds.add(key);
		seeds.push(key);
		const candidates = modules.get(key) ?? [];
		const module = candidates[0];
		if (candidates.length !== 1 || !module)
			throw new Error("Connector 제거 경로의 Rail module 소유권이 유일하지 않습니다");
		for (const owned of module.eraseEdges) {
			expanded.set(staticFabOrganizationEdgeKey(owned), owned);
			if (expanded.size > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD)
				throw new Error("Connector 전체 module 경로 예산을 초과했습니다");
		}
	}
	if (expanded.size === 0) throw new Error("Connector leg에 새 레일이 없습니다");
	const next = new Map<string, DirectedRailEdge>();
	const ends = new Set<string>();
	for (const edge of expanded.values()) {
		const key = cellKey(edge.from.x, edge.from.y);
		if (next.has(key)) throw new Error("Connector 제거 경로가 분기합니다");
		next.set(key, edge);
		ends.add(cellKey(edge.to.x, edge.to.y));
	}
	const heads = [...expanded.values()].filter(
		(edge) => !ends.has(cellKey(edge.from.x, edge.from.y)),
	);
	if (heads.length !== 1) throw new Error("Connector 제거 경로의 시작점이 유일하지 않습니다");
	const ordered: DirectedRailEdge[] = [];
	let current: DirectedRailEdge | undefined = heads[0];
	while (current) {
		if (ordered.length >= expanded.size) throw new Error("Connector 제거 경로가 순환합니다");
		ordered.push(current);
		current = next.get(cellKey(current.to.x, current.to.y));
	}
	if (ordered.length !== expanded.size)
		throw new Error("Connector 전체 module 경로가 끊어져 있습니다");
	const positions = new Map(
		ordered.map((edge, index) => [staticFabOrganizationEdgeKey(edge), index]),
	);
	let previous = -1;
	for (const seed of seeds) {
		const position = positions.get(seed);
		if (position === undefined || position <= previous)
			throw new Error("Connector leg의 명시된 진행 순서가 일치하지 않습니다");
		previous = position;
	}
	return ordered;
}

function connectorLeg(
	map: TileMap,
	walk: readonly DirectedRailEdge[],
	ordinal: number,
	scoped: (edge: DirectedRailEdge) => StaticFabAssemblyScopedEdgeV1,
): StaticFabAssemblyRelationshipLegV1 {
	const exclusive = walk.map(scoped);
	const indices = new Map(walk.map((edge, index) => [staticFabOrganizationEdgeKey(edge), index]));
	const seam = (junction: Cell): StaticFabAssemblySeamContactV1 => {
		const incidences = junctionIncidences(map, junction).map(
			({ incidence, edge }): StaticFabAssemblySeamIncidenceV1 => {
				const index = indices.get(staticFabOrganizationEdgeKey(edge));
				return {
					incidence,
					binding:
						index === undefined
							? { kind: "WITNESS", scopedEdge: scoped(edge) }
							: { kind: "EXCLUSIVE_CUT_EDGE", exclusiveCutEdgeIndex: index },
				};
			},
		);
		const incoming = incidences.filter((value) => value.incidence === "INCOMING").length,
			outgoing = incidences.length - incoming;
		const role =
			incoming === 1 && outgoing === 2
				? "BRANCH"
				: incoming === 2 && outgoing === 1
					? "MERGE"
					: incoming === 1 && outgoing === 1
						? "CONTACT"
						: null;
		if (!role) throw new Error("Connector 경계가 완전한 Rail junction이 아닙니다");
		return { role, incidences };
	};
	const [start, end] = connectorWalkEndpoints(walk);
	const contacts = [
		{ junction: start, seam: seam(start) },
		{ junction: end, seam: seam(end) },
	];
	const supports: StaticFabAssemblyEndpointSupportV1[] = [];
	for (const [index, contact] of contacts.entries())
		for (const incidence of contact.seam.incidences) {
			if (
				incidence.binding.kind === "WITNESS" &&
				incidence.incidence === (index === 0 ? "INCOMING" : "OUTGOING")
			)
				supports.push({
					support: incidence.binding.scopedEdge,
					adjacentExclusiveCutEdgeIndex: index === 0 ? 0 : walk.length - 1,
					position: index === 0 ? "PREDECESSOR" : "SUCCESSOR",
				});
		}
	contacts.sort((a, b) => a.junction.x - b.junction.x || a.junction.y - b.junction.y);
	supports.sort(
		(a, b) =>
			a.adjacentExclusiveCutEdgeIndex - b.adjacentExclusiveCutEdgeIndex ||
			(a.position === b.position ? 0 : a.position === "PREDECESSOR" ? -1 : 1) ||
			compareDirectedRailEdges(a.support.edge, b.support.edge),
	);
	return {
		ordinal,
		directionRole: ordinal === 0 ? "OUTBOUND" : "RETURN",
		exclusiveCutEdges: exclusive,
		endpointSupports: supports,
		seamContacts: contacts.map((value) => value.seam),
	};
}

function junctionIncidences(
	map: TileMap,
	junction: Cell,
): Array<{ incidence: "INCOMING" | "OUTGOING"; edge: DirectedRailEdge }> {
	const incidences: Array<{ incidence: "INCOMING" | "OUTGOING"; edge: DirectedRailEdge }> = [];
	for (const direction of ALL_DIRECTIONS) {
		const adjacent = moveCell(junction, direction);
		for (const candidate of [
			{ incidence: "INCOMING" as const, edge: { from: adjacent, to: junction } },
			{ incidence: "OUTGOING" as const, edge: { from: junction, to: adjacent } },
		]) {
			const travel = candidate.incidence === "OUTGOING" ? direction : oppositeDirection(direction);
			const from = decodeRailCell(map.getEncoded(candidate.edge.from.x, candidate.edge.from.y)),
				to = decodeRailCell(map.getEncoded(candidate.edge.to.x, candidate.edge.to.y));
			if ((from.outgoing & travel) !== 0 && (to.incoming & oppositeDirection(travel)) !== 0)
				incidences.push(candidate);
		}
	}
	return incidences.sort(
		(a, b) =>
			(a.incidence === b.incidence ? 0 : a.incidence === "INCOMING" ? -1 : 1) ||
			compareDirectedRailEdges(a.edge, b.edge),
	);
}

function connectorWalkEndpoints(walk: readonly DirectedRailEdge[]): readonly [Cell, Cell] {
	const first = walk[0],
		last = walk[walk.length - 1];
	if (!first || !last) throw new Error("Connector leg에 제거 경로가 없습니다");
	return [first.from, last.to];
}
