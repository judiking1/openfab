import { Check, LoaderCircle, ShieldCheck, Trash2, Unlink, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { StaticFabSemanticBayMutationReview } from "../core/StaticFabSemanticBayMutation";
import type { StaticFabSemanticBayMutationTopologyEvidence } from "../worker/StaticFabSemanticBayMutationProtocol";
import {
	type StaticFabSemanticBayMutationSession,
	staticFabSemanticBayMutationSessionCanApply,
} from "./StaticFabSemanticBayMutationSession";
import "./StaticFabSemanticBayMutationDialog.css";

export const STATIC_FAB_SEMANTIC_BAY_MUTATION_DETAIL_LIMIT = 4;

export interface StaticFabSemanticBayMutationDialogProps {
	readonly session: StaticFabSemanticBayMutationSession;
	readonly returnFocus?: HTMLElement | null;
	/** Invoked after the analyzing dialog has painted; the caller retains all Worker authority. */
	readonly onAnalyze: (requestSequence: number) => void;
	readonly onCancel: () => void;
	/** Rechecks the current document; the caller discards every previous snapshot and permit. */
	readonly onRetry: () => void;
	/** Requests adoption/commit. The dialog never owns a plan, ticket, Worker, or document command. */
	readonly onApply: () => void;
}

export function StaticFabSemanticBayMutationDialog({
	session,
	returnFocus,
	onAnalyze,
	onCancel,
	onRetry,
	onApply,
}: StaticFabSemanticBayMutationDialogProps): React.ReactElement {
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
	const canApply = staticFabSemanticBayMutationSessionCanApply(session);

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

		const handleWindowKeyDown = (event: globalThis.KeyboardEvent): void => {
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
			if (event.key !== "Tab") return;
			trapTabNavigation(event, dialog);
		};
		window.addEventListener("keydown", handleWindowKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown, true);
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
		const requestSequence = session.requestSequence;
		const frame = requestAnimationFrame(() => onAnalyzeRef.current(requestSequence));
		return () => cancelAnimationFrame(frame);
	}, [session.phase, session.requestSequence]);
	useEffect(() => {
		if (session.phase === "rejected" && document.activeElement === dialogRef.current) {
			cancelRef.current?.focus({ preventScroll: true });
		}
	}, [session.phase]);

	const requestCancel = (): void => {
		if (applying) return;
		restoreLauncherOnUnmountRef.current = true;
		onCancel();
	};
	const requestApply = (): void => {
		if (!canApply) return;
		restoreLauncherOnUnmountRef.current = false;
		dialogRef.current?.focus({ preventScroll: true });
		onApply();
	};
	const commandLabel = session.action === "DISCONNECT" ? "Bay 분리" : "Bay 삭제";
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
				className="tilefab-semantic-bay-dialog tilefab-semantic-bay-mutation-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				aria-busy={applying}
				tabIndex={-1}
				data-testid="semantic-bay-command-dialog"
				data-command={session.action === "DISCONNECT" ? "disconnect-bay" : "delete-bay"}
				data-action={session.action}
				data-phase={session.phase}
			>
				<header>
					<span className="tilefab-semantic-bay-heading-icon" aria-hidden="true">
						{session.action === "DISCONNECT" ? <Unlink size={19} /> : <Trash2 size={19} />}
					</span>
					<span>
						<small>변경 내용 확인</small>
						<strong id={titleId} className="tilefab-semantic-bay-dialog-title">
							{commandLabel}
						</strong>
					</span>
				</header>

				<div className="tilefab-semantic-bay-workspace">
					<p id={descriptionId} className="tilefab-semantic-bay-intro">
						<strong className="tilefab-semantic-bay-intro-name">{session.bayName}</strong> ·{" "}
						{session.action === "DISCONNECT"
							? "Bank에서 분리합니다. Bay 내부 레일과 장비는 유지됩니다."
							: "이 Bay와 소유한 내부 레일·장비를 함께 삭제합니다."}
					</p>

					{session.review ? (
						<ImpactReview review={session.review} rejected={session.phase === "rejected"} />
					) : null}
					<CommandStatus session={session} />
					<ClosureSummary session={session} />
					{(canApply || applying) && (
						<p className="tilefab-semantic-bay-undo-note">
							적용하면 실행 취소 한 번으로 되돌릴 수 있습니다.
						</p>
					)}
					<TechnicalDetails session={session} />
				</div>

				<footer>
					<button
						ref={cancelRef}
						type="button"
						data-testid="semantic-bay-command-cancel"
						data-initial-focus="true"
						disabled={applying}
						onClick={requestCancel}
					>
						{session.phase === "rejected" ? "닫고 수정하기" : "취소"}
					</button>
					{session.phase === "rejected" ? (
						<button
							type="button"
							data-testid="semantic-bay-command-retry"
							onClick={() => {
								cancelRef.current?.focus({ preventScroll: true });
								onRetry();
							}}
						>
							다시 검토
						</button>
					) : (
						<button
							type="button"
							className="tilefab-semantic-bay-apply"
							data-testid="semantic-bay-command-apply"
							data-action={session.action}
							disabled={!canApply}
							onClick={requestApply}
						>
							{applying ? (
								<LoaderCircle className="tilefab-semantic-bay-spinner" size={15} />
							) : session.action === "DISCONNECT" ? (
								<Unlink size={15} />
							) : (
								<Trash2 size={15} />
							)}
							{applying ? "적용 중…" : commandLabel}
						</button>
					)}
				</footer>
			</section>
		</div>
	);

	return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function CommandStatus({
	session,
}: Readonly<{ session: StaticFabSemanticBayMutationSession }>): React.ReactElement {
	const state = session.phase;
	const title =
		state === "analyzing"
			? "변경 영향을 검토하고 있습니다"
			: state === "ready"
				? "검토 완료 · 적용할 수 있습니다"
				: state === "rejected"
					? "변경을 적용할 수 없습니다"
					: "변경을 적용하고 있습니다";
	const detail =
		state === "rejected"
			? "아직 적용되지 않았습니다. 검토 상세에서 사유를 확인하고 지도를 수정하거나 다시 검토하세요."
			: state === "ready"
				? "아직 적용되지 않았습니다. 위의 변경 대상을 확인한 뒤 적용하세요."
				: state === "analyzing"
					? "현재 지도의 연결과 변경 후 남는 경로를 확인합니다. 취소하면 지도를 바꾸지 않습니다."
					: "레일·조직·장비를 하나의 변경으로 반영합니다. 잠시 기다려 주세요.";
	return (
		<section
			className="tilefab-semantic-bay-status"
			data-state={state}
			role={state === "rejected" ? "alert" : "status"}
			aria-live={state === "rejected" ? "assertive" : "polite"}
			aria-atomic="true"
		>
			<span aria-hidden="true">
				{state === "analyzing" || state === "applying" ? (
					<LoaderCircle className="tilefab-semantic-bay-spinner" size={17} />
				) : state === "ready" ? (
					<Check size={17} />
				) : (
					<X size={17} />
				)}
			</span>
			<span className="tilefab-semantic-bay-status-copy">
				<strong className="tilefab-semantic-bay-status-title">{title}</strong>
				<small className="tilefab-semantic-bay-status-detail">{detail}</small>
				{state === "rejected" && (
					<small className="tilefab-semantic-bay-status-detail tilefab-semantic-bay-rejection-reason">
						{session.reason}
					</small>
				)}
			</span>
		</section>
	);
}

