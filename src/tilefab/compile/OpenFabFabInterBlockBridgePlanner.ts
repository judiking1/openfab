import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	PAIRED_RAIL_PERIMETER_PLAN_VERSION,
	type PairedRailPerimeterPlan,
	type PairedRailPerimeterRequest,
	type PairedRailPerimeterSpecification,
	planPairedRailPerimeter,
	validatePairedRailPerimeterRequest,
} from "../core/PairedRailPerimeterPlanner";
import { type Direction, directionBetween } from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION = 1 as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_TOPOLOGY_POLICY =
	"paired-outer-face-direct-bridge-v1" as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_OWNER = "FAB" as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS = 64 as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_STATION_METERS = 24 as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SEPARATION_METERS = 8 as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS = 8 as const;
export const OPENFAB_FAB_INTER_BLOCK_BRIDGE_PERIMETER_LANE_SPACING_METERS = 4 as const;

export type OpenFabFabInterBlockBridgeConnectionId = "left-to-right" | "right-to-left";
export type OpenFabFabInterBlockBridgeJunctionId =
	| "left-branch"
	| "right-merge"
	| "right-branch"
	| "left-merge";

export interface OpenFabFabInterBlockBridgeRequest {
	readonly version: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION;
	readonly ownerKey: string;
	readonly leftPerimeter: PairedRailPerimeterRequest;
	readonly rightPerimeter: PairedRailPerimeterRequest;
}

export interface OpenFabFabInterBlockBridgeSpecification {
	readonly version: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION;
	readonly topologyPolicy: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_TOPOLOGY_POLICY;
	readonly ownerKey: string;
	readonly leftPerimeter: PairedRailPerimeterSpecification;
	readonly leftPerimeterFingerprint: string;
	readonly rightPerimeter: PairedRailPerimeterSpecification;
	readonly rightPerimeterFingerprint: string;
	readonly gapMeters: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS;
	readonly stationMeters: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_STATION_METERS;
	readonly junctionSeparationMeters: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SEPARATION_METERS;
	readonly junctionSupportMeters: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS;
}

export interface OpenFabFabInterBlockBridgeDirectedEdge {
	readonly from: Cell;
	readonly to: Cell;
}

export interface OpenFabFabInterBlockBridgeJunction {
	readonly id: OpenFabFabInterBlockBridgeJunctionId;
	readonly block: "LEFT" | "RIGHT";
	readonly laneId: "outer";
	readonly role: "branch" | "merge";
	readonly cell: Cell;
	readonly travelDirection: Direction;
}

export interface OpenFabFabInterBlockBridgeConnection {
	readonly id: OpenFabFabInterBlockBridgeConnectionId;
	readonly owner: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_OWNER;
	readonly ownerKey: string;
	readonly sourceJunctionId: OpenFabFabInterBlockBridgeJunctionId;
	readonly targetJunctionId: OpenFabFabInterBlockBridgeJunctionId;
	readonly planningRoute: readonly Cell[];
	readonly ownedEdgeRoute: readonly Cell[];
	readonly ownedDirectedEdges: readonly OpenFabFabInterBlockBridgeDirectedEdge[];
	readonly reusedPerimeterSupportRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly reusedPerimeterSupportDirectedEdges: readonly OpenFabFabInterBlockBridgeDirectedEdge[];
}

export interface OpenFabFabInterBlockBridgeOwnershipIntent {
	readonly owner: typeof OPENFAB_FAB_INTER_BLOCK_BRIDGE_OWNER;
	readonly ownerKey: string;
	readonly scope: "ADDED_DIRECTED_EDGES_ONLY";
	readonly directedEdges: readonly OpenFabFabInterBlockBridgeDirectedEdge[];
}

export interface OpenFabFabInterBlockBridgeBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface OpenFabFabInterBlockBridgePlan {
	readonly kind: "openfab-fab-inter-block-bridge";
	readonly geometryValid: true;
	readonly placementReady: false;
	readonly reason: string;
	readonly specification: OpenFabFabInterBlockBridgeSpecification;
	readonly leftPerimeter: PairedRailPerimeterPlan;
	readonly rightPerimeter: PairedRailPerimeterPlan;
	readonly junctions: readonly [
		OpenFabFabInterBlockBridgeJunction,
		OpenFabFabInterBlockBridgeJunction,
		OpenFabFabInterBlockBridgeJunction,
		OpenFabFabInterBlockBridgeJunction,
	];
	readonly connections: readonly [
		OpenFabFabInterBlockBridgeConnection,
		OpenFabFabInterBlockBridgeConnection,
	];
	readonly buildRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly ownershipIntent: OpenFabFabInterBlockBridgeOwnershipIntent;
	readonly occupiedCells: readonly Cell[];
	readonly bounds: OpenFabFabInterBlockBridgeBounds;
	readonly newEdges: number;
	readonly lengthMeters: number;
	/** Per-connection support references; the two connections may reuse the same directed edge. */
	readonly reusedPerimeterSupportEdgeReferences: number;
	readonly uniqueReusedPerimeterSupportEdges: number;
	readonly fingerprint: string;
}

