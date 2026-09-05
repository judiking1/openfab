import type { StaticFabAssemblyConnectorPlan } from "../core/StaticFabAssemblyConnector";
import {
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";

export interface AppliedConnectedBayBankEvidence {
	readonly bankOrganizationId: number;
	readonly connectedTwinBayOrganizationIds: readonly [number, number];
	readonly connectedTwinBayParentOrganizationIdsBefore: readonly [
		readonly number[],
		readonly number[],
	];
	readonly createdBank: boolean;
	readonly addedBankRailEdgeKeys: readonly string[];
}

/**
 * Derive the bounded runtime receipt from the already certified Connector plan. This never scans
 * unrelated descendants or infers transaction identity from a display name or semantic count.
 */
export function appliedConnectedBayBankEvidence(
	plan: StaticFabAssemblyConnectorPlan,
	organizationsBefore: StaticFabOrganizationState,
): AppliedConnectedBayBankEvidence | null {
	const metadata = plan.assemblyConnector;
	if (
		!plan.valid ||
		metadata.hierarchyRole !== "BAY_TO_BANK" ||
		metadata.purpose !== "HIERARCHY_LINK" ||
		metadata.bankOrganizationId === null ||
		metadata.sourceOrganizationId === metadata.targetOrganizationId
	) {
		return null;
	}
	const ids = [metadata.sourceOrganizationId, metadata.targetOrganizationId].sort(
		(left, right) => left - right,
	) as [number, number];
	const recordsBefore = new Map(organizationsBefore.records.map((record) => [record.id, record]));
	const mutationsById = new Map(
		plan.organizationMutations.map((mutation) => [mutation.id, mutation]),
	);
	const bankMutation = mutationsById.get(metadata.bankOrganizationId);
	const bankBefore = bankMutation?.before ?? null;
	const bankAfter = bankMutation?.after ?? null;
	if (
		!bankMutation ||
		!bankAfter ||
		bankAfter.id !== metadata.bankOrganizationId ||
		(metadata.createdBank
			? bankBefore !== null || plan.nextOrganizationIdAfter !== plan.nextOrganizationIdBefore + 1
			: bankBefore === null || plan.nextOrganizationIdAfter !== plan.nextOrganizationIdBefore)
	) {
		return null;
	}
	const childParentOrganizationIdsBefore: [readonly number[], readonly number[]] = [
		Object.freeze([]),
		Object.freeze([]),
	];
	for (const [index, id] of ids.entries()) {
		const childBefore = recordsBefore.get(id) ?? null;
		const childAfter = mutationsById.get(id)?.after ?? childBefore;
		if (!childBefore) return null;
		if (!childAfter || !staticFabOrganizationParentIds(childAfter).includes(bankAfter.id))
			return null;
		childParentOrganizationIdsBefore[index] = Object.freeze([
			...staticFabOrganizationParentIds(childBefore),
		]);
	}
	const beforeEdgeKeys = new Set(
		(bankBefore?.membership.railEdges ?? []).map(staticFabOrganizationEdgeKey),
	);
	const addedBankRailEdgeKeys = bankAfter.membership.railEdges
		.map(staticFabOrganizationEdgeKey)
		.filter((key) => !beforeEdgeKeys.has(key));
	if (addedBankRailEdgeKeys.length === 0) return null;
	return Object.freeze({
		bankOrganizationId: bankAfter.id,
		connectedTwinBayOrganizationIds: Object.freeze(ids),
		connectedTwinBayParentOrganizationIdsBefore: Object.freeze(childParentOrganizationIdsBefore),
		createdBank: metadata.createdBank,
		addedBankRailEdgeKeys: Object.freeze(addedBankRailEdgeKeys),
	});
}

/** Bounded post-commit/history validation for only the three exact receipt records. */
export function appliedConnectedBayBankEvidenceIsCurrent(
	organizations: StaticFabOrganizationState,
	evidence: AppliedConnectedBayBankEvidence,
): boolean {
	let bank: (typeof organizations.records)[number] | null = null;
	const children = new Map<number, (typeof organizations.records)[number]>();
	for (const record of organizations.records) {
		if (record.id === evidence.bankOrganizationId) bank = record;
		if (evidence.connectedTwinBayOrganizationIds.includes(record.id)) {
			children.set(record.id, record);
		}
		if (bank && children.size === 2) break;
	}
	if (!bank || children.size !== 2) return false;
	if (
		evidence.connectedTwinBayOrganizationIds.some((id) => {
			const child = children.get(id);
			return !child || !staticFabOrganizationParentIds(child).includes(evidence.bankOrganizationId);
		})
	) {
		return false;
	}
	const bankEdgeKeys = new Set(bank.membership.railEdges.map(staticFabOrganizationEdgeKey));
	return evidence.addedBankRailEdgeKeys.every((key) => bankEdgeKeys.has(key));
}

export function connectedBayBankUndoProjectionExists(
	organizations: StaticFabOrganizationState,
	evidence: AppliedConnectedBayBankEvidence,
): boolean {
	let bank: (typeof organizations.records)[number] | null = null;
	const children = new Map<number, (typeof organizations.records)[number]>();
	for (const record of organizations.records) {
		if (record.id === evidence.bankOrganizationId) bank = record;
		if (evidence.connectedTwinBayOrganizationIds.includes(record.id)) {
			children.set(record.id, record);
		}
	}
	if (children.size !== 2 || (evidence.createdBank ? bank !== null : bank === null)) return false;
	if (
		bank &&
		evidence.addedBankRailEdgeKeys.some((key) =>
			bank.membership.railEdges.some((edge) => staticFabOrganizationEdgeKey(edge) === key),
		)
	) {
		return false;
	}
	return evidence.connectedTwinBayOrganizationIds.every((id, index) => {
		const child = children.get(id);
		const expectedParents = evidence.connectedTwinBayParentOrganizationIdsBefore[index];
		if (!child || !expectedParents) return false;
		const actualParents = staticFabOrganizationParentIds(child);
		return (
			actualParents.length === expectedParents.length &&
			actualParents.every((parentId, parentIndex) => parentId === expectedParents[parentIndex])
		);
	});
}

export interface OrdinaryConnectedBayBankDuplicateHandoffContext {
	readonly selectedOrganizationIds: readonly number[];
	readonly selectedBayBankOrganizationId: number | null;
	readonly duplicateReady: boolean;
	readonly redoAvailable: boolean;
	readonly guidedBuildActive: boolean;
	readonly organizationBundleActive: boolean;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForMutation: boolean;
}

export interface OrdinaryConnectedBayBankDuplicateHandoffPresentation {
	readonly action: "duplicate-recognized-bay-bank";
	readonly label: "다음 · Bay Bank 전체 복제";
	readonly instruction: "하위 Bay·Process Loop·연결 구조까지 함께 복제";
	readonly ariaLabel: string;
	readonly description: string;
}

const CONNECTED_BAY_BANK_DUPLICATE_HANDOFF = Object.freeze({
	action: "duplicate-recognized-bay-bank",
	label: "다음 · Bay Bank 전체 복제",
	instruction: "하위 Bay·Process Loop·연결 구조까지 함께 복제",
	ariaLabel:
		"다음 · Bay Bank 전체 복제. 선택한 Bay Bank와 모든 하위 Bay, Process Loop, Rail, Port, 장비를 함께 복제할 위치 선택을 시작합니다. 배치 전에는 프로젝트가 변경되지 않으며 Escape, 오른쪽 클릭, 또는 배치 취소로 돌아올 수 있습니다",
	description:
		"선택한 Bay Bank와 모든 하위 Bay, Process Loop, Rail, Port, 장비를 함께 복제할 위치를 고릅니다. 위치를 확정하기 전에는 프로젝트가 변경되지 않습니다.",
}) satisfies OrdinaryConnectedBayBankDuplicateHandoffPresentation;

/** Project a canonical one-Bank selection into the existing EFFECTIVE organization duplicate. */
export function ordinaryConnectedBayBankDuplicateHandoff(
	context: OrdinaryConnectedBayBankDuplicateHandoffContext,
): OrdinaryConnectedBayBankDuplicateHandoffPresentation | null {
	if (
		context.selectedOrganizationIds.length !== 1 ||
		context.selectedBayBankOrganizationId === null ||
		context.selectedOrganizationIds[0] !== context.selectedBayBankOrganizationId ||
		!context.duplicateReady ||
		context.redoAvailable ||
		context.guidedBuildActive ||
		context.organizationBundleActive ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForMutation
	) {
		return null;
	}
	return CONNECTED_BAY_BANK_DUPLICATE_HANDOFF;
}
