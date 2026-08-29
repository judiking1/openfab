import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { analyzeRailNetwork } from "./network";
import {
	PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS,
	type ProductionBayDirectedLoop,
	type ProductionBayGatewayCorridorDescriptor,
	type ProductionBayModulePlan,
	type ProductionBayModuleRequest,
	planProductionBayModule,
	productionBayModuleFingerprint,
	validateProductionBayModuleRequest,
} from "./ProductionBayModulePlanner";
import { planRailRouteBatch } from "./RailTemplateCatalog";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	oppositeDirection,
} from "./railShape";
import { type Cell, TileMap } from "./TileMap";

describe("ProductionBayModulePlanner", () => {
	it.each([
		["east", DIR_E, { x: 50, y: -5 }, { x: 50, y: 17 }],
		["south", DIR_S, { x: 10, y: 35 }, { x: -12, y: 35 }],
		["west", DIR_W, { x: -30, y: -5 }, { x: -30, y: -27 }],
		["north", DIR_N, { x: 10, y: -45 }, { x: 32, y: -45 }],
	] satisfies readonly [
		string,
		Direction,
		Cell,
		Cell,
	][])("rotates the complete 1 m Bay footprint toward %s", (_name, forward, expectedLongitudinalCorner, expectedFarCorner) => {
		const plan = planProductionBayModule(
			request({ anchor: { x: 10, y: -5 }, pose: { forward, side: "right" } }),
		);

		expect(plan.outerLoop.cells).toContainEqual(expectedLongitudinalCorner);
		expect(plan.outerLoop.cells).toContainEqual(expectedFarCorner);
		expect(plan.outerLoop.cells[0]).toEqual(plan.outerLoop.cells.at(-1));
		expect(plan.processLoops).toHaveLength(2);
		for (const loop of [plan.outerLoop, ...plan.processLoops]) {
			expectCardinalClosedLoop(loop);
			expect(loop.cells.length).toBe(loop.newEdges + 1);
		}
		for (const loop of plan.processLoops) {
			for (const cell of loop.cells.slice(0, -1)) {
				expect(plan.outerLoop.cells).not.toContainEqual(cell);
			}
		}
	});

	it("mirrors geometry with side without silently reversing route flow", () => {
		const right = planProductionBayModule(request({ pose: { forward: DIR_E, side: "right" } }));
		const left = planProductionBayModule(request({ pose: { forward: DIR_E, side: "left" } }));

		expect(right.outerLoop.travelDirection).toBe(DIR_E);
		expect(left.outerLoop.travelDirection).toBe(DIR_E);
		expect(right.processLoops[0].origin).toEqual({ x: 3, y: 3 });
		expect(left.processLoops[0].origin).toEqual({ x: 3, y: -3 });
		expect(right.fingerprint).not.toBe(left.fingerprint);
	});

	it("reverses every directed loop and paired lane without moving the footprint", () => {
		const forward = planProductionBayModule(request());
		const reversed = planProductionBayModule(
			request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
		);

		expect(canonicalRouteFootprints(reversed.buildRoutes)).toEqual(
			canonicalRouteFootprints(forward.buildRoutes),
		);
		expect(sortCells(reversed.occupiedCells)).toEqual(sortCells(forward.occupiedCells));
		for (let index = 0; index < forward.gatewayCorridors.length; index++) {
			const normalGateway = forward.gatewayCorridors[
				index
			] as ProductionBayGatewayCorridorDescriptor;
			const reverseGateway = reversed.gatewayCorridors[
				index
			] as ProductionBayGatewayCorridorDescriptor;
			for (let laneIndex = 0; laneIndex < normalGateway.corridor.lanes.length; laneIndex++) {
				expect(reverseGateway.corridor.lanes[laneIndex]?.travelDirection).toBe(
					oppositeDirection(normalGateway.corridor.lanes[laneIndex]?.travelDirection as Direction),
				);
			}
		}
		for (let index = 0; index < forward.connectivity.length; index++) {
			const normalConnection = forward.connectivity[index];
			const reverseConnection = reversed.connectivity[index];
			expect(reverseConnection?.corridorTravelDirection).toBe(
				oppositeDirection(normalConnection?.corridorTravelDirection as Direction),
			);
			expect(reverseConnection?.targetTravelDirection).toBe(
				oppositeDirection(normalConnection?.targetTravelDirection as Direction),
			);
		}
		expect(reversed.connectivity.map((item) => item.gatewayRole)).toEqual(
			forward.connectivity.map((item) => (item.gatewayRole === "branch" ? "merge" : "branch")),
		);
		expect(reversed.fingerprint).not.toBe(forward.fingerprint);
	});

	it("derives two equal longitudinal process loops from validated dimensions", () => {
		const plan = planProductionBayModule(request());

		expect(plan.dimensions).toEqual({
			outerLengthMeters: 40,
			outerDepthMeters: 22,
			processLoopLengthMeters: 34,
			processLoopDepthMeters: 6,
			processLoopGapMeters: 4,
			shellMarginMeters: 3,
			gatewayLengthMeters: 6,
			processLoopCount: 2,
		});
		expect(plan.processLoops.map((loop) => [loop.lengthMeters, loop.depthMeters])).toEqual([
			[34, 6],
			[34, 6],
		]);
		expect(plan.processLoops.map((loop) => loop.origin)).toEqual([
			{ x: 3, y: 3 },
			{ x: 3, y: 13 },
		]);
		expect(plan.specification).toMatchObject({
			version: 2,
			topologyPolicy: "four-adapter-v1",
			internalFlowPattern: "alternating",
		});
		expect(plan.processLoops.map((loop) => loop.pose.flow)).toEqual(["forward", "reverse"]);
		expect(plan.newEdges).toBe(124 + 80 + 80 + 12);
		expect(plan.lengthMeters).toBe(plan.newEdges);
		expect(plan.turns).toBe(12);
	});

	it("derives a distinct Single-loop Bay instead of relabeling a small loop", () => {
		const plan = planProductionBayModule(request({ processLoopCount: 1 }));

		expect(plan.specification.processLoopCount).toBe(1);
		expect(plan.processLoops).toHaveLength(1);
		expect(plan.processLoops[0]).toMatchObject({
			id: "process-loop-a",
			origin: { x: 3, y: 3 },
			lengthMeters: 34,
			depthMeters: 16,
		});
		expect(plan.gatewayCorridors).toHaveLength(2);
		expect(plan.adapterRoutes).toHaveLength(4);
		expect(
			new Set(
				plan.gatewayCorridors.flatMap((gateway) =>
					gateway.processConnections.map((connection) => connection.targetLoopId),
				),
			),
		).toEqual(new Set(["process-loop-a"]));
		expect(plan.turns).toBe(8);
	});

	it("materializes every pose and Twin flow policy as one closed, physically valid network", () => {
		for (const processLoopCount of [1, 2] as const) {
			const patterns =
				processLoopCount === 1
					? (["alternating"] as const)
					: (["alternating", "co-rotating"] as const);
			for (const internalFlowPattern of patterns) {
				for (const forward of [DIR_N, DIR_E, DIR_S, DIR_W] as const) {
					for (const side of ["left", "right"] as const) {
						for (const flow of ["forward", "reverse"] as const) {
							const plan = planProductionBayModule(
								request({
									processLoopCount,
									internalFlowPattern,
									pose: { forward, side, flow },
								}),
							);
							const map = materializePlan(plan);
							expect(
								analyzeRailNetwork(map),
								`${processLoopCount}/${internalFlowPattern}/${forward}/${side}/${flow}`,
							).toMatchObject({
								status: "closed",
								components: 1,
								strongComponents: 1,
								openEnds: 0,
								unsafeJunctions: 0,
							});
							const physical = compilePhysicalRail(map);
							expect(
								physical.valid,
								`${processLoopCount}/${internalFlowPattern}/${forward}/${side}/${flow}`,
							).toBe(true);
							expect(physical.terminals).toHaveLength(0);
							expect(physical.diagnostics).toEqual([]);
							expect(physical.clearance.issues.count).toBe(0);
						}
					}
				}
			}
		}
	});

	it("describes paired opposite-flow corridors and explicit final connectivity at both ends", () => {
		const plan = planProductionBayModule(request());

		expect(plan.gatewayCorridors.map((gateway) => gateway.longitudinalEnd)).toEqual([
			"origin",
			"far",
		]);
		for (const gateway of plan.gatewayCorridors) {
			expect(gateway.corridor.lanes).toHaveLength(2);
			expect(gateway.corridor.lanes[1].travelDirection).toBe(
				oppositeDirection(gateway.corridor.lanes[0].travelDirection),
			);
			expect(gateway.outerConnections.map((item) => item.gatewayRole).sort()).toEqual([
				"branch",
				"merge",
			]);
			expect(gateway.processConnections.map((item) => item.gatewayRole).sort()).toEqual([
				"branch",
				"merge",
			]);
			expect(gateway.processConnections.map((item) => item.targetLoopId)).toEqual([
				"process-loop-a",
				"process-loop-b",
			]);
			for (const connection of gateway.processConnections) {
				expect(connection).toMatchObject({
					attachment: "shared-directed-seam",
					status: "satisfied",
					distanceMeters: 0,
				});
				expect(connection.targetCell).toEqual(connection.corridorCell);
				expect(connection.targetTravelDirection).toBe(connection.corridorTravelDirection);
				expect(loopById(plan, connection.targetLoopId).cells).toContainEqual(connection.targetCell);
			}
			for (const connection of gateway.outerConnections) {
				expect(connection).toMatchObject({
					targetLoopId: "outer-circulation",
					attachment: "materialized-tangent-adapter",
					status: "satisfied",
					distanceMeters: 3,
				});
				expect(connection.adapterRoute).toHaveLength(4);
				expect(plan.outerLoop.cells).toContainEqual(connection.targetCell);
			}
		}
		expect(plan.completion).toEqual({
			intermediateState: "all-gateways-materialized",
			finalState: "closed-directed-topology",
			unresolvedEndpointCount: 0,
			resolvedConnectionIds: [
				"origin-gateway:outer:primary",
				"origin-gateway:outer:secondary",
				"far-gateway:outer:primary",
				"far-gateway:outer:secondary",
			],
		});
		expect(plan.adapterRoutes).toHaveLength(4);
		expect(plan.buildRoutes).toHaveLength(7);
		expect(plan.gatewayPairs).toHaveLength(2);
		for (const pair of plan.gatewayPairs) {
			expect(pair.branch.gatewayRole).toBe("branch");
			expect(pair.merge.gatewayRole).toBe("merge");
		}
		expect(plan.buildSteps.map((step) => step.kind)).toEqual([
			"shell",
			"branch",
			"process-loop",
			"merge",
			"branch",
			"process-loop",
			"merge",
		]);
	});

	it("fails readiness when any one of the four directed adapters is omitted", () => {
		const plan = planProductionBayModule(request());
		const adapterStepIndices = plan.buildSteps
			.map((step, index) => ({ step, index }))
			.filter(({ step }) => step.kind === "branch" || step.kind === "merge");
		expect(adapterStepIndices).toHaveLength(4);

		for (const { step, index } of adapterStepIndices) {
			const routes = plan.buildSteps
				.filter((_, candidateIndex) => candidateIndex !== index)
				.map((item) => item.route);
			const map = new TileMap();
			const construction = planRailRouteBatch(map, routes, "free-closed-primary");
			if (!construction.valid) {
				expect(construction.reason.length, step.id).toBeGreaterThan(0);
				continue;
			}
			for (const mutation of construction.mutations) {
				map.setEncoded(mutation.x, mutation.y, mutation.after);
			}
			const analysis = analyzeRailNetwork(map);
			const physical = compilePhysicalRail(map);
			const readiness = createRailProjectReadiness(analysis, physical, `missing:${step.id}`);
			expect(readiness.ready, step.id).toBe(false);
			expect(
				readiness.issues.some((issue) =>
					["DISCONNECTED_NETWORK", "MULTIPLE_STRONG_COMPONENTS", "PHYSICAL_DISCONNECTED"].includes(
						issue.code,
					),
				),
				step.id,
			).toBe(true);
		}
	});

	it("creates a deterministic fingerprint and recursively immutable serializable plan", () => {
		const base = request({ version: 2 });
		const cloned = JSON.parse(JSON.stringify(base)) as ProductionBayModuleRequest;
		const first = planProductionBayModule(base);
		const second = planProductionBayModule(cloned);

		expect(first.fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(productionBayModuleFingerprint(base)).toBe(first.fingerprint);
		expect(
			new Set([
				first.fingerprint,
				planProductionBayModule(request({ anchor: { x: 1, y: 0 } })).fingerprint,
				planProductionBayModule(request({ outerLengthMeters: 42 })).fingerprint,
				planProductionBayModule(request({ pose: { forward: DIR_S, side: "right" } })).fingerprint,
				planProductionBayModule(
					request({ pose: { forward: DIR_E, side: "right", flow: "reverse" } }),
				).fingerprint,
				planProductionBayModule(request({ internalFlowPattern: "co-rotating" })).fingerprint,
			]).size,
		).toBe(6);
		expect(JSON.parse(JSON.stringify(first))).toMatchObject({
			kind: "production-bay-module",
			geometryValid: true,
			placementReady: false,
			fingerprint: first.fingerprint,
		});
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.specification.anchor)).toBe(true);
		expect(Object.isFrozen(first.dimensions)).toBe(true);
		expect(Object.isFrozen(first.outerLoop.cells)).toBe(true);
		expect(Object.isFrozen(first.outerLoop.cells[0])).toBe(true);
		expect(Object.isFrozen(first.gatewayCorridors[0].corridor)).toBe(true);
		expect(Object.isFrozen(first.gatewayCorridors[0].outerConnections[0])).toBe(true);
		expect(Object.isFrozen(first.completion.resolvedConnectionIds)).toBe(true);
	});

	it.each([
		[{ ...request(), version: 1 }, "version"],
		[{ ...request(), outerLengthMeters: 7 }, "outer length"],
		[{ ...request(), outerDepthMeters: 6 }, "outer depth"],
		[{ ...request(), shellMarginMeters: 1.5 }, "shell margin"],
		[{ ...request(), processLoopGapMeters: 0 }, "gap"],
		[{ ...request(), gatewayLengthMeters: 0 }, "gateway length"],
		[{ ...request(), processLoopCount: 3 }, "count"],
		[{ ...request(), internalFlowPattern: "random" }, "internal flow"],
		[
			{
				...request(),
				outerLengthMeters: PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS + 1,
			},
			"outer length",
		],
		[
			{
				...request(),
				outerLengthMeters: 18,
				shellMarginMeters: 3,
				gatewayLengthMeters: 6,
			},
			"overlap",
		],
		[{ ...request(), outerDepthMeters: 21 }, "even"],
		[
			{
				...request(),
				outerDepthMeters: 9,
				shellMarginMeters: 3,
				processLoopGapMeters: 3,
			},
			"depth",
		],
		[{ ...request(), pose: { forward: 16, side: "right" } }, "cardinal"],
		[{ ...request(), pose: { forward: DIR_E, side: "center" } }, "side"],
		[
			{
				...request(),
				pose: { forward: DIR_E, side: "right", flow: "sideways" },
			},
			"flow",
		],
		[{ ...request(), anchor: { x: 2_147_483_647, y: 0 } }, "bounds"],
	] satisfies readonly [
		unknown,
		string,
	][])("rejects malformed dimensions or pose %# before planning", (input, message) => {
		expect(validateProductionBayModuleRequest(input)?.toLowerCase()).toContain(message);
		expect(() => planProductionBayModule(input as ProductionBayModuleRequest)).toThrow(message);
		expect(() => productionBayModuleFingerprint(input as ProductionBayModuleRequest)).toThrow(
			message,
		);
	});
});

