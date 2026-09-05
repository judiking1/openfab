import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { ALL_DIRECTIONS, bitCount, DIR_E, DIR_S, moveCell } from "../core/railShape";
import { type RailCell, TileMap } from "../core/TileMap";
import {
	createOpenFabFabAssemblyPlan,
	type OpenFabFabBankAssemblyPlan,
	type OpenFabFabLayoutBlockAssemblyPlan,
} from "./OpenFabFabAssemblyPlan";
import {
	defaultOpenFabFabProfile,
	OPENFAB_FAB_BANK_REPETITION_AXES,
	OPENFAB_FAB_BAY_PACKING_POLICIES,
	OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS,
	OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS,
	OPENFAB_FAB_PROCESS_LOOPS_PER_BANK,
	type OpenFabFabBankRepetitionAxis,
} from "./OpenFabFabProfile";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES,
	PRODUCTION_BANK_PARENT_GATEWAY_OWNER,
	PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
	PRODUCTION_BANK_PARENT_GATEWAY_REUSED_SUPPORT_EDGES,
	PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
	type ProductionBankParentGatewayDirectedEdge,
	type ProductionBankParentGatewayRequest,
	planProductionBankParentGateway,
	productionBankParentGatewayFingerprint,
	validateProductionBankParentGatewayRequest,
} from "./ProductionBankParentGatewayPlanner";
import { RailDraftEvaluator } from "./RailDraftEvaluator";

const PROFILE_CASES = OPENFAB_FAB_BANK_REPETITION_AXES.flatMap((axis) =>
	OPENFAB_FAB_BAY_PACKING_POLICIES.flatMap((packing) =>
		OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS.flatMap((pitch) =>
			OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS.flatMap((length) =>
				OPENFAB_FAB_PROCESS_LOOPS_PER_BANK.map((loops) => ({
					axis,
					packing,
					pitch,
					length,
					loops,
				})),
			),
		),
	),
);

const BOUNDARY_CASES = OPENFAB_FAB_BANK_REPETITION_AXES.flatMap((axis) =>
	([1, 2, 3] as const).flatMap((banks) => [
		{
			name: "minimum",
			axis,
			banks,
			loops: 12 as const,
			packing: "TWIN" as const,
			length: 36 as const,
			pitch: 12 as const,
		},
		{
			name: "maximum",
			axis,
			banks,
			loops: 24 as const,
			packing: "SINGLE" as const,
			length: 56 as const,
			pitch: 16 as const,
		},
	]),
);

