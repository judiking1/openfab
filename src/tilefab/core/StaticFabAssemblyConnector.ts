import type { PortEquipmentState } from "./EquipmentGroup";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import type { RailModuleSide } from "./RailModulePlanner";
import {
	createRailNetworkLinkAnchorContext,
	planRailNetworkLink,
	RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
	RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS,
	type RailNetworkLinkMetadata,
	type RailNetworkLinkPlan,
} from "./RailNetworkLinkPlanner";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_S,
	type Direction,
	directionBetween,
	moveCell,
} from "./railShape";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
} from "./StaticFabOrganizationImpactIndex";
import { staticFabBankPairHasResilientCirculation } from "./StaticFabOuterCirculation";
import { type Cell, cellKey, decodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION = 3 as const;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND = "connect-static-fab-assemblies" as const;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS = 512;
export const STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT = 64;
export const STATIC_FAB_ASSEMBLY_GATEWAY_MINIMUM_RUN_METERS =
	RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS + RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS * 2;

export type StaticFabAssemblyConnectorIssueCode =
	| "INVALID_SOURCE"
	| "STALE_SOURCE"
	| "MISSING_ORGANIZATION"
	| "UNSUPPORTED_ORGANIZATION"
	| "SAME_ORGANIZATION"
	| "ANCHOR_OUTSIDE_ORGANIZATION"
	| "AMBIGUOUS_GATEWAY_OWNERSHIP"
	| "DIFFERENT_BANKS"
	| "DIFFERENT_FABS"
	| "HIERARCHY_INVALID"
	| "ALREADY_CONNECTED"
	| "ROUTE_INVALID"
	| "ORGANIZATION_INVALID";

export type StaticFabAssemblyConnectorHierarchyRole = "BAY_TO_BANK" | "BANK_TO_FAB";
export type StaticFabAssemblyConnectorPurpose = "HIERARCHY_LINK" | "FAB_LOOP";

export interface StaticFabAssemblyGatewayCandidate {
	readonly id: string;
	readonly organizationId: number;
	readonly anchor: Cell;
	readonly start: Cell;
	readonly end: Cell;
	readonly forward: Direction;
	readonly axis: "x" | "y";
	readonly runLengthMeters: number;
}

export interface StaticFabAssemblyConnectorSelectionBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface StaticFabAssemblyConnectorIntent {
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION;
	readonly purpose: StaticFabAssemblyConnectorPurpose;
	readonly sourceOrganizationId: number;
	readonly sourceGatewayId: string;
	readonly sourceAnchor: Cell;
	readonly targetOrganizationId: number;
	readonly targetGatewayId: string;
	readonly targetAnchor: Cell;
	readonly side: RailModuleSide | null;
}

export interface StaticFabAssemblyConnectorMetadata {
	readonly version: typeof STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION;
	readonly hierarchyRole: StaticFabAssemblyConnectorHierarchyRole | null;
	readonly purpose: StaticFabAssemblyConnectorPurpose | null;
	readonly sourceOrganizationId: number;
	readonly sourceGatewayId: string;
	readonly sourceAnchor: Cell;
	readonly targetOrganizationId: number;
	readonly targetGatewayId: string;
	readonly targetAnchor: Cell;
	readonly requestedSide: RailModuleSide | null;
	readonly bankOrganizationId: number | null;
	readonly fabOrganizationId: number | null;
	readonly createdBank: boolean;
	readonly createdFab: boolean;
	readonly outboundLengthMeters: number;
	readonly returnLengthMeters: number;
	readonly issueCode: StaticFabAssemblyConnectorIssueCode | null;
}

export type StaticFabAssemblyConnectorPlan = RailNetworkLinkPlan & {
	readonly basePatchSequence: number;
	readonly organizationImpactAuthorizations: readonly number[];
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly nextOrganizationIdBefore: number;
	readonly nextOrganizationIdAfter: number;
	readonly assemblyConnector: StaticFabAssemblyConnectorMetadata;
};

export interface StaticFabAssemblyConnectorProspectiveState {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface StaticFabAssemblyConnectorPlanningResult {
	readonly plan: StaticFabAssemblyConnectorPlan;
	readonly prospectiveState: StaticFabAssemblyConnectorProspectiveState | null;
}

export type StaticFabAssemblyConnectorHierarchyEligibility = Readonly<
	| {
			valid: true;
			issueCode: null;
			reason: string;
			purpose: StaticFabAssemblyConnectorPurpose;
	  }
	| {
			valid: false;
			issueCode: Extract<
				StaticFabAssemblyConnectorIssueCode,
				| "MISSING_ORGANIZATION"
				| "SAME_ORGANIZATION"
				| "UNSUPPORTED_ORGANIZATION"
				| "DIFFERENT_BANKS"
				| "DIFFERENT_FABS"
				| "HIERARCHY_INVALID"
			>;
			reason: string;
	  }
>;

const STATIC_FAB_ASSEMBLY_GATEWAY_ID_MAXIMUM_LENGTH = 512;

export function staticFabAssemblyConnectorIntentError(value: unknown): string | null {
	if (!isRecord(value)) return "Assembly Connector intent must be an object";
	if (value.version !== STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION) {
		return "Assembly Connector intent version is invalid";
	}
	if (value.purpose !== "HIERARCHY_LINK" && value.purpose !== "FAB_LOOP") {
		return "Assembly Connector purpose is invalid";
	}
	if (!positiveInt32(value.sourceOrganizationId) || !positiveInt32(value.targetOrganizationId)) {
		return "Assembly Connector organization IDs are invalid";
	}
	if (!boundedGatewayId(value.sourceGatewayId) || !boundedGatewayId(value.targetGatewayId)) {
		return "Assembly Connector gateway IDs are invalid";
	}
	if (!validCell(value.sourceAnchor) || !validCell(value.targetAnchor)) {
		return "Assembly Connector anchors are invalid";
	}
	if (value.side !== null && value.side !== "left" && value.side !== "right") {
		return "Assembly Connector side is invalid";
	}
	return null;
}

interface DirectedRunAccumulator {
	readonly forward: Direction;
	readonly axis: "x" | "y";
	readonly fixedCoordinate: number;
	readonly unitCoordinates: number[];
}

/**
 * Discover bounded, deterministic gateway handles from direct organization rail ownership.
 * Process Loop and raw AREA rails are deliberately excluded: only canonical Bays and Bay Banks
 * may become child endpoints of the reviewed hierarchy connector.
 */
export function discoverStaticFabAssemblyGateways(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	organizationId: number,
	limit = STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT,
): readonly StaticFabAssemblyGatewayCandidate[] {
	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT) {
		throw new RangeError(
			`Assembly gateway limit must be a 1-${STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT} integer.`,
		);
	}
	const organization = organizations.records.find((record) => record.id === organizationId);
	if (!organization) return Object.freeze([]);
	const role = deriveStaticFabOrganizationSemanticRoles(organizations).get(organizationId);
	if (role !== "BAY" && role !== "BAY_BANK") {
		return Object.freeze([]);
	}
	return discoverGatewaysFromEdges(map, organizationId, organization.membership.railEdges, limit);
}

/**
 * Discover Fab-loop endpoints from direct Bay rail below one selected Bank. The candidate remains
 * bound to the Bank selection while its physical junction lands on a child Bay module, avoiding
 * reuse of the Bank connector module already transferred to the parent Fab by the first Interbay.
 */
export function discoverStaticFabOuterCirculationGateways(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	bankOrganizationId: number,
	limit = STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT,
): readonly StaticFabAssemblyGatewayCandidate[] {
	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT) {
		throw new RangeError(
			`Assembly gateway limit must be a 1-${STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT} integer.`,
		);
	}
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	if (roles.get(bankOrganizationId) !== "BAY_BANK") return Object.freeze([]);
	const bays = semanticBayDescendants(organizations, roles, bankOrganizationId);
	return discoverGatewaysFromEdges(
		map,
		bankOrganizationId,
		bays.flatMap((bay) => bay.membership.railEdges),
		limit,
	);
}

