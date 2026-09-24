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
	CentralSpineFabBankPlan,
	CentralSpineFabLoopPlan,
} from "./CentralSpineFabAssemblyPlan";
import { createStaticFabGeneratorRelationshipDescriptor } from "./StaticFabGeneratorRelationshipDescriptor";

export const CENTRAL_SPINE_FAB_ORGANIZATION_KEY = "CENTRAL-SPINE-FAB";

/** Planning Banks are not organizations. Every Bay and both Loops contact the root-owned spine. */
export function describeCentralSpineFabRelationships(
	banks: readonly CentralSpineFabBankPlan[],
	spine: CentralSpineFabLoopPlan,
) {
	if (
		spine.id !== "FAB-CENTRAL-INTERBAY" ||
		spine.pose.forward !== DIR_E ||
		spine.pose.side !== "right" ||
		spine.pose.flow !== "forward"
	)
		throw new Error("Central Spine contact declaration requires the forward interbay trunk.");
	const keys = centralSpineFabOrganizationIdentities(banks).map((identity) => identity.key);
	const localIds = new Map(keys.map((key, index) => [key, index + 1]));
	const records: StaticFabAssemblyRelationshipRecordV1[] = [];
	if (banks.length !== 2) throw new Error("Central Spine requires two opposed planning Banks.");
	for (const [index, bank] of banks.entries()) {
		const north = index === 0;
		const flow = north ? DIR_E : DIR_W;
		const side = north ? DIR_N : DIR_S;
		const trunkY = spine.origin.y + (north ? 0 : spine.depthMeters);
		if (bank.side !== (north ? "north" : "south"))
			throw new Error("Central Spine planning Bank order differs from its declared sides.");
		for (const bay of bank.bays) {
			if (bay.bankId !== bank.id || bay.side !== bank.side || bay.processLoops.length !== 2)
				throw new Error("Central Spine requires each declared Bay and both Process Loops.");
			const participant = localIds.get(bay.id) as number;
			records.push({
				id: records.length + 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [participant],
				managedChildOrganizationIds: [participant],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
				connectionGroups: [bay, ...bay.processLoops].map((operation, ordinal) => {
					const { anchor, pose, frontageMeters } = operation;
					const end = { x: anchor.x + (north ? frontageMeters : -frontageMeters), y: anchor.y };
					if (
						pose.forward !== flow ||
						pose.side !== "left" ||
						pose.flow !== "forward" ||
						anchor.y !== trunkY ||
						Math.min(anchor.x, end.x) <= spine.origin.x ||
						Math.max(anchor.x, end.x) >= spine.origin.x + spine.lengthMeters
					)
						throw new Error("Central Spine operation differs from its declared shared trunk.");
					const owner = localIds.get(operation.id) as number;
					// A closed envelope merges at its origin; an attached bypass branches there.
					const seams = [
						contact(ordinal === 0 ? "MERGE" : "BRANCH", anchor, flow, side, owner),
						contact(ordinal === 0 ? "BRANCH" : "MERGE", end, flow, side, owner),
					];
					return {
						ordinal,
						legs: [
							{
								ordinal: 0,
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
								seamContacts: north ? seams : seams.reverse(),
							},
						],
					};
				}),
			});
		}
	}
	return createStaticFabGeneratorRelationshipDescriptor(keys, records);
}

export function centralSpineFabOrganizationIdentities(banks: readonly CentralSpineFabBankPlan[]) {
	const identities: Array<
		Readonly<{
			key: string;
			kind: StaticFabOrganizationKind;
			name: string;
			parentKey: string | null;
		}>
	> = [
		{
			key: CENTRAL_SPINE_FAB_ORGANIZATION_KEY,
			kind: "AREA",
			name: "Central-Spine FAB",
			parentKey: null,
		},
	];
	for (const bank of banks)
		for (const bay of bank.bays) {
			identities.push({
				key: bay.id,
				kind: "BAY",
				name: bay.id,
				parentKey: CENTRAL_SPINE_FAB_ORGANIZATION_KEY,
			});
			for (const loop of bay.processLoops)
				identities.push({ key: loop.id, kind: "AISLE", name: loop.id, parentKey: bay.id });
		}
	if (new Set(identities.map((identity) => identity.key)).size !== identities.length)
		throw new Error("Central Spine organization seed keys must be unique.");
	return Object.freeze(identities.map((identity) => Object.freeze(identity)));
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
	incidences.sort(
		(left, right) =>
			(left.incidence === "INCOMING" ? 0 : 1) - (right.incidence === "INCOMING" ? 0 : 1) ||
			compareDirectedRailEdges(left.binding.scopedEdge.edge, right.binding.scopedEdge.edge),
	);
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
