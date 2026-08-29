import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
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

export const PAIRED_RAIL_PERIMETER_PLAN_VERSION = 1 as const;
export const PAIRED_RAIL_PERIMETER_MINIMUM_INNER_SPAN_METERS = 4;
export const PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS = 2_000;
export const PAIRED_RAIL_PERIMETER_MINIMUM_LANE_SPACING_METERS = 1;

export type PairedRailPerimeterLaneId = "outer" | "inner";
export type PairedRailPerimeterCirculation = "clockwise" | "counterclockwise";
export type PairedRailPerimeterGatewayRole = "branch" | "merge";
export type PairedRailPerimeterGatewayFace = "near-side" | "opposite-side";
export type PairedRailPerimeterEnd = "origin" | "far";
export type PairedRailPerimeterPose = Readonly<Required<RailTemplatePose>>;

export const PAIRED_RAIL_PERIMETER_GATEWAY_IDS = ["near-side", "opposite-side"] as const;
export const PAIRED_RAIL_PERIMETER_TURNBACK_IDS = ["origin-end", "far-end"] as const;

export type PairedRailPerimeterGatewayId = (typeof PAIRED_RAIL_PERIMETER_GATEWAY_IDS)[number];
export type PairedRailPerimeterTurnbackId = (typeof PAIRED_RAIL_PERIMETER_TURNBACK_IDS)[number];

/**
 * Serializable perimeter request. The anchor is the outer lane corner from which the positive
 * forward and selected side spans are measured. Dimensions are generic 1 m lattice distances.
 */
export interface PairedRailPerimeterRequest {
	readonly version?: typeof PAIRED_RAIL_PERIMETER_PLAN_VERSION;
	readonly anchor: Cell;
	readonly forwardSpanMeters: number;
	readonly sideSpanMeters: number;
	readonly laneSpacingMeters: number;
	readonly pose: RailTemplatePose;
}

export interface PairedRailPerimeterSpecification {
	readonly version: typeof PAIRED_RAIL_PERIMETER_PLAN_VERSION;
	readonly anchor: Cell;
	readonly forwardSpanMeters: number;
	readonly sideSpanMeters: number;
	readonly laneSpacingMeters: number;
	readonly pose: PairedRailPerimeterPose;
}

export interface PairedRailPerimeterBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface PairedRailPerimeterLane {
	readonly id: PairedRailPerimeterLaneId;
	readonly circulation: PairedRailPerimeterCirculation;
	/** Geometric corners are independent of flow and ordered forward, side, reverse, return. */
	readonly corners: readonly [Cell, Cell, Cell, Cell];
	/** Closed route ordered in vehicle-flow direction; the first cell is repeated at the end. */
	readonly cells: readonly Cell[];
	readonly edgeCount: number;
	readonly lengthMeters: number;
}

export interface PairedRailPerimeterConnectionPort {
	readonly laneId: PairedRailPerimeterLaneId;
	readonly role: PairedRailPerimeterGatewayRole;
	readonly cell: Cell;
	readonly travelDirection: Direction;
	readonly outwardDirection: Direction;
}

/**
 * One outward paired-corridor contract. It describes where a tangent branch may leave one lane and
 * the corresponding return may merge into the opposite lane; it does not author either junction.
 */
export interface PairedRailPerimeterGatewayDescriptor {
	readonly id: PairedRailPerimeterGatewayId;
	readonly face: PairedRailPerimeterGatewayFace;
	readonly outwardDirection: Direction;
	readonly branch: PairedRailPerimeterConnectionPort;
	readonly merge: PairedRailPerimeterConnectionPort;
	readonly laneSpacingMeters: number;
}

/**
 * Exact one-way cardinal transfer between opposite-flow lanes at one longitudinal end. The compiler
 * materializes this descriptor and validates its branch, route, merge, support, and clearance as one
 * atomic draft.
 */
