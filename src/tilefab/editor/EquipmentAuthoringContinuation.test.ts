import { describe, expect, it } from "vitest";
import {
	equipmentAuthoringContinuation,
	equipmentAuthoringContinuationExplanation,
	equipmentAuthoringContinuationStatus,
} from "./EquipmentAuthoringContinuation";

describe("EquipmentAuthoringContinuation", () => {
	it("preserves EQ authoring settings for a repeated group", () => {
		const continuation = equipmentAuthoringContinuation({
			id: 7,
			kind: "EQ",
			portIds: [1, 2],
			pitchMillimeters: 3_000,
			recipe: "PHOTO",
		});

		expect(continuation).toEqual({
			tool: "eq",
			groupLabel: "EQ-7",
			buttonLabel: "같은 설정으로 새 EQ 배치",
			pitchMillimeters: 3_000,
			recipe: "PHOTO",
		});
		expect(equipmentAuthoringContinuationStatus(continuation)).toBe(
			"새 EQ 배치 · PITCH 3 m · RECIPE PHOTO",
		);
		expect(equipmentAuthoringContinuationExplanation(continuation)).toContain("Port를 다시 선택");
	});

	it("preserves a reusable STK template", () => {
		const continuation = equipmentAuthoringContinuation({
			id: 8,
			kind: "STK",
			portIds: [3, 4, 5, 6],
			template: "FOUR_PORT",
		});

		expect(continuation).toMatchObject({
			tool: "stk",
			groupLabel: "STK-8",
			buttonLabel: "같은 템플릿으로 새 STK 배치",
			template: "FOUR_PORT",
			customTemplateFallback: false,
		});
		expect(equipmentAuthoringContinuationStatus(continuation)).toBe("새 STK 배치 · FOUR_PORT");
		expect(equipmentAuthoringContinuationExplanation(continuation)).toContain("정확한 복제");
	});

	it("falls back explicitly when a legacy CUSTOM STK cannot be recreated", () => {
		const continuation = equipmentAuthoringContinuation({
			id: 9,
			kind: "STK",
			portIds: [7],
			template: "CUSTOM",
		});

		expect(continuation).toMatchObject({
			tool: "stk",
			template: "FLEX",
			buttonLabel: "FLEX로 새 STK 배치",
			customTemplateFallback: true,
		});
		expect(equipmentAuthoringContinuationStatus(continuation)).toContain(
			"CUSTOM은 직접 재현할 수 없어 FLEX",
		);
	});

	it("uses a direct OHB continuation without hidden settings", () => {
		const continuation = equipmentAuthoringContinuation({
			id: 10,
			kind: "OHB",
			portIds: [8],
			template: "SINGLE",
		});

		expect(continuation).toEqual({
			tool: "ohb",
			groupLabel: "OHB-10",
			buttonLabel: "새 OHB Port 배치",
		});
		expect(equipmentAuthoringContinuationExplanation(continuation)).toContain("새 합법 슬롯");
	});
});
