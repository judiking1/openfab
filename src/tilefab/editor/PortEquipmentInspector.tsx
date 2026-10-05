import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Copy,
	Layers3,
	MousePointer2,
	Move,
	Plus,
	RotateCw,
	Trash2,
	Warehouse,
	X,
} from "lucide-react";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { PortEquipmentGroupEditMode } from "../compile/PortEquipmentGroupEditPlanner";
import type {
	EquipmentGroupRecord,
	PortEquipmentState,
	StkEquipmentTemplate,
} from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationSemanticRole,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { staticFabOrganizationParentIds } from "../core/StaticFabOrganization";
import type { StaticFabProcessLoopEquipmentMembershipQuery } from "../core/StaticFabOrganizationPlan";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import {
	editorCommandAriaKeyShortcuts,
	editorCommandMatchesKeyboard,
} from "./EditorCommandRegistry";
import type { EquipmentAuthoringContinuation } from "./EquipmentAuthoringContinuation";
import {
	equipmentAuthoringContinuation,
	equipmentAuthoringContinuationExplanation,
} from "./EquipmentAuthoringContinuation";
import { scrollFocusedInspectorDisclosure } from "./InspectorDisclosureFocus";
import type { OrdinaryCompletedModuleHandoffPresentation } from "./OrdinaryCompletedModuleHandoff";
import type { OrdinaryEqToStkHandoffPresentation } from "./OrdinaryEqToStkHandoff";
import { ORDINARY_STK_HANDOFF_ENTRY_STATUS } from "./OrdinaryEqToStkHandoff";
import {
	type PortEquipmentActionDecision,
	type PortEquipmentSelectionIdentity,
	type ResolvedPortEquipmentSelection,
	resolvePortEquipmentActionAvailability,
} from "./PortEquipmentInspectorSelection";

export interface PortEquipmentInspectorProps {
	readonly organizations?: StaticFabOrganizationState;
	readonly activePortEquipment: Pick<PortEquipmentState, "equipmentGroups">;
	readonly bindCompactInspectorDisclosure: (node: HTMLButtonElement | null) => void;
	readonly canvasRef: RefObject<HTMLCanvasElement | null>;
	readonly chooseGuidedEquipmentTool: (
		next: "ohb" | "eq" | "stk",
		returnSelection?: PortEquipmentSelectionIdentity | null,
	) => boolean;
	readonly clearPortEquipmentSelection: () => void;
	readonly commitSelectedEquipmentProcessLoopMembership: (
		operation: "attach" | "detach",
		processLoopOrganizationId: number,
		expectedSelection: PortEquipmentSelectionIdentity,
		focusTarget?: "disclosure" | "primary",
	) => void;
	readonly compactInspectorCloseRef: RefObject<HTMLButtonElement | null>;
	readonly compactInspectorDisclosureFocusedRef: RefObject<boolean>;
	readonly compactInspectorExpanded: boolean;
	readonly compactInspectorSheetActive: boolean;
	readonly completedModuleHandoff: OrdinaryCompletedModuleHandoffPresentation | null;
	readonly deleteSelected: () => void;
	readonly eqToStkHandoff: OrdinaryEqToStkHandoffPresentation | null;
	readonly modelSyncPending: boolean;
	readonly nextPortEquipmentButtonRef: RefObject<HTMLButtonElement | null>;
	readonly organizationRecordsById: ReadonlyMap<number, StaticFabOrganizationRecord>;
	readonly organizationSemanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
	readonly portRouteDetail: (port: PortRecord) => string;
	readonly portRouteSummary: (port: PortRecord) => string;
	readonly processLoopMembershipDisclosureRef: RefObject<HTMLElement | null>;
	readonly processLoopPrimaryActionRef: RefObject<HTMLButtonElement | null>;
	readonly processLoopPrimaryStatusRef: RefObject<HTMLDivElement | null>;
	readonly reverseSelectedPortEquipmentServiceDirection: () => void;
	readonly scheduleRender: () => void;
	readonly selectConnectedAuthoredComponent: () => void;
	readonly selectNextPortEquipmentGroup: () => void;
	readonly selectedEquipmentDirectlyOwned: boolean;
	readonly selectedEquipmentGroup: EquipmentGroupRecord;
	readonly selectedEquipmentNeedsGroupMoveForProcessLoop: boolean;
	readonly selectedEquipmentNoProcessLoopHint: string;
	readonly selectedEquipmentOwnedOutsideProcessLoop: boolean;
	readonly selectedEquipmentOwnedProcessLoopId: number | null;
	readonly selectedEquipmentPrimaryProcessLoopId: number | null;
	readonly selectedEquipmentProcessLoopMembership: StaticFabProcessLoopEquipmentMembershipQuery | null;
	readonly selectedEquipmentUnownedProcessLoopMembership: StaticFabProcessLoopEquipmentMembershipQuery | null;
	readonly selectedPortDetails: ResolvedPortEquipmentSelection;
	readonly selectedPortEditableDetails: ResolvedPortEquipmentSelection | null;
	readonly selectedPortEquipment: PortEquipmentSelectionIdentity | null;
	readonly setCompactInspectorExpanded: Dispatch<SetStateAction<boolean>>;
	readonly setStatus: (message: string) => void;
	readonly startEquipmentAuthoringContinuation: (
		continuation: EquipmentAuthoringContinuation,
		returnSelection?: PortEquipmentSelectionIdentity | null,
	) => void;
	readonly startSelectedOhbPlacementIntent: (kind: "move" | "copy") => void;
	readonly startSelectedPortEquipmentGroupEdit: (mode: PortEquipmentGroupEditMode) => void;
	readonly startSelectedPortEquipmentMembershipEdit: () => void;
	readonly stkAuthoringTemplateLabel: (template: StkEquipmentTemplate) => string;
	readonly viewMode: "2d" | "3d";
	readonly workerState: Pick<RailWorkerBridgeState, "status">;
}

