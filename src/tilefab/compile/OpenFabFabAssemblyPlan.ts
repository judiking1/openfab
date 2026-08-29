import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	materializeClosedPairedRailCorridorRoute,
	PAIRED_RAIL_CORRIDOR_PLAN_VERSION,
	type PairedRailCorridorPlan,
	planPairedRailCorridor,
} from "../core/PairedRailCorridorPlanner";
import {
	materializePairedRailPerimeterTurnbackRoute,
	PAIRED_RAIL_PERIMETER_PLAN_VERSION,
	type PairedRailPerimeterPlan,
	planPairedRailPerimeter,
} from "../core/PairedRailPerimeterPlanner";
import {
	type ProductionBayModulePlan,
	planProductionBayModule,
} from "../core/ProductionBayModulePlanner";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_S, DIR_W } from "../core/railShape";
import { STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES } from "../core/StaticFabOrganizationBundle";
import type { Cell } from "../core/TileMap";
import {
	OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS,
	OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION,
	OPENFAB_FAB_INTER_BLOCK_BRIDGE_TOPOLOGY_POLICY,
	type OpenFabFabInterBlockBridgePlan,
	planOpenFabFabInterBlockBridge,
} from "./OpenFabFabInterBlockBridgePlanner";
import {
	deriveOpenFabFabProfile,
	type OpenFabFabBankPackingPlan,
	type OpenFabFabProfile,
	type OpenFabFabProfileDerived,
	openFabFabProfileDerivedFingerprint,
	openFabFabProfileFingerprint,
	openFabFabProfileProductionBayRequest,
} from "./OpenFabFabProfile";
import {
	PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
	PRODUCTION_BANK_PARENT_GATEWAY_TOPOLOGY_POLICY,
	type ProductionBankParentGatewayPlan,
	planProductionBankParentGateway,
} from "./ProductionBankParentGatewayPlanner";
import {
	PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION,
	PRODUCTION_BAY_PARENT_GATEWAY_TOPOLOGY_POLICY,
	type ProductionBayParentGatewayPlan,
	planProductionBayParentGateway,
} from "./ProductionBayParentGatewayPlanner";

export const OPENFAB_FAB_ASSEMBLY_PLAN_VERSION = 1 as const;
export const OPENFAB_FAB_ASSEMBLY_LAYOUT_CONTRACT_VERSION = 1 as const;
export const OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS = 24 as const;
export const OPENFAB_FAB_LAYOUT_BLOCK_GAP_METERS = OPENFAB_FAB_INTER_BLOCK_BRIDGE_GAP_METERS;
export const OPENFAB_FAB_BANK_GAP_METERS = 32 as const;
export const OPENFAB_FAB_BANK_COLLECTOR_END_RESERVE_METERS = 16 as const;
export const OPENFAB_FAB_BANK_COLLECTOR_LANE_SPACING_METERS = 2 as const;
export const OPENFAB_FAB_BLOCK_PERIMETER_LANE_SPACING_METERS = 4 as const;
export const OPENFAB_FAB_BAY_COLLECTOR_OFFSET_METERS = 12 as const;

export interface OpenFabFabAssemblyBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface OpenFabFabBayAssemblyPlacement {
	readonly key: string;
	readonly organizationKey: string;
	readonly processLoopOrganizationKeys: readonly string[];
	readonly layoutBlockOrdinal: number;
	readonly bankOrdinal: number;
	readonly ordinalWithinBank: number;
	readonly anchor: Cell;
	readonly pose: Readonly<Required<RailTemplatePose>>;
	readonly plan: ProductionBayModulePlan;
	readonly parentGateway: ProductionBayParentGatewayPlan;
}

export interface OpenFabFabBankAssemblyPlan {
	readonly key: string;
	readonly organizationKey: string;
	readonly ordinal: number;
	readonly ordinalWithinLayoutBlock: number;
	readonly collector: PairedRailCorridorPlan;
	readonly closedCollectorRoute: readonly Cell[];
	readonly parentGateway: ProductionBankParentGatewayPlan;
	readonly bays: readonly OpenFabFabBayAssemblyPlacement[];
}

