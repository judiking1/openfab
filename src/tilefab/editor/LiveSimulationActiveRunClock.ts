import type { LiveSimulationActiveRunStopReason } from "./LiveSimulationActiveRunOwner";

export const LIVE_SIMULATION_ACTIVE_RUN_CLOCK_POLICY =
	"VISIBLE_FRAME_INTEGER_MICROSECONDS_BOUNDED_CATCH_UP_V1" as const;
export const LIVE_SIMULATION_ACTIVE_RUN_CLOCK_VISIBILITY_POLICY =
	"EXPLICIT_RESUME_NO_HIDDEN_CATCH_UP_V1" as const;
export const LIVE_SIMULATION_ACTIVE_RUN_CLOCK_MINIMUM_FRAME_ADVANCE_MICROSECONDS = 1_000;
export const LIVE_SIMULATION_ACTIVE_RUN_CLOCK_MAXIMUM_FRAME_ADVANCE_MICROSECONDS = 100_000;
export const LIVE_SIMULATION_ACTIVE_RUN_CLOCK_MAXIMUM_PENDING_MICROSECONDS = 1_000_000;

export interface LiveSimulationActiveRunClockConfiguration {
	readonly maximumWallClockAdvancePerFrameMicroseconds: number;
	readonly maximumPendingWallClockMicroseconds: number;
}

export interface LiveSimulationActiveRunClockFramePort {
	requestFrame(callback: (timestampMilliseconds: number) => void): number;
	cancelFrame(handle: number): void;
	isVisible(): boolean;
	subscribeVisibility(listener: () => void): () => void;
}

export interface LiveSimulationActiveRunClockRuntimePort {
	getState():
		| Readonly<{ phase: "ACTIVE"; completed: boolean }>
		| Readonly<{ phase: "IDLE" | "STARTING" | "FAILED" }>
		| Readonly<{ phase: "STOPPED"; reason: LiveSimulationActiveRunStopReason }>;
	subscribe(listener: () => void): () => void;
	advanceByWallClockMicroseconds(wallClockMicroseconds: number): unknown;
}

export type LiveSimulationActiveRunClockPauseReason =
	| "EXPLICIT_PAUSE"
	| "DOCUMENT_HIDDEN"
	| "RUN_COMPLETED";

export type LiveSimulationActiveRunClockStopReason =
	| "EXPLICIT_STOP"
	| "ACTIVE_RUN_STOPPED"
	| "ACTIVE_RUN_UNAVAILABLE";

export interface LiveSimulationActiveRunClockSummary {
	readonly advanceCallCount: number;
	readonly observedWallClockMicroseconds: number;
	readonly advancedWallClockMicroseconds: number;
	readonly discardedWallClockMicroseconds: number;
}

export type LiveSimulationActiveRunClockState =
	| Readonly<{ phase: "IDLE"; generation: 0 }>
	| Readonly<{
			phase: "RUNNING";
			generation: number;
			clockPolicy: typeof LIVE_SIMULATION_ACTIVE_RUN_CLOCK_POLICY;
			visibilityPolicy: typeof LIVE_SIMULATION_ACTIVE_RUN_CLOCK_VISIBILITY_POLICY;
			maximumWallClockAdvancePerFrameMicroseconds: number;
			maximumPendingWallClockMicroseconds: number;
	  }>
	| Readonly<{
			phase: "PAUSED";
			generation: number;
			reason: LiveSimulationActiveRunClockPauseReason;
			summary: LiveSimulationActiveRunClockSummary;
	  }>
	| Readonly<{
			phase: "STOPPED";
			generation: number;
			reason: LiveSimulationActiveRunClockStopReason;
			activeRunStopReason: LiveSimulationActiveRunStopReason | null;
			summary: LiveSimulationActiveRunClockSummary;
	  }>
	| Readonly<{
			phase: "FAILED";
			generation: number;
			message: string;
			summary: LiveSimulationActiveRunClockSummary;
	  }>;

const INITIAL_STATE: LiveSimulationActiveRunClockState = Object.freeze({
	phase: "IDLE",
	generation: 0,
});
const MAX_FAILURE_MESSAGE_LENGTH = 240;

/**
 * Converts a visible frame source into bounded integer wall-time advances. Renderer cadence never
 * enters the scheduler: delayed visible frames become a bounded backlog, hidden time is discarded,
 * and resumption is always explicit.
 */
