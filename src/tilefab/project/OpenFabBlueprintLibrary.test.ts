import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import {
	createOpenFabRailAreaBlueprint,
	createOpenFabStaticFabBlueprint,
	createOpenFabStaticFabOrganizationBlueprint,
	railAreaStampTemplateFromOpenFabBlueprint,
	staticFabBlueprintTemplateFromOpenFabBlueprint,
	updateOpenFabProjectBlueprint,
} from "./OpenFabBlueprintLibrary";

describe("OpenFabBlueprintLibrary", () => {
	it("drops revision-bound selection identity and restores portable relative geometry", () => {
		const blueprint = createOpenFabRailAreaBlueprint(TEMPLATE, {
			id: "blueprint-1",
			name: "Bay A",
			folder: "Bays/Photo",
			createdAt: "2026-07-22T00:00:00.000Z",
		});
		const restored = railAreaStampTemplateFromOpenFabBlueprint(blueprint);

		expect(blueprint).not.toHaveProperty("sourceRevision");
		expect(blueprint).not.toHaveProperty("sourceModuleKeys");
		expect(restored.sourceRevision).toBe(0);
		expect(restored.sourceModuleKeys).toEqual([]);
		expect(restored.edges.map((edge) => [edge.from.x, edge.from.y, edge.to.x, edge.to.y])).toEqual(
			blueprint.edges,
		);
	});

	it("updates library metadata without copying immutable geometry", () => {
		const blueprint = createOpenFabRailAreaBlueprint(TEMPLATE, {
			id: "blueprint-1",
			name: "Bay A",
			createdAt: "2026-07-22T00:00:00.000Z",
		});
		const updated = updateOpenFabProjectBlueprint(blueprint, {
			favorite: true,
			updatedAt: "2026-07-22T01:00:00.000Z",
		});

		expect(updated.favorite).toBe(true);
		expect(updated.edges).toBe(blueprint.edges);
	});

	it("converts a mixed static FAB without runtime port identity", () => {
		const blueprint = createOpenFabStaticFabBlueprint(STATIC_FAB_TEMPLATE, {
			id: "blueprint-static-fab",
			name: "Photo bay",
			createdAt: "2026-07-22T00:00:00.000Z",
		});
		const restored = staticFabBlueprintTemplateFromOpenFabBlueprint(blueprint);
		const updated = updateOpenFabProjectBlueprint(blueprint, {
			favorite: true,
			updatedAt: "2026-07-22T01:00:00.000Z",
		});

		expect(blueprint).not.toHaveProperty("sourceRevision");
		expect(blueprint.ports[0]).not.toHaveProperty("id");
		expect(blueprint.ports[0]).not.toHaveProperty("barcode");
		expect(restored.rail).toMatchObject({
			sourceRevision: 0,
			sourceModuleKeys: [],
			sourceModuleCount: STATIC_FAB_TEMPLATE.rail.sourceModuleCount,
		});
		expect(restored.rail.edges).toHaveLength(STATIC_FAB_TEMPLATE.rail.edges.length);
		expect(restored.ports).toEqual(STATIC_FAB_TEMPLATE.ports);
		expect(restored.equipmentGroups).toEqual(STATIC_FAB_TEMPLATE.equipmentGroups);
		if (updated.kind !== "STATIC_FAB") throw new Error("Expected updated static FAB blueprint.");
		expect(updated.ports).toBe(blueprint.ports);
		expect(updated.equipmentGroups).toBe(blueprint.equipmentGroups);
	});

	it("stores organization-aware authored truth as one canonical immutable portable bundle", () => {
		const captured = organizationBundleFixture();
		const mutable = JSON.parse(JSON.stringify(captured)) as {
			organizations: Array<{ name: string }>;
		};
		const blueprint = createOpenFabStaticFabOrganizationBlueprint(mutable, {
			id: "blueprint-organization-bay",
			name: "Organization bay",
			folder: "FAB/Organizations",
			createdAt: "2026-07-22T00:00:00.000Z",
		});
		const updated = updateOpenFabProjectBlueprint(blueprint, {
			favorite: true,
			updatedAt: "2026-07-22T01:00:00.000Z",
		});

		expect(blueprint.bundle).not.toBe(mutable);
		expect(Object.isFrozen(blueprint.bundle)).toBe(true);
		expect(Object.isFrozen(blueprint.bundle.organizations[0]?.membership)).toBe(true);
		expect(blueprint.sourceModuleCount).toBe(blueprint.bundle.sourceModuleCount);
		expect(blueprint.edges).toEqual(
			blueprint.bundle.railEdges.map((edge) => [edge.from.x, edge.from.y, edge.to.x, edge.to.y]),
		);
		const mutableOrganization = mutable.organizations[0];
		if (!mutableOrganization) throw new Error("Expected a mutable organization fixture.");
		mutableOrganization.name = "Mutated source";
		expect(blueprint.bundle.organizations[0]?.name).toBe("Portable Bay");
		expect(blueprint.bundle.organizations[1]?.parentOrganizationIndices).toEqual([0]);
		if (updated.kind !== "STATIC_FAB_ORGANIZATION") {
			throw new Error("Expected updated organization blueprint.");
		}
		expect(updated.bundle).toBe(blueprint.bundle);
		expect(updated.edges).toBe(blueprint.edges);
	});
});