function ImpactReview({
	review,
	rejected,
}: Readonly<{
	review: StaticFabSemanticBayMutationReview;
	rejected: boolean;
}>): React.ReactElement {
	if (review.issueCode !== null)
		return (
			<section className="tilefab-semantic-bay-review" aria-label="변경 대상 확인 필요">
				<header>
					<strong>변경 대상 확인 필요</strong>
				</header>
				<p className="tilefab-semantic-bay-impact-copy">
					{review.issueCode === "ALREADY_DISCONNECTED"
						? "이미 Bank에서 분리된 Bay입니다. 제거할 Bank 연결이 없습니다."
						: "변경 대상을 확정하지 못했습니다. 아래 거절 사유를 확인하세요."}
				</p>
			</section>
		);
	const contents = `내부 순환로 ${review.processLoopCount.toLocaleString()}개 · 레일 모듈 ${review.railModuleCount.toLocaleString()}개 · 분기기 ${review.advancedSwitchCount.toLocaleString()}개 · 장비 ${review.equipmentGroupCount.toLocaleString()}개 · 포트 ${review.portCount.toLocaleString()}개`;
	return (
		<section
			className="tilefab-semantic-bay-review"
			aria-label="변경 대상"
			data-review-action={review.action}
			data-review-equipment-group-count={review.equipmentGroupCount}
			data-review-port-count={review.portCount}
		>
			<header>
				<strong>{rejected ? "검토한 변경 대상 · 적용되지 않음" : "변경 대상"}</strong>
			</header>
			<div className="tilefab-semantic-bay-impact-grid">
				<article data-impact="removed">
					<strong>없어지는 항목</strong>
					<p className="tilefab-semantic-bay-impact-copy">
						{review.action === "DELETE"
							? "선택한 Bay와 소유한 내부 구성"
							: "Bank와 이어지는 연결 레일·상위 소속"}
					</p>
					<p className="tilefab-semantic-bay-impact-detail">
						{review.action === "DELETE"
							? contents
							: `연결 ${review.incidentConnectorCount.toLocaleString()}개를 제거하고 독립된 Bay로 남깁니다.`}
					</p>
					{review.action === "DELETE" && (
						<p className="tilefab-semantic-bay-impact-detail">
							{review.incidentConnectorCount > 0
								? `Bank 연결 ${review.incidentConnectorCount.toLocaleString()}개도 함께 제거합니다.`
								: "이미 분리된 Bay이므로 Bank 연결은 바뀌지 않습니다."}
						</p>
					)}
				</article>
				<article data-impact="preserved">
					<strong>유지되는 항목</strong>
					<p className="tilefab-semantic-bay-impact-copy">
						{review.action === "DISCONNECT"
							? "Bay 내부 구성"
							: review.bankOrganizationId === null
								? "선택한 Bay 밖의 구성"
								: "나머지 Bank 레일"}
					</p>
					<p className="tilefab-semantic-bay-impact-detail">
						{review.action === "DISCONNECT"
							? contents
							: review.bankOrganizationId === null
								? "다른 Bay와 장비는 이 삭제 대상에 포함되지 않습니다."
								: `Bank의 방향 레일 ${review.remainingBankDirectedEdgeCount.toLocaleString()}개를 유지합니다.`}
					</p>
				</article>
			</div>
		</section>
	);
}

