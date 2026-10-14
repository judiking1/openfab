import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import type { AuthoringTaskPresentation } from "./AuthoringTaskPresentation";

export interface ActiveAuthoringWorkspaceProps {
	readonly task: AuthoringTaskPresentation;
	readonly compact: boolean;
	readonly expanded: boolean;
	readonly onExpandedChange: (expanded: boolean) => void;
	readonly headingActions?: ReactNode;
	readonly children?: ReactNode;
	readonly feedback?: ReactNode;
	readonly actions?: ReactNode;
	readonly guidance?: ReactNode;
	readonly guidanceLabel?: string;
	readonly guidanceGoal?: string;
	readonly onExitGuidance?: () => void;
}

/** Keeps task controls mounted; the caller retains drafts, validation and command authority. */
export function ActiveAuthoringWorkspace({
	task,
	compact,
	expanded,
	onExpandedChange,
	headingActions,
	children,
	feedback,
	actions,
	guidance,
	guidanceLabel,
	guidanceGoal,
	onExitGuidance,
}: ActiveAuthoringWorkspaceProps): ReactNode {
	const instanceId = useId();
	const titleId = `${instanceId}-title`;
	const bodyId = `${instanceId}-body`;
	const headingActionsId = `${instanceId}-heading-actions`;
	const toggleRef = useRef<HTMLButtonElement>(null);
	const headingActionsRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (expanded) return;
		const activeElement = toggleRef.current?.ownerDocument.activeElement;
		if (
			activeElement &&
			(bodyRef.current?.contains(activeElement) ||
				headingActionsRef.current?.contains(activeElement))
		) {
			toggleRef.current?.focus({ preventScroll: true });
		}
	}, [expanded]);

	return (
		<section
			id="openfab-active-authoring-workspace"
			className="tilefab-active-authoring-workspace"
			data-task-id={task.id}
			data-task-kind={task.kind}
			data-compact={compact}
			data-expanded={expanded}
			aria-labelledby={titleId}
		>
			<header
				className="tilefab-active-authoring-heading"
				data-guidance-pinned={Boolean(guidanceGoal)}
			>
				<h2 id={titleId} className="tilefab-active-authoring-title">
					{task.title}
					{guidanceLabel ? (
						<small className="tilefab-guided-task-heading">{guidanceLabel}</small>
					) : null}
				</h2>
				<div
					id={headingActionsId}
					ref={headingActionsRef}
					className="tilefab-active-authoring-heading-actions"
					hidden={!expanded}
					inert={!expanded}
				>
					{headingActions}
				</div>
				<button
					ref={toggleRef}
					type="button"
					className="tilefab-active-authoring-toggle"
					aria-label={`${task.title} 작업영역 ${expanded ? "접기" : "펼치기"}`}
					aria-expanded={expanded}
					aria-controls={`${bodyId} ${headingActionsId}`}
					onClick={(event) => {
						event.currentTarget.focus({ preventScroll: true });
						onExpandedChange(!expanded);
					}}
				>
					{expanded ? (
						<ChevronDown size={16} aria-hidden="true" />
					) : (
						<ChevronUp size={16} aria-hidden="true" />
					)}
					<span>{expanded ? "접기" : "펼치기"}</span>
				</button>
				{guidanceGoal ? (
					<div className="tilefab-guided-task-pinned" data-testid="guided-task-pinned">
						<span role="status">{guidanceGoal}</span>
						<button type="button" onClick={onExitGuidance} data-testid="guided-task-pinned-exit">
							실습 끝내기
						</button>
					</div>
				) : null}
			</header>
			<div
				id={bodyId}
				ref={bodyRef}
				className="tilefab-active-authoring-body"
				hidden={!expanded}
				inert={!expanded}
			>
				<div className="tilefab-active-authoring-scroll-content">
					{guidance}
					<p className="tilefab-active-authoring-instruction" hidden={!task.instruction}>
						{task.instruction}
					</p>
					<div className="tilefab-active-authoring-settings">{children}</div>
					<p
						className="tilefab-active-authoring-status"
						data-tone={task.status?.tone}
						role="status"
						aria-atomic="true"
						hidden={!task.status}
					>
						{task.status?.message}
					</p>
					<div className="tilefab-active-authoring-feedback">{feedback}</div>
				</div>
				<div className="tilefab-active-authoring-actions">{actions}</div>
			</div>
		</section>
	);
}
