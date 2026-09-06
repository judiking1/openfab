export interface OrdinaryFirstPortHandoffContext {
	readonly railAuthoringActive: boolean;
	readonly guidedBuildActive: boolean;
	readonly equipmentGroupCount: number;
	readonly portCount: number;
	readonly legalOhbSlotCount: number;
	readonly railKeyboardActive: boolean;
	readonly portKeyboardActive: boolean;
	readonly transientConstructionActive: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryFirstPortHandoffPresentation {
	readonly label: "다음 · OHB Port 1개";
	readonly instruction: "하늘색 원 클릭 · 또는 Enter";
	readonly ariaLabel: "다음 작업: 장비 메뉴에서 레일 옆 하늘색 원을 클릭하거나 Enter로 OHB Port 1개 놓기";
	readonly description: string;
}

export const ORDINARY_RAIL_COMMIT_PENDING_STATUS =
	"레일 구간을 건설했습니다 · OHB Port 후보를 확인합니다";

export const ORDINARY_FIRST_OHB_ENTRY_STATUS =
	"첫 OHB Port · 하늘색 원을 클릭하거나 흰 테두리·화살표 대상에서 Enter";

export function ordinaryRailCommitStatus(legalOhbSlotCount: number): string {
	if (!Number.isSafeInteger(legalOhbSlotCount) || legalOhbSlotCount < 0) {
		throw new RangeError("Ordinary Rail OHB slot count must be a non-negative safe integer.");
	}
	return legalOhbSlotCount > 0
		? "레일 구간을 건설했습니다 · 다음 레일은 빈 곳 어디서든 · Port는 장비 메뉴 · 선택·복제는 검사 메뉴"
		: "레일 구간을 건설했습니다 · 다음 레일은 빈 곳 어디서든 · OHB Port용 내부 직선 슬롯이 없습니다 · 양끝 터미널 안전 구간을 제외할 수 있도록 직선을 더 늘리세요 · 선택·복제는 검사 메뉴";
}

const FIRST_PORT_HANDOFF = Object.freeze({
	label: "다음 · OHB Port 1개",
	instruction: "하늘색 원 클릭 · 또는 Enter",
	ariaLabel: "다음 작업: 장비 메뉴에서 레일 옆 하늘색 원을 클릭하거나 Enter로 OHB Port 1개 놓기",
	description:
		"레일은 저장되었습니다. 장비 메뉴에서 하늘색 원을 클릭하거나 흰 테두리·화살표 대상에서 Enter를 눌러 첫 OHB Port를 놓습니다.",
}) satisfies OrdinaryFirstPortHandoffPresentation;

/**
 * Projects the first useful cross-activity handoff from canonical editor state.
 * This is an ordinary-editor affordance, not a tutorial checkpoint or persisted workflow state.
 */
export function ordinaryFirstPortHandoff(
	context: OrdinaryFirstPortHandoffContext,
): OrdinaryFirstPortHandoffPresentation | null {
	if (
		!context.railAuthoringActive ||
		context.guidedBuildActive ||
		context.equipmentGroupCount !== 0 ||
		context.portCount !== 0 ||
		context.legalOhbSlotCount <= 0 ||
		context.railKeyboardActive ||
		context.portKeyboardActive ||
		context.transientConstructionActive ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return FIRST_PORT_HANDOFF;
}
