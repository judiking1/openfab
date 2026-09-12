import { createBrowserRailStartupScheduler } from "./RailEditorStartup";

/** Keep ordinary UI tasks runnable between prioritized preparation continuations. */
export function createStaticFabArrangementCheckpoint(): () => Promise<void> {
	const scheduler = createBrowserRailStartupScheduler();
	let lastTaskQueueYield = Number.NEGATIVE_INFINITY;
	return async () => {
		if (scheduler.now() - lastTaskQueueYield >= 16) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			lastTaskQueueYield = scheduler.now();
		} else {
			await scheduler.yield();
		}
	};
}
