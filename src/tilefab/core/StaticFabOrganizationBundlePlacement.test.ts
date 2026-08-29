import { describe, expect, it } from "vitest";
import {
	applyPortEquipmentMutations,
	type EquipmentGroupRecord,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { portEquipmentLayoutError } from "./PortEquipmentLayoutValidator";
import type { CardinalPortRoute, PortRecord } from "./PortRecord";
import { planRailPath } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_W, type Direction, oppositeDirection } from "./railShape";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	materializeStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "./StaticFabOrganizationBundle";
import {
	isIssuedStaticFabOrganizationBundlePlacementPlan,
	isStaticFabOrganizationBundlePlacementPlanIssuedFor,
	planStaticFabOrganizationBundlePlacement,
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
} from "./StaticFabOrganizationBundlePlacement";
import type { Cell } from "./TileMap";

describe("StaticFabOrganizationBundlePlacement", () => {
	it("plans rail, equipment, and organization records as one valid placement", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const planning = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			target.map,
			equipment,
			17,
			organizations,
			bundle,
			{ x: 120, y: 45 },
			0,
			null,
		);
		const plan = planning.plan;

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.baseRevision).toBe(0);
		expect(plan.basePatchSequence).toBe(17);
		expect(plan.mutations.length).toBeGreaterThan(0);
		expect(plan.portMutations).toHaveLength(7);
		expect(plan.equipmentGroupMutations).toHaveLength(3);
		expect(plan.organizationMutations).toHaveLength(2);
		expect(plan.organizationMutations[1]?.after?.parentOrganizationIds).toEqual([1]);
		expect(plan.organizationMutations[0]?.after?.membership.equipmentGroupIds).toEqual([1, 2, 3]);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(true);
		expect(planning.prospectiveState).not.toBeNull();

		const placedMap = target.map.clone();
		expect(placedMap.applyAtomicMutations(plan.mutations, plan.switchMutations)).toBe(true);
		const placedEquipment = applyPortEquipmentMutations(
			equipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
		const placedOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			plan.organizationMutations,
			plan.nextOrganizationIdAfter,
		);

		expect(portEquipmentLayoutError(placedMap, placedEquipment)).toBeNull();
		expect(
			staticFabOrganizationStateError(placedMap, placedEquipment, placedOrganizations),
		).toBeNull();
		expect(placedEquipment.ports.map((port) => port.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(placedOrganizations.records.map((record) => record.name)).toEqual([
			"Factory",
			"Process Bay",
		]);
		expect(planning.prospectiveState?.portEquipment).toEqual(placedEquipment);
		expect(planning.prospectiveState?.organizations).toEqual(placedOrganizations);
		for (const mutation of plan.mutations) {
			expect(planning.prospectiveState?.map.getEncoded(mutation.x, mutation.y)).toBe(
				mutation.after,
			);
		}
	});

	it("allocates deterministic fresh IDs, barcodes, parent links, and collision-free names", () => {
		const bundle = capturedOrganizationBundle();
		const equipmentA = emptyEquipmentAt(41, 7);
		const equipmentB = emptyEquipmentAt(41, 7);
		const targetA = longBayDocument();
		const targetB = longBayDocument();
		const organizationsA = namingCollisionState(targetA);
		const organizationsB = namingCollisionState(targetB);
		const anchor = { x: 80, y: -30 };
		const first = planStaticFabOrganizationBundlePlacement(
			targetA.map,
			equipmentA,
			9,
			organizationsA,
			bundle,
			anchor,
			0,
			null,
		);
		const second = planStaticFabOrganizationBundlePlacement(
			targetB.map,
			equipmentB,
			9,
			organizationsB,
			bundle,
			anchor,
			0,
			null,
		);

		expect(first.valid, first.reason).toBe(true);
		expect(second.valid, second.reason).toBe(true);
		expect(first.portMutations.map((mutation) => mutation.id)).toEqual([
			41, 42, 43, 44, 45, 46, 47,
		]);
		expect(first.equipmentGroupMutations.map((mutation) => mutation.id)).toEqual([7, 8, 9]);
		expect(first.organizationMutations.map((mutation) => mutation.id)).toEqual([50, 51]);
		expect(first.nextOrganizationIdBefore).toBe(50);
		expect(first.nextOrganizationIdAfter).toBe(52);
		expect(first.organizationBundle.organizationNames).toEqual([
			"Factory copy 2",
			"Process Bay copy",
		]);
		expect(first.organizationMutations[1]?.after?.parentOrganizationIds).toEqual([50]);
		expect(first.portMutations.map((mutation) => mutation.after?.barcode)).toEqual(
			second.portMutations.map((mutation) => mutation.after?.barcode),
		);
		expect(first.mutations).toEqual(second.mutations);
		expect(first.portMutations).toEqual(second.portMutations);
		expect(first.equipmentGroupMutations).toEqual(second.equipmentGroupMutations);
		expect(first.organizationMutations).toEqual(second.organizationMutations);
	});

	it("rejects an occupied footprint without issuing partial mutations", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const anchor = { x: 30, y: 60 };
		const materialized = materializeStaticFabOrganizationBundle(bundle, anchor, 0);
		const occupiedEdge = materialized.railEdges[0];
		if (!occupiedEdge) throw new Error("Expected captured rail edges.");
		const occupied = planRailPath(target.map, [occupiedEdge.from, occupiedEdge.to]);
		expect(occupied.valid, occupied.reason).toBe(true);
		expect(target.commit(occupied)).toBe(true);

		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			target.portEquipment,
			target.getPatchSequence(),
			target.organizations,
			bundle,
			anchor,
			0,
			null,
		);

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("빈 footprint");
		expect(plan.conflicts).toEqual(expect.arrayContaining([occupiedEdge.from, occupiedEdge.to]));
		expect(plan.mutations).toEqual([]);
		expect(plan.portMutations).toEqual([]);
		expect(plan.equipmentGroupMutations).toEqual([]);
		expect(plan.organizationMutations).toEqual([]);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(false);
	});

	it("binds issuance to exact source identities and carries stale-detection generations", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			equipment,
			23,
			organizations,
			bundle,
			{ x: -90, y: 25 },
			0,
			null,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(true);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map,
				equipment,
				organizations,
			),
		).toBe(true);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map.clone(),
				equipment,
				organizations,
			),
		).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map,
				Object.freeze({ ...equipment }),
				organizations,
			),
		).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map,
				equipment,
				Object.freeze({ ...organizations }),
			),
		).toBe(false);

		const forged = Object.freeze({ ...plan });
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(forged)).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				forged,
				target.map,
				equipment,
				organizations,
			),
		).toBe(false);

		const plannedRevision = plan.baseRevision;
		expect(target.map.setEncoded(10_000, -10_000, 0x12)).toBe(true);
		expect(target.map.getRevision()).not.toBe(plannedRevision);
		expect(plan.basePatchSequence).toBe(23);

		const invalidSequence = planStaticFabOrganizationBundlePlacement(
			target.map,
			equipment,
			-1,
			organizations,
			bundle,
			{ x: 0, y: 0 },
			0,
			null,
		);
		expect(invalidSequence.valid).toBe(false);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(invalidSequence)).toBe(false);
	});

	it("rotates rail and cardinal port identities around the portable origin", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const anchor = { x: 210, y: -75 };
		const materialized = materializeStaticFabOrganizationBundle(bundle, anchor, 1);
		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			target.portEquipment,
			target.getPatchSequence(),
			target.organizations,
			bundle,
			anchor,
			1,
			null,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.organizationBundle).toMatchObject({
			anchor,
			quarterTurns: 1,
			widthMeters: bundle.sourceHeightMeters,
			heightMeters: bundle.sourceWidthMeters,
		});
		expect(new Set(plan.cells.map(cellKey))).toEqual(
			new Set(materialized.railEdges.flatMap((edge) => [cellKey(edge.from), cellKey(edge.to)])),
		);
		for (const [index, portable] of materialized.ports.entries()) {
			const placed = plan.portMutations[index]?.after;
			if (!placed) throw new Error(`Expected placed PORT-${index}.`);
			expect(placed.route).toEqual(portable.route);
			expect(placed.stationMillimeters).toBe(portable.stationMillimeters);
			expect(placed.side).toBe(portable.side);
			expect(placed.direction).toBe(portable.direction);
		}
		const root = plan.organizationMutations[0]?.after;
		if (!root) throw new Error("Expected placed root organization.");
		const expectedRootEdges = materialized.organizations[0]?.membership.railEdgeIndices
			.map((index) => materialized.railEdges[index])
			.filter((edge): edge is DirectedRailEdge => edge !== undefined)
			.sort(compareDirectedRailEdges);
		expect(root.membership.railEdges).toEqual(expectedRootEdges);
	});

	it("contains malformed bundle input as an unissued invalid plan without throwing", () => {
		const target = new RailDocument();
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const valid = capturedOrganizationBundle();
		const malformedPortBundle = JSON.parse(JSON.stringify(valid)) as {
			ports: Array<{ route: unknown }>;
		};
		if (malformedPortBundle.ports[0]) malformedPortBundle.ports[0].route = null;
		const throwingRecord = Object.defineProperty({}, "version", {
			get(): never {
				throw new Error("hostile getter");
			},
		});
		const malformedInputs: readonly unknown[] = [
			null,
			{},
			{ version: 1 },
			malformedPortBundle,
			throwingRecord,
		];

		for (const malformed of malformedInputs) {
			let plan: ReturnType<typeof planStaticFabOrganizationBundlePlacement> | undefined;
			expect(() => {
				plan = planStaticFabOrganizationBundlePlacement(
					target.map,
					equipment,
					0,
					organizations,
					malformed,
					{ x: 0, y: 0 },
					0,
					null,
				);
			}).not.toThrow();
			if (!plan) throw new Error("Planner did not return an invalid plan.");
			expect(plan.valid).toBe(false);
			expect(plan.mutations).toEqual([]);
			expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(false);
		}
	});
});

