import type { SyntheticFabStarterRequest } from "../compile/SyntheticFabStarter";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import type {
	SyntheticFabStarterCertificationAttestation,
	SyntheticFabStarterCertifiedArtifactId,
} from "../editor/SyntheticFabStarterCertifiedArtifact";

export const SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION = 2 as const;

export interface HydrateSyntheticFabStarterCertifiedArtifactRequest {
	readonly type: "HYDRATE_SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT";
	readonly protocolVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly artifactId: SyntheticFabStarterCertifiedArtifactId;
	readonly requestFingerprint: string;
	readonly source: string;
	readonly starter: SyntheticFabStarterRequest;
}

export interface SyntheticFabStarterCertifiedArtifactHydratedResponse {
	readonly type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATED";
	readonly protocolVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly prepared: PreparedSyntheticFabStarter;
	readonly attestation: SyntheticFabStarterCertificationAttestation;
}

export interface SyntheticFabStarterCertifiedArtifactRejectedResponse {
	readonly type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_REJECTED";
	readonly protocolVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
}

export interface SyntheticFabStarterCertifiedArtifactHydrationErrorResponse {
	readonly type: "SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_HYDRATION_ERROR";
	readonly protocolVersion: typeof SYNTHETIC_FAB_STARTER_CERTIFIED_ARTIFACT_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly message: string;
}

export type SyntheticFabStarterCertifiedArtifactWorkerRequest =
	HydrateSyntheticFabStarterCertifiedArtifactRequest;

export type SyntheticFabStarterCertifiedArtifactWorkerResponse =
	| SyntheticFabStarterCertifiedArtifactHydratedResponse
	| SyntheticFabStarterCertifiedArtifactRejectedResponse
	| SyntheticFabStarterCertifiedArtifactHydrationErrorResponse;
