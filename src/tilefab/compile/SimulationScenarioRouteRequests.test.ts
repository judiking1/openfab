import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "./SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "./SimulationReadinessTestFixture";
import {
	compileSimulationReplayHistoryManifest,
	compileSimulationTransferPlanManifest,
} from "./SimulationScenarioManifest";
import {
	compileSimulationScenarioRouteRequests,
	SIMULATION_SCENARIO_ROUTE_MISSING_RUNTIME_LAYERS,
	SimulationScenarioRouteCompilationCancelledError,
	simulationScenarioRouteRequestsError,
	simulationScenarioRouteRequestsMatchSources,
	simulationScenarioRouteRequestTransfers,
} from "./SimulationScenarioRouteRequests";

describe("SimulationScenarioRouteRequests", () => {
	it("publishes a valid non-runnable empty artifact for an accepted-empty manifest", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(0),
			records: [],
		});
		const requests = await compileSimulationScenarioRouteRequests(snapshot, manifest);

		expect(requests.requestCount).toBe(0);
		expect([...requests.routePathOffsets]).toEqual([0]);
		expect([...requests.corridorTrackResourceOffsets]).toEqual([0]);
		expect(simulationScenarioRouteRequestsError(requests)).toBeNull();
		expect(simulationScenarioRouteRequestsMatchSources(snapshot, manifest, requests)).toBe(true);
	});

	it("compiles deterministic directed corridors bound to the exact certificate and manifest", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(2),
			records: [transfer("T-LATE", 1, 20, 2, 1), transfer("T-EARLY", 0, 10, 1, 2)],
		});
		const first = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const second = await compileSimulationScenarioRouteRequests(snapshot, manifest);

		expect(first).toMatchObject({
			simulationRunnable: false,
			missingRuntimeLayers: SIMULATION_SCENARIO_ROUTE_MISSING_RUNTIME_LAYERS,
			sourceKind: "TRANSFER_PLAN",
			sourceManifestFingerprint: manifest.fingerprint,
			sourceCertificateFingerprint: snapshot.certificate.fingerprint,
			requestCount: 2,
		});
		expect([...first.sourceOrdinals]).toEqual([0, 1]);
		expect([...first.requestedAtMicroseconds]).toEqual([10, 20]);
		expect([...first.routePathOffsets]).toHaveLength(3);
		expect(first.routePathRows.length).toBeGreaterThanOrEqual(2);
		expect([...first.routeDistancesMeters].every((distance) => distance > 0)).toBe(true);
		expect(first.corridorTrackResourceRows.length).toBeGreaterThan(0);
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.runIdentityFingerprint).toBe(second.runIdentityFingerprint);
		expect(simulationScenarioRouteRequestsError(first)).toBeNull();
	});

	it("preserves separate source-kind run identity while sharing the route compiler", async () => {
		const snapshot = readySnapshot();
		const plan = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("ROW-1", 0, 10, 1, 2)],
		});
		const replay = compileSimulationReplayHistoryManifest({
			...header(1),
			records: [
				{
					historyEventId: "ROW-1",
					sourceOrdinal: 0,
					observedTimeMicroseconds: 10,
					loadId: "LOAD-0",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		});
		const planRoutes = await compileSimulationScenarioRouteRequests(snapshot, plan);
		const replayRoutes = await compileSimulationScenarioRouteRequests(snapshot, replay);

		expect([...planRoutes.routePathRows]).toEqual([...replayRoutes.routePathRows]);
		expect([...planRoutes.corridorTrackResourceRows]).toEqual([
			...replayRoutes.corridorTrackResourceRows,
		]);
		expect(planRoutes.runIdentityFingerprint).not.toBe(replayRoutes.runIdentityFingerprint);
		expect(planRoutes.sourceKind).toBe("TRANSFER_PLAN");
		expect(replayRoutes.sourceKind).toBe("REPLAY_HISTORY");
	});

	it("fails closed for a source port outside the certified station domain", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("FOREIGN", 0, 10, 99, 2)],
		});

		await expect(compileSimulationScenarioRouteRequests(snapshot, manifest)).rejects.toThrow(
			/outside the certificate/i,
		);
	});

	it("requires an explicit pickup role at the source station", async () => {
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(0, [
				{ portId: 1, transferCapability: "DROPOFF_ONLY" },
				{ portId: 2, transferCapability: "BIDIRECTIONAL" },
			]),
		);
		const manifest = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("ROLE", 0, 10, 1, 2)],
		});

		await expect(compileSimulationScenarioRouteRequests(snapshot, manifest)).rejects.toThrow(
			/explicit pickup capability/i,
		);
	});

	it("supports pre-abort and cooperative cancellation without publishing partial requests", async () => {
		const snapshot = readySnapshot();
		const [sourcePortId, destinationPortId] = routeRequiringGraphSearch(snapshot);
		const manifest = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("CANCEL", 0, 10, sourcePortId, destinationPortId)],
		});
		const preAborted = new AbortController();
		preAborted.abort();
		await expect(
			compileSimulationScenarioRouteRequests(snapshot, manifest, {
				signal: preAborted.signal,
			}),
		).rejects.toBeInstanceOf(SimulationScenarioRouteCompilationCancelledError);

		const inFlight = new AbortController();
		let yields = 0;
		await expect(
			compileSimulationScenarioRouteRequests(snapshot, manifest, {
				signal: inFlight.signal,
				checkpointVisitedPaths: 1,
				scheduler: {
					yield: () => {
						yields++;
						inFlight.abort();
						return Promise.resolve();
					},
				},
			}),
		).rejects.toBeInstanceOf(SimulationScenarioRouteCompilationCancelledError);
		expect(yields).toBe(1);
	});

	it("keeps repeated cached routes cooperatively cancellable between requests", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(2),
			records: [transfer("CACHE-1", 0, 10, 1, 2), transfer("CACHE-2", 1, 20, 1, 2)],
		});
		const controller = new AbortController();

		await expect(
			compileSimulationScenarioRouteRequests(snapshot, manifest, {
				signal: controller.signal,
				checkpointVisitedPaths: Number.MAX_SAFE_INTEGER,
				checkpointRequests: 1,
				scheduler: {
					yield: () => {
						controller.abort();
						return Promise.resolve();
					},
				},
			}),
		).rejects.toBeInstanceOf(SimulationScenarioRouteCompilationCancelledError);
	});

	it("detects post-compilation route-column mutation", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("T-1", 0, 10, 1, 2)],
		});
		const requests = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const before = requests.routePathRows[0] as number;
		requests.routePathRows[0] = (before + 1) % snapshot.foundation.paths.pathCount;

		expect(simulationScenarioRouteRequestsError(requests)).toMatch(/fingerprint/i);
	});

	it("rejects hidden fields that are outside the transferable run contract", async () => {
		const snapshot = readySnapshot();
		const manifest = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("STRICT-1", 0, 10, 1, 2)],
		});
		const requests = await compileSimulationScenarioRouteRequests(snapshot, manifest);

		expect(
			simulationScenarioRouteRequestsError({ ...requests, rawSourceRow: "must-not-cross" }),
		).toMatch(/unexpected fields/i);
	});

	it("survives structured cloning but matches only its exact reviewed sources", async () => {
		const snapshot = readySnapshot();
		const foreignSnapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(40),
		);
		const manifest = compileSimulationTransferPlanManifest({
			...header(1),
			records: [transfer("BOUND-1", 0, 10, 1, 2)],
		});
		const requests = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const transfers = simulationScenarioRouteRequestTransfers(requests);
		const transferred = structuredClone(requests, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationScenarioRouteRequestsError(transferred)).toBeNull();
		expect(simulationScenarioRouteRequestsMatchSources(snapshot, manifest, transferred)).toBe(true);
		expect(
			simulationScenarioRouteRequestsMatchSources(foreignSnapshot, manifest, transferred),
		).toBe(false);
	});
});

function readySnapshot() {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

function routeRequiringGraphSearch(snapshot: ReturnType<typeof readySnapshot>): [number, number] {
	const firstPath = snapshot.foundation.stations.finalPathIndices[0] as number;
	const secondPath = snapshot.foundation.stations.finalPathIndices[1] as number;
	const firstStation = snapshot.foundation.stations.finalPathStationsMeters[0] as number;
	const secondStation = snapshot.foundation.stations.finalPathStationsMeters[1] as number;
	if (firstPath !== secondPath || secondStation <= firstStation) return [1, 2];
	return [2, 1];
}

function header(inputRecordCount: number) {
	return {
		manifestId: "SCENARIO-ROUTES-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function transfer(
	transferId: string,
	sourceOrdinal: number,
	releaseTimeMicroseconds: number,
	sourcePortId: number,
	destinationPortId: number,
) {
	return {
		transferId,
		sourceOrdinal,
		releaseTimeMicroseconds,
		loadId: `LOAD-${sourceOrdinal}`,
		sourcePortId,
		destinationPortId,
	};
}
