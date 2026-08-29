import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_COMPOUND_PROFILE_IDS,
	buildOpenFabCompoundGeometry,
	COMPOUND_FIT_REASON,
	OPENFAB_COMPOUND_PROFILE_CATALOG,
	type Point2,
} from "./OpenFabCompoundGeometry";

describe("OpenFabCompoundGeometry", () => {
	it("derives every project-owned profile from R500 grid geometry", () => {
		expect(OPENFAB_COMPOUND_PROFILE_CATALOG).toHaveLength(8);
		for (const profile of OPENFAB_COMPOUND_PROFILE_CATALOG) {
			expect(profile.id).toMatch(/^OPENFAB_/);
			expect(profile.radiusMillimeters).toBe(500);
			expect(profile.leadInMillimeters).toBe(500);
			expect(profile.leadOutMillimeters).toBe(500);
			const arcCount = profile.type === "RIGHT_CURVE" || profile.type === "CCW_CURVE" ? 1 : 2;
			const expectedOuter = Math.round(
				arcCount * profile.radiusMillimeters * ((profile.turnAngleTenths * Math.PI) / 1_800) +
					profile.middleMillimeters,
			);
			expect(profile.outerLengthMillimeters, profile.id).toBe(expectedOuter);
			expect(profile.lengthMillimeters).toBe(
				profile.leadInMillimeters + expectedOuter + profile.leadOutMillimeters,
			);
		}
		expect(new Set(Object.values(ADVANCED_SWITCH_COMPOUND_PROFILE_IDS)).size).toBe(4);
	});

	it("fits the canonical 2 m by 1 m S module exactly", () => {
		const geometry = buildOpenFabCompoundGeometry(
			"S_CURVE",
			{ x: 0, y: 0 },
			{ x: 2, y: 1 },
			{ x: 1, y: 0 },
			{ x: 1, y: 0 },
		);

		expect(geometry).not.toBeNull();
		expect(geometry).toMatchObject({
			fitKind: "MAP_EXACT",
			fitReasonMask: COMPOUND_FIT_REASON.NONE,
			nominalProfileIndex: 1,
			lateralSideSign: 1,
			radiusMillimeters: 500,
			turnAngleTenths: 900,
			leadInMillimeters: 500,
			leadOutMillimeters: 500,
			middleMillimeters: 0,
			forwardFitDeltaMillimeters: 0,
			lateralFitDeltaMillimeters: 0,
			leadInResidualMillimeters: 0,
			leadOutResidualMillimeters: 0,
			middleResidualMillimeters: 0,
			lengthResidualMillimeters: 0,
		});
		expect(geometry?.nominalLengthMillimeters).toBe(2_571);
		expect(geometry?.compiledLengthMillimeters).toBe(2_571);
		expect(geometry?.length).toBeCloseTo(1 + Math.PI / 2, 9);
		expect(geometry?.controlPoints).toHaveLength(12);
		expectEndpoints(geometry, { x: 0, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 0 });
	});

	it("grid-fits a larger S module while preserving the project-owned radius and angle", () => {
		const geometry = buildOpenFabCompoundGeometry(
			"S_CURVE",
			{ x: 0, y: 0 },
			{ x: 3, y: 2 },
			{ x: 1, y: 0 },
			{ x: 1, y: 0 },
		);

		expect(geometry?.fitKind).toBe("GRID_FIT");
		expect(geometry?.fitReasonMask).toBe(
			COMPOUND_FIT_REASON.FORWARD_SPAN |
				COMPOUND_FIT_REASON.LATERAL_SPAN |
				COMPOUND_FIT_REASON.PROFILE_METRICS,
		);
		expect(geometry).toMatchObject({
			radiusMillimeters: 500,
			turnAngleTenths: 900,
			leadInMillimeters: 1_000,
			leadOutMillimeters: 1_000,
			middleMillimeters: 1_000,
		});
		expect(geometry?.compiledLengthMillimeters).toBe(4_571);
		expectEndpoints(geometry, { x: 0, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 0 }, { x: 1, y: 0 });
	});

	it.each([
		["CCW_CURVE", { x: 0, y: 1 }, { x: -1, y: 0 }, 1 + Math.PI / 2],
		["CSC_CURVE_HOMO", { x: 0, y: 2 }, { x: -1, y: 0 }, 2 + Math.PI / 2],
		["CSC_CURVE_HETE", { x: 2, y: 2 }, { x: 1, y: 0 }, 2 + Math.PI / 2],
	] as const)("builds the canonical %s module", (type, end, endTangent, length) => {
		const geometry = buildOpenFabCompoundGeometry(
			type,
			{ x: 0, y: 0 },
			end,
			{ x: 1, y: 0 },
			endTangent,
		);

		expect(geometry?.fitKind).toBe("MAP_EXACT");
		expect(geometry?.length).toBeCloseTo(length, 3);
		expectEndpoints(geometry, { x: 0, y: 0 }, end, { x: 1, y: 0 }, endTangent);
		expect(geometry?.controlPoints).toHaveLength(type === "CCW_CURVE" ? 8 : 12);
	});

	it("preserves endpoints and tangents through every rotation and lateral sign", () => {
		const directions: Point2[] = [
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: -1, y: 0 },
			{ x: 0, y: -1 },
		];
		for (const forward of directions) {
			const right = { x: -forward.y, y: forward.x };
			for (const side of [-1, 1]) {
				const start = { x: 7, y: -3 };
				const end = {
					x: start.x + forward.x * 2 + right.x * side,
					y: start.y + forward.y * 2 + right.y * side,
				};
				const geometry = buildOpenFabCompoundGeometry("S_CURVE", start, end, forward, forward);
				expectEndpoints(geometry, start, end, forward, forward);
				expect(geometry?.lateralSideSign).toBe(side);
			}
		}
	});

	it("keeps every sampled segment below the 50 mm path-spacing budget", () => {
		const geometry = buildOpenFabCompoundGeometry(
			"S_CURVE",
			{ x: 0, y: 0 },
			{ x: 3, y: 2 },
			{ x: 1, y: 0 },
			{ x: 1, y: 0 },
		);
		expect(geometry).not.toBeNull();
		const positions = geometry?.positions ?? [];
		for (let index = 2; index < positions.length; index += 2) {
			expect(
				Math.hypot(
					(positions[index] as number) - (positions[index - 2] as number),
					(positions[index + 1] as number) - (positions[index - 1] as number),
				),
			).toBeLessThanOrEqual(0.0501);
		}
	});

	it("rejects zero-offset geometry and a profile from another family", () => {
		expect(
			buildOpenFabCompoundGeometry(
				"S_CURVE",
				{ x: 0, y: 0 },
				{ x: 2, y: 0 },
				{ x: 1, y: 0 },
				{ x: 1, y: 0 },
			),
		).toBeNull();
		expect(
			buildOpenFabCompoundGeometry(
				"S_CURVE",
				{ x: 0, y: 0 },
				{ x: 2, y: 1 },
				{ x: 1, y: 0 },
				{ x: 1, y: 0 },
				{ nominalProfileId: "OPENFAB_CCW_R500_A180_L500_V1" },
			),
		).toBeNull();
	});
});

function expectEndpoints(
	geometry: ReturnType<typeof buildOpenFabCompoundGeometry>,
	start: Point2,
	end: Point2,
	startTangent: Point2,
	endTangent: Point2,
): void {
	expect(geometry).not.toBeNull();
	const positions = geometry?.positions ?? [];
	const tangents = geometry?.tangents ?? [];
	expect(positions[0]).toBeCloseTo(start.x, 6);
	expect(positions[1]).toBeCloseTo(start.y, 6);
	expect(positions.at(-2)).toBeCloseTo(end.x, 6);
	expect(positions.at(-1)).toBeCloseTo(end.y, 6);
	expect(tangents[0]).toBeCloseTo(startTangent.x, 6);
	expect(tangents[1]).toBeCloseTo(startTangent.y, 6);
	expect(tangents.at(-2)).toBeCloseTo(endTangent.x, 6);
	expect(tangents.at(-1)).toBeCloseTo(endTangent.y, 6);
}
