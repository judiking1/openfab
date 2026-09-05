import type { PortType } from "../core/PortRecord";

export interface PortAuthoringSurfacePresentation {
	readonly toolCaption: string;
	readonly toolDescription: string;
	readonly buildbarTitle: string;
	readonly instruction: string;
	readonly configurationAvailable: boolean;
	readonly prerequisiteAction: PortAuthoringPrerequisiteAction | null;
}

export interface PortAuthoringPrerequisiteAction {
	readonly label: "먼저 레일 만들기";
	readonly ariaLabel: "BUILD로 이동해 직선 레일 만들기";
}

export function portAuthoringSurfacePresentation(
	portType: PortType,
	slotCount: number,
	legalSlotCount: number,
): PortAuthoringSurfacePresentation {
	if (
		!Number.isSafeInteger(slotCount) ||
		slotCount < 0 ||
		!Number.isSafeInteger(legalSlotCount) ||
		legalSlotCount < 0 ||
		legalSlotCount > slotCount
	) {
		throw new RangeError("Port authoring slot counts must be ordered non-negative safe integers.");
	}
	const count = legalSlotCount.toLocaleString("ko-KR");
	const configurationAvailable = legalSlotCount > 0;
	const prerequisiteAction =
		legalSlotCount === 0
			? Object.freeze({
					label: "먼저 레일 만들기",
					ariaLabel: "BUILD로 이동해 직선 레일 만들기",
				})
			: null;
	if (portType === "OHB") {
		return Object.freeze({
			toolCaption: "OHB Port",
			toolDescription: "레일 옆 원 · 클릭 또는 드래그",
			buildbarTitle: "OHB PORT",
			instruction:
				legalSlotCount > 0
					? `배치 가능 ${count}곳 · 클릭 또는 Enter: 1개 · 방향키/WASD: 대상 이동 · 같은 레일 드래그: 행 배치`
					: slotCount === 0
						? "배치 가능 슬롯 없음 · 먼저 직선 레일을 만드세요"
						: "배치 가능 슬롯 없음 · 양끝 터미널 안전 구간을 제외하고 내부 직선 슬롯이 생길 때까지 레일을 더 늘리세요",
			configurationAvailable,
			prerequisiteAction,
		});
	}
	if (portType === "EQ") {
		return Object.freeze({
			toolCaption: "EQ Port 행",
			toolDescription: "CENTER · 같은 직선 레일 드래그",
			buildbarTitle: "EQ PORT ROW",
			instruction:
				legalSlotCount > 0
					? `배치 가능 ${count}곳 · 같은 직선 레일을 따라 2개 이상 드래그`
					: "배치 가능 슬롯 없음 · 연속된 직선 레일을 먼저 만드세요",
			configurationAvailable,
			prerequisiteAction,
		});
	}
	return Object.freeze({
		toolCaption: "STK Port 그룹",
		toolDescription: "금색 ◇ CENTER · 선택 후 STK 생성",
		buildbarTitle: "STK PORT GROUP",
		instruction:
			legalSlotCount > 0
				? `금색 ◇ CENTER ${count}개 · STK에 연결할 Port 슬롯을 선택한 뒤 STK 생성`
				: "배치 가능 슬롯 없음 · STK가 연결될 직선 레일을 먼저 만드세요",
		configurationAvailable,
		prerequisiteAction,
	});
}
