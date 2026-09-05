import type { RailMutation } from "../core/paint";
import { ALL_DIRECTIONS, moveCell } from "../core/railShape";
import {
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIssueCode,
	type StaticFabBayFlowEditPlan,
	type StaticFabBayFlowEditReview,
} from "../core/StaticFabBayFlowEdit";
import {
	type StaticFabBayFlowEditWorkerTicket,
	staticFabBayFlowEditPlanFingerprint,
} from "../core/StaticFabBayFlowEditCertification";
import {
	compareDirectedRailEdges,
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";
import { type Cell, decodeRailCell } from "../core/TileMap";
import {
	type PreparedStaticFabBayFlowEdit,
	STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_EQUIPMENT_GROUP_MUTATIONS,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_ORGANIZATION_MUTATIONS,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_PORT_MUTATIONS,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_REVIEW_IDS,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_REVIEW_KEYS,
	STATIC_FAB_BAY_FLOW_EDIT_MAX_SWITCH_MUTATIONS,
	type StaticFabBayFlowEditTopologyEvidence,
} from "./StaticFabBayFlowEditProtocol";

const MAX_REVIEW_TEXT = 512;
const MAX_GATEWAY_KEY_TEXT = 128;
const MAX_ORGANIZATION_NAME_TEXT = 120;
const MAX_ORGANIZATION_RECORD_RAIL_EDGE_REFERENCES = STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS;
const MAX_ORGANIZATION_RECORD_SWITCH_REFERENCES = 65_536;
const MAX_ORGANIZATION_RECORD_GROUP_REFERENCES = 65_536;
const MAX_ORGANIZATION_MUTATION_RAIL_EDGE_REFERENCES =
	STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS * 2;
const MAX_ORGANIZATION_MUTATION_SWITCH_REFERENCES = 65_536;
const MAX_ORGANIZATION_MUTATION_GROUP_REFERENCES = 65_536;
const ORDERED_FINGERPRINT_PATTERN = /^[0-9a-f]{8}:[0-9a-f]{8}$/;
const RAIL_CHECKSUM_PATTERN = /^(?:[0-9a-f]{8}:){11}[0-9a-f]{8}$/;

const PREPARED_KEYS = Object.freeze([
	"plan",
	"review",
	"ticket",
	"sourceEvidence",
	"prospectiveEvidence",
	"valid",
	"failureCode",
	"reason",
	"planningMilliseconds",
	"validationMilliseconds",
] as const);

const PLAN_KEYS = Object.freeze([
	"kind",
	"baseRevision",
	"basePatchSequence",
	"mutations",
	"switchMutations",
	"portMutations",
	"equipmentGroupMutations",
	"organizationMutations",
	"organizationImpactAuthorizations",
	"nextOrganizationIdBefore",
	"nextOrganizationIdAfter",
	"valid",
	"reason",
	"issueCode",
	"review",
] as const);

const REVIEW_KEYS = Object.freeze([
	"version",
	"bayOrganizationId",
	"bayName",
	"bankOrganizationId",
	"processLoopOrganizationIds",
	"sourceInternalFlowPattern",
	"targetInternalFlowPattern",
	"sourceAuthoredProjectionFingerprint",
	"targetAuthoredProjectionFingerprint",
	"sourceSpecificationAliasCount",
	"sourceDirectedEdgeCount",
	"targetDirectedEdgeCount",
	"removedDirectedEdgeCount",
	"addedDirectedEdgeCount",
	"changedCellCount",
	"changedOrganizationIds",
	"incidentConnectorCount",
	"connectorBankToBayDirectedEdgeKeys",
	"connectorBayToBankDirectedEdgeKeys",
	"shellCertification",
	"externalGatewayCertification",
	"topologyCertification",
	"issueCode",
] as const);

const EVIDENCE_KEYS = Object.freeze([
	"authoredCellCount",
	"authoredDirectedEdgeCount",
	"authoredStatus",
	"authoredComponentCount",
	"authoredStrongComponentCount",
	"authoredOpenTerminalCount",
	"authoredUnsafeJunctionCount",
	"authoredComponentsClosed",
	"physicalValid",
	"physicalPathCount",
	"physicalComponentCount",
	"physicalStrongComponentCount",
	"physicalOpenPathCount",
	"physicalInvalidPathCount",
	"physicalDiagnosticCount",
	"physicalTerminalCount",
	"physicalClearanceIssueCount",
	"physicalComponentsClosed",
] as const);

const TICKET_KEYS = Object.freeze([
	"ticketId",
	"validationLevel",
	"sourceRevision",
	"sourcePatchSequence",
	"sourceChecksum",
	"sourceNextAdvancedSwitchId",
	"sourceNextPortId",
	"sourceNextEquipmentGroupId",
	"sourceNextOrganizationId",
	"intentFingerprint",
	"planFingerprint",
	"sourceAuthoredProjectionFingerprint",
	"targetAuthoredProjectionFingerprint",
	"prospectiveChecksum",
	"prospectiveNextAdvancedSwitchId",
	"prospectiveNextPortId",
	"prospectiveNextEquipmentGroupId",
	"prospectiveNextOrganizationId",
] as const);

const ORGANIZATION_RECORD_REQUIRED_KEYS = Object.freeze([
	"id",
	"kind",
	"name",
	"membership",
] as const);
const ORGANIZATION_RECORD_ALLOWED_KEYS = Object.freeze([
	...ORGANIZATION_RECORD_REQUIRED_KEYS,
	"parentOrganizationIds",
	"properties",
] as const);
const ORGANIZATION_MEMBERSHIP_KEYS = Object.freeze([
	"railEdges",
	"advancedSwitchIds",
	"equipmentGroupIds",
] as const);
const ORGANIZATION_PROPERTIES_KEYS = Object.freeze(["description", "color"] as const);
const ORGANIZATION_MUTATION_KEYS = Object.freeze(["id", "before", "after"] as const);
const RAIL_MUTATION_KEYS = Object.freeze(["x", "y", "before", "after"] as const);
const EDGE_KEYS = Object.freeze(["from", "to"] as const);
const CELL_KEYS = Object.freeze(["x", "y"] as const);

interface DirectedRailDelta {
	readonly removed: ReadonlySet<string>;
	readonly added: ReadonlySet<string>;
}

/** Bounded fail-closed receive gate shared by the Worker entry and main-thread bridge. */
export function staticFabBayFlowEditPreparedShapeError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, PREPARED_KEYS)) {
		return "Bay flow edit prepared payload fields are malformed";
	}
	if (
		typeof value.valid !== "boolean" ||
		!validFailureCode(value.failureCode, value.valid) ||
		!boundedText(value.reason, STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT) ||
		!nonNegativeFinite(value.planningMilliseconds) ||
		!nonNegativeFinite(value.validationMilliseconds)
	) {
		return "Bay flow edit prepared status is malformed";
	}
	if (value.sourceEvidence !== null) {
		const error = topologyEvidenceShapeError(value.sourceEvidence);
		if (error) return `source ${error}`;
	}
	if (value.prospectiveEvidence !== null) {
		const error = topologyEvidenceShapeError(value.prospectiveEvidence);
		if (error) return `prospective ${error}`;
	}

	if (value.plan === null) {
		if (value.review !== null) return "Bay flow edit review exists without a plan";
	} else {
		const error = staticFabBayFlowEditPlanShapeError(value.plan, value.valid ? "full" : "compact");
		if (error) return error;
		const planRecord = value.plan as Record<string, unknown>;
		if (!isRecord(value.review) || !reviewsEqual(value.review, planRecord.review)) {
			return "Bay flow edit prepared review does not exactly match plan.review";
		}
	}

	if (!value.valid) {
		if (value.ticket !== null) return "rejected Bay flow edit carried a Worker ticket";
		if (isRecord(value.plan) && value.plan.valid === true) {
			return "rejected Bay flow edit carried a valid plan";
		}
		return null;
	}
	if (
		value.failureCode !== null ||
		value.plan === null ||
		value.review === null ||
		value.ticket === null ||
		value.sourceEvidence === null ||
		value.prospectiveEvidence === null
	) {
		return "valid Bay flow edit omitted exact plan, ticket, review, or topology evidence";
	}
	const plan = value.plan as unknown as StaticFabBayFlowEditPlan;
	if (value.reason !== plan.reason) {
		return "valid Bay flow edit reason does not exactly match its plan";
	}
	const topologyError = validTopologyTransitionError(
		value.sourceEvidence as unknown as StaticFabBayFlowEditTopologyEvidence,
		value.prospectiveEvidence as unknown as StaticFabBayFlowEditTopologyEvidence,
	);
	if (topologyError) return topologyError;
	return bayFlowEditTicketShapeError(value.ticket, plan);
}

