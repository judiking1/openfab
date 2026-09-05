import { describe, expect, it } from "vitest";
import {
	ORDINARY_STK_HANDOFF_ENTRY_STATUS,
	type OrdinaryEqToStkHandoffContext,
	ordinaryEqToStkHandoff,
} from "./OrdinaryEqToStkHandoff";

const READY_CONTEXT = Object.freeze({
	ordinaryEqInspectionActive: true,
	guidedBuildActive: false,
	eqGroupCount: 1,
	stkGroupCount: 0,
	legalStkSlotCount: 4,
	transientConstructionActive: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryEqToStkHandoffContext;

describe("ordinaryEqToStkHandoff", () => {
	it("offers one optional STK handoff while repeated EQ placement remains available", () => {
		expect(ordinaryEqToStkHandoff(READY_CONTEXT)).toEqual({
			label: "추천 · STK Port 그룹",
			instruction: "템플릿 요구 개수 확인 · 금색 ◇ 클릭 → STK 생성",
			ariaLabel:
				"추천 다음 작업: STK 배치 막대에서 현재 템플릿의 요구 개수를 확인하고 금색 CENTER 슬롯을 클릭한 뒤 STK 생성을 누릅니다. 같은 설정의 EQ도 계속 배치할 수 있습니다",
			description:
				"같은 설정으로 EQ를 더 배치하거나, 추천 다음 작업으로 STK 배치 막대에서 유지된 현재 템플릿과 요구 개수를 확인하고 금색 CENTER 슬롯을 클릭한 뒤 STK 생성을 누릅니다.",
		});
		expect(ORDINARY_STK_HANDOFF_ENTRY_STATUS).toContain("현재 템플릿 요구 개수 확인");
		expect(ORDINARY_STK_HANDOFF_ENTRY_STATUS).toContain("클릭으로 추가·제거");
		expect(ORDINARY_STK_HANDOFF_ENTRY_STATUS).toContain("STK 생성");
	});

	it("remains available after more EQ groups are authored", () => {
		expect(ordinaryEqToStkHandoff({ ...READY_CONTEXT, eqGroupCount: 3 })).not.toBeNull();
	});

	it.each([
		["outside ordinary EQ inspection", { ordinaryEqInspectionActive: false }],
		["inside Guided Build", { guidedBuildActive: true }],
		["before an EQ exists", { eqGroupCount: 0 }],
		["after an STK exists", { stkGroupCount: 1 }],
		["without a legal STK slot", { legalStkSlotCount: 0 }],
		["during another transient construction", { transientConstructionActive: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is not ready", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryEqToStkHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});