export interface PairedRailPerimeterTurnbackDescriptor {
	readonly id: PairedRailPerimeterTurnbackId;
	readonly end: PairedRailPerimeterEnd;
	readonly outwardDirection: Direction;
	readonly departure: PairedRailPerimeterConnectionPort;
	readonly arrival: PairedRailPerimeterConnectionPort;
	readonly laneSpacingMeters: number;
}

export interface PairedRailPerimeterDescriptorBalance {
	readonly gatewayBranches: 2;
	readonly gatewayMerges: 2;
	readonly turnbackBranches: 2;
	readonly turnbackMerges: 2;
}

/**
 * Pure, immutable geometry and attachment contract. No TileMap mutation, browser object, runtime
 * identity, or customer-specific provenance is stored in this plan.
 */
export interface PairedRailPerimeterPlan {
	readonly kind: "paired-rail-perimeter";
	readonly valid: true;
	readonly reason: string;
	readonly specification: PairedRailPerimeterSpecification;
	readonly lanes: readonly [PairedRailPerimeterLane, PairedRailPerimeterLane];
	readonly buildRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly occupiedCells: readonly Cell[];
	readonly cells: readonly Cell[];
	readonly bounds: PairedRailPerimeterBounds;
	readonly gateways: readonly [
		PairedRailPerimeterGatewayDescriptor,
		PairedRailPerimeterGatewayDescriptor,
	];
	readonly turnbacks: readonly [
		PairedRailPerimeterTurnbackDescriptor,
		PairedRailPerimeterTurnbackDescriptor,
	];
	readonly descriptorBalance: PairedRailPerimeterDescriptorBalance;
	readonly newEdges: number;
	readonly lengthMeters: number;
	readonly turns: 8;
	readonly fingerprint: string;
}

export function validatePairedRailPerimeterRequest(input: unknown): string | null {
	if (!isRecord(input)) return "Paired rail perimeter request must be an object.";
	if (input.version !== undefined && input.version !== PAIRED_RAIL_PERIMETER_PLAN_VERSION) {
		return `Paired rail perimeter version must be ${PAIRED_RAIL_PERIMETER_PLAN_VERSION}.`;
	}
	if (!isInt32Cell(input.anchor)) {
		return "Paired rail perimeter anchor must use signed-int32 integer coordinates.";
	}
	if (!isBoundedInteger(input.forwardSpanMeters, 1, PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS)) {
		return `Paired rail perimeter forward span must be a 1-${PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS} meter integer.`;
	}
	if (!isBoundedInteger(input.sideSpanMeters, 1, PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS)) {
		return `Paired rail perimeter side span must be a 1-${PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS} meter integer.`;
	}
	if (
		!isBoundedInteger(
			input.laneSpacingMeters,
			PAIRED_RAIL_PERIMETER_MINIMUM_LANE_SPACING_METERS,
			PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS,
		)
	) {
		return `Paired rail perimeter lane spacing must be a ${PAIRED_RAIL_PERIMETER_MINIMUM_LANE_SPACING_METERS}-${PAIRED_RAIL_PERIMETER_MAXIMUM_SPAN_METERS} meter integer.`;
	}
	if (!isRecord(input.pose)) return "Paired rail perimeter pose must be an object.";
	if (!isDirection(input.pose.forward)) {
		return "Paired rail perimeter pose forward must be a cardinal Direction.";
	}
	if (input.pose.side !== "left" && input.pose.side !== "right") {
		return 'Paired rail perimeter pose side must be "left" or "right".';
	}
	if (
		input.pose.flow !== undefined &&
		input.pose.flow !== "forward" &&
		input.pose.flow !== "reverse"
	) {
		return 'Paired rail perimeter pose flow must be "forward" or "reverse".';
	}

	const laneSpacingMeters = input.laneSpacingMeters as number;
	const minimumOuterSpan = laneSpacingMeters * 2 + PAIRED_RAIL_PERIMETER_MINIMUM_INNER_SPAN_METERS;
	if ((input.forwardSpanMeters as number) < minimumOuterSpan) {
		return `Paired rail perimeter forward span must leave an inner span of at least ${PAIRED_RAIL_PERIMETER_MINIMUM_INNER_SPAN_METERS} meters.`;
	}
	if ((input.sideSpanMeters as number) < minimumOuterSpan) {
		return `Paired rail perimeter side span must leave an inner span of at least ${PAIRED_RAIL_PERIMETER_MINIMUM_INNER_SPAN_METERS} meters.`;
	}

	const anchor = input.anchor;
	const forward = input.pose.forward;
	const lateral = lateralDirection(forward, input.pose.side);
	const forwardSpanMeters = input.forwardSpanMeters as number;
	const sideSpanMeters = input.sideSpanMeters as number;
	const corners = [
		offsetCell(anchor, forward, lateral, 0, 0),
		offsetCell(anchor, forward, lateral, forwardSpanMeters, 0),
		offsetCell(anchor, forward, lateral, forwardSpanMeters, sideSpanMeters),
		offsetCell(anchor, forward, lateral, 0, sideSpanMeters),
		offsetCell(anchor, forward, lateral, laneSpacingMeters, laneSpacingMeters),
		offsetCell(anchor, forward, lateral, forwardSpanMeters - laneSpacingMeters, laneSpacingMeters),
		offsetCell(
			anchor,
			forward,
			lateral,
			forwardSpanMeters - laneSpacingMeters,
			sideSpanMeters - laneSpacingMeters,
		),
		offsetCell(anchor, forward, lateral, laneSpacingMeters, sideSpanMeters - laneSpacingMeters),
	];
	if (!corners.every(isInt32Cell)) {
		return "Paired rail perimeter footprint exceeds signed-int32 coordinate bounds.";
	}
	return null;
}

