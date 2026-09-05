import type { StaticFabAssemblyConnectorPlan } from "../core/StaticFabAssemblyConnector";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";

export interface AppliedConnectedFabEvidence {
	readonly fabOrganizationId: number;
	readonly connectedBayBankOrganizationIds: readonly [number, number];
	readonly connectedBayBankParentOrganizationIdsBefore: readonly [
		readonly number[],
		readonly number[],
	];
	readonly createdFab: boolean;
	readonly addedFabRailEdgeKeys: readonly string[];
}

/**
 * Bind an ordinary hierarchy-link Apply to the exact certified Fab mutation. The receipt stays in
 * runtime memory only; native project persistence remains the authority after a reopen.
 */
export function appliedConnectedFabEvidence(
	plan: StaticFabAssemblyConnectorPlan,
	organizationsBefore: StaticFabOrganizationState,
): AppliedConnectedFabEvidence | null {
	const metadata = plan.assemblyConnector;
	if (
		!plan.valid ||
		metadata.hierarchyRole !== "BANK_TO_FAB" ||
		metadata.purpose !== "HIERARCHY_LINK" ||
		metadata.fabOrganizationId === null ||
		metadata.sourceOrganizationId === metadata.targetOrganizationId ||
		plan.nextOrganizationIdBefore !== organizationsBefore.nextOrganizationId
	) {
		return null;
	}
	const ids = [metadata.sourceOrganizationId, metadata.targetOrganizationId].sort(
		(left, right) => left - right,
	) as [number, number];
	const recordsBefore = new Map(organizationsBefore.records.map((record) => [record.id, record]));
	const rolesBefore = deriveStaticFabOrganizationSemanticRoles(organizationsBefore);
	if (ids.some((id) => rolesBefore.get(id) !== "BAY_BANK")) return null;
	const mutationsById = new Map(
		plan.organizationMutations.map((mutation) => [mutation.id, mutation]),
	);
	const fabMutation = mutationsById.get(metadata.fabOrganizationId);
	const fabBefore = fabMutation?.before ?? null;
	const fabAfter = fabMutation?.after ?? null;
	if (
		!fabMutation ||
		!fabAfter ||
		fabAfter.id !== metadata.fabOrganizationId ||
		(metadata.createdFab
			? fabBefore !== null || plan.nextOrganizationIdAfter !== plan.nextOrganizationIdBefore + 1
			: fabBefore === null || plan.nextOrganizationIdAfter !== plan.nextOrganizationIdBefore)
	) {
		return null;
	}
	const childParentOrganizationIdsBefore: [readonly number[], readonly number[]] = [
		Object.freeze([]),
		Object.freeze([]),
	];
	if (fabBefore && rolesBefore.get(fabBefore.id) !== "FAB") return null;
	for (const [index, id] of ids.entries()) {
		const childBefore = recordsBefore.get(id) ?? null;
		const childAfter = mutationsById.get(id)?.after ?? childBefore;
		if (!childBefore || !childAfter) return null;
		if (!staticFabOrganizationParentIds(childAfter).includes(fabAfter.id)) return null;
		childParentOrganizationIdsBefore[index] = Object.freeze([
			...staticFabOrganizationParentIds(childBefore),
		]);
	}
	const beforeEdgeKeys = new Set(
		(fabBefore?.membership.railEdges ?? []).map(staticFabOrganizationEdgeKey),
	);
	const addedFabRailEdgeKeys = fabAfter.membership.railEdges
		.map(staticFabOrganizationEdgeKey)
		.filter((key) => !beforeEdgeKeys.has(key));
	if (addedFabRailEdgeKeys.length === 0) return null;
	return Object.freeze({
		fabOrganizationId: fabAfter.id,
		connectedBayBankOrganizationIds: Object.freeze(ids),
		connectedBayBankParentOrganizationIdsBefore: Object.freeze(childParentOrganizationIdsBefore),
		createdFab: metadata.createdFab,
		addedFabRailEdgeKeys: Object.freeze(addedFabRailEdgeKeys),
	});
}

