import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { RailDocument } from "./RailDocument";
import { railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	planStaticFabSemanticBankDetach,
	STATIC_FAB_SEMANTIC_BANK_DETACH_ID_SAMPLE_LIMIT,
	STATIC_FAB_SEMANTIC_BANK_DETACH_KIND,
	STATIC_FAB_SEMANTIC_BANK_DETACH_MAX_CUT_EDGES,
	type StaticFabSemanticBankDetachIntent,
	type StaticFabSemanticBankDetachPlan,
	staticFabSemanticBankDetachIntentError,
} from "./StaticFabSemanticBankDetach";

export interface StaticFabSemanticBankDetachScope {
	readonly projectId: string;
	readonly projectGeneration: number;
}

export interface StaticFabSemanticBankDetachSourceIdentity {
	readonly revision: number;
	readonly patchSequence: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
}

export interface StaticFabSemanticBankDetachWorkerTicket {
	readonly ticketId: number;
	readonly validationLevel: "exact";
	readonly source: StaticFabSemanticBankDetachSourceIdentity;
	readonly prospective: StaticFabSemanticBankDetachSourceIdentity;
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
}

export interface StaticFabSemanticBankDetachPermit {
	readonly ticketId: number;
}

interface BoundSource {
	readonly document: RailDocument;
	readonly scope: StaticFabSemanticBankDetachScope;
	readonly map: RailDocument["map"];
	readonly mutationGeneration: number;
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly identity: StaticFabSemanticBankDetachSourceIdentity;
	readonly intentFingerprint: string;
}

const permits = new WeakMap<object, BoundSource>();
const plans = new WeakMap<object, BoundSource & { readonly planFingerprint: string }>();
const adoptedByPermit = new WeakMap<object, StaticFabSemanticBankDetachPlan>();
let nextTicketId = 1;

export function staticFabSemanticBankDetachSourceIdentity(
	document: RailDocument,
	checksum: string,
): StaticFabSemanticBankDetachSourceIdentity {
	return Object.freeze({
		revision: document.map.getRevision(),
		patchSequence: document.getPatchSequence(),
		checksum,
		nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
		nextPortId: document.portEquipment.nextPortId,
		nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: document.organizations.nextOrganizationId,
		nextRelationshipId: document.relationships.nextRelationshipId,
	});
}

export function staticFabSemanticBankDetachIntentFingerprint(
	intent: StaticFabSemanticBankDetachIntent,
): string {
	const error = staticFabSemanticBankDetachIntentError(intent);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([STATIC_FAB_SEMANTIC_BANK_DETACH_KIND, intent.action, intent.targetRole]);
	checksum.addNumbers([
		intent.version,
		intent.targetOrganizationId,
		intent.expectedParentOrganizationId,
	]);
	return checksum.digest();
}

export function staticFabSemanticBankDetachPlanFingerprint(
	plan: StaticFabSemanticBankDetachPlan,
): string {
	const error = staticFabSemanticBankDetachPlanShapeError(plan);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.kind,
		staticFabSemanticBankDetachIntentFingerprint(plan.intent),
		JSON.stringify(plan.review),
		railPatchTransitionFingerprint(plan.transition),
	]);
	checksum.addNumbers([plan.baseRevision, plan.basePatchSequence]);
	return checksum.digest();
}

