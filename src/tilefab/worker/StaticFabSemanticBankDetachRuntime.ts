import { reviewStaticFabSemanticBankDetachProspective } from "../compile/StaticFabSemanticBankDetachProspective";
import { applyStaticFabAssemblyRelationshipMutations } from "../core/StaticFabAssemblyRelationship";
import { applyStaticFabOrganizationMutations } from "../core/StaticFabOrganization";
import {
	planStaticFabSemanticBankDetach,
	staticFabSemanticBankDetachIntentError,
} from "../core/StaticFabSemanticBankDetach";
import {
	staticFabSemanticBankDetachIntentFingerprint,
	staticFabSemanticBankDetachPlanFingerprint,
	staticFabSemanticBankDetachSourceIdentitiesEqual,
	staticFabSemanticBankDetachSourceIdentity,
} from "../core/StaticFabSemanticBankDetachCertification";
import { checksumRailMap, checksumRailPatchResult } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	type PreparedStaticFabSemanticBankDetach,
	type PrepareStaticFabSemanticBankDetachRequest,
	STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION,
} from "./StaticFabSemanticBankDetachProtocol";

/** A disposable Worker owns one immutable snapshot and independently checks the exact transition. */
export function prepareStaticFabSemanticBankDetach(
	request: PrepareStaticFabSemanticBankDetachRequest,
): PreparedStaticFabSemanticBankDetach {
	try {
		if (
			!request ||
			request.type !== "PREPARE_STATIC_FAB_SEMANTIC_BANK_DETACH" ||
			request.version !== STATIC_FAB_SEMANTIC_BANK_DETACH_PROTOCOL_VERSION ||
			!Number.isSafeInteger(request.requestId) ||
			request.requestId <= 0 ||
			!Number.isSafeInteger(request.ticketId) ||
			request.ticketId <= 0
		)
			return rejected("REQUEST_INVALID", "Bank 분리 Worker 요청이 유효하지 않습니다");
		const intentError = staticFabSemanticBankDetachIntentError(request.intent);
		if (intentError) return rejected("INVALID_INTENT", intentError);
		const intentFingerprint = staticFabSemanticBankDetachIntentFingerprint(request.intent);
		if (intentFingerprint !== request.expectedIntentFingerprint)
			return rejected("INTENT_MISMATCH", "Bank 분리 요청이 전송 중 변경되었습니다");
		const document = hydrateRailMirrorSnapshotDocument(request.snapshot);
		const sourceChecksum = checksumRailMap(
			document.map,
			document.portEquipment,
			document.organizations,
			document.relationships,
		);
		const source = staticFabSemanticBankDetachSourceIdentity(document, sourceChecksum);
		if (
			sourceChecksum !== request.snapshot.checksum ||
			!staticFabSemanticBankDetachSourceIdentitiesEqual(source, request.expectedSource)
		)
			return rejected("STALE_SOURCE", "Bank 분리 요청과 고정한 원본 세대가 다릅니다");
		const planning = planStaticFabSemanticBankDetach(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			document.relationships,
			request.intent,
		);
		if (!planning.valid) return rejected(planning.issueCode, planning.reason);
		const { plan, prospectiveState } = planning;
		const evidence = reviewStaticFabSemanticBankDetachProspective(
			document.map,
			document.portEquipment,
			document.organizations,
			request.intent,
			document.relationships,
		);
		if (
			!evidence.prospectiveDetachProved ||
			evidence.structuralCutFingerprint !== plan.review.structuralCutFingerprint ||
			evidence.removedDirectedEdgeCount !== plan.review.removedDirectedEdgeCount
		)
			return rejected(evidence.issueCode ?? "PROSPECTIVE_MISMATCH", evidence.reason);
		const patch = plan.transition;
		const nextMap = document.map.clone();
		nextMap.applyAtomicMutations(patch.changes, []);
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
		const checksum = checksumRailMap(nextMap, document.portEquipment, organizations, relationships);
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
				"Bank 분리 결과의 전체·증분 checksum 또는 ID cursor가 다릅니다",
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
			planFingerprint: staticFabSemanticBankDetachPlanFingerprint(plan),
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
			error instanceof Error ? error.message : "Bank 분리 원본을 검증할 수 없습니다",
		);
	}
}

function rejected(failureCode: string, reason: string): PreparedStaticFabSemanticBankDetach {
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
