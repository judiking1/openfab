/// <reference lib="webworker" />

import {
	SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationResidentReadinessWorkerRequest,
} from "./SimulationResidentReadinessWorkerProtocol";
import { certifySimulationResidentReadinessWorkerRequest } from "./SimulationResidentReadinessWorkerRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (
	event: MessageEvent<SimulationResidentReadinessWorkerRequest>,
): Promise<void> => {
	const request = event.data;
	try {
		self.postMessage(await certifySimulationResidentReadinessWorkerRequest(request));
	} catch {
		try {
			self.postMessage({
				type: "SIMULATION_RESIDENT_READINESS_REJECTED" as const,
				protocolVersion: SIMULATION_RESIDENT_READINESS_WORKER_PROTOCOL_VERSION,
				requestId:
					Number.isSafeInteger(request?.requestId) && request.requestId > 0 ? request.requestId : 0,
				generation:
					Number.isSafeInteger(request?.generation) && request.generation >= 0
						? request.generation
						: 0,
				code: "INTERNAL_FAILURE" as const,
				message: "Resident readiness Worker failed internally.",
			});
		} catch {
			// A broken one-shot transport has no remaining safe response channel.
		}
	} finally {
		self.close();
	}
};
