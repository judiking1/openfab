import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	copyAdvancedSwitch,
} from "./AdvancedSwitch";
import {
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import { copyPortRecord, type PortMutation, type PortRecord } from "./PortRecord";
import {
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
	type StaticFabBayFlowEditPlan,
	type StaticFabBayFlowEditReview,
	staticFabBayFlowEditIntentError,
} from "./StaticFabBayFlowEdit";
import {
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";
import type { TileMap } from "./TileMap";

export interface StaticFabBayFlowEditWorkerTicket {
	readonly ticketId: number;
	readonly validationLevel: "exact";
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly intentFingerprint: string;
	readonly planFingerprint: string;
	readonly sourceAuthoredProjectionFingerprint: string;
	readonly targetAuthoredProjectionFingerprint: string;
	readonly prospectiveChecksum: string;
	readonly prospectiveNextAdvancedSwitchId: number;
	readonly prospectiveNextPortId: number;
	readonly prospectiveNextEquipmentGroupId: number;
	readonly prospectiveNextOrganizationId: number;
}

/** Opaque main-realm authority for one source-bound Bay flow-edit Worker request. */
export interface StaticFabBayFlowEditPermit {
	readonly ticketId: number;
}

interface BayFlowEditSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sourceChecksum: string;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly intentFingerprint: string;
}

interface CertifiedBayFlowEditSource extends BayFlowEditSource {
	readonly planFingerprint: string;
	readonly sourceAuthoredProjectionFingerprint: string;
	readonly targetAuthoredProjectionFingerprint: string;
}

const issuedPlans = new WeakMap<object, BayFlowEditSource>();
const certifiedPlans = new WeakMap<object, CertifiedBayFlowEditSource>();
const pendingPermits = new WeakMap<object, BayFlowEditSource>();
let nextTicketId = 1;

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

export function staticFabBayFlowEditIntentFingerprint(intent: StaticFabBayFlowEditIntent): string {
	const error = staticFabBayFlowEditIntentError(intent);
	if (error) throw new TypeError(error);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["STATIC_FAB_BAY_FLOW_EDIT_INTENT", intent.targetInternalFlowPattern]);
	checksum.addNumbers([intent.version, intent.bayOrganizationId]);
	return checksum.digest();
}

export function issueStaticFabBayFlowEditPermit(
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabBayFlowEditIntent,
	sourceChecksum: string,
): StaticFabBayFlowEditPermit {
	if (!nonNegativeSafeInteger(patchSequence)) {
		throw new RangeError("Bay flow edit patch sequence is invalid.");
	}
	if (!nonEmptyString(sourceChecksum)) {
		throw new TypeError("Bay flow edit source checksum is missing.");
	}
	if (!Number.isSafeInteger(nextTicketId)) {
		throw new RangeError("Bay flow edit ticket sequence is exhausted.");
	}
	const permit = Object.freeze({ ticketId: nextTicketId++ });
	pendingPermits.set(
		permit,
		Object.freeze({
			map,
			portEquipment,
			organizations,
			sourceChecksum,
			baseRevision: map.getRevision(),
			basePatchSequence: patchSequence,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
			intentFingerprint: staticFabBayFlowEditIntentFingerprint(intent),
		}),
	);
	return permit;
}

export function revokeStaticFabBayFlowEditPermit(permit: StaticFabBayFlowEditPermit): void {
	pendingPermits.delete(permit);
}

