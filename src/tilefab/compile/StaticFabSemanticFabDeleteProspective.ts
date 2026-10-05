import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabSemanticBankDetachProspectiveState } from "../core/StaticFabSemanticBankDetach";
import type { StaticFabSemanticFabDeleteIntent } from "../core/StaticFabSemanticFabDelete";
import type { TileMap } from "../core/TileMap";
import {
	reviewStaticFabSemanticRailTopology,
	type StaticFabSemanticBankDetachTopologyEvidence,
} from "./StaticFabSemanticBankDetachProspective";

export interface StaticFabSemanticFabDeleteProspectiveReview {
	readonly version: 1;
	readonly targetOrganizationId: number;
	readonly sourceTopology: StaticFabSemanticBankDetachTopologyEvidence;
	readonly evaluatedTopology: StaticFabSemanticBankDetachTopologyEvidence;
	readonly deletedFabTopology: StaticFabSemanticBankDetachTopologyEvidence;
	readonly authoredComponentDelta: number;
	readonly physicalComponentDelta: number;
	readonly portAttachmentStatus: "VALID";
	readonly cursorStatus: "PRESERVED";
	readonly prospectiveDeleteProved: true;
}

/** Compile the isolated deleted region and independently materialized final source. No Apply authority. */
export function reviewStaticFabSemanticFabDeleteProspective(
	source: StaticFabSemanticBankDetachProspectiveState,
	intent: StaticFabSemanticFabDeleteIntent,
	deletedMap: TileMap,
	prospective: StaticFabSemanticBankDetachProspectiveState,
): StaticFabSemanticFabDeleteProspectiveReview {
	const deletedFabTopology = reviewStaticFabSemanticRailTopology(
		deletedMap,
		emptyPortEquipmentState(),
	);
	if (
		!deletedFabTopology.authoredComponentsClosed ||
		!deletedFabTopology.physicalComponentsClosed ||
		!deletedFabTopology.authoredPhysicalComponentMappingExact ||
		deletedFabTopology.authoredComponentCount < 1 ||
		deletedFabTopology.physicalComponentCount !== deletedFabTopology.authoredComponentCount
	)
		throw new Error("삭제할 Fab가 외부에서 독립된 authored/physical 폐회로 집합이 아닙니다");
	const sourceTopology = reviewStaticFabSemanticRailTopology(source.map, source.portEquipment);
	const evaluatedTopology = reviewStaticFabSemanticRailTopology(
		prospective.map,
		prospective.portEquipment,
	);
	const expectedDelta = -deletedFabTopology.authoredComponentCount;
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
		throw new Error("Fab 삭제가 보존할 authored/physical component 또는 SCC를 변경합니다");
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
			throw new Error(`Fab 삭제 후 보존할 topology 결함이 증가했습니다 · ${field}`);
	if (
		source.map.getAdvancedSwitchIdCursor() !== prospective.map.getAdvancedSwitchIdCursor() ||
		source.portEquipment.nextPortId !== prospective.portEquipment.nextPortId ||
		source.portEquipment.nextEquipmentGroupId !== prospective.portEquipment.nextEquipmentGroupId ||
		source.organizations.nextOrganizationId !== prospective.organizations.nextOrganizationId ||
		source.relationships.nextRelationshipId !== prospective.relationships.nextRelationshipId
	)
		throw new Error("Fab 삭제가 ID cursor를 변경합니다");
	return Object.freeze({
		version: 1,
		targetOrganizationId: intent.targetOrganizationId,
		sourceTopology,
		evaluatedTopology,
		deletedFabTopology,
		authoredComponentDelta,
		physicalComponentDelta,
		portAttachmentStatus: "VALID",
		cursorStatus: "PRESERVED",
		prospectiveDeleteProved: true,
	});
}
