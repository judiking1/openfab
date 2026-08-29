import { describe, expect, it } from "vitest";
import {
	type PublishedSimulationReadinessSnapshot,
	publishSimulationReadinessSnapshot,
} from "./SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestComponents,
	buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts,
	buildSimulationReadinessTestComponentsWithEqPorts,
	simulationReadinessTestVehicleProfile,
} from "./SimulationReadinessTestFixture";
import {
	compileSimulationScenarioLeaseClaims,
	SIMULATION_SCENARIO_LEASE_MISSING_RUNTIME_LAYERS,
	simulationScenarioLeaseClaimsError,
	simulationScenarioLeaseClaimsMatchSources,
	simulationScenarioLeaseClaimTransfers,
} from "./SimulationScenarioLeaseClaims";
import {
	compileSimulationTransferPlanManifest,
	type SimulationTransferPlanManifest,
} from "./SimulationScenarioManifest";
import {
	compileSimulationScenarioRouteRequests,
	type SimulationScenarioRouteRequests,
} from "./SimulationScenarioRouteRequests";

describe("SimulationScenarioLeaseClaims", () => {
	it("publishes a valid non-runnable empty safety artifact", async () => {
		const snapshot = readySnapshot();
		const manifest = transferManifest([]);
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);

		expect(claims).toMatchObject({
			simulationRunnable: false,
			missingRuntimeLayers: SIMULATION_SCENARIO_LEASE_MISSING_RUNTIME_LAYERS,
			requestCount: 0,
			partialAcquisitionAllowed: false,
			waitingRequestMayHoldRouteResources: false,
		});
		expect([...claims.leaseTrackResourceOffsets]).toEqual([0]);
		expect([...claims.orderedTrackOccurrenceOffsets]).toEqual([0]);
		expect(simulationScenarioLeaseClaimsError(claims)).toBeNull();
		expect(simulationScenarioLeaseClaimsMatchSources(snapshot, manifest, routes, claims)).toBe(
			true,
		);
	});

	it("extends the anchor corridor and publishes an atomic unique resource bundle", async () => {
		const { snapshot, manifest, routes } = await routeFixture();
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
		const rear = snapshot.occupancyPolicy.rearLeaseExtensionMillimeters / 1_000;
		const front = snapshot.occupancyPolicy.frontLeaseExtensionMillimeters / 1_000;

		expect(claims.routeLeaseLengthsMeters[0]).toBeCloseTo(
			(routes.routeDistancesMeters[0] as number) + front + rear,
			8,
		);
		expect(claims.orderedTrackOccurrenceStartsMeters[0]).toBeCloseTo(-rear, 8);
		expect(
			claims.orderedTrackOccurrenceEndsMeters[claims.orderedTrackOccurrenceEndsMeters.length - 1],
		).toBeCloseTo((routes.routeDistancesMeters[0] as number) + front, 8);
		const leaseRows = [...claims.leaseTrackResourceRows];
		expect(leaseRows).toEqual([...new Set(leaseRows)].sort((left, right) => left - right));
		expect(leaseRows.length).toBeGreaterThan(0);
		expect(claims.orderedTrackOccurrenceResourceRows.length).toBeGreaterThanOrEqual(
			leaseRows.length,
		);
		expect(claims.sourceRouteRequestsFingerprint).toBe(routes.fingerprint);
		expect(simulationScenarioLeaseClaimsError(claims)).toBeNull();
	});

	it("reuses deterministic bundles while preserving one CSR row per canonical request", async () => {
		const snapshot = readySnapshot();
		const manifest = transferManifest([transfer("R-1", 0, 10, 2, 1), transfer("R-2", 1, 20, 2, 1)]);
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
		const first = csrRows(claims.leaseTrackResourceOffsets, claims.leaseTrackResourceRows, 0);
		const second = csrRows(claims.leaseTrackResourceOffsets, claims.leaseTrackResourceRows, 1);

		expect(first).toEqual(second);
		expect(claims.routeLeaseLengthsMeters[0]).toBe(claims.routeLeaseLengthsMeters[1]);
		expect(claims.fingerprint).toBe(
			compileSimulationScenarioLeaseClaims(snapshot, manifest, routes).fingerprint,
		);
	});

	it("claims the exact advanced-switch movement and its exclusive conflict resource", async () => {
		const { snapshot, manifest, routes, claims } = await switchRouteFixture();

		expect(claims.movementClaimRows.length).toBeGreaterThan(0);
		expect(claims.switchConflictClaimRows).toHaveLength(1);
		for (const movementRow of claims.movementClaimRows) {
			const conflictRow = snapshot.trackResources.movementConflictResourceRows[
				movementRow
			] as number;
			expect([...claims.switchConflictClaimRows]).toContain(conflictRow);
			expect(snapshot.trackResources.movementSwitchIds[movementRow]).toBe(
				snapshot.trackResources.switchConflictResourceIds[conflictRow],
			);
		}
		expect(simulationScenarioLeaseClaimsMatchSources(snapshot, manifest, routes, claims)).toBe(
			true,
		);
	});

	it("fails closed when clearance needs an unselected continuation path", async () => {
		const foundation = buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts().foundation;
		const oversizedFront = {
			...simulationReadinessTestVehicleProfile(),
			frontSafetyMarginMillimeters: 100_000,
		};
		const snapshot = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponents(foundation, undefined, oversizedFront),
		);
		let observedAmbiguousBoundary = false;
		for (const [sourcePortId, destinationPortId] of [
			[1, 2],
			[2, 1],
		] as const) {
			const manifest = transferManifest([
				transfer("NO-GUESS", 0, 10, sourcePortId, destinationPortId),
			]);
			const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
			try {
				compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
			} catch (error) {
				if (
					error instanceof Error &&
					/explicit predecessor|explicit continuation/i.test(error.message)
				) {
					observedAmbiguousBoundary = true;
					break;
				}
				throw error;
			}
		}
		expect(observedAmbiguousBoundary).toBe(true);
	});

	it("rejects mutation, hidden fields, and a foreign certificate binding", async () => {
		const { snapshot, manifest, routes } = await routeFixture();
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
		const foreign = publishSimulationReadinessSnapshot(
			buildSimulationReadinessTestComponentsWithEqPorts(40),
		);

		expect(
			simulationScenarioLeaseClaimsError({ ...claims, rawSourceRecord: "must-not-cross" }),
		).toMatch(/unexpected fields/i);
		expect(simulationScenarioLeaseClaimsMatchSources(foreign, manifest, routes, claims)).toBe(
			false,
		);
		claims.orderedTrackOccurrenceEndsMeters[0] =
			(claims.orderedTrackOccurrenceEndsMeters[0] as number) + 0.01;
		expect(simulationScenarioLeaseClaimsError(claims)).toMatch(/per-request|fingerprint/i);
	});

	it("survives structured cloning as independently transferable typed columns", async () => {
		const { snapshot, manifest, routes } = await routeFixture();
		const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
		const transfers = simulationScenarioLeaseClaimTransfers(claims);
		const transferred = structuredClone(claims, { transfer: [...transfers] });

		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationScenarioLeaseClaimsError(transferred)).toBeNull();
		expect(simulationScenarioLeaseClaimsMatchSources(snapshot, manifest, routes, transferred)).toBe(
			true,
		);
	});
});

