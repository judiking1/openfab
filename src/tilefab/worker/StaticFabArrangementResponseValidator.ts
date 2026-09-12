import {
	STATIC_FAB_ARRANGEMENT_MAX_PORTS,
	STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES,
} from "../compile/StaticFabArrangementPlanner";
import {
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchRecord,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { completeCooperativeSteps } from "../core/CooperativeTask";
import { freezeTransferDataContainersSteps } from "../core/ImmutableDataContainers";
import { PORT_RECORD_MAX_ID, type PortRecord, portRecordError } from "../core/PortRecord";
import type { RailMutation } from "../core/paint";
import { classifyRailCell } from "../core/RailCellClassification";
import {
	STATIC_FAB_ARRANGEMENT_MAX_ROOTS,
	type StaticFabArrangementBounds,
	type StaticFabArrangementTranslation,
} from "../core/StaticFabArrangement";
import {
	type StaticFabArrangementWorkerTicket,
	staticFabArrangementPlanFingerprintSteps,
} from "../core/StaticFabArrangementCertification";
import { STATIC_FAB_ARRANGEMENT_COMMAND_MAX_KEY_LENGTH } from "../core/StaticFabArrangementCommand";
import {
	STATIC_FAB_ARRANGEMENT_PLAN_KIND,
	STATIC_FAB_ARRANGEMENT_PLAN_VERSION,
	type StaticFabArrangementPlan,
	type StaticFabArrangementPlanMetadata,
} from "../core/StaticFabArrangementPlan";
import {
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS,
	type StaticFabAssemblyRelationshipMutationV1,
	staticFabAssemblyRelationshipStateShapeErrorSteps,
	staticFabAssemblyRelationshipTransitionFootprintSteps,
} from "../core/StaticFabAssemblyRelationship";
import {
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationRecord,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationRecordShapeErrorSteps,
} from "../core/StaticFabOrganization";
import { type Cell, decodeRailCell } from "../core/TileMap";
import { STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT } from "./StaticFabArrangementProtocol";

/** Hard receive-side budgets. They are deliberately independent of the source snapshot size. */
export const STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES = 4_096;
export const STATIC_FAB_ARRANGEMENT_MAX_EQUIPMENT_GROUPS = STATIC_FAB_ARRANGEMENT_MAX_PORTS;
export const STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS =
	STATIC_FAB_ARRANGEMENT_MAX_ROOTS * STATIC_FAB_ORGANIZATION_KINDS.length;
export const STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS =
	STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES * 4 + STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES * 32;
export const STATIC_FAB_ARRANGEMENT_MAX_RESPONSE_TEXT = 4_096;

export const MAX_ORGANIZATION_RAIL_EDGE_REFERENCES =
	STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES * STATIC_FAB_ORGANIZATION_KINDS.length * 2;
export const MAX_ORGANIZATION_SWITCH_REFERENCES =
	STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES * STATIC_FAB_ORGANIZATION_KINDS.length * 2;
export const MAX_ORGANIZATION_GROUP_REFERENCES =
	STATIC_FAB_ARRANGEMENT_MAX_EQUIPMENT_GROUPS * STATIC_FAB_ORGANIZATION_KINDS.length * 2;
const RECORD_ID_CURSOR_MAX = PORT_RECORD_MAX_ID + 1;
const ORDERED_FINGERPRINT_PATTERN = /^[0-9a-f]{8}:[0-9a-f]{8}$/;
const RAIL_CHECKSUM_PATTERN = /^(?:[0-9a-f]{8}:){11}[0-9a-f]{8}$/;

/**
 * Bounded structural and semantic contract for data received from the disposable arrangement
 * Worker. Passing this check does not grant commit authority; the opaque one-shot permit still
 * binds the result to the live document.
 */
export function* staticFabArrangementPreparedEnvelopeShapeErrorSteps(
	value: unknown,
): Generator<void, string | null> {
	if (!isRecord(value)) return "prepared arrangement payload must be an object";
	if (typeof value.valid !== "boolean") return "prepared arrangement validity must be boolean";
	if (!validFailureCode(value.failureCode, value.valid)) {
		return "prepared arrangement failure code is invalid";
	}
	if (!boundedText(value.reason, STATIC_FAB_ARRANGEMENT_MAX_RESPONSE_TEXT)) {
		return "prepared arrangement reason exceeds its text budget";
	}
	const conflictError = yield* canonicalCellArrayError(
		value.conflictCells,
		STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT,
		"prepared arrangement conflicts",
	);
	if (conflictError) return conflictError;
	const conflictCells = value.conflictCells as readonly Cell[];
	if (
		!nonNegativeSafeInteger(value.conflictCount) ||
		value.conflictCount > STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS ||
		value.conflictCount < conflictCells.length
	) {
		return "prepared arrangement conflict count is invalid";
	}
	if (
		!nonNegativeFinite(value.planningMilliseconds) ||
		!nonNegativeFinite(value.validationMilliseconds)
	) {
		return "prepared arrangement timing values are invalid";
	}
	if (value.valid && (value.conflictCount !== 0 || conflictCells.length !== 0)) {
		return "valid prepared arrangement carried conflicts";
	}

	return null;
}

export function* staticFabArrangementPreparedShapeErrorSteps(
	value: unknown,
): Generator<void, string | null> {
	const envelopeError = yield* staticFabArrangementPreparedEnvelopeShapeErrorSteps(value);
	if (envelopeError) return envelopeError;
	if (!isRecord(value)) return "prepared arrangement payload must be an object";
	if (value.plan === null) {
		if (value.valid) return "valid prepared arrangement omitted its plan";
		return value.ticket === null ? null : "rejected prepared arrangement carried a ticket";
	}
	const mode = value.valid ? "full" : "compact";
	const planError = yield* arrangementPlanShapeError(value.plan, mode);
	if (planError) return planError;
	const plan = value.plan as StaticFabArrangementPlan;
	if (plan.valid !== value.valid) return "prepared arrangement and plan validity disagree";
	if (!value.valid) {
		return value.ticket === null ? null : "rejected prepared arrangement carried a ticket";
	}
	if (value.reason !== plan.reason)
		return "valid prepared arrangement reason does not match its plan";
	if (!isRecord(value.ticket)) return "valid prepared arrangement omitted its ticket";
	return yield* arrangementTicketShapeError(
		value.ticket as unknown as StaticFabArrangementWorkerTicket,
		plan,
	);
}

export function staticFabArrangementPlanHeaderShapeError(
	value: unknown,
	mode: "compact" | "full",
): string | null {
	if (!isRecord(value) || value.kind !== STATIC_FAB_ARRANGEMENT_PLAN_KIND) {
		return "arrangement plan kind is invalid";
	}
	if (typeof value.valid !== "boolean") return "arrangement plan validity is invalid";
	if (value.valid !== (mode === "full")) return "arrangement plan mode and validity disagree";
	if (!boundedText(value.reason, STATIC_FAB_ARRANGEMENT_MAX_RESPONSE_TEXT)) {
		return "arrangement plan reason exceeds its text budget";
	}
	if (
		!nonNegativeSafeInteger(value.baseRevision) ||
		!nonNegativeSafeInteger(value.basePatchSequence) ||
		!positiveInt32(value.nextOrganizationIdBefore) ||
		!positiveInt32(value.nextOrganizationIdAfter) ||
		!positiveInt32(value.nextRelationshipIdBefore) ||
		!positiveInt32(value.nextRelationshipIdAfter) ||
		value.nextRelationshipIdBefore !== value.nextRelationshipIdAfter ||
		value.nextOrganizationIdBefore !== value.nextOrganizationIdAfter ||
		!validPlanIssueCode(value.issueCode, value.valid)
	) {
		return "arrangement plan scalar fields are invalid";
	}
	return null;
}

function* arrangementPlanShapeError(
	value: unknown,
	mode: "compact" | "full",
): Generator<void, string | null> {
	const headerError = staticFabArrangementPlanHeaderShapeError(value, mode);
	if (headerError) return headerError;
	if (!isRecord(value)) return "arrangement plan kind is invalid";
	if (
		!Array.isArray(value.cells) ||
		!Array.isArray(value.conflicts) ||
		!Array.isArray(value.mutations) ||
		!Array.isArray(value.switchMutations) ||
		!Array.isArray(value.portMutations) ||
		!Array.isArray(value.equipmentGroupMutations) ||
		!Array.isArray(value.organizationMutations) ||
		!Array.isArray(value.relationshipMutations) ||
		!Array.isArray(value.organizationImpactAuthorizations)
	) {
		return "arrangement plan mutation arrays are missing";
	}
	const maximumCells =
		mode === "compact"
			? STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT
			: STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS;
	const cellsError = yield* canonicalCellArrayError(
		value.cells,
		maximumCells,
		"arrangement plan cells",
	);
	if (cellsError) return cellsError;
	const conflictsError = yield* canonicalCellArrayError(
		value.conflicts,
		STATIC_FAB_ARRANGEMENT_CONFLICT_LIMIT,
		"arrangement plan conflicts",
	);
	if (conflictsError) return conflictsError;

	if (mode === "compact") {
		if (value.arrangement !== null) return "compact rejected arrangement carried metadata";
		return value.mutations.length === 0 &&
			value.switchMutations.length === 0 &&
			value.portMutations.length === 0 &&
			value.equipmentGroupMutations.length === 0 &&
			value.organizationMutations.length === 0 &&
			value.relationshipMutations.length === 0 &&
			value.organizationImpactAuthorizations.length === 0
			? null
			: "compact rejected arrangement carried authored mutations";
	}

	if (
		value.cells.length === 0 ||
		value.conflicts.length !== 0 ||
		value.mutations.length > STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS ||
		value.switchMutations.length > STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES ||
		value.portMutations.length > STATIC_FAB_ARRANGEMENT_MAX_PORTS ||
		value.equipmentGroupMutations.length !== 0 ||
		value.organizationMutations.length > STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS ||
		value.relationshipMutations.length > STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS ||
		value.organizationImpactAuthorizations.length > STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS
	) {
		return "full arrangement plan exceeds its mutation budget";
	}
	if (
		value.mutations.length === 0 &&
		value.switchMutations.length === 0 &&
		value.portMutations.length === 0 &&
		value.organizationMutations.length === 0 &&
		value.relationshipMutations.length === 0
	) {
		return "full arrangement plan contains no authored change";
	}
	const authorizationError = yield* canonicalPositiveIdArrayError(
		value.organizationImpactAuthorizations,
		"arrangement organization authorizations",
	);
	if (authorizationError) return authorizationError;
	const metadataError = yield* staticFabArrangementMetadataShapeErrorSteps(value.arrangement);
	if (metadataError) return metadataError;
	const metadata = value.arrangement as StaticFabArrangementPlanMetadata;
	const metadataConsistencyError = yield* arrangementMetadataMatchesPlan(
		metadata,
		value as unknown as StaticFabArrangementPlan,
	);
	if (metadataConsistencyError) return metadataConsistencyError;

	const cellKeys = new Set<string>();
	for (const cell of value.cells as readonly Cell[]) {
		yield;
		cellKeys.add(cellCoordinateKey(cell));
	}
	const railError = yield* relocationRailMutationsError(value.mutations, cellKeys);
	if (railError) return railError;
	const switchError = yield* relocationSwitchMutationsError(
		value.switchMutations,
		metadata.translations,
	);
	if (switchError) return switchError;
	const portError = yield* relocationPortMutationsError(value.portMutations, metadata.translations);
	if (portError) return portError;
	const organizationError = yield* relocationOrganizationMutationsError(
		value.organizationMutations,
		value.organizationImpactAuthorizations,
	);
	if (organizationError) return organizationError;
	return yield* relocationRelationshipMutationsError(
		value.relationshipMutations,
		value.nextRelationshipIdBefore as number,
		metadata.translations,
	);
}

export function* staticFabArrangementMetadataShapeErrorSteps(
	value: unknown,
): Generator<void, string | null> {
	if (!isRecord(value)) return "arrangement plan metadata is missing";
	if (
		value.version !== STATIC_FAB_ARRANGEMENT_PLAN_VERSION ||
		(value.axis !== "X" && value.axis !== "Z") ||
		!validArrangementMode(value.mode) ||
		!Array.isArray(value.translations) ||
		!nonNegativeFinite(value.maximumSnapErrorMeters) ||
		value.maximumSnapErrorMeters > 0.5 ||
		!positiveSafeInteger(value.rootCount) ||
		value.rootCount > STATIC_FAB_ARRANGEMENT_MAX_ROOTS ||
		!positiveSafeInteger(value.moduleCount) ||
		value.moduleCount > STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES ||
		!positiveSafeInteger(value.railEdgeCount) ||
		value.railEdgeCount > STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES ||
		!boundedCount(value.advancedSwitchCount, STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES) ||
		!boundedCount(value.portCount, STATIC_FAB_ARRANGEMENT_MAX_PORTS) ||
		!boundedCount(value.equipmentGroupCount, STATIC_FAB_ARRANGEMENT_MAX_EQUIPMENT_GROUPS) ||
		!Array.isArray(value.affectedOrganizationIds) ||
		value.affectedOrganizationIds.length > STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS
	) {
		return "arrangement plan metadata exceeds its bounds";
	}
	if (
		value.translations.length !== value.rootCount ||
		value.rootCount > value.moduleCount ||
		value.moduleCount > value.railEdgeCount ||
		value.equipmentGroupCount > value.portCount
	) {
		return "arrangement plan metadata counts are inconsistent";
	}
	const minimumRoots =
		value.mode === "DISTRIBUTE_CENTERS" || value.mode === "DISTRIBUTE_GAPS" ? 3 : 2;
	if (value.rootCount < minimumRoots) return "arrangement plan has too few roots for its mode";
	const affectedError = yield* canonicalPositiveIdArrayError(
		value.affectedOrganizationIds,
		"arrangement affected organization ids",
	);
	if (affectedError) return affectedError;

	let previousKey = "";
	let changed = false;
	for (let index = 0; index < value.translations.length; index++) {
		yield;
		const translation = value.translations[index];
		const error = arrangementTranslationShapeError(translation, value.axis);
		if (error) return error;
		const key = (translation as StaticFabArrangementTranslation).key;
		if (index > 0 && key <= previousKey) {
			return "arrangement translations must use unique canonical root keys";
		}
		previousKey = key;
		changed ||=
			(translation as StaticFabArrangementTranslation).deltaX !== 0 ||
			(translation as StaticFabArrangementTranslation).deltaZ !== 0;
	}
	return changed ? null : "arrangement translations contain no movement";
}

function arrangementTranslationShapeError(value: unknown, axis: "X" | "Z"): string | null {
	if (
		!isRecord(value) ||
		!portableKey(value.key) ||
		!isInt32(value.deltaX) ||
		!isInt32(value.deltaZ) ||
		!validArrangementBounds(value.before) ||
		!validArrangementBounds(value.after)
	) {
		return "arrangement translation shape is invalid";
	}
	if ((axis === "X" && value.deltaZ !== 0) || (axis === "Z" && value.deltaX !== 0)) {
		return "arrangement translation moves outside its selected axis";
	}
	const before = value.before as unknown as StaticFabArrangementBounds;
	const after = value.after as unknown as StaticFabArrangementBounds;
	if (
		before.minX + value.deltaX !== after.minX ||
		before.minZ + value.deltaZ !== after.minZ ||
		before.maxXExclusive + value.deltaX !== after.maxXExclusive ||
		before.maxZExclusive + value.deltaZ !== after.maxZExclusive
	) {
		return "arrangement translation bounds do not match its delta";
	}
	return null;
}

function* arrangementMetadataMatchesPlan(
	metadata: StaticFabArrangementPlanMetadata,
	plan: StaticFabArrangementPlan,
): Generator<void, string | null> {
	if (
		plan.switchMutations.length > metadata.advancedSwitchCount ||
		plan.portMutations.length > metadata.portCount ||
		plan.organizationMutations.length > metadata.affectedOrganizationIds.length ||
		!(yield* sameNumberArray(
			plan.organizationImpactAuthorizations,
			metadata.affectedOrganizationIds,
		))
	) {
		return "arrangement metadata does not match its authored mutations";
	}
	const authorized = new Set(plan.organizationImpactAuthorizations);
	return plan.organizationMutations.every((mutation) => authorized.has(mutation.id))
		? null
		: "arrangement organization mutation lacks exact impact authorization";
}

export function staticFabArrangementTicketHeaderShapeError(
	ticket: unknown,
	plan: Pick<
		StaticFabArrangementPlan,
		| "baseRevision"
		| "basePatchSequence"
		| "nextOrganizationIdBefore"
		| "nextOrganizationIdAfter"
		| "nextRelationshipIdBefore"
		| "nextRelationshipIdAfter"
	>,
): string | null {
	if (
		!isRecord(ticket) ||
		!positiveSafeInteger(ticket.ticketId) ||
		ticket.validationLevel !== "exact" ||
		!nonNegativeSafeInteger(ticket.sourceRevision) ||
		!nonNegativeSafeInteger(ticket.sourcePatchSequence) ||
		!railChecksum(ticket.sourceChecksum) ||
		!recordCursor(ticket.sourceNextAdvancedSwitchId) ||
		!recordCursor(ticket.sourceNextPortId) ||
		!recordCursor(ticket.sourceNextEquipmentGroupId) ||
		!positiveInt32(ticket.sourceNextOrganizationId) ||
		!positiveInt32(ticket.sourceNextRelationshipId) ||
		!orderedFingerprint(ticket.intentFingerprint) ||
		!orderedFingerprint(ticket.planFingerprint) ||
		!railChecksum(ticket.prospectiveChecksum) ||
		!recordCursor(ticket.prospectiveNextAdvancedSwitchId) ||
		!recordCursor(ticket.prospectiveNextPortId) ||
		!recordCursor(ticket.prospectiveNextEquipmentGroupId) ||
		!positiveInt32(ticket.prospectiveNextOrganizationId) ||
		!positiveInt32(ticket.prospectiveNextRelationshipId)
	) {
		return "arrangement ticket fields are invalid";
	}
	if (
		ticket.sourceRevision !== plan.baseRevision ||
		ticket.sourcePatchSequence !== plan.basePatchSequence ||
		ticket.sourceNextOrganizationId !== plan.nextOrganizationIdBefore ||
		ticket.sourceNextRelationshipId !== plan.nextRelationshipIdBefore ||
		ticket.prospectiveNextRelationshipId !== plan.nextRelationshipIdAfter ||
		ticket.prospectiveNextOrganizationId !== plan.nextOrganizationIdAfter
	) {
		return "arrangement ticket does not bind the supplied plan";
	}
	if (
		ticket.prospectiveNextAdvancedSwitchId !== ticket.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== ticket.sourceNextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== ticket.sourceNextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== ticket.sourceNextOrganizationId ||
		ticket.prospectiveNextRelationshipId !== ticket.sourceNextRelationshipId
	) {
		return "arrangement ticket advanced an existing-ID cursor";
	}
	return null;
}

function* arrangementTicketShapeError(
	ticket: StaticFabArrangementWorkerTicket,
	plan: StaticFabArrangementPlan,
): Generator<void, string | null> {
	const headerError = staticFabArrangementTicketHeaderShapeError(ticket, plan);
	if (headerError) return headerError;
	let planFingerprint: string;
	try {
		planFingerprint = yield* staticFabArrangementPlanFingerprintSteps(plan);
	} catch {
		return "arrangement plan fingerprint could not be recomputed";
	}
	return ticket.planFingerprint === planFingerprint
		? null
		: "arrangement ticket plan fingerprint does not match the supplied plan";
}

function* relocationRailMutationsError(
	value: unknown,
	planCells: ReadonlySet<string>,
): Generator<void, string | null> {
	if (!Array.isArray(value)) return "arrangement rail mutations are missing";
	let previous: RailMutation | null = null;
	for (let index = 0; index < value.length; index++) {
		yield;
		const mutation = value[index];
		if (
			!isRecord(mutation) ||
			!isInt32(mutation.x) ||
			!isInt32(mutation.y) ||
			!validEncodedRail(mutation.before) ||
			!validEncodedRail(mutation.after) ||
			mutation.before === mutation.after ||
			!planCells.has(`${mutation.x}:${mutation.y}`)
		) {
			return "arrangement rail mutation is malformed";
		}
		const typed = mutation as unknown as RailMutation;
		if (previous && compareRailMutations(previous, typed) >= 0) {
			return "arrangement rail mutations are not unique and canonical";
		}
		previous = typed;
	}
	return null;
}

function* relocationSwitchMutationsError(
	value: unknown,
	translations: readonly StaticFabArrangementTranslation[],
): Generator<void, string | null> {
	if (!Array.isArray(value)) return "arrangement switch mutations are missing";
	let previousId = 0;
	for (let index = 0; index < value.length; index++) {
		yield;
		const mutation = value[index];
		if (!isRecord(mutation) || !positiveInt32(mutation.id) || mutation.id <= previousId) {
			return "arrangement switch mutations are not unique and canonical";
		}
		if (!isRecord(mutation.before) || !isRecord(mutation.after)) {
			return "arrangement switch mutation must preserve an existing record";
		}
		const before = mutation.before as unknown as AdvancedSwitchRecord;
		const after = mutation.after as unknown as AdvancedSwitchRecord;
		if (mutation.id !== before.id || mutation.id !== after.id) {
			return "arrangement switch mutation changed its existing ID";
		}
		const beforeError = advancedSwitchRecordShapeError(before);
		const afterError = advancedSwitchRecordShapeError(after);
		if (beforeError || afterError)
			return `arrangement switch record is invalid: ${beforeError ?? afterError}`;
		if (
			before.profileClass !== after.profileClass ||
			before.forward !== after.forward ||
			before.lateral !== after.lateral ||
			before.movementMask !== after.movementMask ||
			!matchesOneTranslation(before.origin, after.origin, translations)
		) {
			return "arrangement switch mutation changed more than its origin";
		}
		previousId = mutation.id;
	}
	return null;
}

function* relocationPortMutationsError(
	value: unknown,
	translations: readonly StaticFabArrangementTranslation[],
): Generator<void, string | null> {
	if (!Array.isArray(value)) return "arrangement port mutations are missing";
	let previousId = 0;
	for (let index = 0; index < value.length; index++) {
		yield;
		const mutation = value[index];
		if (!isRecord(mutation) || !positiveInt32(mutation.id) || mutation.id <= previousId) {
			return "arrangement port mutations are not unique and canonical";
		}
		if (!isRecord(mutation.before) || !isRecord(mutation.after)) {
			return "arrangement port mutation must preserve an existing record";
		}
		const before = mutation.before as unknown as PortRecord;
		const after = mutation.after as unknown as PortRecord;
		if (mutation.id !== before.id || mutation.id !== after.id) {
			return "arrangement port mutation changed its existing ID";
		}
		const beforeError = portRecordShapeError(before);
		const afterError = portRecordShapeError(after);
		if (beforeError || afterError)
			return `arrangement port record is invalid: ${beforeError ?? afterError}`;
		if (
			before.route.kind !== "CARDINAL_CELL" ||
			after.route.kind !== "CARDINAL_CELL" ||
			before.equipmentGroupId !== after.equipmentGroupId ||
			before.stationMillimeters !== after.stationMillimeters ||
			before.side !== after.side ||
			before.lateralOffsetMillimeters !== after.lateralOffsetMillimeters ||
			before.direction !== after.direction ||
			before.portType !== after.portType ||
			before.barcode !== after.barcode ||
			before.route.from !== after.route.from ||
			before.route.to !== after.route.to ||
			!matchesOneTranslation(
				{ x: before.route.x, y: before.route.z },
				{ x: after.route.x, y: after.route.z },
				translations,
			)
		) {
			return "arrangement port mutation changed more than its cardinal route position";
		}
		previousId = mutation.id;
	}
	return null;
}

function* relocationOrganizationMutationsError(
	value: unknown,
	authorizations: unknown,
): Generator<void, string | null> {
	if (!Array.isArray(value) || !Array.isArray(authorizations)) {
		return "arrangement organization mutations are missing";
	}
	const authorized = new Set<number>(authorizations as number[]);
	let previousId = 0;
	let railReferences = 0;
	let switchReferences = 0;
	let groupReferences = 0;
	for (let index = 0; index < value.length; index++) {
		yield;
		const mutation = value[index];
		if (!isRecord(mutation) || !positiveInt32(mutation.id) || mutation.id <= previousId) {
			return "arrangement organization mutations are not unique and canonical";
		}
		if (!authorized.has(mutation.id)) {
			return "arrangement organization mutation is not impact-authorized";
		}
		if (!isRecord(mutation.before) || !isRecord(mutation.after)) {
			return "arrangement organization mutation must preserve an existing record";
		}
		const before = mutation.before as unknown as StaticFabOrganizationRecord;
		const after = mutation.after as unknown as StaticFabOrganizationRecord;
		if (mutation.id !== before.id || mutation.id !== after.id) {
			return "arrangement organization mutation changed its existing ID";
		}
		const beforeError = yield* staticFabOrganizationRecordShapeError(before);
		const afterError = yield* staticFabOrganizationRecordShapeError(after);
		if (beforeError || afterError) {
			return `arrangement organization record is invalid: ${beforeError ?? afterError}`;
		}
		railReferences += before.membership.railEdges.length + after.membership.railEdges.length;
		switchReferences +=
			before.membership.advancedSwitchIds.length + after.membership.advancedSwitchIds.length;
		groupReferences +=
			before.membership.equipmentGroupIds.length + after.membership.equipmentGroupIds.length;
		if (
			railReferences > MAX_ORGANIZATION_RAIL_EDGE_REFERENCES ||
			switchReferences > MAX_ORGANIZATION_SWITCH_REFERENCES ||
			groupReferences > MAX_ORGANIZATION_GROUP_REFERENCES
		) {
			return "arrangement organization references exceed their aggregate budget";
		}
		if (!(yield* sameOrganizationIdentityAndMetadata(before, after))) {
			return "arrangement organization mutation changed immutable metadata or entity membership";
		}
		if (
			before.membership.railEdges.length !== after.membership.railEdges.length ||
			(yield* sameDirectedEdgeArray(before.membership.railEdges, after.membership.railEdges))
		) {
			return "arrangement organization mutation did not preserve and relocate rail membership";
		}
		previousId = mutation.id;
	}
	return null;
}

function advancedSwitchRecordShapeError(record: AdvancedSwitchRecord): string | null {
	if (!isRecord(record) || !isRecord(record.origin)) return "record shape is malformed";
	if (!isInt32(record.origin.x) || !isInt32(record.origin.y)) return "origin must be signed int32";
	try {
		const error = advancedSwitchRecordError(record);
		if (error) return error;
		return deriveAdvancedSwitchGeometry(record).claimedCells.every(
			(cell) => isInt32(cell.x) && isInt32(cell.y),
		)
			? null
			: "claimed cells must remain signed int32";
	} catch {
		return "record shape is malformed";
	}
}

function portRecordShapeError(record: PortRecord): string | null {
	if (!isRecord(record) || !isRecord(record.route)) return "record shape is malformed";
	try {
		return portRecordError(record);
	} catch {
		return "record shape is malformed";
	}
}

function* staticFabOrganizationRecordShapeError(
	record: StaticFabOrganizationRecord,
): Generator<void, string | null> {
	if (!isRecord(record) || !isRecord(record.membership)) return "record shape is malformed";
	const membership = record.membership;
	if (
		!Array.isArray(membership.railEdges) ||
		!Array.isArray(membership.advancedSwitchIds) ||
		!Array.isArray(membership.equipmentGroupIds) ||
		membership.railEdges.length > STATIC_FAB_ARRANGEMENT_MAX_RAIL_EDGES ||
		membership.advancedSwitchIds.length > STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES ||
		membership.equipmentGroupIds.length > STATIC_FAB_ARRANGEMENT_MAX_EQUIPMENT_GROUPS
	) {
		return "membership exceeds its per-record budget";
	}
	try {
		return yield* staticFabOrganizationRecordShapeErrorSteps(record);
	} catch {
		return "record shape is malformed";
	}
}

function* sameOrganizationIdentityAndMetadata(
	before: StaticFabOrganizationRecord,
	after: StaticFabOrganizationRecord,
): Generator<void, boolean> {
	const beforeProperties = staticFabOrganizationProperties(before);
	const afterProperties = staticFabOrganizationProperties(after);
	return (
		before.kind === after.kind &&
		before.name === after.name &&
		(yield* sameNumberArray(
			staticFabOrganizationParentIds(before),
			staticFabOrganizationParentIds(after),
		)) &&
		beforeProperties.description === afterProperties.description &&
		beforeProperties.color === afterProperties.color &&
		(yield* sameNumberArray(
			before.membership.advancedSwitchIds,
			after.membership.advancedSwitchIds,
		)) &&
		(yield* sameNumberArray(
			before.membership.equipmentGroupIds,
			after.membership.equipmentGroupIds,
		))
	);
}

function* sameDirectedEdgeArray(
	left: StaticFabOrganizationRecord["membership"]["railEdges"],
	right: StaticFabOrganizationRecord["membership"]["railEdges"],
): Generator<void, boolean> {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		yield;
		const first = left[index];
		const second = right[index];
		if (
			!first ||
			!second ||
			first.from.x !== second.from.x ||
			first.from.y !== second.from.y ||
			first.to.x !== second.to.x ||
			first.to.y !== second.to.y
		) {
			return false;
		}
	}
	return true;
}

