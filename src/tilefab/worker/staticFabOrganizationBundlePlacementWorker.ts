/// <reference lib="webworker" />

import type {
	StaticFabOrganizationBundlePlacementWorkerRequest,
	StaticFabOrganizationBundlePlacementWorkerResponse,
} from "./StaticFabOrganizationBundlePlacementProtocol";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT,
	staticFabOrganizationBundlePlacementPreparedShapeError,
} from "./StaticFabOrganizationBundlePlacementResponseValidator";
import { prepareStaticFabOrganizationBundlePlacement } from "./StaticFabOrganizationBundlePlacementRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<StaticFabOrganizationBundlePlacementWorkerRequest>): void => {
	const request = event.data;
	try {
		const prepared = prepareStaticFabOrganizationBundlePlacement(request);
		const preparedError = staticFabOrganizationBundlePlacementPreparedShapeError(prepared);
		if (preparedError) {
			throw new Error(`Organization-bundle placement Worker output is invalid: ${preparedError}.`);
		}
		const response: StaticFabOrganizationBundlePlacementWorkerResponse = {
			type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED",
			requestId: request.requestId,
			prepared,
		};
		self.postMessage(response);
	} catch (error) {
		const response: StaticFabOrganizationBundlePlacementWorkerResponse = {
			type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_ERROR",
			requestId: request.requestId,
			message: (error instanceof Error
				? error.message
				: "Unknown organization-bundle placement failure."
			).slice(0, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT),
		};
		self.postMessage(response);
	}
};