function discoverGatewaysFromEdges(
	map: TileMap,
	organizationId: number,
	railEdges: readonly DirectedRailEdge[],
	limit: number,
): readonly StaticFabAssemblyGatewayCandidate[] {
	const runsByKey = new Map<string, DirectedRunAccumulator>();
	for (const edge of railEdges) {
		const forward = directionBetween(edge.from, edge.to);
		if (forward === null) continue;
		const horizontal = edge.from.y === edge.to.y;
		const axis = horizontal ? "x" : "y";
		const fixedCoordinate = horizontal ? edge.from.y : edge.from.x;
		const unitCoordinate = horizontal
			? Math.min(edge.from.x, edge.to.x)
			: Math.min(edge.from.y, edge.to.y);
		const key = `${forward}:${axis}:${fixedCoordinate}`;
		const run = runsByKey.get(key);
		if (run) run.unitCoordinates.push(unitCoordinate);
		else {
			runsByKey.set(key, {
				forward,
				axis,
				fixedCoordinate,
				unitCoordinates: [unitCoordinate],
			});
		}
	}

	const candidates: StaticFabAssemblyGatewayCandidate[] = [];
	for (const run of runsByKey.values()) {
		const units = [...new Set(run.unitCoordinates)].sort((left, right) => left - right);
		let startIndex = 0;
		while (startIndex < units.length) {
			let endIndex = startIndex;
			while (
				endIndex + 1 < units.length &&
				(units[endIndex + 1] as number) === (units[endIndex] as number) + 1
			) {
				endIndex++;
			}
			const minimum = units[startIndex] as number;
			const maximum = units[endIndex] as number;
			const runLengthMeters = maximum - minimum + 1;
			if (runLengthMeters >= STATIC_FAB_ASSEMBLY_GATEWAY_MINIMUM_RUN_METERS) {
				const descriptor = gatewayCandidate(organizationId, run, minimum, maximum);
				if (map.hasRail(descriptor.anchor.x, descriptor.anchor.y)) candidates.push(descriptor);
			}
			startIndex = endIndex + 1;
		}
	}
	return Object.freeze(candidates.sort(compareGatewayCandidates).slice(0, limit));
}

/**
 * Derive a framing envelope from the selected organizations' persisted rail membership only.
 * Connector launch must not scan the full ownership index just to move the camera.
 */
export function staticFabAssemblyConnectorSelectionBounds(
	organizations: StaticFabOrganizationState,
	organizationIds: readonly number[],
): StaticFabAssemblyConnectorSelectionBounds | null {
	const selectedIds = new Set(organizationIds);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const organization of organizations.records) {
		if (!selectedIds.has(organization.id)) continue;
		for (const edge of organization.membership.railEdges) {
			minX = Math.min(minX, edge.from.x, edge.to.x);
			minY = Math.min(minY, edge.from.y, edge.to.y);
			maxX = Math.max(maxX, edge.from.x, edge.to.x);
			maxY = Math.max(maxY, edge.from.y, edge.to.y);
		}
	}
	return Number.isFinite(minX) ? Object.freeze({ minX, minY, maxX, maxY }) : null;
}

/**
 * Cheap selection-time wrapper over the same hierarchy resolver used by the exact Worker planner.
 * Geometry, route, clearance, and existing-network conflicts remain Worker-certified later.
 */
export function staticFabAssemblyConnectorHierarchyEligibility(
	organizations: StaticFabOrganizationState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
): StaticFabAssemblyConnectorHierarchyEligibility {
	return hierarchyEligibility(organizations, sourceOrganizationId, targetOrganizationId, "BAY");
}

/** Selection-time gate for the typed Bank-to-Fab Interbay connector. */
export function staticFabAssemblyInterbayConnectorHierarchyEligibility(
	organizations: StaticFabOrganizationState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
): StaticFabAssemblyConnectorHierarchyEligibility {
	return hierarchyEligibility(
		organizations,
		sourceOrganizationId,
		targetOrganizationId,
		"BAY_BANK",
	);
}

function hierarchyEligibility(
	organizations: StaticFabOrganizationState,
	sourceOrganizationId: number,
	targetOrganizationId: number,
	expectedRole: "BAY" | "BAY_BANK",
): StaticFabAssemblyConnectorHierarchyEligibility {
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const source = recordsById.get(sourceOrganizationId);
	const target = recordsById.get(targetOrganizationId);
	if (!source || !target) {
		return Object.freeze({
			valid: false,
			issueCode: "MISSING_ORGANIZATION" as const,
			reason: "선택한 Production Bay 조직을 찾을 수 없습니다",
		});
	}
	if (source.id === target.id) {
		return Object.freeze({
			valid: false,
			issueCode: "SAME_ORGANIZATION" as const,
			reason: "서로 다른 두 Production Bay를 선택하세요",
		});
	}
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	if (roles.get(source.id) !== expectedRole || roles.get(target.id) !== expectedRole) {
		return Object.freeze({
			valid: false,
			issueCode: "UNSUPPORTED_ORGANIZATION" as const,
			reason:
				expectedRole === "BAY"
					? "현재 Bay Connector는 Production Bay 두 개를 연결합니다"
					: "현재 Interbay Connector는 Bay Bank 두 개를 연결합니다",
		});
	}
	const parent = resolveAssemblyParent(organizations, roles, source, target, expectedRole);
	return parent.valid
		? Object.freeze({
				valid: true,
				issueCode: null,
				reason: parent.reason,
				purpose:
					expectedRole === "BAY_BANK" && parent.childrenShareParent
						? ("FAB_LOOP" as const)
						: ("HIERARCHY_LINK" as const),
			})
		: Object.freeze({
				valid: false,
				issueCode: parent.issueCode,
				reason: parent.reason,
			});
}

