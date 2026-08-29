import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	PAIRED_RAIL_CORRIDOR_PLAN_VERSION,
	type PairedRailCorridorEnd,
	type PairedRailCorridorEndpointDescriptor,
	type PairedRailCorridorEndpointId,
	type PairedRailCorridorGatewayRole,
	type PairedRailCorridorLaneId,
	type PairedRailCorridorPlan,
	planPairedRailCorridor,
} from "./PairedRailCorridorPlanner";
import type { RailTemplatePose } from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

export const PRODUCTION_BAY_MODULE_PLAN_VERSION = 2 as const;
export const PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY = "four-adapter-v1" as const;
/**
 * Versioned proof boundary used by runtime recognition.
 *
 * Under plan v2 / four-adapter-v1, `gatewayLengthMeters` moves only the paired-corridor
 * descriptors along already-authored Process Loop seams. The four materialized outer adapters,
 * every authored build step, and their semantic owners are invariant throughout the valid gateway
 * length domain. A planner change that invalidates that statement must introduce a new policy value
 * before recognition may stop checking every alias individually.
 */
export const PRODUCTION_BAY_MODULE_GATEWAY_LENGTH_PROJECTION_POLICY = Object.freeze({
	version: 1 as const,
	productionBayModulePlanVersion: PRODUCTION_BAY_MODULE_PLAN_VERSION,
	productionBayModuleTopologyPolicy: PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY,
	pairedRailCorridorPlanVersion: PAIRED_RAIL_CORRIDOR_PLAN_VERSION,
	authoredProjectionInvariant: true as const,
});
export const PRODUCTION_BAY_MODULE_MINIMUM_OUTER_LENGTH_METERS = 8;
export const PRODUCTION_BAY_MODULE_MINIMUM_OUTER_DEPTH_METERS = 7;
export const PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS = 2_000;
export const PRODUCTION_BAY_MODULE_MINIMUM_SHELL_MARGIN_METERS = 3;
/** Two adjacent outer turnouts need distinct three-cell R500 support footprints. */
export const PRODUCTION_BAY_MODULE_MINIMUM_PROCESS_LOOP_GAP_METERS = 3;
export const PRODUCTION_BAY_MODULE_MINIMUM_PROCESS_LOOP_DEPTH_METERS = 2;
export const PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS = 1;

export type ProductionBayModuleLoopId = "outer-circulation" | "process-loop-a" | "process-loop-b";
export type ProductionBayProcessLoopCount = 1 | 2;
export type ProductionBayInternalFlowPattern = "alternating" | "co-rotating";
export type ProductionBayGatewayId = "origin-gateway" | "far-gateway";
export type ProductionBayLongitudinalEnd = "origin" | "far";
export type ProductionBayModulePose = Readonly<Required<RailTemplatePose>>;
export type ProductionBayGatewayAttachment =
	| "shared-directed-seam"
	| "materialized-tangent-adapter";

/** Serializable, grid-only request. The anchor is the outer loop's local origin. */
export interface ProductionBayModuleRequest {
	readonly version?: typeof PRODUCTION_BAY_MODULE_PLAN_VERSION;
	readonly anchor: Cell;
	readonly outerLengthMeters: number;
	readonly outerDepthMeters: number;
	readonly shellMarginMeters: number;
	readonly processLoopGapMeters: number;
	readonly gatewayLengthMeters: number;
	readonly processLoopCount?: ProductionBayProcessLoopCount;
	readonly internalFlowPattern?: ProductionBayInternalFlowPattern;
	readonly pose: RailTemplatePose;
}

export interface ProductionBayModuleSpecification {
	readonly version: typeof PRODUCTION_BAY_MODULE_PLAN_VERSION;
	readonly anchor: Cell;
	readonly outerLengthMeters: number;
	readonly outerDepthMeters: number;
	readonly shellMarginMeters: number;
	readonly processLoopGapMeters: number;
	readonly gatewayLengthMeters: number;
	readonly processLoopCount: ProductionBayProcessLoopCount;
	readonly internalFlowPattern: ProductionBayInternalFlowPattern;
	readonly topologyPolicy: typeof PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY;
	readonly pose: ProductionBayModulePose;
}

export interface ProductionBayModuleDimensions {
	readonly outerLengthMeters: number;
	readonly outerDepthMeters: number;
	readonly processLoopLengthMeters: number;
	readonly processLoopDepthMeters: number;
	readonly processLoopGapMeters: number;
	readonly shellMarginMeters: number;
	readonly gatewayLengthMeters: number;
	readonly processLoopCount: ProductionBayProcessLoopCount;
}

export interface ProductionBayDirectedLoop {
	readonly kind: "directed-loop";
	readonly id: ProductionBayModuleLoopId;
	readonly role: "bay-circulation" | "process-circulation";
	/** Geometric local origin, independent from route flow order. */
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly pose: ProductionBayModulePose;
	/** Closed route ordered in vehicle-flow direction. */
	readonly cells: readonly Cell[];
	readonly travelDirection: Direction;
	readonly newEdges: number;
	readonly perimeterMeters: number;
	readonly turns: 4;
}

