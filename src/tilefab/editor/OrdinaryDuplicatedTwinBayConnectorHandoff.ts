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
		"다음 · 두 Twin Bay 연결. 반복 배치를 마치고 원본과 복제본의 연결 경로를 검토합니다. 적용하면 두 Bay가 Bay Bank로 묶입니다",
	description:
		"원본과 복제한 Twin Bay의 연결 경로를 검토합니다. 출발·도착 연결점을 고른 뒤 적용하면 두 Bay가 하나의 Bay Bank로 묶입니다.",
}) satisfies OrdinaryDuplicatedTwinBayConnectorHandoffPresentation;

const SELECTED_TWIN_BAY_CONNECTOR_RECOVERY_HANDOFF = Object.freeze({
	action: "connect-recognized-twin-bay-pair",
	label: "다음 · 두 Twin Bay 연결",
	instruction: "선택한 두 Bay를 Bay Bank로 묶기",
	ariaLabel:
		"다음 · 두 Twin Bay 연결. 선택한 두 Bay의 연결 경로를 검토합니다. 적용하면 두 Bay가 Bay Bank로 묶입니다",
	description:
		"선택한 두 Twin Bay의 연결 경로를 검토합니다. 출발·도착 연결점을 고른 뒤 적용하면 두 Bay가 하나의 Bay Bank로 묶입니다.",
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
