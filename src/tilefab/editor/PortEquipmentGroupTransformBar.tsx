import { Check, Copy, Move, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type {
	PortEquipmentGroupEditMode,
	PortEquipmentGroupEditPlan,
} from "../compile/PortEquipmentGroupEditPlanner";
import type { CompiledPortSlots } from "../compile/PortSlotCompiler";
import type { EquipmentGroupRecord } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { observePortDockClearance } from "./observePortDockClearance";
import { portEquipmentGroupEditFeedback, stkPortMoveCoordinates } from "./StkDraftPresentation";

export interface PortEquipmentGroupTransformBarProps {
	readonly onApply: () => void;
	readonly busy: boolean;
	readonly cancelButtonRef: RefObject<HTMLButtonElement | null>;
	readonly exitPortEquipmentGroupEditToInspect: (message: string) => void;
	readonly portEquipmentGroupEditSession: Readonly<{
		scope?: "group" | "port";
		sourceAnchorPortId?: number;
		sourcePorts?: readonly PortRecord[];
		targetRow?: number | null;
		mode: PortEquipmentGroupEditMode;
		preservesLoopOwnership: boolean;
		portType: "EQ" | "STK";
		sourceEquipmentGroupId: number;
		plan: PortEquipmentGroupEditPlan | null;
		slots: CompiledPortSlots;
		eligibleProcessLoopIds: readonly number[] | null;
	}>;
	readonly portEquipmentGroupEditSource: Pick<EquipmentGroupRecord, "portIds"> | null | undefined;
	readonly portEquipmentGroupEditState: "choose" | "valid" | "invalid";
}

export function PortEquipmentGroupTransformBar({
	onApply,
	busy,
	cancelButtonRef,
	exitPortEquipmentGroupEditToInspect,
	portEquipmentGroupEditSession,
	portEquipmentGroupEditSource,
	portEquipmentGroupEditState,
}: PortEquipmentGroupTransformBarProps): ReactNode {
	const plan = portEquipmentGroupEditSession.plan;
	const singlePort = portEquipmentGroupEditSession.scope === "port";
	const coordinates = singlePort
		? stkPortMoveCoordinates(
				portEquipmentGroupEditSession.sourcePorts?.find(
					(port) => port.id === portEquipmentGroupEditSession.sourceAnchorPortId,
				)?.route,
				portEquipmentGroupEditSession.slots,
				portEquipmentGroupEditSession.targetRow ?? null,
			)
		: null;
	const feedback =
		plan && !plan.valid
			? portEquipmentGroupEditFeedback(plan, portEquipmentGroupEditSession.slots)
			: null;
	return (
		<div
			ref={observePortDockClearance}
			className="tilefab-buildbar tilefab-equipment-transformbar tilefab-equipment-group-transformbar"
			data-testid="port-equipment-group-transformbar"
			data-port-type={portEquipmentGroupEditSession.portType}
			data-mode={portEquipmentGroupEditSession.mode}
			data-scope={singlePort ? "port" : "group"}
			data-state={portEquipmentGroupEditState}
			data-eligible-process-loop-ids={
				portEquipmentGroupEditSession.eligibleProcessLoopIds?.join(",") ?? ""
			}
		>
			<span className="tilefab-buildbar-title">
				{portEquipmentGroupEditSession.mode === "move" ? <Move size={15} /> : <Copy size={15} />}
				{portEquipmentGroupEditSession.portType}-
				{portEquipmentGroupEditSession.sourceEquipmentGroupId}
			</span>
			<strong>
				{singlePort ? (
					`Port만 이동 · PORT-${portEquipmentGroupEditSession.sourceAnchorPortId}`
				) : (
					<>
						{portEquipmentGroupEditSession.mode === "move" ? "이동" : "복제"} ·{" "}
						{portEquipmentGroupEditSource?.portIds.length ?? 0} Port
					</>
				)}
			</strong>
			<div className="tilefab-equipment-transform-state">
				{portEquipmentGroupEditState === "valid"
					? singlePort
						? "이동 가능 · 다른 Port 유지"
						: "배치 가능"
					: portEquipmentGroupEditState === "invalid"
						? (feedback?.reason ?? "배치할 수 없습니다")
						: singlePort
							? "몸체 길이 유지 · 같은 직선에서 위치 선택"
							: "대상 위치 선택"}
				{coordinates ? (
					<small
						className="tilefab-equipment-group-loop-preview"
						data-testid="stk-port-move-coordinates"
					>
						{coordinates}
					</small>
				) : null}
				{feedback ? (
					<small
						className="tilefab-equipment-group-loop-preview"
						data-testid="equipment-group-edit-failure"
					>
						{feedback.location ? (
							<>
								<span data-testid="equipment-group-edit-failure-location">{feedback.location}</span>
								<br />
							</>
						) : null}
						{feedback.recovery}
					</small>
				) : null}
			</div>
			<div className="tilefab-equipment-transform-actions">
				<button
					ref={cancelButtonRef}
					type="button"
					className="tilefab-placement-exit"
					aria-label={singlePort ? "Port 이동 취소" : "장비 이동·복제 취소"}
					aria-keyshortcuts="Escape"
					onClick={() => {
						exitPortEquipmentGroupEditToInspect(
							singlePort ? "Port 이동을 취소했습니다" : "장비 그룹 편집을 취소했습니다",
						);
					}}
				>
					<X size={14} /> 취소
				</button>
				<button
					type="button"
					className="tilefab-placement-apply"
					data-testid="apply-port-equipment-group"
					disabled={busy || portEquipmentGroupEditState !== "valid"}
					aria-keyshortcuts="Enter"
					onClick={onApply}
				>
					<Check size={14} />{" "}
					{portEquipmentGroupEditSession.mode === "move" ? "이동 적용" : "복제 배치"}
				</button>
			</div>
			{portEquipmentGroupEditSession.plan?.valid ? (
				<details className="tilefab-equipment-help">
					<summary>소속 정보</summary>
					<small
						className="tilefab-equipment-group-loop-preview"
						data-testid="equipment-group-loop-preview"
						data-state={
							portEquipmentGroupEditSession.eligibleProcessLoopIds?.length ? "eligible" : "none"
						}
					>
						{portEquipmentGroupEditSession.preservesLoopOwnership ? (
							<>
								현재 Loop 소속 유지
								<br />
								모든 Port가 같은 Loop 안에 있습니다
							</>
						) : portEquipmentGroupEditSession.eligibleProcessLoopIds?.length ? (
							<>
								{portEquipmentGroupEditSession.mode === "move" ? "이동" : "복제"} 후 Loop 소속 가능
								<br />
								소속이 없는 장비는 배치 후 Loop를 별도 지정
							</>
						) : (
							<>
								소속 미지정으로 배치
								<br />
								소속은 장비 속성에서 별도로 지정할 수 있습니다
							</>
						)}
					</small>
				</details>
			) : null}
		</div>
	);
}