export interface OpenFabFabLayoutBlockAssemblyPlan {
	readonly key: string;
	readonly ordinal: number;
	readonly bounds: OpenFabFabAssemblyBounds;
	readonly perimeter: PairedRailPerimeterPlan;
	readonly perimeterTurnbackRoutes: readonly [readonly Cell[], readonly Cell[]];
	readonly banks: readonly OpenFabFabBankAssemblyPlan[];
}

export interface OpenFabFabAssemblyKnownCapacity {
	/** Exact directed edges in closed primitives plus every planned Bay-to-Bank parent gateway. */
	readonly primitiveDirectedEdges: number;
	readonly upperLinkDirectedEdges: number;
	readonly plannedDirectedEdges: number;
	readonly plannedBayToBankGatewayPairs: number;
	readonly plannedBankToBlockGatewayPairs: number;
	readonly plannedInterBlockConnectorPairs: number;
	readonly portableBundleDirectedEdgeLimit: number;
	readonly portableBundleKnownHeadroom: number;
	/** Passing the complete planned-edge bound still requires exact composition against every cap. */
	readonly portableBundleEligibility:
		| "REQUIRES_EXACT_COMPOSITION"
		| "INELIGIBLE_PLANNED_EDGE_LIMIT";
}

export interface OpenFabFabAssemblyPlan {
	readonly kind: "openfab-fab-assembly-plan";
	readonly version: typeof OPENFAB_FAB_ASSEMBLY_PLAN_VERSION;
	readonly profile: OpenFabFabProfile;
	readonly profileDerived: OpenFabFabProfileDerived;
	readonly layoutContractFingerprint: string;
	readonly bounds: OpenFabFabAssemblyBounds;
	readonly layoutBlocks: readonly OpenFabFabLayoutBlockAssemblyPlan[];
	readonly interBlockBridges: readonly OpenFabFabInterBlockBridgePlan[];
	readonly capacity: OpenFabFabAssemblyKnownCapacity;
	readonly fingerprint: string;
}

/** Recreate the canonical plan and reject any copied or tampered executable child evidence. */
export function validateOpenFabFabAssemblyPlan(value: unknown): string | null {
	if (!isPlainRecord(value) || value.kind !== "openfab-fab-assembly-plan") {
		return "OpenFab Fab assembly plan must be a canonical plan object.";
	}
	try {
		const expected = createOpenFabFabAssemblyPlan(value.profile);
		return exactPlainDataEqual(expected, value)
			? null
			: "OpenFab Fab assembly plan does not match the canonical plan for its public profile.";
	} catch (error) {
		return error instanceof Error
			? `OpenFab Fab assembly plan is invalid: ${error.message}`
			: "OpenFab Fab assembly plan is invalid.";
	}
}

/**
 * Pure deterministic whole-Fab geometry intent. It does not mutate a TileMap and deliberately does
 * not claim readiness: exact map composition, physical certification, canonical hierarchy, and
 * action-specific capacity remain compiler work.
 */