function ClosureSummary({
	session,
}: Readonly<{ session: StaticFabSemanticBayMutationSession }>): React.ReactElement | null {
	if (!session.sourceEvidence && !session.prospectiveEvidence) return null;
	const rows = [
		{
			label: session.phase === "rejected" ? "검토 당시 지도" : "현재 지도",
			evidence: session.sourceEvidence,
		},
		{
			label: session.phase === "rejected" ? "당시 변경 예상" : "변경 후 예상",
			evidence: session.prospectiveEvidence,
		},
	];
	return (
		<section
			className="tilefab-semantic-bay-closure"
			aria-label="경로 검토 결과"
			data-testid="semantic-bay-closure-summary"
		>
			<strong>경로 검토 결과</strong>
			{rows.map(({ label, evidence }) => {
				const closed =
					evidence?.authoredComponentsClosed === true && evidence.physicalComponentsClosed;
				const message =
					evidence === null
						? "확인하지 못함"
						: !closed
							? "연결 또는 물리 경로 검토 실패"
							: evidence.authoredCellCount === 0
								? "남는 레일 없음"
								: "각 레일 구역의 순환 경로 확인";
				return (
					<div key={label} data-closed={evidence === null ? "unknown" : String(closed)}>
						<span>{label}</span>
						<strong>{message}</strong>
					</div>
				);
			})}
			{session.phase === "rejected" && (
				<small>이전 검토 결과입니다. 현재 작업의 적용을 허용하는 결과가 아닙니다.</small>
			)}
		</section>
	);
}

