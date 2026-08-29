import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";

import {
	PRODUCTION_BAY_MODULE_PLAN_VERSION,
	PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY,
	type ProductionBayInternalFlowPattern,
	type ProductionBayModuleRequest,
	type ProductionBayProcessLoopCount,
} from "../core/ProductionBayModulePlanner";
import type { RailTemplatePose } from "../core/RailTemplateCatalog";
import type { Cell } from "../core/TileMap";

export const OPENFAB_FAB_PROFILE_KIND = "openfab-fab-profile" as const;
export const OPENFAB_FAB_PROFILE_V1_VERSION = 1 as const;
export const OPENFAB_FAB_PROFILE_CURRENT_VERSION = OPENFAB_FAB_PROFILE_V1_VERSION;
export const OPENFAB_FAB_PROFILE_DERIVATION_CONTRACT_VERSION = 1 as const;

export const OPENFAB_FAB_LAYOUT_BLOCK_COUNTS = Object.freeze([1, 2, 3] as const);
export const OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK = Object.freeze([1, 2, 3] as const);
export const OPENFAB_FAB_PROCESS_LOOPS_PER_BANK = Object.freeze([12, 18, 24] as const);
export const OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS = Object.freeze([36, 48, 56] as const);
export const OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS = Object.freeze([12, 14, 16] as const);
export const OPENFAB_FAB_BANK_REPETITION_AXES = Object.freeze([
	"EAST_WEST",
	"NORTH_SOUTH",
] as const);
export const OPENFAB_FAB_BAY_PACKING_POLICIES = Object.freeze([
	"SINGLE",
	"TWIN",
	"BALANCED_V1",
] as const);

export const OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS = 3 as const;
export const OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS = 4 as const;
export const OPENFAB_FAB_PROFILE_GATEWAY_LENGTH_METERS = 6 as const;
export const OPENFAB_FAB_PROFILE_INTERNAL_FLOW_PATTERN =
	"alternating" as const satisfies ProductionBayInternalFlowPattern;
export const OPENFAB_FAB_PROFILE_PACKING_CONTRACT = "center-pitch-shell-pack-v1" as const;

export const OPENFAB_FAB_PROFILE_V1_POLICIES = Object.freeze({
	layoutBlockArrangement: "LINEAR_V1" as const,
	siteEnvelopePolicy: "AUTO_FIT" as const,
	bankDistributorPolicy: "PAIRED_COLLECTOR_V1" as const,
	circulationPolicy: "PAIRED_OPPOSITE_FLOW_V1" as const,
	perimeterRedundancyPolicy: "OFF" as const,
	interBlockConnectorPolicy: "PAIRED_DIRECTED_AUTO_V1" as const,
});

export type OpenFabFabLayoutBlockCount = (typeof OPENFAB_FAB_LAYOUT_BLOCK_COUNTS)[number];
export type OpenFabFabBanksPerLayoutBlock = (typeof OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK)[number];
export type OpenFabFabProcessLoopsPerBank = (typeof OPENFAB_FAB_PROCESS_LOOPS_PER_BANK)[number];
export type OpenFabFabProcessLoopLongAxisMeters =
	(typeof OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS)[number];
export type OpenFabFabProcessLoopCenterPitchMeters =
	(typeof OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS)[number];
export type OpenFabFabBankRepetitionAxis = (typeof OPENFAB_FAB_BANK_REPETITION_AXES)[number];
export type OpenFabFabBayPackingPolicy = (typeof OPENFAB_FAB_BAY_PACKING_POLICIES)[number];

/**
 * Versioned user intent for a complete Fab. Layout Blocks are generator-only placement groups;
 * they are deliberately absent from the serialized organization hierarchy.
 */