function readySnapshot(): PublishedSimulationReadinessSnapshot {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

async function routeFixture(): Promise<{
	readonly snapshot: PublishedSimulationReadinessSnapshot;
	readonly manifest: SimulationTransferPlanManifest;
	readonly routes: SimulationScenarioRouteRequests;
}> {
	const snapshot = readySnapshot();
	const manifest = transferManifest([transfer("LEASE-1", 0, 10, 2, 1)]);
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	return { snapshot, manifest, routes };
}

async function switchRouteFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts(),
	);
	for (const [sourcePortId, destinationPortId] of [
		[1, 2],
		[2, 1],
	] as const) {
		const manifest = transferManifest([
			transfer("SWITCH-LEASE-1", 0, 10, sourcePortId, destinationPortId),
		]);
		const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
		try {
			const claims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
			if (claims.movementClaimRows.length > 0) return { snapshot, manifest, routes, claims };
		} catch {
			// The opposite direction may be the one whose endpoint extension remains unambiguous.
		}
	}
	throw new Error("Public advanced-switch fixture did not produce a movement lease claim.");
}

function transferManifest(records: ReturnType<typeof transfer>[]): SimulationTransferPlanManifest {
	return compileSimulationTransferPlanManifest({
		manifestId: "SCENARIO-LEASE-1",
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: records.length,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records,
	});
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

function csrRows(offsets: Uint32Array, rows: Uint32Array, requestRow: number): number[] {
	return [...rows.slice(offsets[requestRow], offsets[requestRow + 1])];
}
