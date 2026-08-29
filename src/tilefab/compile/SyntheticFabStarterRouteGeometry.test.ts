import { describe, expect, it } from "vitest";
import { compilePhysicalRailRuns } from "../render/PhysicalRailPresentation";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "./SyntheticFabStarter";
import { prepareSyntheticFabStarter } from "./SyntheticFabStarterPreview";
import {
	captureSyntheticFabStarterRouteGeometry,
	isSyntheticFabStarterRouteGeometry,
	SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES,
} from "./SyntheticFabStarterRouteGeometry";

describe("SyntheticFabStarterRouteGeometry", () => {
	it.each([
		50, 60, 100,
	])("captures the exact transferable physical routes for a %i Bay factory", (bayCount) => {
		const request = setSyntheticFabStarterParameter(
			defaultSyntheticFabStarterRequest("large-fab-60"),
			"bayCount",
			bayCount,
		);
		const build = buildSyntheticFabStarter(request);
		const geometry = captureSyntheticFabStarterRouteGeometry(
			build.physical.paths,
			build.physicalFingerprint,
			compilePhysicalRailRuns(build.physical.paths),
		);

		expect(isSyntheticFabStarterRouteGeometry(geometry, build.physicalFingerprint)).toBe(true);
		expect(geometry.pathCount).toBe(build.physical.paths.pathCount);
		expect(geometry.pointCount).toBe(build.physical.paths.pointCount);
		expect(geometry.positions).toEqual(build.physical.paths.positions);
		expect(geometry.offsets).toEqual(build.physical.paths.offsets);
		expect(geometry.kinds).toEqual(build.physical.paths.kinds);
		expect(geometry.runPathIndices).toHaveLength(geometry.pathCount);
		expect(new Set(geometry.runPathIndices).size).toBe(geometry.pathCount);
		expect(geometry.markers.length / 3).toBeLessThanOrEqual(28);
		const markerX: number[] = [];
		const markerY: number[] = [];
		for (let index = 0; index < geometry.markers.length; index += 3) {
			markerX.push(geometry.markers[index] as number);
			markerY.push(geometry.markers[index + 1] as number);
		}
		expect(Math.max(...markerX) - Math.min(...markerX)).toBeGreaterThanOrEqual(
			(geometry.bounds.maxX - geometry.bounds.minX) * 0.6,
		);
		expect(Math.max(...markerY) - Math.min(...markerY)).toBeGreaterThanOrEqual(
			(geometry.bounds.maxY - geometry.bounds.minY) * 0.6,
		);
		expect(geometry.byteLength).toBeLessThanOrEqual(SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES);
	}, 30_000);

	it("binds a large-FAB prepared payload to exact geometry instead of SVG path text", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));

		expect(prepared.geometry).toBeNull();
		expect(prepared.exactGeometry).not.toBeNull();
		expect(
			isSyntheticFabStarterRouteGeometry(prepared.exactGeometry, prepared.physicalFingerprint),
		).toBe(true);
	}, 30_000);

	it("survives a real structured-clone transfer and rejects detached or oversized backing views", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const geometry = prepared.exactGeometry;
		if (!geometry) throw new Error("expected exact large-FAB geometry");
		const transfers = collectTransferableBuffers(geometry);
		const transferBytes = transfers.reduce((total, buffer) => total + buffer.byteLength, 0);
		const delivered = structuredClone(geometry, { transfer: transfers });

		expect(transferBytes).toBe(geometry.byteLength);
		expect(delivered.byteLength).toBe(transferBytes);
		expect(isSyntheticFabStarterRouteGeometry(delivered, prepared.physicalFingerprint)).toBe(true);
		expect(geometry.positions.byteLength).toBe(0);

		const fresh = prepareSyntheticFabStarter(
			defaultSyntheticFabStarterRequest("large-fab-60"),
		).exactGeometry;
		if (!fresh) throw new Error("expected fresh exact geometry");
		const oversizedBuffer = new ArrayBuffer(fresh.positions.byteLength + 1_024);
		const oversizedPositions = new Float32Array(oversizedBuffer, 0, fresh.positions.length);
		oversizedPositions.set(fresh.positions);
		expect(isSyntheticFabStarterRouteGeometry({ ...fresh, positions: oversizedPositions })).toBe(
			false,
		);
	}, 30_000);

	it("rejects typed-array mutation even when scalar metadata is unchanged", () => {
		const prepared = prepareSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const geometry = prepared.exactGeometry;
		if (!geometry) throw new Error("expected exact large-FAB geometry");
		const positions = new Float32Array(geometry.positions);
		positions[0] = (positions[0] as number) + 1;

		expect(
			isSyntheticFabStarterRouteGeometry({ ...geometry, positions }, prepared.physicalFingerprint),
		).toBe(false);
	}, 30_000);
});
