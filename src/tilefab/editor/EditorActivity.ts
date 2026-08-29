/**
 * Product-level editor intent shown by the activity rail.
 *
 * Activity is transient UI state. It must not be serialized, reactively derived
 * from the current EditorTool, or used as a replacement for the existing tool contract.
 * An explicit user tool choice may select the matching activity at the same command boundary.
 */
export const EDITOR_ACTIVITIES = ["build", "assemble", "equip", "inspect"] as const;

export type EditorActivity = (typeof EDITOR_ACTIVITIES)[number];

export interface EditorActivityDefinition {
	readonly id: EditorActivity;
	readonly label: string;
	readonly description: string;
}

export const EDITOR_ACTIVITY_DEFINITIONS = [
	{
		id: "build",
		label: "BUILD",
		description: "Direct rail construction and repair",
	},
	{
		id: "assemble",
		label: "ASSEMBLE",
		description: "Fab, Bank, Bay, and blueprint assembly",
	},
	{
		id: "equip",
		label: "EQUIP",
		description: "Port-first OHB, EQ, and STK authoring",
	},
	{
		id: "inspect",
		label: "INSPECT",
		description: "Select, edit, validate, and understand authored truth",
	},
] as const satisfies readonly EditorActivityDefinition[];

export type EditorActivityAvailability =
	| Readonly<{ state: "ready"; reason?: string }>
	| Readonly<{ state: "blocked"; reason: string }>;
