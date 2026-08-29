/// <reference lib="webworker" />

import {
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT,
	STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
	type StaticFabBayFlowEditWorkerRequest,
	type StaticFabBayFlowEditWorkerResponse,
} from "./StaticFabBayFlowEditProtocol";
import { staticFabBayFlowEditPreparedShapeError } from "./StaticFabBayFlowEditResponseValidator";
import {
	hydrateStaticFabBayFlowEditSession,
	prepareStaticFabBayFlowEditInSession,
	type StaticFabBayFlowEditRuntimeSession,
} from "./StaticFabBayFlowEditRuntime";

declare const self: DedicatedWorkerGlobalScope;

let session: StaticFabBayFlowEditRuntimeSession | null = null;

const HYDRATE_REQUEST_KEYS = Object.freeze(["type", "version", "requestId", "snapshot"] as const);
const PREPARE_REQUEST_KEYS = Object.freeze([
	"type",
	"version",
	"requestId",
	"ticketId",
	"intent",
	"expectedIntentFingerprint",
	"expectedSource",
] as const);

self.onmessage = (event: MessageEvent<unknown>): void => {
	const request = event.data;
	const requestId = safeRequestId(request);
	try {
		assertExactRequestEnvelope(request);
		if (request.type === "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT") {
			session = null;
			const startedAt = performance.now();
			const hydrated = hydrateStaticFabBayFlowEditSession(request.snapshot);
			session = hydrated;
			const response: StaticFabBayFlowEditWorkerResponse = {
				type: "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED",
				version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
				requestId,
				source: hydrated.sourceIdentity,
				sourceEvidence: hydrated.sourceEvidence,
				hydrationMilliseconds: Math.max(0, performance.now() - startedAt),
			};
			self.postMessage(response);
			return;
		}
		if (request.type !== "PREPARE_STATIC_FAB_BAY_FLOW_EDIT" || !session) {
			throw new Error("Bay flow edit Worker is not hydrated.");
		}
		const activeSession = session;
		try {
			const prepared = prepareStaticFabBayFlowEditInSession(request, activeSession);
			const shapeError = staticFabBayFlowEditPreparedShapeError(prepared);
			if (shapeError) {
				throw new Error(`Bay flow edit Worker output is invalid: ${shapeError}.`);
			}
			const response: StaticFabBayFlowEditWorkerResponse = {
				type: "STATIC_FAB_BAY_FLOW_EDIT_PREPARED",
				version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
				requestId,
				prepared,
			};
			self.postMessage(response);
		} finally {
			// One prepare consumes the only hydrated generation, regardless of its result.
			session = null;
		}
	} catch (error) {
		session = null;
		const response: StaticFabBayFlowEditWorkerResponse = {
			type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId,
			message: (error instanceof Error
				? error.message
				: "Unknown Bay flow edit Worker failure."
			).slice(0, STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT),
		};
		self.postMessage(response);
	}
};

function assertExactRequestEnvelope(
	value: unknown,
): asserts value is StaticFabBayFlowEditWorkerRequest {
	if (!isRecord(value) || value.version !== STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION) {
		throw new Error("Unsupported Bay flow edit Worker request.");
	}
	if (!positiveSafeInteger(value.requestId)) {
		throw new Error("Bay flow edit Worker request id is invalid.");
	}
	if (value.type === "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT") {
		if (!hasExactKeys(value, HYDRATE_REQUEST_KEYS)) {
			throw new Error("Bay flow edit hydrate request fields are malformed.");
		}
		return;
	}
	if (value.type === "PREPARE_STATIC_FAB_BAY_FLOW_EDIT") {
		if (!hasExactKeys(value, PREPARE_REQUEST_KEYS)) {
			throw new Error("Bay flow edit prepare request fields are malformed.");
		}
		return;
	}
	throw new Error("Unsupported Bay flow edit Worker request.");
}

function safeRequestId(value: unknown): number {
	if (typeof value !== "object" || value === null || !("requestId" in value)) return 0;
	const requestId = (value as { readonly requestId?: unknown }).requestId;
	return Number.isSafeInteger(requestId) && (requestId as number) >= 0 ? (requestId as number) : 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
