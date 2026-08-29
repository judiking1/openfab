/// <reference lib="webworker" />

import type {
	StaticFabHierarchyWorkerRequest,
	StaticFabHierarchyWorkerResponse,
} from "./StaticFabHierarchyProtocol";
import { prepareStaticFabHierarchy } from "./StaticFabHierarchyRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<StaticFabHierarchyWorkerRequest>): void => {
	const request = event.data;
	try {
		const response: StaticFabHierarchyWorkerResponse = {
			type: "STATIC_FAB_HIERARCHY_PREPARED",
			requestId: request.requestId,
			prepared: prepareStaticFabHierarchy(request),
		};
		self.postMessage(response, {
			transfer: collectTransferableBuffers(response),
		});
	} catch (error) {
		const response: StaticFabHierarchyWorkerResponse = {
			type: "STATIC_FAB_HIERARCHY_ERROR",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : "Unknown FAB hierarchy failure.",
		};
		self.postMessage(response);
	}
};
