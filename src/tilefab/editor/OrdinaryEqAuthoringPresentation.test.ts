import { describe, expect, it } from "vitest";
import {
	ORDINARY_EQ_ANCHOR_SELECTED_STATUS,
	ordinaryEqAuthoringInstruction,
	ordinaryEqKeyboardTargetLabel,
	ordinaryEqRowExitPresentation,
} from "./OrdinaryEqAuthoringPresentation";

describe("ordinaryEqAuthoringInstruction", () => {
	it("describes click endpoints and equivalent drag or keyboard input", () => {
		const instruction = ordinaryEqAuthoringInstruction("choose-slot", 1_234);
		expect(instruction).toContain("포트 후보 1,234곳");
		expect(instruction).toContain("청록색 슬롯의 1 시작 클릭 → 2 끝 클릭");
		expect(instruction).toContain("드래그 또는 방향키/WASD 후 Enter도 가능");
		expect(instruction).toContain("Esc 종료");
	});

	it("identifies the shared start and end targets", () => {
		expect(ordinaryEqKeyboardTargetLabel("choose-slot")).toBe("1 시작 · 클릭 / ENTER");
		expect(ordinaryEqKeyboardTargetLabel("choose-end")).toBe("2 끝 · 클릭 / ENTER");
		expect(ORDINARY_EQ_ANCHOR_SELECTED_STATUS).toContain("EQ 시작점 선택");
		expect(ORDINARY_EQ_ANCHOR_SELECTED_STATUS).toContain("끝 Port를 클릭");
	});

	it("names the end phase and its first Escape boundary", () => {
		const instruction = ordinaryEqAuthoringInstruction("choose-end", 8);
		expect(instruction).toContain("1 시작 고정");
		expect(instruction).toContain("2 끝 클릭 또는 방향키/WASD 후 Enter로 행 확정");
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
