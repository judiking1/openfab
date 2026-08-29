import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type PairedRailCorridorLaneId,
	type PairedRailCorridorPlan,
	type PairedRailCorridorRequest,
	type PairedRailCorridorSpecification,
	planPairedRailCorridor,
	validatePairedRailCorridorRequest,
} from "../core/PairedRailCorridorPlanner";
import {
	type PairedRailPerimeterLaneId,
	type PairedRailPerimeterPlan,
	type PairedRailPerimeterRequest,
	type PairedRailPerimeterSpecification,
	planPairedRailPerimeter,
	validatePairedRailPerimeterRequest,
} from "../core/PairedRailPerimeterPlanner";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	oppositeDirection,
} from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION = 1 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_TOPOLOGY_POLICY =
	"primary-branch-secondary-return-two-stem-v1" as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_OWNER = "BANK" as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS = 2 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_PARENT_LANE_SPACING_METERS = 4 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_SETBACK_METERS = 24 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_JUNCTION_STATION_METERS = 8 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS = 8 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_SERVICE_BAND_METERS = 8 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_PARENT_JUNCTION_SPACING_METERS = 18 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES = 72 as const;
export const PRODUCTION_BANK_PARENT_GATEWAY_REUSED_SUPPORT_EDGES = 32 as const;

export const PRODUCTION_BANK_PARENT_GATEWAY_BANK_REPETITION_AXES = Object.freeze([
	"EAST_WEST",
	"NORTH_SOUTH",
] as const);

export type ProductionBankParentGatewayBankRepetitionAxis =
	(typeof PRODUCTION_BANK_PARENT_GATEWAY_BANK_REPETITION_AXES)[number];
export type ProductionBankParentGatewayConnectionId = "outbound" | "return";
export type ProductionBankParentGatewayBuildStepKind = "bank-to-fab-stem" | "fab-to-bank-stem";
export type ProductionBankParentGatewayRailRole =
	| "BANK_COLLECTOR_PRIMARY"
	| "BANK_COLLECTOR_SECONDARY"
	| "FAB_INNER_PERIMETER";

/** Pure geometry intent for attaching one closed Bank collector to its Fab perimeter. */
export interface ProductionBankParentGatewayRequest {
	readonly version: typeof PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION;
	readonly bankRepetitionAxis: ProductionBankParentGatewayBankRepetitionAxis;
	readonly collector: PairedRailCorridorRequest;
	readonly parentPerimeter: PairedRailPerimeterRequest;
}

export interface ProductionBankParentGatewaySpecification {
	readonly version: typeof PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION;
	readonly topologyPolicy: typeof PRODUCTION_BANK_PARENT_GATEWAY_TOPOLOGY_POLICY;
	readonly bankRepetitionAxis: ProductionBankParentGatewayBankRepetitionAxis;
	readonly collector: PairedRailCorridorSpecification;
	readonly collectorPlanFingerprint: string;
	readonly parentPerimeter: PairedRailPerimeterSpecification;
	readonly parentPerimeterPlanFingerprint: string;
	readonly collectorBranchLaneId: Extract<PairedRailCorridorLaneId, "primary">;
	readonly collectorMergeLaneId: Extract<PairedRailCorridorLaneId, "secondary">;
	readonly parentLaneId: Extract<PairedRailPerimeterLaneId, "inner">;
	readonly collectorLaneSpacingMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS;
	readonly parentLaneSpacingMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_PARENT_LANE_SPACING_METERS;
	readonly collectorSetbackMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_SETBACK_METERS;
	readonly junctionStationMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_JUNCTION_STATION_METERS;
	readonly supportMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS;
	readonly serviceBandMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_SERVICE_BAND_METERS;
	readonly parentJunctionSpacingMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_PARENT_JUNCTION_SPACING_METERS;
}

export interface ProductionBankParentGatewayDirectedEdge {
	readonly from: Cell;
	readonly to: Cell;
}