export function planPairedRailPerimeter(
	request: PairedRailPerimeterRequest,
): PairedRailPerimeterPlan {
	const specification = normalizeRequest(request);
	const { anchor, forwardSpanMeters, sideSpanMeters, laneSpacingMeters, pose } = specification;
	const forward = pose.forward;
	const lateral = lateralDirection(forward, pose.side);
	const outerCorners = rectangleCorners(
		anchor,
		forward,
		lateral,
		forwardSpanMeters,
		sideSpanMeters,
		0,
	);
	const innerCorners = rectangleCorners(
		anchor,
		forward,
		lateral,
		forwardSpanMeters,
		sideSpanMeters,
		laneSpacingMeters,
	);
	const outerGeometry = materializeRectangle(outerCorners);
	const innerGeometry = materializeRectangle(innerCorners);
	const outerForward = pose.flow === "forward";
	const outerCells = outerForward ? outerGeometry : reverseClosedRoute(outerGeometry);
	const innerCells = outerForward ? reverseClosedRoute(innerGeometry) : innerGeometry;
	const geometricCirculation: PairedRailPerimeterCirculation =
		pose.side === "right" ? "clockwise" : "counterclockwise";
	const outerLane = freezeLane({
		id: "outer",
		circulation: outerForward ? geometricCirculation : oppositeCirculation(geometricCirculation),
		corners: outerCorners,
		cells: outerCells,
		edgeCount: outerGeometry.length - 1,
		lengthMeters: outerGeometry.length - 1,
	});
	const innerLane = freezeLane({
		id: "inner",
		circulation: outerForward ? oppositeCirculation(geometricCirculation) : geometricCirculation,
		corners: innerCorners,
		cells: innerCells,
		edgeCount: innerGeometry.length - 1,
		lengthMeters: innerGeometry.length - 1,
	});
	const lanes = Object.freeze([outerLane, innerLane] satisfies readonly [
		PairedRailPerimeterLane,
		PairedRailPerimeterLane,
	]);
	const buildRoutes = Object.freeze([outerCells, innerCells] satisfies readonly [
		readonly Cell[],
		readonly Cell[],
	]);
	const occupiedCells = Object.freeze([...outerCells.slice(0, -1), ...innerCells.slice(0, -1)]);
	const cells = occupiedCells;
	const bounds = freezeBounds(occupiedCells);

	const forwardMidpoint = Math.floor(forwardSpanMeters / 2);
	const sideMidpoint = Math.floor(sideSpanMeters / 2);
	const outerNearGatewayCell = freezeCell(offsetCell(anchor, forward, lateral, forwardMidpoint, 0));
	const innerNearGatewayCell = freezeCell(
		offsetCell(anchor, forward, lateral, forwardMidpoint, laneSpacingMeters),
	);
	const outerOppositeGatewayCell = freezeCell(
		offsetCell(anchor, forward, lateral, forwardMidpoint, sideSpanMeters),
	);
	const innerOppositeGatewayCell = freezeCell(
		offsetCell(anchor, forward, lateral, forwardMidpoint, sideSpanMeters - laneSpacingMeters),
	);
	const gateways = Object.freeze([
		gatewayDescriptor(
			"near-side",
			"near-side",
			oppositeDirection(lateral),
			outerLane,
			outerNearGatewayCell,
			innerLane,
			innerNearGatewayCell,
			forward,
			laneSpacingMeters,
		),
		gatewayDescriptor(
			"opposite-side",
			"opposite-side",
			lateral,
			outerLane,
			outerOppositeGatewayCell,
			innerLane,
			innerOppositeGatewayCell,
			forward,
			laneSpacingMeters,
		),
	] satisfies readonly [
		PairedRailPerimeterGatewayDescriptor,
		PairedRailPerimeterGatewayDescriptor,
	]);

	const outerOriginTurnbackCell = freezeCell(offsetCell(anchor, forward, lateral, 0, sideMidpoint));
	const innerOriginTurnbackCell = freezeCell(
		offsetCell(anchor, forward, lateral, laneSpacingMeters, sideMidpoint),
	);
	const outerFarTurnbackCell = freezeCell(
		offsetCell(anchor, forward, lateral, forwardSpanMeters, sideMidpoint),
	);
	const innerFarTurnbackCell = freezeCell(
		offsetCell(anchor, forward, lateral, forwardSpanMeters - laneSpacingMeters, sideMidpoint),
	);
	const turnbacks = Object.freeze([
		turnbackDescriptor(
			"origin-end",
			"origin",
			oppositeDirection(forward),
			outerLane,
			outerOriginTurnbackCell,
			innerLane,
			innerOriginTurnbackCell,
			lateral,
			laneSpacingMeters,
		),
		turnbackDescriptor(
			"far-end",
			"far",
			forward,
			outerLane,
			outerFarTurnbackCell,
			innerLane,
			innerFarTurnbackCell,
			lateral,
			laneSpacingMeters,
		),
	] satisfies readonly [
		PairedRailPerimeterTurnbackDescriptor,
		PairedRailPerimeterTurnbackDescriptor,
	]);
	const descriptorBalance = Object.freeze({
		gatewayBranches: 2 as const,
		gatewayMerges: 2 as const,
		turnbackBranches: 2 as const,
		turnbackMerges: 2 as const,
	});
	const newEdges = outerLane.edgeCount + innerLane.edgeCount;
	const planWithoutFingerprint = Object.freeze({
		kind: "paired-rail-perimeter" as const,
		valid: true as const,
		reason: "Paired rectangular perimeter geometry and balanced attachment descriptors are valid.",
		specification,
		lanes,
		buildRoutes,
		occupiedCells,
		cells,
		bounds,
		gateways,
		turnbacks,
		descriptorBalance,
		newEdges,
		lengthMeters: newEdges,
		turns: 8 as const,
	});
	return Object.freeze({
		...planWithoutFingerprint,
		fingerprint: checksumPlan(planWithoutFingerprint),
	});
}

