/// <reference lib="webworker" />
import {
	STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION,
	type StaticFabSemanticFabDeleteWorkerRequest,
	type StaticFabSemanticFabDeleteWorkerResponse,
} from "./StaticFabSemanticFabDeleteProtocol";
import { staticFabSemanticFabDeletePreparedShapeError } from "./StaticFabSemanticFabDeleteResponseValidator";
import { prepareStaticFabSemanticFabDelete } from "./StaticFabSemanticFabDeleteRuntime";

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<StaticFabSemanticFabDeleteWorkerRequest>): void => {
	const request = event.data;
	const prepared = prepareStaticFabSemanticFabDelete(request);
	const shapeError = staticFabSemanticFabDeletePreparedShapeError(prepared);
	const response: StaticFabSemanticFabDeleteWorkerResponse = {
		type: "STATIC_FAB_SEMANTIC_FAB_DELETE_PREPARED",
		version: STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION,
		requestId: Number.isSafeInteger(request?.requestId) ? request.requestId : 0,
		prepared: shapeError
			? {
					valid: false,
					failureCode: "RESPONSE_INVALID",
					reason: shapeError,
					plan: null,
					review: null,
					ticket: null,
					evidence: null,
				}
			: prepared,
	};
	self.postMessage(response);
};
