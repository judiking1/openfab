import { describe, expect, it } from "vitest";
import type { SimulationReadinessComponents } from "../compile/SimulationReadinessCertificate";
import { compileSimulationResidentCycleAdmissionProgram } from "../compile/SimulationResidentCycleAdmissionProgram";
import { compileSimulationResidentCycleLeaseClaims } from "../compile/SimulationResidentCycleLeaseClaims";
import { compileSimulationResidentCycleResourceRunConfiguration } from "../compile/SimulationResidentCycleResourceRunConfiguration";
import { compileSimulationResidentCycleRoutes } from "../compile/SimulationResidentCycleRoutes";
import { compileSimulationResidentCycleServiceTiming } from "../compile/SimulationResidentCycleServiceTiming";
import {
	type PublishedSimulationResidentReadinessSnapshot,
	publishSimulationResidentReadinessSnapshot,
} from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import {
	adaptSimulationResidentScenarioEditorRunAsset,
	type SimulationResidentScenarioEditorRunAsset,
} from "./SimulationResidentScenarioEditorSourceAdapter";
import {
	type SimulationResidentScenarioPreparationPort,
	SimulationResidentScenarioSession,
} from "./SimulationResidentScenarioSession";

class ImmediateResidentPreparation implements SimulationResidentScenarioPreparationPort {
	cancelCount = 0;
	disposed = false;

	prepare(
		components: SimulationReadinessComponents,
		runAsset: SimulationResidentScenarioEditorRunAsset,
	): Promise<PublishedSimulationResidentReadinessSnapshot> {
		return compileResidentSnapshot(components, runAsset);
	}

	cancel(): void {
		this.cancelCount++;
	}

	dispose(): void {
		this.disposed = true;
	}
}

class ControlledResidentPreparation implements SimulationResidentScenarioPreparationPort {
	private resolveValue: ((value: PublishedSimulationResidentReadinessSnapshot) => void) | null =
		null;
	cancelCount = 0;
	disposed = false;

	prepare(): Promise<PublishedSimulationResidentReadinessSnapshot> {
		return new Promise((resolve) => {
			this.resolveValue = resolve;
		});
	}

	resolve(snapshot: PublishedSimulationResidentReadinessSnapshot): void {
		if (!this.resolveValue) throw new Error("Expected pending resident preparation.");
		this.resolveValue(snapshot);
		this.resolveValue = null;
	}

	cancel(): void {
		this.cancelCount++;
	}

	dispose(): void {
		this.disposed = true;
	}
}

