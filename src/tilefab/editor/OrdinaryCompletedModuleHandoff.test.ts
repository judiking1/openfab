import { describe, expect, it } from "vitest";
import {
	type OrdinaryCompletedModuleHandoffContext,
	ordinaryCompletedModuleHandoff,
} from "./OrdinaryCompletedModuleHandoff";

const READY_CONTEXT = Object.freeze({
	ordinaryStkInspectionActive: true,
	guidedBuildActive: false,
	ohbGroupCount: 1,
	eqGroupCount: 1,
	stkGroupCount: 1,
	organizationCount: 0,
	transientConstructionActive: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryCompletedModuleHandoffContext;

describe("ordinaryCompletedModuleHandoff", () => {
	it("offers one project-neutral continuation from selected STK after project kinds exist", () => {
		expect(ordinaryCompletedModuleHandoff(READY_CONTEXT)).toEqual({
			action: "select-connected",
			label: "다음 · 연결 구조 전체",
			instruction: "현재 STK와 연결된 레일·장비를 선택",
			ariaLabel:
				"다음 작업: 현재 STK가 닿은 연결 구조 전체를 선택합니다. 다음 화면에서 실제 선택된 레일과 장비 수를 확인하고 복제를 선택할 수 있습니다",
			description:
				"현재 STK에서 시작해 약하게 연결된 레일 컴포넌트와 그 레일을 사용하는 완전한 장비 그룹 전체를 선택합니다. 하나의 큰 연결 FAB에서는 선택 범위가 넓을 수 있으므로 다음 화면의 레일과 장비 수를 확인하세요. 이 단계는 선택만 바꾸며 FAB 데이터는 수정하지 않습니다.",
		});
	});

	it("allows additional equipment groups before the first Bay is named", () => {
		expect(
			ordinaryCompletedModuleHandoff({
				...READY_CONTEXT,
				ohbGroupCount: 3,
				eqGroupCount: 2,
				stkGroupCount: 4,
			}),
		).not.toBeNull();
	});

	it.each([
		["outside an editable ordinary STK Inspector", { ordinaryStkInspectionActive: false }],
		["inside Guided Build", { guidedBuildActive: true }],
		["without OHB", { ohbGroupCount: 0 }],
		["without EQ", { eqGroupCount: 0 }],
		["without STK", { stkGroupCount: 0 }],
		["after an organization already exists", { organizationCount: 1 }],
		["during transient construction", { transientConstructionActive: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is not ready", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryCompletedModuleHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});