export interface ProductionBayGatewayConnectionDescriptor {
	readonly id: string;
	readonly gatewayId: ProductionBayGatewayId;
	readonly scope: "outer-circulation" | "process-loop";
	readonly corridorEndpointId: PairedRailCorridorEndpointId;
	readonly corridorLaneId: PairedRailCorridorLaneId;
	readonly gatewayRole: PairedRailCorridorGatewayRole;
	readonly corridorCell: Cell;
	readonly corridorTravelDirection: Direction;
	readonly targetLoopId: ProductionBayModuleLoopId;
	readonly targetCell: Cell;
	readonly targetTravelDirection: Direction;
	readonly attachment: ProductionBayGatewayAttachment;
	readonly status: "satisfied";
	readonly distanceMeters: number;
	/** Ordered in vehicle-flow direction; empty only when an existing process seam is reused. */
	readonly adapterRoute: readonly Cell[];
}

export interface ProductionBayGatewayCorridorDescriptor {
	readonly kind: "paired-gateway-corridor";
	readonly id: ProductionBayGatewayId;
	readonly longitudinalEnd: ProductionBayLongitudinalEnd;
	/**
	 * The paired lanes reserve and reuse opposite-flow straight seams on the two process loops.
	 * They are not additional build routes.
	 */
	readonly corridor: PairedRailCorridorPlan;
	readonly outerFacingEnd: PairedRailCorridorEnd;
	readonly processFacingEnd: PairedRailCorridorEnd;
	readonly outerConnections: readonly [
		ProductionBayGatewayConnectionDescriptor,
		ProductionBayGatewayConnectionDescriptor,
	];
	readonly processConnections: readonly [
		ProductionBayGatewayConnectionDescriptor,
		ProductionBayGatewayConnectionDescriptor,
	];
}

export interface ProductionBayGatewayPair {
	readonly id: string;
	readonly processLoopId: Exclude<ProductionBayModuleLoopId, "outer-circulation">;
	readonly branch: ProductionBayGatewayConnectionDescriptor;
	readonly merge: ProductionBayGatewayConnectionDescriptor;
}

export type ProductionBayBuildStepKind = "shell" | "process-loop" | "branch" | "merge";
export type ProductionBayBuildStepOwner =
	| "BAY"
	| Exclude<ProductionBayModuleLoopId, "outer-circulation">;

export interface ProductionBayBuildStep {
	readonly id: string;
	readonly owner: ProductionBayBuildStepOwner;
	readonly kind: ProductionBayBuildStepKind;
	readonly route: readonly Cell[];
}

export interface ProductionBayModuleCompletionContract {
	readonly intermediateState: "all-gateways-materialized";
	readonly finalState: "closed-directed-topology";
	readonly unresolvedEndpointCount: 0;
	readonly resolvedConnectionIds: readonly string[];
}

export interface ProductionBayModuleBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/** Pure Bay geometry and connectivity contract. Exact placement certification belongs to compile. */
export interface ProductionBayModulePlan {
	readonly kind: "production-bay-module";
	readonly geometryValid: true;
	/** Physical-path certification and portable organization capture remain compile-layer work. */
	readonly placementReady: false;
	readonly reason: string;
	readonly specification: ProductionBayModuleSpecification;
	readonly dimensions: ProductionBayModuleDimensions;
	readonly outerLoop: ProductionBayDirectedLoop;
	readonly processLoops: readonly ProductionBayDirectedLoop[];
	readonly gatewayCorridors: readonly ProductionBayGatewayCorridorDescriptor[];
	/** Four materialized directed adapters grouped as two branch/merge pairs. */
	readonly gatewayPairs: readonly ProductionBayGatewayPair[];
	readonly connectivity: readonly ProductionBayGatewayConnectionDescriptor[];
	readonly adapterRoutes: readonly (readonly Cell[])[];
	readonly buildSteps: readonly ProductionBayBuildStep[];
	/** Dependency-ordered routes: outer, ingress adapter, child loop, then remaining adapters. */
	readonly buildRoutes: readonly (readonly Cell[])[];
	readonly occupiedCells: readonly Cell[];
	readonly cells: readonly Cell[];
	readonly bounds: ProductionBayModuleBounds;
	readonly completion: ProductionBayModuleCompletionContract;
	readonly newEdges: number;
	readonly lengthMeters: number;
	readonly turns: number;
	readonly fingerprint: string;
}

