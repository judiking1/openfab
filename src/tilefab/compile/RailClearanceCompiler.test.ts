import { describe, expect, it } from "vitest";
import { DIR_E, DIR_S, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalPaths } from "./PhysicalPathCompiler";
import { compileRailEnvelopes, RailEnvelopeSpatialIndex } from "./RailClearanceCompiler";
import { DEFAULT_RAIL_CLEARANCE_PROFILE } from "./RailClearanceProfile";

describe("RailClearanceCompiler", () => {
	it("derives one exact capsule segment from one linear physical path", () => {
		const map = new TileMap();
		map.setEncoded(-2, 3, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		const paths = compilePhysicalPaths(map);
		const envelopes = compileRailEnvelopes(paths);

		expect(paths.pathCount).toBe(1);
		expect(envelopes.profileId).toBe(DEFAULT_RAIL_CLEARANCE_PROFILE.id);
		expect(envelopes.profileVersion).toBe(DEFAULT_RAIL_CLEARANCE_PROFILE.version);
		expect(envelopes.count).toBe(1);
		expect(envelopes.pathOffsets).toEqual(new Uint32Array([0, 1]));
		expect(envelopes.pathIndices).toEqual(new Uint32Array([0]));
		expect(envelopes.pointIndices).toEqual(new Uint32Array([0]));
		expect(envelopes.stationStarts).toEqual(new Float32Array([0]));
		expect(envelopes.stationEnds[0]).toBeCloseTo(paths.lengths[0] as number, 6);
		expect(envelopes.startPoints).toEqual(paths.positions.slice(0, 2));
		expect(envelopes.endPoints).toEqual(paths.positions.slice(2, 4));
		expect(envelopes.beamRadiusMillimeters[0]).toBe(
			DEFAULT_RAIL_CLEARANCE_PROFILE.beamRadiusMillimeters,
		);
		expect(envelopes.ohtSweepRadiusMillimeters[0]).toBe(
			DEFAULT_RAIL_CLEARANCE_PROFILE.ohtSweepRadiusMillimeters,
		);
		expect(envelopes.installationRadiusMillimeters[0]).toBe(
			DEFAULT_RAIL_CLEARANCE_PROFILE.installationRadiusMillimeters,
		);
		const boundsRadius =
			(DEFAULT_RAIL_CLEARANCE_PROFILE.installationRadiusMillimeters +
				DEFAULT_RAIL_CLEARANCE_PROFILE.approximationToleranceMillimeters) /
			1_000;
		expect(envelopes.bounds[0]).toBeCloseTo(
			Math.min(paths.positions[0] as number, paths.positions[2] as number) - boundsRadius,
			6,
		);
		expect(envelopes.bounds[3]).toBeCloseTo(
			Math.max(paths.positions[1] as number, paths.positions[3] as number) + boundsRadius,
			6,
		);
	});

	it("uses every non-degenerate R500 sample segment in path order", () => {
		const map = new TileMap();
		map.setEncoded(-7, -11, encodeRailCell({ incoming: DIR_W, outgoing: DIR_S }));
		const paths = compilePhysicalPaths(map);
		const envelopes = compileRailEnvelopes(paths);

		expect(paths.pathCount).toBe(1);
		expect(paths.pointCount).toBeGreaterThan(2);
		expect(envelopes.count).toBe(paths.pointCount - 1);
		expect(envelopes.pathOffsets).toEqual(new Uint32Array([0, envelopes.count]));
		expect(envelopes.pointIndices).toEqual(
			new Uint32Array(Array.from({ length: envelopes.count }, (_, index) => index)),
		);
		for (let envelopeIndex = 1; envelopeIndex < envelopes.count; envelopeIndex++) {
			expect(envelopes.stationStarts[envelopeIndex]).toBeCloseTo(
				envelopes.stationEnds[envelopeIndex - 1] as number,
				6,
			);
		}
	});

	it("rejects non-finite or decreasing source geometry instead of hiding a broken path", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		const nonFiniteStations = compilePhysicalPaths(map);
		nonFiniteStations.distances[0] = Number.NaN;
		expect(() => compileRailEnvelopes(nonFiniteStations)).toThrow("non-finite clearance stations");

		const decreasingStations = compilePhysicalPaths(map);
		decreasingStations.distances[1] = -1;
		expect(() => compileRailEnvelopes(decreasingStations)).toThrow("decreasing clearance stations");

		const nonFiniteGeometry = compilePhysicalPaths(map);
		nonFiniteGeometry.positions[0] = Number.POSITIVE_INFINITY;
		expect(() => compileRailEnvelopes(nonFiniteGeometry)).toThrow("non-finite clearance geometry");

		const missingStationSpan = compilePhysicalPaths(map);
		missingStationSpan.distances[1] = 0;
		expect(() => compileRailEnvelopes(missingStationSpan)).toThrow(
			"nonzero geometry with zero clearance station span",
		);

		const missingGeometrySpan = compilePhysicalPaths(map);
		missingGeometrySpan.positions[2] = missingGeometrySpan.positions[0] as number;
		missingGeometrySpan.positions[3] = missingGeometrySpan.positions[1] as number;
		expect(() => compileRailEnvelopes(missingGeometrySpan)).toThrow(
			"zero geometry with a positive clearance station span",
		);
	});

	it("indexes 50k derived envelopes and keeps a local negative-coordinate query bounded", () => {
		const map = new TileMap();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (let index = 0; index < 50_000; index++) {
			map.setEncoded((index % 1_000) - 500, Math.floor(index / 1_000) * 2 - 50, straight);
		}
		const paths = compilePhysicalPaths(map);
		const compileStartedAt = Date.now();
		const envelopes = compileRailEnvelopes(paths);
		const spatial = new RailEnvelopeSpatialIndex(envelopes);
		const compileMilliseconds = Date.now() - compileStartedAt;
		const queryStartedAt = Date.now();
		const visible = spatial.query({ minX: -300, minY: -22, maxX: -240, maxY: -8 });
		const queryMilliseconds = Date.now() - queryStartedAt;

		expect(envelopes.count).toBe(50_000);
		expect(visible.length).toBeGreaterThan(0);
		expect(visible.length).toBeLessThan(envelopes.count / 20);
		expect(compileMilliseconds).toBeLessThan(1_000);
		expect(queryMilliseconds).toBeLessThan(50);
	});

	it("round-trips a prepared envelope index and rejects out-of-range references", () => {
		const map = new TileMap();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		for (const x of [-12, 0, 12]) map.setEncoded(x, 0, straight);
		const envelopes = compileRailEnvelopes(compilePhysicalPaths(map));
		const compiled = new RailEnvelopeSpatialIndex(envelopes);
		const hydrated = RailEnvelopeSpatialIndex.fromSnapshot(envelopes, compiled.captureSnapshot());
		const bounds = { minX: -2, minY: -2, maxX: 2, maxY: 2 };
		expect(hydrated.query(bounds)).toEqual(compiled.query(bounds));

		const snapshot = compiled.captureSnapshot();
		const indices = snapshot.envelopeIndices.slice();
		indices[0] = envelopes.count;
		expect(() =>
			RailEnvelopeSpatialIndex.fromSnapshot(envelopes, {
				...snapshot,
				envelopeIndices: indices,
			}),
		).toThrow("malformed");
	});
});
