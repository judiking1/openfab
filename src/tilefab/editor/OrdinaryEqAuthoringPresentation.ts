export type OrdinaryEqKeyboardPhase = "choose-slot" | "choose-end";

export const ORDINARY_EQ_SINGLE_CLICK_RECOVERY_STATUS =
	"EQ 행은 클릭만으로 배치되지 않습니다 · 청록색 CENTER에서 같은 직선의 다른 슬롯까지 놓지 않고 드래그하세요";

export function ordinaryEqKeyboardTargetLabel(phase: OrdinaryEqKeyboardPhase): string {
	return phase === "choose-end" ? "키보드 2 끝 · ENTER" : "키보드 1 시작 · ENTER";
}

/** The catalog count does not include current occupancy or a complete row's continuity proof. */
export function ordinaryEqAuthoringInstruction(
	phase: OrdinaryEqKeyboardPhase,
	legalSlotCount: number,
): string {
	if (phase === "choose-end") {
		return "1 시작 고정 · 키보드: 방향키/WASD로 2 끝 이동 → Enter로 행 확정 · Esc로 행 선택 취소";
	}
	return `포트 후보 ${legalSlotCount.toLocaleString("ko-KR")}곳 · 포인터: 청록색 CENTER에서 같은 직선의 다른 슬롯까지 놓지 않고 드래그 · 키보드: 흰 테두리 1 시작을 방향키/WASD로 이동 → Enter · Esc 종료`;
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
