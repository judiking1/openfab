import {
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import {
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	equipmentGroupError,
	portEquipmentStateError,
} from "../core/EquipmentGroup";
import {
	PORT_RECORD_MAX_ID,
	type PortMutation,
	type PortRecord,
	portRecordError,
} from "../core/PortRecord";
import type { RailMutation } from "../core/paint";
import { classifyRailCell } from "../core/RailCellClassification";
import {
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	staticFabOrganizationStateShapeError,
} from "../core/StaticFabOrganization";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES,
} from "../core/StaticFabOrganizationBundle";
import type {
	StaticFabOrganizationBundlePlacementPlan,
	StaticFabOrganizationBundlePlacementWorkerTicket,
} from "../core/StaticFabOrganizationBundlePlacement";
import { type Cell, decodeRailCell } from "../core/TileMap";
import { STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT } from "./StaticFabOrganizationBundlePlacementProtocol";

export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS =
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES * 2 +
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES * 16;
export const STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT = 4_096;

const MAX_ORGANIZATION_RAIL_EDGE_REFERENCES =
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES * STATIC_FAB_ORGANIZATION_KINDS.length;
const MAX_ORGANIZATION_SWITCH_REFERENCES =
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES * STATIC_FAB_ORGANIZATION_KINDS.length;
const MAX_ORGANIZATION_GROUP_REFERENCES =
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS * STATIC_FAB_ORGANIZATION_KINDS.length;
const RECORD_ID_CURSOR_MAX = PORT_RECORD_MAX_ID + 1;

/** Bounded structural contract used before Worker send and after main-thread receive. */
export function staticFabOrganizationBundlePlacementPreparedShapeError(
	value: unknown,
): string | null {
	if (!isRecord(value)) return "prepared payload must be an object";
	if (typeof value.valid !== "boolean") return "prepared validity must be boolean";
	if (!validFailureCode(value.failureCode, value.valid)) return "prepared failure code is invalid";
	if (!boundedText(value.reason, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT)) {
		return "prepared reason exceeds its text budget";
	}
	if (!Array.isArray(value.conflictCells)) return "prepared conflicts must be an array";
	if (value.conflictCells.length > STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT) {
		return "prepared conflict sample exceeds its limit";
	}
	if (!value.conflictCells.every(isCell)) return "prepared conflict coordinates are invalid";
	if (
		!nonNegativeSafeInteger(value.conflictCount) ||
		value.conflictCount > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS
	) {
		return "prepared conflict count is invalid";
	}
	if (
		!nonNegativeSafeInteger(value.candidateCommittedEnvelopePairs) ||
		!nonNegativeSafeInteger(value.testedCommittedEnvelopePairs) ||
		value.testedCommittedEnvelopePairs > value.candidateCommittedEnvelopePairs
	) {
		return "prepared clearance pair counts are invalid";
	}
	if (
		!nonNegativeFinite(value.planningMilliseconds) ||
		!nonNegativeFinite(value.validationMilliseconds)
	) {
		return "prepared timing values are invalid";
	}

	if (value.plan === null) {
		if (value.valid) return "valid prepared payload omitted its plan";
		return value.ticket === null ? null : "rejected prepared payload carried a ticket";
	}
	const planError = placementPlanShapeError(value.plan, value.valid ? "full" : "compact");
	if (planError) return planError;
	const plan = value.plan as StaticFabOrganizationBundlePlacementPlan;
	if (plan.valid !== value.valid) return "prepared and plan validity disagree";
	if (!value.valid)
		return value.ticket === null ? null : "rejected prepared payload carried a ticket";
	if (!isRecord(value.ticket)) return "valid prepared payload omitted its ticket";
	const ticket = value.ticket as unknown as StaticFabOrganizationBundlePlacementWorkerTicket;
	const ticketError = placementTicketShapeError(ticket, plan);
	if (ticketError) return ticketError;
	return placementAdditionRecordsError(plan, ticket);
}

