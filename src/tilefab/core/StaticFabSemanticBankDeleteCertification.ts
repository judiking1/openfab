import { checksumOperationalConfigurationState } from "./OperationalConfiguration";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { RailDocument } from "./RailDocument";
import { railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	planStaticFabSemanticBankDelete,
	STATIC_FAB_SEMANTIC_BANK_DELETE_ID_SAMPLE_LIMIT,
	STATIC_FAB_SEMANTIC_BANK_DELETE_IMPACT_KEYS,
	STATIC_FAB_SEMANTIC_BANK_DELETE_KIND,
	STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS,
	type StaticFabSemanticBankDeleteIntent,
	type StaticFabSemanticBankDeletePlan,
	staticFabSemanticBankDeleteIntentError,
} from "./StaticFabSemanticBankDelete";

export interface StaticFabSemanticBankDeleteScope {
	readonly projectId: string;
	readonly projectGeneration: number;
}

export interface StaticFabSemanticBankDeleteSourceIdentity {
	readonly revision: number;
	readonly patchSequence: number;
	readonly checksum: string;
	readonly operationalConfigurationFingerprint: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
}

export interface StaticFabSemanticBankDeleteWorkerTicket {
	readonly ticketId: number;
	readonly validationLevel: "exact";
	readonly source: StaticFabSemanticBankDeleteSourceIdentity;
	readonly prospective: StaticFabSemanticBankDeleteSourceIdentity;
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
}

export interface StaticFabSemanticBankDeletePermit {
	readonly ticketId: number;
}

interface BoundSource {
	readonly document: RailDocument;
	readonly scope: StaticFabSemanticBankDeleteScope;
	readonly map: RailDocument["map"];
	readonly mutationGeneration: number;
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly operationalConfiguration: RailDocument["operationalConfiguration"];
	readonly identity: StaticFabSemanticBankDeleteSourceIdentity;
	readonly intentFingerprint: string;
}

const permits = new WeakMap<object, BoundSource>();
const plans = new WeakMap<object, BoundSource & { readonly planFingerprint: string }>();
const adoptedByPermit = new WeakMap<object, StaticFabSemanticBankDeletePlan>();
let nextTicketId = 1;

export function staticFabSemanticBankDeleteSourceIdentity(
	document: RailDocument,
	checksum: string,
): StaticFabSemanticBankDeleteSourceIdentity {
	return Object.freeze({
		revision: document.map.getRevision(),
		patchSequence: document.getPatchSequence(),
		checksum,
		operationalConfigurationFingerprint: checksumOperationalConfigurationState(
			document.operationalConfiguration,
		),
		nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
		nextPortId: document.portEquipment.nextPortId,
		nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: document.organizations.nextOrganizationId,
		nextRelationshipId: document.relationships.nextRelationshipId,
	});
}

export function staticFabSemanticBankDeleteIntentFingerprint(
	intent: StaticFabSemanticBankDeleteIntent,
): string {
	const error = staticFabSemanticBankDeleteIntentError(intent);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([STATIC_FAB_SEMANTIC_BANK_DELETE_KIND, intent.action, intent.targetRole]);
	checksum.addNumbers([
		intent.version,
		intent.targetOrganizationId,
		intent.expectedParentOrganizationId ?? 0,
	]);
	return checksum.digest();
}

export function staticFabSemanticBankDeletePlanFingerprint(
	plan: StaticFabSemanticBankDeletePlan,
): string {
	const error = staticFabSemanticBankDeletePlanShapeError(plan);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.kind,
		staticFabSemanticBankDeleteIntentFingerprint(plan.intent),
		JSON.stringify(plan.review),
		railPatchTransitionFingerprint(plan.transition),
	]);
	checksum.addNumbers([plan.baseRevision, plan.basePatchSequence]);
	return checksum.digest();
}

