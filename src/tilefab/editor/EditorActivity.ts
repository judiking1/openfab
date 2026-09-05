/**
 * Product-level editor intent shown by the activity rail.
 *
 * Activity is transient UI state. It must not be serialized, reactively derived
 * from the current EditorTool, or used as a replacement for the existing tool contract.
 * An explicit user tool choice may select the matching activity at the same command boundary.
 */
export const EDITOR_ACTIVITIES = ["build", "assemble", "equip", "inspect"] as const;

export type EditorActivity = (typeof EDITOR_ACTIVITIES)[number];

export function editorActivityCanvasLabel(activity: EditorActivity): string {
	if (activity === "build") return "단방향 AMHS 레일 건설 캔버스";
	if (activity === "assemble") return "정적 FAB 조립 및 조직 편집 캔버스";
	if (activity === "equip") return "정적 FAB Port 및 장비 편집 캔버스";
	return "정적 FAB 선택 및 검사 캔버스";
}

export interface EditorActivityDefinition {
	readonly id: EditorActivity;
	readonly label: string;
	readonly description: string;
}

export const EDITOR_ACTIVITY_DEFINITIONS = [
	{
		id: "build",
		label: "BUILD",
		description: "레일 만들기와 수정",
	},
	{
		id: "assemble",
		label: "ASSEMBLE",
		description: "Bay·Fab 조립과 청사진",
	},
	{
		id: "equip",
		label: "EQUIP",
		description: "Port부터 OHB·EQ·STK 배치",
	},
	{
		id: "inspect",
		label: "INSPECT",
		description: "선택·편집·검사",
	},
] as const satisfies readonly EditorActivityDefinition[];

export type EditorActivityAvailability =
	| Readonly<{ state: "ready"; reason?: string }>
	| Readonly<{ state: "blocked"; reason: string }>;
