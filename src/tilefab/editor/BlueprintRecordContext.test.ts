import { describe, expect, it } from "vitest";
import {
	blueprintRecordCommands,
	filterProjectBlueprintRecords,
	nextBlueprintRecordMenuIndex,
	planUserBlueprintOrganization,
	projectBlueprintRenameError,
} from "./BlueprintRecordContext";

describe("BlueprintRecordContext", () => {
	const searchRecords = Object.freeze([
		Object.freeze({ name: "Alpha Rail", folder: "Assembly", kind: "RAIL_AREA" as const }),
		Object.freeze({ name: "한글 장비", folder: "Process/Photo", kind: "STATIC_FAB" as const }),
		Object.freeze({
			name: "Alpha Bay",
			folder: "Process/Etch",
			kind: "STATIC_FAB_ORGANIZATION" as const,
		}),
	]);

	it("searches project blueprint names and folders without case or surrounding-space sensitivity", () => {
		expect(filterProjectBlueprintRecords(searchRecords, "  aLPHA ")).toEqual([
			searchRecords[0],
			searchRecords[2],
		]);
		expect(filterProjectBlueprintRecords(searchRecords, "process/photo")).toEqual([
			searchRecords[1],
		]);
		expect(filterProjectBlueprintRecords(searchRecords, "한글")).toEqual([searchRecords[1]]);
	});

	it("matches both stored kinds and the kind labels shown in project cards", () => {
		for (const [query, index] of [
			["rail_area", 0],
			["rail only", 0],
			["static fab", 1],
			["static_fab_organization", 2],
			["organized fab", 2],
		] as const) {
			expect(filterProjectBlueprintRecords(searchRecords, query)).toEqual([searchRecords[index]]);
		}
	});

	it("keeps source ordering and record identity without changing the library", () => {
		const original = JSON.stringify(searchRecords);
		const visible = filterProjectBlueprintRecords(searchRecords, "alpha");
		expect(visible[0]).toBe(searchRecords[0]);
		expect(visible[1]).toBe(searchRecords[2]);
		expect(Object.isFrozen(visible)).toBe(true);
		expect(JSON.stringify(searchRecords)).toBe(original);
		expect(filterProjectBlueprintRecords(searchRecords, " \t ")).toBe(searchRecords);
	});

	it("returns no matches while retaining the full source list for clear and empty-state distinction", () => {
		expect(filterProjectBlueprintRecords(searchRecords, "missing item")).toEqual([]);
		expect(searchRecords).toHaveLength(3);
		expect(filterProjectBlueprintRecords(searchRecords, "")).toBe(searchRecords);
		expect(filterProjectBlueprintRecords(Object.freeze([]), "alpha")).toEqual([]);
	});

	it("publishes scope-specific commands without hiding destructive intent", () => {
		expect(
			blueprintRecordCommands({ scope: "project", favorite: true }).map(({ id, label }) => ({
				id,
				label,
			})),
		).toEqual([
			{ id: "rename-project", label: "RENAME" },
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

	it("rejects an empty project name and a case-insensitive duplicate in the same folder", () => {
		const record = { id: "a", folder: "Process/Photo", name: "Original" };
		const records = [record, { id: "b", folder: "process/photo", name: "Taken" }];
		expect(projectBlueprintRenameError(record, "", records)).toBe("청사진 이름을 입력하세요");
		expect(projectBlueprintRenameError(record, "TAKEN", records)).toContain("같은 이름");
		expect(record.name).toBe("Original");
	});

	it("allows its own name, a case-only rename, and a name used only in another folder", () => {
		const record = { id: "a", folder: "Photo", name: "Original" };
		const records = [record, { id: "b", folder: "Etch", name: "Taken" }];
		for (const name of ["Original", "ORIGINAL", "Taken", "New name"]) {
			expect(projectBlueprintRenameError(record, name, records)).toBeNull();
		}
		expect(records.map(({ name }) => name)).toEqual(["Original", "Taken"]);
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
