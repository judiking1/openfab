import { describe, expect, it } from "vitest";
import {
	ORDINARY_FIRST_OHB_ENTRY_STATUS,
	ORDINARY_RAIL_COMMIT_PENDING_STATUS,
	type OrdinaryFirstPortHandoffContext,
	ordinaryFirstPortHandoff,
	ordinaryRailCommitStatus,
} from "./OrdinaryFirstPortHandoff";

const READY_CONTEXT = Object.freeze({
	railAuthoringActive: true,
	guidedBuildActive: false,
	equipmentGroupCount: 0,
	portCount: 0,
	legalOhbSlotCount: 2,
	railKeyboardActive: false,
	portKeyboardActive: false,
	transientConstructionActive: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryFirstPortHandoffContext;

describe("ordinaryFirstPortHandoff", () => {
	it("routes the Rail commit message from the actual legal OHB slot count", () => {
		expect(ORDINARY_RAIL_COMMIT_PENDING_STATUS).toContain("후보를 확인합니다");
		expect(ORDINARY_RAIL_COMMIT_PENDING_STATUS).not.toContain("Port는 EQUIP");
		expect(ordinaryRailCommitStatus(0)).toContain("OHB Port용 내부 직선 슬롯이 없습니다");
		expect(ordinaryRailCommitStatus(0)).toContain("양끝 터미널 안전 구간");
		expect(ordinaryRailCommitStatus(0)).not.toContain("Port는 EQUIP");
		expect(ordinaryRailCommitStatus(1)).toContain("Port는 EQUIP");
		expect(() => ordinaryRailCommitStatus(-1)).toThrow(RangeError);
	});

	it("offers one task-first handoff after an ordinary rail exposes OHB slots", () => {
		expect(ordinaryFirstPortHandoff(READY_CONTEXT)).toEqual({
			label: "다음 · OHB Port 1개",
			instruction: "하늘색 원 클릭 · 또는 Enter",
			ariaLabel: "다음 작업: EQUIP에서 레일 옆 하늘색 원을 클릭하거나 Enter로 OHB Port 1개 놓기",
			description:
				"레일은 저장되었습니다. EQUIP에서 하늘색 원을 클릭하거나 흰 테두리·화살표 대상에서 Enter를 눌러 첫 OHB Port를 놓습니다.",
		});
		expect(ORDINARY_FIRST_OHB_ENTRY_STATUS).toContain("하늘색 원을 클릭");
		expect(ORDINARY_FIRST_OHB_ENTRY_STATUS).toContain("Enter");
	});

	it.each([
		["outside Rail authoring", { railAuthoringActive: false }],
		["inside Guided Build", { guidedBuildActive: true }],
		["after an equipment group exists", { equipmentGroupCount: 1 }],
		["after a Port exists", { portCount: 1 }],
		["without a legal OHB slot", { legalOhbSlotCount: 0 }],
		["during keyboard Rail construction", { railKeyboardActive: true }],
		["during keyboard Port construction", { portKeyboardActive: true }],
		["during another transient construction", { transientConstructionActive: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is not ready", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryFirstPortHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});
