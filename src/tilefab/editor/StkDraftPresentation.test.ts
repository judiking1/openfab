import { describe, expect, it } from "vitest";
import type { StkDraftSelection } from "../compile/StkDraftSelector";
import {
	portEquipmentReasonLabel,
	stkDraftAuthoringInstruction,
	stkDraftKeyboardTargetLabel,
	stkDraftReasonLabel,
	stkDraftReviewPresentation,
	stkDraftStatusPresentation,
	stkOverviewCoachPresentation,
	stkTemplatePresentation,
} from "./StkDraftPresentation";

describe("StkDraftPresentation", () => {
	it("keeps a rejected click visible even when the retained draft was complete", () => {
		const presentation = stkDraftStatusPresentation(
			selection({
				canComplete: true,
				rejectedRow: 18,
				reason: "이미 Port #7이 이 슬롯을 사용하고 있습니다",
			}),
		);

		expect(presentation).toEqual({
			label:
				"3 PORT 선택 · Shift+Enter / STK 생성 · 추가 실패: 이미 Port #7이 이 슬롯을 사용하고 있습니다",
			reason:
				"선택한 위치는 추가하지 않았습니다. 기존 3개 포트 드래프트로 STK를 생성할 수 있습니다. 이미 Port #7이 이 슬롯을 사용하고 있습니다",
			state: "blocked",
		});
	});

	it("shows the exact reason for incomplete and ready FLEX drafts", () => {
		expect(
			stkDraftStatusPresentation(
				selection({ canComplete: false, reason: "두 번째 레일 행을 선택하세요" }),
			),
		).toMatchObject({ label: "3 PORT 선택 · 두 번째 레일 행을 선택하세요", state: "draft" });
		expect(
			stkDraftStatusPresentation(selection({ canComplete: true, laneCount: 3 })),
		).toMatchObject({
			label: "3 PORT 선택 · 3 RAIL RUNS · Shift+Enter / STK 생성",
			state: "ready",
		});
		expect(stkDraftReasonLabel("Preset STK ports must occupy consecutive 1 m rail cells")).toBe(
			"프리셋 포트는 1 m 간격으로 연속되어야 합니다",
		);
		expect(portEquipmentReasonLabel("이미 Port #7이 이 슬롯을 사용하고 있습니다")).toBe(
			"이미 Port #7이 이 슬롯을 사용하고 있습니다",
		);
		expect(portEquipmentReasonLabel("PORT-3 conflicts with PORT-9.")).toBe(
			"PORT-9이 대상 슬롯을 이미 사용하고 있습니다",
		);
		expect(portEquipmentReasonLabel("STK body span overlaps equipment group 4.")).toBe(
			"STK 본체 영역이 장비 그룹 4와 겹칩니다",
		);
	});

	it("keeps the selected template grammar visible before and after a choice", () => {
		expect(stkTemplatePresentation("FLEX")).toEqual({
			label: "FLEX",
			requirement: "원하는 CENTER Port 1개 이상",
		});
		expect(stkTemplatePresentation("BACK_TO_BACK")).toEqual({
			label: "B2B",
			requirement: "반대 방향 평행 레일의 정렬된 짝 · 짝수 4개 이상",
		});
		expect(stkDraftAuthoringInstruction("FOUR_PORT", null, 20)).toBe(
			"4 PORT · 같은 직선 레일의 연속 4개 · 포인터: 금색 ◇ CENTER 클릭으로 첫 Port 선택 · 키보드: 방향키/WASD 이동 → Enter · Esc STK 배치 종료",
		);
		expect(
			stkDraftAuthoringInstruction("FLEX", selection({ rows: [1], canComplete: true }), 20),
		).toContain(
			"1 PORT 선택 · 1 RAIL RUN · Shift+Enter / STK 생성 · FLEX 조건: 원하는 CENTER Port 1개 이상",
		);
		expect(
			stkDraftAuthoringInstruction("FLEX", selection({ rows: [1], canComplete: true }), 20),
		).toContain("포인터: 금색 ◇ CENTER 클릭으로 추가·제거");
		expect(
			stkDraftAuthoringInstruction("FLEX", selection({ rows: [1], canComplete: true }), 20),
		).toContain("키보드: 방향키/WASD 이동 → Enter · 준비되면 STK 생성");
		expect(
			stkDraftAuthoringInstruction("FLEX", selection({ rows: [1], canComplete: true }), 20),
		).toContain("Esc 선택 초기화 · 다시 Esc STK 배치 종료");
		expect(stkDraftAuthoringInstruction("SIX_PORT", null, 0)).toContain("직선 레일을 먼저");
		expect(() => stkDraftAuthoringInstruction("FLEX", null, -1)).toThrow(RangeError);
	});

	it("reviews the same draft against the Guide minimum and preserves rejected-choice feedback", () => {
		const one = selection({ rows: [1], canComplete: true });
		expect(stkDraftReviewPresentation(one, "FLEX").ready).toBe(true);
		expect(stkDraftReviewPresentation(one, "FLEX", 2)).toMatchObject({
			ready: false,
			title: "Stocker · 1개 Port 선택",
			instruction: expect.stringContaining("Port 2개"),
		});
		const rejected = selection({
			rows: [1, 2],
			canComplete: true,
			rejectedRow: 7,
			reason: "기존 장비 구간과 겹칩니다",
		});
		expect(stkDraftReviewPresentation(rejected, "FLEX", 2)).toMatchObject({
			ready: true,
			issue: "기존 장비 구간과 겹칩니다",
		});
		expect(stkDraftReviewPresentation(null, "FOUR_PORT").instruction).toContain("연속 4개");
	});

	it("names the actual Enter toggle at the current keyboard row", () => {
		expect(stkDraftKeyboardTargetLabel(null, false)).toBe("첫 Port 위치");
		expect(stkDraftKeyboardTargetLabel(selection({ rows: [7] }), true)).toBe("선택됨 · ENTER 해제");
		expect(stkDraftKeyboardTargetLabel(selection({ rows: [7] }), false)).toBe("Port 추가 · ENTER");
		expect(stkDraftKeyboardTargetLabel(selection({ rows: [7] }), false, false)).toBe(
			"추가 불가 · 이동",
		);
		expect(stkDraftKeyboardTargetLabel(selection({ rows: [7] }), true, false)).toBe(
			"선택됨 · ENTER 해제",
		);
	});

	it("explains the empty overview without assuming one input modality", () => {
		expect(stkOverviewCoachPresentation(0, "FOUR_PORT")).toEqual({
			instruction:
				"4 PORT · 연속 4개 · 포인터: 금색 원 클릭 · 키보드: 현재 대상에서 Enter · 또는 위치 확대",
			zoomActionLabel: "첫 Port 확대",
		});
		expect(stkOverviewCoachPresentation(1, "FLEX")).toEqual({
			instruction:
				"FLEX · 1개 이상 · 포인터: 금색 원 클릭으로 추가·제거 · 키보드: Enter · 준비되면 STK 생성",
			zoomActionLabel: "현재 Port 확대",
		});
		expect(stkOverviewCoachPresentation(0, "SIX_PORT").instruction).toContain("6 PORT · 연속 6개");
		expect(stkOverviewCoachPresentation(0, "BACK_TO_BACK").instruction).toContain(
			"B2B · 정렬된 짝수 4개 이상",
		);
		expect(() => stkOverviewCoachPresentation(-1, "FLEX")).toThrow(RangeError);
	});
});

function selection(overrides: Partial<StkDraftSelection> = {}): StkDraftSelection {
	return {
		valid: true,
		canComplete: false,
		reason: "FLEX · 3 PORT",
		template: "FLEX",
		rows: [1, 2, 3],
		orderedRows: [1, 2, 3],
		laneRows: [[1, 2, 3]],
		rejectedRow: null,
		laneCount: 1,
		...overrides,
	};
}
