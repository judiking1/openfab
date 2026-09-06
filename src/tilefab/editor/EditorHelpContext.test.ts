import { describe, expect, it } from "vitest";
import { deriveEditorHelpContext } from "./EditorHelpContext";

describe("deriveEditorHelpContext", () => {
	it("explains the current activity before listing shortcuts", () => {
		const build = deriveEditorHelpContext({
			activity: "build",
			organizationOpen: false,
			organizationSelectionCount: 0,
		});
		const equip = deriveEditorHelpContext({
			activity: "equip",
			organizationOpen: false,
			organizationSelectionCount: 0,
		});

		expect(build.eyebrow).toBe("레일 · RAIL");
		expect(build.steps).toHaveLength(3);
		expect(build.steps.map((step) => step.label)).toEqual(["1 · 그리기", "2 · 방향", "3 · 재사용"]);
		expect(build.summary).toContain("빈 곳 어디서든");
		expect(build.steps[0]?.description).toContain("독립적으로 시작");
		expect(equip.eyebrow).toBe("장비 · PORT FIRST");
		expect(equip.summary).toContain("Port 위치");
		expect(equip.steps[0]?.description).toContain("클릭하면 OHB가 생성");
		expect(equip.steps[1]?.description).toContain("시작 Port와 끝 Port를 차례로 클릭");
		expect(equip.steps[2]?.description).toContain("STK 생성을 누르세요");
	});

	it.each([
		{
			phase: "choose-start" as const,
			eyebrow: "레일 · KEYBOARD RAIL · START",
			title: "키보드로 Rail 시작점 고르기",
			phaseLabel: "시작점 단계",
			applyLabel: "시작점 선택",
		},
		{
			phase: "choose-end" as const,
			eyebrow: "레일 · KEYBOARD RAIL · END",
			title: "키보드로 Rail 끝점 정하고 건설하기",
			phaseLabel: "끝점 단계",
			applyLabel: "구간 건설",
		},
	])("keeps ordinary keyboard Rail Help aligned with $phase", (expected) => {
		const context = deriveEditorHelpContext({
			activity: "build",
			organizationOpen: false,
			organizationSelectionCount: 0,
			ordinaryRailKeyboardPhase: expected.phase,
		});

		expect(context.eyebrow).toBe(expected.eyebrow);
		expect(context.title).toBe(expected.title);
		expect(context.summary).toContain(expected.phaseLabel);
		expect(context.summary).toContain("방향키는 1 m");
		expect(context.summary).toContain("Shift+방향키는 5 m");
		expect(context.summary).toContain("Enter");
		expect(context.summary).toContain("Esc");
		expect(context.summary).toContain("확정한 Rail은 유지");
		expect(context.steps[1]?.label).toContain(expected.applyLabel);
		expect(context.steps[2]?.description).toContain("WASD");
		expect(context.returnLabel).toBe("키보드 Rail로 돌아가기");
	});

	it("gives an active ordinary keyboard Rail session precedence over broad panels", () => {
		const context = deriveEditorHelpContext({
			activity: "assemble",
			organizationOpen: true,
			organizationSelectionCount: 2,
			ordinaryRailKeyboardPhase: "choose-end",
		});

		expect(context.eyebrow).toBe("레일 · KEYBOARD RAIL · END");
		expect(context.summary).not.toContain("2개를 선택");
	});

	it("lets the open organization task override the broad activity", () => {
		const context = deriveEditorHelpContext({
			activity: "build",
			organizationOpen: true,
			organizationSelectionCount: 1,
		});

		expect(context.eyebrow).toBe("검사 · FAB ORGANIZATION");
		expect(context.summary).toContain("같은 종류의 Bay나 Bank");
		expect(context.steps[0]?.description).toContain("⌘/Ctrl+클릭");
		expect(context.steps[1]?.description).toContain("DIRECT");
		expect(context.steps[1]?.description).toContain("EFFECTIVE");
		expect(context.returnLabel).toBe("FAB 조직으로 돌아가기");
	});

	it("reports the exact multi-selection count", () => {
		const context = deriveEditorHelpContext({
			activity: "inspect",
			organizationOpen: true,
			organizationSelectionCount: 3,
		});

		expect(context.summary).toContain("3개를 선택");
		expect(context.steps[2]?.description).toContain("ARRANGE/CONNECT");
	});
});
