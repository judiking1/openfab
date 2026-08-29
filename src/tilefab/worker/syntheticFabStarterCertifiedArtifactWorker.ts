import {
	SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
	type SyntheticFabStarterCertifiedArtifactHydrationErrorResponse,
	type SyntheticFabStarterCertifiedArtifactWorkerRequest,
} from "./SyntheticFabStarterCertifiedArtifactProtocol";
import { hydrateSyntheticFabStarterCertifiedArtifactRequest } from "./SyntheticFabStarterCertifiedArtifactRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

self.onmessage = (event: MessageEvent<SyntheticFabStarterCertifiedArtifactWorkerRequest>): void => {
	const request = event.data;
	try {
		const response = hydrateSyntheticFabStarterCertifiedArtifactRequest(request);
		if (response.type === "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED") {
			self.postMessage(response, {
				transfer: collectTransferableBuffers(response.prepared),
			});
			return;
		}
		self.postMessage(response);
	} catch (error) {
		if (!Number.isSafeInteger(request?.requestId) || request.requestId <= 0) return;
		const response: SyntheticFabStarterCertifiedArtifactHydrationErrorResponse = {
			type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATION_ERROR",
			protocolVersion: SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION,
			requestId: request.requestId,
			message:
				error instanceof Error
					? error.message.slice(0, 512)
					: "Certified FAB artifact hydration failed.",
		};
		self.postMessage(response);
	}
};