export function planStaticFabAssemblyConnector(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
): StaticFabAssemblyConnectorPlan {
	return planStaticFabAssemblyConnectorWithProspectiveState(
		map,
		portEquipment,
		basePatchSequence,
		organizations,
		intent,
	).plan;
}

/** Worker-oriented path retaining exact prospective authored truth for certification. */
export function planStaticFabAssemblyConnectorWithProspectiveState(
	map: TileMap,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
): StaticFabAssemblyConnectorPlanningResult {
	const intentError = staticFabAssemblyConnectorIntentError(intent);
	if (intentError) {
		const diagnosticIntent = safeDiagnosticIntent(intent);
		return rejected(
			invalidNetworkLinkPlan(map, diagnosticIntent, intentError),
			basePatchSequence,
			organizations,
			diagnosticIntent,
			"INVALID_SOURCE",
			intentError,
		);
	}
	const fallback = invalidNetworkLinkPlan(map, intent, "Assembly Connector validation is pending");
	const sourceError = staticFabOrganizationStateError(map, portEquipment, organizations);
	if (sourceError) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"INVALID_SOURCE",
			`정적 FAB 조직 상태가 유효하지 않습니다 · ${sourceError}`,
		);
	}
	if (!Number.isSafeInteger(basePatchSequence) || basePatchSequence < 0) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"STALE_SOURCE",
			"Assembly Connector 편집 순서가 유효하지 않습니다",
		);
	}
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const source = recordsById.get(intent.sourceOrganizationId);
	const target = recordsById.get(intent.targetOrganizationId);
	if (!source || !target) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"MISSING_ORGANIZATION",
			"선택한 Production Bay 조직을 찾을 수 없습니다",
		);
	}
	if (source.id === target.id) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"SAME_ORGANIZATION",
			"서로 다른 두 Production Bay를 선택하세요",
		);
	}
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const sourceRole = roles.get(source.id);
	const targetRole = roles.get(target.id);
	const hierarchyRole: StaticFabAssemblyConnectorHierarchyRole | null =
		sourceRole === "BAY" && targetRole === "BAY"
			? "BAY_TO_BANK"
			: sourceRole === "BAY_BANK" && targetRole === "BAY_BANK"
				? "BANK_TO_FAB"
				: null;
	if (hierarchyRole === null) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"UNSUPPORTED_ORGANIZATION",
			"Assembly Connector는 Production Bay 두 개 또는 Bay Bank 두 개를 같은 계층에서 연결합니다",
		);
	}
	if (intent.purpose === "FAB_LOOP" && hierarchyRole !== "BANK_TO_FAB") {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"HIERARCHY_INVALID",
			"Fab Loop는 같은 Fab에 속한 Bay Bank 두 개에서만 만들 수 있습니다",
		);
	}
	const discoverGateways =
		intent.purpose === "FAB_LOOP"
			? discoverStaticFabOuterCirculationGateways
			: discoverStaticFabAssemblyGateways;
	const sourceGateway = discoverGateways(map, organizations, source.id).find(
		(candidate) => candidate.id === intent.sourceGatewayId,
	);
	const targetGateway = discoverGateways(map, organizations, target.id).find(
		(candidate) => candidate.id === intent.targetGatewayId,
	);
	if (
		!sourceGateway ||
		sourceGateway.anchor.x !== intent.sourceAnchor.x ||
		sourceGateway.anchor.y !== intent.sourceAnchor.y
	) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"ANCHOR_OUTSIDE_ORGANIZATION",
			`선택한 출발 gateway가 현재 ${hierarchyChildLabel(hierarchyRole)} 직접 소유 레일과 일치하지 않습니다`,
		);
	}
	if (
		!targetGateway ||
		targetGateway.anchor.x !== intent.targetAnchor.x ||
		targetGateway.anchor.y !== intent.targetAnchor.y
	) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"ANCHOR_OUTSIDE_ORGANIZATION",
			`선택한 도착 gateway가 현재 ${hierarchyChildLabel(hierarchyRole)} 직접 소유 레일과 일치하지 않습니다`,
		);
	}

	const ownership = organizationCellOwnership(organizations);
	const sourceGatewayOwnership = assemblyGatewayOwnership(
		organizations,
		roles,
		source,
		intent.purpose,
		recordsById,
	);
	const targetGatewayOwnership = assemblyGatewayOwnership(
		organizations,
		roles,
		target,
		intent.purpose,
		recordsById,
	);
	const anchorError = anchorOwnershipError(
		source,
		intent.sourceAnchor,
		ownership,
		sourceGatewayOwnership,
	);
	if (anchorError) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			anchorError.code,
			anchorError.reason,
		);
	}
	const targetAnchorError = anchorOwnershipError(
		target,
		intent.targetAnchor,
		ownership,
		targetGatewayOwnership,
	);
	if (targetAnchorError) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			targetAnchorError.code,
			targetAnchorError.reason,
		);
	}

	const parentResolution = resolveAssemblyParent(
		organizations,
		roles,
		source,
		target,
		hierarchyRole === "BAY_TO_BANK" ? "BAY" : "BAY_BANK",
	);
	if (!parentResolution.valid) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			parentResolution.issueCode,
			parentResolution.reason,
		);
	}
	if (intent.purpose === "FAB_LOOP" && !parentResolution.childrenShareParent) {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"HIERARCHY_INVALID",
			"두 Bay Bank를 먼저 typed Interbay로 하나의 Fab에 연결하세요",
		);
	}
	const sourceCells = sourceGatewayOwnership.cells;
	const targetCells = targetGatewayOwnership.cells;
	const context = createRailNetworkLinkAnchorContext(
		map,
		intent.sourceAnchor,
		null,
		(plan) => connectorJunctionsBelongTo(plan, sourceCells, targetCells),
		{
			allowSameComponent: intent.purpose === "FAB_LOOP",
			maximumGapMeters: STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS,
			restrictToSelectedRuns: true,
		},
	);
	const sameComponent = context.containsSourceCell(intent.targetAnchor);
	if (sameComponent && intent.purpose !== "FAB_LOOP") {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"ALREADY_CONNECTED",
			alreadyConnectedReason(hierarchyRole),
		);
	}
	if (!sameComponent && intent.purpose === "FAB_LOOP") {
		return rejected(
			fallback,
			basePatchSequence,
			organizations,
			intent,
			"HIERARCHY_INVALID",
			"Fab Loop를 추가하기 전에 두 Bank의 기존 Interbay 순환망을 복구하세요",
		);
	}
	const purpose = intent.purpose;

	const networkLink = planRailNetworkLink(map, context, intent.targetAnchor, intent.side);
	if (!networkLink.valid) {
		return rejected(
			networkLink,
			basePatchSequence,
			organizations,
			intent,
			"ROUTE_INVALID",
			assemblyConnectorRouteReason(networkLink, hierarchyRole, purpose),
		);
	}
	if ((networkLink.switchMutations?.length ?? 0) !== 0) {
		return rejected(
			networkLink,
			basePatchSequence,
			organizations,
			intent,
			"ROUTE_INVALID",
			"Assembly Connector는 고급 스위치 sidecar를 암묵적으로 변경할 수 없습니다",
		);
	}

	try {
		const prospectiveMap = map.clone();
		if (
			!prospectiveMap.applyAtomicMutations(networkLink.mutations, networkLink.switchMutations ?? [])
		) {
			throw new Error("Assembly Connector mutation이 현재 레일 상태와 일치하지 않습니다");
		}
		const addedEdges = addedDirectedEdges(networkLink);
		const impactIndex = new StaticFabOrganizationImpactIndex();
		impactIndex.synchronize(organizations);
		const organizationImpactAuthorizations = Object.freeze(
			staticFabOrganizationImpactsForPatch(
				impactIndex,
				networkLink.mutations,
				networkLink.switchMutations ?? [],
				[],
				[],
				portEquipment,
				portEquipment,
			).map((owner) => owner.organizationId),
		);
		if (organizationImpactAuthorizations.length === 0) {
			throw new Error("Assembly Connector가 보호된 gateway 조직에 닿지 않습니다");
		}
		const organizationPlan = planConnectorOrganizations(
			prospectiveMap,
			organizations,
			source,
			target,
			parentResolution.parent,
			parentResolution.parentParentOrganizationIds,
			parentResolution.replacedChildParentIds,
			hierarchyRole,
			addedEdges,
		);
		const prospectiveOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			organizationPlan.mutations,
			organizationPlan.nextOrganizationId,
			true,
		);
		const organizationError = staticFabOrganizationStateError(
			prospectiveMap,
			portEquipment,
			prospectiveOrganizations,
		);
		if (organizationError) {
			return rejected(
				networkLink,
				basePatchSequence,
				organizations,
				intent,
				"ORGANIZATION_INVALID",
				`Assembly Connector 조직 귀속을 검증할 수 없습니다 · ${organizationError}`,
			);
		}
		if (
			purpose === "FAB_LOOP" &&
			!staticFabBankPairHasResilientCirculation(
				prospectiveOrganizations,
				organizationPlan.parentOrganizationId,
				source.id,
				target.id,
			)
		) {
			return rejected(
				networkLink,
				basePatchSequence,
				organizations,
				intent,
				"ROUTE_INVALID",
				"Fab Loop는 두 Bank 사이에 독립적인 outbound·return 경로를 하나씩 추가해야 합니다",
			);
		}

		const plan = Object.freeze({
			...networkLink,
			switchMutations: Object.freeze([]),
			basePatchSequence,
			organizationImpactAuthorizations,
			organizationMutations: organizationPlan.mutations,
			nextOrganizationIdBefore: organizations.nextOrganizationId,
			nextOrganizationIdAfter: organizationPlan.nextOrganizationId,
			assemblyConnector: connectorMetadata(intent, {
				hierarchyRole,
				purpose,
				bankOrganizationId:
					hierarchyRole === "BAY_TO_BANK" ? organizationPlan.parentOrganizationId : null,
				fabOrganizationId:
					hierarchyRole === "BANK_TO_FAB" ? organizationPlan.parentOrganizationId : null,
				createdBank: hierarchyRole === "BAY_TO_BANK" && parentResolution.parent === null,
				createdFab: hierarchyRole === "BANK_TO_FAB" && parentResolution.parent === null,
				outboundLengthMeters: Math.max(0, networkLink.networkLink.outboundCells.length - 1),
				returnLengthMeters: Math.max(0, networkLink.networkLink.returnCells.length - 1),
				issueCode: null,
			}),
		}) satisfies StaticFabAssemblyConnectorPlan;
		return Object.freeze({
			plan,
			prospectiveState: Object.freeze({
				map: prospectiveMap,
				portEquipment,
				organizations: prospectiveOrganizations,
			}),
		});
	} catch (error) {
		return rejected(
			networkLink,
			basePatchSequence,
			organizations,
			intent,
			"ORGANIZATION_INVALID",
			error instanceof Error ? error.message : "Assembly Connector 조직 계획에 실패했습니다",
		);
	}
}

