import { describe, expect, it } from "vitest";
import {
	type OrdinaryConnectedCopyTwinBayHandoffContext,
	ordinaryConnectedCopyTwinBayHandoff,
} from "./OrdinaryConnectedCopyTwinBayHandoff";

const GROUPS = Object.freeze([
	Object.freeze({ kind: "OHB", template: "SINGLE", portIndices: Object.freeze([0]) }),
	Object.freeze({
		kind: "EQ",
		pitchMillimeters: 1_000,
		recipe: null,
		portIndices: Object.freeze([1]),
	}),
	Object.freeze({ kind: "STK", template: "FLEX", portIndices: Object.freeze([2]) }),
] as const);

const READY_CONTEXT = Object.freeze({
	selectionCopyActive: true,
	sourceEquipmentGroups: GROUPS,
	committedPlacementCount: 1,
	redoAvailable: false,
	guidedBuildActive: false,
	organizationCount: 0,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryConnectedCopyTwinBayHandoffContext;

describe("ordinaryConnectedCopyTwinBayHandoff", () => {
	it("offers a separate certified Twin Bay after one connected EQ/OHB/STK copy commit", () => {
		expect(ordinaryConnectedCopyTwinBayHandoff(READY_CONTEXT)).toEqual({
			action: "start-certified-twin-bay",
			label: "다음 · 새 Twin Bay 배치",
			instruction: "별도 인증 Twin Bay를 새로 배치 · 복제 구조는 그대로 유지",
			ariaLabel:
				"다음 작업: 복제 반복 배치를 끝내고 별도로 인증된 새 Twin Bay 배치를 시작합니다. 이미 확정한 복제 구조는 그대로 유지되며 Bay로 자동 승격되지 않습니다",
			description:
				"현재 복제 구조는 레일과 장비의 연결 묶음일 뿐 Bay 조직이 아닙니다. 이 행동은 복제 반복 고스트만 끝내고, Shell과 두 Process Loop 및 Gateway를 포함하는 기존 인증 Twin Bay 생성 경로를 별도로 시작합니다.",
		});
	});

	it("accepts additional source equipment without promoting it to a Bay", () => {
		expect(
			ordinaryConnectedCopyTwinBayHandoff({
				...READY_CONTEXT,
				sourceEquipmentGroups: Object.freeze([...GROUPS, GROUPS[1], GROUPS[2]]),
			}),
		).not.toBeNull();
	});

	it.each([
		["before a copy commit", { committedPlacementCount: 0 }],
		["after Undo exposes redo history", { redoAvailable: true }],
		["outside a selection-copy session", { selectionCopyActive: false }],
		["without a mixed static FAB template", { sourceEquipmentGroups: null }],
		["without OHB", { sourceEquipmentGroups: GROUPS.filter((group) => group.kind !== "OHB") }],
		["without EQ", { sourceEquipmentGroups: GROUPS.filter((group) => group.kind !== "EQ") }],
		["without STK", { sourceEquipmentGroups: GROUPS.filter((group) => group.kind !== "STK") }],
		["inside Guided Build", { guidedBuildActive: true }],
		["after organizations exist", { organizationCount: 1 }],
		["while placement is pending", { placementPending: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is not ready", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryConnectedCopyTwinBayHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});
