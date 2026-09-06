import type {
	OpenFabFabPreparedProjectAttestation,
	OpenFabFabPreparedProjectIdentity,
	TransferableOpenFabFabPreparedProject,
} from "../compile/OpenFabFabPreparedProject";
import type { OpenFabFabProfile } from "../compile/OpenFabFabProfile";

export const OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION = 3 as const;

export type OpenFabFabPreparedProjectOperation = "VERIFY" | "SOURCE";

interface OpenFabFabPreparedProjectRequestBase {
	readonly protocolVersion: typeof OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly requestFingerprint: string;
	readonly profile: OpenFabFabProfile;
}

export interface VerifyOpenFabFabPreparedProjectRequest
	extends OpenFabFabPreparedProjectRequestBase {
	readonly type: "VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION";
}

export interface PrepareOpenFabFabPreparedProjectSourceRequest
	extends OpenFabFabPreparedProjectRequestBase {
	readonly type: "PREPARE_OPENFAB_FAB_PROJECT_SOURCE";
}

export type OpenFabFabPreparedProjectWorkerRequest =
	| VerifyOpenFabFabPreparedProjectRequest
	| PrepareOpenFabFabPreparedProjectSourceRequest;

export interface OpenFabFabPreparedProjectVerifiedResponse {
	readonly type: "OPENFAB_FAB_PROJECT_MATERIALIZATION_VERIFIED";
	readonly protocolVersion: typeof OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly requestFingerprint: string;
	readonly identity: OpenFabFabPreparedProjectIdentity;
}

export interface OpenFabFabPreparedProjectSourceResponse {
	readonly type: "OPENFAB_FAB_PROJECT_SOURCE_PREPARED";
	readonly protocolVersion: typeof OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly requestFingerprint: string;
	readonly prepared: TransferableOpenFabFabPreparedProject;
	readonly attestation: OpenFabFabPreparedProjectAttestation;
}

export type OpenFabFabPreparedProjectErrorCode =
	| "MALFORMED_REQUEST"
	| "REQUEST_MISMATCH"
	| "COMPOSITION_FAILED"
	| "CERTIFICATE_INVALID"
	| "TRANSFER_INVALID";

export interface OpenFabFabPreparedProjectErrorResponse {
	readonly type: "OPENFAB_FAB_PREPARED_PROJECT_ERROR";
	readonly protocolVersion: typeof OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly requestFingerprint: string;
	readonly operation: OpenFabFabPreparedProjectOperation;
	readonly code: OpenFabFabPreparedProjectErrorCode;
	readonly message: string;
}

export type OpenFabFabPreparedProjectWorkerResponse =
	| OpenFabFabPreparedProjectVerifiedResponse
	| OpenFabFabPreparedProjectSourceResponse
	| OpenFabFabPreparedProjectErrorResponse;
