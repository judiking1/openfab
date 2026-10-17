import type { RailConstructionCatalogId } from "../core/RailConstructionCatalog";

/** Display-only projection of an existing authoring session or selection. */
export interface AuthoringTaskPresentation {
	readonly id: string;
	readonly kind: "rail" | "structure" | "blueprint" | "equipment" | "selection";
	readonly title: string;
	readonly instruction?: string;
	readonly status?: {
		readonly tone: "neutral" | "ready" | "blocked";
		readonly message: string;
	};
}

/** Names and input hints for the existing rail commands; no command admission changes. */
export const RAIL_AUTHORING_PRESENTATION: Readonly<
	Record<
		RailConstructionCatalogId,
		{
			readonly label: string;
			readonly description: string;
			readonly instruction: string;
		}
	>
> = {
	route: {
		label: "레일 그리기",
		description: "두 점을 잇는 직선과 코너",
		instruction: "시작점에서 끝점까지 드래그하세요 · 키보드는 아래 버튼으로 시작합니다",
	},
	"network-link": {
		label: "루프 연결",
		description: "두 순환로 사이에 왕복 경로 만들기",
		instruction: "서로 다른 두 루프의 직선 구간을 차례로 선택하세요",
	},
	"u-turn": {
		label: "U턴",
		description: "반대 방향으로 돌아오는 레일",
		instruction: "열린 레일 끝점에서 방향과 폭을 확인해 배치하세요",
	},
	shift: {
		label: "옆으로 이동",
		description: "진행 방향을 유지하며 옆 레인으로 이동",
		instruction: "열린 레일 끝점에서 이동할 쪽과 폭을 확인해 배치하세요",
	},
	"advanced-switch": {
		label: "2입력·2출력 분기",
		description: "두 진입로와 두 출구를 잇는 스위치",
		instruction: "열린 레일 끝점에서 방향과 규격을 확인해 배치하세요",
	},
};
