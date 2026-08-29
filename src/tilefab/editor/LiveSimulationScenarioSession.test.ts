import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import {
	compileSimulationReplayHistoryManifest,
	compileSimulationTransferPlanManifest,
	type SimulationScenarioManifest,
} from "../compile/SimulationScenarioManifest";
import { compileSimulationScenarioResourceRunConfiguration } from "../compile/SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import { compileSimulationScenarioServiceTiming } from "../compile/SimulationScenarioServiceTiming";
import type { PreparedSimulationScenarioArtifacts } from "../worker/SimulationScenarioPreparationWorkerProtocol";
import {
	type LiveSimulationScenarioPreparationPort,
	LiveSimulationScenarioSession,
} from "./LiveSimulationScenarioSession";

interface PendingPreparation {
	readonly generation: number;
	readonly resolve: (prepared: PreparedSimulationScenarioArtifacts) => void;
	readonly reject: (error: Error) => void;
	settled: boolean;
}

class ControlledPreparation implements LiveSimulationScenarioPreparationPort {
	readonly requests: PendingPreparation[] = [];
	private readonly rejectOnCancel: boolean;
	cancelCount = 0;
	disposeCount = 0;

	constructor(rejectOnCancel = true) {
		this.rejectOnCancel = rejectOnCancel;
	}

	prepare(
		_snapshot: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[0],
		_manifest: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[1],
		_serviceTimingInput: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[2],
		_resourceRunInput: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[3],
		generation: number,
	): Promise<PreparedSimulationScenarioArtifacts> {
		return new Promise((resolve, reject) => {
			this.requests.push({ generation, resolve, reject, settled: false });
		});
	}

	cancel(): void {
		this.cancelCount++;
		if (!this.rejectOnCancel) return;
		const current = this.requests.at(-1);
		if (!current || current.settled) return;
		current.settled = true;
		current.reject(abortError());
	}

	dispose(): void {
		this.disposeCount++;
		this.cancel();
	}

	resolve(index: number, prepared: PreparedSimulationScenarioArtifacts): void {
		const pending = this.requests[index];
		if (!pending) throw new Error(`Missing preparation ${index}.`);
		pending.settled = true;
		pending.resolve(prepared);
	}

	reject(index: number, error: Error): void {
		const pending = this.requests[index];
		if (!pending) throw new Error(`Missing preparation ${index}.`);
		pending.settled = true;
		pending.reject(error);
	}
}