function matchesOneTranslation(
	before: Cell,
	after: Cell,
	translations: readonly StaticFabArrangementTranslation[],
): boolean {
	const deltaX = after.x - before.x;
	const deltaZ = after.y - before.y;
	if (deltaX === 0 && deltaZ === 0) return false;
	return translations.some(
		(translation) => translation.deltaX === deltaX && translation.deltaZ === deltaZ,
	);
}

function* canonicalCellArrayError(
	value: unknown,
	maximum: number,
	label: string,
): Generator<void, string | null> {
	if (!Array.isArray(value)) return `${label} must be an array`;
	if (value.length > maximum) return `${label} exceed their budget`;
	let previous: Cell | null = null;
	for (let index = 0; index < value.length; index++) {
		yield;
		const cell = value[index];
		if (!isCell(cell)) return `${label} contain an invalid coordinate`;
		if (previous && compareCells(previous, cell) >= 0) {
			return `${label} are not unique and canonical`;
		}
		previous = cell;
	}
	return null;
}

function* canonicalPositiveIdArrayError(
	value: unknown,
	label: string,
): Generator<void, string | null> {
	if (!Array.isArray(value)) return `${label} must be an array`;
	let previous = 0;
	for (let index = 0; index < value.length; index++) {
		yield;
		const id = value[index];
		if (!positiveInt32(id) || id <= previous) return `${label} are not unique and canonical`;
		previous = id;
	}
	return null;
}

