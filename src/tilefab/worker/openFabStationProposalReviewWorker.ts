/// <reference lib="webworker" />

import {
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalReviewWorkerResponse,
	openFabStationProposalReviewWorkerErrorMessage,
} from "./OpenFabStationProposalReviewWorkerProtocol";
import {
	collectOpenFabStationProposalReviewWorkerResponseTransfers,
	OpenFabStationProposalReviewWorkerSession,
} from "./OpenFabStationProposalReviewWorkerRuntime";

declare const self: DedicatedWorkerGlobalScope;

const session = new OpenFabStationProposalReviewWorkerSession();

function arm(): void {
	self.onmessage = (event: MessageEvent<unknown>): void => {
		// At most one state transition may run, including across cooperative encoder yields.
		self.onmessage = null;
		void receive(event.data);
	};
}

async function receive(value: unknown): Promise<void> {
	let response: OpenFabStationProposalReviewWorkerResponse;
	try {
		response = await session.receive(value);
	} catch {
		session.terminate();
		postInternalError();
		self.close();
		return;
	}
	try {
		self.postMessage(response, {
			transfer: collectOpenFabStationProposalReviewWorkerResponseTransfers(response),
		});
	} catch {
		postTransferError(response);
		session.terminate();
	}
	if (session.isReady()) arm();
	else self.close();
}

function postInternalError(): void {
	try {
		self.postMessage(
			Object.freeze({
				type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR" as const,
				protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
				requestId: 0,
				generation: 0,
				ticketId: 0,
				code: "INTERNAL_FAILURE" as const,
				message: openFabStationProposalReviewWorkerErrorMessage("INTERNAL_FAILURE"),
			}),
		);
	} catch {
		// A broken Worker transport has no remaining safe response channel.
	}
}

function postTransferError(response: OpenFabStationProposalReviewWorkerResponse): void {
	try {
		self.postMessage(
			Object.freeze({
				type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR" as const,
				protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
				requestId: response.requestId,
				generation: response.generation,
				ticketId: response.ticketId,
				code: "TRANSFER_INVALID" as const,
				message: openFabStationProposalReviewWorkerErrorMessage("TRANSFER_INVALID"),
			}),
		);
	} catch {
		// A broken Worker transport has no remaining safe response channel.
	}
}

arm();