export function pairedRailPerimeterFingerprint(request: PairedRailPerimeterRequest): string {
	return planPairedRailPerimeter(request).fingerprint;
}

/** Materialize one declared one-way lane transfer from its branch to its merge. */
export function materializePairedRailPerimeterTurnbackRoute(
	descriptor: PairedRailPerimeterTurnbackDescriptor,
): readonly Cell[] {
	if (descriptor.departure.role !== "branch" || descriptor.arrival.role !== "merge") {
		throw new Error("Paired perimeter turnback must connect one branch to one merge.");
	}
	const direction = cardinalDirectionBetween(descriptor.departure.cell, descriptor.arrival.cell);
	const expectedDirection =
		descriptor.end === "origin"
			? oppositeDirection(descriptor.outwardDirection)
			: descriptor.outwardDirection;
	if (direction !== expectedDirection) {
		throw new Error(
			"Paired perimeter turnback route does not follow its declared outward direction.",
		);
	}
	const distance =
		Math.abs(descriptor.arrival.cell.x - descriptor.departure.cell.x) +
		Math.abs(descriptor.arrival.cell.y - descriptor.departure.cell.y);
	if (distance !== descriptor.laneSpacingMeters) {
		throw new Error("Paired perimeter turnback route does not match its lane spacing.");
	}
	return Object.freeze(
		Array.from({ length: distance + 1 }, (_, step) =>
			freezeCell(offsetAlongDirection(descriptor.departure.cell, direction, step)),
		),
	);
}

