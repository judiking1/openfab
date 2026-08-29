import { AlertTriangle, ArchiveRestore, Download, FileArchive, ShieldCheck, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
	OpenFabUserBlueprintLibraryConflictDecision,
	OpenFabUserBlueprintLibraryReplaceImpact,
	OpenFabUserBlueprintLibraryRestoreMode,
	OpenFabUserBlueprintLibraryRestorePlanPreview,
	OpenFabUserBlueprintLibraryRestorePreflight,
} from "../project/OpenFabUserBlueprintLibraryBundle";
import "./UserBlueprintLibraryRestoreDialog.css";

const CONFLICT_PAGE_SIZE = 40;

export interface UserBlueprintLibraryRestoreDialogProps {
	readonly fileName: string;
	readonly preflight: OpenFabUserBlueprintLibraryRestorePreflight;
	readonly replaceImpact: OpenFabUserBlueprintLibraryReplaceImpact;
	readonly busyOperation: string | null;
	readonly error: string | null;
	readonly onCancel: () => void;
	readonly onBackupCurrent: () => Promise<boolean>;
	readonly onPreview: (
		mode: OpenFabUserBlueprintLibraryRestoreMode,
		decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
		signal?: AbortSignal,
	) => Promise<OpenFabUserBlueprintLibraryRestorePlanPreview>;
	readonly onRestore: (
		mode: OpenFabUserBlueprintLibraryRestoreMode,
		decisions: ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>,
	) => void;
}