describe("LiveSimulationScenarioSession", () => {
	it("publishes exact preparing/prepared identity and reads routes only for those sources", async () => {
		const snapshot = readySnapshot();
		const foreignSnapshot = readySnapshot(40);
		const manifest = planManifest();
		const input = timingInput(manifest);
		const resources = resourceInput();
		const preparation = new ControlledPreparation();
		const session = new LiveSimulationScenarioSession(preparation);
		const prepared = { ...(await compilePrepared(snapshot, manifest)) };
		expect(Object.isFrozen(prepared)).toBe(false);
		const pending = session.prepare(snapshot, manifest, input, resources);

		expect(session.getState()).toMatchObject({
			phase: "PREPARING",
			generation: 1,
			source: {
				sourceKind: "TRANSFER_PLAN",
				manifestFingerprint: manifest.fingerprint,
				certificateFingerprint: snapshot.certificate.fingerprint,
			},
		});
		preparation.resolve(0, prepared);
		await expect(pending).resolves.toBe(prepared);
		expect(Object.isFrozen(prepared)).toBe(true);
		expect(session.getState()).toMatchObject({ phase: "PREPARED", generation: 1, prepared });
		expect(session.preparedRoutesFor(snapshot, manifest, input, resources)).toBe(prepared.routes);
		expect(session.preparedLeaseClaimsFor(snapshot, manifest, input, resources)).toBe(
			prepared.leaseClaims,
		);
		expect(session.preparedAdmissionProgramFor(snapshot, manifest, input, resources)).toBe(
			prepared.admissionProgram,
		);
		expect(session.preparedServiceTimingFor(snapshot, manifest, input, resources)).toBe(
			prepared.serviceTiming,
		);
		expect(session.preparedResourceRunConfigurationFor(snapshot, manifest, input, resources)).toBe(
			prepared.resourceRunConfiguration,
		);
		expect(session.preparedArtifactsFor(snapshot, manifest, input, resources)).toBe(prepared);
		expect(session.preparedRoutesFor(foreignSnapshot, manifest, input, resources)).toBeNull();
		expect(
			session.preparedRoutesFor(
				snapshot,
				manifest,
				{
					eqProcessTimings: input.eqProcessTimings.map((record) => ({
						...record,
						processingDurationMicroseconds: record.processingDurationMicroseconds + 1,
					})),
				},
				resources,
			),
		).toBeNull();
		expect(
			session.preparedRoutesFor(snapshot, manifest, input, {
				...resources,
				eqResources: [{ ...resources.eqResources[0], concurrentCapacity: 2 }],
			}),
		).toBeNull();
	});

	it("drops pending or retained routes synchronously for edit and replacement invalidation", async () => {
		const snapshot = readySnapshot();
		const manifest = planManifest();
		const input = timingInput(manifest);
		const resources = resourceInput();
		const preparation = new ControlledPreparation();
		const session = new LiveSimulationScenarioSession(preparation);
		const pending = session.prepare(snapshot, manifest, input, resources);
		const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });

		session.invalidate("AUTHORED_MUTATION");
		expect(session.getState()).toEqual({
			phase: "INVALIDATED",
			generation: 2,
			reason: "AUTHORED_MUTATION",
		});
		expect(session.preparedRoutesFor(snapshot, manifest, input, resources)).toBeNull();
		await cancelled;

		const prepared = await compilePrepared(snapshot, manifest);
		const second = session.prepare(snapshot, manifest, input, resources);
		preparation.resolve(1, prepared);
		await second;
		session.invalidate("PROJECT_REPLACEMENT");
		expect(session.getState()).toMatchObject({
			phase: "INVALIDATED",
			reason: "PROJECT_REPLACEMENT",
		});
		expect(session.preparedRoutesFor(snapshot, manifest, input, resources)).toBeNull();
	});

	it("isolates Plan and History generations even when a cancelled preparation resolves late", async () => {
		const snapshot = readySnapshot();
		const plan = planManifest();
		const replay = replayManifest();
		const planInput = timingInput(plan);
		const replayInput = timingInput(replay);
		const resources = resourceInput();
		const preparation = new ControlledPreparation(false);
		const session = new LiveSimulationScenarioSession(preparation);
		const planPrepared = await compilePrepared(snapshot, plan);
		const replayPrepared = await compilePrepared(snapshot, replay);
		const planPending = session.prepare(snapshot, plan, planInput, resources);
		const planCancelled = expect(planPending).rejects.toMatchObject({ name: "AbortError" });
		const replayPending = session.prepare(snapshot, replay, replayInput, resources);

		preparation.resolve(0, planPrepared);
		await planCancelled;
		expect(session.getState()).toMatchObject({
			phase: "PREPARING",
			generation: 2,
			source: { sourceKind: "REPLAY_HISTORY" },
		});
		preparation.resolve(1, replayPrepared);
		await expect(replayPending).resolves.toBe(replayPrepared);
		expect(session.preparedRoutesFor(snapshot, replay, replayInput, resources)).toBe(
			replayPrepared.routes,
		);
		expect(session.preparedLeaseClaimsFor(snapshot, replay, replayInput, resources)).toBe(
			replayPrepared.leaseClaims,
		);
		expect(session.preparedAdmissionProgramFor(snapshot, replay, replayInput, resources)).toBe(
			replayPrepared.admissionProgram,
		);
		expect(session.preparedServiceTimingFor(snapshot, replay, replayInput, resources)).toBe(
			replayPrepared.serviceTiming,
		);
		expect(session.preparedRoutesFor(snapshot, plan, planInput, resources)).toBeNull();
	});

	it("fails closed for foreign results and makes unmount terminal for listeners and commands", async () => {
		const snapshot = readySnapshot();
		const foreignSnapshot = readySnapshot(40);
		const manifest = planManifest();
		const input = timingInput(manifest);
		const resources = resourceInput();
		const preparation = new ControlledPreparation();
		const session = new LiveSimulationScenarioSession(preparation);
		let notifications = 0;
		const unsubscribe = session.subscribe(() => notifications++);
		const foreignPrepared = await compilePrepared(foreignSnapshot, manifest);
		const pending = session.prepare(snapshot, manifest, input, resources);
		const rejected = expect(pending).rejects.toThrow(/retained live sources/i);

		preparation.resolve(0, foreignPrepared);
		await rejected;
		expect(session.getState()).toMatchObject({ phase: "FAILED", generation: 1 });
		expect(session.preparedRoutesFor(snapshot, manifest, input, resources)).toBeNull();

		session.dispose();
		expect(session.getState()).toMatchObject({ phase: "INVALIDATED", reason: "UNMOUNT" });
		expect(preparation.disposeCount).toBe(1);
		expect(notifications).toBe(3);
		expect(() => session.invalidate("EXPLICIT_CANCEL")).toThrow(/disposed/i);
		expect(() => session.subscribe(() => undefined)).toThrow(/disposed/i);
		unsubscribe();
		session.dispose();
		expect(preparation.disposeCount).toBe(1);
	});
});

function readySnapshot(anchorX = 0) {
	return publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(anchorX),
	);
}

async function compilePrepared(
	snapshot: ReturnType<typeof readySnapshot>,
	manifest: SimulationScenarioManifest,
): Promise<PreparedSimulationScenarioArtifacts> {
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const leaseClaims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const admissionProgram = compileSimulationScenarioAdmissionProgram(
		snapshot,
		manifest,
		routes,
		leaseClaims,
	);
	const serviceTiming = compileSimulationScenarioServiceTiming(
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		timingInput(manifest),
	);
	return Object.freeze({
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration: compileSimulationScenarioResourceRunConfiguration(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			resourceInput(),
		),
	});
}

function planManifest() {
	return compileSimulationTransferPlanManifest({
		...header("LIVE-PLAN-1"),
		records: [
			{
				transferId: "PLAN-1",
				sourceOrdinal: 0,
				releaseTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	});
}

function replayManifest() {
	return compileSimulationReplayHistoryManifest({
		...header("LIVE-REPLAY-1"),
		records: [
			{
				historyEventId: "HISTORY-1",
				sourceOrdinal: 0,
				observedTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	});
}

function header(manifestId: string) {
	return {
		manifestId,
		adapterId: "OPENFAB_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: 1,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
	};
}

function abortError(): Error {
	return new DOMException("controlled preparation cancelled", "AbortError");
}

function timingInput(manifest: SimulationScenarioManifest) {
	return {
		eqProcessTimings: manifest.records.map((record) => ({
			sourceOrdinal: record.sourceOrdinal,
			capabilityId: 1,
			processingDurationMicroseconds: 1_000_000,
		})),
	};
}

function resourceInput() {
	return {
		eqResources: [
			{
				equipmentGroupId: 1,
				concurrentCapacity: 1,
				availabilityMode: "ALWAYS" as const,
				availabilityWindows: [],
			},
		],
		initialStorageLoads: [],
	};
}