/** Validate either one authority-free compact rejection or one full exact flow-edit plan. */
export function staticFabBayFlowEditPlanShapeError(
	value: unknown,
	mode: "compact" | "full",
): string | null {
	if (!isRecord(value) || !hasExactKeys(value, PLAN_KEYS)) {
		return "Bay flow edit plan fields are malformed";
	}
	if (
		value.kind !== STATIC_FAB_BAY_FLOW_EDIT_KIND ||
		typeof value.valid !== "boolean" ||
		!boundedText(value.reason, STATIC_FAB_BAY_FLOW_EDIT_MAX_RESPONSE_TEXT) ||
		!nonNegativeSafeInteger(value.baseRevision) ||
		!nonNegativeSafeInteger(value.basePatchSequence) ||
		!positiveCursor(value.nextOrganizationIdBefore) ||
		!positiveCursor(value.nextOrganizationIdAfter) ||
		(value.issueCode !== null && !bayFlowEditIssueCode(value.issueCode)) ||
		!Array.isArray(value.mutations) ||
		!Array.isArray(value.switchMutations) ||
		!Array.isArray(value.portMutations) ||
		!Array.isArray(value.equipmentGroupMutations) ||
		!Array.isArray(value.organizationMutations) ||
		!Array.isArray(value.organizationImpactAuthorizations)
	) {
		return "Bay flow edit plan scalar fields are malformed";
	}
	if (value.nextOrganizationIdBefore !== value.nextOrganizationIdAfter) {
		return "Bay flow edit plan changed the organization cursor";
	}
	if (
		value.switchMutations.length !== STATIC_FAB_BAY_FLOW_EDIT_MAX_SWITCH_MUTATIONS ||
		value.portMutations.length !== STATIC_FAB_BAY_FLOW_EDIT_MAX_PORT_MUTATIONS ||
		value.equipmentGroupMutations.length !== STATIC_FAB_BAY_FLOW_EDIT_MAX_EQUIPMENT_GROUP_MUTATIONS
	) {
		return "Bay flow edit plan carried switch, port, or equipment sidecar mutations";
	}
	const reviewError = bayFlowEditReviewShapeError(value.review, mode);
	if (reviewError) return reviewError;
	const review = value.review as unknown as StaticFabBayFlowEditReview;
	if (review.issueCode !== value.issueCode) {
		return "Bay flow edit plan and review issue codes diverged";
	}

	if (
		value.mutations.length > STATIC_FAB_BAY_FLOW_EDIT_MAX_RAIL_MUTATIONS ||
		!canonicalRailMutations(value.mutations) ||
		value.organizationMutations.length > STATIC_FAB_BAY_FLOW_EDIT_MAX_ORGANIZATION_MUTATIONS ||
		value.organizationImpactAuthorizations.length >
			STATIC_FAB_BAY_FLOW_EDIT_MAX_ORGANIZATION_MUTATIONS ||
		!canonicalPositiveInt32Ids(value.organizationImpactAuthorizations)
	) {
		return "Bay flow edit plan exceeds or violates its mutation budgets";
	}
	const organizationError = organizationMutationsShapeError(value.organizationMutations);
	if (organizationError) return organizationError;

	if (mode === "compact") {
		if (
			value.valid !== false ||
			value.mutations.length !== 0 ||
			value.organizationMutations.length !== 0 ||
			value.organizationImpactAuthorizations.length !== 0
		) {
			return "compact rejected Bay flow edit carried authored authority";
		}
		return null;
	}
	if (value.valid !== true || value.issueCode !== null || review.issueCode !== null) {
		return "full Bay flow edit plan is not valid";
	}
	if (value.mutations.length === 0 || value.organizationMutations.length === 0) {
		return "full Bay flow edit plan omitted its rail or organization mutation";
	}
	return fullPlanConsistencyError(value, review);
}

