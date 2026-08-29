import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { RailTemplatePose } from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

export const PAIRED_RAIL_CORRIDOR_PLAN_VERSION = 1 as const;
export const PAIRED_RAIL_CORRIDOR_MINIMUM_LENGTH_METERS = 1;
export const PAIRED_RAIL_CORRIDOR_MAXIMUM_LENGTH_METERS = 2_000;
export const PAIRED_RAIL_CORRIDOR_MINIMUM_LANE_SPACING_METERS = 1;
export const PAIRED_RAIL_CORRIDOR_MAXIMUM_LANE_SPACING_METERS = 2_000;

export type PairedRailCorridorLaneId = "primary" | "secondary";
export type PairedRailCorridorEnd = "origin" | "far";
export type PairedRailCorridorFlowRole = "entry" | "exit";
export type PairedRailCorridorGatewayRole = "branch" | "merge";

export const PAIRED_RAIL_CORRIDOR_ENDPOINT_IDS = [
	"primary-origin",
	"secondary-origin",
	"primary-far",
	"secondary-far",
] as const;

export type PairedRailCorridorEndpointId = (typeof PAIRED_RAIL_CORRIDOR_ENDPOINT_IDS)[number];
export type PairedRailCorridorPose = Readonly<Required<RailTemplatePose>>;

/** Serializable request. The anchor is the geometric origin of the primary lane. */
export interface PairedRailCorridorRequest {
	readonly version?: typeof PAIRED_RAIL_CORRIDOR_PLAN_VERSION;
	readonly anchor: Cell;
	readonly lengthMeters: number;
	readonly laneSpacingMeters: number;
	readonly pose: RailTemplatePose;
}

export interface PairedRailCorridorSpecification {
	readonly version: typeof PAIRED_RAIL_CORRIDOR_PLAN_VERSION;
	readonly anchor: Cell;
	readonly lengthMeters: number;
	readonly laneSpacingMeters: number;
	readonly pose: PairedRailCorridorPose;
}

export interface PairedRailCorridorEndpointDescriptor {
	readonly id: PairedRailCorridorEndpointId;
	readonly laneId: PairedRailCorridorLaneId;
	readonly end: PairedRailCorridorEnd;
	readonly flowRole: PairedRailCorridorFlowRole;
	readonly gatewayRole: PairedRailCorridorGatewayRole;
	readonly attachment: "open-terminal";
	readonly cell: Cell;
	/** Direction of vehicle travel on the lane at this endpoint. */
	readonly travelDirection: Direction;
	/** Cardinal direction from the corridor footprint toward external gateway geometry. */
	readonly outwardDirection: Direction;
	readonly pairedEndpointId: PairedRailCorridorEndpointId;
}

export interface PairedRailCorridorLane {
	readonly id: PairedRailCorridorLaneId;
	/** Cells are ordered in vehicle-flow direction, matching ordinary construction routes. */
	readonly cells: readonly Cell[];
	readonly travelDirection: Direction;
	readonly entryEndpointId: PairedRailCorridorEndpointId;
	readonly exitEndpointId: PairedRailCorridorEndpointId;
}

/**
 * Pure geometry plan for a paired corridor. It intentionally carries no mutations: a later macro
 * planner must attach its four terminals and submit the resulting routes to the ordinary topology
 * and physical-draft validators before commit.
 */
export interface PairedRailCorridorPlan {
	readonly kind: "paired-rail-corridor";
	readonly valid: true;
	readonly reason: string;
	readonly specification: PairedRailCorridorSpecification;
	readonly lanes: readonly [PairedRailCorridorLane, PairedRailCorridorLane];
	readonly buildRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly occupiedCells: readonly Cell[];
	readonly cells: readonly Cell[];
	readonly endpoints: readonly [
		PairedRailCorridorEndpointDescriptor,
		PairedRailCorridorEndpointDescriptor,
		PairedRailCorridorEndpointDescriptor,
		PairedRailCorridorEndpointDescriptor,
	];
	readonly newEdges: number;
	readonly lengthMeters: number;
	readonly turns: 0;
	readonly fingerprint: string;
}

/**
 * Close both paired terminals with compact outward turnbacks. This route is intended for a
 * self-contained corridor proof or a synthetic assembly step; interactive construction still
 * uses explicit gateway planners so a user can choose how each end joins the surrounding FAB.
 */