function validEncodedRail(value: unknown): boolean {
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xff) return false;
	return value === 0 || classifyRailCell(decodeRailCell(value as number)) !== "INVALID";
}

function validArrangementBounds(value: unknown): value is StaticFabArrangementBounds {
	return (
		isRecord(value) &&
		isInt32(value.minX) &&
		isInt32(value.minZ) &&
		isInt32(value.maxXExclusive) &&
		isInt32(value.maxZExclusive) &&
		value.minX < value.maxXExclusive &&
		value.minZ < value.maxZExclusive
	);
}

function validFailureCode(value: unknown, valid: boolean): boolean {
	if (valid) return value === null;
	return (
		value === "snapshot" ||
		value === "fingerprint" ||
		value === "selection" ||
		value === "plan" ||
		value === "clearance" ||
		value === "compile"
	);
}

function validPlanIssueCode(value: unknown, valid: boolean): boolean {
	if (valid) return value === null;
	return (
		value === null ||
		value === "INVALID_ARRANGEMENT" ||
		value === "STALE_SELECTION" ||
		value === "EMPTY_SELECTION" ||
		value === "LIMIT_EXCEEDED" ||
		value === "ROOT_OVERLAP" ||
		value === "EXTERNAL_ATTACHMENT" ||
		value === "TARGET_COLLISION" ||
		value === "TARGET_OVERLAP" ||
		value === "COORDINATE_OVERFLOW" ||
		value === "LEGACY_EQUIPMENT_UNSUPPORTED" ||
		value === "PORT_DEPENDENCY" ||
		value === "TOPOLOGY_INVALID" ||
		value === "PORT_LAYOUT_INVALID" ||
		value === "CLEARANCE_INVALID" ||
		value === "ORGANIZATION_INVALID" ||
		value === "PARTIAL_RELATIONSHIP" ||
		value === "INCOMPATIBLE_RELATIONSHIP_TRANSFORMS" ||
		value === "RELATIONSHIP_INVALID" ||
		value === "COMPILE_FAILURE"
	);
}

