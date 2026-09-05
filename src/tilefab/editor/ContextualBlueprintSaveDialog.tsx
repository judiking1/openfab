import { Bookmark, FolderOpen, LibraryBig, Save, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
	CONTEXTUAL_BLUEPRINT_QUICK_SLOTS,
	type ContextualBlueprintQuickSlot,
	type ContextualBlueprintSaveDestination,
	type ContextualBlueprintSaveDraft,
	type ContextualBlueprintSaveSourceSummary,
	type ContextualBlueprintSaveValidation,
	normalizeContextualBlueprintFolder,
	normalizeContextualBlueprintName,
} from "./ContextualBlueprintSave";
import "./ContextualBlueprintSaveDialog.css";

export interface ContextualBlueprintSaveDialogProps {
	readonly source: ContextualBlueprintSaveSourceSummary;
	readonly draft: ContextualBlueprintSaveDraft;
	readonly validation: ContextualBlueprintSaveValidation;
	readonly occupiedQuickSlots: ReadonlyMap<number, string>;
	readonly busy: boolean;
	readonly storageError: string | null;
	readonly onName: (name: string) => void;
	readonly onFolder: (folder: string) => void;
	readonly onDestination: (destination: ContextualBlueprintSaveDestination) => void;
	readonly onQuickSlot: (quickSlot: ContextualBlueprintQuickSlot | null) => void;
	readonly onCancel: () => void;
	readonly onSave: () => void;
}

