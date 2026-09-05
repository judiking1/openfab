export interface OrdinaryCompletedModuleHandoffContext {
	readonly ordinaryStkInspectionActive: boolean;
	readonly guidedBuildActive: boolean;
	readonly ohbGroupCount: number;
	readonly eqGroupCount: number;
	readonly stkGroupCount: number;
	readonly organizationCount: number;
	readonly transientConstructionActive: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryCompletedModuleHandoffPresentation {
	readonly action: "select-connected";
	readonly label: "다음 · 연결 구조 전체";
	readonly instruction: "현재 STK와 연결된 레일·장비를 선택";
	readonly ariaLabel: string;
	readonly description: string;
}

const COMPLETED_MODULE_HANDOFF = Object.freeze({
	action: "select-connected",
	label: "다음 · 연결 구조 전체",
	instruction: "현재 STK와 연결된 레일·장비를 선택",
	ariaLabel:
		"다음 작업: 현재 STK가 닿은 연결 구조 전체를 선택합니다. 다음 화면에서 실제 선택된 레일과 장비 수를 확인하고 복제를 선택할 수 있습니다",
	description:
		"현재 STK에서 시작해 약하게 연결된 레일 컴포넌트와 그 레일을 사용하는 완전한 장비 그룹 전체를 선택합니다. 하나의 큰 연결 FAB에서는 선택 범위가 넓을 수 있으므로 다음 화면의 레일과 장비 수를 확인하세요. 이 단계는 선택만 바꾸며 FAB 데이터는 수정하지 않습니다.",
}) satisfies OrdinaryCompletedModuleHandoffPresentation;

/**
 * Projects a first-task continuation from cheap authored/session evidence.
 * It owns no workflow progress, organization mutation, or persisted tutorial state.
 */
export function ordinaryCompletedModuleHandoff(
	context: OrdinaryCompletedModuleHandoffContext,
): OrdinaryCompletedModuleHandoffPresentation | null {
	if (
		!context.ordinaryStkInspectionActive ||
		context.guidedBuildActive ||
		context.ohbGroupCount < 1 ||
		context.eqGroupCount < 1 ||
		context.stkGroupCount < 1 ||
		context.organizationCount !== 0 ||
		context.transientConstructionActive ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return COMPLETED_MODULE_HANDOFF;
}
