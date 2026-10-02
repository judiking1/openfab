/// <reference lib="webworker" />

import { checkStaticFabProcessLoopTopologyInWorker } from "./StaticFabProcessLoopTopologyRuntime";

declare const self: DedicatedWorkerGlobalScope;

let consumed = false;
self.onmessage = (event: MessageEvent<unknown>): void => {
	// Success and rejection both consume this disposable generation. The main bridge terminates it.
	if (consumed) return;
	consumed = true;
	self.postMessage(checkStaticFabProcessLoopTopologyInWorker(event.data));
};
