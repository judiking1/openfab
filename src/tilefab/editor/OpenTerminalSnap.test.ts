import { describe, expect, it } from "vitest";
import {
	resolveNearestOpenTerminal,
	shouldPreserveInitialOpenTerminalSnap,
} from "./OpenTerminalSnap";

describe("resolveNearestOpenTerminal", () => {
	it("chooses the nearest compatible typed-buffer cell deterministically", () => {
		const terminals = new Int32Array([4, 2, 1, 1, 2, 1]);
		const snap = resolveNearestOpenTerminal(terminals, { x: 2, y: 1.5 }, 2, (cell) => cell.x !== 1);

		expect(snap).toEqual({ cell: { x: 2, y: 1 }, distanceMeters: 0.5 });
	});

	it("returns null outside the zoom-bounded radius", () => {
		expect(
			resolveNearestOpenTerminal(new Int32Array([8, 8]), { x: 0, y: 0 }, 1, () => true),
		).toBeNull();
	});

	it("keeps a magnetic first-click anchor until an actual module drag begins", () => {
		expect(
			shouldPreserveInitialOpenTerminalSnap({
				requiresOpenTerminal: true,
				planCreated: false,
				start: { x: 4, y: 2 },
				current: { x: 4, y: 2 },
			}),
		).toBe(true);
		expect(
			shouldPreserveInitialOpenTerminalSnap({
				requiresOpenTerminal: true,
				planCreated: true,
				start: { x: 4, y: 2 },
				current: { x: 4, y: 2 },
			}),
		).toBe(false);
		expect(
			shouldPreserveInitialOpenTerminalSnap({
				requiresOpenTerminal: true,
				planCreated: false,
				start: { x: 4, y: 2 },
				current: { x: 5, y: 2 },
			}),
		).toBe(false);
	});
});