const REQUEST_KEYS = Object.freeze([
	"version",
	"ownerKey",
	"leftPerimeter",
	"rightPerimeter",
] as const);

export function validateOpenFabFabInterBlockBridgeRequest(input: unknown): string | null {
	if (!isRecord(input)) return "OpenFab inter-Block bridge request must be an object.";
	if (!hasOnlyKnownKeys(input, REQUEST_KEYS)) {
		return "OpenFab inter-Block bridge fields do not match the version 1 contract.";
	}
	if (input.version !== OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION) {
		return `OpenFab inter-Block bridge version must be ${OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION}.`;
	}
	if (!isStableKey(input.ownerKey)) {
		return "OpenFab inter-Block bridge owner key must be a non-empty stable key.";
	}
	if (
		!isRecord(input.leftPerimeter) ||
		input.leftPerimeter.version !== PAIRED_RAIL_PERIMETER_PLAN_VERSION
	) {
		return `OpenFab inter-Block bridge left perimeter version must be ${PAIRED_RAIL_PERIMETER_PLAN_VERSION}.`;
	}
	if (
		!isRecord(input.rightPerimeter) ||
		input.rightPerimeter.version !== PAIRED_RAIL_PERIMETER_PLAN_VERSION
	) {
		return `OpenFab inter-Block bridge right perimeter version must be ${PAIRED_RAIL_PERIMETER_PLAN_VERSION}.`;
	}
	const leftError = validatePairedRailPerimeterRequest(input.leftPerimeter);
	if (leftError) return `OpenFab inter-Block bridge left perimeter is invalid: ${leftError}`;
	const rightError = validatePairedRailPerimeterRequest(input.rightPerimeter);
	if (rightError) return `OpenFab inter-Block bridge right perimeter is invalid: ${rightError}`;

	const leftRequest = input.leftPerimeter as unknown as PairedRailPerimeterRequest;
	const rightRequest = input.rightPerimeter as unknown as PairedRailPerimeterRequest;
	if (
		leftRequest.laneSpacingMeters !==
			OPENFAB_FAB_INTER_BLOCK_BRIDGE_PERIMETER_LANE_SPACING_METERS ||
		rightRequest.laneSpacingMeters !== OPENFAB_FAB_INTER_BLOCK_BRIDGE_PERIMETER_LANE_SPACING_METERS
	) {
		return `OpenFab inter-Block bridge perimeters must use ${OPENFAB_FAB_INTER_BLOCK_BRIDGE_PERIMETER_LANE_SPACING_METERS} meter lane spacing.`;
	}
	if (!samePerimeterFrame(leftRequest, rightRequest)) {
		return "OpenFab inter-Block bridge perimeters must use the same dimensions and pose.";
	}

	const left = planPairedRailPerimeter(leftRequest);
	const right = planPairedRailPerimeter(rightRequest);
	if (left.bounds.minY !== right.bounds.minY || left.bounds.maxY !== right.bounds.maxY) {
		return "OpenFab inter-Block bridge perimeters must share one vertical envelope.";
	}
	if (right.bounds.minX - left.bounds.maxX !== OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS) {
		return `OpenFab inter-Block bridge perimeters must be separated by ${OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS} meters.`;
	}
	const controls = bridgeControlCells(left, right);
	if (!supportWindowExists(left, controls.leftX, controls.supportStartY, controls.supportEndY)) {
		return "OpenFab inter-Block bridge left outer face lacks the required straight support window.";
	}
	if (!supportWindowExists(right, controls.rightX, controls.supportStartY, controls.supportEndY)) {
		return "OpenFab inter-Block bridge right outer face lacks the required straight support window.";
	}
	return null;
}

