export interface OrdinaryDuplicatedTwinBayConnectorHandoffContext {
	readonly organizationBundleActive: boolean;
	readonly bundleCaptureMode: "DIRECT" | "EFFECTIVE" | null;
	readonly committedPlacementCount: number;
	readonly rootOrganizationCount: number;
	readonly sourceRootOrganizationIds: readonly number[];
	readonly placedRootOrganizationId: number | null;
	readonly selectedOrganizationIds: readonly number[];
	readonly sourceRecognizedTwinBay: boolean;
	readonly placedRecognizedTwinBay: boolean;
	readonly selectedRecognizedTwinBayPair: boolean;
	readonly connectorReady: boolean;
	readonly redoAvailable: boolean;
	readonly guidedBuildActive: boolean;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryDuplicatedTwinBayConnectorHandoffPresentation {
	readonly action: "connect-recognized-twin-bay-pair";
	readonly label: "다음 · 두 Twin Bay 연결";
	readonly instruction: "원본과 복제본을 Bay Bank로 묶기" | "선택한 두 Bay를 Bay Bank로 묶기";
	readonly ariaLabel: string;
	readonly description: string;
}

const ACTIVE_DUPLICATED_TWIN_BAY_CONNECTOR_HANDOFF = Object.freeze({
	action: "connect-recognized-twin-bay-pair",
	label: "다음 · 두 Twin Bay 연결",
	instruction: "원본과 복제본을 Bay Bank로 묶기",
	ariaLabel:
		"다음 · 두 Twin Bay 연결. 정확히 인식된 원본 Twin Bay와 복제 Twin Bay의 반복 배치를 끝내고 CONNECT BAYS 검토를 엽니다. 연결은 Apply 전까지 프로젝트를 변경하지 않습니다",
	description:
		"현재 선택은 authored truth에서 각각 독립적인 Twin Bay로 재인식된 원본과 복제본 두 개입니다. 이 행동은 반복 복제 고스트를 닫고 기존 Worker 인증 CONNECT BAYS 검토를 열며 Apply 전에는 레일이나 조직을 변경하지 않습니다.",
}) satisfies OrdinaryDuplicatedTwinBayConnectorHandoffPresentation;

const SELECTED_TWIN_BAY_CONNECTOR_RECOVERY_HANDOFF = Object.freeze({
	action: "connect-recognized-twin-bay-pair",
	label: "다음 · 두 Twin Bay 연결",
	instruction: "선택한 두 Bay를 Bay Bank로 묶기",
	ariaLabel:
		"다음 · 두 Twin Bay 연결. 정확히 선택된 Twin Bay 두 개의 CONNECT BAYS 검토를 엽니다. 연결은 Apply 전까지 프로젝트를 변경하지 않습니다",
	description:
		"현재 선택은 authored truth에서 각각 독립적인 Twin Bay로 재인식된 두 개의 Bay입니다. 이 행동은 기존 Worker 인증 CONNECT BAYS 검토를 열며 Apply 전에는 레일이나 조직을 변경하지 않습니다.",
}) satisfies OrdinaryDuplicatedTwinBayConnectorHandoffPresentation;

/**
 * Projects the explicit exit from one committed EFFECTIVE duplicate into the existing Connector.
 * Runtime source identities stay in the transient placement session and never enter the bundle.
 */
export function ordinaryDuplicatedTwinBayConnectorHandoff(
	context: OrdinaryDuplicatedTwinBayConnectorHandoffContext,
): OrdinaryDuplicatedTwinBayConnectorHandoffPresentation | null {
	const sourceRootOrganizationId = context.sourceRootOrganizationIds[0] ?? null;
	const selectedOrganizationIds = [...context.selectedOrganizationIds].sort(
		(left, right) => left - right,
	);
	const expectedOrganizationIds =
		sourceRootOrganizationId === null || context.placedRootOrganizationId === null
			? []
			: [sourceRootOrganizationId, context.placedRootOrganizationId].sort(
					(left, right) => left - right,
				);
	const activeDuplicateReceipt =
		context.organizationBundleActive &&
		context.bundleCaptureMode === "EFFECTIVE" &&
		context.committedPlacementCount >= 1 &&
		context.rootOrganizationCount === 1 &&
		context.sourceRootOrganizationIds.length === 1 &&
		sourceRootOrganizationId !== context.placedRootOrganizationId &&
		expectedOrganizationIds.length === 2 &&
		selectedOrganizationIds.length === 2 &&
		selectedOrganizationIds.every((id, index) => id === expectedOrganizationIds[index]) &&
		context.sourceRecognizedTwinBay &&
		context.placedRecognizedTwinBay;
	const selectedPairRecovery =
		!context.organizationBundleActive &&
		context.bundleCaptureMode === null &&
		context.committedPlacementCount === 0 &&
		context.rootOrganizationCount === 0 &&
		context.sourceRootOrganizationIds.length === 0 &&
		context.placedRootOrganizationId === null &&
		selectedOrganizationIds.length === 2 &&
		context.selectedRecognizedTwinBayPair;
	if (
		(!activeDuplicateReceipt && !selectedPairRecovery) ||
		!context.connectorReady ||
		context.redoAvailable ||
		context.guidedBuildActive ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return activeDuplicateReceipt
		? ACTIVE_DUPLICATED_TWIN_BAY_CONNECTOR_HANDOFF
		: SELECTED_TWIN_BAY_CONNECTOR_RECOVERY_HANDOFF;
}