describe("SimulationResidentScenarioSession", () => {
	it("prepares one exact certificate while publishing bounded identity state only", async () => {
		const fixture = await sessionFixture("RESIDENT-SESSION-1");
		const preparation = new ImmediateResidentPreparation();
		const session = new SimulationResidentScenarioSession(preparation);
		const phases: string[] = [];
		session.subscribe(() => phases.push(session.getState().phase));

		const snapshot = await session.prepare(fixture.components, fixture.runAsset);
		expect(session.getState()).toMatchObject({
			phase: "PREPARED",
			generation: 1,
			certificateFingerprint: snapshot.certificate.fingerprint,
			requestCount: 1,
			vehicleCount: 1,
		});
		expect(Object.hasOwn(session.getState(), "preparedSnapshot")).toBe(false);
		expect(session.preparedSnapshotFor(fixture.components, fixture.runAsset)).toBe(snapshot);
		expect(phases).toEqual(["PREPARING", "PREPARED"]);
		expect(preparation.cancelCount).toBe(1);

		fixture.runAsset.parking.anchorPortIds[0] = 999_999;
		expect(session.preparedSnapshotFor(fixture.components, fixture.runAsset)).toBeNull();
	});

	it("rejects a late prepared result after synchronous lifecycle invalidation", async () => {
		const fixture = await sessionFixture("RESIDENT-CANCEL-1");
		const snapshot = await compileResidentSnapshot(fixture.components, fixture.runAsset);
		const preparation = new ControlledResidentPreparation();
		const session = new SimulationResidentScenarioSession(preparation);
		const pending = session.prepare(fixture.components, fixture.runAsset);

		session.invalidate("AUTHORED_MUTATION");
		preparation.resolve(snapshot);
		await expect(pending).rejects.toThrow(/cancelled/i);
		expect(session.getState()).toEqual({
			phase: "INVALIDATED",
			generation: 2,
			reason: "AUTHORED_MUTATION",
		});
		expect(session.preparedSnapshotFor(fixture.components, fixture.runAsset)).toBeNull();
		expect(preparation.cancelCount).toBe(2);
	});

	it("fails closed when the preparation port returns a foreign exact snapshot", async () => {
		const expected = await sessionFixture("RESIDENT-EXPECTED-1");
		const foreign = await sessionFixture("RESIDENT-FOREIGN-1");
		const foreignSnapshot = await compileResidentSnapshot(foreign.components, foreign.runAsset);
		const port: SimulationResidentScenarioPreparationPort = {
			prepare: async () => foreignSnapshot,
			cancel: () => undefined,
			dispose: () => undefined,
		};
		const session = new SimulationResidentScenarioSession(port);

		await expect(session.prepare(expected.components, expected.runAsset)).rejects.toThrow(
			/exact retained source/i,
		);
		expect(session.getState()).toMatchObject({ phase: "FAILED", generation: 1 });
	});

	it("disposes its preparation port and clears the private snapshot terminally", async () => {
		const fixture = await sessionFixture("RESIDENT-DISPOSE-1");
		const preparation = new ImmediateResidentPreparation();
		const session = new SimulationResidentScenarioSession(preparation);
		await session.prepare(fixture.components, fixture.runAsset);

		session.dispose();
		expect(session.getState()).toEqual({ phase: "INVALIDATED", generation: 2, reason: "UNMOUNT" });
		expect(session.preparedSnapshotFor(fixture.components, fixture.runAsset)).toBeNull();
		expect(preparation.disposed).toBe(true);
		expect(() => session.invalidate("SOURCE_SWITCH")).toThrow(/disposed/i);
		session.dispose();
	});
});

async function compileResidentSnapshot(
	components: SimulationReadinessComponents,
	runAsset: SimulationResidentScenarioEditorRunAsset,
): Promise<PublishedSimulationResidentReadinessSnapshot> {
	const { parking, manifest } = runAsset;
	const routes = await compileSimulationResidentCycleRoutes(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.stationCapabilities,
		manifest,
		parking,
	);
	const leaseClaims = compileSimulationResidentCycleLeaseClaims(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		parking,
		routes,
	);
	const admissionProgram = compileSimulationResidentCycleAdmissionProgram(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		manifest,
		parking,
		routes,
		leaseClaims,
	);
	const serviceTiming = compileSimulationResidentCycleServiceTiming(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		runAsset.serviceTimingInput,
	);
	const resourceRunConfiguration = compileSimulationResidentCycleResourceRunConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		runAsset.resourceRunInput,
	);
	return publishSimulationResidentReadinessSnapshot({
		...components,
		parking,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration,
	});
}

async function sessionFixture(manifestId: string) {
	const sources = await buildSimulationResidentReadinessTestSources();
	const components = {
		foundation: sources.foundation,
		trackResources: sources.trackResources,
		stationCapabilities: sources.stationCapabilities,
		equipmentResources: sources.equipmentResources,
		occupancyPolicy: sources.occupancyPolicy,
	};
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 2,
			residentHomeSlots: [
				{
					id: 1,
					vehicleId: "OHT-001",
					anchorPortId: 3,
					policy: "DEDICATED_HOME_RETURN",
				},
			],
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
	const runAsset = adaptSimulationResidentScenarioEditorRunAsset(
		components,
		operational,
		{
			sourceKind: "TRANSFER_PLAN",
			manifestId,
			mappingVersion: 1,
			records: [
				{
					transferId: "TRANSFER-A",
					releaseTimeMicroseconds: 0,
					loadId: "LOAD-A",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
		{
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 2_000_000,
				},
			],
		},
		{
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 2,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
		},
	);
	return { components, runAsset };
}
