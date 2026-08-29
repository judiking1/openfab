import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type PairedRailPerimeterTurnbackDescriptor,
	planPairedRailPerimeter,
} from "../core/PairedRailPerimeterPlanner";
import type { RailModuleSide } from "../core/RailModulePlanner";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import type { Cell } from "../core/TileMap";
import type {
	SyntheticFabAssemblyJunctionContract,
	SyntheticFabAssemblyLinkCorridor,
	SyntheticFabAssemblyRunContract,
} from "./SyntheticFabAssemblyPlan";

export const PAIRED_CIRCULATION_FAB_ASSEMBLY_PLAN_VERSION = 2 as const;
export const PAIRED_CIRCULATION_FAB_MINIMUM_BAYS = 48;
export const PAIRED_CIRCULATION_FAB_MAXIMUM_BAYS = 64;
export const PAIRED_CIRCULATION_FAB_BANK_COUNT = 4;
export const PAIRED_CIRCULATION_FAB_MINIMUM_DEPTH_METERS = 80;
export const PAIRED_CIRCULATION_FAB_MAXIMUM_DEPTH_METERS = 120;
export const PAIRED_CIRCULATION_FAB_MINIMUM_FRONTAGE_METERS = 36;
export const PAIRED_CIRCULATION_FAB_MAXIMUM_FRONTAGE_METERS = 60;
export const PAIRED_CIRCULATION_FAB_MINIMUM_PITCH_METERS = 44;
export const PAIRED_CIRCULATION_FAB_MAXIMUM_PITCH_METERS = 80;
export const PAIRED_CIRCULATION_FAB_ENVELOPE_METERS = 2_000;

const OUTER_MARGIN_METERS = 24;
// Outer reversals need an R500 branch/merge throat; four grid cells keep the pair visibly close
// while satisfying the three-meter minimum parallel-lane gap of the gateway grammar.
const OUTER_LANE_SPACING_METERS = 4;
const HALL_GAP_METERS = 32;
// Two 1 m centerlines approximate the prevalent paired AMHS aisle spacing on the authored grid.
const INTERBAY_LANE_SPACING_METERS = 2;
const INTERBAY_GATEWAY_SUPPORT_METERS = 8;
const BANK_END_MARGIN_METERS = 24;
const PROCESS_END_MARGIN_METERS = 4;
const PROCESS_LOOP_GAP_METERS = 4;
const PROCESS_RETURN_CLEARANCE_METERS = 8;
const BAY_GATEWAY_GAP_METERS = 6;

export interface PairedCirculationFabProfile {
	readonly bayCount: number;
	readonly bayDepthMeters: number;
	readonly bayFrontageMeters: number;
	readonly bayPitchMeters: number;
}

export type PairedCirculationFabPose = Readonly<Required<RailTemplatePose>>;
export type PairedCirculationBayVariant = "single-loop" | "twin-loop";

export interface PairedCirculationLoopPlan {
	readonly id: string;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly pose: PairedCirculationFabPose;
}

export interface PairedCirculationCorridorPlan extends PairedCirculationLoopPlan {
	readonly laneSpacingMeters: number;
	readonly laneAFlow: Direction;
	readonly laneBFlow: Direction;
}

export interface PairedCirculationOuterPlan {
	readonly id: string;
	readonly laneSpacingMeters: number;
	readonly plannerFingerprint: string;
	readonly laneA: PairedCirculationLoopPlan;
	readonly laneB: PairedCirculationLoopPlan;
	readonly turnbacks: readonly [
		PairedRailPerimeterTurnbackDescriptor,
		PairedRailPerimeterTurnbackDescriptor,
	];
}

export interface PairedCirculationProcessLoopPlacement {
	readonly id: string;
	readonly anchor: Cell;
	readonly pose: PairedCirculationFabPose;
	readonly spanMeters: number;
	readonly depthMeters: number;
}

export interface PairedCirculationBayPlacement {
	readonly id: string;
	readonly bankId: string;
	readonly side: "north" | "south";
	readonly variant: PairedCirculationBayVariant;
	readonly shellAnchor: Cell;
	readonly shellPose: PairedCirculationFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
	readonly processLoops: readonly PairedCirculationProcessLoopPlacement[];
	readonly gateway: PairedCirculationGatewayPlan;
}

export interface PairedCirculationBankPlan {
	readonly id: string;
	readonly hallIndex: 0 | 1;
	readonly side: PairedCirculationBayPlacement["side"];
	readonly bays: readonly PairedCirculationBayPlacement[];
}