export function createOpenFabFabAssemblyPlan(input: unknown): OpenFabFabAssemblyPlan {
	const profileDerived = deriveOpenFabFabProfile(input);
	const profile = profileDerived.profile;
	const processAxisSpanMeters =
		profileDerived.dimensions.bankProcessSpanMeters +
		OPENFAB_FAB_BANK_COLLECTOR_END_RESERVE_METERS * 2 +
		OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS * 2;
	const bankRegionSpanMeters =
		profileDerived.dimensions.productionBayOuterLengthMeters +
		OPENFAB_FAB_BAY_COLLECTOR_OFFSET_METERS;
	const bankStackSpanMeters =
		OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS * 2 +
		profile.banksPerLayoutBlock * bankRegionSpanMeters +
		(profile.banksPerLayoutBlock - 1) * OPENFAB_FAB_BANK_GAP_METERS;
	const blockWidthMeters =
		profile.bankRepetitionAxis === "EAST_WEST" ? processAxisSpanMeters : bankStackSpanMeters;
	const blockHeightMeters =
		profile.bankRepetitionAxis === "EAST_WEST" ? bankStackSpanMeters : processAxisSpanMeters;

	const layoutBlocks: OpenFabFabLayoutBlockAssemblyPlan[] = [];
	const interBlockBridges: OpenFabFabInterBlockBridgePlan[] = [];
	let primitiveDirectedEdges = 0;
	let upperLinkDirectedEdges = 0;
	let cursorX = 0;
	for (const blockPacking of profileDerived.layoutBlocks) {
		const blockBounds = freezeBounds({
			minX: cursorX,
			minY: 0,
			maxX: cursorX + blockWidthMeters,
			maxY: blockHeightMeters,
		});
		const perimeter = planBlockPerimeter(profile, blockBounds);
		const perimeterTurnbackRoutes = Object.freeze(
			perimeter.turnbacks.map(materializePairedRailPerimeterTurnbackRoute),
		) as unknown as readonly [readonly Cell[], readonly Cell[]];
		primitiveDirectedEdges += routeEdges(perimeter.buildRoutes);
		primitiveDirectedEdges += routeEdges(perimeterTurnbackRoutes);

		const banks = blockPacking.banks.map((bankPacking) => {
			const bank = planBank(profile, profileDerived, blockBounds, bankPacking, perimeter);
			primitiveDirectedEdges += bank.closedCollectorRoute.length - 1;
			for (const bay of bank.bays) {
				primitiveDirectedEdges += bay.plan.newEdges + bay.parentGateway.newEdges;
			}
			upperLinkDirectedEdges += bank.parentGateway.newEdges;
			return bank;
		});
		const block = Object.freeze({
			key: `layout-block-${blockPacking.ordinal + 1}`,
			ordinal: blockPacking.ordinal,
			bounds: blockBounds,
			perimeter,
			perimeterTurnbackRoutes,
			banks: Object.freeze(banks),
		}) satisfies OpenFabFabLayoutBlockAssemblyPlan;
		const previous = layoutBlocks.at(-1);
		if (previous) {
			const bridge = planOpenFabFabInterBlockBridge({
				version: OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION,
				ownerKey: "fab-1",
				leftPerimeter: previous.perimeter.specification,
				rightPerimeter: block.perimeter.specification,
			});
			interBlockBridges.push(bridge);
			upperLinkDirectedEdges += bridge.newEdges;
		}
		layoutBlocks.push(block);
		cursorX = blockBounds.maxX + OPENFAB_FAB_LAYOUT_BLOCK_GAP_METERS;
	}

	const bounds = freezeBounds({
		minX: 0,
		minY: 0,
		maxX: layoutBlocks.at(-1)?.bounds.maxX ?? 0,
		maxY: blockHeightMeters,
	});
	const plannedDirectedEdges = primitiveDirectedEdges + upperLinkDirectedEdges;
	const capacity = Object.freeze({
		primitiveDirectedEdges,
		upperLinkDirectedEdges,
		plannedDirectedEdges,
		plannedBayToBankGatewayPairs: profileDerived.counts.requiredBayToBankGatewayPairs,
		plannedBankToBlockGatewayPairs: profileDerived.counts.requiredBankToDistributorGatewayPairs,
		plannedInterBlockConnectorPairs: profileDerived.counts.requiredInterBlockConnectors,
		portableBundleDirectedEdgeLimit: STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES,
		portableBundleKnownHeadroom: Math.max(
			0,
			STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES - plannedDirectedEdges,
		),
		portableBundleEligibility:
			plannedDirectedEdges > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES
				? ("INELIGIBLE_PLANNED_EDGE_LIMIT" as const)
				: ("REQUIRES_EXACT_COMPOSITION" as const),
	});
	const layoutContractFingerprint = openFabFabAssemblyLayoutContractFingerprint();
	const withoutFingerprint = Object.freeze({
		kind: "openfab-fab-assembly-plan" as const,
		version: OPENFAB_FAB_ASSEMBLY_PLAN_VERSION,
		profile,
		profileDerived,
		layoutContractFingerprint,
		bounds,
		layoutBlocks: Object.freeze(layoutBlocks),
		interBlockBridges: Object.freeze(interBlockBridges),
		capacity,
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: openFabFabAssemblyPlanFingerprint(withoutFingerprint),
	});
}

