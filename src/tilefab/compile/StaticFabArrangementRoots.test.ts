import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import type {
	StaticFabOrganizationMembership,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { compilePortEquipmentPresentation } from "./PortEquipmentPresentation";
import { planOhbPlacement } from "./PortPlacementPlanner";
import { compilePortSlots, PORT_SLOT_STATUS, PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import {
	resolveStaticFabOrganizationArrangementRoots,
	resolveStaticFabSelectionArrangementRoots,
	solveStaticFabArrangementFromRoots,
} from "./StaticFabArrangementRoots";

describe("StaticFabArrangementRoots", () => {
	it("keeps connected modules together and preserves disconnected component boundaries", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
		const selection = createStaticFabSelection(rail, emptyPortEquipmentState(), 0, []);

		const result = resolveStaticFabSelectionArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			selection,
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.roots).toHaveLength(2);
		expect(result.roots.map((root) => root.moduleKeys.length)).toEqual([2, 2]);
		expect(result.roots.map((root) => root.bounds)).toEqual([
			{ minX: 0, minZ: 0, maxXExclusive: 9, maxZExclusive: 1 },
			{ minX: 20, minZ: 0, maxXExclusive: 29, maxZExclusive: 1 },
		]);
		const preview = solveStaticFabArrangementFromRoots("X", "ALIGN_MIN", result.roots);
		expect(preview.valid, preview.reason).toBe(true);
		if (preview.valid) {
			expect(preview.translations.map((translation) => translation.deltaX)).toEqual([0, -20]);
		}
	});

	it("derives bounds from authored footprints instead of the marquee envelope", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const exactRail = createRailAreaSelectionFromOwnerships(
			ownership,
			ownership.modules.slice(0, 2),
		);
		const oversizedRail = Object.freeze({
			...exactRail,
			bounds: Object.freeze({ minX: -1_000, minY: -1_000, maxX: 1_000, maxY: 1_000 }),
		});
		const selection = createStaticFabSelection(oversizedRail, emptyPortEquipmentState(), 0, []);

		const result = resolveStaticFabSelectionArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			selection,
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.roots[0]?.bounds).toEqual({
			minX: 0,
			minZ: 0,
			maxXExclusive: 9,
			maxZExclusive: 1,
		});
	});

	it("automatically carries a complete attached equipment group and its derived body footprint", () => {
		const document = documentWithOhb();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
		const selectionWithoutExplicitEquipment = createStaticFabSelection(
			rail,
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const presentation = compilePortEquipmentPresentation(
			compilePhysicalRail(document.map),
			document.portEquipment,
		);

		const result = resolveStaticFabSelectionArrangementRoots(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			selectionWithoutExplicitEquipment,
			presentation,
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0]?.equipmentGroupIds).toEqual([1]);
		const railMinZ = Math.min(
			...ownership.modules.flatMap((module) => module.footprintCells.map((c) => c.y)),
		);
		const railMaxZExclusive =
			Math.max(...ownership.modules.flatMap((module) => module.footprintCells.map((c) => c.y))) + 1;
		const bounds = result.roots[0]?.bounds;
		expect(bounds).toBeDefined();
		expect(
			(bounds?.minZ ?? railMinZ) < railMinZ ||
				(bounds?.maxZExclusive ?? railMaxZExclusive) > railMaxZExclusive,
		).toBe(true);
	});

	it("rejects a group whose ports span different arrangement components", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const equipment = spanningEqState();
		const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
		const selection = createStaticFabSelection(rail, equipment, 0, []);

		const result = resolveStaticFabSelectionArrangementRoots(
			map,
			ownership,
			equipment,
			0,
			selection,
		);

		expect(result).toMatchObject({ valid: false, code: "PARTIAL_EQUIPMENT" });
	});

	it("keeps organization roots independent and rejects shared direct membership", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first, second] = ownershipComponents(ownership.modules);
		const organizations = state([
			organization(1, "BAY", "Bay A", [], first),
			organization(2, "BAY", "Bay B", [], second),
			organization(3, "AISLE", "Shared aisle", [], first),
		]);

		const independent = resolveStaticFabOrganizationArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizations,
			[2, 1],
			"DIRECT",
		);
		expect(independent.valid, independent.reason).toBe(true);
		if (independent.valid) {
			expect(independent.roots.map((root) => root.organizationRootIds)).toEqual([[1], [2]]);
		}

		const overlap = resolveStaticFabOrganizationArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizations,
			[1, 3],
			"DIRECT",
		);
		expect(overlap).toMatchObject({ valid: false, code: "OVERLAPPING_ROOTS" });
	});

	it("expands Bay arrangement roots through Process Loop children only in EFFECTIVE scope", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first, second] = ownershipComponents(ownership.modules);
		const organizations = state([
			organization(1, "BAY", "Bay A", [], first.slice(0, 1)),
			organization(2, "AISLE", "Process Loop A", [1], first.slice(1)),
			organization(3, "BAY", "Bay B", [], second.slice(0, 1)),
			organization(4, "AISLE", "Process Loop B", [3], second.slice(1)),
		]);

		const direct = resolveStaticFabOrganizationArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizations,
			[1, 3],
			"DIRECT",
		);
		expect(direct.valid, direct.reason).toBe(true);
		if (!direct.valid) return;
		expect(direct.roots.map((root) => root.organizationRootIds)).toEqual([[1], [3]]);
		expect(direct.roots.map((root) => root.moduleKeys.length)).toEqual([1, 1]);

		const effective = resolveStaticFabOrganizationArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizations,
			[1, 3],
			"EFFECTIVE",
		);
		expect(effective.valid, effective.reason).toBe(true);
		if (!effective.valid) return;
		expect(effective.roots.map((root) => root.organizationRootIds)).toEqual([[1], [3]]);
		expect(effective.roots.map((root) => root.moduleKeys.length)).toEqual([2, 2]);
	});

	it("suppresses an EFFECTIVE descendant when its selected ancestor already covers it", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first, second] = ownershipComponents(ownership.modules);
		const organizations = state([
			organization(1, "AREA", "Factory", [], first),
			organization(2, "BAY", "Bay", [1], second),
		]);

		const result = resolveStaticFabOrganizationArrangementRoots(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizations,
			[2, 1],
			"EFFECTIVE",
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.suppressedOrganizationRootIds).toEqual([2]);
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0]?.organizationRootIds).toEqual([1]);
		expect(result.roots[0]?.moduleKeys).toHaveLength(4);
	});
});

