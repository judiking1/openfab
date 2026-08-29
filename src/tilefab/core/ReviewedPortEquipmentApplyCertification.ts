import type { PortEquipmentState } from "./EquipmentGroup";
import {
	issuePortEquipmentBatchPlan,
	issuePortEquipmentBatchPlanCooperatively,
} from "./PortEquipmentBatchPlanCertification";
import {
	isCertifiedImmutablePortEquipmentMutationPlanGraph,
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	type PortEquipmentMutationPlan,
	type PortEquipmentPlanKind,
} from "./PortEquipmentPlan";
import {
	railPatchTransitionFingerprint,
	railPatchTransitionFingerprintCooperatively,
} from "./RailPatchHistory";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";
import type { TileMap } from "./TileMap";

/** Opaque one-shot Apply authority; the underlying reviewed plan is never exposed to editor code. */
export interface ReviewedPortEquipmentApply {
	readonly kind: "reviewed-port-equipment-apply";
	readonly planKind: PortEquipmentPlanKind;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
}

interface ReviewedPortEquipmentApplySource {
	readonly plan: PortEquipmentMutationPlan;
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly revision: number;
	readonly patchSequence: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly planFingerprint: string;
}

const pendingApplies = new WeakMap<object, ReviewedPortEquipmentApplySource>();

/** Main-realm station-review materializers issue this only after complete prospective validation. */
export function issueReviewedPortEquipmentApply(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): ReviewedPortEquipmentApply {
	if (
		!plan.valid ||
		plan.portMutations.length === 0 ||
		plan.equipmentGroupMutations.length === 0 ||
		plan.baseRevision !== map.getRevision() ||
		plan.basePatchSequence !== patchSequence
	) {
		throw new Error("Reviewed port/equipment Apply cannot be issued for this authored generation.");
	}
	const handle = Object.freeze({
		kind: "reviewed-port-equipment-apply" as const,
		planKind: plan.kind,
		portCount: plan.portMutations.length,
		equipmentGroupCount: plan.equipmentGroupMutations.length,
	});
	pendingApplies.set(
		handle,
		Object.freeze({
			plan,
			map,
			portEquipment,
			organizations,
			revision: map.getRevision(),
			patchSequence,
			nextPortId: portEquipment.nextPortId,
			nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
			planFingerprint: reviewedApplyPlanFingerprint(plan),
		}),
	);
	return handle;
}

/** Same opaque issuance contract with a cooperatively computed immutable-plan fingerprint. */
export async function issueReviewedPortEquipmentApplyCooperatively(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
	checkpoint: () => Promise<void>,
): Promise<ReviewedPortEquipmentApply> {
	if (
		!plan.valid ||
		plan.portMutations.length === 0 ||
		plan.equipmentGroupMutations.length === 0 ||
		plan.baseRevision !== map.getRevision() ||
		plan.basePatchSequence !== patchSequence
	) {
		throw new Error("Reviewed port/equipment Apply cannot be issued for this authored generation.");
	}
	const planFingerprint = await reviewedApplyPlanFingerprintCooperatively(plan, checkpoint);
	const handle = Object.freeze({
		kind: "reviewed-port-equipment-apply" as const,
		planKind: plan.kind,
		portCount: plan.portMutations.length,
		equipmentGroupCount: plan.equipmentGroupMutations.length,
	});
	pendingApplies.set(
		handle,
		Object.freeze({
			plan,
			map,
			portEquipment,
			organizations,
			revision: map.getRevision(),
			patchSequence,
			nextPortId: portEquipment.nextPortId,
			nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
			planFingerprint,
		}),
	);
	return handle;
}

/** Terminally discard an issued Apply when its enclosing UI/session generation turns stale. */
export function revokeReviewedPortEquipmentApply(handle: ReviewedPortEquipmentApply): void {
	pendingApplies.delete(handle);
}

/** Terminally consume exact-document authority immediately before RailDocument's atomic commit. */
export function consumeReviewedPortEquipmentApply(
	handle: ReviewedPortEquipmentApply,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): PortEquipmentMutationPlan | null {
	const source = pendingApplies.get(handle);
	pendingApplies.delete(handle);
	if (
		!source ||
		source.map !== map ||
		source.portEquipment !== portEquipment ||
		source.organizations !== organizations ||
		source.revision !== map.getRevision() ||
		source.patchSequence !== patchSequence ||
		source.nextPortId !== portEquipment.nextPortId ||
		source.nextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
		source.nextOrganizationId !== organizations.nextOrganizationId ||
		source.plan.baseRevision !== source.revision ||
		source.plan.basePatchSequence !== source.patchSequence ||
		source.planFingerprint !== reviewedApplyPlanFingerprint(source.plan)
	) {
		return null;
	}
	if (source.plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND) {
		issuePortEquipmentBatchPlan(source.plan, map, portEquipment, organizations, patchSequence);
	}
	return source.plan;
}

/** Terminally consume exact-document Apply authority without one unbounded fingerprint walk. */
export async function consumeReviewedPortEquipmentApplyCooperatively(
	handle: ReviewedPortEquipmentApply,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
	checkpoint: () => Promise<void>,
): Promise<PortEquipmentMutationPlan | null> {
	const source = pendingApplies.get(handle);
	pendingApplies.delete(handle);
	if (
		!source ||
		!isCertifiedImmutablePortEquipmentMutationPlanGraph(source.plan) ||
		!reviewedApplySourceMatches(source, map, portEquipment, organizations, patchSequence)
	) {
		return null;
	}
	const fingerprint = await reviewedApplyPlanFingerprintCooperatively(source.plan, checkpoint);
	if (
		fingerprint !== source.planFingerprint ||
		!reviewedApplySourceMatches(source, map, portEquipment, organizations, patchSequence)
	) {
		return null;
	}
	if (source.plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND) {
		await issuePortEquipmentBatchPlanCooperatively(
			source.plan,
			map,
			portEquipment,
			organizations,
			patchSequence,
			checkpoint,
		);
	}
	return source.plan;
}

function reviewedApplySourceMatches(
	source: ReviewedPortEquipmentApplySource,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): boolean {
	return (
		source.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.revision === map.getRevision() &&
		source.patchSequence === patchSequence &&
		source.nextPortId === portEquipment.nextPortId &&
		source.nextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		source.nextOrganizationId === organizations.nextOrganizationId &&
		source.plan.baseRevision === source.revision &&
		source.plan.basePatchSequence === source.patchSequence
	);
}

function reviewedApplyPlanFingerprint(plan: PortEquipmentMutationPlan): string {
	return `${plan.kind}:${plan.valid ? 1 : 0}:${plan.reason}:${plan.baseRevision}:${
		plan.basePatchSequence
	}:${railPatchTransitionFingerprint({
		changes: [],
		switchChanges: [],
		portChanges: plan.portMutations,
		equipmentGroupChanges: plan.equipmentGroupMutations,
		organizationChanges: [],
		organizationNextIdBefore: 0,
		organizationNextIdAfter: 0,
	})}`;
}

async function reviewedApplyPlanFingerprintCooperatively(
	plan: PortEquipmentMutationPlan,
	checkpoint: () => Promise<void>,
): Promise<string> {
	return `${plan.kind}:${plan.valid ? 1 : 0}:${plan.reason}:${plan.baseRevision}:${
		plan.basePatchSequence
	}:${await railPatchTransitionFingerprintCooperatively(
		{
			changes: [],
			switchChanges: [],
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: [],
			organizationNextIdBefore: 0,
			organizationNextIdAfter: 0,
			organizationImpactAuthorizations: [],
		},
		checkpoint,
	)}`;
}
