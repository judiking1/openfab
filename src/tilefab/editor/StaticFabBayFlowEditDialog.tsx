import { Check, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { StaticFabBayFlowEditReview } from "../core/StaticFabBayFlowEdit";
import type { StaticFabBayFlowEditTopologyEvidence } from "../worker/StaticFabBayFlowEditProtocol";
import {
	type StaticFabBayFlowEditSession,
	staticFabBayFlowEditSessionCanApply,
} from "./StaticFabBayFlowEditSession";
import "./StaticFabSemanticBayMutationDialog.css";

export const STATIC_FAB_BAY_FLOW_EDIT_DETAIL_LIMIT = 4;

export interface StaticFabBayFlowEditDialogProps {
	readonly session: StaticFabBayFlowEditSession;
	readonly returnFocus?: HTMLElement | null;
	readonly onAnalyze: (requestSequence: number) => void;
	readonly onCancel: () => void;
	readonly onApply: () => void;
}

export function StaticFabBayFlowEditDialog({
	session,
	returnFocus,
	onAnalyze,
	onCancel,
	onApply,
}: StaticFabBayFlowEditDialogProps): React.ReactElement {
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const dialogRef = useRef<HTMLElement | null>(null);
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const restoreLauncherOnUnmountRef = useRef(false);
	const suppliedReturnFocusRef = useRef(returnFocus);
	const onAnalyzeRef = useRef(onAnalyze);
	const onCancelRef = useRef(onCancel);
	const titleId = useId();
	const descriptionId = useId();
	const applying = session.phase === "applying";
	const canApply = staticFabBayFlowEditSessionCanApply(session);

	useEffect(() => {
		suppliedReturnFocusRef.current = returnFocus;
		onAnalyzeRef.current = onAnalyze;
		onCancelRef.current = onCancel;
	}, [onAnalyze, onCancel, returnFocus]);

	useEffect(() => {
		returnFocusRef.current =
			suppliedReturnFocusRef.current ??
			(document.activeElement instanceof HTMLElement ? document.activeElement : null);
		const backdrop = backdropRef.current;
		const dialog = dialogRef.current;
		if (!backdrop || !dialog) return;
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
		cancelRef.current?.focus({ preventScroll: true });
		const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				if (!dialog.matches('[aria-busy="true"]')) {
					restoreLauncherOnUnmountRef.current = true;
					onCancelRef.current();
				}
				return;
			}
			if (event.key === "Tab") trapTabNavigation(event, dialog);
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			for (const { element, inert, ariaHidden } of backgroundState) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
			if (restoreLauncherOnUnmountRef.current) {
				const target = returnFocusRef.current;
				requestAnimationFrame(() => {
					if (target?.isConnected) target.focus({ preventScroll: true });
				});
			}
		};
	}, []);

	useEffect(() => {
		if (session.phase !== "analyzing") return;
		const frame = requestAnimationFrame(() => onAnalyzeRef.current(session.requestSequence));
		return () => cancelAnimationFrame(frame);
	}, [session.phase, session.requestSequence]);

	const requestCancel = (): void => {
		if (applying) return;
		restoreLauncherOnUnmountRef.current = true;
		onCancel();
	};
	const content = (
		<div
			ref={backdropRef}
			className="tilefab-semantic-bay-backdrop"
			role="presentation"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) requestCancel();
			}}
		>
			<section
				ref={dialogRef}
				className="tilefab-semantic-bay-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				aria-busy={applying}
				tabIndex={-1}
				data-testid="bay-flow-edit-dialog"
				data-command="edit-bay-flow"
				data-action="EDIT_FLOW"
				data-target-pattern={session.targetInternalFlowPattern}
				data-phase={session.phase}
			>
				<header>
					<span className="tilefab-semantic-bay-heading-icon" aria-hidden="true">
						<RefreshCw size={19} />
					</span>
					<span>
						<small>선택한 Bay 편집</small>
						<strong id={titleId} className="tilefab-semantic-bay-dialog-title">
							Bay 흐름 변경
						</strong>
					</span>
					<code className="tilefab-semantic-bay-dialog-id">ORG {session.bayOrganizationId}</code>
				</header>
				<div className="tilefab-semantic-bay-workspace">
					<p id={descriptionId} className="tilefab-semantic-bay-intro">
						<strong className="tilefab-semantic-bay-intro-name">{session.bayName}</strong>의 내부
						순환을 <strong>{flowLabel(session.targetInternalFlowPattern)}</strong>으로 변경합니다.
					</p>
					<CommandStatus session={session} />
					{session.review ? <FlowReview review={session.review} /> : null}
					{session.review || session.sourceEvidence || session.timings ? (
						<details className="tilefab-bay-flow-disclosure" data-testid="bay-flow-edit-details">
							<summary>레일·검증 세부 정보</summary>
							<div className="tilefab-bay-flow-disclosure-body">
								{session.review ? <FlowIdentity review={session.review} /> : null}
								{session.sourceEvidence && session.prospectiveEvidence ? (
									<WorkerEvidence
										source={session.sourceEvidence}
										prospective={session.prospectiveEvidence}
										certified={canApply || applying}
									/>
								) : null}
								<p className="tilefab-semantic-bay-candidate-note">{session.reason}</p>
								{session.timings ? (
									<p className="tilefab-semantic-bay-candidate-note">
										계획 {session.timings.planningMilliseconds.toFixed(1)} ms · 검증{" "}
										{session.timings.validationMilliseconds.toFixed(1)} ms
									</p>
								) : null}
							</div>
						</details>
					) : null}
				</div>
				<footer>
					<button
						ref={cancelRef}
						type="button"
						data-testid="bay-flow-edit-cancel"
						data-initial-focus="true"
						disabled={applying}
						onClick={requestCancel}
					>
						<X size={15} aria-hidden="true" /> 취소
					</button>
					<button
						type="button"
						className="tilefab-semantic-bay-apply"
						data-testid="bay-flow-edit-apply"
						disabled={!canApply}
						onClick={() => {
							if (!canApply) return;
							restoreLauncherOnUnmountRef.current = false;
							onApply();
						}}
					>
						{applying ? (
							<LoaderCircle className="tilefab-semantic-bay-spinner" size={15} />
						) : (
							<RefreshCw size={15} />
						)}
						{applying ? "적용 중" : "흐름 변경"}
					</button>
				</footer>
			</section>
		</div>
	);
	return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function CommandStatus({
	session,
}: Readonly<{ session: StaticFabBayFlowEditSession }>): React.ReactElement {
	const title =
		session.phase === "analyzing"
			? "변경 가능 여부를 확인하고 있습니다"
			: session.phase === "ready"
				? "검증 완료 · 변경할 수 있습니다"
				: session.phase === "rejected"
					? "변경할 수 없습니다"
					: "흐름 변경을 적용하고 있습니다";
	const description =
		session.phase === "rejected"
			? session.reason
			: session.phase === "analyzing"
				? "연결 레일과 장비를 유지할 수 있는지 확인합니다."
				: session.phase === "ready"
					? "아래 변경 내용을 확인하세요. 적용 후 실행 취소로 되돌릴 수 있습니다."
					: "변경 내용을 프로젝트에 반영하고 있습니다.";
	return (
		<section
			className="tilefab-semantic-bay-status"
			data-state={session.phase}
			role={session.phase === "rejected" ? "alert" : "status"}
			aria-live={session.phase === "rejected" ? "assertive" : "polite"}
		>
			<span aria-hidden="true">
				{session.phase === "analyzing" || session.phase === "applying" ? (
					<LoaderCircle className="tilefab-semantic-bay-spinner" size={17} />
				) : session.phase === "ready" ? (
					<Check size={17} />
				) : (
					<X size={17} />
				)}
			</span>
			<span className="tilefab-semantic-bay-status-copy">
				<strong className="tilefab-semantic-bay-status-title">{title}</strong>
				<small className="tilefab-semantic-bay-status-detail">{description}</small>
			</span>
		</section>
	);
}

