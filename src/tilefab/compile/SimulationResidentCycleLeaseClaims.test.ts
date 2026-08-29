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
	checksumSimulationResidentCycleLeaseClaims,
	compileSimulationResidentCycleLeaseClaims,
	SIMULATION_RESIDENT_CYCLE_ACQUISITION_POLICY,
	SIMULATION_RESIDENT_CYCLE_LEASE_CLAIMS_SCHEMA_VERSION,
	SIMULATION_RESIDENT_CYCLE_LEASE_MAX_TYPED_BYTES,
	SIMULATION_RESIDENT_CYCLE_LEASE_MISSING_SAFETY_LAYERS,
	SIMULATION_RESIDENT_CYCLE_LEASE_SCOPE,
	simulationResidentCycleLeaseClaimsError,
	simulationResidentCycleLeaseClaimsMatchSources,
	simulationResidentCycleLeaseClaimTransfers,
} from "./SimulationResidentCycleLeaseClaims";
import { compileSimulationResidentCycleRoutes } from "./SimulationResidentCycleRoutes";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import { compileSimulationResidentTransferPlanManifest } from "./SimulationResidentScenarioManifest";
import { SIMULATION_SCENARIO_MAX_INPUT_RECORDS } from "./SimulationScenarioManifest";

describe("SimulationResidentCycleLeaseClaims", () => {
	it("publishes a valid non-runnable empty atomic-cycle contract", async () => {
		const fixture = await residentFixture(0);
		const claims = compileClaims(fixture);

		expect(claims).toMatchObject({
			schemaVersion: SIMULATION_RESIDENT_CYCLE_LEASE_CLAIMS_SCHEMA_VERSION,
			simulationRunnable: false,
			missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_LEASE_MISSING_SAFETY_LAYERS,
			leaseScope: SIMULATION_RESIDENT_CYCLE_LEASE_SCOPE,
			acquisitionPolicy: SIMULATION_RESIDENT_CYCLE_ACQUISITION_POLICY,
			partialAcquisitionAllowed: false,
			waitingCycleMayHoldNonHomeResources: false,
			dedicatedHomeHeldThroughoutCycle: true,
			completeCycleBundleAcquiredAtomically: true,
			requestCount: 0,
		});
		expect([...claims.nonHomeTrackResourceOffsets]).toEqual([0]);
		expect([...claims.movementClaimOffsets]).toEqual([0]);
		expect([...claims.switchConflictClaimOffsets]).toEqual([0]);
		expect(simulationResidentCycleLeaseClaimsError(claims)).toBeNull();
	});

	it("subtracts the owned home footprint and atomically claims the remaining full cycle", async () => {
		const fixture = await residentFixture(1);
		const claims = compileClaims(fixture);
		const cycleRows = csrRows(
			fixture.routes.cycleCorridorTrackResourceOffsets,
			fixture.routes.cycleCorridorTrackResourceRows,
			0,
		);
		const homeRows = new Set(
			csrRows(
				fixture.parking.footprintTrackResourceOffsets,
				fixture.parking.footprintTrackResourceRows,
				0,
			),
		);
		const nonHomeRows = csrRows(
			claims.nonHomeTrackResourceOffsets,
			claims.nonHomeTrackResourceRows,
			0,
		);

		expect(nonHomeRows.length).toBeGreaterThan(0);
		expect(nonHomeRows.every((row) => !homeRows.has(row))).toBe(true);
		expect(cycleRows.every((row) => homeRows.has(row) || nonHomeRows.includes(row))).toBe(true);
		expect(nonHomeRows.every((row) => cycleRows.includes(row))).toBe(true);
		expect(claims.sourceRoutesFingerprint).toBe(fixture.routes.fingerprint);
		expect(claims.sourceParkingConfigurationFingerprint).toBe(fixture.parking.fingerprint);
		expect(checksumSimulationResidentCycleLeaseClaims(claims)).toBe(claims.fingerprint);
		expect(simulationResidentCycleLeaseClaimsError(claims)).toBeNull();
		expect(matches(fixture, claims)).toBe(true);
	});

	it("rejects hidden fields, mutation, and exact source drift", async () => {
		const fixture = await residentFixture(1);
		const claims = compileClaims(fixture);
		expect(simulationResidentCycleLeaseClaimsError({ ...claims, partialBundle: [1, 2] })).toMatch(
			/unexpected fields/i,
		);
		claims.nonHomeTrackResourceRows[0] = (claims.nonHomeTrackResourceRows[0] as number) + 1;
		expect(simulationResidentCycleLeaseClaimsError(claims)).toMatch(/non-canonical|fingerprint/i);

		const clean = compileClaims(fixture);
		const foreign = buildSimulationReadinessTestComponentsWithEqPorts(40);
		expect(
			simulationResidentCycleLeaseClaimsMatchSources(
				foreign.foundation,
				foreign.trackResources,
				foreign.occupancyPolicy,
				fixture.parking,
				fixture.routes,
				clean,
			),
		).toBe(false);
	});

	it("survives owned structured-clone transfer", async () => {
		const fixture = await residentFixture(1);
		const claims = compileClaims(fixture);
		const transfers = simulationResidentCycleLeaseClaimTransfers(claims);
		const transferred = structuredClone(claims, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationResidentCycleLeaseClaimsError(transferred)).toBeNull();
		expect(matches(fixture, transferred)).toBe(true);
	});

	it("retains the exact 100,000-request boundary within the lease memory cap", async () => {
		const fixture = await residentFixture(SIMULATION_SCENARIO_MAX_INPUT_RECORDS);
		const claims = compileClaims(fixture);

		expect(claims.requestCount).toBe(SIMULATION_SCENARIO_MAX_INPUT_RECORDS);
		expect(claims.byteLength).toBe(20_400_012);
		expect(claims.byteLength).toBeLessThan(SIMULATION_RESIDENT_CYCLE_LEASE_MAX_TYPED_BYTES);
		expect(simulationResidentCycleLeaseClaimsError(claims)).toBeNull();
	});
});