export function planOpenFabFabInterBlockBridge(
	request: OpenFabFabInterBlockBridgeRequest,
): OpenFabFabInterBlockBridgePlan {
	const error = validateOpenFabFabInterBlockBridgeRequest(request);
	if (error) throw new RangeError(error);

	const leftPerimeter = planPairedRailPerimeter(request.leftPerimeter);
	const rightPerimeter = planPairedRailPerimeter(request.rightPerimeter);
	const controls = bridgeControlCells(leftPerimeter, rightPerimeter);
	const outboundOwnedRoute = materializeStraightRoute(controls.leftBranch, controls.rightMerge);
	const returnOwnedRoute = materializeStraightRoute(controls.rightBranch, controls.leftMerge);
	const outboundSourceSupport = outerLaneSegment(
		leftPerimeter,
		controls.leftBranch,
		OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
		0,
	);
	const outboundTargetSupport = outerLaneSegment(
		rightPerimeter,
		controls.rightMerge,
		0,
		OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
	);
	const returnSourceSupport = outerLaneSegment(
		rightPerimeter,
		controls.rightBranch,
		OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
		0,
	);
	const returnTargetSupport = outerLaneSegment(
		leftPerimeter,
		controls.leftMerge,
		0,
		OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
	);
	const outboundRoute = joinRoutes(
		outboundSourceSupport,
		outboundOwnedRoute,
		outboundTargetSupport,
	);
	const returnRoute = joinRoutes(returnSourceSupport, returnOwnedRoute, returnTargetSupport);
	const leftTravelDirection = travelDirectionAt(leftPerimeter, controls.leftBranch);
	const rightTravelDirection = travelDirectionAt(rightPerimeter, controls.rightMerge);

	const junctions = Object.freeze([
		freezeJunction({
			id: "left-branch",
			block: "LEFT",
			laneId: "outer",
			role: "branch",
			cell: controls.leftBranch,
			travelDirection: leftTravelDirection,
		}),
		freezeJunction({
			id: "right-merge",
			block: "RIGHT",
			laneId: "outer",
			role: "merge",
			cell: controls.rightMerge,
			travelDirection: rightTravelDirection,
		}),
		freezeJunction({
			id: "right-branch",
			block: "RIGHT",
			laneId: "outer",
			role: "branch",
			cell: controls.rightBranch,
			travelDirection: travelDirectionAt(rightPerimeter, controls.rightBranch),
		}),
		freezeJunction({
			id: "left-merge",
			block: "LEFT",
			laneId: "outer",
			role: "merge",
			cell: controls.leftMerge,
			travelDirection: travelDirectionAt(leftPerimeter, controls.leftMerge),
		}),
	] satisfies readonly [
		OpenFabFabInterBlockBridgeJunction,
		OpenFabFabInterBlockBridgeJunction,
		OpenFabFabInterBlockBridgeJunction,
		OpenFabFabInterBlockBridgeJunction,
	]);
	const leftToRight = freezeConnection({
		id: "left-to-right",
		owner: OPENFAB_FAB_INTER_BLOCK_BRIDGE_OWNER,
		ownerKey: request.ownerKey,
		sourceJunctionId: "left-branch",
		targetJunctionId: "right-merge",
		planningRoute: outboundRoute,
		ownedEdgeRoute: outboundOwnedRoute,
		ownedDirectedEdges: directedEdges(outboundOwnedRoute),
		reusedPerimeterSupportRoutes: Object.freeze([outboundSourceSupport, outboundTargetSupport]),
		reusedPerimeterSupportDirectedEdges: Object.freeze([
			...directedEdges(outboundSourceSupport),
			...directedEdges(outboundTargetSupport),
		]),
	});
	const rightToLeft = freezeConnection({
		id: "right-to-left",
		owner: OPENFAB_FAB_INTER_BLOCK_BRIDGE_OWNER,
		ownerKey: request.ownerKey,
		sourceJunctionId: "right-branch",
		targetJunctionId: "left-merge",
		planningRoute: returnRoute,
		ownedEdgeRoute: returnOwnedRoute,
		ownedDirectedEdges: directedEdges(returnOwnedRoute),
		reusedPerimeterSupportRoutes: Object.freeze([returnSourceSupport, returnTargetSupport]),
		reusedPerimeterSupportDirectedEdges: Object.freeze([
			...directedEdges(returnSourceSupport),
			...directedEdges(returnTargetSupport),
		]),
	});
	const connections = Object.freeze([leftToRight, rightToLeft] satisfies readonly [
		OpenFabFabInterBlockBridgeConnection,
		OpenFabFabInterBlockBridgeConnection,
	]);
	const ownedDirectedEdges = Object.freeze(
		connections.flatMap((connection) => connection.ownedDirectedEdges),
	);
	const specification = Object.freeze({
		version: OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION,
		topologyPolicy: OPENFAB_FAB_INTER_BLOCK_BRIDGE_TOPOLOGY_POLICY,
		ownerKey: request.ownerKey,
		leftPerimeter: leftPerimeter.specification,
		leftPerimeterFingerprint: leftPerimeter.fingerprint,
		rightPerimeter: rightPerimeter.specification,
		rightPerimeterFingerprint: rightPerimeter.fingerprint,
		gapMeters: OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS,
		stationMeters: OPENFAB_FAB_INTER_BLOCK_BRIDGE_STATION_METERS,
		junctionSeparationMeters: OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SEPARATION_METERS,
		junctionSupportMeters: OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
	}) satisfies OpenFabFabInterBlockBridgeSpecification;
	const buildRoutes = Object.freeze([outboundRoute, returnRoute] satisfies readonly [
		readonly Cell[],
		readonly Cell[],
	]);
	const occupiedCells = uniqueCells(buildRoutes);
	const withoutFingerprint = Object.freeze({
		kind: "openfab-fab-inter-block-bridge" as const,
		geometryValid: true as const,
		placementReady: false as const,
		reason:
			"Inter-Block paired bridge geometry and FAB edge intent are complete; whole-composition topology, physical, clearance, hierarchy, and ownership certification remain required.",
		specification,
		leftPerimeter,
		rightPerimeter,
		junctions,
		connections,
		buildRoutes,
		ownershipIntent: Object.freeze({
			owner: OPENFAB_FAB_INTER_BLOCK_BRIDGE_OWNER,
			ownerKey: request.ownerKey,
			scope: "ADDED_DIRECTED_EDGES_ONLY" as const,
			directedEdges: ownedDirectedEdges,
		}),
		occupiedCells,
		bounds: boundsForCells(occupiedCells),
		newEdges: ownedDirectedEdges.length,
		lengthMeters: ownedDirectedEdges.length,
		reusedPerimeterSupportEdgeReferences: connections.reduce(
			(sum, connection) => sum + connection.reusedPerimeterSupportDirectedEdges.length,
			0,
		),
		uniqueReusedPerimeterSupportEdges: new Set(
			connections.flatMap((connection) =>
				connection.reusedPerimeterSupportDirectedEdges.map(
					(edge) => `${cellKey(edge.from)}>${cellKey(edge.to)}`,
				),
			),
		).size,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabInterBlockBridgePlanFingerprint(withoutFingerprint),
	});
}

