import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import type { SimulationScenarioPreparedArtifactChainValidation } from "../compile/SimulationScenarioPreparedArtifacts";
import type { SimulationScenarioRunAuthorization } from "../compile/SimulationScenarioRunAuthorization";
import {
	DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	DeterministicScenarioMotionScheduler,
	type DeterministicScenarioSpeedMultiplier,
} from "../simulation/DeterministicScenarioMotionScheduler";
import {
	type DeterministicScenarioRuntimeEventWindow,
	selectDeterministicScenarioRuntimeEventWindow,
} from "../simulation/DeterministicScenarioRuntimeEventWindow";
import {
	DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS,
	DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT,
	DETERMINISTIC_SCENARIO_RUNTIME_MINIMUM_CADENCE_MICROSECONDS,
	type DeterministicScenarioRuntimePublication,
	type DeterministicScenarioRuntimePublicationConfiguration,
	DeterministicScenarioRuntimePublisher,
} from "../simulation/DeterministicScenarioRuntimePublisher";
import type {
	ConsumedLiveSimulationScenarioRun,
	LiveSimulationScenarioEditorController,
	LiveSimulationScenarioEditorControllerState,
} from "./LiveSimulationScenarioEditorController";

export const LIVE_SIMULATION_ACTIVE_RUN_STOP_REASONS = Object.freeze([
	"EXPLICIT_STOP",
	"AUTHORED_MUTATION",
	"PROJECT_REPLACEMENT",
	"SOURCE_SWITCH",
	"EXPLICIT_CANCEL",
	"UNMOUNT",
	"CURRENT_SOURCE_CHANGED",
] as const);
export type LiveSimulationActiveRunStopReason =
	(typeof LIVE_SIMULATION_ACTIVE_RUN_STOP_REASONS)[number];

export type LiveSimulationActiveRunOwnerState =
	| Readonly<{ phase: "IDLE"; generation: 0 }>
	| Readonly<{
			phase: "ACTIVE";
			generation: number;
			projectId: string;
			sourceKind: SimulationScenarioRunAuthorization["sourceKind"];
			authorizationFingerprint: string;
			readinessProfileId: string;
			limitations: SimulationScenarioRunAuthorization["limitations"];
			runIdentityFingerprint: string;
			requestCount: number;
			loadCount: number;
			eqResourceCount: number;
			storageResourceCount: number;
			speedMultiplier: DeterministicScenarioSpeedMultiplier;
			sampledSimulationTimeMicroseconds: number;
			completed: boolean;
			latestPublication: DeterministicScenarioRuntimePublication;
	  }>
	| Readonly<{
			phase: "STOPPED";
			generation: number;
			reason: LiveSimulationActiveRunStopReason;
	  }>
	| Readonly<{
			phase: "FAILED";
			generation: number;
			message: string;
	  }>;

export interface LiveSimulationActiveRunAdvanceResult {
	readonly eventCount: number;
	readonly publication: DeterministicScenarioRuntimePublication | null;
}

interface OwnedActiveRuntime {
	readonly authorization: SimulationScenarioRunAuthorization;
	readonly manifest: ConsumedLiveSimulationScenarioRun["runAsset"]["manifest"];
	readonly scheduler: DeterministicScenarioMotionScheduler;
	readonly publisher: DeterministicScenarioRuntimePublisher;
	speedMultiplier: DeterministicScenarioSpeedMultiplier;
	latestPublication: DeterministicScenarioRuntimePublication;
	latestEventWindow: DeterministicScenarioRuntimeEventWindow;
}

const INITIAL_STATE: LiveSimulationActiveRunOwnerState = Object.freeze({
	phase: "IDLE",
	generation: 0,
});
const MAX_FAILURE_MESSAGE_LENGTH = 240;

/**
 * Owns one exact limited runtime after atomically consuming the editor controller's one-shot
 * authority. The owner has no timer or persistence API. Its caller controls time advancement, and
 * any controller source transition clears every scheduler/publication reference before notifying
 * consumers.
 */
export class LiveSimulationActiveRunOwner {
	private readonly controller: LiveSimulationScenarioEditorController;
	private readonly publicationConfiguration: DeterministicScenarioRuntimePublicationConfiguration;
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeController: () => void;
	private runtime: OwnedActiveRuntime | null = null;
	private state: LiveSimulationActiveRunOwnerState = INITIAL_STATE;
	private generation = 0;
	private disposed = false;

	constructor(
		controller: LiveSimulationScenarioEditorController,
		publicationConfiguration: DeterministicScenarioRuntimePublicationConfiguration,
	) {
		assertPublicationConfiguration(publicationConfiguration);
		this.controller = controller;
		this.publicationConfiguration = Object.freeze({ ...publicationConfiguration });
		this.unsubscribeController = controller.subscribe(() => this.reconcileControllerSource());
	}

	getState(): LiveSimulationActiveRunOwnerState {
		return this.state;
	}

	getLatestEventWindow(): DeterministicScenarioRuntimeEventWindow | null {
		return this.runtime?.latestEventWindow ?? null;
	}

