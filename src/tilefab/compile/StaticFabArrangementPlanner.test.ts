import { describe, expect, it } from "vitest";
import {
	applyPortEquipmentMutations,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { portEquipmentLayoutError } from "../core/PortEquipmentLayoutValidator";
import { planRailConstruction, planRailPath } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	STATIC_FAB_ARRANGEMENT_VERSION,
	solveStaticFabArrangement,
} from "../core/StaticFabArrangement";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { planStaticFabArrangement } from "./StaticFabArrangementPlanner";
import { resolveStaticFabSelectionArrangementRoots } from "./StaticFabArrangementRoots";

describe("StaticFabArrangementPlanner", () => {
	it("translates rail, ports, and every semantic owner while preserving stable IDs", () => {
		const map = mapWithLines([
			[0, 0, 8, 0],
			[20, 10, 28, 10],
		]);
		const ownership = buildRailModuleOwnershipIndex(map);
		const equipment = oneOhbState(21, 10);
		const secondModules = ownership.modules.filter((module) =>
			module.footprintCells.some((cell) => cell.y === 10),
		);
		const organizations = organizationState([
			organization(1, "BAY", "Bay B", secondModules, [1]),
			organization(2, "PROCESS_FAMILY", "Photo", secondModules, [1]),
		]);
		expect(staticFabOrganizationStateError(map, equipment, organizations)).toBeNull();
		const roots = resolvedRoots(map, ownership.modules, equipment);
		const arrangement = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis: "Z",
			mode: "ALIGN_MIN",
			roots,
		});

		const plan = planStaticFabArrangement(
			map,
			ownership,
			equipment,
			organizations,
			0,
			roots,
			arrangement,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan).toMatchObject({
			kind: "arrange-static-fab",
			issueCode: null,
			organizationImpactAuthorizations: [1, 2],
			arrangement: {
				rootCount: 2,
				equipmentGroupCount: 1,
				portCount: 1,
			},
		});
		expect(plan.portMutations).toHaveLength(1);
		expect(plan.portMutations[0]).toMatchObject({
			id: 1,
			before: { id: 1, equipmentGroupId: 1, barcode: "OHB-STABLE" },
			after: {
				id: 1,
				equipmentGroupId: 1,
				barcode: "OHB-STABLE",
				route: { kind: "CARDINAL_CELL", x: 21, z: 0 },
			},
		});
		expect(plan.equipmentGroupMutations).toEqual([]);
		expect(plan.organizationMutations.map((mutation) => mutation.id)).toEqual([1, 2]);
		expect(plan.organizationMutations[0]?.after?.membership.equipmentGroupIds).toEqual([1]);
		expect(
			plan.organizationMutations[0]?.after?.membership.railEdges.every(
				(edge) => edge.from.y === 0 && edge.to.y === 0,
			),
		).toBe(true);

		const prospectiveMap = map.clone();
		prospectiveMap.applyAtomicMutations(plan.mutations, plan.switchMutations);
		const prospectiveEquipment = applyPortEquipmentMutations(
			equipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
		const prospectiveOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			plan.organizationMutations,
			organizations.nextOrganizationId,
			true,
		);
		expect(portEquipmentLayoutError(prospectiveMap, prospectiveEquipment)).toBeNull();
		expect(
			staticFabOrganizationStateError(
				prospectiveMap,
				prospectiveEquipment,
				prospectiveOrganizations,
			),
		).toBeNull();
		expect(prospectiveEquipment.equipmentGroups[0]).toEqual(equipment.equipmentGroups[0]);
		expect(prospectiveOrganizations.records.map((record) => record.id)).toEqual([1, 2]);
	});

	it("rejects a partial connected component before any mutation is published", () => {
		const map = mapWithLines([
			[0, 0, 13, 0],
			[20, 10, 28, 10],
		]);
		const ownership = buildRailModuleOwnershipIndex(map);
		const firstLineModules = ownership.modules
			.filter((module) => module.footprintCells.some((cell) => cell.y === 0))
			.sort((left, right) => left.key.localeCompare(right.key));
		const secondLineModules = ownership.modules.filter((module) =>
			module.footprintCells.some((cell) => cell.y === 10),
		);
		const roots = resolvedRoots(
			map,
			[firstLineModules[0] as RailModuleOwnership, ...secondLineModules],
			emptyPortEquipmentState(),
		);
		const arrangement = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis: "Z",
			mode: "ALIGN_MIN",
			roots,
		});

		const plan = planStaticFabArrangement(
			map,
			ownership,
			emptyPortEquipmentState(),
			organizationState([]),
			0,
			roots,
			arrangement,
		);

		expect(plan).toMatchObject({
			valid: false,
			issueCode: "EXTERNAL_ATTACHMENT",
			mutations: [],
		});
		expect(plan.conflicts.length).toBeGreaterThan(0);
	});

	it("rejects collisions with fixed rail at the translated footprint", () => {
		const map = mapWithLines([
			[0, 0, 8, 0],
			[20, 10, 28, 10],
			[20, 0, 28, 0],
		]);
		const ownership = buildRailModuleOwnershipIndex(map);
		const selectedModules = ownership.modules.filter((module) =>
			module.footprintCells.some((cell) => (cell.y === 0 && cell.x < 10) || cell.y === 10),
		);
		const roots = resolvedRoots(map, selectedModules, emptyPortEquipmentState());
		const arrangement = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis: "Z",
			mode: "ALIGN_MIN",
			roots,
		});

		const plan = planStaticFabArrangement(
			map,
			ownership,
			emptyPortEquipmentState(),
			organizationState([]),
			0,
			roots,
			arrangement,
		);

		expect(plan).toMatchObject({ valid: false, issueCode: "TARGET_COLLISION" });
		expect(plan.conflicts.some((cell) => cell.x >= 20 && cell.y === 0)).toBe(true);
	});

	it("rejects overlap between independently moving target roots", () => {
		const map = mapWithLines([
			[0, 0, 8, 0],
			[0, 10, 8, 10],
		]);
		const ownership = buildRailModuleOwnershipIndex(map);
		const roots = resolvedRoots(map, ownership.modules, emptyPortEquipmentState());
		const arrangement = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis: "Z",
			mode: "ALIGN_MIN",
			roots,
		});

		const plan = planStaticFabArrangement(
			map,
			ownership,
			emptyPortEquipmentState(),
			organizationState([]),
			0,
			roots,
			arrangement,
		);

		expect(plan).toMatchObject({ valid: false, issueCode: "TARGET_OVERLAP" });
	});

	it("rejects a selection whose rail generation changed after solving", () => {
		const map = mapWithLines([
			[0, 0, 8, 0],
			[20, 10, 28, 10],
		]);
		const ownership = buildRailModuleOwnershipIndex(map);
		const roots = resolvedRoots(map, ownership.modules, emptyPortEquipmentState());
		const arrangement = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis: "Z",
			mode: "ALIGN_MIN",
			roots,
		});
		const extension = planRailConstruction(map, { x: 8, y: 0 }, { x: 9, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		map.applyAtomicMutations(extension.mutations, []);

		const plan = planStaticFabArrangement(
			map,
			ownership,
			emptyPortEquipmentState(),
			organizationState([]),
			0,
			roots,
			arrangement,
		);

		expect(plan).toMatchObject({ valid: false, issueCode: "STALE_SELECTION" });
	});

	it("rejects a relocation whose prospective physical layout introduces clearance conflicts", () => {
		const map = new TileMap();
		const main = planRailPath(new TileMap(), [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 1 },
			{ x: 5, y: 1 },
			{ x: 6, y: 1 },
		]);
		if (!main.valid) throw new Error(main.reason);
		map.applyAtomicMutations(main.mutations, main.switchMutations ?? []);
		const branch = planRailConstruction(map, { x: 3, y: 0 }, { x: 3, y: -3 });
		if (!branch.valid) throw new Error(branch.reason);
		map.applyAtomicMutations(branch.mutations, branch.switchMutations ?? []);
		const distant = planRailConstruction(new TileMap(), { x: 100, y: 50 }, { x: 108, y: 50 });
		if (!distant.valid) throw new Error(distant.reason);
		map.applyAtomicMutations(distant.mutations, distant.switchMutations ?? []);
		expect(compilePhysicalRail(map).clearance.issues.count).toBeGreaterThan(0);

		const ownership = buildRailModuleOwnershipIndex(map);
		const roots = resolvedRoots(map, ownership.modules, emptyPortEquipmentState());
		const arrangement = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis: "Z",
			mode: "ALIGN_MAX",
			roots,
		});
		const plan = planStaticFabArrangement(
			map,
			ownership,
			emptyPortEquipmentState(),
			organizationState([]),
			0,
			roots,
			arrangement,
		);

		expect(plan).toMatchObject({
			valid: false,
			issueCode: "CLEARANCE_INVALID",
			mutations: [],
		});
		expect(plan.conflicts.length).toBeGreaterThan(0);
	});
});

