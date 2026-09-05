import { describe, expect, it } from "vitest";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import { directionBetween, oppositeDirection } from "./railShape";
import type { StaticFabAssemblyRelationshipStateV1 } from "./StaticFabAssemblyRelationship";
import { compareDirectedRailEdges, type StaticFabOrganizationState } from "./StaticFabOrganization";
import { type Cell, decodeRailCell, encodeRailCell, TileMap } from "./TileMap";

describe("RailDocument assembly relationship durability", () => {
	it("loads exact relationship truth and rejects a stale source edge", () => {
		const { map, organizations, relationships } = relationshipFixture();
		const document = RailDocument.fromLoadedMap(
			map,
			0,
			undefined,
			organizations,
			undefined,
			relationships,
		);
		expect(document.relationships).toEqual(relationships);

		const stale = map.clone();
		stale.setEncoded(0, 1, 0);
		expect(() =>
			RailDocument.fromLoadedMap(stale, 0, undefined, organizations, undefined, relationships),
		).toThrow(/relationship|edge|레일/i);
	});

	it("clears, undoes, and redoes relationships atomically with a monotonic cursor and mirror parity", () => {
		const { map, organizations, relationships } = relationshipFixture();
		const document = RailDocument.fromLoadedMap(
			map,
			0,
			undefined,
			organizations,
			undefined,
			relationships,
		);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot,
		);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));

		expect(document.clear()).toBe(true);
		expect(document.relationships).toEqual({ nextRelationshipId: 2, records: [] });
		expect(events.at(-1)?.relationshipChanges).toHaveLength(1);
		expect(events.at(-1)?.relationshipNextIdBefore).toBe(2);
		expect(events.at(-1)?.relationshipNextIdAfter).toBe(2);
		expect(mirror.applyPatch(events.at(-1) as RailPatchEvent).assemblyRelationships).toBe(0);

		expect(document.undo()).toBe(true);
		expect(document.relationships).toEqual(relationships);
		expect(document.relationships.nextRelationshipId).toBe(2);
		expect(mirror.applyPatch(events.at(-1) as RailPatchEvent).assemblyRelationships).toBe(1);

		expect(document.redo()).toBe(true);
		expect(document.relationships).toEqual({ nextRelationshipId: 2, records: [] });
		const state = mirror.applyPatch(events.at(-1) as RailPatchEvent);
		expect(state.assemblyRelationships).toBe(0);
		expect(state.assemblyRelationshipNextId).toBe(2);
		expect(state.sequence).toBe(document.getPatchSequence());
	});
});

function relationshipFixture(): {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
} {
	const map = new TileMap();
	connectDirectedPath(
		map,
		Array.from({ length: 9 }, (_, offset) => ({ x: offset - 3, y: 0 })),
	);
	connectDirectedPath(map, [
		{ x: 0, y: 0 },
		{ x: 0, y: 1 },
		{ x: 1, y: 1 },
		{ x: 2, y: 1 },
		{ x: 2, y: 0 },
	]);
	const edge = (fromX: number, fromY: number, toX: number, toY: number): DirectedRailEdge => ({
		from: { x: fromX, y: fromY },
		to: { x: toX, y: toY },
	});
	const parentEdges = Array.from({ length: 8 }, (_, offset) => edge(offset - 3, 0, offset - 2, 0));
	const participantEdges = [edge(0, 0, 0, 1), edge(0, 1, 1, 1), edge(1, 1, 2, 1), edge(2, 1, 2, 0)];
	const membership = (railEdges: readonly DirectedRailEdge[]) => ({
		railEdges: [...railEdges].sort(compareDirectedRailEdges),
		advancedSwitchIds: [] as number[],
		equipmentGroupIds: [] as number[],
	});
	const organizations: StaticFabOrganizationState = {
		nextOrganizationId: 4,
		records: [
			{ id: 1, kind: "AREA", name: "Bank", membership: membership(parentEdges) },
			{
				id: 2,
				kind: "BAY",
				name: "Bay",
				parentOrganizationIds: [1],
				membership: membership(participantEdges),
			},
			{
				id: 3,
				kind: "AISLE",
				name: "Process Loop",
				parentOrganizationIds: [2],
				membership: membership(participantEdges),
			},
		],
	};
	const parentScoped = (railEdge: DirectedRailEdge) => ({
		edge: railEdge,
		scope: { kind: "PARENT_DIRECT" as const },
	});
	const participantScoped = (railEdge: DirectedRailEdge) => ({
		edge: railEdge,
		scope: {
			kind: "PARTICIPANT_EFFECTIVE" as const,
			participantIndex: 0 as const,
			directOwnerOrganizationIds: [2, 3],
		},
	});
	const witness = (
		incidence: "INCOMING" | "OUTGOING",
		scopedEdge: ReturnType<typeof parentScoped> | ReturnType<typeof participantScoped>,
	) => ({ incidence, binding: { kind: "WITNESS" as const, scopedEdge } });
	const relationships: StaticFabAssemblyRelationshipStateV1 = {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
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
										role: "BRANCH",
										incidences: [
											witness("INCOMING", parentScoped(edge(-1, 0, 0, 0))),
											witness("OUTGOING", participantScoped(edge(0, 0, 0, 1))),
											witness("OUTGOING", parentScoped(edge(0, 0, 1, 0))),
										],
									},
									{
										role: "MERGE",
										incidences: [
											witness("INCOMING", parentScoped(edge(1, 0, 2, 0))),
											witness("INCOMING", participantScoped(edge(2, 1, 2, 0))),
											witness("OUTGOING", parentScoped(edge(2, 0, 3, 0))),
										],
									},
								],
							},
						],
					},
				],
			},
		],
	};
	return { map, organizations, relationships };
}

function connectDirectedPath(map: TileMap, cells: readonly Cell[]): void {
	for (let index = 1; index < cells.length; index++) {
		const from = cells[index - 1] as Cell;
		const to = cells[index] as Cell;
		const direction = directionBetween(from, to);
		if (direction === null) throw new Error("test path must be adjacent");
		const source = decodeRailCell(map.getEncoded(from.x, from.y));
		const target = decodeRailCell(map.getEncoded(to.x, to.y));
		map.setEncoded(
			from.x,
			from.y,
			encodeRailCell({ ...source, outgoing: source.outgoing | direction }),
		);
		map.setEncoded(
			to.x,
			to.y,
			encodeRailCell({ ...target, incoming: target.incoming | oppositeDirection(direction) }),
		);
	}
}