export function validateProductionBayModuleRequest(input: unknown): string | null {
	if (!isRecord(input)) return "Production Bay module request must be an object.";
	if (input.version !== undefined && input.version !== PRODUCTION_BAY_MODULE_PLAN_VERSION) {
		return `Production Bay module version must be ${PRODUCTION_BAY_MODULE_PLAN_VERSION}.`;
	}
	if (!isInt32Cell(input.anchor)) {
		return "Production Bay module anchor must use signed-int32 integer coordinates.";
	}
	if (
		!isBoundedInteger(
			input.outerLengthMeters,
			PRODUCTION_BAY_MODULE_MINIMUM_OUTER_LENGTH_METERS,
			PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS,
		)
	) {
		return `Production Bay outer length must be an integer from ${PRODUCTION_BAY_MODULE_MINIMUM_OUTER_LENGTH_METERS} to ${PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS} meters.`;
	}
	if (
		!isBoundedInteger(
			input.outerDepthMeters,
			PRODUCTION_BAY_MODULE_MINIMUM_OUTER_DEPTH_METERS,
			PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS,
		)
	) {
		return `Production Bay outer depth must be an integer from ${PRODUCTION_BAY_MODULE_MINIMUM_OUTER_DEPTH_METERS} to ${PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS} meters.`;
	}
	if (
		!isBoundedInteger(
			input.shellMarginMeters,
			PRODUCTION_BAY_MODULE_MINIMUM_SHELL_MARGIN_METERS,
			PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS,
		)
	) {
		return `Production Bay shell margin must be an integer from ${PRODUCTION_BAY_MODULE_MINIMUM_SHELL_MARGIN_METERS} to ${PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS} meters.`;
	}
	if (
		!isBoundedInteger(
			input.processLoopGapMeters,
			PRODUCTION_BAY_MODULE_MINIMUM_PROCESS_LOOP_GAP_METERS,
			PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS,
		)
	) {
		return `Production Bay process-loop gap must be an integer from ${PRODUCTION_BAY_MODULE_MINIMUM_PROCESS_LOOP_GAP_METERS} to ${PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS} meters.`;
	}
	if (
		!isBoundedInteger(
			input.gatewayLengthMeters,
			PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS,
			PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS,
		)
	) {
		return `Production Bay gateway length must be an integer from ${PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS} to ${PRODUCTION_BAY_MODULE_MAXIMUM_EXTENT_METERS} meters.`;
	}
	if (
		input.processLoopCount !== undefined &&
		input.processLoopCount !== 1 &&
		input.processLoopCount !== 2
	) {
		return "Production Bay process-loop count must be 1 or 2.";
	}
	if (
		input.internalFlowPattern !== undefined &&
		input.internalFlowPattern !== "alternating" &&
		input.internalFlowPattern !== "co-rotating"
	) {
		return 'Production Bay internal flow pattern must be "alternating" or "co-rotating".';
	}
	if (!isRecord(input.pose)) return "Production Bay module pose must be an object.";
	if (!isDirection(input.pose.forward)) {
		return "Production Bay module pose forward must be a cardinal Direction.";
	}
	if (input.pose.side !== "left" && input.pose.side !== "right") {
		return 'Production Bay module pose side must be "left" or "right".';
	}
	if (
		input.pose.flow !== undefined &&
		input.pose.flow !== "forward" &&
		input.pose.flow !== "reverse"
	) {
		return 'Production Bay module pose flow must be "forward" or "reverse".';
	}

	const outerLengthMeters = input.outerLengthMeters as number;
	const outerDepthMeters = input.outerDepthMeters as number;
	const shellMarginMeters = input.shellMarginMeters as number;
	const processLoopGapMeters = input.processLoopGapMeters as number;
	const gatewayLengthMeters = input.gatewayLengthMeters as number;
	const processLoopCount = (input.processLoopCount ?? 2) as ProductionBayProcessLoopCount;
	const processLoopLengthMeters = outerLengthMeters - shellMarginMeters * 2;
	if (processLoopLengthMeters <= 0) {
		return "Production Bay shell margin leaves no longitudinal process-loop space.";
	}
	if (processLoopLengthMeters <= gatewayLengthMeters * 2) {
		return "Production Bay gateway corridors overlap; the process-loop length must exceed twice the gateway length.";
	}
	const processDepthTotal =
		outerDepthMeters - shellMarginMeters * 2 - (processLoopCount === 2 ? processLoopGapMeters : 0);
	if (processDepthTotal <= 0) {
		return "Production Bay shell margin and process-loop spacing leave no process-loop depth.";
	}
	if (processLoopCount === 2 && processDepthTotal % 2 !== 0) {
		return "Production Bay process-loop depth remainder must be even on the 1 m grid.";
	}
	const processLoopDepthMeters = processLoopCount === 2 ? processDepthTotal / 2 : processDepthTotal;
	if (processLoopDepthMeters < PRODUCTION_BAY_MODULE_MINIMUM_PROCESS_LOOP_DEPTH_METERS) {
		return `Production Bay process-loop depth must be at least ${PRODUCTION_BAY_MODULE_MINIMUM_PROCESS_LOOP_DEPTH_METERS} meters.`;
	}

	const forward = input.pose.forward;
	const lateral = lateralDirection(forward, input.pose.side);
	const outerCorners = [
		input.anchor,
		offsetAlongAxes(input.anchor, forward, lateral, outerLengthMeters, 0),
		offsetAlongAxes(input.anchor, forward, lateral, outerLengthMeters, outerDepthMeters),
		offsetAlongAxes(input.anchor, forward, lateral, 0, outerDepthMeters),
	];
	if (!outerCorners.every(isInt32Cell)) {
		return "Production Bay module footprint exceeds signed-int32 coordinate bounds.";
	}
	return null;
}

