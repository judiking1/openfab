import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultProductionBayModuleCatalogRequest } from "../compile/ProductionBayModuleCatalog";
import { ProductionBayModulePanel } from "./ProductionBayModuleDialog";

function props(
	overrides: Partial<ComponentProps<typeof ProductionBayModulePanel>> = {},
): ComponentProps<typeof ProductionBayModulePanel> {
	return {
		request: defaultProductionBayModuleCatalogRequest("twin-production-bay"),
		rotationDegrees: 0,
		placementPending: false,
		onRequestChange: vi.fn(),
		onClose: vi.fn(),
		onFocusCanvas: vi.fn(),
		...overrides,
	};
}

describe("ProductionBayModulePanel", () => {
	it("keeps current-map configuration non-modal and announces the live placement contract", () => {
		const markup = renderToStaticMarkup(<ProductionBayModulePanel {...props()} />);

		expect(markup).toMatch(/<section[^>]*aria-labelledby=/);
		expect(markup).toContain('data-testid="production-bay-module-panel"');
		expect(markup).toContain('data-live-preview="active"');
		expect(markup).not.toContain('role="dialog"');
		expect(markup).not.toContain('aria-modal="true"');
		expect(markup).toContain("LIVE GHOST READY");
		expect(markup).toContain("LMB place · R rotate · Esc cancel");
		expect(markup).toContain("CANVAS");
	});

	it("shows the canonical rotation and pauses invalid request updates", () => {
		const request = Object.freeze({
			...defaultProductionBayModuleCatalogRequest("twin-production-bay"),
			outerDepthMeters: 7,
		});
		const markup = renderToStaticMarkup(
			<ProductionBayModulePanel {...props({ request, rotationDegrees: 90 })} />,
		);

		expect(markup).toContain("Rotation </span>90°");
		expect(markup).toContain('data-live-preview="paused"');
		expect(markup).toContain("FIX DIMENSIONS");
		expect(markup).toMatch(/class="tilefab-production-bay-canvas" disabled=""/);
	});

	it("keeps the worker-check state visible without disabling configuration", () => {
		const markup = renderToStaticMarkup(
			<ProductionBayModulePanel {...props({ placementPending: true })} />,
		);

		expect(markup).toContain('data-placement-pending="true"');
		expect(markup).toContain("CHECKING PLACEMENT");
		expect(markup).not.toMatch(/aria-label="Increase Outer shell length"[^>]*disabled/);
	});
});
