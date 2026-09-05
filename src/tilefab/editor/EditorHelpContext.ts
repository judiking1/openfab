import type { EditorActivity } from "./EditorActivity";
import type { GuidedRailKeyboardPhase } from "./GuidedRailKeyboardSession";

export interface EditorHelpContextStep {
	readonly label: string;
	readonly description: string;
}

export interface EditorHelpContext {
	readonly eyebrow: string;
	readonly title: string;
	readonly summary: string;
	readonly steps: readonly EditorHelpContextStep[];
	readonly returnLabel: string;
}

export interface EditorHelpContextInput {
	readonly activity: EditorActivity;
	readonly organizationOpen: boolean;
	readonly organizationSelectionCount: number;
	readonly ordinaryRailKeyboardPhase?: GuidedRailKeyboardPhase | null;
}

const ORDINARY_RAIL_KEYBOARD_HELP_CONTEXTS = Object.freeze({
	"choose-start": helpContext(
		"BUILD · KEYBOARD RAIL · START",
		"키보드로 Rail 시작점 고르기",
		"지금은 시작점 단계입니다. 방향키는 1 m, Shift+방향키는 5 m 이동하고 Enter는 시작점을 선택합니다. Esc로 키보드 건설을 끝내도 이미 확정한 Rail은 유지됩니다.",
		[
			["1 · 시작점 이동", "방향키로 1 m, Shift+방향키로 5 m씩 빈 곳 어디로든 옮깁니다."],
			["2 · 시작점 선택", "Enter를 누르면 그 위치를 시작점으로 선택하고 끝점 단계로 넘어갑니다."],
			[
				"3 · 화면·종료",
				"WASD는 화면을 이동합니다. Esc는 미확정 위치만 취소하고 확정한 Rail은 유지합니다.",
			],
		],
		"키보드 Rail로 돌아가기",
	),
	"choose-end": helpContext(
		"BUILD · KEYBOARD RAIL · END",
		"키보드로 Rail 끝점 정하고 건설하기",
		"지금은 끝점 단계입니다. 방향키는 1 m, Shift+방향키는 5 m 이동하고 Enter는 미리 본 Rail 구간을 건설합니다. Esc로 키보드 건설을 끝내도 이미 확정한 Rail은 유지됩니다.",
		[
			["1 · 끝점 이동", "방향키로 1 m, Shift+방향키로 5 m씩 끝점을 옮겨 Rail을 미리 봅니다."],
			[
				"2 · 구간 건설",
				"미리보기가 유효할 때 Enter를 누르면 이 Rail 구간만 원자적으로 건설합니다.",
			],
			[
				"3 · 화면·종료",
				"WASD는 화면을 이동합니다. Esc는 미확정 구간만 취소하고 확정한 Rail은 유지합니다.",
			],
		],
		"키보드 Rail로 돌아가기",
	),
} satisfies Readonly<Record<GuidedRailKeyboardPhase, EditorHelpContext>>);

