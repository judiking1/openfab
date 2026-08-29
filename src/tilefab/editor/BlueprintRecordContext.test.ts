import { describe, expect, it } from "vitest";
import {
	blueprintRecordCommands,
	nextBlueprintRecordMenuIndex,
	planUserBlueprintOrganization,
} from "./BlueprintRecordContext";

describe("BlueprintRecordContext", () => {
	it("publishes scope-specific commands without hiding destructive intent", () => {
		expect(
			blueprintRecordCommands({ scope: "project", favorite: true }).map(({ id, label }) => ({
				id,
				label,
			})),
		).toEqual([
			{ id: "save-to-user-library", label: "SAVE TO MY LIBRARY" },
			{ id: "toggle-favorite", label: "REMOVE FAVORITE" },
			{ id: "delete-project", label: "DELETE FROM PROJECT" },
		]);
		expect(
			blueprintRecordCommands({
				scope: "user",
				quickSlot: 4,
				deleteConfirmation: true,
			}).map(({ id, label }) => ({ id, label })),
		).toEqual([
			{ id: "edit-metadata", label: "EDIT NAME & FOLDER" },
			{ id: "choose-quick-slot", label: "QUICK SLOT 4" },
			{ id: "export-user-blueprint", label: "EXPORT .OPENFABBP" },
			{ id: "save-to-project", label: "COPY TO PROJECT" },
			{ id: "delete-user-blueprint", label: "CONFIRM DELETE" },
		]);
	});

	it("wraps menu navigation and supports Home and End", () => {
		expect(nextBlueprintRecordMenuIndex({ key: "ArrowDown", currentIndex: 2, itemCount: 3 })).toBe(
			0,
		);
		expect(nextBlueprintRecordMenuIndex({ key: "ArrowUp", currentIndex: 0, itemCount: 3 })).toBe(2);
		expect(nextBlueprintRecordMenuIndex({ key: "Home", currentIndex: 2, itemCount: 3 })).toBe(0);
		expect(nextBlueprintRecordMenuIndex({ key: "End", currentIndex: 0, itemCount: 3 })).toBe(2);
		expect(nextBlueprintRecordMenuIndex({ key: "Tab", currentIndex: 0, itemCount: 3 })).toBeNull();
	});

	it("plans folder, quick-slot, and trash organization without implicit overwrite", () => {
		const base = { recordId: "user-blueprint-a", folderPath: ["Photo"], quickSlot: null } as const;
		expect(
			planUserBlueprintOrganization({
				...base,
				target: { kind: "folder", folderPath: ["Etch", "Reusable"] },
			}),
		).toEqual({ kind: "move-folder", folderPath: ["Etch", "Reusable"] });
		expect(
			planUserBlueprintOrganization({
				...base,
				target: { kind: "quick-slot", quickSlot: 6, occupiedById: null },
			}),
		).toEqual({ kind: "assign-quick-slot", quickSlot: 6 });
		expect(
			planUserBlueprintOrganization({
				...base,
				target: { kind: "quick-slot", quickSlot: 6, occupiedById: "user-blueprint-b" },
			}),
		).toEqual({ kind: "blocked", reason: "Quick slot 6은 이미 사용 중입니다" });
		expect(planUserBlueprintOrganization({ ...base, target: { kind: "trash" } })).toEqual({
			kind: "delete",
		});
	});

	it("treats same folder and quick slot drops as no-ops", () => {
		const base = { recordId: "user-blueprint-a", folderPath: ["Photo"], quickSlot: 2 } as const;
		expect(
			planUserBlueprintOrganization({
				...base,
				target: { kind: "folder", folderPath: ["Photo"] },
			}),
		).toEqual({ kind: "noop" });
		expect(
			planUserBlueprintOrganization({
				...base,
				target: { kind: "quick-slot", quickSlot: 2, occupiedById: "user-blueprint-a" },
			}),
		).toEqual({ kind: "noop" });
	});

	it("rejects quick-slot targets outside the public 1-9 contract", () => {
		const base = { recordId: "user-blueprint-a", folderPath: [], quickSlot: null } as const;
		for (const quickSlot of [0, 10, 1.5]) {
			expect(
				planUserBlueprintOrganization({
					...base,
					target: { kind: "quick-slot", quickSlot, occupiedById: null },
				}),
			).toEqual({ kind: "blocked", reason: "Quick slot은 1-9만 사용할 수 있습니다" });
		}
	});
});
