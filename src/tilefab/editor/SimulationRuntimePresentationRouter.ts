import {
	LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	type SimulationRuntimePresentation,
	type SimulationRuntimePresentationStore,
} from "../render/SimulationRuntimePresentation";

export type SimulationRuntimePresentationProfile = "CURRENT" | "RESIDENT";

export type SimulationRuntimePresentationRouterState =
	| Readonly<{ phase: "EMPTY" }>
	| Readonly<{
			phase: "READY";
			profile: SimulationRuntimePresentationProfile;
			snapshot: SimulationRuntimePresentation;
	  }>
	| Readonly<{
			phase: "FAILED";
			message: "Current and resident runtime presentations cannot be active together.";
	  }>;

const INITIAL_STATE: SimulationRuntimePresentationRouterState = Object.freeze({ phase: "EMPTY" });
const CONFLICT_MESSAGE =
	"Current and resident runtime presentations cannot be active together." as const;

/** Selects exactly one profile presentation and fails closed rather than merging runtime rows. */
export class SimulationRuntimePresentationRouter implements SimulationRuntimePresentationStore {
	private readonly current: SimulationRuntimePresentationStore;
	private readonly resident: SimulationRuntimePresentationStore;
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeCurrent: () => void;
	private readonly unsubscribeResident: () => void;
	private state: SimulationRuntimePresentationRouterState = INITIAL_STATE;
	private disposed = false;

	constructor(
		current: SimulationRuntimePresentationStore,
		resident: SimulationRuntimePresentationStore,
	) {
		if (current === resident) {
			throw new Error("Current and resident runtime presentation stores must be distinct.");
		}
		this.current = current;
		this.resident = resident;
		this.unsubscribeCurrent = current.subscribe(() => this.reconcile());
		this.unsubscribeResident = resident.subscribe(() => this.reconcile());
		this.reconcile();
	}

	getState(): SimulationRuntimePresentationRouterState {
		return this.state;
	}

	getSnapshot(): SimulationRuntimePresentation | null {
		return this.state.phase === "READY" ? this.state.snapshot : null;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function") {
			throw new TypeError("Simulation runtime presentation router listener is invalid.");
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
		this.unsubscribeCurrent();
		this.unsubscribeResident();
		this.listeners.clear();
		this.state = INITIAL_STATE;
	}

	private reconcile(): void {
		if (this.disposed) return;
		const current = this.current.getSnapshot();
		const resident = this.resident.getSnapshot();
		if (current && current.policy !== LIVE_SIMULATION_RUNTIME_VIEW_POLICY) {
			this.publishFailure();
			return;
		}
		if (resident && resident.policy !== RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY) {
			this.publishFailure();
			return;
		}
		if (current && resident) {
			this.publishFailure();
			return;
		}
		const snapshot = current ?? resident;
		if (!snapshot) {
			if (this.state.phase !== "EMPTY") this.publish(INITIAL_STATE);
			return;
		}
		const profile: SimulationRuntimePresentationProfile = current ? "CURRENT" : "RESIDENT";
		if (
			this.state.phase === "READY" &&
			this.state.profile === profile &&
			this.state.snapshot === snapshot
		) {
			return;
		}
		this.publish(Object.freeze({ phase: "READY", profile, snapshot }));
	}

	private publishFailure(): void {
		if (this.state.phase === "FAILED") return;
		this.publish(Object.freeze({ phase: "FAILED", message: CONFLICT_MESSAGE }));
	}

	private publish(state: SimulationRuntimePresentationRouterState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Simulation runtime presentation router is disposed.");
	}
}
