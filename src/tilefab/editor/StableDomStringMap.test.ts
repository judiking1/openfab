import { describe, expect, it } from "vitest";
import { stableDomStringMap } from "./StableDomStringMap";

describe("Canvas diagnostic attribute publication", () => {
	it("republishes the current hover after React replaces the previously published attribute", () => {
		const dataset: DOMStringMap = { organizationOutlineHoverId: "" };
		const publication = stableDomStringMap(dataset);
		publication.organizationOutlineHoverId = "3";
		// A pending React commit can land between Canvas frames during menu/viewport changes.
		dataset.organizationOutlineHoverId = "";
		publication.organizationOutlineHoverId = "3";
		expect(dataset.organizationOutlineHoverId).toBe("3");
	});

	it("avoids redundant DOM writes while allowing another publisher to remove an attribute", () => {
		let writes = 0;
		const dataset: DOMStringMap = {};
		const observed = new Proxy(dataset, {
			set(target, key, value) {
				writes += 1;
				return Reflect.set(target, key, value);
			},
		});
		const publication = stableDomStringMap(observed);
		publication.cursorX = "80";
		publication.cursorX = "80";
		expect(writes).toBe(1);
		delete dataset.cursorX;
		publication.cursorX = "80";
		expect(dataset.cursorX).toBe("80");
		expect(writes).toBe(2);
	});

	it("removes attributes created outside the Canvas publisher", () => {
		const dataset: DOMStringMap = {};
		const publication = stableDomStringMap(dataset);
		dataset.cursorX = "80";
		delete publication.cursorX;
		expect(dataset.cursorX).toBeUndefined();
	});
});
