import { describe, expect, it } from "vitest";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import type { PortEquipmentState } from "./EquipmentGroup";
import { analyzeRailNetwork } from "./network";
import { createRailAreaSelection, type RailAreaSelection } from "./RailAreaSelection";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { recognizeRailPattern, type RailPatternCandidate } from "./RailPatternRecognition";
import { planRailPatternResize } from "./RailPatternResizePlanner";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
	railTemplateParameterValue,
	setRailTemplateParameter,
	type RailTemplateId,
	type RailTemplateParameterKey,
	type RailTemplateParameters,
} from "./RailTemplateCatalog";
import { directionBetween, oppositeDirection } from "./railShape";
import type { Cell } from "./TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";

describe("RailPatternResizePlanner", () => {
	it("resizes a recognized Long Bay as one atomic edit with undo, redo, and Worker parity", () => {
		const document = new RailDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		commitTemplate(document, "long-bay", { x: 0, y: 0 });
		const selection = selectWholeMap(document);
		const candidate = recognizedCandidate(selection, "long-bay");
		const beforeChecksum = checksumRailMap(document.map, document.portEquipment);
		const afterParameters = changeParameter(candidate.parameters, "aisleLengthMeters", 30);
		const plan = planRailPatternResize(
			document.map,
			document.portEquipment,
			selection,
			candidate,
			afterParameters,
		);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
			document.portEquipment,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(plan).toMatchObject({
			kind: "edit",
			patternResize: {
				templateId: "long-bay",
				beforeEdgeCount: 60,
				afterEdgeCount: 72,
			},
		});
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(events.at(-1)?.kind).toBe("edit");
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			components: 1,
			strongComponents: 1,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		const afterChecksum = checksumRailMap(document.map, document.portEquipment);
		expect(afterChecksum).not.toBe(beforeChecksum);

		const mirror = new RailPatchMirror();
		for (const event of events) mirror.applyPatch(event);
		expect(mirror.state.checksum).toBe(afterChecksum);
		expect(document.undo()).toBe(true);
		const undoEvent = events.at(-1);
		if (!undoEvent) throw new Error("Expected an undo event.");
		expect(mirror.applyPatch(undoEvent).checksum).toBe(beforeChecksum);
		expect(checksumRailMap(document.map, document.portEquipment)).toBe(beforeChecksum);
		expect(document.redo()).toBe(true);
		const redoEvent = events.at(-1);
		if (!redoEvent) throw new Error("Expected a redo event.");
		expect(mirror.applyPatch(redoEvent).checksum).toBe(afterChecksum);
	});

	it.each([
		["paired-bay", "laneSpacingMeters", 10],
		["nested-bay", "offsetMeters", 7],
		["shift-bay", "offsetMeters", 4],
		["interbay-spine", "bayCount", 4],
	] satisfies readonly [
		RailTemplateId,
		RailTemplateParameterKey,
		number,
	][])("replans %s integer structure locally through the ordinary physical evaluator", (templateId, key, value) => {
		const document = new RailDocument();
		commitTemplate(document, templateId, { x: 10, y: 20 });
		const selection = selectWholeMap(document);
		const candidate = recognizedCandidate(selection, templateId);
		const parameters = changeParameter(candidate.parameters, key, value);
		const plan = planRailPatternResize(
			document.map,
			document.portEquipment,
			selection,
			candidate,
			parameters,
		);
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
			document.portEquipment,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			openEnds: 0,
			unsafeJunctions: 0,
		});
	});

	it("rejects a stale selection before deriving replacement mutations", () => {
		const document = new RailDocument();
		commitTemplate(document, "long-bay", { x: 0, y: 0 });
		const selection = selectWholeMap(document);
		const candidate = recognizedCandidate(selection, "long-bay");
		commitTemplate(document, "long-bay", { x: 100, y: 100 });

		const plan = planRailPatternResize(
			document.map,
			document.portEquipment,
			selection,
			candidate,
			changeParameter(candidate.parameters, "aisleLengthMeters", 30),
		);
		expect(plan).toMatchObject({ valid: false, mutations: [] });
		expect(plan.reason).toMatch(/오래되어/);
	});

	it("rejects a pattern with an external branch or merge instead of moving its child route", () => {
		const document = new RailDocument();
		commitTemplate(document, "long-bay", { x: 0, y: 0 });
		const sourceSelection = selectWholeMap(document);
		const candidate = recognizedCandidate(sourceSelection, "long-bay");
		const attach = planRailTemplate(
			document.map,
			"attached-return",
			{ x: 4, y: 0 },
			{ ...initialRailTemplatePose(), side: "left" },
			defaultRailTemplateParameters("attached-return"),
		);
		expect(attach.valid, attach.reason).toBe(true);
		expect(document.commit(attach)).toBe(true);
		const forgedCurrentSelection = rebindSelection(sourceSelection, document.map.getRevision());

		const plan = planRailPatternResize(
			document.map,
			document.portEquipment,
			forgedCurrentSelection,
			candidate,
			changeParameter(candidate.parameters, "aisleLengthMeters", 30),
		);
		expect(plan.valid).toBe(false);
		expect(plan.reason).toMatch(/외부 분기·합류/);
	});

	it("rejects in-place resize when a port is attached to the selected rail", () => {
		const document = new RailDocument();
		commitTemplate(document, "long-bay", { x: 0, y: 0 });
		const selection = selectWholeMap(document);
		const candidate = recognizedCandidate(selection, "long-bay");
		const firstEdge = selection.ownerships[0]?.eraseEdges[0];
		if (!firstEdge) throw new Error("Expected a selected edge.");
		const direction = directionBetween(firstEdge.from, firstEdge.to);
		if (!direction) throw new Error("Expected a cardinal selected edge.");
		const portEquipment = singleOhbState(firstEdge.from, oppositeDirection(direction), direction);

		const plan = planRailPatternResize(
			document.map,
			portEquipment,
			selection,
			candidate,
			changeParameter(candidate.parameters, "aisleLengthMeters", 30),
		);
		expect(plan.valid).toBe(false);
		expect(plan.reason).toMatch(/PORT-1/);
	});

	it("rejects expansion into another authored rail component", () => {
		const document = new RailDocument();
		commitTemplate(document, "long-bay", { x: 0, y: 0 });
		const sourceSelection = selectWholeMap(document);
		const candidate = recognizedCandidate(sourceSelection, "long-bay");
		commitTemplate(document, "long-bay", { x: 26, y: 0 });
		const currentSelection = rebindSelection(sourceSelection, document.map.getRevision());

		const plan = planRailPatternResize(
			document.map,
			document.portEquipment,
			currentSelection,
			candidate,
			changeParameter(candidate.parameters, "aisleLengthMeters", 30),
		);
		expect(plan.valid).toBe(false);
		expect(plan.reason).toMatch(/다른 레일/);
		expect(plan.conflicts.length).toBeGreaterThan(0);
	});

	it("returns an explicit no-op when every structural parameter is unchanged", () => {
		const document = new RailDocument();
		commitTemplate(document, "long-bay", { x: 0, y: 0 });
		const selection = selectWholeMap(document);
		const candidate = recognizedCandidate(selection, "long-bay");
		const plan = planRailPatternResize(
			document.map,
			document.portEquipment,
			selection,
			candidate,
			candidate.parameters,
		);
		expect(plan).toMatchObject({
			valid: false,
			mutations: [],
			reason: "변경된 패턴 치수가 없습니다",
		});
	});
});

