import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	advancedSwitchRecordError,
} from "../core/AdvancedSwitch";
import {
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	equipmentGroupError,
} from "../core/EquipmentGroup";
import { type PortMutation, type PortRecord, portRecordError } from "../core/PortRecord";
import type { RailMutation } from "../core/paint";
import {
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";
import type {
	StaticFabSemanticBayMutationIssueCode,
	StaticFabSemanticBayMutationPlan,
	StaticFabSemanticBayMutationReview,
} from "../core/StaticFabSemanticBayMutation";
import { type Cell, decodeRailCell } from "../core/TileMap";
import {
	type PreparedStaticFabSemanticBayMutation,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_EQUIPMENT_GROUP_MUTATIONS,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_ORGANIZATION_MUTATIONS,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_PORT_MUTATIONS,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RAIL_MUTATIONS,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_REVIEW_IDS,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_REVIEW_KEYS,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_SWITCH_MUTATIONS,
	type StaticFabSemanticBayMutationTopologyEvidence,
} from "./StaticFabSemanticBayMutationProtocol";

const MAX_ORGANIZATION_RECORD_TEXT = 500;
const MAX_ORGANIZATION_RECORD_RAIL_EDGE_REFERENCES = 1_000_000;
const MAX_ORGANIZATION_RECORD_SWITCH_REFERENCES = 65_536;
const MAX_ORGANIZATION_RECORD_GROUP_REFERENCES = 65_536;
const MAX_ORGANIZATION_MUTATION_RAIL_EDGE_REFERENCES = 1_000_000;
const MAX_ORGANIZATION_MUTATION_SWITCH_REFERENCES = 65_536;
const MAX_ORGANIZATION_MUTATION_GROUP_REFERENCES = 65_536;
const MAX_REVIEW_TEXT = 512;

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
	"action",
	"bayOrganizationId",
	"bayName",
	"bankOrganizationId",
	"removedOrganizationIds",
	"processLoopOrganizationIds",
	"processLoopCount",
	"railModuleCount",
	"railModuleKeys",
	"bayDirectedEdgeCount",
	"incidentConnectorCount",
	"connectorDirectedEdgeCount",
	"connectorOutboundDirectedEdgeKeys",
	"connectorReturnDirectedEdgeKeys",
	"advancedSwitchCount",
	"equipmentGroupCount",
	"equipmentGroupIds",
	"portCount",
	"portIds",
	"remainingBankDirectedEdgeCount",
	"retainedCirculationCandidatePresent",
	"circulationCertification",
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
	"prospectiveChecksum",
	"prospectiveNextAdvancedSwitchId",
	"prospectiveNextPortId",
	"prospectiveNextEquipmentGroupId",
	"prospectiveNextOrganizationId",
] as const);

/** Bounded structural and cross-field gate used by both Worker entry and main-thread bridge. */
export function staticFabSemanticBayMutationPreparedShapeError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, PREPARED_KEYS)) {
		return "semantic Bay prepared payload fields are malformed";
	}
	if (
		typeof value.valid !== "boolean" ||
		!validFailureCode(value.failureCode, value.valid) ||
		!boundedText(value.reason, STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT) ||
		!nonNegativeFinite(value.planningMilliseconds) ||
		!nonNegativeFinite(value.validationMilliseconds)
	) {
		return "semantic Bay prepared status is malformed";
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
		if (value.review !== null) return "semantic Bay review exists without a plan";
	} else {
		const error = semanticBayPlanShapeError(value.plan, value.valid ? "full" : "compact");
		if (error) return error;
		const planRecord = value.plan as Record<string, unknown>;
		if (!isRecord(value.review) || !reviewsEqual(value.review, planRecord.review)) {
			return "semantic Bay prepared review does not exactly match plan.review";
		}
	}
	if (!value.valid) {
		if (value.ticket !== null) return "rejected semantic Bay mutation carried a Worker ticket";
		if (isRecord(value.plan) && value.plan.valid === true) {
			return "rejected semantic Bay mutation carried a valid plan";
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
		return "valid semantic Bay mutation omitted exact plan, ticket, review, or topology evidence";
	}
	const plan = value.plan as unknown as StaticFabSemanticBayMutationPlan;
	const sourceEvidence =
		value.sourceEvidence as unknown as StaticFabSemanticBayMutationTopologyEvidence;
	const prospectiveEvidence =
		value.prospectiveEvidence as unknown as StaticFabSemanticBayMutationTopologyEvidence;
	const topologyError = validTopologyTransitionError(plan, sourceEvidence, prospectiveEvidence);
	if (topologyError) return topologyError;
	return semanticBayTicketShapeError(value.ticket, plan);
}

