import type {
	OpenFabProjectSerializationRequest,
	OpenFabProjectSerializationResponse,
} from "./OpenFabProjectSerializationProtocol";
import { serializeOpenFabProjectSnapshot } from "./OpenFabProjectSerializationRuntime";

self.onmessage = (event: MessageEvent<OpenFabProjectSerializationRequest>): void => {
	const request = event.data;
	if (request.type !== "SERIALIZE_OPENFAB_PROJECT") return;
	try {
		const result = serializeOpenFabProjectSnapshot(
			request.snapshot,
			request.manifest,
			request.view,
			request.blueprints,
			request.operations,
		);
		const response: OpenFabProjectSerializationResponse = {
			type: "OPENFAB_PROJECT_SERIALIZED",
			requestId: request.requestId,
			...result,
		};
		self.postMessage(response);
	} catch (error) {
		const response: OpenFabProjectSerializationResponse = {
			type: "OPENFAB_PROJECT_SERIALIZATION_ERROR",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : "Unknown project serialization error.",
		};
		self.postMessage(response);
	}
};
