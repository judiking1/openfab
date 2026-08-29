/// <reference lib="webworker" />

import {
	collectOpenFabFabPreparedProjectResponseTransfers,
	runOpenFabFabPreparedProjectRequest,
} from "./OpenFabFabPreparedProjectRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<unknown>): void => {
	const response = runOpenFabFabPreparedProjectRequest(event.data);
	try {
		self.postMessage(response, collectOpenFabFabPreparedProjectResponseTransfers(response));
	} finally {
		self.close();
	}
};
