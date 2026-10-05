import { checksumOperationalConfigurationState } from "./OperationalConfiguration";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { RailDocument } from "./RailDocument";
import { railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	planStaticFabSemanticFabDelete,
	STATIC_FAB_SEMANTIC_FAB_DELETE_ID_SAMPLE_LIMIT,
	STATIC_FAB_SEMANTIC_FAB_DELETE_IMPACT_KEYS,
	STATIC_FAB_SEMANTIC_FAB_DELETE_KIND,
	STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS,
	type StaticFabSemanticFabDeleteIntent,
	type StaticFabSemanticFabDeletePlan,
	staticFabSemanticFabDeleteIntentError,
} from "./StaticFabSemanticFabDelete";

export interface StaticFabSemanticFabDeleteScope {
	readonly projectId: string;
	readonly projectGeneration: number;
}

export interface StaticFabSemanticFabDeleteSourceIdentity {
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

export interface StaticFabSemanticFabDeleteWorkerTicket {
	readonly ticketId: number;
	readonly validationLevel: "exact";
	readonly source: StaticFabSemanticFabDeleteSourceIdentity;
	readonly prospective: StaticFabSemanticFabDeleteSourceIdentity;
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
}

export interface StaticFabSemanticFabDeletePermit {
	readonly ticketId: number;
}

interface BoundSource {
	readonly document: RailDocument;
	readonly scope: StaticFabSemanticFabDeleteScope;
	readonly map: RailDocument["map"];
	readonly mutationGeneration: number;
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly operationalConfiguration: RailDocument["operationalConfiguration"];
	readonly identity: StaticFabSemanticFabDeleteSourceIdentity;
	readonly intentFingerprint: string;
}

const permits = new WeakMap<object, BoundSource>();
const plans = new WeakMap<object, BoundSource & { readonly planFingerprint: string }>();
const adoptedByPermit = new WeakMap<object, StaticFabSemanticFabDeletePlan>();
let nextTicketId = 1;

export function staticFabSemanticFabDeleteSourceIdentity(
	document: RailDocument,
	checksum: string,
): StaticFabSemanticFabDeleteSourceIdentity {
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

export function staticFabSemanticFabDeleteIntentFingerprint(
	intent: StaticFabSemanticFabDeleteIntent,
): string {
	const error = staticFabSemanticFabDeleteIntentError(intent);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([STATIC_FAB_SEMANTIC_FAB_DELETE_KIND, intent.action, intent.targetRole]);
	checksum.addNumbers([
		intent.version,
		intent.targetOrganizationId,
		intent.expectedParentOrganizationId ?? 0,
	]);
	return checksum.digest();
}

export function staticFabSemanticFabDeletePlanFingerprint(
	plan: StaticFabSemanticFabDeletePlan,
): string {
	const error = staticFabSemanticFabDeletePlanShapeError(plan);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		plan.kind,
		staticFabSemanticFabDeleteIntentFingerprint(plan.intent),
		JSON.stringify(plan.review),
		railPatchTransitionFingerprint(plan.transition),
	]);
	checksum.addNumbers([plan.baseRevision, plan.basePatchSequence]);
	return checksum.digest();
}

