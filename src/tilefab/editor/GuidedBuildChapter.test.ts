import { describe, expect, it } from "vitest";
import {
	completedGuidedBuildChapterBetween,
	deriveGuidedBuildChapters,
	GUIDED_BUILD_CHAPTERS,
	guidedBuildChapterForMission,
	guidedBuildCurrentChapter,
	resolveGuidedBuildChapterCheckpoint,
} from "./GuidedBuildChapter";
import {
	GUIDED_BUILD_FOUNDATION_MISSION_IDS,
	GUIDED_BUILD_FOUNDATION_MISSIONS,
	type GuidedBuildEvaluation,
	type GuidedBuildFoundationMissionId,
	type GuidedBuildMissionEvaluation,
} from "./GuidedBuildMission";

describe("GuidedBuildChapter", () => {
	it("partitions all 12 canonical missions once and in exact order", () => {
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
			"advanced-fab:locked:0/7:none",
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
				"advanced-fab:locked:0/7:none",
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
				"advanced-fab:locked:0/7:none",
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
				"advanced-fab:current:0/7:bay",
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
