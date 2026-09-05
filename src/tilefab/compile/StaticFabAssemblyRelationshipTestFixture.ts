import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { ALL_DIRECTIONS, directionBetween, moveCell, oppositeDirection } from "../core/railShape";
import type {
	StaticFabAssemblyRelationshipStateV1,
	StaticFabAssemblyScopedEdgeV1,
} from "../core/StaticFabAssemblyRelationship";
import {
	compareDirectedRailEdges,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { decodeRailCell, type TileMap } from "../core/TileMap";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

/** Test-only Contact evidence over OpenFab's independently generated Production 60 geometry.
 * This fixture is not a product producer and must never infer relationship identity on load.
 */
export function productionBankContactFixture(): {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
} {
	const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("production-fab-60"));
	const map = build.document.map;
	const organizations = build.document.organizations;
	const fab = organizations.records.find(
		(record) => record.kind === "AREA" && (record.parentOrganizationIds?.length ?? 0) === 0,
	);
	const bank = organizations.records.find(
		(record) => record.kind === "AREA" && record.parentOrganizationIds?.includes(fab?.id ?? -1),
	);
	if (!fab || !bank) throw new Error("expected Production 60 Fab and Bank");
	const participantRegion = new Set([
		bank.id,
		...(resolveStaticFabOrganizationDescendantIds(organizations, bank.id) ?? []),
	]);
	const ownersByEdge = new Map<string, number[]>();
	for (const record of organizations.records) {
		for (const railEdge of record.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(railEdge);
			const owners = ownersByEdge.get(key);
			if (owners) owners.push(record.id);
			else ownersByEdge.set(key, [record.id]);
		}
	}
	for (const owners of ownersByEdge.values()) owners.sort((left, right) => left - right);

	const seams: Array<{
		readonly junction: { readonly x: number; readonly y: number };
		readonly seam: ReturnType<typeof productionContactSeam>;
	}> = [];
	map.forEachRail((x, y) => {
		const junction = { x, y };
		const incidences: Array<{
			readonly incidence: "INCOMING" | "OUTGOING";
			readonly scoped: StaticFabAssemblyScopedEdgeV1;
		}> = [];
		for (const direction of ALL_DIRECTIONS) {
			const adjacent = moveCell(junction, direction);
			for (const candidate of [
				{ incidence: "INCOMING" as const, edge: { from: adjacent, to: junction } },
				{ incidence: "OUTGOING" as const, edge: { from: junction, to: adjacent } },
			]) {
				if (!testDirectedRailEdgeExists(map, candidate.edge)) continue;
				const owners = ownersByEdge.get(staticFabOrganizationEdgeKey(candidate.edge)) ?? [];
				const scoped =
					owners.length === 1 && owners[0] === fab.id
						? parentScoped(candidate.edge)
						: owners.length > 0 && owners.every((ownerId) => participantRegion.has(ownerId))
							? participantScoped(candidate.edge, 0, owners)
							: null;
				if (!scoped) continue;
				incidences.push({ incidence: candidate.incidence, scoped });
			}
		}
		const incoming = incidences.filter((incidence) => incidence.incidence === "INCOMING").length;
		const outgoing = incidences.length - incoming;
		const role =
			incoming === 1 && outgoing === 2
				? "BRANCH"
				: incoming === 2 && outgoing === 1
					? "MERGE"
					: null;
		if (
			role &&
			incidences.length === 3 &&
			incidences.some((incidence) => incidence.scoped.scope.kind === "PARENT_DIRECT") &&
			incidences.some((incidence) => incidence.scoped.scope.kind === "PARTICIPANT_EFFECTIVE")
		) {
			incidences.sort((left, right) =>
				left.incidence === right.incidence
					? compareDirectedRailEdges(left.scoped.edge, right.scoped.edge)
					: left.incidence === "INCOMING"
						? -1
						: 1,
			);
			seams.push({ junction, seam: productionContactSeam(role, incidences) });
		}
	});
	seams.sort(
		(left, right) => left.junction.x - right.junction.x || left.junction.y - right.junction.y,
	);
	if (seams.length !== 2)
		throw new Error(`expected two Production Bank seams, received ${seams.length}`);
	const relationships: StaticFabAssemblyRelationshipStateV1 = {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BANK_TO_FAB",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: fab.id,
				participantOrganizationIds: [bank.id],
				managedChildOrganizationIds: [bank.id],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
								seamContacts: seams.map(({ seam }) => seam),
							},
						],
					},
				],
			},
		],
	};
	return {
		map,
		portEquipment: build.document.portEquipment,
		organizations,
		relationships,
	};
}

function productionContactSeam(
	role: "BRANCH" | "MERGE",
	incidences: readonly {
		readonly incidence: "INCOMING" | "OUTGOING";
		readonly scoped: StaticFabAssemblyScopedEdgeV1;
	}[],
) {
	return {
		role,
		incidences: incidences.map(({ incidence, scoped }) => witness(incidence, scoped)),
	};
}

function testDirectedRailEdgeExists(map: TileMap, railEdge: DirectedRailEdge): boolean {
	const direction = directionBetween(railEdge.from, railEdge.to);
	if (direction === null) return false;
	const source = decodeRailCell(map.getEncoded(railEdge.from.x, railEdge.from.y));
	const target = decodeRailCell(map.getEncoded(railEdge.to.x, railEdge.to.y));
	return (
		(source.outgoing & direction) !== 0 && (target.incoming & oppositeDirection(direction)) !== 0
	);
}

function parentScoped(edge: DirectedRailEdge): StaticFabAssemblyScopedEdgeV1 {
	return { edge, scope: { kind: "PARENT_DIRECT" } };
}
function participantScoped(
	edge: DirectedRailEdge,
	participantIndex: 0 | 1,
	directOwnerOrganizationIds: readonly number[],
): StaticFabAssemblyScopedEdgeV1 {
	return {
		edge,
		scope: { kind: "PARTICIPANT_EFFECTIVE", participantIndex, directOwnerOrganizationIds },
	};
}
function witness(incidence: "INCOMING" | "OUTGOING", scopedEdge: StaticFabAssemblyScopedEdgeV1) {
	return { incidence, binding: { kind: "WITNESS" as const, scopedEdge } };
}
