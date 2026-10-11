import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { RailDocument } from "./RailDocument";
import { type RailPatchTransition, railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	planStaticFabAisleIntegration,
	STATIC_FAB_AISLE_INTEGRATION_KIND,
	type StaticFabAisleIntegrationIntent,
	type StaticFabAisleIntegrationPlan,
	staticFabAisleIntegrationIntentError,
} from "./StaticFabAisleIntegration";

export interface StaticFabAisleIntegrationScope {
	readonly projectId: string;
	readonly projectGeneration: number;
}
export interface StaticFabAisleIntegrationIdentity {
	readonly revision: number;
	readonly patchSequence: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
}
export interface StaticFabAisleIntegrationTicket {
	readonly ticketId: number;
	readonly validationLevel: "exact";
	readonly source: StaticFabAisleIntegrationIdentity;
	readonly prospective: StaticFabAisleIntegrationIdentity;
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
}
export interface StaticFabAisleIntegrationPermit {
	readonly ticketId: number;
}
interface Source {
	readonly document: RailDocument;
	readonly scope: StaticFabAisleIntegrationScope;
	readonly map: RailDocument["map"];
	readonly mutationGeneration: number;
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly identity: StaticFabAisleIntegrationIdentity;
	readonly intentFingerprint: string;
}
const permits = new WeakMap<object, Source>();
const plans = new WeakMap<object, Source & { readonly fingerprint: string }>();
const adopted = new WeakMap<object, StaticFabAisleIntegrationPlan>();
let nextTicketId = 1;

