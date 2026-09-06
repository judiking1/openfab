export interface OrdinaryNextPortHandoffContext {
	readonly surface: "ohb-authoring" | "build-return" | null;
	readonly guidedBuildActive: boolean;
	readonly ohbGroupCount: number;
	readonly eqGroupCount: number;
	readonly eqRowReady: boolean;
	readonly eqPitchMillimeters: number;
	readonly railKeyboardActive: boolean;
	readonly portKeyboardActive: boolean;
	readonly selectionActive: boolean;
	readonly placementIntentActive: boolean;
	readonly transientConstructionActive: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryNextPortHandoffPresentation {
	readonly surface: "ohb-authoring" | "build-return";
	readonly action: "start-eq" | "prepare-eq-rail";
	readonly label: "추천 · EQ Port 행" | "준비 · EQ용 직선" | "다음 · EQ Port 행";
	readonly instruction: string;
	readonly ariaLabel: string;
	readonly description: string;
}

export const ORDINARY_EQ_HANDOFF_ENTRY_STATUS =
	"EQ Port 행 · 포인터는 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그 · 키보드는 흰 테두리 1 시작에서 Enter";

export function ordinaryEqHandoffRailPrerequisiteStatus(pitchMillimeters: number): string {
	const pitchMeters = pitchMillimeters / 1_000;
	return `EQ 준비 · 같은 직선에 ${pitchMeters} m 간격으로 배치 가능한 CENTER 슬롯 2곳이 생기도록 레일을 늘리거나 새로 만드세요 · 기존 OHB는 유지됩니다`;
}

const NEXT_EQ_HANDOFF = Object.freeze({
	surface: "ohb-authoring",
	action: "start-eq",
	label: "추천 · EQ Port 행",
	instruction: "청록색 시작점 → 끝점 클릭",
	ariaLabel:
		"추천 다음 작업: 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그하여 EQ Port 행을 만듭니다. 키보드는 진입 후 표시되는 흰 테두리 1번 시작에서 Enter를 사용합니다. OHB Port는 계속 배치할 수 있습니다",
	description:
		"OHB Port를 계속 배치하거나, 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그합니다. 키보드는 흰 테두리 1번 시작에서 Enter를 사용합니다.",
}) satisfies OrdinaryNextPortHandoffPresentation;

/**
 * Projects the next useful equipment-kind handoff from canonical group evidence.
 * It does not own workflow progress, persistence, or placement state.
 */
export function ordinaryNextPortHandoff(
	context: OrdinaryNextPortHandoffContext,
): OrdinaryNextPortHandoffPresentation | null {
	if (
		context.surface === null ||
		context.guidedBuildActive ||
		context.ohbGroupCount < 1 ||
		context.eqGroupCount !== 0 ||
		context.selectionActive ||
		context.placementIntentActive ||
		context.transientConstructionActive ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	if (context.surface === "build-return") {
		if (context.railKeyboardActive || context.portKeyboardActive || !context.eqRowReady) {
			return null;
		}
		return buildReturnEqHandoff(context.eqPitchMillimeters);
	}
	return context.eqRowReady ? NEXT_EQ_HANDOFF : prepareEqRailHandoff(context.eqPitchMillimeters);
}

function buildReturnEqHandoff(pitchMillimeters: number): OrdinaryNextPortHandoffPresentation {
	const pitchMeters = pitchMillimeters / 1_000;
	return Object.freeze({
		surface: "build-return",
		action: "start-eq",
		label: "다음 · EQ Port 행",
		instruction: `PITCH ${pitchMeters} m 준비 · 청록색 시작점 → 끝점 클릭`,
		ariaLabel: `다음 작업: 현재 EQ PITCH ${pitchMeters} m로 완성할 수 있는 직선에서 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그하여 EQ Port 행을 만듭니다. 키보드는 진입 후 표시되는 흰 테두리 1번 시작에서 Enter를 사용합니다`,
		description: `현재 EQ PITCH ${pitchMeters} m로 EQ Port 행을 완성할 수 있는 직선 레일이 준비되었습니다. 청록색 슬롯의 시작점과 끝점을 차례로 클릭하거나 드래그하거나, 흰 테두리 1번 시작에서 Enter로 시작합니다.`,
	});
}

function prepareEqRailHandoff(pitchMillimeters: number): OrdinaryNextPortHandoffPresentation {
	const pitchMeters = pitchMillimeters / 1_000;
	return Object.freeze({
		surface: "ohb-authoring",
		action: "prepare-eq-rail",
		label: "준비 · EQ용 직선",
		instruction: `PITCH ${pitchMeters} m · CENTER 2곳 필요 · 레일 메뉴에서 준비`,
		ariaLabel: `EQ Port 행 준비: 현재 EQ PITCH ${pitchMeters} m에 맞춰 같은 직선에 배치 가능한 CENTER 슬롯이 ${pitchMeters} m 간격으로 최소 2곳 필요합니다. BUILD에서 직선 레일을 늘리거나 새로 만든 뒤 EQUIP의 EQ Port 행으로 돌아옵니다. 기존 OHB Port는 유지됩니다`,
		description: `현재 레일에는 한 EQ가 소유할 ${pitchMeters} m 간격의 CENTER 슬롯 2곳이 부족합니다. 기존 OHB Port는 유지되므로 BUILD에서 직선 레일을 늘리거나 새로 만든 뒤 EQ Port 행을 선택하세요.`,
	});
}