export function openFabFabAssemblyLayoutContractFingerprint(): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["openfab-fab-linear-block-layout-v1"]);
	checksum.addNumbers([
		OPENFAB_FAB_ASSEMBLY_LAYOUT_CONTRACT_VERSION,
		PAIRED_RAIL_CORRIDOR_PLAN_VERSION,
		PAIRED_RAIL_PERIMETER_PLAN_VERSION,
		PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION,
		PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
		OPENFAB_FAB_INTER_BLOCK_BRIDGE_PLAN_VERSION,
		OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS,
		OPENFAB_FAB_LAYOUT_BLOCK_GAP_METERS,
		OPENFAB_FAB_BANK_GAP_METERS,
		OPENFAB_FAB_BANK_COLLECTOR_END_RESERVE_METERS,
		OPENFAB_FAB_BANK_COLLECTOR_LANE_SPACING_METERS,
		OPENFAB_FAB_BLOCK_PERIMETER_LANE_SPACING_METERS,
		OPENFAB_FAB_BAY_COLLECTOR_OFFSET_METERS,
	]);
	checksum.addStrings([
		PRODUCTION_BAY_PARENT_GATEWAY_TOPOLOGY_POLICY,
		PRODUCTION_BANK_PARENT_GATEWAY_TOPOLOGY_POLICY,
		OPENFAB_FAB_INTER_BLOCK_BRIDGE_TOPOLOGY_POLICY,
	]);
	return checksum.digest();
}

function planBlockPerimeter(
	profile: OpenFabFabProfile,
	bounds: OpenFabFabAssemblyBounds,
): PairedRailPerimeterPlan {
	return profile.bankRepetitionAxis === "EAST_WEST"
		? planPairedRailPerimeter({
				version: PAIRED_RAIL_PERIMETER_PLAN_VERSION,
				anchor: { x: bounds.minX, y: bounds.minY },
				forwardSpanMeters: bounds.maxX - bounds.minX,
				sideSpanMeters: bounds.maxY - bounds.minY,
				laneSpacingMeters: OPENFAB_FAB_BLOCK_PERIMETER_LANE_SPACING_METERS,
				pose: { forward: DIR_E, side: "right", flow: "forward" },
			})
		: planPairedRailPerimeter({
				version: PAIRED_RAIL_PERIMETER_PLAN_VERSION,
				anchor: { x: bounds.minX, y: bounds.minY },
				forwardSpanMeters: bounds.maxY - bounds.minY,
				sideSpanMeters: bounds.maxX - bounds.minX,
				laneSpacingMeters: OPENFAB_FAB_BLOCK_PERIMETER_LANE_SPACING_METERS,
				pose: { forward: DIR_S, side: "left", flow: "forward" },
			});
}