/** Consume one permit and clone the exact Worker plan into main-realm immutable ownership. */
export function adoptStaticFabBayFlowEditWorkerPlan(
	permit: StaticFabBayFlowEditPermit,
	ticket: StaticFabBayFlowEditWorkerTicket,
	workerPlan: StaticFabBayFlowEditPlan,
	expectedProspectiveChecksum: string,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	intent: StaticFabBayFlowEditIntent,
): StaticFabBayFlowEditPlan {
	const source = pendingPermits.get(permit);
	pendingPermits.delete(permit);
	if (!source) throw new Error("Bay flow edit permit is missing or already consumed.");

	const ticketError = staticFabBayFlowEditWorkerTicketError(ticket);
	if (ticketError) throw new Error(`Bay flow edit Worker ticket is malformed: ${ticketError}`);
	const planError = staticFabBayFlowEditWorkerPlanShapeError(workerPlan);
	if (planError) throw new Error(`Bay flow edit Worker plan is malformed: ${planError}`);

	const intentFingerprint = staticFabBayFlowEditIntentFingerprint(intent);
	if (!sourceMatchesLiveDocument(source, map, portEquipment, patchSequence, organizations)) {
		throw new Error("Bay flow edit permit no longer matches the live document.");
	}
	if (source.intentFingerprint !== intentFingerprint) {
		throw new Error("Bay flow edit permit no longer matches the live intent.");
	}
	if (
		ticket.ticketId !== permit.ticketId ||
		ticket.sourceRevision !== source.baseRevision ||
		ticket.sourcePatchSequence !== source.basePatchSequence ||
		ticket.sourceChecksum !== source.sourceChecksum ||
		ticket.sourceNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.sourceNextPortId !== source.sourceNextPortId ||
		ticket.sourceNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== source.sourceNextOrganizationId ||
		ticket.intentFingerprint !== intentFingerprint ||
		ticket.prospectiveNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextPortId !== source.sourceNextPortId ||
		ticket.prospectiveNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.prospectiveNextOrganizationId !== source.sourceNextOrganizationId ||
		!nonEmptyString(expectedProspectiveChecksum) ||
		ticket.prospectiveChecksum !== expectedProspectiveChecksum
	) {
		throw new Error("Bay flow edit Worker ticket does not match its one-shot permit.");
	}
	if (
		workerPlan.baseRevision !== source.baseRevision ||
		workerPlan.basePatchSequence !== source.basePatchSequence ||
		workerPlan.nextOrganizationIdBefore !== source.sourceNextOrganizationId ||
		workerPlan.nextOrganizationIdAfter !== source.sourceNextOrganizationId ||
		workerPlan.review.bayOrganizationId !== intent.bayOrganizationId ||
		workerPlan.review.targetInternalFlowPattern !== intent.targetInternalFlowPattern ||
		workerPlan.review.sourceInternalFlowPattern === intent.targetInternalFlowPattern ||
		workerPlan.review.sourceAuthoredProjectionFingerprint !==
			ticket.sourceAuthoredProjectionFingerprint ||
		workerPlan.review.targetAuthoredProjectionFingerprint !==
			ticket.targetAuthoredProjectionFingerprint
	) {
		throw new Error("Bay flow edit Worker plan is stale or invalid.");
	}

	const planFingerprint = staticFabBayFlowEditPlanFingerprint(workerPlan);
	if (ticket.planFingerprint !== planFingerprint) {
		throw new Error("Bay flow edit Worker plan fingerprint diverged.");
	}
	const adopted = copyWorkerPlan(workerPlan);
	if (staticFabBayFlowEditPlanFingerprint(adopted) !== planFingerprint) {
		throw new Error("Bay flow edit plan changed during adoption.");
	}
	const certification = Object.freeze({
		...source,
		planFingerprint,
		sourceAuthoredProjectionFingerprint: workerPlan.review.sourceAuthoredProjectionFingerprint,
		targetAuthoredProjectionFingerprint: workerPlan.review.targetAuthoredProjectionFingerprint,
	});
	issuedPlans.set(adopted, source);
	certifiedPlans.set(adopted, certification);
	return adopted;
}

export function isIssuedStaticFabBayFlowEditPlan(plan: StaticFabBayFlowEditPlan): boolean {
	return issuedPlans.has(plan);
}

export function isStaticFabBayFlowEditPlanIssuedFor(
	plan: StaticFabBayFlowEditPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): boolean {
	const source = issuedPlans.get(plan);
	return (
		source !== undefined &&
		sourceMatchesCurrentIdentities(source, map, portEquipment, organizations)
	);
}

