import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const CENTRAL_SPINE_FAB_ASSEMBLY_PLAN_VERSION = 1 as const;
export const CENTRAL_SPINE_FAB_MINIMUM_BAYS = 16;
export const CENTRAL_SPINE_FAB_MAXIMUM_BAYS = 32;
export const CENTRAL_SPINE_FAB_MINIMUM_DEPTH_METERS = 56;
export const CENTRAL_SPINE_FAB_MAXIMUM_DEPTH_METERS = 120;
export const CENTRAL_SPINE_FAB_MINIMUM_FRONTAGE_METERS = 48;
export const CENTRAL_SPINE_FAB_MAXIMUM_FRONTAGE_METERS = 64;
export const CENTRAL_SPINE_FAB_MINIMUM_PITCH_METERS = 52;
export const CENTRAL_SPINE_FAB_MAXIMUM_PITCH_METERS = 80;
export const CENTRAL_SPINE_FAB_ASSEMBLY_ENVELOPE_METERS = 2_000;

const OUTER_HORIZONTAL_MARGIN_METERS = 24;
const OUTER_VERTICAL_MARGIN_METERS = 20;
const INTERBAY_SPINE_DEPTH_METERS = 16;
const PROCESS_LOOP_FRONT_MARGIN_METERS = 4;
const PROCESS_LOOP_GAP_METERS = 4;
const PROCESS_LOOP_DEPTH_INSET_METERS = 8;

export interface CentralSpineFabProfile {
	readonly bayCount: number;
	readonly bayDepthMeters: number;
	readonly bayFrontageMeters: number;
	readonly bayPitchMeters: number;
}

export type CentralSpineFabPose = Readonly<Required<RailTemplatePose>>;

export interface CentralSpineFabLoopPlan {
	readonly id: string;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly pose: CentralSpineFabPose;
}

export interface CentralSpineFabProcessLoopPlacement {
	readonly id: string;
	readonly anchor: Cell;
	readonly pose: CentralSpineFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
}

export interface CentralSpineFabBayPlacement {
	readonly id: string;
	readonly bankId: string;
	readonly side: "north" | "south";
	readonly anchor: Cell;
	readonly pose: CentralSpineFabPose;
	readonly frontageMeters: number;
	readonly depthMeters: number;
	readonly processLoops: readonly CentralSpineFabProcessLoopPlacement[];
}

export interface CentralSpineFabBankPlan {
	readonly id: string;
	readonly index: number;
	readonly side: CentralSpineFabBayPlacement["side"];
	readonly bays: readonly CentralSpineFabBayPlacement[];
}

export interface CentralSpineFabAssemblyPlan {
	readonly version: typeof CENTRAL_SPINE_FAB_ASSEMBLY_PLAN_VERSION;
	readonly id: "central-spine-fab-24";
	readonly profile: CentralSpineFabProfile;
	readonly outer: CentralSpineFabLoopPlan;
	readonly interbaySpine: CentralSpineFabLoopPlan;
	readonly banks: readonly [CentralSpineFabBankPlan, CentralSpineFabBankPlan];
	readonly planFingerprint: string;
}

/**
 * Independent public-safe FAB grammar. It models one horizontal interbay spine serving two
 * opposed Bay banks. Every Bay is a deep envelope with two parallel full-depth Process Loops.
 */
export function createCentralSpineFabAssemblyPlan(
	profile: CentralSpineFabProfile,
): CentralSpineFabAssemblyPlan {
	assertCentralSpineFabProfile(profile);
	const northBayCount = Math.ceil(profile.bayCount / 2);
	const southBayCount = profile.bayCount - northBayCount;
	const maximumBankBayCount = Math.max(northBayCount, southBayCount);
	const bankLengthMeters =
		Math.max(0, maximumBankBayCount - 1) * profile.bayPitchMeters + profile.bayFrontageMeters;
	const fabWidthMeters = OUTER_HORIZONTAL_MARGIN_METERS * 2 + bankLengthMeters;
	const fabHeightMeters =
		OUTER_VERTICAL_MARGIN_METERS * 2 + profile.bayDepthMeters * 2 + INTERBAY_SPINE_DEPTH_METERS;
	if (
		fabWidthMeters > CENTRAL_SPINE_FAB_ASSEMBLY_ENVELOPE_METERS ||
		fabHeightMeters > CENTRAL_SPINE_FAB_ASSEMBLY_ENVELOPE_METERS
	) {
		throw new RangeError("Central-spine FAB dimensions exceed the supported 2 km envelope.");
	}

	const spineY = OUTER_VERTICAL_MARGIN_METERS + profile.bayDepthMeters;
	let nextBayOrdinal = 1;
	const northBank = bankPlan(
		"NORTH-BAY-BANK",
		0,
		"north",
		northBayCount,
		maximumBankBayCount,
		profile,
		spineY,
		() => nextBayOrdinal++,
	);
	const southBank = bankPlan(
		"SOUTH-BAY-BANK",
		1,
		"south",
		southBayCount,
		maximumBankBayCount,
		profile,
		spineY + INTERBAY_SPINE_DEPTH_METERS,
		() => nextBayOrdinal++,
	);
	const withoutFingerprint = Object.freeze({
		version: CENTRAL_SPINE_FAB_ASSEMBLY_PLAN_VERSION,
		id: "central-spine-fab-24" as const,
		profile: Object.freeze({ ...profile }),
		outer: loopPlan("FAB-OUTER-CIRCULATION", { x: 0, y: 0 }, fabWidthMeters, fabHeightMeters, {
			forward: DIR_E,
			side: "right",
			flow: "forward",
		}),
		interbaySpine: loopPlan(
			"FAB-CENTRAL-INTERBAY",
			{ x: 0, y: spineY },
			fabWidthMeters,
			INTERBAY_SPINE_DEPTH_METERS,
			{ forward: DIR_E, side: "right", flow: "forward" },
		),
		banks: Object.freeze([northBank, southBank]) as readonly [
			CentralSpineFabBankPlan,
			CentralSpineFabBankPlan,
		],
	});
	return Object.freeze({
		...withoutFingerprint,
		planFingerprint: centralSpineFabPlanFingerprint(withoutFingerprint),
	});
}

