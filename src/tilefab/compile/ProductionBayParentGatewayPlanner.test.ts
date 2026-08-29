import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import {
	materializeClosedPairedRailCorridorRoute,
	type PairedRailCorridorRequest,
} from "../core/PairedRailCorridorPlanner";
import type { ProductionBayModuleRequest } from "../core/ProductionBayModulePlanner";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { ALL_DIRECTIONS, DIR_E, DIR_S, DIR_W, moveCell } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	createOpenFabFabAssemblyPlan,
	type OpenFabFabBankAssemblyPlan,
} from "./OpenFabFabAssemblyPlan";
import {
	defaultOpenFabFabProfile,
	OPENFAB_FAB_BANK_REPETITION_AXES,
	OPENFAB_FAB_BAY_PACKING_POLICIES,
	OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS,
	OPENFAB_FAB_PROCESS_LOOPS_PER_BANK,
} from "./OpenFabFabProfile";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	PRODUCTION_BAY_PARENT_GATEWAY_OWNER,
	PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION,
	PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS,
	type ProductionBayParentGatewayBankRepetitionAxis,
	type ProductionBayParentGatewayDirectedEdge,
	type ProductionBayParentGatewayRequest,
	planProductionBayParentGateway,
	productionBayParentGatewayFingerprint,
	validateProductionBayParentGatewayRequest,
} from "./ProductionBayParentGatewayPlanner";

const TOPOLOGY_CASES = (["EAST_WEST", "NORTH_SOUTH"] as const).flatMap((axis) =>
	([12, 14, 16] as const).flatMap((pitch) =>
		(["SINGLE", "TWIN"] as const).map((variant) => ({ axis, pitch, variant })),
	),
);

const PACKED_BANK_CASES = OPENFAB_FAB_BANK_REPETITION_AXES.flatMap((axis) =>
	OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS.flatMap((pitch) =>
		OPENFAB_FAB_BAY_PACKING_POLICIES.flatMap((packing) =>
			OPENFAB_FAB_PROCESS_LOOPS_PER_BANK.map((loops) => ({
				axis,
				pitch,
				packing,
				loops,
			})),
		),
	),
);

