/// <reference lib="webworker" />

import {
	SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
	type SimulationReadinessWorkerRequest,
} from "./SimulationReadinessWorkerProtocol";
import {
	certifySimulationReadinessWorkerRequest,
	collectSimulationReadinessWorkerResponseTransferBuffers,
} from "./SimulationReadinessWorkerRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<SimulationReadinessWorkerRequest>): void => {
	const request = event.data;
	try {
		const response = certifySimulationReadinessWorkerRequest(request);
		self.postMessage(response, {
			transfer: collectSimulationReadinessWorkerResponseTransferBuffers(response),
		});
	} catch {
		try {
			self.postMessage({
				type: "SIMULATION_READINESS_REJECTED" as const,
				protocolVersion: SIMULATION_READINESS_WORKER_PROTOCOL_VERSION,
				requestId:
					Number.isSafeInteger(request?.requestId) && request.requestId > 0 ? request.requestId : 0,
				generation:
					Number.isSafeInteger(request?.generation) && request.generation >= 0
						? request.generation
						: 0,
				code: "INTERNAL_FAILURE" as const,
				message: "Readiness Worker failed internally.",
			});
		} catch {
			// A broken one-shot transport has no remaining safe response channel.
		}
	} finally {
		self.close();
	}
};
