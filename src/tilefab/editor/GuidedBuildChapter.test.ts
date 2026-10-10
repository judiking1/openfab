import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction, planRailErase } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	planRailAreaStamp,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	captureGuidedBuildTaskPlacementResult,
	completedGuidedBuildChapterBetween,
	deriveGuidedBuildChapters,
	evaluateGuidedBuildTask,
	GUIDED_BUILD_CHAPTERS,
	type GuidedBuildTaskEqResult,
	guidedBuildChapterEntryTool,
	guidedBuildChapterForMission,
	guidedBuildCurrentChapter,
	guidedBuildTaskBlueprintMatches,
	guidedBuildTaskEqResultMatches,
	guidedBuildTaskPlacementResultExists,
	resolveGuidedBuildChapterCheckpoint,
} from "./GuidedBuildChapter";
import {
	GUIDED_BUILD_FOUNDATION_MISSION_IDS,
	GUIDED_BUILD_FOUNDATION_MISSIONS,
	type GuidedBuildEvaluation,
	type GuidedBuildFoundationMissionId,
	type GuidedBuildMissionEvaluation,
} from "./GuidedBuildMission";

describe("EQ configuration practice results", () => {
	const state: PortEquipmentState = {
		nextPortId: 3,
		nextEquipmentGroupId: 2,
		ports: [1, 2].map((id) => ({
			id,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x: id * 2, z: 0, from: 0, to: 0 },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "EQ",
			barcode: null,
		})),
		equipmentGroups: [
			{ id: 1, kind: "EQ", portIds: [1, 2], pitchMillimeters: 2_000, recipe: null },
		],
	};
	const pitch: GuidedBuildTaskEqResult = {
		groupId: 1,
		pitch: { millimeters: 2_000, ports: state.ports },
	};
	it("does not credit existing values or a body that grew only from pitch", () => {
		expect(guidedBuildTaskEqResultMatches(undefined, state)).toEqual({ pitch: false, body: false });
		expect(guidedBuildTaskEqResultMatches(pitch, state)).toEqual({ pitch: true, body: false });
	});
	it("keeps a body-first length repair through a later pitch edit without requiring a width edit", () => {
		const body = { lengthMillimeters: 6_000, widthMillimeters: 900 };
		const after: PortEquipmentState = {
			...state,
			equipmentGroups: [
				{
					id: 1,
					kind: "EQ",
					portIds: [1, 2],
					pitchMillimeters: 2_000,
					recipe: null,
					bodyDimensions: body,
				},
			],
		};
		expect(guidedBuildTaskEqResultMatches({ groupId: 1, body }, after)).toEqual({
			pitch: false,
			body: true,
		});
		expect(guidedBuildTaskEqResultMatches({ ...pitch, body }, after)).toEqual({
			pitch: true,
			body: true,
		});
		const changed = {
			...after,
			ports: after.ports.map((port) => ({ ...port, stationMillimeters: 600 })),
		};
		expect(guidedBuildTaskEqResultMatches({ ...pitch, body }, changed)).toEqual({
			pitch: false,
			body: true,
		});
	});
	it("rejects missing or replaced groups and changed pitch, Ports or body dimensions", () => {
		const receipt = { ...pitch, body: { lengthMillimeters: 3_000, widthMillimeters: 900 } };
		expect(guidedBuildTaskEqResultMatches(receipt, { ...state, equipmentGroups: [] })).toEqual({
			pitch: false,
			body: false,
		});
		expect(guidedBuildTaskEqResultMatches({ ...receipt, groupId: 2 }, state)).toEqual({
			pitch: false,
			body: false,
		});
		expect(
			guidedBuildTaskEqResultMatches(receipt, { ...state, ports: state.ports.slice(0, 1) }).pitch,
		).toBe(false);
		const changed: PortEquipmentState = {
			...state,
			equipmentGroups: [
				{
					id: 1,
					kind: "EQ",
					portIds: [1, 2],
					pitchMillimeters: 3_000,
					recipe: null,
				},
			],
		};
		expect(guidedBuildTaskEqResultMatches(receipt, changed)).toEqual({ pitch: false, body: false });
	});
	it("requires both results and mirror settlement, and accepts body-first ordering", () => {
		const evidence = {
			settled: true,
			fabCreated: false,
			fabInspected: false,
			equipmentSelected: false,
			equipmentEdited: false,
			blueprintSaved: false,
			blueprintPlaced: false,
			eqPitchEdited: false,
			eqBodyEdited: true,
		};
		expect(evaluateGuidedBuildTask("eq-configuration", evidence)).toMatchObject({
			step: 1,
			complete: false,
		});
		expect(
			evaluateGuidedBuildTask("eq-configuration", { ...evidence, eqPitchEdited: true }),
		).toMatchObject({ complete: true });
		expect(
			evaluateGuidedBuildTask("eq-configuration", {
				...evidence,
				eqPitchEdited: true,
				settled: false,
			}),
		).toMatchObject({ complete: false });
		expect(
			evaluateGuidedBuildTask("eq-configuration", {
				...evidence,
				eqPitchEdited: true,
				eqBodyEdited: false,
			}),
		).toMatchObject({ step: 2, complete: false });
	});
});