export function planProductionBayModule(
	request: ProductionBayModuleRequest,
): ProductionBayModulePlan {
	const specification = normalizeRequest(request);
	const dimensions = deriveDimensions(specification);
	const outerLoop = materializeDirectedLoop(
		"outer-circulation",
		"bay-circulation",
		specification.anchor,
		dimensions.outerLengthMeters,
		dimensions.outerDepthMeters,
		specification.pose,
	);
	const processAOrigin = localCell(
		specification,
		dimensions.shellMarginMeters,
		dimensions.shellMarginMeters,
	);
	const processBOrigin = localCell(
		specification,
		dimensions.shellMarginMeters,
		dimensions.shellMarginMeters +
			dimensions.processLoopDepthMeters +
			dimensions.processLoopGapMeters,
	);
	const processA = materializeDirectedLoop(
		"process-loop-a",
		"process-circulation",
		processAOrigin,
		dimensions.processLoopLengthMeters,
		dimensions.processLoopDepthMeters,
		specification.pose,
	);
	const processBPose =
		specification.internalFlowPattern === "alternating"
			? Object.freeze({
					...specification.pose,
					flow: oppositeFlow(specification.pose.flow),
				})
			: specification.pose;
	const processB =
		specification.processLoopCount === 2
			? materializeDirectedLoop(
					"process-loop-b",
					"process-circulation",
					processBOrigin,
					dimensions.processLoopLengthMeters,
					dimensions.processLoopDepthMeters,
					processBPose,
				)
			: null;
	const processLoops = Object.freeze(
		processB ? [processA, processB] : [processA],
	) satisfies readonly ProductionBayDirectedLoop[];
	const originGateway = materializeGateway(
		"origin-gateway",
		"origin",
		specification,
		dimensions,
		outerLoop,
		processLoops,
	);
	const farGateway = materializeGateway(
		"far-gateway",
		"far",
		specification,
		dimensions,
		outerLoop,
		processLoops,
	);
	const gatewayCorridors = Object.freeze([originGateway, farGateway]);
	const gatewayPairs = deriveGatewayPairs(gatewayCorridors, processLoops);
	const connectivity = Object.freeze(
		gatewayCorridors.flatMap((gateway) => [
			...gateway.outerConnections,
			...gateway.processConnections,
		]),
	);
	const adapterRoutes = Object.freeze(
		gatewayCorridors.flatMap((gateway) =>
			gateway.outerConnections.map((connection) => connection.adapterRoute),
		),
	);
	const buildSteps = dependencyOrderedBuildSteps(outerLoop, processLoops, gatewayCorridors);
	const buildRoutes = Object.freeze(buildSteps.map((step) => step.route));
	const occupiedCells = uniqueRouteCells(buildRoutes);
	const loopLengthMeters =
		outerLoop.newEdges + processLoops.reduce((sum, loop) => sum + loop.newEdges, 0);
	const adapterLengthMeters = adapterRoutes.reduce(
		(sum, route) => sum + Math.max(0, route.length - 1),
		0,
	);
	const resolvedConnectionIds = Object.freeze(
		gatewayCorridors.flatMap((gateway) =>
			gateway.outerConnections.map((connection) => connection.id),
		),
	);
	const completion = Object.freeze({
		intermediateState: "all-gateways-materialized" as const,
		finalState: "closed-directed-topology" as const,
		unresolvedEndpointCount: 0 as const,
		resolvedConnectionIds,
	});
	const planWithoutFingerprint = Object.freeze({
		kind: "production-bay-module" as const,
		geometryValid: true as const,
		placementReady: false as const,
		reason:
			"Production Bay module geometry and gateway routes are complete; compile-layer physical certification and organization capture remain required before placement.",
		specification,
		dimensions,
		outerLoop,
		processLoops,
		gatewayCorridors,
		gatewayPairs,
		connectivity,
		adapterRoutes,
		buildSteps,
		buildRoutes,
		occupiedCells,
		cells: occupiedCells,
		bounds: boundsForCells(outerLoop.cells),
		completion,
		newEdges: loopLengthMeters + adapterLengthMeters,
		lengthMeters: loopLengthMeters + adapterLengthMeters,
		turns: 4 * (1 + processLoops.length),
	});
	return Object.freeze({
		...planWithoutFingerprint,
		fingerprint: checksumPlan(planWithoutFingerprint),
	});
}

export function productionBayModuleFingerprint(request: ProductionBayModuleRequest): string {
	return planProductionBayModule(request).fingerprint;
}

function normalizeRequest(request: ProductionBayModuleRequest): ProductionBayModuleSpecification {
	const error = validateProductionBayModuleRequest(request);
	if (error) throw new RangeError(error);
	return Object.freeze({
		version: PRODUCTION_BAY_MODULE_PLAN_VERSION,
		anchor: freezeCell(request.anchor),
		outerLengthMeters: request.outerLengthMeters,
		outerDepthMeters: request.outerDepthMeters,
		shellMarginMeters: request.shellMarginMeters,
		processLoopGapMeters: request.processLoopGapMeters,
		gatewayLengthMeters: request.gatewayLengthMeters,
		processLoopCount: request.processLoopCount ?? 2,
		internalFlowPattern: request.internalFlowPattern ?? "alternating",
		topologyPolicy: PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY,
		pose: Object.freeze({
			forward: request.pose.forward,
			side: request.pose.side,
			flow: request.pose.flow ?? "forward",
		}),
	});
}

function deriveDimensions(
	specification: ProductionBayModuleSpecification,
): ProductionBayModuleDimensions {
	return Object.freeze({
		outerLengthMeters: specification.outerLengthMeters,
		outerDepthMeters: specification.outerDepthMeters,
		processLoopLengthMeters: specification.outerLengthMeters - specification.shellMarginMeters * 2,
		processLoopDepthMeters:
			(specification.outerDepthMeters -
				specification.shellMarginMeters * 2 -
				(specification.processLoopCount === 2 ? specification.processLoopGapMeters : 0)) /
			specification.processLoopCount,
		processLoopGapMeters: specification.processLoopGapMeters,
		shellMarginMeters: specification.shellMarginMeters,
		gatewayLengthMeters: specification.gatewayLengthMeters,
		processLoopCount: specification.processLoopCount,
	});
}