export function openFabFabInterBlockBridgeFingerprint(
	request: OpenFabFabInterBlockBridgeRequest,
): string {
	return planOpenFabFabInterBlockBridge(request).fingerprint;
}

interface BridgeControls {
	readonly leftX: number;
	readonly rightX: number;
	readonly supportStartY: number;
	readonly supportEndY: number;
	readonly leftBranch: Cell;
	readonly rightMerge: Cell;
	readonly rightBranch: Cell;
	readonly leftMerge: Cell;
}

function bridgeControlCells(
	left: PairedRailPerimeterPlan,
	right: PairedRailPerimeterPlan,
): BridgeControls {
	const leftX = left.bounds.maxX;
	const rightX = right.bounds.minX;
	const stationY = left.bounds.minY + OPENFAB_FAB_INTER_BLOCK_BRIDGE_STATION_METERS;
	return Object.freeze({
		leftX,
		rightX,
		supportStartY: stationY - OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
		supportEndY:
			stationY +
			OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SEPARATION_METERS +
			OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SUPPORT_METERS,
		leftBranch: freezeCell({ x: leftX, y: stationY }),
		rightMerge: freezeCell({ x: rightX, y: stationY }),
		rightBranch: freezeCell({
			x: rightX,
			y: stationY + OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SEPARATION_METERS,
		}),
		leftMerge: freezeCell({
			x: leftX,
			y: stationY + OPENFAB_FAB_INTER_BLOCK_BRIDGE_JUNCTION_SEPARATION_METERS,
		}),
	});
}

function supportWindowExists(
	perimeter: PairedRailPerimeterPlan,
	x: number,
	startY: number,
	endY: number,
): boolean {
	const cells = new Set(perimeter.lanes[0].cells.map(cellKey));
	for (let y = startY; y <= endY; y++) {
		if (!cells.has(`${x},${y}`)) return false;
	}
	const route = materializeVerticalRoute(x, startY, endY);
	return laneHasRoute(perimeter, route) || laneHasRoute(perimeter, [...route].reverse());
}

