import { describe, expect, it } from "vitest";
import { type CompiledPortSlots, PORT_SLOT_STATUS } from "../compile/PortSlotCompiler";
import type { PreparedPortSlotAvailabilityIndex } from "../compile/PortSlotPreparedArtifacts";
import { RailDocument } from "../core/RailDocument";
import {
	createGuidedPortKeyboardBinding,
	createGuidedPortKeyboardSession,
	guidedPortKeyboardAccessiblePresentation,
	guidedPortKeyboardOperationInstruction,
	guidedPortKeyboardSessionIsCurrent,
	moveGuidedPortKeyboardCursor,
	nearestPortKeyboardInitialRow,
	ordinaryPortKeyboardEscapePresentation,
	selectGuidedEqKeyboardAnchor,
} from "./GuidedPortKeyboardSession";

function fixture(portType: "OHB" | "EQ" | "STK" = "EQ") {
	const document = new RailDocument();
	const slots = {
		portType,
		count: 3,
		routeXs: new Int32Array([1, 2, 3]),
		routeZs: new Int32Array([4, 4, 4]),
	} as unknown as CompiledPortSlots;
	const availability = {} as PreparedPortSlotAvailabilityIndex;
	const binding = createGuidedPortKeyboardBinding(7, document, slots, availability);
	return { document, slots, availability, binding };
}

describe("GuidedPortKeyboardSession", () => {
	it("binds transient state to the exact document, slot catalog, and patch identity", () => {
		const { document, slots, availability, binding } = fixture();
		const session = createGuidedPortKeyboardSession("EQ", 1, binding);
		expect(guidedPortKeyboardSessionIsCurrent(session, binding)).toBe(true);
		expect(
			guidedPortKeyboardSessionIsCurrent(
				session,
				createGuidedPortKeyboardBinding(8, document, slots, availability),
			),
		).toBe(false);
	});

	it("moves a bounded cursor and makes the EQ anchor explicit", () => {
		const { binding } = fixture();
		const initial = createGuidedPortKeyboardSession("EQ", 0, binding);
		const moved = moveGuidedPortKeyboardCursor(initial, 2);
		const anchored = selectGuidedEqKeyboardAnchor(moved);
		expect(anchored).toMatchObject({ phase: "choose-end", anchorRow: 2, currentRow: 2 });
		expect(moveGuidedPortKeyboardCursor(anchored, 99)).toBe(anchored);
	});

	it("selects the nearest legal ordinary starting row and records its scope", () => {
		const { binding, availability } = fixture("OHB");
		Object.assign(availability, {
			statusFor: (_slots: CompiledPortSlots, row: number) => ({
				status: row === 1 ? PORT_SLOT_STATUS.LEGAL : PORT_SLOT_STATUS.UNSAFE_APPROACH,
				conflictingEquipmentGroupId: 0,
			}),
		});
		expect(nearestPortKeyboardInitialRow(binding, { x: 3, z: 4 })).toBe(1);
		expect(createGuidedPortKeyboardSession("OHB", 1, binding, "ordinary").scope).toBe("ordinary");
	});

	it("publishes a stable coordinate, selection count, and legality description", () => {
		const { binding } = fixture("STK");
		const session = createGuidedPortKeyboardSession("STK", 0, binding, "ordinary");
		expect(
			guidedPortKeyboardAccessiblePresentation(session, {
				routeX: 1,
				routeZ: 4,
				legal: false,
				reason: "이미 사용 중",
				selectedPortCount: 1,
			}).summary,
		).toBe(
			"키보드 STK 슬롯 · X 1미터 · Z 4미터 · 현재 1개 선택 · 배치 불가 · 이미 사용 중 · Enter로 추가·제거 · Shift+Enter로 그룹 확정 · Esc로 1개 선택 초기화",
		);
	});

	it("names the exact first ordinary Escape effect by phase and draft count", () => {
		expect(ordinaryPortKeyboardEscapePresentation("OHB", "choose-slot", 0)).toEqual({
			action: "exit-authoring",
			message: "OHB Port 배치를 종료했습니다 · Canvas에서 Rail 또는 Port를 선택하세요",
		});
		expect(ordinaryPortKeyboardEscapePresentation("EQ", "choose-slot", 0).action).toBe(
			"exit-authoring",
		);
		expect(ordinaryPortKeyboardEscapePresentation("EQ", "choose-end", 0)).toEqual({
			action: "reset-eq-row",
			message: "EQ 행 선택을 취소했습니다 · 1번 시작을 다시 선택하세요",
		});
		expect(ordinaryPortKeyboardEscapePresentation("STK", "choose-slot", 0).action).toBe(
			"exit-authoring",
		);
		expect(ordinaryPortKeyboardEscapePresentation("STK", "choose-slot", 3)).toEqual({
			action: "reset-stk-draft",
			message: "STK Port 3개 선택을 초기화했습니다 · 첫 Port부터 다시 선택하세요",
		});
	});

	it("keeps ordinary operation copy aligned with the first Escape boundary", () => {
		expect(guidedPortKeyboardOperationInstruction("OHB", "choose-slot", "ordinary")).toContain(
			"Esc는 Port 배치를 종료",
		);
		expect(guidedPortKeyboardOperationInstruction("EQ", "choose-slot", "ordinary")).toContain(
			"Esc는 Port 배치를 종료",
		);
		expect(guidedPortKeyboardOperationInstruction("EQ", "choose-end", "ordinary")).toContain(
			"Esc는 미확정 행만 취소",
		);
		expect(guidedPortKeyboardOperationInstruction("STK", "choose-slot", "ordinary", 0)).toContain(
			"Esc는 Port 배치를 종료",
		);
		expect(guidedPortKeyboardOperationInstruction("STK", "choose-slot", "ordinary", 2)).toContain(
			"Esc는 현재 2개 선택을 초기화",
		);
	});

	it("preserves the fixed EQ anchor while announcing the moving endpoint", () => {
		const { binding } = fixture("EQ");
		const anchored = selectGuidedEqKeyboardAnchor(
			createGuidedPortKeyboardSession("EQ", 0, binding, "ordinary"),
		);
		const moved = moveGuidedPortKeyboardCursor(anchored, 2);
		expect(
			guidedPortKeyboardAccessiblePresentation(moved, {
				routeX: 3,
				routeZ: 4,
				legal: true,
				reason: "배치 가능",
			}).summary,
		).toBe(
			"키보드 EQ 행 · 1 시작 · X 1미터 · Z 4미터 · 고정 · 2 끝 · X 3미터 · Z 4미터 · 배치 가능 · Enter로 행 확정 · Esc로 행 선택 취소",
		);
	});
});
