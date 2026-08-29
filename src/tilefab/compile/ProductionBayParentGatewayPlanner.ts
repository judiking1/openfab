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
	type ProductionBayModulePlan,
	type ProductionBayModuleRequest,
	type ProductionBayModuleSpecification,
	planProductionBayModule,
	validateProductionBayModuleRequest,
} from "../core/ProductionBayModulePlanner";
import { DIR_E, DIR_S, DIR_W, type Direction, oppositeDirection } from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION = 1 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_TOPOLOGY_POLICY =
	"staggered-service-band-two-stem-v1" as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_OWNER = "BANK" as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS = 2 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_BAY_SETBACK_METERS = 12 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS = 8 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS = 4 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_SLOT_INSET_METERS = 2 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_SINGLE_SHELL_DEPTH_METERS = 10 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS = 3 as const;
export const PRODUCTION_BAY_PARENT_GATEWAY_PROCESS_LOOP_PITCHES_METERS = Object.freeze([
	12, 14, 16,
] as const);

export const PRODUCTION_BAY_PARENT_GATEWAY_BANK_REPETITION_AXES = Object.freeze([
	"EAST_WEST",
	"NORTH_SOUTH",
] as const);

export type ProductionBayParentGatewayBankRepetitionAxis =
	(typeof PRODUCTION_BAY_PARENT_GATEWAY_BANK_REPETITION_AXES)[number];
export type ProductionBayParentGatewayConnectionId = "outbound" | "return";
export type ProductionBayParentGatewayBuildStepKind =
	| "collector-to-bay-stem"
	| "bay-to-collector-stem";

/**
 * Pure, serializable intent for attaching one closed Production Bay to its closed paired Bank
 * collector. Exact topology and physical certification remain whole-composition work.
 */
export interface ProductionBayParentGatewayRequest {
	readonly version: typeof PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION;
	readonly bankRepetitionAxis: ProductionBayParentGatewayBankRepetitionAxis;
	readonly processLoopCenterPitchMeters: 12 | 14 | 16;
	readonly collector: PairedRailCorridorRequest;
	readonly bay: ProductionBayModuleRequest;
}

export interface ProductionBayParentGatewaySpecification {
	readonly version: typeof PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION;
	readonly topologyPolicy: typeof PRODUCTION_BAY_PARENT_GATEWAY_TOPOLOGY_POLICY;
	readonly bankRepetitionAxis: ProductionBayParentGatewayBankRepetitionAxis;
	readonly processLoopCenterPitchMeters: 12 | 14 | 16;
	readonly collector: PairedRailCorridorSpecification;
	readonly collectorPlanFingerprint: string;
	readonly bay: ProductionBayModuleSpecification;
	readonly bayPlanFingerprint: string;
	readonly collectorNearLaneId: PairedRailCorridorLaneId;
	readonly collectorLaneSpacingMeters: typeof PRODUCTION_BAY_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS;
	readonly baySetbackMeters: typeof PRODUCTION_BAY_PARENT_GATEWAY_BAY_SETBACK_METERS;
	readonly shellSupportOverlapMeters: typeof PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS;
	readonly serviceBandMeters: typeof PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS;
	readonly slotInsetMeters: typeof PRODUCTION_BAY_PARENT_GATEWAY_SLOT_INSET_METERS;
	readonly minimumCollectorEndClearanceMeters: typeof PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS;
}

export interface ProductionBayParentGatewayDirectedEdge {
	readonly from: Cell;
	readonly to: Cell;
}

