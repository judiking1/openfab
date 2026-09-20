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
				"다음 작업: 반복 배치를 마치고 내부 Process Loop 두 개를 가진 새 Twin Bay를 배치합니다",
			description:
				"지금 복제한 레일·장비 묶음에는 Bay 구조가 없습니다. 내부 Process Loop 두 개와 연결점을 가진 새 Twin Bay를 배치해 FAB 조립을 시작하세요.",
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