function placementPlanShapeError(value: unknown, mode: "compact" | "full"): string | null {
	if (!isRecord(value) || value.kind !== "build") return "placement plan kind is invalid";
	if (typeof value.valid !== "boolean") return "placement plan validity is invalid";
	if (!boundedText(value.reason, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT)) {
		return "placement plan reason exceeds its text budget";
	}
	if (
		!nonNegativeSafeInteger(value.baseRevision) ||
		!nonNegativeSafeInteger(value.basePatchSequence) ||
		!positiveInt32(value.nextOrganizationIdBefore) ||
		!positiveInt32(value.nextOrganizationIdAfter) ||
		!nonNegativeSafeInteger(value.newEdges) ||
		value.newEdges > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES ||
		!nonNegativeFinite(value.lengthMeters) ||
		!nonNegativeSafeInteger(value.turns) ||
		(value.bend !== "horizontal-first" && value.bend !== "vertical-first")
	) {
		return "placement plan scalar fields are invalid";
	}
	if (
		!Array.isArray(value.cells) ||
		!Array.isArray(value.mutations) ||
		!Array.isArray(value.switchMutations) ||
		!Array.isArray(value.portMutations) ||
		!Array.isArray(value.equipmentGroupMutations) ||
		!Array.isArray(value.organizationMutations) ||
		!Array.isArray(value.conflicts)
	) {
		return "placement plan mutation arrays are missing";
	}
	const maximumCells =
		mode === "compact"
			? STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT
			: STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS;
	if (
		value.cells.length > maximumCells ||
		value.conflicts.length > STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT ||
		!value.cells.every(isCell) ||
		!value.conflicts.every(isCell)
	) {
		return "placement plan cells exceed their bounds";
	}
	const metadataError = placementMetadataShapeError(value.organizationBundle, mode);
	if (metadataError) return metadataError;
	if (mode === "compact") {
		return value.mutations.length === 0 &&
			value.switchMutations.length === 0 &&
			value.portMutations.length === 0 &&
			value.equipmentGroupMutations.length === 0 &&
			value.organizationMutations.length === 0
			? null
			: "compact rejected plan carried authored mutations";
	}
	if (
		value.cells.length === 0 ||
		value.mutations.length !== value.cells.length ||
		value.mutations.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS ||
		value.switchMutations.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES ||
		value.portMutations.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS ||
		value.equipmentGroupMutations.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS ||
		value.organizationMutations.length === 0 ||
		value.organizationMutations.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS ||
		value.conflicts.length !== 0
	) {
		return "full placement plan exceeds its mutation budget";
	}
	return fullPlacementMetadataMatchesPlan(
		value.organizationBundle,
		value as unknown as StaticFabOrganizationBundlePlacementPlan,
	);
}

function placementMetadataShapeError(value: unknown, mode: "compact" | "full"): string | null {
	if (!isRecord(value) || value.collisionPolicy !== "EMPTY_FOOTPRINT_V1") {
		return "placement metadata policy is invalid";
	}
	if (!isCell(value.anchor) || !quarterTurns(value.quarterTurns)) {
		return "placement metadata pose is invalid";
	}
	if (
		!boundedCount(value.sourceModuleCount, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES) ||
		!boundedCount(value.railEdgeCount, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES) ||
		!boundedCount(
			value.advancedSwitchCount,
			STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES,
		) ||
		!boundedCount(value.portCount, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS) ||
		!boundedCount(value.equipmentGroupCount, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS) ||
		!boundedCount(value.organizationCount, STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS) ||
		!boundedCount(value.widthMeters, 0x7fff_ffff) ||
		!boundedCount(value.heightMeters, 0x7fff_ffff) ||
		!Array.isArray(value.organizationNames) ||
		value.organizationNames.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS ||
		!value.organizationNames.every((name) => boundedText(name, 120) && name.length > 0)
	) {
		return "placement metadata exceeds its bounds";
	}
	if (
		mode === "full" &&
		(value.sourceModuleCount === 0 ||
			value.railEdgeCount === 0 ||
			value.organizationCount === 0 ||
			value.widthMeters === 0 ||
			value.heightMeters === 0)
	) {
		return "full placement metadata cannot be empty";
	}
	return null;
}

function fullPlacementMetadataMatchesPlan(
	metadata: unknown,
	plan: StaticFabOrganizationBundlePlacementPlan,
): string | null {
	if (!isRecord(metadata)) return "placement metadata is missing";
	return metadata.railEdgeCount === plan.newEdges &&
		metadata.advancedSwitchCount === plan.switchMutations.length &&
		metadata.portCount === plan.portMutations.length &&
		metadata.equipmentGroupCount === plan.equipmentGroupMutations.length &&
		metadata.organizationCount === plan.organizationMutations.length &&
		Array.isArray(metadata.organizationNames) &&
		metadata.organizationNames.length === plan.organizationMutations.length
		? null
		: "placement metadata counts do not match its plan";
}