function bayFlowEditReviewShapeError(value: unknown, mode: "compact" | "full"): string | null {
	if (!isRecord(value) || !hasExactKeys(value, REVIEW_KEYS)) {
		return "Bay flow edit review fields are malformed";
	}
	const listLimit =
		mode === "compact"
			? STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT
			: STATIC_FAB_BAY_FLOW_EDIT_MAX_REVIEW_IDS;
	const keyLimit =
		mode === "compact"
			? STATIC_FAB_BAY_FLOW_EDIT_COMPACT_REVIEW_LIMIT
			: STATIC_FAB_BAY_FLOW_EDIT_MAX_REVIEW_KEYS;
	if (
		value.version !== STATIC_FAB_BAY_FLOW_EDIT_VERSION ||
		!boundedNonEmptyText(value.bayName, MAX_REVIEW_TEXT) ||
		(value.bankOrganizationId !== null && !positiveInt32(value.bankOrganizationId)) ||
		!Array.isArray(value.processLoopOrganizationIds) ||
		value.processLoopOrganizationIds.length !== 2 ||
		!isFlowPattern(value.targetInternalFlowPattern) ||
		(value.sourceInternalFlowPattern !== null && !isFlowPattern(value.sourceInternalFlowPattern)) ||
		!boundedText(value.sourceAuthoredProjectionFingerprint, 512) ||
		!boundedText(value.targetAuthoredProjectionFingerprint, 512) ||
		!nonNegativeSafeInteger(value.sourceSpecificationAliasCount) ||
		!nonNegativeSafeInteger(value.sourceDirectedEdgeCount) ||
		!nonNegativeSafeInteger(value.targetDirectedEdgeCount) ||
		!nonNegativeSafeInteger(value.removedDirectedEdgeCount) ||
		!nonNegativeSafeInteger(value.addedDirectedEdgeCount) ||
		!nonNegativeSafeInteger(value.changedCellCount) ||
		(value.incidentConnectorCount !== 0 && value.incidentConnectorCount !== 1) ||
		value.shellCertification !== "PENDING_WORKER_CERTIFICATION" ||
		value.externalGatewayCertification !== "PENDING_WORKER_CERTIFICATION" ||
		value.topologyCertification !== "PENDING_WORKER_CERTIFICATION" ||
		(value.issueCode !== null && !bayFlowEditIssueCode(value.issueCode))
	) {
		return "Bay flow edit review scalar fields are malformed";
	}
	const bayIdValid =
		mode === "full"
			? positiveInt32(value.bayOrganizationId)
			: int32IdOrZero(value.bayOrganizationId);
	const loopIdsValid =
		mode === "full"
			? value.processLoopOrganizationIds.every(positiveInt32) &&
				value.processLoopOrganizationIds[0] !== value.processLoopOrganizationIds[1]
			: value.processLoopOrganizationIds.every(int32IdOrZero);
	if (!bayIdValid || !loopIdsValid) {
		return "Bay flow edit review organization identities are malformed";
	}
	if (
		!boundedCanonicalIds(value.changedOrganizationIds, listLimit) ||
		!boundedGatewayKeyList(value.connectorBankToBayDirectedEdgeKeys, keyLimit) ||
		!boundedGatewayKeyList(value.connectorBayToBankDirectedEdgeKeys, keyLimit)
	) {
		return "Bay flow edit review arrays are malformed or exceed their budgets";
	}
	if (mode === "full") {
		if (
			value.sourceInternalFlowPattern === null ||
			value.sourceInternalFlowPattern === value.targetInternalFlowPattern ||
			!orderedFingerprint(value.sourceAuthoredProjectionFingerprint) ||
			!orderedFingerprint(value.targetAuthoredProjectionFingerprint) ||
			value.sourceAuthoredProjectionFingerprint === value.targetAuthoredProjectionFingerprint ||
			!positiveSafeInteger(value.sourceSpecificationAliasCount) ||
			!positiveSafeInteger(value.sourceDirectedEdgeCount) ||
			!positiveSafeInteger(value.targetDirectedEdgeCount) ||
			!positiveSafeInteger(value.removedDirectedEdgeCount) ||
			!positiveSafeInteger(value.addedDirectedEdgeCount) ||
			!positiveSafeInteger(value.changedCellCount) ||
			value.changedOrganizationIds.length === 0
		) {
			return "full Bay flow edit review omitted exact changed-flow evidence";
		}
	}
	return null;
}