export interface ProductionBayParentGatewayConnection {
	readonly id: ProductionBayParentGatewayConnectionId;
	readonly owner: typeof PRODUCTION_BAY_PARENT_GATEWAY_OWNER;
	readonly sourceRole: "BANK_COLLECTOR" | "BAY_SHELL";
	readonly targetRole: "BAY_SHELL" | "BANK_COLLECTOR";
	readonly sourceGatewayRole: "branch";
	readonly targetGatewayRole: "merge";
	readonly travelDirection: Direction;
	readonly branchCell: Cell;
	readonly mergeCell: Cell;
	/** Full route submitted to planRailRouteBatch, including the existing Bay support seam. */
	readonly planningRoute: readonly Cell[];
	/** Only these previously absent edges receive BANK ownership. */
	readonly ownedEdgeRoute: readonly Cell[];
	readonly ownedDirectedEdges: readonly ProductionBayParentGatewayDirectedEdge[];
	/** Existing same-direction Bay-shell seam reused to give the tangent junction legal support. */
	readonly reusedBaySupportRoute: readonly Cell[];
	readonly reusedBaySupportDirectedEdges: readonly ProductionBayParentGatewayDirectedEdge[];
}

export interface ProductionBayParentGatewayBuildStep {
	readonly id: ProductionBayParentGatewayConnectionId;
	readonly owner: typeof PRODUCTION_BAY_PARENT_GATEWAY_OWNER;
	readonly kind: ProductionBayParentGatewayBuildStepKind;
	readonly route: readonly Cell[];
	readonly ownedDirectedEdges: readonly ProductionBayParentGatewayDirectedEdge[];
}

export interface ProductionBayParentGatewayOwnershipIntent {
	readonly owner: typeof PRODUCTION_BAY_PARENT_GATEWAY_OWNER;
	readonly scope: "ADDED_DIRECTED_EDGES_ONLY";
	readonly directedEdges: readonly ProductionBayParentGatewayDirectedEdge[];
}

export interface ProductionBayParentGatewayBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface ProductionBayParentGatewayPlan {
	readonly kind: "production-bay-parent-gateway";
	readonly geometryValid: true;
	readonly placementReady: false;
	readonly reason: string;
	readonly specification: ProductionBayParentGatewaySpecification;
	readonly collector: PairedRailCorridorPlan;
	readonly bay: ProductionBayModulePlan;
	readonly connections: readonly [
		ProductionBayParentGatewayConnection,
		ProductionBayParentGatewayConnection,
	];
	readonly buildSteps: readonly [
		ProductionBayParentGatewayBuildStep,
		ProductionBayParentGatewayBuildStep,
	];
	readonly buildRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly ownershipIntent: ProductionBayParentGatewayOwnershipIntent;
	readonly occupiedCells: readonly Cell[];
	readonly cells: readonly Cell[];
	readonly bounds: ProductionBayParentGatewayBounds;
	readonly newEdges: number;
	readonly lengthMeters: number;
	readonly reusedBaySupportEdges: number;
	readonly fingerprint: string;
}

const REQUEST_KEYS = Object.freeze([
	"version",
	"bankRepetitionAxis",
	"processLoopCenterPitchMeters",
	"collector",
	"bay",
] as const);