function validArrangementMode(value: unknown): boolean {
	return (
		value === "ALIGN_MIN" ||
		value === "ALIGN_CENTER" ||
		value === "ALIGN_MAX" ||
		value === "DISTRIBUTE_CENTERS" ||
		value === "DISTRIBUTE_GAPS"
	);
}

function portableKey(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > STATIC_FAB_ARRANGEMENT_COMMAND_MAX_KEY_LENGTH
	) {
		return false;
	}
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) return false;
	}
	return true;
}

function orderedFingerprint(value: unknown): value is string {
	return typeof value === "string" && ORDERED_FINGERPRINT_PATTERN.test(value);
}

function railChecksum(value: unknown): value is string {
	return typeof value === "string" && RAIL_CHECKSUM_PATTERN.test(value);
}

function boundedText(value: unknown, maximum: number): value is string {
	return typeof value === "string" && value.length <= maximum;
}

function boundedCount(value: unknown, maximum: number): value is number {
	return nonNegativeSafeInteger(value) && value <= maximum;
}

function recordCursor(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= 1 && (value as number) <= RECORD_ID_CURSOR_MAX
	);
}

function positiveInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= 1 && (value as number) <= ADVANCED_SWITCH_MAX_ID
	);
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

function isCell(value: unknown): value is Cell {
	return isRecord(value) && isInt32(value.x) && isInt32(value.y);
}

function isInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}

function* sameNumberArray(
	left: readonly number[],
	right: readonly number[],
): Generator<void, boolean> {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		yield;
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function compareRailMutations(left: RailMutation, right: RailMutation): number {
	return left.y - right.y || left.x - right.x;
}

function cellCoordinateKey(cell: Cell): string {
	return `${cell.x}:${cell.y}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function staticFabArrangementPreparedShapeError(value: unknown): string | null {
	return completeCooperativeSteps(staticFabArrangementPreparedShapeErrorSteps(value));
}

function* relocationRelationshipMutationsError(
	value: unknown[],
	nextRelationshipId: number,
	translations: readonly StaticFabArrangementTranslation[],
): Generator<void, string | null> {
	const before = [],
		after = [];
	let previous = 0;
	for (const mutation of value) {
		yield;
		if (
			!isRecord(mutation) ||
			!positiveInt32(mutation.id) ||
			mutation.id <= previous ||
			!isRecord(mutation.before) ||
			!isRecord(mutation.after) ||
			mutation.before.id !== mutation.id ||
			mutation.after.id !== mutation.id
		)
			return "arrangement relationship mutation must preserve a unique existing ID";
		previous = mutation.id;
		before.push(mutation.before);
		after.push(mutation.after);
	}
	// Validate both complete sides before freezing or hashing any received graph.
	for (const records of [before, after]) {
		const error = yield* staticFabAssemblyRelationshipStateShapeErrorSteps({
			nextRelationshipId,
			records,
		} as unknown as import("../core/StaticFabAssemblyRelationship").StaticFabAssemblyRelationshipStateV1);
		if (error) return `arrangement relationship record is invalid: ${error}`;
	}
	yield* freezeTransferDataContainersSteps(value);
	const changes = value as unknown as readonly StaticFabAssemblyRelationshipMutationV1[];
	try {
		yield* staticFabAssemblyRelationshipTransitionFootprintSteps(changes);
	} catch {
		return "arrangement relationship transition exceeds its budget or is invalid";
	}
	for (const mutation of changes) {
		yield;
		const first = yield* firstRelationshipPoint(mutation.before);
		const second = yield* firstRelationshipPoint(mutation.after);
		if (!first || !second || !matchesOneTranslation(first, second, translations))
			return "arrangement relationship must use one existing root translation";
		if (
			!(yield* sameTranslatedRelationshipData(
				mutation.before,
				mutation.after,
				second.x - first.x,
				second.y - first.y,
			))
		)
			return "arrangement relationship changed more than its coordinates";
	}
	return null;
}

/** Shape validation above bounds object arity; traverse arrays one item at a time. */
function* sameTranslatedRelationshipData(
	before: unknown,
	after: unknown,
	dx: number,
	dy: number,
): Generator<void, boolean> {
	yield;
	if (Array.isArray(before)) {
		if (!Array.isArray(after) || before.length !== after.length) return false;
		for (let i = 0; i < before.length; i++)
			if (!(yield* sameTranslatedRelationshipData(before[i], after[i], dx, dy))) return false;
		return true;
	}
	if (isRecord(before)) {
		if (!isRecord(after)) return false;
		const keys = Object.keys(before);
		if (keys.length !== Object.keys(after).length) return false;
		for (const key of keys) {
			yield;
			if (!Object.hasOwn(after, key)) return false;
			// The relationship grammar uses x/y only in directed-edge endpoint coordinates.
			if ((key === "x" || key === "y") && typeof before[key] === "number") {
				if (after[key] !== before[key] + (key === "x" ? dx : dy)) return false;
			} else if (!(yield* sameTranslatedRelationshipData(before[key], after[key], dx, dy)))
				return false;
		}
		return true;
	}
	return before === after;
}

function* firstRelationshipPoint(value: unknown): Generator<void, Cell | null> {
	yield;
	if (Array.isArray(value)) {
		for (const item of value) {
			const point = yield* firstRelationshipPoint(item);
			if (point) return point;
		}
	} else if (isRecord(value)) {
		if (isCell(value)) return value;
		for (const key of Object.keys(value)) {
			const point = yield* firstRelationshipPoint(value[key]);
			if (point) return point;
		}
	}
	return null;
}
