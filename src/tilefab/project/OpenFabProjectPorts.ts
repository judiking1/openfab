export interface OpenFabProjectFileReference {
	readonly id: string;
	readonly name: string;
	readonly writable: boolean;
	readonly reopenable: boolean;
}

export interface OpenFabProjectFileRead {
	readonly reference: OpenFabProjectFileReference;
	readonly json: string;
}

export interface OpenFabProjectFileGateway {
	chooseOpen(signal?: AbortSignal): Promise<OpenFabProjectFileRead | null>;
	openRecent(
		reference: OpenFabProjectFileReference,
		signal?: AbortSignal,
	): Promise<OpenFabProjectFileRead | null>;
	write(
		reference: OpenFabProjectFileReference,
		json: string,
		signal?: AbortSignal,
	): Promise<boolean>;
	chooseSave(
		suggestedName: string,
		json: string,
		signal?: AbortSignal,
	): Promise<OpenFabProjectFileReference | null>;
}

export interface OpenFabRecentProject {
	readonly projectId: string;
	readonly name: string;
	readonly updatedAt: string;
	readonly authoredChecksum: string;
	readonly reference: OpenFabProjectFileReference | null;
}

export interface OpenFabRecoveryProject {
	readonly projectId: string;
	readonly name: string;
	readonly updatedAt: string;
	readonly authoredChecksum: string;
	readonly json: string;
}

export interface OpenFabRecoveryProjectSummary {
	readonly projectId: string;
	readonly name: string;
	readonly updatedAt: string;
	readonly authoredChecksum: string;
	readonly jsonCharacters: number;
}

export interface OpenFabRecoveryCleanupRequest {
	readonly retainedProjectCount: number;
	readonly protectedProjectIds?: readonly string[];
}

export interface OpenFabRecoveryCleanupPlan {
	readonly retainedProjectCount: number;
	readonly protectedProjectIds: readonly string[];
	readonly totalCount: number;
	readonly retainedCount: number;
	readonly removableCount: number;
	readonly totalJsonCharacters: number;
	readonly removableJsonCharacters: number;
	readonly candidates: readonly OpenFabRecoveryProjectSummary[];
}

export type OpenFabRecoveryCleanupResult =
	| Readonly<{ status: "removed"; removedCount: number }>
	| Readonly<{ status: "conflict"; removedCount: 0 }>;

export interface OpenFabRecoveryProjectInventory {
	readonly latest: OpenFabRecoveryProjectSummary | null;
	readonly records: readonly OpenFabRecoveryProjectSummary[];
	readonly totalCount: number;
	readonly offset: number;
	readonly pageSize: number;
	readonly truncated: boolean;
}

export interface OpenFabRecoveryProjectInventoryRequest {
	readonly offset?: number;
}

export interface OpenFabProjectMetadataStore {
	listRecent(): Promise<readonly OpenFabRecentProject[]>;
	putRecent(project: OpenFabRecentProject): Promise<void>;
	removeRecent(projectId: string): Promise<void>;
	listRecovery(
		request?: OpenFabRecoveryProjectInventoryRequest,
	): Promise<OpenFabRecoveryProjectInventory>;
	loadRecoverySummary(projectId: string): Promise<OpenFabRecoveryProjectSummary | null>;
	loadRecovery(projectId: string): Promise<OpenFabRecoveryProject | null>;
	putRecovery(project: OpenFabRecoveryProject): Promise<void>;
	removeRecovery(projectId: string): Promise<void>;
	prepareRecoveryCleanup(
		request: OpenFabRecoveryCleanupRequest,
	): Promise<OpenFabRecoveryCleanupPlan>;
	applyRecoveryCleanup(plan: OpenFabRecoveryCleanupPlan): Promise<OpenFabRecoveryCleanupResult>;
}

export interface OpenFabProjectIdentityProvider {
	createProjectId(): string;
	now(): string;
}