export function issueStaticFabSemanticBankDeletePermit(
	document: RailDocument,
	scope: StaticFabSemanticBankDeleteScope,
	intent: StaticFabSemanticBankDeleteIntent,
	sourceChecksum: string,
): StaticFabSemanticBankDeletePermit {
	if (
		typeof scope.projectId !== "string" ||
		!scope.projectId ||
		!Number.isSafeInteger(scope.projectGeneration) ||
		scope.projectGeneration < 0 ||
		!sourceChecksum ||
		!Number.isSafeInteger(nextTicketId)
	)
		throw new Error("Bank 삭제의 프로젝트·문서 세대가 유효하지 않습니다");
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
			operationalConfiguration: document.operationalConfiguration,
			identity: staticFabSemanticBankDeleteSourceIdentity(document, sourceChecksum),
			intentFingerprint: staticFabSemanticBankDeleteIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabSemanticBankDeletePermit(
	permit: StaticFabSemanticBankDeletePermit,
): void {
	permits.delete(permit);
	const adopted = adoptedByPermit.get(permit);
	if (adopted) plans.delete(adopted);
	adoptedByPermit.delete(permit);
}

/** Every attempt consumes the permit, including malformed, stale and mismatched responses. */
export function adoptStaticFabSemanticBankDeleteWorkerPlan(
	permit: StaticFabSemanticBankDeletePermit,
	ticket: StaticFabSemanticBankDeleteWorkerTicket,
	workerPlan: StaticFabSemanticBankDeletePlan,
	document: RailDocument,
	scope: StaticFabSemanticBankDeleteScope,
	intent: StaticFabSemanticBankDeleteIntent,
	expectedProspectiveChecksum: string,
): StaticFabSemanticBankDeletePlan {
	const source = permits.get(permit);
	permits.delete(permit);
	if (!source || !matchesSource(source, document, scope))
		throw new Error("Bank 삭제 permit이 만료되었거나 이미 사용되었습니다");
	const intentFingerprint = staticFabSemanticBankDeleteIntentFingerprint(intent);
	if (
		!ticket ||
		ticket.ticketId !== permit.ticketId ||
		ticket.validationLevel !== "exact" ||
		intentFingerprint !== source.intentFingerprint ||
		ticket.intentFingerprint !== intentFingerprint ||
		!sameIdentity(source.identity, ticket.source)
	)
		throw new Error("Bank 삭제 Worker 인증이 현재 요청·원본과 다릅니다");
	const fresh = planStaticFabSemanticBankDelete(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		document.relationships,
		document.operationalConfiguration,
		intent,
	);
	if (!fresh.valid) throw new Error(fresh.reason);
	const planFingerprint = staticFabSemanticBankDeletePlanFingerprint(fresh.plan);
	if (
		ticket.planFingerprint !== planFingerprint ||
		staticFabSemanticBankDeletePlanFingerprint(workerPlan) !== planFingerprint
	)
		throw new Error("Bank 삭제 Worker 계획·영향 범위가 현재 원본 검토와 다릅니다");
	const prospective = ticket.prospective;
	if (
		!prospective?.checksum ||
		typeof expectedProspectiveChecksum !== "string" ||
		prospective.checksum !== expectedProspectiveChecksum ||
		!sameIdentity(prospective, {
			...source.identity,
			checksum: prospective.checksum,
			revision:
				source.identity.revision +
				fresh.plan.transition.changes.length +
				fresh.plan.transition.switchChanges.length,
			patchSequence: source.identity.patchSequence + 1,
		})
	)
		throw new Error("Bank 삭제 Worker 결과가 revision·순서·ID cursor 보존 계약과 다릅니다");
	plans.set(fresh.plan, Object.freeze({ ...source, planFingerprint }));
	adoptedByPermit.set(permit, fresh.plan);
	return fresh.plan;
}

/** Document commit consumes the exact adopted object once; it cannot be rebound to another scope. */
export function consumeStaticFabSemanticBankDeletePlan(
	plan: StaticFabSemanticBankDeletePlan,
	document: RailDocument,
	scope: StaticFabSemanticBankDeleteScope,
): string | null {
	const source = plans.get(plan);
	plans.delete(plan);
	if (!source || !matchesSource(source, document, scope))
		return "Bank 삭제 인증이 없거나 프로젝트·문서 세대가 변경되었습니다";
	try {
		return staticFabSemanticBankDeletePlanFingerprint(plan) === source.planFingerprint
			? null
			: "Bank 삭제 인증 후 계획이 변경되었습니다";
	} catch (error) {
		return error instanceof Error ? error.message : "Bank 삭제 계획이 유효하지 않습니다";
	}
}

function matchesSource(
	source: BoundSource,
	document: RailDocument,
	scope: StaticFabSemanticBankDeleteScope,
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
		source.operationalConfiguration === document.operationalConfiguration &&
		sameIdentity(
			source.identity,
			staticFabSemanticBankDeleteSourceIdentity(document, source.identity.checksum),
		)
	);
}

export function staticFabSemanticBankDeleteSourceIdentitiesEqual(
	a: StaticFabSemanticBankDeleteSourceIdentity,
	b: StaticFabSemanticBankDeleteSourceIdentity,
): boolean {
	return sameIdentity(a, b);
}