export function validateProductionBayParentGatewayRequest(input: unknown): string | null {
	if (!isRecord(input)) return "Production Bay parent gateway request must be an object.";
	if (!hasOnlyKnownKeys(input, REQUEST_KEYS)) {
		return "Production Bay parent gateway fields do not match the version 1 contract.";
	}
	if (input.version !== PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION) {
		return `Production Bay parent gateway version must be ${PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION}.`;
	}
	if (!isBankRepetitionAxis(input.bankRepetitionAxis)) {
		return 'Production Bay parent gateway Bank repetition axis must be "EAST_WEST" or "NORTH_SOUTH".';
	}
	if (
		!PRODUCTION_BAY_PARENT_GATEWAY_PROCESS_LOOP_PITCHES_METERS.includes(
			input.processLoopCenterPitchMeters as 12 | 14 | 16,
		)
	) {
		return "Production Bay parent gateway Process Loop center pitch must be 12, 14, or 16 meters.";
	}
	const collectorError = validatePairedRailCorridorRequest(input.collector);
	if (collectorError)
		return `Production Bay parent gateway collector is invalid: ${collectorError}`;
	const bayError = validateProductionBayModuleRequest(input.bay);
	if (bayError) return `Production Bay parent gateway Bay is invalid: ${bayError}`;

	const collectorRequest = input.collector as PairedRailCorridorRequest;
	const bayRequest = input.bay as ProductionBayModuleRequest;
	const processLoopCenterPitchMeters = input.processLoopCenterPitchMeters as 12 | 14 | 16;
	const processLoopCount = bayRequest.processLoopCount ?? 2;
	const frame = frameForAxis(input.bankRepetitionAxis);
	if (
		collectorRequest.laneSpacingMeters !==
		PRODUCTION_BAY_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS
	) {
		return `Production Bay parent gateway collector lane spacing must be ${PRODUCTION_BAY_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS} meters.`;
	}
	if (collectorRequest.pose.forward !== frame.along) {
		return "Production Bay parent gateway collector direction does not match the Bank repetition axis.";
	}
	if (collectorRequest.pose.side !== "right") {
		return 'Production Bay parent gateway collector near lane must use pose side "right".';
	}
	if ((collectorRequest.pose.flow ?? "forward") !== "reverse") {
		return 'Production Bay parent gateway collector must use pose flow "reverse" so its near lane follows the Bank repetition direction.';
	}
	if (bayRequest.pose.forward !== frame.away) {
		return "Production Bay parent gateway Bay long axis must point away from the collector.";
	}
	if (bayRequest.pose.side !== "left") {
		return 'Production Bay parent gateway Bay must use pose side "left" so its shell depth follows the Bank repetition direction.';
	}
	if ((bayRequest.pose.flow ?? "forward") !== "forward") {
		return 'Production Bay parent gateway Bay must use pose flow "forward" for the outbound/return stem policy.';
	}
	if (bayRequest.outerLengthMeters <= PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS) {
		return `Production Bay parent gateway Bay outer length must exceed the ${PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS} meter shell support overlap.`;
	}
	const expectedOuterDepthMeters =
		(processLoopCount - 1) * processLoopCenterPitchMeters +
		PRODUCTION_BAY_PARENT_GATEWAY_SINGLE_SHELL_DEPTH_METERS;
	if (bayRequest.outerDepthMeters !== expectedOuterDepthMeters) {
		return `Production Bay parent gateway Bay outer depth must be ${expectedOuterDepthMeters} meters for ${processLoopCount} Process Loop(s) at ${processLoopCenterPitchMeters} m pitch.`;
	}
	if (processLoopCount === 2) {
		const processLoopDepthMeters =
			(bayRequest.outerDepthMeters -
				bayRequest.shellMarginMeters * 2 -
				bayRequest.processLoopGapMeters) /
			2;
		const actualCenterPitchMeters = processLoopDepthMeters + bayRequest.processLoopGapMeters;
		if (actualCenterPitchMeters !== processLoopCenterPitchMeters) {
			return `Production Bay parent gateway Twin Bay Process Loop centers must be ${processLoopCenterPitchMeters} meters apart; the Bay geometry produces ${actualCenterPitchMeters} meters.`;
		}
	}

	const delta = subtractCells(bayRequest.anchor, collectorRequest.anchor);
	const alongOffset = project(delta, frame.alongVector);
	const awayOffset = project(delta, frame.awayVector);
	if (awayOffset !== PRODUCTION_BAY_PARENT_GATEWAY_BAY_SETBACK_METERS) {
		return `Production Bay parent gateway Bay anchor must be ${PRODUCTION_BAY_PARENT_GATEWAY_BAY_SETBACK_METERS} meters from the collector primary lane.`;
	}
	if (alongOffset < PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS) {
		return `Production Bay parent gateway first stem needs ${PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS} meters of collector end clearance.`;
	}
	const allocationSpanMeters = processLoopCount * processLoopCenterPitchMeters;
	if (
		alongOffset + allocationSpanMeters - PRODUCTION_BAY_PARENT_GATEWAY_SLOT_INSET_METERS >
		collectorRequest.lengthMeters -
			PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS
	) {
		return `Production Bay parent gateway return stem needs ${PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS} meters of collector end clearance.`;
	}

	const gatewayCells = gatewayControlCells(bayRequest, processLoopCenterPitchMeters, frame);
	if (!Object.values(gatewayCells).every(isInt32Cell)) {
		return "Production Bay parent gateway footprint exceeds signed-int32 coordinate bounds.";
	}
	return null;
}

