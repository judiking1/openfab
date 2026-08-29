/// <reference lib="webworker" />

import type {
	BlueprintPlacementWorkerRequest,
	BlueprintPlacementWorkerResponse,
} from "./BlueprintPlacementProtocol";
import { prepareBlueprintPlacement } from "./BlueprintPlacementRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<BlueprintPlacementWorkerRequest>): void => {
	const request = event.data;
	try {
		const response: BlueprintPlacementWorkerResponse = {
			type: "BLUEPRINT_PLACEMENT_PREPARED",
			requestId: request.requestId,
			prepared: prepareBlueprintPlacement(request),
		};
		self.postMessage(response);
	} catch (error) {
		const response: BlueprintPlacementWorkerResponse = {
			type: "BLUEPRINT_PLACEMENT_ERROR",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : "Unknown blueprint placement failure.",
		};
		self.postMessage(response);
	}
};
