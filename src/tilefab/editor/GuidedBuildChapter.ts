import type { GuidedBuildEvaluation, GuidedBuildFoundationMissionId } from "./GuidedBuildMission";

export const GUIDED_BUILD_CHAPTER_IDS = ["quick-start", "equip", "reuse", "advanced-fab"] as const;

export type GuidedBuildChapterId = (typeof GUIDED_BUILD_CHAPTER_IDS)[number];

export interface GuidedBuildChapterDefinition {
	readonly id: GuidedBuildChapterId;
	readonly sequence: 1 | 2 | 3 | 4;
	readonly label: string;
	readonly title: string;
	readonly missionIds: readonly GuidedBuildFoundationMissionId[];
}

export type GuidedBuildChapterStatus = "locked" | "current" | "complete";

export interface GuidedBuildChapterEvaluation {
	readonly definition: GuidedBuildChapterDefinition;
	readonly status: GuidedBuildChapterStatus;
	readonly completedMissionCount: number;
	readonly missionCount: number;
	readonly currentMissionId: GuidedBuildFoundationMissionId | null;
}

export interface GuidedBuildChapterSummary {
	readonly currentChapterId: GuidedBuildChapterId | null;
	readonly completedChapterCount: number;
	readonly complete: boolean;
	readonly chapters: readonly GuidedBuildChapterEvaluation[];
}

export const GUIDED_BUILD_CHAPTERS = Object.freeze([
	chapter({
		id: "quick-start",
		sequence: 1,
		label: "QUICK START",
		title: "레일 기본기",
		missionIds: ["orient", "first-rail", "process-loop"],
	}),
	chapter({
		id: "equip",
		sequence: 2,
		label: "EQUIP",
		title: "Port-first 장비",
		missionIds: ["ports"],
	}),
	chapter({
		id: "reuse",
		sequence: 3,
		label: "REUSE",
		title: "Loop 재사용",
		missionIds: ["reuse-loop"],
	}),
	chapter({
		id: "advanced-fab",
		sequence: 4,
		label: "ADVANCED FAB",
		title: "FAB 구조·검증·저장",
		missionIds: [
			"bay",
			"bay-bank",
			"interbay",
			"fab-loop",
			"checks",
			"project-save",
			"project-reopen",
		],
	}),
] as const satisfies readonly GuidedBuildChapterDefinition[]);

const CHAPTER_INDEX_BY_ID: Readonly<Record<GuidedBuildChapterId, number>> = Object.freeze({
	"quick-start": 0,
	equip: 1,
	reuse: 2,
	"advanced-fab": 3,
});

/**
 * Groups the existing canonical mission evaluation into four presentation-only chapters.
 *
 * Mission conditions, ordering, and completion remain owned by `evaluateGuidedBuildFoundation`.
 * This derivation has no project, browser, storage, or serialization state of its own.
 */
export function deriveGuidedBuildChapters(
	evaluation: GuidedBuildEvaluation,
): GuidedBuildChapterSummary {
	const missionById = new Map(
		evaluation.missions.map((mission) => [mission.definition.id, mission] as const),
	);
	let currentChapterId: GuidedBuildChapterId | null = null;
	let completedChapterCount = 0;
	const chapters = GUIDED_BUILD_CHAPTERS.map((definition) => {
		const missions = definition.missionIds.map((missionId) => {
			const mission = missionById.get(missionId);
			if (!mission) throw new TypeError(`Missing Guided Build mission evaluation: ${missionId}`);
			return mission;
		});
		const completedMissionCount = missions.reduce(
			(count, mission) => count + (mission.status === "complete" ? 1 : 0),
			0,
		);
		const currentMission = missions.find((mission) => mission.status === "current") ?? null;
		const status: GuidedBuildChapterStatus =
			completedMissionCount === missions.length
				? "complete"
				: currentMission
					? "current"
					: "locked";
		if (status === "complete") completedChapterCount++;
		if (status === "current") currentChapterId ??= definition.id;
		return Object.freeze({
			definition,
			status,
			completedMissionCount,
			missionCount: missions.length,
			currentMissionId: currentMission?.definition.id ?? null,
		});
	});
	return Object.freeze({
		currentChapterId,
		completedChapterCount,
		complete: completedChapterCount === GUIDED_BUILD_CHAPTERS.length,
		chapters: Object.freeze(chapters),
	});
}

export function guidedBuildChapterForMission(
	missionId: GuidedBuildFoundationMissionId,
): GuidedBuildChapterDefinition {
	const definition = GUIDED_BUILD_CHAPTERS.find((candidate) =>
		candidate.missionIds.includes(missionId),
	);
	if (!definition) throw new TypeError(`Unknown Guided Build mission chapter: ${missionId}`);
	return definition;
}

export function guidedBuildCurrentChapter(
	summary: GuidedBuildChapterSummary,
): GuidedBuildChapterEvaluation | null {
	if (summary.currentChapterId === null) return null;
	return (
		summary.chapters.find(
			(chapterEvaluation) => chapterEvaluation.definition.id === summary.currentChapterId,
		) ?? null
	);
}

/**
 * Returns the chapter that just completed only for one adjacent forward transition.
 *
 * Initial hydration, same-chapter updates, undo/backward transitions, multi-chapter project-load
 * jumps, and final completion do not manufacture a checkpoint.
 */
export function completedGuidedBuildChapterBetween(
	previousChapterId: GuidedBuildChapterId | null,
	nextChapterId: GuidedBuildChapterId | null,
): GuidedBuildChapterId | null {
	if (previousChapterId === null || nextChapterId === null) return null;
	return CHAPTER_INDEX_BY_ID[nextChapterId] === CHAPTER_INDEX_BY_ID[previousChapterId] + 1
		? previousChapterId
		: null;
}

export function resolveGuidedBuildChapterCheckpoint(options: {
	readonly existingChapterId: GuidedBuildChapterId | null;
	readonly previousChapterId: GuidedBuildChapterId | null;
	readonly nextChapterId: GuidedBuildChapterId | null;
	readonly guidedBuildOpen: boolean;
	readonly guidedBuildWasOpen: boolean;
}): GuidedBuildChapterId | null {
	if (!options.guidedBuildOpen || !options.guidedBuildWasOpen) return null;
	const completedChapterId = completedGuidedBuildChapterBetween(
		options.previousChapterId,
		options.nextChapterId,
	);
	if (completedChapterId !== null) return completedChapterId;
	return options.existingChapterId !== null &&
		completedGuidedBuildChapterBetween(options.existingChapterId, options.nextChapterId) ===
			options.existingChapterId
		? options.existingChapterId
		: null;
}

function chapter(
	definition: Omit<GuidedBuildChapterDefinition, "missionIds"> & {
		readonly missionIds: readonly GuidedBuildFoundationMissionId[];
	},
): GuidedBuildChapterDefinition {
	return Object.freeze({
		...definition,
		missionIds: Object.freeze([...definition.missionIds]),
	});
}
