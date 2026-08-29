import { describe, expect, it, vi } from "vitest";
import type { OpenFabUserBlueprintLibraryChangePort } from "../project/OpenFabUserBlueprintLibrary";
import {
	UserBlueprintLibraryCrossTabRefreshController,
	type UserBlueprintLibraryCrossTabRefreshScheduler,
} from "./UserBlueprintLibraryCrossTabRefreshController";

describe("UserBlueprintLibraryCrossTabRefreshController", () => {
	it("coalesces a burst into one bounded refresh", async () => {
		const changes = new FakeChangePort();
		const scheduler = new ManualScheduler();
		const refresh = vi.fn(async () => undefined);
		const controller = new UserBlueprintLibraryCrossTabRefreshController(changes, {
			isBlocked: () => false,
			refresh,
			scheduler,
		});

		changes.emit();
		changes.emit();
		changes.emit();
		expect(scheduler.pendingCount).toBe(1);
		expect(controller.getState()).toMatchObject({ notificationCount: 3, pending: true });

		scheduler.flushNext();
		await flushMicrotasks();
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(controller.getState()).toMatchObject({
			refreshCount: 1,
			pending: false,
			inFlight: false,
			lastOutcome: "refreshed",
		});
		controller.dispose();
	});

	it("defers while a local review is blocked and resumes without polling", async () => {
		const changes = new FakeChangePort();
		const scheduler = new ManualScheduler();
		let blocked = true;
		const refresh = vi.fn(async () => undefined);
		const controller = new UserBlueprintLibraryCrossTabRefreshController(changes, {
			isBlocked: () => blocked,
			refresh,
			scheduler,
		});

		changes.emit();
		expect(scheduler.pendingCount).toBe(0);
		expect(controller.getState().pending).toBe(true);
		blocked = false;
		controller.resume();
		expect(scheduler.pendingCount).toBe(1);
		scheduler.flushNext();
		await flushMicrotasks();
		expect(refresh).toHaveBeenCalledTimes(1);
		controller.dispose();
	});

	it("runs one follow-up refresh when changes arrive during an in-flight read", async () => {
		const changes = new FakeChangePort();
		const scheduler = new ManualScheduler();
		const firstRefresh = deferred<void>();
		const refresh = vi
			.fn<(signal: AbortSignal) => Promise<void>>()
			.mockImplementationOnce(() => firstRefresh.promise)
			.mockResolvedValue(undefined);
		const controller = new UserBlueprintLibraryCrossTabRefreshController(changes, {
			isBlocked: () => false,
			refresh,
			scheduler,
		});

		changes.emit();
		scheduler.flushNext();
		expect(controller.getState().inFlight).toBe(true);
		changes.emit();
		changes.emit();
		expect(scheduler.pendingCount).toBe(0);
		firstRefresh.resolve();
		await flushMicrotasks();
		expect(scheduler.pendingCount).toBe(1);
		scheduler.flushNext();
		await flushMicrotasks();

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(controller.getState()).toMatchObject({ notificationCount: 3, refreshCount: 2 });
		controller.dispose();
	});

	it("cancels scheduled and in-flight work during disposal", async () => {
		const changes = new FakeChangePort();
		const scheduler = new ManualScheduler();
		const refreshStarted = deferred<void>();
		const receivedSignals: AbortSignal[] = [];
		const controller = new UserBlueprintLibraryCrossTabRefreshController(changes, {
			isBlocked: () => false,
			refresh: (signal) => {
				receivedSignals.push(signal);
				return refreshStarted.promise;
			},
			scheduler,
		});

		changes.emit();
		scheduler.flushNext();
		controller.dispose();
		expect(receivedSignals[0]?.aborted).toBe(true);
		expect(changes.listenerCount).toBe(0);
		changes.emit();
		expect(scheduler.pendingCount).toBe(0);
		refreshStarted.resolve();
		await flushMicrotasks();
	});
});

class FakeChangePort implements OpenFabUserBlueprintLibraryChangePort {
	readonly available = true;
	private readonly listeners = new Set<() => void>();

	get listenerCount(): number {
		return this.listeners.size;
	}

	publishChange(): void {
		this.emit();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.listeners.clear();
	}

	emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}

class ManualScheduler implements UserBlueprintLibraryCrossTabRefreshScheduler {
	private nextId = 1;
	private readonly callbacks = new Map<number, () => void>();

	get pendingCount(): number {
		return this.callbacks.size;
	}

	schedule(callback: () => void): unknown {
		const id = this.nextId++;
		this.callbacks.set(id, callback);
		return id;
	}

	cancel(handle: unknown): void {
		this.callbacks.delete(handle as number);
	}

	flushNext(): void {
		const entry = this.callbacks.entries().next().value as [number, () => void] | undefined;
		if (!entry) throw new Error("No scheduled cross-tab refresh is available.");
		this.callbacks.delete(entry[0]);
		entry[1]();
	}
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
} {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