	subscribe(listener: () => void): () => void {
		this.assertOwnerActive();
		if (typeof listener !== "function") throw new TypeError("Active run listener is invalid.");
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	start(
		snapshot: PublishedSimulationReadinessSnapshot,
		speedMultiplier: DeterministicScenarioSpeedMultiplier,
	): LiveSimulationActiveRunOwnerState {
		this.assertOwnerActive();
		if (this.runtime) throw new Error("A simulation scenario run is already active.");
		assertSpeedMultiplier(speedMultiplier);
		let runtime: OwnedActiveRuntime | null;
		try {
			runtime = this.controller.adoptAuthorizedRunForCurrent(snapshot, (consumed, validation) =>
				createOwnedRuntime(
					snapshot,
					consumed,
					this.publicationConfiguration,
					speedMultiplier,
					validation,
				),
			);
		} catch (error) {
			const generation = this.nextGeneration();
			this.runtime = null;
			this.publish(
				Object.freeze({
					phase: "FAILED",
					generation,
					message: normalizeError(error).message.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
				}),
			);
			throw normalizeError(error);
		}
		if (!runtime) {
			throw new Error("An exact current one-shot Run authorization is required before Start.");
		}
		const generation = this.nextGeneration();
		this.runtime = runtime;
		this.publish(this.captureActiveState(runtime, generation));
		return this.state;
	}

	setSpeedMultiplier(speedMultiplier: DeterministicScenarioSpeedMultiplier): void {
		this.assertOwnerActive();
		assertSpeedMultiplier(speedMultiplier);
		const runtime = this.requireRuntime();
		if (runtime.speedMultiplier === speedMultiplier) return;
		runtime.speedMultiplier = speedMultiplier;
		this.publish(this.captureActiveState(runtime, this.requireActiveGeneration()));
	}

	advanceByWallClockMicroseconds(
		wallClockMicroseconds: number,
	): LiveSimulationActiveRunAdvanceResult {
		this.assertOwnerActive();
		const runtime = this.requireRuntime();
		const eventCount = runtime.scheduler.advanceByWallClockMicroseconds(
			wallClockMicroseconds,
			runtime.speedMultiplier,
		);
		const publication = runtime.publisher.publishIfDue();
		if (publication) {
			runtime.latestPublication = publication;
			runtime.latestEventWindow = selectDeterministicScenarioRuntimeEventWindow(
				runtime.scheduler,
				runtime.manifest,
			);
			this.publish(this.captureActiveState(runtime, this.requireActiveGeneration()));
		}
		return Object.freeze({ eventCount, publication });
	}

	stop(): boolean {
		this.assertOwnerActive();
		return this.stopAndDiscard("EXPLICIT_STOP");
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeController();
		this.runtime = null;
		this.listeners.clear();
	}

	private reconcileControllerSource(): void {
		const runtime = this.runtime;
		if (!runtime) return;
		const controllerState = this.controller.getState();
		if (controllerMatchesAuthorization(controllerState, runtime.authorization)) return;
		this.stopAndDiscard(controllerStopReason(controllerState));
	}

	private stopAndDiscard(reason: LiveSimulationActiveRunStopReason): boolean {
		if (!this.runtime) return false;
		const generation = this.requireActiveGeneration();
		this.runtime = null;
		this.publish(Object.freeze({ phase: "STOPPED", generation, reason }));
		return true;
	}

	private captureActiveState(
		runtime: OwnedActiveRuntime,
		generation: number,
	): LiveSimulationActiveRunOwnerState {
		const { authorization, scheduler } = runtime;
		return Object.freeze({
			phase: "ACTIVE",
			generation,
			projectId: authorization.projectId,
			sourceKind: authorization.sourceKind,
			authorizationFingerprint: authorization.fingerprint,
			readinessProfileId: authorization.sourceReadinessProfileId,
			limitations: authorization.limitations,
			runIdentityFingerprint: authorization.runIdentityFingerprint,
			requestCount: authorization.requestCount,
			loadCount: authorization.loadCount,
			eqResourceCount: authorization.eqResourceCount,
			storageResourceCount: authorization.storageResourceCount,
			speedMultiplier: runtime.speedMultiplier,
			sampledSimulationTimeMicroseconds:
				runtime.latestPublication.sampledSimulationTimeMicroseconds,
			completed: scheduler.allScenarioWorkCompleted,
			latestPublication: runtime.latestPublication,
		});
	}

	private publish(state: LiveSimulationActiveRunOwnerState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private requireRuntime(): OwnedActiveRuntime {
		if (!this.runtime) throw new Error("No simulation scenario run is active.");
		return this.runtime;
	}

	private requireActiveGeneration(): number {
		if (this.state.phase !== "ACTIVE") {
			throw new Error("Simulation scenario active-run state is inconsistent.");
		}
		return this.state.generation;
	}

	private nextGeneration(): number {
		this.generation =
			this.generation === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, this.generation + 1);
		return this.generation;
	}

	private assertOwnerActive(): void {
		if (this.disposed) throw new Error("Simulation scenario active-run owner is disposed.");
	}
}

function createOwnedRuntime(
	snapshot: PublishedSimulationReadinessSnapshot,
	consumed: ConsumedLiveSimulationScenarioRun,
	publicationConfiguration: DeterministicScenarioRuntimePublicationConfiguration,
	speedMultiplier: DeterministicScenarioSpeedMultiplier,
	preparedArtifactValidation: SimulationScenarioPreparedArtifactChainValidation,
): OwnedActiveRuntime {
	const { authorization, runAsset, prepared } = consumed;
	const scheduler = new DeterministicScenarioMotionScheduler(
		snapshot,
		runAsset.manifest,
		prepared.routes,
		prepared.leaseClaims,
		prepared.admissionProgram,
		prepared.serviceTiming,
		prepared.resourceRunConfiguration,
		preparedArtifactValidation,
	);
	if (
		!scheduler.resourceExecutionPrepared ||
		scheduler.sourceRouteRequestsFingerprint !== authorization.sourceRouteRequestsFingerprint ||
		scheduler.runIdentityFingerprint !== authorization.runIdentityFingerprint ||
		scheduler.requestCount !== authorization.requestCount
	) {
		throw new Error("Constructed simulation runtime does not match its consumed authorization.");
	}
	const publisher = new DeterministicScenarioRuntimePublisher(scheduler, publicationConfiguration);
	const latestPublication = publisher.publishIfDue();
	if (!latestPublication?.resourceExecutionPrepared) {
		throw new Error("Constructed simulation runtime did not publish its initial resource state.");
	}
	return {
		authorization,
		manifest: runAsset.manifest,
		scheduler,
		publisher,
		speedMultiplier,
		latestPublication,
		latestEventWindow: selectDeterministicScenarioRuntimeEventWindow(scheduler, runAsset.manifest),
	};
}

function controllerMatchesAuthorization(
	state: LiveSimulationScenarioEditorControllerState,
	authorization: SimulationScenarioRunAuthorization,
): boolean {
	if (
		state.projectId !== authorization.projectId ||
		state.source?.sourceKind !== authorization.sourceKind ||
		state.source.runAssetFingerprint !== authorization.sourceRunAssetFingerprint ||
		state.source.manifestFingerprint !== authorization.sourceManifestFingerprint ||
		state.session.phase !== "PREPARED" ||
		state.session.generation !== authorization.preparationGeneration
	) {
		return false;
	}
	const { source, prepared } = state.session;
	return (
		source.certificateFingerprint === authorization.sourceCertificateFingerprint &&
		source.readinessProfileId === authorization.sourceReadinessProfileId &&
		source.runIdentityFingerprint === authorization.runIdentityFingerprint &&
		source.serviceTimingInputFingerprint === authorization.sourceServiceTimingInputFingerprint &&
		source.resourceRunInputFingerprint === authorization.sourceResourceRunInputFingerprint &&
		prepared.routes.fingerprint === authorization.sourceRouteRequestsFingerprint &&
		prepared.leaseClaims.fingerprint === authorization.sourceLeaseClaimsFingerprint &&
		prepared.admissionProgram.fingerprint === authorization.sourceAdmissionProgramFingerprint &&
		prepared.serviceTiming.fingerprint === authorization.sourceServiceTimingFingerprint &&
		prepared.resourceRunConfiguration.fingerprint ===
			authorization.sourceResourceRunConfigurationFingerprint
	);
}

function controllerStopReason(
	state: LiveSimulationScenarioEditorControllerState,
): LiveSimulationActiveRunStopReason {
	return state.session.phase === "INVALIDATED" ? state.session.reason : "CURRENT_SOURCE_CHANGED";
}

function assertSpeedMultiplier(
	value: number,
): asserts value is DeterministicScenarioSpeedMultiplier {
	if (!(DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS as readonly number[]).includes(value)) {
		throw new RangeError("Simulation speed multiplier must be 1x, 2x, 4x, 8x, 16x, 32x, or 64x.");
	}
}

function assertPublicationConfiguration(
	value: DeterministicScenarioRuntimePublicationConfiguration,
): void {
	if (
		typeof value !== "object" ||
		value === null ||
		Object.keys(value).length !== 2 ||
		!Object.hasOwn(value, "cadenceMicroseconds") ||
		!Object.hasOwn(value, "maximumPoseCount") ||
		!Number.isSafeInteger(value.cadenceMicroseconds) ||
		value.cadenceMicroseconds < DETERMINISTIC_SCENARIO_RUNTIME_MINIMUM_CADENCE_MICROSECONDS ||
		value.cadenceMicroseconds > DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS ||
		!Number.isSafeInteger(value.maximumPoseCount) ||
		value.maximumPoseCount < 1 ||
		value.maximumPoseCount > DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT
	) {
		throw new RangeError("Simulation active-run publication configuration is invalid.");
	}
}

function normalizeError(error: unknown): Error {
	return error instanceof Error && error.message.length > 0
		? error
		: new Error("Simulation scenario active-run construction failed.");
}