function disjointLinearMap(): TileMap {
	const map = new TileMap();
	const first = planRailConstruction(new TileMap(), { x: 0, y: 0 }, { x: 8, y: 0 });
	const second = planRailConstruction(new TileMap(), { x: 20, y: 0 }, { x: 28, y: 0 });
	if (!first.valid || !second.valid) throw new Error("failed to build arrangement fixture");
	map.applyAtomicMutations([...first.mutations, ...second.mutations], []);
	return map;
}

function documentWithOhb(): RailDocument {
	const document = new RailDocument();
	const rail = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 });
	if (!rail.valid || !document.commit(rail)) throw new Error("failed to build OHB rail fixture");
	const physical = compilePhysicalRail(document.map);
	const slots = compilePortSlots(physical, document.portEquipment, "OHB");
	let row = -1;
	for (let index = 0; index < slots.count; index++) {
		if ((slots.statuses[index] as number) === PORT_SLOT_STATUS.LEGAL) {
			row = index;
			break;
		}
	}
	if (row < 0) throw new Error("OHB fixture has no legal slot");
	const placement = planOhbPlacement(
		slots,
		row,
		new PortSlotAvailabilityIndex(physical, document.portEquipment),
		document.portEquipment,
		document.map.getRevision(),
		document.getPatchSequence(),
	);
	if (!placement.valid || !document.commitPortEquipment(placement)) {
		throw new Error("failed to place OHB fixture");
	}
	return document;
}

function spanningEqState(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 3,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 1,
					z: 0,
					from: DIR_W,
					to: DIR_E,
				}),
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "EQ" as const,
				barcode: "EQ-1-A",
			}),
			Object.freeze({
				id: 2,
				equipmentGroupId: 1,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 21,
					z: 0,
					from: DIR_W,
					to: DIR_E,
				}),
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "EQ" as const,
				barcode: "EQ-1-B",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "EQ" as const,
				portIds: Object.freeze([1, 2]),
				pitchMillimeters: 1_000,
				recipe: null,
			}),
		]),
	});
}

function ownershipComponents(
	modules: readonly RailModuleOwnership[],
): readonly [readonly RailModuleOwnership[], readonly RailModuleOwnership[]] {
	const first = modules.filter((module) => module.footprintCells.some((cell) => cell.x < 10));
	const second = modules.filter((module) => module.footprintCells.some((cell) => cell.x > 10));
	return [first, second];
}

function organization(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membership(modules),
	});
}

function membership(modules: readonly RailModuleOwnership[]): StaticFabOrganizationMembership {
	const edges = new Map<string, RailModuleOwnership["eraseEdges"][number]>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) {
			edges.set(`${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`, edge);
		}
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()]),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

function state(records: readonly StaticFabOrganizationRecord[]): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId: Math.max(...records.map((record) => record.id)) + 1,
		records: Object.freeze([...records]),
	});
}