export function issueStaticFabSemanticFabDeletePermit(
	document: RailDocument,
	scope: StaticFabSemanticFabDeleteScope,
	intent: StaticFabSemanticFabDeleteIntent,
	sourceChecksum: string,
): StaticFabSemanticFabDeletePermit {
	if (
		typeof scope.projectId !== "string" ||
		!scope.projectId ||
		!Number.isSafeInteger(scope.projectGeneration) ||
		scope.projectGeneration < 0 ||
		!sourceChecksum ||
		!Number.isSafeInteger(nextTicketId)
	)
		throw new Error("Fab 삭제의 프로젝트·문서 세대가 유효하지 않습니다");
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
			identity: staticFabSemanticFabDeleteSourceIdentity(document, sourceChecksum),
			intentFingerprint: staticFabSemanticFabDeleteIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabSemanticFabDeletePermit(
	permit: StaticFabSemanticFabDeletePermit,
): void {
	permits.delete(permit);
	const adopted = adoptedByPermit.get(permit);
	if (adopted) plans.delete(adopted);
	adoptedByPermit.delete(permit);
}

/** Every attempt consumes the permit, including malformed, stale and mismatched responses. */
export function adoptStaticFabSemanticFabDeleteWorkerPlan(
	permit: StaticFabSemanticFabDeletePermit,
	ticket: StaticFabSemanticFabDeleteWorkerTicket,
	workerPlan: StaticFabSemanticFabDeletePlan,
	document: RailDocument,
	scope: StaticFabSemanticFabDeleteScope,
	intent: StaticFabSemanticFabDeleteIntent,
	expectedProspectiveChecksum: string,
): StaticFabSemanticFabDeletePlan {
	const source = permits.get(permit);
	permits.delete(permit);
	if (!source || !matchesSource(source, document, scope))
		throw new Error("Fab 삭제 permit이 만료되었거나 이미 사용되었습니다");
	const intentFingerprint = staticFabSemanticFabDeleteIntentFingerprint(intent);
	if (
		!ticket ||
		ticket.ticketId !== permit.ticketId ||
		ticket.validationLevel !== "exact" ||
		intentFingerprint !== source.intentFingerprint ||
		ticket.intentFingerprint !== intentFingerprint ||
		!sameIdentity(source.identity, ticket.source)
	)
		throw new Error("Fab 삭제 Worker 인증이 현재 요청·원본과 다릅니다");
	const fresh = planStaticFabSemanticFabDelete(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		document.relationships,
		document.operationalConfiguration,
		intent,
	);
	if (!fresh.valid) throw new Error(fresh.reason);
	const planFingerprint = staticFabSemanticFabDeletePlanFingerprint(fresh.plan);
	if (
		ticket.planFingerprint !== planFingerprint ||
		staticFabSemanticFabDeletePlanFingerprint(workerPlan) !== planFingerprint
	)
		throw new Error("Fab 삭제 Worker 계획·영향 범위가 현재 원본 검토와 다릅니다");
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
		throw new Error("Fab 삭제 Worker 결과가 revision·순서·ID cursor 보존 계약과 다릅니다");
	plans.set(fresh.plan, Object.freeze({ ...source, planFingerprint }));
	adoptedByPermit.set(permit, fresh.plan);
	return fresh.plan;
}

/** Document commit consumes the exact adopted object once; it cannot be rebound to another scope. */
export function consumeStaticFabSemanticFabDeletePlan(
	plan: StaticFabSemanticFabDeletePlan,
	document: RailDocument,
	scope: StaticFabSemanticFabDeleteScope,
): string | null {
	const source = plans.get(plan);
	plans.delete(plan);
	if (!source || !matchesSource(source, document, scope))
		return "Fab 삭제 인증이 없거나 프로젝트·문서 세대가 변경되었습니다";
	try {
		return staticFabSemanticFabDeletePlanFingerprint(plan) === source.planFingerprint
			? null
			: "Fab 삭제 인증 후 계획이 변경되었습니다";
	} catch (error) {
		return error instanceof Error ? error.message : "Fab 삭제 계획이 유효하지 않습니다";
	}
}

function matchesSource(
	source: BoundSource,
	document: RailDocument,
	scope: StaticFabSemanticFabDeleteScope,
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
			staticFabSemanticFabDeleteSourceIdentity(document, source.identity.checksum),
		)
	);
}

export function staticFabSemanticFabDeleteSourceIdentitiesEqual(
	a: StaticFabSemanticFabDeleteSourceIdentity,
	b: StaticFabSemanticFabDeleteSourceIdentity,
): boolean {
	return sameIdentity(a, b);
}

