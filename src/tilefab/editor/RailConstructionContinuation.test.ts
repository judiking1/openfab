import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	captureRailModulePreparation,
	nextRailConstructionAnchor,
	railModulePreparationHandoff,
	rejectedRailConstructionAnchor,
} from "./RailConstructionContinuation";

describe("nextRailConstructionAnchor", () => {
	it("releases a Smart Route anchor so the next blank-area drag starts where pressed", () => {
		expect(nextRailConstructionAnchor({ kind: "direct-route" }, { x: 18, y: 4 })).toBeNull();
	});

	it("preserves explicit compound-module continuation policies", () => {
		expect(
			nextRailConstructionAnchor(
				{ kind: "module", repeatFromExit: true, exit: { x: 7, y: 9 } },
				{ x: 20, y: 30 },
			),
		).toEqual({ x: 7, y: 9 });
		expect(
			nextRailConstructionAnchor(
				{ kind: "module", repeatFromExit: false, exit: { x: 7, y: 9 } },
				{ x: 20, y: 30 },
			),
		).toEqual({ x: 20, y: 30 });
	});

	it("does not retain a hidden Smart Route anchor after a rejected moved drag", () => {
		expect(rejectedRailConstructionAnchor({ kind: "direct-route" }, { x: -12, y: 40 })).toBeNull();
		expect(
			rejectedRailConstructionAnchor(
				{ kind: "module", repeatFromExit: false, exit: { x: 2, y: 3 } },
				{ x: -12, y: 40 },
			),
		).toEqual({ x: -12, y: 40 });
	});
});

describe("module rail preparation", () => {
	const settings = {
		span: "wide",
		profile: "C",
		copiedSide: "left",
		explicitSide: "right",
	} as const;
	it.each([
		"u-turn",
		"shift",
		"advanced-switch",
	] as const)("retains %s settings across rail edits and undo", (mode) => {
		const document = new RailDocument();
		const preparation = captureRailModulePreparation(document, mode, settings);
		expect(preparation).toMatchObject({ document, mode, ...settings });
		expect(railModulePreparationHandoff(preparation, document, false)?.label).toBe(
			"먼저 레일 그리기",
		);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		expect(railModulePreparationHandoff(preparation, document, true)?.railReady).toBe(true);
		expect(document.undo()).toBe(true);
		expect(railModulePreparationHandoff(preparation, document, false)?.railReady).toBe(false);
		expect(preparation).toMatchObject(settings);
	});

	it("offers preparation only for a fixed module in an empty document", () => {
		const document = new RailDocument();
		expect(captureRailModulePreparation(document, "route", settings)).toBeNull();
		expect(captureRailModulePreparation(document, "network-link", settings)).toBeNull();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		expect(captureRailModulePreparation(document, "u-turn", settings)).toBeNull();
	});

	it("drops the handoff after cancellation or document replacement", () => {
		const document = new RailDocument();
		const preparation = captureRailModulePreparation(document, "shift", settings);
		expect(railModulePreparationHandoff(null, document, true)).toBeNull();
		expect(railModulePreparationHandoff(preparation, new RailDocument(), true)).toBeNull();
	});
});
