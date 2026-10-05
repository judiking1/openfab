import { LoaderCircle, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import {
	STATIC_FAB_SEMANTIC_FAB_DELETE_SAMPLE_LIMIT,
	type StaticFabSemanticFabDeleteEvidenceMetric,
	type StaticFabSemanticFabDeleteImpactRow,
	type StaticFabSemanticFabDeleteSession,
	staticFabSemanticFabDeleteSessionCanApply,
} from "./StaticFabSemanticFabDeleteSession";
import "./StaticFabSemanticFabDeleteDialog.css";

export interface StaticFabSemanticFabDeleteDialogProps {
	readonly session: StaticFabSemanticFabDeleteSession;
	readonly returnFocus?: HTMLElement | null;
	readonly onAnalyze: (requestSequence: number) => void;
	readonly onCancel: () => void;
	readonly onRetry: () => void;
	readonly onApply: () => void;
}

export function StaticFabSemanticFabDeleteDialog({
	session,
	returnFocus,
	onAnalyze,
	onCancel,
	onRetry,
	onApply,
}: StaticFabSemanticFabDeleteDialogProps): React.ReactElement {
	const backdropRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const callbacksRef = useRef({ onAnalyze, onCancel, returnFocus });
	const restoreFocusRef = useRef(false);
	const titleId = useId();
	const descriptionId = useId();
	const applying = session.phase === "applying";
	const canApply = staticFabSemanticFabDeleteSessionCanApply(session);

	useEffect(() => {
		callbacksRef.current = { onAnalyze, onCancel, returnFocus };
	}, [onAnalyze, onCancel, returnFocus]);
	useEffect(() => {
		const dialog = dialogRef.current;
		const backdrop = backdropRef.current;
		if (!dialog || !backdrop) return;
		const launcher =
			callbacksRef.current.returnFocus ??
			(document.activeElement instanceof HTMLElement ? document.activeElement : null);
		const background = [...document.body.children]
			.filter(
				(element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
			)
			.map((element) => ({
				element,
				inert: element.inert,
				ariaHidden: element.getAttribute("aria-hidden"),
			}));
		for (const { element } of background) {
			element.inert = true;
			element.setAttribute("aria-hidden", "true");
		}
		cancelRef.current?.focus({ preventScroll: true });
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (dialog.getAttribute("aria-busy") !== "true") {
					restoreFocusRef.current = true;
					callbacksRef.current.onCancel();
				}
			} else if (event.key === "Tab") {
				const controls = [
					...dialog.querySelectorAll<HTMLElement>(
						"button:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])",
					),
				].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
				const first = controls[0];
				const last = controls.at(-1);
				if (!first || !last) {
					event.preventDefault();
					dialog.focus();
				} else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
					event.preventDefault();
					(event.shiftKey ? last : first).focus();
				} else if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			for (const { element, inert, ariaHidden } of background) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
			if (restoreFocusRef.current)
				requestAnimationFrame(() => {
					if (launcher?.isConnected) launcher.focus({ preventScroll: true });
				});
		};
	}, []);
	useEffect(() => {
		if (session.phase !== "analyzing") return;
		const frame = requestAnimationFrame(() =>
			callbacksRef.current.onAnalyze(session.requestSequence),
		);
		return () => cancelAnimationFrame(frame);
	}, [session.phase, session.requestSequence]);
	useEffect(() => {
		if (session.phase === "rejected" && document.activeElement === dialogRef.current) {
			cancelRef.current?.focus({ preventScroll: true });
		}
	}, [session.phase]);
	const cancel = (): void => {
		if (applying) return;
		restoreFocusRef.current = true;
		onCancel();
	};
	const content = (
		<div
			ref={backdropRef}
			className="tilefab-fab-delete-backdrop"
			role="presentation"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) cancel();
			}}
		>
			<section
				ref={dialogRef}
				className="tilefab-fab-delete-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				aria-busy={applying}
				tabIndex={-1}
				data-testid="semantic-fab-delete-dialog"
				data-phase={session.phase}
			>
				<header>
					<Trash2 size={20} aria-hidden="true" />
					<strong id={titleId}>FAB 삭제</strong>
				</header>
				<div className="tilefab-fab-delete-workspace">
					<p id={descriptionId}>
						<strong>{session.fabName}</strong>와 독점 소유한 하위 조직·레일·장비·Port를 삭제합니다.
						다른 최상위 FAB와 무소속 항목은 보존합니다. 한 번의 실행 취소로 복원할 수 있습니다.
					</p>
					{session.review?.preserved.every((row) => row.count === 0) ? (
						<p>삭제 후 캔버스에 남는 조직·레일·장비·Port가 없습니다.</p>
					) : null}
					{session.review ? (
						<div className="tilefab-fab-delete-impact">
							<ImpactColumn title="보존" rows={session.review.preserved} />
							<ImpactColumn title="삭제 예정" rows={session.review.removed} />
						</div>
					) : null}
					<p
						className="tilefab-fab-delete-status"
						role="status"
						aria-live="polite"
						aria-atomic="true"
					>
						{session.phase === "analyzing" || applying ? (
							<LoaderCircle size={16} aria-hidden="true" />
						) : null}
						<span>{applying ? "검토한 FAB 삭제를 적용하고 있습니다." : session.reason}</span>
					</p>
					<section className="tilefab-fab-delete-evidence" aria-label="Worker 검증 결과">
						<h3>
							<ShieldCheck size={16} aria-hidden="true" /> Worker 검증 결과
						</h3>
						{session.evidence ? (
							<>
								<dl>
									{session.evidence.checks.map((check) => (
										<div key={check.label}>
											<dt>{check.label}</dt>
											<dd>{check.value}</dd>
										</div>
									))}
								</dl>
								<details>
									<summary>검증 수치 보기</summary>
									<div className="tilefab-fab-delete-impact">
										<TopologyEvidence title="변경 전" evidence={session.evidence.source} />
										<TopologyEvidence
											title="삭제 후 예상"
											evidence={session.evidence.prospective}
										/>
									</div>
								</details>
							</>
						) : (
							<p>
								{session.phase === "rejected"
									? "현재 문서의 삭제 범위와 남는 레일·Port 검증을 완료하지 못했습니다."
									: "현재 문서의 삭제 범위와 남는 레일·Port 검증을 기다리고 있습니다."}
							</p>
						)}
					</section>
				</div>
				<footer>
					<button
						ref={cancelRef}
						type="button"
						onClick={cancel}
						disabled={applying}
						data-testid="fab-delete-cancel"
					>
						<X size={16} aria-hidden="true" />
						취소
					</button>
					{session.phase === "rejected" ? (
						<button type="button" onClick={onRetry} data-testid="fab-delete-retry">
							다시 검토
						</button>
					) : null}
					<button
						type="button"
						data-testid="fab-delete-apply"
						disabled={!canApply}
						onClick={() => {
							if (!canApply) return;
							restoreFocusRef.current = false;
							dialogRef.current?.focus({ preventScroll: true });
							onApply();
						}}
					>
						<Trash2 size={16} aria-hidden="true" />
						FAB 삭제
					</button>
				</footer>
			</section>
		</div>
	);
	return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function ImpactColumn({
	title,
	rows,
}: Readonly<{
	title: string;
	rows: readonly StaticFabSemanticFabDeleteImpactRow[];
}>): React.ReactElement {
	return (
		<section className="tilefab-fab-delete-impact-column">
			<h3>{title}</h3>
			<dl>
				{rows.map((row) => {
					const samples = row.samples.slice(
						0,
						Math.min(row.count, STATIC_FAB_SEMANTIC_FAB_DELETE_SAMPLE_LIMIT),
					);
					const omitted = Math.max(0, row.count - samples.length);
					return (
						<div key={row.label}>
							<dt>{row.label}</dt>
							<dd>
								{row.count.toLocaleString()}개
								{samples.length > 0 ? (
									<small>
										{samples.join(", ")}
										{omitted > 0 ? ` 외 ${omitted.toLocaleString()}개` : ""}
									</small>
								) : null}
							</dd>
						</div>
					);
				})}
			</dl>
		</section>
	);
}

function TopologyEvidence({
	title,
	evidence,
}: Readonly<{
	title: string;
	evidence: readonly StaticFabSemanticFabDeleteEvidenceMetric[];
}>): React.ReactElement {
	return (
		<section>
			<h4>{title}</h4>
			<dl>
				{evidence.map((metric) => (
					<div key={metric.label}>
						<dt>{metric.label}</dt>
						<dd>
							{typeof metric.value === "number" ? metric.value.toLocaleString() : metric.value}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}