export function materializeClosedPairedRailCorridorRoute(
	plan: PairedRailCorridorPlan,
	turnbackClearanceMeters = 1,
): readonly Cell[] {
	if (!isBoundedInteger(turnbackClearanceMeters, 1, 2_000)) {
		throw new RangeError("Paired rail corridor turnback clearance must be 1-2000 meters.");
	}
	const primary = plan.lanes[0];
	const secondary = plan.lanes[1];
	const primaryExit = endpointById(plan, primary.exitEndpointId);
	const secondaryEntry = endpointById(plan, secondary.entryEndpointId);
	const secondaryExit = endpointById(plan, secondary.exitEndpointId);
	const primaryEntry = endpointById(plan, primary.entryEndpointId);
	const firstTurnback = materializeTurnback(primaryExit, secondaryEntry, turnbackClearanceMeters);
	const secondTurnback = materializeTurnback(secondaryExit, primaryEntry, turnbackClearanceMeters);
	return Object.freeze([
		...primary.cells,
		...firstTurnback.slice(1),
		...secondary.cells.slice(1),
		...secondTurnback.slice(1),
	]);
}

export function validatePairedRailCorridorRequest(input: unknown): string | null {
	if (!isRecord(input)) return "Paired rail corridor request must be an object.";
	if (input.version !== undefined && input.version !== PAIRED_RAIL_CORRIDOR_PLAN_VERSION) {
		return `Paired rail corridor version must be ${PAIRED_RAIL_CORRIDOR_PLAN_VERSION}.`;
	}
	if (!isInt32Cell(input.anchor)) {
		return "Paired rail corridor anchor must use signed-int32 integer coordinates.";
	}
	if (
		!isBoundedInteger(
			input.lengthMeters,
			PAIRED_RAIL_CORRIDOR_MINIMUM_LENGTH_METERS,
			PAIRED_RAIL_CORRIDOR_MAXIMUM_LENGTH_METERS,
		)
	) {
		return `Paired rail corridor length must be an integer from ${PAIRED_RAIL_CORRIDOR_MINIMUM_LENGTH_METERS} to ${PAIRED_RAIL_CORRIDOR_MAXIMUM_LENGTH_METERS} meters.`;
	}
	if (
		!isBoundedInteger(
			input.laneSpacingMeters,
			PAIRED_RAIL_CORRIDOR_MINIMUM_LANE_SPACING_METERS,
			PAIRED_RAIL_CORRIDOR_MAXIMUM_LANE_SPACING_METERS,
		)
	) {
		return `Paired rail corridor lane spacing must be an integer from ${PAIRED_RAIL_CORRIDOR_MINIMUM_LANE_SPACING_METERS} to ${PAIRED_RAIL_CORRIDOR_MAXIMUM_LANE_SPACING_METERS} meters.`;
	}
	if (!isRecord(input.pose)) return "Paired rail corridor pose must be an object.";
	if (!isDirection(input.pose.forward)) {
		return "Paired rail corridor pose forward must be a cardinal Direction.";
	}
	if (input.pose.side !== "left" && input.pose.side !== "right") {
		return 'Paired rail corridor pose side must be "left" or "right".';
	}
	if (
		input.pose.flow !== undefined &&
		input.pose.flow !== "forward" &&
		input.pose.flow !== "reverse"
	) {
		return 'Paired rail corridor pose flow must be "forward" or "reverse".';
	}

	const anchor = input.anchor;
	const forward = input.pose.forward;
	const lateral = lateralDirection(forward, input.pose.side);
	const lengthMeters = input.lengthMeters as number;
	const laneSpacingMeters = input.laneSpacingMeters as number;
	const primaryFar = offsetCell(anchor, forward, lengthMeters);
	const secondaryOrigin = offsetCell(anchor, lateral, laneSpacingMeters);
	const secondaryFar = offsetCell(secondaryOrigin, forward, lengthMeters);
	if (![primaryFar, secondaryOrigin, secondaryFar].every(isInt32Cell)) {
		return "Paired rail corridor footprint exceeds signed-int32 coordinate bounds.";
	}
	return null;
}

