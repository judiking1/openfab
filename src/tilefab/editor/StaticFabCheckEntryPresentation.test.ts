import { describe, expect, it } from "vitest";
import { staticFabCheckEntryPresentation } from "./StaticFabCheckEntryPresentation";

describe("staticFabCheckEntryPresentation", () => {
	it("defers warning priority while an ordinary empty FAB still needs its first Rail", () => {
		expect(
			staticFabCheckEntryPresentation({
				baseState: "open",
				baseLabel: "FAB CHECK · 1",
				open: false,
				guidedDeferred: false,
				emptyRail: true,
			}),
		).toEqual({
			state: "guided",
			label: "CHECKS",
			ariaLabel: "FAB 검사 열기 · 먼저 Rail을 만드세요",
			taskFirst: true,
			glyph: "checks",
		});
	});

	it("reveals the exact underlying status when Checks is explicitly open", () => {
		expect(
			staticFabCheckEntryPresentation({
				baseState: "open",
				baseLabel: "FAB CHECK · 1",
				open: true,
				guidedDeferred: false,
				emptyRail: true,
			}),
		).toEqual({
			state: "open",
			label: "FAB CHECK · 1",
			ariaLabel: "FAB 검사 닫기 · FAB CHECK · 1",
			taskFirst: false,
			glyph: "status",
		});
	});

	it("does not suppress a non-empty or Guided contract", () => {
		expect(
			staticFabCheckEntryPresentation({
				baseState: "unsafe",
				baseLabel: "FAB CHECK · 3",
				open: false,
				guidedDeferred: false,
				emptyRail: false,
			}).taskFirst,
		).toBe(false);
		expect(
			staticFabCheckEntryPresentation({
				baseState: "open",
				baseLabel: "FAB CHECK · 1",
				open: false,
				guidedDeferred: true,
				emptyRail: true,
			}),
		).toEqual({
			state: "guided",
			label: "CHECKS",
			ariaLabel: "FAB 검사 열기",
			taskFirst: false,
			glyph: "status",
		});
	});
});
