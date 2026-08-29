import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import type { SimulationScenarioPreparedArtifactChainValidation } from "../compile/SimulationScenarioPreparedArtifacts";
import { compileSimulationScenarioResourceRunConfiguration } from "../compile/SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import { compileSimulationScenarioServiceTiming } from "../compile/SimulationScenarioServiceTiming";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { adoptDeterministicScenarioPreparedSources } from "../simulation/DeterministicScenarioPreparedSources";
import type { PreparedSimulationScenarioArtifacts } from "../worker/SimulationScenarioPreparationWorkerProtocol";
import { LiveSimulationScenarioEditorController } from "./LiveSimulationScenarioEditorController";
import {
	type LiveSimulationScenarioPreparationPort,
	LiveSimulationScenarioSession,
} from "./LiveSimulationScenarioSession";

interface PreparationRequest {
	readonly snapshot: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[0];
	readonly manifest: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[1];
	readonly timing: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[2];
	readonly resources: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[3];
	readonly generation: number;
	readonly resolve: (prepared: PreparedSimulationScenarioArtifacts) => void;
	readonly reject: (error: Error) => void;
	settled: boolean;
}

class ControlledPreparation implements LiveSimulationScenarioPreparationPort {
	readonly requests: PreparationRequest[] = [];
	private readonly rejectOnCancel: boolean;
	cancelCount = 0;
	disposeCount = 0;

	constructor(rejectOnCancel = true) {
		this.rejectOnCancel = rejectOnCancel;
	}

	prepare(
		snapshot: PreparationRequest["snapshot"],
		manifest: PreparationRequest["manifest"],
		timing: PreparationRequest["timing"],
		resources: PreparationRequest["resources"],
		generation: number,
	): Promise<PreparedSimulationScenarioArtifacts> {
		return new Promise((resolve, reject) => {
			this.requests.push({
				snapshot,
				manifest,
				timing,
				resources,
				generation,
				resolve,
				reject,
				settled: false,
			});
		});
	}

	cancel(): void {
		this.cancelCount++;
		if (!this.rejectOnCancel) return;
		const request = this.requests.at(-1);
		if (!request || request.settled) return;
		request.settled = true;
		request.reject(abortError());
	}

	dispose(): void {
		this.disposeCount++;
		this.cancel();
	}

	async resolve(index: number): Promise<PreparedSimulationScenarioArtifacts> {
		const request = this.requests[index];
		if (!request) throw new Error(`Missing preparation ${index}.`);
		const prepared = await compilePrepared(request);
		request.settled = true;
		request.resolve(prepared);
		return prepared;
	}
}