export function semanticBayPlanShapeError(value: unknown, mode: "compact" | "full"): string | null {
	if (!isRecord(value) || !hasExactKeys(value, PLAN_KEYS)) {
		return "semantic Bay plan fields are malformed";
	}
	if (
		(value.kind !== "disconnect-static-fab-bay" && value.kind !== "delete-static-fab-bay") ||
		typeof value.valid !== "boolean" ||
		!boundedText(value.reason, STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RESPONSE_TEXT) ||
		!nonNegativeSafeInteger(value.baseRevision) ||
		!nonNegativeSafeInteger(value.basePatchSequence) ||
		!positiveCursor(value.nextOrganizationIdBefore) ||
		!positiveCursor(value.nextOrganizationIdAfter) ||
		(value.issueCode !== null && !semanticBayIssueCode(value.issueCode)) ||
		!Array.isArray(value.mutations) ||
		!Array.isArray(value.switchMutations) ||
		!Array.isArray(value.portMutations) ||
		!Array.isArray(value.equipmentGroupMutations) ||
		!Array.isArray(value.organizationMutations) ||
		!Array.isArray(value.organizationImpactAuthorizations)
	) {
		return "semantic Bay plan scalar fields are malformed";
	}
	const reviewError = semanticBayReviewShapeError(value.review, mode);
	if (reviewError) return reviewError;
	const review = value.review as unknown as StaticFabSemanticBayMutationReview;
	if (
		(value.kind === "disconnect-static-fab-bay" && review.action !== "DISCONNECT") ||
		(value.kind === "delete-static-fab-bay" && review.action !== "DELETE")
	) {
		return "semantic Bay plan kind and review action diverged";
	}
	if (
		value.mutations.length > STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_RAIL_MUTATIONS ||
		!uniqueRailMutations(value.mutations) ||
		value.switchMutations.length > STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_SWITCH_MUTATIONS ||
		!uniqueMutations(value.switchMutations, isAdvancedSwitchMutation) ||
		value.portMutations.length > STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_PORT_MUTATIONS ||
		!uniqueMutations(value.portMutations, isPortMutation) ||
		value.equipmentGroupMutations.length >
			STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_EQUIPMENT_GROUP_MUTATIONS ||
		!uniqueMutations(value.equipmentGroupMutations, isEquipmentGroupMutation) ||
		value.organizationMutations.length >
			STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_ORGANIZATION_MUTATIONS ||
		value.organizationImpactAuthorizations.length >
			STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_ORGANIZATION_MUTATIONS ||
		!canonicalPositiveInt32Ids(value.organizationImpactAuthorizations)
	) {
		return "semantic Bay plan exceeds or violates its mutation budgets";
	}
	const organizationMutationError = organizationMutationsShapeError(value.organizationMutations);
	if (organizationMutationError) return organizationMutationError;
	if (hasDeletedOrganizationAuthorization(value)) {
		return "semantic Bay plan authorizes an organization deleted by the same patch";
	}
	if (mode === "compact") {
		if (
			value.valid !== false ||
			value.mutations.length !== 0 ||
			value.switchMutations.length !== 0 ||
			value.portMutations.length !== 0 ||
			value.equipmentGroupMutations.length !== 0 ||
			value.organizationMutations.length !== 0 ||
			value.organizationImpactAuthorizations.length !== 0 ||
			value.nextOrganizationIdAfter !== value.nextOrganizationIdBefore
		) {
			return "compact rejected semantic Bay plan carried authored authority";
		}
		return null;
	}
	if (value.valid !== true || value.issueCode !== null || review.issueCode !== null) {
		return "full semantic Bay plan is not valid";
	}
	if (value.mutations.length === 0 || value.organizationMutations.length === 0) {
		return "full semantic Bay plan omitted its rail or organization mutation";
	}
	return null;
}

