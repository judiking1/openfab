import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction, moveCell } from "../core/railShape";
import type {
	StaticFabAssemblyRelationshipRecordV1,
	StaticFabAssemblySeamContactV1,
	StaticFabAssemblySeamIncidenceV1,
} from "../core/StaticFabAssemblyRelationship";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationKind,
} from "../core/StaticFabOrganization";
import type { Cell } from "../core/TileMap";
import type {
	ParallelHallFabBankPlan,
	ParallelHallFabGatewayPlan,
} from "./ParallelHallFabAssemblyPlan";
import { createStaticFabGeneratorRelationshipDescriptor } from "./StaticFabGeneratorRelationshipDescriptor";

export const PARALLEL_HALL_FAB_ORGANIZATION_KEY = "PARALLEL-HALL-FAB";

/** Only the declared Bank gateways contribute contacts; perimeter links remain Fab infrastructure. */
export function describeParallelHallFabRelationships(
	banks: readonly ParallelHallFabBankPlan[],
	gateways: readonly ParallelHallFabGatewayPlan[],
) {
	const records: StaticFabAssemblyRelationshipRecordV1[] = banks.map((bank, index) => {
		const owned = gateways.filter((gateway) => gateway.ownerId === bank.id);
		const contract = owned[0]?.contract;
		if (owned.length !== 1 || !contract)
			throw new Error("Parallel Hall Bank requires one declared gateway.");
		const participant = index + 2;
		const north = bank.side === "north";
		const parentRun = north ? contract.targetRun : contract.sourceRun;
		const bankRun = north ? contract.sourceRun : contract.targetRun;
		if (
			parentRun.ownerId !== PARALLEL_HALL_FAB_ORGANIZATION_KEY ||
			bankRun.ownerId !== bank.id ||
			parentRun.flowDirection !== (north ? DIR_E : DIR_W) ||
			bankRun.flowDirection !== (north ? DIR_W : DIR_E)
		) {
			throw new Error(
				"Parallel Hall gateway flow and owners differ from its declared Bank contact.",
			);
		}
		const junctions = contract.exactJunctions;
		const seams = north
			? [
					contact("BRANCH", junctions.targetDeparture, DIR_E, DIR_N, participant),
					contact("MERGE", junctions.targetArrival, DIR_E, DIR_N, participant),
				]
			: [
					contact("MERGE", junctions.sourceArrival, DIR_W, DIR_S, participant),
					contact("BRANCH", junctions.sourceDeparture, DIR_W, DIR_S, participant),
				];
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
							seamContacts: seams,
						},
					],
				},
			],
		};
	});
	return createStaticFabGeneratorRelationshipDescriptor(
		[PARALLEL_HALL_FAB_ORGANIZATION_KEY, ...banks.map((bank) => bank.id)],
		records,
	);
}

/** Both collectors are authored before the first Bay, unlike the Production FAB allocation order. */
export function parallelHallFabOrganizationIdentities(banks: readonly ParallelHallFabBankPlan[]) {
	const identities: Array<
		Readonly<{
			key: string;
			kind: StaticFabOrganizationKind;
			name: string;
			parentKey: string | null;
		}>
	> = [
		{
			key: PARALLEL_HALL_FAB_ORGANIZATION_KEY,
			kind: "AREA",
			name: "Parallel Process Hall",
			parentKey: null,
		},
		...banks.map((bank) => ({
			key: bank.id,
			kind: "AREA" as const,
			name: bank.id,
			parentKey: PARALLEL_HALL_FAB_ORGANIZATION_KEY,
		})),
	];
	for (const bank of banks)
		for (const bay of bank.bays) {
			identities.push({ key: bay.id, kind: "BAY", name: bay.id, parentKey: bank.id });
			for (const loop of bay.processLoops)
				identities.push({ key: loop.id, kind: "AISLE", name: loop.id, parentKey: bay.id });
		}
	if (new Set(identities.map((identity) => identity.key)).size !== identities.length)
		throw new Error("Parallel Hall organization seed keys must be unique.");
	return Object.freeze(identities.map((identity) => Object.freeze(identity)));
}

function contact(
	role: "BRANCH" | "MERGE",
	junction: Cell,
	parentFlow: Direction,
	bankSide: Direction,
	participant: number,
): StaticFabAssemblySeamContactV1 {
	const upstream = moveCell(junction, parentFlow === DIR_E ? DIR_W : DIR_E);
	const downstream = moveCell(junction, parentFlow);
	const neighbor = moveCell(junction, bankSide);
	const incidences = [
		incidence("INCOMING", upstream, junction),
		incidence("OUTGOING", junction, downstream),
		role === "BRANCH"
			? incidence("OUTGOING", junction, neighbor, participant)
			: incidence("INCOMING", neighbor, junction, participant),
	];
	incidences.sort((left, right) => {
		const order =
			(left.incidence === "INCOMING" ? 0 : 1) - (right.incidence === "INCOMING" ? 0 : 1);
		return (
			order || compareDirectedRailEdges(left.binding.scopedEdge.edge, right.binding.scopedEdge.edge)
		);
	});
	return { role, incidences };
}

function incidence(incidence: "INCOMING" | "OUTGOING", from: Cell, to: Cell, participant?: number) {
	return {
		incidence,
		binding: {
			kind: "WITNESS" as const,
			scopedEdge: {
				edge: { from, to },
				scope:
					participant === undefined
						? { kind: "PARENT_DIRECT" as const }
						: {
								kind: "PARTICIPANT_EFFECTIVE" as const,
								participantIndex: 0,
								directOwnerOrganizationIds: [participant],
							},
			},
		},
	} satisfies StaticFabAssemblySeamIncidenceV1;
}
