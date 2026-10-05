import { ArrowLeftRight, Check, Crosshair, MousePointer2, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import type { CompiledPortSlots } from "../compile/PortSlotCompiler";

export interface PortEquipmentMembershipEditBarProps {
	readonly clearTransientConstruction: (message?: string) => void;
	readonly completePortEquipmentMembershipEdit: () => void;
	readonly portEquipmentMembershipEditSession: Readonly<{
		portType: "EQ" | "STK";
		sourceEquipmentGroupId: number;
		slots: Pick<CompiledPortSlots, "routeXs" | "routeZs">;
		keyboardRow: number;
		selection: Readonly<{ rows: readonly number[] }>;
		activeEndpoint?: "upstream" | "downstream";
	}>;
	readonly portEquipmentMembershipSummary: Readonly<{
		sourceCount: number;
		draftCount: number;
		added: number;
		removed: number;
		dirty: boolean;
		canComplete: boolean;
		reason: string | null;
	}> | null;
	readonly showStkSelection: () => void;
	readonly switchEqMembershipEndpoint: () => void;
}

export function PortEquipmentMembershipEditBar({
	clearTransientConstruction,
	completePortEquipmentMembershipEdit,
	portEquipmentMembershipEditSession,
	portEquipmentMembershipSummary,
	showStkSelection,
	switchEqMembershipEndpoint,
}: PortEquipmentMembershipEditBarProps): ReactNode {
	return (
		<div
			className="tilefab-buildbar tilefab-equipment-transformbar tilefab-equipment-membershipbar"
			data-testid="port-equipment-membership-editbar"
			data-port-type={portEquipmentMembershipEditSession.portType}
			data-state={
				portEquipmentMembershipSummary?.canComplete
					? "valid"
					: portEquipmentMembershipSummary?.dirty
						? "incomplete"
						: "pristine"
			}
		>
			<span id="tilefab-port-membership-description" className="tilefab-sr-only" aria-live="polite">
				{portEquipmentMembershipEditSession.portType} 포트 구성 편집. 현재{" "}
				{portEquipmentMembershipSummary?.draftCount ?? 0}개. 커서 X{" "}
				{
					portEquipmentMembershipEditSession.slots.routeXs[
						portEquipmentMembershipEditSession.keyboardRow
					]
				}
				, Z{" "}
				{
					portEquipmentMembershipEditSession.slots.routeZs[
						portEquipmentMembershipEditSession.keyboardRow
					]
				}
				. 방향키로 이동하고{" "}
				{portEquipmentMembershipEditSession.portType === "STK"
					? "Space로 포트를 추가하거나 제거한 뒤 "
					: "Q 또는 E로 1번 시작 쪽과 2번 끝 쪽을 바꾼 뒤 "}
				Enter로 완료, Escape로 취소합니다.
			</span>
			<span className="tilefab-buildbar-title">
				<MousePointer2 size={15} />
				{portEquipmentMembershipEditSession.portType}-
				{portEquipmentMembershipEditSession.sourceEquipmentGroupId}
			</span>
			<strong>
				포트 구성 · 기존 {portEquipmentMembershipSummary?.sourceCount ?? 0} → 변경{" "}
				{portEquipmentMembershipSummary?.draftCount ?? 0}
			</strong>
			<span className="tilefab-equipment-transform-state">
				추가 {portEquipmentMembershipSummary?.added ?? 0} · 제거{" "}
				{portEquipmentMembershipSummary?.removed ?? 0} ·{" "}
				{portEquipmentMembershipSummary?.reason ?? "포트 슬롯을 선택하세요"}
			</span>
			<span className="tilefab-membership-cursor" data-testid="port-equipment-membership-cursor">
				<Crosshair size={13} />X{" "}
				{
					portEquipmentMembershipEditSession.slots.routeXs[
						portEquipmentMembershipEditSession.keyboardRow
					]
				}{" "}
				· Z{" "}
				{
					portEquipmentMembershipEditSession.slots.routeZs[
						portEquipmentMembershipEditSession.keyboardRow
					]
				}
			</span>
			{portEquipmentMembershipEditSession.portType === "EQ" ? (
				<button
					type="button"
					className="tilefab-placement-exit"
					data-testid="switch-eq-membership-endpoint"
					onClick={switchEqMembershipEndpoint}
					title="Q/E"
					aria-keyshortcuts="Q E"
					aria-label={`반대쪽 끝으로 전환 · 현재 ${
						portEquipmentMembershipEditSession.activeEndpoint === "upstream"
							? "1번 시작 쪽"
							: "2번 끝 쪽"
					}`}
				>
					<ArrowLeftRight size={14} />{" "}
					{portEquipmentMembershipEditSession.activeEndpoint === "upstream"
						? "1번 시작 쪽"
						: "2번 끝 쪽"}
				</button>
			) : null}
			{portEquipmentMembershipEditSession.portType === "STK" ? (
				<button
					type="button"
					className="tilefab-placement-exit"
					data-testid="stk-membership-fit-selection"
					disabled={!portEquipmentMembershipEditSession.selection.rows.length}
					onClick={showStkSelection}
				>
					<Search size={14} aria-hidden="true" /> 선택 범위 보기
				</button>
			) : null}
			<button
				type="button"
				className="tilefab-inspector-primary"
				data-testid="complete-port-equipment-membership"
				disabled={!portEquipmentMembershipSummary?.canComplete}
				onClick={completePortEquipmentMembershipEdit}
				aria-keyshortcuts="Enter"
			>
				<Check size={14} /> 완료
			</button>
			<button
				type="button"
				className="tilefab-placement-exit"
				data-testid="cancel-port-equipment-membership"
				aria-keyshortcuts="Escape"
				aria-label="포트 구성 편집 취소"
				onClick={() => clearTransientConstruction("포트 구성 편집을 취소했습니다")}
			>
				<X size={14} /> ESC
			</button>
		</div>
	);
}
