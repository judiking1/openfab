import type { StkDraftSelection } from "../compile/StkDraftSelector";
import type { StkAuthoringTemplate } from "../core/EquipmentGroup";

export interface StkDraftStatusPresentation {
	readonly label: string;
	readonly reason: string;
	readonly state: "draft" | "blocked" | "ready";
}

export interface StkTemplatePresentation {
	readonly label: string;
	readonly requirement: string;
}

export interface StkOverviewCoachPresentation {
	readonly instruction: string;
	readonly zoomActionLabel: string;
}

export function stkTemplatePresentation(template: StkAuthoringTemplate): StkTemplatePresentation {
	if (template === "FLEX") {
		return Object.freeze({ label: "FLEX", requirement: "원하는 CENTER Port 1개 이상" });
	}
	if (template === "FOUR_PORT") {
		return Object.freeze({ label: "4 PORT", requirement: "같은 직선 레일의 연속 4개" });
	}
	if (template === "SIX_PORT") {
		return Object.freeze({ label: "6 PORT", requirement: "같은 직선 레일의 연속 6개" });
	}
	return Object.freeze({
		label: "B2B",
		requirement: "반대 방향 평행 레일의 정렬된 짝 · 짝수 4개 이상",
	});
}

export function stkDraftAuthoringInstruction(
	template: StkAuthoringTemplate,
	selection: StkDraftSelection | null,
	legalSlotCount: number,
): string {
	if (!Number.isSafeInteger(legalSlotCount) || legalSlotCount < 0) {
		throw new RangeError("STK authoring legal slot count must be a non-negative safe integer.");
	}
	if (legalSlotCount === 0) {
		return "배치 가능 슬롯 없음 · STK가 연결될 직선 레일을 먼저 만드세요";
	}
	const templateCopy = stkTemplatePresentation(template);
	if (!selection || selection.rows.length === 0) {
		return `${templateCopy.label} · ${templateCopy.requirement} · 포인터: 금색 ◇ CENTER 클릭으로 첫 Port 선택 · 키보드: 방향키/WASD 이동 → Enter · Esc STK 배치 종료`;
	}
	const draft = stkDraftStatusPresentation(selection);
	return `${draft.label} · ${templateCopy.label} 조건: ${templateCopy.requirement} · 포인터: 금색 ◇ CENTER 클릭으로 추가·제거 · 키보드: 방향키/WASD 이동 → Enter · 준비되면 STK 생성 · Esc 선택 초기화 · 다시 Esc STK 배치 종료`;
}

export function stkDraftKeyboardTargetLabel(
	selection: StkDraftSelection | null,
	currentRowSelected: boolean,
	currentRowLegal = true,
): string {
	if (currentRowSelected) return "선택됨 · ENTER 해제";
	if (!currentRowLegal) return "추가 불가 · 이동";
	return (selection?.rows.length ?? 0) === 0 ? "첫 Port 위치" : "Port 추가 · ENTER";
}

export function stkOverviewCoachPresentation(
	selectedPortCount: number,
	template: StkAuthoringTemplate,
): StkOverviewCoachPresentation {
	if (!Number.isSafeInteger(selectedPortCount) || selectedPortCount < 0) {
		throw new RangeError("STK overview selected Port count must be a non-negative safe integer.");
	}
	const templateRequirement = stkOverviewTemplateRequirement(template);
	return selectedPortCount === 0
		? Object.freeze({
				instruction: `${templateRequirement} · 포인터: 금색 원 클릭 · 키보드: 현재 대상에서 Enter · 또는 위치 확대`,
				zoomActionLabel: "첫 Port 확대",
			})
		: Object.freeze({
				instruction: `${templateRequirement} · 포인터: 금색 원 클릭으로 추가·제거 · 키보드: Enter · 준비되면 STK 생성`,
				zoomActionLabel: "현재 Port 확대",
			});
}

function stkOverviewTemplateRequirement(template: StkAuthoringTemplate): string {
	if (template === "FLEX") return "FLEX · 1개 이상";
	if (template === "FOUR_PORT") return "4 PORT · 연속 4개";
	if (template === "SIX_PORT") return "6 PORT · 연속 6개";
	return "B2B · 정렬된 짝수 4개 이상";
}