function FlowReview({
	review,
}: Readonly<{ review: StaticFabBayFlowEditReview }>): React.ReactElement {
	const connectorCount =
		review.connectorBankToBayDirectedEdgeKeys.length +
		review.connectorBayToBankDirectedEdgeKeys.length;
	return (
		<section className="tilefab-semantic-bay-review" aria-label="흐름 변경 내용">
			<header>
				<strong>변경 내용</strong>
			</header>
			<div className="tilefab-semantic-bay-impact-grid">
				<article data-impact="removed">
					<strong>바뀌는 항목</strong>
					<p className="tilefab-semantic-bay-impact-copy">
						{flowLabel(review.sourceInternalFlowPattern)} →{" "}
						{flowLabel(review.targetInternalFlowPattern)} · 레일 방향 연결{" "}
						{review.removedDirectedEdgeCount.toLocaleString()}개 제거 ·{" "}
						{review.addedDirectedEdgeCount.toLocaleString()}개 추가
					</p>
					<small className="tilefab-semantic-bay-impact-detail">
						{review.changedCellCount.toLocaleString()}개 셀 · 기존 조직{" "}
						{review.changedOrganizationIds.length.toLocaleString()}개의 레일 구성 변경
					</small>
				</article>
				<article data-impact="preserved">
					<strong>유지하는 항목</strong>
					<p className="tilefab-semantic-bay-impact-copy">
						Bay와 Process Loop, Bank 연결, 외부 진입·진출구, 외곽 범위, 장비를 유지합니다.
					</p>
					<small className="tilefab-semantic-bay-impact-detail">
						{review.incidentConnectorCount === 1
							? "외부 연결 레일 " +
								connectorCount.toLocaleString() +
								"개 · Bank " +
								String(review.bankOrganizationId)
							: "독립 Bay · 외부 연결 없음"}
					</small>
				</article>
			</div>
		</section>
	);
}

