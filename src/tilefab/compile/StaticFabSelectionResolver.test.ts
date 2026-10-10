import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W, directionBetween } from "../core/railShape";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import type { CompiledPortEquipmentPresentation } from "./PortEquipmentPresentation";
import { compileStaticFabHierarchyIndex } from "./StaticFabHierarchy";
import {
	resolveStaticFabEquipmentGroupsForRailSelection,
	resolveStaticFabEquipmentGroupsInBounds,
	resolveStaticFabSelectionEquipmentScope,
} from "./StaticFabSelectionResolver";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

describe("resolveStaticFabEquipmentGroupsInBounds", () => {
	it("uses half-open marquee bounds and returns complete group identities", () => {
		const presentation = {
			equipmentGroupCount: 2,
			groupIds: Int32Array.of(10, 20),
			groupBodySectionOffsets: Uint32Array.of(0, 1, 2),
			bodySectionBounds: Float32Array.of(0, 0, 1, 1, 1, 0, 2, 1),
			groupPortOffsets: Uint32Array.of(0, 1, 2),
			groupPortRows: Uint32Array.of(0, 1),
			worldPositions: Float32Array.of(0.5, 0.5, 1.5, 0.5),
		} as unknown as CompiledPortEquipmentPresentation;

		expect(
			resolveStaticFabEquipmentGroupsInBounds(presentation, {
				minX: 0,
				minY: 0,
				maxX: 0,
				maxY: 0,
			}),
		).toEqual([10]);
		expect(
			resolveStaticFabEquipmentGroupsInBounds(presentation, {
				minX: 1,
				minY: 0,
				maxX: 1,
				maxY: 0,
			}),
		).toEqual([20]);
	});
});

describe("resolveStaticFabEquipmentGroupsForRailSelection", () => {
	it("includes only fully rail-supported groups and reports boundary-spanning groups", () => {
		const document = new RailDocument();
		const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 });
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createRailAreaSelection(
			ownership,
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			"fully-contained",
		);
		const state = equipmentState();

		expect(resolveStaticFabEquipmentGroupsForRailSelection(state, selection)).toEqual({
			completeGroupIds: [10],
			partialGroupIds: [20],
		});
	});

	it("keeps Process Bank equipment membership exact at shared-rail boundaries", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const branch = compileStaticFabHierarchyIndex(build.document.map, ownership).branches[0];
		const bank = branch?.processBanks[0];
		if (!branch || !bank) throw new Error("expected generated Process Bank");
		const bankEdgeKeys = new Set(
			bank.selection.ownerships.flatMap((module) =>
				module.eraseEdges.map((edge) => directedEdgeKey(edge)),
			),
		);
		const insideEdges = uniqueDirectedEdges(
			bank.selection.ownerships.flatMap((module) => module.eraseEdges),
		);
		const outsideEdges = uniqueDirectedEdges(
			branch.factory.selection.ownerships
				.flatMap((module) => module.eraseEdges)
				.filter((edge) => !bankEdgeKeys.has(directedEdgeKey(edge))),
		);
		const insideA = insideEdges[0];
		const insideB = insideEdges[1];
		const insideC = insideEdges[2];
		const outsideA = outsideEdges[0];
		const outsideB = outsideEdges[1];
		if (!insideA || !insideB || !insideC || !outsideA || !outsideB) {
			throw new Error("expected Bank boundary rail fixtures");
		}
		const state: PortEquipmentState = Object.freeze({
			nextPortId: 6,
			nextEquipmentGroupId: 31,
			ports: Object.freeze([
				edgePort(1, 10, insideA),
				edgePort(2, 10, insideB),
				edgePort(3, 20, insideC),
				edgePort(4, 20, outsideA),
				edgePort(5, 30, outsideB),
			]),
			equipmentGroups: Object.freeze([
				Object.freeze({
					id: 10,
					kind: "EQ" as const,
					pitchMillimeters: 1_000,
					recipe: null,
					portIds: [1, 2],
				}),
				Object.freeze({
					id: 20,
					kind: "EQ" as const,
					pitchMillimeters: 1_000,
					recipe: null,
					portIds: [3, 4],
				}),
				Object.freeze({
					id: 30,
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIds: [5],
				}),
			]),
		});

		expect(resolveStaticFabEquipmentGroupsForRailSelection(state, bank.selection)).toEqual({
			completeGroupIds: [10],
			partialGroupIds: [20],
		});
	}, 30_000);
});

