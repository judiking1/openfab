import type {
	SyntheticFabStarterId,
	SyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";

interface StarterCopy {
	readonly name: string;
	readonly category: string;
	readonly description: string;
}

/** Editor wording is independent of persisted preset IDs and certified geometry. */
const STARTER_COPY = {
	blank: {
		name: "빈 격자",
		category: "직접 만들기",
		description: "빈 1 m 격자에서 레일과 장비를 직접 만듭니다.",
	},
	"bay-assembly": {
		name: "생산 Bay",
		category: "기본 조립",
		description: "두 Process Loop를 하나의 외곽 순환 레일로 연결합니다.",
	},
	"bay-bank": {
		name: "Bay Bank",
		category: "반복 조립",
		description: "여러 생산 Bay를 공용 연결 레일에 묶습니다.",
	},
	"paired-circulation-fab-52": {
		name: "이중 순환 FAB",
		category: "기본 FAB",
		description: "반대 방향의 두 외곽 레일과 공정 홀 2개·Bank 4개를 연결합니다.",
	},
	"full-fab-52": {
		name: "단일 외곽 순환 FAB",
		category: "비교용 FAB",
		description: "하나의 외곽 순환 레일에 공정 홀 2개·Bank 4개를 연결한 비교용 구성입니다.",
	},
	"parallel-hall-fab-12": {
		name: "평행 공정 홀",
		category: "공정 홀",
		description: "긴 Bay를 남·북 연결 레일에 배치합니다. 더 큰 FAB에 반복 배치할 수 있습니다.",
	},
	"central-spine-fab-24": {
		name: "중앙 통로 FAB",
		category: "밀집 공정 홀",
		description: "중앙 연결 레일 양쪽에 Bay와 Process Loop를 밀집 배치합니다.",
	},
	"production-fab-60": {
		name: "대규모 검증 FAB",
		category: "성능 검증용",
		description: "Bay 수와 Bank 수를 조절해 큰 FAB의 편집과 배치를 검증합니다.",
	},
	"single-loop": {
		name: "단일 Process Loop",
		category: "레일 예제",
		description: "하나의 닫힌 단방향 순환 레일로 시작합니다.",
	},
	"dual-loop": {
		name: "연결된 두 Process Loop",
		category: "레일 예제",
		description: "공통 본선을 공유하는 두 순환 레일입니다.",
	},
	"nested-bay": {
		name: "중첩 Process Loop",
		category: "레일 예제",
		description: "큰 순환 레일 안에 내부 순환 레일을 연결합니다.",
	},
	"shift-bay": {
		name: "엇갈린 Process Loop",
		category: "레일 예제",
		description: "평행 이동 구간을 포함한 닫힌 순환 레일입니다.",
	},
	"duplicate-bays": {
		name: "분리된 두 Process Loop",
		category: "연결 연습",
		description: "서로 떨어진 두 순환 레일로 시작해 연결을 연습합니다.",
	},
	"interbay-row": {
		name: "Process Loop 열",
		category: "반복 레일",
		description: "여러 Process Loop를 공통 연결 레일에 나란히 배치합니다.",
	},
	"fab-block": {
		name: "반복 루프 검증",
		category: "호환성 예제",
		description: "반복 루프와 공용 순환 레일의 기존 구성을 검증합니다.",
	},
	"complete-fab": {
		name: "3개 구역 연결",
		category: "중형 예제",
		description: "반복 루프가 있는 세 구역을 연결한 예제입니다.",
	},
	"large-fab-60": {
		name: "기존 대규모 FAB",
		category: "호환성 프리셋",
		description: "여러 공정 블록을 연결한 기존 대규모 구성을 확인합니다.",
	},
} satisfies Record<SyntheticFabStarterId, StarterCopy>;

export function syntheticFabStarterPresentation(
	request: SyntheticFabStarterRequest,
): StarterCopy & {
	readonly bayCount: number | null;
	readonly label: string;
} {
	const id = request.id;
	const bayCount =
		id === "bay-assembly"
			? 1
			: id === "bay-bank" ||
					id === "paired-circulation-fab-52" ||
					id === "full-fab-52" ||
					id === "parallel-hall-fab-12" ||
					id === "central-spine-fab-24" ||
					id === "production-fab-60" ||
					id === "large-fab-60"
				? request.parameters.bayCount
				: null;
	const copy = STARTER_COPY[id];
	return {
		...copy,
		bayCount,
		label: `${copy.name}${bayCount === null ? "" : ` · ${bayCount} Bay`}`,
	};
}

const PARAMETER_LABELS: Readonly<Record<string, string>> = {
	"BAY LENGTH": "Bay 길이",
	"RAIL SPACING": "레일 간격",
	"BAY DEPTH": "Bay 깊이",
	"BAY FRONTAGE": "Bay 전면 폭",
	"BAY COUNT": "Bay 수",
	"TOTAL BAYS": "전체 Bay 수",
	"BAY PITCH": "Bay 배치 간격",
	"BAY BANKS": "Bank 수",
	"OUTER LOOP DEPTH": "외곽 순환 레일 깊이",
	"LOOP COUNT": "순환 레일 수",
	"ZONE DEPTH": "구역 깊이",
	"PROCESS BLOCKS": "공정 블록 수",
};

export function syntheticFabStarterParameterLabel(label: string): string {
	return PARAMETER_LABELS[label] ?? label;
}