export function planProductionBayParentGateway(
	request: ProductionBayParentGatewayRequest,
): ProductionBayParentGatewayPlan {
	const error = validateProductionBayParentGatewayRequest(request);
	if (error) throw new RangeError(error);

	const collector = planPairedRailCorridor(request.collector);
	const bay = planProductionBayModule(request.bay);
	const frame = frameForAxis(request.bankRepetitionAxis);
	const controls = gatewayControlCells(
		bay.specification,
		request.processLoopCenterPitchMeters,
		frame,
	);
	const outboundOwnedRoute = materializePolyline([
		controls.outboundCollectorCell,
		controls.outboundDoglegCell,
		controls.outboundBayApproachCell,
		controls.outboundBayBoundaryCell,
	]);
	const outboundSupportRoute = materializeStraightRoute(
		controls.outboundBayBoundaryCell,
		controls.outboundSupportCell,
	);
	const outboundPlanningRoute = joinRoutes(outboundOwnedRoute, outboundSupportRoute);
	const returnOwnedRoute = materializePolyline([
		controls.returnBayBoundaryCell,
		controls.returnBayApproachCell,
		controls.returnDoglegCell,
		controls.returnCollectorCell,
	]);
	const returnSupportRoute = materializeStraightRoute(
		controls.returnSupportCell,
		controls.returnBayBoundaryCell,
	);
	const returnPlanningRoute = joinRoutes(returnSupportRoute, returnOwnedRoute);

	const outbound = freezeConnection({
		id: "outbound",
		owner: PRODUCTION_BAY_PARENT_GATEWAY_OWNER,
		sourceRole: "BANK_COLLECTOR",
		targetRole: "BAY_SHELL",
		sourceGatewayRole: "branch",
		targetGatewayRole: "merge",
		travelDirection: frame.away,
		branchCell: controls.outboundCollectorCell,
		mergeCell: controls.outboundBayBoundaryCell,
		planningRoute: outboundPlanningRoute,
		ownedEdgeRoute: outboundOwnedRoute,
		ownedDirectedEdges: directedEdges(outboundOwnedRoute),
		reusedBaySupportRoute: outboundSupportRoute,
		reusedBaySupportDirectedEdges: directedEdges(outboundSupportRoute),
	});
	const returnConnection = freezeConnection({
		id: "return",
		owner: PRODUCTION_BAY_PARENT_GATEWAY_OWNER,
		sourceRole: "BAY_SHELL",
		targetRole: "BANK_COLLECTOR",
		sourceGatewayRole: "branch",
		targetGatewayRole: "merge",
		travelDirection: oppositeCardinal(frame.away),
		branchCell: controls.returnBayBoundaryCell,
		mergeCell: controls.returnCollectorCell,
		planningRoute: returnPlanningRoute,
		ownedEdgeRoute: returnOwnedRoute,
		ownedDirectedEdges: directedEdges(returnOwnedRoute),
		reusedBaySupportRoute: returnSupportRoute,
		reusedBaySupportDirectedEdges: directedEdges(returnSupportRoute),
	});
	validateSupportReuse(bay, outbound);
	validateSupportReuse(bay, returnConnection);

	const connections = Object.freeze([outbound, returnConnection] satisfies readonly [
		ProductionBayParentGatewayConnection,
		ProductionBayParentGatewayConnection,
	]);
	const buildSteps = Object.freeze([
		freezeBuildStep(outbound, "collector-to-bay-stem"),
		freezeBuildStep(returnConnection, "bay-to-collector-stem"),
	] satisfies readonly [ProductionBayParentGatewayBuildStep, ProductionBayParentGatewayBuildStep]);
	const buildRoutes = Object.freeze([
		outbound.planningRoute,
		returnConnection.planningRoute,
	] satisfies readonly [readonly Cell[], readonly Cell[]]);
	const ownedDirectedEdges = Object.freeze(
		connections.flatMap((connection) => connection.ownedDirectedEdges),
	);
	const ownershipIntent = Object.freeze({
		owner: PRODUCTION_BAY_PARENT_GATEWAY_OWNER,
		scope: "ADDED_DIRECTED_EDGES_ONLY" as const,
		directedEdges: ownedDirectedEdges,
	});
	const occupiedCells = uniqueCells(buildRoutes);
	const reusedBaySupportEdges = connections.reduce(
		(sum, connection) => sum + connection.reusedBaySupportDirectedEdges.length,
		0,
	);
	const specification = Object.freeze({
		version: PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION,
		topologyPolicy: PRODUCTION_BAY_PARENT_GATEWAY_TOPOLOGY_POLICY,
		bankRepetitionAxis: request.bankRepetitionAxis,
		processLoopCenterPitchMeters: request.processLoopCenterPitchMeters,
		collector: collector.specification,
		collectorPlanFingerprint: collector.fingerprint,
		bay: bay.specification,
		bayPlanFingerprint: bay.fingerprint,
		collectorNearLaneId: "secondary" as const,
		collectorLaneSpacingMeters: PRODUCTION_BAY_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS,
		baySetbackMeters: PRODUCTION_BAY_PARENT_GATEWAY_BAY_SETBACK_METERS,
		shellSupportOverlapMeters: PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS,
		serviceBandMeters: PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS,
		slotInsetMeters: PRODUCTION_BAY_PARENT_GATEWAY_SLOT_INSET_METERS,
		minimumCollectorEndClearanceMeters:
			PRODUCTION_BAY_PARENT_GATEWAY_MINIMUM_COLLECTOR_END_CLEARANCE_METERS,
	}) satisfies ProductionBayParentGatewaySpecification;
	const planWithoutFingerprint = Object.freeze({
		kind: "production-bay-parent-gateway" as const,
		geometryValid: true as const,
		placementReady: false as const,
		reason:
			"Production Bay parent gateway geometry and BANK edge intent are complete; whole-composition topology, physical, clearance, and ownership certification remain required.",
		specification,
		collector,
		bay,
		connections,
		buildSteps,
		buildRoutes,
		ownershipIntent,
		occupiedCells,
		cells: occupiedCells,
		bounds: boundsForCells(occupiedCells),
		newEdges: ownedDirectedEdges.length,
		lengthMeters: ownedDirectedEdges.length,
		reusedBaySupportEdges,
	});
	return Object.freeze({
		...planWithoutFingerprint,
		fingerprint: checksumPlan(planWithoutFingerprint),
	});
}