export interface OpenFabFabProfileV1 {
	readonly kind: typeof OPENFAB_FAB_PROFILE_KIND;
	readonly version: typeof OPENFAB_FAB_PROFILE_V1_VERSION;
	readonly layoutBlockCount: OpenFabFabLayoutBlockCount;
	/** Axis along which Process Loop centers repeat inside each Bank. */
	readonly bankRepetitionAxis: OpenFabFabBankRepetitionAxis;
	readonly banksPerLayoutBlock: OpenFabFabBanksPerLayoutBlock;
	readonly processLoopsPerBank: OpenFabFabProcessLoopsPerBank;
	readonly bayPackingPolicy: OpenFabFabBayPackingPolicy;
	readonly processLoopLongAxisMeters: OpenFabFabProcessLoopLongAxisMeters;
	readonly processLoopCenterPitchMeters: OpenFabFabProcessLoopCenterPitchMeters;
	/** Supported whole-Fab policies are explicit even while V1 offers one fixed choice. */
	readonly layoutBlockArrangement: typeof OPENFAB_FAB_PROFILE_V1_POLICIES.layoutBlockArrangement;
	readonly siteEnvelopePolicy: typeof OPENFAB_FAB_PROFILE_V1_POLICIES.siteEnvelopePolicy;
	readonly bankDistributorPolicy: typeof OPENFAB_FAB_PROFILE_V1_POLICIES.bankDistributorPolicy;
	readonly circulationPolicy: typeof OPENFAB_FAB_PROFILE_V1_POLICIES.circulationPolicy;
	readonly perimeterRedundancyPolicy: typeof OPENFAB_FAB_PROFILE_V1_POLICIES.perimeterRedundancyPolicy;
	readonly interBlockConnectorPolicy: typeof OPENFAB_FAB_PROFILE_V1_POLICIES.interBlockConnectorPolicy;
}

export type OpenFabFabProfile = OpenFabFabProfileV1;

export type OpenFabFabBayVariant = "SINGLE" | "TWIN";

export interface OpenFabFabBayPackingPlacement {
	readonly ordinal: number;
	readonly variant: OpenFabFabBayVariant;
	readonly processLoopCount: ProductionBayProcessLoopCount;
	readonly firstProcessLoopOrdinal: number;
	readonly processLoopOrdinals: readonly number[];
	readonly processLoopCenterOffsetsMeters: readonly number[];
	readonly shellOffsetMeters: number;
	readonly shellDepthMeters: number;
}

export interface OpenFabFabBankPackingPlan {
	readonly ordinal: number;
	readonly layoutBlockOrdinal: number;
	readonly ordinalWithinLayoutBlock: number;
	readonly balancedPhase: 0 | 1;
	readonly processLoopCount: OpenFabFabProcessLoopsPerBank;
	readonly bayCount: number;
	readonly processSpanMeters: number;
	readonly bays: readonly OpenFabFabBayPackingPlacement[];
}

export interface OpenFabFabLayoutBlockPackingPlan {
	readonly ordinal: number;
	readonly banks: readonly OpenFabFabBankPackingPlan[];
}

export interface OpenFabFabProfileCounts {
	readonly fabs: 1;
	readonly layoutBlocks: number;
	readonly banks: number;
	readonly bays: number;
	readonly singleBays: number;
	readonly twinBays: number;
	readonly processLoops: number;
	/** Layout Blocks are intentionally excluded. */
	readonly organizationRecords: number;
	/** Production Bay v2 materializes two branch/merge pairs per Bay. */
	readonly internalProcessGatewayPairs: number;
	/** Production Bay v2 materializes four directed adapters per Bay. */
	readonly internalProcessGatewayAdapters: number;
	/** One typed parent-connection pair is required for each Bay in the whole-Fab composer. */
	readonly requiredBayToBankGatewayPairs: number;
	readonly requiredBankToDistributorGatewayPairs: number;
	readonly requiredInterBlockConnectors: number;
}

export interface OpenFabFabProfileDimensions {
	readonly processLoopLongAxisMeters: OpenFabFabProcessLoopLongAxisMeters;
	readonly processLoopLanePairWidthMeters: typeof OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS;
	readonly processLoopCenterPitchMeters: OpenFabFabProcessLoopCenterPitchMeters;
	readonly productionBayOuterLengthMeters: number;
	readonly singleBayOuterDepthMeters: number;
	readonly twinBayOuterDepthMeters: number;
	readonly bayShellGapMeters: number;
	readonly bankProcessSpanMeters: number;
}