function normalizeRequest(request: PairedRailPerimeterRequest): PairedRailPerimeterSpecification {
	const error = validatePairedRailPerimeterRequest(request);
	if (error) throw new RangeError(error);
	return Object.freeze({
		version: PAIRED_RAIL_PERIMETER_PLAN_VERSION,
		anchor: freezeCell(request.anchor),
		forwardSpanMeters: request.forwardSpanMeters,
		sideSpanMeters: request.sideSpanMeters,
		laneSpacingMeters: request.laneSpacingMeters,
		pose: Object.freeze({
			forward: request.pose.forward,
			side: request.pose.side,
			flow: request.pose.flow ?? "forward",
		}),
	});
}

function rectangleCorners(
	anchor: Cell,
	forward: Direction,
	lateral: Direction,
	forwardSpanMeters: number,
	sideSpanMeters: number,
	insetMeters: number,
): readonly [Cell, Cell, Cell, Cell] {
	return Object.freeze([
		freezeCell(offsetCell(anchor, forward, lateral, insetMeters, insetMeters)),
		freezeCell(offsetCell(anchor, forward, lateral, forwardSpanMeters - insetMeters, insetMeters)),
		freezeCell(
			offsetCell(
				anchor,
				forward,
				lateral,
				forwardSpanMeters - insetMeters,
				sideSpanMeters - insetMeters,
			),
		),
		freezeCell(offsetCell(anchor, forward, lateral, insetMeters, sideSpanMeters - insetMeters)),
	]);
}

function materializeRectangle(corners: readonly [Cell, Cell, Cell, Cell]): readonly Cell[] {
	const cells: Cell[] = [corners[0]];
	for (let index = 0; index < corners.length; index++) {
		const start = corners[index] as Cell;
		const end = corners[(index + 1) % corners.length] as Cell;
		const direction = cardinalDirectionBetween(start, end);
		const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		for (let step = 1; step <= distance; step++) {
			cells.push(freezeCell(offsetAlongDirection(start, direction, step)));
		}
	}
	return Object.freeze(cells);
}

function gatewayDescriptor(
	id: PairedRailPerimeterGatewayId,
	face: PairedRailPerimeterGatewayFace,
	outwardDirection: Direction,
	outerLane: PairedRailPerimeterLane,
	outerCell: Cell,
	innerLane: PairedRailPerimeterLane,
	innerCell: Cell,
	branchTravelDirection: Direction,
	laneSpacingMeters: number,
): PairedRailPerimeterGatewayDescriptor {
	const outerDirection = travelDirectionAt(outerLane, outerCell);
	const innerDirection = travelDirectionAt(innerLane, innerCell);
	if (
		!isOppositePair(outerDirection, innerDirection) ||
		(outerDirection !== branchTravelDirection && innerDirection !== branchTravelDirection)
	) {
		throw new Error("Paired perimeter gateway lanes do not carry balanced opposite flow.");
	}
	const outerRole: PairedRailPerimeterGatewayRole =
		outerDirection === branchTravelDirection ? "branch" : "merge";
	const innerRole: PairedRailPerimeterGatewayRole =
		innerDirection === branchTravelDirection ? "branch" : "merge";
	const outerPort = connectionPort(
		outerLane.id,
		outerRole,
		outerCell,
		outerDirection,
		outwardDirection,
	);
	const innerPort = connectionPort(
		innerLane.id,
		innerRole,
		innerCell,
		innerDirection,
		outwardDirection,
	);
	return Object.freeze({
		id,
		face,
		outwardDirection,
		branch: outerRole === "branch" ? outerPort : innerPort,
		merge: outerRole === "merge" ? outerPort : innerPort,
		laneSpacingMeters,
	});
}