function assemblyConnectorRouteReason(
	networkLink: RailNetworkLinkPlan,
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	purpose: StaticFabAssemblyConnectorPurpose,
): string {
	const childLabel = hierarchyChildLabel(hierarchyRole);
	switch (networkLink.networkLink.placementCode) {
		case "same-component":
			return purpose === "FAB_LOOP"
				? "같은 Fab 안에서 두 번째 순환 경로를 만들 수 있는 다른 Bank gateway를 선택하세요"
				: alreadyConnectedReason(hierarchyRole);
		case "target-not-closed":
			return `도착 ${childLabel}의 직접 소유 레일을 먼저 닫힌 단방향 네트워크로 완성하세요`;
		case "target-not-rail":
			return `도착 gateway가 현재 ${childLabel} 직접 소유 레일과 일치하지 않습니다`;
		case "excessive-gap":
			return `두 ${childLabel}의 gateway 간격이 ${STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS} m를 넘습니다 · 배치를 더 가깝게 조정하세요`;
		default:
			return networkLink.reason;
	}
}

function hierarchyChildLabel(role: StaticFabAssemblyConnectorHierarchyRole): string {
	return role === "BAY_TO_BANK" ? "Production Bay" : "Bay Bank";
}

function alreadyConnectedReason(role: StaticFabAssemblyConnectorHierarchyRole): string {
	return `두 ${hierarchyChildLabel(role)}는 이미 같은 FAB 순환망에 연결되어 있습니다 · 중복 조립 연결은 만들지 않습니다`;
}

