import type { OpenFabUserBlueprintLibraryChangePort } from "../project/OpenFabUserBlueprintLibrary";

const OPENFAB_USER_BLUEPRINT_REMOTE_REFRESH_DELAY_MILLISECONDS = 24;

export interface UserBlueprintLibraryCrossTabRefreshState {
	readonly available: boolean;
	readonly notificationCount: number;
	readonly refreshCount: number;
	readonly pending: boolean;
	readonly inFlight: boolean;
	readonly lastOutcome: "idle" | "refreshed" | "failed";
}

export interface UserBlueprintLibraryCrossTabRefreshScheduler {
	schedule(callback: () => void, delayMilliseconds: number): unknown;
	cancel(handle: unknown): void;
}

export interface UserBlueprintLibraryCrossTabRefreshControllerOptions {
	readonly isBlocked: () => boolean;
	readonly refresh: (signal: AbortSignal) => Promise<void>;
	readonly onStateChange?: (state: UserBlueprintLibraryCrossTabRefreshState) => void;
	readonly scheduler?: UserBlueprintLibraryCrossTabRefreshScheduler;
}

export function createInitialUserBlueprintLibraryCrossTabRefreshState(
	available = false,
): UserBlueprintLibraryCrossTabRefreshState {
	return Object.freeze({
		available,
		notificationCount: 0,
		refreshCount: 0,
		pending: false,
		inFlight: false,
		lastOutcome: "idle",
	});
}

export class UserBlueprintLibraryCrossTabRefreshController {
	private readonly options: UserBlueprintLibraryCrossTabRefreshControllerOptions;
	private readonly scheduler: UserBlueprintLibraryCrossTabRefreshScheduler;
	private readonly unsubscribe: () => void;
	private state: UserBlueprintLibraryCrossTabRefreshState;
	private scheduledHandle: unknown = null;
	private refreshController: AbortController | null = null;
	private disposed = false;

	constructor(
		changePort: OpenFabUserBlueprintLibraryChangePort,
		options: UserBlueprintLibraryCrossTabRefreshControllerOptions,
	) {
		this.options = options;
		this.scheduler = options.scheduler ?? BROWSER_REFRESH_SCHEDULER;
		this.state = createInitialUserBlueprintLibraryCrossTabRefreshState(changePort.available);
		this.unsubscribe = changePort.subscribe(() => this.receiveNotification());
		this.publishState();
	}

	getState(): UserBlueprintLibraryCrossTabRefreshState {
		return this.state;
	}

	resume(): void {
		if (this.disposed || !this.state.pending) return;
		this.scheduleDrain();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
		if (this.scheduledHandle !== null) {
			this.scheduler.cancel(this.scheduledHandle);
			this.scheduledHandle = null;
		}
		this.refreshController?.abort();
		this.refreshController = null;
	}

	private receiveNotification(): void {
		if (this.disposed) return;
		this.state = Object.freeze({
			...this.state,
			notificationCount: this.state.notificationCount + 1,
			pending: true,
		});
		this.publishState();
		this.scheduleDrain();
	}

	private scheduleDrain(): void {
		if (
			this.disposed ||
			this.scheduledHandle !== null ||
			this.refreshController !== null ||
			!this.state.pending ||
			this.options.isBlocked()
		) {
			return;
		}
		this.scheduledHandle = this.scheduler.schedule(() => {
			this.scheduledHandle = null;
			void this.drain();
		}, OPENFAB_USER_BLUEPRINT_REMOTE_REFRESH_DELAY_MILLISECONDS);
	}

	private async drain(): Promise<void> {
		if (this.disposed || !this.state.pending || this.options.isBlocked()) return;
		const controller = new AbortController();
		this.refreshController = controller;
		this.state = Object.freeze({ ...this.state, pending: false, inFlight: true });
		this.publishState();
		let outcome: UserBlueprintLibraryCrossTabRefreshState["lastOutcome"] = "refreshed";
		try {
			await this.options.refresh(controller.signal);
		} catch {
			if (!controller.signal.aborted) outcome = "failed";
		}
		if (this.refreshController === controller) this.refreshController = null;
		if (this.disposed) return;
		this.state = Object.freeze({
			...this.state,
			refreshCount: this.state.refreshCount + (outcome === "refreshed" ? 1 : 0),
			inFlight: false,
			lastOutcome: outcome,
		});
		this.publishState();
		this.scheduleDrain();
	}

	private publishState(): void {
		this.options.onStateChange?.(this.state);
	}
}

const BROWSER_REFRESH_SCHEDULER: UserBlueprintLibraryCrossTabRefreshScheduler = Object.freeze({
	schedule(callback: () => void, delayMilliseconds: number) {
		return globalThis.setTimeout(callback, delayMilliseconds);
	},
	cancel(handle: unknown) {
		globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
});