describe("selection equipment scope", () => {
	function fixture() {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const rail = createRailAreaSelection(
			ownership,
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			"fully-contained",
		);
		const state = equipmentState();
		const sequence = document.getPatchSequence();
		const selection = createStaticFabSelection(rail, state, sequence, [20, 30]);
		return { document, ownership, state, sequence, selection };
	}

	it("replaces outside/partial equipment with exact complete groups while preserving the rail object and source", () => {
		const f = fixture();
		const before = JSON.stringify(f.state);
		const result = resolveStaticFabSelectionEquipmentScope(
			f.document.map,
			f.ownership,
			f.state,
			f.sequence,
			f.selection,
			"attached-equipment",
		);
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.selection.rail).toBe(f.selection.rail);
		expect(result.selection.equipmentGroups.map((item) => item.group.id)).toEqual([10]);
		expect(result.partialGroupIds).toEqual([20]);
		expect(f.selection.equipmentGroups.map((item) => item.group.id)).toEqual([20, 30]);
		expect(JSON.stringify(f.state)).toBe(before);
		expect(f.document.getPatchSequence()).toBe(f.sequence);
		const railOnly = resolveStaticFabSelectionEquipmentScope(
			f.document.map,
			f.ownership,
			f.state,
			f.sequence,
			result.selection,
			"rail",
		);
		expect(railOnly.valid && railOnly.selection.equipmentGroups).toEqual([]);
		expect(railOnly.valid && railOnly.selection.rail).toBe(f.selection.rail);
		if (!railOnly.valid) return;
		const restored = resolveStaticFabSelectionEquipmentScope(
			f.document.map,
			f.ownership,
			f.state,
			f.sequence,
			railOnly.selection,
			"attached-equipment",
		);
		expect(restored).toEqual(result);
	});

	it("rejects stale patch and rail revisions instead of rebasing the selection", () => {
		const f = fixture();
		for (const scope of ["rail", "attached-equipment"] as const) {
			expect(
				resolveStaticFabSelectionEquipmentScope(
					f.document.map,
					f.ownership,
					f.state,
					f.sequence + 1,
					f.selection,
					scope,
				).valid,
			).toBe(false);
		}
		expect(
			f.document.commit(planRailConstruction(f.document.map, { x: 20, y: 0 }, { x: 25, y: 0 })),
		).toBe(true);
		expect(
			resolveStaticFabSelectionEquipmentScope(
				f.document.map,
				f.ownership,
				f.state,
				f.sequence,
				f.selection,
				"rail",
			).valid,
		).toBe(false);
	});
});

function equipmentState(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 5,
		nextEquipmentGroupId: 31,
		ports: Object.freeze([port(1, 10, 2), port(2, 20, 4), port(3, 20, 7), port(4, 30, 8)]),
		equipmentGroups: Object.freeze([
			Object.freeze({ id: 10, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] }),
			Object.freeze({
				id: 20,
				kind: "EQ" as const,
				pitchMillimeters: 1_000,
				recipe: null,
				portIds: [2, 3],
			}),
			Object.freeze({ id: 30, kind: "OHB" as const, template: "SINGLE" as const, portIds: [4] }),
		]),
	});
}

function port(id: number, equipmentGroupId: number, x: number) {
	return Object.freeze({
		id,
		equipmentGroupId,
		route: Object.freeze({
			kind: "CARDINAL_CELL" as const,
			x,
			z: 0,
			from: DIR_W,
			to: DIR_E,
		}),
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL" as const,
		portType: equipmentGroupId === 20 ? ("EQ" as const) : ("OHB" as const),
		barcode: null,
	});
}

function edgePort(id: number, equipmentGroupId: number, edge: DirectedRailEdge) {
	const to = directionBetween(edge.from, edge.to);
	if (to === null) throw new Error("expected adjacent directed rail edge");
	return Object.freeze({
		id,
		equipmentGroupId,
		route: Object.freeze({
			kind: "CARDINAL_CELL" as const,
			x: edge.from.x,
			z: edge.from.y,
			from: 0,
			to,
		}),
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL" as const,
		portType: equipmentGroupId === 30 ? ("OHB" as const) : ("EQ" as const),
		barcode: null,
	});
}

function uniqueDirectedEdges(edges: readonly DirectedRailEdge[]): readonly DirectedRailEdge[] {
	return [...new Map(edges.map((edge) => [directedEdgeKey(edge), edge])).values()];
}

function directedEdgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`;
}