function turnbackDescriptor(
	id: PairedRailPerimeterTurnbackId,
	end: PairedRailPerimeterEnd,
	outwardDirection: Direction,
	outerLane: PairedRailPerimeterLane,
	outerCell: Cell,
	innerLane: PairedRailPerimeterLane,
	innerCell: Cell,
	arrivalTravelDirection: Direction,
	laneSpacingMeters: number,
): PairedRailPerimeterTurnbackDescriptor {
	const outerDirection = travelDirectionAt(outerLane, outerCell);
	const innerDirection = travelDirectionAt(innerLane, innerCell);
	if (
		!isOppositePair(outerDirection, innerDirection) ||
		(outerDirection !== arrivalTravelDirection && innerDirection !== arrivalTravelDirection)
	) {
		throw new Error("Paired perimeter turnback lanes do not carry balanced opposite flow.");
	}
	const outerRole: PairedRailPerimeterGatewayRole =
		outerDirection === arrivalTravelDirection ? "merge" : "branch";
	const innerRole: PairedRailPerimeterGatewayRole =
		innerDirection === arrivalTravelDirection ? "merge" : "branch";
	const outerPort = connectionPort(
		outerLane.id,
		outerRole,
		outerCell,
		outerDirection,
		outwardDirection,
	);
	const innerPort = connectionPort(
		innerLane.id,
		innerRole,
		innerCell,
		innerDirection,
		outwardDirection,
	);
	return Object.freeze({
		id,
		end,
		outwardDirection,
		departure: outerRole === "branch" ? outerPort : innerPort,
		arrival: outerRole === "merge" ? outerPort : innerPort,
		laneSpacingMeters,
	});
}

function connectionPort(
	laneId: PairedRailPerimeterLaneId,
	role: PairedRailPerimeterGatewayRole,
	cell: Cell,
	travelDirection: Direction,
	outwardDirection: Direction,
): PairedRailPerimeterConnectionPort {
	return Object.freeze({
		laneId,
		role,
		cell,
		travelDirection,
		outwardDirection,
	});
}

function travelDirectionAt(lane: PairedRailPerimeterLane, cell: Cell): Direction {
	const index = lane.cells.findIndex(
		(candidate, candidateIndex) =>
			candidateIndex < lane.cells.length - 1 && candidate.x === cell.x && candidate.y === cell.y,
	);
	if (index < 0) throw new Error(`Paired perimeter ${lane.id} descriptor is outside its lane.`);
	const direction = directionBetween(lane.cells[index] as Cell, lane.cells[index + 1] as Cell);
	if (direction === null)
		throw new Error(`Paired perimeter ${lane.id} descriptor is not cardinal.`);
	return direction;
}

function freezeLane(lane: PairedRailPerimeterLane): PairedRailPerimeterLane {
	return Object.freeze(lane);
}

function freezeBounds(cells: readonly Cell[]): PairedRailPerimeterBounds {
	return Object.freeze({
		minX: Math.min(...cells.map((cell) => cell.x)),
		minY: Math.min(...cells.map((cell) => cell.y)),
		maxX: Math.max(...cells.map((cell) => cell.x)),
		maxY: Math.max(...cells.map((cell) => cell.y)),
	});
}

function reverseClosedRoute(route: readonly Cell[]): readonly Cell[] {
	return Object.freeze([...route].reverse());
}