function capturedOrganizationBundle(): StaticFabOrganizationBundle {
	const source = longBayDocument();
	const modules = [...buildRailModuleOwnershipIndex(source.map).modules].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (modules.length < 4) throw new Error("Expected at least four Long Bay modules.");
	const equipment = mixedEquipmentState(source);
	const organizations = organizationState(
		[
			organizationRecord(10, "AREA", "Factory", [], modules, [1, 2, 3]),
			organizationRecord(20, "BAY", "Process Bay", [10], modules.slice(0, 1), []),
		],
		21,
	);
	const capture = captureStaticFabOrganizationBundle(
		source.map,
		equipment,
		source.getPatchSequence(),
		organizations,
		[10],
		"EFFECTIVE",
	);
	expect(capture.valid, capture.reason).toBe(true);
	if (!capture.valid) throw new Error(capture.reason);
	return capture.bundle;
}

function longBayDocument(): RailDocument {
	const source = new RailDocument();
	const template = planRailTemplate(
		source.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(template.valid, template.reason).toBe(true);
	expect(source.commit(template)).toBe(true);
	return source;
}

function emptyEquipmentAt(nextPortId: number, nextEquipmentGroupId: number): PortEquipmentState {
	return Object.freeze({
		nextPortId,
		nextEquipmentGroupId,
		ports: Object.freeze([]),
		equipmentGroups: Object.freeze([]),
	});
}

function namingCollisionState(document: RailDocument): StaticFabOrganizationState {
	const modules = [...buildRailModuleOwnershipIndex(document.map).modules].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (modules.length < 3) throw new Error("Expected three modules for organization names.");
	return organizationState(
		[
			organizationRecord(4, "AREA", "Factory", [], modules.slice(0, 1), []),
			organizationRecord(9, "AREA", "Factory copy", [], modules.slice(1, 2), []),
			organizationRecord(20, "BAY", "Process Bay", [], modules.slice(2, 3), []),
		],
		50,
	);
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
	nextOrganizationId: number,
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId,
		records: Object.freeze([...records].sort((left, right) => left.id - right.id)),
	});
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membershipFromModules(modules, equipmentGroupIds),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(edgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function mixedEquipmentState(document: RailDocument): PortEquipmentState {
	const runs = straightRuns(document).filter((run) => run.length >= 4);
	const [ohbRun, eqRun, stkRun] = runs;
	if (!ohbRun || !eqRun || !stkRun) {
		throw new Error("Long Bay fixture needs three straight rail runs.");
	}
	const ports: PortRecord[] = [
		port(1, 1, ohbRun[0] as RouteCell, "OHB", "LEFT", 700),
		port(2, 2, eqRun[0] as RouteCell, "EQ", "CENTER", 0),
		port(3, 2, eqRun[1] as RouteCell, "EQ", "CENTER", 0),
		...stkRun.slice(0, 4).map((route, index) => port(index + 4, 3, route, "STK", "CENTER", 0)),
	];
	const equipmentGroups: EquipmentGroupRecord[] = [
		{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
		{
			id: 2,
			kind: "EQ",
			pitchMillimeters: 1_000,
			recipe: "PHOTO",
			portIds: [2, 3],
		},
		{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
	];
	return Object.freeze({
		nextPortId: 40,
		nextEquipmentGroupId: 20,
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
	});
}

interface RouteCell {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
}

function straightRuns(document: RailDocument): RouteCell[][] {
	const routes = new Map<string, RouteCell>();
	document.map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const from = rail.incoming as Direction;
		const to = rail.outgoing as Direction;
		routes.set(`${x}:${z}:${from}:${to}`, { x, z, from, to });
	});
	const visited = new Set<string>();
	const runs: RouteCell[][] = [];
	for (const route of routes.values()) {
		const key = `${route.x}:${route.z}:${route.from}:${route.to}`;
		if (visited.has(key)) continue;
		const backward = moveRouteCell(route, oppositeDirection(route.to));
		if (routes.has(`${backward.x}:${backward.z}:${route.from}:${route.to}`)) continue;
		const run: RouteCell[] = [];
		let current: RouteCell | undefined = route;
		while (current) {
			const currentKey = `${current.x}:${current.z}:${current.from}:${current.to}`;
			if (visited.has(currentKey)) break;
			visited.add(currentKey);
			run.push(current);
			const next = moveRouteCell(current, current.to);
			current = routes.get(`${next.x}:${next.z}:${current.from}:${current.to}`);
		}
		runs.push(run);
	}
	return runs.sort((left, right) => right.length - left.length);
}

function moveRouteCell(
	cell: Pick<RouteCell, "x" | "z">,
	direction: Direction,
): { x: number; z: number } {
	if (direction === DIR_E) return { x: cell.x + 1, z: cell.z };
	if (direction === DIR_W) return { x: cell.x - 1, z: cell.z };
	return direction === DIR_N ? { x: cell.x, z: cell.z - 1 } : { x: cell.x, z: cell.z + 1 };
}

function port(
	id: number,
	equipmentGroupId: number,
	route: RouteCell,
	portType: "OHB" | "EQ" | "STK",
	side: "LEFT" | "CENTER",
	lateralOffsetMillimeters: number,
): PortRecord {
	return Object.freeze({
		id,
		equipmentGroupId,
		route: Object.freeze({ kind: "CARDINAL_CELL", ...route }) satisfies CardinalPortRoute,
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction: "WITH_TRAVEL",
		portType,
		barcode: `${portType}-${id}`,
	});
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function cellKey(cell: Cell): string {
	return `${cell.x},${cell.y}`;
}
