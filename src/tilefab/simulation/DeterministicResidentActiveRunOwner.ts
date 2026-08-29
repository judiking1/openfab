import type { PublishedSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	consumeSimulationResidentRunAuthorization,
	type IssueSimulationResidentRunAuthorizationInput,
	type SimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorizationGrant,
} from "../compile/SimulationResidentRunAuthorization";
import {
	type DeterministicResidentRuntimePublication,
	type DeterministicResidentRuntimePublicationConfiguration,
	DeterministicResidentRuntimePublisher,
	deterministicResidentRuntimePublicationConfigurationError,
} from "./DeterministicResidentRuntimePublisher";
import {
	adoptDeterministicResidentRuntimeState,
	DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS,
	type DeterministicResidentRuntimeDisposalReason,
	type DeterministicResidentRuntimeState,
	type DeterministicResidentSpeedMultiplier,
} from "./DeterministicResidentRuntimeState";

export const DETERMINISTIC_RESIDENT_ACTIVE_RUN_STOP_REASONS = Object.freeze([
	"EXPLICIT_STOP",
	"AUTHORED_MUTATION",
	"PROJECT_REPLACEMENT",
	"SOURCE_SWITCH",
	"EXPLICIT_CANCEL",
	"UNMOUNT",
	"CURRENT_SOURCE_CHANGED",
] as const);
export type DeterministicResidentActiveRunStopReason =
	(typeof DETERMINISTIC_RESIDENT_ACTIVE_RUN_STOP_REASONS)[number];

export type DeterministicResidentActiveRunOwnerState =
	| Readonly<{ phase: "IDLE"; generation: 0 }>
	| Readonly<{ phase: "STARTING"; generation: number }>
	| Readonly<{
			phase: "ACTIVE";
			generation: number;
			projectId: string;
			sourceKind: SimulationResidentRunAuthorization["sourceKind"];
			authorizationFingerprint: string;
			readinessProfileId: string;
			limitations: SimulationResidentRunAuthorization["limitations"];
			requestCount: number;
			loadCount: number;
			vehicleCount: number;
			eqResourceCount: number;
			storageResourceCount: number;
			speedMultiplier: DeterministicResidentSpeedMultiplier;
			sampledSimulationTimeMicroseconds: number;
			completed: boolean;
			latestPublication: DeterministicResidentRuntimePublication;
	  }>
	| Readonly<{
			phase: "STOPPED";
			generation: number;
			reason: DeterministicResidentActiveRunStopReason;
	  }>
	| Readonly<{
			phase: "FAILED";
			generation: number;
			message: string;
	  }>;

export interface DeterministicResidentActiveRunAdvanceResult {
	readonly transitionCount: number;
	readonly publication: DeterministicResidentRuntimePublication | null;
}

interface OwnedResidentRuntime {
	readonly authorization: SimulationResidentRunAuthorization;
	readonly runtime: DeterministicResidentRuntimeState;
	readonly publisher: DeterministicResidentRuntimePublisher;
	speedMultiplier: DeterministicResidentSpeedMultiplier;
	latestPublication: DeterministicResidentRuntimePublication;
}

interface PendingStart {
	readonly generation: number;
}

const INITIAL_STATE: DeterministicResidentActiveRunOwnerState = Object.freeze({
	phase: "IDLE",
	generation: 0,
});
const START_CANCELLED = Symbol("OpenFabDeterministicResidentStartCancelled");
const MAX_FAILURE_MESSAGE_LENGTH = 240;

/**
 * Owns one authorization-gated resident runtime without exposing the mutable state, sampler, or
 * publisher. Source invalidation and Stop synchronously dispose and drop the only owned reference.
 */
export class DeterministicResidentActiveRunOwner {
	private readonly publicationConfiguration: DeterministicResidentRuntimePublicationConfiguration;
	private readonly listeners = new Set<() => void>();
	private state: DeterministicResidentActiveRunOwnerState = INITIAL_STATE;
	private runtime: OwnedResidentRuntime | null = null;
	private pendingStart: PendingStart | null = null;
	private generation = 0;
	private disposed = false;

	constructor(configuration: DeterministicResidentRuntimePublicationConfiguration) {
		const error = deterministicResidentRuntimePublicationConfigurationError(configuration);
		if (error) throw new RangeError(`Resident active-run ${error}.`);
		this.publicationConfiguration = Object.freeze({ ...configuration });
	}

