import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import type { Cell } from "../core/TileMap";

export const PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION = 1 as const;
export const PRODUCTION_FAB_MINIMUM_BAYS = 50;
export const PRODUCTION_FAB_MAXIMUM_BAYS = 100;
export const PRODUCTION_FAB_MINIMUM_BANKS = 3;
export const PRODUCTION_FAB_MAXIMUM_BANKS = 6;
export const PRODUCTION_FAB_MINIMUM_BAY_PITCH_METERS = 104;
export const PRODUCTION_FAB_MAXIMUM_BAY_PITCH_METERS = 140;
export const PRODUCTION_FAB_ASSEMBLY_ENVELOPE_METERS = 2_000;

export interface ProductionFabProfile {
	readonly bayCount: number;
	readonly bankCount: number;
	readonly bayPitchMeters: number;
}

export type ProductionFabPose = Readonly<Required<RailTemplatePose>>;

export interface ProductionFabLoopPlan {
	readonly id: string;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly pose: ProductionFabPose;
}

export interface ProductionFabBayPlacement {
	readonly id: string;
	readonly bankId: string;
	readonly side: "north" | "south";
	readonly anchor: Cell;
	readonly pose: ProductionFabPose;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly processLoops: readonly ProductionFabProcessLoopPlacement[];
}

export interface ProductionFabProcessLoopPlacement {
	readonly id: string;
	readonly anchor: Cell;
	readonly pose: ProductionFabPose;
	readonly spanMeters: number;
	readonly depthMeters: number;
}

export interface ProductionFabBankPlan {
	readonly id: string;
	readonly index: number;
	readonly collector: ProductionFabLoopPlan;
	readonly bayCount: number;
	readonly northBayCount: number;
	readonly southBayCount: number;
	readonly bays: readonly ProductionFabBayPlacement[];
}

export interface ProductionFabAssemblyPlan {
	readonly version: typeof PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION;
	readonly id: "production-fab-60";
	readonly profile: ProductionFabProfile;
	readonly bayLengthMeters: number;
	readonly bayDepthMeters: number;
	readonly outer: ProductionFabLoopPlan;
	readonly interbaySpine: ProductionFabLoopPlan;
	readonly banks: readonly ProductionFabBankPlan[];
	readonly planFingerprint: string;
}

export function productionFabMaximumBayPitchMeters(bayCount: number, bankCount: number): number {
	if (
		!Number.isSafeInteger(bayCount) ||
		bayCount < PRODUCTION_FAB_MINIMUM_BAYS ||
		bayCount > PRODUCTION_FAB_MAXIMUM_BAYS ||
		!Number.isSafeInteger(bankCount) ||
		bankCount < PRODUCTION_FAB_MINIMUM_BANKS ||
		bankCount > PRODUCTION_FAB_MAXIMUM_BANKS
	) {
		throw new RangeError("Production FAB Bay and Bank counts must be valid before sizing pitch.");
	}
	const maximumBankBayCount = Math.ceil(bayCount / bankCount);
	const maximumSideCount = Math.ceil(maximumBankBayCount / 2);
	const envelopeMaximum = Math.floor(
		(PRODUCTION_FAB_ASSEMBLY_ENVELOPE_METERS -
			INTERBAY_SPINE_WIDTH_METERS -
			FAB_RIGHT_MARGIN_METERS) /
			maximumSideCount,
	);
	const steppedMaximum = envelopeMaximum - (envelopeMaximum % 4);
	return Math.max(
		PRODUCTION_FAB_MINIMUM_BAY_PITCH_METERS,
		Math.min(PRODUCTION_FAB_MAXIMUM_BAY_PITCH_METERS, steppedMaximum),
	);
}

const INTERBAY_SPINE_WIDTH_METERS = 24;
const BANK_COLLECTOR_DEPTH_METERS = 24;
const BAY_DEPTH_METERS = 32;
const BAY_LENGTH_INSET_METERS = 16;
const BAY_PROCESS_LOOP_END_MARGIN_METERS = 6;
const BAY_PROCESS_LOOP_GAP_METERS = 8;
const BANK_END_MARGIN_METERS = 8;
const BANK_VERTICAL_GAP_METERS = 32;
const FAB_OUTER_MARGIN_METERS = 24;
const FAB_RIGHT_MARGIN_METERS = 32;

/**
 * Public-safe factory grammar. It intentionally derives only from OpenFab parameters and never
 * from an imported or customer layout.
 */
