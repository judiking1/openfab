import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import {
	DETERMINISTIC_SCENARIO_ROUTE_BOUNDARY_POLICY,
	DeterministicScenarioWorldPoseSampler,
} from "./DeterministicScenarioWorldPoseSampler";

describe("DeterministicScenarioWorldPoseSampler", () => {
	it("derives source, route, and destination poses from certified path geometry", async () => {
		const { snapshot, routes, sampler } = await samplerFixture();
		const sourceStationRow = routes.sourceStationRows[0] as number;
		const destinationStationRow = routes.destinationStationRows[0] as number;
		const source = sampler.sample(0, 0);
		const middle = sampler.sample(0, (routes.routeDistancesMeters[0] as number) / 2);
		const destination = sampler.sample(0, routes.routeDistancesMeters[0] as number);

		expect(sampler.routeBoundaryPolicy).toBe(DETERMINISTIC_SCENARIO_ROUTE_BOUNDARY_POLICY);
		expect(source).toMatchObject({
			requestRow: 0,
			sourcePortId: 2,
			destinationPortId: 1,
			pathRow: snapshot.foundation.stations.finalPathIndices[sourceStationRow],
			pathStationMeters: snapshot.foundation.stations.finalPathStationsMeters[sourceStationRow],
			anchorDistanceMeters: 0,
		});
		expect(destination).toMatchObject({
			pathRow: snapshot.foundation.stations.finalPathIndices[destinationStationRow],
			pathStationMeters:
				snapshot.foundation.stations.finalPathStationsMeters[destinationStationRow],
			anchorDistanceMeters: routes.routeDistancesMeters[0],
		});
		expect(middle.anchorDistanceMeters).toBeGreaterThan(0);
		expect(middle.anchorDistanceMeters).toBeLessThan(middle.routeDistanceMeters);
		for (const pose of [source, middle, destination]) {
			expect(Number.isFinite(pose.worldXMeters)).toBe(true);
			expect(Number.isFinite(pose.worldZMeters)).toBe(true);
			expect(Math.hypot(pose.tangentX, pose.tangentZ)).toBeCloseTo(1, 12);
			expect(pose.yawRadians).toBeCloseTo(Math.atan2(pose.tangentZ, pose.tangentX), 12);
		}
	});

	it("chooses the next directed path at an exact interior route boundary", async () => {
		const { snapshot, routes, sampler } = await samplerFixture();
		const pathStart = routes.routePathOffsets[0] as number;
		const pathEnd = routes.routePathOffsets[1] as number;
		expect(pathEnd - pathStart).toBeGreaterThan(1);
		const sourceStationRow = routes.sourceStationRows[0] as number;
		const firstPathRow = routes.routePathRows[pathStart] as number;
		const nextPathRow = routes.routePathRows[pathStart + 1] as number;
		const firstSegmentDistance =
			(snapshot.foundation.paths.lengths[firstPathRow] as number) -
			(snapshot.foundation.stations.finalPathStationsMeters[sourceStationRow] as number);

		const before = sampler.sample(0, firstSegmentDistance - 1e-4);
		const boundary = sampler.sample(0, firstSegmentDistance);

		expect(before.pathRow).toBe(firstPathRow);
		expect(boundary).toMatchObject({ pathRow: nextPathRow, pathStationMeters: 0 });
	});

	it("fails closed for stale sources, invalid rows, and anchors outside the route", async () => {
		const { routes, sampler } = await samplerFixture();
		const staleSnapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(100),
		);

		expect(() => new DeterministicScenarioWorldPoseSampler(staleSnapshot, routes)).toThrow(
			/world-pose snapshot/i,
		);
		expect(() => sampler.sample(-1, 0)).toThrow(/outside the prepared scenario/i);
		expect(() => sampler.sample(1, 0)).toThrow(/outside the prepared scenario/i);
		expect(() => sampler.sample(0, -1)).toThrow(/within its route/i);
		expect(() => sampler.sample(0, (routes.routeDistancesMeters[0] as number) + 1)).toThrow(
			/within its route/i,
		);
		expect(() => sampler.sample(0, Number.NaN)).toThrow(/within its route/i);
	});
});

async function samplerFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	);
	const records: readonly SimulationTransferPlanRecord[] = [
		{
			transferId: "WORLD-POSE-1",
			sourceOrdinal: 0,
			releaseTimeMicroseconds: 10,
			loadId: "LOAD-WORLD-POSE",
			sourcePortId: 2,
			destinationPortId: 1,
		},
	];
	const manifest = compileSimulationTransferPlanManifest({
		manifestId: "WORLD-POSE-SAMPLER-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: records.length,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records,
	});
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	return {
		snapshot,
		routes,
		sampler: new DeterministicScenarioWorldPoseSampler(snapshot, routes),
	};
}