export function consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
	plan: StaticFabBayFlowEditPlan,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): boolean {
	const certification = certifiedPlans.get(plan);
	if (
		!certification ||
		!sourceMatchesCurrentIdentities(certification, map, portEquipment, organizations) ||
		plan.baseRevision !== certification.baseRevision ||
		plan.basePatchSequence !== certification.basePatchSequence ||
		plan.review.sourceAuthoredProjectionFingerprint !==
			certification.sourceAuthoredProjectionFingerprint ||
		plan.review.targetAuthoredProjectionFingerprint !==
			certification.targetAuthoredProjectionFingerprint ||
		certification.planFingerprint !== staticFabBayFlowEditPlanFingerprint(plan)
	) {
		return false;
	}
	certifiedPlans.delete(plan);
	issuedPlans.delete(plan);
	return true;
}

export function staticFabBayFlowEditPlanFingerprint(plan: StaticFabBayFlowEditPlan): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"STATIC_FAB_BAY_FLOW_EDIT_PLAN",
		plan.kind,
		plan.reason,
		plan.issueCode ?? "",
	]);
	checksum.addNumbers([
		plan.baseRevision,
		plan.basePatchSequence,
		plan.nextOrganizationIdBefore,
		plan.nextOrganizationIdAfter,
		plan.valid ? 1 : 0,
	]);
	addRailMutations(checksum, plan.mutations);
	addAdvancedSwitchMutations(checksum, plan.switchMutations);
	addPortMutations(checksum, plan.portMutations);
	addEquipmentGroupMutations(checksum, plan.equipmentGroupMutations);
	addOrganizationMutations(checksum, plan.organizationMutations);
	addNumberList(checksum, plan.organizationImpactAuthorizations);
	addReview(checksum, plan.review);
	return checksum.digest();
}

function staticFabBayFlowEditWorkerTicketError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, TICKET_KEYS)) {
		return "fields do not match the exact ticket contract";
	}
	if (!positiveSafeInteger(value.ticketId)) return "ticket id is invalid";
	if (value.validationLevel !== "exact") return "validation level is invalid";
	if (!nonNegativeSafeInteger(value.sourceRevision)) return "source revision is invalid";
	if (!nonNegativeSafeInteger(value.sourcePatchSequence)) {
		return "source patch sequence is invalid";
	}
	for (const key of [
		"sourceNextAdvancedSwitchId",
		"sourceNextPortId",
		"sourceNextEquipmentGroupId",
		"sourceNextOrganizationId",
		"prospectiveNextAdvancedSwitchId",
		"prospectiveNextPortId",
		"prospectiveNextEquipmentGroupId",
		"prospectiveNextOrganizationId",
	] as const) {
		if (!positiveSafeInteger(value[key])) return `${key} is invalid`;
	}
	for (const key of [
		"sourceChecksum",
		"intentFingerprint",
		"planFingerprint",
		"sourceAuthoredProjectionFingerprint",
		"targetAuthoredProjectionFingerprint",
		"prospectiveChecksum",
	] as const) {
		if (!nonEmptyString(value[key])) return `${key} is missing`;
	}
	return null;
}

function staticFabBayFlowEditWorkerPlanShapeError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, PLAN_KEYS)) {
		return "fields do not match the exact plan contract";
	}
	if (value.kind !== STATIC_FAB_BAY_FLOW_EDIT_KIND) return "kind is invalid";
	if (!nonNegativeSafeInteger(value.baseRevision)) return "base revision is invalid";
	if (!nonNegativeSafeInteger(value.basePatchSequence)) return "base patch sequence is invalid";
	if (!positiveSafeInteger(value.nextOrganizationIdBefore)) {
		return "source organization cursor is invalid";
	}
	if (!positiveSafeInteger(value.nextOrganizationIdAfter)) {
		return "prospective organization cursor is invalid";
	}
	if (value.nextOrganizationIdBefore !== value.nextOrganizationIdAfter) {
		return "organization cursor changed";
	}
	if (value.valid !== true || value.issueCode !== null || !nonEmptyString(value.reason)) {
		return "validity fields are invalid";
	}
	for (const key of [
		"mutations",
		"switchMutations",
		"portMutations",
		"equipmentGroupMutations",
		"organizationMutations",
		"organizationImpactAuthorizations",
	] as const) {
		if (!Array.isArray(value[key])) return `${key} is not an array`;
	}
	if (
		(value.mutations as unknown[]).length === 0 ||
		(value.organizationMutations as unknown[]).length === 0
	) {
		return "flow-only plans require rail and organization mutations";
	}
	if (
		(value.switchMutations as unknown[]).length !== 0 ||
		(value.portMutations as unknown[]).length !== 0 ||
		(value.equipmentGroupMutations as unknown[]).length !== 0
	) {
		return "flow-only plans cannot mutate switches, ports, or equipment groups";
	}
	if (!canonicalPositiveIds(value.organizationImpactAuthorizations as unknown[])) {
		return "organization impact authorizations are not canonical";
	}
	return staticFabBayFlowEditReviewShapeError(value.review);
}