function materializeDirectedLoop(
	id: ProductionBayModuleLoopId,
	role: ProductionBayDirectedLoop["role"],
	origin: Cell,
	lengthMeters: number,
	depthMeters: number,
	pose: ProductionBayModulePose,
): ProductionBayDirectedLoop {
	const lateral = lateralDirection(pose.forward, pose.side);
	const geometricRoute = materializeCardinalPolyline([
		origin,
		offsetAlongAxes(origin, pose.forward, lateral, lengthMeters, 0),
		offsetAlongAxes(origin, pose.forward, lateral, lengthMeters, depthMeters),
		offsetAlongAxes(origin, pose.forward, lateral, 0, depthMeters),
		origin,
	]);
	const cells = pose.flow === "forward" ? geometricRoute : reverseClosedRoute(geometricRoute);
	const firstDirection = directionBetween(cells[0] as Cell, cells[1] as Cell);
	if (firstDirection === null) throw new Error(`Production Bay loop ${id} has no first edge.`);
	const perimeter = 2 * (lengthMeters + depthMeters);
	return Object.freeze({
		kind: "directed-loop",
		id,
		role,
		origin: freezeCell(origin),
		lengthMeters,
		depthMeters,
		pose,
		cells,
		travelDirection: firstDirection,
		newEdges: perimeter,
		perimeterMeters: perimeter,
		turns: 4,
	});
}

interface ProductionBayGatewaySeam {
	readonly lateralMeters: number;
	readonly loop: ProductionBayDirectedLoop;
}

function productionGatewaySeams(
	specification: ProductionBayModuleSpecification,
	dimensions: ProductionBayModuleDimensions,
	processLoops: readonly ProductionBayDirectedLoop[],
): readonly [ProductionBayGatewaySeam, ProductionBayGatewaySeam] {
	const first = processLoops[0];
	if (!first) throw new Error("Production Bay requires at least one Process Loop.");
	if (dimensions.processLoopCount === 1) {
		return Object.freeze([
			Object.freeze({ lateralMeters: dimensions.shellMarginMeters, loop: first }),
			Object.freeze({
				lateralMeters: dimensions.shellMarginMeters + dimensions.processLoopDepthMeters,
				loop: first,
			}),
		]);
	}
	const second = processLoops[1];
	if (!second) throw new Error("Twin Production Bay requires two Process Loops.");
	if (specification.internalFlowPattern === "alternating") {
		return Object.freeze([
			Object.freeze({ lateralMeters: dimensions.shellMarginMeters, loop: first }),
			Object.freeze({
				lateralMeters:
					dimensions.shellMarginMeters +
					dimensions.processLoopDepthMeters +
					dimensions.processLoopGapMeters,
				loop: second,
			}),
		]);
	}
	return Object.freeze([
		Object.freeze({
			lateralMeters: dimensions.shellMarginMeters + dimensions.processLoopDepthMeters,
			loop: first,
		}),
		Object.freeze({
			lateralMeters:
				dimensions.shellMarginMeters +
				dimensions.processLoopDepthMeters +
				dimensions.processLoopGapMeters,
			loop: second,
		}),
	]);
}

function materializeGateway(
	id: ProductionBayGatewayId,
	longitudinalEnd: ProductionBayLongitudinalEnd,
	specification: ProductionBayModuleSpecification,
	dimensions: ProductionBayModuleDimensions,
	outerLoop: ProductionBayDirectedLoop,
	processLoops: readonly ProductionBayDirectedLoop[],
): ProductionBayGatewayCorridorDescriptor {
	const startLongitudinal =
		longitudinalEnd === "origin"
			? dimensions.shellMarginMeters
			: dimensions.outerLengthMeters -
				dimensions.shellMarginMeters -
				dimensions.gatewayLengthMeters;
	const seams = productionGatewaySeams(specification, dimensions, processLoops);
	const primaryLateral = seams[0].lateralMeters;
	const secondaryLateral = seams[1].lateralMeters;
	const processFacingLongitudinal =
		longitudinalEnd === "origin"
			? startLongitudinal + dimensions.gatewayLengthMeters
			: startLongitudinal;
	const primaryProcessCell = localCell(specification, processFacingLongitudinal, primaryLateral);
	const primaryProcessDirection = travelDirectionAt(seams[0].loop.cells, primaryProcessCell);
	if (
		primaryProcessDirection !== specification.pose.forward &&
		primaryProcessDirection !== oppositeDirection(specification.pose.forward)
	) {
		throw new Error(`Production Bay gateway ${id} process seam is not longitudinal.`);
	}
	const corridor = planPairedRailCorridor({
		anchor: localCell(specification, startLongitudinal, primaryLateral),
		lengthMeters: dimensions.gatewayLengthMeters,
		laneSpacingMeters: secondaryLateral - primaryLateral,
		pose: {
			forward: specification.pose.forward,
			side: specification.pose.side,
			flow: primaryProcessDirection === specification.pose.forward ? "forward" : "reverse",
		},
	});
	const outerFacingEnd: PairedRailCorridorEnd = longitudinalEnd === "origin" ? "origin" : "far";
	const processFacingEnd: PairedRailCorridorEnd = longitudinalEnd === "origin" ? "far" : "origin";
	const outerConnections = Object.freeze(
		(["primary", "secondary"] as const).map((laneId, index) => {
			const endpoint = endpointFor(corridor, laneId, outerFacingEnd);
			const lateral = seams[index].lateralMeters;
			const targetCell = localCell(
				specification,
				longitudinalEnd === "origin" ? 0 : dimensions.outerLengthMeters,
				lateral,
			);
			const adapterRoute =
				endpoint.gatewayRole === "branch"
					? materializeCardinalPolyline([targetCell, endpoint.cell])
					: materializeCardinalPolyline([endpoint.cell, targetCell]);
			return connectionDescriptor({
				id: `${id}:outer:${laneId}`,
				gatewayId: id,
				scope: "outer-circulation",
				endpoint,
				targetLoop: outerLoop,
				targetCell,
				attachment: "materialized-tangent-adapter",
				status: "satisfied",
				distanceMeters: dimensions.shellMarginMeters,
				adapterRoute,
			});
		}) as [ProductionBayGatewayConnectionDescriptor, ProductionBayGatewayConnectionDescriptor],
	);
	const processConnections = Object.freeze(
		(["primary", "secondary"] as const).map((laneId, index) => {
			const endpoint = endpointFor(corridor, laneId, processFacingEnd);
			const targetLoop = seams[index].loop;
			return connectionDescriptor({
				id: `${id}:process:${laneId}`,
				gatewayId: id,
				scope: "process-loop",
				endpoint,
				targetLoop,
				targetCell: endpoint.cell,
				attachment: "shared-directed-seam",
				status: "satisfied",
				distanceMeters: 0,
				adapterRoute: Object.freeze([]),
			});
		}) as [ProductionBayGatewayConnectionDescriptor, ProductionBayGatewayConnectionDescriptor],
	);
	for (const connection of processConnections) {
		if (connection.corridorTravelDirection !== connection.targetTravelDirection) {
			throw new Error(`Production Bay gateway ${id} does not match process-loop flow.`);
		}
	}
	return Object.freeze({
		kind: "paired-gateway-corridor",
		id,
		longitudinalEnd,
		corridor,
		outerFacingEnd,
		processFacingEnd,
		outerConnections,
		processConnections,
	});
}

