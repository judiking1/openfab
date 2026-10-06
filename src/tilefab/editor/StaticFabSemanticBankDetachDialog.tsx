import { Check, LoaderCircle, ShieldCheck, Unlink, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { StaticFabSemanticBankDetachTopologyEvidence } from "../compile/StaticFabSemanticBankDetachProspective";
import {
	STATIC_FAB_SEMANTIC_BANK_DETACH_SAMPLE_LIMIT,
	type StaticFabSemanticBankDetachImpactRow,
	type StaticFabSemanticBankDetachSession,
	staticFabSemanticBankDetachSessionCanApply,
} from "./StaticFabSemanticBankDetachSession";
import { StaticFabSemanticImpactReview } from "./StaticFabSemanticImpactReview";
import "./StaticFabSemanticBankDetachDialog.css";

export interface StaticFabSemanticBankDetachDialogProps {
	readonly session: StaticFabSemanticBankDetachSession;
	readonly returnFocus?: HTMLElement | null;
	readonly onAnalyze: (requestSequence: number) => void;
	readonly onCancel: () => void;
	readonly onRetry: () => void;
	readonly onApply: () => void;
}

export function StaticFabSemanticBankDetachDialog({
	session,
	returnFocus,
	onAnalyze,
	onCancel,
	onRetry,
	onApply,
}: StaticFabSemanticBankDetachDialogProps): React.ReactElement {
	const backdropRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const callbacksRef = useRef({ onAnalyze, onCancel, returnFocus });
	const restoreFocusRef = useRef(false);
	const titleId = useId();
	const descriptionId = useId();
	const applying = session.phase === "applying";
	const canApply = staticFabSemanticBankDetachSessionCanApply(session);

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
			className="tilefab-bank-detach-backdrop"
			role="presentation"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) cancel();
			}}
		>
			<section
				ref={dialogRef}
				className="tilefab-bank-detach-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				aria-busy={applying}
				tabIndex={-1}
				data-testid="semantic-bank-detach-dialog"
				data-phase={session.phase}
			>
				<header>
					<Unlink size={20} aria-hidden="true" />
					<strong id={titleId}>Bank 분리</strong>
				</header>
				<div className="tilefab-bank-detach-workspace">
					<p id={descriptionId}>
						<strong>{session.bankName}</strong>의 FAB 연결을 제거합니다. Bank와 하위 Bay·Loop, 내부
						레일·장비·Port는 보존합니다.
					</p>
					{session.review ? (
						<>
							<StaticFabSemanticImpactReview
								mode="detach"
								removed={session.review.removed}
								preserved={session.review.preserved}
								organizationLabels={session.review.organizationLabels}
								connection={{
									parentId: session.review.parentFabOrganizationId,
									bankId: session.review.bankOrganizationId,
								}}
							/>
							<details
								className="tilefab-review-technical-details"
								data-testid="semantic-review-technical-details"
							>
								<summary>수량·ID·좌표 상세</summary>
								<div className="tilefab-bank-detach-impact">
									<ImpactColumn title="제거" rows={session.review.removed} />
									<ImpactColumn title="보존" rows={session.review.preserved} />
								</div>
							</details>
						</>
					) : null}
					<p
						className="tilefab-bank-detach-status"
						role="status"
						aria-live="polite"
						aria-atomic="true"
					>
						{session.phase === "analyzing" || applying ? (
							<LoaderCircle size={16} aria-hidden="true" />
						) : null}
						<span>{applying ? "검토한 Bank 분리를 적용하고 있습니다." : session.reason}</span>
					</p>
					<section className="tilefab-bank-detach-evidence" aria-label="Worker 검증 결과">
						<h3>
							<ShieldCheck size={16} aria-hidden="true" /> Worker 검증 결과
						</h3>
						{session.evidence ? (
							<>
								<p>
									분리할 Bank:{" "}
									{session.evidence.selectedBank.closed ? "닫힌 순환 경로 유지" : "검증 미완료"}
									<br />
									남는 FAB:{" "}
									{session.evidence.retainedFab.closed ? "닫힌 순환 경로 유지" : "검증 미완료"}
								</p>
								<details>
									<summary>검증 수치 보기</summary>
									<div className="tilefab-bank-detach-impact">
										<TopologyEvidence title="변경 전" evidence={session.evidence.source} />
										<TopologyEvidence
											title="분리 후 예상"
											evidence={session.evidence.prospective}
										/>
									</div>
								</details>
							</>
						) : (
							<p>
								{session.phase === "rejected"
									? "현재 문서의 연결 관계와 레일·Port 검증을 완료하지 못했습니다."
									: "현재 문서의 연결 관계와 레일·Port 검증을 기다리고 있습니다."}
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
						data-testid="bank-detach-cancel"
					>
						<X size={16} aria-hidden="true" />
						취소
					</button>
					{session.phase === "rejected" ? (
						<button type="button" onClick={onRetry} data-testid="bank-detach-retry">
							다시 검토
						</button>
					) : null}
					<button
						type="button"
						data-testid="bank-detach-apply"
						disabled={!canApply}
						onClick={() => {
							if (!canApply) return;
							restoreFocusRef.current = false;
							dialogRef.current?.focus({ preventScroll: true });
							onApply();
						}}
					>
						<Check size={16} aria-hidden="true" />
						분리 적용
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
	rows: readonly StaticFabSemanticBankDetachImpactRow[];
}>): React.ReactElement {
	return (
		<section
			className="tilefab-bank-detach-impact-column"
			data-impact={title === "보존" ? "preserved" : "removed"}
		>
			<h3>{title}</h3>
			<dl>
				{rows.map((row) => {
					const samples = row.samples.slice(
						0,
						Math.min(row.count, STATIC_FAB_SEMANTIC_BANK_DETACH_SAMPLE_LIMIT),
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
	evidence: StaticFabSemanticBankDetachTopologyEvidence;
}>): React.ReactElement {
	return (
		<section>
			<h4>{title}</h4>
			<dl>
				<div>
					<dt>레일 연결 영역</dt>
					<dd>{evidence.authoredComponentCount.toLocaleString()}</dd>
				</div>
				<div>
					<dt>물리 경로 연결 영역</dt>
					<dd>{evidence.physicalComponentCount.toLocaleString()}</dd>
				</div>
				<div>
					<dt>열린 레일 끝점</dt>
					<dd>{evidence.authoredOpenTerminalCount.toLocaleString()}</dd>
				</div>
				<div>
					<dt>열린 물리 경로</dt>
					<dd>{evidence.physicalOpenPathCount.toLocaleString()}</dd>
				</div>
				<div>
					<dt>물리 진단</dt>
					<dd>{evidence.physicalDiagnosticCount.toLocaleString()}</dd>
				</div>
				<div>
					<dt>간격 문제</dt>
					<dd>{evidence.physicalClearanceIssueCount.toLocaleString()}</dd>
				</div>
			</dl>
		</section>
	);
}
