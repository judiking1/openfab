import type { RailDocument } from "../core/RailDocument";
import {
	type RailMirrorSnapshot,
	revokeRailMirrorSnapshotCaptureAuthority,
} from "../worker/RailMirrorChecksum";
import type { RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";
import { railWorkerStateMatchesSnapshotReadyExpectation } from "../worker/RailWorkerSnapshotReadiness";

type SnapshotMirror = Pick<
	RailWorkerBridgeHandle,
	"getState" | "waitUntilSnapshotReady" | "captureCurrentSnapshot"
>;

/** Reuse the authoritative mirror handoff without encoding the whole document on the UI thread. */
export async function captureOrganizationBundlePlacementSnapshot(
	document: RailDocument,
	mirror: SnapshotMirror,
	signal: AbortSignal,
	isCurrent: () => boolean,
): Promise<RailMirrorSnapshot> {
	const assertRequestCurrent = (): void => {
		if (signal.aborted || !isCurrent()) {
			throw new DOMException("Organization placement snapshot cancelled.", "AbortError");
		}
	};
	assertRequestCurrent();
	const map = document.map;
	const portEquipment = document.portEquipment;
	const organizations = document.organizations;
	const relationships = document.relationships;
	const sequence = document.getPatchSequence();
	const revision = map.getRevision();
	const nextAdvancedSwitchId = map.getAdvancedSwitchIdCursor();
	const nextPortId = portEquipment.nextPortId;
	const nextEquipmentGroupId = portEquipment.nextEquipmentGroupId;
	const nextOrganizationId = organizations.nextOrganizationId;
	const nextRelationshipId = relationships.nextRelationshipId;
	const target = mirror.getState();
	if (
		target.status === "error" ||
		target.simulationReady !== false ||
		target.targetSequence !== sequence ||
		target.targetRevision !== revision ||
		target.targetCells !== map.size ||
		target.targetEdges !== map.edgeCount ||
		target.targetSwitches !== map.advancedSwitchCount ||
		target.targetPorts !== portEquipment.ports.length ||
		target.targetEquipmentGroups !== portEquipment.equipmentGroups.length ||
		target.targetOrganizations !== organizations.records.length ||
		target.targetAssemblyRelationships !== relationships.records.length ||
		target.targetAssemblyRelationshipNextId !== nextRelationshipId
	) {
		throw new Error("조직 청사진을 배치할 현재 문서의 Rail mirror를 찾지 못했습니다");
	}
	const expectation = Object.freeze({ sequence, revision, checksum: target.targetChecksum });
	const assertSourceCurrent = (): void => {
		assertRequestCurrent();
		if (
			document.map !== map ||
			document.portEquipment !== portEquipment ||
			document.organizations !== organizations ||
			document.relationships !== relationships ||
			document.getPatchSequence() !== sequence ||
			map.getRevision() !== revision ||
			map.getAdvancedSwitchIdCursor() !== nextAdvancedSwitchId ||
			portEquipment.nextPortId !== nextPortId ||
			portEquipment.nextEquipmentGroupId !== nextEquipmentGroupId ||
			organizations.nextOrganizationId !== nextOrganizationId ||
			relationships.nextRelationshipId !== nextRelationshipId
		) {
			throw new Error("조직 청사진의 원본 문서가 변경되었습니다 · 다시 배치하세요");
		}
		if (!railWorkerStateMatchesSnapshotReadyExpectation(mirror.getState(), expectation)) {
			throw new Error("조직 청사진의 Rail mirror 세대가 변경되었습니다 · 다시 배치하세요");
		}
	};
	await mirror.waitUntilSnapshotReady(expectation, signal);
	assertSourceCurrent();
	const snapshot = await mirror.captureCurrentSnapshot(signal);
	try {
		assertSourceCurrent();
		if (
			snapshot.sequence !== sequence ||
			snapshot.revision !== revision ||
			snapshot.checksum !== expectation.checksum ||
			snapshot.nextAdvancedSwitchId !== nextAdvancedSwitchId ||
			snapshot.portEquipment.nextPortId !== nextPortId ||
			snapshot.portEquipment.nextEquipmentGroupId !== nextEquipmentGroupId ||
			snapshot.organizations.nextOrganizationId !== nextOrganizationId ||
			snapshot.relationships.nextRelationshipId !== nextRelationshipId
		) {
			throw new Error("조직 청사진에 전달된 스냅샷이 현재 문서와 일치하지 않습니다");
		}
		return snapshot;
	} catch (error) {
		revokeRailMirrorSnapshotCaptureAuthority(snapshot);
		throw error;
	}
}
