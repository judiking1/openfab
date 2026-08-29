import { describe, expect, it, vi } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { analyzeRailNetwork } from "./network";
import { planRailConstruction } from "./paint";
import { planCatalogRailConstruction } from "./RailConstructionCatalog";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	cardinalPolylineSelfIntersects,
	createRailNetworkLinkAnchorContext,
	isRailNetworkLinkPlan,
	planRailNetworkLink,
	RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
	type RailNetworkLinkPlan,
} from "./RailNetworkLinkPlanner";
import {
	defaultRailTemplateParameters,
	planRailRouteBatch,
	planRailTemplate,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_N } from "./railShape";

describe("RailNetworkLinkPlanner", () => {
	it("joins two closed Bay components with one atomic outbound and return command", () => {
		const document = twoLongBays();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });
		const plan = planRailNetworkLink(document.map, context, { x: 16, y: 20 });

		expect(context.valid, context.reason).toBe(true);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.networkLink).toMatchObject({
			placementCode: "valid",
			side: "left",
			junctionSpacingMeters: RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
			sourceDeparture: { x: 16, y: 6 },
			sourceArrival: { x: 8, y: 6 },
			targetArrival: { x: 16, y: 20 },
			targetDeparture: { x: 8, y: 20 },
		});
		expect(plan.networkLink.outboundCells.at(0)).toEqual({ x: 16, y: 6 });
		expect(plan.networkLink.outboundCells.at(-1)).toEqual({ x: 16, y: 20 });
		expect(plan.networkLink.returnCells.at(0)).toEqual({ x: 8, y: 20 });
		expect(plan.networkLink.returnCells.at(-1)).toEqual({ x: 8, y: 6 });

		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "build", baseRevision: plan.baseRevision });
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
			openEnds: 0,
		});

		expect(document.undo()).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "disconnected",
			components: 2,
			strongComponents: 2,
		});
		expect(document.redo()).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
		});
	});

	it("rejects same-component and wrong-side targets while resolving any rail on the target loop", () => {
		const document = twoLongBays();
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });

		expect(planRailNetworkLink(document.map, context, { x: 8, y: 6 })).toMatchObject({
			valid: false,
			networkLink: { placementCode: "same-component" },
		});
		const curveTarget = planRailNetworkLink(document.map, context, { x: 0, y: 20 });
		expect(curveTarget.valid, curveTarget.reason).toBe(true);
		expect(curveTarget.networkLink.targetAnchor).not.toEqual({ x: 0, y: 20 });
		const perpendicularClick = planRailNetworkLink(document.map, context, { x: 24, y: 23 });
		expect(perpendicularClick.valid, perpendicularClick.reason).toBe(true);
		expect(planRailNetworkLink(document.map, context, { x: 16, y: 20 }, "right")).toMatchObject({
			valid: false,
			networkLink: { placementCode: "wrong-side", side: "left" },
		});
	});

	it("allows a trusted macro builder to add a second circulation link within one SCC", () => {
		const document = twoLongBays(0, 40);
		const firstContext = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 0 });
		const firstLink = planRailNetworkLink(document.map, firstContext, { x: 56, y: 0 });
		const evaluator = new RailDraftEvaluator();
		const firstEvaluation = evaluator.evaluate(
			document.map,
			compilePhysicalRail(document.map),
			firstLink,
		);
		expect(firstLink.valid, firstLink.reason).toBe(true);
		expect(firstEvaluation.valid, firstEvaluation.reason).toBe(true);
		expect(document.commit(firstEvaluation.plan)).toBe(true);

		const conservativeContext = createRailNetworkLinkAnchorContext(document.map, {
			x: 16,
			y: 6,
		});
		expect(planRailNetworkLink(document.map, conservativeContext, { x: 56, y: 6 })).toMatchObject({
			valid: false,
			networkLink: { placementCode: "same-component" },
		});

		const cycleContext = createRailNetworkLinkAnchorContext(
			document.map,
			{ x: 16, y: 6 },
			null,
			null,
			{ allowSameComponent: true },
		);
		const cycleLink = planRailNetworkLink(document.map, cycleContext, { x: 56, y: 6 });
		const cycleEvaluation = evaluator.evaluate(
			document.map,
			compilePhysicalRail(document.map),
			cycleLink,
		);
		expect(cycleLink.valid, cycleLink.reason).toBe(true);
		expect(cycleEvaluation.valid, cycleEvaluation.reason).toBe(true);
		expect(document.commit(cycleEvaluation.plan)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});
	});

	it("keeps the interactive 120 m cap while allowing an explicit trusted macro corridor", () => {
		const document = twoLongBays(0, 160);
		const source = { x: 24, y: 3 };
		const target = { x: 160, y: 3 };
		const conservative = createRailNetworkLinkAnchorContext(document.map, source);
		expect(planRailNetworkLink(document.map, conservative, target)).toMatchObject({
			valid: false,
			networkLink: { placementCode: "excessive-gap" },
		});

		const trusted = createRailNetworkLinkAnchorContext(document.map, source, null, null, {
			maximumGapMeters: 200,
		});
		const plan = planRailNetworkLink(document.map, trusted, target);
		expect(trusted.maximumGapMeters).toBe(200);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.networkLink.outboundCells.length).toBeGreaterThan(120);
		expect(() =>
			createRailNetworkLinkAnchorContext(document.map, source, null, null, {
				maximumGapMeters: 513,
			}),
		).toThrow(RangeError);
	});

	it("keeps a compact five-meter inter-loop link inside the shared physical draft gate", () => {
		const document = twoLongBays(-11);
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 0 });
		const plan = planRailNetworkLink(document.map, context, { x: 16, y: -5 });
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
	});

	it("rejects a compact overlap when every tangent candidate conflicts with a loop corner", () => {
		const document = twoLongBays(-11, 11);
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 19, y: 0 });
		const plan = planRailNetworkLink(document.map, context, { x: 19, y: -5 });

		expect(plan).toMatchObject({
			valid: false,
			networkLink: { placementCode: "topology" },
		});
	});

	it("invalidates a cached source context after the authored revision changes", () => {
		const document = twoLongBays();
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });
		const extra = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 40, y: 0 },
			{ forward: DIR_E, side: "right" },
			defaultRailTemplateParameters("long-bay"),
		);
		expect(document.commit(extra)).toBe(true);

		expect(planRailNetworkLink(document.map, context, { x: 16, y: 20 })).toMatchObject({
			valid: false,
			networkLink: { placementCode: "stale" },
		});
	});

	it("promotes only a distinct closed target while preserving ordinary Smart Route targets", () => {
		const document = twoLongBays();
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });
		const options = {
			bend: "auto" as const,
			span: "compact" as const,
			advancedSwitchProfile: "A" as const,
			networkLinkContext: context,
		};
		const automaticLink = planCatalogRailConstruction(
			document.map,
			{ x: 16, y: 6 },
			{ x: 16, y: 20 },
			"route",
			options,
		);
		expect(isRailNetworkLinkPlan(automaticLink)).toBe(true);
		expect(automaticLink.valid, automaticLink.reason).toBe(true);
		if (!isRailNetworkLinkPlan(automaticLink)) throw new Error("Expected an automatic link plan.");
		expect(automaticLink.networkLink).toMatchObject({
			placementCode: "valid",
			sourceAnchor: { x: 16, y: 6 },
			targetAnchor: { x: 16, y: 20 },
		});
		const invalidTarget = planCatalogRailConstruction(
			document.map,
			{ x: 16, y: 6 },
			{ x: 40, y: 10 },
			"route",
			options,
		);
		expect(isRailNetworkLinkPlan(invalidTarget)).toBe(false);
		const sameComponentTarget = planCatalogRailConstruction(
			document.map,
			{ x: 16, y: 6 },
			{ x: 8, y: 6 },
			"route",
			options,
		);
		expect(isRailNetworkLinkPlan(sameComponentTarget)).toBe(false);

		const curveToCurveClosedLink = planCatalogRailConstruction(
			document.map,
			{ x: 1, y: 0 },
			{ x: 24, y: 21 },
			"route",
			{
				...options,
				networkLinkContext: createRailNetworkLinkAnchorContext(document.map, { x: 1, y: 0 }),
			},
		);
		expect(isRailNetworkLinkPlan(curveToCurveClosedLink)).toBe(true);
		expect(curveToCurveClosedLink.valid, curveToCurveClosedLink.reason).toBe(true);
		if (!isRailNetworkLinkPlan(curveToCurveClosedLink)) {
			throw new Error("Expected a closed-component link plan.");
		}
		expect(curveToCurveClosedLink.networkLink.sourceComponentCellCount).toBeGreaterThan(0);

		const movedSource = planCatalogRailConstruction(
			document.map,
			{ x: 12, y: 6 },
			{ x: 12, y: 20 },
			"network-link",
			options,
		);
		expect(isRailNetworkLinkPlan(movedSource)).toBe(true);
		if (!isRailNetworkLinkPlan(movedSource)) throw new Error("Expected a NETWORK LINK plan.");
		expect(movedSource.networkLink.sourceAnchor).toEqual({ x: 12, y: 6 });
	});

	it("auto-routes two tangent L corridors between perpendicular closed Bay components", () => {
		const document = twoPerpendicularLongBays();
		const source = { x: 16, y: 6 };
		const perpendicularTarget = { x: 40, y: 19 };
		const context = createRailNetworkLinkAnchorContext(document.map, source);
		const ordinaryRoute = planRailConstruction(document.map, source, perpendicularTarget, "auto");

		expect(context.isDistinctClosedTarget(document.map, perpendicularTarget)).toBe(true);
		const directPlan = planRailNetworkLink(document.map, context, perpendicularTarget);
		expect(directPlan.valid, directPlan.reason).toBe(true);
		expect(directPlan.networkLink).toMatchObject({
			placementCode: "valid",
			sourceForward: expect.any(Number),
			targetForward: expect.any(Number),
		});
		expect(routeTurnCount(directPlan.networkLink.outboundCells)).toBe(1);
		expect(routeTurnCount(directPlan.networkLink.returnCells)).toBe(1);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			directPlan,
		);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(ordinaryRoute.valid, ordinaryRoute.reason).toBe(true);

		const catalogPlan = planCatalogRailConstruction(
			document.map,
			source,
			perpendicularTarget,
			"route",
			{
				bend: "auto",
				span: "compact",
				advancedSwitchProfile: "A",
				networkLinkContext: context,
			},
		);

		expect(isRailNetworkLinkPlan(catalogPlan)).toBe(true);
		expect(catalogPlan).toMatchObject({
			valid: true,
			networkLink: { placementCode: "valid" },
		});
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
		});
	});

	it("resolves the nearest supported source run when the first click is on a loop curve", () => {
		const document = twoLongBays();
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 0, y: 0 });
		const plan = planRailNetworkLink(document.map, context, { x: 24, y: 20 });

		expect(context.valid, context.reason).toBe(true);
		expect(context.sourceForward).not.toBeNull();
		expect(plan.valid, plan.reason).toBe(true);
	});

	it("falls back from the clicked straight to another source tangent when acceptance blocks it", () => {
		const document = twoLongBays(0, 40);
		const baselineContext = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 0 });
		const clickedForward = baselineContext.sourceForward;
		expect(clickedForward).not.toBeNull();
		const acceptedForwards: number[] = [];
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 0 }, (plan) => {
			const forward = plan.networkLink.sourceForward;
			if (forward !== null) acceptedForwards.push(forward);
			return forward !== clickedForward;
		});
		const plan = planRailNetworkLink(document.map, context, { x: 56, y: 0 });

		expect(plan.valid, plan.reason).toBe(true);
		expect(acceptedForwards).toContain(clickedForward);
		expect(plan.networkLink.sourceForward).not.toBe(clickedForward);
	});

	it("keeps an explicit assembly gateway on the selected source and target runs", () => {
		const document = twoLongBays(0, 40);
		const strictCurveSource = createRailNetworkLinkAnchorContext(
			document.map,
			{ x: 0, y: 0 },
			null,
			null,
			{ restrictToSelectedRuns: true },
		);
		expect(strictCurveSource).toMatchObject({
			valid: false,
			placementCode: "source-not-straight",
		});

		const attempts: RailNetworkLinkPlan[] = [];
		const strict = createRailNetworkLinkAnchorContext(
			document.map,
			{ x: 16, y: 0 },
			(plan) => {
				attempts.push(plan);
				return false;
			},
			null,
			{ restrictToSelectedRuns: true },
		);
		const blocked = planRailNetworkLink(document.map, strict, { x: 56, y: 0 });
		expect(strict.restrictsToSelectedRuns()).toBe(true);
		expect(blocked.valid).toBe(false);
		expect(attempts.length).toBeGreaterThan(0);
		expect(
			attempts.every(
				(plan) =>
					plan.networkLink.sourceForward === strict.sourceForward &&
					plan.networkLink.targetAnchor.y === 0,
			),
		).toBe(true);

		const strictTarget = createRailNetworkLinkAnchorContext(
			document.map,
			{ x: 16, y: 0 },
			null,
			null,
			{ restrictToSelectedRuns: true },
		);
		expect(planRailNetworkLink(document.map, strictTarget, { x: 40, y: 0 })).toMatchObject({
			valid: false,
			networkLink: { placementCode: "target-not-straight" },
		});
	});

	it("falls back to a later topology candidate when the nearest physical candidate is rejected", () => {
		const document = twoLongBays();
		const attempts: RailNetworkLinkPlan[] = [];
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 }, (plan) => {
			attempts.push(plan);
			return attempts.length > 1;
		});
		const plan = planRailNetworkLink(document.map, context, { x: 16, y: 20 });

		expect(attempts.length).toBeGreaterThan(1);
		expect(plan).toBe(attempts[1]);
	});

	it("applies a topology contract before the eight-candidate physical shortlist", () => {
		const document = twoLongBays(0, 40);
		const contractCandidates: RailNetworkLinkPlan[] = [];
		const context = createRailNetworkLinkAnchorContext(
			document.map,
			{ x: 16, y: 0 },
			() => true,
			(plan) => {
				contractCandidates.push(plan);
				return contractCandidates.length === 9;
			},
		);
		const plan = planRailNetworkLink(document.map, context, { x: 56, y: 0 });

		expect(contractCandidates.length).toBeGreaterThanOrEqual(9);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan).toBe(contractCandidates[8]);
	});

	it("preserves dogleg-corridor diversity across physical candidate fallback", () => {
		const document = twoLongBays(0, 40);
		const attemptedFamilies: string[] = [];
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 }, (plan) => {
			const family = routeBoundsKey(plan.networkLink.outboundCells, plan.networkLink.returnCells);
			attemptedFamilies.push(family);
			return attemptedFamilies[0] !== family;
		});

		const plan = planRailNetworkLink(document.map, context, { x: 56, y: 0 });

		expect(plan.valid, plan.reason).toBe(true);
		expect(new Set(attemptedFamilies).size).toBeGreaterThan(1);
	});

	it("preserves an alternate family for the preferred run on complex loops", () => {
		const document = combLoopAndLongBay();
		const source = { x: 32, y: 10 };
		let preferredRunAttempts = 0;
		const context = createRailNetworkLinkAnchorContext(document.map, source, (plan) => {
			if (
				plan.networkLink.sourceAnchor.x === source.x &&
				plan.networkLink.sourceAnchor.y === source.y
			) {
				preferredRunAttempts++;
				return preferredRunAttempts > 1;
			}
			return false;
		});

		const plan = planRailNetworkLink(document.map, context, { x: 72, y: 40 });

		expect(plan.valid, plan.reason).toBe(true);
		expect(preferredRunAttempts).toBeGreaterThan(1);
	});

	it("rejects a collapsed dogleg that doubles back over its previous leg", () => {
		expect(
			cardinalPolylineSelfIntersects([
				{ x: 16, y: 6 },
				{ x: 16, y: 3 },
				{ x: 16, y: 3 },
				{ x: 16, y: 20 },
			]),
		).toBe(true);
		expect(
			cardinalPolylineSelfIntersects([
				{ x: 16, y: 0 },
				{ x: 16, y: 3 },
				{ x: 16, y: 3 },
				{ x: 16, y: 20 },
			]),
		).toBe(false);
	});

	it("returns an explicit invalid plan when every physical candidate is rejected", () => {
		const document = twoLongBays();
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 }, () => false);

		const plan = planRailNetworkLink(document.map, context, { x: 16, y: 20 });

		expect(plan).toMatchObject({
			valid: false,
			networkLink: { placementCode: "physical" },
		});
		expect(plan.reason).toMatch(/물리 간격|포트 안전/);
	});

	it("rejects a very long offset before materializing route cell arrays", () => {
		const document = twoLongBays(0, 50_000);
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });
		const startedAt = performance.now();

		const plan = planRailNetworkLink(document.map, context, { x: 50_016, y: 0 });

		expect(plan.valid).toBe(false);
		expect(plan.networkLink.placementCode).toBe("excessive-gap");
		expect(performance.now() - startedAt).toBeLessThan(100);
	});

	it("joins offset parallel Bays with two non-crossing dogleg corridors", () => {
		const document = twoLongBays(0, 40);
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });
		const plan = planRailNetworkLink(document.map, context, { x: 56, y: 0 });
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(routeTurnCount(plan.networkLink.outboundCells)).toBe(2);
		expect(routeTurnCount(plan.networkLink.returnCells)).toBe(2);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
		});
	});

	it("keeps scanning junction families when a closed obstacle blocks the preferred dogleg", () => {
		const document = twoLongBays(0, 40);
		const obstacle: Array<{ x: number; y: number }> = [];
		for (let x = 13; x <= 15; x++) obstacle.push({ x, y: -5 });
		for (let y = -4; y <= -1; y++) obstacle.push({ x: 15, y });
		for (let x = 14; x >= 13; x--) obstacle.push({ x, y: -1 });
		for (let y = -2; y >= -5; y--) obstacle.push({ x: 13, y });
		const obstaclePlan = planRailRouteBatch(document.map, [obstacle], "free-closed-primary");
		expect(obstaclePlan.valid, obstaclePlan.reason).toBe(true);
		expect(document.commit(obstaclePlan)).toBe(true);

		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 0 });
		const plan = planRailNetworkLink(document.map, context, { x: 56, y: 0 });
		const repeated = planRailNetworkLink(document.map, context, { x: 56, y: 0 });
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.networkLink).toMatchObject({
			sourceAnchor: { x: 16, y: 0 },
			sourceDeparture: { x: 12, y: 0 },
			sourceArrival: { x: 20, y: 0 },
			targetAnchor: { x: 56, y: 0 },
			targetArrival: { x: 56, y: 0 },
			targetDeparture: { x: 48, y: 0 },
		});
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(repeated.networkLink.outboundCells).toEqual(plan.networkLink.outboundCells);
		expect(repeated.networkLink.returnCells).toEqual(plan.networkLink.returnCells);
	});

	it("indexes straight runs within a linear read budget", () => {
		const document = new RailDocument();
		const defaults = defaultRailTemplateParameters("long-bay");
		if (defaults.templateId !== "long-bay") throw new Error("Expected Long Bay parameters.");
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right" },
			{ ...defaults, aisleLengthMeters: 120 },
		);
		expect(document.commit(plan)).toBe(true);
		const getRail = vi.spyOn(document.map, "getRail");

		const context = createRailNetworkLinkAnchorContext(document.map, { x: 60, y: 0 });

		expect(context.valid, context.reason).toBe(true);
		expect(getRail.mock.calls.length).toBeLessThan(20_000);
		getRail.mockRestore();
	});

	it("promotes a valid parallel closed-component target from Smart Route", () => {
		const document = twoLongBays();
		const source = { x: 16, y: 6 };
		const parallelTarget = { x: 16, y: 20 };
		const context = createRailNetworkLinkAnchorContext(document.map, source);
		const plan = planCatalogRailConstruction(document.map, source, parallelTarget, "route", {
			bend: "auto",
			span: "compact",
			advancedSwitchProfile: "A",
			networkLinkContext: context,
		});

		expect(isRailNetworkLinkPlan(plan)).toBe(true);
		expect(plan).toMatchObject({
			valid: true,
			networkLink: {
				placementCode: "valid",
				sourceAnchor: source,
				targetAnchor: parallelTarget,
			},
		});
	});
});

