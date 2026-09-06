import type { EditorActivity } from "./EditorActivity";
import type {
	GuidedBuildFoundationMissionId,
	GuidedBuildSuggestedAction,
} from "./GuidedBuildMission";

export type GuidedBuildPrimaryTarget =
	| Readonly<{
			id: "command:stk.complete";
			kind: "equipment-complete";
			instruction: string;
	  }>
	| Readonly<{
			id: `activity:${EditorActivity}`;
			kind: "activity";
			activity: EditorActivity;
			instruction: string;
	  }>
	| Readonly<{
			id: "tool:build";
			kind: "rail-tool";
			instruction: string;
	  }>
	| Readonly<{
			id: "mode:route";
			kind: "route-mode";
			instruction: string;
	  }>
	| Readonly<{
			id: `tool:${"ohb" | "eq" | "stk"}`;
			kind: "equipment-tool";
			tool: "ohb" | "eq" | "stk";
			instruction: string;
	  }>
	| Readonly<{
			id: "tool:inspect";
			kind: "inspect-tool";
			instruction: string;
	  }>
	| Readonly<{
			id: "navigator:close";
			kind: "navigator-close";
			instruction: string;
	  }>
	| Readonly<{
			id: "command:selection.connected" | "command:selection.copy";
			kind: "selection-command";
			instruction: string;
	  }>
	| Readonly<{
			id: `canvas:${"rail" | "ohb" | "eq" | "stk" | "inspect"}`;
			kind: "canvas";
			instruction: string;
	  }>;

export interface GuidedBuildPrimaryTargetContext {
	readonly open: boolean;
	readonly currentMissionId: GuidedBuildFoundationMissionId | null;
	readonly activeActivity: EditorActivity;
	readonly tool: string;
	readonly buildMode: string;
	readonly suggestedAction: GuidedBuildSuggestedAction | null;
	readonly keyboardRailActive: boolean;
	readonly commandsActionable: boolean;
	readonly portCanvasActionable: boolean;
	readonly stkDraftReady?: boolean;
	readonly reuseSelectionCanvasActionable: boolean;
	readonly reuseSelectionSurfaceActive: boolean;
	readonly reuseSelectionObstructionOpen: boolean;
	readonly reuseConnectedSelectionActionable: boolean;
	readonly reuseCopySelectionActionable: boolean;
}

/**
 * Resolve the one visible target for the two novice construction handoffs.
 *
 * The resolver is presentation-only. It never advances a mission or mutates authored state. Its
 * ordering mirrors the UI hierarchy so a prompt never names an unmounted child control:
 * Activity -> tool -> construction mode -> guided entry/Canvas.
 */
export function resolveGuidedBuildPrimaryTarget(
	context: GuidedBuildPrimaryTargetContext,
): GuidedBuildPrimaryTarget | null {
	if (!context.open || context.currentMissionId === null || !context.commandsActionable)
		return null;
	if (context.currentMissionId === "first-rail" || context.currentMissionId === "process-loop") {
		return resolveRailTarget(context);
	}
	if (context.currentMissionId === "ports") return resolvePortTarget(context);
	if (context.currentMissionId === "reuse-loop") {
		if (context.suggestedAction === "inspect") return resolveReuseSelectionTarget(context);
		if (context.suggestedAction === "select-connected") {
			return resolveReuseConnectedSelectionTarget(context);
		}
		if (context.suggestedAction === "copy-selection") {
			return resolveReuseCopySelectionTarget(context);
		}
	}
	return null;
}

function resolveReuseCopySelectionTarget(
	context: GuidedBuildPrimaryTargetContext,
): GuidedBuildPrimaryTarget | null {
	if (context.reuseSelectionObstructionOpen) {
		return Object.freeze({
			id: "navigator:close",
			kind: "navigator-close",
			instruction:
				"강조된 닫기 버튼으로 FAB Navigator를 닫으세요. 선택한 정적 FAB의 복제로 돌아갑니다.",
		});
	}
	if (!context.reuseCopySelectionActionable) return null;
	return Object.freeze({
		id: "command:selection.copy",
		kind: "selection-command",
		instruction:
			"아래 강조된 ‘정적 FAB 복제’를 선택하세요. ⌘/Ctrl+C도 같은 일반 복제 명령과 검증을 사용합니다.",
	});
}

function resolveReuseConnectedSelectionTarget(
	context: GuidedBuildPrimaryTargetContext,
): GuidedBuildPrimaryTarget | null {
	if (context.reuseSelectionObstructionOpen) {
		return Object.freeze({
			id: "navigator:close",
			kind: "navigator-close",
			instruction:
				"강조된 닫기 버튼으로 FAB Navigator를 닫으세요. 선택한 Loop의 다음 작업으로 돌아갑니다.",
		});
	}
	if (!context.reuseConnectedSelectionActionable) return null;
	return Object.freeze({
		id: "command:selection.connected",
		kind: "selection-command",
		instruction:
			"아래 강조된 ‘연결 구조 전체’를 선택하세요. O 키로도 같은 일반 편집 명령을 실행할 수 있습니다.",
	});
}