function planBank(
	profile: OpenFabFabProfile,
	profileDerived: OpenFabFabProfileDerived,
	blockBounds: OpenFabFabAssemblyBounds,
	packing: OpenFabFabBankPackingPlan,
	parentPerimeter: PairedRailPerimeterPlan,
): OpenFabFabBankAssemblyPlan {
	const collectorLengthMeters =
		profileDerived.dimensions.bankProcessSpanMeters +
		OPENFAB_FAB_BANK_COLLECTOR_END_RESERVE_METERS * 2;
	const bankRegionSpanMeters =
		profileDerived.dimensions.productionBayOuterLengthMeters +
		OPENFAB_FAB_BAY_COLLECTOR_OFFSET_METERS;
	const bankOffsetMeters =
		OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS +
		packing.ordinalWithinLayoutBlock * (bankRegionSpanMeters + OPENFAB_FAB_BANK_GAP_METERS);
	const collectorAnchor =
		profile.bankRepetitionAxis === "EAST_WEST"
			? freezeCell({
					x: blockBounds.minX + OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS,
					y: blockBounds.minY + bankOffsetMeters,
				})
			: freezeCell({
					x: blockBounds.minX + bankOffsetMeters + bankRegionSpanMeters,
					y: blockBounds.minY + OPENFAB_FAB_BLOCK_EDGE_MARGIN_METERS,
				});
	const collectorPose = Object.freeze(
		profile.bankRepetitionAxis === "EAST_WEST"
			? { forward: DIR_E, side: "right" as const, flow: "reverse" as const }
			: { forward: DIR_S, side: "right" as const, flow: "reverse" as const },
	);
	const collector = planPairedRailCorridor({
		version: PAIRED_RAIL_CORRIDOR_PLAN_VERSION,
		anchor: collectorAnchor,
		lengthMeters: collectorLengthMeters,
		laneSpacingMeters: OPENFAB_FAB_BANK_COLLECTOR_LANE_SPACING_METERS,
		pose: collectorPose,
	});
	const closedCollectorRoute = materializeClosedPairedRailCorridorRoute(collector);
	const organizationKey = `bank-${packing.ordinal + 1}`;
	const bays = packing.bays.map((bayPacking) => {
		const anchor =
			profile.bankRepetitionAxis === "EAST_WEST"
				? freezeCell({
						x:
							collectorAnchor.x +
							OPENFAB_FAB_BANK_COLLECTOR_END_RESERVE_METERS +
							bayPacking.shellOffsetMeters,
						y: collectorAnchor.y + OPENFAB_FAB_BAY_COLLECTOR_OFFSET_METERS,
					})
				: freezeCell({
						x: collectorAnchor.x - OPENFAB_FAB_BAY_COLLECTOR_OFFSET_METERS,
						y:
							collectorAnchor.y +
							OPENFAB_FAB_BANK_COLLECTOR_END_RESERVE_METERS +
							bayPacking.shellOffsetMeters,
					});
		const pose = Object.freeze(
			profile.bankRepetitionAxis === "EAST_WEST"
				? { forward: DIR_S, side: "left" as const, flow: "forward" as const }
				: { forward: DIR_W, side: "left" as const, flow: "forward" as const },
		);
		const bayRequest = openFabFabProfileProductionBayRequest(
			profile,
			bayPacking.processLoopCount,
			anchor,
			pose,
		);
		const plan = planProductionBayModule(bayRequest);
		const parentGateway = planProductionBayParentGateway({
			version: PRODUCTION_BAY_PARENT_GATEWAY_PLAN_VERSION,
			bankRepetitionAxis: profile.bankRepetitionAxis,
			processLoopCenterPitchMeters: profile.processLoopCenterPitchMeters,
			collector: collector.specification,
			bay: bayRequest,
		});
		const key = `bank-${packing.ordinal + 1}-bay-${bayPacking.ordinal + 1}`;
		return Object.freeze({
			key,
			organizationKey: key,
			processLoopOrganizationKeys: Object.freeze(
				bayPacking.processLoopOrdinals.map((ordinal) => `${key}-process-loop-${ordinal + 1}`),
			),
			layoutBlockOrdinal: packing.layoutBlockOrdinal,
			bankOrdinal: packing.ordinal,
			ordinalWithinBank: bayPacking.ordinal,
			anchor,
			pose,
			plan,
			parentGateway,
		}) satisfies OpenFabFabBayAssemblyPlacement;
	});
	const parentGateway = planProductionBankParentGateway({
		version: PRODUCTION_BANK_PARENT_GATEWAY_PLAN_VERSION,
		bankRepetitionAxis: profile.bankRepetitionAxis,
		collector: collector.specification,
		parentPerimeter: parentPerimeter.specification,
	});
	return Object.freeze({
		key: organizationKey,
		organizationKey,
		ordinal: packing.ordinal,
		ordinalWithinLayoutBlock: packing.ordinalWithinLayoutBlock,
		collector,
		closedCollectorRoute,
		parentGateway,
		bays: Object.freeze(bays),
	});
}