describe("short practice committed placement footprint", () => {
	it("stops completing after deletion even while placement remains in history, and follows deletion Undo/Redo", () => {
		const document = new RailDocument();
		const placed = planRailConstruction(document.map, { x: 20, y: 10 }, { x: 25, y: 10 });
		expect(document.commit(placed)).toBe(true);
		const placementEntry = document.captureRailMirrorHistoryLedger().undo.at(-1);
		const receipt = captureGuidedBuildTaskPlacementResult(placed, document.map);
		const exists = () => guidedBuildTaskPlacementResultExists(receipt, document);
		expect(exists()).toBe(true);
		expect(document.commit(planRailErase(document.map, placed.cells))).toBe(true);
		expect(document.captureRailMirrorHistoryLedger().undo).toContain(placementEntry);
		expect(exists()).toBe(false);
		expect(document.undo()).toBe(true);
		expect(exists()).toBe(true);
		expect(document.redo()).toBe(true);
		expect(exists()).toBe(false);
	});
	it("keeps an unchanged placement after unrelated editing and never mutates source while checking", () => {
		const document = new RailDocument();
		const placed = planRailConstruction(document.map, { x: 20, y: 10 }, { x: 25, y: 10 });
		expect(document.commit(placed)).toBe(true);
		const receipt = captureGuidedBuildTaskPlacementResult(placed, document.map);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const sequence = document.getPatchSequence();
		const history = document.captureRailMirrorHistoryLedger();
		expect(guidedBuildTaskPlacementResultExists(receipt, document)).toBe(true);
		expect(document.getPatchSequence()).toBe(sequence);
		expect(document.captureRailMirrorHistoryLedger()).toEqual(history);
	});
	it("requires the committed organization identity even when its rails remain", () => {
		const document = new RailDocument();
		const placed = planRailConstruction(document.map, { x: 20, y: 10 }, { x: 25, y: 10 });
		expect(document.commit(placed)).toBe(true);
		const organization = {
			id: 1,
			kind: "AREA",
			name: "Placed",
			membership: {
				railEdges: [{ from: { x: 20, y: 10 }, to: { x: 21, y: 10 } }],
				advancedSwitchIds: [],
				equipmentGroupIds: [],
			},
		} as const;
		const result = captureGuidedBuildTaskPlacementResult(
			{
				...placed,
				organizationMutations: [{ id: 1, before: null, after: organization }],
			},
			document.map,
		);
		const source = {
			map: document.map,
			portEquipment: document.portEquipment,
			relationships: document.relationships,
			organizations: { nextOrganizationId: 2, records: [organization] },
		};
		expect(guidedBuildTaskPlacementResultExists(result, source)).toBe(true);
		expect(
			guidedBuildTaskPlacementResultExists(result, {
				...source,
				organizations: {
					nextOrganizationId: 3,
					records: [{ ...organization, id: 2 }],
				},
			}),
		).toBe(false);
		expect(guidedBuildTaskPlacementResultExists(result, document)).toBe(false);
	});
	it("includes unchanged shared cells in an overlapping stamp and follows their deletion Undo/Redo", () => {
		const source = new RailDocument();
		for (const y of [0, 4])
			expect(source.commit(planRailConstruction(source.map, { x: 0, y }, { x: 10, y }))).toBe(true);
		const template = createRailAreaStampTemplate(
			createRailAreaSelection(
				buildRailModuleOwnershipIndex(source.map),
				{ x: -1, y: -1 },
				{ x: 11, y: 5 },
			),
		);
		const document = new RailDocument();
		const shared = planRailConstruction(document.map, { x: 20, y: 10 }, { x: 30, y: 10 });
		expect(document.commit(shared)).toBe(true);
		const placed = planRailAreaStamp(
			document.map,
			template,
			{ x: 20, y: 10 },
			initialRailAreaStampPose(),
		);
		expect(placed.valid, placed.reason).toBe(true);
		expect(placed.reason).toContain("기존 레일 10 m 공유");
		expect(placed.mutations).toHaveLength(11);
		expect(placed.cells).toHaveLength(22);
		expect(document.commit(placed)).toBe(true);
		const receipt = captureGuidedBuildTaskPlacementResult(placed, document.map);
		const entry = document.captureRailMirrorHistoryLedger().undo.at(-1);
		const exists = () => guidedBuildTaskPlacementResultExists(receipt, document);
		expect(receipt.footprint).toHaveLength(22);
		expect(exists()).toBe(true);
		expect(document.commit(planRailErase(document.map, shared.cells))).toBe(true);
		expect(document.captureRailMirrorHistoryLedger().undo).toContain(entry);
		expect(
			placed.mutations.every(({ x, y, after }) => document.map.getEncoded(x, y) === after),
		).toBe(true);
		expect(exists()).toBe(false);
		expect(document.undo()).toBe(true);
		expect(exists()).toBe(true);
		expect(document.redo()).toBe(true);
		expect(exists()).toBe(false);
	});
});

