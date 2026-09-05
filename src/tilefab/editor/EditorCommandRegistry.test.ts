import { describe, expect, it } from "vitest";
import {
	EDITOR_COMMAND_REGISTRY,
	editorCommandAriaKeyShortcuts,
	editorCommandHintBinding,
	editorCommandMatchesKeyboard,
	inspectEditorCommandCollisions,
	resolveEditorCommand,
	searchEditorCommands,
} from "./EditorCommandRegistry";

const keyboard = (
	code: string,
	overrides: Partial<{
		repeat: boolean;
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
	}> = {},
) => ({
	code,
	repeat: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...overrides,
});

describe("EditorCommandRegistry", () => {
	it("owns unique stable command ids without context-local binding collisions", () => {
		const ids = EDITOR_COMMAND_REGISTRY.map((command) => command.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(inspectEditorCommandCollisions()).toEqual([]);
		expect(
			EDITOR_COMMAND_REGISTRY.find((command) => command.id === "assembly-connector.start")?.label,
		).toBe("선택한 조직 연결");
	});

	it("resolves platform-primary commands with exact modifiers", () => {
		expect(resolveEditorCommand(keyboard("KeyS", { ctrlKey: true }), "canvas")?.command.id).toBe(
			"project.save-context",
		);
		expect(resolveEditorCommand(keyboard("KeyS", { metaKey: true }), "canvas")?.command.id).toBe(
			"project.save-context",
		);
		expect(
			resolveEditorCommand(keyboard("KeyS", { ctrlKey: true, shiftKey: true }), "canvas"),
		).toBeNull();
	});

	it("keeps contextual R, Q, E, and navigation commands disjoint", () => {
		expect(resolveEditorCommand(keyboard("KeyR"), "construction")?.command.id).toBe(
			"construction.cycle-route",
		);
		expect(resolveEditorCommand(keyboard("KeyR"), "placement")?.command.id).toBe(
			"placement.rotate-clockwise",
		);
		expect(
			resolveEditorCommand(keyboard("KeyR", { shiftKey: true }), "placement")?.command.id,
		).toBe("placement.rotate-counterclockwise");
		expect(resolveEditorCommand(keyboard("KeyQ"), "construction")?.command.id).toBe(
			"construction.rotate-left",
		);
		expect(resolveEditorCommand(keyboard("KeyQ"), "equipment-membership-eq")?.command.id).toBe(
			"equipment.switch-endpoint",
		);
		expect(resolveEditorCommand(keyboard("KeyQ"), "assembly-connector")?.command.id).toBe(
			"assembly-connector.cycle-side",
		);
		expect(resolveEditorCommand(keyboard("KeyJ"), "selection")?.command.id).toBe(
			"assembly-connector.start",
		);
		expect(resolveEditorCommand(keyboard("Enter"), "assembly-connector")?.command.id).toBe(
			"command.apply",
		);
		expect(resolveEditorCommand(keyboard("ArrowUp"), "canvas")?.command.id).toBe("camera.pan-up");
		expect(resolveEditorCommand(keyboard("ArrowUp"), "rail-keyboard")?.command.id).toBe(
			"construction.endpoint-navigate",
		);
		expect(
			resolveEditorCommand(keyboard("ArrowRight", { shiftKey: true }), "rail-keyboard")?.command.id,
		).toBe("construction.endpoint-navigate");
		expect(resolveEditorCommand(keyboard("Enter"), "rail-keyboard")?.command.id).toBe(
			"command.apply",
		);
		expect(resolveEditorCommand(keyboard("ArrowLeft"), "placement")?.command.id).toBe(
			"placement.navigate",
		);
		expect(resolveEditorCommand(keyboard("KeyD"), "placement")?.command.id).toBe(
			"placement.navigate",
		);
		expect(resolveEditorCommand(keyboard("Enter"), "placement")?.command.id).toBe(
			"placement.apply",
		);
		expect(resolveEditorCommand(keyboard("Space"), "placement")?.command.id).toBe(
			"placement.apply",
		);
		expect(
			resolveEditorCommand(keyboard("Enter", { shiftKey: true }), "placement")?.command.id,
		).toBe("placement.apply");
		expect(
			resolveEditorCommand(keyboard("Space", { shiftKey: true }), "placement")?.command.id,
		).toBe("placement.apply");
		expect(resolveEditorCommand(keyboard("ArrowRight"), "guided-port-keyboard")?.command.id).toBe(
			"equipment.navigate",
		);
		expect(resolveEditorCommand(keyboard("Enter"), "guided-port-keyboard")?.command.id).toBe(
			"command.apply",
		);
		expect(
			resolveEditorCommand(keyboard("Enter", { shiftKey: true }), "guided-port-keyboard")?.command
				.id,
		).toBe("equipment.complete-stk");
		expect(resolveEditorCommand(keyboard("ArrowLeft"), "inspect-area-keyboard")?.command.id).toBe(
			"selection.area-navigate",
		);
		expect(resolveEditorCommand(keyboard("KeyD"), "inspect-area-keyboard")?.command.id).toBe(
			"selection.area-navigate",
		);
		expect(resolveEditorCommand(keyboard("Enter"), "inspect-area-keyboard")?.command.id).toBe(
			"command.apply",
		);
		expect(resolveEditorCommand(keyboard("ArrowUp"), "equipment-membership-stk")?.command.id).toBe(
			"equipment.navigate",
		);
		expect(resolveEditorCommand(keyboard("ArrowRight"), "organization-canvas")?.command.id).toBe(
			"organization.navigate",
		);
		expect(resolveEditorCommand(keyboard("Enter"), "organization-canvas")?.command.id).toBe(
			"organization.select",
		);
		expect(
			resolveEditorCommand(keyboard("Enter", { ctrlKey: true }), "organization-canvas")?.command.id,
		).toBe("organization.select");
	});

	it("applies repeat and text-input guards from command metadata", () => {
		expect(
			editorCommandMatchesKeyboard("blueprint.open-library", keyboard("KeyB", { repeat: true })),
		).toBe(false);
		expect(editorCommandMatchesKeyboard("camera.pan-up", keyboard("KeyW", { repeat: true }))).toBe(
			true,
		);
		expect(
			editorCommandMatchesKeyboard("placement.reverse-flow", keyboard("KeyF"), {
				context: "placement",
			}),
		).toBe(true);
		expect(
			editorCommandMatchesKeyboard("placement.reverse-flow", keyboard("KeyF", { shiftKey: true }), {
				context: "placement",
			}),
		).toBe(false);
		expect(
			editorCommandMatchesKeyboard("selection.copy", keyboard("KeyC", { ctrlKey: true }), {
				textInput: true,
			}),
		).toBe(false);
		expect(
			editorCommandMatchesKeyboard("project.save-context", keyboard("KeyS", { ctrlKey: true }), {
				textInput: true,
			}),
		).toBe(true);
		expect(
			editorCommandMatchesKeyboard("help.open", keyboard("F1"), {
				textInput: true,
			}),
		).toBe(true);
	});

	it("derives accessible keyboard declarations and compact action hints", () => {
		expect(editorCommandAriaKeyShortcuts(["project.save-context"])).toBe("Control+S Meta+S");
		expect(editorCommandAriaKeyShortcuts(["help.open"])).toBe("F1 Shift+/");
		expect(editorCommandAriaKeyShortcuts(["placement.navigate", "placement.apply"])).toBe(
			"W ArrowUp S ArrowDown A ArrowLeft D ArrowRight Enter NumpadEnter Space Shift+Enter Shift+NumpadEnter Shift+Space",
		);
		expect(editorCommandAriaKeyShortcuts(["equipment.complete-stk"])).toBe(
			"Shift+Enter Shift+NumpadEnter",
		);
		expect(editorCommandAriaKeyShortcuts(["camera.pan-pointer"])).toBeUndefined();
		expect(editorCommandHintBinding("selection.copy")).toEqual({
			inputs: ["⌘ / CTRL", "C"],
			inputJoin: "plus",
			pointer: false,
		});
		expect(editorCommandHintBinding("command.cancel", { includeAllBindings: true })).toEqual({
			inputs: ["ESC", "RMB"],
			inputJoin: "or",
			pointer: true,
		});
	});

	it("searches by localized name, command key, shortcut, and group", () => {
		expect(
			searchEditorCommands("청사진").some((command) => command.id === "blueprint.open-library"),
		).toBe(true);
		expect(searchEditorCommands("F1").map((command) => command.id)).toContain("help.open");
		expect(searchEditorCommands("Ctrl+C").map((command) => command.id)).toContain("selection.copy");
		expect(searchEditorCommands("ALT/OPT 3").map((command) => command.id)).toContain(
			"blueprint.user-slot-3",
		);
		expect(
			searchEditorCommands("camera").every(
				(command) => command.group === "camera" || command.keywords?.includes("camera"),
			),
		).toBe(true);
	});
});
