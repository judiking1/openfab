import { describe, expect, it } from "vitest";
import { portAuthoringSurfacePresentation } from "./PortAuthoringSurfacePresentation";

describe("portAuthoringSurfacePresentation", () => {
	it("names the ordinary OHB target and both placement gestures", () => {
		const presentation = portAuthoringSurfacePresentation("OHB", 12, 12);
		expect(presentation).toEqual({
			toolCaption: "OHB Port",
			toolDescription: "레일 옆 원 · 클릭 또는 드래그",
			buildbarTitle: "OHB PORT",
			instruction:
				"포트 후보 12곳 · 클릭 또는 Enter: 1개 · 방향키/WASD: 대상 이동 · 같은 레일 드래그: 행 배치",
			configurationAvailable: true,
			prerequisiteAction: null,
		});
	});

	it("distinguishes EQ and STK target vocabulary", () => {
		expect(portAuthoringSurfacePresentation("EQ", 2, 2).instruction).toBe(
			"포트 후보 2곳 · 같은 직선 레일을 따라 2개 이상 드래그",
		);
		expect(portAuthoringSurfacePresentation("STK", 3, 3).instruction).toBe(
			"금색 ◇ CENTER 3개 · STK에 연결할 Port 슬롯을 선택한 뒤 STK 생성",
		);
	});

	it("explains the prerequisite when no legal slot exists", () => {
		expect(portAuthoringSurfacePresentation("OHB", 4, 0).instruction).toContain(
			"양끝 터미널 안전 구간",
		);
		expect(portAuthoringSurfacePresentation("OHB", 4, 0).instruction).toContain(
			"레일을 더 늘리세요",
		);
		expect(portAuthoringSurfacePresentation("OHB", 4, 0).instruction).not.toContain("3 m 이상");
		expect(portAuthoringSurfacePresentation("OHB", 0, 0).instruction).toContain(
			"먼저 직선 레일을 만드세요",
		);
		expect(portAuthoringSurfacePresentation("EQ", 0, 0).instruction).toContain("연속된 직선 레일");
		expect(portAuthoringSurfacePresentation("STK", 0, 0).instruction).toContain(
			"STK가 연결될 직선 레일",
		);
		for (const portType of ["OHB", "EQ", "STK"] as const) {
			expect(portAuthoringSurfacePresentation(portType, 0, 0).configurationAvailable).toBe(false);
			expect(portAuthoringSurfacePresentation(portType, 0, 0).prerequisiteAction).toEqual({
				label: "먼저 레일 만들기",
				ariaLabel: "BUILD로 이동해 직선 레일 만들기",
			});
			expect(portAuthoringSurfacePresentation(portType, 1, 1).prerequisiteAction).toBeNull();
			expect(portAuthoringSurfacePresentation(portType, 1, 1).configurationAvailable).toBe(true);
		}
	});

	it("rejects an invalid count", () => {
		expect(() => portAuthoringSurfacePresentation("OHB", -1, 0)).toThrow(RangeError);
		expect(() => portAuthoringSurfacePresentation("OHB", 1, 1.5)).toThrow(RangeError);
		expect(() => portAuthoringSurfacePresentation("OHB", 1, 2)).toThrow(RangeError);
	});
});
