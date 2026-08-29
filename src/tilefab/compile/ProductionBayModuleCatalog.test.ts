import { describe, expect, it } from "vitest";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
	PRODUCTION_BAY_MODULE_CATALOG,
	productionBayModuleCatalogRequestError,
	productionBayModuleRequest,
} from "./ProductionBayModuleCatalog";

describe("ProductionBayModuleCatalog", () => {
	it("publishes distinct certified Single-loop and Twin-loop Bay families", () => {
		expect(PRODUCTION_BAY_MODULE_CATALOG.map((item) => item.id)).toEqual([
			"single-production-bay",
			"twin-production-bay",
		]);

		for (const item of PRODUCTION_BAY_MODULE_CATALOG) {
			const request = defaultProductionBayModuleCatalogRequest(item.id);
			expect(productionBayModuleCatalogRequestError(request)).toBeNull();
			const certified = certifyProductionBayModuleCatalogRequest(request);
			expect(certified.placementReady).toBe(true);
			expect(certified.plan.specification.processLoopCount).toBe(item.processLoopCount);
			expect(certified.organizationBundle.organizations).toHaveLength(item.processLoopCount + 1);
			expect(certified.organizationBundle.rootOrganizationIndices).toEqual([0]);
		}
	});

	it("keeps the public request free of world coordinates and caches immutable certification", () => {
		const request = defaultProductionBayModuleCatalogRequest("twin-production-bay");
		const first = certifyProductionBayModuleCatalogRequest(request);
		const second = certifyProductionBayModuleCatalogRequest({ ...request });

		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(productionBayModuleRequest(request)).toMatchObject({
			anchor: { x: 0, y: 0 },
			processLoopCount: 2,
			pose: { flow: "forward" },
		});
	});

	it("rejects dimensions that cannot preserve the modular shell and gateway clearances", () => {
		const request = {
			...defaultProductionBayModuleCatalogRequest("twin-production-bay"),
			outerDepthMeters: 10,
		};
		expect(productionBayModuleCatalogRequestError(request)).toMatch(/process-loop/i);
		expect(() => certifyProductionBayModuleCatalogRequest(request)).toThrow(/process-loop/i);
	});

	it("keeps opposite flow as a separately certified directed topology", () => {
		const forward = defaultProductionBayModuleCatalogRequest("single-production-bay");
		const reverse = { ...forward, flow: "reverse" as const };

		const forwardArtifact = certifyProductionBayModuleCatalogRequest(forward);
		const reverseArtifact = certifyProductionBayModuleCatalogRequest(reverse);
		expect(reverseArtifact.fingerprint).not.toBe(forwardArtifact.fingerprint);
		expect(reverseArtifact.topology.strongComponents).toBe(1);
		expect(reverseArtifact.physical.strongComponents).toBe(1);
	});
});