export interface OpenFabFabProfileDerived {
	readonly kind: "openfab-fab-profile-derived";
	readonly version: typeof OPENFAB_FAB_PROFILE_V1_VERSION;
	readonly profile: OpenFabFabProfile;
	readonly profileFingerprint: string;
	readonly derivationContractFingerprint: string;
	readonly planFingerprint: string;
	readonly policies: typeof OPENFAB_FAB_PROFILE_V1_POLICIES &
		Readonly<{
			interBlockConnector: "NOT_REQUIRED" | "PAIRED_DIRECTED_AUTO_V1";
		}>;
	readonly counts: OpenFabFabProfileCounts;
	readonly dimensions: OpenFabFabProfileDimensions;
	readonly layoutBlocks: readonly OpenFabFabLayoutBlockPackingPlan[];
}

const OPENFAB_FAB_PROFILE_KEYS = Object.freeze([
	"kind",
	"version",
	"layoutBlockCount",
	"bankRepetitionAxis",
	"banksPerLayoutBlock",
	"processLoopsPerBank",
	"bayPackingPolicy",
	"processLoopLongAxisMeters",
	"processLoopCenterPitchMeters",
	"layoutBlockArrangement",
	"siteEnvelopePolicy",
	"bankDistributorPolicy",
	"circulationPolicy",
	"perimeterRedundancyPolicy",
	"interBlockConnectorPolicy",
] as const);

const DEFAULT_OPENFAB_FAB_PROFILE = Object.freeze({
	kind: OPENFAB_FAB_PROFILE_KIND,
	version: OPENFAB_FAB_PROFILE_V1_VERSION,
	layoutBlockCount: 1 as const,
	bankRepetitionAxis: "EAST_WEST" as const,
	banksPerLayoutBlock: 2 as const,
	processLoopsPerBank: 18 as const,
	bayPackingPolicy: "BALANCED_V1" as const,
	processLoopLongAxisMeters: 48 as const,
	processLoopCenterPitchMeters: 14 as const,
	...OPENFAB_FAB_PROFILE_V1_POLICIES,
}) satisfies OpenFabFabProfile;

export function defaultOpenFabFabProfile(): OpenFabFabProfile {
	return DEFAULT_OPENFAB_FAB_PROFILE;
}

export function validateOpenFabFabProfile(input: unknown): string | null {
	if (!isRecord(input)) return "OpenFab Fab profile must be an object.";
	if (!hasExactKeys(input, OPENFAB_FAB_PROFILE_KEYS)) {
		return "OpenFab Fab profile fields do not match the version 1 contract.";
	}
	if (input.kind !== OPENFAB_FAB_PROFILE_KIND) {
		return `OpenFab Fab profile kind must be ${OPENFAB_FAB_PROFILE_KIND}.`;
	}
	if (input.version !== OPENFAB_FAB_PROFILE_V1_VERSION) {
		return `OpenFab Fab profile version must be ${OPENFAB_FAB_PROFILE_V1_VERSION}.`;
	}
	if (!includes(OPENFAB_FAB_LAYOUT_BLOCK_COUNTS, input.layoutBlockCount)) {
		return "Layout Block count must be 1, 2, or 3.";
	}
	if (!includes(OPENFAB_FAB_BANK_REPETITION_AXES, input.bankRepetitionAxis)) {
		return 'Bank repetition axis must be "EAST_WEST" or "NORTH_SOUTH".';
	}
	if (!includes(OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK, input.banksPerLayoutBlock)) {
		return "Banks per Layout Block must be 1, 2, or 3.";
	}
	if (!includes(OPENFAB_FAB_PROCESS_LOOPS_PER_BANK, input.processLoopsPerBank)) {
		return "Process Loops per Bank must be 12, 18, or 24.";
	}
	if (!includes(OPENFAB_FAB_BAY_PACKING_POLICIES, input.bayPackingPolicy)) {
		return 'Bay packing policy must be "SINGLE", "TWIN", or "BALANCED_V1".';
	}
	if (!includes(OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS, input.processLoopLongAxisMeters)) {
		return "Process Loop long axis must be 36, 48, or 56 meters.";
	}
	if (
		!includes(OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS, input.processLoopCenterPitchMeters)
	) {
		return "Process Loop center pitch must be 12, 14, or 16 meters.";
	}
	for (const [key, expected] of Object.entries(OPENFAB_FAB_PROFILE_V1_POLICIES)) {
		if (input[key] !== expected) {
			return `OpenFab Fab profile ${key} must be ${expected}.`;
		}
	}
	return null;
}

