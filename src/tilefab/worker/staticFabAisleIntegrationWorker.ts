/// <reference lib="webworker" />
import {
	discoverStaticFabAisleIntegration,
	prepareStaticFabAisleIntegration,
	type StaticFabAisleIntegrationWorkerRequest,
	type StaticFabAisleIntegrationWorkerResponse,
} from "./StaticFabAisleIntegrationRuntime";

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<StaticFabAisleIntegrationWorkerRequest>): void => {
	const request = event.data;
	const response: StaticFabAisleIntegrationWorkerResponse =
		request.type === "DISCOVER_STATIC_FAB_AISLE_INTEGRATION"
			? {
					type: "STATIC_FAB_AISLE_INTEGRATION_DISCOVERED",
					version: 1,
					requestId: request.requestId,
					discovered: discoverStaticFabAisleIntegration(request),
				}
			: {
					type: "STATIC_FAB_AISLE_INTEGRATION_PREPARED",
					version: 1,
					requestId: request.requestId,
					prepared: prepareStaticFabAisleIntegration(request),
				};
	self.postMessage(response);
};