describe("ProductionBankParentGatewayPlanner", () => {
	it.each([
		{
			axis: "EAST_WEST" as const,
			bounds: { minX: 4, minY: 16, maxX: 40, maxY: 34 },
			junctions: [
				{ x: 32, y: 24 },
				{ x: 4, y: 16 },
				{ x: 4, y: 34 },
				{ x: 32, y: 26 },
			],
			outboundControls: [
				{ x: 40, y: 24 },
				{ x: 32, y: 24 },
				{ x: 32, y: 16 },
				{ x: 4, y: 16 },
				{ x: 4, y: 24 },
			],
			returnControls: [
				{ x: 4, y: 26 },
				{ x: 4, y: 34 },
				{ x: 32, y: 34 },
				{ x: 32, y: 26 },
				{ x: 40, y: 26 },
			],
		},
		{
			axis: "NORTH_SOUTH" as const,
			bounds: { minX: 72, minY: 4, maxX: 106, maxY: 40 },
			junctions: [
				{ x: 90, y: 32 },
				{ x: 98, y: 4 },
				{ x: 80, y: 4 },
				{ x: 88, y: 32 },
			],
			outboundControls: [
				{ x: 90, y: 40 },
				{ x: 90, y: 32 },
				{ x: 98, y: 32 },
				{ x: 98, y: 4 },
				{ x: 106, y: 4 },
			],
			returnControls: [
				{ x: 72, y: 4 },
				{ x: 80, y: 4 },
				{ x: 80, y: 32 },
				{ x: 88, y: 32 },
				{ x: 88, y: 40 },
			],
		},
	])("materializes the exact four-junction $axis frame", (fixture) => {
		const assembly = oneBankAssembly(fixture.axis);
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const bank = requiredBank(block.banks[0]);
		const plan = planProductionBankParentGateway(requestFor(fixture.axis, block, bank));

		expect(plan).toMatchObject({
			kind: "production-bank-parent-gateway",
			geometryValid: true,
			placementReady: false,
			specification: {
				version: PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
				topologyPolicy: "primary-branch-secondary-return-two-stem-v1",
				bankRepetitionAxis: fixture.axis,
				collectorBranchLaneId: "primary",
				collectorMergeLaneId: "secondary",
				parentLaneId: "inner",
				collectorLaneSpacingMeters: 2,
				parentLaneSpacingMeters: 4,
				collectorSetbackMeters: 24,
				junctionStationMeters: 8,
				supportMeters: 8,
				serviceBandMeters: 8,
				parentJunctionSpacingMeters: 18,
			},
			ownershipIntent: {
				owner: PRODUCTION_BANK_PARENT_GATEWAY_OWNER,
				scope: "ADDED_DIRECTED_EDGES_ONLY",
			},
			bounds: fixture.bounds,
			newEdges: PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES,
			lengthMeters: PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES,
			reusedSupportEdges: PRODUCTION_BANK_PARENT_GATEWAY_REUSED_SUPPORT_EDGES,
		});
		expect(plan.connections.map((connection) => connection.branchCell)).toEqual([
			fixture.junctions[0],
			fixture.junctions[2],
		]);
		expect(plan.connections.map((connection) => connection.mergeCell)).toEqual([
			fixture.junctions[1],
			fixture.junctions[3],
		]);
		expect(routeCellsAtControls(plan.buildRoutes[0], [0, 8, 16, 44, 52])).toEqual(
			fixture.outboundControls,
		);
		expect(routeCellsAtControls(plan.buildRoutes[1], [0, 8, 36, 44, 52])).toEqual(
			fixture.returnControls,
		);
		expect(plan.buildRoutes.map((route) => route.length)).toEqual([53, 53]);
		expect(plan.connections.map((connection) => connection.ownedDirectedEdges.length)).toEqual([
			36, 36,
		]);
		expect(
			plan.connections.map(
				(connection) =>
					connection.reusedSourceSupportDirectedEdges.length +
					connection.reusedTargetSupportDirectedEdges.length,
			),
		).toEqual([16, 16]);
	});

	it.each(
		OPENFAB_FAB_BANK_REPETITION_AXES,
	)("authors only the exact 72 BANK edges and creates the declared $axis junctions", (axis) => {
		const assembly = oneBankAssembly(axis);
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const bank = requiredBank(block.banks[0]);
		const plan = planProductionBankParentGateway(requestFor(axis, block, bank));
		const map = new TileMap();
		applyParentAndCollector(map, block, bank);
		const beforeRails = mapRails(map);
		const beforeEdges = mapDirectedEdgeKeys(map);

		const construction = planRailRouteBatch(map, plan.buildRoutes);
		expect(construction.valid, construction.reason).toBe(true);
		expect(construction.newEdges).toBe(PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES);
		const exact = new RailDraftEvaluator().evaluate(map, compilePhysicalRail(map), construction);
		expect(exact).toMatchObject({
			validationLevel: "exact",
			topologyValid: true,
			valid: true,
		});
		expect(exact.issues).toEqual([]);
		expect(exact.conflictCells).toEqual([]);
		expect(map.applyAtomicMutations(construction.mutations, [])).toBe(true);

		const addedEdges = [...mapDirectedEdgeKeys(map)].filter((key) => !beforeEdges.has(key)).sort();
		expect(addedEdges).toEqual(plan.ownershipIntent.directedEdges.map(edgeKey).sort());
		expect(changedJunctionCells(beforeRails, map)).toEqual(
			plan.connections
				.flatMap((connection) => [connection.branchCell, connection.mergeCell])
				.sort(compareCells),
		);
		expect(analyzeRailNetwork(map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		assertPhysicalNetwork(map);
	});

	it("keeps support seams reused and ownership edges unique", () => {
		const assembly = oneBankAssembly("EAST_WEST");
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const bank = requiredBank(block.banks[0]);
		const plan = planProductionBankParentGateway(requestFor("EAST_WEST", block, bank));
		const primaryEdges = new Set(directedEdges(plan.collector.lanes[0].cells).map(edgeKey));
		const secondaryEdges = new Set(directedEdges(plan.collector.lanes[1].cells).map(edgeKey));
		const innerEdges = new Set(directedEdges(plan.parentPerimeter.lanes[1].cells).map(edgeKey));
		const ownedKeys = plan.ownershipIntent.directedEdges.map(edgeKey);
		const supportGroups = [
			plan.connections[0].reusedSourceSupportDirectedEdges,
			plan.connections[0].reusedTargetSupportDirectedEdges,
			plan.connections[1].reusedSourceSupportDirectedEdges,
			plan.connections[1].reusedTargetSupportDirectedEdges,
		];

		expect(plan.connections.map((connection) => connection.sourceRole)).toEqual([
			"BANK_COLLECTOR_PRIMARY",
			"FAB_INNER_PERIMETER",
		]);
		expect(plan.connections.map((connection) => connection.targetRole)).toEqual([
			"FAB_INNER_PERIMETER",
			"BANK_COLLECTOR_SECONDARY",
		]);
		expect(plan.buildSteps.every((step) => step.owner === "BANK")).toBe(true);
		expect(plan.buildSteps.flatMap((step) => step.ownedDirectedEdges).map(edgeKey)).toEqual(
			ownedKeys,
		);
		expect(new Set(ownedKeys).size).toBe(PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES);
		expect(
			supportGroups.every(
				(edges) => edges.length === PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
			),
		).toBe(true);
		expect(supportGroups[0]?.every((edge) => primaryEdges.has(edgeKey(edge)))).toBe(true);
		expect(supportGroups[1]?.every((edge) => innerEdges.has(edgeKey(edge)))).toBe(true);
		expect(supportGroups[2]?.every((edge) => innerEdges.has(edgeKey(edge)))).toBe(true);
		expect(supportGroups[3]?.every((edge) => secondaryEdges.has(edgeKey(edge)))).toBe(true);
		expect(
			ownedKeys.every(
				(key) => !primaryEdges.has(key) && !secondaryEdges.has(key) && !innerEdges.has(key),
			),
		).toBe(true);
	});

	it("normalizes immutably and fingerprints all child geometry", () => {
		const assembly = oneBankAssembly("EAST_WEST");
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const bank = requiredBank(block.banks[0]);
		const base = requestFor("EAST_WEST", block, bank);
		const clone = JSON.parse(JSON.stringify(base)) as ProductionBankParentGatewayRequest;
		const shifted: ProductionBankParentGatewayRequest = {
			...base,
			collector: {
				...base.collector,
				anchor: { x: base.collector.anchor.x + 10, y: base.collector.anchor.y + 20 },
			},
			parentPerimeter: {
				...base.parentPerimeter,
				anchor: {
					x: base.parentPerimeter.anchor.x + 10,
					y: base.parentPerimeter.anchor.y + 20,
				},
			},
		};
		const first = planProductionBankParentGateway(base);
		const second = planProductionBankParentGateway(clone);

		expect(second.fingerprint).toBe(first.fingerprint);
		expect(productionBankParentGatewayFingerprint(base)).toBe(first.fingerprint);
		expect(productionBankParentGatewayFingerprint(shifted)).not.toBe(first.fingerprint);
		expect(first.fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(first.specification.collectorPlanFingerprint).toBe(first.collector.fingerprint);
		expect(first.specification.parentPerimeterPlanFingerprint).toBe(
			first.parentPerimeter.fingerprint,
		);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.buildRoutes)).toBe(true);
		expect(Object.isFrozen(first.connections[0].planningRoute)).toBe(true);
		expect(Object.isFrozen(first.ownershipIntent.directedEdges)).toBe(true);
	});

	it.each([
		{
			name: "unknown top-level field",
			mutate: (base: ProductionBankParentGatewayRequest) => ({ ...base, hidden: true }),
			reason: /fields do not match/i,
		},
		{
			name: "missing version",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				bankRepetitionAxis: base.bankRepetitionAxis,
				collector: base.collector,
				parentPerimeter: base.parentPerimeter,
			}),
			reason: /version must be 1/i,
		},
		{
			name: "unsupported version",
			mutate: (base: ProductionBankParentGatewayRequest) => ({ ...base, version: 2 }),
			reason: /version must be 1/i,
		},
		{
			name: "wide collector lane pair",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				collector: { ...base.collector, laneSpacingMeters: 4 },
			}),
			reason: /collector lane spacing must be 2/i,
		},
		{
			name: "collector axis mismatch",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				collector: {
					...base.collector,
					pose: { forward: DIR_S, side: "right", flow: "reverse" },
				},
			}),
			reason: /direction does not match/i,
		},
		{
			name: "collector forward flow",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				collector: {
					...base.collector,
					pose: { ...base.collector.pose, flow: "forward" },
				},
			}),
			reason: /flow "reverse"/i,
		},
		{
			name: "wide parent lane pair",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				parentPerimeter: { ...base.parentPerimeter, laneSpacingMeters: 2 },
			}),
			reason: /parent perimeter lane spacing must be 4/i,
		},
		{
			name: "parent pose mismatch",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				parentPerimeter: {
					...base.parentPerimeter,
					pose: { forward: DIR_E, side: "left", flow: "forward" },
				},
			}),
			reason: /perimeter pose does not match/i,
		},
		{
			name: "wrong collector setback",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				collector: {
					...base.collector,
					anchor: { x: base.collector.anchor.x + 1, y: base.collector.anchor.y },
				},
			}),
			reason: /must be 24 meters/i,
		},
		{
			name: "short collector support",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				collector: { ...base.collector, lengthMeters: 15 },
			}),
			reason: /at least 16 meters/i,
		},
		{
			name: "parent service band outside the inner lane",
			mutate: (base: ProductionBankParentGatewayRequest) => ({
				...base,
				collector: {
					...base.collector,
					anchor: { x: base.collector.anchor.x, y: 7 },
				},
			}),
			reason: /does not match the Fab inner perimeter lane/i,
		},
	] as const)("rejects $name", ({ mutate, reason }) => {
		const assembly = oneBankAssembly("EAST_WEST");
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const bank = requiredBank(block.banks[0]);
		const malformed = mutate(requestFor("EAST_WEST", block, bank));
		expect(validateProductionBankParentGatewayRequest(malformed)).toMatch(reason);
		expect(() =>
			planProductionBankParentGateway(malformed as ProductionBankParentGatewayRequest),
		).toThrow(reason);
	});

	it.each(
		PROFILE_CASES,
	)("certifies the exact adapter for $axis $packing P$pitch L$length with $loops loops", ({
		axis,
		packing,
		pitch,
		length,
		loops,
	}) => {
		const assembly = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 1,
			bankRepetitionAxis: axis,
			banksPerLayoutBlock: 1,
			processLoopsPerBank: loops,
			bayPackingPolicy: packing,
			processLoopLongAxisMeters: length,
			processLoopCenterPitchMeters: pitch,
		});
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const map = buildBlockBeforeParentGateways(block);
		applyAndCertifyParentGateway(map, axis, block, requiredBank(block.banks[0]));
		assertClosedPhysicalNetwork(map);
	});

	it.each(BOUNDARY_CASES)("certifies $banks $name $axis Banks in one shared parent perimeter", ({
		axis,
		banks,
		loops,
		packing,
		length,
		pitch,
	}) => {
		const assembly = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 1,
			bankRepetitionAxis: axis,
			banksPerLayoutBlock: banks,
			processLoopsPerBank: loops,
			bayPackingPolicy: packing,
			processLoopLongAxisMeters: length,
			processLoopCenterPitchMeters: pitch,
		});
		const block = requiredBlock(assembly.layoutBlocks[0]);
		const map = buildBlockBeforeParentGateways(block);
		for (const bank of block.banks) applyAndCertifyParentGateway(map, axis, block, bank);
		expect(mapDirectedEdgeKeys(map).size).toBe(
			assembly.capacity.primitiveDirectedEdges + banks * PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES,
		);
		assertClosedPhysicalNetwork(map);
	}, 60_000);
});