function TechnicalDetails({
	session,
}: Readonly<{ session: StaticFabSemanticBayMutationSession }>): React.ReactElement {
	const review = session.review;
	return (
		<details className="tilefab-semantic-bay-disclosure" data-testid="semantic-bay-command-details">
			<summary>검토 상세 · 연결 수치와 사유</summary>
			<div className="tilefab-semantic-bay-disclosure-body">
				<p className="tilefab-semantic-bay-reason">{session.reason}</p>
				<p>
					조직 ID {session.bayOrganizationId}
					{session.timings
						? ` · 계획 ${session.timings.planningMilliseconds.toFixed(1)}ms · 검증 ${session.timings.validationMilliseconds.toFixed(1)}ms`
						: ""}
				</p>
				{review && review.issueCode === null && (
					<>
						<p>
							Bank 순환 경로 후보: {review.retainedCirculationCandidatePresent ? "있음" : "없음"}.
							경로 후보의 유무만으로 적용을 허용하지 않습니다.
						</p>
						<section className="tilefab-semantic-bay-bounded-details" aria-label="대상 식별자 일부">
							<BoundedIdentity
								label="내부 순환로"
								values={review.processLoopOrganizationIds}
								totalCount={review.processLoopCount}
							/>
							<BoundedIdentity
								label="레일 모듈"
								values={review.railModuleKeys}
								totalCount={review.railModuleCount}
							/>
							<BoundedIdentity
								label="연결 레일"
								values={boundedConnectorIdentitySamples(review)}
								totalCount={review.connectorDirectedEdgeCount}
							/>
							{review.action === "DELETE" && (
								<>
									<BoundedIdentity
										label="삭제 조직"
										values={review.removedOrganizationIds}
										totalCount={review.processLoopCount + 1}
									/>
									<BoundedIdentity
										label="장비"
										values={review.equipmentGroupIds}
										totalCount={review.equipmentGroupCount}
									/>
									<BoundedIdentity
										label="포트"
										values={review.portIds}
										totalCount={review.portCount}
									/>
								</>
							)}
						</section>
					</>
				)}
				{session.sourceEvidence && session.prospectiveEvidence && (
					<WorkerEvidence
						action={session.action}
						source={session.sourceEvidence}
						prospective={session.prospectiveEvidence}
						certified={
							staticFabSemanticBayMutationSessionCanApply(session) || session.phase === "applying"
						}
					/>
				)}
			</div>
		</details>
	);
}

function WorkerEvidence({
	action,
	source,
	prospective,
	certified,
}: Readonly<{
	action: StaticFabSemanticBayMutationSession["action"];
	source: StaticFabSemanticBayMutationTopologyEvidence;
	prospective: StaticFabSemanticBayMutationTopologyEvidence;
	certified: boolean;
}>): React.ReactElement {
	const authoredDelta = prospective.authoredComponentCount - source.authoredComponentCount;
	const physicalDelta = prospective.physicalComponentCount - source.physicalComponentCount;
	const allClosed =
		source.authoredComponentsClosed &&
		source.physicalComponentsClosed &&
		prospective.authoredComponentsClosed &&
		prospective.physicalComponentsClosed;
	return (
		<section className="tilefab-semantic-bay-evidence" data-certified={certified && allClosed}>
			<header>
				<span aria-hidden="true">
					{certified && allClosed ? <ShieldCheck size={16} /> : <X size={16} />}
				</span>
				<span>
					<strong>{certified && allClosed ? "연결 검증 완료" : "참고용 경로 검토 수치"}</strong>
					<small>
						{allClosed
							? certified
								? "현재·예상 지도의 경로 조건 충족"
								: "검토 당시 지도의 경로 조건 충족 · 현재 적용 허용 아님"
							: "검토 자료의 연결 또는 물리 경로 조건 미충족"}{" "}
						· 연결 구역 {signedDelta(authoredDelta)} · 물리 구역 {signedDelta(physicalDelta)} ·{" "}
						{action}
					</small>
				</span>
			</header>
			<div className="tilefab-semantic-bay-evidence-grid">
				<TopologyEvidenceColumn
					label={certified ? "현재 지도" : "검토 당시 지도"}
					evidence={source}
				/>
				<TopologyEvidenceColumn
					label={certified ? "변경 후 예상" : "당시 변경 예상"}
					evidence={prospective}
				/>
			</div>
			<section
				className="tilefab-semantic-bay-scope-row"
				data-certified={certified && allClosed}
				aria-label={certified && allClosed ? "검증한 범위" : "검토한 범위"}
			>
				<span className="tilefab-semantic-bay-scope">레일 형상</span>
				<span className="tilefab-semantic-bay-scope">방향 연결</span>
				<span className="tilefab-semantic-bay-scope">조직 소유</span>
			</section>
		</section>
	);
}