function request(overrides: Partial<ProductionBayModuleRequest> = {}): ProductionBayModuleRequest {
	return {
		anchor: { x: 0, y: 0 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		pose: { forward: DIR_E, side: "right" },
		...overrides,
	};
}

function expectCardinalClosedLoop(loop: ProductionBayDirectedLoop): void {
	expect(loop.cells[0]).toEqual(loop.cells.at(-1));
	for (let index = 0; index < loop.cells.length - 1; index++) {
		expect(
			directionBetween(loop.cells[index] as Cell, loop.cells[index + 1] as Cell),
		).not.toBeNull();
	}
	const unique = new Set(loop.cells.slice(0, -1).map((cell) => `${cell.x},${cell.y}`));
	expect(unique.size).toBe(loop.cells.length - 1);
}

function loopById(plan: ProductionBayModulePlan, id: string): ProductionBayDirectedLoop {
	const loop = [plan.outerLoop, ...plan.processLoops].find((candidate) => candidate.id === id);
	if (!loop) throw new Error(`Missing loop ${id}.`);
	return loop;
}

function sortCells(cells: readonly Cell[]): readonly string[] {
	return cells.map((cell) => `${cell.x},${cell.y}`).sort();
}

function canonicalRouteFootprints(routes: readonly (readonly Cell[])[]): readonly string[] {
	return routes.map((route) => sortCells(route).join("|")).sort();
}

function materializePlan(plan: ProductionBayModulePlan): TileMap {
	return materializeRoutes(plan.buildRoutes);
}

function materializeRoutes(routes: readonly (readonly Cell[])[]): TileMap {
	const map = new TileMap();
	const construction = planRailRouteBatch(map, routes, "free-closed-primary");
	expect(construction.valid, construction.reason).toBe(true);
	for (const mutation of construction.mutations) {
		map.setEncoded(mutation.x, mutation.y, mutation.after);
	}
	return map;
}
