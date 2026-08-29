import type { RailMutation } from "../core/paint";
import type {
	StaticFabAssemblyConnectorIssueCode,
	StaticFabAssemblyConnectorPlan,
} from "../core/StaticFabAssemblyConnector";
import {
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";
import { type Cell, decodeRailCell } from "../core/TileMap";
import {
	type PreparedStaticFabAssemblyConnector,
	STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT,
	STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_ORGANIZATION_MUTATIONS,
	STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_PLAN_CELLS,
	STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT,
} from "./StaticFabAssemblyConnectorProtocol";

const MAX_ORGANIZATION_RAIL_EDGE_REFERENCES = 1_000_000;
const MAX_ORGANIZATION_RECORD_TEXT = 500;

/** Bounded structural gate applied in both the Worker and the main-thread bridge. */
export function staticFabAssemblyConnectorPreparedShapeError(value: unknown): string | null {
	if (!isRecord(value)) return "prepared payload must be an object";
	if (typeof value.valid !== "boolean") return "prepared validity must be boolean";
	if (!validFailureCode(value.failureCode, value.valid)) return "prepared failure code is invalid";
	if (!boundedText(value.reason, STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT)) {
		return "prepared reason exceeds its text budget";
	}
	if (
		!Array.isArray(value.conflictCells) ||
		value.conflictCells.length > STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT ||
		!value.conflictCells.every(isCell) ||
		!nonNegativeSafeInteger(value.conflictCount) ||
		!nonNegativeSafeInteger(value.candidateCommittedEnvelopePairs) ||
		!nonNegativeSafeInteger(value.testedCommittedEnvelopePairs) ||
		!nonNegativeFinite(value.planningMilliseconds) ||
		!nonNegativeFinite(value.validationMilliseconds)
	) {
		return "prepared diagnostics are malformed";
	}
	if (value.plan !== null) {
		const planError = connectorPlanShapeError(value.plan, value.valid ? "full" : "compact");
		if (planError) return planError;
	}
	if (!value.valid) {
		if (value.ticket !== null) return "rejected connector carried a Worker ticket";
		if (isRecord(value.plan) && value.plan.valid === true) {
			return "rejected connector carried a valid plan";
		}
		return null;
	}
	if (value.failureCode !== null || value.plan === null || value.ticket === null) {
		return "valid connector omitted its plan or Worker ticket";
	}
	return connectorTicketShapeError(value.ticket, value.plan as StaticFabAssemblyConnectorPlan);
}

export function connectorPlanShapeError(value: unknown, mode: "compact" | "full"): string | null {
	if (
		!isRecord(value) ||
		value.kind !== "build" ||
		typeof value.valid !== "boolean" ||
		!boundedText(value.reason, STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_RESPONSE_TEXT) ||
		!nonNegativeSafeInteger(value.baseRevision) ||
		!nonNegativeSafeInteger(value.basePatchSequence) ||
		!positiveInt32(value.nextOrganizationIdBefore) ||
		!positiveInt32(value.nextOrganizationIdAfter) ||
		!nonNegativeSafeInteger(value.newEdges) ||
		!nonNegativeFinite(value.lengthMeters) ||
		!nonNegativeSafeInteger(value.turns) ||
		(value.bend !== "horizontal-first" && value.bend !== "vertical-first") ||
		!Array.isArray(value.cells) ||
		!Array.isArray(value.conflicts) ||
		!Array.isArray(value.mutations) ||
		!Array.isArray(value.switchMutations) ||
		!Array.isArray(value.organizationImpactAuthorizations) ||
		!Array.isArray(value.organizationMutations) ||
		!isRecord(value.networkLink) ||
		!isRecord(value.assemblyConnector)
	) {
		return "connector plan fields are malformed";
	}
	const maximumCells =
		mode === "compact"
			? STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT
			: STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_PLAN_CELLS;
	if (
		value.cells.length > maximumCells ||
		value.conflicts.length > STATIC_FAB_ASSEMBLY_CONNECTOR_CONFLICT_LIMIT ||
		!value.cells.every(isCell) ||
		!value.conflicts.every(isCell) ||
		value.mutations.length > STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_PLAN_CELLS ||
		!value.mutations.every(isRailMutation) ||
		value.switchMutations.length !== 0 ||
		value.organizationImpactAuthorizations.length >
			STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_ORGANIZATION_MUTATIONS ||
		!canonicalPositiveInt32Ids(value.organizationImpactAuthorizations) ||
		value.organizationMutations.length > STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_ORGANIZATION_MUTATIONS
	) {
		return "connector plan exceeds its mutation budget";
	}
	if (mode === "compact") {
		if (
			value.mutations.length !== 0 ||
			value.organizationImpactAuthorizations.length !== 0 ||
			value.organizationMutations.length !== 0
		) {
			return "compact rejected connector carried authored mutations";
		}
		const metadataError = connectorMetadataShapeError(value.assemblyConnector);
		if (metadataError) return metadataError;
		return networkLinkMetadataShapeError(value.networkLink);
	}
	if (
		value.mutations.length === 0 ||
		value.organizationImpactAuthorizations.length === 0 ||
		value.organizationMutations.length === 0 ||
		!value.organizationMutations.every(isOrganizationMutation)
	) {
		return "full connector mutations are malformed";
	}
	const metadataError = connectorMetadataShapeError(value.assemblyConnector);
	if (metadataError) return metadataError;
	return networkLinkMetadataShapeError(value.networkLink);
}

function connectorTicketShapeError(
	ticket: unknown,
	plan: StaticFabAssemblyConnectorPlan,
): string | null {
	if (
		!isRecord(ticket) ||
		!positiveSafeInteger(ticket.ticketId) ||
		ticket.validationLevel !== "exact" ||
		!nonNegativeSafeInteger(ticket.sourceRevision) ||
		!nonNegativeSafeInteger(ticket.sourcePatchSequence) ||
		!boundedFingerprint(ticket.sourceChecksum) ||
		!positiveInt32(ticket.sourceNextAdvancedSwitchId) ||
		!positiveInt32(ticket.sourceNextPortId) ||
		!positiveInt32(ticket.sourceNextEquipmentGroupId) ||
		!positiveInt32(ticket.sourceNextOrganizationId) ||
		!boundedFingerprint(ticket.intentFingerprint) ||
		!boundedFingerprint(ticket.planFingerprint) ||
		!boundedFingerprint(ticket.prospectiveChecksum) ||
		!positiveInt32(ticket.prospectiveNextAdvancedSwitchId) ||
		!positiveInt32(ticket.prospectiveNextPortId) ||
		!positiveInt32(ticket.prospectiveNextEquipmentGroupId) ||
		!positiveInt32(ticket.prospectiveNextOrganizationId)
	) {
		return "connector Worker ticket fields are malformed";
	}
	return ticket.sourceRevision === plan.baseRevision &&
		ticket.sourcePatchSequence === plan.basePatchSequence &&
		ticket.sourceNextOrganizationId === plan.nextOrganizationIdBefore &&
		ticket.prospectiveNextOrganizationId === plan.nextOrganizationIdAfter
		? null
		: "connector Worker ticket does not bind its plan";
}

function connectorMetadataShapeError(value: Record<string, unknown>): string | null {
	return value.version === 3 &&
		(value.hierarchyRole === null ||
			value.hierarchyRole === "BAY_TO_BANK" ||
			value.hierarchyRole === "BANK_TO_FAB") &&
		(value.purpose === null ||
			value.purpose === "HIERARCHY_LINK" ||
			value.purpose === "FAB_LOOP") &&
		positiveInt32(value.sourceOrganizationId) &&
		boundedGatewayId(value.sourceGatewayId) &&
		isCell(value.sourceAnchor) &&
		positiveInt32(value.targetOrganizationId) &&
		boundedGatewayId(value.targetGatewayId) &&
		isCell(value.targetAnchor) &&
		(value.requestedSide === null ||
			value.requestedSide === "left" ||
			value.requestedSide === "right") &&
		(value.bankOrganizationId === null || positiveInt32(value.bankOrganizationId)) &&
		(value.fabOrganizationId === null || positiveInt32(value.fabOrganizationId)) &&
		typeof value.createdBank === "boolean" &&
		typeof value.createdFab === "boolean" &&
		connectorHierarchyMetadataCoherent(value) &&
		nonNegativeSafeInteger(value.outboundLengthMeters) &&
		nonNegativeSafeInteger(value.returnLengthMeters) &&
		(value.issueCode === null || connectorIssueCode(value.issueCode))
		? null
		: "connector metadata is malformed";
}

function connectorHierarchyMetadataCoherent(value: Record<string, unknown>): boolean {
	if (value.hierarchyRole === null) {
		return (
			value.purpose === null &&
			value.bankOrganizationId === null &&
			value.fabOrganizationId === null &&
			value.createdBank === false &&
			value.createdFab === false
		);
	}
	if (value.hierarchyRole === "BAY_TO_BANK") {
		return (
			value.purpose === "HIERARCHY_LINK" &&
			positiveInt32(value.bankOrganizationId) &&
			value.fabOrganizationId === null &&
			typeof value.createdBank === "boolean" &&
			value.createdFab === false
		);
	}
	return (
		(value.purpose === "HIERARCHY_LINK" || value.purpose === "FAB_LOOP") &&
		value.bankOrganizationId === null &&
		positiveInt32(value.fabOrganizationId) &&
		value.createdBank === false &&
		(value.purpose === "FAB_LOOP"
			? value.createdFab === false
			: typeof value.createdFab === "boolean")
	);
}

function networkLinkMetadataShapeError(value: Record<string, unknown>): string | null {
	const cells = [
		value.sourceDeparture,
		value.sourceArrival,
		value.targetArrival,
		value.targetDeparture,
	];
	return value.version === 1 &&
		boundedText(value.placementCode, 64) &&
		isCell(value.sourceAnchor) &&
		isCell(value.targetAnchor) &&
		(value.sourceForward === null || cardinalDirection(value.sourceForward)) &&
		(value.targetForward === null || cardinalDirection(value.targetForward)) &&
		(value.side === null || value.side === "left" || value.side === "right") &&
		nonNegativeSafeInteger(value.junctionSpacingMeters) &&
		nonNegativeSafeInteger(value.sourceComponentCellCount) &&
		nonNegativeSafeInteger(value.targetComponentCellCount) &&
		cells.every((cell) => cell === null || isCell(cell)) &&
		Array.isArray(value.outboundCells) &&
		value.outboundCells.length <= STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_PLAN_CELLS &&
		value.outboundCells.every(isCell) &&
		Array.isArray(value.returnCells) &&
		value.returnCells.length <= STATIC_FAB_ASSEMBLY_CONNECTOR_MAX_PLAN_CELLS &&
		value.returnCells.every(isCell)
		? null
		: "network-link metadata is malformed";
}

function isOrganizationMutation(value: unknown): value is StaticFabOrganizationMutation {
	if (!isRecord(value) || !positiveInt32(value.id)) return false;
	if (value.before !== null && !isOrganizationRecord(value.before, value.id)) return false;
	if (value.after !== null && !isOrganizationRecord(value.after, value.id)) return false;
	return value.before !== null || value.after !== null;
}

function isOrganizationRecord(
	value: unknown,
	expectedId: number,
): value is StaticFabOrganizationRecord {
	if (
		!isRecord(value) ||
		value.id !== expectedId ||
		!STATIC_FAB_ORGANIZATION_KINDS.includes(
			value.kind as (typeof STATIC_FAB_ORGANIZATION_KINDS)[number],
		) ||
		!boundedText(value.name, 120) ||
		!isRecord(value.membership)
	) {
		return false;
	}
	try {
		const record = value as unknown as StaticFabOrganizationRecord;
		const parents = staticFabOrganizationParentIds(record);
		const properties = staticFabOrganizationProperties(record);
		if (
			parents.length > 32 ||
			!parents.every(positiveInt32) ||
			!boundedText(properties.description, MAX_ORGANIZATION_RECORD_TEXT) ||
			!boundedText(properties.color, 16) ||
			record.membership.railEdges.length > MAX_ORGANIZATION_RAIL_EDGE_REFERENCES ||
			!record.membership.railEdges.every(
				(edge) => isCell(edge.from) && isCell(edge.to) && cardinalNeighbors(edge.from, edge.to),
			) ||
			!record.membership.advancedSwitchIds.every(positiveInt32) ||
			!record.membership.equipmentGroupIds.every(positiveInt32)
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

function isRailMutation(value: unknown): value is RailMutation {
	if (!isRecord(value) || !int32(value.x) || !int32(value.y)) return false;
	if (
		!Number.isInteger(value.before) ||
		(value.before as number) < 0 ||
		(value.before as number) > 0xff ||
		!Number.isInteger(value.after) ||
		(value.after as number) < 0 ||
		(value.after as number) > 0xff ||
		value.before === value.after
	) {
		return false;
	}
	try {
		decodeRailCell(value.before as number);
		decodeRailCell(value.after as number);
		return true;
	} catch {
		return false;
	}
}

function validFailureCode(value: unknown, valid: boolean): boolean {
	return valid
		? value === null
		: value === "snapshot" ||
				value === "intent" ||
				value === "fingerprint" ||
				value === "stale" ||
				value === "plan" ||
				value === "clearance" ||
				value === "compile";
}

function connectorIssueCode(value: unknown): value is StaticFabAssemblyConnectorIssueCode {
	return (
		value === "INVALID_SOURCE" ||
		value === "STALE_SOURCE" ||
		value === "MISSING_ORGANIZATION" ||
		value === "UNSUPPORTED_ORGANIZATION" ||
		value === "SAME_ORGANIZATION" ||
		value === "ANCHOR_OUTSIDE_ORGANIZATION" ||
		value === "AMBIGUOUS_GATEWAY_OWNERSHIP" ||
		value === "DIFFERENT_BANKS" ||
		value === "HIERARCHY_INVALID" ||
		value === "ALREADY_CONNECTED" ||
		value === "ROUTE_INVALID" ||
		value === "ORGANIZATION_INVALID"
	);
}

function cardinalNeighbors(left: Cell, right: Cell): boolean {
	return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function cardinalDirection(value: unknown): boolean {
	return value === 1 || value === 2 || value === 4 || value === 8;
}

function boundedGatewayId(value: unknown): value is string {
	return boundedText(value, 512) && value.length > 0;
}

function boundedFingerprint(value: unknown): value is string {
	return boundedText(value, 512) && value.length > 0;
}

function boundedText(value: unknown, limit: number): value is string {
	return typeof value === "string" && value.length <= limit;
}

function isCell(value: unknown): value is Cell {
	return isRecord(value) && int32(value.x) && int32(value.y);
}

function int32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonNegativeFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function canonicalPositiveInt32Ids(value: readonly unknown[]): boolean {
	let previous = 0;
	for (const id of value) {
		if (!positiveInt32(id) || id <= previous) return false;
		previous = id;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function assertPreparedStaticFabAssemblyConnector(
	value: unknown,
): asserts value is PreparedStaticFabAssemblyConnector {
	const error = staticFabAssemblyConnectorPreparedShapeError(value);
	if (error) throw new Error(error);
}
