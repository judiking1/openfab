/// <reference lib="webworker" />

import {
	STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
	type StaticFabAssemblyConnectorWorkerRequest,
	type StaticFabAssemblyConnectorWorkerResponse,
} from "./StaticFabAssemblyConnectorProtocol";
import { staticFabAssemblyConnectorPreparedShapeError } from "./StaticFabAssemblyConnectorResponseValidator";
import {
	hydrateStaticFabAssemblyConnectorSession,
	prepareStaticFabAssemblyConnectorInSession,
	type StaticFabAssemblyConnectorRuntimeSession,
} from "./StaticFabAssemblyConnectorRuntime";

declare const self: DedicatedWorkerGlobalScope;

let session: StaticFabAssemblyConnectorRuntimeSession | null = null;

self.onmessage = (event: MessageEvent<StaticFabAssemblyConnectorWorkerRequest>): void => {
	const request = event.data;
	try {
		if (request.version !== STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION) {
			throw new Error("Unsupported Assembly Connector Worker request.");
		}
		if (request.type === "HYDRATE_STATIC_FAB_ASSEMBLY_CONNECTOR") {
			const startedAt = performance.now();
			session = hydrateStaticFabAssemblyConnectorSession(request.snapshot);
			const snapshot = session.snapshot;
			const response: StaticFabAssemblyConnectorWorkerResponse = {
				type: "STATIC_FAB_ASSEMBLY_CONNECTOR_HYDRATED",
				version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
				requestId: request.requestId,
				sourceRevision: snapshot.revision,
				sourcePatchSequence: snapshot.sequence,
				sourceChecksum: snapshot.checksum,
				sourceNextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
				sourceNextPortId: snapshot.portEquipment.nextPortId,
				sourceNextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
				sourceNextOrganizationId: snapshot.organizations.nextOrganizationId,
				hydrationMilliseconds: performance.now() - startedAt,
			};
			self.postMessage(response);
			return;
		}
		if (request.type !== "PREPARE_STATIC_FAB_ASSEMBLY_CONNECTOR" || !session) {
			throw new Error("Assembly Connector Worker is not hydrated.");
		}
		const prepared = prepareStaticFabAssemblyConnectorInSession(request, session);
		const shapeError = staticFabAssemblyConnectorPreparedShapeError(prepared);
		if (shapeError) throw new Error(`Assembly Connector Worker output is invalid: ${shapeError}.`);
		const response: StaticFabAssemblyConnectorWorkerResponse = {
			type: "STATIC_FAB_ASSEMBLY_CONNECTOR_PREPARED",
			version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
			requestId: request.requestId,
			prepared,
		};
		self.postMessage(response);
	} catch (error) {
		const response: StaticFabAssemblyConnectorWorkerResponse = {
			type: "STATIC_FAB_ASSEMBLY_CONNECTOR_ERROR",
			version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
			requestId: request.requestId,
			message: (error instanceof Error
				? error.message
				: "Unknown Assembly Connector Worker failure."
			).slice(0, STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT),
		};
		self.postMessage(response);
	}
};
