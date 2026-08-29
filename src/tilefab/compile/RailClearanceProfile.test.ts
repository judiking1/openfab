import { describe, expect, it } from "vitest";
import {
	DEFAULT_RAIL_CLEARANCE_PROFILE,
	OPENFAB_CLEARANCE_PROFILE_CATALOG,
	railClearanceProfileError,
	resolveRailClearanceProfile,
} from "./RailClearanceProfile";

describe("RailClearanceProfile", () => {
	it("exposes an immutable catalog with a deterministic default lookup", () => {
		expect(Object.isFrozen(OPENFAB_CLEARANCE_PROFILE_CATALOG)).toBe(true);
		expect(OPENFAB_CLEARANCE_PROFILE_CATALOG.length).toBeGreaterThan(0);
		for (const profile of OPENFAB_CLEARANCE_PROFILE_CATALOG) {
			expect(Object.isFrozen(profile)).toBe(true);
			expect(resolveRailClearanceProfile(profile.id)).toBe(profile);
			expect(railClearanceProfileError({ ...profile })).toBeNull();
		}
		expect(resolveRailClearanceProfile(DEFAULT_RAIL_CLEARANCE_PROFILE.id)).toBe(
			DEFAULT_RAIL_CLEARANCE_PROFILE,
		);
	});

	it("uses positive integer millimeters with monotonic clearance radii", () => {
		for (const profile of OPENFAB_CLEARANCE_PROFILE_CATALOG) {
			expect(Number.isSafeInteger(profile.version)).toBe(true);
			expect(profile.version).toBeGreaterThan(0);
			expect(profile.approximationToleranceMillimeters).toBeGreaterThan(0);
			expect(profile.approximationToleranceMillimeters).toBeLessThanOrEqual(
				profile.beamRadiusMillimeters,
			);
			expect(profile.beamRadiusMillimeters).toBeLessThan(profile.ohtSweepRadiusMillimeters);
			expect(profile.ohtSweepRadiusMillimeters).toBeLessThan(profile.installationRadiusMillimeters);
			for (const value of [
				profile.beamRadiusMillimeters,
				profile.ohtSweepRadiusMillimeters,
				profile.installationRadiusMillimeters,
				profile.approximationToleranceMillimeters,
			]) {
				expect(Number.isSafeInteger(value)).toBe(true);
			}
		}
	});

	it("returns null for unknown or non-exact IDs and rejects custom profiles", () => {
		expect(resolveRailClearanceProfile("OPENFAB_UNKNOWN_CLEARANCE_V1")).toBeNull();
		expect(resolveRailClearanceProfile(DEFAULT_RAIL_CLEARANCE_PROFILE.id.toLowerCase())).toBeNull();
		expect(
			railClearanceProfileError({
				...DEFAULT_RAIL_CLEARANCE_PROFILE,
				id: "CUSTOM_CLEARANCE_V1",
			}),
		).toContain("Unknown OpenFab");
	});

	it.each([
		["null", null],
		["array", []],
		["missing fields", {}],
		["extra fields", { ...DEFAULT_RAIL_CLEARANCE_PROFILE, label: "custom" }],
		["empty id", { ...DEFAULT_RAIL_CLEARANCE_PROFILE, id: "" }],
		["zero version", { ...DEFAULT_RAIL_CLEARANCE_PROFILE, version: 0 }],
		["fractional radius", { ...DEFAULT_RAIL_CLEARANCE_PROFILE, beamRadiusMillimeters: 100.5 }],
		[
			"non-finite radius",
			{ ...DEFAULT_RAIL_CLEARANCE_PROFILE, ohtSweepRadiusMillimeters: Number.NaN },
		],
		[
			"negative tolerance",
			{ ...DEFAULT_RAIL_CLEARANCE_PROFILE, approximationToleranceMillimeters: -1 },
		],
		[
			"non-monotonic radii",
			{
				...DEFAULT_RAIL_CLEARANCE_PROFILE,
				ohtSweepRadiusMillimeters: DEFAULT_RAIL_CLEARANCE_PROFILE.beamRadiusMillimeters,
			},
		],
		[
			"changed catalog value",
			{
				...DEFAULT_RAIL_CLEARANCE_PROFILE,
				installationRadiusMillimeters:
					DEFAULT_RAIL_CLEARANCE_PROFILE.installationRadiusMillimeters + 1,
			},
		],
	] as const)("rejects malformed input: %s", (_label, profile) => {
		expect(railClearanceProfileError(profile)).not.toBeNull();
	});
});