export interface ProductionBankParentGatewayConnection {
	readonly id: ProductionBankParentGatewayConnectionId;
	readonly owner: typeof PRODUCTION_BANK_PARENT_GATEWAY_OWNER;
	readonly sourceRole: ProductionBankParentGatewayRailRole;
	readonly targetRole: ProductionBankParentGatewayRailRole;
	readonly sourceGatewayRole: "branch";
	readonly targetGatewayRole: "merge";
	readonly sourceTravelDirection: Direction;
	readonly targetTravelDirection: Direction;
	readonly branchCell: Cell;
	readonly mergeCell: Cell;
	/** Full route submitted to planRailRouteBatch, including both existing support seams. */
	readonly planningRoute: readonly Cell[];
	/** Only these previously absent directed edges receive BANK ownership. */
	readonly ownedEdgeRoute: readonly Cell[];
	readonly ownedDirectedEdges: readonly ProductionBankParentGatewayDirectedEdge[];
	readonly reusedSourceSupportRoute: readonly Cell[];
	readonly reusedSourceSupportDirectedEdges: readonly ProductionBankParentGatewayDirectedEdge[];
	readonly reusedTargetSupportRoute: readonly Cell[];
	readonly reusedTargetSupportDirectedEdges: readonly ProductionBankParentGatewayDirectedEdge[];
}

export interface ProductionBankParentGatewayBuildStep {
	readonly id: ProductionBankParentGatewayConnectionId;
	readonly owner: typeof PRODUCTION_BANK_PARENT_GATEWAY_OWNER;
	readonly kind: ProductionBankParentGatewayBuildStepKind;
	readonly route: readonly Cell[];
	readonly ownedDirectedEdges: readonly ProductionBankParentGatewayDirectedEdge[];
}

export interface ProductionBankParentGatewayOwnershipIntent {
	readonly owner: typeof PRODUCTION_BANK_PARENT_GATEWAY_OWNER;
	readonly scope: "ADDED_DIRECTED_EDGES_ONLY";
	readonly directedEdges: readonly ProductionBankParentGatewayDirectedEdge[];
}

export interface ProductionBankParentGatewayBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface ProductionBankParentGatewayPlan {
	readonly kind: "production-bank-parent-gateway";
	readonly geometryValid: true;
	readonly placementReady: false;
	readonly reason: string;
	readonly specification: ProductionBankParentGatewaySpecification;
	readonly collector: PairedRailCorridorPlan;
	readonly parentPerimeter: PairedRailPerimeterPlan;
	readonly connections: readonly [
		ProductionBankParentGatewayConnection,
		ProductionBankParentGatewayConnection,
	];
	readonly buildSteps: readonly [
		ProductionBankParentGatewayBuildStep,
		ProductionBankParentGatewayBuildStep,
	];
	readonly buildRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly ownershipIntent: ProductionBankParentGatewayOwnershipIntent;
	readonly occupiedCells: readonly Cell[];
	readonly cells: readonly Cell[];
	readonly bounds: ProductionBankParentGatewayBounds;
	readonly newEdges: typeof PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES;
	readonly lengthMeters: typeof PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES;
	readonly reusedSupportEdges: typeof PRODUCTION_BANK_PARENT_GATEWAY_REUSED_SUPPORT_EDGES;
	readonly fingerprint: string;
}

const REQUEST_KEYS = Object.freeze([
	"version",
	"bankRepetitionAxis",
	"collector",
	"parentPerimeter",
] as const);