export function normalizeOpenFabFabProfile(input: unknown): OpenFabFabProfile {
	const error = validateOpenFabFabProfile(input);
	if (error) throw new RangeError(error);
	const profile = input as unknown as OpenFabFabProfile;
	return Object.freeze({
		kind: OPENFAB_FAB_PROFILE_KIND,
		version: OPENFAB_FAB_PROFILE_V1_VERSION,
		layoutBlockCount: profile.layoutBlockCount,
		bankRepetitionAxis: profile.bankRepetitionAxis,
		banksPerLayoutBlock: profile.banksPerLayoutBlock,
		processLoopsPerBank: profile.processLoopsPerBank,
		bayPackingPolicy: profile.bayPackingPolicy,
		processLoopLongAxisMeters: profile.processLoopLongAxisMeters,
		processLoopCenterPitchMeters: profile.processLoopCenterPitchMeters,
		layoutBlockArrangement: profile.layoutBlockArrangement,
		siteEnvelopePolicy: profile.siteEnvelopePolicy,
		bankDistributorPolicy: profile.bankDistributorPolicy,
		circulationPolicy: profile.circulationPolicy,
		perimeterRedundancyPolicy: profile.perimeterRedundancyPolicy,
		interBlockConnectorPolicy: profile.interBlockConnectorPolicy,
	});
}

export function openFabFabProfileFingerprint(input: unknown): string {
	const profile = normalizeOpenFabFabProfile(input);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		profile.kind,
		profile.bankRepetitionAxis,
		profile.bayPackingPolicy,
		profile.layoutBlockArrangement,
		profile.siteEnvelopePolicy,
		profile.bankDistributorPolicy,
		profile.circulationPolicy,
		profile.perimeterRedundancyPolicy,
		profile.interBlockConnectorPolicy,
	]);
	checksum.addNumbers([
		profile.version,
		profile.layoutBlockCount,
		profile.banksPerLayoutBlock,
		profile.processLoopsPerBank,
		profile.processLoopLongAxisMeters,
		profile.processLoopCenterPitchMeters,
	]);
	return checksum.digest();
}

/**
 * Fingerprints compiler-owned rules separately from authored intent. A V1 profile therefore
 * cannot silently materialize different Bay geometry after a dependency or hidden rule change.
 */
export function openFabFabProfileDerivationContractFingerprint(): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		OPENFAB_FAB_PROFILE_PACKING_CONTRACT,
		PRODUCTION_BAY_MODULE_TOPOLOGY_POLICY,
		OPENFAB_FAB_PROFILE_INTERNAL_FLOW_PATTERN,
	]);
	checksum.addNumbers([
		OPENFAB_FAB_PROFILE_DERIVATION_CONTRACT_VERSION,
		PRODUCTION_BAY_MODULE_PLAN_VERSION,
		OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS,
		OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS,
		OPENFAB_FAB_PROFILE_GATEWAY_LENGTH_METERS,
	]);
	return checksum.digest();
}

export function openFabFabProfilePlanFingerprint(input: unknown): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		openFabFabProfileFingerprint(input),
		openFabFabProfileDerivationContractFingerprint(),
	]);
	return checksum.digest();
}

