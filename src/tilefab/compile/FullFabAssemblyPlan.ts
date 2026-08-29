import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_W } from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const FULL_FAB_ASSEMBLY_PLAN_VERSION = 1 as const;
export const FULL_FAB_MINIMUM_BAYS = 48;
export const FULL_FAB_MAXIMUM_BAYS = 64;
export const FULL_FAB_BANK_COUNT = 4;
export const FULL_FAB_MINIMUM_DEPTH_METERS = 80;
export const FULL_FAB_MAXIMUM_DEPTH_METERS = 120;
export const FULL_FAB_MINIMUM_FRONTAGE_METERS = 36;
export const FULL_FAB_MAXIMUM_FRONTAGE_METERS = 60;
export const FULL_FAB_MINIMUM_PITCH_METERS = 40;
export const FULL_FAB_MAXIMUM_PITCH_METERS = 76;
export const FULL_FAB_ASSEMBLY_ENVELOPE_METERS = 2_000;

const OUTER_MARGIN_METERS = 24;
const HALL_GAP_METERS = 24;
const BANK_END_MARGIN_METERS = 8;
const BANK_COLLECTOR_DEPTH_METERS = 12;
const COLLECTOR_SPINE_GAP_METERS = 8;
const INTERBAY_SPINE_DEPTH_METERS = 20;
const PROCESS_LOOP_FRONT_MARGIN_METERS = 4;
const PROCESS_LOOP_GAP_METERS = 4;
const PROCESS_LOOP_DEPTH_INSET_METERS = 8;

export interface FullFabProfile {
	readonly bayCount: number;
	readonly bayDepthMeters: number;
	readonly bayFrontageMeters: number;
	readonly bayPitchMeters: number;
}

export type FullFabPose = Readonly<Required<RailTemplatePose>>;

export interface FullFabLoopPlan {
	readonly id: string;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly pose: FullFabPose;
}

export interface FullFabProcessLoopPlacement {
	readonly id: string;
	readonly anchor: Cell;
	readonly pose: FullFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
}

export interface FullFabBayPlacement {
	readonly id: string;
	readonly bankId: string;
	readonly side: "north" | "south";
	readonly anchor: Cell;
	readonly pose: FullFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
	readonly processLoops: readonly FullFabProcessLoopPlacement[];
}

export interface FullFabBankPlan {
	readonly id: string;
	readonly hallIndex: 0 | 1;
	readonly side: FullFabBayPlacement["side"];
	readonly collector: FullFabLoopPlan;
	readonly bays: readonly FullFabBayPlacement[];
}

export interface FullFabHallPlan {
	readonly id: string;
	readonly index: 0 | 1;
	readonly interbaySpine: FullFabLoopPlan;
	readonly banks: readonly [FullFabBankPlan, FullFabBankPlan];
}

export interface FullFabGatewayPlan {
	readonly id: string;
	readonly sourceAnchor: Cell;
	readonly targetAnchor: Cell;
	readonly ownerId: string;
	readonly allowSameComponent: boolean;
}

export interface FullFabAssemblyPlan {
	readonly version: typeof FULL_FAB_ASSEMBLY_PLAN_VERSION;
	readonly id: "full-fab-52";
	readonly profile: FullFabProfile;
	readonly outer: FullFabLoopPlan;
	readonly halls: readonly [FullFabHallPlan, FullFabHallPlan];
	readonly banks: readonly [FullFabBankPlan, FullFabBankPlan, FullFabBankPlan, FullFabBankPlan];
	readonly gateways: readonly FullFabGatewayPlan[];
	readonly planFingerprint: string;
}

/**
 * Public OpenFab grammar for one full production building. Two long process halls share one
 * factory perimeter; each hall has a dedicated interbay loop and opposed Bay banks. Every Bay is
 * itself a circulation envelope containing two full-depth Process Loops.
 */