export function centralSpineFabMinimumPitchMeters(frontageMeters: number): number {
	if (
		!Number.isSafeInteger(frontageMeters) ||
		frontageMeters < CENTRAL_SPINE_FAB_MINIMUM_FRONTAGE_METERS ||
		frontageMeters > CENTRAL_SPINE_FAB_MAXIMUM_FRONTAGE_METERS ||
		frontageMeters % 4 !== 0
	) {
		throw new RangeError("Central-spine FAB frontage must be valid before sizing pitch.");
	}
	return Math.max(CENTRAL_SPINE_FAB_MINIMUM_PITCH_METERS, frontageMeters + 4);
}

function assertCentralSpineFabProfile(profile: CentralSpineFabProfile): void {
	if (
		!Number.isSafeInteger(profile.bayCount) ||
		profile.bayCount < CENTRAL_SPINE_FAB_MINIMUM_BAYS ||
		profile.bayCount > CENTRAL_SPINE_FAB_MAXIMUM_BAYS
	) {
		throw new RangeError("Central-spine FAB Bay count must be a 16-32 integer.");
	}
	if (
		!Number.isSafeInteger(profile.bayDepthMeters) ||
		profile.bayDepthMeters < CENTRAL_SPINE_FAB_MINIMUM_DEPTH_METERS ||
		profile.bayDepthMeters > CENTRAL_SPINE_FAB_MAXIMUM_DEPTH_METERS ||
		profile.bayDepthMeters % 4 !== 0
	) {
		throw new RangeError("Central-spine FAB Bay depth must be a 56-120 m integer in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayFrontageMeters) ||
		profile.bayFrontageMeters < CENTRAL_SPINE_FAB_MINIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters > CENTRAL_SPINE_FAB_MAXIMUM_FRONTAGE_METERS ||
		profile.bayFrontageMeters % 4 !== 0
	) {
		throw new RangeError("Central-spine FAB Bay frontage must be a 48-64 m integer in 4 m steps.");
	}
	if (
		!Number.isSafeInteger(profile.bayPitchMeters) ||
		profile.bayPitchMeters < centralSpineFabMinimumPitchMeters(profile.bayFrontageMeters) ||
		profile.bayPitchMeters > CENTRAL_SPINE_FAB_MAXIMUM_PITCH_METERS ||
		profile.bayPitchMeters % 4 !== 0
	) {
		throw new RangeError(
			"Central-spine FAB Bay pitch must preserve at least 4 m between adjacent Bay envelopes.",
		);
	}
}

function bankPlan(
	id: string,
	index: number,
	side: CentralSpineFabBayPlacement["side"],
	bayCount: number,
	maximumBankBayCount: number,
	profile: CentralSpineFabProfile,
	trunkY: number,
	nextOrdinal: () => number,
): CentralSpineFabBankPlan {
	const centeringOffset = Math.floor(
		((maximumBankBayCount - bayCount) * profile.bayPitchMeters) / 2,
	);
	const firstBayX = OUTER_HORIZONTAL_MARGIN_METERS + centeringOffset;
	const pose = Object.freeze(
		side === "north"
			? { forward: DIR_E, side: "left", flow: "forward" }
			: { forward: DIR_W, side: "left", flow: "forward" },
	) satisfies CentralSpineFabPose;
	const bays = Array.from({ length: bayCount }, (_, bayIndex) => {
		const leftX = firstBayX + bayIndex * profile.bayPitchMeters;
		const anchor =
			side === "north"
				? { x: leftX, y: trunkY }
				: { x: leftX + profile.bayFrontageMeters, y: trunkY };
		return bayPlacement(nextOrdinal(), id, side, anchor, pose, profile);
	});
	return Object.freeze({ id, index, side, bays: Object.freeze(bays) });
}

function bayPlacement(
	ordinal: number,
	bankId: string,
	side: CentralSpineFabBayPlacement["side"],
	anchor: Cell,
	pose: CentralSpineFabPose,
	profile: CentralSpineFabProfile,
): CentralSpineFabBayPlacement {
	const availableFrontageMeters =
		profile.bayFrontageMeters - PROCESS_LOOP_FRONT_MARGIN_METERS * 2 - PROCESS_LOOP_GAP_METERS;
	const firstFrontageMeters = Math.floor(availableFrontageMeters / 2);
	const secondFrontageMeters = availableFrontageMeters - firstFrontageMeters;
	const processDepthMeters = profile.bayDepthMeters - PROCESS_LOOP_DEPTH_INSET_METERS;
	const bayId = `BAY-${String(ordinal).padStart(3, "0")}`;
	const firstAnchor = moveAlong(anchor, pose.forward, PROCESS_LOOP_FRONT_MARGIN_METERS);
	const secondAnchor = moveAlong(
		anchor,
		pose.forward,
		PROCESS_LOOP_FRONT_MARGIN_METERS + firstFrontageMeters + PROCESS_LOOP_GAP_METERS,
	);
	return Object.freeze({
		id: bayId,
		bankId,
		side,
		anchor: Object.freeze({ ...anchor }),
		pose,
		frontageMeters: profile.bayFrontageMeters,
		depthMeters: profile.bayDepthMeters,
		processLoops: Object.freeze([
			processLoop(
				`${bayId}-PROCESS-LOOP-01`,
				firstAnchor,
				pose,
				firstFrontageMeters,
				processDepthMeters,
			),
			processLoop(
				`${bayId}-PROCESS-LOOP-02`,
				secondAnchor,
				pose,
				secondFrontageMeters,
				processDepthMeters,
			),
		]),
	});
}

function processLoop(
	id: string,
	anchor: Cell,
	pose: CentralSpineFabPose,
	frontageMeters: number,
	depthMeters: number,
): CentralSpineFabProcessLoopPlacement {
	return Object.freeze({
		id,
		anchor: Object.freeze({ ...anchor }),
		pose,
		frontageMeters,
		depthMeters,
	});
}

function moveAlong(anchor: Cell, direction: Direction, distance: number): Cell {
	if (direction === DIR_N) return Object.freeze({ x: anchor.x, y: anchor.y - distance });
	if (direction === DIR_S) return Object.freeze({ x: anchor.x, y: anchor.y + distance });
	return Object.freeze({
		x: direction === DIR_E ? anchor.x + distance : anchor.x - distance,
		y: anchor.y,
	});
}

function loopPlan(
	id: string,
	origin: Cell,
	lengthMeters: number,
	depthMeters: number,
	pose: CentralSpineFabPose,
): CentralSpineFabLoopPlan {
	return Object.freeze({
		id,
		origin: Object.freeze({ ...origin }),
		lengthMeters,
		depthMeters,
		pose: Object.freeze({ ...pose }),
	});
}

function centralSpineFabPlanFingerprint(
	plan: Omit<CentralSpineFabAssemblyPlan, "planFingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.id,
		plan.outer.id,
		plan.outer.pose.side,
		plan.outer.pose.flow,
		plan.interbaySpine.id,
		plan.interbaySpine.pose.side,
		plan.interbaySpine.pose.flow,
		...plan.banks.flatMap((bank) => [bank.id, bank.side]),
		...plan.banks.flatMap((bank) =>
			bank.bays.flatMap((bay) => [
				bay.id,
				bay.bankId,
				bay.side,
				bay.pose.side,
				bay.pose.flow,
				...bay.processLoops.flatMap((loop) => [loop.id, loop.pose.side, loop.pose.flow]),
			]),
		),
	]);
	checksum.addNumbers([
		plan.version,
		plan.profile.bayCount,
		plan.profile.bayDepthMeters,
		plan.profile.bayFrontageMeters,
		plan.profile.bayPitchMeters,
		...loopNumbers(plan.outer),
		plan.outer.pose.forward,
		...loopNumbers(plan.interbaySpine),
		plan.interbaySpine.pose.forward,
		...plan.banks.flatMap((bank) => [
			bank.index,
			...bank.bays.flatMap((bay) => [
				bay.anchor.x,
				bay.anchor.y,
				bay.pose.forward,
				bay.frontageMeters,
				bay.depthMeters,
				...bay.processLoops.flatMap((loop) => [
					loop.anchor.x,
					loop.anchor.y,
					loop.pose.forward,
					loop.frontageMeters,
					loop.depthMeters,
				]),
			]),
		]),
	]);
	return checksum.digest();
}

function loopNumbers(loop: CentralSpineFabLoopPlan): readonly number[] {
	return [loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters];
}
