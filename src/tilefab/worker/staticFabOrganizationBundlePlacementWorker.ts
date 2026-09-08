/// <reference lib="webworker" />

import {
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
	type StaticFabOrganizationBundlePlacementWorkerRequest,
	type StaticFabOrganizationBundlePlacementWorkerResponse,
} from "./StaticFabOrganizationBundlePlacementProtocol";
import { STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT } from "./StaticFabOrganizationBundlePlacementResponseValidator";
import { prepareStaticFabOrganizationBundlePlacement } from "./StaticFabOrganizationBundlePlacementRuntime";
import { encodeStaticFabOrganizationBundlePlacementTransport } from "./StaticFabOrganizationBundlePlacementTransport";
import { collectTransferableBuffers } from "./TransferableBuffers";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<StaticFabOrganizationBundlePlacementWorkerRequest>): void => {
	const request = event.data;
	try {
		if (request.version !== STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION)
			throw new Error("Unsupported organization-bundle placement protocol version.");
		const prepared = prepareStaticFabOrganizationBundlePlacement(request);
		const response: StaticFabOrganizationBundlePlacementWorkerResponse = {
			version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
			type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED",
			requestId: request.requestId,
			payload: encodeStaticFabOrganizationBundlePlacementTransport(prepared),
		};
		self.postMessage(response, collectTransferableBuffers(response));
	} catch (error) {
		const response: StaticFabOrganizationBundlePlacementWorkerResponse = {
			version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
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