function staticFabBayFlowEditReviewShapeError(value: unknown): string | null {
	if (!isRecord(value) || !hasExactKeys(value, REVIEW_KEYS)) {
		return "review fields do not match the exact contract";
	}
	if (value.version !== STATIC_FAB_BAY_FLOW_EDIT_VERSION) return "review version is invalid";
	if (!positiveSafeInteger(value.bayOrganizationId)) return "Bay organization id is invalid";
	if (!nonEmptyString(value.bayName)) return "Bay name is missing";
	if (value.bankOrganizationId !== null && !positiveSafeInteger(value.bankOrganizationId)) {
		return "Bank organization id is invalid";
	}
	if (
		!Array.isArray(value.processLoopOrganizationIds) ||
		value.processLoopOrganizationIds.length !== 2 ||
		!value.processLoopOrganizationIds.every(positiveSafeInteger)
	) {
		return "Process Loop organization ids are invalid";
	}
	if (!isFlowPattern(value.sourceInternalFlowPattern)) return "source flow is invalid";
	if (!isFlowPattern(value.targetInternalFlowPattern)) return "target flow is invalid";
	if (value.sourceInternalFlowPattern === value.targetInternalFlowPattern) {
		return "source and target flow are equal";
	}
	if (
		!nonEmptyString(value.sourceAuthoredProjectionFingerprint) ||
		!nonEmptyString(value.targetAuthoredProjectionFingerprint)
	) {
		return "authored projection fingerprints are missing";
	}
	if (value.sourceAuthoredProjectionFingerprint === value.targetAuthoredProjectionFingerprint) {
		return "authored projection fingerprints are equal";
	}
	for (const key of [
		"sourceSpecificationAliasCount",
		"sourceDirectedEdgeCount",
		"targetDirectedEdgeCount",
		"removedDirectedEdgeCount",
		"addedDirectedEdgeCount",
		"changedCellCount",
	] as const) {
		if (!positiveSafeInteger(value[key])) return `${key} is invalid`;
	}
	if (
		!Array.isArray(value.changedOrganizationIds) ||
		value.changedOrganizationIds.length === 0 ||
		!canonicalPositiveIds(value.changedOrganizationIds)
	) {
		return "changed organization ids are invalid";
	}
	if (value.incidentConnectorCount !== 0 && value.incidentConnectorCount !== 1) {
		return "incident connector count is invalid";
	}
	for (const key of [
		"connectorBankToBayDirectedEdgeKeys",
		"connectorBayToBankDirectedEdgeKeys",
	] as const) {
		if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) {
			return `${key} is invalid`;
		}
	}
	if (
		value.shellCertification !== "PENDING_WORKER_CERTIFICATION" ||
		value.externalGatewayCertification !== "PENDING_WORKER_CERTIFICATION" ||
		value.topologyCertification !== "PENDING_WORKER_CERTIFICATION" ||
		value.issueCode !== null
	) {
		return "certification fields are invalid";
	}
	return null;
}

function sourceMatchesLiveDocument(
	source: BayFlowEditSource,
	map: TileMap,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
): boolean {
	return (
		source.basePatchSequence === patchSequence &&
		sourceMatchesCurrentIdentities(source, map, portEquipment, organizations)
	);
}

