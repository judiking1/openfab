import { describe, expect, it } from "vitest";
import { planClosedRailPathComponent } from "./paint";
import { createRailAreaSelection, type RailAreaSelection } from "./RailAreaSelection";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { recognizeRailPattern } from "./RailPatternRecognition";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
	reverseRailTemplateFlow,
	rotateRailTemplatePose,
	setRailTemplateParameter,
	type RailTemplateId,
	type RailTemplateParameters,
	type RailTemplatePlan,
	type RailTemplatePose,
} from "./RailTemplateCatalog";
import type { Cell } from "./TileMap";

describe("RailPatternRecognition", () => {
	it.each([
		"long-bay",
		"paired-bay",
		"nested-bay",
		"shift-bay",
		"interbay-spine",
	] satisfies readonly RailTemplateId[])("derives the exact %s catalog identity and integer parameters without provenance", (templateId) => {
		const parameters = defaultRailTemplateParameters(templateId);
		const selection = templateSelection(templateId, parameters, initialRailTemplatePose());
		const recognition = recognizeRailPattern(selection);

		expect(recognition.state, recognition.reason).toBe("recognized");
		expect(recognition.candidates).toHaveLength(1);
		expect(recognition.candidates[0]).toMatchObject({ templateId, parameters });
	});

	it("recognizes a rotated, reflected, reverse-flow pattern by exact directed edges", () => {
		const templateId = "nested-bay";
		const parameters = defaultRailTemplateParameters(templateId);
		const pose = reverseRailTemplateFlow(
			rotateRailTemplatePose({ ...initialRailTemplatePose(), side: "left" }, 1),
		);
		const source = documentFromTemplate(templateId, parameters, pose, { x: 37, y: -22 });
		const recognition = recognizeRailPattern(selectWholeMap(source));

		expect(recognition.state, recognition.reason).toBe("recognized");
		const candidate = recognition.candidates[0];
		expect(candidate).toMatchObject({ templateId, parameters });
		if (!candidate) throw new Error("Expected a recognized candidate.");

		const reconstructed = new RailDocument();
		const plan = planRailTemplate(
			reconstructed.map,
			candidate.templateId,
			candidate.anchor,
			candidate.pose,
			candidate.parameters,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(reconstructed.commit(plan)).toBe(true);
		expect(encodedCells(reconstructed)).toEqual(encodedCells(source));
	});

	it("reports catalog ambiguity instead of guessing between identical large-loop grammars", () => {
		const templateId = "outer-loop";
		const recognition = recognizeRailPattern(
			templateSelection(
				templateId,
				defaultRailTemplateParameters(templateId),
				initialRailTemplatePose(),
			),
		);

		expect(recognition.state).toBe("ambiguous");
		expect(recognition.candidates.map((candidate) => candidate.templateId)).toEqual([
			"long-bay",
			"outer-loop",
		]);
		expect(recognition.reason).toMatch(/선택/);
	});

	it("keeps a valid custom closed loop explicit as unsupported", () => {
		const document = new RailDocument();
		const plan = planClosedRailPathComponent(document.map, rectangleRoute(10, 3));
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);

		const recognition = recognizeRailPattern(selectWholeMap(document));
		expect(recognition).toMatchObject({ state: "unsupported", candidates: [] });
		expect(recognition.reason).toMatch(/카탈로그/);
	});

	it("returns the closed-selection rejection instead of analyzing a partial module subset", () => {
		const document = documentFromTemplate(
			"long-bay",
			defaultRailTemplateParameters("long-bay"),
			initialRailTemplatePose(),
			{ x: 0, y: 0 },
		);
		const index = buildRailModuleOwnershipIndex(document.map);
		const ownership = index.modules.find((module) => module.kind === "straight");
		if (!ownership) throw new Error("Expected a straight module.");
		const selection = Object.freeze({
			revision: index.revision,
			bounds: Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
			mode: "intersect",
			ownerships: Object.freeze([ownership]),
		}) satisfies RailAreaSelection;

		const recognition = recognizeRailPattern(selection);
		expect(recognition.state).toBe("unsupported");
		expect(recognition.reason).toMatch(/완전한 폐합 유향 패턴/);
	});

	it.each([
		["attached-return", attachedParameters("attached-return", 4, 10)],
		["branch-bypass", attachedParameters("branch-bypass", 20, 6)],
		["outerbay-link", attachedParameters("outerbay-link", 20, 24)],
	] satisfies readonly [RailTemplateId, RailTemplateParameters][])(
		"recognizes the selected %s delta while proving its unselected parent trunk",
		(templateId, parameters) => {
			const { document, plan } = documentWithAttachedTemplate(templateId, parameters);
			const selection = selectionForAttachedPlan(document, plan);
			const recognition = recognizeRailPattern(
				selection,
				document.map,
				buildRailModuleOwnershipIndex(document.map),
			);

			expect(recognition.state, recognition.reason).toBe("recognized");
			expect(recognition.candidates).toHaveLength(1);
			expect(recognition.candidates[0]).toMatchObject({ templateId, parameters });
			expect(recognition.reason).toMatch(/본선 X\+.*LEFT 결합/);
		},
	);

	it("keeps overlapping attached geometries explicit as catalog ambiguity", () => {
		const parameters = attachedParameters("branch-bypass", 10, 4);
		const { document, plan } = documentWithAttachedTemplate("branch-bypass", parameters);
		const recognition = recognizeRailPattern(
			selectionForAttachedPlan(document, plan),
			document.map,
			buildRailModuleOwnershipIndex(document.map),
		);

		expect(recognition.state, recognition.reason).toBe("ambiguous");
		expect(recognition.candidates.map((candidate) => candidate.templateId)).toEqual([
			"attached-return",
			"branch-bypass",
		]);
	});

	it("rejects attached recognition when the revision-bound parent trunk has changed", () => {
		const parameters = attachedParameters("branch-bypass", 20, 6);
		const { document, plan } = documentWithAttachedTemplate("branch-bypass", parameters);
		const selection = selectionForAttachedPlan(document, plan);
		const sourceIndex = buildRailModuleOwnershipIndex(document.map);
		const second = planRailTemplate(
			document.map,
			"attached-return",
			{ x: 42, y: 0 },
			{ ...initialRailTemplatePose(), side: "left" },
			defaultRailTemplateParameters("attached-return"),
		);
		expect(second.valid, second.reason).toBe(true);
		expect(document.commit(second)).toBe(true);

		const recognition = recognizeRailPattern(selection, document.map, sourceIndex);
		expect(recognition.state).toBe("stale");
		expect(recognition.reason).toMatch(/오래/);
	});

	it("treats a selected same-run trunk chunk as context instead of part of the attached delta", () => {
		const parameters = attachedParameters("branch-bypass", 20, 6);
		const { document, plan } = documentWithAttachedTemplate("branch-bypass", parameters);
		const childSelection = selectionForAttachedPlan(document, plan);
		const index = buildRailModuleOwnershipIndex(document.map);
		const trunkContext = index.modules.find(
			(module) =>
				module.kind === "straight" &&
				module.eraseEdges.every(
					(edge) =>
						edge.from.y === 0 &&
						edge.to.y === 0 &&
						Math.min(edge.from.x, edge.to.x) >= 3 &&
						Math.max(edge.from.x, edge.to.x) <= 33,
				),
		);
		if (!trunkContext) throw new Error("Expected one semantic straight trunk context module.");
		const selection = Object.freeze({
			...childSelection,
			ownerships: Object.freeze([...childSelection.ownerships, trunkContext]),
		}) satisfies RailAreaSelection;

		const recognition = recognizeRailPattern(selection, document.map, index);
		expect(recognition.state, recognition.reason).toBe("recognized");
		expect(recognition.candidates[0]).toMatchObject({
			templateId: "branch-bypass",
			scope: "attached-delta",
			deltaEdgeCount: plan.template.buildRoutes[0]?.length - 1,
		});
		expect(recognition.candidates[0]?.selectedContextEdgeCount).toBeGreaterThan(0);
	});

	it("recognizes the real intersect marquee around an attached Bay and adjacent trunk modules", () => {
		const parameters = attachedParameters("attached-return", 4, 10);
		const document = documentFromTemplate(
			"long-bay",
			defaultRailTemplateParameters("long-bay"),
			initialRailTemplatePose(),
			{ x: 0, y: 0 },
		);
		const attached = planRailTemplate(
			document.map,
			"attached-return",
			{ x: 8, y: 0 },
			{ ...initialRailTemplatePose(), side: "left" },
			parameters,
		);
		expect(attached.valid, attached.reason).toBe(true);
		expect(document.commit(attached)).toBe(true);
		const index = buildRailModuleOwnershipIndex(document.map);
		const selection = createRailAreaSelection(
			index,
			{ x: 6, y: -11 },
			{ x: 14, y: 1 },
			"intersect",
		);
		expect(selection.ownerships).toHaveLength(12);
		expect(
			selection.ownerships.some(
				(ownership) =>
					ownership.kind === "straight" &&
					ownership.eraseEdges.every((edge) => edge.from.y === 0 && edge.to.y === 0),
			),
		).toBe(
			true,
		);

		const recognition = recognizeRailPattern(selection, document.map, index);
		expect(recognition.state, `${recognition.reason}\n${selection.ownerships.map((o) => o.key)}`).toBe(
			"recognized",
		);
		expect(recognition.candidates[0]).toMatchObject({
			templateId: "attached-return",
			scope: "attached-delta",
		});
	});

	it.each([
		[{ x: 8, y: 0 }, { forward: DIR_E, side: "left", flow: "forward" }, "X+"],
		[{ x: 80, y: 4 }, { forward: DIR_S, side: "left", flow: "forward" }, "Z+"],
		[{ x: 72, y: 20 }, { forward: DIR_W, side: "left", flow: "forward" }, "X-"],
		[{ x: 0, y: 16 }, { forward: DIR_N, side: "left", flow: "forward" }, "Z-"],
		[{ x: 60, y: 20 }, { forward: DIR_E, side: "right", flow: "reverse" }, "X-"],
	] satisfies readonly [Cell, RailTemplatePose, string][])(
		"recognizes attached geometry at $2.forward with $2.flow flow",
		(anchor, pose, directionLabel) => {
			const parameters = attachedParameters("attached-return", 4, 10);
			const { document, plan } = documentWithAttachedTemplate(
				"attached-return",
				parameters,
				anchor,
				pose,
			);
			const index = buildRailModuleOwnershipIndex(document.map);
			const recognition = recognizeRailPattern(
				selectionForAttachedPlan(document, plan),
				document.map,
				index,
			);

			expect(recognition.state, recognition.reason).toBe("recognized");
			expect(recognition.reason).toContain(`본선 ${directionLabel}`);
			expect(recognition.candidates[0]).toMatchObject({
				templateId: "attached-return",
				scope: "attached-delta",
			});
		},
	);

	it("rejects a parallel or unrelated selected rail as attached-pattern context", () => {
		const parameters = attachedParameters("attached-return", 4, 10);
		const { document, plan } = documentWithAttachedTemplate("attached-return", parameters);
		const childSelection = selectionForAttachedPlan(document, plan);
		const index = buildRailModuleOwnershipIndex(document.map);
		const unrelated = index.modules.find(
			(module) =>
				module.kind === "straight" &&
				module.eraseEdges.every((edge) => edge.from.y === 20 && edge.to.y === 20),
		);
		if (!unrelated) throw new Error("Expected an unrelated parent-loop straight module.");
		const selection = Object.freeze({
			...childSelection,
			ownerships: Object.freeze([...childSelection.ownerships, unrelated]),
		}) satisfies RailAreaSelection;

		const recognition = recognizeRailPattern(selection, document.map, index);
		expect(recognition.state).toBe("unsupported");
	});
});