export function deriveOpenFabFabProfile(input: unknown): OpenFabFabProfileDerived {
	const profile = normalizeOpenFabFabProfile(input);
	const layoutBlocks: OpenFabFabLayoutBlockPackingPlan[] = [];
	let globalBankOrdinal = 0;
	let totalBays = 0;
	let totalSingleBays = 0;
	let totalTwinBays = 0;
	for (
		let layoutBlockOrdinal = 0;
		layoutBlockOrdinal < profile.layoutBlockCount;
		layoutBlockOrdinal += 1
	) {
		const banks: OpenFabFabBankPackingPlan[] = [];
		for (
			let ordinalWithinLayoutBlock = 0;
			ordinalWithinLayoutBlock < profile.banksPerLayoutBlock;
			ordinalWithinLayoutBlock += 1
		) {
			const bank = deriveBankPackingPlan(
				profile,
				globalBankOrdinal,
				layoutBlockOrdinal,
				ordinalWithinLayoutBlock,
			);
			banks.push(bank);
			totalBays += bank.bayCount;
			totalSingleBays += bank.bays.filter((bay) => bay.variant === "SINGLE").length;
			totalTwinBays += bank.bays.filter((bay) => bay.variant === "TWIN").length;
			globalBankOrdinal += 1;
		}
		layoutBlocks.push(
			Object.freeze({
				ordinal: layoutBlockOrdinal,
				banks: Object.freeze(banks),
			}),
		);
	}

	const totalBanks = profile.layoutBlockCount * profile.banksPerLayoutBlock;
	const totalProcessLoops = totalBanks * profile.processLoopsPerBank;
	const counts = Object.freeze({
		fabs: 1 as const,
		layoutBlocks: profile.layoutBlockCount,
		banks: totalBanks,
		bays: totalBays,
		singleBays: totalSingleBays,
		twinBays: totalTwinBays,
		processLoops: totalProcessLoops,
		organizationRecords: 1 + totalBanks + totalBays + totalProcessLoops,
		internalProcessGatewayPairs: totalBays * 2,
		internalProcessGatewayAdapters: totalBays * 4,
		requiredBayToBankGatewayPairs: totalBays,
		requiredBankToDistributorGatewayPairs: totalBanks,
		requiredInterBlockConnectors: Math.max(0, profile.layoutBlockCount - 1),
	}) satisfies OpenFabFabProfileCounts;
	const dimensions = Object.freeze({
		processLoopLongAxisMeters: profile.processLoopLongAxisMeters,
		processLoopLanePairWidthMeters: OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS,
		processLoopCenterPitchMeters: profile.processLoopCenterPitchMeters,
		productionBayOuterLengthMeters:
			profile.processLoopLongAxisMeters + OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
		singleBayOuterDepthMeters:
			OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
			OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
		twinBayOuterDepthMeters:
			profile.processLoopCenterPitchMeters +
			OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
			OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
		bayShellGapMeters:
			profile.processLoopCenterPitchMeters -
			(OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
				OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2),
		bankProcessSpanMeters:
			(profile.processLoopsPerBank - 1) * profile.processLoopCenterPitchMeters +
			OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
			OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
	}) satisfies OpenFabFabProfileDimensions;
	const policies = Object.freeze({
		layoutBlockArrangement: profile.layoutBlockArrangement,
		siteEnvelopePolicy: profile.siteEnvelopePolicy,
		bankDistributorPolicy: profile.bankDistributorPolicy,
		circulationPolicy: profile.circulationPolicy,
		perimeterRedundancyPolicy: profile.perimeterRedundancyPolicy,
		interBlockConnectorPolicy: profile.interBlockConnectorPolicy,
		interBlockConnector:
			profile.layoutBlockCount === 1
				? ("NOT_REQUIRED" as const)
				: profile.interBlockConnectorPolicy,
	});
	return Object.freeze({
		kind: "openfab-fab-profile-derived" as const,
		version: OPENFAB_FAB_PROFILE_V1_VERSION,
		profile,
		profileFingerprint: openFabFabProfileFingerprint(profile),
		derivationContractFingerprint: openFabFabProfileDerivationContractFingerprint(),
		planFingerprint: openFabFabProfilePlanFingerprint(profile),
		policies,
		counts,
		dimensions,
		layoutBlocks: Object.freeze(layoutBlocks),
	});
}

