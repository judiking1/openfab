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
		expect(equip.eyebrow).toBe("장비 · OHB/EQ/Stocker");
		expect(equip.summary).toContain("입출고 지점이 포트");
		expect(equip.steps[0]?.description).toContain("클릭하면 OHB가 생성");
		expect(equip.steps[1]?.description).toContain("시작 포트와 끝 포트를 차례로 클릭");
		expect(equip.steps[2]?.description).toContain("Stocker 생성을 누르세요");
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

		expect(context.eyebrow).toBe("선택 · FAB ORGANIZATION");
		expect(context.summary).toContain("같은 종류의 Bay나 Bank");
		expect(context.steps[0]?.description).toContain("⌘/Ctrl+클릭");
		expect(context.steps[1]?.description).toContain("선택 조직만");
		expect(context.steps[1]?.description).toContain("하위 조직 포함");
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

	it("points equipment inspection Help to the service and EQ body controls", () => {
		const context = deriveEditorHelpContext({
			activity: "inspect",
			organizationOpen: false,
			organizationSelectionCount: 0,
		});
		const service = context.steps.find((step) => step.label.includes("서비스 방향"));
		expect(service?.description).toContain("장비 Inspector의 서비스 방향 반전");
		expect(service?.description).toContain("레일 흐름은 유지");
		const body = context.steps.find((step) => step.label.includes("EQ 몸체"));
		expect(body?.description).toContain("EQ Inspector의 몸체 크기");
		expect(body?.description).toContain("크기 적용");
		expect(body?.description).toContain("Port 위치·방향은 고정");
	});

	it.each([
		"OHB",
		"EQ",
		"STK",
	] as const)("describes %s edit intent instead of creation", (equipmentType) => {
		for (const mode of ["move", "copy"] as const) {
			const context = deriveEditorHelpContext({
				activity: "equip",
				organizationOpen: false,
				organizationSelectionCount: 0,
				equipmentEdit: { equipmentType, mode },
			});
			const name = equipmentType === "STK" ? "Stocker" : equipmentType;
			const action = mode === "move" ? "이동" : "복제";
			expect(context.title).toBe(`${name} ${action} 위치 고르기`);
			expect(context.steps[1]?.description).toContain("Enter 또는 클릭");
			expect(context.steps[2]?.description).toContain("원본 장비와 선택을 유지");
			expect(context.steps.some((step) => step.description.includes("생성"))).toBe(false);
			expect(context.summary).toContain(equipmentType === "OHB" ? "선택한 OHB" : "모든 포트");
		}
	});

	it.each([
		"EQ",
		"STK",
	] as const)("keeps %s Port editing separate from creation", (equipmentType) => {
		const context = deriveEditorHelpContext({
			activity: "equip",
			organizationOpen: false,
			organizationSelectionCount: 0,
			equipmentEdit: { equipmentType, mode: "ports" },
		});
		expect(context.title).toContain("포트 구성 바꾸기");
		expect(context.steps[0]?.description).toContain(equipmentType === "EQ" ? "Q/E" : "Space");
		expect(context.steps[2]?.description).toContain("Enter 또는 완료");
		expect(context.steps[2]?.description).toContain("원본 장비를 유지");
		expect(context.summary).not.toContain("같은 Loop");
	});

	it.each([
		"EQ",
		"STK",
	] as const)("keeps the owned %s Port editing limits in current-task Help", (equipmentType) => {
		const context = deriveEditorHelpContext({
			activity: "equip",
			organizationOpen: true,
			organizationSelectionCount: 1,
			equipmentEdit: { equipmentType, mode: "ports", preservesLoopOwnership: true },
		});
		expect(context.summary).toContain("모든 Port는 같은 Loop 안에 유지");
		expect(context.summary).toContain("기존 Port를 남겨 추가·제거");
		expect(context.summary).toContain("전체 위치 변경은 장비 이동");
		expect(context.summary).toContain("완료하기 전에는 원본 장비가 유지");
		expect(context.returnLabel).toBe("포트 구성 편집으로 돌아가기");
	});

	it("does not use an inactive equipment intent for another activity", () => {
		const context = deriveEditorHelpContext({
			activity: "inspect",
			organizationOpen: false,
			organizationSelectionCount: 0,
			equipmentEdit: { equipmentType: "OHB", mode: "move" },
		});
		expect(context.eyebrow).toBe("선택 · SELECT");
	});
});