function outerLaneSegment(
	perimeter: PairedRailPerimeterPlan,
	junction: Cell,
	beforeEdges: number,
	afterEdges: number,
): readonly Cell[] {
	const lane = perimeter.lanes[0].cells.slice(0, -1);
	const junctionIndex = lane.findIndex((cell) => cell.x === junction.x && cell.y === junction.y);
	if (junctionIndex < 0) {
		throw new Error(
			`OpenFab inter-Block bridge junction ${cellKey(junction)} is not on the outer lane.`,
		);
	}
	const segment: Cell[] = [];
	for (let offset = -beforeEdges; offset <= afterEdges; offset++) {
		const index = (junctionIndex + offset + lane.length) % lane.length;
		segment.push(freezeCell(lane[index] as Cell));
	}
	return Object.freeze(segment);
}

function travelDirectionAt(perimeter: PairedRailPerimeterPlan, cell: Cell): Direction {
	const lane = perimeter.lanes[0].cells;
	for (let index = 0; index < lane.length - 1; index++) {
		const current = lane[index];
		const next = lane[index + 1];
		if (current?.x === cell.x && current.y === cell.y && next) {
			const direction = directionBetween(current, next);
			if (direction !== null) return direction;
		}
	}
	throw new Error(`OpenFab inter-Block bridge junction ${cellKey(cell)} is not on the outer lane.`);
}

function laneHasRoute(perimeter: PairedRailPerimeterPlan, route: readonly Cell[]): boolean {
	const edges = new Set(
		directedEdges(perimeter.lanes[0].cells).map(
			(edge) => `${cellKey(edge.from)}>${cellKey(edge.to)}`,
		),
	);
	return directedEdges(route).every((edge) =>
		edges.has(`${cellKey(edge.from)}>${cellKey(edge.to)}`),
	);
}

function samePerimeterFrame(
	left: PairedRailPerimeterRequest,
	right: PairedRailPerimeterRequest,
): boolean {
	return (
		left.forwardSpanMeters === right.forwardSpanMeters &&
		left.sideSpanMeters === right.sideSpanMeters &&
		left.laneSpacingMeters === right.laneSpacingMeters &&
		left.pose.forward === right.pose.forward &&
		left.pose.side === right.pose.side &&
		(left.pose.flow ?? "forward") === (right.pose.flow ?? "forward")
	);
}

export function openFabFabInterBlockBridgePlanFingerprint(
	plan: Omit<OpenFabFabInterBlockBridgePlan, "fingerprint">,
): string {
	for (let index = 0; index < plan.connections.length; index += 1) {
		if (!sameCellRoute(plan.buildRoutes[index], plan.connections[index]?.planningRoute)) {
			throw new Error("OpenFab inter-Block bridge build routes do not match their connections.");
		}
	}
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.kind,
		plan.specification.topologyPolicy,
		plan.specification.ownerKey,
		plan.specification.leftPerimeterFingerprint,
		plan.specification.rightPerimeterFingerprint,
		plan.reason,
		plan.ownershipIntent.owner,
		plan.ownershipIntent.ownerKey,
		plan.ownershipIntent.scope,
		...plan.junctions.flatMap((junction) => [
			junction.id,
			junction.block,
			junction.laneId,
			junction.role,
		]),
		...plan.connections.flatMap((connection) => [
			connection.id,
			connection.owner,
			connection.ownerKey,
			connection.sourceJunctionId,
			connection.targetJunctionId,
		]),
	]);
	checksum.addNumbers([
		plan.specification.version,
		plan.specification.gapMeters,
		plan.specification.stationMeters,
		plan.specification.junctionSeparationMeters,
		plan.specification.junctionSupportMeters,
		plan.newEdges,
		plan.lengthMeters,
		plan.reusedPerimeterSupportEdgeReferences,
		plan.uniqueReusedPerimeterSupportEdges,
		plan.bounds.minX,
		plan.bounds.minY,
		plan.bounds.maxX,
		plan.bounds.maxY,
		...plan.junctions.flatMap((junction) => [
			junction.cell.x,
			junction.cell.y,
			junction.travelDirection,
		]),
	]);
	for (const connection of plan.connections) {
		checksum.addNumbers([connection.planningRoute.length]);
		for (const cell of connection.planningRoute) checksum.addNumbers([cell.x, cell.y]);
		checksum.addNumbers([connection.ownedEdgeRoute.length]);
		for (const cell of connection.ownedEdgeRoute) checksum.addNumbers([cell.x, cell.y]);
		checksum.addNumbers([connection.ownedDirectedEdges.length]);
		for (const edge of connection.ownedDirectedEdges) {
			checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		}
		checksum.addNumbers([connection.reusedPerimeterSupportRoutes.length]);
		for (const route of connection.reusedPerimeterSupportRoutes) {
			checksum.addNumbers([route.length]);
			for (const cell of route) checksum.addNumbers([cell.x, cell.y]);
		}
		checksum.addNumbers([connection.reusedPerimeterSupportDirectedEdges.length]);
		for (const edge of connection.reusedPerimeterSupportDirectedEdges) {
			checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
		}
	}
	checksum.addNumbers([plan.buildRoutes.length]);
	for (const route of plan.buildRoutes) {
		checksum.addNumbers([route.length]);
		for (const cell of route) checksum.addNumbers([cell.x, cell.y]);
	}
	checksum.addNumbers([plan.ownershipIntent.directedEdges.length]);
	for (const edge of plan.ownershipIntent.directedEdges) {
		checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
	}
	checksum.addNumbers([plan.occupiedCells.length]);
	for (const cell of plan.occupiedCells) checksum.addNumbers([cell.x, cell.y]);
	return checksum.digest();
}

