import {
	type StaticFabSemanticBankDetachSourceIdentity,
	staticFabSemanticBankDetachIntentFingerprint,
	staticFabSemanticBankDetachPlanFingerprint,
	staticFabSemanticBankDetachPlanShapeError,
	staticFabSemanticBankDetachSourceIdentitiesEqual,
} from "../core/StaticFabSemanticBankDetachCertification";
import { checksumRailPatchResult } from "./RailMirrorChecksum";
import type { PreparedStaticFabSemanticBankDetach } from "./StaticFabSemanticBankDetachProtocol";

export function staticFabSemanticBankDetachPreparedShapeError(value: unknown): string | null {
	try {
		if (!keys(value, ["valid", "failureCode", "reason", "plan", "review", "ticket", "evidence"]))
			return "Bank 분리 응답 형식이 유효하지 않습니다";
		const prepared = value as unknown as PreparedStaticFabSemanticBankDetach;
		if (typeof prepared.valid !== "boolean" || !text(prepared.reason))
			return "Bank 분리 응답 상태가 유효하지 않습니다";
		if (!prepared.valid)
			return text(prepared.failureCode) &&
				prepared.plan === null &&
				prepared.review === null &&
				prepared.ticket === null &&
				prepared.evidence === null
				? null
				: "거절된 Bank 분리 응답에 적용 권한이 포함되어 있습니다";
		const planError = staticFabSemanticBankDetachPlanShapeError(prepared.plan);
		if (planError) return planError;
		const { plan, ticket, evidence } = prepared;
		if (
			!plan ||
			!ticket ||
			!evidence ||
			prepared.failureCode !== null ||
			JSON.stringify(prepared.review) !== JSON.stringify(plan.review)
		)
			return "Bank 분리 검토와 적용 계획이 다릅니다";
		if (
			!keys(ticket, [
				"ticketId",
				"validationLevel",
				"source",
				"prospective",
				"intentFingerprint",
				"planFingerprint",
			]) ||
			!positive(ticket.ticketId) ||
			ticket.validationLevel !== "exact" ||
			!identity(ticket.source) ||
			!identity(ticket.prospective) ||
			ticket.intentFingerprint !== staticFabSemanticBankDetachIntentFingerprint(plan.intent) ||
			ticket.planFingerprint !== staticFabSemanticBankDetachPlanFingerprint(plan)
		)
			return "Bank 분리 ticket 형식 또는 fingerprint가 유효하지 않습니다";
		if (
			plan.baseRevision !== ticket.source.revision ||
			checksumRailPatchResult(ticket.source.checksum, plan.transition) !==
				ticket.prospective.checksum ||
			plan.basePatchSequence !== ticket.source.patchSequence ||
			!staticFabSemanticBankDetachSourceIdentitiesEqual(ticket.prospective, {
				...ticket.source,
				revision: ticket.source.revision + plan.transition.changes.length,
				patchSequence: ticket.source.patchSequence + 1,
				checksum: ticket.prospective.checksum,
			})
		)
			return "Bank 분리 ticket의 세대 또는 ID cursor가 다릅니다";
		if (
			!evidence.prospectiveDetachProved ||
			evidence.targetOrganizationId !== plan.intent.targetOrganizationId ||
			evidence.parentFabOrganizationId !== plan.intent.expectedParentOrganizationId ||
			evidence.structuralCutFingerprint !== plan.review.structuralCutFingerprint ||
			evidence.removedDirectedEdgeCount !== plan.review.removedDirectedEdgeCount ||
			evidence.issueCode !== null ||
			evidence.structuralCutIssueCode !== null ||
			evidence.authoredComponentDelta !== 1 ||
			evidence.physicalComponentDelta !== 1 ||
			evidence.portAttachmentStatus !== "VALID" ||
			evidence.cursorStatus !== "PRESERVED" ||
			!evidence.sourceTopology?.authoredComponentsClosed ||
			!evidence.sourceTopology.physicalComponentsClosed ||
			!evidence.evaluatedTopology?.authoredComponentsClosed ||
			!evidence.evaluatedTopology.physicalComponentsClosed ||
			!evidence.selectedBankTopology?.closed ||
			!evidence.retainedFabTopology?.closed
		)
			return "Bank 분리의 폐회로·Port 보존 증명이 유효하지 않습니다";
		return null;
	} catch {
		return "Bank 분리 응답을 안전하게 해석할 수 없습니다";
	}
}

function identity(value: unknown): value is StaticFabSemanticBankDetachSourceIdentity {
	return (
		keys(value, [
			"revision",
			"patchSequence",
			"checksum",
			"nextAdvancedSwitchId",
			"nextPortId",
			"nextEquipmentGroupId",
			"nextOrganizationId",
			"nextRelationshipId",
		]) &&
		nonnegative(value.revision) &&
		nonnegative(value.patchSequence) &&
		text(value.checksum) &&
		[
			value.nextAdvancedSwitchId,
			value.nextPortId,
			value.nextEquipmentGroupId,
			value.nextOrganizationId,
			value.nextRelationshipId,
		].every(positive)
	);
}
function keys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === names.length &&
		names.every((name) => Object.hasOwn(value, name))
	);
}
function nonnegative(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
function positive(value: unknown): value is number {
	return nonnegative(value) && value > 0;
}
function text(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}