function fullPlanConsistencyError(
	planRecord: Record<string, unknown>,
	review: StaticFabBayFlowEditReview,
): string | null {
	const mutations = planRecord.mutations as readonly RailMutation[];
	const organizationMutations =
		planRecord.organizationMutations as readonly StaticFabOrganizationMutation[];
	const changedIds = organizationMutations.map((mutation) => mutation.id);
	if (!sameNumberArray(review.changedOrganizationIds, changedIds)) {
		return "Bay flow edit review changed organization IDs do not match its mutations";
	}
	const permittedIds = new Set([review.bayOrganizationId, ...review.processLoopOrganizationIds]);
	if (changedIds.some((id) => !permittedIds.has(id) || id === review.bankOrganizationId)) {
		return "Bay flow edit organization mutation escaped the reviewed Bay subtree";
	}
	const authorizations = planRecord.organizationImpactAuthorizations as readonly number[];
	if (authorizations.some((id) => !changedIds.includes(id))) {
		return "Bay flow edit relocation authority is not scoped to changed organizations";
	}
	for (const mutation of organizationMutations) {
		const record = mutation.after as StaticFabOrganizationRecord;
		if (mutation.id === review.bayOrganizationId && record.kind !== "BAY") {
			return "Bay flow edit Bay organization mutation has the wrong kind";
		}
		if (
			review.processLoopOrganizationIds.includes(mutation.id) &&
			(record.kind !== "AISLE" ||
				!staticFabOrganizationParentIds(record).includes(review.bayOrganizationId))
		) {
			return "Bay flow edit Process Loop mutation has the wrong kind or parent";
		}
	}

	const deltaResult = directedRailDeltaForMutations(mutations);
	if (typeof deltaResult === "string") return deltaResult;
	if (
		deltaResult.removed.size !== review.removedDirectedEdgeCount ||
		deltaResult.added.size !== review.addedDirectedEdgeCount ||
		review.changedCellCount !== mutations.length ||
		review.sourceDirectedEdgeCount !== review.targetDirectedEdgeCount ||
		review.removedDirectedEdgeCount !== review.addedDirectedEdgeCount ||
		review.targetDirectedEdgeCount !==
			review.sourceDirectedEdgeCount -
				review.removedDirectedEdgeCount +
				review.addedDirectedEdgeCount
	) {
		return "Bay flow edit review counts do not match its exact rail mutation delta";
	}
	const membershipDelta = organizationMembershipDelta(organizationMutations);
	if (
		!sameStringSet(deltaResult.removed, membershipDelta.removed) ||
		!sameStringSet(deltaResult.added, membershipDelta.added)
	) {
		return "Bay flow edit rail delta does not exactly match organization membership changes";
	}
	return gatewayConsistencyError(review, deltaResult);
}

function gatewayConsistencyError(
	review: StaticFabBayFlowEditReview,
	delta: DirectedRailDelta,
): string | null {
	const processLoopIds = new Set(review.processLoopOrganizationIds);
	if (
		review.bankOrganizationId === review.bayOrganizationId ||
		(review.bankOrganizationId !== null && processLoopIds.has(review.bankOrganizationId)) ||
		processLoopIds.has(review.bayOrganizationId)
	) {
		return "Bay flow edit review Bay, Bank, and Process Loop identities overlap";
	}
	const outbound = review.connectorBankToBayDirectedEdgeKeys;
	const returns = review.connectorBayToBankDirectedEdgeKeys;
	if (review.incidentConnectorCount === 0) {
		if (review.bankOrganizationId !== null || outbound.length !== 0 || returns.length !== 0) {
			return "detached Bay flow edit carried Bank or external gateway evidence";
		}
		return null;
	}
	if (review.bankOrganizationId === null || outbound.length === 0 || returns.length === 0) {
		return "attached Bay flow edit omitted exact Bank gateway evidence";
	}
	const outboundSet = new Set(outbound);
	for (const key of returns) {
		if (outboundSet.has(key)) return "Bay flow edit gateway direction lists overlap";
	}
	for (const key of [...outbound, ...returns]) {
		if (delta.removed.has(key) || delta.added.has(key)) {
			return "Bay flow edit changed a reviewed external gateway edge";
		}
	}
	return null;
}

