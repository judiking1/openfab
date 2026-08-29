import {
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	type ResidentSimulationRuntimePresentation,
	type SimulationRuntimePresentationStore,
	simulationResidentRuntimePoseFingerprint,
} from "../render/SimulationRuntimePresentation";
import type { DeterministicResidentActiveRunOwnerState } from "../simulation/DeterministicResidentActiveRunOwner";

export type ResidentSimulationRuntimeViewEmptyReason =
	| "NO_ACTIVE_RUN"
	| "ACTIVE_RUN_STOPPED"
	| "ACTIVE_RUN_FAILED";

export type ResidentSimulationRuntimeViewState =
	| Readonly<{
			phase: "EMPTY";
			activeRunGeneration: number;
			reason: ResidentSimulationRuntimeViewEmptyReason;
	  }>
	| Readonly<{
			phase: "READY";
			snapshot: ResidentSimulationRuntimePresentation;
	  }>
	| Readonly<{
			phase: "FAILED";
			activeRunGeneration: number;
			message: string;
	  }>;

export interface ResidentSimulationRuntimeViewSource {
	getState(): DeterministicResidentActiveRunOwnerState;
	subscribe(listener: () => void): () => void;
}

const INITIAL_STATE: ResidentSimulationRuntimeViewState = Object.freeze({
	phase: "EMPTY",
	activeRunGeneration: 0,
	reason: "NO_ACTIVE_RUN",
});

/**
 * Deduplicates one bounded resident publication for renderer consumers. It cannot advance the
 * runtime and drops the borrowed publication synchronously on Stop, failure, or source invalidation.
 */
export class ResidentSimulationRuntimeView implements SimulationRuntimePresentationStore {
	private readonly source: ResidentSimulationRuntimeViewSource;
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeSource: () => void;
	private state: ResidentSimulationRuntimeViewState = INITIAL_STATE;
	private disposed = false;

	constructor(source: ResidentSimulationRuntimeViewSource) {
		this.source = source;
		this.unsubscribeSource = source.subscribe(() => this.reconcileSource());
		this.reconcileSource();
	}

	getState(): ResidentSimulationRuntimeViewState {
		return this.state;
	}

	getSnapshot(): ResidentSimulationRuntimePresentation | null {
		return this.state.phase === "READY" ? this.state.snapshot : null;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function") {
			throw new TypeError("Resident simulation runtime view listener is invalid.");
		}
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeSource();
		this.listeners.clear();
		this.state = INITIAL_STATE;
	}

	private reconcileSource(): void {
		if (this.disposed) return;
		const sourceState = this.source.getState();
		if (sourceState.phase === "ACTIVE") {
			const publication = sourceState.latestPublication;
			const poseFingerprint = simulationResidentRuntimePoseFingerprint(publication);
			if (
				publication.sourceAuthorizationFingerprint !== sourceState.authorizationFingerprint ||
				!poseFingerprint
			) {
				this.publishFailure(
					sourceState.generation,
					"Resident runtime publication does not match its authorization identity.",
				);
				return;
			}
			if (
				this.state.phase === "READY" &&
				this.state.snapshot.activeRunGeneration === sourceState.generation &&
				this.state.snapshot.publication === publication
			) {
				return;
			}
			this.publish(
				Object.freeze({
					phase: "READY",
					snapshot: Object.freeze({
						policy: RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
						activeRunGeneration: sourceState.generation,
						projectId: sourceState.projectId,
						sourceKind: sourceState.sourceKind,
						readinessProfileId: sourceState.readinessProfileId,
						authorizationFingerprint: sourceState.authorizationFingerprint,
						certificateFingerprint: publication.sourceCertificateFingerprint,
						poseFingerprint,
						publication,
					}),
				}),
			);
			return;
		}

		const activeRunGeneration = sourceState.generation;
		const reason: ResidentSimulationRuntimeViewEmptyReason =
			sourceState.phase === "STOPPED"
				? "ACTIVE_RUN_STOPPED"
				: sourceState.phase === "FAILED"
					? "ACTIVE_RUN_FAILED"
					: "NO_ACTIVE_RUN";
		if (
			this.state.phase === "EMPTY" &&
			this.state.activeRunGeneration === activeRunGeneration &&
			this.state.reason === reason
		) {
			return;
		}
		this.publish(Object.freeze({ phase: "EMPTY", activeRunGeneration, reason }));
	}

	private publishFailure(activeRunGeneration: number, message: string): void {
		if (
			this.state.phase === "FAILED" &&
			this.state.activeRunGeneration === activeRunGeneration &&
			this.state.message === message
		) {
			return;
		}
		this.publish(Object.freeze({ phase: "FAILED", activeRunGeneration, message }));
	}

	private publish(state: ResidentSimulationRuntimeViewState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Resident simulation runtime view is disposed.");
	}
}