export function productionBayParentGatewayFingerprint(
	request: ProductionBayParentGatewayRequest,
): string {
	return planProductionBayParentGateway(request).fingerprint;
}

interface ProductionBayParentGatewayFrame {
	readonly along: Direction;
	readonly away: Direction;
	readonly alongVector: Cell;
	readonly awayVector: Cell;
}

interface ProductionBayParentGatewayControlCells {
	readonly outboundCollectorCell: Cell;
	readonly outboundDoglegCell: Cell;
	readonly outboundBayApproachCell: Cell;
	readonly outboundBayBoundaryCell: Cell;
	readonly outboundSupportCell: Cell;
	readonly returnSupportCell: Cell;
	readonly returnBayBoundaryCell: Cell;
	readonly returnBayApproachCell: Cell;
	readonly returnDoglegCell: Cell;
	readonly returnCollectorCell: Cell;
}

function frameForAxis(
	axis: ProductionBayParentGatewayBankRepetitionAxis,
): ProductionBayParentGatewayFrame {
	return axis === "EAST_WEST"
		? Object.freeze({
				along: DIR_E,
				away: DIR_S,
				alongVector: Object.freeze({ x: 1, y: 0 }),
				awayVector: Object.freeze({ x: 0, y: 1 }),
			})
		: Object.freeze({
				along: DIR_S,
				away: DIR_W,
				alongVector: Object.freeze({ x: 0, y: 1 }),
				awayVector: Object.freeze({ x: -1, y: 0 }),
			});
}