function topologyEvidenceShapeError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS)) {
		return "Bay flow edit topology evidence fields are malformed";
	}
	if (
		!nonNegativeSafeInteger(value.authoredCellCount) ||
		!nonNegativeSafeInteger(value.authoredDirectedEdgeCount) ||
		!authoredStatus(value.authoredStatus) ||
		!nonNegativeSafeInteger(value.authoredComponentCount) ||
		!nonNegativeSafeInteger(value.authoredStrongComponentCount) ||
		!nonNegativeSafeInteger(value.authoredOpenTerminalCount) ||
		!nonNegativeSafeInteger(value.authoredUnsafeJunctionCount) ||
		typeof value.authoredComponentsClosed !== "boolean" ||
		typeof value.physicalValid !== "boolean" ||
		!nonNegativeSafeInteger(value.physicalPathCount) ||
		!nonNegativeSafeInteger(value.physicalComponentCount) ||
		!nonNegativeSafeInteger(value.physicalStrongComponentCount) ||
		!nonNegativeSafeInteger(value.physicalOpenPathCount) ||
		!nonNegativeSafeInteger(value.physicalInvalidPathCount) ||
		!nonNegativeSafeInteger(value.physicalDiagnosticCount) ||
		!nonNegativeSafeInteger(value.physicalTerminalCount) ||
		!nonNegativeSafeInteger(value.physicalClearanceIssueCount) ||
		typeof value.physicalComponentsClosed !== "boolean"
	) {
		return "Bay flow edit topology evidence values are malformed";
	}
	return null;
}

function validTopologyTransitionError(
	source: StaticFabBayFlowEditTopologyEvidence,
	prospective: StaticFabBayFlowEditTopologyEvidence,
): string | null {
	const sourceError = closedTopologyEvidenceError(source);
	if (sourceError) return `Bay flow edit source topology is not closed: ${sourceError}`;
	const prospectiveError = closedTopologyEvidenceError(prospective);
	if (prospectiveError) {
		return `Bay flow edit prospective topology is not closed: ${prospectiveError}`;
	}
	for (const key of [
		"authoredCellCount",
		"authoredDirectedEdgeCount",
		"authoredComponentCount",
		"authoredStrongComponentCount",
		"physicalPathCount",
		"physicalComponentCount",
		"physicalStrongComponentCount",
	] as const) {
		if (source[key] !== prospective[key]) {
			return "Bay flow edit topology evidence did not preserve full-map cell, edge, path, component, and SCC counts";
		}
	}
	return null;
}

function closedTopologyEvidenceError(
	evidence: StaticFabBayFlowEditTopologyEvidence,
): string | null {
	if (
		evidence.authoredCellCount < 1 ||
		evidence.authoredDirectedEdgeCount < 1 ||
		evidence.authoredComponentCount < 1 ||
		evidence.physicalPathCount < 1 ||
		evidence.authoredStatus !== (evidence.authoredComponentCount === 1 ? "closed" : "disconnected")
	) {
		return "status, component, cell, edge, or path evidence is inconsistent";
	}
	if (
		!evidence.authoredComponentsClosed ||
		!evidence.physicalComponentsClosed ||
		!evidence.physicalValid ||
		evidence.authoredOpenTerminalCount !== 0 ||
		evidence.authoredUnsafeJunctionCount !== 0 ||
		evidence.physicalOpenPathCount !== 0 ||
		evidence.physicalInvalidPathCount !== 0 ||
		evidence.physicalDiagnosticCount !== 0 ||
		evidence.physicalTerminalCount !== 0 ||
		evidence.physicalClearanceIssueCount !== 0
	) {
		return "open, unsafe, invalid, diagnostic, terminal, or clearance evidence remains";
	}
	if (
		evidence.authoredComponentCount !== evidence.authoredStrongComponentCount ||
		evidence.physicalComponentCount !== evidence.physicalStrongComponentCount ||
		evidence.authoredComponentCount !== evidence.physicalComponentCount ||
		evidence.authoredStrongComponentCount !== evidence.physicalStrongComponentCount
	) {
		return "authored and physical weak/strong component evidence diverged";
	}
	return null;
}

function bayFlowEditTicketShapeError(
	ticket: unknown,
	plan: StaticFabBayFlowEditPlan,
): string | null {
	if (!isRecord(ticket) || !hasExactKeys(ticket, TICKET_KEYS)) {
		return "Bay flow edit Worker ticket fields are malformed";
	}
	if (
		!positiveSafeInteger(ticket.ticketId) ||
		ticket.validationLevel !== "exact" ||
		!nonNegativeSafeInteger(ticket.sourceRevision) ||
		!nonNegativeSafeInteger(ticket.sourcePatchSequence) ||
		!railChecksum(ticket.sourceChecksum) ||
		!positiveCursor(ticket.sourceNextAdvancedSwitchId) ||
		!positiveCursor(ticket.sourceNextPortId) ||
		!positiveCursor(ticket.sourceNextEquipmentGroupId) ||
		!positiveCursor(ticket.sourceNextOrganizationId) ||
		!orderedFingerprint(ticket.intentFingerprint) ||
		!orderedFingerprint(ticket.planFingerprint) ||
		!orderedFingerprint(ticket.sourceAuthoredProjectionFingerprint) ||
		!orderedFingerprint(ticket.targetAuthoredProjectionFingerprint) ||
		!railChecksum(ticket.prospectiveChecksum) ||
		!positiveCursor(ticket.prospectiveNextAdvancedSwitchId) ||
		!positiveCursor(ticket.prospectiveNextPortId) ||
		!positiveCursor(ticket.prospectiveNextEquipmentGroupId) ||
		!positiveCursor(ticket.prospectiveNextOrganizationId)
	) {
		return "Bay flow edit Worker ticket values are malformed";
	}
	let expectedPlanFingerprint: string;
	try {
		expectedPlanFingerprint = staticFabBayFlowEditPlanFingerprint(plan);
	} catch {
		return "Bay flow edit Worker ticket could not fingerprint its plan";
	}
	const typedTicket = ticket as unknown as StaticFabBayFlowEditWorkerTicket;
	return typedTicket.sourceRevision === plan.baseRevision &&
		typedTicket.sourcePatchSequence === plan.basePatchSequence &&
		typedTicket.sourceNextOrganizationId === plan.nextOrganizationIdBefore &&
		typedTicket.prospectiveNextOrganizationId === plan.nextOrganizationIdAfter &&
		typedTicket.sourceNextAdvancedSwitchId === typedTicket.prospectiveNextAdvancedSwitchId &&
		typedTicket.sourceNextPortId === typedTicket.prospectiveNextPortId &&
		typedTicket.sourceNextEquipmentGroupId === typedTicket.prospectiveNextEquipmentGroupId &&
		typedTicket.sourceNextOrganizationId === typedTicket.prospectiveNextOrganizationId &&
		typedTicket.sourceChecksum !== typedTicket.prospectiveChecksum &&
		typedTicket.planFingerprint === expectedPlanFingerprint &&
		typedTicket.sourceAuthoredProjectionFingerprint ===
			plan.review.sourceAuthoredProjectionFingerprint &&
		typedTicket.targetAuthoredProjectionFingerprint ===
			plan.review.targetAuthoredProjectionFingerprint
		? null
		: "Bay flow edit Worker ticket does not bind its plan, fingerprints, checksums, and unchanged cursors";
}

