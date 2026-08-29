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

export interface OpenFabProjectMetadataStore {
	listRecent(): Promise<readonly OpenFabRecentProject[]>;
	putRecent(project: OpenFabRecentProject): Promise<void>;
	removeRecent(projectId: string): Promise<void>;
	loadLatestRecovery(): Promise<OpenFabRecoveryProject | null>;
	putRecovery(project: OpenFabRecoveryProject): Promise<void>;
	removeRecovery(projectId: string): Promise<void>;
}

export interface OpenFabProjectIdentityProvider {
	createProjectId(): string;
	now(): string;
}