function safeDiagnosticIntent(value: unknown): StaticFabAssemblyConnectorIntent {
	const record = isRecord(value) ? value : {};
	return Object.freeze({
		version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
		purpose:
			record.purpose === "HIERARCHY_LINK" || record.purpose === "FAB_LOOP"
				? record.purpose
				: "HIERARCHY_LINK",
		sourceOrganizationId: positiveInt32(record.sourceOrganizationId)
			? record.sourceOrganizationId
			: 1,
		sourceGatewayId: boundedGatewayId(record.sourceGatewayId)
			? record.sourceGatewayId
			: "invalid-source-gateway",
		sourceAnchor: validCell(record.sourceAnchor)
			? Object.freeze({ x: record.sourceAnchor.x, y: record.sourceAnchor.y })
			: Object.freeze({ x: 0, y: 0 }),
		targetOrganizationId: positiveInt32(record.targetOrganizationId)
			? record.targetOrganizationId
			: 1,
		targetGatewayId: boundedGatewayId(record.targetGatewayId)
			? record.targetGatewayId
			: "invalid-target-gateway",
		targetAnchor: validCell(record.targetAnchor)
			? Object.freeze({ x: record.targetAnchor.x, y: record.targetAnchor.y })
			: Object.freeze({ x: 0, y: 0 }),
		side: record.side === "left" || record.side === "right" ? record.side : null,
	});
}

function invalidNetworkLinkPlan(
	map: TileMap,
	intent: StaticFabAssemblyConnectorIntent,
	reason: string,
): RailNetworkLinkPlan {
	const metadata: RailNetworkLinkMetadata = Object.freeze({
		version: 1,
		placementCode: "stale",
		sourceAnchor: intent.sourceAnchor,
		targetAnchor: intent.targetAnchor,
		sourceForward: null,
		targetForward: null,
		side: intent.side,
		junctionSpacingMeters: RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
		sourceComponentCellCount: 0,
		targetComponentCellCount: 0,
		sourceDeparture: null,
		sourceArrival: null,
		targetArrival: null,
		targetDeparture: null,
		outboundCells: Object.freeze([]),
		returnCells: Object.freeze([]),
	});
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze([intent.sourceAnchor, intent.targetAnchor]),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		valid: false,
		reason,
		issueCode: "topology",
		conflicts: Object.freeze([]),
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		networkLink: metadata,
	});
}