export interface PairedCirculationHallPlan {
	readonly id: string;
	readonly index: 0 | 1;
	readonly interbay: PairedCirculationCorridorPlan;
	readonly banks: readonly [PairedCirculationBankPlan, PairedCirculationBankPlan];
}

export interface PairedCirculationGatewayPlan {
	readonly id: string;
	readonly sourceAnchor: Cell;
	readonly targetAnchor: Cell;
	readonly ownerId: string;
	readonly allowSameComponent: boolean;
	readonly sourceRun: SyntheticFabAssemblyRunContract;
	readonly targetRun: SyntheticFabAssemblyRunContract;
	readonly corridor: SyntheticFabAssemblyLinkCorridor;
	readonly exactJunctions: SyntheticFabAssemblyJunctionContract;
	readonly expectedOutboundTurns: number;
	readonly expectedReturnTurns: number;
}

export interface PairedCirculationFabAssemblyPlan {
	readonly version: typeof PAIRED_CIRCULATION_FAB_ASSEMBLY_PLAN_VERSION;
	readonly id: "paired-circulation-fab-52";
	readonly profile: PairedCirculationFabProfile;
	readonly outer: PairedCirculationOuterPlan;
	readonly halls: readonly [PairedCirculationHallPlan, PairedCirculationHallPlan];
	readonly banks: readonly [
		PairedCirculationBankPlan,
		PairedCirculationBankPlan,
		PairedCirculationBankPlan,
		PairedCirculationBankPlan,
	];
	readonly gateways: readonly PairedCirculationGatewayPlan[];
	readonly planFingerprint: string;
}

