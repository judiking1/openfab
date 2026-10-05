/// <reference lib="webworker" />
import {
	STATIC_FAB_SEMANTIC_BANK_DELETE_PROTOCOL_VERSION,
	type StaticFabSemanticBankDeleteWorkerRequest,
	type StaticFabSemanticBankDeleteWorkerResponse,
} from "./StaticFabSemanticBankDeleteProtocol";
import { staticFabSemanticBankDeletePreparedShapeError } from "./StaticFabSemanticBankDeleteResponseValidator";
import { prepareStaticFabSemanticBankDelete } from "./StaticFabSemanticBankDeleteRuntime";

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<StaticFabSemanticBankDeleteWorkerRequest>): void => {
	const request = event.data;
	const prepared = prepareStaticFabSemanticBankDelete(request);
	const shapeError = staticFabSemanticBankDeletePreparedShapeError(prepared);
	const response: StaticFabSemanticBankDeleteWorkerResponse = {
		type: "STATIC_FAB_SEMANTIC_BANK_DELETE_PREPARED",
		version: STATIC_FAB_SEMANTIC_BANK_DELETE_PROTOCOL_VERSION,
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