export class LiveSimulationActiveRunClock {
	private readonly runtime: LiveSimulationActiveRunClockRuntimePort;
	private readonly frames: LiveSimulationActiveRunClockFramePort;
	private readonly configuration: LiveSimulationActiveRunClockConfiguration;
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeRuntime: () => void;
	private readonly unsubscribeVisibility: () => void;
	private state: LiveSimulationActiveRunClockState = INITIAL_STATE;
	private generation = 0;
	private frameHandle = 0;
	private lastFrameTimestampMicroseconds: number | null = null;
	private pendingWallClockMicroseconds = 0;
	private advanceCallCount = 0;
	private observedWallClockMicroseconds = 0;
	private advancedWallClockMicroseconds = 0;
	private discardedWallClockMicroseconds = 0;
	private runtimeAdvanceInProgress = false;
	private disposed = false;

	constructor(
		runtime: LiveSimulationActiveRunClockRuntimePort,
		frames: LiveSimulationActiveRunClockFramePort,
		configuration: LiveSimulationActiveRunClockConfiguration,
	) {
		assertClockConfiguration(configuration);
		this.runtime = runtime;
		this.frames = frames;
		this.configuration = Object.freeze({ ...configuration });
		this.unsubscribeRuntime = runtime.subscribe(() => this.reconcileRuntime());
		this.unsubscribeVisibility = frames.subscribeVisibility(() => this.reconcileVisibility());
	}

	getState(): LiveSimulationActiveRunClockState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function")
			throw new TypeError("Simulation clock listener is invalid.");
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	start(): void {
		this.assertActive();
		if (this.state.phase === "RUNNING") return;
		if (this.state.phase === "PAUSED") {
			this.resume();
			return;
		}
		this.assertRunnableAndVisible();
		this.generation = nextPositiveGeneration(this.generation);
		this.resetRunMetrics();
		this.publishRunning();
		try {
			this.scheduleFrame();
		} catch (error) {
			const normalized = normalizeError(error);
			this.fail(normalized);
			throw normalized;
		}
	}

	pause(): boolean {
		this.assertActive();
		return this.pauseInternal("EXPLICIT_PAUSE");
	}

	resume(): void {
		this.assertActive();
		if (this.state.phase !== "PAUSED") {
			throw new Error("A paused simulation clock is required before Resume.");
		}
		this.assertRunnableAndVisible();
		this.resetFrameBaseline();
		this.publishRunning();
		try {
			this.scheduleFrame();
		} catch (error) {
			const normalized = normalizeError(error);
			this.fail(normalized);
			throw normalized;
		}
	}

	stop(): boolean {
		this.assertActive();
		if (this.state.phase === "IDLE" || this.state.phase === "STOPPED") return false;
		this.stopInternal("EXPLICIT_STOP", null);
		return true;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelScheduledFrame();
		this.unsubscribeRuntime();
		this.unsubscribeVisibility();
		this.listeners.clear();
	}

	private scheduleFrame(): void {
		if (this.frameHandle !== 0 || this.state.phase !== "RUNNING") return;
		this.frameHandle = this.frames.requestFrame((timestamp) => this.onFrame(timestamp));
		if (!Number.isSafeInteger(this.frameHandle) || this.frameHandle <= 0) {
			throw new Error("Simulation clock frame handle is invalid.");
		}
	}

	private onFrame(timestampMilliseconds: number): void {
		this.frameHandle = 0;
		if (this.disposed || this.state.phase !== "RUNNING") return;
		if (!this.frames.isVisible()) {
			this.pauseInternal("DOCUMENT_HIDDEN");
			return;
		}
		const runtimeState = this.runtime.getState();
		if (runtimeState.phase !== "ACTIVE") {
			this.stopForRuntime(runtimeState);
			return;
		}
		if (runtimeState.completed) {
			this.pauseInternal("RUN_COMPLETED");
			return;
		}
		try {
			const timestampMicroseconds = frameTimestampMicroseconds(timestampMilliseconds);
			if (this.lastFrameTimestampMicroseconds === null) {
				this.lastFrameTimestampMicroseconds = timestampMicroseconds;
				this.scheduleFrame();
				return;
			}
			if (timestampMicroseconds < this.lastFrameTimestampMicroseconds) {
				throw new RangeError("Simulation clock frame timestamps must be monotonic.");
			}
			const observedDelta = timestampMicroseconds - this.lastFrameTimestampMicroseconds;
			this.lastFrameTimestampMicroseconds = timestampMicroseconds;
			this.observeDelta(observedDelta);
			const advance = Math.min(
				this.pendingWallClockMicroseconds,
				this.configuration.maximumWallClockAdvancePerFrameMicroseconds,
			);
			if (advance > 0) {
				this.pendingWallClockMicroseconds -= advance;
				this.runtimeAdvanceInProgress = true;
				try {
					this.runtime.advanceByWallClockMicroseconds(advance);
				} catch (error) {
					this.pendingWallClockMicroseconds += advance;
					throw error;
				} finally {
					this.runtimeAdvanceInProgress = false;
				}
				this.advanceCallCount++;
				this.advancedWallClockMicroseconds += advance;
				this.reconcileRuntime();
			}
			if (this.state.phase === "RUNNING") this.scheduleFrame();
		} catch (error) {
			this.fail(normalizeError(error));
		}
	}