interface ProductionBayAdapterBinding {
	readonly outer: ProductionBayGatewayConnectionDescriptor;
	readonly process: ProductionBayGatewayConnectionDescriptor;
}

function gatewayAdapterBindings(
	gateways: readonly ProductionBayGatewayCorridorDescriptor[],
): readonly ProductionBayAdapterBinding[] {
	const bindings: ProductionBayAdapterBinding[] = [];
	for (const gateway of gateways) {
		for (const laneId of ["primary", "secondary"] as const) {
			const outer = gateway.outerConnections.find(
				(connection) => connection.corridorLaneId === laneId,
			);
			const process = gateway.processConnections.find(
				(connection) => connection.corridorLaneId === laneId,
			);
			if (!outer || !process) {
				throw new Error(`Production Bay gateway ${gateway.id} is missing lane ${laneId}.`);
			}
			bindings.push(Object.freeze({ outer, process }));
		}
	}
	if (bindings.length !== 4) {
		throw new Error(`Production Bay ${PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY} requires 4 adapters.`);
	}
	return Object.freeze(bindings);
}

function deriveGatewayPairs(
	gateways: readonly ProductionBayGatewayCorridorDescriptor[],
	processLoops: readonly ProductionBayDirectedLoop[],
): readonly ProductionBayGatewayPair[] {
	const bindings = gatewayAdapterBindings(gateways);
	const pairSources: readonly (readonly ProductionBayAdapterBinding[])[] =
		processLoops.length === 1
			? gateways.map((gateway) =>
					bindings.filter((binding) => binding.outer.gatewayId === gateway.id),
				)
			: processLoops.map((loop) =>
					bindings.filter((binding) => binding.process.targetLoopId === loop.id),
				);
	const pairs = pairSources.map((sources, index) => {
		const branch = sources.find((binding) => binding.outer.gatewayRole === "branch");
		const merge = sources.find((binding) => binding.outer.gatewayRole === "merge");
		if (!branch || !merge || sources.length !== 2) {
			throw new Error(`Production Bay gateway pair ${index + 1} is not one branch and one merge.`);
		}
		if (branch.process.targetLoopId !== merge.process.targetLoopId) {
			throw new Error(`Production Bay gateway pair ${index + 1} targets multiple Process Loops.`);
		}
		if (branch.process.targetLoopId === "outer-circulation") {
			throw new Error(`Production Bay gateway pair ${index + 1} has no Process Loop target.`);
		}
		return Object.freeze({
			id: `${branch.process.targetLoopId}:gateway-pair-${index + 1}`,
			processLoopId: branch.process.targetLoopId,
			branch: branch.outer,
			merge: merge.outer,
		});
	});
	if (pairs.length !== 2) {
		throw new Error(`Production Bay ${PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY} requires 2 pairs.`);
	}
	return Object.freeze(pairs);
}

