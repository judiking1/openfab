import { describe, expect, it } from "vitest";
import {
	normalizeContextualBlueprintName,
	validateContextualBlueprintSaveDraft,
} from "./ContextualBlueprintSave";

describe("ContextualBlueprintSave", () => {
	it("normalizes a folder and retains an available browser-local quick slot", () => {
		expect(
			validateContextualBlueprintSaveDraft({
				name: "Photo Bay",
				folder: " Process / Photo ",
				destination: "user-library",
				quickSlot: 4,
			}),
		).toEqual({
			valid: true,
			name: "Photo Bay",
			folder: "Process/Photo",
			folderPath: ["Process", "Photo"],
			destination: "user-library",
			quickSlot: 4,
		});
	});

	it("rejects a name that would be silently changed before persistence", () => {
		expect(
			validateContextualBlueprintSaveDraft({
				name: "  Photo   Bay  ",
				folder: "",
				destination: "project",
				quickSlot: null,
			}),
		).toEqual({
			valid: false,
			field: "name",
			reason: "청사진 이름의 앞뒤 또는 연속 공백을 정리하세요",
		});
	});

	it("ignores quick slots for project-local records", () => {
		expect(
			validateContextualBlueprintSaveDraft(
				{
					name: "Bay",
					folder: "",
					destination: "project",
					quickSlot: 2,
				},
				new Set([2]),
			),
		).toMatchObject({ valid: true, destination: "project", quickSlot: null });
	});

	it("rejects an occupied installation quick slot before persistence", () => {
		expect(
			validateContextualBlueprintSaveDraft(
				{
					name: "Bay",
					folder: "",
					destination: "user-library",
					quickSlot: 7,
				},
				new Set([7]),
			),
		).toEqual({ valid: false, field: "quick-slot", reason: "Quick slot 7은 이미 사용 중입니다" });
	});

	it.each([
		["", "name"],
		["Bay", "folder", "A/B/C/D/E"],
		["Bay", "folder", "A//B"],
		["Bay", "folder", "A/../B"],
		["Bay", "folder", "A\\B"],
	] as readonly (readonly [
		string,
		"name" | "folder",
		string?,
	])[])("rejects invalid metadata %#", (name, field, folder = "") => {
		const result = validateContextualBlueprintSaveDraft({
			name: name ?? "",
			folder,
			destination: "project",
			quickSlot: null,
		});
		expect(result.valid).toBe(false);
		if (!result.valid) expect(result.field).toBe(field);
	});

	it("offers a bounded canonicalizer for generated fallback names", () => {
		expect(normalizeContextualBlueprintName("A".repeat(100))).toHaveLength(80);
	});
});
