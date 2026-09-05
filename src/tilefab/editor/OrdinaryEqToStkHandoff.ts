export interface OrdinaryEqToStkHandoffContext {
	readonly ordinaryEqInspectionActive: boolean;
	readonly guidedBuildActive: boolean;
	readonly eqGroupCount: number;
	readonly stkGroupCount: number;
	readonly legalStkSlotCount: number;
	readonly transientConstructionActive: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryEqToStkHandoffPresentation {
	readonly label: "추천 · STK Port 그룹";
	readonly instruction: "템플릿 요구 개수 확인 · 금색 ◇ 클릭 → STK 생성";
	readonly ariaLabel: "추천 다음 작업: STK 배치 막대에서 현재 템플릿의 요구 개수를 확인하고 금색 CENTER 슬롯을 클릭한 뒤 STK 생성을 누릅니다. 같은 설정의 EQ도 계속 배치할 수 있습니다";
	readonly description: string;
}

export const ORDINARY_STK_HANDOFF_ENTRY_STATUS =
	"STK Port 그룹 · 현재 템플릿 요구 개수 확인 · 포인터는 금색 ◇ CENTER 클릭으로 추가·제거 · 준비되면 STK 생성 · 키보드는 방향키/WASD 후 Enter";

const NEXT_STK_HANDOFF = Object.freeze({
	label: "추천 · STK Port 그룹",
	instruction: "템플릿 요구 개수 확인 · 금색 ◇ 클릭 → STK 생성",
	ariaLabel:
		"추천 다음 작업: STK 배치 막대에서 현재 템플릿의 요구 개수를 확인하고 금색 CENTER 슬롯을 클릭한 뒤 STK 생성을 누릅니다. 같은 설정의 EQ도 계속 배치할 수 있습니다",
	description:
		"같은 설정으로 EQ를 더 배치하거나, 추천 다음 작업으로 STK 배치 막대에서 유지된 현재 템플릿과 요구 개수를 확인하고 금색 CENTER 슬롯을 클릭한 뒤 STK 생성을 누릅니다.",
}) satisfies OrdinaryEqToStkHandoffPresentation;

/**
 * Projects the optional EQ Inspector-to-STK handoff from canonical equipment evidence.
 * It owns neither workflow progress nor authored project state.
 */
export function ordinaryEqToStkHandoff(
	context: OrdinaryEqToStkHandoffContext,
): OrdinaryEqToStkHandoffPresentation | null {
	if (
		!context.ordinaryEqInspectionActive ||
		context.guidedBuildActive ||
		context.eqGroupCount < 1 ||
		context.stkGroupCount !== 0 ||
		context.legalStkSlotCount <= 0 ||
		context.transientConstructionActive ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return NEXT_STK_HANDOFF;
}
