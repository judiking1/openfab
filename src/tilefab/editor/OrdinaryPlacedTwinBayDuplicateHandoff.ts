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
	ariaLabel: "다음 작업: 방금 배치한 Twin Bay와 내부 Process Loop 두 개를 함께 복제합니다",
	description:
		"Twin Bay와 내부 Process Loop 두 개를 함께 복제할 위치를 고릅니다. 위치를 확정하면 복제본이 추가됩니다.",
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
