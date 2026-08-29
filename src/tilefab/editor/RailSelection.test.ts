import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	resolveRailModuleOwnership,
} from "../core/RailModuleOwnership";
import { collectTurnoutFootprints } from "../core/turnout";
import { resolveRailSelectionOwnership } from "./RailSelection";

describe("resolveRailSelectionOwnership", () => {
	it("clears a turnout selection when undo removes its semantic identity", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const footprint = collectTurnoutFootprints(document.map)[0];
		if (!footprint) throw new Error("expected turnout");
		const selected = resolveRailModuleOwnership(
			buildRailModuleOwnershipIndex(document.map),
			footprint.cell,
			{
				incoming: footprint.curveFrom,
				outgoing: footprint.curveTo,
				role: "turnout-diverge",
			},
		);
		if (selected.status !== "resolved") throw new Error(selected.reason);

		expect(document.undo()).toBe(true);
		const afterUndo = buildRailModuleOwnershipIndex(document.map);
		expect(
			resolveRailSelectionOwnership(afterUndo, footprint.cell, selected.module.key),
		).toBeNull();
		expect(resolveRailSelectionOwnership(afterUndo, footprint.cell, null)?.kind).toBe("straight");
	});
});