export function validateProductionBankParentGatewayRequest(input: unknown): string | null {
	if (!isRecord(input)) return "Production Bank parent gateway request must be an object.";
	if (!hasOnlyKnownKeys(input, REQUEST_KEYS)) {
		return "Production Bank parent gateway fields do not match the version 1 contract.";
	}
	if (input.version !== PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION) {
		return `Production Bank parent gateway version must be ${PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION}.`;
	}
	if (!isBankRepetitionAxis(input.bankRepetitionAxis)) {
		return 'Production Bank parent gateway Bank repetition axis must be "EAST_WEST" or "NORTH_SOUTH".';
	}
	const collectorError = validatePairedRailCorridorRequest(input.collector);
	if (collectorError)
		return `Production Bank parent gateway collector is invalid: ${collectorError}`;
	const perimeterError = validatePairedRailPerimeterRequest(input.parentPerimeter);
	if (perimeterError) {
		return `Production Bank parent gateway parent perimeter is invalid: ${perimeterError}`;
	}

	const axis = input.bankRepetitionAxis;
	const collectorRequest = input.collector as PairedRailCorridorRequest;
	const perimeterRequest = input.parentPerimeter as PairedRailPerimeterRequest;
	const frame = frameForAxis(axis);
	if (
		collectorRequest.laneSpacingMeters !==
		PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS
	) {
		return `Production Bank parent gateway collector lane spacing must be ${PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS} meters.`;
	}
	if (collectorRequest.pose.forward !== frame.along) {
		return "Production Bank parent gateway collector direction does not match the Bank repetition axis.";
	}
	if (collectorRequest.pose.side !== "right") {
		return 'Production Bank parent gateway collector secondary lane must use pose side "right".';
	}
	if ((collectorRequest.pose.flow ?? "forward") !== "reverse") {
		return 'Production Bank parent gateway collector must use pose flow "reverse".';
	}
	if (
		perimeterRequest.laneSpacingMeters !== PRODUCTION_BANK_PARENT_GATEWAY_PARENT_LANE_SPACING_METERS
	) {
		return `Production Bank parent gateway parent perimeter lane spacing must be ${PRODUCTION_BANK_PARENT_GATEWAY_PARENT_LANE_SPACING_METERS} meters.`;
	}
	if (
		perimeterRequest.pose.forward !== frame.perimeterForward ||
		perimeterRequest.pose.side !== frame.perimeterSide ||
		(perimeterRequest.pose.flow ?? "forward") !== "forward"
	) {
		return "Production Bank parent gateway parent perimeter pose does not match the Bank repetition axis.";
	}

	const collectorDelta = subtractCells(collectorRequest.anchor, perimeterRequest.anchor);
	if (
		project(collectorDelta, frame.alongVector) !==
		PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_SETBACK_METERS
	) {
		return `Production Bank parent gateway collector origin must be ${PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_SETBACK_METERS} meters from the parent near face.`;
	}
	if (
		collectorRequest.lengthMeters <
		PRODUCTION_BANK_PARENT_GATEWAY_JUNCTION_STATION_METERS +
			PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS
	) {
		return `Production Bank parent gateway collector needs at least ${PRODUCTION_BANK_PARENT_GATEWAY_JUNCTION_STATION_METERS + PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS} meters for its junction and support station.`;
	}

	const controls = gatewayControlCells(collectorRequest, perimeterRequest, frame);
	if (!Object.values(controls).every(isInt32Cell)) {
		return "Production Bank parent gateway footprint exceeds signed-int32 coordinate bounds.";
	}
	const geometry = materializeGatewayGeometry(controls);
	const collector = planPairedRailCorridor(collectorRequest);
	const parentPerimeter = planPairedRailPerimeter(perimeterRequest);
	const supportError = supportReuseError(collector, parentPerimeter, geometry);
	if (supportError) return supportError;
	const ownershipError = ownershipGeometryError(collector, parentPerimeter, geometry);
	if (ownershipError) return ownershipError;
	return null;
}

