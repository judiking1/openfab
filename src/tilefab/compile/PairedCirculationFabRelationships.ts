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
	PairedCirculationBankPlan,
	PairedCirculationBayPlacement,
	PairedCirculationHallPlan,
} from "./PairedCirculationFabAssemblyPlan";
import { createStaticFabGeneratorRelationshipDescriptor } from "./StaticFabGeneratorRelationshipDescriptor";

export const PAIRED_CIRCULATION_FAB_ORGANIZATION_KEY = "PAIRED-CIRCULATION-FAB";

/** Declare every Bay gateway at its Fab-owned interbay boundary, without a removal footprint. */
export function describePairedCirculationFabRelationships(
	banks: readonly PairedCirculationBankPlan[],
	halls: readonly PairedCirculationHallPlan[],
) {
	if (banks.length !== 4 || halls.length !== 2)
		throw new Error("Paired FAB contacts require four Banks in two Halls.");
	const keys = pairedCirculationFabOrganizationIdentities(banks).map((identity) => identity.key);
	const localIds = new Map(keys.map((key, index) => [key, index + 1]));
	const records: StaticFabAssemblyRelationshipRecordV1[] = banks.map((bank, index) => {
		const hall = halls[bank.hallIndex];
		if (
			!hall ||
			bank.hallIndex !== Math.floor(index / 2) ||
			bank.side !== (index % 2 === 0 ? "north" : "south") ||
			hall.banks[index % 2]?.id !== bank.id ||
			bank.bays.length < 12 ||
			bank.bays.length > 16
		)
			throw new Error("Paired Bank contact order differs from its Hall declaration.");
		const participant = localIds.get(bank.id) as number;
		return {
			id: index + 1,
			hierarchyRole: "BANK_TO_FAB",
			purpose: "HIERARCHY_LINK",
			parentOrganizationId: 1,
			participantOrganizationIds: [participant],
			managedChildOrganizationIds: [participant],
			reviewPolicy: "AUTHORING_NON_DETACHABLE",
			connectionGroups: bank.bays.map((bay, ordinal) => {
				assertGatewayContract(bank, bay, hall);
				const owner = localIds.get(bay.id) as number;
				const north = bank.side === "north";
				const flow = north ? DIR_E : DIR_W;
				const side = north ? DIR_N : DIR_S;
				const junctions = bay.gateway.exactJunctions;
				const branch = contact("BRANCH", junctions.sourceDeparture, flow, side, owner);
				const merge = contact("MERGE", junctions.sourceArrival, flow, side, owner);
				return {
					ordinal,
					legs: [
						{
							ordinal: 0,
							directionRole: "CONTACT",
							exclusiveCutEdges: [],
							endpointSupports: [],
							seamContacts: north ? [branch, merge] : [merge, branch],
						},
					],
				};
			}),
		};
	});
	return createStaticFabGeneratorRelationshipDescriptor(keys, records);
}

/** Root and all four Banks precede the ordered Bay/Process Loop allocations. */
export function pairedCirculationFabOrganizationIdentities(
	banks: readonly PairedCirculationBankPlan[],
) {
	const identities: Array<
		Readonly<{
			key: string;
			kind: StaticFabOrganizationKind;
			name: string;
			parentKey: string | null;
		}>
	> = [
		{
			key: PAIRED_CIRCULATION_FAB_ORGANIZATION_KEY,
			kind: "AREA",
			name: "Paired-Circulation Production FAB",
			parentKey: null,
		},
		...banks.map((bank) => ({
			key: bank.id,
			kind: "AREA" as const,
			name: bank.id,
			parentKey: PAIRED_CIRCULATION_FAB_ORGANIZATION_KEY,
		})),
	];
	for (const bank of banks)
		for (const bay of bank.bays) {
			identities.push({ key: bay.id, kind: "BAY", name: bay.id, parentKey: bank.id });
			for (const loop of bay.processLoops)
				identities.push({ key: loop.id, kind: "AISLE", name: loop.id, parentKey: bay.id });
		}
	if (new Set(identities.map((identity) => identity.key)).size !== identities.length)
		throw new Error("Paired FAB organization seed keys must be unique.");
	return Object.freeze(identities.map((identity) => Object.freeze(identity)));
}

