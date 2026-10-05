import { reviewStaticFabSemanticFabDeleteProspective } from "../compile/StaticFabSemanticFabDeleteProspective";
import { applyPortEquipmentMutations } from "../core/EquipmentGroup";
import { copyOperationalConfigurationState } from "../core/OperationalConfiguration";
import { RailDocument } from "../core/RailDocument";
import { applyStaticFabAssemblyRelationshipMutations } from "../core/StaticFabAssemblyRelationship";
import { applyStaticFabOrganizationMutations } from "../core/StaticFabOrganization";
import {
	planStaticFabSemanticFabDelete,
	staticFabSemanticFabDeleteIntentError,
} from "../core/StaticFabSemanticFabDelete";
import {
	staticFabSemanticFabDeleteIntentFingerprint,
	staticFabSemanticFabDeletePlanFingerprint,
	staticFabSemanticFabDeleteSourceIdentitiesEqual,
	staticFabSemanticFabDeleteSourceIdentity,
} from "../core/StaticFabSemanticFabDeleteCertification";
import { checksumRailMap, checksumRailPatchResult } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PreparedStaticFabSemanticFabDelete,
	type PrepareStaticFabSemanticFabDeleteRequest,
	STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION,
} from "./StaticFabSemanticFabDeleteProtocol";

/** A disposable Worker owns one immutable snapshot and independently checks the exact transition. */
export function prepareStaticFabSemanticFabDelete(
	request: PrepareStaticFabSemanticFabDeleteRequest,
): PreparedStaticFabSemanticFabDelete {
	try {
		if (
			!request ||
			request.type !== "PREPARE_STATIC_FAB_SEMANTIC_FAB_DELETE" ||
			request.version !== STATIC_FAB_SEMANTIC_FAB_DELETE_PROTOCOL_VERSION ||
			!Number.isSafeInteger(request.requestId) ||
			request.requestId <= 0 ||
			!Number.isSafeInteger(request.ticketId) ||
			request.ticketId <= 0
		)
			return rejected("REQUEST_INVALID", "Fab 삭제 Worker 요청이 유효하지 않습니다");
		const intentError = staticFabSemanticFabDeleteIntentError(request.intent);
		if (intentError) return rejected("INVALID_INTENT", intentError);
		const intentFingerprint = staticFabSemanticFabDeleteIntentFingerprint(request.intent);
		if (intentFingerprint !== request.expectedIntentFingerprint)
			return rejected("INTENT_MISMATCH", "Fab 삭제 요청이 전송 중 변경되었습니다");
		const hydrated = hydrateRailMirrorSnapshotDocument(request.snapshot);
		const document = RailDocument.fromLoadedMap(
			hydrated.map,
			hydrated.getPatchSequence(),
			hydrated.portEquipment,
			hydrated.organizations,
			copyOperationalConfigurationState(request.operationalConfiguration),
			hydrated.relationships,
		);
		const sourceChecksum = checksumRailMap(
			document.map,
			document.portEquipment,
			document.organizations,
			document.relationships,
		);
		const source = staticFabSemanticFabDeleteSourceIdentity(document, sourceChecksum);
		if (
			sourceChecksum !== request.snapshot.checksum ||
			!staticFabSemanticFabDeleteSourceIdentitiesEqual(source, request.expectedSource)
		)
			return rejected("STALE_SOURCE", "Fab 삭제 요청과 고정한 원본 세대가 다릅니다");
		const planning = planStaticFabSemanticFabDelete(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			document.relationships,
			document.operationalConfiguration,
			request.intent,
		);
		if (!planning.valid) return rejected(planning.issueCode, planning.reason);
		const { plan, prospectiveState } = planning;
		const patch = plan.transition;
		const nextMap = document.map.clone();
		nextMap.applyAtomicMutations(patch.changes, patch.switchChanges);
		const portEquipment = applyPortEquipmentMutations(
			document.portEquipment,
			patch.portChanges,
			patch.equipmentGroupChanges,
		);
		const organizations = applyStaticFabOrganizationMutations(
			document.organizations,
			patch.organizationChanges,
			patch.organizationNextIdAfter,
			true,
		);
		const relationships = applyStaticFabAssemblyRelationshipMutations(
			document.relationships,
			patch.relationshipChanges ?? [],
			patch.relationshipNextIdAfter ?? source.nextRelationshipId,
		);
		const independent = { map: nextMap, portEquipment, organizations, relationships };
		const evidence = reviewStaticFabSemanticFabDeleteProspective(
			{
				map: document.map,
				portEquipment: document.portEquipment,
				organizations: document.organizations,
				relationships: document.relationships,
			},
			request.intent,
			planning.deletedMap,
			independent,
		);
		const checksum = checksumRailMap(nextMap, portEquipment, organizations, relationships);
		const plannerChecksum = checksumRailMap(
			prospectiveState.map,
			prospectiveState.portEquipment,
			prospectiveState.organizations,
			prospectiveState.relationships,
		);
		const incrementalChecksum = checksumRailPatchResult(sourceChecksum, patch);
		if (
			checksum !== plannerChecksum ||
			checksum !== incrementalChecksum ||
			nextMap.getAdvancedSwitchIdCursor() !== source.nextAdvancedSwitchId ||
			organizations.nextOrganizationId !== source.nextOrganizationId ||
			relationships.nextRelationshipId !== source.nextRelationshipId
		)
			return rejected(
				"CHECKSUM_MISMATCH",
				"Fab 삭제 결과의 전체·증분 checksum 또는 ID cursor가 다릅니다",
			);
		const ticket = Object.freeze({
			ticketId: request.ticketId,
			validationLevel: "exact" as const,
			source,
			prospective: Object.freeze({
				...source,
				revision: nextMap.getRevision(),
				patchSequence: source.patchSequence + 1,
				checksum,
			}),
			intentFingerprint,
			planFingerprint: staticFabSemanticFabDeletePlanFingerprint(plan),
		});
		return Object.freeze({
			valid: true,
			failureCode: null,
			reason: planning.reason,
			plan,
			review: plan.review,
			ticket,
			evidence,
		});
	} catch (error) {
		return rejected(
			"INVALID_SOURCE",
			error instanceof Error ? error.message : "Fab 삭제 원본을 검증할 수 없습니다",
		);
	}
}

function rejected(failureCode: string, reason: string): PreparedStaticFabSemanticFabDelete {
	return Object.freeze({
		valid: false,
		failureCode,
		reason: reason.slice(0, 4_096),
		plan: null,
		review: null,
		ticket: null,
		evidence: null,
	});
}