export function createProductionFabAssemblyPlan(
	profile: ProductionFabProfile,
): ProductionFabAssemblyPlan {
	assertProductionFabProfile(profile);
	const bayLengthMeters = profile.bayPitchMeters - BAY_LENGTH_INSET_METERS;
	const bankBayCounts = distribute(profile.bayCount, profile.bankCount);
	const maximumSideCount = Math.max(...bankBayCounts.map((count) => Math.ceil(count / 2)));
	const collectorLengthMeters =
		BANK_END_MARGIN_METERS * 2 +
		Math.max(0, maximumSideCount - 1) * profile.bayPitchMeters +
		bayLengthMeters;
	const bankEnvelopeHeightMeters = BAY_DEPTH_METERS * 2 + BANK_COLLECTOR_DEPTH_METERS;
	const fabHeightMeters =
		FAB_OUTER_MARGIN_METERS * 2 +
		profile.bankCount * bankEnvelopeHeightMeters +
		(profile.bankCount - 1) * BANK_VERTICAL_GAP_METERS;
	const fabWidthMeters =
		INTERBAY_SPINE_WIDTH_METERS + collectorLengthMeters + FAB_RIGHT_MARGIN_METERS;
	if (
		fabWidthMeters > PRODUCTION_FAB_ASSEMBLY_ENVELOPE_METERS ||
		fabHeightMeters > PRODUCTION_FAB_ASSEMBLY_ENVELOPE_METERS
	) {
		throw new RangeError("Production FAB dimensions exceed the supported 2 km assembly envelope.");
	}

	let nextBayOrdinal = 1;
	const banks = bankBayCounts.map((bayCount, bankIndex) => {
		const northBayCount = Math.ceil(bayCount / 2);
		const southBayCount = bayCount - northBayCount;
		const collectorY =
			FAB_OUTER_MARGIN_METERS +
			BAY_DEPTH_METERS +
			bankIndex * (bankEnvelopeHeightMeters + BANK_VERTICAL_GAP_METERS);
		const bankId = `BAY-BANK-${String(bankIndex + 1).padStart(2, "0")}`;
		const bays: ProductionFabBayPlacement[] = [];
		for (let index = 0; index < northBayCount; index++) {
			bays.push(
				bayPlacement(
					nextBayOrdinal++,
					bankId,
					"north",
					{
						x:
							INTERBAY_SPINE_WIDTH_METERS +
							BANK_END_MARGIN_METERS +
							bayLengthMeters +
							index * profile.bayPitchMeters,
						y: collectorY,
					},
					DIR_W,
					bayLengthMeters,
				),
			);
		}
		for (let index = 0; index < southBayCount; index++) {
			bays.push(
				bayPlacement(
					nextBayOrdinal++,
					bankId,
					"south",
					{
						x:
							INTERBAY_SPINE_WIDTH_METERS + BANK_END_MARGIN_METERS + index * profile.bayPitchMeters,
						y: collectorY + BANK_COLLECTOR_DEPTH_METERS,
					},
					DIR_E,
					bayLengthMeters,
				),
			);
		}
		return Object.freeze({
			id: bankId,
			index: bankIndex,
			collector: loopPlan(
				`${bankId}-COLLECTOR`,
				{ x: INTERBAY_SPINE_WIDTH_METERS, y: collectorY },
				BANK_COLLECTOR_DEPTH_METERS,
				collectorLengthMeters,
				{ forward: DIR_S, side: "left", flow: "forward" },
			),
			bayCount,
			northBayCount,
			southBayCount,
			bays: Object.freeze(bays),
		}) satisfies ProductionFabBankPlan;
	});
	const withoutFingerprint = Object.freeze({
		version: PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION,
		id: "production-fab-60" as const,
		profile: Object.freeze({ ...profile }),
		bayLengthMeters,
		bayDepthMeters: BAY_DEPTH_METERS,
		outer: loopPlan("FAB-OUTER-CIRCULATION", { x: 0, y: 0 }, fabWidthMeters, fabHeightMeters, {
			forward: DIR_E,
			side: "right",
			flow: "forward",
		}),
		interbaySpine: loopPlan(
			"FAB-INTERBAY-SPINE",
			{ x: 0, y: 0 },
			INTERBAY_SPINE_WIDTH_METERS,
			fabHeightMeters,
			{ forward: DIR_E, side: "right", flow: "forward" },
		),
		banks: Object.freeze(banks),
	});
	return Object.freeze({
		...withoutFingerprint,
		planFingerprint: productionFabPlanFingerprint(withoutFingerprint),
	});
}

function assertProductionFabProfile(profile: ProductionFabProfile): void {
	if (
		!Number.isSafeInteger(profile.bayCount) ||
		profile.bayCount < PRODUCTION_FAB_MINIMUM_BAYS ||
		profile.bayCount > PRODUCTION_FAB_MAXIMUM_BAYS
	) {
		throw new RangeError("Production FAB Bay count must be a 50-100 integer.");
	}
	if (
		!Number.isSafeInteger(profile.bankCount) ||
		profile.bankCount < PRODUCTION_FAB_MINIMUM_BANKS ||
		profile.bankCount > PRODUCTION_FAB_MAXIMUM_BANKS
	) {
		throw new RangeError("Production FAB Bay Bank count must be a 3-6 integer.");
	}
	if (
		!Number.isSafeInteger(profile.bayPitchMeters) ||
		profile.bayPitchMeters < PRODUCTION_FAB_MINIMUM_BAY_PITCH_METERS ||
		profile.bayPitchMeters > PRODUCTION_FAB_MAXIMUM_BAY_PITCH_METERS ||
		profile.bayPitchMeters % 4 !== 0
	) {
		throw new RangeError("Production FAB Bay pitch must be a 104-140 m integer in 4 m steps.");
	}
}