function gatewayControlCells(
	bay: Pick<ProductionBayModuleRequest, "anchor" | "outerDepthMeters" | "processLoopCount">,
	processLoopCenterPitchMeters: 12 | 14 | 16,
	frame: ProductionBayParentGatewayFrame,
): ProductionBayParentGatewayControlCells {
	const nearLaneOffset =
		PRODUCTION_BAY_PARENT_GATEWAY_BAY_SETBACK_METERS -
		PRODUCTION_BAY_PARENT_GATEWAY_COLLECTOR_LANE_SPACING_METERS;
	const processLoopCount = bay.processLoopCount ?? 2;
	const outboundBayBoundaryCell = freezeCell(bay.anchor);
	const outboundStation = offsetCell(
		outboundBayBoundaryCell,
		frame.alongVector,
		PRODUCTION_BAY_PARENT_GATEWAY_SLOT_INSET_METERS,
	);
	const outboundCollectorCell = freezeCell(
		offsetCell(outboundStation, frame.awayVector, -nearLaneOffset),
	);
	const outboundDoglegCell = freezeCell(
		offsetCell(
			outboundStation,
			frame.awayVector,
			-PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS,
		),
	);
	const outboundBayApproachCell = freezeCell(
		offsetCell(
			outboundBayBoundaryCell,
			frame.awayVector,
			-PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS,
		),
	);
	const outboundSupportCell = freezeCell(
		offsetCell(
			outboundBayBoundaryCell,
			frame.awayVector,
			PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS,
		),
	);
	const returnBayBoundaryCell = freezeCell(
		offsetCell(outboundBayBoundaryCell, frame.alongVector, bay.outerDepthMeters),
	);
	const returnStation = offsetCell(
		outboundBayBoundaryCell,
		frame.alongVector,
		processLoopCount * processLoopCenterPitchMeters -
			PRODUCTION_BAY_PARENT_GATEWAY_SLOT_INSET_METERS,
	);
	const returnSupportCell = freezeCell(
		offsetCell(
			returnBayBoundaryCell,
			frame.awayVector,
			PRODUCTION_BAY_PARENT_GATEWAY_SHELL_SUPPORT_OVERLAP_METERS,
		),
	);
	const returnBayApproachCell = freezeCell(
		offsetCell(
			returnBayBoundaryCell,
			frame.awayVector,
			-PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS,
		),
	);
	const returnDoglegCell = freezeCell(
		offsetCell(returnStation, frame.awayVector, -PRODUCTION_BAY_PARENT_GATEWAY_SERVICE_BAND_METERS),
	);
	const returnCollectorCell = freezeCell(
		offsetCell(returnStation, frame.awayVector, -nearLaneOffset),
	);
	return Object.freeze({
		outboundCollectorCell,
		outboundDoglegCell,
		outboundBayApproachCell,
		outboundBayBoundaryCell,
		outboundSupportCell,
		returnSupportCell,
		returnBayBoundaryCell,
		returnBayApproachCell,
		returnDoglegCell,
		returnCollectorCell,
	});
}

function freezeConnection(
	connection: ProductionBayParentGatewayConnection,
): ProductionBayParentGatewayConnection {
	return Object.freeze(connection);
}

function freezeBuildStep(
	connection: ProductionBayParentGatewayConnection,
	kind: ProductionBayParentGatewayBuildStepKind,
): ProductionBayParentGatewayBuildStep {
	return Object.freeze({
		id: connection.id,
		owner: connection.owner,
		kind,
		route: connection.planningRoute,
		ownedDirectedEdges: connection.ownedDirectedEdges,
	});
}

function validateSupportReuse(
	bay: ProductionBayModulePlan,
	connection: ProductionBayParentGatewayConnection,
): void {
	const shellEdges = new Set(
		directedEdges(bay.outerLoop.cells).map((edge) => directedEdgeKey(edge)),
	);
	for (const edge of connection.reusedBaySupportDirectedEdges) {
		if (!shellEdges.has(directedEdgeKey(edge))) {
			throw new Error(
				`Production Bay parent gateway ${connection.id} support seam does not match the Bay shell.`,
			);
		}
	}
}