function oneBankAssembly(axis: OpenFabFabBankRepetitionAxis) {
	return createOpenFabFabAssemblyPlan({
		...defaultOpenFabFabProfile(),
		layoutBlockCount: 1,
		bankRepetitionAxis: axis,
		banksPerLayoutBlock: 1,
	});
}

function requestFor(
	axis: OpenFabFabBankRepetitionAxis,
	block: OpenFabFabLayoutBlockAssemblyPlan,
	bank: OpenFabFabBankAssemblyPlan,
): ProductionBankParentGatewayRequest {
	return {
		version: PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
		bankRepetitionAxis: axis,
		collector: bank.collector.specification,
		parentPerimeter: block.perimeter.specification,
	};
}

function buildBlockBeforeParentGateways(block: OpenFabFabLayoutBlockAssemblyPlan): TileMap {
	const map = new TileMap();
	for (const route of block.perimeter.buildRoutes) {
		applyRoutes(map, [route], "free-closed-primary");
	}
	for (const route of block.perimeterTurnbackRoutes) applyRoutes(map, [route], "connected");
	for (const bank of block.banks) {
		applyRoutes(map, [bank.closedCollectorRoute], "free-closed-primary");
		for (const bay of bank.bays) applyRoutes(map, bay.plan.buildRoutes, "free-closed-primary");
		applyRoutes(
			map,
			bank.bays.flatMap((bay) => bay.parentGateway.buildRoutes),
			"connected",
		);
	}
	return map;
}

