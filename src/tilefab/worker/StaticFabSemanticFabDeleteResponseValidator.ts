import {
	type StaticFabSemanticFabDeleteSourceIdentity,
	staticFabSemanticFabDeleteIntentFingerprint,
	staticFabSemanticFabDeletePlanFingerprint,
	staticFabSemanticFabDeletePlanShapeError,
	staticFabSemanticFabDeleteSourceIdentitiesEqual,
} from "../core/StaticFabSemanticFabDeleteCertification";
import { checksumRailPatchResult } from "./RailMirrorChecksum";
import type { PreparedStaticFabSemanticFabDelete } from "./StaticFabSemanticFabDeleteProtocol";

export function staticFabSemanticFabDeletePreparedShapeError(value: unknown): string | null {
	try {
		if (!keys(value, ["valid", "failureCode", "reason", "plan", "review", "ticket", "evidence"]))
			return "Fab 삭제 응답 형식이 유효하지 않습니다";
		const prepared = value as unknown as PreparedStaticFabSemanticFabDelete;
		if (typeof prepared.valid !== "boolean" || !text(prepared.reason))
			return "Fab 삭제 응답 상태가 유효하지 않습니다";
		if (!prepared.valid)
			return text(prepared.failureCode) &&
				prepared.plan === null &&
				prepared.review === null &&
				prepared.ticket === null &&
				prepared.evidence === null
				? null
				: "거절된 Fab 삭제 응답에 적용 권한이 포함되어 있습니다";
		const planError = staticFabSemanticFabDeletePlanShapeError(prepared.plan);
		if (planError) return planError;
		const { plan, ticket, evidence } = prepared;
		if (
			!plan ||
			!ticket ||
			!evidence ||
			prepared.failureCode !== null ||
			JSON.stringify(prepared.review) !== JSON.stringify(plan.review)
		)
			return "Fab 삭제 검토와 적용 계획이 다릅니다";
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
			ticket.intentFingerprint !== staticFabSemanticFabDeleteIntentFingerprint(plan.intent) ||
			ticket.planFingerprint !== staticFabSemanticFabDeletePlanFingerprint(plan)
		)
			return "Fab 삭제 ticket 형식 또는 fingerprint가 유효하지 않습니다";
		if (
			plan.baseRevision !== ticket.source.revision ||
			checksumRailPatchResult(ticket.source.checksum, plan.transition) !==
				ticket.prospective.checksum ||
			plan.basePatchSequence !== ticket.source.patchSequence ||
			!staticFabSemanticFabDeleteSourceIdentitiesEqual(ticket.prospective, {
				...ticket.source,
				revision:
					ticket.source.revision +
					plan.transition.changes.length +
					plan.transition.switchChanges.length,
				patchSequence: ticket.source.patchSequence + 1,
				checksum: ticket.prospective.checksum,
			})
		)
			return "Fab 삭제 ticket의 세대 또는 ID cursor가 다릅니다";
		if (
			!keys(evidence, [
				"version",
				"targetOrganizationId",
				"sourceTopology",
				"evaluatedTopology",
				"deletedFabTopology",
				"authoredComponentDelta",
				"physicalComponentDelta",
				"portAttachmentStatus",
				"cursorStatus",
				"prospectiveDeleteProved",
			]) ||
			evidence.version !== 1 ||
			!topology(evidence.sourceTopology) ||
			!topology(evidence.evaluatedTopology) ||
			!topology(evidence.deletedFabTopology)
		)
			return "Fab 삭제 topology 증명 형식이 유효하지 않습니다";
		const expectedDelta = -evidence.deletedFabTopology.authoredComponentCount;
		if (
			evidence.prospectiveDeleteProved !== true ||
			evidence.targetOrganizationId !== plan.intent.targetOrganizationId ||
			evidence.authoredComponentDelta !== expectedDelta ||
			evidence.evaluatedTopology.authoredComponentCount -
				evidence.sourceTopology.authoredComponentCount !==
				expectedDelta ||
			evidence.evaluatedTopology.physicalComponentCount -
				evidence.sourceTopology.physicalComponentCount !==
				expectedDelta ||
			evidence.sourceTopology.authoredDirectedEdgeCount -
				evidence.evaluatedTopology.authoredDirectedEdgeCount !==
				plan.review.removed.directedEdges.count ||
			evidence.physicalComponentDelta !== expectedDelta ||
			evidence.portAttachmentStatus !== "VALID" ||
			evidence.cursorStatus !== "PRESERVED" ||
			!evidence.deletedFabTopology?.authoredComponentsClosed ||
			!evidence.deletedFabTopology.physicalComponentsClosed ||
			!evidence.deletedFabTopology.authoredPhysicalComponentMappingExact ||
			evidence.deletedFabTopology.authoredComponentCount < 1 ||
			evidence.deletedFabTopology.physicalComponentCount !==
				evidence.deletedFabTopology.authoredComponentCount
		)
			return "Fab 삭제의 독립 폐회로·Port·cursor 증명이 유효하지 않습니다";

		if (
			evidence.evaluatedTopology.authoredStrongComponentCount -
				evidence.sourceTopology.authoredStrongComponentCount !==
				expectedDelta ||
			evidence.evaluatedTopology.physicalStrongComponentCount -
				evidence.sourceTopology.physicalStrongComponentCount !==
				expectedDelta ||
			evidence.deletedFabTopology.authoredStrongComponentCount !==
				evidence.deletedFabTopology.authoredComponentCount ||
			evidence.deletedFabTopology.physicalStrongComponentCount !==
				evidence.deletedFabTopology.physicalComponentCount
		)
			return "Fab 삭제의 SCC 변화 증명이 유효하지 않습니다";
		for (const field of [
			"authoredOpenTerminalCount",
			"authoredUnsafeJunctionCount",
			"physicalOpenPathCount",
			"physicalInvalidPathCount",
			"physicalDiagnosticCount",
			"physicalTerminalCount",
			"physicalClearanceIssueCount",
		] as const)
			if (evidence.evaluatedTopology[field] > evidence.sourceTopology[field])
				return "Fab 삭제 후 topology 결함이 증가했습니다";

		return null;
	} catch {
		return "Fab 삭제 응답을 안전하게 해석할 수 없습니다";
	}
}

