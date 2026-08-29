import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_W } from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const PARALLEL_HALL_FAB_ASSEMBLY_PLAN_VERSION = 1 as const;
export const PARALLEL_HALL_FAB_MINIMUM_BAYS = 8;
export const PARALLEL_HALL_FAB_MAXIMUM_BAYS = 20;
export const PARALLEL_HALL_FAB_MINIMUM_DEPTH_METERS = 80;
export const PARALLEL_HALL_FAB_MAXIMUM_DEPTH_METERS = 120;
export const PARALLEL_HALL_FAB_MINIMUM_FRONTAGE_METERS = 36;
export const PARALLEL_HALL_FAB_MAXIMUM_FRONTAGE_METERS = 60;
export const PARALLEL_HALL_FAB_MINIMUM_PITCH_METERS = 40;
export const PARALLEL_HALL_FAB_MAXIMUM_PITCH_METERS = 76;
export const PARALLEL_HALL_FAB_ASSEMBLY_ENVELOPE_METERS = 2_000;

const OUTER_MARGIN_METERS = 24;
const BANK_END_MARGIN_METERS = 8;
const BANK_COLLECTOR_DEPTH_METERS = 12;
const COLLECTOR_SPINE_GAP_METERS = 8;
const INTERBAY_SPINE_DEPTH_METERS = 20;
const PROCESS_LOOP_FRONT_MARGIN_METERS = 4;
const PROCESS_LOOP_GAP_METERS = 4;
const PROCESS_LOOP_DEPTH_INSET_METERS = 8;

export interface ParallelHallFabProfile {
	readonly bayCount: number;
	readonly bayDepthMeters: number;
	readonly bayFrontageMeters: number;
	readonly bayPitchMeters: number;
}

export type ParallelHallFabPose = Readonly<Required<RailTemplatePose>>;

export interface ParallelHallFabLoopPlan {
	readonly id: string;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly pose: ParallelHallFabPose;
}

export interface ParallelHallFabProcessLoopPlacement {
	readonly id: string;
	readonly anchor: Cell;
	readonly pose: ParallelHallFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
}

export interface ParallelHallFabBayPlacement {
	readonly id: string;
	readonly bankId: string;
	readonly side: "north" | "south";
	readonly anchor: Cell;
	readonly pose: ParallelHallFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
	readonly processLoops: readonly ParallelHallFabProcessLoopPlacement[];
}

export interface ParallelHallFabBankPlan {
	readonly id: string;
	readonly side: ParallelHallFabBayPlacement["side"];
	readonly collector: ParallelHallFabLoopPlan;
	readonly bays: readonly ParallelHallFabBayPlacement[];
}

export interface ParallelHallFabGatewayPlan {
	readonly id: string;
	readonly sourceAnchor: Cell;
	readonly targetAnchor: Cell;
	readonly ownerId: string;
}

export interface ParallelHallFabAssemblyPlan {
	readonly version: typeof PARALLEL_HALL_FAB_ASSEMBLY_PLAN_VERSION;
	readonly id: "parallel-hall-fab-12";
	readonly profile: ParallelHallFabProfile;
	readonly outer: ParallelHallFabLoopPlan;
	readonly interbaySpine: ParallelHallFabLoopPlan;
	readonly banks: readonly [ParallelHallFabBankPlan, ParallelHallFabBankPlan];
	readonly gateways: readonly ParallelHallFabGatewayPlan[];
	readonly planFingerprint: string;
}

/**
 * Public-safe production-hall grammar with separate outer, interbay, collector, Bay, and Process
 * Loop layers. All dimensions come from the OpenFab 1 m modular construction grammar.
 */
