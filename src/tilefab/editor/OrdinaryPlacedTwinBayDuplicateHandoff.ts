export interface OrdinaryPlacedTwinBayDuplicateHandoffContext {
	readonly organizationBundleActive: boolean;
	readonly committedPlacementCount: number;
	readonly rootOrganizationCount: number;
	readonly placedRootOrganizationId: number | null;
	readonly selectedOrganizationIds: readonly number[];
	readonly recognizedTwinBay: boolean;
	readonly duplicateReady: boolean;
	readonly redoAvailable: boolean;
	readonly guidedBuildActive: boolean;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryPlacedTwinBayDuplicateHandoffPresentation {
	readonly action: "duplicate-recognized-twin-bay";
	readonly label: "다음 · Twin Bay 전체 복제";
	readonly instruction: "방금 배치한 Twin Bay와 하위 Process Loop 2개만 복제";
	readonly ariaLabel: string;
	readonly description: string;
}

const PLACED_TWIN_BAY_DUPLICATE_HANDOFF = Object.freeze({
	action: "duplicate-recognized-twin-bay",
	label: "다음 · Twin Bay 전체 복제",
	instruction: "방금 배치한 Twin Bay와 하위 Process Loop 2개만 복제",
	ariaLabel:
		"다음 작업: 방금 배치하고 인증한 Twin Bay와 그 하위 Process Loop 두 개의 전체 계층을 복제합니다. 앞서 만든 일반 레일과 장비 연결 구조는 포함하지 않습니다",
	description:
		"현재 선택은 authored truth에서 Shell, Gateway, 두 Process Loop가 정확히 재인식된 Twin Bay 하나입니다. 이 행동은 기존 EFFECTIVE 조직 복제 경로를 시작하며 앞서 만든 일반 레일과 장비 연결 구조는 변경하거나 포함하지 않습니다.",
}) satisfies OrdinaryPlacedTwinBayDuplicateHandoffPresentation;

/**
 * Projects the one explicit exit from a committed certified Twin Bay repeat ghost.
 * The caller must supply exact core recognition; raw organization kind or name is never enough.
 */
export function ordinaryPlacedTwinBayDuplicateHandoff(
	context: OrdinaryPlacedTwinBayDuplicateHandoffContext,
): OrdinaryPlacedTwinBayDuplicateHandoffPresentation | null {
	if (
		!context.organizationBundleActive ||
		context.committedPlacementCount < 1 ||
		context.rootOrganizationCount !== 1 ||
		context.placedRootOrganizationId === null ||
		context.selectedOrganizationIds.length !== 1 ||
		context.selectedOrganizationIds[0] !== context.placedRootOrganizationId ||
		!context.recognizedTwinBay ||
		!context.duplicateReady ||
		context.redoAvailable ||
		context.guidedBuildActive ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return PLACED_TWIN_BAY_DUPLICATE_HANDOFF;
}