describe("short practice saved Blueprint identity", () => {
	const record = {
		id: "practice-blueprint",
		kind: "RAIL_AREA",
		name: "Practice",
		folder: "",
		favorite: false,
		createdAt: "2026-10-10T00:00:00Z",
		updatedAt: "2026-10-10T00:00:00Z",
		sourceModuleCount: 1,
		widthMeters: 2,
		heightMeters: 1,
		edges: [[0, 0, 1, 0]],
	} as const;
	it("keeps actual saved content through a library reload and a metadata edit", () => {
		expect(guidedBuildTaskBlueprintMatches(record, JSON.parse(JSON.stringify(record)))).toBe(true);
		expect(
			guidedBuildTaskBlueprintMatches(record, { ...record, name: "Renamed", favorite: true }),
		).toBe(true);
	});
	it("rejects another saved item or replaced source despite matching presentation", () => {
		expect(guidedBuildTaskBlueprintMatches(record, { ...record, id: "other" })).toBe(false);
		expect(guidedBuildTaskBlueprintMatches(record, { ...record, edges: [[0, 0, 0, 1]] })).toBe(
			false,
		);
	});
});

describe("chapter entry tool boundaries", () => {
	it.each([
		"ohb",
		"eq",
		"stk",
	] as const)("enters the current %s task without an authored action", (tool) => {
		expect(guidedBuildChapterEntryTool("quick-start", "ports", tool)).toBe(tool);
	});
	it("enters selection only for the adjacent equipment-to-reuse checkpoint", () => {
		expect(guidedBuildChapterEntryTool("equip", "reuse-loop", "inspect")).toBe("inspect");
		expect(guidedBuildChapterEntryTool("quick-start", "reuse-loop", "inspect")).toBeNull();
		expect(guidedBuildChapterEntryTool("equip", "ports", "inspect")).toBeNull();
	});
	it("keeps source-changing, save and project replacement actions explicit", () => {
		for (const action of [
			"copy-selection",
			"graduate-practice",
			"add-bay",
			"duplicate-bay",
			"arrange-bays",
			"connect-bays",
			"save-project",
			"open-project",
		] as const) {
			expect(guidedBuildChapterEntryTool("equip", "reuse-loop", action)).toBeNull();
			expect(guidedBuildChapterEntryTool("reuse", "bay", action)).toBeNull();
		}
	});
	it("does not revive stale, dismissed or unrelated mission entries", () => {
		expect(guidedBuildChapterEntryTool(null, "ports", "ohb")).toBeNull();
		expect(guidedBuildChapterEntryTool("quick-start", null, "ohb")).toBeNull();
		expect(guidedBuildChapterEntryTool("quick-start", "ports", null)).toBeNull();
		expect(guidedBuildChapterEntryTool("quick-start", "process-loop", "ohb")).toBeNull();
		expect(guidedBuildChapterEntryTool("reuse", "ports", "stk")).toBeNull();
	});
});