function placementTicketShapeError(
	ticket: StaticFabOrganizationBundlePlacementWorkerTicket,
	plan: StaticFabOrganizationBundlePlacementPlan,
): string | null {
	if (
		!positiveSafeInteger(ticket.ticketId) ||
		ticket.validationLevel !== "exact" ||
		!nonNegativeSafeInteger(ticket.sourceRevision) ||
		!nonNegativeSafeInteger(ticket.sourcePatchSequence) ||
		!boundedFingerprint(ticket.sourceChecksum) ||
		!recordCursor(ticket.sourceNextAdvancedSwitchId) ||
		!recordCursor(ticket.sourceNextPortId) ||
		!recordCursor(ticket.sourceNextEquipmentGroupId) ||
		!positiveInt32(ticket.sourceNextOrganizationId) ||
		!boundedFingerprint(ticket.bundleFingerprint) ||
		!isCell(ticket.anchor) ||
		!quarterTurns(ticket.quarterTurns) ||
		!boundedFingerprint(ticket.planFingerprint) ||
		!boundedFingerprint(ticket.prospectiveChecksum) ||
		!recordCursor(ticket.prospectiveNextAdvancedSwitchId) ||
		!recordCursor(ticket.prospectiveNextPortId) ||
		!recordCursor(ticket.prospectiveNextEquipmentGroupId) ||
		!positiveInt32(ticket.prospectiveNextOrganizationId)
	) {
		return "placement ticket fields are invalid";
	}
	if (
		ticket.sourceRevision !== plan.baseRevision ||
		ticket.sourcePatchSequence !== plan.basePatchSequence ||
		ticket.sourceNextOrganizationId !== plan.nextOrganizationIdBefore ||
		ticket.prospectiveNextOrganizationId !== plan.nextOrganizationIdAfter ||
		ticket.anchor.x !== plan.organizationBundle.anchor.x ||
		ticket.anchor.y !== plan.organizationBundle.anchor.y ||
		ticket.quarterTurns !== plan.organizationBundle.quarterTurns
	) {
		return "placement ticket does not bind the supplied plan";
	}
	return null;
}

function placementAdditionRecordsError(
	plan: StaticFabOrganizationBundlePlacementPlan,
	ticket: StaticFabOrganizationBundlePlacementWorkerTicket,
): string | null {
	const railError = railAdditionMutationsError(plan.cells, plan.mutations);
	if (railError) return railError;
	const switchRecords = addedRecords<AdvancedSwitchMutation, AdvancedSwitchRecord>(
		plan.switchMutations,
		ticket.sourceNextAdvancedSwitchId,
		advancedSwitchRecordShapeError,
		"advanced switch",
	);
	if (typeof switchRecords === "string") return switchRecords;
	if (
		ticket.prospectiveNextAdvancedSwitchId !==
		ticket.sourceNextAdvancedSwitchId + switchRecords.length
	) {
		return "advanced switch cursor does not match additions";
	}

	const ports = addedRecords<PortMutation, PortRecord>(
		plan.portMutations,
		ticket.sourceNextPortId,
		portRecordShapeError,
		"port",
	);
	if (typeof ports === "string") return ports;
	if (ticket.prospectiveNextPortId !== ticket.sourceNextPortId + ports.length) {
		return "port cursor does not match additions";
	}
	const equipmentGroups = addedRecords<EquipmentGroupMutation, EquipmentGroupRecord>(
		plan.equipmentGroupMutations,
		ticket.sourceNextEquipmentGroupId,
		equipmentGroupShapeError,
		"equipment group",
	);
	if (typeof equipmentGroups === "string") return equipmentGroups;
	if (
		ticket.prospectiveNextEquipmentGroupId !==
		ticket.sourceNextEquipmentGroupId + equipmentGroups.length
	) {
		return "equipment group cursor does not match additions";
	}
	const totalGroupPortIds = equipmentGroups.reduce(
		(total, group) => total + group.portIds.length,
		0,
	);
	if (totalGroupPortIds > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS) {
		return "equipment group port references exceed their aggregate budget";
	}
	try {
		const equipmentError = portEquipmentStateError({
			nextPortId: ticket.prospectiveNextPortId,
			nextEquipmentGroupId: ticket.prospectiveNextEquipmentGroupId,
			ports,
			equipmentGroups,
		});
		if (equipmentError)
			return `placement additions contain invalid port equipment: ${equipmentError}`;
	} catch {
		return "placement additions contain malformed port equipment";
	}

	const organizations = addedRecords<StaticFabOrganizationMutation, StaticFabOrganizationRecord>(
		plan.organizationMutations,
		plan.nextOrganizationIdBefore,
		staticFabOrganizationRecordBudgetError,
		"organization",
	);
	if (typeof organizations === "string") return organizations;
	if (
		plan.nextOrganizationIdAfter !== plan.nextOrganizationIdBefore + organizations.length ||
		ticket.prospectiveNextOrganizationId !== plan.nextOrganizationIdAfter
	) {
		return "organization cursor does not match additions";
	}
	let railEdgeReferences = 0;
	let switchReferences = 0;
	let equipmentGroupReferences = 0;
	for (const organization of organizations) {
		railEdgeReferences += organization.membership.railEdges.length;
		switchReferences += organization.membership.advancedSwitchIds.length;
		equipmentGroupReferences += organization.membership.equipmentGroupIds.length;
	}
	if (
		railEdgeReferences > MAX_ORGANIZATION_RAIL_EDGE_REFERENCES ||
		switchReferences > MAX_ORGANIZATION_SWITCH_REFERENCES ||
		equipmentGroupReferences > MAX_ORGANIZATION_GROUP_REFERENCES
	) {
		return "organization membership references exceed their aggregate budget";
	}
	try {
		const organizationError = staticFabOrganizationStateShapeError({
			nextOrganizationId: plan.nextOrganizationIdAfter,
			records: organizations,
		});
		if (organizationError)
			return `placement additions contain invalid organizations: ${organizationError}`;
	} catch {
		return "placement additions contain malformed organizations";
	}
	return null;
}