function canonicalRailMutations(values: readonly unknown[]): boolean {
	let previous: RailMutation | null = null;
	for (const value of values) {
		if (!isRailMutation(value)) return false;
		if (previous && (value.y < previous.y || (value.y === previous.y && value.x <= previous.x))) {
			return false;
		}
		previous = value;
	}
	return true;
}

function isRailMutation(value: unknown): value is RailMutation {
	if (!isRecord(value) || !hasExactKeys(value, RAIL_MUTATION_KEYS)) return false;
	if (
		!int32(value.x) ||
		!int32(value.y) ||
		!byte(value.before) ||
		!byte(value.after) ||
		value.before === value.after
	) {
		return false;
	}
	try {
		decodeRailCell(value.before);
		decodeRailCell(value.after);
		return true;
	} catch {
		return false;
	}
}

function organizationMutationsShapeError(values: readonly unknown[]): string | null {
	let previousId = 0;
	let railEdgeReferences = 0;
	let switchReferences = 0;
	let equipmentGroupReferences = 0;
	for (const value of values) {
		if (
			!isRecord(value) ||
			!hasExactKeys(value, ORGANIZATION_MUTATION_KEYS) ||
			!positiveInt32(value.id) ||
			value.id <= previousId ||
			value.before === null ||
			value.after === null ||
			!isOrganizationRecord(value.before, value.id) ||
			!isOrganizationRecord(value.after, value.id)
		) {
			return "Bay flow edit organization mutations are malformed or not canonical";
		}
		previousId = value.id;
		const before = value.before;
		const after = value.after;
		if (!sameOrganizationMetadata(before, after)) {
			return "Bay flow edit organization mutation changed identity, hierarchy, or metadata";
		}
		if (
			!sameNumberArray(before.membership.advancedSwitchIds, after.membership.advancedSwitchIds) ||
			!sameNumberArray(before.membership.equipmentGroupIds, after.membership.equipmentGroupIds)
		) {
			return "Bay flow edit organization mutation changed switch or equipment membership";
		}
		if (sameDirectedEdgeArray(before.membership.railEdges, after.membership.railEdges)) {
			return "Bay flow edit organization mutation did not change rail membership";
		}
		for (const record of [before, after]) {
			railEdgeReferences += record.membership.railEdges.length;
			switchReferences += record.membership.advancedSwitchIds.length;
			equipmentGroupReferences += record.membership.equipmentGroupIds.length;
			if (
				railEdgeReferences > MAX_ORGANIZATION_MUTATION_RAIL_EDGE_REFERENCES ||
				switchReferences > MAX_ORGANIZATION_MUTATION_SWITCH_REFERENCES ||
				equipmentGroupReferences > MAX_ORGANIZATION_MUTATION_GROUP_REFERENCES
			) {
				return "Bay flow edit organization membership references exceed their aggregate budget";
			}
		}
	}
	return null;
}