function dependencyOrderedBuildSteps(
	outerLoop: ProductionBayDirectedLoop,
	processLoops: readonly ProductionBayDirectedLoop[],
	gateways: readonly ProductionBayGatewayCorridorDescriptor[],
): readonly ProductionBayBuildStep[] {
	const adaptersByLoopId = new Map<
		ProductionBayModuleLoopId,
		ProductionBayGatewayConnectionDescriptor[]
	>();
	for (const binding of gatewayAdapterBindings(gateways)) {
		const adapters = adaptersByLoopId.get(binding.process.targetLoopId) ?? [];
		adapters.push(binding.outer);
		adaptersByLoopId.set(binding.process.targetLoopId, adapters);
	}

	const steps: ProductionBayBuildStep[] = [
		Object.freeze({
			id: "bay-shell",
			owner: "BAY",
			kind: "shell",
			route: outerLoop.cells,
		}),
	];
	for (const loop of processLoops) {
		const adapters = adaptersByLoopId.get(loop.id) ?? [];
		const bootstrap = adapters.find((adapter) => adapter.gatewayRole === "branch") ?? adapters[0];
		if (!bootstrap)
			throw new Error(`Production Bay Process Loop ${loop.id} has no ingress adapter.`);
		steps.push(
			buildAdapterStep(bootstrap),
			Object.freeze({
				id: loop.id,
				owner: loop.id as Exclude<ProductionBayModuleLoopId, "outer-circulation">,
				kind: "process-loop",
				route: loop.cells,
			}),
		);
		for (const adapter of adapters) {
			if (adapter !== bootstrap) steps.push(buildAdapterStep(adapter));
		}
	}
	return Object.freeze(steps);
}

function buildAdapterStep(
	adapter: ProductionBayGatewayConnectionDescriptor,
): ProductionBayBuildStep {
	return Object.freeze({
		id: adapter.id,
		owner: "BAY",
		kind: adapter.gatewayRole,
		route: adapter.adapterRoute,
	});
}

function connectionDescriptor(input: {
	readonly id: string;
	readonly gatewayId: ProductionBayGatewayId;
	readonly scope: ProductionBayGatewayConnectionDescriptor["scope"];
	readonly endpoint: PairedRailCorridorEndpointDescriptor;
	readonly targetLoop: ProductionBayDirectedLoop;
	readonly targetCell: Cell;
	readonly attachment: ProductionBayGatewayAttachment;
	readonly status: ProductionBayGatewayConnectionDescriptor["status"];
	readonly distanceMeters: number;
	readonly adapterRoute: readonly Cell[];
}): ProductionBayGatewayConnectionDescriptor {
	return Object.freeze({
		id: input.id,
		gatewayId: input.gatewayId,
		scope: input.scope,
		corridorEndpointId: input.endpoint.id,
		corridorLaneId: input.endpoint.laneId,
		gatewayRole: input.endpoint.gatewayRole,
		corridorCell: input.endpoint.cell,
		corridorTravelDirection: input.endpoint.travelDirection,
		targetLoopId: input.targetLoop.id,
		targetCell: freezeCell(input.targetCell),
		targetTravelDirection: travelDirectionAt(input.targetLoop.cells, input.targetCell),
		attachment: input.attachment,
		status: input.status,
		distanceMeters: input.distanceMeters,
		adapterRoute: input.adapterRoute,
	});
}

function endpointFor(
	corridor: PairedRailCorridorPlan,
	laneId: PairedRailCorridorLaneId,
	end: PairedRailCorridorEnd,
): PairedRailCorridorEndpointDescriptor {
	const endpoint = corridor.endpoints.find(
		(candidate) => candidate.laneId === laneId && candidate.end === end,
	);
	if (!endpoint) {
		throw new Error(`Production Bay gateway endpoint ${laneId}-${end} is missing.`);
	}
	return endpoint;
}

function travelDirectionAt(route: readonly Cell[], target: Cell): Direction {
	for (let index = 0; index < route.length - 1; index++) {
		const cell = route[index] as Cell;
		if (cell.x !== target.x || cell.y !== target.y) continue;
		const direction = directionBetween(cell, route[index + 1] as Cell);
		if (direction !== null) return direction;
	}
	throw new Error(`Production Bay target cell ${target.x},${target.y} is not on a directed loop.`);
}

function materializeCardinalPolyline(points: readonly Cell[]): readonly Cell[] {
	const cells: Cell[] = [];
	for (let index = 1; index < points.length; index++) {
		const start = points[index - 1] as Cell;
		const end = points[index] as Cell;
		const direction = cardinalDirectionBetween(start, end);
		const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		for (let step = cells.length === 0 ? 0 : 1; step <= distance; step++) {
			cells.push(freezeCell(offsetCell(start, direction, step)));
		}
	}
	return Object.freeze(cells);
}

function cardinalDirectionBetween(start: Cell, end: Cell): Direction {
	if (start.x !== end.x && start.y !== end.y) {
		throw new Error("Production Bay loop segments must remain cardinal.");
	}
	if (start.x === end.x && start.y === end.y) {
		throw new Error("Production Bay loop segments must have positive length.");
	}
	if (start.x === end.x) return end.y > start.y ? DIR_S : DIR_N;
	return end.x > start.x ? DIR_E : DIR_W;
}

function reverseClosedRoute(route: readonly Cell[]): readonly Cell[] {
	return Object.freeze([...route].reverse());
}

function uniqueRouteCells(routes: readonly (readonly Cell[])[]): readonly Cell[] {
	const cells = new Map<string, Cell>();
	for (const route of routes) {
		for (const cell of route) {
			const key = `${cell.x},${cell.y}`;
			if (!cells.has(key)) cells.set(key, cell);
		}
	}
	return Object.freeze([...cells.values()]);
}

