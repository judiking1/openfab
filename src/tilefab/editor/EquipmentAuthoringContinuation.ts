import type { EquipmentGroupRecord, StkAuthoringTemplate } from "../core/EquipmentGroup";

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
		buttonLabel: group.template === "CUSTOM" ? "FLEX로 새 STK 배치" : "같은 템플릿으로 새 STK 배치",
		template: group.template === "CUSTOM" ? "FLEX" : group.template,
		customTemplateFallback: group.template === "CUSTOM",
	});
}

export function equipmentAuthoringContinuationExplanation(
	continuation: EquipmentAuthoringContinuation,
): string {
	return continuation.tool === "ohb"
		? "원본은 유지하고 새 합법 슬롯을 선택합니다. 정확한 복제는 아래 편집 메뉴에 있습니다."
		: "원본은 유지하고 Port를 다시 선택합니다. 정확한 복제는 아래 편집 메뉴에 있습니다.";
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
			? "새 STK 배치 · CUSTOM은 직접 재현할 수 없어 FLEX로 시작합니다"
			: `새 STK 배치 · ${continuation.template}`;
	}
	return "새 OHB 배치 · 원하는 합법 슬롯을 선택하세요";
}
