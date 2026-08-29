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
						<small>SEMANTIC BAY COMMAND</small>
						<strong id={titleId} className="tilefab-semantic-bay-dialog-title">
							CHANGE BAY FLOW
						</strong>
					</span>
					<code className="tilefab-semantic-bay-dialog-id">ORG {session.bayOrganizationId}</code>
				</header>
				<div className="tilefab-semantic-bay-workspace">
					<p id={descriptionId} className="tilefab-semantic-bay-intro">
						<strong className="tilefab-semantic-bay-intro-name">{session.bayName}</strong> will
						replace its recognized internal flow with an explicit{" "}
						<strong>{flowLabel(session.targetInternalFlowPattern)}</strong> target.
					</p>
					<CommandStatus session={session} />
					{session.review ? <FlowReview review={session.review} /> : null}
					{session.sourceEvidence && session.prospectiveEvidence ? (
						<WorkerEvidence
							source={session.sourceEvidence}
							prospective={session.prospectiveEvidence}
							certified={session.phase === "ready" || session.phase === "applying"}
						/>
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
						X&nbsp; CANCEL
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
						{applying ? "APPLYING" : "CHANGE FLOW"}
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
			? "ANALYZING EXACT SOURCE"
			: session.phase === "ready"
				? "READY TO APPLY"
				: session.phase === "rejected"
					? "COMMAND BLOCKED"
					: "APPLYING ONE ATOMIC COMMAND";
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
				<small className="tilefab-semantic-bay-status-detail">{session.reason}</small>
			</span>
			{session.timings ? (
				<code className="tilefab-semantic-bay-status-timing">
					{session.timings.planningMilliseconds.toFixed(1)} +{" "}
					{session.timings.validationMilliseconds.toFixed(1)} ms
				</code>
			) : null}
		</section>
	);
}

function FlowReview({
	review,
}: Readonly<{ review: StaticFabBayFlowEditReview }>): React.ReactElement {
	const connectorKeys = [
		...review.connectorBankToBayDirectedEdgeKeys,
		...review.connectorBayToBankDirectedEdgeKeys,
	];
	return (
		<section className="tilefab-semantic-bay-review" aria-label="Exact flow replacement review">
			<header>
				<strong>EXACT FLOW REVIEW</strong>
				<small>PLANNER REVIEW · WORKER EVIDENCE BELOW</small>
			</header>
			<div className="tilefab-semantic-bay-impact-grid">
				<article data-impact="removed">
					<strong>REPLACED</strong>
					<p className="tilefab-semantic-bay-impact-copy">
						{flowLabel(review.sourceInternalFlowPattern)} →{" "}
						{flowLabel(review.targetInternalFlowPattern)} ·{" "}
						{review.removedDirectedEdgeCount.toLocaleString()} removed +{" "}
						{review.addedDirectedEdgeCount.toLocaleString()} added directed edges.
					</p>
					<small className="tilefab-semantic-bay-impact-detail">
						{review.changedCellCount.toLocaleString()} changed cells ·{" "}
						{review.changedOrganizationIds.length.toLocaleString()} existing memberships
					</small>
				</article>
				<article data-impact="preserved">
					<strong>FIXED</strong>
					<p className="tilefab-semantic-bay-impact-copy">
						Bay identity, Process Loops, Bank relation, external gateway, envelope, and equipment
						remain authored.
					</p>
					<small className="tilefab-semantic-bay-impact-detail">
						{review.incidentConnectorCount === 1
							? connectorKeys.length.toLocaleString() +
								" connector edges · Bank ORG " +
								String(review.bankOrganizationId)
							: "Detached Bay · no external connector"}
					</small>
				</article>
			</div>
			<div className="tilefab-semantic-bay-bounded-details">
				<BoundedValues
					label="PROCESS LOOPS"
					values={review.processLoopOrganizationIds.map((id) => `ORG ${id}`)}
					total={review.processLoopOrganizationIds.length}
				/>
				<BoundedValues
					label="FIXED CONNECTOR"
					values={connectorKeys}
					total={connectorKeys.length}
				/>
			</div>
		</section>
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
		<section className="tilefab-semantic-bay-evidence" aria-label="Worker topology evidence">
			<header>
				<strong>WORKER-CERTIFIED TOPOLOGY</strong>
				<small>{certified ? "EXACT · SOURCE-BOUND" : "NOT CERTIFIED"}</small>
			</header>
			<div className="tilefab-semantic-bay-evidence-grid">
				<article>
					<ShieldCheck size={16} />
					<strong>AUTHORED</strong>
					<small>
						{source.authoredCellCount.toLocaleString()} cells ·{" "}
						{source.authoredDirectedEdgeCount.toLocaleString()} edges ·{" "}
						{source.authoredComponentCount} weak / {source.authoredStrongComponentCount} SCC
					</small>
				</article>
				<article>
					<ShieldCheck size={16} />
					<strong>PHYSICAL</strong>
					<small>
						{source.physicalPathCount.toLocaleString()} paths · {source.physicalComponentCount} weak
						/ {source.physicalStrongComponentCount} SCC
					</small>
				</article>
			</div>
			<p className="tilefab-semantic-bay-candidate-note">
				Source and result counts are equal: authored{" "}
				{prospective.authoredDirectedEdgeCount.toLocaleString()} edges · physical{" "}
				{prospective.physicalPathCount.toLocaleString()} paths · zero open, unsafe, diagnostic,
				terminal, or clearance findings.
			</p>
		</section>
	);
}

function BoundedValues({
	label,
	values,
	total,
}: Readonly<{ label: string; values: readonly string[]; total: number }>): React.ReactElement {
	const visible = values.slice(0, STATIC_FAB_BAY_FLOW_EDIT_DETAIL_LIMIT);
	const omitted = Math.max(0, total - visible.length);
	return (
		<p>
			<strong>{label}</strong>
			<span>
				{visible.length > 0 ? visible.join(", ") : "NONE"}
				{omitted > 0 ? ` +${omitted.toLocaleString()} MORE` : ""}
			</span>
		</p>
	);
}

function flowLabel(value: "alternating" | "co-rotating" | null): string {
	return value === "co-rotating"
		? "CO-ROTATING"
		: value === "alternating"
			? "ALTERNATING"
			: "UNRECOGNIZED";
}

function trapTabNavigation(event: KeyboardEvent, dialog: HTMLElement): void {
	const focusable = [
		...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex]"),
	].filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));
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
