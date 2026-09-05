import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { directionBetween } from "../core/railShape";
import {
	type StaticFabAssemblyConnectorPlan,
	staticFabAssemblyConnectorAddedDirectedEdges,
} from "../core/StaticFabAssemblyConnector";
import {
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import {
	createStaticFabOuterCirculationIndex,
	type StaticFabOuterCirculationIndex,
	staticFabBankPairHasResilientCirculationInIndex,
} from "../core/StaticFabOuterCirculation";
import type { TileMap } from "../core/TileMap";

export interface AppliedResilientFabLoopEvidence {
	readonly fabOrganizationId: number;
	readonly connectedBayBankOrganizationIds: readonly [number, number];
	readonly addedOutboundRailEdges: readonly DirectedRailEdge[];
	readonly addedReturnRailEdges: readonly DirectedRailEdge[];
	readonly nextOrganizationId: number;
}

/**
 * Capture an exact, project-size-independent FAB_LOOP projection. The Worker-issued plan remains
 * the authority for route planning; this bounded receipt exists solely to prove the
 * Apply/Undo/Redo UI handoff.
 */
export function appliedResilientFabLoopEvidence(
	plan: StaticFabAssemblyConnectorPlan,
	mapBefore: TileMap,
	organizationsBefore: StaticFabOrganizationState,
	sourceIndex?: StaticFabOuterCirculationIndex,
): AppliedResilientFabLoopEvidence | null {
	const metadata = plan.assemblyConnector;
	const fabOrganizationId = metadata.fabOrganizationId;
	if (
		!plan.valid ||
		metadata.issueCode !== null ||
		metadata.hierarchyRole !== "BANK_TO_FAB" ||
		metadata.purpose !== "FAB_LOOP" ||
		metadata.createdFab ||
		fabOrganizationId === null ||
		metadata.sourceOrganizationId === metadata.targetOrganizationId ||
		plan.baseRevision !== mapBefore.getRevision() ||
		plan.mutations.length === 0 ||
		(plan.switchMutations?.length ?? 0) !== 0 ||
		plan.organizationMutations.length === 0 ||
		plan.nextOrganizationIdBefore !== organizationsBefore.nextOrganizationId ||
		plan.nextOrganizationIdAfter !== organizationsBefore.nextOrganizationId
	) {
		return null;
	}
	for (const mutation of plan.mutations) {
		if (
			mutation.before === mutation.after ||
			mapBefore.getEncoded(mutation.x, mutation.y) !== mutation.before
		) {
			return null;
		}
	}
	if (sourceIndex && sourceIndex.source !== organizationsBefore) return null;
	const hierarchy = sourceIndex ?? createStaticFabOuterCirculationIndex(organizationsBefore);
	const recordsBefore = recordsForIdsInIndex(hierarchy, [
		fabOrganizationId,
		metadata.sourceOrganizationId,
		metadata.targetOrganizationId,
	]);
	if (recordsBefore.size !== 3) return null;
	for (const mutation of plan.organizationMutations) {
		if (
			!mutation.before ||
			!mutation.after ||
			!numberListEquals(
				staticFabOrganizationParentIds(mutation.before),
				staticFabOrganizationParentIds(mutation.after),
			)
		) {
			return null;
		}
	}
	const fabMutation = plan.organizationMutations.find(
		(mutation) => mutation.id === fabOrganizationId,
	);
	if (!fabMutation?.before || !fabMutation.after) return null;
	const pair = Object.freeze(
		[metadata.sourceOrganizationId, metadata.targetOrganizationId].sort(
			(left, right) => left - right,
		),
	) as readonly [number, number];
	const roles = hierarchy.roles;
	if (
		roles.get(fabOrganizationId) !== "FAB" ||
		pair.some((bankOrganizationId) => roles.get(bankOrganizationId) !== "BAY_BANK")
	) {
		return null;
	}
	for (const bankOrganizationId of pair) {
		const bank = recordsBefore.get(bankOrganizationId);
		if (!bank || !staticFabOrganizationParentIds(bank).includes(fabOrganizationId)) return null;
	}
	const addedEdges = staticFabAssemblyConnectorAddedDirectedEdges(plan);
	if (addedEdges.length === 0 || addedEdges.length !== plan.newEdges) return null;
	const outboundRouteEdgeKeys = directedRouteEdgeKeys(plan.networkLink.outboundCells);
	const returnRouteEdgeKeys = directedRouteEdgeKeys(plan.networkLink.returnCells);
	const addedOutboundRailEdges: DirectedRailEdge[] = [];
	const addedReturnRailEdges: DirectedRailEdge[] = [];
	for (const edge of addedEdges) {
		const key = staticFabOrganizationEdgeKey(edge);
		const outbound = outboundRouteEdgeKeys.has(key);
		const returning = returnRouteEdgeKeys.has(key);
		if (outbound === returning) return null;
		if (outbound) addedOutboundRailEdges.push(edge);
		else addedReturnRailEdges.push(edge);
	}
	if (addedOutboundRailEdges.length === 0 || addedReturnRailEdges.length === 0) return null;
	return Object.freeze({
		fabOrganizationId,
		connectedBayBankOrganizationIds: pair,
		addedOutboundRailEdges: Object.freeze([...addedOutboundRailEdges]),
		addedReturnRailEdges: Object.freeze([...addedReturnRailEdges]),
		nextOrganizationId: organizationsBefore.nextOrganizationId,
	});
}

/** Validate the exact post-Apply/Redo projection and its pair-level resilient circulation. */
export function appliedResilientFabLoopEvidenceIsCurrent(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	evidence: AppliedResilientFabLoopEvidence,
	currentIndex?: StaticFabOuterCirculationIndex,
): boolean {
	const hierarchy =
		currentIndex?.source === organizations
			? currentIndex
			: createStaticFabOuterCirculationIndex(organizations);
	return (
		exactProjectionExists(map, organizations, evidence, "after", hierarchy) &&
		staticFabBankPairHasResilientCirculationInIndex(
			hierarchy,
			evidence.fabOrganizationId,
			evidence.connectedBayBankOrganizationIds[0],
			evidence.connectedBayBankOrganizationIds[1],
		)
	);
}

/**
 * Revalidate the exact committed receipt projection without rebuilding hierarchy. The receipt
 * itself was issued only after the prospective indexed graph passed the resilience proof.
 */
export function appliedResilientFabLoopProjectionIsCurrent(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	evidence: AppliedResilientFabLoopEvidence,
): boolean {
	return exactProjectionExists(map, organizations, evidence, "after");
}

/** Validate the exact pre-Apply projection after one Undo without assuming it was non-resilient. */
export function resilientFabLoopUndoProjectionExists(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	evidence: AppliedResilientFabLoopEvidence,
): boolean {
	return exactProjectionExists(map, organizations, evidence, "before");
}

/** A receipt pair remains usable after Undo while the exact Fab selection is preserved. */
export function ordinaryResilientFabLoopReceiptBankPair(
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
	selectedOrganizationIds: readonly number[],
	evidence: AppliedResilientFabLoopEvidence,
): readonly [number, number] | null {
	if (
		selectedOrganizationIds.length !== 1 ||
		selectedOrganizationIds[0] !== evidence.fabOrganizationId ||
		!recordsById.has(evidence.fabOrganizationId)
	) {
		return null;
	}
	for (const bankOrganizationId of evidence.connectedBayBankOrganizationIds) {
		const bank = recordsById.get(bankOrganizationId);
		if (!bank || !staticFabOrganizationParentIds(bank).includes(evidence.fabOrganizationId)) {
			return null;
		}
	}
	return evidence.connectedBayBankOrganizationIds;
}

export interface OrdinaryResilientFabChecksHandoffContext {
	readonly selectedOrganizationIds: readonly number[];
	readonly selectedFabOrganizationId: number | null;
	readonly connectedBayBankOrganizationIds: readonly [number, number] | null;
	readonly resilientFabLoopCurrent: boolean;
	readonly exactDirectBankPair: boolean;
	readonly redoAvailable: boolean;
	readonly guidedBuildActive: boolean;
	readonly placementPending: boolean;
	readonly exclusiveCommandActive: boolean;
	readonly readyForChecks: boolean;
}

export interface OrdinaryResilientFabChecksHandoffPresentation {
	readonly action: "open-static-fab-checks";
	readonly label: "다음 · 정적 FAB 검사";
	readonly instruction: "현재 프로젝트의 레일·포트·장비·조직 결과 확인";
	readonly ariaLabel: string;
	readonly description: string;
}

const RESILIENT_FAB_CHECKS_HANDOFF = Object.freeze({
	action: "open-static-fab-checks",
	label: "다음 · 정적 FAB 검사",
	instruction: "현재 프로젝트의 레일·포트·장비·조직 결과 확인",
	ariaLabel:
		"다음 · 정적 FAB 검사. 선택한 Fab의 두 Bay Bank 사이 외곽 순환을 포함한 현재 프로젝트 전체 검사를 엽니다. 검사를 여는 것만으로 프로젝트는 변경되지 않습니다",
	description:
		"선택한 Fab의 외곽 순환을 포함한 현재 프로젝트 전체 검사를 엽니다. 검사를 여는 것만으로 프로젝트는 변경되지 않습니다. Escape 또는 닫기로 선택한 Fab으로 돌아옵니다.",
}) satisfies OrdinaryResilientFabChecksHandoffPresentation;

export function ordinaryResilientFabChecksHandoff(
	context: OrdinaryResilientFabChecksHandoffContext,
): OrdinaryResilientFabChecksHandoffPresentation | null {
	if (
		context.selectedOrganizationIds.length !== 1 ||
		context.selectedFabOrganizationId === null ||
		context.selectedOrganizationIds[0] !== context.selectedFabOrganizationId ||
		context.connectedBayBankOrganizationIds === null ||
		!context.resilientFabLoopCurrent ||
		!context.exactDirectBankPair ||
		context.redoAvailable ||
		context.guidedBuildActive ||
		context.placementPending ||
		context.exclusiveCommandActive ||
		!context.readyForChecks
	) {
		return null;
	}
	return RESILIENT_FAB_CHECKS_HANDOFF;
}

function exactProjectionExists(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	evidence: AppliedResilientFabLoopEvidence,
	projection: "before" | "after",
	hierarchy?: StaticFabOuterCirculationIndex,
): boolean {
	if (organizations.nextOrganizationId !== evidence.nextOrganizationId) return false;
	const organizationIds = [evidence.fabOrganizationId, ...evidence.connectedBayBankOrganizationIds];
	const records =
		hierarchy?.source === organizations
			? recordsForIdsInIndex(hierarchy, organizationIds)
			: recordsForIds(organizations, organizationIds);
	if (records.size !== 3) return false;
	const fab = records.get(evidence.fabOrganizationId);
	if (!fab) return false;
	const addedEdges = [...evidence.addedOutboundRailEdges, ...evidence.addedReturnRailEdges];
	const fabEdgeKeys = new Set(fab.membership.railEdges.map(staticFabOrganizationEdgeKey));
	for (const bankOrganizationId of evidence.connectedBayBankOrganizationIds) {
		const bank = records.get(bankOrganizationId);
		if (!bank || !staticFabOrganizationParentIds(bank).includes(evidence.fabOrganizationId)) {
			return false;
		}
		const bankEdgeKeys = new Set(bank.membership.railEdges.map(staticFabOrganizationEdgeKey));
		if (addedEdges.some((edge) => bankEdgeKeys.has(staticFabOrganizationEdgeKey(edge)))) {
			return false;
		}
	}
	for (const edge of addedEdges) {
		const present = mapHasDirectedEdge(map, edge);
		const fabOwns = fabEdgeKeys.has(staticFabOrganizationEdgeKey(edge));
		if (projection === "after" ? !present || !fabOwns : present || fabOwns) return false;
	}
	return true;
}

function recordsForIds(
	organizations: StaticFabOrganizationState,
	organizationIds: readonly number[],
): ReadonlyMap<number, StaticFabOrganizationRecord> {
	const wanted = new Set(organizationIds);
	const records = new Map<number, StaticFabOrganizationRecord>();
	for (const record of organizations.records) {
		if (!wanted.has(record.id)) continue;
		records.set(record.id, record);
		if (records.size === wanted.size) break;
	}
	return records;
}

function recordsForIdsInIndex(
	hierarchy: StaticFabOuterCirculationIndex,
	organizationIds: readonly number[],
): ReadonlyMap<number, StaticFabOrganizationRecord> {
	const records = new Map<number, StaticFabOrganizationRecord>();
	for (const organizationId of organizationIds) {
		const record = hierarchy.recordsById.get(organizationId);
		if (record) records.set(organizationId, record);
	}
	return records;
}

function directedRouteEdgeKeys(
	cells: readonly Readonly<{ x: number; y: number }>[],
): ReadonlySet<string> {
	const keys = new Set<string>();
	for (let index = 1; index < cells.length; index++) {
		const from = cells[index - 1];
		const to = cells[index];
		if (!from || !to) return new Set();
		keys.add(staticFabOrganizationEdgeKey({ from, to }));
	}
	return keys;
}

function mapHasDirectedEdge(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	return direction !== null && (map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0;
}

function numberListEquals(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
