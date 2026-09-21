import { describe, expect, it } from "vitest";
import { guidedPortCalloutLayout } from "./GuidedPortCalloutLayout";

const input = {
	width: 390,
	height: 528,
	anchor: { x: 196, y: 279 },
	markerRadius: 9,
	label: "OHB · 대표 Port 1개",
	instruction: "강조된 합법 슬롯 하나를 클릭하세요",
	measure: (text: string) => Array.from(text).length * 7,
};

describe("guidedPortCalloutLayout", () => {
	it("puts a short-screen callout below the Port when the Guide occupies the space above", () => {
		const layout = guidedPortCalloutLayout({
			...input,
			reservedLeftPixels: 64,
			reservedTopPixels: 224,
			reservedBottomPixels: 156,
		});
		expect(layout).not.toBeNull();
		if (!layout) return;
		expect(layout.y).toBeGreaterThan(input.anchor.y + input.markerRadius);
		expect(layout.y + layout.height).toBeLessThanOrEqual(input.height - 156 - 8);
		expect(layout.connector.fromY).toBeGreaterThan(layout.connector.toY);
		expect(layout.connector.toY).toBeGreaterThan(input.anchor.y + input.markerRadius);
	});

	it.each([64, 180])("honors both reserved sides with a %ipx left panel", (reservedLeftPixels) => {
		const layout = guidedPortCalloutLayout({
			...input,
			width: 760,
			anchor: { x: 520, y: 300 },
			reservedLeftPixels,
			reservedRightPixels: 220,
		});
		expect(layout).not.toBeNull();
		if (!layout) return;
		expect(layout.x).toBeGreaterThanOrEqual(reservedLeftPixels + 8);
		expect(layout.x + layout.width).toBeLessThanOrEqual(760 - 220 - 8);
		expect(layout.y + layout.height).toBeLessThan(300 - input.markerRadius);
		expect(layout.connector.fromY).toBeLessThan(layout.connector.toY);
	});

	it("wraps all Korean instruction text within the available box without shrinking it", () => {
		const instruction =
			"첫 번째 포트를 선택한 뒤 같은 레일의 끝 포트를 선택하면 장비를 만들 수 있습니다";
		const layout = guidedPortCalloutLayout({
			...input,
			anchor: { x: 250, y: 360 },
			reservedLeftPixels: 180,
			instruction,
		});
		expect(layout).not.toBeNull();
		if (!layout) return;
		expect(layout.instructionLines.length).toBeGreaterThan(1);
		expect(layout.instructionLines.join("").replaceAll(" ", "")).toBe(
			instruction.replaceAll(" ", ""),
		);
		for (const line of [...layout.labelLines, ...layout.instructionLines]) {
			expect(input.measure(line)).toBeLessThanOrEqual(layout.width - 20);
		}
	});

	it("omits redundant Canvas text when neither side can avoid chrome and the Port", () => {
		expect(
			guidedPortCalloutLayout({ ...input, reservedTopPixels: 240, reservedBottomPixels: 208 }),
		).toBeNull();
	});

	it("does not reduce a reserved panel to manufacture room for a callout", () => {
		expect(
			guidedPortCalloutLayout({ ...input, reservedLeftPixels: 220, reservedRightPixels: 180 }),
		).toBeNull();
	});

	it("omits text when even one glyph cannot fit between both panels", () => {
		expect(
			guidedPortCalloutLayout({ ...input, reservedLeftPixels: 180, reservedRightPixels: 169 }),
		).toBeNull();
	});
});