function boundsForCells(cells: readonly Cell[]): ProductionBayModuleBounds {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const cell of cells) {
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
		maxX = Math.max(maxX, cell.x);
		maxY = Math.max(maxY, cell.y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function localCell(
	specification: ProductionBayModuleSpecification,
	longitudinalMeters: number,
	lateralMeters: number,
): Cell {
	return freezeCell(
		offsetAlongAxes(
			specification.anchor,
			specification.pose.forward,
			lateralDirection(specification.pose.forward, specification.pose.side),
			longitudinalMeters,
			lateralMeters,
		),
	);
}

function offsetAlongAxes(
	origin: Cell,
	forward: Direction,
	lateral: Direction,
	longitudinalMeters: number,
	lateralMeters: number,
): Cell {
	const forwardVector = directionVector(forward);
	const lateralVector = directionVector(lateral);
	return {
		x: origin.x + forwardVector.x * longitudinalMeters + lateralVector.x * lateralMeters,
		y: origin.y + forwardVector.y * longitudinalMeters + lateralVector.y * lateralMeters,
	};
}

function offsetCell(origin: Cell, direction: Direction, distance: number): Cell {
	const vector = directionVector(direction);
	return {
		x: origin.x + vector.x * distance,
		y: origin.y + vector.y * distance,
	};
}

function directionVector(direction: Direction): Cell {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function lateralDirection(forward: Direction, side: RailTemplatePose["side"]): Direction {
	const right =
		forward === DIR_N ? DIR_E : forward === DIR_E ? DIR_S : forward === DIR_S ? DIR_W : DIR_N;
	return side === "right" ? right : oppositeDirection(right);
}

function oppositeFlow(flow: "forward" | "reverse"): "forward" | "reverse" {
	return flow === "forward" ? "reverse" : "forward";
}

function checksumPlan(plan: Omit<ProductionBayModulePlan, "fingerprint">): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"PRODUCTION_BAY_MODULE",
		plan.kind,
		plan.specification.topologyPolicy,
		plan.specification.internalFlowPattern,
		plan.specification.pose.side,
		plan.specification.pose.flow,
		plan.completion.intermediateState,
		plan.completion.finalState,
	]);
	checksum.addNumbers([
		plan.specification.version,
		plan.specification.anchor.x,
		plan.specification.anchor.y,
		plan.specification.outerLengthMeters,
		plan.specification.outerDepthMeters,
		plan.specification.shellMarginMeters,
		plan.specification.processLoopGapMeters,
		plan.specification.gatewayLengthMeters,
		plan.specification.processLoopCount,
		plan.specification.pose.forward,
		plan.dimensions.processLoopLengthMeters,
		plan.dimensions.processLoopDepthMeters,
		plan.newEdges,
		plan.lengthMeters,
		plan.turns,
		plan.completion.unresolvedEndpointCount,
	]);
	for (const loop of [plan.outerLoop, ...plan.processLoops]) {
		checksum.addStrings([loop.id, loop.kind, loop.role, loop.pose.side, loop.pose.flow]);
		checksum.addNumbers([
			loop.origin.x,
			loop.origin.y,
			loop.lengthMeters,
			loop.depthMeters,
			loop.pose.forward,
			loop.travelDirection,
			loop.cells.length,
		]);
		for (const cell of loop.cells) checksum.addNumbers([cell.x, cell.y]);
	}
	for (const gateway of plan.gatewayCorridors) {
		checksum.addStrings([
			gateway.id,
			gateway.kind,
			gateway.longitudinalEnd,
			gateway.outerFacingEnd,
			gateway.processFacingEnd,
			gateway.corridor.fingerprint,
		]);
	}
	for (const pair of plan.gatewayPairs) {
		checksum.addStrings([
			pair.id,
			pair.processLoopId,
			pair.branch.id,
			pair.branch.gatewayRole,
			pair.merge.id,
			pair.merge.gatewayRole,
		]);
	}
	for (const connection of plan.connectivity) {
		checksum.addStrings([
			connection.id,
			connection.gatewayId,
			connection.scope,
			connection.corridorEndpointId,
			connection.corridorLaneId,
			connection.gatewayRole,
			connection.targetLoopId,
			connection.attachment,
			connection.status,
		]);
		checksum.addNumbers([
			connection.corridorCell.x,
			connection.corridorCell.y,
			connection.corridorTravelDirection,
			connection.targetCell.x,
			connection.targetCell.y,
			connection.targetTravelDirection,
			connection.distanceMeters,
			connection.adapterRoute.length,
		]);
		for (const cell of connection.adapterRoute) checksum.addNumbers([cell.x, cell.y]);
	}
	checksum.addStrings(plan.completion.resolvedConnectionIds);
	for (const step of plan.buildSteps) {
		checksum.addStrings([step.id, step.owner, step.kind]);
		checksum.addNumbers([step.route.length]);
		for (const cell of step.route) checksum.addNumbers([cell.x, cell.y]);
	}
	return checksum.digest();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isDirection(value: unknown): value is Direction {
	return typeof value === "number" && ALL_DIRECTIONS.includes(value as Direction);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): boolean {
	return (
		Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
	);
}

function isInt32Cell(value: unknown): value is Cell {
	if (!isRecord(value)) return false;
	return isInt32(value.x) && isInt32(value.y);
}

function isInt32(value: unknown): boolean {
	return (
		Number.isInteger(value) &&
		(value as number) >= -2_147_483_648 &&
		(value as number) <= 2_147_483_647
	);
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
