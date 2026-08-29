import { describe, expect, it } from "vitest";
import type { StkDraftSelection } from "../compile/StkDraftSelector";
import {
	portEquipmentReasonLabel,
	stkDraftReasonLabel,
	stkDraftStatusPresentation,
} from "./StkDraftPresentation";

describe("StkDraftPresentation", () => {
	it("keeps a rejected click visible even when the retained draft was complete", () => {
		const presentation = stkDraftStatusPresentation(
			selection({
				canComplete: true,
				rejectedRow: 18,
				reason: "이미 STK 포트 #7이 이 슬롯을 사용하고 있습니다",
			}),
		);

		expect(presentation).toEqual({
			label: "3 PORT · READY · 추가 실패: 이미 STK 포트 #7이 이 슬롯을 사용하고 있습니다",
			reason:
				"선택한 위치는 추가하지 않았습니다. 기존 3개 포트 드래프트는 COMPLETE할 수 있습니다. 이미 STK 포트 #7이 이 슬롯을 사용하고 있습니다",
			state: "blocked",
		});
	});

	it("shows the exact reason for incomplete and ready FLEX drafts", () => {
		expect(
			stkDraftStatusPresentation(
				selection({ canComplete: false, reason: "두 번째 레일 행을 선택하세요" }),
			),
		).toMatchObject({ label: "3 PORT · 두 번째 레일 행을 선택하세요", state: "draft" });
		expect(
			stkDraftStatusPresentation(selection({ canComplete: true, laneCount: 3 })),
		).toMatchObject({
			label: "3 PORT · 3 RAIL RUNS · READY",
			state: "ready",
		});
		expect(stkDraftReasonLabel("Preset STK ports must occupy consecutive 1 m rail cells")).toBe(
			"프리셋 포트는 1 m 간격으로 연속되어야 합니다",
		);
		expect(portEquipmentReasonLabel("이미 STK 포트 #7이 이 슬롯을 사용하고 있습니다")).toBe(
			"이미 STK 포트 #7이 이 슬롯을 사용하고 있습니다",
		);
		expect(portEquipmentReasonLabel("PORT-3 conflicts with PORT-9.")).toBe(
			"PORT-9이 대상 슬롯을 이미 사용하고 있습니다",
		);
		expect(portEquipmentReasonLabel("STK body span overlaps equipment group 4.")).toBe(
			"STK 본체 영역이 장비 그룹 4와 겹칩니다",
		);
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
