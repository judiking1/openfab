import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeOpenFabFab } from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import {
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
} from "../core/StaticFabBayFlowEdit";
import { staticFabBayFlowEditIntentFingerprint } from "../core/StaticFabBayFlowEditCertification";
import { deriveStaticFabOrganizationSemanticRoles } from "../core/StaticFabOrganization";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT,
	STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
	type StaticFabBayFlowEditHydratedResponse,
	type StaticFabBayFlowEditWorkerResponse,
} from "./StaticFabBayFlowEditProtocol";

const MINIMUM_TWIN_PROFILE = Object.freeze({
	...defaultOpenFabFabProfile(),
	layoutBlockCount: 1 as const,
	banksPerLayoutBlock: 1 as const,
	processLoopsPerBank: 12 as const,
	bayPackingPolicy: "TWIN" as const,
	processLoopLongAxisMeters: 36 as const,
	processLoopCenterPitchMeters: 12 as const,
});

interface FakeWorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	readonly responses: StaticFabBayFlowEditWorkerResponse[];
	postMessage(value: StaticFabBayFlowEditWorkerResponse): void;
}

describe("staticFabBayFlowEditWorker entry", () => {
	const globalRecord = globalThis as typeof globalThis & Record<string, unknown>;
	const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
	const scope: FakeWorkerScope = {
		onmessage: null,
		responses: [],
		postMessage(value): void {
			this.responses.push(value);
		},
	};
	let snapshot: ReturnType<typeof composeOpenFabFab>["roundTrippedSnapshot"];
	let intent: StaticFabBayFlowEditIntent;

	beforeAll(async () => {
		Object.defineProperty(globalThis, "self", {
			configurable: true,
			writable: true,
			value: scope,
		});
		await import("./staticFabBayFlowEditWorker");
		if (!scope.onmessage) throw new Error("Bay flow edit Worker did not install its handler.");

		const composition = composeOpenFabFab(MINIMUM_TWIN_PROFILE);
		snapshot = composition.roundTrippedSnapshot;
		const document = hydrateRailMirrorSnapshotDocument(snapshot);
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const bay = document.organizations.records.find((record) => roles.get(record.id) === "BAY");
		if (!bay) throw new Error("Expected one generated Twin Bay.");
		intent = Object.freeze({
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId: bay.id,
			targetInternalFlowPattern: "co-rotating",
		});
	}, 120_000);

	afterAll(() => {
		scope.responses.length = 0;
		scope.onmessage = null;
		if (originalSelf) Object.defineProperty(globalThis, "self", originalSelf);
		else Reflect.deleteProperty(globalRecord, "self");
	});

	it("enforces exact envelopes and consumes one hydrated generation on prepare or error", () => {
		const invalidId = invoke({
			type: "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: 0,
			snapshot,
		});
		expect(invalidId).toMatchObject({
			type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR",
			requestId: 0,
		});

		const extraHydrateField = invoke({
			type: "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: 1,
			snapshot,
			extra: true,
		});
		expect(extraHydrateField).toMatchObject({
			type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR",
			requestId: 1,
		});

		const hydrated = requireHydrated(
			invoke({
				type: "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
				version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
				requestId: 2,
				snapshot,
			}),
		);
		expect(hydrated).toMatchObject({
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: 2,
			source: {
				revision: snapshot.revision,
				patchSequence: snapshot.sequence,
				checksum: snapshot.checksum,
			},
		});

		const extraPrepareField = invoke({
			...prepareRequest(3, hydrated),
			extra: true,
		});
		expect(extraPrepareField).toMatchObject({
			type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR",
			requestId: 3,
		});
		expect(requireError(extraPrepareField).message).toMatch(/fields/i);

		const afterError = invoke(prepareRequest(4, hydrated));
		expect(afterError).toMatchObject({
			type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR",
			requestId: 4,
		});
		expect(requireError(afterError).message).toMatch(/not hydrated/i);

		const rehydrated = requireHydrated(
			invoke({
				type: "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
				version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
				requestId: 5,
				snapshot,
			}),
		);
		const prepared = invoke(prepareRequest(6, rehydrated));
		expect(prepared).toMatchObject({
			type: "STATIC_FAB_BAY_FLOW_EDIT_PREPARED",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: 6,
			prepared: {
				valid: true,
				failureCode: null,
				ticket: { ticketId: 6, validationLevel: "exact" },
			},
		});

		const replay = invoke(prepareRequest(7, rehydrated));
		expect(replay).toMatchObject({
			type: "STATIC_FAB_BAY_FLOW_EDIT_ERROR",
			requestId: 7,
		});
		const replayMessage = requireError(replay).message;
		expect(replayMessage).toMatch(/not hydrated/i);
		expect(replayMessage.length).toBeLessThanOrEqual(STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT);
	}, 120_000);

	function invoke(request: unknown): StaticFabBayFlowEditWorkerResponse {
		const handler = scope.onmessage;
		if (!handler) throw new Error("Bay flow edit Worker handler is missing.");
		if (scope.responses.length !== 0) throw new Error("Worker response queue was not drained.");
		handler({ data: request } as MessageEvent<unknown>);
		const response = scope.responses.shift();
		if (!response || scope.responses.length !== 0) {
			throw new Error("Bay flow edit Worker must emit exactly one response per request.");
		}
		return response;
	}

	function prepareRequest(requestId: number, hydrated: StaticFabBayFlowEditHydratedResponse) {
		return {
			type: "PREPARE_STATIC_FAB_BAY_FLOW_EDIT" as const,
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId,
			ticketId: requestId,
			intent,
			expectedIntentFingerprint: staticFabBayFlowEditIntentFingerprint(intent),
			expectedSource: hydrated.source,
		};
	}
});

function requireHydrated(
	response: StaticFabBayFlowEditWorkerResponse,
): StaticFabBayFlowEditHydratedResponse {
	if (response.type !== "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED") {
		throw new Error(`Expected hydrated response, received ${response.type}.`);
	}
	return response;
}

function requireError(response: StaticFabBayFlowEditWorkerResponse) {
	if (response.type !== "STATIC_FAB_BAY_FLOW_EDIT_ERROR") {
		throw new Error(`Expected error response, received ${response.type}.`);
	}
	return response;
}