	private observeDelta(observedDelta: number): void {
		if (!Number.isSafeInteger(observedDelta) || observedDelta < 0) {
			throw new RangeError("Simulation clock observed wall-time delta is invalid.");
		}
		this.observedWallClockMicroseconds = checkedSum(
			this.observedWallClockMicroseconds,
			observedDelta,
			"observed wall time",
		);
		const unboundedPending = checkedSum(
			this.pendingWallClockMicroseconds,
			observedDelta,
			"pending wall time",
		);
		const boundedPending = Math.min(
			unboundedPending,
			this.configuration.maximumPendingWallClockMicroseconds,
		);
		this.discardedWallClockMicroseconds = checkedSum(
			this.discardedWallClockMicroseconds,
			unboundedPending - boundedPending,
			"discarded wall time",
		);
		this.pendingWallClockMicroseconds = boundedPending;
	}

	private reconcileRuntime(): void {
		if (this.runtimeAdvanceInProgress) return;
		if (this.state.phase !== "RUNNING" && this.state.phase !== "PAUSED") return;
		const runtimeState = this.runtime.getState();
		if (runtimeState.phase !== "ACTIVE") {
			this.stopForRuntime(runtimeState);
			return;
		}
		if (runtimeState.completed && this.state.phase === "RUNNING") {
			this.pauseInternal("RUN_COMPLETED");
		}
	}

	private reconcileVisibility(): void {
		if (this.state.phase === "RUNNING" && !this.frames.isVisible()) {
			this.pauseInternal("DOCUMENT_HIDDEN");
		}
	}

	private pauseInternal(reason: LiveSimulationActiveRunClockPauseReason): boolean {
		if (this.state.phase !== "RUNNING") return false;
		this.cancelScheduledFrame();
		this.discardPendingWallTime();
		this.resetFrameBaseline();
		this.publish(
			Object.freeze({
				phase: "PAUSED",
				generation: this.generation,
				reason,
				summary: this.summary(),
			}),
		);
		return true;
	}

	private stopForRuntime(
		runtimeState: ReturnType<LiveSimulationActiveRunClockRuntimePort["getState"]>,
	): void {
		this.stopInternal(
			runtimeState.phase === "STOPPED" ? "ACTIVE_RUN_STOPPED" : "ACTIVE_RUN_UNAVAILABLE",
			runtimeState.phase === "STOPPED" ? runtimeState.reason : null,
		);
	}

	private stopInternal(
		reason: LiveSimulationActiveRunClockStopReason,
		activeRunStopReason: LiveSimulationActiveRunStopReason | null,
	): void {
		this.cancelScheduledFrame();
		this.discardPendingWallTime();
		this.resetFrameBaseline();
		this.publish(
			Object.freeze({
				phase: "STOPPED",
				generation: this.generation,
				reason,
				activeRunStopReason,
				summary: this.summary(),
			}),
		);
	}

	private fail(error: Error): void {
		this.cancelScheduledFrame();
		this.discardPendingWallTime();
		this.resetFrameBaseline();
		this.publish(
			Object.freeze({
				phase: "FAILED",
				generation: this.generation,
				message: error.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
				summary: this.summary(),
			}),
		);
	}