const TEMPLATE: RailAreaStampTemplate = Object.freeze({
	sourceRevision: 42,
	sourceModuleKeys: Object.freeze(["module-a", "module-b"]),
	sourceModuleCount: 2,
	sourceEdgeCount: 4,
	sourceWidthMeters: 1,
	sourceHeightMeters: 1,
	edges: Object.freeze([
		Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 0 }), to: Object.freeze({ x: 1, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 1 }), to: Object.freeze({ x: 0, y: 1 }) }),
		Object.freeze({ from: Object.freeze({ x: 0, y: 1 }), to: Object.freeze({ x: 0, y: 0 }) }),
	]),
});

const STATIC_FAB_TEMPLATE: StaticFabBlueprintTemplate = Object.freeze({
	rail: Object.freeze({
		sourceRevision: 42,
		sourceModuleKeys: Object.freeze(["source-only-key"]),
		sourceModuleCount: 20,
		sourceEdgeCount: 20,
		sourceWidthMeters: 6,
		sourceHeightMeters: 4,
		edges: Object.freeze(rectangleEdges(6, 4)),
	}),
	ports: Object.freeze([
		port(0, 1, 0, 8, 2, "LEFT", 400, "WITH_TRAVEL", "OHB"),
		port(1, 2, 0, 8, 2, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		port(1, 3, 0, 8, 2, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		port(2, 5, 4, 2, 8, "CENTER", 0, "WITH_TRAVEL", "STK"),
		port(2, 4, 4, 2, 8, "CENTER", 0, "WITH_TRAVEL", "STK"),
		port(2, 3, 4, 2, 8, "CENTER", 0, "WITH_TRAVEL", "STK"),
		port(2, 2, 4, 2, 8, "CENTER", 0, "WITH_TRAVEL", "STK"),
	]),
	equipmentGroups: Object.freeze([
		Object.freeze({
			kind: "OHB" as const,
			template: "SINGLE" as const,
			portIndices: Object.freeze([0]),
		}),
		Object.freeze({
			kind: "EQ" as const,
			pitchMillimeters: 1_000,
			recipe: "PHOTO",
			portIndices: Object.freeze([1, 2]),
		}),
		Object.freeze({
			kind: "STK" as const,
			template: "FOUR_PORT" as const,
			portIndices: Object.freeze([3, 4, 5, 6]),
		}),
	]),
});

function port(
	equipmentGroupIndex: number,
	x: number,
	z: number,
	from: 1 | 2 | 4 | 8,
	to: 1 | 2 | 4 | 8,
	side: "CENTER" | "LEFT" | "RIGHT",
	lateralOffsetMillimeters: number,
	direction: "WITH_TRAVEL" | "AGAINST_TRAVEL",
	portType: "OHB" | "EQ" | "STK",
) {
	return Object.freeze({
		equipmentGroupIndex,
		route: Object.freeze({ kind: "CARDINAL_CELL" as const, x, z, from, to }),
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction,
		portType,
	});
}

function rectangleEdges(width: number, height: number) {
	const edges: Array<{
		readonly from: { readonly x: number; readonly y: number };
		readonly to: { readonly x: number; readonly y: number };
	}> = [];
	for (let x = 0; x < width; x++) edges.push(edge(x, 0, x + 1, 0));
	for (let y = 0; y < height; y++) edges.push(edge(width, y, width, y + 1));
	for (let x = width; x > 0; x--) edges.push(edge(x, height, x - 1, height));
	for (let y = height; y > 0; y--) edges.push(edge(0, y, 0, y - 1));
	return edges;
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}

function organizationBundleFixture(): StaticFabOrganizationBundle {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Organization bundle fixture rail failed: ${plan.reason}`);
	}
	const edgeByKey = new Map(
		buildRailModuleOwnershipIndex(document.map).modules.flatMap((module) =>
			module.eraseEdges.map(
				(railEdge) => [staticFabOrganizationEdgeKey(railEdge), railEdge] as const,
			),
		),
	);
	const railEdges = Object.freeze([...edgeByKey.values()].sort(compareDirectedRailEdges));
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 3,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "AREA" as const,
				name: "Portable Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "Reusable process bay", color: "CYAN" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([]),
				}),
			}),
			Object.freeze({
				id: 2,
				kind: "BAY" as const,
				name: "Nested Process Bay",
				parentOrganizationIds: Object.freeze([1]),
				properties: Object.freeze({ description: "Inherited bay", color: "AMBER" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([]),
				}),
			}),
		]),
	});
	const captured = captureStaticFabOrganizationBundle(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		organizations,
		[1],
		"EFFECTIVE",
	);
	if (!captured.valid) throw new Error(`Organization bundle fixture failed: ${captured.reason}`);
	return captured.bundle;
}