function FlowIdentity({
	review,
}: Readonly<{ review: StaticFabBayFlowEditReview }>): React.ReactElement {
	const connectorKeys = [
		...review.connectorBankToBayDirectedEdgeKeys,
		...review.connectorBayToBankDirectedEdgeKeys,
	];
	return (
		<div className="tilefab-semantic-bay-bounded-details tilefab-bay-flow-details">
			<BoundedValues
				label="Process Loop ID"
				values={review.processLoopOrganizationIds.map((id) => `ORG ${id}`)}
				total={review.processLoopOrganizationIds.length}
			/>
			<BoundedValues
				label="유지되는 연결 레일"
				values={connectorKeys}
				total={connectorKeys.length}
			/>
		</div>
	);
}

function WorkerEvidence({
	source,
	prospective,
	certified,
}: Readonly<{
	source: StaticFabBayFlowEditTopologyEvidence;
	prospective: StaticFabBayFlowEditTopologyEvidence;
	certified: boolean;
}>): React.ReactElement {
	return (
		<section className="tilefab-semantic-bay-evidence" aria-label="연결 구조 검증 결과">
			<header>
				<strong>연결 구조 검증</strong>
				<small>{certified ? "현재 프로젝트 기준 검증 완료" : "검증 미완료 · 적용 불가"}</small>
			</header>
			<div className="tilefab-semantic-bay-evidence-grid">
				<article className="tilefab-bay-flow-topology-card">
					<ShieldCheck size={16} aria-hidden="true" />
					<strong>편집 레일 · 변경 전 → 후</strong>
					<small>
						셀 {countChange(source.authoredCellCount, prospective.authoredCellCount)} · 방향 연결{" "}
						{countChange(source.authoredDirectedEdgeCount, prospective.authoredDirectedEdgeCount)} ·{" "}
						연결 성분{" "}
						{countChange(source.authoredComponentCount, prospective.authoredComponentCount)} ·{" "}
						강연결 성분{" "}
						{countChange(
							source.authoredStrongComponentCount,
							prospective.authoredStrongComponentCount,
						)}
					</small>
				</article>
				<article className="tilefab-bay-flow-topology-card">
					<ShieldCheck size={16} aria-hidden="true" />
					<strong>실제 경로 · 변경 전 → 후</strong>
					<small>
						경로 {countChange(source.physicalPathCount, prospective.physicalPathCount)} · 연결 성분{" "}
						{countChange(source.physicalComponentCount, prospective.physicalComponentCount)} ·
						강연결 성분{" "}
						{countChange(
							source.physicalStrongComponentCount,
							prospective.physicalStrongComponentCount,
						)}
					</small>
				</article>
			</div>
			<p className="tilefab-semantic-bay-candidate-note">
				{certified
					? "변경 전후 개수 동일 · 열린 끝점, 위험 분기, 잘못된 경로, 진단, 종단, 간섭 문제 0건."
					: "아래 수치는 부분 검증 결과이며 안전한 변경을 보증하지 않습니다."}
			</p>
			{!certified ? (
				<dl className="tilefab-bay-flow-findings">
					{TOPOLOGY_FINDINGS.map(([key, label]) => (
						<div key={key}>
							<dt>{label}</dt>
							<dd>{countChange(source[key], prospective[key])}</dd>
						</div>
					))}
				</dl>
			) : null}
		</section>
	);
}

const TOPOLOGY_FINDINGS = [
	["authoredOpenTerminalCount", "열린 레일 끝점"],
	["authoredUnsafeJunctionCount", "위험 분기"],
	["physicalOpenPathCount", "열린 실제 경로"],
	["physicalInvalidPathCount", "잘못된 경로"],
	["physicalDiagnosticCount", "진단 문제"],
	["physicalTerminalCount", "경로 종단"],
	["physicalClearanceIssueCount", "간섭 문제"],
] as const;

function countChange(before: number, after: number): string {
	return `${before.toLocaleString()} → ${after.toLocaleString()}`;
}

function BoundedValues({
	label,
	values,
	total,
}: Readonly<{ label: string; values: readonly string[]; total: number }>): React.ReactElement {
	const visible = values.slice(0, STATIC_FAB_BAY_FLOW_EDIT_DETAIL_LIMIT);
	const omitted = Math.max(0, total - visible.length);
	return (
		<p className="tilefab-bay-flow-identity">
			<strong>{label}</strong>
			<span>
				{visible.length > 0 ? visible.join(", ") : "없음"}
				{omitted > 0 ? ` 외 ${omitted.toLocaleString()}개` : ""}
			</span>
		</p>
	);
}

function flowLabel(value: "alternating" | "co-rotating" | null): string {
	return value === "co-rotating"
		? "같은 방향 (CO-ROTATING)"
		: value === "alternating"
			? "교대 방향 (ALTERNATING)"
			: "확인되지 않음";
}

function trapTabNavigation(event: KeyboardEvent, dialog: HTMLElement): void {
	const focusable = [
		...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), summary, [tabindex]"),
	].filter(
		(element) =>
			element.tabIndex >= 0 &&
			!element.hasAttribute("disabled") &&
			element.getClientRects().length > 0,
	);
	if (focusable.length === 0) {
		event.preventDefault();
		dialog.focus({ preventScroll: true });
		return;
	}
	const first = focusable[0] as HTMLElement;
	const last = focusable[focusable.length - 1] as HTMLElement;
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus({ preventScroll: true });
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus({ preventScroll: true });
	}
}
