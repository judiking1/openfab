import { ArrowLeftRight, Check, Crosshair, MousePointer2, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import type { CompiledPortSlots } from "../compile/PortSlotCompiler";
import { EQ_PORT_PITCHES_MILLIMETERS } from "../core/EquipmentGroup";

import { observePortDockClearance } from "./observePortDockClearance";

export interface PortEquipmentMembershipEditBarProps {
	readonly clearTransientConstruction: (message?: string) => void;
	readonly completePortEquipmentMembershipEdit: () => void;
	readonly setEqMembershipEditMode: (mode: "membership" | "pitch") => void;
	readonly chooseEqMembershipPitch: (pitchMillimeters: number) => void;
	readonly portEquipmentMembershipEditSession: Readonly<{
		portType: "EQ" | "STK";
		sourceEquipmentGroupId: number;
		sourceAnchorPortId: number;
		editMode?: "membership" | "pitch";
		pitchMillimeters?: number;
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
	setEqMembershipEditMode,
	chooseEqMembershipPitch,
	portEquipmentMembershipEditSession,
	portEquipmentMembershipSummary,
	showStkSelection,
	switchEqMembershipEndpoint,
}: PortEquipmentMembershipEditBarProps): ReactNode {
	const pitchMode = portEquipmentMembershipEditSession.editMode === "pitch";
	return (
		<div
			ref={observePortDockClearance}
			className="tilefab-buildbar tilefab-equipment-transformbar tilefab-equipment-membershipbar"
			data-testid="port-equipment-membership-editbar"
			data-port-type={portEquipmentMembershipEditSession.portType}
			data-edit-mode={pitchMode ? "pitch" : "membership"}
			data-state={
				portEquipmentMembershipSummary?.canComplete
					? "valid"
					: portEquipmentMembershipSummary?.dirty
						? "incomplete"
						: "pristine"
			}
		>
			<span id="tilefab-port-membership-description" className="tilefab-sr-only" aria-live="polite">
				{portEquipmentMembershipEditSession.portType} {pitchMode ? "Port 간격" : "포트 구성"} 편집.
				현재 {portEquipmentMembershipSummary?.draftCount ?? 0}개. 커서 X{" "}
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
				.{" "}
				{pitchMode
					? `PORT-${portEquipmentMembershipEditSession.sourceAnchorPortId} 고정. 간격을 선택한 뒤 `
					: "방향키로 이동하고 "}{" "}
				{pitchMode
					? ""
					: portEquipmentMembershipEditSession.portType === "STK"
						? "Space로 포트를 추가하거나 제거한 뒤 "
						: "Q 또는 E로 1번 시작 쪽과 2번 끝 쪽을 바꾼 뒤 "}
				Enter로 완료, Escape로 취소합니다.
			</span>
			<span className="tilefab-buildbar-title">
				{pitchMode ? <ArrowLeftRight size={15} /> : <MousePointer2 size={15} />}
				{portEquipmentMembershipEditSession.portType}-
				{portEquipmentMembershipEditSession.sourceEquipmentGroupId}
			</span>
			<strong>
				{pitchMode
					? `간격 · ${portEquipmentMembershipSummary?.sourceCount ?? 0} Port 유지`
					: `포트 구성 · 기존 ${portEquipmentMembershipSummary?.sourceCount ?? 0} → 변경 ${portEquipmentMembershipSummary?.draftCount ?? 0}`}
			</strong>
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
				<div className="tilefab-eq-membership-options">
					<fieldset aria-label="EQ Port 편집 방식" className="tilefab-eq-edit-mode">
						{(["membership", "pitch"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								className="tilefab-placement-exit"
								aria-pressed={portEquipmentMembershipEditSession.editMode === mode}
								disabled={
									portEquipmentMembershipSummary?.dirty &&
									portEquipmentMembershipEditSession.editMode !== mode
								}
								onClick={() => setEqMembershipEditMode(mode)}
							>
								{mode === "pitch" ? "간격" : "Port 수"}
							</button>
						))}
					</fieldset>
					{pitchMode ? (
						<>
							<span>PORT-{portEquipmentMembershipEditSession.sourceAnchorPortId} 고정</span>
							<fieldset aria-label="EQ Port 간격" className="tilefab-eq-pitch-options">
								{EQ_PORT_PITCHES_MILLIMETERS.map((pitch) => (
									<button
										key={pitch}
										type="button"
										className="tilefab-placement-exit"
										aria-pressed={pitch === portEquipmentMembershipEditSession.pitchMillimeters}
										onClick={() => chooseEqMembershipPitch(pitch)}
									>
										{pitch / 1_000} m
									</button>
								))}
							</fieldset>
						</>
					) : null}
					{portEquipmentMembershipSummary?.dirty ? (
						<small>다른 편집은 적용·취소 후 가능</small>
					) : null}
				</div>
			) : null}
			{portEquipmentMembershipEditSession.portType === "EQ" && !pitchMode ? (
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
			{!pitchMode ? (
				<details className="tilefab-equipment-help">
					<summary>조작 방법</summary>
					<p>
						{pitchMode
							? "기준 Port와 개수는 유지됩니다 · 간격을 선택하고 미리보기를 확인하세요"
							: portEquipmentMembershipEditSession.portType === "EQ"
								? "방향키로 끝점 이동 · Q/E로 반대 끝점 선택"
								: "방향키로 커서 이동 · Space로 Port 추가·제거"}
						<br />
						Enter 완료 · Esc 취소
					</p>
				</details>
			) : null}
			<div className="tilefab-equipment-transform-actions">
				<span
					id="tilefab-port-membership-apply-reason"
					className="tilefab-equipment-transform-state"
					aria-live="polite"
				>
					{pitchMode
						? ""
						: `추가 ${portEquipmentMembershipSummary?.added ?? 0} · 제거 ${portEquipmentMembershipSummary?.removed ?? 0} · `}
					{portEquipmentMembershipSummary?.reason ?? "포트 슬롯을 선택하세요"}
				</span>
				<button
					type="button"
					className="tilefab-inspector-primary"
					data-testid="complete-port-equipment-membership"
					aria-describedby="tilefab-port-membership-apply-reason"
					disabled={!portEquipmentMembershipSummary?.canComplete}
					onClick={completePortEquipmentMembershipEdit}
					aria-keyshortcuts="Enter"
				>
					<Check size={14} /> {pitchMode ? "적용" : "완료"}
				</button>
				<button
					type="button"
					className="tilefab-placement-exit"
					data-testid="cancel-port-equipment-membership"
					aria-keyshortcuts="Escape"
					aria-label={pitchMode ? "간격 편집 취소" : "포트 구성 편집 취소"}
					onClick={() =>
						clearTransientConstruction(
							pitchMode ? "간격 편집을 취소했습니다" : "포트 구성 편집을 취소했습니다",
						)
					}
				>
					<X size={14} /> 취소
				</button>
			</div>
		</div>
	);
}
