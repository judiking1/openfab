import { describe, expect, it } from "vitest";
import { assemblyRailTemplateGallery, contextualRailTemplates } from "./RailTemplateSurfacePolicy";

describe("RailTemplateSurfacePolicy", () => {
	it("keeps only context-free closed motifs in the persistent Advanced gallery", () => {
		expect(assemblyRailTemplateGallery("bay").map((item) => item.id)).toEqual([
			"long-bay",
			"paired-bay",
			"nested-bay",
			"shift-bay",
		]);
		expect(assemblyRailTemplateGallery("interbay").map((item) => item.id)).toEqual([
			"interbay-spine",
		]);
		expect(assemblyRailTemplateGallery("outerbay").map((item) => item.id)).toEqual(["outer-loop"]);
	});

	it("offers trunk attachments only for a selected straight rail", () => {
		expect(
			contextualRailTemplates({
				mapEmpty: false,
				selectedRailType: "LINEAR",
				selectedOpenTerminal: false,
			}).map((item) => item.id),
		).toEqual(["attached-return", "branch-bypass", "outerbay-link"]);
		expect(
			contextualRailTemplates({
				mapEmpty: false,
				selectedRailType: "LEFT_CURVE",
				selectedOpenTerminal: false,
			}),
		).toEqual([]);
	});

	it("offers terminal repair only at an open terminal or on an empty map", () => {
		expect(
			contextualRailTemplates({
				mapEmpty: false,
				selectedRailType: "TERMINAL",
				selectedOpenTerminal: true,
			}).map((item) => item.id),
		).toEqual(["return-loop"]);
		expect(
			contextualRailTemplates({
				mapEmpty: true,
				selectedRailType: null,
				selectedOpenTerminal: false,
			}).map((item) => item.id),
		).toEqual(["return-loop"]);
	});
});