export function createParallelHallFabAssemblyPlan(
	profile: ParallelHallFabProfile,
): ParallelHallFabAssemblyPlan {
	assertParallelHallFabProfile(profile);
	const baysPerBank = profile.bayCount / 2;
	const collectorLengthMeters =
		BANK_END_MARGIN_METERS * 2 +
		Math.max(0, baysPerBank - 1) * profile.bayPitchMeters +
		profile.bayFrontageMeters;
	const fabWidthMeters = OUTER_MARGIN_METERS * 2 + collectorLengthMeters;
	const northCollectorY = OUTER_MARGIN_METERS + profile.bayDepthMeters;
	const spineY = northCollectorY + BANK_COLLECTOR_DEPTH_METERS + COLLECTOR_SPINE_GAP_METERS;
	const southCollectorY = spineY + INTERBAY_SPINE_DEPTH_METERS + COLLECTOR_SPINE_GAP_METERS;
	const fabHeightMeters =
		southCollectorY + BANK_COLLECTOR_DEPTH_METERS + profile.bayDepthMeters + OUTER_MARGIN_METERS;
	if (
		fabWidthMeters > PARALLEL_HALL_FAB_ASSEMBLY_ENVELOPE_METERS ||
		fabHeightMeters > PARALLEL_HALL_FAB_ASSEMBLY_ENVELOPE_METERS
	) {
		throw new RangeError("Parallel-hall FAB dimensions exceed the supported 2 km envelope.");
	}

	const collectorX = OUTER_MARGIN_METERS;
	const northCollector = loopPlan(
		"NORTH-BANK-COLLECTOR",
		{ x: collectorX, y: northCollectorY },
		collectorLengthMeters,
		BANK_COLLECTOR_DEPTH_METERS,
	);
	const southCollector = loopPlan(
		"SOUTH-BANK-COLLECTOR",
		{ x: collectorX, y: southCollectorY },
		collectorLengthMeters,
		BANK_COLLECTOR_DEPTH_METERS,
	);
	const northBank = bankPlan(
		"NORTH-BAY-BANK",
		"north",
		baysPerBank,
		collectorX + BANK_END_MARGIN_METERS,
		northCollectorY,
		profile,
		1,
		northCollector,
	);
	const southBank = bankPlan(
		"SOUTH-BAY-BANK",
		"south",
		baysPerBank,
		collectorX + BANK_END_MARGIN_METERS,
		southCollectorY + BANK_COLLECTOR_DEPTH_METERS,
		profile,
		baysPerBank + 1,
		southCollector,
	);
	const middleX = collectorX + Math.floor(collectorLengthMeters / 2);
	const middleY = spineY + Math.floor(INTERBAY_SPINE_DEPTH_METERS / 2);
	const gateways = Object.freeze([
		gateway(
			"WEST-OUTER-GATEWAY",
			{ x: 0, y: middleY },
			{ x: collectorX, y: middleY },
			"PARALLEL-HALL-FAB",
		),
		gateway(
			"EAST-OUTER-GATEWAY",
			{ x: collectorX + collectorLengthMeters, y: middleY },
			{ x: fabWidthMeters, y: middleY },
			"PARALLEL-HALL-FAB",
		),
		gateway(
			"NORTH-COLLECTOR-GATEWAY",
			{ x: middleX, y: northCollectorY + BANK_COLLECTOR_DEPTH_METERS },
			{ x: middleX, y: spineY },
			"NORTH-BAY-BANK",
		),
		gateway(
			"SOUTH-COLLECTOR-GATEWAY",
			{ x: middleX, y: spineY + INTERBAY_SPINE_DEPTH_METERS },
			{ x: middleX, y: southCollectorY },
			"SOUTH-BAY-BANK",
		),
	]);
	const withoutFingerprint = Object.freeze({
		version: PARALLEL_HALL_FAB_ASSEMBLY_PLAN_VERSION,
		id: "parallel-hall-fab-12" as const,
		profile: Object.freeze({ ...profile }),
		outer: loopPlan("FAB-OUTER-CIRCULATION", { x: 0, y: 0 }, fabWidthMeters, fabHeightMeters),
		interbaySpine: loopPlan(
			"FAB-CENTRAL-INTERBAY",
			{ x: collectorX, y: spineY },
			collectorLengthMeters,
			INTERBAY_SPINE_DEPTH_METERS,
		),
		banks: Object.freeze([northBank, southBank]) as readonly [
			ParallelHallFabBankPlan,
			ParallelHallFabBankPlan,
		],
		gateways,
	});
	return Object.freeze({
		...withoutFingerprint,
		planFingerprint: parallelHallFabPlanFingerprint(withoutFingerprint),
	});
}

