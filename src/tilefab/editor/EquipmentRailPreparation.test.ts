import { describe, expect, it } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { equipmentRailPreparationHandoff } from "./EquipmentRailPreparation";

describe("equipment rail preparation", () => {
	it.each([
		"ohb",
		"eq",
		"stk",
	] as const)("returns to the requested %s without authored changes", (tool) => {
		const document = new RailDocument();
		const before = document.getPatchSequence();
		const result = equipmentRailPreparationHandoff({ document, tool }, document, true, 2_000);
		expect(result?.tool).toBe(tool);
		expect(result?.railReady).toBe(true);
		expect(result?.label).toContain(tool === "stk" ? "Stocker" : tool.toUpperCase());
		expect(document.getPatchSequence()).toBe(before);
	});

	it.each([
		"ohb",
		"eq",
		"stk",
	] as const)("explains missing %s rail without enabling return", (tool) => {
		const document = new RailDocument();
		const result = equipmentRailPreparationHandoff({ document, tool }, document, false, 2_000);
		expect(result?.railReady).toBe(false);
		expect(result?.instruction).toContain(tool === "eq" ? "PITCH 2 m" : "빈 직선 슬롯");
	});

	it("rejects a replaced document even when both documents have the same empty content", () => {
		const document = new RailDocument();
		expect(
			equipmentRailPreparationHandoff({ document, tool: "eq" }, new RailDocument(), true, 1_000),
		).toBeNull();
	});

	it("does not invent a return after cancellation or explicit tool selection clears the intent", () => {
		expect(equipmentRailPreparationHandoff(null, new RailDocument(), true, 1_000)).toBeNull();
	});
});