function isOrganizationRecord(
	value: unknown,
	expectedId: number,
): value is StaticFabOrganizationRecord {
	if (
		!isRecord(value) ||
		!hasRequiredAllowedKeys(
			value,
			ORGANIZATION_RECORD_REQUIRED_KEYS,
			ORGANIZATION_RECORD_ALLOWED_KEYS,
		) ||
		value.id !== expectedId ||
		!STATIC_FAB_ORGANIZATION_KINDS.includes(
			value.kind as (typeof STATIC_FAB_ORGANIZATION_KINDS)[number],
		) ||
		!boundedNonEmptyText(value.name, MAX_ORGANIZATION_NAME_TEXT) ||
		!isRecord(value.membership) ||
		!hasExactKeys(value.membership, ORGANIZATION_MEMBERSHIP_KEYS)
	) {
		return false;
	}
	if (
		value.parentOrganizationIds !== undefined &&
		(!Array.isArray(value.parentOrganizationIds) ||
			value.parentOrganizationIds.length > STATIC_FAB_ORGANIZATION_MAX_PARENTS ||
			!canonicalPositiveInt32Ids(value.parentOrganizationIds))
	) {
		return false;
	}
	if (value.properties !== undefined) {
		if (
			!isRecord(value.properties) ||
			!hasExactKeys(value.properties, ORGANIZATION_PROPERTIES_KEYS)
		) {
			return false;
		}
		if (
			!boundedText(value.properties.description, STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH) ||
			!STATIC_FAB_ORGANIZATION_COLORS.includes(
				value.properties.color as (typeof STATIC_FAB_ORGANIZATION_COLORS)[number],
			)
		) {
			return false;
		}
	}
	const membership = value.membership;
	return (
		Array.isArray(membership.railEdges) &&
		membership.railEdges.length <= MAX_ORGANIZATION_RECORD_RAIL_EDGE_REFERENCES &&
		canonicalDirectedRailEdges(membership.railEdges) &&
		Array.isArray(membership.advancedSwitchIds) &&
		membership.advancedSwitchIds.length <= MAX_ORGANIZATION_RECORD_SWITCH_REFERENCES &&
		canonicalPositiveInt32Ids(membership.advancedSwitchIds) &&
		Array.isArray(membership.equipmentGroupIds) &&
		membership.equipmentGroupIds.length <= MAX_ORGANIZATION_RECORD_GROUP_REFERENCES &&
		canonicalPositiveInt32Ids(membership.equipmentGroupIds)
	);
}

function sameOrganizationMetadata(
	before: StaticFabOrganizationRecord,
	after: StaticFabOrganizationRecord,
): boolean {
	const beforeProperties = staticFabOrganizationProperties(before);
	const afterProperties = staticFabOrganizationProperties(after);
	return (
		before.id === after.id &&
		before.kind === after.kind &&
		before.name === after.name &&
		sameNumberArray(
			staticFabOrganizationParentIds(before),
			staticFabOrganizationParentIds(after),
		) &&
		beforeProperties.description === afterProperties.description &&
		beforeProperties.color === afterProperties.color
	);
}

function canonicalDirectedRailEdges(value: readonly unknown[]): boolean {
	let previous: StaticFabOrganizationRecord["membership"]["railEdges"][number] | null = null;
	for (const item of value) {
		if (
			!isRecord(item) ||
			!hasExactKeys(item, EDGE_KEYS) ||
			!isCell(item.from) ||
			!isCell(item.to) ||
			!cardinalNeighbors(item.from, item.to)
		) {
			return false;
		}
		const edge = item as unknown as StaticFabOrganizationRecord["membership"]["railEdges"][number];
		if (previous && compareDirectedRailEdges(previous, edge) >= 0) return false;
		previous = edge;
	}
	return true;
}

function directedRailDeltaForMutations(
	values: readonly RailMutation[],
): DirectedRailDelta | string {
	const outgoingRemoved = new Set<string>();
	const outgoingAdded = new Set<string>();
	const incomingRemoved = new Set<string>();
	const incomingAdded = new Set<string>();
	for (const mutation of values) {
		const before = decodeRailCell(mutation.before);
		const after = decodeRailCell(mutation.after);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(mutation, direction);
			collectChangedBit(
				(before.outgoing & direction) !== 0,
				(after.outgoing & direction) !== 0,
				staticFabOrganizationEdgeKey({ from: mutation, to: neighbor }),
				outgoingRemoved,
				outgoingAdded,
			);
			collectChangedBit(
				(before.incoming & direction) !== 0,
				(after.incoming & direction) !== 0,
				staticFabOrganizationEdgeKey({ from: neighbor, to: mutation }),
				incomingRemoved,
				incomingAdded,
			);
		}
	}
	if (
		!sameStringSet(outgoingRemoved, incomingRemoved) ||
		!sameStringSet(outgoingAdded, incomingAdded)
	) {
		return "Bay flow edit directed-edge mutations are not exactly reciprocal";
	}
	if (outgoingRemoved.size === 0 || outgoingAdded.size === 0) {
		return "Bay flow edit mutations did not replace both removed and added directed edges";
	}
	return Object.freeze({ removed: outgoingRemoved, added: outgoingAdded });
}

function organizationMembershipDelta(
	mutations: readonly StaticFabOrganizationMutation[],
): DirectedRailDelta {
	const before = new Set<string>();
	const after = new Set<string>();
	for (const mutation of mutations) {
		for (const edge of mutation.before?.membership.railEdges ?? []) {
			before.add(staticFabOrganizationEdgeKey(edge));
		}
		for (const edge of mutation.after?.membership.railEdges ?? []) {
			after.add(staticFabOrganizationEdgeKey(edge));
		}
	}
	return Object.freeze({
		removed: new Set([...before].filter((key) => !after.has(key))),
		added: new Set([...after].filter((key) => !before.has(key))),
	});
}

function collectChangedBit(
	before: boolean,
	after: boolean,
	key: string,
	removed: Set<string>,
	added: Set<string>,
): void {
	if (before === after) return;
	if (before) removed.add(key);
	else added.add(key);
}

function reviewsEqual(left: Record<string, unknown>, right: unknown): boolean {
	if (!isRecord(right) || !hasExactKeys(left, REVIEW_KEYS) || !hasExactKeys(right, REVIEW_KEYS)) {
		return false;
	}
	for (const key of REVIEW_KEYS) {
		const leftValue = left[key];
		const rightValue = right[key];
		if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
			if (!sameArray(leftValue, rightValue)) return false;
		} else if (leftValue !== rightValue) return false;
	}
	return true;
}

