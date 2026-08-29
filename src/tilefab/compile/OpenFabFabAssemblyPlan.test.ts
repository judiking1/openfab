import { describe, expect, it } from "vitest";
import {
	createOpenFabFabAssemblyPlan,
	OPENFAB_FAB_ASSEMBLY_PLAN_VERSION,
	type OpenFabFabAssemblyPlan,
	openFabFabAssemblyLayoutContractFingerprint,
	openFabFabAssemblyPlanFingerprint,
	validateOpenFabFabAssemblyPlan,
} from "./OpenFabFabAssemblyPlan";
import {
	defaultOpenFabFabProfile,
	OPENFAB_FAB_BANK_REPETITION_AXES,
	OPENFAB_FAB_BAY_PACKING_POLICIES,
	OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS,
} from "./OpenFabFabProfile";

describe("OpenFabFabAssemblyPlan", () => {
	it("places the default semantic Fab inside one auto-fit Layout Block", () => {
		const plan = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());

		expect(plan).toMatchObject({
			kind: "openfab-fab-assembly-plan",
			version: OPENFAB_FAB_ASSEMBLY_PLAN_VERSION,
			bounds: { minX: 0, minY: 0, maxX: 328, maxY: 212 },
			capacity: {
				primitiveDirectedEdges: 11_288,
				upperLinkDirectedEdges: 144,
				plannedDirectedEdges: 11_432,
				plannedBayToBankGatewayPairs: 24,
				plannedBankToBlockGatewayPairs: 2,
				plannedInterBlockConnectorPairs: 0,
				portableBundleDirectedEdgeLimit: 65_536,
				portableBundleKnownHeadroom: 54_104,
				portableBundleEligibility: "REQUIRES_EXACT_COMPOSITION",
			},
		});
		expect(plan.layoutBlocks).toHaveLength(1);
		expect(plan.layoutBlocks[0]?.banks).toHaveLength(2);
		expect(plan.layoutBlocks[0]?.banks[0]?.bays).toHaveLength(12);
		expect(plan.layoutBlocks[0]?.banks[0]?.collector.specification).toMatchObject({
			anchor: { x: 24, y: 24 },
			lengthMeters: 280,
			laneSpacingMeters: 2,
		});
		expect(plan.layoutBlocks[0]?.banks[0]?.bays[0]).toMatchObject({
			anchor: { x: 40, y: 36 },
			plan: { dimensions: { outerLengthMeters: 54, outerDepthMeters: 10 } },
		});
		expect(plan.layoutBlocks[0]?.banks[1]?.collector.specification.anchor).toEqual({
			x: 24,
			y: 122,
		});
		expect(plan.layoutBlocks[0]?.banks[0]?.parentGateway.connections).toMatchObject([
			{
				branchCell: { x: 32, y: 24 },
				mergeCell: { x: 4, y: 16 },
			},
			{
				branchCell: { x: 4, y: 34 },
				mergeCell: { x: 32, y: 26 },
			},
		]);
		expect(plan.interBlockBridges).toHaveLength(0);
		expect(plan.layoutContractFingerprint).toBe(openFabFabAssemblyLayoutContractFingerprint());
		expect(plan.layoutContractFingerprint).toBe("121f1a6b:088df943");
		expect(plan.fingerprint).toBe("d76c56ba:3cdf23f4");
	});

	it("keeps every Bay shell inside its Block and preserves the requested pitch allocation", () => {
		for (const bankRepetitionAxis of OPENFAB_FAB_BANK_REPETITION_AXES) {
			for (const bayPackingPolicy of OPENFAB_FAB_BAY_PACKING_POLICIES) {
				for (const processLoopCenterPitchMeters of OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS) {
					const plan = createOpenFabFabAssemblyPlan({
						...defaultOpenFabFabProfile(),
						bankRepetitionAxis,
						banksPerLayoutBlock: 1,
						processLoopsPerBank: 12,
						bayPackingPolicy,
						processLoopCenterPitchMeters,
					});
					const block = plan.layoutBlocks[0];
					const bank = block?.banks[0];
					if (!block || !bank) throw new Error("Expected one planned Layout Block and Bank.");
					for (const bay of bank.bays) {
						const bounds = bay.plan.bounds;
						expect(bounds.minX).toBeGreaterThanOrEqual(block.bounds.minX + 4);
						expect(bounds.minY).toBeGreaterThanOrEqual(block.bounds.minY + 4);
						expect(bounds.maxX).toBeLessThanOrEqual(block.bounds.maxX - 4);
						expect(bounds.maxY).toBeLessThanOrEqual(block.bounds.maxY - 4);
					}
					expect(bank.bays.flatMap((bay) => bay.processLoopOrganizationKeys)).toHaveLength(12);
				}
			}
		}
	});

	it("transposes one Block without changing primitive counts", () => {
		const eastWest = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());
		const northSouth = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			bankRepetitionAxis: "NORTH_SOUTH",
		});

		expect(northSouth.bounds).toEqual({
			minX: 0,
			minY: 0,
			maxX: eastWest.bounds.maxY,
			maxY: eastWest.bounds.maxX,
		});
		expect(northSouth.capacity.primitiveDirectedEdges).toBe(
			eastWest.capacity.primitiveDirectedEdges,
		);
		expect(northSouth.layoutBlocks[0]?.banks[0]?.collector.specification.anchor).toEqual({
			x: 90,
			y: 24,
		});
		expect(northSouth.layoutBlocks[0]?.banks[0]?.bays[0]?.anchor).toEqual({ x: 78, y: 40 });
		expect(northSouth.layoutBlocks[0]?.banks[0]?.parentGateway.connections).toMatchObject([
			{
				branchCell: { x: 90, y: 32 },
				mergeCell: { x: 98, y: 4 },
			},
			{
				branchCell: { x: 80, y: 4 },
				mergeCell: { x: 88, y: 32 },
			},
		]);
		expect(northSouth.fingerprint).not.toBe(eastWest.fingerprint);
	});

	it("rejects a copied plan whose public profile diverges from its derived identity", () => {
		const plan = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());
		const withoutFingerprint = omitAssemblyPlanFingerprint(plan);
		expect(() =>
			openFabFabAssemblyPlanFingerprint({
				...withoutFingerprint,
				profile: Object.freeze({
					...plan.profile,
					bankRepetitionAxis: "NORTH_SOUTH",
				}),
			}),
		).toThrow(/profile does not match/i);
	});

	it("binds the materialized perimeter turnback and closed collector routes", () => {
		const plan = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());
		const withoutFingerprint = omitAssemblyPlanFingerprint(plan);
		const block = plan.layoutBlocks[0];
		const bank = block?.banks[0];
		if (!block || !bank) throw new Error("Expected the default Block and Bank.");
		const [originTurnback, farTurnback] = block.perimeterTurnbackRoutes;
		if (!originTurnback || !farTurnback) throw new Error("Expected perimeter turnbacks.");

		const tamperedTurnback = openFabFabAssemblyPlanFingerprint({
			...withoutFingerprint,
			layoutBlocks: Object.freeze([
				Object.freeze({
					...block,
					perimeterTurnbackRoutes: Object.freeze([
						Object.freeze(originTurnback.slice(0, -1)),
						farTurnback,
					]) as unknown as typeof block.perimeterTurnbackRoutes,
				}),
			]),
		});
		const tamperedCollector = openFabFabAssemblyPlanFingerprint({
			...withoutFingerprint,
			layoutBlocks: Object.freeze([
				Object.freeze({
					...block,
					banks: Object.freeze([
						Object.freeze({
							...bank,
							closedCollectorRoute: Object.freeze(bank.closedCollectorRoute.slice(0, -1)),
						}),
						...block.banks.slice(1),
					]),
				}),
			]),
		});

		expect(tamperedTurnback).not.toBe(plan.fingerprint);
		expect(tamperedCollector).not.toBe(plan.fingerprint);
	});

	it("rejects copied compiler-derived packing evidence", () => {
		const plan = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());
		const withoutFingerprint = omitAssemblyPlanFingerprint(plan);
		expect(() =>
			openFabFabAssemblyPlanFingerprint({
				...withoutFingerprint,
				profileDerived: Object.freeze({
					...plan.profileDerived,
					dimensions: Object.freeze({
						...plan.profileDerived.dimensions,
						bankProcessSpanMeters: 999,
					}),
				}),
			}),
		).toThrow(/derived profile identity/i);
	});

	it("rejects stale nested executable gateway evidence even when its claimed digest is retained", () => {
		const plan = createOpenFabFabAssemblyPlan(defaultOpenFabFabProfile());
		const block = plan.layoutBlocks[0];
		const bank = block?.banks[0];
		const firstStep = bank?.parentGateway.buildSteps[0];
		if (!block || !bank || !firstStep) throw new Error("Expected a Bank parent gateway step.");
		const forged = Object.freeze({
			...plan,
			layoutBlocks: Object.freeze([
				Object.freeze({
					...block,
					banks: Object.freeze([
						Object.freeze({
							...bank,
							parentGateway: Object.freeze({
								...bank.parentGateway,
								buildSteps: Object.freeze([
									Object.freeze({
										...firstStep,
										route: Object.freeze(firstStep.route.slice(0, -1)),
									}),
									...bank.parentGateway.buildSteps.slice(1),
								]),
							}),
						}),
						...block.banks.slice(1),
					]),
				}),
			]),
		});

		expect(validateOpenFabFabAssemblyPlan(plan)).toBeNull();
		expect(validateOpenFabFabAssemblyPlan(forged)).toMatch(/does not match the canonical plan/i);
	});

	it("lays out multiple generator-only Blocks linearly with typed bridge contracts", () => {
		const plan = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 3,
		});

		expect(plan.layoutBlocks.map((block) => block.bounds)).toEqual([
			{ minX: 0, minY: 0, maxX: 328, maxY: 212 },
			{ minX: 392, minY: 0, maxX: 720, maxY: 212 },
			{ minX: 784, minY: 0, maxX: 1112, maxY: 212 },
		]);
		expect(
			plan.interBlockBridges.map((bridge) => bridge.junctions.map((entry) => entry.cell)),
		).toEqual([
			[
				{ x: 328, y: 24 },
				{ x: 392, y: 24 },
				{ x: 392, y: 32 },
				{ x: 328, y: 32 },
			],
			[
				{ x: 720, y: 24 },
				{ x: 784, y: 24 },
				{ x: 784, y: 32 },
				{ x: 720, y: 32 },
			],
		]);
		expect(plan.capacity.plannedInterBlockConnectorPairs).toBe(2);
		expect(plan.capacity.upperLinkDirectedEdges).toBe(688);
		expect(plan.profileDerived.counts.layoutBlocks).toBe(3);
	});

	it("keeps the largest public layout inside low-level planner extent limits", () => {
		const plan = createOpenFabFabAssemblyPlan({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 3,
			banksPerLayoutBlock: 3,
			processLoopsPerBank: 24,
			bayPackingPolicy: "SINGLE",
			processLoopLongAxisMeters: 56,
			processLoopCenterPitchMeters: 16,
		});

		expect(plan.bounds.maxX).toBeLessThanOrEqual(2_000);
		expect(plan.bounds.maxY).toBeLessThanOrEqual(2_000);
		expect(plan.profileDerived.counts.organizationRecords).toBe(442);
		expect(plan.capacity.primitiveDirectedEdges).toBe(82_116);
		expect(plan.capacity.upperLinkDirectedEdges).toBe(904);
		expect(plan.capacity.plannedDirectedEdges).toBe(83_020);
		expect(plan.capacity.portableBundleKnownHeadroom).toBe(0);
		expect(plan.capacity.portableBundleEligibility).toBe("INELIGIBLE_PLANNED_EDGE_LIMIT");
	});
});

function omitAssemblyPlanFingerprint(
	plan: OpenFabFabAssemblyPlan,
): Omit<OpenFabFabAssemblyPlan, "fingerprint"> {
	const copy: Record<string, unknown> = { ...plan };
	delete copy.fingerprint;
	return copy as unknown as Omit<OpenFabFabAssemblyPlan, "fingerprint">;
}