function semanticBayReviewShapeError(value: unknown, mode: "compact" | "full"): string | null {
	if (!isRecord(value) || !hasExactKeys(value, REVIEW_KEYS)) {
		return "semantic Bay review fields are malformed";
	}
	const listLimit =
		mode === "compact"
			? STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT
			: STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_REVIEW_IDS;
	const keyLimit =
		mode === "compact"
			? STATIC_FAB_SEMANTIC_BAY_MUTATION_COMPACT_REVIEW_LIMIT
			: STATIC_FAB_SEMANTIC_BAY_MUTATION_MAX_REVIEW_KEYS;
	if (
		value.version !== 1 ||
		(value.action !== "DISCONNECT" && value.action !== "DELETE") ||
		!positiveInt32(value.bayOrganizationId) ||
		!boundedNonEmptyText(value.bayName, MAX_REVIEW_TEXT) ||
		(value.bankOrganizationId !== null && !positiveInt32(value.bankOrganizationId)) ||
		!nonNegativeSafeInteger(value.processLoopCount) ||
		!nonNegativeSafeInteger(value.railModuleCount) ||
		!nonNegativeSafeInteger(value.bayDirectedEdgeCount) ||
		(value.incidentConnectorCount !== 0 && value.incidentConnectorCount !== 1) ||
		!nonNegativeSafeInteger(value.connectorDirectedEdgeCount) ||
		!nonNegativeSafeInteger(value.advancedSwitchCount) ||
		!nonNegativeSafeInteger(value.equipmentGroupCount) ||
		!nonNegativeSafeInteger(value.portCount) ||
		!nonNegativeSafeInteger(value.remainingBankDirectedEdgeCount) ||
		typeof value.retainedCirculationCandidatePresent !== "boolean" ||
		value.circulationCertification !== "PENDING_WORKER_CERTIFICATION" ||
		(value.issueCode !== null && !semanticBayIssueCode(value.issueCode))
	) {
		return "semantic Bay review scalar fields are malformed";
	}
	if (
		!boundedCanonicalIds(value.removedOrganizationIds, listLimit) ||
		!boundedCanonicalIds(value.processLoopOrganizationIds, listLimit) ||
		!boundedStringList(value.railModuleKeys, keyLimit, MAX_REVIEW_TEXT) ||
		!boundedStringList(value.connectorOutboundDirectedEdgeKeys, keyLimit, 128) ||
		!boundedStringList(value.connectorReturnDirectedEdgeKeys, keyLimit, 128) ||
		!boundedCanonicalIds(value.equipmentGroupIds, listLimit) ||
		!boundedCanonicalIds(value.portIds, listLimit)
	) {
		return "semantic Bay review arrays are malformed or exceed their budgets";
	}
	if (mode === "full") {
		if (
			value.processLoopCount !== value.processLoopOrganizationIds.length ||
			value.railModuleCount !== value.railModuleKeys.length ||
			value.connectorDirectedEdgeCount !==
				value.connectorOutboundDirectedEdgeKeys.length +
					value.connectorReturnDirectedEdgeKeys.length ||
			value.equipmentGroupCount !== value.equipmentGroupIds.length ||
			value.portCount !== value.portIds.length
		) {
			return "semantic Bay review counts do not match their exact arrays";
		}
	}
	return null;
}

function topologyEvidenceShapeError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS)) {
		return "semantic Bay topology evidence fields are malformed";
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
		return "semantic Bay topology evidence values are malformed";
	}
	return null;
}

function validTopologyTransitionError(
	plan: StaticFabSemanticBayMutationPlan,
	source: StaticFabSemanticBayMutationTopologyEvidence,
	prospective: StaticFabSemanticBayMutationTopologyEvidence,
): string | null {
	const sourceError = closedTopologyEvidenceError(source, false);
	if (sourceError) return `semantic Bay source topology is not closed: ${sourceError}`;
	const detachedDelete =
		plan.review.action === "DELETE" && plan.review.incidentConnectorCount === 0;
	const prospectiveError = closedTopologyEvidenceError(prospective, detachedDelete);
	if (prospectiveError) {
		return `semantic Bay prospective topology is not closed: ${prospectiveError}`;
	}
	const delta =
		plan.review.action === "DISCONNECT" ? 1 : plan.review.incidentConnectorCount === 0 ? -1 : 0;
	if (
		prospective.authoredComponentCount !== source.authoredComponentCount + delta ||
		prospective.physicalComponentCount !== source.physicalComponentCount + delta
	) {
		return "semantic Bay topology evidence has the wrong action-relative component delta";
	}
	if (
		(plan.review.action === "DISCONNECT" && plan.review.incidentConnectorCount !== 1) ||
		(plan.review.incidentConnectorCount === 0 && plan.review.bankOrganizationId !== null) ||
		(plan.review.incidentConnectorCount === 1 && plan.review.bankOrganizationId === null)
	) {
		return "semantic Bay review connector and Bank evidence diverged";
	}
	return null;
}