function applyParentAndCollector(
	map: TileMap,
	block: OpenFabFabLayoutBlockAssemblyPlan,
	bank: OpenFabFabBankAssemblyPlan,
): void {
	for (const route of block.perimeter.buildRoutes) {
		applyRoutes(map, [route], "free-closed-primary");
	}
	for (const route of block.perimeterTurnbackRoutes) applyRoutes(map, [route], "connected");
	applyRoutes(map, [bank.closedCollectorRoute], "free-closed-primary");
}

function applyAndCertifyParentGateway(
	map: TileMap,
	axis: OpenFabFabBankRepetitionAxis,
	block: OpenFabFabLayoutBlockAssemblyPlan,
	bank: OpenFabFabBankAssemblyPlan,
): void {
	const plan = planProductionBankParentGateway(requestFor(axis, block, bank));
	const beforeEdges = mapDirectedEdgeKeys(map);
	const construction = planRailRouteBatch(map, plan.buildRoutes);
	expect(construction.valid, construction.reason).toBe(true);
	expect(construction.newEdges).toBe(PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES);
	const exact = new RailDraftEvaluator().evaluate(map, compilePhysicalRail(map), construction);
	expect(exact.valid, exact.reason).toBe(true);
	expect(exact.topologyValid).toBe(true);
	expect(exact.issues).toEqual([]);
	expect(exact.conflictCells).toEqual([]);
	expect(map.applyAtomicMutations(construction.mutations, [])).toBe(true);
	const addedEdges = [...mapDirectedEdgeKeys(map)].filter((key) => !beforeEdges.has(key)).sort();
	expect(addedEdges).toEqual(plan.ownershipIntent.directedEdges.map(edgeKey).sort());
}

