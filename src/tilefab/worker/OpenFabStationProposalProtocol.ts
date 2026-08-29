import type {
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	OpenFabStationProposalArtifact,
	OpenFabStationProposalReadFailure,
} from "../compile/OpenFabStationProposalArtifact";

export const OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_WORKER_MAX_ERROR_MESSAGE_LENGTH = 96;

export const OPENFAB_STATION_PROPOSAL_WORKER_ERROR_CODES = Object.freeze([
	"MALFORMED_REQUEST",
	"READ_FAILED",
	"TRANSFER_INVALID",
] as const);
export type OpenFabStationProposalWorkerErrorCode =
	(typeof OPENFAB_STATION_PROPOSAL_WORKER_ERROR_CODES)[number];

const ERROR_MESSAGES = Object.freeze({
	MALFORMED_REQUEST: "Station proposal Worker request is malformed.",
	READ_FAILED: "Station proposal source could not be read.",
	TRANSFER_INVALID: "Station proposal result is not transferable.",
}) satisfies Readonly<Record<OpenFabStationProposalWorkerErrorCode, string>>;

export function openFabStationProposalWorkerErrorMessage(
	code: OpenFabStationProposalWorkerErrorCode,
): string {
	return ERROR_MESSAGES[code];
}

interface OpenFabStationProposalWorkerCorrelation {
	readonly protocolVersion: typeof OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION;
	readonly schemaId: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_ID;
	readonly schemaVersion: typeof OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly byteLength: number;
}

export interface ReadOpenFabStationProposalWorkerRequest
	extends OpenFabStationProposalWorkerCorrelation {
	readonly type: "READ_OPENFAB_STATION_PROPOSAL";
	/** The caller transfers this exact owned buffer. The Worker never returns it. */
	readonly source: ArrayBuffer;
}

export interface OpenFabStationProposalReadResponse
	extends OpenFabStationProposalWorkerCorrelation {
	readonly type: "OPENFAB_STATION_PROPOSAL_READ";
	readonly artifact: OpenFabStationProposalArtifact;
}

export interface OpenFabStationProposalRejectedResponse
	extends OpenFabStationProposalWorkerCorrelation {
	readonly type: "OPENFAB_STATION_PROPOSAL_REJECTED";
	readonly failure: OpenFabStationProposalReadFailure;
}

export interface OpenFabStationProposalErrorResponse
	extends OpenFabStationProposalWorkerCorrelation {
	readonly type: "OPENFAB_STATION_PROPOSAL_ERROR";
	readonly code: OpenFabStationProposalWorkerErrorCode;
	readonly message: string;
}

export type OpenFabStationProposalWorkerRequest = ReadOpenFabStationProposalWorkerRequest;
export type OpenFabStationProposalWorkerResponse =
	| OpenFabStationProposalReadResponse
	| OpenFabStationProposalRejectedResponse
	| OpenFabStationProposalErrorResponse;