function boundedGatewayKeyList(value: unknown, limit: number): value is readonly string[] {
	if (!Array.isArray(value) || value.length > limit) return false;
	const seen = new Set<string>();
	let previousTarget: string | null = null;
	for (const item of value) {
		const parsed = boundedNonEmptyText(item, MAX_GATEWAY_KEY_TEXT)
			? parseDirectedEdgeKey(item)
			: null;
		if (
			!parsed ||
			(previousTarget !== null && previousTarget !== cellCoordinateKey(parsed.from)) ||
			seen.has(item)
		) {
			return false;
		}
		seen.add(item);
		previousTarget = cellCoordinateKey(parsed.to);
	}
	return true;
}

function parseDirectedEdgeKey(value: string): { readonly from: Cell; readonly to: Cell } | null {
	const match = /^(-?\d+):(-?\d+)>(-?\d+):(-?\d+)$/.exec(value);
	if (!match) return null;
	const coordinates = match.slice(1).map(Number);
	if (
		!coordinates.every(int32) ||
		Math.abs((coordinates[0] as number) - (coordinates[2] as number)) +
			Math.abs((coordinates[1] as number) - (coordinates[3] as number)) !==
			1
	) {
		return null;
	}
	return Object.freeze({
		from: Object.freeze({ x: coordinates[0] as number, y: coordinates[1] as number }),
		to: Object.freeze({ x: coordinates[2] as number, y: coordinates[3] as number }),
	});
}

function cellCoordinateKey(cell: Cell): string {
	return `${cell.x}:${cell.y}`;
}

function boundedCanonicalIds(value: unknown, limit: number): value is readonly number[] {
	return Array.isArray(value) && value.length <= limit && canonicalPositiveInt32Ids(value);
}

function canonicalPositiveInt32Ids(value: readonly unknown[]): boolean {
	let previous = 0;
	for (const id of value) {
		if (!positiveInt32(id) || id <= previous) return false;
		previous = id;
	}
	return true;
}

function sameDirectedEdgeArray(
	left: StaticFabOrganizationRecord["membership"]["railEdges"],
	right: StaticFabOrganizationRecord["membership"]["railEdges"],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(edge, index) =>
				staticFabOrganizationEdgeKey(edge) ===
				staticFabOrganizationEdgeKey(right[index] as (typeof right)[number]),
		)
	);
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	return left.size === right.size && [...left].every((key) => right.has(key));
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validFailureCode(value: unknown, valid: boolean): boolean {
	return valid
		? value === null
		: value === "snapshot" ||
				value === "intent" ||
				value === "fingerprint" ||
				value === "stale" ||
				value === "source-topology" ||
				value === "plan" ||
				value === "prospective" ||
				value === "topology" ||
				value === "compile";
}

function bayFlowEditIssueCode(value: unknown): value is StaticFabBayFlowEditIssueCode {
	return (
		value === "INVALID_INTENT" ||
		value === "STALE_SOURCE" ||
		value === "INVALID_SOURCE" ||
		value === "UNSUPPORTED_HIERARCHY" ||
		value === "SOURCE_NOT_RECOGNIZED" ||
		value === "TARGET_NOOP" ||
		value === "UNSUPPORTED_DEPENDENCY" ||
		value === "MUTATION_INVALID" ||
		value === "ORGANIZATION_INVALID" ||
		value === "EXTERNAL_GATEWAY_CHANGED" ||
		value === "TARGET_NOT_RECOGNIZED"
	);
}

function authoredStatus(value: unknown): boolean {
	return (
		value === "empty" ||
		value === "open" ||
		value === "disconnected" ||
		value === "unsafe" ||
		value === "closed"
	);
}

function isFlowPattern(value: unknown): value is "alternating" | "co-rotating" {
	return value === "alternating" || value === "co-rotating";
}

function cardinalNeighbors(left: Cell, right: Cell): boolean {
	return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function isCell(value: unknown): value is Cell {
	return isRecord(value) && hasExactKeys(value, CELL_KEYS) && int32(value.x) && int32(value.y);
}

function byte(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xff;
}

function int32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}

function int32IdOrZero(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0x7fff_ffff;
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function positiveCursor(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 0x8000_0000;
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

function orderedFingerprint(value: unknown): value is string {
	return typeof value === "string" && ORDERED_FINGERPRINT_PATTERN.test(value);
}

function railChecksum(value: unknown): value is string {
	return typeof value === "string" && RAIL_CHECKSUM_PATTERN.test(value);
}

function boundedNonEmptyText(value: unknown, limit: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function boundedText(value: unknown, limit: number): value is string {
	return typeof value === "string" && value.length <= limit;
}

function hasRequiredAllowedKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	allowed: readonly string[],
): boolean {
	const allowedSet = new Set(allowed);
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		Object.keys(value).every((key) => allowedSet.has(key))
	);
}

function hasExactKeys<const Keys extends readonly string[]>(
	value: Record<string, unknown>,
	keys: Keys,
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPreparedStaticFabBayFlowEdit(
	value: unknown,
): asserts value is PreparedStaticFabBayFlowEdit {
	const error = staticFabBayFlowEditPreparedShapeError(value);
	if (error) throw new Error(error);
}
