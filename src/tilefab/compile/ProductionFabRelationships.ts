import { DIR_S } from "../core/railShape";
import type {
	StaticFabAssemblyRelationshipRecordV1,
	StaticFabAssemblySeamIncidenceV1,
} from "../core/StaticFabAssemblyRelationship";
import type { StaticFabOrganizationKind } from "../core/StaticFabOrganization";
import type { Cell } from "../core/TileMap";
import type { ProductionFabBankPlan } from "./ProductionFabAssemblyPlan";
import { createStaticFabGeneratorRelationshipDescriptor } from "./StaticFabGeneratorRelationshipDescriptor";

export const PRODUCTION_FAB_ORGANIZATION_KEY = "PRODUCTION-FAB";

/**
 * Each collector is authored on the east, southbound side of the declared spine. Its north edge
 * merges westward into the spine; its south edge branches eastward away from it. These six exact
 * incidences come from those two authoring operations, not a search of the completed rail network.
 * The shared spine remains infrastructure and is never an exclusive removal footprint.
 */
export function describeProductionFabRelationships(banks: readonly ProductionFabBankPlan[]) {
	const keys = [PRODUCTION_FAB_ORGANIZATION_KEY, ...banks.map((bank) => bank.id)];
	const records: StaticFabAssemblyRelationshipRecordV1[] = banks.map((bank, index) => {
		if (
			bank.collector.pose.forward !== DIR_S ||
			bank.collector.pose.side !== "left" ||
			bank.collector.pose.flow !== "forward"
		)
			throw new Error("Production relationship requires the declared southbound collector pose.");
		const participant = index + 2;
		const north = bank.collector.origin;
		const south = { x: north.x, y: north.y + bank.collector.lengthMeters };
		return {
			id: index + 1,
			hierarchyRole: "BANK_TO_FAB",
			purpose: "HIERARCHY_LINK",
			parentOrganizationId: 1,
			participantOrganizationIds: [participant],
			managedChildOrganizationIds: [participant],
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
							seamContacts: [
								{
									role: "MERGE",
									incidences: [
										incidence("INCOMING", { x: north.x, y: north.y - 1 }, north),
										incidence("INCOMING", { x: north.x + 1, y: north.y }, north, participant),
										incidence("OUTGOING", north, { x: north.x, y: north.y + 1 }),
									],
								},
								{
									role: "BRANCH",
									incidences: [
										incidence("INCOMING", { x: south.x, y: south.y - 1 }, south),
										incidence("OUTGOING", south, { x: south.x, y: south.y + 1 }),
										incidence("OUTGOING", south, { x: south.x + 1, y: south.y }, participant),
									],
								},
							],
						},
					],
				},
			],
		};
	});
	return createStaticFabGeneratorRelationshipDescriptor(keys, records);
}

/** The exact authoring order used to allocate the final organization records. */
export function productionFabOrganizationKeys(banks: readonly ProductionFabBankPlan[]) {
	return Object.freeze(productionFabOrganizationIdentities(banks).map((identity) => identity.key));
}

export interface ProductionFabOrganizationIdentity {
	readonly key: string;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly parentKey: string | null;
}

/** Admission checks this declared identity, never inferring a seed key from a received name. */
export function productionFabOrganizationIdentities(banks: readonly ProductionFabBankPlan[]) {
	const identities: ProductionFabOrganizationIdentity[] = [
		{
			key: PRODUCTION_FAB_ORGANIZATION_KEY,
			kind: "AREA",
			name: "Production FAB",
			parentKey: null,
		},
	];
	for (const bank of banks) {
		identities.push({
			key: bank.id,
			kind: "AREA",
			name: bank.id,
			parentKey: PRODUCTION_FAB_ORGANIZATION_KEY,
		});
		for (const bay of bank.bays) {
			identities.push({ key: bay.id, kind: "BAY", name: bay.id, parentKey: bank.id });
			for (const loop of bay.processLoops) {
				identities.push({ key: loop.id, kind: "AISLE", name: loop.id, parentKey: bay.id });
			}
		}
	}
	const keys = identities.map((identity) => identity.key);
	if (new Set(keys).size !== keys.length) {
		throw new Error("Production FAB organization seed keys must be unique.");
	}
	return Object.freeze(identities.map((identity) => Object.freeze(identity)));
}

function incidence(
	direction: "INCOMING" | "OUTGOING",
	from: Cell,
	to: Cell,
	participant?: number,
): StaticFabAssemblySeamIncidenceV1 {
	return {
		incidence: direction,
		binding: {
			kind: "WITNESS",
			scopedEdge: {
				edge: { from, to },
				scope:
					participant === undefined
						? { kind: "PARENT_DIRECT" }
						: {
								kind: "PARTICIPANT_EFFECTIVE",
								participantIndex: 0,
								directOwnerOrganizationIds: [participant],
							},
			},
		},
	};
}
