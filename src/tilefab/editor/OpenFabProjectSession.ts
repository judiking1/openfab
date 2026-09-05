export interface OpenFabProjectDirtyState {
	readonly savedChecksum: string;
	readonly savedOperationalConfigurationFingerprint: string;
	readonly migrated: boolean;
	readonly needsSave: boolean;
}

export interface OpenFabProjectRecoveryScheduleState {
	readonly dirty: boolean;
	readonly recoverableContent: boolean;
	readonly scaleProbeActive: boolean;
	readonly startupReady: boolean;
	readonly modelSyncPending: boolean;
	readonly recoveryLookupComplete: boolean;
	readonly projectId: string;
	readonly recoveryOfferProjectId: string | null;
	readonly operationIdle: boolean;
}

export interface OpenFabProjectTransitionProtectionState {
	readonly dirty: boolean;
	readonly mustPreserve: boolean;
	readonly authoredRecords: number;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}

export function isOpenFabProjectDirty(
	state: OpenFabProjectDirtyState,
	currentChecksum: string,
	currentOperationalConfigurationFingerprint: string,
): boolean {
	return (
		state.needsSave ||
		state.migrated ||
		state.savedChecksum !== currentChecksum ||
		state.savedOperationalConfigurationFingerprint !== currentOperationalConfigurationFingerprint
	);
}

export function shouldProtectOpenFabProjectTransition(
	state: OpenFabProjectTransitionProtectionState,
): boolean {
	return (
		state.dirty &&
		(state.mustPreserve || state.authoredRecords > 0 || state.canUndo || state.canRedo)
	);
}

export function shouldScheduleOpenFabProjectRecovery(
	state: OpenFabProjectRecoveryScheduleState,
): boolean {
	return (
		state.dirty &&
		state.recoverableContent &&
		!state.scaleProbeActive &&
		state.startupReady &&
		!state.modelSyncPending &&
		state.recoveryLookupComplete &&
		state.recoveryOfferProjectId !== state.projectId &&
		state.operationIdle
	);
}