function templateSelection(
	templateId: RailTemplateId,
	parameters: RailTemplateParameters,
	pose: RailTemplatePose,
): RailAreaSelection {
	return selectWholeMap(documentFromTemplate(templateId, parameters, pose, { x: 8, y: 12 }));
}

function documentFromTemplate(
	templateId: RailTemplateId,
	parameters: RailTemplateParameters,
	pose: RailTemplatePose,
	anchor: Cell,
): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(document.map, templateId, anchor, pose, parameters);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function documentWithAttachedTemplate(
	templateId: RailTemplateId,
	parameters: RailTemplateParameters,
	anchor: Cell = { x: 8, y: 0 },
	pose: RailTemplatePose = { ...initialRailTemplatePose(), side: "left" },
): { readonly document: RailDocument; readonly plan: RailTemplatePlan } {
	const document = new RailDocument();
	let starterParameters = defaultRailTemplateParameters("long-bay");
	starterParameters = setRailTemplateParameter(
		"long-bay",
		starterParameters,
		"aisleLengthMeters",
		80,
	);
	starterParameters = setRailTemplateParameter(
		"long-bay",
		starterParameters,
		"laneSpacingMeters",
		20,
	);
	const starter = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		starterParameters,
	);
	expect(starter.valid, starter.reason).toBe(true);
	expect(document.commit(starter)).toBe(true);

	const plan = planRailTemplate(
		document.map,
		templateId,
		anchor,
		pose,
		parameters,
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return { document, plan };
}