export function planProductionBankParentGateway(
	request: ProductionBankParentGatewayRequest,
): ProductionBankParentGatewayPlan {
	const error = validateProductionBankParentGatewayRequest(request);
	if (error) throw new RangeError(error);

	const collector = planPairedRailCorridor(request.collector);
	const parentPerimeter = planPairedRailPerimeter(request.parentPerimeter);
	const frame = frameForAxis(request.bankRepetitionAxis);
	const controls = gatewayControlCells(
		collector.specification,
		parentPerimeter.specification,
		frame,
	);
	const geometry = materializeGatewayGeometry(controls);
	const outbound = freezeConnection({
		id: "outbound",
		owner: PRODUCTION_BANK_PARENT_GATEWAY_OWNER,
		sourceRole: "BANK_COLLECTOR_PRIMARY",
		targetRole: "FAB_INNER_PERIMETER",
		sourceGatewayRole: "branch",
		targetGatewayRole: "merge",
		sourceTravelDirection: oppositeDirection(frame.along),
		targetTravelDirection: frame.parentForward,
		branchCell: controls.bankPrimaryBranch,
		mergeCell: controls.parentMerge,
		planningRoute: geometry.outboundPlanningRoute,
		ownedEdgeRoute: geometry.outboundOwnedRoute,
		ownedDirectedEdges: directedEdges(geometry.outboundOwnedRoute),
		reusedSourceSupportRoute: geometry.outboundSourceSupportRoute,
		reusedSourceSupportDirectedEdges: directedEdges(geometry.outboundSourceSupportRoute),
		reusedTargetSupportRoute: geometry.outboundTargetSupportRoute,
		reusedTargetSupportDirectedEdges: directedEdges(geometry.outboundTargetSupportRoute),
	});
	const returnConnection = freezeConnection({
		id: "return",
		owner: PRODUCTION_BANK_PARENT_GATEWAY_OWNER,
		sourceRole: "FAB_INNER_PERIMETER",
		targetRole: "BANK_COLLECTOR_SECONDARY",
		sourceGatewayRole: "branch",
		targetGatewayRole: "merge",
		sourceTravelDirection: frame.parentForward,
		targetTravelDirection: frame.along,
		branchCell: controls.parentBranch,
		mergeCell: controls.bankSecondaryMerge,
		planningRoute: geometry.returnPlanningRoute,
		ownedEdgeRoute: geometry.returnOwnedRoute,
		ownedDirectedEdges: directedEdges(geometry.returnOwnedRoute),
		reusedSourceSupportRoute: geometry.returnSourceSupportRoute,
		reusedSourceSupportDirectedEdges: directedEdges(geometry.returnSourceSupportRoute),
		reusedTargetSupportRoute: geometry.returnTargetSupportRoute,
		reusedTargetSupportDirectedEdges: directedEdges(geometry.returnTargetSupportRoute),
	});
	const connections = Object.freeze([outbound, returnConnection] satisfies readonly [
		ProductionBankParentGatewayConnection,
		ProductionBankParentGatewayConnection,
	]);
	const buildSteps = Object.freeze([
		freezeBuildStep(outbound, "bank-to-fab-stem"),
		freezeBuildStep(returnConnection, "fab-to-bank-stem"),
	] satisfies readonly [
		ProductionBankParentGatewayBuildStep,
		ProductionBankParentGatewayBuildStep,
	]);
	const buildRoutes = Object.freeze([
		outbound.planningRoute,
		returnConnection.planningRoute,
	] satisfies readonly [readonly Cell[], readonly Cell[]]);
	const ownedDirectedEdges = Object.freeze(
		connections.flatMap((connection) => connection.ownedDirectedEdges),
	);
	const ownershipIntent = Object.freeze({
		owner: PRODUCTION_BANK_PARENT_GATEWAY_OWNER,
		scope: "ADDED_DIRECTED_EDGES_ONLY" as const,
		directedEdges: ownedDirectedEdges,
	});
	const reusedSupportEdges = connections.reduce(
		(sum, connection) =>
			sum +
			connection.reusedSourceSupportDirectedEdges.length +
			connection.reusedTargetSupportDirectedEdges.length,
		0,
	);
	if (ownedDirectedEdges.length !== PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES) {
		throw new Error(
			"Production Bank parent gateway owned-edge count is not the fixed 72-edge contract.",
		);
	}
	if (reusedSupportEdges !== PRODUCTION_BANK_PARENT_GATEWAY_REUSED_SUPPORT_EDGES) {
		throw new Error(
			"Production Bank parent gateway support count is not the fixed 32-edge contract.",
		);
	}
	const occupiedCells = uniqueCells(buildRoutes);
	const specification = Object.freeze({
		version: PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
		topologyPolicy: PRODUCTION_BANK_PARENT_GATEWAY_TOPOLOGY_POLICY,
		bankRepetitionAxis: request.bankRepetitionAxis,
		collector: collector.specification,
		collectorPlanFingerprint: collector.fingerprint,
		parentPerimeter: parentPerimeter.specification,
		parentPerimeterPlanFingerprint: parentPerimeter.fingerprint,
		collectorBranchLaneId: "primary" as const,
		collectorMergeLaneId: "secondary" as const,
		parentLaneId: "inner" as const,
		collectorLaneSpacingMeters: PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS,
		parentLaneSpacingMeters: PRODUCTION_BANK_PARENT_GATEWAY_PARENT_LANE_SPACING_METERS,
		collectorSetbackMeters: PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_SETBACK_METERS,
		junctionStationMeters: PRODUCTION_BANK_PARENT_GATEWAY_JUNCTION_STATION_METERS,
		supportMeters: PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
		serviceBandMeters: PRODUCTION_BANK_PARENT_GATEWAY_SERVICE_BAND_METERS,
		parentJunctionSpacingMeters: PRODUCTION_BANK_PARENT_GATEWAY_PARENT_JUNCTION_SPACING_METERS,
	}) satisfies ProductionBankParentGatewaySpecification;
	const planWithoutFingerprint = Object.freeze({
		kind: "production-bank-parent-gateway" as const,
		geometryValid: true as const,
		placementReady: false as const,
		reason:
			"Production Bank parent gateway geometry and BANK edge intent are complete; whole-composition topology, physical, clearance, and ownership certification remain required.",
		specification,
		collector,
		parentPerimeter,
		connections,
		buildSteps,
		buildRoutes,
		ownershipIntent,
		occupiedCells,
		cells: occupiedCells,
		bounds: boundsForCells(occupiedCells),
		newEdges: PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES,
		lengthMeters: PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES,
		reusedSupportEdges: PRODUCTION_BANK_PARENT_GATEWAY_REUSED_SUPPORT_EDGES,
	});
	return Object.freeze({
		...planWithoutFingerprint,
		fingerprint: checksumPlan(planWithoutFingerprint),
	});
}