function commitTemplate(document: RailDocument, templateId: RailTemplateId, anchor: Cell): void {
	const plan = planRailTemplate(
		document.map,
		templateId,
		anchor,
		initialRailTemplatePose(),
		defaultRailTemplateParameters(templateId),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
}

function selectWholeMap(document: RailDocument): RailAreaSelection {
	const index = buildRailModuleOwnershipIndex(document.map);
	return createRailAreaSelection(index, { x: -500, y: -500 }, { x: 500, y: 500 });
}

function recognizedCandidate(
	selection: RailAreaSelection,
	templateId: RailTemplateId,
): RailPatternCandidate {
	const recognition = recognizeRailPattern(selection);
	const candidate = recognition.candidates.find((match) => match.templateId === templateId);
	if (!candidate) throw new Error(`Expected ${templateId}: ${recognition.reason}`);
	return candidate;
}

function changeParameter(
	parameters: RailTemplateParameters,
	key: RailTemplateParameterKey,
	value: number,
): RailTemplateParameters {
	const current = railTemplateParameterValue(parameters, key);
	if (!Number.isFinite(current)) throw new Error(`Parameter ${key} is not available.`);
	return setRailTemplateParameter(parameters.templateId, parameters, key, value);
}

function rebindSelection(selection: RailAreaSelection, revision: number): RailAreaSelection {
	return Object.freeze({
		...selection,
		revision,
		ownerships: Object.freeze(
			selection.ownerships.map((ownership) => Object.freeze({ ...ownership, revision })),
		),
	});
}

function singleOhbState(cell: Cell, from: number, to: number): PortEquipmentState {
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: cell.x,
					z: cell.y,
					from: from as 1 | 2 | 4 | 8,
					to: to as 1 | 2 | 4 | 8,
				}),
				stationMillimeters: 0,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: null,
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
		]),
	});
}