export function staticFabAisleIntegrationIdentity(
	document: RailDocument,
	checksum: string,
): StaticFabAisleIntegrationIdentity {
	return {
		revision: document.map.getRevision(),
		patchSequence: document.getPatchSequence(),
		checksum,
		nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
		nextPortId: document.portEquipment.nextPortId,
		nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: document.organizations.nextOrganizationId,
		nextRelationshipId: document.relationships.nextRelationshipId,
	};
}
export function staticFabAisleIntegrationIntentFingerprint(
	intent: StaticFabAisleIntegrationIntent,
): string {
	const error = staticFabAisleIntegrationIntentError(intent);
	if (error) throw new Error(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([STATIC_FAB_AISLE_INTEGRATION_KIND]);
	checksum.addNumbers([
		intent.version,
		intent.aisleOrganizationId,
		intent.bayOrganizationId,
		intent.entryGateway.x,
		intent.entryGateway.y,
		intent.exitGateway.x,
		intent.exitGateway.y,
	]);
	return checksum.digest();
}
export function staticFabAisleIntegrationTransition(
	plan: StaticFabAisleIntegrationPlan,
): RailPatchTransition {
	return {
		changes: plan.draft.mutations,
		switchChanges: [],
		portChanges: [],
		equipmentGroupChanges: [],
		organizationChanges: plan.organizationMutations,
		organizationNextIdBefore: plan.nextOrganizationId,
		organizationNextIdAfter: plan.nextOrganizationId,
		organizationImpactAuthorizations: plan.organizationImpactAuthorizations,
		operationalConfigurationPatch: null,
	};
}
export function staticFabAisleIntegrationPlanFingerprint(
	plan: StaticFabAisleIntegrationPlan,
): string {
	if (
		plan.kind !== STATIC_FAB_AISLE_INTEGRATION_KIND ||
		!plan.valid ||
		!plan.draft.valid ||
		plan.draft.kind !== "build" ||
		(plan.draft.switchMutations?.length ?? 0) > 0 ||
		plan.draft.mutations.length > 2_048
	)
		throw new Error("구역 편입 계획 범위가 유효하지 않습니다");
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		staticFabAisleIntegrationIntentFingerprint(plan.intent),
		railPatchTransitionFingerprint(staticFabAisleIntegrationTransition(plan)),
		JSON.stringify(plan),
	]);
	return checksum.digest();
}
export function issueStaticFabAisleIntegrationPermit(
	document: RailDocument,
	scope: StaticFabAisleIntegrationScope,
	intent: StaticFabAisleIntegrationIntent,
	checksum: string,
): StaticFabAisleIntegrationPermit {
	if (
		!scope.projectId ||
		!Number.isSafeInteger(scope.projectGeneration) ||
		scope.projectGeneration < 0 ||
		!checksum ||
		!Number.isSafeInteger(nextTicketId)
	)
		throw new Error("프로젝트·문서 세대가 유효하지 않습니다");
	const permit = Object.freeze({ ticketId: nextTicketId++ });
	permits.set(permit, {
		document,
		scope: { ...scope },
		map: document.map,
		mutationGeneration: document.map.getMutationGeneration(),
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		relationships: document.relationships,
		identity: staticFabAisleIntegrationIdentity(document, checksum),
		intentFingerprint: staticFabAisleIntegrationIntentFingerprint(intent),
	});
	return permit;
}
export function revokeStaticFabAisleIntegrationPermit(
	permit: StaticFabAisleIntegrationPermit,
): void {
	permits.delete(permit);
	const plan = adopted.get(permit);
	if (plan) plans.delete(plan);
	adopted.delete(permit);
}
export function adoptStaticFabAisleIntegrationPlan(
	permit: StaticFabAisleIntegrationPermit,
	ticket: StaticFabAisleIntegrationTicket,
	workerPlan: StaticFabAisleIntegrationPlan,
	document: RailDocument,
	scope: StaticFabAisleIntegrationScope,
	intent: StaticFabAisleIntegrationIntent,
	expectedChecksum: string,
): StaticFabAisleIntegrationPlan {
	const source = permits.get(permit);
	permits.delete(permit);
	if (!source || !current(source, document, scope))
		throw new Error("구역 편입 검토가 만료되었습니다");
	if (
		!ticket ||
		ticket.ticketId !== permit.ticketId ||
		ticket.validationLevel !== "exact" ||
		ticket.intentFingerprint !== source.intentFingerprint ||
		ticket.intentFingerprint !== staticFabAisleIntegrationIntentFingerprint(intent) ||
		!sameIdentity(ticket.source, source.identity)
	)
		throw new Error("구역 편입 인증이 원본·요청과 다릅니다");
	const fresh = planStaticFabAisleIntegration(document, document.getPatchSequence(), intent).plan;
	const fingerprint = staticFabAisleIntegrationPlanFingerprint(fresh);
	if (
		ticket.planFingerprint !== fingerprint ||
		staticFabAisleIntegrationPlanFingerprint(workerPlan) !== fingerprint
	)
		throw new Error("구역 편입 변경 범위가 검토 결과와 다릅니다");
	if (
		!expectedChecksum ||
		!sameIdentity(ticket.prospective, {
			...source.identity,
			checksum: expectedChecksum,
			revision: source.identity.revision + fresh.draft.mutations.length,
			patchSequence: source.identity.patchSequence + 1,
		})
	)
		throw new Error("구역 편입 결과·ID 보존 인증이 다릅니다");
	plans.set(fresh, { ...source, fingerprint });
	adopted.set(permit, fresh);
	return fresh;
}
export function consumeStaticFabAisleIntegrationPlan(
	plan: StaticFabAisleIntegrationPlan,
	document: RailDocument,
	scope: StaticFabAisleIntegrationScope,
): string | null {
	const source = plans.get(plan);
	plans.delete(plan);
	if (!source || !current(source, document, scope))
		return "구역 편입 인증이 없거나 문서가 변경되었습니다";
	try {
		return staticFabAisleIntegrationPlanFingerprint(plan) === source.fingerprint
			? null
			: "인증 후 편입 계획이 변경되었습니다";
	} catch {
		return "구역 편입 계획이 유효하지 않습니다";
	}
}
function current(
	source: Source,
	document: RailDocument,
	scope: StaticFabAisleIntegrationScope,
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
			staticFabAisleIntegrationIdentity(document, source.identity.checksum),
		)
	);
}
function sameIdentity(
	a: StaticFabAisleIntegrationIdentity,
	b: StaticFabAisleIntegrationIdentity,
): boolean {
	return (
		!!a &&
		Object.keys(a).length === Object.keys(b).length &&
		(Object.keys(b) as (keyof StaticFabAisleIntegrationIdentity)[]).every(
			(key) => a[key] === b[key],
		)
	);
}
