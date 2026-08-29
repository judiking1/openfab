/// <reference lib="webworker" />

import {
	SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationResidentScenarioPreparationWorkerRequest,
} from "./SimulationResidentScenarioPreparationWorkerProtocol";
import { prepareSimulationResidentScenarioWorkerRequest } from "./SimulationResidentScenarioPreparationWorkerRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (
	event: MessageEvent<SimulationResidentScenarioPreparationWorkerRequest>,
): Promise<void> => {
	const request = event.data;
	try {
		const response = await prepareSimulationResidentScenarioWorkerRequest(request);
		self.postMessage(response, collectTransferableBuffers(response));
	} catch {
		try {
			self.postMessage({
				type: "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED" as const,
				protocolVersion: SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
				requestId:
					Number.isSafeInteger(request?.requestId) && request.requestId > 0 ? request.requestId : 0,
				generation:
					Number.isSafeInteger(request?.generation) && request.generation >= 0
						? request.generation
						: 0,
				code: "INTERNAL_FAILURE" as const,
				message: "Resident scenario preparation Worker failed internally.",
			});
		} catch {
			// A broken one-shot transport has no remaining safe response channel.
		}
	} finally {
		self.close();
	}
};