describe("ProductionBayParentGatewayPlanner", () => {
	it.each(
		TOPOLOGY_CASES,
	)("joins a $axis $variant P$pitch Bay and closed Bank collector as one exact network", ({
		axis,
		pitch,
		variant,
	}) => {
		const plan = planProductionBayParentGateway(request(axis, variant, pitch));
		expect(plan.newEdges).toBe(pitch + 10);
		expect(plan.reusedBaySupportEdges).toBe(16);
		expect(plan.connections[0].ownedDirectedEdges).toHaveLength(12);
		expect(plan.connections[1].ownedDirectedEdges).toHaveLength(pitch - 2);
		const map = new TileMap();
		applyRoutes(
			map,
			[materializeClosedPairedRailCorridorRoute(plan.collector)],
			"free-closed-primary",
		);
		applyRoutes(map, plan.bay.buildRoutes, "free-closed-primary");
		const edgesBeforeGateway = mapDirectedEdgeKeys(map);

		const gatewayConstruction = planRailRouteBatch(map, plan.buildRoutes);
		expect(gatewayConstruction.valid, gatewayConstruction.reason).toBe(true);
		expect(gatewayConstruction.newEdges).toBe(plan.newEdges);
		map.applyAtomicMutations(gatewayConstruction.mutations, []);
		const addedEdges = [...mapDirectedEdgeKeys(map)]
			.filter((key) => !edgesBeforeGateway.has(key))
			.sort();
		expect(addedEdges).toEqual(plan.ownershipIntent.directedEdges.map(edgeKey).sort());

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
	});

	it.each(
		PACKED_BANK_CASES,
	)("composes a whole $axis P$pitch $packing Bank with $loops Process Loops", ({
		axis,
		pitch,
		packing,
		loops,
	}) => {
		const assembly = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 1,
			bankRepetitionAxis: axis,
			banksPerLayoutBlock: 1,
			processLoopsPerBank: loops,
			bayPackingPolicy: packing,
			processLoopCenterPitchMeters: pitch,
		});
		const bank = assembly.layoutBlocks[0]?.banks[0];
		if (!bank) throw new Error("Expected one planned Bank.");
		certifyWholeBank(bank);
	});

	it.each(
		OPENFAB_FAB_BANK_REPETITION_AXES.flatMap((axis) =>
			OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS.flatMap((pitch) =>
				OPENFAB_FAB_PROCESS_LOOPS_PER_BANK.map((loops) => ({ axis, pitch, loops })),
			),
		),
	)("also certifies phase-shifted $axis P$pitch Balanced Bank with $loops loops", ({
		axis,
		pitch,
		loops,
	}) => {
		const assembly = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 1,
			bankRepetitionAxis: axis,
			banksPerLayoutBlock: 2,
			processLoopsPerBank: loops,
			bayPackingPolicy: "BALANCED_V1",
			processLoopCenterPitchMeters: pitch,
		});
		const bank = assembly.layoutBlocks[0]?.banks[1];
		if (!bank) throw new Error("Expected the phase-shifted second Bank.");
		expect(bank.bays[0]?.plan.dimensions.processLoopCount).toBe(2);
		certifyWholeBank(bank);
	});

	it("exposes only the two newly authored stems as BANK ownership", () => {
		const plan = planProductionBayParentGateway(request("EAST_WEST", "TWIN", 14));
		const nearLaneCells = new Set(
			plan.collector.lanes[1].cells.map((cell) => `${cell.x},${cell.y}`),
		);
		const bayShellEdges = new Set(directedEdges(plan.bay.outerLoop.cells).map(edgeKey));
		const ownedKeys = plan.ownershipIntent.directedEdges.map(edgeKey);
		const supportKeys = plan.connections.flatMap((connection) =>
			connection.reusedBaySupportDirectedEdges.map(edgeKey),
		);

		expect(plan).toMatchObject({
			kind: "production-bay-parent-gateway",
			geometryValid: true,
			placementReady: false,
			specification: {
				version: PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION,
				topologyPolicy: "staggered-service-band-two-stem-v1",
				processLoopCenterPitchMeters: 14,
				collectorNearLaneId: "secondary",
				collectorLaneSpacingMeters: 2,
				baySetbackMeters: 12,
				shellSupportOverlapMeters: 8,
				serviceBandMeters: 4,
				slotInsetMeters: 2,
				minimumCollectorEndClearanceMeters: 3,
			},
			ownershipIntent: {
				owner: PRODUCTION_BAY_PARENT_GATEWAY_OWNER,
				scope: "ADDED_DIRECTED_EDGES_ONLY",
			},
			newEdges: 24,
			lengthMeters: 24,
			reusedBaySupportEdges: 16,
		});
		expect(plan.connections.map((connection) => connection.id)).toEqual(["outbound", "return"]);
		expect(plan.connections.map((connection) => connection.sourceGatewayRole)).toEqual([
			"branch",
			"branch",
		]);
		expect(plan.connections.map((connection) => connection.targetGatewayRole)).toEqual([
			"merge",
			"merge",
		]);
		expect(plan.buildSteps.every((step) => step.owner === "BANK")).toBe(true);
		expect(plan.buildSteps.flatMap((step) => step.ownedDirectedEdges).map(edgeKey)).toEqual(
			ownedKeys,
		);
		expect(new Set(ownedKeys).size).toBe(ownedKeys.length);
		expect(new Set(supportKeys).size).toBe(supportKeys.length);
		expect(supportKeys.every((key) => bayShellEdges.has(key))).toBe(true);
		expect(ownedKeys.every((key) => !bayShellEdges.has(key))).toBe(true);
		expect(
			nearLaneCells.has(`${plan.connections[0].branchCell.x},${plan.connections[0].branchCell.y}`),
		).toBe(true);
		expect(
			nearLaneCells.has(`${plan.connections[1].mergeCell.x},${plan.connections[1].mergeCell.y}`),
		).toBe(true);
		for (const connection of plan.connections) {
			expect(connection.reusedBaySupportDirectedEdges).toHaveLength(
				PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS,
			);
			expect(connection.ownedDirectedEdges).toHaveLength(12);
		}
	});

	it("normalizes immutably and fingerprints every child geometry choice", () => {
		const base = request("EAST_WEST", "SINGLE", 12);
		const clone = JSON.parse(JSON.stringify(base)) as ProductionBayParentGatewayRequest;
		const shifted = request("EAST_WEST", "SINGLE", 12, 17);
		const first = planProductionBayParentGateway(base);
		const second = planProductionBayParentGateway(clone);

		expect(second.fingerprint).toBe(first.fingerprint);
		expect(productionBayParentGatewayFingerprint(base)).toBe(first.fingerprint);
		expect(productionBayParentGatewayFingerprint(shifted)).not.toBe(first.fingerprint);
		expect(first.fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(first.specification.collectorPlanFingerprint).toBe(first.collector.fingerprint);
		expect(first.specification.bayPlanFingerprint).toBe(first.bay.fingerprint);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.buildRoutes)).toBe(true);
		expect(Object.isFrozen(first.ownershipIntent.directedEdges)).toBe(true);
	});

	it("rejects a Twin Bay whose child geometry contradicts the declared center pitch", () => {
		const base = request("EAST_WEST", "TWIN", 12);
		const malformed = {
			...base,
			bay: { ...base.bay, processLoopGapMeters: 4 },
		};
		expect(validateProductionBayParentGatewayRequest(malformed)).toMatch(
			/Twin Bay Process Loop centers must be 12 meters apart.*produces 10 meters/i,
		);
		expect(() =>
			planProductionBayParentGateway(malformed as ProductionBayParentGatewayRequest),
		).toThrow(/centers must be 12 meters apart/i);
	});

	it.each([
		{
			name: "unknown top-level field",
			mutate: (base: ProductionBayParentGatewayRequest) => ({ ...base, hidden: true }),
			reason: /fields do not match/i,
		},
		{
			name: "missing version",
			mutate: (base: ProductionBayParentGatewayRequest) => {
				const withoutVersion: { version?: number } & Record<string, unknown> = {
					...base,
				};
				delete withoutVersion.version;
				return withoutVersion;
			},
			reason: /version must be 1/i,
		},
		{
			name: "unsupported version",
			mutate: (base: ProductionBayParentGatewayRequest) => ({ ...base, version: 2 }),
			reason: /version must be 1/i,
		},
		{
			name: "unsupported Process Loop pitch",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				processLoopCenterPitchMeters: 13,
			}),
			reason: /center pitch must be 12, 14, or 16 meters/i,
		},
		{
			name: "non-grid collector anchor",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				collector: { ...base.collector, anchor: { x: 0.5, y: 0 } },
			}),
			reason: /signed-int32 integer coordinates/i,
		},
		{
			name: "wide collector lane pair",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				collector: { ...base.collector, laneSpacingMeters: 4 },
			}),
			reason: /lane spacing must be 2/i,
		},
		{
			name: "collector axis mismatch",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				collector: {
					...base.collector,
					pose: { forward: DIR_S, side: "right", flow: "reverse" },
				},
			}),
			reason: /direction does not match/i,
		},
		{
			name: "far collector lane flow",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				collector: {
					...base.collector,
					pose: { ...base.collector.pose, flow: "forward" },
				},
			}),
			reason: /near lane follows/i,
		},
		{
			name: "Bay long-axis mismatch",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				bay: {
					...base.bay,
					pose: { forward: DIR_E, side: "left", flow: "forward" },
				},
			}),
			reason: /long axis must point away/i,
		},
		{
			name: "wrong Bay setback",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				bay: { ...base.bay, anchor: { x: 16, y: 11 } },
			}),
			reason: /must be 12 meters/i,
		},
		{
			name: "Bay shell depth inconsistent with Process Loop allocation",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				bay: { ...base.bay, outerDepthMeters: base.bay.outerDepthMeters + 2 },
			}),
			reason: /outer depth must be/i,
		},
		{
			name: "insufficient origin support",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				bay: { ...base.bay, anchor: { x: 2, y: 12 } },
			}),
			reason: /first stem needs 3 meters/i,
		},
		{
			name: "insufficient far support",
			mutate: (base: ProductionBayParentGatewayRequest) => ({
				...base,
				bay: { ...base.bay, anchor: { x: 31, y: 12 } },
			}),
			reason: /return stem needs 3 meters/i,
		},
	] as const)("rejects $name", ({ mutate, reason }) => {
		const malformed = mutate(request("EAST_WEST", "SINGLE", 12));
		expect(validateProductionBayParentGatewayRequest(malformed)).toMatch(reason);
		expect(() =>
			planProductionBayParentGateway(malformed as ProductionBayParentGatewayRequest),
		).toThrow(reason);
	});
});