function twoLongBays(secondAnchorY = 20, secondAnchorX = 0): RailDocument {
	const document = new RailDocument();
	const parameters = defaultRailTemplateParameters("long-bay");
	const first = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		{ forward: DIR_E, side: "right" },
		parameters,
	);
	expect(first.valid, first.reason).toBe(true);
	expect(document.commit(first)).toBe(true);
	const second = planRailTemplate(
		document.map,
		"long-bay",
		{ x: secondAnchorX, y: secondAnchorY },
		{ forward: DIR_E, side: "right" },
		parameters,
	);
	expect(second.valid, second.reason).toBe(true);
	expect(document.commit(second)).toBe(true);
	expect(analyzeRailNetwork(document.map)).toMatchObject({
		status: "disconnected",
		components: 2,
		strongComponents: 2,
	});
	return document;
}

function twoPerpendicularLongBays(): RailDocument {
	const document = new RailDocument();
	const parameters = defaultRailTemplateParameters("long-bay");
	expect(
		document.commit(
			planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y: 0 },
				{ forward: DIR_E, side: "right" },
				parameters,
			),
		),
	).toBe(true);
	expect(
		document.commit(
			planRailTemplate(
				document.map,
				"long-bay",
				{ x: 40, y: 20 },
				{ forward: DIR_N, side: "right" },
				parameters,
			),
		),
	).toBe(true);
	return document;
}

