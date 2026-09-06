import { describe, expect, it } from "vitest";
import {
	ORDINARY_EQ_HANDOFF_ENTRY_STATUS,
	type OrdinaryNextPortHandoffContext,
	ordinaryEqHandoffRailPrerequisiteStatus,
	ordinaryNextPortHandoff,
} from "./OrdinaryNextPortHandoff";

const READY_CONTEXT = Object.freeze({
	surface: "ohb-authoring",
	guidedBuildActive: false,
	ohbGroupCount: 1,
	eqGroupCount: 0,
	eqRowReady: true,
	eqPitchMillimeters: 1_000,
	railKeyboardActive: false,
	portKeyboardActive: false,
	selectionActive: false,
	placementIntentActive: false,
	transientConstructionActive: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryNextPortHandoffContext;

describe("ordinaryNextPortHandoff", () => {
	it("offers one EQ handoff while repeated ordinary OHB placement remains active", () => {
		expect(ordinaryNextPortHandoff(READY_CONTEXT)).toEqual({
			surface: "ohb-authoring",
			action: "start-eq",
			label: "추천 · EQ Port 행",
			instruction: "청록색 시작점 → 끝점 클릭",
			ariaLabel:
				"추천 다음 작업: 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그하여 EQ Port 행을 만듭니다. 키보드는 진입 후 표시되는 흰 테두리 1번 시작에서 Enter를 사용합니다. OHB Port는 계속 배치할 수 있습니다",
			description:
				"OHB Port를 계속 배치하거나, 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그합니다. 키보드는 흰 테두리 1번 시작에서 Enter를 사용합니다.",
		});
		expect(ORDINARY_EQ_HANDOFF_ENTRY_STATUS).toContain("차례로 클릭하거나 드래그");
		expect(ORDINARY_EQ_HANDOFF_ENTRY_STATUS).toContain("Enter");
	});

	it("redirects to truthful Rail preparation when no EQ row can complete", () => {
		expect(ordinaryNextPortHandoff({ ...READY_CONTEXT, eqRowReady: false })).toEqual({
			surface: "ohb-authoring",
			action: "prepare-eq-rail",
			label: "준비 · EQ용 직선",
			instruction: "PITCH 1 m · CENTER 2곳 필요 · BUILD에서 레일 준비",
			ariaLabel:
				"EQ Port 행 준비: 현재 EQ PITCH 1 m에 맞춰 같은 직선에 배치 가능한 CENTER 슬롯이 1 m 간격으로 최소 2곳 필요합니다. BUILD에서 직선 레일을 늘리거나 새로 만든 뒤 EQUIP의 EQ Port 행으로 돌아옵니다. 기존 OHB Port는 유지됩니다",
			description:
				"현재 레일에는 한 EQ가 소유할 1 m 간격의 CENTER 슬롯 2곳이 부족합니다. 기존 OHB Port는 유지되므로 BUILD에서 직선 레일을 늘리거나 새로 만든 뒤 EQ Port 행을 선택하세요.",
		});
		expect(ordinaryEqHandoffRailPrerequisiteStatus(1_000)).toContain("1 m 간격");
		expect(ordinaryEqHandoffRailPrerequisiteStatus(1_000)).toContain("기존 OHB는 유지");
	});

	it("names the retained non-default EQ pitch in every recovery owner", () => {
		const presentation = ordinaryNextPortHandoff({
			...READY_CONTEXT,
			eqRowReady: false,
			eqPitchMillimeters: 2_000,
		});
		expect(presentation?.instruction).toContain("PITCH 2 m");
		expect(presentation?.ariaLabel).toContain("2 m 간격");
		expect(presentation?.description).toContain("2 m 간격");
		expect(ordinaryEqHandoffRailPrerequisiteStatus(2_000)).toContain("2 m 간격");
	});

	it("does not require the OHB group count to equal one", () => {
		expect(ordinaryNextPortHandoff({ ...READY_CONTEXT, ohbGroupCount: 3 })).not.toBeNull();
	});

	it("returns the completed Rail directly to EQ from an idle Build surface", () => {
		expect(
			ordinaryNextPortHandoff({
				...READY_CONTEXT,
				surface: "build-return",
				eqPitchMillimeters: 2_000,
			}),
		).toEqual({
			surface: "build-return",
			action: "start-eq",
			label: "다음 · EQ Port 행",
			instruction: "PITCH 2 m 준비 · 청록색 시작점 → 끝점 클릭",
			ariaLabel:
				"다음 작업: 현재 EQ PITCH 2 m로 완성할 수 있는 직선에서 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그하여 EQ Port 행을 만듭니다. 키보드는 진입 후 표시되는 흰 테두리 1번 시작에서 Enter를 사용합니다",
			description:
				"현재 EQ PITCH 2 m로 EQ Port 행을 완성할 수 있는 직선 레일이 준비되었습니다. 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그하거나, 흰 테두리 1번 시작에서 Enter로 시작합니다.",
		});
	});

	it.each([
		["before a completable EQ span exists", { eqRowReady: false }],
		["during keyboard Rail construction", { railKeyboardActive: true }],
		["during a keyboard Port session", { portKeyboardActive: true }],
	] as const)("keeps the Build return silent %s", (_label, override) => {
		expect(
			ordinaryNextPortHandoff({ ...READY_CONTEXT, surface: "build-return", ...override }),
		).toBeNull();
	});

	it.each([
		["outside an owned authoring surface", { surface: null }],
		["inside Guided Build", { guidedBuildActive: true }],
		["before an OHB exists", { ohbGroupCount: 0 }],
		["after an EQ exists", { eqGroupCount: 1 }],
		["while a selection owns context", { selectionActive: true }],
		["during OHB move or copy", { placementIntentActive: true }],
		["during another transient construction", { transientConstructionActive: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is not ready", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryNextPortHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});
