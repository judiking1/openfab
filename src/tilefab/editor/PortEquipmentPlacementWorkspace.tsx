import {
	Check,
	ChevronRight,
	Factory,
	Move,
	PackagePlus,
	Route,
	Search,
	Undo2,
	Warehouse,
	X,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { EQ_PORT_PITCHES_MILLIMETERS } from "../compile/EqRowDraftSelector";
import type { StkAuthoringTemplate, StkDraftSelection } from "../compile/StkDraftSelector";
import { STK_AUTHORING_TEMPLATES } from "../compile/StkDraftSelector";
import type { PortType } from "../core/PortRecord";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import type { EditorTool } from "./EditorTool";
import { EquipmentAuthoringWorkspace } from "./EquipmentAuthoringWorkspace";
import type { GuidedBuildKeyboardPortState } from "./GuidedBuildPanel";
import type { GuidedBuildPrimaryTarget } from "./GuidedBuildPrimaryTarget";
import type {
	GuidedPortKeyboardSession,
	GuidedPortKeyboardType,
} from "./GuidedPortKeyboardSession";
import { ordinaryPortKeyboardEscapePresentation } from "./GuidedPortKeyboardSession";
import type { OrdinaryEqExitPresentation } from "./OrdinaryEqAuthoringPresentation";
import type { OrdinaryNextPortHandoffPresentation } from "./OrdinaryNextPortHandoff";
import {
	ORDINARY_EQ_HANDOFF_ENTRY_STATUS,
	ordinaryEqHandoffRailPrerequisiteStatus,
} from "./OrdinaryNextPortHandoff";
import type { OrdinaryPortProcessLoopScope } from "./OrdinaryPortProcessLoopScope";
import type { PortAuthoringSurfacePresentation } from "./PortAuthoringSurfacePresentation";
import type { PortEquipmentSelectionIdentity } from "./PortEquipmentInspectorSelection";
import { PORT_EQUIPMENT_NEXT_CANDIDATE_RADIUS_METERS } from "./PortEquipmentKeyboardNavigation";
import { stkTemplatePresentation } from "./StkDraftPresentation";

export interface PortEquipmentPlacementWorkspaceProps {
	readonly applyGuidedPortKeyboard: () => void;
	readonly activeMap: Readonly<{ size: number }>;
	readonly activePortAuthoringInstruction: string;
	readonly activePortAuthoringPresentation: PortAuthoringSurfacePresentation;
	readonly activePortAuthoringType: PortType;
	readonly activeStkZoomActionLabel: string;
	readonly basePortAuthoringInstruction: string;
	readonly bindEquipmentSelectionReadout: (node: HTMLSpanElement | null) => void;
	readonly cancelGuidedPortKeyboard: (
		message?: string,
		restoreFocus?: boolean,
		resumeKeyboard?: boolean,
	) => void;
	readonly canvasRef: RefObject<HTMLCanvasElement | null>;
	readonly chooseExplicitEditorTool: (next: EditorTool) => boolean;
	readonly chooseGuidedEquipmentTool: (
		next: "ohb" | "eq" | "stk",
		returnSelection?: PortEquipmentSelectionIdentity | null,
	) => boolean;
	readonly chooseOrdinaryPortProcessLoop: (organizationId: number | null) => void;
	readonly completeStkDraft: () => void;
	readonly editorMutationWaitActive: boolean;
	readonly eqPitchMillimeters: number;
	readonly eqRecipe: string;
	readonly equipmentProcessLoopChoices: readonly Readonly<{ id: number; label: string }>[];
	readonly exitOrdinaryPortAuthoring: () => void;
	readonly guidedBuildCommandsActionable: boolean;
	readonly guidedBuildExperienceActive: boolean;
	readonly guidedBuildPortPlacementCoach: Readonly<{
		scopeIncludesRow: ((row: number) => boolean) | undefined;
		label: string;
		instruction: string;
		reservedLeftPixels: number;
		gesture: "single" | "row";
		recommendedPortCount: number;
	}> | null;
	readonly guidedBuildPrimaryTarget: GuidedBuildPrimaryTarget | null;
	readonly guidedPortKeyboard: GuidedBuildKeyboardPortState | null;
	readonly guidedPortKeyboardSessionRef: RefObject<GuidedPortKeyboardSession | null>;
	readonly inspectRecentPlacedOhb: () => void;
	readonly modelSyncPending: boolean;
	readonly ohbPlacementIntent: Readonly<
		PortEquipmentSelectionIdentity & { kind: "move" | "copy" }
	> | null;
	readonly ordinaryEqRowExit: OrdinaryEqExitPresentation | null;
	readonly ordinaryOhbNextPortHandoff: OrdinaryNextPortHandoffPresentation | null;
	readonly ordinaryPortKeyboardEntryVisible: boolean;
	readonly ordinaryPortProcessLoopFeedback: Readonly<{ message: string }> | null;
	readonly ordinaryPortProcessLoopFeedbackRef: RefObject<HTMLSpanElement | null>;
	readonly ordinaryPortProcessLoopTargetId: number | null;
	readonly portRowDragActive: boolean;
	readonly portTargetZoomHidden: boolean;
	readonly portTargetZoomButtonRef: RefObject<HTMLButtonElement | null>;
	readonly reframeGuidedPortRecommendations: () => void;
	readonly removeLastStkDraftPort: () => void;
	readonly resumeOrdinaryPortKeyboard: () => void;
	readonly selectedEquipmentProcessLoopChoice: Readonly<{ id: number; label: string }> | null;
	readonly selectedEquipmentProcessLoopScope: OrdinaryPortProcessLoopScope | null;
	readonly setEqPitchMillimeters: (next: number) => void;
	readonly setEqRecipe: (next: string) => void;
	readonly setOrdinaryPortProcessLoopFeedback: (message: string | null) => void;
	readonly setStatus: (message: string) => void;
	readonly setStkTemplate: (next: StkAuthoringTemplate, restoreCanvasFocus?: boolean) => void;
	readonly showNextOrdinaryPort: () => void;
	readonly showStkSelection: () => void;
	readonly startOrdinaryPortKeyboard: (
		portType: GuidedPortKeyboardType,
		statusMessage?: string,
		initialTarget?: Readonly<{ x: number; z: number }>,
		focusCanvas?: boolean,
		preferredRow?: number,
	) => void;
	readonly stkDraftReady: boolean;
	readonly stkDraftReview: Readonly<{
		title: string;
		instruction: string;
		issue: string | null;
		ready: boolean;
	}>;
	readonly stkDraftSelection: StkDraftSelection | null;
	readonly stkTemplate: StkAuthoringTemplate;
	readonly tool: EditorTool;
	readonly visibleRecentPlacedOhb: Readonly<{ selection: PortEquipmentSelectionIdentity }> | null;
	readonly workerState: Pick<RailWorkerBridgeState, "status">;
	readonly zoomCurrentPortTarget: () => void;
}

export function PortEquipmentPlacementWorkspace({
	applyGuidedPortKeyboard,
	activeMap,
	activePortAuthoringInstruction,
	activePortAuthoringPresentation,
	activePortAuthoringType,
	activeStkZoomActionLabel,
	basePortAuthoringInstruction,
	bindEquipmentSelectionReadout,
	cancelGuidedPortKeyboard,
	canvasRef,
	chooseExplicitEditorTool,
	chooseGuidedEquipmentTool,
	chooseOrdinaryPortProcessLoop,
	completeStkDraft,
	editorMutationWaitActive,
	eqPitchMillimeters,
	eqRecipe,
	equipmentProcessLoopChoices,
	exitOrdinaryPortAuthoring,
	guidedBuildCommandsActionable,
	guidedBuildExperienceActive,
	guidedBuildPortPlacementCoach,
	guidedBuildPrimaryTarget,
	guidedPortKeyboard,
	guidedPortKeyboardSessionRef,
	inspectRecentPlacedOhb,
	modelSyncPending,
	ohbPlacementIntent,
	ordinaryEqRowExit,
	ordinaryOhbNextPortHandoff,
	ordinaryPortKeyboardEntryVisible,
	ordinaryPortProcessLoopFeedback,
	ordinaryPortProcessLoopFeedbackRef,
	ordinaryPortProcessLoopTargetId,
	portRowDragActive,
	portTargetZoomHidden,
	portTargetZoomButtonRef,
	reframeGuidedPortRecommendations,
	removeLastStkDraftPort,
	resumeOrdinaryPortKeyboard,
	selectedEquipmentProcessLoopChoice,
	selectedEquipmentProcessLoopScope,
	setEqPitchMillimeters,
	setEqRecipe,
	setOrdinaryPortProcessLoopFeedback,
	setStatus,
	setStkTemplate,
	showNextOrdinaryPort,
	showStkSelection,
	startOrdinaryPortKeyboard,
	stkDraftReady,
	stkDraftReview,
	stkDraftSelection,
	stkTemplate,
	tool,
	visibleRecentPlacedOhb,
	workerState,
	zoomCurrentPortTarget,
}: PortEquipmentPlacementWorkspaceProps): ReactNode {
	return (
		<EquipmentAuthoringWorkspace
			key={tool}
			portType={activePortAuthoringType}
			intent={tool === "ohb" ? (ohbPlacementIntent?.kind ?? "place") : "place"}
			heading={
				<span className="tilefab-equipment-workspace-title">
					{tool === "stk" ? (
						<Warehouse size={15} />
					) : tool === "eq" ? (
						<Factory size={15} />
					) : ohbPlacementIntent?.kind === "move" ? (
						<Move size={15} />
					) : (
						<PackagePlus size={15} />
					)}
					{tool === "ohb" && ohbPlacementIntent?.kind === "move"
						? "OHB 위치 변경"
						: tool === "ohb" && ohbPlacementIntent?.kind === "copy"
							? "OHB 복제"
							: activePortAuthoringType === "OHB"
								? "OHB · 상부 보관"
								: activePortAuthoringType === "EQ"
									? "EQ · 공정 장비"
									: "Stocker · 보관 장비"}
				</span>
			}
			exitInActions={tool === "eq" && activePortAuthoringPresentation.configurationAvailable}
			exit={
				!guidedBuildExperienceActive || ordinaryEqRowExit ? (
					<button
						type="button"
						className="tilefab-placement-exit tilefab-port-authoring-exit"
						data-testid="ordinary-port-authoring-exit"
						aria-keyshortcuts={
							tool === "stk" && (stkDraftSelection?.rows.length ?? 0) > 0 ? undefined : "Escape"
						}
						aria-label={
							ordinaryEqRowExit?.ariaLabel ??
							(ohbPlacementIntent
								? "OHB 이동·복제 취소"
								: tool === "stk"
									? "Stocker 배치 종료"
									: "Port 배치 종료")
						}
						data-exit-scope={ordinaryEqRowExit ? "eq-row" : "port-authoring"}
						onClick={() => {
							if (ordinaryEqRowExit) {
								cancelGuidedPortKeyboard(
									ordinaryPortKeyboardEscapePresentation("EQ", "choose-end").message,
									true,
									true,
								);
								return;
							}
							exitOrdinaryPortAuthoring();
						}}
					>
						<X size={14} />{" "}
						{ordinaryEqRowExit?.label ??
							(ohbPlacementIntent
								? "이동·복제 취소"
								: tool === "stk"
									? "Stocker 배치 종료"
									: "Port 배치 종료")}
					</button>
				) : null
			}
			selection={
				<>
					{activePortAuthoringPresentation.configurationAvailable ? (
						<ol className="tilefab-equipment-steps" aria-label="배치 단계">
							<li
								aria-current={
									tool === "stk"
										? stkDraftReady
											? undefined
											: "step"
										: tool !== "eq" ||
												(!portRowDragActive && guidedPortKeyboard?.phase !== "choose-end")
											? "step"
											: undefined
								}
							>
								<span>1</span> {tool === "eq" ? "시작점" : "위치 선택"}
							</li>
							{tool === "eq" ? (
								<li
									aria-current={
										portRowDragActive || guidedPortKeyboard?.phase === "choose-end"
											? "step"
											: undefined
									}
								>
									<span>2</span> 끝점 · 배치
								</li>
							) : null}
							{tool === "stk" ? (
								<li aria-current={stkDraftReady ? "step" : undefined}>
									<span>2</span> Stocker 생성
								</li>
							) : null}
						</ol>
					) : null}

					{ordinaryPortProcessLoopFeedback ? (
						<small
							ref={ordinaryPortProcessLoopFeedbackRef}
							className="tilefab-equipment-process-loop-feedback tilefab-equipment-process-loop-feedback-standalone"
							data-testid="ordinary-port-process-loop-feedback"
							role="note"
						>
							{ordinaryPortProcessLoopFeedback.message}
						</small>
					) : null}
					<span
						id="tilefab-port-authoring-instruction"
						className="tilefab-port-authoring-instruction"
						data-state={tool === "stk" && stkDraftReview.issue ? "blocked" : "ready"}
					>
						{tool === "stk" ? (
							<span
								className="tilefab-stk-review"
								data-testid="stk-draft-review"
								role={guidedPortKeyboard ? undefined : "status"}
							>
								<strong>{stkDraftReview.title}</strong>
								{stkDraftReview.issue ? (
									<span className="tilefab-stk-review-issue">{stkDraftReview.issue}</span>
								) : null}
							</span>
						) : null}
						{!activePortAuthoringPresentation.configurationAvailable ||
						(ordinaryPortProcessLoopTargetId !== null &&
							!selectedEquipmentProcessLoopScope?.eligibleCount) ? (
							<span className="tilefab-port-authoring-detail" role="status">
								{activePortAuthoringInstruction}
							</span>
						) : (
							<span className="tilefab-sr-only">
								{ohbPlacementIntent
									? `PORT-${ohbPlacementIntent.portId} · 방향키/WASD로 대상 이동 · Enter 또는 클릭으로 ${ohbPlacementIntent.kind === "move" ? "이동" : "복제"} · Esc 취소`
									: tool === "stk"
										? basePortAuthoringInstruction
										: activePortAuthoringInstruction}
							</span>
						)}

						<span className="tilefab-equipment-view-actions">
							{guidedBuildPortPlacementCoach ? (
								<button
									type="button"
									className="tilefab-equipment-fit-selection"
									data-testid="guided-port-recommendations-reset"
									disabled={!guidedBuildCommandsActionable}
									onClick={reframeGuidedPortRecommendations}
								>
									<Search size={14} aria-hidden="true" />{" "}
									{tool === "eq" && guidedPortKeyboard?.phase === "choose-end"
										? "행 선택 취소 · 추천 보기"
										: "추천 위치 다시 보기"}
								</button>
							) : null}
							{!guidedBuildExperienceActive &&
							tool === "stk" &&
							(stkDraftSelection?.rows.length ?? 0) > 0 ? (
								<button
									type="button"
									className="tilefab-equipment-fit-selection"
									data-testid="stk-fit-selection"
									onClick={showStkSelection}
								>
									<Search size={14} aria-hidden="true" /> 선택 범위 보기
								</button>
							) : null}
							{guidedPortKeyboard ? (
								<button
									ref={portTargetZoomButtonRef}
									type="button"
									className="tilefab-stk-zoom-current tilefab-equipment-zoom-current"
									data-testid={tool === "stk" ? "ordinary-stk-zoom-in" : "ordinary-port-zoom-in"}
									hidden={portTargetZoomHidden}
									onClick={zoomCurrentPortTarget}
								>
									<Search size={14} aria-hidden="true" />
									{tool === "stk" ? activeStkZoomActionLabel : "현재 Port 확대"}
								</button>
							) : null}
							{guidedPortKeyboard?.scope === "ordinary" &&
							!guidedBuildExperienceActive &&
							!ohbPlacementIntent ? (
								<button
									type="button"
									className="tilefab-equipment-fit-selection"
									data-testid="ordinary-port-next-candidate"
									aria-label={`다른 Port (±${PORT_EQUIPMENT_NEXT_CANDIDATE_RADIUS_METERS}m) · 현재 Port 주변 가로·세로 ±${PORT_EQUIPMENT_NEXT_CANDIDATE_RADIUS_METERS}미터 범위에서 보기`}
									onClick={showNextOrdinaryPort}
								>
									<ChevronRight size={14} aria-hidden="true" /> 다른 Port (±
									{PORT_EQUIPMENT_NEXT_CANDIDATE_RADIUS_METERS}m)
								</button>
							) : null}
							{guidedPortKeyboard?.scope === "ordinary" && visibleRecentPlacedOhb ? (
								<button
									type="button"
									className="tilefab-equipment-fit-selection tilefab-recent-ohb-inspect"
									data-testid="ordinary-recent-ohb-inspect"
									aria-label={`방금 만든 OHB-${visibleRecentPlacedOhb.selection.equipmentGroupId} 속성 보기`}
									disabled={
										editorMutationWaitActive || modelSyncPending || workerState.status !== "ready"
									}
									onClick={inspectRecentPlacedOhb}
								>
									OHB-{visibleRecentPlacedOhb.selection.equipmentGroupId} 속성 보기
								</button>
							) : null}
						</span>
					</span>
					{ordinaryPortKeyboardEntryVisible ||
					(visibleRecentPlacedOhb && guidedPortKeyboard?.scope !== "ordinary") ? (
						<span className="tilefab-port-postplacement-actions">
							{ordinaryPortKeyboardEntryVisible ? (
								<button
									type="button"
									className="tilefab-port-keyboard-start"
									data-testid="ordinary-port-keyboard-start"
									disabled={
										editorMutationWaitActive ||
										portRowDragActive ||
										(ordinaryPortProcessLoopTargetId !== null &&
											!selectedEquipmentProcessLoopScope?.eligibleCount)
									}
									onClick={resumeOrdinaryPortKeyboard}
								>
									키보드 배치 시작
								</button>
							) : null}
							{visibleRecentPlacedOhb && guidedPortKeyboard?.scope !== "ordinary" ? (
								<button
									type="button"
									className="tilefab-port-keyboard-start tilefab-recent-ohb-inspect"
									data-testid="ordinary-recent-ohb-inspect"
									aria-label={`방금 만든 OHB-${visibleRecentPlacedOhb.selection.equipmentGroupId} 속성 보기`}
									disabled={
										editorMutationWaitActive || modelSyncPending || workerState.status !== "ready"
									}
									onClick={inspectRecentPlacedOhb}
								>
									OHB-{visibleRecentPlacedOhb.selection.equipmentGroupId} 속성 보기
								</button>
							) : null}
						</span>
					) : null}
					{tool !== "stk" ? (
						<span
							ref={bindEquipmentSelectionReadout}
							className="tilefab-equipment-selection-readout"
							data-reserve-feedback={tool === "eq" && !guidedBuildExperienceActive}
							tabIndex={tool === "eq" && !guidedBuildExperienceActive ? 0 : undefined}
							aria-live={guidedPortKeyboard ? "off" : "polite"}
						/>
					) : null}
				</>
			}
			settings={
				activePortAuthoringPresentation.configurationAvailable &&
				(tool === "eq" || tool === "stk") ? (
					<>
						{tool === "eq" && activePortAuthoringPresentation.configurationAvailable ? (
							<fieldset className="tilefab-segmented tilefab-eq-pitch" aria-label="EQ 포트 피치">
								<legend>Port 간격</legend>
								{EQ_PORT_PITCHES_MILLIMETERS.map((pitch) => (
									<button
										type="button"
										key={pitch}
										data-active={eqPitchMillimeters === pitch}
										aria-pressed={eqPitchMillimeters === pitch}
										onClick={() => setEqPitchMillimeters(pitch)}
									>
										{pitch / 1_000} m
									</button>
								))}
							</fieldset>
						) : null}{" "}
						{tool === "stk" && activePortAuthoringPresentation.configurationAvailable ? (
							<label className="tilefab-stk-template-choice">
								<span>포트 구성</span>
								<select
									data-testid="stk-template-select"
									aria-label="Stocker 포트 구성"
									aria-describedby="tilefab-port-authoring-instruction"
									value={stkTemplate}
									onChange={(event) =>
										setStkTemplate(event.target.value as StkAuthoringTemplate, false)
									}
								>
									{STK_AUTHORING_TEMPLATES.map((template) => (
										<option key={template} value={template}>
											{stkTemplatePresentation(template).label}
										</option>
									))}
								</select>
							</label>
						) : null}
					</>
				) : null
			}
			actions={
				tool === "eq" && activePortAuthoringPresentation.configurationAvailable ? (
					<button
						type="button"
						className="tilefab-equipment-confirm"
						data-testid="eq-placement-confirm"
						disabled={editorMutationWaitActive || !guidedPortKeyboard}
						aria-keyshortcuts="Enter"
						onClick={() => {
							applyGuidedPortKeyboard();
							canvasRef.current?.focus({ preventScroll: true });
						}}
					>
						<Check size={15} />{" "}
						{guidedPortKeyboard?.phase === "choose-end" ? "EQ 배치" : "시작점 선택"}
					</button>
				) : tool === "stk" && activePortAuthoringPresentation.configurationAvailable ? (
					<fieldset
						className="tilefab-segmented tilefab-stk-actions"
						aria-label="Stocker 포트 선택 작업"
					>
						<button
							type="button"
							data-testid="stk-remove-last"
							aria-label="마지막 Port 제거"
							title="마지막 Port 제거"
							disabled={!stkDraftSelection?.rows.length}
							onClick={removeLastStkDraftPort}
						>
							<Undo2 size={13} />
						</button>
						<button
							type="button"
							className="tilefab-stk-cancel"
							data-testid="stk-cancel"
							aria-label="선택한 Stocker 포트 모두 취소"
							title="선택한 Stocker 포트 모두 취소"
							aria-keyshortcuts="Escape"
							disabled={!stkDraftSelection?.rows.length}
							onClick={() =>
								cancelGuidedPortKeyboard(
									ordinaryPortKeyboardEscapePresentation(
										"STK",
										"choose-slot",
										stkDraftSelection?.rows.length ?? 0,
									).message,
									true,
									true,
								)
							}
						>
							<X size={13} /> 선택 초기화
						</button>
						<button
							type="button"
							className="tilefab-stk-complete"
							data-testid="stk-complete"
							data-guided-action-id="command:stk.complete"
							data-guided-target={
								guidedBuildPrimaryTarget?.id === "command:stk.complete" ? "true" : undefined
							}
							disabled={editorMutationWaitActive || !stkDraftReady}
							aria-keyshortcuts="Shift+Enter"
							aria-describedby={
								guidedBuildPrimaryTarget?.id === "command:stk.complete"
									? "tilefab-port-authoring-instruction tilefab-guided-primary-target-description"
									: "tilefab-port-authoring-instruction"
							}
							onClick={completeStkDraft}
						>
							<Check size={13} /> Stocker 생성
						</button>
					</fieldset>
				) : null
			}
			continuation={
				ordinaryOhbNextPortHandoff ||
				(!guidedBuildExperienceActive &&
					activePortAuthoringPresentation.prerequisiteAction &&
					!ohbPlacementIntent) ? (
					<>
						{!guidedBuildExperienceActive &&
						activePortAuthoringPresentation.prerequisiteAction &&
						!ohbPlacementIntent ? (
							<button
								type="button"
								className="tilefab-port-next-kind tilefab-port-prerequisite"
								data-testid="ordinary-port-build-prerequisite"
								aria-label={activePortAuthoringPresentation.prerequisiteAction.ariaLabel}
								aria-describedby="tilefab-port-authoring-instruction"
								onClick={() => {
									if (!chooseExplicitEditorTool("build")) return;
									setStatus(
										activeMap.size === 0
											? "빈 FAB · 드래그 또는 Enter로 첫 직선 레일을 만드세요"
											: "레일 · 직선 레일을 늘리거나 새로 만드세요",
									);
									requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));
								}}
							>
								<Route size={14} aria-hidden="true" />
								<strong>{activePortAuthoringPresentation.prerequisiteAction.label}</strong>
								<ChevronRight size={14} aria-hidden="true" />
							</button>
						) : null}
						{ordinaryOhbNextPortHandoff ? (
							<>
								<span id="tilefab-next-port-handoff-description" className="tilefab-sr-only">
									{ordinaryOhbNextPortHandoff.description}
								</span>
								<button
									type="button"
									className="tilefab-port-next-kind"
									data-testid="ordinary-next-port-handoff"
									data-handoff-action={ordinaryOhbNextPortHandoff.action}
									aria-label={ordinaryOhbNextPortHandoff.ariaLabel}
									aria-describedby="tilefab-next-port-handoff-description"
									onClick={() => {
										if (ordinaryOhbNextPortHandoff.action === "prepare-eq-rail") {
											if (chooseExplicitEditorTool("build")) {
												setStatus(ordinaryEqHandoffRailPrerequisiteStatus(eqPitchMillimeters));
												requestAnimationFrame(() =>
													canvasRef.current?.focus({ preventScroll: true }),
												);
											}
										} else if (chooseGuidedEquipmentTool("eq")) {
											setStatus(ORDINARY_EQ_HANDOFF_ENTRY_STATUS);
										}
									}}
								>
									{ordinaryOhbNextPortHandoff.action === "prepare-eq-rail" ? (
										<Route size={14} aria-hidden="true" />
									) : (
										<Factory size={14} aria-hidden="true" />
									)}
									<span className="tilefab-next-port-handoff-copy">
										<strong>{ordinaryOhbNextPortHandoff.label}</strong>
										<small>{ordinaryOhbNextPortHandoff.instruction}</small>
									</span>
									<ChevronRight size={14} aria-hidden="true" />
								</button>
							</>
						) : null}
					</>
				) : null
			}
			optionalSettings={
				<>
					{!guidedBuildExperienceActive &&
					!ohbPlacementIntent &&
					equipmentProcessLoopChoices.length > 0 ? (
						<div className="tilefab-equipment-process-loop-target">
							<label htmlFor="tilefab-ordinary-port-process-loop-target">
								<span className="tilefab-equipment-process-loop-label-full">Port 배치 범위</span>
								<span className="tilefab-equipment-process-loop-label-compact">Port 범위</span>
							</label>
							<select
								id="tilefab-ordinary-port-process-loop-target"
								aria-label="Port 배치 범위 (Process Loop)"
								data-testid="ordinary-port-process-loop-target"
								value={ordinaryPortProcessLoopTargetId ?? ""}
								onChange={(event) =>
									chooseOrdinaryPortProcessLoop(
										event.currentTarget.value === "" ? null : Number(event.currentTarget.value),
									)
								}
							>
								<option value="">전체 Port 슬롯</option>
								{equipmentProcessLoopChoices.map((choice) => (
									<option key={choice.id} value={choice.id}>
										{choice.label}
									</option>
								))}
							</select>
							{!guidedPortKeyboard ? (
								<button
									type="button"
									className="tilefab-equipment-process-loop-start"
									data-testid="ordinary-port-process-loop-start"
									disabled={
										ordinaryPortProcessLoopTargetId !== null &&
										!selectedEquipmentProcessLoopScope?.eligibleCount
									}
									onClick={() => {
										setOrdinaryPortProcessLoopFeedback(null);
										if (!guidedPortKeyboardSessionRef.current && activePortAuthoringType) {
											startOrdinaryPortKeyboard(activePortAuthoringType);
										} else canvasRef.current?.focus({ preventScroll: true });
									}}
								>
									배치 시작
								</button>
							) : null}
							{ordinaryPortProcessLoopTargetId !== null || ordinaryPortProcessLoopFeedback ? (
								<small data-testid="ordinary-port-process-loop-target-count">
									{ordinaryPortProcessLoopTargetId !== null &&
									selectedEquipmentProcessLoopChoice ? (
										<span
											className="tilefab-equipment-process-loop-selected-name"
											data-testid="ordinary-port-process-loop-selected-name"
										>
											{selectedEquipmentProcessLoopChoice.label}
											{" · "}{" "}
										</span>
									) : null}
									{ordinaryPortProcessLoopTargetId !== null ? (
										<>
											직접 연결된 {activePortAuthoringType} 슬롯{" "}
											{selectedEquipmentProcessLoopScope?.eligibleCount ?? 0}개
											{selectedEquipmentProcessLoopScope?.eligibleCount
												? " · 생성 뒤 장비 속성에서 소속 확정"
												: null}
										</>
									) : null}
								</small>
							) : null}
						</div>
					) : null}

					<span className="tilefab-port-authoring-detail">
						{ohbPlacementIntent
							? `PORT-${ohbPlacementIntent.portId} · 방향키/WASD로 대상 이동 · Enter 또는 클릭으로 ${ohbPlacementIntent.kind === "move" ? "이동" : "복제"} · Esc 취소`
							: tool === "stk"
								? basePortAuthoringInstruction
								: activePortAuthoringInstruction}
					</span>
					{tool === "eq" && activePortAuthoringPresentation.configurationAvailable ? (
						<label className="tilefab-eq-recipe">
							<span>공정 Recipe</span>
							<input
								type="text"
								value={eqRecipe}
								maxLength={120}
								placeholder="선택 사항"
								onChange={(event) => setEqRecipe(event.currentTarget.value)}
							/>
						</label>
					) : null}
				</>
			}
		/>
	);
}
