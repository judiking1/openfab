/// <reference lib="webworker" />

import {
	collectOpenFabStationProposalResponseTransfers,
	runOpenFabStationProposalWorkerRequest,
} from "./OpenFabStationProposalRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<unknown>): void => {
	self.onmessage = null;
	const response = runOpenFabStationProposalWorkerRequest(event.data);
	try {
		self.postMessage(response, {
			transfer: collectOpenFabStationProposalResponseTransfers(response),
		});
	} finally {
		self.close();
	}
};