export function planPairedRailCorridor(request: PairedRailCorridorRequest): PairedRailCorridorPlan {
	const specification = normalizeRequest(request);
	const { anchor, lengthMeters, laneSpacingMeters, pose } = specification;
	const forward = pose.forward;
	const reverse = oppositeDirection(forward);
	const lateral = lateralDirection(forward, pose.side);
	const secondaryOrigin = freezeCell(offsetCell(anchor, lateral, laneSpacingMeters));
	const primaryGeometry = materializeLane(anchor, forward, lengthMeters);
	const secondaryGeometry = materializeLane(secondaryOrigin, forward, lengthMeters);
	const primaryCells = pose.flow === "forward" ? primaryGeometry : reverseRoute(primaryGeometry);
	const secondaryCells =
		pose.flow === "forward" ? reverseRoute(secondaryGeometry) : secondaryGeometry;
	const primaryTravelDirection = pose.flow === "forward" ? forward : reverse;
	const secondaryTravelDirection = oppositeDirection(primaryTravelDirection);
	const originOutward = reverse;
	const farOutward = forward;
	const primaryOriginRole = pose.flow === "forward" ? "entry" : "exit";
	const secondaryOriginRole = oppositeFlowRole(primaryOriginRole);

	const endpoints = Object.freeze([
		endpoint(
			"primary-origin",
			"primary",
			"origin",
			primaryGeometry[0] as Cell,
			primaryOriginRole,
			primaryTravelDirection,
			originOutward,
			"secondary-origin",
		),
		endpoint(
			"secondary-origin",
			"secondary",
			"origin",
			secondaryGeometry[0] as Cell,
			secondaryOriginRole,
			secondaryTravelDirection,
			originOutward,
			"primary-origin",
		),
		endpoint(
			"primary-far",
			"primary",
			"far",
			primaryGeometry.at(-1) as Cell,
			oppositeFlowRole(primaryOriginRole),
			primaryTravelDirection,
			farOutward,
			"secondary-far",
		),
		endpoint(
			"secondary-far",
			"secondary",
			"far",
			secondaryGeometry.at(-1) as Cell,
			primaryOriginRole,
			secondaryTravelDirection,
			farOutward,
			"primary-far",
		),
	] satisfies readonly [
		PairedRailCorridorEndpointDescriptor,
		PairedRailCorridorEndpointDescriptor,
		PairedRailCorridorEndpointDescriptor,
		PairedRailCorridorEndpointDescriptor,
	]);
	const primaryLane = freezeLane({
		id: "primary",
		cells: primaryCells,
		travelDirection: primaryTravelDirection,
		entryEndpointId: pose.flow === "forward" ? "primary-origin" : "primary-far",
		exitEndpointId: pose.flow === "forward" ? "primary-far" : "primary-origin",
	});
	const secondaryLane = freezeLane({
		id: "secondary",
		cells: secondaryCells,
		travelDirection: secondaryTravelDirection,
		entryEndpointId: pose.flow === "forward" ? "secondary-far" : "secondary-origin",
		exitEndpointId: pose.flow === "forward" ? "secondary-origin" : "secondary-far",
	});
	const lanes = Object.freeze([primaryLane, secondaryLane] satisfies readonly [
		PairedRailCorridorLane,
		PairedRailCorridorLane,
	]);
	const buildRoutes = Object.freeze([primaryCells, secondaryCells] satisfies readonly [
		readonly Cell[],
		readonly Cell[],
	]);
	const occupiedCells = Object.freeze([...primaryGeometry, ...secondaryGeometry]);
	const cells = Object.freeze([...primaryCells, ...secondaryCells]);
	const planWithoutFingerprint = Object.freeze({
		kind: "paired-rail-corridor" as const,
		valid: true as const,
		reason: "Paired rail corridor geometry is valid.",
		specification,
		lanes,
		buildRoutes,
		occupiedCells,
		cells,
		endpoints,
		newEdges: lengthMeters * 2,
		lengthMeters: lengthMeters * 2,
		turns: 0 as const,
	});
	return Object.freeze({
		...planWithoutFingerprint,
		fingerprint: checksumPlan(planWithoutFingerprint),
	});
}

export function pairedRailCorridorFingerprint(request: PairedRailCorridorRequest): string {
	return planPairedRailCorridor(request).fingerprint;
}

function normalizeRequest(request: PairedRailCorridorRequest): PairedRailCorridorSpecification {
	const error = validatePairedRailCorridorRequest(request);
	if (error) throw new RangeError(error);
	return Object.freeze({
		version: PAIRED_RAIL_CORRIDOR_PLAN_VERSION,
		anchor: freezeCell(request.anchor),
		lengthMeters: request.lengthMeters,
		laneSpacingMeters: request.laneSpacingMeters,
		pose: Object.freeze({
			forward: request.pose.forward,
			side: request.pose.side,
			flow: request.pose.flow ?? "forward",
		}),
	});
}

