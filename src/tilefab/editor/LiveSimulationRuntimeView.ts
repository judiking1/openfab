import {
	type CurrentSimulationRuntimePresentation,
	LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
	type SimulationRuntimePresentationStore,
	simulationRuntimePoseFingerprint,
} from "../render/SimulationRuntimePresentation";
import type { LiveSimulationActiveRunOwnerState } from "./LiveSimulationActiveRunOwner";

export type LiveSimulationRuntimeViewEmptyReason =
	| "NO_ACTIVE_RUN"
	| "ACTIVE_RUN_STOPPED"
	| "ACTIVE_RUN_FAILED";

export type LiveSimulationRuntimeViewState =
	| Readonly<{
			phase: "EMPTY";
			activeRunGeneration: number;
			reason: LiveSimulationRuntimeViewEmptyReason;
	  }>
	| Readonly<{
			phase: "READY";
			snapshot: CurrentSimulationRuntimePresentation;
	  }>
	| Readonly<{
			phase: "FAILED";
			activeRunGeneration: number;
			message: string;
	  }>;

export interface LiveSimulationRuntimeViewSource {
	getState(): LiveSimulationActiveRunOwnerState;
	subscribe(listener: () => void): () => void;
}

const INITIAL_STATE: LiveSimulationRuntimeViewState = Object.freeze({
	phase: "EMPTY",
	activeRunGeneration: 0,
	reason: "NO_ACTIVE_RUN",
});

/**
 * Deduplicates the active owner's latest bounded publication for view consumers. This owner neither
 * advances time nor creates render objects, and clears its current reference on every terminal
 * active-run state.
 */
export class LiveSimulationRuntimeView implements SimulationRuntimePresentationStore {
	private readonly source: LiveSimulationRuntimeViewSource;
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeSource: () => void;
	private state: LiveSimulationRuntimeViewState = INITIAL_STATE;
	private disposed = false;

	constructor(source: LiveSimulationRuntimeViewSource) {
		this.source = source;
		this.unsubscribeSource = source.subscribe(() => this.reconcileSource());
		this.reconcileSource();
	}

	getState(): LiveSimulationRuntimeViewState {
		return this.state;
	}

	getSnapshot(): CurrentSimulationRuntimePresentation | null {
		return this.state.phase === "READY" ? this.state.snapshot : null;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function") {
			throw new TypeError("Simulation runtime view listener is invalid.");
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
			const poseFingerprint = simulationRuntimePoseFingerprint(publication);
			if (
				!publication.resourceExecutionPrepared ||
				publication.runIdentityFingerprint !== sourceState.runIdentityFingerprint ||
				!poseFingerprint
			) {
				this.publishFailure(
					sourceState.generation,
					"Active runtime publication does not match its run identity.",
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
						policy: LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
						activeRunGeneration: sourceState.generation,
						projectId: sourceState.projectId,
						sourceKind: sourceState.sourceKind,
						readinessProfileId: sourceState.readinessProfileId,
						runIdentityFingerprint: sourceState.runIdentityFingerprint,
						poseFingerprint,
						publication,
					}),
				}),
			);
			return;
		}

		const activeRunGeneration = sourceState.generation;
		const reason: LiveSimulationRuntimeViewEmptyReason =
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

	private publish(state: LiveSimulationRuntimeViewState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Simulation runtime view is disposed.");
	}
}