export function parallelHallFabMinimumPitchMeters(frontageMeters: number): number {
	if (
		!Number.isSafeInteger(frontageMeters) ||
		frontageMeters < PARALLEL_HALL_FAB_MINIMUM_FRONTAGE_METERS ||
		frontageMeters > PARALLEL_HALL_FAB_MAXIMUM_FRONTAGE_METERS ||
		frontageMeters % 4 !== 0
	) {
		throw new RangeError("Parallel-hall FAB frontage must be valid before sizing pitch.");
	}
	return Math.max(PARALLEL_HALL_FAB_MINIMUM_PITCH_METERS, frontageMeters + 4);
}

function assertParallelHallFabProfile(profile: ParallelHallFabProfile): void {
	if (
		!Number.isSafeInteger(profile.bayCount) ||
		profile.bayCount < PARALLEL_HALL_FAB_MINIMUM_BAYS ||
		profile.bayCount > PARALLEL_HALL_FAB_MAXIMUM_BAYS ||
		profile.bayCount % 2 !== 0
	) {
		throw new RangeError("Parallel-hall FAB Bay count must be an even 8-20 integer.");
	}
	if (
		!Number.isSafeInteger(profile.bayDepthMeters) ||
		profile.bayDepthMeters < PARALLEL_HALL_FAB_MINIMUM_DEPTH_METERS ||
		profile.bayDepthMeters > PARALLEL_HALL_FAB_MAXIMUM_DEPTH_METERS ||
		profile.bayDepthMeters % 4 !== 0
	) {
		throw new RangeError("Parallel-hall FAB Bay depth must be an 80-120 m integer in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayFrontageMeters) ||
		profile.bayFrontageMeters < PARALLEL_HALL_FAB_MINIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters > PARALLEL_HALL_FAB_MAXIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters % 4 !== 0
	) {
		throw new RangeError("Parallel-hall FAB Bay frontage must be a 36-60 m integer in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayPitchMeters) ||
		profile.bayPitchMeters < parallelHallFabMinimumPitchMeters(profile.bayFrontageMeters) ||
		profile.bayPitchMeters > PARALLEL_HALL_FAB_MAXIMUM_PITCH_METERS ||
		profile.bayPitchMeters % 4 !== 0
	) {
		throw new RangeError("Parallel-hall FAB Bay pitch must preserve at least 4 m between Bays.");
	}
}

function bankPlan(
	id: string,
	side: ParallelHallFabBankPlan["side"],
	bayCount: number,
	firstBayX: number,
	baselineY: number,
	profile: ParallelHallFabProfile,
	firstOrdinal: number,
	collector: ParallelHallFabLoopPlan,
): ParallelHallFabBankPlan {
	const pose = Object.freeze(
		side === "north"
			? { forward: DIR_E, side: "left", flow: "forward" }
			: { forward: DIR_W, side: "left", flow: "forward" },
	) satisfies ParallelHallFabPose;
	const bays = Array.from({ length: bayCount }, (_, index) => {
		const leftX = firstBayX + index * profile.bayPitchMeters;
		const anchor =
			side === "north"
				? { x: leftX, y: baselineY }
				: { x: leftX + profile.bayFrontageMeters, y: baselineY };
		return bayPlacement(firstOrdinal + index, id, side, anchor, pose, profile);
	});
	return Object.freeze({ id, side, collector, bays: Object.freeze(bays) });
}

function bayPlacement(
	ordinal: number,
	bankId: string,
	side: ParallelHallFabBayPlacement["side"],
	anchor: Cell,
	pose: ParallelHallFabPose,
	profile: ParallelHallFabProfile,
): ParallelHallFabBayPlacement {
	const usableFrontage =
		profile.bayFrontageMeters - PROCESS_LOOP_FRONT_MARGIN_METERS * 2 - PROCESS_LOOP_GAP_METERS;
	const firstFrontage = Math.floor(usableFrontage / 2);
	const secondFrontage = usableFrontage - firstFrontage;
	const processDepth = profile.bayDepthMeters - PROCESS_LOOP_DEPTH_INSET_METERS;
	const id = `BAY-${String(ordinal).padStart(3, "0")}`;
	const firstAnchor = moveAlong(anchor, pose.forward, PROCESS_LOOP_FRONT_MARGIN_METERS);
	const secondAnchor = moveAlong(
		anchor,
		pose.forward,
		PROCESS_LOOP_FRONT_MARGIN_METERS + firstFrontage + PROCESS_LOOP_GAP_METERS,
	);
	return Object.freeze({
		id,
		bankId,
		side,
		anchor: Object.freeze({ ...anchor }),
		pose,
		frontageMeters: profile.bayFrontageMeters,
		depthMeters: profile.bayDepthMeters,
		processLoops: Object.freeze([
			processLoop(`${id}-PROCESS-LOOP-01`, firstAnchor, pose, firstFrontage, processDepth),
			processLoop(`${id}-PROCESS-LOOP-02`, secondAnchor, pose, secondFrontage, processDepth),
		]),
	});
}

function processLoop(
	id: string,
	anchor: Cell,
	pose: ParallelHallFabPose,
	frontageMeters: number,
	depthMeters: number,
): ParallelHallFabProcessLoopPlacement {
	return Object.freeze({
		id,
		anchor: Object.freeze({ ...anchor }),
		pose,
		frontageMeters,
		depthMeters,
	});
}

function loopPlan(
	id: string,
	origin: Cell,
	lengthMeters: number,
	depthMeters: number,
): ParallelHallFabLoopPlan {
	return Object.freeze({
		id,
		origin: Object.freeze({ ...origin }),
		lengthMeters,
		depthMeters,
		pose: Object.freeze({ forward: DIR_E, side: "right", flow: "forward" }),
	});
}

function gateway(
	id: string,
	sourceAnchor: Cell,
	targetAnchor: Cell,
	ownerId: string,
): ParallelHallFabGatewayPlan {
	return Object.freeze({
		id,
		sourceAnchor: Object.freeze({ ...sourceAnchor }),
		targetAnchor: Object.freeze({ ...targetAnchor }),
		ownerId,
	});
}

function moveAlong(anchor: Cell, direction: number, distance: number): Cell {
	return Object.freeze({
		x: anchor.x + (direction === DIR_E ? distance : direction === DIR_W ? -distance : 0),
		y: anchor.y,
	});
}

function parallelHallFabPlanFingerprint(
	plan: Omit<ParallelHallFabAssemblyPlan, "planFingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.id,
		plan.outer.id,
		plan.interbaySpine.id,
		...plan.banks.flatMap((bank) => [
			bank.id,
			bank.side,
			bank.collector.id,
			...bank.bays.flatMap((bay) => [bay.id, bay.side, ...bay.processLoops.map((loop) => loop.id)]),
		]),
		...plan.gateways.flatMap((gatewayPlan) => [gatewayPlan.id, gatewayPlan.ownerId]),
	]);
	checksum.addNumbers([
		plan.version,
		plan.profile.bayCount,
		plan.profile.bayDepthMeters,
		plan.profile.bayFrontageMeters,
		plan.profile.bayPitchMeters,
		...loopNumbers(plan.outer),
		...loopNumbers(plan.interbaySpine),
		...plan.banks.flatMap((bank) => [
			...loopNumbers(bank.collector),
			...bank.bays.flatMap((bay) => [
				bay.anchor.x,
				bay.anchor.y,
				bay.pose.forward,
				bay.frontageMeters,
				bay.depthMeters,
				...bay.processLoops.flatMap((loop) => [
					loop.anchor.x,
					loop.anchor.y,
					loop.frontageMeters,
					loop.depthMeters,
				]),
			]),
		]),
		...plan.gateways.flatMap((gatewayPlan) => [
			gatewayPlan.sourceAnchor.x,
			gatewayPlan.sourceAnchor.y,
			gatewayPlan.targetAnchor.x,
			gatewayPlan.targetAnchor.y,
		]),
	]);
	return checksum.digest();
}

function loopNumbers(loop: ParallelHallFabLoopPlan): readonly number[] {
	return [loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters];
}