describe("GuidedBuildChapter", () => {
	it("partitions all 13 canonical missions once and in exact order", () => {
		const missionIds = GUIDED_BUILD_CHAPTERS.flatMap((chapter) => chapter.missionIds);

		expect(missionIds).toEqual(GUIDED_BUILD_FOUNDATION_MISSION_IDS);
		expect(new Set(missionIds).size).toBe(GUIDED_BUILD_FOUNDATION_MISSION_IDS.length);
		expect(GUIDED_BUILD_CHAPTERS.map((chapter) => chapter.id)).toEqual([
			"quick-start",
			"equip",
			"reuse",
			"advanced-fab",
		]);
		for (const chapter of GUIDED_BUILD_CHAPTERS) {
			expect(Object.isFrozen(chapter)).toBe(true);
			expect(Object.isFrozen(chapter.missionIds)).toBe(true);
		}
	});

	it("maps every canonical mission to its presentation chapter", () => {
		expect(guidedBuildChapterForMission("orient").id).toBe("quick-start");
		expect(guidedBuildChapterForMission("process-loop").id).toBe("quick-start");
		expect(guidedBuildChapterForMission("ports").id).toBe("equip");
		expect(guidedBuildChapterForMission("reuse-loop").id).toBe("reuse");
		expect(guidedBuildChapterForMission("bay").id).toBe("advanced-fab");
		expect(guidedBuildChapterForMission("project-reopen").id).toBe("advanced-fab");
	});

	it("derives current status and counts without changing canonical mission evaluation", () => {
		const evaluation = canonicalEvaluationAt("first-rail");
		const before = evaluation.missions.map((mission) => mission.status);
		const summary = deriveGuidedBuildChapters(evaluation);

		expect(summary.currentChapterId).toBe("quick-start");
		expect(summary.completedChapterCount).toBe(0);
		expect(summary.complete).toBe(false);
		expect(summary.chapters.map(chapterResult)).toEqual([
			"quick-start:current:1/3:first-rail",
			"equip:locked:0/1:none",
			"reuse:locked:0/1:none",
			"advanced-fab:locked:0/8:none",
		]);
		expect(guidedBuildCurrentChapter(summary)?.definition.id).toBe("quick-start");
		expect(evaluation.missions.map((mission) => mission.status)).toEqual(before);
		expect(Object.isFrozen(summary)).toBe(true);
		expect(Object.isFrozen(summary.chapters)).toBe(true);
	});

	it.each([
		[
			"ports",
			"equip",
			1,
			[
				"quick-start:complete:3/3:none",
				"equip:current:0/1:ports",
				"reuse:locked:0/1:none",
				"advanced-fab:locked:0/8:none",
			],
		],
		[
			"reuse-loop",
			"reuse",
			2,
			[
				"quick-start:complete:3/3:none",
				"equip:complete:1/1:none",
				"reuse:current:0/1:reuse-loop",
				"advanced-fab:locked:0/8:none",
			],
		],
		[
			"bay",
			"advanced-fab",
			3,
			[
				"quick-start:complete:3/3:none",
				"equip:complete:1/1:none",
				"reuse:complete:1/1:none",
				"advanced-fab:current:0/8:bay",
			],
		],
	] as const)("advances %s into the expected resumable chapter", (currentMissionId, expectedChapterId, completedChapterCount, expectedChapters) => {
		const summary = deriveGuidedBuildChapters(canonicalEvaluationAt(currentMissionId));

		expect(summary.currentChapterId).toBe(expectedChapterId);
		expect(summary.completedChapterCount).toBe(completedChapterCount);
		expect(summary.chapters.map(chapterResult)).toEqual(expectedChapters);
	});

	it("reports all four chapters complete only after all canonical missions complete", () => {
		const summary = deriveGuidedBuildChapters(canonicalEvaluationAt(null));

		expect(summary.currentChapterId).toBeNull();
		expect(summary.completedChapterCount).toBe(4);
		expect(summary.complete).toBe(true);
		expect(guidedBuildCurrentChapter(summary)).toBeNull();
		expect(summary.chapters.every((chapter) => chapter.status === "complete")).toBe(true);
	});

	it("emits a checkpoint only for an adjacent forward chapter transition", () => {
		expect(completedGuidedBuildChapterBetween("quick-start", "equip")).toBe("quick-start");
		expect(completedGuidedBuildChapterBetween("equip", "reuse")).toBe("equip");
		expect(completedGuidedBuildChapterBetween("reuse", "advanced-fab")).toBe("reuse");

		expect(completedGuidedBuildChapterBetween("advanced-fab", "reuse")).toBeNull();
		expect(completedGuidedBuildChapterBetween("reuse", "equip")).toBeNull();
		expect(completedGuidedBuildChapterBetween("quick-start", "advanced-fab")).toBeNull();
		expect(completedGuidedBuildChapterBetween("equip", "equip")).toBeNull();
		expect(completedGuidedBuildChapterBetween(null, "equip")).toBeNull();
		expect(completedGuidedBuildChapterBetween("advanced-fab", null)).toBeNull();
	});

	it("does not replay completion while opening or hydrating a resumable guide", () => {
		expect(
			resolveGuidedBuildChapterCheckpoint({
				existingChapterId: null,
				previousChapterId: "quick-start",
				nextChapterId: "equip",
				guidedBuildOpen: true,
				guidedBuildWasOpen: false,
			}),
		).toBeNull();
		expect(
			resolveGuidedBuildChapterCheckpoint({
				existingChapterId: null,
				previousChapterId: "quick-start",
				nextChapterId: "equip",
				guidedBuildOpen: true,
				guidedBuildWasOpen: true,
			}),
		).toBe("quick-start");
		expect(
			resolveGuidedBuildChapterCheckpoint({
				existingChapterId: "quick-start",
				previousChapterId: "equip",
				nextChapterId: "equip",
				guidedBuildOpen: true,
				guidedBuildWasOpen: true,
			}),
		).toBe("quick-start");
		expect(
			resolveGuidedBuildChapterCheckpoint({
				existingChapterId: "quick-start",
				previousChapterId: "equip",
				nextChapterId: "quick-start",
				guidedBuildOpen: true,
				guidedBuildWasOpen: true,
			}),
		).toBeNull();
	});
});

