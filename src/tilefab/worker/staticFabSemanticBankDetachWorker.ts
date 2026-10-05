/// <reference lib="webworker" />
import {
	STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION,
	type StaticFabSemanticBankDetachWorkerRequest,
	type StaticFabSemanticBankDetachWorkerResponse,
} from "./StaticFabSemanticBankDetachProtocol";
import { staticFabSemanticBankDetachPreparedShapeError } from "./StaticFabSemanticBankDetachResponseValidator";
import { prepareStaticFabSemanticBankDetach } from "./StaticFabSemanticBankDetachRuntime";

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<StaticFabSemanticBankDetachWorkerRequest>): void => {
	const request = event.data;
	const prepared = prepareStaticFabSemanticBankDetach(request);
	const shapeError = staticFabSemanticBankDetachPreparedShapeError(prepared);
	const response: StaticFabSemanticBankDetachWorkerResponse = {
		type: "STATIC_FAB_SEMANTIC_BANK_DETACH_PREPARED",
		version: STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION,
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
