import type { RailDocument } from "../core/RailDocument";

/** Session-only intent; rail edits retain the document identity, project replacement does not. */
export interface EquipmentRailPreparation {
	readonly document: RailDocument;
	readonly tool: "ohb" | "eq" | "stk";
}

export function equipmentRailPreparationHandoff(
	preparation: EquipmentRailPreparation | null,
	document: RailDocument,
	placementReady: boolean,
	eqPitchMillimeters: number,
) {
	if (!preparation || preparation.document !== document) return null;
	const name = preparation.tool === "stk" ? "Stocker" : preparation.tool.toUpperCase();
	const label = placementReady ? `${name} 배치로 돌아가기` : `${name}용 레일 만들기`;
	const instruction = placementReady
		? "레일 준비됨 · 배치 위치를 고르세요"
		: preparation.tool === "eq"
			? `PITCH ${eqPitchMillimeters / 1_000} m 간격의 빈 슬롯 2곳 · 직선을 늘리세요`
			: preparation.tool === "ohb"
				? "양끝 안전 구간 안쪽에 빈 직선 슬롯이 필요합니다"
				: "Stocker용 빈 직선 슬롯이 필요합니다";
	return {
		tool: preparation.tool,
		label,
		instruction,
		ariaLabel: `${label} · ${instruction}`,
		description: `${name} 배치를 위한 레일 준비입니다. ${instruction}`,
		railReady: placementReady,
	};
}
