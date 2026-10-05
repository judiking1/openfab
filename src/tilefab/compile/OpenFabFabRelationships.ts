import { describeStaticFabAssemblyRelationshipLeg } from "../core/StaticFabAssemblyConnectorRelationshipDescriptor";
import {
	copyStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "../core/StaticFabAssemblyRelationship";
import type { TileMap } from "../core/TileMap";
import type { OpenFabFabAssemblyPlan } from "./OpenFabFabAssemblyPlan";
import {
	type CertifiedOpenFabFabOrganizations,
	OPENFAB_FAB_ORGANIZATION_ROOT_KEY,
} from "./OpenFabFabOrganizationCompiler";

/** Declare only the exact gateway operations of this new composition, never infer legacy links. */
export function describeOpenFabFabRelationships(
	map: TileMap,
	plan: OpenFabFabAssemblyPlan,
	organizations: CertifiedOpenFabFabOrganizations,
): StaticFabAssemblyRelationshipStateV1 {
	const compilation = organizations.compilation;
	const ids = new Map(
		compilation.organizationKeys.map((key, index) => [
			key,
			compilation.organizations.records[index]?.id,
		]),
	);
	const parentId = ids.get(OPENFAB_FAB_ORGANIZATION_ROOT_KEY);
	if (parentId === undefined) throw new Error("OpenFab relationship has no declared Fab identity.");
	const records: StaticFabAssemblyRelationshipRecordV1[] = [];
	for (const block of plan.layoutBlocks)
		for (const bank of block.banks) {
			const bankId = ids.get(bank.organizationKey);
			if (bankId === undefined)
				throw new Error("OpenFab relationship has no declared Bank identity.");
			const scoped = (
				edge: StaticFabAssemblyScopedEdgeV1["edge"],
			): StaticFabAssemblyScopedEdgeV1 => {
				const inCollector = bank.closedCollectorRoute.some(
					(cell, index, route) =>
						index > 0 &&
						route[index - 1]?.x === edge.from.x &&
						route[index - 1]?.y === edge.from.y &&
						cell.x === edge.to.x &&
						cell.y === edge.to.y,
				);
				return {
					edge,
					scope: inCollector
						? {
								kind: "PARTICIPANT_EFFECTIVE",
								participantIndex: 0,
								directOwnerOrganizationIds: [bankId],
							}
						: { kind: "PARENT_DIRECT" },
				};
			};
			records.push({
				id: records.length + 1,
				hierarchyRole: "BANK_TO_FAB",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: parentId,
				participantOrganizationIds: [bankId],
				managedChildOrganizationIds: [bankId],
				reviewPolicy: "REVIEW_REQUIRED",
				connectionGroups: [
					{
						ordinal: 0,
						legs: bank.parentGateway.connections.map((connection, ordinal) =>
							describeStaticFabAssemblyRelationshipLeg(
								map,
								connection.ownedDirectedEdges,
								ordinal,
								scoped,
								"ATTACHMENT",
							),
						),
					},
				],
			});
		}
	const relationships = copyStaticFabAssemblyRelationshipState({
		nextRelationshipId: records.length + 1,
		records,
	});
	const error = staticFabAssemblyRelationshipStateSourceError(
		map,
		compilation.organizations,
		relationships,
	);
	if (error) throw new Error(`OpenFab declared Bank attachment is invalid: ${error}`);
	return relationships;
}
