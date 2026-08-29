import type { EditorCommandHintBinding, EditorCommandId } from "./EditorCommandRegistry";

/**
 * Guided Build must teach a viable input before the user knows the editor. Keep the registry as the
 * exact mouse/keyboard contract, then name its already-supported touch or visible-button equivalent
 * only in this coaching surface.
 */
export function guidedBuildInputHint(
	commandId: EditorCommandId,
	registryHint: EditorCommandHintBinding,
): EditorCommandHintBinding {
	const alternatives = (() => {
		switch (commandId) {
			case "camera.pan-pointer":
				return ["TOUCH DRAG", "RMB / MMB DRAG", "WASD / ←↑↓→"];
			case "canvas.primary-click":
				return ["TOUCH", "LMB"];
			case "canvas.primary-drag":
				return ["TOUCH DRAG", "LMB DRAG"];
			case "organization.select":
				return ["TAP", "ENTER / SPACE"];
			case "command.apply":
				return ["적용 버튼", "ENTER"];
			default:
				return null;
		}
	})();
	if (alternatives === null) return registryHint;
	return Object.freeze({
		inputs: Object.freeze(alternatives),
		inputJoin: "or",
		pointer: true,
	});
}