describe("LiveSimulationScenarioEditorController", () => {
	it("invalidates prepared artifacts synchronously on a real RailDocument patch", async () => {
		const snapshot = readySnapshot();
		const document = new RailDocument();
		const preparation = new ControlledPreparation();
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			document,
			new LiveSimulationScenarioSession(preparation),
		);
		const pending = controller.prepare(
			snapshot,
			planSource("PLAN-1"),
			timingInput(),
			resourceInput(),
		);
		const prepared = await preparation.resolve(0);
		await expect(pending).resolves.toBe(prepared);
		expect(controller.getState()).toMatchObject({
			projectId: "PROJECT-1",
			source: { sourceKind: "TRANSFER_PLAN", acceptedRecordCount: 1 },
			session: { phase: "PREPARED" },
		});
		expect(controller.preparedArtifactsForCurrent(snapshot)).toBe(prepared);
		const authorization = controller.authorizeCurrentPrepared(snapshot);
		expect(authorization).toMatchObject({
			simulationRunnable: true,
			projectId: "PROJECT-1",
			preparationGeneration: 1,
			authorizationGeneration: 1,
		});
		expect(controller.getState().authorization).toMatchObject({
			fingerprint: authorization.fingerprint,
			requestCount: 1,
		});

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(controller.getState().session).toMatchObject({
			phase: "INVALIDATED",
			reason: "AUTHORED_MUTATION",
		});
		expect(controller.preparedArtifactsForCurrent(snapshot)).toBeNull();
		expect(controller.getState().authorization).toBeNull();
	});

	it("consumes exact authorization once without constructing or advancing a scheduler", async () => {
		const snapshot = readySnapshot();
		const preparation = new ControlledPreparation();
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			new RailDocument(),
			new LiveSimulationScenarioSession(preparation),
		);
		const pending = controller.prepare(
			snapshot,
			planSource("PLAN-1"),
			timingInput(),
			resourceInput(),
		);
		const prepared = await preparation.resolve(0);
		await pending;
		const authorization = controller.authorizeCurrentPrepared(snapshot);

		const consumed = controller.consumeAuthorizedRunForCurrent(snapshot);
		expect(consumed).toMatchObject({ authorization, prepared });
		expect(consumed?.runAsset.fingerprint).toBe(authorization.sourceRunAssetFingerprint);
		expect(controller.getState().authorization).toBeNull();
		expect(controller.consumeAuthorizedRunForCurrent(snapshot)).toBeNull();
		expect(controller.preparedArtifactsForCurrent(snapshot)).toBe(prepared);

		const next = controller.authorizeCurrentPrepared(snapshot);
		expect(next.authorizationGeneration).toBe(3);
		controller.revokeRunAuthorization();
		expect(controller.getState().authorization).toBeNull();
	});

	it("refuses authorization after a retained prepared buffer is mutated", async () => {
		const snapshot = readySnapshot();
		const preparation = new ControlledPreparation();
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			new RailDocument(),
			new LiveSimulationScenarioSession(preparation),
		);
		const pending = controller.prepare(
			snapshot,
			planSource("PLAN-1"),
			timingInput(),
			resourceInput(),
		);
		const prepared = await preparation.resolve(0);
		await pending;
		prepared.routes.routeDistancesMeters[0] =
			(prepared.routes.routeDistancesMeters[0] as number) + 1;

		expect(() => controller.authorizeCurrentPrepared(snapshot)).toThrow(/no longer matches/i);
		expect(controller.getState().authorization).toBeNull();
		expect(controller.preparedArtifactsForCurrent(snapshot)).toBeNull();
	});

	it("revokes an immediate adopter proof when the synchronous callback does not consume it", async () => {
		const snapshot = readySnapshot();
		const preparation = new ControlledPreparation();
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			new RailDocument(),
			new LiveSimulationScenarioSession(preparation),
		);
		const pending = controller.prepare(
			snapshot,
			planSource("PLAN-1"),
			timingInput(),
			resourceInput(),
		);
		await preparation.resolve(0);
		await pending;
		controller.authorizeCurrentPrepared(snapshot);
		let leakedValidation: SimulationScenarioPreparedArtifactChainValidation | null = null;
		const consumed = controller.adoptAuthorizedRunForCurrent(snapshot, (run, validation) => {
			leakedValidation = validation;
			return run;
		});
		expect(consumed).not.toBeNull();
		expect(leakedValidation).not.toBeNull();
		if (!consumed || !leakedValidation) throw new Error("Expected immediate adoption proof.");
		expect(() =>
			adoptDeterministicScenarioPreparedSources(
				snapshot,
				consumed.runAsset.manifest,
				leakedValidation as SimulationScenarioPreparedArtifactChainValidation,
			),
		).toThrow(/stale|mismatched/i);
		expect(controller.getState().authorization).toBeNull();
	});

	it("isolates a late Plan result from a newer Replay History source", async () => {
		const snapshot = readySnapshot();
		const preparation = new ControlledPreparation(false);
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			new RailDocument(),
			new LiveSimulationScenarioSession(preparation),
		);
		const planPending = controller.prepare(
			snapshot,
			planSource("PLAN-1"),
			timingInput(),
			resourceInput(),
		);
		const planCancelled = expect(planPending).rejects.toMatchObject({ name: "AbortError" });
		const replayPending = controller.prepare(
			snapshot,
			replaySource("REPLAY-1"),
			timingInput(),
			resourceInput(),
		);

		await preparation.resolve(0);
		await planCancelled;
		expect(controller.getState()).toMatchObject({
			source: { sourceKind: "REPLAY_HISTORY" },
			session: { phase: "PREPARING", generation: 3 },
		});
		const replayPrepared = await preparation.resolve(1);
		await expect(replayPending).resolves.toBe(replayPrepared);
		expect(controller.preparedArtifactsForCurrent(snapshot)).toBe(replayPrepared);
	});

	it("clears run-local source ownership at project replacement before binding the new document", async () => {
		const snapshot = readySnapshot();
		const firstDocument = new RailDocument();
		const nextDocument = new RailDocument();
		const preparation = new ControlledPreparation();
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			firstDocument,
			new LiveSimulationScenarioSession(preparation),
		);
		const pending = controller.prepare(
			snapshot,
			planSource("PLAN-1"),
			timingInput(),
			resourceInput(),
		);
		await preparation.resolve(0);
		await pending;
		controller.authorizeCurrentPrepared(snapshot);

		controller.replaceProject("PROJECT-2", nextDocument);
		expect(controller.getState()).toEqual({
			projectId: "PROJECT-2",
			source: null,
			session: { phase: "INVALIDATED", generation: 2, reason: "PROJECT_REPLACEMENT" },
			authorization: null,
		});
		expect(controller.selectedRunAsset()).toBeNull();
		expect(
			firstDocument.commit(planRailConstruction(firstDocument.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(controller.getState().session).toMatchObject({
			generation: 2,
			reason: "PROJECT_REPLACEMENT",
		});
	});

	it("makes disposal terminal and removes editor listeners", async () => {
		const preparation = new ControlledPreparation();
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-1",
			new RailDocument(),
			new LiveSimulationScenarioSession(preparation),
		);
		let notifications = 0;
		controller.subscribe(() => notifications++);
		controller.dispose();

		expect(controller.getState().session).toMatchObject({
			phase: "INVALIDATED",
			reason: "UNMOUNT",
		});
		expect(preparation.disposeCount).toBe(1);
		expect(notifications).toBe(1);
		expect(() => controller.clearSource()).toThrow(/disposed/i);
		controller.dispose();
		expect(preparation.disposeCount).toBe(1);
	});
});

function readySnapshot() {
	return publishSimulationReadinessSnapshot(buildSimulationReadinessTestComponentsWithEqPorts());
}

function planSource(manifestId: string) {
	return {
		sourceKind: "TRANSFER_PLAN" as const,
		manifestId,
		mappingVersion: 1,
		records: [
			{
				transferId: "TRANSFER-1",
				releaseTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	};
}

function replaySource(manifestId: string) {
	return {
		sourceKind: "REPLAY_HISTORY" as const,
		manifestId,
		mappingVersion: 1,
		records: [
			{
				historyEventId: "HISTORY-1",
				observedTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	};
}

function timingInput() {
	return {
		eqProcessTimings: [
			{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 1_000_000 },
		],
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

async function compilePrepared(request: PreparationRequest) {
	const { snapshot, manifest, timing, resources } = request;
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
		timing,
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
			resources,
		),
	});
}

function abortError(): Error {
	return new DOMException("controlled preparation cancelled", "AbortError");
}