function identity(value: unknown): value is StaticFabSemanticFabDeleteSourceIdentity {
	return (
		keys(value, [
			"revision",
			"patchSequence",
			"checksum",
			"operationalConfigurationFingerprint",
			"nextAdvancedSwitchId",
			"nextPortId",
			"nextEquipmentGroupId",
			"nextOrganizationId",
			"nextRelationshipId",
		]) &&
		nonnegative(value.revision) &&
		nonnegative(value.patchSequence) &&
		text(value.checksum) &&
		text(value.operationalConfigurationFingerprint) &&
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

function topology(value: unknown): boolean {
	const counts = [
		"authoredCellCount",
		"authoredDirectedEdgeCount",
		"authoredComponentCount",
		"authoredStrongComponentCount",
		"authoredOpenTerminalCount",
		"authoredUnsafeJunctionCount",
		"physicalPathCount",
		"physicalComponentCount",
		"physicalStrongComponentCount",
		"physicalOpenPathCount",
		"physicalInvalidPathCount",
		"physicalDiagnosticCount",
		"physicalTerminalCount",
		"physicalClearanceIssueCount",
	];
	const flags = [
		"authoredComponentsClosed",
		"physicalComponentsClosed",
		"authoredPhysicalComponentMappingExact",
	];
	return (
		keys(value, [...counts, ...flags]) &&
		counts.every((key) => nonnegative(value[key])) &&
		flags.every((key) => typeof value[key] === "boolean")
	);
}
