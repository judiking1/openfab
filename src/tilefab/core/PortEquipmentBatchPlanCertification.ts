import type { PortEquipmentState } from "./EquipmentGroup";
import {
	isCertifiedImmutablePortEquipmentMutationPlanGraph,
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	type PortEquipmentMutationPlan,
} from "./PortEquipmentPlan";
import {
	railPatchTransitionFingerprint,
	railPatchTransitionFingerprintCooperatively,
} from "./RailPatchHistory";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";
import type { TileMap } from "./TileMap";

interface PortEquipmentBatchPlanSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly patchSequence: number;
	readonly revision: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly fingerprint: string;
}

const issuedPlans = new WeakMap<object, PortEquipmentBatchPlanSource>();

/**
 * Bind a generic mixed placement to one exact authored generation.
 *
 * Reviewed single-kind placements lower to their ordinary command kinds. The broader mixed-kind
 * batch command is issued only by a reviewed planner so relabeling cannot bypass that boundary.
 */
export function issuePortEquipmentBatchPlan(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): void {
	if (
		plan.kind !== PORT_EQUIPMENT_BATCH_PLAN_KIND ||
		!plan.valid ||
		(plan.portMutations.length === 0 && plan.equipmentGroupMutations.length === 0) ||
		!Number.isSafeInteger(patchSequence) ||
		patchSequence < 0 ||
		plan.baseRevision !== map.getRevision() ||
		plan.basePatchSequence !== patchSequence
	) {
		throw new Error("Port equipment batch plan cannot be issued for this authored generation.");
	}
	issuedPlans.set(
		plan,
		Object.freeze({
			map,
			portEquipment,
			organizations,
			patchSequence,
			revision: map.getRevision(),
			nextPortId: portEquipment.nextPortId,
			nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
			fingerprint: portEquipmentBatchPlanFingerprint(plan),
		}),
	);
}

/** Issue the same exact-generation batch authority without one unbounded fingerprint walk. */
export async function issuePortEquipmentBatchPlanCooperatively(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
	checkpoint: () => Promise<void>,
): Promise<void> {
	assertPortEquipmentBatchPlanIssuable(plan, map, portEquipment, organizations, patchSequence);
	if (!isCertifiedImmutablePortEquipmentMutationPlanGraph(plan)) {
		throw new Error("Cooperative port equipment batch authority requires an immutable plan graph.");
	}
	const fingerprint = await portEquipmentBatchPlanFingerprintCooperatively(plan, checkpoint);
	assertPortEquipmentBatchPlanIssuable(plan, map, portEquipment, organizations, patchSequence);
	issuedPlans.set(
		plan,
		Object.freeze({
			map,
			portEquipment,
			organizations,
			patchSequence,
			revision: map.getRevision(),
			nextPortId: portEquipment.nextPortId,
			nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
			fingerprint,
		}),
	);
}

/** Consume one exact reviewed batch authority. Every attempted consumption is terminal. */
export function consumePortEquipmentBatchPlanIssuedFor(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): boolean {
	const source = issuedPlans.get(plan);
	issuedPlans.delete(plan);
	return (
		plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND &&
		source?.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.patchSequence === patchSequence &&
		source.revision === map.getRevision() &&
		source.nextPortId === portEquipment.nextPortId &&
		source.nextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		source.nextOrganizationId === organizations.nextOrganizationId &&
		plan.baseRevision === source.revision &&
		plan.basePatchSequence === source.patchSequence &&
		source.fingerprint === portEquipmentBatchPlanFingerprint(plan)
	);
}

/** Terminally consume exact reviewed batch authority through cooperative fingerprint checks. */
export async function consumePortEquipmentBatchPlanIssuedForCooperatively(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
	checkpoint: () => Promise<void>,
): Promise<boolean> {
	const source = issuedPlans.get(plan);
	issuedPlans.delete(plan);
	if (
		!source ||
		!isCertifiedImmutablePortEquipmentMutationPlanGraph(plan) ||
		!portEquipmentBatchPlanSourceMatches(
			plan,
			source,
			map,
			portEquipment,
			organizations,
			patchSequence,
		)
	) {
		return false;
	}
	const fingerprint = await portEquipmentBatchPlanFingerprintCooperatively(plan, checkpoint);
	return (
		portEquipmentBatchPlanSourceMatches(
			plan,
			source,
			map,
			portEquipment,
			organizations,
			patchSequence,
		) && source.fingerprint === fingerprint
	);
}

function assertPortEquipmentBatchPlanIssuable(
	plan: PortEquipmentMutationPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): void {
	if (
		plan.kind !== PORT_EQUIPMENT_BATCH_PLAN_KIND ||
		!plan.valid ||
		(plan.portMutations.length === 0 && plan.equipmentGroupMutations.length === 0) ||
		!Number.isSafeInteger(patchSequence) ||
		patchSequence < 0 ||
		plan.baseRevision !== map.getRevision() ||
		plan.basePatchSequence !== patchSequence ||
		portEquipment.nextPortId < 1 ||
		portEquipment.nextEquipmentGroupId < 1 ||
		organizations.nextOrganizationId < 1
	) {
		throw new Error("Port equipment batch plan cannot be issued for this authored generation.");
	}
}

function portEquipmentBatchPlanSourceMatches(
	plan: PortEquipmentMutationPlan,
	source: PortEquipmentBatchPlanSource,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	patchSequence: number,
): boolean {
	return (
		plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND &&
		source.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.patchSequence === patchSequence &&
		source.revision === map.getRevision() &&
		source.nextPortId === portEquipment.nextPortId &&
		source.nextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		source.nextOrganizationId === organizations.nextOrganizationId &&
		plan.baseRevision === source.revision &&
		plan.basePatchSequence === source.patchSequence
	);
}

function portEquipmentBatchPlanFingerprint(plan: PortEquipmentMutationPlan): string {
	return `${plan.kind}:${plan.baseRevision}:${plan.basePatchSequence}:${railPatchTransitionFingerprint(
		{
			changes: [],
			switchChanges: [],
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: [],
			organizationNextIdBefore: 0,
			organizationNextIdAfter: 0,
		},
	)}`;
}

async function portEquipmentBatchPlanFingerprintCooperatively(
	plan: PortEquipmentMutationPlan,
	checkpoint: () => Promise<void>,
): Promise<string> {
	return `${plan.kind}:${plan.baseRevision}:${
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
