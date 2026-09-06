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
			label: "다음 · Stocker 배치",
			instruction: "Port 선택 → STK 생성",
			ariaLabel: "다음 장비: Stocker 배치",
			description: "현재 Port 구성과 요구 개수를 확인하고 금색 ◇를 선택한 뒤 STK 생성을 누르세요.",
		});
		expect(ORDINARY_STK_HANDOFF_ENTRY_STATUS).toContain("현재 Port 구성의 요구 개수");
		expect(ORDINARY_STK_HANDOFF_ENTRY_STATUS).toContain("선택한 뒤 STK 생성");
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
