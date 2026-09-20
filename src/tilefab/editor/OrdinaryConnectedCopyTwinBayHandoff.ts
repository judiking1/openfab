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
		"다음 작업: 반복 배치를 마치고 내부 Process Loop 두 개를 가진 새 Twin Bay를 배치합니다",
	description:
		"지금 복제한 레일·장비 묶음에는 Bay 구조가 없습니다. 내부 Process Loop 두 개와 연결점을 가진 새 Twin Bay를 배치해 FAB 조립을 시작하세요.",
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