export function stkDraftStatusPresentation(
	selection: StkDraftSelection | null,
): StkDraftStatusPresentation {
	if (!selection) {
		return Object.freeze({
			label: "0 PORT · 포트를 선택하세요",
			reason: "레일 위의 배치 가능한 포트를 클릭하세요",
			state: "draft",
		});
	}
	const reason = stkDraftReasonLabel(selection.reason);
	if (selection.rejectedRow !== null && selection.canComplete) {
		return Object.freeze({
			label: `${selection.rows.length} PORT 선택 · Shift+Enter / STK 생성 · 추가 실패: ${reason}`,
			reason: `선택한 위치는 추가하지 않았습니다. 기존 ${selection.rows.length}개 포트 드래프트로 STK를 생성할 수 있습니다. ${reason}`,
			state: "blocked",
		});
	}
	if (!selection.valid || selection.rejectedRow !== null) {
		return Object.freeze({
			label: `다음 PORT 선택 불가 · ${reason}`,
			reason,
			state: "blocked",
		});
	}
	if (selection.canComplete) {
		const railRuns = `${selection.laneCount} RAIL ${selection.laneCount === 1 ? "RUN" : "RUNS"}`;
		return Object.freeze({
			label: `${selection.rows.length} PORT 선택 · ${railRuns} · Shift+Enter / STK 생성`,
			reason,
			state: "ready",
		});
	}
	return Object.freeze({
		label: `${selection.rows.length} PORT 선택 · ${reason}`,
		reason,
		state: "draft",
	});
}

export function stkDraftReasonLabel(reason: string): string {
	const equipmentReason = portEquipmentReasonLabel(reason);
	if (equipmentReason !== reason) return equipmentReason;
	const translations: readonly (readonly [string, string])[] = [
		["must occupy consecutive 1 m rail cells", "프리셋 포트는 1 m 간격으로 연속되어야 합니다"],
		[
			"must have aligned, paired port stations",
			"B2B 포트는 양쪽 레일의 같은 위치에 짝지어야 합니다",
		],
		["requires exactly four ports", "4 PORT 템플릿은 포트 4개가 필요합니다"],
		["requires exactly six ports", "6 PORT 템플릿은 포트 6개가 필요합니다"],
		[
			"requires an even port count of at least four",
			"B2B는 양쪽을 합쳐 짝수 포트 4개 이상이 필요합니다",
		],
		[
			"must use one common cardinal rail axis",
			"STK 포트는 하나의 공통 직선 레일 축에 있어야 합니다",
		],
		[
			"must preserve one directed travel orientation",
			"한 레일 행의 포트는 같은 진행 방향이어야 합니다",
		],
	];
	for (const [fragment, translation] of translations) {
		if (reason.includes(fragment)) return translation;
	}
	return reason;
}

export function portEquipmentReasonLabel(reason: string): string {
	const portConflict = reason.match(/conflicts with PORT-(\d+)/);
	if (portConflict) return `PORT-${portConflict[1]}이 대상 슬롯을 이미 사용하고 있습니다`;
	const groupConflict = reason.match(/conflicts with equipment group (\d+)/);
	if (groupConflict) return `장비 그룹 ${groupConflict[1]}의 안전 영역과 겹칩니다`;
	const stkBodyConflict = reason.match(/STK body span overlaps equipment group (\d+)/);
	if (stkBodyConflict) return `STK 본체 영역이 장비 그룹 ${stkBodyConflict[1]}와 겹칩니다`;
	const translations: readonly (readonly [string, string])[] = [
		["Port slot data is stale", "포트 슬롯 정보가 변경되었습니다 · 다시 시작하세요"],
		["Port slot catalogs use different equipment types", "선택한 장비와 포트 슬롯 종류가 다릅니다"],
		["is outside the compiled slot buffer", "대상 포트 슬롯을 찾을 수 없습니다"],
		["is not a legal modular slot", "이 위치는 규격 포트 슬롯이 아닙니다"],
		[
			"has no matching rail slot after transformation",
			"그룹 전체 형상에 맞는 레일 슬롯이 없습니다",
		],
		["maps to an unsafe rail slot", "그룹의 일부 포트가 안전 영역을 벗어납니다"],
		["conflicts with the static clearance envelope", "정적 안전 영역과 겹칩니다"],
		["Multiple group ports map to the same rail slot", "여러 그룹 포트가 한 슬롯에 겹칩니다"],
		["Choose a different legal target", "원래 위치가 아닌 다른 합법 슬롯을 선택하세요"],
		["cannot use modular group editing", "이 레거시 장비는 모듈형 그룹 편집을 지원하지 않습니다"],
		["no longer exists", "선택한 장비 그룹이 더 이상 존재하지 않습니다"],
	];
	for (const [fragment, translation] of translations) {
		if (reason.includes(fragment)) return translation;
	}
	return reason;
}
