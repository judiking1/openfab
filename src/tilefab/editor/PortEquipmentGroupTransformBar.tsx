import { Copy, Move, X } from "lucide-react";
import type { ReactNode } from "react";
import type {
	PortEquipmentGroupEditMode,
	PortEquipmentGroupEditPlan,
} from "../compile/PortEquipmentGroupEditPlanner";
import type { EquipmentGroupRecord } from "../core/EquipmentGroup";
import { portEquipmentReasonLabel } from "./StkDraftPresentation";

export interface PortEquipmentGroupTransformBarProps {
	readonly exitPortEquipmentGroupEditToInspect: (message: string) => void;
	readonly portEquipmentGroupEditSession: Readonly<{
		mode: PortEquipmentGroupEditMode;
		portType: "EQ" | "STK";
		sourceEquipmentGroupId: number;
		plan: Pick<PortEquipmentGroupEditPlan, "valid" | "reason"> | null;
		eligibleProcessLoopIds: readonly number[] | null;
	}>;
	readonly portEquipmentGroupEditSource: Pick<EquipmentGroupRecord, "portIds"> | null | undefined;
	readonly portEquipmentGroupEditState: "choose" | "valid" | "invalid";
}

export function PortEquipmentGroupTransformBar({
	exitPortEquipmentGroupEditToInspect,
	portEquipmentGroupEditSession,
	portEquipmentGroupEditSource,
	portEquipmentGroupEditState,
}: PortEquipmentGroupTransformBarProps): ReactNode {
	return (
		<div
			className="tilefab-buildbar tilefab-equipment-transformbar tilefab-equipment-group-transformbar"
			data-testid="port-equipment-group-transformbar"
			data-port-type={portEquipmentGroupEditSession.portType}
			data-mode={portEquipmentGroupEditSession.mode}
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
				{portEquipmentGroupEditSession.mode === "move" ? "MOVE" : "COPY"} ·{" "}
				{portEquipmentGroupEditSource?.portIds.length ?? 0} PORTS
			</strong>
			<span className="tilefab-equipment-transform-state">
				{portEquipmentGroupEditState === "valid"
					? "ENTER / LMB 배치 · 방향키 / WASD"
					: portEquipmentGroupEditState === "invalid"
						? portEquipmentReasonLabel(
								portEquipmentGroupEditSession.plan?.reason ?? "배치할 수 없습니다",
							)
						: "방향키 / WASD로 기준 슬롯 선택"}
				{portEquipmentGroupEditSession.plan?.valid ? (
					<small
						className="tilefab-equipment-group-loop-preview"
						data-testid="equipment-group-loop-preview"
						data-state={
							portEquipmentGroupEditSession.eligibleProcessLoopIds?.length ? "eligible" : "none"
						}
					>
						{portEquipmentGroupEditSession.eligibleProcessLoopIds?.length ? (
							<>
								{portEquipmentGroupEditSession.mode === "move" ? "이동" : "복제"} 후 Loop 소속 가능
								<br />
								소속은 배치 후 별도 지정
							</>
						) : (
							<>
								모든 Port를 포함하는 Loop 없음
								<br />
								다른 위치 또는 Port 구성 확인
							</>
						)}
					</small>
				) : null}
			</span>
			<button
				type="button"
				className="tilefab-placement-exit"
				onClick={() => {
					exitPortEquipmentGroupEditToInspect("장비 그룹 편집을 취소했습니다");
				}}
			>
				<X size={14} /> ESC
			</button>
		</div>
	);
}