export function createFullFabAssemblyPlan(profile: FullFabProfile): FullFabAssemblyPlan {
	assertFullFabProfile(profile);
	const baysPerBank = profile.bayCount / FULL_FAB_BANK_COUNT;
	const collectorLengthMeters =
		BANK_END_MARGIN_METERS * 2 +
		Math.max(0, baysPerBank - 1) * profile.bayPitchMeters +
		profile.bayFrontageMeters;
	const hallHeightMeters =
		profile.bayDepthMeters * 2 +
		BANK_COLLECTOR_DEPTH_METERS * 2 +
		COLLECTOR_SPINE_GAP_METERS * 2 +
		INTERBAY_SPINE_DEPTH_METERS;
	const fabWidthMeters = OUTER_MARGIN_METERS * 2 + collectorLengthMeters;
	const fabHeightMeters = OUTER_MARGIN_METERS * 2 + hallHeightMeters * 2 + HALL_GAP_METERS;
	if (
		fabWidthMeters > FULL_FAB_ASSEMBLY_ENVELOPE_METERS ||
		fabHeightMeters > FULL_FAB_ASSEMBLY_ENVELOPE_METERS
	) {
		throw new RangeError("Full FAB dimensions exceed the supported 2 km envelope.");
	}

	const collectorX = OUTER_MARGIN_METERS;
	let nextBayOrdinal = 1;
	const hallPlans = ([0, 1] as const).map((hallIndex) => {
		const hallTopY = OUTER_MARGIN_METERS + hallIndex * (hallHeightMeters + HALL_GAP_METERS);
		const northCollectorY = hallTopY + profile.bayDepthMeters;
		const spineY = northCollectorY + BANK_COLLECTOR_DEPTH_METERS + COLLECTOR_SPINE_GAP_METERS;
		const southCollectorY = spineY + INTERBAY_SPINE_DEPTH_METERS + COLLECTOR_SPINE_GAP_METERS;
		const hallId = `PROCESS-HALL-${hallIndex + 1}`;
		const northCollector = loopPlan(
			`${hallId}-NORTH-COLLECTOR`,
			{ x: collectorX, y: northCollectorY },
			collectorLengthMeters,
			BANK_COLLECTOR_DEPTH_METERS,
		);
		const southCollector = loopPlan(
			`${hallId}-SOUTH-COLLECTOR`,
			{ x: collectorX, y: southCollectorY },
			collectorLengthMeters,
			BANK_COLLECTOR_DEPTH_METERS,
		);
		const northBank = bankPlan(
			`${hallId}-NORTH-BANK`,
			hallIndex,
			"north",
			baysPerBank,
			collectorX + BANK_END_MARGIN_METERS,
			northCollectorY,
			profile,
			() => nextBayOrdinal++,
			northCollector,
		);
		const southBank = bankPlan(
			`${hallId}-SOUTH-BANK`,
			hallIndex,
			"south",
			baysPerBank,
			collectorX + BANK_END_MARGIN_METERS,
			southCollectorY + BANK_COLLECTOR_DEPTH_METERS,
			profile,
			() => nextBayOrdinal++,
			southCollector,
		);
		return Object.freeze({
			id: hallId,
			index: hallIndex,
			interbaySpine: loopPlan(
				`${hallId}-INTERBAY`,
				{ x: collectorX, y: spineY },
				collectorLengthMeters,
				INTERBAY_SPINE_DEPTH_METERS,
			),
			banks: Object.freeze([northBank, southBank]) as readonly [FullFabBankPlan, FullFabBankPlan],
		});
	});
	const halls = Object.freeze(hallPlans) as readonly [FullFabHallPlan, FullFabHallPlan];
	const banks = Object.freeze(halls.flatMap((hall) => hall.banks)) as readonly [
		FullFabBankPlan,
		FullFabBankPlan,
		FullFabBankPlan,
		FullFabBankPlan,
	];
	const middleX = collectorX + Math.floor(collectorLengthMeters / 2);
	const gateways = Object.freeze(
		halls.flatMap((hall) => {
			const spineMiddleY =
				hall.interbaySpine.origin.y + Math.floor(hall.interbaySpine.depthMeters / 2);
			const [northBank, southBank] = hall.banks;
			return [
				gateway(
					`${hall.id}-WEST-OUTER-GATEWAY`,
					{ x: 0, y: spineMiddleY },
					{ x: collectorX, y: spineMiddleY },
					"FULL-FAB",
					false,
				),
				gateway(
					`${hall.id}-EAST-OUTER-GATEWAY`,
					{ x: collectorX + collectorLengthMeters, y: spineMiddleY },
					{ x: fabWidthMeters, y: spineMiddleY },
					"FULL-FAB",
					true,
				),
				gateway(
					`${northBank.id}-INTERBAY-GATEWAY`,
					{
						x: middleX,
						y: northBank.collector.origin.y + northBank.collector.depthMeters,
					},
					{ x: middleX, y: hall.interbaySpine.origin.y },
					northBank.id,
					false,
				),
				gateway(
					`${southBank.id}-INTERBAY-GATEWAY`,
					{
						x: middleX,
						y: hall.interbaySpine.origin.y + hall.interbaySpine.depthMeters,
					},
					{ x: middleX, y: southBank.collector.origin.y },
					southBank.id,
					false,
				),
			];
		}),
	);
	const withoutFingerprint = Object.freeze({
		version: FULL_FAB_ASSEMBLY_PLAN_VERSION,
		id: "full-fab-52" as const,
		profile: Object.freeze({ ...profile }),
		outer: loopPlan("FAB-OUTER-CIRCULATION", { x: 0, y: 0 }, fabWidthMeters, fabHeightMeters),
		halls,
		banks,
		gateways,
	});
	return Object.freeze({
		...withoutFingerprint,
		planFingerprint: fullFabPlanFingerprint(withoutFingerprint),
	});
}

