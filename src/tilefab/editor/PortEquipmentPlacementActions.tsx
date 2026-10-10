import { Check, Undo2, X } from "lucide-react";
import { ordinaryPortKeyboardEscapePresentation } from "./GuidedPortKeyboardSession";
import type { PortEquipmentPlacementWorkspaceProps } from "./PortEquipmentPlacementWorkspace";

type Props = Pick<
	PortEquipmentPlacementWorkspaceProps,
	| "applyGuidedPortKeyboard"
	| "activePortAuthoringPresentation"
	| "cancelGuidedPortKeyboard"
	| "canvasRef"
	| "completeStkDraft"
	| "editorMutationWaitActive"
	| "exitOrdinaryPortAuthoring"
	| "guidedBuildExperienceActive"
	| "guidedBuildPrimaryTarget"
	| "guidedPortKeyboard"
	| "ohbPlacementIntent"
	| "ordinaryEqRowExit"
	| "removeLastStkDraftPort"
	| "stkDraftReady"
	| "stkDraftSelection"
	| "tool"
>;
/** Existing equipment commands, presented in the active task's fixed action slot. */
export function PortEquipmentPlacementActions({
	applyGuidedPortKeyboard,
	activePortAuthoringPresentation,
	cancelGuidedPortKeyboard,
	canvasRef,
	completeStkDraft,
	editorMutationWaitActive,
	exitOrdinaryPortAuthoring,
	guidedBuildExperienceActive,
	guidedBuildPrimaryTarget,
	guidedPortKeyboard,
	ohbPlacementIntent,
	ordinaryEqRowExit,
	removeLastStkDraftPort,
	stkDraftReady,
	stkDraftSelection,
	tool,
}: Props) {
	return (
		<div className="tilefab-equipment-actions">
			{!guidedBuildExperienceActive || ordinaryEqRowExit ? (
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
			) : null}
			{tool === "eq" && activePortAuthoringPresentation.configurationAvailable ? (
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
			) : null}
		</div>
	);
}