/** Validate only the receipt's exact Fab and two child Banks after Apply or Redo. */
export function appliedConnectedFabEvidenceIsCurrent(
	organizations: StaticFabOrganizationState,
	evidence: AppliedConnectedFabEvidence,
): boolean {
	let fab: (typeof organizations.records)[number] | null = null;
	const children = new Map<number, (typeof organizations.records)[number]>();
	for (const record of organizations.records) {
		if (record.id === evidence.fabOrganizationId) fab = record;
		if (evidence.connectedBayBankOrganizationIds.includes(record.id))
			children.set(record.id, record);
		if (fab && children.size === 2) break;
	}
	if (!fab || children.size !== 2) return false;
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	if (
		roles.get(fab.id) !== "FAB" ||
		evidence.connectedBayBankOrganizationIds.some((id) => roles.get(id) !== "BAY_BANK")
	) {
		return false;
	}
	const fabEdgeKeys = new Set(fab.membership.railEdges.map(staticFabOrganizationEdgeKey));
	if (!evidence.addedFabRailEdgeKeys.every((key) => fabEdgeKeys.has(key))) return false;
	return evidence.connectedBayBankOrganizationIds.every((id) => {
		const child = children.get(id);
		if (!child || !staticFabOrganizationParentIds(child).includes(evidence.fabOrganizationId)) {
			return false;
		}
		const childEdgeKeys = new Set(child.membership.railEdges.map(staticFabOrganizationEdgeKey));
		return evidence.addedFabRailEdgeKeys.every((key) => !childEdgeKeys.has(key));
	});
}

/** Validate the exact pre-Apply organization projection after one Undo. */
export function connectedFabUndoProjectionExists(
	organizations: StaticFabOrganizationState,
	evidence: AppliedConnectedFabEvidence,
): boolean {
	let fab: (typeof organizations.records)[number] | null = null;
	const children = new Map<number, (typeof organizations.records)[number]>();
	for (const record of organizations.records) {
		if (record.id === evidence.fabOrganizationId) fab = record;
		if (evidence.connectedBayBankOrganizationIds.includes(record.id))
			children.set(record.id, record);
	}
	if (children.size !== 2 || (evidence.createdFab ? fab !== null : fab === null)) return false;
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	if (evidence.connectedBayBankOrganizationIds.some((id) => roles.get(id) !== "BAY_BANK")) {
		return false;
	}
	if (!evidence.createdFab && fab && roles.get(fab.id) !== "FAB") return false;
	if (
		fab &&
		evidence.addedFabRailEdgeKeys.some((key) =>
			fab.membership.railEdges.some((edge) => staticFabOrganizationEdgeKey(edge) === key),
		)
	) {
		return false;
	}
	return evidence.connectedBayBankOrganizationIds.every((id, index) => {
		const child = children.get(id);
		const expectedParents = evidence.connectedBayBankParentOrganizationIdsBefore[index];
		if (!child || !expectedParents) return false;
		const actualParents = staticFabOrganizationParentIds(child);
		return (
			actualParents.length === expectedParents.length &&
			actualParents.every((parentId, parentIndex) => parentId === expectedParents[parentIndex])
		);
	});
}

/**
 * Native-reopen recovery is deliberately structural and conservative: one selected semantic Fab
 * must have exactly two direct semantic Bay Bank children. Never guess a pair from a larger Fab.
 */
export function ordinaryConnectedFabBankPair(
	organizations: StaticFabOrganizationState,
	semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	selectedOrganizationIds: readonly number[],
): readonly [number, number] | null {
	if (selectedOrganizationIds.length !== 1) return null;
	const fabOrganizationId = selectedOrganizationIds[0];
	if (fabOrganizationId === undefined) return null;
	if (semanticRoles.get(fabOrganizationId) !== "FAB") return null;
	const bankIds: number[] = [];
	for (const record of organizations.records) {
		if (
			semanticRoles.get(record.id) !== "BAY_BANK" ||
			!staticFabOrganizationParentIds(record).includes(fabOrganizationId)
		) {
			continue;
		}
		bankIds.push(record.id);
		if (bankIds.length > 2) return null;
	}
	if (bankIds.length !== 2) return null;
	bankIds.sort((left, right) => left - right);
	return Object.freeze([bankIds[0] as number, bankIds[1] as number]);
}

/**
 * A current-session Apply/Redo receipt is more precise than native structural recovery: an
 * extended Fab may have three or more direct Banks, while the just-connected pair remains exact.
 */
