import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabSemanticBankDeleteIntent } from "../core/StaticFabSemanticBankDelete";
import type { StaticFabSemanticBankDetachProspectiveState } from "../core/StaticFabSemanticBankDetach";
import type { TileMap } from "../core/TileMap";
import {
	reviewStaticFabSemanticBankDetachProspective,
	reviewStaticFabSemanticRailTopology,
	type StaticFabSemanticBankDetachTopologyEvidence,
} from "./StaticFabSemanticBankDetachProspective";

export interface StaticFabSemanticBankDeleteProspectiveReview {
	readonly version: 1;
	readonly targetOrganizationId: number;
	readonly parentFabOrganizationId: number | null;
	readonly detachProved: boolean | null;
	readonly sourceTopology: StaticFabSemanticBankDetachTopologyEvidence;
	readonly evaluatedTopology: StaticFabSemanticBankDetachTopologyEvidence;
	readonly deletedBankTopology: StaticFabSemanticBankDetachTopologyEvidence;
	readonly authoredComponentDelta: number;
	readonly physicalComponentDelta: number;
	readonly portAttachmentStatus: "VALID";
	readonly cursorStatus: "PRESERVED";
	readonly prospectiveDeleteProved: true;
}

/** Compile the isolated deleted region and independently materialized final source. No Apply authority. */
export function reviewStaticFabSemanticBankDeleteProspective(
	source: StaticFabSemanticBankDetachProspectiveState,
	intent: StaticFabSemanticBankDeleteIntent,
	deletedMap: TileMap,
	prospective: StaticFabSemanticBankDetachProspectiveState,
): StaticFabSemanticBankDeleteProspectiveReview {
	const attached = intent.expectedParentOrganizationId !== null;
	if (attached) {
		const detach = reviewStaticFabSemanticBankDetachProspective(
			source.map,
			source.portEquipment,
			source.organizations,
			{ ...intent, action: "DETACH" },
			source.relationships,
		);
		if (!detach.prospectiveDetachProved)
			throw new Error(`삭제 전 독립 Detach 증명 실패 · ${detach.reason}`);
	}
	const deletedBankTopology = reviewStaticFabSemanticRailTopology(
		deletedMap,
		emptyPortEquipmentState(),
	);
	if (
		!deletedBankTopology.authoredComponentsClosed ||
		!deletedBankTopology.physicalComponentsClosed ||
		!deletedBankTopology.authoredPhysicalComponentMappingExact ||
		deletedBankTopology.authoredComponentCount !== 1 ||
		deletedBankTopology.physicalComponentCount !== 1
	)
		throw new Error("삭제할 Bank가 독립된 하나의 authored/physical 폐회로가 아닙니다");
	const sourceTopology = reviewStaticFabSemanticRailTopology(source.map, source.portEquipment);
	const evaluatedTopology = reviewStaticFabSemanticRailTopology(
		prospective.map,
		prospective.portEquipment,
	);
	const expectedDelta = attached ? 0 : -1;
	const authoredComponentDelta =
		evaluatedTopology.authoredComponentCount - sourceTopology.authoredComponentCount;
	const physicalComponentDelta =
		evaluatedTopology.physicalComponentCount - sourceTopology.physicalComponentCount;
	if (
		authoredComponentDelta !== expectedDelta ||
		physicalComponentDelta !== expectedDelta ||
		evaluatedTopology.authoredStrongComponentCount - sourceTopology.authoredStrongComponentCount !==
			expectedDelta ||
		evaluatedTopology.physicalStrongComponentCount - sourceTopology.physicalStrongComponentCount !==
			expectedDelta
	)
		throw new Error("Bank 삭제가 보존할 authored/physical component 또는 SCC를 변경합니다");
	for (const field of [
		"authoredOpenTerminalCount",
		"authoredUnsafeJunctionCount",
		"physicalOpenPathCount",
		"physicalInvalidPathCount",
		"physicalDiagnosticCount",
		"physicalTerminalCount",
		"physicalClearanceIssueCount",
	] as const)
		if (evaluatedTopology[field] > sourceTopology[field])
			throw new Error(`Bank 삭제 후 보존할 topology 결함이 증가했습니다 · ${field}`);
	if (
		source.map.getAdvancedSwitchIdCursor() !== prospective.map.getAdvancedSwitchIdCursor() ||
		source.portEquipment.nextPortId !== prospective.portEquipment.nextPortId ||
		source.portEquipment.nextEquipmentGroupId !== prospective.portEquipment.nextEquipmentGroupId ||
		source.organizations.nextOrganizationId !== prospective.organizations.nextOrganizationId ||
		source.relationships.nextRelationshipId !== prospective.relationships.nextRelationshipId
	)
		throw new Error("Bank 삭제가 ID cursor를 변경합니다");
	return Object.freeze({
		version: 1,
		targetOrganizationId: intent.targetOrganizationId,
		parentFabOrganizationId: intent.expectedParentOrganizationId,
		detachProved: attached ? true : null,
		sourceTopology,
		evaluatedTopology,
		deletedBankTopology,
		authoredComponentDelta,
		physicalComponentDelta,
		portAttachmentStatus: "VALID",
		cursorStatus: "PRESERVED",
		prospectiveDeleteProved: true,
	});
}
