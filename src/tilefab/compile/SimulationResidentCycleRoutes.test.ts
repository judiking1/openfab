import { describe, expect, it } from "vitest";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import {
	buildSimulationReadinessTestComponentsWithEqPorts,
	buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts,
} from "./SimulationReadinessTestFixture";
import {
	checksumSimulationResidentCycleRoutes,
	compileSimulationResidentCycleRoutes,
	SIMULATION_RESIDENT_CYCLE_LEG_POLICY,
	SIMULATION_RESIDENT_CYCLE_MAX_TYPED_BYTES,
	SIMULATION_RESIDENT_CYCLE_ROUTE_MISSING_SAFETY_LAYERS,
	SIMULATION_RESIDENT_CYCLE_ROUTES_SCHEMA_VERSION,
	SimulationResidentCycleRouteCompilationCancelledError,
	simulationResidentCycleRoutesError,
	simulationResidentCycleRoutesMatchSources,
	simulationResidentCycleRouteTransfers,
} from "./SimulationResidentCycleRoutes";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import {
	compileSimulationResidentReplayHistoryManifest,
	compileSimulationResidentTransferPlanManifest,
} from "./SimulationResidentScenarioManifest";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";
import { compileSimulationStationOperationalCapabilities } from "./SimulationStationOperationalCapabilities";

