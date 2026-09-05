import type { StaticFabBlueprintEquipmentGroupTemplate } from "../core/StaticFabBlueprint";

export interface OrdinaryConnectedCopyTwinBayHandoffContext {
	readonly selectionCopyActive: boolean;
	readonly sourceEquipmentGroups: readonly StaticFabBlueprintEquipmentGroupTemplate[] | null;
	readonly committedPlacementCount: number;
	readonly redoAvailable: boolean;
	readonly guidedBuildActive: boolean;
	readonly organizationCount: number;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryConnectedCopyTwinBayHandoffPresentation {
	readonly action: "start-certified-twin-bay";
	readonly label: "다음 · 새 Twin Bay 배치";
	readonly instruction: "별도 인증 Twin Bay를 새로 배치 · 복제 구조는 그대로 유지";
	readonly ariaLabel: string;
	readonly description: string;
}

const CONNECTED_COPY_TWIN_BAY_HANDOFF = Object.freeze({
	action: "start-certified-twin-bay",
	label: "다음 · 새 Twin Bay 배치",
	instruction: "별도 인증 Twin Bay를 새로 배치 · 복제 구조는 그대로 유지",
	ariaLabel:
		"다음 작업: 복제 반복 배치를 끝내고 별도로 인증된 새 Twin Bay 배치를 시작합니다. 이미 확정한 복제 구조는 그대로 유지되며 Bay로 자동 승격되지 않습니다",
	description:
		"현재 복제 구조는 레일과 장비의 연결 묶음일 뿐 Bay 조직이 아닙니다. 이 행동은 복제 반복 고스트만 끝내고, Shell과 두 Process Loop 및 Gateway를 포함하는 기존 인증 Twin Bay 생성 경로를 별도로 시작합니다.",
}) satisfies OrdinaryConnectedCopyTwinBayHandoffPresentation;

function ordinaryConnectedCopyIncludesTwinBayPrerequisites(
	sourceEquipmentGroups: readonly StaticFabBlueprintEquipmentGroupTemplate[],
): boolean {
	let hasOhb = false;
	let hasEq = false;
	let hasStk = false;
	for (const group of sourceEquipmentGroups) {
		if (group.kind === "OHB") hasOhb = true;
		else if (group.kind === "EQ") hasEq = true;
		else if (group.kind === "STK") hasStk = true;
		if (hasOhb && hasEq && hasStk) return true;
	}
	return false;
}

/**
 * Projects a post-copy continuation from current transient and authored evidence only.
 * It creates no tutorial progress and never classifies the copied structure as a Bay.
 */
export function ordinaryConnectedCopyTwinBayHandoff(
	context: OrdinaryConnectedCopyTwinBayHandoffContext,
): OrdinaryConnectedCopyTwinBayHandoffPresentation | null {
	if (
		!context.selectionCopyActive ||
		context.committedPlacementCount < 1 ||
		context.redoAvailable ||
		context.guidedBuildActive ||
		context.organizationCount !== 0 ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForMutation ||
		context.sourceEquipmentGroups === null
	) {
		return null;
	}
	return ordinaryConnectedCopyIncludesTwinBayPrerequisites(context.sourceEquipmentGroups)
		? CONNECTED_COPY_TWIN_BAY_HANDOFF
		: null;
}