function boundedGatewayId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= STATIC_FAB_ASSEMBLY_GATEWAY_ID_MAXIMUM_LENGTH
	);
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function validCell(value: unknown): value is Cell {
	return (
		isRecord(value) &&
		Number.isInteger(value.x) &&
		(value.x as number) >= -0x8000_0000 &&
		(value.x as number) <= 0x7fff_ffff &&
		Number.isInteger(value.y) &&
		(value.y as number) >= -0x8000_0000 &&
		(value.y as number) <= 0x7fff_ffff
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function gatewayCandidate(
	organizationId: number,
	run: DirectedRunAccumulator,
	minimum: number,
	maximum: number,
): StaticFabAssemblyGatewayCandidate {
	const positive = run.forward === DIR_E || run.forward === DIR_S;
	const startCoordinate = positive ? minimum : maximum + 1;
	const endCoordinate = positive ? maximum + 1 : minimum;
	const anchorCoordinate = Math.floor((minimum + maximum + 1) / 2);
	const cell = (coordinate: number): Cell =>
		Object.freeze(
			run.axis === "x"
				? { x: coordinate, y: run.fixedCoordinate }
				: { x: run.fixedCoordinate, y: coordinate },
		);
	return Object.freeze({
		id: `${organizationId}:${run.forward}:${run.axis}:${run.fixedCoordinate}:${minimum}:${maximum}`,
		organizationId,
		anchor: cell(anchorCoordinate),
		start: cell(startCoordinate),
		end: cell(endCoordinate),
		forward: run.forward,
		axis: run.axis,
		runLengthMeters: maximum - minimum + 1,
	});
}

function compareGatewayCandidates(
	left: StaticFabAssemblyGatewayCandidate,
	right: StaticFabAssemblyGatewayCandidate,
): number {
	return (
		right.runLengthMeters - left.runLengthMeters ||
		left.anchor.y - right.anchor.y ||
		left.anchor.x - right.anchor.x ||
		left.forward - right.forward
	);
}

function organizationCellOwnership(
	organizations: StaticFabOrganizationState,
): ReadonlyMap<string, ReadonlySet<number>> {
	const mutable = new Map<string, Set<number>>();
	for (const record of organizations.records) {
		for (const edge of record.membership.railEdges) {
			for (const cell of [edge.from, edge.to]) {
				const key = cellKey(cell.x, cell.y);
				const owners = mutable.get(key);
				if (owners) owners.add(record.id);
				else mutable.set(key, new Set([record.id]));
			}
		}
	}
	return mutable;
}

interface StaticFabAssemblyGatewayOwnership {
	readonly cells: ReadonlySet<string>;
	readonly allowedOwnerIds: ReadonlySet<number>;
}

function assemblyGatewayOwnership(
	organizations: StaticFabOrganizationState,
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	organization: StaticFabOrganizationRecord,
	purpose: StaticFabAssemblyConnectorPurpose,
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
): StaticFabAssemblyGatewayOwnership {
	const allowedOwnerIds = new Set(staticFabOrganizationAncestorIds(organization, recordsById));
	if (purpose !== "FAB_LOOP") {
		return Object.freeze({
			cells: directMembershipCells(organization.membership),
			allowedOwnerIds,
		});
	}
	const cells = new Set<string>();
	for (const bay of semanticBayDescendants(organizations, roles, organization.id)) {
		allowedOwnerIds.add(bay.id);
		for (const cell of directMembershipCells(bay.membership)) cells.add(cell);
	}
	return Object.freeze({ cells, allowedOwnerIds });
}

function anchorOwnershipError(
	organization: StaticFabOrganizationRecord,
	anchor: Cell,
	ownership: ReadonlyMap<string, ReadonlySet<number>>,
	gatewayOwnership: StaticFabAssemblyGatewayOwnership,
): Readonly<{
	code: "ANCHOR_OUTSIDE_ORGANIZATION" | "AMBIGUOUS_GATEWAY_OWNERSHIP";
	reason: string;
}> | null {
	const owners = ownership.get(cellKey(anchor.x, anchor.y));
	if (!gatewayOwnership.cells.has(cellKey(anchor.x, anchor.y))) {
		return Object.freeze({
			code: "ANCHOR_OUTSIDE_ORGANIZATION" as const,
			reason: `${organization.name}의 허용된 직접/하위 Bay 레일에서 gateway를 선택하세요`,
		});
	}
	if (!owners || [...owners].some((ownerId) => !gatewayOwnership.allowedOwnerIds.has(ownerId))) {
		return Object.freeze({
			code: "AMBIGUOUS_GATEWAY_OWNERSHIP" as const,
			reason:
				"다른 Bay, Process Loop 또는 무관한 조직과 겹치는 레일은 Assembly gateway로 사용할 수 없습니다",
		});
	}
	return null;
}

function staticFabOrganizationAncestorIds(
	organization: StaticFabOrganizationRecord,
	recordsById: ReadonlyMap<number, StaticFabOrganizationRecord>,
): ReadonlySet<number> {
	const ancestorIds = new Set<number>([organization.id]);
	const pending = [...staticFabOrganizationParentIds(organization)];
	while (pending.length > 0) {
		const parentId = pending.pop();
		if (parentId === undefined || ancestorIds.has(parentId)) continue;
		ancestorIds.add(parentId);
		const parent = recordsById.get(parentId);
		if (parent) pending.push(...staticFabOrganizationParentIds(parent));
	}
	return ancestorIds;
}

function semanticBayDescendants(
	organizations: StaticFabOrganizationState,
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	rootId: number,
): readonly StaticFabOrganizationRecord[] {
	const childrenByParentId = new Map<number, StaticFabOrganizationRecord[]>();
	for (const record of organizations.records) {
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const children = childrenByParentId.get(parentId);
			if (children) children.push(record);
			else childrenByParentId.set(parentId, [record]);
		}
	}
	const result: StaticFabOrganizationRecord[] = [];
	const visited = new Set<number>();
	const pending = [rootId];
	while (pending.length > 0) {
		const id = pending.pop();
		if (id === undefined || visited.has(id)) continue;
		visited.add(id);
		for (const child of childrenByParentId.get(id) ?? []) {
			if (roles.get(child.id) === "BAY") result.push(child);
			pending.push(child.id);
		}
	}
	return Object.freeze(result.sort((left, right) => left.id - right.id));
}

function directMembershipCells(membership: StaticFabOrganizationMembership): ReadonlySet<string> {
	const cells = new Set<string>();
	for (const edge of membership.railEdges) {
		cells.add(cellKey(edge.from.x, edge.from.y));
		cells.add(cellKey(edge.to.x, edge.to.y));
	}
	return cells;
}

function connectorJunctionsBelongTo(
	plan: RailNetworkLinkPlan,
	sourceCells: ReadonlySet<string>,
	targetCells: ReadonlySet<string>,
): boolean {
	const link = plan.networkLink;
	return (
		link.sourceDeparture !== null &&
		link.sourceArrival !== null &&
		link.targetArrival !== null &&
		link.targetDeparture !== null &&
		sourceCells.has(cellKey(link.sourceDeparture.x, link.sourceDeparture.y)) &&
		sourceCells.has(cellKey(link.sourceArrival.x, link.sourceArrival.y)) &&
		targetCells.has(cellKey(link.targetArrival.x, link.targetArrival.y)) &&
		targetCells.has(cellKey(link.targetDeparture.x, link.targetDeparture.y))
	);
}

interface StaticFabAssemblyParentResolution {
	readonly valid: true;
	readonly parent: StaticFabOrganizationRecord | null;
	readonly childrenShareParent: boolean;
	readonly parentParentOrganizationIds: readonly number[];
	readonly replacedChildParentIds: readonly number[];
	readonly reason: string;
}

interface StaticFabAssemblyParentRejection {
	readonly valid: false;
	readonly parent: null;
	readonly issueCode: "DIFFERENT_BANKS" | "DIFFERENT_FABS" | "HIERARCHY_INVALID";
	readonly reason: string;
}

function resolveAssemblyParent(
	organizations: StaticFabOrganizationState,
	roles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	source: StaticFabOrganizationRecord,
	target: StaticFabOrganizationRecord,
	childRole: "BAY" | "BAY_BANK",
): Readonly<StaticFabAssemblyParentResolution | StaticFabAssemblyParentRejection> {
	const parentRole: StaticFabOrganizationSemanticRole = childRole === "BAY" ? "BAY_BANK" : "FAB";
	const childLabel = childRole === "BAY" ? "Bay" : "Bay Bank";
	const parentLabel = parentRole === "BAY_BANK" ? "Bay Bank" : "Fab";
	const differentIssueCode =
		parentRole === "BAY_BANK" ? ("DIFFERENT_BANKS" as const) : ("DIFFERENT_FABS" as const);
	const recordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const parents = (record: StaticFabOrganizationRecord): readonly StaticFabOrganizationRecord[] =>
		staticFabOrganizationParentIds(record)
			.map((id) => recordsById.get(id))
			.filter(
				(candidate): candidate is StaticFabOrganizationRecord =>
					candidate !== undefined && roles.get(candidate.id) === parentRole,
			);
	const sourceParents = parents(source);
	const targetParents = parents(target);
	const nonSemanticParents = (record: StaticFabOrganizationRecord): readonly number[] =>
		Object.freeze(
			staticFabOrganizationParentIds(record).filter((id) => roles.get(id) !== parentRole),
		);
	if (sourceParents.length === 0 && targetParents.length === 0) {
		const sourceOtherParents = nonSemanticParents(source);
		const targetOtherParents = nonSemanticParents(target);
		if (
			sourceOtherParents.length > 0 &&
			targetOtherParents.length > 0 &&
			!numberListEquals(sourceOtherParents, targetOtherParents)
		) {
			return Object.freeze({
				valid: false,
				parent: null,
				issueCode: "HIERARCHY_INVALID",
				reason: `서로 다른 상위 계층에 속한 ${childLabel}는 하나의 ${parentLabel}로 묶을 수 없습니다`,
			});
		}
		const parentParentOrganizationIds =
			sourceOtherParents.length > 0 ? sourceOtherParents : targetOtherParents;
		return Object.freeze({
			valid: true,
			parent: null,
			childrenShareParent: false,
			parentParentOrganizationIds,
			replacedChildParentIds: parentParentOrganizationIds,
			reason: `새 ${parentLabel}를 생성합니다`,
		});
	}
	if (
		sourceParents.length === 1 &&
		targetParents.length === 1 &&
		sourceParents[0]?.id === targetParents[0]?.id
	) {
		const parent = sourceParents[0] as StaticFabOrganizationRecord;
		const parentParents = staticFabOrganizationParentIds(parent);
		const sourceOtherParents = nonSemanticParents(source);
		const targetOtherParents = nonSemanticParents(target);
		if (
			(sourceOtherParents.length > 0 && !numberListEquals(sourceOtherParents, parentParents)) ||
			(targetOtherParents.length > 0 && !numberListEquals(targetOtherParents, parentParents))
		) {
			return Object.freeze({
				valid: false,
				parent: null,
				issueCode: "HIERARCHY_INVALID",
				reason: `${childLabel}의 상위 계층이 공유 ${parentLabel}의 상위 계층과 다릅니다`,
			});
		}
		return Object.freeze({
			valid: true,
			parent,
			childrenShareParent: true,
			parentParentOrganizationIds: parentParents,
			replacedChildParentIds: parentParents,
			reason: `기존 ${parentLabel} connector를 확장합니다`,
		});
	}
	if (sourceParents.length === 1 && targetParents.length === 0) {
		const parent = sourceParents[0] as StaticFabOrganizationRecord;
		const parentParents = staticFabOrganizationParentIds(parent);
		const sourceOtherParents = nonSemanticParents(source);
		const targetOtherParents = nonSemanticParents(target);
		if (
			(sourceOtherParents.length > 0 && !numberListEquals(sourceOtherParents, parentParents)) ||
			(targetOtherParents.length > 0 && !numberListEquals(targetOtherParents, parentParents))
		) {
			return Object.freeze({
				valid: false,
				parent: null,
				issueCode: "HIERARCHY_INVALID",
				reason: `${childLabel}의 상위 계층이 선택한 ${parentLabel}의 상위 계층과 다릅니다`,
			});
		}
		return Object.freeze({
			valid: true,
			parent,
			childrenShareParent: false,
			parentParentOrganizationIds: parentParents,
			replacedChildParentIds: parentParents,
			reason: `기존 ${parentLabel}에 독립 ${childLabel}를 연결합니다`,
		});
	}
	if (sourceParents.length === 0 && targetParents.length === 1) {
		const parent = targetParents[0] as StaticFabOrganizationRecord;
		const parentParents = staticFabOrganizationParentIds(parent);
		const sourceOtherParents = nonSemanticParents(source);
		const targetOtherParents = nonSemanticParents(target);
		if (
			(sourceOtherParents.length > 0 && !numberListEquals(sourceOtherParents, parentParents)) ||
			(targetOtherParents.length > 0 && !numberListEquals(targetOtherParents, parentParents))
		) {
			return Object.freeze({
				valid: false,
				parent: null,
				issueCode: "HIERARCHY_INVALID",
				reason: `${childLabel}의 상위 계층이 선택한 ${parentLabel}의 상위 계층과 다릅니다`,
			});
		}
		return Object.freeze({
			valid: true,
			parent,
			childrenShareParent: false,
			parentParentOrganizationIds: parentParents,
			replacedChildParentIds: parentParents,
			reason: `독립 ${childLabel}를 기존 ${parentLabel}에 연결합니다`,
		});
	}
	return Object.freeze({
		valid: false,
		parent: null,
		issueCode: differentIssueCode,
		reason:
			parentRole === "BAY_BANK"
				? "서로 다른 두 Bay Bank의 Bay를 직접 합칠 수 없습니다 · Bank/FAB connector인 CONNECT BANKS를 사용하세요"
				: "서로 다른 두 Fab의 Bank를 직접 합칠 수 없습니다 · Fab-to-Fab bridge는 아직 지원하지 않습니다",
	});
}

function addedDirectedEdges(plan: RailNetworkLinkPlan): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const mutation of plan.mutations) {
		const before = decodeRailCell(mutation.before);
		const after = decodeRailCell(mutation.after);
		for (const direction of ALL_DIRECTIONS) {
			if ((before.outgoing & direction) !== 0 || (after.outgoing & direction) === 0) continue;
			const edge = Object.freeze({
				from: Object.freeze({ x: mutation.x, y: mutation.y }),
				to: Object.freeze(moveCell(mutation, direction)),
			});
			edges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
	}
	return Object.freeze([...edges.values()].sort(compareDirectedRailEdges));
}

