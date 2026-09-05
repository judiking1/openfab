import { describe, expect, it } from "vitest";
import {
	ORDINARY_EQ_SINGLE_CLICK_RECOVERY_STATUS,
	ordinaryEqAuthoringInstruction,
	ordinaryEqKeyboardTargetLabel,
	ordinaryEqRowExitPresentation,
} from "./OrdinaryEqAuthoringPresentation";

describe("ordinaryEqAuthoringInstruction", () => {
	it("separates the keyboard start action from the pointer drag contract", () => {
		const instruction = ordinaryEqAuthoringInstruction("choose-slot", 1_234);
		expect(instruction).toContain("배치 가능 1,234곳");
		expect(instruction).toContain(
			"포인터: 청록색 CENTER에서 같은 직선의 다른 슬롯까지 놓지 않고 드래그",
		);
		expect(instruction).toContain("키보드: 흰 테두리 1 시작을 방향키/WASD로 이동 → Enter");
		expect(instruction).toContain("Esc 종료");
		expect(instruction).not.toContain("클릭/Enter");
	});

	it("keeps pointer recovery and keyboard marker identity explicit", () => {
		expect(ordinaryEqKeyboardTargetLabel("choose-slot")).toBe("키보드 1 시작 · ENTER");
		expect(ordinaryEqKeyboardTargetLabel("choose-end")).toBe("키보드 2 끝 · ENTER");
		expect(ORDINARY_EQ_SINGLE_CLICK_RECOVERY_STATUS).toContain("클릭만으로");
		expect(ORDINARY_EQ_SINGLE_CLICK_RECOVERY_STATUS).toContain("놓지 않고 드래그");
	});

	it("names the end phase and its first Escape boundary", () => {
		const instruction = ordinaryEqAuthoringInstruction("choose-end", 8);
		expect(instruction).toContain("1 시작 고정");
		expect(instruction).toContain("방향키/WASD로 2 끝 이동 → Enter로 행 확정");
		expect(instruction).toContain("Esc로 행 선택 취소");
		expect(instruction).not.toContain("Port 배치 종료");
	});
});

describe("ordinaryEqRowExitPresentation", () => {
	it("turns the visible exit into the same row reset as Escape only in choose-end", () => {
		expect(ordinaryEqRowExitPresentation("choose-end")).toEqual({
			label: "행 선택 취소",
			ariaLabel: "EQ 행 선택을 취소하고 1번 시작 선택으로 돌아가기",
		});
		expect(ordinaryEqRowExitPresentation("choose-slot")).toBeNull();
		expect(ordinaryEqRowExitPresentation(null)).toBeNull();
	});
});
