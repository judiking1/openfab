import type { EquipmentGroupRecord, StkAuthoringTemplate } from "../core/EquipmentGroup";
import { stkTemplatePresentation } from "./StkDraftPresentation";

export type EquipmentAuthoringTool = "ohb" | "eq" | "stk";

export type EquipmentAuthoringContinuation =
	| Readonly<{
			tool: "ohb";
			groupLabel: string;
			buttonLabel: string;
	  }>
	| Readonly<{
			tool: "eq";
			groupLabel: string;
			buttonLabel: string;
			pitchMillimeters: number;
			recipe: string;
	  }>
	| Readonly<{
			tool: "stk";
			groupLabel: string;
			buttonLabel: string;
			template: StkAuthoringTemplate;
			customTemplateFallback: boolean;
	  }>;

export function equipmentAuthoringContinuation(
	group: EquipmentGroupRecord,
): EquipmentAuthoringContinuation {
	const groupLabel = `${group.kind}-${group.id}`;
	if (group.kind === "OHB") {
		return Object.freeze({
			tool: "ohb",
			groupLabel,
			buttonLabel: "새 OHB Port 배치",
		});
	}
	if (group.kind === "EQ") {
		return Object.freeze({
			tool: "eq",
			groupLabel,
			buttonLabel: "같은 설정으로 새 EQ 배치",
			pitchMillimeters: group.pitchMillimeters,
			recipe: group.recipe ?? "",
		});
	}
	return Object.freeze({
		tool: "stk",
		groupLabel,
		buttonLabel:
			group.template === "CUSTOM"
				? "자유 선택으로 새 Stocker 배치"
				: "같은 구성으로 새 Stocker 배치",
		template: group.template === "CUSTOM" ? "FLEX" : group.template,
		customTemplateFallback: group.template === "CUSTOM",
	});
}

export function equipmentAuthoringContinuationExplanation(
	continuation: EquipmentAuthoringContinuation,
): string {
	return continuation.tool === "stk" && continuation.customTemplateFallback
		? "새 Stocker는 자유 선택(FLEX)으로 시작합니다."
		: "같은 설정으로 새 Port를 선택해 배치합니다.";
}

export function equipmentAuthoringContinuationStatus(
	continuation: EquipmentAuthoringContinuation,
): string {
	if (continuation.tool === "eq") {
		const recipe = continuation.recipe ? ` · RECIPE ${continuation.recipe}` : "";
		return `새 EQ 배치 · PITCH ${continuation.pitchMillimeters / 1_000} m${recipe}`;
	}
	if (continuation.tool === "stk") {
		return continuation.customTemplateFallback
			? "새 Stocker 배치 · 이전 CUSTOM 구성 대신 자유 선택으로 시작합니다"
			: `새 Stocker 배치 · ${stkTemplatePresentation(continuation.template).label}`;
	}
	return "새 OHB 배치 · 원하는 합법 슬롯을 선택하세요";
}