	getState(): DeterministicResidentActiveRunOwnerState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.assertOwnerActive();
		if (typeof listener !== "function")
			throw new TypeError("Resident active-run listener is invalid.");
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	async start(
		grant: SimulationResidentRunAuthorizationGrant,
		input: IssueSimulationResidentRunAuthorizationInput,
		speedMultiplier: DeterministicResidentSpeedMultiplier,
	): Promise<DeterministicResidentActiveRunOwnerState> {
		this.assertOwnerActive();
		if (this.runtime || this.pendingStart) {
			throw new Error("A resident simulation run is already active or starting.");
		}
		assertSpeedMultiplier(speedMultiplier);
		const ticket = Object.freeze({ generation: this.nextGeneration() });
		this.pendingStart = ticket;
		this.publish(Object.freeze({ phase: "STARTING", generation: ticket.generation }));

		let consumed: OwnedResidentRuntime | typeof START_CANCELLED | null;
		try {
			consumed = await consumeSimulationResidentRunAuthorization(
				grant,
				input,
				(authorization, snapshot, adoption) => {
					if (this.disposed || this.pendingStart !== ticket) return START_CANCELLED;
					return createOwnedRuntime(
						authorization,
						snapshot,
						adoption,
						this.publicationConfiguration,
						speedMultiplier,
					);
				},
			);
		} catch (error) {
			if (this.disposed) throw new Error("Resident active-run owner is disposed.");
			if (this.pendingStart !== ticket) return this.state;
			this.pendingStart = null;
			const normalized = normalizeError(error);
			this.publishFailure(ticket.generation, normalized);
			throw normalized;
		}

		if (this.disposed) {
			if (consumed && consumed !== START_CANCELLED) consumed.runtime.dispose("OWNER_DISPOSED");
			throw new Error("Resident active-run owner is disposed.");
		}
		if (this.pendingStart !== ticket) {
			if (consumed && consumed !== START_CANCELLED) consumed.runtime.dispose("SOURCE_INVALIDATED");
			return this.state;
		}
		this.pendingStart = null;
		if (!consumed || consumed === START_CANCELLED) {
			const error = new Error("An exact current one-shot resident Run authorization is required.");
			this.publishFailure(ticket.generation, error);
			throw error;
		}
		this.runtime = consumed;
		this.publish(this.captureActiveState(consumed, ticket.generation));
		return this.state;
	}

	setSpeedMultiplier(speedMultiplier: DeterministicResidentSpeedMultiplier): void {
		this.assertOwnerActive();
		assertSpeedMultiplier(speedMultiplier);
		const runtime = this.requireRuntime();
		if (runtime.speedMultiplier === speedMultiplier) return;
		runtime.speedMultiplier = speedMultiplier;
		this.publish(this.captureActiveState(runtime, this.requireActiveGeneration()));
	}

	advanceByWallClockMicroseconds(
		wallClockMicroseconds: number,
	): DeterministicResidentActiveRunAdvanceResult {
		this.assertOwnerActive();
		if (!Number.isSafeInteger(wallClockMicroseconds) || wallClockMicroseconds < 0) {
			throw new RangeError("Resident active-run wall-clock advance is invalid.");
		}
		const runtime = this.requireRuntime();
		try {
			const transitionCount = runtime.runtime.advanceByWallClockMicroseconds(
				wallClockMicroseconds,
				runtime.speedMultiplier,
			);
			const publication = runtime.publisher.publishIfDue();
			if (publication) {
				runtime.latestPublication = publication;
				this.publish(this.captureActiveState(runtime, this.requireActiveGeneration()));
			}
			return Object.freeze({ transitionCount, publication });
		} catch (error) {
			runtime.runtime.dispose("RUNTIME_FAILURE");
			this.runtime = null;
			const normalized = normalizeError(error);
			this.publishFailure(this.requireLifecycleGeneration(), normalized);
			throw normalized;
		}
	}

	stop(): boolean {
		this.assertOwnerActive();
		return this.stopAndDiscard("EXPLICIT_STOP");
	}

	invalidateSource(
		reason: Exclude<DeterministicResidentActiveRunStopReason, "EXPLICIT_STOP">,
	): boolean {
		this.assertOwnerActive();
		if (
			(reason as string) === "EXPLICIT_STOP" ||
			!DETERMINISTIC_RESIDENT_ACTIVE_RUN_STOP_REASONS.includes(reason)
		) {
			throw new RangeError("Resident active-run source invalidation reason is invalid.");
		}
		return this.stopAndDiscard(reason);
	}