	private publishRunning(): void {
		this.publish(
			Object.freeze({
				phase: "RUNNING",
				generation: this.generation,
				clockPolicy: LIVE_SIMULATION_ACTIVE_RUN_CLOCK_POLICY,
				visibilityPolicy: LIVE_SIMULATION_ACTIVE_RUN_CLOCK_VISIBILITY_POLICY,
				maximumWallClockAdvancePerFrameMicroseconds:
					this.configuration.maximumWallClockAdvancePerFrameMicroseconds,
				maximumPendingWallClockMicroseconds: this.configuration.maximumPendingWallClockMicroseconds,
			}),
		);
	}

	private publish(state: LiveSimulationActiveRunClockState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private summary(): LiveSimulationActiveRunClockSummary {
		return Object.freeze({
			advanceCallCount: this.advanceCallCount,
			observedWallClockMicroseconds: this.observedWallClockMicroseconds,
			advancedWallClockMicroseconds: this.advancedWallClockMicroseconds,
			discardedWallClockMicroseconds: this.discardedWallClockMicroseconds,
		});
	}

	private discardPendingWallTime(): void {
		this.discardedWallClockMicroseconds = checkedSum(
			this.discardedWallClockMicroseconds,
			this.pendingWallClockMicroseconds,
			"discarded wall time",
		);
		this.pendingWallClockMicroseconds = 0;
	}

	private resetRunMetrics(): void {
		this.resetFrameBaseline();
		this.advanceCallCount = 0;
		this.observedWallClockMicroseconds = 0;
		this.advancedWallClockMicroseconds = 0;
		this.discardedWallClockMicroseconds = 0;
	}

	private resetFrameBaseline(): void {
		this.lastFrameTimestampMicroseconds = null;
	}

	private cancelScheduledFrame(): void {
		if (this.frameHandle === 0) return;
		this.frames.cancelFrame(this.frameHandle);
		this.frameHandle = 0;
	}

	private assertRunnableAndVisible(): void {
		const runtimeState = this.runtime.getState();
		if (runtimeState.phase !== "ACTIVE" || runtimeState.completed) {
			throw new Error("An incomplete active simulation runtime is required before clock Run.");
		}
		if (!this.frames.isVisible()) {
			throw new Error("Simulation clock cannot Run while the document is hidden.");
		}
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Simulation active-run clock is disposed.");
	}
}

function assertClockConfiguration(value: LiveSimulationActiveRunClockConfiguration): void {
	if (
		typeof value !== "object" ||
		value === null ||
		Object.keys(value).length !== 2 ||
		!Object.hasOwn(value, "maximumWallClockAdvancePerFrameMicroseconds") ||
		!Object.hasOwn(value, "maximumPendingWallClockMicroseconds") ||
		!Number.isSafeInteger(value.maximumWallClockAdvancePerFrameMicroseconds) ||
		value.maximumWallClockAdvancePerFrameMicroseconds <
			LIVE_SIMULATION_ACTIVE_RUN_CLOCK_MINIMUM_FRAME_ADVANCE_MICROSECONDS ||
		value.maximumWallClockAdvancePerFrameMicroseconds >
			LIVE_SIMULATION_ACTIVE_RUN_CLOCK_MAXIMUM_FRAME_ADVANCE_MICROSECONDS ||
		!Number.isSafeInteger(value.maximumPendingWallClockMicroseconds) ||
		value.maximumPendingWallClockMicroseconds < value.maximumWallClockAdvancePerFrameMicroseconds ||
		value.maximumPendingWallClockMicroseconds >
			LIVE_SIMULATION_ACTIVE_RUN_CLOCK_MAXIMUM_PENDING_MICROSECONDS
	) {
		throw new RangeError("Simulation active-run clock configuration is invalid.");
	}
}

function frameTimestampMicroseconds(timestampMilliseconds: number): number {
	const microseconds = Math.round(timestampMilliseconds * 1_000);
	if (
		!Number.isFinite(timestampMilliseconds) ||
		!Number.isSafeInteger(microseconds) ||
		microseconds < 0
	) {
		throw new RangeError("Simulation clock frame timestamp is invalid.");
	}
	return microseconds;
}

function checkedSum(left: number, right: number, label: string): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum) || sum < 0) {
		throw new RangeError(`Simulation clock ${label} exceeded the safe integer range.`);
	}
	return sum;
}

function nextPositiveGeneration(current: number): number {
	return current === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, current + 1);
}

function normalizeError(error: unknown): Error {
	return error instanceof Error && error.message.length > 0
		? error
		: new Error("Simulation active-run clock failed.");
}
