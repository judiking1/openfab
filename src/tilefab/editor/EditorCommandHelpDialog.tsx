import {
	Camera,
	ChevronDown,
	FolderCog,
	GraduationCap,
	Keyboard,
	LibraryBig,
	MapPinned,
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
import type { EditorHelpContext } from "./EditorHelpContext";
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
	readonly guidedBuild?: Readonly<{
		readonly mode: "active" | "paused" | "available";
		readonly currentSequence: number;
		readonly missionCount: number;
		readonly currentTitle: string;
		readonly currentChapterLabel: string;
	}>;
	readonly context?: EditorHelpContext;
	readonly onClose: () => void;
	readonly onOpenGuidedBuild?: () => void;
	readonly onReturnToContext?: () => void;
}

export function EditorCommandHelpDialog({
	open,
	guidedBuild,
	context,
	onClose,
	onOpenGuidedBuild,
	onReturnToContext,
}: EditorCommandHelpDialogProps): React.ReactElement | null {
	const dialogRef = useRef<HTMLElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const introRef = useRef<HTMLElement>(null);
	const [query, setQuery] = useState("");
	const [commandCatalogExpanded, setCommandCatalogExpanded] = useState(false);
	const [introHasMore, setIntroHasMore] = useState(false);
	const taskGuidanceAvailable = Boolean(context || (guidedBuild && onOpenGuidedBuild));
	const showCommandCatalog = !taskGuidanceAvailable || commandCatalogExpanded;
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
		setCommandCatalogExpanded(false);
		setIntroHasMore(false);
		onClose();
	};

	useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() => {
			if (showCommandCatalog) searchRef.current?.focus();
			else dialogRef.current?.focus();
		});
		const closeOnEscape = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setQuery("");
			setCommandCatalogExpanded(false);
			setIntroHasMore(false);
			onClose();
		};
		document.addEventListener("keydown", closeOnEscape, { capture: true });
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", closeOnEscape, { capture: true });
		};
	}, [onClose, open, showCommandCatalog]);

	useEffect(() => {
		if (!open || !taskGuidanceAvailable) return;
		const intro = introRef.current;
		if (!intro) return;
		intro.scrollTop = 0;
		const updateContinuation = (): void => {
			const hasMore = intro.scrollHeight - intro.clientHeight - intro.scrollTop > 1;
			setIntroHasMore(hasMore);
		};
		const frame = requestAnimationFrame(updateContinuation);
		const observer = new ResizeObserver(updateContinuation);
		observer.observe(intro);
		intro.addEventListener("scroll", updateContinuation, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			intro.removeEventListener("scroll", updateContinuation);
		};
	}, [open, taskGuidanceAvailable]);

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
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby="tilefab-command-help-title"
				aria-describedby={
					showCommandCatalog
						? "tilefab-command-help-count"
						: context
							? "tilefab-command-help-context-summary"
							: undefined
				}
				data-testid="editor-command-help"
				data-command-catalog-expanded={showCommandCatalog}
				onKeyDown={(event) => {
					if (event.key === "Tab") trapDialogFocus(event, dialogRef.current);
				}}
			>
				<header>
					<span className="tilefab-command-help-mark" aria-hidden="true">
						<Keyboard size={19} />
					</span>
					<span>
						<small>OPENFAB HELP</small>
						<strong id="tilefab-command-help-title">도움말·가이드</strong>
					</span>
					<button type="button" aria-label="도움말·가이드 닫기" onClick={closeDialog}>
						<X size={18} />
					</button>
				</header>

				{context || (guidedBuild && onOpenGuidedBuild) ? (
					<div className="tilefab-command-help-intro-shell">
						<section
							ref={introRef}
							className="tilefab-command-help-intro"
							id="tilefab-command-help-intro"
							aria-label="현재 작업 도움말"
						>
							{guidedBuild && onOpenGuidedBuild ? (
								<section className="tilefab-command-help-guided" data-mode={guidedBuild.mode}>
									<span aria-hidden="true">
										<GraduationCap size={18} />
									</span>
									<p>
										<strong>
											{guidedBuild.mode === "active"
												? "Guided Build가 열려 있습니다"
												: guidedBuild.mode === "paused"
													? "Guided Build를 계속할 수 있습니다"
													: "처음이라면 Guided Build로 시작하세요"}
										</strong>
										<small>
											{guidedBuild.currentChapterLabel} · {guidedBuild.currentSequence} /{" "}
											{guidedBuild.missionCount} · {guidedBuild.currentTitle}
										</small>
									</p>
									<button
										type="button"
										onClick={() => {
											closeDialog();
											onOpenGuidedBuild();
										}}
									>
										{guidedBuild.mode === "active"
											? "현재 단계 보기"
											: guidedBuild.mode === "paused"
												? "가이드 계속하기"
												: "가이드 시작하기"}
									</button>
								</section>
							) : null}
							{context ? (
								<section className="tilefab-command-help-context" data-testid="editor-help-context">
									<header>
										<span aria-hidden="true">
											<MapPinned size={18} />
										</span>
										<p>
											<small>{context.eyebrow}</small>
											<strong>{context.title}</strong>
										</p>
										{onReturnToContext ? (
											<button
												type="button"
												onClick={() => {
													setQuery("");
													onReturnToContext();
												}}
											>
												{context.returnLabel}
											</button>
										) : null}
									</header>
									<p
										id="tilefab-command-help-context-summary"
										className="tilefab-command-help-context-summary"
									>
										{context.summary}
									</p>
									<ol>
										{context.steps.map((step) => (
											<li key={step.label}>
												<strong>{step.label}</strong>
												<span>{step.description}</span>
											</li>
										))}
									</ol>
								</section>
							) : null}
						</section>
						<button
							type="button"
							className="tilefab-command-help-scroll-cue"
							data-testid="editor-help-scroll-cue"
							aria-controls="tilefab-command-help-intro"
							aria-label="도움말 아래 내용 보기"
							hidden={!introHasMore}
							onClick={() => {
								const intro = introRef.current;
								if (!intro) return;
								intro.scrollBy({
									top: Math.max(120, intro.clientHeight * 0.8),
									behavior: "auto",
								});
							}}
						>
							<span>아래 내용 계속 보기</span>
							<ChevronDown size={16} aria-hidden="true" />
						</button>
					</div>
				) : null}

				{showCommandCatalog ? (
					<>
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
							<strong className="tilefab-command-help-summary-value">
								{matchingCommands.length}
							</strong>
							<span>/ {EDITOR_COMMAND_REGISTRY.length} COMMANDS</span>
						</div>

						<div
							className="tilefab-command-help-results"
							data-empty={matchingCommands.length === 0}
						>
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
					</>
				) : (
					<div className="tilefab-command-help-catalog-gate">
						<span>
							<strong>먼저 현재 작업을 확인하세요</strong>
							<small>
								가이드와 현재 Activity 사용법을 확인한 뒤, 필요할 때만 전체 명령을 펼치세요.
							</small>
						</span>
						<button type="button" onClick={() => setCommandCatalogExpanded(true)}>
							전체 명령·단축키 보기
						</button>
					</div>
				)}
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