export function productionBankParentGatewayFingerprint(
	request: ProductionBankParentGatewayRequest,
): string {
	return planProductionBankParentGateway(request).fingerprint;
}

interface ProductionBankParentGatewayFrame {
	readonly along: Direction;
	readonly alongVector: Cell;
	readonly laneOffsetVector: Cell;
	readonly parentForward: Direction;
	readonly parentForwardVector: Cell;
	readonly perimeterForward: Direction;
	readonly perimeterSide: "left" | "right";
}

interface ProductionBankParentGatewayControlCells {
	readonly outboundSourceSupportStart: Cell;
	readonly bankPrimaryBranch: Cell;
	readonly outboundDogleg: Cell;
	readonly parentMerge: Cell;
	readonly outboundTargetSupportEnd: Cell;
	readonly returnSourceSupportStart: Cell;
	readonly parentBranch: Cell;
	readonly returnDogleg: Cell;
	readonly bankSecondaryMerge: Cell;
	readonly returnTargetSupportEnd: Cell;
}

interface ProductionBankParentGatewayGeometry {
	readonly outboundSourceSupportRoute: readonly Cell[];
	readonly outboundOwnedRoute: readonly Cell[];
	readonly outboundTargetSupportRoute: readonly Cell[];
	readonly outboundPlanningRoute: readonly Cell[];
	readonly returnSourceSupportRoute: readonly Cell[];
	readonly returnOwnedRoute: readonly Cell[];
	readonly returnTargetSupportRoute: readonly Cell[];
	readonly returnPlanningRoute: readonly Cell[];
}

function frameForAxis(
	axis: ProductionBankParentGatewayBankRepetitionAxis,
): ProductionBankParentGatewayFrame {
	return axis === "EAST_WEST"
		? Object.freeze({
				along: DIR_E,
				alongVector: Object.freeze({ x: 1, y: 0 }),
				laneOffsetVector: Object.freeze({ x: 0, y: 1 }),
				parentForward: DIR_S,
				parentForwardVector: Object.freeze({ x: 0, y: 1 }),
				perimeterForward: DIR_E,
				perimeterSide: "right" as const,
			})
		: Object.freeze({
				along: DIR_S,
				alongVector: Object.freeze({ x: 0, y: 1 }),
				laneOffsetVector: Object.freeze({ x: -1, y: 0 }),
				parentForward: DIR_E,
				parentForwardVector: Object.freeze({ x: 1, y: 0 }),
				perimeterForward: DIR_S,
				perimeterSide: "left" as const,
			});
}

