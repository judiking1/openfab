import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import {
	materializePairedRailPerimeterTurnbackRoute,
	type PairedRailPerimeterPlan,
	type PairedRailPerimeterRequest,
} from "../core/PairedRailPerimeterPlanner";
import { classifyRailCell } from "../core/RailCellClassification";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { ALL_DIRECTIONS, DIR_E, DIR_N, DIR_S, moveCell } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION,
	type OpenFabFabInterBlockBridgeDirectedEdge,
	type OpenFabFabInterBlockBridgeRequest,
	openFabFabInterBlockBridgeFingerprint,
	openFabFabInterBlockBridgePlanFingerprint,
	planOpenFabFabInterBlockBridge,
	validateOpenFabFabInterBlockBridgeRequest,
} from "./OpenFabFabInterBlockBridgePlanner";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";

describe("OpenFabFabInterBlockBridgePlanner", () => {
	it.each([
		"EAST_WEST",
		"NORTH_SOUTH",
	] as const)("publishes four explicit outer-face junctions for %s Blocks", (axis) => {
		const plan = planOpenFabFabInterBlockBridge(request(axis));
		const leftX = axis === "EAST_WEST" ? 328 : 212;
		const rightX = leftX + 64;

		expect(plan).toMatchObject({
			kind: "openfab-fab-inter-block-bridge",
			geometryValid: true,
			placementReady: false,
			newEdges: 128,
			lengthMeters: 128,
			reusedPerimeterSupportEdgeReferences: 32,
			uniqueReusedPerimeterSupportEdges: axis === "EAST_WEST" ? 32 : 16,
			bounds:
				axis === "EAST_WEST"
					? { minX: 328, minY: 16, maxX: 392, maxY: 40 }
					: { minX: 212, minY: 24, maxX: 276, maxY: 32 },
		});
		expect(plan.junctions.map(({ id, role, cell }) => ({ id, role, cell }))).toEqual([
			{ id: "left-branch", role: "branch", cell: { x: leftX, y: 24 } },
			{ id: "right-merge", role: "merge", cell: { x: rightX, y: 24 } },
			{ id: "right-branch", role: "branch", cell: { x: rightX, y: 32 } },
			{ id: "left-merge", role: "merge", cell: { x: leftX, y: 32 } },
		]);
		expect(plan.junctions.map((junction) => junction.travelDirection)).toEqual(
			axis === "EAST_WEST" ? [DIR_S, DIR_N, DIR_N, DIR_S] : [DIR_N, DIR_S, DIR_S, DIR_N],
		);
		expect(plan.connections.map((connection) => connection.ownedEdgeRoute)).toEqual([
			straight({ x: leftX, y: 24 }, { x: rightX, y: 24 }),
			straight({ x: rightX, y: 32 }, { x: leftX, y: 32 }),
		]);
		expect(plan.connections.every((connection) => connection.planningRoute.length === 81)).toBe(
			true,
		);
		expect(
			plan.connections.every((connection) => connection.ownedDirectedEdges.length === 64),
		).toBe(true);
		expect(
			plan.connections.every(
				(connection) => connection.reusedPerimeterSupportDirectedEdges.length === 16,
			),
		).toBe(true);
	});

	it.each([
		"EAST_WEST",
		"NORTH_SOUTH",
	] as const)("composes two %s Block perimeters into one exact authored and physical network", (axis) => {
		const plan = planOpenFabFabInterBlockBridge(request(axis));
		const map = new TileMap();
		applyPerimeter(map, plan.leftPerimeter);
		applyPerimeter(map, plan.rightPerimeter);
		const edgesBefore = mapDirectedEdgeKeys(map);
		for (const connection of plan.connections) {
			for (const edge of connection.reusedPerimeterSupportDirectedEdges) {
				expect(edgesBefore.has(edgeKey(edge))).toBe(true);
			}
		}

		const construction = planRailRouteBatch(map, plan.buildRoutes);
		expect(construction.valid, construction.reason).toBe(true);
		expect(construction.newEdges).toBe(plan.newEdges);
		map.applyAtomicMutations(construction.mutations, []);
		const addedEdges = [...mapDirectedEdgeKeys(map)].filter((key) => !edgesBefore.has(key)).sort();
		expect(addedEdges).toEqual(plan.ownershipIntent.directedEdges.map(edgeKey).sort());
		expect(
			plan.junctions.map((junction) =>
				classifyRailCell(map.getRail(junction.cell.x, junction.cell.y)),
			),
		).toEqual(["BRANCH", "MERGE", "BRANCH", "MERGE"]);

		expect(analyzeRailNetwork(map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		const physical = compilePhysicalRail(map);
		expect(physical.valid).toBe(true);
		expect(physical.terminals).toHaveLength(0);
		expect(physical.diagnostics).toEqual([]);
		expect(physical.clearance.issues.count).toBe(0);
		expect(analyzePhysicalPathTopology(physical.paths)).toMatchObject({
			strongComponents: 1,
			openPaths: 0,
			invalidPaths: 0,
		});
	});

	it("rejects malformed, misaligned, and unsupported requests", () => {
		const valid = request("EAST_WEST");
		expect(validateOpenFabFabInterBlockBridgeRequest(valid)).toBeNull();
		expect(validateOpenFabFabInterBlockBridgeRequest({ ...valid, version: 2 })).toMatch(
			/version must be 1/,
		);
		expect(validateOpenFabFabInterBlockBridgeRequest({ ...valid, extra: true })).toMatch(
			/fields do not match/,
		);
		expect(validateOpenFabFabInterBlockBridgeRequest({ ...valid, ownerKey: " fab-1" })).toMatch(
			/owner key/,
		);
		expect(
			validateOpenFabFabInterBlockBridgeRequest({ ...valid, ownerKey: "x".repeat(161) }),
		).toMatch(/owner key/);
		expect(validateOpenFabFabInterBlockBridgeRequest({ ...valid, ownerKey: "fab\0-1" })).toMatch(
			/owner key/,
		);
		expect(
			validateOpenFabFabInterBlockBridgeRequest({
				...valid,
				leftPerimeter: { ...valid.leftPerimeter, version: undefined },
			}),
		).toMatch(/left perimeter version/);
		expect(
			validateOpenFabFabInterBlockBridgeRequest({
				...valid,
				rightPerimeter: {
					...valid.rightPerimeter,
					anchor: { x: 391, y: 0 },
				},
			}),
		).toMatch(/separated by 64 meters/);
		expect(
			validateOpenFabFabInterBlockBridgeRequest({
				...valid,
				rightPerimeter: {
					...valid.rightPerimeter,
					pose: { ...valid.rightPerimeter.pose, flow: "reverse" },
				},
			}),
		).toMatch(/same dimensions and pose/);
		const shallowLeft = perimeterRequest("EAST_WEST", 0, 32);
		const shallowRight = perimeterRequest("EAST_WEST", 392, 32);
		expect(
			validateOpenFabFabInterBlockBridgeRequest({
				version: 1,
				ownerKey: "fab-1",
				leftPerimeter: shallowLeft,
				rightPerimeter: shallowRight,
			}),
		).toMatch(/straight support window/);
	});

	it("binds owner, perimeter geometry, and hidden bridge policy in its fingerprint", () => {
		const base = request("EAST_WEST");
		const shifted: OpenFabFabInterBlockBridgeRequest = {
			...base,
			leftPerimeter: { ...base.leftPerimeter, anchor: { x: 10, y: 20 } },
			rightPerimeter: { ...base.rightPerimeter, anchor: { x: 402, y: 20 } },
		};
		const fingerprint = openFabFabInterBlockBridgeFingerprint(base);
		expect(fingerprint).toBe(planOpenFabFabInterBlockBridge(base).fingerprint);
		expect(openFabFabInterBlockBridgeFingerprint({ ...base, ownerKey: "fab-2" })).not.toBe(
			fingerprint,
		);
		expect(openFabFabInterBlockBridgeFingerprint(shifted)).not.toBe(fingerprint);
		const { fingerprint: ignored, ...withoutFingerprint } = planOpenFabFabInterBlockBridge(base);
		void ignored;
		const forged = {
			...withoutFingerprint,
			ownershipIntent: {
				...withoutFingerprint.ownershipIntent,
				directedEdges: withoutFingerprint.ownershipIntent.directedEdges.slice(1),
			},
		};
		expect(openFabFabInterBlockBridgePlanFingerprint(forged)).not.toBe(fingerprint);
		const first = withoutFingerprint.connections[0];
		const second = withoutFingerprint.connections[1];
		const shiftedCell = second.planningRoute[0];
		if (!shiftedCell) throw new Error("Expected the second bridge route.");
		const shiftedConnections = Object.freeze([
			Object.freeze({
				...first,
				planningRoute: Object.freeze([...first.planningRoute, shiftedCell]),
			}),
			Object.freeze({
				...second,
				planningRoute: Object.freeze(second.planningRoute.slice(1)),
			}),
		]) as unknown as typeof withoutFingerprint.connections;
		const shiftedBoundaries = {
			...withoutFingerprint,
			connections: shiftedConnections,
			buildRoutes: Object.freeze([
				shiftedConnections[0].planningRoute,
				shiftedConnections[1].planningRoute,
			]) as typeof withoutFingerprint.buildRoutes,
		};
		expect(openFabFabInterBlockBridgePlanFingerprint(shiftedBoundaries)).not.toBe(fingerprint);
		expect(() =>
			openFabFabInterBlockBridgePlanFingerprint({
				...withoutFingerprint,
				buildRoutes: Object.freeze([
					withoutFingerprint.buildRoutes[0].slice(0, -1),
					withoutFingerprint.buildRoutes[1],
				]) as typeof withoutFingerprint.buildRoutes,
			}),
		).toThrow(/build routes do not match/i);
		expect(fingerprint).toBe("6b335bff:62920c48");
	});
});

function request(axis: "EAST_WEST" | "NORTH_SOUTH"): OpenFabFabInterBlockBridgeRequest {
	return {
		version: OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION,
		ownerKey: "fab-1",
		leftPerimeter: perimeterRequest(axis, 0, 212),
		rightPerimeter: perimeterRequest(axis, axis === "EAST_WEST" ? 392 : 276, 212),
	};
}

function perimeterRequest(
	axis: "EAST_WEST" | "NORTH_SOUTH",
	anchorX: number,
	height: number,
): PairedRailPerimeterRequest {
	return axis === "EAST_WEST"
		? {
				version: 1,
				anchor: { x: anchorX, y: 0 },
				forwardSpanMeters: 328,
				sideSpanMeters: height,
				laneSpacingMeters: 4,
				pose: { forward: DIR_E, side: "right", flow: "forward" },
			}
		: {
				version: 1,
				anchor: { x: anchorX, y: 0 },
				forwardSpanMeters: 328,
				sideSpanMeters: height,
				laneSpacingMeters: 4,
				pose: { forward: DIR_S, side: "left", flow: "forward" },
			};
}

function applyPerimeter(map: TileMap, perimeter: PairedRailPerimeterPlan): void {
	for (const route of perimeter.buildRoutes) applyRoutes(map, [route], "free-closed-primary");
	for (const turnback of perimeter.turnbacks) {
		applyRoutes(map, [materializePairedRailPerimeterTurnbackRoute(turnback)], "connected");
	}
}

function applyRoutes(
	map: TileMap,
	routes: readonly (readonly Readonly<{ x: number; y: number }>[])[],
	placement: "connected" | "free-closed-primary",
): void {
	const construction = planRailRouteBatch(map, routes, placement);
	expect(construction.valid, construction.reason).toBe(true);
	map.applyAtomicMutations(construction.mutations, []);
}

function straight(
	from: Readonly<{ x: number; y: number }>,
	to: Readonly<{ x: number; y: number }>,
): readonly Readonly<{ x: number; y: number }>[] {
	const dx = Math.sign(to.x - from.x);
	const dy = Math.sign(to.y - from.y);
	const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
	return Array.from({ length: length + 1 }, (_, index) => ({
		x: from.x + dx * index,
		y: from.y + dy * index,
	}));
}

function edgeKey(edge: OpenFabFabInterBlockBridgeDirectedEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function mapDirectedEdgeKeys(map: TileMap): ReadonlySet<string> {
	const edges = new Set<string>();
	map.forEachRail((x, y, rail) => {
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) === 0) continue;
			const to = moveCell({ x, y }, direction);
			edges.add(`${x},${y}>${to.x},${to.y}`);
		}
	});
	return edges;
}