function applyRoutes(
	map: TileMap,
	routes: readonly (readonly Readonly<{ x: number; y: number }>[])[],
	placement: "connected" | "free-closed-primary",
): void {
	const construction = planRailRouteBatch(map, routes, placement);
	expect(construction.valid, construction.reason).toBe(true);
	expect(map.applyAtomicMutations(construction.mutations, [])).toBe(true);
}

function assertClosedPhysicalNetwork(map: TileMap): void {
	expect(analyzeRailNetwork(map)).toMatchObject({
		status: "closed",
		components: 1,
		strongComponents: 1,
		openEnds: 0,
		unsafeJunctions: 0,
	});
	assertPhysicalNetwork(map);
}

function assertPhysicalNetwork(map: TileMap): void {
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

function routeCellsAtControls(
	route: readonly Readonly<{ x: number; y: number }>[],
	indices: number[],
) {
	return indices.map((index) => route[index]);
}

function directedEdges(
	route: readonly Readonly<{ x: number; y: number }>[],
): readonly ProductionBankParentGatewayDirectedEdge[] {
	return route.slice(0, -1).map((from, index) => ({
		from,
		to: route[index + 1] as Readonly<{ x: number; y: number }>,
	}));
}

function edgeKey(edge: ProductionBankParentGatewayDirectedEdge): string {
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

function mapRails(map: TileMap): ReadonlyMap<string, RailCell> {
	const rails = new Map<string, RailCell>();
	map.forEachRail((x, y, rail) => rails.set(`${x},${y}`, rail));
	return rails;
}

function changedJunctionCells(before: ReadonlyMap<string, RailCell>, map: TileMap) {
	const result: { x: number; y: number }[] = [];
	map.forEachRail((x, y, rail) => {
		const previous = before.get(`${x},${y}`);
		if (!previous) return;
		if (
			bitCount(previous.incoming | previous.outgoing) < 3 &&
			bitCount(rail.incoming | rail.outgoing) === 3
		) {
			result.push({ x, y });
		}
	});
	return result.sort(compareCells);
}

function compareCells(
	left: Readonly<{ x: number; y: number }>,
	right: Readonly<{ x: number; y: number }>,
) {
	return left.x - right.x || left.y - right.y;
}

function requiredBlock(
	block: OpenFabFabLayoutBlockAssemblyPlan | undefined,
): OpenFabFabLayoutBlockAssemblyPlan {
	if (!block) throw new Error("Expected one planned Layout Block.");
	return block;
}

function requiredBank(bank: OpenFabFabBankAssemblyPlan | undefined): OpenFabFabBankAssemblyPlan {
	if (!bank) throw new Error("Expected one planned Bank.");
	return bank;
}