function gatewayControlCells(
	collector: Pick<PairedRailCorridorRequest, "anchor">,
	parentPerimeter: Pick<PairedRailPerimeterRequest, "anchor" | "laneSpacingMeters">,
	frame: ProductionBankParentGatewayFrame,
): ProductionBankParentGatewayControlCells {
	const bankPrimaryBranch = offsetCell(
		collector.anchor,
		frame.alongVector,
		PRODUCTION_BANK_PARENT_GATEWAY_JUNCTION_STATION_METERS,
	);
	const bankSecondaryMerge = offsetCell(
		bankPrimaryBranch,
		frame.laneOffsetVector,
		PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS,
	);
	const outboundDogleg = offsetCell(
		bankPrimaryBranch,
		frame.laneOffsetVector,
		-PRODUCTION_BANK_PARENT_GATEWAY_SERVICE_BAND_METERS,
	);
	const returnDogleg = offsetCell(
		bankPrimaryBranch,
		frame.laneOffsetVector,
		PRODUCTION_BANK_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS +
			PRODUCTION_BANK_PARENT_GATEWAY_SERVICE_BAND_METERS,
	);
	const parentMerge = projectToParentNearFace(outboundDogleg, parentPerimeter, frame);
	const parentBranch = projectToParentNearFace(returnDogleg, parentPerimeter, frame);
	return Object.freeze({
		outboundSourceSupportStart: freezeCell(
			offsetCell(
				bankPrimaryBranch,
				frame.alongVector,
				PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
			),
		),
		bankPrimaryBranch: freezeCell(bankPrimaryBranch),
		outboundDogleg: freezeCell(outboundDogleg),
		parentMerge: freezeCell(parentMerge),
		outboundTargetSupportEnd: freezeCell(
			offsetCell(
				parentMerge,
				frame.parentForwardVector,
				PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
			),
		),
		returnSourceSupportStart: freezeCell(
			offsetCell(
				parentBranch,
				frame.parentForwardVector,
				-PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
			),
		),
		parentBranch: freezeCell(parentBranch),
		returnDogleg: freezeCell(returnDogleg),
		bankSecondaryMerge: freezeCell(bankSecondaryMerge),
		returnTargetSupportEnd: freezeCell(
			offsetCell(
				bankSecondaryMerge,
				frame.alongVector,
				PRODUCTION_BANK_PARENT_GATEWAY_SUPPORT_METERS,
			),
		),
	});
}

function projectToParentNearFace(
	cell: Cell,
	parentPerimeter: Pick<PairedRailPerimeterRequest, "anchor" | "laneSpacingMeters">,
	frame: ProductionBankParentGatewayFrame,
): Cell {
	return frame.along === DIR_E
		? {
				x: parentPerimeter.anchor.x + parentPerimeter.laneSpacingMeters,
				y: cell.y,
			}
		: {
				x: cell.x,
				y: parentPerimeter.anchor.y + parentPerimeter.laneSpacingMeters,
			};
}

function materializeGatewayGeometry(
	controls: ProductionBankParentGatewayControlCells,
): ProductionBankParentGatewayGeometry {
	const outboundSourceSupportRoute = materializeStraightRoute(
		controls.outboundSourceSupportStart,
		controls.bankPrimaryBranch,
	);
	const outboundOwnedRoute = materializePolyline([
		controls.bankPrimaryBranch,
		controls.outboundDogleg,
		controls.parentMerge,
	]);
	const outboundTargetSupportRoute = materializeStraightRoute(
		controls.parentMerge,
		controls.outboundTargetSupportEnd,
	);
	const returnSourceSupportRoute = materializeStraightRoute(
		controls.returnSourceSupportStart,
		controls.parentBranch,
	);
	const returnOwnedRoute = materializePolyline([
		controls.parentBranch,
		controls.returnDogleg,
		controls.bankSecondaryMerge,
	]);
	const returnTargetSupportRoute = materializeStraightRoute(
		controls.bankSecondaryMerge,
		controls.returnTargetSupportEnd,
	);
	return Object.freeze({
		outboundSourceSupportRoute,
		outboundOwnedRoute,
		outboundTargetSupportRoute,
		outboundPlanningRoute: joinRoutes(
			joinRoutes(outboundSourceSupportRoute, outboundOwnedRoute),
			outboundTargetSupportRoute,
		),
		returnSourceSupportRoute,
		returnOwnedRoute,
		returnTargetSupportRoute,
		returnPlanningRoute: joinRoutes(
			joinRoutes(returnSourceSupportRoute, returnOwnedRoute),
			returnTargetSupportRoute,
		),
	});
}

function supportReuseError(
	collector: PairedRailCorridorPlan,
	parentPerimeter: PairedRailPerimeterPlan,
	geometry: ProductionBankParentGatewayGeometry,
): string | null {
	const primaryEdges = new Set(directedEdges(collector.lanes[0].cells).map(directedEdgeKey));
	const secondaryEdges = new Set(directedEdges(collector.lanes[1].cells).map(directedEdgeKey));
	const innerEdges = new Set(directedEdges(parentPerimeter.lanes[1].cells).map(directedEdgeKey));
	if (!routeEdgesBelongTo(geometry.outboundSourceSupportRoute, primaryEdges)) {
		return "Production Bank parent gateway outbound support does not match the collector primary lane.";
	}
	if (!routeEdgesBelongTo(geometry.outboundTargetSupportRoute, innerEdges)) {
		return "Production Bank parent gateway outbound support does not match the Fab inner perimeter lane.";
	}
	if (!routeEdgesBelongTo(geometry.returnSourceSupportRoute, innerEdges)) {
		return "Production Bank parent gateway return support does not match the Fab inner perimeter lane.";
	}
	if (!routeEdgesBelongTo(geometry.returnTargetSupportRoute, secondaryEdges)) {
		return "Production Bank parent gateway return support does not match the collector secondary lane.";
	}
	return null;
}