describe("SimulationResidentCycleRoutes", () => {
	it("publishes a valid empty artifact without inventing a resident vehicle", async () => {
		const fixture = residentFixture([]);
		const manifest = compileSimulationResidentTransferPlanManifest(fixture.operational, {
			...manifestHeader(0),
			records: [],
		});
		const routes = await compileRoutes(fixture, manifest);

		expect(routes.requestCount).toBe(0);
		expect([...routes.legPathOffsets]).toEqual([0]);
		expect([...routes.legCorridorTrackResourceOffsets]).toEqual([0]);
		expect([...routes.cycleCorridorTrackResourceOffsets]).toEqual([0]);
		expect(simulationResidentCycleRoutesError(routes)).toBeNull();
	});

	it("compiles a deterministic non-runnable home-pickup-dropoff-home corridor", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const manifest = residentManifest(fixture.operational, "OHT-001", 2, 4);
		const first = await compileRoutes(fixture, manifest);
		const second = await compileRoutes(fixture, manifest);

		expect(first).toMatchObject({
			schemaVersion: SIMULATION_RESIDENT_CYCLE_ROUTES_SCHEMA_VERSION,
			simulationRunnable: false,
			missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_ROUTE_MISSING_SAFETY_LAYERS,
			cycleLegPolicy: SIMULATION_RESIDENT_CYCLE_LEG_POLICY,
			ownerHomeBoundaryProven: true,
			foreignHomeNonInterferenceProven: true,
			requestCount: 1,
		});
		expect(first.legDistancesMeters).toHaveLength(3);
		expect([...first.legDistancesMeters].every((distance) => distance > 0)).toBe(true);
		expect(first.legPathOffsets).toHaveLength(4);
		expect(first.cycleCorridorTrackResourceRows.length).toBeGreaterThan(0);
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(simulationResidentCycleRoutesError(first)).toBeNull();
		expect(checksumSimulationResidentCycleRoutes(first)).toBe(first.fingerprint);
		expect(await matches(fixture, manifest, first)).toBe(true);
	});

	it("rejects a complete cycle that intersects another resident home", async () => {
		const fixture = residentFixture([
			{ slotId: 1, vehicleId: "OHT-001", portId: 1 },
			{ slotId: 2, vehicleId: "OHT-002", portId: 5 },
		]);
		const manifest = residentManifest(fixture.operational, "OHT-001", 2, 4);

		await expect(compileRoutes(fixture, manifest)).rejects.toThrow(/foreign home slot/i);
	});

	it("rejects revisiting the owner home footprint during the service leg", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const manifest = residentManifest(fixture.operational, "OHT-001", 3, 2);

		await expect(compileRoutes(fixture, manifest)).rejects.toThrow(
			/revisits its home footprint outside/i,
		);
	});

	it("keeps Plan and Replay cycle identity separate over equal physical legs", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const plan = residentManifest(fixture.operational, "OHT-001", 2, 4);
		const replay = compileSimulationResidentReplayHistoryManifest(fixture.operational, {
			...manifestHeader(1),
			records: [
				{
					historyEventId: "TRANSFER-1",
					sourceOrdinal: 0,
					observedTimeMicroseconds: 10,
					loadId: "LOAD-1",
					vehicleId: "OHT-001",
					sourcePortId: 2,
					destinationPortId: 4,
				},
			],
		});
		const planRoutes = await compileRoutes(fixture, plan);
		const replayRoutes = await compileSimulationResidentCycleRoutes(
			fixture.components.foundation,
			fixture.components.trackResources,
			fixture.components.occupancyPolicy,
			fixture.components.stationCapabilities,
			replay,
			fixture.parking,
		);

		expect([...planRoutes.legPathRows]).toEqual([...replayRoutes.legPathRows]);
		expect(planRoutes.sourceKind).toBe("TRANSFER_PLAN");
		expect(replayRoutes.sourceKind).toBe("REPLAY_HISTORY");
		expect(planRoutes.fingerprint).not.toBe(replayRoutes.fingerprint);
	});

	it("requires explicit pickup/dropoff capabilities and a distinct home port", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const pickupDenied = compileSimulationStationOperationalCapabilities(
			fixture.components.foundation,
			[...fixture.components.foundation.stations.ids].map((portId) => ({
				portId,
				transferCapability: portId === 2 ? ("DROPOFF_ONLY" as const) : ("BIDIRECTIONAL" as const),
			})),
		);
		const manifest = residentManifest(fixture.operational, "OHT-001", 2, 4);

		await expect(
			compileSimulationResidentCycleRoutes(
				fixture.components.foundation,
				fixture.components.trackResources,
				fixture.components.occupancyPolicy,
				pickupDenied,
				manifest,
				fixture.parking,
			),
		).rejects.toThrow(/explicit pickup capability/i);
		await expect(
			compileRoutes(fixture, residentManifest(fixture.operational, "OHT-001", 1, 4)),
		).rejects.toThrow(/home port distinct/i);
	});

	it("supports cancellation without publishing a partial artifact", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const manifest = residentManifest(fixture.operational, "OHT-001", 2, 4);
		const controller = new AbortController();
		controller.abort();

		await expect(
			compileSimulationResidentCycleRoutes(
				fixture.components.foundation,
				fixture.components.trackResources,
				fixture.components.occupancyPolicy,
				fixture.components.stationCapabilities,
				manifest,
				fixture.parking,
				{ signal: controller.signal },
			),
		).rejects.toBeInstanceOf(SimulationResidentCycleRouteCompilationCancelledError);
	});

	it("rejects mutation and hidden fields and transfers every typed column once", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const manifest = residentManifest(fixture.operational, "OHT-001", 2, 4);
		const routes = await compileRoutes(fixture, manifest);

		expect(simulationResidentCycleRoutesError({ ...routes, rawRouteRow: "private" })).toMatch(
			/unexpected fields/i,
		);
		routes.legDistancesMeters[0] = (routes.legDistancesMeters[0] as number) + 1;
		expect(simulationResidentCycleRoutesError(routes)).toMatch(/fingerprint/i);

		const transferable = await compileRoutes(fixture, manifest);
		const transfers = simulationResidentCycleRouteTransfers(transferable);
		const transferred = structuredClone(transferable, { transfer: [...transfers] });
		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationResidentCycleRoutesError(transferred)).toBeNull();
		expect(await matches(fixture, manifest, transferred)).toBe(true);
	});

	it("does not adopt routes across exact static or resident source drift", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const manifest = residentManifest(fixture.operational, "OHT-001", 2, 4);
		const routes = await compileRoutes(fixture, manifest);
		const foreignComponents = buildSimulationReadinessTestComponentsWithEqPorts(40);
		const foreignManifest = compileSimulationResidentTransferPlanManifest(
			reviewOperationalConfiguration(
				{ ...fixture.operational, review: null },
				{
					revision: fixture.components.foundation.source.revision + 1,
					authoredChecksum: fixture.components.foundation.source.authoredChecksum,
				},
			),
			manifestInput("OHT-001", 2, 4),
		);

		expect(
			await simulationResidentCycleRoutesMatchSources(
				foreignComponents.foundation,
				foreignComponents.trackResources,
				foreignComponents.occupancyPolicy,
				foreignComponents.stationCapabilities,
				manifest,
				fixture.parking,
				routes,
			),
		).toBe(false);
		expect(await matches(fixture, foreignManifest, routes)).toBe(false);
	});

	it("retains the exact 100,000-request public boundary inside the typed-memory cap", async () => {
		const fixture = residentFixture([{ slotId: 1, vehicleId: "OHT-001", portId: 1 }]);
		const manifest = compileSimulationResidentTransferPlanManifest(fixture.operational, {
			...manifestHeader(SIMULATION_SCENARIO_MAX_INPUT_RECORDS),
			records: Array.from({ length: SIMULATION_SCENARIO_MAX_INPUT_RECORDS }, (_, row) => ({
				transferId: `TRANSFER-${row}`,
				sourceOrdinal: row,
				releaseTimeMicroseconds: row,
				loadId: `LOAD-${row}`,
				vehicleId: "OHT-001",
				sourcePortId: 2,
				destinationPortId: 4,
			})),
		});
		const routes = await compileRoutes(fixture, manifest);

		expect(routes.requestCount).toBe(SIMULATION_SCENARIO_MAX_INPUT_RECORDS);
		expect(routes.byteLength).toBe(69_200_012);
		expect(routes.byteLength).toBeLessThan(SIMULATION_RESIDENT_CYCLE_MAX_TYPED_BYTES);
		expect(simulationResidentCycleRoutesError(routes)).toBeNull();
	});
});