function oppositeCirculation(
	circulation: PairedRailPerimeterCirculation,
): PairedRailPerimeterCirculation {
	return circulation === "clockwise" ? "counterclockwise" : "clockwise";
}

function isOppositePair(first: Direction, second: Direction): boolean {
	return oppositeDirection(first) === second;
}

function lateralDirection(forward: Direction, side: RailTemplatePose["side"]): Direction {
	const right =
		forward === DIR_N ? DIR_E : forward === DIR_E ? DIR_S : forward === DIR_S ? DIR_W : DIR_N;
	return side === "right" ? right : oppositeDirection(right);
}

function offsetCell(
	anchor: Cell,
	forward: Direction,
	lateral: Direction,
	forwardDistance: number,
	lateralDistance: number,
): Cell {
	const forwardVector = directionVector(forward);
	const lateralVector = directionVector(lateral);
	return {
		x: anchor.x + forwardVector.x * forwardDistance + lateralVector.x * lateralDistance,
		y: anchor.y + forwardVector.y * forwardDistance + lateralVector.y * lateralDistance,
	};
}

function offsetAlongDirection(origin: Cell, direction: Direction, distance: number): Cell {
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

function cardinalDirectionBetween(start: Cell, end: Cell): Direction {
	if (start.x !== end.x && start.y !== end.y) {
		throw new Error("Paired rail perimeter segments must remain cardinal.");
	}
	if (start.x === end.x && start.y === end.y) {
		throw new Error("Paired rail perimeter segments must have positive length.");
	}
	if (start.x === end.x) return end.y > start.y ? DIR_S : DIR_N;
	return end.x > start.x ? DIR_E : DIR_W;
}

function checksumPlan(plan: Omit<PairedRailPerimeterPlan, "fingerprint">): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"PAIRED_RAIL_PERIMETER",
		plan.kind,
		plan.specification.pose.side,
		plan.specification.pose.flow,
	]);
	checksum.addNumbers([
		plan.specification.version,
		plan.specification.anchor.x,
		plan.specification.anchor.y,
		plan.specification.forwardSpanMeters,
		plan.specification.sideSpanMeters,
		plan.specification.laneSpacingMeters,
		plan.specification.pose.forward,
		plan.bounds.minX,
		plan.bounds.minY,
		plan.bounds.maxX,
		plan.bounds.maxY,
		plan.newEdges,
		plan.lengthMeters,
		plan.turns,
	]);
	for (const lane of plan.lanes) {
		checksum.addStrings([lane.id, lane.circulation]);
		checksum.addNumbers([
			lane.edgeCount,
			lane.lengthMeters,
			lane.corners.length,
			lane.cells.length,
		]);
		for (const corner of lane.corners) checksum.addNumbers([corner.x, corner.y]);
		for (const cell of lane.cells) checksum.addNumbers([cell.x, cell.y]);
	}
	for (const gateway of plan.gateways) {
		checksum.addStrings([gateway.id, gateway.face]);
		checksum.addNumbers([gateway.outwardDirection, gateway.laneSpacingMeters]);
		addPortChecksum(checksum, gateway.branch);
		addPortChecksum(checksum, gateway.merge);
	}
	for (const turnback of plan.turnbacks) {
		checksum.addStrings([turnback.id, turnback.end]);
		checksum.addNumbers([turnback.outwardDirection, turnback.laneSpacingMeters]);
		addPortChecksum(checksum, turnback.departure);
		addPortChecksum(checksum, turnback.arrival);
	}
	checksum.addNumbers([
		plan.descriptorBalance.gatewayBranches,
		plan.descriptorBalance.gatewayMerges,
		plan.descriptorBalance.turnbackBranches,
		plan.descriptorBalance.turnbackMerges,
	]);
	return checksum.digest();
}

function addPortChecksum(
	checksum: OrderedTypedChecksum,
	port: PairedRailPerimeterConnectionPort,
): void {
	checksum.addStrings([port.laneId, port.role]);
	checksum.addNumbers([port.cell.x, port.cell.y, port.travelDirection, port.outwardDirection]);
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
