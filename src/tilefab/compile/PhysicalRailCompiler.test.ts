import { describe, expect, it } from "vitest";
import { planRailConstruction, planRailPath } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { planRailModule } from "../core/RailModulePlanner";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { type Cell, cellKey, encodeRailCell } from "../core/TileMap";
import { TURNOUT_KIND } from "../core/turnout";
import { PATH_KIND } from "./PhysicalPathCompiler";
import { classifyRailCell, compilePhysicalRail } from "./PhysicalRailCompiler";

describe("PhysicalRailCompiler", () => {
	it("classifies catalog-compatible straight, left/right curve and junction cells", () => {
		expect(classifyRailCell({ incoming: DIR_W, outgoing: DIR_E })).toBe("LINEAR");
		expect(classifyRailCell({ incoming: DIR_W, outgoing: DIR_S })).toBe("RIGHT_CURVE");
		expect(classifyRailCell({ incoming: DIR_N, outgoing: DIR_E })).toBe("LEFT_CURVE");
		expect(classifyRailCell({ incoming: DIR_W, outgoing: DIR_E | DIR_N })).toBe("BRANCH");
		expect(classifyRailCell({ incoming: DIR_W | DIR_S, outgoing: DIR_E })).toBe("MERGE");
		expect(classifyRailCell({ incoming: DIR_N | DIR_S, outgoing: DIR_W })).toBe("INVALID");
		expect(classifyRailCell({ incoming: DIR_E, outgoing: DIR_N | DIR_S })).toBe("INVALID");
	});

	it("splits straight runs into LINEAR pieces no longer than 5 m", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 }));
		const layout = compilePhysicalRail(document.map);
		const linears = layout.pieces.filter((piece) => piece.type === "LINEAR");
		expect(linears.map((piece) => piece.lengthMeters)).toEqual([5, 5, 2]);
		expect(linears.every((piece) => piece.lengthMeters <= 5)).toBe(true);
		expect(layout.valid).toBe(true);
		expect(layout.diagnostics).toEqual([]);
		expect(layout.paths.revision).toBe(layout.revision);
		expect(layout.paths.pathCount).toBeGreaterThan(0);
	});

	it("stamps a caller-owned logical revision onto the layout and physical paths", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 }));

		const layout = compilePhysicalRail(document.map, 4_096);

		expect(layout.revision).toBe(4_096);
		expect(layout.paths.revision).toBe(4_096);
	});

	it("emits explicit diagnostics for invalid cells and broken reciprocal ports", () => {
		const document = new RailDocument();
		document.map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_N | DIR_S, outgoing: DIR_W }));
		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(false);
		expect(layout.diagnostics.some((item) => item.code === "INVALID_CELL")).toBe(true);
		expect(layout.diagnostics.some((item) => item.code === "BROKEN_RECIPROCITY")).toBe(true);
	});

	it("rejects reciprocal-looking cells whose incoming and outgoing occupy the same side", () => {
		const document = new RailDocument();
		document.map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_E, outgoing: DIR_E }));
		document.map.setEncoded(1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_W }));

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(false);
		expect(layout.diagnostics.filter((item) => item.code === "INVALID_CELL")).toHaveLength(2);
		expect(layout.diagnostics.some((item) => item.code === "BROKEN_RECIPROCITY")).toBe(false);
		expect([...layout.paths.kinds]).toEqual([5, 5]);
	});

	it("compiles a tangent turnout with exact catalog profile, pieces and worker footprint", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: -3, y: 0 }));
		document.commit(planRailConstruction(document.map, { x: 0, y: 3 }, { x: 0, y: 0 }));
		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(true);
		const junction = layout.junctions.find((item) => item.type === "MERGE");
		expect(junction).toMatchObject({
			type: "MERGE",
			through: { incoming: DIR_E, outgoing: DIR_W },
			divergingSide: DIR_S,
			tangentSide: DIR_W,
			profileId: "OPENFAB_MERGE_L400_R500_L400_V1",
			leadInMillimeters: 400,
			leadOutMillimeters: 400,
			radiusMillimeters: 500,
			footprintCells: [
				{ x: 0, y: 1 },
				{ x: 0, y: 0 },
				{ x: -1, y: 0 },
			],
		});
		expect(junction?.trunkPathIndex).toBeGreaterThanOrEqual(0);
		expect(junction?.divergePathIndex).toBeGreaterThanOrEqual(0);

		const trunk = layout.pieces.find((piece) => piece.role === "TURNOUT_TRUNK");
		const diverge = layout.pieces.find((piece) => piece.role === "TURNOUT_DIVERGE");
		expect(trunk).toMatchObject({
			type: "LINEAR",
			cells: [
				{ x: 0, y: 0 },
				{ x: -1, y: 0 },
			],
		});
		expect(trunk?.lengthMeters).toBeCloseTo(1.4, 6);
		expect(diverge?.lengthMeters).toBeCloseTo(0.4 + Math.PI / 4 + 0.4, 6);
		expect(diverge?.radiusMillimeters).toBe(500);

		expect(layout.turnoutFootprints.count).toBe(1);
		expect([...layout.turnoutFootprints.kinds]).toEqual([TURNOUT_KIND.MERGE]);
		expect([...layout.turnoutFootprints.anchors]).toEqual([0, 0]);
		expect([...layout.turnoutFootprints.leadInMillimeters]).toEqual([400]);
		expect([...layout.turnoutFootprints.leadOutMillimeters]).toEqual([400]);
		expect([...layout.turnoutFootprints.radiusMillimeters]).toEqual([500]);
		expect([...layout.turnoutFootprints.reservedOffsets]).toEqual([0, 3]);
		expect([...layout.turnoutFootprints.reservedCells]).toEqual([0, 1, 0, 0, -1, 0]);
		expect([...layout.turnoutFootprints.pathOffsets]).toEqual([0, 2]);
		expect([...layout.turnoutFootprints.pathIndices]).toEqual([
			junction?.trunkPathIndex,
			junction?.divergePathIndex,
		]);
		expect([...layout.turnoutFootprints.clearancePathOffsets]).toEqual([0, 5]);
		expect(layout.turnoutFootprints.clearancePathIndices).toHaveLength(5);
		expect(layout.turnoutFootprints.clearancePathStarts).toHaveLength(5);
		expect(layout.turnoutFootprints.clearancePathEnds).toHaveLength(5);
		for (let row = 0; row < layout.turnoutFootprints.clearancePathIndices.length; row++) {
			const pathIndex = layout.turnoutFootprints.clearancePathIndices[row] as number;
			expect(pathIndex).toBeLessThan(layout.paths.pathCount);
			expect(layout.turnoutFootprints.clearancePathStarts[row]).toBeGreaterThanOrEqual(0);
			expect(layout.turnoutFootprints.clearancePathEnds[row]).toBeLessThanOrEqual(
				layout.paths.lengths[pathIndex] as number,
			);
		}
		expect(layout.turnoutFootprints.bounds).toHaveLength(4);
	});

	it("diagnoses a turnout whose physical support cells were injected without the planner", () => {
		const document = new RailDocument();
		document.map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E | DIR_S }));

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(false);
		expect(layout.diagnostics.some((item) => item.code === "MISSING_TURNOUT_LEAD")).toBe(true);
		expect(
			layout.diagnostics.find((item) => item.code === "MISSING_TURNOUT_LEAD")?.cells,
		).toHaveLength(2);
	});

	it("keeps turnout CSR offsets deterministic for empty and multi-turnout layouts", () => {
		const empty = compilePhysicalRail(new RailDocument().map).turnoutFootprints;
		expect(empty.count).toBe(0);
		expect([...empty.reservedOffsets]).toEqual([0]);
		expect([...empty.pathOffsets]).toEqual([0]);
		expect([...empty.clearancePathOffsets]).toEqual([0]);

		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 2 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 8, y: 0 }, { x: 8, y: 2 })),
		).toBe(true);

		const layout = compilePhysicalRail(document.map);
		const footprints = layout.turnoutFootprints;
		expect(layout.valid).toBe(true);
		expect(footprints.count).toBe(2);
		expect([...footprints.reservedOffsets]).toEqual([0, 3, 6]);
		expect([...footprints.pathOffsets]).toEqual([0, 2, 4]);
		expect([...footprints.clearancePathOffsets]).toEqual([0, 5, 10]);
		expect([...footprints.pathIndices].every((index) => index < layout.paths.pathCount)).toBe(true);
		expect([...compilePhysicalRail(document.map).turnoutFootprints.pathIndices]).toEqual([
			...footprints.pathIndices,
		]);
	});

	it("combines adjacent equal turns into a CCW 180-degree piece", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 }));
		document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 1 }));
		document.commit(planRailConstruction(document.map, { x: 3, y: 1 }, { x: 0, y: 1 }));
		const layout = compilePhysicalRail(document.map);
		const compound = layout.pieces.find((piece) => piece.type === "CCW_CURVE");
		expect(layout.counts.CCW_CURVE).toBe(1);
		expect(compound?.radiusMillimeters).toBe(500);
		expect(compound?.fitKind).toBe("MAP_EXACT");
		expect(compound?.geometryKind).toBe("OPENFAB_PARAMETRIC");
		expect(compound?.nominalProfileId).toBe("OPENFAB_CCW_R500_A180_L500_V1");
		expect(compound?.lengthMeters).toBeCloseTo(1 + Math.PI / 2, 6);
		expect(compound?.nominalLengthMeters).toBeCloseTo(2.571, 3);
		expect([...layout.paths.kinds]).toContain(PATH_KIND.COMPOUND_CCW);
		expect(layout.compoundProfiles.count).toBe(1);
	});

	it("combines opposite adjacent turns into an S curve", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 }));
		document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 1 }));
		document.commit(planRailConstruction(document.map, { x: 3, y: 1 }, { x: 6, y: 1 }));
		const layout = compilePhysicalRail(document.map);
		const compound = layout.pieces.find((piece) => piece.type === "S_CURVE");
		expect(layout.counts.S_CURVE).toBe(1);
		expect(compound?.radiusMillimeters).toBe(500);
		expect(compound?.rotationDegrees).toBe(90);
		expect(compound?.fitKind).toBe("MAP_EXACT");
		expect(compound?.geometryKind).toBe("OPENFAB_PARAMETRIC");
		expect(compound?.nominalProfileId).toBe("OPENFAB_S_R500_A90_L500_V1");
		expect(compound?.nominalLengthMeters).toBe(2.571);
		expect(compound?.forwardFitDeltaMillimeters).toBe(0);
		expect(compound?.lateralFitDeltaMillimeters).toBe(0);
		expect(compound?.lengthResidualMillimeters).toBe(0);
		expect([...layout.paths.kinds]).toContain(PATH_KIND.COMPOUND_S);
		expect(layout.pathIntervalRemap.count).toBeGreaterThan(layout.paths.pathCount);
	});

	it("does not expose nominal catalog metadata when a compound falls back to baseline", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		expect(
			document.commit(
				planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact"),
			),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: -3 })),
		).toBe(true);

		const compound = compilePhysicalRail(document.map).pieces.find(
			(piece) => piece.type === "S_CURVE",
		);

		expect(compound).toMatchObject({
			geometryKind: "BASELINE_STITCHED",
			fitKind: "NOT_APPLICABLE",
			radiusMillimeters: null,
		});
		expect(compound?.nominalProfileId).toBeUndefined();
		expect(compound?.nominalLengthMeters).toBeUndefined();
		expect(compound?.lengthResidualMillimeters).toBeUndefined();
		expect(compound?.forwardFitDeltaMillimeters).toBeUndefined();
		expect(compound?.lateralFitDeltaMillimeters).toBeUndefined();
	});

	it("omits a linear piece when adjacent compounds fully consume their shared support", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		expect(
			document.commit(
				planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact"),
			),
		).toBe(true);
		expect(
			document.commit(
				planRailModule(document.map, { x: 2, y: 1 }, { x: 2, y: 4 }, "shift", "compact"),
			),
		).toBe(true);

		const layout = compilePhysicalRail(document.map);

		expect(layout.compoundProfiles.count).toBe(2);
		expect(
			layout.pieces.some(
				(piece) =>
					piece.type === "LINEAR" &&
					piece.cells.some((cell) => cellKey(cell.x, cell.y) === cellKey(2, 1)),
			),
		).toBe(false);
	});

	it.each([
		[
			"east-south-west",
			[
				{ x: 0, y: 0 },
				{ x: 3, y: 0 },
				{ x: 3, y: 1 },
				{ x: 0, y: 1 },
			],
		],
		[
			"west-north-east",
			[
				{ x: 3, y: 1 },
				{ x: 0, y: 1 },
				{ x: 0, y: 0 },
				{ x: 3, y: 0 },
			],
		],
		[
			"south-west-north",
			[
				{ x: 1, y: 0 },
				{ x: 1, y: 3 },
				{ x: 0, y: 3 },
				{ x: 0, y: 0 },
			],
		],
		[
			"north-east-south",
			[
				{ x: 0, y: 3 },
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 1, y: 3 },
			],
		],
	])("recognizes a directed CCW pair in %s flow", (_name, points) => {
		const document = new RailDocument();
		commitPolyline(document, points);

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(true);
		expect(layout.counts.CCW_CURVE).toBe(1);
		expect(layout.counts.LEFT_CURVE + layout.counts.RIGHT_CURVE).toBe(0);
		const compound = layout.pieces.find((piece) => piece.type === "CCW_CURVE");
		expect(compound?.from).toEqual(points[1]);
		expect(compound?.to).toEqual(points[2]);
		expect(compound?.cells).toEqual([points[1], points[2]]);
		expect(compound?.id).toBe(`CCW_CURVE:${cellKey(points[1]?.x ?? 0, points[1]?.y ?? 0)}`);
	});

	it("recognizes an S pair when coordinate order is opposite to vehicle flow", () => {
		const document = new RailDocument();
		commitPolyline(document, [
			{ x: 6, y: 1 },
			{ x: 3, y: 1 },
			{ x: 3, y: 0 },
			{ x: 0, y: 0 },
		]);

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(true);
		expect(layout.counts.S_CURVE).toBe(1);
		expect(layout.counts.LEFT_CURVE + layout.counts.RIGHT_CURVE).toBe(0);
		expect(layout.pieces.find((piece) => piece.type === "S_CURVE")).toMatchObject({
			from: { x: 3, y: 1 },
			to: { x: 3, y: 0 },
			cells: [
				{ x: 3, y: 1 },
				{ x: 3, y: 0 },
			],
		});
	});

	it("compiles curve-straight-curve equal turns as one CSC HOMO piece", () => {
		const document = new RailDocument();
		commitPolyline(document, [
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 3, y: 2 },
			{ x: 0, y: 2 },
		]);

		const layout = compilePhysicalRail(document.map);
		const compound = layout.pieces.find((piece) => piece.type === "CSC_CURVE_HOMO");
		expect(layout.valid).toBe(true);
		expect(layout.counts.CSC_CURVE_HOMO).toBe(1);
		expect(compound?.cells).toEqual([
			{ x: 3, y: 0 },
			{ x: 3, y: 1 },
			{ x: 3, y: 2 },
		]);
		expect(compound?.lengthMeters).toBeCloseTo(2 + Math.PI / 2, 6);
		expect(compound).toMatchObject({
			fitKind: "MAP_EXACT",
			radiusMillimeters: 500,
			rotationDegrees: 90,
			leadInMillimeters: 500,
			leadOutMillimeters: 500,
			middleMillimeters: 1_000,
		});
		expect([...layout.paths.kinds]).toContain(PATH_KIND.COMPOUND_CSC_HOMO);
		expect(
			layout.pieces.some(
				(piece) =>
					piece.type === "LINEAR" &&
					piece.cells.some((cell) => cellKey(cell.x, cell.y) === cellKey(3, 1)),
			),
		).toBe(false);
	});

	it("compiles curve-straight-curve opposite turns as one CSC HETE piece", () => {
		const document = new RailDocument();
		commitPolyline(document, [
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 3, y: 2 },
			{ x: 6, y: 2 },
		]);

		const layout = compilePhysicalRail(document.map);
		const compound = layout.pieces.find((piece) => piece.type === "CSC_CURVE_HETE");
		expect(layout.valid).toBe(true);
		expect(layout.counts.CSC_CURVE_HETE).toBe(1);
		expect(compound?.cells).toEqual([
			{ x: 3, y: 0 },
			{ x: 3, y: 1 },
			{ x: 3, y: 2 },
		]);
		expect(compound?.lengthMeters).toBeCloseTo(2 + Math.PI / 2, 6);
		expect(compound).toMatchObject({
			fitKind: "MAP_EXACT",
			radiusMillimeters: 500,
			rotationDegrees: 90,
			leadInMillimeters: 500,
			leadOutMillimeters: 500,
			middleMillimeters: 1_000,
		});
		expect([...layout.paths.kinds]).toContain(PATH_KIND.COMPOUND_CSC_HETE);
	});

	it("remaps turnout path indices after an earlier compound path is stitched", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		expect(
			document.commit(
				planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "wide"),
			),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 2, y: 2 }, { x: 10, y: 2 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 6, y: 2 }, { x: 6, y: 4 })),
		).toBe(true);

		const layout = compilePhysicalRail(document.map);
		const junction = layout.junctions[0];
		expect(layout.valid).toBe(true);
		expect(layout.counts.CSC_CURVE_HETE).toBe(1);
		expect(junction?.trunkPathIndex).toBeGreaterThanOrEqual(0);
		expect(junction?.divergePathIndex).toBeGreaterThanOrEqual(0);
		expect(layout.paths.kinds[junction?.trunkPathIndex ?? -1]).toBe(PATH_KIND.TURNOUT_TRUNK);
		expect(layout.paths.kinds[junction?.divergePathIndex ?? -1]).toBe(PATH_KIND.TURNOUT_DIVERGE);
		expect([...layout.turnoutFootprints.pathIndices]).toEqual([
			junction?.trunkPathIndex,
			junction?.divergePathIndex,
		]);
	});

	it("owns only the exact compound endpoint when an abutting compound loses its support", () => {
		for (const fixture of [
			{
				kind: "BRANCH" as const,
				main: [
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
					{ x: 2, y: 0 },
					{ x: 3, y: 0 },
					{ x: 4, y: 0 },
					{ x: 4, y: 1 },
					{ x: 5, y: 1 },
					{ x: 6, y: 1 },
				],
				divergeStart: { x: 3, y: 0 },
				divergeEnd: { x: 3, y: -3 },
				expectedEdge: "start" as const,
			},
			{
				kind: "MERGE" as const,
				main: [
					{ x: 6, y: 1 },
					{ x: 5, y: 1 },
					{ x: 4, y: 1 },
					{ x: 4, y: 0 },
					{ x: 3, y: 0 },
					{ x: 2, y: 0 },
					{ x: 1, y: 0 },
					{ x: 0, y: 0 },
				],
				divergeStart: { x: 3, y: -3 },
				divergeEnd: { x: 3, y: 0 },
				expectedEdge: "end" as const,
			},
		]) {
			const document = new RailDocument();
			const main = planRailPath(document.map, fixture.main);
			expect(main.valid, main.reason).toBe(true);
			expect(document.commit(main)).toBe(true);
			const diverge = planRailConstruction(document.map, fixture.divergeStart, fixture.divergeEnd);
			expect(diverge.valid, diverge.reason).toBe(true);
			expect(document.commit(diverge)).toBe(true);

			const layout = compilePhysicalRail(document.map);
			expect(layout.junctions[0]?.type).toBe(fixture.kind);
			const compoundPathIndex = [...layout.paths.kinds].indexOf(PATH_KIND.COMPOUND_S);
			expect(compoundPathIndex).toBeGreaterThanOrEqual(0);
			const row = [...layout.turnoutFootprints.clearancePathIndices].indexOf(compoundPathIndex);
			expect(row).toBeGreaterThanOrEqual(0);
			const expectedStation =
				fixture.expectedEdge === "start" ? 0 : (layout.paths.lengths[compoundPathIndex] as number);
			expect(layout.turnoutFootprints.clearancePathStarts[row]).toBeCloseTo(expectedStation, 6);
			expect(layout.turnoutFootprints.clearancePathEnds[row]).toBeCloseTo(expectedStation, 6);
			expect(layout.clearance.issues.count).toBeGreaterThan(0);
		}
	});

	it("does not classify a curve-two-straights-curve path as strict CSC", () => {
		const document = new RailDocument();
		commitPolyline(document, [
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 3, y: 3 },
			{ x: 0, y: 3 },
		]);

		const layout = compilePhysicalRail(document.map);
		expect(layout.valid).toBe(true);
		expect(layout.counts.CSC_CURVE_HOMO).toBe(0);
		expect(layout.counts.CSC_CURVE_HETE).toBe(0);
		expect(layout.counts.LEFT_CURVE + layout.counts.RIGHT_CURVE).toBe(2);
	});
});

function commitPolyline(document: RailDocument, points: readonly Cell[]): void {
	for (let index = 0; index < points.length - 1; index++) {
		const plan = planRailConstruction(
			document.map,
			points[index] as Cell,
			points[index + 1] as Cell,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
	}
}