function combLoopAndLongBay(): RailDocument {
	const document = new RailDocument();
	const comb = cardinalLoopCells([
		{ x: 0, y: 0 },
		{ x: 32, y: 0 },
		{ x: 32, y: 20 },
		{ x: 28, y: 20 },
		{ x: 28, y: 4 },
		{ x: 24, y: 4 },
		{ x: 24, y: 20 },
		{ x: 20, y: 20 },
		{ x: 20, y: 4 },
		{ x: 16, y: 4 },
		{ x: 16, y: 20 },
		{ x: 12, y: 20 },
		{ x: 12, y: 4 },
		{ x: 8, y: 4 },
		{ x: 8, y: 20 },
		{ x: 4, y: 20 },
		{ x: 4, y: 4 },
		{ x: 0, y: 4 },
		{ x: 0, y: 0 },
	]);
	const combPlan = planRailRouteBatch(document.map, [comb], "free-closed-primary");
	expect(combPlan.valid, combPlan.reason).toBe(true);
	expect(document.commit(combPlan)).toBe(true);
	const parameters = defaultRailTemplateParameters("long-bay");
	const target = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 60, y: 40 },
		{ forward: DIR_E, side: "right" },
		parameters,
	);
	expect(target.valid, target.reason).toBe(true);
	expect(document.commit(target)).toBe(true);
	return document;
}