function ownershipGeometryError(
	collector: PairedRailCorridorPlan,
	parentPerimeter: PairedRailPerimeterPlan,
	geometry: ProductionBankParentGatewayGeometry,
): string | null {
	const owned = [
		...directedEdges(geometry.outboundOwnedRoute),
		...directedEdges(geometry.returnOwnedRoute),
	];
	if (owned.length !== PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES) {
		return `Production Bank parent gateway must author exactly ${PRODUCTION_BANK_PARENT_GATEWAY_NEW_EDGES} directed edges.`;
	}
	const ownedKeys = owned.map(directedEdgeKey);
	if (new Set(ownedKeys).size !== ownedKeys.length) {
		return "Production Bank parent gateway owned routes overlap each other.";
	}
	const existingKeys = new Set(
		[
			...collector.lanes.flatMap((lane) => directedEdges(lane.cells)),
			...parentPerimeter.lanes.flatMap((lane) => directedEdges(lane.cells)),
		].map(directedEdgeKey),
	);
	if (ownedKeys.some((key) => existingKeys.has(key))) {
		return "Production Bank parent gateway owned routes overlap existing parent geometry.";
	}
	return null;
}

function routeEdgesBelongTo(route: readonly Cell[], edges: ReadonlySet<string>): boolean {
	return directedEdges(route).every((edge) => edges.has(directedEdgeKey(edge)));
}

function freezeConnection(
	connection: ProductionBankParentGatewayConnection,
): ProductionBankParentGatewayConnection {
	return Object.freeze(connection);
}

function freezeBuildStep(
	connection: ProductionBankParentGatewayConnection,
	kind: ProductionBankParentGatewayBuildStepKind,
): ProductionBankParentGatewayBuildStep {
	return Object.freeze({
		id: connection.id,
		owner: connection.owner,
		kind,
		route: connection.planningRoute,
		ownedDirectedEdges: connection.ownedDirectedEdges,
	});
}

function materializeStraightRoute(start: Cell, end: Cell): readonly Cell[] {
	const direction = directionBetweenCardinalCells(start, end);
	const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	const vector = directionVector(direction);
	return Object.freeze(
		Array.from({ length: distance + 1 }, (_, index) =>
			freezeCell({ x: start.x + vector.x * index, y: start.y + vector.y * index }),
		),
	);
}

function materializePolyline(controls: readonly Cell[]): readonly Cell[] {
	if (controls.length < 2) {
		throw new Error("Production Bank parent gateway polyline needs at least two controls.");
	}
	let route: readonly Cell[] = Object.freeze([freezeCell(controls[0] as Cell)]);
	for (let index = 1; index < controls.length; index += 1) {
		const start = controls[index - 1] as Cell;
		const end = controls[index] as Cell;
		if (start.x === end.x && start.y === end.y) continue;
		route = joinRoutes(route, materializeStraightRoute(start, end));
	}
	if (route.length < 2) {
		throw new Error("Production Bank parent gateway polyline cannot collapse to one cell.");
	}
	return route;
}

function joinRoutes(first: readonly Cell[], second: readonly Cell[]): readonly Cell[] {
	const firstEnd = first.at(-1);
	const secondStart = second[0];
	if (!firstEnd || !secondStart || !sameCell(firstEnd, secondStart)) {
		throw new Error("Production Bank parent gateway route controls are not contiguous.");
	}
	return Object.freeze([...first, ...second.slice(1)]);
}

function directedEdges(route: readonly Cell[]): readonly ProductionBankParentGatewayDirectedEdge[] {
	return Object.freeze(
		route.slice(0, -1).map((from, index) =>
			Object.freeze({
				from: freezeCell(from),
				to: freezeCell(route[index + 1] as Cell),
			}),
		),
	);
}

