export type BlueprintRecordContextScope = "project" | "user";

export type BlueprintRecordContextView = "commands" | "quick-slot";

export interface BlueprintRecordContextState {
	readonly scope: BlueprintRecordContextScope;
	readonly recordId: string;
	readonly view: BlueprintRecordContextView;
}

export type BlueprintRecordCommandId =
	| "save-to-user-library"
	| "toggle-favorite"
	| "delete-project"
	| "edit-metadata"
	| "choose-quick-slot"
	| "export-user-blueprint"
	| "save-to-project"
	| "delete-user-blueprint";

export interface BlueprintRecordCommand {
	readonly id: BlueprintRecordCommandId;
	readonly label: string;
	readonly tone: "default" | "accent" | "danger";
}

export function blueprintRecordCommands(input: {
	readonly scope: BlueprintRecordContextScope;
	readonly favorite?: boolean;
	readonly quickSlot?: number | null;
	readonly deleteConfirmation?: boolean;
}): readonly BlueprintRecordCommand[] {
	if (input.scope === "project") {
		return Object.freeze([
			command("save-to-user-library", "SAVE TO MY LIBRARY", "accent"),
			command("toggle-favorite", input.favorite ? "REMOVE FAVORITE" : "ADD FAVORITE"),
			command("delete-project", "DELETE FROM PROJECT", "danger"),
		]);
	}
	return Object.freeze([
		command("edit-metadata", "EDIT NAME & FOLDER"),
		command(
			"choose-quick-slot",
			input.quickSlot === null || input.quickSlot === undefined
				? "ASSIGN QUICK SLOT"
				: `QUICK SLOT ${input.quickSlot}`,
			"accent",
		),
		command("export-user-blueprint", "EXPORT .OPENFABBP"),
		command("save-to-project", "COPY TO PROJECT"),
		command(
			"delete-user-blueprint",
			input.deleteConfirmation ? "CONFIRM DELETE" : "MOVE TO TRASH",
			"danger",
		),
	]);
}

export function nextBlueprintRecordMenuIndex(input: {
	readonly key: string;
	readonly currentIndex: number;
	readonly itemCount: number;
}): number | null {
	if (input.itemCount <= 0) return null;
	if (input.key === "Home") return 0;
	if (input.key === "End") return input.itemCount - 1;
	if (input.key === "ArrowDown") return (input.currentIndex + 1) % input.itemCount;
	if (input.key === "ArrowUp") {
		return (input.currentIndex - 1 + input.itemCount) % input.itemCount;
	}
	return null;
}

export type UserBlueprintOrganizationTarget =
	| Readonly<{ kind: "folder"; folderPath: readonly string[] }>
	| Readonly<{ kind: "quick-slot"; quickSlot: number; occupiedById: string | null }>
	| Readonly<{ kind: "trash" }>;

export type UserBlueprintOrganizationPlan =
	| Readonly<{ kind: "move-folder"; folderPath: readonly string[] }>
	| Readonly<{ kind: "assign-quick-slot"; quickSlot: number }>
	| Readonly<{ kind: "delete" }>
	| Readonly<{ kind: "noop" }>
	| Readonly<{ kind: "blocked"; reason: string }>;

export function planUserBlueprintOrganization(input: {
	readonly recordId: string;
	readonly folderPath: readonly string[];
	readonly quickSlot: number | null;
	readonly target: UserBlueprintOrganizationTarget;
}): UserBlueprintOrganizationPlan {
	if (input.target.kind === "trash") return Object.freeze({ kind: "delete" });
	if (input.target.kind === "folder") {
		if (folderPathsEqual(input.folderPath, input.target.folderPath)) {
			return Object.freeze({ kind: "noop" });
		}
		return Object.freeze({
			kind: "move-folder",
			folderPath: Object.freeze([...input.target.folderPath]),
		});
	}
	if (
		!Number.isInteger(input.target.quickSlot) ||
		input.target.quickSlot < 1 ||
		input.target.quickSlot > 9
	) {
		return Object.freeze({ kind: "blocked", reason: "Quick slot은 1-9만 사용할 수 있습니다" });
	}
	if (input.target.occupiedById !== null && input.target.occupiedById !== input.recordId) {
		return Object.freeze({
			kind: "blocked",
			reason: `Quick slot ${input.target.quickSlot}은 이미 사용 중입니다`,
		});
	}
	if (input.quickSlot === input.target.quickSlot) return Object.freeze({ kind: "noop" });
	return Object.freeze({ kind: "assign-quick-slot", quickSlot: input.target.quickSlot });
}

function command(
	id: BlueprintRecordCommandId,
	label: string,
	tone: BlueprintRecordCommand["tone"] = "default",
): BlueprintRecordCommand {
	return Object.freeze({ id, label, tone });
}

function folderPathsEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