function distribute(total: number, buckets: number): readonly number[] {
	const base = Math.floor(total / buckets);
	const remainder = total % buckets;
	return Object.freeze(
		Array.from({ length: buckets }, (_, index) => base + (index < remainder ? 1 : 0)),
	);
}

function bayPlacement(
	ordinal: number,
	bankId: string,
	side: ProductionFabBayPlacement["side"],
	anchor: Cell,
	forward: Direction,
	lengthMeters: number,
): ProductionFabBayPlacement {
	const pose = Object.freeze({
		forward,
		side: "right",
		flow: "forward",
	}) satisfies ProductionFabPose;
	const availableSpanMeters =
		lengthMeters - BAY_PROCESS_LOOP_END_MARGIN_METERS * 2 - BAY_PROCESS_LOOP_GAP_METERS;
	const firstSpanMeters = Math.floor(availableSpanMeters / 2);
	const secondSpanMeters = availableSpanMeters - firstSpanMeters;
	const bayId = `BAY-${String(ordinal).padStart(3, "0")}`;
	const processLoops = [
		productionProcessLoopPlacement(
			`${bayId}-PROCESS-LOOP-01`,
			moveAlong(anchor, forward, BAY_PROCESS_LOOP_END_MARGIN_METERS),
			pose,
			firstSpanMeters,
		),
		productionProcessLoopPlacement(
			`${bayId}-PROCESS-LOOP-02`,
			moveAlong(
				anchor,
				forward,
				BAY_PROCESS_LOOP_END_MARGIN_METERS + firstSpanMeters + BAY_PROCESS_LOOP_GAP_METERS,
			),
			pose,
			secondSpanMeters,
		),
	];
	return Object.freeze({
		id: bayId,
		bankId,
		side,
		anchor: Object.freeze({ ...anchor }),
		pose,
		lengthMeters,
		depthMeters: BAY_DEPTH_METERS,
		processLoops: Object.freeze(processLoops),
	});
}

function productionProcessLoopPlacement(
	id: string,
	anchor: Cell,
	pose: ProductionFabPose,
	spanMeters: number,
): ProductionFabProcessLoopPlacement {
	return Object.freeze({
		id,
		anchor: Object.freeze({ ...anchor }),
		pose,
		spanMeters,
		depthMeters: BAY_DEPTH_METERS - 6,
	});
}

function moveAlong(anchor: Cell, direction: Direction, distance: number): Cell {
	if (direction === DIR_N) return Object.freeze({ x: anchor.x, y: anchor.y - distance });
	if (direction === DIR_E) return Object.freeze({ x: anchor.x + distance, y: anchor.y });
	if (direction === DIR_S) return Object.freeze({ x: anchor.x, y: anchor.y + distance });
	return Object.freeze({ x: anchor.x - distance, y: anchor.y });
}

function loopPlan(
	id: string,
	origin: Cell,
	lengthMeters: number,
	depthMeters: number,
	pose: ProductionFabPose,
): ProductionFabLoopPlan {
	return Object.freeze({
		id,
		origin: Object.freeze({ ...origin }),
		lengthMeters,
		depthMeters,
		pose: Object.freeze({ ...pose }),
	});
}

function productionFabPlanFingerprint(
	plan: Omit<ProductionFabAssemblyPlan, "planFingerprint">,
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
		...plan.banks.flatMap((bank) => [
			bank.id,
			bank.collector.id,
			bank.collector.pose.side,
			bank.collector.pose.flow,
		]),
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
		plan.profile.bankCount,
		plan.profile.bayPitchMeters,
		plan.bayLengthMeters,
		plan.bayDepthMeters,
		...loopNumbers(plan.outer),
		plan.outer.pose.forward,
		...loopNumbers(plan.interbaySpine),
		plan.interbaySpine.pose.forward,
		...plan.banks.flatMap((bank) => [
			bank.index,
			bank.bayCount,
			bank.northBayCount,
			bank.southBayCount,
			...loopNumbers(bank.collector),
			bank.collector.pose.forward,
			...bank.bays.flatMap((bay) => [
				bay.anchor.x,
				bay.anchor.y,
				bay.pose.forward,
				bay.lengthMeters,
				bay.depthMeters,
				...bay.processLoops.flatMap((loop) => [
					loop.anchor.x,
					loop.anchor.y,
					loop.pose.forward,
					loop.spanMeters,
					loop.depthMeters,
				]),
			]),
		]),
	]);
	return checksum.digest();
}

function loopNumbers(loop: ProductionFabLoopPlan): readonly number[] {
	return [loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters];
}