function closedTopologyEvidenceError(
	evidence: StaticFabSemanticBayMutationTopologyEvidence,
	allowEmpty: boolean,
): string | null {
	const empty = evidence.authoredCellCount === 0;
	if (empty && !allowEmpty) return "empty source";
	if (
		empty &&
		(evidence.authoredStatus !== "empty" ||
			evidence.authoredComponentCount !== 0 ||
			evidence.authoredStrongComponentCount !== 0 ||
			evidence.physicalPathCount !== 0 ||
			evidence.physicalComponentCount !== 0 ||
			evidence.physicalStrongComponentCount !== 0)
	) {
		return "empty state retained components";
	}
	if (
		!empty &&
		(evidence.authoredStatus !==
			(evidence.authoredComponentCount === 1 ? "closed" : "disconnected") ||
			evidence.authoredComponentCount < 1 ||
			evidence.physicalPathCount < 1)
	) {
		return "status/component/path mismatch";
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
		evidence.physicalClearanceIssueCount !== 0 ||
		evidence.authoredComponentCount !== evidence.authoredStrongComponentCount ||
		evidence.physicalComponentCount !== evidence.physicalStrongComponentCount ||
		evidence.authoredComponentCount !== evidence.physicalComponentCount
	) {
		return "closure, diagnostic, or authored/physical parity failed";
	}
	return null;
}

function semanticBayTicketShapeError(
	ticket: unknown,
	plan: StaticFabSemanticBayMutationPlan,
): string | null {
	if (!isRecord(ticket) || !hasExactKeys(ticket, TICKET_KEYS)) {
		return "semantic Bay Worker ticket fields are malformed";
	}
	if (
		!positiveSafeInteger(ticket.ticketId) ||
		ticket.validationLevel !== "exact" ||
		!nonNegativeSafeInteger(ticket.sourceRevision) ||
		!nonNegativeSafeInteger(ticket.sourcePatchSequence) ||
		!boundedFingerprint(ticket.sourceChecksum) ||
		!positiveCursor(ticket.sourceNextAdvancedSwitchId) ||
		!positiveCursor(ticket.sourceNextPortId) ||
		!positiveCursor(ticket.sourceNextEquipmentGroupId) ||
		!positiveCursor(ticket.sourceNextOrganizationId) ||
		!boundedFingerprint(ticket.intentFingerprint) ||
		!boundedFingerprint(ticket.planFingerprint) ||
		!boundedFingerprint(ticket.prospectiveChecksum) ||
		!positiveCursor(ticket.prospectiveNextAdvancedSwitchId) ||
		!positiveCursor(ticket.prospectiveNextPortId) ||
		!positiveCursor(ticket.prospectiveNextEquipmentGroupId) ||
		!positiveCursor(ticket.prospectiveNextOrganizationId)
	) {
		return "semantic Bay Worker ticket values are malformed";
	}
	return ticket.sourceRevision === plan.baseRevision &&
		ticket.sourcePatchSequence === plan.basePatchSequence &&
		ticket.sourceNextOrganizationId === plan.nextOrganizationIdBefore &&
		ticket.prospectiveNextOrganizationId === plan.nextOrganizationIdAfter &&
		ticket.sourceNextAdvancedSwitchId === ticket.prospectiveNextAdvancedSwitchId &&
		ticket.sourceNextPortId === ticket.prospectiveNextPortId &&
		ticket.sourceNextEquipmentGroupId === ticket.prospectiveNextEquipmentGroupId &&
		ticket.sourceNextOrganizationId === ticket.prospectiveNextOrganizationId
		? null
		: "semantic Bay Worker ticket does not bind its plan and unchanged cursors";
}

function uniqueRailMutations(values: readonly unknown[]): boolean {
	const cells = new Set<string>();
	for (const value of values) {
		if (!isRailMutation(value)) return false;
		const key = `${value.x}:${value.y}`;
		if (cells.has(key)) return false;
		cells.add(key);
	}
	return true;
}

function uniqueMutations(
	values: readonly unknown[],
	validator: (value: unknown) => value is { readonly id: number },
): boolean {
	const ids = new Set<number>();
	for (const value of values) {
		if (!validator(value) || ids.has(value.id)) return false;
		ids.add(value.id);
	}
	return true;
}

