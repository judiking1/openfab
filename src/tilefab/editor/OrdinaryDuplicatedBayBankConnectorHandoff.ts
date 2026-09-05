export interface OrdinaryDuplicatedBayBankConnectorHandoffContext {
	readonly organizationBundleActive: boolean;
	readonly bundleCaptureMode: "DIRECT" | "EFFECTIVE" | null;
	readonly committedPlacementCount: number;
	readonly rootOrganizationCount: number;
	readonly sourceRootOrganizationIds: readonly number[];
	readonly placedRootOrganizationId: number | null;
	readonly selectedOrganizationIds: readonly number[];
	readonly sourceRecognizedBayBank: boolean;
	readonly placedRecognizedBayBank: boolean;
	readonly selectedRecognizedBayBankPair: boolean;
	readonly hierarchyLinkConnectorReady: boolean;
	readonly redoAvailable: boolean;
	readonly guidedBuildActive: boolean;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryDuplicatedBayBankConnectorHandoffPresentation {
	readonly action: "connect-recognized-bay-bank-pair";
	readonly label: "다음 · 두 Bay Bank 연결";
	readonly instruction:
		| "원본과 복제본 사이 Interbay 연결 검토"
		| "선택한 두 Bank 사이 Interbay 연결 검토";
	readonly ariaLabel: string;
	readonly description: string;
}

const ACTIVE_DUPLICATED_BAY_BANK_CONNECTOR_HANDOFF = Object.freeze({
	action: "connect-recognized-bay-bank-pair",
	label: "다음 · 두 Bay Bank 연결",
	instruction: "원본과 복제본 사이 Interbay 연결 검토",
	ariaLabel:
		"다음 · 두 Bay Bank 연결. 원본 Bay Bank와 복제 Bay Bank의 반복 배치를 끝내고 CONNECT BANKS 연결 검토를 엽니다. Apply 전에는 프로젝트가 변경되지 않습니다",
	description:
		"현재 선택은 원본 Bay Bank와 방금 배치한 복제 Bay Bank입니다. 반복 배치를 끝내고 두 Bank의 연결 검토를 엽니다. Apply 전에는 Rail이나 조직이 변경되지 않습니다.",
}) satisfies OrdinaryDuplicatedBayBankConnectorHandoffPresentation;

const SELECTED_BAY_BANK_CONNECTOR_RECOVERY_HANDOFF = Object.freeze({
	action: "connect-recognized-bay-bank-pair",
	label: "다음 · 두 Bay Bank 연결",
	instruction: "선택한 두 Bank 사이 Interbay 연결 검토",
	ariaLabel:
		"다음 · 두 Bay Bank 연결. 선택한 Bay Bank 두 개의 CONNECT BANKS 연결 검토를 엽니다. Apply 전에는 프로젝트가 변경되지 않습니다",
	description:
		"현재 선택은 프로젝트에서 Bay Bank로 확인된 두 조직입니다. 두 Bank의 연결 검토를 엽니다. Apply 전에는 Rail이나 조직이 변경되지 않습니다.",
}) satisfies OrdinaryDuplicatedBayBankConnectorHandoffPresentation;

/**
 * Projects one exact committed EFFECTIVE Bank duplicate, or an exact selected Bank pair after the
 * repeat placement exits, into the existing Worker-certified BANK_TO_FAB Connector.
 */
export function ordinaryDuplicatedBayBankConnectorHandoff(
	context: OrdinaryDuplicatedBayBankConnectorHandoffContext,
): OrdinaryDuplicatedBayBankConnectorHandoffPresentation | null {
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
		context.sourceRecognizedBayBank &&
		context.placedRecognizedBayBank;
	const selectedPairRecovery =
		!context.organizationBundleActive &&
		context.bundleCaptureMode === null &&
		context.committedPlacementCount === 0 &&
		context.rootOrganizationCount === 0 &&
		context.sourceRootOrganizationIds.length === 0 &&
		context.placedRootOrganizationId === null &&
		selectedOrganizationIds.length === 2 &&
		context.selectedRecognizedBayBankPair;
	if (
		(!activeDuplicateReceipt && !selectedPairRecovery) ||
		!context.hierarchyLinkConnectorReady ||
		context.redoAvailable ||
		context.guidedBuildActive ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return activeDuplicateReceipt
		? ACTIVE_DUPLICATED_BAY_BANK_CONNECTOR_HANDOFF
		: SELECTED_BAY_BANK_CONNECTOR_RECOVERY_HANDOFF;
}