/** Stable identity for the complete compiler-derived packing payload, not only public intent. */
export function openFabFabProfileDerivedFingerprint(derived: OpenFabFabProfileDerived): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		derived.kind,
		derived.profileFingerprint,
		derived.derivationContractFingerprint,
		derived.planFingerprint,
		derived.policies.layoutBlockArrangement,
		derived.policies.siteEnvelopePolicy,
		derived.policies.bankDistributorPolicy,
		derived.policies.circulationPolicy,
		derived.policies.perimeterRedundancyPolicy,
		derived.policies.interBlockConnectorPolicy,
		derived.policies.interBlockConnector,
	]);
	checksum.addNumbers([
		derived.version,
		derived.counts.fabs,
		derived.counts.layoutBlocks,
		derived.counts.banks,
		derived.counts.bays,
		derived.counts.singleBays,
		derived.counts.twinBays,
		derived.counts.processLoops,
		derived.counts.organizationRecords,
		derived.counts.internalProcessGatewayPairs,
		derived.counts.internalProcessGatewayAdapters,
		derived.counts.requiredBayToBankGatewayPairs,
		derived.counts.requiredBankToDistributorGatewayPairs,
		derived.counts.requiredInterBlockConnectors,
		derived.dimensions.processLoopLongAxisMeters,
		derived.dimensions.processLoopLanePairWidthMeters,
		derived.dimensions.processLoopCenterPitchMeters,
		derived.dimensions.productionBayOuterLengthMeters,
		derived.dimensions.singleBayOuterDepthMeters,
		derived.dimensions.twinBayOuterDepthMeters,
		derived.dimensions.bayShellGapMeters,
		derived.dimensions.bankProcessSpanMeters,
		derived.layoutBlocks.length,
	]);
	for (const block of derived.layoutBlocks) {
		checksum.addNumbers([block.ordinal, block.banks.length]);
		for (const bank of block.banks) {
			checksum.addNumbers([
				bank.ordinal,
				bank.layoutBlockOrdinal,
				bank.ordinalWithinLayoutBlock,
				bank.balancedPhase,
				bank.processLoopCount,
				bank.bayCount,
				bank.processSpanMeters,
				bank.bays.length,
			]);
			for (const bay of bank.bays) {
				checksum.addStrings([bay.variant]);
				checksum.addNumbers([
					bay.ordinal,
					bay.processLoopCount,
					bay.firstProcessLoopOrdinal,
					bay.shellOffsetMeters,
					bay.shellDepthMeters,
					bay.processLoopOrdinals.length,
					...bay.processLoopOrdinals,
					bay.processLoopCenterOffsetsMeters.length,
					...bay.processLoopCenterOffsetsMeters,
				]);
			}
		}
	}
	return `openfab-fab-profile-derived:v${OPENFAB_FAB_PROFILE_V1_VERSION}:${checksum.digest()}`;
}

export function openFabFabProfileProductionBayRequest(
	input: unknown,
	processLoopCount: ProductionBayProcessLoopCount,
	anchor: Cell,
	pose: RailTemplatePose,
): ProductionBayModuleRequest {
	const profile = normalizeOpenFabFabProfile(input);
	if (processLoopCount !== 1 && processLoopCount !== 2) {
		throw new RangeError("OpenFab Production Bay process-loop count must be 1 or 2.");
	}
	return Object.freeze({
		version: PRODUCTION_BAY_MODULE_PLAN_VERSION,
		anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
		outerLengthMeters:
			profile.processLoopLongAxisMeters + OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
		outerDepthMeters:
			processLoopCount === 1
				? OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
					OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2
				: profile.processLoopCenterPitchMeters +
					OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
					OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
		shellMarginMeters: OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS,
		processLoopGapMeters:
			processLoopCount === 1
				? OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS
				: profile.processLoopCenterPitchMeters -
					OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS,
		gatewayLengthMeters: OPENFAB_FAB_PROFILE_GATEWAY_LENGTH_METERS,
		processLoopCount,
		internalFlowPattern: OPENFAB_FAB_PROFILE_INTERNAL_FLOW_PATTERN,
		pose: Object.freeze({ ...pose }),
	});
}