function canonicalEvaluationAt(
	currentMissionId: GuidedBuildFoundationMissionId | null,
): GuidedBuildEvaluation {
	const currentIndex =
		currentMissionId === null
			? GUIDED_BUILD_FOUNDATION_MISSIONS.length
			: GUIDED_BUILD_FOUNDATION_MISSIONS.findIndex((mission) => mission.id === currentMissionId);
	if (currentIndex < 0) throw new TypeError(`Unknown current mission: ${currentMissionId}`);
	const missions = GUIDED_BUILD_FOUNDATION_MISSIONS.map((definition, index) => {
		const status: GuidedBuildMissionEvaluation["status"] =
			index < currentIndex ? "complete" : index === currentIndex ? "current" : "locked";
		return Object.freeze({
			definition,
			prompt: Object.freeze({
				eyebrow: definition.eyebrow,
				title: definition.title,
				objective: definition.objective,
				rationale: definition.rationale,
				primaryCommandId: definition.primaryCommandId,
				suggestedAction: null,
				suggestedActionLabel: null,
			}),
			conditionMet: status === "complete",
			status,
		});
	});
	return Object.freeze({
		sourceKey: `fixture:${currentMissionId ?? "complete"}`,
		currentMissionId,
		completedMissionCount: currentIndex,
		complete: currentMissionId === null,
		missions: Object.freeze(missions),
	});
}

function chapterResult(chapter: ReturnType<typeof deriveGuidedBuildChapters>["chapters"][number]) {
	return `${chapter.definition.id}:${chapter.status}:${chapter.completedMissionCount}/${chapter.missionCount}:${chapter.currentMissionId ?? "none"}`;
}
