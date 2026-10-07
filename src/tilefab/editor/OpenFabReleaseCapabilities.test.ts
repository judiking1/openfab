import { describe, expect, it } from "vitest";
import { deriveOpenFabReleaseCapabilities } from "./OpenFabReleaseCapabilities";

describe("OpenFabReleaseCapabilities", () => {
	it("publishes read-only 3D while keeping simulation out of the default production release", () => {
		expect(
			deriveOpenFabReleaseCapabilities({
				development: false,
				derived3D: undefined,
				simulation: undefined,
			}),
		).toEqual({ derived3D: true, simulation: false });
	});

	it("supports an explicit inspection opt-out without enabling simulation", () => {
		expect(
			deriveOpenFabReleaseCapabilities({
				development: false,
				derived3D: "0",
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
