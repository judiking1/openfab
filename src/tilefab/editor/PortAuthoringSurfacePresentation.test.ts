import { describe, expect, it } from "vitest";
import { portAuthoringSurfacePresentation } from "./PortAuthoringSurfacePresentation";

describe("portAuthoringSurfacePresentation", () => {
	it("names the ordinary OHB target and both placement gestures", () => {
		const presentation = portAuthoringSurfacePresentation("OHB", 12, 12, true);
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

	it("offers deliberate keyboard entry when no current OHB target exists", () => {
		const { instruction } = portAuthoringSurfacePresentation("OHB", 12, 12);
		expect(instruction).toContain("레일 옆 원 클릭");
		expect(instruction).toContain("배치 시작 버튼");
		expect(instruction).not.toContain("Enter");
		expect(instruction).not.toContain("WASD");
	});

	it("distinguishes EQ and STK target vocabulary", () => {
		expect(portAuthoringSurfacePresentation("EQ", 2, 2, false, true).instruction).toBe(
			"포트 후보 2곳 · 시작점과 끝점 클릭 · 드래그도 가능",
		);
		expect(portAuthoringSurfacePresentation("STK", 3, 3).instruction).toBe(
			"포트 후보 3곳 · 금색 ◇ 선택 후 Stocker 생성",
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
			"Stocker가 연결될 직선 레일",
		);
		for (const portType of ["OHB", "EQ", "STK"] as const) {
			expect(portAuthoringSurfacePresentation(portType, 0, 0).configurationAvailable).toBe(false);
			expect(portAuthoringSurfacePresentation(portType, 0, 0).prerequisiteAction).toEqual({
				label: portType === "EQ" ? "EQ용 레일 준비" : "먼저 레일 만들기",
				ariaLabel: portType === "EQ" ? "EQ용 레일 준비" : "레일 메뉴로 이동해 직선 레일 만들기",
			});
			if (portType !== "EQ")
				expect(portAuthoringSurfacePresentation(portType, 1, 1).prerequisiteAction).toBeNull();
			expect(portAuthoringSurfacePresentation(portType, 1, 1).configurationAvailable).toBe(true);
		}
	});

	it.each([
		1, 2, 100,
	])("offers EQ rail preparation despite %i legal slots when no complete span exists", (count) => {
		const blocked = portAuthoringSurfacePresentation("EQ", count, count, true, false);
		expect(blocked.prerequisiteAction?.label).toBe("EQ용 레일 준비");
		expect(blocked.instruction).toBe("현재 피치로 완성할 빈 EQ 행이 없습니다");
		expect(blocked.configurationAvailable).toBe(true);
	});

	it("removes the EQ prerequisite only when the canonical row probe succeeds", () => {
		const ready = portAuthoringSurfacePresentation("EQ", 5, 2, true, true);
		expect(ready.prerequisiteAction).toBeNull();
		expect(ready.configurationAvailable).toBe(true);
		expect(ready.instruction).toContain("시작점과 끝점");
	});

	it("rejects an invalid count", () => {
		expect(() => portAuthoringSurfacePresentation("OHB", -1, 0)).toThrow(RangeError);
		expect(() => portAuthoringSurfacePresentation("OHB", 1, 1.5)).toThrow(RangeError);
		expect(() => portAuthoringSurfacePresentation("OHB", 1, 2)).toThrow(RangeError);
	});
});
