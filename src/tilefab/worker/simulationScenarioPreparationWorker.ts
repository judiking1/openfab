/// <reference lib="webworker" />

import {
	SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationScenarioPreparationWorkerRequest,
} from "./SimulationScenarioPreparationWorkerProtocol";
import {
	collectSimulationScenarioPreparationResponseTransferBuffers,
	prepareSimulationScenarioWorkerRequest,
} from "./SimulationScenarioPreparationWorkerRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (
	event: MessageEvent<SimulationScenarioPreparationWorkerRequest>,
): Promise<void> => {
	const request = event.data;
	try {
		const response = await prepareSimulationScenarioWorkerRequest(request);
		self.postMessage(response, {
			transfer: [...collectSimulationScenarioPreparationResponseTransferBuffers(response)],
		});
	} catch {
		try {
			self.postMessage({
				type: "SIMULATION_SCENARIO_PREPARATION_REJECTED" as const,
				protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
				requestId:
					Number.isSafeInteger(request?.requestId) && request.requestId > 0 ? request.requestId : 0,
				generation:
					Number.isSafeInteger(request?.generation) && request.generation >= 0
						? request.generation
						: 0,
				sourceKind:
					request?.sourceKind === "TRANSFER_PLAN" || request?.sourceKind === "REPLAY_HISTORY"
						? request.sourceKind
						: ("UNKNOWN" as const),
				code: "INTERNAL_FAILURE" as const,
				message: "Scenario preparation Worker failed internally.",
			});
		} catch {
			// A broken one-shot transport has no remaining safe response channel.
		}
	} finally {
		self.close();
	}
};