export function openFabFabAssemblyPlanFingerprint(
	plan: Omit<OpenFabFabAssemblyPlan, "fingerprint">,
): string {
	const profileFingerprint = openFabFabProfileFingerprint(plan.profile);
	const expectedProfileDerived = deriveOpenFabFabProfile(plan.profile);
	const profileDerivedFingerprint = openFabFabProfileDerivedFingerprint(plan.profileDerived);
	if (
		profileFingerprint !== plan.profileDerived.profileFingerprint ||
		openFabFabProfileFingerprint(plan.profileDerived.profile) !== profileFingerprint ||
		profileDerivedFingerprint !== openFabFabProfileDerivedFingerprint(expectedProfileDerived)
	) {
		throw new Error("OpenFab Fab assembly profile does not match its derived profile identity.");
	}
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.kind,
		profileFingerprint,
		profileDerivedFingerprint,
		plan.profileDerived.planFingerprint,
		plan.layoutContractFingerprint,
		...plan.layoutBlocks.flatMap((block) => [
			block.key,
			block.perimeter.fingerprint,
			...block.banks.flatMap((bank) => [
				bank.key,
				bank.organizationKey,
				bank.collector.fingerprint,
				bank.parentGateway.fingerprint,
				...bank.bays.flatMap((bay) => [
					bay.key,
					bay.organizationKey,
					...bay.processLoopOrganizationKeys,
					bay.plan.fingerprint,
					bay.parentGateway.fingerprint,
				]),
			]),
		]),
		...plan.interBlockBridges.map((bridge) => bridge.fingerprint),
		plan.capacity.portableBundleEligibility,
	]);
	checksum.addNumbers([
		plan.version,
		plan.bounds.minX,
		plan.bounds.minY,
		plan.bounds.maxX,
		plan.bounds.maxY,
		plan.capacity.primitiveDirectedEdges,
		plan.capacity.upperLinkDirectedEdges,
		plan.capacity.plannedDirectedEdges,
		plan.capacity.plannedBayToBankGatewayPairs,
		plan.capacity.plannedBankToBlockGatewayPairs,
		plan.capacity.plannedInterBlockConnectorPairs,
		plan.capacity.portableBundleDirectedEdgeLimit,
		plan.capacity.portableBundleKnownHeadroom,
		...plan.layoutBlocks.flatMap((block) => [
			block.ordinal,
			block.bounds.minX,
			block.bounds.minY,
			block.bounds.maxX,
			block.bounds.maxY,
			...block.banks.flatMap((bank) => [
				bank.ordinal,
				bank.ordinalWithinLayoutBlock,
				...bank.bays.flatMap((bay) => [
					bay.layoutBlockOrdinal,
					bay.bankOrdinal,
					bay.ordinalWithinBank,
				]),
			]),
		]),
	]);
	for (const block of plan.layoutBlocks) {
		checksum.addNumbers([block.perimeterTurnbackRoutes.length]);
		for (const route of block.perimeterTurnbackRoutes) {
			checksum.addNumbers([route.length]);
			for (const cell of route) checksum.addNumbers([cell.x, cell.y]);
		}
		for (const bank of block.banks) {
			checksum.addNumbers([bank.closedCollectorRoute.length]);
			for (const cell of bank.closedCollectorRoute) checksum.addNumbers([cell.x, cell.y]);
		}
	}
	return checksum.digest();
}

function routeEdges(routes: readonly (readonly Cell[])[]): number {
	return routes.reduce((total, route) => total + Math.max(0, route.length - 1), 0);
}

function freezeBounds(bounds: OpenFabFabAssemblyBounds): OpenFabFabAssemblyBounds {
	return Object.freeze({ ...bounds });
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}

function exactPlainDataEqual(
	left: unknown,
	right: unknown,
	seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
		return false;
	}
	let rightValues = seen.get(left);
	if (rightValues?.has(right)) return true;
	if (!rightValues) {
		rightValues = new WeakSet<object>();
		seen.set(left, rightValues);
	}
	rightValues.add(right);
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((entry, index) => exactPlainDataEqual(entry, right[index], seen));
	}
	if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	if (
		leftKeys.length !== rightKeys.length ||
		leftKeys.some((key, index) => key !== rightKeys[index])
	) {
		return false;
	}
	return leftKeys.every((key) => exactPlainDataEqual(left[key], right[key], seen));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