function sameCellRoute(
	left: readonly Cell[] | undefined,
	right: readonly Cell[] | undefined,
): boolean {
	return (
		left !== undefined &&
		right !== undefined &&
		left.length === right.length &&
		left.every((cell, index) => cell.x === right[index]?.x && cell.y === right[index]?.y)
	);
}

function materializeStraightRoute(from: Cell, to: Cell): readonly Cell[] {
	if (from.x !== to.x && from.y !== to.y) {
		throw new Error("OpenFab inter-Block bridge route must be cardinal.");
	}
	const dx = Math.sign(to.x - from.x);
	const dy = Math.sign(to.y - from.y);
	const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
	return Object.freeze(
		Array.from({ length: length + 1 }, (_, index) =>
			freezeCell({ x: from.x + dx * index, y: from.y + dy * index }),
		),
	);
}

function materializeVerticalRoute(x: number, startY: number, endY: number): readonly Cell[] {
	return Object.freeze(
		Array.from({ length: endY - startY + 1 }, (_, index) => freezeCell({ x, y: startY + index })),
	);
}

function joinRoutes(...routes: readonly (readonly Cell[])[]): readonly Cell[] {
	const joined: Cell[] = [];
	for (const route of routes) {
		if (route.length === 0) continue;
		const previous = joined.at(-1);
		const first = route[0];
		if (previous && first && previous.x === first.x && previous.y === first.y) {
			joined.push(...route.slice(1));
		} else {
			joined.push(...route);
		}
	}
	return Object.freeze(joined.map(freezeCell));
}

function directedEdges(route: readonly Cell[]): readonly OpenFabFabInterBlockBridgeDirectedEdge[] {
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
	const byKey = new Map<string, Cell>();
	for (const route of routes) {
		for (const cell of route) byKey.set(cellKey(cell), freezeCell(cell));
	}
	return Object.freeze(
		[...byKey.values()].sort((left, right) => left.x - right.x || left.y - right.y),
	);
}

function boundsForCells(cells: readonly Cell[]): OpenFabFabInterBlockBridgeBounds {
	return Object.freeze({
		minX: Math.min(...cells.map((cell) => cell.x)),
		minY: Math.min(...cells.map((cell) => cell.y)),
		maxX: Math.max(...cells.map((cell) => cell.x)),
		maxY: Math.max(...cells.map((cell) => cell.y)),
	});
}

function freezeJunction(
	junction: OpenFabFabInterBlockBridgeJunction,
): OpenFabFabInterBlockBridgeJunction {
	return Object.freeze({ ...junction, cell: freezeCell(junction.cell) });
}

function freezeConnection(
	connection: OpenFabFabInterBlockBridgeConnection,
): OpenFabFabInterBlockBridgeConnection {
	return Object.freeze(connection);
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}

function cellKey(cell: Cell): string {
	return `${cell.x},${cell.y}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKnownKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
	const known = new Set(keys);
	return Object.keys(record).every((key) => known.has(key));
}

function isStableKey(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 160 ||
		value.trim() !== value
	) {
		return false;
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return false;
	}
	return true;
}