function sameIdentity(
	a: StaticFabSemanticBankDeleteSourceIdentity,
	b: StaticFabSemanticBankDeleteSourceIdentity,
): boolean {
	return (
		!!b &&
		a.revision === b.revision &&
		a.patchSequence === b.patchSequence &&
		a.checksum === b.checksum &&
		a.operationalConfigurationFingerprint === b.operationalConfigurationFingerprint &&
		a.nextAdvancedSwitchId === b.nextAdvancedSwitchId &&
		a.nextPortId === b.nextPortId &&
		a.nextEquipmentGroupId === b.nextEquipmentGroupId &&
		a.nextOrganizationId === b.nextOrganizationId &&
		a.nextRelationshipId === b.nextRelationshipId
	);
}

export function staticFabSemanticBankDeletePlanShapeError(value: unknown): string | null {
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
		return "Bank 삭제 계획 형식이 유효하지 않습니다";
	const plan = value as unknown as StaticFabSemanticBankDeletePlan;
	if (
		plan.kind !== STATIC_FAB_SEMANTIC_BANK_DELETE_KIND ||
		!nonnegative(plan.baseRevision) ||
		!nonnegative(plan.basePatchSequence) ||
		staticFabSemanticBankDeleteIntentError(plan.intent)
	)
		return "Bank 삭제 계획 identity가 유효하지 않습니다";
	const review = plan.review;
	if (
		!recordKeys(review, [
			"version",
			"bankOrganizationId",
			"bankName",
			"parentFabOrganizationId",
			"parentFabName",
			"includesDetach",
			"removed",
			"preserved",
		]) ||
		review.version !== 1 ||
		review.bankOrganizationId !== plan.intent.targetOrganizationId ||
		review.parentFabOrganizationId !== plan.intent.expectedParentOrganizationId ||
		review.includesDetach !== (review.parentFabOrganizationId !== null) ||
		!shortText(review.bankName) ||
		(review.parentFabName !== null && !shortText(review.parentFabName))
	)
		return "Bank 삭제 검토 identity가 유효하지 않습니다";
	for (const impact of [review.removed, review.preserved]) {
		if (!recordKeys(impact, STATIC_FAB_SEMANTIC_BANK_DELETE_IMPACT_KEYS))
			return "Bank 삭제 영향 형식이 유효하지 않습니다";
		for (const field of STATIC_FAB_SEMANTIC_BANK_DELETE_IMPACT_KEYS) {
			const row = impact[field];
			if (
				!recordKeys(row, ["count", "idSample", "omittedCount"]) ||
				!nonnegative(row.count) ||
				!nonnegative(row.omittedCount) ||
				!Array.isArray(row.idSample) ||
				row.idSample.length > STATIC_FAB_SEMANTIC_BANK_DELETE_ID_SAMPLE_LIMIT ||
				row.idSample.length + row.omittedCount !== row.count ||
				row.idSample.some((id) => !positive(id) && !shortText(id)) ||
				new Set(row.idSample).size !== row.idSample.length
			)
				return "Bank 삭제 영향 수량 또는 표본이 유효하지 않습니다";
		}
	}
	const patch = plan.transition;
	if (
		!recordKeys(patch, [
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
		return "Bank 삭제 patch 형식이 유효하지 않습니다";
	for (const rows of [
		patch.changes,
		patch.switchChanges,
		patch.portChanges,
		patch.equipmentGroupChanges,
		patch.organizationChanges,
		patch.relationshipChanges,
		patch.organizationImpactAuthorizations,
	])
		if (!Array.isArray(rows) || rows.length > STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS)
			return "Bank 삭제 patch 전송 한도를 초과했습니다";
	if (
		!patch.changes.length ||
		patch.operationalConfigurationPatch !== null ||
		patch.organizationNextIdBefore !== patch.organizationNextIdAfter ||
		patch.relationshipNextIdBefore !== patch.relationshipNextIdAfter ||
		!positive(patch.organizationNextIdAfter) ||
		!positive(patch.relationshipNextIdAfter)
	)
		return "Bank 삭제 patch 범위 또는 cursor가 유효하지 않습니다";
	for (const change of patch.organizationChanges)
		for (const row of [change.before, change.after]) {
			if (row === null) continue;
			if (
				!row?.membership ||
				!Array.isArray(row.membership.railEdges) ||
				row.membership.railEdges.length > STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS ||
				!Array.isArray(row.membership.advancedSwitchIds) ||
				row.membership.advancedSwitchIds.length > 16_384 ||
				!Array.isArray(row.membership.equipmentGroupIds) ||
				row.membership.equipmentGroupIds.length > STATIC_FAB_SEMANTIC_BANK_DELETE_MAX_ITEMS
			)
				return "Bank 삭제 조직 전송 한도를 초과했습니다";
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
function shortText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 4096;
}
