import {
	Camera,
	FolderCog,
	Keyboard,
	LibraryBig,
	MousePointer2,
	Search,
	SquareDashedMousePointer,
	TrainTrack,
	Warehouse,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	EDITOR_COMMAND_REGISTRY,
	type EditorCommand,
	type EditorCommandGroup,
	searchEditorCommands,
} from "./EditorCommandRegistry";
import { EditorInputCue } from "./EditorInputCue";
import "./EditorCommandHelpDialog.css";

const COMMAND_GROUP_ORDER = Object.freeze([
	"construction",
	"selection",
	"blueprint",
	"equipment",
	"camera",
	"project",
	"workspace",
] satisfies readonly EditorCommandGroup[]);

const COMMAND_GROUP_LABELS = Object.freeze({
	construction: "레일 건설",
	selection: "선택·편집",
	blueprint: "청사진",
	equipment: "장비·포트",
	camera: "화면 이동",
	project: "프로젝트",
	workspace: "작업 공간",
} satisfies Readonly<Record<EditorCommandGroup, string>>);

export interface EditorCommandHelpDialogProps {
	readonly open: boolean;
	readonly onClose: () => void;
}

export function EditorCommandHelpDialog({
	open,
	onClose,
}: EditorCommandHelpDialogProps): React.ReactElement | null {
	const dialogRef = useRef<HTMLElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const matchingCommands = useMemo(() => searchEditorCommands(query), [query]);
	const groupedCommands = useMemo(
		() =>
			COMMAND_GROUP_ORDER.map((group) => ({
				group,
				commands: matchingCommands.filter((command) => command.group === group),
			})).filter((entry) => entry.commands.length > 0),
		[matchingCommands],
	);
	const closeDialog = (): void => {
		setQuery("");
		onClose();
	};

	useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		const closeOnEscape = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setQuery("");
			onClose();
		};
		document.addEventListener("keydown", closeOnEscape, { capture: true });
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", closeOnEscape, { capture: true });
		};
	}, [onClose, open]);

	if (!open) return null;

	return createPortal(
		<div
			className="tilefab-command-help-backdrop"
			role="presentation"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) closeDialog();
			}}
		>
			<section
				ref={dialogRef}
				className="tilefab-command-help"
				role="dialog"
				aria-modal="true"
				aria-labelledby="tilefab-command-help-title"
				aria-describedby="tilefab-command-help-count"
				data-testid="editor-command-help"
				onKeyDown={(event) => {
					if (event.key === "Tab") trapDialogFocus(event, dialogRef.current);
				}}
			>
				<header>
					<span className="tilefab-command-help-mark" aria-hidden="true">
						<Keyboard size={19} />
					</span>
					<span>
						<small>COMMAND REGISTRY</small>
						<strong id="tilefab-command-help-title">명령·단축키</strong>
					</span>
					<button type="button" aria-label="명령 도움말 닫기" onClick={closeDialog}>
						<X size={18} />
					</button>
				</header>

				<label className="tilefab-command-help-search">
					<Search size={16} aria-hidden="true" />
					<input
						ref={searchRef}
						type="search"
						value={query}
						autoComplete="off"
						spellCheck={false}
						placeholder="명령 또는 키 검색"
						aria-label="명령 또는 단축키 검색"
						onChange={(event) => setQuery(event.target.value)}
					/>
					<kbd>F1</kbd>
				</label>

				<div
					className="tilefab-command-help-summary"
					id="tilefab-command-help-count"
					aria-live="polite"
				>
					<strong className="tilefab-command-help-summary-value">{matchingCommands.length}</strong>
					<span>/ {EDITOR_COMMAND_REGISTRY.length} COMMANDS</span>
				</div>

				<div className="tilefab-command-help-results" data-empty={matchingCommands.length === 0}>
					{groupedCommands.map(({ group, commands }) => (
						<section key={group} data-command-group={group}>
							<header>
								{commandGroupIcon(group)}
								<strong>{COMMAND_GROUP_LABELS[group]}</strong>
								<span>{commands.length}</span>
							</header>
							<ul>
								{commands.map((command) => (
									<CommandHelpRow key={command.id} command={command} />
								))}
							</ul>
						</section>
					))}
					{matchingCommands.length === 0 ? (
						<div className="tilefab-command-help-empty">
							<Search size={22} aria-hidden="true" />
							<strong className="tilefab-command-help-empty-title">일치하는 명령 없음</strong>
						</div>
					) : null}
				</div>
			</section>
		</div>,
		document.body,
	);
}

function CommandHelpRow({ command }: { readonly command: EditorCommand }): React.ReactElement {
	return (
		<li data-command-id={command.id}>
			<span>
				<strong>{command.label}</strong>
				<small>
					{command.contexts.includes("global")
						? "GLOBAL"
						: command.contexts.join(" · ").toUpperCase()}
				</small>
			</span>
			<fieldset aria-label={`${command.label} 입력`}>
				{command.bindings.map((binding, bindingIndex) => (
					<span
						className="tilefab-command-help-binding"
						key={`${binding.kind}:${binding.display.join("+")}`}
					>
						{bindingIndex > 0 ? <i>OR</i> : null}
						{binding.display.map((input, inputIndex) => (
							<span className="tilefab-command-help-binding-part" key={input}>
								{inputIndex > 0 ? <i>+</i> : null}
								<EditorInputCue input={input} />
							</span>
						))}
					</span>
				))}
			</fieldset>
		</li>
	);
}

function commandGroupIcon(group: EditorCommandGroup): React.ReactElement {
	if (group === "construction") return <TrainTrack size={14} aria-hidden="true" />;
	if (group === "selection") return <SquareDashedMousePointer size={14} aria-hidden="true" />;
	if (group === "blueprint") return <LibraryBig size={14} aria-hidden="true" />;
	if (group === "equipment") return <Warehouse size={14} aria-hidden="true" />;
	if (group === "camera") return <Camera size={14} aria-hidden="true" />;
	if (group === "project") return <FolderCog size={14} aria-hidden="true" />;
	return <MousePointer2 size={14} aria-hidden="true" />;
}

function trapDialogFocus(
	event: React.KeyboardEvent<HTMLElement>,
	dialog: HTMLElement | null,
): void {
	if (!dialog) return;
	const controls = [
		...dialog.querySelectorAll<HTMLElement>(
			"button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
		),
	].filter((element) => !element.hidden);
	if (controls.length === 0) return;
	const first = controls[0];
	const last = controls[controls.length - 1];
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last?.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first?.focus();
	}
}
