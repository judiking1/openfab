export type EditorCommandGroup =
	| "construction"
	| "selection"
	| "blueprint"
	| "equipment"
	| "camera"
	| "project"
	| "workspace";

export type EditorCommandContext =
	| "global"
	| "canvas"
	| "construction"
	| "selection"
	| "placement"
	| "template"
	| "equipment-group-edit"
	| "equipment-membership-eq"
	| "equipment-membership-stk"
	| "arrangement"
	| "assembly-connector"
	| "organization-canvas";

export type EditorCommandGlyph =
	| "apply"
	| "blueprint"
	| "camera"
	| "cancel"
	| "clone"
	| "copy"
	| "cut"
	| "delete"
	| "flow"
	| "help"
	| "history"
	| "inspect"
	| "mouse"
	| "move"
	| "paste"
	| "rail"
	| "resize"
	| "rotate"
	| "save"
	| "select"
	| "tool";

export interface EditorKeyboardInput {
	readonly code: string;
	readonly repeat: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

export interface EditorKeyboardBinding {
	readonly kind: "keyboard";
	readonly codes: readonly string[];
	readonly primary?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
	readonly display: readonly string[];
}

export interface EditorPointerBinding {
	readonly kind: "pointer";
	readonly button: "left" | "middle" | "right";
	readonly gesture: "click" | "drag" | "wheel";
	readonly primary?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
	readonly display: readonly string[];
}

export type EditorCommandBinding = EditorKeyboardBinding | EditorPointerBinding;

export interface EditorCommandDescriptor<Id extends string = string> {
	readonly id: Id;
	readonly group: EditorCommandGroup;
	readonly contexts: readonly EditorCommandContext[];
	readonly label: string;
	readonly glyph: EditorCommandGlyph;
	readonly bindings: readonly EditorCommandBinding[];
	readonly repeat: "allow" | "once";
	readonly textInput: "allow" | "block";
	readonly keywords?: readonly string[];
}

export interface EditorCommandMatch {
	readonly command: EditorCommand;
	readonly binding: EditorKeyboardBinding;
}

export interface EditorCommandHintBinding {
	readonly inputs: readonly string[];
	readonly inputJoin: "plus" | "or";
	readonly pointer: boolean;
}

export interface EditorCommandCollision {
	readonly context: EditorCommandContext;
	readonly signature: string;
	readonly commandIds: readonly EditorCommandId[];
}

const key = (
	codes: string | readonly string[],
	display: readonly string[],
	modifiers: Readonly<{
		primary?: boolean;
		alt?: boolean;
		shift?: boolean;
	}> = {},
): EditorKeyboardBinding =>
	Object.freeze({
		kind: "keyboard",
		codes: Object.freeze(typeof codes === "string" ? [codes] : [...codes]),
		display: Object.freeze([...display]),
		...modifiers,
	});

const pointer = (
	button: EditorPointerBinding["button"],
	gesture: EditorPointerBinding["gesture"],
	display: string,
	modifiers: Readonly<{
		primary?: boolean;
		alt?: boolean;
		shift?: boolean;
	}> = {},
): EditorPointerBinding =>
	Object.freeze({
		kind: "pointer",
		button,
		gesture,
		display: Object.freeze([
			...(modifiers.primary ? ["⌘ / CTRL"] : []),
			...(modifiers.alt ? ["ALT/OPT"] : []),
			...(modifiers.shift ? ["SHIFT"] : []),
			display,
		]),
		...modifiers,
	});

const command = <const Id extends string>(
	descriptor: EditorCommandDescriptor<Id>,
): EditorCommandDescriptor<Id> =>
	Object.freeze({
		...descriptor,
		contexts: Object.freeze([...descriptor.contexts]),
		bindings: Object.freeze([...descriptor.bindings]),
		keywords: descriptor.keywords ? Object.freeze([...descriptor.keywords]) : undefined,
	});

const primaryDisplay = Object.freeze(["⌘ / CTRL"]);
const cameraCodes = Object.freeze({
	up: ["KeyW", "ArrowUp"],
	down: ["KeyS", "ArrowDown"],
	left: ["KeyA", "ArrowLeft"],
	right: ["KeyD", "ArrowRight"],
});

export const EDITOR_COMMAND_REGISTRY = Object.freeze([
	command({
		id: "help.open",
		group: "workspace",
		contexts: ["global"],
		label: "명령 검색",
		glyph: "help",
		bindings: [key("F1", ["F1"]), key("Slash", ["?"], { shift: true })],
		repeat: "once",
		textInput: "allow",
		keywords: ["help", "shortcut", "keyboard", "도움말", "단축키"],
	}),
	command({
		id: "command.cancel",
		group: "workspace",
		contexts: ["global"],
		label: "현재 명령 취소",
		glyph: "cancel",
		bindings: [key("Escape", ["ESC"]), pointer("right", "click", "RMB")],
		repeat: "once",
		textInput: "allow",
		keywords: ["cancel", "escape", "취소"],
	}),
	command({
		id: "project.save-context",
		group: "project",
		contexts: ["global"],
		label: "현재 컨텍스트 저장",
		glyph: "save",
		bindings: [key("KeyS", [...primaryDisplay, "S"], { primary: true })],
		repeat: "once",
		textInput: "allow",
		keywords: ["save", "blueprint", "project", "저장", "청사진"],
	}),
	command({
		id: "history.undo",
		group: "project",
		contexts: ["global"],
		label: "실행 취소",
		glyph: "history",
		bindings: [key("KeyZ", [...primaryDisplay, "Z"], { primary: true })],
		repeat: "once",
		textInput: "block",
		keywords: ["undo", "history"],
	}),
	command({
		id: "history.redo",
		group: "project",
		contexts: ["global"],
		label: "다시 실행",
		glyph: "history",
		bindings: [
			key("KeyZ", [...primaryDisplay, "SHIFT", "Z"], {
				primary: true,
				shift: true,
			}),
		],
		repeat: "once",
		textInput: "block",
		keywords: ["redo", "history"],
	}),
	command({
		id: "selection.copy",
		group: "selection",
		contexts: ["global"],
		label: "선택 복제",
		glyph: "copy",
		bindings: [key("KeyC", [...primaryDisplay, "C"], { primary: true })],
		repeat: "once",
		textInput: "block",
		keywords: ["copy", "clone", "clipboard", "복제"],
	}),
	command({
		id: "selection.cut",
		group: "selection",
		contexts: ["global"],
		label: "선택 잘라내기",
		glyph: "cut",
		bindings: [key("KeyX", [...primaryDisplay, "X"], { primary: true })],
		repeat: "once",
		textInput: "block",
		keywords: ["cut", "clipboard", "잘라내기"],
	}),
	command({
		id: "blueprint.paste-recent",
		group: "blueprint",
		contexts: ["global"],
		label: "최근 청사진 배치",
		glyph: "paste",
		bindings: [key("KeyV", [...primaryDisplay, "V"], { primary: true })],
		repeat: "once",
		textInput: "block",
		keywords: ["paste", "recent", "blueprint", "붙여넣기"],
	}),
	command({
		id: "selection.select-all",
		group: "selection",
		contexts: ["canvas"],
		label: "전체 정적 FAB 선택",
		glyph: "select",
		bindings: [key("KeyA", [...primaryDisplay, "A"], { primary: true })],
		repeat: "once",
		textInput: "block",
		keywords: ["select all", "factory", "전체 선택"],
	}),
	command({
		id: "blueprint.open-library",
		group: "blueprint",
		contexts: ["canvas", "construction", "selection", "placement", "template"],
		label: "청사진 라이브러리",
		glyph: "blueprint",
		bindings: [key("KeyB", ["B"])],
		repeat: "once",
		textInput: "block",
		keywords: ["blueprint", "library", "청사진", "라이브러리"],
	}),
	command({
		id: "selection.clone-hovered",
		group: "selection",
		contexts: ["canvas", "construction", "selection"],
		label: "호버 항목 복제",
		glyph: "clone",
		bindings: [key("KeyC", ["C"])],
		repeat: "once",
		textInput: "block",
		keywords: ["clone", "pipette", "hover", "복제"],
	}),
	command({
		id: "selection.connected",
		group: "selection",
		contexts: ["canvas", "construction", "selection"],
		label: "연결 구조 전체 선택",
		glyph: "select",
		bindings: [key("KeyO", ["O"])],
		repeat: "once",
		textInput: "block",
		keywords: ["connected", "network", "component", "연결"],
	}),
	command({
		id: "selection.delete",
		group: "selection",
		contexts: ["selection"],
		label: "선택 철거",
		glyph: "delete",
		bindings: [key(["Delete", "Backspace"], ["DELETE"])],
		repeat: "once",
		textInput: "block",
		keywords: ["delete", "bulldoze", "철거", "삭제"],
	}),
	command({
		id: "selection.toggle-pointer",
		group: "selection",
		contexts: ["selection", "canvas"],
		label: "항목 선택 전환",
		glyph: "select",
		bindings: [pointer("left", "click", "LMB", { primary: true })],
		repeat: "allow",
		textInput: "block",
		keywords: ["toggle", "selection", "선택"],
	}),
	command({
		id: "selection.add-area",
		group: "selection",
		contexts: ["selection", "canvas", "construction"],
		label: "영역 선택 추가",
		glyph: "select",
		bindings: [pointer("left", "drag", "LMB DRAG", { shift: true })],
		repeat: "allow",
		textInput: "block",
		keywords: ["area", "marquee", "add", "영역 선택"],
	}),
	command({
		id: "selection.subtract-area",
		group: "selection",
		contexts: ["selection"],
		label: "영역 선택 제외",
		glyph: "select",
		bindings: [pointer("left", "drag", "LMB DRAG", { alt: true, shift: true })],
		repeat: "allow",
		textInput: "block",
		keywords: ["area", "marquee", "subtract", "제외"],
	}),
	command({
		id: "canvas.primary-click",
		group: "workspace",
		contexts: [
			"canvas",
			"selection",
			"placement",
			"template",
			"equipment-group-edit",
			"equipment-membership-stk",
		],
		label: "가리킨 항목 적용",
		glyph: "mouse",
		bindings: [pointer("left", "click", "LMB")],
		repeat: "allow",
		textInput: "block",
		keywords: ["mouse", "click", "apply", "클릭"],
	}),
	command({
		id: "canvas.primary-drag",
		group: "construction",
		contexts: ["canvas", "construction", "equipment-membership-eq"],
		label: "현재 도구 드래그",
		glyph: "mouse",
		bindings: [pointer("left", "drag", "LMB DRAG")],
		repeat: "allow",
		textInput: "block",
		keywords: ["mouse", "drag", "build", "드래그"],
	}),
	command({
		id: "camera.pan-pointer",
		group: "camera",
		contexts: ["global"],
		label: "화면 이동",
		glyph: "camera",
		bindings: [pointer("right", "drag", "RMB DRAG"), pointer("middle", "drag", "MMB DRAG")],
		repeat: "allow",
		textInput: "block",
		keywords: ["pan", "camera", "move", "화면 이동"],
	}),
	command({
		id: "camera.pan-up",
		group: "camera",
		contexts: ["canvas"],
		label: "화면 위로 이동",
		glyph: "camera",
		bindings: [key(cameraCodes.up, ["W / ↑"])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "camera.pan-down",
		group: "camera",
		contexts: ["canvas"],
		label: "화면 아래로 이동",
		glyph: "camera",
		bindings: [key(cameraCodes.down, ["S / ↓"])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "camera.pan-left",
		group: "camera",
		contexts: ["canvas"],
		label: "화면 왼쪽으로 이동",
		glyph: "camera",
		bindings: [key(cameraCodes.left, ["A / ←"])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "camera.pan-right",
		group: "camera",
		contexts: ["canvas"],
		label: "화면 오른쪽으로 이동",
		glyph: "camera",
		bindings: [key(cameraCodes.right, ["D / →"])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "camera.pan-space",
		group: "camera",
		contexts: ["canvas"],
		label: "왼쪽 드래그 화면 이동",
		glyph: "camera",
		bindings: [key("Space", ["SPACE", "LMB DRAG"])],
		repeat: "allow",
		textInput: "block",
		keywords: ["pan", "space", "camera"],
	}),
	command({
		id: "blueprint.cycle-recent",
		group: "blueprint",
		contexts: ["canvas", "placement"],
		label: "최근 청사진 전환",
		glyph: "blueprint",
		bindings: [pointer("middle", "wheel", "WHEEL", { primary: true })],
		repeat: "allow",
		textInput: "block",
		keywords: ["recent", "wheel", "blueprint", "최근"],
	}),
	command({
		id: "organization.navigate",
		group: "selection",
		contexts: ["organization-canvas"],
		label: "Canvas FAB 조직 후보 이동",
		glyph: "move",
		bindings: [
			key(
				["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight", "Home", "End"],
				["← ↑ ↓ → / HOME / END"],
			),
		],
		repeat: "allow",
		textInput: "block",
		keywords: ["organization", "fab", "bank", "bay", "navigate", "조직", "후보"],
	}),
	command({
		id: "organization.select",
		group: "selection",
		contexts: ["organization-canvas"],
		label: "Canvas FAB 조직 선택",
		glyph: "select",
		bindings: [
			key(["Enter", "NumpadEnter", "Space"], ["ENTER / SPACE"]),
			key(["Enter", "NumpadEnter", "Space"], [...primaryDisplay, "ENTER / SPACE"], {
				primary: true,
			}),
			key(["Enter", "NumpadEnter", "Space"], ["SHIFT", "ENTER / SPACE"], {
				shift: true,
			}),
			key(["Enter", "NumpadEnter", "Space"], [...primaryDisplay, "SHIFT", "ENTER / SPACE"], {
				primary: true,
				shift: true,
			}),
		],
		repeat: "once",
		textInput: "block",
		keywords: ["organization", "fab", "bank", "bay", "select", "toggle", "조직", "선택"],
	}),
	command({
		id: "arrangement.start",
		group: "selection",
		contexts: ["selection"],
		label: "선택 정렬·간격 편집",
		glyph: "move",
		bindings: [key("KeyL", ["L"])],
		repeat: "once",
		textInput: "block",
		keywords: ["align", "distribute", "arrange", "정렬", "간격"],
	}),
	command({
		id: "assembly-connector.start",
		group: "construction",
		contexts: ["selection"],
		label: "선택한 조직 연결",
		glyph: "rail",
		bindings: [key("KeyJ", ["J"])],
		repeat: "once",
		textInput: "block",
		keywords: [
			"connect",
			"assembly",
			"gateway",
			"bay",
			"bank",
			"fab",
			"interbay",
			"organization",
			"연결",
			"게이트웨이",
			"조직",
		],
	}),
	command({
		id: "context.open",
		group: "workspace",
		contexts: ["canvas", "construction", "selection", "placement", "template"],
		label: "상황별 명령",
		glyph: "tool",
		bindings: [key("ContextMenu", ["MENU"]), key("F10", ["SHIFT", "F10"], { shift: true })],
		repeat: "once",
		textInput: "block",
		keywords: ["context", "menu", "command", "상황별"],
	}),
	command({
		id: "tool.inspect",
		group: "workspace",
		contexts: ["canvas"],
		label: "선택 도구",
		glyph: "inspect",
		bindings: [key("KeyV", ["V"])],
		repeat: "once",
		textInput: "block",
	}),
	command({
		id: "tool.erase",
		group: "workspace",
		contexts: ["canvas"],
		label: "철거 도구",
		glyph: "delete",
		bindings: [key("KeyX", ["X"])],
		repeat: "once",
		textInput: "block",
	}),
	command({
		id: "tool.stk",
		group: "equipment",
		contexts: ["canvas"],
		label: "STK 포트 도구",
		glyph: "tool",
		bindings: [key("KeyK", ["K"])],
		repeat: "once",
		textInput: "block",
	}),
	...(["route", "u-turn", "shift", "advanced-switch"] as const).map((name, index) =>
		command({
			id: `construction.quick-${name}` as const,
			group: "construction",
			contexts: ["canvas", "construction"],
			label: ["스마트 레일", "U턴", "시프트", "2×2 스위치"][index] as string,
			glyph: "rail",
			bindings: [key([`Digit${index + 1}`, `Numpad${index + 1}`], [String(index + 1)])],
			repeat: "once" as const,
			textInput: "block" as const,
			keywords: [name, "rail", "레일"],
		}),
	),
	...([5, 6, 7, 8, 9] as const).map((digit, index) =>
		command({
			id: `blueprint.favorite-${index + 1}` as const,
			group: "blueprint",
			contexts: ["canvas"],
			label: `프로젝트 즐겨찾기 ${index + 1}`,
			glyph: "blueprint",
			bindings: [key([`Digit${digit}`, `Numpad${digit}`], [String(digit)])],
			repeat: "once" as const,
			textInput: "block" as const,
			keywords: ["favorite", "quick slot", "즐겨찾기"],
		}),
	),
	...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((slot) =>
		command({
			id: `blueprint.user-slot-${slot}` as const,
			group: "blueprint",
			contexts: ["global"],
			label: `내 라이브러리 슬롯 ${slot}`,
			glyph: "blueprint",
			bindings: [
				key([`Digit${slot}`, `Numpad${slot}`], ["ALT/OPT", String(slot)], {
					alt: true,
				}),
			],
			repeat: "once" as const,
			textInput: "block" as const,
			keywords: ["library", "quick slot", "라이브러리", "슬롯"],
		}),
	),
	command({
		id: "placement.rotate-clockwise",
		group: "blueprint",
		contexts: ["placement", "template"],
		label: "시계 방향 회전",
		glyph: "rotate",
		bindings: [key("KeyR", ["R"]), key("KeyE", ["E"])],
		repeat: "once",
		textInput: "block",
		keywords: ["rotate", "clockwise", "회전"],
	}),
	command({
		id: "placement.rotate-counterclockwise",
		group: "blueprint",
		contexts: ["placement", "template"],
		label: "반시계 방향 회전",
		glyph: "rotate",
		bindings: [key("KeyR", ["SHIFT", "R"], { shift: true }), key("KeyQ", ["Q"])],
		repeat: "once",
		textInput: "block",
		keywords: ["rotate", "counterclockwise", "회전"],
	}),
	command({
		id: "construction.rotate-left",
		group: "construction",
		contexts: ["construction"],
		label: "왼쪽 방향·코너",
		glyph: "rotate",
		bindings: [key("KeyQ", ["Q"])],
		repeat: "once",
		textInput: "block",
	}),
	command({
		id: "construction.rotate-right",
		group: "construction",
		contexts: ["construction"],
		label: "오른쪽 방향·코너",
		glyph: "rotate",
		bindings: [key("KeyE", ["E"])],
		repeat: "once",
		textInput: "block",
	}),
	command({
		id: "construction.cycle-route",
		group: "construction",
		contexts: ["construction"],
		label: "스마트 경로 순서 전환",
		glyph: "rail",
		bindings: [key("KeyR", ["R"])],
		repeat: "once",
		textInput: "block",
		keywords: ["bend", "route", "alternative", "경로"],
	}),
	command({
		id: "placement.reverse-flow",
		group: "blueprint",
		contexts: ["placement", "template"],
		label: "진행 방향 반전",
		glyph: "flow",
		bindings: [key("KeyF", ["F"])],
		repeat: "once",
		textInput: "block",
		keywords: ["flow", "reverse", "direction", "방향 반전"],
	}),
	command({
		id: "template.resize-decrease",
		group: "construction",
		contexts: ["template"],
		label: "활성 치수 축소",
		glyph: "resize",
		bindings: [key("BracketLeft", ["["])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "template.resize-increase",
		group: "construction",
		contexts: ["template"],
		label: "활성 치수 확대",
		glyph: "resize",
		bindings: [key("BracketRight", ["]"])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "equipment.navigate",
		group: "equipment",
		contexts: ["equipment-group-edit", "equipment-membership-eq", "equipment-membership-stk"],
		label: "포트·장비 커서 이동",
		glyph: "move",
		bindings: [
			key(
				[...cameraCodes.up, ...cameraCodes.down, ...cameraCodes.left, ...cameraCodes.right],
				["WASD / ↑↓←→"],
			),
		],
		repeat: "allow",
		textInput: "block",
		keywords: ["port", "equipment", "navigate", "포트", "장비"],
	}),
	command({
		id: "equipment.switch-endpoint",
		group: "equipment",
		contexts: ["equipment-membership-eq"],
		label: "EQ 반대 끝점 선택",
		glyph: "move",
		bindings: [key(["KeyQ", "KeyE"], ["Q / E"])],
		repeat: "once",
		textInput: "block",
	}),
	command({
		id: "assembly-connector.cycle-side",
		group: "construction",
		contexts: ["assembly-connector"],
		label: "Bay 연결 측면 전환",
		glyph: "rotate",
		bindings: [key(["KeyQ", "KeyE"], ["Q / E"])],
		repeat: "once",
		textInput: "block",
		keywords: ["connector", "side", "left", "right", "연결", "측면"],
	}),
	command({
		id: "equipment.toggle-slot",
		group: "equipment",
		contexts: ["equipment-membership-stk"],
		label: "STK 포트 추가·제거",
		glyph: "apply",
		bindings: [key("Space", ["SPACE"])],
		repeat: "allow",
		textInput: "block",
	}),
	command({
		id: "command.apply",
		group: "workspace",
		contexts: [
			"arrangement",
			"assembly-connector",
			"equipment-group-edit",
			"equipment-membership-eq",
			"equipment-membership-stk",
		],
		label: "현재 명령 적용",
		glyph: "apply",
		bindings: [key(["Enter", "NumpadEnter"], ["ENTER"])],
		repeat: "once",
		textInput: "block",
	}),
]);

export type EditorCommand = (typeof EDITOR_COMMAND_REGISTRY)[number];
export type EditorCommandId = EditorCommand["id"];

const commandById = new Map<EditorCommandId, EditorCommand>(
	EDITOR_COMMAND_REGISTRY.map((descriptor) => [descriptor.id, descriptor]),
);

export function editorCommand(id: EditorCommandId): EditorCommand {
	const descriptor = commandById.get(id);
	if (!descriptor) throw new Error(`Unknown editor command: ${id}`);
	return descriptor;
}

export function editorCommandMatchesKeyboard(
	id: EditorCommandId,
	input: EditorKeyboardInput,
	options: Readonly<{
		context?: EditorCommandContext;
		textInput?: boolean;
	}> = {},
): boolean {
	const descriptor = editorCommand(id);
	if (!commandContextMatches(descriptor, options.context ?? "canvas")) return false;
	if (options.textInput && descriptor.textInput === "block") return false;
	if (input.repeat && descriptor.repeat === "once") return false;
	return descriptor.bindings.some(
		(binding) => binding.kind === "keyboard" && keyboardBindingMatches(binding, input),
	);
}

export function resolveEditorCommand(
	input: EditorKeyboardInput,
	context: EditorCommandContext,
	textInput = false,
): EditorCommandMatch | null {
	for (const descriptor of EDITOR_COMMAND_REGISTRY) {
		if (!commandContextMatches(descriptor, context)) continue;
		if (textInput && descriptor.textInput === "block") continue;
		if (input.repeat && descriptor.repeat === "once") continue;
		for (const binding of descriptor.bindings) {
			if (binding.kind !== "keyboard" || !keyboardBindingMatches(binding, input)) continue;
			return Object.freeze({ command: descriptor, binding });
		}
	}
	return null;
}

export function editorCommandHintBinding(
	id: EditorCommandId,
	options: Readonly<{
		bindingIndex?: number;
		includeAllBindings?: boolean;
	}> = {},
): EditorCommandHintBinding {
	const bindings = editorCommand(id).bindings;
	if (bindings.length === 0) {
		return Object.freeze({
			inputs: Object.freeze([]),
			inputJoin: "plus",
			pointer: false,
		});
	}
	if (options.includeAllBindings) {
		return Object.freeze({
			inputs: Object.freeze(bindings.map((binding) => binding.display.join(" + "))),
			inputJoin: "or",
			pointer: bindings.some((binding) => binding.kind === "pointer"),
		});
	}
	const binding = bindings[options.bindingIndex ?? 0] ?? bindings[0];
	if (!binding) throw new Error(`Editor command ${id} has no display binding.`);
	return Object.freeze({
		inputs: binding.display,
		inputJoin: "plus",
		pointer: binding.kind === "pointer",
	});
}

export function editorCommandAriaKeyShortcuts(ids: readonly EditorCommandId[]): string | undefined {
	const shortcuts = new Set<string>();
	for (const id of ids) {
		for (const binding of editorCommand(id).bindings) {
			if (binding.kind !== "keyboard") continue;
			for (const shortcut of keyboardBindingAriaShortcuts(binding)) shortcuts.add(shortcut);
		}
	}
	return shortcuts.size > 0 ? [...shortcuts].join(" ") : undefined;
}

export function searchEditorCommands(query: string): readonly EditorCommand[] {
	const normalized = normalizeSearchText(query);
	if (!normalized) return EDITOR_COMMAND_REGISTRY;
	return Object.freeze(
		EDITOR_COMMAND_REGISTRY.filter((descriptor) =>
			commandSearchText(descriptor).includes(normalized),
		),
	);
}

export function inspectEditorCommandCollisions(): readonly EditorCommandCollision[] {
	const collisions: EditorCommandCollision[] = [];
	for (const context of EDITOR_COMMAND_CONTEXTS) {
		const signatures = new Map<string, EditorCommandId[]>();
		for (const descriptor of EDITOR_COMMAND_REGISTRY) {
			if (!commandContextMatches(descriptor, context)) continue;
			for (const binding of descriptor.bindings) {
				for (const signature of commandBindingSignatures(binding)) {
					const ids = signatures.get(signature);
					if (ids) ids.push(descriptor.id);
					else signatures.set(signature, [descriptor.id]);
				}
			}
		}
		for (const [signature, ids] of signatures) {
			const uniqueIds = [...new Set(ids)];
			if (uniqueIds.length < 2) continue;
			collisions.push(
				Object.freeze({
					context,
					signature,
					commandIds: Object.freeze(uniqueIds),
				}),
			);
		}
	}
	return Object.freeze(collisions);
}

const EDITOR_COMMAND_CONTEXTS: readonly EditorCommandContext[] = Object.freeze([
	"canvas",
	"construction",
	"selection",
	"placement",
	"template",
	"equipment-group-edit",
	"equipment-membership-eq",
	"equipment-membership-stk",
	"arrangement",
	"assembly-connector",
	"organization-canvas",
]);

function commandContextMatches(
	descriptor: EditorCommandDescriptor,
	context: EditorCommandContext,
): boolean {
	return descriptor.contexts.includes("global") || descriptor.contexts.includes(context);
}

function keyboardBindingMatches(
	binding: EditorKeyboardBinding,
	input: EditorKeyboardInput,
): boolean {
	return (
		binding.codes.includes(input.code) &&
		(input.ctrlKey || input.metaKey) === (binding.primary ?? false) &&
		input.altKey === (binding.alt ?? false) &&
		input.shiftKey === (binding.shift ?? false)
	);
}

function keyboardBindingAriaShortcuts(binding: EditorKeyboardBinding): readonly string[] {
	const prefixes: string[][] = [[]];
	if (binding.primary) {
		prefixes.splice(0, 1, ["Control"], ["Meta"]);
	}
	for (const prefix of prefixes) {
		if (binding.alt) prefix.push("Alt");
		if (binding.shift) prefix.push("Shift");
	}
	const shortcuts: string[] = [];
	for (const code of binding.codes) {
		const keyName = ariaKeyName(code);
		for (const prefix of prefixes) shortcuts.push([...prefix, keyName].join("+"));
	}
	return Object.freeze(shortcuts);
}

function ariaKeyName(code: string): string {
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return code;
	if (code === "BracketLeft") return "[";
	if (code === "BracketRight") return "]";
	if (code === "Slash") return "/";
	return code;
}

function commandBindingSignatures(binding: EditorCommandBinding): readonly string[] {
	const modifiers = `p${Number(binding.primary ?? false)}a${Number(binding.alt ?? false)}s${Number(binding.shift ?? false)}`;
	if (binding.kind === "pointer") {
		return Object.freeze([`pointer:${binding.button}:${binding.gesture}:${modifiers}`]);
	}
	return Object.freeze(binding.codes.map((code) => `keyboard:${code}:${modifiers}`));
}

function commandSearchText(descriptor: EditorCommand): string {
	return normalizeSearchText(
		[
			descriptor.id,
			descriptor.group,
			descriptor.label,
			...(descriptor.keywords ?? []),
			...descriptor.bindings.flatMap((binding) => binding.display),
		].join(" "),
	);
}

function normalizeSearchText(value: string): string {
	return value
		.normalize("NFKC")
		.trim()
		.toLocaleLowerCase()
		.replace(/[+/.\\_-]+/g, " ")
		.replace(/\s+/g, " ");
}