function request(
	axis: ProductionBayParentGatewayBankRepetitionAxis,
	variant: "SINGLE" | "TWIN",
	pitch: 12 | 14 | 16,
	alongOffset = 16,
): ProductionBayParentGatewayRequest {
	const outerDepthMeters = variant === "SINGLE" ? 10 : pitch + 10;
	const collector: PairedRailCorridorRequest =
		axis === "EAST_WEST"
			? {
					version: 1,
					anchor: { x: 0, y: 0 },
					lengthMeters: outerDepthMeters + 32,
					laneSpacingMeters: 2,
					pose: { forward: DIR_E, side: "right", flow: "reverse" },
				}
			: {
					version: 1,
					anchor: { x: 0, y: 0 },
					lengthMeters: outerDepthMeters + 32,
					laneSpacingMeters: 2,
					pose: { forward: DIR_S, side: "right", flow: "reverse" },
				};
	const bay: ProductionBayModuleRequest = {
		version: 2,
		anchor: axis === "EAST_WEST" ? { x: alongOffset, y: 12 } : { x: -12, y: alongOffset },
		outerLengthMeters: 54,
		outerDepthMeters,
		shellMarginMeters: 3,
		processLoopGapMeters: variant === "SINGLE" ? 3 : pitch - 4,
		gatewayLengthMeters: 6,
		processLoopCount: variant === "SINGLE" ? 1 : 2,
		internalFlowPattern: "alternating",
		pose:
			axis === "EAST_WEST"
				? { forward: DIR_S, side: "left", flow: "forward" }
				: { forward: DIR_W, side: "left", flow: "forward" },
	};
	return {
		version: 1,
		bankRepetitionAxis: axis,
		processLoopCenterPitchMeters: pitch,
		collector,
		bay,
	};
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

function certifyWholeBank(bank: OpenFabFabBankAssemblyPlan): void {
	const map = new TileMap();
	applyRoutes(map, [bank.closedCollectorRoute], "free-closed-primary");
	for (const bay of bank.bays) {
		applyRoutes(map, bay.plan.buildRoutes, "free-closed-primary");
	}

	const gatewayRoutes = bank.bays.flatMap((bay) => bay.parentGateway.buildRoutes);
	const expectedGatewayEdges = bank.bays.reduce(
		(total, bay) => total + bay.parentGateway.newEdges,
		0,
	);
	const expectedOwnedEdges = bank.bays.flatMap(
		(bay) => bay.parentGateway.ownershipIntent.directedEdges,
	);
	expect(new Set(expectedOwnedEdges.map(edgeKey)).size).toBe(expectedGatewayEdges);
	const edgesBeforeGateway = mapDirectedEdgeKeys(map);
	const gatewayConstruction = planRailRouteBatch(map, gatewayRoutes);
	expect(gatewayConstruction.valid, gatewayConstruction.reason).toBe(true);
	expect(gatewayConstruction.newEdges).toBe(expectedGatewayEdges);
	map.applyAtomicMutations(gatewayConstruction.mutations, []);
	const edgesAfterGateway = mapDirectedEdgeKeys(map);
	expect([...edgesAfterGateway].filter((key) => !edgesBeforeGateway.has(key)).sort()).toEqual(
		expectedOwnedEdges.map(edgeKey).sort(),
	);

	const processLoopCount = bank.bays.reduce(
		(total, bay) => total + bay.plan.dimensions.processLoopCount,
		0,
	);
	const singleBayCount = bank.bays.filter(
		(bay) => bay.plan.dimensions.processLoopCount === 1,
	).length;
	const twinBayCount = bank.bays.length - singleBayCount;
	const firstBay = bank.bays[0];
	if (!firstBay) throw new Error("Expected at least one planned Bay.");
	const pitch = firstBay.parentGateway.specification.processLoopCenterPitchMeters;
	const loopLength = firstBay.plan.dimensions.processLoopLengthMeters;
	const expectedWholeBankEdges =
		2 * (processLoopCount - 1) * pitch +
		92 +
		singleBayCount * (4 * loopLength + pitch + 62) +
		twinBayCount * (6 * loopLength + 3 * pitch + 70);
	expect(edgesAfterGateway.size).toBe(expectedWholeBankEdges);

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
}

function directedEdges(
	route: readonly Readonly<{ x: number; y: number }>[],
): readonly ProductionBayParentGatewayDirectedEdge[] {
	return route.slice(0, -1).map((from, index) => ({
		from,
		to: route[index + 1] as Readonly<{ x: number; y: number }>,
	}));
}

function edgeKey(edge: ProductionBayParentGatewayDirectedEdge): string {
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