function TopologyEvidenceColumn({
	label,
	evidence,
}: Readonly<{
	label: string;
	evidence: StaticFabSemanticBayMutationTopologyEvidence;
}>): React.ReactElement {
	return (
		<dl>
			<div>
				<dt>{label}</dt>
				<dd>{evidence.authoredDirectedEdgeCount.toLocaleString()} 방향 레일</dd>
			</div>
			<div>
				<dt>연결 구역</dt>
				<dd>{evidence.authoredComponentCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>방향 순환 구역</dt>
				<dd>{evidence.authoredStrongComponentCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>물리 구역</dt>
				<dd>{evidence.physicalComponentCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>열린 끝점</dt>
				<dd>{evidence.authoredOpenTerminalCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>간격 문제</dt>
				<dd>{evidence.physicalClearanceIssueCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>물리 진단</dt>
				<dd>{evidence.physicalDiagnosticCount.toLocaleString()}</dd>
			</div>
		</dl>
	);
}

function BoundedIdentity({
	label,
	values,
	totalCount,
}: Readonly<{
	label: string;
	values: readonly (number | string)[];
	totalCount: number;
}>): React.ReactElement {
	const visible = values.slice(
		0,
		Math.min(STATIC_FAB_SEMANTIC_BAY_MUTATION_DETAIL_LIMIT, Math.max(0, totalCount)),
	);
	const remainder = Math.max(0, totalCount - visible.length);
	return (
		<span className="tilefab-semantic-bay-identity">
			<strong className="tilefab-semantic-bay-identity-label">{label}</strong>
			<code className="tilefab-semantic-bay-identity-values">
				{visible.length === 0
					? totalCount === 0
						? "없음"
						: "식별자 표본 없음"
					: visible.join(", ")}
				{remainder > 0 ? ` 외 ${remainder.toLocaleString()}개` : ""}
			</code>
		</span>
	);
}

function boundedConnectorIdentitySamples(
	review: StaticFabSemanticBayMutationReview,
): readonly string[] {
	const values: string[] = [];
	let outboundIndex = 0;
	let returnIndex = 0;
	while (values.length < STATIC_FAB_SEMANTIC_BAY_MUTATION_DETAIL_LIMIT) {
		const outbound = review.connectorOutboundDirectedEdgeKeys[outboundIndex++];
		if (outbound !== undefined) values.push(`OUT ${outbound}`);
		if (values.length >= STATIC_FAB_SEMANTIC_BAY_MUTATION_DETAIL_LIMIT) break;
		const returning = review.connectorReturnDirectedEdgeKeys[returnIndex++];
		if (returning !== undefined) values.push(`RETURN ${returning}`);
		if (outbound === undefined && returning === undefined) break;
	}
	return values;
}

function signedDelta(delta: number): string {
	return `Δ${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`;
}

const FOCUSABLE_SELECTOR =
	"summary, button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function trapTabNavigation(event: globalThis.KeyboardEvent, root: HTMLElement): void {
	const controls = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(element) =>
			!element.closest('[hidden], [inert], [aria-hidden="true"]') &&
			element.getClientRects().length > 0,
	);
	if (controls.length === 0) {
		event.preventDefault();
		root.focus({ preventScroll: true });
		return;
	}
	const first = controls[0] as HTMLElement;
	const last = controls[controls.length - 1] as HTMLElement;
	const active = document.activeElement;
	const activeInside = active !== root && active instanceof Node && root.contains(active);
	if (event.shiftKey && (active === first || !activeInside)) {
		event.preventDefault();
		last.focus({ preventScroll: true });
	} else if (!event.shiftKey && (active === last || !activeInside)) {
		event.preventDefault();
		first.focus({ preventScroll: true });
	}
}