function cardinalLoopCells(
	vertices: readonly { readonly x: number; readonly y: number }[],
): readonly { readonly x: number; readonly y: number }[] {
	const cells: Array<{ readonly x: number; readonly y: number }> = [];
	for (let index = 1; index < vertices.length; index++) {
		const start = vertices[index - 1] as { readonly x: number; readonly y: number };
		const end = vertices[index] as { readonly x: number; readonly y: number };
		const stepX = Math.sign(end.x - start.x);
		const stepY = Math.sign(end.y - start.y);
		const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		for (let offset = cells.length === 0 ? 0 : 1; offset <= length; offset++) {
			cells.push({ x: start.x + stepX * offset, y: start.y + stepY * offset });
		}
	}
	return cells;
}

function routeTurnCount(route: readonly { readonly x: number; readonly y: number }[]): number {
	let turns = 0;
	let previous: string | null = null;
	for (let index = 1; index < route.length; index++) {
		const from = route[index - 1] as { readonly x: number; readonly y: number };
		const to = route[index] as { readonly x: number; readonly y: number };
		const direction = `${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`;
		if (previous !== null && previous !== direction) turns++;
		previous = direction;
	}
	return turns;
}

function routeBoundsKey(
	outbound: readonly { readonly x: number; readonly y: number }[],
	returnRoute: readonly { readonly x: number; readonly y: number }[],
): string {
	const bounds = (route: readonly { readonly x: number; readonly y: number }[]): string => {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const cell of route) {
			minX = Math.min(minX, cell.x);
			minY = Math.min(minY, cell.y);
			maxX = Math.max(maxX, cell.x);
			maxY = Math.max(maxY, cell.y);
		}
		return `${minX},${minY}:${maxX},${maxY}`;
	};
	return `${bounds(outbound)}>${bounds(returnRoute)}`;
}
