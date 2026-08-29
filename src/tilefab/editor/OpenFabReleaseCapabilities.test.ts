import { describe, expect, it } from "vitest";
import { deriveOpenFabReleaseCapabilities } from "./OpenFabReleaseCapabilities";

describe("OpenFabReleaseCapabilities", () => {
	it("keeps later product-series surfaces out of the default production release", () => {
		expect(
			deriveOpenFabReleaseCapabilities({
				development: false,
				derived3D: undefined,
				simulation: undefined,
			}),
		).toEqual({ derived3D: false, simulation: false });
	});

	it("retains private development and explicit series acceptance paths", () => {
		expect(
			deriveOpenFabReleaseCapabilities({
				development: true,
				derived3D: undefined,
				simulation: undefined,
			}),
		).toEqual({ derived3D: true, simulation: true });
		expect(
			deriveOpenFabReleaseCapabilities({
				development: false,
				derived3D: "1",
				simulation: "1",
			}),
		).toEqual({ derived3D: true, simulation: true });
	});
});
