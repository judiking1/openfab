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
	readonly label: "다음 · Stocker 배치";
	readonly instruction: "Port 선택 → STK 생성";
	readonly ariaLabel: "다음 장비: Stocker 배치";
	readonly description: string;
}

export const ORDINARY_STK_HANDOFF_ENTRY_STATUS =
	"Stocker 배치 · 현재 Port 구성의 요구 개수만큼 선택한 뒤 STK 생성";

const NEXT_STK_HANDOFF = Object.freeze({
	label: "다음 · Stocker 배치",
	instruction: "Port 선택 → STK 생성",
	ariaLabel: "다음 장비: Stocker 배치",
	description: "현재 Port 구성과 요구 개수를 확인하고 금색 ◇를 선택한 뒤 STK 생성을 누르세요.",
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