function residentFixture(
	slots: readonly {
		readonly slotId: number;
		readonly vehicleId: string;
		readonly portId: number;
	}[],
) {
	const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: Math.max(0, ...slots.map((slot) => slot.slotId)) + 1,
			residentHomeSlots: slots.map((slot) => ({
				id: slot.slotId,
				vehicleId: slot.vehicleId,
				anchorPortId: slot.portId,
				policy: "DEDICATED_HOME_RETURN" as const,
			})),
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
	const parking = compileSimulationResidentFleetParkingConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		operational,
	);
	return { components, operational, parking };
}

function residentManifest(
	operational: ReturnType<typeof reviewOperationalConfiguration>,
	vehicleId: string,
	pickupPortId: number,
	dropoffPortId: number,
) {
	return compileSimulationResidentTransferPlanManifest(
		operational,
		manifestInput(vehicleId, pickupPortId, dropoffPortId),
	);
}

function manifestInput(vehicleId: string, pickupPortId: number, dropoffPortId: number) {
	return {
		...manifestHeader(1),
		records: [
			{
				transferId: "TRANSFER-1",
				sourceOrdinal: 0,
				releaseTimeMicroseconds: 10,
				loadId: "LOAD-1",
				vehicleId,
				sourcePortId: pickupPortId,
				destinationPortId: dropoffPortId,
			},
		],
	};
}

function manifestHeader(inputRecordCount: number) {
	return {
		manifestId: "RESIDENT-CYCLE-1",
		adapterId: "OPENFAB_RESIDENT_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function compileRoutes(
	fixture: ReturnType<typeof residentFixture>,
	manifest: ReturnType<typeof residentManifest>,
) {
	return compileSimulationResidentCycleRoutes(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.components.stationCapabilities,
		manifest,
		fixture.parking,
	);
}

function matches(
	fixture: ReturnType<typeof residentFixture>,
	manifest: ReturnType<typeof residentManifest>,
	routes: Awaited<ReturnType<typeof compileRoutes>>,
) {
	return simulationResidentCycleRoutesMatchSources(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.components.stationCapabilities,
		manifest,
		fixture.parking,
		routes,
	);
}