function endpoint(
	id: PairedRailCorridorEndpointId,
	laneId: PairedRailCorridorLaneId,
	end: PairedRailCorridorEnd,
	cell: Cell,
	flowRole: PairedRailCorridorFlowRole,
	travelDirection: Direction,
	outwardDirection: Direction,
	pairedEndpointId: PairedRailCorridorEndpointId,
): PairedRailCorridorEndpointDescriptor {
	return Object.freeze({
		id,
		laneId,
		end,
		flowRole,
		gatewayRole: flowRole === "entry" ? "branch" : "merge",
		attachment: "open-terminal",
		cell,
		travelDirection,
		outwardDirection,
		pairedEndpointId,
	});
}

function freezeLane(lane: PairedRailCorridorLane): PairedRailCorridorLane {
	return Object.freeze(lane);
}

function materializeLane(
	origin: Cell,
	direction: Direction,
	lengthMeters: number,
): readonly Cell[] {
	return Object.freeze(
		Array.from({ length: lengthMeters + 1 }, (_, distance) =>
			freezeCell(offsetCell(origin, direction, distance)),
		),
	);
}

function endpointById(
	plan: PairedRailCorridorPlan,
	id: PairedRailCorridorEndpointId,
): PairedRailCorridorEndpointDescriptor {
	const descriptor = plan.endpoints.find((candidate) => candidate.id === id);
	if (!descriptor) throw new Error(`Paired rail corridor endpoint ${id} is missing.`);
	return descriptor;
}

function materializeTurnback(
	exit: PairedRailCorridorEndpointDescriptor,
	entry: PairedRailCorridorEndpointDescriptor,
	clearanceMeters: number,
): readonly Cell[] {
	if (
		exit.end !== entry.end ||
		exit.flowRole !== "exit" ||
		entry.flowRole !== "entry" ||
		exit.outwardDirection !== entry.outwardDirection
	) {
		throw new Error("Paired rail corridor endpoints do not form a compatible turnback pair.");
	}
	const exitClearance = offsetCell(exit.cell, exit.outwardDirection, clearanceMeters);
	const entryClearance = offsetCell(entry.cell, entry.outwardDirection, clearanceMeters);
	return materializeCardinalPolyline([exit.cell, exitClearance, entryClearance, entry.cell]);
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
		throw new Error("Paired rail corridor turnback segments must remain cardinal.");
	}
	if (start.x === end.x && start.y === end.y) {
		throw new Error("Paired rail corridor turnback segments must have positive length.");
	}
	if (start.x === end.x) return end.y > start.y ? DIR_S : DIR_N;
	return end.x > start.x ? DIR_E : DIR_W;
}

function reverseRoute(route: readonly Cell[]): readonly Cell[] {
	return Object.freeze([...route].reverse());
}

function oppositeFlowRole(role: PairedRailCorridorFlowRole): PairedRailCorridorFlowRole {
	return role === "entry" ? "exit" : "entry";
}

function lateralDirection(forward: Direction, side: RailTemplatePose["side"]): Direction {
	const right =
		forward === DIR_N ? DIR_E : forward === DIR_E ? DIR_S : forward === DIR_S ? DIR_W : DIR_N;
	return side === "right" ? right : oppositeDirection(right);
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

function checksumPlan(plan: Omit<PairedRailCorridorPlan, "fingerprint">): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"PAIRED_RAIL_CORRIDOR",
		plan.kind,
		plan.specification.pose.side,
		plan.specification.pose.flow,
	]);
	checksum.addNumbers([
		plan.specification.version,
		plan.specification.anchor.x,
		plan.specification.anchor.y,
		plan.specification.lengthMeters,
		plan.specification.laneSpacingMeters,
		plan.specification.pose.forward,
		plan.newEdges,
		plan.lengthMeters,
		plan.turns,
	]);
	for (const lane of plan.lanes) {
		checksum.addStrings([lane.id, lane.entryEndpointId, lane.exitEndpointId]);
		checksum.addNumbers([lane.travelDirection, lane.cells.length]);
		for (const cell of lane.cells) checksum.addNumbers([cell.x, cell.y]);
	}
	for (const item of plan.endpoints) {
		checksum.addStrings([
			item.id,
			item.laneId,
			item.end,
			item.flowRole,
			item.gatewayRole,
			item.attachment,
			item.pairedEndpointId,
		]);
		checksum.addNumbers([item.cell.x, item.cell.y, item.travelDirection, item.outwardDirection]);
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