	dispose(): void {
		if (this.disposed) return;
		const hadLifecycle = this.runtime !== null || this.pendingStart !== null;
		const generation = hadLifecycle ? this.requireLifecycleGeneration() : 0;
		this.disposed = true;
		this.pendingStart = null;
		this.runtime?.runtime.dispose("OWNER_DISPOSED");
		this.runtime = null;
		if (hadLifecycle) {
			this.publish(Object.freeze({ phase: "STOPPED", generation, reason: "UNMOUNT" }));
		}
		this.listeners.clear();
	}

	private stopAndDiscard(reason: DeterministicResidentActiveRunStopReason): boolean {
		if (!this.runtime && !this.pendingStart) return false;
		const generation = this.requireLifecycleGeneration();
		this.pendingStart = null;
		if (this.runtime) {
			this.runtime.runtime.dispose(runtimeDisposalReason(reason));
			this.runtime = null;
		}
		this.publish(Object.freeze({ phase: "STOPPED", generation, reason }));
		return true;
	}

	private captureActiveState(
		runtime: OwnedResidentRuntime,
		generation: number,
	): DeterministicResidentActiveRunOwnerState {
		const authorization = runtime.authorization;
		return Object.freeze({
			phase: "ACTIVE",
			generation,
			projectId: authorization.projectId,
			sourceKind: authorization.sourceKind,
			authorizationFingerprint: authorization.fingerprint,
			readinessProfileId: authorization.sourceReadinessProfileId,
			limitations: authorization.limitations,
			requestCount: authorization.requestCount,
			loadCount: authorization.loadCount,
			vehicleCount: authorization.vehicleCount,
			eqResourceCount: authorization.eqResourceCount,
			storageResourceCount: authorization.storageResourceCount,
			speedMultiplier: runtime.speedMultiplier,
			sampledSimulationTimeMicroseconds:
				runtime.latestPublication.sampledSimulationTimeMicroseconds,
			completed: runtime.runtime.allResidentWorkCompleted,
			latestPublication: runtime.latestPublication,
		});
	}

	private publishFailure(generation: number, error: Error): void {
		this.publish(
			Object.freeze({
				phase: "FAILED",
				generation,
				message: error.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
			}),
		);
	}

	private publish(state: DeterministicResidentActiveRunOwnerState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private requireRuntime(): OwnedResidentRuntime {
		if (!this.runtime) throw new Error("No resident simulation run is active.");
		return this.runtime;
	}

	private requireActiveGeneration(): number {
		if (this.state.phase !== "ACTIVE") {
			throw new Error("Resident active-run state is inconsistent.");
		}
		return this.state.generation;
	}

	private requireLifecycleGeneration(): number {
		if (this.state.phase === "IDLE") {
			throw new Error("Resident active-run lifecycle generation is unavailable.");
		}
		return this.state.generation;
	}

	private nextGeneration(): number {
		this.generation =
			this.generation === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, this.generation + 1);
		return this.generation;
	}

	private assertOwnerActive(): void {
		if (this.disposed) throw new Error("Resident active-run owner is disposed.");
	}
}

function createOwnedRuntime(
	authorization: SimulationResidentRunAuthorization,
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	adoption: Parameters<typeof adoptDeterministicResidentRuntimeState>[2],
	configuration: DeterministicResidentRuntimePublicationConfiguration,
	speedMultiplier: DeterministicResidentSpeedMultiplier,
): OwnedResidentRuntime {
	const runtime = adoptDeterministicResidentRuntimeState(authorization, snapshot, adoption);
	try {
		const publisher = new DeterministicResidentRuntimePublisher(snapshot, runtime, configuration);
		const latestPublication = publisher.publishIfDue();
		if (
			!latestPublication ||
			latestPublication.sourceAuthorizationFingerprint !== authorization.fingerprint ||
			latestPublication.sourceCertificateFingerprint !==
				authorization.sourceCertificateFingerprint ||
			latestPublication.eligiblePoseCount !== authorization.vehicleCount
		) {
			throw new Error("Constructed resident runtime did not publish its exact initial state.");
		}
		return { authorization, runtime, publisher, speedMultiplier, latestPublication };
	} catch (error) {
		runtime.dispose("RUNTIME_FAILURE");
		throw error;
	}
}

function runtimeDisposalReason(
	reason: DeterministicResidentActiveRunStopReason,
): DeterministicResidentRuntimeDisposalReason {
	return reason === "EXPLICIT_STOP" ? "EXPLICIT_STOP" : "SOURCE_INVALIDATED";
}

function assertSpeedMultiplier(
	value: number,
): asserts value is DeterministicResidentSpeedMultiplier {
	if (!DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS.includes(value as never)) {
		throw new RangeError("Resident speed multiplier must be 1x, 2x, 4x, 8x, 16x, 32x, or 64x.");
	}
}

function normalizeError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