function mapWithLines(lines: readonly (readonly [number, number, number, number])[]): TileMap {
	const map = new TileMap();
	const mutations = lines.flatMap(([fromX, fromZ, toX, toZ]) => {
		const plan = planRailConstruction(new TileMap(), { x: fromX, y: fromZ }, { x: toX, y: toZ });
		if (!plan.valid) throw new Error(plan.reason);
		return plan.mutations;
	});
	map.applyAtomicMutations(mutations, []);
	return map;
}

function resolvedRoots(
	map: TileMap,
	modules: readonly RailModuleOwnership[],
	equipment: PortEquipmentState,
) {
	const ownership = buildRailModuleOwnershipIndex(map);
	const rail = createRailAreaSelectionFromOwnerships(ownership, modules);
	const selection = createStaticFabSelection(rail, equipment, 0, []);
	const resolution = resolveStaticFabSelectionArrangementRoots(
		map,
		ownership,
		equipment,
		0,
		selection,
	);
	if (!resolution.valid) throw new Error(resolution.reason);
	return resolution.roots;
}

function oneOhbState(x: number, z: number): PortEquipmentState {
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({ kind: "CARDINAL_CELL" as const, x, z, from: DIR_W, to: DIR_E }),
				stationMillimeters: 500,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 1_000,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-STABLE",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
		]),
	});
}

function organization(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([]),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membership(modules, equipmentGroupIds),
	});
}

function membership(
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, RailModuleOwnership["eraseEdges"][number]>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) {
			edges.set(`${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`, edge);
		}
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds]),
	});
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId:
			records.length === 0 ? 1 : Math.max(...records.map((record) => record.id)) + 1,
		records: Object.freeze([...records]),
	});
}