export function fullFabMinimumPitchMeters(frontageMeters: number): number {
	if (
		!Number.isSafeInteger(frontageMeters) ||
		frontageMeters < FULL_FAB_MINIMUM_FRONTAGE_METERS ||
		frontageMeters > FULL_FAB_MAXIMUM_FRONTAGE_METERS ||
		frontageMeters % 4 !== 0
	) {
		throw new RangeError("Full FAB frontage must be valid before sizing pitch.");
	}
	return Math.max(FULL_FAB_MINIMUM_PITCH_METERS, frontageMeters + 4);
}

function assertFullFabProfile(profile: FullFabProfile): void {
	if (
		!Number.isSafeInteger(profile.bayCount) ||
		profile.bayCount < FULL_FAB_MINIMUM_BAYS ||
		profile.bayCount > FULL_FAB_MAXIMUM_BAYS ||
		profile.bayCount % FULL_FAB_BANK_COUNT !== 0
	) {
		throw new RangeError("Full FAB Bay count must be a 48-64 integer divisible by four.");
	}
	if (
		!Number.isSafeInteger(profile.bayDepthMeters) ||
		profile.bayDepthMeters < FULL_FAB_MINIMUM_DEPTH_METERS ||
		profile.bayDepthMeters > FULL_FAB_MAXIMUM_DEPTH_METERS ||
		profile.bayDepthMeters % 4 !== 0
	) {
		throw new RangeError("Full FAB Bay depth must be an 80-120 m integer in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayFrontageMeters) ||
		profile.bayFrontageMeters < FULL_FAB_MINIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters > FULL_FAB_MAXIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters % 4 !== 0
	) {
		throw new RangeError("Full FAB Bay frontage must be a 36-60 m integer in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayPitchMeters) ||
		profile.bayPitchMeters < fullFabMinimumPitchMeters(profile.bayFrontageMeters) ||
		profile.bayPitchMeters > FULL_FAB_MAXIMUM_PITCH_METERS ||
		profile.bayPitchMeters % 4 !== 0
	) {
		throw new RangeError("Full FAB Bay pitch must preserve at least 4 m between Bays.");
	}
}

function bankPlan(
	id: string,
	hallIndex: 0 | 1,
	side: FullFabBankPlan["side"],
	bayCount: number,
	firstBayX: number,
	baselineY: number,
	profile: FullFabProfile,
	nextOrdinal: () => number,
	collector: FullFabLoopPlan,
): FullFabBankPlan {
	const pose = Object.freeze(
		side === "north"
			? { forward: DIR_E, side: "left", flow: "forward" }
			: { forward: DIR_W, side: "left", flow: "forward" },
	) satisfies FullFabPose;
	const bays = Array.from({ length: bayCount }, (_, index) => {
		const leftX = firstBayX + index * profile.bayPitchMeters;
		const anchor =
			side === "north"
				? { x: leftX, y: baselineY }
				: { x: leftX + profile.bayFrontageMeters, y: baselineY };
		return bayPlacement(nextOrdinal(), id, side, anchor, pose, profile);
	});
	return Object.freeze({
		id,
		hallIndex,
		side,
		collector,
		bays: Object.freeze(bays),
	});
}

function bayPlacement(
	ordinal: number,
	bankId: string,
	side: FullFabBayPlacement["side"],
	anchor: Cell,
	pose: FullFabPose,
	profile: FullFabProfile,
): FullFabBayPlacement {
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
	pose: FullFabPose,
	frontageMeters: number,
	depthMeters: number,
): FullFabProcessLoopPlacement {
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
): FullFabLoopPlan {
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
	allowSameComponent: boolean,
): FullFabGatewayPlan {
	return Object.freeze({
		id,
		sourceAnchor: Object.freeze({ ...sourceAnchor }),
		targetAnchor: Object.freeze({ ...targetAnchor }),
		ownerId,
		allowSameComponent,
	});
}

function moveAlong(anchor: Cell, direction: number, distance: number): Cell {
	return Object.freeze({
		x: anchor.x + (direction === DIR_E ? distance : direction === DIR_W ? -distance : 0),
		y: anchor.y,
	});
}

function fullFabPlanFingerprint(plan: Omit<FullFabAssemblyPlan, "planFingerprint">): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.id,
		plan.outer.id,
		...plan.halls.flatMap((hall) => [hall.id, hall.interbaySpine.id]),
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
		...plan.halls.flatMap((hall) => loopNumbers(hall.interbaySpine)),
		...plan.banks.flatMap((bank) => [
			bank.hallIndex,
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
			gatewayPlan.allowSameComponent ? 1 : 0,
		]),
	]);
	return checksum.digest();
}

function loopNumbers(loop: FullFabLoopPlan): readonly number[] {
	return [loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters];
}
