import { describe, expect, it } from "vitest";
import {
	planProductionBayModule,
	validateProductionBayModuleRequest,
} from "../core/ProductionBayModulePlanner";
import { DIR_E } from "../core/railShape";
import {
	defaultOpenFabFabProfile,
	deriveOpenFabFabProfile,
	normalizeOpenFabFabProfile,
	OPENFAB_FAB_BANK_REPETITION_AXES,
	OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK,
	OPENFAB_FAB_BAY_PACKING_POLICIES,
	OPENFAB_FAB_LAYOUT_BLOCK_COUNTS,
	OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS,
	OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS,
	OPENFAB_FAB_PROCESS_LOOPS_PER_BANK,
	openFabFabProfileDerivationContractFingerprint,
	openFabFabProfileFingerprint,
	openFabFabProfilePlanFingerprint,
	openFabFabProfileProductionBayRequest,
	validateOpenFabFabProfile,
} from "./OpenFabFabProfile";
import { certifyProductionBayModule } from "./ProductionBayModuleCompiler";

describe("OpenFabFabProfile", () => {
	it("defines a conservative auto-fit default without legacy frontage or depth inputs", () => {
		const profile = defaultOpenFabFabProfile();
		const derived = deriveOpenFabFabProfile(profile);

		expect(profile).toEqual({
			kind: "openfab-fab-profile",
			version: 1,
			layoutBlockCount: 1,
			bankRepetitionAxis: "EAST_WEST",
			banksPerLayoutBlock: 2,
			processLoopsPerBank: 18,
			bayPackingPolicy: "BALANCED_V1",
			processLoopLongAxisMeters: 48,
			processLoopCenterPitchMeters: 14,
			layoutBlockArrangement: "LINEAR_V1",
			siteEnvelopePolicy: "AUTO_FIT",
			bankDistributorPolicy: "PAIRED_COLLECTOR_V1",
			circulationPolicy: "PAIRED_OPPOSITE_FLOW_V1",
			perimeterRedundancyPolicy: "OFF",
			interBlockConnectorPolicy: "PAIRED_DIRECTED_AUTO_V1",
		});
		expect(derived.policies).toEqual({
			layoutBlockArrangement: "LINEAR_V1",
			siteEnvelopePolicy: "AUTO_FIT",
			bankDistributorPolicy: "PAIRED_COLLECTOR_V1",
			circulationPolicy: "PAIRED_OPPOSITE_FLOW_V1",
			perimeterRedundancyPolicy: "OFF",
			interBlockConnectorPolicy: "PAIRED_DIRECTED_AUTO_V1",
			interBlockConnector: "NOT_REQUIRED",
		});
		expect(derived.counts).toEqual({
			fabs: 1,
			layoutBlocks: 1,
			banks: 2,
			bays: 24,
			singleBays: 12,
			twinBays: 12,
			processLoops: 36,
			organizationRecords: 63,
			internalProcessGatewayPairs: 48,
			internalProcessGatewayAdapters: 96,
			requiredBayToBankGatewayPairs: 24,
			requiredBankToDistributorGatewayPairs: 2,
			requiredInterBlockConnectors: 0,
		});
		expect(derived.dimensions).toEqual({
			processLoopLongAxisMeters: 48,
			processLoopLanePairWidthMeters: 4,
			processLoopCenterPitchMeters: 14,
			productionBayOuterLengthMeters: 54,
			singleBayOuterDepthMeters: 10,
			twinBayOuterDepthMeters: 24,
			bayShellGapMeters: 4,
			bankProcessSpanMeters: 248,
		});
		expect(derived.layoutBlocks[0]?.banks[0]?.bays.map((bay) => bay.variant)).toEqual([
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
		]);
		expect(derived.layoutBlocks[0]?.banks[1]?.bays.map((bay) => bay.variant)).toEqual([
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
			"TWIN",
			"SINGLE",
		]);
	});

	it("derives every public v1 profile deterministically without losing or duplicating a Process Loop", () => {
		const fingerprints = new Set<string>();
		let checked = 0;
		for (const layoutBlockCount of OPENFAB_FAB_LAYOUT_BLOCK_COUNTS) {
			for (const bankRepetitionAxis of OPENFAB_FAB_BANK_REPETITION_AXES) {
				for (const banksPerLayoutBlock of OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK) {
					for (const processLoopsPerBank of OPENFAB_FAB_PROCESS_LOOPS_PER_BANK) {
						for (const bayPackingPolicy of OPENFAB_FAB_BAY_PACKING_POLICIES) {
							for (const processLoopLongAxisMeters of OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS) {
								for (const processLoopCenterPitchMeters of OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS) {
									const profile = {
										...defaultOpenFabFabProfile(),
										layoutBlockCount,
										bankRepetitionAxis,
										banksPerLayoutBlock,
										processLoopsPerBank,
										bayPackingPolicy,
										processLoopLongAxisMeters,
										processLoopCenterPitchMeters,
									};
									expect(validateOpenFabFabProfile(profile)).toBeNull();
									const first = deriveOpenFabFabProfile(profile);
									const second = deriveOpenFabFabProfile({ ...profile });
									expect(second).toEqual(first);
									expect(second.profileFingerprint).toBe(first.profileFingerprint);
									fingerprints.add(first.profileFingerprint);

									const banks = first.layoutBlocks.flatMap((block) => block.banks);
									expect(banks).toHaveLength(layoutBlockCount * banksPerLayoutBlock);
									for (const bank of banks) {
										const loopOrdinals = bank.bays.flatMap((bay) => bay.processLoopOrdinals);
										expect(loopOrdinals).toEqual(
											Array.from({ length: processLoopsPerBank }, (_, ordinal) => ordinal),
										);
										expect(bank.bayCount).toBe(
											expectedBayCount(processLoopsPerBank, bayPackingPolicy),
										);
										for (let bayIndex = 0; bayIndex < bank.bays.length; bayIndex += 1) {
											const bay = bank.bays[bayIndex];
											if (!bay) throw new Error("Expected derived Bay packing placement.");
											expect(bay.shellOffsetMeters).toBe(
												bay.firstProcessLoopOrdinal * processLoopCenterPitchMeters,
											);
											expect(bay.shellDepthMeters).toBe(
												(bay.processLoopCount - 1) * processLoopCenterPitchMeters + 10,
											);
											expect(bay.processLoopCenterOffsetsMeters).toEqual(
												bay.processLoopOrdinals.map(
													(ordinal) => ordinal * processLoopCenterPitchMeters + 5,
												),
											);
											const next = bank.bays[bayIndex + 1];
											if (next) {
												expect(
													next.shellOffsetMeters - (bay.shellOffsetMeters + bay.shellDepthMeters),
												).toBe(processLoopCenterPitchMeters - 10);
											}
										}
									}
									expect(first.counts.organizationRecords).toBe(
										1 + first.counts.banks + first.counts.bays + first.counts.processLoops,
									);
									expect(first.counts.singleBays + first.counts.twinBays).toBe(first.counts.bays);
									expect(first.counts.singleBays + first.counts.twinBays * 2).toBe(
										first.counts.processLoops,
									);
									expect(first.counts.layoutBlocks).toBe(layoutBlockCount);
									expect(first.counts.requiredInterBlockConnectors).toBe(layoutBlockCount - 1);
									checked += 1;
								}
							}
						}
					}
				}
			}
		}
		expect(checked).toBe(1_458);
		expect(fingerprints.size).toBe(checked);
	});

	it("certifies all 18 profile combinations as 12 unique Bay geometries", () => {
		const bayFingerprints = new Set<string>();
		for (const processLoopLongAxisMeters of OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS) {
			for (const processLoopCenterPitchMeters of OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS) {
				const profile = {
					...defaultOpenFabFabProfile(),
					processLoopLongAxisMeters,
					processLoopCenterPitchMeters,
				};
				for (const processLoopCount of [1, 2] as const) {
					const request = openFabFabProfileProductionBayRequest(
						profile,
						processLoopCount,
						{ x: 0, y: 0 },
						{ forward: DIR_E, side: "right", flow: "forward" },
					);
					expect(validateProductionBayModuleRequest(request)).toBeNull();
					const plan = planProductionBayModule(request);
					expect(request.version).toBe(2);
					expect(plan.specification.version).toBe(2);
					expect(plan.specification.topologyPolicy).toBe("four-adapter-v1");
					bayFingerprints.add(plan.fingerprint);
					expect(plan.dimensions.processLoopLengthMeters).toBe(processLoopLongAxisMeters);
					expect(plan.dimensions.processLoopDepthMeters).toBe(4);
					expect(plan.dimensions.processLoopCount).toBe(processLoopCount);
					expect(plan.dimensions.outerLengthMeters).toBe(processLoopLongAxisMeters + 6);
					expect(plan.dimensions.outerDepthMeters).toBe(
						processLoopCount === 1 ? 10 : processLoopCenterPitchMeters + 10,
					);
					expect(plan.gatewayPairs).toHaveLength(2);
					expect(plan.adapterRoutes).toHaveLength(4);
					const certified = certifyProductionBayModule(request);
					expect(certified.placementReady).toBe(true);
					expect(certified.topology).toMatchObject({
						components: 1,
						strongComponents: 1,
						openEnds: 0,
					});
					expect(certified.physical).toMatchObject({
						valid: true,
						strongComponents: 1,
						openPaths: 0,
						clearanceIssueCount: 0,
					});
				}
			}
		}
		expect(bayFingerprints.size).toBe(12);
	});

	it("rejects legacy, missing, extra, and unsupported profile fields fail closed", () => {
		const valid = defaultOpenFabFabProfile();
		const invalid: readonly [unknown, RegExp][] = [
			[null, /must be an object/],
			[{ ...valid, version: 2 }, /version must be 1/],
			[{ ...valid, kind: "synthetic-fab-starter" }, /kind must be/],
			[{ ...valid, layoutBlockCount: 4 }, /count must be 1, 2, or 3/],
			[{ ...valid, bankRepetitionAxis: "DIAGONAL" }, /Bank repetition axis/],
			[{ ...valid, banksPerLayoutBlock: 4 }, /Banks per Layout Block/],
			[{ ...valid, processLoopsPerBank: 20 }, /Process Loops per Bank/],
			[{ ...valid, bayPackingPolicy: "BALANCED" }, /BALANCED_V1/],
			[{ ...valid, processLoopLongAxisMeters: 40 }, /long axis/],
			[{ ...valid, processLoopCenterPitchMeters: 15 }, /center pitch/],
			[{ ...valid, circulationPolicy: "SINGLE_LOOP_V1" }, /circulationPolicy/],
			[{ ...valid, perimeterRedundancyPolicy: "ON" }, /perimeterRedundancyPolicy/],
			[{ ...valid, frontageMeters: 48 }, /fields do not match/],
			[
				{
					version: 1,
					layoutBlockCount: 1,
					bankRepetitionAxis: "EAST_WEST",
					banksPerLayoutBlock: 2,
					processLoopsPerBank: 18,
					bayPackingPolicy: "BALANCED_V1",
					processLoopLongAxisMeters: 48,
					processLoopCenterPitchMeters: 14,
				},
				/fields do not match/,
			],
		];
		for (const [candidate, expected] of invalid) {
			expect(validateOpenFabFabProfile(candidate)).toMatch(expected);
			expect(() => normalizeOpenFabFabProfile(candidate)).toThrow(expected);
		}
	});

	it("normalizes into immutable owned values and fingerprints every authored choice", () => {
		const mutable = { ...defaultOpenFabFabProfile() };
		const normalized = normalizeOpenFabFabProfile(mutable);
		const fingerprint = openFabFabProfileFingerprint(normalized);

		expect(normalized).not.toBe(mutable);
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(fingerprint).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
		for (const variant of [
			{ ...normalized, layoutBlockCount: 2 as const },
			{ ...normalized, bankRepetitionAxis: "NORTH_SOUTH" as const },
			{ ...normalized, banksPerLayoutBlock: 3 as const },
			{ ...normalized, processLoopsPerBank: 24 as const },
			{ ...normalized, bayPackingPolicy: "TWIN" as const },
			{ ...normalized, processLoopLongAxisMeters: 56 as const },
			{ ...normalized, processLoopCenterPitchMeters: 16 as const },
		]) {
			expect(openFabFabProfileFingerprint(variant)).not.toBe(fingerprint);
		}
	});

	it("pins authored and compiler-owned identities independently", () => {
		const profile = defaultOpenFabFabProfile();
		const derived = deriveOpenFabFabProfile(profile);

		expect(derived.profileFingerprint).toBe(openFabFabProfileFingerprint(profile));
		expect(derived.derivationContractFingerprint).toBe(
			openFabFabProfileDerivationContractFingerprint(),
		);
		expect(derived.planFingerprint).toBe(openFabFabProfilePlanFingerprint(profile));
		// Golden vectors make an accidental policy, dependency-version, or constant drift explicit.
		expect(derived.profileFingerprint).toBe("5a84fc74:ab31ba72");
		expect(derived.derivationContractFingerprint).toBe("d38b54e6:149c52f1");
		expect(derived.planFingerprint).toBe("3c8f760e:c8d51cea");
	});

	it("reports the largest semantic profile without claiming portable-bundle eligibility", () => {
		const derived = deriveOpenFabFabProfile({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 3,
			banksPerLayoutBlock: 3,
			processLoopsPerBank: 24,
			bayPackingPolicy: "SINGLE",
			processLoopLongAxisMeters: 56,
			processLoopCenterPitchMeters: 16,
		});

		expect(derived.counts).toMatchObject({
			layoutBlocks: 3,
			banks: 9,
			bays: 216,
			singleBays: 216,
			twinBays: 0,
			processLoops: 216,
			organizationRecords: 442,
			requiredInterBlockConnectors: 2,
		});
		expect(derived.policies.interBlockConnector).toBe("PAIRED_DIRECTED_AUTO_V1");
	});
});

function expectedBayCount(
	processLoopsPerBank: number,
	policy: (typeof OPENFAB_FAB_BAY_PACKING_POLICIES)[number],
): number {
	if (policy === "SINGLE") return processLoopsPerBank;
	if (policy === "TWIN") return processLoopsPerBank / 2;
	return (processLoopsPerBank * 2) / 3;
}
