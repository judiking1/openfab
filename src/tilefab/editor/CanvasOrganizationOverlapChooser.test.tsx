import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasOrganizationOverlapChooser } from "./CanvasOrganizationOverlapChooser";
import {
	nextCanvasOrganizationOverlapFocusTarget,
	nextCanvasOrganizationOverlapIndex,
} from "./CanvasOrganizationOverlapChooserNavigation";

const bayCandidates = Object.freeze([
	Object.freeze({ organizationId: 21, semanticRole: "BAY" as const, displayName: "North Bay" }),
	Object.freeze({ organizationId: 34, semanticRole: "BAY" as const, displayName: "South Bay" }),
]);

describe("nextCanvasOrganizationOverlapIndex", () => {
	it("keeps Tab focus cycling between the active option and close control", () => {
		expect(nextCanvasOrganizationOverlapFocusTarget("active-option")).toBe("close");
		expect(nextCanvasOrganizationOverlapFocusTarget("close")).toBe("active-option");
	});

	it("moves within bounds without changing the caller's order", () => {
		expect(
			nextCanvasOrganizationOverlapIndex({ currentIndex: 0, itemCount: 3, key: "ArrowDown" }),
		).toBe(1);
		expect(
			nextCanvasOrganizationOverlapIndex({ currentIndex: 2, itemCount: 3, key: "ArrowDown" }),
		).toBe(2);
		expect(
			nextCanvasOrganizationOverlapIndex({ currentIndex: 2, itemCount: 3, key: "ArrowUp" }),
		).toBe(1);
		expect(
			nextCanvasOrganizationOverlapIndex({ currentIndex: 0, itemCount: 3, key: "ArrowUp" }),
		).toBe(0);
	});

	it("supports list boundaries and rejects an empty list", () => {
		expect(nextCanvasOrganizationOverlapIndex({ currentIndex: 1, itemCount: 3, key: "Home" })).toBe(
			0,
		);
		expect(nextCanvasOrganizationOverlapIndex({ currentIndex: 1, itemCount: 3, key: "End" })).toBe(
			2,
		);
		expect(
			nextCanvasOrganizationOverlapIndex({ currentIndex: 0, itemCount: 0, key: "ArrowDown" }),
		).toBeNull();
	});
});

describe("CanvasOrganizationOverlapChooser", () => {
	it("renders a Korean-labelled roving listbox at the supplied client anchor", () => {
		const markup = renderToStaticMarkup(
			<CanvasOrganizationOverlapChooser
				candidates={bayCandidates}
				anchor={{ clientX: 420.4, clientY: 180.7 }}
				onChoose={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(markup).toContain("겹친 조직 선택");
		expect(markup).toContain('role="listbox"');
		expect(markup).toContain('aria-label="겹친 FAB 조직 선택"');
		expect(markup).toContain('aria-label="겹침 선택 닫기"');
		expect(markup).toContain("방향키로 후보를 이동하고 Enter 또는 Space로 선택하세요.");
		expect(markup).toContain("Tab은 선택기 안에서");
		expect(markup).toContain("--tilefab-overlap-anchor-x:420px");
		expect(markup).toContain("--tilefab-overlap-anchor-y:181px");
		expect(markup.match(/role="option"/g)).toHaveLength(2);
		expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
		expect(markup.match(/tabindex="-1"/g)).toHaveLength(1);
		expect(markup).toContain('data-organization-id="21"');
		expect(markup).toContain('data-organization-id="34"');
	});

	it("fails closed to the first semantic role while preserving its candidate order", () => {
		const markup = renderToStaticMarkup(
			<CanvasOrganizationOverlapChooser
				candidates={[
					bayCandidates[1],
					{ organizationId: 1, semanticRole: "FAB", displayName: "Main Fab" },
					bayCandidates[0],
				]}
				anchor={{ clientX: 0, clientY: 0 }}
				onChoose={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(markup).not.toContain("Main Fab");
		expect(markup.indexOf("South Bay")).toBeLessThan(markup.indexOf("North Bay"));
		expect(markup).toContain('data-semantic-role="BAY"');
	});

	it("renders nothing when there is no candidate", () => {
		expect(
			renderToStaticMarkup(
				<CanvasOrganizationOverlapChooser
					candidates={[]}
					anchor={{ clientX: 0, clientY: 0 }}
					onChoose={vi.fn()}
					onCancel={vi.fn()}
				/>,
			),
		).toBe("");
	});
});
