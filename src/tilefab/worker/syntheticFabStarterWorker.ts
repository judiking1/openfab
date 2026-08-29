import { prepareSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import type {
	SyntheticFabStarterWorkerRequest,
	SyntheticFabStarterWorkerResponse,
} from "./SyntheticFabStarterProtocol";
import { collectTransferableBuffers } from "./TransferableBuffers";

self.onmessage = (event: MessageEvent<SyntheticFabStarterWorkerRequest>): void => {
	const request = event.data;
	if (request.type !== "PREPARE_SYNTHETIC_FAB_STARTER") return;
	try {
		const prepared = prepareSyntheticFabStarter(request.starter);
		const response: SyntheticFabStarterWorkerResponse = {
			type: "SYNTHETIC_FAB_STARTER_PREPARED",
			requestId: request.requestId,
			prepared,
		};
		self.postMessage(response, {
			transfer: collectTransferableBuffers(prepared),
		});
	} catch (error) {
		const response: SyntheticFabStarterWorkerResponse = {
			type: "SYNTHETIC_FAB_STARTER_PREPARATION_ERROR",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : "Unknown FAB starter preparation error.",
		};
		self.postMessage(response);
	}
};