function uniqueCells(routes: readonly (readonly Cell[])[]): readonly Cell[] {
	const unique = new Map<string, Cell>();
	for (const route of routes) {
		for (const cell of route) {
			const key = `${cell.x},${cell.y}`;
			if (!unique.has(key)) unique.set(key, cell);
		}
	}
	return Object.freeze([...unique.values()]);
}

function boundsForCells(cells: readonly Cell[]): ProductionBankParentGatewayBounds {
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

function checksumPlan(plan: Omit<ProductionBankParentGatewayPlan, "fingerprint">): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"PRODUCTION_BANK_PARENT_GATEWAY",
		plan.kind,
		plan.specification.topologyPolicy,
		plan.specification.bankRepetitionAxis,
		plan.specification.collectorPlanFingerprint,
		plan.specification.parentPerimeterPlanFingerprint,
		plan.specification.collectorBranchLaneId,
		plan.specification.collectorMergeLaneId,
		plan.specification.parentLaneId,
		plan.ownershipIntent.owner,
		plan.ownershipIntent.scope,
	]);
	checksum.addNumbers([
		plan.specification.version,
		plan.specification.collectorLaneSpacingMeters,
		plan.specification.parentLaneSpacingMeters,
		plan.specification.collectorSetbackMeters,
		plan.specification.junctionStationMeters,
		plan.specification.supportMeters,
		plan.specification.serviceBandMeters,
		plan.specification.parentJunctionSpacingMeters,
		plan.newEdges,
		plan.lengthMeters,
		plan.reusedSupportEdges,
	]);
	for (const connection of plan.connections) {
		checksum.addStrings([
			connection.id,
			connection.owner,
			connection.sourceRole,
			connection.targetRole,
			connection.sourceGatewayRole,
			connection.targetGatewayRole,
		]);
		checksum.addNumbers([
			connection.sourceTravelDirection,
			connection.targetTravelDirection,
			connection.branchCell.x,
			connection.branchCell.y,
			connection.mergeCell.x,
			connection.mergeCell.y,
			connection.planningRoute.length,
			connection.ownedDirectedEdges.length,
			connection.reusedSourceSupportDirectedEdges.length,
			connection.reusedTargetSupportDirectedEdges.length,
		]);
		for (const cell of connection.planningRoute) checksum.addNumbers([cell.x, cell.y]);
		for (const edge of connection.ownedDirectedEdges) {
			checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		}
		for (const edge of connection.reusedSourceSupportDirectedEdges) {
			checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		}
		for (const edge of connection.reusedTargetSupportDirectedEdges) {
			checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		}
	}
	return checksum.digest();
}

function subtractCells(left: Cell, right: Cell): Cell {
	return { x: left.x - right.x, y: left.y - right.y };
}

function project(cell: Cell, vector: Cell): number {
	return cell.x * vector.x + cell.y * vector.y;
}

function offsetCell(origin: Cell, vector: Cell, distance: number): Cell {
	return { x: origin.x + vector.x * distance, y: origin.y + vector.y * distance };
}

function directionBetweenCardinalCells(start: Cell, end: Cell): Direction {
	const direct = directionBetween(start, end);
	if (direct !== null) return direct;
	if (start.x !== end.x && start.y !== end.y) {
		throw new Error("Production Bank parent gateway segments must remain cardinal.");
	}
	if (sameCell(start, end)) {
		throw new Error("Production Bank parent gateway segments must have positive length.");
	}
	if (start.x === end.x) return end.y > start.y ? DIR_S : DIR_N;
	return end.x > start.x ? DIR_E : DIR_W;
}

function directionVector(direction: Direction): Cell {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function directedEdgeKey(edge: ProductionBankParentGatewayDirectedEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function isBankRepetitionAxis(
	value: unknown,
): value is ProductionBankParentGatewayBankRepetitionAxis {
	return PRODUCTION_BANK_PARENT_GATEWAY_BANK_REPETITION_AXES.includes(
		value as ProductionBankParentGatewayBankRepetitionAxis,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasOnlyKnownKeys(
	value: Readonly<Record<string, unknown>>,
	keys: readonly string[],
): boolean {
	const known = new Set(keys);
	return Object.keys(value).every((key) => known.has(key));
}

function isInt32Cell(value: Cell): boolean {
	return isInt32(value.x) && isInt32(value.y);
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647;
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
