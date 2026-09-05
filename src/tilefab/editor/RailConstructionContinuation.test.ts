import { describe, expect, it } from "vitest";
import {
	nextRailConstructionAnchor,
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
