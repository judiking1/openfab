/// <reference lib="webworker" />

import {
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
	type StaticFabSemanticBayMutationWorkerRequest,
	type StaticFabSemanticBayMutationWorkerResponse,
} from "./StaticFabSemanticBayMutationProtocol";
import { staticFabSemanticBayMutationPreparedShapeError } from "./StaticFabSemanticBayMutationResponseValidator";
import {
	hydrateStaticFabSemanticBayMutationSession,
	prepareStaticFabSemanticBayMutationInSession,
	type StaticFabSemanticBayMutationRuntimeSession,
} from "./StaticFabSemanticBayMutationRuntime";

declare const self: DedicatedWorkerGlobalScope;

let session: StaticFabSemanticBayMutationRuntimeSession | null = null;

self.onmessage = (event: MessageEvent<StaticFabSemanticBayMutationWorkerRequest>): void => {
	const request = event.data;
	const requestId = safeRequestId(request);
	try {
		if (!request || request.version !== STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION) {
			throw new Error("Unsupported Semantic Bay mutation Worker request.");
		}
		if (request.type === "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION") {
			session = null;
			const startedAt = performance.now();
			const hydrated = hydrateStaticFabSemanticBayMutationSession(request.snapshot);
			session = hydrated;
			const response: StaticFabSemanticBayMutationWorkerResponse = {
				type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_HYDRATED",
				version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
				requestId,
				source: hydrated.sourceIdentity,
				sourceEvidence: hydrated.sourceEvidence,
				hydrationMilliseconds: Math.max(0, performance.now() - startedAt),
			};
			self.postMessage(response);
			return;
		}
		if (request.type !== "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION" || !session) {
			throw new Error("Semantic Bay mutation Worker is not hydrated.");
		}
		const prepared = prepareStaticFabSemanticBayMutationInSession(request, session);
		const shapeError = staticFabSemanticBayMutationPreparedShapeError(prepared);
		if (shapeError) {
			throw new Error(`Semantic Bay mutation Worker output is invalid: ${shapeError}.`);
		}
		const response: StaticFabSemanticBayMutationWorkerResponse = {
			type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED",
			version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
			requestId,
			prepared,
		};
		self.postMessage(response);
	} catch (error) {
		const response: StaticFabSemanticBayMutationWorkerResponse = {
			type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_ERROR",
			version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
			requestId,
			message: (error instanceof Error
				? error.message
				: "Unknown Semantic Bay mutation Worker failure."
			).slice(0, STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT),
		};
		self.postMessage(response);
	}
};

function safeRequestId(value: unknown): number {
	if (typeof value !== "object" || value === null || !("requestId" in value)) return 0;
	const requestId = (value as { readonly requestId?: unknown }).requestId;
	return Number.isSafeInteger(requestId) && (requestId as number) >= 0 ? (requestId as number) : 0;
}
