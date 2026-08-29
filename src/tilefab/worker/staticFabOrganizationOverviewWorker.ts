/// <reference lib="webworker" />

import {
	prepareStaticFabOrganizationOverview,
	type StaticFabOrganizationOverviewWorkerRequest,
	type StaticFabOrganizationOverviewWorkerResponse,
} from "./StaticFabOrganizationOverviewRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<StaticFabOrganizationOverviewWorkerRequest>): void => {
	const request = event.data;
	const requestId = Number.isSafeInteger(request?.requestId) ? request.requestId : 0;
	try {
		const response: StaticFabOrganizationOverviewWorkerResponse = {
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED",
			requestId,
			prepared: prepareStaticFabOrganizationOverview(request),
		};
		self.postMessage(response, {
			transfer: collectTransferableBuffers(response.prepared),
		});
	} catch (error) {
		const response: StaticFabOrganizationOverviewWorkerResponse = {
			type: "STATIC_FAB_ORGANIZATION_OVERVIEW_ERROR",
			requestId,
			message:
				error instanceof Error
					? error.message
					: "Unknown Static FAB organization overview failure.",
		};
		self.postMessage(response);
	}
};
