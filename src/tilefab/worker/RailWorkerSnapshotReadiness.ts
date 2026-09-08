import type { RailWorkerAuthoredReadyExpectation, RailWorkerBridgeState } from "./RailWorkerBridge";

export function railWorkerStateMatchesSnapshotReadyExpectation(
	state: RailWorkerBridgeState,
	expectation: RailWorkerAuthoredReadyExpectation,
): boolean {
	return (
		state.status === "ready" &&
		state.simulationReady === false &&
		state.targetSequence === expectation.sequence &&
		state.targetRevision === expectation.revision &&
		state.targetChecksum === expectation.checksum &&
		state.sequence === expectation.sequence &&
		state.revision === expectation.revision &&
		state.checksum === expectation.checksum &&
		state.targetCells === state.cells &&
		state.targetEdges === state.edges &&
		state.targetSwitches === state.switches &&
		state.targetPorts === state.ports &&
		state.targetEquipmentGroups === state.equipmentGroups &&
		state.targetOrganizations === state.organizations &&
		state.targetAssemblyRelationships === state.assemblyRelationships &&
		state.targetAssemblyRelationshipNextId === state.assemblyRelationshipNextId &&
		state.targetOperationalConfigurationRevision === state.operationalConfigurationRevision &&
		state.targetOperationalConfigurationFingerprint === state.operationalConfigurationFingerprint
	);
}