/** Independent OpenFab plan for paired outer circulation and shell-owned Process Loops. */
export function createPairedCirculationFabAssemblyPlan(
	profile: PairedCirculationFabProfile,
): PairedCirculationFabAssemblyPlan {
	assertProfile(profile);
	const baysPerBank = profile.bayCount / PAIRED_CIRCULATION_FAB_BANK_COUNT;
	const corridorLengthMeters =
		BANK_END_MARGIN_METERS * 2 +
		Math.max(0, baysPerBank - 1) * profile.bayPitchMeters +
		profile.bayFrontageMeters;
	const hallHeightMeters =
		(profile.bayDepthMeters + BAY_GATEWAY_GAP_METERS) * 2 + INTERBAY_LANE_SPACING_METERS;
	const fabWidthMeters = OUTER_MARGIN_METERS * 2 + corridorLengthMeters;
	const fabHeightMeters = OUTER_MARGIN_METERS * 2 + hallHeightMeters * 2 + HALL_GAP_METERS;
	if (
		fabWidthMeters > PAIRED_CIRCULATION_FAB_ENVELOPE_METERS ||
		fabHeightMeters > PAIRED_CIRCULATION_FAB_ENVELOPE_METERS
	) {
		throw new RangeError("Paired-circulation FAB exceeds the supported 2 km envelope.");
	}

	const corridorX = OUTER_MARGIN_METERS;
	let nextBayOrdinal = 1;
	const hallPlans = ([0, 1] as const).map((hallIndex) => {
		const hallTopY = OUTER_MARGIN_METERS + hallIndex * (hallHeightMeters + HALL_GAP_METERS);
		const corridorY = hallTopY + profile.bayDepthMeters + BAY_GATEWAY_GAP_METERS;
		const hallId = `PAIRED-HALL-${hallIndex + 1}`;
		const interbay = corridorPlan(
			`${hallId}-INTERBAY`,
			{ x: corridorX, y: corridorY },
			corridorLengthMeters,
			INTERBAY_LANE_SPACING_METERS,
		);
		const northBank = bankPlan(
			`${hallId}-NORTH-BANK`,
			interbay.id,
			hallIndex,
			"north",
			baysPerBank,
			corridorX + BANK_END_MARGIN_METERS,
			corridorY,
			profile,
			() => nextBayOrdinal++,
		);
		const southBank = bankPlan(
			`${hallId}-SOUTH-BANK`,
			interbay.id,
			hallIndex,
			"south",
			baysPerBank,
			corridorX + BANK_END_MARGIN_METERS,
			corridorY + INTERBAY_LANE_SPACING_METERS,
			profile,
			() => nextBayOrdinal++,
		);
		return Object.freeze({
			id: hallId,
			index: hallIndex,
			interbay,
			banks: Object.freeze([northBank, southBank]) as readonly [
				PairedCirculationBankPlan,
				PairedCirculationBankPlan,
			],
		});
	});
	const halls = Object.freeze(hallPlans) as readonly [
		PairedCirculationHallPlan,
		PairedCirculationHallPlan,
	];
	const banks = Object.freeze(halls.flatMap((hall) => hall.banks)) as readonly [
		PairedCirculationBankPlan,
		PairedCirculationBankPlan,
		PairedCirculationBankPlan,
		PairedCirculationBankPlan,
	];
	const pairedOuter = planPairedRailPerimeter({
		anchor: { x: 0, y: 0 },
		forwardSpanMeters: fabWidthMeters,
		sideSpanMeters: fabHeightMeters,
		laneSpacingMeters: OUTER_LANE_SPACING_METERS,
		pose: { forward: DIR_E, side: "right", flow: "forward" },
	});
	const outerLaneA = loopPlan(
		"FAB-OUTER-LANE-A",
		pairedOuter.lanes[0].corners[0],
		fabWidthMeters,
		fabHeightMeters,
		"forward",
	);
	const outerLaneB = loopPlan(
		"FAB-OUTER-LANE-B",
		pairedOuter.lanes[1].corners[0],
		fabWidthMeters - OUTER_LANE_SPACING_METERS * 2,
		fabHeightMeters - OUTER_LANE_SPACING_METERS * 2,
		"reverse",
	);
	const hallGateways = halls.flatMap((hall) => {
		const corridorMinX = hall.interbay.origin.x;
		const corridorMaxX = hall.interbay.origin.x + hall.interbay.lengthMeters;
		const westTarget = {
			x: hall.interbay.origin.x + INTERBAY_GATEWAY_SUPPORT_METERS,
			y: hall.interbay.origin.y,
		};
		const eastTarget = {
			x: hall.interbay.origin.x + hall.interbay.lengthMeters - INTERBAY_GATEWAY_SUPPORT_METERS,
			y: hall.interbay.origin.y + hall.interbay.depthMeters,
		};
		return [
			gateway(
				`${hall.id}-WEST-OUTER-GATEWAY`,
				{ x: outerLaneB.origin.x, y: hall.interbay.origin.y },
				westTarget,
				hall.id,
				false,
				runContract(
					`${outerLaneB.id}:WEST`,
					outerLaneB.id,
					"west",
					"y",
					outerLaneB.origin.x,
					OUTER_LANE_SPACING_METERS,
					fabHeightMeters - OUTER_LANE_SPACING_METERS,
					DIR_S,
					{ x: outerLaneB.origin.x, y: hall.interbay.origin.y },
				),
				runContract(
					`${hall.interbay.id}:PRIMARY`,
					hall.interbay.id,
					"north",
					"x",
					hall.interbay.origin.y,
					corridorMinX,
					corridorMaxX,
					DIR_E,
					westTarget,
				),
				corridor(
					outerLaneB.origin.x,
					hall.interbay.origin.y - 8,
					westTarget.x + 8,
					hall.interbay.origin.y,
				),
				junctions(
					{ x: outerLaneB.origin.x, y: hall.interbay.origin.y },
					{ x: outerLaneB.origin.x, y: hall.interbay.origin.y - 8 },
					westTarget,
					{ x: westTarget.x + 8, y: westTarget.y },
				),
				0,
				1,
			),
			gateway(
				`${hall.id}-EAST-INNER-GATEWAY`,
				{
					x: outerLaneB.origin.x + outerLaneB.lengthMeters,
					y: hall.interbay.origin.y + hall.interbay.depthMeters,
				},
				eastTarget,
				hall.id,
				true,
				runContract(
					`${outerLaneB.id}:EAST`,
					outerLaneB.id,
					"east",
					"y",
					outerLaneB.origin.x + outerLaneB.lengthMeters,
					OUTER_LANE_SPACING_METERS,
					fabHeightMeters - OUTER_LANE_SPACING_METERS,
					DIR_N,
					{
						x: outerLaneB.origin.x + outerLaneB.lengthMeters,
						y: hall.interbay.origin.y + hall.interbay.depthMeters,
					},
				),
				runContract(
					`${hall.interbay.id}:SECONDARY`,
					hall.interbay.id,
					"south",
					"x",
					hall.interbay.origin.y + hall.interbay.depthMeters,
					corridorMinX,
					corridorMaxX,
					DIR_W,
					eastTarget,
				),
				corridor(
					eastTarget.x - 8,
					eastTarget.y - 12,
					outerLaneB.origin.x + outerLaneB.lengthMeters,
					eastTarget.y + 12,
				),
				junctions(
					{
						x: outerLaneB.origin.x + outerLaneB.lengthMeters,
						y: eastTarget.y,
					},
					{
						x: outerLaneB.origin.x + outerLaneB.lengthMeters,
						y: eastTarget.y + 8,
					},
					eastTarget,
					{ x: eastTarget.x - 8, y: eastTarget.y },
				),
				0,
				1,
			),
		];
	});
	const gateways = Object.freeze(hallGateways);
	const withoutFingerprint = Object.freeze({
		version: PAIRED_CIRCULATION_FAB_ASSEMBLY_PLAN_VERSION,
		id: "paired-circulation-fab-52" as const,
		profile: Object.freeze({ ...profile }),
		outer: Object.freeze({
			id: "FAB-PAIRED-OUTER-CIRCULATION",
			laneSpacingMeters: OUTER_LANE_SPACING_METERS,
			plannerFingerprint: pairedOuter.fingerprint,
			laneA: outerLaneA,
			laneB: outerLaneB,
			turnbacks: pairedOuter.turnbacks,
		}),
		halls,
		banks,
		gateways,
	});
	return Object.freeze({
		...withoutFingerprint,
		planFingerprint: pairedCirculationPlanFingerprint(withoutFingerprint),
	});
}