function materializeStraightRoute(start: Cell, end: Cell): readonly Cell[] {
	const deltaX = end.x - start.x;
	const deltaY = end.y - start.y;
	if ((deltaX === 0) === (deltaY === 0)) {
		throw new Error("Production Bay parent gateway routes must be non-zero cardinal lines.");
	}
	const distance = Math.abs(deltaX) + Math.abs(deltaY);
	const stepX = Math.sign(deltaX);
	const stepY = Math.sign(deltaY);
	return Object.freeze(
		Array.from({ length: distance + 1 }, (_, index) =>
			freezeCell({ x: start.x + stepX * index, y: start.y + stepY * index }),
		),
	);
}

function materializePolyline(controls: readonly Cell[]): readonly Cell[] {
	if (controls.length < 2) {
		throw new Error("Production Bay parent gateway polyline needs at least two controls.");
	}
	let route: readonly Cell[] = Object.freeze([freezeCell(controls[0] as Cell)]);
	for (let index = 1; index < controls.length; index += 1) {
		const start = controls[index - 1] as Cell;
		const end = controls[index] as Cell;
		if (start.x === end.x && start.y === end.y) continue;
		route = joinRoutes(route, materializeStraightRoute(start, end));
	}
	if (route.length < 2) {
		throw new Error("Production Bay parent gateway polyline cannot collapse to one cell.");
	}
	return route;
}

function joinRoutes(first: readonly Cell[], second: readonly Cell[]): readonly Cell[] {
	const firstEnd = first.at(-1);
	const secondStart = second[0];
	if (!firstEnd || !secondStart || firstEnd.x !== secondStart.x || firstEnd.y !== secondStart.y) {
		throw new Error("Production Bay parent gateway route controls are not contiguous.");
	}
	return Object.freeze([...first, ...second.slice(1)]);
}

function directedEdges(route: readonly Cell[]): readonly ProductionBayParentGatewayDirectedEdge[] {
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

function boundsForCells(cells: readonly Cell[]): ProductionBayParentGatewayBounds {
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

function checksumPlan(plan: Omit<ProductionBayParentGatewayPlan, "fingerprint">): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"PRODUCTION_BAY_PARENT_GATEWAY",
		plan.kind,
		plan.specification.topologyPolicy,
		plan.specification.bankRepetitionAxis,
		plan.specification.collectorPlanFingerprint,
		plan.specification.bayPlanFingerprint,
		plan.specification.collectorNearLaneId,
		plan.ownershipIntent.owner,
		plan.ownershipIntent.scope,
	]);
	checksum.addNumbers([
		plan.specification.version,
		plan.specification.processLoopCenterPitchMeters,
		plan.specification.collectorLaneSpacingMeters,
		plan.specification.baySetbackMeters,
		plan.specification.shellSupportOverlapMeters,
		plan.specification.serviceBandMeters,
		plan.specification.slotInsetMeters,
		PRODUCTION_BAY_PARENT_GATEWAY_SINGLE_SHELL_DEPTH_METERS,
		plan.specification.minimumCollectorEndClearanceMeters,
		plan.newEdges,
		plan.lengthMeters,
		plan.reusedBaySupportEdges,
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
			connection.travelDirection,
			connection.branchCell.x,
			connection.branchCell.y,
			connection.mergeCell.x,
			connection.mergeCell.y,
			connection.planningRoute.length,
			connection.ownedDirectedEdges.length,
			connection.reusedBaySupportDirectedEdges.length,
		]);
		for (const cell of connection.planningRoute) checksum.addNumbers([cell.x, cell.y]);
		for (const edge of connection.ownedDirectedEdges) {
			checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		}
		for (const edge of connection.reusedBaySupportDirectedEdges) {
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

function oppositeCardinal(direction: Direction): Direction {
	return oppositeDirection(direction);
}

function directedEdgeKey(edge: ProductionBayParentGatewayDirectedEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function isBankRepetitionAxis(
	value: unknown,
): value is ProductionBayParentGatewayBankRepetitionAxis {
	return PRODUCTION_BAY_PARENT_GATEWAY_BANK_REPETITION_AXES.includes(
		value as ProductionBayParentGatewayBankRepetitionAxis,
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
