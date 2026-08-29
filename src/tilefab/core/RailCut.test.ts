import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import { createRailAreaSelection } from "./RailAreaSelection";
import { prepareRailAreaCut, prepareRailModuleCut } from "./RailCut";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";

describe("RailCut", () => {
	it("prepares an area clipboard and one erase plan without mutating the document", () => {
		const document = straightDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 8, y: 1 });
		const beforeRevision = document.map.getRevision();
		const beforeEdges = document.map.edgeCount;

		const prepared = prepareRailAreaCut({
			map: document.map,
			ownership,
			portEquipment: document.portEquipment,
			basePatchSequence: document.getPatchSequence(),
			selection,
		});

		expect(prepared.valid, prepared.reason).toBe(true);
		expect(document.map.getRevision()).toBe(beforeRevision);
		expect(document.map.edgeCount).toBe(beforeEdges);
		if (!prepared.valid) throw new Error(prepared.reason);
		expect(prepared.clipboard.template.sourceModuleCount).toBe(selection.ownerships.length);
		expect(
			"staticFabErase" in prepared.erasePlan
				? document.commitStaticFab(prepared.erasePlan)
				: document.commit(prepared.erasePlan),
		).toBe(true);
		expect(document.map.edgeCount).toBe(0);
		expect(document.undo()).toBe(true);
		expect(document.map.edgeCount).toBe(beforeEdges);
	});

	it("rejects a stale area before returning a clipboard candidate", () => {
		const document = straightDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 8, y: 1 });
		expect(
			document.commit(planRailConstruction(document.map, { x: 7, y: 0 }, { x: 9, y: 0 })),
		).toBe(true);

		const prepared = prepareRailAreaCut({
			map: document.map,
			ownership,
			portEquipment: document.portEquipment,
			basePatchSequence: document.getPatchSequence(),
			selection,
		});

		expect(prepared.valid).toBe(false);
		expect(prepared.clipboard).toBeNull();
		expect(prepared.erasePlan).toBeNull();
	});

	it("prepares a single module cut while leaving publication to the caller", () => {
		const document = straightDocument();
		const module = buildRailModuleOwnershipIndex(document.map).modules[0];
		if (!module) throw new Error("Expected a rail module.");

		const prepared = prepareRailModuleCut({
			map: document.map,
			portEquipment: emptyPortEquipmentState(),
			module,
		});

		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) throw new Error(prepared.reason);
		expect(prepared.clipboard.template.sourceKey).toBe(module.key);
		expect(document.map.edgeCount).toBeGreaterThan(0);
	});
});

function straightDocument(): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 7, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}