export function pairedCirculationFabMinimumPitchMeters(frontageMeters: number): number {
	if (
		!Number.isSafeInteger(frontageMeters) ||
		frontageMeters < PAIRED_CIRCULATION_FAB_MINIMUM_FRONTAGE_METERS ||
		frontageMeters > PAIRED_CIRCULATION_FAB_MAXIMUM_FRONTAGE_METERS ||
		frontageMeters % 4 !== 0
	) {
		throw new RangeError("Paired-circulation Bay frontage must be a valid 4 m step.");
	}
	return Math.max(PAIRED_CIRCULATION_FAB_MINIMUM_PITCH_METERS, frontageMeters + 8);
}

function assertProfile(profile: PairedCirculationFabProfile): void {
	if (
		!Number.isSafeInteger(profile.bayCount) ||
		profile.bayCount < PAIRED_CIRCULATION_FAB_MINIMUM_BAYS ||
		profile.bayCount > PAIRED_CIRCULATION_FAB_MAXIMUM_BAYS ||
		profile.bayCount % PAIRED_CIRCULATION_FAB_BANK_COUNT !== 0
	) {
		throw new RangeError("Paired-circulation Bay count must be 48-64 and divisible by four.");
	}
	if (
		!Number.isSafeInteger(profile.bayDepthMeters) ||
		profile.bayDepthMeters < PAIRED_CIRCULATION_FAB_MINIMUM_DEPTH_METERS ||
		profile.bayDepthMeters > PAIRED_CIRCULATION_FAB_MAXIMUM_DEPTH_METERS ||
		profile.bayDepthMeters % 4 !== 0
	) {
		throw new RangeError("Paired-circulation Bay depth must be 80-120 m in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayFrontageMeters) ||
		profile.bayFrontageMeters < PAIRED_CIRCULATION_FAB_MINIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters > PAIRED_CIRCULATION_FAB_MAXIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters % 4 !== 0
	) {
		throw new RangeError("Paired-circulation Bay frontage must be 36-60 m in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayPitchMeters) ||
		profile.bayPitchMeters < pairedCirculationFabMinimumPitchMeters(profile.bayFrontageMeters) ||
		profile.bayPitchMeters > PAIRED_CIRCULATION_FAB_MAXIMUM_PITCH_METERS ||
		profile.bayPitchMeters % 4 !== 0
	) {
		throw new RangeError("Paired-circulation Bay pitch must preserve an 8 m service gap.");
	}
}

function bankPlan(
	id: string,
	interbayId: string,
	hallIndex: 0 | 1,
	side: PairedCirculationBayPlacement["side"],
	bayCount: number,
	firstBayX: number,
	baselineY: number,
	profile: PairedCirculationFabProfile,
	nextOrdinal: () => number,
): PairedCirculationBankPlan {
	const shellPose = Object.freeze(
		side === "north"
			? { forward: DIR_N, side: "left", flow: "forward" }
			: { forward: DIR_S, side: "left", flow: "forward" },
	) satisfies PairedCirculationFabPose;
	const bays = Array.from({ length: bayCount }, (_, index) => {
		const ordinal = nextOrdinal();
		const leftX = firstBayX + index * profile.bayPitchMeters;
		const shellAnchor =
			side === "north"
				? {
						x: leftX + profile.bayFrontageMeters,
						y: baselineY - BAY_GATEWAY_GAP_METERS,
					}
				: { x: leftX, y: baselineY + BAY_GATEWAY_GAP_METERS };
		return bayPlacement(ordinal, id, interbayId, side, shellAnchor, shellPose, baselineY, profile);
	});
	return Object.freeze({ id, hallIndex, side, bays: Object.freeze(bays) });
}

function bayPlacement(
	ordinal: number,
	bankId: string,
	interbayId: string,
	side: PairedCirculationBayPlacement["side"],
	shellAnchor: Cell,
	shellPose: PairedCirculationFabPose,
	interbayY: number,
	profile: PairedCirculationFabProfile,
): PairedCirculationBayPlacement {
	const variant: PairedCirculationBayVariant = ordinal % 3 === 0 ? "single-loop" : "twin-loop";
	const id = `PAIRED-BAY-${String(ordinal).padStart(3, "0")}`;
	const processPose = shellPose;
	const availableSpan =
		profile.bayDepthMeters -
		PROCESS_END_MARGIN_METERS * 2 -
		(variant === "twin-loop" ? PROCESS_LOOP_GAP_METERS : 0);
	const spans =
		variant === "single-loop"
			? [availableSpan]
			: [Math.floor(availableSpan / 2), availableSpan - Math.floor(availableSpan / 2)];
	let cursor = PROCESS_END_MARGIN_METERS;
	const processLoops = spans.map((spanMeters, index) => {
		const anchor = moveAlong(shellAnchor, shellPose.forward, cursor);
		cursor += spanMeters + PROCESS_LOOP_GAP_METERS;
		return Object.freeze({
			id: `${id}-PROCESS-LOOP-${String(index + 1).padStart(2, "0")}`,
			anchor: Object.freeze(anchor),
			pose: processPose,
			spanMeters,
			depthMeters: profile.bayFrontageMeters - PROCESS_RETURN_CLEARANCE_METERS,
		});
	});
	const gatewayTargetAnchor = moveSide(
		shellAnchor,
		shellPose.forward,
		shellPose.side,
		Math.floor(profile.bayFrontageMeters / 2),
	);
	const gatewaySourceAnchor = Object.freeze({
		x: gatewayTargetAnchor.x,
		y: interbayY,
	});
	const runDirection = side === "north" ? DIR_E : DIR_W;
	const runOffset = runDirection === DIR_E ? 8 : -8;
	const bayRunMinimum = gatewayTargetAnchor.x - Math.floor(profile.bayFrontageMeters / 2);
	const bayRunMaximum = gatewayTargetAnchor.x + Math.floor(profile.bayFrontageMeters / 2);
	return Object.freeze({
		id,
		bankId,
		side,
		variant,
		shellAnchor: Object.freeze({ ...shellAnchor }),
		shellPose,
		frontageMeters: profile.bayFrontageMeters,
		depthMeters: profile.bayDepthMeters,
		processLoops: Object.freeze(processLoops),
		gateway: gateway(
			`${id}-INTERBAY-GATEWAY`,
			gatewaySourceAnchor,
			gatewayTargetAnchor,
			id,
			false,
			runContract(
				`${interbayId}:${side === "north" ? "PRIMARY" : "SECONDARY"}`,
				interbayId,
				side,
				"x",
				interbayY,
				OUTER_MARGIN_METERS,
				OUTER_MARGIN_METERS +
					BANK_END_MARGIN_METERS * 2 +
					Math.max(0, profile.bayCount / PAIRED_CIRCULATION_FAB_BANK_COUNT - 1) *
						profile.bayPitchMeters +
					profile.bayFrontageMeters,
				runDirection,
				gatewaySourceAnchor,
			),
			runContract(
				`${id}:SHELL:${side === "north" ? "SOUTH" : "NORTH"}`,
				id,
				side === "north" ? "south" : "north",
				"x",
				gatewayTargetAnchor.y,
				bayRunMinimum,
				bayRunMaximum,
				runDirection,
				gatewayTargetAnchor,
			),
			corridor(
				Math.min(gatewaySourceAnchor.x, gatewaySourceAnchor.x + runOffset),
				Math.min(gatewaySourceAnchor.y, gatewayTargetAnchor.y),
				Math.max(gatewaySourceAnchor.x, gatewaySourceAnchor.x + runOffset),
				Math.max(gatewaySourceAnchor.y, gatewayTargetAnchor.y),
			),
			junctions(
				gatewaySourceAnchor,
				{ x: gatewaySourceAnchor.x + runOffset, y: gatewaySourceAnchor.y },
				gatewayTargetAnchor,
				{ x: gatewayTargetAnchor.x + runOffset, y: gatewayTargetAnchor.y },
			),
			0,
			0,
		),
	});
}

function corridorPlan(
	id: string,
	origin: Cell,
	lengthMeters: number,
	laneSpacingMeters: number,
): PairedCirculationCorridorPlan {
	return Object.freeze({
		...loopPlan(id, origin, lengthMeters, laneSpacingMeters, "forward"),
		laneSpacingMeters,
		laneAFlow: DIR_E,
		laneBFlow: DIR_W,
	});
}

function loopPlan(
	id: string,
	origin: Cell,
	lengthMeters: number,
	depthMeters: number,
	flow: "forward" | "reverse",
): PairedCirculationLoopPlan {
	return Object.freeze({
		id,
		origin: Object.freeze({ ...origin }),
		lengthMeters,
		depthMeters,
		pose: Object.freeze({ forward: DIR_E, side: "right", flow }),
	});
}

function gateway(
	id: string,
	sourceAnchor: Cell,
	targetAnchor: Cell,
	ownerId: string,
	allowSameComponent: boolean,
	sourceRun: SyntheticFabAssemblyRunContract,
	targetRun: SyntheticFabAssemblyRunContract,
	linkCorridor: SyntheticFabAssemblyLinkCorridor,
	exactJunctions: SyntheticFabAssemblyJunctionContract,
	expectedOutboundTurns: number,
	expectedReturnTurns: number,
): PairedCirculationGatewayPlan {
	return Object.freeze({
		id,
		sourceAnchor: Object.freeze({ ...sourceAnchor }),
		targetAnchor: Object.freeze({ ...targetAnchor }),
		ownerId,
		allowSameComponent,
		sourceRun,
		targetRun,
		corridor: linkCorridor,
		exactJunctions,
		expectedOutboundTurns,
		expectedReturnTurns,
	});
}

function runContract(
	id: string,
	ownerId: string,
	side: SyntheticFabAssemblyRunContract["side"],
	axis: SyntheticFabAssemblyRunContract["axis"],
	fixedCoordinate: number,
	minimum: number,
	maximum: number,
	flowDirection: Direction,
	anchor: Cell,
): SyntheticFabAssemblyRunContract {
	return Object.freeze({
		id,
		ownerId,
		side,
		anchor: Object.freeze({ ...anchor }),
		axis,
		fixedCoordinate,
		minimum,
		maximum,
		flowDirection,
	});
}

function corridor(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): SyntheticFabAssemblyLinkCorridor {
	return Object.freeze({ minX, minY, maxX, maxY });
}

function junctions(
	sourceDeparture: Cell,
	sourceArrival: Cell,
	targetArrival: Cell,
	targetDeparture: Cell,
): SyntheticFabAssemblyJunctionContract {
	return Object.freeze({
		sourceDeparture: Object.freeze({ ...sourceDeparture }),
		sourceArrival: Object.freeze({ ...sourceArrival }),
		targetArrival: Object.freeze({ ...targetArrival }),
		targetDeparture: Object.freeze({ ...targetDeparture }),
	});
}

function moveAlong(anchor: Cell, direction: Direction, distance: number): Cell {
	return {
		x: anchor.x + (direction === DIR_E ? distance : direction === DIR_W ? -distance : 0),
		y: anchor.y + (direction === DIR_S ? distance : direction === DIR_N ? -distance : 0),
	};
}

function moveSide(anchor: Cell, forward: Direction, side: RailModuleSide, distance: number): Cell {
	const direction =
		forward === DIR_E
			? side === "left"
				? DIR_N
				: DIR_S
			: forward === DIR_W
				? side === "left"
					? DIR_S
					: DIR_N
				: forward === DIR_N
					? side === "left"
						? DIR_W
						: DIR_E
					: side === "left"
						? DIR_E
						: DIR_W;
	return moveAlong(anchor, direction, distance);
}

function pairedCirculationPlanFingerprint(
	plan: Omit<PairedCirculationFabAssemblyPlan, "planFingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.id,
		plan.outer.id,
		plan.outer.plannerFingerprint,
		plan.outer.laneA.id,
		plan.outer.laneB.id,
		...plan.halls.flatMap((hall) => [hall.id, hall.interbay.id]),
		...plan.banks.flatMap((bank) => [
			bank.id,
			bank.side,
			...bank.bays.flatMap((bay) => [
				bay.id,
				bay.variant,
				...gatewayStrings(bay.gateway),
				...bay.processLoops.map((loop) => loop.id),
			]),
		]),
		...plan.gateways.flatMap((item) => gatewayStrings(item)),
	]);
	checksum.addNumbers([
		plan.version,
		plan.profile.bayCount,
		plan.profile.bayDepthMeters,
		plan.profile.bayFrontageMeters,
		plan.profile.bayPitchMeters,
		plan.outer.laneSpacingMeters,
		...loopNumbers(plan.outer.laneA),
		...loopNumbers(plan.outer.laneB),
		...plan.halls.flatMap((hall) => [
			...loopNumbers(hall.interbay),
			hall.interbay.laneAFlow,
			hall.interbay.laneBFlow,
		]),
		...plan.banks.flatMap((bank) =>
			bank.bays.flatMap((bay) => [
				bay.shellAnchor.x,
				bay.shellAnchor.y,
				...poseNumbers(bay.shellPose),
				bay.frontageMeters,
				bay.depthMeters,
				...gatewayNumbers(bay.gateway),
				...bay.processLoops.flatMap((loop) => [
					loop.anchor.x,
					loop.anchor.y,
					...poseNumbers(loop.pose),
					loop.spanMeters,
					loop.depthMeters,
				]),
			]),
		),
		...plan.gateways.flatMap((item) => gatewayNumbers(item)),
	]);
	return checksum.digest();
}

