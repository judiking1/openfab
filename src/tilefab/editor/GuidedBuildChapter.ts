import { advancedSwitchEquals } from "../core/AdvancedSwitch";
import {
	type EqBodyDimensions,
	eqBodyDimensionsEqual,
	equipmentGroupEquals,
	type PortEquipmentState,
	resolveEqBodyDimensions,
} from "../core/EquipmentGroup";
import { type PortRecord, portRecordEquals } from "../core/PortRecord";
import type { RailDocument } from "../core/RailDocument";
import { staticFabAssemblyRelationshipRecordEquals } from "../core/StaticFabAssemblyRelationship";
import { staticFabOrganizationRecordEquals } from "../core/StaticFabOrganization";
import type { StaticFabOrganizationBundlePlacementPlan } from "../core/StaticFabOrganizationBundlePlacement";
import type { OpenFabProjectBlueprint } from "../project/OpenFabBlueprintLibrary";
import type {
	GuidedBuildEvaluation,
	GuidedBuildFoundationMissionId,
	GuidedBuildSuggestedAction,
} from "./GuidedBuildMission";

export type GuidedBuildTaskId = "fab" | "equipment" | "eq-configuration" | "blueprint";

export interface GuidedBuildTaskEqResult {
	readonly groupId: number;
	readonly pitch?: Readonly<{ millimeters: number; ports: readonly PortRecord[] }>;
	readonly body?: EqBodyDimensions;
}

/** Independent command results: a pitch-derived body never supplies an explicit body receipt. */
export function guidedBuildTaskEqResultMatches(
	result: GuidedBuildTaskEqResult | undefined,
	state: PortEquipmentState,
) {
	if (!result) return { pitch: false, body: false };
	const group = state.equipmentGroups.find((candidate) => candidate.id === result.groupId);
	if (group?.kind !== "EQ") return { pitch: false, body: false };
	const pitch = result.pitch;
	const ports = new Map(
		state.ports.filter((port) => port.equipmentGroupId === group.id).map((port) => [port.id, port]),
	);
	return {
		pitch: Boolean(
			pitch &&
				group.pitchMillimeters === pitch.millimeters &&
				group.portIds.length === pitch.ports.length &&
				pitch.ports.every(
					(expected) =>
						group.portIds.includes(expected.id) &&
						portRecordEquals(ports.get(expected.id), expected),
				),
		),
		body: Boolean(
			result.body && eqBodyDimensionsEqual(resolveEqBodyDimensions(group), result.body),
		),
	};
}

export type GuidedBuildTaskPlacementPlan = Pick<StaticFabOrganizationBundlePlacementPlan, "cells"> &
	Partial<
		Pick<
			StaticFabOrganizationBundlePlacementPlan,
			| "switchMutations"
			| "portMutations"
			| "equipmentGroupMutations"
			| "organizationMutations"
			| "relationshipMutations"
		>
	>;

export type GuidedBuildTaskPlacementResult = Omit<GuidedBuildTaskPlacementPlan, "cells"> & {
	readonly footprint: readonly Readonly<{ x: number; y: number; encoded: number }>[];
};

/** Capture only the successful placement's full footprint, including unchanged shared cells. */
export function captureGuidedBuildTaskPlacementResult(
	plan: GuidedBuildTaskPlacementPlan,
	map: Pick<RailDocument["map"], "getEncoded">,
): GuidedBuildTaskPlacementResult {
	return Object.freeze({
		footprint: Object.freeze(
			plan.cells.map(({ x, y }) => Object.freeze({ x, y, encoded: map.getEncoded(x, y) })),
		),
		switchMutations: plan.switchMutations,
		portMutations: plan.portMutations,
		equipmentGroupMutations: plan.equipmentGroupMutations,
		organizationMutations: plan.organizationMutations,
		relationshipMutations: plan.relationshipMutations,
	});
}

/** Read the committed footprint with existing domain equality; never replay a command for guidance. */
export function guidedBuildTaskPlacementResultExists(
	result: GuidedBuildTaskPlacementResult,
	document: Pick<RailDocument, "map" | "portEquipment" | "organizations" | "relationships">,
): boolean {
	if (!result.footprint.length && !result.switchMutations?.length) return false;
	if (!result.footprint.every(({ x, y, encoded }) => document.map.getEncoded(x, y) === encoded))
		return false;
	if (
		result.switchMutations &&
		!result.switchMutations.every(({ id, after }) =>
			advancedSwitchEquals(document.map.getAdvancedSwitch(id), after),
		)
	)
		return false;
	const recordsMatch = <T extends { readonly id: number }>(
		changes: readonly { readonly id: number; readonly after: T | null }[] | undefined,
		records: readonly T[],
		equals: (left: T | undefined, right: T | null) => boolean,
	): boolean => {
		if (!changes?.length) return true;
		const byId = new Map(records.map((record) => [record.id, record]));
		return changes.every(({ id, after }) => equals(byId.get(id), after));
	};
	return (
		recordsMatch(result.portMutations, document.portEquipment.ports, portRecordEquals) &&
		recordsMatch(
			result.equipmentGroupMutations,
			document.portEquipment.equipmentGroups,
			equipmentGroupEquals,
		) &&
		recordsMatch(
			result.organizationMutations,
			document.organizations.records,
			staticFabOrganizationRecordEquals,
		) &&
		recordsMatch(
			result.relationshipMutations,
			document.relationships.records,
			staticFabAssemblyRelationshipRecordEquals,
		)
	);
}

