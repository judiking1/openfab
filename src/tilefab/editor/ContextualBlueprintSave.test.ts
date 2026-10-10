import { describe, expect, it } from "vitest";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import {
	contextualBlueprintConnectivityLabel,
	contextualBlueprintSaveConnectivity,
	normalizeContextualBlueprintName,
	validateContextualBlueprintSaveDraft,
} from "./ContextualBlueprintSave";

describe("ContextualBlueprintSave", () => {
	it("reports the captured directed graph without treating open partial rails as invalid metadata", () => {
		const template = railTemplate([
			[0, 0],
			[1, 0],
			[2, 0],
			[3, 0],
			[4, 0],
		]);
		const before = JSON.stringify(template);
		const graph = contextualBlueprintSaveConnectivity(template);
		expect(graph).toMatchObject({ openPaths: 2, invalidPaths: 0, stronglyConnected: false });
		expect(contextualBlueprintConnectivityLabel(graph)).toContain("열린 경로 2개");
		expect(
			validateContextualBlueprintSaveDraft({
				name: "Partial rail",
				folder: "",
				destination: "project",
				quickSlot: null,
			}).valid,
		).toBe(true);
		expect(JSON.stringify(template)).toBe(before);
	});

	it("distinguishes one directed component from disconnected closed loops and reanalyzes each capture", () => {
		const cells: [number, number][] = [];
		for (let x = 0; x < 4; x++) cells.push([x, 0]);
		for (let y = 0; y < 4; y++) cells.push([4, y]);
		for (let x = 4; x > 0; x--) cells.push([x, 4]);
		for (let y = 4; y >= 0; y--) cells.push([0, y]);
		const loop = railTemplate(cells);
		const closed = contextualBlueprintSaveConnectivity(loop);
		expect(closed).toMatchObject({
			openPaths: 0,
			invalidPaths: 0,
			strongComponents: 1,
			stronglyConnected: true,
		});
		const disconnected = {
			...loop,
			edges: [
				...loop.edges,
				...loop.edges.map(({ from, to }) => ({
					from: { x: from.x + 12, y: from.y },
					to: { x: to.x + 12, y: to.y },
				})),
			],
		};
		expect(contextualBlueprintSaveConnectivity(disconnected)).toMatchObject({
			openPaths: 0,
			strongComponents: 2,
			stronglyConnected: false,
		});
		expect(contextualBlueprintSaveConnectivity(loop)).toEqual(closed);
	});

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

function railTemplate(cells: readonly (readonly [number, number])[]): RailAreaStampTemplate {
	return {
		sourceRevision: 1,
		sourceModuleKeys: [],
		sourceModuleCount: 1,
		sourceEdgeCount: cells.length - 1,
		sourceWidthMeters: 4,
		sourceHeightMeters: 4,
		edges: cells
			.slice(1)
			.map(([x, y], i) => ({ from: { x: cells[i][0], y: cells[i][1] }, to: { x, y } })),
	};
}
