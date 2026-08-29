/// <reference lib="webworker" />

import type {
	InitializeStaticFabArrangementSessionRequest,
	PrepareStaticFabArrangementRequest,
	StaticFabArrangementWorkerRequest,
	StaticFabArrangementWorkerResponse,
} from "./StaticFabArrangementProtocol";
import { STATIC_FAB_ARRANGEMENT_SESSION_VERSION } from "./StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
	type StaticFabArrangementRuntimeSession,
} from "./StaticFabArrangementRuntime";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let activeSession: Readonly<{
	readonly sessionId: number;
	readonly runtime: StaticFabArrangementRuntimeSession;
}> | null = null;

scope.onmessage = (event: MessageEvent<StaticFabArrangementWorkerRequest>) => {
	const request = event.data;
	let failedSourcePlanIndex: number | null = null;
	try {
		validateEnvelope(request);
		if (request.type === "INITIALIZE_STATIC_FAB_ARRANGEMENT_SESSION") {
			initializeSession(request);
			return;
		}
		if (!activeSession || activeSession.sessionId !== request.sessionId) {
			throw new Error("Static FAB arrangement Worker session is missing or stale.");
		}
		failedSourcePlanIndex = activeSession.runtime.preparedCount + 1;
		prepareCandidate(request);
	} catch (error) {
		const response: StaticFabArrangementWorkerResponse = {
			type: "STATIC_FAB_ARRANGEMENT_ERROR",
			version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
			sessionId: safeIdentifier(request?.sessionId),
			requestId: safeIdentifier(request?.requestId),
			sourcePlanIndex: failedSourcePlanIndex,
			message: error instanceof Error ? error.message : "Static FAB arrangement Worker failed.",
		};
		scope.postMessage(response);
	}
};

function initializeSession(request: InitializeStaticFabArrangementSessionRequest): void {
	if (activeSession)
		throw new Error("Static FAB arrangement Worker session is already initialized.");
	const initialized = initializeStaticFabArrangementRuntimeSession(request.snapshot);
	activeSession = Object.freeze({ sessionId: request.sessionId, runtime: initialized.session });
	const response: StaticFabArrangementWorkerResponse = {
		type: "STATIC_FAB_ARRANGEMENT_SESSION_READY",
		version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
		sessionId: request.sessionId,
		requestId: request.requestId,
		source: initialized.source,
		hydrationMilliseconds: initialized.hydrationMilliseconds,
		compilationMilliseconds: initialized.compilationMilliseconds,
	};
	scope.postMessage(response);
}

function prepareCandidate(request: PrepareStaticFabArrangementRequest): void {
	if (!activeSession) throw new Error("Static FAB arrangement Worker session is missing.");
	const result = prepareStaticFabArrangementInSession(activeSession.runtime, request);
	const response: StaticFabArrangementWorkerResponse = {
		type: "STATIC_FAB_ARRANGEMENT_PREPARED",
		version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
		sessionId: request.sessionId,
		requestId: request.requestId,
		sourcePlanIndex: result.sourcePlanIndex,
		prepared: result.prepared,
	};
	scope.postMessage(response);
}

function validateEnvelope(request: StaticFabArrangementWorkerRequest): void {
	if (
		!request ||
		request.version !== STATIC_FAB_ARRANGEMENT_SESSION_VERSION ||
		!positiveSafeInteger(request.sessionId) ||
		!positiveSafeInteger(request.requestId)
	) {
		throw new Error("Static FAB arrangement Worker request envelope is invalid.");
	}
	if (request.type === "PREPARE_STATIC_FAB_ARRANGEMENT" && !positiveSafeInteger(request.ticketId)) {
		throw new Error("Static FAB arrangement Worker ticket is invalid.");
	}
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function safeIdentifier(value: unknown): number {
	return positiveSafeInteger(value) ? value : 0;
}
