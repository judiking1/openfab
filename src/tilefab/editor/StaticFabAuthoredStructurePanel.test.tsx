import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaticFabAuthoredStructurePanel } from "./StaticFabAuthoredStructurePanel";

describe("StaticFabAuthoredStructurePanel", () => {
	it("routes ad-hoc rail toward authored Bay and organization commands", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAuthoredStructurePanel
				organizationCount={12}
				onAddProductionBay={vi.fn()}
				onBrowseOrganizations={vi.fn()}
			/>,
		);

		expect(markup).toContain("AUTHORED FAB STRUCTURE");
		expect(markup).toContain("NO SHAPE GUESSING");
		expect(markup).toContain("FAB");
		expect(markup).toContain("BANK");
		expect(markup).toContain("BAY");
		expect(markup).toContain("PROCESS LOOP");
		expect(markup).toContain("ADD PRODUCTION BAY");
		expect(markup).toContain("BROWSE AUTHORED");
		expect(markup).toContain("12");
		expect(markup).not.toContain("INFERRED");
	});
});
