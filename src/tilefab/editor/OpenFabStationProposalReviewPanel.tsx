import {
	AlertTriangle,
	Check,
	Factory,
	FileSearch,
	LoaderCircle,
	PackagePlus,
	ShieldCheck,
	Trash2,
	Warehouse,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	type ReactElement,
	type UIEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { HydratedOpenFabStationProposalArtifact } from "../compile/OpenFabStationProposalArtifact";
import {
	OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES,
	type OpenFabStationProposalRejectReason,
} from "../compile/OpenFabStationProposalReview";
import { EQ_PORT_PITCHES_MILLIMETERS, STK_AUTHORING_TEMPLATES } from "../core/EquipmentGroup";
import { PORT_DIRECTIONS, PORT_TYPES, type PortDirection, type PortType } from "../core/PortRecord";
import type { OpenFabStationProposalReviewBridgeEvaluation } from "./OpenFabStationProposalReviewBridge";
import type {
	OpenFabStationProposalReviewSession,
	OpenFabStationProposalReviewSessionGroup,
	OpenFabStationProposalReviewSessionRow,
} from "./OpenFabStationProposalReviewSession";
import {
	createOpenFabStationProposalIncludeDecisionFromSelection,
	declaredOpenFabStationProposalDirection,
	declaredOpenFabStationProposalPortType,
	type OpenFabStationProposalReviewAttachmentRequest,
	type OpenFabStationProposalReviewAttachmentSelection,
} from "./OpenFabStationProposalReviewUiModel";
import {
	navigateOpenFabStationProposalReviewGrid,
	OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
	selectOpenFabStationProposalReviewWindow,
} from "./OpenFabStationProposalReviewWindow";
import "./OpenFabStationProposalReviewPanel.css";

export type OpenFabStationProposalReviewUiPhase =
	| "reviewing"
	| "evaluating"
	| "ready"
	| "applying"
	| "error";

export interface OpenFabStationProposalReviewPanelProps {
	readonly sourceName: string;
	readonly proposal: HydratedOpenFabStationProposalArtifact;
	readonly session: OpenFabStationProposalReviewSession;
	readonly phase: OpenFabStationProposalReviewUiPhase;
	readonly evaluation: OpenFabStationProposalReviewBridgeEvaluation | null;
	readonly attachmentSelection: OpenFabStationProposalReviewAttachmentSelection | null;
	readonly attachmentRequestActive: boolean;
	readonly error: string | null;
	readonly onRequestAttachment: (request: OpenFabStationProposalReviewAttachmentRequest) => void;
	readonly onClearAttachment: () => void;
	readonly onEvaluate: () => void;
	readonly onApply: () => void;
	readonly onCancel: () => void;
}

type ReviewTab = "rows" | "groups" | "final";

const DEFAULT_LIST_HEIGHT_PIXELS = 352;
const REVIEW_REJECT_REASONS = Object.freeze([
	"USER_EXCLUDED",
	"UNRESOLVED",
	"UNSUPPORTED",
] as const satisfies readonly OpenFabStationProposalRejectReason[]);

export function OpenFabStationProposalReviewPanel({
	sourceName,
	proposal,
	session,
	phase,
	evaluation,
	attachmentSelection,
	attachmentRequestActive,
	error,
	onRequestAttachment,
	onClearAttachment,
	onEvaluate,
	onApply,
	onCancel,
}: OpenFabStationProposalReviewPanelProps): ReactElement {
	const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
	const readSummary = useCallback(() => session.getSummary(), [session]);
	const summary = useSyncExternalStore(subscribe, readSummary, readSummary);
	const [tab, setTab] = useState<ReviewTab>("rows");
	const [activeRowIndex, setActiveRowIndex] = useState(
		session.proposalRowCount === 0 ? OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX : 0,
	);
	const [activeGroupIndex, setActiveGroupIndex] = useState(
		OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
	);
	const initialRow = readReviewRow(session, activeRowIndex);
	const [selectedPortType, setSelectedPortType] = useState<PortType | "">(
		initialRow ? (declaredOpenFabStationProposalPortType(initialRow.proposal) ?? "") : "",
	);
	const [selectedDirection, setSelectedDirection] = useState<PortDirection | "">(
		initialRow ? (declaredOpenFabStationProposalDirection(initialRow.proposal) ?? "") : "",
	);
	const [rejectReason, setRejectReason] =
		useState<OpenFabStationProposalRejectReason>("USER_EXCLUDED");
	const [acknowledgeMismatch, setAcknowledgeMismatch] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const nextReviewGroupIdRef = useRef(1);
	const titleId = useId();
	const locked = phase !== "reviewing";
	const activeRow = readReviewRow(session, activeRowIndex);
	const activeGroup = readReviewGroup(session, activeGroupIndex);
	const selectedForActiveRow =
		attachmentSelection?.request.row === activeRowIndex ? attachmentSelection : null;
	const effectiveError = error ?? localError;

	const dispatch = (command: Parameters<OpenFabStationProposalReviewSession["dispatch"]>[0]) => {
		try {
			setLocalError(null);
			return session.dispatch(command);
		} catch (dispatchError) {
			setLocalError(
				dispatchError instanceof Error ? dispatchError.message : "Review command was rejected.",
			);
			return null;
		}
	};
	const activateRow = (row: number): void => {
		const next = readReviewRow(session, row);
		if (!next) return;
		setActiveRowIndex(row);
		setSelectedPortType(
			next.decision?.disposition === "INCLUDE"
				? next.decision.portType
				: (declaredOpenFabStationProposalPortType(next.proposal) ?? ""),
		);
		setSelectedDirection(
			next.decision?.disposition === "INCLUDE"
				? next.decision.direction
				: (declaredOpenFabStationProposalDirection(next.proposal) ?? ""),
		);
		setAcknowledgeMismatch(false);
		setLocalError(null);
		if (attachmentSelection?.request.row !== row) onClearAttachment();
	};
	const requestAttachment = (): void => {
		if (!activeRow || !selectedPortType || !selectedDirection || locked) return;
		setLocalError(null);
		setAcknowledgeMismatch(false);
		onRequestAttachment(
			Object.freeze({
				row: activeRow.row,
				portType: selectedPortType,
				direction: selectedDirection,
			}),
		);
	};
	const confirmIncludedRow = (): void => {
		if (!activeRow || !selectedForActiveRow || locked) return;
		try {
			const decision = createOpenFabStationProposalIncludeDecisionFromSelection(
				activeRow.proposal,
				selectedForActiveRow,
				acknowledgeMismatch,
			);
			setLocalError(null);
			session.dispatch({ type: "INCLUDE_ROW", decision });
			onClearAttachment();
			setAcknowledgeMismatch(false);
		} catch (includeError) {
			setLocalError(
				includeError instanceof Error ? includeError.message : "Station row could not be included.",
			);
		}
	};
	const rejectActiveRow = (): void => {
		if (!activeRow || locked) return;
		if (dispatch({ type: "REJECT_ROW", row: activeRow.row, reason: rejectReason })) {
			onClearAttachment();
		}
	};
	const createGroupForActiveRow = (): void => {
		if (!activeRow || activeRow.decision?.disposition !== "INCLUDE" || locked) return;
		const reviewGroupId = nextReviewGroupIdRef.current;
		nextReviewGroupIdRef.current += 1;
		let created = false;
		try {
			setLocalError(null);
			session.dispatch({
				type: "CREATE_GROUP",
				reviewGroupId,
				kind: activeRow.decision.portType,
			});
			created = true;
			session.dispatch({
				type: "SET_GROUP_MEMBERS",
				reviewGroupId,
				memberRows: Object.freeze([activeRow.row]),
			});
			setActiveGroupIndex(session.getSummary().activeGroupCount - 1);
			setTab("groups");
		} catch (groupError) {
			if (created) {
				try {
					session.dispatch({ type: "DELETE_GROUP", reviewGroupId });
				} catch {
					// A partially rejected UI command cannot affect project truth.
				}
			}
			setLocalError(
				groupError instanceof Error ? groupError.message : "Group could not be created.",
			);
		}
	};

	return (
		<aside
			className="tilefab-station-review"
			data-testid="openfab-station-proposal-review"
			data-phase={phase}
			data-row-count={summary.proposalRowCount}
			data-group-count={summary.activeGroupCount}
			data-capture-ready={summary.captureReady}
			aria-labelledby={titleId}
		>
			<header className="tilefab-station-review-header">
				<span className="tilefab-station-review-heading">
					<FileSearch size={17} />
					<span>
						<small>PORT-FIRST IMPORT</small>
						<strong id={titleId}>STATION REVIEW</strong>
					</span>
				</span>
				<span className="tilefab-station-review-source" title={sourceName}>
					{sourceName}
				</span>
				<button
					type="button"
					aria-label="Station review 닫기"
					disabled={phase === "applying"}
					onClick={onCancel}
				>
					<X size={15} />
				</button>
			</header>

			<section className="tilefab-station-review-summary" aria-label="Station review progress">
				<ReviewMetric
					label="ROWS"
					value={`${summary.decidedRowCount}/${summary.proposalRowCount}`}
				/>
				<ReviewMetric label="INCLUDE" value={summary.includedRowCount} />
				<ReviewMetric label="REJECT" value={summary.rejectedRowCount} />
				<ReviewMetric label="GROUPS" value={summary.activeGroupCount} />
			</section>

			<nav className="tilefab-station-review-tabs" aria-label="Station review 단계">
				<ReviewTabButton
					active={tab === "rows"}
					label="ROWS"
					count={summary.proposalRowCount}
					onClick={() => setTab("rows")}
				/>
				<ReviewTabButton
					active={tab === "groups"}
					label="GROUPS"
					count={summary.activeGroupCount}
					onClick={() => setTab("groups")}
				/>
				<ReviewTabButton
					active={tab === "final"}
					label="FINAL"
					count={summary.captureReady ? 1 : 0}
					onClick={() => setTab("final")}
				/>
			</nav>

			<div className="tilefab-station-review-workspace">
				{tab === "rows" ? (
					<RowsReview
						session={session}
						activeRowIndex={activeRowIndex}
						onActivateRow={activateRow}
					/>
				) : tab === "groups" ? (
					<GroupsReview
						session={session}
						activeGroupIndex={activeGroupIndex}
						onActivateGroup={setActiveGroupIndex}
					/>
				) : (
					<FinalReview
						proposal={proposal}
						summary={summary}
						evaluation={evaluation}
						locked={locked}
						dispatch={dispatch}
					/>
				)}

				{tab === "rows" && activeRow ? (
					<section
						className="tilefab-station-review-detail"
						aria-label={`Station row ${activeRow.row + 1}`}
					>
						<header>
							<span>
								<strong>ROW {activeRow.row + 1}</strong>
								<small>{activeRow.proposal.portKey || "NO PORT KEY"}</small>
							</span>
							<DecisionBadge row={activeRow} />
						</header>
						<dl className="tilefab-station-review-proposal-facts">
							<div>
								<dt>ATTACHMENT</dt>
								<dd>{activeRow.proposal.attachmentAlias || "UNRESOLVED"}</dd>
							</div>
							<div>
								<dt>DECLARED</dt>
								<dd>
									{activeRow.proposal.portType} · {activeRow.proposal.direction}
								</dd>
							</div>
							<div>
								<dt>STATION</dt>
								<dd>{activeRow.proposal.stationMillimeters.toLocaleString()} mm</dd>
							</div>
							<div>
								<dt>GROUP</dt>
								<dd>{activeRow.proposal.physicalGroupKey || "UNASSIGNED"}</dd>
							</div>
						</dl>
						<div className="tilefab-station-review-row-controls">
							<label>
								<span>PORT TYPE</span>
								<select
									value={selectedPortType}
									disabled={locked}
									onChange={(event) => {
										onClearAttachment();
										setSelectedPortType(event.currentTarget.value as PortType | "");
									}}
								>
									<option value="">SELECT</option>
									{PORT_TYPES.map((portType) => (
										<option key={portType} value={portType}>
											{portType}
										</option>
									))}
								</select>
							</label>
							<label>
								<span>DIRECTION</span>
								<select
									value={selectedDirection}
									disabled={locked}
									onChange={(event) => {
										onClearAttachment();
										setSelectedDirection(event.currentTarget.value as PortDirection | "");
									}}
								>
									<option value="">SELECT</option>
									{PORT_DIRECTIONS.map((direction) => (
										<option key={direction} value={direction}>
											{direction}
										</option>
									))}
								</select>
							</label>
							<button
								type="button"
								className="tilefab-station-review-pick"
								disabled={locked || !selectedPortType || !selectedDirection}
								data-active={attachmentRequestActive && attachmentSelection === null}
								onClick={requestAttachment}
							>
								<PackagePlus size={14} />{" "}
								{attachmentRequestActive ? "CLICK CANVAS SLOT" : "SELECT EXACT SLOT"}
							</button>
						</div>
						{selectedForActiveRow ? (
							<div
								className="tilefab-station-review-selection"
								data-source-position={selectedForActiveRow.sourcePositionReview}
							>
								<span>
									<Check size={13} /> X{" "}
									{selectedForActiveRow.attachment.route.kind === "CARDINAL_CELL"
										? selectedForActiveRow.attachment.route.x
										: "SW"}{" "}
									· Z{" "}
									{selectedForActiveRow.attachment.route.kind === "CARDINAL_CELL"
										? selectedForActiveRow.attachment.route.z
										: "SW"}{" "}
									· {selectedForActiveRow.attachment.stationMillimeters} mm
								</span>
								{selectedForActiveRow.sourcePositionReview === "ACKNOWLEDGE_MISMATCH" ? (
									<label className="tilefab-station-review-acknowledge">
										<input
											type="checkbox"
											checked={acknowledgeMismatch}
											onChange={(event) => setAcknowledgeMismatch(event.currentTarget.checked)}
										/>
										<span>소스 좌표와 선택 슬롯 차이를 확인했습니다</span>
									</label>
								) : null}
								<button
									type="button"
									disabled={
										locked ||
										(selectedForActiveRow.sourcePositionReview === "ACKNOWLEDGE_MISMATCH" &&
											!acknowledgeMismatch)
									}
									onClick={confirmIncludedRow}
								>
									<Check size={13} /> INCLUDE ROW
								</button>
							</div>
						) : null}
						<div className="tilefab-station-review-row-actions">
							<label>
								<span className="tilefab-sr-only">제외 사유</span>
								<select
									value={rejectReason}
									disabled={locked}
									onChange={(event) =>
										setRejectReason(event.currentTarget.value as OpenFabStationProposalRejectReason)
									}
								>
									{REVIEW_REJECT_REASONS.map((reason) => (
										<option key={reason} value={reason}>
											{rejectReasonLabel(reason)}
										</option>
									))}
								</select>
							</label>
							<button type="button" disabled={locked} onClick={rejectActiveRow}>
								<X size={13} /> EXCLUDE
							</button>
							<button
								type="button"
								disabled={
									locked ||
									activeRow.decision?.disposition !== "INCLUDE" ||
									activeRow.reviewGroupId !== null
								}
								onClick={createGroupForActiveRow}
							>
								<Factory size={13} /> CREATE GROUP
							</button>
						</div>
					</section>
				) : null}

				{tab === "groups" && activeGroup ? (
					<GroupDetail
						group={activeGroup}
						activeRow={activeRow}
						session={session}
						locked={locked}
						dispatch={dispatch}
						onDeleted={() =>
							setActiveGroupIndex(
								Math.min(activeGroupIndex, session.getSummary().activeGroupCount - 1),
							)
						}
					/>
				) : null}
			</div>

			{effectiveError ? (
				<p className="tilefab-station-review-error" role="alert">
					<AlertTriangle size={13} /> {effectiveError}
				</p>
			) : null}
			<footer className="tilefab-station-review-footer">
				<span data-ready={summary.captureReady}>
					{phase === "evaluating" || phase === "applying" ? (
						<LoaderCircle size={14} />
					) : summary.captureReady ? (
						<ShieldCheck size={14} />
					) : (
						<AlertTriangle size={14} />
					)}
					{reviewStatusLabel(summary, phase, evaluation)}
				</span>
				<button type="button" disabled={locked || !summary.captureReady} onClick={onEvaluate}>
					<ShieldCheck size={14} /> EVALUATE
				</button>
				<button
					type="button"
					className="tilefab-station-review-apply"
					disabled={phase !== "ready" || !evaluation?.canApply}
					onClick={onApply}
				>
					<Check size={14} /> APPLY ONCE
				</button>
			</footer>
		</aside>
	);
}

function RowsReview({
	session,
	activeRowIndex,
	onActivateRow,
}: Readonly<{
	session: OpenFabStationProposalReviewSession;
	activeRowIndex: number;
	onActivateRow: (row: number) => void;
}>): ReactElement {
	return (
		<VirtualReviewList
			kind="row"
			count={session.proposalRowCount}
			activeIndex={activeRowIndex}
			onActivate={onActivateRow}
			read={(start, count) => session.readRowWindow(start, count).items}
			render={(item) => (
				<RowListItem
					key={item.row}
					row={item}
					active={item.row === activeRowIndex}
					onClick={() => onActivateRow(item.row)}
				/>
			)}
		/>
	);
}

function GroupsReview({
	session,
	activeGroupIndex,
	onActivateGroup,
}: Readonly<{
	session: OpenFabStationProposalReviewSession;
	activeGroupIndex: number;
	onActivateGroup: (index: number) => void;
}>): ReactElement {
	const count = session.getSummary().activeGroupCount;
	return (
		<VirtualReviewList
			kind="group"
			count={count}
			activeIndex={activeGroupIndex}
			onActivate={onActivateGroup}
			read={(start, windowCount) => session.readGroupWindow(start, windowCount).items}
			render={(item, index) => (
				<GroupListItem
					key={item.reviewGroupId}
					group={item}
					active={index === activeGroupIndex}
					onClick={() => onActivateGroup(index)}
				/>
			)}
		/>
	);
}

function VirtualReviewList<Item>({
	kind,
	count,
	activeIndex,
	onActivate,
	read,
	render,
}: Readonly<{
	kind: "row" | "group";
	count: number;
	activeIndex: number;
	onActivate: (index: number) => void;
	read: (start: number, count: number) => readonly Item[];
	render: (item: Item, absoluteIndex: number) => ReactElement;
}>): ReactElement {
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState({
		scrollTop: 0,
		clientHeight: DEFAULT_LIST_HEIGHT_PIXELS,
	});
	const window = useMemo(
		() => selectOpenFabStationProposalReviewWindow({ rowCount: count, ...viewport }),
		[count, viewport],
	);
	const items = read(window.startIndex, window.renderedRowCount);
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const measure = (): void =>
			setViewport((current) => ({
				scrollTop: element.scrollTop,
				clientHeight: element.clientHeight || current.clientHeight,
			}));
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
		setViewport({
			scrollTop: event.currentTarget.scrollTop,
			clientHeight: event.currentTarget.clientHeight,
		});
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const navigation = navigateOpenFabStationProposalReviewGrid({
			key: event.key,
			rowCount: count,
			activeIndex,
			...viewport,
		});
		if (!navigation.handled) return;
		event.preventDefault();
		onActivate(navigation.activeIndex);
		if (viewportRef.current) viewportRef.current.scrollTop = navigation.scrollTarget;
	};
	return (
		<div
			ref={viewportRef}
			className="tilefab-station-review-list"
			data-kind={kind}
			data-rendered-rows={window.renderedRowCount}
			role="listbox"
			aria-label={kind === "row" ? "Station proposal rows" : "Station equipment groups"}
			tabIndex={count === 0 ? -1 : 0}
			onScroll={handleScroll}
			onKeyDown={handleKeyDown}
		>
			<div
				className="tilefab-station-review-list-space"
				style={{ height: window.totalHeightPixels }}
			>
				{items.map((item, offset) => {
					const index = window.startIndex + offset;
					return (
						<div
							className="tilefab-station-review-list-row"
							style={{ transform: `translateY(${index * window.rowHeightPixels}px)` }}
							key={index}
						>
							{render(item, index)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function RowListItem({
	row,
	active,
	onClick,
}: Readonly<{
	row: OpenFabStationProposalReviewSessionRow;
	active: boolean;
	onClick: () => void;
}>): ReactElement {
	const disposition = row.decision?.disposition ?? "PENDING";
	return (
		<button
			type="button"
			role="option"
			aria-selected={active}
			data-active={active}
			data-disposition={disposition}
			onClick={onClick}
		>
			<span className="tilefab-station-review-index">{row.row + 1}</span>
			<span>
				<strong>{row.proposal.portKey || "UNNAMED PORT"}</strong>
				<small>{row.proposal.attachmentAlias || "NO ATTACHMENT"}</small>
			</span>
			<code>
				{row.decision?.disposition === "INCLUDE" ? row.decision.portType : row.proposal.portType}
			</code>
			<small>{row.reviewGroupId === null ? "NO GROUP" : `G${row.reviewGroupId}`}</small>
		</button>
	);
}

function GroupListItem({
	group,
	active,
	onClick,
}: Readonly<{
	group: OpenFabStationProposalReviewSessionGroup;
	active: boolean;
	onClick: () => void;
}>): ReactElement {
	return (
		<button
			type="button"
			role="option"
			aria-selected={active}
			data-active={active}
			data-review={group.groupingReview ?? "PENDING"}
			onClick={onClick}
		>
			<span className="tilefab-station-review-group-icon">
				{group.kind === "STK" ? (
					<Warehouse size={14} />
				) : group.kind === "EQ" ? (
					<Factory size={14} />
				) : (
					<PackagePlus size={14} />
				)}
			</span>
			<span>
				<strong>
					{group.kind}-{group.reviewGroupId}
				</strong>
				<small>
					{group.memberCount} PORT{group.memberCount === 1 ? "" : "S"}
				</small>
			</span>
			<code>
				{group.template ??
					(group.pitchMillimeters ? `${group.pitchMillimeters / 1_000}m` : "SETUP")}
			</code>
			<small>{group.groupingReview ?? "REVIEW"}</small>
		</button>
	);
}

function GroupDetail({
	group,
	activeRow,
	session,
	locked,
	dispatch,
	onDeleted,
}: Readonly<{
	group: OpenFabStationProposalReviewSessionGroup;
	activeRow: OpenFabStationProposalReviewSessionRow | null;
	session: OpenFabStationProposalReviewSession;
	locked: boolean;
	dispatch: (command: Parameters<OpenFabStationProposalReviewSession["dispatch"]>[0]) => unknown;
	onDeleted: () => void;
}>): ReactElement {
	const memberWindow = session.readGroupMemberWindow(group.reviewGroupId, 0, 128);
	const activeMember = activeRow ? memberWindow.items.includes(activeRow.row) : false;
	const canAddActive =
		activeRow?.decision?.disposition === "INCLUDE" &&
		activeRow.decision.portType === group.kind &&
		!activeMember &&
		activeRow.reviewGroupId === null;
	const updateMembers = (members: readonly number[]): void => {
		dispatch({
			type: "SET_GROUP_MEMBERS",
			reviewGroupId: group.reviewGroupId,
			memberRows: Object.freeze([...members]),
		});
	};
	return (
		<section className="tilefab-station-review-detail tilefab-station-review-group-detail">
			<header>
				<span>
					<strong>
						{group.kind}-{group.reviewGroupId}
					</strong>
					<small>{group.memberCount} exact members</small>
				</span>
				<DecisionBadge group={group} />
			</header>
			<div className="tilefab-station-review-group-actions">
				<button
					type="button"
					disabled={locked || !canAddActive}
					onClick={() => activeRow && updateMembers([...memberWindow.items, activeRow.row])}
				>
					+ ADD ACTIVE ROW
				</button>
				<button
					type="button"
					disabled={locked || !activeMember}
					onClick={() =>
						activeRow && updateMembers(memberWindow.items.filter((row) => row !== activeRow.row))
					}
				>
					− REMOVE ACTIVE ROW
				</button>
			</div>
			{group.kind === "EQ" ? (
				<fieldset>
					<legend>EQ PITCH</legend>
					{EQ_PORT_PITCHES_MILLIMETERS.map((pitch) => (
						<button
							type="button"
							key={pitch}
							data-active={group.pitchMillimeters === pitch}
							disabled={locked}
							onClick={() =>
								dispatch({
									type: "SET_EQ_PITCH",
									reviewGroupId: group.reviewGroupId,
									pitchMillimeters: pitch,
								})
							}
						>
							{pitch / 1_000} m
						</button>
					))}
				</fieldset>
			) : null}
			{group.kind === "STK" ? (
				<fieldset>
					<legend>STK TEMPLATE</legend>
					{STK_AUTHORING_TEMPLATES.map((template) => (
						<button
							type="button"
							key={template}
							data-active={group.template === template}
							disabled={locked}
							onClick={() =>
								dispatch({ type: "SET_STK_TEMPLATE", reviewGroupId: group.reviewGroupId, template })
							}
						>
							{template}
						</button>
					))}
				</fieldset>
			) : null}
			<div className="tilefab-station-review-group-actions">
				<button
					type="button"
					disabled={locked || group.memberCount === 0}
					onClick={() =>
						dispatch({
							type: "SET_GROUP_REVIEW",
							reviewGroupId: group.reviewGroupId,
							groupingReview: "CONFIRM_DECLARED",
						})
					}
				>
					CONFIRM SOURCE GROUP
				</button>
				<button
					type="button"
					disabled={locked || group.memberCount === 0}
					onClick={() =>
						dispatch({
							type: "SET_GROUP_REVIEW",
							reviewGroupId: group.reviewGroupId,
							groupingReview: "OVERRIDE",
						})
					}
				>
					CONFIRM OVERRIDE
				</button>
				<button
					type="button"
					className="tilefab-station-review-delete"
					disabled={locked}
					onClick={() => {
						if (dispatch({ type: "DELETE_GROUP", reviewGroupId: group.reviewGroupId })) onDeleted();
					}}
				>
					<Trash2 size={13} /> DELETE
				</button>
			</div>
		</section>
	);
}

function FinalReview({
	proposal,
	summary,
	evaluation,
	locked,
	dispatch,
}: Readonly<{
	proposal: HydratedOpenFabStationProposalArtifact;
	summary: ReturnType<OpenFabStationProposalReviewSession["getSummary"]>;
	evaluation: OpenFabStationProposalReviewBridgeEvaluation | null;
	locked: boolean;
	dispatch: (command: Parameters<OpenFabStationProposalReviewSession["dispatch"]>[0]) => unknown;
}>): ReactElement {
	const issueCounts = evaluation
		? OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.map(
				(code) => [code, evaluation.preview.issueCount(code)] as const,
			).filter(([, count]) => count > 0)
		: [];
	return (
		<section className="tilefab-station-review-final">
			<header>
				<ShieldCheck size={18} />
				<span>
					<strong>EXPLICIT REVIEW POLICIES</strong>
					<small>No external organization metadata is adopted in V1.</small>
				</span>
			</header>
			<PolicyRow
				label="REJECTED SOURCE ROWS"
				value={summary.rejectedSourceRowsPolicy}
				count={proposal.rejectedRowCount}
				disabled={locked}
				onClick={() =>
					dispatch({
						type: "SET_REJECTED_SOURCE_ROWS_POLICY",
						policy: proposal.rejectedRowCount === 0 ? "NOT_APPLICABLE" : "ACKNOWLEDGE_DISCARDED",
					})
				}
			/>
			<PolicyRow
				label="UNKNOWN COLUMNS"
				value={summary.unknownColumnsPolicy}
				count={proposal.unknownColumnCount}
				disabled={locked}
				onClick={() =>
					dispatch({
						type: "SET_UNKNOWN_COLUMNS_POLICY",
						policy: proposal.unknownColumnCount === 0 ? "NOT_APPLICABLE" : "ACKNOWLEDGE_IGNORED",
					})
				}
			/>
			<PolicyRow
				label="ORGANIZATION"
				value={summary.organizationPolicy}
				count={summary.includedRowCount}
				disabled={locked}
				onClick={() => dispatch({ type: "SET_ORGANIZATION_POLICY", policy: "EXPLICIT_UNASSIGNED" })}
			/>
			<dl className="tilefab-station-review-readiness">
				<div>
					<dt>UNDECIDED ROWS</dt>
					<dd>{summary.proposalRowCount - summary.decidedRowCount}</dd>
				</div>
				<div>
					<dt>UNGROUPED PORTS</dt>
					<dd>{summary.ungroupedIncludedRowCount}</dd>
				</div>
				<div>
					<dt>PENDING GROUP REVIEW</dt>
					<dd>{summary.pendingGroupReviewCount}</dd>
				</div>
				<div>
					<dt>PENDING CONFIG</dt>
					<dd>{summary.pendingGroupConfigurationCount}</dd>
				</div>
			</dl>
			{evaluation ? (
				<section
					className="tilefab-station-review-evaluation"
					data-state={evaluation.preview.state}
				>
					<header>
						<strong>WORKER EVALUATION · {evaluation.preview.state}</strong>
						<small>
							{evaluation.preview.includedPortCount} ports ·{" "}
							{evaluation.preview.equipmentGroupCount} groups
						</small>
					</header>
					{issueCounts.length === 0 ? (
						<p>
							<Check size={13} /> Exact prospective layout is ready for one explicit Apply.
						</p>
					) : (
						<ul>
							{issueCounts.slice(0, 8).map(([code, count]) => (
								<li key={code}>
									<code>{code}</code>
									<strong>{count}</strong>
								</li>
							))}
						</ul>
					)}
				</section>
			) : null}
		</section>
	);
}

function PolicyRow({
	label,
	value,
	count,
	disabled,
	onClick,
}: Readonly<{
	label: string;
	value: string | null;
	count: number;
	disabled: boolean;
	onClick: () => void;
}>): ReactElement {
	return (
		<button
			type="button"
			className="tilefab-station-review-policy"
			data-complete={value !== null}
			disabled={disabled}
			onClick={onClick}
		>
			<span>
				<strong>{label}</strong>
				<small>{count.toLocaleString()} source records</small>
			</span>
			<code>{value ?? "REVIEW"}</code>
		</button>
	);
}

function ReviewMetric({
	label,
	value,
}: Readonly<{ label: string; value: string | number }>): ReactElement {
	return (
		<span>
			<small>{label}</small>
			<strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
		</span>
	);
}

function ReviewTabButton({
	active,
	label,
	count,
	onClick,
}: Readonly<{ active: boolean; label: string; count: number; onClick: () => void }>): ReactElement {
	return (
		<button type="button" role="tab" aria-selected={active} data-active={active} onClick={onClick}>
			<span>{label}</span>
			<small>{count.toLocaleString()}</small>
		</button>
	);
}

function DecisionBadge(
	props: Readonly<
		| { row: OpenFabStationProposalReviewSessionRow; group?: never }
		| { group: OpenFabStationProposalReviewSessionGroup; row?: never }
	>,
): ReactElement {
	const value = props.row
		? (props.row.decision?.disposition ?? "PENDING")
		: (props.group.groupingReview ?? "PENDING");
	return (
		<code className="tilefab-station-review-badge" data-state={value}>
			{value}
		</code>
	);
}

function readReviewRow(
	session: OpenFabStationProposalReviewSession,
	row: number,
): OpenFabStationProposalReviewSessionRow | null {
	if (!Number.isInteger(row) || row < 0 || row >= session.proposalRowCount) return null;
	return session.readRowWindow(row, 1).items[0] ?? null;
}

function readReviewGroup(
	session: OpenFabStationProposalReviewSession,
	index: number,
): OpenFabStationProposalReviewSessionGroup | null {
	if (!Number.isInteger(index) || index < 0 || index >= session.getSummary().activeGroupCount)
		return null;
	return session.readGroupWindow(index, 1).items[0] ?? null;
}

function rejectReasonLabel(reason: OpenFabStationProposalRejectReason): string {
	return reason === "USER_EXCLUDED" ? "USER EXCLUDED" : reason;
}

function reviewStatusLabel(
	summary: ReturnType<OpenFabStationProposalReviewSession["getSummary"]>,
	phase: OpenFabStationProposalReviewUiPhase,
	evaluation: OpenFabStationProposalReviewBridgeEvaluation | null,
): string {
	if (phase === "evaluating") return "WORKER EVALUATING EXACT SOURCE";
	if (phase === "applying") return "MATERIALIZING AND APPLYING";
	if (phase === "ready")
		return evaluation?.canApply ? "READY · EXPLICIT APPLY REQUIRED" : "REVIEW BLOCKED";
	if (summary.captureReady) return "DRAFT READY FOR WORKER EVALUATION";
	return `${summary.proposalRowCount - summary.decidedRowCount} ROWS · ${summary.ungroupedIncludedRowCount} UNGROUPED · ${summary.pendingGroupReviewCount + summary.pendingGroupConfigurationCount} GROUP ACTIONS`;
}