export function UserBlueprintLibraryRestoreDialog({
	fileName,
	preflight,
	replaceImpact,
	busyOperation,
	error,
	onCancel,
	onBackupCurrent,
	onPreview,
	onRestore,
}: UserBlueprintLibraryRestoreDialogProps) {
	const [mode, setMode] = useState<OpenFabUserBlueprintLibraryRestoreMode>("merge");
	const [decisions, setDecisions] = useState<
		ReadonlyMap<string, OpenFabUserBlueprintLibraryConflictDecision>
	>(() => new Map());
	const [replaceConfirmed, setReplaceConfirmed] = useState(false);
	const [visibleConflictCount, setVisibleConflictCount] = useState(CONFLICT_PAGE_SIZE);
	const [visibleImpactCount, setVisibleImpactCount] = useState(CONFLICT_PAGE_SIZE);
	const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
	const previewKey = useMemo(
		() =>
			`${mode}|${[...decisions.entries()]
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([id, decision]) => `${id}:${decision}`)
				.join("|")}`,
		[decisions, mode],
	);
	const [previewResult, setPreviewResult] = useState<Readonly<{
		key: string;
		preview: OpenFabUserBlueprintLibraryRestorePlanPreview | null;
		error: string | null;
	}> | null>(null);
	const previewing = previewResult?.key !== previewKey;
	const planPreview = previewing ? null : previewResult.preview;
	const planPreviewError = previewing ? null : previewResult.error;
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const dialogRef = useRef<HTMLElement | null>(null);
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const errorRef = useRef<HTMLDivElement | null>(null);
	const primaryRef = useRef<HTMLButtonElement | null>(null);
	const onPreviewRef = useRef(onPreview);
	const busy = busyOperation !== null;
	const backingUp = busyOperation === "backup-library";

	useEffect(() => {
		onPreviewRef.current = onPreview;
	}, [onPreview]);

	useEffect(() => {
		closeRef.current?.focus({ preventScroll: true });
		const backdrop = backdropRef.current;
		if (!backdrop) return;
		const background = [...document.body.children].filter(
			(element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
		);
		const previous = background.map((element) => ({
			element,
			inert: element.inert,
			ariaHidden: element.getAttribute("aria-hidden"),
		}));
		for (const { element } of previous) {
			element.inert = true;
			element.setAttribute("aria-hidden", "true");
		}
		return () => {
			for (const { element, inert, ariaHidden } of previous) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
		};
	}, []);

	useEffect(() => {
		if (!error) return;
		const frame = requestAnimationFrame(() => errorRef.current?.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(frame);
	}, [error]);

	useEffect(() => {
		if (!busy) return;
		const frame = requestAnimationFrame(() => errorRef.current?.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(frame);
	}, [busy]);

	useEffect(() => {
		const controller = new AbortController();
		let current = true;
		onPreviewRef
			.current(mode, decisions, controller.signal)
			.then((preview) => {
				if (!current) return;
				setPreviewResult(Object.freeze({ key: previewKey, preview, error: null }));
			})
			.catch((cause: unknown) => {
				if (!current || controller.signal.aborted) return;
				setPreviewResult(
					Object.freeze({
						key: previewKey,
						preview: null,
						error: cause instanceof Error ? cause.message : "복원 계획을 계산하지 못했습니다",
					}),
				);
			});
		return () => {
			current = false;
			controller.abort();
		};
	}, [decisions, mode, previewKey]);

	const importCopyCount = useMemo(
		() => [...decisions.values()].filter((decision) => decision === "import-copy").length,
		[decisions],
	);
	const visibleConflicts = preflight.conflicts.slice(0, visibleConflictCount);
	const visibleImpacts = replaceImpact.entries.slice(0, visibleImpactCount);
	const canRestore =
		!busy && !previewing && planPreview?.valid === true && (mode === "merge" || replaceConfirmed);
	const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
			if (!busy) onCancel();
			return;
		}
		if (event.key === "Tab") trapTabNavigation(event, dialogRef.current);
	};
	const backupCurrent = async (): Promise<void> => {
		setBackupFeedback(null);
		const exported = await onBackupCurrent();
		setBackupFeedback(
			exported
				? "현재 라이브러리의 .openfablib 백업을 완료했습니다. 이제 교체를 계속할 수 있습니다."
				: "현재 라이브러리 백업 파일을 생성하지 않았습니다.",
		);
	};
	const showMoreConflicts = (): void => {
		const next = Math.min(preflight.conflicts.length, visibleConflictCount + CONFLICT_PAGE_SIZE);
		setVisibleConflictCount(next);
		if (next === preflight.conflicts.length) {
			requestAnimationFrame(() => primaryRef.current?.focus({ preventScroll: true }));
		}
	};
	const showMoreImpacts = (): void => {
		const next = Math.min(replaceImpact.entries.length, visibleImpactCount + CONFLICT_PAGE_SIZE);
		setVisibleImpactCount(next);
		if (next === replaceImpact.entries.length) {
			requestAnimationFrame(() => primaryRef.current?.focus({ preventScroll: true }));
		}
	};
	const chooseDecision = (
		id: string,
		decision: OpenFabUserBlueprintLibraryConflictDecision,
	): void => {
		setDecisions((current) => {
			const next = new Map(current);
			if (decision === "keep-current") next.delete(id);
			else next.set(id, decision);
			return next;
		});
	};

	return createPortal(
		<div ref={backdropRef} className="tilefab-library-restore-backdrop" role="presentation">
			<section
				ref={dialogRef}
				className="tilefab-library-restore-dialog"
				role="dialog"
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby="tilefab-library-restore-title"
				aria-describedby="tilefab-library-restore-summary"
				aria-busy={busy || previewing}
				data-testid="user-blueprint-library-restore-dialog"
				data-mode={mode}
				onKeyDown={handleKeyDown}
			>
				<header className="tilefab-library-restore-header">
					<span className="tilefab-library-restore-heading-icon" aria-hidden="true">
						<ArchiveRestore size={18} />
					</span>
					<div>
						<small>MY LIBRARY · RECOVERY</small>
						<strong id="tilefab-library-restore-title">RESTORE BLUEPRINT LIBRARY</strong>
					</div>
					<button
						ref={closeRef}
						type="button"
						aria-label="라이브러리 복원 취소"
						disabled={busy}
						onClick={onCancel}
					>
						<X size={17} />
					</button>
				</header>

				<div className="tilefab-library-restore-scroll">
					<section id="tilefab-library-restore-summary" className="tilefab-library-restore-file">
						<FileArchive size={20} aria-hidden="true" />
						<div>
							<strong>{fileName}</strong>
							<small>
								EXPORTED {formatExportTime(preflight.bundle.exportedAt)} · VERIFIED FINGERPRINT
							</small>
						</div>
						<dl>
							<div>
								<dt>BACKUP</dt>
								<dd>{preflight.bundle.recordCount.toLocaleString()}</dd>
							</div>
							<div>
								<dt>CURRENT</dt>
								<dd>{preflight.currentRecords.length.toLocaleString()}</dd>
							</div>
							<div>
								<dt>EDGES</dt>
								<dd>{preflight.bundle.aggregateEdgeCount.toLocaleString()}</dd>
							</div>
						</dl>
					</section>

					<fieldset className="tilefab-library-restore-modes" disabled={busy}>
						<legend>RESTORE MODE</legend>
						<label data-active={mode === "merge"}>
							<input
								type="radio"
								name="library-restore-mode"
								value="merge"
								checked={mode === "merge"}
								onChange={() => setMode("merge")}
							/>
							<span>
								<strong>
									MERGE <small>RECOMMENDED</small>
								</strong>
								<em>현재 라이브러리를 유지하고 새 항목과 선택한 충돌 사본만 추가</em>
							</span>
							<ShieldCheck size={18} aria-hidden="true" />
						</label>
						<label data-active={mode === "replace"} data-danger="true">
							<input
								type="radio"
								name="library-restore-mode"
								value="replace"
								checked={mode === "replace"}
								onChange={() => setMode("replace")}
							/>
							<span>
								<strong>REPLACE</strong>
								<em>
									현재 {preflight.currentRecords.length.toLocaleString()}개를 지우고 백업과 정확히
									일치
								</em>
							</span>
							<AlertTriangle size={18} aria-hidden="true" />
						</label>
					</fieldset>

					{mode === "merge" ? (
						<section className="tilefab-library-restore-report">
							<header>
								<div>
									<small>MERGE PREFLIGHT</small>
									<strong>
										{preflight.additiveRecords.length.toLocaleString()} NEW ·{" "}
										{preflight.duplicateRecords.length.toLocaleString()} IDENTICAL ·{" "}
										{preflight.conflicts.length.toLocaleString()} CONFLICTS
									</strong>
								</div>
								<small>{importCopyCount.toLocaleString()} AS COPY</small>
							</header>
							{planPreview && !planPreview.valid ? (
								<p className="tilefab-library-restore-capacity-error">
									<AlertTriangle size={17} /> {planPreview.reason}
								</p>
							) : preflight.conflicts.length === 0 ? (
								<p className="tilefab-library-restore-clean">
									<ShieldCheck size={17} /> 충돌 없이 병합할 수 있습니다
								</p>
							) : (
								<ul className="tilefab-library-restore-conflicts">
									{visibleConflicts.map((conflict, conflictIndex) => {
										const id = conflict.incomingRecord.id;
										const decision = decisions.get(id) ?? "keep-current";
										const descriptionId = `tilefab-library-conflict-${conflictIndex}`;
										const incomingPath = blueprintPath(
											conflict.incomingRecord.folderPath,
											conflict.incomingRecord.blueprint.name,
										);
										return (
											<li key={id}>
												<div>
													<strong>{conflict.incomingRecord.blueprint.name}</strong>
													<small id={descriptionId}>
														{incomingPath} · {conflict.reasons.map(conflictReasonLabel).join(" · ")}
													</small>
												</div>
												<label>
													<select
														value={decision}
														disabled={busy}
														aria-label={`${incomingPath} 충돌 처리`}
														aria-describedby={descriptionId}
														onChange={(event) =>
															chooseDecision(
																id,
																event.currentTarget
																	.value as OpenFabUserBlueprintLibraryConflictDecision,
															)
														}
													>
														<option value="keep-current">KEEP CURRENT</option>
														<option value="import-copy">IMPORT AS COPY</option>
													</select>
												</label>
											</li>
										);
									})}
								</ul>
							)}
							{visibleConflictCount < preflight.conflicts.length ? (
								<button
									type="button"
									className="tilefab-library-restore-more"
									onClick={showMoreConflicts}
								>
									SHOW{" "}
									{Math.min(CONFLICT_PAGE_SIZE, preflight.conflicts.length - visibleConflictCount)}{" "}
									MORE
								</button>
							) : null}
						</section>
					) : (
						<section className="tilefab-library-replace-confirmation">
							<AlertTriangle size={21} aria-hidden="true" />
							<div>
								<strong>CURRENT LIBRARY WILL BE REPLACED</strong>
								<p>
									성공하면 브라우저 로컬 라이브러리는 백업의{" "}
									{preflight.bundle.recordCount.toLocaleString()}개와 정확히 같아집니다. 프로젝트
									맵은 바뀌지 않습니다.
								</p>
								<dl className="tilefab-library-replace-impact-summary">
									<div data-kind="added">
										<dt>ADDED</dt>
										<dd>{replaceImpact.addedCount.toLocaleString()}</dd>
									</div>
									<div data-kind="changed">
										<dt>CHANGED</dt>
										<dd>{replaceImpact.changedCount.toLocaleString()}</dd>
									</div>
									<div data-kind="removed">
										<dt>REMOVED</dt>
										<dd>{replaceImpact.removedCount.toLocaleString()}</dd>
									</div>
									<div data-kind="unchanged">
										<dt>UNCHANGED</dt>
										<dd>{replaceImpact.unchangedCount.toLocaleString()}</dd>
									</div>
								</dl>
								{visibleImpacts.length > 0 ? (
									<ul className="tilefab-library-replace-impact-list">
										{visibleImpacts.map((impact) => (
											<li key={`${impact.kind}:${impact.recordId}`} data-kind={impact.kind}>
												<strong>{impact.kind.toUpperCase()}</strong>
												<span>{replaceImpactLabel(impact)}</span>
											</li>
										))}
									</ul>
								) : null}
								{visibleImpactCount < replaceImpact.entries.length ? (
									<button
										type="button"
										className="tilefab-library-restore-more"
										onClick={showMoreImpacts}
									>
										SHOW{" "}
										{Math.min(
											CONFLICT_PAGE_SIZE,
											replaceImpact.entries.length - visibleImpactCount,
										).toLocaleString()}{" "}
										MORE CHANGES
									</button>
								) : null}
								<button type="button" disabled={busy} onClick={() => void backupCurrent()}>
									<Download size={15} /> {backingUp ? "BACKING UP" : "BACK UP CURRENT FIRST"}
								</button>
								<label>
									<input
										type="checkbox"
										checked={replaceConfirmed}
										disabled={busy}
										onChange={(event) => setReplaceConfirmed(event.currentTarget.checked)}
									/>
									<span>현재 라이브러리를 교체한다는 것을 확인했습니다</span>
								</label>
							</div>
						</section>
					)}

					<div
						ref={errorRef}
						className="tilefab-library-restore-feedback"
						role={error || planPreviewError || planPreview?.valid === false ? "alert" : "status"}
						aria-live={
							error || planPreviewError || planPreview?.valid === false ? "assertive" : "polite"
						}
						tabIndex={-1}
					>
						{error ??
							planPreviewError ??
							(busyOperation === "backup-library"
								? "현재 라이브러리 백업 파일을 생성하고 있습니다"
								: busyOperation === "restore-library-commit"
									? "검증된 복원 계획을 IndexedDB에 원자적으로 적용하고 있습니다"
									: previewing
										? "Worker에서 복원 계획과 용량을 계산하고 있습니다"
										: (backupFeedback ??
											(planPreview
												? (planPreview.reason ??
													`적용 예상 · ${planPreview.recordCount.toLocaleString()}개 · ${planPreview.aggregateEdgeCount.toLocaleString()} edges · ${formatMebibytes(planPreview.aggregateJsonBytes)} MiB`)
												: "복원 계획을 준비하고 있습니다")))}
					</div>
				</div>

				<footer className="tilefab-library-restore-footer">
					<button type="button" disabled={busy} onClick={onCancel}>
						CANCEL
					</button>
					<button
						ref={primaryRef}
						type="button"
						className="tilefab-library-restore-primary"
						data-danger={mode === "replace"}
						disabled={!canRestore}
						onClick={() => onRestore(mode, decisions)}
					>
						<ArchiveRestore size={16} />
						{busyOperation === "restore-library-commit"
							? "RESTORING"
							: mode === "merge"
								? "MERGE LIBRARY"
								: "REPLACE LIBRARY"}
					</button>
				</footer>
			</section>
		</div>,
		document.body,
	);
}

function conflictReasonLabel(
	reason: OpenFabUserBlueprintLibraryRestorePreflight["conflicts"][number]["reasons"][number],
): string {
	const owner = blueprintPath(reason.currentFolderPath, reason.currentRecordName);
	if (reason.kind === "id") return `ID owned by ${owner}`;
	if (reason.kind === "folder-name") return `NAME matches ${owner}`;
	return `QUICK SLOT ${reason.currentQuickSlot ?? "?"} owned by ${owner}`;
}

function replaceImpactLabel(
	impact: OpenFabUserBlueprintLibraryReplaceImpact["entries"][number],
): string {
	const next = blueprintPath(impact.folderPath, impact.name);
	const path =
		impact.kind === "changed" && impact.previousName && impact.previousFolderPath
			? `${blueprintPath(impact.previousFolderPath, impact.previousName)} -> ${next}`
			: next;
	const count = (previous: number | null, current: number): string =>
		previous === null
			? current.toLocaleString()
			: `${previous.toLocaleString()}→${current.toLocaleString()}`;
	const slot =
		impact.previousQuickSlot === null && impact.quickSlot === null
			? "NONE"
			: `${impact.previousQuickSlot ?? "NONE"}→${impact.quickSlot ?? "NONE"}`;
	return `${path} · EDGES ${count(impact.previousEdgeCount, impact.edgeCount)} · PORTS ${count(impact.previousPortCount, impact.portCount)} · GROUPS ${count(impact.previousEquipmentGroupCount, impact.equipmentGroupCount)} · ORGS ${count(impact.previousOrganizationCount, impact.organizationCount)} · SLOT ${slot}`;
}

function blueprintPath(folderPath: readonly string[], name: string): string {
	return `${folderPath.length === 0 ? "ROOT" : folderPath.join("/")} / ${name}`;
}

function formatMebibytes(bytes: number): string {
	return (bytes / (1024 * 1024)).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

function formatExportTime(value: string): string {
	return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function trapTabNavigation(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null): void {
	if (!container) return;
	const focusable = Array.from(
		container.querySelectorAll<HTMLElement>(
			'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
		),
	).filter((element) => element.getClientRects().length > 0);
	if (focusable.length === 0) {
		event.preventDefault();
		container.focus({ preventScroll: true });
		return;
	}
	const first = focusable[0];
	const last = focusable.at(-1);
	if (!first || !last) return;
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}