export function PortEquipmentInspector({
	organizations,
	activePortEquipment,
	bindCompactInspectorDisclosure,
	canvasRef,
	chooseGuidedEquipmentTool,
	clearPortEquipmentSelection,
	commitSelectedEquipmentProcessLoopMembership,
	compactInspectorCloseRef,
	compactInspectorDisclosureFocusedRef,
	compactInspectorExpanded,
	compactInspectorSheetActive,
	completedModuleHandoff,
	deleteSelected,
	eqToStkHandoff,
	modelSyncPending,
	nextPortEquipmentButtonRef,
	organizationRecordsById,
	organizationSemanticRoles,
	portRouteDetail,
	portRouteSummary,
	processLoopMembershipDisclosureRef,
	processLoopPrimaryActionRef,
	processLoopPrimaryStatusRef,
	reverseSelectedPortEquipmentServiceDirection,
	scheduleRender,
	selectConnectedAuthoredComponent,
	selectNextPortEquipmentGroup,
	selectedEquipmentDirectlyOwned,
	selectedEquipmentGroup,
	selectedEquipmentNeedsGroupMoveForProcessLoop,
	selectedEquipmentNoProcessLoopHint,
	selectedEquipmentOwnedOutsideProcessLoop,
	selectedEquipmentOwnedProcessLoopId,
	selectedEquipmentPrimaryProcessLoopId,
	selectedEquipmentProcessLoopMembership,
	selectedEquipmentUnownedProcessLoopMembership,
	selectedPortDetails,
	selectedPortEditableDetails,
	selectedPortEquipment,
	setCompactInspectorExpanded,
	setStatus,
	startEquipmentAuthoringContinuation,
	startSelectedOhbPlacementIntent,
	startSelectedPortEquipmentGroupEdit,
	startSelectedPortEquipmentMembershipEdit,
	stkAuthoringTemplateLabel,
	viewMode,
	workerState,
}: PortEquipmentInspectorProps): ReactNode {
	const actions = resolvePortEquipmentActionAvailability({
		editableSelection: selectedPortEditableDetails,
		directlyOwned: selectedEquipmentDirectlyOwned,
		organizations,
	});
	return (
		<aside
			className="tilefab-inspector tilefab-equipment-inspector"
			aria-label={`${selectedEquipmentGroup.kind} 장비 속성`}
			data-testid="port-equipment-inspector"
			data-port-id={selectedPortDetails.port.id}
			data-equipment-group-id={selectedEquipmentGroup.id}
			data-editable={selectedPortEditableDetails !== null}
			data-primary-process-loop-visible={
				selectedEquipmentPrimaryProcessLoopId !== null ||
				selectedEquipmentDirectlyOwned ||
				selectedEquipmentUnownedProcessLoopMembership?.eligibleProcessLoopIds.length === 0
			}
			data-primary-process-loop-availability={
				selectedEquipmentNeedsGroupMoveForProcessLoop
					? "move"
					: selectedEquipmentUnownedProcessLoopMembership?.eligibleProcessLoopIds.length === 0
						? "none"
						: undefined
			}
			data-compact-layout={compactInspectorSheetActive ? "bottom-sheet" : "side-panel"}
			data-compact-obstruction="equipment"
			data-compact-expanded={compactInspectorSheetActive ? compactInspectorExpanded : true}
			data-compact-snap={
				compactInspectorSheetActive && !compactInspectorExpanded ? "peek" : "expanded"
			}
		>
			<header>
				<span>
					<small>
						{selectedEquipmentGroup.kind === "OHB"
							? "OHB · 상부 보관"
							: selectedEquipmentGroup.kind === "EQ"
								? "EQ · 공정 장비"
								: "Stocker · 보관 장비"}
					</small>
					<strong>
						<span className="tilefab-device-id">
							{selectedEquipmentGroup.kind}-{selectedEquipmentGroup.id}
						</span>
						<span className="tilefab-device-ports">
							Port {selectedEquipmentGroup.portIds.length}개
						</span>
					</strong>
				</span>
				<div className="tilefab-inspector-header-actions">
					{compactInspectorSheetActive ? (
						<button
							ref={bindCompactInspectorDisclosure}
							type="button"
							className="tilefab-inspector-disclosure"
							data-testid="compact-inspector-disclosure"
							aria-label="선택 세부정보"
							aria-expanded={compactInspectorExpanded}
							aria-controls="port-equipment-inspector-content"
							title={compactInspectorExpanded ? "선택 세부정보 접기" : "선택 세부정보 펼치기"}
							onFocus={() => {
								compactInspectorDisclosureFocusedRef.current = true;
							}}
							onBlur={() => {
								compactInspectorDisclosureFocusedRef.current = false;
							}}
							onClick={() => setCompactInspectorExpanded((expanded) => !expanded)}
						>
							{compactInspectorExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
							<small>{compactInspectorExpanded ? "접기" : "열기"}</small>
						</button>
					) : null}
					<button
						ref={compactInspectorCloseRef}
						type="button"
						className="tilefab-inspector-close"
						aria-label="장비 선택 닫기"
						title="장비 선택 닫기"
						onClick={() => {
							clearPortEquipmentSelection();
							scheduleRender();
							canvasRef.current?.focus({ preventScroll: true });
						}}
					>
						<X size={15} />
					</button>
				</div>
			</header>
			{selectedEquipmentPrimaryProcessLoopId !== null ? (
				<div className="tilefab-equipment-process-loop-primary">
					<button
						ref={processLoopPrimaryActionRef}
						type="button"
						data-testid="attach-equipment-process-loop-primary"
						data-process-loop-id={selectedEquipmentPrimaryProcessLoopId}
						aria-label={`${selectedEquipmentGroup.kind}-${selectedEquipmentGroup.id}을(를) ${organizationRecordsById.get(selectedEquipmentPrimaryProcessLoopId)?.name ?? `Process Loop ${selectedEquipmentPrimaryProcessLoopId}`}에 소속시키기`}
						disabled={modelSyncPending || workerState.status !== "ready"}
						onClick={() =>
							commitSelectedEquipmentProcessLoopMembership(
								"attach",
								selectedEquipmentPrimaryProcessLoopId,
								{
									portId: selectedPortDetails.port.id,
									equipmentGroupId: selectedEquipmentGroup.id,
								},
								"primary",
							)
						}
					>
						<Plus
							className="tilefab-equipment-process-loop-primary-icon"
							size={15}
							aria-hidden="true"
						/>
						<span className="tilefab-equipment-process-loop-primary-copy">
							<strong className="tilefab-equipment-process-loop-primary-title">
								이 Process Loop에 소속
							</strong>
							<small className="tilefab-equipment-process-loop-primary-name">
								{organizationRecordsById.get(selectedEquipmentPrimaryProcessLoopId)?.name ??
									`Process Loop ${selectedEquipmentPrimaryProcessLoopId}`}
							</small>
						</span>
					</button>
				</div>
			) : selectedEquipmentDirectlyOwned && selectedEquipmentProcessLoopMembership ? (
				<div className="tilefab-equipment-process-loop-primary">
					<div
						ref={processLoopPrimaryStatusRef}
						className="tilefab-equipment-process-loop-primary-owned"
						data-testid="equipment-process-loop-primary-status"
						data-process-loop-id={selectedEquipmentOwnedProcessLoopId ?? undefined}
						role="status"
						tabIndex={-1}
					>
						<Check
							className="tilefab-equipment-process-loop-primary-icon"
							size={15}
							aria-hidden="true"
						/>
						<span className="tilefab-equipment-process-loop-primary-copy">
							<strong className="tilefab-equipment-process-loop-primary-title">
								{selectedEquipmentOwnedOutsideProcessLoop
									? "FAB 조직 소속"
									: "Process Loop 소속 완료"}
							</strong>
							<small className="tilefab-equipment-process-loop-primary-name">
								{selectedEquipmentProcessLoopMembership.ownerOrganizationIds
									.map((id) => organizationRecordsById.get(id)?.name ?? `조직 ${id}`)
									.join(", ")}
							</small>
						</span>
					</div>
				</div>
			) : selectedEquipmentNeedsGroupMoveForProcessLoop ? (
				<div className="tilefab-equipment-process-loop-primary">
					<button
						ref={processLoopPrimaryActionRef}
						type="button"
						data-testid="move-port-equipment-group-primary"
						aria-label={`${selectedEquipmentGroup.kind}-${selectedEquipmentGroup.id}: 연결할 Loop가 없습니다. 장비 전체 이동을 시작하고 미리보기에서 모든 Port의 Loop 소속 가능 여부를 확인하세요. 이동 후 소속은 별도로 지정해야 합니다.`}
						disabled={modelSyncPending || workerState.status !== "ready" || !actions.move.allowed}
						aria-describedby={equipmentActionDescriptionId(actions.move)}
						onClick={() => startSelectedPortEquipmentGroupEdit("move")}
					>
						<Move
							className="tilefab-equipment-process-loop-primary-icon"
							size={15}
							aria-hidden="true"
						/>
						<span className="tilefab-equipment-process-loop-primary-copy">
							<strong className="tilefab-equipment-process-loop-primary-title">
								연결할 Loop 없음 · 전체 이동
							</strong>
							<small className="tilefab-equipment-process-loop-primary-name">
								이동 미리보기에서 Loop 소속 확인
							</small>
						</span>
					</button>
				</div>
			) : selectedEquipmentUnownedProcessLoopMembership?.eligibleProcessLoopIds.length === 0 ? (
				<div className="tilefab-equipment-process-loop-primary">
					<div
						ref={processLoopPrimaryStatusRef}
						className="tilefab-equipment-process-loop-primary-owned tilefab-equipment-process-loop-primary-unavailable"
						data-testid="equipment-process-loop-unavailable"
						role="status"
						aria-label={`Loop 없음 · ${selectedEquipmentNoProcessLoopHint}`}
						title={selectedEquipmentUnownedProcessLoopMembership?.reason ?? undefined}
						tabIndex={-1}
					>
						<AlertTriangle
							className="tilefab-equipment-process-loop-primary-icon"
							size={15}
							aria-hidden="true"
						/>
						<span className="tilefab-equipment-process-loop-primary-copy">
							<strong className="tilefab-equipment-process-loop-primary-title">Loop 없음</strong>
							<small className="tilefab-equipment-process-loop-primary-name">
								{selectedEquipmentNoProcessLoopHint}
							</small>
						</span>
					</div>
				</div>
			) : null}
			<div
				id="port-equipment-inspector-content"
				className="tilefab-contextual-inspector-content"
				hidden={compactInspectorSheetActive && !compactInspectorExpanded}
			>
				{actions.move.code === "SELECTION_NOT_EDITABLE" ? (
					<p
						id="tilefab-equipment-selection-mutation-note"
						className="tilefab-inspector-notice"
						role="status"
					>
						<AlertTriangle size={15} aria-hidden="true" />
						{actions.move.reason}
					</p>
				) : null}
				{viewMode === "2d" && actions.copy.code === "LEGACY_CUSTOM" ? (
					<p id="tilefab-stk-membership-note" className="tilefab-inspector-notice">
						{actions.copy.reason}
						{actions.delete.allowed ? ". 기존 장비의 철거와 실행 취소는 사용할 수 있습니다." : null}
					</p>
				) : null}

				{viewMode === "2d" ? (
					<>
						{completedModuleHandoff ? (
							<>
								<span id="tilefab-completed-module-handoff-description" className="tilefab-sr-only">
									{completedModuleHandoff.description}
								</span>
								<button
									type="button"
									className="tilefab-equipment-next-kind tilefab-completed-module-handoff"
									data-testid="ordinary-completed-module-handoff"
									data-action={completedModuleHandoff.action}
									aria-label={completedModuleHandoff.ariaLabel}
									aria-describedby="tilefab-completed-module-handoff-description"
									aria-keyshortcuts={editorCommandAriaKeyShortcuts(["selection.connected"])}
									onClick={selectConnectedAuthoredComponent}
									onKeyDown={(event) => {
										if (
											!editorCommandMatchesKeyboard("selection.connected", event.nativeEvent, {
												context: "selection",
											})
										) {
											return;
										}
										event.preventDefault();
										event.stopPropagation();
										selectConnectedAuthoredComponent();
									}}
								>
									<Layers3 size={15} aria-hidden="true" />
									<span className="tilefab-next-port-handoff-copy">
										<strong>{completedModuleHandoff.label}</strong>
										<small>{completedModuleHandoff.instruction}</small>
									</span>
									<ChevronRight size={15} aria-hidden="true" />
								</button>
							</>
						) : null}
						{eqToStkHandoff ? (
							<>
								<span id="tilefab-eq-to-stk-handoff-description" className="tilefab-sr-only">
									{eqToStkHandoff.description}
								</span>
								<button
									type="button"
									className="tilefab-equipment-next-kind"
									data-testid="ordinary-next-stk-handoff"
									aria-label={eqToStkHandoff.ariaLabel}
									aria-describedby="tilefab-eq-to-stk-handoff-description"
									onClick={() => {
										if (chooseGuidedEquipmentTool("stk", selectedPortEquipment)) {
											setStatus(ORDINARY_STK_HANDOFF_ENTRY_STATUS);
										}
									}}
								>
									<Warehouse size={15} aria-hidden="true" />
									<span className="tilefab-next-port-handoff-copy">
										<strong>{eqToStkHandoff.label}</strong>
										<small>{eqToStkHandoff.instruction}</small>
									</span>
									<ChevronRight size={15} aria-hidden="true" />
								</button>
							</>
						) : null}
						<div className="tilefab-device-actions">
							{actions.delete.code === "DIRECTLY_OWNED" ? (
								<p
									className="tilefab-inspector-notice"
									id="tilefab-equipment-organization-mutation-note"
									data-testid="equipment-organization-mutation-note"
								>
									{actions.move.allowed
										? `소속을 유지하며 같은 Process Loop 안에서 ${actions.editMembership.allowed ? "이동·Port 편집" : "이동"}할 수 있습니다. `
										: null}
									{actions.move.reason ?? actions.delete.reason}.{" "}
									{selectedEquipmentOwnedOutsideProcessLoop
										? "FAB 구조에서 소속을 먼저 정리하세요."
										: "아래 소속을 먼저 분리하세요."}
									{actions.copy.allowed ? " 복제는 계속할 수 있습니다." : null}
								</p>
							) : null}
							{selectedEquipmentGroup.kind === "OHB" ? (
								<button
									type="button"
									className="tilefab-inspector-primary"
									data-testid="move-ohb-port"
									disabled={!actions.move.allowed}
									aria-describedby={equipmentActionDescriptionId(actions.move)}
									onClick={() => startSelectedOhbPlacementIntent("move")}
								>
									<Move size={15} /> 위치 이동
								</button>
							) : (
								<>
									<button
										type="button"
										className="tilefab-inspector-primary"
										data-testid="edit-port-equipment-membership"
										aria-describedby={equipmentActionDescriptionId(actions.editMembership)}
										disabled={!actions.editMembership.allowed}
										onClick={startSelectedPortEquipmentMembershipEdit}
									>
										<MousePointer2 size={15} /> Port 구성 편집
									</button>
									{!selectedEquipmentNeedsGroupMoveForProcessLoop ? (
										<button
											type="button"
											className="tilefab-inspector-primary"
											data-testid="move-port-equipment-group"
											disabled={!actions.move.allowed}
											aria-describedby={equipmentActionDescriptionId(actions.move)}
											onClick={() => startSelectedPortEquipmentGroupEdit("move")}
										>
											<Move size={15} /> 장비 이동
										</button>
									) : null}
								</>
							)}
							<button
								type="button"
								className="tilefab-inspector-primary"
								data-testid="reverse-port-equipment-service-direction"
								disabled={
									!actions.reverseServiceDirection.allowed ||
									modelSyncPending ||
									workerState.status !== "ready"
								}
								aria-describedby={equipmentActionDescriptionId(actions.reverseServiceDirection)}
								title={
									actions.reverseServiceDirection.reason ??
									"전체 Port의 서비스 방향을 반전합니다 · 레일 흐름과 위치는 유지됩니다"
								}
								onClick={reverseSelectedPortEquipmentServiceDirection}
							>
								<RotateCw size={15} /> 서비스 방향 반전
							</button>
						</div>
						<button
							type="button"
							className="tilefab-inspector-primary tilefab-equipment-repeat"
							data-testid="repeat-port-equipment-authoring"
							onClick={() =>
								startEquipmentAuthoringContinuation(
									equipmentAuthoringContinuation(selectedEquipmentGroup),
									selectedPortEquipment,
								)
							}
						>
							<Plus size={15} />{" "}
							{equipmentAuthoringContinuation(selectedEquipmentGroup).buttonLabel}
						</button>
						<p className="tilefab-equipment-repeat-explanation">
							{equipmentAuthoringContinuationExplanation(
								equipmentAuthoringContinuation(selectedEquipmentGroup),
							)}
						</p>
						{selectedEquipmentProcessLoopMembership ? (
							<details
								key={`process-loop-${selectedEquipmentGroup.id}`}
								className="tilefab-equipment-process-loop"
								data-testid="equipment-process-loop-membership"
								data-owner-ids={selectedEquipmentProcessLoopMembership.ownerOrganizationIds.join(
									",",
								)}
								onToggle={(event) => scrollFocusedInspectorDisclosure(event.currentTarget)}
								onKeyDown={(event) => {
									if (event.key !== "Escape" || !event.currentTarget.open) return;
									event.preventDefault();
									event.stopPropagation();
									event.currentTarget.open = false;
									processLoopMembershipDisclosureRef.current?.focus({ preventScroll: true });
								}}
							>
								<summary ref={processLoopMembershipDisclosureRef}>
									<span>
										<strong>Process Loop 소속</strong>
										<small>
											{selectedEquipmentProcessLoopMembership.ownerOrganizationIds.length === 0
												? "미지정 · 연결할 Loop 선택"
												: selectedEquipmentProcessLoopMembership.ownerOrganizationIds
														.map((id) => organizationRecordsById.get(id)?.name ?? `조직 ${id}`)
														.join(", ")}
										</small>
									</span>
									<ChevronDown size={15} aria-hidden="true" />
								</summary>
								<div className="tilefab-equipment-process-loop-body">
									{selectedEquipmentProcessLoopMembership.ownerOrganizationIds.length > 0 ? (
										<>
											<p>
												현재 장비가 직접 속한 조직입니다. 다른 Loop로 옮기려면 먼저 소속을
												분리하세요.
											</p>
											{selectedEquipmentProcessLoopMembership.ownerOrganizationIds.map((id) => {
												const record = organizationRecordsById.get(id);
												const isProcessLoop = organizationSemanticRoles.get(id) === "PROCESS_LOOP";
												return (
													<div className="tilefab-equipment-process-loop-row" key={id}>
														<span>
															{record?.name ?? `조직 ${id}`}
															<small>{isProcessLoop ? "Process Loop" : "기존 조직 소속"}</small>
														</span>
														{isProcessLoop ? (
															<button
																type="button"
																data-testid="detach-equipment-process-loop"
																disabled={
																	!selectedPortEditableDetails ||
																	modelSyncPending ||
																	workerState.status !== "ready"
																}
																onClick={() =>
																	commitSelectedEquipmentProcessLoopMembership("detach", id, {
																		portId: selectedPortDetails.port.id,
																		equipmentGroupId: selectedEquipmentGroup.id,
																	})
																}
															>
																소속 분리
															</button>
														) : null}
													</div>
												);
											})}
											{selectedEquipmentProcessLoopMembership.ownerOrganizationIds.some(
												(id) => organizationSemanticRoles.get(id) !== "PROCESS_LOOP",
											) ? (
												<p>다른 종류의 기존 소속은 구조 편집에서 정리하세요.</p>
											) : null}
										</>
									) : selectedEquipmentProcessLoopMembership.eligibleProcessLoopIds.length > 0 ? (
										<>
											<p>
												장비의 모든 Port 경로가 포함된 Process Loop를 선택하세요. 장비와 Port의
												위치는 유지됩니다.
											</p>
											{selectedEquipmentProcessLoopMembership.eligibleProcessLoopIds.map((id) => {
												const record = organizationRecordsById.get(id);
												const bay = record
													? staticFabOrganizationParentIds(record)
															.map((parentId) => organizationRecordsById.get(parentId))
															.find(
																(parent) =>
																	parent && organizationSemanticRoles.get(parent.id) === "BAY",
															)
													: undefined;
												return (
													<button
														key={id}
														type="button"
														className="tilefab-equipment-process-loop-choice"
														data-testid="attach-equipment-process-loop"
														data-process-loop-id={id}
														disabled={
															!selectedPortEditableDetails ||
															modelSyncPending ||
															workerState.status !== "ready"
														}
														onClick={() =>
															commitSelectedEquipmentProcessLoopMembership("attach", id, {
																portId: selectedPortDetails.port.id,
																equipmentGroupId: selectedEquipmentGroup.id,
															})
														}
													>
														<span>
															<strong>{record?.name ?? `Process Loop ${id}`}</strong>
															<small>{bay ? `${bay.name} / Process Loop` : "Process Loop"}</small>
														</span>
														<Plus size={15} aria-hidden="true" />
													</button>
												);
											})}
										</>
									) : (
										<p role="status">
											{selectedEquipmentProcessLoopMembership.reason ??
												"연결 가능한 Process Loop가 없습니다."}{" "}
											· FAB 구조에서 Loop와 Port 경로를 확인하세요.
										</p>
									)}
								</div>
							</details>
						) : null}
					</>
				) : null}

				{viewMode === "2d" ? (
					<details
						key={`${selectedEquipmentGroup.kind}-${selectedEquipmentGroup.id}-PORT-${selectedPortDetails.port.id}`}
						className="tilefab-equipment-more-actions"
						data-testid="port-equipment-more-actions"
						onToggle={(event) => scrollFocusedInspectorDisclosure(event.currentTarget)}
					>
						<summary>
							<span>복제·철거</span>
							<ChevronDown size={15} aria-hidden="true" />
						</summary>
						<div className="tilefab-equipment-more-actions-body">
							{selectedEquipmentGroup.kind === "OHB" ? (
								<button
									type="button"
									className="tilefab-inspector-primary"
									data-testid="copy-ohb-port"
									disabled={!actions.copy.allowed}
									aria-describedby={equipmentActionDescriptionId(actions.copy)}
									onClick={() => startSelectedOhbPlacementIntent("copy")}
								>
									<Copy size={15} /> OHB 복제
								</button>
							) : (
								<button
									type="button"
									className="tilefab-inspector-primary"
									data-testid="copy-port-equipment-group"
									disabled={!actions.copy.allowed}
									aria-describedby={equipmentActionDescriptionId(actions.copy)}
									onClick={() => startSelectedPortEquipmentGroupEdit("copy")}
								>
									<Copy size={15} /> 장비 복제
								</button>
							)}
							<button
								type="button"
								className="tilefab-inspector-danger"
								data-testid="delete-port-equipment"
								disabled={!actions.delete.allowed}
								aria-describedby={equipmentActionDescriptionId(actions.delete)}
								onClick={deleteSelected}
							>
								<Trash2 size={15} /> 장비와 연결 Port 철거
							</button>
						</div>
					</details>
				) : null}
				{selectedEquipmentGroup.kind !== "OHB" ? (
					<dl className="tilefab-device-facts">
						{selectedEquipmentGroup.kind === "EQ" ? (
							<>
								<div>
									<dt>Port 간격</dt>
									<dd>{selectedEquipmentGroup.pitchMillimeters / 1_000} m</dd>
								</div>
								<div>
									<dt>공정 Recipe</dt>
									<dd>{selectedEquipmentGroup.recipe ?? "-"}</dd>
								</div>
							</>
						) : null}
						{selectedEquipmentGroup.kind === "STK" ? (
							<div>
								<dt>Port 구성</dt>
								<dd>{stkAuthoringTemplateLabel(selectedEquipmentGroup.template)}</dd>
							</div>
						) : null}
					</dl>
				) : null}

				{viewMode === "2d" ? (
					<button
						ref={nextPortEquipmentButtonRef}
						type="button"
						className="tilefab-equipment-next-selection"
						data-testid="select-next-port-equipment"
						title="가려진 장비를 순서대로 선택"
						disabled={activePortEquipment.equipmentGroups.length < 2}
						onClick={selectNextPortEquipmentGroup}
					>
						<ChevronRight size={15} aria-hidden="true" />{" "}
						{activePortEquipment.equipmentGroups.length > 1 ? "다음 장비 선택" : "다른 장비 없음"}
					</button>
				) : null}

				<details
					key={selectedPortDetails.port.id}
					className="tilefab-equipment-more-actions"
					data-testid="equipment-port-connection-details"
					onToggle={(event) => scrollFocusedInspectorDisclosure(event.currentTarget)}
				>
					<summary>
						<span>연결 정보 · Port {selectedPortDetails.port.id}</span>
						<ChevronDown size={15} aria-hidden="true" />
					</summary>
					<dl>
						{selectedPortDetails.port.barcode ? (
							<div>
								<dt>바코드</dt>
								<dd>{selectedPortDetails.port.barcode}</dd>
							</div>
						) : null}
						<div>
							<dt>PORT ID</dt>
							<dd>PORT-{selectedPortDetails.port.id}</dd>
						</div>

						<div>
							<dt>ROUTE</dt>
							<dd title={portRouteDetail(selectedPortDetails.port)}>
								{portRouteSummary(selectedPortDetails.port)}
							</dd>
						</div>
						<div>
							<dt>STATION</dt>
							<dd>{selectedPortDetails.port.stationMillimeters} mm</dd>
						</div>
						<div>
							<dt>SIDE / OFFSET</dt>
							<dd>
								{selectedPortDetails.port.side} ·{" "}
								{selectedPortDetails.port.lateralOffsetMillimeters} mm
							</dd>
						</div>
						<div>
							<dt>DIRECTION</dt>
							<dd>{selectedPortDetails.port.direction.replaceAll("_", " ")}</dd>
						</div>
					</dl>
				</details>
			</div>
		</aside>
	);
}

function equipmentActionDescriptionId(action: PortEquipmentActionDecision): string | undefined {
	switch (action.code) {
		case "SELECTION_NOT_EDITABLE":
			return "tilefab-equipment-selection-mutation-note";
		case "DIRECTLY_OWNED":
			return "tilefab-equipment-organization-mutation-note";
		case "LEGACY_CUSTOM":
			return "tilefab-stk-membership-note";
		default:
			return undefined;
	}
}
