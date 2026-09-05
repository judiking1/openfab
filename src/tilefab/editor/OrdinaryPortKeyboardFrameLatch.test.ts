import { describe, expect, it } from "vitest";
import { type CompiledPortSlots, PORT_SLOT_STATUS } from "../compile/PortSlotCompiler";
import type { PreparedPortSlotAvailabilityIndex } from "../compile/PortSlotPreparedArtifacts";
import { RailDocument } from "../core/RailDocument";
import {
	createGuidedPortKeyboardBinding,
	createGuidedPortKeyboardSession,
	moveGuidedPortKeyboardCursor,
	selectGuidedEqKeyboardAnchor,
} from "./GuidedPortKeyboardSession";
import {
	decideOrdinaryPortKeyboardApply,
	resolveOrdinaryPortKeyboardDeferredApply,
} from "./OrdinaryPortKeyboardFrameLatch";

function ordinaryEqSession() {
	const document = new RailDocument();
	const slots = {
		portType: "EQ",
		count: 4,
		routeXs: new Int32Array([1, 2, 3, 4]),
		routeZs: new Int32Array([5, 5, 5, 5]),
	} as unknown as CompiledPortSlots;
	const availability = {
		statusFor: () => ({
			status: PORT_SLOT_STATUS.LEGAL,
			conflictingEquipmentGroupId: 0,
		}),
	} as unknown as PreparedPortSlotAvailabilityIndex;
	const binding = createGuidedPortKeyboardBinding(1, document, slots, availability);
	return createGuidedPortKeyboardSession("EQ", 0, binding, "ordinary");
}

describe("OrdinaryPortKeyboardFrameLatch", () => {
	it("defers an unpainted row, coalesces repeated Enter, and applies it after exact paint", () => {
		const painted = ordinaryEqSession();
		const current = moveGuidedPortKeyboardCursor(painted, 1);
		expect(decideOrdinaryPortKeyboardApply(current, painted, null)).toEqual({
			kind: "defer",
			session: current,
		});
		expect(decideOrdinaryPortKeyboardApply(current, painted, current)).toEqual({
			kind: "coalesce",
			session: current,
		});
		expect(resolveOrdinaryPortKeyboardDeferredApply(current, current, current)).toBe(current);
	});

	it("applies an already painted row immediately and leaves guided resolution unchanged", () => {
		const ordinary = ordinaryEqSession();
		expect(decideOrdinaryPortKeyboardApply(ordinary, ordinary, null)).toEqual({
			kind: "apply",
			session: ordinary,
		});
		const guided = createGuidedPortKeyboardSession("EQ", ordinary.currentRow, ordinary.binding);
		expect(decideOrdinaryPortKeyboardApply(guided, null, null)).toEqual({
			kind: "apply",
			session: guided,
		});
	});

	it("rejects a moved row, phase change, cancelled session, and stale replacement", () => {
		const start = ordinaryEqSession();
		const moved = moveGuidedPortKeyboardCursor(start, 1);
		const movedAgain = moveGuidedPortKeyboardCursor(moved, 2);
		const anchored = selectGuidedEqKeyboardAnchor(moved);
		expect(resolveOrdinaryPortKeyboardDeferredApply(movedAgain, moved, moved)).toBeNull();
		expect(resolveOrdinaryPortKeyboardDeferredApply(anchored, moved, moved)).toBeNull();
		expect(resolveOrdinaryPortKeyboardDeferredApply(null, moved, moved)).toBeNull();
		expect(resolveOrdinaryPortKeyboardDeferredApply(start, start, moved)).toBeNull();
	});

	it("defers and resolves an exact EQ choose-end session only after that endpoint paints", () => {
		const start = ordinaryEqSession();
		const anchored = selectGuidedEqKeyboardAnchor(start);
		const paintedEnd = moveGuidedPortKeyboardCursor(anchored, 1);
		const movedEnd = moveGuidedPortKeyboardCursor(paintedEnd, 2);
		expect(decideOrdinaryPortKeyboardApply(movedEnd, paintedEnd, null)).toEqual({
			kind: "defer",
			session: movedEnd,
		});
		expect(resolveOrdinaryPortKeyboardDeferredApply(movedEnd, movedEnd, movedEnd)).toBe(movedEnd);
		expect(resolveOrdinaryPortKeyboardDeferredApply(anchored, movedEnd, movedEnd)).toBeNull();
	});
});