function planConnectorOrganizations(
	prospectiveMap: TileMap,
	organizations: StaticFabOrganizationState,
	source: StaticFabOrganizationRecord,
	target: StaticFabOrganizationRecord,
	existingParent: StaticFabOrganizationRecord | null,
	parentParentOrganizationIds: readonly number[],
	replacedChildParentIds: readonly number[],
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	addedEdges: readonly DirectedRailEdge[],
): Readonly<{
	mutations: readonly StaticFabOrganizationMutation[];
	nextOrganizationId: number;
	parentOrganizationId: number;
}> {
	if (addedEdges.length === 0) throw new Error("Assembly Connector에 새 directed edge가 없습니다");
	const ownership = buildRailModuleOwnershipIndex(prospectiveMap);
	const moduleIndicesByEdge = new Map<string, number[]>();
	for (let index = 0; index < ownership.modules.length; index++) {
		for (const edge of ownership.modules[index]?.eraseEdges ?? []) {
			const key = staticFabOrganizationEdgeKey(edge);
			const indices = moduleIndicesByEdge.get(key);
			if (indices) indices.push(index);
			else moduleIndicesByEdge.set(key, [index]);
		}
	}
	const expandedById = new Map<number, StaticFabOrganizationMembership>();
	for (const record of organizations.records) {
		expandedById.set(
			record.id,
			expandMembership(record.membership, ownership.modules, moduleIndicesByEdge),
		);
	}
	const connectorModuleIndices = moduleIndicesForEdges(addedEdges, moduleIndicesByEdge);
	if (connectorModuleIndices.size === 0) {
		throw new Error("Assembly Connector의 새 레일 모듈을 찾을 수 없습니다");
	}

	const parentOrganizationId = existingParent?.id ?? organizations.nextOrganizationId;
	const nextOrganizationId = existingParent
		? organizations.nextOrganizationId
		: organizations.nextOrganizationId + 1;
	const mutations: StaticFabOrganizationMutation[] = [];
	for (const record of organizations.records) {
		let membership = expandedById.get(record.id) as StaticFabOrganizationMembership;
		let parentOrganizationIds = staticFabOrganizationParentIds(record);
		if (hierarchyRole === "BANK_TO_FAB" && (record.id === source.id || record.id === target.id)) {
			membership = membershipWithoutModuleIndices(
				record.membership,
				ownership.modules,
				moduleIndicesByEdge,
				connectorModuleIndices,
			);
		}
		if (record.id === existingParent?.id) {
			const parentModuleIndices = membershipModuleIndices(
				membership,
				ownership.modules,
				moduleIndicesByEdge,
			);
			for (const index of connectorModuleIndices) parentModuleIndices.add(index);
			membership = membershipFromModuleIndices(membership, ownership.modules, parentModuleIndices);
		}
		if (
			(record.id === source.id || record.id === target.id) &&
			!parentOrganizationIds.includes(parentOrganizationId)
		) {
			parentOrganizationIds = Object.freeze(
				[
					...new Set([
						...parentOrganizationIds.filter(
							(parentId) => !replacedChildParentIds.includes(parentId),
						),
						parentOrganizationId,
					]),
				].sort((left, right) => left - right),
			);
		}
		const after = organizationRecordAfter(record, membership, parentOrganizationIds);
		if (!organizationRecordEquivalent(record, after)) {
			mutations.push(Object.freeze({ id: record.id, before: record, after }));
		}
	}
	if (!existingParent) {
		const membership = membershipFromModuleIndices(
			Object.freeze({
				railEdges: Object.freeze([]),
				advancedSwitchIds: Object.freeze([]),
				equipmentGroupIds: Object.freeze([]),
			}),
			ownership.modules,
			connectorModuleIndices,
		);
		const parent = copyStaticFabOrganizationRecord({
			id: parentOrganizationId,
			kind: "AREA",
			name:
				hierarchyRole === "BAY_TO_BANK"
					? `Bay Bank ${parentOrganizationId}`
					: `Fab ${parentOrganizationId}`,
			parentOrganizationIds: Object.freeze([...parentParentOrganizationIds]),
			properties: Object.freeze({
				description:
					hierarchyRole === "BAY_TO_BANK" ? "Bay assembly connector" : "Typed Interbay connector",
				color: "TEAL",
			}),
			membership,
		});
		mutations.push(Object.freeze({ id: parent.id, before: null, after: parent }));
	}
	mutations.sort((left, right) => left.id - right.id);
	return Object.freeze({
		mutations: Object.freeze(mutations),
		nextOrganizationId,
		parentOrganizationId,
	});
}

