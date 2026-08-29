import type { SyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";

export interface PrepareSyntheticFabStarterRequest {
	readonly type: "PREPARE_SYNTHETIC_FAB_STARTER";
	readonly requestId: number;
	readonly starter: SyntheticFabStarterRequest;
}

export interface SyntheticFabStarterPreparedResponse {
	readonly type: "SYNTHETIC_FAB_STARTER_PREPARED";
	readonly requestId: number;
	readonly prepared: PreparedSyntheticFabStarter;
}

export interface SyntheticFabStarterPreparationErrorResponse {
	readonly type: "SYNTHETIC_FAB_STARTER_PREPARATION_ERROR";
	readonly requestId: number;
	readonly message: string;
}

export type SyntheticFabStarterWorkerRequest = PrepareSyntheticFabStarterRequest;
export type SyntheticFabStarterWorkerResponse =
	| SyntheticFabStarterPreparedResponse
	| SyntheticFabStarterPreparationErrorResponse;