function railAdditionMutationsError(
	cells: readonly Cell[],
	mutations: readonly RailMutation[],
): string | null {
	const seen = new Set<string>();
	for (let index = 0; index < mutations.length; index++) {
		const mutation = mutations[index];
		const cell = cells[index];
		if (
			!mutation ||
			!cell ||
			!isInt32(mutation.x) ||
			!isInt32(mutation.y) ||
			mutation.x !== cell.x ||
			mutation.y !== cell.y ||
			mutation.before !== 0 ||
			!Number.isInteger(mutation.after) ||
			mutation.after <= 0 ||
			mutation.after > 0xff ||
			classifyRailCell(decodeRailCell(mutation.after)) === "INVALID"
		) {
			return "rail addition mutation is malformed";
		}
		const key = `${mutation.x}:${mutation.y}`;
		if (seen.has(key)) return "rail addition mutations contain duplicate cells";
		seen.add(key);
	}
	return null;
}

function addedRecords<
	M extends { readonly id: number; readonly before: unknown; readonly after: R | null },
	R extends { readonly id: number },
>(
	mutations: readonly M[],
	sourceCursor: number,
	validate: (record: R) => string | null,
	label: string,
): readonly R[] | string {
	const records: R[] = [];
	for (let index = 0; index < mutations.length; index++) {
		const mutation = mutations[index];
		if (
			!mutation ||
			mutation.before !== null ||
			mutation.after === null ||
			mutation.id !== sourceCursor + index ||
			mutation.after.id !== mutation.id
		) {
			return `${label} addition mutation is malformed`;
		}
		const error = validate(mutation.after);
		if (error) return `${label} addition mutation is invalid: ${error}`;
		records.push(mutation.after);
	}
	return records;
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

function equipmentGroupShapeError(record: EquipmentGroupRecord): string | null {
	if (!isRecord(record) || !Array.isArray(record.portIds)) return "record shape is malformed";
	if (record.portIds.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS) {
		return "port references exceed their per-record budget";
	}
	try {
		return equipmentGroupError(record);
	} catch {
		return "record shape is malformed";
	}
}

function staticFabOrganizationRecordBudgetError(
	record: StaticFabOrganizationRecord,
): string | null {
	if (!isRecord(record) || !isRecord(record.membership)) return "record shape is malformed";
	const membership = record.membership;
	if (
		!Array.isArray(membership.railEdges) ||
		!Array.isArray(membership.advancedSwitchIds) ||
		!Array.isArray(membership.equipmentGroupIds) ||
		membership.railEdges.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES ||
		membership.advancedSwitchIds.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES ||
		membership.equipmentGroupIds.length > STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS
	) {
		return "membership exceeds its per-record budget";
	}
	return null;
}

function validFailureCode(value: unknown, valid: boolean): boolean {
	if (valid) return value === null;
	return (
		value === "snapshot" ||
		value === "stale" ||
		value === "fingerprint" ||
		value === "bundle" ||
		value === "plan" ||
		value === "clearance" ||
		value === "compile"
	);
}

function boundedFingerprint(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256;
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

function quarterTurns(value: unknown): value is 0 | 1 | 2 | 3 {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function isCell(value: unknown): value is Cell {
	return isRecord(value) && isInt32(value.x) && isInt32(value.y);
}

function isInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