function gatewayStrings(gateway: PairedCirculationGatewayPlan): readonly string[] {
	return [
		gateway.id,
		gateway.ownerId,
		gateway.sourceRun.id,
		gateway.sourceRun.ownerId,
		gateway.sourceRun.side,
		gateway.targetRun.id,
		gateway.targetRun.ownerId,
		gateway.targetRun.side,
	];
}

function gatewayNumbers(gateway: PairedCirculationGatewayPlan): readonly number[] {
	return [
		gateway.sourceAnchor.x,
		gateway.sourceAnchor.y,
		gateway.targetAnchor.x,
		gateway.targetAnchor.y,
		gateway.allowSameComponent ? 1 : 0,
		...runNumbers(gateway.sourceRun),
		...runNumbers(gateway.targetRun),
		gateway.corridor.minX,
		gateway.corridor.minY,
		gateway.corridor.maxX,
		gateway.corridor.maxY,
		...(gateway.exactJunctions
			? [
					gateway.exactJunctions.sourceDeparture.x,
					gateway.exactJunctions.sourceDeparture.y,
					gateway.exactJunctions.sourceArrival.x,
					gateway.exactJunctions.sourceArrival.y,
					gateway.exactJunctions.targetArrival.x,
					gateway.exactJunctions.targetArrival.y,
					gateway.exactJunctions.targetDeparture.x,
					gateway.exactJunctions.targetDeparture.y,
				]
			: [-1]),
		gateway.expectedOutboundTurns ?? -1,
		gateway.expectedReturnTurns ?? -1,
	];
}

function runNumbers(run: SyntheticFabAssemblyRunContract): readonly number[] {
	return [
		run.anchor.x,
		run.anchor.y,
		run.axis === "x" ? 1 : 0,
		run.fixedCoordinate,
		run.minimum,
		run.maximum,
		run.flowDirection,
	];
}

function loopNumbers(loop: PairedCirculationLoopPlan): readonly number[] {
	return [
		loop.origin.x,
		loop.origin.y,
		loop.lengthMeters,
		loop.depthMeters,
		...poseNumbers(loop.pose),
	];
}

function poseNumbers(pose: PairedCirculationFabPose): readonly number[] {
	return [pose.forward, pose.side === "right" ? 1 : 0, pose.flow === "reverse" ? 1 : 0];
}