function sourceMatchesCurrentIdentities(
	source: BayFlowEditSource,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): boolean {
	return (
		source.map === map &&
		source.portEquipment === portEquipment &&
		source.organizations === organizations &&
		source.baseRevision === map.getRevision() &&
		source.sourceNextAdvancedSwitchId === map.getAdvancedSwitchIdCursor() &&
		source.sourceNextPortId === portEquipment.nextPortId &&
		source.sourceNextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		source.sourceNextOrganizationId === organizations.nextOrganizationId
	);
}

function copyWorkerPlan(plan: StaticFabBayFlowEditPlan): StaticFabBayFlowEditPlan {
	return Object.freeze({
		...plan,
		mutations: Object.freeze(plan.mutations.map((mutation) => Object.freeze({ ...mutation }))),
		switchMutations: Object.freeze(
			plan.switchMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyAdvancedSwitch(mutation.before) : null,
					after: mutation.after ? copyAdvancedSwitch(mutation.after) : null,
				}),
			),
		),
		portMutations: Object.freeze(
			plan.portMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyPortRecord(mutation.before) : null,
					after: mutation.after ? copyPortRecord(mutation.after) : null,
				}),
			),
		),
		equipmentGroupMutations: Object.freeze(
			plan.equipmentGroupMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyEquipmentGroupRecord(mutation.before) : null,
					after: mutation.after ? copyEquipmentGroupRecord(mutation.after) : null,
				}),
			),
		),
		organizationMutations: Object.freeze(
			plan.organizationMutations.map((mutation) =>
				Object.freeze({
					id: mutation.id,
					before: mutation.before ? copyStaticFabOrganizationRecord(mutation.before) : null,
					after: mutation.after ? copyStaticFabOrganizationRecord(mutation.after) : null,
				}),
			),
		),
		organizationImpactAuthorizations: Object.freeze([...plan.organizationImpactAuthorizations]),
		review: copyReview(plan.review),
	});
}

function copyReview(review: StaticFabBayFlowEditReview): StaticFabBayFlowEditReview {
	return Object.freeze({
		...review,
		processLoopOrganizationIds: Object.freeze([
			review.processLoopOrganizationIds[0],
			review.processLoopOrganizationIds[1],
		] as const),
		changedOrganizationIds: Object.freeze([...review.changedOrganizationIds]),
		connectorBankToBayDirectedEdgeKeys: Object.freeze([
			...review.connectorBankToBayDirectedEdgeKeys,
		]),
		connectorBayToBankDirectedEdgeKeys: Object.freeze([
			...review.connectorBayToBankDirectedEdgeKeys,
		]),
	});
}

function addRailMutations(
	checksum: OrderedTypedChecksum,
	mutations: StaticFabBayFlowEditPlan["mutations"],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.x, mutation.y, mutation.before, mutation.after]);
	}
}

function addAdvancedSwitchMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly AdvancedSwitchMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addAdvancedSwitchRecord(checksum, mutation.before);
		addAdvancedSwitchRecord(checksum, mutation.after);
	}
}

function addAdvancedSwitchRecord(
	checksum: OrderedTypedChecksum,
	record: AdvancedSwitchRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.origin.x,
		record.origin.y,
		record.forward,
		record.lateral,
		record.movementMask,
	]);
	checksum.addStrings([record.profileClass]);
}

function addPortMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly PortMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addPortRecord(checksum, mutation.before);
		addPortRecord(checksum, mutation.after);
	}
}

function addPortRecord(checksum: OrderedTypedChecksum, record: PortRecord | null): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.equipmentGroupId,
		record.stationMillimeters,
		record.lateralOffsetMillimeters,
	]);
	checksum.addStrings([
		record.side,
		record.direction,
		record.portType,
		record.barcode ?? "",
		record.route.kind,
	]);
	if (record.route.kind === "CARDINAL_CELL") {
		checksum.addNumbers([record.route.x, record.route.z, record.route.from, record.route.to]);
	} else {
		checksum.addNumbers([
			record.route.switchId,
			record.route.portIndex ?? -1,
			record.route.segmentOrdinal,
		]);
		checksum.addStrings([record.route.profileClass, record.route.role]);
	}
}

function addEquipmentGroupMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly EquipmentGroupMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addEquipmentGroupRecord(checksum, mutation.before);
		addEquipmentGroupRecord(checksum, mutation.after);
	}
}

function addEquipmentGroupRecord(
	checksum: OrderedTypedChecksum,
	record: EquipmentGroupRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1, record.id, record.portIds.length, ...record.portIds]);
	checksum.addStrings([record.kind]);
	if (record.kind === "EQ") {
		checksum.addNumbers([record.pitchMillimeters]);
		checksum.addStrings([record.recipe ?? ""]);
	} else {
		checksum.addStrings([record.template]);
	}
}

function addOrganizationMutations(
	checksum: OrderedTypedChecksum,
	mutations: readonly StaticFabOrganizationMutation[],
): void {
	checksum.addNumbers([mutations.length]);
	for (const mutation of mutations) {
		checksum.addNumbers([mutation.id]);
		addOrganizationRecord(checksum, mutation.before);
		addOrganizationRecord(checksum, mutation.after);
	}
}

function addOrganizationRecord(
	checksum: OrderedTypedChecksum,
	record: StaticFabOrganizationRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	const parents = staticFabOrganizationParentIds(record);
	const properties = staticFabOrganizationProperties(record);
	checksum.addNumbers([1, record.id, parents.length, ...parents]);
	checksum.addStrings([record.kind, record.name, properties.description, properties.color]);
	checksum.addNumbers([record.membership.railEdges.length]);
	for (const edge of record.membership.railEdges) {
		checksum.addNumbers([edge.from.x, edge.from.y, edge.to.x, edge.to.y]);
	}
	checksum.addNumbers([
		record.membership.advancedSwitchIds.length,
		...record.membership.advancedSwitchIds,
		record.membership.equipmentGroupIds.length,
		...record.membership.equipmentGroupIds,
	]);
}

function addReview(checksum: OrderedTypedChecksum, review: StaticFabBayFlowEditReview): void {
	checksum.addStrings([
		review.bayName,
		review.sourceInternalFlowPattern ?? "",
		review.targetInternalFlowPattern,
		review.sourceAuthoredProjectionFingerprint,
		review.targetAuthoredProjectionFingerprint,
		review.shellCertification,
		review.externalGatewayCertification,
		review.topologyCertification,
		review.issueCode ?? "",
	]);
	checksum.addNumbers([
		review.version,
		review.bayOrganizationId,
		review.bankOrganizationId ?? 0,
		review.sourceSpecificationAliasCount,
		review.sourceDirectedEdgeCount,
		review.targetDirectedEdgeCount,
		review.removedDirectedEdgeCount,
		review.addedDirectedEdgeCount,
		review.changedCellCount,
		review.incidentConnectorCount,
	]);
	addNumberList(checksum, review.processLoopOrganizationIds);
	addNumberList(checksum, review.changedOrganizationIds);
	addStringList(checksum, review.connectorBankToBayDirectedEdgeKeys);
	addStringList(checksum, review.connectorBayToBankDirectedEdgeKeys);
}

function addNumberList(checksum: OrderedTypedChecksum, values: readonly number[]): void {
	checksum.addNumbers([values.length, ...values]);
}

function addStringList(checksum: OrderedTypedChecksum, values: readonly string[]): void {
	checksum.addNumbers([values.length]);
	checksum.addStrings(values);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const Keys extends readonly string[]>(
	value: Record<string, unknown>,
	keys: Keys,
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function canonicalPositiveIds(values: readonly unknown[]): boolean {
	return values.every(
		(value, index) =>
			positiveSafeInteger(value) && (index === 0 || (values[index - 1] as number) < value),
	);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isFlowPattern(value: unknown): value is "alternating" | "co-rotating" {
	return value === "alternating" || value === "co-rotating";
}
