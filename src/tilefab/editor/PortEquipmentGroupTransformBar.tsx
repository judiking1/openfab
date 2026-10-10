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
	readonly moveDistance: string;
	readonly moveDistanceError: string | null;
	readonly onMoveDistanceChange: (text: string) => void;
}

export function PortEquipmentGroupTransformBar({
	onApply,
	busy,
	cancelButtonRef,
	exitPortEquipmentGroupEditToInspect,
	portEquipmentGroupEditSession,
	portEquipmentGroupEditSource,
	portEquipmentGroupEditState,
	moveDistance,
	moveDistanceError,
	onMoveDistanceChange,
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
			data-state={moveDistanceError ? "invalid" : portEquipmentGroupEditState}
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
			{singlePort ? (
				<label className="tilefab-stk-port-distance">
					<span>원래 위치에서 이동 (m)</span>
					<input
						type="text"
						inputMode="text"
						value={moveDistance}
						disabled={busy}
						data-testid="stk-port-move-distance"
						aria-label="Port 이동 거리 미터"
						aria-invalid={Boolean(moveDistanceError)}
						aria-describedby="stk-port-distance-help"
						onChange={(event) => onMoveDistanceChange(event.target.value)}
					/>
					<small id="stk-port-distance-help">진행 방향 + · 반대 방향 − · 정수 입력</small>
				</label>
			) : null}
			<div className="tilefab-equipment-transform-state">
				{moveDistanceError ??
					(portEquipmentGroupEditState === "valid"
						? singlePort
							? "이동 가능 · 다른 Port 유지"
							: "배치 가능"
						: portEquipmentGroupEditState === "invalid"
							? (feedback?.reason ?? "배치할 수 없습니다")
							: singlePort
								? "몸체 길이 유지 · 같은 직선에서 위치 선택"
								: "대상 위치 선택")}
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
					disabled={busy || Boolean(moveDistanceError) || portEquipmentGroupEditState !== "valid"}
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
								<br />이 위치에서 소속 가능한 Loop 없음 · 미소속 유지 가능
							</>
						)}
					</small>
				</details>
			) : null}
		</div>
	);
}