export function ContextualBlueprintSaveDialog({
	source,
	draft,
	validation,
	occupiedQuickSlots,
	busy,
	storageError,
	onName,
	onFolder,
	onDestination,
	onQuickSlot,
	onCancel,
	onSave,
}: ContextualBlueprintSaveDialogProps) {
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const dialogRef = useRef<HTMLElement | null>(null);
	const nameRef = useRef<HTMLInputElement | null>(null);
	const folderRef = useRef<HTMLInputElement | null>(null);
	const quickSlotsRef = useRef<HTMLFieldSetElement | null>(null);
	const errorRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		nameRef.current?.focus({ preventScroll: true });
		nameRef.current?.select();
		const backdrop = backdropRef.current;
		if (!backdrop) return;
		const background = [...document.body.children].filter(
			(element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
		);
		const backgroundState = background.map((element) => ({
			element,
			inert: element.inert,
			ariaHidden: element.getAttribute("aria-hidden"),
		}));
		for (const { element } of backgroundState) {
			element.inert = true;
			element.setAttribute("aria-hidden", "true");
		}
		return () => {
			for (const { element, inert, ariaHidden } of backgroundState) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
		};
	}, []);

	useEffect(() => {
		if (!storageError) return;
		const frame = requestAnimationFrame(() => errorRef.current?.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(frame);
	}, [storageError]);

	const focusValidationIssue = (): void => {
		if (validation.valid) return;
		if (validation.field === "name") nameRef.current?.focus({ preventScroll: true });
		else if (validation.field === "folder") folderRef.current?.focus({ preventScroll: true });
		else {
			quickSlotsRef.current
				?.querySelector<HTMLButtonElement>("button:not(:disabled)")
				?.focus({ preventScroll: true });
		}
	};

	const submit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (busy) return;
		if (!validation.valid) {
			focusValidationIssue();
			return;
		}
		onSave();
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
			if (!busy) onCancel();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
			if (busy) return;
			if (validation.valid) onSave();
			else focusValidationIssue();
			return;
		}
		if (event.key !== "Tab") return;
		trapTabNavigation(event, dialogRef.current);
	};

	const issue = storageError ?? (validation.valid ? null : validation.reason);
	const sourceKind = sourceKindLabel(source.kind);
	return createPortal(
		<div ref={backdropRef} className="tilefab-contextual-save-backdrop" role="presentation">
			<section
				ref={dialogRef}
				className="tilefab-contextual-blueprint-save"
				role="dialog"
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby="tilefab-contextual-save-title"
				aria-describedby="tilefab-contextual-save-summary tilefab-contextual-save-project-note"
				aria-busy={busy}
				data-testid="contextual-blueprint-save-dialog"
				data-source-kind={source.kind}
				data-destination={draft.destination}
				onKeyDown={handleKeyDown}
			>
				<header>
					<span className="tilefab-contextual-save-heading-icon" aria-hidden="true">
						<Save size={17} />
					</span>
					<div className="tilefab-contextual-save-title">
						<small>{sourceKind}</small>
						<strong id="tilefab-contextual-save-title">SAVE BLUEPRINT</strong>
					</div>
					<button type="button" aria-label="청사진 저장 취소" disabled={busy} onClick={onCancel}>
						<X size={16} />
					</button>
				</header>

				<div id="tilefab-contextual-save-summary" className="tilefab-contextual-save-summary">
					<strong className="tilefab-contextual-save-summary-name">{source.label}</strong>
					<span className="tilefab-contextual-save-summary-metrics">
						{source.moduleCount.toLocaleString()} MODULES · {source.edgeCount.toLocaleString()}{" "}
						EDGES
						{source.equipmentGroupCount > 0
							? ` · ${source.equipmentGroupCount.toLocaleString()} EQ · ${source.portCount.toLocaleString()} PORTS`
							: ""}
						{source.organizationCount > 0
							? ` · ${source.organizationCount.toLocaleString()} ORG`
							: ""}
					</span>
				</div>
				<p
					id="tilefab-contextual-save-project-note"
					className="tilefab-contextual-save-project-note"
					data-testid="blueprint-project-distinction"
				>
					청사진은 선택 구조를 다시 배치하기 위한 재사용 항목입니다. 전체 FAB 파일은 상단의{" "}
					<strong>프로젝트 저장 (.openfab)</strong>을 사용하세요.
				</p>

				<form onSubmit={submit}>
					<div className="tilefab-contextual-save-fields">
						<label>
							<span>NAME</span>
							<input
								ref={nameRef}
								value={draft.name}
								maxLength={80}
								aria-label="청사진 이름"
								aria-invalid={!validation.valid && validation.field === "name"}
								aria-describedby={
									!validation.valid && validation.field === "name"
										? "tilefab-contextual-save-feedback"
										: undefined
								}
								disabled={busy}
								onChange={(event) => onName(event.currentTarget.value)}
								onBlur={(event) =>
									onName(normalizeContextualBlueprintName(event.currentTarget.value))
								}
							/>
						</label>
						<label>
							<span>FOLDER</span>
							<input
								ref={folderRef}
								value={draft.folder}
								maxLength={160}
								aria-label="청사진 폴더"
								aria-invalid={!validation.valid && validation.field === "folder"}
								aria-describedby={
									!validation.valid && validation.field === "folder"
										? "tilefab-contextual-save-feedback"
										: undefined
								}
								placeholder="Root"
								disabled={busy}
								onChange={(event) => onFolder(event.currentTarget.value)}
								onBlur={(event) =>
									onFolder(normalizeContextualBlueprintFolder(event.currentTarget.value))
								}
							/>
						</label>
					</div>

					<fieldset className="tilefab-contextual-save-destination">
						<legend>DESTINATION</legend>
						<div className="tilefab-contextual-save-destination-options">
							<DestinationOption
								active={draft.destination === "project"}
								icon={<LibraryBig size={15} />}
								label="THIS PROJECT"
								detail="PROJECT BLUEPRINTS"
								testId="contextual-save-project"
								disabled={busy}
								onChoose={() => onDestination("project")}
							/>
							<DestinationOption
								active={draft.destination === "user-library"}
								icon={<FolderOpen size={15} />}
								label="MY LIBRARY"
								detail="BROWSER LOCAL"
								testId="contextual-save-user-library"
								disabled={busy}
								onChoose={() => onDestination("user-library")}
							/>
						</div>
					</fieldset>

					<fieldset
						ref={quickSlotsRef}
						className="tilefab-contextual-save-slots"
						disabled={busy || draft.destination !== "user-library"}
					>
						<legend>
							<Bookmark size={13} /> QUICK SLOT <small>OPTIONAL</small>
						</legend>
						<div className="tilefab-contextual-save-slot-options">
							<button
								type="button"
								aria-pressed={draft.quickSlot === null}
								className="tilefab-contextual-save-slot"
								data-active={draft.quickSlot === null}
								data-testid="contextual-save-quick-slot-none"
								onClick={() => onQuickSlot(null)}
							>
								NONE
							</button>
							{CONTEXTUAL_BLUEPRINT_QUICK_SLOTS.map((slot) => {
								const occupied = occupiedQuickSlots.has(slot);
								return (
									<button
										key={slot}
										type="button"
										aria-label={`Quick slot ${slot}${occupied ? " 사용 중" : ""}`}
										className="tilefab-contextual-save-slot"
										aria-pressed={draft.quickSlot === slot}
										data-active={draft.quickSlot === slot}
										data-occupied={occupied}
										data-testid={`contextual-save-quick-slot-${slot}`}
										title={
											occupied ? `Slot ${slot} · ${occupiedQuickSlots.get(slot)}` : `Slot ${slot}`
										}
										disabled={busy || occupied}
										onClick={() => onQuickSlot(slot)}
									>
										{slot}
									</button>
								);
							})}
						</div>
					</fieldset>

					<div
						ref={errorRef}
						id="tilefab-contextual-save-feedback"
						className="tilefab-contextual-save-feedback"
						role={storageError ? "alert" : "status"}
						aria-live={storageError ? "assertive" : "polite"}
						aria-atomic="true"
						tabIndex={storageError ? -1 : undefined}
					>
						{issue ?? "\u00a0"}
					</div>
					<footer>
						<button type="button" disabled={busy} onClick={onCancel}>
							CANCEL
						</button>
						<button
							type="submit"
							className="tilefab-contextual-save-primary"
							disabled={busy || !validation.valid}
							data-testid="confirm-contextual-blueprint-save"
						>
							<Save size={15} />
							{busy
								? "SAVING"
								: draft.destination === "project"
									? "ADD TO PROJECT BLUEPRINTS"
									: "SAVE TO MY LIBRARY"}
							<kbd>⌘/CTRL S</kbd>
						</button>
					</footer>
				</form>
			</section>
		</div>,
		document.body,
	);
}

