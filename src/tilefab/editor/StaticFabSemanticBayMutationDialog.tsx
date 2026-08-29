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
	/** Requests adoption/commit. The dialog never owns a plan, ticket, Worker, or document command. */
	readonly onApply: () => void;
}

export function StaticFabSemanticBayMutationDialog({
	session,
	returnFocus,
	onAnalyze,
	onCancel,
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

	const requestCancel = (): void => {
		if (applying) return;
		restoreLauncherOnUnmountRef.current = true;
		onCancel();
	};
	const requestApply = (): void => {
		if (!canApply) return;
		restoreLauncherOnUnmountRef.current = false;
		onApply();
	};
	const commandLabel = session.action === "DISCONNECT" ? "DISCONNECT BAY" : "DELETE BAY";
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
						<small>SEMANTIC BAY COMMAND</small>
						<strong id={titleId} className="tilefab-semantic-bay-dialog-title">
							{commandLabel}
						</strong>
					</span>
					<code className="tilefab-semantic-bay-dialog-id">ORG {session.bayOrganizationId}</code>
				</header>

				<div className="tilefab-semantic-bay-workspace">
					<p id={descriptionId} className="tilefab-semantic-bay-intro">
						<strong className="tilefab-semantic-bay-intro-name">{session.bayName}</strong>
						{session.action === "DISCONNECT"
							? " will remain authored as an independent closed Bay."
							: " and its owned static content will be removed together."}
					</p>

					<CommandStatus session={session} />
					{session.review ? <ImpactReview review={session.review} /> : null}
					{session.sourceEvidence && session.prospectiveEvidence ? (
						<WorkerEvidence
							action={session.action}
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
						data-testid="semantic-bay-command-cancel"
						data-initial-focus="true"
						disabled={applying}
						onClick={requestCancel}
					>
						X&nbsp; CANCEL
					</button>
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
						{applying ? "APPLYING" : commandLabel}
					</button>
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
			? "ANALYZING EXACT SOURCE"
			: state === "ready"
				? "READY TO APPLY"
				: state === "rejected"
					? "COMMAND BLOCKED"
					: "APPLYING ONE ATOMIC COMMAND";
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

function ImpactReview({
	review,
}: Readonly<{ review: StaticFabSemanticBayMutationReview }>): React.ReactElement {
	const processLoops = plural(review.processLoopCount, "Process Loop");
	const modules = plural(review.railModuleCount, "rail module");
	const switches = plural(review.advancedSwitchCount, "advanced switch");
	const equipment = plural(review.equipmentGroupCount, "equipment group");
	const ports = plural(review.portCount, "port");
	const removedOrganizationCount = review.action === "DELETE" ? review.processLoopCount + 1 : 0;
	const connectorIdentitySamples = boundedConnectorIdentitySamples(review);
	return (
		<section
			className="tilefab-semantic-bay-review"
			aria-labelledby="semantic-bay-impact-title"
			data-review-action={review.action}
			data-review-equipment-group-count={review.equipmentGroupCount}
			data-review-port-count={review.portCount}
		>
			<header>
				<strong id="semantic-bay-impact-title">EXACT IMPACT REVIEW</strong>
				<small>PLANNER REVIEW · WORKER EVIDENCE BELOW</small>
			</header>
			<div className="tilefab-semantic-bay-impact-grid">
				{review.action === "DISCONNECT" ? (
					<>
						<article data-impact="preserved">
							<strong>PRESERVED</strong>
							<p className="tilefab-semantic-bay-impact-copy">
								The Bay, {processLoops}, {modules}, {switches}, {equipment}, and {ports} stay
								authored.
							</p>
						</article>
						<article data-impact="removed">
							<strong>REMOVED</strong>
							<p className="tilefab-semantic-bay-impact-copy">
								{connectorSummary(review)} and the Bank parent relation are removed.
							</p>
							<small className="tilefab-semantic-bay-impact-detail">
								{plural(review.remainingBankDirectedEdgeCount, "remaining Bank directed edge")} ·
								circulation candidate{" "}
								{review.retainedCirculationCandidatePresent ? "PRESENT" : "NOT PRESENT"}
							</small>
						</article>
					</>
				) : (
					<>
						<article data-impact="removed">
							<strong>REMOVED</strong>
							<p className="tilefab-semantic-bay-impact-copy">
								{plural(removedOrganizationCount, "organization")}, {processLoops}, {modules},{" "}
								{plural(review.bayDirectedEdgeCount, "Bay-owned directed edge")}, {switches},{" "}
								{equipment}, and {ports} are removed.
							</p>
							<small className="tilefab-semantic-bay-impact-detail">
								{review.incidentConnectorCount > 0
									? `${connectorSummary(review)} is removed in the same atomic command.`
									: "The Bay is already detached; no Bank connector changes."}
							</small>
						</article>
						<article data-impact="preserved">
							<strong>PRESERVED</strong>
							<p className="tilefab-semantic-bay-impact-copy">
								{review.bankOrganizationId === null
									? "The detached Bay does not change a Bank circulation."
									: `${plural(review.remainingBankDirectedEdgeCount, "remaining Bank directed edge")} stay authored.`}
							</p>
							<small className="tilefab-semantic-bay-impact-detail">
								Retained circulation candidate ·{" "}
								{review.retainedCirculationCandidatePresent ? "PRESENT" : "NOT PRESENT"}
							</small>
						</article>
					</>
				)}
			</div>
			<section
				className="tilefab-semantic-bay-bounded-details"
				aria-label="Bounded exact identities"
			>
				<BoundedIdentity
					label="PROCESS LOOPS"
					values={review.processLoopOrganizationIds}
					totalCount={review.processLoopCount}
				/>
				<BoundedIdentity
					label="RAIL MODULES"
					values={review.railModuleKeys}
					totalCount={review.railModuleCount}
				/>
				<BoundedIdentity
					label="CONNECTOR EDGES"
					values={connectorIdentitySamples}
					totalCount={review.connectorDirectedEdgeCount}
				/>
				{review.action === "DELETE" ? (
					<>
						<BoundedIdentity
							label="REMOVED ORGANIZATIONS"
							values={review.removedOrganizationIds}
							totalCount={removedOrganizationCount}
						/>
						<BoundedIdentity
							label="EQUIPMENT"
							values={review.equipmentGroupIds}
							totalCount={review.equipmentGroupCount}
						/>
						<BoundedIdentity label="PORTS" values={review.portIds} totalCount={review.portCount} />
					</>
				) : null}
			</section>
			<p className="tilefab-semantic-bay-candidate-note">
				Circulation candidate status is core planning evidence, not certification. Exact topology
				certification is reported separately below.
			</p>
		</section>
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
	return (
		<section className="tilefab-semantic-bay-evidence" data-certified={certified}>
			<header>
				<span aria-hidden="true">
					<ShieldCheck size={16} />
				</span>
				<span>
					<strong>{certified ? "WORKER-CERTIFIED TOPOLOGY" : "WORKER TOPOLOGY EVIDENCE"}</strong>
					<small>
						All source and result components are independently closed · authored{" "}
						{signedDelta(authoredDelta)} · physical {signedDelta(physicalDelta)} · {action}
					</small>
				</span>
			</header>
			<div className="tilefab-semantic-bay-evidence-grid">
				<TopologyEvidenceColumn label="SOURCE" evidence={source} />
				<TopologyEvidenceColumn label="RESULT" evidence={prospective} />
			</div>
			<section
				className="tilefab-semantic-bay-scope-row"
				data-certified={certified}
				aria-label={certified ? "Verified scopes" : "Evaluated scopes"}
			>
				<span className="tilefab-semantic-bay-scope">GEOMETRY</span>
				<span className="tilefab-semantic-bay-scope">DIRECTED TOPOLOGY</span>
				<span className="tilefab-semantic-bay-scope">ORGANIZATION</span>
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
				<dd>{evidence.authoredDirectedEdgeCount.toLocaleString()} EDGES</dd>
			</div>
			<div>
				<dt>AUTHORED COMPONENTS</dt>
				<dd>{evidence.authoredComponentCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>DIRECTED SCC</dt>
				<dd>{evidence.authoredStrongComponentCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>PHYSICAL COMPONENTS</dt>
				<dd>{evidence.physicalComponentCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>OPEN TERMINALS</dt>
				<dd>{evidence.authoredOpenTerminalCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>CLEARANCE ISSUES</dt>
				<dd>{evidence.physicalClearanceIssueCount.toLocaleString()}</dd>
			</div>
			<div>
				<dt>PHYSICAL DIAGNOSTICS</dt>
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
				{visible.length === 0 ? (totalCount === 0 ? "NONE" : "NO SAMPLE") : visible.join(", ")}
				{remainder > 0 ? ` +${remainder.toLocaleString()} MORE` : ""}
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

function connectorSummary(review: StaticFabSemanticBayMutationReview): string {
	return review.incidentConnectorCount === 0
		? "No incident Bank connector"
		: `${plural(review.incidentConnectorCount, "incident Bank connector")} (${plural(
				review.connectorDirectedEdgeCount,
				"directed edge",
			)})`;
}

function plural(count: number, noun: string): string {
	return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function signedDelta(delta: number): string {
	return `Δ${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`;
}

const FOCUSABLE_SELECTOR =
	"button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function trapTabNavigation(event: globalThis.KeyboardEvent, root: HTMLElement): void {
	const controls = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(element) =>
			!element.hidden && !element.inert && element.getAttribute("aria-hidden") !== "true",
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