export function ordinaryConnectedFabReceiptBankPair(
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
	semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	selectedOrganizationIds: readonly number[],
	evidence: AppliedConnectedFabEvidence,
): readonly [number, number] | null {
	if (
		selectedOrganizationIds.length !== 1 ||
		selectedOrganizationIds[0] !== evidence.fabOrganizationId ||
		semanticRoles.get(evidence.fabOrganizationId) !== "FAB"
	) {
		return null;
	}
	const [leftId, rightId] = evidence.connectedBayBankOrganizationIds;
	if (leftId === rightId) return null;
	for (const organizationId of evidence.connectedBayBankOrganizationIds) {
		const record = recordsById.get(organizationId);
		if (
			!record ||
			semanticRoles.get(organizationId) !== "BAY_BANK" ||
			!staticFabOrganizationParentIds(record).includes(evidence.fabOrganizationId)
		) {
			return null;
		}
	}
	return evidence.connectedBayBankOrganizationIds;
}

export interface OrdinaryConnectedFabLoopHandoffContext {
	readonly selectedOrganizationIds: readonly number[];
	readonly selectedFabOrganizationId: number | null;
	readonly connectedBayBankOrganizationIds: readonly [number, number] | null;
	readonly fabLoopReviewReady: boolean;
	readonly redoAvailable: boolean;
	readonly exactLoopUndoReceiptCurrent?: boolean;
	readonly guidedBuildActive: boolean;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForReview: boolean;
}

export interface OrdinaryConnectedFabLoopHandoffPresentation {
	readonly action: "review-recognized-fab-loop";
	readonly label: "다음 · Fab 외곽 순환 검토";
	readonly instruction: "두 Bay Bank 사이의 두 번째 왕복 경로를 검토";
	readonly ariaLabel: string;
	readonly description: string;
}

export function ordinaryConnectedFabLoopHandoffLiveStatus(
	statusOverride: string | null,
	currentReceiptOutcome: "created" | "extended" | null,
): string {
	if (statusOverride) return statusOverride;
	if (currentReceiptOutcome === "created") {
		return "Fab 생성 완료 · 다음: Tab으로 Fab 외곽 순환 검토 · Apply 전에는 프로젝트 변경 없음";
	}
	if (currentReceiptOutcome === "extended") {
		return "Fab 확장 완료 · 다음: Tab으로 Fab 외곽 순환 검토 · Apply 전에는 프로젝트 변경 없음";
	}
	return "Fab 선택 완료 · 다음: Tab으로 Fab 외곽 순환 검토 · Apply 전에는 프로젝트 변경 없음";
}

const CONNECTED_FAB_LOOP_HANDOFF = Object.freeze({
	action: "review-recognized-fab-loop",
	label: "다음 · Fab 외곽 순환 검토",
	instruction: "두 Bay Bank 사이의 두 번째 왕복 경로를 검토",
	ariaLabel:
		"다음 · Fab 외곽 순환 검토. 선택한 Fab의 직속 Bay Bank 두 개를 대상으로 두 번째 외곽 왕복 경로 검토를 엽니다. Apply 전에는 프로젝트가 변경되지 않으며 Escape 또는 취소로 선택한 Fab으로 돌아올 수 있습니다",
	description:
		"선택한 Fab의 정확한 직속 Bay Bank 두 개로 기존 FAB LOOP 검토를 엽니다. Worker 추천과 검토만으로는 프로젝트가 변경되지 않습니다.",
}) satisfies OrdinaryConnectedFabLoopHandoffPresentation;

export function ordinaryConnectedFabLoopHandoff(
	context: OrdinaryConnectedFabLoopHandoffContext,
): OrdinaryConnectedFabLoopHandoffPresentation | null {
	if (
		context.selectedOrganizationIds.length !== 1 ||
		context.selectedFabOrganizationId === null ||
		context.selectedOrganizationIds[0] !== context.selectedFabOrganizationId ||
		context.connectedBayBankOrganizationIds === null ||
		!context.fabLoopReviewReady ||
		(context.redoAvailable && !context.exactLoopUndoReceiptCurrent) ||
		context.guidedBuildActive ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForReview
	) {
		return null;
	}
	return CONNECTED_FAB_LOOP_HANDOFF;
}