/** Library refresh and metadata edits preserve the saved source; replacement content does not. */
export function guidedBuildTaskBlueprintMatches(
	a: OpenFabProjectBlueprint,
	b: OpenFabProjectBlueprint,
): boolean {
	if (a === b) return true;
	if (a.id !== b.id || a.kind !== b.kind || a.createdAt !== b.createdAt) return false;
	const content = (record: OpenFabProjectBlueprint) =>
		JSON.stringify([
			record.edges,
			"ports" in record ? record.ports : null,
			"equipmentGroups" in record ? record.equipmentGroups : null,
			"bundle" in record ? record.bundle : null,
		]);
	return content(a) === content(b);
}

export const GUIDED_BUILD_TASKS = [
	{ id: "fab", title: "FAB 만들기", description: "규모 정하기 → 생성 → 검사 보기" },
	{
		id: "equipment",
		title: "Port 방향 바꾸기",
		description: "장비 선택 → Port 서비스 방향 바꾸기",
	},
	{
		id: "eq-configuration",
		title: "EQ Port 구성 바꾸기",
		description: "같은 EQ의 Port 간격 → 몸체 크기 직접 적용",
	},
	{ id: "blueprint", title: "청사진 재사용", description: "선택을 청사진으로 저장 → 다시 배치" },
] as const;

export interface GuidedBuildTaskEvidence {
	readonly settled: boolean;
	readonly fabCreated: boolean;
	readonly fabInspected: boolean;
	readonly equipmentSelected: boolean;
	readonly equipmentEdited: boolean;
	readonly eqPitchEdited: boolean;
	readonly eqBodyEdited: boolean;
	readonly blueprintSaved: boolean;
	readonly blueprintPlaced: boolean;
}

/** A short projection of existing commands, not a second authoring or completion authority. */
export function evaluateGuidedBuildTask(
	task: GuidedBuildTaskId,
	evidence: GuidedBuildTaskEvidence,
) {
	const conditions =
		task === "fab"
			? [evidence.fabCreated, evidence.fabInspected]
			: task === "equipment"
				? [evidence.equipmentSelected, evidence.equipmentEdited]
				: task === "eq-configuration"
					? [evidence.eqPitchEdited, evidence.eqBodyEdited]
					: [evidence.blueprintSaved, evidence.blueprintPlaced];
	const firstMissing = conditions.findIndex((condition) => !condition);
	const complete = evidence.settled && firstMissing === -1;
	return {
		task,
		complete,
		step: complete ? 2 : firstMissing === -1 ? 2 : firstMissing + 1,
		count: 2,
	} as const;
}

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
		label: "레일 기초",
		title: "레일 기본기",
		missionIds: ["orient", "first-rail", "process-loop"],
	}),
	chapter({
		id: "equip",
		sequence: 2,
		label: "장비 배치",
		title: "Port-first 장비",
		missionIds: ["ports"],
	}),
	chapter({
		id: "reuse",
		sequence: 3,
		label: "Loop 재사용",
		title: "Loop 재사용",
		missionIds: ["reuse-loop"],
	}),
	chapter({
		id: "advanced-fab",
		sequence: 4,
		label: "FAB 완성",
		title: "FAB 구조·검증·저장",
		missionIds: [
			"bay",
			"bay-bank",
			"interbay",
			"fab-loop",
			"fab-equipment",
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

/** A chapter continuation may choose a tool; it never executes the next authored command. */
export function guidedBuildChapterEntryTool(
	checkpointId: GuidedBuildChapterId | null,
	missionId: GuidedBuildFoundationMissionId | null,
	action: GuidedBuildSuggestedAction | null,
): "ohb" | "eq" | "stk" | "inspect" | null {
	if (
		checkpointId === "quick-start" &&
		missionId === "ports" &&
		(action === "ohb" || action === "eq" || action === "stk")
	)
		return action;
	if (checkpointId === "equip" && missionId === "reuse-loop" && action === "inspect") {
		return "inspect";
	}
	return null;
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