function assertGatewayContract(
	bank: PairedCirculationBankPlan,
	bay: PairedCirculationBayPlacement,
	hall: PairedCirculationHallPlan,
): void {
	const { gateway } = bay;
	const { sourceRun, targetRun, exactJunctions: junctions } = gateway;
	const north = bank.side === "north";
	const flow = north ? DIR_E : DIR_W;
	const sourceY = hall.interbay.origin.y + (north ? 0 : hall.interbay.depthMeters);
	if (
		bay.bankId !== bank.id ||
		bay.side !== bank.side ||
		gateway.ownerId !== bay.id ||
		sourceRun.ownerId !== hall.interbay.id ||
		targetRun.ownerId !== bay.id ||
		sourceRun.axis !== "x" ||
		targetRun.axis !== "x" ||
		sourceRun.side !== bank.side ||
		targetRun.side !== (north ? "south" : "north") ||
		sourceRun.flowDirection !== flow ||
		targetRun.flowDirection !== flow ||
		sourceRun.minimum !== hall.interbay.origin.x ||
		sourceRun.maximum !== hall.interbay.origin.x + hall.interbay.lengthMeters ||
		targetRun.minimum !== gateway.targetAnchor.x - Math.floor(bay.frontageMeters / 2) ||
		targetRun.maximum !== gateway.targetAnchor.x + Math.floor(bay.frontageMeters / 2) ||
		gateway.corridor.minX !== Math.min(junctions.sourceDeparture.x, junctions.sourceArrival.x) ||
		gateway.corridor.maxX !== Math.max(junctions.sourceDeparture.x, junctions.sourceArrival.x) ||
		gateway.corridor.minY !== Math.min(sourceY, targetRun.fixedCoordinate) ||
		gateway.corridor.maxY !== Math.max(sourceY, targetRun.fixedCoordinate) ||
		sourceRun.fixedCoordinate !== sourceY ||
		junctions.sourceDeparture.y !== sourceY ||
		junctions.sourceArrival.y !== sourceY ||
		junctions.targetArrival.y !== targetRun.fixedCoordinate ||
		junctions.targetDeparture.y !== targetRun.fixedCoordinate ||
		junctions.sourceDeparture.x !== junctions.targetArrival.x ||
		junctions.sourceArrival.x !== junctions.targetDeparture.x ||
		junctions.sourceDeparture.x !== gateway.sourceAnchor.x ||
		junctions.sourceDeparture.y !== gateway.sourceAnchor.y ||
		junctions.targetArrival.x !== gateway.targetAnchor.x ||
		junctions.targetArrival.y !== gateway.targetAnchor.y ||
		(north ? targetRun.fixedCoordinate >= sourceY : targetRun.fixedCoordinate <= sourceY) ||
		gateway.expectedOutboundTurns !== 0 ||
		gateway.expectedReturnTurns !== 0 ||
		gateway.allowSameComponent
	)
		throw new Error("Paired gateway differs from its declared Fab/Bay contact boundary.");
}

function contact(
	role: "BRANCH" | "MERGE",
	junction: Cell,
	flow: Direction,
	side: Direction,
	owner: number,
): StaticFabAssemblySeamContactV1 {
	const neighbor = moveCell(junction, side);
	const incidences = [
		incidence("INCOMING", moveCell(junction, flow === DIR_E ? DIR_W : DIR_E), junction),
		incidence("OUTGOING", junction, moveCell(junction, flow)),
		role === "BRANCH"
			? incidence("OUTGOING", junction, neighbor, owner)
			: incidence("INCOMING", neighbor, junction, owner),
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

function incidence(incidence: "INCOMING" | "OUTGOING", from: Cell, to: Cell, owner?: number) {
	return {
		incidence,
		binding: {
			kind: "WITNESS" as const,
			scopedEdge: {
				edge: { from, to },
				scope:
					owner === undefined
						? { kind: "PARENT_DIRECT" as const }
						: {
								kind: "PARTICIPANT_EFFECTIVE" as const,
								participantIndex: 0,
								directOwnerOrganizationIds: [owner],
							},
			},
		},
	} satisfies StaticFabAssemblySeamIncidenceV1;
}