function selectionForAttachedPlan(
	document: RailDocument,
	plan: RailTemplatePlan,
): RailAreaSelection {
	const routeEdges = new Set<string>();
	for (const route of plan.template.buildRoutes) {
		for (let index = 0; index < route.length - 1; index++) {
			const from = route[index];
			const to = route[index + 1];
			if (from && to) routeEdges.add(`${from.x}:${from.y}>${to.x}:${to.y}`);
		}
	}
	const index = buildRailModuleOwnershipIndex(document.map);
	const ownerships = index.modules.filter(
		(module) =>
			module.eraseEdges.length > 0 &&
			module.eraseEdges.every((edge) =>
				routeEdges.has(`${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`),
			),
	);
	const ownedEdges = new Set(
		ownerships.flatMap((module) =>
			module.eraseEdges.map((edge) => `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`),
		),
	);
	expect(ownedEdges).toEqual(routeEdges);
	return Object.freeze({
		revision: index.revision,
		bounds: Object.freeze(plan.template.displayBounds),
		mode: "intersect",
		ownerships: Object.freeze(ownerships),
	});
}

function attachedParameters(
	templateId: "attached-return" | "branch-bypass" | "outerbay-link",
	forwardExtent: number,
	lateralExtent: number,
): RailTemplateParameters {
	let parameters = defaultRailTemplateParameters(templateId);
	if (templateId === "attached-return") {
		parameters = setRailTemplateParameter(
			templateId,
			parameters,
			"laneSpacingMeters",
			forwardExtent,
		);
		return setRailTemplateParameter(
			templateId,
			parameters,
			"runLengthMeters",
			lateralExtent,
		);
	}
	parameters = setRailTemplateParameter(
		templateId,
		parameters,
		"trunkSpanMeters",
		forwardExtent,
	);
	return setRailTemplateParameter(templateId, parameters, "offsetMeters", lateralExtent);
}

function selectWholeMap(document: RailDocument): RailAreaSelection {
	const index = buildRailModuleOwnershipIndex(document.map);
	return createRailAreaSelection(index, { x: -300, y: -300 }, { x: 300, y: 300 });
}

function rectangleRoute(width: number, height: number): readonly Cell[] {
	const route: Cell[] = [];
	for (let x = 0; x <= width; x++) route.push({ x, y: 0 });
	for (let y = 1; y <= height; y++) route.push({ x: width, y });
	for (let x = width - 1; x >= 0; x--) route.push({ x, y: height });
	for (let y = height - 1; y >= 0; y--) route.push({ x: 0, y });
	return route;
}

function encodedCells(document: RailDocument): readonly string[] {
	const rows: string[] = [];
	document.map.forEachRail((x, y, encoded) => rows.push(`${x}:${y}:${encoded}`));
	return rows.sort();
}
