import type { RailConstructionCatalogId } from "../core/RailConstructionCatalog";
import {
	type EditorCommandId,
	type EditorKeyboardInput,
	editorCommandMatchesKeyboard,
} from "./EditorCommandRegistry";

export type ConstructionRotationIntent =
	| { readonly kind: "rotate-template"; readonly quarterTurns: -1 | 1 }
	| { readonly kind: "rotate-stamp"; readonly quarterTurns: -1 | 1 }
	| { readonly kind: "choose-side"; readonly side: "left" | "right" }
	| {
			readonly kind: "choose-bend";
			readonly bend: "horizontal-first" | "vertical-first";
	  }
	| { readonly kind: "unavailable" };

export interface ConstructionRotationContext {
	readonly buildToolActive: boolean;
	readonly templateActive: boolean;
	readonly stampActive: boolean;
	readonly controls: readonly string[];
}

export type EditorClipboardShortcut = "copy" | "cut" | "paste" | null;
export type EditorDiscoveryShortcut =
	| "open-blueprint-library"
	| "clone-hovered"
	| "select-connected"
	| null;
export interface RecentBlueprintWheelGestureState {
	readonly accumulatedDeltaY: number;
	readonly lastEventAtMs: number;
	readonly lastStepAtMs: number;
}
export interface RecentBlueprintWheelGestureResult {
	readonly state: RecentBlueprintWheelGestureState;
	readonly direction: -1 | 1 | null;
}
export type EditorRotateShortcut =
	| { readonly kind: "rotate"; readonly quarterTurns: -1 | 1 }
	| { readonly kind: "cycle-bend" }
	| null;

const CONSTRUCTION_QUICK_SLOTS = Object.freeze([
	["route", "construction.quick-route"],
	["u-turn", "construction.quick-u-turn"],
	["shift", "construction.quick-shift"],
	["advanced-switch", "construction.quick-advanced-switch"],
] satisfies readonly (readonly [RailConstructionCatalogId, EditorCommandId])[]);

const FAVORITE_BLUEPRINT_QUICK_SLOTS = Object.freeze([
	"blueprint.favorite-1",
	"blueprint.favorite-2",
	"blueprint.favorite-3",
	"blueprint.favorite-4",
	"blueprint.favorite-5",
] satisfies readonly EditorCommandId[]);

function keyboardInput(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey?: boolean;
}): EditorKeyboardInput {
	return Object.freeze({
		code: input.code,
		repeat: input.repeat,
		ctrlKey: input.ctrlKey,
		metaKey: input.metaKey,
		altKey: input.altKey,
		shiftKey: input.shiftKey ?? false,
	});
}

export function resolveConstructionQuickSlot(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}): RailConstructionCatalogId | null {
	const normalized = keyboardInput(input);
	for (const [catalogId, commandId] of CONSTRUCTION_QUICK_SLOTS) {
		if (editorCommandMatchesKeyboard(commandId, normalized, { context: "construction" })) {
			return catalogId;
		}
	}
	return null;
}

export function resolveFavoriteBlueprintQuickSlot(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}): number | null {
	const normalized = keyboardInput(input);
	const index = FAVORITE_BLUEPRINT_QUICK_SLOTS.findIndex((commandId) =>
		editorCommandMatchesKeyboard(commandId, normalized, { context: "canvas" }),
	);
	return index >= 0 ? index : null;
}

export function resolveUserBlueprintQuickSlot(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}): number | null {
	const normalized = keyboardInput(input);
	for (let slot = 1; slot <= 9; slot += 1) {
		if (
			editorCommandMatchesKeyboard(`blueprint.user-slot-${slot}` as EditorCommandId, normalized, {
				context: "canvas",
			})
		) {
			return slot;
		}
	}
	return null;
}

/** Resolve platform-primary clipboard shortcuts before any bare construction-tool key. */
export function resolveEditorClipboardShortcut(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
}): EditorClipboardShortcut {
	const normalized = keyboardInput(input);
	if (editorCommandMatchesKeyboard("selection.copy", normalized)) return "copy";
	if (editorCommandMatchesKeyboard("selection.cut", normalized)) return "cut";
	if (editorCommandMatchesKeyboard("blueprint.paste-recent", normalized)) return "paste";
	return null;
}

export function resolveEditorSaveShortcut(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}): boolean {
	return editorCommandMatchesKeyboard("project.save-context", keyboardInput(input));
}

/** Shapez-style single-key discovery commands; modified variants remain available to the OS/UI. */
export function resolveEditorDiscoveryShortcut(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}): EditorDiscoveryShortcut {
	const normalized = keyboardInput(input);
	if (editorCommandMatchesKeyboard("blueprint.open-library", normalized, { context: "canvas" })) {
		return "open-blueprint-library";
	}
	if (editorCommandMatchesKeyboard("selection.clone-hovered", normalized, { context: "canvas" })) {
		return "clone-hovered";
	}
	if (editorCommandMatchesKeyboard("selection.connected", normalized, { context: "canvas" })) {
		return "select-connected";
	}
	return null;
}