function DestinationOption({
	active,
	icon,
	label,
	detail,
	testId,
	disabled,
	onChoose,
}: Readonly<{
	active: boolean;
	icon: ReactNode;
	label: string;
	detail: string;
	testId: string;
	disabled: boolean;
	onChoose: () => void;
}>) {
	return (
		<label data-active={active} data-testid={testId}>
			<input
				type="radio"
				name="contextual-blueprint-save-destination"
				checked={active}
				disabled={disabled}
				onChange={onChoose}
			/>
			{icon}
			<span>
				<strong>{label}</strong>
				<small>{detail}</small>
			</span>
		</label>
	);
}

function sourceKindLabel(kind: ContextualBlueprintSaveSourceSummary["kind"]): string {
	if (kind === "area-selection") return "SELECTION";
	if (kind === "organization-selection") return "ORGANIZATION SELECTION";
	if (kind === "area-ghost") return "HELD BLUEPRINT";
	if (kind === "organization-ghost") return "HELD ORGANIZATION";
	return "WHOLE MAP";
}

function trapTabNavigation(event: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
	if (!root) return;
	const controls = focusableDialogElements(root);
	if (controls.length === 0) {
		event.preventDefault();
		root.focus();
		return;
	}
	const current = document.activeElement;
	const first = controls[0] as HTMLElement;
	const last = controls[controls.length - 1] as HTMLElement;
	const activeInside = current !== root && current instanceof Node && root.contains(current);
	if (event.shiftKey && (current === first || !activeInside)) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (current === last || !activeInside)) {
		event.preventDefault();
		first.focus();
	}
}

const FOCUSABLE_SELECTOR =
	"button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusableDialogElements(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
		if (
			element.hidden ||
			element.inert ||
			element.matches(":disabled") ||
			element.getAttribute("aria-hidden") === "true"
		) {
			return false;
		}
		const bounds = element.getBoundingClientRect();
		return bounds.width > 0 && bounds.height > 0;
	});
}