function membershipWithoutModuleIndices(
	membership: StaticFabOrganizationMembership,
	modules: ReturnType<typeof buildRailModuleOwnershipIndex>["modules"],
	moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>,
	removedIndices: ReadonlySet<number>,
): StaticFabOrganizationMembership {
	const retainedIndices = membershipModuleIndices(membership, modules, moduleIndicesByEdge);
	for (const index of removedIndices) retainedIndices.delete(index);
	return membershipFromModuleIndices(membership, modules, retainedIndices);
}

function expandMembership(
	membership: StaticFabOrganizationMembership,
	modules: ReturnType<typeof buildRailModuleOwnershipIndex>["modules"],
	moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>,
): StaticFabOrganizationMembership {
	const indices = membershipModuleIndices(membership, modules, moduleIndicesByEdge);
	return membershipFromModuleIndices(membership, modules, indices);
}

function membershipModuleIndices(
	membership: StaticFabOrganizationMembership,
	modules: ReturnType<typeof buildRailModuleOwnershipIndex>["modules"],
	moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>,
): Set<number> {
	const indices = moduleIndicesForEdges(membership.railEdges, moduleIndicesByEdge);
	for (const switchId of membership.advancedSwitchIds) {
		for (let index = 0; index < modules.length; index++) {
			if (modules[index]?.advancedSwitchId === switchId) indices.add(index);
		}
	}
	return indices;
}

function moduleIndicesForEdges(
	edges: readonly DirectedRailEdge[],
	moduleIndicesByEdge: ReadonlyMap<string, readonly number[]>,
): Set<number> {
	const indices = new Set<number>();
	for (const edge of edges) {
		for (const index of moduleIndicesByEdge.get(staticFabOrganizationEdgeKey(edge)) ?? []) {
			indices.add(index);
		}
	}
	return indices;
}

function membershipFromModuleIndices(
	base: StaticFabOrganizationMembership,
	modules: ReturnType<typeof buildRailModuleOwnershipIndex>["modules"],
	indices: ReadonlySet<number>,
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switches = new Set<number>();
	for (const index of indices) {
		const module = modules[index];
		if (!module) continue;
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switches.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switches].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...base.equipmentGroupIds]),
	});
}

function organizationRecordAfter(
	record: StaticFabOrganizationRecord,
	membership: StaticFabOrganizationMembership,
	parentOrganizationIds: readonly number[],
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationRecord({
		id: record.id,
		kind: record.kind,
		name: record.name,
		parentOrganizationIds,
		properties: staticFabOrganizationProperties(record),
		membership,
	});
}

function organizationRecordEquivalent(
	left: StaticFabOrganizationRecord,
	right: StaticFabOrganizationRecord,
): boolean {
	return (
		left.kind === right.kind &&
		left.name === right.name &&
		numberListEquals(staticFabOrganizationParentIds(left), staticFabOrganizationParentIds(right)) &&
		staticFabOrganizationProperties(left).description ===
			staticFabOrganizationProperties(right).description &&
		staticFabOrganizationProperties(left).color === staticFabOrganizationProperties(right).color &&
		edgeListEquals(left.membership.railEdges, right.membership.railEdges) &&
		numberListEquals(left.membership.advancedSwitchIds, right.membership.advancedSwitchIds) &&
		numberListEquals(left.membership.equipmentGroupIds, right.membership.equipmentGroupIds)
	);
}

function edgeListEquals(
	left: readonly DirectedRailEdge[],
	right: readonly DirectedRailEdge[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(edge, index) => compareDirectedRailEdges(edge, right[index] as DirectedRailEdge) === 0,
		)
	);
}

function numberListEquals(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rejected(
	networkLink: RailNetworkLinkPlan,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabAssemblyConnectorIntent,
	issueCode: StaticFabAssemblyConnectorIssueCode,
	reason: string,
): StaticFabAssemblyConnectorPlanningResult {
	return Object.freeze({
		plan: Object.freeze({
			...networkLink,
			valid: false,
			reason,
			issueCode: "topology" as const,
			mutations: Object.freeze([]),
			switchMutations: Object.freeze([]),
			basePatchSequence,
			organizationImpactAuthorizations: Object.freeze([]),
			organizationMutations: Object.freeze([]),
			nextOrganizationIdBefore: organizations.nextOrganizationId,
			nextOrganizationIdAfter: organizations.nextOrganizationId,
			assemblyConnector: connectorMetadata(intent, {
				hierarchyRole: null,
				purpose: null,
				bankOrganizationId: null,
				fabOrganizationId: null,
				createdBank: false,
				createdFab: false,
				outboundLengthMeters: 0,
				returnLengthMeters: 0,
				issueCode,
			}),
		}),
		prospectiveState: null,
	});
}

function connectorMetadata(
	intent: StaticFabAssemblyConnectorIntent,
	values: Pick<
		StaticFabAssemblyConnectorMetadata,
		| "hierarchyRole"
		| "purpose"
		| "bankOrganizationId"
		| "fabOrganizationId"
		| "createdBank"
		| "createdFab"
		| "outboundLengthMeters"
		| "returnLengthMeters"
		| "issueCode"
	>,
): StaticFabAssemblyConnectorMetadata {
	return Object.freeze({
		version: STATIC_FAB_ASSEMBLY_CONNECTOR_VERSION,
		sourceOrganizationId: intent.sourceOrganizationId,
		sourceGatewayId: intent.sourceGatewayId,
		sourceAnchor: Object.freeze({ x: intent.sourceAnchor.x, y: intent.sourceAnchor.y }),
		targetOrganizationId: intent.targetOrganizationId,
		targetGatewayId: intent.targetGatewayId,
		targetAnchor: Object.freeze({ x: intent.targetAnchor.x, y: intent.targetAnchor.y }),
		requestedSide: intent.side,
		...values,
	});
}