/** Ctrl/Cmd+wheel changes the active transient blueprint without changing ordinary zoom. */
export function resolveRecentBlueprintWheel(input: {
	readonly deltaY: number;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}): -1 | 1 | null {
	if (
		(!input.ctrlKey && !input.metaKey) ||
		input.altKey ||
		input.shiftKey ||
		!Number.isFinite(input.deltaY) ||
		input.deltaY === 0
	) {
		return null;
	}
	return input.deltaY < 0 ? -1 : 1;
}

const RECENT_BLUEPRINT_WHEEL_STEP_DELTA = 40;
const RECENT_BLUEPRINT_WHEEL_STEP_COOLDOWN_MS = 100;
const RECENT_BLUEPRINT_WHEEL_GESTURE_RESET_MS = 240;

export function createRecentBlueprintWheelGestureState(): RecentBlueprintWheelGestureState {
	return Object.freeze({
		accumulatedDeltaY: 0,
		lastEventAtMs: Number.NEGATIVE_INFINITY,
		lastStepAtMs: Number.NEGATIVE_INFINITY,
	});
}

/** Coalesce high-frequency trackpad deltas into intentional bounded RECENT steps. */
export function advanceRecentBlueprintWheelGesture(
	previous: RecentBlueprintWheelGestureState,
	input: { readonly deltaY: number; readonly nowMs: number },
): RecentBlueprintWheelGestureResult {
	if (!Number.isFinite(input.deltaY) || input.deltaY === 0 || !Number.isFinite(input.nowMs)) {
		return Object.freeze({ state: previous, direction: null });
	}
	const previousDirection = Math.sign(previous.accumulatedDeltaY);
	const nextDirection = Math.sign(input.deltaY);
	const elapsedSinceEvent = input.nowMs - previous.lastEventAtMs;
	const sameGesture =
		elapsedSinceEvent >= 0 &&
		elapsedSinceEvent <= RECENT_BLUEPRINT_WHEEL_GESTURE_RESET_MS &&
		(previousDirection === 0 || previousDirection === nextDirection);
	const accumulatedDeltaY = (sameGesture ? previous.accumulatedDeltaY : 0) + input.deltaY;
	const elapsedSinceStep = input.nowMs - previous.lastStepAtMs;
	const direction =
		Math.abs(accumulatedDeltaY) >= RECENT_BLUEPRINT_WHEEL_STEP_DELTA &&
		elapsedSinceStep >= RECENT_BLUEPRINT_WHEEL_STEP_COOLDOWN_MS
			? accumulatedDeltaY < 0
				? -1
				: 1
			: null;
	return Object.freeze({
		state: Object.freeze({
			accumulatedDeltaY: direction === null ? accumulatedDeltaY : 0,
			lastEventAtMs: input.nowMs,
			lastStepAtMs: direction === null ? previous.lastStepAtMs : input.nowMs,
		}),
		direction,
	});
}

/**
 * Shapez-style R is contextual: transform an active asset, otherwise cycle the Smart Route
 * alternative. Q/E remain explicit directional aliases through resolveConstructionRotationIntent.
 */
export function resolveEditorRotateShortcut(input: {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	readonly buildToolActive: boolean;
	readonly transformActive: boolean;
}): EditorRotateShortcut {
	const normalized = keyboardInput(input);
	if (input.transformActive) {
		if (
			editorCommandMatchesKeyboard("placement.rotate-counterclockwise", normalized, {
				context: "placement",
			})
		) {
			return Object.freeze({ kind: "rotate", quarterTurns: -1 });
		}
		if (
			editorCommandMatchesKeyboard("placement.rotate-clockwise", normalized, {
				context: "placement",
			})
		) {
			return Object.freeze({ kind: "rotate", quarterTurns: 1 });
		}
	}
	if (
		input.buildToolActive &&
		editorCommandMatchesKeyboard("construction.cycle-route", normalized, {
			context: "construction",
		})
	) {
		return Object.freeze({ kind: "cycle-bend" });
	}
	return null;
}

/** Resolve Q/E against the authored construction context, never the camera. */
export function resolveConstructionRotationIntent(
	context: ConstructionRotationContext,
	quarterTurns: -1 | 1,
): ConstructionRotationIntent {
	if (!context.buildToolActive) return Object.freeze({ kind: "unavailable" });
	if (context.templateActive) return Object.freeze({ kind: "rotate-template", quarterTurns });
	if (context.stampActive) return Object.freeze({ kind: "rotate-stamp", quarterTurns });
	if (context.controls.includes("side")) {
		return Object.freeze({ kind: "choose-side", side: quarterTurns < 0 ? "left" : "right" });
	}
	if (context.controls.includes("bend")) {
		return Object.freeze({
			kind: "choose-bend",
			bend: quarterTurns < 0 ? "horizontal-first" : "vertical-first",
		});
	}
	return Object.freeze({ kind: "unavailable" });
}
