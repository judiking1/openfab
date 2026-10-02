import { evaluateProjectedStaticFabProcessLoopTopology } from "../compile/StaticFabProcessLoopTopology";
import { completeCooperativeSteps } from "../core/CooperativeTask";
import {
	hydrateStaticFabProcessLoopTopologyColumns,
	staticFabProcessLoopTopologyFingerprintSteps,
} from "./StaticFabProcessLoopTopologyColumns";
import {
	hasExactProcessLoopFields,
	STATIC_FAB_PROCESS_LOOP_TOPOLOGY_MAX_ERROR_LENGTH,
	STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
	type StaticFabProcessLoopTopologyWorkerRequest,
	type StaticFabProcessLoopTopologyWorkerResponse,
	staticFabProcessLoopTopologySourceIdentityIsValid,
} from "./StaticFabProcessLoopTopologyProtocol";

/** One disposable Worker request. Never hydrate/compile the original full FAB for this proof. */
export function checkStaticFabProcessLoopTopologyInWorker(
	input: unknown,
): StaticFabProcessLoopTopologyWorkerResponse {
	let requestId = 0;
	try {
		if (
			!hasExactProcessLoopFields(input, [
				"type",
				"version",
				"requestId",
				"source",
				"fingerprint",
				"columns",
			]) ||
			input.type !== "CHECK_STATIC_FAB_PROCESS_LOOP_TOPOLOGY" ||
			input.version !== STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION ||
			!Number.isSafeInteger(input.requestId) ||
			(input.requestId as number) <= 0
		)
			throw new Error("Process Loop topology request envelope is invalid.");
		requestId = input.requestId as number;
		if (
			!staticFabProcessLoopTopologySourceIdentityIsValid(input.source) ||
			typeof input.fingerprint !== "string" ||
			!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(input.fingerprint)
		)
			throw new Error("Process Loop topology request identity is invalid.");
		const request = input as unknown as StaticFabProcessLoopTopologyWorkerRequest;
		const { source, columns } = request;
		if (
			columns.revision !== source.revision ||
			columns.patchSequence !== source.patchSequence ||
			columns.nextAdvancedSwitchId !== source.nextAdvancedSwitchId
		)
			throw new Error("Process Loop topology columns do not match the requested source.");
		if (
			completeCooperativeSteps(staticFabProcessLoopTopologyFingerprintSteps(columns)) !==
			request.fingerprint
		)
			throw new Error("Process Loop topology candidate fingerprint diverged.");
		const map = hydrateStaticFabProcessLoopTopologyColumns(columns);
		return Object.freeze({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED",
			version: STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
			requestId,
			source: Object.freeze({ ...source }),
			fingerprint: request.fingerprint,
			result: evaluateProjectedStaticFabProcessLoopTopology(map),
		});
	} catch (error) {
		return Object.freeze({
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR",
			version: STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
			requestId,
			message: (error instanceof Error
				? error.message
				: "Process Loop topology Worker failed."
			).slice(0, STATIC_FAB_PROCESS_LOOP_TOPOLOGY_MAX_ERROR_LENGTH),
		});
	}
}
