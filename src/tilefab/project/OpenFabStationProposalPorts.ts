export const OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface OpenFabStationProposalFileRead {
	/** Local presentation metadata. It is not proposal or project truth. */
	readonly displayName: string;
	/** Fresh, exact-length bytes owned by the caller. */
	readonly bytes: ArrayBuffer;
}

export interface OpenFabStationProposalFileGateway {
	chooseOpen(signal?: AbortSignal): Promise<OpenFabStationProposalFileRead | null>;
}