function isRailMutation(value: unknown): value is RailMutation {
	if (!isRecord(value) || !hasExactKeys(value, ["x", "y", "before", "after"] as const)) {
		return false;
	}
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

function isAdvancedSwitchMutation(value: unknown): value is AdvancedSwitchMutation {
	if (!isRecord(value) || !hasExactKeys(value, ["id", "before", "after"] as const)) return false;
	if (!positiveInt32(value.id) || (value.before === null && value.after === null)) return false;
	return (
		(value.before === null || isAdvancedSwitchRecord(value.before, value.id)) &&
		(value.after === null || isAdvancedSwitchRecord(value.after, value.id))
	);
}

function isAdvancedSwitchRecord(value: unknown, expectedId: number): value is AdvancedSwitchRecord {
	if (!isRecord(value) || value.id !== expectedId) return false;
	try {
		return advancedSwitchRecordError(value as unknown as AdvancedSwitchRecord) === null;
	} catch {
		return false;
	}
}

function isPortMutation(value: unknown): value is PortMutation {
	if (!isRecord(value) || !hasExactKeys(value, ["id", "before", "after"] as const)) return false;
	if (!positiveInt32(value.id) || (value.before === null && value.after === null)) return false;
	return (
		(value.before === null || isPortRecord(value.before, value.id)) &&
		(value.after === null || isPortRecord(value.after, value.id))
	);
}

function isPortRecord(value: unknown, expectedId: number): value is PortRecord {
	if (!isRecord(value) || value.id !== expectedId || !isRecord(value.route)) return false;
	try {
		return portRecordError(value as unknown as PortRecord) === null;
	} catch {
		return false;
	}
}

function isEquipmentGroupMutation(value: unknown): value is EquipmentGroupMutation {
	if (!isRecord(value) || !hasExactKeys(value, ["id", "before", "after"] as const)) return false;
	if (!positiveInt32(value.id) || (value.before === null && value.after === null)) return false;
	return (
		(value.before === null || isEquipmentGroupRecord(value.before, value.id)) &&
		(value.after === null || isEquipmentGroupRecord(value.after, value.id))
	);
}

function isEquipmentGroupRecord(value: unknown, expectedId: number): value is EquipmentGroupRecord {
	if (!isRecord(value) || value.id !== expectedId || !Array.isArray(value.portIds)) return false;
	try {
		return equipmentGroupError(value as unknown as EquipmentGroupRecord) === null;
	} catch {
		return false;
	}
}

function isOrganizationMutation(value: unknown): value is StaticFabOrganizationMutation {
	if (!isRecord(value) || !hasExactKeys(value, ["id", "before", "after"] as const)) return false;
	if (!positiveInt32(value.id) || (value.before === null && value.after === null)) return false;
	return (
		(value.before === null || isOrganizationRecord(value.before, value.id)) &&
		(value.after === null || isOrganizationRecord(value.after, value.id))
	);
}

function organizationMutationsShapeError(values: readonly unknown[]): string | null {
	const ids = new Set<number>();
	let railEdgeReferences = 0;
	let switchReferences = 0;
	let equipmentGroupReferences = 0;
	for (const value of values) {
		if (!isOrganizationMutation(value) || ids.has(value.id)) {
			return "semantic Bay plan exceeds or violates its mutation budgets";
		}
		ids.add(value.id);
		for (const record of [value.before, value.after]) {
			if (record === null) continue;
			railEdgeReferences += record.membership.railEdges.length;
			switchReferences += record.membership.advancedSwitchIds.length;
			equipmentGroupReferences += record.membership.equipmentGroupIds.length;
			if (
				railEdgeReferences > MAX_ORGANIZATION_MUTATION_RAIL_EDGE_REFERENCES ||
				switchReferences > MAX_ORGANIZATION_MUTATION_SWITCH_REFERENCES ||
				equipmentGroupReferences > MAX_ORGANIZATION_MUTATION_GROUP_REFERENCES
			) {
				return "semantic Bay organization membership references exceed their aggregate budget";
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
		value.id !== expectedId ||
		!STATIC_FAB_ORGANIZATION_KINDS.includes(
			value.kind as (typeof STATIC_FAB_ORGANIZATION_KINDS)[number],
		) ||
		!boundedNonEmptyText(value.name, 120) ||
		!isRecord(value.membership)
	) {
		return false;
	}
	try {
		const record = value as unknown as StaticFabOrganizationRecord;
		const parents = staticFabOrganizationParentIds(record);
		const properties = staticFabOrganizationProperties(record);
		return (
			parents.length <= 32 &&
			canonicalPositiveInt32Ids(parents) &&
			boundedText(properties.description, MAX_ORGANIZATION_RECORD_TEXT) &&
			boundedText(properties.color, 16) &&
			Array.isArray(record.membership.railEdges) &&
			record.membership.railEdges.length <= MAX_ORGANIZATION_RECORD_RAIL_EDGE_REFERENCES &&
			record.membership.railEdges.every(
				(edge) => isCell(edge.from) && isCell(edge.to) && cardinalNeighbors(edge.from, edge.to),
			) &&
			Array.isArray(record.membership.advancedSwitchIds) &&
			record.membership.advancedSwitchIds.length <= MAX_ORGANIZATION_RECORD_SWITCH_REFERENCES &&
			canonicalPositiveInt32Ids(record.membership.advancedSwitchIds) &&
			Array.isArray(record.membership.equipmentGroupIds) &&
			record.membership.equipmentGroupIds.length <= MAX_ORGANIZATION_RECORD_GROUP_REFERENCES &&
			canonicalPositiveInt32Ids(record.membership.equipmentGroupIds)
		);
	} catch {
		return false;
	}
}

function hasDeletedOrganizationAuthorization(plan: Record<string, unknown>): boolean {
	const mutations = plan.organizationMutations as readonly StaticFabOrganizationMutation[];
	const authorizations = plan.organizationImpactAuthorizations as readonly number[];
	const deletedIds = new Set(
		mutations
			.filter((mutation) => mutation.before !== null && mutation.after === null)
			.map((mutation) => mutation.id),
	);
	return authorizations.some((id) => deletedIds.has(id));
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

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function boundedCanonicalIds(value: unknown, limit: number): value is readonly number[] {
	return Array.isArray(value) && value.length <= limit && canonicalPositiveInt32Ids(value);
}

function boundedStringList(
	value: unknown,
	limit: number,
	textLimit: number,
): value is readonly string[] {
	if (!Array.isArray(value) || value.length > limit) return false;
	const seen = new Set<string>();
	for (const item of value) {
		if (!boundedNonEmptyText(item, textLimit) || seen.has(item)) return false;
		seen.add(item);
	}
	return true;
}

function canonicalPositiveInt32Ids(value: readonly unknown[]): boolean {
	let previous = 0;
	for (const id of value) {
		if (!positiveInt32(id) || id <= previous) return false;
		previous = id;
	}
	return true;
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

function semanticBayIssueCode(value: unknown): value is StaticFabSemanticBayMutationIssueCode {
	return (
		value === "INVALID_SOURCE" ||
		value === "STALE_SOURCE" ||
		value === "MISSING_BAY" ||
		value === "UNSUPPORTED_ORGANIZATION" ||
		value === "ALREADY_DISCONNECTED" ||
		value === "AMBIGUOUS_HIERARCHY" ||
		value === "SHARED_ORGANIZATION_DEPENDENCY" ||
		value === "ANCESTOR_COLLAPSE_UNRESOLVED" ||
		value === "CONNECTOR_NOT_RECOGNIZED" ||
		value === "AMBIGUOUS_CONNECTOR" ||
		value === "SHARED_CONNECTOR_OWNERSHIP" ||
		value === "CONNECTOR_EQUIPMENT_DEPENDENCY" ||
		value === "PARTIAL_EQUIPMENT_GROUP" ||
		value === "LEGACY_CUSTOM_EQUIPMENT" ||
		value === "MUTATION_INVALID" ||
		value === "ORGANIZATION_INVALID"
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

function cardinalNeighbors(left: Cell, right: Cell): boolean {
	return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function isCell(value: unknown): value is Cell {
	return isRecord(value) && int32(value.x) && int32(value.y);
}

function byte(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xff;
}

function int32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
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

function boundedFingerprint(value: unknown): value is string {
	return boundedNonEmptyText(value, 512);
}

function boundedNonEmptyText(value: unknown, limit: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function boundedText(value: unknown, limit: number): value is string {
	return typeof value === "string" && value.length <= limit;
}

function hasExactKeys<const T extends readonly string[]>(
	value: Record<string, unknown>,
	keys: T,
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function assertPreparedStaticFabSemanticBayMutation(
	value: unknown,
): asserts value is PreparedStaticFabSemanticBayMutation {
	const error = staticFabSemanticBayMutationPreparedShapeError(value);
	if (error) throw new Error(error);
}