export function issueStaticFabSemanticBankDetachPermit(
	document: RailDocument,
	scope: StaticFabSemanticBankDetachScope,
	intent: StaticFabSemanticBankDetachIntent,
	sourceChecksum: string,
): StaticFabSemanticBankDetachPermit {
	if (
		typeof scope.projectId !== "string" ||
		!scope.projectId ||
		!Number.isSafeInteger(scope.projectGeneration) ||
		scope.projectGeneration < 0 ||
		!sourceChecksum ||
		!Number.isSafeInteger(nextTicketId)
	)
		throw new Error("Bank 분리의 프로젝트·문서 세대가 유효하지 않습니다");
	const permit = Object.freeze({ ticketId: nextTicketId++ });
	permits.set(
		permit,
		Object.freeze({
			document,
			scope: Object.freeze({ ...scope }),
			map: document.map,
			mutationGeneration: document.map.getMutationGeneration(),
			portEquipment: document.portEquipment,
			organizations: document.organizations,
			relationships: document.relationships,
			identity: staticFabSemanticBankDetachSourceIdentity(document, sourceChecksum),
			intentFingerprint: staticFabSemanticBankDetachIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabSemanticBankDetachPermit(
	permit: StaticFabSemanticBankDetachPermit,
): void {
	permits.delete(permit);
	const adopted = adoptedByPermit.get(permit);
	if (adopted) plans.delete(adopted);
	adoptedByPermit.delete(permit);
}

/** Every attempt consumes the permit, including malformed, stale and mismatched responses. */
export function adoptStaticFabSemanticBankDetachWorkerPlan(
	permit: StaticFabSemanticBankDetachPermit,
	ticket: StaticFabSemanticBankDetachWorkerTicket,
	workerPlan: StaticFabSemanticBankDetachPlan,
	document: RailDocument,
	scope: StaticFabSemanticBankDetachScope,
	intent: StaticFabSemanticBankDetachIntent,
	expectedProspectiveChecksum: string,
): StaticFabSemanticBankDetachPlan {
	const source = permits.get(permit);
	permits.delete(permit);
	if (!source || !matchesSource(source, document, scope))
		throw new Error("Bank 분리 permit이 만료되었거나 이미 사용되었습니다");
	const intentFingerprint = staticFabSemanticBankDetachIntentFingerprint(intent);
	if (
		!ticket ||
		ticket.ticketId !== permit.ticketId ||
		ticket.validationLevel !== "exact" ||
		intentFingerprint !== source.intentFingerprint ||
		ticket.intentFingerprint !== intentFingerprint ||
		!sameIdentity(source.identity, ticket.source)
	)
		throw new Error("Bank 분리 Worker 인증이 현재 요청·원본과 다릅니다");
	const fresh = planStaticFabSemanticBankDetach(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		document.relationships,
		intent,
	);
	if (!fresh.valid) throw new Error(fresh.reason);
	const planFingerprint = staticFabSemanticBankDetachPlanFingerprint(fresh.plan);
	if (
		ticket.planFingerprint !== planFingerprint ||
		staticFabSemanticBankDetachPlanFingerprint(workerPlan) !== planFingerprint
	)
		throw new Error("Bank 분리 Worker 계획·영향 범위가 현재 원본 검토와 다릅니다");
	const prospective = ticket.prospective;
	if (
		!prospective?.checksum ||
		typeof expectedProspectiveChecksum !== "string" ||
		prospective.checksum !== expectedProspectiveChecksum ||
		!sameIdentity(prospective, {
			...source.identity,
			checksum: prospective.checksum,
			revision: source.identity.revision + fresh.plan.transition.changes.length,
			patchSequence: source.identity.patchSequence + 1,
		})
	)
		throw new Error("Bank 분리 Worker 결과가 revision·순서·ID cursor 보존 계약과 다릅니다");
	plans.set(fresh.plan, Object.freeze({ ...source, planFingerprint }));
	adoptedByPermit.set(permit, fresh.plan);
	return fresh.plan;
}

/** Document commit consumes the exact adopted object once; it cannot be rebound to another scope. */
export function consumeStaticFabSemanticBankDetachPlan(
	plan: StaticFabSemanticBankDetachPlan,
	document: RailDocument,
	scope: StaticFabSemanticBankDetachScope,
): string | null {
	const source = plans.get(plan);
	plans.delete(plan);
	if (!source || !matchesSource(source, document, scope))
		return "Bank 분리 인증이 없거나 프로젝트·문서 세대가 변경되었습니다";
	try {
		return staticFabSemanticBankDetachPlanFingerprint(plan) === source.planFingerprint
			? null
			: "Bank 분리 인증 후 계획이 변경되었습니다";
	} catch (error) {
		return error instanceof Error ? error.message : "Bank 분리 계획이 유효하지 않습니다";
	}
}

function matchesSource(
	source: BoundSource,
	document: RailDocument,
	scope: StaticFabSemanticBankDetachScope,
): boolean {
	return (
		source.document === document &&
		source.scope.projectId === scope.projectId &&
		source.scope.projectGeneration === scope.projectGeneration &&
		source.map === document.map &&
		source.mutationGeneration === document.map.getMutationGeneration() &&
		source.portEquipment === document.portEquipment &&
		source.organizations === document.organizations &&
		source.relationships === document.relationships &&
		sameIdentity(
			source.identity,
			staticFabSemanticBankDetachSourceIdentity(document, source.identity.checksum),
		)
	);
}

export function staticFabSemanticBankDetachSourceIdentitiesEqual(
	a: StaticFabSemanticBankDetachSourceIdentity,
	b: StaticFabSemanticBankDetachSourceIdentity,
): boolean {
	return sameIdentity(a, b);
}

function sameIdentity(
	a: StaticFabSemanticBankDetachSourceIdentity,
	b: StaticFabSemanticBankDetachSourceIdentity,
): boolean {
	return (
		!!b &&
		a.revision === b.revision &&
		a.patchSequence === b.patchSequence &&
		a.checksum === b.checksum &&
		a.nextAdvancedSwitchId === b.nextAdvancedSwitchId &&
		a.nextPortId === b.nextPortId &&
		a.nextEquipmentGroupId === b.nextEquipmentGroupId &&
		a.nextOrganizationId === b.nextOrganizationId &&
		a.nextRelationshipId === b.nextRelationshipId
	);
}

/** Bound the untrusted DTO before hashing its arrays. Fresh deterministic replanning verifies values. */
export function staticFabSemanticBankDetachPlanShapeError(value: unknown): string | null {
	if (
		!recordKeys(value, [
			"kind",
			"baseRevision",
			"basePatchSequence",
			"intent",
			"review",
			"transition",
		])
	)
		return "Bank 분리 계획 형식이 유효하지 않습니다";
	const plan = value as unknown as StaticFabSemanticBankDetachPlan;
	if (
		plan.kind !== STATIC_FAB_SEMANTIC_BANK_DETACH_KIND ||
		!nonnegative(plan.baseRevision) ||
		!nonnegative(plan.basePatchSequence) ||
		staticFabSemanticBankDetachIntentError(plan.intent)
	)
		return "Bank 분리 계획 identity가 유효하지 않습니다";
	if (
		!recordKeys(plan.review, [
			"version",
			"bankOrganizationId",
			"bankName",
			"fabOrganizationId",
			"fabName",
			"preservedOrganizationCount",
			"preservedBayCount",
			"preservedLoopCount",
			"preservedPortCount",
			"preservedEquipmentGroupCount",
			"preservedRailModuleCount",
			"preservedAdvancedSwitchCount",
			"preservedOrganizationIdSample",
			"preservedBayIdSample",
			"preservedLoopIdSample",
			"preservedPortIdSample",
			"preservedEquipmentGroupIdSample",
			"preservedRailModuleKeySample",
			"preservedAdvancedSwitchIdSample",
			"removedRelationshipIds",
			"removedDirectedEdgeCount",
			"removedRailModuleCount",
			"removedAdvancedSwitchCount",
			"removedCorridorCount",
			"removedRailModuleKeySample",
			"removedCorridorIdSample",
			"retainedBankCount",
			"structuralCutFingerprint",
		])
	)
		return "Bank 분리 검토 형식이 유효하지 않습니다";
	const review = plan.review;
	if (
		review.version !== 1 ||
		review.bankOrganizationId !== plan.intent.targetOrganizationId ||
		review.fabOrganizationId !== plan.intent.expectedParentOrganizationId ||
		![review.bankName, review.fabName, review.structuralCutFingerprint].every(
			(text) => typeof text === "string" && text.length > 0 && text.length <= 4_096,
		) ||
		![
			review.preservedOrganizationCount,
			review.preservedBayCount,
			review.preservedLoopCount,
			review.preservedPortCount,
			review.preservedEquipmentGroupCount,
			review.preservedRailModuleCount,
			review.preservedAdvancedSwitchCount,
			review.removedDirectedEdgeCount,
			review.removedRailModuleCount,
			review.removedAdvancedSwitchCount,
			review.removedCorridorCount,
			review.retainedBankCount,
		].every(nonnegative) ||
		!Array.isArray(review.removedRelationshipIds) ||
		review.removedRelationshipIds.length !== 1 ||
		!positive(review.removedRelationshipIds[0])
	)
		return "Bank 분리 검토 값이 유효하지 않습니다";
	for (const [sample, count] of [
		[review.preservedOrganizationIdSample, review.preservedOrganizationCount],
		[review.preservedBayIdSample, review.preservedBayCount],
		[review.preservedLoopIdSample, review.preservedLoopCount],
		[review.preservedPortIdSample, review.preservedPortCount],
		[review.preservedEquipmentGroupIdSample, review.preservedEquipmentGroupCount],
		[review.preservedAdvancedSwitchIdSample, review.preservedAdvancedSwitchCount],
	] as const) {
		if (
			!Array.isArray(sample) ||
			sample.length !== Math.min(count, STATIC_FAB_SEMANTIC_BANK_DETACH_ID_SAMPLE_LIMIT) ||
			!sample.every(positive) ||
			new Set(sample).size !== sample.length
		)
			return "Bank 분리 ID 표본이 유효하지 않습니다";
	}
	for (const [sample, count] of [
		[review.preservedRailModuleKeySample, review.preservedRailModuleCount],
		[review.removedRailModuleKeySample, review.removedRailModuleCount],
		[review.removedCorridorIdSample, review.removedCorridorCount],
	] as const) {
		if (
			!Array.isArray(sample) ||
			sample.length !== Math.min(count, STATIC_FAB_SEMANTIC_BANK_DETACH_ID_SAMPLE_LIMIT) ||
			!sample.every((key) => typeof key === "string" && key.length > 0 && key.length <= 4_096) ||
			new Set(sample).size !== sample.length
		)
			return "Bank 분리 rail/corridor 표본이 유효하지 않습니다";
	}
	if (review.removedAdvancedSwitchCount !== 0 || review.removedCorridorCount !== 2)
		return "Bank 분리의 제거 대상이 지원 범위를 벗어납니다";
	if (
		!recordKeys(plan.transition, [
			"changes",
			"switchChanges",
			"portChanges",
			"equipmentGroupChanges",
			"organizationChanges",
			"organizationNextIdBefore",
			"organizationNextIdAfter",
			"organizationImpactAuthorizations",
			"operationalConfigurationPatch",
			"relationshipChanges",
			"relationshipNextIdBefore",
			"relationshipNextIdAfter",
		])
	)
		return "Bank 분리 patch 형식이 유효하지 않습니다";
	const patch = plan.transition;
	if (
		!Array.isArray(patch.changes) ||
		patch.changes.length === 0 ||
		patch.changes.length > STATIC_FAB_SEMANTIC_BANK_DETACH_MAX_CUT_EDGES * 2 ||
		![patch.switchChanges, patch.portChanges, patch.equipmentGroupChanges].every(
			(rows) => Array.isArray(rows) && rows.length === 0,
		) ||
		!Array.isArray(patch.organizationChanges) ||
		patch.organizationChanges.length !== 2 ||
		!Array.isArray(patch.relationshipChanges) ||
		patch.relationshipChanges.length !== 1 ||
		!Array.isArray(patch.organizationImpactAuthorizations) ||
		patch.organizationImpactAuthorizations.length > 1_024 ||
		patch.operationalConfigurationPatch !== null ||
		patch.organizationNextIdBefore !== patch.organizationNextIdAfter ||
		patch.relationshipNextIdBefore !== patch.relationshipNextIdAfter
	)
		return "Bank 분리 patch 범위가 유효하지 않습니다";
	for (const change of patch.organizationChanges)
		for (const row of [change?.before, change?.after]) {
			if (
				!row?.membership ||
				!Array.isArray(row.membership.railEdges) ||
				row.membership.railEdges.length > 65_536 ||
				!Array.isArray(row.membership.advancedSwitchIds) ||
				row.membership.advancedSwitchIds.length > 4_096 ||
				!Array.isArray(row.membership.equipmentGroupIds) ||
				row.membership.equipmentGroupIds.length > 4_096
			)
				return "Bank 분리 조직 전송 한도를 초과했습니다";
		}
	const relationship = patch.relationshipChanges[0];
	if (
		!relationship?.before ||
		relationship.after !== null ||
		!Array.isArray(relationship.before.connectionGroups) ||
		relationship.before.connectionGroups.length !== 1 ||
		relationship.before.connectionGroups[0]?.legs.length !== 2
	)
		return "Bank 분리 관계 전송 형식이 유효하지 않습니다";
	for (const leg of relationship.before.connectionGroups[0].legs) {
		if (
			!Array.isArray(leg.exclusiveCutEdges) ||
			leg.exclusiveCutEdges.length > STATIC_FAB_SEMANTIC_BANK_DETACH_MAX_CUT_EDGES ||
			!Array.isArray(leg.endpointSupports) ||
			leg.endpointSupports.length > 4 ||
			!Array.isArray(leg.seamContacts) ||
			leg.seamContacts.length > 4 ||
			leg.seamContacts.some(
				(seam: { readonly incidences: readonly unknown[] }) =>
					!Array.isArray(seam.incidences) || seam.incidences.length > 4,
			)
		)
			return "Bank 분리 관계 전송 한도를 초과했습니다";
	}
	return null;
}

function recordKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
function nonnegative(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
function positive(value: unknown): value is number {
	return nonnegative(value) && value > 0;
}