async function residentFixture(requestCount: number) {
	const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: requestCount === 0 ? 1 : 2,
			residentHomeSlots:
				requestCount === 0
					? []
					: [
							{
								id: 1,
								vehicleId: "OHT-001",
								anchorPortId: 1,
								policy: "DEDICATED_HOME_RETURN" as const,
							},
						],
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
	const manifest = compileSimulationResidentTransferPlanManifest(operational, {
		manifestId: "RESIDENT-LEASE-1",
		adapterId: "OPENFAB_RESIDENT_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: requestCount,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records: Array.from({ length: requestCount }, (_, row) => ({
			transferId: `TRANSFER-${row}`,
			sourceOrdinal: row,
			releaseTimeMicroseconds: row,
			loadId: `LOAD-${row}`,
			vehicleId: "OHT-001",
			sourcePortId: 2,
			destinationPortId: 4,
		})),
	});
	const routes = await compileSimulationResidentCycleRoutes(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.stationCapabilities,
		manifest,
		parking,
	);
	return { components, parking, routes };
}

function compileClaims(fixture: Awaited<ReturnType<typeof residentFixture>>) {
	return compileSimulationResidentCycleLeaseClaims(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.parking,
		fixture.routes,
	);
}

function matches(
	fixture: Awaited<ReturnType<typeof residentFixture>>,
	claims: ReturnType<typeof compileClaims>,
) {
	return simulationResidentCycleLeaseClaimsMatchSources(
		fixture.components.foundation,
		fixture.components.trackResources,
		fixture.components.occupancyPolicy,
		fixture.parking,
		fixture.routes,
		claims,
	);
}

function csrRows(offsets: Uint32Array, rows: Uint32Array, row: number): number[] {
	return [...rows.subarray(offsets[row] as number, offsets[row + 1] as number)];
}
