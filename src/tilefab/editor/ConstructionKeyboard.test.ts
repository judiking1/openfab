import { describe, expect, it } from "vitest";
import {
	advanceRecentBlueprintWheelGesture,
	createRecentBlueprintWheelGestureState,
	resolveConstructionQuickSlot,
	resolveConstructionRotationIntent,
	resolveEditorClipboardShortcut,
	resolveEditorDiscoveryShortcut,
	resolveEditorRotateShortcut,
	resolveEditorSaveShortcut,
	resolveFavoriteBlueprintQuickSlot,
	resolveRecentBlueprintWheel,
	resolveUserBlueprintQuickSlot,
} from "./ConstructionKeyboard";

describe("ConstructionKeyboard", () => {
	it("rotates active templates and stamps before catalog controls", () => {
		expect(
			resolveConstructionRotationIntent(
				{ buildToolActive: true, templateActive: true, stampActive: false, controls: ["side"] },
				1,
			),
		).toEqual({ kind: "rotate-template", quarterTurns: 1 });
		expect(
			resolveConstructionRotationIntent(
				{ buildToolActive: true, templateActive: false, stampActive: true, controls: ["bend"] },
				-1,
			),
		).toEqual({ kind: "rotate-stamp", quarterTurns: -1 });
	});

	it("maps sided modules and Smart Route bend order without rotating the view", () => {
		expect(
			resolveConstructionRotationIntent(
				{ buildToolActive: true, templateActive: false, stampActive: false, controls: ["side"] },
				-1,
			),
		).toEqual({ kind: "choose-side", side: "left" });
		expect(
			resolveConstructionRotationIntent(
				{ buildToolActive: true, templateActive: false, stampActive: false, controls: ["bend"] },
				1,
			),
		).toEqual({ kind: "choose-bend", bend: "vertical-first" });
	});

	it("does nothing outside rail construction", () => {
		expect(
			resolveConstructionRotationIntent(
				{ buildToolActive: false, templateActive: true, stampActive: false, controls: [] },
				1,
			),
		).toEqual({ kind: "unavailable" });
	});

	it("reserves Ctrl/Cmd+C, X, and V for the internal rail clipboard", () => {
		expect(
			resolveEditorClipboardShortcut({
				code: "KeyC",
				repeat: false,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
			}),
		).toBe("copy");
		expect(
			resolveEditorClipboardShortcut({
				code: "KeyX",
				repeat: false,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
			}),
		).toBe("cut");
		expect(
			resolveEditorClipboardShortcut({
				code: "KeyV",
				repeat: false,
				ctrlKey: false,
				metaKey: true,
				altKey: false,
			}),
		).toBe("paste");
		expect(
			resolveEditorClipboardShortcut({
				code: "KeyC",
				repeat: false,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
			}),
		).toBeNull();
		expect(
			resolveEditorClipboardShortcut({
				code: "KeyV",
				repeat: false,
				ctrlKey: true,
				metaKey: false,
				altKey: true,
			}),
		).toBeNull();
		expect(
			resolveEditorClipboardShortcut({
				code: "KeyC",
				repeat: true,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
			}),
		).toBeNull();
	});

	it("reserves Ctrl/Cmd+S for contextual blueprint or project save", () => {
		expect(
			resolveEditorSaveShortcut({
				code: "KeyS",
				repeat: false,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBe(true);
		expect(
			resolveEditorSaveShortcut({
				code: "KeyS",
				repeat: false,
				ctrlKey: false,
				metaKey: true,
				altKey: false,
				shiftKey: false,
			}),
		).toBe(true);
		expect(
			resolveEditorSaveShortcut({
				code: "KeyS",
				repeat: false,
				ctrlKey: true,
				metaKey: false,
				altKey: true,
				shiftKey: false,
			}),
		).toBe(false);
		expect(
			resolveEditorSaveShortcut({
				code: "KeyS",
				repeat: false,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
				shiftKey: true,
			}),
		).toBe(false);
		expect(
			resolveEditorSaveShortcut({
				code: "KeyS",
				repeat: true,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBe(false);
	});

	it("maps B, C, and O to unmodified discovery commands", () => {
		const input = {
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
		};
		expect(resolveEditorDiscoveryShortcut({ ...input, code: "KeyB" })).toBe(
			"open-blueprint-library",
		);
		expect(resolveEditorDiscoveryShortcut({ ...input, code: "KeyC" })).toBe("clone-hovered");
		expect(resolveEditorDiscoveryShortcut({ ...input, code: "KeyO" })).toBe("select-connected");
		expect(resolveEditorDiscoveryShortcut({ ...input, code: "KeyC", ctrlKey: true })).toBeNull();
		expect(resolveEditorDiscoveryShortcut({ ...input, code: "KeyB", shiftKey: true })).toBeNull();
		expect(resolveEditorDiscoveryShortcut({ ...input, code: "KeyO", repeat: true })).toBeNull();
	});

	it("cycles recent blueprints only for a platform-primary wheel gesture", () => {
		expect(
			resolveRecentBlueprintWheel({
				deltaY: 120,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBe(1);
		expect(
			resolveRecentBlueprintWheel({
				deltaY: -1,
				ctrlKey: false,
				metaKey: true,
				altKey: false,
				shiftKey: false,
			}),
		).toBe(-1);
		expect(
			resolveRecentBlueprintWheel({
				deltaY: 120,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBeNull();
		expect(
			resolveRecentBlueprintWheel({
				deltaY: 0,
				ctrlKey: true,
				metaKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBeNull();
	});

	it("coalesces trackpad deltas and throttles repeated recent-blueprint steps", () => {
		let state = createRecentBlueprintWheelGestureState();
		let result = advanceRecentBlueprintWheelGesture(state, { deltaY: 10, nowMs: 0 });
		expect(result.direction).toBeNull();
		state = result.state;
		result = advanceRecentBlueprintWheelGesture(state, { deltaY: 20, nowMs: 20 });
		expect(result.direction).toBeNull();
		state = result.state;
		result = advanceRecentBlueprintWheelGesture(state, { deltaY: 15, nowMs: 40 });
		expect(result.direction).toBe(1);
		state = result.state;

		result = advanceRecentBlueprintWheelGesture(state, { deltaY: -120, nowMs: 60 });
		expect(result.direction).toBeNull();
		state = result.state;
		result = advanceRecentBlueprintWheelGesture(state, { deltaY: -1, nowMs: 140 });
		expect(result.direction).toBe(-1);
		state = result.state;

		result = advanceRecentBlueprintWheelGesture(state, { deltaY: 120, nowMs: 500 });
		expect(result.direction).toBe(1);
	});

	it("uses R to transform active assets and otherwise cycle the route alternative", () => {
		const base = {
			code: "KeyR",
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			buildToolActive: true,
			transformActive: false,
		};
		expect(resolveEditorRotateShortcut(base)).toEqual({ kind: "cycle-bend" });
		expect(resolveEditorRotateShortcut({ ...base, transformActive: true })).toEqual({
			kind: "rotate",
			quarterTurns: 1,
		});
		expect(resolveEditorRotateShortcut({ ...base, transformActive: true, shiftKey: true })).toEqual(
			{
				kind: "rotate",
				quarterTurns: -1,
			},
		);
		expect(
			resolveEditorRotateShortcut({
				...base,
				buildToolActive: false,
				transformActive: false,
			}),
		).toBeNull();
		expect(resolveEditorRotateShortcut({ ...base, repeat: true })).toBeNull();
	});

	it("maps 1-4 on both keyboard rows and ignores repeat or modified input", () => {
		const input = {
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
		};
		expect(resolveConstructionQuickSlot({ ...input, code: "Digit1" })).toBe("route");
		expect(resolveConstructionQuickSlot({ ...input, code: "Numpad2" })).toBe("u-turn");
		expect(resolveConstructionQuickSlot({ ...input, code: "Digit3" })).toBe("shift");
		expect(resolveConstructionQuickSlot({ ...input, code: "Digit4" })).toBe("advanced-switch");
		expect(resolveConstructionQuickSlot({ ...input, code: "Digit2", repeat: true })).toBeNull();
		expect(resolveConstructionQuickSlot({ ...input, code: "Digit2", ctrlKey: true })).toBeNull();
		expect(resolveConstructionQuickSlot({ ...input, code: "Digit2", shiftKey: true })).toBeNull();
	});

	it("maps favorite blueprint slots 5-9 without changing the construction catalog", () => {
		const input = {
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
		};
		expect(resolveFavoriteBlueprintQuickSlot({ ...input, code: "Digit5" })).toBe(0);
		expect(resolveFavoriteBlueprintQuickSlot({ ...input, code: "Numpad7" })).toBe(2);
		expect(resolveFavoriteBlueprintQuickSlot({ ...input, code: "Digit9" })).toBe(4);
		expect(resolveFavoriteBlueprintQuickSlot({ ...input, code: "Digit4" })).toBeNull();
		expect(
			resolveFavoriteBlueprintQuickSlot({ ...input, code: "Digit5", repeat: true }),
		).toBeNull();
		expect(
			resolveFavoriteBlueprintQuickSlot({ ...input, code: "Digit5", metaKey: true }),
		).toBeNull();
		expect(
			resolveFavoriteBlueprintQuickSlot({ ...input, code: "Digit5", shiftKey: true }),
		).toBeNull();
	});

	it("maps Alt+1 through Alt+9 to user-library slots without shadowing bare tool keys", () => {
		const input = {
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: true,
			shiftKey: false,
		};
		expect(resolveUserBlueprintQuickSlot({ ...input, code: "Digit1" })).toBe(1);
		expect(resolveUserBlueprintQuickSlot({ ...input, code: "Numpad9" })).toBe(9);
		expect(resolveUserBlueprintQuickSlot({ ...input, code: "Digit0" })).toBeNull();
		expect(resolveUserBlueprintQuickSlot({ ...input, code: "Digit3", altKey: false })).toBeNull();
		expect(resolveUserBlueprintQuickSlot({ ...input, code: "Digit3", repeat: true })).toBeNull();
		expect(resolveUserBlueprintQuickSlot({ ...input, code: "Digit3", ctrlKey: true })).toBeNull();
	});
});