function deriveBankPackingPlan(
	profile: OpenFabFabProfile,
	ordinal: number,
	layoutBlockOrdinal: number,
	ordinalWithinLayoutBlock: number,
): OpenFabFabBankPackingPlan {
	const balancedPhase = (ordinal % 2) as 0 | 1;
	const variants = bayVariants(
		profile.processLoopsPerBank,
		profile.bayPackingPolicy,
		balancedPhase,
	);
	const bays: OpenFabFabBayPackingPlacement[] = [];
	let processLoopOrdinal = 0;
	for (let bayOrdinal = 0; bayOrdinal < variants.length; bayOrdinal += 1) {
		const variant = variants[bayOrdinal] as OpenFabFabBayVariant;
		const processLoopCount = variant === "SINGLE" ? 1 : 2;
		const processLoopOrdinals = Array.from(
			{ length: processLoopCount },
			(_, offset) => processLoopOrdinal + offset,
		);
		const processLoopCenterOffsetsMeters = processLoopOrdinals.map(
			(loopOrdinal) =>
				loopOrdinal * profile.processLoopCenterPitchMeters +
				OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS +
				OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS / 2,
		);
		bays.push(
			Object.freeze({
				ordinal: bayOrdinal,
				variant,
				processLoopCount,
				firstProcessLoopOrdinal: processLoopOrdinal,
				processLoopOrdinals: Object.freeze(processLoopOrdinals),
				processLoopCenterOffsetsMeters: Object.freeze(processLoopCenterOffsetsMeters),
				shellOffsetMeters: processLoopOrdinal * profile.processLoopCenterPitchMeters,
				shellDepthMeters:
					(processLoopCount - 1) * profile.processLoopCenterPitchMeters +
					OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
					OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
			}),
		);
		processLoopOrdinal += processLoopCount;
	}
	if (processLoopOrdinal !== profile.processLoopsPerBank) {
		throw new Error("OpenFab Bay packing did not preserve the requested Process Loop count.");
	}
	return Object.freeze({
		ordinal,
		layoutBlockOrdinal,
		ordinalWithinLayoutBlock,
		balancedPhase,
		processLoopCount: profile.processLoopsPerBank,
		bayCount: bays.length,
		processSpanMeters:
			(profile.processLoopsPerBank - 1) * profile.processLoopCenterPitchMeters +
			OPENFAB_FAB_PROFILE_PROCESS_LOOP_LANE_PAIR_WIDTH_METERS +
			OPENFAB_FAB_PROFILE_SHELL_MARGIN_METERS * 2,
		bays: Object.freeze(bays),
	});
}

function bayVariants(
	processLoopCount: OpenFabFabProcessLoopsPerBank,
	policy: OpenFabFabBayPackingPolicy,
	balancedPhase: 0 | 1,
): readonly OpenFabFabBayVariant[] {
	if (policy === "SINGLE") return Object.freeze(Array(processLoopCount).fill("SINGLE"));
	if (policy === "TWIN") return Object.freeze(Array(processLoopCount / 2).fill("TWIN"));
	const variants: OpenFabFabBayVariant[] = [];
	const pair: readonly OpenFabFabBayVariant[] =
		balancedPhase === 0 ? ["SINGLE", "TWIN"] : ["TWIN", "SINGLE"];
	for (let consumedLoops = 0; consumedLoops < processLoopCount; consumedLoops += 3) {
		variants.push(...pair);
	}
	return Object.freeze(variants);
}

function includes<T>(values: readonly T[], value: unknown): value is T {
	return values.includes(value as T);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
