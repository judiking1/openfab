import type { RailDocument } from "../core/RailDocument";
import type { RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";
import { railWorkerStateMatchesSnapshotReadyExpectation } from "../worker/RailWorkerSnapshotReadiness";
import { RailStartupCancelledError } from "./RailStartupBridge";

/** Capture an owned mirror snapshot without traversing the authored model on the UI thread. */
export async function captureOpenFabProjectSnapshot(
	document: RailDocument,
	mirror: Pick<
		RailWorkerBridgeHandle,
		"getState" | "waitUntilSnapshotReady" | "captureCurrentSnapshot"
	>,
	signal: AbortSignal,
	isCurrent: () => boolean,
) {
	const map = document.map;
	const generation = map.getMutationGeneration();
	const sequence = document.getPatchSequence();
	const revision = map.getRevision();
	const nextAdvancedSwitchId = map.getAdvancedSwitchIdCursor();
	const portEquipment = document.portEquipment;
	const organizations = document.organizations;
	const relationships = document.relationships;
	const operations = document.operationalConfiguration;
	const initial = mirror.getState();
	const epoch = initial.epoch;
	const expectation = { sequence, revision, checksum: initial.targetChecksum };
	const assertCurrent = (): void => {
		if (
			signal.aborted ||
			!isCurrent() ||
			document.map !== map ||
			map.getMutationGeneration() !== generation ||
			document.getPatchSequence() !== sequence ||
			map.getRevision() !== revision ||
			map.getAdvancedSwitchIdCursor() !== nextAdvancedSwitchId ||
			document.portEquipment !== portEquipment ||
			document.organizations !== organizations ||
			document.relationships !== relationships ||
			document.operationalConfiguration !== operations
		) {
			throw new RailStartupCancelledError();
		}
		const state = mirror.getState();
		if (
			state.epoch !== epoch ||
			state.targetSequence !== sequence ||
			state.targetRevision !== revision ||
			state.targetChecksum !== expectation.checksum
		) {
			throw new RailStartupCancelledError();
		}
	};
	try {
		assertCurrent();
		// Incomplete physical layouts are valid projects and must remain recoverable.
		await mirror.waitUntilSnapshotReady(expectation, signal);
		assertCurrent();
		if (!railWorkerStateMatchesSnapshotReadyExpectation(mirror.getState(), expectation)) {
			throw new Error("프로젝트 저장에 필요한 레일 데이터가 아직 동기화되지 않았습니다");
		}
		const snapshot = await mirror.captureCurrentSnapshot(signal);
		assertCurrent();
		if (
			snapshot.sequence !== sequence ||
			snapshot.revision !== revision ||
			snapshot.checksum !== expectation.checksum ||
			snapshot.nextAdvancedSwitchId !== nextAdvancedSwitchId ||
			snapshot.portEquipment.nextPortId !== portEquipment.nextPortId ||
			snapshot.portEquipment.nextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
			snapshot.organizations.nextOrganizationId !== organizations.nextOrganizationId ||
			snapshot.relationships.nextRelationshipId !== relationships.nextRelationshipId
		) {
			throw new Error("프로젝트 저장 스냅샷이 현재 문서와 일치하지 않습니다");
		}
		return { snapshot, operations, assertCurrent };
	} catch (error) {
		// Normalize abort errors and discard failures from a replaced request/document.
		assertCurrent();
		throw error;
	}
}