function sameIdentity(
	a: StaticFabSemanticFabDeleteSourceIdentity,
	b: StaticFabSemanticFabDeleteSourceIdentity,
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

export function staticFabSemanticFabDeletePlanShapeError(value: unknown): string | null {
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
		return "Fab 삭제 계획 형식이 유효하지 않습니다";
	const plan = value as unknown as StaticFabSemanticFabDeletePlan;
	if (
		plan.kind !== STATIC_FAB_SEMANTIC_FAB_DELETE_KIND ||
		!nonnegative(plan.baseRevision) ||
		!nonnegative(plan.basePatchSequence) ||
		staticFabSemanticFabDeleteIntentError(plan.intent)
	)
		return "Fab 삭제 계획 identity가 유효하지 않습니다";
	const review = plan.review;
	if (
		!recordKeys(review, ["version", "fabOrganizationId", "fabName", "removed", "preserved"]) ||
		review.version !== 1 ||
		review.fabOrganizationId !== plan.intent.targetOrganizationId ||
		!shortText(review.fabName)
	)
		return "Fab 삭제 검토 identity가 유효하지 않습니다";
	for (const impact of [review.removed, review.preserved]) {
		if (!recordKeys(impact, STATIC_FAB_SEMANTIC_FAB_DELETE_IMPACT_KEYS))
			return "Fab 삭제 영향 형식이 유효하지 않습니다";
		for (const field of STATIC_FAB_SEMANTIC_FAB_DELETE_IMPACT_KEYS) {
			const row = impact[field];
			if (
				!recordKeys(row, ["count", "idSample", "omittedCount"]) ||
				!nonnegative(row.count) ||
				!nonnegative(row.omittedCount) ||
				!Array.isArray(row.idSample) ||
				row.idSample.length > STATIC_FAB_SEMANTIC_FAB_DELETE_ID_SAMPLE_LIMIT ||
				row.idSample.length + row.omittedCount !== row.count ||
				row.idSample.some((id) => !positive(id) && !shortText(id)) ||
				new Set(row.idSample).size !== row.idSample.length
			)
				return "Fab 삭제 영향 수량 또는 표본이 유효하지 않습니다";
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
		return "Fab 삭제 patch 형식이 유효하지 않습니다";
	for (const rows of [
		patch.changes,
		patch.switchChanges,
		patch.portChanges,
		patch.equipmentGroupChanges,
		patch.organizationChanges,
		patch.relationshipChanges,
		patch.organizationImpactAuthorizations,
	])
		if (!Array.isArray(rows) || rows.length > STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS)
			return "Fab 삭제 patch 전송 한도를 초과했습니다";
	if (
		!patch.changes.length ||
		patch.operationalConfigurationPatch !== null ||
		patch.organizationNextIdBefore !== patch.organizationNextIdAfter ||
		patch.relationshipNextIdBefore !== patch.relationshipNextIdAfter ||
		!positive(patch.organizationNextIdAfter) ||
		!positive(patch.relationshipNextIdAfter)
	)
		return "Fab 삭제 patch 범위 또는 cursor가 유효하지 않습니다";
	if (
		patch.organizationImpactAuthorizations?.length !== 0 ||
		patch.changes.some((change) => change.after !== 0) ||
		[
			patch.switchChanges,
			patch.portChanges,
			patch.equipmentGroupChanges,
			patch.organizationChanges,
			patch.relationshipChanges ?? [],
		].some((changes) =>
			changes.some((change) => change.before === null || change.after !== null),
		) ||
		review.removed.fabs.count !== 1 ||
		patch.organizationChanges.length !== review.removed.organizations.count ||
		patch.portChanges.length !== review.removed.ports.count ||
		patch.equipmentGroupChanges.length !== review.removed.equipmentGroups.count ||
		patch.switchChanges.length !== review.removed.advancedSwitches.count ||
		patch.relationshipChanges?.length !== review.removed.relationships.count
	)
		return "root Fab 삭제는 명시적 독점 소유 항목의 제거만 허용합니다";
	for (const change of patch.organizationChanges)
		for (const row of [change.before, change.after]) {
			if (row === null) continue;
			if (
				!row?.membership ||
				!Array.isArray(row.membership.railEdges) ||
				row.membership.railEdges.length > STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS ||
				!Array.isArray(row.membership.advancedSwitchIds) ||
				row.membership.advancedSwitchIds.length > 16_384 ||
				!Array.isArray(row.membership.equipmentGroupIds) ||
				row.membership.equipmentGroupIds.length > STATIC_FAB_SEMANTIC_FAB_DELETE_MAX_ITEMS
			)
				return "Fab 삭제 조직 전송 한도를 초과했습니다";
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