const ACTIVITY_HELP_CONTEXTS = Object.freeze({
	build: helpContext(
		"BUILD · RAIL",
		"단방향 레일을 만들고 고치기",
		"캔버스의 빈 곳 어디서든 시작할 수 있습니다. 떨어진 Rail도 먼저 만든 뒤 필요할 때 연결하고 재사용하세요.",
		[
			[
				"1 · 그리기",
				"Smart Route로 빈 곳을 드래그합니다. 다음 Rail도 다른 빈 곳에서 독립적으로 시작할 수 있습니다.",
			],
			["2 · 방향", "Q/E로 방향과 코너를 바꾸고 화살표로 단방향 흐름을 확인합니다."],
			["3 · 재사용", "Inspect에서 드래그로 필요한 레일만 선택한 뒤 복제하거나 저장합니다."],
		],
	),
	assemble: helpContext(
		"ASSEMBLE · FAB STRUCTURE",
		"Bay를 반복하고 Bank와 Fab으로 연결하기",
		"검증된 Bay를 배치한 뒤 같은 계층의 조직을 선택해 더 큰 FAB 구조로 조립하세요.",
		[
			["1 · Bay", "Production Bay 또는 저장한 청사진을 캔버스에 배치합니다."],
			["2 · 반복", "Bay 하나를 복제하고 두 Bay를 선택해 정렬합니다."],
			["3 · 연결", "두 Bay는 Bank로, 두 Bank는 Fab으로 연결하고 외곽 순환을 추가합니다."],
		],
	),
	equip: helpContext(
		"EQUIP · PORT FIRST",
		"레일 Port에서 장비 만들기",
		"장비 모양부터 그리지 말고 레일의 합법적인 Port 슬롯을 먼저 선택하세요.",
		[
			["1 · 종류", "OHB, EQ 또는 STK 중 만들 장비를 선택합니다."],
			["2 · Port", "강조된 레일 슬롯을 클릭하거나 안내된 범위만 드래그합니다."],
			["3 · 그룹", "선택한 Port 수와 방향을 확인한 뒤 장비 그룹을 완료합니다."],
		],
	),
	inspect: helpContext(
		"INSPECT · SELECT",
		"필요한 부분을 선택하고 검증하기",
		"레일, 장비 또는 FAB 조직을 선택하면 지금 실행할 수 있는 작업만 가까운 패널에 나타납니다.",
		[
			["1 · 선택", "클릭은 하나, 드래그는 상자에 닿은 레일 모듈만 선택합니다."],
			["2 · 편집", "선택 패널의 첫 번째 강조 동작으로 복제·수정·삭제를 시작합니다."],
			["3 · 검증", "Checks에서 끊긴 연결과 정적 FAB 준비 상태를 확인합니다."],
		],
	),
} satisfies Readonly<Record<EditorActivity, EditorHelpContext>>);

export function deriveEditorHelpContext(input: EditorHelpContextInput): EditorHelpContext {
	if (input.ordinaryRailKeyboardPhase) {
		return ORDINARY_RAIL_KEYBOARD_HELP_CONTEXTS[input.ordinaryRailKeyboardPhase];
	}
	if (!input.organizationOpen) return ACTIVITY_HELP_CONTEXTS[input.activity];
	const selectedCount = Math.max(0, Math.floor(input.organizationSelectionCount));
	const summary =
		selectedCount === 0
			? "먼저 목록이나 지도에서 Fab, Bank 또는 Bay 하나를 고르세요."
			: selectedCount === 1
				? "1개를 선택했습니다. 같은 종류의 Bay나 Bank를 하나 더 고르면 연결과 정렬이 열립니다."
				: `${selectedCount.toLocaleString()}개를 선택했습니다. 포함 범위를 확인한 뒤 필요한 작업을 실행하세요.`;
	return helpContext(
		"INSPECT · FAB ORGANIZATION",
		"Fab, Bank, Bay를 선택하고 재사용하기",
		summary,
		[
			[
				"1 · 선택",
				"클릭은 하나를 선택하고, ⌘/Ctrl+클릭은 추가·제거합니다. Shift+클릭은 연속 선택입니다.",
			],
			["2 · 범위", "DIRECT는 선택한 조직 자체, EFFECTIVE는 그 아래 조직까지 포함합니다."],
			["3 · 실행", "SHOW는 위치 확인, COPY/SAVE는 재사용, ARRANGE/CONNECT는 두 조직 작업입니다."],
		],
		"FAB 조직으로 돌아가기",
	);
}

function helpContext(
	eyebrow: string,
	title: string,
	summary: string,
	steps: readonly (readonly [label: string, description: string])[],
	returnLabel = "현재 작업으로 돌아가기",
): EditorHelpContext {
	return Object.freeze({
		eyebrow,
		title,
		summary,
		steps: Object.freeze(
			steps.map(([label, description]) => Object.freeze({ label, description })),
		),
		returnLabel,
	});
}
