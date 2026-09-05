import type { GuidedBuildFoundationMissionId } from "./GuidedBuildMission";

export const DEFAULT_RAIL_BUILD_STATUS = "첫 레일의 시작점을 선택하세요";
export const RAIL_ROUTE_DRAG_STATUS = "레일 시작점에서 끝점까지 드래그하세요";
export const GUIDED_FIRST_RAIL_TARGET_METERS = 15;

interface GuidedBuildStatusInput {
	readonly guidedBuildOpen: boolean;
	readonly currentMissionId: GuidedBuildFoundationMissionId | null;
	readonly suggestedActionLabel?: string | null;
	readonly status: string;
}

interface GuidedFirstRailPreviewInput {
	readonly guidedBuildOpen: boolean;
	readonly currentMissionId: GuidedBuildFoundationMissionId | null;
	readonly lengthMeters: number;
	readonly turns: number;
	readonly valid: boolean;
}

/**
 * Keeps the ordinary editor status untouched while making the Guided first gesture unambiguous.
 */
export function guidedBuildPresentedStatus(input: GuidedBuildStatusInput): string {
	if (
		input.guidedBuildOpen &&
		input.currentMissionId === "ports" &&
		input.suggestedActionLabel &&
		(input.status === DEFAULT_RAIL_BUILD_STATUS || input.status === RAIL_ROUTE_DRAG_STATUS)
	) {
		return `다음: ${input.suggestedActionLabel}`;
	}
	if (
		input.guidedBuildOpen &&
		input.currentMissionId === "first-rail" &&
		(input.status === DEFAULT_RAIL_BUILD_STATUS || input.status === RAIL_ROUTE_DRAG_STATUS)
	) {
		return `빈 곳을 누른 채 가로/세로 ${GUIDED_FIRST_RAIL_TARGET_METERS} m 이상 끌고 놓으세요`;
	}
	return input.status;
}

/**
 * Adds mission-owned progress to the existing pointer preview without changing construction plans.
 */
export function guidedFirstRailPreviewStatus(input: GuidedFirstRailPreviewInput): string | null {
	if (!input.guidedBuildOpen || input.currentMissionId !== "first-rail" || !input.valid) {
		return null;
	}
	if (input.turns > 0) {
		return `${input.lengthMeters} m · 한 축으로 곧게 끌어 첫 직선을 만드세요`;
	}
	const remainingMeters = Math.max(0, GUIDED_FIRST_RAIL_TARGET_METERS - input.lengthMeters);
	return remainingMeters > 0
		? `${input.lengthMeters} m · ${remainingMeters} m 더 끌어 첫 직선을 만드세요`
		: `${input.lengthMeters} m · 목표 충족 · 놓아서 건설`;
}
