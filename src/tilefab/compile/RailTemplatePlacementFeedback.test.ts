import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	type BranchBypassTemplateParameters,
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
	RAIL_TEMPLATE_CATALOG,
	rotateRailTemplatePose,
} from "../core/RailTemplateCatalog";
import { DIR_E, DIR_W } from "../core/railShape";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { type RailDraftEvaluation, RailDraftEvaluator } from "./RailDraftEvaluator";
import { createRailTemplatePlacementFeedback } from "./RailTemplatePlacementFeedback";

const BRANCH_PARAMETERS = Object.freeze({
	...(defaultRailTemplateParameters("branch-bypass") as BranchBypassTemplateParameters),
	trunkSpanMeters: 12,
	offsetMeters: 4,
});

describe("RailTemplatePlacementFeedback", () => {
	it("preserves semantic handles and exact reservation bounds for every catalog pose", () => {
		const document = new RailDocument();
		const physical = compilePhysicalRail(document.map);
		const evaluator = new RailDraftEvaluator();

		for (const item of RAIL_TEMPLATE_CATALOG) {
			for (const side of ["left", "right"] as const) {
				let pose = { ...initialRailTemplatePose(), side };
				for (let rotation = 0; rotation < 4; rotation++) {
					const plan = planRailTemplate(
						document.map,
						item.id,
						{ x: -17, y: 23 },
						pose,
						defaultRailTemplateParameters(item.id),
					);
					const evaluation = evaluator.evaluate(document.map, physical, plan);
					const feedback = createRailTemplatePlacementFeedback(plan, evaluation);
					const reserved = plan.template.hardReservedCells;

					expect(feedback.handles).toHaveLength(plan.template.terminals.length);
					expect(feedback.handles.map((handle) => handle.cell)).toEqual(
						plan.template.terminals.map((terminal) => terminal.cell),
					);
					expect(feedback.reservation).toMatchObject({
						bounds: {
							minX: Math.min(...reserved.map((cell) => cell.x)),
							minY: Math.min(...reserved.map((cell) => cell.y)),
							maxX: Math.max(...reserved.map((cell) => cell.x)),
							maxY: Math.max(...reserved.map((cell) => cell.y)),
						},
						cellCount: reserved.length,
					});
					expect(feedback.code).not.toBe("stale");
					pose = rotateRailTemplatePose(pose, 1);
				}
			}
		}
	});

	it("derives semantic branch/merge handles and hard-reservation bounds for a valid attachment", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 20, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const plan = planRailTemplate(
			document.map,
			"branch-bypass",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			BRANCH_PARAMETERS,
		);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		const feedback = createRailTemplatePlacementFeedback(plan, evaluation);

		expect(feedback).toMatchObject({
			state: "ready",
			code: "valid",
			label: "READY",
			repeatable: true,
		});
		expect(feedback.handles).toEqual([
			expect.objectContaining({ kind: "entry", role: "branch", label: "ENTRY" }),
			expect.objectContaining({ kind: "exit", role: "merge", label: "EXIT" }),
		]);
		expect(feedback.reservation.bounds).toEqual({ minX: -1, minY: 0, maxX: 13, maxY: 4 });
		expect(feedback.reservation.extraCellCount).toBeGreaterThan(0);
	});

	it("separates wrong-direction, insufficient-support, and exact-overlap planning failures", () => {
		const reverseDocument = new RailDocument();
		expect(
			reverseDocument.commit(
				planRailConstruction(reverseDocument.map, { x: 12, y: 0 }, { x: 0, y: 0 }),
			),
		).toBe(true);
		const reversePlan = planRailTemplate(
			reverseDocument.map,
			"branch-bypass",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right" },
			BRANCH_PARAMETERS,
		);
		const reverseEvaluation = new RailDraftEvaluator().evaluate(
			reverseDocument.map,
			compilePhysicalRail(reverseDocument.map),
			reversePlan,
		);
		expect(createRailTemplatePlacementFeedback(reversePlan, reverseEvaluation).code).toBe(
			"wrong-direction",
		);
		expect(reversePlan.issueCode).toBe("reverse-overlap");

		const shortDocument = new RailDocument();
		expect(
			shortDocument.commit(
				planRailConstruction(shortDocument.map, { x: 0, y: 0 }, { x: 10, y: 0 }),
			),
		).toBe(true);
		const shortPlan = planRailTemplate(
			shortDocument.map,
			"branch-bypass",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			BRANCH_PARAMETERS,
		);
		const shortEvaluation = new RailDraftEvaluator().evaluate(
			shortDocument.map,
			compilePhysicalRail(shortDocument.map),
			shortPlan,
		);
		expect(createRailTemplatePlacementFeedback(shortPlan, shortEvaluation).code).toBe(
			"insufficient-support",
		);
		expect(shortPlan.issueCode).toBe("disconnected");

		const loopDocument = new RailDocument();
		const parameters = defaultRailTemplateParameters("long-bay");
		const pose = initialRailTemplatePose();
		const first = planRailTemplate(loopDocument.map, "long-bay", { x: 0, y: 0 }, pose, parameters);
		expect(loopDocument.commit(first)).toBe(true);
		const duplicate = planRailTemplate(
			loopDocument.map,
			"long-bay",
			{ x: 0, y: 0 },
			pose,
			parameters,
		);
		const duplicateEvaluation = new RailDraftEvaluator().evaluate(
			loopDocument.map,
			compilePhysicalRail(loopDocument.map),
			duplicate,
		);
		expect(createRailTemplatePlacementFeedback(duplicate, duplicateEvaluation).code).toBe(
			"overlap",
		);
	});

	it("distinguishes a missing return-loop anchor from an opposite open-terminal direction", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const parameters = defaultRailTemplateParameters("return-loop");

		const detached = planRailTemplate(
			document.map,
			"return-loop",
			{ x: 20, y: 20 },
			initialRailTemplatePose(),
			parameters,
		);
		const detachedEvaluation = new RailDraftEvaluator().evaluate(document.map, physical, detached);
		expect(createRailTemplatePlacementFeedback(detached, detachedEvaluation).code).toBe(
			"terminal-only",
		);

		const reverse = planRailTemplate(
			document.map,
			"return-loop",
			{ x: 6, y: 0 },
			{ forward: DIR_W, side: "right" },
			parameters,
		);
		const reverseEvaluation = new RailDraftEvaluator().evaluate(document.map, physical, reverse);
		expect(createRailTemplatePlacementFeedback(reverse, reverseEvaluation).code).toBe(
			"wrong-direction",
		);
	});

	it("lets stale evaluation outcomes override a valid core plan", () => {
		const document = new RailDocument();
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		const physical = compilePhysicalRail(document.map);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		const portConflict = Object.freeze({
			...evaluation,
			valid: false,
			topologyValid: false,
			reason: "PORT-42의 레일 연결을 끊는 편집입니다",
			invalidatedPortIds: Object.freeze([42]),
		});
		expect(createRailTemplatePlacementFeedback(plan, portConflict).code).toBe("port-conflict");

		expect(document.commit(plan)).toBe(true);
		const staleEvaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);
		expect(createRailTemplatePlacementFeedback(plan, staleEvaluation).code).toBe("stale");

		const currentDocument = new RailDocument();
		const currentPlan = planRailTemplate(
			currentDocument.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		const mismatchedLayout = compilePhysicalRail(document.map);
		const layoutStaleEvaluation = new RailDraftEvaluator().evaluate(
			currentDocument.map,
			mismatchedLayout,
			currentPlan,
		);
		expect(layoutStaleEvaluation.stale).toBe(true);
		expect(createRailTemplatePlacementFeedback(currentPlan, layoutStaleEvaluation).code).toBe(
			"stale",
		);
	});

	it("classifies invalid dimensions and a real planar-crossing topology failure", () => {
		const emptyDocument = new RailDocument();
		const invalidParameters = {
			...defaultRailTemplateParameters("long-bay"),
			aisleLengthMeters: 1,
		};
		const invalidPlan = planRailTemplate(
			emptyDocument.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			invalidParameters,
		);
		const invalidEvaluation = new RailDraftEvaluator().evaluate(
			emptyDocument.map,
			compilePhysicalRail(emptyDocument.map),
			invalidPlan,
		);
		expect(createRailTemplatePlacementFeedback(invalidPlan, invalidEvaluation).code).toBe(
			"invalid-parameters",
		);
		expect(invalidPlan.issueCode).toBe("insufficient-path");

		const crossingDocument = new RailDocument();
		expect(
			crossingDocument.commit(
				planRailConstruction(crossingDocument.map, { x: 12, y: -2 }, { x: 12, y: 8 }),
			),
		).toBe(true);
		const crossingPlan = planRailTemplate(
			crossingDocument.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		const crossingEvaluation = new RailDraftEvaluator().evaluate(
			crossingDocument.map,
			compilePhysicalRail(crossingDocument.map),
			crossingPlan,
		);
		expect(createRailTemplatePlacementFeedback(crossingPlan, crossingEvaluation).code).toBe(
			"topology",
		);
	});

	it("classifies a real template-versus-committed installation-clearance conflict", () => {
		const document = new RailDocument();
		expect(
			document.commit(
				planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 3 }, "horizontal-first"),
			),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			{ x: -27, y: -5 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid).toBe(false);
		expect(evaluation.topologyValid).toBe(true);
		expect(evaluation.issues.length).toBeGreaterThan(0);
		expect(createRailTemplatePlacementFeedback(plan, evaluation).code).toBe("physical-clearance");
	});

	it("reports a typed preview error when physical draft compilation fails", () => {
		const document = new RailDocument();
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		const physical = compilePhysicalRail(document.map);
		const originalGetEncoded = document.map.getEncoded;
		document.map.getEncoded = () => {
			throw new Error("synthetic preview failure");
		};

		let evaluation: RailDraftEvaluation;
		try {
			evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		} finally {
			document.map.getEncoded = originalGetEncoded;
		}

		expect(evaluation.failureCode).toBe("compile");
		expect(evaluation.reason).toContain("synthetic preview failure");
		expect(createRailTemplatePlacementFeedback(plan, evaluation).code).toBe("preview-error");
	});
});
