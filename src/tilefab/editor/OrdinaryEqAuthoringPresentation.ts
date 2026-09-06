export type OrdinaryEqKeyboardPhase = "choose-slot" | "choose-end";

export const ORDINARY_EQ_ANCHOR_SELECTED_STATUS =
	"EQ 시작점 선택 · 같은 직선의 끝 Port를 클릭하거나 방향키 후 Enter · Esc 취소";

export function ordinaryEqKeyboardTargetLabel(phase: OrdinaryEqKeyboardPhase): string {
	return phase === "choose-end" ? "2 끝 · 클릭 / ENTER" : "1 시작 · 클릭 / ENTER";
}

/** The catalog count does not include current occupancy or a complete row's continuity proof. */
export function ordinaryEqAuthoringInstruction(
	phase: OrdinaryEqKeyboardPhase,
	legalSlotCount: number,
): string {
	if (phase === "choose-end") {
		return "1 시작 고정 · 2 끝 클릭 또는 방향키/WASD 후 Enter로 행 확정 · Esc로 행 선택 취소";
	}
	return `포트 후보 ${legalSlotCount.toLocaleString("ko-KR")}곳 · 청록색 슬롯의 1 시작 클릭 → 2 끝 클릭 · 드래그 또는 방향키/WASD 후 Enter도 가능 · Esc 종료`;
}

export interface OrdinaryEqExitPresentation {
	readonly label: "행 선택 취소";
	readonly ariaLabel: "EQ 행 선택을 취소하고 1번 시작 선택으로 돌아가기";
}

const EQ_ROW_CANCEL = Object.freeze({
	label: "행 선택 취소",
	ariaLabel: "EQ 행 선택을 취소하고 1번 시작 선택으로 돌아가기",
}) satisfies OrdinaryEqExitPresentation;

export function ordinaryEqRowExitPresentation(
	phase: OrdinaryEqKeyboardPhase | null,
): OrdinaryEqExitPresentation | null {
	return phase === "choose-end" ? EQ_ROW_CANCEL : null;
}