function resolveRailTarget(context: GuidedBuildPrimaryTargetContext): GuidedBuildPrimaryTarget {
	if (context.activeActivity !== "build") {
		return Object.freeze({
			id: "activity:build",
			kind: "activity",
			activity: "build",
			instruction: "왼쪽에서 레일 · 레일을 선택하세요. 다음 레일 도구가 그 자리에서 열립니다.",
		});
	}
	if (context.tool !== "build") {
		return Object.freeze({
			id: "tool:build",
			kind: "rail-tool",
			instruction: "왼쪽 레일 메뉴에서 강조된 레일 건설 도구를 선택하세요.",
		});
	}
	if (context.buildMode !== "route") {
		return Object.freeze({
			id: "mode:route",
			kind: "route-mode",
			instruction: "아래 건설 바에서 강조된 ROUTE를 선택하세요.",
		});
	}
	return Object.freeze({
		id: "canvas:rail",
		kind: "canvas",
		instruction: context.keyboardRailActive
			? "Canvas의 강조점에서 방향키로 이동하고 Enter로 현재 레일 단계를 확정하세요."
			: context.currentMissionId === "first-rail"
				? "Canvas의 빈 격자에서 가로 또는 세로로 15 m 이상 드래그하세요. 키보드는 아래 보조 버튼으로 같은 레일 명령을 시작할 수 있습니다."
				: "Canvas에서 다음 Loop 구간을 시작점부터 끝점까지 드래그하세요. 키보드는 아래 보조 버튼으로 같은 레일 명령을 시작할 수 있습니다.",
	});
}

function resolvePortTarget(
	context: GuidedBuildPrimaryTargetContext,
): GuidedBuildPrimaryTarget | null {
	const equipmentTool = guidedEquipmentTool(context.suggestedAction);
	if (equipmentTool === null) return null;
	if (context.activeActivity !== "equip") {
		return Object.freeze({
			id: "activity:equip",
			kind: "activity",
			activity: "equip",
			instruction: `왼쪽에서 장비 · 장비를 선택하세요. 그러면 ${equipmentTool.toUpperCase()} Port 도구가 열립니다.`,
		});
	}
	if (context.tool !== equipmentTool) {
		return Object.freeze({
			id: `tool:${equipmentTool}`,
			kind: "equipment-tool",
			tool: equipmentTool,
			instruction: `${portToolLabel(equipmentTool)}를 선택하세요. 선택 직후 Canvas의 첫 합법 슬롯으로 안내합니다.`,
		});
	}
	if (equipmentTool === "stk" && context.stkDraftReady) {
		return Object.freeze({
			id: "command:stk.complete",
			kind: "equipment-complete",
			instruction:
				"Port 선택을 확인한 뒤 아래 ‘STK 생성’을 누르세요. Canvas에서는 Shift+Enter로 생성할 수 있습니다.",
		});
	}
	if (!context.portCanvasActionable) return null;
	return Object.freeze({
		id: `canvas:${equipmentTool}`,
		kind: "canvas",
		instruction: portCanvasInstruction(equipmentTool),
	});
}

function resolveReuseSelectionTarget(
	context: GuidedBuildPrimaryTargetContext,
): GuidedBuildPrimaryTarget | null {
	if (context.activeActivity !== "inspect") {
		return Object.freeze({
			id: "activity:inspect",
			kind: "activity",
			activity: "inspect",
			instruction:
				"왼쪽에서 검사 · 검토를 선택하세요. 선택 도구와 원본 Loop 위치가 Canvas에 이어서 표시됩니다.",
		});
	}
	if (context.reuseSelectionObstructionOpen) {
		return Object.freeze({
			id: "navigator:close",
			kind: "navigator-close",
			instruction:
				"강조된 닫기 버튼으로 FAB Navigator를 닫으세요. 원본 Loop의 선택 위치로 바로 돌아갑니다.",
		});
	}
	if (context.tool !== "inspect" || !context.reuseSelectionSurfaceActive) {
		return Object.freeze({
			id: "tool:inspect",
			kind: "inspect-tool",
			instruction: "검사 메뉴에서 강조된 선택 및 정보를 선택하세요.",
		});
	}
	if (!context.reuseSelectionCanvasActionable) return null;
	return Object.freeze({
		id: "canvas:inspect",
		kind: "canvas",
		instruction:
			"Canvas의 ‘이 레일 탭’ 고리에서 원본 Process Loop의 레일 하나를 선택하세요. Port나 장비를 선택해도 같은 연결 구조로 이어갈 수 있습니다.",
	});
}

function guidedEquipmentTool(
	action: GuidedBuildSuggestedAction | null,
): "ohb" | "eq" | "stk" | null {
	return action === "ohb" || action === "eq" || action === "stk" ? action : null;
}

function portToolLabel(tool: "ohb" | "eq" | "stk"): string {
	if (tool === "ohb") return "강조된 OHB · 레일 옆 Port 1개";
	if (tool === "eq") return "강조된 EQ · 같은 직선 Port 행";
	return "강조된 STK · 입고/출고 Port 2개";
}

function portCanvasInstruction(tool: "ohb" | "eq" | "stk"): string {
	if (tool === "ohb") {
		return "OHB 도구가 선택됐습니다. Canvas의 점선 고리가 있는 청록 슬롯에서 Enter를 누르거나 그 슬롯을 클릭하세요.";
	}
	if (tool === "eq") {
		return "‘1 시작’과 ‘2 끝’을 차례로 클릭하면 EQ 행을 만듭니다. 두 점 사이를 드래그하거나 각 위치에서 Enter를 눌러도 됩니다.";
	}
	return "아래 Port 개수 조건에 맞춰 금색 마름모를 클릭하거나 강조점에서 Enter로 선택하세요. 선택을 확인한 뒤 ‘STK 생성’ 또는 Shift+Enter로 생성합니다.";
}
